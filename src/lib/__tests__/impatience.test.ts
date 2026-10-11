import { describe, it, expect } from "vitest";
import { IMPATIENCE_RE } from "../chat.functions";

// "Hurry up" while a photo is rendering was reaching the text model, which
// once answered "I'm not comfortable showing my body in such a rush" — two
// minutes before the photo landed. These are the words people actually sent
// while waiting, read back out of the job history.
describe("impatience while a photo or clip renders", () => {
  it("hears every way people say it", () => {
    for (const m of [
      "Hurry up",
      "Where's it",
      "Why is it taking so long?",
      "Well???",
      "???",
      "It doesn't come through",
      "Are you there?",
      "still waiting",
      "come on",
      "did you send it",
      "nothing came",
      "I don't see it",
      "how long",
      "is it coming",
      "stuck",
    ])
      expect(IMPATIENCE_RE.test(m.trim()), m).toBe(true);
  });

  it("leaves conversation alone", () => {
    for (const m of [
      "show me your tits",
      "I had a rough day",
      "what are you wearing?",
      "you look amazing",
      "tell me about yourself",
      "hi",
    ])
      expect(IMPATIENCE_RE.test(m.trim()), m).toBe(false);
  });
});
