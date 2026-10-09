import { createFileRoute } from "@tanstack/react-router";

// The unsubscribe link at the foot of every re-engagement mail. Signed, so
// an id alone cannot opt someone out. Opting out is recorded as a far-future
// profiles.last_reengaged_at (see lib/lifecycle.ts): nothing is ever "due"
// again, and no new column was needed.
export const Route = createFileRoute("/api/public/unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const userId = url.searchParams.get("u") ?? "";
        const token = url.searchParams.get("t") ?? "";
        const { unsubscribeTokenValid, OPT_OUT_STAMP } = await import("@/lib/lifecycle");
        const ok =
          /^[0-9a-f-]{36}$/i.test(userId) && unsubscribeTokenValid(userId, token);
        if (ok) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin
            .from("profiles")
            .update({ last_reengaged_at: OPT_OUT_STAMP })
            .eq("id", userId);
        }
        const message = ok
          ? "You won't get these emails anymore."
          : "That link isn't valid. Reply to the email and we'll take care of it.";
        return new Response(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HumanCrush</title></head><body style="margin:0;background:#141414;color:#f5f5f5;font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif"><div style="max-width:440px;margin:80px auto;padding:32px;text-align:center"><div style="font-size:22px;font-weight:700;margin-bottom:12px">HumanCrush</div><p style="font-size:16px;line-height:1.6;color:#d4d4d4">${message}</p><a href="/" style="display:inline-block;margin-top:20px;color:#f06b8a;text-decoration:none;font-weight:600">Back to the site</a></div></body></html>`,
          { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
        );
      },
    },
  },
});
