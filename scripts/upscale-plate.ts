// Upscale a banner plate before compositing.
//
//   npx vite-node --config vitest.config.ts scripts/upscale-plate.ts -- couch 4 clarity
//   npx vite-node --config vitest.config.ts scripts/upscale-plate.ts -- couch 4 esrgan
//
// The explicit plates come off the RunPod image-to-video endpoint at 640x640,
// which is the endpoint's output size and not something a parameter changes. A
// 970x250 billboard needs ~545px of photo width and a 300x600 half page needs
// 600px of height, so the compositor was upscaling every wide and tall unit and
// the softness showed. Real-ESRGAN is deterministic and does not repaint the
// subject, so the plate keeps the face it was generated with.
//
// Output goes to <name>-hi.png beside the original; the generator prefers it
// when present, so a missing upscale degrades to the native plate rather than
// breaking the run.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

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

const PLATES = "marketing/adult-explicit/plates";

// Two upscalers, and the difference matters more than the scale number does.
//
// Real-ESRGAN interpolates: it makes the plate bigger and slightly cleaner, but
// it cannot add detail that is not in the 640px source, so the result is a large
// soft image. Clarity re-diffuses the image tile by tile and invents plausible
// skin texture, hair and fabric, which is what actually reads as sharp. It costs
// more and takes longer, and because it is generative it can drift the face —
// `resemblance` is held high to stop that.
//
// Neither is a route to "8K". The widest ad unit here is 970px, so a 2560px
// plate is already oversampled; past that, more pixels buy nothing and only the
// detail matters.
const MODELS = {
  esrgan: "nightmareai/real-esrgan",
  clarity: "philz1337x/clarity-upscaler",
} as const;

export type UpscaleModel = keyof typeof MODELS;

export async function upscalePlate(
  name: string,
  scale = 4,
  model: UpscaleModel = "clarity",
): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN missing from .env.local");

  const srcPath = `${PLATES}/${name}.png`;
  if (!existsSync(srcPath)) throw new Error(`no plate at ${srcPath}`);
  const src = readFileSync(srcPath);
  const image = `data:image/png;base64,${src.toString("base64")}`;

  const input =
    model === "clarity"
      ? {
          image,
          scale_factor: scale,
          // Low creativity and high resemblance: this is a likeness that has to
          // survive, not a reinterpretation. Enough denoise to build texture,
          // not enough to redraw her.
          creativity: 0.25,
          resemblance: 0.85,
          dynamic: 6,
          sharpen: 0.5,
          output_format: "png",
          prompt:
            "highly detailed photograph, sharp focus, natural skin texture with visible pores, fine hair detail, realistic fabric weave",
        }
      : {
          image,
          scale,
          // Face enhancement repaints the face, which loses the likeness the
          // plate was generated to carry.
          face_enhance: false,
        };

  // Community models are not exposed on /v1/models/<owner>/<name>/predictions —
  // that route 404s and is only for Replicate's own blessed models. They are
  // run by version id through /v1/predictions instead, so the version is looked
  // up first rather than pinned here and left to rot.
  let res: Response;
  if (model === "clarity") {
    const meta = await fetch(`https://api.replicate.com/v1/models/${MODELS[model]}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meta.ok) throw new Error(`could not look up ${MODELS[model]} (${meta.status})`);
    const version = (await meta.json())?.latest_version?.id;
    if (!version) throw new Error(`${MODELS[model]} has no published version`);

    res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({ version, input }),
      signal: AbortSignal.timeout(600_000),
    });
  } else {
    res = await fetch(`https://api.replicate.com/v1/models/${MODELS[model]}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(600_000),
    });
  }

  const json: any = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  const url = typeof json.output === "string" ? json.output : json.output?.[0];
  if (!url) throw new Error(`no output (${json.status}) ${json.error ?? ""}`);

  const img = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!img.ok) throw new Error(`could not fetch result (${img.status})`);
  const buf = Buffer.from(await img.arrayBuffer());
  const out = `${PLATES}/${name}-hi.png`;
  writeFileSync(out, buf);
  return out;
}

const [name, scaleArg, modelArg] = process.argv.slice(2).filter((a) => a !== "--");
if (name) {
  upscalePlate(name, Number(scaleArg ?? 4), (modelArg as UpscaleModel) ?? "clarity")
    .then((p) => console.log("saved", p))
    .catch((e) => {
      console.error("upscale failed:", e?.message ?? e);
      process.exit(1);
    });
}
