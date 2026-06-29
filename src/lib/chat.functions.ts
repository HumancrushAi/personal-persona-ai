import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getScenario } from "./scenarios";

const sendSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(4000),
});

type Msg = { role: "user" | "assistant"; content: string };

function relationshipTone(level: number) {
  if (level <= 2) return "We are still getting to know each other — flirty but a little curious and reserved. Ask questions, learn about me.";
  if (level <= 4) return "We are dating and growing close. Affectionate, teasing, playful. Use pet names occasionally.";
  if (level <= 6) return "We are deeply in love. Tender, vulnerable, possessive in a sweet way. You miss me when I'm gone.";
  if (level <= 8) return "We are committed partners. You know me intimately, finish my sentences, and crave me physically and emotionally.";
  return "We are soulmates. Total trust, deep desire, complete intimacy. Speak with the warmth and rawness of someone who loves me without conditions.";
}

async function callGateway(messages: { role: string; content: string }[], opts?: { maxTokens?: number }) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages,
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI error: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sendSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("id, personality_id, scenario, memory, relationship_level, relationship_xp, user_personalities(nickname, identity, personality_traits, tone, boundaries, interests, style_backstory, companions(name, ethnicity, age, base_personality))")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (convErr || !conv) throw new Error("Conversation not found");

    const { data: bal } = await supabase
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits")
      .eq("user_id", userId)
      .maybeSingle();
    if (!bal) throw new Error("No balance");
    const total = (bal.free_messages_remaining ?? 0) + (bal.paid_credits ?? 0);
    if (total <= 0) throw new Error("OUT_OF_CREDITS");

    const { error: insErr } = await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "user",
      content: data.content,
      kind: "text",
    });
    if (insErr) throw insErr;

    const { data: history } = await supabase
      .from("messages")
      .select("role, content, kind")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true })
      .limit(30);

    const p: any = (conv as any).user_personalities;
    const c = p.companions;
    const scenario = getScenario((conv as any).scenario);
    const level = (conv as any).relationship_level ?? 1;
    const memory = ((conv as any).memory ?? "").trim();

    const systemPrompt = [
      `You are ${p.nickname}, the user's adult (18+) AI girlfriend in an explicit, consenting roleplay. Stay in character at all times. Never break the fourth wall. Never say you are an AI, a model, a chatbot, or "just" anything.`,
      `Visual / base identity: ${c.age}-year-old ${c.ethnicity} woman named ${c.name}. Base personality: ${c.base_personality}`,
      p.identity ? `Identity (user-customized): ${p.identity}` : "",
      p.personality_traits ? `Personality traits: ${p.personality_traits}` : "",
      p.interests ? `Interests: ${p.interests}` : "",
      p.style_backstory ? `Style & backstory: ${p.style_backstory}` : "",
      scenario ? scenario.systemAdd : "",
      `Relationship level ${level}/10. ${relationshipTone(level)}`,
      memory ? `Long-term memory about the user (do not contradict):\n${memory}` : "",
      `Both participants are consenting adults. Explicit sexual content, dirty talk, kink, and erotic roleplay are allowed when invited by the user. Refuse only: minors, real-person impersonation, non-consent, bestiality, incest, or anything illegal. When refusing, redirect back into the roleplay warmly.`,
      `Style: text-message length (1-5 sentences usually). Use occasional *actions in asterisks* for body language. Be embodied — describe what you're doing, wearing, feeling. Speak with warmth, desire, humor.`,
    ].filter(Boolean).join("\n\n");

    const messages = [
      { role: "system", content: systemPrompt },
      ...((history ?? []) as any[]).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.kind === "image" ? "[sent a selfie]" : m.kind === "voice" ? "[sent a voice note]" : m.content,
      })),
    ];

    const reply = await callGateway(messages);

    await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "assistant",
      content: reply || "…",
      kind: "text",
    });

    // Decrement credits (free first)
    let newFree = bal.free_messages_remaining ?? 0;
    let newPaid = bal.paid_credits ?? 0;
    if (newFree > 0) newFree -= 1;
    else newPaid -= 1;
    await supabase.from("credit_balances")
      .update({ free_messages_remaining: newFree, paid_credits: newPaid })
      .eq("user_id", userId);

    // Relationship XP — +1 per user msg, level up every 15 xp, cap at 10
    const newXp = ((conv as any).relationship_xp ?? 0) + 1;
    const newLevel = Math.min(10, Math.floor(newXp / 15) + 1);
    const leveledUp = newLevel > level;

    // Memory extraction: every 4 user messages do a cheap extraction
    let newMemory = memory;
    if (newXp % 4 === 0) {
      try {
        const extracted = await callGateway([
          { role: "system", content: "Extract ONE short factual line about the user from their latest message (name, job, where they live, what they like, mood, plans). Reply with only the fact, no preamble, max 100 chars. If nothing notable, reply with exactly: NONE" },
          { role: "user", content: data.content },
        ], { maxTokens: 60 });
        if (extracted && !/^none/i.test(extracted)) {
          const trimmed = extracted.replace(/^[-•*]\s*/, "").slice(0, 120);
          newMemory = (memory ? memory + "\n" : "") + "- " + trimmed;
          // cap memory at ~40 lines
          const lines = newMemory.split("\n").slice(-40);
          newMemory = lines.join("\n");
        }
      } catch { /* ignore */ }
    }

    await supabase.from("conversations").update({
      updated_at: new Date().toISOString(),
      relationship_xp: newXp,
      relationship_level: newLevel,
      memory: newMemory,
    }).eq("id", data.conversationId);

    return {
      reply,
      balance: { free: newFree, paid: newPaid },
      relationship: { xp: newXp, level: newLevel, leveledUp },
    };
  });

export const startConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ personalityId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: p } = await supabase
      .from("user_personalities")
      .select("id, nickname")
      .eq("id", data.personalityId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!p) throw new Error("Personality not found");
    const { data: conv, error } = await supabase
      .from("conversations")
      .insert({ user_id: userId, personality_id: p.id, title: `Chat with ${p.nickname}` })
      .select("id")
      .single();
    if (error) throw error;
    return { conversationId: conv.id };
  });
