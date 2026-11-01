"""
Speech synthesis with Piper: `python synth.py <voice.onnx> <lines.json>`, lines being [{"text": ..., "file": ...}].
The voice is loaded once for all the lines; each WAV file appears only when complete, since these files are a cache.
"""
import json
import os
import sys
import wave

from piper import PiperVoice
from piper.phonemize_espeak import ESPEAK_DATA_DIR

model, lines_file = map(os.path.abspath, sys.argv[1:3])
with open(lines_file, encoding="utf-8") as f:
    lines = json.load(f)

# espeak-ng rejects long absolute paths to its data (a project in a deep folder): a relative one always fits.
os.chdir(ESPEAK_DATA_DIR.parent)
voice = PiperVoice.load(model, espeak_data_dir=ESPEAK_DATA_DIR.name)

for line in lines:
    partial = line["file"] + ".partial"
    with wave.open(partial, "wb") as output:
        voice.synthesize_wav(line["text"], output)
    os.replace(partial, line["file"])
