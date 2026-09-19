#!/usr/bin/env bash
#
# Put the FaceID weights on the network volume, if they are not there already.
#
# Runs at worker boot, before ComfyUI starts, so there is no separate
# provisioning step: bring up the endpoint and the first cold start installs
# what it needs. The volume persists, so this is a no-op on every boot after the
# first and costs a few milliseconds.
#
# Can also be run by hand from a Pod with the volume attached:
#   VOL=/workspace bash provision-models.sh
#
# Idempotent, and safe against two workers booting at once.
set -uo pipefail

# Serverless mounts the volume at /runpod-volume; a Pod mounts it at /workspace.
VOL="${VOL:-/runpod-volume}"
MODELS="$VOL/models"

# No volume attached is a configuration mistake, not a reason to fail the boot:
# ComfyUI should still come up so the logs say what is wrong. The graph will
# fail at the loader with a clear "model not found".
if [ ! -d "$VOL" ]; then
  echo "[provision] $VOL does not exist — no network volume attached. Skipping."
  exit 0
fi

# Two workers cold-starting together must not download the same 2GB file into
# the same path. mkdir is atomic on every filesystem RunPod mounts, so it is the
# lock. A stale one from a worker killed mid-download is cleared after 30
# minutes rather than deadlocking the endpoint forever.
LOCK="$MODELS/.provision.lock"
mkdir -p "$MODELS"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    echo "[provision] clearing a stale lock"
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || true
  else
    echo "[provision] another worker is provisioning; waiting up to 10 minutes"
    for _ in $(seq 1 120); do
      [ -d "$LOCK" ] || break
      sleep 5
    done
    echo "[provision] continuing"
    exit 0
  fi
fi
trap 'rm -rf "$LOCK"' EXIT

mkdir -p "$MODELS"/{ipadapter,loras,clip_vision,ultralytics/bbox,insightface/models}

# A model that arrives as a 4KB HTML error page is worse than one that is
# missing: the loader fails with a parse error rather than "not found", and the
# file looks downloaded to anyone checking. So: download to .part, check the
# size, and only then move it into place.
MIN_BYTES=1000000

fetch() {
  local url="$1" dest="$2"
  if [ -s "$dest" ]; then
    echo "[provision] = $(basename "$dest")"
    return 0
  fi
  # HF_TOKEN is optional. All five of these download anonymously — verified
  # against the live URLs — but a token is still passed when one is set, so a
  # repo that later goes gated keeps working without a code change.
  local auth=()
  if [ -n "${HF_TOKEN:-}" ]; then
    auth=(-H "Authorization: Bearer $HF_TOKEN")
  fi
  echo "[provision] + $(basename "$dest")"
  if ! curl -fL --retry 3 --retry-delay 5 "${auth[@]}" -o "$dest.part" "$url"; then
    echo "[provision] ! download failed: $url"
    rm -f "$dest.part"
    return 1
  fi
  local size
  size=$(stat -c%s "$dest.part" 2>/dev/null || echo 0)
  if [ "$size" -lt "$MIN_BYTES" ]; then
    echo "[provision] ! $(basename "$dest") came back $size bytes — that is an error page, discarding"
    rm -f "$dest.part"
    return 1
  fi
  mv "$dest.part" "$dest"
}

FAILED=0

fetch "https://huggingface.co/h94/IP-Adapter-FaceID/resolve/main/ip-adapter-faceid-plusv2_sdxl.bin" \
      "$MODELS/ipadapter/ip-adapter-faceid-plusv2_sdxl.bin" || FAILED=1

fetch "https://huggingface.co/h94/IP-Adapter-FaceID/resolve/main/ip-adapter-faceid-plusv2_sdxl_lora.safetensors" \
      "$MODELS/loras/ip-adapter-faceid-plusv2_sdxl_lora.safetensors" || FAILED=1

# IPAdapter's unified loader looks for this exact filename.
fetch "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors" \
      "$MODELS/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" || FAILED=1

fetch "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt" \
      "$MODELS/ultralytics/bbox/face_yolov8m.pt" || FAILED=1

# InsightFace's own detection and recognition models: a zip of .onnx files that
# unpacks to a buffalo_l/ directory, which is the name the loader looks for.
if [ -d "$MODELS/insightface/models/buffalo_l" ]; then
  echo "[provision] = buffalo_l"
else
  if fetch "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip" \
           "$MODELS/insightface/models/buffalo_l.zip"; then
    unzip -q -o "$MODELS/insightface/models/buffalo_l.zip" \
      -d "$MODELS/insightface/models/buffalo_l" \
      && rm -f "$MODELS/insightface/models/buffalo_l.zip"
  else
    FAILED=1
  fi
fi

echo "[provision] volume now holds:"
find "$MODELS/ipadapter" "$MODELS/loras" "$MODELS/clip_vision" \
     "$MODELS/ultralytics" "$MODELS/insightface" -type f 2>/dev/null \
  | sed "s|$MODELS/|[provision]   models/|" | sort

if [ "$FAILED" -ne 0 ]; then
  echo "[provision] ! some files are missing. COMFY_GRAPH=faceid will fail until they are there."
  echo "[provision] ! check the worker can reach huggingface.co and github.com."
fi

# Never fail the boot. A worker that starts and logs the problem is debuggable;
# one that crash-loops tells you nothing and bills you for the restarts.
exit 0
