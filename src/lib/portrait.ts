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
  "a lace bra and matching panties",
  "a silk chemise slip",
  "a tight ribbed crop top and micro shorts",
  "a bodycon mini dress",
  "a sheer mesh babydoll over a bikini set",
  "a satin robe worn open over a bralette",
  "a strappy bodysuit",
  "a triangle bikini top and high-cut bottoms",
] as const;

const MASC_GARMENTS = [
  "an open unbuttoned shirt over a fitted tank top",
  "a tight ribbed tank top and low-slung jeans",
  "an unzipped hoodie over a bare-armed tee",
  "a fitted henley with the sleeves pushed up",
  "a cropped muscle tee and joggers",
] as const;

const ENBY_GARMENTS = [
  "a cropped tank top and high-waisted shorts",
  "an oversized mesh top over a fitted bralette",
  "a cropped hoodie and bike shorts",
  "a sleeveless bodysuit",
] as const;

const POSES = [
  "sitting on the edge of a bed leaning back on both hands",
  "standing and glancing back over one shoulder",
  "lying on their front propped up on their elbows",
  "leaning against a doorframe with hips angled",
  "kneeling upright on soft bedding",
  "sitting cross-legged facing the camera",
  "half-turned in profile looking back at the lens",
  "standing with one hand in their hair",
] as const;

const SETTINGS = [
  "a warmly lit bedroom",
  "a sunlit apartment window",
  "a dim room with neon accent lighting",
  "a hotel suite at golden hour",
  "a bathroom mirror with soft vanity lights",
  "a balcony at dusk with city lights behind",
  "a cosy living room lit by lamplight",
] as const;

// Wardrobe for public-facing portraits: revealing, never bare — and gendered,
// because "lingerie, mini dress" on a male companion is nonsense. Returned as
// booru-style TAGS placed near the front of the prompt: Pony weights early
// tokens hardest, and the same direction written as trailing prose got ignored
// (first regen of a male model came back shirtless).
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

// Trailing prose reinforcement — sets mood, not the wardrobe (that's carried by
// the tags above and the nudity negatives at the call site).
const MOOD =
  "Sexy and revealing but fully covered — nothing exposed. Sultry seductive expression, flirty eye contact with the camera.";

export type PortraitSubject = {
  name: string;
  age: number;
  ethnicity: string;
  gender: string;
  art_style: string;
  short_bio: string;
};

export function portraitPrompt(c: PortraitSubject, extra?: string): string {
  const noun = genderNoun(c.gender);
  const g = (c.gender ?? "").toLowerCase();
  const seed = hashName(c.name);
  // Pony is tag-driven: this booru tag is what actually locks the rendered sex.
  // Prose alone ("a man named Kaito") loses to the negative prompt.
  const genderTag =
    g === "male" || g === "trans-male"
      ? "handsome adult man, solo, male focus"
      : g === "non-binary"
        ? "androgynous person, solo"
        : "attractive woman, solo";
  // Photographic language, not render language. "Ultra photorealistic glamour"
  // steers Pony toward the airbrushed CG look that reads as AI on sight; naming
  // a camera and asking for untouched skin is what actually buys realism.
  // Everything downstream starts from this image — chat photos and the cams
  // clips are image-to-video off it — so the realism ceiling is set right here.
  const style =
    c.art_style === "anime"
      ? "Stylized high-quality anime illustration, cel shaded, expressive, alluring, vertical portrait."
      : "Candid photo taken on a Sony A7 IV with an 85mm f/1.4 lens, natural available light, true-to-life colour, subtle film grain, vertical full-body portrait. Real untouched skin with visible pores, fine texture, faint blemishes and freckles, uneven natural tone, flyaway strands of hair, natural asymmetry, no airbrushing, no smoothing, no retouching. Looks like a real photo of a real person, not a render.";

  return [
    genderTag,
    wardrobeTags(c.gender, seed),
    style,
    `A stunning, sexy ${c.ethnicity} ${noun} named ${c.name} who is exactly ${c.age} years old and clearly looks ${c.age} — age-appropriate face, skin, and body.`,
    `Pose: ${pick(POSES, seed, 3)}, in ${pick(SETTINGS, seed, 4)}.`,
    c.short_bio ? `Vibe: ${c.short_bio}.` : "",
    extra ? `${extra}.` : "",
    MOOD,
  ]
    .filter(Boolean)
    .join(" ");
}
