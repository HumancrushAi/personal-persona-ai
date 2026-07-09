import { describe, it, expect } from "vitest";
import { applyDeduction, totalCredits, hasEnough } from "../credits";

describe("totalCredits", () => {
  it("sums free + paid", () => {
    expect(totalCredits({ free_messages_remaining: 10, paid_credits: 5 })).toBe(15);
  });
  it("treats null/undefined as 0", () => {
    expect(totalCredits(null)).toBe(0);
    expect(totalCredits({ free_messages_remaining: null, paid_credits: 3 })).toBe(3);
    expect(totalCredits(undefined)).toBe(0);
  });
});

describe("hasEnough", () => {
  it("true when free+paid covers cost", () => {
    expect(hasEnough(2, 6, 8)).toBe(true);
    expect(hasEnough(0, 8, 8)).toBe(true);
  });
  it("false when short", () => {
    expect(hasEnough(2, 5, 8)).toBe(false);
    expect(hasEnough(0, 0, 1)).toBe(false);
  });
});

describe("applyDeduction (free-first)", () => {
  it("spends free before paid", () => {
    expect(applyDeduction(10, 5, 1)).toEqual({ free: 9, paid: 5 });
  });
  it("spans free then paid when free runs out mid-charge", () => {
    // selfie costs 8, only 3 free left → 3 free + 5 paid consumed
    expect(applyDeduction(3, 20, 8)).toEqual({ free: 0, paid: 15 });
  });
  it("uses only paid when no free left", () => {
    expect(applyDeduction(0, 20, 8)).toEqual({ free: 0, paid: 12 });
  });
  it("exact free covers cost, paid untouched", () => {
    expect(applyDeduction(8, 4, 8)).toEqual({ free: 0, paid: 4 });
  });
});
