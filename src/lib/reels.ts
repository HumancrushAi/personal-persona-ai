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
// With the clip suppressed the card, the tease sheet and the cams page all fall
// back to the portrait — the right person everywhere. Delete an id from here
// once its clip has been regenerated:
//
//   npx vite-node scripts/generate-reels.ts -- --force --only=Mina
const MISMATCHED_REELS = new Set([
  "f668101d-486e-45e2-9e87-69e70e272401", // Raven (old hoodie video)
  "f9aa06f5-7f49-4f5f-be43-f707e8a2ef78", // Mei (old hoodie video)
  "667ae29d-7e55-4588-b9c8-7bfad68f455e", // Jade (old hoodie video)
  "347215a1-7c96-4b0a-ada5-d21143578eae", // Chloe
  "b3b12aee-0c9e-4acf-95a5-0bd39a4e3da6", // Mina
  "48a8b105-4980-4220-a735-8cc958b5a1aa", // Esmé
  "b3f07a43-93bc-46c2-98e4-cb0efd2f7941", // Hana
  "b455cb54-7774-4f00-bba3-da962014bab7", // Jasmine
  "c9ccc15c-1048-41a5-bef7-372f966b955e", // Aaliyah
  "2169b7a5-8e9d-4687-aaa4-033cc828554d", // Elena
  "b34a5a2c-1aee-466f-9358-164d8ab8efb2", // Linh
  "723be6d5-e776-4e17-ba85-a3c0c78b3191", // Sienna
  "b0d3bd31-d7fd-40aa-85ec-f44f9a0d6697", // Daniella
  "11539c9d-7f10-48e0-9cd3-11024cd51dd5", // Tia
  "0adf981c-ab1b-468f-b71d-6ef8026217eb", // Maya
  "f209301b-ab3a-470e-8dcd-16f254f4a038", // Ebony
  "a0dd692a-236e-4ded-9724-acf4c0cf1591", // Yume
  "f982b325-1a5c-4072-88ce-6aafaa250e04", // Rei
  "094328dd-4779-4c1b-9f49-1adbf7186a4a", // Candy
  "1a649d81-a21d-4ac2-a27f-5c4978e1f3da", // Sunny
]);

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
