import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ensureBalance, deductCredits } from "./credit-wallet";

// Tip amounts (in credits) and the private-show entry cost. Exported for the UI.
export const TIP_AMOUNTS = [5, 10, 25, 50, 100] as const;
export const PRIVATE_ENTRY_COST = 20;

// Send a tip to a model — spends credits, logged in the ledger as "tip".
export const sendTip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        amount: z
          .number()
          .int()
          .refine((a) => (TIP_AMOUNTS as readonly number[]).includes(a), {
            message: "Invalid tip amount",
          }),
        companionId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { free, paid } = await ensureBalance(supabase, userId, data.amount);
    const balance = await deductCredits(supabase, userId, data.amount, "tip", free, paid);
    return { balance, tipped: data.amount };
  });

// Start a private show with a model: charge the entry fee and open (or reuse) a
// 1:1 conversation, then the normal paid chat takes over.
export const startPrivateShow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ companionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: comp } = await supabase
      .from("companions")
      .select("id, name")
      .eq("id", data.companionId)
      .maybeSingle();
    if (!comp) throw new Error("Model not found");

    // Must be able to afford the entry before we create anything.
    const { free, paid } = await ensureBalance(supabase, userId, PRIVATE_ENTRY_COST);

    // Reuse an existing personality for this model, or create a default one.
    const { data: existing } = await supabase
      .from("user_personalities")
      .select("id")
      .eq("user_id", userId)
      .eq("companion_id", data.companionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let personalityId = existing?.id;
    if (!personalityId) {
      const { data: created, error } = await supabase
        .from("user_personalities")
        .insert({ user_id: userId, companion_id: data.companionId, nickname: comp.name })
        .select("id")
        .single();
      if (error) throw error;
      personalityId = created.id;
    }

    await deductCredits(supabase, userId, PRIVATE_ENTRY_COST, "private_show", free, paid);

    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .insert({
        user_id: userId,
        personality_id: personalityId,
        title: `Private with ${comp.name}`,
      })
      .select("id")
      .single();
    if (convErr) throw convErr;

    return { conversationId: conv.id };
  });
