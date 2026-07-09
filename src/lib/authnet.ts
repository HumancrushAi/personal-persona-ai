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
