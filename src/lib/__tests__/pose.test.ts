import { afterEach, describe, expect, it } from "vitest";
import { FACEID_POSE_WORKFLOW, FACEID_WORKFLOW, comfyInput, comfySettings, comfyWorkflow } from "../comfy";
import { poseFor, poseGuideConfigured } from "../poses";

const prev = process.env.COMFY_CONTROLNET;
afterEach(() => {
  if (prev === undefined) delete process.env.COMFY_CONTROLNET;
  else process.env.COMFY_CONTROLNET = prev;
});

describe("the pose guide", () => {
  it("exists for licking her own breast and for nothing else yet", () => {
    const g = poseFor("send me a picture of you licking your tits");
    expect(g?.name).toBe("breast-lick");
    expect(g?.base64.length).toBeGreaterThan(1000);
    expect(poseFor("send me a selfie")).toBeNull();
    expect(poseFor("stick a dildo in your pussy")).toBeNull();
  });

  it("is only used when the worker has the model", () => {
    delete process.env.COMFY_CONTROLNET;
    expect(poseGuideConfigured()).toBe(false);
    process.env.COMFY_CONTROLNET = "OpenPoseXL2.safetensors";
    expect(poseGuideConfigured()).toBe(true);
  });

  it("wires the skeleton into the sampler's conditioning and leaves the face pass alone", () => {
    const g = JSON.parse(FACEID_POSE_WORKFLOW);
    expect(g["16"].class_type).toBe("LoadImage");
    expect(g["18"].class_type).toBe("ControlNetLoader");
    expect(g["17"].class_type).toBe("ControlNetApplyAdvanced");
    expect(g["3"].inputs.positive).toEqual(["17", 0]);
    expect(g["3"].inputs.negative).toEqual(["17", 1]);
    expect(g["14"].inputs.positive).toEqual(["6", 0]);
    // The plain graph is untouched.
    expect(JSON.parse(FACEID_WORKFLOW)["3"].inputs.positive).toEqual(["6", 0]);
  });

  it("fills the guide's tokens and ships the skeleton alongside the portrait", () => {
    process.env.COMFY_CONTROLNET = "OpenPoseXL2.safetensors";
    const vars = {
      ...comfySettings("x", { template: FACEID_POSE_WORKFLOW }),
      prompt: "p",
      negative: "n",
      poseImage: "pose-breast-lick.png",
    };
    const graph: any = comfyWorkflow({ ...vars, referenceImage: "ref.png" }, FACEID_POSE_WORKFLOW);
    expect(graph["18"].inputs.control_net_name).toBe("OpenPoseXL2.safetensors");
    expect(graph["16"].inputs.image).toBe("pose-breast-lick.png");
    expect(graph["17"].inputs.strength).toBe(0.75);
    const input: any = comfyInput(
      { ...vars, checkpoint: "c.safetensors" },
      { template: FACEID_POSE_WORKFLOW, referenceBase64: "AAAA", extraImages: [{ name: "pose-breast-lick.png", base64: "BBBB" }] },
    );
    expect(input.images.map((i: any) => i.name)).toEqual(expect.arrayContaining(["pose-breast-lick.png"]));
    expect(input.images.length).toBe(2);
  });
});
