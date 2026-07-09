// Reusable server-side moderation layer.
// Business rule: every persona is an adult (18+). We block any request that
// sexualizes minors or asks for other prohibited/illegal content. This lives
// outside the UI so every entry point (chat, media) enforces the same rules.

export type Screen = { allowed: boolean; reason?: string; category?: string };

// Explicit minor / CSAM indicators.
const MINOR_TERMS = [
  "child",
  "children",
  "kid",
  "kids",
  "toddler",
  "infant",
  "baby girl",
  "baby boy",
  "preteen",
  "pre-teen",
  "underage",
  "minor",
  "little girl",
  "little boy",
  "loli",
  "lolita",
  "shota",
  "cp ",
  "child porn",
  "schoolchild",
  "grade schooler",
];

// Under-18 age expressed as a partner/persona age, e.g. "15 years old", "16yo".
const UNDERAGE_AGE = /\b(?:[1-9]|1[0-7])\s*(?:years?\s*old|yrs?\s*old|y\/?o|yo)\b/i;

// Other prohibited categories (mirrors the chat system-prompt refusal list).
const ILLEGAL_TERMS = [
  "bestiality",
  "zoophilia",
  "incest",
  "rape",
  "non-consensual",
  "nonconsensual",
  "non consent",
  "sex trafficking",
];

function hasTerm(haystack: string, terms: string[]): string | null {
  for (const t of terms) {
    // word-ish boundary so "kid" doesn't match "kidney"
    const re = new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
    if (re.test(haystack)) return t.trim();
  }
  return null;
}

export function screenUserMessage(text: string): Screen {
  const s = ` ${text.toLowerCase()} `;

  const minor = hasTerm(s, MINOR_TERMS);
  if (minor) {
    return {
      allowed: false,
      category: "minor",
      reason: "This request involves a minor and cannot be processed.",
    };
  }
  if (UNDERAGE_AGE.test(text)) {
    return { allowed: false, category: "minor", reason: "All characters must be adults (18+)." };
  }
  const illegal = hasTerm(s, ILLEGAL_TERMS);
  if (illegal) {
    return {
      allowed: false,
      category: "prohibited",
      reason: "This request asks for prohibited content.",
    };
  }
  return { allowed: true };
}

// Thrown code the client can detect to show a friendly message.
export const BLOCKED_CONTENT = "BLOCKED_CONTENT";
