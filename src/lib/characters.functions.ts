 import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateCompanionPortrait } from "./portrait.server";

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
  publish: z.boolean().optional(),
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

    // Pony is tag-driven — this booru tag is what actually locks the rendered
    // sex; the prose "a man named X" below is not enough on its own.
    const genderTag =
      genderWord === "man"
        ? "1boy, solo, male focus"
        : genderWord === "androgynous person"
          ? "androgynous, solo"
          : "1girl, solo";

    const baseDescription = [
      `a ${data.ethnicity} ${genderWord} named ${data.name} who is exactly ${data.age} years old and clearly looks ${data.age}`,
      data.bodyType ? `body type is ${data.bodyType}` : "",
      data.breastSize && genderWord === "woman" ? `breast size is ${data.breastSize}` : "",
      data.buttSize && genderWord === "woman" ? `butt/hips size is ${data.buttSize}` : "",
      data.hair ? `hair is ${data.hair}` : "",
      data.eyes ? `eyes are ${data.eyes}` : "",
      data.outfit ? `wearing ${data.outfit}` : "wearing a highly sexy, provocative skimpy outfit",
      data.fit === "slim"
        ? "outfit fit: tailored and form-fitting, hugs the figure"
        : data.fit === "loose"
          ? "outfit fit: relaxed and loose, oversized silhouette"
          : "outfit fit: regular",
      data.vibe ? `personality/vibe is ${data.vibe}` : "",
      "sultry, seductive, flirty eye contact, confident alluring pose, revealing form-fitting sexy outfit, cleavage, intimate warm lighting, head and shoulders to waist portrait"
    ]
      .filter(Boolean)
      .join(", ");

    const { refinePromoPrompt } = await import("./prompt-refiner.server");
    const refinedPromo = await refinePromoPrompt(baseDescription);

    const prompt = [
      genderTag,
      style,
      refinedPromo || baseDescription,
    ]
      .filter(Boolean)
      .join(" ");

    // Pass gender so the render uses the matching negative prompt — omitting it
    // defaulted every model to the female negatives.
    const dataUrl = await generateCompanionPortrait(prompt, { gender: data.gender, noNudity: true });

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
        status: data.publish ? "active" : "private",
      })
      .select("id")
      .single();

    if (error || !companion) throw new Error(error?.message ?? "Insert failed");
    return { id: companion.id as string, imageUrl: dataUrl };
  });
