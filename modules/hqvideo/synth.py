"""
Speech synthesis with OmniVoice: `python synth.py <reference.wav> <reference.txt> <lines.json>`, lines being
[{"text": ..., "file": ...}]. Every line is spoken with the voice of the reference recording (voice cloning), so the
voice is the same in every video and on every computer. The model is loaded once for all the lines; each WAV file
(16-bit mono) appears only when complete, since these files are a cache.

The model is read from the Hugging Face cache given by HF_HOME (vendor/omnivoice/hf), never downloaded here.
"""
import json
import os
import sys
import wave

import numpy as np
import torch
from omnivoice import OmniVoice

RATE = 24000
# Slightly slower than the model's natural pace: an explanation is easier to follow.
SPEED = 0.92

reference, reference_text_file, lines_file = map(os.path.abspath, sys.argv[1:4])
with open(reference_text_file, encoding="utf-8") as f:
    reference_text = f.read().strip()
with open(lines_file, encoding="utf-8") as f:
    lines = json.load(f)

device = "cuda:0" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=device, dtype=torch.float32)


def trim(samples: np.ndarray) -> np.ndarray:
    """Removes the silence before and after the speech, keeping a short tail."""
    loud = np.where(np.abs(samples) > 0.012)[0]
    if len(loud) == 0:
        return samples
    return samples[max(0, loud[0] - int(0.06 * RATE)) : min(len(samples), loud[-1] + int(0.18 * RATE))]


for line in lines:
    # Same seed for every line: a line gives the same speech whenever it is synthesized.
    torch.manual_seed(7)
    audio = model.generate(text=line["text"], ref_audio=reference, ref_text=reference_text, speed=SPEED)
    samples = trim(np.asarray(audio[0], dtype=np.float32))
    partial = line["file"] + ".partial"
    with wave.open(partial, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
    os.replace(partial, line["file"])
    print(f"spoken: {line['text'][:60]}", file=sys.stderr, flush=True)
