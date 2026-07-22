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

  it("puts the user's request as the main subject", () => {
    const p = selfiePrompt(c, "show me your pussy", "flirty");
    expect(p).toContain("show me your pussy");
    expect(p).toMatch(/EXACTLY this/);
    expect(p).toContain("23-year-old Latina");
  });

  it("has a sensible default when no request is given", () => {
    const p = selfiePrompt(c, "", null);
    expect(p).toMatch(/smiles seductively/i);
    expect(p).toContain("Amara");
  });

  it("uses male pronouns for male companions", () => {
    const maleC = { name: "Kaito", age: 25, ethnicity: "Japanese", gender: "male", short_bio: "athletic" };
    const p = selfiePrompt(maleC, "flexing his muscles", "casual");
    expect(p).toContain("His look/vibe");
    expect(p).toContain("He is doing EXACTLY this");
    expect(p).toContain("flexing his muscles");
    expect(p).not.toContain("She");
    expect(p).not.toContain("Her");
  });

  it("anchors male anatomy for male companions even without explicit keywords", () => {
    const maleC = { name: "Kaito", age: 25, ethnicity: "Japanese", gender: "male", short_bio: "athletic" };
    const p = selfiePrompt(maleC, "show me your body", "casual");
    expect(p).toMatch(/male penis|adult male penis/i);
    expect(p).toMatch(/NO female genitalia/i);
  });

  it("anchors female anatomy for female companions", () => {
    const p = selfiePrompt(c, "show me your body", "flirty");
    expect(p).toMatch(/vulva\/vagina/i);
    expect(p).toMatch(/NO male genitalia/i);
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
