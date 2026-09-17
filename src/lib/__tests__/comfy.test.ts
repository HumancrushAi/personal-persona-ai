import { describe, it, expect } from "vitest";
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
