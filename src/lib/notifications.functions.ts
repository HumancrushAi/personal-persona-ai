import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const subSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

// Store (or refresh) the browser's push subscription for this user.
export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => subSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(
        { user_id: userId, endpoint: data.endpoint, p256dh: data.p256dh, auth: data.auth },
        { onConflict: "endpoint" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Where a push can die, from the server's side.
//
// The push service accepting a message proves nothing about the phone showing
// it, and "accepted for 1 of 1 device" was being read as success. This says
// which devices are actually on the account (so the card can tell whether the
// one in your hand is among them) and whether the two halves of the VAPID key
// agree — the client subscribes with VITE_VAPID_PUBLIC_KEY and the server signs
// with VAPID_PUBLIC_KEY, and if those were ever set to different keys every
// subscription on file is for a key the server does not hold.
export const pushDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });

    const pub = (process.env.VAPID_PUBLIC_KEY ?? "").trim();
    const priv = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
    const clientPub = (process.env.VITE_VAPID_PUBLIC_KEY ?? "").trim();

    // The endpoint is a capability URL: whoever holds it can push to that
    // browser. Only its tail goes back, enough to match against the device's
    // own, and the host, which says which browser vendor it is.
    const devices = (data ?? []).map((d) => {
      let host = "";
      try {
        host = new URL(d.endpoint).host;
      } catch {
        /* an unparseable endpoint is still a device, just an unnamed one */
      }
      return { tail: d.endpoint.slice(-24), host, createdAt: d.created_at };
    });

    return {
      configured: Boolean(pub && priv),
      // Blank on the client side means the client key is not visible to the
      // server, which is not the same as a mismatch; only a real disagreement
      // is reported.
      keysMatch: !clientPub || clientPub === pub,
      devices,
    };
  });

// A real notification, sent to every device this user has turned push on for,
// straight after they turn it on. The browser saying "allowed" proves nothing
// about delivery — the phone's own settings and battery manager decide that —
// so the only honest confirmation is one that actually arrives.
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sendPushToUser } = await import("./notify");
    return sendPushToUser(context.userId, {
      title: "Notifications are on 💌",
      body: "This is how she'll let you know she's messaged you.",
      url: "/me",
      tag: "push-test",
    });
  });
