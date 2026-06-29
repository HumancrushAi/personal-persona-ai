ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text;
CREATE INDEX IF NOT EXISTS profiles_subscription_id_idx ON public.profiles (subscription_id);