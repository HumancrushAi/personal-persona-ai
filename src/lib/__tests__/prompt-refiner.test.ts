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
    expect(await refineMediaPrompt("photo", "naked on the bed", subject)).toBe(good);
  });

  it("falls back when the API errors", async () => {
    process.env.XAI_API_KEY = "test";
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    expect(await refineMediaPrompt("video", "dancing", subject)).toBeNull();
  });
});
