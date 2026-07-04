import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { spendCredits, logAiUsage } from "./tokens.functions";

const SELFIE_COST = 8;
const VOICE_COST = 3;

const VOICES = ["alloy", "sage", "shimmer", "nova", "coral", "verse"];

// Atomic debit for a premium media action (free messages first, then paid).
async function chargeCredits(
  supabase: any, userId: string, cost: number, action: string, conversationId?: string,
) {
  const balance = await spendCredits(supabase, userId, cost, action, "conversation", conversationId);
  await logAiUsage(supabase, userId, action, cost, conversationId);
  return balance;
}

export const generateSelfie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    conversationId: z.string().uuid(),
    prompt: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conv } = await supabase
      .from("conversations")
      .select("scenario, user_personalities(nickname, identity, style_backstory, companions(name, ethnicity, age, base_personality, short_bio))")
      .eq("id", data.conversationId).eq("user_id", userId).maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    const balance = await chargeCredits(supabase, userId, SELFIE_COST, "image", data.conversationId);

    const p: any = (conv as any).user_personalities;
    const c = p.companions;
    const userPrompt = data.prompt?.trim();
    const imagePrompt = [
      `Hyper-realistic intimate selfie of a ${c.age}-year-old ${c.ethnicity} woman named ${c.name}.`,
      `Soft warm lighting, shallow depth of field, shot on iPhone, slightly grainy, intimate bedroom or apartment setting.`,
      `She looks: ${c.short_bio}.`,
      p.style_backstory ? `Vibe: ${p.style_backstory}.` : "",
      userPrompt ? `She is: ${userPrompt}.` : `She is smiling softly at the camera.`,
      `Tasteful, sensual, fully clothed or in casual loungewear. No nudity, no explicit content. Photographic, not illustrated.`,
    ].filter(Boolean).join(" ");

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        prompt: imagePrompt,
        size: "1024x1024",
        n: 1,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Image error: ${res.status} ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned");
    const dataUrl = `data:image/png;base64,${b64}`;

    const caption = userPrompt ? `*sends a pic* ${userPrompt}` : "*sends you a selfie* 💋";
    await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "assistant",
      content: caption,
      kind: "image",
      media_url: dataUrl,
    });

    return { balance, mediaUrl: dataUrl };
  });

export const generateVoiceNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    conversationId: z.string().uuid(),
    text: z.string().min(1).max(800),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conv } = await supabase
      .from("conversations")
      .select("user_personalities(companions(sort_order))")
      .eq("id", data.conversationId).eq("user_id", userId).maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    const balance = await chargeCredits(supabase, userId, VOICE_COST, "voice", data.conversationId);

    const sort: number = (conv as any).user_personalities?.companions?.sort_order ?? 0;
    const voice = VOICES[sort % VOICES.length];

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini-tts",
        input: data.text,
        voice,
        response_format: "mp3",
        instructions: "Speak warmly, intimately, like a girlfriend leaving a private voice note. Slightly low, slow, breathy.",
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Voice error: ${res.status} ${t.slice(0, 200)}`);
    }
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    const dataUrl = `data:audio/mpeg;base64,${b64}`;

    await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "assistant",
      content: data.text,
      kind: "voice",
      media_url: dataUrl,
    });

    return { balance, mediaUrl: dataUrl };
  });
