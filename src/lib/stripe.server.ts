import Stripe from "stripe";

// Server-only Stripe client. Never import this from client code.
let _stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  _stripe = new Stripe(key); // use SDK-pinned API version
  return _stripe;
}

// Map our internal pack / tier id -> the Stripe Price id, via env vars.
// Set these in Vercel / .env.local after creating the products in Stripe.
const PRICE_ENV: Record<string, string> = {
  starter: "STRIPE_PRICE_STARTER",
  lover: "STRIPE_PRICE_LOVER",
  devoted: "STRIPE_PRICE_DEVOTED",
  "sub-flirt": "STRIPE_PRICE_SUB_FLIRT",
  "sub-lover": "STRIPE_PRICE_SUB_LOVER",
  "sub-soulmate": "STRIPE_PRICE_SUB_SOULMATE",
};

export function stripePriceId(packOrTierId: string): string {
  const envName = PRICE_ENV[packOrTierId];
  const value = envName ? process.env[envName] : undefined;
  if (!value) throw new Error(`Missing Stripe price for "${packOrTierId}" (${envName})`);
  return value;
}

// Reverse lookup: Stripe Price id -> our internal id. Used by the webhook to
// resolve which pack/tier a completed payment corresponds to.
export function internalIdForPrice(priceId: string): string | undefined {
  for (const [internalId, envName] of Object.entries(PRICE_ENV)) {
    if (process.env[envName] === priceId) return internalId;
  }
  return undefined;
}
