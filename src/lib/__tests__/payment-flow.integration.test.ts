import { describe, it, expect, beforeEach } from "vitest";
import { applyDeduction, hasEnough } from "../credits";
import { transactionResult } from "../authnet";
import { CREDIT_PACKS } from "../credit-packs";

// Integration of the credit-wallet + payment pieces against an in-memory store.
// This mirrors exactly what the server functions do (chat.functions / media.functions
// / payments.functions), so the accounting is exercised end-to-end without the
// TanStack server-fn wrapper or a live database.
//
// NOTE: a true live-Supabase run (RLS, triggers) requires `supabase start` (Docker)
// and is out of scope for this unit+integration suite.

type Wallet = { free: number; paid: number };
type Ledger = { delta: number; reason: string; balance_after: number }[];
type Txns = { amount_cents: number; credits_added: number; status: string }[];

class FakeStore {
  wallet: Wallet = { free: 25, paid: 0 }; // matches DB default (25 free on signup)
  ledger: Ledger = [];
  txns: Txns = [];

  spend(cost: number, reason: string) {
    if (!hasEnough(this.wallet.free, this.wallet.paid, cost)) throw new Error("OUT_OF_CREDITS");
    const next = applyDeduction(this.wallet.free, this.wallet.paid, cost);
    this.wallet = next;
    this.ledger.push({ delta: -cost, reason, balance_after: next.free + next.paid });
  }

  grant(credits: number, reason: string, amountCents: number) {
    this.wallet.paid += credits;
    this.ledger.push({
      delta: credits,
      reason,
      balance_after: this.wallet.free + this.wallet.paid,
    });
    this.txns.push({ amount_cents: amountCents, credits_added: credits, status: "completed" });
  }

  logFailed(amountCents: number) {
    this.txns.push({ amount_cents: amountCents, credits_added: 0, status: "failed" });
  }
}

describe("wallet + payment flow", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it("deducts one credit per chat message and records the ledger", () => {
    store.spend(1, "chat_message");
    expect(store.wallet).toEqual({ free: 24, paid: 0 });
    expect(store.ledger.at(-1)).toEqual({ delta: -1, reason: "chat_message", balance_after: 24 });
  });

  it("blocks a premium request when balance is insufficient", () => {
    store.wallet = { free: 2, paid: 0 };
    expect(() => store.spend(8, "selfie")).toThrow("OUT_OF_CREDITS");
    // balance unchanged after a blocked request
    expect(store.wallet).toEqual({ free: 2, paid: 0 });
  });

  it("credits a pack purchase after an approved charge", () => {
    const pack = CREDIT_PACKS.find((p) => p.id === "lover")!;
    const approved = { transactionResponse: { responseCode: "1", transId: "60000099" } };
    const r = transactionResult(approved);
    expect(r.ok).toBe(true);
    store.grant(pack.credits, "pack_purchase", pack.priceCents);
    expect(store.wallet.paid).toBe(pack.credits);
    expect(store.txns.at(-1)).toMatchObject({ status: "completed", credits_added: pack.credits });
  });

  it("logs a failed transaction and grants nothing on a decline", () => {
    const pack = CREDIT_PACKS.find((p) => p.id === "starter")!;
    const declined = {
      transactionResponse: { responseCode: "2", errors: [{ errorText: "declined" }] },
    };
    const r = transactionResult(declined);
    expect(r.ok).toBe(false);
    if (!r.ok) store.logFailed(pack.priceCents);
    expect(store.wallet.paid).toBe(0);
    expect(store.txns.at(-1)).toMatchObject({ status: "failed", credits_added: 0 });
  });

  it("keeps ledger balance_after consistent across a purchase then spends", () => {
    const pack = CREDIT_PACKS.find((p) => p.id === "starter")!; // 50 credits
    store.grant(pack.credits, "pack_purchase", pack.priceCents); // free 25 + paid 50 = 75
    store.spend(1, "chat_message"); // spends free first → 74
    store.spend(8, "selfie"); // 66
    const last = store.ledger.at(-1)!;
    expect(last.balance_after).toBe(store.wallet.free + store.wallet.paid);
    expect(store.wallet.free + store.wallet.paid).toBe(66);
  });
});
