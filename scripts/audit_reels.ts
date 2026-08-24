import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

function loadEnv(file: string) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnv(".env.local");
loadEnv(".env");

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  const { data: companions } = await db
    .from("companions")
    .select("id, name, gender")
    .order("sort_order");

  const BASE = `${url}/storage/v1/object/public/reels`;

  console.log("=== Auditing getEffectiveCompanionReel ===\n");
  for (const c of companions || []) {
    const nameKey = (c.name || "").toLowerCase();
    const REEL_MAP: Record<string, string> = { kaito: "r10", akira: "r11", sofia: "r1", aria: "r8", priya: "r3" };
    
    let targetUrl = "";
    if (REEL_MAP[nameKey]) {
      targetUrl = `${BASE}/${REEL_MAP[nameKey]}.mp4`;
    } else {
      targetUrl = `${BASE}/companion-${c.id}.mp4`;
    }

    try {
      const res = await fetch(targetUrl, { method: "HEAD" });
      console.log(`[${res.status}] ${c.name.padEnd(12)} -> ${targetUrl}`);
    } catch (e: any) {
      console.log(`[FAIL] ${c.name.padEnd(12)} -> ${e.message}`);
    }
  }
}

main().then(() => process.exit(0)).catch(console.error);
