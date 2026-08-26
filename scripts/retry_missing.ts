import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://bhjnfsqbocyfczpbxtrz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const XAI_API_KEY = process.env.XAI_API_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function generateXaiImage(prompt: string): Promise<Buffer> {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "grok-2-vision-1212",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`xAI API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const match = content.match(/https?:\/\/[^\s"'<>\)]+/);
  
  if (!match) {
    throw new Error("No image URL returned by Grok. Response: " + content.slice(0, 200));
  }

  const imageUrl = match[0];
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error("Failed to download generated image from " + imageUrl);
  const arrayBuffer = await imgRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadAvatarToSupabase(imageBuffer: Buffer, fileName: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("avatars")
    .upload(`companions/${fileName}`, imageBuffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    throw new Error(`Supabase storage upload failed: ${error.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from("avatars")
    .getPublicUrl(data.path);

  return publicUrlData.publicUrl;
}

async function main() {
  console.log("=== RETRYING MISSING MODELS: Aria, Nova, Ethan ===");

  // 1. Aria
  try {
    console.log("Generating new realistic portrait for Aria...");
    const prompt = "ultra realistic raw photo of a gorgeous 22 year old woman named Aria with sleek straight dark blonde hair, hazel eyes, light natural makeup, stylish casual outfit, high detail skin texture, shot on 35mm lens, depth of field, photorealistic, 8k resolution, authentic portrait";
    const imgBuf = await generateXaiImage(prompt);
    const avatarUrl = await uploadAvatarToSupabase(imgBuf, `model-aria-${Date.now()}.png`);
    
    const { error: updateErr } = await supabase
      .from("companions")
      .update({ avatar_url: avatarUrl })
      .eq("name", "Aria");

    if (updateErr) throw updateErr;
    console.log("✅ Successfully updated Aria portrait:", avatarUrl);
  } catch (err: any) {
    console.error("Failed Aria retry:", err.message || err);
  }

  // 2. Nova
  try {
    console.log("Generating portrait for new model Nova (trans-female, lesbian)...");
    const prompt = "ultra realistic raw photorealistic portrait of a stylish 24 year old transgender woman named Nova, glowing radiant smile, blonde wavy hair, chic streetwear, soft natural lighting, high detail skin texture, 35mm lens, depth of field, 8k resolution";
    const imgBuf = await generateXaiImage(prompt);
    const avatarUrl = await uploadAvatarToSupabase(imgBuf, `model-nova-${Date.now()}.png`);

    const { data: companion, error: insertErr } = await supabase
      .from("companions")
      .insert({
        name: "Nova",
        avatar_url: avatarUrl,
        bio: "Creative, passionate, and living authentically. Love deep talks, indie rock, and night city walks 💫",
        tagline: "Live boldly, love freely ✨",
        system_prompt: "You are Nova, a 24-year-old trans woman companion. You are creative, warm, expressive, and passionate about music, art, and genuine emotional connections.",
        gender: "f",
        tags: ["trans", "lesbian", "creative", "stylish"],
      })
      .select()
      .single();

    if (insertErr) throw insertErr;
    console.log(`✅ Successfully created model: Nova (ID: ${companion.id})!`);
  } catch (err: any) {
    console.error("Failed Nova retry:", err.message || err);
  }

  // 3. Ethan
  try {
    console.log("Generating portrait for new model Ethan (male, gay)...");
    const prompt = "ultra realistic raw photorealistic portrait of a attractive 26 year old man named Ethan, short dark styled hair, warm brown eyes, friendly charismatic smile, fitted casual shirt, warm soft lighting, high detail skin texture, 35mm lens, depth of field, 8k resolution";
    const imgBuf = await generateXaiImage(prompt);
    const avatarUrl = await uploadAvatarToSupabase(imgBuf, `model-ethan-${Date.now()}.png`);

    const { data: companion, error: insertErr } = await supabase
      .from("companions")
      .insert({
        name: "Ethan",
        avatar_url: avatarUrl,
        bio: "Fitness enthusiast, barista by day, photographer by night. Always down for late-night coffee and honest chats ☕📷",
        tagline: "Chasing good energy and authentic vibes ✨",
        system_prompt: "You are Ethan, a 26-year-old gay male companion. You are charismatic, attentive, warm, and love fitness, photography, and meaningful conversations.",
        gender: "m",
        tags: ["gay", "male", "athletic", "photographer"],
      })
      .select()
      .single();

    if (insertErr) throw insertErr;
    console.log(`✅ Successfully created model: Ethan (ID: ${companion.id})!`);
  } catch (err: any) {
    console.error("Failed Ethan retry:", err.message || err);
  }

  console.log("Retry finished.");
}

main().catch(console.error);
