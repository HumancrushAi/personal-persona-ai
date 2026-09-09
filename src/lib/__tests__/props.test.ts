import { describe, it, expect } from "vitest";
import { propClause, propNegative, hasProp, propIsInserted } from "../props";

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
    expect(c).toContain("at most as long as her forearm");
    // The bound is a measurement, and ONLY a measurement. This used to end
    // "Large does not mean a bat, a club or a pole" — three nouns handed to a
    // renderer that cannot read "does not mean", in the one clause written to
    // stop a bat appearing. They live in propNegative now.
    expect(c).not.toMatch(/\bbat\b|\bclub\b|\bpole\b/i);
  });

  it("leaves the bound out when size was never mentioned", () => {
    expect(propClause("using a dildo")).not.toContain("at most as long as her forearm");
  });

  const sizeWords = ["big", "huge", "massive", "giant", "thick", "9 inch"];
  for (const w of sizeWords) {
    it(`treats "${w}" as a size request`, () => {
      const c = propClause(`a ${w} dildo in her pussy`);
      expect(`${w} -> ${c.includes("at most as long as her forearm")}`).toBe(`${w} -> true`);
    });
  }

  it("keeps the toy out of her hand", () => {
    expect(propClause("holding a dildo")).toContain("five separate countable fingers");
  });

  it("asserts female anatomy for a female companion, not a male one", () => {
    // Stated positively. It used to read "…and no penis", which put `penis` in
    // the conditioning of every female nude — and the render came back with
    // masculine legs and a fused groin. Male anatomy is suppressed in the
    // NEGATIVE prompt (FEMALE_NUDE_NEGATIVE), where suppression works.
    const female = propClause("using a dildo", { isMale: false });
    expect(female).toContain("natural female anatomy");
    expect(female).not.toMatch(/penis/i);
    expect(propClause("using a fleshlight", { isMale: true })).not.toMatch(
      /natural female anatomy/i,
    );
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
    expect(n).toContain("bong");
    expect(n).toContain("pipe");
    expect(n).toContain("smoking");
  });

  // A negative prompt pushes on the tokens it contains, not on the phrase they
  // were written into. "object near mouth, object near face, object near chest"
  // was therefore pushing her face and chest out of the picture while doing
  // nothing about the toy — one of the reasons a photo came back as a headless
  // torso. Only object nouns and wrong activities belong here.
  it("never suppresses a body part we want rendered", () => {
    const n = propNegative("a dildo in her pussy");
    expect(n).not.toMatch(/\bface\b|\bmouth\b|\bhead\b|\bchest\b|\btorso\b/i);
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

// ── The bong ────────────────────────────────────────────────────────────────
//
// A user asked for "a picture of you sticking a dildo in your pussy" and was
// sent a woman holding a two-foot black cylinder vertically from her crotch to
// her lips. In his words: "it looks like she's smoking a bong."
//
// The prompt asked for that. It said, three separate times, that the toy was
// "held low away from her face and mouth", "completely away from her face, head,
// mouth, and upper chest" and "NEVER held up near her face or chest" — and the
// renderer's text encoder has no operator for "away from" or "never". It read
// the nouns: toy, face, mouth, chest. Every prohibition was an instruction.
//
// So these are not style tests. Each word below, in the same prompt as the toy,
// is a request to draw the toy there.
describe("the positive prompt never negates", () => {
  const requests = [
    "stick a dildo in your pussy",
    "send me a picture of you sticking a dildo in your pussy",
    "a big dildo in her pussy",
    "put a butt plug in your ass",
    "use a vibrator on yourself",
    "fuck yourself with a magic wand",
    "using anal beads",
    "holding a dildo",
  ];

  for (const req of requests) {
    it(`says nothing about the face or mouth for "${req}"`, () => {
      const c = propClause(req);
      expect(c).not.toMatch(/\bface\b|\bmouth\b|\blips\b|\bhead\b|\bchest\b/i);
    });

    it(`uses no negation at all for "${req}"`, () => {
      const c = propClause(req);
      expect(c).not.toMatch(/\b(?:not|no|never|without|avoid|away from|instead of)\b/i);
    });
  }
});

// The bong was an ORIENTATION failure: a shaft running vertically up the body.
// An orientation is fixed by naming the direction it points and pinning both
// ends to something, not by banning the direction it must not point.
describe("an inserted toy is pinned at both ends", () => {
  const c = propClause("stick a dildo in your pussy");

  it("names the direction it points", () => {
    expect(c).toMatch(/angled downward|between her open thighs/i);
  });

  it("hides most of it inside her, which bounds the length by geometry", () => {
    expect(c).toMatch(/most of the shaft is hidden inside her/i);
  });

  it("anchors the far end to her hand and her thigh", () => {
    expect(c).toMatch(/fingers on it/i);
    expect(c).toMatch(/wrist against her inner thigh/i);
  });

  it("leads with where it is, before what it is made of", () => {
    // The renderer weights early tokens hardest, and placement is the part that
    // was going wrong. The silicone shopping list used to come first.
    expect(c.indexOf("inserted into her")).toBeLessThan(c.indexOf("matte silicone"));
  });
});

describe("propIsInserted", () => {
  it("separates a toy inside her from one in her hand", () => {
    expect(propIsInserted("stick a dildo in your pussy")).toBe(true);
    expect(propIsInserted("dildo in pussy")).toBe(true);
    expect(propIsInserted("holding a dildo and smiling")).toBe(false);
    expect(propIsInserted("naked on the bed")).toBe(false);
  });
});
