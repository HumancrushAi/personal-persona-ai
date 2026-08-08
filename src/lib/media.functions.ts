import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { applyDeduction, hasEnough } from "./credits";
import { generateImage, textToSpeech, chatComplete } from "./ai";
import { screenUserMessage, BLOCKED_CONTENT } from "./safety";
import { selfiePrompt, kontextSelfiePrompt, checkCrossGenderRequest } from "./selfie";
import { runpodEndpoint, runpodRun } from "./runpod";
import { assertNotSuspended, assertRateLimit } from "./account.server";

const SELFIE_COST = 8;
const VOICE_COST = 3;
const VIDEO_COST = 15;

// Warmer, more natural voices first (alloy is the flattest, so it's last).
const VOICES = ["shimmer", "coral", "sage", "nova", "verse", "alloy"];

// Check the user can afford it BEFORE generating (so we don't call the AI for
// someone who's broke). Returns the current balance to deduct from later.
async function ensureBalance(supabase: any, userId: string, cost: number) {
  const { data: bal } = await supabase
    .from("credit_balances")
    .select("free_messages_remaining, paid_credits")
    .eq("user_id", userId)
    .maybeSingle();
  if (!bal) throw new Error("No balance");
  const free = bal.free_messages_remaining ?? 0;
  const paid = bal.paid_credits ?? 0;
  if (!hasEnough(free, paid, cost)) throw new Error("OUT_OF_CREDITS");
  return { free, paid };
}

// Deduct only AFTER a successful generation, so a refused/failed request
// (e.g. OpenAI rejecting explicit content) never costs the user credits.
async function deductCredits(
  supabase: any,
  userId: string,
  cost: number,
  reason: string,
  free: number,
  paid: number,
) {
  const { free: newFree, paid: newPaid } = applyDeduction(free, paid, cost);
  await supabase
    .from("credit_balances")
    .update({ free_messages_remaining: newFree, paid_credits: newPaid })
    .eq("user_id", userId);
  await supabase.from("credit_ledger").insert({
    user_id: userId,
    delta: -cost,
    reason,
    balance_after: newFree + newPaid,
  });
  return { free: newFree, paid: newPaid };
}

// Undo an upfront media charge when the job never launched. `balance` must be
// the POST-deduction balance returned by deductCredits — refunding from the
// pre-deduction snapshot would over-credit the user.
export async function refundCredits(
  supabase: any,
  userId: string,
  cost: number,
  refundKey: string,
  balance: { free: number; paid: number },
) {
  const newPaid = balance.paid + cost;
  await supabase
    .from("credit_balances")
    .update({ paid_credits: newPaid })
    .eq("user_id", userId);
  await supabase.from("credit_ledger").insert({
    user_id: userId,
    delta: cost,
    reason: "refund_credit",
    balance_after: balance.free + newPaid,
    idempotency_key: refundKey,
  });
}

export const generateSelfie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        prompt: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotSuspended(supabase, userId);
    await assertRateLimit(supabase, "media_jobs", userId, 300, 10);

    const { data: conv } = await supabase
      .from("conversations")
      .select(
        "scenario, user_personalities(nickname, identity, style_backstory, companions(name, ethnicity, age, gender, base_personality, short_bio, image_url))",
      )
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    const userPrompt = data.prompt?.trim();
    // Safety gate on the image request (blocks minors / illegal even for photos).
    const screen = screenUserMessage(userPrompt ?? "");
    if (!screen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${screen.reason}`);

    const p: any = (conv as any).user_personalities;
    const c = p.companions;

    // Cross-gender body part request check
    const crossGenderWarning = checkCrossGenderRequest(c.gender, userPrompt ?? "");
    if (crossGenderWarning) throw new Error(crossGenderWarning);

    const { free, paid } = await ensureBalance(supabase, userId, SELFIE_COST);
    const balance = await deductCredits(supabase, userId, SELFIE_COST, "image_debit", free, paid);

    const jobId = await startImageJob(
      supabase,
      userId,
      data.conversationId,
      {
        name: c.name,
        age: c.age,
        ethnicity: c.ethnicity,
        gender: c.gender,
        short_bio: c.short_bio,
        imageUrl: c.image_url,
      },
      userPrompt,
      p.style_backstory,
      balance,
    );

    return { jobId, status: "pending", balance };
  });

// Create a media_jobs row and fire the async selfie generation. The caller must
// have ALREADY charged SELFIE_COST; on any launch failure this marks the job
// failed, refunds, and rethrows. Shared by the 📷 button (generateSelfie) and
// the in-chat auto-selfie (sendChatMessage).
//
// Provider is picked here, because each one needs a differently-written prompt:
//   RunPod  — FLUX.1 Kontext edits her actual photo, so identity is preserved by
//             the model and no face-swap pass is needed. Needs a hosted photo.
//   Replicate — Pony generates a body from booru tags, then a second prediction
//             swaps her face on. Used when RunPod isn't configured or she has no
//             hosted photo to edit.
export async function startImageJob(
  supabase: any,
  userId: string,
  conversationId: string,
  companion: {
    name: string;
    age: number;
    ethnicity: string;
    gender?: string | null;
    short_bio?: string | null;
    imageUrl?: string | null;
  },
  userRequest: string | undefined,
  styleBackstory: string | null | undefined,
  balance: { free: number; paid: number },
): Promise<string> {
  const runpodImage = runpodEndpoint("image");
  const sourceImage = resolveHostedImage(companion.imageUrl);
  // A RunPod worker fetches the source frame over the network, so only a real
  // http(s) URL works — an inline data: photo stays on the Replicate path.
  const useRunpod = Boolean(runpodImage && sourceImage && /^https?:/i.test(sourceImage));

  const imagePrompt = useRunpod
    ? kontextSelfiePrompt(companion, userRequest, styleBackstory)
    : selfiePrompt(companion, userRequest, styleBackstory);

  // media_jobs is only writable by the service role (users can just read
  // their own rows), so job bookkeeping goes through the admin client.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: job, error: jobErr } = await supabaseAdmin
    .from("media_jobs")
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      kind: "image",
      status: "pending",
      prompt: imagePrompt,
      provider: useRunpod ? "runpod" : "replicate",
      cost: SELFIE_COST,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    await refundCredits(supabase, userId, SELFIE_COST, `refund-nojob-${userId}-${Date.now()}`, balance);
    throw new Error("Failed to create image generation job");
  }

  try {
    if (useRunpod) {
      const result = await runpodRun(
        runpodImage!,
        {
          prompt: imagePrompt,
          negative_prompt:
            "different person, different face, changed identity, deformed, extra limbs, bad anatomy, blurry, cartoon, anime, watermark, text",
          seed: -1,
          num_inference_steps: Number(process.env.RUNPOD_IMAGE_STEPS || "28"),
          guidance: Number(process.env.RUNPOD_IMAGE_GUIDANCE || "2.5"),
          image: sourceImage,
          size: process.env.RUNPOD_IMAGE_SIZE || "1024*1024",
          output_format: "png",
          // This app's whole purpose is explicit; the safety checker would blank
          // the output. screenUserMessage already blocked the illegal requests.
          enable_safety_checker: false,
        },
        webhookFor("runpod"),
      );
      await supabaseAdmin
        .from("media_jobs")
        .update({ replicate_id: result.id, status: "processing" })
        .eq("id", job.id);
    } else {
      const result = await generateImage(imagePrompt, {
        gender: companion.gender,
        faceUrl: companion.imageUrl,
        webhookUrl: webhookFor("replicate"),
      });

      if (typeof result === "object" && "replicateId" in result) {
        await supabaseAdmin
          .from("media_jobs")
          .update({
            replicate_id: result.replicateId,
            status: "processing",
          })
          .eq("id", job.id);
      }
    }
  } catch (err: any) {
    await supabaseAdmin
      .from("media_jobs")
      .update({
        status: "failed",
        error: err.message || "Failed to trigger image generation",
      })
      .eq("id", job.id);

    await refundCredits(supabase, userId, SELFIE_COST, `refund-${job.id}`, balance);
    throw err;
  }

  return job.id;
}

export const requestVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        prompt: z.string().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotSuspended(supabase, userId);
    await assertRateLimit(supabase, "media_jobs", userId, 300, 10);

    const { data: conv } = await supabase
      .from("conversations")
      .select(
        "user_personalities(nickname, style_backstory, companions(name, image_url, sort_order, age, ethnicity, base_personality))",
      )
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    const userPrompt = data.prompt?.trim();
    if (userPrompt) {
      const screen = screenUserMessage(userPrompt);
      if (!screen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${screen.reason}`);
    }

    const p: any = (conv as any).user_personalities;
    const c = p.companions;

    const { free, paid } = await ensureBalance(supabase, userId, VIDEO_COST);
    const balance = await deductCredits(supabase, userId, VIDEO_COST, "video_debit", free, paid);

    const jobId = await startVideoJob(
      supabase,
      userId,
      data.conversationId,
      { name: c.name, imageUrl: c.image_url },
      userPrompt,
      balance,
    );

    return { jobId, status: "pending", balance };
  });

// Build the motion prompt for image-to-video. The companion's appearance comes
// from the start-frame image, so the prompt describes MOTION/ACTION, not looks.
// No forced "SFW" — the safety screen (run by the caller) blocks illegal content;
// clamping to SFW is why asking her to do something explicit never matched.
function videoPromptFor(
  c: { name: string },
  userReq: string | undefined,
): string {
  const action = (userReq ?? "").trim() || "smiling and blowing a kiss to the camera";
  return `The person in the image is ${action}. Smooth natural motion, realistic lifelike movement, steady handheld selfie video, consistent face and body.`;
}

// Turn a companion's stored image into a URL a generation worker can fetch.
// Image-to-image and image-to-video both need a remotely-fetchable source frame:
// http(s) and data: URIs work as-is; a site-relative path is resolved against
// PUBLIC_SITE_URL. A bare bundled filename isn't reachable from outside, so it
// returns null (caller errors + refunds, prompting the admin to upload or
// regenerate a hosted photo).
function resolveHostedImage(imageUrl?: string | null): string | null {
  const u = (imageUrl ?? "").trim();
  if (!u) return null;
  if (/^(https?:|data:)/i.test(u)) return u;
  if (u.startsWith("/")) return `${process.env.PUBLIC_SITE_URL || "https://humancrush.com"}${u}`;
  return null;
}

// Each provider posts completions to its own receiver route.
function webhookFor(provider: "replicate" | "runpod"): string {
  const base = process.env.PUBLIC_SITE_URL || "https://humancrush.com";
  return `${base}/api/public/${provider}-webhook`;
}

// Motion negative prompt for the RunPod WAN endpoint — the "static/frozen" terms
// are what stop it returning a near-still clip.
const VIDEO_NEGATIVE =
  "blurry, low quality, deformed, extra limbs, watermark, text, inconsistent characters, slow, slow motion, static, still, frozen, stuck, no movement, bad anatomy, cartoon, low quality";

// Create a media_jobs row and fire the async image-to-video job, using the
// companion's photo as the start frame so the clip looks like HER. Prefers the
// RunPod WAN endpoint (runs the weights on RunPod, nothing screened upstream)
// and falls back to Replicate when RUNPOD_VIDEO_ENDPOINT isn't configured.
// Caller must have ALREADY charged VIDEO_COST; on any launch failure this marks
// the job failed, refunds, and rethrows. Shared by the 🎬 button (requestVideo)
// and the in-chat auto-video (sendChatMessage).
export async function startVideoJob(
  supabase: any,
  userId: string,
  conversationId: string,
  companion: { name: string; imageUrl?: string | null },
  userReq: string | undefined,
  balance: { free: number; paid: number },
): Promise<string> {
  const startImage = resolveHostedImage(companion.imageUrl);
  const videoPrompt = videoPromptFor(companion, userReq);
  const runpodVideo = runpodEndpoint("video");
  const useRunpod = Boolean(runpodVideo && startImage && /^https?:/i.test(startImage));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: job, error: jobErr } = await supabaseAdmin
    .from("media_jobs")
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      kind: "video",
      status: "pending",
      prompt: videoPrompt,
      provider: useRunpod ? "runpod" : "replicate",
      cost: VIDEO_COST,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    await refundCredits(supabase, userId, VIDEO_COST, `refund-nojob-${userId}-${Date.now()}`, balance);
    throw new Error("Failed to create video generation job");
  }

  const fail = async (message: string) => {
    await supabaseAdmin
      .from("media_jobs")
      .update({ status: "failed", error: message })
      .eq("id", job.id);
    await refundCredits(supabase, userId, VIDEO_COST, `refund-${job.id}`, balance);
  };

  if (!startImage) {
    await fail("Video needs a hosted companion photo — upload or regenerate this companion's image in the admin panel.");
    throw new Error("No fetchable companion image for video generation");
  }

  if (useRunpod) {
    // fps * frames is the clip length: 82 frames @ 16fps ≈ 5s, the endpoint's
    // tuned default. num_scenes stays 1 — one prompt, one continuous shot.
    const fps = Number(process.env.RUNPOD_VIDEO_FPS || "16");
    try {
      const result = await runpodRun(
        runpodVideo!,
        {
          image_url: startImage,
          fps,
          frames_per_scene: Number(process.env.RUNPOD_VIDEO_FRAMES || "82"),
          num_scenes: 1,
          sampling_steps: Number(process.env.RUNPOD_VIDEO_STEPS || "10"),
          prompts: [videoPrompt],
          negative_prompt: VIDEO_NEGATIVE,
        },
        webhookFor("runpod"),
      );
      await supabaseAdmin
        .from("media_jobs")
        .update({ replicate_id: result.id, status: "processing" })
        .eq("id", job.id);
    } catch (err: any) {
      await fail(err.message || "Failed to trigger video model");
      throw err;
    }
    return job.id;
  }

  const webhookUrl = webhookFor("replicate");
  // Official model, called by name (versionless, stable API). Override with an
  // owner/name slug. wan-2.5 is a proxy to Alibaba's hosted API and rejects this
  // app's content server-side — every prediction failed in under a second with
  // ModelError E002 — so run the open-weight 2.2 build, which executes on
  // Replicate and exposes disable_safety_checker. Clip length is num_frames /
  // frames_per_second here; 2.5's `duration` input does not exist. Aspect ratio
  // follows the input image, so a portrait photo -> portrait clip.
  const videoModel = process.env.REPLICATE_VIDEO_MODEL || "wan-video/wan-2.2-i2v-fast";
  const resolution = process.env.REPLICATE_VIDEO_RESOLUTION || "720p";
  const fps = Number(process.env.REPLICATE_VIDEO_FPS || "16");
  const duration = Number(process.env.REPLICATE_VIDEO_DURATION || "5");

  try {
    const { triggerReplicateModel } = await import("./ai");
    const result = await triggerReplicateModel(
      videoModel,
      {
        image: startImage,
        prompt: videoPrompt,
        resolution,
        num_frames: Math.round(duration * fps) + 1,
        frames_per_second: fps,
        disable_safety_checker: true,
      },
      webhookUrl,
    );

    await supabaseAdmin
      .from("media_jobs")
      .update({ replicate_id: result.id, status: "processing" })
      .eq("id", job.id);
  } catch (err: any) {
    await fail(err.message || "Failed to trigger video model");
    throw err;
  }

  return job.id;
}

// Reconcile a media job against its provider directly, so completion does NOT
// depend on the webhook callback landing (serverless webhooks are unreliable).
// The client's status poll calls this; it checks the job, chains the face
// swap when one is needed, stores the result, and finalizes the job.
export const checkMediaJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: job } = await supabase
      .from("media_jobs")
      .select("id, user_id, conversation_id, kind, cost, status, provider, replicate_id, media_url")
      .eq("id", data.jobId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!job) throw new Error("Job not found");

    if (job.status === "completed") return { status: "completed", mediaUrl: (job as any).media_url };
    if (job.status === "failed") return { status: "failed" };
    if (!(job as any).replicate_id) return { status: job.status };

    const { completeMediaJob: complete, failMediaJob: fail } = await import(
      "./media-finalize.server"
    );

    // RunPod jobs need no face-swap chaining: the image path edits her real
    // photo and the video path animates it, so identity is already hers.
    if ((job as any).provider === "runpod") {
      const endpoint = runpodEndpoint(job.kind);
      if (!endpoint) return { status: job.status };

      const { runpodGet, runpodStatusOf, runpodOutputUrl, runpodOutputError } = await import(
        "./runpod"
      );
      let res: { status: string; output?: any; error?: any };
      try {
        res = await runpodGet(endpoint, (job as any).replicate_id);
      } catch {
        return { status: job.status }; // transient — keep polling
      }

      const state = runpodStatusOf(res.status);
      if (state === "failed") {
        await fail(job as any, runpodOutputError(res.output, res.error) || `Job ${res.status}`);
        return { status: "failed" };
      }
      if (state === "processing") return { status: "processing" };

      const err = runpodOutputError(res.output, res.error);
      if (err) {
        await fail(job as any, err);
        return { status: "failed" };
      }
      const url = runpodOutputUrl(res.output);
      if (!url) {
        await fail(job as any, "No output from generation model");
        return { status: "failed" };
      }
      try {
        const mediaUrl = await complete(job as any, url);
        return { status: "completed", mediaUrl };
      } catch (e: any) {
        await fail(job as any, `Storage failed: ${e.message}`);
        return { status: "failed" };
      }
    }

    const { getReplicatePrediction, triggerReplicate, FACE_SWAP_VERSION } = await import("./ai");
    let pred: { status: string; output?: any; error?: any; version?: string };
    try {
      pred = await getReplicatePrediction((job as any).replicate_id);
    } catch {
      return { status: job.status }; // transient — keep polling
    }

    if (pred.status === "succeeded") {
      const outputUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
      if (!outputUrl) {
        await fail(job as any, "No output from generation model");
        return { status: "failed" };
      }

      // Lock the companion's face onto the generated body. The swap runs as a
      // second prediction that replicate_id is re-pointed at, so the next poll
      // tick finalizes the swapped result — same chaining the webhook does, so
      // the two paths stay identical. Swapping inline instead would hold this
      // request open for minutes and blow the serverless timeout, and the client
      // would retry and pay for another swap. Skipped when this prediction IS
      // the swap.
      if (job.kind === "image" && pred.version !== FACE_SWAP_VERSION && job.conversation_id) {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: conv } = await supabaseAdmin
            .from("conversations")
            .select("user_personalities(companions(image_url))")
            .eq("id", job.conversation_id)
            .maybeSingle();
          const faceUrl = (conv as any)?.user_personalities?.companions?.image_url;
          if (faceUrl && /^(https?:|data:)/.test(faceUrl)) {
            // A webhook URL keeps Replicate from holding the create call open
            // (the Prefer: wait path), so this returns as soon as it's queued.
            const swap = await triggerReplicate(
              FACE_SWAP_VERSION,
              { swap_image: faceUrl, input_image: outputUrl },
              `${process.env.PUBLIC_SITE_URL || "https://humancrush.com"}/api/public/replicate-webhook`,
            );
            await supabaseAdmin
              .from("media_jobs")
              .update({ replicate_id: swap.id, updated_at: new Date().toISOString() })
              .eq("id", job.id);
            return { status: "processing" };
          }
        } catch {
          /* swap unavailable — fall through and keep the unswapped body */
        }
      }

      try {
        const mediaUrl = await complete(job as any, outputUrl);
        return { status: "completed", mediaUrl };
      } catch (e: any) {
        await fail(job as any, `Storage failed: ${e.message}`);
        return { status: "failed" };
      }
    }

    if (pred.status === "failed" || pred.status === "canceled") {
      await fail(job as any, pred.error ? String(pred.error) : `Prediction ${pred.status}`);
      return { status: "failed" };
    }

    return { status: "processing" };
  });

export const generateVoiceNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        text: z.string().min(1).max(800),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotSuspended(supabase, userId);

    const { data: conv } = await supabase
      .from("conversations")
      .select("user_personalities(companions(sort_order, voice_id))")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    const { free, paid } = await ensureBalance(supabase, userId, VOICE_COST);

    const comp = (conv as any).user_personalities?.companions;
    const sort: number = comp?.sort_order ?? 0;
    // Admin-assigned voice wins; otherwise rotate through the roster.
    const voice = comp?.voice_id || VOICES[sort % VOICES.length];

    // Generate first; only charge if it actually succeeds.
    const buf = await textToSpeech(data.text, voice);
    const dataUrl = `data:audio/mpeg;base64,${buf.toString("base64")}`;
    const balance = await deductCredits(supabase, userId, VOICE_COST, "voice_note", free, paid);

    await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "assistant",
      content: data.text,
      kind: "voice",
      media_url: dataUrl,
    });

    return { balance, mediaUrl: dataUrl };
  });

// Step 1 of a video request: pick a short spoken line (in-character, flirty) and
// render her voice for it. The clip itself is assembled in the browser (canvas +
// this audio) — no charge here; the user is only charged when the finished video
// is saved (saveVideoNote), so a failed render never costs credits.
export const videoScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        prompt: z.string().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conv } = await supabase
      .from("conversations")
      .select(
        "user_personalities(nickname, style_backstory, companions(name, image_url, sort_order, age, ethnicity, base_personality, voice_id))",
      )
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    // Must be able to afford the video before we spend on TTS.
    await ensureBalance(supabase, userId, VIDEO_COST);

    const p: any = (conv as any).user_personalities;
    const c = p.companions;
    if (data.prompt) {
      const screen = screenUserMessage(data.prompt);
      if (!screen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${screen.reason}`);
    }

    const line = (
      await chatComplete(
        [
          {
            role: "system",
            content:
              `You are ${p.nickname}, a ${c.age}-year-old ${c.ethnicity} woman recording a short, flirty, intimate video message for the person you're talking to. ` +
              `Base personality: ${c.base_personality}. ${p.style_backstory ? `Vibe: ${p.style_backstory}. ` : ""}` +
              `Write ONE or TWO short sentences she says out loud to the camera — playful, seductive, personal, spoken aloud (no stage directions, no asterisks, no quotes). Max 160 characters.`,
          },
          {
            role: "user",
            content: data.prompt
              ? `Make the video about: ${data.prompt}`
              : "Make a teasing hello video for me.",
          },
        ],
        { maxTokens: 90 },
      )
    )
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .slice(0, 200);

    const sort: number = c.sort_order ?? 0;
    const voice = c.voice_id || VOICES[sort % VOICES.length];
    const buf = await textToSpeech(line || `Hey you… I made this just for you.`, voice);
    const audioUrl = `data:audio/mpeg;base64,${buf.toString("base64")}`;

    return { line, audioUrl, imageUrl: c.image_url as string, name: c.name as string };
  });

// Step 2 of a video request: persist the finished clip (rendered in the browser)
// and charge for it. Only now does the user pay — after a real video exists.
export const saveVideoNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        dataUrl: z.string().startsWith("data:video/").max(20_000_000),
        caption: z.string().max(400).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    const { free, paid } = await ensureBalance(supabase, userId, VIDEO_COST);
    const balance = await deductCredits(supabase, userId, VIDEO_COST, "video_note", free, paid);

    await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "assistant",
      content: data.caption || "*sends you a video* 🎬",
      kind: "video",
      media_url: data.dataUrl,
    });

    return { balance };
  });
