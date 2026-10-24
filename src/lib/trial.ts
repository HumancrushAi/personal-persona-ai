// Chat trial ladder: pure rules shared by the server (which enforces them) and
// the client (which only displays them). Nothing here trusts client input.
import { CHAT_COST_PER_MESSAGE, growthConfig, messagesLeft } from "@/config/growth";

export type TrialStage = "guest" | "email" | "account";
export type TrialBlock = "TRIAL_EMAIL_REQUIRED" | "TRIAL_ACCOUNT_REQUIRED";
export type TrialStatus = { stage: TrialStage; messagesLeft: number | null };

const { guestCredits, emailCredits } = growthConfig.chatTrial;

/** Total credits a stage may spend, counted from the start of the trial. */
export function allowanceFor(stage: Exclude<TrialStage, "account">) {
  return stage === "email" ? guestCredits + emailCredits : guestCredits;
}

/**
 * Whether a message of `cost` fits in what this stage has left. The server
 * repeats this check atomically in SQL (consume_trial_credit); this copy
 * decides which wall to show and is what the unit tests pin down.
 */
export function evaluateTrial(stage: Exclude<TrialStage, "account">, creditsUsed: number, cost = CHAT_COST_PER_MESSAGE):
  | { ok: true; remainingAfter: number }
  | { ok: false; code: TrialBlock } {
  const remaining = allowanceFor(stage) - creditsUsed;
  if (remaining >= cost) return { ok: true, remainingAfter: remaining - cost };
  return { ok: false, code: stage === "guest" ? "TRIAL_EMAIL_REQUIRED" : "TRIAL_ACCOUNT_REQUIRED" };
}

export function trialStatus(stage: Exclude<TrialStage, "account">, creditsUsed: number): TrialStatus {
  return { stage, messagesLeft: messagesLeft(Math.max(0, allowanceFor(stage) - creditsUsed)) };
}

/**
 * Sexual or explicit requests a Social-mode guest is not allowed to steer
 * into. Deliberately broad: a false positive costs the guest nothing (the
 * deflection is free and points at sign-up), a miss is caught by the Social
 * system prompt and the reply screen.
 */
const EXPLICIT_RE =
  /\b(sex|sexy\s+(?:pic|photo|selfie)|nude|nudes|naked|nsfw|porn|horny|cum|cumming|orgasm|masturbat\w*|jerk(?:ing)?\s+off|blow\s?job|handjob|cock|dick|penis|pussy|vagina|clit|tits|titties|boobs?|nipples?|ass(?:hole)?|anal|fuck\w*|suck\s+(?:my|your)|ride\s+(?:me|my|you)|strip(?:\s+for)?|undress|take\s+(?:it|everything|your\s+\w+)\s+off|lingerie\s+off|topless|bottomless|dirty\s+talk|talk\s+dirty|sext\w*|kinky|bdsm|spank\w*|wet\s+for\s+(?:you|me)|69|threesome|creampie|deepthroat|squirt\w*)\b/i;

export function isExplicitRequest(text: string) {
  return EXPLICIT_RE.test(text);
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Common throwaway-inbox domains; the server and a DB trigger hold the same list. */
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "sharklasers.com",
  "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io",
  "tempmail.net", "tempmailo.com", "throwawaymail.com", "yopmail.com", "yopmail.net",
  "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "mailnesia.com",
  "trashmail.com", "trashmail.de", "fakeinbox.com", "mintemail.com", "mohmal.com",
  "emailondeck.com", "spamgourmet.com", "mytemp.email", "tempinbox.com", "burnermail.io",
  "moakt.com", "tmail.ws", "tmpmail.org", "tmpmail.net", "fakemail.net",
  "emailfake.com", "crazymailing.com", "mailcatch.com", "inboxkitten.com", "1secmail.com",
  "1secmail.net", "1secmail.org", "mail.tm", "mail.gw", "discard.email",
  "spambox.us", "mailpoof.com", "linshiyouxiang.net", "tempr.email", "dropmail.me",
  "harakirimail.com", "mailforspam.com", "spam4.me", "33mail.com", "anonaddy.me",
  "mailsac.com", "mvrht.net", "emltmp.com", "tempmail.plus", "minuteinbox.com",
]);

export function isDisposableEmail(email: string) {
  if (!growthConfig.auth.blockDisposableEmails) return false;
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return DISPOSABLE_DOMAINS.has(domain);
}

/** E.164: a plus, a non-zero country digit, 8 to 15 digits in all. */
export function isE164(phone: string) {
  return /^\+[1-9]\d{7,14}$/.test(phone.trim());
}

/**
 * Sticky experiment arm from a per-device seed. With experimentSplit 0 every
 * device gets the trial; with 0.5 half of them get the old account-first flow.
 */
export function trialVariant(seed: string, split: number = growthConfig.chatTrial.experimentSplit): "trial" | "control" {
  if (!growthConfig.chatTrial.enabled) return "control";
  if (split <= 0) return "trial";
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 1000) / 1000 < split ? "control" : "trial";
}
