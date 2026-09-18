// A ComfyUI serverless endpoint, which is the only way this app gets explicit
// photos that are actually photos.
//
// Everything else renders a chat photo as one frame cut out of a five-second
// WAN clip, because that endpoint is the only uncensored model on the account.
// A video model painting a nude over a clothed portrait at 480-640 lines has a
// ceiling, and the ceiling is what users describe as "weird" and "not real":
// the anatomy gets a few dozen pixels, the pose is still resolving, and the
// frame we keep is the least smeared of fifteen rather than a good one.
//
// A ComfyUI worker running an uncensored SDXL checkpoint renders a still at
// 832x1216 in one pass, with the sampler, the steps and the guidance the
// checkpoint was tuned for. That is the difference in kind.
//
// THE WORKFLOW IS DATA, NOT CODE. Which nodes exist depends entirely on what
// is installed in the worker image — an IPAdapter graph is meaningless to an
// endpoint without IPAdapter, and a checkpoint name is a filename on someone's
// network volume. So the graph is a template with placeholders, the built-in
// one is the smallest thing that runs on the stock worker, and COMFY_WORKFLOW_
// JSON replaces it with whatever that endpoint actually has. See
// docs/uncensored-image-endpoint.md.

/** Values substituted into the workflow template. */
export type ComfyVars = {
  prompt: string;
  negative: string;
  seed: number;
  steps: number;
  cfg: number;
  width: number;
  height: number;
  sampler: string;
  scheduler: string;
  checkpoint: string;
  denoise: number;
  /** Filename of the reference portrait uploaded alongside the job, if any. */
  referenceImage?: string;
};

// The stock graph: SDXL checkpoint, two text encodes, a sampler, a decode, a
// save. Nothing else, because every extra node is another thing that has to be
// installed in the worker image for the job to run at all.
//
// It carries no identity. A checkpoint cannot know what this companion looks
// like, so on its own this renders a beautiful stranger — which this codebase
// considers its worst failure mode, and which is why the reference image and
// the identity notes in the docs matter. Replace this with an IPAdapter FaceID,
// InstantID or PuLID export from your own ComfyUI once those nodes are in the
// image; {{REFERENCE_IMAGE}} is the filename to feed the LoadImage node.
export const DEFAULT_WORKFLOW = `{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "seed": "{{SEED}}",
      "steps": "{{STEPS}}",
      "cfg": "{{CFG}}",
      "sampler_name": "{{SAMPLER}}",
      "scheduler": "{{SCHEDULER}}",
      "denoise": "{{DENOISE}}",
      "model": ["4", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["5", 0]
    }
  },
  "4": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": { "ckpt_name": "{{CHECKPOINT}}" }
  },
  "5": {
    "class_type": "EmptyLatentImage",
    "inputs": { "width": "{{WIDTH}}", "height": "{{HEIGHT}}", "batch_size": 1 }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "{{PROMPT}}", "clip": ["4", 1] }
  },
  "7": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "{{NEGATIVE}}", "clip": ["4", 1] }
  },
  "8": {
    "class_type": "VAEDecode",
    "inputs": { "samples": ["3", 0], "vae": ["4", 2] }
  },
  "9": {
    "class_type": "SaveImage",
    "inputs": { "filename_prefix": "humancrush", "images": ["8", 0] }
  }
}`;

const TOKEN_RE = /\{\{([A-Z_]+)\}\}/g;

function tokenValues(vars: ComfyVars): Record<string, string | number> {
  return {
    PROMPT: vars.prompt,
    NEGATIVE: vars.negative,
    SEED: vars.seed,
    STEPS: vars.steps,
    CFG: vars.cfg,
    WIDTH: vars.width,
    HEIGHT: vars.height,
    SAMPLER: vars.sampler,
    SCHEDULER: vars.scheduler,
    CHECKPOINT: vars.checkpoint,
    DENOISE: vars.denoise,
    REFERENCE_IMAGE: vars.referenceImage ?? "",
  };
}

/**
 * The workflow this job actually runs.
 *
 * A placeholder standing alone as the whole string ("seed": "{{SEED}}") is
 * replaced by the VALUE, so a number stays a number — ComfyUI validates input
 * types and rejects a seed of "12345" as a string. A placeholder inside a
 * longer string is substituted in place, so a filename_prefix can carry one.
 *
 * An unknown placeholder throws rather than being left in the graph. A
 * workflow that reaches the sampler with the literal text "{{PROMPT}}" renders
 * a picture of nothing anyone asked for and bills the user for it; a job that
 * never launches is refunded and says why.
 */
export function comfyWorkflow(vars: ComfyVars, template = DEFAULT_WORKFLOW): unknown {
  let graph: unknown;
  try {
    graph = JSON.parse(template);
  } catch (e: any) {
    throw new Error(`COMFY workflow is not valid JSON: ${e.message}`);
  }
  const values = tokenValues(vars);

  const substitute = (node: unknown): unknown => {
    if (typeof node === "string") {
      const whole = node.match(/^\{\{([A-Z_]+)\}\}$/);
      if (whole) {
        const v = values[whole[1]];
        if (v === undefined) throw new Error(`Unknown workflow placeholder {{${whole[1]}}}`);
        return v;
      }
      return node.replace(TOKEN_RE, (_, name: string) => {
        const v = values[name];
        if (v === undefined) throw new Error(`Unknown workflow placeholder {{${name}}}`);
        return String(v);
      });
    }
    if (Array.isArray(node)) return node.map(substitute);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, substitute(v)]));
    }
    return node;
  };

  return substitute(graph);
}

/** Whether this template wants the companion's portrait uploaded with the job. */
export function wantsReference(template = DEFAULT_WORKFLOW): boolean {
  return template.includes("{{REFERENCE_IMAGE}}");
}

/** The name the reference portrait is saved under in the worker's input folder. */
export const REFERENCE_NAME = "reference.png";

/**
 * The job body: the graph, plus the reference portrait as base64 when the
 * graph asks for one.
 *
 * The worker writes each entry of `images` into ComfyUI's input folder under
 * its `name`, which is exactly what a LoadImage node reads.
 */
export function comfyInput(
  vars: ComfyVars,
  opts: { template?: string; referenceBase64?: string } = {},
): Record<string, unknown> {
  const template = opts.template ?? DEFAULT_WORKFLOW;
  const needsRef = wantsReference(template);
  if (needsRef && !opts.referenceBase64) {
    throw new Error("This workflow needs a reference image and none was supplied");
  }
  // Caught here rather than by the worker. An empty ckpt_name is a validation
  // error inside ComfyUI, which comes back as a failed job minutes later; this
  // fails the launch, which refunds immediately and names the missing setting.
  if (template.includes("{{CHECKPOINT}}") && !vars.checkpoint) {
    throw new Error("COMFY_CHECKPOINT is not set — the workflow has no checkpoint to load");
  }
  const workflow = comfyWorkflow(
    { ...vars, referenceImage: needsRef ? REFERENCE_NAME : vars.referenceImage },
    template,
  );
  return needsRef
    ? { workflow, images: [{ name: REFERENCE_NAME, image: opts.referenceBase64 }] }
    : { workflow };
}

/**
 * The finished picture, as something completeMediaJob can fetch.
 *
 * The worker returns base64 by default and an S3 URL when the endpoint has a
 * bucket configured, so both are handled: base64 becomes a data: URL, which
 * fetch() reads natively and which the storage step then uploads like any
 * other download.
 *
 * `errors` is deliberately not fatal on its own. The worker puts non-fatal node
 * warnings there too, and a picture that rendered with a warning is still the
 * picture the user paid for; only the absence of an image fails the job.
 */
export function comfyImageUrl(output: any): string | null {
  const images = output?.images;
  if (!Array.isArray(images)) return null;
  for (const img of images) {
    const data = typeof img?.data === "string" ? img.data.trim() : "";
    if (!data) continue;
    if (img.type === "base64") {
      const mime = /\.jpe?g$/i.test(img.filename ?? "") ? "image/jpeg" : "image/png";
      return `data:${mime};base64,${data}`;
    }
    if (/^https?:/i.test(data)) return data;
  }
  return null;
}

/** What went wrong, when nothing came back. */
export function comfyError(output: any): string | null {
  const errors = output?.errors;
  if (Array.isArray(errors) && errors.length) return errors.map(String).join("; ").slice(0, 300);
  return null;
}

// ── Settings ────────────────────────────────────────────────────────────────
//
// Read here rather than at each call site so one function says what a still
// costs in steps and pixels, and so the test can set them.

/** The template in use: the env override if present, else the built-in. */
export function comfyTemplate(): string {
  const override = (process.env.COMFY_WORKFLOW_JSON ?? "").trim();
  return override || DEFAULT_WORKFLOW;
}

/**
 * 832x1216 is SDXL's own portrait bucket — the aspect it was trained on, and
 * the one place where asking for more pixels costs nothing in coherence. It is
 * also about three times the pixels a WAN frame gave the same body.
 */
/**
 * A seed derived from the prompt, so the same prompt renders the same picture.
 *
 * It used to be Math.random() on every job, which makes each render an
 * independent draw: ask for the same thing twice and the second is unrelated to
 * the first, so one comes back good and one does not for no reason the user can
 * see or influence. "The first picture is good, the second wasn't" is that.
 *
 * FNV-1a, folded to 31 bits. Any stable hash would do — what matters is that it
 * is a pure function of the prompt and never of the clock.
 *
 * Set COMFY_SEED to pin one value across every render, or COMFY_SEED=random to
 * put the old per-job lottery back.
 */
export function seedFor(prompt: string): number {
  const pinned = (process.env.COMFY_SEED ?? "").trim();
  if (pinned && pinned.toLowerCase() !== "random") {
    const n = Number(pinned);
    if (Number.isFinite(n)) return Math.abs(Math.floor(n)) % 2 ** 31;
  }
  if (pinned.toLowerCase() === "random") return Math.floor(Math.random() * 2 ** 31);

  let h = 0x811c9dc5;
  for (let i = 0; i < prompt.length; i++) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % 2 ** 31;
}

export function comfySettings(
  prompt = "",
): Omit<ComfyVars, "prompt" | "negative" | "referenceImage"> {
  return {
    seed: seedFor(prompt),
    steps: Number(process.env.COMFY_STEPS || "30"),
    cfg: Number(process.env.COMFY_CFG || "5"),
    width: Number(process.env.COMFY_WIDTH || "832"),
    height: Number(process.env.COMFY_HEIGHT || "1216"),
    sampler: process.env.COMFY_SAMPLER || "dpmpp_2m_sde",
    scheduler: process.env.COMFY_SCHEDULER || "karras",
    checkpoint: process.env.COMFY_CHECKPOINT || "",
    denoise: Number(process.env.COMFY_DENOISE || "1"),
  };
}
