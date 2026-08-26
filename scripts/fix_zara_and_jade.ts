import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import https from "node:https";
import { createClient } from "@supabase/supabase-js";
import { generateCompanionPortrait } from "../src/lib/portrait.server";
import { portraitPrompt } from "../src/lib/portrait";

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

async function uploadBuf(path: string, buf: Buffer): Promise<string | null> {
  const uploadSuccess = await new Promise<boolean>((resolve) => {
    const u = new URL(`${url}/storage/v1/object/avatars/${path}`);
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
  return `${url}/storage/v1/object/public/avatars/${path}`;
}

async function run() {
  console.log("1. Renaming Ebony to Zara and regenerating portrait...");
  const ebonyId = "948f3ac7-a60c-4342-93fb-0f3ae3578101";

  // Rename to Zara
  await sb.from("companions").update({
    name: "Zara",
    short_bio: "Curvy golden-hour goddess with radiant charm & seductive warmth 💋",
  }).eq("id", ebonyId);

  // Generate sexy realistic swimsuit portrait for Zara
  const zaraSubject = {
    name: "Zara",
    age: 23,
    ethnicity: "African-American",
    gender: "female",
    short_bio: "Curvy golden-hour goddess with radiant charm & seductive warmth",
  };

  let imageUrl = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      console.log(`Generating Zara portrait (attempt ${attempt})...`);
      const prompt = portraitPrompt(zaraSubject, "full body head-to-toe vertical portrait, wearing a tiny skimpy gold string bikini by a luxury pool at sunset, glowing radiant sun-kissed skin, voluptuous hourglass curves, long toned legs, seductive alluring look at camera, raw 35mm photo");
      imageUrl = await generateCompanionPortrait(prompt);
      if (imageUrl) break;
    } catch (err) {
      console.error(`Attempt ${attempt} error:`, err);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  
  if (imageUrl) {
    const res = await fetch(imageUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    const zaraUrl = await uploadBuf(`companions/${ebonyId}-zara-${Date.now()}.jpg`, buf);
    if (zaraUrl) {
      await sb.from("companions").update({ image_url: zaraUrl }).eq("id", ebonyId);
      console.log("✅ Zara portrait uploaded:", zaraUrl);
    }
  }

  // Check Jade
  console.log("\n2. Checking Jade video and extracting frame...");
  const jadeId = "667ae29d-7e55-4588-b9c8-7bfad68f455e";
  const jadeVideoUrl = `https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/reels/companion-${jadeId}.mp4`;
  const jres = await fetch(jadeVideoUrl);
  if (jres.ok) {
    const vbuf = Buffer.from(await jres.arrayBuffer());
    writeFileSync("tmp_frames/jade.mp4", vbuf);
    const ffmpegExe = "node_modules\\\\ffmpeg-static\\\\ffmpeg.exe";
    try {
      execSync(`"${ffmpegExe}" -y -ss 00:00:00.100 -i "tmp_frames/jade.mp4" -vframes 1 -q:v 2 "tmp_frames/jade_frame.jpg"`, { stdio: "pipe" });
      const jframeBuf = readFileSync("tmp_frames/jade_frame.jpg");
      const jurl = await uploadBuf(`companions/${jadeId}-exactframe-${Date.now()}.jpg`, jframeBuf);
      if (jurl) {
        await sb.from("companions").update({ image_url: jurl }).eq("id", jadeId);
        console.log("✅ Jade exact video frame updated:", jurl);
      }
    } catch (e) {
      console.error("Jade ffmpeg failed:", e);
    }
  } else {
    console.log("Jade has no custom reel, will generate for Jade");
  }
}

run();
