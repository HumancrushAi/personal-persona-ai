import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyAuthnetSignature } from "../authnet-signature";

const KEY = "test-signature-key";
const BODY = JSON.stringify({
  eventType: "net.authorize.payment.authcapture.created",
  payload: { id: "60000001" },
});

function sign(body: string, key = KEY) {
  return "sha512=" + createHmac("sha512", key).update(body).digest("hex");
}

describe("verifyAuthnetSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyAuthnetSignature(BODY, sign(BODY), KEY)).toBe(true);
  });
  it("is case-insensitive on the hex digest", () => {
    expect(verifyAuthnetSignature(BODY, sign(BODY).toUpperCase(), KEY)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyAuthnetSignature(BODY + "x", sign(BODY), KEY)).toBe(false);
  });
  it("rejects a signature made with the wrong key", () => {
    expect(verifyAuthnetSignature(BODY, sign(BODY, "wrong-key"), KEY)).toBe(false);
  });
  it("rejects an empty or malformed header", () => {
    expect(verifyAuthnetSignature(BODY, "", KEY)).toBe(false);
    expect(verifyAuthnetSignature(BODY, "sha512=abc", KEY)).toBe(false);
  });
});
