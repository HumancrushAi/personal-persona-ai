import { describe, it, expect } from "vitest";
import { stillImagePrompt, videoActionPrompt, finishMediaPrompt, settingSentenceFor } from "../selfie";
import { anatomyOf } from "../anatomy";
import { tidyRoom, settingSentence } from "../rooms.server";
import { CHEST_EXTRAS, chestItemById } from "../toys";

// The user's own room, described once, is the setting of every prompt for
// that chat — stated the same way by the builders, the refined prompt and
// the refiner's own rule.
describe("her picture in the user's room", () => {
  const room = "a small bedroom, grey upholstered bed with white linen, sage green walls, oak floor, warm lamp on a nightstand";

  it("is said by both builders, in place of the plain white sheets", () => {
    const still = stillImagePrompt({ gender: "female" }, "show me your tits", null, room);
    expect(still).toContain(settingSentenceFor(room));
    expect(still).not.toMatch(/plain white sheets/);
    expect(still).toMatch(/on the bed/);
    const clip = videoActionPrompt({ gender: "female" }, "touching yourself", null, room);
    expect(clip).toContain(settingSentenceFor(room));
    const plain = stillImagePrompt({ gender: "female" }, "show me your tits");
    expect(plain).not.toMatch(/user's own room/);
  });

  it("is appended to a refined prompt once, never twice", () => {
    const base = "exact same woman as the reference image, completely nude, sitting on the bed.";
    const p = finishMediaPrompt(base, "show me your tits", { anatomy: anatomyOf("female"), setting: room });
    expect(p.split("user's own room").length - 1).toBe(1);
    const again = finishMediaPrompt(p, "show me your tits", { anatomy: anatomyOf("female"), setting: room });
    expect(again.split("user's own room").length - 1).toBe(1);
  });

  it("tidies what the vision model says and refuses a non-answer", () => {
    expect(tidyRoom('"A cozy bedroom, grey bed, white sheets."')).toBe("a cozy bedroom, grey bed, white sheets");
    expect(tidyRoom("I'm sorry, I cannot see a room.")).toBe("");
    expect(settingSentence("")).toBe("");
    expect(settingSentence("grey bed")).toBe(settingSentenceFor("grey bed"));
  });

  it("is sold in the chest as an item", () => {
    expect(CHEST_EXTRAS.find((e) => e.id === "room")?.price).toBe(400);
    expect(chestItemById("room")?.name).toBe("Your room");
    expect(chestItemById("dildo-glass")?.price).toBe(350);
    expect(chestItemById("nope")).toBeNull();
  });
});
