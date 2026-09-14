// Portrait prompt for a companion's PUBLIC face — the photo shown on the
// homepage, browse grid, and profile. Kept free of server imports so the
// admin server function and scripts/regenerate-portraits.ts share one source of
// truth instead of drifting apart.
//
// Public portraits are sexy but clothed. Full nudity belongs to chat selfies,
// where the user has to ask for it (see selfie.ts) — never to the shop window.
//
// ── Why this reads as a real person now ─────────────────────────────────────
//
// The benchmark is companion apps whose models look like real people, and the
// verdict on ours was "they don't". This prompt had been written like an ad for
// an AI influencer, and it got one:
//
//   * GLAMOUR VOCABULARY. "stunning, attractive", "provocative full body
//     appeal", "skimpy alluring", "crystal clear pool", "glistening wet skin",
//     "luxury villa", "radiant, inviting expression". Every one of those is a
//     description of retouched commercial imagery, so that is what came back:
//     poreless sheen, resort lighting, a face arranged for a camera. A real
//     person is photographed in an ordinary room, in clothes with creases, in
//     whatever light happens to be there.
//
//   * A NEGATION. It ended "not an AI illustration, 3D render, or drawing" —
//     naming the three things it most needed to avoid. props.ts documents what
//     happens when a prompt names what it forbids.
//
//   * ANIME DATASET TAGS. "solo" and "male focus" are booru tags, left over from
//     when portraits rendered on Pony. The renderer is now a natural-language
//     model, where those tags carry nothing about gender and quite a lot about
//     where they come from, which is illustration.
//
//   * INCOHERENT COMBINATIONS. Outfit, pose and place were picked from separate
//     pools, and several outfits and poses had their own locations baked in —
//     so a companion could be "in a string bikini by the pool" while "sitting at
//     a cafe table" in "a penthouse lounge". A scene that could not be
//     photographed does not look like a photograph.
//
// So: every place is an ordinary lived-in room, every outfit is something worn
// at home and plausible in any of those rooms, and the camera is a phone.
//
// Framed head to knees. A companion's portrait is also the start frame for her
// chat photos, and a lower body that is not in the portrait has to be invented
// by the video model — which is where the fused, wrong-looking bodies in the
// reported screenshots came from. Knees rather than feet keeps the face larger,
// for the grid card and for carrying her identity, and matches the framing the
// chat photos themselves use (framingFor in selfie.ts).

function genderNoun(gender: string): string {
  if (gender === "male" || gender === "trans-male") return "man";
  if (gender === "non-binary") return "androgynous person";
  return "woman";
}

function pronouns(gender: string): { poss: string; refl: string } {
  if (gender === "male" || gender === "trans-male") return { poss: "his", refl: "himself" };
  if (gender === "non-binary") return { poss: "their", refl: "themselves" };
  return { poss: "her", refl: "herself" };
}

// Every companion shared one prompt, so the renderer returned the same pose in
// the same outfit 31 times over. These pools break that up. Selection is hashed
// off the companion's name, not random: a given companion keeps her look across
// reruns, but no two neighbours in the grid match.
function pick<T>(pool: readonly T[], seed: number, salt: number): T {
  // The salt is mixed in, not added: adding it left every pool moving in step
  // with the others, so different companions landed on the same outfit AND the
  // same pose together. This is a standard 32-bit avalanche mix.
  let h = (seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return pool[h % pool.length];
}

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

// Clothes worn at home, with their colour and fabric stated. Sexy because they
// are intimate and real, not because an adjective says so. No commas inside an
// entry: the prompt is comma-joined and the tests read the outfit back out.
const FEM_OUTFITS = [
  "a black lace bra and matching briefs under an open oversized white button-up shirt",
  "a fitted white ribbed tank top and pale grey cotton sleep shorts",
  "a thin-strapped champagne satin slip that ends mid-thigh",
  "a matching sage green cotton bralette and underwear set",
  "a cropped white baby tee and low-rise blue jeans with the top button undone",
  "a sheer black mesh bodysuit under a loose cream knit cardigan",
  "a short dusty pink silk robe tied loosely over a lace bralette",
  "an oversized grey university hoodie over black lace underwear",
] as const;

const MASC_OUTFITS = [
  "a plain white t-shirt and grey sweatpants",
  "an unbuttoned red flannel shirt over a bare chest and faded jeans",
  "a fitted black t-shirt and dark jeans",
  "grey boxer briefs and an open navy zip hoodie",
  "a white cotton tank top and black basketball shorts",
  "a loose linen shirt with the sleeves pushed up and beige chinos",
] as const;

const ENBY_OUTFITS = [
  "an oversized faded band t-shirt and black bike shorts",
  "a loose white button-up shirt and relaxed charcoal trousers",
  "a cropped grey hoodie and black joggers",
  "a ribbed olive tank top and wide-leg light jeans",
  "a sheer black long-sleeve mesh top and cargo shorts",
  "an open brown cardigan over a plain white tank and denim shorts",
] as const;

// Where and how, together, so the pose can never contradict the place. Each is
// an ordinary room somebody lives in, with the small specific clutter that
// makes a room look real, and each keeps the whole body in frame. No periods
// inside an entry: the tests read the scene back out as one sentence.
const SCENES: readonly ((p: { poss: string; refl: string }) => string)[] = [
  (p) =>
    `sitting on the edge of an unmade bed in a small apartment bedroom with one knee drawn up and ${p.poss} hands resting behind ${p.refl}`,
  (p) =>
    `leaning back against the kitchen counter of a lived-in apartment at night under a warm ceiling light with a kettle and a stack of mail beside ${p.refl}`,
  () =>
    `standing by a hotel room window with the curtains half open and afternoon light falling across the carpet`,
  (p) =>
    `sitting sideways on a worn grey living room sofa with ${p.poss} legs tucked up and a crumpled throw blanket beside ${p.refl}`,
  () =>
    `standing in a bathroom doorway with the mirror behind still fogged from a shower and a towel over the rail`,
  () => `kneeling on rumpled white sheets on a bed with soft morning light coming through thin curtains`,
  (p) =>
    `leaning with one shoulder against the doorframe of a narrow apartment hallway and ${p.poss} arms loosely folded`,
  (p) =>
    `standing on a small apartment balcony at dusk with the lit windows of the city behind and ${p.poss} hands on the railing`,
  (p) =>
    `sitting on a bedroom floor with ${p.poss} back against the side of the bed next to a phone charger and a half-finished mug of coffee`,
  () => `standing in a sunlit living room beside a cluttered bookshelf and a plant that needs watering`,
] as const;

// How a real photo of a real person looks, stated as what IS there. Phone
// camera rather than an 85mm portrait lens: a professional lens is the language
// of a shoot, and a shoot is the look being moved away from.
const REAL_PHOTO =
  "Casual photo taken on a phone by someone standing a few metres away, framed from the top of the head down to the knees with the face clearly visible, slightly off-centre framing, whatever light is in the room with its real colour cast, faint grain in the shadows. Real skin with visible pores, small marks and natural unevenness in tone, fine lines where the face moves, hair with loose strands and flyaways, clothing with real creases and wear, a body with natural proportions. A relaxed genuine expression looking at the camera.";

const ANIME_STYLE =
  "Stylized high-quality anime illustration, cel shaded, expressive, alluring, vertical portrait, full body in frame.";

export type PortraitSubject = {
  name: string;
  age: number;
  ethnicity: string;
  gender: string;
  art_style?: string;
  short_bio: string;
};

export function portraitPrompt(c: PortraitSubject, extra?: string): string {
  const g = (c.gender ?? "").toLowerCase();
  const noun = genderNoun(g);
  const seed = hashName(c.name);

  const outfits =
    g === "male" || g === "trans-male"
      ? MASC_OUTFITS
      : g === "non-binary"
        ? ENBY_OUTFITS
        : FEM_OUTFITS;
  // Salts 27 and 16, not the 2 and 3 these started from. They are arbitrary
  // numbers, and they were chosen: with these pool sizes, 2 and 3 gave three of
  // the 29 live companions an outfit AND a scene another companion already had
  // — the same photo twice on the homepage grid. 27 and 16 give every live
  // companion a different pair and use every outfit and every scene. Changing a
  // pool's length changes the spread; the roster test says so if it breaks.
  const outfit = pick(outfits, seed, 27);
  const scene = pick(SCENES, seed, 16)(pronouns(g));

  if (c.art_style === "anime") {
    return [
      `Anime illustration of a ${c.age}-year-old ${noun} wearing ${outfit}, ${scene}.`,
      ANIME_STYLE,
      extra ? `${extra}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  // The gender is the first thing said, in plain language. That is what locks
  // it on a natural-language model.
  return [
    `Photo of a real ${c.age}-year-old ${c.ethnicity} ${noun} wearing ${outfit}, ${scene}.`,
    REAL_PHOTO,
    c.short_bio ? `${c.short_bio}.` : "",
    extra ? `${extra}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
