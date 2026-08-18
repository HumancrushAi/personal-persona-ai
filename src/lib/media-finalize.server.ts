// Shared finalize logic for async media jobs, used by BOTH the Replicate webhook
// (fast path) and the client-driven reconcile poll (checkMediaJob, reliable path).
// Completion must not depend on the webhook landing, so this lives in one place.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Job = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  kind: string;
  cost: number;
};

// A photo request is rendered on the image-to-video endpoint, because that is
// the only uncensored model on the account — the shared FLUX Kontext image model
// returns her clothed for any nudity request whatever the prompt says. So the
// clip comes back here and the last frame is cut out of it into a real PNG: an
// image job must produce an image file, not a video the UI pretends is a photo.
//
// -sseof seeks relative to the END, which is where the requested pose has fully
// resolved (the clip starts from her clothed portrait and moves into it). Pulling
// the frame earlier was tried to dodge the camera drift that crops her head on
// act-heavy prompts; on a test clip the drift had already happened by then, so
// it bought nothing and the offset stayed where it was.
async function extractLastFrame(mp4: Buffer): Promise<Buffer> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { writeFile, readFile, unlink, mkdtemp } = await import("node:fs/promises");
  const { join: joinPath } = await import("node:path");
  const { existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  // In the deployed function the binary sits at bin/ffmpeg, put there by the
  // bundleFfmpeg plugin in vite.config.ts (Nitro's tracer only carries the JS
  // shim, so relying on ffmpeg-static's own path 404s in production). Locally
  // that copy doesn't exist and ffmpeg-static resolves to node_modules.
  const bundled = joinPath(process.cwd(), "bin", "ffmpeg");
  const ffmpegPath = existsSync(bundled)
    ? bundled
    : ((await import("ffmpeg-static")).default as unknown as string);
  if (!ffmpegPath) throw new Error("ffmpeg binary not found for still extraction");

  const dir = await mkdtemp(joinPath(tmpdir(), "still-"));
  const inPath = joinPath(dir, "in.mp4");
  const outPath = joinPath(dir, "out.png");
  try {
    await writeFile(inPath, mp4);
    await promisify(execFile)(ffmpegPath, [
      "-y",
      "-sseof",
      "-0.3",
      "-i",
      inPath,
      "-frames:v",
      "1",
      outPath,
    ]);
    return Buffer.from(await readFile(outPath));
  } finally {
    await Promise.all([unlink(inPath).catch(() => {}), unlink(outPath).catch(() => {})]);
  }
}

// Download a finished Replicate output, store it in the avatars bucket, mark the
// job completed, and post the media message. Throws on storage failure so the
// caller can mark the job failed + refund.
export async function completeMediaJob(job: Job, outputUrl: string): Promise<string> {
  const response = await fetch(outputUrl);
  if (!response.ok) throw new Error("Could not fetch generation output");
  let buf: Buffer = Buffer.from(await response.arrayBuffer());

  // What came back is not always what the job asked for: a photo job renders on
  // the video endpoint, so it arrives as an mp4 and has to be cut down to a
  // single frame before it is stored.
  const gotVideo =
    /video\//i.test(response.headers.get("content-type") ?? "") ||
    /\.(mp4|webm|mov)(\?|$)/i.test(outputUrl);
  if (job.kind === "image" && gotVideo) {
    buf = await extractLastFrame(buf);
  }

  const isVideo = job.kind === "video";
  const fileExt = isVideo ? "mp4" : job.kind === "voice" ? "mp3" : "png";
  const mimeType = isVideo ? "video/mp4" : job.kind === "voice" ? "audio/mpeg" : "image/png";
  const path = `generated/${job.user_id}/${job.id}.${fileExt}`;

  try {
    await supabaseAdmin.storage.createBucket("avatars", { public: true });
  } catch {
    /* already exists */
  }

  const { error: upErr } = await supabaseAdmin.storage
    .from("avatars")
    .upload(path, buf, { contentType: mimeType, upsert: true });
  if (upErr) throw upErr;

  const { data: pub } = supabaseAdmin.storage.from("avatars").getPublicUrl(path);
  const mediaUrl = pub.publicUrl;

  // Only flip processing -> completed once; if another path already completed
  // it, skip the duplicate chat message.
  const { data: claimed } = await supabaseAdmin
    .from("media_jobs")
    .update({ status: "completed", media_url: mediaUrl, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .neq("status", "completed")
    .select("id")
    .maybeSingle();

  if (claimed && job.conversation_id) {
    await supabaseAdmin.from("messages").insert({
      conversation_id: job.conversation_id,
      user_id: job.user_id,
      role: "assistant",
      content: job.kind === "video" ? "*sends you a video* 🎬" : "*sends you a photo* 😈",
      kind: job.kind,
      media_url: mediaUrl,
    });
  }

  return mediaUrl;
}

// Mark a job failed and refund its cost. Idempotent: the ledger's unique
// idempotency_key guards against a double refund if both the webhook and the
// poll try to fail the same job.
export async function failMediaJob(job: Job, errorMsg: string): Promise<void> {
  await supabaseAdmin
    .from("media_jobs")
    .update({ status: "failed", error: errorMsg, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  try {
    const { data: bal } = await supabaseAdmin
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits")
      .eq("user_id", job.user_id)
      .maybeSingle();
    const free = bal?.free_messages_remaining ?? 0;
    const paid = bal?.paid_credits ?? 0;
    const newPaid = paid + job.cost;

    // Ledger first — the unique key makes this the refund's lock. If it conflicts,
    // someone already refunded this job, so don't touch the balance again.
    const { error: ledgerErr } = await supabaseAdmin.from("credit_ledger").insert({
      user_id: job.user_id,
      delta: job.cost,
      reason: "refund_credit",
      balance_after: free + newPaid,
      idempotency_key: `refund-${job.id}`,
    });
    if (ledgerErr) return;

    await supabaseAdmin
      .from("credit_balances")
      .update({ paid_credits: newPaid })
      .eq("user_id", job.user_id);

    if (job.conversation_id) {
      const kindStr = job.kind === "video" ? "video" : "photo";
      await supabaseAdmin.from("messages").insert({
        conversation_id: job.conversation_id,
        user_id: job.user_id,
        role: "assistant",
        content: `Sorry, I had trouble generating that ${kindStr}. Your credits have been refunded! 🥺❤️`,
        kind: "text",
      });
    }
  } catch (e: any) {
    console.error("Refund failed in media finalize", e);
  }
}
