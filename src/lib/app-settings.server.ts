// Runtime reads for admin-managed app_settings, with a short in-memory cache
// so hot paths (every chat message) don't add a DB round-trip each call.

import { CREDIT_PACKS, type CreditPack } from "./credit-packs";

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

// The admin "Plans & Pricing" tab can override the first (standard) pack's
// price and credits; the other packs stay code-defined.
export async function getEffectivePacks(): Promise<CreditPack[]> {
  const [cents, credits] = await Promise.all([
    getAppSetting("price_pack_1_cents"),
    getAppSetting("price_pack_1_credits"),
  ]);
  const packs = CREDIT_PACKS.map((p) => ({ ...p }));
  if (packs[0]) {
    packs[0].priceCents = Math.round(settingNumber(cents, packs[0].priceCents));
    packs[0].credits = Math.round(settingNumber(credits, packs[0].credits));
    packs[0].perMsgCents = +(packs[0].priceCents / packs[0].credits).toFixed(1);
  }
  return packs;
}
