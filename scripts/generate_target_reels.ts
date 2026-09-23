import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import sharp from "sharp";
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

if (!url || !serviceKey || !process.env.RUNPOD_API_KEY || !endpoint) {
  console.error("❌ Missing required environment variables");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TARGETS = [
  {
    id: "2c252785-fe75-4c84-a803-af9c484f6c96",
    name: "Aria",
    motion: "She rests on the bed in her red silk dress, turning her head gently with a warm seductive smile at the camera, natural head movement, seamless video loop",
  },
  {
    id: "f9aa06f5-7f49-4f5f-be43-f707e8a2ef78",
    name: "Mei",
    motion: "She sways softly in her white silk dress, smiling warmly and making flirty eye contact with the camera, natural breathing and head turn, seamless loop",
  },
  {
    id: "f668101d-486e-45e2-9e87-69e70e272401",
    name: "Raven",
    motion: "She turns her head gently in her black lace dress, smiling alluringly at the camera with gentle eye contact, seamless video loop",
  },
  {
    id: "9a173fea-67ea-45d3-996a-9084dc3c98d0",
    name: "Sofia",
    motion: "She relaxes comfortably in her white satin dress, smiling warmly with captivating eye contact at the camera, natural head movement, seamless video loop",
  },
  {
    id: "667ae29d-7e55-4588-b9c8-7bfad68f455e",
    name: "Jade",
    motion: "She smiles playfully in her black lace dress, adjusting her hair with natural hand movement, looking at the camera with seductive eye contact, smooth video loop",
  },
];

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
    let res: any;
    for (let a = 0; a < 5; a++) {
      try {
        res = await runpodGet(endpoint, jobId);
        if (res) break;
      } catch (e) {
        await sleep(3000);
      }
    }
    if (!res) continue;
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
  console.log("=== GENERATING 1:1 MATCHING VIDEO REELS FOR ARIA, MEI, RAVEN, SOFIA, JADE ===");

  for (const t of TARGETS) {
    console.log(`\n🎥 Processing video reel for ${t.name} (${t.id})...`);
    
    // Fetch companion's updated image_url from DB
    const { data: comp, error: fetchErr } = await db
      .from("companions")
      .select("id, name, image_url")
      .eq("id", t.id)
      .maybeSingle();

    if (fetchErr || !comp?.image_url) {
      console.error(`❌ Could not find image_url for ${t.name}:`, fetchErr?.message);
      continue;
    }

    console.log(`  Portrait URL: ${comp.image_url}`);

    try {
      let startFrame: string | null = null;
      for (let a = 0; a < 5; a++) {
        try {
          startFrame = await squareStartFrame(comp.image_url, t.id);
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
            prompts: [t.motion],
            negative_prompt:
              "blurry, low quality, deformed, extra limbs, watermark, text, static, still, frozen, no movement, bad anatomy, cartoon, anime, 3d render, nudity, naked, topless",
          });
          if (job?.id) break;
        } catch (e) {
          await sleep(3000);
        }
      }
      if (!job?.id) throw new Error("Could not queue video job");

      console.log(`  Queued video job ${job.id}, waiting for completion...`);
      const clipUrl = await waitForClip(job.id, t.name);

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
        .upload(`companion-${t.id}.mp4`, videoBytes, { contentType: "video/mp4", upsert: true });

      if (reelUpErr) throw reelUpErr;
      console.log(`  ✅ Video reel successfully uploaded to reels/companion-${t.id}.mp4 (${Math.round(videoBytes.length / 1024)}KB)`);

    } catch (e: any) {
      console.error(`  ❌ Failed for ${t.name}:`, e?.message || e);
    }
  }

  console.log("\n=== ALL VIDEO REELS GENERATED & UPLOADED SUCCESSFULLY ===");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
