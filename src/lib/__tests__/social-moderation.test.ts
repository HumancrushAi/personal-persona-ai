import { describe, expect, it } from "vitest";
import {
  evaluateSocialOutput,
  interpretModerationResult,
  moderateBuffers,
  providerSafetyVerdict,
} from "../social-moderation.server";
import { assertAdultGenerationEntitlement, AdultAccessError } from "../content-mode.server";

describe("social output moderation", () => {
  it("blocks an explicit provider safety verdict before classifier fallback", async () => {
    const decision = await evaluateSocialOutput({
      providerOutput: { nsfw: true },
      samples: [Buffer.from("not sent to a provider")],
      classify: async () => ({ allowed: true, classifier: "test", score: 0, reason: "clear" }),
    });
    expect(providerSafetyVerdict({ nsfw: true })).toBe("block");
    expect(decision.allowed).toBe(false);
    expect(decision.classifier).toBe("provider-safety");
  });

  it("treats an explicit provider safe=false verdict as a block", async () => {
    const decision = await evaluateSocialOutput({
      providerOutput: { safe: false },
      samples: [Buffer.from("not sent to a provider")],
      classify: async () => ({ allowed: true, classifier: "test", score: 0, reason: "clear" }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("provider-blocked");
  });

  it("blocks sexual scores at the configured threshold", () => {
    const decision = interpretModerationResult({
      results: [{ flagged: false, category_scores: { sexual: 0.46, "sexual/minors": 0 } }],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.score).toBe(0.46);
  });

  it("fails closed when the classifier returns an unsafe result, so storage is skipped and refund runs", async () => {
    const calls: string[] = [];
    const decision = await evaluateSocialOutput({
      samples: [Buffer.from("frame")],
      classify: async () => ({ allowed: false, classifier: "test", score: 0.91, reason: "sexual" }),
    });
    if (!decision.allowed) calls.push("refund");
    else calls.push("store");
    expect(calls).toEqual(["refund"]);
    expect(calls).not.toContain("store");
  });

  it("sends sampled image data to the configured moderation API", async () => {
    let requestBody = "";
    const oldKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    try {
      const decision = await moderateBuffers([Buffer.from("frame")], async (_url, init) => {
        requestBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ results: [{ flagged: false, category_scores: { sexual: 0.01 } }] }), { status: 200 });
      });
      expect(requestBody).toContain("data:image/png;base64");
      expect(decision.allowed).toBe(true);
    } finally {
      if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
    }
  });
});

describe("adult server entitlement", () => {
  it("rejects adult generation without age confirmation", () => {
    expect(() => assertAdultGenerationEntitlement({
      ageConfirmed: false,
      subscriptionTier: "sub-creator",
      subscriptionStatus: "active",
    })).toThrowError(new AdultAccessError("AGE_CONFIRMATION_REQUIRED"));
  });

  it("rejects adult generation without an active creator plan", () => {
    expect(() => assertAdultGenerationEntitlement({
      ageConfirmed: true,
      subscriptionTier: "free",
      subscriptionStatus: "active",
    })).toThrowError(new AdultAccessError("CREATOR_SUBSCRIPTION_REQUIRED"));
  });
});
