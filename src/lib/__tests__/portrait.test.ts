import { describe, it, expect } from "vitest";
import { portraitPrompt } from "../portrait";

const subject = (name: string, gender = "female") => ({
  name,
  age: 24,
  ethnicity: "Italian",
  gender,
  art_style: "realistic",
  short_bio: "",
});

// The live roster, so the variety assertions reflect the real homepage grid.
const ROSTER = [
  "Aria", "Sofia", "Mei", "Amara", "Priya", "Yuki", "Layla", "Zara",
  "Isabella", "Anya", "Kalani", "Camila", "Chloé", "Naomi", "Mina", "Esmé",
  "Hana", "Jasmine", "Aaliyah", "Elena", "Linh", "Sienna", "Daniella", "Tia",
  "Maya", "Yume", "Rei", "Candy", "Sunny",
];

const outfitOf = (p: string) => p.match(/wearing ([^,]+)/)?.[1] ?? "";
const poseOf = (p: string) => p.match(/Pose: ([^.]+)\./)?.[1] ?? "";

describe("portraitPrompt", () => {
  it("locks the rendered sex with a booru gender tag", () => {
    expect(portraitPrompt(subject("Kaito", "male"))).toMatch(/^handsome adult man, solo, male focus/);
    expect(portraitPrompt(subject("Aria"))).toMatch(/^attractive woman, solo/);
    expect(portraitPrompt(subject("Sky", "non-binary"))).toMatch(/^androgynous person, solo/);
  });

  it("keeps public portraits clothed", () => {
    for (const g of ["female", "male", "non-binary"]) {
      const p = portraitPrompt(subject("Test", g));
      expect(p, g).toMatch(/fully clothed/);
      expect(p, g).toMatch(/revealing but covered/);
    }
  });

  it("dresses each gender in something that makes sense for it", () => {
    expect(outfitOf(portraitPrompt(subject("Kaito", "male")))).not.toMatch(/lingerie|bra|dress/i);
    // A few female names to confirm the feminine pool is in play.
    const fem = ["Aria", "Sofia", "Mei"].map((n) => outfitOf(portraitPrompt(subject(n))));
    expect(fem.join(" ")).toMatch(/bra|dress|chemise|bikini|bodysuit|babydoll|crop top|robe/i);
  });

  // The whole point of the variation pools: 31 companions used to share one
  // prompt, so the homepage grid was the same pose in the same outfit 31 times.
  it("gives the roster a spread of outfits and poses", () => {
    const outfits = new Set(ROSTER.map((n) => outfitOf(portraitPrompt(subject(n)))));
    const poses = new Set(ROSTER.map((n) => poseOf(portraitPrompt(subject(n)))));
    expect(outfits.size).toBeGreaterThanOrEqual(6);
    expect(poses.size).toBeGreaterThanOrEqual(5);
  });

  it("never repeats an outfit AND pose pair across the roster", () => {
    const pairs = ROSTER.map((n) => {
      const p = portraitPrompt(subject(n));
      return `${outfitOf(p)}|${poseOf(p)}`;
    });
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("is deterministic, so reruns don't reshuffle a companion's look", () => {
    expect(portraitPrompt(subject("Aria"))).toBe(portraitPrompt(subject("Aria")));
  });
});
