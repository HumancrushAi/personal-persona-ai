import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  const { data, error } = await sb.storage.from("reels").list("", { limit: 100 });
  if (error) {
    console.error(error);
    return;
  }
  console.log(data.map(f => f.name));
}

run();
