import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { isAdmin: !!data };
  });

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ search: z.string().optional() }).parse(d ?? {})
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (error) throw new Error(error.message);

    const ids = users.users.map((u) => u.id);
    const [{ data: profiles }, { data: balances }, { data: roles }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, display_name, subscription_tier, subscription_status, subscription_renews_at, authnet_subscription_id").in("id", ids),
      supabaseAdmin.from("credit_balances").select("user_id, free_messages_remaining, paid_credits").in("user_id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
    ]);

    const q = data.search?.toLowerCase().trim();
    const rows = users.users
      .map((u) => {
        const p = profiles?.find((x) => x.id === u.id);
        const b = balances?.find((x) => x.user_id === u.id);
        const r = roles?.filter((x) => x.user_id === u.id).map((x) => x.role) ?? [];
        return {
          id: u.id,
          email: u.email ?? "",
          createdAt: u.created_at,
          displayName: p?.display_name ?? null,
          tier: p?.subscription_tier ?? null,
          status: p?.subscription_status ?? null,
          renewsAt: p?.subscription_renews_at ?? null,
          authnetSubId: p?.authnet_subscription_id ?? null,
          freeCredits: b?.free_messages_remaining ?? 0,
          paidCredits: b?.paid_credits ?? 0,
          roles: r,
        };
      })
      .filter((row) =>
        !q ? true : row.email.toLowerCase().includes(q) || (row.displayName ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return { users: rows };
  });

export const adminAddCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), credits: z.number().int() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: bal } = await supabaseAdmin
      .from("credit_balances").select("paid_credits").eq("user_id", data.userId).maybeSingle();
    const newPaid = Math.max(0, (bal?.paid_credits ?? 0) + data.credits);
    const { error } = await supabaseAdmin
      .from("credit_balances")
      .upsert({ user_id: data.userId, paid_credits: newPaid }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("transactions").insert({
      user_id: data.userId,
      amount_cents: 0,
      credits_added: data.credits,
      pack_name: data.credits >= 0 ? "Admin grant" : "Admin adjustment",
      authnet_transaction_id: `admin-${Date.now()}`,
      status: "completed",
    });

    return { ok: true, paidCredits: newPaid };
  });

export const adminSetSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      userId: z.string().uuid(),
      tier: z.enum(["sub-flirt", "sub-lover", "sub-soulmate", "none"]),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.tier === "none") {
      const { error } = await supabaseAdmin.from("profiles").update({
        subscription_tier: null,
        subscription_status: "cancelled",
        subscription_renews_at: null,
      }).eq("id", data.userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    const renews = new Date(); renews.setMonth(renews.getMonth() + 1);
    const { error } = await supabaseAdmin.from("profiles").update({
      subscription_tier: data.tier,
      subscription_status: "active",
      subscription_renews_at: renews.toISOString(),
    }).eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      userId: z.string().uuid(),
      role: z.enum(["admin", "user"]),
      grant: z.boolean(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.grant) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles").delete()
        .eq("user_id", data.userId).eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      email: z.string().email(),
      password: z.string().min(6),
      displayName: z.string().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: data.displayName ? { name: data.displayName } : undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true, userId: created.user?.id };
  });
