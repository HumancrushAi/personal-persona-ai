import { createFileRoute } from "@tanstack/react-router";

// "hey, where did you go?" — she follows up when someone stops replying.
//
// The daily job in reengage.ts handles the long tail (quiet for two days or
// more). This one is the half-hour version: she sent a message, the user never
// answered, and 30 minutes later she sends ONE short check-in — written in her
// own voice from the actual conversation — as a new chat message, a push to
// every device the user has notifications on, and an email. Once per gap: she
// does not ask again until they have replied and gone quiet again, and no
// user gets more than one of these in twelve hours across all their chats.
//
// Triggered every ten minutes by .github/workflows/idle-nudge.yml. Vercel's
// own cron cannot do it: on the Hobby plan a cron runs once a day. With the
// CRON_SECRET bearer the sweep runs unconditionally; without it, it still
// runs but at most once every five minutes (a row in app_settings is the
// lock), so an unauthenticated caller cannot turn it into load. The sweep is
// idempotent either way — it only ever sends what the database says is due.
export const Route = createFileRoute("/api/cron/idle-nudge")({
  server: {
    handlers: {
      POST: idleNudge,
      GET: idleNudge,
    },
  },
});

const QUIET_MS = 30 * 60_000;
// Older than this belongs to the daily "misses you" job, not to a check-in.
const WINDOW_MS = 6 * 3600_000;
const USER_COOLDOWN_MS = 12 * 3600_000;
const LOCK_MS = 5 * 60_000;
const LOCK_KEY = "idle_nudge_last_run";
const NUDGE_KIND = "nudge";
// What the conversation must end on for her to be the one waiting.
const SETTLED_KINDS = new Set(["text", "image", "video", "voice"]);

const FALLBACK_LINES = [
  "hey… where'd you go? we were in the middle of something 👀",
  "did i lose you? come back, i wasn't done with you",
  "you went quiet on me… everything ok?",
];

type Msg = {
  conversation_id: string;
  role: string;
  kind: string;
  content: string;
  created_at: string;
};

async function idleNudge({ request }: { request: Request }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const secret = process.env.CRON_SECRET;
  const authed = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;

  const now = Date.now();
  if (!authed) {
    const { data: lock } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", LOCK_KEY)
      .maybeSingle();
    const last = Date.parse(String(lock?.value ?? "")) || 0;
    if (now - last < LOCK_MS) return Response.json({ skipped: "ran recently" });
  }
  await supabaseAdmin
    .from("app_settings")
    .upsert({ key: LOCK_KEY, value: new Date(now).toISOString() }, { onConflict: "key" });

  // Conversations with any activity in the window, newest first.
  const { data: convos } = await supabaseAdmin
    .from("conversations")
    .select(
      "id, user_id, updated_at, user_personalities(nickname, tone, style_backstory, companions(name, age, ethnicity, gender, base_personality, image_url))",
    )
    .gte("updated_at", new Date(now - WINDOW_MS).toISOString())
    .lte("updated_at", new Date(now - QUIET_MS).toISOString())
    .order("updated_at", { ascending: false })
    .limit(300);
  if (!convos?.length) return Response.json({ processed: 0, sent: 0 });

  // The tail of each conversation in one query rather than one per chat.
  const ids = convos.map((c) => c.id);
  const { data: tail } = await supabaseAdmin
    .from("messages")
    .select("conversation_id, role, kind, content, created_at")
    .in("conversation_id", ids)
    .gte("created_at", new Date(now - 2 * WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(4000);
  const byConv = new Map<string, Msg[]>();
  for (const m of (tail ?? []) as Msg[]) {
    const list = byConv.get(m.conversation_id) ?? [];
    if (list.length < 12) list.push(m);
    byConv.set(m.conversation_id, list);
  }

  // Who has already had one recently, across all their chats.
  const userIds = [...new Set(convos.map((c) => c.user_id))];
  const { data: recentNudges } = await supabaseAdmin
    .from("messages")
    .select("user_id")
    .eq("kind", NUDGE_KIND)
    .in("user_id", userIds)
    .gte("created_at", new Date(now - USER_COOLDOWN_MS).toISOString());
  const cooled = new Set((recentNudges ?? []).map((r) => r.user_id as string));

  const { sendPushToUser, sendEmail, notificationEmailHtml } = await import("@/lib/notify");
  const site = process.env.PUBLIC_SITE_URL || "https://www.humancrush.com";

  let processed = 0;
  let sent = 0;
  let pushed = 0;
  let emailed = 0;
  const nudgedUsers = new Set<string>();

  for (const conv of convos) {
    if (sent >= 40) break; // one sweep's budget; the next run picks up the rest
    const uid = conv.user_id as string;
    if (cooled.has(uid) || nudgedUsers.has(uid)) continue;

    const msgs = byConv.get(conv.id) ?? [];
    const last = msgs[0];
    if (!last || last.role !== "assistant" || !SETTLED_KINDS.has(last.kind)) continue;
    const quietFor = now - Date.parse(last.created_at);
    if (quietFor < QUIET_MS || quietFor > WINDOW_MS) continue;
    // They must have actually been talking: a greeting nobody answered is the
    // daily job's business, not a "where did you go".
    if (!msgs.some((m) => m.role === "user")) continue;
    processed++;

    const p: any = (conv as any).user_personalities;
    const c: any = p?.companions ?? {};
    const nick: string = p?.nickname || c.name || "She";
    const male = c.gender === "male" || c.gender === "trans-male";
    const minutes = Math.round(quietFor / 60_000);

    const line = await checkInLine(
      { nick, male, age: c.age, ethnicity: c.ethnicity, personality: c.base_personality, tone: p?.tone, backstory: p?.style_backstory },
      [...msgs].reverse(),
      minutes,
    );

    const { error } = await supabaseAdmin.from("messages").insert({
      conversation_id: conv.id,
      user_id: uid,
      role: "assistant",
      content: line,
      kind: NUDGE_KIND,
    });
    if (error) continue;
    await supabaseAdmin
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conv.id);
    sent++;
    nudgedUsers.add(uid);

    const chatPath = `/chat/${conv.id}`;
    const push = await sendPushToUser(uid, {
      title: `${nick} 💬`,
      body: line.length > 140 ? `${line.slice(0, 137)}…` : line,
      url: chatPath,
      tag: `nudge-${conv.id}`,
    });
    pushed += push.sent;

    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
      if (u.user?.email) {
        await sendEmail(
          u.user.email,
          `${nick}: where did you go?`,
          notificationEmailHtml(`${nick} is waiting on you`, line, `${site}${chatPath}`, c.image_url),
        );
        emailed++;
      }
    } catch {
      /* email is best-effort; the chat message and the push already went */
    }
  }

  return Response.json({ processed, sent, pushed, emailed });
}

// One short text in her voice, about what they were actually talking about.
// Falls back to a stock line when the chat model is unavailable: a plain
// "where did you go?" still beats silence.
async function checkInLine(
  her: {
    nick: string;
    male: boolean;
    age?: number;
    ethnicity?: string;
    personality?: string;
    tone?: string | null;
    backstory?: string | null;
  },
  history: Msg[],
  minutes: number,
): Promise<string> {
  const fallback = FALLBACK_LINES[Math.floor(Math.random() * FALLBACK_LINES.length)];
  try {
    const { chatComplete } = await import("@/lib/ai");
    const role = her.male ? "boyfriend" : "girlfriend";
    const system = [
      `You are ${her.nick}, the user's adult (18+) AI ${role}${her.age ? `, ${her.age}` : ""}${her.ethnicity ? `, ${her.ethnicity}` : ""}. Stay in character; never say you are an AI.`,
      her.personality ? `Personality: ${her.personality}` : "",
      her.tone ? `Tone of voice: ${her.tone}` : "",
      her.backstory ? `Style & backstory: ${her.backstory}` : "",
      `The user stopped replying ${minutes} minutes after your last message. Write ONE short text checking where they went — like a real ${role} texting from her phone: casual, lowercase is fine, a little playful or needy, and it should refer to what you two were just talking about so it feels like the same conversation.`,
      `Rules: at most two sentences and under 160 characters. No stage directions, no asterisks, no quotes around it, no greeting like "hey user", at most one emoji. Output only the message text.`,
    ]
      .filter(Boolean)
      .join("\n");
    const turns = history.slice(-8).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content:
        m.content?.trim() ||
        (m.kind === "image" ? "[sent a photo]" : m.kind === "video" ? "[sent a video]" : m.kind === "voice" ? "[sent a voice note]" : "…"),
    }));
    const out = (
      await chatComplete(
        [
          { role: "system", content: system },
          ...turns,
          { role: "user", content: "(no reply for " + minutes + " minutes — send your check-in text now)" },
        ],
        { maxTokens: 80, temperature: 0.9 },
      )
    )
      .replace(/^["'“”\s]+|["'“”\s]+$/g, "")
      .replace(/\*[^*]*\*/g, "")
      .trim();
    if (out.length < 4 || /\bAI\b|language model/i.test(out)) return fallback;
    // The model was told two sentences and still wrote four. A check-in is a
    // text, not a letter: keep the first two when it runs long.
    const sentences = out.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [out];
    const short =
      out.length > 160 && sentences.length > 2 ? sentences.slice(0, 2).join("").trim() : out;
    if (short.length > 220) return fallback;
    return short;
  } catch {
    return fallback;
  }
}
