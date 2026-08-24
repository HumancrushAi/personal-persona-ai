// Portrait prompt for a companion's PUBLIC face — the photo shown on the
// homepage, browse grid, and profile. Kept free of server imports so the
// admin server function and scripts/regenerate-portraits.ts share one source of
// truth instead of drifting apart.
//
// Public portraits are skimpy but clothed. Full nudity belongs to chat selfies,
// where the user has to ask for it (see selfie.ts) — never to the shop window.

function genderNoun(gender: string): string {
  if (gender === "male" || gender === "trans-male") return "man";
  if (gender === "non-binary") return "androgynous person";
  return "woman";
}

// Every companion shared one prompt, so Pony returned the same pose in the same
// outfit in the same colour 31 times over. These pools break that up. Selection
// is hashed off the companion's name, not random: a given companion keeps her
// look across reruns, but no two neighbours in the grid match.
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

const COLORS = [
  "black",
  "deep red",
  "emerald green",
  "royal blue",
  "blush pink",
  "white",
  "burgundy",
  "lilac",
  "champagne gold",
  "charcoal grey",
] as const;

const FEM_GARMENTS = [
  "a stylish designer one-piece swimsuit with elegant cutouts",
  "a silk chemise slip with delicate lace trim",
  "a tight ribbed summer crop top and high-waisted shorts",
  "a chic bodycon mini dress",
  "a light linen shirt worn casually unbuttoned over a stylish bikini",
  "a strappy satin camisole and soft loungewear",
  "a triangle bikini top and high-cut bottoms by the water",
] as const;

const MASC_GARMENTS = [
  "stylish swim trunks by the poolside with water droplets on shoulders",
  "an open linen summer shirt over a fitted tank top and tailored shorts",
  "a fitted dark henley shirt with sleeves casually rolled up",
  "a relaxed open button-up shirt and swim shorts at the beach",
  "a fitted ribbed tank top and jeans, athletic build",
] as const;

const ENBY_GARMENTS = [
  "a cropped tank top and high-waisted shorts",
  "an oversized linen summer shirt over a fitted tank",
  "a cropped hoodie and summer shorts",
  "a stylish sleeveless summer bodysuit",
] as const;

const CAMERA_ANGLES = [
  "cinematic medium shot, eye-level candid framing, creamy shallow depth of field",
  "three-quarter body portrait, natural perspective, soft directional sunlight",
  "candid dynamic shot, slightly low angle capturing full posture and natural movement",
  "intimate medium shot, beautiful natural perspective, crisp 85mm portraiture",
  "environmental candid portrait, relaxed framing, authentic real-world perspective",
] as const;

const POSES = [
  "resting arms along the edge of a crystal clear swimming pool with wet glistening skin and water droplets",
  "relaxing on a luxury sun lounger by the pool, smiling warmly at the camera",
  "walking along the sandy beach at golden hour with hair gently caught in the sea breeze",
  "sitting at a stylish outdoor cafe table, resting chin on hand with a playful captivating smile",
  "sitting on the edge of a bed leaning back on both hands with natural posture",
  "standing by a sunlit floor-to-ceiling balcony window glancing back over one shoulder",
  "leaning against a modern terrace railing with city lights glowing in the soft dusk background",
  "kneeling casually on a plush lounge sofa with a radiant, inviting expression",
  "half-turned in profile looking back at the lens with authentic candid chemistry",
  "sitting relaxed with one arm resting over the back of a sun lounger",
] as const;

const SETTINGS = [
  "a sparkling infinity swimming pool overlooking the ocean at golden hour",
  "a sun-drenched Mediterranean resort patio with turquoise water in the background",
  "a sunlit luxury modern apartment with large floor-to-ceiling windows",
  "a warm tropical beach with golden sunlight and gentle ocean waves",
  "a dimly lit upscale penthouse lounge with soft ambient glow and city skyline",
  "a cozy sunlit boutique hotel suite with warm wooden tones and linen",
  "a chic outdoor cafe terrace in the late afternoon sun",
  "a luxury private villa terrace overlooking lush gardens and pool",
] as const;

// Wardrobe for public-facing portraits: revealing, never bare — and gendered
function wardrobeTags(gender: string, seed: number): string {
  const g = (gender ?? "").toLowerCase();
  const color = pick(COLORS, seed, 1);
  const garments =
    g === "male" || g === "trans-male"
      ? MASC_GARMENTS
      : g === "non-binary"
        ? ENBY_GARMENTS
        : FEM_GARMENTS;
  const garment = pick(garments, seed, 2);
  return `fully clothed, wearing ${color} ${garment}, revealing but covered, visible clothing on chest and torso`;
}

// Trailing prose reinforcement — sets mood
const MOOD =
  "Attractive, natural and charming expression, captivating eye contact with the camera, authentic candid moment.";

export type PortraitSubject = {
  name: string;
  age: number;
  ethnicity: string;
  gender: string;
  art_style?: string;
  short_bio: string;
};

export function portraitPrompt(c: PortraitSubject, extra?: string): string {
  const noun = genderNoun(c.gender);
  const g = (c.gender ?? "").toLowerCase();
  const seed = hashName(c.name);

  const genderTag =
    g === "male" || g === "trans-male"
      ? "handsome adult man, solo, male focus"
      : g === "non-binary"
        ? "androgynous person, solo"
        : "attractive woman, solo";

  const style =
    c.art_style === "anime"
      ? "Stylized high-quality anime illustration, cel shaded, expressive, alluring, vertical portrait."
      : "Candid raw photo taken on a Sony A7 IV with an 85mm f/1.4 GM lens, natural ambient daylight, realistic true-to-life colors, authentic skin micro-texture with visible pores, fine natural details, subtle film grain, vertical portrait. Looks like an authentic high-resolution photograph of a real person, not an AI illustration, 3D render, or drawing.";

  const angle = pick(CAMERA_ANGLES, seed, 5);

  return [
    genderTag,
    wardrobeTags(c.gender, seed),
    style,
    angle,
    `A stunning, attractive ${c.ethnicity} ${noun} named ${c.name} who is exactly ${c.age} years old — authentic face, natural body, real human skin.`,
    `Activity & Pose: ${pick(POSES, seed, 3)}, in ${pick(SETTINGS, seed, 4)}.`,
    c.short_bio ? `Vibe: ${c.short_bio}.` : "",
    extra ? `${extra}.` : "",
    MOOD,
  ]
    .filter(Boolean)
    .join(", ");
}
