import { createFileRoute } from "@tanstack/react-router";
import { verifyAuthnetSignature } from "@/lib/authnet-signature";
import { isFullRefund, webhookAction } from "@/lib/authnet";

// Authorize.Net webhook receiver.
//
// Configure in Authorize.Net → Account → Webhooks with URL:
//   https://<your-domain>/api/public/authnet-webhook
// Subscribe to:
//   net.authorize.payment.authcapture.created   recurring subscription charges
//   net.authorize.payment.refund.created        refunds
//   net.authorize.payment.void.created          voids
//   net.authorize.customer.subscription.*       cancellations
// AND enable Account → Settings → Security Settings → Transaction Details API.
// Every payment event below makes a getTransactionDetails call, and without
// that setting the lookup is refused and the event is logged but not applied.
//
// Why the lookup exists. A payment notification carries a transaction id and
// nothing else — no subscription id, and no original charge for a refund. This
// handler used to find the subscriber with `payload.subscription?.id ??
// payload.id`. There is no payload.subscription, so that fell back to the
// TRANSACTION id and compared it with profiles.authnet_subscription_id, which is
// a different id and never matches. Every recurring charge was dropped: the
// subscriber was billed and got no monthly credits, no transactions row was
// written, and an affiliate who referred them was paid nothing on it.
// Authorize.Net's recurring-billing guide names getTransactionDetails — which
// returns `subscription.id` and `payNum` — as the way to make this link.
//
// Every event, applied or not, lands in subscription_events with a note saying
// what happened to it. When money looks wrong, that table is the answer.

type LogFields = {
  userId?: string | null;
  transId?: string;
  subscriptionId?: string;
  amountCents?: number;
  credits?: number;
  note: string;
};
type Log = (fields: LogFields) => Promise<void>;

export const Route = createFileRoute("/api/public/authnet-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signatureKey = process.env.AUTHORIZE_NET_SIGNATURE_KEY;
        if (!signatureKey) return new Response("Not configured", { status: 500 });

        const sigHeader = request.headers.get("x-anet-signature") ?? "";
        const body = await request.text();

        if (!verifyAuthnetSignature(body, sigHeader, signatureKey)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let event: any;
        try {
          event = JSON.parse(body);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const eventType: string = event.eventType ?? "";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db: any = supabaseAdmin;

        const log: Log = async (f) => {
          await db.from("subscription_events").insert({
            user_id: f.userId ?? null,
            authnet_subscription_id: f.subscriptionId ?? null,
            authnet_transaction_id:
              f.transId ?? (event.payload?.id ? String(event.payload.id) : null),
            event_type: eventType,
            amount_cents: f.amountCents ?? null,
            credits_granted: f.credits ?? null,
            // The event exactly as received, plus what this handler did with it.
            raw_payload: { ...event, _app: { note: f.note } },
          });
        };

        try {
          const action = webhookAction(eventType);
          if (action === "charge") await onCharge(db, event, log);
          else if (action === "refund" || action === "void")
            await onReversal(db, event, action, log);
          else if (action === "cancel") await onCancel(db, event, log);
          else await log({ note: "not an event this handler acts on" });
        } catch (e: any) {
          // Only a failure to REACH Authorize.Net gets here — database calls
          // return their errors rather than throwing. A 500 makes the gateway
          // retry, and that is safe: every write below checks before it writes.
          await log({ note: `failed, asking for a retry: ${e?.message ?? e}` }).catch(() => {});
          return new Response("retry", { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});

async function onCharge(db: any, event: any, log: Log): Promise<void> {
  const transId = event.payload?.id ? String(event.payload.id) : "";
  if (!transId) return log({ note: "charge with no transaction id" });

  // Already recorded under this transaction id: a repeat delivery, or a
  // one-time credit pack that purchaseCredits wrote before this arrived.
  const { data: seen } = await db
    .from("transactions")
    .select("id")
    .eq("authnet_transaction_id", transId)
    .maybeSingle();
  if (seen) return log({ transId, note: "already recorded" });

  const { getTransactionDetails } = await import("@/lib/authnet.server");
  const tx = await getTransactionDetails(transId);
  if (!tx.ok) return log({ transId, note: `lookup refused, not applied: ${tx.error}` });

  // A one-time credit pack fires this same event. purchaseCredits records
  // those itself, synchronously, so a charge with no subscription is not this
  // handler's to write — even when it arrives before purchaseCredits has.
  if (!tx.subscriptionId) return log({ transId, note: "not a subscription charge" });

  const { data: profile } = await db
    .from("profiles")
    .select("id, subscription_tier")
    .eq("authnet_subscription_id", tx.subscriptionId)
    .maybeSingle();
  if (!profile) {
    return log({
      transId,
      subscriptionId: tx.subscriptionId,
      note: "no account holds this subscription",
    });
  }

  const { getEffectiveTiers } = await import("@/lib/app-settings.server");
  const tier = (await getEffectiveTiers()).find((t) => t.id === profile.subscription_tier);
  // What was actually charged, not today's price list. A later price change
  // must not restate an old subscription's revenue, and this is the figure the
  // affiliate's commission is calculated on.
  const amountCents = tx.authCents && tx.authCents > 0 ? tx.authCents : (tier?.priceCents ?? 0);

  // The first payment. purchaseCredits granted the first month's credits at
  // signup and wrote a 'pending' row keyed by the SUBSCRIPTION id, because
  // Authorize.Net does not charge a subscription that starts today until after
  // 2 a.m. the next day. Promote that row: the money is real now, the commission
  // trigger fires on the status change, and the credits are not granted twice.
  //
  // payNum decides, not whether such a row exists. Subscribers from before this
  // change still have a row keyed by their subscription id — their first charge
  // never matched — so using the row as the signal would treat their fifth
  // payment as their first and withhold that month's credits.
  if (tx.payNum === 1) {
    const { data: promoted } = await db
      .from("transactions")
      .update({ status: "completed", authnet_transaction_id: transId, amount_cents: amountCents })
      .eq("user_id", profile.id)
      .eq("authnet_transaction_id", tx.subscriptionId)
      .select("id");

    if (!promoted?.length) {
      // No signup row to promote. Credits were still granted at signup, so
      // this records the revenue and grants nothing.
      await db.from("transactions").insert({
        user_id: profile.id,
        amount_cents: amountCents,
        credits_added: 0,
        pack_name: `${tier?.name ?? "Subscription"} (subscription)`,
        authnet_transaction_id: transId,
        status: "completed",
      });
    }
    return log({
      userId: profile.id,
      transId,
      subscriptionId: tx.subscriptionId,
      amountCents,
      note: promoted?.length
        ? "first payment settled"
        : "first payment recorded (no signup row found)",
    });
  }

  if (!tier) {
    return log({
      userId: profile.id,
      transId,
      subscriptionId: tx.subscriptionId,
      amountCents,
      note: `payment ${tx.payNum ?? "?"} for unknown tier "${profile.subscription_tier}", no credits granted`,
    });
  }

  const { data: bal } = await db
    .from("credit_balances")
    .select("free_messages_remaining, paid_credits")
    .eq("user_id", profile.id)
    .maybeSingle();
  const newPaid = (bal?.paid_credits ?? 0) + tier.monthlyCredits;
  await db.from("credit_balances").upsert(
    {
      user_id: profile.id,
      paid_credits: newPaid,
      free_messages_remaining: bal?.free_messages_remaining ?? 25,
    },
    { onConflict: "user_id" },
  );
  await db.from("credit_ledger").insert({
    user_id: profile.id,
    delta: tier.monthlyCredits,
    reason: "subscription_credit",
    balance_after: (bal?.free_messages_remaining ?? 25) + newPaid,
    idempotency_key: `authnet-webhook-${transId}`,
  });

  const renews = new Date();
  renews.setMonth(renews.getMonth() + 1);
  await db
    .from("profiles")
    .update({ subscription_renews_at: renews.toISOString(), subscription_status: "active" })
    .eq("id", profile.id);

  await db.from("transactions").insert({
    user_id: profile.id,
    amount_cents: amountCents,
    credits_added: tier.monthlyCredits,
    pack_name: `${tier.name} (recurring)`,
    authnet_transaction_id: transId,
    status: "completed",
  });

  return log({
    userId: profile.id,
    transId,
    subscriptionId: tx.subscriptionId,
    amountCents,
    credits: tier.monthlyCredits,
    note: `recurring payment ${tx.payNum ?? "?"}`,
  });
}

async function onReversal(db: any, event: any, kind: "refund" | "void", log: Log): Promise<void> {
  const transId = event.payload?.id ? String(event.payload.id) : "";
  if (!transId) return log({ note: `${kind} with no transaction id` });

  const { getTransactionDetails } = await import("@/lib/authnet.server");
  const tx = await getTransactionDetails(transId);
  if (!tx.ok) return log({ transId, note: `lookup refused, not applied: ${tx.error}` });

  // A refund is a transaction of its own that points at the charge through
  // refTransId. A void acts on the charge itself, so it has no refTransId and
  // its own id IS the charge.
  const originalId = tx.refTransId ?? tx.transId ?? transId;
  const { data: sale } = await db
    .from("transactions")
    .select("id, user_id, amount_cents, status")
    .eq("authnet_transaction_id", originalId)
    .maybeSingle();
  if (!sale) return log({ transId, note: `${kind} of ${originalId}: no matching sale on record` });
  if (sale.status === "refunded" || sale.status === "voided") {
    return log({
      userId: sale.user_id,
      transId,
      note: `${kind} of ${originalId}: already reversed`,
    });
  }

  const refundCents = tx.authCents || tx.settleCents || 0;
  if (kind === "refund" && !isFullRefund(refundCents, sale.amount_cents)) {
    return log({
      userId: sale.user_id,
      transId,
      amountCents: refundCents,
      note: `partial refund of ${originalId} (${refundCents} of ${sale.amount_cents} cents): sale and commission left as they are`,
    });
  }

  // The status change is the whole action. The commission trigger on
  // transactions sees it and voids any unpaid commission for this sale.
  await db
    .from("transactions")
    .update({ status: kind === "void" ? "voided" : "refunded" })
    .eq("id", sale.id);

  return log({
    userId: sale.user_id,
    transId,
    amountCents: refundCents || sale.amount_cents,
    note: `${kind} of ${originalId}: sale reversed`,
  });
}

async function onCancel(db: any, event: any, log: Log): Promise<void> {
  // Subscription events, unlike payment events, do carry the subscription id.
  const payload = event.payload ?? {};
  const subscriptionId = payload.subscription?.id ?? payload.id;
  if (!subscriptionId) return log({ note: "cancellation with no subscription id" });

  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("authnet_subscription_id", String(subscriptionId))
    .maybeSingle();
  if (!profile) {
    return log({
      subscriptionId: String(subscriptionId),
      note: "no account holds this subscription",
    });
  }

  await db.from("profiles").update({ subscription_status: "cancelled" }).eq("id", profile.id);
  return log({
    userId: profile.id,
    subscriptionId: String(subscriptionId),
    note: "subscription ended",
  });
}
