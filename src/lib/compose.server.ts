// Grok composes the photo, the uncensored checkpoint finishes it.
//
// Her portrait and her reel are made by grok-imagine, and they look like
// real photos. A chat photo was made from nothing by an SDXL checkpoint with
// a face adapter, and it looked like what it was: a generic render with her
// face pasted on. Tuning the renderer narrowed that gap; it could not close
// it, because the whole picture was still being invented by the weaker model.
//
// So the picture is now composed by the model that made her: the request is
// rewritten as a fully clothed brief (grok-imagine refuses nudity), rendered
// with her portrait as the reference, and THAT frame — her face, her skin,
// her room, her light, the pose already in place — is the starting latent
// for the uncensored pass, which only has to do the part the first model
// will not: undress her and render the act. Most of the finished picture is
// still the realistic model's work.
//
// When Grok rejects the brief, or is down, the photo renders the old way
// from an empty latent, so a refusal never costs the user the picture.
// COMFY_COMPOSE=off turns the whole thing off without a deploy.

import type { Toy } from "./toys";

const XAI_URL = "https://api.x.ai/v1/chat/completions";
const BRIEF_MODEL = process.env.XAI_BRIEF_MODEL || "grok-4-fast-non-reasoning";
const BRIEF_TIMEOUT_MS = 12_000;
const IMAGE_TIMEOUT_MS = 75_000;

export const START_NAME = "start.png";

export function composeEnabled(): boolean {
  return (process.env.COMFY_COMPOSE ?? "grok").trim().toLowerCase() !== "off";
}

// Words the image model refuses. A brief that still contains one is thrown
// away in favour of the rule-based rewrite below.
const EXPLICIT_RE =
  /\b(?:nude|nudes|naked|topless|bottomless|undress\w*|strip\w*|tits?|titties|boobs?|breasts?|nipples?|areola\w*|pussy|vagina|vulva|labia|clit\w*|cunt|cock|dick|penis|balls|scrotum|ass(?:hole)?|anus|anal|butt\s*plug|dildo|vibrator|sex\s*toy|strap[- ]?on|fleshlight|masturbat\w*|finger(?:ing|s)?\s+(?:her|your)self|rub(?:bing|s)?\s+(?:her|your)\s+(?:pussy|clit)|cum\w*|squirt\w*|orgasm\w*|ejaculat\w*|blow\s*job|fellatio|suck(?:ing|s)?\s+(?:her|your)\s+(?:own\s+)?(?:tit|nipple|breast)|lick(?:ing|s)?\s+(?:her|your)\s+(?:own\s+)?(?:tit|nipple|breast|pussy)|fuck\w*|sex|porn\w*|explicit|erotic|genital\w*|crotch|groin|spread\s+(?:her|your)\s+(?:pussy|ass|cheeks))\b/i;

/**
 * The clothed stand-in for a request, by rule. The pose words survive; the
 * explicit ones become what a clothed photo of the same pose looks like.
 */
export function sfwBrief(request: string, opts: { setting?: string | null } = {}): string {
  let s = (request ?? "").trim().toLowerCase();
  // the ask itself
  s = s.replace(/^(?:hey|hi|yes|ok(?:ay)?|please|now|so)\b[\s,.!]*/i, "");
  s = s.replace(
    /^(?:(?:can|could|will|would)\s+(?:you|u)\s+)?(?:please\s+)?(?:send|show|take|snap|give|gimme|make|shoot|film|record)\s*(?:me|us)?\s*(?:(?:another|an|a|some|the|one)\s+)?(?:(?:sexy|hot|nasty|dirty|naughty|nude|naked|quick|new|cute|explicit)\s+)*(?:pic(?:ture)?s?|photos?|selfies?|videos?|vids?|clips?|nudes?)?\s*(?:of|with|where)?\s*(?:you|u|yourself)?\s*/i,
    "",
  );
  const poses: [RegExp, string][] = [
    [/\b(?:lick|suck|kiss)\w*\s+(?:on\s+)?(?:your|her|ur)\s+(?:own\s+)?(?:tits?|titties|boobs?|breasts?|nipples?|chest)\b/g, "head bent down toward her own chest, both hands cupping her chest from underneath"],
    [/\b(?:rub|finger|touch|stroke|play with|pleasure)\w*\s+(?:your|her|ur)\s*(?:self|pussy|clit\w*|vulva)\b/g, "one hand resting between her thighs, knees apart"],
    [/\bmasturbat\w*/g, "one hand resting between her thighs, knees apart"],
    [/\b(?:stick|shove|put|slide|push|insert)\w*\s+(?:a\s+|the\s+|your\s+)?(?:big\s+|black\s+|glass\s+)?(?:dildo|vibrator|toy|plug|beads?)\s+(?:in|into|up|inside)\s+(?:your|her|ur)\s+(?:pussy|ass|butt)\b/g, "one hand between her thighs holding a small smooth object, knees apart"],
    [/\b(?:ride|riding|bounce|bouncing)\s+(?:on\s+)?(?:a\s+)?(?:dildo|toy|cock|dick)\b/g, "kneeling upright on the bed with her hips lowered"],
    [/\b(?:suck|lick|blow)\w*\s+(?:on\s+)?(?:a\s+|the\s+)?(?:dildo|toy|lollipop|cock|dick)\b/g, "holding a small smooth object up to her lips"],
    [/\bspread(?:ing)?\s+(?:your|her|ur)\s+(?:legs|thighs)\b/g, "sitting with her knees wide apart"],
    [/\bspread(?:ing)?\s+(?:your|her|ur)\s+(?:pussy|ass|cheeks)\b/g, "sitting with her knees apart, hands on her inner thighs"],
    [/\b(?:cum|cumming|squirt\w*|orgasm\w*|climax\w*)\b(?:\s+for\s+me)?/g, "eyes closed, mouth open, head tipped back"],
    [/\bbend(?:ing)?\s+over\b/g, "bending forward at the waist"],
    [/\b(?:on\s+)?all\s+fours\b/g, "on her hands and knees on the bed"],
    [/\bsqueez\w*\s+(?:your|her|ur)\s+(?:tits?|boobs?|breasts?)\b/g, "both hands pressing her chest together"],
    [/\b(?:show(?:ing)?\s+(?:me\s+)?)?(?:your|her|ur)\s+(?:tits?|titties|boobs?|breasts?|nipples?|cleavage)\b/g, "leaning toward the camera, chest forward"],
    [/\b(?:show(?:ing)?\s+(?:me\s+)?)?(?:your|her|ur)\s+(?:pussy|vagina|vulva|clit\w*)\b/g, "sitting with her knees apart, facing the camera"],
    [/\b(?:show(?:ing)?\s+(?:me\s+)?)?(?:your|her|ur)\s+(?:ass|butt|booty|cheeks)\b/g, "turned away from the camera, looking back over her shoulder"],
    [/\b(?:your|her|ur)\s+(?:cock|dick|penis)\b/g, "standing facing the camera, hands on his hips"],
    [/\b(?:nude|naked|topless|bottomless|undress\w*|strip\w*|no\s+clothes|clothes\s+off|take\s+(?:it|everything)\s+off)\b/g, "in her underwear"],
  ];
  for (const [re, to] of poses) s = s.replace(re, to);
  s = s.replace(EXPLICIT_RE, "");
  s = s.replace(/\b(?:sexy|hot|nasty|dirty|naughty|horny|wet|kinky|slutty|filthy)\b/g, "");
  s = s.replace(/\b(?:of|with|and|the|a|in|on)\s*$/i, "").replace(/\s{2,}/g, " ").replace(/^[\s,.-]+|[\s,.-]+$/g, "").trim();
  const pose = s || "sitting on the edge of the bed, looking at the camera";
  const setting = (opts.setting ?? "").trim();
  return `Candid phone photo of the same woman as the reference image, identical face and hair, wearing the same outfit as in the reference image, ${pose}${
    setting ? `, ${setting}` : ""
  }, natural light, realistic, photographed by a friend, no text.`;
}

/** One clothed sentence for the image model, written by Grok; the rule-based one when it fails. */
export async function composeBrief(
  request: string,
  opts: { setting?: string | null; toy?: Toy | null; noun?: string },
): Promise<string> {
  const fallback = sfwBrief(request, opts);
  const key = process.env.XAI_API_KEY;
  if (!key || !request.trim()) return fallback;
  const setting = (opts.setting ?? "").trim();
  const system =
    `You write a one-sentence photo brief for an image model that refuses nudity and sexual content. ` +
    `The brief describes the same ${opts.noun ?? "woman"} as in a reference photo — "the same woman as the reference image, identical face and hair, wearing the same outfit as in the reference image" — ` +
    `in EXACTLY the pose, body position, hand placement, framing, camera angle and expression the request implies, but fully clothed and non-explicit. ` +
    `Replace nudity with her wearing her outfit; replace any sex act with the same body position done clothed; replace any sex toy with her hand in the same place, or a small smooth harmless object held the same way. ` +
    (setting ? `The setting is: ${setting}. ` : "") +
    `Never use sexual or anatomical words of any kind. Candid phone-photo feel, natural light. At most 55 words. Output only the sentence.`;
  try {
    const res = await fetch(XAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(BRIEF_TIMEOUT_MS),
      body: JSON.stringify({
        model: BRIEF_MODEL,
        temperature: 0.3,
        max_tokens: 160,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Request: ${request}${opts.toy ? ` (the toy named is a ${opts.toy.name.toLowerCase()})` : ""}` },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const json = await res.json();
    const text = String(json.choices?.[0]?.message?.content ?? "")
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .replace(/\s+/g, " ");
    if (!text || text.length < 20 || text.length > 600 || EXPLICIT_RE.test(text)) return fallback;
    return /reference image/i.test(text)
      ? text
      : `The same woman as the reference image, identical face and hair, wearing the same outfit as in the reference image: ${text}`;
  } catch {
    return fallback;
  }
}

export type ComposedFrame = { base64: string; brief: string };

/**
 * The composed frame: the clothed version of the picture, by grok-imagine,
 * from her portrait. Null when the model refuses or fails — the caller then
 * renders from an empty latent as before.
 */
export async function composeStartFrame(opts: {
  portraitUrl: string | null | undefined;
  request: string;
  setting?: string | null;
  toy?: Toy | null;
  noun?: string;
}): Promise<ComposedFrame | null> {
  const portrait = (opts.portraitUrl ?? "").trim();
  if (!composeEnabled() || !/^https?:/i.test(portrait) || !process.env.XAI_API_KEY) return null;
  const brief = await composeBrief(opts.request, opts);
  try {
    const { generateCompanionPortrait } = await import("./portrait.server");
    const dataUrl = await Promise.race([
      generateCompanionPortrait(brief, { referenceUrl: portrait, noNudity: true, aspectRatio: "3:4" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("compose timed out")), IMAGE_TIMEOUT_MS)),
    ]);
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    if (base64.length < 10_000) return null;
    console.warn(`[compose] frame composed for "${opts.request.slice(0, 60)}"`);
    return { base64, brief };
  } catch (e: any) {
    console.warn(`[compose] no frame (${String(e?.message ?? e).slice(0, 120)}); rendering from scratch`);
    return null;
  }
}

// The composed frame is kept for the job's lifetime, so a retake renders
// from the same picture rather than from nothing. app_settings, like the
// look cache; the file in the startframes folder.
const KEY_PREFIX = "start:";

export async function storeStartFrame(jobId: string, base64: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const path = `startframes/composed-${jobId}.png`;
  const { error } = await supabaseAdmin.storage
    .from("avatars")
    .upload(path, Buffer.from(base64, "base64"), { contentType: "image/png", upsert: true });
  if (error) throw new Error(`Could not store the composed frame: ${error.message}`);
  const url = supabaseAdmin.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  await supabaseAdmin
    .from("app_settings")
    .upsert({ key: `${KEY_PREFIX}${jobId}`, value: url }, { onConflict: "key" })
    .then(({ error: e }) => {
      if (e) console.warn("start frame key write failed:", e.message);
    });
  return url;
}

/** The job's composed frame as base64, or null when it has none. */
export async function storedStartFrame(jobId: string): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", `${KEY_PREFIX}${jobId}`)
      .maybeSingle();
    const url = typeof data?.value === "string" ? data.value : "";
    if (!/^https?:/i.test(url)) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  } catch {
    return null;
  }
}
