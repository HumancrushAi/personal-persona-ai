-- V2 Core Enhancements Migration
-- 1. Create media_jobs table
CREATE TABLE IF NOT EXISTS public.media_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'voice')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  prompt TEXT NOT NULL,
  provider TEXT NOT NULL,
  replicate_id TEXT UNIQUE,
  media_url TEXT,
  error TEXT,
  cost INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.media_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own media jobs" ON public.media_jobs;
CREATE POLICY "Users read own media jobs" ON public.media_jobs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.media_jobs TO authenticated;
GRANT ALL ON public.media_jobs TO service_role;

-- 2. Unique Constraints & Idempotency
ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

-- Make sure authnet_transaction_id has a unique constraint (skip if it already exists).
DO $$
BEGIN
  ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_authnet_transaction_id_key UNIQUE (authnet_transaction_id);
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Add persona columns to public.companions
ALTER TABLE public.companions
  ADD COLUMN IF NOT EXISTS background TEXT,
  ADD COLUMN IF NOT EXISTS speaking_style TEXT,
  ADD COLUMN IF NOT EXISTS interests TEXT,
  ADD COLUMN IF NOT EXISTS relationship_context TEXT,
  ADD COLUMN IF NOT EXISTS vocabulary_level TEXT,
  ADD COLUMN IF NOT EXISTS emotional_tone TEXT,
  ADD COLUMN IF NOT EXISTS boundaries TEXT,
  ADD COLUMN IF NOT EXISTS supported_languages TEXT[] DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS greeting_style TEXT,
  ADD COLUMN IF NOT EXISTS greeting TEXT,
  ADD COLUMN IF NOT EXISTS voice_id TEXT DEFAULT 'alloy',
  ADD COLUMN IF NOT EXISTS response_length TEXT DEFAULT 'short' CHECK (response_length IN ('short', 'medium', 'long')),
  ADD COLUMN IF NOT EXISTS prompt_version TEXT DEFAULT '1.0';

-- 4. Add summary column to public.conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS summary TEXT;

-- 5. Create app_settings table
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read of app settings" ON public.app_settings;
CREATE POLICY "Allow public read of app settings" ON public.app_settings
  FOR SELECT TO anon, authenticated
  USING (true);

GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;

-- 6. Account suspension flag
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false;

-- 7. Per-companion public media gallery (admin-managed)
CREATE TABLE IF NOT EXISTS public.companion_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  companion_id UUID NOT NULL REFERENCES public.companions(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.companion_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read companion media" ON public.companion_media;
CREATE POLICY "Public read companion media" ON public.companion_media
  FOR SELECT TO anon, authenticated
  USING (true);

GRANT SELECT ON public.companion_media TO anon, authenticated;
GRANT ALL ON public.companion_media TO service_role;

-- 8. Create audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view audit logs" ON public.audit_logs;
CREATE POLICY "Admins view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
