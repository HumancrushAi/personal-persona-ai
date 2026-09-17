// Centralized AI providers.
//   Chat text  -> OpenRouter  (NSFW-permitting models; set OPENROUTER_MODEL)
//   Voice/TTS  -> OpenAI      (voice notes)
//
// Images and video are NOT here: they run on RunPod (see runpod.ts, and
// media.functions.ts for the job pipeline). Replicate has been removed entirely
// along with its credentials.
// Keys are server-only env vars — never import.meta.env, never sent to the client.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

// Uncensored default tuned for intimate girlfriend RP. Override with OPENROUTER_MODEL.
// Alternatives: anthracite-org/magnum-v4-72b (softer/warmer), sao10k/l3-lunaris-8b (cheap).
const DEFAULT_CHAT_MODEL = "sao10k/l3.1-euryale-70b";

// Strip model artifacts (leaked special tokens, stray tags, junk chars) so
// replies never show things like <|reserved_special_token_0|> or <std/plane>.
function sanitizeReply(s: string): string {
  return s
    .replace(/<\|[^|]*\|>/g, "") // <|reserved_special_token_0|>
    .replace(/<\/?(std|p|s|e|reserved)[^>]*>/gi, "") // <std/plane>, <p ...>
    .replace(/<[a-z/][a-z0-9 /_-]{0,30}>/gi, "") // stray html-ish tags
    .replace(/�/g, "") // replacement char
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function chatComplete(
  messages: { role: string; content: string }[],
  opts?: { maxTokens?: number; temperature?: number },
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Chat AI not configured (OPENROUTER_API_KEY missing)");
  // The AI Config tab can pick the model without a redeploy; the env var and
  // the built-in default are the fallbacks, in that order.
  const { getChatModelOverride } = await import("./app-settings.server");
  const model =
    (await getChatModelOverride()) || process.env.OPENROUTER_MODEL || DEFAULT_CHAT_MODEL;

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
      temperature: opts?.temperature ?? 0.9,
      frequency_penalty: 0.4,
      presence_penalty: 0.3,
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI error: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return sanitizeReply(json.choices?.[0]?.message?.content ?? "");
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
