import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { growthConfig } from "@/config/growth";
import { isE164 } from "./trial";

const utmSchema = z.record(z.string().max(40), z.string().max(200)).nullish();

function isGuest(context: { claims?: Record<string, unknown> }) {
  return context.claims?.is_anonymous === true;
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
}

function facts() {
  return import("./growth.server").then(({ requestFacts }) => requestFacts(getRequest()?.headers ?? new Headers()));
}

/** Stage 1: opened right after the browser signs in anonymously. */
export const startGuestTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      captchaToken: z.string().max(4096).optional(),
      modelId: z.string().uuid().optional(),
      variant: z.enum(["trial", "control"]).default("trial"),
      utm: utmSchema,
      referrer: z.string().max(500).nullish(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!growthConfig.chatTrial.enabled) return { ok: false as const, code: "TRIAL_DISABLED" as const };
    if (!isGuest(context)) return { ok: false as const, code: "NOT_A_GUEST" as const };
    const { verifyCaptcha, trackServerEvent } = await import("./growth.server");
    const { openGuestTrial, statusOf } = await import("./trial.server");
    const request = await facts();
    if (!(await verifyCaptcha(data.captchaToken, request.ip))) return { ok: false as const, code: "CAPTCHA_FAILED" as const };
    const db = await admin();
    const opened = await openGuestTrial(db, {
      userId: context.userId,
      ipHash: request.ipHash,
      deviceHash: request.deviceHash,
      variant: data.variant,
      modelId: data.modelId ?? null,
      utm: data.utm ?? null,
      referrer: data.referrer ?? null,
    });
    if (!opened.ok) return { ok: false as const, code: opened.code };
    if (opened.created) {
      await trackServerEvent(db, "trial_variant_assigned", { guestId: context.userId }, { variant: data.variant });
      await trackServerEvent(db, "guest_chat_started", { guestId: context.userId }, { model_id: data.modelId ?? null, variant: data.variant });
    }
    return { ok: true as const, status: statusOf(opened.row) };
  });

/** Messages left for a guest; null for a real account (stage 3 has no trial counter). */
export const getTrialStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!isGuest(context)) return { stage: "account" as const, messagesLeft: null };
    const { getTrial, statusOf } = await import("./trial.server");
    return statusOf(await getTrial(await admin(), context.userId));
  });

/** Stage 2: inline email card. No verification email at this stage. */
export const submitTrialEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      email: z.string().max(320),
      marketingConsent: z.boolean().default(false),
      captchaToken: z.string().max(4096).optional(),
      modelId: z.string().uuid().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!isGuest(context)) return { ok: false as const, code: "NOT_A_GUEST" as const };
    const { verifyCaptcha, trackServerEvent, sendOwnerAlert } = await import("./growth.server");
    const { captureTrialEmail, getTrial } = await import("./trial.server");
    const request = await facts();
    if (!(await verifyCaptcha(data.captchaToken, request.ip))) return { ok: false as const, code: "CAPTCHA_FAILED" as const };
    const db = await admin();
    const result = await captureTrialEmail(db, { userId: context.userId, email: data.email, marketingConsent: data.marketingConsent, modelId: data.modelId ?? null });
    if (!result.ok) return result;
    const trial = await getTrial(db, context.userId);
    const modelId = data.modelId ?? trial?.model_id ?? null;
    const { data: model } = modelId ? await db.from("companions").select("name").eq("id", modelId).maybeSingle() : { data: null };
    await trackServerEvent(db, "email_captured", { guestId: context.userId }, { model_id: modelId, marketing_consent: data.marketingConsent, variant: trial?.variant });
    await sendOwnerAlert("lead_captured", {
      email: result.email,
      source: "chat_trial",
      model: model?.name ?? null,
      stage: "email",
      referrer: trial?.referrer ?? null,
      utm: trial?.utm ?? null,
      country: request.country,
    });
    return result;
  });

const CLIENT_EVENTS = ["email_wall_shown", "account_wall_shown", "plans_viewed", "checkout_started"] as const;

/**
 * The few funnel steps only the browser sees (a wall rendered, the plans
 * opened). Anything involving credits or accounts is recorded server-side
 * where it happens, so ad blockers cannot hide it.
 */
export const trackFunnelEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ event: z.enum(CLIENT_EVENTS), properties: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).default({}) }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const token = getRequest()?.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    let userId: string | null = null;
    let guestId: string | null = null;
    if (token) {
      const { data: auth } = await db.auth.getUser(token);
      if (auth?.user) {
        if ((auth.user as { is_anonymous?: boolean }).is_anonymous) guestId = auth.user.id;
        else userId = auth.user.id;
      }
    }
    const { trackServerEvent } = await import("./growth.server");
    await trackServerEvent(db, data.event, { userId, guestId }, data.properties);
    return { ok: true };
  });

/**
 * Runs once the browser holds a real session after sign-up or log-in. Moves
 * the guest conversation over (when the guest token proves it was theirs),
 * stores optional phone consent, and on a new account fires account_created.
 */
export const finishAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      guestToken: z.string().max(8192).optional(),
      isNewAccount: z.boolean(),
      source: z.enum(["chat_trial", "generator", "direct"]).default("direct"),
      method: z.enum(["email", "google", "apple", "facebook", "x"]).default("email"),
      phone: z.string().max(20).optional(),
      smsConsent: z.boolean().default(false),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (isGuest(context)) return { ok: false as const, code: "STILL_A_GUEST" as const };
    const db = await admin();
    const userId = context.userId;
    const { migrateGuestToUser, getTrial } = await import("./trial.server");
    const { trackServerEvent, sendOwnerAlert } = await import("./growth.server");

    let guestId: string | null = null;
    if (data.guestToken) {
      const { data: guest } = await db.auth.getUser(data.guestToken);
      if (guest?.user && (guest.user as { is_anonymous?: boolean }).is_anonymous && guest.user.id !== userId) {
        const anonymousId: string = guest.user.id;
        guestId = anonymousId;
        await migrateGuestToUser(db, anonymousId, userId);
      }
    }
    if (!data.isNewAccount) return { ok: true as const, migrated: !!guestId };

    // Once per account, however many times the browser calls this.
    const { data: seen } = await db.from("funnel_events").select("id").eq("event", "account_created").eq("user_id", userId).limit(1).maybeSingle();
    if (seen) return { ok: true as const, migrated: !!guestId };

    const now = new Date().toISOString();
    const phone = data.phone && isE164(data.phone) ? data.phone.trim() : null;
    const profileUpdate: Record<string, unknown> = {};
    if (phone) Object.assign(profileUpdate, { phone, sms_consent: data.smsConsent, sms_consent_at: data.smsConsent ? now : null });
    if (Object.keys(profileUpdate).length) await db.from("profiles").update(profileUpdate).eq("id", userId);
    if (growthConfig.auth.requireVerificationForSignupBonus) {
      // The bonus waits for verification (granted in verify-email).
      await db.from("credit_balances").update({ free_messages_remaining: 0 }).eq("user_id", userId);
    }

    const trial = guestId ? await getTrial(db, guestId) : null;
    const source = trial ? "chat_trial" : data.source;
    const [{ data: profile }, { data: model }] = await Promise.all([
      db.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
      trial?.model_id ? db.from("companions").select("name").eq("id", trial.model_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const email = typeof context.claims?.email === "string" ? context.claims.email : null;
    const request = await facts();
    await trackServerEvent(db, "account_created", { userId, guestId }, { source, method: data.method, variant: trial?.variant ?? null });
    await sendOwnerAlert("account_created", {
      email,
      name: profile?.display_name ?? null,
      phone: phone && data.smsConsent ? phone : null,
      method: data.method,
      source,
      model: model?.name ?? null,
      stage: trial ? (trial.stage === "email" ? "email (stage 2)" : "guest (stage 1)") : "account",
      referrer: trial?.referrer ?? null,
      utm: trial?.utm ?? null,
      country: request.country,
    });

    // Deferred verification: the account works now; the link is a courtesy.
    try {
      const { sendVerificationLink } = await import("./verify-email.server");
      if (email) await sendVerificationLink(userId, email);
    } catch (error) {
      console.error("[verify] could not send the verification email", error);
    }
    return { ok: true as const, migrated: !!guestId };
  });
