-- One send, one message.
--
-- sendChatMessage writes the user's row and THEN does the slow part. On a media
-- request the slow part is prompt refinement and building a start frame, which
-- is tens of seconds — a long window for a phone to re-establish a connection
-- and for the POST to arrive a second time. The handler has no way to tell that
-- apart from a real second send, so it ran again end to end: a second copy of
-- the same message, a second charge, and a second render queued against it.
-- That is "I sent a message once and it duplicated itself and gave two
-- outputs".
--
-- Deduping on content was considered and rejected: sending "lol" twice in a
-- minute is ordinary conversation, and a content window cannot tell that from a
-- retry. The client now mints an id per send ATTEMPT, so a retransmission of the
-- same attempt carries the same id and a genuine second send carries a new one.
--
-- Nullable, because every message written before this migration has no id and
-- the other writers (the assistant's own replies, media rows) do not need one.
-- The unique index is partial for the same reason: many NULLs must coexist.
alter table public.messages
  add column if not exists client_msg_id uuid;

create unique index if not exists messages_conversation_client_msg_id_key
  on public.messages (conversation_id, client_msg_id)
  where client_msg_id is not null;

comment on column public.messages.client_msg_id is
  'Client-minted id for one send attempt. Retransmissions of the same attempt reuse it, so the server can tell a retry from a genuine repeat send. Null for assistant and media rows.';
