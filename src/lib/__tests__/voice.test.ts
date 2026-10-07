import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../ai", () => ({
  chatComplete: vi.fn(),
  textToSpeech: vi.fn(async (t: string) => Buffer.from(`openai:${t}`)),
}));

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.RUNPOD_TTS_ENDPOINT;
});

describe("her voice note", () => {
  it("hears a request to moan", async () => {
    const { asksForMoan } = await import("../voice.server");
    for (const t of ["moan for me", "let me hear you moaning", "make some noise babe"]) {
      expect(asksForMoan(t), t).toBe(true);
    }
    for (const t of ["send me a pic", "how was your day", "what's up"]) {
      expect(asksForMoan(t), t).toBe(false);
    }
  });

  it("gives each companion a stable voice that matches her gender", async () => {
    const { orpheusVoiceFor } = await import("../voice.server");
    const a = orpheusVoiceFor({ name: "Aria", gender: "female", voice_id: "alloy" });
    expect(["tara", "leah", "jess", "mia", "zoe"]).toContain(a);
    expect(orpheusVoiceFor({ name: "Aria", gender: "female", voice_id: "alloy" })).toBe(a);
    expect(["leo", "dan", "zac"]).toContain(orpheusVoiceFor({ name: "Dante", gender: "male" }));
    expect(orpheusVoiceFor({ name: "X", gender: "female", voice_id: "Mia" })).toBe("mia");
  });

  it("keeps her exact words, adding only cues", async () => {
    const ai = await import("../ai");
    const { performScript } = await import("../voice.server");
    (ai.chatComplete as any).mockResolvedValueOnce("<sigh> I missed you so much. [moan]");
    expect(await performScript("I missed you so much.", "hey")).toBe("<sigh> I missed you so much. [moan]");
    // A rewrite is rejected: she says exactly what the chat showed.
    (ai.chatComplete as any).mockResolvedValueOnce("<sigh> I really missed you, baby.");
    expect(await performScript("I missed you so much.", "hey")).toBe("I missed you so much.");
  });

  it("moans when asked, even if the markup pass forgot", async () => {
    const ai = await import("../ai");
    const { performScript } = await import("../voice.server");
    (ai.chatComplete as any).mockResolvedValueOnce("Only for you.");
    expect(await performScript("Only for you.", "moan for me")).toMatch(/\[moan\].*Only for you\..*\[moan\]/);
  });

  it("uses the OpenAI voice, without markup, when Orpheus is not configured", async () => {
    const ai = await import("../ai");
    const { companionVoiceNote } = await import("../voice.server");
    const buf = await companionVoiceNote({
      reply: "Hi <sigh> there [moan]",
      userAsk: "",
      companion: { name: "Aria", gender: "female" },
      openaiVoice: "coral",
    });
    expect(buf.toString()).toBe("openai:Hi there");
    expect(ai.textToSpeech).toHaveBeenCalledWith("Hi there", "coral");
  });
});
