import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import https from "node:https";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { generateCompanionPortrait } from "../src/lib/portrait.server";
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

  const jadeId = "667ae29d-7e55-4588-b9c8-7bfad68f455e";
  const zaraId = "948f3ac7-a60c-4342-93fb-0f3ae3578101";

  console.log("=== STEP 1: Generating full-body portrait for Jade ===");
  // Generate a sexy realistic fullbody portrait for Jade
  const jadePrompt = "1girl, solo, hyper-realistic photograph of a gorgeous 23-year-old cyberpunk goth gamer girl named Jade, long straight black hair with vivid emerald green streaks, dark gothic makeup, wearing a stylish black crop top and pleated mini skirt, standing in a bedroom lit with cool violet and blue neon gamer lights, vertical portrait 85mm photo, 4k detail, full body shot.";
  
  let jadeImageUrl = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      console.log(`Generating Jade full-body portrait (attempt ${attempt})...`);
      jadeImageUrl = await generateCompanionPortrait(jadePrompt, { gender: "female", noNudity: true });
      if (jadeImageUrl) break;
    } catch (err) {
      console.error(`Attempt ${attempt} error:`, err);
      if (attempt < 4) await new Promise((r) => setTimeout(r, 4000));
    }
  }

  if (jadeImageUrl) {
    // If it returns base64 data url, parse and upload
    const base64Data = jadeImageUrl.replace(/^data:image\/\w+;base64,/, "");
    const buf = Buffer.from(base64Data, "base64");
    const jadeUrl = await uploadBuf(`companions/${jadeId}-fullbody-${Date.now()}.jpg`, buf);
    if (jadeUrl) {
      await sb.from("companions").update({ image_url: jadeUrl }).eq("id", jadeId);
      console.log("✅ Jade full-body portrait uploaded and updated in DB:", jadeUrl);
    }
  } else {
    console.error("❌ Failed to generate Jade full-body portrait");
  }

  console.log("\n=== STEP 2: Generating full-body video reels for Zara and Jade ===");
  try {
    // Execute generate-reels.ts to run image-to-video using RunPod for both Zara and Jade
    console.log("Executing generate-reels.ts for Zara and Jade...");
    execSync("npx tsx scripts/generate-reels.ts --only=Zara,Jade --force", { stdio: "inherit" });
    console.log("✅ Video reels generated successfully!");
  } catch (err) {
    console.error("❌ Failed to generate video reels:", err);
  }

  console.log("\n=== STEP 3: Extracting exact first frame and updating DB for both ===");
  await extractFrameAndUpload(zaraId, "Zara");
  await extractFrameAndUpload(jadeId, "Jade");

  console.log("\n🎉 Zara and Jade are now fully fixed with matching full-body portraits and video reels!");
}

run().catch(console.error);
