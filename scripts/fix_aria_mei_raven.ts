import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { generateCompanionPortrait } from "../src/lib/portrait.server";
import { runpodRun, runpodGet, runpodStatusOf, runpodOutputUrl, runpodOutputError } from "../src/lib/runpod";

function loadEnv(file: string) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnv(".env.local");
loadEnv(".env");

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const endpoint = process.env.RUNPOD_VIDEO_ENDPOINT!;

if (!url || !serviceKey || !process.env.XAI_API_KEY || !process.env.RUNPOD_API_KEY || !endpoint) {
  console.error("❌ Missing required environment variables");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TARGET_MODELS = [
  {
    id: "2c252785-fe75-4c84-a803-af9c484f6c96",
    name: "Aria",
    prompt:
      "Candid photo of a real 24-year-old woman named Aria, long dark wavy hair, clear skin, dark eyes, wearing an elegant red silk evening dress, sitting on a bed in a warm bedroom, vertical portrait, 85mm DSLR photo, real skin texture with visible pores.",
    motion:
      "She rests on the bed in her red silk dress, turning her head gently with a warm seductive smile at the camera, natural head movement, seamless video loop",
  },
  {
    id: "f9aa06f5-7f49-4f5f-be43-f707e8a2ef78",
    name: "Mei",
    prompt:
      "Candid photo of a real 25-year-old East Asian woman named Mei, sleek dark hair, radiant glowing skin, delicate features, wearing an elegant white silk evening dress, sitting in a cozy bedroom with warm lamplight, vertical portrait, 85mm DSLR photo, real skin texture.",
    motion:
      "She sways softly in her white silk dress, smiling warmly and making flirty eye contact with the camera, natural breathing and head turn, seamless loop",
  },
  {
    id: "f668101d-486e-45e2-9e87-69e70e272401",
    name: "Raven",
    prompt:
      "Candid photo of a real 22-year-old alt goth woman named Raven, dark curly hair, smokey eye makeup, wearing an elegant black lace evening dress, standing in a dimly lit bedroom with soft ambient glow, vertical portrait, 85mm DSLR photo, real skin texture.",
    motion:
      "She turns her head gently in her black lace dress, smiling alluringly at the camera with gentle eye contact, seamless video loop",
  },
];

async function uploadPortrait(dataUrl: string, name: string): Promise<string> {
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const storagePath = `companions/model-${name.toLowerCase()}-silkdress-${Date.now()}.png`;

  const { error: upErr } = await db.storage
    .from("avatars")
    .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

  if (upErr) throw upErr;
  const { data: publicUrlData } = db.storage.from("avatars").getPublicUrl(storagePath);
  return publicUrlData.publicUrl;
}

async function squareStartFrame(portraitUrl: string, id: string): Promise<string> {
  const res = await fetch(portraitUrl);
  if (!res.ok) throw new Error(`could not fetch portrait (${res.status})`);
  const src = Buffer.from(await res.arrayBuffer());

  const squared = await sharp(src)
    .resize(768, 768, { fit: "contain", background: { r: 15, g: 15, b: 20, alpha: 1 } })
    .png()
    .toBuffer();

  const path = `startframes/${id}.png`;
  const { error } = await db.storage
    .from("avatars")
    .upload(path, squared, { contentType: "image/png", upsert: true });
  if (error) throw error;

  return db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

async function waitForClip(jobId: string, label: string): Promise<string> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await sleep(6000);
    const res = await runpodGet(endpoint, jobId);
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
  console.log("=== REGENERATING ARIA, MEI, RAVEN WITH SILK DRESSES ===");

  for (const m of TARGET_MODELS) {
    console.log(`\n----------------------------------------`);
    console.log(`📸 STEP 1: Generating new portrait for ${m.name}...`);
    try {
      let dataUrl: string | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          dataUrl = await generateCompanionPortrait(m.prompt, {
            gender: "female",
            noNudity: true,
          });
          if (dataUrl) break;
        } catch (e: any) {
          const msg = e?.message || String(e);
          if (msg.includes("content-moderated")) throw e;
          console.log(`  (portrait retry ${attempt + 1}/5 for ${m.name}: ${msg.slice(0, 40)})`);
          await sleep(3000);
        }
      }
      if (!dataUrl) throw new Error("Could not generate portrait after retries");

      const imageUrl = await uploadPortrait(dataUrl, m.name);
      console.log(`  ✅ Uploaded portrait for ${m.name}: ${imageUrl}`);

      const { error: dbErr } = await db
        .from("companions")
        .update({ image_url: imageUrl })
        .eq("id", m.id);

      if (dbErr) {
        console.error(`  ❌ DB update error for ${m.name}:`, dbErr);
        continue;
      }
      console.log(`  ✅ DB updated image_url for ${m.name}`);

      console.log(`🎥 STEP 2: Generating video reel for ${m.name}...`);
      let startFrame: string | null = null;
      for (let a = 0; a < 5; a++) {
        try {
          startFrame = await squareStartFrame(imageUrl, m.id);
          if (startFrame) break;
        } catch (e) {
          await sleep(3000);
        }
      }
      if (!startFrame) throw new Error("Could not create startFrame");

      let job: { id: string } | null = null;
      for (let a = 0; a < 5; a++) {
        try {
          job = await runpodRun(endpoint, {
            image_url: startFrame,
            fps: Number(process.env.RUNPOD_VIDEO_FPS || "16"),
            frames_per_scene: Number(process.env.RUNPOD_VIDEO_FRAMES || "82"),
            num_scenes: 1,
            sampling_steps: Number(process.env.RUNPOD_VIDEO_STEPS || "10"),
            prompts: [m.motion],
            negative_prompt:
              "blurry, low quality, deformed, extra limbs, watermark, text, static, still, frozen, no movement, bad anatomy, cartoon, anime, 3d render, nudity, naked, topless",
          });
          if (job?.id) break;
        } catch (e) {
          await sleep(3000);
        }
      }
      if (!job?.id) throw new Error("Could not queue video job");

      console.log(`  Queued video job ${job.id}`);
      const clipUrl = await waitForClip(job.id, m.name);

      let videoBytes: Buffer | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const clipRes = await fetch(clipUrl);
          if (clipRes.ok) {
            videoBytes = Buffer.from(await clipRes.arrayBuffer());
            break;
          }
        } catch (e) {
          await sleep(3000);
        }
      }
      if (!videoBytes) throw new Error("Could not download rendered video clip after retries");

      const { error: reelUpErr } = await db.storage
        .from("reels")
        .upload(`companion-${m.id}.mp4`, videoBytes, { contentType: "video/mp4", upsert: true });

      if (reelUpErr) throw reelUpErr;
      console.log(`  ✅ Video reel successfully generated & uploaded to reels/companion-${m.id}.mp4 (${Math.round(videoBytes.length / 1024)}KB)`);

    } catch (e: any) {
      console.error(`  ❌ Failed processing ${m.name}:`, e?.message || e);
    }
  }

  console.log("\n=== ARIA, MEI, RAVEN REGENERATED SUCCESSFULLY ===");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
