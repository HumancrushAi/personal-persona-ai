// Server-only plumbing for the growth funnel: privacy-safe request
// fingerprints, Turnstile verification, funnel events and owner alerts.
import { createHmac } from "node:crypto";
import { growthConfig } from "@/config/growth";

type Db = any;

function hashSecret() {
  return process.env.GROWTH_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "hc-growth";
}

/** Keyed hash, so a leaked table cannot be reversed into IPs by brute force. */
export function hashValue(value: string) {
  return createHmac("sha256", hashSecret()).update(value).digest("hex");
}

export type RequestFacts = { ipHash: string; deviceHash: string; country: string | null; ip: string };

/**
 * Raw IPs are never stored. The device key is the lightweight hash the spec
 * asks for (user agent + language + platform), salted with the IP so two
 * strangers on the same phone model do not share a device cap.
 */
export function requestFacts(headers: Headers): RequestFacts {
  const ip = (headers.get("x-forwarded-for") ?? headers.get("x-real-ip") ?? "").split(",")[0].trim() || "unknown";
  const device = [headers.get("user-agent") ?? "", headers.get("accept-language") ?? "", headers.get("sec-ch-ua-platform") ?? ""].join("|");
  return {
    ip,
    ipHash: hashValue(`ip:${ip}`),
    deviceHash: hashValue(`device:${ip}|${device}`),
    country: headers.get("x-vercel-ip-country") ?? headers.get("cf-ipcountry"),
  };
}

export function captchaActive() {
  return growthConfig.auth.captcha.enabled && !!process.env.TURNSTILE_SECRET_KEY;
}

/** True when captcha is off (no keys) or Cloudflare accepts the token. */
export async function verifyCaptcha(token: string | undefined, ip: string, fetcher: typeof fetch = fetch) {
  if (!captchaActive()) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token, remoteip: ip });
    const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch (error) {
    console.error("[captcha] verification failed", error);
    return false;
  }
}

/**
 * Sexual-content check for guest Social mode, on the OpenAI moderation model
 * the Social render path already uses. Returns null when it cannot answer
 * (no key, slow, error): the keyword screen and the Social prompt still hold.
 */
export async function isSexualText(text: string, fetcher: typeof fetch = fetch): Promise<boolean | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text.trim()) return null;
  try {
    const res = await Promise.race([
      fetcher("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: process.env.SOCIAL_MODERATION_MODEL || "omni-moderation-latest", input: text.slice(0, 4000) }),
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    if (!res || !res.ok) return null;
    const json = (await res.json()) as { results?: { categories?: Record<string, boolean>; category_scores?: Record<string, number> }[] };
    const result = json.results?.[0];
    if (!result) return null;
    return !!result.categories?.sexual || (result.category_scores?.sexual ?? 0) > 0.4;
  } catch {
    return null;
  }
}

export const FUNNEL_EVENTS = [
  "trial_variant_assigned", "guest_chat_started", "guest_message_sent", "email_wall_shown", "email_captured",
  "account_wall_shown", "account_created", "explicit_request_deflected", "age_confirmed", "first_generation",
  "plans_viewed", "checkout_started", "purchase_completed", "email_verified",
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/** Best effort: a lost event must never break the action it describes. */
export async function trackServerEvent(
  db: Db,
  event: FunnelEvent,
  ids: { userId?: string | null; guestId?: string | null },
  properties: Record<string, unknown> = {},
) {
  try {
    await db.from("funnel_events").insert({ event, user_id: ids.userId ?? null, guest_session_id: ids.guestId ?? null, properties });
  } catch (error) {
    console.error(`[funnel] could not record ${event}`, error);
  }
}

export type AlertEvent = (typeof growthConfig.alerts.notifyOn)[number];
export type AlertDetails = {
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  method?: string | null;
  source?: string | null;
  model?: string | null;
  stage?: string | null;
  referrer?: string | null;
  utm?: Record<string, string> | null;
  country?: string | null;
};

/** Plain-text alert body. Never chat content, never passwords. */
export function formatAlert(event: AlertEvent, details: AlertDetails, now = new Date()) {
  const title = event === "lead_captured" ? "New lead" : "New account";
  const utm = details.utm && Object.keys(details.utm).length ? Object.entries(details.utm).map(([k, v]) => `${k}=${v}`).join(" ") : null;
  return [
    `${title} (${event})`,
    `Time: ${now.toISOString().replace("T", " ").slice(0, 19)} UTC`,
    details.email && `Email: ${details.email}`,
    details.name && `Name: ${details.name}`,
    details.phone && `Phone: ${details.phone}`,
    details.method && `Method: ${details.method}`,
    details.source && `Source: ${details.source}`,
    details.model && `Model: ${details.model}`,
    details.stage && `Stage reached: ${details.stage}`,
    details.referrer && `Referrer: ${details.referrer}`,
    utm && `UTM: ${utm}`,
    details.country && `Country: ${details.country}`,
  ].filter(Boolean).join("\n");
}

let warnedNoChannel = false;

function configuredChannels() {
  const channels: ("telegram" | "email")[] = [];
  for (const channel of growthConfig.alerts.channels) {
    if (channel === "telegram" && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) channels.push("telegram");
    if (channel === "email" && process.env.ALERT_EMAIL_TO && process.env.RESEND_API_KEY) channels.push("email");
  }
  if (!channels.length && !warnedNoChannel) {
    warnedNoChannel = true;
    console.warn("[alerts] no alert channel has credentials (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID or ALERT_EMAIL_TO); owner alerts are off");
  }
  return channels;
}

/**
 * Owner alert on a lead or a signup. Never throws and never holds the caller
 * for more than `budgetMs`: the account already exists by the time this runs,
 * and a slow Telegram must not make sign-up feel slow.
 */
export async function sendOwnerAlert(
  event: AlertEvent,
  details: AlertDetails,
  deps: { fetcher?: typeof fetch; sendEmail?: (to: string, subject: string, html: string) => Promise<unknown>; budgetMs?: number } = {},
) {
  if (!(growthConfig.alerts.notifyOn as readonly string[]).includes(event)) return;
  const channels = configuredChannels();
  if (!channels.length) return;
  const text = formatAlert(event, details);
  const fetcher = deps.fetcher ?? fetch;
  const sends = channels.map(async (channel) => {
    if (channel === "telegram") {
      const res = await fetcher(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
      });
      if (!res.ok) throw new Error(`telegram ${res.status}`);
    } else {
      const send = deps.sendEmail ?? (await import("./notify")).sendEmail;
      const html = `<pre style="font:14px/1.5 ui-monospace,monospace">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>`;
      await send(process.env.ALERT_EMAIL_TO!, text.split("\n")[0], html);
    }
  });
  const settled = Promise.allSettled(sends).then((results) => {
    results.forEach((result, index) => {
      if (result.status === "rejected") console.error(`[alerts] ${channels[index]} failed for ${event}`, result.reason);
    });
  });
  await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, deps.budgetMs ?? 1500))]);
}
