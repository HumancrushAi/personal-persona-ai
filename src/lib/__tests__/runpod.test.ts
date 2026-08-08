import { describe, it, expect } from "vitest";
import { runpodStatusOf, runpodOutputUrl, runpodOutputError } from "../runpod";
import { kontextSelfiePrompt } from "../selfie";

describe("runpodStatusOf", () => {
  it("treats queued and running jobs as still processing", () => {
    for (const s of ["IN_QUEUE", "IN_PROGRESS", "", "SOMETHING_NEW"]) {
      expect(runpodStatusOf(s), s).toBe("processing");
    }
  });

  it("maps every terminal state", () => {
    expect(runpodStatusOf("COMPLETED")).toBe("succeeded");
    for (const s of ["FAILED", "CANCELLED", "CANCELED", "TIMED_OUT"]) {
      expect(runpodStatusOf(s), s).toBe("failed");
    }
  });
});

describe("runpodOutputUrl", () => {
  it("reads the Kontext image shape", () => {
    expect(runpodOutputUrl({ cost: 0.025, result: "https://cdn.example/out.png" })).toBe(
      "https://cdn.example/out.png",
    );
  });

  it("prefers the job-scoped chunk over the shared final_video_url filename", () => {
    // final_video_url is always `batch_00_00001.mp4` in a shared bucket, so two
    // concurrent jobs would hand back each other's clip.
    const out = {
      chunk_urls: ["https://cdn.example/abc-123_batch01.mp4"],
      final_video_url: "https://cdn.example/batch_00_00001.mp4",
      status: "success",
    };
    expect(runpodOutputUrl(out)).toBe("https://cdn.example/abc-123_batch01.mp4");
  });

  it("falls back to final_video_url when no chunks came back", () => {
    expect(runpodOutputUrl({ final_video_url: "https://cdn.example/v.mp4", chunk_urls: [] })).toBe(
      "https://cdn.example/v.mp4",
    );
  });

  it("returns null for missing or non-URL output", () => {
    for (const out of [null, undefined, {}, { result: "" }, { result: "not a url" }, []]) {
      expect(runpodOutputUrl(out)).toBeNull();
    }
  });
});

describe("runpodOutputError", () => {
  it("surfaces a worker error", () => {
    expect(runpodOutputError(null, "OOM on worker")).toBe("OOM on worker");
  });

  it("surfaces a payload that reports failure despite COMPLETED", () => {
    expect(runpodOutputError({ status: "error", message: "bad input image" }, null)).toBe(
      "bad input image",
    );
  });

  it("returns null for a healthy result", () => {
    expect(runpodOutputError({ result: "https://cdn.example/a.png" }, null)).toBeNull();
  });
});

describe("kontextSelfiePrompt", () => {
  const her = { age: 24, ethnicity: "Latina", gender: "female" };

  it("instructs the model to preserve the source identity", () => {
    const p = kontextSelfiePrompt(her, "in the shower", null);
    expect(p).toMatch(/same woman from the photo/i);
    expect(p).toMatch(/identical face/i);
    expect(p).toMatch(/in the shower/);
  });

  it("still renders the requested explicit act", () => {
    const p = kontextSelfiePrompt(her, "spread your legs and touch yourself", null);
    expect(p).toMatch(/naked/i);
    expect(p).toMatch(/spread legs|fingering/i);
  });

  it("uses the right pronouns and anatomy for a male companion", () => {
    const p = kontextSelfiePrompt({ age: 30, ethnicity: "Black", gender: "male" }, "naked", null);
    expect(p).toMatch(/same man from the photo/i);
    expect(p).toMatch(/\bhe is a 30-year-old/i);
    expect(p).toMatch(/penis/i);
    expect(p).not.toMatch(/bare breasts/i);
  });

  it("keeps her clothed when nothing explicit was asked for", () => {
    const p = kontextSelfiePrompt(her, "in a coffee shop wearing your red dress", null);
    expect(p).not.toMatch(/naked/i);
  });
});
