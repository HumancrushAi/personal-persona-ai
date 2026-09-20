import { describe, it, expect } from "vitest";
import { estimateTokens, fitToBudget } from "../history-budget";

// Ten messages reached the model. The model holds 131,072 tokens.
//
// Every previous fix in this area rewrote the system prompt, because the prompt
// is what a reviewer reads. The actual constraint was `.slice(-10)` — a number
// chosen for a model that no longer runs here.
describe("as much of the conversation as the window holds", () => {
  const msg = (role: string, content: string) => ({ role, content });

  it("keeps everything when it all fits", () => {
    const all = Array.from({ length: 50 }, (_, i) => msg("user", `message number ${i}`));
    const { kept, dropped } = fitToBudget(all, 100_000);
    expect(kept).toHaveLength(50);
    expect(dropped).toBe(0);
  });

  // The direction matters more than the count. Dropping the oldest turn costs
  // background; dropping the newest costs the question the user just asked,
  // which is the bug this module was written to make impossible.
  it("drops the oldest first and always keeps the newest", () => {
    const all = Array.from({ length: 100 }, (_, i) => msg("user", "x".repeat(350)));
    all[99] = msg("user", "how are you");
    const { kept, dropped } = fitToBudget(all, 1000);
    expect(dropped).toBeGreaterThan(0);
    expect(kept[kept.length - 1].content).toBe("how are you");
  });

  it("returns chronological order, oldest to newest", () => {
    const all = [msg("user", "first"), msg("assistant", "second"), msg("user", "third")];
    expect(fitToBudget(all, 100_000).kept.map((m) => m.content)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  // A single enormous message is still better sent than silently swallowed:
  // the model refusing an over-long prompt is a visible failure, while an
  // empty payload is the invisible one that cost five commits.
  it("keeps the newest message even when it alone busts the budget", () => {
    const { kept } = fitToBudget([msg("user", "old"), msg("user", "y".repeat(50_000))], 100);
    expect(kept).toHaveLength(1);
    expect(kept[0].content).toHaveLength(50_000);
  });

  it("handles an empty conversation", () => {
    expect(fitToBudget([], 5000)).toEqual({ kept: [], dropped: 0, tokens: 0 });
  });

  // The estimate must run HIGH. Underestimating means a request over the
  // window, which OpenRouter refuses outright — the user gets nothing.
  it("overestimates rather than underestimates", () => {
    // English averages ~4 chars/token; at 3.5 plus an envelope this must exceed
    // any real tokenizer's count for plain prose.
    const words = "the quick brown fox jumps over the lazy dog ".repeat(20);
    expect(estimateTokens(words)).toBeGreaterThan(words.split(/\s+/).filter(Boolean).length);
  });

  it("charges a per-message envelope so many short messages are not free", () => {
    expect(estimateTokens("hi")).toBeGreaterThan(1);
    const many = Array.from({ length: 200 }, () => msg("user", "hi"));
    expect(fitToBudget(many, 100).kept.length).toBeLessThan(200);
  });
});
