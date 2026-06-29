ALTER TABLE public.companions
  ADD COLUMN IF NOT EXISTS gender text NOT NULL DEFAULT 'female',
  ADD COLUMN IF NOT EXISTS orientation text NOT NULL DEFAULT 'straight',
  ADD COLUMN IF NOT EXISTS video_url text;