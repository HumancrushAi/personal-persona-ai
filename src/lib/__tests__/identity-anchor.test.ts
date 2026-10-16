import { describe, expect, it, vi } from "vitest";
import { conversationIdentityAnchor } from "../identity-anchor";

function client(result: unknown, error?: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: result, error });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { api: { from }, from, select, eq, maybeSingle };
}

describe("conversationIdentityAnchor", () => {
  it("uses the canonical outer-chat portrait instead of a stale caller image", async () => {
    const mock = client({
      user_personalities: { companions: { image_url: " https://cdn.example/current.jpg " } },
    });
    await expect(
      conversationIdentityAnchor(mock.api, "conversation-1", "https://cdn.example/old.jpg"),
    ).resolves.toBe("https://cdn.example/current.jpg");
    expect(mock.from).toHaveBeenCalledWith("conversations");
    expect(mock.eq).toHaveBeenCalledWith("id", "conversation-1");
  });

  it("supports relation arrays returned by generated Supabase clients", async () => {
    const mock = client({
      user_personalities: [{ companions: [{ image_url: "https://cdn.example/model.jpg" }] }],
    });
    await expect(conversationIdentityAnchor(mock.api, "conversation-2", null)).resolves.toBe(
      "https://cdn.example/model.jpg",
    );
  });

  it("keeps the authorized caller portrait when the canonical lookup fails", async () => {
    const mock = client(null, new Error("temporary database failure"));
    await expect(
      conversationIdentityAnchor(mock.api, "conversation-3", "https://cdn.example/fallback.jpg"),
    ).resolves.toBe("https://cdn.example/fallback.jpg");
  });
});
