// The treasure chest: a box of sex toys a user buys for their companion to use.
//
// Two reasons it exists, both from testing. The generic "dildo" clause gave
// every render the checkpoint's own idea of a toy — "a purple tiny dildo" —
// and nothing the user typed could change it. And a toy is the one thing in
// a picture that can be sold: once it is hers, it appears in every photo and
// clip she makes with it, and it looks the same every time, because the spec
// below is what the renderer is told, word for word.
//
// Pure data and resolution; no I/O. Ownership is in toys.server.ts, the
// purchase is in toys.functions.ts, the chest UI is TreasureChest.tsx.

export type ToyKind =
  | "dildo"
  | "vibrator"
  | "wand"
  | "plug"
  | "beads"
  | "strap-on"
  | "stroker"
  | "whip"
  | "paddle"
  | "cuffs"
  | "clamps"
  | "collar"
  | "gag"
  | "rope"
  | "blindfold";

export type Toy = {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  /** In credits. A credit is 7–10¢, so 300 is about $25 and 650 about $50. */
  price: number;
  kind: ToyKind;
  /** Words that ask for THIS toy by name. */
  match: RegExp;
  /**
   * Exactly what it looks like, for the renderer. Written about "her" — the
   * prop clause swaps the pronouns for a man or a trans man.
   */
  spec: string;
  /** For a toy she wears or holds rather than inserts: where it is on her. */
  use?: string;
  /** The look the checkpoint gives this kind of toy when left alone. */
  negative?: string;
};

const SIZE_HAND = "about as long as her hand from wrist to fingertip";

export const TOYS: Toy[] = [
  {
    id: "dildo-realistic",
    name: "Realistic Dildo",
    emoji: "🍆",
    blurb: "Seven inches, flesh-toned, veined, with balls and a suction base.",
    price: 300,
    kind: "dildo",
    match: /\b(?:realistic|real(?:istic)?[- ]?looking|flesh(?:[- ]?tone[d]?|[- ]?colou?red)?|skin[- ]?tone[d]?|veiny|veined|suction)\s+(?:cup\s+)?(?:dildo|cock|dick|toy)\b|\bdildo with balls\b/i,
    spec: `The dildo is a separate solid object of realistic flesh-toned silicone shaped like an erect penis: a defined rounded head, a veined shaft, a pair of balls at the bottom and a flat suction-cup base below them. Real toy scale — ${SIZE_HAND}, roughly two fingers thick. Clean hard edges, sharp focus, distinct from skin.`,
    negative: "purple dildo, pink dildo, blue dildo, glass dildo, transparent dildo, tiny dildo, cartoon dildo",
  },
  {
    id: "dildo-black",
    name: "Big Black Dildo",
    emoji: "🖤",
    blurb: "Nine inches, thick, matte black silicone with a wide flared base.",
    price: 450,
    kind: "dildo",
    match: /\b(?:big|huge|giant|massive|thick|fat|monster|9\s*inch|ten\s*inch|10\s*inch)\s+(?:black\s+)?(?:dildo|cock|dick|toy)\b|\bblack\s+(?:dildo|cock|dick|toy)\b|\bbbc\b/i,
    spec: `The dildo is a separate solid object of matte black silicone, noticeably large for a toy while staying a real one: as long as her forearm from elbow to wrist and as thick as her wrist, with a defined rounded head, a thick smooth shaft and a wide flat flared base. Clean hard edges, sharp focus, distinct from skin.`,
    negative: "purple dildo, pink dildo, small dildo, thin dildo, tiny dildo, flesh-toned dildo",
  },
  {
    id: "dildo-glass",
    name: "Glass Dildo",
    emoji: "💎",
    blurb: "Clear borosilicate glass with a ridged shaft and a rounded tip.",
    price: 350,
    kind: "dildo",
    match: /\b(?:glass|crystal|transparent|clear)\s+(?:dildo|toy|wand)\b/i,
    spec: `The dildo is a separate solid object of clear transparent glass: a smooth rounded tip, a shaft with three evenly spaced rounded glass ridges, and a wider rounded base, ${SIZE_HAND} and roughly two fingers thick, catching the light with a glossy reflective surface. Clean hard edges, sharp focus, distinct from skin.`,
    negative: "purple dildo, pink dildo, silicone dildo, matte dildo, opaque dildo",
  },
  {
    id: "rabbit-tongue",
    name: "Vibrating Rabbit with Tongue",
    emoji: "🐰",
    blurb: "Pink rabbit vibrator — a curved shaft plus a flicking silicone tongue for her clit.",
    price: 650,
    kind: "vibrator",
    match: /\b(?:rabbit|tongue)\s+(?:vibe|vibrator|dildo|toy)\b|\b(?:vibrating\s+)?(?:dildo|vibrator|toy)\s+with\s+(?:a\s+)?tongue\b|\brabbit\b/i,
    spec: `The toy is a separate solid object of glossy hot-pink silicone: a curved rounded shaft ${SIZE_HAND}, and at its base a second short arm ending in a small soft flat silicone tongue that reaches her clit, with a slim handle below. Clean hard edges, sharp focus, distinct from skin.`,
    negative: "purple dildo, plain dildo, black dildo, glass dildo",
  },
  {
    id: "wand",
    name: "Magic Wand",
    emoji: "🪄",
    blurb: "The classic white wand with a big soft head and a cord.",
    price: 400,
    kind: "wand",
    match: /\b(?:magic\s+)?wand\b|\bhitachi\b/i,
    spec: `The wand vibrator is a separate solid object: a white hard-plastic handle about as long as her forearm with a soft white rounded silicone head the size of a tennis ball on the end, a visible narrow flexible neck between head and handle, and a black cord trailing from the base. Clean edges, sharp focus, distinct from skin.`,
    negative: "dildo, pink toy, purple toy, small vibrator",
  },
  {
    id: "bullet",
    name: "Bullet Vibe",
    emoji: "💗",
    blurb: "A small pink bullet vibrator she can press anywhere.",
    price: 250,
    kind: "vibrator",
    match: /\bbullet\s+(?:vibe|vibrator)\b|\bbullet\b|\b(?:small|little|mini|tiny)\s+(?:vibe|vibrator)\b/i,
    spec: `The vibrator is a separate solid object: a small smooth glossy pink metal bullet the length of her thumb and a finger's width, with a rounded tip and a thin cord to a small pink remote in her other hand. Clean edges, sharp focus, distinct from skin.`,
    negative: "dildo, large vibrator, purple toy, wand",
  },
  {
    id: "plug-jewel",
    name: "Jewelled Butt Plug",
    emoji: "💠",
    blurb: "Polished steel plug with a pink crystal base.",
    price: 300,
    kind: "plug",
    match: /\b(?:jewel\w*|crystal|diamond|gem|steel|metal)\s+(?:butt\s*)?plug\b|\bbutt\s*plug\b|\banal\s+plug\b|\bplug\b/i,
    spec: `The butt plug is a small separate solid object of polished mirror-bright steel: a smooth tapered bulb about the size of an egg, a narrow neck, and a flat round base set with a large faceted pink crystal that is the only part visible once it is in. Clean defined edges against her skin.`,
    negative: "dildo, silicone plug, purple plug, black plug, huge plug",
  },
  {
    id: "beads",
    name: "Anal Beads",
    emoji: "⚫",
    blurb: "Black silicone beads that grow bigger down the string, with a pull ring.",
    price: 300,
    kind: "beads",
    match: /\banal\s+beads?\b|\bbeads\b/i,
    spec: `The anal beads are one flexible matte black silicone string of six separate round beads, each the size of a marble growing to a walnut, with a black ring handle at the end. Every bead individually visible with a clear gap and a clean edge between it and the next. Clean defined edges against her skin.`,
    negative: "dildo, pearl necklace, jewellery, pink beads",
  },
  {
    id: "strap-on",
    name: "Strap-On",
    emoji: "🔗",
    blurb: "Black leather harness with a matte black silicone shaft.",
    price: 450,
    kind: "strap-on",
    match: /\bstrap[- ]?ons?\b|\bharness\s+(?:dildo|cock)\b/i,
    spec: `The strap-on is two distinct parts: a black leather harness with visible straps and silver buckles sitting on her hips, and a matte black silicone shaft mounted at the front, ${SIZE_HAND} and roughly two fingers thick with a rounded head. Clean edges, sharp focus, distinct from skin.`,
    negative: "purple dildo, pink dildo, loose dildo",
  },
  {
    id: "stroker",
    name: "Stroker",
    emoji: "🔦",
    blurb: "A flashlight-style stroker for him.",
    price: 300,
    kind: "stroker",
    match: /\bfleshlights?\b|\bstroker\b|\bpocket\s+pussy\b/i,
    spec: `The stroker is a separate solid object: a matte black cylindrical case about the size of a large flashlight, roughly as long as her forearm and as thick as her wrist, with a soft pink textured silicone opening at one end. Clean edges, clearly distinct from the body.`,
    negative: "dildo, bottle, flashlight beam",
  },
  {
    id: "flogger",
    name: "Leather Flogger",
    emoji: "🪢",
    blurb: "A black leather flogger with a braided handle.",
    price: 300,
    kind: "whip",
    match: /\bflogger\b|\bwhips?\b|\bwhipp(?!ed\s+cream)\w*\b|\bcat\s+o'?\s*nine\b/i,
    spec: `The flogger is a separate solid object: a black braided leather handle about as long as her hand, with a thick bunch of soft black leather tails hanging from it, each tail as long as her forearm.`,
    use: `She holds the flogger by its handle in one hand, the leather tails trailing down over her bare thigh, looking into the lens. She is alone in the frame.`,
    negative: "horse whip, bullwhip, rope, chain, cartoon whip, second person",
  },
  {
    id: "crop",
    name: "Riding Crop",
    emoji: "🏇",
    blurb: "A slim black riding crop with a leather keeper.",
    price: 250,
    kind: "paddle",
    match: /\briding\s+crop\b|\bcrop\b/i,
    spec: `The riding crop is a separate solid object: a slim stiff black shaft about as long as her arm, wrapped in black leather, with a small flat leather loop keeper at the tip and a black grip at the other end.`,
    use: `She holds the crop in one hand with the leather keeper resting against her own bare skin, looking into the lens. She is alone in the frame.`,
    negative: "whip, rope, stick, cane, second person",
  },
  {
    id: "paddle",
    name: "Spanking Paddle",
    emoji: "🏓",
    blurb: "A black leather paddle with a heart cut-out.",
    price: 250,
    kind: "paddle",
    match: /\bpaddle\b/i,
    spec: `The paddle is a separate solid object: a flat black leather paddle the size of her hand with a heart-shaped cut-out in the middle and a short wrapped handle.`,
    use: `She holds the paddle in one hand against her own bare ass cheek, looking back over her shoulder into the lens. She is alone in the frame.`,
    negative: "table tennis paddle, bat, second person",
  },
  {
    id: "cuffs",
    name: "Handcuffs & Chain",
    emoji: "⛓️",
    blurb: "Polished steel handcuffs on a chain.",
    price: 300,
    kind: "cuffs",
    match: /\bhand\s*cuffs?\b|\bcuffs?\b|\bcuffed\b|\bchains?\b|\bchained\b|\bshackle\w*\b/i,
    spec: `The handcuffs are a separate solid object: two polished silver steel cuffs joined by a short heavy silver chain, each cuff closed with a visible hinge and keyhole.`,
    use: `The cuffs are locked around both her wrists, held together in front of her lower stomach, the chain hanging between them. She is alone in the frame.`,
    negative: "rope, zip ties, bracelet, second person",
  },
  {
    id: "clamps",
    name: "Nipple Clamps",
    emoji: "🔩",
    blurb: "Silver clamps joined by a fine chain.",
    price: 300,
    kind: "clamps",
    match: /\bnipple\s+clamps?\b|\bclamps?\b/i,
    spec: `The nipple clamps are a separate solid object: two small adjustable silver metal clamps with black rubber tips, joined to each other by a fine silver chain that hangs in a loop between them.`,
    use: `One clamp is closed on each of her own nipples with the chain hanging in a loop between her breasts; her hands are at her sides. She is alone in the frame.`,
    negative: "clothes pegs, jewellery, piercings, second person",
  },
  {
    id: "collar",
    name: "Collar & Leash",
    emoji: "🐾",
    blurb: "A black leather collar with a ring and a leash.",
    price: 300,
    kind: "collar",
    match: /\bcollar\b|\bleash\b|\bleashed\b/i,
    spec: `The collar is a separate solid object: a wide black leather collar with silver studs and a silver D-ring at the front, with a black leather leash clipped to the ring.`,
    use: `The collar is buckled around her own neck and she holds the leash loosely in one hand, looking into the lens. She is alone in the frame.`,
    negative: "necklace, choker, dog, second person",
  },
  {
    id: "gag",
    name: "Ball Gag",
    emoji: "🔴",
    blurb: "A red ball gag on black straps.",
    price: 250,
    kind: "gag",
    match: /\bball\s*gag\b|\bgag\b|\bgagged\b/i,
    spec: `The ball gag is a separate solid object: a solid glossy red rubber ball the size of a plum on a black leather strap with a silver buckle.`,
    use: `The ball is in her mouth between her teeth with the strap buckled around the back of her head, her lips closed around the ball. She is alone in the frame.`,
    negative: "cloth gag, tape, second person",
  },
  {
    id: "rope",
    name: "Shibari Rope",
    emoji: "🧶",
    blurb: "Red cotton rope tied in a chest harness.",
    price: 350,
    kind: "rope",
    match: /\bshibari\b|\bropes?\b|\btied\s+up\b|\bbondage\b|\bkinbaku\b/i,
    spec: `The rope is soft red cotton rope, as thick as her finger, with visible twisted strands.`,
    use: `The rope is tied in a neat shibari chest harness: a knotted diamond pattern across her chest framing her breasts above and below, the lines running over her shoulders and around her back, with a knot at the sternum. Her wrists are free. She is alone in the frame.`,
    negative: "chains, cuffs, cut rope, frayed rope, second person",
  },
  {
    id: "blindfold",
    name: "Satin Blindfold",
    emoji: "🎀",
    blurb: "A black satin blindfold.",
    price: 200,
    kind: "blindfold",
    match: /\bblind\s*fold(?:ed)?\b/i,
    spec: `The blindfold is a smooth black satin band as wide as two fingers.`,
    use: `The blindfold is tied over her eyes with the bow at the back of her head, her lips parted. She is alone in the frame.`,
    negative: "sunglasses, mask, second person",
  },
];

export function toyById(id: string | null | undefined): Toy | null {
  return TOYS.find((t) => t.id === id) ?? null;
}

// The words that ask for a KIND of toy without naming one: "a dildo", "a
// vibrator", "a plug". The owned toy of that kind is used, or the cheapest
// one is asked for.
const GENERIC_KIND: [RegExp, ToyKind][] = [
  [/\bdildos?\b|\bsilicone\s+cock\b|\b(?:fake|toy)\s+(?:cock|dick)\b|\bsuction\s+dildo\b/i, "dildo"],
  [/\bvibrators?\b|\bvibes?\b|\bvibrating\b/i, "vibrator"],
  [/\bwands?\b/i, "wand"],
  [/\b(?:butt\s*)?plugs?\b|\banal\s+plug\b/i, "plug"],
  [/\bbeads\b/i, "beads"],
  [/\bstrap[- ]?ons?\b/i, "strap-on"],
  [/\bfleshlights?\b|\bstroker\b|\bpocket\s+pussy\b/i, "stroker"],
  [/\bwhips?\b|\bflogger\b|\bwhipp(?!ed\s+cream)\w*\b/i, "whip"],
  [/\bpaddle\b|\bcrop\b/i, "paddle"],
  [/\bhand\s*cuffs?\b|\bcuffs?\b|\bcuffed\b|\bchains?\b|\bchained\b/i, "cuffs"],
  [/\bclamps?\b/i, "clamps"],
  [/\bcollar\b|\bleash\b/i, "collar"],
  [/\bgag\b|\bgagged\b/i, "gag"],
  [/\bropes?\b|\btied\s+up\b|\bbondage\b|\bshibari\b/i, "rope"],
  [/\bblind\s*fold(?:ed)?\b/i, "blindfold"],
  // "a toy", "a sex toy": any toy she can use on herself.
  [/\bsex\s+toys?\b|\btoys?\b/i, "dildo"],
];

export type ToyResolution = {
  /** The toy she uses in this picture — owned, or free for this account. */
  toy: Toy | null;
  /** The toy the request needs but the user does not have. */
  needed: Toy | null;
};

/**
 * Which toy a request is about, and whether the user has it.
 *
 * `owned` is the set of toy ids the user has bought, or "all" for an account
 * that gets them free (testers, admins). A toy named outright wins; a kind
 * named generically ("a dildo") takes the owned toy of that kind, or the
 * cheapest one as the thing to buy. No toy words at all → nothing.
 */
export function resolveToy(request: string, owned: Set<string> | "all"): ToyResolution {
  const req = request ?? "";
  const has = (t: Toy) => owned === "all" || owned.has(t.id);
  const named = TOYS.filter((t) => t.match.test(req));
  if (named.length) {
    const mine = named.find(has);
    if (mine) return { toy: mine, needed: null };
    return { toy: null, needed: named[0] };
  }
  const kind = GENERIC_KIND.find(([re]) => re.test(req))?.[1];
  if (!kind) return { toy: null, needed: null };
  const ofKind = TOYS.filter((t) => t.kind === kind);
  if (owned === "all") return { toy: ofKind[0] ?? null, needed: null };
  const mine = ofKind.find((t) => owned.has(t.id));
  if (mine) return { toy: mine, needed: null };
  const cheapest = [...ofKind].sort((a, b) => a.price - b.price)[0] ?? null;
  return { toy: null, needed: cheapest };
}

/** True when the request is about a toy at all. */
export function mentionsToy(request: string): boolean {
  const r = resolveToy(request, "all");
  return Boolean(r.toy);
}

/** The ledger reason that records a purchase; ownership is read back from it. */
export const TOY_PURCHASE_PREFIX = "toy_purchase:";

/** What she says when the toy is not in the chest yet. In her voice, playful, no charge. */
export function needsToyReply(toy: Toy): string {
  const lower = toy.name.toLowerCase();
  const article = /^[aeiou]/i.test(lower) ? "an" : "a";
  return `mmm i'd love to, baby… but i don't have ${article} ${lower} here 😏 open my treasure chest and get me one — the second it's mine, i'll use it on myself exactly how you want 😈`;
}
