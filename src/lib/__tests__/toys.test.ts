import { describe, it, expect } from "vitest";
import { TOYS, resolveToy, toyById, needsToyReply, mentionsToy } from "../toys";
import { propClause, propNegative } from "../props";
import { anatomyOf } from "../anatomy";
import { negativeFor } from "../media.functions";
import { stillImagePrompt, finishMediaPrompt } from "../selfie";

// The treasure chest: which toy a request is about, whether the user has it,
// and that the toy they bought is the one the renderer is told about.

describe("resolveToy", () => {
  it("names a toy outright and knows whether it is owned", () => {
    expect(resolveToy("stick a glass dildo in your pussy", new Set()).needed?.id).toBe("dildo-glass");
    expect(resolveToy("stick a glass dildo in your pussy", new Set(["dildo-glass"])).toy?.id).toBe("dildo-glass");
    expect(resolveToy("use the rabbit on yourself", new Set()).needed?.id).toBe("rabbit-tongue");
    expect(resolveToy("a vibrating dildo with a tongue on it", "all").toy?.id).toBe("rabbit-tongue");
    expect(resolveToy("put the jewelled plug in your ass", new Set()).needed?.id).toBe("plug-jewel");
  });

  it("takes the owned toy of a kind for a generic ask, or the cheapest to buy", () => {
    const none = resolveToy("shove a dildo in your pussy", new Set());
    expect(none.toy).toBeNull();
    expect(none.needed?.id).toBe("dildo-realistic");
    const mine = resolveToy("shove a dildo in your pussy", new Set(["dildo-black"]));
    expect(mine.toy?.id).toBe("dildo-black");
    expect(mine.needed).toBeNull();
    expect(resolveToy("play with a toy", new Set()).needed?.kind).toBe("dildo");
    expect(resolveToy("whip yourself", new Set()).needed?.id).toBe("flogger");
    expect(resolveToy("in handcuffs and chains", new Set()).needed?.id).toBe("cuffs");
  });

  it("gives a free account the first toy of the kind", () => {
    expect(resolveToy("a dildo in your pussy", "all").toy?.id).toBe("dildo-realistic");
    expect(resolveToy("sucking on a dildo", "all").needed).toBeNull();
  });

  it("is quiet on requests with no toy in them", () => {
    for (const r of ["show me your tits", "whipped cream on your tits", "lick your nipples", "a necklace and heels"]) {
      const res = resolveToy(r, new Set());
      expect(res.toy, r).toBeNull();
      expect(res.needed, r).toBeNull();
      expect(mentionsToy(r), r).toBe(false);
    }
  });

  it("has a unique id and a price for every toy", () => {
    const ids = new Set(TOYS.map((t) => t.id));
    expect(ids.size).toBe(TOYS.length);
    for (const t of TOYS) expect(t.price, t.id).toBeGreaterThan(0);
    expect(toyById("rabbit-tongue")?.price).toBe(650);
  });

  it("asks for the toy in her voice", () => {
    const r = needsToyReply(toyById("dildo-black")!);
    expect(r).toMatch(/treasure chest/);
    expect(r).toMatch(/a big black dildo/);
  });
});

describe("the toy she owns is the toy in the prompt", () => {
  it("puts the exact spec in the prop clause and keeps the insertion logic", () => {
    const f = anatomyOf("female");
    const black = toyById("dildo-black")!;
    const c = propClause("stick a dildo in your pussy", { anatomy: f, toy: black });
    expect(c).toMatch(/matte black silicone/);
    expect(c).not.toMatch(/purple or pink/);
    expect(c).toMatch(/tip is deep inside her pussy/);
    const generic = propClause("stick a dildo in your pussy", { anatomy: f });
    expect(generic).toMatch(/purple or pink/);
  });

  it("describes a worn toy with where it is on her, and on him", () => {
    const clamps = toyById("clamps")!;
    const hers = propClause("put your nipple clamps on", { anatomy: anatomyOf("female"), toy: clamps });
    expect(hers).toMatch(/One clamp is closed on each of her own nipples/);
    const cuffs = toyById("cuffs")!;
    const his = propClause("in handcuffs", { anatomy: anatomyOf("male"), toy: cuffs });
    expect(his).toMatch(/locked around both his wrists/);
    expect(his).toMatch(/He is alone in the frame/);
    expect(his).not.toMatch(/\bher\b/);
  });

  it("holds a wand by its handle, not a flared base", () => {
    const wand = toyById("wand")!;
    const c = propClause("press the wand on your clit", { anatomy: anatomyOf("female"), toy: wand });
    expect(c).toMatch(/holds the toy by its handle/);
    expect(c).not.toMatch(/flared base/);
  });

  it("pushes away the toys she does not have in the negative", () => {
    const real = toyById("dildo-realistic")!;
    expect(propNegative("a dildo in your pussy", real)).toMatch(/purple dildo/);
    expect(propNegative("a dildo in your pussy", real)).toMatch(/second person/);
    expect(negativeFor("a dildo in your pussy", "female", { toy: real })).toMatch(/purple dildo/);
    expect(negativeFor("a dildo in your pussy", "female")).not.toMatch(/purple dildo/);
  });

  it("reaches the finished prompt from the builder and from a refined prompt", () => {
    const glass = toyById("dildo-glass")!;
    const built = stillImagePrompt({ gender: "female" }, "stick a dildo in your pussy", glass);
    expect(built).toMatch(/transparent glass/);
    const refined = finishMediaPrompt("Photo of a woman on a bed.", "stick a dildo in your pussy", {
      anatomy: anatomyOf("female"),
      appendProps: true,
      toy: glass,
    });
    expect(refined).toMatch(/transparent glass/);
    expect(refined).not.toMatch(/purple or pink/);
  });
});
