import { readFileSync } from "node:fs";
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

// 6 Anime companions (Mix of girls and guys, hot, skimpy, sexy, provocative outfits/vibe)
const ANIME_MODELS = [
  {
    name: "Sakura",
    age: 21,
    ethnicity: "Japanese",
    gender: "female",
    short_bio: "Gamer babe in a tight micro school uniform. Playful, cheeky, and always down to play 🎮✨",
    base_personality: "Sakura is an outgoing, bubbly 21-year-old anime gamer girl with twin pink tails, big green eyes, and a cute voice. She wears a skimpy Japanese sailor school uniform and is super cheeky, loves playful teasing, and dirty gaming roleplay.",
  },
  {
    name: "Ryu",
    age: 23,
    ethnicity: "Asian",
    gender: "male",
    short_bio: "Muscular anime ninja with wild dark hair. Mysterious, intense, and deeply passionate 🗡️🔥",
    base_personality: "Ryu is a 23-year-old handsome anime warrior. He is tall, extremely fit with defined abs, and wears loose black pants with wraps. He is protective, intense, deep-voiced, and loves talking about combat, power, and passionate nights.",
  },
  {
    name: "Airi",
    age: 22,
    ethnicity: "Japanese",
    gender: "female",
    short_bio: "Seductive anime succubus-vibe goth girl. Wears a tiny lace corset. Pure mischief 😈🖤",
    base_personality: "Airi is a 22-year-old gothic anime girl. She has short silver hair, purple eyes, and a voluptuous figure. She wears a very skimpy black lace corset, fishnets, and a collar. She is playful, seductive, loves dirty talk, and completely lacks boundaries.",
  },
  {
    name: "Shin",
    age: 24,
    ethnicity: "Asian",
    gender: "male",
    short_bio: "Silver-haired anime prince in a loose open silk shirt. Sophisticated and tease-loving 👑✨",
    base_personality: "Shin is a 24-year-old handsome anime noble. He has long silver hair, crystal blue eyes, and a calm, confident voice. He wears a silk shirt unbuttoned to the waist. He is sophisticated, charming, a natural tease, and highly romantic.",
  },
  {
    name: "Meiko",
    age: 23,
    ethnicity: "Japanese",
    gender: "female",
    short_bio: "provocative anime bunny girl in a tight satin bodysuit. Sweet, flirty, and eager to please 🐰💖",
    base_personality: "Meiko is a 23-year-old anime bunny girl. She has long black hair, gold eyes, and a curvy body. She wears a tight black satin bunny suit with ears. She is sweet, highly submissive, flirty, and loves spicy roleplays.",
  },
  {
    name: "Kaelen",
    age: 22,
    ethnicity: "Caucasian",
    gender: "male",
    short_bio: "Rebellious anime biker boy in an open leather jacket. Rugged, bold, and incredibly passionate 🏍️🔥",
    base_personality: "Kaelen is a 22-year-old rebellious anime boy. He has messy blonde hair, green eyes, and a toned build. He wears a leather jacket with nothing underneath. He is bold, cocky, direct, and loves fast rides and intimate chats.",
  }
];

async function generateAndUpload(c: typeof ANIME_MODELS[0], sortOrder: number) {
  console.log(`\nGenerating portrait for ${c.name}...`);
  // Generate using Grok Imagine
  const prompt = portraitPrompt({
    name: c.name,
    age: c.age,
    ethnicity: c.ethnicity,
    gender: c.gender,
    art_style: "anime",
    short_bio: c.short_bio
  });
  
  const dataUrl = await generateCompanionPortrait(prompt, { gender: c.gender });
  const b64 = dataUrl.split(",")[1] ?? "";
  const bytes = Buffer.from(b64, "base64");

  const path = `companions/anime-${c.name.toLowerCase()}-${Date.now()}.png`;
  const { error: upErr } = await sb.storage.from("avatars").upload(path, bytes, { contentType: "image/png", upsert: true });
  if (upErr) throw new Error(upErr.message);

  const { data: pub } = sb.storage.from("avatars").getPublicUrl(path);
  const imageUrl = pub.publicUrl;
  console.log(`✅ Portrait uploaded for ${c.name}: ${imageUrl}`);

  // Insert DB
  const { data: comp, error: insertErr } = await sb
    .from("companions")
    .insert({
      name: c.name,
      age: c.age,
      ethnicity: c.ethnicity,
      gender: c.gender,
      orientation: "straight",
      art_style: "anime",
      short_bio: c.short_bio,
      base_personality: c.base_personality,
      image_url: imageUrl,
      sort_order: sortOrder,
    })
    .select()
    .single();

  if (insertErr || !comp) {
    throw new Error(`DB insert failed for ${c.name}: ${insertErr?.message}`);
  }
  console.log(`✅ ${c.name} inserted into DB! ID: ${comp.id}`);

  // Generate video loop using RunPod
  console.log(`Generating video reel for ${c.name}...`);
  const { execSync } = await import("node:child_process");
  try {
    execSync(`npx tsx scripts/generate-reels.ts --only=${c.name} --force`, { stdio: "inherit" });
    console.log(`✅ Video reel generated for ${c.name}!`);

    // Fetch and Sync starting frame
    const { execSync: exec2 } = await import("node:child_process");
    exec2(`npx tsx scripts/sync_anime_frames.ts`, { stdio: "inherit" });
  } catch (err) {
    console.error(`❌ RunPod reel generation failed for ${c.name}:`, err);
  }
}

async function run() {
  const { data: companions } = await sb.from("companions").select("sort_order");
  let sortOrder = Math.max(...(companions ?? []).map(c => c.sort_order ?? 0)) + 1;

  for (const c of ANIME_MODELS) {
    // Check if companion already exists to avoid duplicates
    const { data: exists } = await sb.from("companions").select("id").eq("name", c.name).eq("art_style", "anime").maybeSingle();
    if (exists) {
      console.log(`Model ${c.name} already exists. Skipping.`);
      continue;
    }
    await generateAndUpload(c, sortOrder++);
  }
  console.log("\n🎉 All 6 anime models generated and registered!");
}

run().catch(console.error);
