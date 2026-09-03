-- Support tickets raised from the widget on the landing and sign-up pages.
--
-- The widget is shown to signed-out visitors too, so user_id is nullable and the
-- email address is the only identity a ticket is guaranteed to have. A ticket
-- from a signed-in user carries both, which is what lets them see the thread and
-- the reply inside the app instead of only in their inbox.
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL rather than CASCADE: a deleted account should not silently erase
  -- the billing dispute that account opened.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  name TEXT,
  subject TEXT NOT NULL DEFAULT 'Support request',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per message in both directions. `direction` is from the user's point
-- of view: 'in' is what they sent us, 'out' is a staff reply.
CREATE TABLE IF NOT EXISTS public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT NOT NULL,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_email ON public.support_tickets(email);
CREATE INDEX IF NOT EXISTS idx_support_tickets_recent ON public.support_tickets(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON public.support_messages(ticket_id, created_at);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.support_tickets TO authenticated;
GRANT SELECT ON public.support_messages TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
GRANT ALL ON public.support_messages TO service_role;

-- Reads only. Every write goes through a server function on the service role,
-- because a ticket can be raised by a signed-out visitor and because the email
-- address on a ticket must not be something the client can edit after the fact.
CREATE POLICY "own tickets read" ON public.support_tickets
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "own ticket messages read" ON public.support_messages
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = support_messages.ticket_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "admin tickets read" ON public.support_tickets
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin ticket messages read" ON public.support_messages
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
