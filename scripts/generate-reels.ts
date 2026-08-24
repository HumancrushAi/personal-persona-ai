// Generate each companion's own looping "live" clip for the cams pages, by
// running image-to-video on her portrait and uploading the result to the public
// `reels` bucket as companion-<id>.mp4 (the path lib/reels.ts reads).
//
// Before this, five companions shared stock reels pinned to them by name and
// everyone else got a static photo — the clip was never actually that model.
//
//   npx vite-node scripts/generate-reels.ts -- --dry
//   npx vite-node scripts/generate-reels.ts -- --only=Aria
//   npx vite-node scripts/generate-reels.ts -- --limit=5
//   npx vite-node scripts/generate-reels.ts                  # everyone missing one
//
// Costs a RunPod video job per companion (~2 min each). Existing clips are
// skipped unless --force, so an interrupted run resumes safely.

import { readFileSync } from "node:fs";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { runpodRun, runpodGet, runpodStatusOf, runpodOutputUrl, runpodOutputError } from "../src/lib/runpod";

function loadEnv(file: string) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* optional */
  }
}
loadEnv(".env.local");
loadEnv(".env");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const force = args.includes("--force");
const onlyArg = args.find((a) => a.startsWith("--only="));
const limitArg = args.find((a) => a.startsWith("--limit="));
const only = onlyArg
  ? onlyArg.slice(7).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  : null;
const limit = limitArg ? Number(limitArg.slice(8)) : null;

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const endpoint = process.env.RUNPOD_VIDEO_ENDPOINT;
if (!url || !serviceKey) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  process.exit(1);
}
if (!process.env.RUNPOD_API_KEY || !endpoint) {
  console.error("❌ RUNPOD_API_KEY / RUNPOD_VIDEO_ENDPOINT missing from .env.local");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function motionForCompanion(c: { name: string; gender: string; short_bio?: string }): string {
  const g = (c.gender || "").toLowerCase();
  const pronoun = g.includes("male") && !g.includes("trans-female") ? "he" : "she";
  const posPronoun = pronoun === "he" ? "his" : "her";

  const MOTIONS = [
    // Pool / Swimming
    `${pronoun} rests by the crystal clear swimming pool water with light water ripples, gentle head turns, blinking, and a radiant charming smile at the camera, natural loop`,
    // Dancing / Music vibes
    `${pronoun} sways gently and dances rhythmically to music, moving shoulders with playful laughing expression, blinking naturally, looking at the camera, smooth loop`,
    // Cafe / Lounge
    `${pronoun} sits relaxed at a modern lounge, leaning forward slightly, smiling warmly and making flirty eye contact with the camera, natural idle motion`,
    // Beach / Golden hour
    `${pronoun} turns gently in the soft warm ocean breeze, hair shifting softly, blinking and laughing with genuine warmth at the lens, seamless loop`,
    // Sun lounger / Relaxation
    `${pronoun} relaxes on a luxury lounge chair, resting comfortably, turning head to smile warmly with captivating eye contact, natural breathing`,
    // Playful / Flirty
    `${pronoun} smiles playfully, adjusting ${posPronoun} hair with natural hand and head movement, blinking gently and making seductive eye contact, seamless video loop`,
  ];

  let seed = 0;
  for (let i = 0; i < c.name.length; i++) seed = (seed * 31 + c.name.charCodeAt(i)) >>> 0;
  return MOTIONS[seed % MOTIONS.length];
}

const NEGATIVE =
  "blurry, low quality, deformed, extra limbs, watermark, text, static, still, frozen, no movement, bad anatomy, cartoon, anime, 3d render, nudity, naked, topless";

// The video endpoint returns a 640x640 square, and it gets there by centre-
// cropping whatever you send it — feeding it the 768x1024 portrait directly
// sliced the top of the head off (the first clip of Aria opened at her
// eyebrows). So square the portrait ourselves first, anchored at the TOP, which
// keeps head and torso and drops the legs. That's the framing the reference cam
// sites use anyway.
//
// The squared frame is uploaded alongside the clip so RunPod has a public URL to
// fetch, and so a failed run can be inspected afterwards.
async function squareStartFrame(portraitUrl: string, id: string): Promise<string> {
  const res = await withRetry(() => fetch(portraitUrl), "portrait");
  if (!res.ok) throw new Error(`could not fetch portrait (${res.status})`);
  const src = Buffer.from(await res.arrayBuffer());

  const meta = await sharp(src).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error("portrait has no dimensions");

  const side = Math.min(w, h);
  const squared = await sharp(src)
    // top: 0 is the whole point — a centred crop is what cut the head off.
    .extract({ left: Math.round((w - side) / 2), top: 0, width: side, height: side })
    .resize(768, 768)
    .png()
    .toBuffer();

  // Lives in `avatars`, not `reels` — the reels bucket only accepts video mime
  // types and rejects a PNG outright.
  const path = `startframes/${id}.png`;
  const { error } = await db.storage
    .from("avatars")
    .upload(path, squared, { contentType: "image/png", upsert: true });
  if (error) throw error;

  return db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

// A single network blip used to kill the whole remaining batch: one `fetch
// failed` took out 18 companions in a row while RunPod itself was healthy.
// Transient errors get retried with backoff instead.
async function withRetry<T>(fn: () => Promise<T>, what: string, attempts = 4): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = e?.message ?? String(e);
      const transient = /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket|network|502|503|504/i.test(msg);
      if (!transient || i === attempts - 1) throw e;
      const wait = 10_000 * (i + 1);
      process.stdout.write(` (${what} failed, retrying in ${wait / 1000}s)`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function waitForClip(jobId: string, label: string): Promise<string> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await sleep(6000);
    const res = await withRetry(() => runpodGet(endpoint!, jobId), "poll");
    const state = runpodStatusOf(res.status);
    if (state === "succeeded") {
      const out = runpodOutputUrl(res.output);
      if (!out) throw new Error("job completed with no video URL");
      return out;
    }
    if (state === "failed") {
      throw new Error(runpodOutputError(res.output, res.error) || `job ${res.status}`);
    }
    process.stdout.write(`\r${label} … ${res.status.toLowerCase()}   `);
  }
  throw new Error("timed out after 10 min");
}

async function main() {
  const { data, error } = await db
    .from("companions")
    .select("id, name, image_url, sort_order")
    .order("sort_order");
  if (error) throw new Error(error.message);

  let rows = (data ?? []) as { id: string; name: string; image_url: string }[];
  if (only) rows = rows.filter((r) => only.includes(r.name.toLowerCase()));

  // Skip companions that already have a clip, so a partial run resumes.
  if (!force) {
    const { data: existing } = await db.storage.from("reels").list("", { limit: 1000 });
    const have = new Set((existing ?? []).map((f) => f.name));
    rows = rows.filter((r) => !have.has(`companion-${r.id}.mp4`));
  }
  if (limit) rows = rows.slice(0, limit);

  // A portrait that RunPod can fetch is required as the start frame.
  const unusable = rows.filter((r) => !/^https?:/i.test(r.image_url ?? ""));
  rows = rows.filter((r) => /^https?:/i.test(r.image_url ?? ""));

  console.log(`${rows.length} clip(s) to generate${dryRun ? "  [DRY RUN]" : ""}`);
  if (unusable.length) {
    console.log(`   skipping ${unusable.length} with no hosted portrait: ${unusable.map((u) => u.name).join(", ")}`);
  }
  console.log();

  let ok = 0;
  const failures: string[] = [];

  for (const [i, c] of rows.entries()) {
    const label = `${String(i + 1).padStart(2)}/${rows.length} ${c.name}`;
    if (dryRun) {
      console.log(`${label} <- ${c.image_url.slice(0, 90)}`);
      continue;
    }

    process.stdout.write(`${label} … framing`);
    try {
      const startFrame = await squareStartFrame(c.image_url, c.id);

      process.stdout.write(`${label} … queueing `);
      const job = await withRetry(
        () =>
          runpodRun(endpoint!, {
            image_url: startFrame,
            fps: Number(process.env.RUNPOD_VIDEO_FPS || "16"),
            frames_per_scene: Number(process.env.RUNPOD_VIDEO_FRAMES || "82"),
            num_scenes: 1,
            sampling_steps: Number(process.env.RUNPOD_VIDEO_STEPS || "10"),
            prompts: [motionForCompanion(c)],
            negative_prompt: NEGATIVE,
          }),
        "submit",
      );

      const clipUrl = await waitForClip(job.id, label);
      const res = await withRetry(() => fetch(clipUrl), "download");
      if (!res.ok) throw new Error(`could not fetch clip (${res.status})`);
      const bytes = Buffer.from(await res.arrayBuffer());

      const { error: upErr } = await db.storage
        .from("reels")
        .upload(`companion-${c.id}.mp4`, bytes, { contentType: "video/mp4", upsert: true });
      if (upErr) throw upErr;

      ok++;
      console.log(`\r${label} … ✅ ${Math.round(bytes.length / 1024)}KB          `);
    } catch (e: any) {
      failures.push(`${c.name}: ${e.message || e}`);
      console.log(`\r${label} … ❌ ${e.message || e}          `);
    }
  }

  if (dryRun) return;
  console.log(`\nDone: ${ok} generated, ${failures.length} failed.`);
  for (const f of failures) console.log(`   ❌ ${f}`);
}

// vite-node's dev harness keeps the event loop alive, so exit explicitly.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  });
