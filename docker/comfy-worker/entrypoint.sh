#!/usr/bin/env bash
#
# Provision the volume, then hand over to the stock worker entrypoint.
#
# Wrapping rather than replacing: the base image's start script sets up the
# ComfyUI server and the RunPod handler, and reimplementing that here would mean
# re-doing it on every base image bump. This only adds a step in front.
set -uo pipefail

bash /provision-models.sh || echo "[entrypoint] provisioning reported a problem; starting anyway"

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
      # Empty placeholders from node installs (Impact makes ultralytics/bbox and
      # ultralytics/segm) are cleared; a folder with real files is kept.
      find "$dest" -depth -type d -empty -delete 2>/dev/null || true
      if [ -d "$dest" ]; then echo "[entrypoint] $dest has files, leaving it"; continue; fi
    fi
    ln -sfn "$src" "$dest" && echo "[entrypoint] $dest -> $src"
  done
fi

# The base image has changed the name of this over releases, so try the known
# ones in order rather than pinning one and breaking on the next bump.
for candidate in /start.sh /entrypoint.sh /usr/local/bin/start.sh; do
  if [ -x "$candidate" ]; then
    echo "[entrypoint] handing over to $candidate"
    exec "$candidate" "$@"
  fi
done

echo "[entrypoint] no start script found in the base image — check its release notes" >&2
exit 1
