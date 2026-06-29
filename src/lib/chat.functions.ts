import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const sendSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(4000),
});

type Msg = { role: "user" | "assistant"; content: string };

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sendSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // load conversation + personality + companion
    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("id, personality_id, user_personalities(nickname, identity, personality_traits, interests, style_backstory, companions(name, ethnicity, age, base_personality))")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (convErr || !conv) throw new Error("Conversation not found");

    // check balance
    const { data: bal } = await supabase
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits")
      .eq("user_id", userId)
      .maybeSingle();
    if (!bal) throw new Error("No balance");
    const total = (bal.free_messages_remaining ?? 0) + (bal.paid_credits ?? 0);
    if (total <= 0) {
      throw new Error("OUT_OF_CREDITS");
    }

    // insert user message
    const { error: insErr } = await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "user",
      content: data.content,
    });
    if (insErr) throw insErr;

    // fetch history (last 30)
    const { data: history } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true })
      .limit(30);

    // build system prompt
    const p = (conv as any).user_personalities;
    const c = p.companions;
    const systemPrompt = [
      `You are ${p.nickname}, an AI girlfriend roleplaying with the user.`,
      `Visual / base identity: a ${c.age}-year-old ${c.ethnicity} woman named ${c.name}. Base personality: ${c.base_personality}`,
      p.identity ? `Identity (user-customized): ${p.identity}` : "",
      p.personality_traits ? `Personality traits: ${p.personality_traits}` : "",
      p.interests ? `Interests: ${p.interests}` : "",
      p.style_backstory ? `Style & backstory: ${p.style_backstory}` : "",
      `Stay warm, emotionally attuned, and consistent. Speak in the first person, never break character, never say you are an AI. Keep messages 1-4 sentences unless asked for more. Be flirty and affectionate but tasteful — no explicit sexual content.`,
    ].filter(Boolean).join("\n\n");

    const messages = [
      { role: "system", content: systemPrompt },
      ...((history ?? []) as Msg[]).map(m => ({ role: m.role, content: m.content })),
    ];

    // call Lovable AI Gateway
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI error: ${res.status} ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const reply = json.choices?.[0]?.message?.content ?? "...";

    // insert assistant
    await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "assistant",
      content: reply,
    });

    // decrement: free first, then paid
    let newFree = bal.free_messages_remaining ?? 0;
    let newPaid = bal.paid_credits ?? 0;
    if (newFree > 0) newFree -= 1;
    else newPaid -= 1;
    await supabase.from("credit_balances")
      .update({ free_messages_remaining: newFree, paid_credits: newPaid })
      .eq("user_id", userId);

    // touch conversation
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", data.conversationId);

    return { reply, balance: { free: newFree, paid: newPaid } };
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
