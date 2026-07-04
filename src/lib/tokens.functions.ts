import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Atomic debit via the spend_credits() SQL function (row-locked, ledgered,
// free messages spent before paid credits). Throws:
//   OUT_OF_CREDITS  — wallet can't cover the amount
//   NO_WALLET       — no balance row for the user
// Call from inside a server-fn handler with the request-scoped client.
export async function spendCredits(
  supabase: any,
  userId: string,
  amount: number,
  reason: string,
  refType?: string,
  refId?: string,
): Promise<{ free: number; paid: number }> {
  const { data, error } = await supabase.rpc("spend_credits", {
    p_user: userId,
    p_amount: amount,
    p_reason: reason,
    p_ref_type: refType ?? null,
    p_ref_id: refId ?? null,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("INSUFFICIENT_CREDITS")) throw new Error("OUT_OF_CREDITS");
    if (msg.includes("NO_WALLET")) throw new Error("OUT_OF_CREDITS");
    throw new Error(msg || "Could not spend credits");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { free: row?.free_remaining ?? 0, paid: row?.paid_remaining ?? 0 };
}

// Record a premium AI action (separate from the money ledger).
export async function logAiUsage(
  supabase: any,
  userId: string,
  action: string,
  tokensSpent: number,
  conversationId?: string,
  meta?: Record<string, unknown>,
) {
  await supabase.from("ai_usage_logs").insert({
    user_id: userId,
    action,
    tokens_spent: tokensSpent,
    conversation_id: conversationId ?? null,
    meta: meta ?? null,
  });
}

// ── Wallet: current balance + subscription snapshot ──
export const getWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const db = context.supabase as any; // subscription_* columns not in generated types yet
    const { data: bal } = await db
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits, updated_at")
      .eq("user_id", userId).maybeSingle();
    const { data: profile } = await db
      .from("profiles")
      .select("subscription_tier, subscription_status, subscription_renews_at")
      .eq("id", userId).maybeSingle();

    const free = bal?.free_messages_remaining ?? 0;
    const paid = bal?.paid_credits ?? 0;
    return {
      free,
      paid,
      total: free + paid,
      subscription: {
        tier: profile?.subscription_tier ?? null,
        status: profile?.subscription_status ?? null,
        renewsAt: profile?.subscription_renews_at ?? null,
        active: profile?.subscription_status === "active",
      },
    };
  });

// ── Token ledger (credits + debits) ──
export const getTokenHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ limit: z.number().min(1).max(100).default(50) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const db = context.supabase as any; // new table not in generated types yet
    const { data: rows } = await db
      .from("token_transactions")
      .select("id, delta, balance_after, reason, ref_type, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    return rows ?? [];
  });

// ── Payment history ──
export const getPaymentHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ limit: z.number().min(1).max(100).default(50) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const db = context.supabase as any; // provider column not in generated types yet
    const { data: rows } = await db
      .from("transactions")
      .select("id, amount_cents, credits_added, pack_name, provider, status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    return rows ?? [];
  });
