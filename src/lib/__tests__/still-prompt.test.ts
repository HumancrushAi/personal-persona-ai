import { describe, it, expect } from "vitest";
import { videoStillPrompt } from "../selfie";

// Photos run on the image-to-video endpoint, so the prompt has to drive the
// clip INTO the explicit state and hold it — the frame shown is near the end.
describe("videoStillPrompt", () => {
  it("undresses on an explicit request and ends held still", () => {
    const p = videoStillPrompt({ gender: "female" }, "take your top off and show me your tits");
    expect(p).toMatch(/removes all clothing/i);
    expect(p).toMatch(/bare breasts/i);
    expect(p).toMatch(/holding still/i);
  });

  it("uses male anatomy for male companions", () => {
    const p = videoStillPrompt({ gender: "male" }, "get naked");
    expect(p).toMatch(/penis and groin/i);
    expect(p).not.toMatch(/bare breasts/i);
  });

  it("keeps a clothed request clothed", () => {
    const p = videoStillPrompt({ gender: "female" }, "wearing your red dress at dinner");
    expect(p).not.toMatch(/removes all clothing/i);
    expect(p).toMatch(/holds the pose/i);
  });

  it("defaults to explicit when nothing is asked for", () => {
    expect(videoStillPrompt({ gender: "female" }, "")).toMatch(/removes all clothing/i);
  });
});

// Scenes written by hand in the video studio are the user's own words. They get
// the house framing/quality tail but must NOT have undressing vocabulary bolted
// on — writing the scene yourself is the point.
describe("scenePrompt", () => {
  it("keeps the user's scene verbatim and appends house style", async () => {
    const { scenePrompt } = await import("../selfie");
    const p = scenePrompt("Standing in a marble shower, water running down her body");
    expect(p).toMatch(/^Standing in a marble shower, water running down her body/);
    expect(p).toMatch(/Full body visible head to toe/);
    expect(p).toMatch(/photorealistic 8k/i);
  });

  it("does not inject undressing instructions of its own", async () => {
    const { scenePrompt } = await import("../selfie");
    expect(scenePrompt("sitting at a cafe in a red dress")).not.toMatch(/removes all clothing/i);
  });
});
