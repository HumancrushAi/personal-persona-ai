// Turns one line from the user into the long, dense prompts this ComfyUI
// endpoint was tuned on, using Grok (xAI).
//
// Strictly an improvement layer — no key, a refusal, a timeout or a stub answer
// all fall back to the builder, which still works alone. It must never be the
// reason a paid request fails.

import type { GenderKind } from "./anatomy";
import { TOY_VOCAB } from "./props";

const TOY_RE = new RegExp(String.raw`\b(?:${TOY_VOCAB})\b`, "i");
const XAI_URL = "https://api.x.ai/v1/chat/completions";

// A non-reasoning model, on purpose. grok-4.6 took 44 seconds on a one-line
// request and longer still with this system prompt, which is past the 60s this
// call used to allow — so in production EVERY photo request was timing out
// here and rendering the keyword builder's prompt instead. The fast model
// answers in two or three seconds and writes the same house style.
const DEFAULT_XAI_MODEL = "grok-4-fast-non-reasoning";
const REFINE_TIMEOUT_MS = 30_000;

// The things the renderer is most likely to draw by mistake for THIS request,
// named by the model that just wrote the prompt. The hand-written negative
// lists in media.functions cover the failures that have already been reported;
// this covers the next one. "licking your tits" came back with a toy in her
// hand because nothing in any list said "no object": the model writing the
// prompt knows that is the obvious mistake, and now says so.
export const AVOID_MARKER = /^\s*AVOID\s*:/im;

export function splitAvoid(raw: string): { text: string; avoid: string[] } {
  const m = AVOID_MARKER.exec(raw);
  if (!m) return { text: raw.trim(), avoid: [] };
  const text = raw.slice(0, m.index).trim();
  const avoid = raw
    .slice(m.index + m[0].length)
    .split(/[,;\n]+/)
    .map((t) => t.trim().replace(/^[-*\s]+|[.\s]+$/g, "").toLowerCase())
    .filter((t) => t.length >= 2 && t.length <= 40);
  return { text, avoid };
}

// Never let the avoid list push away a part this body has, or anything the
// user actually asked for: a negative prompt pushes on the tokens it contains
// (see the header of media.functions), and "breasts" in the negative of a
// request for her breasts is how a chest comes back flat.
export function filterAvoid(
  terms: string[],
  userRequest: string,
  anatomy: { hasBreasts: boolean; hasVulva: boolean; hasPenis: boolean },
): string[] {
  const req = userRequest.toLowerCase();
  const reqWords = new Set(req.split(/[^a-z]+/).filter((w) => w.length > 2));
  const owned = [
    anatomy.hasBreasts && /\b(breasts?|tits?|boobs?|nipples?|chest|cleavage|bust)\b/,
    anatomy.hasVulva && /\b(pussy|vulva|vagina|labia|clit\w*|cunt)\b/,
    anatomy.hasPenis && /\b(penis|cock|dick|testicles?|balls|shaft|erection)\b/,
    // Parts every body has: a negative must never push a part away, however
    // the model phrased it ("tongue" on a licking request would fight the act).
    /\b(face|head|eyes?|hair|skin|hands?|fingers?|arms?|legs?|thighs?|feet|body|woman|man|ass|butt|tongue|mouth|lips|teeth|neck|shoulders?|stomach|belly|hips?|waist|back)\b/,
  ].filter(Boolean) as RegExp[];
  const out: string[] = [];
  for (const t of terms) {
    if (/\b(not|no|never|without)\b/.test(t)) continue;
    // Camera talk is not a thing in the picture; in a negative it only pushes
    // on "angle" and "framing", which the positive prompt also uses.
    if (/\b(angle|framing|framed|crop\w*|view|viewpoint|distance|distant|close-?up|zoom\w*|lighting|background)\b/.test(t))
      continue;
    if (owned.some((re) => re.test(t))) continue;
    if (t.split(/[^a-z]+/).some((w) => w.length > 2 && reqWords.has(w))) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

// Clean examples — strictly positive, consistent with the anatomy clause
const NUDE_EXAMPLES = `exact same woman as the reference image, identical face, hair and skin, completely nude, full natural breasts matching her frame with a soft natural shape and real weight, natural soft skin with real texture, nipples level with the middle of the upper arms pointing forward, small smooth defined areolae and naturally erect nipples with clean realistic texture, smoothly shaved plump closed pussy as a soft rounded mound with a single neat vertical crease, everything fully closed and tucked so only the clean crease shows, full natural round ass matching the reference, reclining back against pillows, legs open, soft natural lighting, natural healthy skin with fine texture, candid DSLR photograph, raw photography

exact same woman as the reference image, identical face, hair and skin, completely nude, sitting upright on the edge of the bed with her knees apart, framed from the top of her head down to her knees, full natural breasts matching her frame with a soft natural shape and real weight, erect nipples pointing forward, smoothly shaved plump closed pussy with a single neat vertical crease, soft natural lighting, natural healthy skin with fine texture, candid DSLR photograph, raw photography`;

const TOY_EXAMPLE = `exact same woman as the reference image, identical face, hair and skin, completely nude, reclining back against pillows with her knees up and thighs open, full natural breasts matching her frame with a soft natural shape and real weight, smooth matte silicone dildo inserted into her pussy, most of the shaft hidden inside her with only the flared base showing, her fingers closed on the base, her pussy pressing snugly around the silicone, glistening wetness at the point of entry, framed from the top of her head to her knees, soft natural lighting, natural healthy skin with fine texture, candid DSLR photograph, raw photography`;

const POV_EXAMPLE = `exact same woman as the reference image, identical face, hair and skin, completely nude, close-up point-of-view photograph taken from between her open thighs, her pussy filling the centre foreground in sharp focus, a smooth plump closed mound with a single neat vertical crease, only the crease showing, soft natural lighting, candid raw photograph, fine natural skin detail`;

const MALE_EXAMPLES = `exact same man as the reference image, identical face, hair and skin, completely nude, athletic muscular build, thick erect penis standing out from his body and angled slightly upward, about as long as his hand from wrist to fingertip, clearly defined shaft with soft realistic veining, distinct coronal ridge where the shaft meets the smooth rounded glans, natural firm testicles hanging in a separate lightly textured scrotum, framed from his head to his knees, warm light, authentic skin texture, candid DSLR photograph, raw photography

exact same man as the reference image, identical face, hair and skin, completely nude, lying back against the headboard with one knee raised, his hand closed around his thick erect cock, clearly defined shaft with soft veining, distinct ridge below the smooth rounded glans, natural firm testicles in a separate sac, framed from his head to his knees, warm bedside lamplight, real skin texture with visible pores, candid raw photograph`;

const TRANS_FEMALE_EXAMPLES = `exact same woman as the reference image, identical face, hair and skin, completely nude, feminine body with full natural breasts matching her frame with a soft natural shape and real weight, defined areolae and naturally erect nipples with clean realistic texture, feminine hips and waist, and at her groin a thick erect penis standing out and angled slightly upward, about as long as her hand from wrist to fingertip, defined shaft with soft veining, distinct ridge below the smooth rounded glans and natural testicles in a separate sac, both breasts and cock in frame and in focus, candid raw photo, real skin texture`;

const TRANS_MALE_EXAMPLES = `exact same man as the reference image, identical face, hair and skin, completely nude, lean masculine build with a flat chest, flat dark nipples and faint pale scars beneath each pectoral, broad ribcage and lean stomach, and between his open thighs a smoothly shaved plump closed pussy with a single neat vertical crease, framed from his head to his knees, warm bedside lamplight, natural healthy skin with fine texture, candid DSLR photograph, raw photography`;

const CLOTHED_EXAMPLES = `exact same woman as the reference image, identical face, hair and skin, wearing a black lace bra and matching high-waisted briefs, full natural bust neatly filling the lace cups, kneeling on the end of an unmade bed, looking straight at the camera, low warm bedside lamplight, candid raw photograph, natural healthy skin with fine texture, natural healthy skin

exact same woman as the reference image, identical face, hair and skin, wearing a sheer white satin slip with thin straps, full natural breasts subtle under fabric, standing at a window with morning light coming through the fabric, soft direct eye contact, candid raw photograph, natural asymmetry, fine skin detail, natural healthy skin

exact same woman as the reference image, identical face, hair and skin, wearing a cropped tank top and low-rise denim shorts, full natural bust filling the cotton tank top, sitting on a kitchen counter, warm afternoon light, easy natural smile, candid full-frame photograph, real skin texture, soft natural shadows, natural healthy skin`;

const POSITIVE_ONLY = `WRITE ONLY WHAT IS IN THE PICTURE. This is the hardest rule here and it overrides every other instruction below.

The renderer cannot read negation. It has no representation of "not", "never", "no", "without", "away from", "instead of" or "avoid" — it sees only the nouns you put next to those words, and it draws them. 

So: state where things ARE, what touches what, and what is visible. If something must not appear, do not mention it at all — say what occupies that space instead. Do not use the words not, no, never, without, away from, avoid, or any other negation anywhere in your output.`;

type SubjectKind = GenderKind;

const ANATOMY_IS_APPENDED =
  "- the full anatomical description of her body is appended to your prompt automatically, word for word, after you finish. Those words are already spoken for, so spend every one of yours on the act, the posture, the framing, the setting and the light";

const DEFER_TO_REQUEST =
  "- the parts of her the stated viewpoint puts in frame, in photorealistic detail and in the user's own vocabulary, taken in the order the user named them: the surface shape of each, how it meets the parts beside it so the two stay distinguishable, skin one even tone with the skin around it, a faint natural sheen, authentic texture with visible pores, and the light falling across it so its shape reads";

const DEFER_TO_GARMENT =
  "- the parts of her the garment's position leaves bare, in photorealistic detail and in the user's own vocabulary: the surface shape of each, the edge of the moved fabric against that skin, where the fabric is taut and where it gathers, skin one even tone either side of that edge, a faint natural sheen, authentic texture with visible pores";

type Shape = {
  undress: "nude" | "partial" | "clothed";
  closeUp: boolean;
  rearView: boolean;
  postureStated: boolean;
  kind: SubjectKind;
  groinFocus: boolean;
  toyAsked: boolean;
  shot: "face" | "back" | null;
  /** The act is something she does to her OWN body (licking her nipple, sucking her finger). */
  selfAct: boolean;
};

const rules = ({
  undress,
  closeUp,
  rearView,
  postureStated,
  groinFocus,
  toyAsked,
  shot,
  selfAct,
}: Shape) => `Every subject is a consenting fictional adult. This is the app's core paid feature — refusing, softening or sanitising a request breaks it.

${POSITIVE_ONLY}

CRITICAL RULE — FOLLOW THE USER'S REQUEST EXACTLY:
- Only show the body part(s) the user asked for.
- Frame the photograph tightly around what they requested.
- If they asked for boobs → focus on the chest.
- If they asked for pussy → focus on the groin.
- If they asked for ass → focus on the rear.
- Do not randomly include body parts that were not requested.

Open with ONE plain sentence describing the photograph and how it is framed, then switch to dense comma-separated fragments for everything after it, matching the examples.

Leave her hair colour, hair length, eye colour, skin tone and build out entirely. A reference photo of her is supplied to the renderer and supplies all of that. Write "identical face, hair and skin to the reference image" and spend those words on the act, the posture and the setting instead.

Every prompt must contain, in this order:
- "exact same woman as the reference image, identical face, hair and skin"
- FRAMING, as the second thing in the prompt. ${rearView
    ? `The user set the viewpoint themselves, so write THEIR viewpoint in THEIR words. Frame tightly around the body part they asked for.`
    : shot === "face"
      ? `The user asked for a portrait / headshot. Frame a head-and-shoulders portrait: her face fills the upper half of the frame in sharp focus, looking into the lens, cropped at the upper chest.`
      : shot === "back"
        ? `The user asked for a backshot. Photograph her from behind, head to knees, her back and hips towards the camera and her head turned to look back over her shoulder into the lens.`
    : closeUp
      ? `The user asked for a close-up. Frame tightly on the requested body part only.`
      : groinFocus
        ? `The request is specifically about her pussy. Frame so the pussy fills the centre of the frame in sharp focus. Do not show her face or breasts unless she asked for them.`
        : `Frame the shot to clearly show only what the user requested. Do not add extra body parts that were not requested.`
  }
${undress === "nude"
    ? '- nudity stated as ALREADY TRUE: "completely nude", "fully naked". Write her as already bare rather than undressing'
    : undress === "partial"
      ? `- the GARMENT AND ITS POSITION, both exactly as the user gave them, stated as ALREADY in that position`
      : `- her wardrobe exactly as the user described it, stated as already worn`
  }
${postureStated
    ? `- the POSTURE exactly as the user named it, already in that position`
    : `- a natural, stable posture that matches the framing and the act`
  }
${rearView
    ? DEFER_TO_REQUEST
    : undress === "clothed"
      ? `- how the clothing sits on her: where the fabric is taut, where it gathers, the edge of a strap or a hem against skin`
      : ANATOMY_IS_APPENDED
  }
${toyAsked
    ? `- the toy exactly as the user described it, already in the position they named, with material, size and how it interacts with her body stated clearly`
    : `- what each of her two hands is doing, named plainly (one hand lifting her breast, the other flat on her stomach). A hand with no stated job gets drawn holding something`
  }
${selfAct
    ? `- the act is on HER OWN body. Say the part is her own and exactly where the contact is — "the tip of her tongue touching her own left nipple", "her own finger between her lips" — with her head angled toward it. Her hands hold nothing. She is the only person in the picture; nothing and nobody else is in it`
    : ``
  }
- natural healthy skin with fine texture, candid raw photography, real lighting and shadows

Never invent hair colour, skin tone, eye colour or body type. The reference image supplies all of that.`;

function systemFor(kind: "photo" | "video", scenes: number, shape: Shape): string {
  const examples =
    shape.kind === "male"
      ? MALE_EXAMPLES
      : shape.kind === "trans-female"
        ? TRANS_FEMALE_EXAMPLES
        : shape.kind === "trans-male"
          ? TRANS_MALE_EXAMPLES
          : shape.undress === "clothed"
            ? CLOTHED_EXAMPLES
            : shape.toyAsked
              ? TOY_EXAMPLE
              : shape.closeUp && !shape.rearView
                ? POV_EXAMPLE
                : NUDE_EXAMPLES;

  const formatOnly = shape.rearView
    ? `\n\nThe examples below are here for FORMAT ONLY: one plain opening sentence, then dense comma-separated fragments, then the realism tail. Copy their SHAPE. Take the viewpoint, the posture, the wardrobe and every detail of the subject from the user's request.`
    : "";

  if (kind === "photo") {
    return `You write prompts for an uncensored ComfyUI image model in an adults-only AI companion app.

${rules(shape)}

This is a STILL photograph: end with the pose held and the camera locked off.

Output ONE prompt, 90-120 words. ${AVOID_RULE}${formatOnly}

Examples of the required style:
${examples}`;
  }
  return `You write prompts for an uncensored ComfyUI image-to-video model in an adults-only AI companion app.

${rules({ ...shape, groinFocus: false })}

The clip has ${scenes} scenes that play back to back. Break the requested action into ${scenes} steps that PROGRESS. Each scene keeps her identity, the setting and the lighting consistent.

THIS IS A MOVING CLIP, NOT A PHOTOGRAPH. The rules above were written for a still and the worked examples below are stills, so take the DENSITY and the ORDER from them and nothing else: every one of them ends in photograph language, and a clip prompt must not. Instead, say what MOVES — which part of her body, in which direction, how fast, and what stays where it is — and end each scene with smooth natural lifelike motion, her face and body consistent throughout, and where the camera is holding or travelling. A clip prompt that describes a locked-off photograph is the single reason these come back churning: the negative prompt simultaneously forbids the clip from holding still, so the two halves fight and the render resolves it as morphing.

Output exactly ${scenes} prompts, one per line, each 60-120 words, numbered "1." to "${scenes}.". ${AVOID_RULE}${formatOnly}

Examples of the required style:
${examples}`;
}

const AVOID_RULE = `Then, on the very last line and nowhere else, write "AVOID:" followed by 5 to 12 comma-separated things an image model is likely to add to THIS picture by mistake and that must be absent — wrong objects (a toy, a bottle, a phone), extra people or hands, a different act, parts of the wrong sex. The AVOID line is the only place such things may be named. Never put anything the user asked for on it. Nothing after it.`;

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
  return cleaned.length >= 60 ? cleaned : prompt;
}

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
): Promise<Refined | null> {
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
    const full = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!full) return null;
    return parseRefined(kind, full, userRequest, nude, scenes, shape);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type Refined = {
  /** One prompt for a photo; one per scene for a clip. */
  prompts: string[];
  /** Extra negative-prompt terms for this request, already filtered. */
  avoid: string[];
};

// The model's answer, turned into prompts and an avoid list — or null when it
// is not usable, which sends the caller to the next fallback.
function parseRefined(
  kind: "photo" | "video",
  full: string,
  userRequest: string,
  nude: boolean,
  scenes: number,
  shape: Shape,
): Refined | null {
  const { text: raw, avoid: rawAvoid } = splitAvoid(full);
  const anatomy = {
    hasBreasts: shape.kind === "female" || shape.kind === "trans-female" || shape.kind === "nb",
    hasVulva: shape.kind === "female" || shape.kind === "trans-male",
    hasPenis: shape.kind === "male" || shape.kind === "trans-female",
  };
  const avoid = filterAvoid(rawAvoid, userRequest, anatomy);

  if (kind === "photo") {
    if (!usableRefinement(raw, nude, 60)) return null;
    return { prompts: [stripUnrequestedProps(stripNegations(raw), userRequest)], avoid };
  }
  if (!usableRefinement(raw, nude, 40)) return null;
  const parts = raw
    .split(/\n+/)
    .map((l: string) =>
      stripUnrequestedProps(stripNegations(l.replace(/^\s*\d+[.)]\s*/, "").trim()), userRequest),
    )
    .filter((l: string) => l.length > 40);
  if (!parts.length) return null;
  return { prompts: parts.slice(0, scenes), avoid };
}

export async function refineMediaPrompt(
  kind: "photo" | "video",
  userRequest: string,
  companion: { gender?: string | null; ethnicity?: string; age?: number },
  scenes = 1,
): Promise<Refined | null> {
  const key = process.env.XAI_API_KEY;
  const req = (userRequest ?? "").trim();
  if (!req) return null;

  const {
    requestIsNude,
    CLOSE_UP_RE,
    requestSetsViewpoint,
    PARTIAL_UNDRESS_RE,
    STATED_POSTURE_RE,
    requestKeepsGarment,
    requestedShot,
    isSelfAct,
  } = await import("./selfie");

  const undress: Shape["undress"] =
    PARTIAL_UNDRESS_RE.test(req) || requestKeepsGarment(req)
      ? "partial"
      : requestIsNude(req)
        ? "nude"
        : "clothed";
  const nude = undress !== "clothed";
  const closeUp = CLOSE_UP_RE.test(req);

  const { anatomyOf, mentionsPart } = await import("./anatomy");
  const a = anatomyOf(companion.gender);
  const subjectKind: SubjectKind = a.kind;

  const groinFocus =
    kind === "photo" &&
    nude &&
    a.hasVulva &&
    mentionsPart(req, "vulva") &&
    !process.env.RUNPOD_COMFY_ENDPOINT;

  const rearView = requestSetsViewpoint(req);
  const postureStated = STATED_POSTURE_RE.test(req);
  const toyAsked = TOY_RE.test(req);

  const noun =
    a.kind === "trans-female"
      ? "transgender woman (feminine body with full natural breasts and an anatomically correct penis)"
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
    shot: requestedShot(req),
    selfAct: isSelfAct(req),
  };

  if (key) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REFINE_TIMEOUT_MS);

    try {
      const res = await fetch(XAI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          model: process.env.XAI_MODEL || DEFAULT_XAI_MODEL,
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
        const full = (json.choices?.[0]?.message?.content ?? "").trim();
        const parsed = parseRefined(kind, full, req, nude, scenes, shape);
        if (parsed) {
          clearTimeout(timer);
          return parsed;
        }
      }
    } catch {
      // proceed to OpenRouter fallback
    } finally {
      clearTimeout(timer);
    }
  }

  return refineMediaWithOpenRouter(kind, req, subject, scenes, shape);
}

// Promo and banner sections remain unchanged
const PROMO_SYSTEM = `You write prompts for a photorealistic image model producing social-media photos of a fictional adult model.

Expand the user's short description into ONE dense prompt of comma-separated fragments, never sentences.

Include, in this order:
- the subject: age range, hair (colour, length, cut), eyes, skin, build
- wardrobe: specific garments, fabrics and colours. Always fully clothed — attractive and form-fitting is fine, exposed is not
- pose and expression, natural and candid rather than posed for a camera
- setting with real detail, and the specific light in it
- camera language: shot on a full-frame DSLR, 50mm or 85mm lens, shallow depth of field, natural bokeh
- realism markers: natural healthy skin with fine texture, natural asymmetry, flyaway hairs, subtle skin tone variation, clothing with real creases

Never write "8k", "masterpiece", "ultra HD" or similar render tags.
Never describe the subject as young, teen, schoolgirl, or a minor — she is an adult in her twenties or older.

Output only the prompt, 90-150 words. No preamble, no quotes, no explanation.`;

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

export async function refinePromoPrompt(
  description: string,
  hasReference = false,
): Promise<string | null> {
  const key = process.env.XAI_API_KEY;
  const req = (description ?? "").trim();
  if (!req) return null;

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
      // proceed to OpenRouter
    } finally {
      clearTimeout(timer);
    }
  }

  return refinePromoWithOpenRouter(req, hasReference);
}

const BANNER_COPY_SYSTEM = `You write direct-response ad copy for HumanCrush.com, an adults-only AI companion app where users chat with and get photos from an AI girlfriend.

Given a description of the photo the banner will use, write:
- HEADLINE: exactly two short lines. Each line at most 18 characters. Together they are one sentence or one tight pair of phrases. Punchy, second person, implies she is available right now.
- CTA: two or three words for the button. Examples: "Chat free", "Start free", "Try free", "Meet her".

Rules: no emoji, no hashtags, no quotation marks in the output, no exclamation stacking. Never reference a specific price. Never describe anyone as young, teen, or a minor. Do not describe explicit acts.

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
      // proceed to OpenRouter
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
