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

function updateCompanionImageHttps(id: string, imageUrl: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const dataStr = JSON.stringify({ image_url: imageUrl });
    const url = new URL(`${SUPABASE_URL}/rest/v1/companions?id=eq.${id}`);

    const req = https.request(
      url,
      {
        method: "PATCH",
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
            resolve(body);
          } else {
            reject(new Error(`DB HTTP ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(dataStr);
    req.end();
  });
}

async function main() {
  console.log("=== UPLOADING FULL BODY PROVOCATIVE PORTRAITS ===");

  // 1. Aria
  try {
    const ariaFile = path.join(brainDir, "aria_fullbody_provocative_1787747858972.jpg");
    const ariaUrl = await uploadFileHttps(ariaFile, `companions/model-aria-fullbody-${Date.now()}.jpg`);
    await updateCompanionImageHttps("2c252785-fe75-4c84-a803-af9c484f6c96", ariaUrl);
    console.log("✅ Aria full-body portrait updated:", ariaUrl);
  } catch (err: any) {
    console.error("Aria error:", err.message || err);
  }

  // 2. Sofia
  try {
    const sofiaFile = path.join(brainDir, "sofia_fullbody_provocative_1787747889798.jpg");
    const sofiaUrl = await uploadFileHttps(sofiaFile, `companions/model-sofia-fullbody-${Date.now()}.jpg`);
    await updateCompanionImageHttps("9a173fea-67ea-45d3-996a-9084dc3c98d0", sofiaUrl);
    console.log("✅ Sofia full-body portrait updated:", sofiaUrl);
  } catch (err: any) {
    console.error("Sofia error:", err.message || err);
  }
}

main().catch(console.error);
