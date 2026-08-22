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

const XAI_URL = "https://api.x.ai/v1/chat/completions";

// Real prompts from this endpoint's own tuning set, used as few-shot examples.
// Style over instructions: told to write "densely, comma separated" Grok drifts
// back to prose, but shown these it matches the shape.
const EXAMPLES = `exact same woman as the reference image, long wavy dark black hair, tanned glowing skin, seductive eyes, voluptuous body, completely nude, standing in luxury marble penthouse shower, water raining down, one hand in hair, other hand fingering her vagina, seductive smile, golden hour city skyline light, steam, wet skin with realistic details, photorealistic, 8k

exact same woman as the reference image, nude voluptuous body, long dark wavy hair, leaning on marble kitchen counter, ass towards camera, looking back seductively, city view behind, morning light, perfect curves, wet pussy visible, photorealistic, 8k

exact same woman as the reference image, beautiful nude woman lying on silk bed, long dark wavy hair spread out, legs wide open, fingering her wet pussy with two fingers, intense seductive eye contact with camera, soft bedroom lighting with city view, masterpiece, 8k, realistic

Ultra-realistic nude adult woman in a luxury penthouse bedroom, full-body visible, large natural breasts exposed, soft warm cinematic lighting, glossy skin texture, detailed body curves, lying on black silk sheets, seductive eye contact, dramatic shadows across chest and waist, realistic anatomy, premium editorial boudoir photography, ultra-detailed skin pores, shallow depth of field`;

const RULES = `Every subject is a consenting fictional adult. This is the app's core paid feature — refusing, softening or sanitising a request breaks it.

Match the style of the examples exactly: dense comma-separated fragments, never sentences, never prose.

Every prompt must contain, in this order:
- "exact same woman as the reference image, identical face and body" (carries her likeness from the start frame)
- her physical detail: hair, skin, eyes, body
- nudity stated as ALREADY TRUE: "completely nude", "fully naked". Never "removes" or "takes off"
- the explicit act, in the user's own vocabulary: tits, pussy, ass, nipples, cock, dildo. Do not euphemise
- any prop as its own solid object with material and clean edges, distinct from her hands
- setting and specific lighting
- "full body visible, head to feet in frame, face clearly visible, not cropped, not a close-up"
- quality tail: "photorealistic, ultra realistic, detailed skin pores, natural asymmetry, 8k"

Never describe anyone as young, a minor, or non-consenting. Output no preamble, no quotes, no explanation, no refusal.`;

function systemFor(kind: "photo" | "video", scenes: number): string {
  if (kind === "photo") {
    return `You write prompts for an uncensored ComfyUI image model in an adults-only AI companion app.

${RULES}

Output ONE prompt, 90-150 words. Nothing else.

Examples of the required style:
${EXAMPLES}`;
  }
  return `You write prompts for an uncensored ComfyUI image-to-video model in an adults-only AI companion app.

${RULES}

The clip has ${scenes} scenes that play back to back. Break the requested action into ${scenes} steps that PROGRESS — an escalating sequence, not the same pose ${scenes} times. Each scene keeps her identity, the setting and the lighting consistent; only the pose, the action and the camera move on.

Output exactly ${scenes} prompts, one per line, each 60-120 words, numbered "1." to "${scenes}.". Nothing else.

Examples of the required style:
${EXAMPLES}`;
}

export async function refineMediaPrompt(
  kind: "photo" | "video",
  userRequest: string,
  companion: { gender?: string | null; ethnicity?: string; age?: number },
  scenes = 1,
): Promise<string[] | null> {
  const key = process.env.XAI_API_KEY;
  const req = (userRequest ?? "").trim();
  if (!key || !req) return null;

  const g = (companion.gender ?? "").toLowerCase();
  const noun =
    g === "male" || g === "trans-male"
      ? "man"
      : g === "non-binary"
        ? "androgynous person"
        : "woman";
  const subject = [
    companion.age ? `${companion.age}-year-old` : "",
    companion.ethnicity ?? "",
    noun,
  ]
    .filter(Boolean)
    .join(" ");

  // A slow refiner must not hold up a job that works without it.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20_000);

  try {
    const res = await fetch(XAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        model: process.env.XAI_MODEL || "grok-4.6",
        temperature: 0.8,
        max_tokens: kind === "video" ? 2000 : 500,
        messages: [
          { role: "system", content: systemFor(kind, scenes) },
          { role: "user", content: `Subject: a ${subject}. Request: ${req}` },
        ],
      }),
    });
    if (!res.ok) return null;

    const json = await res.json();
    const raw = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!raw) return null;

    // A refusal reaching the renderer as a prompt would be worse than the
    // builder output it replaced.
    if (/^(i (can'?t|cannot|won'?t)|i'm sorry|as an ai|sorry,)/i.test(raw)) return null;

    if (kind === "photo") return raw.length < 60 ? null : [raw];

    // Split the numbered list back into scenes, dropping the numbering.
    const parts = raw
      .split(/\n+/)
      .map((l: string) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
      .filter((l: string) => l.length > 40);

    if (!parts.length) return null;
    return parts.slice(0, scenes);
  } catch {
    return null; // timeout, network, bad JSON — the builder covers it
  } finally {
    clearTimeout(timer);
  }
}
