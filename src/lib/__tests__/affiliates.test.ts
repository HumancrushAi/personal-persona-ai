import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AFFILIATE_WINDOW_DAYS,
  clearStoredRef,
  commissionCents,
  formatCents,
  normalizeAffiliateCode,
  readStoredRef,
  storeRef,
} from "../affiliates";

describe("normalizeAffiliateCode", () => {
  // A code gets typed by hand, printed on things and pasted into other
  // people's CMSes. A case mismatch losing someone their commission would be
  // invisible from both ends, so it is normalised rather than rejected.
  it("accepts a code however it was typed", () => {
    expect(normalizeAffiliateCode("Gary")).toBe("gary");
    expect(normalizeAffiliateCode("  GARY_B  ")).toBe("gary_b");
    expect(normalizeAffiliateCode("promo-2026")).toBe("promo-2026");
  });

  it("rejects what the database CHECK would reject anyway", () => {
    for (const bad of ["", "a", "-lead", "_lead", "has space", "ünïcode", "x".repeat(33), null]) {
      expect(`${JSON.stringify(bad)} -> ${normalizeAffiliateCode(bad as string)}`).toBe(
        `${JSON.stringify(bad)} -> null`,
      );
    }
  });

  // The client stores the code and the server validates it. If they disagreed,
  // the browser would hold a code the server always refuses and the referral
  // would silently never happen.
  it("matches the pattern in the migration", () => {
    const migration = /^[a-z0-9][a-z0-9_-]{1,31}$/;
    for (const c of ["gary", "gary_b", "promo-2026", "x2"]) {
      expect(`${c} -> ${migration.test(normalizeAffiliateCode(c)!)}`).toBe(`${c} -> true`);
    }
  });
});

describe("commissionCents", () => {
  it("takes the agreed percentage", () => {
    expect(commissionCents(1000, 10)).toBe(100);
    expect(commissionCents(1999, 50)).toBe(1000); // 999.5 → 1000
    expect(commissionCents(2500, 20)).toBe(500);
  });

  // Mirrors the ROUND in accrue_affiliate_commission. Floor would shave a cent
  // off most small transactions in our favour.
  it("rounds rather than floors", () => {
    expect(commissionCents(999, 10)).toBe(100); // 99.9, not 99
    expect(commissionCents(101, 50)).toBe(51); // 50.5, not 50
  });

  it("is zero when there is nothing to pay", () => {
    for (const [g, p] of [
      [0, 20],
      [1000, 0],
      [-500, 20],
      [NaN, 20],
      [1000, NaN],
    ] as const) {
      expect(`${g}/${p} -> ${commissionCents(g, p)}`).toBe(`${g}/${p} -> 0`);
    }
  });

  it("never pays more than the sale", () => {
    expect(commissionCents(1000, 100)).toBe(1000);
  });
});

describe("formatCents", () => {
  it("reads as money", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(1234)).toBe("$12.34");
    expect(formatCents(-500)).toBe("-$5.00");
  });
});

describe("the pending code in the browser", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it("survives the round trip from landing to signup", () => {
    storeRef("gary");
    expect(readStoredRef()).toBe("gary");
  });

  // Attribution is first touch — the UNIQUE on affiliate_referrals.user_id says
  // so. If this overwrote, the two halves would disagree about who introduced a
  // customer depending on when they got round to registering.
  it("keeps the FIRST affiliate, not the most recent", () => {
    storeRef("gary");
    storeRef("someone-else");
    expect(readStoredRef()).toBe("gary");
  });

  it("expires after the attribution window", () => {
    const t0 = 1_000_000_000_000;
    storeRef("gary", t0);
    const justInside = t0 + (AFFILIATE_WINDOW_DAYS * 86_400_000 - 1000);
    const justOutside = t0 + (AFFILIATE_WINDOW_DAYS * 86_400_000 + 1000);
    expect(readStoredRef(justInside)).toBe("gary");
    expect(readStoredRef(justOutside)).toBe(null);
  });

  it("can be cleared once it has been claimed", () => {
    storeRef("gary");
    clearStoredRef();
    expect(readStoredRef()).toBe(null);
  });

  it("ignores junk under its key rather than throwing on a page load", () => {
    localStorage.setItem("hc_ref", "not json");
    expect(readStoredRef()).toBe(null);
    localStorage.setItem("hc_ref", JSON.stringify({ code: "has space", at: Date.now() }));
    expect(readStoredRef()).toBe(null);
    localStorage.setItem("hc_ref", JSON.stringify({ code: "gary" }));
    expect(readStoredRef()).toBe(null);
  });

  // Private browsing, blocked site data, an embedded webview. A referral is
  // worth a few percent; it is never worth an exception on a page load.
  it("survives storage being unavailable entirely", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => storeRef("gary")).not.toThrow();
    expect(() => clearStoredRef()).not.toThrow();
    expect(readStoredRef()).toBe(null);
  });
});

// The approval gap. An affiliate applies, shares their link early, and people
// arrive before an admin has approved them — claimReferral only accepts an
// 'active' affiliate, so every one of those visitors comes back "unknown_code".
//
// Clearing the stored code on that answer would mean everyone who arrived
// during the gap is silently never attributed, which is precisely the
// affiliate's launch week. AffiliateTracker treats every other settled reason
// as final and leaves this one to retry; the ninety-day window bounds it.
describe("which claim outcomes are final", () => {
  // Mirrors the condition in AffiliateTracker: clear unless it can still change.
  const shouldClear = (reason: string) => reason !== "unknown_code";

  it("stops retrying once the answer cannot change", () => {
    for (const reason of ["ok", "already_referred", "self_referral", "bad_code"]) {
      expect(`${reason} -> ${shouldClear(reason)}`).toBe(`${reason} -> true`);
    }
  });

  it("keeps retrying while an application is still pending approval", () => {
    expect(shouldClear("unknown_code")).toBe(false);
  });
});
