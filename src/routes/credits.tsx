import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { CREDIT_PACKS, SUBSCRIPTION_TIERS, formatPrice, type CreditPack, type SubscriptionTier } from "@/lib/credit-packs";
import { purchaseCredits, cancelSubscription, changeSubscription, getPricing } from "@/lib/payments.functions";
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
  const changeSub = useServerFn(changeSubscription);

  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        const query = window.location.search;
        navigate({ to: "/auth", search: { redirect: `/credits${query}` } as never });
      }
      else setUserId(data.user.id);
    });
  }, []);

  const { data: balance } = useQuery({
    enabled: !!userId,
    queryKey: ["balance"],
    queryFn: async () => {
      const { data } = await supabase
        .from("credit_balances")
        .select("free_messages_remaining, paid_credits")
        .eq("user_id", userId!)
        .maybeSingle();
      return data;
    },
  });

  const { data: profile } = useQuery({
    enabled: !!userId,
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select(
          "subscription_tier, subscription_renews_at, subscription_status, authnet_subscription_id",
        )
        .eq("id", userId!)
        .maybeSingle();
      return data;
    },
  });

  const cancelSub = useServerFn(cancelSubscription);
  async function handleCancel() {
    if (
      !confirm(
        "Cancel your subscription? You keep your current credits but won't be charged again.",
      )
    )
      return;
    try {
      await cancelSub();
      toast.success("Subscription cancelled");
      qc.invalidateQueries({ queryKey: ["profile", userId] });
    } catch (e: any) {
      toast.error(e.message ?? "Cancel failed");
    }
  }

  useEffect(() => {
    if (document.querySelector(`script[src="${ACCEPT_JS_URL}"]`)) return;
    const s = document.createElement("script");
    s.src = ACCEPT_JS_URL;
    s.async = true;
    document.head.appendChild(s);
  }, []);

  const [tab, setTab] = useState<"subs" | "packs">("subs");
  const [selected, setSelected] = useState<string>("sub-studio-creator");
  const [cardNumber, setCardNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvv, setCvv] = useState("");
  const [zip, setZip] = useState("");
  const [processing, setProcessing] = useState(false);
  const [changing, setChanging] = useState(false);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("plan");
    if (requested === "monthly") { setTab("subs"); setSelected("sub-lover"); }
    if (requested === "annual") { setTab("subs"); setSelected("sub-soulmate"); }
    if (requested === "creator") { setTab("subs"); setSelected("sub-creator"); }
    if (requested === "creator-annual") { setTab("subs"); setSelected("sub-creator-annual"); }
    // The creator page sends the exact tier it showed.
    if (requested?.startsWith("sub-")) {
      setTab("subs");
      setSelected(requested);
      setBillingCycle(requested.endsWith("-annual") ? "yearly" : "monthly");
    }
  }, []);

  const { data: payCfg } = useQuery({ queryKey: ["pay-cfg"], queryFn: () => getPaymentConfig() });
  // Server-priced packs (admin overrides applied) so display matches the charge.
  const { data: pricing } = useQuery({ queryKey: ["pricing"], queryFn: () => getPricing() });
  const packs = pricing?.packs ?? CREDIT_PACKS;
  const tiers = pricing?.tiers ?? SUBSCRIPTION_TIERS;
  const item = packs.find((p) => p.id === selected) ?? tiers.find((t) => t.id === selected);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!window.Accept) {
      toast.error("Payment system not loaded yet, try again.");
      return;
    }
    if (!payCfg?.clientKey || !payCfg?.apiLoginId) {
      toast.error("Payment system not configured.");
      return;
    }
    setProcessing(true);
    const secureData = {
      authData: { clientKey: payCfg.clientKey, apiLoginID: payCfg.apiLoginId },
      cardData: {
        cardNumber: cardNumber.replace(/\s+/g, ""),
        month: expMonth.padStart(2, "0"),
        year: expYear.length === 2 ? `20${expYear}` : expYear,
        cardCode: cvv,
        zip,
      },
    };
    window.Accept.dispatchData(secureData, async (resp) => {
      if (resp.messages.resultCode !== "Ok") {
        toast.error(resp.messages.message?.[0]?.text ?? "Card tokenization failed");
        setProcessing(false);
        return;
      }
      try {
        const res = await purchase({
          data: {
            packId: selected,
            opaqueDataDescriptor: resp.opaqueData.dataDescriptor,
            opaqueDataValue: resp.opaqueData.dataValue,
          },
        });
        toast.success(res.isSubscription ? "Subscription active 💕" : "Credits added!");
        setCardNumber("");
        setCvv("");
        setExpMonth("");
        setExpYear("");
        setZip("");
        qc.invalidateQueries({ queryKey: ["balance"] });
        qc.invalidateQueries({ queryKey: ["profile", userId] });
        const returnTo = new URLSearchParams(window.location.search).get("returnTo");
        if (returnTo && returnTo.startsWith("/")) { window.location.assign(returnTo); return; }
      } catch (err: any) {
        toast.error(err.message ?? "Payment failed");
      } finally {
        setProcessing(false);
      }
    });
  }

  async function handleChange() {
    if (!selected || tab !== "subs") return;
    setChanging(true);
    try {
      await changeSub({ data: { tierId: selected } });
      toast.success("Plan updated. Your next renewal will use the new plan.");
      await qc.invalidateQueries({ queryKey: ["profile", userId] });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Plan change failed");
    } finally {
      setChanging(false);
    }
  }

  const total = (balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0);

  const visibleTiers = tiers.filter((tier) =>
    !tier.legacy && (billingCycle === "yearly" ? tier.billingMonths === 12 : tier.billingMonths !== 12),
  );

  return (
    <PricingExperience
      total={total}
      profile={profile}
      tiers={visibleTiers}
      allTiers={tiers}
      packs={packs}
      selected={selected}
      setSelected={setSelected}
      tab={tab}
      setTab={setTab}
      billingCycle={billingCycle}
      setBillingCycle={setBillingCycle}
      item={item}
      processing={processing}
      changing={changing}
      handlePay={handlePay}
      handleChange={handleChange}
      handleCancel={handleCancel}
      cardNumber={cardNumber}
      setCardNumber={setCardNumber}
      expMonth={expMonth}
      setExpMonth={setExpMonth}
      expYear={expYear}
      setExpYear={setExpYear}
      cvv={cvv}
      setCvv={setCvv}
      zip={zip}
      setZip={setZip}
    />
  );

  /* Legacy checkout layout retained only as a migration reference. The
     PricingExperience above is the live presentation. */
  /*
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-5xl px-6 py-8 pb-20">
        <h1 className="font-display text-4xl font-semibold md:text-5xl">Unlock her completely.</h1>
        <p className="mt-2 text-muted-foreground">
          You have <strong className="text-foreground">{total}</strong> messages
          {profile?.subscription_tier && (
            <>
              {" "}
              · <Crown className="inline h-4 w-4 text-primary" />{" "}
              {tiers.find((t) => t.id === profile?.subscription_tier)?.name ??
                profile?.subscription_tier}
            </>
          )}
        </p>

        <div className="mt-6 inline-flex rounded-full border border-white/10 bg-white/5 p-1 text-sm">
          <button
            onClick={() => {
              setTab("subs");
              setSelected("sub-lover");
            }}
            className={`rounded-full px-4 py-1.5 ${tab === "subs" ? "bg-grad-primary text-primary-foreground" : ""}`}
          >
            Monthly subscriptions
          </button>
          <button
            onClick={() => {
              setTab("packs");
              setSelected("lover");
            }}
            className={`rounded-full px-4 py-1.5 ${tab === "packs" ? "bg-grad-primary text-primary-foreground" : ""}`}
          >
            One-time credit packs
          </button>
        </div>

        {tab === "subs" && (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {tiers.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelected(t.id)}
                className={`relative rounded-3xl border-2 p-5 text-left transition ${selected === t.id ? "border-primary bg-white/5 shadow-glow" : "border-white/10 bg-white/5 hover:border-primary/40"}`}
              >
                {t.badge && (
                  <span className="absolute -top-2.5 left-4 rounded-full bg-grad-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                    {t.badge}
                  </span>
                )}
                <div className="font-display text-xl font-semibold">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.tagline}</div>
                <div className="mt-3 text-3xl font-bold">
                  {formatPrice(t.priceCents)}
                  <span className="text-sm font-normal text-muted-foreground">/{t.billingMonths === 12 ? "yr" : "mo"}</span>
                </div>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {t.perks.map((p) => (
                    <li key={p} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 text-primary" /> {p}
                    </li>
                  ))}
                </ul>
                {selected === t.id && (
                  <Check className="absolute right-4 top-4 h-5 w-5 text-primary" />
                )}
              </button>
            ))}
          </div>
        )}

        {tab === "packs" && (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {packs.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`relative rounded-3xl border-2 p-5 text-left transition ${selected === p.id ? "border-primary bg-white/5 shadow-glow" : "border-white/10 bg-white/5 hover:border-primary/40"}`}
              >
                {p.badge && (
                  <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                    {p.badge}
                  </span>
                )}
                <div className="font-display text-xl font-semibold">{p.name}</div>
                <div className="mt-1 text-3xl font-bold">{formatPrice(p.priceCents)}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {p.credits} text msgs · {p.perMsgCents.toFixed(1)}¢ each
                </div>
                {selected === p.id && (
                  <Check className="absolute right-4 top-4 h-5 w-5 text-primary" />
                )}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handlePay} className="glass mt-8 space-y-4 rounded-3xl p-6">
          <h2 className="font-display text-2xl font-semibold">Payment</h2>
          <p className="text-xs text-muted-foreground">
            Secured by Authorize.Net. Your card never touches our servers.
          </p>
          <div>
            <Label>Card number</Label>
            <Input
              inputMode="numeric"
              autoComplete="cc-number"
              required
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="4111 1111 1111 1111"
              className="border-white/10 bg-white/5"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Month</Label>
              <Input
                required
                maxLength={2}
                value={expMonth}
                onChange={(e) => setExpMonth(e.target.value)}
                placeholder="MM"
                className="border-white/10 bg-white/5"
              />
            </div>
            <div>
              <Label>Year</Label>
              <Input
                required
                maxLength={4}
                value={expYear}
                onChange={(e) => setExpYear(e.target.value)}
                placeholder="YYYY"
                className="border-white/10 bg-white/5"
              />
            </div>
            <div>
              <Label>CVV</Label>
              <Input
                required
                maxLength={4}
                value={cvv}
                onChange={(e) => setCvv(e.target.value)}
                placeholder="123"
                className="border-white/10 bg-white/5"
              />
            </div>
          </div>
          <div>
            <Label>Billing ZIP</Label>
            <Input
              required
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              placeholder="10001"
              className="border-white/10 bg-white/5"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full rounded-full bg-grad-primary text-primary-foreground shadow-glow"
            disabled={processing || !item}
          >
            {processing
              ? "Processing…"
              : item
                ? `Pay ${formatPrice(item?.priceCents ?? 0)}`
                : "Choose a plan"}
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
                Next charge{" "}
                {profile?.subscription_renews_at
                  ? new Date(profile?.subscription_renews_at ?? "").toLocaleDateString()
                  : "soon"}
              </div>
            </div>
            <Button
              variant="outline"
              className="rounded-full border-white/20"
              onClick={handleCancel}
            >
              Cancel subscription
            </Button>
          </div>
        )}
      </section>
    </div>
  );
  */
}

type BillingProfile = {
  subscription_tier: string | null;
  subscription_renews_at: string | null;
  subscription_status: string | null;
  authnet_subscription_id: string | null;
};

type PricingExperienceProps = {
  total: number;
  profile: BillingProfile | null | undefined;
  tiers: SubscriptionTier[];
  allTiers: SubscriptionTier[];
  packs: CreditPack[];
  selected: string;
  setSelected: Dispatch<SetStateAction<string>>;
  tab: "subs" | "packs";
  setTab: Dispatch<SetStateAction<"subs" | "packs">>;
  billingCycle: "monthly" | "yearly";
  setBillingCycle: Dispatch<SetStateAction<"monthly" | "yearly">>;
  item: CreditPack | SubscriptionTier | undefined;
  processing: boolean;
  changing: boolean;
  handlePay: (event: FormEvent<HTMLFormElement>) => void;
  handleChange: () => Promise<void>;
  handleCancel: () => Promise<void>;
  cardNumber: string;
  setCardNumber: Dispatch<SetStateAction<string>>;
  expMonth: string;
  setExpMonth: Dispatch<SetStateAction<string>>;
  expYear: string;
  setExpYear: Dispatch<SetStateAction<string>>;
  cvv: string;
  setCvv: Dispatch<SetStateAction<string>>;
  zip: string;
  setZip: Dispatch<SetStateAction<string>>;
};

function PricingExperience({
  total,
  profile,
  tiers,
  allTiers,
  packs,
  selected,
  setSelected,
  tab,
  setTab,
  billingCycle,
  setBillingCycle,
  item,
  processing,
  changing,
  handlePay,
  handleChange,
  handleCancel,
  cardNumber,
  setCardNumber,
  expMonth,
  setExpMonth,
  expYear,
  setExpYear,
  cvv,
  setCvv,
  zip,
  setZip,
}: PricingExperienceProps) {
  const activePlan = allTiers.find((tier) => tier.id === profile?.subscription_tier);
  const itemName = item?.name ?? "your plan";
  const isCurrentSelection = profile?.subscription_status === "active" && profile.subscription_tier === selected;
  const selectedTier = item && "billingMonths" in item ? item : undefined;
  const canChangeInPlace = profile?.subscription_status === "active" && tab === "subs" && Boolean(activePlan) && Boolean(selectedTier) && activePlan?.billingMonths === selectedTier?.billingMonths && !isCurrentSelection;
  const intervalChangeBlocked = profile?.subscription_status === "active" && tab === "subs" && Boolean(activePlan) && Boolean(selectedTier) && activePlan?.billingMonths !== selectedTier?.billingMonths && !isCurrentSelection;
  const changeLabel = activePlan && selectedTier && selectedTier.monthlyCredits > activePlan.monthlyCredits ? "Upgrade" : "Downgrade";

  return (
    <div className="min-h-screen bg-[#151515] text-[#f4f1f2]">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#ff6a82]">HumanCrush plans</p>
          <h1 className="mt-4 font-display text-4xl font-extrabold tracking-[-0.04em] sm:text-6xl">Create more. Keep your credits.</h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-white/55 sm:text-base">Choose a recurring plan for creator renders and companion chats, or top up once when you need a little more.</p>
          <div className="mt-7 inline-flex items-center rounded-full border border-white/10 bg-[#1d1d1f] p-1 text-sm">
            <button type="button" onClick={() => { setBillingCycle("monthly"); setSelected("sub-studio-creator"); }} className={`rounded-full px-4 py-2 font-semibold transition ${billingCycle === "monthly" ? "bg-white text-[#151515]" : "text-white/55 hover:text-white"}`}>Monthly</button>
            <button type="button" onClick={() => { setBillingCycle("yearly"); setSelected("sub-studio-creator-annual"); }} className={`rounded-full px-4 py-2 font-semibold transition ${billingCycle === "yearly" ? "bg-white text-[#151515]" : "text-white/55 hover:text-white"}`}>Yearly <span className="ml-1 rounded-full bg-[#ff4d6a] px-2 py-0.5 text-[10px] text-white">save more</span></button>
          </div>
        </header>

        <section className="mx-auto mt-10 max-w-5xl rounded-[2rem] border border-white/10 bg-[#1c1c1f] p-4 shadow-2xl sm:p-6">
          <div className="flex flex-col gap-5 border-b border-white/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/40">Your wallet</p>
              <p className="mt-2 font-display text-3xl font-extrabold">{total.toLocaleString()} <span className="text-base font-medium text-white/45">credits available</span></p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#242427] px-4 py-3 text-left text-xs text-white/55 sm:min-w-64">
              <p className="font-semibold text-white/80">Flexible by design</p>
              <p className="mt-1 leading-5">Prices and credit allowances are admin-managed. Changes here always use the live server price before checkout.</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Billing options">
            <button type="button" onClick={() => { setTab("subs"); setSelected(billingCycle === "yearly" ? "sub-studio-creator-annual" : "sub-studio-creator"); }} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === "subs" ? "bg-[#ff4d6a] text-white" : "bg-[#27272a] text-white/55 hover:text-white"}`}>Subscriptions</button>
            <button type="button" onClick={() => { setTab("packs"); setSelected("lover"); }} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === "packs" ? "bg-[#ff4d6a] text-white" : "bg-[#27272a] text-white/55 hover:text-white"}`}>Credit packs</button>
          </div>

          {tab === "subs" ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {tiers.map((tier) => {
                const current = profile?.subscription_status === "active" && profile.subscription_tier === tier.id;
                const chosen = selected === tier.id;
                return (
                  <button key={tier.id} type="button" onClick={() => setSelected(tier.id)} className={`relative flex min-h-80 flex-col rounded-3xl border p-5 text-left transition ${chosen ? "border-[#ff4d6a] bg-[#2a2025] shadow-[0_0_0_1px_rgba(255,77,106,.25)]" : "border-white/10 bg-[#222225] hover:border-white/25"}`}>
                    {tier.badge && <span className="absolute right-4 top-4 rounded-full bg-[#ff4d6a] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">{tier.badge}</span>}
                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-white/40">{tier.billingMonths === 12 ? "Annual" : "Monthly"}</span>
                    <span className="mt-4 font-display text-2xl font-extrabold">{tier.name}</span>
                    <span className="mt-1 text-sm text-white/50">{tier.tagline}</span>
                    <span className="mt-5 font-display text-4xl font-extrabold">{formatPrice(tier.priceCents)}<small className="ml-1 text-sm font-medium text-white/45">/{tier.billingMonths === 12 ? "year" : "month"}</small></span>
                    <span className="mt-2 text-sm font-semibold text-[#ff91a2]">{tier.monthlyCredits.toLocaleString()} credits included</span>
                    <span className="mt-4 space-y-2 text-sm text-white/65">{tier.perks.slice(0, 4).map((perk) => <span key={perk} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#ff6a82]" />{perk}</span>)}</span>
                    <span className="mt-auto pt-5 text-xs font-semibold text-white/45">{current ? "Current plan" : chosen ? "Selected" : "Choose plan"}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              {packs.map((pack) => <button key={pack.id} type="button" onClick={() => setSelected(pack.id)} className={`relative rounded-3xl border p-5 text-left transition ${selected === pack.id ? "border-[#ff4d6a] bg-[#2a2025]" : "border-white/10 bg-[#222225] hover:border-white/25"}`}>
                {pack.badge && <span className="absolute right-4 top-4 rounded-full bg-[#ff4d6a] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">{pack.badge}</span>}
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-white/40">One-time</span>
                <span className="mt-4 block font-display text-2xl font-extrabold">{pack.name}</span>
                <span className="mt-5 block font-display text-4xl font-extrabold">{formatPrice(pack.priceCents)}</span>
                <span className="mt-2 block text-sm text-white/55">{pack.credits.toLocaleString()} credits · {pack.perMsgCents.toFixed(1)}¢ each</span>
              </button>)}
            </div>
          )}
        </section>

        <section className="mx-auto mt-6 grid max-w-5xl gap-6 lg:grid-cols-[1fr_.82fr]">
          <form onSubmit={handlePay} className="rounded-[2rem] border border-white/10 bg-[#1c1c1f] p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/40">Checkout</p><h2 className="mt-2 font-display text-2xl font-extrabold">{isCurrentSelection ? "You’re already on this plan" : `Continue with ${itemName}`}</h2></div><span className="rounded-full bg-[#27272a] px-3 py-1.5 text-xs font-semibold text-white/60">Authorize.Net</span></div>
            <p className="mt-3 text-sm leading-5 text-white/50">Secure card tokenization happens in your browser. HumanCrush never receives the full card number.</p>
            <div className="mt-6 space-y-4">
              <div><Label>Card number</Label><Input inputMode="numeric" autoComplete="cc-number" required value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="4111 1111 1111 1111" className="mt-1 border-white/10 bg-[#252529]" /></div>
              <div className="grid grid-cols-3 gap-3"><div><Label>Month</Label><Input required maxLength={2} value={expMonth} onChange={(e) => setExpMonth(e.target.value)} placeholder="MM" className="mt-1 border-white/10 bg-[#252529]" /></div><div><Label>Year</Label><Input required maxLength={4} value={expYear} onChange={(e) => setExpYear(e.target.value)} placeholder="YYYY" className="mt-1 border-white/10 bg-[#252529]" /></div><div><Label>CVV</Label><Input required maxLength={4} value={cvv} onChange={(e) => setCvv(e.target.value)} placeholder="123" className="mt-1 border-white/10 bg-[#252529]" /></div></div>
              <div><Label>Billing ZIP</Label><Input required value={zip} onChange={(e) => setZip(e.target.value)} placeholder="10001" className="mt-1 border-white/10 bg-[#252529]" /></div>
              <Button type={canChangeInPlace ? "button" : "submit"} onClick={canChangeInPlace ? handleChange : undefined} size="lg" className="h-12 w-full rounded-xl bg-[#ff4d6a] text-white hover:bg-[#ff607b]" disabled={processing || changing || !item || isCurrentSelection || intervalChangeBlocked}>{processing || changing ? "Updating…" : isCurrentSelection ? "Current plan" : intervalChangeBlocked ? "Cancel current plan to switch interval" : canChangeInPlace ? `${changeLabel} to ${itemName}` : item ? `Pay ${formatPrice(item.priceCents)}` : "Choose a plan"}</Button>
            </div>
            <p className="mt-4 text-center text-xs leading-5 text-white/40">Subscriptions renew automatically at the displayed interval. Cancel any time; credits already granted stay on your account.</p>
          </form>

          <aside className="rounded-[2rem] border border-white/10 bg-[#1c1c1f] p-5 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/40">Manage subscription</p>
            {profile?.subscription_status === "active" ? <><h2 className="mt-3 font-display text-2xl font-extrabold">{activePlan?.name ?? profile.subscription_tier}</h2><p className="mt-2 text-sm leading-5 text-white/50">Next renewal {profile.subscription_renews_at ? new Date(profile.subscription_renews_at).toLocaleDateString() : "scheduled"}.</p><p className="mt-4 rounded-2xl bg-[#252529] p-4 text-sm leading-5 text-white/60">To change billing, select a different plan and complete checkout. Your current plan remains active until you cancel it.</p><Button type="button" variant="outline" onClick={handleCancel} className="mt-5 h-11 w-full rounded-xl border-white/15 bg-transparent text-white hover:bg-white/5">Cancel subscription</Button></> : <><h2 className="mt-3 font-display text-2xl font-extrabold">No active subscription</h2><p className="mt-2 text-sm leading-5 text-white/50">Pick a plan above to unlock creator credits, identity lock, and eligible social or 18+ generation.</p><div className="mt-5 rounded-2xl bg-[#252529] p-4 text-sm leading-5 text-white/60">All fictional companions are adults. 18+ creation requires age confirmation and an eligible creator plan.</div></>}
          </aside>
        </section>
      </main>
    </div>
  );
}
