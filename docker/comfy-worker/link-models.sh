#!/usr/bin/env bash
#
# Shared by entrypoint.sh (every cold start) and the Dockerfile (build-time check),
# so the build tests exactly what the worker does at runtime.
set -uo pipefail

# Point ComfyUI at the FaceID models on the volume.
#
# provision-models.sh downloads them to $VOL/models, but the base image's
# extra_model_paths only maps the stock folders (checkpoints, loras,
# clip_vision...). ipadapter and ultralytics are not in it, and IPAdapter_plus
# reads insightface from <ComfyUI>/models/insightface and nowhere else — so
# without these links the graph fails with "model not found" on a worker whose
# volume has every file it needs.
VOL="${VOL:-/runpod-volume}"
if [ -f /etc/hc-build.env ] && [ -d "$VOL/models" ]; then
  . /etc/hc-build.env
  for d in ipadapter insightface ultralytics; do
    src="$VOL/models/$d"
    dest="$COMFY_DIR/models/$d"
    [ -d "$src" ] || continue
    if [ -d "$dest" ] && [ ! -L "$dest" ]; then
      # Every folder the image had is recreated on the volume first. Impact
      # Subpack registers ultralytics/bbox AND ultralytics/segm at load; the
      # volume only had bbox, so linking over the image's placeholders left
      # segm missing and the pack failed to load — every faceid render then
      # died on "Node 'UltralyticsDetectorProvider' not found".
      (cd "$dest" && find . -mindepth 1 -type d) | while read -r sub; do
        mkdir -p "$src/$sub"
      done
      # Empty placeholders from node installs are cleared; a folder with real
      # files is kept.
      find "$dest" -depth -type d -empty -delete 2>/dev/null || true
      if [ -d "$dest" ]; then echo "[link-models] $dest has files, leaving it"; continue; fi
    fi
    ln -sfn "$src" "$dest" && echo "[link-models] $dest -> $src"
  done
fi
