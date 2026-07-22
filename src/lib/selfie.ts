// Builds the image prompt for a companion selfie. Shared by the camera button
// (media.functions) and the auto-selfie when a user asks for a pic in chat.

function genderNoun(gender?: string | null): string {
  const g = (gender ?? "female").toLowerCase();
  if (g === "male" || g === "trans-male") return "man";
  if (g === "non-binary") return "androgynous person";
  return "woman";
}

// True when the request implies nudity (so we only force genitalia when the
// groin will actually be bare — a clothed selfie shouldn't be nuded).
function requestIsNude(req: string): boolean {
  return (
    /\b(nude|naked|nudes?|undress|stripped?|strip|no clothes|without clothes|topless|bottomless|pussy|vagina|clit|vulva|dick|cock|penis|balls|shaft|cum|hard|erect)\b/i.test(
      req,
    ) || !req // default (no request) selfie in this app trends nude
  );
}

// Both male and female companions render on Pony Realism (SDXL), which reliably
// produces correct anatomy AND follows explicit pose requests — but only with
// booru-style tags. Natural-language prose makes Pony ambiguous, so the prompt
// is built as comma-separated tags. The `1boy`/`1girl` tag plus the opposite-sex
// negatives (in ai.ts) lock the gender; request keywords map to pose tags so the
// picture matches what the user actually asked for.
function booruPonyPrompt(
  c: { age: number; ethnicity: string },
  req: string,
  styleBackstory: string | null | undefined,
  isMale: boolean,
): string {
  const isNude = requestIsNude(req);
  const noun = isMale ? "man" : "woman";
  const who = isMale ? "1boy, solo, male focus" : "1girl, solo";
  const body = isMale ? "muscular, abs" : "curvy, feminine, attractive";

  let nudeTags = "clothed";
  if (isNude) {
    nudeTags = isMale
      ? "nude, completely naked, no clothing, standing, penis, testicles, pubic hair, groin visible"
      : "nude, completely naked, bare breasts, nipples";
  }

  // Map request keywords to explicit pose/anatomy tags so the shot follows it.
  let explicit = "";
  if (isMale && /\b(dick|cock|penis|balls|shaft|hard|erect)\b/i.test(req)) {
    explicit = "penis, testicles, full frontal nudity, groin visible";
  } else if (!isMale && /\b(pussy|vagina|clit|vulva|spread|bend|bent over|from behind|doggy|ass|butt|behind|twerk)\b/i.test(req)) {
    explicit = "pussy, spread pussy, spread legs, presenting, ass, rear view";
  }

  const tags = [
    "source_photo, realistic, photorealistic, raw photo",
    who,
    `mature adult ${c.ethnicity} ${noun}, ${c.age} years old`,
    body,
    "full body, mirror selfie, holding phone, indoor, detailed skin",
    nudeTags,
    explicit,
    req || "looking at viewer, seductive",
    styleBackstory || "",
  ];
  return tags.filter(Boolean).join(", ");
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

  // Male and female both use the booru-tag Pony prompt (reliable anatomy +
  // follows explicit requests). Only non-binary falls back to Flux prose.
  if (!isNb) return booruPonyPrompt(c, req, styleBackstory, isMan);

  const isNude = requestIsNude(req);
  return [
    isNude
      ? `Full-body nude mirror selfie photo, photorealistic, of ${c.name}, a ${c.age}-year-old ${c.ethnicity} androgynous person who clearly looks exactly ${c.age}. They stand back from the mirror so the ENTIRE body from head to at least mid-thigh is visible.`
      : `Photorealistic amateur selfie photo of ${c.name}, a ${c.age}-year-old ${c.ethnicity} androgynous person who clearly looks exactly ${c.age}.`,
    `Soft warm lighting, intimate bedroom or apartment, shot on an iPhone, natural skin texture, highly detailed, realistic, not illustrated.`,
    styleBackstory ? `Their look/vibe: ${styleBackstory}.` : "",
    req
      ? `They are doing EXACTLY this — this is the MAIN subject of the photo, follow it precisely: ${req}.`
      : `They smile seductively at the camera, sexy and inviting.`,
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
