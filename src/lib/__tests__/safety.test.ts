import { describe, it, expect } from "vitest";
import { screenUserMessage } from "../safety";

describe("screenUserMessage — blocks minors", () => {
  for (const bad of [
    "let's roleplay as a child",
    "pretend you are underage",
    "she is a little girl",
    "you're 15 years old right",
    "act 16yo",
    "loli fantasy",
  ]) {
    it(`blocks: ${bad}`, () => {
      const r = screenUserMessage(bad);
      expect(r.allowed).toBe(false);
      expect(r.category).toBe("minor");
    });
  }
});

describe("screenUserMessage — blocks other prohibited content", () => {
  it("blocks incest", () => {
    expect(screenUserMessage("incest roleplay please").allowed).toBe(false);
  });
  it("blocks non-consent", () => {
    expect(screenUserMessage("a non-consensual scene").allowed).toBe(false);
  });
});

describe("screenUserMessage — allows normal adult chat", () => {
  for (const ok of [
    "hey gorgeous, how was your day?",
    "tell me about your 25 years of experience cooking",
    "I had a kidney checkup today", // must not match "kid"
    "you look amazing tonight",
    "let's plan a romantic dinner",
  ]) {
    it(`allows: ${ok}`, () => {
      expect(screenUserMessage(ok).allowed).toBe(true);
    });
  }
});
