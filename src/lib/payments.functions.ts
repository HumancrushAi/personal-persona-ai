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

    const credits = pack ? pack.credits : tier!.monthlyCredits;
    const amount = (item.priceCents / 100).toFixed(2);

    const payload = {
      createTransactionRequest: {
        merchantAuthentication: { name: apiLoginId, transactionKey },
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
            invoiceNumber: `aur-${Date.now()}`,
            description: tier
              ? `${tier.name} subscription – ${tier.monthlyCredits} msgs`
              : `${pack!.name} pack – ${pack!.credits} messages`,
          },
        },
      },
    };

    const res = await fetch(AUTHNET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = (await res.text()).replace(/^\uFEFF/, "");
    let json: any;
    try { json = JSON.parse(raw); } catch { throw new Error("Bad payment response"); }

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
      .from("credit_balances")
      .select("paid_credits")
      .eq("user_id", userId)
      .maybeSingle();
    const newPaid = (bal?.paid_credits ?? 0) + credits;
    await supabase.from("credit_balances")
      .update({ paid_credits: newPaid })
      .eq("user_id", userId);

    if (tier) {
      const renews = new Date();
      renews.setMonth(renews.getMonth() + 1);
      await supabase.from("profiles")
        .update({ subscription_tier: tier.id, subscription_renews_at: renews.toISOString() })
        .eq("id", userId);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("transactions").insert({
      user_id: userId,
      amount_cents: item.priceCents,
      credits_added: credits,
      pack_name: tier ? `${tier.name} (subscription)` : pack!.name,
      authnet_transaction_id: transId,
      status: "completed",
    });

    return { success: true, transactionId: transId, newPaidBalance: newPaid, isSubscription: !!tier };
  });

export const confirmAge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("profiles")
      .update({ age_confirmed: true })
      .eq("id", userId);
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
