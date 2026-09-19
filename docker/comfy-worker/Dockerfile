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
FROM runpod/worker-comfyui:5.1.0-base

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

# Three node packs, not two.
#
# UltralyticsDetectorProvider — the face detector FaceDetailer takes its bbox
# from — lives in Impact SUBPACK. It was split out of the main Impact Pack, so
# installing only ComfyUI-Impact-Pack gives you FaceDetailer and no detector to
# feed it, and the graph fails validation on node 13.
RUN comfy-node-install \
  comfyui_ipadapter_plus \
  comfyui-impact-pack \
  comfyui-impact-subpack

# onnxruntime-gpu because insightface runs its detection models through ONNX.
# numpy is pinned under 2: insightface 0.7.3 and several Impact Pack
# dependencies still use the removed numpy 1.x C API, and an unpinned install
# resolves to numpy 2 and fails at import with "numpy.core.multiarray failed to
# import" — which reads like a broken install rather than a version conflict.
RUN pip install --no-cache-dir \
      "numpy<2" \
      insightface==0.7.3 \
      onnxruntime-gpu \
  && python -c "import insightface; print('insightface', insightface.__version__)"

COPY provision-models.sh /provision-models.sh
COPY entrypoint.sh /hc-entrypoint.sh
RUN chmod +x /provision-models.sh /hc-entrypoint.sh

ENTRYPOINT ["/hc-entrypoint.sh"]
