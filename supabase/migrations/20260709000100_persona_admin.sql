-- Milestone 3: admin-editable persona/model fields.
-- Personas live in `companions`; add catalog-management columns.
ALTER TABLE public.companions
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',   -- active | inactive
  ADD COLUMN IF NOT EXISTS is_adult BOOLEAN NOT NULL DEFAULT true;  -- all personas are 18+

-- Safety invariant: every persona is an adult. Enforce at the DB level so it
-- cannot be bypassed by the app or admin UI.
ALTER TABLE public.companions
  DROP CONSTRAINT IF EXISTS companions_adult_only;
ALTER TABLE public.companions
  ADD CONSTRAINT companions_adult_only CHECK (is_adult = true AND age >= 18);

-- Public catalog should only ever return ACTIVE personas to end users, while
-- users keep full access to their own created companions regardless of status.
-- Rewrite the existing read policy in place (do NOT add a second SELECT policy —
-- RLS policies are OR'd, which would defeat the status gate and expose others'
-- private companions). Admin reads use the service-role client (bypasses RLS).
DROP POLICY IF EXISTS "companions public read" ON public.companions;
DROP POLICY IF EXISTS "companions read public or own" ON public.companions;
CREATE POLICY "companions read public or own" ON public.companions
  FOR SELECT
  USING ((created_by IS NULL AND status = 'active') OR created_by = auth.uid());

CREATE INDEX IF NOT EXISTS idx_companions_status ON public.companions(status);
