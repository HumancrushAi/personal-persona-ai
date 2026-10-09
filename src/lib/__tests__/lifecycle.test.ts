import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OPT_OUT_AFTER_MS,
  copyFor,
  dueMilestone,
  stageFor,
  unsubscribeToken,
  unsubscribeTokenValid,
} from "../lifecycle";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);

describe("stageFor", () => {
  it("sorts accounts by what they have done", () => {
    expect(stageFor(0, false)).toBe("never_started");
    expect(stageFor(3, true)).toBe("sampled");
    expect(stageFor(6, true)).toBe("engaged");
  });
});

describe("dueMilestone", () => {
  it("is nothing before the first rung", () => {
    expect(dueMilestone("sampled", T0, null, T0 + 0.5 * DAY)).toBeNull();
  });

  it("is the first rung once a day has passed, once", () => {
    expect(dueMilestone("sampled", T0, null, T0 + 1.1 * DAY)).toBe(1);
    // Sent at the day-1 rung: nothing more until day 3.
    expect(dueMilestone("sampled", T0, T0 + 1.1 * DAY, T0 + 2 * DAY)).toBeNull();
    expect(dueMilestone("sampled", T0, T0 + 1.1 * DAY, T0 + 3.2 * DAY)).toBe(3);
  });

  it("skips rungs that were passed in silence rather than queueing them", () => {
    expect(dueMilestone("sampled", T0, null, T0 + 8 * DAY)).toBe(7);
  });

  it("never sends twice in a day", () => {
    expect(dueMilestone("engaged", T0, T0 + 2.9 * DAY, T0 + 3 * DAY)).toBeNull();
  });

  it("ends with the ladder", () => {
    expect(dueMilestone("never_started", T0, T0 + 14.1 * DAY, T0 + 60 * DAY)).toBeNull();
  });

  it("respects an opt-out for good", () => {
    expect(dueMilestone("engaged", T0, OPT_OUT_AFTER_MS, T0 + 10 * DAY)).toBeNull();
  });
});

describe("copyFor", () => {
  it("sends a cold account to browse and a chatter back to her chat", () => {
    const cold = copyFor("never_started", 1, { nick: "She", companionName: "Aria", outOfCredits: false, chatPath: null });
    expect(cold.path).toBe("/browse");
    expect(cold.chatLine).toBe("");
    const warm = copyFor("sampled", 1, { nick: "Nova", companionName: "Aria", outOfCredits: true, chatPath: "/chat/abc" });
    expect(warm.path).toBe("/chat/abc");
    expect(warm.chatLine.length).toBeGreaterThan(10);
    expect(warm.body).toContain("out of credits");
    expect(warm.subject).toContain("Nova");
  });
});

describe("unsubscribe token", () => {
  const prev = process.env.UNSUBSCRIBE_SECRET;
  beforeEach(() => {
    process.env.UNSUBSCRIBE_SECRET = "test-secret";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.UNSUBSCRIBE_SECRET;
    else process.env.UNSUBSCRIBE_SECRET = prev;
  });

  it("accepts its own token and nothing else", () => {
    const uid = "e544ff8f-e00c-43e8-8869-f24d25d8a59e";
    const t = unsubscribeToken(uid);
    expect(unsubscribeTokenValid(uid, t)).toBe(true);
    expect(unsubscribeTokenValid(uid, t.replace(/^./, "0").replace(/^0/, "f"))).toBe(false);
    expect(unsubscribeTokenValid("00000000-0000-4000-8000-000000000000", t)).toBe(false);
  });
});
