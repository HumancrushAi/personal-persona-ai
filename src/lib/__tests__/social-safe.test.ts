import { describe, expect, it } from "vitest";
import { isExplicitMediaRequest, socialSafePrompt } from "../media.functions";

describe("social-safe media requests", () => {
  it("keeps an ordinary scene clothed", () => {
    const prompt = socialSafePrompt("sitting on a park bench sipping a martini");
    expect(isExplicitMediaRequest("sitting on a park bench sipping a martini")).toBe(false);
    expect(prompt).toContain("opaque one-piece swimsuit");
    expect(prompt).not.toMatch(/nude|naked|pussy|visible nipples/i);
  });

  it("preserves a non-explicit wide-legged pose while removing explicit anatomy", () => {
    const prompt = socialSafePrompt("on a park bench with legs spread, smiling");
    expect(prompt).toMatch(/knees comfortably apart/i);
    expect(prompt).toContain("keep the outfit on");
    expect(socialSafePrompt("show me your pussy on the bench")).not.toMatch(/pussy/i);
  });

  it("keeps explicit adult requests on the adult path", () => {
    expect(isExplicitMediaRequest("send a nude photo")).toBe(true);
    expect(isExplicitMediaRequest("fuck yourself with the glass dildo")).toBe(true);
  });
});
