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
  pitch: string | null;
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
          .select("id, code, name, email, commission_pct, status, notes, pitch, created_at")
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
  status: z.enum(["pending", "active", "paused", "rejected"]).default("active"),
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
    const row: Record<string, unknown> = {
      code,
      name: data.name.trim(),
      email: data.email?.trim() || null,
      commission_pct: data.commissionPct,
      status: data.status,
      notes: data.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    // Read before the write, because two decisions depend on what the row WAS:
    // whether this save is the moment of approval, and whether it has ever been
    // approved before.
    const { data: current } = data.id
      ? await supabaseAdmin
          .from("affiliates")
          .select("status, approved_at")
          .eq("id", data.id)
          .maybeSingle()
      : { data: null };
    const becomingActive = data.status === "active" && current?.status !== "active";

    // "Affiliate since", so it records the FIRST approval and a later pause and
    // resume does not rewrite it. Stamping it on every save would make it mean
    // "last edited while active", which is what updated_at is already for.
    if (data.status === "active" && !current?.approved_at) {
      row.approved_at = new Date().toISOString();
    }

    const q = data.id
      ? supabaseAdmin.from("affiliates").update(row).eq("id", data.id).select("id").single()
      : supabaseAdmin.from("affiliates").insert(row).select("id").single();

    const { data: saved, error } = await q;
    if (error) {
      // Checked before the generic unique match: the email index is also a
      // unique constraint, and reporting it as "code taken" sends the admin off
      // renaming a code that was never the problem.
      if (/idx_affiliates_email_ci/.test(error.message)) {
        throw new Error("Another affiliate is already registered to that email address.");
      }
      if (/duplicate key|unique/i.test(error.message)) {
        throw new Error(`The code "${code}" is already taken by another affiliate.`);
      }
      throw new Error(error.message);
    }

    // The applicant was told on /affiliate that we would email them. Sent after
    // the save and best-effort: an unset RESEND_API_KEY or a Resend outage must
    // never un-approve somebody, and the page shows their link either way.
    //
    // No name in the mail. The applicant typed it, and it would be interpolated
    // into HTML. The code is [a-z0-9_-] by construction and the rate is a number,
    // so nothing that goes in here needs escaping.
    let emailed = false;
    if (becomingActive && typeof row.email === "string" && row.email) {
      try {
        const { sendEmail, notificationEmailHtml } = await import("./notify");
        const site = process.env.PUBLIC_SITE_URL || "https://humancrush.com";
        await sendEmail(
          row.email,
          "You're approved — your HumanCrush affiliate link",
          notificationEmailHtml(
            "You're approved",
            `Your link is ${site}/?ref=${code}. You earn ${data.commissionPct}% of everything the people you send ever spend. Signups and earnings appear on your affiliate page as they happen.`,
            `${site}/affiliate`,
          ),
        );
        emailed = true;
      } catch (e) {
        console.error("[affiliates] approval email not sent:", e);
      }
    }

    return { id: saved.id, emailed };
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
 * Void one commission by hand.
 *
 * The webhook voids a commission when Authorize.Net reports a full refund or a
 * void. Two cases never reach it: a chargeback, which has no webhook event at
 * all, and a partial refund, which the webhook deliberately leaves for a person
 * to judge. This is that person's button.
 *
 * Pending and approved only. A paid commission is money already sent, and
 * voiding it would make the affiliate's paid-to-date drop by money they did
 * in fact receive.
 */
export const adminVoidCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ commissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const supabaseAdmin = await affDb();

    const { data: updated, error } = await supabaseAdmin
      .from("affiliate_commissions")
      .update({ status: "void" })
      .eq("id", data.commissionId)
      .in("status", ["pending", "approved"])
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length) throw new Error("Only an unpaid commission can be voided.");
    return { ok: true };
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

// ── The affiliate's own side ────────────────────────────────────────────────
//
// Everything below is read by the affiliate themselves, so every query is
// scoped to the affiliate row that belongs to the caller. That scoping is the
// security boundary, and it is why these read through the service role rather
// than through an RLS policy: a policy wide enough to show someone their own
// earnings is one affiliate_id away from showing them a competitor's rate.

/**
 * The caller's affiliate row, binding it to their account on first sight.
 *
 * Binding is by EMAIL — the one identifier both sides already have. The admin
 * types it in to pay them; the affiliate signs up with it. No invite tokens and
 * nothing to lose in a spam folder: they register with the address the deal was
 * agreed on and their dashboard is simply there.
 *
 * The bind is written back to user_id so it happens once and every later load
 * is a straight lookup. Matching stays case-insensitive because "Gary@x.com" on
 * the deal and "gary@x.com" at signup are one person.
 */
/** One row of the affiliate's own earnings table. */
type EarningRow = {
  id: string;
  grossCents: number;
  pct: number;
  commissionCents: number;
  status: string;
  createdAt: string;
};

/**
 * The caller's email address.
 *
 * Taken from the verified JWT claims the auth middleware already decoded, so
 * this costs nothing. getUser() is the fallback rather than the default: it is
 * a network round trip to Supabase on every dashboard load, to fetch a value
 * that is sitting in the token we just validated.
 */
async function callerEmail(context: { supabase: any; claims?: any }): Promise<string | null> {
  const fromClaims = context.claims?.email;
  if (typeof fromClaims === "string" && fromClaims) return fromClaims;
  const { data } = await context.supabase.auth.getUser();
  return data?.user?.email ?? null;
}

async function affiliateForUser(
  supabaseAdmin: any,
  userId: string,
  email: string | null,
): Promise<any | null> {
  const { data: mine } = await supabaseAdmin
    .from("affiliates")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (mine) return mine;

  if (!email) return null;
  const { data: byEmail } = await supabaseAdmin
    .from("affiliates")
    .select("*")
    .ilike("email", email)
    .maybeSingle();
  if (!byEmail) return null;

  // Only claim a row that nobody else has claimed. Without this check an
  // affiliate row whose email was later reused by a different account would be
  // silently transferred, handing someone else's earnings to a stranger.
  if (byEmail.user_id && byEmail.user_id !== userId) return null;

  await supabaseAdmin.from("affiliates").update({ user_id: userId }).eq("id", byEmail.id);
  return { ...byEmail, user_id: userId };
}

/**
 * Everything the affiliate dashboard shows.
 *
 * Returns { affiliate: null } for an ordinary user rather than throwing — most
 * people who land on /affiliate are not affiliates yet, and that is the page
 * doing its job, not an error.
 */
export const myAffiliate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const supabaseAdmin = await affDb();
    const email = await callerEmail(context);

    // Every branch returns the SAME SHAPE. They did not, and the caller reads
    // data.earnings unconditionally — on the "not an affiliate" branch, which
    // carried neither stats nor earnings, that is a crash on the page's most
    // common state. It type-checked only because a server function's return
    // widens on the way to the client, so nothing would have caught it before a
    // real user hit it.
    const empty = { stats: null, earnings: [] as EarningRow[] };

    const aff = await affiliateForUser(supabaseAdmin, userId, email);
    if (!aff) return { affiliate: null, email, ...empty };

    // A pending or rejected application has no numbers worth fetching, and
    // showing zeroes next to "under review" reads as a broken dashboard.
    if (aff.status === "pending" || aff.status === "rejected") {
      return {
        affiliate: { code: aff.code, name: aff.name, status: aff.status, pct: aff.commission_pct },
        email,
        ...empty,
      };
    }

    const [{ count: clicks }, { count: signups }, { data: commissions }] = await Promise.all([
      supabaseAdmin
        .from("affiliate_clicks")
        .select("id", { count: "exact", head: true })
        .eq("affiliate_id", aff.id),
      supabaseAdmin
        .from("affiliate_referrals")
        .select("id", { count: "exact", head: true })
        .eq("affiliate_id", aff.id),
      supabaseAdmin
        .from("affiliate_commissions")
        .select("id, gross_cents, commission_pct, commission_cents, status, created_at, paid_at")
        .eq("affiliate_id", aff.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    type Row = {
      id: string;
      gross_cents: number;
      commission_pct: number;
      commission_cents: number;
      status: string;
      created_at: string;
      paid_at: string | null;
    };
    const rows = (commissions ?? []) as Row[];
    const sum = (pred: (r: Row) => boolean) =>
      rows.filter(pred).reduce((t, r) => t + (r.commission_cents ?? 0), 0);

    return {
      affiliate: {
        code: aff.code,
        name: aff.name,
        status: aff.status,
        pct: aff.commission_pct,
      },
      email,
      stats: {
        clicks: clicks ?? 0,
        signups: signups ?? 0,
        grossCents: rows.filter((r) => r.status !== "void").reduce((t, r) => t + r.gross_cents, 0),
        owedCents: sum((r) => r.status === "pending" || r.status === "approved"),
        paidCents: sum((r) => r.status === "paid"),
      },
      // No customer emails here. The admin view shows who bought what because
      // settling a dispute needs it; an affiliate needs the amounts and the
      // dates, and has no business knowing who their referrals are.
      earnings: rows.map((r) => ({
        id: r.id,
        grossCents: r.gross_cents,
        pct: r.commission_pct,
        commissionCents: r.commission_cents,
        status: r.status,
        createdAt: r.created_at,
      })),
    };
  });

/**
 * Apply to become an affiliate.
 *
 * Creates the row as 'pending', which is inert everywhere: tracking,
 * attribution and the commission trigger all filter on 'active', so an
 * application cannot earn anything until it is approved.
 *
 * The applicant proposes a code. It is theirs if it is free — being told your
 * preferred code is taken at the moment you type it is far better than finding
 * out after you have printed it somewhere.
 */
export const applyForAffiliate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().min(1).max(120),
        code: z.string().min(2).max(32),
        pitch: z.string().min(1).max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const supabaseAdmin = await affDb();

    const email = await callerEmail(context);
    if (!email) throw new Error("Your account needs a confirmed email address first.");

    const existing = await affiliateForUser(supabaseAdmin, userId, email);
    if (existing) throw new Error("You have already applied — check the affiliate page.");

    const code = normalizeAffiliateCode(data.code);
    if (!code) {
      throw new Error(
        "A code must be 2-32 characters: letters, numbers, hyphen or underscore, starting with a letter or number.",
      );
    }

    const { error } = await supabaseAdmin.from("affiliates").insert({
      code,
      name: data.name.trim(),
      email,
      user_id: userId,
      pitch: data.pitch.trim(),
      status: "pending",
      applied_at: new Date().toISOString(),
      // The default rate an application starts at. It is what the admin
      // renegotiates on approval; it is never what an applicant chooses.
      commission_pct: 20,
    });

    if (error) {
      if (/idx_affiliates_email_ci/.test(error.message)) {
        throw new Error("There is already an affiliate registered to this email address.");
      }
      if (/duplicate key|unique/i.test(error.message)) {
        throw new Error(`The code "${code}" is taken — pick another.`);
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });
