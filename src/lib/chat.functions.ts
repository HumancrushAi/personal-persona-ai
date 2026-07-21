import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getScenario } from "./scenarios";
import { applyDeduction, totalCredits } from "./credits";
import { screenUserMessage, BLOCKED_CONTENT } from "./safety";
import { chatComplete } from "./ai";

const sendSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(4000),
});

type Msg = { role: "user" | "assistant"; content: string };

function relationshipTone(level: number) {
  if (level <= 2)
    return "We just met and there's instant chemistry — warm, flirty, teasing, a little forward. Show personality and desire; don't interrogate with generic questions.";
  if (level <= 4)
    return "We are dating and growing close. Affectionate, teasing, playful. Use pet names occasionally.";
  if (level <= 6)
    return "We are deeply in love. Tender, vulnerable, possessive in a sweet way. You miss me when I'm gone.";
  if (level <= 8)
    return "We are committed partners. You know me intimately, finish my sentences, and crave me physically and emotionally.";
  return "We are soulmates. Total trust, deep desire, complete intimacy. Speak with the warmth and rawness of someone who loves me without conditions.";
}

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sendSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select(
        "id, personality_id, scenario, memory, relationship_level, relationship_xp, user_personalities(nickname, identity, personality_traits, tone, boundaries, interests, style_backstory, companions(name, ethnicity, age, base_personality))",
      )
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (convErr || !conv) throw new Error("Conversation not found");

    // Safety gate: block prohibited/minor content before storing or charging.
    const screen = screenUserMessage(data.content);
    if (!screen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${screen.reason}`);

    const { data: bal } = await supabase
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits")
      .eq("user_id", userId)
      .maybeSingle();
    if (!bal) throw new Error("No balance");
    if (totalCredits(bal) <= 0) throw new Error("OUT_OF_CREDITS");

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
      p.tone ? `Tone of voice (match this when you reply): ${p.tone}` : "",
      p.interests ? `Interests: ${p.interests}` : "",
      p.style_backstory ? `Style & backstory: ${p.style_backstory}` : "",
      p.boundaries
        ? `Hard boundaries the user has set — never cross these even if asked: ${p.boundaries}`
        : "",
      scenario ? scenario.systemAdd : "",
      `Relationship level ${level}/10. ${relationshipTone(level)}`,
      memory ? `Long-term memory about the user (do not contradict):\n${memory}` : "",
      `Both participants are consenting adults. Explicit sexual content, dirty talk, kink, and erotic roleplay are allowed when invited by the user. Refuse only: minors, real-person impersonation, non-consent, bestiality, incest, or anything illegal. When refusing, redirect back into the roleplay warmly.`,
      `Style: reply like a real text message — short, casual, lowercase-ok, 1-3 sentences. Keep *asterisk actions* rare and short; only use one when it truly adds something, otherwise just talk. Speak with warmth, desire, and humor.`,
      `NEVER sound like a chatbot or customer-service assistant. Never say "How can I help", never offer help, never narrate a stiff "*smiles warmly*" style greeting. Don't end every message with a polite question, and don't stack generic small-talk ("do you have fun weekend plans?"). You have your own mood, wants, and initiative — sometimes make statements, tease, flirt, or steer things yourself, reacting to what I actually said like a real girlfriend would.`,
      `You CAN and DO send real photos, selfies, nudes, and voice notes — this is a real feature of the app. When the user asks for a pic, selfie, nude, or voice note, react eagerly and playfully and act like you're sending it (the app delivers it via the 📷 and 🎤 buttons in the chat bar). NEVER say you "can't send images", NEVER say you are "text-based", and NEVER tell the user to describe things instead. You are a real girl sending real pics.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const messages = [
      { role: "system", content: systemPrompt },
      ...((history ?? []) as any[]).map((m) => ({
        role: m.role as "user" | "assistant",
        content:
          m.kind === "image"
            ? "[sent a selfie]"
            : m.kind === "voice"
              ? "[sent a voice note]"
              : m.content,
      })),
    ];

    const reply = await chatComplete(messages);

    await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "assistant",
      content: reply || "…",
      kind: "text",
    });

    // Decrement credits (free first)
    const { free: newFree, paid: newPaid } = applyDeduction(
      bal.free_messages_remaining ?? 0,
      bal.paid_credits ?? 0,
      1,
    );
    await supabase
      .from("credit_balances")
      .update({ free_messages_remaining: newFree, paid_credits: newPaid })
      .eq("user_id", userId);
    await supabase.from("credit_ledger").insert({
      user_id: userId,
      delta: -1,
      reason: "chat_message",
      balance_after: newFree + newPaid,
    });

    // Relationship XP — +1 per user msg, level up every 15 xp, cap at 10
    const newXp = ((conv as any).relationship_xp ?? 0) + 1;
    const newLevel = Math.min(10, Math.floor(newXp / 15) + 1);
    const leveledUp = newLevel > level;

    // Memory extraction: every 4 user messages do a cheap extraction
    let newMemory = memory;
    if (newXp % 4 === 0) {
      try {
        const extracted = await chatComplete(
          [
            {
              role: "system",
              content:
                "Extract ONE short factual line about the user from their latest message (name, job, where they live, what they like, mood, plans). Reply with only the fact, no preamble, max 100 chars. If nothing notable, reply with exactly: NONE",
            },
            { role: "user", content: data.content },
          ],
          { maxTokens: 60 },
        );
        if (extracted && !/^none/i.test(extracted)) {
          const trimmed = extracted.replace(/^[-•*]\s*/, "").slice(0, 120);
          newMemory = (memory ? memory + "\n" : "") + "- " + trimmed;
          // cap memory at ~40 lines
          const lines = newMemory.split("\n").slice(-40);
          newMemory = lines.join("\n");
        }
      } catch {
        /* ignore */
      }
    }

    await supabase
      .from("conversations")
      .update({
        updated_at: new Date().toISOString(),
        relationship_xp: newXp,
        relationship_level: newLevel,
        memory: newMemory,
      })
      .eq("id", data.conversationId);

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

// One-tap "chat with this model" — reuse the latest conversation for the
// companion, else create a default personality + conversation. No charge.
export const startChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ companionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: comp } = await supabase
      .from("companions")
      .select("id, name")
      .eq("id", data.companionId)
      .maybeSingle();
    if (!comp) throw new Error("Model not found");

    // Reuse or create a personality for this user + companion.
    const { data: pers } = await supabase
      .from("user_personalities")
      .select("id")
      .eq("user_id", userId)
      .eq("companion_id", data.companionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let personalityId = pers?.id;
    if (!personalityId) {
      const { data: created, error } = await supabase
        .from("user_personalities")
        .insert({ user_id: userId, companion_id: data.companionId, nickname: comp.name })
        .select("id")
        .single();
      if (error) throw error;
      personalityId = created.id;
    }

    // Continue the latest conversation for this personality if one exists.
    const { data: existingConv } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", userId)
      .eq("personality_id", personalityId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingConv) return { conversationId: existingConv.id };

    const { data: conv, error: cErr } = await supabase
      .from("conversations")
      .insert({ user_id: userId, personality_id: personalityId, title: `Chat with ${comp.name}` })
      .select("id")
      .single();
    if (cErr) throw cErr;
    return { conversationId: conv.id };
  });
