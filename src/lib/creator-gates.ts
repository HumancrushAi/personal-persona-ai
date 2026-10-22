export type CreatorIntent = "select_adult" | "generate";

export type CreatorGateUser = {
  signedIn: boolean;
  isAdmin?: boolean;
  ageConfirmed?: boolean;
  hasAdultPlan?: boolean;
  hasActivePlan?: boolean;
  credits: number | null;
};

export type CreatorGate =
  | { kind: "allow" }
  | { kind: "auth"; reason: "sign_in_required" }
  | { kind: "age"; reason: "age_confirmation_required" }
  | { kind: "plan"; reason: "adult_plan_required" | "active_plan_required" | "insufficient_credits"; plan: "pro" | "creator" | "topup" };

/** UX-only gate. Every server function still performs its own authorization. */
export function getNextGate(user: CreatorGateUser, intent: CreatorIntent, cost = 0): CreatorGate {
  if (!user.signedIn) return { kind: "auth", reason: "sign_in_required" };
  if (user.isAdmin) return { kind: "allow" };

  if (intent === "select_adult") {
    if (!user.ageConfirmed) return { kind: "age", reason: "age_confirmation_required" };
    if (!user.hasAdultPlan) return { kind: "plan", reason: "adult_plan_required", plan: "pro" };
    return { kind: "allow" };
  }

  if (!user.hasActivePlan) return { kind: "plan", reason: "active_plan_required", plan: "creator" };
  if (user.credits !== null && user.credits < cost) return { kind: "plan", reason: "insufficient_credits", plan: "topup" };
  return { kind: "allow" };
}

