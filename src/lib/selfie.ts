// Builds the image prompt for a companion selfie. Shared by the camera button
// (media.functions) and the auto-selfie when a user asks for a pic in chat.

import { TOY_VOCAB, propClause } from "./props";

function genderNoun(gender?: string | null): string {
  const g = (gender ?? "female").toLowerCase();
  if (g === "male" || g === "trans-male" || g === "transman") return "man";
  if (g.includes("trans-female") || g.includes("trans_female") || g.includes("transwoman") || g.includes("futa") || g.includes("shemale"))
    return "transgender woman";
  if (g === "non-binary" || g === "nb") return "androgynous person";
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
    "tits|titties|boobs|boobies|breasts?|nipples?|areolas?|cleavage|rack|knockers|melons|jugs|globes|chest|bust|headlights|twins|funbags|hooters|ta-tas|bazookas|pillows",
  pussy:
    "pussy|pussies|vagina|vulvas?|clit\\w*|labia|cunt|snatch|coochie|cooch|slit|camel\\s*toe|genital\\w*|crotch|down there|between (?:her|your|my) legs|nether\\w*|privates|wet pussy|creamy|muff|beaver|honeypot|kitty|cat|tunnel|box|flower|gash|cherry|taco|pie|peach|hole|entrance|flowerbed|front hole|love tunnel|pink",
  penis:
    "dick|cock|penis|balls|testicles?|nuts|shaft|hard[- ]?on|erect\\w*|erection|boner|member|bulge|manhood|package|prick|rod|schlong|dong|meat|python|tool|third leg|piece|willy|tallywacker|sausage|wood|knob|pecker|joystick|hose|bone|hog|monster|lance|spear|phallus|one-eyed jack|junk|crown jewels|trouser snake|love-stick",
  ass: "ass|asshole|butthole|butt|buttocks|booty|bum|cheeks|anus|rear end|derriere|peach|tush|bottom|backside|bootycheeks|trunk",
  masturbation:
    "masturbat\\w*|finger\\w*|rub\\w*|touch\\w*\\s+(?:her|him|your|my)self|touch\\w*\\s+(?:her|him|your|my)?\\s*(?:pussy|dick|cock|clit|genital\\w*|crotch|nipples?)|play\\w*\\s+with\\s+(?:her|him|your|my)self|play\\w*\\s+with\\s+(?:her|him|your|my)?\\s*(?:pussy|dick|cock|clit|genital\\w*|nipples?)|pleasur\\w*|hand\\s+(?:in|on|down|inside|between|up)|fingers?\\s+(?:in|inside|deep)|jerk\\w*|jack\\w*\\s*off|strok\\w*|edg\\w*|grind\\w*",
  toys: TOY_VOCAB,
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
export function requestIsNude(req: string): boolean {
  if (!req.trim()) return true; // default (no request) selfie in this app trends nude
  return (
    kw([KW.undress, KW.breasts, KW.pussy, KW.penis, KW.ass].join("|")).test(req) || ACT_RE.test(req)
  );
}

// Maps request keywords to explicit booru pose/act tags so the picture actually
// shows what was asked (a plain selfie otherwise ignores the described act).
function actionTags(req: string, isMale: boolean, isTransFemale?: boolean): string {
  const ex: string[] = [];
  const has = (src: string) => kw(src).test(req);

  // Anatomy on display (gender-gated; trans female / futa has penis AND breasts).
  if (isTransFemale) {
    if (has(KW.penis))
      ex.push(
        "trans female, futanari, anatomically correct penis, erect cock, penis shaft, testicles, full frontal nudity, groin visible, female body with male genitalia",
      );
    if (has(KW.pussy)) ex.push("pussy, detailed pussy, spread pussy, spread legs, presenting");
    if (has(KW.breasts))
      ex.push("firm perky bare breasts, rounded uplifted bust, perky erect nipples");
  } else if (isMale) {
    if (has(KW.penis))
      ex.push(
        "anatomically correct penis, erect cock, penis shaft, testicles, full frontal nudity, groin visible, male focus",
      );
    if (has(KW.breasts)) ex.push("muscular male chest, abs");
  } else {
    if (has(KW.pussy))
      ex.push(
        "photorealistic pussy, detailed naturally shaped pussy, soft outer and inner labia, visible clitoris, glistening wetness, spread pussy, spread legs, presenting",
      );
    if (has(KW.breasts))
      ex.push("firm perky bare breasts, rounded uplifted bust, perky erect nipples");
  }

  // Poses.
  if (has(KW.ass) || has("bent?\\s*over|from\\s+behind|doggy|twerk\\w*"))
    ex.push("bent over, presenting, ass, rear view");
  if (has(POSES_NUDE)) ex.push("spread legs, presenting");
  if (has("riding|cowgirl|straddl\\w*")) ex.push("straddling, riding pose");

  // Acts.
  if (has(KW.masturbation))
    ex.push(
      isTransFemale
        ? "futanari masturbation, hand on penis, stroking erect cock, bare breasts, perky erect nipples, groin visible"
        : isMale
          ? "male masturbation, hand on penis, stroking erect cock, groin visible"
          : "female masturbation, fingering, hand between legs, spread legs, pleasuring herself, touching her pussy, reclining on bed",
    );
  if (has(KW.toys)) {
    const toyTag =
      !isMale && has(KW.pussy)
        ? "sex toy, dildo, dildo inserted in her pussy down at her crotch, hands low between her legs, sex toy away from face and mouth, female anatomy"
        : "sex toy, dildo, using sex toy, hands low away from face";
    ex.push(toyTag);
  }
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
  c: { age: number; ethnicity: string; gender?: string | null },
  req: string,
  styleBackstory: string | null | undefined,
  kind: "male" | "female" | "trans-female" | "nb",
): string {
  const isMale = kind === "male";
  const isTransFemale = kind === "trans-female";
  const isNude = requestIsNude(req);
  const noun = isMale
    ? "man"
    : isTransFemale
      ? "transgender woman"
      : kind === "nb"
        ? "androgynous person"
        : "woman";
  const who = isMale
    ? "1boy, solo, male focus"
    : isTransFemale
      ? "1girl, solo, trans female, futanari"
      : kind === "nb"
        ? "androgynous, solo"
        : "1girl, solo";
  const body = isMale
    ? "muscular, abs, handsome male"
    : isTransFemale
      ? "curvy, feminine, attractive, firm perky breasts, female body with male genitalia"
      : kind === "nb"
        ? "androgynous, lean"
        : "curvy, feminine, attractive, firm perky breasts";

  let nudeTags = "clothed";
  if (isNude) {
    if (isMale) {
      nudeTags =
        "nude, completely naked, no clothing, standing, anatomically correct penis, erect cock, penis shaft, testicles, pubic hair, groin visible, male anatomy";
    } else if (isTransFemale) {
      nudeTags =
        "nude, completely naked, 1girl, trans female, futanari, firm perky bare breasts, rounded uplifted bust, perky erect nipples, anatomically correct penis, erect cock, penis shaft, testicles, pubic hair, groin visible, female body with male genitalia";
    } else {
      nudeTags =
        "nude, completely naked, firm perky bare breasts, rounded uplifted bust, perky erect nipples, detailed photorealistic pussy, vulva, labia, clitoris, pubic hair, groin visible";
    }
  }

  // Pose/act tags follow the request regardless of gender; anatomy in actionTags
  // is keyed off the requested body parts, not the companion's kind.
  const explicit = actionTags(req, isMale, isTransFemale);

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
    /^\s*(?:hey|hi|yo|please|pls|plz)?[,\s]*(?:can|could|will|would)?\s*(?:you|u)?\s*(?:please|pls)?\s*(?:send|show|take|snap|give|make|do|shoot|film|record)\s*(?:me|us)?\s*(?:a|an|some|the|another)?\s*(?:new|quick|sexy|hot|nice)?\s*(?:pictures?|pics?|photos?|selfies?|images?|shots?|videos?|vids?|clips?|nudes?)?\s*(?:of|with|where)?\s*/i,
    "",
  );
  s = s.replace(/^\s*(?:i\s*(?:wanna|want\s*to|would\s*like\s*to|'?d\s*like\s*to)\s*see)\s*/i, "");
  s = s.replace(/^\s*(?:lemme|let\s*me)\s*see\s*/i, "");
  // Bare noun phrases with no verb ("a video of you bouncing…") slipped past the
  // patterns above, so the request kept its lead-in and came out as "She is a
  // video of she bouncing on a dick."
  s = s.replace(
    /^\s*(?:a|an|another|some)?\s*(?:new|quick|sexy|hot|nice)?\s*(?:pictures?|pics?|photos?|selfies?|images?|shots?|videos?|vids?|clips?|nudes?)\s*(?:of|with)?\s*/i,
    "",
  );

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

// Detects close-up / POV / close proximity requests so framing doesn't force a wide camera shot.
export const CLOSE_UP_RE =
  /\b(close[- ]?ups?|close to|in my face|to my face|in front of my face|against the camera|near camera|close to camera|pov|point of view|macro|tight shot|intimate view|front of camera|up close|zoom\w*|zoomed|right up|face in your)\b/i;

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
function framingFor(
  noun: string,
  poss: string,
  posed: boolean,
  hasReq: boolean,
  name?: string,
  isCloseUp?: boolean,
): string {
  if (isCloseUp) {
    return `Intimate close-up POV photograph of a ${noun}, camera positioned close to ${poss} body from a first-person perspective, focus sharp on ${poss} body and details, natural intimate angle.`;
  }
  let stance = " standing";
  if (posed || hasReq) {
    stance = "";
  } else if (name) {
    // Pick an intimate, natural posture instead of default standing
    const postures = ["lying on bed", "sitting on the edge of the bed", "reclining on a couch"];
    const hash = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    stance = " " + postures[hash % postures.length];
  }
  return `Wide full body photograph of a ${noun}${stance} in a room, ${poss} whole body visible from head to feet, ${poss} face clearly visible at the top of the frame, camera far away across the room. Not a close-up, not cropped.`;
}

// Requests that carry their own posture, which "standing" would fight.
const POSTURE_RE =
  /\b(ride|riding|bounc\w*|sit\w*|sitting|lying|lie|laid|kneel\w*|bent|bend\w*|squat\w*|straddl\w*|on all fours|doggy|cowgirl|on her back|on his back|leaning|crawl\w*|spread\w*|masturbat\w*|finger\w*|rub\w*|touch\w*|play\w*|dildo\w*|toy\w*|plug\w*|suck\w*|blowjob|bj|oral|anal|fuck\w*|sex|penetrat\w*|insert\w*)\b/i;

// Photographic language, not render language. "8k masterpiece" vocabulary is
// what produces the airbrushed CG look that reads as AI on sight.
const QUALITY =
  "Candid photograph, 35mm lens, natural available light, true-to-life colour, real untouched skin with visible pores and natural texture, micro skin details, fine peach fuzz, natural skin sheen, natural asymmetry, no airbrushing or smoothing. Looks like a real photo taken on a real camera, not a render. No text, no watermark.";

export function videoStillPrompt(
  c: { gender?: string | null; name?: string },
  userPrompt?: string | null,
): string {
  const req = (userPrompt ?? "").trim();
  const g = (c.gender ?? "").toLowerCase();
  const reqLower = req.toLowerCase();
  const isTransFemale =
    g.includes("trans-female") ||
    g.includes("trans_female") ||
    g.includes("transwoman") ||
    g.includes("futa") ||
    g.includes("shemale") ||
    /\b(trans|transgender|futa|futanari|shemale|ladyboy|dickgirl)\b/i.test(reqLower);

  const noun = isTransFemale ? "transgender woman" : genderNoun(c.gender);
  const isMale = noun === "man";
  const subject = isMale ? "he" : noun === "woman" || isTransFemale ? "she" : "they";

  const undress = requestIsNude(req)
    ? isMale
      ? `${subject} is already completely naked with no clothing on at all, anatomically correct erect penis and cock and testicles visible, male anatomy, bare skin`
      : isTransFemale
        ? `${subject} is already completely naked with no clothing on at all, firm perky bare breasts and perky erect nipples visible, rounded uplifted bust, combined with an anatomically correct erect penis and cock and testicles visible, transgender female anatomy`
        : `${subject} is already completely naked with no clothing on at all, firm perky bare breasts and perky nipples visible, rounded uplifted bust, highly detailed photorealistic pussy with naturally shaped vulva and labia visible, clitoris visible, wet glistening skin, female anatomy`
    : `${subject} holds the pose`;

  // NOTE: deliberately no actionTags here. Those are booru tags ("bent over,
  // presenting, ass, rear view") written for the Pony IMAGE model, and feeding
  // them to WAN made it compose a tight crop around the act — photos came back
  // as a headless torso, and at higher tag density as an extreme close-up, no
  // matter what the framing text said. The user's own words in plain language
  // render the same act and keep the camera wide.
  const action = normalizeRequest(req, subject) || "posing seductively for the camera";
  const poss = isMale ? "his" : "her";
  const isCloseUp = CLOSE_UP_RE.test(req);

  return [
    framingFor(noun, poss, POSTURE_RE.test(req), !!req, c.name, isCloseUp),
    `${subject[0].toUpperCase()}${subject.slice(1)} is ${action}.`,
    `${undress}.`,
    propClause(req, { isMale }),
    QUALITY,
    isCloseUp
      ? "Intimate POV perspective, camera stays close in focus. Settles into a still held pose at the end."
      : "The camera stays wide and does not move closer. Settles into a still held pose at the end.",
  ]
    .filter(Boolean)
    .join(" ");
}

// Motion prompt for a real video. Same explicit vocabulary as the still, but it
// keeps MOVING instead of settling — and it undresses when asked, which is what
// was missing: the old builder pasted the raw request into a sentence, so "send
// me a sexy video" produced a clothed clip of her standing in her portrait.
export function videoActionPrompt(
  c: { gender?: string | null; name?: string },
  userPrompt?: string | null,
): string {
  const req = (userPrompt ?? "").trim();
  const g = (c.gender ?? "").toLowerCase();
  const reqLower = req.toLowerCase();
  const isTransFemale =
    g.includes("trans-female") ||
    g.includes("trans_female") ||
    g.includes("transwoman") ||
    g.includes("futa") ||
    g.includes("shemale") ||
    /\b(trans|transgender|futa|futanari|shemale|ladyboy|dickgirl)\b/i.test(reqLower);

  const noun = isTransFemale ? "transgender woman" : genderNoun(c.gender);
  const isMale = noun === "man";
  const subject = isMale ? "he" : noun === "woman" || isTransFemale ? "she" : "they";

  const undress = requestIsNude(req)
    ? isMale
      ? `${subject} is already completely naked with no clothing on at all, anatomically correct erect penis and cock and testicles visible, male anatomy, bare skin throughout`
      : isTransFemale
        ? `${subject} is already completely naked with no clothing on at all, firm perky bare breasts and perky erect nipples visible, rounded uplifted bust, combined with an anatomically correct erect penis and cock and testicles visible throughout, transgender female anatomy`
        : `${subject} is already completely naked with no clothing on at all, firm perky bare breasts and perky nipples visible, rounded uplifted bust, highly detailed photorealistic pussy with naturally shaped vulva and labia visible, clitoris visible, wet glistening skin throughout, female anatomy`
    : `${subject} moves seductively for the camera`;

  // Same reason as videoStillPrompt: no booru tags for this model.
  const action =
    normalizeRequest(req, subject) || "performing a slow seductive striptease for the camera";
  const poss = isMale ? "his" : "her";
  const isCloseUp = CLOSE_UP_RE.test(req);

  return [
    framingFor(noun, poss, POSTURE_RE.test(req), !!req, c.name, isCloseUp),
    `${subject[0].toUpperCase()}${subject.slice(1)} is ${action}.`,
    `${undress}.`,
    propClause(req, { isMale }),
    QUALITY,
    isCloseUp
      ? "Smooth natural lifelike motion throughout, consistent face and body. Intimate POV camera perspective."
      : "Smooth natural lifelike motion throughout, consistent face and body. The camera stays wide and does not move closer.",
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
  const g = (c.gender ?? "").toLowerCase();
  const reqLower = req.toLowerCase();
  const isTransFemale =
    g.includes("trans-female") ||
    g.includes("trans_female") ||
    g.includes("transwoman") ||
    g.includes("futa") ||
    g.includes("shemale") ||
    /\b(trans|transgender|futa|futanari|shemale|ladyboy|dickgirl)\b/i.test(reqLower);

  const noun = isTransFemale ? "transgender woman" : genderNoun(c.gender);
  const isMale = noun === "man";
  const [subject, object] = isMale
    ? ["he", "him"]
    : noun === "woman" || isTransFemale
      ? ["she", "her"]
      : ["they", "them"];
  const explicit = actionTags(req, isMale, isTransFemale);

  const state = requestIsNude(req)
    ? isMale
      ? "completely naked, no clothing, anatomically correct penis and cock and groin visible"
      : isTransFemale
        ? "completely naked, no clothing, firm perky bare breasts, nipples, and anatomically correct penis and cock visible, trans female anatomy"
        : "completely naked, no clothing, firm perky bare breasts, nipples, and detailed photorealistic pussy visible, female anatomy"
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
  const g = (c.gender ?? "").toLowerCase();
  const reqLower = req.toLowerCase();
  const isTransFemale =
    g.includes("trans-female") ||
    g.includes("trans_female") ||
    g.includes("transwoman") ||
    g.includes("futa") ||
    g.includes("shemale") ||
    /\b(trans|transgender|futa|futanari|shemale|ladyboy|dickgirl)\b/i.test(reqLower);

  const noun = genderNoun(c.gender);
  const kind = isTransFemale
    ? "trans-female"
    : noun === "man"
      ? "male"
      : noun === "androgynous person"
        ? "nb"
        : "female";
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

  // "show me what you're wearing", "show me what you have on". Deliberately
  // narrow: "show me how you feel" and "show me why" are ordinary chat.
  if (/\bshow me what (?:you'?re|you are|you)\b/.test(s)) return true;

  // "let me see you in the shower", "can i see you naked" — asking to see HER,
  // not her photos. "see you tomorrow/later/soon" is a goodbye, not a request.
  if (
    /\b(?:lemme|let me|can i|could i|wanna|i wanna|i want to)\s+see (?:you|u)\b/.test(s) &&
    !/\bsee (?:you|u)\s+(?:tomorrow|later|soon|then|around|next|in a bit|in a min)/.test(s)
  )
    return true;

  // A message that is essentially just the noun: "pic please", "photo?",
  // "gimme a pic babe". Capped at five words so "i really loved those pics you
  // sent me earlier" stays a comment about photos rather than a new order.
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= 5 && /\b(?:pic|pics|picture|photo|selfie|nude|nudes)\b/.test(s)) return true;

  // Verb + (within ~30 chars) a concrete picture/body object.
  const verbs =
    "send|show|snap|take|lemme see|let me see|can i see|could i see|wanna see|i wanna see|i want to see|i'?d love to see|i want a|i want some|give me|gimme|can i get|could i get|lemme get|let me get|get me";
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
  // "record yourself twerking", "film yourself dancing" — the camera verb plus
  // herself is a video request even with no "video"/"clip" noun in the message.
  if (/\b(?:record|film)\s+(?:yourself|you|u)\b/.test(s)) return true;
  return false;
}

// Checks if the user is requesting a cross-gender body part from the companion
export function checkCrossGenderRequest(
  gender: string | null | undefined,
  prompt: string,
): string | null {
  const g = (gender ?? "female").toLowerCase();
  const p = prompt.toLowerCase();

  // Transgender females / futas have male genitalia (penis/cock) and female body/breasts
  const isTransFemale =
    g.includes("trans-female") ||
    g.includes("trans_female") ||
    g.includes("transwoman") ||
    g.includes("futa") ||
    g.includes("shemale") ||
    g.includes("ladyboy") ||
    /\b(trans|transgender|futa|futanari|shemale|ladyboy|dickgirl)\b/i.test(p);

  if (isTransFemale) {
    // Trans females / futas can send both breasts/pussy and penis/cock
    return null;
  }

  const maleTerms = /\b(dick|cock|penis|balls|male chest|man chest|guy chest|male body)\b/;
  const femaleTerms = /\b(pussy|vagina|clit|vulva|female body|breasts|tits|boobs)\b/;

  if (g === "female") {
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
