// The app's own email verification. Supabase auto-confirms every signup once
// "Confirm email" is off, so auth.users.email_confirmed_at stops meaning
// anything; profiles.email_verified_at is set only by this link.
import { timingSafeEqual } from "node:crypto";
import { growthConfig } from "@/config/growth";
import { hashValue, trackServerEvent } from "./growth.server";

type Db = any;
const SIGNUP_BONUS = 25;

export function verificationToken(userId: string, email: string) {
  return hashValue(`verify:${userId}:${email.trim().toLowerCase()}`).slice(0, 40);
}

export function verificationLink(userId: string, email: string, origin = process.env.PUBLIC_SITE_URL || "https://humancrush.com") {
  const url = new URL("/verify-email", origin);
  url.searchParams.set("u", userId);
  url.searchParams.set("t", verificationToken(userId, email));
  return url.toString();
}

export async function sendVerificationLink(userId: string, email: string) {
  const { sendEmail } = await import("./notify");
  const link = verificationLink(userId, email);
  await sendEmail(
    email,
    "Confirm your HumanCrush email",
    `<div style="font:15px/1.6 system-ui,sans-serif;color:#111">
      <p>Confirm this address so you can recover your account if you ever lose your password.</p>
      <p><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#111;color:#fff;text-decoration:none;font-weight:600">Confirm email</a></p>
      <p style="color:#666;font-size:13px">You can already use your account. This only protects it.</p>
    </div>`,
  );
}

/** Checks the link and stamps the profile. Returns false for a bad or stale link. */
export async function confirmVerificationToken(db: Db, userId: string, token: string) {
  const { data: auth } = await db.auth.admin.getUserById(userId);
  const email = auth?.user?.email;
  if (!email) return false;
  const expected = Buffer.from(verificationToken(userId, email));
  const given = Buffer.from(token);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  const { data: profile } = await db.from("profiles").select("email_verified_at").eq("id", userId).maybeSingle();
  if (profile?.email_verified_at) return true;
  await db.from("profiles").update({ email_verified_at: new Date().toISOString() }).eq("id", userId);
  if (growthConfig.auth.requireVerificationForSignupBonus) {
    const { data: wallet } = await db.from("credit_balances").select("free_messages_remaining").eq("user_id", userId).maybeSingle();
    if ((wallet?.free_messages_remaining ?? 0) < SIGNUP_BONUS) {
      await db.from("credit_balances").update({ free_messages_remaining: SIGNUP_BONUS }).eq("user_id", userId);
    }
  }
  await trackServerEvent(db, "email_verified", { userId });
  return true;
}
