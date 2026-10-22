/**
 * Creator pricing and render costs used by the creator UI.
 *
 * Authorize.Net remains the source of truth for the actual charge. `priceId`
 * values are intentionally nullable until the corresponding production
 * products are confirmed; the UI can still render the plan without inventing
 * a checkout identifier.
 */
export const creatorBilling = {
  yearlyDiscountLabel: "-33%",
  creditCosts: {
    image: 1,
    video: 10,
    adultMultiplier: 2,
  },
  legacyServerCosts: {
    image: 8,
    videoPerSecond: 3,
  },
} as const;

export type BillingPeriod = "monthly" | "yearly";
export type PlanId = "starter" | "creator" | "pro";

export type ProTier = {
  monthly: number;
  credits: number | null;
  priceId: Record<BillingPeriod, string | null>;
};

export type CreatorPlan = {
  id: PlanId;
  name: string;
  monthly: number | null;
  yearly: number | null;
  credits: number | null;
  adult: boolean;
  featured?: boolean;
  imagesAtOnce: number;
  videosAtOnce: number;
  features: readonly string[];
  footnote?: string;
  priceId: Record<BillingPeriod, string | null>;
  tiers?: readonly ProTier[];
};

export const creatorPlans: readonly CreatorPlan[] = [
  {
    id: "starter",
    name: "Starter",
    monthly: 9,
    yearly: null,
    credits: 80,
    adult: false,
    imagesAtOnce: 2,
    videosAtOnce: 1,
    features: ["Create 80 images or 8 videos", "Generate 2 images at a time", "Generate 1 video at a time", "Cancel anytime"],
    priceId: { monthly: null, yearly: null },
  },
  {
    id: "creator",
    name: "Creator",
    monthly: 39,
    yearly: null,
    credits: 350,
    adult: false,
    imagesAtOnce: 5,
    videosAtOnce: 3,
    features: ["Create 350 images or 35 videos", "Generate 5 images at a time", "Generate 3 videos at a time", "Priority support", "Cancel anytime"],
    priceId: { monthly: null, yearly: null },
  },
  {
    id: "pro",
    name: "Pro",
    monthly: null,
    yearly: null,
    credits: null,
    adult: true,
    featured: true,
    imagesAtOnce: 10,
    videosAtOnce: 5,
    features: ["18+ content available*", "Generate 10 images at a time", "Generate 5 videos at a time", "Dedicated 1-1 support", "Cancel anytime"],
    footnote: "*18+ content uses 2x credits.",
    priceId: { monthly: null, yearly: null },
    tiers: [
      { monthly: 79, credits: null, priceId: { monthly: null, yearly: null } },
      { monthly: 149, credits: 1500, priceId: { monthly: null, yearly: null } },
      { monthly: 249, credits: null, priceId: { monthly: null, yearly: null } },
      { monthly: 499, credits: null, priceId: { monthly: null, yearly: null } },
      { monthly: 999, credits: null, priceId: { monthly: null, yearly: null } },
    ],
  },
] as const;

export function formatCredits(value: number | null): string {
  return value === null ? "Credits to be confirmed" : `${value.toLocaleString()} credits/month`;
}

export function estimatedPlanMedia(plan: CreatorPlan, kind: "image" | "video"): number | null {
  if (plan.credits === null) return null;
  const cost = kind === "image" ? creatorBilling.creditCosts.image : creatorBilling.creditCosts.video;
  return Math.floor(plan.credits / cost);
}

export function formatPlanYearlyPrice(plan: CreatorPlan): string {
  return plan.yearly === null ? "Yearly price to be confirmed" : `$${plan.yearly}/year`;
}
