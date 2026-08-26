import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const ARTIFACTS = "C:\\Users\\hp\\.gemini\\antigravity-ide\\brain\\ade30759-d487-4f65-a33c-2711e23ddf0c";

const MODELS = [
  { id: "2c252785-fe75-4c84-a803-af9c484f6c96", name: "Aria",   file: "aria_fullbody_1787751397559.jpg" },
  { id: "9a173fea-67ea-45d3-996a-9084dc3c98d0", name: "Sofia",  file: "sofia_fullbody_1787751443916.jpg" },
  { id: "f668101d-486e-45e2-9e87-69e70e272401", name: "Raven",  file: "raven_fullbody_1787751162028.jpg" },
  { id: "21f6d269-510b-4091-a59c-a3f14e720335", name: "Ren",    file: "ren_fullbody_1787751190592.jpg" },
  { id: "347215a1-7c96-4b0a-ada5-d21143578eae", name: "Chloe",  file: "chloe_fullbody_1787751227521.jpg" },
  { id: "5eaaf212-055d-44f8-841e-94967f4a674c", name: "Vesper", file: "vesper_fullbody_1787751259094.jpg" },
  { id: "78e5f6af-2c52-4dde-b710-09512d28f9aa", name: "Dante",  file: "dante_fullbody_1787751308649.jpg" },
  { id: "7cc8217f-180c-4d10-89b5-5598622aa626", name: "Nova",   file: "nova_fullbody_1787751345487.jpg" },
];

async function run() {
  for (const m of MODELS) {
    const localPath = path.join(ARTIFACTS, m.file);
    if (!fs.existsSync(localPath)) {
      console.error(`❌ File not found: ${localPath}`);
      continue;
    }

    const buf = fs.readFileSync(localPath);
    const storageName = `model-${m.name.toLowerCase()}-fullbody-${Date.now()}.jpg`;

    // Upload to Supabase storage
    const { error: upErr } = await sb.storage
      .from("avatars")
      .upload(storageName, buf, { contentType: "image/jpeg", upsert: true });

    if (upErr) {
      console.error(`❌ Upload failed for ${m.name}:`, upErr.message);
      continue;
    }

    // Get public URL
    const { data: urlData } = sb.storage.from("avatars").getPublicUrl(storageName);
    const publicUrl = urlData.publicUrl;

    // Update database
    const { error: dbErr } = await sb
      .from("companions")
      .update({ image_url: publicUrl })
      .eq("id", m.id);

    if (dbErr) {
      console.error(`❌ DB update failed for ${m.name}:`, dbErr.message);
    } else {
      console.log(`✅ ${m.name}: uploaded & updated → ${publicUrl}`);
    }
  }

  console.log("\n🎉 All banner models updated with full-body images!");
}

run().catch(console.error);
