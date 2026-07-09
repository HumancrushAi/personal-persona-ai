import { createHmac, timingSafeEqual } from "crypto";

// Verify an Authorize.Net webhook signature.
// Header format: "sha512=HEXDIGEST" (case-insensitive hex).
export function verifyAuthnetSignature(
  body: string,
  sigHeader: string,
  signatureKey: string,
): boolean {
  const provided = (sigHeader ?? "")
    .replace(/^sha512=/i, "")
    .trim()
    .toUpperCase();
  const expected = createHmac("sha512", signatureKey).update(body).digest("hex").toUpperCase();
  if (!provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
