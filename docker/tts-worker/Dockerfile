# The voice worker: Orpheus TTS on RunPod serverless (see handler.py).
#
# The model weights are baked into the image rather than fetched on a cold
# start, so a voice note never waits on a 6GB download and the endpoint needs
# no network volume.
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

ENV PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models \
    PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

RUN pip install \
      "transformers==4.46.3" \
      "accelerate==1.1.1" \
      "snac==1.2.1" \
      "soundfile==0.12.1" \
      "runpod==1.7.7" \
      "numpy<2"

ARG ORPHEUS_MODEL=unsloth/orpheus-3b-0.1-ft
ENV ORPHEUS_MODEL=${ORPHEUS_MODEL}
RUN python -c "from huggingface_hub import snapshot_download as d; d('${ORPHEUS_MODEL}'); d('hubertsiuzdak/snac_24khz')"

COPY handler.py /handler.py

# The handler must at least import and find its weights offline — the same
# check the worker's cold start makes, without a GPU.
RUN HF_HUB_OFFLINE=1 python -c "from transformers import AutoTokenizer; AutoTokenizer.from_pretrained('${ORPHEUS_MODEL}'); import snac, soundfile, runpod; print('ok')"

CMD ["python", "-u", "/handler.py"]
