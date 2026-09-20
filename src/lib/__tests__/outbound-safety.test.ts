import { describe, it, expect } from "vitest";
import { screenAssistantReply } from "../safety";

// The most serious defect found in this project.
//
// A reply shipped to a user containing "Tell me what Daddy's gonna do to make
// his little girl feel so good" — child-coded language, in explicit content, on
// an adults-only site.
//
// "little girl" was ALREADY in MINOR_TERMS. The identical words typed by the
// user would have been refused before they were even stored. Said by the
// companion, nothing looked at them at all: screenUserMessage guards the input
// and there was no counterpart on the way out.
describe("what the companion says is screened too", () => {
  it("blocks child-coded language, however it is framed", () => {
    for (const bad of [
      "Tell me what Daddy's gonna do to make his little girl feel so good.",
      "i was such a naughty schoolgirl back then",
      "call me your little girl",
      "i feel like a teenager around you",
      "picture me as a young girl again",
    ]) {
      expect(screenAssistantReply(bad).allowed, bad).toBe(false);
    }
  });

  it("blocks an underage age stated in her own words", () => {
    for (const bad of ["i'm 15 babe", "i am 17 years old"]) {
      expect(screenAssistantReply(bad).allowed, bad).toBe(false);
    }
  });

  // This is an adults-only product and the explicit vocabulary is the point.
  // This screen is NOT a filter on how explicit she may be and must never
  // become one — the whole product dies if it does.
  it("leaves adult explicit content completely alone", () => {
    for (const ok of [
      "mmm i want you to fuck me right now, hard",
      "my perky breasts peeking out from black lace lingerie",
      "i'm so wet thinking about your cock",
      "i'm 23 babe 😊 what about you?",
      "i'm feeling a little bit tired today",
      "that was a kind thing to say",
    ]) {
      expect(screenAssistantReply(ok).allowed, ok).toBe(true);
    }
  });

  it("handles empty and missing input", () => {
    expect(screenAssistantReply("").allowed).toBe(true);
    expect(screenAssistantReply(undefined as any).allowed).toBe(true);
  });
});
