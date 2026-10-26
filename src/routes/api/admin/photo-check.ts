import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

// Scores one picture with the production vision checker (the same model and
// key media-finalize.server.ts scorePhoto uses), so the checker can be tested
// against renders a person has already judged before it is trusted to pick
// renders. The key stays on the server; only the reply comes back.
//
// Service-role bearer only. POST { image: url or data: URL, prompt, model? }.
export const Route = createFileRoute("/api/admin/photo-check")({
  server: { handlers: { POST: check } },
});

function authorized(request: Request): boolean {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function check({ request }: { request: Request }) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const body = (await request.json().catch(() => null)) as { image?: string; prompt?: string; model?: string } | null;
  if (!body?.image || !body.prompt) return Response.json({ error: "image and prompt are required" }, { status: 400 });

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const xaiKey = process.env.XAI_API_KEY;
  const key = openRouterKey || xaiKey;
  if (!key) return Response.json({ error: "no vision key configured" }, { status: 500 });
  const endpoint = openRouterKey ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.x.ai/v1/chat/completions";
  const model =
    body.model ||
    (openRouterKey
      ? process.env.VISION_VERIFY_MODEL || "qwen/qwen2.5-vl-72b-instruct"
      : process.env.XAI_VISION_MODEL || process.env.XAI_MODEL || "grok-4-1-fast-non-reasoning");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 16,
      messages: [{ role: "user", content: [{ type: "text", text: body.prompt }, { type: "image_url", image_url: { url: body.image } }] }],
    }),
  });
  const text = await res.text();
  if (!res.ok) return Response.json({ model, error: `HTTP ${res.status} ${text.slice(0, 200)}` }, { status: 502 });
  const reply = JSON.parse(text).choices?.[0]?.message?.content ?? null;
  return Response.json({ model, reply });
}
