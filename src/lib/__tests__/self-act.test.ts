import { describe, expect, it } from "vitest";
import {
  finishMediaPrompt,
  isMouthAct,
  isSelfAct,
  mouthActTags,
  requestComposesShot,
  selfActSentence,
  stillImagePrompt,
  videoActionPrompt,
} from "../selfie";
import { negativeFor } from "../media.functions";
import { anatomyOf } from "../anatomy";
import { filterAvoid, splitAvoid } from "../prompt-refiner.server";
import { propClause, propIsOral } from "../props";
import { FACEID_WORKFLOW, comfySettings } from "../comfy";

// "sucking on a dildo" came back as the toy held beside a closed-lip smile and
// "sucking on your tit" as a plain frontal: the prompts were right, the face
// lock and the low "plain nude" denoise were what kept the act out.
describe("the renderer is allowed to change her mouth", () => {
  it("treats an act on her own body as composing the shot", () => {
    expect(requestComposesShot(LICK)).toBe(true);
    expect(requestComposesShot("send me a nude")).toBe(false);
  });

  it("knows which requests touch her mouth", () => {
    expect(isMouthAct("suck on your dildo")).toBe(true);
    expect(isMouthAct("lick your lips")).toBe(true);
    expect(isMouthAct(LICK)).toBe(true);
    expect(isMouthAct("show me your tits")).toBe(false);
    expect(isMouthAct("dildo in pussy")).toBe(false);
  });

  it("puts the toy's tip in her mouth, not beside her face", () => {
    const c = propClause("sucking on a dildo", { anatomy: anatomyOf("female") });
    expect(c).toContain("inside her open mouth");
    expect(c).toContain("flared base in her hand");
    expect(c).not.toContain("natural soft vulva");
    expect(propIsOral("sucking on a dildo")).toBe(true);
    expect(propIsOral("dildo in pussy")).toBe(false);
  });

  it("leads with the act as tags, and leaves the whole-body anatomy out", async () => {
    expect(mouthActTags(LICK)).toContain("hands under the breast");
    expect(mouthActTags(LICK)).toContain("head bent down to own breast");
    expect(mouthActTags(LICK)).not.toMatch(/tongue|looking down|face turned/);
    expect(mouthActTags(LICK)).not.toContain("tongue out");
    expect(mouthActTags("suck on your dildo")).toContain("dildo in mouth");
    expect(mouthActTags("show me your tits")).toBe("");
    expect(mouthActTags("squeeze your tits")).toContain("squeezing own breasts");
    const { climaxSentence, isClimaxAct } = await import("../selfie");
    for (const r of ["squirt for me", "make yourself cum", "bust a nut", "shoot your load", "cum for me", "gushing", "get off for me"])
      expect(isClimaxAct(r), r).toBe(true);
    expect(isClimaxAct("send me a selfie")).toBe(false);
    expect(climaxSentence("squirt for me", anatomyOf("female"))).toContain("squirting from her pussy");
    expect(climaxSentence("cum for me", anatomyOf("male"))).toContain("spurting from the tip of his own cock");
    expect(climaxSentence("cum for me", anatomyOf("trans-female"))).toContain("her own cock");
    expect(mouthActTags("squirt for me")).toContain("squirting");
    expect(mouthActTags("cum for me", true)).toContain("cumshot");
    expect(stillImagePrompt({ gender: "male", name: "Dante" }, "cum for me")).toContain("ejaculating");
    expect(videoActionPrompt(nova, "squirt for me")).toContain("squirting from her pussy");
    expect(mouthActTags("pinch your nipples")).toContain("pinching own nipples");
    const { normalizeRequest, actionSentence } = await import("../selfie");
    const say = (r: string) => actionSentence("she", normalizeRequest(r, "she"));
    expect(say("take off your top")).toBe("She is taking off her top.");
    expect(say("pinch your nipples")).toBe("She is pinching her nipples.");
    expect(say("turn around and show me your ass")).toBe("She is turning around and showing her ass.");
    expect(say("bra off")).toBe("She is with her bra off.");
    expect(say("panties to the side")).toBe("She is with her panties pulled to the side.");
    expect(say("pov you on top of me")).toContain("seen from below");
    expect(say("armpits")).toBe("She is showing armpits.");
    expect(say("wink")).toBe("She is winking.");
    expect(mouthActTags("send me a picture of you rubbing your pussy")).toContain("rubbing own pussy");
    const anal = propClause("stick a dildo up your ass", { anatomy: anatomyOf("female") });
    expect(anal).toContain("deep inside her ass");
    expect(anal).not.toContain("deep inside her pussy");
    const vag = propClause("stick a dildo in your pussy", { anatomy: anatomyOf("female") });
    expect(vag).toContain("deep inside her pussy");
    const looked = finishMediaPrompt("exact same woman, nude", "send me a selfie", {
      anatomy: anatomyOf("female"),
      appearance: { age: 22, look: "blue shoulder-length wavy hair, blue eyes, fair skin" },
    });
    expect(looked).toContain("blue shoulder-length wavy hair");
    const out = finishMediaPrompt("exact same woman, tongue on her own nipple", LICK, {
      anatomy: anatomyOf("female"),
      appendAnatomy: true,
      still: true,
    });
    expect(out).not.toContain("pointing straight forward");
    expect(out).not.toContain("closed pussy");
    expect(out).toContain("Completely nude");
  });

  it("gives a mouth act its own denoise tier", () => {
    delete process.env.COMFY_DENOISE_MOUTH;
    // Only a graph that starts from her portrait's latent has a denoise to
    // tier; the FaceID graph is text-to-image and always 1.
    const img2img = '{"5": {"class_type": "VAEEncode"}}';
    expect(comfySettings("x", { mouthAct: true, template: img2img }).denoise).toBe(0.86);
    expect(comfySettings("x", { promptSetsComposition: true, template: img2img }).denoise).toBe(0.78);
    expect(comfySettings("x", { mouthAct: true, template: FACEID_WORKFLOW }).denoise).toBe(1);
  });

  it("starts the face lock a quarter of the way in on a mouth act", () => {
    delete process.env.COMFY_IPA_START_AT_MOUTH;
    delete process.env.COMFY_IPA_START_AT;
    expect(comfySettings("x", { mouthAct: true }).ipaStartAt).toBe(0.6);
    // The face pass has its own patch at full strength, on every request.
    expect(FACEID_WORKFLOW).toContain('"15"');
    expect(FACEID_WORKFLOW).toContain('"model": ["15", 0]');
    expect(comfySettings("x", { mouthAct: true }).ipaWeightFace).toBe(0.9);
    expect(comfySettings("x").ipaStartAt).toBe(0);
    expect(FACEID_WORKFLOW).toContain("{{IPA_START_AT}}");
  });

  it("lightens the face lock and the detail pass only for those", () => {
    for (const k of ["COMFY_IPA_WEIGHT_MOUTH", "COMFY_IPA_V2_WEIGHT_MOUTH", "COMFY_FACE_DENOISE_MOUTH", "COMFY_IPA_WEIGHT", "COMFY_FACE_DENOISE"])
      delete process.env[k];
    const mouth = comfySettings("x", { mouthAct: true });
    expect(mouth.ipaWeight).toBe(0.5);
    expect(mouth.faceDenoise).toBe(0.3);
    const plain = comfySettings("x");
    expect(plain.ipaWeight).toBe(0.9);
    expect(plain.ipaWeightFace).toBe(0.9);
    expect(plain.faceDenoise).toBe(0.35);
    expect(mouth.cfg).toBe(5.0);
    expect(plain.cfg).toBe(5.0);
  });
});

describe("faces are not pushed toward old", () => {
  it("pushes away wrinkles and chapped lips, and no longer away from a youthful face", () => {
    const n = negativeFor("send me a selfie", "female");
    expect(n).toContain("wrinkles");
    expect(n).toContain("chapped lips");
    expect(n).toContain("plastic face");
    expect(n).not.toContain("youthful face");
    expect(n).not.toContain("flawless skin");
    expect(n).not.toContain("poreless");
    // The minor guard is untouched.
    expect(n).toContain("underage");
    expect(n).toContain("teen");
  });

  it("states a fresh adult face on every render", () => {
    const out = finishMediaPrompt(stillImagePrompt(nova, "send me a selfie"), "send me a selfie", {
      anatomy: anatomyOf("female"),
      still: true,
    });
    expect(out).toMatch(/fresh youthful adult face/i);
    expect(out).not.toContain("visible pores");
  });
});

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
    expect(p).toContain("the tip of her tongue touches her own nipple");
    expect(p).toContain("both her hands cup the underside");
    expect(p).toContain("hands stay below the nipple");
    expect(p).toContain("her hands hold nothing");
    expect(p).toContain("alone in the frame");
    expect(p).not.toContain("She is licking her tits.");
  });

  it("does the same in a clip", () => {
    expect(videoActionPrompt(nova, LICK)).toContain("tip of her tongue touches her own nipple");
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
