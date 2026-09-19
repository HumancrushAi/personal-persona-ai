#!/usr/bin/env bash
#
# Build and push the FaceID worker image.
#
#   DOCKER_REPO=yourname/hc-comfy-faceid bash scripts/comfy-worker-build.sh
#
# After this finishes there are exactly two manual steps left, both outside the
# terminal: point the RunPod endpoint at the printed tag, and set the env vars
# in Vercel. Everything else — nodes, insightface, model weights — is handled by
# the image and by its boot-time provisioning.
set -euo pipefail

REPO="${DOCKER_REPO:-}"
if [ -z "$REPO" ]; then
  echo "Set DOCKER_REPO, e.g. DOCKER_REPO=yourname/hc-comfy-faceid" >&2
  exit 1
fi

# A date-and-sha tag rather than :latest. RunPod caches by tag, so pushing a new
# :latest can leave workers on the old layers with no way to tell which image a
# render actually used.
TAG="${TAG:-$(date +%Y%m%d)-$(git rev-parse --short HEAD 2>/dev/null || echo local)}"
IMAGE="$REPO:$TAG"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../docker/comfy-worker" && pwd)"

echo "Building $IMAGE from $DIR"
# linux/amd64 explicitly: an image built on an ARM Mac defaults to arm64 and
# fails on RunPod with "exec format error", which is a confusing way to find out.
docker build --platform linux/amd64 -t "$IMAGE" "$DIR"

echo "Pushing $IMAGE"
docker push "$IMAGE"

cat <<DONE

Done. Two manual steps left.

1. RunPod → Serverless → your endpoint → Settings → Container Image:

     $IMAGE

   Save. Existing workers drain and the next cold start pulls it.

   While you are there, set these on the ENDPOINT (not in Vercel):

     VOL=/runpod-volume     only if your volume mounts somewhere else

   No Hugging Face token is needed: every model file downloads anonymously.
   HF_TOKEN is honoured if set, in case a repo later goes gated.

2. In Vercel:

     COMFY_GRAPH=faceid

   and optionally:

     COMFY_IPA_WEIGHT=0.75        likeness strength; the first dial to move
     COMFY_IPA_LORA=0.6
     COMFY_FACEID_PRESET="FACEID PLUS V2"
     COMFY_FACE_DENOISE=0.5

   Redeploy.

The first render after that is slow — the worker is downloading about 4GB of
weights onto the volume. Watch the RunPod log for lines starting [provision].
Every render after it skips that, because the volume persists.

DONE
