// Pose guides: for the acts the checkpoint will not pose from words.
//
// "licking your tits" was asked for a dozen ways and came back face-up with
// the tongue at the camera more often than not, whatever the wording. The
// honest fix is to stop asking and show: an OpenPose skeleton fed through a
// ControlNet pins the head and the hands, and the prompt only has to fill
// in the rest. One guide per act, drawn once, used every time — the same
// idea as the tested-pose catalogue the big sites run on.
//
// A guide is used only when the worker has the ControlNet model
// (COMFY_CONTROLNET names it); without it the plain graph runs as before.

import { BREAST_LICK_POSE_PNG_BASE64 } from "./poses/breast-lick";

export type PoseGuide = { name: string; file: string; base64: string };

const BREAST_SELF_RE =
  /\b(?:lick\w*|suck\w*|kiss\w*|bit(?:e|es|ing)|nibbl\w*|tongu\w*)\b[^.?!]{0,30}\b(?:her|his|their|own|your)\s+(?:own\s+)?(?:tits?|titties|boobs?|boobies|breasts?|nipples?|chest)\b/i;

/** The app is configured to use a guide at all (COMFY_CONTROLNET names the model). */
export function poseGuideConfigured(): boolean {
  return Boolean((process.env.COMFY_CONTROLNET ?? "").trim());
}

// Whether the worker can actually use it. A worker without the model fails
// the job with "control_net_name ... not in []"; that is remembered here for
// a while so the retry, the retake and every other job skip the guide
// instead of each failing the same way. It expires on its own, so once the
// model is on the volume the guide comes back without a deploy. The first
// time it was not remembered: the fallback re-rendered without the guide,
// the retake went back to it, failed again, and the job was refunded.
const DISABLED_KEY = "pose_guide_disabled_until";
const DISABLE_HOURS = 6;

export async function poseGuideAvailable(): Promise<boolean> {
  if (!poseGuideConfigured()) return false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", DISABLED_KEY)
      .maybeSingle();
    const until = Date.parse(String(data?.value ?? "")) || 0;
    return Date.now() > until;
  } catch {
    return true;
  }
}

export async function disablePoseGuide(): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("app_settings").upsert(
      { key: DISABLED_KEY, value: new Date(Date.now() + DISABLE_HOURS * 3_600_000).toISOString() },
      { onConflict: "key" },
    );
  } catch (e: any) {
    console.error("could not record the missing pose model", e?.message ?? e);
  }
}

/** The guide for this request, or null when it has none. */
export function poseFor(userRequest: string): PoseGuide | null {
  const req = userRequest ?? "";
  if (BREAST_SELF_RE.test(req)) {
    return { name: "breast-lick", file: "pose-breast-lick.png", base64: BREAST_LICK_POSE_PNG_BASE64 };
  }
  return null;
}
