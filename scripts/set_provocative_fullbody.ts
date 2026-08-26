import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const UPDATES = [
  // Aria: full body crimson silk dress
  {
    id: "2c252785-fe75-4c84-a803-af9c484f6c96",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/model-aria-fullbody-1787751648696.jpg",
  },
  // Sofia: full body white halter & linen pants
  {
    id: "9a173fea-67ea-45d3-996a-9084dc3c98d0",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/model-sofia-fullbody-1787751654074.jpg",
  },
  // Raven: full body lace corset, leather mini & fishnets
  {
    id: "f668101d-486e-45e2-9e87-69e70e272401",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/model-raven-fullbody-1787751656663.jpg",
  },
  // Vesper: full body black mesh bodysuit & leather harness
  {
    id: "5eaaf212-055d-44f8-841e-94967f4a674c",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/model-vesper-fullbody-1787751666336.jpg",
  },
  // Dante: full body open white linen shirt & abs
  {
    id: "78e5f6af-2c52-4dde-b710-09512d28f9aa",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/model-dante-fullbody-1787751669708.jpg",
  },
  // Ren: full body open bomber jacket & toned chest
  {
    id: "21f6d269-510b-4091-a59c-a3f14e720335",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/model-ren-fullbody-1787751660187.jpg",
  },
  // Ruby: curvy model
  {
    id: "eae18174-2e5e-4bc5-8c3f-16e1b5265e50",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/companions/model-ruby-1787601294256.jpg",
  },
  // Ebony: curvy model
  {
    id: "948f3ac7-a60c-4342-93fb-0f3ae3578101",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/companions/model-ebony-1787601370239.jpg",
  },
];

async function run() {
  for (const u of UPDATES) {
    const { error } = await sb.from("companions").update({ image_url: u.image_url }).eq("id", u.id);
    if (error) console.error("Error updating", u.id, error);
    else console.log("Updated", u.id, "->", u.image_url);
  }
  console.log("All banner models updated with matching provocative full-body portraits!");
}

run();
