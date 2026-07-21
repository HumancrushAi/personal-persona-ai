// Looping showcase videos in the Supabase Storage public `reels` bucket.
// Used by the Cams pages to give each model a "live" video loop.
const BASE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/reels`;

export const REEL_NAMES = ["r7", "r10", "r8", "r11", "r9", "r1", "r2", "r3"];

export const reelUrl = (name: string) => `${BASE}/${name}.mp4`;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Deterministic reel per model — same result in the grid and the cam view.
export const reelForIndex = (i: number) => reelUrl(REEL_NAMES[i % REEL_NAMES.length]);
export const reelForId = (id: string) => reelUrl(REEL_NAMES[hash(id) % REEL_NAMES.length]);

// Stable pseudo "viewer count" so it doesn't jump on every render.
export function viewerCount(id: string): string {
  const n = 180 + (hash(id + "v") % 1400);
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
}
