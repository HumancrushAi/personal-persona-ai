// Builds the image prompt for a companion selfie. Shared by the camera button
// (media.functions) and the auto-selfie when a user asks for a pic in chat.

function genderNoun(gender?: string | null): string {
  const g = (gender ?? "female").toLowerCase();
  if (g === "male" || g === "trans-male") return "man";
  if (g === "non-binary") return "androgynous person";
  return "woman";
}

// Explicit request vocabulary, grouped by category so the nudity gate and the
// pose-tag builder share one source of truth. Add synonyms here and both the
// "is this nude" check and the rendered booru tags pick them up. Adult fictional
// characters only — screenUserMessage still hard-blocks minors, non-consent,
// bestiality, and incest before any of this runs. Each entry is a regex source
// string (no anchors — `kw()` adds word boundaries).
const KW = {
  undress:
    "nude|nudes|naked|nakie|nekkid|unclothed|undress\\w*|strip\\w*|no clothes|without clothes|clothes off|take .{0,10}off|topless|bottomless|bare|exposed|full frontal|birthday suit|in the buff|show everything|show it all|show me all",
  breasts:
    "tits|titties|boobs|boobies|breasts?|nipples?|areolas?|cleavage|rack|knockers|melons|jugs",
  pussy:
    "pussy|pussies|vagina|vulvas?|clit\\w*|labia|cunt|snatch|coochie|cooch|slit|camel\\s*toe|genital\\w*|crotch|down there|between (?:her|your|my) legs|nether\\w*|privates|wet pussy|creamy",
  penis:
    "dick|cock|penis|balls|testicles?|nuts|shaft|hard[- ]?on|erect\\w*|erection|boner|member|bulge|manhood|package",
  ass: "ass|asshole|butthole|butt|buttocks|booty|bum|cheeks|anus|rear end",
  masturbation:
    "masturbat\\w*|finger\\w*|rub\\w*|touch\\w*\\s+(?:her|him|your|my)self|touch\\w*\\s+(?:her|him|your|my)?\\s*(?:pussy|dick|cock|clit|genital\\w*|crotch|nipples?)|play\\w*\\s+with\\s+(?:her|him|your|my)self|play\\w*\\s+with\\s+(?:her|him|your|my)?\\s*(?:pussy|dick|clit|genital\\w*|nipples?)|pleasur\\w*|hand\\s+(?:in|on|down|inside|between|up)|fingers?\\s+(?:in|inside|deep)|jerk\\w*|jack\\w*\\s*off|strok\\w*|edg\\w*|grind\\w*",
  toys: "dildo|vibrator|sex\\s*toy|butt\\s*plug|plug|magic wand|strap[- ]?on|anal beads|fleshlight",
  oral: "blow\\s*job|blowjob|bj|suck\\w*|oral|deep\\s*throat|fellati\\w*|lick\\w*|cunnilingus|rim\\w*|tongue|69",
  anal: "anal|butt\\s*plug|up (?:her|your|my) ass|in (?:her|your|my) ass|ass\\s*fuck\\w*|sodom\\w*|butt stuff",
  sex: "fuck\\w*|sex|penetrat\\w*|insert\\w*|creampie|gape|missionary|reverse cowgirl|gangbang|threesome|orgy",
  cum: "cum\\w*|cream\\s*pie|squirt\\w*|orgasm\\w*|climax\\w*|ahegao|facial|jizz|dripping wet|precum|load",
  fetish:
    "bdsm|bondage|tied up|handcuff\\w*|collar|leash|spank\\w*|chok\\w*|dominat\\w*|submissive|latex|leather|fishnet|garter|corset|maid outfit|schoolgirl outfit|nurse outfit",
  lingerie:
    "lingerie|underwear|panties|thong|bra|bikini|see[- ]?through|sheer|negligee|teddy|babydoll|g[- ]?string|crotchless|stockings|nightie",
};

// Explicit presentation poses that imply the groin/chest will be bare.
const POSES_NUDE =
  "spread\\w*|legs (?:open|spread|apart|up)|on all fours|bent?\\s*over|from\\s+behind|doggy|riding|cowgirl|straddl\\w*|present\\w*|arch\\w*\\s+(?:her|your|my)?\\s*back";

// Wrap a group's source string in word boundaries, case-insensitive.
const kw = (src: string) => new RegExp(`\\b(?:${src})\\b`, "i");

// Acts/anatomy that mean the picture should be explicit (force nudity).
const ACT_RE = kw(
  [KW.masturbation, KW.toys, KW.oral, KW.anal, KW.sex, KW.cum, POSES_NUDE].join("|"),
);

// True when the request implies nudity (so we only force genitalia when the
// groin will actually be bare — a clothed selfie shouldn't be nuded). Lingerie is
// deliberately NOT here: it's clothed-sexy, handled as its own tag.
function requestIsNude(req: string): boolean {
  if (!req.trim()) return true; // default (no request) selfie in this app trends nude
  return (
    kw([KW.undress, KW.breasts, KW.pussy, KW.penis, KW.ass].join("|")).test(req) || ACT_RE.test(req)
  );
}

// Maps request keywords to explicit booru pose/act tags so the picture actually
// shows what was asked (a plain selfie otherwise ignores the described act).
function actionTags(req: string, isMale: boolean): string {
  const ex: string[] = [];
  const has = (src: string) => kw(src).test(req);

  // Anatomy on display (gender-gated; cross-gender parts are blocked upstream).
  if (isMale && has(KW.penis)) ex.push("penis, testicles, full frontal nudity, groin visible");
  if (!isMale && has(KW.pussy)) ex.push("pussy, spread pussy, spread legs, presenting");
  if (!isMale && has(KW.breasts)) ex.push("bare breasts, nipples");

  // Poses.
  if (has(KW.ass) || has("bent?\\s*over|from\\s+behind|doggy|twerk\\w*"))
    ex.push("bent over, presenting, ass, rear view");
  if (has(POSES_NUDE)) ex.push("spread legs, presenting");
  if (has("riding|cowgirl|straddl\\w*")) ex.push("straddling, riding pose");

  // Acts.
  if (has(KW.masturbation))
    ex.push(
      isMale
        ? "male masturbation, hand on penis, stroking, groin visible"
        : "female masturbation, fingering, hand between legs, spread legs, pleasuring herself, touching her pussy",
    );
  if (has(KW.toys)) ex.push("sex toy, dildo, holding a dildo, using sex toy");
  if (has(KW.anal)) ex.push("anal, insertion, bent over, ass, presenting");
  if (has(KW.oral)) ex.push("oral, fellatio, open mouth, tongue out");
  if (has(KW.sex)) ex.push("explicit, spread legs, presenting, penetration");
  if (has(KW.cum)) ex.push("orgasm face, ahegao, fluids, wet");
  if (has(KW.fetish)) ex.push("bondage, restraints, submissive pose, kinky");
  if (has(KW.lingerie)) ex.push("wearing revealing lingerie, sexy lingerie");

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
    kind === "male"
      ? "1boy, solo, male focus"
      : kind === "nb"
        ? "androgynous, solo"
        : "1girl, solo";
  const body =
    kind === "male"
      ? "muscular, abs"
      : kind === "nb"
        ? "androgynous, lean"
        : "curvy, feminine, attractive";

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

// FLUX.1 Kontext (RunPod) EDITS the companion's own photo instead of generating
// a body from scratch, so identity comes from the input frame and the prompt is
// an instruction, not a tag salad — booru tags make Kontext repaint the whole
// picture and lose the face. The explicit vocabulary from actionTags is still
// appended so requested acts actually render; it reads fine as comma phrases.
// Prompt for a photo produced on the image-TO-VIDEO endpoint.
//
// That endpoint is the only uncensored model on the account — the shared FLUX
// Kontext image model returns her clothed no matter how the request is phrased.
// So a photo is generated as a short clip and a frame of it is shown as the
// still. The prompt therefore has to describe a MOVE INTO the explicit state
// (the clip starts from her clothed portrait), and end there, because the frame
// we display is taken from the end of the clip.
// The request arrives as the raw chat message ("send me a pic of you sticking a
// dildo in your ass") and gets dropped straight into "She is ___." — which reads
// as broken grammar to the model and costs prompt adherence. Strip the ask and
// flip second person to third so the sentence describes HER doing the thing.
export function normalizeRequest(req: string, subject: "she" | "he" | "they"): string {
  let s = req.trim();

  // "send me a pic of", "show me", "can you take a photo of", "i wanna see"...
  s = s.replace(
    /^\s*(?:hey|hi|yo|please|pls|plz)?[,\s]*(?:can|could|will|would)?\s*(?:you|u)?\s*(?:please|pls)?\s*(?:send|show|take|snap|give|make|do|shoot|film|record)\s*(?:me|us)?\s*(?:a|an|some|the|another)?\s*(?:new|quick|sexy|hot|nice)?\s*(?:pic(?:ture)?s?|photos?|selfies?|images?|shots?|vids?|videos?|clips?|nudes?)?\s*(?:of|with|where)?\s*/i,
    "",
  );
  s = s.replace(/^\s*(?:i\s*(?:wanna|want\s*to|would\s*like\s*to|'?d\s*like\s*to)\s*see)\s*/i, "");
  s = s.replace(/^\s*(?:lemme|let\s*me)\s*see\s*/i, "");

  const poss = subject === "he" ? "his" : subject === "they" ? "their" : "her";
  const refl = subject === "he" ? "himself" : subject === "they" ? "themselves" : "herself";
  s = s.replace(/\byourself\b/gi, refl);
  s = s.replace(/\byour\b/gi, poss);
  // A leading "you" is the subject of the sentence being built, so translating
  // it would double up ("She is she naked") — drop it instead.
  s = s.replace(/^\s*you\b\s*/i, "");
  s = s.replace(/\byou\b/gi, subject);

  return s.replace(/^[\s,.:;-]+/, "").trim();
}

// The opening sentence of every media prompt, and the only thing that reliably
// stops the crop.
//
// An abstract instruction ("Wide full body shot, nothing cropped") does NOT
// work: tested against the live endpoint, an act-heavy request still came back
// with the head cut off at the mouth. What works is describing a PHOTOGRAPH OF A
// PERSON STANDING IN A ROOM — naming the subject and a standing posture gives
// the model a composition to build, instead of a rule to obey. Same request,
// same start frame, same negatives: subject-anchored framing produced head to
// feet with the face in shot.
function framingFor(noun: string, poss: string): string {
  return `Wide full body photograph of a ${noun} standing in a room, ${poss} whole body visible from head to feet, ${poss} face clearly visible at the top of the frame, camera far away across the room. Not a close-up, not cropped.`;
}

// Photographic language, not render language. "8k masterpiece" vocabulary is
// what produces the airbrushed CG look that reads as AI on sight.
const QUALITY =
  "Candid photograph, natural available light, true-to-life colour, real untouched skin with visible pores and natural texture, natural asymmetry, no airbrushing or smoothing. Looks like a real photo taken on a real camera, not a render. No text, no watermark.";

export function videoStillPrompt(
  c: { gender?: string | null },
  userPrompt?: string | null,
): string {
  const req = (userPrompt ?? "").trim();
  const noun = genderNoun(c.gender);
  const isMale = noun === "man";
  const subject = isMale ? "he" : noun === "woman" ? "she" : "they";

  const undress = requestIsNude(req)
    ? isMale
      ? `${subject} is completely naked, penis and groin visible`
      : `${subject} is completely naked, bare breasts and nipples visible`
    : `${subject} holds the pose`;

  // NOTE: deliberately no actionTags here. Those are booru tags ("bent over,
  // presenting, ass, rear view") written for the Pony IMAGE model, and feeding
  // them to WAN made it compose a tight crop around the act — photos came back
  // as a headless torso, and at higher tag density as an extreme close-up, no
  // matter what the framing text said. The user's own words in plain language
  // render the same act and keep the camera wide.
  const action = normalizeRequest(req, subject) || "posing seductively for the camera";
  const poss = isMale ? "his" : noun === "woman" ? "her" : "their";

  return [
    framingFor(noun, poss),
    `${subject[0].toUpperCase()}${subject.slice(1)} is ${action}.`,
    `${undress}.`,
    QUALITY,
    "The camera stays wide and does not move closer. Settles into a still held pose at the end.",
  ]
    .filter(Boolean)
    .join(" ");
}

// Motion prompt for a real video. Same explicit vocabulary as the still, but it
// keeps MOVING instead of settling — and it undresses when asked, which is what
// was missing: the old builder pasted the raw request into a sentence, so "send
// me a sexy video" produced a clothed clip of her standing in her portrait.
export function videoActionPrompt(
  c: { gender?: string | null },
  userPrompt?: string | null,
): string {
  const req = (userPrompt ?? "").trim();
  const noun = genderNoun(c.gender);
  const isMale = noun === "man";
  const subject = isMale ? "he" : noun === "woman" ? "she" : "they";

  const undress = requestIsNude(req)
    ? isMale
      ? `${subject} strips off all clothing until completely naked, penis and groin visible`
      : `${subject} strips off all clothing until completely naked, bare breasts and nipples visible`
    : `${subject} moves seductively for the camera`;

  // Same reason as videoStillPrompt: no booru tags for this model.
  const action =
    normalizeRequest(req, subject) || "performing a slow seductive striptease for the camera";
  const poss = isMale ? "his" : noun === "woman" ? "her" : "their";

  return [
    framingFor(noun, poss),
    `${subject[0].toUpperCase()}${subject.slice(1)} is ${action}.`,
    `${undress}.`,
    QUALITY,
    "Smooth natural lifelike motion throughout, consistent face and body. The camera stays wide and does not move closer.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function kontextSelfiePrompt(
  c: { age: number; ethnicity: string; gender?: string | null },
  userPrompt?: string | null,
  styleBackstory?: string | null,
): string {
  const req = (userPrompt ?? "").trim();
  const noun = genderNoun(c.gender);
  const isMale = noun === "man";
  const [subject, object] = isMale
    ? ["he", "him"]
    : noun === "woman"
      ? ["she", "her"]
      : ["they", "them"];
  const explicit = actionTags(req, isMale);

  const state = requestIsNude(req)
    ? isMale
      ? "completely naked, no clothing, penis and groin visible"
      : "completely naked, no clothing, bare breasts and nipples visible"
    : `wearing what ${subject} has on`;

  return [
    `Keep the exact same ${noun} from the photo — identical face, hair, skin tone and body. Do not change who ${subject} is.`,
    `${subject[0].toUpperCase()}${subject.slice(1)} is a ${c.age}-year-old ${c.ethnicity} ${noun}.`,
    `Now show ${object} ${req || "taking a seductive selfie, looking at the camera"}, ${state}.`,
    explicit,
    styleBackstory || "",
    "Photorealistic amateur selfie, full body in frame, natural indoor lighting, detailed skin, sharp focus, no text, no watermark.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function selfiePrompt(
  c: {
    name: string;
    age: number;
    ethnicity: string;
    gender?: string | null;
    short_bio?: string | null;
  },
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

// True when the user's message is asking her to send/make a video or clip.
// Checked BEFORE wantsSelfie so "send me a video of you dancing" routes to the
// video pipeline instead of matching the photo detector.
export function wantsVideo(t: string): boolean {
  const s = t.toLowerCase();
  const verbs =
    "send|show|make|record|film|take|do|shoot|lemme see|let me see|can i see|wanna see|i wanna see|i want to see|i want a|i want|give me";
  const noun = "video|videos|vid|vids|clip|clips";
  // verb + (within ~30 chars) a video noun — "make me a video", "send a clip"
  if (new RegExp(`\\b(?:${verbs})\\b[^.?!]{0,30}\\b(?:${noun})\\b`, "i").test(s)) return true;
  // "a video of you", "video for me", "record yourself on video"
  if (
    new RegExp(
      `\\b(?:${noun})\\b[^.?!]{0,20}\\b(?:of you|for me|yourself|of yourself)\\b`,
      "i",
    ).test(s)
  )
    return true;
  return false;
}

// Checks if the user is requesting a cross-gender body part from the companion
export function checkCrossGenderRequest(
  gender: string | null | undefined,
  prompt: string,
): string | null {
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
