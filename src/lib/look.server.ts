// What she looks like, in words, for the renderer.
//
// The production photo graph is text-to-image with an IP-Adapter FaceID lock.
// FaceID carries the FACE — not the hair. Every prompt said "identical face,
// hair and skin to the reference image" and the hair was decided by the
// checkpoint: Skye, who is blue-haired, came back brunette. The companion row
// stores no description of her looks, so one is read off her portrait by a
// vision model once and cached in app_settings; from then on every prompt
// states it outright.

import { createHash } from "node:crypto";

// "look2": the phrase grew bust size and tattoos, and the cached "look:" phrases have neither.
const KEY_PREFIX = "look2:";
const MAX_WORDS = 30;

export function lookCacheKey(imageUrl: string): string {
  return `${KEY_PREFIX}${createHash("sha1").update(imageUrl).digest("hex").slice(0, 24)}`;
}

// "blue shoulder-length wavy hair, blue eyes, fair skin, slim build" — or ""
// when there is no portrait or the model could not say.
export async function companionLook(imageUrl: string | null | undefined): Promise<string> {
  const url = (imageUrl ?? "").trim();
  if (!/^https?:/i.test(url)) return "";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = lookCacheKey(url);
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
    if (typeof data?.value === "string") return data.value;
  } catch {
    /* fall through to describing it */
  }

  const look = await describePortrait(url);
  if (look) {
    await supabaseAdmin
      .from("app_settings")
      .upsert({ key, value: look }, { onConflict: "key" })
      .then(({ error }) => {
        if (error) console.warn("look cache write failed:", error.message);
      });
  }
  return look;
}

async function describePortrait(url: string): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return "";
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model: process.env.VISION_VERIFY_MODEL || "qwen/qwen2.5-vl-72b-instruct",
        temperature: 0,
        max_tokens: 90,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this person's looks for a portrait artist in one comma-separated phrase of at most 24 words: exact hair color, hair length and style, eye color, skin tone, body build and bust size (e.g. very full bust, small bust), and any visible tattoos — say where and roughly what (e.g. full tattoo sleeves on both arms, large chest tattoo). If there are no tattoos, say nothing about tattoos. Only the phrase, no sentence, no names.",
              },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return "";
    const json = await res.json();
    return tidyLook(json.choices?.[0]?.message?.content);
  } catch {
    return "";
  }
}

// One short lowercase phrase; anything that reads like a refusal or an essay is dropped.
export function tidyLook(raw: string | null | undefined): string {
  let s = String(raw ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^[\s"'“”*-]+|[\s"'“”*.]+$/g, "")
    .trim();
  if (!s || /\b(sorry|cannot|can't|unable|as an ai)\b/i.test(s)) return "";
  s = s.toLowerCase().replace(/\s+/g, " ");
  const words = s.split(" ");
  if (words.length > MAX_WORDS) s = words.slice(0, MAX_WORDS).join(" ");
  return s.replace(/,\s*$/, "");
}
