
-- Age confirmation + subscription on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS age_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscription_tier text,
  ADD COLUMN IF NOT EXISTS subscription_renews_at timestamptz;

-- Relationship + scenario + memory on conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS scenario text,
  ADD COLUMN IF NOT EXISTS memory text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS relationship_level int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS relationship_xp int NOT NULL DEFAULT 0;

-- Messages can be text, image (selfie), or voice
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_url text;

-- Let authenticated users update their own balance (was previously denied)
DROP POLICY IF EXISTS "own balance update" ON public.credit_balances;
CREATE POLICY "own balance update" ON public.credit_balances
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
