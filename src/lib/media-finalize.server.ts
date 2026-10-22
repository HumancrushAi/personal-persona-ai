// Shared finalize logic for async media jobs, used by BOTH the Replicate webhook
// (fast path) and the client-driven reconcile poll (checkMediaJob, reliable path).
// Completion must not depend on the webhook landing, so this lives in one place.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  evaluateSocialOutput,
  logSocialModerationBlock,
  SocialModerationBlockedError,
} from "./social-moderation.server";
import { contentModeFromPrompt } from "./social-safety";

type Job = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  kind: string;
  cost: number;
  /** Which renderer ran it (runpod, runpod-still, …); the retry only touches a plain runpod photo. */
  provider?: string | null;
  content_mode?: "social" | "adult" | null;
  prompt?: string | null;
};

// In the deployed function the ffmpeg binary sits at bin/ffmpeg, put there by
// the bundleFfmpeg plugin in vite.config.ts (Nitro's tracer only carries the JS
// shim, so relying on ffmpeg-static's own path 404s in production). Locally that
// copy doesn't exist and ffmpeg-static resolves to node_modules.
export async function ffmpegBin(): Promise<string> {
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
// 15 candidates rather than 6. The clip is already downloaded and decoded, so
// the whole cost of doubling the sample rate is a Laplacian over nine more
// 512px frames — and the odds that at least one frame has a cleanly resolved
// groin in it go up with every candidate. "No bad output at all" is partly just
// this: the failures are a minority of frames, so look at more of them.
const FRAME_WINDOW_SECONDS = 1.5;
const FRAME_SAMPLE_FPS = 10;

// Where the part that matters actually is.
//
// Every one of these compositions puts her hips in the middle of the frame and
// her body down the centre (framingFor in selfie.ts writes the camera that
// way), so the anatomy an explicit request is about lands in this box. A whole
// frame scores well when her face and hair are crisp while the groin is a
// smear, which is exactly the picture people call bad — so the box is scored on
// its own and weighted above the frame around it.
const BODY_REGION = { x0: 0.22, x1: 0.78, y0: 0.42, y1: 0.92 };
const REGION_WEIGHT = 0.7;

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
async function sharpness(
  png: Buffer,
  region?: { x0: number; x1: number; y0: number; y1: number },
): Promise<number> {
  try {
    const sharp = (await import("sharp")).default;
    let img = sharp(png);
    if (region) {
      const { width = 0, height = 0 } = await img.metadata();
      const left = Math.round(width * region.x0);
      const top = Math.round(height * region.y0);
      const w = Math.round(width * (region.x1 - region.x0));
      const h = Math.round(height * (region.y1 - region.y0));
      // A frame too small to crop is scored whole rather than not at all.
      if (w >= 16 && h >= 16 && left + w <= width && top + h <= height) {
        img = sharp(png).extract({ left, top, width: w, height: h });
      }
    }
    const { data, info } = await img
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

/**
 * The candidate whose body is crispest. Exported for the test.
 *
 * Both halves count: the body region decides it, and the frame as a whole is
 * still worth 30% so a frame that is sharp in the middle and falling apart
 * around it does not win.
 */
export async function pickSharpest(frames: Buffer[]): Promise<Buffer | null> {
  if (!frames.length) return null;
  const scored = await Promise.all(
    frames.map(async (f) => {
      const [body, whole] = await Promise.all([sharpness(f, BODY_REGION), sharpness(f)]);
      return { f, score: REGION_WEIGHT * body + (1 - REGION_WEIGHT) * whole };
    }),
  );
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

export async function extractLastFrame(mp4: Buffer): Promise<Buffer> {
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

/** Nine evenly sampled timeline panels for checking continuity and motion. */
export async function extractVideoContactSheet(mp4: Buffer): Promise<Buffer> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { writeFile, readFile, mkdtemp, rm } = await import("node:fs/promises");
  const { join: joinPath } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(joinPath(tmpdir(), "video-audit-"));
  const input = joinPath(dir, "in.mp4");
  const output = joinPath(dir, "sheet.jpg");
  try {
    await writeFile(input, mp4);
    await promisify(execFile)(await ffmpegBin(), [
      "-y", "-i", input,
      "-vf", "fps=2,scale=320:-1,tile=3x3:padding=2:margin=2",
      "-frames:v", "1", "-q:v", "3", output,
    ]);
    return Buffer.from(await readFile(output));
  } catch {
    return extractLastFrame(mp4);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Sample visual frames before a video is stored. No frame is persisted. */
export async function extractVideoFrames(mp4: Buffer, count = 6): Promise<Buffer[]> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { writeFile, readFile, readdir, mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "video-safety-"));
  const input = join(dir, "in.mp4");
  try {
    await writeFile(input, mp4);
    await promisify(execFile)(await ffmpegBin(), [
      "-y", "-i", input,
      "-vf", `fps=${Math.max(0.2, count / 10)},scale=512:-1:force_original_aspect_ratio=decrease`,
      "-frames:v", String(count),
      join(dir, "frame-%02d.png"),
    ]);
    const names = (await readdir(dir)).filter((name) => /^frame-\d+\.png$/.test(name)).sort();
    const frames = await Promise.all(names.map((name) => readFile(join(dir, name))));
    return frames.map((frame) => Buffer.from(frame));
  } catch {
    try {
      return [await extractLastFrame(mp4)];
    } catch {
      return [];
    }
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
//
// Current stills are rendered at 768x1152. Never enlarge those generated
// pixels again: the old 1600px target magnified sampler texture by 1.39x and
// made otherwise usable skin look coarse and blurry in the viewer.
const STILL_TARGET = 1152;

function numberEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * The same phone-camera finish for a clip: fine grain, a touch less
 * saturation. The original bytes come back if ffmpeg cannot do it.
 */
export async function filmGrainVideo(mp4: Buffer): Promise<Buffer> {
  const { mkdtemp, rm, readFile, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const strength = numberEnv("VIDEO_GRAIN", 6);
  if (!strength) return mp4;
  const dir = await mkdtemp(join(tmpdir(), "grain-"));
  try {
    const inp = join(dir, "in.mp4");
    const out = join(dir, "out.mp4");
    await writeFile(inp, mp4);
    await promisify(execFile)(await ffmpegBin(), [
      "-y", "-loglevel", "error", "-i", inp,
      "-vf", `noise=alls=${strength}:allf=t+u,eq=saturation=0.96`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", "-c:a", "copy", out,
    ]);
    const res = await readFile(out);
    return res.length > 1000 ? res : mp4;
  } catch (e: any) {
    console.warn("video grain skipped:", e?.message ?? e);
    return mp4;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

type Encoded = { buf: Buffer; ext: string; mime: string };

const AS_PNG = (buf: Buffer): Encoded => ({ buf, ext: "png", mime: "image/png" });

export async function enhanceStill(png: Buffer): Promise<Encoded> {
  try {
    const sharp = (await import("sharp")).default;
    const { width = 0, height = 0 } = await sharp(png).metadata();
    const side = Math.max(width, height);
    if (!side) return AS_PNG(png);

    // A native-size render is already the highest-quality artifact we have.
    // Preserve its lossless bytes instead of blurring, adding synthetic grain,
    // then recompressing it as JPEG.
    if (side >= STILL_TARGET) return AS_PNG(png);

    let img = sharp(png);
    // Only ever enlarged, and never past 2x — beyond that Lanczos is inventing
    // pixels and it starts to look like exactly what it is. A larger render
    // (a real image endpoint, one day) is left alone.
    let w = width;
    let h = height;
    if (side < STILL_TARGET) {
      const scale = Math.min(2, STILL_TARGET / side);
      w = Math.round(width * scale);
      h = Math.round(height * scale);
      img = img.resize(w, h, { kernel: "lanczos3" });
    }

    // Legacy smaller renders get one clean Lanczos resize and a very light
    // sharpen, then remain lossless. No blur, tonal wash, grain, or JPEG pass.
    const buf = await img.sharpen({ sigma: 0.6, m1: 0.35, m2: 0.15 }).png().toBuffer();
    return AS_PNG(buf);
  } catch {
    // A photo that stores is worth more than a photo that is slightly crisper.
    return AS_PNG(png);
  }
}

// Moaning belongs on a chat clip of a female companion, not on a promo clip
// bound for a public page and not on a male companion. Studio jobs carry no
// conversation, which is also how they are excluded.
// Off. The stock moaning track played behind every clip and read as fake
// background music rather than her voice, so clips ship silent until there is a
// voice that is actually hers. Set true to bring the track back.
const ADD_VIDEO_AUDIO = false;

async function shouldAddAudio(job: Job): Promise<boolean> {
  if (!ADD_VIDEO_AUDIO) return false;
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

function providerModelFor(job: Job): string {
  if (job.provider === "runpod-still" || job.provider === "runpod-advancing") {
    return process.env.COMFY_CHECKPOINT || "comfy-workflow";
  }
  if (job.kind === "video") return process.env.RUNPOD_VIDEO_MODEL || process.env.RUNPOD_VIDEO_ENDPOINT || "runpod-wan";
  if (process.env.RUNPOD_COMFY_ENDPOINT) return process.env.COMFY_CHECKPOINT || "comfy-workflow";
  if (process.env.RUNPOD_KONTEXT_ENDPOINT) return process.env.RUNPOD_KONTEXT_ENDPOINT;
  return process.env.RUNPOD_IMAGE_ENDPOINT || process.env.RUNPOD_VIDEO_ENDPOINT || "runpod-image";
}

// Download a finished RunPod output, moderate it, store it in the avatars bucket, mark the
// job completed, and post the media message. Throws on storage failure so the
// caller can mark the job failed + refund.
export async function completeMediaJob(job: Job, outputUrl: string, providerOutput?: unknown): Promise<string | null> {
  const response = await fetch(outputUrl);
  if (!response.ok) throw new Error("Could not fetch generation output");
  let buf: Buffer = Buffer.from(await response.arrayBuffer());

  // What came back is not always what the job asked for: a photo job renders on
  // the video endpoint, so it arrives as an mp4 and has to be cut down to a
  // single frame before it is stored.
  const gotVideo =
    /video\//i.test(response.headers.get("content-type") ?? "") ||
    /\.(mp4|webm|mov)(\?|$)/i.test(outputUrl);
  if (job.kind === "video" && gotVideo && (await retakeBadToyVideo(job, buf))) return null;
  if (job.kind === "video" && gotVideo) buf = await filmGrainVideo(buf);
  if (job.kind === "image" && gotVideo) {
    buf = await extractLastFrame(buf);
  } else if (job.kind === "video" && gotVideo && (await shouldAddAudio(job))) {
    buf = await muxAudio(buf);
  }

  // This is deliberately before any bucket upload. A social render that fails
  // moderation never obtains a public URL and is therefore never returned or
  // retained as a library asset.
  const socialJob = job.content_mode === "social" || contentModeFromPrompt(job.prompt) === "social";
  if (socialJob) {
    // A provider may omit or mislabel the response content type. The job kind
    // is authoritative here: videos are always sampled as videos, and a
    // missing frame is a fail-closed moderation result rather than an MP4
    // being mislabeled as a PNG input.
    const samples = job.kind === "video" ? await extractVideoFrames(buf, 6) : [buf];
    const decision = await evaluateSocialOutput({ providerOutput, samples });
    if (!decision.allowed) {
      logSocialModerationBlock({
        userId: job.user_id,
        prompt: job.prompt,
        model: providerModelFor(job),
        provider: job.provider || "runpod",
        decision,
      });
      throw new SocialModerationBlockedError(decision);
    }
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
  // A retake must not overwrite the candidate it is being compared with.
  const { data: rowNow } = await supabaseAdmin
    .from("media_jobs")
    .select("error, status")
    .eq("id", job.id)
    .maybeSingle();
  if (rowNow?.status === "completed") return null;
  const { attemptsSoFar } = await import("./photo-check");
  const attempt = attemptsSoFar(rowNow?.error);
  const path = `generated/${job.user_id}/${job.id}${attempt ? `-r${attempt}` : ""}.${fileExt}`;

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
  let mediaUrl = pub.publicUrl;

  // A hard act is checked before she sends it — see photo-check.ts.
  if (job.kind === "image" && job.provider === "runpod" && job.conversation_id) {
    const verdict = await verifiedOrRetake(job, rowNow?.error ?? null, attempt, mediaUrl);
    if (verdict === null) return null;
    mediaUrl = verdict;
  }

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
      // The image IS the message. This wrote a stage direction as the caption,
      // so a delivered photo arrived with "*sends you a photo* 😈" printed under
      // it — the exact broken-looking text the system prompt spends its effort
      // forbidding her to type, written by the app itself. The chat UI skips an
      // empty caption on a media message and renders just the picture.
      content: "",
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
        // Its own tag, so the text reply that follows does not replace it.
        tag: `media-${job.id}`,
      });
    } catch {
      /* push best-effort */
    }
  }

  return mediaUrl;
}

// A worker that ran out of GPU memory, as opposed to a request that cannot
// render. "FaceDetailer: VRAM grow failed: 295936 bytes" — a worker that
// could not find 289 KB was already full before this job arrived, and the
// next worker RunPod hands the job to almost certainly is not.
const WORKER_MEMORY_ERROR = /VRAM|out of memory|\bOOM\b|CUDA (?:error|out)|cudaMalloc|failed to allocat/i;
// The pose guide's model is not on this worker yet (the image has not been
// rolled out, or the download failed). Rendered again without the guide.
const POSE_MODEL_ERROR = /ControlNetLoader|control_net_name|controlnet|OpenPoseXL2/i;
const RETRY_MARK = "retry 1 after: ";
// While the retry is being prepared the row carries this instead of a RunPod
// id, so a status poll that still holds the OLD id cannot mistake the old
// failure for the retry's (see retryImageJob) — and polls on this id simply
// keep polling.
const RETRYING_ID = "retrying";
// RunPod hands a job to the warm worker first. The worker that just ran out
// of memory IS the warm worker, and an immediate resubmit went straight back
// to it and failed the same way (seen twice). Waiting past the endpoint's
// idle timeout lets that worker be torn down, so the retry starts on a clean
// one. MEDIA_RETRY_DELAY_MS overrides.
const RETRY_DELAY_MS = Number(process.env.MEDIA_RETRY_DELAY_MS || 45_000);

// One more go, on the same prompt with a fresh seed, before the user is told
// it failed. Only for a ComfyUI photo, only for a memory error, only once.
//
// The job row does not keep the request body, so it is rebuilt from what the
// row does keep: the finished prompt, the user message that asked for the
// photo, and the companion's portrait — the same three inputs startImageJob
// used, minus the refiner's avoid list, which a retry can live without.
//
// Both the webhook and the status poll can see the same failure, so the retry
// is claimed atomically: the first caller to write the marker into `error`
// resubmits, the other sees the row already claimed and leaves it alone.
// What a job needs to be rendered again: its prompt, the message that asked
// for it, and the companion. Shared by the memory retry and the retake.
type JobContext = {
  row: { id: string; prompt: string; created_at: string; conversation_id: string };
  companion: { gender?: string | null; image_url?: string | null; age?: number | null };
  userRequest: string;
  /** The chest toy the job was rendered with, so a retake pushes away the same wrong toys. */
  toy: import("./toys").Toy | null;
};

async function jobContext(jobId: string): Promise<JobContext | null> {
  const { data: row } = await supabaseAdmin
    .from("media_jobs")
    .select("id, prompt, created_at, conversation_id, user_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!row?.prompt || !row.conversation_id) return null;
  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select("user_personalities(companions(name, age, ethnicity, gender, image_url))")
    .eq("id", row.conversation_id)
    .maybeSingle();
  const companion: any = (conv as any)?.user_personalities?.companions ?? {};
  // The message that asked for this photo — the user's last one before the
  // job was written — resolved against the conversation the same way the
  // chat path resolved it when the job was made. Read raw, "send another
  // one" rebuilt the retake's tags and the vision check from the words
  // "another one".
  const { data: newestFirst } = await supabaseAdmin
    .from("messages")
    .select("role, content, kind")
    .eq("conversation_id", row.conversation_id)
    .lte("created_at", row.created_at)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(30);
  const history = (newestFirst ?? []).slice().reverse() as {
    role: string;
    content: string | null;
    kind?: string | null;
  }[];
  const asked = [...history]
    .reverse()
    .find((m) => m.role === "user" && typeof m.content === "string" && m.content.trim());
  const { resolveMediaRequest } = await import("./selfie");
  const userRequest = asked ? resolveMediaRequest(asked.content as string, history).request : "";
  let toy: JobContext["toy"] = null;
  if (userRequest && row.user_id) {
    try {
      const { ownedToysAdmin } = await import("./toys.server");
      const { resolveToy } = await import("./toys");
      toy = resolveToy(userRequest, await ownedToysAdmin(row.user_id)).toy;
    } catch {
      /* a retake without the toy negative is still a retake */
    }
  }
  return {
    row: row as JobContext["row"],
    companion,
    userRequest,
    toy,
  };
}

// A job the endpoint never picked up — IN_QUEUE for minutes with no worker
// taking it — is cancelled and sent again, once. The second submission often
// lands on a worker that has started in the meantime; a job that sits in the
// same queue is no worse off, and either way the user sees why it is slow
// instead of a flat failure at the fifteen-minute mark.
const REQUEUE_MARK = "requeued after waiting for a worker";
const REQUEUE_AFTER_MS = Number(process.env.MEDIA_REQUEUE_AFTER_MS || 5 * 60_000);

export async function requeueIfStuck(
  job: Job & { replicate_id?: string | null; created_at?: string; error?: string | null },
  endpoint: string,
  runpodStatus: string,
): Promise<boolean> {
  if (job.kind !== "image" || job.provider !== "runpod") return false;
  if (String(runpodStatus).toUpperCase() !== "IN_QUEUE") return false;
  const age = Date.now() - new Date(job.created_at ?? Date.now()).getTime();
  if (age < REQUEUE_AFTER_MS) return false;
  if (String(job.error ?? "").includes(REQUEUE_MARK)) return false;
  // Claim it: compare-and-set on the error column, as the retry does.
  const claim = supabaseAdmin
    .from("media_jobs")
    .update({ error: [job.error, REQUEUE_MARK].filter(Boolean).join("\n"), updated_at: new Date().toISOString() })
    .eq("id", job.id);
  const { data: claimed } = await (job.error == null ? claim.is("error", null) : claim.eq("error", job.error)).select("id");
  if (!claimed?.length) return false;
  try {
    const { runpodCancel, targetFor } = await import("./runpod");
    const where = targetFor(endpoint, job.replicate_id);
    if (where.endpoint && where.id) await runpodCancel(where.endpoint, where.id);
    const ctx = await jobContext(job.id);
    if (!ctx) return false;
    const id = await resubmitImageJob(ctx, `requeue-${job.id}`);
    console.warn(`media job ${job.id} requeued as ${id} after ${Math.round(age / 1000)}s in the queue`);
    return true;
  } catch (e: any) {
    console.error("requeue failed", job.id, e?.message ?? e);
    return false;
  }
}

// Render the same job again with a fresh seed; returns the new RunPod id.
async function resubmitImageJob(
  ctx: JobContext,
  seedSalt: string,
  opts: {
    noPose?: boolean;
    graph?: "faceid-lite" | "img2img";
    memorySafe?: boolean;
  } = {},
): Promise<string> {
  const { anatomyOf } = await import("./anatomy");
  const { comfyJobInput, negativeFor, isExplicitMediaRequest, resolveHostedImage, webhookFor } =
    await import("./media.functions");
  const { stripContentModeMarker } = await import("./social-safety");
  const { runpodEndpoint, runpodRun, pickImageTarget, tagJobId } = await import("./runpod");
  const endpoint = runpodEndpoint("image");
  if (!endpoint) throw new Error("no image endpoint");
  const negative = negativeFor(ctx.userRequest, ctx.companion.gender, {
    moving: false,
    age: ctx.companion.age,
    toy: ctx.toy,
    socialSafe: !isExplicitMediaRequest(ctx.userRequest),
  });
  const input = await comfyJobInput(
    stripContentModeMarker(ctx.row.prompt),
    negative,
    resolveHostedImage(ctx.companion.image_url),
    ctx.userRequest,
    seedSalt,
    {
      ...opts,
      hasPenis: anatomyOf(ctx.companion.gender).hasPenis,
      toyTags: ctx.toy?.tags ?? null,
      toyKind: ctx.toy?.kind ?? null,
      lookTags: (await import("./media.functions")).inkTags(await (await import("./look.server")).companionLook(ctx.companion.image_url)),
      // The same composed frame the first render started from, when it had one;
      // otherwise her portrait, as the first render did.
      startFrame: await (await import("./compose.server")).storedStartFrame(ctx.row.id),
      startFromPortrait: (await import("./compose.server")).composeMode() === "portrait",
      socialSafe: !isExplicitMediaRequest(ctx.userRequest),
    },
  );
  const target = await pickImageTarget(supabaseAdmin, endpoint);
  let sentTo = endpoint;
  let id: string;
  try {
    if (!target.pod || !target.endpoint) throw new Error("serverless");
    id = (await runpodRun(target.endpoint, input)).id;
    sentTo = target.endpoint;
  } catch {
    id = (await runpodRun(endpoint, input, webhookFor("runpod"))).id;
  }
  await supabaseAdmin
    .from("media_jobs")
    .update({ replicate_id: tagJobId(id, sentTo), status: "processing", updated_at: new Date().toISOString() })
    .eq("id", ctx.row.id);
  return tagJobId(id, sentTo);
}

// The vision check: 0-10 for how clearly the picture shows the act, null
// when it cannot be scored (no key, refusal, timeout). OpenRouter, because
// the chat already runs there and its vision models answer about adult
// images. VISION_VERIFY_MODEL overrides the model.
async function scorePhoto(url: string, question: string, jobId = ""): Promise<number | null> {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const xaiKey = process.env.XAI_API_KEY;
  const key = openRouterKey || xaiKey;
  if (!key) {
    console.warn(`photo check ${jobId}: no OPENROUTER_API_KEY or XAI_API_KEY, not scored`);
    return null;
  }
  const endpoint = openRouterKey
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.x.ai/v1/chat/completions";
  const model = openRouterKey
    ? process.env.VISION_VERIFY_MODEL || "qwen/qwen2.5-vl-72b-instruct"
    : process.env.XAI_VISION_MODEL || process.env.XAI_MODEL || "grok-4-1-fast-non-reasoning";
  const { verifyPrompt, parseScore } = await import("./photo-check");
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 8,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: verifyPrompt(question) },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.warn(`photo check ${jobId}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
      return null;
    }
    const json = await res.json();
    const reply = json.choices?.[0]?.message?.content;
    const score = parseScore(reply);
    console.warn(`photo check ${jobId}: score ${score} reply ${JSON.stringify(String(reply ?? "")).slice(0, 120)}`);
    return score;
  } catch (e: any) {
    console.warn(`photo check ${jobId}: ${e?.message ?? e}`);
    return null;
  }
}

// WAN can preserve a clean start frame and still invent an external hand or
// rotate a toy away from its contact point during motion. Check a resolved tail
// frame before delivery and rerun the same clip with a fresh seed. This gate is
// shared by every owned toy through verifyQuestion.
async function retakeBadToyVideo(job: Job, mp4: Buffer): Promise<boolean> {
  if (job.kind !== "video" || job.provider !== "runpod" || !job.conversation_id) return false;
  const { data: row } = await supabaseAdmin
    .from("media_jobs")
    .select("prompt, provider, status")
    .eq("id", job.id)
    .maybeSingle();
  if (!row || row.provider !== "runpod" || row.status === "completed") return false;

  let parked: {
    stage: "video";
    contentMode?: "social" | "adult";
    videoInput: Record<string, any>;
    videoPrompt: string;
    startFrame: string;
    attempt?: number;
  };
  try {
    parked = JSON.parse(row.prompt);
  } catch {
    return false;
  }
  if (parked.stage !== "video" || !parked.startFrame || !parked.videoInput) return false;

  const ctx = await jobContext(job.id);
  if (!ctx) return false;
  const { anatomyOf } = await import("./anatomy");
  const { verifyQuestion, PASS_SCORE, DEFAULT_RETAKES } = await import("./photo-check");
  const anatomy = anatomyOf(ctx.companion.gender);
  const question = verifyQuestion(ctx.userRequest, anatomy.hasBreasts, anatomy.hasVulva, ctx.toy);
  if (!question) return false;

  const tail = await extractVideoContactSheet(mp4);
  const score = await scorePhoto(
    `data:image/jpeg;base64,${tail.toString("base64")}`,
    `This image is a chronological contact sheet covering the entire generated video. Score the requested action across ALL panels, not merely the best panel. The geometry must remain correct and the requested motion must visibly progress across the sequence. If the object stays in one place, remains fully outside, floats over the surface, morphs, or is correct in only some panels, score 0-2. ${question}`,
    `${job.id}-video`,
  );
  if (score === null || score >= PASS_SCORE) return false;
  const attempt = parked.attempt ?? 0;
  const maxRetakes = Number(process.env.MEDIA_VIDEO_RETAKES || DEFAULT_RETAKES);
  if (attempt >= maxRetakes) {
    throw new Error(`Video quality check failed after ${attempt + 1} attempts (score ${score})`);
  }

  const { data: claimed } = await supabaseAdmin
    .from("media_jobs")
    .update({ provider: "runpod-video-retrying", updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("provider", "runpod")
    .select("id");
  if (!claimed?.length) return true;

  const nextAttempt = attempt + 1;
  const nextInput = {
    ...parked.videoInput,
    seed: (Number(parked.videoInput.seed) || Date.now()) + 104729 * nextAttempt,
    image_url: parked.startFrame,
  };
  const { runpodEndpoint, runpodRun } = await import("./runpod");
  const { webhookFor } = await import("./media.functions");
  const endpoint = runpodEndpoint("video");
  if (!endpoint) throw new Error("RUNPOD_VIDEO_ENDPOINT is not configured");
  const result = await runpodRun(endpoint, nextInput, webhookFor("runpod"));
  await supabaseAdmin
    .from("media_jobs")
    .update({
      replicate_id: result.id,
      provider: "runpod",
      status: "processing",
      prompt: JSON.stringify({ ...parked, videoInput: nextInput, attempt: nextAttempt }),
      error: `video retake ${nextAttempt} after score ${score}`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  return true;
}

// For a checked act: the URL she should send (this candidate or a better
// earlier one), or null when the job has been sent back for another render.
// Candidates and their scores live in the row's error column as lines; the
// retake is claimed with a compare-and-set on that column, so the webhook and
// the status poll cannot both resubmit.
async function verifiedOrRetake(
  job: Job,
  errorNow: string | null,
  attempt: number,
  mediaUrl: string,
): Promise<string | null> {
  const ctx = await jobContext(job.id);
  if (!ctx) return mediaUrl;
  const { anatomyOf } = await import("./anatomy");
  const { verifyQuestion, parseCandidates, candidateLine, bestCandidate, shouldRetake, DEFAULT_RETAKES, maxRetakesFor } =
    await import("./photo-check");
  const anat = anatomyOf(ctx.companion.gender);
  const question = verifyQuestion(ctx.userRequest, anat.hasBreasts, anat.hasVulva, ctx.toy);
  if (!question) return mediaUrl;

  const score = await scorePhoto(mediaUrl, question, job.id);
  const all = [...parseCandidates(errorNow), { url: mediaUrl, score }];
  const maxRetakes = maxRetakesFor(question, Number(process.env.MEDIA_RETAKES || DEFAULT_RETAKES));
  if (!shouldRetake(score, attempt, maxRetakes)) {
    const best = bestCandidate(all);
    if (best.url !== mediaUrl)
      console.warn(`media job ${job.id}: sending retake candidate scored ${best.score} over latest ${score}`);
    // The verdict goes in the record too, so a sent picture shows what the
    // checker made of it. "scored" lines are not retake candidates.
    await supabaseAdmin
      .from("media_jobs")
      .update({
        error: [errorNow, `scored [score ${score === null ? "null" : score}] ${mediaUrl}`]
          .filter(Boolean)
          .join("\n"),
      })
      .eq("id", job.id);
    return best.url;
  }

  const nextError = [errorNow, candidateLine(attempt + 1, score, mediaUrl)].filter(Boolean).join("\n");
  let claim = supabaseAdmin
    .from("media_jobs")
    .update({ error: nextError, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .neq("status", "completed");
  claim = errorNow === null ? claim.is("error", null) : claim.eq("error", errorNow);
  const { data: claimed } = await claim.select("id");
  if (!claimed?.length) return null; // the other caller is already retaking it
  try {
    const id = await resubmitImageJob(ctx, `retake-${attempt + 1}-${job.id}`);
    console.warn(`media job ${job.id}: scored ${score} for "${question}", retaking as ${id}`);
    return null;
  } catch (e: any) {
    // Could not render again: send the best we have rather than nothing.
    console.error("retake failed", job.id, e?.message ?? e);
    return bestCandidate(all).url;
  }
}

// Returns true when the job is running again and must NOT be failed.
//
// `failedRunpodId` is the RunPod id the caller saw fail. The status poll runs
// every few seconds from the browser, so while one call is sleeping through
// the retry delay another can report the same old failure; comparing the id
// against the row is what tells a stale report from the retry's own failure.
async function retryImageJob(job: Job, errorMsg: string, failedRunpodId?: string): Promise<boolean> {
  if (job.kind !== "image" || job.provider !== "runpod") return false;
  const poseMissing = POSE_MODEL_ERROR.test(errorMsg);
  if (!WORKER_MEMORY_ERROR.test(errorMsg) && !poseMissing) return false;

  const { imageProvider, comfyJobInput, negativeFor, resolveHostedImage, webhookFor } =
    await import("./media.functions");
  if (imageProvider() !== "comfy") return false;
  const { runpodEndpoint, runpodRun } = await import("./runpod");
  const endpoint = runpodEndpoint("image");
  if (!endpoint) return false;

  const { data: fresh } = await supabaseAdmin
    .from("media_jobs")
    .select("error, status, replicate_id")
    .eq("id", job.id)
    .maybeSingle();
  if (!fresh || fresh.status === "failed" || fresh.status === "completed") return false;
  if (failedRunpodId === RETRYING_ID) return true;
  if (String(fresh.error ?? "").includes(RETRY_MARK)) {
    // Already retried. A report about the id the row currently carries is the
    // retry's own failure, and it gets no second one. A report about any other
    // id — the first attempt's — is stale and must not fail the job.
    return Boolean(failedRunpodId) && fresh.replicate_id !== failedRunpodId;
  }
  // A report about an id that is not the row's is stale too.
  if (failedRunpodId && fresh.replicate_id && fresh.replicate_id !== failedRunpodId) return true;

  // Compare-and-set on whatever the column holds now. It used to require
  // null, and after a retake the column holds the candidate lines — so a
  // worker error on a retake could never be claimed, and the job sat in
  // "processing" until the stale sweep wrote it off. The candidates are kept.
  const claim = supabaseAdmin
    .from("media_jobs")
    .update({
      error: [fresh.error, `${RETRY_MARK}${errorMsg.slice(0, 300)}`].filter(Boolean).join("\n"),
      status: "processing",
      replicate_id: RETRYING_ID,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  const { data: claimed } = await (
    fresh.error == null ? claim.is("error", null) : claim.eq("error", fresh.error)
  ).select("id, prompt, created_at, conversation_id");
  const row = claimed?.[0] as
    | { id: string; prompt: string | null; created_at: string; conversation_id: string | null }
    | undefined;
  // Someone else claimed it between the read and the update: it is being
  // retried, so this caller must not fail it either.
  if (!row) return true;

  try {
    const ctx = await jobContext(job.id);
    if (!ctx) throw new Error("nothing to resubmit");
    // A full worker needs time to be torn down; a missing model does not —
    // but it is remembered, so the retake after this does not go back to it.
    if (poseMissing) {
      const { disablePoseGuide } = await import("./poses");
      await disablePoseGuide();
    } else {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    // The FaceID graph (and even its one-pass variant) allocates more than the
    // dedicated pod has available. Retry the same request with the core I2I
    // graph: it keeps the reference/start frame but allocates no IPAdapter.
    const memorySafeGraph = !poseMissing ? ("img2img" as const) : undefined;
    const id = await resubmitImageJob(ctx, `retry-${job.id}`, {
      noPose: poseMissing,
      graph: memorySafeGraph,
      memorySafe: !poseMissing,
    });
    console.warn(`media job ${job.id} resubmitted as ${id} after worker error: ${errorMsg.slice(0, 120)}`);
    return true;
  } catch (e: any) {
    // Could not resubmit: the caller fails and refunds it as before.
    console.error("media job retry failed", job.id, e?.message ?? e);
    return false;
  }
}

// Mark a job failed and refund its cost. Idempotent: the ledger's unique
// idempotency_key guards against a double refund if both the webhook and the
// poll try to fail the same job.
export async function failMediaJob(
  job: Job,
  errorMsg: string,
  failedRunpodId?: string,
  options: { retry?: boolean; userMessage?: string } = {},
): Promise<void> {
  if (options.retry !== false && await retryImageJob(job, errorMsg, failedRunpodId)) return;
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
      if (options.userMessage) {
        await supabaseAdmin.from("messages").insert({
          conversation_id: job.conversation_id,
          user_id: job.user_id,
          role: "assistant",
          content: options.userMessage,
          kind: "text",
        });
      } else {
        await supabaseAdmin.from("messages").insert({
          conversation_id: job.conversation_id,
          user_id: job.user_id,
          role: "assistant",
          content: `Sorry, I had trouble generating that ${kindStr}. Your credits have been refunded! 🥺❤️`,
          kind: "text",
        });
      }
    }
  } catch (e: any) {
    console.error("Refund failed in media finalize", e);
  }
}

/**
 * Second step of a video: her face-locked still is done, so animate it.
 *
 * A video used to start from her portrait, shrunk into a padded square, and the
 * video model redrew the face as it moved — the clip drifted to a different
 * woman, and an explicit request had to undress a clothed portrait mid-motion.
 * startVideoJob now renders the opening frame first on the same FaceID graph as
 * a chat photo (same face, already in the requested scene) and parks the video
 * request in media_jobs.prompt. This picks that up.
 *
 * Called from both the webhook and the status poll, so it claims the job
 * atomically: only the caller that flips provider runpod-still -> runpod-
 * advancing submits a video.
 */
export async function advanceVideoFromStill(job: Job, stillUrl: string): Promise<void> {
  const { data: claimed } = await supabaseAdmin
    .from("media_jobs")
    .update({ provider: "runpod-advancing", updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("provider", "runpod-still")
    .select("id, prompt");
  const row = claimed?.[0] as { id: string; prompt: string } | undefined;
  if (!row) return;

  try {
    const parked = JSON.parse(row.prompt) as {
      stage: "still";
      contentMode?: "social" | "adult";
      videoInput: Record<string, unknown>;
      videoPrompt: string;
      stillInputUrl?: string;
      stillAttempt?: number;
    };

    // Do not animate a physically invalid opening image. Image-to-video can
    // preserve motion and identity, but it cannot turn a toy drawn on top of
    // the body into a genuinely inserted object. Score the still first and,
    // when its contact geometry is wrong, regenerate the still with a fresh
    // seed instead of spending another video pass on the same bad source.
    const ctx = await jobContext(job.id);
    if (ctx) {
      const { anatomyOf } = await import("./anatomy");
      const { verifyQuestion, PASS_SCORE, DEFAULT_RETAKES } = await import("./photo-check");
      const anatomy = anatomyOf(ctx.companion.gender);
      const question = verifyQuestion(ctx.userRequest, anatomy.hasBreasts, anatomy.hasVulva, ctx.toy);
      if (question) {
        const score = await scorePhoto(stillUrl, question, `${job.id}-opening`);
        const attempt = parked.stillAttempt ?? 0;
        const maxRetakes = Number(process.env.MEDIA_VIDEO_STILL_RETAKES || DEFAULT_RETAKES);
        if (score !== null && score < PASS_SCORE) {
          const { storedVideoStillInput, storeVideoStillInput } = await import("./compose.server");
          const stillInput = await storedVideoStillInput(parked.stillInputUrl);
          if (!stillInput || attempt >= maxRetakes) {
            throw new Error(`Video opening-frame quality check failed after ${attempt + 1} attempts (score ${score})`);
          }
          const nextAttempt = attempt + 1;
          const nextStillInput = {
            ...stillInput,
            seed: (Number(stillInput.seed) || Date.now()) + 104729 * nextAttempt,
          };
          const nextStillInputUrl = await storeVideoStillInput(job.id, nextStillInput);
          const { runpodRun, runpodEndpoint } = await import("./runpod");
          const endpoint = runpodEndpoint("comfy");
          if (!endpoint) throw new Error("RUNPOD_COMFY_ENDPOINT is not configured");
          const site = (process.env.PUBLIC_SITE_URL || "https://www.humancrush.com").replace(/\/$/, "");
          const retry = await runpodRun(endpoint, nextStillInput, `${site}/api/public/runpod-webhook`);
          await supabaseAdmin
            .from("media_jobs")
            .update({
              replicate_id: retry.id,
              provider: "runpod-still",
              status: "processing",
              prompt: JSON.stringify({
                ...parked,
                stillInputUrl: nextStillInputUrl,
                stillAttempt: nextAttempt,
              }),
              error: `opening-frame retake ${nextAttempt} after score ${score}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);
          return;
        }
      }
    }
    const res = await fetch(stillUrl);
    if (!res.ok) throw new Error(`could not read her still (${res.status})`);
    const still = Buffer.from(await res.arrayBuffer());

    const { squareStillFrame } = await import("./start-frame.server");
    // Keep the opening still in the same portrait aspect ratio as the clip.
    // The old face-locked path always padded it into a square even when the
    // video endpoint was configured for 720x1280, so the worker had to
    // reframe a smaller face before it could animate it. That is exactly where
    // identity drift and the "worst" video results came from.
    const frameUrl = await squareStillFrame(still, `vidstill-${job.id}`);

    const { runpodRun, runpodEndpoint } = await import("./runpod");
    const endpoint = runpodEndpoint("video");
    if (!endpoint) throw new Error("RUNPOD_VIDEO_ENDPOINT is not configured");
    const site = (process.env.PUBLIC_SITE_URL || "https://www.humancrush.com").replace(/\/$/, "");
    const result = await runpodRun(
      endpoint,
      { ...parked.videoInput, image_url: frameUrl },
      `${site}/api/public/runpod-webhook`,
    );

    await supabaseAdmin
      .from("media_jobs")
      .update({
        replicate_id: result.id,
        provider: "runpod",
        status: "processing",
        prompt: JSON.stringify({
          stage: "video",
          contentMode: parked.contentMode ?? "adult",
          videoInput: parked.videoInput,
          videoPrompt: parked.videoPrompt,
          startFrame: frameUrl,
          attempt: 0,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  } catch (e: any) {
    await failMediaJob(job, `Could not start the video from her still: ${e?.message ?? e}`);
  }
}
