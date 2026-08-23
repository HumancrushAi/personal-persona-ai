import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { refineMediaPrompt } from "../prompt-refiner.server";

const subject = { gender: "female", ethnicity: "Italian", age: 26 };

describe("refineMediaPrompt", () => {
  const realKey = process.env.XAI_API_KEY;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    if (realKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = realKey;
  });

  it("stays out of the way when no key is configured", async () => {
    delete process.env.XAI_API_KEY;
    expect(await refineMediaPrompt("photo", "in the shower", subject)).toBeNull();
  });

  it("returns null for an empty request rather than inventing one", async () => {
    process.env.XAI_API_KEY = "test";
    expect(await refineMediaPrompt("photo", "   ", subject)).toBeNull();
  });

  // A refusal must not reach the renderer — "I can't help with that" as a
  // generation prompt is worse than the builder output it would replace.
  it("rejects a refusal and falls back", async () => {
    process.env.XAI_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: "I'm sorry, I can't help with that request at all." } },
            ],
          }),
          { status: 200 },
        ),
    );
    expect(await refineMediaPrompt("photo", "naked on the bed", subject)).toBeNull();
  });

  it("rejects a stub answer", async () => {
    process.env.XAI_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
        }),
    );
    expect(await refineMediaPrompt("photo", "naked on the bed", subject)).toBeNull();
  });

  it("passes a real refined prompt through", async () => {
    process.env.XAI_API_KEY = "test";
    const good =
      "Wide full body shot of a woman standing in a bedroom, her whole body from head to feet in frame, face clearly visible, camera at a distance. She is already completely naked with nothing on, bare breasts visible. Candid photograph, natural light, real skin with visible pores.";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: good } }] }), {
          status: 200,
        }),
    );
    expect(await refineMediaPrompt("photo", "naked on the bed", subject)).toEqual([good]);
  });

  it("falls back when the API errors", async () => {
    process.env.XAI_API_KEY = "test";
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    expect(await refineMediaPrompt("video", "dancing", subject)).toBeNull();
  });
});

// A video is rendered scene by scene, so the refiner has to hand back one
// prompt per scene rather than a single block the endpoint would stretch.
describe("refineMediaPrompt video scenes", () => {
  const realKey = process.env.XAI_API_KEY;
  afterEach(() => {
    if (realKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = realKey;
    vi.restoreAllMocks();
  });

  it("splits a numbered list into separate scene prompts", async () => {
    process.env.XAI_API_KEY = "test";
    const body =
      "1. exact same woman as the reference image, completely nude, standing in a marble shower, water running over her tits, golden light, photorealistic 8k\n" +
      "2. exact same woman as the reference image, completely nude, kneeling on the wet floor, fingers between her legs, steam, photorealistic 8k";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: body } }] }), {
          status: 200,
        }),
    );
    const out = await refineMediaPrompt("video", "shower scene", subject, 2);
    expect(out).toHaveLength(2);
    expect(out?.[0]).toMatch(/^exact same woman/);
    expect(out?.[1]).toMatch(/kneeling/);
  });

  it("never returns more scenes than were asked for", async () => {
    process.env.XAI_API_KEY = "test";
    const body = [1, 2, 3, 4, 5]
      .map(
        (n) =>
          `${n}. exact same woman as the reference image, completely nude scene ${n}, luxury bedroom, soft lighting, photorealistic 8k detailed skin`,
      )
      .join("\n");
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: body } }] }), {
          status: 200,
        }),
    );
    expect(await refineMediaPrompt("video", "strip", subject, 2)).toHaveLength(2);
  });
});

// Promo prompts are the opposite content rules from chat media: clothed,
// publishable, and when a reference image supplies the face the model must not
// invent a conflicting one.
describe("refinePromoPrompt", () => {
  const realKey = process.env.XAI_API_KEY;
  afterEach(() => {
    if (realKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = realKey;
    vi.restoreAllMocks();
  });

  it("stays out of the way with no key", async () => {
    const { refinePromoPrompt } = await import("../prompt-refiner.server");
    delete process.env.XAI_API_KEY;
    expect(await refinePromoPrompt("a goth woman")).toBeNull();
  });

  it("tells the model not to invent looks when a reference is supplied", async () => {
    const { refinePromoPrompt } = await import("../prompt-refiner.server");
    process.env.XAI_API_KEY = "test";
    let sent: any = null;
    vi.stubGlobal("fetch", async (_u: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "the same woman as the reference image, identical face and hair, black silk robe, balcony, overcast daylight, 85mm lens, real skin texture with visible pores",
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    await refinePromoPrompt("on a balcony", true);
    expect(sent.messages[0].content).toMatch(/reference image/i);
    expect(sent.messages[0].content).toMatch(/Do NOT invent/i);
  });

  it("keeps the minor guard in the promo rules", async () => {
    const { refinePromoPrompt } = await import("../prompt-refiner.server");
    process.env.XAI_API_KEY = "test";
    let sent: any = null;
    vi.stubGlobal("fetch", async (_u: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "x".repeat(80) } }] }), {
        status: 200,
      });
    });
    await refinePromoPrompt("a woman in a kitchen");
    expect(sent.messages[0].content).toMatch(/never describe the subject as young/i);
  });
});
