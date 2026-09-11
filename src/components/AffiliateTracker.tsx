// Captures ?ref= on landing and attributes the user once they sign in.
//
// Renders nothing. It lives at the root because an affiliate link can point at
// any page — the front page, a companion profile, the pricing page — and a code
// that only works on "/" is a code that quietly loses money on every deep link
// someone shares.
//
// The code has to survive the gap between a click and a signup: landing page →
// signup form → email confirmation → back to the site → sign in. That can be
// days and it crosses a mail client, so it is carried in localStorage rather
// than in a server session or a router-level state.

import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  clearStoredRef,
  normalizeAffiliateCode,
  readStoredRef,
  storeRef,
} from "@/lib/affiliates";
import { claimReferral, trackAffiliateVisit } from "@/lib/affiliates.functions";

export function AffiliateTracker() {
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Landing: stash the code and count the click.
  useEffect(() => {
    const raw = new URLSearchParams(search).get("ref");
    const code = normalizeAffiliateCode(raw);
    if (!code) return;

    // Stored before the network call, and storeRef will not overwrite an
    // existing code. Attribution is first touch, so the visitor who has already
    // been introduced by someone else stays theirs even if they later arrive on
    // a different affiliate's link.
    storeRef(code);

    // The click is still counted when they already had a code — the second
    // affiliate did send this visit, and their click count should say so even
    // though the signup will not be attributed to them.
    void trackAffiliateVisit({
      data: {
        code,
        path: pathname,
        referrer: typeof document === "undefined" ? undefined : document.referrer || undefined,
      },
    }).catch(() => {
      // A tracking failure must never be visible to the visitor. They came here
      // to look at the site.
    });
  }, [search, pathname]);

  // Attribution: the moment we see them signed in with a code pending.
  //
  // Both an existing session and a fresh sign-in are handled, because the two
  // arrive differently: someone who confirms their email lands already
  // authenticated (no event fires), while someone signing in on the form does
  // so through onAuthStateChange.
  useEffect(() => {
    let cancelled = false;

    async function attribute() {
      const code = readStoredRef();
      if (!code || cancelled) return;
      const { data } = await supabase.auth.getUser();
      if (!data.user || cancelled) return;

      try {
        const res = await claimReferral({ data: { code } });
        // Cleared on any SETTLED outcome — attributed, already referred to
        // somebody else, self-referral, malformed. None of those can change.
        //
        // "unknown_code" deliberately is not settled, and this is the case that
        // matters: an affiliate whose application is still pending does not
        // match, because claimReferral only accepts active ones. Clearing here
        // would mean everyone who arrived during the approval gap is silently
        // never attributed, which is the affiliate's launch week. Left to
        // retry; the ninety-day window is what bounds it.
        if (res && res.reason !== "unknown_code") clearStoredRef();
      } catch {
        // Left in place: a network failure IS worth retrying on the next load.
      }
    }

    void attribute();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") void attribute();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return null;
}
