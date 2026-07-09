import { describe, it, expect } from "vitest";
import { transactionResult, subscriptionResult } from "../authnet";

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
