import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const BANNER_IDS = [
  "2c252785-fe75-4c84-a803-af9c484f6c96", // Aria
  "9a173fea-67ea-45d3-996a-9084dc3c98d0", // Sofia
  "f668101d-486e-45e2-9e87-69e70e272401", // Raven
  "21f6d269-510b-4091-a59c-a3f14e720335", // Ren
  "347215a1-7c96-4b0a-ada5-d21143578eae", // Chloe
  "5eaaf212-055d-44f8-841e-94967f4a674c", // Vesper
  "78e5f6af-2c52-4dde-b710-09512d28f9aa", // Dante
  "7cc8217f-180c-4d10-89b5-5598622aa626", // Nova
];

async function run() {
  const { data: avatars } = await sb.storage.from("avatars").list("companions", { limit: 100 });
  console.log("avatars/companions:", avatars?.map(f => f.name));

  const { data: companions } = await sb.from("companions").select("id, name, image_url").in("id", BANNER_IDS);
  console.log("Companions:", companions);
}

run();
