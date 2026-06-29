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
  perks: string[];
  badge?: string;
};

// One-time charge today; we mark the tier on the user's profile and grant the credits.
// Renewal is manual on the user's part (re-purchase) until recurring billing is wired.
export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
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
