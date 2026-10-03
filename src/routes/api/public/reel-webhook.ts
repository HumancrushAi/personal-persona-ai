import { createFileRoute } from "@tanstack/react-router";

// RunPod reports a companion's live reel here when it finishes. The query
// string carries the companion, the attempt and an HMAC signature; everything
// else — the stale check, crop, drift check, retry and publish — is in
// finishReel (src/lib/reels.server.ts).
export const Route = createFileRoute("/api/public/reel-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const q = new URL(request.url).searchParams;
        const c = q.get("c") ?? "";
        const a = Number(q.get("a") ?? "NaN");
        const t = q.get("t") ?? "";
        if (!c || !Number.isInteger(a) || a < 0 || !t) {
          return new Response("Bad parameters", { status: 400 });
        }

        let body: any;
        try {
          body = await request.json();
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const { finishReel } = await import("@/lib/reels.server");
        try {
          const result = await finishReel({ c, a, t }, body);
          return new Response(result, { status: 200 });
        } catch (e: any) {
          console.error(`[reels] webhook failed for ${c}: ${e?.message ?? e}`);
          // 200 so RunPod does not redeliver into the same failure.
          return new Response("Failed", { status: 200 });
        }
      },
    },
  },
});
