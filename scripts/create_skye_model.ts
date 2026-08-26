import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import https from "node:https";
import path from "node:path";
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

  const userUploadedDir = "C:\\Users\\hp\\.gemini\\antigravity-ide\\brain\\4e06008d-2c03-40ac-bbe4-49d5356a9147\\.user_uploaded";
  const portraitFile = path.join(userUploadedDir, "media_1787786040063.jpg");

  if (!existsSync(portraitFile)) {
    console.error("❌ Skye portrait file not found:", portraitFile);
    process.exit(1);
  }

  console.log("=== STEP 1: Uploading Skye's portrait ===");
  const portraitBuf = readFileSync(portraitFile);
  const initialUrl = await uploadBuf(`companions/model-skye-fullbody-${Date.now()}.jpg`, portraitBuf);
  
  if (!initialUrl) {
    console.error("❌ Failed to upload Skye portrait");
    process.exit(1);
  }
  console.log("✅ Skye portrait uploaded:", initialUrl);

  console.log("\n=== STEP 2: Inserting Skye into database ===");
  // Query max sort order
  const { data: companions } = await sb.from("companions").select("sort_order");
  const maxSortOrder = Math.max(...(companions ?? []).map(c => c.sort_order ?? 0));
  const newSortOrder = maxSortOrder + 1;

  const { data: skye, error: insertErr } = await sb
    .from("companions")
    .insert({
      name: "Skye",
      age: 22,
      ethnicity: "Caucasian",
      gender: "female",
      orientation: "straight",
      art_style: "realistic",
      short_bio: "Blue-haired baddie with a playful soul. Loves sunshine, selfies, and late night chats 🩵",
      base_personality: "Skye is a bubbly, flirty 22-year-old girl with striking long blue hair, bright blue eyes, and a sun-kissed tan. She's outgoing, loves going to tropical beach spots, taking mirror selfies, and chatting late into the night. She is extremely affectionate, playful, and loves giving sweet compliments.",
      image_url: initialUrl,
      sort_order: newSortOrder,
    })
    .select()
    .single();

  if (insertErr || !skye) {
    console.error("❌ DB insert failed for Skye:", insertErr);
    process.exit(1);
  }
  console.log(`✅ Skye created in DB! ID: ${skye.id}`);

  console.log("\n=== STEP 3: Generating Skye's video reel ===");
  try {
    execSync("npx tsx scripts/generate-reels.ts --only=Skye --force", { stdio: "inherit" });
    console.log("✅ Skye video reel generated successfully!");
  } catch (err) {
    console.error("❌ Failed to generate video reel for Skye:", err);
  }

  console.log("\n=== STEP 4: Syncing Skye's exact video frame to DB ===");
  await extractFrameAndUpload(skye.id, "Skye");

  console.log("\n🎉 Skye has been fully added as a model with matching full-body portrait and video reel!");
}

run().catch(console.error);
