// The treasure chest's server calls: what is in it, buying from it, and the
// user's own room for her to pose in.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { applyDeduction, hasEnough } from "./credits";
import { CHEST_EXTRAS, TOYS, TOY_PURCHASE_PREFIX, chestItemById } from "./toys";
import { assertNotSuspended } from "./account.server";

export type ChestToy = {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  price: number;
  kind: string;
  owned: boolean;
  image?: string;
};

export type ChestRoom = {
  owned: boolean;
  price: number;
  url: string | null;
  description: string | null;
};

export const listToys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ conversationId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: authUser } = await supabase.auth.getUser();
    const { ownedToys, owns } = await import("./toys.server");
    const owned = await ownedToys(supabase, userId, authUser?.user?.email);
    const { data: bal } = await supabase
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits")
      .eq("user_id", userId)
      .maybeSingle();
    const credits = (bal?.free_messages_remaining ?? 0) + (bal?.paid_credits ?? 0);
    const roomItem = CHEST_EXTRAS.find((e) => e.id === "room")!;
    let room: ChestRoom = { owned: owns(owned, "room"), price: roomItem.price, url: null, description: null };
    if (data.conversationId) {
      const { roomFor } = await import("./rooms.server");
      const r = await roomFor(data.conversationId);
      if (r) room = { ...room, url: r.url, description: r.description };
    }
    return {
      free: owned === "all",
      credits,
      toys: TOYS.map(
        (t): ChestToy => ({
          id: t.id,
          name: t.name,
          emoji: t.emoji,
          blurb: t.blurb,
          price: t.price,
          kind: t.kind,
          owned: owns(owned, t.id),
          image: t.image,
        }),
      ),
      room,
    };
  });

export const buyToy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ toyId: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotSuspended(supabase, userId);
    const item = chestItemById(data.toyId);
    if (!item) throw new Error("No such item");

    const { data: authUser } = await supabase.auth.getUser();
    const { ownedToys, owns } = await import("./toys.server");
    const owned = await ownedToys(supabase, userId, authUser?.user?.email);
    if (owns(owned, item.id)) return { ok: true as const, owned: true as const, credits: null };

    const { data: bal } = await supabase
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits")
      .eq("user_id", userId)
      .maybeSingle();
    const free = bal?.free_messages_remaining ?? 0;
    const paid = bal?.paid_credits ?? 0;
    if (!hasEnough(free, paid, item.price)) {
      return { ok: false as const, needsCredits: true as const, credits: free + paid, price: item.price };
    }

    // The ledger row is the receipt AND the inventory entry. Its idempotency
    // key is one per user and item, so a second tap on the button, or a
    // retried request, cannot charge twice: the insert fails on the unique
    // key and the balance is left alone.
    const { free: newFree, paid: newPaid } = applyDeduction(free, paid, item.price);
    const { error } = await supabase.from("credit_ledger").insert({
      user_id: userId,
      delta: -item.price,
      reason: `${TOY_PURCHASE_PREFIX}${item.id}`,
      balance_after: newFree + newPaid,
      idempotency_key: `toy-${userId}-${item.id}`,
    });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return { ok: true as const, owned: true as const, credits: free + paid };
      throw new Error(`Could not record the purchase: ${error.message}`);
    }
    await supabase
      .from("credit_balances")
      .update({ free_messages_remaining: newFree, paid_credits: newPaid })
      .eq("user_id", userId);
    return { ok: true as const, owned: true as const, credits: newFree + newPaid };
  });

// The user's room: a photo, described once, used as the setting of every
// photo and clip in this chat. Needs the "room" item from the chest.
export const setRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        /** A data: URL of the photo, at most ~6MB of base64. */
        dataUrl: z.string().min(50).max(8_500_000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotSuspended(supabase, userId);
    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    const { data: authUser } = await supabase.auth.getUser();
    const { ownedToys, owns } = await import("./toys.server");
    const owned = await ownedToys(supabase, userId, authUser?.user?.email);
    if (!owns(owned, "room")) return { ok: false as const, needsItem: "room" as const };

    const m = data.dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp|heic|heif));base64,(.+)$/i);
    if (!m) throw new Error("That is not a photo I can use — send a JPG or PNG");
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > 6_000_000) throw new Error("That photo is too large — try one under 6MB");

    const { storeRoomPhoto, describeRoom, saveRoom } = await import("./rooms.server");
    const url = await storeRoomPhoto(userId, data.conversationId, bytes);
    const description = await describeRoom(url);
    if (!description) throw new Error("I couldn't make out the room in that photo — try a clearer, brighter one");
    const room = { url, description, at: new Date().toISOString() };
    await saveRoom(data.conversationId, room);
    return { ok: true as const, room };
  });

export const clearRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");
    const { clearRoom: clear } = await import("./rooms.server");
    await clear(data.conversationId);
    return { ok: true as const };
  });
