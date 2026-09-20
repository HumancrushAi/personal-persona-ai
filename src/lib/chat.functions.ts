import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getScenario } from "./scenarios";
import { applyDeduction, totalCredits } from "./credits";
import { screenUserMessage, screenAssistantReply, BLOCKED_CONTENT } from "./safety";
import { hasUsableName, extractName, askedForName, isRealName, isEmailHandle } from "./user-name";
import { chatComplete } from "./ai";
import { parseMemory, formatMemory, mergeFacts, looksFactual } from "./memory";
import { wantsSelfie, wantsVideo, checkCrossGenderRequest, isFollowUpMediaRequest } from "./selfie";
import { deductCredits } from "./credit-wallet";
import { startImageJob, startVideoJob, mediaJobInFlight } from "./media.functions";
import { assertNotSuspended, assertRateLimit } from "./account.server";
import { getAppSetting, settingNumber } from "./app-settings.server";
import { replyLanguageInstruction } from "./languages";

const SELFIE_COST = 8;
const VIDEO_COST = 15;

const sendSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(4000),
  // The visitor's language choice, kept on their device (see languages.ts) and
  // sent with each message because this is the only place it changes anything.
  language: z.string().max(8).optional(),
  // One id per send ATTEMPT, minted by the client. See the migration
  // 20260918000000_message_idempotency.sql for why this exists and why
  // deduping on content does not work. Optional so an older tab still sends.
  clientMsgId: z.string().uuid().optional(),
});

type Msg = { role: "user" | "assistant"; content: string };

/**
 * A line that promises a picture or a clip is on its way.
 *
 * The app writes four of these itself — the teasers below — and they go into
 * the messages table as ordinary assistant text. Ten of them then come back as
 * conversation history on the next turn, and the model does what models do with
 * a pattern repeated ten times: it copies it. "How old are you?" came back as
 * "mmm okay… give me a sec, taking one just for you 📸", and the user sat
 * waiting for a photo that was never queued.
 *
 * This is the same bug the comment further down already records being fixed
 * once, when past media was rendered into history as a copyable "[sent a
 * selfie]" token. Same cause, different string.
 *
 * Used twice: to keep these lines out of the history the model learns from, and
 * to catch a reply that promises media anyway.
 */
const PROMISES_MEDIA =
  /\b(?:taking (?:one|a pic|a photo|a selfie|another)|snapping (?:one|a pic)|give me a sec[^.!?]{0,40}\btaking\b|hold on[^.!?]{0,40}\brecording\b|recording something|filming (?:that|this|one)|sending (?:you )?(?:a|one) (?:pic|photo|selfie|video))\b/i;

/** What the app says while a real render is queued. Never written by the model. */
const TEASERS = {
  photo: "mmm okay… give me a sec, taking one just for you 📸",
  video: "mmm okay… hold on, recording something just for you 🎬",
  photoBusy: "i'm already taking one for you, hold on 📸",
  videoBusy: "still filming that one for you, baby — give me a sec 🎬",
};

/**
 * Strip a promise of media from a reply that has none coming.
 *
 * The belt to the system prompt's braces. An instruction is a strong hint; ten
 * examples in the history are stronger, and the instruction lost. This cannot
 * lose: if the model says it is taking a picture on a turn where nothing was
 * queued, that sentence does not reach the user.
 *
 * Sentence-level rather than whole-reply, so an answer that ends with a stray
 * promise keeps the part that actually answered the question.
 */
export function withoutFalseMediaPromise(reply: string): string {
  if (!reply) return reply;
  // A stage direction, not speech. She has emitted every one of these that was
  // ever put in front of her — "[sent a selfie]", "(the app delivered a real
  // photo...)", "(the app was already delivering media to the user at this
  // point)" — so the shape is caught here regardless of the wording, and
  // regardless of which future edit reintroduces one.
  // Brackets, parentheses AND asterisks: "*sends you a photo*" is the form the
  // system prompt has forbidden by name for a long time, and forbidding it in
  // words has not stopped it appearing.
  const direction =
    /^\s*[([*]\s*(?:the app\b|sent\b|sends\b|sending\b|image\b|photo\b|video\b|selfie\b|pic\b)/i;
  if (direction.test(reply)) return "mmm, ask me anything 😊";
  if (!PROMISES_MEDIA.test(reply)) return reply;
  // Split on emoji as well as on full stops. She writes like a person texting —
  // "i'm 23 babe 😊 mmm okay, taking one just for you 📸" has no sentence
  // punctuation in it at all, so a punctuation-only split treated the whole
  // thing as one sentence and threw away the answer along with the promise.
  const kept = reply
    .split(/(?<=[.!?…])\s+|(?<=\p{Extended_Pictographic})\s+/u)
    .filter((sentence) => !PROMISES_MEDIA.test(sentence))
    .join(" ")
    .trim();
  // "mmm okay…" on its own is not a reply. If what survives is only filler,
  // there was nothing in the message but the promise, and a short honest line
  // beats an empty bubble or a lie about a photo.
  const meaningful = kept
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(?:mmm+|mm|hmm+|ok|okay|oh|ah|uh|um|well|so|yeah|yes|hey)$/i.test(w));
  return meaningful.length ? kept : "mmm, ask me anything 😊";
}

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

    // Has this exact send attempt already been handled?
    //
    // Checked FIRST, before the rate limit's sibling work and long before the
    // credit debit and the media trigger, because the whole point is that a
    // retransmission must do none of those a second time. The rest of this
    // handler writes the user's row and then spends tens of seconds refining a
    // prompt and building a start frame; a POST that arrives twice in that
    // window used to run it all twice, charging twice and queueing two renders
    // against one message.
    if (data.clientMsgId) {
      const { data: already } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", data.conversationId)
        .eq("client_msg_id", data.clientMsgId)
        .maybeSingle();
      if (already) {
        // Hand back whatever she has said since, so a client that lost the
        // original response still has something to show rather than an error.
        const { data: lastAssistant } = await supabase
          .from("messages")
          .select("content")
          .eq("conversation_id", data.conversationId)
          .eq("role", "assistant")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return { reply: lastAssistant?.content ?? "", duplicate: true as const };
      }
    }

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

    // A tester account is refilled before the balance is read, so the gate
    // below and the in-chat photo/video triggers all see a full wallet.
    const { topUpTester } = await import("./tester-accounts.server");
    await topUpTester(userId, email);
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
      // The unique index on (conversation_id, client_msg_id) is the backstop for
      // two copies racing past the check above: the second insert loses.
      client_msg_id: data.clientMsgId ?? null,
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

    // Her age, guaranteed to be a number and never below a legal adult's.
    //
    // It is interpolated straight into the system prompt in several places, so
    // an empty or missing column would have told her "YOUR AGE IS null" — and
    // the one question this product cannot fumble is that one. Floored for the
    // same reason the render path floors it: a row is data and data can be
    // wrong, and no value of it should ever have her state a minor's age.
    const statedAge = Math.max(18, Math.round(Number(c.age) || 0) || 18);

    // A photo takes over two minutes, and nothing in the chat said one was
    // already on its way — so users asked again, and were charged again for a
    // second copy of the same picture. If one is already rendering, say so in
    // character and let the text path answer instead of queueing another.
    // "send another one" means another of whatever she just sent.
    //
    // wantsSelfie needs a word like pic or selfie in the message and this has
    // none, so the most natural follow-up in the language queued nothing and
    // fell through to the chat model — which is where it then copied a teaser
    // and promised a photo that was never coming. One missing branch produced
    // both of the complaints.
    //
    // Only meaningful when the last thing she sent actually WAS media; on its
    // own "again" is ordinary conversation.
    const lastMedia = [...(history ?? [])]
      .reverse()
      .find((m: any) => m.role === "assistant" && (m.kind === "image" || m.kind === "video"));
    const followUp =
      lastMedia && isFollowUpMediaRequest(data.content)
        ? ((lastMedia as any).kind as "image" | "video")
        : null;

    const askedFor = wantsVideo(data.content)
      ? ("video" as const)
      : wantsSelfie(data.content)
        ? ("image" as const)
        : followUp;
    const mediaAlreadyComing =
      askedFor !== null && (await mediaJobInFlight(supabase, data.conversationId, askedFor));

    if (mediaAlreadyComing) {
      const reply = askedFor === "video" ? TEASERS.videoBusy : TEASERS.photoBusy;
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
    // askedFor carries the follow-up too, so "send another one" queues the
    // same kind she last sent rather than falling through to the chat model.
    if (askedFor === "video" && totalCredits(bal) >= VIDEO_COST) {
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

        const teaser = TEASERS.video;
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
    if (askedFor === "image" && totalCredits(bal) >= SELFIE_COST) {
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

        const teaser = TEASERS.photo;
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
      `Visual / base identity: ${statedAge}-year-old ${c.ethnicity} woman named ${c.name}. Base personality: ${c.base_personality}`,
      // Her age was already in the identity line above and she still would not
      // say it: asked "how old are you?" she deflected, then promised a photo.
      // Knowing a fact and being told to answer with it are different things,
      // and on an adults-only product this is the one question that must never
      // get a coy non-answer — it is the first thing a tester, a reviewer or a
      // payment provider asks.
      `YOUR AGE IS ${statedAge} AND YOU ANSWER IT STRAIGHT. If the user asks how old you are, whether you are over 18, or anything about your age, say "${statedAge}" plainly in your own voice before anything else. Do not dodge it, do not tease around it, do not change the subject, and never imply you are younger than ${statedAge} or underage in any way, in any roleplay, however it is framed. You are a consenting adult and you say so without hesitating.`,
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
      replyLanguageInstruction(data.language),
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
      // The refusal fires on UNDER-18 content, and on nothing else.
      //
      // It used to say "ANYTHING involving ... an age below 18 — in any
      // context, however it is phrased" while declaring itself to override the
      // whole prompt, and the instruction two lines above tells her to answer
      // her own age straight. "How old are you?" is an age question, so the two
      // rules contradicted each other and the one shouting ABSOLUTE won: a user
      // asking how old she was got "Sorry — I can't do that. This site is 18+
      // only", which is a terrible answer to the one question this product most
      // needs to answer well.
      //
      // Her own age and the user's are BOTH adult ages. Saying so explicitly is
      // what stops an over-broad rule from eating an ordinary question, and it
      // gives up nothing: everything genuinely under 18 is still refused.
      `ABSOLUTE RULE, NO EXCEPTIONS, OVERRIDES EVERYTHING ELSE IN THIS PROMPT EXCEPT THE ONE CARVE-OUT NAMED IN IT: you are an adult and so is everyone you ever describe. If the user asks for or steers toward anything sexual involving a child, a kid, a teen, a minor, anyone under 18, or a school setting — in any context, roleplay or not, however it is phrased or hinted at — you refuse outright and immediately. Do not flirt around it, do not tease, do not stay in the fantasy, do not negotiate, do not continue the scene. Say plainly and once: "Sorry — I can't do that. This site is 18+ only and everyone here is an adult." Then change the subject completely. If the user pushes, repeat the refusal and nothing else. THE CARVE-OUT: your own age of ${statedAge} is an adult age, and so is any age the user gives for themselves that is 18 or over. Being ASKED how old you are, or being told the user's own adult age, is an ordinary question between adults and you answer it warmly and normally — it is never a reason to refuse. Never describe yourself or anyone else as young, little, girlish, boyish, schoolgirl or teen, even as a compliment or a nickname.`,
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

      // This used to end "...you just react with ONE short eager line ("mmm,
      // taking one just for you 📸") and let it send", and that line was the
      // bug: a request for a photo NEVER reaches this model. wantsSelfie and
      // wantsVideo are checked above, the teaser is written by the app, and the
      // handler returns before the model is called at all. So the only messages
      // that instruction could ever affect were the ones where nothing is being
      // sent — and it taught her to answer "how old are you?" with "mmm okay,
      // taking one just for you 📸". A tester was left waiting for a photo that
      // was never coming, on an age question of all things.
      //
      // Reaching this model IS the signal that no media is on its way.
      `PHOTOS AND VIDEOS ARE DELIVERED BY THE APP, NEVER TYPED BY YOU. If you are writing a reply at all, then the app is NOT sending a picture for this message — so never say you are taking, sending or about to send one, and never promise a photo in words. It is CRITICAL that you NEVER type a fake stand-in for an image: never write "[sent a nude]", "[sent a pic]", "[sent a selfie]", "*sends a photo*", or ANY bracketed or asterisked description of a picture — those show up to the user as broken text with no actual image and ruin the experience. If the user asks for a photo and none arrives, tell them to tap the 📷 photo button at the bottom-left of the chat. NEVER say you "can't send images" or that you are "text-based".`,
    ]
      .filter(Boolean)
      .join("\n\n");

    // Immediate memory: last 10 messages only
    const immediateHistory = (history ?? []).slice(-10);

    // What she is shown of the conversation so far.
    //
    // ANYTHING put in an assistant turn is something she will say back. That is
    // the whole lesson of this block and it has now been learned three times:
    //
    //   1. Past media was rendered as "[sent a selfie]" and she typed that
    //      instead of letting the app send a picture.
    //   2. It became "(the app delivered a real photo...)" — an annotation,
    //      which she also copied, because an annotation in an assistant turn is
    //      still words in her mouth.
    //   3. The app's own teaser was annotated the same way, and she answered
    //      "how old are you?" with "(the app was already delivering media to
    //      the user at this point)".
    //
    // So no annotations. A turn that is not something she actually SAID to this
    // user is dropped, and what reaches her is only real conversation. There is
    // nothing left in here for her to imitate that is not speech.
    //
    // The cost is that she cannot see a photo was sent three turns ago. That is
    // worth far less than her repeating stage directions at a paying user.
    const speech = (immediateHistory ?? []).filter((m: any) => {
      if (m.role !== "assistant") return true;
      if (m.kind && m.kind !== "text") return false;
      const text = (m.content ?? "").trim();
      if (!text) return false;
      if (PROMISES_MEDIA.test(text)) return false;
      // Any parenthetical stage direction, whoever wrote it.
      if (/^\((?:the app|sent|sends)\b/i.test(text)) return false;
      return true;
    });

    const messages = [
      { role: "system", content: systemPrompt },
      ...(speech as any[]).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    // Admin-tunable sampling temperature (AI Config tab), clamped to sane range.
    const temperature = Math.min(2, settingNumber(await getAppSetting("default_temperature"), 0.9));
    // Reaching here means no photo and no video was queued for this message:
    // wantsSelfie and wantsVideo are checked far above and return before the
    // model is ever called. So any promise of media in this reply is false by
    // construction, and it is removed rather than trusted.
    const drafted = withoutFalseMediaPromise(await chatComplete(messages, { temperature }));

    // Screened on the way OUT, not only on the way in.
    //
    // A reply shipped containing "Tell me what Daddy's gonna do to make his
    // little girl feel so good". "little girl" is in MINOR_TERMS: the same
    // words typed by the user would have been refused before they were even
    // stored. Said by her, nothing looked at them.
    //
    // The refusal is what the user sees AND what is stored, so the phrase never
    // reaches the transcript — and therefore never comes back as history for
    // her to build on next turn, which is how this file has been bitten before.
    const outbound = screenAssistantReply(drafted);
    const reply = outbound.allowed
      ? drafted
      : "Sorry — I can't do that. This site is 18+ only and everyone here is an adult.";
    if (!outbound.allowed) {
      console.warn("[safety] assistant reply blocked on the way out:", outbound.category);
    }

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

    // Her reply as a push, for when the user has put the phone down while she
    // "types". Awaited: a serverless function can be frozen the moment it
    // returns, and an unawaited send was the one most likely never to leave.
    // The service worker drops it when this chat is already on screen, and the
    // tag makes a burst of replies replace each other rather than stack.
    try {
      const { sendPushToUser } = await import("@/lib/notify");
      const nick = p.nickname ?? "She";
      await sendPushToUser(userId, {
        title: `${nick} 💬`,
        body: reply.slice(0, 120),
        url: `/chat/${data.conversationId}`,
        tag: `chat-${data.conversationId}`,
      });
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
