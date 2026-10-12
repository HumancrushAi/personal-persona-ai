// The dedicated pod, driven through ComfyUI's own API.
//
// The pod runs the same worker image as the serverless endpoint, so ComfyUI
// on it has every node and model. Its port 8000 is RunPod's local TEST
// server, which runs a job inside the status call — polled twice, it renders
// twice — so it is not used. ComfyUI's native API on 8188 has a real queue:
//
//   POST /upload/image   the job's input images (portrait, pose, start frame)
//   POST /prompt         queue the graph → prompt_id
//   GET  /history/{id}   finished? outputs and status
//   GET  /queue          still waiting or running?
//   GET  /view           the rendered file
//
// The functions here take and return the same shapes as the RunPod job API
// (input {workflow, images}; status IN_QUEUE / IN_PROGRESS / COMPLETED /
// FAILED; output {images:[{filename,type:"base64",data}]}), so the rest of
// the app does not know which one rendered a photo.

const TIMEOUT_MS = 20_000;

function base(url: string): string {
  return url.replace(/\/+$/, "");
}

// Every job's images get their own names: two photos in flight at once both
// upload "reference.png", and the second would overwrite the first's face.
function uniqueName(prefix: string, name: string): string {
  return `${prefix}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

function renameInGraph(node: unknown, from: string, to: string): unknown {
  if (typeof node === "string") return node === from ? to : node;
  if (Array.isArray(node)) return node.map((n) => renameInGraph(n, from, to));
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, renameInGraph(v, from, to)]));
  }
  return node;
}

export async function podQueue(
  url: string,
  input: Record<string, unknown>,
): Promise<{ id: string; status: string }> {
  const b = base(url);
  let workflow = input.workflow as Record<string, unknown>;
  if (!workflow || typeof workflow !== "object") throw new Error("pod job has no workflow");
  const prefix = `hc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const images = (input.images as { name: string; image: string }[] | undefined) ?? [];
  for (const img of images) {
    const name = uniqueName(prefix, img.name);
    const bytes = Buffer.from(String(img.image).replace(/^data:[^;]+;base64,/, ""), "base64");
    const form = new FormData();
    form.append("image", new Blob([bytes], { type: "image/png" }), name);
    form.append("overwrite", "true");
    const up = await fetch(`${b}/upload/image`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!up.ok) throw new Error(`pod upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
    workflow = renameInGraph(workflow, img.name, name) as Record<string, unknown>;
  }
  const res = await fetch(`${b}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: prefix }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`pod rejected the graph ${res.status}: ${text.slice(0, 400)}`);
  const json = JSON.parse(text);
  if (!json.prompt_id) throw new Error(`pod gave no prompt id: ${text.slice(0, 200)}`);
  return { id: String(json.prompt_id), status: "IN_QUEUE" };
}

async function historyEntry(b: string, id: string): Promise<any | null> {
  const hist = await fetch(`${b}/history/${id}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!hist.ok) throw new Error(`pod history ${hist.status}`);
  return (await hist.json())?.[id] ?? null;
}

export async function podStatus(
  url: string,
  id: string,
): Promise<{ status: string; output?: any; error?: any }> {
  const b = base(url);
  let entry = await historyEntry(b, id);
  if (!entry) {
    // Not finished: running, waiting, or unknown to this pod (restarted).
    const q = await fetch(`${b}/queue`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!q.ok) return { status: "IN_PROGRESS" };
    const queue = await q.json();
    const has = (list: any[]) => (list ?? []).some((item) => Array.isArray(item) && item[1] === id);
    if (has(queue.queue_running)) return { status: "IN_PROGRESS" };
    if (has(queue.queue_pending)) return { status: "IN_QUEUE" };
    // Gone from the queue: it may have finished between the two reads. Ask
    // history once more before calling it lost.
    entry = await historyEntry(b, id);
    if (!entry) return { status: "FAILED", error: "the pod lost this job (it may have restarted)" };
  }
  const state = entry.status?.status_str;
  if (state === "error") {
    const err = (entry.status?.messages ?? []).find((m: any) => m?.[0] === "execution_error")?.[1];
    return {
      status: "FAILED",
      error: err ? `${err.node_type ?? "node"}: ${err.exception_message ?? "failed"}` : "ComfyUI reported an error",
    };
  }
  // The SaveImage outputs, read back as base64 — the worker's own output shape.
  const images: { filename: string; type: string; data: string }[] = [];
  for (const out of Object.values(entry.outputs ?? {}) as any[]) {
    for (const img of out?.images ?? []) {
      if (img.type && img.type !== "output") continue;
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? "", type: img.type ?? "output" });
      const file = await fetch(`${b}/view?${q}`, { signal: AbortSignal.timeout(60_000) });
      if (!file.ok) continue;
      images.push({ filename: img.filename, type: "base64", data: Buffer.from(await file.arrayBuffer()).toString("base64") });
    }
  }
  if (!images.length) {
    if (entry.status?.completed === false) return { status: "IN_PROGRESS" };
    return { status: "FAILED", error: "the pod finished the graph but saved no image" };
  }
  return { status: "COMPLETED", output: { images } };
}

export async function podCancel(url: string, id: string): Promise<void> {
  try {
    await fetch(`${base(url)}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete: [id] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    /* best effort */
  }
}

export async function podAlive(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${base(url)}/system_stats`, { signal: AbortSignal.timeout(2_500) });
    return res.ok;
  } catch {
    return false;
  }
}
