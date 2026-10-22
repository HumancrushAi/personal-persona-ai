import { describe, expect, it } from "vitest";
import { getNextGate, type CreatorGateUser } from "../creator-gates";

const signedOut: CreatorGateUser = { signedIn: false, credits: null };
const signedIn: CreatorGateUser = { signedIn: true, hasActivePlan: true, hasAdultPlan: true, ageConfirmed: true, credits: 20 };

describe("getNextGate", () => {
  it("requires auth before either intent", () => {
    expect(getNextGate(signedOut, "select_adult").kind).toBe("auth");
    expect(getNextGate(signedOut, "generate", 1).kind).toBe("auth");
  });

  it("requires age before adult plan", () => {
    expect(getNextGate({ ...signedIn, ageConfirmed: false }, "select_adult")).toEqual({ kind: "age", reason: "age_confirmation_required" });
  });

  it("requires Pro for adult mode", () => {
    expect(getNextGate({ ...signedIn, hasAdultPlan: false }, "select_adult")).toEqual({ kind: "plan", reason: "adult_plan_required", plan: "pro" });
  });

  it("requires an active plan and enough credits to generate", () => {
    expect(getNextGate({ ...signedIn, hasActivePlan: false }, "generate", 5)).toEqual({ kind: "plan", reason: "active_plan_required", plan: "creator" });
    expect(getNextGate({ ...signedIn, credits: 4 }, "generate", 5)).toEqual({ kind: "plan", reason: "insufficient_credits", plan: "topup" });
  });

  it("allows a paid user when the balance is sufficient", () => {
    expect(getNextGate(signedIn, "generate", 20)).toEqual({ kind: "allow" });
  });

  it("allows admins without a subscription", () => {
    expect(getNextGate({ signedIn: true, isAdmin: true, credits: 0 }, "select_adult")).toEqual({ kind: "allow" });
    expect(getNextGate({ signedIn: true, isAdmin: true, credits: 0 }, "generate", 500)).toEqual({ kind: "allow" });
  });
});
