import { describe, it, expect } from "vitest";
import { runpodBase, isPodTarget, tagJobId, targetFor, podUrl } from "../runpod";

// A dedicated pod serves the same job API as the serverless endpoint; the
// only difference the app has to carry is WHERE to send and ask, and that
// rides on the stored job id.
describe("the dedicated pod as a render target", () => {
  it("tells a pod URL from a serverless endpoint id", () => {
    expect(isPodTarget("https://abc123-8000.proxy.runpod.net")).toBe(true);
    expect(isPodTarget("fuwhx4m75ctlv2")).toBe(false);
    expect(runpodBase("fuwhx4m75ctlv2")).toBe("https://api.runpod.ai/v2/fuwhx4m75ctlv2");
    expect(runpodBase("https://abc123-8000.proxy.runpod.net/")).toBe("https://abc123-8000.proxy.runpod.net");
  });

  it("tags a pod job's id and routes the poll back to the pod", () => {
    const prev = process.env.COMFY_POD_URL;
    process.env.COMFY_POD_URL = "https://abc123-8000.proxy.runpod.net/";
    expect(podUrl()).toBe("https://abc123-8000.proxy.runpod.net");
    expect(tagJobId("j1", "https://abc123-8000.proxy.runpod.net")).toBe("pod:j1");
    expect(tagJobId("j1", "fuwhx4m75ctlv2")).toBe("j1");
    expect(targetFor("fuwhx4m75ctlv2", "pod:j1")).toEqual({ endpoint: "https://abc123-8000.proxy.runpod.net", id: "j1" });
    expect(targetFor("fuwhx4m75ctlv2", "j2")).toEqual({ endpoint: "fuwhx4m75ctlv2", id: "j2" });
    process.env.COMFY_POD_URL = "";
    expect(podUrl()).toBeNull();
    if (prev === undefined) delete process.env.COMFY_POD_URL;
    else process.env.COMFY_POD_URL = prev;
  });
});
