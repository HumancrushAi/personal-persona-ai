import { useEffect, useRef } from "react";

// Browser Back should close an open overlay, not leave the site.
//
// The homepage opens its story viewer and tease chat from React state alone, so
// no history entry exists for them — pressing Back walked straight past the
// homepage to whatever preceded it (for most people, Google). This pushes a
// throwaway entry while an overlay is open and consumes it again on close, so
// Back closes the overlay and a second Back leaves the page as expected.
export function useCloseOnBack(open: boolean, close: () => void) {
  // Kept in a ref so a new closure identity on every render doesn't tear the
  // history entry down and rebuild it.
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;

    window.history.pushState({ hcOverlay: true }, "");
    const onPop = () => closeRef.current();
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed from the UI rather than by Back: our entry is still on the stack,
      // so drop it. If Back already popped it, the state marker is gone and we
      // must not navigate again.
      if (window.history.state?.hcOverlay) window.history.back();
    };
  }, [open]);
}
