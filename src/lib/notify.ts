// Server-only senders for web push (VAPID) and transactional email (Resend).
import webpush from "web-push";

let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@humancrush.com";
  if (!pub || !priv) throw new Error("Push not configured (VAPID keys missing)");
  webpush.setVapidDetails(subject, pub, priv);
  vapidReady = true;
}

export type PushSub = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url?: string };

// Throws a WebPushError with statusCode on failure (410/404 = dead subscription).
export async function sendPush(sub: PushSub, payload: PushPayload) {
  ensureVapid();
  await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload),
  );
}

export async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Email not configured (RESEND_API_KEY missing)");
  const from = process.env.EMAIL_FROM || "HumanCrush <notifications@humancrush.com>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Email error: ${res.status} ${(await res.text()).slice(0, 150)}`);
}

// Simple branded wrapper for notification emails.
export function notificationEmailHtml(title: string, body: string, url?: string): string {
  const cta = url
    ? `<a href="${url}" style="display:inline-block;background:linear-gradient(90deg,#ff4d8d,#c04bff);color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px;">Open HumanCrush.com</a>`
    : "";
  return `<div style="background:#0d0a12;padding:28px;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:440px;margin:auto;background:#171320;border:1px solid #2a2436;border-radius:20px;padding:28px;text-align:center;color:#fff;">
      <div style="font-size:24px;font-weight:700;">❤ HumanCrush.com</div>
      <h1 style="font-size:20px;margin:16px 0 8px;">${title}</h1>
      <p style="color:#b3aac2;font-size:14px;line-height:1.6;margin:0 0 20px;">${body}</p>
      ${cta}
    </div>
  </div>`;
}
