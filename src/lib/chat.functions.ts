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
