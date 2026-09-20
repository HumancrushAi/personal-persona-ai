import { describe, it, expect, afterEach } from "vitest";
import { stillImagePrompt, videoStillPrompt } from "../selfie";

// Photos run on the image-to-video endpoint, so the prompt has to drive the
// clip INTO the explicit state and hold it — the frame shown is near the end.
describe("videoStillPrompt", () => {
  it("undresses on an explicit request and ends held still", () => {
    const p = videoStillPrompt({ gender: "female" }, "take your top off and show me your tits");
    expect(p).toMatch(/completely naked/i);
    // Not "bare breasts": the clause is hand-edited copy and the adjective has
    // changed. Nudity is asserted on its own line above; what this one is for is
    // that the chest gets described at all.
    expect(p).toMatch(/breasts/i);
    expect(p).toMatch(/still held pose/i);
  });

  it("uses male anatomy for male companions", () => {
    const p = videoStillPrompt({ gender: "male" }, "get naked");
    expect(p).toMatch(/penis/i);
    expect(p).not.toMatch(/bare breasts/i);
  });

  it("keeps a clothed request clothed", () => {
    const p = videoStillPrompt({ gender: "female" }, "wearing your red dress at dinner");
    expect(p).not.toMatch(/completely naked/i);
    expect(p).toMatch(/holds the pose/i);
  });

  it("defaults to explicit when nothing is asked for", () => {
    expect(videoStillPrompt({ gender: "female" }, "")).toMatch(/completely naked/i);
  });

  // "Show me your pussy" named no posture, so the prompt described open thighs
  // on a figure with nowhere to be. Propped up keeps her chest lifted.
  it("gives a nude request with no posture a propped-up one", () => {
    const p = videoStillPrompt({ gender: "female" }, "show me your pussy");
    expect(p).toMatch(/reclining back against pillows/i);
    expect(p).toMatch(/knees apart/i);
    expect(p).not.toMatch(/standing/i);
  });

  // Flat on her back is the pose that spreads her breasts sideways. A request
  // that says "lying" is still lying — propped up, chest lifted.
  it("writes a lying request as propped up on pillows", () => {
    const p = videoStillPrompt({ gender: "female" }, "lying on the bed, show me your pussy");
    expect(p).toMatch(/lying back against a stack of pillows/i);
    expect(p).toMatch(/shoulders and upper back raised/i);
    expect(p).toMatch(/hands resting on her thighs/i);
  });

  // The words that make the render pull her open are gone from every clause.
  it("never names labia or clitoris in a female nude", () => {
    for (const req of ["show me your pussy", "get naked", "lying on the bed naked"]) {
      expect(videoStillPrompt({ gender: "female" }, req)).not.toMatch(
        /\blabia\b|\bclitor|\blips\b/i,
      );
    }
  });

  it("leaves a posture the user asked for alone", () => {
    const p = videoStillPrompt({ gender: "female" }, "get naked and kneel on the bed");
    expect(p).not.toMatch(/reclining back against pillows/i);
  });

  // At head-to-knees distance a vulva is about forty pixels across and comes
  // back a smear whatever the words say. A request that names it earns a closer
  // camera; a plain nude does not, because the crop costs her face.
  it("brings the camera in when the request is about her pussy", () => {
    const p = videoStillPrompt({ gender: "female" }, "show me your pussy");
    expect(p).toMatch(/chin down to her knees/i);
    expect(p).toMatch(/groin in the centre of the frame in sharp focus/i);
  });

  it("keeps the wider frame for a plain nude", () => {
    const p = videoStillPrompt({ gender: "female" }, "get naked for me");
    expect(p).toMatch(/top of her head down to her knees/i);
    expect(p).not.toMatch(/chin down to her knees/i);
  });

  it("leaves a point-of-view request on its own viewpoint", () => {
    const p = videoStillPrompt({ gender: "female" }, "pussy close to my face");
    expect(p).toMatch(/point-of-view/i);
    expect(p).not.toMatch(/chin down to her knees/i);
  });

  it("never crops in on a companion who has no vulva", () => {
    const p = videoStillPrompt({ gender: "male" }, "show me your cock");
    expect(p).not.toMatch(/chin down to his knees/i);
  });

  // The ComfyUI path renders the same photograph in one pass, so it shares this
  // builder — minus the cue that tells a CLIP to arrive somewhere and hold it.
  it("gives an image model the same photograph without the video cue", () => {
    const req = "show me your pussy";
    const still = stillImagePrompt({ gender: "female" }, req);
    expect(still).toMatch(/chin down to her knees/i);
    // Comma optional: the clause is hand-edited copy and its punctuation has
    // changed before. What this asserts is that the closed form reaches the
    // prompt at all, not how it is punctuated.
    expect(still).toMatch(/plump,? closed pussy/i);
    expect(still).not.toMatch(/still held pose|camera holds its position/i);
    // Same picture, different tail.
    expect(videoStillPrompt({ gender: "female" }, req)).toMatch(/still held pose/i);
  });

  it("drops standing when custom request is provided", () => {
    const p = videoStillPrompt({ gender: "female" }, "lying on bed");
    expect(p).not.toMatch(/standing/i);
  });

  it("handles toys realistically and asserts female anatomy positively", () => {
    const p = videoStillPrompt({ gender: "female" }, "dildo in pussy");
    expect(p).toMatch(/natural soft vulva/i);
    expect(p).toMatch(/inserted/i);
    expect(p).toMatch(/between her open thighs/i);
    expect(p).not.toMatch(/standing/i);
    // "no penis" used to be here. It put `penis` in the conditioning of every
    // female nude, and the render came back with masculine legs and a fused
    // groin — the failure a user reported. Male anatomy is suppressed in the
    // negative prompt now, which is where suppression works.
    expect(p).not.toMatch(/penis/i);
  });

  it("uses a described point of view when the user asks for a close-up", () => {
    const p = videoStillPrompt({ gender: "female" }, "pussy close to my face");
    expect(p).toMatch(/close-up point-of-view photograph/i);
    expect(p).toMatch(/from between her open thighs/i);
    expect(p).not.toMatch(/camera about three metres away/i);
  });
});

// Realism regression. "8k masterpiece ultra detailed" pushes the render toward
// the glossy CG look people read instantly as AI; camera language plus explicit
// permission for real skin texture is what actually buys photorealism.
describe("realism tail", () => {
  it("asks for camera and real skin, not render vocabulary", () => {
    const p = videoStillPrompt({ gender: "female" }, "");
    expect(p).toMatch(/candid photograph/i);
    expect(p).toMatch(/pores/i);
    // It used to close "no airbrushing or smoothing… not a render", which is
    // how `airbrushing`, `smoothing` and `render` got into every prompt. The
    // realism ask is now entirely positive; the artefacts are negated in
    // QUALITY_NEGATIVE, in media.functions.ts.
    expect(p).toMatch(/real untouched skin/i);
    expect(p).not.toMatch(/no airbrushing|not a render/i);
  });

  it("does not use the AI-slop quality words", () => {
    const p = videoStillPrompt({ gender: "female" }, "");
    expect(p).not.toMatch(/\b8k\b/i);
    expect(p).not.toMatch(/masterpiece/i);
  });
});

// The anatomy clause is appended, not described.
//
// It used to be a ~143-word bullet ending "Write it in exactly those words",
// inside an instruction to write a 120-160 word prompt containing a dozen other
// things. Both could not hold, so the model compressed and dropped a different
// half each run — a lottery sitting directly on the body description, before any
// seed is involved. Appended here it competes with nothing.
describe("finishMediaPrompt appendAnatomy", () => {
  const female = { gender: "female" };

  it("appends the clause verbatim to a refined prompt", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    const { anatomyOf, nudeAnatomy } = await import("../anatomy");
    const out = finishMediaPrompt(
      "exact same woman as the reference image, completely nude, kneeling on the bed, warm lamplight",
      "get naked for me",
      { anatomy: anatomyOf(female.gender), appendAnatomy: true },
    );
    expect(out).toContain(nudeAnatomy("female"));
  });

  it("leaves a builder prompt alone, which writes its own clause", async () => {
    const { finishMediaPrompt, stillImagePrompt } = await import("../selfie");
    const { anatomyOf, nudeAnatomy } = await import("../anatomy");
    const built = stillImagePrompt(
      { name: "Ana", age: 26, ethnicity: "Italian", gender: "female" } as any,
      "get naked for me",
    );
    const out = finishMediaPrompt(built, "get naked for me", {
      anatomy: anatomyOf(female.gender),
      appendAnatomy: false,
    });
    // Present once, from the builder — not twice.
    const clause = nudeAnatomy("female");
    expect(out.split(clause).length - 1).toBe(1);
  });

  it("withholds it when the user set their own viewpoint", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    const { anatomyOf, nudeAnatomy } = await import("../anatomy");
    const out = finishMediaPrompt(
      "exact same woman as the reference image, completely nude, on all fours facing away, warm lamplight",
      "show me your ass",
      { anatomy: anatomyOf(female.gender), appendAnatomy: true },
    );
    expect(out).not.toContain(nudeAnatomy("female"));
  });

  it("withholds it from a clothed request", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    const { anatomyOf, nudeAnatomy } = await import("../anatomy");
    const out = finishMediaPrompt(
      "exact same woman as the reference image, wearing a red silk dress at dinner, warm light",
      "wearing your red dress at dinner",
      { anatomy: anatomyOf(female.gender), appendAnatomy: true },
    );
    expect(out).not.toContain(nudeAnatomy("female"));
  });

  // The whole prompt still has to clear the renderer's truncation window.
  it("keeps the finished prompt inside the word budget", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    const { anatomyOf } = await import("../anatomy");
    const refined =
      "exact same woman as the reference image, completely nude, ".repeat(3) +
      "kneeling on the bed with her shoulders back, warm bedside lamplight, candid raw photograph";
    const out = finishMediaPrompt(refined, "get naked for me", {
      anatomy: anatomyOf(female.gender),
      appendAnatomy: true,
      appendProps: true,
    });
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(300);
  });
});

// "The bodies are fat — they should be slim."
//
// Not a wording preference: a routing bug. Every prompt in this app is written
// on the assumption that a photo of her reaches the renderer — the rules say
// "leave her hair colour, skin tone and build out entirely, a reference photo
// supplies all of that" — and for WAN and Kontext that is true, because both
// work FROM her portrait.
//
// The ComfyUI stock graph is text-to-image. No portrait reaches it. So the
// prompt withheld her build and nothing else supplied it, leaving the
// checkpoint's own default body to fill the gap.
describe("finishMediaPrompt appendAppearance", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  const base =
    "exact same woman as the reference image, completely nude, kneeling on the bed, warm lamplight";

  it("states her build when no picture of her reaches the renderer", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    delete process.env.COMFY_BUILD;
    const out = finishMediaPrompt(base, "get naked", { appendAppearance: true });
    expect(out).toMatch(/slim toned adult figure/i);
  });

  it("says nothing about build when her portrait IS the input", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    delete process.env.COMFY_BUILD;
    const out = finishMediaPrompt(base, "get naked", { appendAppearance: false });
    expect(out).not.toMatch(/slim toned adult figure/i);
    // The adult clause is unconditional, so the prompt is not byte-identical;
    // what must be absent is the BUILD, which would fight the photo.
    expect(out).toMatch(/Adult 18-year-old woman/);
  });

  it("takes its wording from COMFY_BUILD", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    process.env.COMFY_BUILD = "lean athletic build, toned";
    const out = finishMediaPrompt(base, "get naked", { appendAppearance: true });
    expect(out).toMatch(/lean athletic build, toned/);
    expect(out).not.toMatch(/slim/i);
  });

  it("can be switched off entirely", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    process.env.COMFY_BUILD = "";
    const out = finishMediaPrompt(base, "get naked", { appendAppearance: true });
    expect(out).not.toMatch(/slim toned adult figure/i);
    // The adult clause is not a style setting and has no off switch.
    expect(out).toMatch(/Adult \d+-year-old/);
  });

  // Position, not wording. CLIP weights early tokens far more heavily and
  // chunks a long prompt, so the same clause at word 280 of 300 barely reaches
  // the render — which is why "slim" appeared to do nothing at all.
  it("puts the build near the front, after the framing sentence", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    delete process.env.COMFY_BUILD;
    const out = finishMediaPrompt(
      "Photograph of a woman indoors, framed head to knees. She is already completely naked. Warm lamplight.",
      "get naked",
      { appendAppearance: true },
    );
    // Second sentence, so the framing still decides the composition.
    expect(out.split(/(?<=\.)\s+/)[1]).toMatch(/^Adult \d+-year-old woman/);
    expect(out.indexOf("Adult")).toBeLessThan(out.indexOf("completely naked"));
  });

  it("keeps the original text intact when there is no sentence to follow", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    delete process.env.COMFY_BUILD;
    const out = finishMediaPrompt("a prompt ending in a fragment,", "get naked", {
      appendAppearance: true,
    });
    expect(out).toMatch(/^Adult \d+-year-old woman/);
    expect(out).toMatch(/a prompt ending in a fragment,$/);
  });

  // The gap this fills: the anatomy clause describes a chest and a groin and
  // nothing in between, while `plump` arrives from the vulva phrase and is the
  // only other shape word in the prompt.
  it("names a midsection, so the checkpoint has something to render there", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    delete process.env.COMFY_BUILD;
    const out = finishMediaPrompt(base, "get naked", { appendAppearance: true });
    expect(out).toMatch(/waist/i);
    expect(out).toMatch(/stomach/i);
  });
});

// Two things the dry run exposed, once I stopped guessing from screenshots and
// printed the prompt the renderer actually receives.
describe("what the ComfyUI path actually sends", () => {
  const female = { name: "Test", age: 26, ethnicity: "Italian", gender: "female" } as any;

  // "She is with lingerie on with her pussy showing" and "She is already
  // completely naked, bare skin everywhere", two sentences apart in the same
  // prompt. Naming a part makes requestIsNude true, so the builder asserted
  // full nudity over the top of the garment the user had asked for, and the
  // render split the difference.
  it("stops asserting full nudity over a garment the request keeps on", async () => {
    const { stillImagePrompt } = await import("../selfie");
    const p = stillImagePrompt(female, "with lingerie on with your pussy showing");
    expect(p).not.toMatch(/completely naked/i);
    expect(p).toMatch(/lingerie/i);
  });

  it("still asserts it for a plain nude request", async () => {
    const { stillImagePrompt } = await import("../selfie");
    expect(stillImagePrompt(female, "get naked for me")).toMatch(/completely naked/i);
  });

  // The clause points at a reference image that a text-to-image graph never
  // receives — a dozen inert tokens in the part of the prompt the encoder
  // weighs most heavily.
  it("drops the pointer to a reference image that never arrives", async () => {
    const { finishMediaPrompt, stillImagePrompt } = await import("../selfie");
    const built = stillImagePrompt(female, "get naked for me");
    const out = finishMediaPrompt(built, "get naked for me", { appendAppearance: true });
    expect(out).not.toMatch(/reference/i);
  });

  it("keeps it when her portrait IS the input", async () => {
    const { finishMediaPrompt, stillImagePrompt } = await import("../selfie");
    const built = stillImagePrompt(female, "get naked for me");
    const out = finishMediaPrompt(built, "get naked for me", { appendAppearance: false });
    expect(out).toMatch(/reference/i);
  });

  // The first attempt dropped whole comma fragments and took the neighbours
  // with it: "and bare around it" and "Candid photograph" both vanished.
  it("removes the pointer without taking its neighbours", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    const out = finishMediaPrompt(
      "She is wearing what was asked for, and bare around it. exact same body proportions as the reference image, natural firm breasts, kneeling on the bed. Candid photograph, 50mm lens.",
      "get naked",
      { appendAppearance: true },
    );
    expect(out).not.toMatch(/reference/i);
    expect(out).toMatch(/and bare around it/);
    expect(out).toMatch(/Candid photograph/);
    expect(out).toMatch(/natural firm breasts/);
    // No ". ," seam left where the phrase used to be.
    expect(out).not.toMatch(/[.!?]\s*,/);
  });
});

// Every companion in the app rendered as the same anonymous woman.
//
// The prompt opened "Photograph of a woman indoors" and nothing ever said WHICH
// woman. Her age and ethnicity are on her own row and reached photoPrompt, and
// were then discarded — for the same reason her build was, the rules assume a
// reference photo supplies all of it, and on a text-to-image graph nothing
// does. So an Asian companion rendered white, every time.
describe("who she is, on a graph that has no picture of her", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  const base = "Photograph of a woman indoors, framed head to knees. Warm lamplight.";

  it("carries her age and ethnicity from her own row", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    const { anatomyOf } = await import("../anatomy");
    const out = finishMediaPrompt(base, "get naked", {
      anatomy: anatomyOf("female"),
      appendAppearance: true,
      appearance: { age: 24, ethnicity: "Japanese" },
    });
    expect(out).toMatch(/Adult 24-year-old woman/);
    expect(out).toMatch(/Japanese woman/);
  });

  it("uses the right noun for the companion", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    const { anatomyOf } = await import("../anatomy");
    const out = finishMediaPrompt(base, "get naked", {
      anatomy: anatomyOf("male"),
      appendAppearance: true,
      appearance: { age: 30, ethnicity: "Brazilian" },
    });
    expect(out).toMatch(/Adult 30-year-old man/);
    expect(out).toMatch(/Brazilian man/);
  });

  it("still states the build alongside it", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    const { anatomyOf } = await import("../anatomy");
    delete process.env.COMFY_BUILD;
    const out = finishMediaPrompt(base, "get naked", {
      anatomy: anatomyOf("female"),
      appendAppearance: true,
      appearance: { age: 24, ethnicity: "Japanese" },
    });
    expect(out).toMatch(/Japanese woman, slim toned adult figure/);
  });

  it("degrades cleanly when the row is missing either field", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    const { anatomyOf } = await import("../anatomy");
    const out = finishMediaPrompt(base, "get naked", {
      anatomy: anatomyOf("female"),
      appendAppearance: true,
      appearance: { age: null, ethnicity: null },
    });
    // No bare "Woman," — the noun is already in the framing sentence, so with
    // neither field set the clause is the build alone.
    expect(out).toMatch(/slim toned adult figure/);
    expect(out).not.toMatch(/null|undefined/);
  });

  // Her portrait IS the input on those paths, and describing her in words there
  // fights the photo — the failure the rules were written to avoid.
  it("says none of it when her portrait reaches the renderer", async () => {
    const { finishMediaPrompt } = await import("../selfie");
    const { anatomyOf } = await import("../anatomy");
    const out = finishMediaPrompt(base, "get naked", {
      anatomy: anatomyOf("female"),
      appendAppearance: false,
      appearance: { age: 24, ethnicity: "Japanese" },
    });
    expect(out).not.toMatch(/Japanese/);
    // The adult clause is unconditional; the ethnicity and build are not.
    expect(out).toMatch(/Adult 24-year-old woman/);
  });
});
