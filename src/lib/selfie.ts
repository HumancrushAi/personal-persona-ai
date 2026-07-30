// Builds the image prompt for a companion selfie. Shared by the camera button
// (media.functions) and the auto-selfie when a user asks for a pic in chat.

function genderNoun(gender?: string | null): string {
  const g = (gender ?? "female").toLowerCase();
  if (g === "male" || g === "trans-male") return "man";
  if (g === "non-binary") return "androgynous person";
  return "woman";
}

// Explicit sexual acts/toys a request might describe. Kept separate so both the
// nudity check and the pose-tag builder can use it — asking her to use a toy or
// touch herself must both trigger nudity AND render the actual act.
const ACT_RE =
  /\b(masturbat\w*|finger\w*|rub\w*|touch\w*\s+(?:her|him|your|my)self|play\w*\s+with\s+(?:her|him|your|my)self|pleasur\w*|dildo|vibrator|sex\s*toy|butt\s*plug|anal|blow\s*job|blowjob|suck\w*|oral|deepthroat|cum|squirt\w*|spread\w*|bent?\s*over|from\s+behind|doggy|twerk\w*|riding|cowgirl)\b/i;

// True when the request implies nudity (so we only force genitalia when the
// groin will actually be bare — a clothed selfie shouldn't be nuded).
function requestIsNude(req: string): boolean {
  return (
    /\b(nude|naked|nudes?|undress|stripped?|strip|no clothes|without clothes|topless|bottomless|pussy|vagina|clit|vulva|dick|cock|penis|balls|shaft|hard|erect|tits|boobs|breasts|ass|butt)\b/i.test(
      req,
    ) ||
    ACT_RE.test(req) ||
    !req // default (no request) selfie in this app trends nude
  );
}

// Maps request keywords to explicit booru pose/act tags so the picture actually
// shows what was asked (a plain selfie otherwise ignores the described act).
function actionTags(req: string, isMale: boolean): string {
  const r = req.toLowerCase();
  const ex: string[] = [];
  const has = (re: RegExp) => re.test(r);

  if (isMale && has(/\b(dick|cock|penis|balls|shaft|hard|erect)\b/))
    ex.push("penis, testicles, full frontal nudity, groin visible");
  if (!isMale && has(/\b(pussy|vagina|clit|vulva|labia)\b/))
    ex.push("pussy, spread pussy, spread legs, presenting");

  if (has(/\b(bent?\s*over|from\s+behind|doggy|twerk\w*|ass|butt|behind)\b/))
    ex.push("bent over, presenting, ass, rear view");
  if (has(/\bspread\w*\b/)) ex.push("spread legs");
  if (has(/\b(masturbat\w*|finger\w*|rub\w*|touch\w*\s+(?:her|him|your|my)self|play\w*\s+with\s+(?:her|him|your|my)self|pleasur\w*)\b/))
    ex.push(
      isMale
        ? "male masturbation, hand on penis, stroking"
        : "female masturbation, fingering, hand between legs, spread legs, pleasuring herself",
    );
  if (has(/\b(dildo|vibrator|sex\s*toy)\b/)) ex.push("sex toy, dildo, holding a dildo, using sex toy");
  if (has(/\b(anal|butt\s*plug|up\s+(?:her|your|my)\s+ass|in\s+(?:her|your|my)\s+ass)\b/))
    ex.push("anal, dildo in ass, insertion, bent over, ass");
  if (has(/\b(blow\s*job|blowjob|suck\w*|oral|deepthroat)\b/)) ex.push("oral, fellatio, open mouth, tongue out");
  if (has(/\b(riding|cowgirl)\b/)) ex.push("straddling, riding pose");

  return ex.join(", ");
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
  kind: "male" | "female" | "nb",
): string {
  const isMale = kind === "male";
  const isNude = requestIsNude(req);
  const noun = kind === "male" ? "man" : kind === "nb" ? "androgynous person" : "woman";
  const who =
    kind === "male" ? "1boy, solo, male focus" : kind === "nb" ? "androgynous, solo" : "1girl, solo";
  const body =
    kind === "male" ? "muscular, abs" : kind === "nb" ? "androgynous, lean" : "curvy, feminine, attractive";

  let nudeTags = "clothed";
  if (isNude) {
    nudeTags =
      kind === "male"
        ? "nude, completely naked, no clothing, standing, penis, testicles, pubic hair, groin visible"
        : "nude, completely naked, bare chest, nipples";
  }

  // Pose/act tags follow the request regardless of gender; anatomy in actionTags
  // is keyed off the requested body parts, not the companion's kind.
  const explicit = actionTags(req, isMale);

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

  // Every gender now renders on the booru-tag Pony prompt so explicit pose
  // requests are followed reliably (non-binary previously used Flux prose,
  // which ignored the request).
  const kind = noun === "man" ? "male" : noun === "androgynous person" ? "nb" : "female";
  return booruPonyPrompt(c, req, styleBackstory, kind);
}

// True when the user's message is asking her to send a picture/selfie/nude.
// Precision matters: a false positive redirects a normal text message into a
// paid (8-credit) image generation, so the object must be an actual
// picture/body noun — bare "you" is deliberately NOT a trigger ("see you
// tomorrow", "show you how I feel" must stay text).
const SELFIE_OBJECT =
  "pic|pics|picture|pictures|photo|photos|image|images|selfie|selfies|nude|nudes|naked|topless|body|tits|boobs|breasts|cleavage|pussy|vagina|ass|butt|booty|dick|cock|penis|lingerie|underwear|bra|panties|thong|bikini";

export function wantsSelfie(t: string): boolean {
  const s = t.toLowerCase();
  // Direct, unambiguous phrasings.
  if (
    /\b(selfie|nudes?|send me a pic|send a pic|send pic|show me your|show me some|lemme see your|let me see your|can i see your|wanna see your|i wanna see your)\b/.test(
      s,
    )
  )
    return true;
  // Verb + (within ~30 chars) a concrete picture/body object.
  const verbs =
    "send|show|snap|take|lemme see|let me see|can i see|could i see|wanna see|i wanna see|i want to see|i'?d love to see|i want a|i want some|give me";
  const re = new RegExp(`\\b(?:${verbs})\\b[^.?!]{0,30}\\b(?:${SELFIE_OBJECT})\\b`, "i");
  return re.test(s);
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
