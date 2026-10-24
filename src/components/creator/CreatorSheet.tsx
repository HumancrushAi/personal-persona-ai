import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";

type CreatorSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  labelledBy?: string;
};

/** A small dependency-free accessible dialog that becomes a bottom sheet on phones. */
export function CreatorSheet({ open, onClose, title, children, labelledBy }: CreatorSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const pushedStateRef = useRef(false);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Lock the page behind the sheet. overflow:hidden on body alone is not
    // enough here: <html> is overflow-y:scroll site-wide, and mobile browsers
    // keep scrolling it. Pinning the body in place does hold, and the scroll
    // position is put back exactly when the sheet closes.
    const scrollY = window.scrollY;
    const body = document.body.style;
    const html = document.documentElement.style;
    const previous = { position: body.position, top: body.top, width: body.width, overflow: body.overflow, htmlOverflow: html.overflow };
    body.position = "fixed";
    body.top = `-${scrollY}px`;
    body.width = "100%";
    body.overflow = "hidden";
    html.overflow = "hidden";
    const panel = panelRef.current;
    panel?.focus();
    const closeFromHistory = () => {
      pushedStateRef.current = false;
      onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>("button, a, input, textarea, select, [tabindex]:not([tabindex='-1'])")].filter((item) => !item.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const marker = `creator-sheet-${Date.now()}`;
    window.history.pushState({ ...(window.history.state ?? {}), creatorSheet: marker }, "", window.location.href);
    pushedStateRef.current = true;
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", closeFromHistory, { once: true });
    return () => {
      body.position = previous.position;
      body.top = previous.top;
      body.width = previous.width;
      body.overflow = previous.overflow;
      html.overflow = previous.htmlOverflow;
      window.scrollTo(0, scrollY);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", closeFromHistory);
      triggerRef.current?.focus();
    };
  }, [open]);

  function requestClose() {
    if (pushedStateRef.current) {
      window.history.back();
      return;
    }
    onClose();
  }

  if (!open) return null;
  const titleId = labelledBy ?? `creator-sheet-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="creator-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="creator-sheet-panel">
        <div className="creator-sheet-handle" aria-hidden="true" />
        <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-3 border-b border-white/[0.08] px-5 py-4">
          <button type="button" aria-label="Back" onClick={requestClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[0.12] text-white transition hover:bg-white/[0.08]"><ChevronLeft className="h-5 w-5" /></button>
          <h2 id={titleId} className="truncate text-center font-display text-lg font-bold text-white">{title}</h2>
          <button type="button" aria-label={`Close ${title}`} onClick={requestClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[0.12] text-white transition hover:bg-white/[0.08]"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[calc(90dvh-5rem)] overflow-y-auto overscroll-contain px-5 py-5 [-webkit-overflow-scrolling:touch]">{children}</div>
      </div>
    </div>
  );
}
