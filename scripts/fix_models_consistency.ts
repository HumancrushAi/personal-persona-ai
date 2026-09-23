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
  console.error("❌ Missing required environment variables (SUPABASE_URL, SERVICE_KEY, XAI_API_KEY, RUNPOD_API_KEY, RUNPOD_VIDEO_ENDPOINT)");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MODELS_TO_FIX = [
  {
    id: "2c252785-fe75-4c84-a803-af9c484f6c96",
    name: "Aria",
    prompt:
      "Photo of a real 24-year-old American woman named Aria, long wavy dark brown hair, clear glowing skin, dark eyes, seductive gaze, wearing a form-fitting red silk slip dress with thin straps, standing in a dimly lit apartment, vertical portrait photo shot on 85mm lens, natural skin texture, candid raw photograph.",
    motion:
      "She rests by the bed in her red silk slip dress, turning her head gently with a radiant charming smile at the camera, blinking naturally, soft hair movement, natural loop",
  },
  {
    id: "f9aa06f5-7f49-4f5f-be43-f707e8a2ef78",
    name: "Mei",
    prompt:
      "Photo of a real 25-year-old East Asian woman named Mei, sleek dark hair, soft facial features, radiant skin, wearing a form-fitting white silk slip dress with thin straps, warm cozy bedroom lighting, vertical portrait photo shot on 85mm lens, natural skin texture, candid raw photo.",
    motion:
      "She sways gently in her white silk slip dress, smiling warmly and making flirty eye contact with the camera, natural head movement, seamless video loop",
  },
  {
    id: "667ae29d-7e55-4588-b9c8-7bfad68f455e",
    name: "Jade",
    prompt:
      "Photo of a real 23-year-old alt goth Asian woman named Jade, dark hair with subtle green highlights, captivating dark eyes, charming smile, wearing a stylish black lace mini dress, soft ambient room light, vertical portrait photo shot on 85mm lens, natural skin texture.",
    motion:
      "She smiles playfully in her black lace dress, adjusting her hair with natural hand movement, looking at the camera with seductive eye contact, smooth video loop",
  },
  {
    id: "f668101d-486e-45e2-9e87-69e70e272401",
    name: "Raven",
    prompt:
      "Photo of a real 22-year-old alt goth woman named Raven, dark curly hair, smokey eye makeup, charming smile, wearing a form-fitting black lace dress, warm bedside lamplight, vertical portrait photo shot on 85mm lens, natural skin texture.",
    motion:
      "She turns head gently in her black lace dress, smiling alluringly and blinking naturally at the camera, seamless video loop",
  },
  {
    id: "9a173fea-67ea-45d3-996a-9084dc3c98d0",
    name: "Sofia",
    prompt:
      "Photo of a real 26-year-old Latina woman named Sofia, long dark wavy hair, warm golden glowing skin, brown eyes, captivating smile, wearing a white halter neck silk dress, golden hour light, vertical portrait photo shot on 85mm lens, natural skin texture.",
    motion:
      "She relaxes comfortably in her white halter slip dress, smiling warmly with captivating eye contact at the camera, natural breathing and head turn",
  },
  {
    id: "5eaaf212-055d-44f8-841e-94967f4a674c",
    name: "Vesper",
    prompt:
      "Photo of a real 24-year-old woman named Vesper, dark curls, radiant skin, mysterious charming look, wearing a form-fitting black satin slip dress, soft ambient room lighting, vertical portrait photo shot on 85mm lens, natural skin texture.",
    motion:
      "She sways softly in her black satin dress, looking at the camera with an intriguing flirty smile, natural head turn and blinking loop",
  },
  {
    id: "41aef40b-e716-4e4c-b372-cb56c073a9cb",
    name: "Nyx",
    prompt:
      "Photo of a real 25-year-old Latina goth woman named Nyx, long dark wavy hair, dark eye makeup, seductive gaze, wearing a form-fitting black lace slip dress, warm bedroom lamplight, vertical portrait photo shot on 85mm lens, natural skin texture.",
    motion:
      "She smiles alluringly in her black lace slip dress, making steady intimate eye contact with the camera, soft natural head movement",
  },
  {
    id: "c143557b-ada4-447d-93a0-19d0fb2388d8",
    name: "Amara",
    prompt:
      "Photo of a real 27-year-old West African woman named Amara, radiant dark skin, elegant features, confident smile, wearing a form-fitting red silk dress with thin straps, bright warm room light, vertical portrait photo shot on 85mm lens, natural skin texture.",
    motion:
      "She turns gently in her red silk dress, smiling with radiant warmth and flirty confidence at the camera, natural loop",
  },
  {
    id: "24766b56-6df0-4cb8-a174-6d9120554a55",
    name: "Priya",
    prompt:
      "Photo of a real 24-year-old Indian woman named Priya, sleek long dark hair, warm golden skin, expressive dark eyes, sweet smile, wearing a form-fitting gold silk camisole dress, warm ambient light, vertical portrait photo shot on 85mm lens, real skin texture.",
    motion:
      "She rests comfortably in her gold silk dress, smiling softly and looking directly into the camera lens with captivating warmth, smooth video loop",
  },
  {
    id: "386fe1f9-288f-4193-8f60-1c0cd0a5503c",
    name: "Yuki",
    prompt:
      "Photo of a real 23-year-old Japanese woman named Yuki, silky dark hair, clear porcelain skin, gentle gaze, wearing a form-fitting sky blue silk slip dress, soft natural window light, vertical portrait photo shot on 85mm lens, authentic raw skin texture.",
    motion:
      "She sways gently in her blue silk slip dress, smiling sweet and making gentle eye contact with the camera, natural breathing loop",
  },
];

async function uploadPortrait(dataUrl: string, name: string): Promise<string> {
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const storagePath = `companions/model-${name.toLowerCase()}-skimpy-${Date.now()}.png`;

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
  console.log("=== STARTING MODEL CONSISTENCY & SKIMPY DRESS FIX ===");
  console.log(`Processing ${MODELS_TO_FIX.length} key models...\n`);

  for (const m of MODELS_TO_FIX) {
    console.log(`----------------------------------------`);
    console.log(`📸 STEP 1: Generating portrait for ${m.name} (${m.id})...`);
    
    try {
      const dataUrl = await generateCompanionPortrait(m.prompt, {
        gender: "female",
        noNudity: true,
      });

      const imageUrl = await uploadPortrait(dataUrl, m.name);
      console.log(`  Uploaded portrait: ${imageUrl}`);

      const { error: dbErr } = await db
        .from("companions")
        .update({ image_url: imageUrl })
        .eq("id", m.id);

      if (dbErr) {
        console.error(`  ❌ DB update failed for ${m.name}:`, dbErr);
        continue;
      }
      console.log(`  ✅ DB updated image_url for ${m.name}`);

      console.log(`🎥 STEP 2: Generating 1:1 video reel for ${m.name}...`);
      const startFrame = await squareStartFrame(imageUrl, m.id);

      const job = await runpodRun(endpoint, {
        image_url: startFrame,
        fps: Number(process.env.RUNPOD_VIDEO_FPS || "16"),
        frames_per_scene: Number(process.env.RUNPOD_VIDEO_FRAMES || "82"),
        num_scenes: 1,
        sampling_steps: Number(process.env.RUNPOD_VIDEO_STEPS || "10"),
        prompts: [m.motion],
        negative_prompt:
          "blurry, low quality, deformed, extra limbs, watermark, text, static, still, frozen, no movement, bad anatomy, cartoon, anime, 3d render, nudity, naked, topless",
      });

      console.log(`  Queued video job ${job.id}, waiting for rendering...`);
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

    } catch (err: any) {
      console.error(`  ❌ Error processing ${m.name}:`, err?.message || err);
    }
  }

  console.log(`\n=== COMPLETED ALL MODEL UPDATES ===`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
