import { describe, it, expect } from "vitest";
import { imageModelForGender } from "../ai";

describe("imageModelForGender", () => {
  it("routes male companions to Pony Realism with a female-suppressing negative prompt", () => {
    const m = imageModelForGender("male");
    expect(m.version).toBe("b070dedae81324788c3c933a5d9e1270093dc74636214b9815dae044b4b3a58a");
    expect(m.input.model).toBe("ponyRealism21.safetensors");
    expect(m.negativePrompt).toMatch(/1girl|female/i);
    expect(m.negativePrompt).toMatch(/vagina|breasts/i);
  });

  it("routes female companions to Pony Realism with a male-suppressing negative prompt", () => {
    for (const g of ["female", "trans-female", null, undefined]) {
      const m = imageModelForGender(g);
      expect(m.input.model).toBe("ponyRealism21.safetensors");
      expect(m.negativePrompt).toMatch(/1boy|\bmale\b/i);
      expect(m.negativePrompt).toMatch(/penis/i);
    }
  });

  it("treats trans-male the same as male", () => {
    expect(imageModelForGender("trans-male").negativePrompt).toMatch(/1girl|female/i);
  });

  it("leaves non-binary on the Flux fallback with no negative prompt", () => {
    const m = imageModelForGender("non-binary");
    expect(m.negativePrompt).toBeUndefined();
    expect(m.input.model).toBeUndefined();
  });
});
