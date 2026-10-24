import { SUBSCRIPTION_TIERS, type SubscriptionTier } from "@/lib/credit-packs";

/**
 * The creator screen must use the same costs as standalone-media.functions.
 * These are not marketing estimates: they are the debit amounts enforced by
 * the server (1 credit per photo, 10 credits minimum plus 3 per video second).
 */
export const creatorBilling = {
  yearlyDiscountLabel: "Save 26%",
  creditCosts: {
    image: 1,
    video: 10,
    videoPerSecond: 3,
    /** Every model after the first free one (standalone-media.functions). */
    modelUnlock: 50,
  },
} as const;

export type BillingPeriod = "monthly" | "yearly";

export type CreatorPlan = {
  /** Stable UI key; for checkout always use tierId. */
  id: string;
  tierId: string;
  name: string;
  billingMonths: number;
  period: BillingPeriod;
  priceCents: number;
  credits: number;
  adult: boolean;
  featured?: boolean;
  features: readonly string[];
};

/**
 * Build creator cards from the live server pricing response. Keeping this
 * mapping in one place prevents the creator page from advertising plans that
 * Authorize.Net cannot actually purchase.
 */
export function creatorPlansFromTiers(tiers: readonly SubscriptionTier[]): readonly CreatorPlan[] {
  return tiers
    .filter((tier) => tier.id.startsWith("sub-studio-") && !tier.legacy)
    .map((tier) => ({
      id: tier.id.replace(/^sub-/, ""),
      tierId: tier.id,
      name: tier.name,
      billingMonths: tier.billingMonths ?? 1,
      period: tier.billingMonths === 12 ? "yearly" : "monthly",
      priceCents: tier.priceCents,
      credits: tier.monthlyCredits,
      adult: true,
      featured: tier.id.startsWith("sub-studio-pro"),
      features: tier.perks,
    }));
}

// Synchronous fallback for the first paint/offline preview. The route replaces
// this with getPricing() as soon as the server responds.
export const creatorPlans: readonly CreatorPlan[] = creatorPlansFromTiers(SUBSCRIPTION_TIERS);

export function formatCredits(value: number | null): string {
  return value === null ? "Credits to be confirmed" : `${value.toLocaleString()} credits`;
}

export function estimatedPlanMedia(plan: CreatorPlan, kind: "image" | "video"): number {
  const cost = kind === "image" ? creatorBilling.creditCosts.image : creatorBilling.creditCosts.video;
  return Math.floor(plan.credits / cost);
}

/** "Save 26%", worked out from the live monthly and yearly prices, or null. */
export function yearlySavingsLabel(plans: readonly CreatorPlan[]): string | null {
  const monthly = plans.find((plan) => plan.period === "monthly");
  const yearly = plans.find((plan) => plan.period === "yearly");
  if (!monthly || !yearly || monthly.priceCents <= 0) return null;
  const percent = Math.round((1 - yearly.priceCents / (monthly.priceCents * yearly.billingMonths)) * 100);
  return percent > 0 ? `Save ${percent}%` : null;
}

export function formatPlanPrice(plan: CreatorPlan): string {
  return `$${(plan.priceCents / 100).toFixed(plan.priceCents % 100 === 0 ? 0 : 2)}`;
}
