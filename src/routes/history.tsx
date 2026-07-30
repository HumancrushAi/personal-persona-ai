import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/credit-packs";
import { SiteHeader } from "@/components/SiteHeader";
import { Coins, CreditCard } from "lucide-react";

export const Route = createFileRoute("/history")({
  ssr: false,
  head: () => ({ meta: [{ title: "History — HumanCrush.com" }] }),
  component: HistoryPage,
});

const REASON_LABELS: Record<string, string> = {
  // Current reason codes
  chat_debit: "Message sent",
  image_debit: "AI selfie",
  video_debit: "AI video",
  voice_note: "Voice note",
  purchase_credit: "Credit pack",
  subscription_credit: "Subscription credits",
  refund_credit: "Refund",
  admin_credit: "Credits added by support",
  tip: "Tip sent",
  private_show: "Private show",
  // Legacy codes kept so old ledger rows still render nicely
  chat_message: "Message sent",
  selfie: "AI selfie",
  pack_purchase: "Credit pack",
  subscription_grant: "Subscription — first month",
  recurring_grant: "Subscription renewal",
};

function HistoryPage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth" });
      else setUserId(data.user.id);
    });
  }, []);

  const { data: payments } = useQuery({
    enabled: !!userId,
    queryKey: ["payments", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id, amount_cents, credits_added, pack_name, status, created_at")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: ledger } = useQuery({
    enabled: !!userId,
    queryKey: ["ledger", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_ledger")
        .select("id, delta, reason, balance_after, created_at")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-3xl px-6 py-8 pb-20">
        <h1 className="font-display text-4xl font-semibold md:text-5xl">History</h1>

        {/* Payments */}
        <div className="mt-8 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <h2 className="font-display text-2xl font-semibold">Payments</h2>
        </div>
        <div className="glass mt-3 rounded-3xl p-2">
          {!payments?.length && (
            <p className="p-6 text-center text-sm text-muted-foreground">No payments yet.</p>
          )}
          {payments?.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between border-b border-white/5 px-4 py-3 last:border-0"
            >
              <div>
                <div className="font-medium">{t.pack_name}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(t.created_at).toLocaleString()}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatPrice(t.amount_cents)}</div>
                <span
                  className={`text-xs ${t.status === "completed" ? "text-emerald-400" : t.status === "failed" ? "text-red-400" : "text-muted-foreground"}`}
                >
                  {t.status}
                  {t.credits_added ? ` · +${t.credits_added} credits` : ""}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Credit activity */}
        <div className="mt-10 flex items-center gap-2">
          <Coins className="h-5 w-5 text-primary" />
          <h2 className="font-display text-2xl font-semibold">Credit activity</h2>
        </div>
        <div className="glass mt-3 rounded-3xl p-2">
          {!ledger?.length && (
            <p className="p-6 text-center text-sm text-muted-foreground">No credit activity yet.</p>
          )}
          {ledger?.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between border-b border-white/5 px-4 py-3 last:border-0"
            >
              <div>
                <div className="font-medium">{REASON_LABELS[l.reason] ?? l.reason}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(l.created_at).toLocaleString()}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`font-semibold ${l.delta >= 0 ? "text-emerald-400" : "text-foreground"}`}
                >
                  {l.delta >= 0 ? "+" : ""}
                  {l.delta}
                </div>
                <div className="text-xs text-muted-foreground">balance {l.balance_after}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
