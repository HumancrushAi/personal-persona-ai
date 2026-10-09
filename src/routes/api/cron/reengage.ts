import { createFileRoute } from "@tanstack/react-router";

// Daily lifecycle re-engagement, by stage — see lib/lifecycle.ts for the
// ladders and the copy.
//
//   never_started  signed up, never opened a chat → "your free messages are waiting"
//   sampled        five messages or fewer, gone quiet → she leaves a message in the chat
//   engaged        more than five, gone quiet       → she misses you
//
// Every message is email plus push (for the few who turned push on), and
// where there is a chat she actually writes the line into it first, so "she
// left you a message" is true when they open it. One send per milestone, at
// most one a day, nothing after the ladder ends, and a signed unsubscribe
// link in every mail.
//
// Called by Vercel Cron (vercel.json, once a day — the Hobby plan's limit).
// Vercel adds Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set.
export const Route = createFileRoute("/api/cron/reengage")({
  server: {
    handlers: {
      POST: reengage,
      GET: reengage,
    },
  },
});

const DAY = 86_400_000;
// Nothing older than this is looked at: the ladders end before it.
const LOOKBACK_MS = 60 * DAY;
const PER_RUN = 100;

async function reengage({ request }: { request: Request }) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("Not configured", { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendPushToUser, sendEmail, notificationEmailHtml } = await import("@/lib/notify");
  const { stageFor, dueMilestone, copyFor, unsubscribeUrl } = await import("@/lib/lifecycle");

  const now = Date.now();
  const site = process.env.PUBLIC_SITE_URL || "https://www.humancrush.com";

  // Everyone, with their signup date and email. The auth list is the only
  // place a user who never opened a chat exists at all.
  const users: { id: string; email: string | null; createdMs: number; lastSignInMs: number }[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    const batch = data?.users ?? [];
    for (const u of batch) {
      if (!u.email || !u.email_confirmed_at) continue;
      users.push({
        id: u.id,
        email: u.email,
        createdMs: Date.parse(u.created_at),
        lastSignInMs: u.last_sign_in_at ? Date.parse(u.last_sign_in_at) : 0,
      });
    }
    if (batch.length < 1000) break;
  }
  const ids = users.map((u) => u.id);
  if (!ids.length) return Response.json({ processed: 0, sent: 0 });

  // Activity, in bulk: how many messages each user has sent and when the last
  // one was; their most recent conversation and its companion; credits.
  const since = new Date(now - LOOKBACK_MS).toISOString();
  const { data: msgs } = await supabaseAdmin
    .from("messages")
    .select("user_id, created_at")
    .eq("role", "user")
    .gte("created_at", since)
    .limit(50_000);
  const { data: allTime } = await supabaseAdmin
    .from("messages")
    .select("user_id")
    .eq("role", "user")
    .limit(50_000);
  const count = new Map<string, number>();
  for (const m of allTime ?? []) count.set(m.user_id, (count.get(m.user_id) ?? 0) + 1);
  const lastMsg = new Map<string, number>();
  for (const m of msgs ?? []) {
    const t = Date.parse(m.created_at);
    if (t > (lastMsg.get(m.user_id) ?? 0)) lastMsg.set(m.user_id, t);
  }

  const { data: convos } = await supabaseAdmin
    .from("conversations")
    .select(
      "id, user_id, updated_at, user_personalities(nickname, companions(name, gender, image_url))",
    )
    .order("updated_at", { ascending: false })
    .limit(5000);
  const latestConv = new Map<string, any>();
  const hasConv = new Set<string>();
  for (const c of convos ?? []) {
    hasConv.add(c.user_id);
    if (!latestConv.has(c.user_id)) latestConv.set(c.user_id, c);
  }

  const { data: profs } = await supabaseAdmin
    .from("profiles")
    .select("id, last_reengaged_at, is_suspended")
    .in("id", ids);
  const lastSent = new Map<string, number | null>();
  const suspended = new Set<string>();
  for (const p of profs ?? []) {
    lastSent.set(p.id, p.last_reengaged_at ? Date.parse(p.last_reengaged_at) : null);
    if (p.is_suspended) suspended.add(p.id);
  }

  const { data: bals } = await supabaseAdmin
    .from("credit_balances")
    .select("user_id, free_messages_remaining, paid_credits")
    .in("user_id", ids);
  const broke = new Set(
    (bals ?? [])
      .filter((b) => (b.free_messages_remaining ?? 0) <= 0 && (b.paid_credits ?? 0) <= 0)
      .map((b) => b.user_id),
  );

  // A companion to put a face on the never-started mail.
  const { data: featured } = await supabaseAdmin
    .from("companions")
    .select("name, image_url")
    .eq("gender", "female")
    .order("sort_order")
    .limit(1);
  const face = featured?.[0] ?? { name: "Aria", image_url: null };

  let processed = 0;
  let sent = 0;
  let pushed = 0;
  let emailed = 0;
  const byStage: Record<string, number> = {};

  for (const u of users) {
    if (sent >= PER_RUN) break;
    if (suspended.has(u.id)) continue;
    const stage = stageFor(count.get(u.id) ?? 0, hasConv.has(u.id));
    // Anchor: signup for someone who never started; the later of their last
    // message and last sign-in for everyone else.
    const anchor =
      stage === "never_started"
        ? u.createdMs
        : Math.max(lastMsg.get(u.id) ?? 0, u.lastSignInMs, u.createdMs);
    if (now - anchor > LOOKBACK_MS) continue;
    const milestone = dueMilestone(stage, anchor, lastSent.get(u.id) ?? null, now);
    if (milestone === null) continue;
    processed++;

    const conv = latestConv.get(u.id);
    const p: any = conv?.user_personalities;
    const c: any = p?.companions ?? {};
    const nick: string = p?.nickname || c.name || "She";
    const chatPath = conv ? `/chat/${conv.id}` : null;
    const copy = copyFor(stage, milestone, {
      nick,
      companionName: face.name,
      outOfCredits: broke.has(u.id),
      chatPath,
    });

    // Her line goes into the chat FIRST, as a nudge (so the half-hour check-in
    // leaves it alone), so the mail's "she left you a message" is true.
    if (copy.chatLine && conv) {
      const { error } = await supabaseAdmin.from("messages").insert({
        conversation_id: conv.id,
        user_id: u.id,
        role: "assistant",
        content: copy.chatLine,
        kind: "nudge",
      });
      if (!error) {
        await supabaseAdmin
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conv.id);
      }
    }

    const picture = stage === "never_started" ? face.image_url : c.image_url;
    try {
      await sendEmail(
        u.email!,
        copy.subject,
        notificationEmailHtml(copy.subject, copy.body, `${site}${copy.path}`, picture ?? undefined, unsubscribeUrl(site, u.id)),
      );
      emailed++;
    } catch (e: any) {
      console.error("reengage email failed", u.id, e?.message ?? e);
    }
    const push = await sendPushToUser(u.id, {
      title: copy.pushTitle,
      body: copy.body.length > 140 ? `${copy.body.slice(0, 137)}…` : copy.body,
      url: copy.path,
      tag: `lifecycle-${stage}`,
    });
    pushed += push.sent;

    await supabaseAdmin
      .from("profiles")
      .update({ last_reengaged_at: new Date().toISOString() })
      .eq("id", u.id);
    sent++;
    byStage[`${stage}:${milestone}d`] = (byStage[`${stage}:${milestone}d`] ?? 0) + 1;
  }

  return Response.json({ users: users.length, processed, sent, emailed, pushed, byStage });
}
