// Remembering the person, not the conversation.
//
// conversations.memory already existed and got three things wrong.
//
// It was per-conversation, so switching companion forgot everything — the same
// defect the name fix had to solve, and the user asked for the same answer:
// every one of them should know.
//
// It only ran on every fourth message (newXp % 4 === 0), so three disclosures
// out of four were dropped on the floor. Telling her your job on the wrong turn
// meant she never knew it.
//
// And it appended blindly. "likes football" accumulated a dozen times and then
// pushed the real facts out of the 40-line cap, while "lives in Leeds" and
// "lives in Manchester" sat in the prompt together under a heading that reads
// "do not contradict".
//
// Facts are stored as `key: value` lines rather than free text, which is what
// buys the last two fixes: a second `city:` replaces the first, so correction
// and de-duplication both fall out of the format instead of needing a model
// call to reconcile.

export type Fact = { key: string; value: string };

// Keys that hold exactly one value, so a newer one REPLACES the older. Anything
// not on this list accumulates instead (a person has one hometown but many
// likes).
const SINGLE_VALUE = new Set([
  "name",
  "age",
  "job",
  "work",
  "city",
  "country",
  "hometown",
  "birthday",
  "relationship",
  "partner",
  "kids",
  "pet",
  "pets",
  "car",
  "health",
  "timezone",
]);

// Mood and plans are deliberately NOT storable. The old extractor asked for
// them, so "user is tired" became a permanent fact about someone who was tired
// once, months ago, and she kept asking if they had got some sleep.
const TRANSIENT = new Set(["mood", "feeling", "feelings", "plans", "today", "now", "currently"]);

const MAX_FACTS = 40;
const MAX_VALUE = 120;

const LINE_RE = /^\s*[-•*]?\s*([a-z][a-z ]{1,18}?)\s*:\s*(.+)$/i;

/** Anything that would make a stored fact a legal problem if it were kept. */
function isForbidden(key: string, value: string): boolean {
  if (TRANSIENT.has(key)) return true;
  // A stored "age: 15" would be injected into every future prompt as ground
  // truth. screenUserMessage blocks these upstream, so this is the second lock
  // on the same door rather than the only one.
  if (key === "age") {
    const n = Number((value.match(/\d{1,3}/) ?? [])[0]);
    if (!Number.isFinite(n) || n < 18) return true;
  }
  return /\b(?:child|kid|minor|underage|teen|teenage[rd]?|schoolgirl|schoolboy|toddler|infant|baby|preteen|jailbait)\b/i.test(
    value,
  );
}

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 20);
}

function normalizeValue(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.;]+$/, "")
    .slice(0, MAX_VALUE);
}

/**
 * Read stored memory back into facts.
 *
 * Lines written before this format existed are plain sentences with no key.
 * They are kept under "note" rather than thrown away, so the memory a user has
 * already built up survives the change.
 */
export function parseMemory(text: string | null | undefined): Fact[] {
  const out: Fact[] = [];
  for (const line of (text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = LINE_RE.exec(trimmed);
    if (m) {
      const key = normalizeKey(m[1]);
      const value = normalizeValue(m[2]);
      if (key && value && !isForbidden(key, value)) out.push({ key, value });
    } else {
      const value = normalizeValue(trimmed.replace(/^[-•*]\s*/, ""));
      if (value && !isForbidden("note", value)) out.push({ key: "note", value });
    }
  }
  return out;
}

export function formatMemory(facts: Fact[]): string {
  return facts.map((f) => `- ${f.key}: ${f.value}`).join("\n");
}

const sameValue = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Fold newly learned facts into what is already known.
 *
 * A single-value key overwrites in place, so she corrects herself rather than
 * holding both answers. A multi-value key appends unless the same value is
 * already there. The cap drops the OLDEST multi-value facts first and never
 * drops a single-value one, because who somebody is matters more than the
 * twelfth thing they mentioned liking.
 */
export function mergeFacts(existing: Fact[], incoming: Fact[]): Fact[] {
  const merged = [...existing];

  for (const fact of incoming) {
    const key = normalizeKey(fact.key);
    const value = normalizeValue(fact.value);
    if (!key || !value || isForbidden(key, value)) continue;

    if (SINGLE_VALUE.has(key)) {
      const at = merged.findIndex((f) => f.key === key);
      if (at >= 0) merged[at] = { key, value };
      else merged.push({ key, value });
      continue;
    }

    if (merged.some((f) => f.key === key && sameValue(f.value, value))) continue;
    merged.push({ key, value });
  }

  if (merged.length <= MAX_FACTS) return merged;

  const keep = merged.filter((f) => SINGLE_VALUE.has(f.key));
  const rest = merged.filter((f) => !SINGLE_VALUE.has(f.key));
  return [...keep, ...rest.slice(-(MAX_FACTS - keep.length))];
}

// Self-disclosure, roughly. The extractor costs a model call, and most messages
// in this app carry nothing durable ("mmm", "you're so hot", "keep going"), so
// the call is skipped unless the message could plausibly contain a fact. This
// is the cheap half of replacing the every-fourth-message gate: it runs on more
// of the messages that matter and fewer of the ones that do not.
const DISCLOSURE_RE =
  /\b(?:i'?m|i am|im|i'?ve|i have|i had|my|mine|i live|i work|i study|i like|i love|i hate|i prefer|i drive|i own|call me|born|birthday|i'?ll be|i grew up|i moved|i'?d rather|actually)\b/i;

/** Whether this message is worth spending an extraction call on. */
export function looksFactual(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length < 8 || t.length > 1000) return false;
  return DISCLOSURE_RE.test(t);
}

/**
 * Read the extractor's reply into facts.
 *
 * The model is asked for `key: value` lines and mostly complies, but it also
 * returns "NONE", numbered lists, and the occasional bare sentence, so anything
 * unparseable is discarded rather than stored as junk.
 */
export function parseExtraction(raw: string | null | undefined): Fact[] {
  const text = (raw ?? "").trim();
  if (!text || /^none\b/i.test(text)) return [];

  const facts: Fact[] = [];
  for (const line of text.split("\n")) {
    const cleaned = line.replace(/^\s*\d+[.)]\s*/, "").trim();
    if (!cleaned || /^none\b/i.test(cleaned)) continue;
    const m = LINE_RE.exec(cleaned);
    if (!m) continue;
    const key = normalizeKey(m[1]);
    const value = normalizeValue(m[2]);
    if (key && value && !isForbidden(key, value)) facts.push({ key, value });
  }
  return facts.slice(0, 5);
}
