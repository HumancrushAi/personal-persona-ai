// The /create "Realistic or Anime" cards, one pair per gender. Paid search
// lands here, so they are friendly, clothed head-and-shoulders portraits, and
// each anime card is the realistic photo redrawn — same person, same sweater,
// same room — so the choice reads as a style, not two different people.
//
//   npx vite-node scripts/generate-style-cards.ts -- --out=<dir> [--n=3]
//
// Step 1 renders realistic candidates with xAI Imagine; pick one per gender,
// then step 2 (--anime=<girl.jpg>,<guy.jpg>) redraws it, the photo passed as
// the reference image.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

function loadEnv(file: string) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* optional */
  }
}
loadEnv(".env.local");
loadEnv(".env");

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, ...v] = a.slice(2).split("=");
    return [k, v.join("=") || "true"];
  }),
);
const key = process.env.XAI_API_KEY;
if (!key) throw new Error("XAI_API_KEY missing");
const OUT = args.out ?? ".style-cards";
mkdirSync(OUT, { recursive: true });

// What makes a photo read as a real person instead of a render: daylight from
// a window, visible skin texture, stray hairs, a plain lived-in room, and no
// beauty-retouch words at all ("flawless", "perfect skin" are what make plastic).
const LOOK =
  "candid head and shoulders portrait photo, soft natural window daylight, shot on a 50mm lens at f2, shallow depth of field, real unretouched skin texture with visible pores and fine lines, natural stray hairs, minimal makeup, softly blurred cozy apartment background with plants and warm wood, true-to-life colors, documentary photography, looking at the camera with a warm genuine smile";

const PEOPLE = {
  girl: "a beautiful young woman aged 23 with long soft wavy chestnut brown hair, light natural makeup, defined brows and soft rosy lips, bright hazel eyes, wearing a cream chunky knit sweater",
  guy: "a very handsome well-groomed man aged 27 with styled short dark brown hair, neat short stubble, strong jawline, wearing a navy blue crewneck sweater",
};

async function predict(prompt: string, image?: string): Promise<Buffer> {
  for (let i = 0; i < 3; i++) {
    try {
      const body: Record<string, unknown> = {
        model: process.env.XAI_IMAGE_MODEL || "grok-imagine-image-2.0",
        prompt,
        n: 1,
        aspect_ratio: "3:4",
      };
      if (image) body.image = image;
      const res = await fetch("https://api.x.ai/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const item = (await res.json()).data?.[0];
      if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
      if (!item?.url) throw new Error("no image");
      return Buffer.from(await (await fetch(item.url)).arrayBuffer());
    } catch (e: any) {
      console.log(`  retry ${i + 1}: ${String(e?.message ?? e).slice(0, 160)}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error("failed 3 times");
}

async function main() {
  if (args.anime) {
    // The reference alone is not enough — the first try drew a girl from the
    // man's photo — so the anime prompt restates who is in it.
    const [girl, guy] = args.anime.split(",");
    const jobs = (
      [
        ["girl", girl, "a beautiful young woman with long soft wavy chestnut brown hair falling past her shoulders, hazel eyes"],
        ["guy", guy, "a handsome young MAN, male, with short dark brown hair, short stubble on his jaw, masculine face"],
      ] as const
    ).flatMap(([who, file, desc]) => [0, 1].map((k) => ({ who, file, desc, k })));
    await Promise.all(
      jobs.map(async ({ who, file, desc, k }) => {
        const img = `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;
        const out = await predict(
          `High quality modern anime illustration redrawing the reference photo: ${desc}, wearing ${who === "girl" ? "a cream chunky knit sweater" : "a navy blue crewneck sweater"}, head and shoulders portrait, looking at the viewer with a warm friendly smile, softly blurred cozy apartment with plants and wooden bookshelves and window daylight behind. Clean line art, soft cel shading, same framing as the photo.`,
          img,
        );
        writeFileSync(`${OUT}/anime-${who}-${k}.jpg`, out);
        console.log(`✅ anime-${who}-${k}`);
      }),
    );
    return;
  }
  const n = Number(args.n ?? 3);
  const jobs = (Object.keys(PEOPLE) as (keyof typeof PEOPLE)[]).flatMap((who) =>
    Array.from({ length: n }, (_, i) => ({ who, i })),
  );
  await Promise.all(
    jobs.map(async ({ who, i }) => {
      const out = await predict(`${LOOK}, ${PEOPLE[who]}`);
      writeFileSync(`${OUT}/real-${who}-${i + Number(args.from ?? 0)}.jpg`, out);
      console.log(`✅ real-${who}-${i}`);
    }),
  );
}
main();
