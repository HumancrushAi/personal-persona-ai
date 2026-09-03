// Move inline companion portraits into storage.
//
//   npx vite-node --config vitest.config.ts scripts/repair-companion-images.ts -- --dry
//   npx vite-node --config vitest.config.ts scripts/repair-companion-images.ts
//
// Companions built from /create had their portrait written to
// companions.image_url as a base64 data: URL. A RunPod worker fetches the source
// photo with requests.get(), so a data: URI is unreachable and every selfie and
// video request for those companions failed with "This companion has no hosted
// photo to edit" — after charging and refunding the user.
//
// characters.functions.ts now uploads at creation time. This is the same repair
// for the rows written before that fix. The image itself is unchanged: the same
// bytes are uploaded and the row is repointed at the public URL.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

async function main() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const sb = createClient(url, key);

  const { data: rows, error } = await sb
    .from("companions")
    .select("id, name, image_url")
    .limit(1000);
  if (error) throw new Error(error.message);

  const broken = (rows ?? []).filter((r: any) => {
    const u = String(r.image_url ?? "");
    return u.startsWith("data:");
  });

  console.log(`${rows?.length ?? 0} companions, ${broken.length} with an inline portrait`);
  if (!broken.length) return;

  if (dryRun) {
    for (const r of broken) console.log(`  would repair ${r.name} (${r.id})`);
    return;
  }

  let fixed = 0;
  for (const r of broken as any[]) {
    try {
      const [meta, b64] = String(r.image_url).split(",");
      const mime = /data:([^;]+)/.exec(meta ?? "")?.[1] ?? "image/png";
      const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
      const bytes = Buffer.from(b64 ?? "", "base64");
      if (!bytes.length) {
        console.log(`  ${r.name}: empty payload, skipped`);
        continue;
      }

      const path = `companions/${r.id}-repaired-${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage
        .from("avatars")
        .upload(path, bytes, { contentType: mime, upsert: true });
      if (upErr) throw new Error(upErr.message);

      const publicUrl = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      const { error: updErr } = await sb
        .from("companions")
        .update({ image_url: publicUrl })
        .eq("id", r.id);
      if (updErr) throw new Error(updErr.message);

      fixed++;
      console.log(`  ✅ ${r.name} -> ${publicUrl}`);
    } catch (e) {
      console.log(`  ❌ ${r.name}: ${(e as Error).message}`);
    }
  }
  console.log(`\nrepaired ${fixed} of ${broken.length}`);
}

main().catch((e) => {
  console.error("❌", e?.message ?? e);
  process.exit(1);
});
