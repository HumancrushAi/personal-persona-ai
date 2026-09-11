// Server functions for the affiliate program.
//
// Two public ones (a visitor landing on a ?ref= link, and a signed-in user
// being attributed to whoever sent them) and the admin surface.
//
// Nothing here calculates what is owed. Commission is accrued by a trigger on
// `transactions` — see supabase/migrations/20260911000000_affiliates.sql for
// why. These functions create affiliates, attribute users and report; the money
// is the database's job.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { normalizeAffiliateCode } from "./affiliates";

// The four affiliate tables are newer than the generated
// src/integrations/supabase/types.ts, so the typed client rejects the names.
// Same handle and same reason as supportDb in support.functions.ts:
// regenerating types needs a reachable project. Re-run the generation and this
// can go.
async function affDb(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// Because affDb is untyped, every row read back is `any`. These are written out
// so the reporting arithmetic below is still checked — a typo in a column name
// would otherwise silently sum undefined and report that an affiliate is owed
// nothing, which is exactly the kind of wrong number nobody reports as a bug.
type AffiliateRow = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  commission_pct: number;
  status: string;
  notes: string | null;
  created_at: string;
};
type CommissionRow = {
  affiliate_id: string;
  gross_cents: number;
  commission_cents: number;
  status: string;
};

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

// ── Public: a visitor arrives on a ?ref= link ───────────────────────────────

/**
 * Record the landing. No auth: this is a signed-out visitor on the front page.
 *
 * Returns { ok } and never throws for a bad code. An unknown or malformed ?ref=
 * is not an error the visitor should ever see — they came here to look at the
 * site, and a typo in someone else's marketing link must not put an error toast
 * in front of them. It is logged as a miss and that is all.
 */
export const trackAffiliateVisit = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        code: z.string().max(64),
        path: z.string().max(512).optional(),
        referrer: z.string().max(512).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const code = normalizeAffiliateCode(data.code);
    if (!code) return { ok: false };

    const supabaseAdmin = await affDb();
    const { data: aff } = await supabaseAdmin
      .from("affiliates")
      .select("id")
      .eq("code", code)
      .eq("status", "active")
      .maybeSingle();
    if (!aff) return { ok: false };

    await supabaseAdmin.from("affiliate_clicks").insert({
      affiliate_id: aff.id,
      landing_path: data.path ?? null,
      referrer: data.referrer ?? null,
    });

    return { ok: true };
  });

/**
 * Attribute the signed-in user to an affiliate, once, for life.
 *
 * Called on first sign-in after landing on a ?ref= link. The click and the
 * signup can be days apart and can span an email confirmation round trip, which
 * is why the code is carried in the browser rather than in a server session.
 *
 * FIRST touch: a user who already has a referral keeps it. Two guards say so —
 * the explicit check below and the UNIQUE on affiliate_referrals.user_id — and
 * the second one is what actually holds under a double-submit, because two
 * concurrent calls would both pass the first.
 *
 * An affiliate can never claim themselves: self-referral is how this kind of
 * scheme gets farmed, and it costs one comparison to close.
 */
export const claimReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string().max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const code = normalizeAffiliateCode(data.code);
    if (!code) return { attributed: false, reason: "bad_code" as const };

    const supabaseAdmin = await affDb();

    const { data: existing } = await supabaseAdmin
      .from("affiliate_referrals")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) return { attributed: false, reason: "already_referred" as const };

    const { data: aff } = await supabaseAdmin
      .from("affiliates")
      .select("id, user_id")
      .eq("code", code)
      .eq("status", "active")
      .maybeSingle();
    if (!aff) return { attributed: false, reason: "unknown_code" as const };
    if (aff.user_id === userId) return { attributed: false, reason: "self_referral" as const };

    const { error } = await supabaseAdmin
      .from("affiliate_referrals")
      .insert({ affiliate_id: aff.id, user_id: userId });

    // A unique violation here means another request won the race and the user
    // is attributed — to the same affiliate. Not an error.
    if (error && !/duplicate key|unique/i.test(error.message)) throw new Error(error.message);

    return { attributed: !error, reason: "ok" as const };
  });

// ── Admin ───────────────────────────────────────────────────────────────────

export const adminListAffiliates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const supabaseAdmin = await affDb();

    const [{ data: affiliates }, { data: clicks }, { data: referrals }, { data: commissions }] =
      await Promise.all([
        supabaseAdmin
          .from("affiliates")
          .select("id, code, name, email, commission_pct, status, notes, created_at")
          .order("created_at", { ascending: false }),
        supabaseAdmin.from("affiliate_clicks").select("affiliate_id"),
        supabaseAdmin.from("affiliate_referrals").select("affiliate_id"),
        supabaseAdmin
          .from("affiliate_commissions")
          .select("affiliate_id, gross_cents, commission_cents, status"),
      ]);

    // Counted in memory rather than with four grouped queries. This table is
    // tens of rows and clicks are the only one that grows quickly; when it gets
    // big enough to matter this becomes a view, not a cleverer query here.
    const countBy = (rows: { affiliate_id: string }[] | null, id: string) =>
      (rows ?? []).filter((r) => r.affiliate_id === id).length;

    const rows = ((affiliates ?? []) as AffiliateRow[]).map((a) => {
      const mine = ((commissions ?? []) as CommissionRow[]).filter((c) => c.affiliate_id === a.id);
      const sum = (pred: (c: CommissionRow) => boolean, key: "gross_cents" | "commission_cents") =>
        mine.filter(pred).reduce((t, c) => t + (c[key] ?? 0), 0);

      return {
        ...a,
        clicks: countBy(clicks, a.id),
        signups: countBy(referrals, a.id),
        // Everything except voided rows counts as revenue this affiliate drove.
        grossCents: sum((c) => c.status !== "void", "gross_cents"),
        // What is still to be paid, and what already has been. Kept apart
        // because "owed" is the number a payout run works from.
        owedCents: sum((c) => c.status === "pending" || c.status === "approved", "commission_cents"),
        paidCents: sum((c) => c.status === "paid", "commission_cents"),
      };
    });

    return { affiliates: rows };
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(2).max(32),
  name: z.string().min(1).max(120),
  email: z.string().email().max(200).or(z.literal("")).optional(),
  commissionPct: z.number().min(0).max(100),
  status: z.enum(["active", "paused"]).default("active"),
  notes: z.string().max(2000).optional(),
});

/**
 * Create or edit an affiliate — the screen where a deal gets recorded.
 *
 * Changing commission_pct only affects sales from here on: past commissions
 * copied the rate onto their own row when they were accrued, so renegotiating
 * upward does not retroactively rewrite what was already owed.
 */
export const adminUpsertAffiliate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const code = normalizeAffiliateCode(data.code);
    if (!code) {
      throw new Error(
        "A code must be 2-32 characters: letters, numbers, hyphen or underscore, starting with a letter or number.",
      );
    }

    const supabaseAdmin = await affDb();
    const row = {
      code,
      name: data.name.trim(),
      email: data.email?.trim() || null,
      commission_pct: data.commissionPct,
      status: data.status,
      notes: data.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const q = data.id
      ? supabaseAdmin.from("affiliates").update(row).eq("id", data.id).select("id").single()
      : supabaseAdmin.from("affiliates").insert(row).select("id").single();

    const { data: saved, error } = await q;
    if (error) {
      // The only constraint an admin can realistically trip, and the generic
      // Postgres text for it says nothing useful about what to do next.
      if (/duplicate key|unique/i.test(error.message)) {
        throw new Error(`The code "${code}" is already taken by another affiliate.`);
      }
      throw new Error(error.message);
    }
    return { id: saved.id };
  });

export const adminAffiliateDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ affiliateId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const supabaseAdmin = await affDb();

    const { data: commissions } = await supabaseAdmin
      .from("affiliate_commissions")
      .select("id, user_id, gross_cents, commission_pct, commission_cents, status, created_at, paid_at")
      .eq("affiliate_id", data.affiliateId)
      .order("created_at", { ascending: false })
      .limit(200);

    type DetailRow = {
      id: string;
      user_id: string | null;
      gross_cents: number;
      commission_pct: number;
      commission_cents: number;
      status: string;
      created_at: string;
      paid_at: string | null;
    };
    const rows = (commissions ?? []) as DetailRow[];

    // Emails are looked up for display only, and only for the users this
    // affiliate actually referred.
    const ids = [...new Set(rows.map((c) => c.user_id).filter(Boolean))] as string[];
    const emails = new Map<string, string>();
    if (ids.length) {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      for (const u of users?.users ?? []) {
        if (ids.includes(u.id) && u.email) emails.set(u.id, u.email);
      }
    }

    return {
      commissions: rows.map((c) => ({
        ...c,
        email: c.user_id ? (emails.get(c.user_id) ?? null) : null,
      })),
    };
  });

/**
 * Move commissions between states — approve a batch, or mark it paid.
 *
 * Scoped to one affiliate and one starting state, so "mark everything paid"
 * cannot sweep up a row that was deliberately voided, or a row belonging to
 * somebody else.
 */
export const adminSetCommissionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        affiliateId: z.string().uuid(),
        from: z.enum(["pending", "approved", "paid", "void"]),
        to: z.enum(["pending", "approved", "paid", "void"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const supabaseAdmin = await affDb();

    const { data: updated, error } = await supabaseAdmin
      .from("affiliate_commissions")
      .update({ status: data.to, paid_at: data.to === "paid" ? new Date().toISOString() : null })
      .eq("affiliate_id", data.affiliateId)
      .eq("status", data.from)
      .select("id");
    if (error) throw new Error(error.message);
    return { moved: updated?.length ?? 0 };
  });
