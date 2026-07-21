-- Track when a user was last sent a "she misses you" re-engagement ping,
-- so the scheduled job doesn't spam them.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_reengaged_at TIMESTAMPTZ;
