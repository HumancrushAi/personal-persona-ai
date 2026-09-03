// Explicit ad creative for adult networks, in every banner size the studio
// knows about.
//
//   npx vite-node --config vitest.config.ts scripts/generate-explicit-banners.ts -- --dry
//   npx vite-node --config vitest.config.ts scripts/generate-explicit-banners.ts -- --plates-only
//   npx vite-node --config vitest.config.ts scripts/generate-explicit-banners.ts -- --force
//   npx vite-node --config vitest.config.ts scripts/generate-explicit-banners.ts -- --only=couch
//
// The --config flag matters: the app's own vite.config.ts starts the Nitro and
// TanStack Start plugins and never returns. vitest.config.ts is the light one
// (path aliases, node environment) and is all this needs.
//
// This is the explicit counterpart to generate-adult-banners.ts, which renders
// lingerie on Replicate. The difference is the renderer: nothing here goes near
// FLUX Kontext or Imagine, both of which refuse nudity at the weights level and
// return a clothed subject while reporting success. Explicit plates come from
// the private RunPod endpoint — the only uncensored model on the account — with
// Grok writing the prompt through refineMediaPrompt, exactly as the chat selfie
// does.
//
// That endpoint is image-to-video, so each plate is a short clip whose last
// frame is cut out as the still. It needs a hosted start frame, which is why the
// source photos are uploaded to Supabase first: a RunPod worker fetches the
// frame over the network and cannot read a local file.
//
// Plates land in marketing/adult-explicit/plates/ and the finished banners in
// marketing/adult-explicit/. Plates are reused unless --force, so a re-run only
// recomposites, which is the free half.
//
// NOTE ON PLACEMENT: most adult networks reject exposed genitals and many reject
// bare nipples in the CREATIVE even when the landing page is explicit. These are
// for placements that accept explicit creative; use generate-adult-banners.ts
// for anything stricter.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import sharp from "sharp";
import type { BannerStyle } from "../src/lib/banner-compositor.server";
import { createClient } from "@supabase/supabase-js";

// Every hop in this pipeline goes over the network — Supabase, xAI, RunPod, a
// CDN — and each of them drops a connection often enough that an unguarded call
// loses work that has already been paid for. One helper, used on all of them.
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = (e as Error)?.message ?? String(e);
      if (i < attempts - 1) {
        console.log(`   ${label} retry ${i + 1}/${attempts - 1}: ${msg.slice(0, 70)}`);
        await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
      }
    }
  }
  throw last;
}

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
const platesOnly = args.includes("--plates-only");
// --only=couch re-runs a single concept, so one bad plate can be redone without
// paying to render the others again.
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];

// All three art directions are rendered for every unit. Rotating creative is
// standard practice in this vertical, and the three registers suit different
// placements: editorial for premium/mainstream-adjacent inventory, modern as
// the all-round default, bold where raw click-through wins.
const STYLES: BannerStyle[] = ["editorial", "modern", "bold"];

const OUT_DIR = "marketing/adult-explicit";
const PLATE_DIR = `${OUT_DIR}/plates`;

type Concept = {
  id: string;
  /** Local source photo whose face and body carry into the plate. */
  source: string;
  /** The request, in the admin's own words. Grok expands it. */
  request: string;
  /** Two short lines. Anything longer is unreadable at 300x100. */
  headline: string[];
  cta: string;
};

/**
 * The copy deck.
 *
 * One headline printed across every unit is not an ad set, it is the same ad
 * thirty-six times — and it wastes the only cheap lever there is. Impressions
 * are bought per placement, so different angles running side by side is how you
 * find out which promise people actually click, and rotating creative is
 * standard practice in this vertical rather than a nicety.
 *
 * The angles are deliberately different rather than reworded: availability,
 * control, no rejection, custom-built, always-on, explicitness. Each keeps to
 * two short lines because anything longer is unreadable at 300x100, and each
 * carries its own CTA verb and chip so the whole unit changes, not just the
 * headline.
 */
type Copy = {
  slug: string;
  headline: string[];
  cta: string;
  chip: string;
};

const COPY_DECK: Copy[] = [
  // Availability — the core promise of the product.
  {
    slug: "anything",
    headline: ["She'll send you", "anything."],
    cta: "Chat free",
    chip: "FREE TO CHAT",
  },
  // Control.
  {
    slug: "your-rules",
    headline: ["Your AI girl.", "Your rules."],
    cta: "Start free",
    chip: "18+ ONLY",
  },
  // No rejection — the strongest angle in dating-adjacent creative.
  //
  // The chip here read "NO SIGNUP", which was simply false: an account is
  // required and the free allowance is credited to it (free_messages_remaining
  // in credit_balances). Do not put a claim on ad creative that the product
  // does not honour — it is the fastest way to lose an ad account, and on a
  // paid funnel it is the fastest way to lose the click at the signup wall.
  {
    slug: "texts-back",
    headline: ["She always", "texts back."],
    cta: "Try free",
    chip: "FREE MESSAGES",
  },
  // Never told no.
  { slug: "never-no", headline: ["She never", "says no."], cta: "Meet her", chip: "FREE TO CHAT" },
  // Custom-built — what actually differentiates this from a cam site.
  {
    slug: "built-by-you",
    headline: ["Built by you.", "Obsessed with you."],
    cta: "Create her",
    chip: "MADE TO ORDER",
  },
  // Always-on.
  { slug: "shes-awake", headline: ["She's awake.", "Are you?"], cta: "Say hi", chip: "ONLINE NOW" },
  // Explicit, stated plainly.
  {
    slug: "just-ask",
    headline: ["Want to see more?", "Just ask her."],
    cta: "Chat now",
    chip: "UNCENSORED",
  },
  // Fantasy framing.
  {
    slug: "your-fantasy",
    headline: ["Your fantasy.", "Her voice."],
    cta: "Hear her",
    chip: "REAL VOICE",
  },
  // Speed.
  { slug: "no-games", headline: ["No games.", "No waiting."], cta: "Start now", chip: "INSTANT" },
];

const CONCEPTS: Concept[] = [
  {
    id: "bed",
    // wide.jpg rather than bed.jpg on purpose. bed.jpg is already a tight
    // three-quarter shot, and the model reframes INTO whatever it is given: fed
    // that, it produced either a chest close-up with no face or a subject that
    // kept her lingerie on, across three renders. A wider source leaves it room
    // to move without leaving the face behind.
    source: "marketing/adult/source/wide.jpg",
    request:
      "completely nude reclining across the dark silk sheets, whole body in frame from head to thigh, face clearly visible looking straight at the camera, bare breasts exposed, seductive expression, moody low-key bedroom lighting",
    headline: ["She'll send you", "anything."],
    cta: "Chat free",
  },
  {
    id: "couch",
    source: "marketing/adult/source/phone.jpg",
    // No act, and nothing below the waist named.
    //
    // The previous wording asked for "legs open, one hand between her thighs",
    // and the model does what an image-to-video model does: it reframes onto
    // whatever the prompt points at. The result was a genital close-up with her
    // head outside the frame — explicit, and completely useless as ad creative,
    // which needs a face above all else. Naming the FRAMING and the expression,
    // and leaving the act out entirely, is what keeps her in shot.
    // Framed WIDE, on purpose.
    //
    // Two failure modes have to be avoided at once and they pull apart. Name an
    // act and the model crops to it and loses her head; ask only for the face
    // and it delivers a portrait with nothing else in it, which is not explicit
    // creative. So the prompt asks for distance — the whole figure, camera back,
    // head to knees — which is the only wording that has produced both the face
    // and the body in the same frame.
    request:
      "completely nude sitting back on the couch, FULL BODY visible from head to knees, camera pulled back showing the whole figure, face clearly visible looking into the camera, bare breasts and torso fully in frame, relaxed confident smile, soft warm evening light, wide shot, not a close-up, not cropped",
    headline: ["Your AI girl.", "Your rules."],
    cta: "Start free",
  },
];

/* ---------------- Start frames ---------------- */

// The start frame needs HEADROOM, and the plate needs resolution. Those pull in
// opposite directions and both matter, so this does the first and renderPlate
// undoes the cost of it.
//
// The endpoint outputs a square and reframes toward whatever act the prompt
// asks for. Given a square filled edge to edge with her, that reframing walks
// her head straight out of the top — the first attempt here cropped the source
// to a square and every plate came back a headless torso, which is worthless as
// ad creative. So the figure is fitted INSIDE the square with margin above, the
// way start-frame.server.ts does it for the chat path, and the margins are
// filled with a blurred copy rather than bars.
//
// The inset is 0.72 rather than that path's 0.62: this is a still for print-ish
// use rather than a video, so it trades a little headroom for pixels on her.
const START_INSET = 0.72;
const START_SIDE = 768;

/** Where the subject sits inside the padded square, as 0-1 fractions. */
function subjectBox(srcW: number, srcH: number) {
  const aspect = srcW / srcH;
  let bw = START_INSET;
  let bh = START_INSET;
  if (aspect >= 1) bh = START_INSET / aspect;
  else bw = START_INSET * aspect;
  return { x: (1 - bw) / 2, y: 0, w: bw, h: bh };
}

async function squareAndUpload(localPath: string, key: string): Promise<string> {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY)
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const SIDE = START_SIDE;
  const src = readFileSync(localPath);
  const backdrop = await sharp(src)
    .resize(SIDE, SIDE, { fit: "cover" })
    .blur(28)
    .modulate({ brightness: 0.75 })
    .toBuffer();
  const inner = Math.round(SIDE * START_INSET);
  const subject = await sharp(src).resize(inner, inner, { fit: "inside" }).toBuffer();
  const squared = await sharp(backdrop)
    .composite([{ input: subject, gravity: "north" }])
    .png()
    .toBuffer();

  // Hosting the frame is only a means to an end: the worker has to be able to
  // read it. A hosted URL is preferred because it keeps the request small, but
  // Supabase being unreachable should not stop a render — the endpoint accepts
  // the image inline, so that is the fallback rather than a failure.
  const path = `startframes/explicit-${key}.png`;
  try {
    await withRetry(
      "start frame upload",
      async () => {
        const { error } = await sb.storage
          .from("avatars")
          .upload(path, squared, { contentType: "image/png", upsert: true });
        if (error) throw new Error(error.message);
      },
      3,
    );
    return sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  } catch (e) {
    console.log(`   storage unreachable (${(e as Error).message}); sending the frame inline`);
    return `data:image/png;base64,${squared.toString("base64")}`;
  }
}

/* ---------------- Plate generation ---------------- */

async function lastFrame(mp4: Buffer): Promise<Buffer> {
  const ffmpeg = (await import("ffmpeg-static")).default as unknown as string;
  const dir = await mkdtemp(join(tmpdir(), "plate-"));
  const inPath = join(dir, "in.mp4");
  const outPath = join(dir, "out.png");
  try {
    await writeFile(inPath, mp4);
    // -sseof seeks from the END, where the requested pose has fully resolved:
    // the clip starts from the clothed source and moves into it.
    await promisify(execFile)(ffmpeg, [
      "-y",
      "-sseof",
      "-0.3",
      "-i",
      inPath,
      "-frames:v",
      "1",
      outPath,
    ]);
    return Buffer.from(await readFile(outPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function renderPlate(concept: Concept): Promise<Buffer> {
  const {
    VIDEO_LORA_STRENGTHS,
    runpodEndpoint,
    runpodRun,
    runpodGet,
    runpodStatusOf,
    runpodOutputUrl,
    runpodOutputError,
  } = await import("../src/lib/runpod");
  const endpoint = runpodEndpoint("video");
  if (!endpoint) throw new Error("RUNPOD_VIDEO_ENDPOINT / RUNPOD_API_KEY missing");

  // Grok, through the same refiner the app uses. requestIsNude reads the request
  // and switches it to the nude few-shot examples; nothing here forces it.
  const { refineMediaPrompt } = await import("../src/lib/prompt-refiner.server");
  const refined = await refineMediaPrompt("photo", concept.request, {
    gender: "female",
    ethnicity: "",
    age: 24,
  });
  const prompt = refined?.[0] ?? concept.request;
  console.log(`   prompt: ${prompt.slice(0, 110)}…`);

  const srcMeta = await sharp(readFileSync(concept.source)).metadata();
  const startFrame = await squareAndUpload(concept.source, concept.id);

  const job = await withRetry("job submit", () =>
    runpodRun(endpoint, {
      image_url: startFrame,
      fps: 16,
      frames_per_scene: Number(process.env.RUNPOD_STILL_FRAMES || "49"),
      num_scenes: 1,
      sampling_steps: Number(process.env.RUNPOD_STILL_STEPS || "24"),
      prompts: [prompt],
      negative_prompt:
        "different person, different face, changed identity, deformed, extra limbs, bad anatomy, blurry, cartoon, anime, watermark, text, clothed, dressed, bra, lingerie, underwear, panties, fabric covering body",
      // Without these the worker runs on its own defaults and the endpoint is no
      // longer the model it was tuned into: the first run of this script omitted
      // them and every plate came back in lingerie despite a nude prompt and a
      // clothing negative. They are what make it uncensored.
      lora_strengths: VIDEO_LORA_STRENGTHS,
    }),
  );

  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await runpodGet(endpoint, job.id).catch(() => null);
    if (!res) continue;
    const state = runpodStatusOf(res.status);
    if (state === "processing") {
      if (i % 6 === 0) console.log(`   …${res.status} (${(i * 5) | 0}s)`);
      continue;
    }
    const err = runpodOutputError(res.output, res.error);
    if (state === "failed" || err) throw new Error(err || `job ${res.status}`);
    const url = runpodOutputUrl(res.output);
    if (!url) throw new Error("no output url");
    const mp4 = await withRetry("clip download", async () => {
      const dl = await fetch(url);
      if (!dl.ok) throw new Error(`status ${dl.status}`);
      return Buffer.from(await dl.arrayBuffer());
    });

    const frame = await lastFrame(mp4);

    // Cut the blurred margin back off, so the banner compositor is cropping
    // from her and not from padding.
    const fm = await sharp(frame).metadata();
    const outW = fm.width ?? 640;
    const outH = fm.height ?? 640;
    const box = subjectBox(srcMeta.width ?? 1, srcMeta.height ?? 1);
    // A couple of percent inward keeps the blurred fill from bleeding in.
    const trim = 0.02;
    const left = Math.round((box.x + box.w * trim) * outW);
    const top = Math.round((box.y + box.h * trim) * outH);
    const width = Math.max(16, Math.round(box.w * (1 - trim * 2) * outW));
    const height = Math.max(16, Math.round(box.h * (1 - trim * 2) * outH));
    return sharp(frame)
      .extract({
        left: Math.min(left, outW - 16),
        top: Math.min(top, outH - 16),
        width: Math.min(width, outW - left),
        height: Math.min(height, outH - top),
      })
      .png()
      .toBuffer();
  }
  throw new Error("timed out waiting for the plate");
}

/* ---------------- Run ---------------- */

async function main() {
  const { STUDIO_SIZES } = await import("../src/lib/studio-sizes");
  // Every size with fixed pixels, not just the IAB banner units.
  //
  // Filtering to category "banner" capped the whole set at 970x250, so the
  // largest thing produced was a leaderboard — no use for a paid social
  // placement, a site hero, or anything that wants real estate. The social
  // formats in the same table are the big canvases: 1920x1080, 1080x1920,
  // 1080x1350, 1200x628. They also give the photograph room to show the subject
  // rather than a head, which the small units physically cannot.
  const units = STUDIO_SIZES.filter((s) => s.w && s.h);

  if (dryRun) {
    for (const c of CONCEPTS)
      for (const u of units) console.log(`${OUT_DIR}/${c.id}-${u.w}x${u.h}.jpg   "${u.name}"`);
    console.log(
      `\n${CONCEPTS.length} concepts x ${units.length} units = ${CONCEPTS.length * units.length} banners`,
    );
    return;
  }

  mkdirSync(PLATE_DIR, { recursive: true });
  const { composeBanner } = await import("../src/lib/banner-compositor.server");

  let made = 0;
  for (const concept of CONCEPTS.filter((c) => !only || c.id === only)) {
    const platePath = `${PLATE_DIR}/${concept.id}.png`;

    if (!existsSync(platePath) || force) {
      // Keep the outgoing plate before overwriting it.
      //
      // Whether a render comes back usable is a coin toss on this endpoint —
      // roughly one in four has both the face in frame and the nudity — so a
      // --force that lands badly destroys a good plate that cost real money and
      // several minutes. One copy back is enough to undo that.
      if (existsSync(platePath)) {
        const prev = `${PLATE_DIR}/${concept.id}-prev.png`;
        writeFileSync(prev, readFileSync(platePath));
        console.log(`   previous plate kept at ${prev}`);
      }
      console.log(`\n🎬 ${concept.id}: rendering explicit plate on RunPod…`);
      const plate = await renderPlate(concept);
      writeFileSync(platePath, plate);
      console.log(`   ✅ plate saved -> ${platePath}`);
    } else {
      console.log(`\n⏭  ${concept.id}: plate already rendered (--force to redo)`);
    }
    if (platesOnly) continue;

    // Prefer the upscaled plate when one exists. The endpoint returns 640x640,
    // which a 970x250 billboard and a 300x600 half page both have to enlarge —
    // and that softness was the single most visible quality problem. Run
    // scripts/upscale-plate.ts to produce it; without it this degrades to the
    // native plate rather than failing.
    const hiPath = `${PLATE_DIR}/${concept.id}-hi.png`;
    const usePath = existsSync(hiPath) ? hiPath : platePath;
    if (usePath === platePath)
      console.log(
        `   ⚠ no upscaled plate — run: npx vite-node --config vitest.config.ts scripts/upscale-plate.ts -- ${concept.id} 4`,
      );

    // Handed over as bytes: composeBanner's URL path goes through fetch, and
    // Node's fetch has no file: handler at all.
    const plateBytes = readFileSync(usePath);

    for (const [si, style] of STYLES.entries()) {
      for (const [ui, unit] of units.entries()) {
        // Rotate the deck by unit-then-style so the three styles of any one
        // size always carry three DIFFERENT messages. Indexing by style alone
        // would print the same headline down a whole column, which is the thing
        // this deck exists to avoid.
        const copy = COPY_DECK[(ui * STYLES.length + si) % COPY_DECK.length];
        // Pixels, never the ratio id.
        //
        // The social presets are keyed "9:16", "3:4", "1:1" and a colon is not
        // a legal character in a Windows filename, so those seven units would
        // have failed to write the moment they were included. Pixel dimensions
        // are also what you actually need at the point of uploading a creative
        // to a placement — nobody pastes "4:5" into an ad manager.
        const px = `${unit.w}x${unit.h}`;
        const out = `${OUT_DIR}/${concept.id}-${style}-${px}-${copy.slug}.jpg`;

        // Focal point follows the shape of the unit.
        //
        // The plate is square with her face in the upper half and her body
        // below it. A portrait or square unit keeps nearly the whole frame, so
        // biasing to the face costs nothing. A wide unit keeps only a
        // horizontal band, and a face bias puts that band across her head —
        // which is how a set of EXPLICIT creative ended up as a row of
        // portraits with nothing else in them. Centring the band on a wide unit
        // takes the chin and the body instead, which is the point of the ad.
        const ratio = (unit.w ?? 1) / (unit.h ?? 1);
        const focalPoint = ratio >= 1.6 ? "center" : "face";

        try {
          const jpeg = await composeBanner({
            image: plateBytes,
            size: unit,
            copy: { headline: copy.headline, cta: copy.cta, chip: copy.chip },
            focalPoint,
            style,
          });
          writeFileSync(out, jpeg);
          made++;
        } catch (e) {
          console.log(`   ${style}/${px.padEnd(11)} FAILED: ${(e as Error).message}`);
        }
      }
      console.log(`   ${style.padEnd(9)} -> ${units.length} units`);
    }
  }

  console.log(`\n✅ ${made} banners in ${OUT_DIR}/`);
}

main().catch((e) => {
  console.error("❌", e?.message ?? e);
  process.exit(1);
});
