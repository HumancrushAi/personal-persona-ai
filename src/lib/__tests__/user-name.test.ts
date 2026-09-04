import { describe, it, expect } from "vitest";
import { isRealName, extractName, askedForName, hasUsableName } from "../user-name";

describe("hasUsableName", () => {
  // The whole reason this exists: every profile is seeded with the email local
  // part, and companions were greeting people with it. Real rows from the
  // production profiles table, with the address each was seeded from.
  const handles: [string, string][] = [
    ["lgtopseller", "lgtopseller@yahoo.com"],
    ["nft.king137", "nft.king137@gmail.com"],
    ["web2.olumaths", "web2.olumaths@gmail.com"],
    ["oluwhizzy111", "oluwhizzy111@gmail.com"],
  ];
  for (const [name, email] of handles) {
    it(`knows "${name}" is just the email handle`, () => {
      expect(`${name} -> ${hasUsableName(name, email)}`).toBe(`${name} -> false`);
    });
  }

  it("accepts a name the user actually gave", () => {
    expect(hasUsableName("Dave", "lgtopseller@yahoo.com")).toBe(true);
  });

  it("has no name at all when the profile is empty", () => {
    expect(hasUsableName(null, "a@b.com")).toBe(false);
  });

  it("assumes not-known when the email is unavailable", () => {
    // Without an address there is no way to tell "lgtopseller" from "Dave", and
    // asking again is far cheaper than greeting somebody by their email handle.
    expect(hasUsableName("Dave", null)).toBe(false);
    expect(hasUsableName("lgtopseller", undefined)).toBe(false);
  });
});

describe("isRealName", () => {
  const names = ["Dave", "Maria", "Jean-Luc", "O'Brien", "Ada Lovelace", "Test Account"];
  for (const n of names) {
    it(`accepts "${n}"`, () => {
      expect(`${n} -> ${isRealName(n)}`).toBe(`${n} -> true`);
    });
  }

  it("rejects digits, dots and symbols outright", () => {
    for (const v of ["nft.king137", "web2.olumaths", "user_42", "a@b"]) {
      expect(`${v} -> ${isRealName(v)}`).toBe(`${v} -> false`);
    }
  });

  it("rejects empty, single characters and filler words", () => {
    const values: (string | null | undefined)[] = ["", " ", "a", "ok", "good", null, undefined];
    for (const v of values) {
      expect(isRealName(v)).toBe(false);
    }
  });
});

describe("extractName", () => {
  const explicit: [string, string][] = [
    ["my name is Dave", "Dave"],
    ["My name's Sarah", "Sarah"],
    ["call me Mike", "Mike"],
    ["i'm Tom", "Tom"],
    ["im Alex", "Alex"],
    ["I am Priya", "Priya"],
    ["it's Jordan", "Jordan"],
    ["this is Sam", "Sam"],
  ];
  for (const [input, expected] of explicit) {
    it(`reads "${input}" as ${expected}`, () => {
      expect(extractName(input, false)).toBe(expected);
    });
  }

  it("title-cases what it captures", () => {
    expect(extractName("my name is dave", false)).toBe("Dave");
  });

  it("strips trailing punctuation", () => {
    expect(extractName("i'm Dave!", false)).toBe("Dave");
  });

  // The failure that would be worst: greeting somebody as "Good" forever
  // because they answered "I'm good".
  const notNames = ["i'm good", "im fine", "i'm bored", "i'm horny", "it's ok", "i'm just waiting"];
  for (const input of notNames) {
    it(`refuses to take a name from "${input}"`, () => {
      expect(`${input} -> ${extractName(input, false)}`).toBe(`${input} -> null`);
    });
  }

  it("accepts a bare name only when she actually asked", () => {
    expect(extractName("Dave", true)).toBe("Dave");
    expect(extractName("Dave", false)).toBe(null);
  });

  it("ignores a long sentence even when she asked", () => {
    expect(extractName("well that depends on who is asking honestly", true)).toBe(null);
  });
});

describe("askedForName", () => {
  const asks = [
    "what's your name?",
    "What should I call you?",
    "tell me your name, baby?",
    "who am I talking to?",
  ];
  for (const a of asks) {
    it(`recognises "${a}"`, () => {
      expect(`${a} -> ${askedForName(a)}`).toBe(`${a} -> true`);
    });
  }

  it("does not fire on ordinary questions", () => {
    expect(askedForName("how was your day?")).toBe(false);
    expect(askedForName("what's your name")).toBe(false); // no question mark
    expect(askedForName(null)).toBe(false);
  });
});
