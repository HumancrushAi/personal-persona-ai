import { describe, it, expect } from "vitest";
import { videoStillPrompt } from "../selfie";

// Photos run on the image-to-video endpoint, so the prompt has to drive the
// clip INTO the explicit state and hold it — the frame shown is near the end.
describe("videoStillPrompt", () => {
  it("undresses on an explicit request and ends held still", () => {
    const p = videoStillPrompt({ gender: "female" }, "take your top off and show me your tits");
    expect(p).toMatch(/completely naked/i);
    expect(p).toMatch(/bare breasts/i);
    expect(p).toMatch(/still held pose/i);
  });

  it("uses male anatomy for male companions", () => {
    const p = videoStillPrompt({ gender: "male" }, "get naked");
    expect(p).toMatch(/penis and groin/i);
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
});

// Realism regression. "8k masterpiece ultra detailed" pushes the render toward
// the glossy CG look people read instantly as AI; camera language plus explicit
// permission for real skin texture is what actually buys photorealism.
describe("realism tail", () => {
  it("asks for camera and real skin, not render vocabulary", () => {
    const p = videoStillPrompt({ gender: "female" }, "");
    expect(p).toMatch(/candid photograph/i);
    expect(p).toMatch(/pores/i);
    expect(p).toMatch(/no airbrushing|no retouching/i);
  });

  it("does not use the AI-slop quality words", () => {
    const p = videoStillPrompt({ gender: "female" }, "");
    expect(p).not.toMatch(/\b8k\b/i);
    expect(p).not.toMatch(/masterpiece/i);
  });
});
