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
// One clause per kind, and the ONLY place a genital is described.
//
// Every one of these is purely positive. That is not a style preference: the
// renderer's text encoder cannot represent negation, so the old female clause's
// "and no penis" put the token `penis` into the conditioning of every female
// nude and the render came back with a masculine groin. props.ts's header sets
// this out at length. Anything that must not appear is suppressed in
// crossSexNegative below, which is the only place suppression works.
//
// The detail is specific rather than superlative, for the same reason props.ts
// describes a toy by its material and size instead of calling it "correctly
// proportioned". "Anatomically correct" and "highly detailed" are adjectives a
// renderer cannot act on; "a soft rounded mound with a single neat vertical
// crease" names a shape it can actually place.
//
// What the female clause must NOT contain is the words labia, lips, clit or
// clitoris, in any combination. "Outer labia parting around visible inner
// labia" produced a large tongue of tissue extruded from the cleft — the "weird
// thing sticking out" a user sent back. Rewritten to "outer labia meeting along
// a closed cleft, the small clitoral hood at the top", it produced the same
// flap. The lesson is that for a model tuned on explicit imagery those TOKENS
// are the protrusion: every training image tagged with them shows the detail
// pulled open and out, and no adjective beside them ("closed", "tucked")
// outweighs that. So the clause names only the outer shape — a plump closed
// mound with one crease — which is what most real vulvas look like at rest and
// the one description these models render cleanly. The words the user typed
// ("pussy") still reach the prompt through the action sentence.
//
// Breasts got the same treatment for the same reason: "firm" and "perky" are
// outweighed by a pose. Told she is lying flat, the model spreads them
// sideways, so the clause says they hold their round shape in any pose, and
// the builder writes a lying request as propped up on pillows.
//
// No hair, skin or eye colour anywhere: a reference photo of the companion is
// supplied to the renderer and inventing those fights it, which is how a
// brunette came back blonde.
//
// "Firm perky" on its own still came back sagging. Those are adjectives, and
// the model's idea of a bare breast follows whatever gravity is doing in the
// pose. Where the nipple sits is something it can place: level with the middle
// of her upper arm and pointing forward is what a lifted breast looks like, and
// the full rounded lower curve is the part that droops when nobody states it.
// Shaved for the same reason the sub-structures are named: hair is texture laid
// over exactly the edges that have to read, and a clean surface renders them.
const NUDE_ANATOMY: Record<GenderKind, string> = {
  female:
    "Natural firm round bare breasts set high on her chest, firm enough to hold their round shape in any pose and stand up off her chest, full rounded lower curves, taut smooth skin over them, her nipples level with the middle of her upper arms and pointing forward, small defined areolae and erect nipples. Between her parted thighs a smoothly shaved, plump, closed pussy in sharp focus: a soft rounded mound with a single neat vertical crease down its centre, everything tucked inside so only that crease shows, the skin one even tone with her inner thighs, a faint natural sheen.",
  // Pinned the way props.ts pins a toy, and for the same reason: where it is,
  // which way it points, and how big it is against his own body. Sub-structures
  // alone were not enough — a render that knows it needs "a penis" but not
  // where it sits or how long it is produces the small vague nub the user
  // reported. Scale is anchored to his hand because these models have no
  // absolute sense of size but render relative body proportion well; that is
  // the finding props.ts was built on and it transfers directly.
  male: "A lean muscular chest and flat stomach. At his groin, below his navel and above his thighs, a thick erect penis standing out and angled slightly upward from his body, about as long as his hand from wrist to fingertip: a clearly defined shaft, a distinct ridge where the shaft meets the smooth rounded glans, soft veining along the length, and a separate lightly textured scrotum hanging below it. The shaft, the glans and the scrotum each read as their own form with clean edges between them.",
  "trans-female":
    "One body: natural firm round breasts set high on her chest, defined areolae and erect nipples pointing forward, feminine hips and a soft waist, and at her groin, below her navel, a thick erect penis standing out from her body and angled slightly upward, about as long as her hand from wrist to fingertip, with a defined shaft, a distinct ridge below the smooth rounded glans and a separate scrotum below. Breasts above and cock below, both in the same frame and both in sharp focus.",
  "trans-male":
    "A flat masculine chest with flat dark nipples and faint pale scars beneath each pectoral, a broad ribcage and lean stomach. Between his thighs a smoothly shaved, plump, closed pussy: a soft rounded mound with a single neat vertical crease, everything tucked inside so only the crease shows.",
  nb: "A lean androgynous body, a flat soft chest, narrow hips and a smooth groin, skin evenly lit with visible pores and fine texture throughout.",
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
// Two rules learned the hard way. Only list a part the companion genuinely
// lacks — "missing penis" and "penis looking like female genitalia" used to go
// out on every job including female nudes, actively penalising correct anatomy.
// And never list a part they DO have: a negative prompt pushes on its own
// tokens, so "female breasts" in a trans woman's negatives would flatten her.
// Written out per kind rather than derived from the flags. Deriving it was the
// first attempt and it took four branches to express what a table says in five
// lines — and this is precisely the place where clever derivation produced the
// six disagreeing copies in the first place. Each entry should contain every
// part the kind lacks and nothing it has; the test checks exactly that against
// the flags above.
const CROSS_SEX_NEGATIVE: Record<GenderKind, string> = {
  // Has breasts and a vulva. The failure being suppressed was never just an
  // organ appearing — it was legs, hips and a groin that read male on a woman.
  female:
    "penis, cock, erect cock, testicles, scrotum, male genitalia, bulge, male chest, muscular male torso, male arms, hairy legs, beard, mustache, male body, male pelvis, masculine groin, masculine thighs",
  // Has a penis and a male chest.
  male: "vulva, vagina, labia, female genitalia, breasts, cleavage, feminine bust, feminine hips",
  // Has breasts AND a penis, so neither may be listed here. What is suppressed
  // is a vulva and a masculine face and build — she reads as a woman.
  "trans-female":
    "vulva, vagina, labia, female genitalia, beard, mustache, stubble, male chest, muscular male torso, masculine jaw, male body",
  // Has a vulva and a masculine chest, so neither may be listed here.
  "trans-male":
    "penis, cock, erect cock, testicles, scrotum, bulge, breasts, cleavage, feminine bust",
  // Androgynous and permissive: nothing is committed to, so nothing is refused
  // and nothing is suppressed.
  nb: "",
};

/** Negative-prompt terms for the anatomy this companion does not have. */
export function crossSexNegative(gender?: string | null): string {
  return CROSS_SEX_NEGATIVE[genderKind(gender)];
}

// ── The parts a request can ask for ─────────────────────────────────────────
//
// Deliberately NOT the KW table in selfie.ts. That one is tuned to decide
// whether a picture should be nude at all, so it casts wide and includes
// "cat", "box", "pie", "peach", "cherry", "pink" and "hole" as words for a
// vulva. Wide is right for "should this be explicit"; it is catastrophic for
// "should I refuse this", where a false positive tells a paying user their
// companion will not send a photo because they mentioned a peach.
//
// So this list is short and unambiguous: only words that can only mean the part.
// Both halves matter: a word missing here is a wrong-anatomy render that gets
// billed, and the old two-line version missed almost all the slang — cocks,
// dicks, boner, schlong, dong, manhood, prick, pussies, cunt, snatch, coochie,
// slit, muff, titties, boobies, knockers and jugs all sailed through it.
//
// Deliberately still narrower than the KW table in selfie.ts. That one decides
// whether a picture should be nude at all, so it casts wide and counts "cat",
// "box", "pie", "peach", "cherry", "pink" and "hole" as words for a vulva.
// Wide is right for "should this be explicit"; it is catastrophic for "should I
// refuse", where a false positive tells a paying customer their companion will
// not send a photo because they mentioned a peach. Everything here can only
// mean the part — the genuinely ambiguous ones ("member", "package", "junk",
// "nuts", "knob", "meat", "wood") are left out on purpose.
const PART_TERMS = {
  penis: String.raw`dicks?|cocks?|penis|penises|balls|testicles?|ballsack|scrotum|shafts?|boners?|hard[- ]?ons?|erections?|schlongs?|dongs?|manhood|pricks?|willy|pecker|phallus|bulge|cum ?shot|jerk\w* off|jack\w* off`,
  vulva: String.raw`pussy|pussies|vagina|vaginas|vulvas?|clit|clitoris|labia|cunts?|snatch|coochie|cooch|camel ?toe|muff|beaver|front hole`,
  breasts: String.raw`tits|titties|boobs|boobies|breasts?|nipples?|areolas?|cleavage|rack|knockers|jugs|hooters|funbags|ta-tas`,
} as const;

export type BodyPart = keyof typeof PART_TERMS;

// A request, not a mention.
//
// The old gate matched the bare word anywhere in the message, so "my ex had a
// huge dick lol" — ordinary conversation, sent to a female companion — came
// back "No silly, I'm a girl!". Refusing someone for talking about their own
// life is worse than the failure the gate was written to prevent.
//
// Two shapes count as asking. Either the part is HERS/HIS ("your cock", "your
// big hard cock"), or it is the object of an asking verb ("send me a dick
// pic"). "my ex had a huge dick" is neither: no second-person possessive, and
// "had" is not a request.
const OWNED = String.raw`\b(?:your|ur|yours)\b[^.?!]{0,28}?`;
const ASKED = String.raw`\b(?:send|show|snap|take|post|share|gimme|give|see|seeing|want|wanna)\b[^.?!]{0,28}?`;

function asksFor(prompt: string, part: BodyPart): boolean {
  const terms = PART_TERMS[part];
  const owned = new RegExp(`${OWNED}\\b(?:${terms})\\b`, "i");
  const asked = new RegExp(`${ASKED}\\b(?:${terms})\\b`, "i");
  return owned.test(prompt) || asked.test(prompt);
}

/**
 * Whether the message names a part at all, without the "is it hers" and "is it
 * a request" context requestedParts insists on.
 *
 * requestedParts decides whether to REFUSE a request, where a false positive
 * tells a paying user their companion will not send a photo, so it demands
 * "your pussy" or "send me a pussy pic". Where to put the camera is a different
 * question with a much cheaper mistake, and "pussy pic" or "that pussy of
 * yours" should both point it at the same place. Still off the short
 * unambiguous list rather than selfie.ts's wide one: "peach" must not move a
 * camera.
 */
export function mentionsPart(prompt: string, part: BodyPart): boolean {
  return new RegExp(`\\b(?:${PART_TERMS[part]})\\b`, "i").test(prompt ?? "");
}

/** Which parts this message is actually asking to see. */
export function requestedParts(prompt: string): BodyPart[] {
  const p = prompt ?? "";
  return (Object.keys(PART_TERMS) as BodyPart[]).filter((part) => asksFor(p, part));
}

// What she says when asked for something she does not have.
//
// In character and warm, because this fires mid-flirt and a clinical refusal
// kills the conversation the user is paying for. The trans lines are written as
// a matter-of-fact, confident correction rather than an apology.
const REFUSALS: Record<GenderKind, string> = {
  female: "No silly, I'm a girl! 😅 I can only send pics of my own body.",
  male: "Ha, wrong body babe 😅 I'm a guy — I can only send pics of what I've actually got.",
  "trans-female":
    "Mmm not quite babe 😏 I'm a trans girl — you get my tits AND my cock, but that's what I've got for you.",
  "trans-male":
    "Cheeky 😏 I'm a trans guy — flat chest, and what's between my legs is all mine. Ask me for that instead.",
  nb: "",
};

/**
 * The in-character refusal when a request names anatomy this companion does not
 * have, or null when there is nothing to refuse.
 *
 * Only the companion's stored gender decides this. The old version also read
 * the user's message for "trans", "futa" and friends and unlocked everything
 * when it found them, so typing "you futa" at any woman got you a penis render.
 */
export function refuseWrongAnatomy(
  gender: string | null | undefined,
  prompt: string,
): string | null {
  const a = anatomyOf(gender);

  // A non-binary companion is the one kind with no anatomy to be wrong about,
  // so there is nothing to refuse and the render follows the request. Stated
  // here rather than smuggled in as an empty refusal string, because "nothing
  // is refused" is a decision and should read like one.
  if (a.kind === "nb") return null;

  const has: Record<BodyPart, boolean> = {
    penis: a.hasPenis,
    vulva: a.hasVulva,
    breasts: a.hasBreasts,
  };
  const missing = requestedParts(prompt ?? "").filter((part) => !has[part]);
  return missing.length ? REFUSALS[a.kind] || null : null;
}
