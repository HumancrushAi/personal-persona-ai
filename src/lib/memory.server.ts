// Pulling durable facts about the user out of a message.
//
// Grok runs this, with the same Grok-then-OpenRouter chain the image refiner
// uses, because it is the same shape of job: a small structured rewrite that
// must never be the reason a paid request fails. Every failure path returns an
// empty list, so a missing key, a refusal, a timeout or unparseable output all
// mean "learned nothing this turn" rather than a broken reply.

import { parseExtraction, type Fact } from "./memory";

const XAI_URL = "https://api.x.ai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM = `You extract durable facts about a user from their message in a chat app, for a companion to remember later.

Output zero to three lines, each exactly "key: value". Nothing else — no preamble, no numbering, no explanation. If the message contains no durable fact, output exactly: NONE

Use short lowercase keys. Prefer these when they fit: name, age, job, city, country, hometown, birthday, relationship, partner, kids, pet, car, health, timezone, likes, dislikes, wants.

A durable fact is something still true next month: where they live, what they do, what they own, who they live with, what they enjoy, what they cannot stand.

NEVER output a mood, a feeling, or a plan for today — "tired", "horny", "busy tonight" are not durable and must not be stored.
NEVER output anything the companion said; only what the USER revealed about themselves.
NEVER output an age below 18, and never output any fact describing a child or a minor. If the message implies either, output NONE.
Do not invent, infer or embellish. If they did not say it, it is not a fact.

Examples:
"i'm dave, just moved to manchester for work" -> name: Dave
city: Manchester
"lol i'm knackered, long day" -> NONE
"i've got two labradors and i cant stand cats" -> pet: two labradors
dislikes: cats`;

async function call(
  url: string,
  key: string,
  model: string,
  user: string,
  timeoutMs: number,
): Promise<string | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 100,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json.choices?.[0]?.message?.content ?? "").trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Facts learned from this turn.
 *
 * The companion's previous line is passed as context because so much of what a
 * person reveals is an answer rather than a statement: she asks where they are
 * from, they type "leeds", and on its own that word carries nothing at all.
 *
 * The timeout is short on purpose. This runs after the reply is already saved,
 * so a slow extractor only delays the response the user is waiting on, and
 * learning one fact is never worth making the chat feel broken.
 */
export async function extractUserFacts(
  userMessage: string,
  companionLastLine?: string | null,
): Promise<Fact[]> {
  const msg = (userMessage ?? "").trim();
  if (!msg) return [];

  const context = (companionLastLine ?? "").trim();
  const payload = context
    ? `She just said: ${context.slice(0, 300)}\n\nThey replied: ${msg.slice(0, 600)}`
    : `They said: ${msg.slice(0, 600)}`;

  const xai = process.env.XAI_API_KEY;
  if (xai) {
    const raw = await call(XAI_URL, xai, process.env.XAI_MODEL || "grok-4.6", payload, 8000);
    const facts = parseExtraction(raw);
    if (facts.length) return facts;
    // A clean "NONE" is an answer, not a failure — don't pay for a second
    // opinion on a message that plainly carried nothing.
    if (raw && /^none\b/i.test(raw.trim())) return [];
  }

  const or = process.env.OPENROUTER_API_KEY;
  if (!or) return [];
  const raw = await call(
    OPENROUTER_URL,
    or,
    process.env.OPENROUTER_MODEL || "sao10k/l3.1-euryale-70b",
    payload,
    8000,
  );
  return parseExtraction(raw);
}
