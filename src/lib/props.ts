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
// State where the object IS, what it touches, and how much of it you can see.
// Say nothing about where it is not. Wrong objects belong in the NEGATIVE only.

import { type Anatomy, anatomyOf } from "./anatomy";

/** Toy vocabulary, owned here and re-exported into selfie.ts's KW table. */
export const TOY_VOCAB = String.raw`dildos?|vibrators?|sex\s*toys?|butt\s*plugs?|plugs?|magic wands?|strap[- ]?ons?|anal beads|fleshlights?|silicone cock|fake dick|toy cock|fake cock|toy dick|suction dildo|clit vibrator|bullet vibrator|rabbit vibrator`;

const kw = (src: string) => new RegExp(String.raw`\b(?:${src})\b`, "i");

// Wrong objects / bad activities. Object nouns and verbs only.
const SHARED_NEGATIVE =
  "baseball bat, cricket bat, club, wooden pole, broom handle, rolling pin, table leg, tree branch, weapon, wood grain, wooden texture, giant novelty prop, oversized prop, cartoon prop, balloon, sausage, melting object, deformed object, object fused to hand, object merging into skin, floating object, duplicated object, extra object, bong, pipe, hookah, vape, bottle, flask, microphone, telescope, smoking, vaping, drinking, blowing, dildo resting on skin, toy lying on body, external only, held against body, pressed on thigh, not inserted, outside only";

type Prop = {
  id: string;
  match: RegExp;
  /** Material, colour, shape and a scale anchor against her own body. */
  spec: string;
};

// Order matters: "butt plug" contains "plug", so specific entries come first.
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
    match: kw(
      String.raw`dildos?|sex\s*toys?|silicone cock|fake dick|toy cock|fake cock|toy dick|suction dildo`,
    ),
    spec: "The dildo is a separate solid object: smooth matte purple or pink silicone, firm rounded tip, visible flared base. Real toy scale — about as long as her hand from wrist to fingertip, roughly two fingers thick. Clean hard edges, sharp focus, clearly distinct from skin and from her fingers.",
  },
];

const BIG_RE =
  /\b(?:big|bigger|large|huge|massive|giant|enormous|thick|fat|xl|xxl|monster|9\s*inch|10\s*inch)\b/i;

const BIG_CLAUSE =
  "It is noticeably large for a sex toy while staying a realistic one: at most as long as her forearm and at most as thick as her wrist.";

const HAND_CLAUSE =
  "Her hand closes around the base with five separate countable fingers and a clean visible edge between skin and silicone.";

const vulvaAnatomy = (a: Anatomy) =>
  `${a.subject[0].toUpperCase()}${a.subject.slice(1)} has a natural soft vulva; the toy is a separate manufactured object against ${a.poss} skin.`;

const TWO_HANDS =
  "Exactly two hands: one hand grips only the flared base of the inserted toy, the other rests on her lower stomach. She is alone in the frame.";

// Placement FIRST — renderer weights early tokens hardest.
// Occlusion (shaft mostly inside) is what forces real insertion, not "holding".
const INSERTED_CLAUSE =
  "Penetration in progress and already complete in this still: the dildo is deep inside her pussy, most of the shaft hidden inside her body, only the flared base and a short length of silicone still visible outside. " +
  "Her open thighs frame the entry. At the exact point where the toy enters her, her pussy lips grip the silicone tightly, stretched around it, with clear wetness at the rim of entry, sharp focus on the insertion. " +
  "The toy is angled down between her legs along the line of her thighs. One hand holds only the base, fingers on the flared end, wrist low near her inner thigh. This is insertion, not a toy resting on her skin.";

// "stick a dildo in your pussy" must match — verb then body part within 25 chars.
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
 * Appended AFTER the refiner. When inserted, PLACEMENT goes first.
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
 */
export function propNegative(req: string): string {
  return hasProp(req ?? "") ? SHARED_NEGATIVE : "";
}
