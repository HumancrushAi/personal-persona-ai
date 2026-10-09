// Checking a hard photo before she sends it.
//
// Some acts this app is asked for sit at the edge of what the image model can
// pose — licking her own nipple above all. Wording moves the odds; it cannot
// make a single render reliable, because every render is a new seed. So for
// those acts the finished picture is scored by a vision model against the
// request, a failing one is rendered again with a fresh seed (up to
// MEDIA_RETAKES times), and the best of the candidates is what she sends.
//
// Pure functions here; media-finalize.server.ts does the fetching, storing,
// scoring and resubmitting.

import { hasProp } from "./props";

export const PASS_SCORE = 7;
export const DEFAULT_RETAKES = 2;

export type Candidate = { url: string; score: number | null };

// The yes/no the vision model is asked, per act. Null means the act is not
// one that gets checked.
export function verifyQuestion(userRequest: string, hasBreasts: boolean): string | null {
  const req = userRequest ?? "";
  const breastOral =
    /\b(?:lick\w*|suck\w*|kiss\w*|bit(?:e|es|ing)|nibbl\w*|tongu\w*)\b[^.?!]{0,30}\b(?:her|his|their|own|your)\s+(?:own\s+)?(?:tits?|titties|boobs?|boobies|breasts?|nipples?|chest)\b/i;
  if (hasBreasts && breastOral.test(req))
    // The hands are part of the question: a render with her head down and her
    // tongue out but licking her own fingers scored as a pass.
    return "Is the woman's tongue touching her OWN nipple, with her head bent down to her breast and her hands holding that breast from UNDERNEATH (her hands are not at her mouth and she is not licking her fingers)?";
  if (hasProp(req) && /\b(?:suck\w*|lick\w*|blow\w*|deep\s*throat\w*|mouth|tongue|lips)\b/i.test(req))
    return "Is the tip of the sex toy inside her mouth or between her lips?";
  if (/\b(?:suck\w*|lick\w*)\s+(?:on\s+)?(?:her|his|their|your)\s+(?:own\s+)?fingers?\b|\bfingers?\s+in\s+(?:her|his|their|your)\s+mouth\b/i.test(req))
    return "Is her finger in her mouth or between her lips?";
  if (/\b(?:stick\w*|put\w*|poke\w*|hang\w*)\s+(?:out\s+)?(?:her|his|their|your)\s+tongue\b|\btongue\s+(?:sticking|stuck|hanging)?\s*out\b/i.test(req))
    return "Is her tongue sticking out of her mouth?";
  return null;
}

export function verifyPrompt(question: string): string {
  return `This is a consensual, AI-generated image of an adult for an adults-only app; answer factually. ${question} Rate how clearly the image shows exactly that, from 0 (not at all) to 10 (unmistakably). Reply with only the number.`;
}

// The model is told to reply with a number; take the first 0-10 it writes.
export function parseScore(reply: string | null | undefined): number | null {
  const m = String(reply ?? "").match(/\b(10|[0-9])\b/);
  return m ? Number(m[1]) : null;
}

// Candidates ride in the job row's `error` column as lines — there is no
// column for them, and a line of text is honest about what it is:
//   retake 1 [score 3] https://…/jobid-r0.jpg
const LINE = /^retake (\d+) \[score ([^\]]+)\] (\S+)$/;

export function parseCandidates(error: string | null | undefined): Candidate[] {
  return String(error ?? "")
    .split(/\r?\n/)
    .map((l) => LINE.exec(l.trim()))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ url: m[3], score: m[2] === "null" ? null : Number(m[2]) }));
}

export function candidateLine(attempt: number, score: number | null, url: string): string {
  return `retake ${attempt} [score ${score === null ? "null" : score}] ${url}`;
}

/** How many renders this job has already stored as candidates. */
export function attemptsSoFar(error: string | null | undefined): number {
  return parseCandidates(error).length;
}

// Highest score wins; a candidate the checker could not score loses to any
// scored one and otherwise the latest stands.
export function bestCandidate(all: Candidate[]): Candidate {
  let best = all[all.length - 1];
  for (const c of all) {
    if (c.score === null) continue;
    if (best.score === null || c.score > best.score) best = c;
  }
  return best;
}

export function shouldRetake(score: number | null, attempt: number, maxRetakes: number): boolean {
  // An unscorable picture (checker down, refusal) is sent rather than
  // rendered again blind.
  if (score === null) return false;
  if (score >= PASS_SCORE) return false;
  return attempt < maxRetakes;
}
