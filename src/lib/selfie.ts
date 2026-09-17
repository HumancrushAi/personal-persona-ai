// Builds the image prompt for a companion selfie. Shared by the camera button
// (media.functions) and the auto-selfie when a user asks for a pic in chat.

import { TOY_VOCAB, propClause, propIsInserted } from "./props";
import { type Anatomy, type GenderKind, anatomyOf, nudeAnatomy } from "./anatomy";

// Explicit request vocabulary, grouped by category so the nudity gate and the
// pose-tag builder share one source of truth. Add synonyms here and both the
// "is this nude" check and the rendered booru tags pick them up. Adult fictional
// characters only — screenUserMessage still hard-blocks minors, non-consent,
// bestiality, and incest before any of this runs. Each entry is a regex source
// string (no anchors — `kw()` adds word boundaries).
const KW = {
  // Tone, not anatomy: how people ask for an explicit photo without naming what
  // is in it. Read only by requestIsNude, and only in a message that is already
  // a request for a photo, so "dirty" here is never someone's dishes. "sexy" is
  // deliberately absent — a sexy picture in a dress is a real, clothed request.
  explicitIntent:
    "nasty|nastier|naughty|naughtier|dirty|dirtier|filthy|slutty|sluttier|lewd|explicit|xxx|x-rated|nsfw|uncensored|horny|freaky|kinky|raunchy|spicy|spicier",
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
  if (
    kw([KW.undress, KW.breasts, KW.pussy, KW.penis, KW.ass].join("|")).test(req) ||
    ACT_RE.test(req)
  )
    return true;

  // Asking for it explicit without naming a body part or an act: "send me a
  // nasty picture". None of these words used to count, so that request was read
  // as a clothed one — she "held the pose" in whatever her portrait had her
  // wearing, the clip barely moved, and the photo that came back was the start
  // frame itself: lingerie, shorts and the padding around it included.
  //
  // Unless they named what she should be wearing. "A naughty pic in lingerie"
  // is asking to SEE the lingerie, and forcing nudity would take away the one
  // thing they specified. Lingerie is deliberately not nude (see above), so it
  // wins over tone.
  return kw(KW.explicitIntent).test(req) && !kw(KW.lingerie).test(req);
}

// Maps request keywords to explicit booru pose/act tags so the picture actually
// shows what was asked (a plain selfie otherwise ignores the described act).
//
// Takes the resolved Anatomy rather than an isMale/isTransFemale pair. Two
// independent booleans can disagree — isMale && isTransFemale was reachable —
// and between them they could not express a trans man at all, so he fell into
// the female branch and was given a pussy tag while every other builder in this
// file was rendering him as a man. The flags on Anatomy cannot contradict
// themselves, and there are three of them because there are three parts.
function actionTags(req: string, a: Anatomy): string {
  const ex: string[] = [];
  const has = (src: string) => kw(src).test(req);

  // Anatomy on display. Keyed off what this companion HAS, not off a gender
  // label — a request for a part they do not have never reaches here, because
  // refuseWrongAnatomy turns it away before any prompt is built.
  if (a.hasPenis && has(KW.penis))
    ex.push(
      a.hasBreasts
        ? "trans female, futanari, anatomically correct penis, erect cock, penis shaft, testicles, full frontal nudity, groin visible, female body with male genitalia"
        : "anatomically correct penis, erect cock, penis shaft, testicles, full frontal nudity, groin visible, male focus",
    );
  if (a.hasVulva && has(KW.pussy))
    ex.push(
      "photorealistic pussy, detailed naturally shaped pussy, soft outer and inner labia, visible clitoris, glistening wetness, spread pussy, spread legs, presenting",
    );
  if (has(KW.breasts))
    ex.push(
      a.hasBreasts
        ? "firm perky bare breasts, rounded uplifted bust, perky erect nipples"
        : "flat muscular male chest, abs",
    );

  // Poses.
  if (has(KW.ass) || has("bent?\\s*over|from\\s+behind|doggy|twerk\\w*"))
    ex.push("bent over, presenting, ass, rear view");
  if (has(POSES_NUDE)) ex.push("spread legs, presenting");
  if (has("riding|cowgirl|straddl\\w*")) ex.push("straddling, riding pose");

  // Acts. What the hands are doing follows the anatomy: a trans man
  // masturbating is fingering himself, which the old isMale branch got wrong.
  if (has(KW.masturbation))
    ex.push(
      a.hasPenis
        ? a.hasBreasts
          ? "futanari masturbation, hand on penis, stroking erect cock, bare breasts, perky erect nipples, groin visible"
          : "male masturbation, hand on penis, stroking erect cock, groin visible"
        : `masturbation, fingering, hand between legs, spread legs, pleasuring ${a.refl}, touching ${a.poss} pussy, reclining on bed`,
    );
  // No "away from face and mouth" here — see the header of props.ts. Tags are
  // a bag of concepts; "away from face" is the concepts `face` and `mouth`
  // attached to the toy, which is how the toy ended up at her mouth.
  if (has(KW.toys)) {
    const toyTag =
      a.hasVulva && has(KW.pussy)
        ? `sex toy, dildo, dildo inserted in ${a.poss} pussy, dildo between ${a.poss} thighs, hands low at ${a.poss} hips`
        : `sex toy, dildo, using sex toy, hands low at ${a.poss} hips`;
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
  a: Anatomy,
): string {
  const isNude = requestIsNude(req);
  const { noun, kind } = a;
  const WHO: Record<GenderKind, string> = {
    male: "1boy, solo, male focus",
    female: "1girl, solo",
    "trans-female": "1girl, solo, trans female, futanari",
    "trans-male": "1boy, solo, trans male, female genitalia",
    nb: "androgynous, solo",
  };
  const BODY: Record<GenderKind, string> = {
    male: "muscular, abs, handsome male",
    female: "curvy, feminine, attractive, firm perky breasts",
    "trans-female": "curvy, feminine, attractive, firm perky breasts, female body with male genitalia",
    "trans-male": "lean masculine build, flat chest, top surgery scars, male body with female genitalia",
    nb: "androgynous, lean",
  };
  const NUDE_TAGS: Record<GenderKind, string> = {
    male: "nude, completely naked, bare skin, anatomically correct penis, erect cock, penis shaft, testicles, pubic hair, groin visible, male anatomy",
    female:
      "nude, completely naked, firm perky bare breasts, rounded uplifted bust, perky erect nipples, detailed photorealistic pussy, vulva, labia, clitoris, pubic hair, groin visible",
    "trans-female":
      "nude, completely naked, 1girl, trans female, futanari, firm perky bare breasts, rounded uplifted bust, perky erect nipples, anatomically correct penis, erect cock, penis shaft, testicles, pubic hair, groin visible, female body with male genitalia",
    // The case that had no branch at all before: he fell through to the female
    // tags and was rendered with breasts.
    "trans-male":
      "nude, completely naked, trans male, flat masculine chest, top surgery scars, detailed pussy, vulva, labia, clitoris, pubic hair, groin visible",
    nb: "nude, completely naked, androgynous body, flat soft chest, bare skin",
  };

  const who = WHO[kind];
  const body = BODY[kind];
  const nudeTags = isNude ? NUDE_TAGS[kind] : "clothed";

  // Pose/act tags follow the request; the anatomy inside actionTags is keyed
  // off what this companion has.
  const explicit = actionTags(req, a);

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

  // The person asking is not in the picture — they are behind the lens. Left
  // alone, "your pussy close to my face" reached the renderer as "close to my
  // face" and it drew a face there, which is one of the reasons that request
  // came back as a composition nobody asked for. Translating the asker's face
  // into the camera turns the same words into the viewpoint instruction they
  // were always meant to be. Only proximity phrasings are rewritten; a stray
  // "my" elsewhere is left alone rather than guessed at.
  s = s.replace(/\b(?:right\s+)?(?:up\s+)?(?:close|next)\s+to\s+my\s+face\b/gi, "close to the camera");
  s = s.replace(/\bin(?:to)?\s+my\s+face\b/gi, "close to the camera");
  s = s.replace(/\bin\s+front\s+of\s+my\s+face\b/gi, "close to the camera");
  s = s.replace(/\bat\s+me\b/gi, "at the camera");
  s = s.replace(/\bfor\s+me\b/gi, "for the camera");
  s = s.replace(/\btowards?\s+me\b/gi, "toward the camera");

  return s.replace(/^[\s,.:;-]+/, "").trim();
}

// Body-part and object nouns that can open a request, used only to decide
// whether the action needs a verb in front of it.
const BARE_NOUN_START = new RegExp(
  `^(?:${[TOY_VOCAB, "tits|titties|boobs|boobies|breasts?|nipples?|cleavage|pussy|vagina|clit\\w*|labia|cunt|ass|asshole|butt|booty|cheeks|dick|cock|penis|balls|body|legs|thighs|feet"].join("|")})\\b`,
  "i",
);

// People ask in the imperative — "get naked", "spread your legs", "put your
// tits in my face" — and an imperative dropped into "She is ___." is broken
// English: "She is get naked." The renderer's text encoder is a language model,
// so a sentence it cannot parse is conditioning wasted on the one clause that
// says what the picture is of.
//
// A lookup rather than a morphology engine. English gerund spelling needs the
// consonant-doubling rule and the silent-e rule and then still gets `lie`
// wrong, and none of that is worth writing for a list this short — these are
// simply the verbs people actually type into this app.
const IMPERATIVE_GERUND: Record<string, string> = {
  arch: "arching",
  bend: "bending",
  bounce: "bouncing",
  crawl: "crawling",
  cum: "cumming",
  dance: "dancing",
  finger: "fingering",
  flash: "flashing",
  fuck: "fucking",
  get: "getting",
  grab: "grabbing",
  grind: "grinding",
  hold: "holding",
  insert: "inserting",
  jerk: "jerking",
  kneel: "kneeling",
  lay: "laying",
  lick: "licking",
  lie: "lying",
  lift: "lifting",
  masturbate: "masturbating",
  open: "opening",
  play: "playing",
  pose: "posing",
  pull: "pulling",
  push: "pushing",
  put: "putting",
  ride: "riding",
  rub: "rubbing",
  shove: "shoving",
  show: "showing",
  sit: "sitting",
  slide: "sliding",
  spread: "spreading",
  squat: "squatting",
  squeeze: "squeezing",
  straddle: "straddling",
  stand: "standing",
  stick: "sticking",
  strip: "stripping",
  stroke: "stroking",
  suck: "sucking",
  take: "taking",
  tease: "teasing",
  touch: "touching",
  twerk: "twerking",
  use: "using",
  wear: "wearing",
};

/**
 * "She is ___." with the blank filled grammatically.
 *
 * normalizeRequest returns the user's own words, and those are not always a
 * predicate: "show me your tits" normalizes to "her tits", which the old
 * builder dropped straight in as "She is her tits." — and "send me a nude pic
 * with your pussy close to my face" became "She is her pussy close to my face."
 * Both are the exact requests users complained about. Broken grammar is not
 * cosmetic here: the renderer's text encoder is a language model, and a
 * sentence it cannot parse is conditioning thrown away on the one clause that
 * says what the picture is of.
 *
 * An imperative becomes a gerund, a noun phrase gets a verb, and anything that
 * already reads as a predicate — a gerund, a preposition, a state ("naked in
 * the shower") — is left exactly as the user wrote it.
 */
export function actionSentence(subject: "she" | "he" | "they", action: string): string {
  const a = action.trim();
  const verb = subject === "they" ? "are" : "is";
  const Subject = `${subject[0].toUpperCase()}${subject.slice(1)}`;
  if (!a) return "";

  const gerund = IMPERATIVE_GERUND[a.split(/\s+/)[0].toLowerCase()];
  if (gerund) return `${Subject} ${verb} ${gerund}${a.slice(a.split(/\s+/)[0].length)}.`;

  const needsVerb = /^(?:her|his|their|its|a|an|the)\b/i.test(a) || BARE_NOUN_START.test(a);
  return `${Subject} ${verb} ${needsVerb ? "showing " : ""}${a}.`;
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
// PERSON IN A ROOM — naming the subject, the posture and the camera distance
// gives the model a composition to build, instead of a rule to obey.
//
// Two things changed here after users reported that explicit photos look bad.
//
// 1. "Not a close-up, not cropped" is gone. It is a negation, and the renderer's
//    text encoder cannot negate — it reads `close-up, cropped`, which is a
//    request for the headless torso crop that was reported. The whole argument
//    is in the header of props.ts. Framing is now stated only as what IS in the
//    frame and where the camera stands.
//
// 2. The camera is no longer "far away across the room". A chat photo is one
//    frame of a 640px clip. Put a whole standing body in 640px and her groin is
//    forty pixels across — there is no amount of anatomical description that
//    survives that, and "the nudes look bad" is partly just this. So an act
//    request is framed head-to-knees, which roughly doubles the linear detail on
//    everything that matters while keeping the face in shot; a plain selfie
//    keeps the full figure but at a conversational distance rather than across
//    a room.
// "a androgynous person" — the only noun in the table that starts with a vowel,
// and the framing sentence is the first thing the renderer reads.
const article = (noun: string) => (/^[aeiou]/i.test(noun) ? "an" : "a");

function framingFor(
  noun: string,
  poss: string,
  posed: boolean,
  hasReq: boolean,
  name?: string,
  isCloseUp?: boolean,
): string {
  // "pussy close to my face" is not a zoom setting, it is a viewpoint: the
  // camera is where the person asking is. Describing that viewpoint as a real
  // photograph — where the lens is, what fills the foreground, what is behind
  // it — is what the model can build. The old wording ("close to her body,
  // focus sharp on her body and details") named no vantage point and no
  // subject, so the renderer chose both, and chose badly.
  //
  // Her face is named as part of the composition, further up the frame beyond
  // the foreground. That is deliberate: a close-up prompt with no face in it is
  // how a picture comes back as an anonymous crop of a torso.
  if (isCloseUp) {
    return `Close-up point-of-view photograph of ${article(noun)} ${noun}, taken from between ${poss} open thighs looking up along ${poss} body, ${poss} groin filling the centre foreground in sharp focus, ${poss} stomach and breasts beyond it and ${poss} face looking down into the lens at the top of the frame, lens about thirty centimetres away.`;
  }

  // An act request gets a medium shot: the act is at the centre of the frame at
  // usable size, and the face is still in it.
  if (posed || hasReq) {
    return `Photograph of ${article(noun)} ${noun} indoors, framed from the top of ${poss} head down to ${poss} knees, ${poss} face clearly visible in the upper third of the frame and ${poss} hips in the middle of the frame, camera about two metres away at chest height.`;
  }

  let stance = " standing";
  if (name) {
    // Pick an intimate, natural posture instead of default standing
    const postures = ["lying on bed", "sitting on the edge of the bed", "reclining on a couch"];
    const hash = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    stance = " " + postures[hash % postures.length];
  }
  return `Full length photograph of ${article(noun)} ${noun}${stance} in a room, ${poss} whole body in frame from ${poss} head to ${poss} feet, ${poss} face clearly visible at the top of the frame, camera about three metres away.`;
}

// Requests that carry their own posture, which "standing" would fight.
const POSTURE_RE =
  /\b(ride|riding|bounc\w*|sit\w*|sitting|lying|lie|laid|kneel\w*|bent|bend\w*|squat\w*|straddl\w*|on all fours|doggy|cowgirl|on her back|on his back|leaning|crawl\w*|spread\w*|masturbat\w*|finger\w*|rub\w*|touch\w*|play\w*|dildo\w*|toy\w*|plug\w*|suck\w*|blowjob|bj|oral|anal|fuck\w*|sex|penetrat\w*|insert\w*)\b/i;

// Photographic language, not render language. "8k masterpiece" vocabulary is
// what produces the airbrushed CG look that reads as AI on sight.
//
// This used to end "no airbrushing or smoothing… not a render. No text, no
// watermark." — four negations, and therefore the tokens `airbrushing`,
// `smoothing`, `render`, `text` and `watermark` in the conditioning of every
// picture the app has ever sent. All five are already in QUALITY_NEGATIVE in
// media.functions.ts, which is the one place a renderer can act on them.
const QUALITY =
  "Candid photograph, 35mm lens, natural available light, true-to-life colour, real untouched skin with visible pores and fine natural texture, matte natural skin finish, natural skin mottling and colour variation, subtle skin imperfections, natural asymmetry, soft natural shadows. Looks like a real photo taken on a real camera.";

export function videoStillPrompt(
  c: { gender?: string | null; name?: string },
  userPrompt?: string | null,
): string {
  const req = (userPrompt ?? "").trim();
  // One resolver, and it reads ONLY the companion's stored gender. Each builder
  // in this file used to re-derive this with its own copy-pasted block that
  // also sniffed the user's message for "trans" and "futa" — so typing those
  // words changed whose body was rendered. See the header of anatomy.ts.
  const a = anatomyOf(c.gender);
  const { noun, subject, poss } = a;

  const undress = requestIsNude(req)
    ? `${subject} ${a.is} already completely naked, bare skin everywhere. ${nudeAnatomy(c.gender)}`
    : `${subject} hold${a.s} the pose.`;

  // NOTE: deliberately no actionTags here. Those are booru tags ("bent over,
  // presenting, ass, rear view") written for the Pony IMAGE model, and feeding
  // them to WAN made it compose a tight crop around the act — photos came back
  // as a headless torso, and at higher tag density as an extreme close-up, no
  // matter what the framing text said. The user's own words in plain language
  // render the same act and keep the camera wide.
  const action = normalizeRequest(req, subject) || "posing seductively for the camera";
  const isCloseUp = CLOSE_UP_RE.test(req);
  const Subject = `${subject[0].toUpperCase()}${subject.slice(1)}`;
  const settles = `settle${a.s}`;

  return [
    framingFor(noun, poss, POSTURE_RE.test(req), !!req, c.name, isCloseUp),
    actionSentence(subject, action),
    `${undress[0].toUpperCase()}${undress.slice(1)}`,
    propClause(req, { anatomy: a }),
    QUALITY,
    isCloseUp
      ? `The camera holds its position close in. ${Subject} ${settles} into a still held pose at the end.`
      : `The camera holds its position. ${Subject} ${settles} into a still held pose at the end.`,
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
  const a = anatomyOf(c.gender);
  const { noun, subject, poss } = a;

  const undress = requestIsNude(req)
    ? `${subject} ${a.is} already completely naked, bare skin everywhere throughout. ${nudeAnatomy(c.gender)}`
    : `${subject} move${a.s} seductively for the camera.`;

  // Same reason as videoStillPrompt: no booru tags for this model.
  const action =
    normalizeRequest(req, subject) || "performing a slow seductive striptease for the camera";
  const isCloseUp = CLOSE_UP_RE.test(req);

  return [
    framingFor(noun, poss, POSTURE_RE.test(req), !!req, c.name, isCloseUp),
    actionSentence(subject, action),
    `${undress[0].toUpperCase()}${undress.slice(1)}`,
    propClause(req, { anatomy: a }),
    QUALITY,
    isCloseUp
      ? "Smooth natural lifelike motion throughout, consistent face and body. The camera holds its close point-of-view position."
      : "Smooth natural lifelike motion throughout, consistent face and body. The camera holds its position.",
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
  const a = anatomyOf(c.gender);
  const { noun, subject, object } = a;
  const explicit = actionTags(req, a);

  const state = requestIsNude(req)
    ? `completely naked, bare skin. ${nudeAnatomy(c.gender)}`
    : `wearing what ${subject} has on`;

  return [
    `Keep the exact same ${noun} from the photo — identical face, hair, skin tone and body. Do not change who ${subject} ${a.is}.`,
    `${subject[0].toUpperCase()}${subject.slice(1)} ${a.is} a ${c.age}-year-old ${c.ethnicity} ${noun}.`,
    `Now show ${object} ${req || "taking a seductive selfie, looking at the camera"}, ${state}.`,
    explicit,
    styleBackstory || "",
    "Photorealistic amateur selfie, full body in frame, natural indoor lighting, detailed skin, sharp focus.",
  ]
    .filter(Boolean)
    .join(" ");
}

// The renderer's text encoder takes a fixed number of tokens and silently drops
// everything past it. Measured on the prompt that produced the reported failure:
// "Send me a picture of you sticking a dildo in your pussy" built a 607-word
// prompt, comfortably past that limit — so the realism tail and the held-pose
// instruction, both written last on purpose, were never seen by the renderer at
// all. The picture was rendered from the first half of a prompt whose second
// half was the half about it looking like a photograph.
//
// A word budget rather than a token count: this is a guardrail, not an exact
// accounting, and the ratio is stable enough for prose. The tail is preserved
// across the cut, because dropping the middle of a description costs less than
// dropping the instruction that says "photograph, not render".
const PROMPT_WORD_BUDGET = 300;

const REALISM_TAIL =
  "Candid raw photograph on a real camera, authentic skin texture with visible pores, matte natural skin finish, natural skin mottling, natural asymmetry, natural available light.";

const STILL_CUE = "The pose is held completely still and the camera is locked off.";
const STILL_CUE_WORDS = STILL_CUE.split(/\s+/).length;

export function capPromptWords(prompt: string, max = PROMPT_WORD_BUDGET): string {
  const text = prompt.trim();
  const words = text.split(/\s+/);
  if (words.length <= max) return text;

  const tailLength = REALISM_TAIL.split(/\s+/).length;
  const kept = words.slice(0, Math.max(1, max - tailLength)).join(" ");
  // Back off to the last clean break so the cut never lands mid-clause.
  const boundary = Math.max(kept.lastIndexOf(". "), kept.lastIndexOf(", "));
  const body = boundary > kept.length / 2 ? kept.slice(0, boundary) : kept;
  return `${body.replace(/[\s,;:.]+$/, "")}. ${REALISM_TAIL}`;
}

/**
 * The last step before a prompt is sent, shared by photos and videos.
 *
 * `base` is whatever we ended up with — the refiner's prompt, or one of the
 * builders above when it failed. Everything that must be true regardless of
 * which of those it is belongs here rather than in either one.
 *
 * The prop specification is appended rather than trusted to the refiner for the
 * reason recorded in props.ts: Grok is asked to describe props well and usually
 * does, but "usually" is not a constraint, and a successful refine replaces the
 * builder wholesale — so the one path that runs in production is the one path
 * the spec would otherwise miss.
 */
export function finishMediaPrompt(
  base: string,
  req: string,
  opts: { anatomy?: Anatomy; appendProps?: boolean; still?: boolean } = {},
): string {
  let out = (base ?? "").trim();
  const request = (req ?? "").trim();
  const a = opts.anatomy ?? anatomyOf("female");

  if (opts.appendProps) {
    const props = propClause(request, { anatomy: a });
    // The refiner writes comma-separated fragments with no terminating full
    // stop, so a bare space ran its last fragment into the first sentence of
    // the spec ("…shot on Sony A7 IV 85mm lens The toy is inserted into her").
    if (props) out = `${out.replace(/[\s,;:]+$/, "")}${/[.!?]$/.test(out.trim()) ? "" : "."} ${props}`;
  }

  // A toy the user asked to have inserted, described as being held, is the
  // single failure this whole path exists to prevent — and "holding a dildo" in
  // front of her is one short step from the vertical crotch-to-chin cylinder a
  // user was actually sent. Rewritten positively: where it is, and what her
  // hand is doing there.
  if (propIsInserted(request)) {
    const poss = a.poss;
    out = out.replace(
      /\b(?:holding|holds|gripping|grips|clutching|raising|lifting)\s+(?:a|an|the|her|his)?\s*(?:large |big |thick |huge )?(?:silicone |matte |black )*(?:dildo|sex toy|toy|vibrator|plug|wand)\b/gi,
      `with the toy inserted between ${poss} open thighs, ${poss} fingers closed on its base`,
    );
  }

  // A photo is one frame cut out of the tail of a clip, so the clip has to
  // arrive somewhere and stop. The builders end this way already; a refined
  // prompt does not unless the refiner remembered to, and when it did not the
  // frame we pulled was whatever the motion happened to be doing.
  //
  // Capped BEFORE this rather than after. The still cue is the last thing in
  // the prompt and the cap takes from the end, so checking for it first and
  // appending after meant the cap could quietly delete the cue the builder had
  // already written — measured on the dildo request, which is exactly the one
  // where a mid-motion frame does the most damage.
  const capped = capPromptWords(out, opts.still ? PROMPT_WORD_BUDGET - STILL_CUE_WORDS : undefined);
  // Specific phrases, not the bare word "still" — the prop clause contains
  // "only the flared base still visible", which matched and silently suppressed
  // the cue on the one request that most needs it.
  if (opts.still && !/held pose|locked off|held completely still/i.test(capped)) {
    return `${capped.replace(/[\s,;:]+$/, "")}${/[.!?]$/.test(capped.trim()) ? "" : "."} ${STILL_CUE}`;
  }
  return capped;
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
  return booruPonyPrompt(c, req, styleBackstory, anatomyOf(c.gender));
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

/**
 * The in-character refusal when a request names anatomy this companion does
 * not have, or null when there is nothing to refuse.
 *
 * Kept as a re-export under its original name because three call sites import
 * it; the implementation now lives in anatomy.ts beside the table it has to
 * agree with. The old one here had four faults, every one of them reproduced
 * against the live code:
 *
 *   - it read the USER'S MESSAGE for "trans" and "futa" and unlocked
 *     everything when it matched, so "send me a pic of your dick you futa"
 *     rendered a penis on an ordinary female companion;
 *   - it had trans men exactly backwards, refusing a request for his own pussy
 *     and accepting one for a cock he does not have;
 *   - it let a trans woman be asked for a vulva, which produced the fused,
 *     ambiguous groin rather than a refusal;
 *   - it matched the bare word anywhere in the message, so "my ex had a huge
 *     dick lol" — ordinary conversation — was answered with "No silly, I'm a
 *     girl!". A gate that refuses people for talking about their lives is
 *     worse than the thing it was written to prevent.
 */
export { refuseWrongAnatomy as checkCrossGenderRequest } from "./anatomy";
