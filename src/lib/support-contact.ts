// The one address support goes to.
//
// It is shown on the site as a plain mailto so anyone can write directly; it
// is the inbox a new ticket is alerted to; and it is the Reply-To on every
// staff reply, so a customer answering lands in the same place. One constant,
// so the address on the page and the address on the server cannot drift. The
// SUPPORT_EMAIL env var overrides it on the server without a code change.
export const SUPPORT_EMAIL = "lgtopseller@yahoo.com";

export function supportMailto(subject = "HumanCrush support"): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
