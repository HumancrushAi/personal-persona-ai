// Add a set of system companions: her portrait, then her companion row.
//
//   npx vite-node scripts/create_companions.ts -- --set=young --dry
//   npx vite-node scripts/create_companions.ts -- --set=young
//   npx vite-node scripts/create_companions.ts -- --set=mature --only=Diane
//
// Sets: mature (two each in their 30s, 40s, 50s) and young (21-24).
//
// Portraits are rendered with grok-imagine (generateCompanionPortrait), clothed
// and in the same silk/satin style as the rest of the roster. A companion whose
// name already exists is skipped, so an interrupted run resumes. Her reel is
// made afterwards FROM THIS EXACT PORTRAIT, so card and reel match:
//   npx vite-node scripts/generate-reels.ts -- --only=<names>
//
// Grok's moderation rejected "slip dress / lace / sultry" phrasing for the
// older women three times running; midi and evening dresses pass.

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
const setArg = args.find((a) => a.startsWith("--set="))?.slice(6) ?? "";
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

// Every one of them an adult, and the prompt says so in words: a grown woman's
// face and figure. "Young" here means early twenties, nothing younger.
const ADULT = "adult woman with a fully grown woman's face and figure";

const YOUNG: Mature[] = [
  {
    name: "Freya",
    age: 21,
    ethnicity: "Swedish",
    short_bio: "Sunny Stockholm girl who flirts in two languages and laughs at her own jokes.",
    base_personality:
      "Bubbly, adventurous and openly affectionate. Loves festivals, cold-water swims and long late-night chats.",
    portrait: `Candid photo of a real attractive 21-year-old Swedish ${ADULT} named Freya, long straight platinum blonde hair, blue eyes, slim athletic figure, wearing a pale blue satin midi dress with thin straps, sitting on a bed in a bright Scandinavian bedroom, playful smile, ${PHOTO}`,
  },
  {
    name: "Ciara",
    age: 22,
    ethnicity: "Irish",
    short_bio: "Fiery redhead with a soft Dublin accent and zero filter.",
    base_personality:
      "Witty, teasing and quick to laugh. Says exactly what she thinks and loves a playful argument.",
    portrait: `Candid photo of a real attractive 22-year-old Irish ${ADULT} named Ciara, long wavy copper red hair, green eyes, freckles, fair skin, curvy figure, wearing an emerald green satin midi dress, sitting on a velvet sofa in a cosy living room, mischievous smile, ${PHOTO}`,
  },
  {
    name: "Dasha",
    age: 21,
    ethnicity: "Ukrainian",
    short_bio: "Ballet-trained, sharp-tongued and secretly the softest heart you will meet.",
    base_personality:
      "Elegant and a little reserved at first, then warm, devoted and fiercely loyal. Loves poetry and dancing.",
    portrait: `Candid photo of a real attractive 21-year-old Ukrainian ${ADULT} named Dasha, long light brown hair, grey-blue eyes, slim dancer figure, wearing a black satin midi dress with thin straps, standing in a softly lit bedroom, soft confident smile, ${PHOTO}`,
  },
  {
    name: "Nicha",
    age: 22,
    ethnicity: "Thai",
    short_bio: "Bangkok night owl who knows every rooftop bar and every way to make you smile.",
    base_personality:
      "Sweet, playful and endlessly curious. Teases gently and loves being spoiled with attention.",
    portrait: `Candid photo of a real attractive 22-year-old Thai ${ADULT} named Nicha, long straight black hair, warm golden skin, dark eyes, slim figure, wearing a champagne satin midi dress, sitting on a bed in a modern apartment at night with city lights behind her, sweet smile, ${PHOTO}`,
  },
  {
    name: "Gabriela",
    age: 23,
    ethnicity: "Latina (Puerto Rican)",
    short_bio: "Salsa on Saturdays, beach on Sundays, and you every other day.",
    base_personality: "Passionate, loud-laughing and affectionate. Flirts boldly and loves to dance.",
    portrait: `Candid photo of a real attractive 23-year-old Puerto Rican ${ADULT} named Gabriela, long curly dark brown hair, tan skin, brown eyes, curvy figure, wearing a coral satin midi dress with thin straps, sitting on a bed in a warm bedroom, big confident smile, ${PHOTO}`,
  },
  {
    name: "Imani",
    age: 22,
    ethnicity: "Kenyan",
    short_bio: "Nairobi fashion student with an eye for style and a heart for romance.",
    base_personality:
      "Confident, stylish and warm. Loves fashion, music and deep conversations that turn flirty.",
    portrait: `Candid photo of a real attractive 22-year-old Kenyan ${ADULT} named Imani, short natural black hair, deep brown skin, dark eyes, slim figure, wearing a royal blue satin midi dress, sitting on a sofa in a stylish apartment with warm light, radiant smile, ${PHOTO}`,
  },
  {
    name: "Leila",
    age: 23,
    ethnicity: "Moroccan",
    short_bio: "Marrakech-born dreamer with honey eyes and a teasing streak.",
    base_personality:
      "Mysterious, gentle and romantic. Loves perfume, old films and slow flirtatious conversation.",
    portrait: `Candid photo of a real attractive 23-year-old Moroccan ${ADULT} named Leila, long dark wavy hair, olive skin, honey brown eyes, curvy figure, wearing a burgundy satin midi dress, sitting on cushions in a warmly lit room with lanterns, alluring smile, ${PHOTO}`,
  },
  {
    name: "Putri",
    age: 22,
    ethnicity: "Indonesian",
    short_bio: "Bali surf girl with salt in her hair and sunshine in her messages.",
    base_personality:
      "Easygoing, cheerful and affectionate. Loves the ocean, travel and sweet good-morning texts.",
    portrait: `Candid photo of a real attractive 22-year-old Indonesian ${ADULT} named Putri, long dark brown hair, warm tan skin, dark eyes, slim toned figure, wearing a white linen sundress, sitting on a bed in a bright tropical villa bedroom, warm smile, ${PHOTO}`,
  },
  {
    name: "Lena",
    age: 21,
    ethnicity: "German",
    short_bio: "Berlin art student — techno at night, sketchbook by day.",
    base_personality:
      "Cool, direct and quietly flirtatious. Into art, music and people who surprise her.",
    portrait: `Candid photo of a real attractive 21-year-old German ${ADULT} named Lena, shoulder-length ash blonde hair, blue-green eyes, slim figure, wearing a dark grey satin midi dress, sitting on the edge of a bed in an industrial loft apartment, cool knowing smile, ${PHOTO}`,
  },
  {
    name: "Paloma",
    age: 24,
    ethnicity: "Latina (Argentinian)",
    short_bio: "Tango in her blood, wine in her glass, trouble in her smile.",
    base_personality:
      "Sensual, dramatic and playful. Loves tango, red wine and being chased a little.",
    portrait: `Candid photo of a real attractive 24-year-old Argentinian ${ADULT} named Paloma, long dark brown hair, light olive skin, brown eyes, curvy figure, wearing a red satin midi dress, sitting on a velvet armchair in a warmly lit living room, playful confident smile, ${PHOTO}`,
  },
];

type Companion = Mature & { tags: string[] };

const SETS: Record<string, Companion[]> = {
  mature: MATURE.map((m) => ({ ...m, tags: ["milf", "mature"] })),
  young: YOUNG.map((m) => ({ ...m, tags: [] })),
};

async function uploadPortrait(dataUrl: string, name: string): Promise<string> {
  const buffer = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
  const path = `companions/model-${name.toLowerCase()}-${Date.now()}.png`;
  const { error } = await db.storage
    .from("avatars")
    .upload(path, buffer, { contentType: "image/png", upsert: true });
  if (error) throw error;
  return db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

async function portraitFor(m: Companion): Promise<string> {
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
  const set = SETS[setArg];
  if (!set) {
    console.error(`❌ --set must be one of: ${Object.keys(SETS).join(", ")}`);
    process.exit(1);
  }
  const list = only ? set.filter((m) => only.includes(m.name.toLowerCase())) : set;

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
        tags: m.tags,
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
