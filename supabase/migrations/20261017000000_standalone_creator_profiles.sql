-- Private identities created by the standalone media creator.
CREATE TABLE IF NOT EXISTS public.creator_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  reference_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "creator profiles own rows" ON public.creator_profiles;
CREATE POLICY "creator profiles own rows" ON public.creator_profiles
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creator_profiles TO authenticated;
GRANT ALL ON public.creator_profiles TO service_role;

ALTER TABLE public.media_jobs
  ADD COLUMN IF NOT EXISTS creator_profile_id UUID REFERENCES public.creator_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS media_jobs_creator_profile_idx ON public.media_jobs(creator_profile_id);
