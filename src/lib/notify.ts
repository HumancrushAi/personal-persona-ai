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

// Helper to send a push notification to all subscriptions belonging to a user.
export async function sendPushToUser(userId: string, payload: PushPayload) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", userId);
    for (const s of subs ?? []) {
      try {
        await sendPush(s as any, payload);
      } catch (e: any) {
        const code = String(e?.statusCode ?? "");
        if (code === "410" || code === "404") {
          await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }
    }
  } catch (e) {
    console.debug("sendPushToUser best-effort error:", e);
  }
}

// `replyTo` is what makes support work without an inbound mail pipeline: the
// alert we send to staff carries the customer's address, so hitting reply in a
// normal inbox writes to the customer, and the reply we send the customer
// carries the support address, so hitting reply writes back to staff. Both sides
// can hold a conversation with nothing but their own email client.
export async function sendEmail(to: string, subject: string, html: string, replyTo?: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Email not configured (RESEND_API_KEY missing)");
  const from = process.env.EMAIL_FROM || "HumanCrush <notifications@humancrush.com>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`Email error: ${res.status} ${(await res.text()).slice(0, 150)}`);
}

// Quotes and angle brackets inside an href close the attribute and let the rest
// of the value become markup. Both URLs here are built from an env var and a
// uuid, but they are still interpolated into an attribute in outbound mail.
const attr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Simple branded wrapper for notification emails.
export function notificationEmailHtml(
  title: string,
  body: string,
  url?: string,
  imageUrl?: string,
): string {
  // Her photo is the thing people tap — it is the biggest, most personal element
  // in the mail, and it used to be inert, so the tap did nothing and the CTA
  // underneath was the only way through. It now goes exactly where the button
  // goes. Wrapped rather than made a background so it still renders in clients
  // that strip CSS.
  const picture = imageUrl
    ? `<div style="margin: 20px auto; width: 140px; height: 140px; border-radius: 50%; overflow: hidden; border: 3px solid #ff4d8d; box-shadow: 0 0 15px rgba(255, 77, 141, 0.4);">
        <img src="${attr(imageUrl)}" alt="${attr(title)}" style="width: 100%; height: 100%; object-fit: cover;" />
       </div>`
    : "";

  const modelImage =
    picture && url
      ? `<a href="${attr(url)}" style="text-decoration:none;display:block;">${picture}</a>`
      : picture;

  const cta = url
    ? `<div style="margin-top: 24px;">
        <a href="${attr(url)}" style="display:inline-block;background:linear-gradient(90deg,#ff4d8d,#c04bff);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:999px;box-shadow: 0 4px 12px rgba(255, 77, 141, 0.3);">Open HumanCrush.com</a>
       </div>`
    : "";

  return `<div style="background:#0d0a12;padding:40px 20px;font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;">
    <div style="max-width:440px;margin:auto;background:#171320;border:1px solid #2a2436;border-radius:24px;padding:32px;text-align:center;color:#fff;box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
      <div style="font-size:24px;font-weight:800;background:linear-gradient(90deg,#ff4d8d,#c04bff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;display:inline-block;margin-bottom:8px;">❤ HumanCrush</div>
      ${modelImage}
      <h1 style="font-size:22px;font-weight:700;margin:16px 0 8px;letter-spacing:-0.5px;">${title}</h1>
      <p style="color:#b3aac2;font-size:15px;line-height:1.6;margin:0 0 20px;font-weight:400;">${body}</p>
      ${cta}
    </div>
  </div>`;
}
