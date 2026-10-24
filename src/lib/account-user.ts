/**
 * A real account, as opposed to a chat-trial guest. Guests are Supabase
 * anonymous users: they hold a session so the chat works, but everywhere
 * else in the app (header, credits, generator, library) they are signed out.
 */
export function isAccount<T extends { is_anonymous?: boolean }>(user: T | null | undefined): user is T {
  return !!user && !user.is_anonymous;
}
