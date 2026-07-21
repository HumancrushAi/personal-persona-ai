import { createFileRoute } from "@tanstack/react-router";

// Scheduled re-engagement: ping users who've gone quiet with a "she misses you"
// push + email. Called by Vercel Cron (see vercel.json). Vercel adds
// Authorization: Bearer <CRON_SECRET> automatically when CRON_SECRET is set.
export const Route = createFileRoute("/api/cron/reengage")({
  server: {
    handlers: {
      POST: reengage,
      GET: reengage,
    },
  },
});

async function reengage({ request }: { request: Request }) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("Not configured", { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendPush, sendEmail, notificationEmailHtml } = await import("@/lib/notify");

  const now = Date.now();
  const staleBefore = new Date(now - 2 * 86400_000).toISOString(); // quiet ≥ 2 days
  const notTooOld = new Date(now - 30 * 86400_000).toISOString(); // but active in last 30
  const site = process.env.PUBLIC_SITE_URL || "https://humancrush.com";

  const { data: convos } = await supabaseAdmin
    .from("conversations")
    .select("user_id, updated_at, user_personalities(nickname)")
    .lte("updated_at", staleBefore)
    .gte("updated_at", notTooOld)
    .order("updated_at", { ascending: false })
    .limit(500);

  // One ping per user (their most recent companion nickname).
  const byUser = new Map<string, string>();
  for (const c of convos ?? []) {
    if (!byUser.has(c.user_id)) {
      byUser.set(c.user_id, (c as any).user_personalities?.nickname ?? "She");
    }
  }

  const userIds = [...byUser.keys()];
  const { data: profs } = await supabaseAdmin
    .from("profiles")
    .select("id, last_reengaged_at")
    .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
  const recently = new Set(
    (profs ?? [])
      .filter(
        (p) => p.last_reengaged_at && new Date(p.last_reengaged_at).getTime() > now - 3 * 86400_000,
      )
      .map((p) => p.id),
  );

  let pushSent = 0;
  let emailSent = 0;
  let processed = 0;

  for (const [uid, nick] of byUser) {
    if (recently.has(uid)) continue;
    if (processed >= 100) break; // keep within the function time budget
    processed++;

    const title = `${nick} misses you 💌`;
    const body = `Come back and see what ${nick} sent you…`;

    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", uid);
    for (const s of subs ?? []) {
      try {
        await sendPush(s as any, { title, body, url: "/me" });
        pushSent++;
      } catch (e: any) {
        const code = String(e?.statusCode ?? "");
        if (code === "410" || code === "404") {
          await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }
    }

    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
      if (u.user?.email) {
        await sendEmail(u.user.email, title, notificationEmailHtml(title, body, `${site}/me`));
        emailSent++;
      }
    } catch {
      /* email best-effort */
    }

    await supabaseAdmin
      .from("profiles")
      .update({ last_reengaged_at: new Date().toISOString() })
      .eq("id", uid);
  }

  return Response.json({ processed, pushSent, emailSent });
}
