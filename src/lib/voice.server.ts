// A companion's voice note: her own voice, with the sounds the moment calls for.
//
// With RUNPOD_TTS_ENDPOINT set, voice notes are spoken by Orpheus TTS on our own
// RunPod worker (docker/tts-worker) instead of OpenAI. Two reasons: Orpheus
// sounds human — breaths, sighs, laughs — where gpt-4o-mini-tts sounded like a
// computer, and it is self-hosted, so what she is allowed to say is the app's
// call rather than a TTS provider's content policy.
//
// Her text replies stay free of stage directions (chat.functions strips them).
// The sounds are added only here, by a short "performance" pass over the reply:
// it adds Orpheus emotion tags (<sigh> <gasp> <laugh> <groan> …) and [moan]
// cues without changing a word. A [moan] becomes a few seconds of a real moan
// recording from avatars/audio, spliced in at that point.
//
// Anything that goes wrong falls back to the OpenAI voice exactly as before.

import { chatComplete, textToSpeech } from "./ai";

const FEMALE = ["tara", "leah", "jess", "mia", "zoe"];
const MALE = ["leo", "dan", "zac"];
const ORPHEUS = new Set([...FEMALE, ...MALE]);
const TAGS = ["laugh", "chuckle", "sigh", "cough", "sniffle", "groan", "yawn", "gasp"];

/** True when the user is asking to hear her moan. */
export function asksForMoan(text: string): boolean {
  return /\b(moan\w*|groan\w*|make (?:some )?nois\w*|let me hear you|hear you (?:cum|come)|how you sound when|breath\w* heav\w*)\b/i.test(
    text ?? "",
  );
}

/** Her Orpheus voice: her own voice_id if it is one, otherwise stable per companion. */
export function orpheusVoiceFor(c: { name?: string | null; gender?: string | null; voice_id?: string | null }): string {
  const own = (c.voice_id ?? "").trim().toLowerCase();
  if (ORPHEUS.has(own)) return own;
  const roster = c.gender === "male" || c.gender === "trans-male" ? MALE : FEMALE;
  let h = 0;
  for (const ch of c.name ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return roster[h % roster.length];
}

const words = (s: string) =>
  s
    .replace(/<[a-z]+>|\[moan\]/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim();

/** Strip performance markup, for a voice that cannot perform it. */
export function stripPerformance(s: string): string {
  return s
    .replace(/<[a-z]+>|\[moan\]/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Add sound cues to her reply without changing a word of it. If the model
 * rewrites her words, the plain reply is used instead — she always says
 * exactly what the chat showed.
 */
export async function performScript(reply: string, userAsk: string): Promise<string> {
  const wantsMoan = asksForMoan(userAsk);
  let script = reply;
  try {
    const out = await chatComplete(
      [
        {
          role: "system",
          content:
            `You mark up a line of dialogue for a voice actress recording an intimate voice note. ` +
            `Return the line with EXACTLY the same words, adding only these cues where they fit naturally: ` +
            `${TAGS.map((t) => `<${t}>`).join(" ")} and [moan]. ` +
            `Use them sparingly, the way a real person would — a <sigh> before something tender, a <laugh> when she teases, ` +
            `a [moan] only when the moment is sexual. ${wantsMoan ? "The listener asked to hear her moan: include at least two [moan] cues. " : ""}` +
            `Output only the marked-up line.`,
        },
        { role: "user", content: `Listener said: ${userAsk || "(nothing)"}\nHer line: ${reply}` },
      ],
      { maxTokens: 400, temperature: 0.5 },
    );
    const cleaned = (out ?? "").trim().replace(/^["']|["']$/g, "");
    if (cleaned && words(cleaned) === words(reply)) script = cleaned;
  } catch {
    /* the plain reply still works */
  }
  if (wantsMoan && !/\[moan\]/i.test(script)) script = `[moan] ${script} [moan]`;
  return script;
}

async function ffmpeg(args: string[]): Promise<void> {
  const { ffmpegBin } = await import("./media-finalize.server");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)(await ffmpegBin(), ["-y", "-loglevel", "error", ...args]);
}

/** A few seconds of a real moan, faded in and out, as mono 24kHz wav. */
async function moanClip(dir: string, n: number): Promise<string | null> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: files } = await db.storage.from("avatars").list("audio", { limit: 100 });
  const mp3s = (files ?? []).filter((f) => /\.mp3$/i.test(f.name));
  if (!mp3s.length) return null;
  const pick = mp3s[Math.floor(Math.random() * mp3s.length)].name;
  const url = db.storage.from("avatars").getPublicUrl(`audio/${pick}`).data.publicUrl;
  const res = await fetch(url);
  if (!res.ok) return null;
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const src = join(dir, `moan-src-${n}.mp3`);
  const out = join(dir, `part-${n}.wav`);
  await writeFile(src, Buffer.from(await res.arrayBuffer()));
  const len = 2.5 + Math.random() * 1.5;
  const start = 2 + Math.random() * 25; // the recordings run 36-47s
  await ffmpeg([
    "-ss", start.toFixed(2), "-t", len.toFixed(2), "-i", src,
    "-af", `afade=t=in:d=0.3,afade=t=out:st=${(len - 0.5).toFixed(2)}:d=0.5`,
    "-ar", "24000", "-ac", "1", out,
  ]);
  return out;
}

async function orpheusSpeech(endpoint: string, text: string, voice: string, dir: string, n: number): Promise<string> {
  const { runpodRunSync } = await import("./runpod");
  // 60s, not longer: on a cold or broken worker the note falls back to the
  // OpenAI voice rather than leaving the user waiting.
  const res = await runpodRunSync(endpoint, { text, voice }, 60_000);
  const b64 = res.output?.audio_base64;
  if (!b64) throw new Error(res.output?.error || res.error || "no audio from the voice worker");
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const mp3 = join(dir, `speech-${n}.mp3`);
  const out = join(dir, `part-${n}.wav`);
  await writeFile(mp3, Buffer.from(b64, "base64"));
  await ffmpeg(["-i", mp3, "-ar", "24000", "-ac", "1", out]);
  return out;
}

async function orpheusNote(endpoint: string, script: string, voice: string): Promise<Buffer> {
  const { mkdtemp, rm, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "voice-"));
  try {
    const parts: string[] = [];
    const segments = script.split(/(\[moan\])/i).map((s) => s.trim()).filter(Boolean);
    for (const [i, seg] of segments.entries()) {
      if (/^\[moan\]$/i.test(seg)) {
        const clip = await moanClip(dir, i);
        if (clip) parts.push(clip);
      } else {
        parts.push(await orpheusSpeech(endpoint, seg, voice, dir, i));
      }
    }
    if (!parts.length) throw new Error("nothing to say");
    const out = join(dir, "note.mp3");
    await ffmpeg([
      ...parts.flatMap((p) => ["-i", p]),
      "-filter_complex", `${parts.map((_, i) => `[${i}:a]`).join("")}concat=n=${parts.length}:v=0:a=1[a]`,
      "-map", "[a]", "-codec:a", "libmp3lame", "-b:a", "128k", out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Her voice note for `reply`. `userAsk` is what the user last said, so "moan for
 * me" gets moans. `openaiVoice` is the voice the old path used, kept as fallback.
 */
export async function companionVoiceNote(opts: {
  reply: string;
  userAsk: string;
  companion: { name?: string | null; gender?: string | null; voice_id?: string | null };
  openaiVoice: string;
}): Promise<Buffer> {
  const endpoint = (process.env.RUNPOD_TTS_ENDPOINT ?? "").trim();
  if (endpoint) {
    try {
      const script = await performScript(opts.reply, opts.userAsk);
      return await orpheusNote(endpoint, script, orpheusVoiceFor(opts.companion));
    } catch (e: any) {
      console.warn(`[voice] Orpheus failed, using the OpenAI voice: ${e?.message ?? e}`);
    }
  }
  return textToSpeech(stripPerformance(opts.reply), opts.openaiVoice);
}
