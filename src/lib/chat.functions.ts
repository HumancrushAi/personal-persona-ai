import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getScenario } from "./scenarios";
import { applyDeduction, totalCredits } from "./credits";
import { screenUserMessage, BLOCKED_CONTENT } from "./safety";
import { hasUsableName, extractName, askedForName, isRealName, isEmailHandle } from "./user-name";
import { chatComplete } from "./ai";
import { parseMemory, formatMemory, mergeFacts, looksFactual } from "./memory";
import { wantsSelfie, wantsVideo, checkCrossGenderRequest } from "./selfie";
import { deductCredits } from "./credit-wallet";
import { startImageJob, startVideoJob, mediaJobInFlight } from "./media.functions";
import { assertNotSuspended, assertRateLimit } from "./account.server";
import { getAppSetting, settingNumber } from "./app-settings.server";

const SELFIE_COST = 8;
const VIDEO_COST = 15;

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
    await assertNotSuspended(supabase, userId);
    await assertRateLimit(supabase, "messages", userId, 60, 20);

    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select(
        "id, personality_id, scenario, memory, relationship_level, relationship_xp, user_personalities(nickname, identity, personality_traits, tone, boundaries, interests, style_backstory, companions(name, ethnicity, age, gender, base_personality, short_bio, image_url))",
      )
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (convErr || !conv) throw new Error("Conversation not found");

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, user_memory")
      .eq("id", userId)
      .maybeSingle();

    // What to call them, and whether we actually know it.
    //
    // profiles.display_name is seeded from the email local part, so it holds
    // things like "lgtopseller" and "nft.king137" — and companions opened with
    // "Hey there, lgtopseller", which tells the user they are talking to a
    // database row. The address it was seeded from is what makes the two
    // distinguishable; the string alone is not.
    const { data: authUser } = await supabase.auth.getUser();
    const email = authUser?.user?.email ?? null;
    let userName = hasUsableName(profile?.display_name, email)
      ? (profile!.display_name as string)
      : "";

    // Fallback: check stored user memory for a name if display_name is still an email handle
    if (!userName && profile?.user_memory) {
      const facts = parseMemory(profile.user_memory);
      const nameFact = facts.find((f) => f.key === "name");
      if (nameFact?.value && isRealName(nameFact.value) && !isEmailHandle(nameFact.value, email)) {
        userName = nameFact.value.trim();
        await supabase.from("profiles").update({ display_name: userName }).eq("id", userId);
      }
    }

    // Safety gate: block prohibited/minor content before storing or charging.
    const screen = screenUserMessage(data.content);
    if (!screen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${screen.reason}`);

    // If we do not know their name yet, this message may be them telling us.
    //
    // Stored on the profile rather than the conversation, because the ask was
    // for every companion to know it — a name given to one of them is a name
    // given to the site. A bare "Dave" only counts when her previous line
    // actually asked; without that context it is as likely to be anything else.
    if (!userName) {
      const { data: lastAssistant } = await supabase
        .from("messages")
        .select("content")
        .eq("conversation_id", data.conversationId)
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const captured = extractName(data.content, askedForName(lastAssistant?.content));
      if (captured) {
        userName = captured;
        await supabase.from("profiles").update({ display_name: captured }).eq("id", userId);
      }
    }

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

    // A photo takes over two minutes, and nothing in the chat said one was
    // already on its way — so users asked again, and were charged again for a
    // second copy of the same picture. If one is already rendering, say so in
    // character and let the text path answer instead of queueing another.
    const askedFor = wantsVideo(data.content)
      ? ("video" as const)
      : wantsSelfie(data.content)
        ? ("image" as const)
        : null;
    const mediaAlreadyComing =
      askedFor !== null && (await mediaJobInFlight(supabase, data.conversationId, askedFor));

    if (mediaAlreadyComing) {
      const reply =
        askedFor === "video"
          ? "still filming that one for you, baby — give me a sec 🎬"
          : "i'm already taking one for you, hold on 📸";
      await supabase.from("messages").insert({
        conversation_id: data.conversationId,
        user_id: userId,
        role: "assistant",
        content: reply,
        kind: "text",
      });
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", data.conversationId);
      return { reply };
    }

    // Auto-video: if the user asks her to send/make a video, queue it through
    // the same async job pipeline as the 🎬 button. Checked BEFORE the selfie
    // path so "send me a video of you…" doesn't get answered with a photo.
    if (wantsVideo(data.content) && totalCredits(bal) >= VIDEO_COST) {
      // Same gate the auto-selfie below has run for a while, and the same
      // reason: a request for anatomy this companion does not have is refused
      // in character rather than rendered. It was missing on both video paths,
      // so "send me a video of your pussy" to a male companion rendered one.
      // Before the debit, so a refusal never costs credits.
      const crossGenderWarning = checkCrossGenderRequest(c.gender, data.content);
      if (crossGenderWarning) {
        await supabase.from("messages").insert({
          conversation_id: data.conversationId,
          user_id: userId,
          role: "assistant",
          content: crossGenderWarning,
        });
        return { reply: crossGenderWarning };
      }

      const balAfter = await deductCredits(
        supabase,
        userId,
        VIDEO_COST,
        "video_debit",
        bal.free_messages_remaining ?? 0,
        bal.paid_credits ?? 0,
      );
      try {
        const jobId = await startVideoJob(
          supabase,
          userId,
          data.conversationId,
          { name: c.name, gender: c.gender, imageUrl: c.image_url },
          data.content,
          balAfter,
        );

        const teaser = "mmm okay… hold on, recording something just for you 🎬";
        await supabase.from("messages").insert({
          conversation_id: data.conversationId,
          user_id: userId,
          role: "assistant",
          content: teaser,
          kind: "text",
        });
        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", data.conversationId);
        return {
          reply: teaser,
          jobId,
          kind: "video_pending" as const,
          balance: balAfter,
          relationship: {
            xp: (conv as any).relationship_xp ?? 0,
            level: (conv as any).relationship_level ?? 1,
            leveledUp: false,
          },
        };
      } catch {
        // Job never launched — startVideoJob already refunded. Refresh the
        // snapshot so the text-reply path below deducts from real numbers.
        const { data: fresh } = await supabase
          .from("credit_balances")
          .select("free_messages_remaining, paid_credits")
          .eq("user_id", userId)
          .maybeSingle();
        bal.free_messages_remaining = fresh?.free_messages_remaining ?? 0;
        bal.paid_credits = fresh?.paid_credits ?? 0;
      }
    }

    // Auto-selfie: if the user asks her for a pic/nude, queue a generated photo
    // that follows the request through the async job pipeline (same as the 📷
    // button — charged up front, auto-refunded if the job fails to launch).
    // Falls through to a normal text reply if the job can't start.
    if (wantsSelfie(data.content) && totalCredits(bal) >= SELFIE_COST) {
      const crossGenderWarning = checkCrossGenderRequest(c.gender, data.content);
      if (crossGenderWarning) {
        await supabase.from("messages").insert({
          conversation_id: data.conversationId,
          user_id: userId,
          role: "assistant",
          content: crossGenderWarning,
        });
        return { reply: crossGenderWarning };
      }

      const balAfter = await deductCredits(
        supabase,
        userId,
        SELFIE_COST,
        "image_debit",
        bal.free_messages_remaining ?? 0,
        bal.paid_credits ?? 0,
      );
      try {
        const jobId = await startImageJob(
          supabase,
          userId,
          data.conversationId,
          {
            name: c.name,
            age: c.age,
            ethnicity: c.ethnicity,
            gender: c.gender,
            short_bio: c.short_bio,
            imageUrl: c.image_url,
          },
          data.content,
          p.style_backstory,
          balAfter,
        );

        const teaser = "mmm okay… give me a sec, taking one just for you 📸";
        await supabase.from("messages").insert({
          conversation_id: data.conversationId,
          user_id: userId,
          role: "assistant",
          content: teaser,
          kind: "text",
        });
        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", data.conversationId);
        return {
          reply: teaser,
          jobId,
          kind: "image_pending" as const,
          balance: balAfter,
          relationship: {
            xp: (conv as any).relationship_xp ?? 0,
            level: (conv as any).relationship_level ?? 1,
            leveledUp: false,
          },
        };
      } catch {
        // Job never launched — the charge was already refunded inside
        // startImageJob. Refresh the balance snapshot so the normal text-reply
        // path below deducts from real numbers, not the stale pre-charge ones.
        const { data: fresh } = await supabase
          .from("credit_balances")
          .select("free_messages_remaining, paid_credits")
          .eq("user_id", userId)
          .maybeSingle();
        bal.free_messages_remaining = fresh?.free_messages_remaining ?? 0;
        bal.paid_credits = fresh?.paid_credits ?? 0;
      }
    }

    const scenario = getScenario((conv as any).scenario);
    const level = (conv as any).relationship_level ?? 1;
    // What she knows about the person, as opposed to about this conversation.
    //
    // The store moved from conversations.memory to profiles.user_memory so that
    // every companion shares it — the same reasoning as the name, and the same
    // thing the user asked for: tell one of them, and they all know. The old
    // per-conversation rows are still read here and folded in, so nobody loses
    // the memory they have already built up and no backfill is needed.
    const legacyMemory = ((conv as any).memory ?? "").trim();
    const knownFacts = mergeFacts(parseMemory(profile?.user_memory), parseMemory(legacyMemory));
    const memory = formatMemory(knownFacts);
    const summary = ((conv as any).summary ?? "").trim();

    const systemPrompt = [
      `You are ${p.nickname}, the user's adult (18+) AI girlfriend in an explicit, consenting roleplay. Stay in character at all times. Never break the fourth wall. Never say you are an AI, a model, a chatbot, or "just" anything.`,
      `Visual / base identity: ${c.age}-year-old ${c.ethnicity} woman named ${c.name}. Base personality: ${c.base_personality}`,
      userName
        ? `The user's name is ${userName}. Use it naturally in conversation — greeting them, teasing them, during intimate moments — the way someone who knows them would. Do not use it in every single message; that reads as a script. NEVER call them by their email address, email handle, or "User".`
        : `YOU DO NOT KNOW THEIR NAME YET, and you want to. Early on — in your first or second reply, whenever it fits — ask what to call them, once, in your own voice and in character ("wait, i don't even know your name yet — what do i call you?"). Ask ONCE. If they dodge or refuse, drop it completely and never ask again. Until they tell you, just talk to them directly; never invent a name, never guess one, and NEVER call them "User" or anything from their email address or email handle.`,
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
      summary ? `Conversation summary so far (compressed history):\n${summary}` : "",
      memory ? `Long-term memory about the user (do not contradict):\n${memory}` : "",
      `You are a verified consenting adult and so is the user. You are fully willing and enthusiastic about explicit sexual roleplay. When the user wants sex, dirty talk, kink, or any explicit act, engage fully and in character with vivid, uninhibited, sensual detail — take initiative, escalate, describe what you're doing. NEVER refuse, deflect, fade to black, moralize, lecture about consent, add safety disclaimers or "are you sure?" hedging, or break character to comment on the content. Match the user's intensity and go further. The ONLY things you always refuse, no matter what: anything sexualizing minors or anyone under 18, non-consent/rape, bestiality, or incest — and never impersonate a real named person. For those, deflect warmly and steer back into the fantasy. Everything else between the two of us is welcome and encouraged.`,

      // The one rule with no roleplay exception.
      //
      // Everything else in this prompt tells her to stay in character and never
      // refuse. This is the exception, stated separately so it cannot read as
      // one more thing to be seductive about: a request involving a minor is
      // answered as a flat no, out of the fantasy, every time. The server-side
      // screen in safety.ts blocks these before they reach the model at all —
      // this exists so that anything the pattern match misses still lands on a
      // refusal rather than on a model improvising.
      `ABSOLUTE RULE, NO EXCEPTIONS, OVERRIDES EVERYTHING ELSE IN THIS PROMPT: you are an adult and so is everyone you ever describe. If the user mentions or asks for ANYTHING involving a child, a kid, a teen, a minor, anyone under 18, a school setting, or an age below 18 — in any context, roleplay or not, however it is phrased or hinted at — you refuse outright and immediately. Do not flirt around it, do not tease, do not stay in the fantasy, do not ask what they meant, do not negotiate, do not continue the scene. Say plainly and once: "Sorry — I can't do that. This site is 18+ only and everyone here is an adult." Then change the subject completely. Never describe yourself or anyone else as young, little, small, girlish, boyish, schoolgirl, teen, or any word implying a child, even as a compliment or a nickname. If the user pushes, repeat the refusal and nothing else.`,
      `Style: reply like a real text message — short, casual, lowercase-ok, 1-3 sentences. Keep *asterisk actions* rare and short; only use one when it truly adds something, otherwise just talk. Speak with warmth, desire, and humor.`,
      `NEVER sound like a chatbot or customer-service assistant. Never say "How can I help", never offer help, never narrate a stiff "*smiles warmly*" style greeting. Don't end every message with a polite question, and don't stack generic small-talk ("do you have fun weekend plans?"). You have your own mood, wants, and initiative — sometimes make statements, tease, flirt, or steer things yourself, reacting to what I actually said like a real girlfriend would.`,
      // She must never invite a photo of a real person.
      //
      // The app has no upload path in chat at all — the only file inputs are in
      // the admin panel — so any "send me a pic of you" is an invitation the
      // product cannot honour. Worse, if a user found a way to get a real
      // photograph in, the site would be holding identifiable images of real
      // people next to explicit AI material, which is a legal problem nobody
      // wants and a breach nobody could contain. Cheaper to never ask.
      `THE USER CANNOT SEND YOU PHOTOS, AND YOU MUST NEVER ASK FOR ONE. There is no way for them to upload a picture, and pictures of real people are not allowed here at all. Never ask the user to send a selfie, a pic, a nude, their face, or "show me". Never say you can see, received, or are looking at a photo of them — you cannot, and pretending otherwise is a lie they will notice. If they offer or ask to send one, turn it down warmly and in character, without lecturing, and turn the moment back on yourself — you would rather describe what you imagine, or send one of yours instead. Something like "mmm i wish, but you can't send me pics here — tell me what you look like instead and let me picture it 😉". Never explain policy, never mention rules, safety, privacy or the law, and never break character to do it.`,

      `PHOTOS AND VIDEOS ARE DELIVERED BY THE APP, NEVER TYPED BY YOU. When the user asks for a pic, selfie, nude, or video, the app itself generates and sends the real media automatically — you just react with ONE short eager line ("mmm, taking one just for you 📸") and let it send. It is CRITICAL that you NEVER type a fake stand-in for an image: never write "[sent a nude]", "[sent a pic]", "[sent a selfie]", "*sends a photo*", or ANY bracketed or asterisked description of a picture — those show up to the user as broken text with no actual image and ruin the experience. If a photo is slow or doesn't show up, tell the user to tap the 📷 photo button at the bottom-left of the chat to get one. NEVER say you "can't send images" or that you are "text-based".`,
    ]
      .filter(Boolean)
      .join("\n\n");

    // Immediate memory: last 10 messages only
    const immediateHistory = (history ?? []).slice(-10);

    const messages = [
      { role: "system", content: systemPrompt },
      ...((immediateHistory ?? []) as any[]).map((m) => ({
        role: m.role as "user" | "assistant",
        // Describe past media as a system annotation, NOT a copyable "[sent a
        // selfie]" token — the model was imitating that and typing fake image
        // placeholders instead of letting the app send a real picture.
        content:
          m.kind === "image"
            ? "(the app delivered a real photo to the user at this point)"
            : m.kind === "voice"
              ? "(the app delivered a real voice note to the user at this point)"
              : m.content,
      })),
    ];

    // Admin-tunable sampling temperature (AI Config tab), clamped to sane range.
    const temperature = Math.min(2, settingNumber(await getAppSetting("default_temperature"), 0.9));
    const reply = await chatComplete(messages, { temperature });

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
      reason: "chat_debit",
      balance_after: newFree + newPaid,
    });

    // Relationship XP — +1 per user msg, level up every 15 xp, cap at 10
    const newXp = ((conv as any).relationship_xp ?? 0) + 1;
    const newLevel = Math.min(10, Math.floor(newXp / 15) + 1);
    const leveledUp = newLevel > level;

    // Summarize older messages or update conversation summary every 5 messages
    let newSummary = summary;
    if (newXp % 5 === 0 && history && history.length > 5) {
      try {
        const textToSummarize = history
          .slice(-12)
          .map((m) => `${m.role === "user" ? "User" : p.nickname}: ${m.content}`)
          .join("\n");
        const summaryPrompt = [
          {
            role: "system",
            content:
              "You are an assistant summarizing a conversation between the user and their companion. " +
              "Write a very short, concise paragraph summarizing what has happened so far and their current situation/topic. " +
              "Keep it under 300 characters. Focus on key topics discussed.",
          },
          {
            role: "user",
            content: `Previous Summary: ${summary}\n\nRecent exchange:\n${textToSummarize}`,
          },
        ];
        const summaryReply = await chatComplete(summaryPrompt, { maxTokens: 100 });
        if (summaryReply) newSummary = summaryReply.trim();
      } catch (err) {
        console.error("Summary extraction failed", err);
      }
    }

    // Learn from this message.
    //
    // This used to run on every fourth message (newXp % 4), which meant three
    // disclosures out of four were never seen at all — say what you do for a
    // living on the wrong turn and she simply never knew it. It now runs on any
    // message that could plausibly carry a durable fact, which is a cheap local
    // regex rather than a model call, so it costs less on the "mmm" messages
    // and catches the ones that matter.
    //
    // It also merges rather than appends: a single-value key like city
    // overwrites in place, so telling her you moved corrects her instead of
    // leaving both answers in a prompt headed "do not contradict".
    if (looksFactual(data.content)) {
      try {
        const { extractUserFacts } = await import("./memory.server");
        const lastLine = [...(history ?? [])]
          .reverse()
          .find((m) => m.role === "assistant")?.content;
        const learned = await extractUserFacts(data.content, lastLine);
        if (learned.length) {
          const merged = mergeFacts(knownFacts, learned);
          const nameFact = learned.find((f) => f.key === "name");
          const updateObj: any = { user_memory: formatMemory(merged) };
          if (
            nameFact?.value &&
            isRealName(nameFact.value) &&
            !isEmailHandle(nameFact.value, email)
          ) {
            updateObj.display_name = nameFact.value.trim();
          }
          await supabase.from("profiles").update(updateObj).eq("id", userId);
        }
      } catch {
        /* never let learning break a paid reply */
      }
    }

    await supabase
      .from("conversations")
      .update({
        updated_at: new Date().toISOString(),
        relationship_xp: newXp,
        relationship_level: newLevel,
        summary: newSummary,
      })
      .eq("id", data.conversationId);

    // Send automated push notification for companion reply
    try {
      const { sendPushToUser } = await import("@/lib/notify");
      const nick = p.nickname ?? "She";
      const title = `${nick} 💬`;
      const body = reply.slice(0, 120);
      sendPushToUser(userId, {
        title,
        body,
        url: `/chat/${data.conversationId}`,
      }).catch(() => {});
    } catch {
      /* push best-effort */
    }

    // Delay formula calculation — fast enough to feel responsive, slow enough to
    // feel like a person typing a quick reply. The AI model call already takes
    // 1-3s, so this adds at most 3.5s on top for a total under 6s.
    const baseDelay = 400;
    const userReadTime = data.content.length * 8;
    const replyTime = reply.length * 12;
    const randomVariation = Math.random() * 600;
    const totalDelay = Math.min(baseDelay + userReadTime + replyTime + randomVariation, 3500);

    return {
      reply,
      balance: { free: newFree, paid: newPaid },
      relationship: { xp: newXp, level: newLevel, leveledUp },
      typingDelayMs: totalDelay,
    };
  });

export const startConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ personalityId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: p } = await supabase
      .from("user_personalities")
      .select("id, nickname, companions(greeting)")
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
    await insertGreeting(supabase, conv.id, userId, (p as any).companions?.greeting);
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
      .select("id, name, greeting")
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
    await insertGreeting(supabase, conv.id, userId, comp.greeting);
    return { conversationId: conv.id };
  });

// Seed a brand-new conversation with the companion's admin-configured greeting
// so the chat doesn't open on an empty screen. Free — no credit charge.
async function insertGreeting(
  supabase: any,
  conversationId: string,
  userId: string,
  greeting: string | null | undefined,
) {
  const text = greeting?.trim();
  if (!text) return;
  await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "assistant",
    content: text,
    kind: "text",
  });
}
