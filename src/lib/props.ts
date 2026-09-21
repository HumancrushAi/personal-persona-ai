// Rendering a physical object.
//
// A user asked for a dildo and got back, in their words, a baseball bat: a tan,
// wood-grained cylinder about as long as her arm. That is not a random glitch.
// With no material, no colour and no size in the prompt, the renderer reaches
// for the most common long solid object it has ever seen — and a bat is exactly
// that. The same gap is why props fuse into the hand holding them: a shape with
// no stated edges has nothing to separate it from skin.
//
// "Correct proportions" does not fix it. That is an abstract rule the model has
// no way to act on, the same failure already documented for framing in
// selfie.ts, where "nothing cropped" lost every time to a described composition.
// What works is describing the object the way you would describe a person: what
// it is made of, what colour, how big MEASURED AGAINST HER OWN BODY, and where
// each end of it physically sits.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RULE THIS FILE EXISTS TO ENFORCE: NEVER NEGATE IN THE POSITIVE PROMPT.
// ─────────────────────────────────────────────────────────────────────────────
//
// The version of this file before this one tried to keep the toy off her face
// by saying so, repeatedly: "held low away from her face and mouth", "completely
// away from her face, head, mouth, and upper chest", "NEVER held up near her
// face or chest". Three sentences, and between them the words face, mouth, head
// and chest appeared TWELVE times in a single positive prompt, every one of them
// in the same clause as the toy.
//
// The renderer is conditioned by a T5 text encoder. It has no operator for
// "away from" or "never" — those words carry almost no signal, while the nouns
// beside them carry all of it. Writing "the toy is never near her mouth" is
// writing "toy, mouth" and hoping. What came back was a user screenshot of a
// woman holding a two-foot black cylinder vertically from her crotch to her
// lips. His words: "it looks like she's smoking a bong." The prompt asked for
// that. Every mention of the mouth was an instruction to draw one there.
//
// The same trap is everywhere it was used: "no penis" on a female nude put the
// token `penis` in the conditioning and the render came back with masculine
// legs and a fused groin. "Large does not mean a bat, a club or a pole" summoned
// the exact bat this file was written to kill. "Not a close-up, not cropped"
// produced a headless torso crop.
//
// So: state where the object IS, what it touches, and how much of it you can
// see. Say nothing about where it is not. The objects it must not turn into
// belong in the NEGATIVE prompt (propNegative below), which is the only place a
// renderer can act on them — and even there, only object nouns go in, never a
// body part we want drawn, because the negative prompt repels its own tokens
// too and "cropped head, face cut off" is a request for no head.
//
// Scale is the other half. These models have no absolute sense of size, but they
// render relative body proportion well — so "about as long as her hand" is
// something the renderer can act on and "correct size" is not. Occlusion is
// stronger still: an object stated to be mostly INSIDE her cannot also be two
// feet long and reaching her chin, so the length is bounded by the geometry
// rather than by an adjective.

import { type Anatomy, anatomyOf } from "./anatomy";

/** Toy vocabulary, owned here and re-exported into selfie.ts's KW table. */
export const TOY_VOCAB = String.raw`dildos?|vibrators?|sex\s*toys?|butt\s*plugs?|plugs?|magic wands?|strap[- ]?ons?|anal beads|fleshlights?|silicone cock|fake dick|toy cock|fake cock|toy dick|suction dildo|clit vibrator|bullet vibrator|rabbit vibrator`;

const kw = (src: string) => new RegExp(String.raw`\b(?:${src})\b`, "i");

// Wrong objects the renderer reaches for when a prop is under-specified, and
// the wrong ACTIVITY it reaches for when a cylinder is anywhere near a head.
//
// Object nouns and verbs only. The previous list also carried "object near
// mouth, object near face, object near chest, cylinder held to mouth" — body
// parts we want rendered, listed in the prompt that suppresses things. A
// negative prompt pushes on the tokens it contains, not on the sentence they
// were written into, so those entries were pushing her face out of the picture
// while doing nothing about the toy.
const SHARED_NEGATIVE =
  "baseball bat, cricket bat, club, wooden pole, broom handle, rolling pin, table leg, tree branch, weapon, wood grain, wooden texture, giant novelty prop, oversized prop, cartoon prop, balloon, sausage, melting object, deformed object, object fused to hand, object merging into skin, floating object, duplicated object, extra object, bong, pipe, hookah, vape, bottle, flask, microphone, telescope, smoking, vaping, drinking, blowing";

type Prop = {
  id: string;
  match: RegExp;
  /** Material, colour, shape and a scale anchor against her own body. */
  spec: string;
};

// Order matters: "butt plug" contains "plug", so the specific entries are
// tested before the general ones. The matchers stay inside TOY_VOCAB rather
// than reaching wider — a bare "beads" or "wand" would attach a sex-toy
// description to a necklace or a costume prop.
const PROPS: Prop[] = [
  {
    id: "anal-beads",
    match: kw("anal beads"),
    spec: "The anal beads are one flexible silicone string of separate round beads, each about the size of a marble and graduating in size, with a ring handle at the end. Every bead is individually visible with a clear gap and a clean edge between it and the next.",
  },
  {
    id: "butt-plug",
    match: kw(String.raw`butt\s*plugs?|plugs?`),
    spec: "The butt plug is a small separate solid object: tapered matte silicone in a solid colour, about the size of an egg, with a narrow neck and a flat flared base. Clean defined edges against her skin.",
  },
  {
    id: "wand",
    match: kw("magic wands?"),
    // "head" and "neck" for the toy's own parts, until a test caught it. Both
    // are body parts to a text encoder, which has no idea the sentence is about
    // a vibrator — same class of mistake as naming her mouth to keep the toy
    // away from it. Tip and stem carry the shape without the anatomy.
    spec: "The wand vibrator is a separate solid object: a white or lilac handle about as long as her forearm with a soft rounded silicone tip the size of a plum on the end, a visible narrow stem between tip and handle, and a cable trailing from the base. Clean edges, held in her hand and clearly distinct from it.",
  },
  {
    id: "strap-on",
    match: kw("strap[- ]?ons?"),
    spec: "The strap-on is two distinct parts: a black harness with visible straps and buckles sitting on her hips, and a matte silicone shaft in a solid colour mounted at the front, about as long as her hand from wrist to fingertip and roughly two fingers thick. Harness and shaft read as separate objects, both clearly distinct from her skin.",
  },
  {
    id: "stroker",
    match: kw("fleshlights?"),
    spec: "The stroker is a separate solid object: a matte cylindrical case about the size of a large flashlight, roughly as long as her forearm and as thick as her wrist, with a soft textured silicone opening at one end. Clean edges, clearly distinct from the hand holding it.",
  },
  {
    id: "vibrator",
    match: kw("vibrators?"),
    spec: "The vibrator is a separate solid object: smooth matte silicone in a solid colour, about the length of her palm and roughly a thumb's width, with a rounded tip and a small control button. Clean defined edges, clearly distinct from her fingers.",
  },
  {
    id: "dildo",
    // The default, and the fallback for a bare "sex toy".
    match: kw(
      String.raw`dildos?|sex\s*toys?|silicone cock|fake dick|toy cock|fake cock|toy dick|suction dildo`,
    ),
    // The "clean edges against her skin" half of this used to be here as well,
    // and HAND_CLAUSE says it again a sentence later. Duplication is not free:
    // the whole prompt has a token budget, and on this exact request it was
    // spending the last of it, so the held-pose cue at the very end fell off.
    // Every other prop in this file ends with an edge clause — "Clean edges",
    // "Clean defined edges against her skin". This one did not, and it is the
    // most-requested prop in the product. It came back as a soft pink blob with
    // no boundary against her. "soft rounded tip" did not help either: `soft` is
    // a focus and texture token to the encoder, and it spends itself on the
    // whole object, not on the tip.
    spec: "The dildo is a separate solid object: smooth matte silicone in a solid colour, with a firm rounded tip and a flared base. It is about as long as her hand from wrist to fingertip and roughly two fingers thick — a real body-safe sex toy. Clean defined edges, sharply in focus, clearly distinct from her skin.",
  },
];

// "big dildo" is a legitimate request, and the refiner amplifies it honestly:
// big becomes enormous, enormous becomes the bat. So large is allowed, and then
// bounded by her own body, which is the only ceiling the renderer can act on.
const BIG_RE =
  /\b(?:big|bigger|large|huge|massive|giant|enormous|thick|fat|xl|xxl|monster|9\s*inch|10\s*inch)\b/i;

// The old version of this ended "Large does not mean a bat, a club or a pole."
// — three nouns handed straight to the conditioning, in the one file written to
// stop a bat appearing. The bound is now stated only as a measurement, and the
// bat lives in SHARED_NEGATIVE where it belongs.
const BIG_CLAUSE =
  "It is noticeably large for a sex toy while staying a realistic one: at most as long as her forearm and at most as thick as her wrist.";

// Positive statement of the hand, not a prohibition on fusing. "The object never
// merges into her hand" spends its tokens on `merges into hand`, which is the
// artefact it was meant to prevent.
const HAND_CLAUSE =
  "Her hand closes around it with five separate countable fingers and a clean visible edge between skin and silicone.";

// Whose body the toy is against, stated once, positively.
//
// This used to read "…and no penis — the toy is a separate object, not part of
// her body", which put both `penis` and `part of her body` into a female nude
// prompt. Masculine legs and a fused groin came back. Male anatomy is
// suppressed in crossSexNegative (anatomy.ts), which is where a suppression can
// actually work.
//
// It also used to say "She is a woman", chosen by an isMale flag that counted a
// trans man as male — so he got no vulva assertion at all while the request
// being answered was for a toy inside one.
const vulvaAnatomy = (a: Anatomy) =>
  `${a.subject[0].toUpperCase()}${a.subject.slice(1)} has a natural soft vulva; the toy is a separate manufactured object against ${a.poss} skin.`;

// Where the toy IS. Nothing about where it is not.
//
// Three positive anchors do the work the old prohibitions failed at:
//   1. OCCLUSION — most of the shaft is inside her, so the visible part is short
//      by construction. A two-foot object cannot satisfy this sentence.
//   2. AXIS — it points down along the line between her thighs. The bong render
//      was an orientation failure (a vertical shaft from crotch to chin), and an
//      orientation is fixed by naming the direction, not by banning the wrong one.
//   3. CONTACT — both ends anchored to named body parts: tip inside her, base at
//      her hand, wrist against her inner thigh. An object with both ends pinned
//      low has nowhere to travel.
// Stated as a COUNT, and with no second location.
//
// The render came back with three hands. It was told to: the scene said "her
// hands resting on her thighs" — both of them — and the inserted clause said
// her fingers were on the toy. Two hands there, one hand here, and the render
// resolved the arithmetic the only way it could.
//
// A count is the fix, not a prohibition. "extra hand" in the negative spends
// itself on `hand`, which is the rule this file already follows everywhere
// else. And the second hand is deliberately left unplaced: naming somewhere for
// it to be is how the contradiction started, and the scene has usually put the
// arms somewhere already.
//
// The second hand DOES get a place now. It was left unplaced when the scene
// still had its own competing "hands resting on her thighs"; with that rewritten
// there is nothing to contradict, and leaving it unplaced meant the toy came
// back unheld — it was being described as inserted but nobody was holding it.
//
// The solo statement is here rather than in a negative for the usual reason:
// "another person" in the negative spends itself on `person`.
const TWO_HANDS =
  "Exactly two arms and two hands on her body in this frame: one hand is closed around the base of the toy and holding it, and the other rests on her own stomach. She is alone, the only person in the picture.";

const INSERTED_CLAUSE =
  "The toy is inserted into her, angled downward along the line between her open thighs: most of the shaft is hidden inside her body, with only the flared base showing, her fingers on it and her wrist against her inner thigh. Where it enters, her pussy presses snugly around the silicone, natural moisture glistening at the exact point of entry, in sharp focus.";

// Insertion is a preposition followed by the body part, within a few words —
// not either half on its own. "a dildo in her hand" and "in pussy" differ only
// by what comes after "in", so that is what gets matched. Checking the two
// separately said a toy held in her hand was inserted, and checking only
// "in her/your/my" missed "dildo in pussy", the plainest phrasing there is.
const INSERTED_RE =
  /\b(?:insert\w*|in|into|inside|up|deep|penetrat\w*|stuff\w*|slid\w*|shov\w*|stick\w*|push\w*|ridin?g?|fuck\w*)\b[^.?!]{0,25}\b(?:pussy|pussies|vagina|vulvas?|cunt|slit|clit\w*|labia|snatch|coochie|cooch|vag|hole|rear|booty|cheeks|ass|asshole|anus|butt)\b/i;

function propFor(req: string): Prop | null {
  return PROPS.find((p) => p.match.test(req)) ?? null;
}

/** True when the request names a prop this module has a specification for. */
export function hasProp(req: string): boolean {
  return propFor(req ?? "") !== null;
}

/** True when the request puts that prop inside her, rather than in her hand. */
export function propIsInserted(req: string): boolean {
  const text = (req ?? "").trim();
  return propFor(text) !== null && INSERTED_RE.test(text);
}

/**
 * The prop specification to append to a render prompt.
 *
 * Appended AFTER the refiner, never handed to it — same reason PORTRAIT_FRAMING
 * is appended in characters.functions.ts. Grok is told to describe props well
 * and mostly does, but "mostly" is what produced the bat, and a constraint that
 * depends on the refiner behaving is not a constraint. Returns "" when the
 * request names no prop, so it costs nothing on an ordinary selfie.
 *
 * Order matters as much as content: the renderer weights early tokens hardest,
 * so when the toy is inserted the PLACEMENT goes first and the shopping list of
 * material and colour follows it. The old order put four sentences of silicone
 * spec ahead of any statement of where the thing was, and placement is the part
 * that was going wrong.
 */
export function propClause(req: string, opts: { anatomy?: Anatomy } = {}): string {
  const text = (req ?? "").trim();
  const prop = propFor(text);
  if (!prop) return "";

  const a = opts.anatomy ?? anatomyOf("female");
  const inserted = INSERTED_RE.test(text);
  const parts = inserted ? [INSERTED_CLAUSE, prop.spec, TWO_HANDS] : [prop.spec];
  if (BIG_RE.test(text)) parts.push(BIG_CLAUSE);
  parts.push(HAND_CLAUSE);
  if (a.hasVulva) parts.push(vulvaAnatomy(a));
  return parts.join(" ");
}

/**
 * Prop-specific negative terms, added to the endpoint's negative prompt.
 *
 * The positive description says what the object is and where it sits; this says
 * what it kept coming back as. "wood grain" and "baseball bat" are in here
 * because that is literally what the user was shown, and "bong, pipe, smoking"
 * because that is what he was shown next.
 */
export function propNegative(req: string): string {
  return hasProp(req ?? "") ? SHARED_NEGATIVE : "";
}
