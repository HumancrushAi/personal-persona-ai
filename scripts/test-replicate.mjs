// Standalone verification of the media reconcile mechanism — the exact thing
// that was broken (trigger a prediction, then POLL it back and get the output).
// Runs against the real Replicate account using the token in .env.local.
// Usage:  node scripts/test-replicate.mjs
// Cost:   a few cents of generation on your Replicate account.

import { readFileSync } from "node:fs";

// --- load REPLICATE_API_TOKEN from .env.local (no dependency) ---
function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* file optional */
  }
}
loadEnv(".env.local");
loadEnv(".env");

const TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) {
  console.error("❌ REPLICATE_API_TOKEN not found in .env.local / .env");
  process.exit(1);
}

const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

// Mirror the production model constants (src/lib/ai.ts).
const PONY_VERSION = "b070dedae81324788c3c933a5d9e1270093dc74636214b9815dae044b4b3a58a";
const PONY_INPUT = {
  model: "ponyRealism21.safetensors",
  width: 768,
  height: 1024,
  steps: 24,
  cfg_scale: 6,
  scheduler: "DPM++ 2M SDE Karras",
  prepend_preprompt: true,
};
const VIDEO_MODEL = process.env.REPLICATE_VIDEO_MODEL || "wan-video/wan-2.2-i2v-fast";
const VIDEO_FPS = Number(process.env.REPLICATE_VIDEO_FPS || "16");
const VIDEO_DURATION = Number(process.env.REPLICATE_VIDEO_DURATION || "5");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// This is the reconcile loop: create a prediction, then poll GET until done —
// exactly what checkMediaJob does in production (webhook-independent).
async function createByVersion(version, input) {
  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ version, input }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`create failed ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json.id;
}

async function createByModel(model, input) {
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ input }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`create failed ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json.id;
}

async function pollUntilDone(id, label, maxSeconds) {
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: H });
    const json = await res.json();
    if (!res.ok) throw new Error(`get failed ${res.status}`);
    process.stdout.write(`   ${label}: ${json.status}\r`);
    if (json.status === "succeeded") {
      const out = Array.isArray(json.output) ? json.output[0] : json.output;
      console.log(`\n   ✅ ${label} succeeded -> ${out}`);
      return out;
    }
    if (json.status === "failed" || json.status === "canceled") {
      throw new Error(`${label} ${json.status}: ${JSON.stringify(json.error).slice(0, 300)}`);
    }
    await sleep(3000);
  }
  throw new Error(`${label} timed out after ${maxSeconds}s`);
}

async function fetchable(url) {
  const res = await fetch(url, { method: "HEAD" });
  return res.ok;
}

async function main() {
  console.log(`Token: ...${TOKEN.slice(-6)}\n`);

  // ---- TEST 1: image (pony) — proves the reconcile core ----
  console.log("① IMAGE (pony-sdxl) — trigger, then poll it back:");
  const imgId = await createByVersion(PONY_VERSION, {
    prompt: "photorealistic portrait of a woman, mirror selfie, detailed skin",
    negative_prompt: "anime, cartoon, deformed, watermark, text",
    ...PONY_INPUT,
  });
  console.log(`   prediction id: ${imgId}`);
  const imgUrl = await pollUntilDone(imgId, "image", 240);
  console.log(`   fetchable: ${(await fetchable(imgUrl)) ? "yes ✅" : "NO ❌"}\n`);

  // ---- TEST 2: video (image-to-video) — proves the video model + slug ----
  console.log(`② VIDEO (${VIDEO_MODEL}) — i2v from that image:`);
  let vidId;
  try {
    vidId = await createByModel(VIDEO_MODEL, {
      image: imgUrl,
      prompt: "she smiles and waves at the camera, natural motion",
      resolution: process.env.REPLICATE_VIDEO_RESOLUTION || "720p",
      num_frames: Math.round(VIDEO_DURATION * VIDEO_FPS) + 1,
      frames_per_second: VIDEO_FPS,
      disable_safety_checker: true,
    });
  } catch (e) {
    console.log(`   ❌ video create failed: ${e.message}`);
    console.log("   -> fix REPLICATE_VIDEO_MODEL or the input params; image still works.\n");
    console.log("SUMMARY: image pipeline ✅  |  video ❌ (see above)");
    return;
  }
  console.log(`   prediction id: ${vidId}`);
  const vidUrl = await pollUntilDone(vidId, "video", 420);
  console.log(`   fetchable: ${(await fetchable(vidUrl)) ? "yes ✅" : "NO ❌"}\n`);

  console.log("SUMMARY: image ✅  |  video ✅  — reconcile mechanism works end to end.");
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
