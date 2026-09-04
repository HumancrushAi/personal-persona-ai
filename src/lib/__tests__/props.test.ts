import { describe, it, expect } from "vitest";
import { propClause, propNegative, hasProp } from "../props";

describe("propClause", () => {
  it("says nothing when no prop was asked for", () => {
    expect(propClause("send me a nude selfie")).toBe("");
    expect(propClause("")).toBe("");
  });

  // The reported failure: a tan wood-grained cylinder as long as her arm.
  // Every lever against it has to actually be in the prompt.
  it("gives the toy a material, a colour and a body-relative size", () => {
    const c = propClause("stick a dildo in your pussy");
    expect(c).toContain("silicone");
    expect(c).toContain("solid colour");
    expect(c).toContain("as long as her hand");
    expect(c).toContain("two fingers thick");
  });

  it("never uses the abstract wording the renderer cannot act on", () => {
    const c = propClause("using a big dildo");
    expect(c).not.toMatch(/correct (?:size|proportions)/i);
  });

  it("bounds a big toy instead of refusing it", () => {
    const c = propClause("stick a big dildo in your pussy");
    expect(c).toContain("at most the length of her forearm");
    expect(c).toContain("not mean a bat");
  });

  it("leaves the bound out when size was never mentioned", () => {
    expect(propClause("using a dildo")).not.toContain("at most the length of her forearm");
  });

  const sizeWords = ["big", "huge", "massive", "giant", "thick", "9 inch"];
  for (const w of sizeWords) {
    it(`treats "${w}" as a size request`, () => {
      const c = propClause(`a ${w} dildo in her pussy`);
      expect(`${w} -> ${c.includes("at most the length of her forearm")}`).toBe(`${w} -> true`);
    });
  }

  it("keeps the toy out of her hand", () => {
    expect(propClause("holding a dildo")).toContain("countable as five separate fingers");
  });

  it("asserts female anatomy for a female companion, not a male one", () => {
    expect(propClause("using a dildo", { isMale: false })).toContain("no penis");
    expect(propClause("using a fleshlight", { isMale: true })).not.toContain("no penis");
  });

  // "a dildo in her hand" and "a dildo in pussy" differ only by the word after
  // "in", so that is what decides it.
  it("describes the contact only when something is actually inserted", () => {
    for (const r of ["stick a dildo in her pussy", "dildo in pussy", "dildo inside her ass"]) {
      expect(`${r} -> ${propClause(r).includes("inserted into her")}`).toBe(`${r} -> true`);
    }
    for (const r of ["holding a dildo and smiling", "a dildo in her hand"]) {
      expect(`${r} -> ${propClause(r).includes("inserted into her")}`).toBe(`${r} -> false`);
    }
  });

  // Each toy is a different shape; one generic description is what let the
  // renderer pick its own.
  const shapes: [string, string][] = [
    ["a butt plug in her ass", "size of an egg"],
    ["using anal beads", "size of a marble"],
    ["a magic wand on her clit", "size of a plum"],
    ["wearing a strap-on", "harness"],
    ["using a fleshlight", "flashlight"],
    ["a vibrator on her nipples", "thumb's width"],
    ["a dildo in her pussy", "as long as her hand"],
  ];
  for (const [req, expected] of shapes) {
    it(`describes "${req}" as its own shape`, () => {
      expect(propClause(req)).toContain(expected);
    });
  }

  it("matches the specific toy before the general one", () => {
    // "butt plug" contains "plug"; "sex toy" must not beat "vibrator".
    expect(propClause("a butt plug")).toContain("flared base");
    expect(propClause("a butt plug")).toContain("size of an egg");
    expect(propClause("a vibrator")).toContain("control button");
  });
});

describe("propNegative", () => {
  it("names the exact wrong objects that were rendered", () => {
    const n = propNegative("a big dildo");
    expect(n).toContain("baseball bat");
    expect(n).toContain("wood grain");
    expect(n).toContain("object fused to hand");
  });

  it("adds nothing to an ordinary selfie", () => {
    expect(propNegative("send me a nude pic")).toBe("");
  });
});

describe("hasProp", () => {
  it("recognises the toy vocabulary", () => {
    for (const r of ["a dildo", "her vibrator", "anal beads", "a strap-on", "sex toys"]) {
      expect(`${r} -> ${hasProp(r)}`).toBe(`${r} -> true`);
    }
  });

  it("does not fire on ordinary words", () => {
    for (const r of ["send a pic", "kiss me", "wearing a dress"]) {
      expect(`${r} -> ${hasProp(r)}`).toBe(`${r} -> false`);
    }
  });
});
