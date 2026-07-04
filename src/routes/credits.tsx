import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Heart, Check, Crown, Lock } from "lucide-react";
import { CREDIT_PACKS, SUBSCRIPTION_TIERS, formatPrice, findPurchasable } from "@/lib/credit-packs";
import { createCheckout, cancelSubscription, createBillingPortal } from "@/lib/payments.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/credits")({
  ssr: false,
  head: () => ({ meta: [{ title: "Credits & subscriptions — HumanCrush.ai" }] }),
  component: CreditsPage,
});

function CreditsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const checkout = useServerFn(createCheckout);
  const cancelSub = useServerFn(cancelSubscription);
  const billingPortal = useServerFn(createBillingPortal);

  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => {
    if (!data.user) navigate({ to: "/auth" }); else setUserId(data.user.id);
  }); }, []);

  const { data: balance } = useQuery({
    enabled: !!userId, queryKey: ["balance"],
    queryFn: async () => {
      const { data } = await supabase.from("credit_balances")
        .select("free_messages_remaining, paid_credits").eq("user_id", userId!).maybeSingle();
      return data;
    },
  });

  const { data: profile } = useQuery({
    enabled: !!userId, queryKey: ["profile", userId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("profiles")
        .select("subscription_tier, subscription_renews_at, subscription_status, stripe_subscription_id").eq("id", userId!).maybeSingle();
      return data;
    },
  });

  // Handle return from Stripe Checkout. The webhook credits the wallet
  // asynchronously, so refresh now and again shortly after.
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("checkout");
    if (!status) return;
    if (status === "success") {
      toast.success("Payment received — updating your balance…");
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["profile", userId] });
      const t = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["balance"] });
        qc.invalidateQueries({ queryKey: ["profile", userId] });
      }, 3500);
      window.history.replaceState({}, "", "/credits");
      return () => clearTimeout(t);
    }
    if (status === "cancel") {
      toast("Checkout canceled — no charge made.");
      window.history.replaceState({}, "", "/credits");
    }
  }, [userId]);

  const [tab, setTab] = useState<"subs" | "packs">("subs");
  const [selected, setSelected] = useState<string>("sub-lover");
  const [processing, setProcessing] = useState(false);
  const item = findPurchasable(selected);

  async function handleCheckout() {
    if (!item) return;
    setProcessing(true);
    try {
      const res = await checkout({ data: { packId: selected } });
      window.location.href = res.url; // redirect to Stripe-hosted Checkout
    } catch (e: any) {
      toast.error(e.message ?? "Could not start checkout");
      setProcessing(false);
    }
  }

  async function handleCancel() {
    if (!confirm("Cancel your subscription? You keep your current credits and stay active until the period ends.")) return;
    try {
      await cancelSub();
      toast.success("Subscription will end at the period's close.");
      qc.invalidateQueries({ queryKey: ["profile", userId] });
    } catch (e: any) { toast.error(e.message ?? "Cancel failed"); }
  }

  async function handleManageBilling() {
    try {
      const res = await billingPortal();
      window.location.href = res.url;
    } catch (e: any) { toast.error(e.message ?? "Could not open billing portal"); }
  }

  const total = (balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Button asChild variant="ghost" className="rounded-full"><Link to="/me"><ArrowLeft className="mr-1 h-4 w-4" /> Back</Link></Button>
        <Link to="/" className="flex items-center gap-2">
          <Heart className="h-5 w-5 fill-primary text-primary" />
          <span className="font-display text-xl font-semibold">HumanCrush.ai</span>
        </Link>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <h1 className="font-display text-4xl font-semibold md:text-5xl">Unlock her completely.</h1>
        <p className="mt-2 text-muted-foreground">
          You have <strong className="text-foreground">{total}</strong> messages
          {profile?.subscription_tier && <> · <Crown className="inline h-4 w-4 text-primary" /> {SUBSCRIPTION_TIERS.find(t=>t.id===profile.subscription_tier)?.name ?? profile.subscription_tier}</>}
        </p>

        <div className="mt-6 inline-flex rounded-full border border-white/10 bg-white/5 p-1 text-sm">
          <button onClick={() => { setTab("subs"); setSelected("sub-lover"); }}
            className={`rounded-full px-4 py-1.5 ${tab==="subs" ? "bg-grad-primary text-primary-foreground" : ""}`}>
            Monthly subscriptions
          </button>
          <button onClick={() => { setTab("packs"); setSelected("lover"); }}
            className={`rounded-full px-4 py-1.5 ${tab==="packs" ? "bg-grad-primary text-primary-foreground" : ""}`}>
            One-time credit packs
          </button>
        </div>

        {tab === "subs" && (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {SUBSCRIPTION_TIERS.map(t => (
              <button key={t.id} onClick={() => setSelected(t.id)}
                className={`relative rounded-3xl border-2 p-5 text-left transition ${selected===t.id ? "border-primary bg-white/5 shadow-glow" : "border-white/10 bg-white/5 hover:border-primary/40"}`}>
                {t.badge && <span className="absolute -top-2.5 left-4 rounded-full bg-grad-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">{t.badge}</span>}
                <div className="font-display text-xl font-semibold">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.tagline}</div>
                <div className="mt-3 text-3xl font-bold">{formatPrice(t.priceCents)}<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {t.perks.map(p => (
                    <li key={p} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> {p}</li>
                  ))}
                </ul>
                {selected===t.id && <Check className="absolute right-4 top-4 h-5 w-5 text-primary" />}
              </button>
            ))}
          </div>
        )}

        {tab === "packs" && (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {CREDIT_PACKS.map(p => (
              <button key={p.id} onClick={() => setSelected(p.id)}
                className={`relative rounded-3xl border-2 p-5 text-left transition ${selected===p.id ? "border-primary bg-white/5 shadow-glow" : "border-white/10 bg-white/5 hover:border-primary/40"}`}>
                {p.badge && <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-medium text-primary-foreground">{p.badge}</span>}
                <div className="font-display text-xl font-semibold">{p.name}</div>
                <div className="mt-1 text-3xl font-bold">{formatPrice(p.priceCents)}</div>
                <div className="mt-1 text-sm text-muted-foreground">{p.credits} text msgs · {p.perMsgCents.toFixed(1)}¢ each</div>
                {selected===p.id && <Check className="absolute right-4 top-4 h-5 w-5 text-primary" />}
              </button>
            ))}
          </div>
        )}

        <div className="glass mt-8 space-y-4 rounded-3xl p-6">
          <h2 className="font-display text-2xl font-semibold">Checkout</h2>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> Secured by Stripe. You'll be redirected to enter payment.
          </p>
          <Button onClick={handleCheckout} size="lg" className="w-full rounded-full bg-grad-primary text-primary-foreground shadow-glow" disabled={processing || !item}>
            {processing ? "Redirecting…" : item
              ? (tab === "subs" ? `Subscribe · ${formatPrice(item.priceCents)}/mo` : `Buy · ${formatPrice(item.priceCents)}`)
              : "Choose a plan"}
          </Button>
          {tab === "subs" && (
            <p className="text-center text-[11px] text-muted-foreground">
              Auto-renews monthly. Cancel anytime — you keep credits already granted.
            </p>
          )}
        </div>

        {profile?.stripe_subscription_id && profile?.subscription_status === "active" && (
          <div className="glass mt-6 flex items-center justify-between rounded-3xl p-5">
            <div>
              <div className="font-medium">Active subscription</div>
              <div className="text-xs text-muted-foreground">
                Next charge {profile?.subscription_renews_at ? new Date(profile.subscription_renews_at).toLocaleDateString() : "soon"}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-full border-white/20" onClick={handleManageBilling}>
                Manage billing
              </Button>
              <Button variant="outline" className="rounded-full border-white/20" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
