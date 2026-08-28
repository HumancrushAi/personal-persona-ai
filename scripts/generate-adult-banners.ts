// Ad creative for adult networks — PornHub/TrafficJunky, xHamster, ExoClick.
//
// The opposite brief to generate-social-banners.ts, and a separate script for
// exactly that reason: these are lingerie and suggestive, and mixing the two
// sets risks a mainstream network being handed creative that gets the ad
// account banned. Nothing here is safe for Facebook. Nothing there works here.
//
//   npx vite-node scripts/generate-adult-banners.ts -- --dry
//   npx vite-node scripts/generate-adult-banners.ts -- --photos-only
//   npx vite-node scripts/generate-adult-banners.ts -- --force
//
// Source photos land in marketing/adult/source/ and the finished banners in
// marketing/adult/. Photos are reused unless --force, so re-running only
// recomposites — which is the free half.

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

const TOKEN = process.env.REPLICATE_API_TOKEN;
const SRC_DIR = "marketing/adult/source";
const OUT_DIR = "marketing/adult";
mkdirSync(SRC_DIR, { recursive: true });

/* ---------------- Source photography ---------------- */

// Lingerie, not nudity. Every one of these networks rejects exposed genitals and
// most reject bare nipples in banner creative even though the site around the ad
// is explicit — the ad unit itself is held to a stricter line than the content.
// Lingerie also crops far better at 300x100.
const LOOK =
  "photorealistic, candid raw photograph, warm cinematic lighting, authentic skin texture with visible pores, natural asymmetry, shallow depth of field, shot on 85mm f/1.4, no airbrushing, no CGI";

const SOURCES: { id: string; prompt: string; ratio: "2:3" | "1:1" | "16:9" }[] = [
  {
    id: "bed",
    prompt: `Photograph of a beautiful young woman with long dark hair kneeling on an unmade bed, wearing a black lace bra and matching briefs, one strap slipping off her shoulder, biting her lip and looking straight at the camera, low warm bedside lamplight, dark bedroom. ${LOOK}`,
    ratio: "2:3",
  },
  {
    id: "phone",
    prompt: `Photograph of a beautiful young blonde woman lying back on a couch holding her phone up above her face, wearing a red lace bralette, smirking at the camera, soft evening light, dark living room. ${LOOK}`,
    ratio: "1:1",
  },
  {
    id: "wide",
    prompt: `Wide photograph of a beautiful young woman reclining across dark silk sheets, wearing a sheer black slip, looking directly at the camera with a seductive expression, moody low-key lighting from one side, plenty of dark empty space on the left of the frame. ${LOOK}`,
    ratio: "16:9",
  },
];

async function generatePhoto(prompt: string, ratio: string, label: string): Promise<Buffer> {
  if (!TOKEN) throw new Error("REPLICATE_API_TOKEN missing from .env.local");
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(
        "https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
            Prefer: "wait",
          },
          body: JSON.stringify({
            input: { prompt, aspect_ratio: ratio, output_format: "jpg", safety_tolerance: 5 },
          }),
          signal: AbortSignal.timeout(150_000),
        },
      );
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      const url = typeof json.output === "string" ? json.output : json.output?.[0];
      if (!url) throw new Error(`no image (status ${json.status}) ${json.error ?? ""}`.trim());
      const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!img.ok) throw new Error(`could not fetch image (${img.status})`);
      return Buffer.from(await img.arrayBuffer());
    } catch (e) {
      lastErr = e;
      console.log(
        `   ${label}: ${((e as Error)?.message ?? e).toString().slice(0, 80)} — retry ${i + 1}/3`,
      );
      await new Promise((r) => setTimeout(r, 6000 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ---------------- Brand kit ---------------- */

const INK = "#08060c";
const PINK = "#ff3d8b";
const ROSE = "#ff7ab0";
const SERIF = "Georgia";
const SANS = "Segoe UI";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Ad units are tiny and the copy has to fit exactly, so the size is measured
// rather than guessed: render once at a reference size, trim to the glyph box,
// scale from the width that comes back.
async function fitSize(
  text: string,
  family: string,
  weight: string,
  maxSize: number,
  maxWidth: number,
): Promise<number> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="200">
    <text x="10" y="100" font-family="${family}" font-weight="${weight}" font-size="100" fill="#fff">${esc(text)}</text></svg>`;
  const { info } = await sharp(Buffer.from(svg))
    .trim({ threshold: 1 })
    .toBuffer({ resolveWithObject: true });
  if (!info.width) return maxSize;
  return Math.min(maxSize, Math.floor((100 * maxWidth) / info.width));
}

async function blockSize(lines: string[], maxSize: number, maxWidth: number): Promise<number> {
  return Math.min(
    ...(await Promise.all(lines.map((l) => fitSize(l, SERIF, "bold", maxSize, maxWidth)))),
  );
}

type Concept = {
  id: string;
  source: string;
  /** Two short lines. Anything longer is unreadable at 300x100. */
  headline: string[];
  cta: string;
};

const CONCEPTS: Concept[] = [
  {
    id: "sends-anything",
    source: "bed",
    headline: ["She'll send you", "anything."],
    cta: "Chat free",
  },
  {
    id: "your-rules",
    source: "phone",
    headline: ["Your AI girl.", "Your rules."],
    cta: "Start free",
  },
  { id: "texts-back", source: "wide", headline: ["She always", "texts back."], cta: "Try free" },
];

function wordmark(x: number, y: number, scale = 1): string {
  const s = (n: number) => n * scale;
  return `<g transform="translate(${x} ${y})">
    <path transform="scale(${scale})" d="M14 25 C4 17 0 11 0 7 C0 3 3 0 7 0 C10 0 12 1.5 14 4 C16 1.5 18 0 21 0 C25 0 28 3 28 7 C28 11 24 17 14 25 Z" fill="${PINK}"/>
    <text x="${s(38)}" y="${s(21)}" font-family="${SANS}" font-weight="bold" font-size="${s(27)}" fill="#fff">HumanCrush<tspan fill="${ROSE}">.com</tspan></text>
  </g>`;
}

function pill(x: number, y: number, w: number, h: number, label: string, fs: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="url(#cta)"/>
    <text x="${x + w / 2}" y="${y + h / 2 + fs * 0.36}" text-anchor="middle" font-family="${SANS}"
      font-weight="bold" font-size="${fs}" letter-spacing="1" fill="#fff">${esc(label.toUpperCase())}</text>`;
}

const DEFS = `<defs>
  <linearGradient id="cta" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${PINK}"/><stop offset="1" stop-color="#ff6a4d"/>
  </linearGradient>
  <linearGradient id="side" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${INK}" stop-opacity="0.97"/>
    <stop offset="0.7" stop-color="${INK}" stop-opacity="0.9"/>
    <stop offset="1" stop-color="${INK}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${INK}" stop-opacity="0"/>
    <stop offset="0.5" stop-color="${INK}" stop-opacity="0.9"/>
    <stop offset="1" stop-color="${INK}" stop-opacity="0.99"/>
  </linearGradient>
</defs>`;

/* ---------------- Ad units ---------------- */
//
// TrafficJunky's standard inventory. 315x300 and 300x250 carry most PornHub
// desktop and mobile traffic; the rest fill the remaining placements.

type Unit = {
  id: string;
  w: number;
  h: number;
  plate: "2:3" | "1:1" | "16:9";
  pos: string;
  svg: (c: Concept) => Promise<string>;
};

// Portrait and square units: photo full-bleed, copy over a bottom scrim.
const stacked = (w: number, h: number, pad: number, mark: number) => async (c: Concept) => {
  const hs = await blockSize(c.headline, Math.round(h * 0.15), w - pad * 2);
  const ctaH = Math.round(h * 0.13);
  const ctaW = Math.round(w * 0.52);
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${DEFS}
    <rect x="0" y="${h * 0.34}" width="${w}" height="${h * 0.66}" fill="url(#bottom)"/>
    ${wordmark(pad, pad, mark)}
    <text x="${pad}" y="${h - ctaH - pad - hs * 1.35}" font-family="${SERIF}" font-weight="bold" font-size="${hs}" fill="#fff">${esc(c.headline[0])}</text>
    <text x="${pad}" y="${h - ctaH - pad - hs * 0.2}" font-family="${SERIF}" font-weight="bold" font-size="${hs}" fill="${ROSE}">${esc(c.headline[1])}</text>
    ${pill(pad, h - ctaH - pad + 6, ctaW, ctaH, c.cta, Math.round(ctaH * 0.42))}
  </svg>`;
};

// Wide units: subject on the right, copy on a dark panel to the left. A bottom
// scrim on a 90px-tall banner leaves nowhere to put words.
//
// The headline and the button share that panel side by side, so the headline is
// measured against the space LEFT OVER once the button is placed. Measuring it
// against the whole panel — the first version — ran "She always texts back."
// straight underneath the pill.
const sideBySide =
  (w: number, h: number, panel: number, pad: number, mark: number) => async (c: Concept) => {
    const ctaH = Math.round(h * 0.3);
    const ctaW = Math.round(panel * 0.34);
    const textW = panel - ctaW - pad * 3;
    const hs = await blockSize(c.headline, Math.round(h * 0.3), textW);
    // Two lines, centred as a block against the banner's middle.
    const firstBaseline = h / 2 - hs * 0.12;
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${DEFS}
    <rect x="0" y="0" width="${panel}" height="${h}" fill="url(#side)"/>
    ${wordmark(pad, Math.round(pad * 0.7), mark)}
    <text x="${pad}" y="${firstBaseline}" font-family="${SERIF}" font-weight="bold" font-size="${hs}" fill="#fff">${esc(c.headline[0])}</text>
    <text x="${pad}" y="${firstBaseline + hs * 1.08}" font-family="${SERIF}" font-weight="bold" font-size="${hs}" fill="${ROSE}">${esc(c.headline[1])}</text>
    ${pill(panel - ctaW - pad, (h - ctaH) / 2, ctaW, ctaH, c.cta, Math.round(ctaH * 0.4))}
  </svg>`;
  };

// 300x100 has room for the wordmark and the CTA and nothing else.
const strip = async (c: Concept) => {
  const hs = await fitSize(c.headline.join(" "), SERIF, "bold", 26, 170);
  return `<svg width="300" height="100" xmlns="http://www.w3.org/2000/svg">${DEFS}
    <rect x="0" y="0" width="205" height="100" fill="url(#side)"/>
    ${wordmark(12, 10, 0.5)}
    <text x="12" y="58" font-family="${SERIF}" font-weight="bold" font-size="${hs}" fill="#fff">${esc(c.headline[0])}</text>
    ${pill(12, 66, 108, 26, c.cta, 11)}
  </svg>`;
};

const UNITS: Unit[] = [
  { id: "315x300", w: 315, h: 300, plate: "1:1", pos: "top", svg: stacked(315, 300, 16, 0.55) },
  { id: "300x250", w: 300, h: 250, plate: "1:1", pos: "top", svg: stacked(300, 250, 14, 0.5) },
  {
    id: "900x250",
    w: 900,
    h: 250,
    plate: "16:9",
    pos: "right",
    svg: sideBySide(900, 250, 520, 26, 0.8),
  },
  {
    id: "728x90",
    w: 728,
    h: 90,
    plate: "16:9",
    pos: "right",
    svg: sideBySide(728, 90, 440, 14, 0.42),
  },
  { id: "300x100", w: 300, h: 100, plate: "16:9", pos: "right", svg: strip },
];

/* ---------------- Run ---------------- */

async function main() {
  if (dryRun) {
    for (const c of CONCEPTS)
      for (const u of UNITS) console.log(`${c.id}-${u.id}.jpg   "${c.headline.join(" ")}"`);
    return;
  }

  for (const s of SOURCES) {
    const path = `${SRC_DIR}/${s.id}.jpg`;
    if (existsSync(path) && !force) {
      console.log(`⏭  ${s.id} (already shot)`);
      continue;
    }
    try {
      writeFileSync(
        path,
        await sharp(await generatePhoto(s.prompt, s.ratio, s.id))
          .jpeg({ quality: 92 })
          .toBuffer(),
      );
      console.log(`📸 ${s.id}`);
    } catch (e) {
      console.log(`❌ ${s.id}: ${(e as Error)?.message ?? e}`);
    }
  }
  if (photosOnly) return;

  // The plate a unit needs is chosen by shape, not by concept, so a portrait
  // concept still gets a real wide photo for the leaderboard rather than a
  // letterboxed slice of a tall one.
  const plateFor = (c: Concept, u: Unit) => {
    const own = SOURCES.find((s) => s.id === c.source);
    if (own && own.ratio === u.plate) return c.source;
    return SOURCES.find((s) => s.ratio === u.plate)?.id ?? c.source;
  };

  let made = 0;
  for (const c of CONCEPTS) {
    for (const u of UNITS) {
      const path = `${SRC_DIR}/${plateFor(c, u)}.jpg`;
      if (!existsSync(path)) {
        console.log(`⏭  ${c.id}-${u.id}: no ${path}`);
        continue;
      }
      const base = await sharp(readFileSync(path))
        .resize(u.w, u.h, { fit: "cover", position: u.pos })
        .toBuffer();
      const out = `${OUT_DIR}/${c.id}-${u.id}.jpg`;
      await sharp(base)
        .composite([{ input: Buffer.from(await u.svg(c)), top: 0, left: 0 }])
        .jpeg({ quality: 88, mozjpeg: true })
        .toFile(out);
      made++;
      console.log(`✅ ${out}`);
    }
  }
  console.log(`\n${made} banner(s) written to ${OUT_DIR}/`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
