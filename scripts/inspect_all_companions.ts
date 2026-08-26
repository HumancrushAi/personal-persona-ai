import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  const { data: companions } = await sb.from("companions").select("id, name, image_url, gender").order("name");
  console.log(JSON.stringify(companions, null, 2));
}

run();
