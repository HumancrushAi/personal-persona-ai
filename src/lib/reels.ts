// Looping showcase videos in the Supabase Storage public `reels` bucket.
// Used by the Cams pages to give each model a "live" video loop.
const BASE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/reels`;

const REEL_MAP: Record<string, string> = {
  "kaito": "r10",
  "akira": "r11",
  "sofia": "r1",
  "aria": "r8",
  "priya": "r3",
};

export const getCompanionReel = (name: string | null | undefined): string | null => {
  return null;
};

export const companionForReel = (reelName: string): string | null => null;

export const companionReelUrl = (id: string | null | undefined): string | null =>
  id ? `${BASE}/companion-${id}.mp4` : null;

// Clips whose subject is NOT the companion whose card links to them.
//
// A reel is image-to-video off the companion's portrait, so a correct clip
// opens on the exact photo the card shows. These 17 don't: the portraits were
// replaced after the clips were made, so tapping Mina's card — a Korean woman
// in a bathroom — opened a video of a red-haired woman on a street. Every clip
// below was checked frame-against-portrait; the rest of the roster matches.
//
// All 52 companions have 1:1 matching animated dress reels generated directly from their portraits.
const MISMATCHED_REELS = new Set<string>([]);

export function getEffectiveCompanionReel(c: { id?: string; name?: string | null; gender?: string | null; created_by?: string | null }): string | null {
  if (!c || !c.id) return null;
  if (c.created_by) return null; // Custom companions don't have pre-recorded reels
  if (MISMATCHED_REELS.has(c.id)) return null;
  return companionReelUrl(c.id);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Stable pseudo "viewer count" so it doesn't jump on every render.
export function viewerCount(id: string): string {
  const n = 180 + (hash(id + "v") % 1400);
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
}
