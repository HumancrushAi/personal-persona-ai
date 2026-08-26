import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import https from "node:https";
import { createClient } from "@supabase/supabase-js";

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
const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

mkdirSync("tmp_frames", { recursive: true });

async function extractFrameAndUpload(companionId: string, companionName: string) {
  const videoUrl = `https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/reels/companion-${companionId}.mp4`;
  console.log(`\nProcessing ${companionName} (${companionId})...`);
  
  // Download video
  const res = await fetch(videoUrl);
  if (!res.ok) {
    console.error(`❌ Could not fetch video for ${companionName} (${res.status})`);
    return null;
  }
  const videoBuf = Buffer.from(await res.arrayBuffer());
  const videoPath = `tmp_frames/${companionId}.mp4`;
  const framePath = `tmp_frames/${companionId}_frame.jpg`;
  writeFileSync(videoPath, videoBuf);

  // Extract first frame with ffmpeg
  const ffmpegExe = "node_modules\\\\ffmpeg-static\\\\ffmpeg.exe";
  try {
    execSync(`"${ffmpegExe}" -y -ss 00:00:00.100 -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}"`, { stdio: "pipe" });
  } catch (err) {
    console.error(`ffmpeg failed for ${companionName}:`, err);
    return null;
  }

  const frameBuf = readFileSync(framePath);
  const storagePath = `companions/${companionId}-exactframe-${Date.now()}.jpg`;

  // Upload via resilient https PUT
  const uploadSuccess = await new Promise<boolean>((resolve) => {
    const u = new URL(`${url}/storage/v1/object/avatars/${storagePath}`);
    const req = https.request(
      u,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          "Content-Type": "image/jpeg",
          "Content-Length": frameBuf.length,
          "x-upsert": "true",
        },
      },
      (res) => {
        resolve(res.statusCode === 200 || res.statusCode === 201);
      }
    );
    req.on("error", (e) => {
      console.error("Upload error:", e);
      resolve(false);
    });
    req.write(frameBuf);
    req.end();
  });

  if (!uploadSuccess) {
    console.error(`❌ Upload failed for ${companionName}`);
    return null;
  }

  const publicUrl = `${url}/storage/v1/object/public/avatars/${storagePath}`;
  const { error: dbErr } = await sb.from("companions").update({ image_url: publicUrl }).eq("id", companionId);
  if (dbErr) {
    console.error(`❌ DB update failed for ${companionName}:`, dbErr);
    return null;
  }

  console.log(`✅ ${companionName} updated to exact video frame: ${publicUrl}`);
  return publicUrl;
}

async function run() {
  const SLIDER_COMPANIONS = [
    { id: "2c252785-fe75-4c84-a803-af9c484f6c96", name: "Aria" },
    { id: "9a173fea-67ea-45d3-996a-9084dc3c98d0", name: "Sofia" },
    { id: "f668101d-486e-45e2-9e87-69e70e272401", name: "Raven" },
    { id: "5eaaf212-055d-44f8-841e-94967f4a674c", name: "Vesper" },
    { id: "eae18174-2e5e-4bc5-8c3f-16e1b5265e50", name: "Ruby" },
    { id: "78e5f6af-2c52-4dde-b710-09512d28f9aa", name: "Dante" },
  ];

  for (const c of SLIDER_COMPANIONS) {
    await extractFrameAndUpload(c.id, c.name);
  }
}

run();
