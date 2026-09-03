import { useEffect, useState } from "react";
import { MessageSquare, X, Loader2, Check, Mail } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "./ui/button";
import { submitSupportTicket } from "@/lib/support.functions";
import { supabase } from "@/integrations/supabase/client";

// Support entry point, mounted only on the landing and sign-up pages — see the
// note on SUPPORT_WIDGET_PATHS in routes/__root.tsx.
//
// This used to be two `sms:` links to a personal mobile number. That published
// the number in the page source, did nothing at all on desktop, and recorded
// nothing: there was no ticket to reply to, only a text message on a phone. Now
// the form opens a real ticket and the address on it is where the reply goes.
export function SupportWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sentRef, setSentRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useServerFn(submitSupportTicket);

  // A signed-in visitor should not have to type an address we already hold.
  useEffect(() => {
    if (!isOpen || email) return;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (data.user?.email) setEmail(data.user.email);
      })
      .catch(() => {});
  }, [isOpen, email]);

  async function send() {
    if (sending) return;
    setError(null);
    if (!email.trim() || !message.trim()) {
      setError("Email and message are both needed.");
      return;
    }
    if (message.trim().length < 5) {
      setError("Tell us a little more so we can actually help.");
      return;
    }
    setSending(true);
    try {
      const res: any = await submit({
        data: {
          email: email.trim(),
          name: name.trim() || undefined,
          message: message.trim(),
        },
      });
      setSentRef(res.ref);
      setMessage("");
    } catch (e: any) {
      setError(e?.message ?? "Could not send — try the email link below.");
    } finally {
      setSending(false);
    }
  }

  function close() {
    setIsOpen(false);
    // Reset the confirmation so reopening offers a fresh form rather than the
    // receipt for a message already sent.
    setSentRef(null);
    setError(null);
  }

  return (
    <div className="fixed bottom-24 lg:bottom-6 right-4 lg:right-6 z-50">
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-grad-primary text-primary-foreground shadow-glow transition hover:scale-105"
          aria-label="Contact Support"
        >
          <MessageSquare className="h-6 w-6" />
        </button>
      )}

      {isOpen && (
        <div className="glass relative w-80 max-w-[calc(100vw-2rem)] animate-fade-in rounded-2xl border border-white/10 bg-background/95 p-5 shadow-glow backdrop-blur-xl">
          <button
            onClick={close}
            className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Close Support Window"
          >
            <X className="h-4 w-4" />
          </button>

          <h3 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold text-white">
            <MessageSquare className="h-5 w-5 text-primary" /> Support &amp; Help
          </h3>

          {sentRef ? (
            <div className="py-2">
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 p-3">
                <Check className="h-4 w-4 shrink-0 text-primary" />
                <p className="text-xs text-white">
                  Sent. Your ticket is{" "}
                  <span className="font-mono font-semibold text-primary">#{sentRef}</span>.
                </p>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                We reply to <span className="text-white">{email}</span>, usually within a day. Check
                your spam folder if nothing arrives.
              </p>
              <Button
                onClick={() => setSentRef(null)}
                variant="outline"
                className="mt-3 w-full rounded-xl border-white/10 text-xs"
              >
                Send another message
              </Button>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                Trouble with your account, billing, or creating a character? Tell us what happened
                and we&apos;ll email you back.
              </p>

              <div className="space-y-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email"
                  autoComplete="email"
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none placeholder:text-white/35 focus:border-primary/50"
                />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name (optional)"
                  autoComplete="name"
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none placeholder:text-white/35 focus:border-primary/50"
                />
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  placeholder="What went wrong?"
                  className="w-full resize-y rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none placeholder:text-white/35 focus:border-primary/50"
                />
              </div>

              {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}

              <Button
                onClick={send}
                disabled={sending}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-grad-primary font-semibold text-primary-foreground"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <MessageSquare className="h-4 w-4" /> Send message
                  </>
                )}
              </Button>

              <a
                href="mailto:support@humancrush.com"
                className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-primary"
              >
                <Mail className="h-3.5 w-3.5" /> Or email us directly
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
