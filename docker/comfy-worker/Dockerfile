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

# pip exits 2 rather than installing into an externally managed interpreter
# (PEP 668). Inside a virtualenv this is ignored, so it is safe either way.
ENV PIP_BREAK_SYSTEM_PACKAGES=1

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

# Discover where ComfyUI and its interpreter actually are, once, and record it.
#
# Everything after this sources /etc/hc-build.env rather than guessing again.
# Confirmed from a build log rather than assumed: COMFY_DIR=/comfyui,
# PY=/comfyui/.venv/bin/python, and that venv already carries pip 24.0.
RUN set -eux; \
    COMFY_DIR=""; \
    for d in /comfyui/ComfyUI /comfyui /opt/ComfyUI /ComfyUI /workspace/ComfyUI; do \
      if [ -d "$d/custom_nodes" ]; then COMFY_DIR="$d"; break; fi; \
    done; \
    if [ -z "$COMFY_DIR" ]; then \
      echo "FATAL: no ComfyUI custom_nodes directory found." >&2; \
      ls -la / /comfyui 2>/dev/null || true; \
      exit 1; \
    fi; \
    PY=""; \
    for p in /comfyui/.venv/bin/python /opt/venv/bin/python /usr/local/bin/python3 /usr/bin/python3; do \
      if [ -x "$p" ]; then PY="$p"; break; fi; \
    done; \
    if [ -z "$PY" ]; then echo "FATAL: no python interpreter found." >&2; exit 1; fi; \
    if ! "$PY" -m pip --version; then \
      "$PY" -m ensurepip --upgrade || { \
        curl -fsSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py; \
        "$PY" /tmp/get-pip.py; \
      }; \
    fi; \
    printf 'COMFY_DIR=%s\nPY=%s\n' "$COMFY_DIR" "$PY" > /etc/hc-build.env; \
    cat /etc/hc-build.env; \
    "$PY" -m pip --version

# setuptools and wheel are here because of --no-build-isolation below: that flag
# tells pip to build against THIS environment, so whatever the build needs has
# to already be in it. numpy and cython for the same reason — insightface's
# setup.py imports both at build time.
RUN . /etc/hc-build.env \
 && set -eux \
 && "$PY" -m pip install --no-cache-dir --upgrade setuptools wheel \
 && "$PY" -m pip install --no-cache-dir "numpy<2" cython onnxruntime-gpu

COPY install-node.sh /hc-install-node.sh
RUN chmod +x /hc-install-node.sh

# One pack per layer, so a failure names the pack in the annotation instead of
# quoting sixty lines of shell that mention all three.
RUN /hc-install-node.sh cubiq/ComfyUI_IPAdapter_plus
RUN /hc-install-node.sh ltdrdata/ComfyUI-Impact-Pack
RUN /hc-install-node.sh ltdrdata/ComfyUI-Impact-Subpack

# insightface has no wheel for this Python and CUDA pair, so pip compiles it.
# Build isolation would hand that compile a clean environment without the numpy
# and cython its setup.py imports, so the build runs against the environment
# prepared above instead.
RUN . /etc/hc-build.env \
 && set -eux \
 && "$PY" -m pip install --no-cache-dir --no-build-isolation insightface==0.7.3

# numpy is reasserted last. Several node packs list a bare `numpy` and resolve
# it to 2.x, and insightface 0.7.3 uses the removed 1.x C API — it then fails at
# import with "numpy.core.multiarray failed to import", which reads like a
# broken install rather than a version conflict.
RUN . /etc/hc-build.env \
 && set -eux \
 && "$PY" -m pip install --no-cache-dir "numpy<2" \
 && "$PY" -c "import insightface; print('insightface', insightface.__version__)" \
 && "$PY" -c "import numpy; print('numpy', numpy.__version__)" \
 && "$PY" -c "import onnxruntime; print('onnxruntime', onnxruntime.__version__)" \
 && ls -1 "$COMFY_DIR/custom_nodes"

# Three node packs, not two. UltralyticsDetectorProvider — the face detector
# FaceDetailer takes its bbox from — lives in Impact SUBPACK. It was split out of
# the main Impact Pack, so installing only ComfyUI-Impact-Pack gives you a
# FaceDetailer with no detector to feed it, and the graph fails validation on
# node 13.

COPY provision-models.sh /provision-models.sh
COPY entrypoint.sh /hc-entrypoint.sh
RUN chmod +x /provision-models.sh /hc-entrypoint.sh

ENTRYPOINT ["/hc-entrypoint.sh"]
