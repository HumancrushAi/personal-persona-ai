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
  { id: "lover",   name: "Lover",   credits: 120, priceCents: 1000, perMsgCents: 8.3, badge: "Most popular" },
  { id: "devoted", name: "Devoted", credits: 350, priceCents: 2500, perMsgCents: 7.1, badge: "Best value" },
];

export function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
