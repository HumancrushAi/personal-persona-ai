import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { ReelMedia } from "@/components/creator/ReelMedia";

const SEEN_KEY = "hc_dfy_popup_seen";
const DELAY_MS = 60_000;

/**
 * The done-for-you offer, once per visit, after a minute on the creator page.
 * It waits while the user is busy (typing a prompt, another sheet open) and
 * never shows twice in a session.
 */
export function DoneForYouPopup({ href, face, busy }: {
  href: string;
  face: { name: string; image_url: string; reel: string | null } | null;
  /** True while a sheet is open or a prompt is being typed. */
  busy: boolean;
}) {
  const [due, setDue] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try { if (window.sessionStorage.getItem(SEEN_KEY) === "1") return; } catch { /* private mode: still show once */ }
    const timer = window.setTimeout(() => setDue(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!due || busy || open) return;
    setOpen(true);
    setDue(false);
    try { window.sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* fine */ }
  }, [due, busy, open]);

  // Lock the page behind it, the same way the sheets do.
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const body = document.body.style;
    const html = document.documentElement.style;
    const previous = { position: body.position, top: body.top, width: body.width, overflow: body.overflow, htmlOverflow: html.overflow };
    body.position = "fixed";
    body.top = `-${scrollY}px`;
    body.width = "100%";
    body.overflow = "hidden";
    html.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => {
      body.position = previous.position;
      body.top = previous.top;
      body.width = previous.width;
      body.overflow = previous.overflow;
      html.overflow = previous.htmlOverflow;
      window.scrollTo(0, scrollY);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;
  // Portal: the creator page is `isolate`, which would keep this under the tab bar.
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 backdrop-blur-sm motion-safe:animate-[hc-fade_.3s_ease-out] sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="dfy-title" className="relative max-h-[94dvh] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-t-[28px] sm:max-h-none sm:overflow-hidden border border-white/[0.12] bg-[#0C0B0D] shadow-[0_40px_120px_rgba(229,72,77,.25)] motion-safe:animate-[hc-rise_.5s_cubic-bezier(.2,.7,.2,1)] sm:grid sm:grid-cols-[1fr_1.1fr] sm:rounded-[28px]">
        <div className="relative h-[230px] sm:h-auto sm:min-h-[460px]">
          {face && <ReelMedia reel={face.reel} poster={face.image_url} posterWidth={720} alt="" eager className="absolute inset-0 h-full w-full" />}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0C0B0D] via-[#0C0B0D]/30 to-transparent sm:bg-gradient-to-r sm:from-transparent sm:via-[#0C0B0D]/20 sm:to-[#0C0B0D]" />
          <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_30%_80%,rgba(229,72,77,.35),transparent)] mix-blend-screen" />
        </div>
        <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm transition hover:bg-black/70"><X className="h-5 w-5" /></button>
        <div className="relative -mt-14 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:mt-0 sm:flex sm:flex-col sm:justify-center sm:px-8 sm:py-10">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#E5484D]/40 bg-[#E5484D]/15 px-3 py-1 text-[11px] font-bold text-[#FFB3BD]"><span className="h-1.5 w-1.5 rounded-full bg-[#E5484D] motion-safe:animate-pulse" />Done-for-you</p>
          <h2 id="dfy-title" className="mt-3 font-display text-[34px] font-extrabold leading-[0.95] tracking-[-0.03em] text-white sm:text-[44px]">
            <span className="font-script mr-1 align-[-0.05em] text-[48px] font-normal text-[#FF8A9B] sm:text-[60px]">Your</span>
            AI model business, built for you.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/75">Skip the learning curve. We create her, fill her library and hand you a brand that is ready to earn.</p>
          <ul className="mt-4 space-y-2 text-sm text-white">
            {["One signature model with a face that never changes", "A launch-ready library of photos and reels", "A handoff and posting plan you can run yourself"].map((line) => (
              <li key={line} className="flex gap-2.5"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#E5484D]"><Check className="h-3 w-3" strokeWidth={3} /></span>{line}</li>
            ))}
          </ul>
          <a href={href} onClick={() => setOpen(false)} className="hc-shine mt-6 inline-flex min-h-[52px] w-full items-center justify-center rounded-full bg-[#E5484D] text-base font-extrabold text-white shadow-[0_12px_40px_rgba(229,72,77,.45)] transition hover:bg-[#F0565B]">Book a free call</a>
          <button type="button" onClick={() => setOpen(false)} className="mt-2 min-h-11 w-full text-sm font-semibold text-white/60 hover:text-white">Maybe later</button>
          <p className="mt-1 text-center text-[11px] text-white/40">We reply by text with next steps. All models are fictional adults.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
