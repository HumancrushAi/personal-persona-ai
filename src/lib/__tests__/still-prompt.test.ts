import { describe, it, expect } from "vitest";
import { stillImagePrompt, videoStillPrompt } from "../selfie";

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
    expect(still).toMatch(/smoothly shaved vulva/i);
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
