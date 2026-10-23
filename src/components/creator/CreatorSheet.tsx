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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
      document.body.style.overflow = previousOverflow;
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
        <div className="max-h-[calc(90dvh-5rem)] overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
