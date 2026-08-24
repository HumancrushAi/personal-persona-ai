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
  if (!name) return null;
  const key = name.toLowerCase();
  const reel = REEL_MAP[key];
  return reel ? `${BASE}/${reel}.mp4` : null;
};

// Which companion a given reel advertises ("r8" -> "aria"). Derived from
// REEL_MAP so the home banner and the cams pages can't drift apart — they used
// to keep separate hardcoded copies of the same pairing.
export const companionForReel = (reelName: string): string | null =>
  Object.entries(REEL_MAP).find(([, reel]) => reel === reelName)?.[0] ?? null;

// Her OWN looping clip, generated image-to-video from her portrait by
// scripts/generate-reels.ts. Addressed by companion id rather than tracked in a
// column, so no schema change is needed and the file is the source of truth.
// Missing clips 404, which the players treat as "fall back to the portrait" —
// so this is safe for companions whose clip hasn't been generated yet.
export const companionReelUrl = (id: string | null | undefined): string | null =>
  id ? `${BASE}/companion-${id}.mp4` : null;

// Effective reel resolver: male models (Kaito & Akira) always use the original
// stock male videos (r10 & r11). Female models use companionReelUrl(id) || getCompanionReel(name).
export function getEffectiveCompanionReel(c: { id?: string; name?: string | null; gender?: string | null }): string | null {
  if (!c) return null;
  const nameKey = (c.name || "").toLowerCase();
  const g = (c.gender || "").toLowerCase();
  const isMale = g.includes("male") && !g.includes("trans-female") || nameKey === "kaito" || nameKey === "akira";
  if (isMale) {
    return getCompanionReel(c.name);
  }
  return (c.id ? companionReelUrl(c.id) : null) || getCompanionReel(c.name);
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
