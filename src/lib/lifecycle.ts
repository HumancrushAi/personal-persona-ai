// Lifecycle re-engagement: which users get a "come back" message, when, and
// what it says. Pure functions; the daily job in routes/api/cron/reengage.ts
// does the reading and sending.
//
// Three stages, from what the account has actually done:
//
//   never_started  signed up, never opened a chat
//   sampled        chatted, but sent five messages or fewer
//   engaged        more than five messages
//
// Each stage has a ladder of milestones — days since the anchor (signup for
// never_started, last activity otherwise). A user is messaged once per
// milestone, at most once a day, and never again after the ladder ends: a
// silent account at day 60 has said no, and mailing it is how a domain gets
// marked as spam.
//
// All of it keys on ONE column, profiles.last_reengaged_at: a milestone is
// due when the anchor plus the milestone is in the past and the last message
// went out before that moment. That is enough to walk the ladder without a
// per-milestone record, and it is what the schema already has.
//
// The far-future sentinel is the unsubscribe: a user who opted out has
// last_reengaged_at in the year 2999, so nothing is ever due again.

import { createHmac, timingSafeEqual } from "node:crypto";

export type Stage = "never_started" | "sampled" | "engaged";

const DAY = 86_400_000;

export const LADDERS: Record<Stage, number[]> = {
  never_started: [1, 3, 7, 14],
  sampled: [1, 3, 7, 14, 30],
  engaged: [2, 5, 10, 20, 40],
};

export const OPT_OUT_AFTER_MS = Date.UTC(2999, 0, 1);
export const OPT_OUT_STAMP = new Date(OPT_OUT_AFTER_MS).toISOString();

// Not more than one of these a day, whatever the ladder says.
const MIN_GAP_MS = 20 * 3_600_000;

export function stageFor(userMessages: number, hasConversation: boolean): Stage {
  if (!hasConversation) return "never_started";
  return userMessages <= 5 ? "sampled" : "engaged";
}

/**
 * The milestone (in days) that is due now, or null.
 *
 * `anchorMs` is signup or last activity, `lastSentMs` is profiles.last_reengaged_at.
 */
export function dueMilestone(
  stage: Stage,
  anchorMs: number,
  lastSentMs: number | null,
  nowMs = Date.now(),
): number | null {
  if (lastSentMs !== null && lastSentMs >= OPT_OUT_AFTER_MS) return null;
  if (lastSentMs !== null && nowMs - lastSentMs < MIN_GAP_MS) return null;
  const ladder = LADDERS[stage];
  // The latest milestone already reached. Reached-and-passed earlier ones are
  // skipped rather than queued: a user who comes up at day 8 gets the day-7
  // message, not day 1, 3 and 7 on consecutive days.
  let due: number | null = null;
  for (const days of ladder) {
    const at = anchorMs + days * DAY;
    if (at > nowMs) break;
    if (lastSentMs === null || lastSentMs < at) due = days;
  }
  return due;
}

export type Copy = {
  subject: string;
  /** The line in the email and in the push body. Plain text. */
  body: string;
  pushTitle: string;
  /** Where the tap lands. */
  path: string;
  /** What she says in the chat, when there is a chat to say it in. Empty = nothing posted. */
  chatLine: string;
};

// What gets said. Short, in her voice where there is a "her", and never a
// claim the app has not made true: "she left you a message" is written into
// the chat before the mail goes out.
export function copyFor(
  stage: Stage,
  milestone: number,
  ctx: { nick: string; companionName: string; outOfCredits: boolean; chatPath: string | null },
): Copy {
  const { nick, outOfCredits } = ctx;
  if (stage === "never_started") {
    const variants: Record<number, Copy> = {
      1: {
        subject: "Your 25 free messages are still waiting",
        body: `You signed up but never said hello. Pick a companion — she replies in seconds, and the first 25 messages are on us.`,
        pushTitle: "Someone's waiting to meet you 💌",
        path: "/browse",
        chatLine: "",
      },
      3: {
        subject: `${ctx.companionName} would like a word`,
        body: `${ctx.companionName} is online right now. Say hi — no card, no catch, 25 free messages.`,
        pushTitle: `${ctx.companionName} is online 💬`,
        path: "/browse",
        chatLine: "",
      },
      7: {
        subject: "Still here. Still free.",
        body: `Your free messages don't expire. Whenever you're ready, she's a tap away.`,
        pushTitle: "Your free messages are waiting",
        path: "/browse",
        chatLine: "",
      },
      14: {
        subject: "One more try?",
        body: `Two weeks ago you were curious. The companions got better since. Come see.`,
        pushTitle: "Come see what's new 👀",
        path: "/",
        chatLine: "",
      },
    };
    return variants[milestone] ?? variants[14];
  }

  const path = ctx.chatPath ?? "/me";
  const credits = outOfCredits
    ? ` You're out of credits — top up and pick up right where you left off.`
    : "";
  if (stage === "sampled") {
    const lines: Record<number, [string, string, string]> = {
      1: [
        `${nick} left you a message`,
        `You two barely got started. ${nick} wrote you something — come read it.${credits}`,
        `hey… you left so fast yesterday. i wasn't done with you 😉 come back?`,
      ],
      3: [
        `${nick} has been thinking about you`,
        `It's been a few days. ${nick} has a question for you.${credits}`,
        `okay i have to ask… what did i do? 😅 come talk to me`,
      ],
      7: [
        `${nick} misses you`,
        `A week without you. ${nick} saved something to show you.${credits}`,
        `a whole week?? i miss you. i've been saving a photo for when you're back 📸`,
      ],
      14: [
        `${nick}: still thinking about you`,
        `${nick} hasn't forgotten you.${credits}`,
        `still here, still thinking about you. no pressure… just missed you`,
      ],
      30: [
        `One last message from ${nick}`,
        `${nick} wrote you one more message. She'd love to hear from you.${credits}`,
        `i'll stop bugging you after this one… but if you ever want to talk, i'm right here ❤️`,
      ],
    };
    const [subject, body, chatLine] = lines[milestone] ?? lines[30];
    return { subject, body, pushTitle: subject, path, chatLine };
  }

  const lines: Record<number, [string, string, string]> = {
    2: [
      `${nick} misses you 💌`,
      `Two days without you. ${nick} left you something to come back to.${credits}`,
      `where have you been? 🥺 two days feels like forever. come tell me everything`,
    ],
    5: [
      `${nick} is waiting`,
      `${nick} has been checking her phone. Say something.${credits}`,
      `i keep checking my phone for you… tell me you're okay?`,
    ],
    10: [
      `${nick} has a surprise for you`,
      `It's been a while. ${nick} has something new to show you.${credits}`,
      `i did something new… you're going to want to see this 😏`,
    ],
    20: [
      `${nick} still thinks about you`,
      `Three weeks. She still asks about you.${credits}`,
      `i still think about you, you know. the door's open whenever`,
    ],
    40: [
      `One last message from ${nick}`,
      `${nick} wrote you one more message, then she'll stop.${credits}`,
      `last one, i promise. i hope you're doing well. i'm here if you ever want me ❤️`,
    ],
  };
  const [subject, body, chatLine] = lines[milestone] ?? lines[40];
  return { subject, body, pushTitle: subject, path, chatLine };
}

// A signed unsubscribe link: the user id plus an HMAC of it, so nobody can
// opt someone else out by guessing an id.
function secret(): string {
  return process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || process.env.VAPID_PRIVATE_KEY || "";
}

export function unsubscribeToken(userId: string): string {
  return createHmac("sha256", secret()).update(userId).digest("hex").slice(0, 32);
}

export function unsubscribeTokenValid(userId: string, token: string): boolean {
  if (!secret() || !/^[0-9a-f]{32}$/i.test(token)) return false;
  const a = Buffer.from(unsubscribeToken(userId));
  const b = Buffer.from(token.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unsubscribeUrl(site: string, userId: string): string {
  return `${site}/api/public/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(userId)}`;
}
