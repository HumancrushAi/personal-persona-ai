// Regenerate companion portraits with the FIXED generator (gender passed
// through + nudity suppressed in the negative prompt), upload them to the public
// avatars bucket, and repoint companions.image_url.
//
// Run through vite-node so it imports the SAME prompt/model code the app uses —
// no duplicated prompt logic to drift out of sync:
//
//   npx vite-node scripts/regenerate-portraits.ts -- --dry
//   npx vite-node scripts/regenerate-portraits.ts -- --only=Kaito,Akira
//   npx vite-node scripts/regenerate-portraits.ts            # all of them
//
// Costs a Replicate generation per companion and OVERWRITES production photos.
// The previous image is left in the bucket, so an old URL can be restored.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { generateImage } from "../src/lib/ai";
import { portraitPrompt, type PortraitSubject } from "../src/lib/portrait";

function loadEnv(file: string) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* file optional */
  }
}
loadEnv(".env.local");
loadEnv(".env");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg
  ? onlyArg
      .slice("--only=".length)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  : null;

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  process.exit(1);
}
if (!process.env.REPLICATE_API_TOKEN) {
  console.error("❌ REPLICATE_API_TOKEN missing — portraits render on Replicate/Pony.");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

type Row = PortraitSubject & { id: string; image_url: string; sort_order: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Uploading ~900KB to Supabase over a long batch hits transient network errors
// as readily as the generate call does, and a bare "fetch failed" there used to
// discard a portrait that had already been paid for and rendered.
// Six attempts backing off 10s..60s covers about three and a half minutes of
// downtime. Four attempts (one minute) was not enough: a single outage mid-batch
// burned through the retries on companion 14 and then failed the remaining 17
// back to back, because every one of them hit the same dead network and gave up
// after a minute of its own.
async function withRetry<T>(fn: () => Promise<T>, what: string, attempts = 6): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = e?.message ?? String(e);
      if (!isRetryable(msg) || i === attempts - 1) throw e;
      const wait = Math.min(60_000, 10_000 * (i + 1));
      process.stdout.write(` (${what}: ${msg.slice(0, 30)}, retry in ${wait / 1000}s)`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function isRetryable(msg: string): boolean {
  return (
    /429|throttl/i.test(msg) ||
    /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket|network|50[234]/i.test(msg)
  );
}

// Replicate throttles hard (6 predictions/min, burst 1) whenever the account
// balance is under $5, and a throttled create returns instantly — so a failure
// makes the NEXT create fire immediately and get throttled too. Back off and
// retry instead of burning through the whole roster on 429s.
async function generateWithRetry(
  prompt: string,
  gender: string,
  attempts = 4,
): Promise<string> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return (await generateImage(prompt, { gender, noNudity: true })) as string;
    } catch (e: any) {
      lastErr = e;
      const msg = e?.message ?? String(e);
      // Throttling is the expected failure on a low-balance account, but a bare
      // "fetch failed" network blip is just as common over a long batch and used
      // to kill the companion outright. Both are worth another go.
      const retryable =
        /\b429\b|throttl/i.test(msg) ||
        /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket|network|50[234]/i.test(msg);
      if (!retryable || i === attempts - 1) throw e;
      const wait = 20_000 * (i + 1);
      process.stdout.write(` (${msg.slice(0, 40)}, retrying in ${wait / 1000}s)`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function main() {
  const { data, error } = await db
    .from("companions")
    .select("id, name, age, ethnicity, gender, art_style, short_bio, image_url, sort_order")
    .order("sort_order");
  if (error) throw new Error(error.message);

  let rows = (data ?? []) as Row[];
  if (only) rows = rows.filter((r) => only.includes(r.name.toLowerCase()));

  console.log(`${rows.length} companion(s) to regenerate${dryRun ? "  [DRY RUN]" : ""}\n`);

  let ok = 0;
  const failures: string[] = [];

  for (const [i, c] of rows.entries()) {
    const label = `${String(i + 1).padStart(2)}/${rows.length} ${c.name} (${c.gender})`;
    const prompt = portraitPrompt(c);

    if (dryRun) {
      console.log(`${label}\n    ${prompt.slice(0, 220)}…\n`);
      continue;
    }

    process.stdout.write(`${label} … generating`);
    try {
      // Same call the admin panel makes: gender drives the negative prompt,
      // noNudity keeps the public face clothed.
      const dataUrl = await generateWithRetry(prompt, c.gender);
      const bytes = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
      if (!bytes.length) throw new Error("empty image");

      const path = `companions/${c.id}-${Date.now()}.png`;
      await withRetry(async () => {
        const { error: upErr } = await db.storage
          .from("avatars")
          .upload(path, bytes, { contentType: "image/png", upsert: true });
        if (upErr) throw upErr;
      }, "upload");

      const { data: pub } = db.storage.from("avatars").getPublicUrl(path);
      await withRetry(async () => {
        const { error: updErr } = await db
          .from("companions")
          .update({ image_url: pub.publicUrl })
          .eq("id", c.id);
        if (updErr) throw updErr;
      }, "db");

      ok++;
      console.log(`\r${label} … ✅ ${Math.round(bytes.length / 1024)}KB`);
      // Stay under the 6-creates-per-minute throttle on low-balance accounts.
      if (i < rows.length - 1) await sleep(11_000);
    } catch (e: any) {
      failures.push(`${c.name}: ${e.message || e}`);
      console.log(`\r${label} … ❌ ${e.message || e}`);
    }
  }

  if (dryRun) return;
  console.log(`\nDone: ${ok} regenerated, ${failures.length} failed.`);
  for (const f of failures) console.log(`   ❌ ${f}`);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
