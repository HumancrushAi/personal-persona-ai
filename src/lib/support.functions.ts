// Support tickets raised from the widget on the landing and sign-up pages.
//
// The widget is public, so a ticket can arrive from a signed-out visitor: the
// email address is the identity, and the reply reaches them by email. A ticket
// from a signed-in visitor is linked to their account as well, so the same reply
// also lands in the app and on a push notification.
//
// Every write runs on the service role rather than through RLS. Submission has
// no session to check, and the email address on a ticket must not be editable by
// the client after the fact — that address is where staff replies get sent.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { SUPPORT_EMAIL } from "./support-contact";

// support_tickets and support_messages are newer than the generated
// src/integrations/supabase/types.ts, so the typed client rejects both table
// names. Regenerating types needs a reachable project, and this one is currently
// restricted for exceeding its egress quota. Re-run the type generation once it
// is back and this handle can go.
function supportDb(mod: { supabaseAdmin: unknown }): any {
  return mod.supabaseAdmin;
}

// Delivery is best-effort and never blocks the ticket: a Resend outage must
// not lose the message the user typed. It is stored first and notified second,
// so a failed send costs a notification, not a ticket.
//
// The inbox is the address on the site (support-contact.ts) unless the env
// overrides it — the same address a visitor sees, so an email sent directly
// and a ticket sent from the form land in one place.
function supportInbox(): string {
  return process.env.SUPPORT_EMAIL || SUPPORT_EMAIL;
}

// Every admin's devices, so a new ticket buzzes a phone as well as landing in
// the inbox. Best-effort like the email: nothing here can fail the ticket.
async function pushAdmins(
  db: any,
  payload: { title: string; body: string; url: string; tag: string },
) {
  try {
    const { data: admins } = await db.from("user_roles").select("user_id").eq("role", "admin");
    if (!admins?.length) return;
    const { sendPushToUser } = await import("./notify");
    await Promise.all(admins.map((a: { user_id: string }) => sendPushToUser(a.user_id, payload)));
  } catch (e: any) {
    console.error("[support] admin push failed:", e?.message ?? e);
  }
}

function siteUrl(): string {
  return process.env.PUBLIC_SITE_URL || "https://www.humancrush.com";
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Preserves the line breaks the user typed. Email clients collapse newlines, so
// the plain text has to become markup or a paragraphed message arrives as a wall.
const escBlock = (s: string) => esc(s).replace(/\r?\n/g, "<br>");

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

// Resolve the signed-in user WITHOUT requiring one. requireSupabaseAuth throws
// when there is no session, which is the wrong behaviour here: a visitor who has
// not signed up yet is exactly who the widget on the sign-up page is for.
async function optionalUser(supabaseAdmin: any): Promise<{ id: string; email?: string } | null> {
  try {
    const request = getRequest();
    const header = request?.headers?.get("authorization");
    if (!header) return null;
    const token = header.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? undefined };
  } catch {
    return null;
  }
}

// A public endpoint that sends email is a spam relay if it is left open, so the
// same address is capped. The window is deliberately generous — someone with a
// real billing problem may legitimately send three messages in a row.
const MAX_TICKETS_PER_HOUR = 5;

export const submitSupportTicket = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().email().max(200),
        name: z.string().max(80).optional(),
        subject: z.string().max(120).optional(),
        message: z.string().min(5).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = supportDb(await import("@/integrations/supabase/client.server"));

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await db
      .from("support_tickets")
      .select("id", { count: "exact", head: true })
      .eq("email", data.email)
      .gte("created_at", since);
    if ((count ?? 0) >= MAX_TICKETS_PER_HOUR)
      throw new Error("Too many messages in the last hour — reply to our email instead.");

    const user = await optionalUser(db);
    const subject = data.subject?.trim() || "Support request";

    const { data: ticket, error } = await db
      .from("support_tickets")
      .insert({
        user_id: user?.id ?? null,
        email: data.email,
        name: data.name?.trim() || null,
        subject,
      })
      .select("id, created_at")
      .single();
    // Storage is best-effort; DELIVERY is not.
    //
    // The tables ship in a migration, and a deploy can land before that
    // migration is applied. If the ticket cannot be written we still send the
    // email — a customer with a billing problem getting through matters far
    // more than the thread being recorded, and failing the submission would put
    // a broken form on the landing page for the gap between the two.
    let stored = Boolean(ticket && !error);
    if (stored) {
      const { error: msgErr } = await db.from("support_messages").insert({
        ticket_id: ticket.id,
        direction: "in",
        body: data.message,
        author_user_id: user?.id ?? null,
      });
      if (msgErr) stored = false;
    }
    if (!stored)
      console.error(
        "[support] ticket not persisted (is the support_tickets migration applied?):",
        error?.message ?? "insert failed",
      );

    const ref = stored ? String(ticket.id).slice(0, 8) : "UNSAVED";

    // Notification is after the write. It is swallowed on failure only while the
    // ticket itself was stored — see the guard below.
    const inbox = supportInbox();
    let emailed = false;
    {
      try {
        const { sendEmail } = await import("./notify");
        await sendEmail(
          inbox,
          `[#${ref}] ${subject} — ${data.email}`,
          `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">
            <p style="margin:0 0 12px"><strong>New support ticket</strong></p>
            <table style="border-collapse:collapse;font-size:13px;margin-bottom:16px">
              <tr><td style="padding:2px 12px 2px 0;color:#666">From</td><td>${esc(data.name || "—")} &lt;${esc(data.email)}&gt;</td></tr>
              <tr><td style="padding:2px 12px 2px 0;color:#666">Account</td><td>${user ? esc(user.id) : "not signed in"}</td></tr>
              <tr><td style="padding:2px 12px 2px 0;color:#666">Ticket</td><td>#${esc(ref)}</td></tr>
            </table>
            <div style="white-space:pre-wrap;border-left:3px solid #ff3d8b;padding:8px 0 8px 12px">${escBlock(data.message)}</div>
            <p style="margin:20px 0 0"><a href="${esc(siteUrl())}/admin?tab=support" style="color:#ff3d8b">Reply in the admin panel →</a></p>
            <p style="margin:8px 0 0;color:#888;font-size:12px">Hitting reply in your inbox emails ${esc(data.email)} directly and is the fastest route. Replying in the admin panel instead records the reply on the ticket and also delivers it in-app and by push.</p>
          </div>`,
          // Reply-To is the customer, so the inbox reply button just works.
          data.email,
        );
        emailed = true;
      } catch (e: any) {
        console.error("[support] alert email failed:", e?.message ?? e);
      }
    }

    // And the phone. The email is the record; this is what gets it seen.
    await pushAdmins(db, {
      title: `New support ticket #${ref}`,
      body: `${data.name ? `${data.name} · ` : ""}${data.email}: ${data.message.slice(0, 100)}`,
      url: "/admin?tab=support",
      tag: `ticket-${ref}`,
    });

    // Neither stored nor sent means the message is simply gone. Telling the
    // visitor it went through would be a lie, and they would wait for a reply
    // that can never come.
    if (!stored && !emailed)
      throw new Error("We could not send that — please email support directly.");

    return {
      id: stored ? (ticket.id as string) : null,
      ref,
      notified: emailed,
    };
  });

// The signed-in user's own tickets, newest first, with the full thread so the
// reply is readable in the app and not only in their inbox.
export const mySupportTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: tickets } = await (context.supabase as any)
      .from("support_tickets")
      .select("id, subject, status, created_at, last_message_at")
      .eq("user_id", context.userId)
      .order("last_message_at", { ascending: false })
      .limit(20);

    if (!tickets?.length) return { tickets: [] };

    const { data: messages } = await (context.supabase as any)
      .from("support_messages")
      .select("id, ticket_id, direction, body, created_at")
      .in(
        "ticket_id",
        tickets.map((t: any) => t.id),
      )
      .order("created_at", { ascending: true });

    return {
      tickets: tickets.map((t: any) => ({
        ...t,
        messages: (messages ?? []).filter((m: any) => m.ticket_id === t.id),
      })),
    };
  });

export const adminListSupportTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const db = supportDb(await import("@/integrations/supabase/client.server"));

    const { data: tickets } = await db
      .from("support_tickets")
      .select("id, user_id, email, name, subject, status, created_at, last_message_at")
      .order("last_message_at", { ascending: false })
      .limit(100);

    // What the tab needs to say about itself. "Support isn't active" was the
    // report, and the honest answer is that support is only as active as the
    // two env vars that deliver it: without SUPPORT_EMAIL nobody is told a
    // ticket arrived, and without RESEND_API_KEY no reply can be sent.
    const config = {
      inbox: supportInbox(),
      email: Boolean(process.env.RESEND_API_KEY),
    };

    if (!tickets?.length) return { tickets: [], config };

    const { data: messages } = await db
      .from("support_messages")
      .select("id, ticket_id, direction, body, created_at")
      .in(
        "ticket_id",
        tickets.map((t: any) => t.id),
      )
      .order("created_at", { ascending: true });

    return {
      config,
      tickets: tickets.map((t: any) => ({
        ...t,
        ref: String(t.id).slice(0, 8),
        messages: (messages ?? []).filter((m: any) => m.ticket_id === t.id),
      })),
    };
  });

// Staff reply. Recorded on the ticket first, then delivered — by email always,
// and additionally in-app and by push when the ticket belongs to an account.
export const adminReplySupportTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ticketId: z.string().uuid(),
        body: z.string().min(1).max(4000),
        close: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const db = supportDb(await import("@/integrations/supabase/client.server"));

    const { data: ticket } = await db
      .from("support_tickets")
      .select("id, user_id, email, subject")
      .eq("id", data.ticketId)
      .maybeSingle();
    if (!ticket) throw new Error("Ticket not found");

    const { error: insErr } = await db.from("support_messages").insert({
      ticket_id: ticket.id,
      direction: "out",
      body: data.body,
      author_user_id: context.userId,
    });
    if (insErr) throw new Error(insErr.message);

    await db
      .from("support_tickets")
      .update({
        status: data.close ? "closed" : "answered",
        last_message_at: new Date().toISOString(),
      })
      .eq("id", ticket.id);

    const ref = String(ticket.id).slice(0, 8);
    const errors: string[] = [];

    try {
      const { sendEmail } = await import("./notify");
      await sendEmail(
        ticket.email,
        `Re: ${ticket.subject} [#${ref}]`,
        `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">
          <div style="white-space:pre-wrap">${escBlock(data.body)}</div>
          <p style="margin:24px 0 0;color:#888;font-size:12px">HumanCrush support · ticket #${esc(ref)}<br>
          Need to add something? Reply to this email or use the support button at <a href="${esc(siteUrl())}" style="color:#ff3d8b">${esc(siteUrl())}</a>.</p>
        </div>`,
        // Reply-To is the support inbox, so the customer's reply reaches a human
        // rather than the no-reply sending domain.
        supportInbox(),
      );
    } catch (e: any) {
      errors.push(`email: ${e.message ?? "failed"}`);
    }

    if (ticket.user_id) {
      try {
        const { sendPush } = await import("./notify");
        const { data: subs } = await db
          .from("push_subscriptions")
          .select("endpoint, p256dh, auth")
          .eq("user_id", ticket.user_id);
        for (const s of subs ?? []) {
          await sendPush(s as any, {
            title: "Support replied",
            body: data.body.slice(0, 120),
            url: `${siteUrl()}/me`,
          }).catch(() => {});
        }
      } catch {
        /* push is the least important of the three channels */
      }
    }

    return { ok: true, errors };
  });
