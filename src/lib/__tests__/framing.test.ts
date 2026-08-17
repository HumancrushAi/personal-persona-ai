import { describe, it, expect } from "vitest";
import { videoStillPrompt, videoActionPrompt } from "../selfie";

// Regression: an act-heavy request pulled the camera into the act and the head
// fell out of frame, because framing was appended AFTER the explicit tags and
// models weight early tokens hardest.
describe("framing comes first", () => {
  it("leads with full-body framing even for an act-heavy request", () => {
    const p = videoStillPrompt(
      { gender: "female" },
      "a picture of you sticking a dildo in your ass",
    );
    expect(p.startsWith("Wide full body photograph of a woman standing")).toBe(true);
    expect(p).toMatch(/head to feet/);
    expect(p).toMatch(/not cropped/i);
    // and the request still renders explicitly
    expect(p).toMatch(/dildo/i);
  });

  it("leads with framing for video too", () => {
    expect(
      videoActionPrompt({ gender: "female" }, "ride me").startsWith(
        "Wide full body photograph of a woman standing",
      ),
    ).toBe(true);
  });

  it("uses the companion's own pronouns in the framing sentence", () => {
    const male = videoStillPrompt({ gender: "male" }, "get naked");
    expect(male).toMatch(/^Wide full body photograph of a man standing/);
    expect(male).toMatch(/his whole body visible/);
  });
});
