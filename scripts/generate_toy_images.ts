// Product photos for the treasure chest, one per toy, rendered with
// grok-imagine (the same model that draws the companion portraits) and
// uploaded to the public avatars bucket as toys/<id>.png.
//
//   npx vite-node scripts/generate_toy_images.ts -- --dry
//   npx vite-node scripts/generate_toy_images.ts -- --only=wand,cuffs
//   npx vite-node scripts/generate_toy_images.ts -- --force
//
// Prints a JSON map of id → url at the end; paste it into toys.ts (`image`).
// Grok moderates explicit shapes, so each toy has a product-shot prompt and a
// softer fallback that reads as an abstract object.

import { readFileSync } from "node:fs";

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
const dry = args.includes("--dry");
const force = args.includes("--force");
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",").map((s) => s.trim().toLowerCase());

const STYLE =
  "studio product photograph on a dark charcoal velvet surface with soft warm rim light and a gentle reflection, centered, single object, no text, no people, photorealistic, 1:1";

const PROMPTS: Record<string, [string, string]> = {
  "dildo-realistic": [
    `A realistic flesh-toned silicone dildo shaped like a real erect penis, with a defined rounded glans, subtle veins, a pair of clearly visible testicle-shaped balls beneath the shaft, and a flat suction cup base, standing upright, ${STYLE}`,
    `A realistic flesh-toned silicone dildo with a rounded head, subtle shaft veins, two distinct attached balls beneath the shaft, and a round suction base, standing upright, ${STYLE}`,
  ],
  "dildo-black": [
    `A large thick matte black silicone dildo with a wide flared base, standing upright, ${STYLE}`,
    `A large matte black silicone massager with a rounded tip and a wide flared base, standing upright, ${STYLE}`,
  ],
  "dildo-glass": [
    `A clear glass dildo with rounded ridges along the shaft, lying on velvet, ${STYLE}`,
    `An elegant clear borosilicate glass wand with rounded ridges, lying on velvet, ${STYLE}`,
  ],
  "rabbit-tongue": [
    `A glossy hot-pink rabbit vibrator with a curved shaft and a small silicone tongue stimulator at the base, ${STYLE}`,
    `A glossy hot-pink silicone massager with a curved shaft and a small second arm, ${STYLE}`,
  ],
  wand: [
    `A white magic wand massager with a large round soft head and a black cord, ${STYLE}`,
    `A white personal massager with a large round soft head and a black cord, ${STYLE}`,
  ],
  bullet: [
    `A small glossy pink bullet vibrator with a thin cord and a small pink remote, ${STYLE}`,
    `A small glossy pink metal bullet-shaped massager with a thin cord, ${STYLE}`,
  ],
  "plug-jewel": [
    `A polished steel butt plug with a large faceted pink crystal in its base, ${STYLE}`,
    `A polished mirror-steel teardrop ornament with a large faceted pink crystal in its round base, ${STYLE}`,
  ],
  beads: [
    `Black silicone anal beads, six beads growing in size on one string with a ring handle, ${STYLE}`,
    `A string of six matte black silicone beads growing in size with a ring handle at the end, ${STYLE}`,
  ],
  "strap-on": [
    `A black leather strap-on harness with silver buckles and a matte black silicone dildo, ${STYLE}`,
    `A black leather harness with silver buckles and straps, neatly arranged, ${STYLE}`,
  ],
  stroker: [
    `A matte black flashlight-shaped male stroker sleeve with a soft pink silicone opening at one end, ${STYLE}`,
    `A matte black cylindrical case the size of a large flashlight with a soft pink silicone cap, ${STYLE}`,
  ],
  flogger: [
    `A black leather flogger with a braided handle and many soft leather tails, ${STYLE}`,
    `A black leather flogger with a braided handle and soft leather tails, ${STYLE}`,
  ],
  crop: [`A slim black leather riding crop with a leather keeper at the tip, ${STYLE}`, `A slim black leather riding crop, ${STYLE}`],
  paddle: [`A black leather spanking paddle with a heart-shaped cut-out, ${STYLE}`, `A black leather paddle with a heart-shaped cut-out and a wrapped handle, ${STYLE}`],
  cuffs: [`Polished silver steel handcuffs joined by a short heavy chain, ${STYLE}`, `Polished silver steel handcuffs with a chain, ${STYLE}`],
  clamps: [`Two small adjustable silver nipple clamps with black rubber tips joined by a fine silver chain, ${STYLE}`, `Two small silver adjustable clips with black rubber tips joined by a fine silver chain, ${STYLE}`],
  collar: [`A wide black leather collar with silver studs and a D-ring, with a black leather leash clipped to it, ${STYLE}`, `A wide black leather studded collar with a silver ring and a leather leash, ${STYLE}`],
  gag: [`A red ball gag: a glossy red rubber ball on a black leather strap with a silver buckle, ${STYLE}`, `A glossy red rubber ball on a black leather strap with a silver buckle, ${STYLE}`],
  rope: [`A coil of soft red cotton shibari rope with twisted strands, ${STYLE}`, `A neat coil of soft red cotton rope with visible twisted strands, ${STYLE}`],
  blindfold: [`A smooth black satin blindfold with ties, ${STYLE}`, `A smooth black satin sleep mask with ties, ${STYLE}`],
  room: [
    `A cozy modern bedroom at night, an unmade bed with grey linen under a warm bedside lamp, a phone propped on the nightstand, ${STYLE.replace("single object, ", "")}`,
    `A cozy modern bedroom at night with warm lamplight and grey bed linen, photorealistic, no people, 1:1`,
  ],
};

async function main() {
  const { generateCompanionPortrait } = await import("../src/lib/portrait.server");
  const { supabaseAdmin } = await import("../src/integrations/supabase/client.server");
  const out: Record<string, string> = {};
  for (const [id, [prompt, fallback]] of Object.entries(PROMPTS)) {
    if (only && !only.includes(id)) continue;
    const path = `toys/${id}.png`;
    if (!force) {
      const { data } = await supabaseAdmin.storage.from("avatars").list("toys", { search: `${id}.png` });
      if (data?.some((f) => f.name === `${id}.png`)) {
        out[id] = supabaseAdmin.storage.from("avatars").getPublicUrl(path).data.publicUrl;
        console.log(`= ${id} exists`);
        continue;
      }
    }
    if (dry) {
      console.log(`+ ${id}: ${prompt.slice(0, 70)}…`);
      continue;
    }
    let dataUrl: string | null = null;
    for (const p of [prompt, fallback]) {
      try {
        dataUrl = await generateCompanionPortrait(p, { noNudity: true, aspectRatio: "1:1" });
        break;
      } catch (e) {
        console.log(`   ${id}: ${(e as Error).message.slice(0, 90)}`);
      }
    }
    if (!dataUrl) {
      console.log(`✗ ${id}: no image`);
      continue;
    }
    const buffer = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const { error } = await supabaseAdmin.storage
      .from("avatars")
      .upload(path, buffer, { contentType: "image/png", upsert: true });
    if (error) {
      console.log(`✗ ${id}: upload ${error.message}`);
      continue;
    }
    out[id] = supabaseAdmin.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    console.log(`✓ ${id}`);
  }
  console.log("\nIMAGES_JSON " + JSON.stringify(out));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
