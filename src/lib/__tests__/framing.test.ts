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
    expect(p.startsWith("Wide full body photograph of a woman in a room")).toBe(true);
    expect(p).toMatch(/head to feet/);
    expect(p).toMatch(/not cropped/i);
    // and the request still renders explicitly
    expect(p).toMatch(/dildo/i);
  });

  it("leads with framing for video too", () => {
    expect(
      videoActionPrompt({ gender: "female" }, "dance for me").startsWith(
        "Wide full body photograph of a woman in a room",
      ),
    ).toBe(true);
  });

  // "standing" fights any request that carries its own posture — asked to ride,
  // she was described as standing and the motion came out wrong.
  it("drops the standing stance when the request has its own posture", () => {
    const p = videoActionPrompt({ gender: "female" }, "bouncing on a dick");
    expect(p.startsWith("Wide full body photograph of a woman in a room")).toBe(true);
    expect(p).not.toMatch(/woman standing/);
  });

  it("uses the companion's own pronouns in the framing sentence", () => {
    const male = videoStillPrompt({ gender: "male" }, "get naked");
    expect(male).toMatch(/^Wide full body photograph of a man in a room/);
    expect(male).toMatch(/his whole body visible/);
  });
});
