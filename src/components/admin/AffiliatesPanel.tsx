// Admin screen for the affiliate program.
//
// The job this screen has to do is settle a deal: who sent traffic, what it
// turned into, and what we owe them. So the table leads with the two numbers a
// payout conversation is actually about — revenue driven and commission owed —
// and clicks are shown last, because a click count is a sanity check and never
// the thing being paid for.

import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Link2, Pencil, Plus, RefreshCw, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  adminAffiliateDetail,
  adminListAffiliates,
  adminSetCommissionStatus,
  adminUpsertAffiliate,
  adminVoidCommission,
} from "@/lib/affiliates.functions";
import { formatCents, normalizeAffiliateCode } from "@/lib/affiliates";

type Affiliate = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  commission_pct: number;
  status: string;
  notes: string | null;
  pitch: string | null;
  created_at: string;
  clicks: number;
  signups: number;
  grossCents: number;
  owedCents: number;
  paidCents: number;
};

type Commission = {
  id: string;
  email: string | null;
  gross_cents: number;
  commission_pct: number;
  commission_cents: number;
  status: string;
  created_at: string;
};

const BLANK = { code: "", name: "", email: "", commissionPct: 20, notes: "", status: "active" };

function siteOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "https://humancrush.com";
}

export function AffiliatesPanel() {
  const list = useServerFn(adminListAffiliates);
  const upsert = useServerFn(adminUpsertAffiliate);
  const detail = useServerFn(adminAffiliateDetail);
  const setStatus = useServerFn(adminSetCommissionStatus);
  const voidCommission = useServerFn(adminVoidCommission);

  const [rows, setRows] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<(typeof BLANK & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res: any = await list({} as any);
      setRows(res.affiliates ?? []);
    } catch (e: any) {
      // The most likely cause by far is the migration not having run yet, and
      // the raw Postgres error for that says nothing an admin can act on.
      toast.error(e?.message ?? "Could not load affiliates");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing || saving) return;
    const code = normalizeAffiliateCode(editing.code);
    if (!code) {
      toast.error("Code must be 2-32 characters: letters, numbers, - or _");
      return;
    }
    if (!editing.name.trim()) {
      toast.error("Give the affiliate a name so you know who this is");
      return;
    }
    setSaving(true);
    try {
      await upsert({
        data: {
          id: editing.id,
          code,
          name: editing.name.trim(),
          email: editing.email.trim(),
          commissionPct: Number(editing.commissionPct),
          status: editing.status as "pending" | "active" | "paused" | "rejected",
          notes: editing.notes.trim(),
        },
      });
      toast.success(editing.id ? "Affiliate updated" : "Affiliate created");
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setCommissions([]);
    try {
      const res: any = await detail({ data: { affiliateId: id } });
      setCommissions(res.commissions ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load earnings");
    }
  }

  async function markPaid(id: string) {
    try {
      // Two steps because the states are a sequence, and a payout run should
      // sweep up everything that is genuinely outstanding — both what was
      // approved and what has only been accrued — while leaving voided rows
      // exactly where they are.
      const a: any = await setStatus({ data: { affiliateId: id, from: "pending", to: "paid" } });
      const b: any = await setStatus({ data: { affiliateId: id, from: "approved", to: "paid" } });
      const moved = (a?.moved ?? 0) + (b?.moved ?? 0);
      toast.success(moved ? `Marked ${moved} commission${moved === 1 ? "" : "s"} paid` : "Nothing outstanding");
      await load();
      if (openId === id) {
        const res: any = await detail({ data: { affiliateId: id } });
        setCommissions(res.commissions ?? []);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update");
    }
  }

  // For what the webhook cannot see: a chargeback (Authorize.Net sends no
  // event for one) and a partial refund (left for a person on purpose).
  async function voidOne(affiliateId: string, c: Commission) {
    if (
      !window.confirm(
        `Void this ${formatCents(c.commission_cents)} commission? Use this for a chargeback or refund. It can't be undone from here.`,
      )
    )
      return;
    try {
      await voidCommission({ data: { commissionId: c.id } });
      toast.success("Commission voided");
      await load();
      const res: any = await detail({ data: { affiliateId } });
      setCommissions(res.commissions ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not void");
    }
  }

  function copyLink(code: string) {
    const url = `${siteOrigin()}/?ref=${code}`;
    navigator.clipboard?.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error(`Copy failed — the link is ${url}`),
    );
  }

  // Applications go to the top and are visually separated. They are the only
  // rows in this table that need a decision, and burying a new application
  // underneath twenty live affiliates sorted by date is how someone waits a
  // fortnight for an answer.
  const pending = rows.filter((r) => r.status === "pending");
  const settled = rows.filter((r) => r.status !== "pending");
  const totalOwed = rows.reduce((t, r) => t + r.owedCents, 0);

  async function decide(a: Affiliate, status: "active" | "rejected") {
    try {
      const res: any = await upsert({
        data: {
          id: a.id,
          code: a.code,
          name: a.name,
          email: a.email ?? "",
          commissionPct: a.commission_pct,
          status,
          notes: a.notes ?? "",
        },
      });
      // Say whether the approval email actually went. It is best-effort on the
      // server, and "approved" alone would let an admin assume the affiliate
      // has their link when a missing RESEND_API_KEY meant they were told
      // nothing.
      if (status === "active") {
        const approved = `${a.name} approved at ${a.commission_pct}%`;
        if (res?.emailed) toast.success(`${approved} — link emailed`);
        else toast.warning(`${approved}, but no email was sent — send them their link`);
      } else {
        toast.success("Rejected");
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update");
    }
  }

  return (
    <section className="glass rounded-2xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg">
          <Users className="h-5 w-5 text-primary" /> Affiliates
          {totalOwed > 0 && (
            <Badge className="bg-primary text-primary-foreground">
              {formatCents(totalOwed)} owed
            </Badge>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setEditing({ ...BLANK })} className="text-xs">
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New affiliate
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="text-xs">
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {editing && (
        <div className="mb-4 rounded-xl border border-border/60 bg-background/40 p-4">
          <h3 className="mb-3 text-sm font-medium">
            {editing.id ? `Editing ${editing.name}` : "New affiliate"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Who this is"
              />
            </div>
            <div>
              <Label className="text-xs">Tracking code</Label>
              <Input
                value={editing.code}
                onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                placeholder="garyb"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Their link becomes {siteOrigin()}/?ref={normalizeAffiliateCode(editing.code) ?? "…"}
              </p>
            </div>
            <div>
              <Label className="text-xs">Email (for payouts)</Label>
              <Input
                value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                placeholder="optional"
              />
            </div>
            <div>
              <Label className="text-xs">Commission %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={editing.commissionPct}
                onChange={(e) =>
                  setEditing({ ...editing, commissionPct: Number(e.target.value) })
                }
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Set per affiliate. Changing it only affects future sales — commissions already
                earned keep the rate they were earned at.
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Notes</Label>
              <Textarea
                rows={2}
                value={editing.notes}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                placeholder="What was agreed, how they promote, payout details…"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            {editing.id && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto text-xs"
                onClick={() =>
                  setEditing({
                    ...editing,
                    status: editing.status === "active" ? "paused" : "active",
                  })
                }
              >
                {editing.status === "active" ? "Pause" : "Reactivate"}
              </Button>
            )}
          </div>
        </div>
      )}

      {loading && rows.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      )}

      {!loading && rows.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No affiliates yet. Create one and send them their link — anyone who arrives on it and
          signs up is theirs, and a share of everything they ever spend is tracked here.
        </p>
      )}

      {pending.length > 0 && (
        <div className="mb-4 space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-primary">
            {pending.length} application{pending.length === 1 ? "" : "s"} waiting
          </h3>
          {pending.map((a) => (
            <div key={a.id} className="rounded-xl border border-primary/40 bg-primary/5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.name}</span>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {a.code}
                </Badge>
                <span className="text-xs text-muted-foreground">{a.email}</span>
              </div>
              {a.pitch && (
                <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{a.pitch}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* Set the rate BEFORE approving: approving at the default and
                    fixing it afterwards means the first sales accrue at the
                    wrong percentage, and those rows keep the rate they were
                    earned at. */}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() =>
                    setEditing({
                      id: a.id,
                      code: a.code,
                      name: a.name,
                      email: a.email ?? "",
                      commissionPct: a.commission_pct,
                      notes: a.notes ?? "",
                      status: "pending",
                    })
                  }
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Set rate ({a.commission_pct}%)
                </Button>
                <Button size="sm" className="text-xs" onClick={() => decide(a, "active")}>
                  Approve at {a.commission_pct}%
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-muted-foreground"
                  onClick={() => decide(a, "rejected")}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {settled.map((a) => (
          <div key={a.id} className="rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{a.name}</span>
              <Badge variant="outline" className="font-mono text-[11px]">
                {a.code}
              </Badge>
              <Badge variant="outline" className="text-[11px]">
                {a.commission_pct}%
              </Badge>
              {a.status !== "active" && (
                <Badge variant="outline" className="text-[11px] text-muted-foreground">
                  paused
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => copyLink(a.code)} title="Copy link">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Edit"
                  onClick={() =>
                    setEditing({
                      id: a.id,
                      code: a.code,
                      name: a.name,
                      email: a.email ?? "",
                      commissionPct: a.commission_pct,
                      notes: a.notes ?? "",
                      status: a.status,
                    })
                  }
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Revenue and commission first: these are what a payout
                conversation is about. Clicks last — it is a sanity check. */}
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Stat label="Revenue driven" value={formatCents(a.grossCents)} />
              <Stat label="Owed" value={formatCents(a.owedCents)} strong={a.owedCents > 0} />
              <Stat label="Signups" value={String(a.signups)} />
              <Stat label="Clicks" value={String(a.clicks)} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => openDetail(a.id)}>
                <Link2 className="mr-1.5 h-3.5 w-3.5" />
                {openId === a.id ? "Hide earnings" : "Earnings"}
              </Button>
              {a.owedCents > 0 && (
                <Button size="sm" variant="outline" className="text-xs" onClick={() => markPaid(a.id)}>
                  Mark {formatCents(a.owedCents)} paid
                </Button>
              )}
              {a.paidCents > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {formatCents(a.paidCents)} paid to date
                </span>
              )}
            </div>

            {openId === a.id && (
              <div className="mt-3 overflow-x-auto">
                {commissions.length === 0 ? (
                  <p className="py-3 text-xs text-muted-foreground">
                    Nothing earned yet. A commission appears here the moment a referred user pays.
                  </p>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-3 font-normal">When</th>
                        <th className="py-1 pr-3 font-normal">Customer</th>
                        <th className="py-1 pr-3 font-normal">Sale</th>
                        <th className="py-1 pr-3 font-normal">Rate</th>
                        <th className="py-1 pr-3 font-normal">Commission</th>
                        <th className="py-1 pr-3 font-normal">Status</th>
                        <th className="py-1 font-normal">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {commissions.map((c) => (
                        <tr key={c.id} className="border-t border-border/40">
                          <td className="py-1 pr-3 whitespace-nowrap">
                            {new Date(c.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-1 pr-3">{c.email ?? "—"}</td>
                          <td className="py-1 pr-3">{formatCents(c.gross_cents)}</td>
                          <td className="py-1 pr-3">{c.commission_pct}%</td>
                          <td className="py-1 pr-3">{formatCents(c.commission_cents)}</td>
                          <td className="py-1 pr-3">{c.status}</td>
                          <td className="py-1 text-right">
                            {(c.status === "pending" || c.status === "approved") && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[11px] text-muted-foreground"
                                onClick={() => voidOne(a.id, c)}
                              >
                                Void
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-background/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={strong ? "font-semibold text-primary" : "font-medium"}>{value}</div>
    </div>
  );
}
