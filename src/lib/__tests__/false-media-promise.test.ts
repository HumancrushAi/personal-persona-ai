import { describe, it, expect } from "vitest";
import { withoutFalseMediaPromise as strip } from "../chat.functions";

// "i asked for age, see what it gave me" — and what it gave was
// "mmm okay… give me a sec, taking one just for you 📸", with no photo coming.
//
// The app writes that teaser itself whenever a real render is queued, and it
// goes into the messages table as ordinary assistant text. Ten of them come
// back as history on the next turn and the model copies the pattern, because a
// pattern repeated ten times beats a sentence in a system prompt.
//
// Reaching the model at all means no media was queued — wantsSelfie and
// wantsVideo are checked long before it and return early — so a promise in the
// reply is false by construction and never reaches the user.
describe("a reply that promises a photo with none coming", () => {
  it("keeps the answer and drops the promise", () => {
    expect(strip("i'm 23 babe 😊 mmm okay, taking one just for you 📸")).toBe("i'm 23 babe 😊");
  });

  // She texts without full stops, so splitting on punctuation alone treated the
  // whole line as one sentence and threw the answer away with the promise.
  it("splits on an emoji, not only on a full stop", () => {
    expect(strip("i'm from Kyoto 💕 hold on, recording something just for you 🎬")).toBe(
      "i'm from Kyoto 💕",
    );
  });

  it("replaces a reply that was nothing but the promise", () => {
    for (const only of [
      "mmm okay… give me a sec, taking one just for you 📸",
      "mmm okay... taking a pic just for you 📸",
      "mmm okay… hold on, recording something just for you 🎬",
      "ok, snapping one for you 📸",
    ]) {
      const out = strip(only);
      expect(out).not.toMatch(/taking|recording|snapping/i);
      // Not an empty bubble either.
      expect(out.length).toBeGreaterThan(5);
    }
  });

  // "mmm okay…" left on its own is not an answer to anything.
  it("does not leave filler behind as the whole reply", () => {
    expect(strip("mmm okay... taking a pic just for you 📸")).not.toBe("mmm okay...");
  });

  it("leaves an ordinary reply completely alone", () => {
    for (const ok of [
      "i'm 23 babe 😊 what about you?",
      "i'm from Kyoto, born and raised 💕 what about you?",
      "mmm i love horror films and bad karaoke 😏 how naughty are YOU?",
      "tell me what you're imagining and let me picture it 😉",
    ]) {
      expect(strip(ok)).toBe(ok);
    }
  });

  it("handles an empty reply without throwing", () => {
    expect(strip("")).toBe("");
  });
});

// Anything put in an assistant turn is something she will say back. That is the
// lesson of this code and it has been learned three times:
//
//   1. "[sent a selfie]" — she typed it instead of letting the app send a pic.
//   2. "(the app delivered a real photo...)" — an annotation meant to fix (1),
//      which she copied too, because an annotation in an assistant turn is
//      still words in her mouth.
//   3. "(the app was already delivering media to the user at this point)" —
//      added to fix the teaser imitation, and promptly returned as her answer
//      to "how old are you?". That one shipped.
//
// So the shape is blocked on the way out, whatever the wording, whichever
// future edit reintroduces one.
describe("stage directions never reach the user", () => {
  it("blocks every form that has actually shipped", () => {
    for (const bad of [
      "(the app was already delivering media to the user at this point)",
      "(the app delivered a real photo to the user at this point)",
      "(the app delivered a real voice note to the user at this point)",
      "[sent a selfie]",
      "[sent a pic]",
      "*sends you a photo*",
      "*sends a video* 🎬",
    ]) {
      const out = strip(bad);
      expect(out, bad).not.toBe(bad);
      expect(out).not.toMatch(/the app|sent a|sends/i);
    }
  });

  it("leaves ordinary speech alone, including asterisks mid-sentence", () => {
    for (const ok of [
      "i'm 23 babe 😊 what about you?",
      "i'm good, just got out of the shower 😏 how are you?",
      "mmm i *love* that question 😏",
      "i'm from Kyoto 💕",
    ]) {
      expect(strip(ok)).toBe(ok);
    }
  });
});
