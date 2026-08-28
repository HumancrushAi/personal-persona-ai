// Build 8-second vertical promo clips for Facebook/Instagram Reels.
//
// Same rule as the banners: these run on mainstream networks, so the model is
// fully clothed and the pull comes from the line she says, not from skin.
//
// Three pieces get assembled per clip:
//   motion  -> RunPod image-to-video off the banner photo, so she actually
//              moves and mouths the line instead of being a still with a zoom
//   voice   -> OpenAI TTS, because Reels autoplay with sound on
//   type    -> pre-rendered PNG overlays (captions, wordmark, end card), since
//              Reels are mostly watched muted and ffmpeg's drawtext font
//              handling on Windows is not worth fighting
//
//   npx vite-node scripts/generate-social-reels.ts -- --dry
//   npx vite-node scripts/generate-social-reels.ts -- --only=build-her
//   npx vite-node scripts/generate-social-reels.ts -- --force
//
// Finished clips land in marketing/reels/. Intermediates stay in
// marketing/reels/work/ so a failed step can be retried without paying for the
// video job again.
//
// NOTE: the voice is not lip-synced — the model animates as if speaking and the
// audio runs over it. A true lip-sync needs a talking-head model (fal.ai
// sync-lipsync, HeyGen, D-ID); none is wired up here.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
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

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const RUNPOD_KEY = process.env.RUNPOD_API_KEY || "";
const RUNPOD_VIDEO = process.env.RUNPOD_VIDEO_ENDPOINT || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

// Two sets, chosen with --set. They never mix in a run and never share an
// output directory, because handing Facebook the adult cut would cost the ad
// account. `social` is clothed and mainstream-safe; `adult` is lingerie and
// only for PornHub/TrafficJunky-style networks.
const SET = args.includes("--set=adult") ? "adult" : "social";
const ADULT = SET === "adult";

const OUT_DIR = ADULT ? "marketing/adult/reels" : "marketing/reels";
const WORK_DIR = `${OUT_DIR}/work`;
const SRC_DIR = ADULT ? "marketing/adult/source" : "marketing/source";
const FFMPEG = path.resolve("node_modules/ffmpeg-static/ffmpeg.exe");

const W = 1080;
const H = 1920;
const SECONDS = 8;
const FPS = 16; // the endpoint's tuned rate; ffmpeg resamples to 30 on output
const SWITCH_AT = 5.4; // caption gives way to the end card

/* ---------------- Content ---------------- */

type Reel = {
  id: string;
  source: string;
  /** Spoken aloud. Keep to ~20 words — more will not fit in 8 seconds. */
  line: string;
  /** Same words, broken for the caption block. */
  caption: string[];
  endline: string[];
  kicker: string;
  voice: string;
  motion: string;
};

const SOCIAL_REELS: Reel[] = [
  {
    id: "build-her",
    source: "sofa",
    line: "Design me however you want. My look, my voice, my personality. Then just talk to me.",
    caption: ["Design me however", "you want."],
    endline: ["Make your own", "AI companion"],
    kicker: "Start free",
    voice: "shimmer",
    motion:
      "she looks at the camera and talks warmly, natural mouth movement while speaking, gentle head tilts, blinking, friendly genuine smile, subtle hand gesture, sitting still on the sofa",
  },
  {
    id: "texts-first",
    source: "street",
    line: "I'm an AI companion. Make your own in about a minute, and I'll even text you first.",
    caption: ["I'll text", "you first."],
    endline: ["Make your own", "AI companion"],
    kicker: "25 free messages",
    voice: "nova",
    motion:
      "she looks at the camera and talks, natural mouth movement while speaking, laughing softly, hair moving gently in the breeze, blinking, warm eye contact, standing still",
  },
  {
    id: "your-rules",
    source: "window",
    line: "Build me from scratch, then talk to me about anything. Twenty five free messages, no card.",
    caption: ["Build me", "from scratch."],
    endline: ["Your companion.", "Your rules."],
    kicker: "Try it free",
    voice: "coral",
    motion:
      "she looks at the camera and talks warmly, natural mouth movement while speaking, soft smile, small head movements, blinking, relaxed and still by the window",
  },
];

// Adult networks. Lingerie, direct copy — and still no nudity, because the ad
// unit is held to a stricter line than the site it runs on.
const ADULT_REELS: Reel[] = [
  {
    id: "sends-anything",
    source: "bed",
    line: "Build me exactly how you want me. Then ask me for anything — I'll send it.",
    caption: ["Ask me for", "anything."],
    endline: ["Your AI girl.", "Your rules."],
    kicker: "Chat free",
    voice: "shimmer",
    motion:
      "she looks at the camera and talks, natural mouth movement while speaking, slow confident head tilt, biting her lip, blinking, direct seductive eye contact, kneeling still on the bed",
  },
  {
    id: "texts-back",
    source: "phone",
    line: "I'm awake whenever you are. Make your own AI girl and I'll always text back.",
    caption: ["I always", "text back."],
    endline: ["Make your own", "AI girl"],
    kicker: "Start free",
    voice: "coral",
    motion:
      "she looks at the camera and talks, natural mouth movement while speaking, smirking, slow blink, shifting her weight slightly, holding the phone steady, lying back on the couch",
  },
];

const REELS: Reel[] = ADULT ? ADULT_REELS : SOCIAL_REELS;

const NEGATIVE =
  "blurry, low quality, deformed, extra limbs, watermark, text, static, frozen, no movement, bad anatomy, cartoon, anime, 3d render, nudity, naked, topless, undressing";

/* ---------------- Brand kit (shared with generate-social-banners) ---------------- */

const INK = "#08060c";
const PINK = "#ff3d8b";
const ROSE = "#ff7ab0";
const SERIF = "Georgia";
const SANS = "Segoe UI";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Sized by measurement, not by eye: "Design me however" at the design size ran
// off the right edge of the frame. Render once at a reference size, trim to the
// glyph box, scale from the width that comes back.
async function fitSize(text: string, maxSize: number, maxWidth: number): Promise<number> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="200">
    <text x="10" y="100" font-family="${SERIF}" font-weight="bold" font-size="100" fill="#ffffff">${esc(text)}</text></svg>`;
  const { info } = await sharp(Buffer.from(svg))
    .trim({ threshold: 1 })
    .toBuffer({ resolveWithObject: true });
  if (!info.width) return maxSize;
  return Math.min(maxSize, Math.floor((100 * maxWidth) / info.width));
}

// One size across both lines so the pair still reads as a single block.
async function blockSize(lines: string[], maxSize: number, maxWidth: number): Promise<number> {
  return Math.min(...(await Promise.all(lines.map((l) => fitSize(l, maxSize, maxWidth)))));
}

const SAFE_W = W - 144;

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
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="url(#cta)"/>
    <text x="${x + w / 2}" y="${y + h / 2 + fontSize * 0.36}" text-anchor="middle"
          font-family="${SANS}" font-weight="bold" font-size="${fontSize}"
          letter-spacing="1.5" fill="#ffffff">${esc(label)}</text>`;
}

const DEFS = `
  <defs>
    <linearGradient id="cta" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${PINK}"/>
      <stop offset="1" stop-color="#ff6a4d"/>
    </linearGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${INK}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="${INK}" stop-opacity="0.88"/>
      <stop offset="1" stop-color="${INK}" stop-opacity="0.99"/>
    </linearGradient>
  </defs>`;

// Reels chrome covers roughly the top 250px and bottom 420px, so both overlays
// keep their words inside that middle band.
async function captionPng(r: Reel): Promise<Buffer> {
  const s = await blockSize(r.caption, 104, SAFE_W);
  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${DEFS}
    <rect x="0" y="960" width="${W}" height="${H - 960}" fill="url(#scrim)"/>
    ${wordmark(72, 300, 1.25)}
    <text x="72" y="1320" font-family="${SERIF}" font-weight="bold" font-size="${s}" fill="#ffffff">${esc(r.caption[0])}</text>
    <text x="72" y="${1320 + s * 1.19}" font-family="${SERIF}" font-weight="bold" font-size="${s}" fill="${ROSE}">${esc(r.caption[1])}</text>
  </svg>`);
}

async function endcardPng(r: Reel): Promise<Buffer> {
  const s = await blockSize(r.endline, 112, SAFE_W);
  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${DEFS}
    <rect x="0" y="820" width="${W}" height="${H - 820}" fill="url(#scrim)"/>
    ${wordmark(72, 300, 1.25)}
    <text x="72" y="1200" font-family="${SERIF}" font-weight="bold" font-size="${s}" fill="#ffffff">${esc(r.endline[0])}</text>
    <text x="72" y="${1200 + s * 1.13}" font-family="${SERIF}" font-weight="bold" font-size="${s}" fill="${ROSE}">${esc(r.endline[1])}</text>
    ${ctaPill(72, 1200 + s * 1.13 + 74, 560, 108, r.kicker.toUpperCase(), 36)}
  </svg>`);
}

/* ---------------- Steps ---------------- */

// RunPod fetches the start frame over HTTP, so it has to be hosted. The video
// endpoint centre-crops to a square, which would behead a 9:16 portrait — so it
// gets a square anchored at the top, the same trick generate-reels.ts uses.
async function uploadStartFrame(id: string, photo: Buffer): Promise<string> {
  const squared = await sharp(photo)
    .resize(768, 768, { fit: "cover", position: "top" })
    .png()
    .toBuffer();

  const objectPath = `startframes/promo-${id}.png`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${objectPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "image/png",
      "x-upsert": "true",
    },
    body: squared,
  });
  if (!res.ok)
    throw new Error(`start frame upload failed: ${res.status} ${(await res.text()).slice(0, 150)}`);
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${objectPath}`;
}

async function renderMotion(r: Reel, startFrameUrl: string): Promise<Buffer> {
  const submit = await fetch(`https://api.runpod.ai/v2/${RUNPOD_VIDEO}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${RUNPOD_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: {
        image_url: startFrameUrl,
        fps: FPS,
        frames_per_scene: SECONDS * FPS,
        num_scenes: 1,
        sampling_steps: Number(process.env.RUNPOD_VIDEO_STEPS || "25"),
        prompts: [r.motion],
        negative_prompt: NEGATIVE,
      },
    }),
  });
  if (!submit.ok)
    throw new Error(`runpod submit: ${submit.status} ${(await submit.text()).slice(0, 150)}`);
  const { id: jobId } = await submit.json();

  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 6000));
    const poll = await fetch(`https://api.runpod.ai/v2/${RUNPOD_VIDEO}/status/${jobId}`, {
      headers: { Authorization: `Bearer ${RUNPOD_KEY}` },
    });
    if (!poll.ok) continue;
    const job = await poll.json();
    const state = (job.status || "").toUpperCase();

    if (state === "COMPLETED") {
      const out = job.output ?? {};
      const url = out.chunk_urls?.[0] || out.final_video_url || out.video_url || out.url;
      if (!url) throw new Error("job completed with no video url");
      const clip = await fetch(url);
      if (!clip.ok) throw new Error(`clip download failed (${clip.status})`);
      return Buffer.from(await clip.arrayBuffer());
    }
    if (["FAILED", "CANCELLED", "CANCELED", "TIMED_OUT"].includes(state)) {
      throw new Error(
        `job ${state}: ${JSON.stringify(job.error ?? job.output ?? "").slice(0, 200)}`,
      );
    }
    process.stdout.write(`\r   ${r.id} … ${state.toLowerCase()}      `);
  }
  throw new Error("timed out after 12 min");
}

async function speak(r: Reel): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      input: r.line,
      voice: r.voice,
      response_format: "mp3",
      // Deliberately not the in-app voice-note persona: this is a public ad, so
      // it wants bright and inviting rather than intimate.
      instructions:
        "Speak as a warm, confident young woman recording a short friendly invitation to camera. " +
        "Bright, upbeat and natural, with a smile in your voice. Brisk enough to finish in about " +
        "seven seconds, but never rushed or robotic.",
    }),
  });
  if (!res.ok) throw new Error(`tts: ${res.status} ${(await res.text()).slice(0, 150)}`);
  return Buffer.from(await res.arrayBuffer());
}

// Blurred fill behind the square clip is the standard Reels treatment — the
// alternative, flat bars top and bottom, reads as a reposted video.
function compose(clip: string, voice: string, caption: string, endcard: string, out: string) {
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-i",
      clip,
      "-i",
      voice,
      "-i",
      caption,
      "-i",
      endcard,
      "-filter_complex",
      [
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=42,eq=brightness=-0.06[bg]`,
        `[0:v]scale=${W}:-2[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2[base]`,
        `[base][2:v]overlay=0:0:enable='lt(t,${SWITCH_AT})'[c]`,
        `[c][3:v]overlay=0:0:enable='gte(t,${SWITCH_AT})'[v]`,
        // Pad rather than -shortest: a voice that lands under 8s must not cut
        // the picture short.
        `[1:a]apad[a]`,
      ].join(";"),
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-t",
      String(SECONDS),
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-ar",
      "44100",
      out,
    ],
    { stdio: "pipe" },
  );
}

/* ---------------- Run ---------------- */

async function main() {
  let rows = REELS;
  if (only) rows = rows.filter((r) => only.includes(r.id.toLowerCase()));

  if (dryRun) {
    for (const r of rows) console.log(`${r.id.padEnd(14)} [${r.voice}] "${r.line}"`);
    return;
  }

  for (const k of [
    ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
    ["RUNPOD_API_KEY", RUNPOD_KEY],
    ["RUNPOD_VIDEO_ENDPOINT", RUNPOD_VIDEO],
    ["OPENAI_API_KEY", OPENAI_KEY],
  ] as const) {
    if (!k[1]) {
      console.error(`❌ ${k[0]} missing from .env.local`);
      process.exit(1);
    }
  }

  mkdirSync(WORK_DIR, { recursive: true });
  const failures: string[] = [];

  for (const r of rows) {
    const photoPath = `${SRC_DIR}/${r.source}.jpg`;
    if (!existsSync(photoPath)) {
      failures.push(`${r.id}: no ${photoPath} — run generate-social-banners.ts first`);
      continue;
    }

    const clipPath = `${WORK_DIR}/${r.id}-motion.mp4`;
    const voicePath = `${WORK_DIR}/${r.id}-voice.mp3`;
    const capPath = `${WORK_DIR}/${r.id}-caption.png`;
    const endPath = `${WORK_DIR}/${r.id}-endcard.png`;
    const outPath = `${OUT_DIR}/${r.id}-reel-8s.mp4`;

    try {
      if (!existsSync(clipPath) || force) {
        process.stdout.write(`🎬 ${r.id} … uploading start frame`);
        const url = await uploadStartFrame(r.id, readFileSync(photoPath));
        process.stdout.write(`\r🎬 ${r.id} … rendering motion    `);
        writeFileSync(clipPath, await renderMotion(r, url));
      }
      console.log(`\r🎬 ${r.id} … motion ok              `);

      if (!existsSync(voicePath) || force) {
        writeFileSync(voicePath, await speak(r));
      }
      console.log(`🔊 ${r.id} … voice ok`);

      await sharp(await captionPng(r))
        .png()
        .toFile(capPath);
      await sharp(await endcardPng(r))
        .png()
        .toFile(endPath);

      compose(clipPath, voicePath, capPath, endPath, outPath);
      console.log(`✅ ${outPath}`);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      failures.push(`${r.id}: ${msg}`);
      console.log(`\n❌ ${r.id}: ${msg}`);
    }
  }

  console.log(`\n${rows.length - failures.length}/${rows.length} reel(s) built in ${OUT_DIR}/`);
  for (const f of failures) console.log(`   ${f}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
