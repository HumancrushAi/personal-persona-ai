import { describe, it, expect } from "vitest";
import { CREDIT_PACKS, SUBSCRIPTION_TIERS, formatPrice, findPurchasable } from "../credit-packs";

describe("findPurchasable", () => {
  it("resolves a one-time pack by id", () => {
    expect(findPurchasable("lover")?.name).toBe("Lover");
  });
  it("resolves a subscription tier by id", () => {
    expect(findPurchasable("sub-soulmate")?.name).toBe("Soulmate");
  });
  it("returns undefined for unknown id", () => {
    expect(findPurchasable("nope")).toBeUndefined();
  });
});

describe("formatPrice", () => {
  it("formats cents to dollars", () => {
    expect(formatPrice(500)).toBe("$5.00");
    expect(formatPrice(1299)).toBe("$12.99");
  });
});

describe("catalog integrity", () => {
  it("packs have positive credits and price, unique ids", () => {
    const ids = new Set<string>();
    for (const p of CREDIT_PACKS) {
      expect(p.credits).toBeGreaterThan(0);
      expect(p.priceCents).toBeGreaterThan(0);
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
    }
  });
  it("tiers grant positive monthly credits, unique ids", () => {
    const ids = new Set<string>();
    for (const t of SUBSCRIPTION_TIERS) {
      expect(t.monthlyCredits).toBeGreaterThan(0);
      expect(t.priceCents).toBeGreaterThan(0);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });
});
