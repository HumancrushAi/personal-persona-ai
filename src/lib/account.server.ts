// Server-side account gates shared by chat, media, and payment entry points.

export const ACCOUNT_SUSPENDED = "ACCOUNT_SUSPENDED";
export const RATE_LIMITED = "RATE_LIMITED";

export async function assertNotSuspended(supabase: any, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("is_suspended")
    .eq("id", userId)
    .maybeSingle();
  if (data?.is_suspended) {
    throw new Error(`${ACCOUNT_SUSPENDED}: This account has been suspended. Contact support.`);
  }
}

// DB-backed limiter — serverless instances share no memory, so we count the
// user's own recent rows through their RLS-scoped client instead.
export async function assertRateLimit(
  supabase: any,
  table: "messages" | "media_jobs",
  userId: string,
  windowSeconds: number,
  max: number,
) {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  let query = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  // Assistant rows also carry user_id — only the user's own sends count.
  if (table === "messages") query = query.eq("role", "user");
  const { count } = await query;
  if ((count ?? 0) >= max) {
    throw new Error(`${RATE_LIMITED}: Slow down a little — try again in a minute.`);
  }
}
