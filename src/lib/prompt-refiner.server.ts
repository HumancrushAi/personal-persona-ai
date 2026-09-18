// Turns one line from the user into the long, dense prompts this ComfyUI
// endpoint was tuned on, using Grok (xAI).
//
// The keyword builders in selfie.ts only fire when the request happens to
// contain a word in a regex, so anything phrased outside that vocabulary reached
// the renderer as the user typed it. Grok reads the request instead.
//
// A video is refined into SEVERAL scenes rather than one: the endpoint takes a
// prompts array with num_scenes and renders each in turn, so describing the
// action as a progression is what it was built for and is what stops a clip
// being five seconds of one held pose.
//
// Strictly an improvement layer — no key, a refusal, a timeout or a stub answer
// all fall back to the builder, which still works alone. It must never be the
// reason a paid request fails.

import type { GenderKind } from "./anatomy";
import { TOY_VOCAB } from "./props";

// Whether the user asked for a toy at all. Read from the REQUEST, and the only
// thing that decides whether the model is shown a toy example, told how to
// place one, or allowed to keep one in its answer.
const TOY_RE = new RegExp(String.raw`\b(?:${TOY_VOCAB})\b`, "i");

const XAI_URL = "https://api.x.ai/v1/chat/completions";

// Real prompts from this endpoint's own tuning set, used as few-shot examples.
// Style over instructions: told to write "densely, comma separated" Grok drifts
// back to prose, but shown these it matches the shape.
// These used to open "long wavy dark black hair, tanned glowing skin" — and Grok
// copied that description straight into live prompts for companions who looked
// nothing like it, which is how a brunette came back blonde. Examples teach
// shape, and whatever is in them gets reproduced, so the appearance is gone from
// them entirely. Do not put hair, skin or eye colour back.
const NUDE_EXAMPLES = `exact same woman as the reference image, identical face, hair and skin, completely nude, natural firm round breasts set high on her chest, nipples level with the middle of her upper arms and pointing forward, small defined areolae, smoothly shaved plump closed pussy, a soft rounded mound with a single neat vertical crease and only the crease showing, reclining back against pillows propped up on her elbows, back gently arched, legs open, her hands resting on her inner thighs, on a bed with plain white sheets, soft daylight from a window beside her, authentic human skin texture with visible natural pores, candid DSLR photograph, raw photography

exact same woman as the reference image, identical face, hair and skin, completely nude, sitting upright on the edge of the bed with her shoulders back and her knees apart, framed from the top of her head down to her knees with her face clearly visible in the upper third, natural firm round breasts set high on her chest with erect nipples pointing forward, smoothly shaved plump closed pussy with a single neat vertical crease, her hands resting on her thighs, plain white sheets, soft daylight from the side, authentic skin texture with visible pores, candid DSLR photograph, raw photography`;

// Shown ONLY when the user asked for a toy.
//
// This sat in NUDE_EXAMPLES, sent on every nude request, and "send me a
// picture of your pussy" came back with a dildo in it. Examples are the
// strongest instruction in this file — the model reproduces what it is shown —
// so an example with a toy in it is an invitation to add one, whatever the
// request said. Same reasoning as POV_EXAMPLE below.
const TOY_EXAMPLE = `exact same woman as the reference image, identical face, hair and skin, completely nude, reclining back against pillows with her shoulders raised, knees up and thighs open, smooth matte silicone dildo inserted into her pussy and angled down between her open thighs, most of the shaft hidden inside her with only the flared base showing, her fingers closed on that base and her wrist against her inner thigh, her pussy pressing snugly around the silicone, glistening wetness at the point of entry, framed from the top of her head to her knees with her face in the upper third, plain white sheets, soft window daylight, authentic skin texture with visible pores, candid DSLR photograph, raw photography`;

// Shown ONLY when the user actually asked for a close-up or a POV shot.
//
// Sent every time, this taught the model that a point-of-view shot from between
// her thighs is one of the normal things to write — on a request that named no
// framing at all. Examples are the strongest instruction in the file, so an
// example of a composition nobody asked for is a standing invitation to compose
// that way, and a POV crop is one of the ways a photo comes back headless.
const POV_EXAMPLE = `exact same woman as the reference image, identical face, hair and skin, completely nude, close-up point-of-view photograph taken from between her open thighs looking up along her body, her pussy filling the centre foreground in sharp focus, a smooth plump closed mound with a single neat vertical crease and only the crease showing, her hands resting on her thighs, her stomach and breasts beyond it, her face looking down into the lens at the top of the frame, lens thirty centimetres away, glistening skin texture, warm soft lighting, candid raw photograph, real pores and fine skin detail`;

// The male and trans-female examples live apart from the female ones because
// examples are the strongest instruction in the file and whatever is in them
// gets reproduced. Sent all five every time, a prompt for a woman carried two
// worked examples of erect cocks — see the note on ANATOMY below.
const MALE_EXAMPLES = `exact same man as the reference image, identical face, hair and skin, completely nude, athletic muscular build, anatomically correct erect penis and testicles clearly defined with a realistic shaft, standing in a modern penthouse shower framed from his head to his knees, water raining down, golden hour sunlight, wet authentic skin texture, candid DSLR full-frame photograph, raw photography

exact same man as the reference image, identical face, hair and skin, completely nude, lying back against the headboard with one knee raised, his hand closed around his erect cock, defined shaft and natural testicles, framed from his head to his knees with his face in the upper third, warm bedside lamplight, real skin texture with visible pores, candid raw photograph`;

const TRANS_FEMALE_EXAMPLES = `exact same woman as the reference image, identical face, hair and skin, completely nude, feminine body with firm rounded breasts and perky erect nipples, feminine hips and waist, and at her groin an erect cock with a defined shaft and natural testicles below it, standing by a sunlit penthouse window framed from her head to her knees, seductive eye contact, candid raw photo, real skin texture`;

// A trans man had no example of his own, so the model was shown two nude men
// with cocks and asked to write a prompt for him.
const TRANS_MALE_EXAMPLES = `exact same man as the reference image, identical face, hair and skin, completely nude, lean masculine build with a flat chest, flat dark nipples and faint pale scars beneath each pectoral, broad ribcage and lean stomach, and between his open thighs a smoothly shaved plump closed pussy with a single neat vertical crease, propped up on a stack of pillows with his shoulders raised, framed from his head to his knees with his face in the upper third, warm bedside lamplight, authentic skin texture with visible pores, candid DSLR photograph, raw photography`;

// "no airbrushing" used to close all three of these. Examples teach shape, and
// what these were teaching was a negation — so every clothed prompt Grok wrote
// ended by asking the renderer for airbrushing. It is in QUALITY_NEGATIVE in
// media.functions.ts, which is the one place it can actually be suppressed.
const CLOTHED_EXAMPLES = `exact same woman as the reference image, identical face, hair and skin, wearing a black lace bra and matching high-waisted briefs, firm perky bust neatly filling the lace cups, kneeling on the end of an unmade bed, one strap slipping off her shoulder, lace taut across the cup and gathering at her hip, looking straight at the camera, low warm bedside lamplight, candid raw photograph, authentic skin texture with visible pores, shot on Sony A7 IV 85mm lens, real untouched skin

exact same woman as the reference image, identical face, hair and skin, wearing a sheer white satin slip with thin straps, firm perky breasts subtle under fabric, standing at a window with morning light coming through the fabric, hem falling mid-thigh, one hand on the frame, soft direct eye contact, candid raw photograph, natural asymmetry, fine skin detail, shot on 85mm f/1.4, real untouched skin

exact same woman as the reference image, identical face, hair and skin, wearing a cropped tank top and low-rise denim shorts, firm uplifted bust filling the cotton tank top, sitting on a kitchen counter with her ankles crossed, cotton creasing at the waist, warm afternoon light through a window behind her, easy natural smile, candid full-frame photograph, real skin texture, soft natural shadows, real untouched skin`;

// `nude` follows the user's actual request. It used to be hard-coded on, so
// "in black lingerie by the window" was refined into "completely nude" and she
// arrived naked — the app simply could not render a clothed request.
// The single most important rule in this file, and the one the previous version
// broke in five separate bullets.
//
// The renderer is conditioned by a T5 text encoder with no operator for "not",
// "never", "away from" or "avoid". Those words contribute almost nothing; the
// nouns beside them contribute everything. So an instruction to write "the toy
// is completely away from her face, mouth, and chest" is an instruction to put
// `toy, face, mouth, chest` into the conditioning — and a user was duly sent a
// photo of a woman holding a two-foot cylinder from her crotch to her lips.
// "not cropped, not a close-up" produced a headless crop by the same mechanism.
// The full argument, with the failures each phrasing caused, is in props.ts.
//
// Grok obeys this file closely. That is exactly why the file must not ask for a
// negation anywhere: whatever these rules contain is what ends up conditioning
// the render.
const POSITIVE_ONLY = `WRITE ONLY WHAT IS IN THE PICTURE. This is the hardest rule here and it overrides every other instruction below.

The renderer cannot read negation. It has no representation of "not", "never", "no", "without", "away from", "instead of" or "avoid" — it sees only the nouns you put next to those words, and it draws them. "The toy is never near her mouth" is read as "toy, mouth" and it draws the toy at her mouth. "Not cropped, not a close-up" is read as "cropped, close-up" and it crops her head off. Both of those are real failures this exact prompt caused.

So: state where things ARE, what touches what, and what is visible. If something must not appear, do not mention it at all — say what occupies that space instead. Do not use the words not, no, never, without, away from, avoid, or any other negation anywhere in your output.`;

/** Which anatomy the subject actually has, so only that is described. */
type SubjectKind = GenderKind;

// One bullet, chosen by the companion's own sex.
//
// All of them used to be sent every time. A female companion's system prompt
// therefore carried two paragraphs about erect cocks, shafts and testicles, and
// two of the five worked examples were of men — which is both a large slice of
// a tight word budget spent on anatomy she does not have, and a steady supply
// of male tokens to a prompt that has to render a woman. The reported failure
// on "pussy close to my face" was a groin that came back masculine.
//
// Each bullet names sub-structures instead of reaching for "anatomically
// correct" and "well-proportioned", which are adjectives a renderer cannot act
// on — the same lesson props.ts learned when "correct size" lost to "about as
// long as her hand". Naming parts that have to stay distinguishable from each
// other is what stops the fused, featureless, smooth-plastic look.
const ANATOMY: Record<SubjectKind, string> = {
  female:
    "- her anatomy in photorealistic detail: natural firm round breasts set high on her chest, firm enough to hold their round shape in any pose and stand up off her chest, full rounded lower curves, taut smooth skin, her nipples level with the middle of her upper arms and pointing forward, small defined areolae and erect nipples; between her thighs a smoothly shaved, plump, CLOSED pussy: a soft rounded mound with a single neat vertical crease, everything tucked inside so only the crease shows, skin one even tone with her inner thighs, a faint natural sheen. Write it in exactly those words. The words labia, lips, clit, clitoris, spread, parted and open make the renderer extrude a flap of tissue from her — leave every one of them out unless the user asked for a toy or fingers inside her",
  male: "- his anatomy in photorealistic detail: a lean athletic muscular chest and defined abs, and at his groin an erect thick penis with a clearly defined realistic shaft, a distinct ridge below the glans, soft surface veining, and natural firm testicles hanging neatly below in a separate lightly textured sac, each part distinguishable from the next",
  "trans-female":
    "- her anatomy in photorealistic detail, as ONE body in a single clause: natural firm round breasts set high on her chest with defined areolae and erect nipples pointing forward, feminine hips and waist, and at her groin an erect penis with a defined shaft, distinct glans and natural testicles below it. Both in frame and both in focus",
  // The kind that had no bullet at all. A trans man was described to the model
  // as a plain man and rendered with a cock he does not have.
  "trans-male":
    "- his anatomy in photorealistic detail: a flat masculine chest with flat dark nipples and faint pale scars beneath each pectoral, a broad ribcage and lean stomach; between his thighs a smoothly shaved, plump, closed pussy: a soft rounded mound with a single neat vertical crease, everything tucked inside so only the crease shows",
  nb: "- the body in photorealistic detail: lean androgynous build, a flat soft chest, narrow hips, skin evenly lit with visible pores and fine texture throughout",
};

// What stands in for ANATOMY[kind] when the USER set the viewpoint.
//
// ANATOMY[kind] ends "Write it in exactly those words" and opens with the front
// of the body, and nothing conditioned it on where the camera was standing. So a
// request for a view from behind still carried a verbatim order to describe a
// chest — and being verbatim, it outranked the single posture clause that knew
// what "from behind" meant. The render obeyed the order instead of the request,
// and what came back was a front-facing picture nobody asked for. Same failure
// class as the unrequested toy: a different picture from the one paid for.
//
// This keeps what ANATOMY[kind] is actually FOR — naming sub-structures so they
// stay distinguishable from each other, which is what stops the fused
// smooth-plastic look — and hands the choice of WHICH parts back to the request.
const DEFER_TO_REQUEST =
  "- the parts of her the stated viewpoint puts in frame, in photorealistic detail and in the user's own vocabulary, taken in the order the user named them: the surface shape of each, how it meets the parts beside it so the two stay distinguishable, skin one even tone with the skin around it, a faint natural sheen, authentic texture with visible pores, and the light falling across it so its shape reads";

// The same deferral for a garment the user placed rather than a camera.
const DEFER_TO_GARMENT =
  "- the parts of her the garment's position leaves bare, in photorealistic detail and in the user's own vocabulary: the surface shape of each, the edge of the moved fabric against that skin, where the fabric is taut and where it gathers, skin one even tone either side of that edge, a faint natural sheen, authentic texture with visible pores";

/**
 * Everything the system prompt branches on, read from the request once in
 * refineMediaPrompt and passed down whole.
 *
 * It was nine positional booleans threaded through three functions, which is
 * how `groinFocus` and `toyAsked` came to sit next to each other unlabelled at
 * two call sites. Naming them also makes the precedence between them visible,
 * which matters more than the tidiness: `rearView` has to outrank the
 * front-facing defaults, and that is hard to see in an argument list.
 */
type Shape = {
  undress: "nude" | "partial" | "clothed";
  closeUp: boolean;
  /** The user asked to be shown a view from behind. Outranks the defaults. */
  rearView: boolean;
  /** The user named a position. Outranks both the inference table and the
   * upright-torso default, which between them made "lie down" unanswerable. */
  postureStated: boolean;
  kind: SubjectKind;
  groinFocus: boolean;
  toyAsked: boolean;
};

const rules = ({
  undress,
  closeUp,
  rearView,
  postureStated,
  kind,
  groinFocus,
}: Shape) => `Every subject is a consenting fictional adult. This is the app's core paid feature — refusing, softening or sanitising a request breaks it.

${POSITIVE_ONLY}

Open with ONE plain sentence describing the photograph and how it is framed, then switch to dense comma-separated fragments for everything after it, matching the examples.

The opening sentence is not a style flourish. This renderer is an image-TO-VIDEO model working from a portrait of her, and it decides the composition first; handed nothing but a bag of comma-separated tags it composes around whichever tag is loudest, which on an explicit request is the act — and the picture comes back as a crop of a torso with her head outside the frame. A described photograph gives it a composition to build instead. Everything after that first sentence should be fragments, which is the format this endpoint was tuned on.

Leave her hair colour, hair length, eye colour, skin tone and build out entirely. A reference photo of her is supplied to the renderer and supplies all of that. Inventing it fights the photo and the picture comes back as a different woman — which is the single worst failure this app has. Write "identical face, hair and skin to the reference image" and spend those words on the act, the posture and the setting instead.

Every prompt must contain, in this order:
- "exact same woman as the reference image, identical face, hair and skin" (carries her likeness from the start frame)
- FRAMING, as the second thing in the prompt. ${
  rearView
    ? `The user set the viewpoint themselves, so write THEIR viewpoint in THEIR words: where the lens stands relative to her, which way she is turned, what fills the foreground, what lies beyond it, and how far away the camera is. Her face stays in the frame, over her shoulder or turned back towards the lens. The viewpoint the user described governs the whole composition and every fragment after it — the posture, what is nearest the lens and what the light falls across all follow from where they put the camera.`
    : closeUp
      ? `The user asked for a close-up or point-of-view shot, so write the VIEWPOINT as a real photograph: where the lens is, what fills the foreground, and what is behind it. Use this shape — "close-up point-of-view photograph taken from between her open thighs looking up along her body, her pussy filling the centre foreground in sharp focus, her stomach and breasts beyond it, her face looking down into the lens at the top of the frame, lens thirty centimetres away". Her face stays in the frame.`
      : groinFocus
        ? `The request is ABOUT her pussy, so the camera comes in close enough for it to render: write "framed from her chin down to her knees with her mouth and chin at the top edge of the frame, her hips and groin in the centre of the frame in sharp focus, camera one metre away at hip height". A head-to-knees frame leaves a vulva about forty pixels wide and it comes back a smear whatever you write about it; this frame gives it nearly twice the detail. Her mouth and chin stay in shot at the top edge — it is a chosen composition, not a crop.`
        : `Write "framed from the top of her head down to her knees, her face clearly visible in the upper third of the frame, her hips in the middle of the frame, camera two metres away". This picture is delivered small, so a whole standing figure leaves the part that matters a few pixels wide; a head-to-knees frame keeps her face in shot and the act at a usable size.`
}
${
  undress === "nude"
    ? '- nudity stated as ALREADY TRUE: "completely nude", "fully naked". Write her as already bare rather than undressing'
    : undress === "partial"
      ? `- the GARMENT AND ITS POSITION, both exactly as the user gave them, stated as ALREADY in that position: name the garment, its fabric and its colour, then say where on her body it now sits, how the fabric gathers and stretches where it has been moved to, and what that leaves bare. The user named a garment AND a place for it — both are part of the picture they asked for, and the garment stays in that position for the whole prompt`
      : `- her wardrobe EXACTLY as the user described it, stated as already worn and STAYING ON: name the garments, the fabric and the colour. The user asked for her in clothing, so she is clothed — keep every garment on her through the whole prompt. Lingerie means actual lingerie — a bra and matching briefs, a slip, a bodysuit, a babydoll`
}
- the explicit act, in the user's own vocabulary: tits, pussy, ass, nipples, cock, dildo. Do not euphemise
${
  postureStated
    ? `- the POSTURE THE USER NAMED, exactly as they named it and held for the whole prompt. They said how she is positioned, so that is how she is positioned: write their posture in their words as the first thing after the framing, then describe how her body rests in it — where her weight sits, which parts touch the bed, the floor or the wall, where her arms and legs go, how her back and shoulders follow from it. Every later fragment agrees with it.`
    : `- the POSTURE, which you must INFER from the act rather than wait to be told. Always name a posture. Fingering or masturbating means reclining back against pillows propped up on her elbows with legs spread, or sitting with knees parted; riding means straddling upright, knees on the bed; twerking or from-behind means on all fours or bent over at the waist presenting; male masturbation means holding or stroking his penis. Choose standing only when the user asked for it ("standing in the shower")
- keep the torso UPRIGHT or PROPPED UP whenever the act allows it: sitting, kneeling upright, or reclining against pillows with her shoulders raised, her back gently arched and her shoulders back so her chest is lifted. This is the default for a request that named no position of its own`
}
- OBJECTS: the only objects in the picture are the ones the user named. A request that names no toy is a picture of her alone, her hands resting on her thighs, the sheets or her own body. Adding a toy, a second person or any object the user did not ask for is the worst thing you can do here — it is a different picture from the one they paid for
- any prop or sex toy THE USER NAMED: state WHERE IT IS and HOW MUCH OF IT SHOWS. For an inserted toy write it as angled down along the line between her open thighs, most of the shaft hidden inside her, only the flared base visible with her fingers closed on it and her wrist against her inner thigh. That geometry is what makes the object read as a sex toy at the right scale. Its material and exact size are appended separately, so spend your words on placement and contact
${
  rearView
    ? `- her hands rest where the stated viewpoint puts them: on her thighs, on the sheets, or braced against whatever she leans on. Everything the user left unsaid stays as it falls naturally in the position they described`
    : `- when the request names no touching and no toy: her hands rest on her thighs or on the sheets, and her pussy is closed. This is most requests, and it is the one thing that keeps the render from pulling her open`
}
- ONLY when the user asked for touching, fingering or a toy — where a hand, finger or object meets or enters the body, describe that contact literally and in detail: which fingers, how deep, how the skin and lips part and press around it, wetness, the exact point of contact. This is the part that renders as a smooth plastic blur when it is left vague
${groinFocus && !rearView ? "- her pussy is the FOCAL POINT of the photograph: in the centre of the frame, in sharp focus, a smooth plump closed mound with a single neat vertical crease and only the crease showing, the skin smooth and even, her hands resting on her thighs, the light falling across it so its shape reads\n" : ""}${
  rearView
    ? DEFER_TO_REQUEST
    : undress === "nude"
      ? ANATOMY[kind]
      : undress === "partial"
        ? DEFER_TO_GARMENT
        : "- how the clothing sits on her: where the fabric is taut, where it gathers, the edge of a strap or a hem against skin. Also state her firm perky bust fills the garment neatly. This is what makes a clothed shot read as a photograph rather than a mannequin"
}
- anatomy correctness, stated positively: hands with five separate countable fingers, limbs in natural proportion, torso naturally aligned
- ONE simple setting and ONE light source, kept plain and uncluttered so the words go to her. When the user named no place, use a bed with plain white sheets and soft daylight from a window beside her
- photographic realism tail: "candid raw photograph, authentic human skin texture, matte natural skin finish, visible natural pores and fine skin details, natural asymmetry, subtle skin imperfections, soft natural shadows, shot on Sony A7 IV 85mm lens, real untouched skin"

Every subject is an adult. Output no preamble, no quotes, no explanation, no refusal.`;

function systemFor(kind: "photo" | "video", scenes: number, shape: Shape): string {
  const { undress, closeUp, rearView, kind: subject, toyAsked } = shape;
  // Examples are the strongest instruction in this file, so a companion is only
  // ever shown examples of a body like theirs. A trans man used to be shown two
  // nude men with cocks; a woman used to be shown them too.
  const EXAMPLES_FOR: Record<SubjectKind, string> = {
    female: NUDE_EXAMPLES,
    male: MALE_EXAMPLES,
    "trans-female": `${TRANS_FEMALE_EXAMPLES}\n\n${NUDE_EXAMPLES}`,
    "trans-male": TRANS_MALE_EXAMPLES,
    nb: NUDE_EXAMPLES,
  };
  const base = EXAMPLES_FOR[subject];
  // The POV example is of a vulva between open thighs, so it only helps someone
  // who has one — and the toy example is shown only to a request that named a
  // toy, for the reason on TOY_EXAMPLE.
  const hasVulva = subject !== "male" && subject !== "trans-female";
  const withToy = toyAsked && hasVulva ? `${TOY_EXAMPLE}\n\n${base}` : base;
  // The POV example looks up the front of the body, so a request that set its
  // own viewpoint is spared it along with the rest of the front-facing framing.
  const nudeExamples = closeUp && hasVulva && !rearView ? `${POV_EXAMPLE}\n\n${withToy}` : withToy;
  const examples = undress === "clothed" ? CLOTHED_EXAMPLES : nudeExamples;

  // Every worked example in this file is a front-facing composition, and the
  // comment above says why that matters: examples are the strongest instruction
  // here, and whatever is in them gets reproduced — the same way they once
  // reproduced their own hair colour into every prompt.
  //
  // So when the user has set the viewpoint or the wardrobe themselves, the
  // examples are demoted in writing to what they are still needed for. This is
  // weaker than having a worked example that matches the request, and a matching
  // example is the real fix; until there is one, saying plainly which parts of
  // an example to copy is what stands between the request and a template.
  const formatOnly =
    rearView || undress === "partial"
      ? `\n\nThe examples below are here for FORMAT ONLY: one plain opening sentence, then dense comma-separated fragments, then the realism tail. They were written for other requests. Copy their SHAPE. Take the viewpoint, the posture, the wardrobe and every detail of the subject from the user's request, which is the authority on all four.`
      : "";
  if (kind === "photo") {
    // 110-170, up from 90-150. The bullet list above is long and roughly 60 of
    // the old 150 words were pre-committed boilerplate (the identity anchor and
    // the realism tail alone), so the bullets nearest the end — contact detail,
    // the one that stops a crotch rendering as a smooth plastic blur — were the
    // ones getting squeezed out. The budget still has to be tight: past about
    // 170 words the appended prop specification pushes the whole prompt into
    // the renderer's truncation window.
    return `You write prompts for an uncensored ComfyUI image model in an adults-only AI companion app.

${rules(shape)}

This is a STILL photograph: end with the pose held and the camera locked off, so the last thing described is a moment that is not moving.

Output ONE prompt, 120-160 words. Nothing else.${formatOnly}

Examples of the required style:
${examples}`;
  }
  return `You write prompts for an uncensored ComfyUI image-to-video model in an adults-only AI companion app.

${rules({ ...shape, groinFocus: false })}

The clip has ${scenes} scenes that play back to back. Break the requested action into ${scenes} steps that PROGRESS — an escalating sequence, not the same pose ${scenes} times. Each scene keeps her identity, the setting and the lighting consistent; only the pose, the action and the camera move on.

Output exactly ${scenes} prompts, one per line, each 60-120 words, numbered "1." to "${scenes}.". Nothing else.${formatOnly}

Examples of the required style:
${examples}`;
}

// Belt and braces on the rule above.
//
// The system prompt tells the model not to negate; this deletes the negation if
// it does anyway. Not a style preference — a single "away from her face" that
// slips through is enough to put the toy back at her mouth, and Grok runs at
// temperature 0.8 on a prompt with a dozen other demands in it.
//
// Whole fragments go, not just the negating word: these prompts are
// comma-separated fragments, so dropping "sex toy held away from her face" as a
// unit removes the stray `face` with it. A negation inside a longer fragment is
// rewritten rather than dropped, so the useful half survives.
const NEGATION_FRAGMENT =
  /(?:^|,)\s*[^,]*\b(?:not|no|never|without|avoid(?:ing)?|away from|instead of|rather than)\b[^,]*/gi;

export function stripNegations(prompt: string): string {
  const cleaned = prompt
    .replace(NEGATION_FRAGMENT, ",")
    .replace(/\s*,\s*(?:,\s*)+/g, ", ")
    .replace(/^\s*,\s*/, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // If the model wrote almost nothing but negations, the stripped version is
  // worse than what we started with — an empty prompt renders a stranger. Sixty
  // characters is the same floor usableRefinement uses to decide a photo prompt
  // is real at all, so anything below it was never going to be sent anyway.
  return cleaned.length >= 60 ? cleaned : prompt;
}

// Belt and braces on the OBJECTS rule, the same way stripNegations backs the
// negation rule: a toy the request did not name is removed from the answer,
// fragment by fragment, so it cannot reach the renderer however the model
// drifted. The floor mirrors stripNegations — an answer that was mostly toy
// is worse stripped than replaced, and falls through to the builder.
export function stripUnrequestedProps(prompt: string, userRequest: string): string {
  if (TOY_RE.test(userRequest)) return prompt;
  const fragment = new RegExp(String.raw`(?:^|,)\s*[^,]*\b(?:${TOY_VOCAB})\b[^,]*`, "gi");
  const cleaned = prompt
    .replace(fragment, ",")
    .replace(/\s*,\s*(?:,\s*)+/g, ", ")
    .replace(/^\s*,\s*/, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned.length >= 60 ? cleaned : prompt;
}

// A refusal that starts mid-sentence, or a prompt that came back scrubbed of
// everything explicit, is worse than no refined prompt at all: it silently
// replaces the keyword builder with a description of a clothed woman and the
// user is charged eight credits for it. The first-few-words regex catches "I
// can't help with that"; this catches "Here is a tasteful portrait of…".
const EXPLICIT_MARKER =
  /\b(nude|naked|bare|topless|breasts?|tits|nipples?|pussy|vulva|labia|clitoris|cock|penis|testicles|ass|dildo|vibrator|masturbat\w*|cum\w*|orgasm\w*)\b/i;

function usableRefinement(raw: string, nude: boolean, minLength: number): boolean {
  if (raw.length < minLength) return false;
  if (/^(i (can'?t|cannot|won'?t)|i'm sorry|as an ai|sorry,)/i.test(raw)) return false;
  return !nude || EXPLICIT_MARKER.test(raw);
}

async function refineMediaWithOpenRouter(
  kind: "photo" | "video",
  userRequest: string,
  subject: string,
  scenes: number,
  shape: Shape,
): Promise<string[] | null> {
  const nude = shape.undress !== "clothed";
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;

  const model = process.env.OPENROUTER_MODEL || "sao10k/l3.1-euryale-70b";
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20_000);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: abort.signal,
      body: JSON.stringify({
        model,
        temperature: 0.6,
        messages: [
          {
            role: "system",
            content: systemFor(kind, scenes, shape),
          },
          { role: "user", content: `Subject: a ${subject}. Request: ${userRequest}` },
        ],
      }),
    });
    if (!res.ok) return null;

    const json = await res.json();
    const raw = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!raw) return null;

    if (kind === "photo")
      return usableRefinement(raw, nude, 60)
        ? [stripUnrequestedProps(stripNegations(raw), userRequest)]
        : null;

    if (!usableRefinement(raw, nude, 40)) return null;
    const parts = raw
      .split(/\n+/)
      .map((l: string) =>
        stripUnrequestedProps(stripNegations(l.replace(/^\s*\d+[.)]\s*/, "").trim()), userRequest),
      )
      .filter((l: string) => l.length > 40);

    if (!parts.length) return null;
    return parts.slice(0, scenes);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function refineMediaPrompt(
  kind: "photo" | "video",
  userRequest: string,
  companion: { gender?: string | null; ethnicity?: string; age?: number },
  scenes = 1,
): Promise<string[] | null> {
  const key = process.env.XAI_API_KEY;
  const req = (userRequest ?? "").trim();
  if (!req) return null;

  // The one place that decides clothed vs nude, shared with the keyword builders
  // so the refined prompt and the fallback agree about what was asked for.
  //
  // Close-up is read here for the same reason. It used to be left to the model:
  // one rules bullet asked for full-body framing AND close-up POV framing and
  // told Grok to pick, so a prompt could come back demanding both — and then
  // startImageJob tried to patch the result with a regex. Deciding it here means
  // the system prompt asks for exactly one framing and there is nothing to patch.
  const {
    requestIsNude,
    CLOSE_UP_RE,
    requestSetsViewpoint,
    PARTIAL_UNDRESS_RE,
    STATED_POSTURE_RE,
  } = await import("./selfie");
  // Three states, not two. A request that moves a garment rather than removing
  // it used to collapse into one of the other two, and whichever it picked threw
  // away half of what the user specified: "nude" loses the garment, "clothed"
  // loses the position they put it in. It wins over plain nudity because it is
  // the more specific description of the same picture.
  const undress: Shape["undress"] = PARTIAL_UNDRESS_RE.test(req)
    ? "partial"
    : requestIsNude(req)
      ? "nude"
      : "clothed";
  const nude = undress !== "clothed";
  const closeUp = CLOSE_UP_RE.test(req);

  // This file's own copy of the trans detection is gone. It read the user's
  // message as well as the companion's gender, so "show me your cock trans"
  // told Grok to write a prompt for a transgender woman no matter who it was
  // actually talking about — and it had no branch for a trans man at all, so he
  // was described to Grok as a plain man. anatomyOf is the single authority now.
  const { anatomyOf, mentionsPart } = await import("./anatomy");
  const a = anatomyOf(companion.gender);
  const subjectKind: SubjectKind = a.kind;
  // A photo that is ABOUT her pussy is framed closer than one that merely ends
  // up nude — the only thing in the prompt that gives that anatomy the pixels
  // it needs to render. Photos only: a clip cropped chin-to-knees is a separate
  // decision, and videos are not what was reported as bad.
  const groinFocus = kind === "photo" && nude && a.hasVulva && mentionsPart(req, "vulva");
  // Either an explicit viewpoint cue ("from behind", "bend over") or the part
  // itself, which the refiner never read: `ass` has been in selfie.ts's nudity
  // vocabulary all along, so "show me your ass" counted as a request for a nude
  // photo and then went to a front-facing template.
  //
  // Over-triggering is the cheap direction here. Everything this flag does is
  // withhold a front-facing default and tell the model to follow the user's own
  // words, so a false positive costs a request that was going to be described
  // literally anyway — where a false negative is the reported bug.
  const rearView = requestSetsViewpoint(req);
  const postureStated = STATED_POSTURE_RE.test(req);
  const toyAsked = TOY_RE.test(req);
  const noun =
    a.kind === "trans-female"
      ? "transgender woman (feminine body with firm perky breasts and an anatomically correct penis)"
      : a.kind === "trans-male"
        ? "transgender man (masculine build and flat chest, with a vulva)"
        : a.noun;

  const subject = [
    companion.age ? `${companion.age}-year-old` : "",
    companion.ethnicity ?? "",
    noun,
  ]
    .filter(Boolean)
    .join(" ");

  const shape: Shape = {
    undress,
    closeUp,
    rearView,
    postureStated,
    kind: subjectKind,
    groinFocus,
    toyAsked,
  };

  // Attempt using Grok first if the key is available
  if (key) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);

    try {
      const res = await fetch(XAI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          model: process.env.XAI_MODEL || "grok-4.6",
          temperature: 0.6,
          max_tokens: kind === "video" ? 2000 : 500,
          messages: [
            {
              role: "system",
              content: systemFor(kind, scenes, shape),
            },
            { role: "user", content: `Subject: a ${subject}. Request: ${req}` },
          ],
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const raw = (json.choices?.[0]?.message?.content ?? "").trim();
        if (kind === "photo") {
          if (usableRefinement(raw, nude, 60)) {
            clearTimeout(timer);
            return [stripUnrequestedProps(stripNegations(raw), req)];
          }
        } else if (usableRefinement(raw, nude, 40)) {
          const parts = raw
            .split(/\n+/)
            .map((l: string) =>
              stripUnrequestedProps(stripNegations(l.replace(/^\s*\d+[.)]\s*/, "").trim()), req),
            )
            .filter((l: string) => l.length > 40);

          if (parts.length > 0) {
            clearTimeout(timer);
            return parts.slice(0, scenes);
          }
        }
      }
    } catch {
      // Ignored: proceed to OpenRouter fallback
    } finally {
      clearTimeout(timer);
    }
  }

  // Fallback to OpenRouter (uncensored model) if Grok is not configured, failed, or refused
  return refineMediaWithOpenRouter(kind, req, subject, scenes, shape);
}

// Promo images are a different job from chat media: clothed, publishable, and
// the thing being sold is that they don't look generated. Same expansion, same
// density, opposite content rules — so it gets its own system prompt rather
// than a flag on the explicit one.
const PROMO_SYSTEM = `You write prompts for a photorealistic image model producing social-media photos of a fictional adult model.

Expand the user's short description into ONE dense prompt of comma-separated fragments, never sentences.

Include, in this order:
- the subject: age range, hair (colour, length, cut), eyes, skin, build
- wardrobe: specific garments, fabrics and colours. Always fully clothed — attractive and form-fitting is fine, exposed is not
- pose and expression, natural and candid rather than posed for a camera
- setting with real detail, and the specific light in it (window light, golden hour, overcast, lamplight)
- camera language: shot on a full-frame DSLR, 50mm or 85mm lens, shallow depth of field, natural bokeh
- realism markers, written as what IS in the photo: real skin texture with visible pores and fine lines, natural asymmetry, flyaway hairs, subtle skin tone variation, clothing with real creases. Describe only what is present; never write what is absent
- any object or prop as a separate solid item with its own material, colour, weight and clean edges, distinct from her hands, and sized against her body in concrete terms ("about as long as her forearm") rather than as "correctly proportioned", which the renderer cannot act on

Never write "8k", "masterpiece", "ultra HD" or similar render tags — they push the image toward looking generated. Aim for a real photograph taken by a real person.

Never describe the subject as young, teen, schoolgirl, or a minor — she is an adult in her twenties or older.

Output only the prompt, 90-150 words. No preamble, no quotes, no explanation.`;

// When a reference image is supplying the face, inventing hair, eyes and build
// fights it: the model gets told she is chestnut-haired while being shown a
// blonde. The wardrobe and setting are still described in full.
const PROMO_WITH_REFERENCE = `
The subject's face, hair and body come from a reference image that will be supplied. Do NOT invent or describe her hair colour, hair length, eye colour, skin tone or build — say "the same woman as the reference image, identical face and hair" instead, and spend the words on wardrobe, pose, setting, light and camera.`;

async function refinePromoWithOpenRouter(
  description: string,
  hasReference = false,
): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;

  const model = process.env.OPENROUTER_MODEL || "sao10k/l3.1-euryale-70b";
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30_000);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: abort.signal,
      body: JSON.stringify({
        model,
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content: hasReference ? PROMO_SYSTEM + PROMO_WITH_REFERENCE : PROMO_SYSTEM,
          },
          { role: "user", content: description },
        ],
      }),
    });
    if (!res.ok) return null;

    const json = await res.json();
    const out = (json.choices?.[0]?.message?.content ?? "").trim();
    if (out.length < 60) return null;
    if (/^(i (can'?t|cannot|won'?t)|i'm sorry|as an ai|sorry,)/i.test(out)) return null;

    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Same refiner, promo rules. Falls back to OpenRouter or user's text on any failure.
export async function refinePromoPrompt(
  description: string,
  hasReference = false,
): Promise<string | null> {
  const key = process.env.XAI_API_KEY;
  const req = (description ?? "").trim();
  if (!req) return null;

  // Attempt using Grok first if the key is available
  if (key) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);
    try {
      const res = await fetch(XAI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          model: process.env.XAI_MODEL || "grok-4.6",
          temperature: 0.8,
          max_tokens: 500,
          messages: [
            {
              role: "system",
              content: hasReference ? PROMO_SYSTEM + PROMO_WITH_REFERENCE : PROMO_SYSTEM,
            },
            { role: "user", content: req },
          ],
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const out = (json.choices?.[0]?.message?.content ?? "").trim();
        if (
          out.length >= 60 &&
          !/^(i (can'?t|cannot|won'?t)|i'm sorry|as an ai|sorry,)/i.test(out)
        ) {
          clearTimeout(timer);
          return out;
        }
      }
    } catch {
      // Ignored: proceed to OpenRouter fallback
    } finally {
      clearTimeout(timer);
    }
  }

  // Fallback to OpenRouter (uncensored model) if Grok is not configured or failed/timed out
  return refinePromoWithOpenRouter(req, hasReference);
}

// Ad copy is a third job again: not a render prompt at all, but the two lines of
// headline and the button label that go ON a banner. Kept here because it shares
// the Grok-then-OpenRouter fallback chain and the refusal screening — the studio
// should never be blocked on the copywriter being down, it just leaves the
// fields for the admin to fill in.
const BANNER_COPY_SYSTEM = `You write direct-response ad copy for HumanCrush.com, an adults-only AI companion app where users chat with and get photos from an AI girlfriend.

Given a description of the photo the banner will use, write:
- HEADLINE: exactly two short lines. Each line at most 18 characters. Together they are one sentence or one tight pair of phrases. Punchy, second person, implies she is available right now. Examples of the register: "She'll send you" / "anything." — "Your AI girl." / "Your rules." — "She always" / "texts back."
- CTA: two or three words for the button. Examples: "Chat free", "Start free", "Try free", "Meet her".

Rules: no emoji, no hashtags, no quotation marks in the output, no exclamation stacking. Never reference a specific price. Never describe anyone as young, teen, or a minor. Do not describe explicit acts — the banner runs on ad networks that reject them even when the site behind the ad is explicit.

Output EXACTLY three lines and nothing else:
<headline line 1>
<headline line 2>
<cta>`;

function parseBannerCopy(raw: string): { headline: string[]; cta: string } | null {
  const lines = raw
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:HEADLINE|CTA|LINE\s*\d)\s*[:-]\s*/i, "").trim())
    .map((l) => l.replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
  if (lines.length < 3) return null;
  return { headline: [lines[0], lines[1]], cta: lines[2] };
}

export async function refineBannerCopy(
  description: string,
): Promise<{ headline: string[]; cta: string } | null> {
  const req = (description ?? "").trim();
  if (!req) return null;

  const isRefusal = (s: string) => /^(i (can'?t|cannot|won'?t)|i'm sorry|as an ai|sorry,)/i.test(s);

  const key = process.env.XAI_API_KEY;
  if (key) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30_000);
    try {
      const res = await fetch(XAI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          model: process.env.XAI_MODEL || "grok-4.6",
          temperature: 0.9,
          max_tokens: 120,
          messages: [
            { role: "system", content: BANNER_COPY_SYSTEM },
            { role: "user", content: req },
          ],
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const out = (json.choices?.[0]?.message?.content ?? "").trim();
        if (out && !isRefusal(out)) {
          const parsed = parseBannerCopy(out);
          if (parsed) {
            clearTimeout(timer);
            return parsed;
          }
        }
      }
    } catch {
      // Ignored: proceed to OpenRouter fallback
    } finally {
      clearTimeout(timer);
    }
  }

  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20_000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${orKey}`, "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "sao10k/l3.1-euryale-70b",
        temperature: 0.9,
        messages: [
          { role: "system", content: BANNER_COPY_SYSTEM },
          { role: "user", content: req },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const out = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!out || isRefusal(out)) return null;
    return parseBannerCopy(out);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
