import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Heart, Check, Crown } from "lucide-react";
import { CREDIT_PACKS, SUBSCRIPTION_TIERS, formatPrice, findPurchasable } from "@/lib/credit-packs";
import { purchaseCredits, cancelSubscription } from "@/lib/payments.functions";
import { getPaymentConfig } from "@/lib/payment-config.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/credits")({
  ssr: false,
  head: () => ({ meta: [{ title: "Credits & subscriptions — HumanCrush.com" }] }),
  component: CreditsPage,
});

declare global {
  interface Window {
    Accept?: { dispatchData: (s: any, cb: (r: any) => void) => void };
  }
}

const ACCEPT_JS_URL = "https://js.authorize.net/v1/Accept.js";

function CreditsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const purchase = useServerFn(purchaseCredits);

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
      const { data } = await supabase.from("profiles")
        .select("subscription_tier, subscription_renews_at, subscription_status, authnet_subscription_id").eq("id", userId!).maybeSingle();
      return data;
    },
  });

  const cancelSub = useServerFn(cancelSubscription);
  async function handleCancel() {
    if (!confirm("Cancel your subscription? You keep your current credits but won't be charged again.")) return;
    try {
      await cancelSub();
      toast.success("Subscription cancelled");
      qc.invalidateQueries({ queryKey: ["profile", userId] });
    } catch (e: any) { toast.error(e.message ?? "Cancel failed"); }
  }

  useEffect(() => {
    if (document.querySelector(`script[src="${ACCEPT_JS_URL}"]`)) return;
    const s = document.createElement("script"); s.src = ACCEPT_JS_URL; s.async = true;
    document.head.appendChild(s);
  }, []);

  const [tab, setTab] = useState<"subs" | "packs">("subs");
  const [selected, setSelected] = useState<string>("sub-lover");
  const [cardNumber, setCardNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvv, setCvv] = useState("");
  const [zip, setZip] = useState("");
  const [processing, setProcessing] = useState(false);

  const { data: payCfg } = useQuery({ queryKey: ["pay-cfg"], queryFn: () => getPaymentConfig() });
  const item = findPurchasable(selected);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!window.Accept) { toast.error("Payment system not loaded yet, try again."); return; }
    if (!payCfg?.clientKey || !payCfg?.apiLoginId) { toast.error("Payment system not configured."); return; }
    setProcessing(true);
    const secureData = {
      authData: { clientKey: payCfg.clientKey, apiLoginID: payCfg.apiLoginId },
      cardData: {
        cardNumber: cardNumber.replace(/\s+/g, ""),
        month: expMonth.padStart(2, "0"),
        year: expYear.length === 2 ? `20${expYear}` : expYear,
        cardCode: cvv, zip,
      },
    };
    window.Accept.dispatchData(secureData, async (resp) => {
      if (resp.messages.resultCode !== "Ok") {
        toast.error(resp.messages.message?.[0]?.text ?? "Card tokenization failed");
        setProcessing(false); return;
      }
      try {
        const res = await purchase({ data: {
          packId: selected,
          opaqueDataDescriptor: resp.opaqueData.dataDescriptor,
          opaqueDataValue: resp.opaqueData.dataValue,
        }});
        toast.success(res.isSubscription ? "Subscription active 💕" : "Credits added!");
        setCardNumber(""); setCvv(""); setExpMonth(""); setExpYear(""); setZip("");
        qc.invalidateQueries({ queryKey: ["balance"] });
        qc.invalidateQueries({ queryKey: ["profile", userId] });
      } catch (err: any) { toast.error(err.message ?? "Payment failed"); }
      finally { setProcessing(false); }
    });
  }

  const total = (balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Button asChild variant="ghost" className="rounded-full"><Link to="/me"><ArrowLeft className="mr-1 h-4 w-4" /> Back</Link></Button>
        <Link to="/" className="flex items-center gap-2">
          <Heart className="h-5 w-5 fill-primary text-primary" />
          <span className="font-display text-xl font-semibold">HumanCrush.com</span>
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

        <form onSubmit={handlePay} className="glass mt-8 space-y-4 rounded-3xl p-6">
          <h2 className="font-display text-2xl font-semibold">Payment</h2>
          <p className="text-xs text-muted-foreground">Secured by Authorize.Net. Your card never touches our servers.</p>
          <div>
            <Label>Card number</Label>
            <Input inputMode="numeric" autoComplete="cc-number" required value={cardNumber} onChange={e=>setCardNumber(e.target.value)} placeholder="4111 1111 1111 1111" className="border-white/10 bg-white/5" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Month</Label><Input required maxLength={2} value={expMonth} onChange={e=>setExpMonth(e.target.value)} placeholder="MM" className="border-white/10 bg-white/5" /></div>
            <div><Label>Year</Label><Input required maxLength={4} value={expYear} onChange={e=>setExpYear(e.target.value)} placeholder="YYYY" className="border-white/10 bg-white/5" /></div>
            <div><Label>CVV</Label><Input required maxLength={4} value={cvv} onChange={e=>setCvv(e.target.value)} placeholder="123" className="border-white/10 bg-white/5" /></div>
          </div>
          <div>
            <Label>Billing ZIP</Label>
            <Input required value={zip} onChange={e=>setZip(e.target.value)} placeholder="10001" className="border-white/10 bg-white/5" />
          </div>
          <Button type="submit" size="lg" className="w-full rounded-full bg-grad-primary text-primary-foreground shadow-glow" disabled={processing || !item}>
            {processing ? "Processing…" : item ? `Pay ${formatPrice(item.priceCents)}` : "Choose a plan"}
          </Button>
          {tab === "subs" && (
            <p className="text-center text-[11px] text-muted-foreground">
              Auto-renews monthly. Cancel anytime — you keep credits already granted.
            </p>
          )}
        </form>

        {profile?.authnet_subscription_id && profile?.subscription_status === "active" && (
          <div className="glass mt-6 flex items-center justify-between rounded-3xl p-5">
            <div>
              <div className="font-medium">Active subscription</div>
              <div className="text-xs text-muted-foreground">
                Next charge {profile?.subscription_renews_at ? new Date(profile.subscription_renews_at).toLocaleDateString() : "soon"}
              </div>
            </div>
            <Button variant="outline" className="rounded-full border-white/20" onClick={handleCancel}>
              Cancel subscription
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
