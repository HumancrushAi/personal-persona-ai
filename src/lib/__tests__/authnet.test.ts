import { describe, it, expect } from "vitest";
import {
  transactionResult,
  subscriptionResult,
  transactionDetailsResult,
  webhookAction,
  isFullRefund,
} from "../authnet";

// Response shapes mirror real Authorize.Net API payloads.

describe("transactionResult (one-time pack)", () => {
  it("approves responseCode 1 and returns transId", () => {
    const json = {
      transactionResponse: { responseCode: "1", transId: "60000012345" },
      messages: { resultCode: "Ok" },
    };
    expect(transactionResult(json)).toEqual({ ok: true, transId: "60000012345" });
  });
  it("declines responseCode 2 with the gateway error text", () => {
    const json = {
      transactionResponse: {
        responseCode: "2",
        errors: [{ errorText: "This transaction has been declined." }],
      },
      messages: { resultCode: "Ok" },
    };
    const r = transactionResult(json);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("This transaction has been declined.");
  });
  it("falls back to messages text when no transactionResponse errors", () => {
    const json = { messages: { resultCode: "Error", message: [{ text: "Invalid OTS Token." }] } };
    expect(transactionResult(json)).toMatchObject({ ok: false, error: "Invalid OTS Token." });
  });
});

describe("subscriptionResult (ARB)", () => {
  it("creates when resultCode Ok and subscriptionId present", () => {
    const json = { subscriptionId: "9999999", messages: { resultCode: "Ok" } };
    expect(subscriptionResult(json)).toEqual({ ok: true, subscriptionId: "9999999" });
  });
  it("fails when declined", () => {
    const json = {
      messages: { resultCode: "Error", message: [{ text: "The credit card has expired." }] },
    };
    expect(subscriptionResult(json)).toMatchObject({
      ok: false,
      error: "The credit card has expired.",
    });
  });
  it("fails when Ok but no subscriptionId", () => {
    expect(subscriptionResult({ messages: { resultCode: "Ok" } }).ok).toBe(false);
  });
});

// Field names are verbatim from transactionDetailsType and
// subscriptionPaymentType in AnetApiSchema.xsd. A wrong casing here (refTransID)
// would not throw — it would silently read undefined and every refund would
// fail to find its sale.
describe("transactionDetailsResult (getTransactionDetails)", () => {
  it("reads the subscription and payment number off a recurring charge", () => {
    const r = transactionDetailsResult({
      transaction: {
        transId: "60020981676",
        transactionStatus: "capturedPendingSettlement",
        subscription: { id: 9_876_543, payNum: 3 },
        authAmount: 29.99,
        settleAmount: 29.99,
      },
      messages: { resultCode: "Ok" },
    });
    expect(r).toMatchObject({
      ok: true,
      transId: "60020981676",
      subscriptionId: "9876543",
      payNum: 3,
      authCents: 2999,
    });
    expect(r.refTransId).toBeUndefined();
  });

  it("reads the original charge off a refund", () => {
    const r = transactionDetailsResult({
      transaction: {
        transId: "60020990000",
        refTransId: "60020981676",
        transactionStatus: "refundPendingSettlement",
        authAmount: "12.99",
        settleAmount: "0.00",
      },
      messages: { resultCode: "Ok" },
    });
    expect(r).toMatchObject({ ok: true, refTransId: "60020981676", authCents: 1299 });
    expect(r.subscriptionId).toBeUndefined();
  });

  // 12.99 * 100 is 1298.9999999999998 in floating point.
  it("rounds dollar amounts to the cent rather than truncating", () => {
    const r = transactionDetailsResult({
      transaction: { transId: "1", authAmount: 12.99, settleAmount: 0.29 },
      messages: { resultCode: "Ok" },
    });
    expect(r.authCents).toBe(1299);
    expect(r.settleCents).toBe(29);
  });

  it("treats a zero id as absent, not as a transaction called 0", () => {
    const r = transactionDetailsResult({
      transaction: { transId: "5", refTransId: "0", subscription: { id: 0, payNum: 0 } },
      messages: { resultCode: "Ok" },
    });
    expect(r.refTransId).toBeUndefined();
    expect(r.subscriptionId).toBeUndefined();
    expect(r.payNum).toBeUndefined();
  });

  it("returns the gateway's reason when the lookup is refused", () => {
    const r = transactionDetailsResult({
      messages: { resultCode: "Error", message: [{ text: "Transaction Details API is not enabled." }] },
    });
    expect(r).toEqual({ ok: false, error: "Transaction Details API is not enabled." });
  });

  it("is not ok on an Ok response that carries no transaction", () => {
    expect(transactionDetailsResult({ messages: { resultCode: "Ok" } }).ok).toBe(false);
  });
});

describe("webhookAction", () => {
  it("routes each event this app acts on", () => {
    expect(webhookAction("net.authorize.payment.authcapture.created")).toBe("charge");
    expect(webhookAction("net.authorize.payment.refund.created")).toBe("refund");
    expect(webhookAction("net.authorize.payment.void.created")).toBe("void");
    for (const end of ["cancelled", "expired", "suspended", "terminated"]) {
      expect(webhookAction(`net.authorize.customer.subscription.${end}`)).toBe("cancel");
    }
  });

  // This decides whether money is recorded. A substring match — which the old
  // handler used — would act on any future event whose name contains one.
  it("ignores everything else, including near misses", () => {
    for (const e of [
      "",
      "net.authorize.payment.authorization.created",
      "net.authorize.payment.priorAuthCapture.created",
      "net.authorize.customer.subscription.created",
      "net.authorize.payment.authcapture.created.v2",
      "x.net.authorize.payment.refund.created",
    ]) {
      expect(`${e} -> ${webhookAction(e)}`).toBe(`${e} -> ignore`);
    }
  });
});

describe("isFullRefund", () => {
  it("counts a refund of the whole sale", () => {
    expect(isFullRefund(2999, 2999)).toBe(true);
  });

  it("allows a cent of rounding", () => {
    expect(isFullRefund(2998, 2999)).toBe(true);
  });

  // A goodwill five dollars off must not void the affiliate's whole commission.
  it("does not count a partial refund", () => {
    expect(isFullRefund(500, 2999)).toBe(false);
    expect(isFullRefund(2997, 2999)).toBe(false);
  });

  // The safe failure is leaving a commission for a person, not voiding one on
  // a guess.
  it("never calls an unknown amount full", () => {
    for (const [refund, sale] of [
      [0, 2999],
      [NaN, 2999],
      [2999, 0],
      [2999, NaN],
      [-2999, -2999],
    ] as const) {
      expect(`${refund}/${sale} -> ${isFullRefund(refund, sale)}`).toBe(`${refund}/${sale} -> false`);
    }
  });
});
