import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  name: z.string().min(1).max(40),
  gender: z.enum(["female", "male", "trans-female", "trans-male", "non-binary"]),
  artStyle: z.enum(["realistic", "anime"]),
  ethnicity: z.string().min(1).max(60),
  age: z.number().int().min(18).max(60),
  bodyType: z.string().max(40).optional(),
  hair: z.string().max(60).optional(),
  eyes: z.string().max(40).optional(),
  outfit: z.string().max(100).optional(),
  vibe: z.string().max(200).optional(),
});

export const generateCharacter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const genderWord =
      data.gender === "male" || data.gender === "trans-male" ? "man"
      : data.gender === "non-binary" ? "androgynous person"
      : "woman";

    const style =
      data.artStyle === "anime"
        ? "Stylized anime/manga illustration, cel shaded, expressive eyes, soft gradients, Studio Ghibli x modern anime style, vertical portrait."
        : "Hyper-realistic photograph, shot on 85mm, soft natural lighting, shallow depth of field, vertical portrait, magazine quality.";

    const prompt = [
      style,
      `Subject: a ${data.age}-year-old ${data.ethnicity} ${genderWord} named ${data.name}.`,
      data.bodyType ? `Body: ${data.bodyType}.` : "",
      data.hair ? `Hair: ${data.hair}.` : "",
      data.eyes ? `Eyes: ${data.eyes}.` : "",
      data.outfit ? `Wearing: ${data.outfit}.` : "Wearing stylish casual clothes.",
      data.vibe ? `Vibe: ${data.vibe}.` : "",
      "Looking softly at the camera. Tasteful, attractive, no nudity. Centered head and shoulders.",
    ].filter(Boolean).join(" ");

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        prompt,
        size: "1024x1024",
        n: 1,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Image error: ${res.status} ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned");
    const dataUrl = `data:image/png;base64,${b64}`;

    const bio = data.vibe
      ? data.vibe.slice(0, 140)
      : `${data.ethnicity} · ${data.bodyType ?? "your type"} · just made for you.`;

    const { data: maxRow } = await supabase
      .from("companions").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const sort = ((maxRow as any)?.sort_order ?? 100) + 1;

    const orientation =
      data.gender === "male" ? "straight"
      : data.gender === "non-binary" || data.gender === "trans-female" || data.gender === "trans-male" ? "pansexual"
      : "straight";

    const { data: companion, error } = await supabase
      .from("companions")
      .insert({
        name: data.name,
        age: data.age,
        ethnicity: data.ethnicity,
        gender: data.gender,
        orientation,
        art_style: data.artStyle,
        image_url: dataUrl,
        short_bio: bio,
        base_personality: data.vibe ?? "warm, flirty, curious about you",
        sort_order: sort,
        created_by: userId,
      })
      .select("id")
      .single();

    if (error || !companion) throw new Error(error?.message ?? "Insert failed");
    return { id: companion.id as string, imageUrl: dataUrl };
  });
