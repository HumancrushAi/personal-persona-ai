import { describe, it, expect } from "vitest";
import { TOYS, resolveToy, resolveToys, toyById, needsToyReply, mentionsToy } from "../toys";
import { propClause, propClauses, propNegative } from "../props";
import { anatomyOf } from "../anatomy";
import { negativeFor } from "../media.functions";
import { stillImagePrompt, finishMediaPrompt } from "../selfie";
import { verifyQuestion } from "../photo-check";

// The treasure chest: which toy a request is about, whether the user has it,
// and that the toy they bought is the one the renderer is told about.

describe("resolveToy", () => {
  it("names a toy outright and knows whether it is owned", () => {
    expect(resolveToy("stick a glass dildo in your pussy", new Set()).needed?.id).toBe("dildo-glass");
    expect(resolveToy("stick a glass dildo in your pussy", new Set(["dildo-glass"])).toy?.id).toBe("dildo-glass");
    expect(resolveToy("use the rabbit on yourself", new Set()).needed?.id).toBe("rabbit-tongue");
    expect(resolveToy("a vibrating dildo with a tongue on it", "all").toy?.id).toBe("rabbit-tongue");
    expect(resolveToy("put the jewelled plug in your ass", new Set()).needed?.id).toBe("plug-jewel");
    expect(resolveToy("use the glass dildo with balls", new Set(["dildo-realistic", "dildo-glass"])).toy?.id).toBe("dildo-glass");
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

  it("keeps a plug and dildo as two separate owned toys", () => {
    const r = resolveToys(
      "spread your legs and stick the jewelled butt plug up your ass and the dildo in your pussy",
      new Set(["plug-jewel", "dildo-realistic"]),
    );
    expect(r.neededToys).toEqual([]);
    expect(r.toys?.map((t) => t.id)).toEqual(["plug-jewel", "dildo-realistic"]);
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
  it("locks two toys to separate openings without inventing extra hands", () => {
    const c = propClauses(
      "stick the jewelled butt plug up your ass and the dildo in your pussy",
      {
        anatomy: anatomyOf("female"),
        toys: [toyById("dildo-realistic")!, toyById("plug-jewel")!],
      },
    );
    expect(c).toMatch(/inside her pussy[\s\S]*dildo/i);
    expect(c).toMatch(/steel bulb leads inside her ass/i);
    expect(c).toMatch(/Exactly 2 toys total/);
    expect(c).toMatch(/Exactly two arms and exactly two hands total/);
    expect(c).toMatch(/No jewellery interpretation/);
  });
  it("requires the finished render to contain the exact unlocked toy", () => {
    const glass = toyById("dildo-glass")!;
    const q = verifyQuestion("lick the glass dildo", true, true, glass)!;
    expect(q).toContain("exactly one Glass Dildo");
    expect(q).toContain("clear transparent borosilicate glass dildo");
    expect(q).toMatch(/mouth.*licking or sucking action/);
    expect(q).toMatch(/must not be missing, duplicated, replaced/);
  });

  it("checks inserted toy frames for placement and external hands", () => {
    const glass = toyById("dildo-glass")!;
    const q = verifyQuestion("fucking yourself with a glass dildo", true, true, glass)!;
    expect(q).toMatch(/genuinely inserted tip-first/i);
    expect(q).toMatch(/body-opening edge visibly crosses in front of both sides/i);
    expect(q).toMatch(/complete tip and shaft outline remain visible lying over/i);
    expect(q).toMatch(/exactly two hands total/i);
    expect(q).toMatch(/extra, floating or external hand/i);
  });

  it("puts the exact spec in the prop clause and keeps the insertion logic", () => {
    const f = anatomyOf("female");
    const black = toyById("dildo-black")!;
    const c = propClause("stick a dildo in your pussy", { anatomy: f, toy: black });
    expect(c).toMatch(/matte black silicone/);
    expect(c).not.toMatch(/purple or pink/);
    expect(c).toMatch(/tip is deep inside her pussy/);
    expect(c).toMatch(/opening naturally occludes both inner shaft edges/);
    expect(c).toMatch(/contact shadow/);
    expect(c).toMatch(/skin compression/);
    const generic = propClause("stick a dildo in your pussy", { anatomy: f });
    expect(generic).toMatch(/realistic flesh-toned (?:matte )?silicone/);
    expect(generic).toMatch(/two attached rounded testicle-shaped balls/);
  });

  it("recognizes reflexive dildo wording as insertion without naming anatomy", async () => {
    const { propIsInserted } = await import("../props");
    expect(propIsInserted("fucking yourself with a glass dildo")).toBe(true);
    expect(propIsInserted("fuck herself with the realistic dildo")).toBe(true);
    expect(propIsInserted("holding a glass dildo")).toBe(false);
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

  it("keeps each owned toy's geometry when it is inserted", () => {
    const f = anatomyOf("female");
    const glass = propClause("put the glass dildo in your pussy", { anatomy: f, toy: toyById("dildo-glass") });
    expect(glass).toMatch(/rounded glass tip leads inside her pussy/);
    expect(glass).not.toMatch(/wide flat flared base is fully outside/);

    const plug = propClause("put the jewelled plug in your ass", { anatomy: f, toy: toyById("plug-jewel") });
    expect(plug).toMatch(/tapered steel bulb leads inside her ass/);
    expect(plug).toMatch(/faceted pink crystal remains fully outside/);

    const beads = propClause("use the anal beads in your ass", { anatomy: f, toy: toyById("beads") });
    expect(beads).toMatch(/smallest black silicone bead leads inside her ass/);
    expect(beads).not.toMatch(/glans|flared base/);
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
