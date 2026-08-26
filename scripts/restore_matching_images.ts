import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const UPDATES = [
  // Aria: previous seductive portrait
  {
    id: "2c252785-fe75-4c84-a803-af9c484f6c96",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/companions/2c252785-fe75-4c84-a803-af9c484f6c96-1787585621838.png",
  },
  // Sofia: seductive portrait
  {
    id: "9a173fea-67ea-45d3-996a-9084dc3c98d0",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/companions/9a173fea-67ea-45d3-996a-9084dc3c98d0-1786196089811.png",
  },
  // Jade: goth babe
  {
    id: "667ae29d-7e55-4588-b9c8-7bfad68f455e",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/companions/goth-jade-1787595460404.png",
  },
  // Nyx: goth babe
  {
    id: "41aef40b-e716-4e4c-b372-cb56c073a9cb",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/companions/goth-nyx-1787595562886.png",
  },
  // Priya: exact frame
  {
    id: "24766b56-6df0-4cb8-a174-6d9120554a55",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/companions/24766b56-6df0-4cb8-a174-6d9120554a55-exactframe-1787592895639.jpg",
  },
  // Kaito: exact frame
  {
    id: "36e9c5fa-b401-4311-91e7-647f993f458a",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/companions/36e9c5fa-b401-4311-91e7-647f993f458a-exactframe-1787592898788.jpg",
  },
  // Akira: exact frame
  {
    id: "9eff4673-7824-4574-ae54-e2cb849c41d9",
    image_url: "https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/companions/9eff4673-7824-4574-ae54-e2cb849c41d9-exactframe-1787592901978.jpg",
  },
];

async function run() {
  for (const u of UPDATES) {
    const { error } = await sb.from("companions").update({ image_url: u.image_url }).eq("id", u.id);
    if (error) console.error("Error updating", u.id, error);
    else console.log("Updated", u.id, "->", u.image_url);
  }
  console.log("Restored matching companion images!");
}

run();
