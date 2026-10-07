# RunPod serverless handler: a companion's voice, spoken by Orpheus TTS.
#
# Input:  {"text": "...", "voice": "tara", "temperature": 0.6}
# Output: {"audio_base64": "<mp3>", "format": "mp3", "seconds": 4.2}
#
# Orpheus is open source (Apache-2.0) and self-hosted, so what a companion is
# allowed to say is decided by the app, not by a TTS provider's content policy.
# Its voices take inline emotion tags — <laugh> <chuckle> <sigh> <cough>
# <sniffle> <groan> <yawn> <gasp> — which is how she sighs or gasps mid-line.

import base64
import os
import re
import subprocess
import tempfile

import numpy as np
import runpod
import soundfile as sf
import torch
from snac import SNAC
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = os.environ.get("ORPHEUS_MODEL", "unsloth/orpheus-3b-0.1-ft")
VOICES = {"tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe"}
SAMPLE_RATE = 24000

# Orpheus' special tokens (from the model card's reference inference code).
START_OF_HUMAN = 128259
END_OF_TEXT = 128009
END_OF_HUMAN = 128260
START_OF_AUDIO = 128257
END_OF_AUDIO = 128258
AUDIO_TOKEN_BASE = 128266

device = "cuda" if torch.cuda.is_available() else "cpu"
tokenizer = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype=torch.bfloat16).to(device).eval()
snac = SNAC.from_pretrained("hubertsiuzdak/snac_24khz").to(device).eval()


def chunks(text: str, limit: int = 220):
    """Sentences grouped up to ~limit chars: one generation covers ~14s of audio."""
    parts = re.split(r"(?<=[.!?…])\s+", text.strip())
    out, cur = [], ""
    for p in parts:
        if cur and len(cur) + len(p) + 1 > limit:
            out.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip()
    if cur:
        out.append(cur)
    return out or [text]


def codes_to_audio(codes):
    n = len(codes) // 7
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    l1, l2, l3 = [], [], []
    for i in range(n):
        c = codes[7 * i : 7 * i + 7]
        l1.append(c[0])
        l2.append(c[1] - 4096)
        l3.append(c[2] - 2 * 4096)
        l3.append(c[3] - 3 * 4096)
        l2.append(c[4] - 4 * 4096)
        l3.append(c[5] - 5 * 4096)
        l3.append(c[6] - 6 * 4096)
    layers = [torch.tensor(l, device=device).clamp(0, 4095).unsqueeze(0) for l in (l1, l2, l3)]
    with torch.inference_mode():
        audio = snac.decode(layers)
    return audio.squeeze().float().cpu().numpy()


def speak(text: str, voice: str, temperature: float):
    prompt = f"{voice}: {text}"
    ids = tokenizer(prompt, return_tensors="pt").input_ids
    ids = torch.cat(
        [torch.tensor([[START_OF_HUMAN]]), ids, torch.tensor([[END_OF_TEXT, END_OF_HUMAN]])], dim=1
    ).to(device)
    with torch.inference_mode():
        out = model.generate(
            ids,
            attention_mask=torch.ones_like(ids),
            max_new_tokens=1400,
            do_sample=True,
            temperature=temperature,
            top_p=0.95,
            repetition_penalty=1.1,
            eos_token_id=END_OF_AUDIO,
        )
    gen = out[0].tolist()
    if START_OF_AUDIO in gen:
        gen = gen[len(gen) - gen[::-1].index(START_OF_AUDIO) :]
    codes = [t - AUDIO_TOKEN_BASE for t in gen if t >= AUDIO_TOKEN_BASE]
    return codes_to_audio(codes)


def handler(job):
    inp = job.get("input") or {}
    text = (inp.get("text") or "").strip()
    if not text:
        return {"error": "text is required"}
    voice = inp.get("voice") if inp.get("voice") in VOICES else "tara"
    temperature = float(inp.get("temperature") or 0.6)

    pieces = [speak(t, voice, temperature) for t in chunks(text)]
    gap = np.zeros(int(SAMPLE_RATE * 0.15), dtype=np.float32)
    audio = np.concatenate([x for p in pieces for x in (p, gap)]) if pieces else gap

    with tempfile.TemporaryDirectory() as d:
        wav, mp3 = os.path.join(d, "v.wav"), os.path.join(d, "v.mp3")
        sf.write(wav, audio, SAMPLE_RATE)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "128k", mp3],
            check=True,
        )
        with open(mp3, "rb") as f:
            data = base64.b64encode(f.read()).decode()
    return {"audio_base64": data, "format": "mp3", "seconds": round(len(audio) / SAMPLE_RATE, 2)}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
