-- A reversed sale voids its commission.
--
-- The accrual trigger from 20260911000000_affiliates.sql only ever added. The
-- affiliate dashboard said "commission on a refunded purchase is voided", and
-- nothing did it: a refunded customer went on earning their affiliate money.
--
-- The Authorize.Net webhook now marks a fully refunded sale 'refunded' and a
-- voided one 'voided'. An admin can mark one 'chargeback' — chargebacks have
-- no webhook event, so they only ever arrive by hand. This function is where
-- any of those becomes a voided commission: the same trigger, living in the
-- database for the same reason the accrual does, so a reversal cannot be
-- forgotten at whichever code path happens to write it.
--
-- Only 'pending' and 'approved' commissions are voided. A 'paid' one is money
-- that has already left. Flipping it to void would make the affiliate's "paid
-- to date" drop by money they genuinely received, and getting it back is a
-- conversation, not a status change.
--
-- The trigger itself is unchanged — it already fires on UPDATE OF status — so
-- only the function is replaced. Safe to run more than once.

CREATE OR REPLACE FUNCTION public.accrue_affiliate_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  aff RECORD;
BEGIN
  -- Reversal: void whatever is still unpaid for this sale, then stop.
  IF NEW.status IN ('refunded', 'voided', 'chargeback') THEN
    UPDATE public.affiliate_commissions
       SET status = 'void'
     WHERE transaction_id = NEW.id
       AND status IN ('pending', 'approved');
    RETURN NEW;
  END IF;

  -- Accrual, exactly as before. 'pending' sales — a subscription the gateway
  -- has not charged yet — stop here and accrue nothing until they complete.
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
    ROUND(NEW.amount_cents * aff.commission_pct / 100.0)::INT
  )
  ON CONFLICT (transaction_id) DO NOTHING;

  RETURN NEW;
END;
$$;
