import { describe, it, expect } from "vitest";
import { propClause, propNegative, hasProp, propIsInserted } from "../props";
import { anatomyOf } from "../anatomy";

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

  // Keyed off whether this companion HAS a vulva, not off an isMale flag. The
  // flag counted a trans man as male, so a request to put a toy inside him
  // asserted no anatomy at all for the part it was going inside.
  it("asserts the anatomy the toy is against, for whoever actually has it", () => {
    // Stated positively. It used to read "…and no penis", which put `penis` in
    // the conditioning of every female nude — and the render came back with
    // masculine legs and a fused groin. Male anatomy is suppressed in the
    // NEGATIVE prompt (crossSexNegative), where suppression works.
    const female = propClause("using a dildo", { anatomy: anatomyOf("female") });
    expect(female).toContain("natural soft vulva");
    expect(female).not.toMatch(/penis/i);

    expect(propClause("using a dildo", { anatomy: anatomyOf("trans-male") })).toContain(
      "He has a natural soft vulva",
    );

    for (const g of ["male", "trans-female"]) {
      expect(`${g} -> ${propClause("using a fleshlight", { anatomy: anatomyOf(g) })}`).not.toMatch(
        /natural soft vulva/i,
      );
    }
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

// The spec was correct and the render was still wrong, because the spec sat at
// the end of a ~300-word prompt. The text encoder weights early tokens hardest
// and chunks long prompts, so the longest, most specific passage in the whole
// prompt was the one it read last and weighed least — the same failure that
// made COMFY_BUILD's "slim" do nothing until it moved to the front.
describe("where the prop spec sits in the prompt", () => {
  const build = async () => {
    const { finishMediaPrompt } = await import("../selfie");
    return finishMediaPrompt(
      "Photo of her sitting on a bed in a bright room, shot on a Sony A7 IV, 85mm lens, natural window light",
      "stick a dildo in your pussy",
      { appendProps: true, appearance: { age: 23, ethnicity: "european" } },
    );
  };

  it("puts the object's description in the first half of the prompt", async () => {
    const out = await build();
    const at = out.indexOf("silicone");
    expect(at, "the prop spec is missing entirely").toBeGreaterThan(-1);
    expect(
      at / out.length,
      `prop spec starts ${Math.round((at / out.length) * 100)}% through the prompt`,
    ).toBeLessThan(0.5);
  });

  it("still leaves the scene description after it", async () => {
    const out = await build();
    expect(out.trim()).not.toMatch(/silicone[^.]*\.\s*$/i);
  });
});

// A render came back with three hands. The prompt had asked for it: the scene
// said "her hands resting on her thighs" — both of them — while the inserted
// clause put a hand on the toy. Neither sentence is wrong alone, which is why
// it survived every pass over each of them separately.
//
// Underneath that was the larger one. PROMPT_WORD_BUDGET is 300 words and
// capPromptWords cuts from the END, which is where everything gets appended.
// The builder produced 370 words, and the two clauses the cap removed were the
// hand count and the hand description — so the sentences saying how many hands
// exist never reached the renderer at all. Every earlier round of work on the
// prop spec was partly landing in the bin for the same reason.
describe("the word cap cannot eat the prop specification", () => {
  const finish = async (base: string) => {
    const { finishMediaPrompt } = await import("../selfie");
    return finishMediaPrompt(base, "stick a dildo in your pussy", {
      appendProps: true,
      still: true,
      appearance: { age: 23, ethnicity: "european" },
    } as any);
  };

  it("keeps the whole spec when the scene is far over budget", async () => {
    const bloat = ("She stands in a room with a window and a lamp and a chair. ".repeat(40)).trim();
    const out = await finish(bloat);
    expect(out.split(/\s+/).length, "over the word budget").toBeLessThanOrEqual(310);
    expect(out, "the toy's placement was cut").toMatch(/inserted/i);
    expect(out, "the toy's material was cut").toMatch(/silicone/i);
    expect(out, "the hand count was cut — this is the third hand").toMatch(
      /exactly two arms and two hands/i,
    );
  });

  // Same guarantee on the other path: the builder writes the spec into its own
  // text, so it is lifted out before the cut and put back after it.
  it("keeps it when the builder already wrote it in", async () => {
    const { stillImagePrompt, finishMediaPrompt } = await import("../selfie");
    const raw = stillImagePrompt({ gender: "female", name: "Jade" }, "stick a dildo in your pussy");
    const out = finishMediaPrompt(raw, "stick a dildo in your pussy", {
      appendProps: false,
      still: true,
      appearance: { age: 23, ethnicity: "european" },
    } as any);
    expect(out).toMatch(/exactly two arms and two hands/i);
    expect(out).toMatch(/five separate countable fingers/i);
    // ...and exactly once. Lifting it out and putting it back must not double it.
    expect(out.match(/exactly two arms and two hands/gi)).toHaveLength(1);
  });

  it("no longer places both hands somewhere else while one is on the toy", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    const out = finishMediaPrompt(
      "She is reclining back against pillows, her hands resting on her thighs, soft daylight.",
      "stick a dildo in your pussy",
      { appendProps: true, appearance: { age: 23, ethnicity: "european" } } as any,
    );
    expect(out, "both hands are placed away from the toy").not.toMatch(
      /hands\s+resting\s+on\s+(?:her|his|their)\s+thighs/i,
    );
  });
});

// A render arrived with a second body at the edge of frame, and the toy
// described as inserted but held by nobody.
//
// Nothing in the negative prompt said how many people are in the picture —
// not one term — and the second hand had deliberately been left unplaced to
// avoid contradicting the scene's own "hands resting on her thighs". With that
// sentence rewritten there is nothing left to contradict, so the hand gets a
// job: holding the toy, which is what the user asked for in the first place.
describe("one person, two hands, and the toy actually held", () => {
  const spec = async () => {
    const { propClause } = await import("../props");
    const { anatomyOf } = await import("../anatomy");
    return propClause("stick a dildo in your pussy", { anatomy: anatomyOf("female") });
  };

  it("says a hand is holding the toy, not merely near it", async () => {
    expect(await spec()).toMatch(/closed around the base of the toy and holding it/i);
  });

  it("gives the second hand somewhere to be", async () => {
    expect(await spec()).toMatch(/the other rests on her own stomach/i);
  });

  // Positive and countable, like the hand count — "another person" in a
  // negative spends itself on `person`.
  it("states she is the only person in the picture", async () => {
    expect(await spec()).toMatch(/alone, the only person in the picture/i);
  });

  it("names the crowd in the negative too", async () => {
    const { negativeFor } = await import("../media.functions");
    const neg = negativeFor("stick a dildo in your pussy", "female", { moving: false });
    for (const term of ["two people", "second person", "extra person", "someone else's hand"]) {
      expect(neg, `"${term}" missing from the negative`).toContain(term);
    }
  });
});

// Her appearance was withheld whenever a reference reached the renderer. At the
// high denoise a posed or prop request now uses, the reference reaches it but
// no longer carries her — so nothing described her at all, and a brunette came
// back blonde.
describe("who composes the shot decides whether she is described", () => {
  it("treats a prop, a posture and a viewpoint as prompt-led", async () => {
    const { requestComposesShot } = await import("../selfie");
    for (const req of [
      "stick a dildo in your pussy",
      "lie down on the bed",
      "bend over and show me",
      "turn around",
    ]) {
      expect(requestComposesShot(req), req).toBe(true);
    }
  });

  it("leaves a plain request to her portrait", async () => {
    const { requestComposesShot } = await import("../selfie");
    for (const req of ["send me a selfie", "send me a nude", "send a pic", ""]) {
      expect(requestComposesShot(req), JSON.stringify(req)).toBe(false);
    }
  });
});
