import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { CREDIT_PACKS, SUBSCRIPTION_TIERS } from "./credit-packs";
import { getStripe, stripePriceId } from "./stripe.server";

// Resolve the public origin for Stripe redirect URLs.
function appOrigin(): string {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, "");
  const req = getRequest();
  const proto = req?.headers.get("x-forwarded-proto") ?? "https";
  const host = req?.headers.get("host");
  if (host) return `${proto}://${host}`;
  return "http://localhost:8080";
}

// Ensure the user has a Stripe customer; persist the id on their profile.
async function ensureCustomer(
  supabase: any,
  userId: string,
  email?: string,
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle();
  if (profile?.stripe_customer_id) return profile.stripe_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    metadata: { user_id: userId },
  });
  await supabase.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", userId);
  return customer.id;
}

// ── Create a Stripe Checkout Session for a token pack or a subscription tier ──
export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ packId: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const email = (claims as any)?.email as string | undefined;

    const pack = CREDIT_PACKS.find((p) => p.id === data.packId);
    const tier = SUBSCRIPTION_TIERS.find((t) => t.id === data.packId);
    const item = pack ?? tier;
    if (!item) throw new Error("Invalid pack");

    const stripe = getStripe();
    const customerId = await ensureCustomer(supabase, userId, email);
    const origin = appOrigin();
    const credits = pack ? pack.credits : tier!.monthlyCredits;

    const session = await stripe.checkout.sessions.create({
      mode: tier ? "subscription" : "payment",
      customer: customerId,
      line_items: [{ price: stripePriceId(data.packId), quantity: 1 }],
      success_url: `${origin}/credits?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/credits?checkout=cancel`,
      allow_promotion_codes: true,
      // metadata is echoed back on the webhook event so we can credit the wallet.
      metadata: { user_id: userId, internal_id: data.packId, credits: String(credits) },
      ...(tier
        ? {
            subscription_data: {
              metadata: { user_id: userId, internal_id: data.packId, credits: String(credits) },
            },
          }
        : {
            payment_intent_data: {
              metadata: { user_id: userId, internal_id: data.packId, credits: String(credits) },
            },
          }),
    });

    if (!session.url) throw new Error("Could not start checkout");
    return { url: session.url };
  });

// ── Stripe Billing Portal: manage / cancel subscription, update card ──
export const createBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const db = context.supabase as any; // stripe_* columns not in generated types yet
    const { data: profile } = await db
      .from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle();
    if (!profile?.stripe_customer_id) throw new Error("No billing account yet");

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${appOrigin()}/credits`,
    });
    return { url: session.url };
  });

// ── Cancel at period end (keeps access until the paid period runs out) ──
export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const db = context.supabase as any; // stripe_* columns not in generated types yet
    const { data: profile } = await db
      .from("profiles").select("stripe_subscription_id").eq("id", userId).maybeSingle();
    const subId = profile?.stripe_subscription_id;
    if (!subId) throw new Error("No active subscription");

    const stripe = getStripe();
    await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
    // Webhook (customer.subscription.updated) will sync the flag to our DB.
    return { ok: true };
  });

// ── Unrelated helpers preserved from the previous payments module ──
export const confirmAge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("profiles")
      .update({ age_confirmed: true }).eq("id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const setScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    conversationId: z.string().uuid(),
    scenario: z.string().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("conversations")
      .update({ scenario: data.scenario })
      .eq("id", data.conversationId).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });
