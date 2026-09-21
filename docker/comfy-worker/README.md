# The ComfyUI worker image (`COMFY_GRAPH=faceid`)

## What this is for

Renders were coming back as a different woman each time. The cause is structural,
not a prompt bug: `COMFY_GRAPH=img2img` anchors identity by starting the sampler
from her portrait, which also anchors the **composition**. Turn denoise down far
enough to keep her face and the pose stops obeying; turn it up far enough for the
pose to obey — which a prop or posture request needs — and her face goes with it.
There is no value that does both.

FaceID anchors identity **independently of composition**: the face comes from an
IP-Adapter embedding of her portrait, the picture comes from the prompt. That is
the only way to get the requested pose *and* the same face.

It needs three ComfyUI custom node packs and `insightface`, and a RunPod
serverless worker is an ephemeral container — anything installed into a running
worker is gone at the next cold start. So the nodes are baked into this image.

**This is the image endpoint only.** The video endpoint runs a different image
with the WAN stack in it. Nothing here touches it.

## What to do

### 1. Build the image

GitHub → **Actions** → **comfy-worker** → **Run workflow**.

Takes roughly 15–25 minutes; `insightface` is compiled from source. The run
summary prints the image name when it finishes. It rebuilds automatically on any
push that changes this directory.

### 2. Make the package public

Once, by hand. RunPod pulls anonymously and a private package fails with an
authentication error that looks like a missing image.

GitHub profile/org → **Packages** → `hc-comfy-worker` → **Package settings** →
**Change visibility** → **Public**.

### 3. Point the endpoint at it

RunPod → Serverless → the **ComfyUI** endpoint (not the video one) → **Edit** →
**Container Image** → paste the name from the run summary:

```
ghcr.io/<your-github-owner>/hc-comfy-worker:latest
```

Confirm a **network volume is attached**. Without one the weights have nowhere to
live, the boot logs say `no network volume attached. Skipping.`, and the graph
fails at the loader with "model not found".

### 4. Turn it on

Vercel → Settings → Environment Variables → `COMFY_GRAPH` → `faceid` → redeploy.

### 5. First render is slow

The first cold start downloads about 2GB of weights to the volume
(`provision-models.sh`, which runs before ComfyUI starts). Every cold start after
that finds them already there and skips it. If a render times out on the very
first request, send it again rather than changing anything.

## Rolling back

`COMFY_GRAPH=img2img` in Vercel and redeploy. The endpoint can keep running this
image — the img2img graph uses only core nodes, so it works on either.

## Knobs

| Variable | Default | What it does |
|---|---|---|
| `COMFY_IPA_WEIGHT` | `0.75` | How hard the face is held. Raise toward 0.9 if she still drifts; lower toward 0.6 if faces look pasted on. |
| `COMFY_IPA_LORA` | `0.6` | Strength of the FaceID LoRA that accompanies the adapter. |
| `COMFY_FACE_DENOISE` | `0.5` | How much FaceDetailer is allowed to repair the face after sampling. |
| `COMFY_FACEID_PRESET` | `FACEID PLUS V2` | Adapter preset. Leave it unless the weights change. |

Tune `COMFY_IPA_WEIGHT` first; it is the one that decides whether she looks like
herself.

## What is in the image

| | |
|---|---|
| Base | `runpod/worker-comfyui:5.10.0-base`, pinned — a worker image that changes under you is a render that changes under you |
| Nodes | `comfyui_ipadapter_plus`, `comfyui-impact-pack`, `comfyui-impact-subpack` |
| Python | `insightface==0.7.3`, `onnxruntime-gpu`, `numpy<2` |
| Weights | fetched to the volume at boot, not baked in — see `provision-models.sh` |

Three node packs, not two: `UltralyticsDetectorProvider`, which feeds
FaceDetailer its face bounding box, was split out of Impact Pack into Impact
Subpack. Install only the main pack and the graph fails validation with a
FaceDetailer that has no detector.

`numpy` is pinned under 2 because `insightface` 0.7.3 still uses the removed
1.x C API. Unpinned it resolves to numpy 2 and fails at import with
`numpy.core.multiarray failed to import`, which reads like a broken install
rather than a version conflict.

## The alternative that is not this

`faceid-nodes.Dockerfile.snippet` in this directory patches the same three node
packs into `geoffmccabe/runpod-api1` instead. Use it only if you want one image
serving both images and video. It means rebuilding the whole WAN stack on every
change, which is why this standalone image exists.
