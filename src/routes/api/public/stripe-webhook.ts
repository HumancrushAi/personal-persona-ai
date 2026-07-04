import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe.server";
import { SUBSCRIPTION_TIERS } from "@/lib/credit-packs";

// Stripe webhook receiver. Configure in Stripe → Developers → Webhooks with URL:
//   https://<your-domain>/api/public/stripe-webhook
// Subscribe to: checkout.session.completed, invoice.paid,
//   invoice.payment_failed, customer.subscription.updated,
//   customer.subscription.deleted
//
// Idempotency: each event id is claimed in public.stripe_events before work
// runs. A duplicate delivery returns 200 immediately; a processing failure
// releases the claim and returns 500 so Stripe retries.

function isoFromUnix(sec?: number | null): string | null {
  return sec ? new Date(sec * 1000).toISOString() : null;
}

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) return new Response("Not configured", { status: 500 });

        const sig = request.headers.get("stripe-signature") ?? "";
        const body = await request.text();

        let event: Stripe.Event;
        try {
          event = await getStripe().webhooks.constructEventAsync(body, sig, secret);
        } catch (err) {
          return new Response(`Invalid signature: ${err instanceof Error ? err.message : err}`, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as any; // new tables/functions not in generated types yet

        // ── Claim the event (idempotency gate) ──
        const { error: claimErr } = await admin
          .from("stripe_events")
          .insert({ id: event.id, type: event.type, payload: event });
        if (claimErr) {
          if (claimErr.code === "23505") return new Response("ok (dup)", { status: 200 });
          return new Response("claim failed", { status: 500 });
        }

        try {
          await handleEvent(event, admin);
          return new Response("ok", { status: 200 });
        } catch (err) {
          console.error("[stripe-webhook] processing error", err);
          // Release the claim so Stripe's retry can reprocess.
          await admin.from("stripe_events").delete().eq("id", event.id);
          return new Response("processing error", { status: 500 });
        }
      },
    },
  },
});

async function handleEvent(event: Stripe.Event, admin: any) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;
      if (!userId) return;

      if (session.mode === "payment") {
        // One-time token pack → grant credits + record payment (idempotent).
        const credits = Number(session.metadata?.credits ?? 0);
        const internalId = session.metadata?.internal_id ?? "pack";
        if (credits > 0) {
          await admin.rpc("grant_credits", {
            p_user: userId, p_amount: credits, p_reason: "purchase",
            p_ref_type: "checkout_session", p_ref_id: session.id,
          });
        }
        await admin.from("transactions").insert({
          user_id: userId,
          amount_cents: session.amount_total ?? 0,
          credits_added: credits,
          pack_name: internalId,
          provider: "stripe",
          stripe_session_id: session.id,
          stripe_payment_intent_id: (session.payment_intent as string) ?? null,
          status: "completed",
        });
      } else if (session.mode === "subscription") {
        // Link the subscription; credits are granted on invoice.paid.
        const subId = session.subscription as string;
        if (subId) await syncSubscription(subId, admin, userId);
      }
      return;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = (invoice as any).subscription as string | null;
      if (!subId) return;

      const sub = await getStripe().subscriptions.retrieve(subId);
      const userId = sub.metadata?.user_id;
      if (!userId) return;

      const internalId = sub.metadata?.internal_id ?? "";
      const tier = SUBSCRIPTION_TIERS.find((t) => t.id === internalId);
      const credits = Number(sub.metadata?.credits ?? tier?.monthlyCredits ?? 0);

      if (credits > 0) {
        await admin.rpc("grant_credits", {
          p_user: userId, p_amount: credits, p_reason: "subscription_grant",
          p_ref_type: "invoice", p_ref_id: invoice.id,
        });
      }
      await admin.from("transactions").insert({
        user_id: userId,
        amount_cents: invoice.amount_paid ?? 0,
        credits_added: credits,
        pack_name: `${tier?.name ?? internalId} (subscription)`,
        provider: "stripe",
        stripe_session_id: invoice.id, // reuse unique slot for idempotent history
        stripe_payment_intent_id: (invoice as any).payment_intent ?? null,
        status: "completed",
      });
      await syncSubscription(subId, admin, userId);
      await admin.from("subscription_events").insert({
        user_id: userId, event_type: "invoice.paid",
        amount_cents: invoice.amount_paid ?? 0, credits_granted: credits, raw_payload: event as any,
      });
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = (invoice as any).subscription as string | null;
      if (!subId) return;
      const sub = await getStripe().subscriptions.retrieve(subId);
      const userId = sub.metadata?.user_id;
      if (!userId) return;
      await admin.from("profiles").update({ subscription_status: "past_due" }).eq("id", userId);
      await admin.from("subscriptions").update({ status: "past_due" }).eq("stripe_subscription_id", subId);
      await admin.from("subscription_events").insert({
        user_id: userId, event_type: "invoice.payment_failed", raw_payload: event as any,
      });
      return;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.user_id;
      if (!userId) return;
      await syncSubscription(sub.id, admin, userId, sub);
      return;
    }
  }
}

// Upsert our normalized subscription row + mirror status onto the profile.
async function syncSubscription(
  subId: string,
  admin: any,
  userId: string,
  known?: Stripe.Subscription,
) {
  const sub = known ?? (await getStripe().subscriptions.retrieve(subId));
  const internalId = sub.metadata?.internal_id ?? "";
  const tier = SUBSCRIPTION_TIERS.find((t) => t.id === internalId);
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const periodEnd = isoFromUnix((sub as any).current_period_end);
  // "active" while active/trialing; otherwise mirror Stripe's status.
  const active = sub.status === "active" || sub.status === "trialing";

  await admin.from("subscriptions").upsert({
    user_id: userId,
    stripe_subscription_id: sub.id,
    stripe_customer_id: sub.customer as string,
    price_id: priceId,
    plan: internalId || null,
    status: sub.status,
    monthly_credits: tier?.monthlyCredits ?? null,
    current_period_end: periodEnd,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
  }, { onConflict: "stripe_subscription_id" });

  await admin.from("profiles").update({
    stripe_subscription_id: sub.id,
    subscription_id: sub.id,
    subscription_tier: internalId || null,
    subscription_status: active ? "active" : sub.status,
    subscription_renews_at: periodEnd,
  }).eq("id", userId);
}
