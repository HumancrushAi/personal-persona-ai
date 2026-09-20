import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_WORKFLOW,
  REFERENCE_NAME,
  comfyError,
  comfyImageUrl,
  comfyInput,
  comfyWorkflow,
  wantsReference,
  type ComfyVars,
} from "../comfy";

const VARS: ComfyVars = {
  prompt: "a photograph",
  negative: "blurry",
  seed: 12345,
  steps: 30,
  cfg: 5,
  width: 832,
  height: 1216,
  sampler: "dpmpp_2m_sde",
  scheduler: "karras",
  checkpoint: "lustify.safetensors",
  denoise: 1,
  ipaWeight: 0.75,
  ipaLora: 0.6,
  faceidPreset: "FACEID PLUS V2",
  faceDenoise: 0.5,
};

// ComfyUI validates the TYPE of every input before it runs anything, so a seed
// that arrives as the string "12345" fails the whole job. Substitution has to
// preserve numbers, which is the one thing a naive string replace gets wrong.
describe("comfyWorkflow", () => {
  it("keeps a numeric placeholder a number", () => {
    const g = comfyWorkflow(VARS) as any;
    expect(g["3"].inputs.seed).toBe(12345);
    expect(g["3"].inputs.steps).toBe(30);
    expect(g["5"].inputs.width).toBe(832);
    expect(typeof g["3"].inputs.cfg).toBe("number");
  });

  it("puts the prompt and the negative in their own encoders", () => {
    const g = comfyWorkflow(VARS) as any;
    expect(g["6"].inputs.text).toBe("a photograph");
    expect(g["7"].inputs.text).toBe("blurry");
    expect(g["4"].inputs.ckpt_name).toBe("lustify.safetensors");
  });

  it("leaves the node wiring alone", () => {
    const g = comfyWorkflow(VARS) as any;
    expect(g["3"].inputs.model).toEqual(["4", 0]);
    expect(g["8"].inputs.samples).toEqual(["3", 0]);
  });

  it("substitutes a placeholder embedded in a longer string", () => {
    const t = `{"1":{"class_type":"SaveImage","inputs":{"filename_prefix":"hc-{{SEED}}"}}}`;
    expect((comfyWorkflow(VARS, t) as any)["1"].inputs.filename_prefix).toBe("hc-12345");
  });

  // A graph that reaches the sampler with the literal text "{{PROMPT}}" in it
  // renders a picture of nothing anyone asked for and bills the user for it.
  it("refuses a placeholder it cannot fill", () => {
    const t = `{"1":{"class_type":"KSampler","inputs":{"text":"{{NOT_A_THING}}"}}}`;
    expect(() => comfyWorkflow(VARS, t)).toThrow(/NOT_A_THING/);
  });

  it("says so when the workflow is not JSON", () => {
    expect(() => comfyWorkflow(VARS, "{ not json")).toThrow(/not valid JSON/i);
  });
});

describe("comfyInput", () => {
  it("sends just the graph when the workflow asks for no reference", () => {
    const input = comfyInput(VARS) as any;
    expect(input.workflow).toBeTruthy();
    expect(input.images).toBeUndefined();
    expect(wantsReference(DEFAULT_WORKFLOW)).toBe(false);
  });

  it("attaches the portrait under the name the graph loads", () => {
    const t = `{"1":{"class_type":"LoadImage","inputs":{"image":"{{REFERENCE_IMAGE}}"}}}`;
    const input = comfyInput(VARS, { template: t, referenceBase64: "AAA" }) as any;
    expect(input.images).toEqual([{ name: REFERENCE_NAME, image: "AAA" }]);
    expect(input.workflow["1"].inputs.image).toBe(REFERENCE_NAME);
  });

  it("refuses to launch a reference workflow with no reference", () => {
    const t = `{"1":{"class_type":"LoadImage","inputs":{"image":"{{REFERENCE_IMAGE}}"}}}`;
    expect(() => comfyInput(VARS, { template: t })).toThrow(/needs a reference image/i);
  });

  // The checkpoint is a filename on someone's network volume, so an unset
  // COMFY_CHECKPOINT is the likeliest misconfiguration there is. Failing at
  // launch refunds immediately instead of failing inside the worker minutes on.
  it("refuses to launch with no checkpoint", () => {
    expect(() => comfyInput({ ...VARS, checkpoint: "" })).toThrow(/COMFY_CHECKPOINT/);
  });
});

describe("comfyImageUrl", () => {
  it("turns a base64 image into a data URL the storage step can fetch", () => {
    const url = comfyImageUrl({
      images: [{ filename: "ComfyUI_00001_.png", type: "base64", data: "QUJD" }],
    });
    expect(url).toBe("data:image/png;base64,QUJD");
  });

  it("uses the S3 URL when the endpoint has a bucket", () => {
    const url = comfyImageUrl({
      images: [
        { filename: "x.png", type: "s3_url", data: "https://bucket.s3.amazonaws.com/x.png" },
      ],
    });
    expect(url).toBe("https://bucket.s3.amazonaws.com/x.png");
  });

  it("reads the jpeg filename as jpeg", () => {
    expect(comfyImageUrl({ images: [{ filename: "x.jpg", type: "base64", data: "QQ" }] })).toMatch(
      /^data:image\/jpeg;base64,/,
    );
  });

  it("skips an empty entry and takes the next real one", () => {
    const url = comfyImageUrl({
      images: [
        { filename: "a.png", type: "base64", data: "  " },
        { filename: "b.png", type: "base64", data: "QUJD" },
      ],
    });
    expect(url).toBe("data:image/png;base64,QUJD");
  });

  it("returns nothing for output that carries no image", () => {
    expect(comfyImageUrl({ errors: ["boom"] })).toBe(null);
    expect(comfyImageUrl({ chunk_urls: ["https://x/y.mp4"] })).toBe(null);
    expect(comfyImageUrl(null)).toBe(null);
  });
});

// A render that produced a picture AND a warning is still the picture the user
// paid for, so errors only matter when there is no image.
describe("comfyError", () => {
  it("reports what the worker complained about", () => {
    expect(comfyError({ errors: ["Node ReActor not found"] })).toMatch(/ReActor/);
  });

  it("is quiet when nothing went wrong", () => {
    expect(comfyError({ images: [] })).toBe(null);
    expect(comfyError({ errors: [] })).toBe(null);
  });
});

// "The first ass picture is good, the second wasn't."
//
// The seed was Math.random() on every job, so two renders of the same request
// were independent draws — the second had nothing to do with the first, and
// which one came back good was luck the user could neither see nor influence.
describe("seedFor", () => {
  const real = process.env.COMFY_SEED;
  afterEach(() => {
    if (real === undefined) delete process.env.COMFY_SEED;
    else process.env.COMFY_SEED = real;
  });

  it("gives the same prompt the same seed every time", async () => {
    const { seedFor } = await import("../comfy");
    delete process.env.COMFY_SEED;
    const p = "exact same woman as the reference image, completely nude, on all fours";
    expect(seedFor(p)).toBe(seedFor(p));
  });

  it("gives different prompts different seeds", async () => {
    const { seedFor } = await import("../comfy");
    delete process.env.COMFY_SEED;
    expect(seedFor("standing by the window")).not.toBe(seedFor("lying on the bed"));
  });

  it("stays inside the 31-bit range the workflow expects", async () => {
    const { seedFor } = await import("../comfy");
    delete process.env.COMFY_SEED;
    for (const p of ["", "a", "a much longer prompt ".repeat(40), "🙂 emoji and ünïcode"]) {
      const s = seedFor(p);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 31);
    }
  });

  it("can be pinned to one value across every prompt", async () => {
    const { seedFor } = await import("../comfy");
    process.env.COMFY_SEED = "12345";
    expect(seedFor("one prompt")).toBe(12345);
    expect(seedFor("a different prompt")).toBe(12345);
  });

  it("can be put back to the old per-job lottery", async () => {
    const { seedFor } = await import("../comfy");
    process.env.COMFY_SEED = "random";
    const p = "the same prompt both times";
    const draws = new Set([seedFor(p), seedFor(p), seedFor(p), seedFor(p), seedFor(p)]);
    expect(draws.size).toBeGreaterThan(1);
  });
});

// The identity graph. The stock one renders "a beautiful stranger" by its own
// comment — nothing in it knows what this companion looks like — so this is the
// graph that carries her likeness.
//
// These assert WIRING, because a mis-wired graph does not throw: ComfyUI happily
// runs a KSampler still pointed at the bare checkpoint and returns a perfectly
// good picture of someone else, which is the failure this whole file exists to
// prevent and the one nobody notices in a diff.
describe("FACEID_WORKFLOW", () => {
  const vars = { ...VARS };

  it("is valid JSON", async () => {
    const { FACEID_WORKFLOW } = await import("../comfy");
    expect(() => JSON.parse(FACEID_WORKFLOW)).not.toThrow();
  });

  it("asks for the reference portrait, so the upload path turns on", async () => {
    const { FACEID_WORKFLOW, wantsReference } = await import("../comfy");
    expect(wantsReference(FACEID_WORKFLOW)).toBe(true);
  });

  it("feeds the sampler from the IPAdapter, not straight from the checkpoint", async () => {
    const { FACEID_WORKFLOW, comfyWorkflow } = await import("../comfy");
    const g = comfyWorkflow({ ...vars, referenceImage: "reference.png" }, FACEID_WORKFLOW) as any;
    // 12 is IPAdapterFaceID. Pointing this at 4 would render a stranger.
    expect(g["3"].inputs.model).toEqual(["12", 0]);
    expect(g["12"].class_type).toBe("IPAdapterFaceID");
  });

  it("feeds the IPAdapter from the loaded reference image", async () => {
    const { FACEID_WORKFLOW, comfyWorkflow } = await import("../comfy");
    const g = comfyWorkflow({ ...vars, referenceImage: "reference.png" }, FACEID_WORKFLOW) as any;
    expect(g["12"].inputs.image).toEqual(["10", 0]);
    expect(g["10"].class_type).toBe("LoadImage");
    expect(g["10"].inputs.image).toBe("reference.png");
  });

  it("saves the detailed face, not the raw decode", async () => {
    const { FACEID_WORKFLOW, comfyWorkflow } = await import("../comfy");
    const g = comfyWorkflow({ ...vars, referenceImage: "reference.png" }, FACEID_WORKFLOW) as any;
    // 14 is FaceDetailer, 8 is the VAEDecode it takes its input from.
    expect(g["9"].inputs.images).toEqual(["14", 0]);
    expect(g["14"].inputs.image).toEqual(["8", 0]);
  });

  it("keeps numbers as numbers through substitution", async () => {
    const { FACEID_WORKFLOW, comfyWorkflow } = await import("../comfy");
    const g = comfyWorkflow({ ...vars, referenceImage: "reference.png" }, FACEID_WORKFLOW) as any;
    // ComfyUI validates input types and rejects "0.75" where it wants a float.
    expect(typeof g["12"].inputs.weight).toBe("number");
    expect(typeof g["11"].inputs.lora_strength).toBe("number");
    expect(typeof g["14"].inputs.denoise).toBe("number");
    expect(typeof g["3"].inputs.cfg).toBe("number");
  });

  it("leaves no placeholder behind", async () => {
    const { FACEID_WORKFLOW, comfyWorkflow } = await import("../comfy");
    const g = comfyWorkflow({ ...vars, referenceImage: "reference.png" }, FACEID_WORKFLOW);
    expect(JSON.stringify(g)).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("refuses to launch without the portrait it needs", async () => {
    const { FACEID_WORKFLOW, comfyInput } = await import("../comfy");
    expect(() => comfyInput(vars, { template: FACEID_WORKFLOW })).toThrow(/reference image/i);
  });

  it("ships the portrait under the name LoadImage reads", async () => {
    const { FACEID_WORKFLOW, comfyInput, REFERENCE_NAME } = await import("../comfy");
    const body = comfyInput(vars, {
      template: FACEID_WORKFLOW,
      referenceBase64: "AAAA",
    }) as any;
    expect(body.images).toEqual([{ name: REFERENCE_NAME, image: "AAAA" }]);
    expect(body.workflow["10"].inputs.image).toBe(REFERENCE_NAME);
  });
});

// The stock graph stays the default: the nodes above are custom ones, and a
// graph naming a class the worker lacks fails every job rather than degrading.
describe("comfyTemplate selection", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("defaults to the stock graph, which needs no custom nodes", async () => {
    const { comfyTemplate, DEFAULT_WORKFLOW } = await import("../comfy");
    delete process.env.COMFY_GRAPH;
    delete process.env.COMFY_WORKFLOW_JSON;
    expect(comfyTemplate()).toBe(DEFAULT_WORKFLOW);
  });

  it("selects the identity graph by name", async () => {
    const { comfyTemplate, FACEID_WORKFLOW } = await import("../comfy");
    delete process.env.COMFY_WORKFLOW_JSON;
    process.env.COMFY_GRAPH = "faceid";
    expect(comfyTemplate()).toBe(FACEID_WORKFLOW);
  });

  it("lets an explicit graph win over the name", async () => {
    const { comfyTemplate } = await import("../comfy");
    process.env.COMFY_GRAPH = "faceid";
    process.env.COMFY_WORKFLOW_JSON = '{"1":{"class_type":"X","inputs":{}}}';
    expect(comfyTemplate()).toContain('"X"');
  });
});

// A settings typo must not reach the graph.
//
// Number() turns anything unparseable into NaN, JSON.stringify turns NaN into
// null, and ComfyUI rejects null where it wants a float — so one bad env var
// fails validation on a node that is wired perfectly. This happened for real:
// the FaceID preset string was pasted into COMFY_IPA_LORA, which is a number.
describe("numeric settings", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("falls back when the value is not a number", async () => {
    const { comfySettings } = await import("../comfy");
    process.env.COMFY_IPA_LORA = "FACEID PLUS V2";
    expect(comfySettings("p").ipaLora).toBe(0.6);
  });

  it("never lets NaN into the graph", async () => {
    const { comfySettings, comfyWorkflow, FACEID_WORKFLOW } = await import("../comfy");
    process.env.COMFY_IPA_WEIGHT = "oops";
    process.env.COMFY_CFG = "";
    const g = comfyWorkflow(
      {
        ...comfySettings("p"),
        prompt: "p",
        negative: "n",
        checkpoint: "c.safetensors",
        referenceImage: "reference.png",
      },
      FACEID_WORKFLOW,
    );
    expect(JSON.stringify(g)).not.toContain("null");
    expect(JSON.stringify(g)).not.toContain("NaN");
  });

  // A dashboard stores what you type, so a value copied out of a shell snippet
  // arrives with its quote marks attached.
  it("tolerates quotes pasted in from a shell snippet", async () => {
    const { comfySettings } = await import("../comfy");
    process.env.COMFY_IPA_WEIGHT = '"0.85"';
    expect(comfySettings("p").ipaWeight).toBe(0.85);
  });

  it("still reads a good value", async () => {
    const { comfySettings } = await import("../comfy");
    process.env.COMFY_CFG = "7.5";
    expect(comfySettings("p").cfg).toBe(7.5);
  });
});

// "No model generates the same character in the chat."
//
// The stock graph starts from an empty latent and nothing in it has ever seen
// this companion, so every render is a different stranger. FACEID_WORKFLOW
// fixes that properly and needs three custom node packs and a rebuilt worker
// image first. This one gets most of the way there with core ComfyUI nodes
// only, so it runs on the endpoint exactly as it stands.
describe("IMG2IMG_WORKFLOW", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  const vars = { ...VARS, referenceImage: REFERENCE_NAME };

  it("is valid JSON and asks for her portrait", async () => {
    const { IMG2IMG_WORKFLOW, wantsReference } = await import("../comfy");
    expect(() => JSON.parse(IMG2IMG_WORKFLOW)).not.toThrow();
    expect(wantsReference(IMG2IMG_WORKFLOW)).toBe(true);
  });

  // The whole point: the sampler starts from HER, not from noise.
  it("starts the sampler from her encoded portrait, not an empty latent", async () => {
    const { IMG2IMG_WORKFLOW, comfyWorkflow } = await import("../comfy");
    const g = comfyWorkflow(vars, IMG2IMG_WORKFLOW) as any;
    expect(g["3"].inputs.latent_image).toEqual(["12", 0]);
    expect(g["12"].class_type).toBe("VAEEncode");
    expect(g["12"].inputs.pixels).toEqual(["11", 0]);
    expect(g["11"].class_type).toBe("ImageScale");
    expect(g["11"].inputs.image).toEqual(["10", 0]);
    expect(g["10"].class_type).toBe("LoadImage");
    expect(JSON.stringify(g)).not.toContain("EmptyLatentImage");
  });

  // This is what makes it deployable today. Anything outside this list means a
  // rebuilt worker image, which is the thing this graph exists to avoid.
  it("uses only node classes that ship with stock ComfyUI", async () => {
    const { IMG2IMG_WORKFLOW, comfyWorkflow } = await import("../comfy");
    const g = comfyWorkflow(vars, IMG2IMG_WORKFLOW) as any;
    const CORE = [
      "KSampler",
      "CheckpointLoaderSimple",
      "CLIPTextEncode",
      "VAEDecode",
      "VAEEncode",
      "SaveImage",
      "LoadImage",
      "ImageScale",
    ];
    for (const node of Object.values(g) as any[]) {
      expect(CORE, `${node.class_type} is not a core node`).toContain(node.class_type);
    }
  });

  it("scales her portrait to the render size the checkpoint wants", async () => {
    const { IMG2IMG_WORKFLOW, comfyWorkflow } = await import("../comfy");
    const g = comfyWorkflow(vars, IMG2IMG_WORKFLOW) as any;
    expect(g["11"].inputs.width).toBe(832);
    expect(g["11"].inputs.height).toBe(1216);
    expect(typeof g["11"].inputs.width).toBe("number");
  });

  // At 1.0 the starting latent is erased and this renders the same stranger the
  // stock graph does — the whole graph becomes pointless with the wrong dial.
  it("defaults denoise below 1, so her portrait survives", async () => {
    const { comfySettings } = await import("../comfy");
    process.env.COMFY_GRAPH = "img2img";
    delete process.env.COMFY_DENOISE;
    const d = comfySettings("p").denoise;
    expect(d).toBeLessThan(1);
    expect(d).toBeGreaterThan(0.5);
  });

  it("leaves the text-to-image graph on full denoise", async () => {
    const { comfySettings } = await import("../comfy");
    delete process.env.COMFY_GRAPH;
    delete process.env.COMFY_DENOISE;
    expect(comfySettings("p").denoise).toBe(1);
  });

  it("is selected by name", async () => {
    const { comfyTemplate, IMG2IMG_WORKFLOW } = await import("../comfy");
    delete process.env.COMFY_WORKFLOW_JSON;
    process.env.COMFY_GRAPH = "img2img";
    expect(comfyTemplate()).toBe(IMG2IMG_WORKFLOW);
  });

  it("refuses to launch without the portrait it needs", async () => {
    const { IMG2IMG_WORKFLOW, comfyInput } = await import("../comfy");
    expect(() => comfyInput(VARS, { template: IMG2IMG_WORKFLOW })).toThrow(/reference image/i);
  });
});

// "send me a picture of you sticking a dildo in your pussy" came back as a
// standing full-body studio shot, rear view, with no toy in it.
//
// The prompt was correct — it named the toy, described it, and asked for
// chin-to-knees framing. The render ignored all of it, because at denoise 0.72
// img2img keeps the REFERENCE's composition, and her portrait is a standing
// full-body shot. The starting latent outvoted every word.
//
// A missing object is the sharper version of the same problem: a pose is a
// rearrangement of what the reference already holds, but a toy that is not in
// the reference has to be invented, and 0.72 leaves no room to invent it.
describe("denoise follows whoever is composing the picture", () => {
  const withGraph = async (fn: () => void) => {
    const prev = process.env.COMFY_GRAPH;
    const prevD = process.env.COMFY_DENOISE;
    const prevP = process.env.COMFY_DENOISE_POSED;
    process.env.COMFY_GRAPH = "img2img";
    delete process.env.COMFY_DENOISE;
    delete process.env.COMFY_DENOISE_POSED;
    try {
      fn();
    } finally {
      process.env.COMFY_GRAPH = prev;
      if (prevD === undefined) delete process.env.COMFY_DENOISE;
      else process.env.COMFY_DENOISE = prevD;
      if (prevP === undefined) delete process.env.COMFY_DENOISE_POSED;
      else process.env.COMFY_DENOISE_POSED = prevP;
    }
  };

  it("lets her portrait compose a request that says nothing about composition", async () => {
    const { comfySettings } = await import("../comfy");
    await withGraph(() => {
      expect(comfySettings("x", { promptSetsComposition: false }).denoise).toBe(0.72);
      expect(comfySettings("x").denoise).toBe(0.72);
    });
  });

  it("lets the prompt compose a request that names a prop, posture or viewpoint", async () => {
    const { comfySettings } = await import("../comfy");
    await withGraph(() => {
      expect(comfySettings("x", { promptSetsComposition: true }).denoise).toBe(0.92);
    });
  });

  // Text-to-image has no starting latent to preserve, so neither case applies.
  it("stays at 1 on a text-to-image graph", async () => {
    const { comfySettings } = await import("../comfy");
    const prev = process.env.COMFY_GRAPH;
    delete process.env.COMFY_GRAPH;
    try {
      expect(comfySettings("x", { promptSetsComposition: true }).denoise).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.COMFY_GRAPH;
      else process.env.COMFY_GRAPH = prev;
    }
  });
});
