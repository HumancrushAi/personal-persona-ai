// Creating a companion's canonical portrait from a text description.
//
// This is TEXT-to-image, and it is the one thing the account's RunPod endpoints
// cannot do:
//   - the video endpoint is image-to-video and needs a start frame
//   - FLUX Kontext is image-to-image and needs a source photo to edit
// A brand-new companion has neither, so there is nothing to hand them.
//
// Replicate used to cover this and has been removed. Until an uncensored
// text-to-image endpoint exists (a ComfyUI serverless endpoint with an SDXL or
// Pony checkpoint), portrait creation is unavailable — and it says so plainly
// rather than throwing something cryptic from inside a provider client.
//
// Point RUNPOD_TEXT_IMAGE_ENDPOINT at that endpoint and this starts working
// with no other change.

import { runpodRun, runpodGet, runpodStatusOf, runpodOutputUrl, runpodOutputError } from "./runpod";

const PORTRAIT_UNAVAILABLE =
  "Portrait generation is unavailable: it needs a text-to-image endpoint, and the configured RunPod endpoints are image-to-video and image-to-image only. Set RUNPOD_TEXT_IMAGE_ENDPOINT to an uncensored text-to-image endpoint to enable it.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generateCompanionPortrait(
  prompt: string,
  opts?: { gender?: string | null; noNudity?: boolean },
): Promise<string> {
  const endpoint = process.env.RUNPOD_TEXT_IMAGE_ENDPOINT;
  if (!endpoint || !process.env.RUNPOD_API_KEY) throw new Error(PORTRAIT_UNAVAILABLE);

  // Public portraits stay clothed; the wardrobe wording in the prompt only
  // steers the outfit, so the suppression has to live in the negative.
  const negative = [
    opts?.noNudity
      ? "nude, naked, topless, bottomless, exposed breasts, nipples, genitals, explicit"
      : "",
    "deformed, bad anatomy, extra limbs, distorted hands, extra fingers, watermark, text",
    "plastic skin, waxy skin, airbrushed, poreless, doll face, mannequin, uncanny valley, 3d render, cgi, oversaturated, beauty filter",
  ]
    .filter(Boolean)
    .join(", ");

  const job = await runpodRun(endpoint, {
    prompt,
    negative_prompt: negative,
    width: 768,
    height: 1024,
    num_inference_steps: Number(process.env.RUNPOD_IMAGE_STEPS || "30"),
    guidance: Number(process.env.RUNPOD_IMAGE_GUIDANCE || "6"),
    output_format: "png",
    enable_safety_checker: false,
  });

  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await sleep(4000);
    const res = await runpodGet(endpoint, job.id);
    const state = runpodStatusOf(res.status);
    if (state === "failed") {
      throw new Error(runpodOutputError(res.output, res.error) || `Portrait job ${res.status}`);
    }
    if (state !== "succeeded") continue;

    const url = runpodOutputUrl(res.output);
    if (!url) throw new Error("Portrait job finished with no image");

    // Callers store the portrait themselves, and expect the bytes inline.
    const img = await fetch(url);
    if (!img.ok) throw new Error("Could not fetch generated portrait");
    return `data:image/png;base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`;
  }
  throw new Error("Portrait generation timed out");
}
