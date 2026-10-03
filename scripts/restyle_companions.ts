// Re-dress existing companions without changing who they are.
//
//   npx vite-node scripts/restyle_companions.ts -- --dry
//   npx vite-node scripts/restyle_companions.ts
//   npx vite-node scripts/restyle_companions.ts -- --only=Anya
//
// Her CURRENT portrait is passed as the reference, so the face, hair and skin
// stay hers — chat photos and videos lock onto image_url, and a new face would
// make her a different woman from the one users have been talking to. Only the
// outfit changes: skimpy and revealing, never nude.
//
// Her old reel is deleted the moment her photo changes, so her card shows the
// portrait instead of a clip of the old outfit. Remake the reels afterwards:
//   npx vite-node scripts/generate-reels.ts -- --force --only=<names>

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

const PHOTO =
  "Same face, same hair, same skin tone and same body as the reference. Vertical portrait, 85mm DSLR photo, warm natural light, real skin texture with visible pores.";

// One outfit each, all revealing and none nude. Several phrasings per woman:
// grok's moderation rejects some wordings outright, so a refusal falls through
// to the next, tamer one rather than failing the whole run.
const MEN = new Set(["Akira", "Kaito", "Lucas", "Ren", "Ethan"]);

const RESTYLE: Record<string, string[]> = {
  Morticia: [
    "wearing a short black satin mini dress with a plunging neckline and thin spaghetti straps, showing cleavage and long bare legs, sitting on the edge of a bed in a dark gothic bedroom with candles",
    "wearing a short tight black mini dress with a low neckline and thin straps, bare legs, sitting on a bed in a dark gothic bedroom",
  ],
  Rei: [
    "with her long straight silver-grey hair exactly as in the reference, wearing a short silver satin mini dress with a deep plunging neckline and thin straps, bare legs, leaning on a balcony railing at night with city lights behind her",
    "with her long straight silver-grey hair exactly as in the reference, wearing a short fitted silver mini dress with a low neckline and thin straps, bare legs, on a balcony at night with city lights",
  ],
  Daniella: [
    "wearing a short white satin mini dress with a plunging neckline and thin straps, showing cleavage and bare legs, sitting on a bed in a bright bedroom",
    "wearing a short fitted white mini dress with a low neckline and thin straps, bare legs, sitting on a bed in a bright bedroom",
  ],
  Aaliyah: [
    "wearing a short gold satin mini dress with a plunging neckline and thin spaghetti straps, showing cleavage and long bare legs, leaning against a doorway in a warm apartment",
    "wearing a short fitted gold mini dress with a low neckline and thin straps, bare legs, standing in a warm apartment doorway",
  ],
  Elena: [
    "wearing a short sky blue satin mini dress with a plunging neckline and thin straps, showing cleavage and bare legs, sitting on a bed with white sheets in a sunlit bedroom",
    "wearing a short fitted light blue mini dress with a low neckline and thin straps, bare legs, sitting on a bed in a sunlit bedroom",
  ],
  Naomi: [
    "wearing a short emerald green satin mini dress with a plunging neckline and thin straps, showing cleavage and long bare legs, sitting on a bed in a warm bedroom",
    "wearing a short fitted green mini dress with a low neckline and thin straps, bare legs, sitting on a bed in a warm bedroom",
  ],
  Isabella: [
    "wearing a short red satin mini dress with a plunging neckline and thin spaghetti straps, showing cleavage and bare legs, leaning against a kitchen counter in a warm modern kitchen",
    "wearing a short fitted red mini dress with a low neckline and thin straps, bare legs, in a warm modern kitchen",
  ],
  Anya: [
    "wearing a short black bodycon mini dress with a deep plunging neckline and thin straps, showing cleavage and long bare legs, kneeling on a bed with white sheets in a softly lit bedroom",
    "wearing a short fitted black mini dress with a low neckline and thin straps, bare legs, kneeling on a bed in a softly lit bedroom",
  ],

  // The men: five were in shirts, a tank top or a hoodie while Leo and Dante
  // are shirtless, so they match those two — bare chest, fitted shorts.
  Akira: [
    "with his silver-white hair exactly as in the reference, shirtless with a lean toned bare chest and abs, wearing fitted black boxer briefs, sitting on the edge of a bed in a bright bedroom",
    "with his silver-white hair exactly as in the reference, shirtless with a lean toned chest, wearing black athletic shorts, sitting on a bed in a bright bedroom",
  ],
  Kaito: [
    "shirtless with a lean toned bare chest and abs, wearing low-slung grey sweatpants, leaning against a doorway in a dim apartment",
    "shirtless with a toned chest, wearing grey sweatpants, standing in a dim apartment doorway",
  ],
  Lucas: [
    "shirtless with a toned bare chest and abs, wearing fitted navy boxer briefs, sitting on the edge of a bed in a warm bedroom",
    "shirtless with a toned chest, wearing navy athletic shorts, sitting on a bed in a warm bedroom",
  ],
  Ren: [
    "shirtless with a lean toned bare chest and abs, wearing fitted black shorts, sitting on a grey sofa in a cosy living room",
    "shirtless with a toned chest, wearing black shorts, sitting on a sofa in a cosy living room",
  ],
  Ethan: [
    "shirtless with a toned bare chest and abs, wearing fitted grey boxer briefs, sitting on a grey sofa in a warmly lit living room",
    "shirtless with a toned chest, wearing grey athletic shorts, sitting on a sofa in a warmly lit living room",
  ],
};

async function main() {
  const names = Object.keys(RESTYLE).filter((n) => !only || only.includes(n.toLowerCase()));
  const { data, error } = await db
    .from("companions")
    .select("id, name, age, ethnicity, image_url")
    .in("name", names)
    .is("created_by", null);
  if (error) throw error;

  for (const name of names) {
    const c = (data ?? []).find((x) => x.name === name);
    if (!c) {
      console.log(`? ${name} not found, skipping`);
      continue;
    }
    if (dryRun) {
      console.log(`~ ${name}: ${RESTYLE[name][0].slice(0, 70)}…`);
      continue;
    }

    process.stdout.write(`~ ${name} … portrait`);
    let dataUrl: string | null = null;
    let lastErr = "";
    for (const outfit of RESTYLE[name]) {
      for (let attempt = 0; attempt < 2 && !dataUrl; attempt++) {
        try {
          dataUrl = await generateCompanionPortrait(
            `Candid photo of a real attractive ${c.age}-year-old ${c.ethnicity} ${MEN.has(name) ? "man" : "woman"} named ${name}, ${outfit}. ${PHOTO}`,
            { gender: MEN.has(name) ? "male" : "female", noNudity: true, referenceUrl: c.image_url },
          );
        } catch (e: any) {
          lastErr = e?.message ?? String(e);
        }
      }
      if (dataUrl) break;
    }
    if (!dataUrl) {
      console.log(` … ❌ ${lastErr.slice(0, 160)}`);
      continue;
    }

    const buffer = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const path = `companions/model-${name.toLowerCase()}-restyle-${Date.now()}.png`;
    const { error: upErr } = await db.storage
      .from("avatars")
      .upload(path, buffer, { contentType: "image/png", upsert: true });
    if (upErr) throw upErr;
    const imageUrl = db.storage.from("avatars").getPublicUrl(path).data.publicUrl;

    // Old reel first, so there is never a moment where card and reel disagree.
    await db.storage.from("reels").remove([`companion-${c.id}.mp4`]);
    const { error: updErr } = await db.from("companions").update({ image_url: imageUrl }).eq("id", c.id);
    if (updErr) throw updErr;
    console.log(` … ✅ ${imageUrl.split("/").pop()}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n❌ ${e?.message ?? e}`);
    process.exit(1);
  });
