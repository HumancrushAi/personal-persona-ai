-- Credit ledger: per-event history of credit grants and deductions.
-- Complements `transactions` (money in) with a running record of every
-- credit change (message sends, selfies, voice notes, purchases, renewals).
CREATE TABLE public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta INT NOT NULL,                 -- negative = spent, positive = granted
  reason TEXT NOT NULL,               -- chat_message | selfie | voice_note | pack_purchase | subscription_grant | recurring_grant
  balance_after INT NOT NULL,         -- total (free + paid) after this change
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ledger read" ON public.credit_ledger
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own ledger insert" ON public.credit_ledger
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_credit_ledger_user ON public.credit_ledger(user_id, created_at DESC);
