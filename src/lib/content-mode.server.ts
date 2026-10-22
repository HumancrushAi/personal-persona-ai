export type ContentMode = "social" | "adult";

export type AdultEntitlementState = {
  isAdmin?: boolean | null;
  ageConfirmed?: boolean | null;
  subscriptionTier?: string | null;
  subscriptionStatus?: string | null;
};

export const ADULT_CREATOR_TIERS = ["sub-creator", "sub-creator-annual"] as const;

export class AdultAccessError extends Error {
  constructor(code: "AGE_CONFIRMATION_REQUIRED" | "CREATOR_SUBSCRIPTION_REQUIRED") {
    super(code);
    this.name = "AdultAccessError";
  }
}

export class CreatorPlanAccessError extends Error {
  constructor() {
    super("CREATOR_SUBSCRIPTION_REQUIRED");
    this.name = "CreatorPlanAccessError";
  }
}

/** A Creator render must always be backed by an active Creator entitlement. */
export function assertCreatorGenerationEntitlement(state: AdultEntitlementState): void {
  if (state.isAdmin) return;
  if (
    state.subscriptionStatus !== "active" ||
    !ADULT_CREATOR_TIERS.includes(state.subscriptionTier as (typeof ADULT_CREATOR_TIERS)[number])
  ) {
    throw new CreatorPlanAccessError();
  }
}

/**
 * The client may request a mode, but it cannot grant itself adult access.
 * Admins are the only intentional bypass (the existing admin entitlement).
 */
export function assertAdultGenerationEntitlement(state: AdultEntitlementState): void {
  if (state.isAdmin) return;
  if (!state.ageConfirmed) throw new AdultAccessError("AGE_CONFIRMATION_REQUIRED");
  if (
    state.subscriptionStatus !== "active" ||
    !ADULT_CREATOR_TIERS.includes(state.subscriptionTier as (typeof ADULT_CREATOR_TIERS)[number])
  ) {
    throw new AdultAccessError("CREATOR_SUBSCRIPTION_REQUIRED");
  }
}

/** Fetch the authoritative entitlement state on the server before provider I/O. */
export async function assertAdultGenerationForUser(supabase: any, userId: string): Promise<void> {
  const { data: admin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (admin) return;
  const { data: profile } = await supabase
    .from("profiles")
    .select("age_confirmed,subscription_tier,subscription_status")
    .eq("id", userId)
    .maybeSingle();
  assertAdultGenerationEntitlement({
    isAdmin: false,
    ageConfirmed: profile?.age_confirmed,
    subscriptionTier: profile?.subscription_tier,
    subscriptionStatus: profile?.subscription_status,
  });
}

/**
 * Resolve the effective mode on the server. The boolean sent by a browser is
 * only a request; it never grants adult access. Social is the safe default and
 * adult is returned only after the authoritative profile/role check succeeds.
 */
export async function resolveContentModeForUser(
  supabase: any,
  userId: string,
  requestedAdult: boolean | null | undefined,
): Promise<ContentMode> {
  if (!requestedAdult) return "social";
  await assertAdultGenerationForUser(supabase, userId);
  return "adult";
}

/**
 * Standalone Creator is a paid render workspace. Enforce its subscription
 * boundary on the server before a balance can be debited or a provider job can
 * be submitted. Adult mode adds age confirmation on top of that entitlement.
 */
export async function resolveCreatorContentModeForUser(
  supabase: any,
  userId: string,
  requestedAdult: boolean | null | undefined,
): Promise<ContentMode> {
  const [{ data: admin }, { data: profile }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase
      .from("profiles")
      .select("age_confirmed,subscription_tier,subscription_status")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  const state: AdultEntitlementState = {
    isAdmin: Boolean(admin),
    ageConfirmed: profile?.age_confirmed,
    subscriptionTier: profile?.subscription_tier,
    subscriptionStatus: profile?.subscription_status,
  };
  assertCreatorGenerationEntitlement(state);
  if (requestedAdult) assertAdultGenerationEntitlement(state);
  return requestedAdult ? "adult" : "social";
}
