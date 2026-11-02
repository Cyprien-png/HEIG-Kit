"""
Speech synthesis with Kokoro: `python synth.py <model.onnx> <voices.bin> <lines.json>`, lines being
[{"text": ..., "file": ...}]. The model is loaded once for all the lines; each WAV file (16-bit mono) appears only when
complete, since these files are a cache.
"""
import json
import os
import sys
import wave

import espeakng_loader
import numpy as np

model, voices, lines_file = map(os.path.abspath, sys.argv[1:4])
with open(lines_file, encoding="utf-8") as f:
    lines = json.load(f)

# espeak-ng rejects long absolute paths to its data (a project in a deep folder): a relative one always fits.
data = espeakng_loader.get_data_path()
os.chdir(os.path.dirname(data))
os.environ["ESPEAK_DATA_PATH"] = os.path.basename(data)

from kokoro_onnx import Kokoro  # noqa: E402

kokoro = Kokoro(model, voices)

for line in lines:
    samples, rate = kokoro.create(line["text"], voice="ff_siwis", speed=1.0, lang="fr-fr")
    partial = line["file"] + ".partial"
    with wave.open(partial, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
    os.replace(partial, line["file"])
