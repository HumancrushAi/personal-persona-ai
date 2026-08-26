import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || "https://bhjnfsqbocyfczpbxtrz.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;
const sb = createClient(url, serviceKey);

async function check() {
  const { data: c } = await sb.from("companions").select("id, name, image_url").eq("id", "948f3ac7-a60c-4342-93fb-0f3ae3578101").single();
  console.log("Zara in DB:", c);
}

check();
