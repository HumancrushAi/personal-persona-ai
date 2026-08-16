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

  // Blurred cover fills the square; the untouched portrait sits on top, fully
  // contained, so no part of her is cut off.
  const backdrop = await sharp(src)
    .resize(SIDE, SIDE, { fit: "cover" })
    .blur(28)
    .modulate({ brightness: 0.75 })
    .toBuffer();

  const subject = await sharp(src)
    .resize(SIDE, SIDE, { fit: "inside", withoutEnlargement: false })
    .toBuffer();

  const squared = await sharp(backdrop)
    .composite([{ input: subject, gravity: "center" }])
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
