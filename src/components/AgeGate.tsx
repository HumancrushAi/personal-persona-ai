import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { confirmAge } from "@/lib/payments.functions";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

export function AgeGate() {
  const [needsGate, setNeedsGate] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = useServerFn(confirmAge);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase.from("profiles")
        .select("age_confirmed").eq("id", u.user.id).maybeSingle();
      if (!data?.age_confirmed) setNeedsGate(true);
    })();
  }, []);

  if (!needsGate) return null;

  async function handleAccept() {
    setBusy(true);
    try {
      await confirm();
      setNeedsGate(false);
    } finally { setBusy(false); }
  }

  function handleLeave() {
    window.location.href = "https://www.google.com";
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-6 backdrop-blur-xl">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-card p-8 shadow-glow">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-grad-primary">
          <ShieldAlert className="h-7 w-7 text-primary-foreground" />
        </div>
        <h2 className="mt-5 text-center font-display text-2xl font-semibold">Adults only — 18+</h2>
        <p className="mt-3 text-center text-sm text-muted-foreground">
          HumanCrush.ai contains explicit, adult AI roleplay. By continuing you confirm you are
          at least 18 years old (21 where required) and that adult content is legal in your
          jurisdiction.
        </p>
        <div className="mt-6 grid gap-2">
          <Button onClick={handleAccept} disabled={busy} size="lg" className="rounded-full bg-grad-primary text-primary-foreground">
            {busy ? "…" : "I'm 18 or older — enter"}
          </Button>
          <Button onClick={handleLeave} variant="ghost" size="lg" className="rounded-full">
            Leave
          </Button>
        </div>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          You can revoke consent any time by signing out.
        </p>
      </div>
    </div>
  );
}
