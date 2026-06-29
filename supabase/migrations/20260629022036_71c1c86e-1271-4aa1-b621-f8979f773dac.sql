
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS authnet_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT;

CREATE TABLE IF NOT EXISTS public.subscription_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  authnet_subscription_id TEXT,
  authnet_transaction_id TEXT,
  event_type TEXT NOT NULL,
  amount_cents INTEGER,
  credits_granted INTEGER,
  raw_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscription_events TO authenticated;
GRANT ALL ON public.subscription_events TO service_role;

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own subscription events"
  ON public.subscription_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_sub_events_sub_id ON public.subscription_events(authnet_subscription_id);
CREATE INDEX IF NOT EXISTS idx_profiles_sub_id ON public.profiles(authnet_subscription_id);
