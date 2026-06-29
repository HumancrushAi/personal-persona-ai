import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { SUBSCRIPTION_TIERS } from "@/lib/credit-packs";

// Authorize.Net webhook receiver for recurring billing events.
// Configure in Authorize.Net → Account → Webhooks with URL:
//   https://<your-domain>/api/public/authnet-webhook
// Subscribe to events: net.authorize.customer.subscription.*,
//                      net.authorize.payment.authcapture.created

export const Route = createFileRoute("/api/public/authnet-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signatureKey = process.env.AUTHORIZE_NET_SIGNATURE_KEY;
        if (!signatureKey) return new Response("Not configured", { status: 500 });

        const sigHeader = request.headers.get("x-anet-signature") ?? "";
        const body = await request.text();

        // Header format: "sha512=HEXDIGEST"
        const provided = sigHeader.replace(/^sha512=/i, "").trim().toUpperCase();
        const expected = createHmac("sha512", signatureKey).update(body).digest("hex").toUpperCase();

        if (provided.length !== expected.length ||
            !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
          return new Response("Invalid signature", { status: 401 });
        }

        let event: any;
        try { event = JSON.parse(body); } catch { return new Response("Bad JSON", { status: 400 }); }

        const eventType: string = event.eventType ?? "";
        const payload = event.payload ?? {};
        const subscriptionId: string | undefined =
          payload.subscription?.id ?? payload.id ?? undefined;
        const transactionId: string | undefined = payload.id;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Find which user owns this subscription
        let userId: string | null = null;
        let tierId: string | null = null;
        if (subscriptionId) {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("id, subscription_tier")
            .eq("authnet_subscription_id", subscriptionId)
            .maybeSingle();
          if (profile) { userId = profile.id; tierId = profile.subscription_tier; }
        }

        // Recurring payment succeeded → grant monthly credits
        if (eventType.includes("payment.authcapture.created") && userId && tierId) {
          const tier = SUBSCRIPTION_TIERS.find(t => t.id === tierId);
          if (tier) {
            // Skip the first charge (already granted at purchase) by checking
            // for an existing transaction with this id.
            const { data: existing } = await supabaseAdmin
              .from("transactions").select("id")
              .eq("authnet_transaction_id", transactionId ?? "")
              .maybeSingle();

            if (!existing) {
              const { data: bal } = await supabaseAdmin
                .from("credit_balances").select("paid_credits")
                .eq("user_id", userId).maybeSingle();
              const newPaid = (bal?.paid_credits ?? 0) + tier.monthlyCredits;
              await supabaseAdmin.from("credit_balances")
                .update({ paid_credits: newPaid }).eq("user_id", userId);

              const renews = new Date(); renews.setMonth(renews.getMonth() + 1);
              await supabaseAdmin.from("profiles").update({
                subscription_renews_at: renews.toISOString(),
                subscription_status: "active",
              }).eq("id", userId);

              await supabaseAdmin.from("transactions").insert({
                user_id: userId,
                amount_cents: tier.priceCents,
                credits_added: tier.monthlyCredits,
                pack_name: `${tier.name} (recurring)`,
                authnet_transaction_id: transactionId ?? subscriptionId,
                status: "completed",
              });
            }
          }
        }

        // Subscription cancelled / expired / suspended
        if (eventType.includes("subscription.cancelled") ||
            eventType.includes("subscription.expired") ||
            eventType.includes("subscription.suspended") ||
            eventType.includes("subscription.terminated")) {
          if (userId) {
            await supabaseAdmin.from("profiles").update({
              subscription_status: "cancelled",
            }).eq("id", userId);
          }
        }

        await supabaseAdmin.from("subscription_events").insert({
          user_id: userId,
          authnet_subscription_id: subscriptionId,
          authnet_transaction_id: transactionId,
          event_type: eventType,
          raw_payload: event,
        });

        return new Response("ok", { status: 200 });
      },
    },
  },
});
