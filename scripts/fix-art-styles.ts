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
  console.log("Setting all companions art_style to 'realistic'...");
  const { data, error } = await supabase
    .from("companions")
    .update({ art_style: "realistic" })
    .neq("art_style", "realistic")
    .select("name, art_style");
  
  if (error) {
    console.error("Error updating art_style:", error);
    return;
  }
  console.log("Updated companions from anime to realistic:", data);
}

main().catch(console.error);
