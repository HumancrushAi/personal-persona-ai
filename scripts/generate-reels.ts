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

// Idle, loopable motion. No explicit content: these clips play on the public
// cams grid, so they match the clothed portraits they're generated from.
const MOTION =
  "she breathes softly and shifts her weight, small natural head movement, blinking, a slight smile, looking at the camera, subtle idle motion, seamless loop";
const NEGATIVE =
  "blurry, low quality, deformed, extra limbs, watermark, text, static, still, frozen, no movement, bad anatomy, cartoon, nudity, naked, topless";

async function waitForClip(jobId: string, label: string): Promise<string> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await sleep(6000);
    const res = await runpodGet(endpoint!, jobId);
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

    process.stdout.write(`${label} … queueing`);
    try {
      const job = await runpodRun(endpoint!, {
        image_url: c.image_url,
        fps: Number(process.env.RUNPOD_VIDEO_FPS || "16"),
        frames_per_scene: Number(process.env.RUNPOD_VIDEO_FRAMES || "82"),
        num_scenes: 1,
        sampling_steps: Number(process.env.RUNPOD_VIDEO_STEPS || "10"),
        prompts: [MOTION],
        negative_prompt: NEGATIVE,
      });

      const clipUrl = await waitForClip(job.id, label);
      const res = await fetch(clipUrl);
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
