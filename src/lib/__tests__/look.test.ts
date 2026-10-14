import { describe, expect, it } from "vitest";
import { lookCacheKey, tidyLook } from "../look.server";

describe("a companion's look in words", () => {
  it("is one short lowercase phrase", () => {
    expect(tidyLook('"Blue shoulder-length wavy hair, blue eyes, fair skin, slim build."')).toBe(
      "blue shoulder-length wavy hair, blue eyes, fair skin, slim build",
    );
  });

  it("drops a refusal or an essay", () => {
    expect(tidyLook("I'm sorry, I cannot describe people.")).toBe("");
    expect(tidyLook("a ".repeat(40)).split(" ").length).toBeLessThanOrEqual(34);
  });

  it("never puts an absent tattoo into a positive prompt", () => {
    expect(tidyLook("chest-length brown hair, hazel eyes, tan skin, curvy build, no visible tattoos")).toBe(
      "chest-length brown hair, hazel eyes, tan skin, curvy build",
    );
  });

  it("keys the cache on the portrait, not the name", () => {
    // "look4": absent tattoos are omitted; positive prompts must never say "no tattoos".
    expect(lookCacheKey("https://x/a.png")).toMatch(/^look4:[0-9a-f]{24}$/);
    expect(lookCacheKey("https://x/a.png")).not.toBe(lookCacheKey("https://x/b.png"));
  });
});
