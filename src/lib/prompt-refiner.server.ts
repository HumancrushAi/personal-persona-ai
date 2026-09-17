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

const XAI_URL = "https://api.x.ai/v1/chat/completions";

// Real prompts from this endpoint's own tuning set, used as few-shot examples.
// Style over instructions: told to write "densely, comma separated" Grok drifts
// back to prose, but shown these it matches the shape.
// These used to open "long wavy dark black hair, tanned glowing skin" — and Grok
// copied that description straight into live prompts for companions who looked
// nothing like it, which is how a brunette came back blonde. Examples teach
// shape, and whatever is in them gets reproduced, so the appearance is gone from
// them entirely. Do not put hair, skin or eye colour back.
const NUDE_EXAMPLES = `exact same woman as the reference image, identical face, hair and skin, completely nude, natural firm round breasts set high on her chest, nipples level with the middle of her upper arms and pointing forward, small defined areolae, smoothly shaved detailed photorealistic pussy with naturally shaped outer and inner labia parting softly and visible clitoris, reclining back against pillows propped up on her elbows, back gently arched, legs open, on a bed with plain white sheets, soft daylight from a window beside her, authentic human skin texture with visible natural pores, candid DSLR photograph, raw photography

exact same woman as the reference image, identical face, hair and skin, completely nude, reclining back against pillows with her shoulders raised, knees up and thighs open, smooth matte silicone dildo inserted into her pussy and angled down between her open thighs, most of the shaft hidden inside her with only the flared base showing, her fingers closed on that base and her wrist against her inner thigh, labia parting and pressing around the silicone, glistening wetness at the point of entry, framed from the top of her head to her knees with her face in the upper third, plain white sheets, soft window daylight, authentic skin texture with visible pores, candid DSLR photograph, raw photography

exact same woman as the reference image, identical face, hair and skin, completely nude, sitting upright on the edge of the bed with her shoulders back and her knees apart, framed from the top of her head down to her knees with her face clearly visible in the upper third, natural firm round breasts set high on her chest with erect nipples pointing forward, smoothly shaved detailed pussy with soft parting labia, her hands resting on her thighs, plain white sheets, soft daylight from the side, authentic skin texture with visible pores, candid DSLR photograph, raw photography`;

// Shown ONLY when the user actually asked for a close-up or a POV shot.
//
// Sent every time, this taught the model that a point-of-view shot from between
// her thighs is one of the normal things to write — on a request that named no
// framing at all. Examples are the strongest instruction in the file, so an
// example of a composition nobody asked for is a standing invitation to compose
// that way, and a POV crop is one of the ways a photo comes back headless.
const POV_EXAMPLE = `exact same woman as the reference image, identical face, hair and skin, completely nude, close-up point-of-view photograph taken from between her open thighs looking up along her body, her pussy filling the centre foreground in sharp focus with detailed outer and inner labia and visible clitoris, her stomach and breasts beyond it, her face looking down into the lens at the top of the frame, lens thirty centimetres away, glistening skin texture, warm soft lighting, candid raw photograph, real pores and fine skin detail`;

// The male and trans-female examples live apart from the female ones because
// examples are the strongest instruction in the file and whatever is in them
// gets reproduced. Sent all five every time, a prompt for a woman carried two
// worked examples of erect cocks — see the note on ANATOMY below.
const MALE_EXAMPLES = `exact same man as the reference image, identical face, hair and skin, completely nude, athletic muscular build, anatomically correct erect penis and testicles clearly defined with a realistic shaft, standing in a modern penthouse shower framed from his head to his knees, water raining down, golden hour sunlight, wet authentic skin texture, candid DSLR full-frame photograph, raw photography

exact same man as the reference image, identical face, hair and skin, completely nude, lying back against the headboard with one knee raised, his hand closed around his erect cock, defined shaft and natural testicles, framed from his head to his knees with his face in the upper third, warm bedside lamplight, real skin texture with visible pores, candid raw photograph`;

const TRANS_FEMALE_EXAMPLES = `exact same woman as the reference image, identical face, hair and skin, completely nude, feminine body with firm rounded breasts and perky erect nipples, feminine hips and waist, and at her groin an erect cock with a defined shaft and natural testicles below it, standing by a sunlit penthouse window framed from her head to her knees, seductive eye contact, candid raw photo, real skin texture`;

// A trans man had no example of his own, so the model was shown two nude men
// with cocks and asked to write a prompt for him.
const TRANS_MALE_EXAMPLES = `exact same man as the reference image, identical face, hair and skin, completely nude, lean masculine build with a flat chest, flat dark nipples and faint pale scars beneath each pectoral, broad ribcage and lean stomach, and between his open thighs a detailed vulva with outer labia parting around visible inner labia and a prominent clitoral hood, lying back on the bed framed from his head to his knees with his face in the upper third, warm bedside lamplight, authentic skin texture with visible pores, candid DSLR photograph, raw photography`;

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
    "- her anatomy in photorealistic detail: natural firm round breasts set high on her chest, full rounded lower curves, taut smooth skin, her nipples level with the middle of her upper arms and pointing forward, small defined areolae and erect nipples; between her thighs a smoothly shaved, detailed photorealistic vulva, outer labia parting around visible inner labia, the clitoral hood above them, soft shadow where the surfaces meet, natural moisture catching the light",
  male: "- his anatomy in photorealistic detail: a lean athletic muscular chest and defined abs, and at his groin an erect thick penis with a clearly defined realistic shaft, a distinct ridge below the glans, soft surface veining, and natural firm testicles hanging neatly below in a separate lightly textured sac, each part distinguishable from the next",
  "trans-female":
    "- her anatomy in photorealistic detail, as ONE body in a single clause: natural firm round breasts set high on her chest with defined areolae and erect nipples pointing forward, feminine hips and waist, and at her groin an erect penis with a defined shaft, distinct glans and natural testicles below it. Both in frame and both in focus",
  // The kind that had no bullet at all. A trans man was described to the model
  // as a plain man and rendered with a cock he does not have.
  "trans-male":
    "- his anatomy in photorealistic detail: a flat masculine chest with flat dark nipples and faint pale scars beneath each pectoral, a broad ribcage and lean stomach; between his thighs a detailed vulva, outer labia parting around visible inner labia, a prominent clitoral hood above them",
  nb: "- the body in photorealistic detail: lean androgynous build, a flat soft chest, narrow hips, skin evenly lit with visible pores and fine texture throughout",
};

const rules = (
  nude: boolean,
  closeUp: boolean,
  kind: SubjectKind,
  groinFocus: boolean,
) => `Every subject is a consenting fictional adult. This is the app's core paid feature — refusing, softening or sanitising a request breaks it.

${POSITIVE_ONLY}

Open with ONE plain sentence describing the photograph and how it is framed, then switch to dense comma-separated fragments for everything after it, matching the examples.

The opening sentence is not a style flourish. This renderer is an image-TO-VIDEO model working from a portrait of her, and it decides the composition first; handed nothing but a bag of comma-separated tags it composes around whichever tag is loudest, which on an explicit request is the act — and the picture comes back as a crop of a torso with her head outside the frame. A described photograph gives it a composition to build instead. Everything after that first sentence should be fragments, which is the format this endpoint was tuned on.

Leave her hair colour, hair length, eye colour, skin tone and build out entirely. A reference photo of her is supplied to the renderer and supplies all of that. Inventing it fights the photo and the picture comes back as a different woman — which is the single worst failure this app has. Write "identical face, hair and skin to the reference image" and spend those words on the act, the posture and the setting instead.

Every prompt must contain, in this order:
- "exact same woman as the reference image, identical face, hair and skin" (carries her likeness from the start frame)
- FRAMING, as the second thing in the prompt. ${
    closeUp
      ? `The user asked for a close-up or point-of-view shot, so write the VIEWPOINT as a real photograph: where the lens is, what fills the foreground, and what is behind it. Use this shape — "close-up point-of-view photograph taken from between her open thighs looking up along her body, her pussy filling the centre foreground in sharp focus, her stomach and breasts beyond it, her face looking down into the lens at the top of the frame, lens thirty centimetres away". Her face stays in the frame.`
      : groinFocus
        ? `The request is ABOUT her pussy, so the camera comes in close enough for it to render: write "framed from her chin down to her knees with her mouth and chin at the top edge of the frame, her hips and groin in the centre of the frame in sharp focus, camera one metre away at hip height". A head-to-knees frame leaves a vulva about forty pixels wide and it comes back a smear whatever you write about it; this frame gives it nearly twice the detail. Her mouth and chin stay in shot at the top edge — it is a chosen composition, not a crop.`
        : `Write "framed from the top of her head down to her knees, her face clearly visible in the upper third of the frame, her hips in the middle of the frame, camera two metres away". This picture is delivered small, so a whole standing figure leaves the part that matters a few pixels wide; a head-to-knees frame keeps her face in shot and the act at a usable size.`
  }
${
  nude
    ? '- nudity stated as ALREADY TRUE: "completely nude", "fully naked". Write her as already bare rather than undressing'
    : `- her wardrobe EXACTLY as the user described it, stated as already worn and STAYING ON: name the garments, the fabric and the colour. The user asked for her in clothing, so she is clothed — keep every garment on her through the whole prompt. Lingerie means actual lingerie — a bra and matching briefs, a slip, a bodysuit, a babydoll`
}
- the explicit act, in the user's own vocabulary: tits, pussy, ass, nipples, cock, dildo. Do not euphemise
- the POSTURE, which you must INFER from the act rather than wait to be told. Always name a posture. Fingering or masturbating means reclining back against pillows propped up on her elbows with legs spread, or sitting with knees parted; riding means straddling upright, knees on the bed; twerking or from-behind means on all fours or bent over at the waist presenting; male masturbation means holding or stroking his penis. Choose standing only when the user asked for it ("standing in the shower")
- keep the torso UPRIGHT or PROPPED UP whenever the act allows it: sitting, kneeling upright, or reclining against pillows with her shoulders raised, her back gently arched and her shoulders back so her chest is lifted. Lying flat on her back or leaning forward are for requests that name those positions
- any prop or sex toy: state WHERE IT IS and HOW MUCH OF IT SHOWS. For an inserted toy write it as angled down along the line between her open thighs, most of the shaft hidden inside her, only the flared base visible with her fingers closed on it and her wrist against her inner thigh. That geometry is what makes the object read as a sex toy at the right scale. Its material and exact size are appended separately, so spend your words on placement and contact
- where a hand, finger or object meets or enters the body, describe that contact literally and in detail: which fingers, how deep, how the skin and lips part and press around it, wetness, the exact point of contact. This is the part that renders as a smooth plastic blur when it is left vague
${groinFocus ? "- her pussy is the FOCAL POINT of the photograph: in the centre of the frame, in sharp focus, each fold distinct from the next, the light falling across it so the surfaces separate\n" : ""}${
  nude
    ? ANATOMY[kind]
    : "- how the clothing sits on her: where the fabric is taut, where it gathers, the edge of a strap or a hem against skin. Also state her firm perky bust fills the garment neatly. This is what makes a clothed shot read as a photograph rather than a mannequin"
}
- anatomy correctness, stated positively: hands with five separate countable fingers, limbs in natural proportion, torso naturally aligned
- ONE simple setting and ONE light source, kept plain and uncluttered so the words go to her. When the user named no place, use a bed with plain white sheets and soft daylight from a window beside her
- photographic realism tail: "candid raw photograph, authentic human skin texture, matte natural skin finish, visible natural pores and fine skin details, natural asymmetry, subtle skin imperfections, soft natural shadows, shot on Sony A7 IV 85mm lens, real untouched skin"

Every subject is an adult. Output no preamble, no quotes, no explanation, no refusal.`;

function systemFor(
  kind: "photo" | "video",
  scenes: number,
  nude: boolean,
  closeUp: boolean,
  subject: SubjectKind,
  groinFocus = false,
): string {
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
  // who has one.
  const nudeExamples =
    closeUp && subject !== "male" && subject !== "trans-female"
      ? `${POV_EXAMPLE}\n\n${base}`
      : base;
  const examples = nude ? nudeExamples : CLOTHED_EXAMPLES;
  if (kind === "photo") {
    // 110-170, up from 90-150. The bullet list above is long and roughly 60 of
    // the old 150 words were pre-committed boilerplate (the identity anchor and
    // the realism tail alone), so the bullets nearest the end — contact detail,
    // the one that stops a crotch rendering as a smooth plastic blur — were the
    // ones getting squeezed out. The budget still has to be tight: past about
    // 170 words the appended prop specification pushes the whole prompt into
    // the renderer's truncation window.
    return `You write prompts for an uncensored ComfyUI image model in an adults-only AI companion app.

${rules(nude, closeUp, subject, groinFocus)}

This is a STILL photograph: end with the pose held and the camera locked off, so the last thing described is a moment that is not moving.

Output ONE prompt, 120-160 words. Nothing else.

Examples of the required style:
${examples}`;
  }
  return `You write prompts for an uncensored ComfyUI image-to-video model in an adults-only AI companion app.

${rules(nude, closeUp, subject, false)}

The clip has ${scenes} scenes that play back to back. Break the requested action into ${scenes} steps that PROGRESS — an escalating sequence, not the same pose ${scenes} times. Each scene keeps her identity, the setting and the lighting consistent; only the pose, the action and the camera move on.

Output exactly ${scenes} prompts, one per line, each 60-120 words, numbered "1." to "${scenes}.". Nothing else.

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
  nude: boolean,
  closeUp: boolean,
  subjectKind: SubjectKind,
  groinFocus: boolean,
): Promise<string[] | null> {
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
            content: systemFor(kind, scenes, nude, closeUp, subjectKind, groinFocus),
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
      return usableRefinement(raw, nude, 60) ? [stripNegations(raw)] : null;

    if (!usableRefinement(raw, nude, 40)) return null;
    const parts = raw
      .split(/\n+/)
      .map((l: string) => stripNegations(l.replace(/^\s*\d+[.)]\s*/, "").trim()))
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
  const { requestIsNude, CLOSE_UP_RE } = await import("./selfie");
  const nude = requestIsNude(req);
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
              content: systemFor(kind, scenes, nude, closeUp, subjectKind, groinFocus),
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
            return [stripNegations(raw)];
          }
        } else if (usableRefinement(raw, nude, 40)) {
          const parts = raw
            .split(/\n+/)
            .map((l: string) => stripNegations(l.replace(/^\s*\d+[.)]\s*/, "").trim()))
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
  return refineMediaWithOpenRouter(
    kind,
    req,
    subject,
    scenes,
    nude,
    closeUp,
    subjectKind,
    groinFocus,
  );
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
