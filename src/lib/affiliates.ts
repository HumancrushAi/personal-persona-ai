// Affiliate code handling shared by the client and the server.
//
// Kept free of server imports so the ?ref= capture in __root.tsx and the
// server functions that validate it agree on what a code is. They must: a code
// the client stores but the server rejects is a referral that silently never
// happens, and nobody finds out until an affiliate asks where their money is.

/** A code is lower-case, 2-32 chars, starts alphanumeric. Mirrors the CHECK. */
const CODE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/**
 * Normalise a code as typed into its canonical form, or null if it is not one.
 *
 * Codes get typed by hand, printed on things and pasted into other people's
 * CMSes, so "?ref=Gary " and "?ref=gary" have to be the same affiliate. Trimmed
 * and lower-cased rather than rejected, because a case mismatch losing someone
 * their commission is a bug that would be invisible from both ends.
 */
export function normalizeAffiliateCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toLowerCase();
  return CODE_RE.test(code) ? code : null;
}

/** Where the pending code lives between landing on the site and signing up. */
export const AFFILIATE_STORAGE_KEY = "hc_ref";

/**
 * How long a click stays worth something.
 *
 * 90 days is the usual figure in this industry and it is the right order of
 * magnitude here: someone lands from an affiliate's post, thinks about it, and
 * comes back to sign up days later. Shorter windows just fail to pay for real
 * introductions.
 */
export const AFFILIATE_WINDOW_DAYS = 90;

export type StoredRef = { code: string; at: number };

/** Read the pending code, ignoring one that has aged out. */
export function readStoredRef(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(AFFILIATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRef;
    const code = normalizeAffiliateCode(parsed?.code);
    if (!code || typeof parsed.at !== "number") return null;
    if (now - parsed.at > AFFILIATE_WINDOW_DAYS * 86_400_000) return null;
    return code;
  } catch {
    // Private browsing, blocked storage, or something else wrote nonsense to
    // the key. A referral is worth a few percent; it is never worth an
    // exception on a page load.
    return null;
  }
}

/**
 * Store a pending code — but never over an existing one.
 *
 * Attribution is FIRST touch (see the UNIQUE on affiliate_referrals.user_id).
 * Overwriting here would make it last touch for anyone who had not signed up
 * yet, so the two halves would disagree about who introduced the customer
 * depending on when they got round to registering.
 */
export function storeRef(code: string, now = Date.now()): void {
  try {
    if (readStoredRef(now)) return;
    localStorage.setItem(AFFILIATE_STORAGE_KEY, JSON.stringify({ code, at: now } as StoredRef));
  } catch {
    /* see readStoredRef */
  }
}

export function clearStoredRef(): void {
  try {
    localStorage.removeItem(AFFILIATE_STORAGE_KEY);
  } catch {
    /* see readStoredRef */
  }
}

/** Commission on an amount, in whole cents. Rounded, never floored. */
export function commissionCents(grossCents: number, pct: number): number {
  if (!Number.isFinite(grossCents) || !Number.isFinite(pct)) return 0;
  if (grossCents <= 0 || pct <= 0) return 0;
  // Mirrors the ROUND in accrue_affiliate_commission. Floor would shave a cent
  // off most small transactions in our favour, which an affiliate eventually
  // notices and stops trusting.
  return Math.round((grossCents * pct) / 100);
}

/** "$12.34" from 1234. Used on the admin screen and nowhere sensitive. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
