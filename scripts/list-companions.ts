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

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(url!, serviceKey!, { auth: { persistSession: false } });

async function main() {
  const { data, error } = await db.from("companions").select("id, name, gender, orientation, art_style, image_url, sort_order").order("sort_order");
  if (error) console.error(error);
  else console.log(JSON.stringify(data, null, 2));
}
main();
