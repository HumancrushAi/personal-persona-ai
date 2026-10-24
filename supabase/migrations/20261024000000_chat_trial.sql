-- Chat trial ladder, deferred email verification, owner alerts, funnel events.
--
-- Guests are Supabase anonymous users (auth.users.is_anonymous). Their trial
-- allowance lives in guest_trials and never touches credit_balances: an
-- anonymous user's wallet starts at 0, so no paid feature (photos, videos,
-- the generator) can run on a guest. When the guest signs up or logs in, the
-- app moves their conversation to the real account (see trial.server.ts).

-- 1. Guest sessions --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_trials (
  -- The anonymous auth user. No FK: the row is kept as funnel history even
  -- after the anonymous user is cleaned up.
  user_id UUID PRIMARY KEY,
  stage TEXT NOT NULL DEFAULT 'guest' CHECK (stage IN ('guest', 'email')),
  credits_used INT NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  captured_email TEXT,
  ip_hash TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'trial',
  model_id UUID,
  utm JSONB,
  referrer TEXT,
  linked_user_id UUID,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_trials_ip_day ON public.guest_trials (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS guest_trials_device ON public.guest_trials (device_hash);
ALTER TABLE public.guest_trials ENABLE ROW LEVEL SECURITY;
-- Server (service role) only. No client policies on purpose: allowance and
-- stage are never read from or written by the browser.
GRANT ALL ON public.guest_trials TO service_role;

-- Atomic trial debit. One UPDATE with the allowance in its WHERE clause, so two
-- parallel messages can never both pass the check: the second one sees the
-- first one's credits_used and matches no row. Returns the new credits_used,
-- or NULL when the message does not fit in what is left.
CREATE OR REPLACE FUNCTION public.consume_trial_credit(
  p_user UUID, p_cost INT, p_guest_allowance INT, p_email_allowance INT
) RETURNS INT
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.guest_trials
     SET credits_used = credits_used + p_cost, updated_at = now()
   WHERE user_id = p_user
     AND credits_used + p_cost <= CASE stage WHEN 'email' THEN p_guest_allowance + p_email_allowance ELSE p_guest_allowance END
  RETURNING credits_used;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_trial_credit(UUID, INT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_trial_credit(UUID, INT, INT, INT) TO service_role;

CREATE OR REPLACE FUNCTION public.refund_trial_credit(p_user UUID, p_cost INT) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.guest_trials SET credits_used = GREATEST(0, credits_used - p_cost), updated_at = now() WHERE user_id = p_user;
$$;
REVOKE EXECUTE ON FUNCTION public.refund_trial_credit(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_trial_credit(UUID, INT) TO service_role;

-- 2. Leads -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  guest_session_id UUID,
  user_id UUID,
  source TEXT NOT NULL,
  model_id UUID,
  marketing_consent BOOLEAN NOT NULL DEFAULT false,
  marketing_consent_at TIMESTAMPTZ,
  utm JSONB,
  referrer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One stage-2 grant per email address, ever, across devices.
CREATE UNIQUE INDEX IF NOT EXISTS leads_chat_trial_email ON public.leads (lower(email)) WHERE source = 'chat_trial';
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.leads TO service_role;

-- 3. Funnel events -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funnel_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event TEXT NOT NULL,
  guest_session_id UUID,
  user_id UUID,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS funnel_events_event_day ON public.funnel_events (event, created_at);
CREATE INDEX IF NOT EXISTS funnel_events_user ON public.funnel_events (user_id, event);
ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.funnel_events TO service_role;

-- Daily funnel. Run: SELECT * FROM public.funnel_daily ORDER BY day DESC LIMIT 30;
CREATE OR REPLACE VIEW public.funnel_daily AS
SELECT
  date_trunc('day', created_at)::date AS day,
  count(*) FILTER (WHERE event = 'guest_chat_started') AS guests_started,
  count(*) FILTER (WHERE event = 'email_wall_shown') AS email_walls_shown,
  count(*) FILTER (WHERE event = 'email_captured') AS emails_captured,
  count(*) FILTER (WHERE event = 'account_wall_shown') AS account_walls_shown,
  count(*) FILTER (WHERE event = 'account_created') AS accounts_created,
  count(*) FILTER (WHERE event = 'account_created' AND properties->>'source' = 'chat_trial') AS accounts_from_chat_trial,
  count(*) FILTER (WHERE event = 'account_created' AND properties->>'source' = 'generator') AS accounts_from_generator,
  count(*) FILTER (WHERE event = 'account_created' AND properties->>'source' = 'direct') AS accounts_direct,
  count(*) FILTER (WHERE event = 'purchase_completed') AS purchases
FROM public.funnel_events
GROUP BY 1;
REVOKE ALL ON public.funnel_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.funnel_daily TO service_role;

-- 4. Profiles: app-controlled verification and optional SMS consent ---------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ;

-- Everyone who already confirmed through Supabase is verified. New signups
-- are auto-confirmed by Supabase once "Confirm email" is off, so from here on
-- only the app's own link sets this column.
UPDATE public.profiles p
   SET email_verified_at = u.email_confirmed_at
  FROM auth.users u
 WHERE u.id = p.id AND p.email_verified_at IS NULL AND u.email_confirmed_at IS NOT NULL;

-- Users may update their own profile row, so the verification stamp is pinned
-- against client writes; only the server (service role) can change it.
CREATE OR REPLACE FUNCTION public.pin_email_verified_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    NEW.email_verified_at := OLD.email_verified_at;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS t_profiles_pin_verified ON public.profiles;
CREATE TRIGGER t_profiles_pin_verified BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.pin_email_verified_at();

-- 5. Anonymous users get an empty wallet --------------------------------------
-- The 25-message signup bonus is for real accounts. A guest's allowance is
-- guest_trials, so their wallet is 0 and nothing paid can run on it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)));
  IF coalesce(NEW.is_anonymous, false) THEN
    INSERT INTO public.credit_balances (user_id, free_messages_remaining) VALUES (NEW.id, 0);
  ELSE
    INSERT INTO public.credit_balances (user_id) VALUES (NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 6. Disposable email domains, blocked at signup -----------------------------
CREATE TABLE IF NOT EXISTS public.blocked_email_domains (
  domain TEXT PRIMARY KEY
);
ALTER TABLE public.blocked_email_domains ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.blocked_email_domains TO service_role;
INSERT INTO public.blocked_email_domains (domain) VALUES
  ('mailinator.com'), ('guerrillamail.com'), ('guerrillamail.net'), ('guerrillamail.org'), ('sharklasers.com'),
  ('10minutemail.com'), ('10minutemail.net'), ('tempmail.com'), ('temp-mail.org'), ('temp-mail.io'),
  ('tempmail.net'), ('tempmailo.com'), ('throwawaymail.com'), ('yopmail.com'), ('yopmail.net'),
  ('getnada.com'), ('nada.email'), ('dispostable.com'), ('maildrop.cc'), ('mailnesia.com'),
  ('trashmail.com'), ('trashmail.de'), ('fakeinbox.com'), ('mintemail.com'), ('mohmal.com'),
  ('emailondeck.com'), ('spamgourmet.com'), ('mytemp.email'), ('tempinbox.com'), ('burnermail.io'),
  ('moakt.com'), ('tmail.ws'), ('tmpmail.org'), ('tmpmail.net'), ('fakemail.net'),
  ('emailfake.com'), ('crazymailing.com'), ('mailcatch.com'), ('inboxkitten.com'), ('1secmail.com'),
  ('1secmail.net'), ('1secmail.org'), ('mail.tm'), ('mail.gw'), ('discard.email'),
  ('spambox.us'), ('mailpoof.com'), ('linshiyouxiang.net'), ('tempr.email'), ('dropmail.me'),
  ('harakirimail.com'), ('mailforspam.com'), ('spam4.me'), ('33mail.com'), ('anonaddy.me'),
  ('mailsac.com'), ('mvrht.net'), ('emltmp.com'), ('tempmail.plus'), ('minuteinbox.com')
ON CONFLICT DO NOTHING;

-- Backstop for signups that skip the app's own check. The app shows a friendly
-- message first; this only fires for a client calling Supabase directly.
CREATE OR REPLACE FUNCTION public.block_disposable_signup() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.blocked_email_domains WHERE domain = lower(split_part(NEW.email, '@', 2))
  ) THEN
    RAISE EXCEPTION 'DISPOSABLE_EMAIL' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.block_disposable_signup() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_block_disposable ON auth.users;
CREATE TRIGGER on_auth_user_block_disposable
BEFORE INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.block_disposable_signup();
