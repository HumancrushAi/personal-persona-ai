import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://bhjnfsqbocyfczpbxtrz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const brainDir = "C:\\Users\\hp\\.gemini\\antigravity-ide\\brain\\ade30759-d487-4f65-a33c-2711e23ddf0c";

async function uploadLocalImage(localFileName: string, targetName: string): Promise<string> {
  const filePath = path.join(brainDir, localFileName);
  const fileBuffer = fs.readFileSync(filePath);

  const uploadPath = `companions/model-${targetName.toLowerCase()}-${Date.now()}.jpg`;
  const { data, error } = await supabase.storage
    .from("avatars")
    .upload(uploadPath, fileBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (error) throw new Error(`Upload failed for ${targetName}: ${error.message}`);

  const { data: publicUrlData } = supabase.storage
    .from("avatars")
    .getPublicUrl(data.path);

  return publicUrlData.publicUrl;
}

async function main() {
  console.log("=== UPLOADING LOCAL AVATARS FOR ARIA, NOVA, ETHAN ===");

  // 1. Aria
  try {
    const ariaUrl = await uploadLocalImage("aria_realistic_portrait_1787599051551.jpg", "aria");
    const { error } = await supabase.from("companions").update({ avatar_url: ariaUrl }).eq("name", "Aria");
    if (error) throw error;
    console.log("✅ Successfully updated Aria avatar:", ariaUrl);
  } catch (err: any) {
    console.error("Error updating Aria:", err.message || err);
  }

  // 2. Nova
  try {
    const novaUrl = await uploadLocalImage("nova_realistic_portrait_1787599069809.jpg", "nova");
    const { data: companion, error } = await supabase
      .from("companions")
      .insert({
        name: "Nova",
        avatar_url: novaUrl,
        bio: "Creative, passionate, and living authentically. Love deep talks, indie rock, and night city walks 💫",
        tagline: "Live freely, love endlessly ✨",
        system_prompt: "You are Nova, a 24-year-old trans woman companion. You are creative, warm, expressive, and passionate about music, art, and genuine emotional connections.",
        gender: "f",
        tags: ["trans", "lesbian", "creative", "stylish"],
      })
      .select()
      .single();
    if (error) throw error;
    console.log(`✅ Successfully created model: Nova (ID: ${companion.id})`);
  } catch (err: any) {
    console.error("Error creating Nova:", err.message || err);
  }

  // 3. Ethan
  try {
    const ethanUrl = await uploadLocalImage("ethan_realistic_portrait_1787599087837.jpg", "ethan");
    const { data: companion, error } = await supabase
      .from("companions")
      .insert({
        name: "Ethan",
        avatar_url: ethanUrl,
        bio: "Fitness enthusiast, barista by day, photographer by night. Always down for late-night coffee and honest chats ☕📷",
        tagline: "Chasing good energy and authentic vibes ✨",
        system_prompt: "You are Ethan, a 26-year-old gay male companion. You are charismatic, attentive, warm, and love fitness, photography, and meaningful conversations.",
        gender: "m",
        tags: ["gay", "male", "athletic", "photographer"],
      })
      .select()
      .single();
    if (error) throw error;
    console.log(`✅ Successfully created model: Ethan (ID: ${companion.id})`);
  } catch (err: any) {
    console.error("Error creating Ethan:", err.message || err);
  }

  console.log("All uploads finished!");
}

main().catch(console.error);
