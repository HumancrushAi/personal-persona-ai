// Which companions actually have a current live-cam clip.
//
// The generator prints progress to a terminal, which is no help once the run
// is detached or the terminal is gone — and no help at all in answering the
// only question that matters afterwards: is every card now showing the right
// face? This reads the bucket instead of the log.
//
// Custom companions are excluded for the same reason generate-reels.ts skips
// them: getEffectiveCompanionReel returns null for anything with created_by,
// so a clip for one is never displayed.
//
//   npx vite-node scripts/check-reels.ts
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(file: string) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnv(".env.local");

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const { data: companions } = await db
  .from("companions")
  .select("id, name, image_url, created_by")
  .order("sort_order", { ascending: true });

const rows = (companions ?? []).filter((c: any) => !c.created_by);

const { data: files } = await db.storage.from("reels").list("", { limit: 1000 });
const byName = new Map((files ?? []).map((f: any) => [f.name, f]));

// Anything touched since this run started counts as regenerated.
const RUN_START = new Date(Date.now() - 6 * 60 * 60 * 1000);

const fresh: string[] = [];
const stale: string[] = [];
const missing: string[] = [];

for (const c of rows as any[]) {
  const f = byName.get(`companion-${c.id}.mp4`);
  if (!f) { missing.push(c.name); continue; }
  const t = new Date(f.updated_at ?? f.created_at ?? 0);
  (t >= RUN_START ? fresh : stale).push(c.name);
}

console.log(`companions (catalogue): ${rows.length}`);
console.log(`clips in bucket:        ${(files ?? []).length}`);
console.log("");
console.log(`REGENERATED this run:   ${fresh.length}`);
console.log(`STILL OLD:              ${stale.length}${stale.length ? " -> " + stale.join(", ") : ""}`);
console.log(`NO CLIP AT ALL:         ${missing.length}${missing.length ? " -> " + missing.join(", ") : ""}`);
