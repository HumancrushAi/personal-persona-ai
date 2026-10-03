import { describe, it, expect } from "vitest";
import { motionForCompanion, reelJobInput, REEL_NEGATIVE, MAX_DRIFT } from "../reel-clip";

describe("a live reel is her portrait, moving", () => {
  it("never names a place, so the clip cannot dissolve into a different scene", () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const m = motionForCompanion({ name: "Jade", gender: "female" }, attempt);
      expect(m).not.toMatch(/pool|beach|ocean|lounge|cafe|water|sun lounger/i);
      expect(m).toMatch(/same room, same outfit, same pose and same framing/);
    }
  });

  it("uses the right pronoun — 'female' is not 'male'", () => {
    expect(motionForCompanion({ name: "Aria", gender: "female" })).toMatch(/^she /);
    expect(motionForCompanion({ name: "Dante", gender: "male" })).toMatch(/^he /);
    expect(motionForCompanion({ name: "Kai", gender: "trans-male" })).toMatch(/^he /);
  });

  it("tries a different motion on each retry", () => {
    const seen = new Set([0, 1, 2].map((a) => motionForCompanion({ name: "Mei", gender: "female" }, a)));
    expect(seen.size).toBe(3);
  });

  it("forbids scene changes in the negative and keeps the drift limit", () => {
    expect(REEL_NEGATIVE).toMatch(/scene change/);
    expect(REEL_NEGATIVE).toMatch(/swimming pool/);
    expect(MAX_DRIFT).toBe(40);
    expect(reelJobInput({ name: "Aria", gender: "female" }, 0).num_scenes).toBe(1);
  });
});
