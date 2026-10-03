// Which voice a companion speaks with. Its own module so scripts can use the
// same rule as the server (scripts/shuffle_order.ts pins voices before it
// reorders, because the fallback is indexed by sort_order).

import { genderKind } from "./anatomy";

// Warmer, more natural voices first (alloy is the flattest, so it's last).
//
// Split by gender, because the single roster this replaces had none of the
// masculine voices in it: every male companion on the site was rotated onto
// shimmer, coral or sage. Ten of them.
//
// A companion's own voice_id still wins over any of this — see voiceFor.
export const FEMALE_VOICES = ["shimmer", "coral", "nova", "sage", "ballad", "alloy"];
export const MALE_VOICES = ["onyx", "ash", "echo", "verse", "fable"];

/**
 * Which voice this companion speaks with.
 *
 * Her own voice_id first; the roster for her gender otherwise, indexed by
 * sort_order so the same companion always sounds the same.
 *
 * The fallback matters more than it looks: every row in the database currently
 * carries the same value, so "admin-assigned wins" meant one voice for the
 * whole site. A varied roster behind it is what stops a data mistake from
 * flattening all 75 companions into one person again.
 */
export function voiceFor(companion: {
  voice_id?: string | null;
  gender?: string | null;
  sort_order?: number | null;
}): string {
  const assigned = (companion.voice_id ?? "").trim();
  if (assigned) return assigned;
  const kind = genderKind(companion.gender);
  const roster = kind === "male" || kind === "trans-male" ? MALE_VOICES : FEMALE_VOICES;
  return roster[Math.abs(companion.sort_order ?? 0) % roster.length];
}
