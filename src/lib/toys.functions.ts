// The treasure chest's two server calls: what is in it, and buying from it.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { applyDeduction, hasEnough } from "./credits";
import { TOYS, TOY_PURCHASE_PREFIX, toyById } from "./toys";
import { assertNotSuspended } from "./account.server";

export type ChestToy = {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  price: number;
  kind: string;
  owned: boolean;
};

export const listToys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: authUser } = await supabase.auth.getUser();
    const { ownedToys } = await import("./toys.server");
    const owned = await ownedToys(supabase, userId, authUser?.user?.email);
    const { data: bal } = await supabase
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits")
      .eq("user_id", userId)
      .maybeSingle();
    const credits = (bal?.free_messages_remaining ?? 0) + (bal?.paid_credits ?? 0);
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
          owned: owned === "all" || owned.has(t.id),
        }),
      ),
    };
  });

export const buyToy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ toyId: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotSuspended(supabase, userId);
    const toy = toyById(data.toyId);
    if (!toy) throw new Error("No such toy");

    const { data: authUser } = await supabase.auth.getUser();
    const { ownedToys } = await import("./toys.server");
    const owned = await ownedToys(supabase, userId, authUser?.user?.email);
    if (owned === "all" || owned.has(toy.id)) return { ok: true as const, owned: true as const, credits: null };

    const { data: bal } = await supabase
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits")
      .eq("user_id", userId)
      .maybeSingle();
    const free = bal?.free_messages_remaining ?? 0;
    const paid = bal?.paid_credits ?? 0;
    if (!hasEnough(free, paid, toy.price)) {
      return { ok: false as const, needsCredits: true as const, credits: free + paid, price: toy.price };
    }

    // The ledger row is the receipt AND the inventory entry. Its idempotency
    // key is one per user and toy, so a second tap on the button, or a
    // retried request, cannot charge twice: the insert fails on the unique
    // key and the balance is left alone.
    const { free: newFree, paid: newPaid } = applyDeduction(free, paid, toy.price);
    const { error } = await supabase.from("credit_ledger").insert({
      user_id: userId,
      delta: -toy.price,
      reason: `${TOY_PURCHASE_PREFIX}${toy.id}`,
      balance_after: newFree + newPaid,
      idempotency_key: `toy-${userId}-${toy.id}`,
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
