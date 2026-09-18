// What body a companion actually has, resolved in ONE place.
//
// This existed in six places before this file. selfie.ts derived it four
// separate times (once per prompt builder), prompt-refiner.server.ts had its
// own copy, media.functions.ts had another for the negative prompt, and
// portrait.ts a fifth for clothed shots. They were copy-pasted from each other
// and had drifted, so the same companion could be a woman to the framing
// sentence and a man to the negative prompt in the same render.
//
// Three things were wrong beyond the duplication, all reproduced against the
// live code before this file was written:
//
// 1. THE BYPASS. Every copy tested the USER'S MESSAGE for /trans|futa|shemale|
//    ladyboy|dickgirl/ alongside the companion's gender. So "send me a pic of
//    your dick you futa", typed at an ordinary female companion, set
//    isTransFemale and unlocked a penis render on a woman. The companion's
//    stored gender is the only authority here; what the user types is a
//    request, never a declaration of whose body it is.
//
// 2. TRANS MEN WERE BACKWARDS. genderNoun mapped "trans-male" to "man" and the
//    refiner folded it into isMale, so a trans man rendered as a fully male
//    body with a penis — while checkCrossGenderRequest refused him a request
//    for his own pussy and happily accepted one for a cock he does not have.
//    Exactly inverted.
//
// 3. TRANS WOMEN WERE UNGATED. isTransFemale returned "allow everything", so a
//    trans woman could be asked for a vulva. This app's archetype for her is
//    consistent everywhere else — breasts and an anatomically correct penis —
//    and the render simply cannot honour a request for anatomy the prompt does
//    not describe. It produced a fused, ambiguous groin.
//
// The point of a single resolver is that "never render the wrong genital for a
// gender" becomes a property of one function instead of an agreement between
// six copies that had already stopped agreeing.

/** The five values companions.gender actually holds, plus a short alias. */
export type GenderKind = "female" | "male" | "trans-female" | "trans-male" | "nb";

export type Anatomy = {
  kind: GenderKind;
  /** How to refer to them in prose: "woman", "man", "transgender woman"… */
  noun: string;
  subject: "she" | "he" | "they";
  object: "her" | "him" | "them";
  poss: "her" | "his" | "their";
  refl: "herself" | "himself" | "themselves";
  /**
   * "is" or "are", to agree with `subject`.
   *
   * Here because every builder that wrote `${subject} is already completely
   * naked` produced "They is already completely naked" for a non-binary
   * companion — in the one clause of the prompt that says what the picture is
   * of, to a text encoder that is a language model. Carrying the verb next to
   * the pronoun is the only way it cannot be forgotten at a call site.
   */
  is: "is" | "are";
  /** Third-person singular "s", for verbs like settle(s) and hold(s). */
  s: "s" | "";
  /** Rendered as having breasts, rather than a flat or muscular chest. */
  hasBreasts: boolean;
  hasPenis: boolean;
  hasVulva: boolean;
};

const TABLE: Record<GenderKind, Omit<Anatomy, "kind">> = {
  female: {
    noun: "woman",
    subject: "she",
    object: "her",
    poss: "her",
    refl: "herself",
    is: "is",
    s: "s",
    hasBreasts: true,
    hasPenis: false,
    hasVulva: true,
  },
  male: {
    noun: "man",
    subject: "he",
    object: "him",
    poss: "his",
    refl: "himself",
    is: "is",
    s: "s",
    hasBreasts: false,
    hasPenis: true,
    hasVulva: false,
  },
  // The archetype this app uses everywhere: a woman's face and body with a
  // cock. Stated as one body rather than two halves, because describing them
  // separately is how a render loses one of them.
  "trans-female": {
    noun: "transgender woman",
    subject: "she",
    object: "her",
    poss: "her",
    refl: "herself",
    is: "is",
    s: "s",
    hasBreasts: true,
    hasPenis: true,
    hasVulva: false,
  },
  // The mirror of the above, and the case the old code had inverted: a man's
  // build and chest with a pussy.
  "trans-male": {
    noun: "transgender man",
    subject: "he",
    object: "him",
    poss: "his",
    refl: "himself",
    is: "is",
    s: "s",
    hasBreasts: false,
    hasPenis: false,
    hasVulva: true,
  },
  // Androgynous: nothing is committed to. The flags say what the body HAS, and
  // a non-binary companion's default body has no genital stated at all — the
  // clause below describes a smooth groin and the render follows whatever the
  // request named. That is separate from whether a request is refused, which
  // `refuses` decides; conflating the two was the first attempt and it made the
  // flags mean two different things at once.
  nb: {
    noun: "androgynous person",
    subject: "they",
    object: "them",
    poss: "their",
    refl: "themselves",
    is: "are",
    s: "",
    hasBreasts: false,
    hasPenis: false,
    hasVulva: false,
  },
};

/**
 * The kind a stored gender string means.
 *
 * The column is free text with five intended values, but rows written by older
 * code and by scripts use spellings like "transwoman" and "futa", so those are
 * mapped rather than silently falling through to female.
 */
export function genderKind(gender?: string | null): GenderKind {
  const g = (gender ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (!g) return "female"; // the column's own default
  if (
    g === "trans-female" ||
    g === "transfemale" ||
    g === "transwoman" ||
    g === "trans-woman" ||
    g === "futa" ||
    g === "futanari" ||
    g === "shemale" ||
    g === "ladyboy" ||
    g === "dickgirl"
  )
    return "trans-female";
  if (g === "trans-male" || g === "transmale" || g === "transman" || g === "trans-man")
    return "trans-male";
  if (g === "male" || g === "man") return "male";
  if (g === "non-binary" || g === "nonbinary" || g === "nb" || g === "enby") return "nb";
  return "female";
}

/** Everything the prompt builders need to know about whose body this is. */
export function anatomyOf(gender?: string | null): Anatomy {
  const kind = genderKind(gender);
  return { kind, ...TABLE[kind] };
}

// ── What the renderer is told is there ──────────────────────────────────────
//
// Short, strictly positive descriptions only.
// The text encoder cannot represent negation. Any "without sag", "no pox",
// "zero sag" etc. puts the bad tokens into the positive conditioning.
//
// These strings are now appended after the refiner finishes (in finishMediaPrompt),
// so they land verbatim every time and no longer compete for Grok's word budget.

const NUDE_ANATOMY: Record<GenderKind, string> = {
  female:
    "natural firm high-set round breasts set high on the chest, projected forward and lifted, holding their full tight round shape against gravity in every pose, taut smooth skin, full rounded lower poles, nipples level with the middle of the upper arms pointing straight forward, small smooth defined areolae and naturally erect nipples with clean realistic texture, smoothly shaved plump closed pussy as a soft rounded mound with a single neat vertical crease, everything fully closed and tucked so only the crease shows, skin one even tone with the inner thighs, faint natural sheen, firm high perfectly round ass with smooth even skin texture",
  male: "lean athletic muscular chest and defined abs, thick erect penis standing out from the body and angled slightly upward about as long as the hand from wrist to fingertip, clearly defined shaft with soft realistic veining, distinct coronal ridge meeting the smooth rounded glans, natural firm testicles in a separate lightly textured scrotum, each part cleanly distinguishable",
  "trans-female":
    "natural firm high-set round breasts set high on the chest, projected forward and lifted, holding their full tight round shape against gravity, taut smooth skin, full rounded lower poles, defined areolae and naturally erect nipples with clean realistic texture, feminine hips and waist, thick erect penis standing out and angled slightly upward about as long as the hand from wrist to fingertip, defined shaft with soft veining, distinct ridge below the smooth rounded glans, natural testicles in a separate sac, both breasts and cock in frame and in focus, firm high perfectly round ass with smooth even skin texture",
  "trans-male":
    "flat masculine chest with flat dark nipples and faint pale scars beneath each pectoral, broad ribcage and lean stomach, smoothly shaved plump closed pussy as a soft rounded mound with a single neat vertical crease, everything fully closed and tucked so only the crease shows, firm high perfectly round ass with smooth even skin texture",
  nb: "lean androgynous body, flat soft chest, narrow hips, smooth groin, firm high perfectly round ass with smooth even skin texture, skin evenly lit with visible pores",
};

/** The anatomy clause for a nude render of this companion. */
export function nudeAnatomy(gender?: string | null): string {
  return NUDE_ANATOMY[genderKind(gender)];
}

// Suppressing the anatomy this companion does NOT have.
//
// This is the half of the pair that can carry a forbidden noun, because a
// negative prompt is what a renderer subtracts. It is also why the positive
// clause above never needs to.
//
// Only list a part the companion genuinely lacks.
// Never list a part they DO have.
const CROSS_SEX_NEGATIVE: Record<GenderKind, string> = {
  female:
    "penis, cock, erect cock, testicles, scrotum, male genitalia, bulge, male chest, muscular male torso, male arms, hairy legs, beard, mustache, male body, male pelvis, masculine groin, masculine thighs",
  male: "vulva, vagina, labia, female genitalia, breasts, cleavage, feminine bust, feminine hips",
  "trans-female":
    "vulva, vagina, labia, female genitalia, beard, mustache, stubble, male chest, muscular male torso, masculine jaw, male body",
  "trans-male":
    "penis, cock, erect cock, testicles, scrotum, bulge, breasts, cleavage, feminine bust",
  nb: "",
};

/** Negative-prompt terms for the anatomy this companion does not have. */
export function crossSexNegative(gender?: string | null): string {
  return CROSS_SEX_NEGATIVE[genderKind(gender)];
}

// ── The parts a request can ask for ─────────────────────────────────────────

const PART_TERMS = {
  penis: String.raw`dicks?|cocks?|penis|penises|balls|testicles?|ballsack|scrotum|shafts?|boners?|hard[- ]?ons?|erections?|schlongs?|dongs?|manhood|pricks?|willy|pecker|phallus|bulge|cum ?shot|jerk\w* off|jack\w* off`,
  vulva: String.raw`pussy|pussies|vagina|vaginas|vulvas?|clit|clitoris|labia|cunts?|snatch|coochie|cooch|camel ?toe|muff|beaver|front hole`,
  breasts: String.raw`tits|titties|boobs|boobies|breasts?|nipples?|areolas?|cleavage|rack|knockers|jugs|hooters|funbags|ta-tas`,
  ass: String.raw`ass|asses|arse|asshole|arsehole|butthole|butt|buttocks|booty|bum|derriere|anus|rear end|backside`,
} as const;

export type BodyPart = keyof typeof PART_TERMS;

const OWNED = String.raw`\b(?:your|ur|yours)\b[^.?!]{0,28}?`;
const ASKED = String.raw`\b(?:send|show|snap|take|post|share|gimme|give|see|seeing|want|wanna)\b[^.?!]{0,28}?`;

function asksFor(prompt: string, part: BodyPart): boolean {
  const terms = PART_TERMS[part];
  const owned = new RegExp(`${OWNED}\\b(?:${terms})\\b`, "i");
  const asked = new RegExp(`${ASKED}\\b(?:${terms})\\b`, "i");
  return owned.test(prompt) || asked.test(prompt);
}

export function mentionsPart(prompt: string, part: BodyPart): boolean {
  return new RegExp(`\\b(?:${PART_TERMS[part]})\\b`, "i").test(prompt ?? "");
}

export function requestedParts(prompt: string): BodyPart[] {
  const p = prompt ?? "";
  return (Object.keys(PART_TERMS) as BodyPart[]).filter((part) => asksFor(p, part));
}

const REFUSALS: Record<GenderKind, string> = {
  female: "No silly, I'm a girl! 😅 I can only send pics of my own body.",
  male: "Ha, wrong body babe 😅 I'm a guy — I can only send pics of what I've actually got.",
  "trans-female":
    "Mmm not quite babe 😏 I'm a trans girl — you get my tits AND my cock, but that's what I've got for you.",
  "trans-male":
    "Cheeky 😏 I'm a trans guy — flat chest, and what's between my legs is all mine. Ask me for that instead.",
  nb: "",
};

export function refuseWrongAnatomy(
  gender: string | null | undefined,
  prompt: string,
): string | null {
  const a = anatomyOf(gender);

  if (a.kind === "nb") return null;

  const has: Record<BodyPart, boolean> = {
    penis: a.hasPenis,
    vulva: a.hasVulva,
    breasts: a.hasBreasts,
    ass: true,
  };
  const missing = requestedParts(prompt ?? "").filter((part) => !has[part]);
  return missing.length ? REFUSALS[a.kind] || null : null;
}
