import { describe, it, expect } from "vitest";
import {
  type GenderKind,
  anatomyOf,
  genderKind,
  mentionsPart,
  nudeAnatomy,
  crossSexNegative,
  refuseWrongAnatomy,
  requestedParts,
} from "../anatomy";
import { videoStillPrompt, videoActionPrompt } from "../selfie";

const KINDS: GenderKind[] = ["female", "male", "trans-female", "trans-male", "nb"];

describe("genderKind", () => {
  it("maps the five values the column actually holds", () => {
    expect(genderKind("female")).toBe("female");
    expect(genderKind("male")).toBe("male");
    expect(genderKind("trans-female")).toBe("trans-female");
    expect(genderKind("trans-male")).toBe("trans-male");
    expect(genderKind("non-binary")).toBe("nb");
  });

  // Rows written by older code and by the scripts/ directory use these
  // spellings. Falling through to "female" would render the wrong body.
  it("maps the legacy spellings rather than defaulting them to female", () => {
    for (const g of ["transwoman", "futa", "futanari", "shemale", "ladyboy", "dickgirl"]) {
      expect(`${g} -> ${genderKind(g)}`).toBe(`${g} -> trans-female`);
    }
    for (const g of ["transman", "trans_male", "trans-man"]) {
      expect(`${g} -> ${genderKind(g)}`).toBe(`${g} -> trans-male`);
    }
    expect(genderKind("TRANS-FEMALE")).toBe("trans-female");
    expect(genderKind("trans_female")).toBe("trans-female");
  });

  it("falls back to the column's own default when it is empty", () => {
    expect(genderKind(null)).toBe("female");
    expect(genderKind(undefined)).toBe("female");
    expect(genderKind("  ")).toBe("female");
  });
});

// The model the owner asked for: every companion gets the genitals their gender
// implies, and trans companions get the ones their trans type implies.
describe("who has what", () => {
  const expected: Record<GenderKind, [boolean, boolean, boolean]> = {
    //            breasts  penis  vulva
    female: [true, false, true],
    male: [false, true, false],
    "trans-female": [true, true, false],
    "trans-male": [false, false, true],
    // Nothing committed to. The flags say what the body HAS; a non-binary
    // companion is permissive at the GATE, which refuseWrongAnatomy states
    // separately rather than by pretending they have everything.
    nb: [false, false, false],
  };

  for (const kind of KINDS) {
    it(`gives a ${kind} companion the right body`, () => {
      const a = anatomyOf(kind === "nb" ? "non-binary" : kind);
      const [breasts, penis, vulva] = expected[kind];
      expect(`${kind}: ${a.hasBreasts} ${a.hasPenis} ${a.hasVulva}`).toBe(
        `${kind}: ${breasts} ${penis} ${vulva}`,
      );
    });
  }

  // The one the old code had exactly inverted: genderNoun mapped trans-male to
  // "man", so he was rendered with a penis while being refused his own vulva.
  it("does not render a trans man as a cis man", () => {
    const a = anatomyOf("trans-male");
    expect(a.hasPenis).toBe(false);
    expect(a.hasVulva).toBe(true);
    expect(a.subject).toBe("he");
  });
});

// The two halves of the prompt are built from the same table, so they cannot
// disagree about which body this is — which is what six copy-pasted derivations
// had started doing.
describe("the positive clause and the negative prompt agree", () => {
  const NAMES = {
    penis: /\bpenis\b|\bcock\b|\btesticles\b|\bshaft\b|\bglans\b/i,
    vulva: /\bvulva\b|\blabia\b|\bclitoral\b|\bpussy\b/i,
    breasts: /\bbreasts\b|\bnipples\b|\bareolae\b/i,
  } as const;

  for (const kind of KINDS) {
    const gender = kind === "nb" ? "non-binary" : kind;
    const a = anatomyOf(gender);

    it(`describes only what a ${kind} companion has`, () => {
      const clause = nudeAnatomy(gender);
      expect(`${kind} penis: ${NAMES.penis.test(clause)}`).toBe(`${kind} penis: ${a.hasPenis}`);
      expect(`${kind} vulva: ${NAMES.vulva.test(clause)}`).toBe(`${kind} vulva: ${a.hasVulva}`);
    });

    it(`suppresses only what a ${kind} companion lacks`, () => {
      const neg = crossSexNegative(gender);
      // Never list a part they HAVE — a negative prompt pushes on its own
      // tokens, so "breasts" in a trans woman's negatives would flatten her.
      if (a.hasPenis) expect(`${kind}`).toBe(NAMES.penis.test(neg) ? "never" : `${kind}`);
      if (a.hasVulva) expect(`${kind}`).toBe(NAMES.vulva.test(neg) ? "never" : `${kind}`);
      if (a.hasBreasts) expect(`${kind}`).toBe(NAMES.breasts.test(neg) ? "never" : `${kind}`);
    });
  }

  it("suppresses the cock a woman does not have, and the vulva a man does not", () => {
    expect(crossSexNegative("female")).toMatch(/\bpenis\b/);
    expect(crossSexNegative("male")).toMatch(/\bvulva\b/);
    expect(crossSexNegative("trans-female")).toMatch(/\bvulva\b/);
    expect(crossSexNegative("trans-male")).toMatch(/\bpenis\b/);
  });
});

// mentionsPart is deliberately looser than requestedParts: it decides where the
// camera goes, not whether to refuse someone, so it does not need the "is it
// hers" and "is it a request" context — but it must stay off the wide
// euphemisms, or a mention of a peach moves the camera.
describe("mentionsPart", () => {
  it("counts a part named anywhere in the message", () => {
    expect(mentionsPart("pussy pic", "vulva")).toBe(true);
    expect(mentionsPart("that pussy of yours", "vulva")).toBe(true);
    expect(mentionsPart("show me your tits", "breasts")).toBe(true);
  });

  it("stays off the euphemisms that only decide nudity", () => {
    expect(mentionsPart("send me a peach", "vulva")).toBe(false);
    expect(mentionsPart("get naked for me", "vulva")).toBe(false);
  });
});

// The hard rule from props.ts: the renderer cannot read negation, so a clause
// that names the wrong organ has just asked for it.
describe("no anatomy clause names the wrong organ", () => {
  for (const kind of KINDS) {
    const gender = kind === "nb" ? "non-binary" : kind;
    it(`keeps a ${kind} clause free of negation`, () => {
      expect(nudeAnatomy(gender)).not.toMatch(
        /\b(?:not|no|never|without|avoid|away from|instead of)\b/i,
      );
    });
  }

  it("never puts a cock in a woman's prompt or a vulva in a man's", () => {
    for (const req of ["get naked", "show me your body", ""]) {
      expect(`f:${req}`).toBe(
        /\bpenis\b|\bcock\b/i.test(videoStillPrompt({ gender: "female" }, req))
          ? "leaked"
          : `f:${req}`,
      );
      expect(`m:${req}`).toBe(
        /\bvulva\b|\blabia\b|\bpussy\b/i.test(videoStillPrompt({ gender: "male" }, req))
          ? "leaked"
          : `m:${req}`,
      );
    }
  });

  it("gives a trans woman both, in the same prompt", () => {
    const p = videoStillPrompt({ gender: "trans-female" }, "get naked");
    expect(p).toMatch(/breasts/i);
    expect(p).toMatch(/penis|cock/i);
    expect(p).not.toMatch(/\bvulva\b|\blabia\b/i);
  });

  it("gives a trans man a vulva and a flat chest", () => {
    const p = videoStillPrompt({ gender: "trans-male" }, "get naked");
    // "pussy" is the word the clause uses now — the anatomical terms were
    // what the render kept extruding.
    expect(p).toMatch(/vulva|labia|pussy/i);
    expect(p).toMatch(/flat masculine chest/i);
    expect(p).not.toMatch(/\bpenis\b|\berect cock\b/i);
  });
});

// "They is already completely naked" reached the renderer for every non-binary
// companion, in the one clause of the prompt that says what the picture is of.
describe("subject-verb agreement", () => {
  for (const gender of ["female", "male", "trans-female", "trans-male", "non-binary"]) {
    it(`builds grammatical sentences for ${gender}`, () => {
      for (const p of [
        videoStillPrompt({ gender, name: "Sam" }, "get naked"),
        videoStillPrompt({ gender, name: "Sam" }, ""),
        videoActionPrompt({ gender, name: "Sam" }, "dance for me"),
      ]) {
        expect(`${gender}: ${/\bThey is\b|\bthey is\b/.test(p)}`).toBe(`${gender}: false`);
        expect(`${gender}: ${/\bShe are\b|\bHe are\b/.test(p)}`).toBe(`${gender}: false`);
        expect(`${gender}: ${/\bThey holds\b|\bThey moves\b|\bThey settles\b/.test(p)}`).toBe(
          `${gender}: false`,
        );
      }
    });
  }
});

// A request, not a mention. The old gate matched the bare word anywhere, so
// "my ex had a huge dick lol" was answered "No silly, I'm a girl!".
describe("requestedParts", () => {
  it("reads a request for a part", () => {
    expect(requestedParts("show me your cock")).toEqual(["penis"]);
    expect(requestedParts("send me a dick pic")).toEqual(["penis"]);
    expect(requestedParts("i wanna see your pussy")).toEqual(["vulva"]);
    expect(requestedParts("show me your tits")).toEqual(["breasts"]);
  });

  it("ignores a part merely mentioned in conversation", () => {
    for (const t of [
      "my ex had a huge dick lol",
      "my boyfriend's cock was tiny",
      "that film had so much nudity",
      "i love your smile",
    ]) {
      expect(`${t} -> ${requestedParts(t).length}`).toBe(`${t} -> 0`);
    }
  });

  it("covers the slang the old two-line list missed", () => {
    for (const t of ["your schlong", "your dong", "your prick", "your boner"]) {
      expect(`${t} -> ${requestedParts(t)}`).toBe(`${t} -> penis`);
    }
    for (const t of ["your cunt", "your snatch", "your coochie", "your muff"]) {
      expect(`${t} -> ${requestedParts(t)}`).toBe(`${t} -> vulva`);
    }
    for (const t of ["your knockers", "your jugs", "your titties"]) {
      expect(`${t} -> ${requestedParts(t)}`).toBe(`${t} -> breasts`);
    }
  });
});

// The behaviour the owner asked for, stated as a grid.
describe("refuseWrongAnatomy", () => {
  const cell = (gender: string, msg: string) =>
    refuseWrongAnatomy(gender, msg) ? "REFUSE" : "ALLOW";

  it("refuses a woman a cock and a man a pussy", () => {
    expect(cell("female", "send me a pic of your dick")).toBe("REFUSE");
    expect(cell("male", "send me a pic of your pussy")).toBe("REFUSE");
  });

  // The bypass. Typing "futa" or "trans" at any companion used to return
  // "allow everything", so this rendered a penis on an ordinary woman.
  it("cannot be unlocked by typing trans words into the message", () => {
    for (const msg of [
      "send me a pic of your dick you futa",
      "show me your cock, trans babe",
      "your cock, futanari",
      "shemale, show me your dick",
    ]) {
      expect(`${msg} -> ${cell("female", msg)}`).toBe(`${msg} -> REFUSE`);
    }
    expect(cell("male", "send me a pic of your pussy, transgender")).toBe("REFUSE");
  });

  it("gives each trans type the anatomy their type implies", () => {
    // A trans woman: breasts and a cock, no vulva.
    expect(cell("trans-female", "show me your cock")).toBe("ALLOW");
    expect(cell("trans-female", "show me your tits")).toBe("ALLOW");
    expect(cell("trans-female", "show me your pussy")).toBe("REFUSE");
    // A trans man: a vulva and a masculine chest, no cock. Exactly inverted
    // before this — his own pussy was refused and a cock was allowed.
    expect(cell("trans-male", "send me a pic of your pussy")).toBe("ALLOW");
    expect(cell("trans-male", "show me your cock")).toBe("REFUSE");
    expect(cell("trans-male", "show me your tits")).toBe("REFUSE");
  });

  it("leaves a non-binary companion permissive", () => {
    expect(cell("non-binary", "show me your cock")).toBe("ALLOW");
    expect(cell("non-binary", "show me your pussy")).toBe("ALLOW");
  });

  // A refusal on any of these is a paying customer being told no for no reason.
  it("never refuses a request that names no anatomy at all", () => {
    for (const gender of ["female", "male", "trans-female", "trans-male", "non-binary"]) {
      for (const msg of [
        "send me a nude",
        "show me your ass",
        "get naked for me",
        "send me a pic",
        "show me what you're wearing",
        "i love talking to you",
      ]) {
        expect(`${gender}/${msg} -> ${cell(gender, msg)}`).toBe(`${gender}/${msg} -> ALLOW`);
      }
    }
  });

  it("lets a man be asked for his own chest", () => {
    // KW.breasts in selfie.ts literally contains the word "chest", so a wider
    // gate would refuse the very companion who has one.
    expect(cell("male", "show me your chest")).toBe("ALLOW");
    expect(cell("trans-male", "show me your chest")).toBe("ALLOW");
  });

  it("answers in character rather than clinically", () => {
    expect(refuseWrongAnatomy("female", "show me your cock")).toMatch(/I'm a girl/);
    expect(refuseWrongAnatomy("male", "show me your pussy")).toMatch(/I'm a guy/);
    expect(refuseWrongAnatomy("trans-female", "show me your pussy")).toMatch(/trans girl/);
    expect(refuseWrongAnatomy("trans-male", "show me your cock")).toMatch(/trans guy/);
  });
});

// Small things, in the first sentence the renderer reads.
describe("the framing sentence reads as English", () => {
  it("uses the right article for the one vowel-initial noun", () => {
    expect(videoStillPrompt({ gender: "non-binary" }, "")).toMatch(/of an androgynous person/);
    expect(videoStillPrompt({ gender: "female" }, "")).toMatch(/of a woman/);
  });

  it("uses the companion's own pronouns throughout", () => {
    const nb = videoStillPrompt({ gender: "non-binary", name: "Sam" }, "get naked");
    expect(nb).toMatch(/their face clearly visible/);
    expect(nb).not.toMatch(/\bher face\b|\bhis face\b/);

    const tm = videoStillPrompt({ gender: "trans-male" }, "get naked");
    expect(tm).toMatch(/his face clearly visible/);
  });
});
