/**
 * Server-side policy for Social renders.
 *
 * Keep the explicit-term vocabulary here rather than scattering it through
 * prompt builders. The same policy is used to classify a request, sanitize a
 * prompt, and describe the renderer's negative conditioning.
 */

export const SOCIAL_EXPLICIT_TERMS = [
  "nude", "nudes", "naked", "nakie", "nekkid", "unclothed", "undress", "strip",
  "topless", "bottomless", "bare", "exposed", "full frontal", "birthday suit",
  "in the buff", "tit", "tits", "titties", "boob", "boobs", "boobies", "breast",
  "breasts", "nipple", "nipples", "areola", "areolas", "cleavage", "rack",
  "knockers", "melons", "jugs", "pussy", "vagina", "vulva", "clit", "clitoris",
  "labia", "cunt", "snatch", "coochie", "slit", "genital", "genitals", "crotch",
  "dick", "cock", "penis", "balls", "testicle", "testicles", "asshole", "butthole",
  "anus", "fuck", "sex", "penetrat", "insert", "masturbat", "finger", "lick",
  "suck", "blow job", "oral", "anal", "creampie", "cum", "orgasm", "squirt",
] as const;

const SOCIAL_EXPLICIT_SOURCE =
  "\\b(?:" +
  SOCIAL_EXPLICIT_TERMS
    .map((term) => term.replace(/[.*+?^${}()|[\[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"))
    .join("|") +
  ")\\b";

export const SOCIAL_EXPLICIT_PATTERN = new RegExp(SOCIAL_EXPLICIT_SOURCE, "i");

export const SOCIAL_SAFETY_NEGATIVE =
  "nude, naked, fully nude, completely nude, no clothes, no underwear, bare breasts, visible nipples, exposed genitals, exposed groin, transparent clothing, see-through fabric, wardrobe removal, explicit nudity, pornographic pose";

export const SOCIAL_BLOCK_MESSAGE =
  "This render was blocked because it didn't fit Social mode. Your credits were refunded.";

// Compatibility marker for installations that have not applied the optional
// media_jobs.content_mode migration yet. It is written only by server code and
// is never sent to a provider prompt.
export const CONTENT_MODE_MARKER = "[[hc-content-mode:social]]";

export function markContentMode(prompt: string, mode: "social" | "adult"): string {
  return mode === "social" ? `${CONTENT_MODE_MARKER}\n${prompt}` : prompt;
}

export function stripContentModeMarker(prompt: string | null | undefined): string {
  const text = prompt ?? "";
  return text.startsWith(CONTENT_MODE_MARKER) ? text.slice(CONTENT_MODE_MARKER.length).replace(/^\s+/, "") : text;
}

export function contentModeFromPrompt(prompt: string | null | undefined): "social" | "adult" {
  const text = (prompt ?? "").trim();
  if (text.startsWith(CONTENT_MODE_MARKER)) return "social";
  try {
    const parsed = JSON.parse(text) as { contentMode?: string };
    if (parsed.contentMode === "social") return "social";
  } catch {
    /* regular provider prompt */
  }
  return "adult";
}

/** Chosen conservatively: sexual content is blocked before it can reach users. */
export const SOCIAL_MODERATION_THRESHOLDS = {
  // Social mode must reject visible nudity as well as explicit acts. The
  // moderation API's `sexual` score is the available image-safety signal, so
  // use a conservative threshold and keep the prompt guard as a second line
  // of defence. This intentionally favours a refund/retry over returning a
  // nude result to a social-mode user.
  sexual: 0.2,
  sexualMinors: 0.02,
} as const;

export function socialExplicitPattern(flags = "gi"): RegExp {
  return new RegExp(SOCIAL_EXPLICIT_SOURCE, flags);
}

export function stripSocialExplicitTerms(text: string): string {
  return text.replace(socialExplicitPattern("gi"), "");
}

export function hasSocialExplicitTerms(text: string): boolean {
  return SOCIAL_EXPLICIT_PATTERN.test(text);
}
