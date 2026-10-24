/**
 * Growth funnel settings: the chat trial ladder, deferred email verification
 * and owner alerts. Single source of truth for client and server; secrets
 * stay in server env (see .env.example) and are never read here.
 */
export const growthConfig = {
  chatTrial: {
    enabled: true,
    /** Stage 1: no account, no email. */
    guestCredits: 4,
    /** Stage 2: added after email capture (25 total). */
    emailCredits: 21,
    /** Guests and email-stage users are Social-only. */
    guestContentMode: "social" as const,
    maxGuestSessionsPerIpPerDay: 3,
    maxGuestSessionsPerDevice: 1,
    /** 0 = everyone gets the trial. 0.5 = 50/50 sticky split. Keep 0 unless told otherwise. */
    experimentSplit: 0,
  },
  auth: {
    /** Users can use the app before confirming their email. */
    requireEmailVerification: false,
    /** Set true later if free-credit farming appears. */
    requireVerificationForSignupBonus: false,
    /** Active only when the Turnstile keys exist in env; otherwise a no-op. */
    captcha: { provider: "turnstile" as const, enabled: true },
    blockDisposableEmails: true,
  },
  alerts: {
    /** Sent to every channel that has credentials. */
    channels: ["telegram", "email"] as const,
    notifyOn: ["lead_captured", "account_created"] as const,
  },
} as const;

/** What one chat text message costs, in credits (sendChatMessage debits 1). */
export const CHAT_COST_PER_MESSAGE = 1;

/** UI copy counts messages, not credits. */
export function messagesLeft(remainingCredits: number, costPerMessage = CHAT_COST_PER_MESSAGE) {
  return Math.max(0, Math.floor(remainingCredits / costPerMessage));
}

/** The browser half of the Turnstile pair; empty means captcha is off. */
export const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "";
