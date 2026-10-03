// A companion's live reel, kept in step with her portrait automatically.
//
// Every time an admin creates a companion or changes her photo, her old reel is
// removed at once — so her card falls back to the portrait and never plays a
// clip of a different photo — and a new one is rendered from the new portrait
// by the same rules as scripts/generate-reels.ts (src/lib/reel-clip.ts):
// image-to-video from the portrait, padding cropped back off, and a clip that
// drifts from its first frame is retried with the next motion, never published.
//
// The render finishes by webhook (/api/public/reel-webhook). Its URL carries an
// HMAC of the companion, her portrait URL and the attempt, so a forged call is
// ignored, and so is a late clip of a portrait that has since been replaced.

import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { MAX_DRIFT, REEL_ATTEMPTS, cropToPortrait, driftFromFirstFrame, reelJobInput, squarePortrait } from "./reel-clip";

const reelPath = (id: string) => `companion-${id}.mp4`;

function sign(id: string, imageUrl: string, attempt: number): string {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")
    .update(`${id}|${imageUrl}|${attempt}`)
    .digest("hex")
    .slice(0, 40);
}

function signatureMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

type ReelCompanion = {
  id: string;
  name: string;
  gender: string | null;
  image_url: string;
  created_by: string | null;
};

async function loadCompanion(id: string): Promise<ReelCompanion | null> {
  const { data } = await supabaseAdmin
    .from("companions")
    .select("id, name, gender, image_url, created_by")
    .eq("id", id)
    .maybeSingle();
  return (data as ReelCompanion | null) ?? null;
}

/**
 * Her photo is new or changed: drop the old reel now and render a matching one.
 * Never throws — saving the companion must not fail because of the reel.
 */
export async function refreshCompanionReel(id: string): Promise<"started" | "skipped" | "failed"> {
  try {
    await supabaseAdmin.storage.from("reels").remove([reelPath(id)]);
    return await startReelAttempt(id, 0);
  } catch (e: any) {
    console.error(`[reels] could not start a reel for ${id}: ${e?.message ?? e}`);
    return "failed";
  }
}

async function startReelAttempt(id: string, attempt: number): Promise<"started" | "skipped"> {
  const c = await loadCompanion(id);
  // User-made companions have no reel (getEffectiveCompanionReel), and a
  // portrait the video worker cannot fetch cannot be animated.
  if (!c || c.created_by || !/^https?:/i.test(c.image_url ?? "")) return "skipped";

  const { runpodEndpoint, runpodRun } = await import("./runpod");
  const endpoint = runpodEndpoint("video");
  if (!endpoint) return "skipped";

  const res = await fetch(c.image_url);
  if (!res.ok) throw new Error(`could not fetch her portrait (${res.status})`);
  const { png } = await squarePortrait(Buffer.from(await res.arrayBuffer()));
  const framePath = `startframes/reel-${id}.png`;
  const { error } = await supabaseAdmin.storage
    .from("avatars")
    .upload(framePath, png, { contentType: "image/png", upsert: true });
  if (error) throw error;
  const frameUrl = supabaseAdmin.storage.from("avatars").getPublicUrl(framePath).data.publicUrl;

  const site = (process.env.PUBLIC_SITE_URL || "https://www.humancrush.com").replace(/\/$/, "");
  const hook =
    `${site}/api/public/reel-webhook?c=${encodeURIComponent(id)}&a=${attempt}` +
    `&t=${sign(id, c.image_url, attempt)}`;
  await runpodRun(endpoint, { image_url: frameUrl, ...reelJobInput(c, attempt) }, hook);
  return "started";
}

/** The webhook half: check, crop, drift-check and publish, or retry. */
export async function finishReel(
  params: { c: string; a: number; t: string },
  body: { status?: string; output?: unknown; error?: unknown },
): Promise<string> {
  const c = await loadCompanion(params.c);
  if (!c) return "unknown companion";
  if (!signatureMatches(sign(c.id, c.image_url, params.a), params.t)) {
    // Forged, or a clip of a portrait that has since been replaced.
    return "stale or unsigned";
  }

  const { runpodStatusOf, runpodOutputUrl, runpodOutputError } = await import("./runpod");
  const state = runpodStatusOf(String(body.status ?? ""));
  if (state === "processing") return "processing";

  const retry = async (why: string) => {
    if (params.a + 1 < REEL_ATTEMPTS) {
      await startReelAttempt(c.id, params.a + 1);
      return `retrying (${why})`;
    }
    console.error(`[reels] gave up on ${c.name} after ${REEL_ATTEMPTS} attempts: ${why}`);
    return `gave up (${why})`;
  };

  const url = runpodOutputUrl(body.output);
  if (state === "failed" || !url) {
    return retry(runpodOutputError(body.output, body.error) || `job ${body.status}`);
  }

  const clipRes = await fetch(url);
  if (!clipRes.ok) return retry(`could not download the clip (${clipRes.status})`);
  const portraitRes = await fetch(c.image_url);
  if (!portraitRes.ok) return retry(`could not re-read her portrait (${portraitRes.status})`);
  const { aspect } = await squarePortrait(Buffer.from(await portraitRes.arrayBuffer()));

  const { ffmpegBin } = await import("./media-finalize.server");
  const ffmpeg = await ffmpegBin();
  const clip = cropToPortrait(Buffer.from(await clipRes.arrayBuffer()), aspect, c.id, ffmpeg);
  const drift = driftFromFirstFrame(clip, c.id, ffmpeg);
  if (drift > MAX_DRIFT) return retry(`drifted ${drift.toFixed(0)} from her portrait`);

  const { error } = await supabaseAdmin.storage
    .from("reels")
    .upload(reelPath(c.id), clip, { contentType: "video/mp4", upsert: true });
  if (error) return retry(`upload failed: ${error.message}`);
  return `published (drift ${drift.toFixed(0)})`;
}
