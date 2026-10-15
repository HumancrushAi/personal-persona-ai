// Rendering a physical object.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: NEVER NEGATE IN THE POSITIVE PROMPT.
// State where the object IS. Wrong objects / wrong orientation → NEGATIVE only.
//
// ORIENTATION (insertion): pin BOTH ends.
// Rounded tip = leading end inside. Wide flared base = outer end in her hand.
// "Flared base showing" alone is not enough — the model still draws the wide
// end as the tip going in.

import { type Anatomy, anatomyOf } from "./anatomy";
import type { Toy } from "./toys";

/** Toy vocabulary, owned here and re-exported into selfie.ts's KW table. */
export const TOY_VOCAB = String.raw`dildos?|vibrators?|sex\s*toys?|butt\s*plugs?|plugs?|magic wands?|strap[- ]?ons?|anal beads|fleshlights?|silicone cock|fake dick|toy cock|fake cock|toy dick|suction dildo|clit vibrator|bullet vibrator|rabbit vibrator|flogger|whips?|riding crop|paddle|hand\s*cuffs?|cuffs|nipple clamps?|clamps|collar|leash|ball\s*gag|gag|shibari|blindfold|glass dildo`;

const kw = (src: string) => new RegExp(String.raw`\b(?:${src})\b`, "i");

const SHARED_NEGATIVE =
  "second person, another person, partner, another person's hand, someone else's hand, extra hand, three hands, baseball bat, cricket bat, club, wooden pole, broom handle, rolling pin, table leg, tree branch, weapon, wood grain, wooden texture, giant novelty prop, oversized prop, cartoon prop, balloon, sausage, melting object, deformed object, object fused to hand, object merging into skin, floating object, duplicated object, extra object, bong, pipe, hookah, vape, bottle, flask, microphone, telescope, smoking, vaping, drinking, blowing, dildo resting on skin, toy lying on body, external only, held against body, pressed on thigh, not inserted, outside only, inverted dildo, upside-down dildo, toy inverted, flared base inside, suction cup inside, wide base entering, tip outside body, base-first insertion, backwards toy, dildo on top of vulva, toy beside vulva";

type Prop = {
  id: string;
  match: RegExp;
  spec: string;
};

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
    spec: "The dildo is a separate solid realistic flesh-toned silicone anatomical adult toy, with a defined rounded glans, a subtly veined shaft, and two attached rounded testicle-shaped balls beneath the shaft. Two clearly different ends: (1) the firm narrow rounded tip / glans is the insertable end; (2) the wide flat flared base / suction-cup end is the handle end. Real toy scale — about as long as her hand from wrist to fingertip, roughly two fingers thick. Clean hard edges, sharp focus, distinct from skin.",
  },
];

const BIG_RE =
  /\b(?:big|bigger|large|huge|massive|giant|enormous|thick|fat|xl|xxl|monster|9\s*inch|10\s*inch)\b/i;

const BIG_CLAUSE =
  "It is noticeably large for a sex toy while staying a realistic one: at most as long as her forearm and at most as thick as her wrist.";

const HAND_CLAUSE =
  "Her hand closes around the wide flared base (the outer handle end only) with five separate countable fingers and a clean visible edge between skin and silicone.";

const vulvaAnatomy = (a: Anatomy) =>
  `${a.subject[0].toUpperCase()}${a.subject.slice(1)} has a natural soft vulva; the toy is a separate manufactured object against ${a.poss} skin.`;

const TWO_HANDS =
  "Exactly two hands: one hand grips only the wide flared base outside her body, the other rests on her lower stomach. She is alone in the frame.";

// Tip-first, base-out — stated three ways so the encoder cannot invert the toy.
const INSERTED_CLAUSE =
  "Penetration complete, tip-first orientation only: the narrow rounded tip is deep inside her pussy; the wide flat flared base is fully outside her body and is the only end her fingers touch. " +
  "Most of the shaft is hidden inside her; a short length of shaft plus the flared base remain visible outside. " +
  "Her open thighs frame the entry. Her pussy lips stretch around the shaft (the narrow mid-section), not around the wide base. Clear wetness at the rim of entry, sharp focus on the insertion point. " +
  "The toy is visibly inserted and angles down between her open thighs. This is real penetration with the tip inside — not a toy resting on her skin, not base-first, not inverted.";

// The same clause for the other hole. The pussy wording was being sent for
// "a dildo up your ass", and the render put it where the words said.
const analInsertedClause = (a: Anatomy) =>
  "Penetration complete, tip-first orientation only: the narrow rounded tip is deep inside her ass, the wide flat flared base is fully outside her body and is the only end her fingers touch. " +
  "Most of the shaft is hidden inside her; a short length of shaft plus the flared base remain visible outside, between her cheeks. " +
  `Her hips are tilted up and her thighs apart so the entry is visible; her anus stretches around the shaft (the narrow mid-section), not around the wide base${
    a.hasVulva
      ? ", and her pussy stays closed and untouched in front of it"
      : a.hasPenis
        ? ", and her cock and balls hang in front of it"
        : ""
  }. Sharp focus on the insertion point. ` +
  "The toy angles up between her cheeks. This is real anal penetration with the tip inside — not a toy resting on her skin, not base-first, not inverted.";

/**
 * The old renderer used INSERTED_CLAUSE for every owned toy. That clause is
 * deliberately dildo-shaped (glans, shaft and flared base), so it made glass,
 * plugs, beads and rabbits change shape as soon as they were requested in a
 * chat. Keep the placement instruction exact for the physical toy being used.
 */
function insertedClauseFor(toy: Toy | null, propId: string, a: Anatomy, anal: boolean): string {
  const target = anal ? "ass" : "pussy";
  const ownedId = toy?.id ?? propId;
  if (ownedId === "dildo-glass") {
    return `Tip-first orientation: the rounded glass tip leads inside her ${target}; the three rounded glass ridges follow the shaft, while the wider rounded glass base remains fully outside her body in her hand. The transparent glass catches the light and stays one coherent manufactured toy, never skin or a random dildo.`;
  }
  if (ownedId === "plug-jewel") {
    return `The tapered steel bulb leads inside her ${target}; its narrow neck sits at the opening and the flat base with its large faceted pink crystal remains fully outside her body and visible. The jewel is the outer handle, never the inserted end.`;
  }
  if (ownedId === "beads" || propId === "anal-beads") {
    return `The smallest black silicone bead leads inside her ${target}; the graduated beads follow in a clear line, with the final bead and black pull ring remaining outside her body and visible. Each bead stays separate with a clean gap.`;
  }
  if (ownedId === "rabbit-tongue") {
    return `The rounded curved shaft tip leads inside her ${target}; the short pink arm and its soft silicone tongue remain outside against her clitoris, with the handle below the toy held in her hand. Both parts stay attached as one rabbit vibrator.`;
  }
  if (ownedId === "strap-on") {
    return `The matte black shaft mounted to the harness leads tip-first inside her ${target}; the black leather harness stays buckled around her hips and fully outside her body, with its straps and silver buckles visible.`;
  }
  if (ownedId === "vibrator" || toy?.kind === "vibrator") {
    return `The rounded silicone vibrator tip leads inside her ${target}; its smooth body and small control button remain outside her body in her hand. It is one small solid vibrator, not a dildo, glass toy or wand.`;
  }
  if (ownedId === "wand" || ownedId === "bullet" || ownedId === "stroker") {
    return `This is an external-use device, not a penetrative dildo: the ${ownedId === "wand" ? "large soft wand head" : ownedId === "bullet" ? "small rounded bullet" : "black stroker case"} stays outside her body against the requested area, clearly separate from her skin and held in her hand.`;
  }
  return anal ? analInsertedClause(a) : INSERTED_CLAUSE;
}

const PHYSICAL_CONTACT_CLAUSE =
  "At the entry point, the body opening naturally occludes the inner edge of the shaft with no visible air gap. A small contact shadow, subtle skin compression and consistent depth make the contact physically believable; the toy remains a separate solid object and never merges with the body.";

function handleClauseFor(toy: Toy | null, propId: string): string {
  const id = toy?.id ?? propId;
  if (id === "dildo-realistic" || id === "dildo-black" || id === "dildo") return HAND_CLAUSE;
  if (id === "dildo-glass")
    return "Her hand holds the wider rounded glass base with five separate countable fingers and a clean visible edge between skin and glass.";
  if (id === "plug-jewel")
    return "Her hand holds the flat base beneath the steel plug; the faceted pink crystal is visible outside her body with a clean edge against skin.";
  if (id === "beads" || id === "anal-beads")
    return "Her hand holds the black pull ring; every graduated silicone bead remains separate and visible with a clean edge against skin.";
  if (id === "rabbit-tongue")
    return "Her hand holds the slim rabbit handle; the curved shaft and separate clitoral tongue remain attached and visibly distinct from her fingers.";
  if (id === "strap-on")
    return "The black leather harness is visibly buckled around her hips and the matte shaft is mounted at its front; both manufactured parts stay distinct from her skin.";
  return HELD_CLAUSE;
}

function twoHandsClauseFor(toy: Toy | null, propId: string): string {
  const id = toy?.id ?? propId;
  if (id === "dildo-realistic" || id === "dildo-black" || id === "dildo") return TWO_HANDS;
  return "Exactly two hands: one hand holds the toy's handle or outer base, the other rests on her lower stomach. She is alone in the frame.";
}

// Every clause here was written for "her", and a man asking for a toy got
// "her ass" and "her hand" in his prompt. "her" is both possessive and
// object in English; "inside her" is the one object use these clauses make.
function pronounize(text: string, a: Anatomy): string {
  if (a.subject === "she") return text;
  const S = `${a.subject[0].toUpperCase()}${a.subject.slice(1)}`;
  const Poss = `${a.poss[0].toUpperCase()}${a.poss.slice(1)}`;
  return text
    .replace(/\binside her\b(?!\s+(?:ass|pussy|mouth|body|open|lips|cheeks|thighs))/g, `inside ${a.object}`)
    .replace(/\bShe is\b/g, `${S} ${a.is}`)
    .replace(/\bShe has\b/g, `${S} ${a.is === "are" ? "have" : "has"}`)
    .replace(/\bHer\b/g, Poss)
    .replace(/\bher\b/g, a.poss)
    .replace(/\bShe\b/g, S)
    .replace(/\bshe\b/g, a.subject)
    .replace(/\bherself\b/g, a.refl);
}
const ANAL_TARGET_RE = /\b(?:ass|asshole|arse|anus|butt|booty|rear|cheeks|back\s*door|butthole)\b/i;

// A toy at her mouth. "sucking on a dildo" rendered the toy held up beside her
// cheek with her lips closed: the spec said what the toy IS and the hand
// clause where the base is, and nothing said where the tip was. Stated the
// same way the insertion clause states penetration — which end, where, and
// what the mouth is doing around it.
const ORAL_RE =
  /\b(?:suck\w*|lick\w*|blow\w*|deep\s*throat\w*|gag\w*|mouth|tongue|lips|kiss\w*)\b/i;
const LICK_RE = /\blick\w*\b/i;

const oralClause = (a: Anatomy) => {
  const S = `${a.subject[0].toUpperCase()}${a.subject.slice(1)}`;
  return `The narrow rounded tip of the toy is inside ${a.poss} open mouth, ${a.poss} lips closed around the shaft just below the tip, ${a.poss} cheeks drawn in and ${a.poss} eyes raised to the lens. The toy points straight into ${a.poss} mouth with its wide flared base in ${a.poss} hand. Exactly one toy and exactly two hands; ${S} ${a.is} alone in the frame.`;
};

// Licking is a different action from sucking or blowing. The old shared oral
// clause put the tip inside a closed mouth for every oral verb, so a request to
// lick a glass dildo became a generic blowjob pose. Keep the toy outside the
// mouth, show the tongue making the contact, and preserve a readable sensual
// expression instead of inventing a second person or a second object.
const lickClause = (a: Anatomy) => {
  const S = `${a.subject[0].toUpperCase()}${a.subject.slice(1)}`;
  return `The toy is held just in front of ${a.poss} parted lips, its smooth shaft angled toward ${a.poss} mouth while the tip of ${a.poss} tongue visibly traces along the shaft; ${a.poss} lips are parted in a slow sensual lick, eyes lifted toward the lens, and ${a.poss} wide flared base is held in one hand. Exactly one toy and exactly two hands; ${S} ${a.is} alone in the frame.`;
};

function oralClauseFor(toy: Toy | null, propId: string, a: Anatomy, licking: boolean): string {
  const id = toy?.id ?? propId;
  if (id === "dildo-glass") {
    const action = licking
      ? `the tip of ${a.poss} tongue traces along the ridged glass shaft`
      : `${a.poss} lips close around the rounded glass tip`;
    return `The clear glass dildo is held directly at ${a.poss} parted lips; ${action}, while the wider rounded glass base stays in one hand. The transparent ridges remain visible and the toy stays outside the throat. Exactly one toy and exactly two hands; ${a.subject} ${a.is} alone in the frame.`;
  }
  if (id === "rabbit-tongue") {
    return `The curved pink rabbit shaft is held at ${a.poss} parted lips, with ${a.poss} lips around the rounded tip and the separate soft tongue arm visible below it. ${a.poss} other hand holds the slim handle; the attached rabbit shape stays clear. Exactly one toy and exactly two hands; ${a.subject} ${a.is} alone in the frame.`;
  }
  if (id === "bullet") {
    return `The small glossy pink bullet vibrator is held just in front of ${a.poss} parted lips, its rounded metal body and thin cord visible, with one hand on the remote. It is a compact bullet, not a dildo. Exactly one toy and exactly two hands; ${a.subject} ${a.is} alone in the frame.`;
  }
  return licking ? lickClause(a) : oralClause(a);
}

const INSERTED_RE =
  /\b(?:insert\w*|in|into|inside|up|deep|penetrat\w*|stuff\w*|slid\w*|shov\w*|stick\w*|push\w*|ridin?g?|fuck\w*)\b[^.?!]{0,25}\b(?:pussy|pussies|vagina|vulvas?|cunt|slit|clit\w*|labia|snatch|coochie|cooch|vag|hole|rear|booty|cheeks|ass|asshole|anus|butt)\b/i;

function propFor(req: string): Prop | null {
  return PROPS.find((p) => p.match.test(req)) ?? null;
}

export function hasProp(req: string): boolean {
  return propFor(req ?? "") !== null;
}

export function propIsInserted(req: string): boolean {
  const text = (req ?? "").trim();
  return propFor(text) !== null && INSERTED_RE.test(text);
}

export function propIsOral(req: string): boolean {
  const text = (req ?? "").trim();
  return propFor(text) !== null && !INSERTED_RE.test(text) && ORAL_RE.test(text);
}

// Which generic clause a chest toy of each kind is rendered with.
const KIND_PROP: Record<string, string> = {
  dildo: "dildo",
  vibrator: "vibrator",
  wand: "wand",
  plug: "butt-plug",
  beads: "anal-beads",
  "strap-on": "strap-on",
  stroker: "stroker",
};

const HELD_CLAUSE =
  "Her hand holds the toy by its handle end with five separate countable fingers and a clean visible edge between skin and toy.";

export function propClause(req: string, opts: { anatomy?: Anatomy; toy?: Toy | null } = {}): string {
  const text = (req ?? "").trim();
  const a = opts.anatomy ?? anatomyOf("female");
  const toy = opts.toy ?? null;
  // A toy from the chest that she wears or holds rather than inserts: the
  // spec says what it is and `use` says where it is on her. Nothing else.
  if (toy?.use) return pronounize(`${toy.spec} ${toy.use}`, a);
  // A chest toy replaces the generic spec word for word — that is the point
  // of buying one. The insertion and mouth logic below is unchanged.
  const generic = propFor(text);
  const prop = toy
    ? { ...(PROPS.find((p) => p.id === KIND_PROP[toy.kind]) ?? generic ?? PROPS[PROPS.length - 1]), spec: toy.spec }
    : generic;
  if (!prop) return "";

  const inserted = INSERTED_RE.test(text);
  const oral = !inserted && ORAL_RE.test(text);
  const anal = inserted && ANAL_TARGET_RE.test(text) && !/\b(?:pussy|vagina|cunt|slit)\b/i.test(text);
  const parts = inserted
    ? [insertedClauseFor(toy, prop.id, a, anal), PHYSICAL_CONTACT_CLAUSE, prop.spec, twoHandsClauseFor(toy, prop.id)]
    : oral
      ? [oralClauseFor(toy, prop.id, a, LICK_RE.test(text)), prop.spec]
      : [prop.spec];
  if (BIG_RE.test(text) && !toy) parts.push(BIG_CLAUSE);
  parts.push(handleClauseFor(toy, prop.id));
  // The vulva sentence places the toy "against her skin"; at her mouth that is
  // the wrong place, and the word pulls the camera to her groin.
  if (a.hasVulva && !oral && !anal) parts.push(vulvaAnatomy(a));
  return pronounize(parts.join(" "), a);
}

export function propNegative(req: string, toy?: Toy | null): string {
  const base = hasProp(req ?? "") || toy ? SHARED_NEGATIVE : "";
  return toy?.negative ? (base ? `${base}, ${toy.negative}` : toy.negative) : base;
}
