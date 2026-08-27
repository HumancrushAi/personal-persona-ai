// Build the off-platform promo set: static banners for Facebook/Instagram feed,
// square posts and Reels/Stories covers.
//
// These run on mainstream ad networks, so the rules are the opposite of the
// site's own art direction: fully clothed, no lingerie, no suggestive posing,
// nothing that reads as adult content. Meta rejects sexualised creative outright
// and repeated rejections put the whole ad account at risk. The pull has to come
// from the copy and the warmth of the shot, not from skin.
//
//   npx vite-node scripts/generate-social-banners.ts -- --dry
//   npx vite-node scripts/generate-social-banners.ts -- --photos-only
//   npx vite-node scripts/generate-social-banners.ts -- --force
//
// Source photos land in marketing/source/ and the finished banners in
// marketing/. Photos are reused unless --force, so re-running only recomposites
// the artwork — which is the cheap half.

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
const photosOnly = args.includes("--photos-only");

const SRC_DIR = "marketing/source";
const OUT_DIR = "marketing";
mkdirSync(SRC_DIR, { recursive: true });

/* ---------------- Source photography ---------------- */

const SAFE_LOOK =
  "natural candid lifestyle photography, photorealistic, soft warm light, shallow depth of field, 85mm lens, fully clothed, modest, tasteful, no cleavage";

const SOURCES: { id: string; prompt: string }[] = [
  {
    id: "sofa",
    prompt: `Portrait photograph of a beautiful smiling young woman with long dark hair, wearing an oversized cream knit sweater, curled up on a sofa at home holding her phone and smiling at the camera, warm evening lamp light, cosy modern apartment. ${SAFE_LOOK}`,
  },
  {
    id: "street",
    prompt: `Portrait photograph of a beautiful laughing young woman with wavy blonde hair, wearing a denim jacket over a plain white t-shirt, standing on a city street at golden hour looking at the camera. ${SAFE_LOOK}`,
  },
  {
    id: "window",
    prompt: `Portrait photograph of a beautiful young woman with curly hair, wearing a soft beige cardigan, sitting by a bright window holding a mug of coffee and smiling warmly at the camera, soft daylight. ${SAFE_LOOK}`,
  },
];

// FLUX on Replicate rather than the site's own image path: this is the one set
// of images that must NOT look like the product, and a general model shooting a
// clothed lifestyle frame is exactly right for it. It also renders the aspect
// ratio natively, so the landscape banner is a real wide shot instead of a
// letterbox sliced out of a portrait.
async function generatePhoto(
  prompt: string,
  ratio: "9:16" | "16:9",
  label: string,
): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN missing from .env.local");

  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(
        "https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            // Blocks until the prediction finishes, so there is no poll loop.
            Prefer: "wait",
          },
          body: JSON.stringify({
            input: { prompt, aspect_ratio: ratio, output_format: "jpg", safety_tolerance: 2 },
          }),
          signal: AbortSignal.timeout(120_000),
        },
      );
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);

      const json = await res.json();
      const url = typeof json.output === "string" ? json.output : json.output?.[0];
      if (!url) throw new Error(`no image (status ${json.status}) ${json.error ?? ""}`.trim());

      const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!img.ok) throw new Error(`could not fetch generated image (${img.status})`);
      return Buffer.from(await img.arrayBuffer());
    } catch (e) {
      lastErr = e;
      console.log(
        `   ${label}: ${((e as Error)?.message ?? e).toString().slice(0, 90)} — retry ${i + 1}/3`,
      );
      await new Promise((r) => setTimeout(r, 8000 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ---------------- Brand kit ---------------- */

const INK = "#08060c";
const PINK = "#ff3d8b";
const ROSE = "#ff7ab0";

// Fraunces and Inter are webfonts the site loads at runtime; a compositor has
// only what is installed locally. Georgia Bold carries the same high-contrast
// serif weight as Fraunces, and Segoe UI stands in for Inter.
const SERIF = "Georgia";
const SANS = "Segoe UI";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Guessing a font size from character counts put "Your companion." through the
// right edge of the frame and cut "No card needed." off the sub. Render the
// string once at a reference size, trim to the glyph box, and scale from the
// width that comes back — the only way to be sure it fits is to measure it.
async function fitSize(
  text: string,
  family: string,
  weight: string,
  maxSize: number,
  maxWidth: number,
): Promise<number> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="200">
    <text x="10" y="100" font-family="${family}" font-weight="${weight}" font-size="100" fill="#ffffff">${esc(text)}</text></svg>`;
  const { info } = await sharp(Buffer.from(svg))
    .trim({ threshold: 1 })
    .toBuffer({ resolveWithObject: true });
  if (!info.width) return maxSize;
  return Math.min(maxSize, Math.floor((100 * maxWidth) / info.width));
}

// One size for both headline lines, so the pair still reads as one block.
async function headlineSize(lines: string[], maxSize: number, maxWidth: number): Promise<number> {
  const sizes = await Promise.all(lines.map((l) => fitSize(l, SERIF, "bold", maxSize, maxWidth)));
  return Math.min(...sizes);
}

type Concept = {
  id: string;
  source: string;
  headline: string[];
  sub: string;
  // The landscape banner only has the dark left panel to work with, so it gets
  // its own shorter line — the full one ran onto the lit half of the photo and
  // stopped being readable.
  subShort: string;
  kicker: string;
};

const CONCEPTS: Concept[] = [
  {
    id: "build-her",
    source: "sofa",
    headline: ["Make your own", "AI companion"],
    sub: "Design her look, her voice, her personality — in under a minute.",
    subShort: "Her look, her voice, her personality.",
    kicker: "Start free",
  },
  {
    id: "texts-first",
    source: "street",
    headline: ["She texts", "you first."],
    sub: "An AI companion who remembers you and picks the conversation back up.",
    subShort: "She remembers you.",
    kicker: "25 free messages",
  },
  {
    id: "your-rules",
    source: "window",
    headline: ["Your companion.", "Your rules."],
    sub: "Build her from scratch, then talk about anything. No card needed.",
    subShort: "Build her in 60 seconds.",
    kicker: "Try it free",
  },
];

// A wordmark, drawn rather than set, so it renders identically wherever this
// script runs and doesn't depend on the site's webfont being installed.
function wordmark(x: number, y: number, scale = 1): string {
  const s = (n: number) => n * scale;
  return `
    <g transform="translate(${x} ${y})">
      <path transform="scale(${scale})" d="M14 25 C4 17 0 11 0 7 C0 3 3 0 7 0 C10 0 12 1.5 14 4 C16 1.5 18 0 21 0 C25 0 28 3 28 7 C28 11 24 17 14 25 Z" fill="${PINK}"/>
      <text x="${s(38)}" y="${s(21)}" font-family="${SANS}" font-weight="bold" font-size="${s(27)}" fill="#ffffff">HumanCrush<tspan fill="${ROSE}">.com</tspan></text>
    </g>`;
}

function ctaPill(
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  fontSize: number,
): string {
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="url(#cta)"/>
      <text x="${x + w / 2}" y="${y + h / 2 + fontSize * 0.36}" text-anchor="middle"
            font-family="${SANS}" font-weight="bold" font-size="${fontSize}"
            letter-spacing="1.5" fill="#ffffff">${esc(label)}</text>
    </g>`;
}

function defs(): string {
  return `
    <defs>
      <linearGradient id="cta" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${PINK}"/>
        <stop offset="1" stop-color="#ff6a4d"/>
      </linearGradient>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${INK}" stop-opacity="0"/>
        <stop offset="0.45" stop-color="${INK}" stop-opacity="0.85"/>
        <stop offset="1" stop-color="${INK}" stop-opacity="0.99"/>
      </linearGradient>
      <linearGradient id="sideScrim" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${INK}" stop-opacity="0.99"/>
        <stop offset="0.72" stop-color="${INK}" stop-opacity="0.92"/>
        <stop offset="1" stop-color="${INK}" stop-opacity="0"/>
      </linearGradient>
    </defs>`;
}

/* ---------------- Formats ---------------- */

// Reels and Stories put their own chrome over the frame: roughly the top 250px
// and the bottom 420px of a 1080x1920 are covered by the caption, the author row
// and the action rail. Every word here sits between those two bands.
async function reelSvg(c: Concept): Promise<string> {
  const top = 980;
  const hs = await headlineSize(c.headline, 118, 936);
  const sub = c.sub.split("—")[0].trim();
  const ss = await fitSize(sub, SANS, "normal", 40, 936);
  return `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    <rect x="0" y="${top - 260}" width="1080" height="${1920 - top + 260}" fill="url(#scrim)"/>
    ${wordmark(72, 300, 1.25)}
    <text x="72" y="${top + 130}" font-family="${SERIF}" font-weight="bold" font-size="${hs}" fill="#ffffff">${esc(c.headline[0])}</text>
    <text x="72" y="${top + 130 + hs * 1.12}" font-family="${SERIF}" font-weight="bold" font-size="${hs}" fill="${ROSE}">${esc(c.headline[1])}</text>
    <text x="72" y="${top + 130 + hs * 1.12 + 94}" font-family="${SANS}" font-size="${ss}" fill="#e9dfe6">${esc(sub)}</text>
    ${ctaPill(72, top + 130 + hs * 1.12 + 148, 560, 108, c.kicker.toUpperCase(), 36)}
  </svg>`;
}

async function squareSvg(c: Concept): Promise<string> {
  const top = 560;
  const hs = await headlineSize(c.headline, 92, 952);
  const sub = c.sub.split("—")[0].trim();
  const ss = await fitSize(sub, SANS, "normal", 34, 952);
  return `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    <rect x="0" y="${top - 200}" width="1080" height="${1080 - top + 200}" fill="url(#scrim)"/>
    ${wordmark(64, 72, 1)}
    <text x="64" y="${top + 100}" font-family="${SERIF}" font-weight="bold" font-size="${hs}" fill="#ffffff">${esc(c.headline[0])}</text>
    <text x="64" y="${top + 100 + hs * 1.11}" font-family="${SERIF}" font-weight="bold" font-size="${hs}" fill="${ROSE}">${esc(c.headline[1])}</text>
    <text x="64" y="${top + 100 + hs * 1.11 + 80}" font-family="${SANS}" font-size="${ss}" fill="#e9dfe6">${esc(sub)}</text>
    ${ctaPill(64, top + 100 + hs * 1.11 + 124, 470, 92, c.kicker.toUpperCase(), 31)}
  </svg>`;
}

// Landscape puts the subject on the right and the message on a solid panel to
// the left, because a bottom scrim on a 630px-tall frame leaves no room to read.
// Everything is measured against the panel, not the frame.
async function feedSvg(c: Concept): Promise<string> {
  const PANEL = 620;
  const hs = await headlineSize(c.headline, 76, PANEL);
  const ss = await fitSize(c.subShort, SANS, "normal", 30, PANEL);
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    <rect x="0" y="0" width="780" height="630" fill="url(#sideScrim)"/>
    ${wordmark(64, 62, 0.95)}
    <text x="64" y="270" font-family="${SERIF}" font-weight="bold" font-size="${hs}" fill="#ffffff">${esc(c.headline[0])}</text>
    <text x="64" y="${270 + hs * 1.13}" font-family="${SERIF}" font-weight="bold" font-size="${hs}" fill="${ROSE}">${esc(c.headline[1])}</text>
    <text x="64" y="${270 + hs * 1.13 + 68}" font-family="${SANS}" font-size="${ss}" fill="#e9dfe6">${esc(c.subShort)}</text>
    ${ctaPill(64, 270 + hs * 1.13 + 112, 420, 84, c.kicker.toUpperCase(), 28)}
  </svg>`;
}

const FORMATS = [
  { id: "reel-1080x1920", w: 1080, h: 1920, pos: "top", plate: "portrait", svg: reelSvg },
  { id: "square-1080x1080", w: 1080, h: 1080, pos: "top", plate: "portrait", svg: squareSvg },
  // Landscape crops to the right so the subject lands clear of the text panel.
  { id: "feed-1200x630", w: 1200, h: 630, pos: "right top", plate: "landscape", svg: feedSvg },
] as const;

/* ---------------- Run ---------------- */

async function main() {
  if (dryRun) {
    for (const c of CONCEPTS)
      for (const f of FORMATS) console.log(`${c.id}-${f.id}.jpg   "${c.headline.join(" ")}"`);
    return;
  }

  // Photos first: every banner is a crop of one, so a missing photo costs the
  // whole concept rather than one file.
  const plates = [
    { suffix: "", ratio: "9:16" as const },
    { suffix: "-wide", ratio: "16:9" as const },
  ];
  for (const s of SOURCES) {
    for (const p of plates) {
      const path = `${SRC_DIR}/${s.id}${p.suffix}.jpg`;
      if (existsSync(path) && !force) {
        console.log(`⏭  ${s.id}${p.suffix} (already shot)`);
        continue;
      }
      try {
        const raw = await generatePhoto(s.prompt, p.ratio, s.id + p.suffix);
        writeFileSync(path, await sharp(raw).jpeg({ quality: 92 }).toBuffer());
        console.log(`📸 ${s.id}${p.suffix}`);
      } catch (e) {
        console.log(`❌ ${s.id}${p.suffix}: ${(e as Error)?.message ?? e}`);
      }
    }
  }
  if (photosOnly) return;

  let made = 0;
  for (const c of CONCEPTS) {
    for (const f of FORMATS) {
      const path = `${SRC_DIR}/${c.source}${f.plate === "landscape" ? "-wide" : ""}.jpg`;
      if (!existsSync(path)) {
        console.log(`⏭  ${c.id}-${f.id}: no ${path}`);
        continue;
      }
      const base = await sharp(readFileSync(path))
        .resize(f.w, f.h, { fit: "cover", position: f.pos })
        .toBuffer();
      const out = `${OUT_DIR}/${c.id}-${f.id}.jpg`;
      await sharp(base)
        .composite([{ input: Buffer.from(await f.svg(c)), top: 0, left: 0 }])
        .jpeg({ quality: 90, mozjpeg: true })
        .toFile(out);
      made++;
      console.log(`✅ ${out}`);
    }
  }
  console.log(`\n${made} banner(s) written to ${OUT_DIR}/`);
}

// vite-node's dev harness keeps the event loop alive, so exit explicitly.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
