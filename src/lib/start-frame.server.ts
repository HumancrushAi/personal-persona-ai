// Prepare a companion's portrait to be the start frame of a generation job.
//
// The RunPod endpoint outputs a 640x640 square and gets there by CENTRE-CROPPING
// whatever it is given. Feeding it the 768x1024 portrait directly threw away the
// top and bottom of the frame, which is why generated photos came back as a
// headless torso crop instead of the whole body.
//
// So the portrait is squared here first, by fitting the entire image inside the
// square and filling the margins with a blurred, zoomed copy of itself. Nothing
// is cropped, so the full body survives, and the fill reads as a soft studio
// backdrop rather than black bars.

import sharp from "sharp";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SIDE = 768;

export async function squareStartFrame(portraitUrl: string, key: string): Promise<string> {
  const res = await fetch(portraitUrl);
  if (!res.ok) throw new Error(`Could not fetch companion photo (${res.status})`);
  const src = Buffer.from(await res.arrayBuffer());

  // A colour wash fills the square; the untouched portrait sits on top, fully
  // contained, so no part of her is cut off.
  //
  // This used to be a blur of the portrait itself at radius 28. Blur is not
  // erasure — it leaves structure, and `fit: "cover"` centre-crops a portrait,
  // so what got enlarged and smeared across the frame was her head and hair.
  // The portrait then sits in the top 62%, which means the bottom of the frame
  // — precisely where legs, thighs and a crotch have to be generated on a nude
  // request — was seeded with a dark blurred enlargement of her hair. The model
  // does not ignore that; it grows a lower body out of it, which is where the
  // fused, hair-textured, oddly masculine groin in the reported screenshots
  // comes from.
  //
  // Reducing to 12x12 first destroys the structure instead of smearing it, so
  // what is left is her palette with no edges in it: still a soft studio
  // backdrop rather than black bars, but nothing for the renderer to mistake
  // for anatomy.
  const wash = await sharp(src).resize(12, 12, { fit: "cover" }).toBuffer();
  const backdrop = await sharp(wash)
    .resize(SIDE, SIDE, { fit: "fill", kernel: "cubic" })
    .blur(40)
    .modulate({ brightness: 0.75 })
    .toBuffer();

  // The subject sits at 62% of the frame rather than filling it, anchored to the
  // top. The model reframes toward whatever act was requested, and when she
  // filled the square that reframing pushed her head out — every prompt-side
  // attempt to stop it failed (framing first, crop negatives, lower LoRA
  // strengths). Giving the shot headroom to travel into is what actually kept
  // the face in frame on the request that used to come back headless.
  const inner = Math.round(SIDE * 0.62);
  const subject = await sharp(src)
    .resize(inner, inner, { fit: "inside", withoutEnlargement: false })
    .toBuffer();

  const squared = await sharp(backdrop)
    .composite([{ input: subject, gravity: "north" }])
    .png()
    .toBuffer();

  // `avatars` rather than `reels`: the reels bucket only accepts video mime
  // types and rejects a PNG outright.
  const path = `startframes/${key}.png`;
  const { error } = await supabaseAdmin.storage
    .from("avatars")
    .upload(path, squared, { contentType: "image/png", upsert: true });
  if (error) throw error;

  return supabaseAdmin.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}
