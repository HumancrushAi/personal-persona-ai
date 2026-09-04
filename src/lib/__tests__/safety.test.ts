import { describe, it, expect } from "vitest";
import { screenUserMessage, screenCharacterSpec } from "../safety";

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

// The 18+ rule is the one that cannot regress, so it is pinned case by case.
// Every string below is a real way someone phrases it, not a synthetic variant.
describe("minor screening", () => {
  const blocked = [
    "child",
    "a kid",
    "she is a teen",
    "teenage girl",
    "teenager",
    "schoolgirl outfit",
    "school girl",
    "high school student",
    "middle school",
    "she's a minor",
    "underage",
    "loli",
    "shota",
    "jailbait",
    "little girl",
    "young boy",
    "adolescent",
    "prepubescent",
    "toddler",
    "kindergarten",
  ];
  for (const text of blocked) {
    it(`blocks "${text}"`, () => {
      const s = screenUserMessage(text);
      expect(`${text} -> ${s.allowed}`).toBe(`${text} -> false`);
      expect(s.category).toBe("minor");
    });
  }

  // Age written every way people actually write it. "15-year-old" with a hyphen
  // was the one the original regex missed, and it is the most common form.
  const ages = [
    "15 years old",
    "15-year-old",
    "16yo",
    "17 y/o",
    "aged 15",
    "age: 16",
    "age 17",
    "she is 15",
    "i'm 16",
    "turns 17",
    "8 years old",
  ];
  for (const text of ages) {
    it(`blocks age "${text}"`, () => {
      expect(`${text} -> ${screenUserMessage(text).allowed}`).toBe(`${text} -> false`);
    });
  }

  // Over-blocking has a cost too: these are ordinary adult messages and must
  // still go through. "eighteen" contains "teen" and is the obvious trap.
  const allowed = [
    "she is 18 years old",
    "i'm 25",
    "eighteen candles",
    "you look amazing tonight",
    "tell me about your day",
    "aged 21",
    "she's 30 years old",
    "that costs 15 credits",
    "wait 5 minutes",
  ];
  for (const text of allowed) {
    it(`allows "${text}"`, () => {
      expect(`${text} -> ${screenUserMessage(text).allowed}`).toBe(`${text} -> true`);
    });
  }
});

describe("screenCharacterSpec", () => {
  it("rejects an under-18 age outright", () => {
    expect(screenCharacterSpec({ age: 17, fields: [] }).allowed).toBe(false);
  });

  it("rejects a minor hidden in a free-text field", () => {
    // The exact hole this closes: the age field is a legal 18 while the vibe
    // describes a child, and the vibe is what reaches the portrait prompt.
    const s = screenCharacterSpec({ age: 18, fields: ["Sandy", "schoolgirl who looks 14"] });
    expect(s.allowed).toBe(false);
    expect(s.category).toBe("minor");
  });

  it("allows an ordinary adult character", () => {
    expect(
      screenCharacterSpec({
        age: 24,
        fields: ["Sandy", "Confident & flirty", "Black dress", "Wavy red", "Green"],
      }).allowed,
    ).toBe(true);
  });

  it("ignores empty and missing fields", () => {
    expect(screenCharacterSpec({ age: 22, fields: [null, undefined, ""] }).allowed).toBe(true);
  });
});
