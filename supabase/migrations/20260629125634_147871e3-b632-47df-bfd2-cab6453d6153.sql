ALTER TABLE public.companions ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.companions ADD COLUMN IF NOT EXISTS art_style text NOT NULL DEFAULT 'realistic';
CREATE INDEX IF NOT EXISTS companions_created_by_idx ON public.companions(created_by);

DROP POLICY IF EXISTS "companions public read" ON public.companions;
CREATE POLICY "companions read public or own" ON public.companions
  FOR SELECT USING (created_by IS NULL OR created_by = auth.uid());
CREATE POLICY "companions users can create own" ON public.companions
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "companions users can update own" ON public.companions
  FOR UPDATE TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
CREATE POLICY "companions users can delete own" ON public.companions
  FOR DELETE TO authenticated USING (created_by = auth.uid());