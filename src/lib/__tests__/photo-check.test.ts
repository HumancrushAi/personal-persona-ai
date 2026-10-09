import { describe, expect, it } from "vitest";
import {
  attemptsSoFar,
  bestCandidate,
  candidateLine,
  parseCandidates,
  parseScore,
  shouldRetake,
  verifyQuestion,
} from "../photo-check";

describe("which photos get checked", () => {
  it("asks the right question per act", () => {
    expect(verifyQuestion("send me a picture of you licking your tits", true)).toMatch(/OWN nipple/);
    expect(verifyQuestion("sucking on a dildo", true)).toMatch(/sex toy/);
    expect(verifyQuestion("stick out your tongue", true)).toMatch(/tongue sticking out/);
    expect(verifyQuestion("suck on your fingers", true)).toMatch(/finger/);
  });

  it("checks nothing for an ordinary request, or a breast act on a body without breasts", () => {
    expect(verifyQuestion("send me a selfie", true)).toBeNull();
    expect(verifyQuestion("show me your pussy", true)).toBeNull();
    expect(verifyQuestion("licking your tits", false)).toBeNull();
  });
});

describe("scores and candidates", () => {
  it("reads the number the model was told to write", () => {
    expect(parseScore("8")).toBe(8);
    expect(parseScore("Score: 10/10")).toBe(10);
    expect(parseScore("I can't help with that")).toBeNull();
  });

  it("round-trips candidates through the error column", () => {
    const err = [
      "retry 1 after: Job processing failed — VRAM",
      candidateLine(1, 3, "https://x/a.jpg"),
      candidateLine(2, null, "https://x/b.jpg"),
    ].join("\n");
    expect(parseCandidates(err)).toEqual([
      { url: "https://x/a.jpg", score: 3 },
      { url: "https://x/b.jpg", score: null },
    ]);
    expect(attemptsSoFar(err)).toBe(2);
    expect(attemptsSoFar(null)).toBe(0);
  });

  it("picks the highest score, never an unscored one over a scored one", () => {
    expect(
      bestCandidate([
        { url: "a", score: 3 },
        { url: "b", score: null },
        { url: "c", score: 6 },
      ]).url,
    ).toBe("c");
    expect(bestCandidate([{ url: "a", score: null }, { url: "b", score: null }]).url).toBe("b");
  });

  it("retakes a failing score until the retakes run out, and never a blind one", () => {
    expect(shouldRetake(3, 0, 2)).toBe(true);
    expect(shouldRetake(3, 2, 2)).toBe(false);
    expect(shouldRetake(8, 0, 2)).toBe(false);
    expect(shouldRetake(null, 0, 2)).toBe(false);
  });
});
