// Chat media (photos, videos, voice notes).
//
// Photos and videos both run on RunPod, and only on RunPod — there is no
// Replicate fallback in this file any more. A misconfigured or unreachable
// endpoint fails the job and refunds rather than quietly rendering somewhere
// else, because a silent fallback is what previously hid a broken image path.
//
// checkMediaJob still reconciles provider="replicate" rows: jobs created before
// the switch are potentially still in flight, and dropping that branch would
// strand them unfinished and unrefunded.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { applyDeduction, hasEnough } from "./credits";
import { textToSpeech, chatComplete } from "./ai";
import { screenUserMessage, BLOCKED_CONTENT } from "./safety";
import {
  kontextSelfiePrompt,
  videoStillPrompt,
  videoActionPrompt,
  scenePrompt,
  checkCrossGenderRequest,
} from "./selfie";
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
  await supabase.from("credit_balances").update({ paid_credits: newPaid }).eq("user_id", userId);
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
// Chat photos run on RunPod only. FLUX.1 Kontext edits her actual photo, so
// identity carries over natively and there's no face-swap pass to chain.
//
// It is image-TO-image, so it needs a hosted photo to edit: a companion with no
// fetchable image_url fails here and refunds rather than silently falling back.
// There is no Replicate path any more — see the header comment on this file.
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
  // Photos are generated on the VIDEO endpoint, and a frame of the result is
  // shown as the still. That endpoint is the only uncensored model on the
  // account: the shared FLUX Kontext image model follows every other instruction
  // but returns her clothed for any nudity request, which is a property of its
  // weights and not something a flag turns off. Set RUNPOD_IMAGE_ENDPOINT to a
  // real (uncensored) image endpoint and photos move back to a one-shot render.
  const imageEndpoint = process.env.RUNPOD_IMAGE_ENDPOINT;
  const runpodImage = imageEndpoint ? runpodEndpoint("image") : runpodEndpoint("video");
  if (!runpodImage) {
    await refundCredits(
      supabase,
      userId,
      SELFIE_COST,
      `refund-nocfg-${userId}-${Date.now()}`,
      balance,
    );
    throw new Error("Photo generation is not configured (RUNPOD_API_KEY missing).");
  }

  // A RunPod worker fetches the source frame over the network, so only a real
  // http(s) URL works — an inline data: photo can't be reached from outside.
  const sourceImage = resolveHostedImage(companion.imageUrl);
  if (!sourceImage || !/^https?:/i.test(sourceImage)) {
    await refundCredits(
      supabase,
      userId,
      SELFIE_COST,
      `refund-nosrc-${userId}-${Date.now()}`,
      balance,
    );
    throw new Error(
      "This companion has no hosted photo to edit — regenerate her image in the admin panel first.",
    );
  }

  const imagePrompt = imageEndpoint
    ? kontextSelfiePrompt(companion, userRequest, styleBackstory)
    : videoStillPrompt(companion, userRequest);

  // The endpoint centre-crops to a square, which decapitated the result. Square
  // it ourselves, keeping the whole figure, before handing it over.
  let startFrame = sourceImage;
  if (!imageEndpoint) {
    try {
      const { squareStartFrame } = await import("./start-frame.server");
      startFrame = await squareStartFrame(sourceImage, `img-${userId}-${Date.now()}`);
    } catch {
      /* fall back to the raw portrait rather than failing the whole request */
    }
  }

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
      provider: "runpod",
      cost: SELFIE_COST,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    await refundCredits(
      supabase,
      userId,
      SELFIE_COST,
      `refund-nojob-${userId}-${Date.now()}`,
      balance,
    );
    throw new Error("Failed to create image generation job");
  }

  try {
    // The two endpoints take completely different inputs, so the body is built
    // per endpoint rather than shared.
    const input = imageEndpoint
      ? {
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
        }
      : {
          // Shorter than a real clip — only the end frame is shown, so the extra
          // frames are wasted generation time.
          image_url: startFrame,
          fps: 16,
          frames_per_scene: Number(process.env.RUNPOD_STILL_FRAMES || "49"),
          num_scenes: 1,
          sampling_steps: Number(process.env.RUNPOD_VIDEO_STEPS || "10"),
          prompts: [imagePrompt],
          negative_prompt: VIDEO_NEGATIVE,
          lora_strengths: VIDEO_LORA_STRENGTHS,
        };

    const result = await runpodRun(runpodImage, input, webhookFor("runpod"));
    await supabaseAdmin
      .from("media_jobs")
      .update({ replicate_id: result.id, status: "processing" })
      .eq("id", job.id);
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
        // Scene-by-scene mode: one prompt per shot. The endpoint renders each
        // scene and stitches them, so this is its own native feature rather
        // than several separate jobs fired in sequence.
        scenes: z.array(z.string().max(1200)).min(1).max(10).optional(),
        settings: z
          .object({
            fps: z.number().int().min(8).max(30).optional(),
            framesPerScene: z.number().int().min(16).max(160).optional(),
            samplingSteps: z.number().int().min(4).max(40).optional(),
          })
          .optional(),
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

    // Every scene is a separate render on the endpoint, so a 10-scene video is
    // 10x the compute of a 1-scene one and is priced accordingly.
    const scenes = data.scenes?.map((t) => t.trim()).filter(Boolean);
    const cost = VIDEO_COST * Math.max(1, scenes?.length ?? 1);

    // Screen each scene, not just the single prompt — otherwise the per-scene
    // fields would be an unchecked way around the safety gate.
    for (const scene of scenes ?? []) {
      const sceneScreen = screenUserMessage(scene);
      if (!sceneScreen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${sceneScreen.reason}`);
    }

    const { free, paid } = await ensureBalance(supabase, userId, cost);
    const balance = await deductCredits(supabase, userId, cost, "video_debit", free, paid);

    const jobId = await startVideoJob(
      supabase,
      userId,
      data.conversationId,
      { name: c.name, gender: c.gender, imageUrl: c.image_url },
      userPrompt,
      balance,
      { scenes, settings: data.settings, cost },
    );

    return { jobId, status: "pending", balance };
  });

// Build the motion prompt for image-to-video. The companion's appearance comes
// from the start-frame image, so the prompt describes MOTION/ACTION, not looks.
// No forced "SFW" — the safety screen (run by the caller) blocks illegal content;
// clamping to SFW is why asking her to do something explicit never matched.
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

// The endpoint's tuned LoRA weights, exactly as its operator specified them.
// These are what the endpoint is tuned WITH; leaving the key out runs it at
// whatever defaults the worker falls back to, which is not what the endpoint was
// built and tested against. The public cams clips (scripts/generate-reels.ts)
// deliberately omit these — those are SFW idle loops, and they render fine
// without, so the key is optional rather than required.
const VIDEO_LORA_STRENGTHS = {
  "HIGH Lora 3": 1,
  "HIGH Lora 4": 0.6,
  "HIGH Lora 5": 0.6,
  "HIGH Lora 6": 0.6,
  "LOW Lora 3": 0.6,
  "LOW Lora 4": 0.6,
  "LOW Lora 5": 0.6,
  "LOW Lora 6": 0.6,
};

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
  companion: { name: string; gender?: string | null; imageUrl?: string | null },
  userReq: string | undefined,
  balance: { free: number; paid: number },
  opts?: {
    scenes?: string[];
    settings?: { fps?: number; framesPerScene?: number; samplingSteps?: number };
    cost?: number;
  },
): Promise<string> {
  const startImage = resolveHostedImage(companion.imageUrl);

  // Scene mode: the user wrote a prompt per shot, so those are used verbatim
  // (they are the whole point of the studio) with only the house framing and
  // quality tail appended. Otherwise it's a single generated action prompt.
  const scenes = opts?.scenes?.filter(Boolean) ?? [];
  const prompts = scenes.length
    ? scenes.map((scene) => scenePrompt(scene))
    : [videoActionPrompt(companion, userReq)];
  const videoPrompt = prompts.join("\n\n");

  // Refunds must return what was actually charged: a 10-scene video costs 10x,
  // so refunding the flat VIDEO_COST would quietly rob the user of 9/10ths.
  const cost = opts?.cost ?? VIDEO_COST;

  const runpodVideo = runpodEndpoint("video");
  if (!runpodVideo) {
    await refundCredits(supabase, userId, cost, `refund-nocfg-${userId}-${Date.now()}`, balance);
    throw new Error(
      "Video generation is not configured (RUNPOD_API_KEY / RUNPOD_VIDEO_ENDPOINT missing).",
    );
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: job, error: jobErr } = await supabaseAdmin
    .from("media_jobs")
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      kind: "video",
      status: "pending",
      prompt: videoPrompt,
      provider: "runpod",
      cost,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    await refundCredits(supabase, userId, cost, `refund-nojob-${userId}-${Date.now()}`, balance);
    throw new Error("Failed to create video generation job");
  }

  const fail = async (message: string) => {
    await supabaseAdmin
      .from("media_jobs")
      .update({ status: "failed", error: message })
      .eq("id", job.id);
    await refundCredits(supabase, userId, cost, `refund-${job.id}`, balance);
  };

  if (!startImage) {
    await fail(
      "Video needs a hosted companion photo — upload or regenerate this companion's image in the admin panel.",
    );
    throw new Error("No fetchable companion image for video generation");
  }

  // Same centre-crop problem as photos: hand the endpoint a square that keeps
  // her whole body rather than letting it slice the frame down to a torso.
  let startFrame = startImage;
  try {
    const { squareStartFrame } = await import("./start-frame.server");
    startFrame = await squareStartFrame(startImage, `vid-${userId}-${Date.now()}`);
  } catch {
    /* fall back to the raw portrait rather than failing the whole request */
  }

  // fps * frames is the clip length: 82 frames @ 16fps ≈ 5s, the endpoint's
  // tuned default. num_scenes stays 1 — one prompt, one continuous shot.
  const fps = opts?.settings?.fps ?? Number(process.env.RUNPOD_VIDEO_FPS || "16");
  try {
    const result = await runpodRun(
      runpodVideo,
      {
        image_url: startFrame,
        fps,
        frames_per_scene:
          opts?.settings?.framesPerScene ?? Number(process.env.RUNPOD_VIDEO_FRAMES || "82"),
        num_scenes: prompts.length,
        sampling_steps:
          opts?.settings?.samplingSteps ?? Number(process.env.RUNPOD_VIDEO_STEPS || "10"),
        prompts,
        negative_prompt: VIDEO_NEGATIVE,
        lora_strengths: VIDEO_LORA_STRENGTHS,
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

    if (job.status === "completed")
      return { status: "completed", mediaUrl: (job as any).media_url };
    if (job.status === "failed") return { status: "failed" };
    if (!(job as any).replicate_id) return { status: job.status };

    const { completeMediaJob: complete, failMediaJob: fail } =
      await import("./media-finalize.server");

    // RunPod jobs need no face-swap chaining: the image path edits her real
    // photo and the video path animates it, so identity is already hers.
    if ((job as any).provider === "runpod") {
      const endpoint = runpodEndpoint(job.kind);
      if (!endpoint) return { status: job.status };

      const { runpodGet, runpodStatusOf, runpodOutputUrl, runpodOutputError } =
        await import("./runpod");
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
