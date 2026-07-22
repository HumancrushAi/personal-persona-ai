// Builds the image prompt for a companion selfie. Shared by the camera button
// (media.functions) and the auto-selfie when a user asks for a pic in chat.

function genderNoun(gender?: string | null): string {
  const g = (gender ?? "female").toLowerCase();
  if (g === "male" || g === "trans-male") return "man";
  if (g === "non-binary") return "androgynous person";
  return "woman";
}

export function selfiePrompt(
  c: { name: string; age: number; ethnicity: string; gender?: string | null; short_bio?: string | null },
  userPrompt?: string | null,
  styleBackstory?: string | null,
): string {
  const req = (userPrompt ?? "").trim();
  const noun = genderNoun(c.gender);

  const isMan = noun === "man";
  const isNb = noun === "androgynous person";

  const subject = isMan ? "He" : isNb ? "They" : "She";
  const possessive = isMan ? "His" : isNb ? "Their" : "Her";
  const verb = isNb ? "smile" : "smiles";

  // Whether the shot involves any nudity (so we force explicit genitalia only
  // when the groin will actually be bare — a clothed selfie shouldn't be nuded).
  const isNude =
    /\b(nude|naked|nudes?|undress|stripped?|strip|no clothes|without clothes|topless|bottomless|pussy|vagina|clit|vulva|dick|cock|penis|balls|shaft|cum|hard|erect)\b/i.test(
      req,
    ) || !req; // default (no request) selfie in this app trends nude

  // Anatomy anchor — the image backend is Flux (nsfw-flux-dev): no negative
  // prompt, and it DRAWS any body part it sees named — even a negated one
  // ("no vagina" still produces a vagina). So: positive-only, front-loaded
  // strong tokens, and never name the wrong gender's anatomy.
  let anatomyAnchor = "";
  if (noun === "man") {
    anatomyAnchor = isNude
      ? "Male anatomy, masculine physique: flat muscular chest, defined abs, and a realistic, anatomically accurate, correctly-formed adult male penis with a shaft and a scrotum with testicles hanging at the groin. Accurate, detailed, natural male genitalia."
      : "Masculine male physique, flat muscular chest, broad shoulders.";
  } else if (noun === "woman") {
    anatomyAnchor = isNude
      ? "Female anatomy: natural breasts and a realistic vulva at the groin. Accurate female genitalia."
      : "Feminine female physique, natural breasts.";
  }

  // Enhancement for explicit anatomical requests
  let explicitEnhancement = "";
  if (noun === "woman") {
    if (/\b(pussy|vagina|clit|vulva|naked bottom|spread|panties off|naked down)\b/i.test(req)) {
      explicitEnhancement = "Explicit close-up photo of her naked, uncovered vagina and pussy, spread legs, fully visible exposed genitalia, completely nude, no underwear.";
    }
  } else if (noun === "man") {
    if (/\b(dick|cock|penis|balls|shaft)\b/i.test(req)) {
      explicitEnhancement =
        "Explicit full-frontal nude photo: completely naked, no clothing and no underwear, his anatomically accurate, correctly-formed adult penis and scrotum with testicles fully exposed and clearly visible at the groin, framed to show the groin and genitals centered, not cropped above the waist.";
    }
  }

  const maleTag = isMan ? " (biologically male, masculine body)" : "";

  return [
    // Nude shots lead with full-body framing so the model doesn't crop to a
    // face/waist-up portrait and hide the genitals; clothed shots keep the
    // normal selfie framing.
    isNude
      ? `Full-body nude mirror selfie photo, photorealistic, of ${c.name}, a ${c.age}-year-old ${c.ethnicity} ${noun}${maleTag} who clearly looks exactly ${c.age}. ${subject} stands back from the mirror so the ENTIRE body from head to at least mid-thigh is visible, groin centered in frame, completely naked with no clothing and no underwear.`
      : `Photorealistic amateur selfie photo of ${c.name}, a ${c.age}-year-old ${c.ethnicity} ${noun}${maleTag} who clearly looks exactly ${c.age}.`,
    anatomyAnchor,
    `Soft warm lighting, intimate bedroom or apartment, shot on an iPhone, natural skin texture, highly detailed, realistic, not illustrated.`,
    styleBackstory ? `${possessive} look/vibe: ${styleBackstory}.` : "",
    req
      ? `${subject} is doing EXACTLY this — this is the MAIN subject of the photo, follow it precisely: ${req}.`
      : `${subject} ${verb} seductively at the camera, sexy and inviting.`,
    explicitEnhancement,
    `Frame and pose to match the request (full body, close-up, or explicit as asked). Sexy and provocative; explicit nudity is allowed when the request calls for it.`,
  ]
    .filter(Boolean)
    .join(" ");
}

// True when the user's message is asking her to send a picture/selfie/nude.
export function wantsSelfie(t: string): boolean {
  const s = t.toLowerCase();
  if (/\b(selfie|nudes?|send me a pic|send a pic|send pic|show me your|show mw your|show m3 your|show ne your|show md your)\b/.test(s)) return true;
  return /(send|show|snap|take|lemme see|let me see|can i see|wanna see|i wanna see|i want to see|i want a|give me|give)\b[^.]{0,30}\b(pic|picture|photo|image|body|tits|boobs|breasts|pussy|vagina|ass|butt|naked|nude|you|dick|cock|penis)\b/.test(
    s,
  );
}

// Checks if the user is requesting a cross-gender body part from the companion
export function checkCrossGenderRequest(gender: string | null | undefined, prompt: string): string | null {
  const g = (gender ?? "female").toLowerCase();
  const p = prompt.toLowerCase();
  
  const maleTerms = /\b(dick|cock|penis|balls|male chest|man chest|guy chest|male body)\b/;
  const femaleTerms = /\b(pussy|vagina|clit|vulva|female body|breasts|tits|boobs)\b/;

  if (g === "female" || g === "trans-female") {
    if (maleTerms.test(p)) {
      return "No silly, I'm a girl! 😅 I can only send pics of my own body.";
    }
  } else if (g === "male" || g === "trans-male") {
    if (femaleTerms.test(p)) {
      return "No silly, I'm a guy! 😅 I can only send pics of my own body.";
    }
  }
  return null;
}
