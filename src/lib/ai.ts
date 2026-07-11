// Centralized AI providers (post-Lovable migration).
//   Chat text  -> OpenRouter  (NSFW-permitting models; set OPENROUTER_MODEL)
//   Images     -> OpenAI      (tasteful/SFW selfies + character art)
//   Voice/TTS  -> OpenAI      (voice notes)
// Keys are server-only env vars — never import.meta.env, never sent to the client.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

// Uncensored default tuned for intimate girlfriend RP. Override with OPENROUTER_MODEL.
// Alternatives: anthracite-org/magnum-v4-72b (softer/warmer), sao10k/l3-lunaris-8b (cheap).
const DEFAULT_CHAT_MODEL = "sao10k/l3.1-euryale-70b";

export async function chatComplete(
  messages: { role: string; content: string }[],
  opts?: { maxTokens?: number },
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Chat AI not configured (OPENROUTER_API_KEY missing)");
  const model = process.env.OPENROUTER_MODEL || DEFAULT_CHAT_MODEL;

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // Recommended attribution headers for OpenRouter (optional).
      "HTTP-Referer": process.env.PUBLIC_SITE_URL || "https://humancrush.ai",
      "X-Title": "HumanCrush.ai",
    },
    body: JSON.stringify({
      model,
      messages,
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI error: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

async function tryImageModel(
  key: string,
  model: string,
  prompt: string,
  size: string,
): Promise<string> {
  const body: Record<string, unknown> = { model, prompt, size, n: 1 };
  // gpt-image-1 always returns b64_json; dall-e-* must be asked for it explicitly.
  if (model.startsWith("dall-e")) body.response_format = "b64_json";

  const res = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${model}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${model}: no image returned`);
  return `data:image/png;base64,${b64}`;
}

// Returns a data: URL (base64 PNG). If OPENAI_IMAGE_MODEL isn't pinned, try
// gpt-image-1 (needs OpenAI org verification) then fall back to dall-e-3 so
// selfies never dead-end on an account that isn't verified for gpt-image-1.
export async function generateImage(prompt: string, opts?: { size?: string }): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Image generation not configured (OPENAI_API_KEY missing)");
  const size = opts?.size || "1024x1024";
  const models = process.env.OPENAI_IMAGE_MODEL
    ? [process.env.OPENAI_IMAGE_MODEL]
    : ["gpt-image-1", "dall-e-3"];

  let lastErr = "";
  for (const model of models) {
    try {
      return await tryImageModel(key, model, prompt, size);
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
    }
  }
  throw new Error(`Image error: ${lastErr}`);
}

// Returns an audio buffer (mp3).
export async function textToSpeech(text: string, voice: string): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Voice not configured (OPENAI_API_KEY missing)");

  const res = await fetch(OPENAI_TTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      input: text,
      voice,
      response_format: "mp3",
      instructions:
        "Speak warmly, intimately, like a girlfriend leaving a private voice note. Slightly low, slow, breathy.",
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Voice error: ${res.status} ${t.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
