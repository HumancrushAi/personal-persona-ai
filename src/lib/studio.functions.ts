// Marketing studio: generate promo images and clips of a persona for social
// pages and subscription funnels, separate from the chat companions.
//
// Images come from xAI Imagine (the only text-to-image available) and are
// deliberately clothed — this material is for public pages, and Imagine has its
// own content policy regardless. Clips come from the RunPod video endpoint,
// which is also where an explicit version of the same person would come from.
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
        generateCompanionPortrait(prompt, { referenceUrl: data.referenceUrl ?? null }),
      ),
    );

    const images: string[] = [];
    const errors: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        try {
          images.push(await storeImage(supabaseAdmin, context.userId, r.value));
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

