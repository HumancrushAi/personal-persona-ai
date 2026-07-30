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

// Pony Realism (charlesmccarthy/pony-sdxl, ponyRealism21 checkpoint) renders
// correct anatomy for every gender and follows explicit booru pose tags
// reliably, so male, female, AND non-binary companions all use it — the
// `1boy`/`1girl` tag plus opposite-sex negatives lock the gender; non-binary
// uses neutral negatives. Flux (nsfw-flux-dev) can't render male genitalia,
// ignores negative prompts, and won't follow explicit pose requests, so it's
// no longer a default — pin it per-gender via REPLICATE_IMAGE_VERSION /
// REPLICATE_IMAGE_VERSION_MALE only if ever needed.
const PONY_IMAGE_VERSION = "b070dedae81324788c3c933a5d9e1270093dc74636214b9815dae044b4b3a58a";

const PONY_INPUT = {
  model: "ponyRealism21.safetensors",
  width: 768,
  height: 1024,
  steps: 24,
  cfg_scale: 6,
  scheduler: "DPM++ 2M SDE Karras",
  prepend_preprompt: true,
};

// Picks the image model + Replicate input for a companion's gender. `input`
// holds the model-specific fields (everything except prompt/negative_prompt),
// which differ between Flux and Pony.
export function imageModelForGender(gender?: string | null): {
  version: string;
  negativePrompt?: string;
  input: Record<string, unknown>;
} {
  const g = (gender ?? "").toLowerCase();
  const version = process.env.REPLICATE_IMAGE_VERSION_MALE || PONY_IMAGE_VERSION;

  if (g === "male" || g === "trans-male") {
    return {
      version,
      // `1boy` + these negatives lock the gender; anatomy-quality terms keep
      // the genitals well-formed.
      negativePrompt:
        "1girl, female, multiple girls, breasts, nipples, pussy, vagina, vulva, woman, feminine body, anime, cartoon, 2d, 3d, sketch, monochrome, deformed penis, malformed genitals, mutated genitals, ambiguous genitalia, extra penis, bad anatomy, censored, mosaic, watermark, text, worst quality, low quality",
      input: PONY_INPUT,
    };
  }
  if (g === "non-binary") {
    // Pony (like male/female) so explicit pose requests actually render.
    // Neutral negatives — don't hard-negate either sex for an androgynous body.
    // Pin Flux instead via REPLICATE_IMAGE_VERSION if ever needed.
    return {
      version: process.env.REPLICATE_IMAGE_VERSION || PONY_IMAGE_VERSION,
      negativePrompt:
        "anime, cartoon, 2d, 3d, sketch, monochrome, deformed, malformed genitals, extra limbs, bad anatomy, censored, mosaic, watermark, text, worst quality, low quality",
      input: PONY_INPUT,
    };
  }
  // female / trans-female / unset default
  return {
    version,
    negativePrompt:
      "1boy, male, man, penis, testicles, male body, anime, cartoon, 2d, 3d, sketch, monochrome, deformed, malformed genitals, extra limbs, bad anatomy, censored, mosaic, watermark, text, worst quality, low quality",
    input: PONY_INPUT,
  };
}

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// cdingram/face-swap — swaps a source face onto a target image. Used to lock a
// companion's face to their canonical profile picture across every selfie.
export const FACE_SWAP_VERSION = "d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111";

// Read a prediction's current status directly. Lets the app finalize a media job
// by polling Replicate instead of depending on the webhook callback landing.
export async function getReplicatePrediction(
  id: string,
): Promise<{ status: string; output?: any; error?: any; version?: string }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");
  const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Replicate get error: ${res.status}`);
  const json = await res.json();
  return { status: json.status, output: json.output, error: json.error, version: json.version };
}

// Synchronous face swap (locks the companion's face onto a generated body). Used
// by the reconcile poll, which finalizes in one shot rather than chaining a
// second async prediction. Returns the swapped image URL.
export async function faceSwapSync(faceUrl: string, inputUrl: string): Promise<string> {
  return runReplicateSync(FACE_SWAP_VERSION, { swap_image: faceUrl, input_image: inputUrl });
}

// Official Replicate models (owner/name) have a stable, versionless API — call
// them via the models endpoint so there's no version hash to go stale. Used for
// video generation (e.g. wan-video/wan-2.5-i2v-fast).
export async function triggerReplicateModel(
  model: string, // "owner/name"
  input: Record<string, unknown>,
  webhookUrl?: string,
): Promise<{ id: string; status: string; output?: any }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");

  const body: any = { input };
  if (webhookUrl) {
    body.webhook = webhookUrl;
    body.webhook_events_filter = ["start", "completed"];
  }

  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(!webhookUrl ? { Prefer: "wait" } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Replicate video error: ${res.status} ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  return { id: json.id, status: json.status, output: json.output };
}

export async function triggerReplicate(
  version: string,
  input: Record<string, unknown>,
  webhookUrl?: string,
): Promise<{ id: string; status: string; output?: any }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");

  const body: any = { version, input };
  if (webhookUrl) {
    body.webhook = webhookUrl;
    body.webhook_events_filter = ["start", "completed"];
  }

  const res = await fetch(REPLICATE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(!webhookUrl ? { Prefer: "wait" } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Replicate error: ${res.status} ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  return {
    id: json.id,
    status: json.status,
    output: json.output,
  };
}

async function runReplicateSync(version: string, input: Record<string, unknown>): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN!;
  const res = await fetch(REPLICATE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ version, input }),
  });
  if (!res.ok) throw new Error(`Image error: ${res.status} ${(await res.text()).slice(0, 200)}`);
  let json = await res.json();
  const getUrl = json.urls?.get;

  let attempts = 0;
  while (json.status !== "succeeded" && getUrl && attempts < 80) {
    if (json.status === "failed" || json.status === "canceled") {
      throw new Error(`Image error: ${json.status}${json.error ? ` ${json.error}` : ""}`);
    }
    await sleep(3000);
    attempts++;
    const pollRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (pollRes.ok) json = await pollRes.json();
  }

  if (json.status !== "succeeded") {
    throw new Error(`Image error: ${json.status}${json.error ? ` ${json.error}` : ""}`);
  }
  const out = Array.isArray(json.output) ? json.output[0] : json.output;
  if (!out) throw new Error("No image returned");
  return out;
}

// Returns a data: URL (base64 PNG) or trigger status. Prefers Replicate (NSFW) when configured;
// otherwise OpenAI (SFW only — gpt-image-1 then dall-e-3).
// With webhookUrl set the Replicate path returns a { replicateId } handle instead
// of waiting; without it callers always get the finished image string.
type GenerateImageOpts = {
  size?: string;
  gender?: string | null;
  faceUrl?: string | null;
};
export async function generateImage(
  prompt: string,
  opts?: GenerateImageOpts & { webhookUrl?: undefined },
): Promise<string>;
export async function generateImage(
  prompt: string,
  opts: GenerateImageOpts & { webhookUrl: string },
): Promise<string | { replicateId: string; status: string }>;
export async function generateImage(
  prompt: string,
  opts?: GenerateImageOpts & { webhookUrl?: string },
): Promise<string | { replicateId: string; status: string }> {
  if (process.env.REPLICATE_API_TOKEN) {
    const model = imageModelForGender(opts?.gender);
    const input: Record<string, unknown> = { prompt, ...model.input };
    if (model.negativePrompt) input.negative_prompt = model.negativePrompt;

    if (opts?.webhookUrl) {
      // Async webhook mode
      const prediction = await triggerReplicate(model.version, input, opts.webhookUrl);
      return { replicateId: prediction.id, status: prediction.status };
    } else {
      // Sync fallback mode (e.g. for Admin avatar generator)
      let url = await runReplicateSync(model.version, input);
      if (opts?.faceUrl && /^(https?:|data:)/.test(opts.faceUrl)) {
        try {
          url = await runReplicateSync(FACE_SWAP_VERSION, { swap_image: opts.faceUrl, input_image: url });
        } catch {
          /* keep un-swapped */
        }
      }
      const img = await fetch(url);
      if (!img.ok) throw new Error("Could not fetch generated image");
      const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
      return `data:image/png;base64,${b64}`;
    }
  }

  // Async job pipeline (selfies/videos) only works with Replicate — its webhook
  // reports completion. Reaching here means Replicate is unconfigured; the
  // OpenAI fallback is a synchronous SFW model that also can't fulfill the
  // explicit prompt. Fail loudly so the job is marked failed and the user is
  // refunded, instead of silently hanging or returning a censored image.
  if (opts?.webhookUrl)
    throw new Error(
      "Image generation unavailable: REPLICATE_API_TOKEN is required for photo/video requests.",
    );

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
