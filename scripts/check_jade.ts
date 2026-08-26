import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || "https://bhjnfsqbocyfczpbxtrz.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;
const sb = createClient(url, serviceKey);

async function check() {
  const { data: c } = await sb.from("companions").select("id, name, image_url").eq("name", "Jade").single();
  console.log("Jade in DB:", c);
  const videoUrl = `${url}/storage/v1/object/public/reels/companion-${c?.id}.mp4`;
  const res = await fetch(videoUrl, { method: "HEAD" });
  console.log("Jade reel status:", res.status, videoUrl);
}

check();
