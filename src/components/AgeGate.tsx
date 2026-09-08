import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

// First-load 18+ disclaimer. Works for anonymous visitors (no auth needed) and
// is remembered in localStorage so it only shows once per browser. Mounted once
// globally in __root so it gates every page before the site is usable.
const KEY = "hc_age_confirmed_18";

export function AgeGate() {
  const [needsGate, setNeedsGate] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== "true") setNeedsGate(true);
    } catch {
      setNeedsGate(true);
    }
  }, []);

  if (!needsGate) return null;

  function handleAccept() {
    try {
      localStorage.setItem(KEY, "true");
    } catch {
      /* private mode — still let them in for this session */
    }
    setNeedsGate(false);
  }

  function handleLeave() {
    window.location.href = "https://www.google.com";
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-6 backdrop-blur-xl">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-card p-8 shadow-glow">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-grad-primary">
          <ShieldAlert className="h-7 w-7 text-primary-foreground" />
        </div>
        <h2 className="mt-5 text-center font-display text-2xl font-semibold">Adults only — 18+</h2>
        <p className="mt-3 text-center text-sm text-muted-foreground">
          This website is rated 18+ and intended for adult audiences. By entering you confirm
          that you are at least 18 years old (or legal age in your location) and agree to our
          Terms of Service.
        </p>
        <div className="mt-6 grid gap-2">
          <Button
            onClick={handleAccept}
            size="lg"
            className="rounded-full bg-grad-primary text-primary-foreground"
          >
            Yes, I'm 18 or older — enter
          </Button>
          <Button onClick={handleLeave} variant="ghost" size="lg" className="rounded-full">
            No, take me out
          </Button>
        </div>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          By entering you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
