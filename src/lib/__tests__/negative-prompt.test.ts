import { describe, it, expect } from "vitest";
import { negativeFor } from "../media.functions";

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
      expect(male).toMatch(/female breasts/);
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
      expect(negativeFor("wearing your red dress at dinner", "female", { moving: false })).not.toMatch(
        /\bbra\b/,
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
