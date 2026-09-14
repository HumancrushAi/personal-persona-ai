import { describe, it, expect } from "vitest";
import { portraitPrompt } from "../portrait";

const subject = (name: string, gender = "female", art_style = "realistic") => ({
  name,
  age: 24,
  ethnicity: "Italian",
  gender,
  art_style,
  short_bio: "",
});

// The live roster, so the variety assertions reflect the real homepage grid.
const ROSTER = [
  "Aria", "Sofia", "Mei", "Amara", "Priya", "Yuki", "Layla", "Zara",
  "Isabella", "Anya", "Kalani", "Camila", "Chloé", "Naomi", "Mina", "Esmé",
  "Hana", "Jasmine", "Aaliyah", "Elena", "Linh", "Sienna", "Daniella", "Tia",
  "Maya", "Yume", "Rei", "Candy", "Sunny",
];

const outfitOf = (p: string) => p.match(/wearing ([^,]+),/)?.[1] ?? "";
const sceneOf = (p: string) => p.match(/wearing [^,]+, ([^.]+)\./)?.[1] ?? "";

describe("portraitPrompt", () => {
  // Plain language, first. The renderer is a natural-language model; the old
  // booru tags ("solo", "male focus") said nothing to it about gender.
  it("states the companion's sex first, in plain language", () => {
    expect(portraitPrompt(subject("Kaito", "male"))).toMatch(/^Photo of a real 24-year-old Italian man /);
    expect(portraitPrompt(subject("Aria"))).toMatch(/^Photo of a real 24-year-old Italian woman /);
    expect(portraitPrompt(subject("Sky", "non-binary"))).toMatch(
      /^Photo of a real 24-year-old Italian androgynous person /,
    );
  });

  it("keeps public portraits clothed", () => {
    for (const g of ["female", "male", "non-binary"]) {
      for (const n of ROSTER) {
        const p = portraitPrompt(subject(n, g));
        expect(outfitOf(p), `${g}/${n}`).not.toBe("");
        expect(p, `${g}/${n}`).not.toMatch(/\b(?:nude|naked|topless|nipples?|bare breasts)\b/i);
      }
    }
  });

  it("dresses each gender in something that makes sense for it", () => {
    for (const n of ROSTER) {
      expect(outfitOf(portraitPrompt(subject(n, "male")))).not.toMatch(
        /lingerie|\bbra\b|bralette|slip|bodysuit|robe/i,
      );
    }
    const fem = ROSTER.map((n) => outfitOf(portraitPrompt(subject(n))));
    expect(fem.join(" ")).toMatch(/bra|bralette|slip|bodysuit|robe|lace/i);
  });

  // The whole point of the variation pools: 31 companions used to share one
  // prompt, so the homepage grid was the same pose in the same outfit 31 times.
  it("gives the roster a spread of outfits and scenes", () => {
    const outfits = new Set(ROSTER.map((n) => outfitOf(portraitPrompt(subject(n)))));
    const scenes = new Set(ROSTER.map((n) => sceneOf(portraitPrompt(subject(n)))));
    expect(outfits.size).toBeGreaterThanOrEqual(6);
    expect(scenes.size).toBeGreaterThanOrEqual(6);
  });

  it("never repeats an outfit AND scene pair across the roster", () => {
    const pairs = ROSTER.map((n) => {
      const p = portraitPrompt(subject(n));
      return `${outfitOf(p)}|${sceneOf(p)}`;
    });
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("is deterministic, so reruns don't reshuffle a companion's look", () => {
    expect(portraitPrompt(subject("Aria"))).toBe(portraitPrompt(subject("Aria")));
  });

  // A companion's portrait is also the start frame for every chat photo, and
  // a lower body that is not in it has to be invented by the video model. Head
  // to knees, matching the framing the chat photos themselves use.
  it("keeps her down to the knees in frame, face visible", () => {
    for (const n of ROSTER) {
      expect(portraitPrompt(subject(n))).toMatch(
        /from the top of the head down to the knees with the face clearly visible/,
      );
    }
  });

  it("uses the companion's own pronouns in the scene", () => {
    for (const n of ROSTER) {
      const man = portraitPrompt(subject(n, "male"));
      expect(man, n).not.toMatch(/\bher\b|\bherself\b/);
    }
  });
});

// Realism regression. The verdict on the old portraits was that they did not
// look like real people, and the prompt said why: it described retouched
// commercial imagery and got it.
describe("portrait realism", () => {
  const realistic = ROSTER.map((n) => portraitPrompt(subject(n)));

  it("uses no glamour or render vocabulary", () => {
    for (const p of realistic) {
      expect(p).not.toMatch(
        /\b(?:stunning|gorgeous|flawless|perfect skin|glistening|luxury|luxurious|provocative|alluring|skimpy|radiant|captivating|masterpiece|8k|hyper-?realistic|magazine|infinity pool)\b/i,
      );
    }
  });

  // The old style line ended "not an AI illustration, 3D render, or drawing".
  it("never names what it is trying to avoid", () => {
    for (const p of realistic) {
      expect(p).not.toMatch(/\bnot (?:an?|the)\b|\bno (?:airbrush|filter|makeup)|\bwithout\b/i);
      expect(p).not.toMatch(/\b(?:illustration|render|drawing|cgi|3d)\b/i);
    }
  });

  it("describes a real photo of a real person", () => {
    for (const p of realistic) {
      expect(p).toMatch(/pores/);
      expect(p).toMatch(/creases/);
      expect(p).toMatch(/phone/);
    }
  });

  it("still renders anime companions as anime", () => {
    const anime = portraitPrompt(subject("Yume", "female", "anime"));
    expect(anime).toMatch(/anime/i);
    expect(anime).not.toMatch(/pores/);
  });
});
