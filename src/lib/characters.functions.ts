import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateImage } from "./ai";

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
  fit: z.enum(["slim", "regular", "loose"]).optional(),
  vibe: z.string().max(200).optional(),
  breastSize: z.string().max(20).optional(),
  buttSize: z.string().max(20).optional(),
});

export const generateCharacter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const genderWord =
      data.gender === "male" || data.gender === "trans-male"
        ? "man"
        : data.gender === "non-binary"
          ? "androgynous person"
          : "woman";

    const style =
      data.artStyle === "anime"
        ? "Stylized anime/manga illustration, cel shaded, expressive eyes, soft gradients, Studio Ghibli x modern anime style, vertical portrait."
        : "Hyper-realistic photograph, shot on 85mm, soft natural lighting, shallow depth of field, vertical portrait, magazine quality.";

    const prompt = [
      style,
      `Subject: a ${data.ethnicity} ${genderWord} named ${data.name} who is exactly ${data.age} years old and clearly looks ${data.age} — age-appropriate face, skin, and body for a ${data.age}-year-old.`,
      data.bodyType ? `Body type: ${data.bodyType}.` : "",
      data.breastSize && genderWord === "woman" ? `Breast size: ${data.breastSize}.` : "",
      data.buttSize && genderWord === "woman" ? `Hips and butt size: ${data.buttSize}.` : "",
      data.hair ? `Hair: ${data.hair}.` : "",
      data.eyes ? `Eyes: ${data.eyes}.` : "",
      data.outfit ? `Wearing: ${data.outfit}.` : "Wearing stylish casual clothes.",
      data.fit === "slim"
        ? "Outfit fit: tailored and form-fitting, hugs the figure, not baggy."
        : data.fit === "loose"
          ? "Outfit fit: relaxed and loose, oversized silhouette."
          : "Outfit fit: regular, true-to-size.",
      data.vibe ? `Vibe: ${data.vibe}.` : "",
      "Sultry, seductive, flirty eye contact with the camera, confident alluring pose, form-fitting stylish outfit, intimate warm lighting. Provocative and sexy but NOT nude. Centered, head and shoulders to waist.",
    ]
      .filter(Boolean)
      .join(" ");

    const dataUrl = await generateImage(prompt);

    const bio = data.vibe
      ? data.vibe.slice(0, 140)
      : `${data.ethnicity} · ${data.bodyType ?? "your type"} · just made for you.`;

    const { data: maxRow } = await supabase
      .from("companions")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sort = ((maxRow as any)?.sort_order ?? 100) + 1;

    const orientation =
      data.gender === "male"
        ? "straight"
        : data.gender === "non-binary" ||
            data.gender === "trans-female" ||
            data.gender === "trans-male"
          ? "pansexual"
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
