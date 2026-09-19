#!/usr/bin/env bash
#
# Put the FaceID model weights on the RunPod network volume.
#
# Run this ONCE, from a temporary RunPod **Pod** (not the serverless endpoint)
# with the same network volume attached. A serverless worker cannot be used for
# this: it is ephemeral, and it only starts when a job arrives.
#
#   1. RunPod → Pods → Deploy, any cheap GPU or CPU pod
#   2. Attach the SAME network volume the endpoint uses
#   3. Web Terminal, then:
#        curl -fsSL <raw url of this file> -o setup.sh && bash setup.sh
#      or paste it in.
#
# Safe to re-run: every download is skipped if the file is already there.
set -euo pipefail

# Where the volume is mounted. A Pod mounts it at /workspace; a serverless
# worker sees the same volume at /runpod-volume. This script runs on the Pod.
VOL="${VOL:-/workspace}"
MODELS="$VOL/models"

echo "Installing FaceID weights into $MODELS"
mkdir -p "$MODELS"/{ipadapter,loras,clip_vision,ultralytics/bbox,insightface/models}

get() {
  local url="$1" dest="$2"
  if [ -s "$dest" ]; then
    echo "  = $(basename "$dest") already present, skipping"
    return
  fi
  echo "  + $(basename "$dest")"
  # -L follows HF's redirect to its CDN; --fail turns an HTML error page into a
  # non-zero exit instead of a file that looks downloaded and is not a model.
  curl -fL --retry 3 -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

# The IP-Adapter FaceID repo is GATED on Hugging Face: open the model page once
# in a browser, accept the licence, then create a read token and export it as
# HF_TOKEN before running this. Without it these two 404 and the graph fails at
# IPAdapterUnifiedLoaderFaceID with "model not found".
AUTH=()
if [ -n "${HF_TOKEN:-}" ]; then
  AUTH=(-H "Authorization: Bearer $HF_TOKEN")
  echo "  (using HF_TOKEN)"
else
  echo "  ! HF_TOKEN is unset — the two FaceID files below are gated and will fail"
fi

curl_auth() {
  local url="$1" dest="$2"
  if [ -s "$dest" ]; then echo "  = $(basename "$dest") already present, skipping"; return; fi
  echo "  + $(basename "$dest")"
  curl -fL --retry 3 "${AUTH[@]}" -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

curl_auth \
  "https://huggingface.co/h94/IP-Adapter-FaceID/resolve/main/ip-adapter-faceid-plusv2_sdxl.bin" \
  "$MODELS/ipadapter/ip-adapter-faceid-plusv2_sdxl.bin"

curl_auth \
  "https://huggingface.co/h94/IP-Adapter-FaceID/resolve/main/ip-adapter-faceid-plusv2_sdxl_lora.safetensors" \
  "$MODELS/loras/ip-adapter-faceid-plusv2_sdxl_lora.safetensors"

# The image encoder. IPAdapter's unified loader looks for this exact filename.
get \
  "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors" \
  "$MODELS/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"

# The face detector FaceDetailer crops with.
get \
  "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt" \
  "$MODELS/ultralytics/bbox/face_yolov8m.pt"

# InsightFace's own detection + recognition models. This is a zip of .onnx
# files, and it unpacks to a buffalo_l/ directory, which is what the loader
# expects to find.
if [ -d "$MODELS/insightface/models/buffalo_l" ]; then
  echo "  = buffalo_l already present, skipping"
else
  echo "  + buffalo_l"
  get "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip" \
    "$MODELS/insightface/models/buffalo_l.zip"
  ( cd "$MODELS/insightface/models" && unzip -q -o buffalo_l.zip -d buffalo_l && rm buffalo_l.zip )
fi

echo
echo "Done. What is on the volume now:"
find "$MODELS/ipadapter" "$MODELS/loras" "$MODELS/clip_vision" \
     "$MODELS/ultralytics" "$MODELS/insightface" -type f \
  | sed "s|$MODELS/|  models/|" | sort

echo
echo "Any file under ~1MB above is an error page, not a model — delete it and re-run."
