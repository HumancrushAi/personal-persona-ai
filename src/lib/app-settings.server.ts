// Runtime reads for admin-managed app_settings, with a short in-memory cache
// so hot paths (every chat message) don't add a DB round-trip each call.

import {
  CREDIT_PACKS,
  SUBSCRIPTION_TIERS,
  type CreditPack,
  type SubscriptionTier,
} from "./credit-packs";

const TTL_MS = 60_000;
const cache = new Map<string, { value: unknown; expires: number }>();

export async function getAppSetting<T = unknown>(key: string): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T | null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  const value = data?.value ?? null;
  cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value as T | null;
}

// Settings are saved from text inputs, so values may arrive as strings.
export function settingNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// The setting keys the Plans & Pricing tab writes. One pair per pack and per
// tier, keyed by id, so the admin form and the reads here cannot disagree.
export const packPriceKey = (id: string) => `price_pack_${id}_cents`;
export const packCreditsKey = (id: string) => `price_pack_${id}_credits`;
export const tierPriceKey = (id: string) => `price_tier_${id}_cents`;
export const tierCreditsKey = (id: string) => `price_tier_${id}_credits`;

// The Plans & Pricing tab can override the price and credits of EVERY pack.
//
// It used to cover the first pack only, under keys "price_pack_1_*" that
// nothing else read, so the tab looked like a pricing page and changed one
// number. Those legacy keys still apply to the first pack so a value saved
// under them is not silently lost.
export async function getEffectivePacks(): Promise<CreditPack[]> {
  const packs = CREDIT_PACKS.map((p) => ({ ...p }));
  await Promise.all(
    packs.map(async (p, i) => {
      const [cents, credits, legacyCents, legacyCredits] = await Promise.all([
        getAppSetting(packPriceKey(p.id)),
        getAppSetting(packCreditsKey(p.id)),
        i === 0 ? getAppSetting("price_pack_1_cents") : null,
        i === 0 ? getAppSetting("price_pack_1_credits") : null,
      ]);
      p.priceCents = Math.round(settingNumber(cents ?? legacyCents, p.priceCents));
      p.credits = Math.round(settingNumber(credits ?? legacyCredits, p.credits));
      p.perMsgCents = +(p.priceCents / p.credits).toFixed(1);
    }),
  );
  return packs;
}

// Same for the subscription tiers. The charge, the credits granted on renewal
// and the pricing page all read this, so an admin change is the price.
export async function getEffectiveTiers(): Promise<SubscriptionTier[]> {
  const tiers = SUBSCRIPTION_TIERS.map((t) => ({ ...t, perks: [...t.perks] }));
  await Promise.all(
    tiers.map(async (t) => {
      const [cents, credits] = await Promise.all([
        getAppSetting(tierPriceKey(t.id)),
        getAppSetting(tierCreditsKey(t.id)),
      ]);
      t.priceCents = Math.round(settingNumber(cents, t.priceCents));
      t.monthlyCredits = Math.round(settingNumber(credits, t.monthlyCredits));
      // The first perk is the credit count spelled out, so it follows the number.
      if (t.perks[0] && /messages \/ month/.test(t.perks[0])) {
        t.perks[0] = `${t.monthlyCredits.toLocaleString()} messages / month`;
      }
    }),
  );
  return tiers;
}

/** The chat model the admin picked in AI Config, or null to use the env/default. */
export async function getChatModelOverride(): Promise<string | null> {
  const v = await getAppSetting("chat_model");
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}
