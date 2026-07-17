import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { applyDeduction, hasEnough } from "./credits";
import { generateImage, textToSpeech } from "./ai";

const SELFIE_COST = 8;
const VOICE_COST = 3;

// Warmer, more natural voices first (alloy is the flattest, so it's last).
const VOICES = ["shimmer", "coral", "sage", "nova", "verse", "alloy"];

async function chargeCredits(supabase: any, userId: string, cost: number, reason: string) {
  const { data: bal } = await supabase
    .from("credit_balances")
    .select("free_messages_remaining, paid_credits")
    .eq("user_id", userId)
    .maybeSingle();
  if (!bal) throw new Error("No balance");
  const free = bal.free_messages_remaining ?? 0;
  const paid = bal.paid_credits ?? 0;
  if (!hasEnough(free, paid, cost)) throw new Error("OUT_OF_CREDITS");
  const { free: newFree, paid: newPaid } = applyDeduction(free, paid, cost);
  await supabase
    .from("credit_balances")
    .update({ free_messages_remaining: newFree, paid_credits: newPaid })
    .eq("user_id", userId);
  await supabase.from("credit_ledger").insert({
    user_id: userId,
    delta: -cost,
    reason,
    balance_after: newFree + newPaid,
  });
  return { free: newFree, paid: newPaid };
}

export const generateSelfie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        prompt: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conv } = await supabase
      .from("conversations")
      .select(
        "scenario, user_personalities(nickname, identity, style_backstory, companions(name, ethnicity, age, base_personality, short_bio))",
      )
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    const balance = await chargeCredits(supabase, userId, SELFIE_COST, "selfie");

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
    ]
      .filter(Boolean)
      .join(" ");

    const dataUrl = await generateImage(imagePrompt);

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
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        text: z.string().min(1).max(800),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conv } = await supabase
      .from("conversations")
      .select("user_personalities(companions(sort_order))")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    const balance = await chargeCredits(supabase, userId, VOICE_COST, "voice_note");

    const sort: number = (conv as any).user_personalities?.companions?.sort_order ?? 0;
    const voice = VOICES[sort % VOICES.length];

    const buf = await textToSpeech(data.text, voice);
    const dataUrl = `data:audio/mpeg;base64,${buf.toString("base64")}`;

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
