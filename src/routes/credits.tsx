import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Heart, Check } from "lucide-react";
import { CREDIT_PACKS, formatPrice } from "@/lib/credit-packs";
import { purchaseCredits } from "@/lib/payments.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/credits")({
  ssr: false,
  head: () => ({ meta: [{ title: "Credits — Aurelia" }] }),
  component: CreditsPage,
});

declare global {
  interface Window {
    Accept?: {
      dispatchData: (
        secureData: any,
        cb: (resp: any) => void
      ) => void;
    };
  }
}

const ACCEPT_JS_URL = "https://js.authorize.net/v1/Accept.js"; // LIVE

function CreditsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const purchase = useServerFn(purchaseCredits);

  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => {
    if (!data.user) navigate({ to: "/auth" });
    else setUserId(data.user.id);
  }); }, []);

  const { data: balance } = useQuery({
    enabled: !!userId,
    queryKey: ["balance"],
    queryFn: async () => {
      const { data } = await supabase.from("credit_balances")
        .select("free_messages_remaining, paid_credits").eq("user_id", userId!).maybeSingle();
      return data;
    },
  });

  // load Accept.js
  useEffect(() => {
    if (document.querySelector(`script[src="${ACCEPT_JS_URL}"]`)) return;
    const s = document.createElement("script");
    s.src = ACCEPT_JS_URL;
    s.async = true;
    document.head.appendChild(s);
  }, []);

  const [selected, setSelected] = useState<string>("lover");
  const [cardNumber, setCardNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvv, setCvv] = useState("");
  const [zip, setZip] = useState("");
  const [processing, setProcessing] = useState(false);

  const clientKey = import.meta.env.VITE_AUTHORIZE_NET_CLIENT_KEY as string | undefined;
  const apiLoginId = import.meta.env.VITE_AUTHORIZE_NET_API_LOGIN_ID as string | undefined;

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!window.Accept) { toast.error("Payment system not loaded yet, try again."); return; }
    if (!clientKey || !apiLoginId) { toast.error("Payment not configured. Add VITE_AUTHORIZE_NET_CLIENT_KEY and VITE_AUTHORIZE_NET_API_LOGIN_ID."); return; }
    setProcessing(true);
    const secureData = {
      authData: { clientKey, apiLoginID: apiLoginId },
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
        const m = resp.messages.message?.[0]?.text ?? "Card tokenization failed";
        toast.error(m);
        setProcessing(false);
        return;
      }
      try {
        const result = await purchase({
          data: {
            packId: selected,
            opaqueDataDescriptor: resp.opaqueData.dataDescriptor,
            opaqueDataValue: resp.opaqueData.dataValue,
          },
        });
        toast.success(`Added ${CREDIT_PACKS.find(p=>p.id===selected)?.credits} credits!`);
        setCardNumber(""); setCvv(""); setExpMonth(""); setExpYear(""); setZip("");
        qc.invalidateQueries({ queryKey: ["balance"] });
      } catch (err: any) {
        toast.error(err.message ?? "Payment failed");
      } finally {
        setProcessing(false);
      }
    });
  }

  const total = (balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
        <Button asChild variant="ghost" className="rounded-full"><Link to="/me"><ArrowLeft className="mr-1 h-4 w-4" /> Back</Link></Button>
        <Link to="/" className="flex items-center gap-2">
          <Heart className="h-5 w-5 fill-primary text-primary" />
          <span className="font-display text-xl font-semibold">Aurelia</span>
        </Link>
      </header>

      <section className="mx-auto max-w-4xl px-6 pb-16">
        <h1 className="font-display text-4xl font-semibold">Credits</h1>
        <p className="mt-2 text-muted-foreground">You have <strong>{total}</strong> messages remaining
          {balance && <> ({balance.free_messages_remaining} free + {balance.paid_credits} paid)</>}.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {CREDIT_PACKS.map(p => (
            <button key={p.id} onClick={() => setSelected(p.id)}
              className={`relative rounded-3xl border-2 p-5 text-left transition ${selected===p.id ? "border-primary bg-card shadow-md" : "border-border bg-card/60 hover:border-primary/40"}`}>
              {p.badge && <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-medium text-primary-foreground">{p.badge}</span>}
              <div className="font-display text-xl font-semibold">{p.name}</div>
              <div className="mt-1 text-3xl font-bold">{formatPrice(p.priceCents)}</div>
              <div className="mt-1 text-sm text-muted-foreground">{p.credits} messages · {p.perMsgCents.toFixed(1)}¢ each</div>
              {selected===p.id && <Check className="absolute right-4 top-4 h-5 w-5 text-primary" />}
            </button>
          ))}
        </div>

        <form onSubmit={handlePay} className="mt-8 space-y-4 rounded-3xl border bg-card p-6 shadow-sm">
          <h2 className="font-display text-2xl font-semibold">Payment</h2>
          <p className="text-xs text-muted-foreground">Secured by Authorize.Net. Card details never touch our server.</p>
          <div>
            <Label>Card number</Label>
            <Input inputMode="numeric" autoComplete="cc-number" required value={cardNumber} onChange={e=>setCardNumber(e.target.value)} placeholder="4111 1111 1111 1111" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Month</Label><Input required maxLength={2} value={expMonth} onChange={e=>setExpMonth(e.target.value)} placeholder="MM" /></div>
            <div><Label>Year</Label><Input required maxLength={4} value={expYear} onChange={e=>setExpYear(e.target.value)} placeholder="YYYY" /></div>
            <div><Label>CVV</Label><Input required maxLength={4} value={cvv} onChange={e=>setCvv(e.target.value)} placeholder="123" /></div>
          </div>
          <div>
            <Label>Billing ZIP</Label>
            <Input required value={zip} onChange={e=>setZip(e.target.value)} placeholder="10001" />
          </div>
          <Button type="submit" size="lg" className="w-full rounded-full" disabled={processing}>
            {processing ? "Processing…" : `Pay ${formatPrice(CREDIT_PACKS.find(p=>p.id===selected)!.priceCents)}`}
          </Button>
        </form>
      </section>
    </div>
  );
}
