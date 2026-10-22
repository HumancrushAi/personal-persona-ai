-- Persist the server-derived mode so finalization cannot infer safety from a
-- client-only flag or from a rewritten prompt.
ALTER TABLE public.media_jobs
  ADD COLUMN IF NOT EXISTS content_mode TEXT NOT NULL DEFAULT 'adult';

DO $$
BEGIN
  ALTER TABLE public.media_jobs
    ADD CONSTRAINT media_jobs_content_mode_check
    CHECK (content_mode IN ('social', 'adult'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS media_jobs_content_mode_idx
  ON public.media_jobs(content_mode, status);
