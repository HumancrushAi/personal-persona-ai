// Builds the image prompt for a companion selfie. Shared by the camera button
// (media.functions) and the auto-selfie when a user asks for a pic in chat.

import { TOY_VOCAB, hasProp, propClause, propIsInserted } from "./props";
import type { Toy } from "./toys";
import { type Anatomy, type GenderKind, anatomyOf, mentionsPart, nudeAnatomy } from "./anatomy";

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
    "nasty|nastier|naughty|naughtier|dirty|dirtier|filthy|slutty|sluttier|lewd|explicit|xxx|x-rated|nsfw|uncensored|horny|freaky|kinky|raunchy|spicy|spicier|dripping wet|soaking wet",
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
  cum: "cum|cums|cumming|cummed|cuming|cummin|came|come\\s+for\\s+me|coming\\s+for\\s+me|c[uo]m\\s+(?:on|for|all\\s+over|in|inside)\\b|orgasm\\w*|climax\\w*|squirt\\w*|gush\\w*|ejaculat\\w*|jizz|spunk|cum\\s*shots?|creampie|cream\\s*pie|bust\\w*\\s+(?:a\\s+)?nut|nut(?:ting|s)?\\s+(?:on|for|all\\s+over|in)\\b|shoot\\w*\\s+(?:your|ur|his|her|my|a)\\s+load|blow\\w*\\s+(?:your|ur|his|her|my|a)\\s+load|make\\s+(?:yourself|urself)\\s+c[uo]m\\w*|finish\\s+(?:yourself|urself|on|all\\s+over)|get\\s+(?:yourself|urself)\\s+off|get\\s+off\\s+for\\s+me|precum|ahegao|female\\s+ejaculat\\w*|o-?face|orgasm\\s+face",
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
      // "spread pussy" and "inner labia" are gone: both render as tissue pulled
      // out of the cleft, which is the flap a user sent back. A closed cleft is
      // what a checkpoint draws cleanly.
      "photorealistic pussy, smooth shaved closed pussy, plump mound, single neat crease, innie, spread legs, presenting",
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
    "trans-female":
      "curvy, feminine, attractive, firm perky breasts, female body with male genitalia",
    "trans-male":
      "lean masculine build, flat chest, top surgery scars, male body with female genitalia",
    nb: "androgynous, lean",
  };
  const NUDE_TAGS: Record<GenderKind, string> = {
    male: "nude, completely naked, bare skin, anatomically correct penis, erect cock, penis shaft, testicles, pubic hair, groin visible, male anatomy",
    female:
      "nude, completely naked, firm perky bare breasts, rounded uplifted bust, perky erect nipples, smooth shaved closed pussy, plump mound, single neat crease, innie, groin visible",
    "trans-female":
      "nude, completely naked, 1girl, trans female, futanari, firm perky bare breasts, rounded uplifted bust, perky erect nipples, anatomically correct penis, erect cock, penis shaft, testicles, pubic hair, groin visible, female body with male genitalia",
    // The case that had no branch at all before: he fell through to the female
    // tags and was rendered with breasts.
    "trans-male":
      "nude, completely naked, trans male, flat masculine chest, top surgery scars, smooth shaved closed pussy, plump mound, single neat crease, groin visible",
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
// Every word people use for "a photo of you", including the common misspellings
// of portrait. "face potrait" is how a real user asked; it matched nothing, so
// the message went to the text model, which declined to send a photo at all.
const PHOTO_NOUNS =
  "pictures?|pics?|pix|photos?|photographs?|portraits?|potraits?|portaits?|protraits?|headshots?|head shots?|backshots?|back shots?|snapshots?|selfies?|selfy|images?";
// The same words with an optional "face"/"body" qualifier in front, as the
// lead-in to strip: "send me a face portrait of you smiling".
const PHOTO_LEAD = `(?:(?:face|head|full[- ]?body|body|close[- ]?up)\\s*)?(?:${PHOTO_NOUNS}|shots?|videos?|vids?|clips?|nudes?|sexts?)`;

// Adjectives people put on the picture noun. They say how explicit the
// picture should be — requestIsNude reads the raw message for that — and
// nothing about the pose, so they go with the noun. "a dirtier picture" was
// reaching the renderer as "She is dirtier picture."
//
// Two lists. A tone word is stripped even with no noun after it ("do a sexy
// pose" → "pose"); a state word is only stripped as part of a noun phrase,
// because on its own it IS the request ("naked" is a pose, "nude pic" is not).
const PHOTO_ADJ_TONE =
  "new|quick|sexy|sexxy|sexi|sexier|hot|hotter|nice|cute|pretty|beautiful|gorgeous|sweet|good|great|better|best|different|dirty|dirtier|dirtiest|nasty|nastier|naughty|naughtier|filthy|explicit|raunchy|raunchier|kinky|kinkier|lewd|slutty|sluttier|spicy|spicier|steamy|xxx|x-rated|nsfw|uncensored|freaky|sultry|seductive|provocative|erotic|revealing|intimate|private|special|proper|clear|little|lil|small|tiny|big|hd|realistic|real|candid|artistic|tasteful|personal|solo|amateur|homemade|teasing|flirty|racy|risqu[eé]|suggestive|playful";
const PHOTO_ADJ_STATE = "nude|naked|topless|wet|horny|full|close[- ]?up|frontal";
const PHOTO_ADJ = `${PHOTO_ADJ_TONE}|${PHOTO_ADJ_STATE}`;

// What a message opens with before it gets to the ask: "ok then take a dildo
// and…", "yes. show me your tits", "hi, can you send me a video?". Every one of
// these reached the renderer inside the sentence that says what the picture
// is of — "She is Yes. Show me her tits."
const OPENING_FILLER_RE =
  /^(?:ok(?:ay)?|yes+|yeah|yep|yup|sure|alright|so|now|then|thrn|and|also|hi+|hey+|hello|yo|please|pls|plz|babe|baby|hun|honey|omg|lol|hmm+|mmm+|oh+|ooh+|ah+|haha+|again|pov)\b[\s,!.?:;-]*/i;

// The verbs people give these orders with. Used to tell the sentence that is
// the ask from the talk around it, so it is the explicit ones, not every verb
// actionSentence knows a gerund for — "talk", "read" and "change" are chat.
const CUE_VERBS =
  "arch|bend|bounce|crawl|cum|dance|finger|flash|fuck|grab|grind|hold|insert|jerk|kneel|lay|lick|lie|lift|masturbate|open|play|pose|pull|push|put|ride|rub|shove|show|sit|slide|spread|squat|squeeze|straddle|stand|stick|strip|stroke|suck|tease|touch|twerk|use|wear|pinch|turn|kiss|wink|pee|smile|blow|press|cup|look|raise|close|remove|shake|wiggle|flex|squirt|moan|cover|lean|stretch|undress|get naked|get nude|take off|pull down|spank|slap|hump|thrust|gape|bare|expose|reveal|flaunt|jiggle|bite";

// Words that make a sentence the ask rather than the talk around it: the
// picture nouns, the body, the acts, the clothes, and the verbs above.
let contentCue: RegExp | null = null;
function contentCueRe(): RegExp {
  if (!contentCue)
    contentCue = new RegExp(
      `\\b(?:${[
        PHOTO_NOUNS,
        "shots?|videos?|vids?|clips?|nudes?|sexts?",
        KW.undress,
        KW.breasts,
        KW.pussy,
        KW.penis,
        KW.ass,
        KW.masturbation,
        KW.toys,
        KW.oral,
        KW.anal,
        KW.sex,
        KW.cum,
        KW.lingerie,
        POSES_NUDE,
        CUE_VERBS,
      ].join("|")})\\b`,
      "i",
    );
  return contentCue;
}

// The sentences of a message that carry the ask — all of them when none does.
// "Send me a picture of this! Im getting so horny" is one ask and one aside,
// and the aside was going into the prompt.
function askSentences(s: string): string {
  const parts = s
    .split(/(?<=[.!?;])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return s;
  const kept = parts.filter((p) => contentCueRe().test(p));
  return kept.length ? kept.join(" ") : s;
}

// A clause about the asker in front of the ask — "I had a rough day, show me
// your tits". Only a clause about THEM is dropped; "lying on the bed, spread
// your legs" is all picture.
let askStart: RegExp | null = null;
function askStartRe(): RegExp {
  if (!askStart)
    askStart = new RegExp(
      `^([^,.!?;:]{1,60}?)[,;:]\\s*(?=(?:please\\s+|pls\\s+)?(?:can|could|will|would|why\\s+don'?t|i\\s+(?:want|wanna|need|'?d\\s+like|would\\s+like|gotta)|let\\s+me|lemme|send|sned|show|take|snap|give|gimme|make|shoot|film|record|get|${CUE_VERBS})\\b)`,
      "i",
    );
  return askStart;
}
const PREAMBLE_ABOUT_ASKER_RE =
  /\b(?:i|i'?m|im|i'?ve|i'?d|i'?ll|me|my|mine|we|our|it'?s|its|today|tonight|tomorrow|day|night|work|home)\b/i;

// The ask itself, in every shape it arrives in: "can you please send me
// another really dirty pic of", "i want you to take a photo of", "i said i
// wanted a nude photo". Every piece is optional, so this also matches the
// empty string and leaves a bare description alone.
//
// "take", "do", "make" and "get" are only picture verbs in front of a picture
// noun — "take off your top", "take a dildo", "make yourself cum" and "get
// naked" are the pose, and stripping the verb left "She is herself cum."
const ASK_LEAD_RE = new RegExp(
  "^\\s*" +
    "(?:i\\s+(?:said|told\\s+(?:you|u)|asked(?:\\s+for)?|meant)\\s*,?\\s*)?" +
    "(?:(?:i|we)\\s+(?:really\\s+|just\\s+|only\\s+|also\\s+|still\\s+)?(?:want|wanted|need|needed|would\\s+like|'?d\\s+like|'?d\\s+love|wanna|gotta)\\s+(?:(?:to\\s+)?(?:see|get|have)\\s+|(?:you|u)\\s+to\\s+)?)?" +
    "(?:(?:can|could|will|would|why\\s+don'?t|do)\\s+(?:you|u)\\s+(?:please\\s+|pls\\s+)?)?" +
    "(?:(?:please|pls|plz)\\s+)?" +
    `(?:(?:send|sned|snd|sends|sending|show|shows|snap|give|gimme|film|record|post|drop|share|(?:take|do|make|get|shoot)(?=\\s+(?:me\\s+|us\\s+)?(?:(?:another|an|a|some|the|one|more)\\s+)?(?:(?:${PHOTO_ADJ})\\s+)*(?:${PHOTO_LEAD})))\\s*(?:me|us)?\\s+)?` +
    "(?:(?:another|an|a|some|the|one|1|more)\\b\\s*)?(?:(?:one|more)\\b\\s*)?" +
    `(?:(?:(?:really|very|super|extra|more|real|so|pretty|kinda|kind\\s+of)\\s+)?(?:(?:(?:${PHOTO_ADJ})\\s+)*(?:${PHOTO_LEAD})\\s*(?:(?:of|with|where|showing|that\\s+shows|in\\s+which|like)\\b\\s*)?|(?:(?:${PHOTO_ADJ_TONE})\\s+)*))`,
  "i",
);

// "send me a picture of THIS": the words say nothing to a renderer, and the
// thing they point at is whatever she just said — resolveMediaRequest puts
// that in. Anchored at both ends: "this: she is lying on her bed" is a scene.
const DEMONSTRATIVE_RE =
  /^(?:this|that|it|the same|like that|like this|what\s+(?:you|u)\s+(?:just\s+)?(?:said|described|mentioned|were\s+saying|are\s+doing|'?re\s+doing)|what\s+i\s+(?:said|asked(?:\s+for)?))\s*$/i;

/** The message with the ask stripped off: what is left is the picture. */
function stripAsk(req: string): string {
  let s = req.trim().replace(/\byoure\b/gi, "you're");
  s = askSentences(s);
  for (let i = 0; i < 4; i++) s = s.replace(OPENING_FILLER_RE, "");
  s = s.replace(askStartRe(), (m, pre: string) =>
    PREAMBLE_ABOUT_ASKER_RE.test(pre) && !contentCueRe().test(pre) ? "" : m,
  );
  s = s.replace(ASK_LEAD_RE, "");
  s = s.replace(/^\s*(?:i\s*(?:wanna|want\s*to|would\s*like\s*to|'?d\s*like\s*to)\s*see)\s*/i, "");
  s = s.replace(/^\s*(?:lemme|let\s*me)\s*see\s*/i, "");
  // Bare noun phrases with no verb ("a video of you bouncing…") slipped past the
  // patterns above, so the request kept its lead-in and came out as "She is a
  // video of she bouncing on a dick."
  s = s.replace(
    new RegExp(
      `^\\s*(?:like\\s+)?(?:(?:another|an|a|some|the)\\b\\s*)?(?:(?:${PHOTO_ADJ})\\s+)*(?:${PHOTO_LEAD})\\s*(?:(?:of|with|where|showing)\\b\\s*)?`,
      "i",
    ),
    "",
  );
  // Emoji, and the sign-off: "licking your tits please babe!!"
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ");
  for (let i = 0; i < 3; i++)
    s = s.replace(
      /\s*\b(?:please|pls|plz|babe|baby|hun|honey|daddy|lol|asap|thanks|thank you|ty|pretty please|right now|now)\b[\s!.?,]*$/i,
      "",
    );
  s = s.replace(/[\s!?.,;:]+$/g, "");
  // "…and send me a pic of it" on the end adds nothing to the picture.
  s = s.replace(
    new RegExp(
      `\\s*\\b(?:and|then|&|\\+)\\s+(?:please\\s+)?(?:(?:send|show|give|gimme|snap|take|shoot)\\s+(?:me|us)?\\s*)?(?:(?:another|an|a|some|the|one)\\b\\s*)?(?:(?:${PHOTO_ADJ})\\s+)*(?:${PHOTO_LEAD})\\b(?:\\s+of\\s+(?:it|that|this))?\\s*$`,
      "i",
    ),
    "",
  );
  // Emoji, and the sign-off: "licking your tits please babe!!"
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ");
  for (let i = 0; i < 3; i++)
    s = s.replace(
      /\s*\b(?:please|pls|plz|babe|baby|hun|honey|daddy|lol|asap|thanks|thank you|ty|pretty please|right now|now)\b[\s!.?,]*$/i,
      "",
    );
  return s
    .replace(/[\s!?.,;:]+$/g, "")
    .replace(/\s+\b(?:and|or|with|of|for|the|a|an|&)$/i, "")
    .replace(/^[\s,.:;!?-]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "send me a picture of this" — the picture is whatever she just described. */
export function isDemonstrativeMediaRequest(req: string): boolean {
  return DEMONSTRATIVE_RE.test(stripAsk(req ?? ""));
}

export function normalizeRequest(req: string, subject: "she" | "he" | "they"): string {
  let s = stripAsk(req);
  s = s.replace(
    /^(?:this|that|it|the same|like that|like this|what\s+(?:you|u)\s+(?:just\s+)?(?:said|described|mentioned|were\s+saying|are\s+doing|'?re\s+doing)|what\s+i\s+(?:said|asked(?:\s+for)?))\b\s*[:!.?,-]*\s*/i,
    "",
  );
  s = s.replace(
    /^(?:not clothed|no clothes|nothing on|with nothing on|without clothes|without anything on)$/i,
    "naked",
  );
  s = s.replace(/^what\s+(?:you|u)(?:'re|\s+are|re)\s+wearing\b.*$/i, "showing what you are wearing");
  s = s.replace(/^what\s+(?:you|u)\s+(?:have|got)\s+on\b.*$/i, "showing what you have on");

  // A second order after "and" is said to the camera, not to her: "spread your
  // legs and show me your pussy" was reaching the renderer with the "show me"
  // still in it.
  s = s.replace(
    /\b(and|then|while|&)\s+(?:please\s+)?(?:show|send|give|gimme)\s+(?:me|us)\s+(?:(?:some|a|the)\s+)?/gi,
    "$1 showing ",
  );
  s = s.replace(/\b(and|then|while|&)\s+(?:let\s+me|lemme)\s+see\s+(?:(?:some|a|the)\s+)?/gi, "$1 showing ");
  s = s.replace(/\bshow\s+(?:me|us)\s+/gi, "showing ");

  const poss = subject === "he" ? "his" : subject === "they" ? "their" : "her";
  const refl = subject === "he" ? "himself" : subject === "they" ? "themselves" : "herself";
  const obj = subject === "he" ? "him" : subject === "they" ? "them" : "her";
  const is = subject === "they" ? "are" : "is";
  s = s.replace(/\b(?:yourself|urself|yourselves)\b/gi, refl);
  s = s.replace(/\b(?:your|ur)\b/gi, poss);
  // A leading "you" is the subject of the sentence being built, so translating
  // it would double up ("She is she naked") — drop it, and "you are" with it.
  s = s.replace(/^\s*(?:you|u)(?:'re|re|\s+are)?\s+/i, "");
  s = s.replace(/^\s*(?:you|u)\s*$/i, "");
  s = s.replace(/\b(?:you|u)(?:'re|re)\b|\b(?:you|u)\s+are\b/gi, `${subject} ${is}`);
  // After a preposition "you" is an object: "a picture of you naked" is "of
  // her", not "of she".
  s = s.replace(
    /(?<=\b(?:of|with|at|to|for|on|in|by|from|like|about|behind|under|over|see|watch|want|fuck|ride|around|near|beside|against|onto|into|inside|between|below|above|without|than)\s+)(?:you|u)\b/gi,
    obj,
  );
  s = s.replace(/\b(?:you|u)\b/gi, subject);

  // The person asking is not in the picture — they are behind the lens. Left
  // alone, "your pussy close to my face" reached the renderer as "close to my
  // face" and it drew a face there, which is one of the reasons that request
  // came back as a composition nobody asked for. Translating the asker's face
  // into the camera turns the same words into the viewpoint instruction they
  // were always meant to be. Only proximity phrasings are rewritten; a stray
  // "my" elsewhere is left alone rather than guessed at.
  s = s.replace(
    /\b(?:right\s+)?(?:up\s+)?(?:close|next)\s+to\s+my\s+face\b/gi,
    "close to the camera",
  );
  s = s.replace(/\bin(?:to)?\s+my\s+face\b/gi, "close to the camera");
  s = s.replace(/\bin\s+front\s+of\s+my\s+face\b/gi, "close to the camera");
  s = s.replace(/\bat\s+me\b/gi, "at the camera");
  s = s.replace(/\bfor\s+me\b/gi, "for the camera");
  s = s.replace(/\btowards?\s+me\b/gi, "toward the camera");
  s = s.replace(/\bon top of me\b/gi, "on top, straddling, seen from below");
  s = s.replace(
    /\b(?:sitting|sit|squatting|squat)\s+on my face\b/gi,
    "squatting over the camera, seen from below",
  );
  // A garment named with "off" or "to the side" is a state, not a verb.
  s = s.replace(
    /(?<!\b(?:tak\w*|pull\w*|slip\w*|peel\w*|rip\w*|strip\w*|get\w*|throw\w*|toss\w*|kick\w*|whip\w*)\s+(?:her|his|their|the|my)?\s*)\b(?:with\s+)?(?:(?:her|his|their)\s+)?(bra|top|shirt|dress|panties|thong|skirt|jeans|shorts)\s+off\b/gi,
    `with ${poss} $1 off`,
  );
  s = s.replace(
    /\b(?:with\s+)?(?:(?:her|his|their)\s+)?(panties|thong|bikini bottoms?)\s+(?:pulled\s+)?to the side\b/gi,
    `with ${poss} $1 pulled to the side`,
  );

  return s
    .replace(/^[\s,.:;-]+/, "")
    .replace(/[\s,;:]+$/, "")
    .trim();
}

/**
 * Her last message, said back to her as a request — the scene behind "send me
 * a picture of this". Her "you" is the person asking, who stays behind the
 * lens; her "I" becomes the "you" every other request is written in, so the
 * builder and the refiner both read it the way they read any ask. Only the
 * sentences in which she describes herself, and only a couple of them.
 */
export function herWordsAsRequest(text: string): string {
  const clean = (text ?? "")
    .replace(/\*/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((p) => {
      let t = p.trim();
      for (let i = 0; i < 4; i++)
        t = t.replace(
          /^(?:mmm+|hmm+|mm+|oh+|ooh+|ah+|aw+|baby|babe|hun|honey|sweetie|darling|daddy|sir|god|fuck|yes+|haha+|well|so|ok(?:ay)?|hey+|hi+)\b[\s,!.-]*/i,
          "",
        );
      return t;
    })
    .filter((p) => p && !/\?$/.test(p) && /\b(?:i|i'?m|im|i'?ve|my|me|myself)\b/i.test(p));
  let out = "";
  for (const p of sentences) {
    if (out && `${out} ${p}`.length > 220) break;
    out = out ? `${out} ${p}` : p;
  }
  return out
    .replace(/\byourself\b/gi, "\u0000self")
    .replace(/\byour\b/gi, "\u0000r")
    .replace(/\byou\b/gi, "\u0000")
    .replace(/\b(?:I'?m|Im)\b/g, "you're")
    .replace(/\bI am\b/g, "you are")
    .replace(/\bI'?ve\b/g, "you've")
    .replace(/\bI'?ll\b/g, "you'll")
    .replace(/\bI'?d\b/g, "you'd")
    .replace(/\bI\b/g, "you")
    .replace(/\bmyself\b/gi, "yourself")
    .replace(/\bmy\b/gi, "your")
    .replace(/\bme\b/gi, "you")
    .replace(/\bmine\b/gi, "yours")
    .replace(/\u0000self/g, "myself")
    .replace(/\u0000r/g, "my")
    .replace(/\u0000/g, "me")
    .replace(/[\s.!]+$/, "")
    .trim();
}

/**
 * The request a photo or clip is actually of, from the message and the
 * conversation before it. One function for everything that renders, retakes
 * or checks a picture, because they were each reading the raw message:
 *
 *   - "send another one" means another of whatever she just sent — the
 *     message that asked for the last photo, plus anything this one adds
 *     ("another one with your legs spread").
 *   - "send me a picture of this" means the scene she just described.
 *
 * The chat path resolved the first of these and nothing else did, so a retake
 * after a worker error and the vision check both rebuilt the job from the
 * words "another one". `followUp` is the kind of media being repeated, for
 * the caller that has no picture noun to route on.
 */
export function resolveMediaRequest(
  content: string,
  history: { role: string; content: string | null; kind?: string | null }[],
): { request: string; followUp: "image" | "video" | null } {
  const hist = history ?? [];
  const lastMediaIdx = [...hist]
    .map((m, i) => ({ m, i }))
    .reverse()
    .find(({ m }) => m.role === "assistant" && (m.kind === "image" || m.kind === "video"))?.i;
  const lastMedia = lastMediaIdx == null ? null : hist[lastMediaIdx];
  const followUp =
    lastMedia && isFollowUpMediaRequest(content) ? (lastMedia.kind as "image" | "video") : null;
  let request = content;
  if (followUp && lastMediaIdx != null) {
    for (let i = lastMediaIdx - 1; i >= 0; i--) {
      const m = hist[i];
      if (
        m?.role === "user" &&
        typeof m.content === "string" &&
        m.content.trim() &&
        !isFollowUpMediaRequest(m.content)
      ) {
        // Keep what THIS message adds: "another one with your legs spread" is
        // the last request plus the pose, not a copy of it.
        const detail = followUpDetail(content);
        request = detail ? `${m.content.trim()}, ${detail}` : m.content;
        break;
      }
    }
  } else if (isDemonstrativeMediaRequest(content)) {
    const herLast = [...hist]
      .reverse()
      .find(
        (m) =>
          m.role === "assistant" &&
          (!m.kind || m.kind === "text") &&
          typeof m.content === "string" &&
          m.content.trim(),
      );
    const scene = herLast ? herWordsAsRequest(herLast.content as string) : "";
    if (scene) request = `${content.trim().replace(/[!.?\s]+$/, "")}: ${scene}`;
  }
  return { request, followUp };
}

// Body-part and object nouns that can open a request, used only to decide
// whether the action needs a verb in front of it.
const BARE_NOUN_START = new RegExp(
  `^(?:${[TOY_VOCAB, "tits|titties|boobs|boobies|breasts?|nipples?|cleavage|pussy|vagina|clit\\w*|labia|cunt|ass|asshole|butt|booty|cheeks|dick|cock|penis|balls|body|legs|thighs|feet|armpits?|panties|bra|lingerie|stockings|heels|full[- ]?face|face|full[- ]body|wet|ahegao|blowjob|mirror selfie|yoga|cum|squirt\\w*|soles|toes"].join("|")})\\b`,
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
  pinch: "pinching",
  turn: "turning",
  kiss: "kissing",
  wink: "winking",
  pee: "peeing",
  smile: "smiling",
  blow: "blowing",
  press: "pressing",
  cup: "cupping",
  look: "looking",
  give: "giving",
  raise: "raising",
  close: "closing",
  remove: "removing",
  shake: "shaking",
  wiggle: "wiggling",
  flex: "flexing",
  squirt: "squirting",
  moan: "moaning",
  cover: "covering",
  lean: "leaning",
  stretch: "stretching",
  shoot: "shooting",
  do: "doing",
  eat: "eating",
  drink: "drinking",
  bite: "biting",
  tie: "tying",
  wrap: "wrapping",
  slap: "slapping",
  spank: "spanking",
  twist: "twisting",
  lower: "lowering",
  drop: "dropping",
  unbutton: "unbuttoning",
  unzip: "unzipping",
  peel: "peeling",
  slip: "slipping",
  step: "stepping",
  walk: "walking",
  run: "running",
  jump: "jumping",
  swim: "swimming",
  shower: "showering",
  bathe: "bathing",
  oil: "oiling",
  smoke: "smoking",
  pour: "pouring",
  spit: "spitting",
  drool: "drooling",
  gag: "gagging",
  choke: "choking",
  swallow: "swallowing",
  taste: "tasting",
  nibble: "nibbling",
  hump: "humping",
  thrust: "thrusting",
  gape: "gaping",
  clench: "clenching",
  stare: "staring",
  gaze: "gazing",
  scream: "screaming",
  gasp: "gasping",
  pant: "panting",
  shiver: "shivering",
  tremble: "trembling",
  undress: "undressing",
  dress: "dressing",
  change: "changing",
  try: "trying",
  model: "modelling",
  present: "presenting",
  display: "displaying",
  expose: "exposing",
  reveal: "revealing",
  bare: "baring",
  part: "parting",
  point: "pointing",
  wave: "waving",
  rock: "rocking",
  sway: "swaying",
  roll: "rolling",
  flip: "flipping",
  hang: "hanging",
  dangle: "dangling",
  crouch: "crouching",
  recline: "reclining",
  lounge: "lounging",
  sprawl: "sprawling",
  curl: "curling",
  hug: "hugging",
  cuddle: "cuddling",
  fondle: "fondling",
  caress: "caressing",
  tickle: "tickling",
  tug: "tugging",
  tweak: "tweaking",
  flick: "flicking",
  tap: "tapping",
  pat: "patting",
  smack: "smacking",
  pump: "pumping",
  milk: "milking",
  jiggle: "jiggling",
  flaunt: "flaunting",
  strut: "strutting",
  gyrate: "gyrating",
  pop: "popping",
  clap: "clapping",
  drip: "dripping",
  soak: "soaking",
  splash: "splashing",
  rinse: "rinsing",
  scrub: "scrubbing",
  dry: "drying",
  shave: "shaving",
  brush: "brushing",
  paint: "painting",
  apply: "applying",
  read: "reading",
  cook: "cooking",
  bake: "baking",
  clean: "cleaning",
  wash: "washing",
  drive: "driving",
  sunbathe: "sunbathing",
  tan: "tanning",
  exercise: "exercising",
  sleep: "sleeping",
  nap: "napping",
  yawn: "yawning",
  relax: "relaxing",
  rest: "resting",
  chill: "chilling",
  sing: "singing",
  whisper: "whispering",
  talk: "talking",
  laugh: "laughing",
  giggle: "giggling",
  grin: "grinning",
  smirk: "smirking",
  pout: "pouting",
  blush: "blushing",
  cry: "crying",
  beg: "begging",
  bow: "bowing",
  mount: "mounting",
  climb: "climbing",
  tilt: "tilting",
  prop: "propping",
  throw: "throwing",
  toss: "tossing",
  bring: "bringing",
  come: "coming",
  go: "going",
  keep: "keeping",
  let: "letting",
  make: "making",
  be: "being",
  act: "acting",
  pretend: "pretending",
  imagine: "imagining",
  feel: "feeling",
  enjoy: "enjoying",
  love: "loving",
  start: "starting",
  begin: "beginning",
  stop: "stopping",
  finish: "finishing",
  continue: "continuing",
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

  // "spread her legs and show her pussy": the second order is an imperative
  // too, and it was left as one — "She is spreading her legs and show her
  // pussy." A conjunction followed by a verb from the table is the same case.
  const joined = a.replace(/(,|\band\b|\bthen\b|\bwhile\b)\s+(?!close\s+(?:to|up)\b)([a-z]+)\b/gi, (m, c, v) => {
    const g = IMPERATIVE_GERUND[v.toLowerCase()];
    return g ? `${c} ${g}` : m;
  });
  const first = joined.split(/\s+/)[0];
  const gerund = IMPERATIVE_GERUND[first.toLowerCase()];
  if (gerund) return `${Subject} ${verb} ${gerund}${joined.slice(first.length)}.`;

  const needsVerb = /^(?:her|his|their|its|a|an|the)\b/i.test(joined) || BARE_NOUN_START.test(joined);
  return `${Subject} ${verb} ${needsVerb ? "showing " : ""}${joined}.`;
}

// Acts she does to HER OWN body with her mouth or hands, after normalizeRequest
// has turned "your" into "her". Written out in full because the one-word
// version fails: "licking her tits" rendered as her holding a toy up to her
// mouth. "Licking" is a word the checkpoint has mostly seen next to a penis,
// and nothing in the sentence said what was in her hands — so it drew the
// thing it expected. Each clause here says whose part it is, where the contact
// is, what BOTH hands are doing, and that she is alone.
const SELF_BREAST_ORAL_RE =
  /\b(?:lick\w*|suck\w*|kiss\w*|bit(?:e|es|ing)|nibbl\w*|tongu\w*)\b[^.?!]{0,30}\b(?:her|his|their|own|your)\s+(?:own\s+)?(?:tits?|titties|boobs?|boobies|breasts?|nipples?|chest)\b/i;
const SELF_TONGUE_OUT_RE =
  /\b(?:stick\w*|put\w*|poke\w*|hang\w*)\s+(?:out\s+)?(?:her|his|their|your)\s+tongue\b|\btongue\s+(?:sticking|stuck|hanging)?\s*out\b/i;
const SELF_FINGER_MOUTH_RE =
  /\b(?:suck\w*|lick\w*)\s+(?:on\s+)?(?:her|his|their|your)\s+(?:own\s+)?fingers?\b|\bfingers?\s+in\s+(?:her|his|their|your)\s+mouth\b/i;
const SELF_LIPS_RE = /\b(?:bit\w*|lick\w*)\s+(?:her|his|their|your)\s+(?:own\s+)?lips?\b/i;

/** Licking or sucking her own breast — the one self-act with a pose the checkpoint fights. */
export function isBreastSelfAct(req: string): boolean {
  return SELF_BREAST_ORAL_RE.test(req ?? "");
}

export function isSelfAct(req: string): boolean {
  const t = req ?? "";
  return (
    SELF_BREAST_ORAL_RE.test(t) ||
    SELF_TONGUE_OUT_RE.test(t) ||
    SELF_FINGER_MOUTH_RE.test(t) ||
    SELF_LIPS_RE.test(t)
  );
}

// Anything that changes her MOUTH: a self-act (all of them involve it) or a
// toy with an oral verb. The FaceID lock and the FaceDetailer both pull the
// face back toward her portrait — a closed-lip smile — so on these the
// renderer gets a lighter face lock and no detailer pass (see comfySettings),
// or the act never shows: "sucking on a dildo" came back as the toy held
// beside a smiling closed mouth.
const MOUTH_VERB_RE =
  /\b(?:suck\w*|lick\w*|blow\w*|deep\s*throat\w*|gag\w*|mouth|tongue|lips|kiss\w*)\b/i;
export function isMouthAct(req: string): boolean {
  const t = req ?? "";
  return isSelfAct(t) || (hasProp(t) && MOUTH_VERB_RE.test(t));
}

// The act as short tags, for the front of a ComfyUI prompt with emphasis
// (see comfyJobInput). The prose sentence is right but it is one clause among
// twenty, and a checkpoint reads the first few tokens hardest: "licking your
// tits" rendered as a hand cupping a breast and a smile at the camera, with
// the licking sentence sitting correct and ignored in the middle of 200 words.
// Pronoun-free so the same tags serve every body.
// Her climax, his climax: the fluid is the act, and it comes from her or
// his OWN body — never a partner's. Every way people ask for it, including
// the slang, so "make yourself cum", "squirt for me", "bust a nut" and
// "shoot your load" all land here.
const CLIMAX_RE = new RegExp(
  "\\b(?:" + KW.cum + ")\\b",
  "i",
);
const SQUIRT_RE = /\b(?:squirt\w*|gush\w*|female ejaculat\w*)\b/i;
export function isClimaxAct(req: string): boolean {
  return CLIMAX_RE.test(req ?? "");
}

export function climaxSentence(req: string, a: Anatomy): string {
  const t = req ?? "";
  if (!CLIMAX_RE.test(t)) return "";
  const S = `${a.subject[0].toUpperCase()}${a.subject.slice(1)}`;
  const { poss } = a;
  if (a.hasPenis) {
    return `${S} ${a.is} ejaculating right now: thick white cum spurting from the tip of ${poss} own cock in ropes and landing across ${poss} stomach and chest, ${poss} fist still wrapped around the shaft mid-stroke, ${poss} head back and mouth open. ${S} ${a.is} alone in the frame; the cum is ${poss} own.`;
  }
  if (a.hasVulva) {
    const squirt = SQUIRT_RE.test(t) || /\bcum\w*|come\b/i.test(t);
    return squirt
      ? `${S} ${a.is} in the middle of ${poss} own orgasm: eyes squeezed shut, mouth open, back arched, a clear arc of fluid squirting from ${poss} pussy and running down ${poss} inner thighs, ${poss} fingers still pressed on ${poss} clit. ${S} ${a.is} alone in the frame; the wetness is ${poss} own.`
      : `${S} ${a.is} in the middle of ${poss} own orgasm: eyes squeezed shut, mouth open, back arched, ${poss} pussy glistening wet, ${poss} fingers still pressed on ${poss} clit. ${S} ${a.is} alone in the frame.`;
  }
  return `${S} ${a.is} in the middle of ${poss} own orgasm, eyes squeezed shut, mouth open, back arched. ${S} ${a.is} alone in the frame.`;
}

// Rubbing / fingering herself: the hand is the act, and "right hand between
// her thighs" in the prose rendered no hand at all.
const RUB_RE =
  /\b(?:rub\w*|finger\w*|touch\w*|play\w*\s+with|stroke\w*|masturbat\w*|pleasur\w*)\b[^.?!]{0,30}\b(?:her|his|their|your|own|)\s*(?:self|pussy|clit\w*|vulva|cunt|slit)\b|\bmasturbat\w*/i;
export function isRubAct(req: string): boolean {
  return RUB_RE.test(req ?? "");
}

// Penetrative fingering needs a different still and motion from clitoral
// rubbing. Keeping both under RUB_RE made "finger yourself" render as fingers
// sliding over the surface, then videoActionLock reinforced circular rubbing.
const FINGER_INSERT_RE =
  /\b(?:finger\w*\s+(?:her|him|them|your|my)?\s*(?:self|pussy|vagina|cunt|slit)|(?:insert|push|slide|stick)\w*\s+(?:one|two|\d+|your|her|his|their)?\s*fingers?\s+(?:in|into|inside|up)|fuck\w*\s+(?:yourself|herself|himself|themselves)\s+(?:with|using)\s+(?:your|her|his|their)?\s*fingers?)\b/i;
export function isFingerInsertAct(req: string): boolean {
  return FINGER_INSERT_RE.test(req ?? "");
}

// Her own hands on her own breasts — squeezing, cupping, pinching. No pose
// problem, but "She is squeeze her tits" was the whole instruction before.
const BREAST_HANDS_RE =
  /\b(?:squeez\w*|hold\w*|cup\w*|grab\w*|press\w*|pinch\w*|massag\w*|play\w*\s+with|fondl\w*|lift\w*)\b[^.?!]{0,20}\b(?:her|his|their|your|own)\s+(?:own\s+)?(?:tits?|titties|boobs?|boobies|breasts?|nipples?)\b/i;
export function isBreastHandsAct(req: string): boolean {
  return BREAST_HANDS_RE.test(req ?? "") && !SELF_BREAST_ORAL_RE.test(req ?? "");
}

export function mouthActTags(req: string, hasPenis = false): string {
  const t = req ?? "";
  if (CLIMAX_RE.test(t) && !isMouthAct(t))
    return hasPenis
      ? "cumshot, ejaculation, thick cum spurting from own penis, ropes of cum on own stomach, hand stroking own cock, head back, mouth open"
      : SQUIRT_RE.test(t) || /\bcum\w*|come\b/i.test(t)
        ? "squirting, female ejaculation, clear fluid spraying from own pussy, orgasm face, eyes shut, mouth open, back arched, fingers on own clit"
        : "orgasm face, eyes shut, mouth open, back arched, wet glistening pussy, fingers on own clit";
  if (isBreastHandsAct(t))
    return /pinch/i.test(t)
      ? "pinching own nipples, fingers on own nipples, both hands on own breasts, looking at the camera"
      : "squeezing own breasts, both hands cupping own breasts, fingers pressing into own breasts, breasts pushed together, looking at the camera";
  if (!isMouthAct(t) && FINGER_INSERT_RE.test(t))
    return "penetrative fingering, two fingers visibly inserted inside own pussy, vaginal opening overlapping the fingers at entry, fingertips hidden inside, hand between thighs, legs spread";
  if (!isMouthAct(t) && RUB_RE.test(t))
    return "rubbing own pussy, hand between own thighs, two fingers pressed on own clit, legs spread, looking down at own hand";
  if (SELF_BREAST_ORAL_RE.test(t))
    // No "tongue out" here: on its own that tag reads as a face tilted BACK
    // with the tongue out at the camera, which is what came back. Everything
    // here says down.
    // The word "tongue" is kept OUT of these tags on purpose. The one render
    // with her head down was the one without it; every render with it came
    // back face-up, tongue at the camera — that is what the checkpoint has
    // learned "tongue" means. The prose sentence still says where the tongue
    // is; the tags say where the HEAD is.
    // The set that produced a head-down render, plus where the hands go and
    // nothing else. "looking down" and "face turned down" were tried and the
    // model answered them with a camera placed BELOW her, looking down at the
    // lens; a pose negative added at the same time coincided with every
    // render coming back face-up. Both are gone.
    return "sucking own nipple, licking own nipple, mouth on own nipple, head bent down to own breast, chin tucked to chest, eyes on own nipple, breast pushed up into mouth, hands under the breast";
  if (SELF_FINGER_MOUTH_RE.test(t))
    return "sucking own finger, finger in mouth, lips closed around finger";
  if (SELF_TONGUE_OUT_RE.test(t)) return "tongue out, mouth open, tongue sticking out";
  if (SELF_LIPS_RE.test(t)) return "biting lower lip";
  if (hasProp(t) && /\b(?:suck\w*|lick\w*|blow\w*|deep\s*throat\w*|mouth|tongue|lips)\b/i.test(t))
    return "sucking a dildo, dildo in mouth, lips wrapped around the dildo, mouth open, holding the dildo by its base";
  return "";
}

/** The self-act puts at least one of her hands to work, so a posture line that parks both hands elsewhere must give way. */
export function selfActUsesHands(req: string): boolean {
  const t = req ?? "";
  return SELF_BREAST_ORAL_RE.test(t) || SELF_FINGER_MOUTH_RE.test(t);
}

// Replaces the plain action sentence for a self-act. Returns "" when the
// request is not one, so callers fall back to actionSentence.
export function selfActSentence(req: string, a: Anatomy): string {
  const t = req ?? "";
  const { poss, is } = a;
  const S = `${a.subject[0].toUpperCase()}${a.subject.slice(1)}`;
  const alone = `${S} ${is} alone in the frame and ${poss} hands hold nothing.`;
  if (a.hasBreasts && SELF_BREAST_ORAL_RE.test(t)) {
    // Both hands UNDER the breast. "one hand lifting her breast toward her
    // mouth" put the hand at her mouth and she licked the hand; with the
    // hands cupping from underneath, the only thing at her lips is the nipple.
    return `${S} bends ${poss} head down to ${poss} own breast; both ${poss} hands cup the underside of ${poss} left breast and push it up so the nipple sits at ${poss} lips, and the tip of ${poss} tongue touches ${poss} own nipple. ${poss[0].toUpperCase()}${poss.slice(1)} hands stay below the nipple, cupping the breast from underneath. ${alone}`;
  }
  if (SELF_FINGER_MOUTH_RE.test(t)) {
    return `${S} rests ${poss} own index finger between ${poss} lips, looking into the lens, ${poss} other hand resting on ${poss} thigh. ${alone}`;
  }
  if (SELF_TONGUE_OUT_RE.test(t)) {
    return `${S} sticks ${poss} tongue out between ${poss} lips, looking into the lens, both hands resting on ${poss} own body. ${alone}`;
  }
  if (SELF_LIPS_RE.test(t)) {
    return `${S} bites ${poss} own lower lip, looking into the lens, both hands resting on ${poss} own body. ${alone}`;
  }
  return "";
}

// Detects close-up / POV / close proximity requests so framing doesn't force a wide camera shot.
export const CLOSE_UP_RE =
  /\b(close[- ]?ups?|close to|in my face|to my face|in front of my face|against the camera|near camera|close to camera|pov|point of view|macro|tight shot|intimate view|front of camera|up close|zoom\w*|zoomed|right up|face in your)\b/i;

// Detects a request for a view from behind, so the front-facing framing and the
// front-facing anatomy block don't overwrite it.
//
// The refiner used to have no notion of this at all: the only rule that knew
// "from behind" was one clause of the posture bullet, and it was outvoted by an
// anatomy block that says "write it in exactly those words" and by three
// front-facing worked examples. A request for a rear view came back as a
// front-facing nude — a different picture from the one that was paid for, which
// is the same failure class as the unrequested-toy bug.
export const REAR_RE =
  /\b(from behind|behind you|behind her|rear view|from the back|back view|back to (?:me|the camera)|turn(?:ed|ing)? around|face away|facing away|bend(?:ing)? over|bent over|doggy\w*|all fours|on your knees facing|twerk\w*|arch(?:ed|ing)? back towards|present(?:ing)?)\b/i;

/**
 * "send another one", "one more", "again" — a request that means whatever the
 * last one meant.
 *
 * Reported as "it can't even understand basic communication", and that is a
 * fair description: she sends a photo, the user says the most natural thing in
 * the language, and nothing happens. wantsSelfie needs a word like pic, selfie
 * or nude in the message, and "send another one" has none of them — so no
 * render was queued and the message fell through to the chat model, which is
 * exactly where it then copied a teaser and promised a photo that was never
 * coming. One missing branch produced both complaints.
 *
 * Deliberately narrow. It only means anything when the previous thing she sent
 * WAS media, and the caller checks that; on its own "again" is ordinary talk.
 */
export function isFollowUpMediaRequest(req: string): boolean {
  const s = (req ?? "").trim().toLowerCase();
  if (!s || s.length > 60) return false;
  return /^(?:(?:can (?:you|u)|could (?:you|u)|please|pls|plz|now|and|ok|okay)\s+)*(?:send|gimme|give me|show me|take|do|make)?\s*(?:me\s+)?(?:another|one more|1 more|more|again|anotha)\b|^(?:again|more|another)\b/.test(
    s,
  );
}

// Words that add nothing to a follow-up: "another one please babe".
const FOLLOW_UP_FILLER =
  /\b(?:one|ones|pic|pics|pix|picture|pictures|photo|photos|selfie|selfies|of you|please|pls|plz|babe|baby|hun|honey|now|too|then|but|and|ok|okay|for me|lol)\b/gi;

/**
 * What a follow-up adds on top of "another": "send me another with your legs
 * spread" -> "with your legs spread". Empty when it adds nothing.
 *
 * isFollowUpMediaRequest only reads the START of the message, and the caller
 * then reused the previous request word for word — so "another one with your
 * legs spread" came back as a copy of the last photo and the pose was dropped.
 */
export function followUpDetail(req: string): string {
  if (!isFollowUpMediaRequest(req)) return "";
  const rest = (req ?? "")
    .trim()
    .replace(
      /^(?:(?:can (?:you|u)|could (?:you|u)|please|pls|plz|now|and|ok|okay)\s+)*(?:send|gimme|give me|show me|take|do|make)?\s*(?:me\s+)?(?:another|one more|1 more|more|again|anotha)\b/i,
      "",
    )
    .replace(/[?!.]+$/g, "")
    .trim();
  const meaningful = rest.replace(FOLLOW_UP_FILLER, "").replace(/[\s,?!.]+/g, "");
  return meaningful ? rest.replace(/^(?:one|pic|photo|picture)\b\s*/i, "").trim() : "";
}

/**
 * Whether the request wants a garment kept ON and a part visible at the same
 * time — "in lingerie with your pussy showing".
 *
 * That is one request, and the binary could not hold it. Naming a part makes
 * requestIsNude true, so it resolved to fully nude: CLOTHING_NEGATIVE went out
 * suppressing `bra, lingerie, panties` while the refiner wrote the lingerie the
 * user had asked for into the same prompt. The two halves pushed against each
 * other and the render split the difference — the garment arrived, the part did
 * not, and neither instruction was really followed.
 *
 * It is the `partial` state: a garment worn, and skin bare around it. The one
 * difference from a garment pulled down is that here it was never moved.
 */
export function requestKeepsGarment(req: string): boolean {
  const p = req ?? "";
  if (!GARMENT_RE.test(p)) return false;
  // "take your bra off and show me your tits" names a garment AND a part, and
  // was read as keeping the bra on — so nothing pushed it off, and the
  // builder said she was "wearing what was asked for".
  if (GARMENT_OFF_RE.test(p)) return false;
  return (["vulva", "breasts", "ass"] as const).some((part) => mentionsPart(p, part));
}

// Everything a person can be asked to keep on. Lingerie, and the ordinary
// clothes that used to be pushed away by CLOTHING_NEGATIVE the moment a body
// part was named beside them: "in a dress with your tits out" lost the dress.
const GARMENT_WORDS =
  "dress|skirt|mini\\s*skirt|top|crop\\s*top|tank\\s*top|t-?shirt|shirt|blouse|jeans|shorts|leggings|yoga\\s*pants|pants|trousers|heels|high\\s*heels|boots|socks|thigh\\s*highs?|fishnets?|jacket|hoodie|sweater|cardigan|uniform|costume|outfit|robe|bathrobe|towel|apron|corset|bodysuit|swimsuit|one-?piece|sweatpants|pajamas|pyjamas|pjs|nightgown|gown|lab\\s*coat|nurse\\s*outfit|maid\\s*outfit|cheerleader|bunny\\s*(?:suit|outfit|ears)|cat\\s*ears|collar|choker|gloves|hat|glasses|sunglasses|mask|scarf|coat|cosplay|jersey|bikini\\s*top|bikini\\s*bottoms?|swim\\s*trunks|boxers|briefs|jockstrap|harness|leather|latex|silk|satin|lace";
const GARMENT_RE = new RegExp(`\\b(?:${KW.lingerie}|${GARMENT_WORDS})\\b`, "i");
// The garment is coming OFF, or was never on.
const GARMENT_OFF_RE = new RegExp(
  `\\b(?:tak\\w*|pull\\w*|slip\\w*|peel\\w*|rip\\w*|strip\\w*|get\\w*|throw\\w*|toss\\w*|kick\\w*)\\s+(?:off|down|out of)?\\s*(?:your|ur|her|his|their|the|that|those|my)?\\s*(?:${KW.lingerie}|${GARMENT_WORDS})\\s*(?:off|down|away)?\\b` +
    `|\\b(?:${KW.lingerie}|${GARMENT_WORDS})\\s+(?:off|down|removed|gone|on the floor)\\b` +
    `|\\b(?:without|no|remov\\w*|los\\w*|ditch\\w*|drop\\w*)\\s+(?:your|ur|her|his|their|the|any|that|those|my)?\\s*(?:${KW.lingerie}|${GARMENT_WORDS})\\b` +
    `|\\b(?:${KW.lingerie}|${GARMENT_WORDS})\\s+(?:pulled|slid|pushed|moved)\\s+(?:down|aside|to the side|off)\\b`,
  "i",
);

/**
 * Whether the request sets its own viewpoint, rather than leaving the default
 * front-facing one to stand.
 *
 * The single authority on the question, the way anatomyOf is the single
 * authority on whose body it is — and for the same reason. The refiner grew its
 * own copy of this test, fixed the front-facing block in ITS system prompt, and
 * the request still came back showing the wrong part, because two more places
 * inject front anatomy and neither of them was asking: the "her pussy is closed"
 * bullet, which fires on any request naming no touching and no toy, and
 * nudeAnatomy() in the three builders below, which fires on any nude request at
 * all. Three injections, one of them fixed, so nothing visibly changed.
 */
export function requestSetsViewpoint(req: string): boolean {
  const p = req ?? "";
  return REAR_RE.test(p) || mentionsPart(p, "ass");
}

// "Legs spread on the bed" is a pose and a setting, not a request for a
// side/rear glamour angle.  Keeping this as a named intent lets every prompt
// path (refiner, keyword fallback and final prompt lock) use the same
// composition instead of relying on a model to infer it from loose words.
const BED_RE = /\b(?:bed|mattress|sheets?)\b/i;
const LEGS_SPREAD_RE =
  /\b(?:legs?|thighs?)\s+(?:spread|open|apart|wide)\b|\b(?:spread|open|splay\w*)\s+(?:your|her|his|their|the|my)?\s*(?:legs?|thighs?)\b/i;

export function requestHasBedSpread(req: string): boolean {
  const p = req ?? "";
  return BED_RE.test(p) && LEGS_SPREAD_RE.test(p) && !requestSetsViewpoint(p);
}

// Detects a posture the user named, so the rules stop inferring one over the top
// of it.
//
// The posture bullet opens "INFER from the act rather than wait to be told", and
// the bullet under it ends "even then, when she is lying down at all, write
// 'propped up on a stack of pillows, shoulders and upper back raised'". Between
// them there was no way to ask for a posture and get it: "lie down" was
// answered with propped up on pillows, by a rule that fires hardest exactly when
// the user HAS said what they want. Inference is the right default for a request
// that named nothing; it is the wrong answer to a request that named something.
// Distinct from the POSTURE_RE further down this file, which answers a different
// question for the keyword builder: that one counts any ACT that "standing"
// would fight — dildo, oral, anal, fuck — as carrying a posture. Here an act is
// exactly what should still be inferred from, so only postures the user actually
// NAMED belong in this list.
export const STATED_POSTURE_RE =
  /\b(lie|lying|lay|laying|lie down|lying down|lay down|flat on|on (?:your|her|his|their) (?:back|side|stomach|front|knees)|stand|standing|stand up|upright|sit|sitting|seated|sit up|kneel\w*|squat\w*|crouch\w*|bend over|bent over|all fours|crawl\w*|straddl\w*|rid(?:e|ing)|turn\w*|face (?:me|away|the)|facing|lean\w*|arch\w*|on top|spread eagle|spread\w*|legs (?:open|apart)|open (?:your|her|his|their) legs|legs crossed|cross(?:ed)? (?:your|her) legs)\b/i;

// Detects a garment the user put in a PARTIAL position — pulled down, pushed
// aside, unzipped — as distinct from dressed and from nude.
//
// requestIsNude is a boolean, so a request like this resolved to one of two
// templates: "completely nude" (which drops the garment the user named) or
// "every garment STAYING ON" (which drops the position they put it in). Either
// way the specified detail is discarded. This is the third state.
export const PARTIAL_UNDRESS_RE =
  /\b(pull\w*\s+(?:up|down|aside|back|open)|push\w*\s+(?:up|down|aside)|roll\w*\s+(?:up|down)|slid\w*\s+(?:up|down|aside)|hike\w*\s+up|lift\w*\s+up|yank\w*\s+(?:up|down)|tug\w*\s+(?:up|down|aside)|unzip\w*|unbutton\w*|unclasp\w*|unhook\w*|half\s+(?:off|on|undone)|one\s+strap|off\s+(?:one|your|her)\s+shoulder|around\s+(?:your|her)\s+(?:knees|ankles|thighs|hips|waist))\b/i;

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

/**
 * Whether a real image endpoint is rendering this, rather than a frame cut out
 * of a clip.
 *
 * The chin-to-knees crop below is a WAN compensation and its own comment says
 * why: at 480-640 rendered lines a head-to-knees frame leaves a vulva about
 * forty pixels wide, so the camera was pushed in to buy detail, at the cost of
 * the top of her face. ComfyUI renders 832x1216 in one pass — about 2.5x the
 * lines — so the same frame carries the detail the crop was bought for, and
 * paying the face for it is no longer a trade worth making.
 *
 * The env var is read directly rather than through imageProvider: that lives in
 * media.functions, which imports this file, and a cycle here would be a worse
 * problem than a duplicated line.
 */
function rendersAtStillResolution(): boolean {
  return Boolean((process.env.RUNPOD_COMFY_ENDPOINT ?? "").trim());
}

function framingFor(
  noun: string,
  poss: string,
  posed: boolean,
  hasReq: boolean,
  name?: string,
  isCloseUp?: boolean,
  groinFocus?: boolean,
  shot?: Shot,
  bedSpread?: boolean,
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

  if (bedSpread) {
    return `Front-facing reclining bed photograph of ${article(noun)} ${noun}, camera positioned at the foot of the bed at a slightly elevated eye-level angle, ${poss} face and front of ${poss} body clearly visible from head to knees, ${poss} legs raised and spread wide toward the camera, ${poss} knees apart, bed and pillows filling the background.`;
  }

  // A request that is ABOUT her pussy gets a closer camera than one that merely
  // ends up nude.
  //
  // This is the only lever in the whole prompt that gives that anatomy more
  // pixels. A head-to-knees frame is about 150cm of body across roughly 640
  // rendered lines, which leaves a vulva something like forty pixels wide —
  // below what any description can survive, and the reason it reads as a smear
  // whatever the words say. Chin-to-knees is about 90cm in the same lines, so
  // every fold gets nearly twice the detail.
  //
  // The cost is the top of her face, and it is a real cost: this codebase has a
  // long history of pictures coming back as headless torsos and users hating
  // it. So the crop is stated as a composition with her mouth and chin held at
  // the top edge — a deliberate photograph rather than an accident — and only
  // for a request that names the part, never for a plain nude.
  if (groinFocus) {
    return `Photograph of ${article(noun)} ${noun} indoors, framed from ${poss} chin down to ${poss} knees with ${poss} mouth and chin at the top edge of the frame, ${poss} hips and groin in the centre of the frame in sharp focus, ${poss} hands resting on ${poss} thighs, camera about one metre away at hip height.`;
  }

  // "portrait", "headshot", "face pic": the face IS the request, so it fills
  // the frame instead of sitting small at the top of a full-length shot.
  if (shot === "face") {
    return `Head and shoulders portrait photograph of ${article(noun)} ${noun}, framed from the top of ${poss} head down to ${poss} upper chest, ${poss} face filling the upper half of the frame in sharp focus and looking into the lens, camera about one metre away at eye level.`;
  }
  if (shot === "back") {
    return `Photograph of ${article(noun)} ${noun} indoors seen from behind, framed from the top of ${poss} head down to ${poss} knees, ${poss} back and hips towards the camera and ${poss} head turned to look back over ${poss} shoulder into the lens, ${poss} face clearly visible, camera about two metres away at chest height.`;
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

type Shot = "face" | "back" | null;

// Which fixed composition the request names, if any. A face shot only applies
// to a clothed request: "pic of your face while you're naked" is a nude, and
// cropping to the shoulders would cut out what was asked for.
export function requestedShot(req: string): Shot {
  // Only the word itself. "from behind, on all fours" is a viewpoint the user
  // wrote out, and requestSetsViewpoint hands that to their own words instead.
  if (/\bback ?shots?\b/i.test(req)) return "back";
  if (
    !requestIsNude(req) &&
    /\b(?:portraits?|potraits?|portaits?|protraits?|head ?shots?|face ?(?:pics?|pix|photos?|pictures?|shots?|selfies?)|close[- ]?up of (?:your|ur|her|his) face|(?:pics?|pix|photos?|pictures?|selfies?) of (?:your|ur) (?:\w+ )?face)\b/i.test(
      req,
    )
  )
    return "face";
  return null;
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
// "natural skin mottling and colour variation" is gone from all three of these
// tails. It went out in the same untested batch as the render settings that
// were rolled back, and mottling is what blotchy, patchy, discoloured skin is
// called — on a close frame of a vulva that is the difference between real and
// diseased. Pores, fine texture and a matte finish already carry the realism.
// Lock chat selfies to the same person as companions.image_url (homepage card).
// Applied whenever a reference portrait is used (img2img / FaceID) — not on
// pure text-to-image graphs that have no photo of her.
//
// Positive words only, like every other clause here: the renderer cannot read
// "do not" and draws the nouns next to it, so "do not invent different hair
// color" asked for different hair colour.
// Short on purpose: it is reserved out of the same 300-word budget as the prop
// spec, and on a toy request the spec alone takes about 254 of those words.
export const IDENTITY_LOCK =
  "Same person as the reference photo: identical face, eyes, eye color, hair color, hairstyle, skin tone, ethnicity, age and body proportions.";

/** Forced when the user asked for nude — img2img otherwise keeps portrait clothes. */
export const NUDE_FORCE =
  "Completely nude, fully undressed, bare skin everywhere, bare breasts and bare groin, wardrobe fully removed.";

/**
 * The same clause for the body in question. It said "bare breasts" on every
 * nude render, a man's included — and a man's prompt that asks for breasts
 * gets them.
 */
export function nudeForceFor(a?: Anatomy | null): string {
  return a && !a.hasBreasts
    ? NUDE_FORCE.replace("bare breasts and bare groin", "bare chest and bare groin")
    : NUDE_FORCE;
}

/**
 * What she does when the request says only how explicit the picture should
 * be — "send me a dirtier picture", "a nasty photo of you". Those words all
 * came off with the ask, and what was left was the default pose: a nude in
 * the same posture a plain "send me a pic" gets. "Dirty" means the one thing
 * the body can show that a plain nude does not.
 */
function fallbackAct(req: string, a: Anatomy, moving: boolean): string {
  if (req.trim() && kw(KW.explicitIntent).test(req) && !kw(KW.lingerie).test(req)) {
    if (a.hasVulva) return `naked with ${a.poss} legs spread wide, showing ${a.poss} pussy to the camera`;
    if (a.hasPenis) return `naked with ${a.poss} legs apart, showing ${a.poss} hard cock to the camera`;
    return `naked, showing ${a.poss} whole body to the camera`;
  }
  return moving
    ? "performing a slow seductive striptease for the camera"
    : "posing seductively for the camera";
}

const QUALITY =
  "Clear high-resolution candid photograph on a phone, unretouched, natural available light, true-to-life colour, natural healthy skin with fine pores and fine texture, matte natural finish, light natural makeup, clean sharp detail, soft natural shadows. Looks like a real photo taken on a modern phone.";

/**
 * The same photograph, for a renderer that draws a still directly.
 *
 * Everything a chat photo needs — the framing, the inferred posture, the
 * anatomy clause, the realism tail — is identical whether the picture is cut
 * out of a clip or rendered in one pass. What differs is the tail: a clip has
 * to be told to arrive at the pose and hold it, and telling a still image model
 * that the camera holds its position is at best wasted conditioning.
 *
 * The alternative was the booru builder (selfiePrompt), which is what the
 * ComfyUI path reached for first. It writes "mirror selfie, holding phone,
 * full body, pubic hair" — a different composition from the one the request
 * asked for, a phone and a pair of hands to render wrong, and body hair the
 * anatomy clause says is shaved. One builder, one photograph.
 */
export function stillImagePrompt(
  c: { gender?: string | null; name?: string },
  userPrompt?: string | null,
  toy?: Toy | null,
  setting?: Setting,
): string {
  return buildStillPrompt(c, userPrompt, { holdCue: false, toy, setting });
}

export function videoStillPrompt(
  c: { gender?: string | null; name?: string },
  userPrompt?: string | null,
  toy?: Toy | null,
  setting?: Setting,
): string {
  return buildStillPrompt(c, userPrompt, { holdCue: true, toy, setting });
}

function buildStillPrompt(
  c: { gender?: string | null; name?: string },
  userPrompt: string | null | undefined,
  opts: { holdCue: boolean; toy?: Toy | null; setting?: Setting },
): string {
  const req = (userPrompt ?? "").trim();
  const toy = opts.toy ?? null;
  // One resolver, and it reads ONLY the companion's stored gender. Each builder
  // in this file used to re-derive this with its own copy-pasted block that
  // also sniffed the user's message for "trans" and "futa" — so typing those
  // words changed whose body was rendered. See the header of anatomy.ts.
  const a = anatomyOf(c.gender);
  const { noun, subject, poss } = a;

  const nude = requestIsNude(req);
  // The nudity is stated either way; what is withheld when the user set their
  // own viewpoint is the front-facing anatomy paragraph, which described a chest
  // and a vulva on a request that asked for neither. The action sentence carries
  // the user's own words, which is what should be describing the subject here.
  // A request that keeps a garment ON must not also assert full nudity.
  //
  // This builder branched on requestIsNude alone, and naming a part makes that
  // true — so "in lingerie with your pussy showing" produced a prompt saying
  // BOTH "she is with lingerie on with her pussy showing" AND "she is already
  // completely naked, bare skin everywhere", two sentences apart. The renderer
  // was told two opposite things and split the difference, which is what "it is
  // not listening to what I asked" looked like from the outside.
  //
  // The refiner learned this one commit ago; the builders did not, and they are
  // the fallback whenever Grok is unavailable.
  const undress = requestKeepsGarment(req)
    ? `${subject} ${a.is} wearing what was asked for, and bare around it.${
        requestSetsViewpoint(req) ? "" : ` ${nudeAnatomy(c.gender)}`
      }`
    : nude
      ? `${subject} ${a.is} already completely naked, bare skin everywhere.${
          requestSetsViewpoint(req) ? "" : ` ${nudeAnatomy(c.gender)}`
        }`
      : `${subject} hold${a.s} the pose.`;

  // NOTE: deliberately no actionTags here. Those are booru tags ("bent over,
  // presenting, ass, rear view") written for the Pony IMAGE model, and feeding
  // them to WAN made it compose a tight crop around the act — photos came back
  // as a headless torso, and at higher tag density as an extreme close-up, no
  // matter what the framing text said. The user's own words in plain language
  // render the same act and keep the camera wide.
  const action = normalizeRequest(req, subject) || fallbackAct(req, a, false);
  const isCloseUp = CLOSE_UP_RE.test(req);
  const bedSpread = requestHasBedSpread(req);
  const Subject = `${subject[0].toUpperCase()}${subject.slice(1)}`;
  const settles = `settle${a.s}`;

  // A nude request that names no posture got none, so "show me your pussy"
  // described open thighs on a figure with nowhere to be, and the model either
  // stood her up or laid her flat — where breasts spread and sag. Propped up on
  // pillows keeps the chest lifted and the thighs naturally apart, and one plain
  // setting leaves the words for her. An empty request is left alone: its
  // framing sentence already picks a stance.
  //
  // A request that says "lying" gets a posture too, because flat on her back is
  // the one pose in which the model spreads her breasts sideways and the
  // picture comes back looking sagging. She is still lying down — propped up
  // on pillows, chest lifted — which is also how the reference photos in the
  // refiner's examples have her.
  const lyingDown = /\b(?:lying|lie|laid|lay|on (?:her|his|their|your|my) back)\b/i.test(req);
  // A hand with a job in the act cannot also be resting on her thigh. The
  // posture line said it was, two sentences after the act said otherwise.
  const handsBusy =
    selfActUsesHands(req) ||
    isRubAct(req) ||
    isBreastHandsAct(req) ||
    hasProp(req) ||
    Boolean(toy) ||
    isClimaxAct(req);
  const handsLine = handsBusy ? "" : `, ${poss} hands resting on ${poss} thighs`;
  const freeHands = (text: string) =>
    handsBusy ? text.replace(`, ${poss} hands resting on ${poss} thighs`, "") : text;
  const posture =
    bedSpread
      ? `${Subject} ${a.is} reclining on ${poss} back on the bed against pillows, ${poss} face turned toward the camera, ${poss} legs raised and spread wide with ${poss} knees apart${handsLine}, the bed and pillows clearly visible around ${poss} body.`
      : nude && req && !POSTURE_RE.test(req)
      ? `${Subject} ${a.is} reclining back against pillows on ${opts.setting ? "the bed" : "a bed with plain white sheets"}, propped up on ${poss} elbows, ${poss} back gently arched and ${poss} knees apart${handsLine}, soft daylight from a window beside ${a.object}.`
      : nude && lyingDown
        ? `${Subject} ${a.is} lying back against a stack of pillows, ${poss} shoulders and upper back raised, ${poss} back gently arched${handsLine}.`
        : "";

  return [
    freeHands(
      framingFor(
        noun,
        poss,
        POSTURE_RE.test(req),
        !!req,
        c.name,
        isCloseUp,
        // Only where there is a vulva to point the camera at, only on a still,
        // and only where the renderer actually needs the help.
        a.hasVulva && mentionsPart(req, "vulva") && !rendersAtStillResolution(),
        requestedShot(req),
        bedSpread,
      ),
    ),
    selfActSentence(action, a) || actionSentence(subject, action),
    climaxSentence(req, a),
    posture,
    `${undress[0].toUpperCase()}${undress.slice(1)}`,
    propClause(req, { anatomy: a, toy }),
    settingSentenceFor(opts.setting),
    QUALITY,
    opts.holdCue
      ? isCloseUp
        ? `The camera holds its position close in. ${Subject} ${settles} into a still held pose at the end.`
        : `The camera holds its position. ${Subject} ${settles} into a still held pose at the end.`
      : "",
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
  toy?: Toy | null,
  setting?: Setting,
): string {
  const req = (userPrompt ?? "").trim();
  const a = anatomyOf(c.gender);
  const opts = { setting };
  const { noun, subject, poss } = a;
  const Subject = `${subject[0].toUpperCase()}${subject.slice(1)}`;

  // Same contradiction as the still builder above, same fix.
  const undress = requestKeepsGarment(req)
    ? `${subject} ${a.is} wearing what was asked for, and bare around it.${
        requestSetsViewpoint(req) ? "" : ` ${nudeAnatomy(c.gender)}`
      }`
    : requestIsNude(req)
      ? `${subject} ${a.is} already completely naked, bare skin everywhere throughout.${
          requestSetsViewpoint(req) ? "" : ` ${nudeAnatomy(c.gender)}`
        }`
      : `${subject} move${a.s} seductively for the camera.`;

  // Same reason as videoStillPrompt: no booru tags for this model.
  const action = normalizeRequest(req, subject) || fallbackAct(req, a, true);
  const isCloseUp = CLOSE_UP_RE.test(req);
  const bedSpread = requestHasBedSpread(req);

  return [
    framingFor(
      noun,
      poss,
      POSTURE_RE.test(req),
      !!req,
      c.name,
      isCloseUp,
      false,
      requestedShot(req),
      bedSpread,
    ),
    selfActSentence(action, a) || actionSentence(subject, action),
    climaxSentence(req, a),
    bedSpread
      ? `${Subject} ${a.is} reclining on ${poss} back on the bed against pillows, ${poss} legs raised and spread wide toward the camera, ${poss} knees apart, smooth natural movement while the front-facing camera holds the bed composition.`
      : "",
    `${undress[0].toUpperCase()}${undress.slice(1)}`,
    propClause(req, { anatomy: a, toy }),
    settingSentenceFor(opts.setting),
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
  const shot = requestedShot(req);

  const state = requestIsNude(req)
    ? `completely naked, bare skin.${requestSetsViewpoint(req) ? "" : ` ${nudeAnatomy(c.gender)}`}`
    : `wearing what ${subject} has on`;

  return [
    `Keep the exact same ${noun} from the photo — identical face, hair, skin tone and body. Do not change who ${subject} ${a.is}.`,
    `${subject[0].toUpperCase()}${subject.slice(1)} ${a.is} a ${c.age}-year-old ${c.ethnicity} ${noun}.`,
    `Now show ${object} ${req || "taking a seductive selfie, looking at the camera"}, ${state}.`,
    explicit,
    styleBackstory || "",
    `Photorealistic amateur selfie, ${
      shot === "face"
        ? "head and shoulders in frame, face filling the frame"
        : shot === "back"
          ? "seen from behind, looking back over the shoulder at the camera"
          : "full body in frame"
    }, natural indoor lighting, detailed skin, sharp focus.`,
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
// Faces came back haggard, then plastic. Said once, positively, on every
// render: real skin has pores; it is not lined, and it is not glossy.
// "Fresh youthful… clear skin… bright eyes" was asking for the glossy, lit
// face that came back. Real skin: pores, a little unevenness, no shine.
const FACE_CLAUSE =
  "Natural unretouched facial skin texture with visible fine pores.";
const FACE_WORDS = FACE_CLAUSE.split(/\s+/).length;

/**
 * Where the picture is taken. The user's own room when they gave her one;
 * otherwise her own place, read off her portrait — so a chat photo is taken
 * where her reel and her card were, not in a renderer's default bedroom.
 */
export type Setting = string | { text: string; whose: "user" | "her"; url?: string } | null | undefined;

export function settingText(setting: Setting): string {
  if (!setting) return "";
  return (typeof setting === "string" ? setting : setting.text).trim();
}

/** The uploaded room photograph, when the user supplied the setting. */
export function settingImageUrl(setting: Setting): string | null {
  if (!setting || typeof setting !== "object" || setting.whose !== "user") return null;
  const url = (setting.url ?? "").trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

/** The setting as the one sentence every prompt says it with. */
export function settingSentenceFor(setting: Setting): string {
  const d = settingText(setting);
  if (!d) return "";
  const whose = typeof setting === "object" && setting ? setting.whose : "user";
  return whose === "her"
    ? `The setting is her own place, exactly as in her photos: ${d}.`
    : `The setting is the user's own room, exactly as it is: ${d}.`;
}


// 340, up from 300: the adult/face clause added to every render pushed a
// plain nude builder prompt past 300, and the cap — which cuts from the end —
// took the back of the anatomy clause with it.
export const PROMPT_WORD_BUDGET = 300;

const REALISM_TAIL =
  "Unretouched natural skin with fine pores, matte finish and clean sharp detail. Candid raw photograph on a real camera.";

const STILL_CUE = "The pose is held completely still and the camera is locked off.";
const STILL_CUE_WORDS = STILL_CUE.split(/\s+/).length;

// What every clip prompt ends with, refined or built. The mirror of STILL_CUE,
// and it existed only in the fallback builder until now.
const MOTION_CUE =
  "Smooth natural lifelike motion throughout, her face and body consistent from the first frame to the last, the camera holding its position.";
const MOTION_CUE_WORDS = MOTION_CUE.split(/\s+/).length;

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
/**
 * Drop the fragments that point at a reference image, when there is none.
 *
 * The anatomy clause opens "exact same body proportions and breast size as the
 * reference image" and ends "matching the reference". On WAN and Kontext that
 * is the strongest instruction in it — her portrait IS the input. On a
 * text-to-image graph it points at nothing, and it does so in the part of the
 * prompt the encoder weighs most heavily: a dozen wasted tokens at the front,
 * and `reference image` left for the render to interpret however it likes.
 *
 * Fragment by fragment, the way stripNegations works, so a whole clause goes
 * rather than leaving a dangling "exact same body proportions and breast size".
 * Subtractive only — it never rewrites what is left.
 */
function withoutDeadReference(clause: string, noReference?: boolean): string {
  if (!noReference || !clause) return clause;
  // Phrase by phrase, not fragment by fragment. Dropping whole comma fragments
  // was the first attempt and it took the neighbours with it: "and bare around
  // it" and "Candid photograph" both sat in the same fragment as a reference
  // phrase and vanished with it. These remove the pointer and nothing else.
  const kept = clause
    .replace(/\bexact same [^,.]*?\bas the reference image\b/gi, "")
    .replace(/\b(?:identical|same) [^,.]*?\b(?:to|as) the reference image\b/gi, "")
    .replace(/\bmatching the reference\b/gi, "")
    .replace(/\b(?:as|to|from|in) the reference image\b/gi, "")
    .replace(/\bthe reference image\b/gi, "")
    .replace(/\s*,\s*(?:,\s*)+/g, ", ")
    // A phrase removed from after a full stop leaves ". ," behind.
    .replace(/([.!?])\s*,/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/^[\s,]+/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
  // If stripping would gut it, the original is the lesser problem — the same
  // floor stripNegations and stripUnrequestedProps both use.
  return kept.length >= 60 ? kept : clause;
}

/**
 * Put a clause third, after the framing and identity sentences.
 *
 * Shared by the two places that need it, because they disagreed: one inserted
 * the prop specification near the front and the other let the cap cut it off
 * the back, so on the path that used both, the clause was moved forward and
 * then deleted anyway.
 *
 * The refiner writes comma-separated fragments with no terminating full stop,
 * so the boundary is normalised before splitting — a bare space once ran its
 * last fragment into the spec ("…shot on Sony A7 IV 85mm lens The toy is
 * inserted into her").
 */
function withClauseUpFront(text: string, clause: string): string {
  if (!clause) return text;
  const tidy = text.replace(/[\s,;:]+$/, "");
  const stopped = /[.!?]$/.test(tidy) ? tidy : `${tidy}.`;
  const sentences = stopped.split(/(?<=\.)\s+/);
  const head = sentences.slice(0, 2).join(" ");
  const tail = sentences.slice(2).join(" ");
  return tail ? `${head} ${clause} ${tail}` : `${head} ${clause}`;
}

/**
 * Does the REQUEST compose the picture, or does her portrait?
 *
 * A prop, a named posture or a viewpoint all mean the user has said what the
 * picture looks like. Two things downstream need to know: the renderer, which
 * must stop letting the starting latent overrule the prompt, and the prompt
 * itself, which withholds her appearance on the assumption that a reference
 * photo is supplying it — an assumption that stops being true the moment the
 * reference is turned down far enough for the pose to obey.
 *
 * That gap is why a brunette came back blonde: at high denoise the reference
 * was no longer carrying her, and nothing in the prompt had been allowed to.
 *
 * One function so the two cannot disagree about which case they are in.
 *
 * Undressing counts too. Her portrait is clothed, so at the low denoise a plain
 * "send a nude" kept the portrait's outfit and came back dressed. Taking the
 * clothes off changes most of the picture, the same as a pose does.
 */
/**
 * Whether the request needs HIGH denoise (pose / prop / viewpoint change).
 *
 * CRITICAL: do NOT include requestIsNude() here.
 * "send a nude" used to flip COMFY_DENOISE_POSED (~0.9), which wiped the
 * site portrait and produced a different woman in chat than on the homepage.
 * High denoise is only for props, stated postures, or camera angles.
 * Plain nude / undress uses the lower COMFY_DENOISE so face/hair/skin stay hers.
 */
export function requestComposesShot(req: string): boolean {
  const text = (req ?? "").trim();
  if (!text) return false;
  return (
    hasProp(text) ||
    STATED_POSTURE_RE.test(text) ||
    requestSetsViewpoint(text) ||
    PARTIAL_UNDRESS_RE.test(text) ||
    // An act on her own body is a composition too. At the low "plain nude"
    // denoise her portrait's framing wins and the act never appears — "sucking
    // on your tit" came back as a plain frontal.
    isSelfAct(text)
  );
}

export function finishMediaPrompt(
  base: string,
  req: string,
  opts: {
    anatomy?: Anatomy;
    appendProps?: boolean;
    /**
     * Append the anatomy clause verbatim instead of asking the refiner to write
     * it. Set only for a REFINED prompt — the builders below compose their own
     * clause in, and setting it for one of those would say it all twice.
     */
    appendAnatomy?: boolean;
    /**
     * Append her physical build, because no picture of her reaches the renderer.
     *
     * Set only for a text-to-image graph. Everywhere else a portrait of her IS
     * the input, and stating a build in words would fight the photo — which is
     * the reason every builder here leaves it out in the first place.
     */
    appendAppearance?: boolean;
    /**
     * Who she is, for the same reason as appendAppearance: on a text-to-image
     * graph nothing else says. Her age and ethnicity are on the companion row
     * and were being discarded — the prompt opened "Photograph of a woman
     * indoors" for every companion in the app, so an Asian companion rendered
     * white and a stranger every time.
     */
    appearance?: {
      age?: number | null;
      ethnicity?: string | null;
      /** Her hair, eyes, skin and build in words (look.server.ts). FaceID carries only the face. */
      look?: string | null;
    };
    still?: boolean;
    /** The toy from the chest she uses in this picture; its spec replaces the generic one. */
    toy?: Toy | null;
    /** The user's own room, or her own place from her portrait: the setting of the picture. */
    setting?: Setting;
    /** This prompt is for a CLIP. Appends the motion tail, as still appends the still cue. */
    moving?: boolean;
    /**
     * Keep the reference identity clause even when the request also needs a
     * written appearance description (posed/prop shots). Those are the shots
     * where the renderer changes the most of the source frame, so dropping the
     * identity reminder there causes the face to drift.
     */
    lockIdentity?: boolean;
  } = {},
): string {
  // Applied to the WHOLE prompt, not just the appended clause: the builders
  // compose the anatomy clause in themselves, and the refiner opens every
  // prompt with "exact same woman as the reference image". On a graph with no
  // reference, all of it points at nothing.
  // appendAppearance means "describe what the reference does not carry". It
  // does not mean the reference has stopped being the subject. Keep the
  // reference language whenever the caller explicitly asks for identity lock;
  // only pure text-to-image callers should have it stripped.
  let out = withoutDeadReference(
    (base ?? "").trim(),
    Boolean(opts.appendAppearance) && opts.lockIdentity !== true,
  );
  const request = (req ?? "").trim();
  const a = opts.anatomy ?? anatomyOf("female");
  const ownsInk = /\b(?:tattoo\w*|inked|body art)\b/i.test(opts.appearance?.look ?? "");
  if (!ownsInk) {
    // Refiners occasionally invent "her existing tattoos" even when the
    // portrait description explicitly has none. Remove each comma-delimited
    // tattoo fragment before it reaches the positive diffusion prompt.
    out = out
      .split(/(,|\.)\s*/)
      .reduce<string[]>((parts, part, index, all) => {
        if (part === "," || part === ".") return parts;
        if (/\b(?:tattoo\w*|inked|dark ink|body art)\b/i.test(part)) return parts;
        const separator = index > 0 ? all[index - 1] : "";
        parts.push(`${separator && parts.length ? separator + " " : ""}${part.trim()}`);
        return parts;
      }, [])
      .join("")
      .trim();
  }

  // The anatomy clause, guaranteed.
  //
  // It used to be a bullet in the refiner's system prompt ending "Write it in
  // exactly those words" — a 143-word block, inside an instruction to produce a
  // 120-160 word prompt in total, alongside a dozen other bullets. The model
  // could not satisfy both, so it compressed, and WHICH half it dropped varied
  // per run. That is a lottery sitting directly on the body description: two
  // identical requests, two different bodies, no seed involved.
  //
  // Appended here it competes with nothing. The same argument the prop spec was
  // moved out for, and the same mechanics — the refiner is told the clause is
  // appended separately so it spends its words on the act and the setting.
  //
  // Withheld when the user set their own viewpoint, for the reason
  // requestSetsViewpoint exists: this clause describes the front of the body.
  // Withheld for a mouth act too. The clause describes a whole front-facing
  // body — nipples "pointing straight forward", a closed pussy, a round ass —
  // and a mouth act is a close-up on her face and chest in which the breast
  // is lifted toward her mouth. Two hundred words of the wrong pose outvoted
  // the one sentence of the right one. Nudity is still stated by NUDE_FORCE.
  if (
    opts.appendAnatomy &&
    requestIsNude(request) &&
    !requestSetsViewpoint(request) &&
    !isMouthAct(request)
  ) {
    const clause = nudeAnatomy(a.kind);
    if (clause)
      out = `${out.replace(/[\s,;:]+$/, "")}${/[.!?]$/.test(out.trim()) ? "" : "."} ${clause}`;
  }

  // The default build, and why it names a midsection.
  //
  // "slim" alone was not enough, twice over. It sat at the end of the prompt
  // where the encoder barely weighs it (see below), and it was competing with
  // the only other shape word in the whole prompt: `plump`, which arrives from
  // the vulva clause. CLIP does not scope an adjective tightly to its noun, and
  // the anatomy clause describes a chest and a groin and nothing at all in
  // between — no waist, no stomach, no torso — so `plump` was the strongest
  // signal the midsection had to go on.
  //
  // Naming the waist and stomach gives that gap something to render instead of
  // leaving it to the checkpoint. Physique only, the same class of attribute as
  // hair colour and skin tone; COMFY_BUILD overrides the wording.
  // "slim slender build, narrow waist, flat toned stomach" was the first
  // version and it is part of why a render came back reading as a child: every
  // term in it is a smallness term, and nothing in it said adult. Slim is still
  // what was asked for, so the shape words stay — with a grown woman's frame
  // named alongside them, which is the part that was missing.
  // Natural, not slim: "slim ... narrow waist, flat toned stomach" plus a
  // negative that suppressed every curve gave everyone the same thin body.
  const DEFAULT_BUILD =
    a.kind === "male" || a.kind === "trans-male"
      ? "natural athletic adult man's build with a broad chest and shoulders"
      : "natural curvy woman's body, full hips, thick thighs, natural waist, soft natural stomach";

  // Her build, when nothing else carries it.
  //
  // Deliberately one short clause and nothing more. The reference-image path is
  // still the right way to carry a likeness, and this is the stopgap for a graph
  // that has none: enough to stop the checkpoint choosing a body on its own,
  // little enough that it does not fight a portrait once one is wired in.
  //
  // COMFY_BUILD sets the wording. It is a plain physical attribute, in the same
  // class as hair colour and skin tone — the codebase groups them in one
  // sentence — so it belongs to whoever runs the app rather than being baked in.
  // She is an adult, said out loud, on every path.
  //
  // A tester was sent a render that read as a child, and the prompt had never
  // once said otherwise: her age reached photoPrompt and was dropped, the
  // negative prompt had no age terms in it at all, and the only thing in this
  // app that thinks about age screens the USER'S message rather than the
  // picture that comes back.
  //
  // Unconditional — not gated on appendAppearance, because a path that carries
  // her portrait still needs to say it — and placed immediately after the
  // framing sentence, which is the earliest position that does not cost the
  // composition. The framing sentence stays first for the reason framingFor
  // exists: it decides what the picture IS, and demoting it is how photos come
  // back cropped.
  //
  // The age is floored at a legal adult's regardless of what the row says. A
  // row is data and data can be wrong; no value of it should ever put a number
  // below this into the prompt for an explicit picture.
  const ADULT_FLOOR = 18;
  const statedAge = Math.max(ADULT_FLOOR, Math.round(opts.appearance?.age ?? ADULT_FLOOR));

  // Everything about her that the renderer cannot see for itself. The adult
  // clause is always here; the rest only when no picture of her arrives.
  // Faces came back haggard — lined, chapped, tired. The realism wording and
  // the "flawless/perfect/youthful" negatives had between them pushed the
  // FaceDetailer pass toward age. Said positively here, on every render.
  const describes = [
    // "smooth clear skin" and "soft glow" swung the other way — faces came
    // back plastic with razor-edged brows. Real skin has pores; it is just
    // not lined. Matte, fine pores, soft natural brows.
    `adult ${statedAge}-year-old ${a.noun}, fully grown adult body`,
  ];
  // Hair, eyes, skin, build — on every render that has them. The reference
  // photo carries her face and nothing else; "identical hair" in the prompt
  // was a promise the graph could not keep, and a blue-haired companion came
  // back brunette.
  const look = (opts.appearance?.look ?? "").trim();
  if (look) describes.push(look);
  if (opts.appendAppearance) {
    const ethnicity = (opts.appearance?.ethnicity ?? "").trim();
    if (ethnicity) describes.push(`${ethnicity} ${a.noun}`);
  }
  // Her build on EVERY render, portrait or not. With the FaceID graph her
  // portrait supplies her face and nothing below it, so the body came from the
  // checkpoint's default - thin and airbrushed - and users called the models
  // "too skinny, like plastic". COMFY_BUILD overrides the wording.
  // The house default — "curvy, full hips, thick thighs" — went out on top of
  // her own build whenever the look phrase carried one, and a slim companion
  // came back looking, in a tester's words, like she had had surgery. Her own
  // build, when the look has it; the default only when nothing does.
  const lookHasBuild =
    /\b(?:build|figure|bust|curvy|slim|slender|petite|athletic|hourglass|plus[- ]size|thick|voluptuous|toned|lean|chubby|skinny|busty|frame|physique)\b/i.test(look);
  const build = (process.env.COMFY_BUILD ?? (lookHasBuild ? "" : DEFAULT_BUILD)).trim();
  if (build) describes.push(build);
  {
    const clause = describes.join(", ");
    const [first, ...rest] = out.split(/(?<=\.)\s+/);
    const sentence = `${clause[0].toUpperCase()}${clause.slice(1)}.`;
    out = rest.length ? `${first} ${sentence} ${rest.join(" ")}` : `${sentence} ${out}`;
  }


  // A toy the user asked to have inserted, described as being held, is the
  // single failure this whole path exists to prevent — and "holding a dildo" in
  // front of her is one short step from the vertical crotch-to-chin cylinder a
  // user was actually sent. Rewritten positively: where it is, and what her
  // hand is doing there.
  // A self-act that needs a hand gets the same treatment as a toy: the
  // reclining builder scene parks both hands on her thighs, and a hand that is
  // on her thigh cannot also be lifting her breast — a render with three hands
  // is how that contradiction resolves.
  if (selfActUsesHands(request) && !propIsInserted(request)) {
    out = out.replace(
      /\b(?:her|his|their)\s+hands\s+(?:resting|rest|placed|lying|laid|folded)?\s*(?:on|at|by|against|in)\s+(?:her|his|their)\s+(?:thighs|sides|hips|lap|stomach|belly|chest|waist)\b/gi,
      `${a.poss} free hand relaxed`,
    );
  }

  if (propIsInserted(request)) {
    const poss = a.poss;
    // Both hands cannot be on her thighs while one of them is on the toy.
    //
    // The reclining builder scene ends "her hands resting on her thighs", the
    // inserted clause puts a hand on the toy, and a render went out with three
    // of them. Neither sentence is wrong on its own, which is why this survived
    // every pass over each of them separately — it exists only in the join.
    //
    // Rewritten to one hand with no location, so it agrees with the toy clause
    // instead of competing with it. Runs on the refined prompt too, which can
    // write the same sentence.
    out = out.replace(
      /\b(?:her|his|their)\s+hands\s+(?:resting|rest|placed|lying|laid|folded)?\s*(?:on|at|by|against|in)\s+(?:her|his|their)\s+(?:thighs|sides|hips|lap|stomach|belly|chest|waist)\b/gi,
      `${poss} other hand relaxed`,
    );
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
  // The word cap cuts from the END, and everything appended here was at the end.
  //
  // Measured on the dildo request: the builder produced 370 words, the cap took
  // it to 300, and the two clauses it removed were the hand count and the hand
  // description. That is the whole of the third hand — the sentences that said
  // how many hands there are never reached the renderer. It also means every
  // previous round of work on the prop spec was partly landing in the bin,
  // which is why detailed, correct specifications kept producing nothing.
  //
  // So the prop specification is lifted out before the cut and put back after
  // it, at the front where the encoder weighs it hardest. The scene text loses
  // the words instead, which is what a budget should spend first.
  const propText = propClause(request, { anatomy: a, toy: opts.toy });
  // Two ways the spec can be needed: the builder already wrote it into its own
  // text, or the refiner replaced the builder wholesale and it has to be added.
  // Both end up in the same place — third, after the cut.
  const alreadyIn = Boolean(propText) && out.includes(propText);
  const wantProp = Boolean(propText) && (alreadyIn || Boolean(opts.appendProps));
  const anatomyText = nudeAnatomy(a.kind);
  // Preserve the builder's complete anatomy block for a plain nude. For an
  // action or prop request it would consume most of the encoder budget and
  // evict the requested action itself, so it remains part of the normal body
  // text and is trimmed only if necessary.
  const alreadyAnatomy =
    Boolean(anatomyText) &&
    out.includes(anatomyText) &&
    !propText &&
    !selfActUsesHands(request);
  const reserve =
    (wantProp ? propText.trim().split(/\s+/).length : 0) +
    (alreadyAnatomy ? anatomyText.trim().split(/\s+/).length : 0);
  const cueWords = opts.still ? STILL_CUE_WORDS : opts.moving ? MOTION_CUE_WORDS : 0;

  let body = out;
  if (alreadyIn) {
    body = out
      .replace(propText, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.])/g, "$1")
      .replace(/\.\s*\./g, ".")
      .trim();
  }
  if (alreadyAnatomy) {
    body = body
      .replace(anatomyText, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.])/g, "$1")
      .replace(/\.\s*\./g, ".")
      .trim();
  }

  // Nude must mean nude: portrait start frames are clothed, so say it hard.
  const forceNude =
    requestIsNude(request) &&
    !requestKeepsGarment(request) &&
    !/completely nude|fully undressed/i.test(body);
  // Lock identity to the homepage portrait whenever that photo is the start frame.
  // appendAppearance is only set for pure text-to-image (no reference) — there
  // IDENTITY_LOCK would fight a described build. On img2img/FaceID, this line is
  // what keeps Aria in chat the same person as Aria on the site.
  const lockIdentity =
    (opts.lockIdentity === true || !opts.appendAppearance) &&
    !/CRITICAL identity lock|same person as the reference photo/i.test(body);
  // Both are appended after the cut, so their words are reserved before it;
  // otherwise they pushed a capped prompt 57 words past the budget.
  const nudeForce = nudeForceFor(opts.anatomy);
  const settingText = settingSentenceFor(opts.setting);
  const wantSetting = Boolean(settingText) && !out.includes(settingText);
  const bedSpread = requestHasBedSpread(request);
  const bedSpreadClause =
    `Front-facing reclining bed photograph from the foot of the bed at a slightly elevated eye-level angle, ${a.poss} face and front of ${a.poss} body visible from head to knees, ${a.subject} lying on ${a.poss} back against pillows, both legs raised and spread wide toward the camera, knees apart, bed and pillows filling the background`;
  // Put an unambiguous requested rear camera/pose first, where CLIP gives it
  // more weight than any generic front-facing composition in a refined prompt.
  const rearView = requestSetsViewpoint(request);
  const rearGroin = rearView && mentionsPart(request, "ass") && mentionsPart(request, "vulva");
  const rearClause = rearView
    ? rearGroin
      ? "Low rear-view photograph from directly behind, kneeling on all fours with knees wide apart, back and hips toward the camera, buttocks above and vulva clearly visible between her open thighs beneath them, head turned over her shoulder."
      : "Rear-view photograph from behind, her back and hips toward the camera, bent forward with legs apart, head turned over her shoulder so her face remains visible."
    : "";
  const tailWords =
    (wantSetting ? settingText.split(/\s+/).length : 0) +
    (forceNude ? nudeForce.split(/\s+/).length : 0) +
    (lockIdentity ? IDENTITY_LOCK.split(/\s+/).length : 0) +
    FACE_WORDS +
    (bedSpread ? bedSpreadClause.split(/\s+/).length : 0) +
    (rearView ? rearClause.split(/\s+/).length : 0);

  // Sentence normalization during the final joins can split punctuation-bound
  // tokens differently from this reservation count. Keep a small measured
  // safety margin so the final prompt, not merely its pre-join body, stays
  // inside the encoder budget.
  const joinSlack = 16;
  body = capPromptWords(body, PROMPT_WORD_BUDGET - reserve - cueWords - tailWords - joinSlack);
  let capped = wantProp ? withClauseUpFront(body, propText) : body;
  if (alreadyAnatomy) capped = withClauseUpFront(capped, anatomyText);
  if (rearView) capped = `${rearClause} ${capped}`;
  if (bedSpread) capped = `${bedSpreadClause}. ${capped}`;
  // Her face, after the cut and after the prop spec: reserved above, so it
  // never costs the scene a word, and never pushes the spec down the prompt.
  capped = `${capped.replace(/[\s,;:]+$/, "")}${/[.!?]$/.test(capped.trim()) ? "" : "."} ${FACE_CLAUSE}`;
  if (wantSetting) {
    capped = `${capped.replace(/[\s,;:]+$/, "")}${/[.!?]$/.test(capped.trim()) ? "" : "."} ${settingText}`;
  }
  if (forceNude) {
    capped = `${capped.replace(/[\s,;:]+$/, "")}${/[.!?]$/.test(capped.trim()) ? "" : "."} ${nudeForce}`;
  }
  if (lockIdentity) {
    capped = `${capped.replace(/[\s,;:]+$/, "")}${/[.!?]$/.test(capped.trim()) ? "" : "."} ${IDENTITY_LOCK}`;
  }

  // Specific phrases, not the bare word "still" — the prop clause contains
  // "only the flared base still visible", which matched and silently suppressed
  // the cue on the one request that most needs it.
  if (opts.still && !/held pose|locked off|held completely still/i.test(capped)) {
    return `${capped.replace(/[\s,;:]+$/, "")}${/[.!?]$/.test(capped.trim()) ? "" : "."} ${STILL_CUE}`;
  }
  // The mirror of the still cue, and it was missing.
  //
  // The fallback builder ends every clip prompt with this. A successful refine
  // replaces the builder wholesale, and finishMediaPrompt re-appended the prop
  // spec and the anatomy clause but never the motion tail — so in production,
  // with the refiner working, a clip prompt carried no motion instruction at
  // all, while the negative prompt simultaneously forbade it from holding
  // still. The render resolves that contradiction as churn, which is the
  // morphing users describe.
  if (opts.moving && !/lifelike motion|camera holds|smooth natural motion/i.test(capped)) {
    return `${capped.replace(/[\s,;:]+$/, "")}${/[.!?]$/.test(capped.trim()) ? "" : "."} ${MOTION_CUE}`;
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
const SELFIE_OBJECT = `${PHOTO_NOUNS}|nude|nudes|naked|topless|body|tits|boobs|breasts|cleavage|pussy|vagina|ass|butt|booty|dick|cock|penis|lingerie|underwear|bra|panties|thong|bikini`;

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
  // A reaction to the one she just sent is not a request for another: "that's
  // a great pic", "nice photo", "love that selfie" each cost a user 8 credits.
  const reaction =
    /^(?:that'?s|thats|that is|this is|what a|such a|wow|omg|lol|thanks|thank you|ty|i love|i loved|love|loved|nice|great|good|beautiful|amazing|gorgeous|stunning|cute|hot|sexy|damn|mmm+|perfect|awesome|fire|yum+|wow+)\b/.test(
      s.trim(),
    );
  if (
    words.length <= 5 &&
    !reaction &&
    /\b(?:pic|pics|pix|picture|photo|portrait|potrait|portait|protrait|headshot|backshot|snapshot|selfie|selfy|nude|nudes)\b/.test(
      s,
    )
  )
    return true;

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
