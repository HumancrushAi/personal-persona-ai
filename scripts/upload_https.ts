import https from "https";
import fs from "fs";
import path from "path";

const SUPABASE_URL = "https://bhjnfsqbocyfczpbxtrz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoam5mc3Fib2N5ZmN6cGJ4dHJ6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mjk4MDg0OSwiZXhwIjoyMDk4NTU2ODQ5fQ.ISs5weFS86fjxzdzZdzMG4M33pssRxnl7ooQjHgoAmI";

const brainDir = "C:\\Users\\hp\\.gemini\\antigravity-ide\\brain\\ade30759-d487-4f65-a33c-2711e23ddf0c";

function uploadFileHttps(filePath: string, uploadKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fileBuf = fs.readFileSync(filePath);
    const url = new URL(`${SUPABASE_URL}/storage/v1/object/avatars/${uploadKey}`);

    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "image/jpeg",
          "Content-Length": fileBuf.length,
          x_upsert: "true",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(`${SUPABASE_URL}/storage/v1/object/public/avatars/${uploadKey}`);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(fileBuf);
    req.end();
  });
}

function dbQueryHttps(endpoint: string, method: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const dataStr = JSON.stringify(payload);
    const url = new URL(`${SUPABASE_URL}/rest/v1/${endpoint}`);

    const req = https.request(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              resolve(body);
            }
          } else {
            reject(new Error(`DB HTTP ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(dataStr);
    req.end();
  });
}

async function main() {
  console.log("=== UPLOADING WITH HTTPS MODULE ===");

  // 1. Aria
  try {
    const ariaFile = path.join(brainDir, "aria_realistic_portrait_1787599051551.jpg");
    const ariaUrl = await uploadFileHttps(ariaFile, `companions/model-aria-${Date.now()}.jpg`);
    await dbQueryHttps("companions?name=eq.Aria", "PATCH", { image_url: ariaUrl });
    console.log("✅ Aria avatar updated successfully:", ariaUrl);
  } catch (err: any) {
    console.error("Aria error:", err.message || err);
  }

  // 2. Nova
  try {
    const novaFile = path.join(brainDir, "nova_realistic_portrait_1787599069809.jpg");
    const novaUrl = await uploadFileHttps(novaFile, `companions/model-nova-${Date.now()}.jpg`);
    const created = await dbQueryHttps("companions", "POST", {
      name: "Nova",
      age: 24,
      ethnicity: "Caucasian",
      gender: "trans-female",
      orientation: "lesbian",
      art_style: "realistic",
      short_bio: "Creative, passionate, and living authentically. Love deep talks, indie rock, and night city walks 💫",
      base_personality: "Creative, passionate, and living authentically.",
      image_url: novaUrl,
      sort_order: 7,
    });
    console.log("✅ Nova model created successfully:", created);
  } catch (err: any) {
    console.error("Nova error:", err.message || err);
  }

  // 3. Ethan
  try {
    const ethanFile = path.join(brainDir, "ethan_realistic_portrait_1787599087837.jpg");
    const ethanUrl = await uploadFileHttps(ethanFile, `companions/model-ethan-${Date.now()}.jpg`);
    const created = await dbQueryHttps("companions", "POST", {
      name: "Ethan",
      age: 26,
      ethnicity: "Caucasian",
      gender: "male",
      orientation: "gay",
      art_style: "realistic",
      short_bio: "Fitness enthusiast, barista by day, photographer by night. Always down for late-night coffee ☕📷",
      base_personality: "Fitness enthusiast, barista by day, photographer by night.",
      image_url: ethanUrl,
      sort_order: 8,
    });
    console.log("✅ Ethan model created successfully:", created);
  } catch (err: any) {
    console.error("Ethan error:", err.message || err);
  }
}

main().catch(console.error);
