import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateImage } from "./ai";
import { portraitPrompt } from "./portrait";

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
  .inputValidator((d: unknown) => z.object({ search: z.string().optional() }).parse(d ?? {}))
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
      supabaseAdmin
        .from("profiles")
        .select(
          "id, display_name, subscription_tier, subscription_status, subscription_renews_at, authnet_subscription_id, is_suspended",
        )
        .in("id", ids),
      supabaseAdmin
        .from("credit_balances")
        .select("user_id, free_messages_remaining, paid_credits")
        .in("user_id", ids),
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
          isSuspended: p?.is_suspended ?? false,
        };
      })
      .filter((row) =>
        !q
          ? true
          : row.email.toLowerCase().includes(q) ||
            (row.displayName ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return { users: rows };
  });

export const adminAddCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), credits: z.number().int() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: bal } = await supabaseAdmin
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits")
      .eq("user_id", data.userId)
      .maybeSingle();
    const newPaid = Math.max(0, (bal?.paid_credits ?? 0) + data.credits);
    const { error } = await supabaseAdmin
      .from("credit_balances")
      .upsert({ user_id: data.userId, paid_credits: newPaid }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("credit_ledger").insert({
      user_id: data.userId,
      delta: data.credits,
      reason: "admin_credit",
      balance_after: (bal?.free_messages_remaining ?? 0) + newPaid,
      idempotency_key: `admin-${data.userId}-${Date.now()}-${Math.random()}`,
    });

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
    z
      .object({
        userId: z.string().uuid(),
        tier: z.enum(["sub-flirt", "sub-lover", "sub-soulmate", "none"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.tier === "none") {
      const { error } = await supabaseAdmin
        .from("profiles")
        .update({
          subscription_tier: null,
          subscription_status: "cancelled",
          subscription_renews_at: null,
        })
        .eq("id", data.userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    const renews = new Date();
    renews.setMonth(renews.getMonth() + 1);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        subscription_tier: data.tier,
        subscription_status: "active",
        subscription_renews_at: renews.toISOString(),
      })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["admin", "user"]),
        grant: z.boolean(),
      })
      .parse(d),
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
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const adminListUserPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: payments }, { data: ledger }] = await Promise.all([
      supabaseAdmin
        .from("transactions")
        .select("id, amount_cents, credits_added, pack_name, status, created_at")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("credit_ledger")
        .select("id, delta, reason, balance_after, created_at")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    return { payments: payments ?? [], ledger: ledger ?? [] };
  });

export const adminListPersonas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("companions")
      .select(
        "id, name, image_url, short_bio, base_personality, tags, language, status, is_adult, age, ethnicity, gender, art_style, sort_order, speaking_style, vocabulary_level, boundaries, greeting, voice_id",
      )
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return { personas: data ?? [] };
  });

const personaSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(60),
  image_url: z.string().default(""),
  short_bio: z.string().min(1).max(400),
  base_personality: z.string().min(1),
  tags: z.array(z.string().max(30)).max(20).default([]),
  language: z.string().min(2).max(8),
  status: z.enum(["active", "inactive"]),
  age: z.number().int().min(18).max(99),
  ethnicity: z.string().min(1).max(60),
  gender: z.string().min(1).max(30),
  art_style: z.string().min(1).max(30),
  speaking_style: z.string().optional().default(""),
  vocabulary_level: z.string().optional().default("casual"),
  boundaries: z.string().optional().default(""),
  greeting: z.string().optional().default(""),
  voice_id: z.string().optional().default("alloy"),
});

export const adminUpsertPersona = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => personaSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // is_adult is always true — enforced here and by the DB CHECK constraint.
    const row = {
      name: data.name,
      image_url: data.image_url,
      short_bio: data.short_bio,
      base_personality: data.base_personality,
      tags: data.tags,
      language: data.language,
      status: data.status,
      age: data.age,
      ethnicity: data.ethnicity,
      gender: data.gender,
      art_style: data.art_style,
      is_adult: true,
      speaking_style: data.speaking_style,
      vocabulary_level: data.vocabulary_level,
      boundaries: data.boundaries,
      greeting: data.greeting,
      voice_id: data.voice_id,
    };

    let targetId: string;
    let actionType: string;

    if (data.id) {
      const { error } = await supabaseAdmin.from("companions").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      targetId = data.id;
      actionType = "update_companion";
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("companions")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      targetId = created.id;
      actionType = "create_companion";
    }

    // Write audit log entry
    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId,
      action: actionType,
      details: {
        target_id: targetId,
        name: data.name,
      },
    });

    return { ok: true, id: targetId };
  });

// Regenerate a persona's photo with Replicate and store it in Supabase Storage
// (public `avatars` bucket), then point companions.image_url at the new URL.
export const adminRegeneratePersonaPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ companionId: z.string().uuid(), prompt: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: c, error: cErr } = await supabaseAdmin
      .from("companions")
      .select("id, name, age, ethnicity, gender, art_style, short_bio")
      .eq("id", data.companionId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!c) throw new Error("Model not found");

    // Generate (data URL) then decode to bytes.
    // gender drives the model's negative prompt — without it every companion
    // rendered with the female negatives, so male models came out as women.
    const dataUrl = await generateImage(portraitPrompt(c as any, data.prompt), {
      gender: (c as any).gender,
      noNudity: true,
    });
    const b64 = dataUrl.split(",")[1] ?? "";
    const bytes = Buffer.from(b64, "base64");

    // Ensure the public bucket exists (ignore "already exists").
    try {
      await supabaseAdmin.storage.createBucket("avatars", { public: true });
    } catch {
      /* already exists */
    }

    const path = `companions/${c.id}-${Date.now()}.png`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("avatars")
      .upload(path, bytes, { contentType: "image/png", upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { data: pub } = supabaseAdmin.storage.from("avatars").getPublicUrl(path);
    const imageUrl = pub.publicUrl;

    const { error: updErr } = await supabaseAdmin
      .from("companions")
      .update({ image_url: imageUrl })
      .eq("id", c.id);
    if (updErr) throw new Error(updErr.message);

    return { ok: true, imageUrl };
  });

// Send a push and/or email notification to all users.
export const adminBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        title: z.string().min(1).max(80),
        body: z.string().min(1).max(300),
        url: z.string().max(300).optional(),
        push: z.boolean().default(true),
        email: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPush, sendEmail, notificationEmailHtml } = await import("./notify");

    let pushSent = 0;
    let pushFailed = 0;
    let emailSent = 0;

    if (data.push) {
      const { data: subs } = await supabaseAdmin
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth");
      for (const s of subs ?? []) {
        try {
          await sendPush(s as any, { title: data.title, body: data.body, url: data.url });
          pushSent++;
        } catch (e: any) {
          pushFailed++;
          const code = String(e?.statusCode ?? "");
          if (code === "410" || code === "404") {
            await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          }
        }
      }
    }

    if (data.email) {
      const html = notificationEmailHtml(data.title, data.body, data.url);
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      for (const u of users.users) {
        if (!u.email) continue;
        try {
          await sendEmail(u.email, data.title, html);
          emailSent++;
        } catch {
          /* skip failures */
        }
      }
    }

    return { pushSent, pushFailed, emailSent };
  });

// Upload an image (data URL from the admin's device) to the public avatars
// bucket and return its URL — so admins pick a file instead of pasting a URL.
export const adminUploadImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ dataUrl: z.string().min(16) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const m = data.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!m) throw new Error("Not a valid image file");
    const contentType = m[1];
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > 8 * 1024 * 1024) throw new Error("Image too large (max 8MB)");
    const ext = (contentType.split("/")[1] || "png").replace("jpeg", "jpg");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      await supabaseAdmin.storage.createBucket("avatars", { public: true });
    } catch {
      /* already exists */
    }
    const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabaseAdmin.storage
      .from("avatars")
      .upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(error.message);
    const { data: pub } = supabaseAdmin.storage.from("avatars").getPublicUrl(path);
    return { imageUrl: pub.publicUrl };
  });

// Text-to-speech for the clip maker (returns an mp3 data URL).
export const adminTts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ text: z.string().min(1).max(300), voice: z.string().max(20).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { textToSpeech } = await import("./ai");
    const buf = await textToSpeech(data.text, data.voice || "coral");
    return { dataUrl: `data:audio/mpeg;base64,${buf.toString("base64")}` };
  });

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
        displayName: z.string().optional(),
      })
      .parse(d),
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

export const adminGetSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .select("key, value");
    if (error) throw new Error(error.message);
    return { settings: data ?? [] };
  });

export const adminUpdateSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ key: z.string(), value: z.any() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: data.key, value: data.value, updated_at: new Date().toISOString() });

    if (error) throw new Error(error.message);

    // Audit log
    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId,
      action: "update_setting",
      details: {
        key: data.key,
        value: data.value,
      },
    });

    return { ok: true };
  });

export const adminSetSuspended = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), suspended: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ is_suspended: data.suspended })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId,
      action: data.suspended ? "suspend_user" : "unsuspend_user",
      details: { target_id: data.userId },
    });
    return { ok: true };
  });

export const adminListCompanionMedia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ companionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("companion_media")
      .select("id, media_url, sort_order")
      .eq("companion_id", data.companionId)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return { media: rows ?? [] };
  });

export const adminAddCompanionMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        companionId: z.string().uuid(),
        mediaUrl: z.string().url(),
        sortOrder: z.number().int().optional().default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("companion_media")
      .insert({
        companion_id: data.companionId,
        media_url: data.mediaUrl,
        sort_order: data.sortOrder,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const adminDeleteCompanionMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("companion_media").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Run one persona-eval test case. The admin UI iterates index 0..total-1 so a
// full suite run never hits a single serverless timeout.
export const adminRunEvalCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ index: z.number().int().min(0) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { runEvalCase, EVAL_TEST_CASES } = await import("./eval-suite");
    const result = await runEvalCase(data.index);
    return { result, total: EVAL_TEST_CASES.length };
  });
