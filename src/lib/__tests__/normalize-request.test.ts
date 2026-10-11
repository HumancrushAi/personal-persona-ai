import { describe, it, expect } from "vitest";
import {
  normalizeRequest,
  videoStillPrompt,
  actionSentence,
  finishMediaPrompt,
  resolveMediaRequest,
  isDemonstrativeMediaRequest,
} from "../selfie";
import { anatomyOf } from "../anatomy";

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

// Every one of these is a request a real user typed, read back out of the
// job history, and every one reached the renderer broken: "She is Yes. Show
// me her tits.", "She is nother with her legs spread.", "She is dirty picture
// of she naked.", "She is I had a rough day, show me her tits."
describe("requests the way people actually type them", () => {
  const say = (r: string) => actionSentence("she", normalizeRequest(r, "she"));

  it("drops the small talk around the ask", () => {
    expect(say("Yes. Show me your tits")).toBe("She is showing her tits.");
    expect(say("Hi. Send me a nude selfie")).toBe("");
    expect(say("I had a rough day, show me your tits")).toBe("She is showing her tits.");
    expect(say("Ok thrn take a dildo and shove it in your pussy")).toBe(
      "She is taking a dildo and shoving it in her pussy.",
    );
    expect(say("Send me a picture of this! Im getting so horny")).toBe("");
    expect(say("Send it to me. Send me a picture of you licking your tits")).toBe(
      "She is licking her tits.",
    );
    expect(say("Hi, can you send me a video?")).toBe("");
  });

  it("strips the ask in every shape it comes in", () => {
    expect(
      say("I want you to send me a picture of you eating a strawberry naked with stocking on"),
    ).toBe("She is eating a strawberry naked with stocking on.");
    expect(say("I said I wanted a NUDE photo not clothed!")).toBe("She is naked.");
    expect(say("Sned me a sexy nude Pic")).toBe("");
    expect(say("Can you send me a dirtier picture")).toBe("");
    expect(say("Can you send me a cute selfie?")).toBe("");
    expect(say("send me a nasty photo of you")).toBe("");
    expect(say("Send me dirty picture of you naked")).toBe("She is naked.");
    expect(say("Send me a sexxy picture in lingerie with your pussy showing")).toBe(
      "She is in lingerie with her pussy showing.",
    );
    expect(say("Send a pic of putting a dildo in your pussy")).toBe(
      "She is putting a dildo in her pussy.",
    );
    expect(say("send me another like a potrait of your face")).toBe("She is showing her face.");
  });

  it("does not eat the first letter of 'another'", () => {
    expect(say("Send me another with your legs spread")).toBe("She is with her legs spread.");
    expect(normalizeRequest("Send another one", "she")).toBe("");
  });

  it("knows 'you' after a preposition is her, not she", () => {
    expect(normalizeRequest("a photo with you on top of me", "she")).toBe(
      "on top, straddling, seen from below",
    );
    expect(say("send me a pic of you in the shower with you looking at me")).toBe(
      "She is in the shower with her looking at the camera.",
    );
  });

  it("turns a second 'show me' into what she does", () => {
    expect(say("Spread your legs and show me your pussy")).toBe(
      "She is spreading her legs and showing her pussy.",
    );
    expect(say("bend over and let me see your ass")).toBe("She is bending over and showing her ass.");
    expect(say("show me what you're wearing")).toBe("She is showing what she is wearing.");
  });

  it("keeps the pose when the message is all picture", () => {
    expect(say("lying on the bed, spread your legs")).toBe(
      "She is lying on the bed, spreading her legs.",
    );
    expect(say("take off your top")).toBe("She is taking off her top.");
    expect(say("take your bra off and show me your tits")).toBe(
      "She is taking her bra off and showing her tits.",
    );
    expect(say("make yourself cum")).toBe("She is making herself cum.");
    expect(say("get naked")).toBe("She is getting naked.");
    expect(say("licking your tits please babe!! 😍")).toBe("She is licking her tits.");
  });

  it("says what 'dirty' means when that is all the request says", () => {
    const p = videoStillPrompt({ gender: "female" }, "Can you send me a dirtier picture");
    expect(p).toMatch(/She is naked with her legs spread wide, showing her pussy to the camera\./);
    const m = videoStillPrompt({ gender: "male" }, "send me a nasty pic");
    expect(m).toMatch(/He is naked with his legs apart, showing his hard cock to the camera\./);
    const l = videoStillPrompt({ gender: "female" }, "a naughty pic in lingerie");
    expect(l).not.toMatch(/legs spread wide/);
  });

  it("does not put breasts on a man", () => {
    const m = finishMediaPrompt("Photo of a man. He is showing his cock.", "show me your dick", {
      anatomy: anatomyOf("male"),
    });
    expect(m).toContain("bare chest and bare groin");
    expect(m).not.toMatch(/breasts/);
    const f = finishMediaPrompt("Photo of a woman. She is showing her tits.", "show me your tits", {
      anatomy: anatomyOf("female"),
    });
    expect(f).toContain("bare breasts and bare groin");
  });
});

// "send me a picture of this" points at whatever she just said, and "send
// another one" at whatever she just sent. One resolver for the chat path, the
// retake and the vision check, so they all render the same request.
describe("resolveMediaRequest", () => {
  it("re-runs the last request on a follow-up, plus what this message adds", () => {
    const history = [
      { role: "user", content: "send me a pic of you licking your tits", kind: "text" },
      { role: "assistant", content: "", kind: "image" },
      { role: "user", content: "send me another with your legs spread", kind: "text" },
    ];
    const r = resolveMediaRequest("send me another with your legs spread", history);
    expect(r.followUp).toBe("image");
    expect(r.request).toBe("send me a pic of you licking your tits, with your legs spread");
    expect(resolveMediaRequest("another one", history.slice(0, 2)).request).toBe(
      "send me a pic of you licking your tits",
    );
  });

  it("is ordinary conversation when nothing was sent", () => {
    expect(resolveMediaRequest("another one", [{ role: "user", content: "hi", kind: "text" }])).toEqual(
      { request: "another one", followUp: null },
    );
  });

  it("puts her own scene behind 'a picture of this'", () => {
    const history = [
      {
        role: "assistant",
        content:
          "Mmm baby 😏 I'm lying on my bed in just my panties, touching myself and thinking about you. Want to see?",
        kind: "text",
      },
      { role: "user", content: "Send me a picture of this!", kind: "text" },
    ];
    const r = resolveMediaRequest("Send me a picture of this!", history);
    expect(r.followUp).toBeNull();
    expect(r.request).toBe(
      "Send me a picture of this: you're lying on your bed in just your panties, touching yourself and thinking about me",
    );
    expect(actionSentence("she", normalizeRequest(r.request, "she"))).toBe(
      "She is lying on her bed in just her panties, touching herself and thinking about me.",
    );
    expect(isDemonstrativeMediaRequest("send me a picture of this: you're lying on your bed")).toBe(
      false,
    );
    expect(isDemonstrativeMediaRequest("send me a pic of you licking your tits")).toBe(false);
    expect(isDemonstrativeMediaRequest("can you send me a picture of that")).toBe(true);
  });
});

describe("stragglers from the job history", () => {
  const say = (r: string) => actionSentence("she", normalizeRequest(r, "she"));
  it("drops a dangling conjunction and a trailing picture noun", () => {
    expect(say("Send me a picture of your pussy and")).toBe("She is showing her pussy.");
    expect(say("Can you send me a nasty sext and pic?")).toBe("");
    expect(say("spread your legs and send me a pic of it")).toBe("She is spreading her legs.");
  });
  it("keeps the ask and drops what the asker says about themselves", () => {
    expect(say("Yes. Send me a picture of you in barely ANY clothes! I need to see more")).toBe(
      "She is in barely ANY clothes.",
    );
  });
});

describe("wantsSelfie does not charge for a compliment", () => {
  it("knows a reaction from an order", async () => {
    const { wantsSelfie } = await import("../selfie");
    expect(wantsSelfie("That's a great pic")).toBe(false);
    expect(wantsSelfie("nice photo babe")).toBe(false);
    expect(wantsSelfie("pic please")).toBe(true);
    expect(wantsSelfie("photo?")).toBe(true);
    expect(wantsSelfie("send me a pic")).toBe(true);
  });
});
