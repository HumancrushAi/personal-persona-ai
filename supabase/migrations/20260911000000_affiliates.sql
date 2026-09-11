-- Affiliate program: pay people a share of the revenue they send.
--
-- Four tables and one trigger. The trigger is the important part — see the
-- bottom of this file for why the commission is accrued in the database rather
-- than at the three places in the app that take money.

-- ── The affiliate ───────────────────────────────────────────────────────────
--
-- commission_pct is PER AFFILIATE, which is the whole point: one promoter is
-- worth 10% and another is worth 50%, negotiated one deal at a time.
--
-- user_id is nullable and is NOT how an affiliate is identified. Most of them
-- will never have an account here — they are someone with a mailing list and an
-- invoice. It exists only so a promoter who IS also a customer can be linked up.
CREATE TABLE IF NOT EXISTS public.affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The ?ref= value. Stored lower-case and matched lower-case: a code gets
  -- typed by hand, printed on things and pasted into other people's CMSes, so
  -- "?ref=Gary" and "?ref=gary" must be the same affiliate and not a silent
  -- miss that loses someone their commission.
  code TEXT NOT NULL UNIQUE CHECK (code = lower(code) AND code ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  name TEXT NOT NULL,
  email TEXT,
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 20
    CHECK (commission_pct >= 0 AND commission_pct <= 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  notes TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Traffic ─────────────────────────────────────────────────────────────────
--
-- One row per landing. Deliberately holds no IP address and no user agent: the
-- number an affiliate deal is settled on is signups and revenue, a click count
-- is only ever a sanity check on it, and storing identifiers for every visitor
-- to an adult site to service a sanity check is not a trade worth making.
CREATE TABLE IF NOT EXISTS public.affiliate_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  landing_path TEXT,
  referrer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Attribution ─────────────────────────────────────────────────────────────
--
-- UNIQUE on user_id, so a user belongs to exactly one affiliate for life and
-- the row is written once. That makes it FIRST touch, not last: whoever
-- introduced this customer keeps them, and a later affiliate link cannot
-- reassign someone else's customer by being the most recent click before a
-- purchase. It also means two affiliates can never both be paid for one sale.
CREATE TABLE IF NOT EXISTS public.affiliate_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── What is owed ────────────────────────────────────────────────────────────
--
-- commission_pct is COPIED onto every row rather than read from the affiliate
-- at payout time. Rates get renegotiated; when this month's rate changes from
-- 20% to 30%, last month's earnings must not silently change with it. The row
-- records the deal as it stood the day the money came in.
--
-- transaction_id is UNIQUE, which is what makes accrual idempotent: the
-- Authorize.Net webhook can and does deliver the same event twice, and the
-- trigger below fires on UPDATE as well as INSERT.
CREATE TABLE IF NOT EXISTS public.affiliate_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  transaction_id UUID NOT NULL UNIQUE REFERENCES public.transactions(id) ON DELETE CASCADE,
  gross_cents INT NOT NULL,
  commission_pct NUMERIC(5,2) NOT NULL,
  commission_cents INT NOT NULL,
  -- pending: accrued, not yet approved for payout.
  -- approved: agreed and owed.
  -- paid: money has left.
  -- void: refunded or charged back, so no longer owed.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'paid', 'void')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_aff ON public.affiliate_clicks(affiliate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_aff ON public.affiliate_referrals(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_aff ON public.affiliate_commissions(affiliate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_status ON public.affiliate_commissions(status);

-- ── Accrual ─────────────────────────────────────────────────────────────────
--
-- Money enters this app at three separate places: a one-time credit pack and
-- the first charge of a subscription (both in purchaseCredits), and every
-- recurring charge after that (in the Authorize.Net webhook). All three already
-- agree on one thing — they insert a row into `transactions` — so that is where
-- the commission is calculated, and the three call sites are left alone.
--
-- This is deliberate. The alternative is a recordCommission() call after each
-- insert, which is three copies of one rule that have to be kept in agreement,
-- and a fourth payment path added later silently pays nobody. The same shape of
-- mistake is documented at length in src/lib/anatomy.ts. A trigger cannot be
-- forgotten at a call site, and it commits in the same transaction as the sale.
--
-- Fires on UPDATE too, because a transaction can be written as 'failed' and
-- later corrected; ON CONFLICT DO NOTHING keeps that from paying twice.
CREATE OR REPLACE FUNCTION public.accrue_affiliate_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  aff RECORD;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' OR NEW.amount_cents <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT a.id, a.commission_pct
    INTO aff
    FROM public.affiliate_referrals r
    JOIN public.affiliates a ON a.id = r.affiliate_id
   WHERE r.user_id = NEW.user_id
     AND a.status = 'active';

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.affiliate_commissions (
    affiliate_id, user_id, transaction_id, gross_cents, commission_pct, commission_cents
  ) VALUES (
    aff.id,
    NEW.user_id,
    NEW.id,
    NEW.amount_cents,
    aff.commission_pct,
    -- ROUND, not floor: over thousands of small transactions floor would
    -- quietly shave a cent off most of them in our favour, which is the kind
    -- of thing an affiliate eventually notices and stops trusting.
    ROUND(NEW.amount_cents * aff.commission_pct / 100.0)::INT
  )
  ON CONFLICT (transaction_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accrue_affiliate_commission ON public.transactions;
CREATE TRIGGER trg_accrue_affiliate_commission
  AFTER INSERT OR UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.accrue_affiliate_commission();

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- Every one of these is admin-and-service-role only, with NO policy for
-- `authenticated`. RLS is on and no SELECT policy exists, so an ordinary
-- logged-in user reading these tables gets zero rows — which is correct: what
-- another affiliate earns, who referred whom, and what the negotiated rates are
-- is all commercially sensitive and none of a customer's business. The admin
-- screens read through the service-role client, as the rest of the admin panel
-- does.
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.affiliates TO service_role;
GRANT ALL ON public.affiliate_clicks TO service_role;
GRANT ALL ON public.affiliate_referrals TO service_role;
GRANT ALL ON public.affiliate_commissions TO service_role;
