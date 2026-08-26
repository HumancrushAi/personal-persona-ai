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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  const { data: compFiles } = await sb.storage.from("avatars").list("companions", { limit: 100 });
  console.log("avatars/companions files:", compFiles?.map(f => f.name));

  const { data: rootFiles } = await sb.storage.from("avatars").list("", { limit: 100 });
  console.log("avatars root files:", rootFiles?.map(f => f.name));
}

run();
