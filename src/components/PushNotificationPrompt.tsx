import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { enablePush, type PushResult } from "@/lib/push-client";
import { Bell, X, Sparkles, Smartphone } from "lucide-react";
import { toast } from "sonner";

export function PushNotificationPrompt() {
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check iOS detection for PWA recommendation
    const ua = window.navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    setIsIos(iosDevice);

    // Check if user is logged in and push notifications permission is default
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;

      if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

      if (Notification.permission !== "default") return;

      // Check if dismissed recently (within 24 hours)
      const dismissedAt = localStorage.getItem("hc_push_prompt_dismissed");
      if (dismissedAt) {
        const timePassed = Date.now() - parseInt(dismissedAt, 10);
        if (timePassed < 24 * 60 * 60 * 1000) return;
      }

      // Delay prompt slightly so it's not jarring on immediate load
      const timer = setTimeout(() => setShow(true), 2500);
      return () => clearTimeout(timer);
    });
  }, []);

  async function handleEnable() {
    setLoading(true);
    try {
      const res: PushResult = await enablePush();
      if (res === "enabled") {
        toast.success("Push notifications enabled! You'll receive updates on your device 💌");
        setShow(false);
      } else if (res === "denied") {
        toast.error("Notification permission denied in browser settings");
        setShow(false);
      } else if (res === "not-configured") {
        toast.error("Push notification server is not configured");
      } else {
        toast.error("Push notifications are not supported on this browser");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not enable push notifications");
    } finally {
      setLoading(false);
    }
  }

  function handleDismiss() {
    localStorage.setItem("hc_push_prompt_dismissed", Date.now().toString());
    setShow(false);
  }

  if (!show) return null;

  // Styled after the homepage's "Claim Free Chats" offer banner: the same hero
  // image under a dark overlay, gradient icon tile, gradient uppercase headline
  // and white pill button, so the two read as one family.
  return (
    <div className="fixed top-[4.5rem] left-3 right-3 sm:left-auto sm:right-6 sm:max-w-md z-50 animate-in slide-in-from-top-5 fade-in duration-500">
      <div
        className="group relative overflow-hidden rounded-3xl border border-white/10 bg-cover bg-center bg-no-repeat p-5 text-white shadow-[0_0_40px_rgba(244,63,94,0.25)]"
        style={{ backgroundImage: "url('/hero-banner.png')" }}
      >
        <div className="absolute inset-0 bg-black/55 pointer-events-none" />
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close"
          className="absolute top-3 right-3 z-20 rounded-full p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative z-10 flex items-start gap-4 pr-6">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-500 to-rose-400 shadow-glow">
            <Bell className="h-7 w-7 text-white" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-extrabold uppercase tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-pink-300 via-rose-200 to-white drop-shadow-md">
              Don&apos;t miss her messages
            </p>
            <p className="mt-1 text-sm font-light leading-relaxed text-white/90">
              Get <strong className="font-semibold text-white">instant messages, selfies</strong> and
              live alerts from your companion, right on your phone.
            </p>

            {isIos && (
              <p className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-300">
                <Smartphone className="h-3 w-3" /> iPhone tip: Tap Share → Add to Home Screen for
                best push performance.
              </p>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={handleEnable}
                disabled={loading}
                className="rounded-full bg-white px-5 py-2.5 text-xs font-extrabold uppercase tracking-wider text-black shadow-xl transition-all duration-300 hover:bg-pink-500 hover:text-white disabled:opacity-70"
              >
                {loading ? "Enabling..." : "Turn On Alerts"}
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="rounded-full px-3 py-2 text-xs text-white/70 hover:text-white"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
