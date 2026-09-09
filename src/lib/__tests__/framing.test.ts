import { describe, it, expect } from "vitest";
import { anatomyOf } from "../anatomy";
import {
  videoStillPrompt,
  videoActionPrompt,
  capPromptWords,
  finishMediaPrompt,
} from "../selfie";

const FEMALE = anatomyOf("female");

// Regression: an act-heavy request pulled the camera into the act and the head
// fell out of frame, because framing was appended AFTER the explicit tags and
// models weight early tokens hardest. Framing still leads every prompt.
//
// What changed: it no longer ends "Not a close-up, not cropped". That is a
// negation, and the renderer's text encoder cannot negate — it read `close-up,
// cropped` and a user was sent a headless torso. Framing is now stated only as
// what is in the frame and where the camera stands. See props.ts for the whole
// argument.
describe("framing comes first", () => {
  it("leads with framing that keeps her face in shot on an act-heavy request", () => {
    const p = videoStillPrompt(
      { gender: "female" },
      "a picture of you sticking a dildo in your ass",
    );
    expect(p.startsWith("Photograph of a woman indoors")).toBe(true);
    expect(p).toMatch(/her face clearly visible in the upper third/);
    // and the request still renders explicitly
    expect(p).toMatch(/dildo/i);
  });

  // An act request is framed head-to-knees rather than head-to-feet. A chat
  // photo is one frame of a 640px clip: put a whole standing figure in that and
  // the part the request was actually about is a few dozen pixels wide, which
  // is a large part of why users said the nudes looked bad.
  it("frames an act to her knees, so the act renders at a usable size", () => {
    const p = videoStillPrompt({ gender: "female" }, "fingering yourself on the bed");
    expect(p).toMatch(/from the top of her head down to her knees/);
    expect(p).not.toMatch(/three metres away/);
  });

  it("keeps the whole figure for a plain selfie with no act in it", () => {
    const p = videoStillPrompt({ gender: "female", name: "Raven" }, "");
    expect(p).toMatch(/^Full length photograph of a woman/);
    expect(p).toMatch(/from her head to her feet/);
  });

  it("leads with framing for video too", () => {
    expect(
      videoActionPrompt({ gender: "female", name: "Raven" }, "").startsWith(
        "Full length photograph of a woman",
      ),
    ).toBe(true);
  });

  // "standing" fights any request that carries its own posture — asked to ride,
  // she was described as standing and the motion came out wrong.
  it("drops the standing stance when the request has its own posture", () => {
    const p = videoActionPrompt({ gender: "female" }, "bouncing on a dick");
    expect(p.startsWith("Photograph of a woman indoors")).toBe(true);
    expect(p).not.toMatch(/woman standing/);
  });

  it("uses the companion's own pronouns in the framing sentence", () => {
    const male = videoStillPrompt({ gender: "male" }, "get naked");
    expect(male).toMatch(/^Photograph of a man indoors/);
    expect(male).toMatch(/his face clearly visible/);
  });
});

// "Send me a nude pic with your pussy close to my face" came back as a POV shot
// of mangled anatomy. The old close-up framing named no vantage point and no
// subject — "camera positioned close to her body, focus sharp on her body and
// details" — so the renderer picked both, and picked badly.
describe("a close-up request describes a real viewpoint", () => {
  const p = videoStillPrompt({ gender: "female" }, "nude pic with your pussy close to my face");

  it("says where the lens is and what fills the foreground", () => {
    expect(p).toMatch(/taken from between her open thighs looking up along her body/);
    expect(p).toMatch(/filling the centre foreground in sharp focus/);
    expect(p).toMatch(/thirty centimetres away/);
  });

  // A close-up prompt with no face in it is how a picture comes back as an
  // anonymous crop of a torso — which is exactly what this user was sent first.
  it("keeps her face in the composition", () => {
    expect(p).toMatch(/her face looking down into the lens at the top of the frame/);
  });

  it("puts the asker behind the lens instead of in the picture", () => {
    // "close to my face" reached the renderer verbatim and it drew a face there.
    expect(p).not.toMatch(/my face/i);
    expect(p).toMatch(/close to the camera/);
  });
});

// Nothing in the positive prompt may negate. Every one of these words, in a
// prompt, is a request for the thing it was meant to forbid.
describe("no negation reaches the renderer", () => {
  const requests = [
    "",
    "stick a dildo in your pussy",
    "nude pic with your pussy close to my face",
    "show me your tits",
    "naked in the shower",
    "get naked",
    "wearing your red dress at dinner",
    "bent over the counter",
  ];

  for (const req of requests) {
    it(`builds a still prompt with no negation for "${req || "(no request)"}"`, () => {
      const p = videoStillPrompt({ gender: "female", name: "Raven" }, req);
      expect(p).not.toMatch(/\b(?:not|never|without|avoid|away from|instead of)\b/i);
      // "no X" was how the realism tail and the nudity clause both used to end
      // — "no airbrushing or smoothing", "no clothing on at all", "no text, no
      // watermark" — putting airbrushing, clothing, text and watermarks into
      // the conditioning of every picture the app has ever sent.
      expect(p).not.toMatch(/\bno \w/i);
    });
  }
});

// The renderer's text encoder takes a fixed number of tokens and silently drops
// the rest. The prompt for "sticking a dildo in your pussy" measured 607 words
// before this cap, so the realism tail and the held-pose instruction — both
// written last on purpose — never reached the renderer at all.
describe("capPromptWords", () => {
  it("leaves a prompt that already fits completely alone", () => {
    const short = "A woman on a bed. Candid photograph.";
    expect(capPromptWords(short)).toBe(short);
  });

  it("brings an over-long prompt under the budget", () => {
    const long = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
    expect(capPromptWords(long).split(/\s+/).length).toBeLessThanOrEqual(300);
  });

  it("keeps the realism tail across the cut", () => {
    const long = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
    expect(capPromptWords(long)).toMatch(/Candid raw photograph on a real camera/);
  });

  // finishMediaPrompt is the single exit point every prompt leaves through,
  // refined or built, so that is where the budget is enforced and where it has
  // to be checked.
  it("keeps every real prompt this app sends inside the budget", () => {
    for (const req of [
      "",
      "send me a picture of you sticking a big dildo in your pussy",
      "nude pic with your pussy close to my face",
      "fuck yourself with a magic wand while bent over",
    ]) {
      const p = finishMediaPrompt(videoStillPrompt({ gender: "female", name: "Raven" }, req), req, {
        anatomy: FEMALE,
      });
      expect(`${req} -> ${p.split(/\s+/).length <= 300}`).toBe(`${req} -> true`);
    }
  });
});

// The refined prompt is what production actually renders — Grok replaces the
// builder wholesale whenever it answers. Everything the builders guarantee has
// to survive that swap, which is what finishMediaPrompt is for.
describe("finishMediaPrompt on the refined path", () => {
  const req = "send me a picture of you sticking a dildo in your pussy";
  // Shaped like real refiner output: comma-separated fragments, no full stop.
  const refined =
    "exact same woman as the reference image, identical face, hair and skin, completely nude, " +
    "framed from the top of her head down to her knees, lying back with her knees raised, " +
    "dildo inserted into her pussy, warm bedside lamplight, candid raw photograph";

  it("appends the prop specification, which the refiner cannot be trusted to write", () => {
    const p = finishMediaPrompt(refined, req, { anatomy: FEMALE, appendProps: true });
    expect(p).toMatch(/matte silicone/);
    expect(p).toMatch(/as long as her hand/);
  });

  it("ends the refiner's last fragment before starting the specification", () => {
    // A bare space ran them together: "…candid raw photograph The toy is…".
    const p = finishMediaPrompt(refined, req, { anatomy: FEMALE, appendProps: true });
    expect(p).not.toMatch(/photograph The toy/);
    expect(p).toMatch(/photograph\. The toy/);
  });

  it("rewrites a toy the refiner described as held, when it was asked to be inserted", () => {
    const p = finishMediaPrompt(
      "exact same woman as the reference image, completely nude, holding a large dildo, bedroom",
      req,
      { anatomy: FEMALE, appendProps: false },
    );
    expect(p).not.toMatch(/holding a large dildo/);
    expect(p).toMatch(/inserted between her open thighs/);
  });

  it("leaves a toy alone when the request really was for her to hold it", () => {
    const held = "exact same woman as the reference image, completely nude, holding a dildo";
    expect(finishMediaPrompt(held, "holding a dildo and smiling", { anatomy: FEMALE })).toMatch(
      /holding a dildo/,
    );
  });

  it("keeps the refined path inside the budget too", () => {
    const p = finishMediaPrompt(refined, req, { anatomy: FEMALE, appendProps: true });
    expect(p.split(/\s+/).length).toBeLessThanOrEqual(300);
  });
});

// A chat photo is one frame cut out of the tail of a clip. If the clip never
// arrives anywhere, the frame is of someone mid-movement — smeared hands, a
// prop between two positions, a body still forming out of the start frame.
describe("a photo prompt ends somewhere still", () => {
  it("adds the cue to a refined prompt, which has no reason to end that way", () => {
    const p = finishMediaPrompt(
      "exact same woman as the reference image, completely nude, lying back on the bed, warm lamplight, candid raw photograph",
      "get naked",
      { anatomy: FEMALE, still: true },
    );
    expect(p).toMatch(/held completely still and the camera is locked off/);
  });

  it("does not repeat itself when the builder already said so", () => {
    const built = videoStillPrompt({ gender: "female", name: "Raven" }, "get naked");
    const p = finishMediaPrompt(built, "get naked", { anatomy: FEMALE, still: true });
    expect(p.match(/still held pose|held completely still/g)).toHaveLength(1);
  });

  // The cue has to survive the word cap, which takes from the end — and the cue
  // is at the end. It was being deleted on the longest prompt the app builds,
  // which is the dildo request: the one where a mid-motion frame does the most
  // visible damage.
  it("survives the cap on the longest prompt this app builds", () => {
    const req = "send me a picture of you sticking a big dildo in your pussy";
    const p = finishMediaPrompt(videoStillPrompt({ gender: "female", name: "Raven" }, req), req, {
      anatomy: FEMALE,
      still: true,
    });
    expect(p).toMatch(/held pose|held completely still/);
    expect(p.split(/\s+/).length).toBeLessThanOrEqual(300);
  });

  it("leaves a video alone, which is supposed to move", () => {
    const p = finishMediaPrompt("a woman dancing in a bedroom, warm light", "dance for me", {
      anatomy: FEMALE,
    });
    expect(p).not.toMatch(/locked off/);
  });
});
