/**
 * Never send a direct visitor to an unrelated browser history entry. App
 * navigation gets the natural back behavior; a shared/bookmarked page returns
 * to Explore instead.
 */
export function goBackOrExplore(fallback = "/browse") {
  if (typeof window === "undefined") return;
  let sameOriginReferrer = false;
  try {
    sameOriginReferrer = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
  } catch {
    sameOriginReferrer = false;
  }
  const routerIndex = (window.history.state as { __TSR_index?: unknown } | null)?.__TSR_index;
  if (sameOriginReferrer || (typeof routerIndex === "number" && routerIndex > 0)) {
    window.history.back();
    return;
  }
  window.location.assign(fallback);
}
