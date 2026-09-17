// Accounts that never run out of credits, for testing the paid features
// without buying them.
//
// Kept TOPPED UP rather than exempted from charging. Every deduction, refund
// and ledger row runs exactly as it does for a paying user — which is the
// point of testing — and the only difference is that the balance is refilled
// to a million whenever it dips below a hundred thousand. The refill goes in
// the ledger as "tester_grant", so it shows in the admin panel and is never
// mistaken for revenue.
//
// The list is the env var when set, else the built-in one. An address has to
// match exactly, case-insensitively.

const DEFAULT_TESTERS = ["nft.king137@gmail.com"];
const REFILL_TO = 1_000_000;
const REFILL_BELOW = 100_000;

export function isTesterEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.TEST_ACCOUNT_EMAILS ?? DEFAULT_TESTERS.join(","))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

/**
 * Refill a tester's balance if it has run low. Called before every credit
 * gate, so a tester's request never sees OUT_OF_CREDITS. A no-op for everyone
 * else, and best-effort: a failed refill must not fail the request itself.
 */
export async function topUpTester(userId: string, email: string | null | undefined) {
  if (!isTesterEmail(email)) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: bal } = await supabaseAdmin
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits")
      .eq("user_id", userId)
      .maybeSingle();
    const paid = bal?.paid_credits ?? 0;
    if (bal && paid >= REFILL_BELOW) return;

    if (bal) {
      await supabaseAdmin
        .from("credit_balances")
        .update({ paid_credits: REFILL_TO })
        .eq("user_id", userId);
    } else {
      await supabaseAdmin
        .from("credit_balances")
        .insert({ user_id: userId, paid_credits: REFILL_TO });
    }
    // The ledger row is the audit trail, not the grant: if the table rejects
    // the reason, the balance is still topped up.
    await supabaseAdmin
      .from("credit_ledger")
      .insert({
        user_id: userId,
        delta: REFILL_TO - paid,
        reason: "tester_grant",
        balance_after: (bal?.free_messages_remaining ?? 0) + REFILL_TO,
      })
      .then(({ error }) => {
        if (error) console.warn("[tester] ledger row rejected:", error.message);
      });
  } catch (e: any) {
    console.error("[tester] top-up failed:", e?.message ?? e);
  }
}
