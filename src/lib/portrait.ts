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

// Wardrobe for public-facing portraits: revealing, never bare — and gendered,
// because "lingerie, mini dress" on a male companion is nonsense. Returned as
// booru-style TAGS placed near the front of the prompt: Pony weights early
// tokens hardest, and the same direction written as trailing prose got ignored
// (first regen of a male model came back shirtless).
function wardrobeTags(gender: string): string {
  const g = (gender ?? "").toLowerCase();
  if (g === "male" || g === "trans-male") {
    return "fully clothed, wearing an open unbuttoned shirt over a tight fitted tank top, low slung jeans, visible clothing on chest and torso";
  }
  if (g === "non-binary") {
    return "fully clothed, wearing a tight cropped top and high-waisted shorts, revealing but covered, visible clothing on chest and torso";
  }
  return "fully clothed, wearing skimpy lingerie, lace bra and panties, or a tight short mini dress, revealing but covered, visible clothing on chest and torso";
}

// Trailing prose reinforcement — sets mood and pose, not the wardrobe (that's
// carried by the tags above and the nudity negatives at the call site).
export const SKIMPY_WARDROBE =
  "Sexy and revealing but fully covered — nothing exposed. Sultry seductive expression, flirty eye contact with the camera, confident and alluring pose, intimate bedroom/boudoir setting.";

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
  // Pony is tag-driven: this booru tag is what actually locks the rendered sex.
  // Prose alone ("a man named Kaito") loses to the negative prompt.
  const genderTag =
    g === "male" || g === "trans-male"
      ? "1boy, solo, male focus"
      : g === "non-binary"
        ? "androgynous, solo"
        : "1girl, solo";
  const style =
    c.art_style === "anime"
      ? "Stylized high-quality anime illustration, cel shaded, expressive, alluring, vertical portrait."
      : "Ultra photorealistic glamour portrait photograph, natural skin texture and pores, soft warm lighting, shot on a 50mm DSLR, shallow depth of field, sharp focus, high detail, vertical portrait.";

  return [
    genderTag,
    wardrobeTags(c.gender),
    style,
    `A stunning, sexy ${c.ethnicity} ${noun} named ${c.name} who is exactly ${c.age} years old and clearly looks ${c.age} — age-appropriate face, skin, and body.`,
    c.short_bio ? `Vibe: ${c.short_bio}.` : "",
    extra ? `${extra}.` : "",
    SKIMPY_WARDROBE,
  ]
    .filter(Boolean)
    .join(" ");
}
