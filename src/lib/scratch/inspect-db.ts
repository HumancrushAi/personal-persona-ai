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
loadEnv(".env");

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ""
);

async function main() {
  const { data, error } = await supabase
    .from("companions")
    .select("id, name, gender, image_url, art_style");
  if (error) {
    console.error("DB error:", error);
    return;
  }
  console.log("Companions count:", data?.length);
  for (const c of data ?? []) {
    console.log(`${c.name} (${c.gender}): art_style=${c.art_style}, image=${c.image_url}`);
  }
}

main().catch(console.error);
