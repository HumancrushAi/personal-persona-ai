-- Long-term memory about the USER, shared by every companion.
--
-- conversations.memory already held this, one copy per conversation, so
-- switching companion started from nothing. The name fix moved to the profile
-- for the same reason: tell one of them and they all know.
--
-- conversations.memory is deliberately left in place. The chat still reads it
-- and folds it into the profile memory, so nobody loses what they have already
-- built up and there is no backfill to run. It is simply no longer written.

alter table public.profiles
  add column if not exists user_memory text;

comment on column public.profiles.user_memory is
  'Durable facts about the user as "key: value" lines, shared across all companions. Written by the chat fact extractor.';
