import { describe, it, expect } from "vitest";
import { sfwBrief, START_NAME } from "../compose.server";
import { FACEID_I2I_WORKFLOW, FACEID_WORKFLOW, comfyWorkflow, comfySettings, usesStartLatent } from "../comfy";

// Grok composes the clothed version of the picture; the uncensored pass
// starts from it. The brief it is given can never contain a word the image
// model refuses, and the graph has to start from the frame, not from noise.

const EXPLICIT = /\b(?:nude|naked|topless|tits?|boobs?|breasts?|nipples?|pussy|cock|dick|dildo|vibrator|cum|squirt|masturbat\w*|fuck\w*|sex)\b/i;

describe("the clothed brief", () => {
  it("keeps the pose and loses every explicit word", () => {
    for (const r of [
      "send me a picture of you licking your tits",
      "stick a dildo in your pussy",
      "spread your legs and show me your pussy",
      "rub your pussy for me",
      "cum for me",
      "bend over and show me your ass",
      "send me a nude selfie",
      "show me your tits",
      "sucking on a dildo",
    ]) {
      const b = sfwBrief(r, { setting: "a small bedroom with a grey bed and a window" });
      expect(b, r).not.toMatch(EXPLICIT);
      expect(b, r).toMatch(/same woman as the reference image/);
      expect(b, r).toMatch(/same outfit as in the reference image/);
      expect(b, r).toMatch(/grey bed/);
    }
  });

  it("turns the act into the body position a clothed photo would show", () => {
    expect(sfwBrief("send me a picture of you licking your tits")).toMatch(/head bent down toward her own chest/);
    expect(sfwBrief("stick a dildo in your pussy")).toMatch(/hand between her thighs holding a small smooth object/);
    expect(sfwBrief("spread your legs")).toMatch(/knees wide apart/);
    expect(sfwBrief("bend over and show me your ass")).toMatch(/bending forward at the waist/);
    expect(sfwBrief("send me a selfie")).toMatch(/sitting on the edge of the bed/);
  });
});

describe("the composed-frame graph", () => {
  it("starts the sampler from the frame, not from noise", () => {
    const g = JSON.parse(FACEID_I2I_WORKFLOW);
    expect(g["5"]).toBeUndefined();
    expect(g["22"].class_type).toBe("VAEEncode");
    expect(g["3"].inputs.latent_image).toEqual(["22", 0]);
    expect(g["20"].inputs.image).toBe("{{START_IMAGE}}");
    expect(g["14"].class_type).toBe("FaceDetailer");
    expect(usesStartLatent(FACEID_I2I_WORKFLOW)).toBe(true);
    expect(usesStartLatent(FACEID_WORKFLOW)).toBe(false);
  });

  it("renders at the composed tiers, lighter than the portrait tiers", () => {
    for (const k of Object.keys(process.env)) if (k.startsWith("COMFY_DENOISE")) delete process.env[k];
    const plain = comfySettings("p", { template: FACEID_I2I_WORKFLOW, composed: true });
    const nude = comfySettings("p", { template: FACEID_I2I_WORKFLOW, composed: true, needsUndress: true });
    const posed = comfySettings("p", { template: FACEID_I2I_WORKFLOW, composed: true, promptSetsComposition: true });
    expect(plain.denoise).toBe(0.5);
    expect(nude.denoise).toBe(0.62);
    expect(posed.denoise).toBe(0.7);
    expect(comfySettings("p", { template: FACEID_WORKFLOW }).denoise).toBe(1);
    const g = comfyWorkflow(
      { ...nude, prompt: "p", negative: "n", checkpoint: "c.safetensors", referenceImage: "r.png", startImage: START_NAME },
      FACEID_I2I_WORKFLOW,
    ) as any;
    expect(g["20"].inputs.image).toBe("start.png");
    expect(g["3"].inputs.denoise).toBe(0.62);
    expect(g["12"].inputs.weight_faceidv2).toBe(1.2);
  });
});
