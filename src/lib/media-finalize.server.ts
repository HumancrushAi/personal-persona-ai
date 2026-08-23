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

// In the deployed function the ffmpeg binary sits at bin/ffmpeg, put there by
// the bundleFfmpeg plugin in vite.config.ts (Nitro's tracer only carries the JS
// shim, so relying on ffmpeg-static's own path 404s in production). Locally that
// copy doesn't exist and ffmpeg-static resolves to node_modules.
async function ffmpegBin(): Promise<string> {
  const { join } = await import("node:path");
  const { existsSync } = await import("node:fs");
  const bundled = join(process.cwd(), "bin", "ffmpeg");
  if (existsSync(bundled)) return bundled;
  const fromPkg = (await import("ffmpeg-static")).default as unknown as string;
  if (!fromPkg) throw new Error("ffmpeg binary not found");
  return fromPkg;
}

// ffmpeg-static ships no ffprobe, so duration comes from parsing ffmpeg's own
// stderr. It exits non-zero when given no output file, which is expected.
async function probeSeconds(file: string, ffmpegPath: string): Promise<number | null> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile(ffmpegPath, ["-i", file], (_e, _o, stderr) => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(stderr ?? ""));
      if (!m) return resolve(null);
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
  });
}

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
  const { tmpdir } = await import("node:os");
  const ffmpegPath = await ffmpegBin();

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

// The generation endpoint returns video with no audio track at all (confirmed:
// the mp4 carries a single h264 stream), so sound is added here.
//
// Every mp3 under avatars/audio/ is a candidate and one is picked at random per
// clip, so the same moan doesn't play on every video. A random offset into the
// track is used as well — the files are 36-47s and a clip is 5-10s, so starting
// at zero every time would make every clip open on the same breath.
//
// Volume is an admin setting rather than a constant: the right level depends on
// the source recording, and getting it wrong is the difference between realistic
// and comical.
async function muxAudio(mp4: Buffer): Promise<Buffer> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

  const { data: files } = await db.storage.from("avatars").list("audio", { limit: 100 });
  const tracks = (files ?? []).filter((f: { name: string }) => /\.(mp3|m4a|wav)$/i.test(f.name));
  if (!tracks.length) return mp4; // nothing uploaded — clip stays silent

  const pick = tracks[Math.floor(Math.random() * tracks.length)].name;
  const url = db.storage.from("avatars").getPublicUrl(`audio/${pick}`).data.publicUrl;
  const res = await fetch(url);
  if (!res.ok) return mp4;

  const { getAppSetting, settingNumber } = await import("./app-settings.server");
  const volume = Math.min(2, settingNumber(await getAppSetting("video_audio_volume"), 0.7));

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { writeFile, readFile, mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const ffmpegPath = await ffmpegBin();

  const dir = await mkdtemp(join(tmpdir(), "mux-"));
  try {
    const vid = join(dir, "in.mp4");
    const aud = join(dir, "in.mp3");
    const out = join(dir, "out.mp4");
    await writeFile(vid, mp4);
    await writeFile(aud, Buffer.from(await res.arrayBuffer()));

    // Start somewhere in the first 15s so clips don't all open on the same
    // breath. The clip is short and the tracks are 36-47s, so one loop is enough
    // — and a bounded input is required: afade's fade-out needs a known end, and
    // an earlier attempt at fading out with areverse over "-stream_loop -1"
    // crashed ffmpeg outright, because reversing buffers the whole stream and
    // that stream never ended.
    const seconds = (await probeSeconds(vid, ffmpegPath)) ?? 5;
    const offset = (Math.random() * 15).toFixed(1);
    const fadeOutAt = Math.max(0, seconds - 0.5).toFixed(2);

    // Video is copied rather than re-encoded, so this costs almost nothing.
    await promisify(execFile)(ffmpegPath, [
      "-y",
      "-i",
      vid,
      "-ss",
      offset,
      "-t",
      seconds.toFixed(2),
      "-i",
      aud,
      "-filter:a",
      `volume=${volume},afade=t=in:d=0.3,afade=t=out:st=${fadeOutAt}:d=0.5`,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      out,
    ]);
    return Buffer.from(await readFile(out));
  } catch {
    return mp4; // a bad audio file must not cost the user their video
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Moaning belongs on a chat clip of a female companion, not on a promo clip
// bound for a public page and not on a male companion. Studio jobs carry no
// conversation, which is also how they are excluded.
async function shouldAddAudio(job: Job): Promise<boolean> {
  if (job.kind !== "video" || !job.conversation_id) return false;
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data } = await db
    .from("conversations")
    .select("user_personalities(companions(gender))")
    .eq("id", job.conversation_id)
    .maybeSingle();
  const gender = (data as any)?.user_personalities?.companions?.gender ?? "female";
  return gender === "female" || gender === "trans-female";
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
  } else if (job.kind === "video" && gotVideo && (await shouldAddAudio(job))) {
    buf = await muxAudio(buf);
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
