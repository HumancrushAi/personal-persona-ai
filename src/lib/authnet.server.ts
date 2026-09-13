// Network calls to Authorize.Net that are not a charge. Server-only — this holds
// the merchant credentials. Parsing stays in authnet.ts, where it is pure and
// tested.

import { transactionDetailsResult, type TransactionDetails } from "./authnet";

const AUTHNET_URL = "https://api.authorize.net/xml/v1/request.api"; // LIVE

/**
 * Look a transaction up by id.
 *
 * The only way to learn what a webhook is about: a payment notification carries
 * a transaction id and nothing else. This returns the subscription a recurring
 * charge belongs to, and the original charge a refund points at.
 *
 * Requires "Transaction Details API" to be enabled on the merchant account
 * (Account → Settings → Security Settings). Without it every lookup comes back
 * as an API error, which is returned rather than thrown.
 *
 * THROWS only when Authorize.Net cannot be reached or answers with an HTTP
 * failure. The webhook turns that into a 500 so the gateway retries, which is
 * the right response to something transient. An answer that Authorize.Net did
 * give — not found, not permitted — is not going to change on a retry, so it
 * comes back as { ok: false } instead.
 */
export async function getTransactionDetails(transId: string): Promise<TransactionDetails> {
  const name = process.env.AUTHORIZE_NET_API_LOGIN_ID;
  const transactionKey = process.env.AUTHORIZE_NET_TRANSACTION_KEY;
  if (!name || !transactionKey) return { ok: false, error: "Payment provider not configured" };

  const res = await fetch(AUTHNET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Key order matters. Authorize.Net's JSON API is validated against the XML
    // schema underneath it, where merchantAuthentication must come first.
    body: JSON.stringify({
      getTransactionDetailsRequest: { merchantAuthentication: { name, transactionKey }, transId },
    }),
  });
  if (!res.ok) throw new Error(`Authorize.Net lookup failed: HTTP ${res.status}`);

  // Same byte-order mark payments.functions.ts strips: the gateway prefixes its
  // JSON with one and JSON.parse rejects it.
  const raw = (await res.text()).replace(/^﻿/, "");
  try {
    return transactionDetailsResult(JSON.parse(raw));
  } catch {
    return { ok: false, error: "Unreadable lookup response" };
  }
}
