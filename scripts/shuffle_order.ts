// Shuffle the order companions appear in across the site.
//
//   npx vite-node scripts/shuffle_order.ts -- --dry
//   npx vite-node scripts/shuffle_order.ts
//
// Only system companions (created_by null) move, and only among the sort_order
// values they already hold, so user-made companions keep their places.
//
// sort_order is also what picks a voice for a companion with no voice_id
// (voiceFor), so before anything moves, each of those has the voice she speaks
// with today written into voice_id. Nobody sounds different afterwards.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { voiceFor } from "../src/lib/voices";

function loadEnv(file: string) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* optional */
  }
}
loadEnv(".env.local");
loadEnv(".env");

const dryRun = process.argv.includes("--dry");
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const { data, error } = await db
    .from("companions")
    .select("id, name, gender, sort_order, voice_id")
    .is("created_by", null)
    .order("sort_order");
  if (error) throw error;
  const rows = data ?? [];

  // Fisher-Yates over the existing values.
  const slots = rows.map((r) => r.sort_order ?? 0);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  let pinned = 0;
  for (const [i, r] of rows.entries()) {
    const update: { sort_order: number; voice_id?: string } = { sort_order: slots[i] };
    if (!(r.voice_id ?? "").trim()) {
      update.voice_id = voiceFor(r);
      pinned++;
    }
    if (dryRun) {
      console.log(`${r.name.padEnd(10)} ${String(r.sort_order).padStart(4)} -> ${String(slots[i]).padStart(4)}${update.voice_id ? `  (voice pinned: ${update.voice_id})` : ""}`);
      continue;
    }
    const { error: upErr } = await db.from("companions").update(update).eq("id", r.id);
    if (upErr) throw upErr;
  }
  console.log(`${dryRun ? "[dry] " : ""}shuffled ${rows.length} companions, pinned ${pinned} voices`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`❌ ${e?.message ?? e}`);
    process.exit(1);
  });
