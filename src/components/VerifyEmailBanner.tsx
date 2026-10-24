import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isAccount } from "@/lib/account-user";
import { resendVerification } from "@/lib/verify-email.functions";

const SHOWN_KEY = "hc_verify_banner_shown";
// Never near the chat composer or the Generate button, and not on auth pages.
const HIDDEN_PREFIXES = ["/chat/", "/create-media", "/auth", "/verify-email", "/reset-password"];

/**
 * Deferred verification: a quiet, dismissible nudge for accounts that have
 * not confirmed their email. Once per browser session, and it gates nothing.
 */
export function VerifyEmailBanner() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const hiddenHere = HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  useEffect(() => {
    if (hiddenHere || visible) return;
    let alreadyShown = false;
    try { alreadyShown = window.sessionStorage.getItem(SHOWN_KEY) === "1"; } catch { /* private mode: show it */ }
    if (alreadyShown) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!isAccount(user) || cancelled) return;
      const { data: profile } = await (supabase as any).from("profiles").select("email_verified_at").eq("id", user.id).maybeSingle();
      // Before the migration runs the column does not exist: stay quiet.
      if (cancelled || !profile || !("email_verified_at" in profile) || profile.email_verified_at) return;
      try { window.sessionStorage.setItem(SHOWN_KEY, "1"); } catch { /* fine */ }
      setVisible(true);
    })();
    return () => { cancelled = true; };
  }, [pathname, hiddenHere, visible]);

  if (!visible || hiddenHere) return null;

  async function resend() {
    setSending(true);
    try {
      const result = await resendVerification();
      if (result.ok) toast.success("Sent. Check your inbox.");
      else toast.error("We could not send it right now.");
    } catch {
      toast.error("We could not send it right now.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div role="status" className="relative z-30 border-b border-white/[0.08] bg-[#19191C] px-4 py-2.5 text-sm text-white">
      <div className="mx-auto flex max-w-[1200px] items-center gap-3">
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-[#D4D4D8]">Confirm your email so you can recover your account.</p>
        <button type="button" onClick={() => void resend()} disabled={sending} className="min-h-11 shrink-0 rounded-full border border-white/[0.16] px-3 text-xs font-semibold disabled:opacity-50">{sending ? "Sending…" : "Resend email"}</button>
        <button type="button" aria-label="Dismiss" onClick={() => setVisible(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#A1A1AA] hover:text-white"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
