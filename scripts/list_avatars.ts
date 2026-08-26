import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  const { data: compFiles } = await sb.storage.from("avatars").list("companions", { limit: 100 });
  console.log("avatars/companions files:", compFiles?.map(f => f.name));

  const { data: rootFiles } = await sb.storage.from("avatars").list("", { limit: 100 });
  console.log("avatars root files:", rootFiles?.map(f => f.name));
}

run();
