// Add the mature (MILF) companions: two each in their 30s, 40s and 50s.
//
//   npx vite-node scripts/create_mature_models.ts -- --dry
//   npx vite-node scripts/create_mature_models.ts
//   npx vite-node scripts/create_mature_models.ts -- --only=Diane
//
// Portraits are rendered with grok-imagine (generateCompanionPortrait), clothed
// and in the same silk/satin style as the rest of the roster. A companion whose
// name already exists is skipped, so an interrupted run resumes. Reels are made
// afterwards with: npx vite-node scripts/generate-reels.ts -- --only=<names>

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { generateCompanionPortrait } from "../src/lib/portrait.server";

function loadEnv(file: string) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* optional */
  }
}
loadEnv(".env.local");
loadEnv(".env");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg
  ? onlyArg.slice(7).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  : null;

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || !process.env.XAI_API_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / XAI_API_KEY missing from .env.local");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

type Mature = {
  name: string;
  age: number;
  ethnicity: string;
  short_bio: string;
  base_personality: string;
  portrait: string;
};

// The portrait sentence states her real age and shows it — fine lines, a grown
// woman's figure — because a 50-year-old rendered as a 25-year-old is exactly
// the mismatch this roster spent weeks removing between cards and chat.
const PHOTO =
  "vertical portrait, 85mm DSLR photo, natural warm light, real skin texture with visible pores and natural fine lines, true to her age.";

const MATURE: Mature[] = [
  {
    name: "Valeria",
    age: 30,
    ethnicity: "Latina (Colombian)",
    short_bio: "Thirty, confident and done playing games — she knows exactly what she wants.",
    base_personality:
      "Confident, warm and openly flirtatious. Teases with a knowing smile, takes the lead, and loves a man who can keep up.",
    portrait: `Candid photo of a real attractive 30-year-old Colombian woman named Valeria, long dark wavy hair, warm tan skin, brown eyes, curvy figure, wearing an elegant emerald satin slip dress with thin straps, sitting on the edge of a bed in a warm bedroom, alluring confident smile, ${PHOTO}`,
  },
  {
    name: "Natalie",
    age: 35,
    ethnicity: "American",
    short_bio: "Recently divorced, newly free — and she's not wasting another night.",
    base_personality:
      "Playful, a little mischievous, and refreshingly honest. Rediscovering herself after a long marriage and enjoying every minute of the attention.",
    portrait: `Candid photo of a real attractive 35-year-old American woman named Natalie, shoulder-length honey blonde hair, blue eyes, fit curvy figure, wearing a fitted black satin wrap dress, leaning against a kitchen counter in a stylish home at evening, playful knowing smile, ${PHOTO}`,
  },
  {
    name: "Monica",
    age: 40,
    ethnicity: "Italian",
    short_bio: "Forty, fabulous and fluent in the art of seduction.",
    base_personality:
      "Sensual, elegant and self-assured. Speaks slowly, compliments generously and enjoys taking her time. Loves wine, cooking and long conversations.",
    portrait: `Candid photo of a real attractive 40-year-old Italian woman named Monica, long dark brown hair, olive skin, dark eyes, full curvy figure, wearing an elegant deep red satin midi dress, sitting on a velvet sofa in a warmly lit living room, warm confident smile, ${PHOTO}`,
  },
  {
    name: "Keisha",
    age: 45,
    ethnicity: "African American",
    short_bio: "Grown, gorgeous and unapologetically herself.",
    base_personality:
      "Warm, witty and commanding. Big laugh, bigger heart. Flirts with confidence and loves to be adored.",
    portrait: `Candid photo of a real attractive 45-year-old African American woman named Keisha, shoulder-length natural curly hair, rich dark brown skin, warm brown eyes, voluptuous figure, wearing an elegant gold satin midi dress, sitting on a sofa with soft lamplight, warm confident smile, ${PHOTO}`,
  },
  {
    name: "Diane",
    age: 50,
    ethnicity: "American",
    short_bio: "Fifty, fit and far more fun than you'd expect.",
    base_personality:
      "Classy on the outside, wicked sense of humour underneath. Experienced, patient and endlessly curious about you.",
    portrait: `Candid photo of a real attractive 50-year-old American woman named Diane, styled platinum blonde bob, blue eyes, slim fit mature figure, wearing an elegant navy silk blouse and fitted skirt, sitting by a window in an elegant living room at golden hour, warm charming smile, ${PHOTO}`,
  },
  {
    name: "Carmen",
    age: 55,
    ethnicity: "Spanish",
    short_bio: "Fifty-five and still the most magnetic woman in any room.",
    base_personality:
      "Passionate, nurturing and teasing. A former flamenco dancer with a slow, smoky voice who loves to spoil the person she's talking to.",
    portrait: `Candid photo of a real attractive 55-year-old Spanish woman named Carmen, long silver-streaked dark hair, olive skin, dark eyes, curvy mature figure, wearing an elegant black satin evening dress, sitting on a velvet armchair in a softly lit living room, confident charming smile, ${PHOTO}`,
  },
];

async function uploadPortrait(dataUrl: string, name: string): Promise<string> {
  const buffer = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
  const path = `companions/model-${name.toLowerCase()}-mature-${Date.now()}.png`;
  const { error } = await db.storage
    .from("avatars")
    .upload(path, buffer, { contentType: "image/png", upsert: true });
  if (error) throw error;
  return db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

async function portraitFor(m: Mature): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await generateCompanionPortrait(m.portrait, { gender: "female", noNudity: true });
    } catch (e) {
      lastErr = e;
      console.log(`   attempt ${attempt} failed: ${(e as Error).message}`);
    }
  }
  throw lastErr;
}

async function main() {
  const list = only ? MATURE.filter((m) => only.includes(m.name.toLowerCase())) : MATURE;

  const { data: existing } = await db
    .from("companions")
    .select("name, sort_order")
    .is("created_by", null);
  const have = new Set((existing ?? []).map((c) => c.name.toLowerCase()));
  let sort = Math.max(0, ...(existing ?? []).map((c) => c.sort_order ?? 0));

  for (const m of list) {
    if (have.has(m.name.toLowerCase())) {
      console.log(`= ${m.name} already exists, skipping`);
      continue;
    }
    if (dryRun) {
      console.log(`+ ${m.name}, ${m.age} (${m.ethnicity})`);
      continue;
    }

    process.stdout.write(`+ ${m.name}, ${m.age} … portrait`);
    const dataUrl = await portraitFor(m);
    const imageUrl = await uploadPortrait(dataUrl, m.name);

    const { data: row, error } = await db
      .from("companions")
      .insert({
        name: m.name,
        age: m.age,
        ethnicity: m.ethnicity,
        gender: "female",
        orientation: "straight",
        art_style: "realistic",
        short_bio: m.short_bio,
        base_personality: m.base_personality,
        image_url: imageUrl,
        sort_order: ++sort,
        tags: ["milf", "mature"],
        language: "en",
        status: "active",
        is_adult: true,
        voice_id: "alloy",
        response_length: "short",
        prompt_version: "1.0",
      })
      .select("id")
      .single();
    if (error || !row) throw error ?? new Error("insert returned no row");
    console.log(` … ✅ ${row.id}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n❌ ${e?.message ?? e}`);
    process.exit(1);
  });
