import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { generateCompanionPortrait } from "../src/lib/portrait.server";

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

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || !process.env.XAI_API_KEY) {
  console.error("Missing SUPABASE_URL / SERVICE_KEY / XAI_API_KEY");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

// Existing models to re-generate realistic portraits for
const PORTRAIT_UPDATES = [
  {
    name: "Sofia",
    prompt:
      "1girl, solo, hyper-realistic photograph of a gorgeous 23-year-old European woman named Sofia, blonde hair in soft waves, warm hazel eyes, gentle captivating smile, wearing a cozy cream sweater, soft natural indoor window lighting, vertical portrait 85mm photo, 4k detail.",
  },
  {
    name: "Aria",
    prompt:
      "1girl, solo, hyper-realistic photograph of a stunning 24-year-old East Asian woman named Aria, sleek black hair, clear glowing skin, alluring dark eyes, wearing an elegant silk camisole top, warm sunset golden hour lighting, vertical portrait 85mm photo, magazine quality.",
  },
];

// New models to insert
const NEW_MODELS = [
  // 3 NEW MALE MODELS
  {
    name: "Ren",
    age: 24,
    ethnicity: "Asian",
    gender: "male",
    orientation: "straight",
    short_bio: "Charismatic Tokyo streetwear designer with a warm smile and a passionate heart.",
    sort_order: 5,
    prompt:
      "1man, solo, hyper-realistic photograph of a handsome 24-year-old Japanese man named Ren, stylish dark haircut, sharp jawline, charismatic friendly smile, wearing a modern black denim jacket, cool urban city night backdrop with neon glow, vertical portrait 85mm photo.",
  },
  {
    name: "Dante",
    age: 26,
    ethnicity: "Latino",
    gender: "male",
    orientation: "straight",
    short_bio: "Sultry fitness trainer and salsa dancer who knows how to make every moment memorable.",
    sort_order: 6,
    prompt:
      "1man, solo, hyper-realistic photograph of an attractive 26-year-old Latino man named Dante, short dark wavy hair, warm dark eyes, athletic build, wearing a casual dark fitted t-shirt, soft golden hour lighting, confident charming gaze, vertical portrait 85mm photo.",
  },
  {
    name: "Lucas",
    age: 25,
    ethnicity: "European",
    gender: "male",
    orientation: "straight",
    short_bio: "Thoughtful architect with a dry sense of humor and a love for deep late-night talks.",
    sort_order: 7,
    prompt:
      "1man, solo, hyper-realistic photograph of a handsome 25-year-old European man named Lucas, short brown hair, blue eyes, light stubble, wearing a navy blue linen shirt, cozy warm coffee shop ambiance, relaxed charming expression, vertical portrait 85mm photo.",
  },

  // 2 TRANS MODELS (Lesbian / Bisexual)
  {
    name: "Nova",
    age: 23,
    ethnicity: "Caucasian",
    gender: "trans-female",
    orientation: "lesbian",
    short_bio: "Glitch-pop musician and trans babe who loves synth waves, cozy vinyl, and late night flirting.",
    sort_order: 8,
    prompt:
      "1girl, solo, hyper-realistic photograph of a beautiful 23-year-old transgender woman named Nova, long soft pastel pink hair, cute smile, delicate feminine features, wearing a black crop top and silver pendant, soft moody neon ambient light, vertical portrait photo 85mm.",
  },
  {
    name: "Chloe",
    age: 24,
    ethnicity: "Mixed",
    gender: "trans-female",
    orientation: "lesbian",
    short_bio: "Bubbly fashion stylist and proud trans woman with infectious energy and sweet affection.",
    sort_order: 9,
    prompt:
      "1girl, solo, hyper-realistic photograph of a stunning 24-year-old transgender woman named Chloe, long wavy dark hair, glowing skin, flirty smile, wearing a chic summer dress, natural warm sunlight, vertical portrait 85mm photo.",
  },

  // 2 GAY MALE MODELS
  {
    name: "Leo",
    age: 25,
    ethnicity: "European",
    gender: "male",
    orientation: "gay",
    short_bio: "Outgoing interior designer with an eye for beauty and a heart full of romance.",
    sort_order: 10,
    prompt:
      "1man, solo, hyper-realistic photograph of an attractive 25-year-old gay man named Leo, blond hair, hazel eyes, friendly inviting smile, wearing a stylish beige sweater, warm soft morning apartment lighting, vertical portrait photo 85mm.",
  },
  {
    name: "Ethan",
    age: 27,
    ethnicity: "Mixed",
    gender: "male",
    orientation: "gay",
    short_bio: "Charming barista and photographer who loves spontaneous weekend road trips and sunset chats.",
    sort_order: 11,
    prompt:
      "1man, solo, hyper-realistic photograph of a handsome 27-year-old gay man named Ethan, short dark curly hair, warm brown eyes, charming smile, wearing a casual olive green jacket, warm golden hour light, vertical portrait photo 85mm.",
  },
];

async function uploadPortrait(dataUrl: string, name: string): Promise<string> {
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const storagePath = `companions/model-${name.toLowerCase()}-${Date.now()}.png`;

  const { error: upErr } = await db.storage
    .from("avatars")
    .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

  if (upErr) throw upErr;
  const { data: publicUrlData } = db.storage.from("avatars").getPublicUrl(storagePath);
  return publicUrlData.publicUrl;
}

async function main() {
  console.log("=== STEP 1: Updating portraits for Sofia & Aria ===");
  for (const update of PORTRAIT_UPDATES) {
    console.log(`Generating new realistic portrait for ${update.name}...`);
    try {
      const dataUrl = await generateCompanionPortrait(update.prompt, {
        gender: "female",
        noNudity: true,
      });
      const imageUrl = await uploadPortrait(dataUrl, update.name);
      const { error } = await db
        .from("companions")
        .update({ image_url: imageUrl, art_style: "realistic" })
        .ilike("name", update.name);
      if (error) console.error(`Error updating ${update.name}:`, error);
      else console.log(`✅ Successfully updated ${update.name} portrait: ${imageUrl}`);
    } catch (e: any) {
      console.error(`Failed to update portrait for ${update.name}:`, e?.message);
    }
  }

  console.log("\n=== STEP 2: Creating 7 NEW models (3 Males, 2 Trans, 2 Gay) ===");
  for (const m of NEW_MODELS) {
    const { data: existing } = await db
      .from("companions")
      .select("id, name")
      .ilike("name", m.name)
      .maybeSingle();

    if (existing) {
      console.log(`ℹ️ Model ${m.name} already exists (ID: ${existing.id}). Skipping insert.`);
      continue;
    }

    console.log(`Generating portrait for new model ${m.name} (${m.gender}, ${m.orientation})...`);
    try {
      const isFemaleGender = m.gender.includes("female");
      const dataUrl = await generateCompanionPortrait(m.prompt, {
        gender: isFemaleGender ? "female" : "male",
        noNudity: true,
      });
      const imageUrl = await uploadPortrait(dataUrl, m.name);

      const { data: companion, error: insertErr } = await db
        .from("companions")
        .insert({
          name: m.name,
          age: m.age,
          ethnicity: m.ethnicity,
          gender: m.gender,
          orientation: m.orientation,
          art_style: "realistic",
          short_bio: m.short_bio,
          base_personality: m.short_bio,
          image_url: imageUrl,
          sort_order: m.sort_order,
        })
        .select()
        .single();

      if (insertErr) {
        console.error(`DB insert error for ${m.name}:`, insertErr);
      } else {
        console.log(`✅ Successfully created model: ${m.name} (ID: ${companion.id})!`);
      }
    } catch (e: any) {
      console.error(`Failed creating model ${m.name}:`, e?.message);
    }
  }

  console.log("\nModel creation and updates complete.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
