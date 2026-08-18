import { describe, it, expect } from "vitest";
import { normalizeRequest, videoStillPrompt } from "../selfie";

// The chat message goes straight into "She is ___." so the ask has to be
// stripped and second person flipped, or the prompt is ungrammatical.
describe("normalizeRequest", () => {
  it("strips the ask and flips second person", () => {
    expect(normalizeRequest("send me a pic of you sticking a dildo in your ass", "she")).toBe(
      "sticking a dildo in her ass",
    );
    expect(normalizeRequest("show me your tits", "she")).toBe("her tits");
    expect(normalizeRequest("can you take a photo of yourself naked", "she")).toBe("herself naked");
    expect(normalizeRequest("i wanna see you bent over", "she")).toBe("bent over");
  });

  it("uses the right pronouns for a male companion", () => {
    expect(normalizeRequest("send me a pic of you touching yourself", "he")).toBe(
      "touching himself",
    );
  });

  it("leaves a plain description alone", () => {
    expect(normalizeRequest("lying on silk sheets", "she")).toBe("lying on silk sheets");
  });

  it("produces a grammatical sentence in the final prompt", () => {
    const p = videoStillPrompt({ gender: "female" }, "send me a pic of you naked in the shower");
    expect(p).toMatch(/She is naked in the shower\./);
    expect(p).not.toMatch(/She is send me/);
  });
});

// "a video of you bouncing on a dick" produced "She is eo of she bouncing…":
// the noun list had vids? before videos?, so it matched "vid" and left "eo".
describe("noun-phrase requests", () => {
  it("strips a bare 'a video of' lead-in without eating the word", () => {
    expect(normalizeRequest("a video of you bouncing on a dick", "she")).toBe("bouncing on a dick");
    expect(normalizeRequest("a picture of you in the shower", "she")).toBe("in the shower");
    expect(normalizeRequest("a pic of yourself naked", "she")).toBe("herself naked");
  });
});
