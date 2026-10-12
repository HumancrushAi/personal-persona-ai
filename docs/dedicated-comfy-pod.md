# The dedicated photo pod

A chat photo is one job on a RunPod **Serverless** endpoint. When no worker is
warm, RunPod has to find a free GPU of a type the endpoint allows, boot the
worker image and load the 6.5GB checkpoint — and when that GPU type is out of
stock in the datacenter, the job waits in the queue. That is the fifteen-minute
stall, and under load it hits every user at once.

The permanent fix is a **dedicated pod**: one always-warm GPU running the very
same worker image, serving the very same job API. The app sends every photo
there first; the serverless endpoint takes the overflow when the pod is busy
and the fallback when it is down. No cold start, no queue for a GPU, and
serverless still scales out behind it.

## 1. Deploy the pod

RunPod → **Pods → Deploy**.

| Setting | Value |
|---|---|
| GPU | RTX 4090 (24GB). An A5000 or L4 works; slower. Pick a datacenter that lists your **network volume** |
| Template | **Custom** — Container image: the same image the `hc-comfy-image` endpoint uses (`ghcr.io/<owner>/hc-comfy-worker:latest`; it is on the endpoint's Manage → Edit page) |
| Container disk | 20 GB |
| Network volume | the one with `/models/checkpoints/lustifySDXLNSFWSFW_v20.safetensors` — attach it at **`/runpod-volume`** (the mount path field), not `/workspace` |
| Expose HTTP ports | `8000` (the job API). `8188` too if you want ComfyUI's own UI |
| Environment variables | `SERVE_API_LOCALLY=true` (starts ComfyUI on 8188 alongside the worker; the app talks to ComfyUI's own API, not to the test server on 8000) |
| Start command | leave the image's default |

If the volume can only be mounted at `/workspace` on your account, set the
container start command to:

```
bash -c "ln -sfn /workspace /runpod-volume; exec /entrypoint.sh"
```

Wait for the pod to show **Running** and the logs to say ComfyUI is up (the
first boot links the FaceID models from the volume; about a minute).

## 2. Find the URL

Pod → **Connect** → the HTTP port 8188 link, which looks like:

```
https://<podid>-8188.proxy.runpod.net
```

Check it answers: open `https://<podid>-8188.proxy.runpod.net/system_stats` in a
browser — ComfyUI's own status page.

## 3. Point the app at it

In Vercel (production):

```
COMFY_POD_URL=https://<podid>-8188.proxy.runpod.net
COMFY_POD_CONCURRENCY=2      # open jobs on the pod before new ones overflow to serverless
```

and redeploy. From then on:

- a photo goes to the pod when it is up and has fewer than two jobs open;
- it goes to serverless when the pod is busy, or does not answer `/health`
  within 2.5 seconds, or refuses the job;
- a job that went to the pod is stored as `pod:<id>` and polled on the pod;
- retakes, worker-error retries and requeues choose the same way.

Set `COMFY_POD_URL` empty to go back to serverless only. No deploy of code is
needed for either change.

## What it costs and what it handles

A warm 4090 renders a chat photo in roughly 15–25 seconds, including the face
pass — three to four photos a minute, around the clock, at the pod's hourly
rate (about $0.35–0.45/h on community cloud). Everything above that rate of
requests spills to serverless, which still needs the endpoint set up with
several GPU types and more than one datacenter so the overflow can start.

## Security note

The proxy URL carries no login. Anyone with the exact URL could submit jobs to
the pod. The URL is only in Vercel's environment; if it ever leaks, **Stop →
Start** the pod gives it a new id, then update `COMFY_POD_URL`.

## Keeping it healthy

- **Stop the pod** when the site is idle for days; **Start** it again before
  traffic (the URL changes — update the env var).
- The checkpoint and every model live on the volume, so a pod can be thrown
  away and redeployed in minutes without losing anything.
- If renders on the pod fail while serverless ones succeed, the pod's image is
  out of date: redeploy it from the current image.
