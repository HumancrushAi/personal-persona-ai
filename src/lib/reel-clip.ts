// How a companion's live reel is made from her portrait — shared by
// scripts/generate-reels.ts (batch) and reels.server.ts (the admin panel, on
// every new or changed photo), so the two cannot drift apart.
//
// The rule both follow: the reel IS her portrait, moving. Same room, same
// outfit, same framing, first frame identical to the photo on her card.

import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export function motionForCompanion(c: { name: string; gender?: string | null }, attempt = 0): string {
  const g = (c.gender || "").toLowerCase();
  // Exact matches: "female".includes("male") is true.
  const pronoun = g === "male" || g === "trans-male" ? "he" : "she";
  const posPronoun = pronoun === "he" ? "his" : "her";

  // Motion only — never a place. These used to name settings ("rests by the
  // crystal clear swimming pool", "ocean breeze", "modern lounge"), and the
  // model obliged: Jade's clip opened on her bedroom portrait and dissolved
  // into a swimming pool halfway through. The reel has to BE the photo, moving,
  // so every prompt pins the room, outfit and framing to the first frame.
  const SAME = "same room, same outfit, same pose and same framing as the first frame throughout";
  const MOTIONS = [
    `${pronoun} smiles warmly at the camera, blinking naturally, a gentle head tilt and slow natural breathing, ${posPronoun} hair shifting slightly, ${SAME}, seamless loop`,
    `${pronoun} gives a soft playful laugh, ${posPronoun} shoulders relaxing, glancing away and back into the lens, ${SAME}, seamless loop`,
    `${pronoun} slowly tucks a strand of hair behind ${posPronoun} ear and smiles at the camera, blinking, subtle breathing, ${SAME}, seamless loop`,
    `${pronoun} sways gently where ${pronoun} is, flirty eye contact with the camera, blinking, a soft smile, ${SAME}, seamless loop`,
  ];

  let seed = 0;
  for (let i = 0; i < c.name.length; i++) seed = (seed * 31 + c.name.charCodeAt(i)) >>> 0;
  return MOTIONS[(seed + attempt) % MOTIONS.length];
}

export const REEL_NEGATIVE =
  "blurry, low quality, deformed, extra limbs, watermark, text, static, still, frozen, no movement, bad anatomy, cartoon, anime, 3d render, nudity, naked, topless, scene change, background change, transition, dissolve, cut, water, swimming pool, beach, outfit change";

// How far the clip wanders from its own first frame: the largest mean
// difference (0-255) between frame 0 and any later frame, on a 32x32 greyscale
// thumbnail. Real motion stays low — Aria turning, laughing and tossing her
// hair peaked at 25 — while Jade's clip dissolving into a swimming pool hit 81.
export const MAX_DRIFT = 40;

/** Tries per reel before giving up; each retry uses the next motion prompt. */
export const REEL_ATTEMPTS = 3;

/** The job body for the video endpoint, minus the start frame. */
export function reelJobInput(c: { name: string; gender?: string | null }, attempt: number) {
  return {
    fps: Number(process.env.RUNPOD_VIDEO_FPS || "16"),
    frames_per_scene: Number(process.env.RUNPOD_VIDEO_FRAMES || "82"),
    num_scenes: 1,
    sampling_steps: Number(process.env.RUNPOD_VIDEO_STEPS || "10"),
    prompts: [motionForCompanion(c, attempt)],
    negative_prompt: REEL_NEGATIVE,
  };
}

// The video endpoint returns a 640x640 square, and it gets there by centre-
// cropping whatever you send it — feeding it the portrait directly sliced the
// top of the head off. So the portrait is squared here with padding, and the
// padding is cropped back off the finished clip (cropToPortrait), which leaves
// exactly the portrait's own framing.
export async function squarePortrait(portrait: Buffer): Promise<{ png: Buffer; aspect: number }> {
  const meta = await sharp(portrait).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error("portrait has no dimensions");
  const png = await sharp(portrait)
    .resize(768, 768, { fit: "contain", background: { r: 15, g: 15, b: 20, alpha: 1 } })
    .png()
    .toBuffer();
  return { png, aspect: w / h };
}

function withTemp<T>(id: string, clip: Buffer, fn: (src: string, out: string) => T): T {
  const src = join(tmpdir(), `reel-${id}-${Date.now()}-raw.mp4`);
  const out = join(tmpdir(), `reel-${id}-${Date.now()}.mp4`);
  writeFileSync(src, clip);
  try {
    return fn(src, out);
  } finally {
    for (const f of [src, out]) {
      try {
        unlinkSync(f);
      } catch {
        /* never written */
      }
    }
  }
}

export function cropToPortrait(clip: Buffer, aspect: number, id: string, ffmpeg: string): Buffer {
  const crop =
    aspect <= 1 ? `crop=trunc(ih*${aspect}/2)*2:ih` : `crop=iw:trunc(iw/${aspect}/2)*2`;
  return withTemp(id, clip, (src, out) => {
    execFileSync(
      ffmpeg,
      [
        "-y", "-loglevel", "error", "-i", src, "-vf", crop, "-an",
        "-c:v", "libx264", "-crf", "20", "-preset", "medium",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
      ],
      { stdio: "pipe" },
    );
    return readFileSync(out);
  });
}

export function driftFromFirstFrame(clip: Buffer, id: string, ffmpeg: string): number {
  return withTemp(id, clip, (src) => {
    const raw = execFileSync(
      ffmpeg,
      ["-loglevel", "error", "-i", src, "-vf", "scale=32:32,format=gray", "-f", "rawvideo", "-"],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const N = 32 * 32;
    let worst = 0;
    for (let f = 1; f < raw.length / N; f++) {
      let sum = 0;
      for (let k = 0; k < N; k++) sum += Math.abs(raw[f * N + k] - raw[k]);
      worst = Math.max(worst, sum / N);
    }
    return worst;
  });
}
