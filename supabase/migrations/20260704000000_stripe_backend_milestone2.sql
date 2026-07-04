-- Milestone 2: Stripe payments + normalized token/subscription backend.
-- Additive and idempotent. Reuses existing profiles + credit_balances (wallet)
-- and transactions (payments) tables; adds Stripe identifiers, a normalized
-- subscriptions table, a token ledger, usage/audit logs, a webhook idempotency
-- table, and atomic spend/grant functions.

-- ─────────────────────────────────────────────────────────────
-- profiles: Stripe identifiers (subscription_* columns already exist)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

CREATE INDEX IF NOT EXISTS profiles_stripe_customer_idx ON public.profiles (stripe_customer_id);

-- ─────────────────────────────────────────────────────────────
-- transactions (payments history): Stripe identifiers + provider
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;

-- authnet_transaction_id stays (nullable) for historical rows.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_stripe_session_idx
  ON public.transactions (stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- subscriptions (normalized) — one active row per Stripe subscription
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id  text UNIQUE NOT NULL,
  stripe_customer_id      text,
  price_id                text,
  plan                    text,                 -- our tier id, e.g. sub-lover
  status                  text NOT NULL,        -- active, past_due, canceled, ...
  monthly_credits         integer,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON public.subscriptions (user_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own subscriptions read" ON public.subscriptions;
CREATE POLICY "own subscriptions read" ON public.subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

-- ─────────────────────────────────────────────────────────────
-- token_transactions — append-only ledger of every credit/debit
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.token_transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta          integer NOT NULL,       -- +credit / -debit
  balance_after  integer NOT NULL,       -- total (free+paid) after this entry
  reason         text NOT NULL,          -- purchase, subscription_grant, chat, image, voice, admin_adjust
  ref_type       text,
  ref_id         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS token_transactions_user_idx ON public.token_transactions (user_id, created_at DESC);

ALTER TABLE public.token_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own token ledger read" ON public.token_transactions;
CREATE POLICY "own token ledger read" ON public.token_transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.token_transactions TO authenticated;
GRANT ALL ON public.token_transactions TO service_role;

-- ─────────────────────────────────────────────────────────────
-- ai_usage_logs — one row per premium AI action
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action           text NOT NULL,        -- chat, image, voice
  tokens_spent     integer NOT NULL DEFAULT 0,
  conversation_id  uuid,
  meta             jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_logs_user_idx ON public.ai_usage_logs (user_id, created_at DESC);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own usage read" ON public.ai_usage_logs;
CREATE POLICY "own usage read" ON public.ai_usage_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.ai_usage_logs TO authenticated;
GRANT ALL ON public.ai_usage_logs TO service_role;

-- ─────────────────────────────────────────────────────────────
-- audit_logs — admin/system audit trail (admins read only)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid,
  action      text NOT NULL,
  target      text,
  meta        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read audit" ON public.audit_logs;
CREATE POLICY "admins read audit" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

-- ─────────────────────────────────────────────────────────────
-- stripe_events — webhook idempotency (service_role only)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id            text PRIMARY KEY,         -- Stripe event id (evt_...)
  type          text NOT NULL,
  payload       jsonb,
  processed_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
-- no policies: only service_role (which bypasses RLS) may touch it.
GRANT ALL ON public.stripe_events TO service_role;

-- ─────────────────────────────────────────────────────────────
-- spend_credits(): atomic debit. Free messages first, then paid credits.
-- Writes the ledger + updates the wallet under a row lock. Callable by the
-- authenticated owner only (enforced against auth.uid()).
-- Raises 'INSUFFICIENT_CREDITS' when the wallet can't cover p_amount.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.spend_credits(
  p_user     uuid,
  p_amount   integer,
  p_reason   text,
  p_ref_type text DEFAULT NULL,
  p_ref_id   text DEFAULT NULL
) RETURNS TABLE (free_remaining integer, paid_remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_free integer;
  v_paid integer;
  v_need integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT free_messages_remaining, paid_credits INTO v_free, v_paid
  FROM public.credit_balances WHERE user_id = p_user FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_WALLET';
  END IF;

  IF (v_free + v_paid) < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  v_need := p_amount;
  IF v_free >= v_need THEN
    v_free := v_free - v_need;
    v_need := 0;
  ELSE
    v_need := v_need - v_free;
    v_free := 0;
    v_paid := v_paid - v_need;
    v_need := 0;
  END IF;

  UPDATE public.credit_balances
    SET free_messages_remaining = v_free, paid_credits = v_paid, updated_at = now()
    WHERE user_id = p_user;

  INSERT INTO public.token_transactions (user_id, delta, balance_after, reason, ref_type, ref_id)
    VALUES (p_user, -p_amount, v_free + v_paid, p_reason, p_ref_type, p_ref_id);

  free_remaining := v_free;
  paid_remaining := v_paid;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.spend_credits(uuid, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spend_credits(uuid, integer, text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- grant_credits(): atomic credit into paid_credits + ledger.
-- Server-side only (webhook / admin), so service_role only.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_credits(
  p_user     uuid,
  p_amount   integer,
  p_reason   text,
  p_ref_type text DEFAULT NULL,
  p_ref_id   text DEFAULT NULL
) RETURNS TABLE (free_remaining integer, paid_remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_free integer;
  v_paid integer;
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  INSERT INTO public.credit_balances (user_id, paid_credits)
    VALUES (p_user, GREATEST(p_amount, 0))
    ON CONFLICT (user_id) DO UPDATE
      SET paid_credits = GREATEST(public.credit_balances.paid_credits + p_amount, 0),
          updated_at = now();

  SELECT free_messages_remaining, paid_credits INTO v_free, v_paid
    FROM public.credit_balances WHERE user_id = p_user;

  INSERT INTO public.token_transactions (user_id, delta, balance_after, reason, ref_type, ref_id)
    VALUES (p_user, p_amount, v_free + v_paid, p_reason, p_ref_type, p_ref_id);

  free_remaining := v_free;
  paid_remaining := v_paid;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_credits(uuid, integer, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_credits(uuid, integer, text, text, text) TO service_role;

-- touch updated_at on subscriptions
DROP TRIGGER IF EXISTS subscriptions_touch ON public.subscriptions;
CREATE TRIGGER subscriptions_touch BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
