// Centralized AI providers (post-Lovable migration).
//   Chat text  -> OpenRouter  (NSFW-permitting models; set OPENROUTER_MODEL)
//   Images     -> Replicate   (NSFW-capable) when REPLICATE_API_TOKEN is set,
//                 else OpenAI (SFW only — blocks nudity)
//   Voice/TTS  -> OpenAI      (voice notes)
// Keys are server-only env vars — never import.meta.env, never sent to the client.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const REPLICATE_URL = "https://api.replicate.com/v1/predictions";

// nsfw-flux-dev (aisha-ai-official) — photorealistic, uncensored. Override with
// REPLICATE_IMAGE_VERSION to swap models without a code change.
const DEFAULT_IMAGE_VERSION = "fb4f086702d6a301ca32c170d926239324a7b7b2f0afc3d232a9c4be382dc3fa";

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
      "HTTP-Referer": process.env.PUBLIC_SITE_URL || "https://humancrush.com",
      "X-Title": "HumanCrush.com",
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
  // Don't send response_format — gpt-image-1 rejects it, and some accounts
  // reject it for dall-e too. Handle whichever shape comes back (b64 or url).
  const res = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, size, n: 1 }),
  });
  if (!res.ok) throw new Error(`${model}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const item = json.data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) {
    // dall-e returns a temporary URL — fetch it and inline so we can store it.
    const img = await fetch(item.url);
    if (!img.ok) throw new Error(`${model}: could not fetch generated image`);
    const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
    return `data:image/png;base64,${b64}`;
  }
  throw new Error(`${model}: no image returned`);
}

// Replicate (NSFW-capable). Uses Prefer: wait so the prediction resolves in one
// request; downloads the result and inlines it as a data URL.
async function generateImageReplicate(prompt: string): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN!;
  const version = process.env.REPLICATE_IMAGE_VERSION || DEFAULT_IMAGE_VERSION;
  const res = await fetch(REPLICATE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ version, input: { prompt, width: 768, height: 1024 } }),
  });
  if (!res.ok) throw new Error(`Image error: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  if (json.status !== "succeeded") {
    throw new Error(`Image error: ${json.status}${json.error ? ` ${json.error}` : ""}`);
  }
  const out = Array.isArray(json.output) ? json.output[0] : json.output;
  if (!out) throw new Error("No image returned");
  const img = await fetch(out);
  if (!img.ok) throw new Error("Could not fetch generated image");
  const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
  return `data:image/png;base64,${b64}`;
}

// Returns a data: URL (base64 PNG). Prefers Replicate (NSFW) when configured;
// otherwise OpenAI (SFW only — gpt-image-1 then dall-e-3).
export async function generateImage(prompt: string, opts?: { size?: string }): Promise<string> {
  if (process.env.REPLICATE_API_TOKEN) return generateImageReplicate(prompt);

  const key = process.env.OPENAI_API_KEY;
  if (!key)
    throw new Error("Image generation not configured (no REPLICATE_API_TOKEN / OPENAI_API_KEY)");
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
        "You are a real girlfriend recording a private voice note just for the person you adore. " +
        "Sound human and natural — warm, soft, affectionate, and a little playful. Vary your pace and " +
        "intonation like real speech, add gentle breathiness and a smile in your voice. Never sound " +
        "robotic, flat, or like a narrator reading text. Speak intimately, as if leaning close to their ear.",
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Voice error: ${res.status} ${t.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
