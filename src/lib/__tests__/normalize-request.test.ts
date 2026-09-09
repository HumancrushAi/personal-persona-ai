import { describe, it, expect } from "vitest";
import { normalizeRequest, videoStillPrompt, actionSentence } from "../selfie";

// The chat message goes straight into "She is ___." so the ask has to be
// stripped and second person flipped, or the prompt is ungrammatical.
describe("normalizeRequest", () => {
  it("strips the ask and flips second person", () => {
    expect(normalizeRequest("send me a pic of you sticking a dildo in your ass", "she")).toBe(
      "sticking a dildo in her ass",
    );
    expect(normalizeRequest("show me your tits", "she")).toBe("her tits");
    expect(normalizeRequest("can you take a photo of yourself naked", "she")).toBe("herself naked");
    expect(normalizeRequest("i wanna see you bent over", "she")).toBe("bent over");
  });

  it("uses the right pronouns for a male companion", () => {
    expect(normalizeRequest("send me a pic of you touching yourself", "he")).toBe(
      "touching himself",
    );
  });

  it("leaves a plain description alone", () => {
    expect(normalizeRequest("lying on silk sheets", "she")).toBe("lying on silk sheets");
  });

  it("produces a grammatical sentence in the final prompt", () => {
    const p = videoStillPrompt({ gender: "female" }, "send me a pic of you naked in the shower");
    expect(p).toMatch(/She is naked in the shower\./);
    expect(p).not.toMatch(/She is send me/);
  });
});

// "a video of you bouncing on a dick" produced "She is eo of she bouncing…":
// the noun list had vids? before videos?, so it matched "vid" and left "eo".
describe("noun-phrase requests", () => {
  it("strips a bare 'a video of' lead-in without eating the word", () => {
    expect(normalizeRequest("a video of you bouncing on a dick", "she")).toBe("bouncing on a dick");
    expect(normalizeRequest("a picture of you in the shower", "she")).toBe("in the shower");
    expect(normalizeRequest("a pic of yourself naked", "she")).toBe("herself naked");
  });
});

// "Send me a nude pic with your pussy close to my face" normalized to "her
// pussy close to my face" and went into the prompt as "She is her pussy close
// to my face." Two separate faults in one sentence, both of which the user saw:
// broken grammar the text encoder cannot parse, and the ASKER's face named
// inside a picture he is not in — so the renderer drew a face there.
describe("the person asking is behind the lens, not in the picture", () => {
  it("turns their face into the camera", () => {
    expect(normalizeRequest("your pussy close to my face", "she")).toBe(
      "her pussy close to the camera",
    );
    expect(normalizeRequest("put your tits in my face", "she")).toBe(
      "put her tits close to the camera",
    );
    expect(normalizeRequest("spread your legs right up close to my face", "she")).toBe(
      "spread her legs close to the camera",
    );
  });

  it("points her at the camera rather than at a person in the shot", () => {
    expect(normalizeRequest("smiling at me", "she")).toBe("smiling at the camera");
    expect(normalizeRequest("bending over towards me", "she")).toBe(
      "bending over toward the camera",
    );
  });

  it("leaves a request with no first person alone", () => {
    expect(normalizeRequest("lying on silk sheets", "she")).toBe("lying on silk sheets");
  });
});

// A noun phrase is not a predicate. "show me your tits" normalizes to "her
// tits", and the builder dropped that straight into "She is ___."
describe("actionSentence", () => {
  it("gives a noun phrase a verb", () => {
    expect(actionSentence("she", "her tits")).toBe("She is showing her tits.");
    expect(actionSentence("she", "her pussy close to the camera")).toBe(
      "She is showing her pussy close to the camera.",
    );
    expect(actionSentence("she", "a dildo in her pussy")).toBe(
      "She is showing a dildo in her pussy.",
    );
    expect(actionSentence("she", "dildo in pussy")).toBe("She is showing dildo in pussy.");
  });

  it("leaves anything that already reads as a predicate alone", () => {
    expect(actionSentence("she", "sticking a dildo in her pussy")).toBe(
      "She is sticking a dildo in her pussy.",
    );
    expect(actionSentence("she", "naked in the shower")).toBe("She is naked in the shower.");
    expect(actionSentence("she", "bent over the counter")).toBe("She is bent over the counter.");
    expect(actionSentence("she", "on all fours")).toBe("She is on all fours.");
  });

  // People ask in the imperative. "She is get naked." is not English, and the
  // text encoder is a language model — a clause it cannot parse is the clause
  // saying what the picture is of.
  it("turns an imperative into a gerund", () => {
    expect(actionSentence("she", "get naked")).toBe("She is getting naked.");
    expect(actionSentence("she", "spread her legs close to the camera")).toBe(
      "She is spreading her legs close to the camera.",
    );
    expect(actionSentence("she", "put her tits close to the camera")).toBe(
      "She is putting her tits close to the camera.",
    );
    expect(actionSentence("she", "take her top off")).toBe("She is taking her top off.");
    expect(actionSentence("she", "lie back on the bed")).toBe("She is lying back on the bed.");
    expect(actionSentence("he", "stroke his cock")).toBe("He is stroking his cock.");
  });

  it("agrees with the subject", () => {
    expect(actionSentence("he", "his cock")).toBe("He is showing his cock.");
    expect(actionSentence("they", "their body")).toBe("They are showing their body.");
  });

  it("says nothing when there is nothing to say", () => {
    expect(actionSentence("she", "  ")).toBe("");
  });
});

// The whole point of the two fixes above, checked where it lands.
describe("the sentence that reaches the renderer", () => {
  it("is grammatical for the request that broke", () => {
    const p = videoStillPrompt(
      { gender: "female" },
      "Send me a nude pic with your pussy close to my face",
    );
    expect(p).toMatch(/She is showing her pussy close to the camera\./);
    expect(p).not.toMatch(/She is her pussy/);
    expect(p).not.toMatch(/my face/i);
  });

  it("is grammatical for the plainest request there is", () => {
    const p = videoStillPrompt({ gender: "female" }, "show me your tits");
    expect(p).toMatch(/She is showing her tits\./);
    expect(p).not.toMatch(/She is her tits/);
  });
});
