import { describe, it, expect } from "vitest";
import { imageModelForGender } from "../ai";

describe("imageModelForGender", () => {
  it("routes male companions to a male-anatomy model with a female-suppressing negative prompt", () => {
    const m = imageModelForGender("male");
    expect(m.version).toBe("6a52feace43ce1f6bbc2cdabfc68423cb2319d7444a1a1dae529c5e88b976382");
    expect(m.negativePrompt).toMatch(/vagina|vulva/i);
    expect(m.negativePrompt).toMatch(/breasts/i);
  });

  it("treats trans-male the same as male", () => {
    expect(imageModelForGender("trans-male").negativePrompt).toBeTruthy();
  });

  it("leaves female and non-binary on the default model with no negative prompt", () => {
    for (const g of ["female", "trans-female", "non-binary", null, undefined]) {
      const m = imageModelForGender(g);
      expect(m.negativePrompt).toBeUndefined();
    }
  });
});
