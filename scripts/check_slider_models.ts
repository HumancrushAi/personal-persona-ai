import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function check() {
  const { data } = await sb.from("companions").select("id, name, image_url");
  console.log("Companions:", data?.filter(c => ["Aria", "Sofia", "Raven", "Vesper", "Ruby", "Ebony", "Dante", "Ren", "Jade", "Nyx"].includes(c.name)));
}

check();
