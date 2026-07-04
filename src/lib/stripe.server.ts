import Stripe from "stripe";
import { CREDIT_PACKS, SUBSCRIPTION_TIERS } from "./credit-packs";

// Server-only Stripe client. Never import this from client code.
let _stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  _stripe = new Stripe(key); // use SDK-pinned API version
  return _stripe;
}

// Optional env override: pin a specific Stripe Price id per pack/tier.
const PRICE_ENV: Record<string, string> = {
  starter: "STRIPE_PRICE_STARTER",
  lover: "STRIPE_PRICE_LOVER",
  devoted: "STRIPE_PRICE_DEVOTED",
  "sub-flirt": "STRIPE_PRICE_SUB_FLIRT",
  "sub-lover": "STRIPE_PRICE_SUB_LOVER",
  "sub-soulmate": "STRIPE_PRICE_SUB_SOULMATE",
};

// In-memory cache so we resolve/create each price once per server instance.
const priceCache: Record<string, string> = {};

function itemFor(internalId: string) {
  const pack = CREDIT_PACKS.find((p) => p.id === internalId);
  const tier = SUBSCRIPTION_TIERS.find((t) => t.id === internalId);
  if (pack) return { name: pack.name, priceCents: pack.priceCents, credits: pack.credits, recurring: false };
  if (tier) return { name: tier.name, priceCents: tier.priceCents, credits: tier.monthlyCredits, recurring: true };
  return null;
}

// Resolve the Stripe Price id for one of our packs/tiers. Order:
//   1. explicit env override (STRIPE_PRICE_*)
//   2. an existing Stripe Price with our lookup_key
//   3. auto-create the Product + Price from credit-packs.ts
// This makes the integration plug-and-play: set STRIPE_SECRET_KEY and the
// catalog provisions itself on first checkout — no dashboard setup needed.
export async function resolvePriceId(internalId: string): Promise<string> {
  const override = process.env[PRICE_ENV[internalId] ?? ""];
  if (override) return override;
  if (priceCache[internalId]) return priceCache[internalId];

  const item = itemFor(internalId);
  if (!item) throw new Error(`Unknown pack/tier: ${internalId}`);

  const stripe = getStripe();
  const lookupKey = `hc_${internalId}`;

  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (existing.data[0]) {
    priceCache[internalId] = existing.data[0].id;
    return existing.data[0].id;
  }

  const metadata = { internal_id: internalId, credits: String(item.credits) };
  const product = await stripe.products.create({ name: `HumanCrush ${item.name}`, metadata });
  try {
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: item.priceCents,
      lookup_key: lookupKey,
      ...(item.recurring ? { recurring: { interval: "month" as const } } : {}),
      metadata,
    });
    priceCache[internalId] = price.id;
    return price.id;
  } catch (err) {
    // Race: another request created the same lookup_key first — reuse it.
    const retry = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    if (retry.data[0]) {
      priceCache[internalId] = retry.data[0].id;
      return retry.data[0].id;
    }
    throw err;
  }
}
