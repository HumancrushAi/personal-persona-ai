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
// it is made of, what colour, how big MEASURED AGAINST HER OWN BODY, and which
// specific wrong objects it must not turn into.
//
// Scale is the part that matters most. These models have no absolute sense of
// size, but they do render relative body proportion well — so "about as long as
// her hand" is something the renderer can act on and "correct size" is not.

/** Toy vocabulary, owned here and re-exported into selfie.ts's KW table. */
export const TOY_VOCAB = String.raw`dildos?|vibrators?|sex\s*toys?|butt\s*plugs?|plugs?|magic wands?|strap[- ]?ons?|anal beads|fleshlights?|silicone cock|fake dick|toy cock|fake cock|toy dick|suction dildo|clit vibrator|bullet vibrator|rabbit vibrator`;

const kw = (src: string) => new RegExp(String.raw`\b(?:${src})\b`, "i");

/** Wrong objects the renderer reaches for when a prop is under-specified. */
const SHARED_NEGATIVE =
  "baseball bat, cricket bat, club, bat, wooden pole, broom handle, rolling pin, table leg, tree branch, weapon, wood grain, wooden texture, giant novelty prop, oversized prop, cartoon prop, balloon, sausage, melting object, deformed object, object fused to hand, object merging into skin, floating object, duplicated object, extra object, bong, pipe, hookah, smoking pipe, vape, bottle, flask, microphone, cylinder held to mouth, object near mouth, object near face, object near chest, smoking device, straw, tube held to mouth";

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
    spec: "The anal beads are one flexible silicone string of separate round beads, each about the size of a marble and graduating in size, with a ring handle at the end. Every bead is individually visible with a clear gap and a clean edge between it and the next, never a single fused rod.",
  },
  {
    id: "butt-plug",
    match: kw(String.raw`butt\s*plugs?|plugs?`),
    spec: "The butt plug is a small separate solid object: tapered matte silicone in a solid colour, about the size of an egg, with a narrow neck and a flat flared base. Clean defined edges against her skin.",
  },
  {
    id: "wand",
    match: kw("magic wands?"),
    spec: "The wand vibrator is a separate solid object: a white or lilac body about as long as her forearm with a soft rounded silicone head the size of a plum on the end, a visible narrow neck between head and handle, and a cable trailing from the base. Clean edges, held in her hand and clearly distinct from it.",
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
    match: kw(String.raw`dildos?|sex\s*toys?|silicone cock|fake dick|toy cock|fake cock|toy dick|suction dildo`),
    spec: "The dildo is a separate solid object: smooth matte silicone in a solid colour, with a soft rounded tip and a flared base, and clean edges that read clearly against her skin. It is positioned down between her legs at her crotch and held low away from her face and mouth. It is about as long as her hand from wrist to fingertip and roughly two fingers thick — a real body-safe sex toy.",
  },
];

// "big dildo" is a legitimate request, and the refiner amplifies it honestly:
// big becomes enormous, enormous becomes the bat. So large is allowed, and then
// bounded by her own body, which is the only ceiling the renderer can act on.
const BIG_RE =
  /\b(?:big|bigger|large|huge|massive|giant|enormous|thick|fat|xl|xxl|monster|9\s*inch|10\s*inch)\b/i;

const BIG_CLAUSE =
  "It is noticeably large but still a realistic sex toy — at most the length of her forearm and never thicker than her wrist. Large does not mean a bat, a club or a pole.";

const HAND_CLAUSE =
  "Her fingers wrap around it and are still countable as five separate fingers. The object never merges into her hand or body.";

const FEMALE_ANATOMY =
  "She has normal female anatomy, a natural pussy, and no penis — the toy is a separate object, not part of her body.";

const INSERTED_CLAUSE =
  "The sex toy is inserted into her lower body down at her crotch between her legs. The sex toy is positioned exclusively down at her groin and pussy, inserted vaginally, completely away from her face, head, mouth, and upper chest. Her hands are positioned low down between her thighs holding the base of the toy at her pussy, NEVER held up near her face or chest. Where it meets her body the contact is physical, literal, and visible: naturally parting outer and inner labia pressing around the toy, visible clitoral hood, glistening natural moisture, with the exact point of entry in sharp focus rather than smoothed over.";

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

/**
 * The prop specification to append to a render prompt.
 *
 * Appended AFTER the refiner, never handed to it — same reason PORTRAIT_FRAMING
 * is appended in characters.functions.ts. Grok is told to describe props well
 * and mostly does, but "mostly" is what produced the bat, and a constraint that
 * depends on the refiner behaving is not a constraint. Returns "" when the
 * request names no prop, so it costs nothing on an ordinary selfie.
 */
export function propClause(req: string, opts: { isMale?: boolean } = {}): string {
  const text = (req ?? "").trim();
  const prop = propFor(text);
  if (!prop) return "";

  const parts = [prop.spec];
  if (BIG_RE.test(text)) parts.push(BIG_CLAUSE);
  parts.push(HAND_CLAUSE);
  if (!opts.isMale) parts.push(FEMALE_ANATOMY);
  if (INSERTED_RE.test(text)) parts.push(INSERTED_CLAUSE);
  return parts.join(" ");
}

/**
 * Prop-specific negative terms, added to the endpoint's negative prompt.
 *
 * The positive description says what the object is; this says what it kept
 * coming back as. "wood grain" and "baseball bat" are in here because that is
 * literally what the user was shown.
 */
export function propNegative(req: string): string {
  return hasProp(req ?? "") ? SHARED_NEGATIVE : "";
}
