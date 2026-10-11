import { describe, it, expect } from "vitest";
import { anatomyOf } from "../anatomy";
import {
  isClimaxAct,
  requestKeepsGarment,
  stillImagePrompt,
  climaxSentence,
  mouthActTags,
} from "../selfie";
import { verifyQuestion } from "../photo-check";
import { propClause } from "../props";
import { negativeFor } from "../media.functions";
import { AVOID_MARKER, filterAvoid, splitAvoid } from "../prompt-refiner.server";

// The pipeline is several pieces — the prose, the tags, the negative, the
// prop clause, the vision check — and each of them read the request on its
// own. These pin the places where they disagreed with each other, or with
// the companion whose picture it is.

describe("a climax is a climax, not a colour", () => {
  it("fires on every way people ask for it", () => {
    for (const r of [
      "cum for me",
      "make yourself cum",
      "squirt for me",
      "I want to see you orgasm",
      "shoot your load",
      "bust a nut for me",
      "finish on your tits",
      "cumming on the bed",
      "get yourself off",
      "blow your load",
    ])
      expect(isClimaxAct(r), r).toBe(true);
  });

  it("stays quiet on a cream dress, a facial close-up and a load of pics", () => {
    for (const r of [
      "wearing a cream lace dress",
      "a facial close-up of your smile",
      "send me a load of pics",
      "get off the bed and stand up",
      "eating a nut",
      "cream coloured lingerie",
      "your dripping wet pussy",
    ])
      expect(isClimaxAct(r), r).toBe(false);
  });

  it("is the same climax in the prose, the tags and the check", () => {
    const f = anatomyOf("female");
    expect(climaxSentence("wearing a cream dress", f)).toBe("");
    expect(mouthActTags("wearing a cream dress")).toBe("");
    expect(verifyQuestion("wearing a cream dress", true, true)).toBeNull();
    expect(climaxSentence("cum for me", f)).toMatch(/orgasm/);
    expect(verifyQuestion("cum for me", true, true)).toMatch(/squirting/);
  });
});

describe("the vision check asks about the body in the picture", () => {
  it("asks about a person, not a woman, for a man and a trans man", () => {
    const m = anatomyOf("male");
    expect(verifyQuestion("cum for me", m.hasBreasts, m.hasVulva)).toMatch(/person's own penis/);
    expect(verifyQuestion("cum for me", m.hasBreasts, m.hasVulva)).not.toMatch(/woman/);
    const tm = anatomyOf("trans-male");
    const q = verifyQuestion("rub your pussy", tm.hasBreasts, tm.hasVulva);
    expect(q).toMatch(/the person's own hands/);
    expect(q).not.toMatch(/\bher\b|woman/);
    expect(verifyQuestion("rub your pussy", true, true)).toMatch(/the woman's own hands/);
  });
});

describe("a garment stays on only when it is kept on", () => {
  it("knows off from on", () => {
    expect(requestKeepsGarment("in lingerie with your pussy showing")).toBe(true);
    expect(requestKeepsGarment("in a dress with your tits out")).toBe(true);
    expect(requestKeepsGarment("in your yoga pants showing your ass")).toBe(true);
    expect(requestKeepsGarment("take your bra off and show me your tits")).toBe(false);
    expect(requestKeepsGarment("pull your panties down and show me your pussy")).toBe(false);
    expect(requestKeepsGarment("show me your tits without the bra")).toBe(false);
    expect(requestKeepsGarment("panties pulled to the side showing your pussy")).toBe(false);
    expect(requestKeepsGarment("show me your tits")).toBe(false);
    expect(requestKeepsGarment("in lingerie")).toBe(false);
  });

  it("pushes the bra off when the request takes it off", () => {
    const neg = negativeFor("take your bra off and show me your tits", "female");
    expect(neg).toMatch(/\bbra\b/);
    const keep = negativeFor("in a dress with your tits out", "female");
    expect(keep).not.toMatch(/\bdress\b/);
    const p = stillImagePrompt({ gender: "female" }, "take your bra off and show me your tits");
    expect(p).toMatch(/completely naked/);
    expect(p).not.toMatch(/wearing what was asked for/);
  });
});

describe("the negative prompt and the request do not fight", () => {
  it("drops the breast-shape spread words when the legs are to be spread", () => {
    expect(negativeFor("show me your tits", "female")).toMatch(/, splayed, spread flat/);
    expect(negativeFor("spread your legs and show me your pussy", "female")).not.toMatch(/, splayed, spread flat/);
    expect(negativeFor("legs open on the bed", "female")).not.toMatch(/, splayed, spread flat/);
    // the closed-vulva list stays for spread legs…
    expect(negativeFor("spread your legs and show me your pussy", "female")).toMatch(/spread open/);
    // …and goes only when the pussy itself is to be spread
    expect(negativeFor("spread your pussy for me", "female")).not.toMatch(/spread open|pulled apart|splayed open/);
  });

  it("lets a companion of forty keep her age", () => {
    expect(negativeFor("send me a selfie", "female", { age: 25 })).toMatch(/middle-aged/);
    const older = negativeFor("send me a selfie", "female", { age: 50 });
    expect(older).not.toMatch(/middle-aged|elderly|wrinkles|grey hair/);
    expect(older).toMatch(/chapped lips/);
  });

  it("does not push away a man's own cum or his own hand on a mouth request", () => {
    const his = negativeFor("lick your lips and cum for me", "male");
    expect(his).not.toMatch(/\bsemen\b/);
    expect(his).not.toMatch(/man's hand/);
    const hers = negativeFor("lick your lips for me", "female");
    expect(hers).toMatch(/\bsemen\b/);
    expect(hers).toMatch(/man's hand/);
  });

  it("does not push away the lollipop she was asked to suck", () => {
    expect(negativeFor("sucking on a lollipop", "female")).not.toMatch(/lollipop/);
    expect(negativeFor("sucking on a lollipop", "female")).toMatch(/banana/);
  });
});

describe("the hands in the posture line", () => {
  it("are free when the act uses them, and resting when it does not", () => {
    expect(stillImagePrompt({ gender: "female" }, "show me your tits")).toMatch(/hands resting on her thighs/);
    expect(stillImagePrompt({ gender: "female" }, "rub your pussy for me")).not.toMatch(/hands resting on her thighs/);
    expect(stillImagePrompt({ gender: "female" }, "squeeze your tits")).not.toMatch(/hands resting on her thighs/);
    expect(stillImagePrompt({ gender: "female" }, "cum for me")).not.toMatch(/hands resting on her thighs/);
  });
});

describe("a toy clause for a man is about him", () => {
  it("says his, not her, and does not mention a pussy he has not got", () => {
    const m = propClause("a dildo up your ass", { anatomy: anatomyOf("male") });
    expect(m).toMatch(/inside his ass/);
    expect(m).not.toMatch(/\bher\b|\bshe\b|pussy/i);
    expect(m).toMatch(/his cock and balls hang in front of it/);
    expect(m).toMatch(/He is alone in the frame/);
    const t = propClause("a dildo up your ass", { anatomy: anatomyOf("trans-female") });
    expect(t).toMatch(/her cock and balls hang in front of it/);
    expect(t).not.toMatch(/pussy stays closed/);
    const f = propClause("a dildo up your ass", { anatomy: anatomyOf("female") });
    expect(f).toMatch(/her pussy stays closed/);
  });
});

describe("the refiner's avoid list", () => {
  it("keeps a term that only shares 'the' or 'your' with the request", () => {
    const kept = filterAvoid(
      ["phone in the shot", "toy in your grip", "second person"],
      "send me a pic of you licking your tits on the bed",
      { hasBreasts: true, hasVulva: true, hasPenis: false },
    );
    expect(kept).toContain("phone in the shot");
    expect(kept).toContain("toy in your grip");
    expect(kept).toContain("second person");
  });

  it("still drops a term that names the act or her own part", () => {
    const kept = filterAvoid(
      ["licking", "bare breasts", "wet pussy"],
      "send me a pic of you licking your tits",
      { hasBreasts: true, hasVulva: true, hasPenis: false },
    );
    expect(kept).toEqual([]);
  });

  it("finds the marker through markdown", () => {
    expect(AVOID_MARKER.test("prompt text\n**AVOID:** a, b")).toBe(true);
    expect(AVOID_MARKER.test("prompt text\n- Avoid: a, b")).toBe(true);
    expect(splitAvoid("prompt text\n**AVOID:** phone, bottle").avoid).toEqual(["phone", "bottle"]);
  });
});
