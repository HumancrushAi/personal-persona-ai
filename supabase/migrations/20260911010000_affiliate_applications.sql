-- The half of the affiliate program that faces the affiliate.
--
-- 20260911000000_affiliates.sql could only be driven by an admin typing rows
-- in: there was no way to apply, and no way for an affiliate to ever see their
-- own numbers. affiliates.user_id existed but nothing on earth ever set it, so
-- an affiliate could not be connected to an account even in principle.
--
-- Written to be safe against that migration having already been applied, since
-- both may land at once.

-- ── Applying ────────────────────────────────────────────────────────────────
--
-- A third status. An application is a row like any other, so the admin panel
-- lists it beside the live ones and approving it is a status change rather than
-- a re-keying exercise.
--
-- 'pending' is inert everywhere it matters: trackAffiliateVisit and
-- claimReferral both filter on status = 'active', and so does the commission
-- trigger. An application therefore cannot track, attribute or earn until
-- somebody approves it.
ALTER TABLE public.affiliates DROP CONSTRAINT IF EXISTS affiliates_status_check;
ALTER TABLE public.affiliates
  ADD CONSTRAINT affiliates_status_check
  CHECK (status IN ('pending', 'active', 'paused', 'rejected'));

ALTER TABLE public.affiliates
  -- How they say they will promote. The single most useful thing to read
  -- before deciding whether someone gets 10% or 50%.
  ADD COLUMN IF NOT EXISTS pitch TEXT,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- ── Connecting an affiliate to their account ────────────────────────────────
--
-- Binding is by EMAIL, which is the one identifier both sides already have: the
-- admin types it in to pay them, and the affiliate signs up with it. No invite
-- tokens, no codes to redeem, nothing to lose in a spam folder — they sign up
-- with the address the deal was agreed on and their dashboard is simply there.
--
-- Case-insensitive and unique, because "Gary@x.com" and "gary@x.com" are one
-- person and two affiliate rows claiming one address is an ambiguity the
-- binding query must never have to resolve.
CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliates_email_ci
  ON public.affiliates (lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_affiliates_user ON public.affiliates(user_id);
CREATE INDEX IF NOT EXISTS idx_affiliates_status ON public.affiliates(status);

-- Deliberately still no RLS policy for `authenticated`, on any of the four
-- tables. It would be the obvious way to let an affiliate read their own row,
-- and it is the wrong one: a policy wide enough to show them their earnings is
-- one `affiliate_id` away from showing them somebody else's rate. The affiliate
-- dashboard reads through server functions on the service role that scope every
-- query to the caller's own affiliate id, which is checked in one place rather
-- than expressed as a predicate on four tables.
