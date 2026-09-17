// Knowing what to call the user.
//
// profiles.display_name is seeded from the email local part, so every account
// starts with something like "lgtopseller" or "nft.king137" in it. The chat
// prompt fed that straight in and companions opened with "Hey there,
// lgtopseller" — which is worse than using nothing, because it tells the user
// they are talking to a database row.
//
// So the handle is recognised for what it is, she asks once, and the answer is
// stored on the profile where every companion can see it.

/** Words that follow "I'm"/"call me" without being a name. */
const NOT_NAMES = new Set([
  "good",
  "great",
  "fine",
  "ok",
  "okay",
  "alright",
  "well",
  "here",
  "back",
  "sorry",
  "bored",
  "tired",
  "horny",
  "busy",
  "new",
  "not",
  "just",
  "so",
  "very",
  "really",
  "doing",
  "down",
  "up",
  "in",
  "on",
  "at",
  "yes",
  "no",
  "yeah",
  "nah",
  "sure",
  "hi",
  "hey",
  "hello",
  "thanks",
  "thank",
  "lol",
  "haha",
  "nothing",
  "nvm",
  "whatever",
  "single",
  "married",
  "straight",
  "gay",
  "male",
  "female",
  "man",
  "woman",
  "guy",
  "girl",
  "boy",
  "waiting",
  "looking",
  "curious",
  "ready",
  "sad",
  "happy",
  "lonely",
  "drunk",
  "high",
  "home",
  "work",
  "working",
]);

/**
 * Does this look like something a person would say out loud as their name?
 *
 * Only a sanity check on shape — digits, dots and @ never appear in a spoken
 * name. It cannot tell "lgtopseller" from "Dave", because nothing about the
 * string can; that needs the email, which is what hasUsableName is for.
 */
export function isRealName(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (v.length < 2 || v.length > 40) return false;
  if (/[0-9._@+]/.test(v)) return false;
  if (!/^[\p{L}][\p{L}\s'’-]*$/u.test(v)) return false;
  const words = v.toLowerCase().split(/\s+/);
  if (words.some((w) => NOT_NAMES.has(w))) return false;
  return true;
}

/**
 * Is the stored display name actually the handle out of the user's email?
 *
 * Guessing from the string alone does not work — "lgtopseller" is all letters
 * and indistinguishable from a name by shape. Comparing against the address it
 * was seeded from is exact. Dots are ignored because a local part of
 * "nft.king137" is stored as-is but "nft.king" would also be a handle.
 */
export function isEmailHandle(value: string | null | undefined, email?: string | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  const local = (email ?? "").split("@")[0]?.trim().toLowerCase() ?? "";
  if (!v || !local) return false;
  const strip = (x: string) => x.replace(/[._-]/g, "");
  return v === local || strip(v) === strip(local);
}

/**
 * The question the chat actually asks: do we know what to call this person?
 *
 * False means she has not been told a name yet and should ask for one.
 */
export function hasUsableName(
  displayName: string | null | undefined,
  email?: string | null,
): boolean {
  if (!isRealName(displayName)) return false;
  // With no address to compare against there is no way to tell a handle from a
  // name, so the safe answer is that we do not know it. Asking someone their
  // name a second time is a small cost; opening with "Hey there, lgtopseller"
  // is the failure this whole module exists to prevent.
  if (!email) return false;
  return !isEmailHandle(displayName, email);
}

/** Tidy a captured name: trim, collapse spaces, cap the length, title-case. */
function tidy(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/[.!?,;:"']+$/, "")
    .replace(/\s+/g, " ")
    .slice(0, 40);
  if (!isRealName(cleaned)) return null;
  return cleaned
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Pull a name out of what the user just typed.
 *
 * `askedForName` is whether her previous line actually asked. It matters: a
 * bare "Dave" is a name when she just asked what to call him and is anybody's
 * guess otherwise, so the bare form is only accepted in that context. The
 * explicit phrasings are accepted at any point, since "my name is Dave" is
 * never ambiguous.
 */
export function extractName(text: string, askedForName: boolean): string | null {
  const t = (text ?? "").trim();
  if (!t || t.length > 120) return null;

  const patterns = [
    /(?:my\s+name\s*(?:is|'s)|name\s*'?s)\s+([\p{L}][\p{L}\s'’-]{1,39})/iu,
    /(?:call\s+me|they\s+call\s+me)\s+([\p{L}][\p{L}\s'’-]{1,39})/iu,
    /(?:i\s*am|i'm|im)\s+([\p{L}][\p{L}\s'’-]{1,39})/iu,
    /(?:it'?s|this\s+is)\s+([\p{L}][\p{L}\s'’-]{1,39})/iu,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m?.[1]) {
      const name = tidy(m[1]);
      if (name) return name;
    }
  }

  // A bare reply, but only as an answer to the question.
  if (askedForName) {
    const bare = t.replace(/^(?:it'?s|i'?m|im)\s+/i, "");
    if (/^[\p{L}][\p{L}\s'’-]{1,39}$/u.test(bare) && bare.split(/\s+/).length <= 2) {
      return tidy(bare);
    }
  }
  return null;
}

/** Did her last line ask what to call them? */
export function askedForName(assistantText: string | null | undefined): boolean {
  const t = (assistantText ?? "").toLowerCase();
  if (!t.includes("?")) return false;
  return (
    /what(?:'s| is| do i| should i)?\s+(?:your|i)?\s*(?:name|call you)/.test(t) ||
    /who\s+am\s+i\s+talking\s+to/.test(t) ||
    /what\s+do\s+(?:they|people)\s+call\s+you/.test(t) ||
    /tell\s+me\s+your\s+name/.test(t)
  );
}
