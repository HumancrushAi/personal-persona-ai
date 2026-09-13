// Pure parsers for Authorize.Net API responses — no network, safe to unit test.

export type ChargeResult = { ok: boolean; transId?: string; error?: string };
export type SubscriptionResult = { ok: boolean; subscriptionId?: string; error?: string };

// createTransactionRequest (one-time authCapture) response.
export function transactionResult(json: any): ChargeResult {
  const tr = json?.transactionResponse;
  if (tr && tr.responseCode === "1") {
    return { ok: true, transId: tr.transId };
  }
  const error =
    tr?.errors?.[0]?.errorText || json?.messages?.message?.[0]?.text || "Payment declined";
  return { ok: false, error };
}

// ARBCreateSubscriptionRequest response.
export function subscriptionResult(json: any): SubscriptionResult {
  if (json?.messages?.resultCode === "Ok" && json?.subscriptionId) {
    return { ok: true, subscriptionId: json.subscriptionId };
  }
  const error = json?.messages?.message?.[0]?.text || "Subscription declined";
  return { ok: false, error };
}

export type TransactionDetails = {
  ok: boolean;
  transId?: string;
  /** Set on a refund: the charge it gives money back from. */
  refTransId?: string;
  status?: string;
  /** Set on a recurring (ARB) charge: the subscription it was billed for. */
  subscriptionId?: string;
  /** Which payment of that subscription this is. The first is 1. */
  payNum?: number;
  authCents?: number;
  settleCents?: number;
  error?: string;
};

// A zero is how an absent id tends to come back, and treating "0" as a real
// transaction would match nothing — or worse, match a row keyed "0".
const idOf = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s && s !== "0" ? s : undefined;
};

// Amounts are decimal dollars ("12.99"). Rounded, because 12.99 * 100 is
// 1298.9999999999998 in floating point and truncating it loses a cent.
const centsOf = (v: unknown): number | undefined => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n)
    ? Math.round(n * 100)
    : undefined;
};

// getTransactionDetailsRequest response. Field names are verbatim from
// transactionDetailsType and subscriptionPaymentType in AnetApiSchema.xsd —
// note refTransId, not refTransID.
export function transactionDetailsResult(json: any): TransactionDetails {
  const t = json?.transaction;
  if (json?.messages?.resultCode === "Ok" && idOf(t?.transId)) {
    const sub = t.subscription;
    const payNum = Number(sub?.payNum);
    return {
      ok: true,
      transId: idOf(t.transId),
      refTransId: idOf(t.refTransId),
      status: typeof t.transactionStatus === "string" ? t.transactionStatus : undefined,
      subscriptionId: idOf(sub?.id),
      payNum: Number.isInteger(payNum) && payNum > 0 ? payNum : undefined,
      authCents: centsOf(t.authAmount),
      settleCents: centsOf(t.settleAmount),
    };
  }
  const error = json?.messages?.message?.[0]?.text || "Transaction lookup failed";
  return { ok: false, error };
}

export type WebhookAction = "charge" | "refund" | "void" | "cancel" | "ignore";

// Exact names, not substring matches. The old handler tested includes(), and
// "payment.authcapture.created" is also a substring a future event name could
// contain — this decides whether money is recorded, so near enough is not.
export function webhookAction(eventType: string): WebhookAction {
  switch ((eventType ?? "").trim()) {
    case "net.authorize.payment.authcapture.created":
      return "charge";
    case "net.authorize.payment.refund.created":
      return "refund";
    case "net.authorize.payment.void.created":
      return "void";
    case "net.authorize.customer.subscription.cancelled":
    case "net.authorize.customer.subscription.expired":
    case "net.authorize.customer.subscription.suspended":
    case "net.authorize.customer.subscription.terminated":
      return "cancel";
    default:
      return "ignore";
  }
}

/**
 * Whether a refund gives back the whole sale.
 *
 * Only a full refund unwinds a sale — and with it the affiliate's commission. A
 * goodwill five dollars off does not, and voiding the whole commission for it
 * would underpay the affiliate on money that was kept.
 *
 * A cent of tolerance for rounding on the way through two currencies of float.
 * An unknown amount is never full: the safe failure is leaving a commission for
 * a person to look at, not voiding one on a guess.
 */
export function isFullRefund(refundCents: number, originalCents: number): boolean {
  if (!Number.isFinite(refundCents) || !Number.isFinite(originalCents)) return false;
  if (refundCents <= 0 || originalCents <= 0) return false;
  return refundCents >= originalCents - 1;
}
