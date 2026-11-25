# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "panns_inference",
#   "torch",
#   "numpy",
# ]
# ///
"""
Per-second AudioSet scores for a concert video, for `concert-index classify`.

  uv run --script audio-events.py <media> <out.json>

Audio is decoded with ffmpeg to 32 kHz mono on the media timeline, then run
through PANNs' frame-level sound event detection model (100 frames per second)
in 60 s chunks. Each class's score is averaged per second. Output:

  {"seconds": N, "classes": {"Music": [..N floats..], "Speech": [...], ...}}

A trailing piece shorter than one second is dropped. The model checkpoint is
downloaded by panns_inference on first use.
"""
import json
import subprocess
import sys

import numpy as np
from panns_inference import SoundEventDetection, labels

SR = 32000
FPS = 100
CHUNK_S = 60
CLASSES = [
    "Music", "Speech", "Singing", "Choir", "Bell", "Church bell", "Jingle bell",
    "Orchestra", "Applause", "Clapping", "Cheering", "Silence",
]


def decode(media):
    """The whole soundtrack as float32 mono at SR, samples in [-1, 1)."""
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", media, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0


def main(argv):
    if len(argv) != 3:
        sys.exit("usage: audio-events.py <media> <out.json>")
    media, out = argv[1], argv[2]
    audio = decode(media)
    idx = [labels.index(name) for name in CLASSES]
    sed = SoundEventDetection(checkpoint_path=None, device="cpu")
    scores = {name: [] for name in CLASSES}
    chunk = SR * CHUNK_S
    for i in range(0, len(audio), chunk):
        seg = audio[i:i + chunk]
        secs = len(seg) // SR
        if secs < 1:
            break
        frames = sed.inference(seg[None, :])[0]  # (frames at FPS, 527 classes)
        for s in range(secs):
            window = frames[s * FPS:(s + 1) * FPS]
            for name, k in zip(CLASSES, idx):
                scores[name].append(float(window[:, k].mean()))
        print(f"{(i + len(seg)) // SR}s", file=sys.stderr, flush=True)
    seconds = len(scores[CLASSES[0]])
    with open(out, "w") as f:
        json.dump({"seconds": seconds, "classes": scores}, f)


if __name__ == "__main__":
    main(sys.argv)
