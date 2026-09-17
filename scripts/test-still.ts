// Render a chat photo through the exact production path and save it locally,
// so a change to the prompt or the render settings can be LOOKED AT before it
// ships instead of being judged by a user's complaint afterwards.
//
//   npx vite-node --config vitest.config.ts scripts/test-still.ts -- --companion=Aria
//   npx vite-node --config vitest.config.ts scripts/test-still.ts -- \
//     --companion=Aria --prompt="show me your pussy" --variants=tuned,portrait
//   npx vite-node --config vitest.config.ts scripts/test-still.ts -- --dry --gender=female
//
// Variants render the same prompt and start frame with different settings:
//   current   whatever the env and code defaults send today
//   tuned     the worker's own tuned values: no size, no guidance_scale, 26 steps
//   portrait  480*832, guidance_scale 4.0, 30 steps — briefly the default, and
//             the first thing to compare against
//
// Needs in .env.local: RUNPOD_API_KEY and RUNPOD_VIDEO_ENDPOINT (the render),
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (reads the companion and hosts the
// start frame, which the worker has to fetch over the network), and
// XAI_API_KEY for the Grok-refined prompt production actually sends — without
// it the fallback builder is rendered instead, and the script says so.
//
// Cost: one clip per variant, a couple of GPU-minutes each. Writes nothing to
// the database and posts no chat message. The start frame is uploaded under
// avatars/startframes/, the same place a real request puts it.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

function loadEnv(file: string) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* file optional */
  }
}
loadEnv(".env.local");
loadEnv(".env");

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...v] = a.slice(2).split("=");
      return [k, v.length ? v.join("=") : "true"];
    }),
);

const REQUEST = args.prompt ?? "show me your pussy";
const DRY = args.dry === "true";
const OUT = resolve(args.out ?? ".stills");

const VARIANTS: Record<string, Record<string, string | undefined>> = {
  current: {},
  tuned: { RUNPOD_STILL_SIZE: "off", RUNPOD_STILL_GUIDANCE: "off", RUNPOD_STILL_STEPS: "26" },
  portrait: { RUNPOD_STILL_SIZE: "480*832", RUNPOD_STILL_GUIDANCE: "4.0", RUNPOD_STILL_STEPS: "30" },
};
const chosen = (args.variants ?? "current").split(",").map((v) => v.trim());
for (const v of chosen) {
  if (!VARIANTS[v]) {
    console.error(`Unknown variant "${v}". Known: ${Object.keys(VARIANTS).join(", ")}`);
    process.exit(1);
  }
}

const required = DRY
  ? []
  : ["RUNPOD_API_KEY", "RUNPOD_VIDEO_ENDPOINT", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}
if (process.env.RUNPOD_IMAGE_ENDPOINT) {
  console.error("RUNPOD_IMAGE_ENDPOINT is set; this script only tests the clip-frame path.");
  process.exit(1);
}

type Companion = {
  name: string;
  age: number;
  ethnicity: string;
  gender: string | null;
  image_url: string | null;
};

async function loadCompanion(): Promise<Companion> {
  if (!args.companion) {
    return {
      name: "Test",
      age: Number(args.age ?? 26),
      ethnicity: args.ethnicity ?? "",
      gender: args.gender ?? "female",
      image_url: args.face ?? null,
    };
  }
  const { supabaseAdmin } = await import("../src/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("companions")
    .select("name, age, ethnicity, gender, image_url")
    .ilike("name", args.companion)
    .limit(1);
  if (error) throw error;
  if (!data?.length) throw new Error(`No companion named "${args.companion}"`);
  return data[0] as Companion;
}

function hosted(url: string | null): string | null {
  const u = (url ?? "").trim();
  if (/^https?:/i.test(u)) return u;
  if (u.startsWith("/")) return `${process.env.PUBLIC_SITE_URL || "https://humancrush.com"}${u}`;
  return null;
}

// Settings are read from the env when the body is built, so each variant's
// body is built on its own with its overrides applied, then the env restored.
function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(overrides).map((k) => [k, process.env[k]]));
  Object.assign(process.env, overrides);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function render(variant: string, input: Record<string, unknown>, stamp: string) {
  const { runpodRun, runpodGet, runpodStatusOf, runpodOutputUrl, runpodOutputError, runpodEndpoint } =
    await import("../src/lib/runpod");
  const endpoint = runpodEndpoint("video")!;
  const started = Date.now();
  const { id } = await runpodRun(endpoint, input);
  console.log(`[${variant}] queued ${id}`);

  let res: { status: string; output?: any; error?: any } = { status: "IN_QUEUE" };
  while (runpodStatusOf(res.status) === "processing") {
    if (Date.now() - started > 15 * 60_000) throw new Error(`[${variant}] timed out`);
    await new Promise((r) => setTimeout(r, 5000));
    res = await runpodGet(endpoint, id);
  }
  const err = runpodOutputError(res.output, res.error);
  if (runpodStatusOf(res.status) === "failed" || err) {
    throw new Error(`[${variant}] ${err ?? res.status}`);
  }
  const url = runpodOutputUrl(res.output);
  if (!url) throw new Error(`[${variant}] no output URL: ${JSON.stringify(res.output).slice(0, 300)}`);

  const clip = Buffer.from(await (await fetch(url)).arrayBuffer());
  const { extractLastFrame, trimBackdrop, enhanceStill } = await import(
    "../src/lib/media-finalize.server"
  );
  const still = await enhanceStill(await trimBackdrop(await extractLastFrame(clip)));

  const base = join(OUT, `${stamp}-${variant}`);
  writeFileSync(`${base}.mp4`, clip);
  writeFileSync(`${base}.${still.ext}`, still.buf);
  console.log(
    `[${variant}] done in ${Math.round((Date.now() - started) / 1000)}s -> ${base}.${still.ext}`,
  );
}

async function main() {
  const c = await loadCompanion();
  const { photoPrompt, stillJobInput, negativeFor } = await import("../src/lib/media.functions");

  if (!process.env.XAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    console.warn("No XAI_API_KEY/OPENROUTER_API_KEY: rendering the fallback builder's prompt.");
  }
  const prompt = await photoPrompt(c, REQUEST, null, false);
  const negative = negativeFor(REQUEST, c.gender, { moving: false });

  mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  let startFrame = hosted(c.image_url) ?? "(no hosted image)";
  if (!DRY) {
    if (!hosted(c.image_url)) throw new Error(`${c.name} has no hosted image_url`);
    const { squareStartFrame } = await import("../src/lib/start-frame.server");
    startFrame = await squareStartFrame(startFrame, `test-${stamp}`);
  }

  const inputs = Object.fromEntries(
    chosen.map((v) => [v, withEnv(VARIANTS[v], () => stillJobInput(startFrame, prompt, negative))]),
  );

  writeFileSync(
    join(OUT, `${stamp}-request.json`),
    JSON.stringify({ companion: c.name, request: REQUEST, inputs }, null, 2),
  );
  console.log(`Companion: ${c.name} (${c.gender})\nRequest:   ${REQUEST}\n\nPrompt:\n${prompt}\n`);
  for (const [v, input] of Object.entries(inputs)) {
    const { prompts: _p, negative_prompt: _n, ...knobs } = input;
    console.log(`[${v}] ${JSON.stringify(knobs)}`);
  }
  if (DRY) return;

  const results = await Promise.allSettled(chosen.map((v) => render(v, inputs[v], stamp)));
  for (const r of results) if (r.status === "rejected") console.error(String(r.reason));
  if (results.some((r) => r.status === "rejected")) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
