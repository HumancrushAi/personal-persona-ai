# The worker image for COMFY_GRAPH=faceid.
#
# Custom nodes and pip packages go HERE rather than on the network volume,
# because a RunPod serverless worker is an ephemeral container: anything
# installed into a running worker is gone at the next cold start. The volume is
# for model weights, which are large, rarely change, and are what would
# otherwise make cold starts unbearable — and those are fetched at boot by
# provision-models.sh, so there is no separate provisioning step to remember.
#
# Pin the base tag rather than tracking latest. A worker image that changes
# under you is a render that changes under you, and this app has spent a long
# time making renders reproducible.
FROM runpod/worker-comfyui:5.10.0-base

USER root

# insightface has no prebuilt wheel for most Python/CUDA combinations, so pip
# compiles it. Without a toolchain the build fails with a wall of C errors that
# reads like a missing package rather than a missing compiler.
#
# unzip and curl are for provision-models.sh; the base image has neither
# guaranteed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       build-essential cmake git wget curl unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# One RUN, because it has to find things first and shell variables do not
# survive between layers.
#
# It used to call `comfy-node-install` and a bare `pip`. Both were assumptions
# about a base image this repo does not build: the helper is a convenience
# script whose node IDs come from a registry, and `pip` is whichever Python is
# first on PATH, which on an image that runs ComfyUI inside a virtualenv is the
# wrong one — packages land somewhere ComfyUI never looks and the graph fails at
# import with nothing in the build log to explain it.
#
# So: locate ComfyUI and its interpreter, say which ones were found, and clone
# the nodes from source at a pinned depth. Failing loudly with a directory
# listing beats failing silently with a working image that cannot import.
RUN set -eux; \
    COMFY_DIR=""; \
    for d in /comfyui/ComfyUI /comfyui /opt/ComfyUI /ComfyUI /workspace/ComfyUI; do \
      if [ -d "$d/custom_nodes" ]; then COMFY_DIR="$d"; break; fi; \
    done; \
    if [ -z "$COMFY_DIR" ]; then \
      echo "FATAL: no ComfyUI custom_nodes directory found in this base image." >&2; \
      ls -la / /comfyui 2>/dev/null || true; \
      exit 1; \
    fi; \
    PY=""; \
    for p in /comfyui/.venv/bin/python /opt/venv/bin/python /usr/local/bin/python3 /usr/bin/python3; do \
      if [ -x "$p" ]; then PY="$p"; break; fi; \
    done; \
    if [ -z "$PY" ]; then echo "FATAL: no python interpreter found." >&2; exit 1; fi; \
    echo "using COMFY_DIR=$COMFY_DIR"; \
    echo "using PY=$PY"; \
    "$PY" -m pip install --no-cache-dir --upgrade pip; \
    for repo in \
        cubiq/ComfyUI_IPAdapter_plus \
        ltdrdata/ComfyUI-Impact-Pack \
        ltdrdata/ComfyUI-Impact-Subpack; do \
      name="${repo#*/}"; \
      git clone --depth 1 "https://github.com/$repo.git" "$COMFY_DIR/custom_nodes/$name"; \
      if [ -f "$COMFY_DIR/custom_nodes/$name/requirements.txt" ]; then \
        "$PY" -m pip install --no-cache-dir -r "$COMFY_DIR/custom_nodes/$name/requirements.txt"; \
      fi; \
    done; \
    "$PY" -m pip install --no-cache-dir "numpy<2" insightface==0.7.3 onnxruntime-gpu; \
    "$PY" -c "import insightface; print('insightface', insightface.__version__)"; \
    "$PY" -c "import numpy; print('numpy', numpy.__version__)"; \
    ls -1 "$COMFY_DIR/custom_nodes"

# Three node packs, not two.
#
# UltralyticsDetectorProvider — the face detector FaceDetailer takes its bbox
# from — lives in Impact SUBPACK. It was split out of the main Impact Pack, so
# installing only ComfyUI-Impact-Pack gives you FaceDetailer and no detector to
# feed it, and the graph fails validation on node 13.
#
# numpy is pinned under 2 above: insightface 0.7.3 and several Impact Pack
# dependencies still use the removed numpy 1.x C API, and an unpinned install
# resolves to numpy 2 and fails at import with "numpy.core.multiarray failed to
# import" — which reads like a broken install rather than a version conflict.
# It is installed AFTER the node requirements so that a pack pulling numpy 2 in
# as a transitive dependency does not win.

COPY provision-models.sh /provision-models.sh
COPY entrypoint.sh /hc-entrypoint.sh
RUN chmod +x /provision-models.sh /hc-entrypoint.sh

ENTRYPOINT ["/hc-entrypoint.sh"]
