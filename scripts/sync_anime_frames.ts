import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import https from "node:https";
import { createClient } from "@supabase/supabase-js";
import ffmpeg from "ffmpeg-static";

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

async function uploadBuf(storagePath: string, buf: Buffer): Promise<string | null> {
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
          "Content-Length": buf.length,
          "x-upsert": "true",
        },
      },
      (res) => resolve(res.statusCode === 200 || res.statusCode === 201)
    );
    req.on("error", () => resolve(false));
    req.write(buf);
    req.end();
  });
  if (!uploadSuccess) return null;
  return `${url}/storage/v1/object/public/avatars/${storagePath}`;
}

async function extractFrameAndUpload(companionId: string, companionName: string) {
  const videoUrl = `${url}/storage/v1/object/public/reels/companion-${companionId}.mp4`;
  console.log(`\nExtracting exact video frame for ${companionName}...`);
  
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
  const ffmpegExe = ffmpeg || "node_modules/ffmpeg-static/ffmpeg.exe";
  try {
    execSync(`"${ffmpegExe}" -y -ss 00:00:00.100 -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}"`, { stdio: "pipe" });
  } catch (err) {
    console.error(`ffmpeg failed for ${companionName}:`, err);
    return null;
  }

  const frameBuf = readFileSync(framePath);
  const storagePath = `companions/${companionId}-exactframe-${Date.now()}.jpg`;
  const publicUrl = await uploadBuf(storagePath, frameBuf);
  
  if (!publicUrl) {
    console.error(`❌ Uploading exact frame failed for ${companionName}`);
    return null;
  }

  const { error: dbErr } = await sb.from("companions").update({ image_url: publicUrl }).eq("id", companionId);
  if (dbErr) {
    console.error(`❌ DB update failed for ${companionName}:`, dbErr);
    return null;
  }

  console.log(`✅ ${companionName} updated to exact video frame: ${publicUrl}`);
  return publicUrl;
}

async function run() {
  mkdirSync("tmp_frames", { recursive: true });

  const { data: companions, error } = await sb
    .from("companions")
    .select("id, name")
    .eq("art_style", "anime");

  if (error) {
    console.error("Error querying companions:", error);
    return;
  }

  console.log(`Syncing exact video frames for ${companions.length} anime models...`);
  for (const c of companions) {
    await extractFrameAndUpload(c.id, c.name);
  }
}

run().catch(console.error);
