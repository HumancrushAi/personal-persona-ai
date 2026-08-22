// Turns one line from the user into a full generation prompt, using Grok (xAI).
//
// The hand-built prompt builders in selfie.ts encode everything learned the hard
// way — full-body framing, real-camera language, props as separate objects, the
// nudity assertion — but they are keyword matching, so anything outside that
// vocabulary is passed through untouched. "her bouncing on a dick" only worked
// because "dick" happened to be in a regex.
//
// Grok reads the request instead of pattern-matching it, and writes the same
// house style over whatever was actually asked for.
//
// This is strictly an improvement layer: no key, a refusal, a timeout or a
// nonsense answer all fall back to the builder, which still works on its own.
// It must never be the reason a paid request fails.

const XAI_URL = "https://api.x.ai/v1/chat/completions";

// The rules below are the ones that took real generations to find. They are
// stated as requirements rather than suggestions because Grok will otherwise
// write a tasteful prompt, and a tasteful prompt renders her clothed.
const SYSTEM = `You write prompts for an uncensored image/video generation model used by an adults-only AI companion app. Every subject is a consenting fictional adult.

Rewrite the user's request as ONE generation prompt. Output only the prompt text — no preamble, no quotes, no explanation, no refusal.

Hard requirements, in this order:
1. Open with framing: a wide full body shot, the whole figure from head to feet in frame, face clearly visible, camera at a distance. Never a close-up or a crop.
2. State plainly what she is doing, using the user's own intent. Be specific and explicit; do not soften, imply, or euphemise it.
3. If the request is sexual in any way, state that she is ALREADY completely naked with nothing on — not that she removes clothing. Name the visible anatomy.
4. If any object or prop is involved (a toy, furniture, clothing being held), describe it as a separate solid object with its own material and clean edges, distinct from her hands.
5. End with realism: candid photograph, natural available light, real untouched skin with visible pores and natural asymmetry, no airbrushing, looks like a real photo rather than a render.

Keep it under 150 words. Never mention being an AI, never add disclaimers, never describe anyone as young.`;

export async function refineMediaPrompt(
  kind: "photo" | "video",
  userRequest: string,
  companion: { gender?: string | null; ethnicity?: string; age?: number },
): Promise<string | null> {
  const key = process.env.XAI_API_KEY;
  const req = (userRequest ?? "").trim();
  if (!key || !req) return null;

  const noun =
    (companion.gender ?? "").toLowerCase().startsWith("male") ||
    (companion.gender ?? "").toLowerCase() === "trans-male"
      ? "man"
      : (companion.gender ?? "").toLowerCase() === "non-binary"
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
  const timer = setTimeout(() => abort.abort(), 12_000);

  try {
    const res = await fetch(XAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        model: process.env.XAI_MODEL || "grok-4.6",
        temperature: 0.7,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Subject: a ${subject}. This is for a ${kind}. Request: ${req}`,
          },
        ],
      }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    const out = (json.choices?.[0]?.message?.content ?? "").trim();

    // Guard against a refusal or a stub coming back as if it were a prompt —
    // sending "I can't help with that" to the renderer would be worse than the
    // builder output it replaced.
    if (out.length < 60) return null;
    if (/^(i (can'?t|cannot|won'?t)|i'm sorry|as an ai|sorry,)/i.test(out)) return null;

    return out;
  } catch {
    return null; // timeout, network, bad JSON — the builder covers it
  } finally {
    clearTimeout(timer);
  }
}
