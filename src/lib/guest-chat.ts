// Browser side of the chat trial: start a guest (anonymous) session, keep the
// sticky experiment arm and first-touch attribution, and hand the guest token
// to sign-up so the conversation can follow the user into their account.
import { supabase } from "@/integrations/supabase/client";
import { growthConfig, turnstileSiteKey } from "@/config/growth";
import { isAccount } from "./account-user";
import { trialVariant, type TrialStatus } from "./trial";
import { startGuestTrial, trackFunnelEvent } from "./trial.functions";
import { startChat } from "./chat.functions";

const SEED_KEY = "hc_device_seed";
const ATTRIBUTION_KEY = "hc_attribution";

function storage(kind: "local" | "session") {
  try { return kind === "local" ? window.localStorage : window.sessionStorage; } catch { return null; }
}

/** Sticky per-device arm. With experimentSplit 0 this is always "trial". */
export function deviceVariant() {
  const store = storage("local");
  let seed = store?.getItem(SEED_KEY) ?? "";
  if (!seed) {
    seed = crypto.randomUUID();
    store?.setItem(SEED_KEY, seed);
  }
  return trialVariant(seed);
}

/** Guests may chat before an account only on the trial arm. */
export function guestChatAllowed() {
  return growthConfig.chatTrial.enabled && deviceVariant() === "trial";
}

/** First touch wins: the ad that brought them, not the page they clicked last. */
export function attribution(): { utm: Record<string, string> | null; referrer: string | null } {
  const store = storage("session");
  const saved = store?.getItem(ATTRIBUTION_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch { /* fall through and re-read */ }
  }
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"]) {
    const value = params.get(key);
    if (value) utm[key] = value.slice(0, 200);
  }
  const referrer = document.referrer && !document.referrer.startsWith(window.location.origin) ? document.referrer.slice(0, 500) : null;
  const value = { utm: Object.keys(utm).length ? utm : null, referrer };
  store?.setItem(ATTRIBUTION_KEY, JSON.stringify(value));
  return value;
}

type Turnstile = { render: (el: HTMLElement, options: Record<string, unknown>) => string; execute: (id: string) => void; reset: (id: string) => void; remove: (id: string) => void };
let turnstileScript: Promise<Turnstile | null> | null = null;

function loadTurnstile() {
  if (!turnstileSiteKey) return Promise.resolve(null);
  turnstileScript ??= new Promise((resolve) => {
    const existing = (window as unknown as { turnstile?: Turnstile }).turnstile;
    if (existing) return resolve(existing);
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve((window as unknown as { turnstile?: Turnstile }).turnstile ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return turnstileScript;
}

/**
 * A fresh single-use Turnstile token, or undefined when captcha is off (no
 * site key). Managed mode: most visitors never see a challenge.
 */
export async function captchaToken(): Promise<string | undefined> {
  const turnstile = await loadTurnstile();
  if (!turnstile) return undefined;
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;bottom:84px;left:50%;transform:translateX(-50%);z-index:80";
    document.body.appendChild(host);
    let id = "";
    const done = (token?: string) => {
      try { turnstile.remove(id); } catch { /* already gone */ }
      host.remove();
      resolve(token);
    };
    id = turnstile.render(host, { sitekey: turnstileSiteKey, appearance: "interaction-only", callback: (token: string) => done(token), "error-callback": () => done(undefined), "timeout-callback": () => done(undefined) });
    window.setTimeout(() => done(undefined), 20000);
  });
}

export type GuestStart =
  | { ok: true; conversationId: string; status: TrialStatus | null }
  | { ok: false; code: string };

/**
 * Opens a chat for a signed-out visitor: anonymous session, guest trial
 * (server-side caps and captcha), then the ordinary startChat.
 */
export async function startGuestChat(companionId: string): Promise<GuestStart> {
  const { data: current } = await supabase.auth.getSession();
  let created = false;
  if (!current.session) {
    const token = await captchaToken();
    const { error } = await supabase.auth.signInAnonymously(token ? { options: { captchaToken: token } } : undefined);
    if (error) return { ok: false, code: /anonymous/i.test(error.message) ? "ANON_DISABLED" : error.message };
    created = true;
  } else if (isAccount(current.session.user)) {
    const { conversationId } = await startChat({ data: { companionId } });
    return { ok: true, conversationId, status: null };
  }
  const { utm, referrer } = attribution();
  const opened = await startGuestTrial({ data: { captchaToken: await captchaToken(), modelId: companionId, variant: deviceVariant(), utm, referrer } });
  if (!opened.ok) {
    if (created) await supabase.auth.signOut();
    return { ok: false, code: opened.code };
  }
  const { conversationId } = await startChat({ data: { companionId } });
  return { ok: true, conversationId, status: opened.status };
}

/** The guest's access token, captured before sign-up replaces the session. */
export async function guestAccessToken() {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  return user && !isAccount(user) ? data.session!.access_token : undefined;
}

const PENDING_FINISH_KEY = "hc_pending_finish";
type PendingFinish = { guestToken?: string; source: "chat_trial" | "generator" | "direct"; method: "email" | "google" | "apple" | "facebook" | "x" };

export async function rememberPendingFinish(pending: PendingFinish) {
  storage("session")?.setItem(PENDING_FINISH_KEY, JSON.stringify(pending));
}

/**
 * Completes a social sign-in started from the auth form: moves the guest chat
 * and records a new account. A user created in the last ten minutes counts
 * as a new account; an older one simply logged in.
 */
export async function resumePendingFinish() {
  const store = storage("session");
  const raw = store?.getItem(PENDING_FINISH_KEY);
  if (!raw) return;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!isAccount(user)) return;
  store?.removeItem(PENDING_FINISH_KEY);
  try {
    const pending = JSON.parse(raw) as PendingFinish;
    const isNewAccount = Date.now() - new Date(user!.created_at).getTime() < 10 * 60 * 1000;
    const { finishAuth } = await import("./trial.functions");
    await finishAuth({ data: { guestToken: pending.guestToken, isNewAccount, source: pending.guestToken ? "chat_trial" : pending.source, method: pending.method } });
  } catch (error) {
    console.error("[auth] could not finish the social sign-in", error);
  }
}

export function trackWall(event: "email_wall_shown" | "account_wall_shown" | "plans_viewed" | "checkout_started", properties: Record<string, string | number | boolean | null> = {}) {
  void trackFunnelEvent({ data: { event, properties: { ...properties, variant: deviceVariant() } } }).catch(() => undefined);
}
