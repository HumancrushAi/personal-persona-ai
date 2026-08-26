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
  console.log("=== CREATING CURVY MODELS: Ruby & Ebony ===");

  // 1. Ruby (Caucasian Curvy)
  try {
    const rubyFile = path.join(brainDir, "ruby_curvy_portrait_1787601030334.jpg");
    const rubyUrl = await uploadFileHttps(rubyFile, `companions/model-ruby-${Date.now()}.jpg`);
    const created = await dbQueryHttps("companions", "POST", {
      name: "Ruby",
      age: 25,
      ethnicity: "Caucasian",
      gender: "female",
      orientation: "straight",
      art_style: "realistic",
      short_bio: "Curvy, warm, and confident. Loves cozy evenings, good food, and deep late-night chats 💖",
      base_personality: "Warm, authentic, curvy, and confident.",
      image_url: rubyUrl,
      sort_order: 99,
    });
    console.log("✅ Ruby model created successfully:", created);
  } catch (err: any) {
    console.error("Ruby error:", err.message || err);
  }

  // 2. Ebony (Black Curvy)
  try {
    const ebonyFile = path.join(brainDir, "ebony_curvy_portrait_1787601065549.jpg");
    const ebonyUrl = await uploadFileHttps(ebonyFile, `companions/model-ebony-${Date.now()}.jpg`);
    const created = await dbQueryHttps("companions", "POST", {
      name: "Ebony",
      age: 26,
      ethnicity: "Black",
      gender: "female",
      orientation: "straight",
      art_style: "realistic",
      short_bio: "Gorgeous curvy queen with a big heart. Love soul music, laughing, and good energy ✨👑",
      base_personality: "Radiant, curvy, passionate, and warm.",
      image_url: ebonyUrl,
      sort_order: 100,
    });
    console.log("✅ Ebony model created successfully:", created);
  } catch (err: any) {
    console.error("Ebony error:", err.message || err);
  }

  console.log("Curvy models setup complete!");
}

main().catch(console.error);
