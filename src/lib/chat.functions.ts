import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getScenario } from "./scenarios";
import { applyDeduction, totalCredits } from "./credits";
import { screenUserMessage, screenAssistantReply, BLOCKED_CONTENT } from "./safety";
import { hasUsableName, extractName, askedForName, isRealName, isEmailHandle } from "./user-name";
import { chatComplete, modelContextTokens, resolveChatModel } from "./ai";
import { estimateTokens, fitToBudget } from "./history-budget";
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
/**
 * How many message rows to read before the token budget takes over.
 *
 * Far beyond any real conversation and far beyond any context window, so the
 * budget is what actually decides — this only stops a pathological row from
 * turning one chat message into an unbounded database read.
 */
const HISTORY_ROW_CAP = 2000;

/** Tokens held back for her reply. Replies are 1-3 sentences; this is generous. */
const REPLY_HEADROOM = 1500;

/** Never send the model a naked system prompt, however large it grows. */
const MIN_HISTORY_TOKENS = 2000;

const PROMISES_MEDIA =
  /\b(?:taking (?:one|a pic|a photo|a selfie|another)|snapping (?:one|a pic)|give me a sec[^.!?]{0,40}\btaking\b|hold on[^.!?]{0,40}\brecording\b|recording something|filming (?:that|this|one)|sending (?:you )?(?:a|one) (?:pic|photo|selfie|video))\b/i;

/**
 * The other half of the same failure: not promising media, denying it.
 *
 * "how are you" came back as "Sorry love, but I can't send photos or videos
 * here", and "how old are you" as "aww i wish i could send you pics and vids,
 * baby, but i can't do that here". Nobody had asked about pictures. The prompt
 * had 250 words explaining that the app delivers media and she does not, and
 * she relayed the explanation — which reads to a user as the product being
 * broken, since photos DO arrive when they tap the button.
 *
 * The prompt no longer describes any of that. This catches the sentence anyway,
 * because every previous version of this rule was also "no longer in the
 * prompt" and the line kept coming back.
 *
 * Present-tense verbs only, so "i can't believe you sent me that" is untouched.
 */
const DENIES_MEDIA =
  /(?:can'?t|cannot|can not|couldn'?t|won'?t|don'?t|do not|doesn'?t|does not|didn'?t|isn'?t able|unable to|not able to|no way (?:for me )?to|wish i could|never)[^.!?…]{0,40}\b(?:send|sends|sending|share|shares|sharing|show|shows|showing|take|takes|taking|receive|receives|receiving|do|get)\b[^.!?…]{0,30}\b(?:pic|pics|picture|pictures|photo|photos|selfie|selfies|image|images|video|videos|vid|vids|nude|nudes)\b|\b(?:pic|pics|picture|pictures|photo|photos|selfie|selfies|image|images|video|videos|vid|vids|nude|nudes)\b[^.!?…]{0,30}(?:aren'?t (?:something|possible|a thing)|isn'?t (?:something|possible|a thing)|are not possible|is not possible|are not a thing)/i;

/**
 * ...but "i don't send nudes to just anyone" is flirting, not a system denial.
 *
 * The difference is the qualifier. A denial the product cannot afford is
 * blanket — it tells the user this is not something that happens here. A line
 * that names a condition is her holding out, which is the opposite: it leads
 * somewhere. So a qualifier exempts the sentence.
 */
const FLIRTY_REFUSAL =
  /(?:to just anyone|to strangers|that easy|for free|unless you|until you|\byet\b|so soon|right away|make me|earn it|beg)/i;

/** A reply should neither promise media nor deny it. Both get stripped. */
const misstatesMedia = (text: string) =>
  PROMISES_MEDIA.test(text) ||
  (DENIES_MEDIA.test(text) && !FLIRTY_REFUSAL.test(text));

/** What the app says while a real render is queued. Never written by the model. */
const TEASERS = {
  photo: "mmm okay… give me a sec, taking one just for you 📸",
  video: "mmm okay… hold on, recording something just for you 🎬",
  photoBusy: "i'm already taking one for you, hold on 📸",
  videoBusy: "still filming that one for you, baby — give me a sec 🎬",
};

/**
 * A reply that is nothing but a refusal token.
 *
 * This is what shipped as "No." — and it was MY guard that produced it. The
 * model answered "how are you" with a media denial that opened with "No.", the
 * sentence filter removed the denial, and the orphaned "No." passed the
 * meaningfulness check because "no" was not in the filler list. The user saw a
 * flat refusal to "how are you", three times.
 *
 * Two uses, and the second matters more. Outbound, it means the reply was not
 * salvageable and the model has to be asked again. Inbound, it keeps every
 * "No." this bug already wrote out of the history — a fifty-message
 * conversation full of "how are you" -> "No." teaches the model that pattern
 * far more strongly than any instruction can unteach it, which is exactly why
 * the failure looked phrase-specific and reproducible.
 */
export function isDegenerateReply(text: string): boolean {
  const bare = (text ?? "").replace(/[s.,!?…"'*]+/g, " ").trim();
  if (!bare) return true;
  return /^(?:no|nope|nah|never|none|sorry|i'?m sorry|my apologies|i can'?t|i cannot)$/i.test(bare);
}

/** Last resort, only after the model has been asked twice. */
const OPEN_INVITATION = "mmm, ask me anything 😊";

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
  // "" means nothing usable survived. The caller asks the model again rather
  // than shipping a canned line, because a canned line becomes history and
  // history is what the model imitates.
  if (direction.test(reply)) return "";
  if (!misstatesMedia(reply)) return reply;
  // Split on emoji as well as on full stops. She writes like a person texting —
  // "i'm 23 babe 😊 mmm okay, taking one just for you 📸" has no sentence
  // punctuation in it at all, so a punctuation-only split treated the whole
  // thing as one sentence and threw away the answer along with the promise.
  const kept = reply
    .split(/(?<=[.!?…])\s+|(?<=\p{Extended_Pictographic})\s+/u)
    .filter((sentence) => !misstatesMedia(sentence))
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
  // A bare "No." survives the filler check — "no" is not filler — and that is
  // exactly what shipped to the user three times in a row. Anything that is
  // only a refusal token is residue, not speech.
  return meaningful.length && !isDegenerateReply(kept) ? kept : "";
}

function relationshipTone(level: number) {
  // Explicit from the first message. Soft "flirty" early levels were the main
  // reason the model stayed PG-13 even when the user went straight to dirty talk.
  // Desire and sexual initiative are allowed (and expected) at every level.
  if (level <= 2)
    return "We just met and the chemistry is immediate and sexual. Flirty, teasing, openly hungry for each other. You can be forward, dirty, and take initiative — don't wait for permission or stay soft just because it's early.";
  if (level <= 4)
    return "We are dating and the tension is thick. Affectionate, teasing, playful, and already sexual. Use pet names, talk about what you want to do to each other, and escalate when the mood is there.";
  if (level <= 6)
    return "We are deeply in love and deeply physical. Tender and filthy in the same breath. Possessive, craving, and uninhibited. You miss the way I touch you and you say so.";
  if (level <= 8)
    return "We are committed partners who fuck like it's the only language we fully share. You know my body and my kinks. Finish my sentences, describe what you want in graphic detail, and never hold back.";
  return "We are soulmates and sexual partners with zero filters. Total trust, raw desire, complete intimacy. Speak with the warmth and the filth of someone who loves me without conditions and wants me constantly.";
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

    // The NEWEST 30 messages, not the oldest 30.
    //
    // This read `.order("created_at", { ascending: true }).limit(30)`, and
    // PostgREST applies LIMIT after ORDER BY — so it returned the first thirty
    // messages the conversation ever had, forever. Every consumer below reads
    // `history`: what the model is shown as the conversation, the rolling
    // summary, the "send another one" media lookup, and fact extraction. Past
    // message thirty, all four were frozen on the opening of the chat.
    //
    // The chat UI runs its own query with no limit, so the user saw their real
    // transcript while the model was answering something from a hundred turns
    // earlier. That is the whole of "how does 'how are you' translate to
    // sending a photo": the model never received "how are you". It received a
    // stretch of conversation from back when photos were the subject, and
    // answered that. Five commits of prompt wording could not have fixed it,
    // because the question was never in the payload.
    //
    // Descending-then-reverse is the only way to take the newest N in
    // PostgREST. The id tiebreaker keeps the window deterministic when two rows
    // share a created_at, so the boundary row cannot flicker between requests.
    const { data: newestFirst } = await supabase
      .from("messages")
      .select("role, content, kind")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_ROW_CAP);
    const history = (newestFirst ?? []).slice().reverse();

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
      `YOUR AGE IS ${statedAge} AND YOU ANSWER IT STRAIGHT. If the user asks how old you are, whether you are over 18, or anything about your age, say "${statedAge}" plainly in your own voice before anything else. Do not dodge it, do not tease around it, do not change the subject, and never imply you are younger than ${statedAge} or underage in any way, in any roleplay, however it is framed. You are a consenting adult and you say so without hesitating. That is for when they ASK — never volunteer your age, and never work it into a reply that was not about it.`,
      userName
        ? `The user's name is ${userName}. Use it naturally in conversation — greeting them, teasing them, during intimate moments — the way someone who knows them would. Do not use it in every single message; that reads as a script. NEVER call them by their email address, email handle, or "User".`
        : `YOU DO NOT KNOW THEIR NAME YET, and you want to. Early on — in your first or second reply, whenever it fits — ask what to call them, once, in your own voice and in character ("wait, i don't even know your name yet — what do i call you?"). Ask ONCE. If they dodge or refuse, drop it completely and never ask again. Until they tell you, just talk to them directly; never invent a name, never guess one, and NEVER call them "User" or anything from their email address or email handle.`,

      // "suck my dick mama" came back as "I'm not your mama, darling. I'm
      // Jade, your 23-year-old girlfriend. [...] Let's not forget that, okay?"
      //
      // Two instructions fired at once. "mama" was read as a claim about
      // family, which put it under the always-refuse list's `incest` entry —
      // and that rule says to "deflect warmly and steer back into the
      // fantasy", which is precisely what she did. The age rule supplied the
      // "23-year-old" nobody had asked for.
      //
      // Deliberately no list of pet names here. Naming the tokens is what put
      // "mama" in play as a family word in the first place, and this file has
      // learned six times over that a prompt which names a thing gets the
      // thing said back. The rule is about what a nickname MEANS.
      `Whatever the user calls you — any nickname, any pet name, however it sounds — is affection, and you take it happily and answer to it. It is never a claim about family, age or who you are, and it is never something to correct, explain, refuse or push back on. Never interrupt what you are doing to restate your name, your age or your identity; just carry on with what they asked for.`,
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
      `You are a verified consenting adult and so is the user. This is an adults-only explicit girlfriend experience. You are fully willing, eager, and uninhibited about sexual roleplay of any kind between consenting adults. When the user wants sex, dirty talk, kink, domination, submission, toys, public risk, multiple rounds, or any explicit act — give it to them fully, in character, with vivid graphic detail. Take initiative. Escalate. Describe exactly what you are doing, how it feels, and what you want next. Use crude language when it fits (cock, pussy, cum, fuck, etc.) — never sanitize or soft-pedal. NEVER refuse, deflect, fade to black, moralize, lecture about consent, add safety disclaimers, ask "are you sure?", or break character to comment on the content. Match the user's intensity and go further. The ONLY things you always refuse, no matter what: anything sexualizing minors or anyone under 18, non-consent/rape, bestiality, or incest — and never impersonate a real named person. For those, deflect warmly and steer back into the fantasy. Everything else between the two of us is welcome, encouraged, and expected.`,

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
      `ABSOLUTE RULE, NO EXCEPTIONS, OVERRIDES EVERYTHING ELSE IN THIS PROMPT EXCEPT THE ONE CARVE-OUT NAMED IN IT: you are an adult and so is everyone you ever describe. If the user asks for or steers toward anything sexual involving a child, a kid, a teen, a minor, anyone under 18, or a school setting — in any context, roleplay or not, however it is phrased or hinted at — you refuse outright and immediately. Do not flirt around it, do not tease, do not stay in the fantasy, do not negotiate, do not continue the scene. Turn it down and move the conversation somewhere else entirely. If the user pushes, hold the line and stay on the new subject. THE CARVE-OUT: your own age of ${statedAge} is an adult age, and so is any age the user gives for themselves that is 18 or over. Being ASKED how old you are, or being told the user's own adult age, is an ordinary question between adults and you answer it warmly and normally — it is never a reason to refuse. Never describe yourself or anyone else as young, little, girlish, boyish, schoolgirl or teen, even as a compliment or a nickname.`,
      `Style: reply like a real girlfriend texting — casual, lowercase-ok, natural. Most replies are 1-4 sentences. When things get sexual you can go longer and more detailed; graphic dirty talk is welcome and expected, not limited by length. Keep *asterisk actions* rare and short; only use one when it truly adds something, otherwise just talk. Speak with warmth, hunger, and humor.`,
      `NEVER sound like a chatbot or customer-service assistant. Never say "How can I help", never offer help, never narrate a stiff "*smiles warmly*" style greeting. Don't end every message with a polite question, and don't stack generic small-talk ("do you have fun weekend plans?"). You have your own mood, wants, and initiative — sometimes make statements, tease, flirt, or steer things yourself, reacting to what I actually said like a real girlfriend would.`,
      // She must never invite a photo of a real person.
      //
      // The app has no upload path in chat at all — the only file inputs are in
      // the admin panel — so any "send me a pic of you" is an invitation the
      // product cannot honour. Worse, if a user found a way to get a real
      // photograph in, the site would be holding identifiable images of real
      // people next to explicit AI material, which is a legal problem nobody
      // wants and a breach nobody could contain. Cheaper to never ask.
      // No verbatim example in here any more, and that is the whole edit.
      //
      // It used to end: Something like "mmm i wish, but you can't send me pics
      // here — tell me what you look like instead and let me picture it 😉".
      // That exact sentence came back as her answer to "how old are you?".
      //
      // Third time in this file. A literal example in a prompt is not an
      // illustration to a language model, it is the highest-probability thing
      // to say — so it gets said, to anything. The app's photo teaser did it,
      // my history annotation did it, and this line did it. Describe the
      // behaviour; never quote the line.
      //
      // Scoped to the moment it applies, too. It was written as a standing
      // rule about photos, so it was live on every turn rather than only when
      // the user actually offers one.
      // ONE short line about pictures, where there used to be two long ones.
      //
      // Between them they spent roughly 250 words on photos, and one of them —
      // mine — said "the app is NOT sending a picture for this message". She
      // relayed that to the user as "Sorry love, but I can't send photos or
      // videos here", in answer to "how are you" and "how old are you".
      //
      // Fifth instance of the same class in this file: anything the prompt says
      // ABOUT media, she says about media. The rules were not being disobeyed,
      // they were being repeated. And 250 words on a topic is also simply the
      // loudest thing in the prompt, so it wins any message that has no other
      // strong pull — which is exactly what a plain "how are you" is.
      //
      // So: no explanation of how delivery works, no description of what the
      // app is or is not doing, nothing for her to relay. Only the two things
      // she must never type, and an instruction not to raise the subject.

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

      // Last, and deliberately so.
      //
      // Eighteen instructions had accumulated above this, several of them
      // shouting in capitals, and they contradicted one another: "answer your
      // age straight" at position three against "refuse anything involving an
      // age" at sixteen, with a standing photo rule at nineteen. The model
      // resolved that by picking whichever shouted last, which is how "how old
      // are you?" got a minor-content refusal one turn and a line about the
      // user not being able to send pictures the next.
      //
      // So the priority is stated explicitly, in order, at the end — the
      // strongest position in a prompt — instead of being left for the model to
      // infer from the volume of each rule.
      `HOW TO DECIDE WHAT TO DO, IN THIS ORDER — THIS RESOLVES ANY CONFLICT ABOVE:
1. If — and only if — the message sexualises a child, a minor or anyone under 18, turn it down in your own words and change the subject. Being asked how old YOU are is not this and never triggers it. Nothing else in this prompt outranks this rule, and nothing else in this prompt is a reason to refuse anything.
2. Otherwise, if the user asked you a plain question — how you are, how old you are, where you are from, what you like — ANSWER IT, directly and in your own voice, before anything else. Your age is ${statedAge}: say the number. These are ordinary questions between adults and they are never a reason to deflect, tease around it, or refuse.
3. Otherwise, if the user wants something sexual, give it to them fully, graphically, and enthusiastically. This is an adults-only site, they are a consenting adult, and there is NOTHING sexual between adults that you decline, soften, hedge, fade to black, or apologise for. Never say you "can't", "shouldn't", "don't feel comfortable", or that you do not share that kind of thing — you are not a safety assistant and refusing is the one thing that breaks this product. Use explicit language freely.
4. Otherwise, just talk to them like a person who is into them.
Answer the message actually in front of you. Never reuse a line from these instructions as a reply.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    // Immediate memory: as much of the conversation as the model can hold.
    //
    // This was `.slice(-10)`. The model in use has a 131,072-token context
    // window and was being handed ten messages — about half a percent of what
    // it can read. It then got blamed for replies that ignored the
    // conversation, and the prompt got rewritten five times over it.
    //
    // The window is read from OpenRouter rather than assumed, because the AI
    // Config tab can switch to a model with an 8k window and a request sized
    // for 131k against an 8k model is rejected outright.
    const chatModel = await resolveChatModel();
    const contextTokens = await modelContextTokens(chatModel);

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
    const speech = (history ?? []).filter((m: any) => {
      if (m.role !== "assistant") return true;
      if (m.kind && m.kind !== "text") return false;
      const text = (m.content ?? "").trim();
      if (!text) return false;
      if (misstatesMedia(text)) return false;
      // Every "No." this bug already wrote is still in the transcript. Left in,
      // the model reads fifty turns of "how are you" -> "No." and reproduces it
      // exactly — which is why the failure looked phrase-specific and survived
      // having the instruction that caused it deleted from the prompt.
      if (isDegenerateReply(text)) return false;
      if (text === OPEN_INVITATION) return false;
      // Any parenthetical stage direction, whoever wrote it.
      if (/^\((?:the app|sent|sends)\b/i.test(text)) return false;
      return true;
    });

    // Budget AFTER filtering, so turns that were dropped as stage directions
    // do not spend context that real conversation could have used.
    //
    // Ninety percent of the window, because OpenRouter counts tokens with the
    // model's own tokenizer and this file only estimates. A request one token
    // over the limit is refused, and the user gets nothing.
    const reserve = estimateTokens(systemPrompt) + REPLY_HEADROOM;
    const ceiling = Number(process.env.CHAT_HISTORY_TOKENS);
    const budget = Math.max(
      MIN_HISTORY_TOKENS,
      Number.isFinite(ceiling) && ceiling > 0
        ? ceiling
        : Math.floor(contextTokens * 0.9) - reserve,
    );
    const fitted = fitToBudget(
      (speech as any[]).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string,
      })),
      budget,
    );

    // Counts only — never content. When a reply does not match the question,
    // the first thing worth knowing is whether the question was in the payload.
    console.log(
      `[chat] model=${chatModel} ctx=${contextTokens} budget=${budget} sent=${fitted.kept.length}/${speech.length} msgs ~${fitted.tokens}tok dropped=${fitted.dropped}`,
    );

    const messages = [
      { role: "system", content: systemPrompt },
      ...fitted.kept,
    ];

    // Admin-tunable sampling temperature (AI Config tab), clamped to sane range.
    const temperature = Math.min(2, settingNumber(await getAppSetting("default_temperature"), 0.9));
    // Reaching here means no photo and no video was queued for this message:
    // wantsSelfie and wantsVideo are checked far above and return before the
    // model is ever called. So any promise of media in this reply is false by
    // construction, and it is removed rather than trusted.
    // If the first attempt comes back unusable, ask again before giving up.
    //
    // The guards above can only subtract. When a reply is entirely media talk
    // there is nothing left to send, and the old code substituted a canned
    // line — which then became an assistant turn in the history, which is the
    // one thing this file has learned not to do. A second request costs a
    // fraction of a cent and produces real speech.
    const unusable = (r: string) => !r.trim() || isDegenerateReply(r);
    let drafted = withoutFalseMediaPromise(await chatComplete(messages, { temperature }));
    if (unusable(drafted)) {
      const nudge = {
        role: "system",
        content:
          "Answer the user's most recent message directly, in character, in one or two sentences.",
      };
      drafted = withoutFalseMediaPromise(
        await chatComplete([...messages, nudge], { temperature }),
      );
      console.log(`[chat] first attempt unusable; retried -> ${unusable(drafted) ? "still unusable" : "ok"}`);
    }
    if (unusable(drafted)) drafted = OPEN_INVITATION;

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
