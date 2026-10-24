export type CreditPack = {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  perMsgCents: number;
  badge?: string;
};

export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", name: "Starter", credits: 50, priceCents: 500, perMsgCents: 10 },
  { id: "lover",   name: "Lover",   credits: 120, priceCents: 1000, perMsgCents: 8.3, badge: "Popular" },
  { id: "devoted", name: "Devoted", credits: 350, priceCents: 2500, perMsgCents: 7.1, badge: "Best value" },
];

export type SubscriptionTier = {
  id: string;
  name: string;
  tagline: string;
  monthlyCredits: number;
  priceCents: number;
  /** Number of months covered by one Authorize.Net recurring charge. */
  billingMonths?: number;
  perks: string[];
  badge?: string;
  /**
   * Still valid for existing subscribers (renewals, entitlement), but no
   * longer offered: hidden from every plan list.
   */
  legacy?: boolean;
};

// One-time charge today; we mark the tier on the user's profile and grant the credits.
// Renewal is manual on the user's part (re-purchase) until recurring billing is wired.
export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  {
    id: "sub-studio-starter",
    name: "Starter",
    tagline: "Try the creator studio",
    monthlyCredits: 80,
    priceCents: 600,
    billingMonths: 1,
    perks: [
      "80 creator credits / month",
      "Create 10 photos or 8 videos",
      "Social and 18+ modes (18+ needs age confirmation)",
      "1 model included, more for 50 credits each",
      "Unused credits roll over",
      "Cancel anytime"
    ],
  },
  {
    id: "sub-studio-starter-annual",
    name: "Starter",
    tagline: "Try the creator studio, billed yearly",
    monthlyCredits: 960,
    priceCents: 4800,
    billingMonths: 12,
    perks: [
      "960 creator credits / year",
      "Create 120 photos or 96 videos a year",
      "Social and 18+ modes (18+ needs age confirmation)",
      "1 model included, more for 50 credits each",
      "Unused credits roll over",
      "Cancel anytime"
    ],
  },
  {
    id: "sub-studio-creator",
    name: "Creator",
    tagline: "For regular posting",
    monthlyCredits: 350,
    priceCents: 2600,
    billingMonths: 1,
    perks: [
      "350 creator credits / month",
      "Create 43 photos or 35 videos",
      "Social and 18+ modes (18+ needs age confirmation)",
      "1 model included, more for 50 credits each",
      "Unused credits roll over",
      "Cancel anytime"
    ],
  },
  {
    id: "sub-studio-creator-annual",
    name: "Creator",
    tagline: "For regular posting, billed yearly",
    monthlyCredits: 4200,
    priceCents: 21000,
    billingMonths: 12,
    perks: [
      "4,200 creator credits / year",
      "Create 525 photos or 420 videos a year",
      "Social and 18+ modes (18+ needs age confirmation)",
      "1 model included, more for 50 credits each",
      "Unused credits roll over",
      "Cancel anytime"
    ],
  },
  {
    id: "sub-studio-pro",
    name: "Pro",
    tagline: "For daily content",
    monthlyCredits: 750,
    priceCents: 5300,
    billingMonths: 1,
    badge: "Popular",
    perks: [
      "750 creator credits / month",
      "Create 93 photos or 75 videos",
      "Social and 18+ modes (18+ needs age confirmation)",
      "1 model included, more for 50 credits each",
      "Unused credits roll over",
      "Cancel anytime"
    ],
  },
  {
    id: "sub-studio-pro-annual",
    name: "Pro",
    tagline: "For daily content, billed yearly",
    monthlyCredits: 9000,
    priceCents: 42600,
    billingMonths: 12,
    badge: "Popular",
    perks: [
      "9,000 creator credits / year",
      "Create 1,125 photos or 900 videos a year",
      "Social and 18+ modes (18+ needs age confirmation)",
      "1 model included, more for 50 credits each",
      "Unused credits roll over",
      "Cancel anytime"
    ],
  },
  {
    id: "sub-creator",
    legacy: true,
    name: "Creator",
    tagline: "Launch a consistent AI model",
    monthlyCredits: 800,
    priceCents: 7900,
    billingMonths: 1,
    badge: "Creator",
    perks: [
      "800 creator credits / month",
      "Unlocks the creator studio: Social and 18+ modes",
      "18+ also needs a one-time age confirmation",
      "Photo 8 credits, video 3 per second (10 minimum)",
      "1 model included, more for 50 credits each",
      "Credits also pay for chat (1 per message)",
      "Unused credits roll over; cancel any time",
    ],
  },
  {
    id: "sub-creator-annual",
    legacy: true,
    name: "Creator annual",
    tagline: "Save with yearly billing",
    monthlyCredits: 9600,
    priceCents: 69900,
    billingMonths: 12,
    badge: "Save 26%",
    perks: [
      "9,600 creator credits / year",
      "Unlocks the creator studio: Social and 18+ modes",
      "18+ also needs a one-time age confirmation",
      "Photo 8 credits, video 3 per second (10 minimum)",
      "1 model included, more for 50 credits each",
      "Credits also pay for chat (1 per message)",
      "Unused credits roll over; cancel any time",
    ],
  },
  {
    id: "sub-flirt",
    name: "Flirt",
    tagline: "Daily companionship",
    monthlyCredits: 800,
    priceCents: 1299,
    perks: [
      "800 messages / month",
      "All 25 companions unlocked",
      "All roleplay scenarios",
    ],
  },
  {
    id: "sub-lover",
    name: "Lover",
    tagline: "She's really yours now",
    monthlyCredits: 2500,
    priceCents: 2499,
    badge: "Most popular",
    perks: [
      "2,500 messages / month",
      "Unlimited roleplay scenarios",
      "Faster responses",
      "AI selfies & voice notes included",
    ],
  },
  {
    id: "sub-soulmate",
    name: "Soulmate",
    tagline: "Deep, unlimited intimacy",
    monthlyCredits: 8000,
    priceCents: 4999,
    badge: "VIP",
    perks: [
      "8,000 messages / month",
      "Priority generation",
      "Early access to new companions",
      "Premium voice & image quality",
    ],
  },
];

export function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function findPurchasable(id: string) {
  return CREDIT_PACKS.find(p => p.id === id) ?? SUBSCRIPTION_TIERS.find(t => t.id === id);
}
