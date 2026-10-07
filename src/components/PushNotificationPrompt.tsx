import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { enablePush, type PushResult } from "@/lib/push-client";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="fixed top-[4.5rem] left-3 right-3 sm:left-auto sm:right-6 sm:max-w-md z-50 animate-in slide-in-from-top-5 fade-in duration-500">
      <div className="relative overflow-hidden rounded-3xl border border-pink-500/30 bg-gradient-to-br from-[#1c0d28]/95 to-[#0b0512]/95 p-5 shadow-[0_0_30px_rgba(236,72,153,0.25)] backdrop-blur-2xl">
        <div className="absolute -left-10 -top-10 h-32 w-32 rounded-full bg-pink-500/20 blur-3xl pointer-events-none" />
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-white/10 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-4 pr-6 relative z-10">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-500 to-rose-400 text-primary-foreground shadow-[0_0_15px_rgba(236,72,153,0.4)]">
            <Bell className="h-6 w-6 animate-pulse" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-base font-bold text-white tracking-tight">
              <span>Enable Notifications</span>
              <Sparkles className="h-4 w-4 text-pink-400" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Get instant messages, selfies, and live alerts from your companion directly on your
              phone!
            </p>

            {isIos && (
              <p className="mt-1.5 text-[10px] text-amber-400/90 flex items-center gap-1">
                <Smartphone className="h-3 w-3" /> iPhone tip: Tap Share → Add to Home Screen for
                best push performance.
              </p>
            )}

            <div className="mt-4 flex items-center gap-3">
              <Button
                size="sm"
                onClick={handleEnable}
                disabled={loading}
                className="h-9 rounded-full bg-gradient-to-r from-pink-500 to-rose-400 px-5 text-xs font-bold text-white shadow-[0_0_15px_rgba(236,72,153,0.3)] hover:shadow-[0_0_20px_rgba(236,72,153,0.5)] transition-all"
              >
                {loading ? "Enabling..." : "Turn On Notifications"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismiss}
                className="h-8 rounded-full px-3 text-xs text-muted-foreground"
              >
                Maybe Later
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
