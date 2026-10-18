CREATE TABLE IF NOT EXISTS public.creator_model_unlocks (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  companion_id UUID NOT NULL REFERENCES public.companions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, companion_id)
);
ALTER TABLE public.creator_model_unlocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own creator unlocks" ON public.creator_model_unlocks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert own creator unlocks" ON public.creator_model_unlocks FOR INSERT WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT ON public.creator_model_unlocks TO authenticated;
