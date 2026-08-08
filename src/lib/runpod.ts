// RunPod Serverless client for the explicit media pipeline.
//
//   images -> FLUX.1 Kontext dev (image-TO-image). The companion's own photo is
//             the input frame, so her face/body carry over natively and there's
//             no face-swap pass to chain.
//   videos -> a private LoRA-tuned WAN image-to-video endpoint that runs the
//             weights on RunPod, so nothing is screened upstream.
//
// Both are async: POST /run returns a job id, GET /status/{id} reconciles it.
// Same shape as the Replicate path, so media_jobs bookkeeping is unchanged —
// the RunPod job id lives in media_jobs.replicate_id and provider says "runpod".
// Server-only: RUNPOD_API_KEY must never reach the client.

const RUNPOD_BASE = "https://api.runpod.ai/v2";

// The image endpoint is one of RunPod's public hosted models, so the slug is the
// same for every account. The video endpoint is account-private and has no
// sensible default — without RUNPOD_VIDEO_ENDPOINT set, video stays on Replicate.
const IMAGE_ENDPOINT = process.env.RUNPOD_IMAGE_ENDPOINT || "black-forest-labs-flux-1-kontext-dev";
const VIDEO_ENDPOINT = process.env.RUNPOD_VIDEO_ENDPOINT || "";

export function runpodEndpoint(kind: string): string | null {
  if (!process.env.RUNPOD_API_KEY) return null;
  if (kind === "image") return IMAGE_ENDPOINT || null;
  if (kind === "video") return VIDEO_ENDPOINT || null;
  return null;
}

// RunPod's states, normalized onto the same vocabulary the Replicate path uses
// so callers branch on one set of names.
export function runpodStatusOf(raw: string): "processing" | "succeeded" | "failed" {
  const s = (raw || "").toUpperCase();
  if (s === "COMPLETED") return "succeeded";
  if (s === "FAILED" || s === "CANCELLED" || s === "CANCELED" || s === "TIMED_OUT") return "failed";
  return "processing"; // IN_QUEUE / IN_PROGRESS
}

// Queue a job. A webhook makes RunPod call back on the terminal state, which is
// what delivers the media to users who close the tab mid-generation; the status
// poll is still the authoritative path.
export async function runpodRun(
  endpoint: string,
  input: Record<string, unknown>,
  webhookUrl?: string,
): Promise<{ id: string; status: string }> {
  const key = process.env.RUNPOD_API_KEY;
  if (!key) throw new Error("RUNPOD_API_KEY not configured");

  const res = await fetch(`${RUNPOD_BASE}/${endpoint}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(webhookUrl ? { input, webhook: webhookUrl } : { input }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`RunPod ${endpoint} error: ${res.status} ${text.slice(0, 300)}`);

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`RunPod ${endpoint}: unreadable response ${text.slice(0, 200)}`);
  }
  if (!json.id) throw new Error(`RunPod ${endpoint}: no job id in response`);
  return { id: json.id, status: json.status };
}

export async function runpodGet(
  endpoint: string,
  id: string,
): Promise<{ status: string; output?: any; error?: any }> {
  const key = process.env.RUNPOD_API_KEY;
  if (!key) throw new Error("RUNPOD_API_KEY not configured");

  const res = await fetch(`${RUNPOD_BASE}/${endpoint}/status/${id}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`RunPod status error: ${res.status}`);
  const json = await res.json();
  return { status: json.status, output: json.output, error: json.error };
}

// Pull the finished media URL out of an output payload. The two endpoints return
// different shapes:
//   Kontext -> { cost, result: "https://…png" }
//   WAN i2v -> { chunk_urls: ["…<jobId>_batch01.mp4"], final_video_url: "…batch_00_00001.mp4", … }
// chunk_urls is checked BEFORE final_video_url: final_video_url is a fixed
// `batch_00_00001.mp4` name in a shared bucket, so two concurrent jobs would
// hand back each other's clip. The chunk name carries the job id, so it's unique.
export function runpodOutputUrl(output: any): string | null {
  if (!output) return null;
  if (typeof output === "string") return isMediaUrl(output) ? output : null;
  if (Array.isArray(output)) {
    for (const item of output) {
      const found = runpodOutputUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof output !== "object") return null;

  const chunk = Array.isArray(output.chunk_urls) ? output.chunk_urls[0] : null;
  for (const candidate of [
    chunk,
    output.final_video_url,
    output.result,
    output.video_url,
    output.image_url,
    output.url,
  ]) {
    if (typeof candidate === "string" && isMediaUrl(candidate)) return candidate;
  }
  return null;
}

function isMediaUrl(s: string): boolean {
  return /^(https?:|data:)/i.test(s.trim());
}

// RunPod reports a worker-level failure in `error`, but an endpoint can also
// finish COMPLETED while its own payload reports trouble — surface both.
export function runpodOutputError(output: any, error: any): string | null {
  if (error) return typeof error === "string" ? error : JSON.stringify(error).slice(0, 300);
  if (output && typeof output === "object" && !Array.isArray(output)) {
    if (typeof output.error === "string") return output.error;
    if (typeof output.status === "string" && output.status.toLowerCase() === "error") {
      return output.message || "Generation reported an error";
    }
  }
  return null;
}
