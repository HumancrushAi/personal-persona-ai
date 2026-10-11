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
// Licking her own breast still comes up face-up about one render in three,
// guide or no guide, so it gets one more try than the other checked acts.
export const BREAST_RETAKES = 3;

export function maxRetakesFor(question: string | null, fallback: number): number {
  return question && /own breast/.test(question) ? Math.max(fallback, BREAST_RETAKES) : fallback;
}

export type Candidate = { url: string; score: number | null };

// The yes/no the vision model is asked, per act. Null means the act is not
// one that gets checked.
export function verifyQuestion(userRequest: string, hasBreasts: boolean, hasVulva = true): string | null {
  const req = userRequest ?? "";
  const climax =
    /\b(?:cum\w*|squirt\w*|gush\w*|orgasm\w*|climax\w*|jizz|spunk|ejaculat\w*|nut|nutting|bust\w*\s+(?:a\s+)?nut|shoot\w*\s+(?:your|his|her|my|a)\s+load|come\s+for\s+me|get\s+off|cream\w*)\b/i.test(req);
  if (climax && !hasVulva)
    return "Is cum visibly spurting or dripping from the person's own penis, with their hand on it?";
  if (climax && /\b(?:squirt\w*|gush\w*|cum\w*|come)\b/i.test(req))
    return "Is a visible spray or stream of clear fluid squirting from the woman's own pussy, with her face in orgasm?";
  if (climax)
    return "Does the woman's face show orgasm (eyes shut, mouth open) with her pussy visibly wet and her own hand on it?";
  if (
    hasBreasts &&
    /\b(?:squeez\w*|hold\w*|cup\w*|grab\w*|press\w*|pinch\w*|massag\w*|play\w*\s+with|fondl\w*|lift\w*)\b[^.?!]{0,20}\b(?:her|his|their|your|own)\s+(?:own\s+)?(?:tits?|titties|boobs?|boobies|breasts?|nipples?)\b/i.test(req) &&
    !/\b(?:lick\w*|suck\w*|kiss\w*)\b/i.test(req)
  )
    return "Are the woman's own hands on her own breasts, squeezing, cupping or pinching them?";
  if (hasVulva && /\bmasturbat\w*/i.test(req))
    return "Is one of the woman's own hands between her legs touching her own pussy?";
  if (
    hasVulva &&
    /\b(?:rub\w*|finger\w*|touch\w*|play\w*\s+with|stroke\w*|masturbat\w*|pleasur\w*)\b[^.?!]{0,30}\b(?:her|his|their|your|own|)\s*(?:self|pussy|clit\w*|vulva|cunt|slit)\b/i.test(req)
  )
    return "Is one of the woman's own hands between her legs with her fingers touching or rubbing her own pussy?";
  const breastOral =
    /\b(?:lick\w*|suck\w*|kiss\w*|bit(?:e|es|ing)|nibbl\w*|tongu\w*)\b[^.?!]{0,30}\b(?:her|his|their|own|your)\s+(?:own\s+)?(?:tits?|titties|boobs?|boobies|breasts?|nipples?|chest)\b/i;
  if (hasBreasts && breastOral.test(req))
    // The hands are part of the question: a render with her head down and her
    // tongue out but licking her own fingers scored as a pass.
    // The owner's definition, word for word: she carries the breast up with her
    // hands and her tongue or lips touch the nipple — not a hand, not a finger.
    // A render with the mouth on the breast beside the nipple is most of the
    // way there and must score well above a face-up one; licking her own
    // fingers must not.
    return "Is the woman's head bent down to her own breast with her mouth or tongue touching that breast at or next to the nipple, while her hands hold or lift the breast? Score 9-10 if the tongue or lips clearly touch the nipple; 6-8 if the mouth is on the breast near the nipple; 0-2 if she is licking her hand or fingers, or her face is turned up or toward the camera.";
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
