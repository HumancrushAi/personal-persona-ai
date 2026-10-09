import { describe, expect, it } from "vitest";
import { finishMediaPrompt, isSelfAct, selfActSentence, stillImagePrompt, videoActionPrompt } from "../selfie";
import { negativeFor } from "../media.functions";
import { anatomyOf } from "../anatomy";
import { filterAvoid, splitAvoid } from "../prompt-refiner.server";

// "Send me a picture you licking your tits" came back as her holding a toy up
// to her mouth. The sentence said "licking" and nothing about her hands, and
// the checkpoint drew the thing it has seen next to that word most often.
const LICK = "Send me a picture you licking your tits";
const nova = { gender: "female", name: "Nova" };

describe("an act on her own body is spelled out", () => {
  it("recognises the request", () => {
    expect(isSelfAct("licking her tits")).toBe(true);
    expect(isSelfAct("stick out your tongue")).toBe(true);
    expect(isSelfAct("sucking on your fingers")).toBe(true);
    expect(isSelfAct("bite your lip for me")).toBe(true);
    expect(isSelfAct("show me your tits")).toBe(false);
    expect(isSelfAct("stick a dildo in your pussy")).toBe(false);
  });

  it("says whose nipple, which hand, and that she holds nothing", () => {
    const p = stillImagePrompt(nova, LICK);
    expect(p).toContain("touches the tip of her tongue to her own nipple");
    expect(p).toContain("her left hand");
    expect(p).toContain("her hands hold nothing");
    expect(p).toContain("alone in the frame");
    expect(p).not.toContain("She is licking her tits.");
  });

  it("does the same in a clip", () => {
    expect(videoActionPrompt(nova, LICK)).toContain("tip of her tongue to her own nipple");
  });

  it("frees the hand the builder had parked on her thigh", () => {
    const out = finishMediaPrompt(stillImagePrompt(nova, LICK), LICK, {
      anatomy: anatomyOf("female"),
      still: true,
    });
    expect(out).not.toMatch(/her hands resting on her thighs/);
    expect(out).toContain("her own nipple");
  });

  it("uses his pronouns for a man", () => {
    expect(selfActSentence("licking his lips", anatomyOf("male"))).toContain("bites his own lower lip");
  });
});

describe("the negative prompt pushes the toy and the second person away", () => {
  it("names objects and oral acts for a mouth-on-own-body request", () => {
    const n = negativeFor(LICK, "female");
    for (const t of ["dildo", "sex toy", "object in hand", "fellatio", "blowjob", "second person", "phallus"])
      expect(n).toContain(t);
  });

  it("keeps a trans woman's own penis out of that list", () => {
    const n = negativeFor(LICK, "trans-female");
    expect(n).toContain("dildo");
    expect(n).not.toContain("phallus");
  });

  it("leaves a toy request alone", () => {
    expect(negativeFor("suck on your dildo", "female")).not.toContain("object in mouth");
  });

  it("leaves a request that names a cock alone", () => {
    expect(negativeFor("lick his cock", "female")).not.toContain("fellatio");
  });

  it("appends the refiner's avoid list once", () => {
    const n = negativeFor(LICK, "female", { extra: ["bottle", "water bottle", "dildo"] });
    expect(n).toContain("water bottle");
    expect(n.split("dildo").length).toBe(2);
  });
});

describe("the refiner's AVOID line", () => {
  it("is split off the prompt", () => {
    const { text, avoid } = splitAvoid(
      "exact same woman as the reference image, nude on the bed.\nAVOID: dildo, second person, Bottle, phone.",
    );
    expect(text).toBe("exact same woman as the reference image, nude on the bed.");
    expect(avoid).toEqual(["dildo", "second person", "bottle", "phone"]);
  });

  it("is empty when the model wrote none", () => {
    expect(splitAvoid("just a prompt").avoid).toEqual([]);
  });

  it("never pushes away her own parts or what was asked for", () => {
    const kept = filterAvoid(
      ["breasts", "small breasts", "dildo", "tongue", "second person", "no hands", "bottle"],
      LICK,
      { hasBreasts: true, hasVulva: true, hasPenis: false },
    );
    expect(kept).toEqual(["dildo", "second person", "bottle"]);
  });
});
