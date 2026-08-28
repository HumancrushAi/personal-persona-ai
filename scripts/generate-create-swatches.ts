// Regenerate the /create wizard's option swatches.
//
// The wizard used to mix cartoon SVG hair, emoji mood tiles and catalogue stock
// photos of women in sweaters and one-piece swimsuits. Next to candy.ai's
// picker — real lingerie photography, one consistent studio look — it read as a
// different (and cheaper) product. Every option now gets a real photo shot on
// the same charcoal seamless backdrop with the same rim light, so the grid reads
// as one set instead of a scrapbook.
//
//   npx vite-node scripts/generate-create-swatches.ts -- --dry
//   npx vite-node scripts/generate-create-swatches.ts -- --only=hair-silver
//   npx vite-node scripts/generate-create-swatches.ts -- --force
//
// Images land in src/assets/create/ and are committed — /create must not depend
// on a live image API at render time. Existing files are skipped unless --force,
// so an interrupted run resumes.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import sharp from "sharp";

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
const force = args.includes("--force");
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg
  ? onlyArg
      .slice(7)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  : null;

const key = process.env.REPLICATE_API_TOKEN;
if (!key) {
  console.error("❌ REPLICATE_API_TOKEN missing from .env.local");
  process.exit(1);
}

const OUT_DIR = "src/assets/create";
mkdirSync(OUT_DIR, { recursive: true });

// One backdrop and one light for every swatch. Without this the picker turns
// into a collage of unrelated photos and the comparison between options — which
// is the whole point of the step — stops working.
const LOOK =
  "professional fashion editorial photograph, dark charcoal seamless studio backdrop, soft key light with warm rim light, subtle film grain, photorealistic skin texture, 85mm lens, sharp focus";

type Swatch = { file: string; prompt: string; crop: "tall" | "square" };

const fullBody = (subject: string): Swatch["prompt"] =>
  `Full length vertical photograph from head to toe of ${subject}. ${LOOK}, full body in frame, standing, confident relaxed pose, looking at camera`;

const BODIES: Swatch[] = [
  [
    "body-slim",
    "a beautiful slim slender young woman with long lean limbs and a narrow waist, wearing a delicate black lace bra and matching briefs",
  ],
  [
    "body-athletic",
    "a beautiful athletic young woman with a toned defined stomach and strong shoulders, wearing a black lace bra and matching briefs",
  ],
  [
    "body-curvy",
    "a beautiful curvy hourglass young woman with full bust, small waist and wide hips, wearing a black lace bra and matching briefs",
  ],
  [
    "body-petite",
    "a beautiful petite young woman with a small delicate frame and short stature, wearing a black lace bra and matching briefs",
  ],
  [
    "body-tall",
    "a beautiful very tall statuesque young woman with extremely long legs, wearing a black lace bra and matching briefs",
  ],
  [
    "body-thick",
    "a beautiful thick voluptuous plus size young woman with full soft thighs and generous curves, wearing a black lace bra and matching briefs",
  ],
  [
    "body-muscular",
    "a handsome muscular young man with a sculpted chest, defined six pack abs and broad shoulders, shirtless wearing fitted black boxer briefs",
  ],
].map(([file, subject]) => ({ file, prompt: fullBody(subject), crop: "tall" as const }));

// Four options that look the same are four options nobody can choose between.
// The first pass described these as A/B/D/DD and the model rendered them nearly
// identically — so the wording is now exaggerated at both ends and anchored to
// how the garment fits, which is what actually reads at thumbnail size.
const BREASTS: Swatch[] = [
  [
    "breast-small",
    "very small flat A-cup breasts, minimal bust, slim narrow chest, the bra cups sitting almost flat against her, no cleavage at all",
  ],
  [
    "breast-medium",
    "average natural B-cup breasts, modest bust filling the cups neatly, only a hint of cleavage",
  ],
  [
    "breast-large",
    "large full D-cup breasts, heavy rounded bust filling the cups completely, clear deep cleavage",
  ],
  [
    "breast-busty",
    "enormous DDD-cup breasts, extremely large heavy bust overflowing the cups, dramatic very deep cleavage, the bra straps pulled taut",
  ],
].map(([file, bust]) => ({
  file,
  prompt: `Vertical photograph of a beautiful young woman from mid thigh to the top of her head, wearing a black lace balconette bra and matching briefs, ${bust}, hands relaxed at her sides. ${LOOK}, torso centred in frame`,
  crop: "tall" as const,
}));

// Shot from BEHIND. These were previously side profiles, and then fell back to
// the front-facing body photos entirely, so the one step in the wizard that asks
// about her backside was illustrated with her front. xAI refuses rear-view
// briefs prompts outright; FLUX on Replicate renders them, which is the reason
// this script moved providers.
const BUTTS: Swatch[] = [
  ["butt-small", "a small slim narrow bottom and narrow hips"],
  ["butt-medium", "an athletic firm toned rounded bottom"],
  ["butt-large", "a large full curvy rounded bottom and wide hips"],
  ["butt-big", "an enormous voluptuous rounded bottom and dramatically wide hips"],
].map(([file, shape]) => ({
  file,
  prompt: `Rear view photograph of a beautiful young woman standing with her back to the camera, photographed from behind, ${shape}, wearing a black lace bra and matching high-cut lace briefs, glancing back over her shoulder at the camera. ${LOOK}, framed from mid-thigh to the top of her head, her back and bottom fill the frame`,
  crop: "tall" as const,
}));

const OUTFITS: Swatch[] = [
  ["outfit-crop", "a tiny cropped tank top and low rise jeans showing a bare toned midriff"],
  [
    "outfit-black-dress",
    "a skin tight short black bodycon mini dress with thin straps and strappy heels",
  ],
  [
    "outfit-sundress",
    "a short floral summer sundress with thin spaghetti straps and a low neckline",
  ],
  ["outfit-workout", "a tiny black sports bra and matching high waist gym shorts, toned stomach"],
  ["outfit-hoodie", "an oversized cream hoodie worn with bare legs and white thigh high socks"],
  ["outfit-silk", "an unbuttoned oversized silk blouse worn open over a matching lace bra"],
  ["outfit-streetwear", "a cropped white tee and baggy cargo pants slung low on the hips"],
  [
    "outfit-gown",
    "a floor length satin evening gown with a deep plunging neckline and a high leg slit",
  ],
].map(([file, outfit]) => ({
  file,
  prompt: fullBody(`a beautiful young woman wearing ${outfit}`),
  crop: "tall" as const,
}));

const HAIRS: Swatch[] = [
  ["hair-long-black", "very long straight glossy jet black hair falling past her shoulders"],
  ["hair-long-blonde", "very long golden blonde hair falling past her shoulders"],
  ["hair-long-brunette", "very long rich chocolate brown hair falling past her shoulders"],
  ["hair-short-pixie", "a short cropped dark pixie cut"],
  ["hair-bob", "a sharp chin length brown bob cut"],
  ["hair-wavy-red", "long wavy copper red hair"],
  ["hair-pink", "long dyed candy pink hair"],
  ["hair-curly-afro", "a big natural black curly afro"],
  ["hair-silver", "long platinum silver hair"],
].map(([file, hair]) => ({
  file,
  prompt: `Beauty portrait photograph of a beautiful young woman with ${hair}, bare shoulders with black bra straps visible, head and shoulders framing, looking straight at the camera. ${LOOK}`,
  crop: "square" as const,
}));

const EYES: Swatch[] = [
  ["eye-brown", "warm deep brown"],
  ["eye-hazel", "golden hazel"],
  ["eye-green", "vivid emerald green"],
  ["eye-blue", "bright ice blue"],
  ["eye-grey", "pale storm grey"],
  ["eye-amber", "glowing amber"],
].map(([file, color]) => ({
  file,
  prompt: `Extreme macro beauty photograph of one ${color} human eye of a beautiful young woman, detailed iris texture, long dark lashes, soft catchlight. ${LOOK}`,
  crop: "square" as const,
}));

const VIBES: Swatch[] = [
  [
    "vibe-sweet",
    "shy and sweet, biting her lip and glancing away, soft blush",
    "wearing a soft pink lace bralette",
  ],
  [
    "vibe-flirty",
    "confident and flirty, smirking with direct eye contact",
    "wearing a red lace bra",
  ],
  [
    "vibe-dominant",
    "dominant and commanding, chin raised, cold stare",
    "wearing a black latex bralette and choker",
  ],
  [
    "vibe-submissive",
    "soft and submissive, looking up shyly through her lashes",
    "wearing a white lace bralette and ribbon choker",
  ],
  ["vibe-brat", "playful and bratty, tongue out and winking", "wearing a purple lace bralette"],
  [
    "vibe-romantic",
    "warm and romantic, tender smile, dreamy expression",
    "wearing a blush satin slip",
  ],
  [
    "vibe-mysterious",
    "mysterious and unreadable, half in shadow",
    "wearing a dark navy lace bralette",
  ],
  [
    "vibe-goth",
    "goth, dark lipstick and heavy eyeliner, pale skin",
    "wearing a black lace bralette and silver chains",
  ],
  [
    "vibe-girl-next-door",
    "warm and approachable girl next door, bright natural laughing smile",
    "wearing a simple white cotton bralette",
  ],
].map(([file, mood, outfit]) => ({
  file,
  prompt: `Portrait photograph from the waist up of a beautiful young woman who looks ${mood}, ${outfit}. ${LOOK}`,
  crop: "square" as const,
}));

const ALL: Swatch[] = [...BODIES, ...BREASTS, ...BUTTS, ...OUTFITS, ...HAIRS, ...EYES, ...VIBES];

// FLUX on Replicate, not xAI. Grok Imagine refuses every rear-view lingerie
// prompt with `imagine:content-moderated` — which is why the butt swatches did
// not exist for two rounds — and it hangs sockets open for ~95s before saying
// so. FLUX renders them, honours the aspect ratio natively, and answers in a
// few seconds.
async function attempt(s: Swatch): Promise<Buffer> {
  const res = await fetch(
    "https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // Blocks until the prediction finishes, so there is no poll loop.
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt: s.prompt,
          aspect_ratio: s.crop === "tall" ? "2:3" : "1:1",
          output_format: "jpg",
          safety_tolerance: 5,
        },
      }),
      signal: AbortSignal.timeout(150_000),
    },
  );
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  const url = typeof json.output === "string" ? json.output : json.output?.[0];
  if (!url) throw new Error(`no image (status ${json.status}) ${json.error ?? ""}`.trim());
  const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!img.ok) throw new Error(`could not fetch generated image (${img.status})`);
  return Buffer.from(await img.arrayBuffer());
}

async function generate(s: Swatch): Promise<Buffer> {
  let lastErr: any;
  for (let i = 0; i < 3; i++) {
    try {
      return await attempt(s);
    } catch (e: any) {
      lastErr = e;
      console.log(`   ${s.file}: ${(e?.message ?? e).toString().slice(0, 90)} — retry ${i + 1}/3`);
      if (i < 2) await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
    }
  }
  throw lastErr;
}

// The picker renders these at ~200px wide, so shipping the raw 720x1280 would
// put ~30MB of unused pixels in the bundle for a page every new user lands on.
async function encode(raw: Buffer, crop: Swatch["crop"]): Promise<Buffer> {
  const [w, h] = crop === "tall" ? [448, 672] : [448, 448];
  return sharp(raw)
    .resize(w, h, { fit: "cover", position: "top" })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}

async function main() {
  let rows = ALL;
  if (only) rows = rows.filter((s) => only.includes(s.file.toLowerCase()));
  if (!force) rows = rows.filter((s) => !existsSync(`${OUT_DIR}/${s.file}.jpg`));

  console.log(`${rows.length} swatch(es) to generate${dryRun ? "  [DRY RUN]" : ""}\n`);
  if (dryRun) {
    for (const s of rows) console.log(`${s.file.padEnd(22)} ${s.prompt.slice(0, 110)}…`);
    return;
  }

  const failures: string[] = [];
  let done = 0;

  // Three at a time: the endpoint takes ~15s per image, and running the whole
  // set sequentially made a resumable run pointless.
  const queue = [...rows];
  const workers = Array.from({ length: 3 }, async () => {
    for (;;) {
      const s = queue.shift();
      if (!s) return;
      try {
        const raw = await generate(s);
        writeFileSync(`${OUT_DIR}/${s.file}.jpg`, await encode(raw, s.crop));
        done++;
        console.log(`✅ ${String(done).padStart(2)}/${rows.length} ${s.file}`);
      } catch (e: any) {
        failures.push(`${s.file}: ${e.message ?? e}`);
        console.log(`❌ ${s.file}: ${e.message ?? e}`);
      }
    }
  });
  await Promise.all(workers);

  console.log(`\n${done} written, ${failures.length} failed`);
  for (const f of failures) console.log(`   ${f}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
