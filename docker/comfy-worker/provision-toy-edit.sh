#!/usr/bin/env bash
#
# Put Qwen Image Edit on the network volume, for the chest-toy edit pass
# (comfy.ts withToyEdit): it reads a toy's catalogue photo and puts that exact
# toy into the render, which SDXL could not do from words.
#
# About 31GB, so unlike provision-models.sh this runs in the background: the
# worker boots and serves at once, and the files appear when they are done.
# The pod has no web terminal, so boot is the only place this can run.
#
# Downloads resume (.part + curl -C -), so a worker killed mid-download leaves
# progress for the next one rather than starting over.
set -uo pipefail

VOL="${VOL:-/runpod-volume}"
MODELS="$VOL/models"
[ -d "$VOL" ] || { echo "[toy-edit] no volume at $VOL — skipping"; exit 0; }

# Its own lock, and a long one: 31GB outlives provision-models.sh's 30 minutes.
LOCK="$MODELS/.toy-edit.lock"
mkdir -p "$MODELS"/{unet,clip,vae,loras}
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +180 2>/dev/null)" ]; then
    rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || exit 0
  else
    echo "[toy-edit] another worker is downloading; leaving it to that one"
    exit 0
  fi
fi
trap 'rm -rf "$LOCK"' EXIT

fetch() {
  local url="$1" dest="$2"
  if [ -s "$dest" ]; then echo "[toy-edit] = $(basename "$dest")"; return 0; fi
  echo "[toy-edit] + $(basename "$dest")"
  local auth=()
  [ -n "${HF_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $HF_TOKEN")
  if ! curl -fsSL --retry 5 --retry-delay 10 -C - "${auth[@]}" -o "$dest.part" "$url"; then
    echo "[toy-edit] ! download failed (progress kept): $url"
    return 1
  fi
  if [ "$(stat -c%s "$dest.part" 2>/dev/null || echo 0)" -lt 1000000 ]; then
    echo "[toy-edit] ! $(basename "$dest") is an error page, discarding"
    rm -f "$dest.part"; return 1
  fi
  mv "$dest.part" "$dest"
  echo "[toy-edit] ✓ $(basename "$dest")"
}

# Small files first, so a half-finished run still leaves the cheap parts.
fetch "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors" \
      "$MODELS/vae/qwen_image_vae.safetensors"
fetch "https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" \
      "$MODELS/loras/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"
fetch "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors" \
      "$MODELS/clip/qwen_2.5_vl_7b_fp8_scaled.safetensors"
fetch "https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors" \
      "$MODELS/unet/qwen_image_edit_2511_fp8mixed.safetensors"
echo "[toy-edit] done"
exit 0
