import { describe, it, expect } from "vitest";
import { negativeFor } from "../media.functions";
import { anatomyOf } from "../anatomy";

// The negative prompt is the half nobody reads, and two of the reported photo
// failures were coming from it.
//
// A negative prompt is not a sentence the renderer parses. It is encoded and
// used to push the image away from whatever is in it, token by token — so a
// list containing "cropped head, headless, head out of frame, face cut off"
// pushes away her head and her face, and a list containing "missing penis"
// pushes toward one. Both were in there.
describe("negativeFor", () => {
  describe("what it must never suppress", () => {
    it("does not push her head and face out of the picture", () => {
      const n = negativeFor("send me a nude pic", "female", { moving: false });
      // "cropped head, headless, head out of frame, face cut off, torso only"
      // used to be here, to stop the head being cut off. It is one of the
      // reasons a user was sent a headless torso.
      expect(n).not.toMatch(/\bheadless\b|cropped head|head out of frame|face cut off|torso only/i);
    });

    it("does not ask a female nude for male anatomy", () => {
      const n = negativeFor("get naked", "female", { moving: false });
      // "missing penis" and "penis looking like female genitalia" were on every
      // job, female ones included — actively penalising correct anatomy.
      expect(n).not.toMatch(/missing penis|penis looking like female/i);
      // Suppressing male anatomy on a female nude is still right, and this is
      // the place it works.
      expect(n).toMatch(/\bpenis\b/);
      expect(n).toMatch(/masculine groin/);
    });

    it("uses the companion's own sex, not a default", () => {
      // Both call sites used to omit the gender argument, so it defaulted to
      // female — and a male companion's nude photo was rendered with "penis,
      // cock, male genitalia" in its negative prompt.
      const male = negativeFor("get naked", "male", { moving: false });
      expect(male).not.toMatch(/\bmasculine groin\b/);
      expect(male).toMatch(/\bvulva\b/);
    });

    // The kind that had no branch at all: he was folded in with cis men, so his
    // negative prompt suppressed the vulva he has and left the cock he does not.
    it("gives a trans man his own anatomy, not a cis man's", () => {
      const n = negativeFor("get naked", "trans-male", { moving: false });
      expect(n).toMatch(/\bpenis\b/);
      expect(n).toMatch(/\bbreasts\b/);
      // "inner labia" is the deliberate exception (see PART_RE below); the
      // bare part is still never suppressed for someone who has it.
      expect(n).not.toMatch(/\bvulva\b|(?<!inner )\blabia\b(?! minora)/);
    });

    it("leaves a trans-female companion both sets of anatomy", () => {
      const n = negativeFor("get naked", "trans-female", { moving: false });
      expect(n).not.toMatch(/masculine groin/);
      expect(n).not.toMatch(/female breasts, pussy/);
    });
  });

  // A photo is one frame cut out of a clip on the video endpoint. Sending that
  // clip "static, still, frozen, no movement" as things to avoid means every
  // photo is a picture of someone mid-movement.
  describe("stillness", () => {
    it("keeps the motion negatives off a photo", () => {
      const n = negativeFor("get naked", "female", { moving: false });
      expect(n).not.toMatch(/\bstatic\b|\bfrozen\b|no movement|slow motion/i);
    });

    it("keeps them on a video, which does have to move", () => {
      const n = negativeFor("dance for me", "female", { moving: true });
      expect(n).toMatch(/\bstatic\b/);
      expect(n).toMatch(/no movement/);
    });
  });

  describe("clothing", () => {
    it("pushes clothes off a nude request", () => {
      expect(negativeFor("get naked", "female", { moving: false })).toMatch(/\bbra\b/);
    });

    it("leaves them alone on a clothed one, where they are the point", () => {
      expect(
        negativeFor("wearing your red dress at dinner", "female", { moving: false }),
      ).not.toMatch(/\bbra\b/);
    });
  });

  // "The boobs should not be saggy at all." Shape words, never the noun — and
  // only for a body that has breasts, because "droopy" on a man's render pushes
  // against the scrotum his anatomy clause describes.
  describe("breast shape", () => {
    it("pushes sagging off a woman, nude or clothed", () => {
      expect(negativeFor("get naked", "female", { moving: false })).toMatch(/\bsaggy\b/);
      expect(negativeFor("in your red bikini", "female", { moving: false })).toMatch(/\bsaggy\b/);
      expect(negativeFor("get naked", "trans-female", { moving: false })).toMatch(/\bpendulous\b/);
    });

    it("leaves it off a body without breasts", () => {
      expect(negativeFor("get naked", "male", { moving: false })).not.toMatch(
        /\bsaggy\b|\bdroopy\b/,
      );
      expect(negativeFor("get naked", "trans-male", { moving: false })).not.toMatch(/\bdroopy\b/);
    });
  });

  // The "weird thing sticking out": a render that extrudes tissue from the
  // cleft. Pushed against for a nude of anyone with a vulva, never for a man,
  // where "dangling" and "hanging" would fight his own anatomy clause.
  describe("vulva shape", () => {
    it("pushes protrusion off a nude with a vulva", () => {
      expect(negativeFor("show me your pussy", "female", { moving: false })).toMatch(
        /\bprotruding\b/,
      );
      // The sub-part itself, since naming its outer neighbour was not enough.
      expect(negativeFor("show me your pussy", "female", { moving: false })).toMatch(/inner labia/);
      expect(negativeFor("get naked", "trans-male", { moving: false })).toMatch(/\bprotruding\b/);
    });

    it("leaves it off a man and off a clothed shot", () => {
      expect(negativeFor("get naked", "male", { moving: false })).not.toMatch(/\bprotruding\b/);
      expect(negativeFor("in your red bikini", "female", { moving: false })).not.toMatch(
        /\bprotruding\b/,
      );
    });
  });

  describe("props", () => {
    it("adds the wrong objects only when a prop was asked for", () => {
      expect(negativeFor("dildo in your pussy", "female", { moving: false })).toMatch(
        /baseball bat/,
      );
      expect(negativeFor("get naked", "female", { moving: false })).not.toMatch(/baseball bat/);
    });

    it("names the bong, which is what the last one came back as", () => {
      expect(negativeFor("dildo in your pussy", "female", { moving: false })).toMatch(
        /\bbong\b.*\bsmoking\b|\bsmoking\b.*\bbong\b/s,
      );
    });
  });
});

// ── Suppressing the thing we asked for ──────────────────────────────────────
//
// "Men's penis still looks funny", reported after the positive half of the
// prompt had already been rebuilt. The reason it was asymmetric — the women got
// better, the men got worse — was here: QUALITY_NEGATIVE named `penis` three
// times, `breasts` six times, `crotch` twice, `genitalia` twice and `pussy`
// once, on EVERY render. Suppressing `penis` is correct for a woman, so her
// pictures improved. A man's prompt asked for a penis once and forbade it three
// times, and lost.
//
// This is the whole-prompt version of the rule anatomy.test.ts checks on
// crossSexNegative alone: the two halves are built separately and only this
// sees them combined.
describe("the negative prompt never suppresses a part the companion has", () => {
  const PART_RE = {
    penis: /\bpenis\b|\bcock\b|\btesticles?\b|\bscrotum\b|\bshaft\b|\bglans\b/i,
    // "inner labia" / "labia minora" are the one allowed exception: the
    // sub-part the render keeps extruding, pushed away on purpose while the
    // positive clause names no labia at all. The bare part stays forbidden.
    vulva:
      /\bvulva\b|\bvagina\b|(?<!inner )\blabia\b(?! minora)|\bpussy\b|\bclitoral\b|\bclitoris\b/i,
    breasts: /\bbreasts?\b|\bnipples?\b|\bareolae?\b|\bcleavage\b|\bbust\b/i,
  } as const;

  const genders = ["female", "male", "trans-female", "trans-male", "non-binary"];

  for (const gender of genders) {
    const a = anatomyOf(gender);
    for (const moving of [false, true]) {
      it(`leaves a ${gender} companion's own anatomy alone (${moving ? "video" : "photo"})`, () => {
        const neg = negativeFor("get naked for me", gender, { moving });
        const leaked: string[] = [];
        if (a.hasPenis && PART_RE.penis.test(neg)) leaked.push("penis");
        if (a.hasVulva && PART_RE.vulva.test(neg)) leaked.push("vulva");
        if (a.hasBreasts && PART_RE.breasts.test(neg)) leaked.push("breasts");
        expect(`${gender}: ${leaked.join(",") || "clean"}`).toBe(`${gender}: clean`);
      });
    }
  }

  // The part that applies to everyone, so it may not name any of them at all.
  it("keeps every genital and breast noun out of the shared quality list", () => {
    // A non-binary companion gets no cross-sex negatives, so this is
    // QUALITY_NEGATIVE (plus clothing and motion) on its own.
    const shared = negativeFor("get naked", "non-binary", { moving: true });
    for (const re of Object.values(PART_RE)) {
      expect(`shared: ${re.source} -> ${re.test(shared)}`).toBe(`shared: ${re.source} -> false`);
    }
  });

  // The positive prompt asks for "natural asymmetry" in the same breath — a
  // real face and a real body are not symmetrical, and this was the single term
  // most responsible for a render reading as a photo.
  it("does not fight the realism tail", () => {
    expect(negativeFor("get naked", "female", { moving: false })).not.toMatch(/asymmetric/i);
  });
});

// "A big belly like she's pregnant", on a companion whose own portrait is slim.
//
// The positive prompt was carrying this alone and losing: one stated build
// against a checkpoint's whole idea of a body. Suppression belongs in the
// negative, which is the half of the prompt that can actually leave an optional
// feature unrendered.
describe("body mass suppression", () => {
  it("pushes back on the shape that was reported", async () => {
    const { negativeFor } = await import("../media.functions");
    const n = negativeFor("send me a nude", "female", { moving: false });
    expect(n).toMatch(/\bpregnant\b/);
    expect(n).toMatch(/\boverweight\b/);
    expect(n).toMatch(/belly fat/);
  });

  // It arrived on a lingerie request, where the anatomy clause is not even
  // appended, so gating this on nudity would have missed the actual report.
  it("applies to a clothed request too", async () => {
    const { negativeFor } = await import("../media.functions");
    const n = negativeFor("wearing your red dress at dinner", "female", { moving: false });
    expect(n).toMatch(/\boverweight\b/);
  });

  it("applies to every gender", async () => {
    const { negativeFor } = await import("../media.functions");
    for (const g of ["female", "male", "trans-female", "trans-male", "non-binary"]) {
      expect(negativeFor("get naked", g, { moving: false })).toMatch(/\boverweight\b/);
    }
  });

  // The rule this whole file turns on: a negative cannot remove a part the body
  // must have, it just leaves it unrendered. Fat is optional; a stomach, a chin
  // and a face are not.
  it("names conditions, never a part everyone has", async () => {
    const { negativeFor } = await import("../media.functions");
    const n = negativeFor("get naked", "female", { moving: false });
    for (const part of ["chin", "face", "cheeks", "arms", "thighs", "hips"]) {
      expect(n).not.toMatch(new RegExp(`\b${part}\b`));
    }
    // "belly" only ever qualified, never bare.
    expect(n).not.toMatch(/(^|[^a-z])belly(?!\s+(fat|rolls))/);
  });
});
