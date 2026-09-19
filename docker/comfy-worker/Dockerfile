# The worker image for COMFY_GRAPH=faceid.
#
# Custom nodes and pip packages go HERE rather than on the network volume,
# because a RunPod serverless worker is an ephemeral container: anything
# installed into a running worker is gone at the next cold start. The volume is
# for model weights, which are large, rarely change, and are what would
# otherwise make cold starts unbearable. See scripts/setup-comfy-volume.sh.
#
# Pin the base tag rather than tracking latest. A worker image that changes
# under you is a render that changes under you, and this app has spent a long
# time making renders reproducible.
FROM runpod/worker-comfyui:5.1.0-base

USER root

# insightface has no prebuilt wheel for most Python/CUDA combinations, so pip
# compiles it. Without a toolchain the build fails with a wall of C errors that
# reads like a missing package rather than a missing compiler.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake git wget \
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

# onnxruntime-gpu because insightface runs its detection models through ONNX;
# the CPU build works and costs a second or two per render.
RUN pip install --no-cache-dir \
  insightface==0.7.3 \
  onnxruntime-gpu

# Impact Pack runs a one-time install script on first import. Doing it at build
# time means the first real render is not also the first install.
RUN python -c "import insightface; print('insightface', insightface.__version__)"
