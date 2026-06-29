import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { CREDIT_PACKS } from "./credit-packs";

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
    if (!pack) throw new Error("Invalid pack");

    const apiLoginId = process.env.AUTHORIZE_NET_API_LOGIN_ID;
    const transactionKey = process.env.AUTHORIZE_NET_TRANSACTION_KEY;
    if (!apiLoginId || !transactionKey) throw new Error("Payment provider not configured");

    const amount = (pack.priceCents / 100).toFixed(2);

    const payload = {
      createTransactionRequest: {
        merchantAuthentication: {
          name: apiLoginId,
          transactionKey: transactionKey,
        },
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
            invoiceNumber: `cred-${Date.now()}`,
            description: `${pack.name} pack – ${pack.credits} messages`,
          },
        },
      },
    };

    const res = await fetch(AUTHNET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // Authorize.Net returns with a BOM prefix
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

    // credit user
    const { data: bal } = await supabase
      .from("credit_balances")
      .select("paid_credits")
      .eq("user_id", userId)
      .maybeSingle();
    const newPaid = (bal?.paid_credits ?? 0) + pack.credits;
    await supabase.from("credit_balances")
      .update({ paid_credits: newPaid })
      .eq("user_id", userId);

    // log via service role (authenticated user only has SELECT)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("transactions").insert({
      user_id: userId,
      amount_cents: pack.priceCents,
      credits_added: pack.credits,
      pack_name: pack.name,
      authnet_transaction_id: transId,
      status: "completed",
    });

    return { success: true, transactionId: transId, newPaidBalance: newPaid };
  });
