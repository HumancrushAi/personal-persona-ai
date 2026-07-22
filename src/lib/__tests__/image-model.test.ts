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

  it("treats trans-male the same as male", () => {
    expect(imageModelForGender("trans-male").negativePrompt).toBeTruthy();
  });

  it("leaves female and non-binary on the default model with no negative prompt", () => {
    for (const g of ["female", "trans-female", "non-binary", null, undefined]) {
      const m = imageModelForGender(g);
      expect(m.negativePrompt).toBeUndefined();
      expect(m.input.model).toBeUndefined();
    }
  });
});
