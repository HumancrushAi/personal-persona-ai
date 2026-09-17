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
//
// Which frame, though, used to be "whichever one is 0.3s from the end" — and
// that is a coin toss. A video model does not hold an object still: across the
// last second a prop smears, fuses into the hand and comes back, and the photo
// the user paid for was simply whichever of those the clock landed on. So
// several candidates are cut instead and the sharpest is kept.
//
// It costs nothing worth measuring: the clip is already downloaded, ffmpeg
// decodes the same tail either way, and sharp is already a dependency. It is
// also not magic — sharpness rejects the smeared and half-melted frames, which
// is most of what reads as cheap, but a crisply rendered wrong object still
// scores well. That one needs a better renderer, not a better frame.
const FRAME_WINDOW_SECONDS = 1.2;
const FRAME_SAMPLE_FPS = 5;

/**
 * How much fine detail a frame carries.
 *
 * Variance of the Laplacian, the standard cheap focus measure: crisp edges give
 * a wide spread of second-derivative values, a smeared frame a narrow one.
 *
 * Computed on raw pixels rather than through sharp's convolve, which clamps.
 * Clamping throws the answer away here — the Laplacian of a hard edge is a
 * large positive and a large negative right next to each other, the negative
 * half floors at zero, and what survives is a thin saturated line through a
 * field of zeros. That scores LOWER than the broad mid-grey response of a
 * blurred edge, so the clamped version reliably picked the blurriest frame.
 * Measured on a test pattern: crisp 84, blurred 96.
 *
 * Frames are reduced to a common size first. That costs a little absolute
 * sensitivity and bounds the work at a fixed cost per frame, and since every
 * candidate gets the same treatment the ordering — the only thing used — holds.
 */
async function sharpness(png: Buffer): Promise<number> {
  try {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(png)
      .greyscale()
      .resize(512, 512, { fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width: w, height: h } = info;
    if (w < 3 || h < 3) return 0;

    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const lap = data[i - 1] + data[i + 1] + data[i - w] + data[i + w] - 4 * data[i];
        sum += lap;
        sumSq += lap * lap;
        n++;
      }
    }
    if (!n) return 0;
    const mean = sum / n;
    return sumSq / n - mean * mean;
  } catch {
    return 0;
  }
}

/** The crispest of the candidates. Exported for the test; not used elsewhere. */
export async function pickSharpest(frames: Buffer[]): Promise<Buffer | null> {
  if (!frames.length) return null;
  const scored = await Promise.all(frames.map(async (f) => ({ f, score: await sharpness(f) })));
  return scored.reduce((best, cur) => (cur.score > best.score ? cur : best)).f;
}

// ── The padding around a still that never moved ────────────────────────────
//
// squareStartFrame pads the companion's portrait into a square — the portrait
// at 62% of the height, top-centre, on a structureless colour wash — because
// the endpoint centre-crops anything that is not square. When a request makes
// the clip move, the model generates into that space. When it does not — a
// clothed request, or one it read as clothed — the clip holds the start frame,
// and the "photo" is the composite itself: a narrow strip of her in the top
// middle of a blurry square. That is the reported "it's only a partial pic".
//
// The wash is MEASURED rather than assumed. Its geometry depends on the
// portrait's aspect ratio, which is not known here, and on whether the clip
// generated into it, which is the whole question. A line of wash has almost no
// detail; anything rendered has texture. Bands are cut from the left, the right
// and the bottom only while they stay flat, and never from the top, where the
// portrait is anchored. So wherever the model did generate into the padding —
// legs into the bottom, an arm into a side — that band has detail and is kept.
//
// It fires only when BOTH sides are flat by a real margin. The composite always
// pads both sides of a portrait. A real photograph with a soft background on
// one side does not look like that, and is returned exactly as it came.
const BAND_MIN = 0.06; // a side band narrower than this is not padding
const FLAT_RATIO = 0.15; // flat = under 15% of the detail across the middle

/** Exported for the test; completeMediaJob is the only caller. */
export async function trimBackdrop(png: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(png)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    if (w < 64 || h < 64) return png;

    // Detail at each pixel: its difference from the neighbours right and below.
    const detail = new Float32Array(w * h);
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const i = y * w + x;
        detail[i] = Math.abs(data[i + 1] - data[i]) + Math.abs(data[i + w] - data[i]);
      }
    }

    // Averaged over a few neighbouring lines, so one stray compression artefact
    // in the wash cannot stop a trim and one soft line of hair cannot start one.
    // The same radius is then taken back off the edges, because averaging drags
    // the last few wash lines beside the portrait above the threshold.
    const radius = Math.max(2, Math.round(Math.max(w, h) / 100));
    const smooth = (v: Float64Array): Float64Array => {
      const pre = new Float64Array(v.length + 1);
      for (let i = 0; i < v.length; i++) pre[i + 1] = pre[i] + v[i];
      const out = new Float64Array(v.length);
      for (let i = 0; i < v.length; i++) {
        const a = Math.max(0, i - radius);
        const b = Math.min(v.length, i + radius + 1);
        out[i] = (pre[b] - pre[a]) / (b - a);
      }
      return out;
    };

    const colSum = new Float64Array(w);
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = 0; y < h; y++) s += detail[y * w + x];
      colSum[x] = s / h;
    }
    const cols = smooth(colSum);

    const middle = Array.from(cols.slice(Math.floor(w / 3), Math.ceil((2 * w) / 3))).sort(
      (a, b) => a - b,
    );
    const ref = middle[Math.floor(middle.length / 2)];
    // Nothing in the middle either: a blank or near-blank frame, not a composite.
    if (!(ref > 2)) return png;
    const flat = (e: number) => e < ref * FLAT_RATIO;

    let left = 0;
    while (left < w && flat(cols[left])) left++;
    let right = w;
    while (right > left && flat(cols[right - 1])) right--;
    if (left < w * BAND_MIN || w - right < w * BAND_MIN) return png;

    // Rows are measured only across the columns being kept. Across the full
    // width, every row would include both side bands and read as half-flat.
    const rowSum = new Float64Array(h);
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = left; x < right; x++) s += detail[y * w + x];
      rowSum[y] = s / (right - left);
    }
    const rows = smooth(rowSum);
    let bottom = h;
    while (bottom > 0 && flat(rows[bottom - 1])) bottom--;
    const trimBottom = h - bottom >= h * BAND_MIN;

    // In by the smoothing radius plus two: the boundary between portrait and
    // wash is itself a hard edge, and without this a hairline of wash is left
    // down each side.
    const inset = radius + 2;
    const L = left + inset;
    const R = right - inset;
    const B = trimBottom ? bottom - inset : h;
    if (R - L < w * 0.2 || B < h * 0.4) return png;

    return await sharp(png)
      .extract({ left: L, top: 0, width: R - L, height: B })
      .png()
      .toBuffer();
  } catch {
    // An untrimmed photo is worse than a trimmed one and far better than none.
    return png;
  }
}

async function extractLastFrame(mp4: Buffer): Promise<Buffer> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { writeFile, readFile, readdir, mkdtemp, rm } = await import("node:fs/promises");
  const { join: joinPath } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const ffmpegPath = await ffmpegBin();
  const run = promisify(execFile);

  const dir = await mkdtemp(joinPath(tmpdir(), "still-"));
  const inPath = joinPath(dir, "in.mp4");
  try {
    await writeFile(inPath, mp4);

    // Sample the tail of the clip, where the pose has resolved.
    await run(ffmpegPath, [
      "-y",
      "-sseof",
      `-${FRAME_WINDOW_SECONDS}`,
      "-i",
      inPath,
      "-vf",
      `fps=${FRAME_SAMPLE_FPS}`,
      "-frames:v",
      String(Math.ceil(FRAME_WINDOW_SECONDS * FRAME_SAMPLE_FPS)),
      joinPath(dir, "cand-%02d.png"),
    ]).catch(() => {
      /* fall through to the single-frame path below */
    });

    const names = (await readdir(dir)).filter((n) => n.startsWith("cand-")).sort();
    const frames = await Promise.all(names.map((n) => readFile(joinPath(dir, n))));
    const best = await pickSharpest(frames.map((f) => Buffer.from(f)));
    if (best) return best;

    // Nothing landed — a very short clip, or an ffmpeg build that dislikes the
    // filter. Fall back to exactly what this function used to do, because an
    // image job that returns no image is worse than an unchosen frame.
    const outPath = joinPath(dir, "out.png");
    await run(ffmpegPath, ["-y", "-sseof", "-0.3", "-i", inPath, "-frames:v", "1", outPath]);
    return Buffer.from(await readFile(outPath));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
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

// Chat photos are delivered at 640x640, and that is most of why they look cheap.
//
// The endpoint renders a 640-square clip (see start-frame.server.ts, which
// exists entirely to work around that crop), one frame of which becomes the
// photo. 640px is a small picture on a phone that will draw it at three device
// pixels per CSS pixel, and no amount of prompt work fixes a picture that is
// simply too small — the softness people read as "AI-looking" is partly just
// upscaling done by the browser, badly.
//
// Lanczos plus a light unsharp does that resize properly. It adds no detail
// that was not rendered; it stops the detail that WAS rendered from being
// smeared on the way to the screen. The sharpen is deliberately gentle: this
// codebase already learned that oversharpening is itself an AI tell.
//
// JPEG rather than PNG, because a photograph is what this is. A 1280 JPEG at
// q90 is roughly half the bytes of the 640 PNG it replaces, so the picture gets
// both bigger and faster. Nothing reads the stored extension — it is a URL in a
// message row — so the format is free to change.
const STILL_TARGET = 1280;

type Encoded = { buf: Buffer; ext: string; mime: string };

const AS_PNG = (buf: Buffer): Encoded => ({ buf, ext: "png", mime: "image/png" });

export async function enhanceStill(png: Buffer): Promise<Encoded> {
  try {
    const sharp = (await import("sharp")).default;
    const { width = 0, height = 0 } = await sharp(png).metadata();
    const side = Math.max(width, height);
    if (!side) return AS_PNG(png);

    let img = sharp(png);
    // Only ever enlarged, and never past 2x — beyond that Lanczos is inventing
    // pixels and it starts to look like exactly what it is. A larger render
    // (a real image endpoint, one day) is left alone.
    if (side < STILL_TARGET) {
      const scale = Math.min(2, STILL_TARGET / side);
      img = img
        .resize(Math.round(width * scale), Math.round(height * scale), { kernel: "lanczos3" })
        .sharpen({ sigma: 0.7, m1: 0.4, m2: 1.2 });
    }

    const buf = await img
      .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" })
      .toBuffer();
    return { buf, ext: "jpg", mime: "image/jpeg" };
  } catch {
    // A photo that stores is worth more than a photo that is slightly crisper.
    return AS_PNG(png);
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

  // Chat photos only. A studio job has no conversation, and its plate goes on to
  // the banner compositor, which does its own grading and sharpening — running
  // this first would sharpen it twice and re-encode a source that is about to be
  // re-encoded again. The banner pipeline is settled; leave it exactly as it is.
  let still: Encoded | null = null;
  if (job.kind === "image" && job.conversation_id) {
    // Before the upscale, so the 2x enlargement is spent on her and not on the
    // padding. Only for a frame cut from a clip: a real image endpoint renders
    // no start-frame composite, so there is nothing of ours to cut away.
    if (gotVideo) buf = await trimBackdrop(buf);
    still = await enhanceStill(buf);
    buf = still.buf;
  }

  const isVideo = job.kind === "video";
  const fileExt = isVideo ? "mp4" : job.kind === "voice" ? "mp3" : (still?.ext ?? "png");
  const mimeType = isVideo
    ? "video/mp4"
    : job.kind === "voice"
      ? "audio/mpeg"
      : (still?.mime ?? "image/png");
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

    // Send automated push notification for completed media
    try {
      const { sendPushToUser } = await import("@/lib/notify");
      const { data: conv } = await supabaseAdmin
        .from("conversations")
        .select("user_personalities(nickname)")
        .eq("id", job.conversation_id)
        .maybeSingle();
      const nick = (conv as any)?.user_personalities?.nickname ?? "She";
      const title = `${nick} sent you a ${job.kind === "video" ? "video 🎬" : "photo 📸"}`;
      const body =
        job.kind === "video"
          ? `${nick} made a clip just for you…`
          : `${nick} took a photo for you…`;
      await sendPushToUser(job.user_id, {
        title,
        body,
        url: `/chat/${job.conversation_id}`,
      });
    } catch {
      /* push best-effort */
    }
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
