# The uncensored image endpoint

Chat photos are rendered by one of three things, and the app picks whichever is
configured, in this order:

| Provider  | Env var                 | What it is                                                       |
| --------- | ----------------------- | ---------------------------------------------------------------- |
| `comfy`   | `RUNPOD_COMFY_ENDPOINT` | A ComfyUI serverless endpoint on an uncensored checkpoint        |
| `kontext` | `RUNPOD_IMAGE_ENDPOINT` | A Kontext-shaped image endpoint that edits her portrait          |
| `wan`     | `RUNPOD_VIDEO_ENDPOINT` | The video endpoint, with one frame cut out of a five-second clip |

With neither of the first two set, every photo is `wan`: a video model painting
a nude over her clothed portrait at 480–640 lines, from which the least smeared
frame is kept. That has a ceiling, and the ceiling is what users describe as
"weird" and "not realistic" — the anatomy gets a few dozen pixels, the pose is
still resolving, and nothing about the prompt can add detail that was never
rendered.

`comfy` is the fix: a still, rendered as a still, at 832×1216, with the sampler
and step count the checkpoint was tuned for.

## What you have to build

RunPod does not host an uncensored image model you can just call. You run one.

1. **Pick a checkpoint.** An SDXL photoreal NSFW checkpoint is the right class of
   model — the ones people use for this are Lustify SDXL, BigLust, Pony Realism
   and RealVisXL. Download the `.safetensors` onto a RunPod **network volume**
   (a 50GB volume is plenty and costs a few dollars a month). The volume is what
   keeps cold starts short; baking a 7GB checkpoint into the image does not.
2. **Create a serverless endpoint** from the `runpod/worker-comfyui` image,
   attached to that volume. Pick a 24GB GPU class (A5000/4090); SDXL at
   832×1216 fits comfortably. Set min workers 0, max 1–3, idle timeout ~10s.
3. **Note the endpoint ID** — the string in its URL, e.g. `abc123xyz`.
4. **Set the env vars** below in Vercel, and redeploy.

Cost, roughly: a 30-step SDXL render is 3–6 seconds of GPU. At RunPod's per
second pricing that is well under a cent a picture, plus the volume. The photo
sells for 8 credits, so the margin is far better than the WAN path, which burns
GPU-minutes rendering 81 frames to throw 80 of them away.

## Environment variables

```
RUNPOD_COMFY_ENDPOINT="abc123xyz"       # required — turns this path on
COMFY_CHECKPOINT="lustifySDXL.safetensors"   # required — the filename on the volume
COMFY_WORKFLOW_JSON=""                  # optional — your own graph, see below
COMFY_GRAPH=""                          # optional — "faceid" for the identity graph
COMFY_STEPS="30"
COMFY_CFG="7"                           # 6.5-7.5 follows the prompt; past 8 goes over-baked
COMFY_WIDTH="832"                       # SDXL's own portrait bucket
COMFY_HEIGHT="1216"
COMFY_SAMPLER="dpmpp_2m_sde"
COMFY_SCHEDULER="karras"
COMFY_DENOISE="1"
```

`COMFY_CHECKPOINT` must match the filename exactly as it sits in the worker's
`models/checkpoints` folder. A wrong name fails the job inside ComfyUI, which
surfaces as a failed photo and an automatic refund.

## The workflow is data

Which nodes exist depends entirely on what is installed in your worker image, so
the graph is a template, not code. The built-in one
([`src/lib/comfy.ts`](../src/lib/comfy.ts)) is the smallest graph that runs on
the stock worker: checkpoint → two text encodes → sampler → decode → save.

To use your own, export it from ComfyUI (**Workflow → Export (API)**), replace
the values with placeholders, and paste the whole JSON into
`COMFY_WORKFLOW_JSON`:

| Placeholder                                 | Replaced with                                       |
| ------------------------------------------- | --------------------------------------------------- |
| `{{PROMPT}}`                                | The generated prompt for this request               |
| `{{NEGATIVE}}`                              | The negative prompt (quality + anatomy suppression) |
| `{{SEED}}`                                  | Derived from the prompt (see `COMFY_SEED`)          |
| `{{STEPS}}` `{{CFG}}`                       | `COMFY_STEPS`, `COMFY_CFG`                          |
| `{{WIDTH}}` `{{HEIGHT}}`                    | `COMFY_WIDTH`, `COMFY_HEIGHT`                       |
| `{{SAMPLER}}` `{{SCHEDULER}}` `{{DENOISE}}` | the matching env vars                               |
| `{{CHECKPOINT}}`                            | `COMFY_CHECKPOINT`                                  |
| `{{REFERENCE_IMAGE}}`                       | The filename of her portrait, uploaded with the job |
| `{{IPA_WEIGHT}}` `{{IPA_LORA}}`             | `COMFY_IPA_WEIGHT`, `COMFY_IPA_LORA`                |
| `{{FACEID_PRESET}}` `{{FACE_DENOISE}}`      | `COMFY_FACEID_PRESET`, `COMFY_FACE_DENOISE`         |

A placeholder alone in a field (`"seed": "{{SEED}}"`) becomes a real number,
because ComfyUI type-checks its inputs. A placeholder the app cannot fill fails
the launch and refunds, rather than rendering the literal text.

## Making it look like HER

This is the part that decides whether the feature is usable, and the STOCK graph
does **not** solve it: a checkpoint has never seen your companion, so on its own
it renders a beautiful stranger. Identity is this app's worst failure mode — a
photo of someone else is worse than no photo, and "the body never matches the
character" is this, not a wording problem.

`COMFY_GRAPH="faceid"` switches to the built-in identity graph: IP-Adapter
FaceID for the likeness, then a FaceDetailer pass so the face survives being a
small part of a full-length frame. Her portrait is uploaded with the job
automatically — that happens the moment the graph contains
`{{REFERENCE_IMAGE}}` — so there is nothing else to wire.

It is opt-in, and it is not the default on purpose: every node past the stock
seven has to be installed in the worker image, and a graph naming a class the
worker lacks fails **every** job rather than degrading. Turn it on after the
worker has all of this.

### The short version

```bash
DOCKER_REPO=yourname/hc-comfy-faceid bash scripts/comfy-worker-build.sh
```

Then point the endpoint at the tag it prints, set `HF_TOKEN` on the endpoint,
set `COMFY_GRAPH=faceid` in Vercel, redeploy. That is the whole install: the
image carries the nodes and insightface, and it downloads the model weights onto
the volume on its first boot.

The rest of this section is what that script is doing, for when it goes wrong.

### What goes in the image

Custom nodes and pip packages go in the **image**, not on the volume. A
serverless worker is an ephemeral container: anything installed into a running
one is gone at the next cold start.

**Custom nodes** — three packs, not two:

| Node pack                         | Provides                                          |
| --------------------------------- | ------------------------------------------------- |
| `cubiq/ComfyUI_IPAdapter_plus`    | `IPAdapterUnifiedLoaderFaceID`, `IPAdapterFaceID` |
| `ltdrdata/ComfyUI-Impact-Pack`    | `FaceDetailer`                                    |
| `ltdrdata/ComfyUI-Impact-Subpack` | `UltralyticsDetectorProvider`                     |

The subpack is easy to miss. `UltralyticsDetectorProvider` was split out of the
main Impact Pack, so installing only the pack gives you a `FaceDetailer` with no
detector to feed it and the graph fails validation on node 13.

### What goes on the volume

Model weights: large, unchanging, and what would otherwise make every cold start
unbearable.

There is **no separate provisioning step**.
[`provision-models.sh`](../docker/comfy-worker/provision-models.sh) is baked
into the image and runs at boot, before ComfyUI starts: it downloads anything
missing and does nothing at all once the volume is populated. So the first
render after switching the image is slow — about 4GB — and every one after it is
not.

It is safe against two workers cold-starting at once (an atomic `mkdir` lock,
with a 30-minute staleness timeout so a worker killed mid-download cannot wedge
the endpoint), and it never fails the boot: a worker that starts and logs the
problem is debuggable, one that crash-loops tells you nothing and bills you for
the restarts. Watch for `[provision]` lines in the RunPod log.

To pre-warm the volume instead, run the same script from a Pod with the volume
attached: `VOL=/workspace bash provision-models.sh`.

| File                                             | Path under `models/`  |
| ------------------------------------------------ | --------------------- |
| `ip-adapter-faceid-plusv2_sdxl.bin`              | `ipadapter/`          |
| `ip-adapter-faceid-plusv2_sdxl_lora.safetensors` | `loras/`              |
| `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors`    | `clip_vision/`        |
| `face_yolov8m.pt`                                | `ultralytics/bbox/`   |
| InsightFace `buffalo_l/`                         | `insightface/models/` |

Two things that catch people out:

- **The FaceID repo is gated.** `h94/IP-Adapter-FaceID` needs its licence
  accepted in a browser once, then a read token set as `HF_TOKEN` **on the
  RunPod endpoint** (the worker does the downloading, so the token has to be
  where the worker can see it — not in Vercel). Without it those two downloads
  fail and the graph stops at `IPAdapterUnifiedLoaderFaceID` with "model not
  found". The provisioner logs this explicitly rather than leaving you to guess.
- **`insightface` is a python package as well as model files.** It is in the
  Dockerfile, it has no prebuilt wheel for most Python/CUDA combinations, and it
  needs a C toolchain to build — which the stock worker image does not have.
  `numpy` is pinned under 2 for the same family of reason: insightface 0.7.3
  uses the removed 1.x C API and an unpinned install fails at import with
  "numpy.core.multiarray failed to import".

**Tuning knobs**, all optional:

```
COMFY_GRAPH="faceid"                    # off unless set
COMFY_IPA_WEIGHT="0.75"                 # how hard the render pulls toward her face
COMFY_IPA_LORA="0.6"                    # strength of the FaceID LoRA
COMFY_FACEID_PRESET="FACEID PLUS V2"    # adapter preset
COMFY_FACE_DENOISE="0.5"                # how much of the face the detailer repaints
```

`COMFY_IPA_WEIGHT` is the one to move first. Past about 0.9 the likeness starts
overriding the prompt — the pose and the expression drift back toward the
reference photo. Below about 0.5 it is a suggestion rather than an identity.

`COMFY_FACE_DENOISE` past ~0.7 stops repairing the face and starts inventing a
different one.

### If you would rather build your own

`{{REFERENCE_IMAGE}}` is available to any graph. Wire it into whichever
identity node your image has:

- **IPAdapter FaceID** (`ComfyUI_IPAdapter_plus` + insightface) — what the
  built-in graph uses. Strong likeness, keeps the checkpoint's skin quality.
- **InstantID** — stronger identity lock, a little more "posed" looking.
- **PuLID** — good middle ground on SDXL.
- **ReActor / face swap as a last node** — swaps the face after rendering.
  Cruder, but the most reliable likeness, and it does not fight the pose.

Build it in ComfyUI, confirm it renders there, export it, and put it in
`COMFY_WORKFLOW_JSON`, which wins over `COMFY_GRAPH`.

## Check it before a paying user does

```
RUNPOD_COMFY_ENDPOINT=... npx vite-node --config vitest.config.ts scripts/test-still.ts -- \
  --companion=Aria --prompt="show me your pussy" --out=.stills
```

It renders through the exact production path — same prompt builder, same
negative, same job body, same post-processing — prints the graph it sent, and
saves the picture to `.stills/`. Look at it. The app switches to this endpoint
the moment `RUNPOD_COMFY_ENDPOINT` is set in Vercel, so check first, set second.

## Rolling back

Unset `RUNPOD_COMFY_ENDPOINT` and redeploy. Photos return to the WAN path with
no other change; nothing else in the app knows which renderer produced a
picture.
