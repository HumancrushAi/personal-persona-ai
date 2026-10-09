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

  it("leads with the act as tags, and leaves the whole-body anatomy out", () => {
    expect(mouthActTags(LICK)).toContain("licking own nipple");
    expect(mouthActTags("suck on your dildo")).toContain("dildo in mouth");
    expect(mouthActTags("show me your tits")).toBe("");
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
    expect(comfySettings("x", { mouthAct: true }).ipaStartAt).toBe(0.3);
    expect(comfySettings("x").ipaStartAt).toBe(0);
    expect(FACEID_WORKFLOW).toContain("{{IPA_START_AT}}");
  });

  it("lightens the face lock and the detail pass only for those", () => {
    for (const k of ["COMFY_IPA_WEIGHT_MOUTH", "COMFY_IPA_V2_WEIGHT_MOUTH", "COMFY_FACE_DENOISE_MOUTH", "COMFY_IPA_WEIGHT", "COMFY_FACE_DENOISE"])
      delete process.env[k];
    const mouth = comfySettings("x", { mouthAct: true });
    expect(mouth.ipaWeight).toBe(0.6);
    expect(mouth.faceDenoise).toBe(0.2);
    const plain = comfySettings("x");
    expect(plain.ipaWeight).toBe(0.9);
    expect(plain.faceDenoise).toBe(0.35);
    expect(mouth.cfg).toBe(5.0);
    expect(plain.cfg).toBe(5.5);
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
    expect(out).toContain("fresh healthy youthful adult face");
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
