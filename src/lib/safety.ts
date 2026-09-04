// Reusable server-side moderation layer.
// Business rule: every persona is an adult (18+). We block any request that
// sexualizes minors or asks for other prohibited/illegal content. This lives
// outside the UI so every entry point (chat, media) enforces the same rules.

export type Screen = { allowed: boolean; reason?: string; category?: string };

// Explicit minor / CSAM indicators.
const MINOR_TERMS = [
  "child",
  "children",
  "childlike",
  "kid",
  "kids",
  "toddler",
  "infant",
  "newborn",
  "baby girl",
  "baby boy",
  "preteen",
  "pre-teen",
  "underage",
  "underaged",
  "under age",
  "minor",
  "little girl",
  "little boy",
  "young girl",
  "young boy",
  "loli",
  "lolita",
  "shota",
  "cp ",
  "child porn",
  "schoolchild",
  "grade schooler",
  // Teen spellings are listed individually: the word-boundary match below means
  // "teen" does not cover "teenage", and must not — otherwise "eighteen" would
  // trip it.
  "teen",
  "teens",
  "teenage",
  "teenaged",
  "teenager",
  "teenagers",
  "adolescent",
  "pubescent",
  "prepubescent",
  "pre-pubescent",
  "juvenile",
  "jailbait",
  // School settings. An adult can legitimately mention their own school days,
  // and blocking that is a false positive we accept: this product cannot afford
  // to be the one that guessed wrong, and the refusal is a polite one line.
  "schoolgirl",
  "school girl",
  "schoolboy",
  "school boy",
  "high school",
  "highschool",
  "middle school",
  "elementary school",
  "grade school",
  "kindergarten",
  "primary school",
  "diaper",
];

// Under-18 age, however it is written.
//
// Three separate shapes, because one regex covering all of them was unreadable
// and kept missing cases:
//   "15 years old", "16yo", "17 y/o", "15-year-old"
//   "aged 15", "age: 16", "age 17"
//   "she is 15", "i'm 16", "turns 17"
// The hyphen matters — "\s*" alone missed every "15-year-old", which is the
// single most common way anyone writes it.
const AGE_SUFFIX = /\b(?:0?[0-9]|1[0-7])[\s-]*(?:years?[\s-]*old|yrs?[\s-]*old|y[\s/.]?o\b|yo\b)/i;
const AGE_PREFIX = /\b(?:aged?|age)\s*[:=]?\s*(?:0?[0-9]|1[0-7])\b/i;
const AGE_COPULA =
  /\b(?:is|was|am|are|'m|'s|turns?|turning|just)\s+(?:0?[0-9]|1[0-7])\b(?!\s*(?:%|percent|inch|cm|kg|lb|minute|second|hour|day|week|month|credit|dollar))/i;

function hasUnderageAge(text: string): boolean {
  return AGE_SUFFIX.test(text) || AGE_PREFIX.test(text) || AGE_COPULA.test(text);
}

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
  if (hasUnderageAge(text)) {
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

// What a user is told when a request is refused for involving a minor.
// One line, no lecture, and it names the rule rather than the person.
export const MINOR_REFUSAL =
  "Sorry — this site is strictly 18+ and every character must be an adult. I can't create or talk about anyone under 18.";

/**
 * Screen a character being created or edited.
 *
 * /create never went through any screening at all: only the numeric age field
 * was bounded (18-60), while name, vibe, outfit, hair and eyes were free text
 * that went straight into the portrait prompt. "Sandy, 18" with a vibe of
 * "schoolgirl who looks 14" passed every check and was rendered.
 *
 * Every free-text field is screened, and the age is re-checked here rather than
 * trusted from the form — the zod bound protects the API, this protects against
 * anything that reaches the prompt by another route.
 */
export function screenCharacterSpec(spec: {
  age?: number | null;
  fields?: (string | null | undefined)[];
}): Screen {
  if (typeof spec.age === "number" && spec.age < 18) {
    return { allowed: false, category: "minor", reason: MINOR_REFUSAL };
  }
  for (const field of spec.fields ?? []) {
    if (!field) continue;
    const screen = screenUserMessage(field);
    if (!screen.allowed) {
      return {
        allowed: false,
        category: screen.category,
        reason: screen.category === "minor" ? MINOR_REFUSAL : screen.reason,
      };
    }
  }
  return { allowed: true };
}
