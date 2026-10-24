import { describe, expect, it } from "vitest";
import { reminderDue, renewalCopy } from "../renewal-reminders";

const DAY = 86_400_000;
const renews = "2026-11-10T12:00:00.000Z";
const at = Date.parse(renews);

describe("renewal reminders", () => {
  it("fires on each of the three days before the charge, once each", () => {
    // The job runs daily at 15:00 UTC.
    const runs = [5, 4, 3, 2, 1, 0].map((d) => at - d * DAY + 3 * 3_600_000);
    expect(runs.map((now) => reminderDue(renews, now))).toEqual([null, null, 3, 2, 1, null]);
  });

  it("ignores missing, past and malformed dates", () => {
    expect(reminderDue(null)).toBeNull();
    expect(reminderDue("not a date")).toBeNull();
    expect(reminderDue(renews, at + 1000)).toBeNull();
  });

  it("states the charge, the credits and that credits stay; push only on the last day", () => {
    const three = renewalCopy({ days: 3, planName: "Creator", priceCents: 7900, credits: 800, renewsAt: renews });
    expect(three.title).toBe("Your Creator plan renews in 3 days");
    expect(three.body).toContain("November 10");
    expect(three.body).toContain("$79");
    expect(three.body).toContain("800 credits");
    expect(three.body).toContain("Your current credits stay");
    expect(three.push).toBe(false);
    const last = renewalCopy({ days: 1, planName: "Creator annual", priceCents: 69900, credits: 9600, renewsAt: renews });
    expect(last.title).toBe("Your Creator annual plan renews tomorrow");
    expect(last.body).toContain("$699");
    expect(last.body).toContain("9,600 credits");
    expect(last.push).toBe(true);
  });
});
