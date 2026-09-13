// What an affiliate sees. The half of the program that was missing.
//
// One route with four states, because an affiliate and a would-be affiliate
// arrive at the same URL and sending them to different pages means telling
// people which link to use:
//
//   not an affiliate  → the pitch, and a form to apply
//   pending           → we have it, sit tight
//   active            → their link and their numbers
//   paused / rejected → said plainly, not as a dashboard full of zeroes

import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, Loader2, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { applyForAffiliate, myAffiliate } from "@/lib/affiliates.functions";
import { formatCents, normalizeAffiliateCode } from "@/lib/affiliates";

export const Route = createFileRoute("/affiliate")({
  head: () => ({
    meta: [
      { title: "Affiliate program — HumanCrush.com" },
      {
        name: "description",
        content: "Earn a share of the revenue from everyone you send to HumanCrush.",
      },
    ],
  }),
  // ssr:false is load-bearing, not a preference. The guard below runs against
  // the BROWSER Supabase client, which has no session during server rendering —
  // so with SSR on, beforeLoad sees "signed out" for everybody and bounces every
  // signed-in affiliate to the sign-in page. _authenticated/route.tsx carries
  // the same flag for the same reason, and admin.tsx has a comment explaining
  // why it gave up on a beforeLoad guard entirely.
  ssr: false,
  beforeLoad: async () => {
    // Signed out, there is nothing on this page to show: every state depends on
    // who is asking. Sent to sign-in rather than shown an empty shell.
    // getUser rather than getSession — getSession will hand back a cached,
    // possibly expired session without checking it.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { mode: "signin" } });
  },
  component: AffiliatePage,
});

type Data = Awaited<ReturnType<typeof myAffiliate>>;

function AffiliatePage() {
  const load = useServerFn(myAffiliate);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      setData((await load()) as Data);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load your affiliate account");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const aff = data?.affiliate ?? null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 pb-28">
      <header className="mb-8">
        <h1 className="flex items-center gap-2 font-display text-3xl">
          <TrendingUp className="h-7 w-7 text-primary" /> Affiliate program
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Send people to HumanCrush and earn a share of everything they ever spend.
        </p>
      </header>

      {!aff && <ApplyForm onDone={refresh} />}
      {aff?.status === "pending" && <Pending />}
      {aff?.status === "rejected" && <Rejected />}
      {aff?.status === "paused" && <Paused />}
      {aff?.status === "active" && data && <Dashboard data={data} />}

      <div className="mt-10 text-center">
        <Link to="/me" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to my account
        </Link>
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="glass rounded-2xl p-6">{children}</section>;
}

function Pending() {
  return (
    <Panel>
      <h2 className="font-display text-xl">Application received</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We're reviewing it. We'll email the address on your account when it's approved, and your
        link and earnings will appear on this page either way. Nothing is tracked until then, so
        hold off on sharing anything yet.
      </p>
    </Panel>
  );
}

function Rejected() {
  return (
    <Panel>
      <h2 className="font-display text-xl">Not approved</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We couldn't approve this application. If you think that's a mistake, contact support and
        we'll take another look.
      </p>
    </Panel>
  );
}

function Paused() {
  return (
    <Panel>
      <h2 className="font-display text-xl">Your account is paused</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your link isn't tracking new signups right now and no new commission is building up.
        Anything already earned is still owed to you. Contact support to pick it back up.
      </p>
    </Panel>
  );
}

function Dashboard({ data }: { data: Data }) {
  const aff = data.affiliate!;
  const stats = data.stats;
  const [copied, setCopied] = useState(false);

  const origin = typeof window === "undefined" ? "https://humancrush.com" : window.location.origin;
  const link = `${origin}/?ref=${aff.code}`;

  function copy() {
    navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => toast.error("Copy failed — select the link and copy it manually"),
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="font-display text-xl">Your link</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Anyone who arrives on this and signs up is yours, and you earn{" "}
          <span className="font-semibold text-foreground">{aff.pct}%</span> of everything they spend
          — not just their first purchase.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg bg-background/60 px-3 py-2 text-sm">
            {link}
          </code>
          <Button size="sm" onClick={copy}>
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          It works on any page — add <code>?ref={aff.code}</code> to any HumanCrush link and it
          still counts.
        </p>
      </Panel>

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Owed first. It is the number an affiliate opens this page for. */}
            <Stat label="Owed to you" value={formatCents(stats.owedCents)} accent />
            <Stat label="Paid out" value={formatCents(stats.paidCents)} />
            <Stat label="Signups" value={String(stats.signups)} />
            <Stat label="Clicks" value={String(stats.clicks)} />
          </div>

          <Panel>
            <h2 className="font-display text-xl">Earnings</h2>
            {data.earnings.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Nothing yet. A commission appears the moment someone who came through your link
                buys credits or subscribes.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1.5 pr-4 font-normal">Date</th>
                      <th className="py-1.5 pr-4 font-normal">Sale</th>
                      <th className="py-1.5 pr-4 font-normal">Rate</th>
                      <th className="py-1.5 pr-4 font-normal">You earned</th>
                      <th className="py-1.5 font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.earnings.map((e) => (
                      <tr key={e.id} className="border-t border-border/40">
                        <td className="py-1.5 pr-4 whitespace-nowrap">
                          {new Date(e.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-1.5 pr-4">{formatCents(e.grossCents)}</td>
                        <td className="py-1.5 pr-4">{e.pct}%</td>
                        <td className="py-1.5 pr-4 font-medium">
                          {formatCents(e.commissionCents)}
                        </td>
                        <td className="py-1.5 text-muted-foreground">{e.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Payouts are arranged by email to {data.email}. If a purchase is refunded before its
              commission is paid out, that commission is voided.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="glass rounded-xl px-3 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function ApplyForm({ onDone }: { onDone: () => void }) {
  const apply = useServerFn(applyForAffiliate);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [pitch, setPitch] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = normalizeAffiliateCode(code);
  const origin = typeof window === "undefined" ? "https://humancrush.com" : window.location.origin;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await apply({ data: { name: name.trim(), code: code.trim(), pitch: pitch.trim() } });
      toast.success("Application sent — we'll be in touch");
      onDone();
    } catch (err: any) {
      toast.error(err?.message ?? "Could not send your application");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <h2 className="font-display text-xl">Apply</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        You get a tracking link. Anyone who arrives on it and signs up is attributed to you for
        life, and you earn a percentage of everything they ever spend — credits and subscriptions,
        first purchase and every one after. Rates are agreed per person depending on the traffic
        you bring.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <div>
          <Label className="text-xs">Your name or brand</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="How we should refer to you" required />
        </div>
        <div>
          <Label className="text-xs">Preferred tracking code</Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="yourname"
            required
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Your link would be {origin}/?ref={preview ?? "…"}
            {code && !preview && " — letters, numbers, - and _ only, 2-32 characters"}
          </p>
        </div>
        <div>
          <Label className="text-xs">How will you promote us?</Label>
          <Textarea
            rows={4}
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            placeholder="Where your traffic comes from, roughly how much of it, and what you'd be doing."
            required
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            This is what your rate gets decided on, so it's worth being specific.
          </p>
        </div>
        <Button type="submit" disabled={busy} className="bg-grad-primary text-primary-foreground">
          {busy ? "Sending…" : "Apply"}
        </Button>
      </form>
    </Panel>
  );
}
