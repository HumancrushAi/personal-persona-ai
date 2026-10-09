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

export function poseGuideAvailable(): boolean {
  return Boolean((process.env.COMFY_CONTROLNET ?? "").trim());
}

/** The guide for this request, or null when it has none. */
export function poseFor(userRequest: string): PoseGuide | null {
  const req = userRequest ?? "";
  if (BREAST_SELF_RE.test(req)) {
    return { name: "breast-lick", file: "pose-breast-lick.png", base64: BREAST_LICK_POSE_PNG_BASE64 };
  }
  return null;
}
