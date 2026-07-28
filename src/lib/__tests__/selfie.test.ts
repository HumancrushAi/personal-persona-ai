import { describe, it, expect } from "vitest";
import { selfiePrompt, wantsSelfie } from "../selfie";

describe("wantsSelfie", () => {
  it("detects explicit pic requests", () => {
    for (const t of [
      "show me your pussy",
      "send me a pic",
      "can I see your tits",
      "send a nude",
      "take a selfie for me",
      "lemme see your ass",
      "I wanna see you naked",
      "show mw your dick",
      "send dick",
      "give me cock",
    ]) {
      expect(wantsSelfie(t), t).toBe(true);
    }
  });

  it("does not trigger on normal chat", () => {
    for (const t of [
      "how was your day",
      "i love talking to you",
      "tell me about yourself",
      "what are you thinking about",
    ]) {
      expect(wantsSelfie(t), t).toBe(false);
    }
  });
});

describe("selfiePrompt", () => {
  const c = { name: "Amara", age: 23, ethnicity: "Latina", short_bio: "playful" };

  it("builds a female 1girl booru prompt that follows an explicit pussy request", () => {
    const p = selfiePrompt(c, "show me your pussy", "flirty");
    expect(p).toMatch(/1girl/);
    expect(p).toContain("show me your pussy");
    // request keyword maps to explicit pose tags so the picture matches it
    expect(p).toMatch(/spread pussy|presenting/i);
    expect(p).toContain("Latina");
    expect(p).not.toMatch(/1boy|\bpenis\b/i);
  });

  it("renders described sexual acts (toy, anal, masturbation) as pose tags + nudity", () => {
    const dildo = selfiePrompt(c, "show me a picture of you sticking a dildo in your ass", "");
    expect(dildo).toMatch(/naked|nude/i);
    expect(dildo).toMatch(/dildo/i);
    expect(dildo).toMatch(/anal/i);

    const play = selfiePrompt(c, "a pic of you playing with yourself", "");
    expect(play).toMatch(/naked|nude/i); // must not stay clothed
    expect(play).toMatch(/masturbation|fingering|pleasuring/i);

    const touch = selfiePrompt(c, "touch yourself for me", "");
    expect(touch).toMatch(/masturbation|fingering|pleasuring/i);
  });

  it("has a sensible default when no request is given", () => {
    const p = selfiePrompt(c, "", null);
    expect(p).toMatch(/1girl/);
    expect(p).toMatch(/seductive/i);
  });

  it("builds a male booru prompt that includes the user's request and backstory", () => {
    const maleC = { name: "Kaito", age: 25, ethnicity: "Japanese", gender: "male", short_bio: "athletic" };
    const p = selfiePrompt(maleC, "flexing his muscles", "gym rat");
    expect(p).toMatch(/1boy/);
    expect(p).toContain("flexing his muscles");
    expect(p).toContain("gym rat");
    expect(p).toContain("Japanese");
  });

  it("builds a booru 1boy prompt with genitalia for nude male companions", () => {
    const maleC = { name: "Kaito", age: 25, ethnicity: "Japanese", gender: "male", short_bio: "athletic" };
    const p = selfiePrompt(maleC, "send me a nude", "casual");
    expect(p).toMatch(/1boy/);
    expect(p).toMatch(/penis/i);
    expect(p).toMatch(/testicles/i);
    // Pony draws any anatomy tag it sees — the male prompt must never name female parts.
    expect(p).not.toMatch(/vagina|vulva/i);
  });

  it("builds a nude female booru prompt without male parts", () => {
    const p = selfiePrompt(c, "send me a nude", "flirty");
    expect(p).toMatch(/1girl/);
    expect(p).toMatch(/naked|nude/i);
    // The female prompt must never name male parts.
    expect(p).not.toMatch(/\bpenis\b|testicles|1boy/i);
  });

  it("does not force nudity on a clothed male request", () => {
    const maleC = { name: "Kaito", age: 25, ethnicity: "Japanese", gender: "male", short_bio: "athletic" };
    const p = selfiePrompt(maleC, "wearing a suit at dinner", "casual");
    expect(p).not.toMatch(/penis|testicles/i);
    expect(p).toMatch(/1boy/);
  });

  it("uses gender-neutral pronouns for non-binary companions", () => {
    const nbC = { name: "Jordan", age: 22, ethnicity: "mixed", gender: "non-binary" };
    const p = selfiePrompt(nbC, "", "alternative");
    expect(p).toContain("Their look/vibe");
    expect(p).toContain("They smile seductively");
    expect(p).not.toContain("She");
    expect(p).not.toContain("He");
  });
});
