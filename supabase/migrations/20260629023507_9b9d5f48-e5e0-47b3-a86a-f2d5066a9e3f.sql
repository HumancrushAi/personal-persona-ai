ALTER TABLE public.user_personalities
  ADD COLUMN IF NOT EXISTS tone text,
  ADD COLUMN IF NOT EXISTS boundaries text;