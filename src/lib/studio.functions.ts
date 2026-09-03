// Marketing studio: generate promo images and clips of a persona for social
// pages and subscription funnels, separate from the chat companions.
//
// There are two image paths, on purpose. studioGenerate is the CLOTHED one:
// xAI Imagine, a clothed instruction appended to every prompt, for material that
// goes on public pages and into mainstream ad accounts. studioGenerateExplicit
// is the uncensored one: the RunPod endpoint the chat selfie already uses, with
// Grok writing the prompt and following the request as typed. Clips come from
// the same RunPod video endpoint.
//
// studioBanner composites a shot into a finished ad unit — headline, CTA and
// wordmark drawn on — because a cropped photo with no words on it is not a
// banner.
//
// Everything is admin-only and stored under studio/<userId>/ in the public
// avatars bucket so it can be downloaded or reused as a companion portrait.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateCompanionPortrait } from "./portrait.server";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

// Imagine bills per image, so a batch UI can spend fast. Four is enough to pick
// from without a mis-click costing a lot.
const MAX_VARIATIONS = 4;

// Appended to every studio prompt. Public promo material has to be clothed, and
// saying so explicitly is more reliable than hoping the model stays tasteful.
const PROMO_STYLE =
  "Sexy but fully clothed, nothing exposed, suitable for a public social media profile. Ultra realistic photograph, natural available light, real skin texture with visible pores, natural asymmetry, sharp focus, shallow depth of field. Looks like a real photo of a real person, not a render.";

async function storeImage(supabaseAdmin: any, userId: string, dataUrl: string): Promise<string> {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(meta ?? "")?.[1] ?? "image/jpeg";
  const ext = mime.includes("png") ? "png" : "jpg";
  const path = `studio/${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from("avatars")
    .upload(path, Buffer.from(b64 ?? "", "base64"), { contentType: mime, upsert: true });
  if (error) throw new Error(error.message);

  return supabaseAdmin.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

// Same, for a renderer that hands back a hosted URL instead of inline bytes.
// Those URLs are on the provider's CDN and expire, so the file is copied into
// our own bucket rather than referenced where it lies.
async function storeRemoteImage(
  supabaseAdmin: any,
  userId: string,
  remoteUrl: string,
): Promise<string> {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Could not fetch the render (${res.status})`);
  const mime = res.headers.get("content-type") ?? "image/png";
  const ext = mime.includes("png") ? "png" : "jpg";
  const path = `studio/${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from("avatars")
    .upload(path, Buffer.from(await res.arrayBuffer()), { contentType: mime, upsert: true });
  if (error) throw new Error(error.message);

  return supabaseAdmin.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

// Generate variations from a description. With `referenceUrl` every image is
// built from an existing face instead, which is how a set of one persona is
// produced rather than a set of strangers.
export const studioGenerate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        prompt: z.string().min(3).max(600),
        count: z.number().int().min(1).max(MAX_VARIATIONS).default(2),
        referenceUrl: z.string().url().optional(),
        companionId: z.string().uuid().optional(),
        aspectRatio: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Grok expands the short description into a full photographic prompt. The
    // typed line alone produces a generic image; the expansion is what carries
    // the wardrobe detail, the lighting and the realism markers.
    const { refinePromoPrompt } = await import("./prompt-refiner.server");
    const refined = await refinePromoPrompt(data.prompt, Boolean(data.referenceUrl));
    // PROMO_STYLE is appended either way. The clothed guarantee is the one thing
    // that must not depend on the model having behaved — a refined prompt is
    // only checked for length and a refusal prefix.
    const prompt = `${refined ?? data.prompt}. ${PROMO_STYLE}`;

    // One failure shouldn't lose the images that did work, so results are
    // settled rather than raced.
    const results = await Promise.allSettled(
      Array.from({ length: data.count }, () =>
        generateCompanionPortrait(prompt, {
          referenceUrl: data.referenceUrl ?? null,
          aspectRatio: data.aspectRatio ?? "3:4",
        }),
      ),
    );

    const images: { id?: string; url: string }[] = [];
    const errors: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        try {
          const publicUrl = await storeImage(supabaseAdmin, context.userId, r.value);
          let mediaRowId: string | undefined = undefined;

          if (data.companionId) {
            const { data: row, error: insertErr } = await supabaseAdmin
              .from("companion_media")
              .insert({
                companion_id: data.companionId,
                media_url: publicUrl,
              })
              .select("id")
              .single();
            if (!insertErr && row) {
              mediaRowId = row.id;
            }
          }

          images.push({ id: mediaRowId, url: publicUrl });
        } catch (e: any) {
          errors.push(e.message ?? "storage failed");
        }
      } else {
        errors.push(r.reason?.message ?? "generation failed");
      }
    }

    if (!images.length) throw new Error(errors[0] ?? "Generation failed");
    return { images, errors };
  });

// Animate one studio image into a short promo clip. Runs through the same
// media_jobs pipeline the chat uses, so the existing poll and webhook finish it.
export const studioClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        imageUrl: z.string().url(),
        prompt: z.string().max(600).optional(),
        seconds: z.number().int().min(3).max(10).default(5),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { runpodEndpoint, runpodRun } = await import("./runpod");
    const endpoint = runpodEndpoint("video");
    if (!endpoint) throw new Error("Video generation is not configured (RUNPOD_VIDEO_ENDPOINT).");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const fps = 16;
    const motion =
      data.prompt?.trim() ||
      "she shifts her weight and looks at the camera, small natural head movement, hair moves slightly, subtle lifelike motion";

    // conversation_id is null so completeMediaJob stores the file without
    // posting a chat message, and cost 0 so the admin isn't billed credits.
    const { data: job, error } = await supabaseAdmin
      .from("media_jobs")
      .insert({
        user_id: context.userId,
        conversation_id: null,
        kind: "video",
        status: "pending",
        prompt: motion,
        provider: "runpod",
        cost: 0,
      })
      .select("id")
      .single();
    if (error || !job) throw new Error("Could not create clip job");

    try {
      const res = await runpodRun(
        endpoint,
        {
          image_url: data.imageUrl,
          fps,
          frames_per_scene: data.seconds * fps,
          num_scenes: 1,
          sampling_steps: Number(process.env.RUNPOD_VIDEO_STEPS || "25"),
          prompts: [`${motion}. Keep her face and outfit identical to the image.`],
          negative_prompt:
            "blurry, low quality, deformed, extra limbs, watermark, text, static, frozen, bad anatomy, cartoon, 3d render, cgi, plastic skin, distorted hands, extra fingers, nudity, naked, topless",
        },
        `${process.env.PUBLIC_SITE_URL || "https://www.humancrush.com"}/api/public/runpod-webhook`,
      );
      await supabaseAdmin
        .from("media_jobs")
        .update({ replicate_id: res.id, status: "processing" })
        .eq("id", job.id);
    } catch (e: any) {
      await supabaseAdmin
        .from("media_jobs")
        .update({ status: "failed", error: e.message ?? "trigger failed" })
        .eq("id", job.id);
      throw e;
    }

    return { jobId: job.id as string };
  });

// Remove a studio image from storage. A discarded shot that stays in the bucket
// is billed storage nobody looks at, and the grid should mean what it shows.
export const studioDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ url: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Only ever delete inside this admin's own studio folder — the URL arrives
    // from the client, so the path is derived and then checked rather than
    // trusted.
    const marker = "/avatars/";
    const idx = data.url.indexOf(marker);
    if (idx === -1) throw new Error("Not a studio file");
    const path = data.url.slice(idx + marker.length);
    if (!path.startsWith(`studio/${context.userId}/`)) throw new Error("Not your file");

    const { error } = await supabaseAdmin.storage.from("avatars").remove([path]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Refine a promo prompt with the OpenAI/xAI refiner logic before generating
export const refineStudioPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        prompt: z.string().min(3).max(600),
        hasReference: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { refinePromoPrompt } = await import("./prompt-refiner.server");
    const refined = await refinePromoPrompt(data.prompt, data.hasReference);
    return { refined: refined ?? data.prompt };
  });

// ---------------------------------------------------------------------------
// Explicit generation
// ---------------------------------------------------------------------------
//
// studioGenerate above is the CLOTHED path and stays that way: it refines
// through refinePromoPrompt (whose system prompt says "always fully clothed"),
// appends PROMO_STYLE, and renders on xAI Imagine, which has its own policy. All
// three of those independently strip a nudity request, which is why typing
// "nude" into the studio produced a clothed model no matter how it was phrased.
//
// This is the separate uncensored path. It uses the machinery the chat selfie
// already runs on: refineMediaPrompt, which reads the request with
// requestIsNude and switches to the NUDE few-shot examples, and a RunPod
// endpoint running uncensored weights.
//
// It is image-TO-image, so a reference photo is required — pick a persona or set
// a shot as the reference first. That is a property of the endpoint, not a
// choice made here: without RUNPOD_IMAGE_ENDPOINT the job runs on the video
// endpoint and a frame is cut out of the clip, and that needs a start frame too.
export const studioGenerateExplicit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        prompt: z.string().min(3).max(600),
        count: z.number().int().min(1).max(MAX_VARIATIONS).default(1),
        referenceUrl: z.string().url(),
        companionId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { runpodEndpoint, runpodRun } = await import("./runpod");
    // A ComfyUI endpoint on RUNPOD_IMAGE_ENDPOINT is the one-shot render and the
    // preferred path. Falling back to the video endpoint keeps this working on
    // the current configuration, where only RUNPOD_VIDEO_ENDPOINT is set.
    const imageEndpoint = process.env.RUNPOD_IMAGE_ENDPOINT;
    const endpoint = runpodEndpoint("image");
    if (!endpoint && !runpodEndpoint("kontext"))
      throw new Error(
        "Studio rendering is not configured (RUNPOD_API_KEY and one of RUNPOD_KONTEXT_ENDPOINT / RUNPOD_IMAGE_ENDPOINT / RUNPOD_VIDEO_ENDPOINT).",
      );

    if (!/^https?:/i.test(data.referenceUrl))
      throw new Error("Explicit mode edits an existing photo — pick a persona or set a reference.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Grok writes the render prompt, exactly as asked. refineMediaPrompt is
    // Grok-first with an OpenRouter fallback, and decides clothed vs nude from
    // the admin's own words rather than overriding them either way.
    const { refineMediaPrompt } = await import("./prompt-refiner.server");

    let companion: { gender?: string | null; ethnicity?: string; age?: number } = {};
    if (data.companionId) {
      const { data: row } = await supabaseAdmin
        .from("companions")
        .select("gender, ethnicity, age")
        .eq("id", data.companionId)
        .maybeSingle();
      if (row) companion = { gender: row.gender, ethnicity: row.ethnicity, age: row.age };
    }

    const refined = await refineMediaPrompt("photo", data.prompt, companion);
    const imagePrompt = refined?.[0] ?? data.prompt;

    // Which renderer this request goes to is decided by the request itself, not
    // by configuration. requestIsNude is the same test refineMediaPrompt just
    // used to pick its examples, so the prompt and the renderer agree.
    //
    // Kontext is fast (about ten seconds, one shot) and carries her face, but it
    // will not undress a subject — verified on a real job, see the note on
    // RUNPOD_KONTEXT_ENDPOINT in runpod.ts. So it gets the clothed work, which
    // is most of the promo and banner work, and nudity goes to the endpoint that
    // can actually render it.
    const { requestIsNude } = await import("./selfie");
    const nude = requestIsNude(data.prompt);
    const kontext = runpodEndpoint("kontext");

    if (!nude && kontext) {
      const { runpodRunSync, runpodOutputUrl, runpodOutputError } = await import("./runpod");
      const images: { id?: string; url: string }[] = [];
      const syncErrors: string[] = [];

      for (let i = 0; i < data.count; i++) {
        try {
          const res = await runpodRunSync(kontext, {
            prompt: imagePrompt,
            negative_prompt:
              "different person, different face, changed identity, deformed, extra limbs, bad anatomy, blurry, cartoon, anime, watermark, text",
            seed: -1,
            num_inference_steps: Number(process.env.RUNPOD_IMAGE_STEPS || "28"),
            guidance: Number(process.env.RUNPOD_IMAGE_GUIDANCE || "2.5"),
            image: data.referenceUrl,
            size: process.env.RUNPOD_IMAGE_SIZE || "1024*1024",
            output_format: "png",
            enable_safety_checker: false,
          });

          const err = runpodOutputError(res.output, res.error);
          if (err) throw new Error(err);
          const out = runpodOutputUrl(res.output);
          if (!out) throw new Error("Kontext returned no image");

          const publicUrl = await storeRemoteImage(supabaseAdmin, context.userId, out);

          let mediaRowId: string | undefined;
          if (data.companionId) {
            const { data: row, error: insertErr } = await supabaseAdmin
              .from("companion_media")
              .insert({ companion_id: data.companionId, media_url: publicUrl })
              .select("id")
              .single();
            if (!insertErr && row) mediaRowId = row.id;
          }

          images.push({ id: mediaRowId, url: publicUrl });
        } catch (e: any) {
          syncErrors.push(e.message ?? "render failed");
        }
      }

      if (!images.length) throw new Error(syncErrors[0] ?? "Kontext render failed");
      return { images, jobIds: [] as string[], errors: syncErrors, prompt: imagePrompt };
    }

    // The video endpoint centre-crops to a square, which decapitates a portrait,
    // so it gets a squared start frame. A ComfyUI image endpoint takes the photo
    // as it is.
    let startFrame = data.referenceUrl;
    if (!imageEndpoint) {
      try {
        const { squareStartFrame } = await import("./start-frame.server");
        startFrame = await squareStartFrame(
          data.referenceUrl,
          `studio-${context.userId}-${Date.now()}`,
        );
      } catch {
        /* fall back to the raw portrait rather than failing the request */
      }
    }

    // Past the Kontext branch, so this request needs the uncensored endpoint.
    if (!endpoint)
      throw new Error(
        "Nudity needs the uncensored endpoint — set RUNPOD_VIDEO_ENDPOINT or RUNPOD_IMAGE_ENDPOINT. Kontext will not render it.",
      );

    const webhook = `${process.env.PUBLIC_SITE_URL || "https://www.humancrush.com"}/api/public/runpod-webhook`;
    const jobIds: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < data.count; i++) {
      // cost 0 and conversation_id null: this is admin promo work, so no credits
      // are charged and completeMediaJob stores the file without posting it into
      // a chat.
      const { data: job, error } = await supabaseAdmin
        .from("media_jobs")
        .insert({
          user_id: context.userId,
          conversation_id: null,
          kind: "image",
          status: "pending",
          prompt: imagePrompt,
          provider: "runpod",
          cost: 0,
        })
        .select("id")
        .single();
      if (error || !job) {
        errors.push("Could not create job");
        continue;
      }

      const input = imageEndpoint
        ? {
            prompt: imagePrompt,
            negative_prompt:
              "different person, different face, changed identity, deformed, extra limbs, bad anatomy, blurry, cartoon, anime, watermark, text",
            seed: -1,
            num_inference_steps: Number(process.env.RUNPOD_IMAGE_STEPS || "28"),
            guidance: Number(process.env.RUNPOD_IMAGE_GUIDANCE || "2.5"),
            image: data.referenceUrl,
            size: process.env.RUNPOD_IMAGE_SIZE || "1024*1024",
            output_format: "png",
            // The safety checker would blank the output, which is the entire
            // point of this path.
            enable_safety_checker: false,
          }
        : {
            image_url: startFrame,
            fps: 16,
            frames_per_scene: Number(process.env.RUNPOD_STILL_FRAMES || "49"),
            num_scenes: 1,
            sampling_steps: Number(process.env.RUNPOD_STILL_STEPS || "24"),
            prompts: [imagePrompt],
            negative_prompt:
              "different person, different face, changed identity, deformed, extra limbs, bad anatomy, blurry, cartoon, anime, watermark, text, clothed, dressed",
          };

      try {
        const res = await runpodRun(endpoint, input, webhook);
        await supabaseAdmin
          .from("media_jobs")
          .update({ replicate_id: res.id, status: "processing" })
          .eq("id", job.id);
        jobIds.push(job.id as string);
      } catch (e: any) {
        await supabaseAdmin
          .from("media_jobs")
          .update({ status: "failed", error: e.message ?? "trigger failed" })
          .eq("id", job.id);
        errors.push(e.message ?? "trigger failed");
      }
    }

    if (!jobIds.length) throw new Error(errors[0] ?? "Explicit generation failed");
    // Same shape as the Kontext branch above; the caller branches on which of
    // `images` and `jobIds` came back filled.
    return { images: [] as { id?: string; url: string }[], jobIds, errors, prompt: imagePrompt };
  });

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

// Suggest headline and CTA from the description of the shot. Purely a
// convenience — the admin types over it, and a failure just leaves the fields as
// they were rather than blocking the banner.
export const studioBannerCopy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ prompt: z.string().min(3).max(600) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { refineBannerCopy } = await import("./prompt-refiner.server");
    const copy = await refineBannerCopy(data.prompt);
    if (!copy) throw new Error("Copywriter is unavailable — type the headline and CTA yourself.");
    return copy;
  });

// Composite a shot into a finished ad unit and store it alongside the shots.
// Returned as a stored public URL rather than raw bytes so the preview, the
// download and a re-download later are all the same file.
export const studioBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        imageUrl: z.string().url(),
        sizeId: z.string().min(1),
        headline: z.array(z.string().max(40)).min(1).max(2),
        cta: z.string().min(1).max(24),
        focalPoint: z.enum(["face", "center", "bottom"]).default("face"),
        wordmark: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getStudioSizeById } = await import("./studio-sizes");
    const { composeBanner } = await import("./banner-compositor.server");

    const size = getStudioSizeById(data.sizeId);
    if (!size.w || !size.h)
      throw new Error(`${size.name} has no fixed pixel size to composite into`);

    const jpeg = await composeBanner({
      imageUrl: data.imageUrl,
      size,
      copy: {
        headline: data.headline.filter((l) => l.trim().length > 0),
        cta: data.cta,
        wordmark: data.wordmark,
      },
      focalPoint: data.focalPoint,
    });

    const path = `studio/${context.userId}/banner-${size.id}-${crypto.randomUUID()}.jpg`;
    const { error } = await supabaseAdmin.storage
      .from("avatars")
      .upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
    if (error) throw new Error(error.message);

    return {
      url: supabaseAdmin.storage.from("avatars").getPublicUrl(path).data.publicUrl,
      sizeId: size.id,
      dimensions: size.dimensions,
    };
  });
