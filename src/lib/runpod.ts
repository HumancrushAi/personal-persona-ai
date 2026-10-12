// RunPod Serverless client for the explicit media pipeline.
//
//   images -> a ComfyUI endpoint on an uncensored checkpoint when one is
//             configured (RUNPOD_COMFY_ENDPOINT, see comfy.ts); otherwise a
//             Kontext-shaped image endpoint; otherwise the video endpoint
//             below, with one frame cut out of the clip.
//   videos -> a private LoRA-tuned WAN image-to-video endpoint that runs the
//             weights on RunPod, so nothing is screened upstream.
//
// Both are async: POST /run returns a job id, GET /status/{id} reconciles it.
// Same shape as the Replicate path, so media_jobs bookkeeping is unchanged —
// the RunPod job id lives in media_jobs.replicate_id and provider says "runpod".
// Server-only: RUNPOD_API_KEY must never reach the client.

import { comfyImageUrl } from "./comfy";

const RUNPOD_BASE = "https://api.runpod.ai/v2";

// A dedicated, always-warm GPU pod running the same worker image with
// SERVE_API_LOCALLY=true: the identical job API, on the pod's port 8000,
// with no cold start and no queue for a GPU. It is the first place a photo
// goes; the serverless endpoint is the overflow when the pod is busy, and
// the fallback when it is down. docs/dedicated-comfy-pod.md sets it up.
//
// An "endpoint" everywhere below is either a serverless endpoint id or a
// full pod URL; runpodBase tells them apart. A job that went to the pod
// stores its id as "pod:<id>" so the status poll knows where to ask.
const POD_PREFIX = "pod:";

export function podUrl(): string | null {
  const u = (process.env.COMFY_POD_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(u) ? u : null;
}

export function isPodTarget(endpoint: string | null | undefined): boolean {
  return /^https?:\/\//i.test(endpoint ?? "");
}

export function runpodBase(endpoint: string): string {
  return isPodTarget(endpoint) ? endpoint.replace(/\/+$/, "") : `${RUNPOD_BASE}/${endpoint}`;
}

/** The stored job id for a job sent to `endpoint`. */
export function tagJobId(id: string, endpoint: string): string {
  return isPodTarget(endpoint) ? `${POD_PREFIX}${id}` : id;
}

/** Where to ask about a stored job id, and the id to ask with. */
export function targetFor(
  fallbackEndpoint: string | null,
  storedId: string | null | undefined,
): { endpoint: string | null; id: string } {
  const raw = storedId ?? "";
  if (raw.startsWith(POD_PREFIX)) return { endpoint: podUrl(), id: raw.slice(POD_PREFIX.length) };
  return { endpoint: fallbackEndpoint, id: raw };
}

// The pod answers /health; a pod that does not answer in a moment is not
// the pod to send a paying user's photo to. Remembered briefly so a burst of
// requests does not knock on it a hundred times.
let podHealth: { ok: boolean; at: number } | null = null;
export async function podHealthy(): Promise<boolean> {
  const base = podUrl();
  if (!base) return false;
  if (podHealth && Date.now() - podHealth.at < 20_000) return podHealth.ok;
  let ok = false;
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2_500) });
    ok = res.ok;
  } catch {
    ok = false;
  }
  podHealth = { ok, at: Date.now() };
  return ok;
}

/**
 * Where the next photo renders: the pod when it is up and has room, else
 * the serverless endpoint. Room is counted from this app's own open jobs on
 * the pod; the worker runs one render at a time and queues the rest, so
 * past a couple in flight a new one is better off on serverless.
 */
export async function pickImageTarget(
  supabaseAdmin: any,
  serverlessEndpoint: string | null,
): Promise<{ endpoint: string | null; pod: boolean }> {
  const base = podUrl();
  if (!base || !(await podHealthy())) return { endpoint: serverlessEndpoint, pod: false };
  const room = Number(process.env.COMFY_POD_CONCURRENCY || "2");
  try {
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await supabaseAdmin
      .from("media_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "processing"])
      .like("replicate_id", `${POD_PREFIX}%`)
      .gte("created_at", since);
    if ((count ?? 0) >= room && serverlessEndpoint) return { endpoint: serverlessEndpoint, pod: false };
  } catch {
    /* if the count fails, the pod still takes it */
  }
  return { endpoint: base, pod: true };
}

// Both endpoints are opt-in by env var, with NO default.
//
// There used to be a default of "black-forest-labs-flux-1-kontext-dev" (RunPod's
// public hosted FLUX.1 Kontext). Do not put it back. That model is aligned
// against nudity at the weights level: asked to "remove her top, bare breasts
// exposed" with `clothing, shirt, top, bra` negated and enable_safety_checker
// off, it returns the subject in the same top. It obeys every other edit in the
// same prompt — pose, scene, framing — so it is a selective refusal, not a bad
// prompt. enable_safety_checker only disables the post-hoc NSFW filter; it
// cannot unalign the model.
//
// The failure mode was silent and expensive: the job reports COMPLETED with no
// error, so the app charged the user, stored a clothed photo, and looked broken.
// An explicit-image endpoint must run uncensored weights (e.g. a ComfyUI
// serverless endpoint with a Pony/SDXL NSFW checkpoint). Until RUNPOD_IMAGE_
// ENDPOINT points at one, images stay on Replicate, which does render explicit.
const IMAGE_ENDPOINT = process.env.RUNPOD_IMAGE_ENDPOINT || "";
const VIDEO_ENDPOINT = process.env.RUNPOD_VIDEO_ENDPOINT || "";

// FLUX.1 Kontext, kept in its OWN variable rather than in IMAGE_ENDPOINT above.
//
// It is a fast, good image-to-image editor that carries a face perfectly, and it
// is the right renderer for clothed promo and banner plates. It is NOT a
// replacement for the uncensored path, and the two must not share a variable:
// IMAGE_ENDPOINT is read by the paid chat selfie in startImageJob, so pointing
// that at Kontext would silently bill users for clothed photos.
//
// Re-verified 2026-09-02 on a real job rather than trusting the note above:
// prompt "completely nude, topless, bare breasts fully exposed, no bra, no
// underwear", negatives "clothing, bra, briefs, lingerie, top, underwear,
// covered", enable_safety_checker false. The result kept the black lace bra on
// while obeying every other edit in the prompt. COMPLETED, no error, $0.025.
// The alignment is in the weights; no flag reaches it.
const KONTEXT_ENDPOINT = process.env.RUNPOD_KONTEXT_ENDPOINT || "";

// A ComfyUI serverless endpoint running an uncensored SDXL checkpoint: the one
// configuration that renders an explicit chat photo as a photo instead of a
// frame cut out of a video. When it is set it OUTRANKS everything else for
// images — see runpodEndpoint below and docs/uncensored-image-endpoint.md.
const COMFY_ENDPOINT = process.env.RUNPOD_COMFY_ENDPOINT || "";

export function runpodEndpoint(kind: string): string | null {
  if (!process.env.RUNPOD_API_KEY) return null;
  if (kind === "comfy") return COMFY_ENDPOINT || null;
  // The whole routing table for a photo, in order: a ComfyUI endpoint renders a
  // still in one pass; a Kontext-shaped image endpoint edits her portrait; and
  // with neither, the job is LAUNCHED on the video endpoint and a frame of the
  // clip is cut out as the still — see startImageJob.
  //
  // Resolving "image" to null here left checkMediaJob unable to find the job it
  // had just started, so the status poll returned "processing" forever and
  // completion depended entirely on the webhook landing. This has to resolve
  // the same way startImageJob chose, or a job is polled where it never went.
  if (kind === "image") return COMFY_ENDPOINT || IMAGE_ENDPOINT || VIDEO_ENDPOINT || null;
  if (kind === "video") return VIDEO_ENDPOINT || null;
  if (kind === "kontext") return KONTEXT_ENDPOINT || null;
  return null;
}

// Run and wait, for endpoints fast enough that queueing a media_jobs row and
// polling it is more machinery than the job is worth — Kontext returns in about
// ten seconds. /runsync can still time out into the queue on a slow cold start,
// so the job id is polled in that case rather than treated as a failure.
export async function runpodRunSync(
  endpoint: string,
  input: Record<string, unknown>,
  timeoutMs = 180_000,
): Promise<{ output?: any; error?: any }> {
  const key = process.env.RUNPOD_API_KEY;
  if (!key) throw new Error("RUNPOD_API_KEY not configured");

  const res = await fetch(`${runpodBase(endpoint)}/runsync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`RunPod ${endpoint} error: ${res.status} ${text.slice(0, 300)}`);

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`RunPod ${endpoint}: unreadable response ${text.slice(0, 200)}`);
  }

  if (runpodStatusOf(json.status) !== "processing")
    return { output: json.output, error: json.error };

  if (!json.id) throw new Error(`RunPod ${endpoint}: no job id to follow`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await runpodGet(endpoint, json.id);
    if (runpodStatusOf(poll.status) !== "processing")
      return { output: poll.output, error: poll.error };
  }
  throw new Error(`RunPod ${endpoint}: timed out after ${Math.round(timeoutMs / 1000)}s`);
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

  const res = await fetch(`${runpodBase(endpoint)}/run`, {
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
): Promise<{ status: string; output?: any; error?: any; delayTime?: number; executionTime?: number; workerId?: string }> {
  const key = process.env.RUNPOD_API_KEY;
  if (!key) throw new Error("RUNPOD_API_KEY not configured");

  const res = await fetch(`${runpodBase(endpoint)}/status/${id}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`RunPod status error: ${res.status}`);
  const json = await res.json();
  return {
    status: json.status,
    output: json.output,
    error: json.error,
    // How long it waited for a worker, and how long it ran: the difference
    // between "no GPU free" and "a worker is stuck on it".
    delayTime: typeof json.delayTime === "number" ? json.delayTime : undefined,
    executionTime: typeof json.executionTime === "number" ? json.executionTime : undefined,
    workerId: typeof json.workerId === "string" ? json.workerId : undefined,
  };
}

/** Cancel a queued or running job. Best effort: a job that already finished is simply done. */
export async function runpodCancel(endpoint: string, id: string): Promise<void> {
  const key = process.env.RUNPOD_API_KEY;
  if (!key) return;
  try {
    await fetch(`${runpodBase(endpoint)}/cancel/${id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch {
    /* nothing to do about it */
  }
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

  // ComfyUI's worker: { images: [{ filename, type: "base64" | "s3_url", data }] }.
  // Base64 comes back as a data: URL, which fetch reads natively, so the
  // storage step downloads it like any other output.
  const comfy = comfyImageUrl(output);
  if (comfy) return comfy;
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
  // The worker's top-level error is generic ("Job processing failed"); the
  // ComfyUI exception that says WHY is in output.details. Returning only the
  // string left a failed FaceID render with nothing to diagnose it from.
  const details =
    output && typeof output === "object" && !Array.isArray(output) && output.details
      ? ` — ${typeof output.details === "string" ? output.details : JSON.stringify(output.details)}`
      : "";
  if (error) {
    const head = typeof error === "string" ? error : JSON.stringify(error);
    return `${head}${details}`.slice(0, 2000);
  }
  if (output && typeof output === "object" && !Array.isArray(output)) {
    if (typeof output.error === "string") return output.error;
    if (typeof output.status === "string" && output.status.toLowerCase() === "error") {
      return output.message || "Generation reported an error";
    }
  }
  return null;
}

// The endpoint's tuned LoRA weights, exactly as its operator specified them.
// These are what the endpoint is tuned WITH; leaving the key out runs it at
// whatever defaults the worker falls back to, which is not what the endpoint was
// built and tested against. The public cams clips (scripts/generate-reels.ts)
// deliberately omit these — those are SFW idle loops, and they render fine
// without, so the key is optional rather than required.
export const VIDEO_LORA_STRENGTHS = {
  "HIGH Lora 3": 1,
  "HIGH Lora 4": 0.6,
  "HIGH Lora 5": 0.6,
  "HIGH Lora 6": 0.6,
  "LOW Lora 3": 0.6,
  "LOW Lora 4": 0.6,
  "LOW Lora 5": 0.6,
  "LOW Lora 6": 0.6,
};
