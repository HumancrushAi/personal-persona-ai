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

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

const UPDATES = [
  // Aria: the stunning crimson silk slit dress full body portrait
  {
    id: "2c252785-fe75-4c84-a803-af9c484f6c96",
    name: "Aria",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/model-aria-fullbody-1787751648696.jpg",
  },
  // Vesper: sheer black mesh bodysuit & leather harness
  {
    id: "5eaaf212-055d-44f8-841e-94967f4a674c",
    name: "Vesper",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/model-vesper-fullbody-1787751666336.jpg",
  },
  // Sofia: skimpy white halter & linen pants
  {
    id: "9a173fea-67ea-45d3-996a-9084dc3c98d0",
    name: "Sofia",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/model-sofia-fullbody-1787751654074.jpg",
  },
  // Raven: black lace corset & leather mini
  {
    id: "f668101d-486e-45e2-9e87-69e70e272401",
    name: "Raven",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/model-raven-fullbody-1787751656663.jpg",
  },
  // Jade: alt goth babe
  {
    id: "667ae29d-7e55-4588-b9c8-7bfad68f455e",
    name: "Jade",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/companions/goth-jade-1787595460404.png",
  },
  // Ruby: curvy blonde
  {
    id: "eae18174-2e5e-4bc5-8c3f-16e1b5265e50",
    name: "Ruby",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/companions/model-ruby-1787601294256.jpg",
  },
  // Ebony: curvy golden glow beauty
  {
    id: "948f3ac7-a60c-4342-93fb-0f3ae3578101",
    name: "Ebony",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/companions/model-ebony-1787601370239.jpg",
  },
  // Dante: open linen shirt & abs
  {
    id: "78e5f6af-2c52-4dde-b710-09512d28f9aa",
    name: "Dante",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/model-dante-fullbody-1787751669708.jpg",
  },
];

async function run() {
  console.log("Connecting to Supabase at", url);
  for (const u of UPDATES) {
    const { error } = await sb.from("companions").update({ image_url: u.image_url }).eq("id", u.id);
    if (error) console.error("Error updating", u.name, error);
    else console.log("✅ Updated", u.name, "->", u.image_url);
  }
  console.log("Restored top attractive models with 1:1 matching media!");
  process.exit(0);
}

run().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
