// The user's own room, for her to pose in.
//
// They upload a photo of their bedroom; a vision model describes it in one
// phrase; the phrase goes into every photo and clip prompt for that chat as
// the setting. The photo itself is not fed to the renderer — the chat graph is
// text-to-image with a face lock, and a second image would fight both the
// pose and the identity — so the room matches in kind (the bed, the walls,
// the light, the things in it), not pixel for pixel. Stored in app_settings,
// which already holds the look cache, so no table was added.

const KEY_PREFIX = "room:";

export type Room = { url: string; description: string; at: string };

const roomKey = (conversationId: string) => `${KEY_PREFIX}${conversationId}`;

export async function roomFor(conversationId: string | null | undefined): Promise<Room | null> {
  if (!conversationId) return null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", roomKey(conversationId))
      .maybeSingle();
    if (typeof data?.value !== "string") return null;
    const parsed = JSON.parse(data.value) as Partial<Room>;
    return parsed.url && parsed.description ? (parsed as Room) : null;
  } catch {
    return null;
  }
}

export async function saveRoom(conversationId: string, room: Room): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ key: roomKey(conversationId), value: JSON.stringify(room) }, { onConflict: "key" });
  if (error) throw new Error(`Could not save the room: ${error.message}`);
}

export async function clearRoom(conversationId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("app_settings").delete().eq("key", roomKey(conversationId));
}

/** Upload the user's photo of their room, resized, and return its public URL. */
export async function storeRoomPhoto(userId: string, conversationId: string, bytes: Buffer): Promise<string> {
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(bytes)
    .rotate()
    .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const path = `rooms/${userId}/${conversationId}.jpg`;
  const { error } = await supabaseAdmin.storage
    .from("avatars")
    .upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`Could not store the room photo: ${error.message}`);
  const { publicUrl } = supabaseAdmin.storage.from("avatars").getPublicUrl(path).data;
  // A cache-buster, so a re-uploaded room is not the old picture in the chest.
  return `${publicUrl}?v=${Date.now()}`;
}

/** The room in words, from the photo. "" when the model could not say. */
export async function describeRoom(url: string): Promise<string> {
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
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this room for a photographer in one comma-separated phrase of at most 32 words: the kind of room, the bed or main furniture and its colour, the bedding, the wall colour, the floor, the light (window, lamp, time of day) and two or three notable objects. Only the phrase, no sentence, no people.",
              },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return "";
    const json = await res.json();
    return tidyRoom(json.choices?.[0]?.message?.content);
  } catch {
    return "";
  }
}

export function tidyRoom(raw: string | null | undefined): string {
  let s = String(raw ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^[\s"'“”*-]+|[\s"'“”*.]+$/g, "")
    .trim();
  if (!s || /\b(sorry|cannot|can't|unable|as an ai|no people|person)\b/i.test(s)) return "";
  s = s.toLowerCase().replace(/\s+/g, " ");
  const words = s.split(" ");
  if (words.length > 40) s = words.slice(0, 40).join(" ");
  return s.replace(/,\s*$/, "");
}

/** The sentence the renderer gets. One place, so every builder says it the same way. */
export function settingSentence(description: string | null | undefined): string {
  const d = (description ?? "").trim();
  return d ? `The setting is the user's own room, exactly as it is: ${d}.` : "";
}
