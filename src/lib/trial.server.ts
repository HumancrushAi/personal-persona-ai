// Server-side chat trial store. Every function takes the service-role client
// as an argument, so tests can drive them with a fake.
import { CHAT_COST_PER_MESSAGE, growthConfig } from "@/config/growth";
import { allowanceFor, evaluateTrial, isDisposableEmail, isValidEmail, trialStatus, type TrialBlock, type TrialStatus } from "./trial";

type Db = any;
export type TrialRow = { user_id: string; stage: "guest" | "email"; credits_used: number; captured_email: string | null; variant: string; model_id: string | null; utm: Record<string, string> | null; referrer: string | null; linked_user_id: string | null };

export async function getTrial(db: Db, userId: string): Promise<TrialRow | null> {
  const { data } = await db.from("guest_trials").select("user_id, stage, credits_used, captured_email, variant, model_id, utm, referrer, linked_user_id").eq("user_id", userId).maybeSingle();
  return (data as TrialRow | null) ?? null;
}

export function statusOf(row: TrialRow | null): TrialStatus {
  return row ? trialStatus(row.stage, row.credits_used) : trialStatus("guest", 0);
}

/**
 * Opens a guest session for a freshly signed-in anonymous user, after the
 * abuse caps. Returns the existing row when the same anonymous user asks
 * again (a reload), so the caps only count genuinely new guests.
 */
export async function openGuestTrial(
  db: Db,
  input: { userId: string; ipHash: string; deviceHash: string; variant: string; modelId?: string | null; utm?: Record<string, string> | null; referrer?: string | null; now?: Date },
): Promise<{ ok: true; row: TrialRow; created: boolean } | { ok: false; code: "TRIAL_LIMIT_IP" | "TRIAL_LIMIT_DEVICE" }> {
  const existing = await getTrial(db, input.userId);
  if (existing) return { ok: true, row: existing, created: false };
  const { maxGuestSessionsPerIpPerDay, maxGuestSessionsPerDevice } = growthConfig.chatTrial;
  const since = new Date((input.now ?? new Date()).getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { count: ipCount } = await db.from("guest_trials").select("user_id", { count: "exact", head: true }).eq("ip_hash", input.ipHash).gte("created_at", since);
  if ((ipCount ?? 0) >= maxGuestSessionsPerIpPerDay) return { ok: false, code: "TRIAL_LIMIT_IP" };
  const { count: deviceCount } = await db.from("guest_trials").select("user_id", { count: "exact", head: true }).eq("device_hash", input.deviceHash);
  if ((deviceCount ?? 0) >= maxGuestSessionsPerDevice) return { ok: false, code: "TRIAL_LIMIT_DEVICE" };
  const row = { user_id: input.userId, stage: "guest", credits_used: 0, ip_hash: input.ipHash, device_hash: input.deviceHash, variant: input.variant, model_id: input.modelId ?? null, utm: input.utm ?? null, referrer: input.referrer ?? null };
  const { error } = await db.from("guest_trials").insert(row);
  if (error) throw error;
  return { ok: true, row: { ...row, captured_email: null, linked_user_id: null } as TrialRow, created: true };
}

/**
 * Spends one message from the trial, atomically. The SQL function re-checks
 * the allowance inside the UPDATE, so parallel sends cannot overspend.
 */
export async function reserveTrialMessage(db: Db, userId: string, cost = CHAT_COST_PER_MESSAGE): Promise<{ ok: true; status: TrialStatus } | { ok: false; code: TrialBlock | "TRIAL_MISSING"; status: TrialStatus }> {
  const row = await getTrial(db, userId);
  if (!row) return { ok: false, code: "TRIAL_MISSING", status: statusOf(null) };
  const verdict = evaluateTrial(row.stage, row.credits_used, cost);
  if (!verdict.ok) return { ok: false, code: verdict.code, status: statusOf(row) };
  const { data, error } = await db.rpc("consume_trial_credit", {
    p_user: userId,
    p_cost: cost,
    p_guest_allowance: allowanceFor("guest"),
    p_email_allowance: growthConfig.chatTrial.emailCredits,
  });
  if (error) throw error;
  if (data === null || data === undefined) {
    // Lost a race with a parallel send: re-read to say which wall applies.
    const fresh = await getTrial(db, userId);
    const code = fresh?.stage === "email" ? "TRIAL_ACCOUNT_REQUIRED" : "TRIAL_EMAIL_REQUIRED";
    return { ok: false, code, status: statusOf(fresh) };
  }
  return { ok: true, status: trialStatus(row.stage, Number(data)) };
}

export async function refundTrialMessage(db: Db, userId: string, cost = CHAT_COST_PER_MESSAGE) {
  try {
    await db.rpc("refund_trial_credit", { p_user: userId, p_cost: cost });
  } catch (error) {
    console.error("[trial] refund failed", error);
  }
}

export type CaptureResult =
  | { ok: true; status: TrialStatus; email: string }
  | { ok: false; code: "INVALID_EMAIL" | "DISPOSABLE_EMAIL" | "EMAIL_ALREADY_USED" | "TRIAL_MISSING" | "ALREADY_CAPTURED" };

/**
 * Stage 2: one grant per email address, ever. The unique index on leads is
 * the real guard; the lookup first only turns the race into a clean message.
 */
export async function captureTrialEmail(
  db: Db,
  input: { userId: string; email: string; marketingConsent: boolean; modelId?: string | null; utm?: Record<string, string> | null; referrer?: string | null; now?: Date },
): Promise<CaptureResult> {
  const email = input.email.trim().toLowerCase();
  if (!isValidEmail(email)) return { ok: false, code: "INVALID_EMAIL" };
  if (isDisposableEmail(email)) return { ok: false, code: "DISPOSABLE_EMAIL" };
  const row = await getTrial(db, input.userId);
  if (!row) return { ok: false, code: "TRIAL_MISSING" };
  if (row.stage === "email") return { ok: false, code: "ALREADY_CAPTURED" };
  const { data: prior } = await db.from("leads").select("id").eq("source", "chat_trial").ilike("email", email).maybeSingle();
  if (prior) return { ok: false, code: "EMAIL_ALREADY_USED" };
  const now = (input.now ?? new Date()).toISOString();
  const { error: leadError } = await db.from("leads").insert({
    email,
    guest_session_id: input.userId,
    source: "chat_trial",
    model_id: input.modelId ?? row.model_id,
    marketing_consent: input.marketingConsent,
    marketing_consent_at: input.marketingConsent ? now : null,
    utm: input.utm ?? row.utm,
    referrer: input.referrer ?? row.referrer,
  });
  if (leadError) {
    if (String(leadError.code) === "23505") return { ok: false, code: "EMAIL_ALREADY_USED" };
    throw leadError;
  }
  const { error } = await db.from("guest_trials").update({ stage: "email", captured_email: email, updated_at: now }).eq("user_id", input.userId).eq("stage", "guest");
  if (error) throw error;
  return { ok: true, status: trialStatus("email", row.credits_used), email };
}

/**
 * Moves a guest's chats onto the account they just created or logged into.
 * Personalities first (conversations point at them), then conversations and
 * messages; a name or facts she learned during the trial come along too when
 * the account does not already have its own.
 */
export async function migrateGuestToUser(db: Db, guestId: string, userId: string, now = new Date()) {
  if (guestId === userId) return { moved: false };
  for (const table of ["user_personalities", "conversations", "messages"]) {
    const { error } = await db.from(table).update({ user_id: userId }).eq("user_id", guestId);
    if (error) throw error;
  }
  const [{ data: guestProfile }, { data: userProfile }] = await Promise.all([
    db.from("profiles").select("display_name, user_memory").eq("id", guestId).maybeSingle(),
    db.from("profiles").select("display_name, user_memory").eq("id", userId).maybeSingle(),
  ]);
  const carry: Record<string, unknown> = {};
  // A guest profile has no email to seed a name from, so any name on it is one
  // the user actually told her, and beats the account's email-handle default.
  if (guestProfile?.display_name) carry.display_name = guestProfile.display_name;
  if (guestProfile?.user_memory && !userProfile?.user_memory) carry.user_memory = guestProfile.user_memory;
  if (Object.keys(carry).length) await db.from("profiles").update(carry).eq("id", userId);
  await db.from("guest_trials").update({ linked_user_id: userId, converted_at: now.toISOString(), updated_at: now.toISOString() }).eq("user_id", guestId);
  await db.from("leads").update({ user_id: userId }).eq("guest_session_id", guestId);
  return { moved: true };
}
