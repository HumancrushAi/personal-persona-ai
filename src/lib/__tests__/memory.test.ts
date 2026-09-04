import { describe, it, expect } from "vitest";
import { parseMemory, formatMemory, mergeFacts, looksFactual, parseExtraction } from "../memory";

describe("mergeFacts", () => {
  // The reason the format changed. The old store appended blindly, so a user
  // who moved had both cities in a prompt headed "do not contradict".
  it("corrects a single-value fact instead of keeping both", () => {
    const merged = mergeFacts(
      [{ key: "city", value: "Leeds" }],
      [{ key: "city", value: "Manchester" }],
    );
    expect(merged).toEqual([{ key: "city", value: "Manchester" }]);
  });

  it("keeps several values for a multi-value key", () => {
    const merged = mergeFacts(
      [{ key: "likes", value: "football" }],
      [{ key: "likes", value: "whisky" }],
    );
    expect(merged.map((f) => f.value)).toEqual(["football", "whisky"]);
  });

  it("does not store the same thing twice", () => {
    const merged = mergeFacts(
      [{ key: "likes", value: "football" }],
      [{ key: "likes", value: "Football." }],
    );
    expect(merged).toHaveLength(1);
  });

  it("drops the oldest chatter first and never drops who they are", () => {
    const existing = [
      { key: "name", value: "Dave" },
      ...Array.from({ length: 45 }, (_, i) => ({ key: "likes", value: `thing ${i}` })),
    ];
    const merged = mergeFacts(existing, [{ key: "likes", value: "one more" }]);
    expect(merged).toHaveLength(40);
    expect(merged[0]).toEqual({ key: "name", value: "Dave" });
    expect(merged.at(-1)).toEqual({ key: "likes", value: "one more" });
  });

  // A stored age is injected into every future prompt as ground truth, so it
  // is the one fact that has to be impossible to get wrong.
  it("refuses to store a minor", () => {
    expect(mergeFacts([], [{ key: "age", value: "15" }])).toEqual([]);
    expect(mergeFacts([], [{ key: "note", value: "he is a teenager" }])).toEqual([]);
    expect(mergeFacts([], [{ key: "age", value: "24" }])).toEqual([{ key: "age", value: "24" }]);
  });

  it("refuses to store a mood as if it were permanent", () => {
    expect(mergeFacts([], [{ key: "mood", value: "tired" }])).toEqual([]);
    expect(mergeFacts([], [{ key: "plans", value: "going out tonight" }])).toEqual([]);
  });
});

describe("parseMemory", () => {
  it("reads back what formatMemory wrote", () => {
    const facts = [
      { key: "name", value: "Dave" },
      { key: "city", value: "Manchester" },
    ];
    expect(parseMemory(formatMemory(facts))).toEqual(facts);
  });

  // Memory written before the key:value format existed must not be thrown away.
  it("keeps legacy free-text lines as notes", () => {
    expect(parseMemory("- works nights at a warehouse")).toEqual([
      { key: "note", value: "works nights at a warehouse" },
    ]);
  });

  it("survives empty and missing input", () => {
    expect(parseMemory(null)).toEqual([]);
    expect(parseMemory("")).toEqual([]);
    expect(parseMemory("\n\n  \n")).toEqual([]);
  });
});

describe("looksFactual", () => {
  const worth = [
    "i'm dave",
    "i live in manchester now",
    "my dog is called rex",
    "i work nights at a warehouse",
    "i hate coriander",
  ];
  for (const t of worth) {
    it(`spends a call on "${t}"`, () => {
      expect(`${t} -> ${looksFactual(t)}`).toBe(`${t} -> true`);
    });
  }

  const notWorth = ["mmm", "keep going", "yes", "you're so hot", "😍😍"];
  for (const t of notWorth) {
    it(`skips "${t}"`, () => {
      expect(`${t} -> ${looksFactual(t)}`).toBe(`${t} -> false`);
    });
  }
});

describe("parseExtraction", () => {
  it("reads key: value lines", () => {
    expect(parseExtraction("name: Dave\ncity: Manchester")).toEqual([
      { key: "name", value: "Dave" },
      { key: "city", value: "Manchester" },
    ]);
  });

  it("treats NONE as nothing learned", () => {
    expect(parseExtraction("NONE")).toEqual([]);
    expect(parseExtraction("none")).toEqual([]);
    expect(parseExtraction(null)).toEqual([]);
  });

  it("discards output that is not in the format", () => {
    expect(parseExtraction("Sure! Here is what I found about the user")).toEqual([]);
  });

  it("strips list numbering the model adds anyway", () => {
    expect(parseExtraction("1. job: welder")).toEqual([{ key: "job", value: "welder" }]);
  });

  it("will not let the extractor smuggle a minor through", () => {
    expect(parseExtraction("age: 16")).toEqual([]);
    expect(parseExtraction("note: chatting with a schoolgirl")).toEqual([]);
  });
});
