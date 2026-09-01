import { describe, it, expect, afterEach, vi } from "vitest";
import { generateCompanionPortrait } from "../portrait.server";

describe("generateCompanionPortrait", () => {
  const real = process.env.XAI_API_KEY;
  afterEach(() => {
    if (real === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = real;
    vi.restoreAllMocks();
  });

  it("says what is missing rather than failing cryptically", async () => {
    delete process.env.XAI_API_KEY;
    await expect(generateCompanionPortrait("a goth woman")).rejects.toThrow(/XAI_API_KEY/);
  });

  // A reference is what carries one face across a whole promo set, so it has to
  // reach the API as an image AND be stated in the prompt.
  it("passes a reference image through and anchors it in the prompt", async () => {
    process.env.XAI_API_KEY = "test";
    let sent: any = null;
    vi.stubGlobal("fetch", async (_url: string, init?: any) => {
      if (init?.body) {
        sent = JSON.parse(init.body);
        return new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }] }), { status: 200 });
      }
      return new Response("", { status: 200 });
    });

    const out = await generateCompanionPortrait("in a kitchen wearing jeans", {
      referenceUrl: "https://example.com/base.jpg",
    });
    expect(sent.image).toBe("https://example.com/base.jpg");
    expect(sent.prompt).toMatch(/^Exact same woman as the reference image/);
    expect(out).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("omits the reference fields when there is no reference", async () => {
    process.env.XAI_API_KEY = "test";
    let sent: any = null;
    vi.stubGlobal("fetch", async (_url: string, init?: any) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }] }), { status: 200 });
    });
    await generateCompanionPortrait("a goth woman on a balcony");
    expect(sent.image).toBeUndefined();
    expect(sent.prompt).toBe("a goth woman on a balcony");
    expect(sent.aspect_ratio).toBe("3:4");
  });

  it("passes custom aspectRatio when specified", async () => {
    process.env.XAI_API_KEY = "test";
    let sent: any = null;
    vi.stubGlobal("fetch", async (_url: string, init?: any) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }] }), { status: 200 });
    });
    await generateCompanionPortrait("a goth woman on a balcony", { aspectRatio: "9:16" });
    expect(sent.aspect_ratio).toBe("9:16");
  });
});
