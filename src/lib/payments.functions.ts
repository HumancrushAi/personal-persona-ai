import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { CREDIT_PACKS, SUBSCRIPTION_TIERS } from "./credit-packs";

const schema = z.object({
  packId: z.string(),
  opaqueDataDescriptor: z.string(),
  opaqueDataValue: z.string(),
});

const AUTHNET_URL = "https://api.authorize.net/xml/v1/request.api"; // LIVE

async function authnetCall(payload: any) {
  const res = await fetch(AUTHNET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = (await res.text()).replace(/^\uFEFF/, "");
  try { return JSON.parse(raw); } catch { throw new Error("Bad payment response"); }
}

export const purchaseCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const pack = CREDIT_PACKS.find(p => p.id === data.packId);
    const tier = SUBSCRIPTION_TIERS.find(t => t.id === data.packId);
    const item = pack ?? tier;
    if (!item) throw new Error("Invalid pack");

    const apiLoginId = process.env.AUTHORIZE_NET_API_LOGIN_ID;
    const transactionKey = process.env.AUTHORIZE_NET_TRANSACTION_KEY;
    if (!apiLoginId || !transactionKey) throw new Error("Payment provider not configured");

    const merchantAuthentication = { name: apiLoginId, transactionKey };
    const credits = pack ? pack.credits : tier!.monthlyCredits;
    const amount = (item.priceCents / 100).toFixed(2);

    // ── SUBSCRIPTION: create true recurring ARB subscription ──
    if (tier) {
      const startDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, first charge today
      const arbPayload = {
        ARBCreateSubscriptionRequest: {
          merchantAuthentication,
          subscription: {
            name: `HumanCrush ${tier.name}`,
            paymentSchedule: {
              interval: { length: 1, unit: "months" },
              startDate,
              totalOccurrences: 9999, // ongoing until cancelled
            },
            amount,
            payment: {
              opaqueData: {
                dataDescriptor: data.opaqueDataDescriptor,
                dataValue: data.opaqueDataValue,
              },
            },
            order: {
              invoiceNumber: `sub-${Date.now()}`.slice(0, 20),
              description: `${tier.name} – ${tier.monthlyCredits} msgs / mo`,
            },
            customer: { id: userId.slice(0, 20) },
          },
        },
      };
      const json = await authnetCall(arbPayload);
      const ok = json?.messages?.resultCode === "Ok" && json?.subscriptionId;
      if (!ok) {
        const err = json?.messages?.message?.[0]?.text || "Subscription declined";
        throw new Error(err);
      }
      const subscriptionId: string = json.subscriptionId;

      // Grant first month immediately
      const { data: bal } = await supabase
        .from("credit_balances").select("paid_credits").eq("user_id", userId).maybeSingle();
      const newPaid = (bal?.paid_credits ?? 0) + credits;
      await supabase.from("credit_balances").update({ paid_credits: newPaid }).eq("user_id", userId);

      const renews = new Date(); renews.setMonth(renews.getMonth() + 1);
      await supabase.from("profiles").update({
        subscription_tier: tier.id,
        subscription_renews_at: renews.toISOString(),
        authnet_subscription_id: subscriptionId,
        subscription_status: "active",
      }).eq("id", userId);

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("transactions").insert({
        user_id: userId,
        amount_cents: item.priceCents,
        credits_added: credits,
        pack_name: `${tier.name} (subscription)`,
        authnet_transaction_id: subscriptionId,
        status: "completed",
      });

      return { success: true, transactionId: subscriptionId, newPaidBalance: newPaid, isSubscription: true };
    }

    // ── ONE-TIME credit pack ──
    const payload = {
      createTransactionRequest: {
        merchantAuthentication,
        transactionRequest: {
          transactionType: "authCaptureTransaction",
          amount,
          payment: {
            opaqueData: {
              dataDescriptor: data.opaqueDataDescriptor,
              dataValue: data.opaqueDataValue,
            },
          },
          order: {
            invoiceNumber: `aur-${Date.now()}`.slice(0, 20),
            description: `${pack!.name} pack – ${pack!.credits} messages`,
          },
        },
      },
    };
    const json = await authnetCall(payload);
    const tr = json.transactionResponse;
    const ok = tr && tr.responseCode === "1";
    if (!ok) {
      const err = tr?.errors?.[0]?.errorText
        || json?.messages?.message?.[0]?.text
        || "Payment declined";
      throw new Error(err);
    }
    const transId: string = tr.transId;

    const { data: bal } = await supabase
      .from("credit_balances").select("paid_credits").eq("user_id", userId).maybeSingle();
    const newPaid = (bal?.paid_credits ?? 0) + credits;
    await supabase.from("credit_balances").update({ paid_credits: newPaid }).eq("user_id", userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("transactions").insert({
      user_id: userId,
      amount_cents: item.priceCents,
      credits_added: credits,
      pack_name: pack!.name,
      authnet_transaction_id: transId,
      status: "completed",
    });

    return { success: true, transactionId: transId, newPaidBalance: newPaid, isSubscription: false };
  });

export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const apiLoginId = process.env.AUTHORIZE_NET_API_LOGIN_ID;
    const transactionKey = process.env.AUTHORIZE_NET_TRANSACTION_KEY;
    if (!apiLoginId || !transactionKey) throw new Error("Payment provider not configured");

    const { data: profile } = await supabase.from("profiles")
      .select("authnet_subscription_id").eq("id", userId).maybeSingle();
    const subId = profile?.authnet_subscription_id;
    if (!subId) throw new Error("No active subscription");

    const json = await authnetCall({
      ARBCancelSubscriptionRequest: {
        merchantAuthentication: { name: apiLoginId, transactionKey },
        subscriptionId: subId,
      },
    });
    const ok = json?.messages?.resultCode === "Ok";
    if (!ok) throw new Error(json?.messages?.message?.[0]?.text || "Cancel failed");

    await supabase.from("profiles").update({
      subscription_status: "cancelled",
    }).eq("id", userId);

    return { ok: true };
  });

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
