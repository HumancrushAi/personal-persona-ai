import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import sharp from "sharp";

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
if (!url || !serviceKey) {
  console.error("❌ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const ffmpegExe = "node_modules\\\\ffmpeg-static\\\\ffmpeg.exe";

mkdirSync("tmp_reels", { recursive: true });

const TARGET_COMPANIONS = [
  { name: "Raven", id: "f668101d-486e-45e2-9e87-69e70e272401" },
  { name: "Aria", id: "2c252785-fe75-4c84-a803-af9c484f6c96" },
  { name: "Mei", id: "f9aa06f5-7f49-4f5f-be43-f707e8a2ef78" },
  { name: "Sofia", id: "9a173fea-67ea-45d3-996a-9084dc3c98d0" },
  { name: "Jade", id: "667ae29d-7e55-4588-b9c8-7bfad68f455e" },
  { name: "Vesper", id: "5eaaf212-055d-44f8-841e-94967f4a674c" },
  { name: "Nyx", id: "41aef40b-e716-4e4c-b372-cb56c073a9cb" },
  { name: "Amara", id: "c143557b-ada4-447d-93a0-19d0fb2388d8" },
  { name: "Priya", id: "24766b56-6df0-4cb8-a174-6d9120554a55" },
  { name: "Yuki", id: "386fe1f9-288f-4193-8f60-1c0cd0a5503c" },
  { name: "Ruby", id: "eae18174-2e5e-4bc5-8c3f-16e1b5265e50" },
  { name: "Zara", id: "948f3ac7-a60c-4342-93fb-0f3ae3578101" },
];

async function generateAnimatedReel(companionId: string, companionName: string) {
  console.log(`\n----------------------------------------`);
  console.log(`🎬 Processing animated reel for ${companionName} (${companionId})...`);

  // Fetch companion record from DB
  const { data: comp, error: fetchErr } = await db
    .from("companions")
    .select("id, name, image_url")
    .eq("id", companionId)
    .maybeSingle();

  if (fetchErr || !comp?.image_url) {
    console.error(`❌ Could not fetch image_url for ${companionName}:`, fetchErr?.message);
    return false;
  }

  console.log(`  Portrait URL: ${comp.image_url}`);

  // Download portrait image
  const res = await fetch(comp.image_url);
  if (!res.ok) {
    console.error(`❌ Failed to fetch image for ${companionName} (${res.status})`);
    return false;
  }

  const imageBuf = Buffer.from(await res.arrayBuffer());
  const inputImgPath = `tmp_reels/${companionId}_input.png`;
  const outputMp4Path = `tmp_reels/${companionId}_output.mp4`;

  // Crop / resize input image to 768x960 clean aspect ratio using sharp
  const preparedImgBuf = await sharp(imageBuf)
    .resize(768, 960, { fit: "cover", position: "top" })
    .png()
    .toBuffer();

  writeFileSync(inputImgPath, preparedImgBuf);

  // Generate 5-second 30fps H.264 smooth Ken Burns animated video using ffmpeg
  const ffmpegCmd = `"${ffmpegExe}" -y -loop 1 -i "${inputImgPath}" -vf "zoompan=z='min(zoom+0.0012,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=768x960:fps=30" -c:v libx264 -preset fast -tune stillimage -crf 20 -pix_fmt yuv420p -t 5 "${outputMp4Path}"`;

  try {
    execSync(ffmpegCmd, { stdio: "pipe" });
  } catch (err: any) {
    console.error(`❌ ffmpeg execution failed for ${companionName}:`, err?.message || err);
    return false;
  }

  if (!existsSync(outputMp4Path)) {
    console.error(`❌ Output MP4 not found for ${companionName}`);
    return false;
  }

  const mp4Buf = readFileSync(outputMp4Path);
  console.log(`  Rendered MP4 file size: ${Math.round(mp4Buf.length / 1024)}KB`);

  // Upload generated MP4 video to Supabase reels bucket as companion-<id>.mp4
  const storagePath = `companion-${companionId}.mp4`;
  const { error: uploadErr } = await db.storage
    .from("reels")
    .upload(storagePath, mp4Buf, { contentType: "video/mp4", upsert: true });

  if (uploadErr) {
    console.error(`❌ Failed to upload video reel for ${companionName}:`, uploadErr);
    return false;
  }

  const publicUrl = `${url}/storage/v1/object/public/reels/${storagePath}`;
  console.log(`  ✅ Successfully uploaded 1:1 matching animated video reel: ${publicUrl}`);

  // Cleanup temp files
  try {
    unlinkSync(inputImgPath);
    unlinkSync(outputMp4Path);
  } catch {}

  return true;
}

async function main() {
  console.log("=== GENERATING 1:1 MATCHING ANIMATED VIDEO REELS FOR ALL COMPANIONS ===");

  const { data: companions, error } = await db
    .from("companions")
    .select("id, name, image_url")
    .is("created_by", null)
    .order("sort_order");

  if (error || !companions) {
    console.error("❌ Failed to fetch companions from DB:", error?.message);
    process.exit(1);
  }

  console.log(`Found ${companions.length} default companions to process.`);

  let successCount = 0;
  for (const c of companions) {
    if (!c.image_url) continue;
    const ok = await generateAnimatedReel(c.id, c.name);
    if (ok) successCount++;
  }

  console.log(`\n=== COMPLETED ${successCount}/${companions.length} ANIMATED REELS ===`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
