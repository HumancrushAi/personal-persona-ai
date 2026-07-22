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
});
