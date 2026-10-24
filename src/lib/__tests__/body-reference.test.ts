import { describe, expect, it } from "vitest";
import { FACEID_WORKFLOW, REFERENCE_NAME, withBodyReference, withLora } from "../comfy";
import { healthyBuild, inkTags } from "../media.functions";

describe("body reference", () => {
  it("is off without a weight", () => {
    expect(withBodyReference(FACEID_WORKFLOW, { weight: 0 })).toBe(FACEID_WORKFLOW);
  });

  it("feeds the portrait through a PLUS adapter into the main sampler", () => {
    const before = JSON.parse(FACEID_WORKFLOW);
    const g = JSON.parse(withBodyReference(FACEID_WORKFLOW, { weight: 0.8 }));
    expect(g["3"].inputs.model).toEqual(["62", 0]);
    expect(g["60"].inputs.model).toEqual(before["3"].inputs.model);
    expect(g["61"].inputs.image).toBe(REFERENCE_NAME);
    expect(g["62"].inputs).toMatchObject({ weight: 0.8, weight_type: "style transfer", end_at: 0.8 });
  });

  it("survives the insertion LoRA, which only reroutes the checkpoint", () => {
    const g = JSON.parse(withLora(withBodyReference(FACEID_WORKFLOW, { weight: 0.8 }), "x.safetensors", 0.8));
    expect(g["3"].inputs.model).toEqual(["62", 0]);
    expect(g["40"].class_type).toBe("LoraLoader");
  });
});

describe("healthy build", () => {
  it("says a slim build as a healthy one and leaves others alone", () => {
    expect(healthyBuild("slim athletic build")).toContain("healthy");
    expect(healthyBuild("muscular athletic build")).toBe("muscular athletic build");
    expect(healthyBuild("curvy build")).toBe("curvy build");
    expect(healthyBuild("large bust")).toBe("large bust");
    expect(inkTags("long dark hair, slim athletic build, medium bust, floral neck tattoo")).toContain("slim healthy feminine figure");
  });
});
