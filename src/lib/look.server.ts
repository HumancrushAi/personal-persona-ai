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
// Invalidate descriptions made by the old ambiguous hair-length prompt.
const KEY_PREFIX = "look4:";
const MAX_WORDS = 34;

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

// Where her portrait was taken, in words: the room, the light, the feel.
// Her reel and her card are realistic because they ARE that photo; a chat
// photo rendered in a renderer's default bedroom could never look like
// them. Said as the setting of every chat photo that has no user room.
// "scene2": the phrase is now scrubbed of clothing words; the cached "scene:" ones were not.
const SCENE_PREFIX = "scene2:";
export async function companionScene(imageUrl: string | null | undefined): Promise<string> {
  const url = (imageUrl ?? "").trim();
  if (!/^https?:/i.test(url)) return "";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = `${SCENE_PREFIX}${createHash("sha1").update(url).digest("hex").slice(0, 24)}`;
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
    if (typeof data?.value === "string") return data.value;
  } catch {
    /* fall through to describing it */
  }
  const scene = await describeScene(url);
  if (scene) {
    await supabaseAdmin
      .from("app_settings")
      .upsert({ key, value: scene }, { onConflict: "key" })
      .then(({ error }) => {
        if (error) console.warn("scene cache write failed:", error.message);
      });
  }
  return scene;
}


// A setting has no person in it and nothing anyone is wearing. The model
// was told so and still wrote "red dress"; the phrase is scrubbed anyway.
const GARMENT_WORD =
  /\b(?:dress|gown|lingerie|bra|panties|underwear|bikini|swimsuit|top|shirt|blouse|skirt|shorts|jeans|pants|leggings|stockings|heels|outfit|clothes|clothing|robe|nightie|slip|corset|bodysuit|jacket|sweater|hoodie|uniform|costume)\b/i;
export function scrubScene(phrase: string): string {
  const parts = phrase
    .split(/\s*[,;]\s*/)
    .map((p) => p.trim())
    .filter((p) => p && !GARMENT_WORD.test(p) && !/\b(?:woman|man|girl|person|she|he|her|his|model|subject)\b/i.test(p));
  return parts.join(", ");
}

async function describeScene(url: string): Promise<string> {
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
        max_tokens: 110,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe the setting and the light of this photo for a photographer in one comma-separated phrase of at most 30 words: the room or place, the main furniture and its colours, what is on the walls, the light source and time of day, and the camera feel (e.g. candid phone photo). Say nothing about the person. Only the phrase.",
              },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return "";
    const json = await res.json();
    return scrubScene(tidyLook(json.choices?.[0]?.message?.content));
  } catch {
    return "";
  }
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
                text: "Describe this person's looks for a portrait artist in one comma-separated phrase of at most 28 words. State exact hair color, texture and part, and measure its visible length as chin-length, shoulder-length, chest-length, waist-length, or longer. Then state eye color, skin tone, body build and bust size. Mention tattoos with locations only when clearly visible; if none are visible, omit tattoos entirely. Describe actual features, not clothing. Only the phrase, no sentence, no names.",
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
  // A positive diffusion prompt cannot understand "no tattoos"; it sees the
  // noun and draws one. Absence belongs in the negative prompt instead.
  s = s
    .replace(/(?:^|,\s*)no visible tattoos?(?=,|$)/gi, "")
    .replace(/(?:^|,\s*)no tattoos?(?=,|$)/gi, "")
    .replace(/^,\s*|,\s*$/g, "")
    .replace(/,\s*,/g, ",");
  const words = s.split(" ");
  if (words.length > MAX_WORDS) s = words.slice(0, MAX_WORDS).join(" ");
  return s.replace(/,\s*$/, "");
}
