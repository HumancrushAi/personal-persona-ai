import { createFileRoute } from "@tanstack/react-router";

// Daily billing reminders before an auto-renewal — see lib/renewal-reminders.ts.
// Email 3, 2 and 1 days before the charge, plus a push on the last day. Only
// active plans: a cancelled plan is never charged, so it gets nothing. Each
// reminder is recorded in audit_logs and never sent twice for one renewal.
//
// Called by Vercel Cron (vercel.json). Vercel adds
// Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set.
export const Route = createFileRoute("/api/cron/renewal-reminders")({
  server: {
    handlers: {
      POST: sweep,
      GET: sweep,
    },
  },
});

async function sweep({ request }: { request: Request }) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("Not configured", { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendPushToUser, sendEmail, notificationEmailHtml } = await import("@/lib/notify");
  const { getEffectiveTiers } = await import("@/lib/app-settings.server");
  const { reminderDue, renewalCopy } = await import("@/lib/renewal-reminders");

  const now = Date.now();
  const site = process.env.PUBLIC_SITE_URL || "https://www.humancrush.com";
  const horizon = new Date(now + 4 * 86_400_000).toISOString();
  const { data: due } = await supabaseAdmin
    .from("profiles")
    .select("id, subscription_tier, subscription_renews_at")
    .eq("subscription_status", "active")
    .gt("subscription_renews_at", new Date(now).toISOString())
    .lte("subscription_renews_at", horizon)
    .limit(1000);

  const tiers = await getEffectiveTiers();
  let sent = 0;
  let skipped = 0;
  for (const profile of (due ?? []) as { id: string; subscription_tier: string | null; subscription_renews_at: string | null }[]) {
    const days = reminderDue(profile.subscription_renews_at, now);
    const tier = tiers.find((item) => item.id === profile.subscription_tier);
    if (!days || !tier || !profile.subscription_renews_at) continue;

    const key = `${profile.subscription_renews_at}:${days}`;
    const { data: already } = await supabaseAdmin
      .from("audit_logs")
      .select("id")
      .eq("user_id", profile.id)
      .eq("action", "renewal_reminder")
      .contains("details", { key })
      .limit(1)
      .maybeSingle();
    if (already) { skipped++; continue; }

    const { data: auth } = await supabaseAdmin.auth.admin.getUserById(profile.id);
    const email = auth?.user?.email;
    const copy = renewalCopy({ days, planName: tier.name, priceCents: tier.priceCents, credits: tier.monthlyCredits, renewsAt: profile.subscription_renews_at });
    const url = `${site}/credits`;
    let emailed = false;
    if (email) {
      try {
        await sendEmail(email, copy.title, notificationEmailHtml(copy.title, copy.body, url));
        emailed = true;
      } catch (error) {
        console.error("[renewal-reminders] email failed", profile.id, error);
      }
    }
    let pushed = 0;
    if (copy.push) {
      const report = await sendPushToUser(profile.id, { title: copy.title, body: copy.body.slice(0, 140), url: "/credits", tag: "renewal" });
      pushed = report.sent;
    }
    if (emailed || pushed) {
      await supabaseAdmin.from("audit_logs").insert({ user_id: profile.id, action: "renewal_reminder", details: { key, days, tier: tier.id, emailed, pushed } });
      sent++;
    }
  }
  return Response.json({ candidates: due?.length ?? 0, sent, skipped });
}
