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
  /**
   * How hard the IP-Adapter pulls the render toward her face. Read by the
   * FaceID graph only; the stock graph has no node to use it.
   *
   * Past about 0.9 the likeness starts overriding the prompt — the pose and the
   * expression drift back toward the reference photo — and below about 0.5 it
   * is a suggestion rather than an identity.
   */
  ipaWeight: number;
  /** Strength of the FaceID LoRA that ships with the adapter. */
  ipaLora: number;
  /** The adapter preset, e.g. "FACEID PLUS V2". */
  faceidPreset: string;
  /**
   * Denoise for the FaceDetailer pass. It re-renders the cropped face, so this
   * is how much of the original face it is allowed to discard: around 0.5 fixes
   * a smudge, past ~0.7 it starts inventing a different person.
   */
  faceDenoise: number;
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

// The identity graph: the stock one, plus IP-Adapter FaceID for likeness and a
// FaceDetailer pass for the face.
//
// OPT-IN, and deliberately not the default. Every node past the stock seven has
// to be installed in the worker image, so making this the default would take
// every endpoint without ComfyUI_IPAdapter_plus, ComfyUI-Impact-Pack and
// ComfyUI-Impact-Subpack from working to failing on the first job. Set
// COMFY_GRAPH=faceid once the image has them. scripts/comfy-worker-build.sh
// builds and pushes that image; it carries the nodes, and it downloads the
// model weights onto the network volume on its first boot.
//
// The subpack is a separate install and the easiest thing to miss:
// UltralyticsDetectorProvider was split out of the main Impact Pack, so without
// it node 14 has no detector to take a face bbox from.
//
// What it adds over DEFAULT_WORKFLOW:
//
//   10 LoadImage                    her portrait, uploaded as {{REFERENCE_IMAGE}}
//   11 IPAdapterUnifiedLoaderFaceID the FaceID model + its LoRA
//   12 IPAdapterFaceID              conditions the MODEL on her face
//   13 UltralyticsDetectorProvider  the face bbox detector
//   14 FaceDetailer                 re-renders the face at its own resolution
//
// The identity conditioning is applied to the MODEL, so node 3's `model` input
// moves from the checkpoint (4) to the IPAdapter output (12). Everything else —
// the two text encodes, the latent, the decode — is wired exactly as before.
//
// FaceDetailer sits between the decode and the save, so node 9 takes its image
// from 14 rather than 8. At 832x1216 a full-length body leaves the face a few
// dozen pixels; this crops it, re-renders it at guide_size and composites it
// back, which is the difference between a likeness and a smudge.
export const FACEID_WORKFLOW = `{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "seed": "{{SEED}}",
      "steps": "{{STEPS}}",
      "cfg": "{{CFG}}",
      "sampler_name": "{{SAMPLER}}",
      "scheduler": "{{SCHEDULER}}",
      "denoise": "{{DENOISE}}",
      "model": ["12", 0],
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
  "10": {
    "class_type": "LoadImage",
    "inputs": { "image": "{{REFERENCE_IMAGE}}", "upload": "image" }
  },
  "11": {
    "class_type": "IPAdapterUnifiedLoaderFaceID",
    "inputs": {
      "model": ["4", 0],
      "preset": "{{FACEID_PRESET}}",
      "lora_strength": "{{IPA_LORA}}",
      "provider": "CPU"
    }
  },
  "12": {
    "class_type": "IPAdapterFaceID",
    "inputs": {
      "model": ["11", 0],
      "ipadapter": ["11", 1],
      "image": ["10", 0],
      "weight": "{{IPA_WEIGHT}}",
      "weight_faceidv2": "{{IPA_WEIGHT}}",
      "weight_type": "linear",
      "combine_embeds": "concat",
      "start_at": 0,
      "end_at": 1,
      "embeds_scaling": "V only"
    }
  },
  "13": {
    "class_type": "UltralyticsDetectorProvider",
    "inputs": { "model_name": "bbox/face_yolov8m.pt" }
  },
  "14": {
    "class_type": "FaceDetailer",
    "inputs": {
      "image": ["8", 0],
      "model": ["12", 0],
      "clip": ["4", 1],
      "vae": ["4", 2],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "bbox_detector": ["13", 0],
      "guide_size": 512,
      "guide_size_for": true,
      "max_size": 1024,
      "seed": "{{SEED}}",
      "steps": "{{STEPS}}",
      "cfg": "{{CFG}}",
      "sampler_name": "{{SAMPLER}}",
      "scheduler": "{{SCHEDULER}}",
      "denoise": "{{FACE_DENOISE}}",
      "feather": 5,
      "noise_mask": true,
      "force_inpaint": true,
      "bbox_threshold": 0.5,
      "bbox_dilation": 10,
      "bbox_crop_factor": 3.0,
      "sam_detection_hint": "center-1",
      "sam_dilation": 0,
      "sam_threshold": 0.93,
      "sam_bbox_expansion": 0,
      "sam_mask_hint_threshold": 0.7,
      "sam_mask_hint_use_negative": "False",
      "drop_size": 10,
      "wildcard": "",
      "cycle": 1
    }
  },
  "9": {
    "class_type": "SaveImage",
    "inputs": { "filename_prefix": "humancrush", "images": ["14", 0] }
  }
}`;

// The identity graph that needs NOTHING installed.
//
// Reported as "no model generates the same character in the chat" — every
// render a different stranger, because the stock graph starts from an empty
// latent and nothing in it has ever seen this companion.
//
// FACEID_WORKFLOW above solves that properly, and needs three custom node packs
// and a rebuilt worker image before it will run at all. This one solves most of
// it with core ComfyUI nodes only — LoadImage, ImageScale, VAEEncode are in
// every install, including the stock runpod/worker-comfyui — so it works on the
// endpoint as it stands today.
//
// How: her portrait is encoded into the starting latent instead of noise, and
// the sampler denoises from THERE. Her face, colouring and build survive
// because they are what the sampler starts from; the prompt moves the pose, the
// wardrobe and the setting. It is the same trick the Kontext path uses, run on
// the uncensored checkpoint instead.
//
// DENOISE is the dial and the whole thing turns on it. At 1.0 the portrait is
// erased and this becomes the stock graph with extra steps. Around 0.7 keeps
// her and still follows the prompt. Below about 0.5 the prompt stops being able
// to undress her or change the pose, because too much of the original survives.
//
// The trade this makes honestly: the portrait's composition leans on the
// result. A head-and-shoulders portrait resists a full-body pose. That is the
// cost of identity without the custom nodes, and it is a better cost than a
// stranger every time.
export const IMG2IMG_WORKFLOW = `{
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
      "latent_image": ["12", 0]
    }
  },
  "4": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": { "ckpt_name": "{{CHECKPOINT}}" }
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
  "10": {
    "class_type": "LoadImage",
    "inputs": { "image": "{{REFERENCE_IMAGE}}", "upload": "image" }
  },
  "11": {
    "class_type": "ImageScale",
    "inputs": {
      "image": ["10", 0],
      "upscale_method": "lanczos",
      "width": "{{WIDTH}}",
      "height": "{{HEIGHT}}",
      "crop": "center"
    }
  },
  "12": {
    "class_type": "VAEEncode",
    "inputs": { "pixels": ["11", 0], "vae": ["4", 2] }
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
    IPA_WEIGHT: vars.ipaWeight,
    IPA_LORA: vars.ipaLora,
    FACEID_PRESET: vars.faceidPreset,
    FACE_DENOISE: vars.faceDenoise,
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

/**
 * The template in use, most specific first: an explicit graph, then a built-in
 * one by name, then the stock graph.
 *
 * COMFY_GRAPH=faceid selects FACEID_WORKFLOW. It stays opt-in because the nodes
 * it needs are not in the stock worker image, and a graph naming a class the
 * worker does not have fails every job rather than degrading.
 */
export function comfyTemplate(): string {
  const override = (process.env.COMFY_WORKFLOW_JSON ?? "").trim();
  if (override) return override;
  const named = (process.env.COMFY_GRAPH ?? "").trim().toLowerCase();
  if (named === "faceid") return FACEID_WORKFLOW;
  // Needs no custom nodes, so unlike faceid it can be switched on against the
  // endpoint exactly as it stands.
  if (named === "img2img") return IMG2IMG_WORKFLOW;
  return DEFAULT_WORKFLOW;
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

/**
 * A numeric setting, falling back to its default when the env var is missing
 * OR unusable.
 *
 * Number() turns anything it cannot parse into NaN, JSON.stringify turns NaN
 * into null, and ComfyUI rejects null where it wants a float — so a typo in one
 * env var surfaces as a validation error on a node that is wired correctly.
 * That is a long way from the cause. It has already happened once: the FaceID
 * preset string was pasted into COMFY_IPA_LORA, which is parsed as a number.
 *
 * Falling back and saying so in the log keeps renders working while the
 * mistake is visible to whoever reads the log.
 */
function numberSetting(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  // Strips quotes people paste in from a shell snippet: a dashboard stores the
  // value verbatim, so "0.6" arrives with its quote marks attached.
  const n = Number(raw.replace(/^["']|["']$/g, ""));
  if (Number.isFinite(n)) return n;
  console.warn(`[comfy] ${name}="${raw}" is not a number — falling back to ${fallback}`);
  return fallback;
}

export function comfySettings(
  prompt = "",
  opts: { promptSetsComposition?: boolean } = {},
): Omit<ComfyVars, "prompt" | "negative" | "referenceImage"> {
  return {
    seed: seedFor(prompt),
    steps: numberSetting("COMFY_STEPS", 30),
    // 7, up from 5. Five is loose for SDXL and the reported failure was the
    // render ignoring what the prompt asked for; 6.5-7.5 is the band where an
    // SDXL photoreal checkpoint follows the text without going contrasty and
    // over-baked, which is what happens past about 8.
    cfg: numberSetting("COMFY_CFG", 7),
    width: numberSetting("COMFY_WIDTH", 832),
    height: numberSetting("COMFY_HEIGHT", 1216),
    sampler: process.env.COMFY_SAMPLER || "dpmpp_2m_sde",
    scheduler: process.env.COMFY_SCHEDULER || "karras",
    checkpoint: process.env.COMFY_CHECKPOINT || "",
    // 1 means "ignore the starting latent entirely", which is correct for a
    // text-to-image graph and destroys the point of an image-to-image one: at
    // 1.0 img2img erases her portrait and renders the same stranger the stock
    // graph does. 0.72 keeps her face and colouring while leaving the prompt
    // enough room to change the pose and the wardrobe.
    // 0.72 was chosen to "leave the prompt enough room to change the pose and
    // the wardrobe". It does not. At 0.72 img2img keeps the REFERENCE's whole
    // composition, not just her face: a request to sit with a toy came back as
    // the standing full-body studio shot her portrait already was, with no toy
    // in it at all. The prompt said "framed from her chin down to her knees"
    // and the render was head to feet, because the starting latent outvoted it.
    //
    // A toy is worse than a pose. A pose is a rearrangement of what the
    // reference already contains; an object that is not in the reference has to
    // be invented, and at 0.72 there is not enough denoising left to invent it.
    //
    // So when the request composes the picture itself — names a prop, a posture
    // or a viewpoint — the prompt has to win, and denoise goes high. When it is
    // a plain "send me a selfie" the reference should win, and it stays low.
    // There is no single value that does both, which is what FaceID is for:
    // it anchors identity without anchoring composition.
    denoise: numberSetting(
      opts.promptSetsComposition ? "COMFY_DENOISE_POSED" : "COMFY_DENOISE",
      (process.env.COMFY_GRAPH ?? "").trim().toLowerCase() === "img2img"
        ? opts.promptSetsComposition
          ? 0.92
          : 0.72
        : 1,
    ),
    // Read for every graph and used only by the one that has the nodes. Cheaper
    // than a second settings function, and it means switching COMFY_GRAPH needs
    // no other change.
    ipaWeight: numberSetting("COMFY_IPA_WEIGHT", 0.75),
    ipaLora: numberSetting("COMFY_IPA_LORA", 0.6),
    faceidPreset: process.env.COMFY_FACEID_PRESET || "FACEID PLUS V2",
    faceDenoise: numberSetting("COMFY_FACE_DENOISE", 0.5),
  };
}
