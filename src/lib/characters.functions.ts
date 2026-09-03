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
      "sultry, seductive, flirty eye contact, confident alluring pose, revealing form-fitting sexy outfit, cleavage, intimate warm lighting, head and shoulders to waist portrait",
    ]
      .filter(Boolean)
      .join(", ");

    const { refinePromoPrompt } = await import("./prompt-refiner.server");
    const refinedPromo = await refinePromoPrompt(baseDescription);

    const prompt = [genderTag, style, refinedPromo || baseDescription].filter(Boolean).join(" ");

    // Pass gender so the render uses the matching negative prompt — omitting it
    // defaulted every model to the female negatives.
    const dataUrl = await generateCompanionPortrait(prompt, {
      gender: data.gender,
      noNudity: true,
    });

    // The portrait is HOSTED, not stored inline.
    //
    // generateCompanionPortrait hands back a base64 data: URL, and this used to
    // go straight into companions.image_url. Two things broke as a result. A
    // RunPod worker fetches the source photo over the network with
    // requests.get(), so it cannot read a data: URI at all — every companion
    // built from /create failed her first selfie with "no hosted photo to edit"
    // and the credits were refunded, which reads to the user as the product
    // being broken. It also put roughly half a megabyte of base64 in a row that
    // gets selected on nearly every chat query.
    //
    // The admin regenerate path already uploaded to storage and saved a public
    // URL; this is the same thing, done here.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      await supabaseAdmin.storage.createBucket("avatars", { public: true });
    } catch {
      /* already exists */
    }
    const bytes = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
    const path = `companions/created-${crypto.randomUUID()}.png`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("avatars")
      .upload(path, bytes, { contentType: "image/png", upsert: true });
    if (upErr) throw new Error(`Could not store the portrait: ${upErr.message}`);
    const imageUrl = supabaseAdmin.storage.from("avatars").getPublicUrl(path).data.publicUrl;

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
        image_url: imageUrl,
        short_bio: bio,
        base_personality: data.vibe ?? "warm, flirty, curious about you",
        sort_order: sort,
        created_by: userId,
        status: data.publish ? "active" : "private",
      })
      .select("id")
      .single();

    if (error || !companion) throw new Error(error?.message ?? "Insert failed");
    return { id: companion.id as string, imageUrl };
  });
