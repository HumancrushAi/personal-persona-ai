// Standalone verification of the RunPod media pipeline — the exact mechanism
// production uses: queue a job, then POLL /status/{id} back and read the output.
// Runs against the real RunPod account using the key in .env.local.
//
// Usage:   node scripts/test-runpod.mjs
//          TEST_FACE_URL="https://…/her.png" \
//          TEST_IMAGE_PROMPT="…" TEST_VIDEO_PROMPT="…" node scripts/test-runpod.mjs
// Cost:    ~$0.03 for the image + a couple of GPU-minutes for the video.

import { readFileSync } from "node:fs";

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* file optional */
  }
}
loadEnv(".env.local");
loadEnv(".env");

const KEY = process.env.RUNPOD_API_KEY;
if (!KEY) {
  console.error("❌ RUNPOD_API_KEY not found in .env.local / .env");
  process.exit(1);
}

const IMAGE_ENDPOINT = process.env.RUNPOD_IMAGE_ENDPOINT || "black-forest-labs-flux-1-kontext-dev";
const VIDEO_ENDPOINT = process.env.RUNPOD_VIDEO_ENDPOINT || "";
// Kontext EDITS this photo, so the person in it is the person you get back.
const FACE_URL =
  process.env.TEST_FACE_URL ||
  "https://image.runpod.ai/asset/black-forest-labs/black-forest-labs-flux-1-kontext-dev.png";

const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(endpoint, input) {
  const res = await fetch(`https://api.runpod.ai/v2/${endpoint}/run`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ input }),
  });
  const json = await res.json();
  if (!res.ok || !json.id) {
    throw new Error(`run failed ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.id;
}

// This is the reconcile loop — exactly what checkMediaJob does in production.
async function pollUntilDone(endpoint, id, label, maxSeconds) {
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(`https://api.runpod.ai/v2/${endpoint}/status/${id}`, { headers: H });
    const json = await res.json();
    if (!res.ok) throw new Error(`status failed ${res.status}`);
    process.stdout.write(`   ${label}: ${json.status}          \r`);
    if (json.status === "COMPLETED") {
      console.log(`\n   raw output: ${JSON.stringify(json.output).slice(0, 300)}`);
      return json.output;
    }
    if (["FAILED", "CANCELLED", "CANCELED", "TIMED_OUT"].includes(json.status)) {
      throw new Error(`${label} ${json.status}: ${JSON.stringify(json.error).slice(0, 300)}`);
    }
    await sleep(4000);
  }
  throw new Error(`${label} timed out after ${maxSeconds}s`);
}

// Mirrors runpodOutputUrl() in src/lib/runpod.ts — chunk first, because
// final_video_url is a shared fixed filename that concurrent jobs overwrite.
function outputUrl(out) {
  if (!out) return null;
  const chunk = Array.isArray(out.chunk_urls) ? out.chunk_urls[0] : null;
  for (const c of [chunk, out.final_video_url, out.result, out.video_url, out.image_url, out.url]) {
    if (typeof c === "string" && /^https?:/i.test(c)) return c;
  }
  return null;
}

async function fetchable(url) {
  const res = await fetch(url, { method: "HEAD" });
  return `${res.ok ? "yes ✅" : "NO ❌"} (${res.status} ${res.headers.get("content-type")})`;
}

async function main() {
  console.log(`Key: ...${KEY.slice(-6)}\n`);

  // ---- TEST 1: image-to-image (FLUX.1 Kontext) ----
  console.log(`① IMAGE (${IMAGE_ENDPOINT}) — editing ${FACE_URL.slice(0, 70)}…`);
  const imgId = await run(IMAGE_ENDPOINT, {
    prompt:
      process.env.TEST_IMAGE_PROMPT ||
      "Keep the exact same subject from the photo — identical face and colouring. Now show it on a rooftop at sunset. Photorealistic, sharp focus, no text, no watermark.",
    negative_prompt: "different person, different face, deformed, blurry, cartoon, watermark, text",
    seed: -1,
    num_inference_steps: Number(process.env.RUNPOD_IMAGE_STEPS || "28"),
    guidance: Number(process.env.RUNPOD_IMAGE_GUIDANCE || "2.5"),
    image: FACE_URL,
    size: process.env.RUNPOD_IMAGE_SIZE || "1024*1024",
    output_format: "png",
    enable_safety_checker: false,
  });
  console.log(`   job id: ${imgId}`);
  const imgUrl = outputUrl(await pollUntilDone(IMAGE_ENDPOINT, imgId, "image", 300));
  if (!imgUrl) throw new Error("image completed but no URL in output");
  console.log(`   -> ${imgUrl}`);
  console.log(`   fetchable: ${await fetchable(imgUrl)}\n`);

  // ---- TEST 2: image-to-video, animating that same image ----
  if (!VIDEO_ENDPOINT) {
    console.log("② VIDEO — skipped (RUNPOD_VIDEO_ENDPOINT not set)\n");
    console.log("SUMMARY: image ✅  |  video ⏭  (set RUNPOD_VIDEO_ENDPOINT to test it)");
    return;
  }
  console.log(`② VIDEO (${VIDEO_ENDPOINT}) — i2v from that image:`);
  const vidId = await run(VIDEO_ENDPOINT, {
    image_url: imgUrl,
    fps: Number(process.env.RUNPOD_VIDEO_FPS || "16"),
    frames_per_scene: Number(process.env.RUNPOD_VIDEO_FRAMES || "82"),
    num_scenes: 1,
    sampling_steps: Number(process.env.RUNPOD_VIDEO_STEPS || "10"),
    prompts: [
      process.env.TEST_VIDEO_PROMPT ||
        "The subject moves naturally toward the camera. Smooth lifelike motion, consistent appearance.",
    ],
    negative_prompt:
      "blurry, low quality, deformed, extra limbs, watermark, text, inconsistent characters, slow, slow motion, static, still, frozen, stuck, no movement, bad anatomy, cartoon, low quality",
  });
  console.log(`   job id: ${vidId}`);
  const vidUrl = outputUrl(await pollUntilDone(VIDEO_ENDPOINT, vidId, "video", 600));
  if (!vidUrl) throw new Error("video completed but no URL in output");
  console.log(`   -> ${vidUrl}`);
  console.log(`   fetchable: ${await fetchable(vidUrl)}\n`);

  console.log("SUMMARY: image ✅  |  video ✅  — RunPod reconcile works end to end.");
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
