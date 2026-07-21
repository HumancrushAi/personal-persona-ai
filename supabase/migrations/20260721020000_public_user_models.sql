-- Make user-created models public too, so they appear in the shared gallery
-- for everyone to browse and chat with (not just their creator).
-- Any ACTIVE companion is readable; a user still always sees their own.
DROP POLICY IF EXISTS "companions read public or own" ON public.companions;
CREATE POLICY "companions read public or own" ON public.companions
  FOR SELECT
  USING (status = 'active' OR created_by = auth.uid());
