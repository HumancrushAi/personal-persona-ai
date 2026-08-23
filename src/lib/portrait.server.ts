// Creating a companion's canonical portrait from a text description.
//
// This is TEXT-to-image, which neither RunPod endpoint can do: the video one
// needs a start frame and FLUX Kontext needs a source photo to edit. Replicate
// used to cover it and was removed, which left admin portrait generation and
// /create throwing outright.
//
// xAI's Imagine model fills that gap, and it takes an optional reference image,
// so the same face can be carried across a set — which is what a promo page of
// one "model" needs.
//
// Explicit content is NOT this path's job. Imagine is a general image model with
// its own policy; sexy-but-clothed is what it does well and what public promo
// material needs anyway. Explicit versions of the same person come from the
// RunPod video endpoint via the media pipeline.

const XAI_IMAGE_URL = "https://api.x.ai/v1/images/generations";

const UNAVAILABLE =
  "Portrait generation is not configured (XAI_API_KEY missing). It needs a text-to-image model; the RunPod endpoints are image-to-video and image-to-image only.";

export async function generateCompanionPortrait(
  prompt: string,
  opts?: { gender?: string | null; noNudity?: boolean; referenceUrl?: string | null },
): Promise<string> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error(UNAVAILABLE);

  // A reference locks the face when building several images of one persona.
  // Stated in the prompt as well as passed as an image: the model follows the
  // instruction more reliably than the reference alone.
  const body: Record<string, unknown> = {
    model: process.env.XAI_IMAGE_MODEL || "grok-imagine-image-2.0",
    prompt: opts?.referenceUrl
      ? `Exact same woman as the reference image, identical face, same hair, same skin. ${prompt}`
      : prompt,
    n: 1,
  };
  if (opts?.referenceUrl) body.image = opts.referenceUrl;

  const res = await fetch(XAI_IMAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`Portrait generation failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  const item = json.data?.[0];

  // Callers store the portrait themselves and expect the bytes inline.
  if (item?.b64_json) return `data:image/jpeg;base64,${item.b64_json}`;
  if (!item?.url) throw new Error("Portrait generation returned no image");

  const img = await fetch(item.url);
  if (!img.ok) throw new Error("Could not fetch generated portrait");
  const mime = item.mime_type || "image/jpeg";
  return `data:${mime};base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`;
}
