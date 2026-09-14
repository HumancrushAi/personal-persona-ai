import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateCompanionPortrait } from "./portrait.server";
import { screenCharacterSpec, BLOCKED_CONTENT } from "./safety";

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

    // Every free-text field is screened before anything is generated.
    //
    // The zod schema bounds age to 18-60 and nothing else was checked, so a
    // companion could be created with an adult age and a vibe, outfit or name
    // describing a child — text that went straight into the portrait prompt and
    // was rendered. The site is 18+ and this is the one rule that has to hold
    // whatever anyone types, so it is enforced here, before a single credit or
    // API call is spent, rather than left to the image provider's own filter.
    const screen = screenCharacterSpec({
      age: data.age,
      fields: [
        data.name,
        data.vibe,
        data.outfit,
        data.hair,
        data.eyes,
        data.bodyType,
        data.ethnicity,
      ],
    });
    if (!screen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${screen.reason}`);

    const genderWord =
      data.gender === "male" || data.gender === "trans-male"
        ? "man"
        : data.gender === "non-binary"
          ? "androgynous person"
          : "woman";

    // A real photograph of a real person, described as what is IN it. This was
    // "Hyper-realistic photograph, shot on 85mm … magazine quality": render
    // language and retouched-commercial language, which is exactly the look it
    // produced — the verdict on it was that the models do not look like real
    // people. Kept device-neutral on purpose: the promo refiner below writes a
    // camera line of its own, and two contradicting cameras help nobody.
    const style =
      data.artStyle === "anime"
        ? "Stylized anime/manga illustration, cel shaded, expressive eyes, soft gradients, Studio Ghibli x modern anime style, vertical portrait."
        : "Candid photograph of a real person in whatever light is in the room, with its real colour cast. Real skin with visible pores, small marks and natural unevenness in tone, fine lines where the face moves, hair with loose strands and flyaways, clothing with real creases, a body with natural proportions, a relaxed genuine expression.";

    // The sex is stated in plain language, and first. These were booru tags —
    // "1girl, solo", "1boy, solo, male focus" — left from when portraits
    // rendered on Pony, a tag-driven model. The renderer is now a
    // natural-language model: those tags lock nothing for it, and what they do
    // say, loudly, is "illustration dataset".
    const genderLead =
      data.artStyle === "anime" ? `Anime illustration of a ${genderWord}.` : `Photo of a real ${genderWord}.`;

    const baseDescription = [
      `a ${data.ethnicity} ${genderWord} who is ${data.age} years old and clearly looks ${data.age}`,
      data.bodyType ? `body type is ${data.bodyType}` : "",
      data.breastSize && genderWord === "woman" ? `breast size is ${data.breastSize}` : "",
      data.buttSize && genderWord === "woman" ? `butt/hips size is ${data.buttSize}` : "",
      data.hair ? `hair is ${data.hair}` : "",
      data.eyes ? `eyes are ${data.eyes}` : "",
      // Intimate and real rather than "highly sexy, provocative skimpy": the
      // clothes someone actually wears at home read as sexier in a photograph
      // than an adjective does, and they read as a person rather than a costume.
      data.outfit ? `wearing ${data.outfit}` : "wearing fitted, intimate clothes she would wear at home",
      data.fit === "slim"
        ? "outfit fit: tailored and form-fitting, hugs the figure"
        : data.fit === "loose"
          ? "outfit fit: relaxed and loose, oversized silhouette"
          : "outfit fit: regular",
      data.vibe ? `personality/vibe is ${data.vibe}` : "",
      "a flirty, relaxed look straight at the camera, in an ordinary lived-in room",
    ]
      .filter(Boolean)
      .join(", ");

    // A retry must not make a second companion.
    //
    // Generating a portrait takes one to two minutes. A phone that switches
    // network, or a browser that gives up on the request, shows "Failed to
    // fetch" while the server carries on and finishes — so the user presses the
    // button again and gets another model. That is exactly what happened: three
    // identical Sandys, created 10:57:03, 10:58:48 and 11:00:02, one per press.
    //
    // Checking first makes the button idempotent for the window that matters.
    // Someone who genuinely wants two companions with the same name a few
    // minutes apart is a far rarer case than a retry after a dropped request,
    // and they can rename or make the second one later.
    const RETRY_WINDOW_MS = 15 * 60 * 1000;
    const { data: recent } = await supabase
      .from("companions")
      .select("id, created_at")
      .eq("created_by", userId)
      .eq("name", data.name)
      .gte("created_at", new Date(Date.now() - RETRY_WINDOW_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent?.id) {
      const { data: existing } = await supabase
        .from("companions")
        .select("image_url")
        .eq("id", recent.id)
        .maybeSingle();
      return { id: recent.id as string, imageUrl: (existing?.image_url as string) ?? "" };
    }

    const { refinePromoPrompt } = await import("./prompt-refiner.server");
    const refinedPromo = await refinePromoPrompt(baseDescription);

    // Framing is appended AFTER the refiner, and is not negotiable.
    //
    // This portrait is not just the card on the home page — it is the reference
    // frame every future selfie and video of her is generated from. The refiner
    // is told to write "setting with real detail" and "pose and expression",
    // which invites environmental compositions, and it produced one companion
    // shot from behind leaning on a marble counter with her reflection beside
    // her: two faces, both small, neither facing camera. Handed to an
    // image-to-image model as the identity reference that returns a DIFFERENT
    // WOMAN, because there is no single clear face to carry over. The user saw
    // exactly that — a redhead whose selfies came back as someone else.
    //
    // Appending beats instructing, for the same reason PROMO_STYLE is appended
    // in studio.functions.ts: the constraint must not depend on the refiner
    // having behaved.
    //
    // Stated as what IS in the frame. This ended with a list of ten things that
    // must not be — "No mirror, no reflection, no second person, no crowd, no
    // view from behind … no sunglasses or mask" — which names every one of them
    // to a renderer that cannot reliably read "no". The incident above was a
    // companion rendered beside her own reflection; a framing line that says
    // "mirror" and "reflection" to every portrait is not an innocent bystander
    // to that. props.ts documents the same failure with a toy and a mouth.
    //
    // Head to knees, not head-and-shoulders to waist. This portrait is the start
    // frame for her chat photos, and a lower body that is not in it has to be
    // invented by the video model — which is where the fused, wrong-looking
    // bodies in reported screenshots came from. Knees keep the face large enough
    // to carry her identity, and match portrait.ts and selfie.ts's framingFor.
    const PORTRAIT_FRAMING =
      "One person alone in an ordinary room, facing the camera, the whole face clearly visible, sharp and evenly lit, eyes toward the lens. Framed from the top of the head down to the knees.";

    const prompt = [genderLead, style, refinedPromo || baseDescription, PORTRAIT_FRAMING]
      .filter(Boolean)
      .join(" ");

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
