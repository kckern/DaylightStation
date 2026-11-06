# /// script
# requires-python = ">=3.10"
# dependencies = ["torch>=2.4", "torchaudio>=2.4", "numpy"]
# ///
"""
Forced alignment of known words, for `contentfilter refine`.

  uv run --script align_words.py < job.json > result.json

Job: { "src": "<media path or URL>",
       "items": [ { "id": "va1", "t0": 912.1, "t1": 914.0, "words": ["oh", "my", "god"], "target": 2 }, ... ] }
For each item, decodes [t0, t1) to 16 kHz mono, aligns the words with the MMS
character model (torchaudio MMS_FA) and reports the target word's span in
media seconds:  [ { "id", "start", "end", "score" } | { "id", "error" } ]

An acoustic alignment, not a language model: it places given text on the
audio. Its spans are candidates the decision model checks.
"""
import json, re, subprocess, sys

import numpy as np
import torch
from torchaudio.pipelines import MMS_FA as BUNDLE

SR = BUNDLE.sample_rate


def decode(src, t0, t1):
    out = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{t0:.6f}", "-t", f"{t1 - t0:.6f}", "-i", src,
                          "-map", "0:a:0", "-ac", "1", "-ar", str(SR), "-f", "f32le", "pipe:1"],
                         check=True, capture_output=True).stdout
    return torch.from_numpy(np.frombuffer(out, dtype=np.float32).copy()).unsqueeze(0)


def norm(w):
    return re.sub(r"[^a-z]", "", w.lower())


def main():
    job = json.load(sys.stdin)
    model = BUNDLE.get_model()
    tok = BUNDLE.get_tokenizer()
    aligner = BUNDLE.get_aligner()
    results = []
    for it in job["items"]:
        try:
            words = [norm(w) for w in it["words"]]
            keep = [(i, w) for i, w in enumerate(words) if w]
            if not any(i == it["target"] for i, _ in keep):
                raise ValueError("target word has no letters")
            clip = decode(job["src"], it["t0"], it["t1"])
            with torch.inference_mode():
                em, _ = model(clip)
                spans = aligner(em[0], tok([w for _, w in keep]))
            ratio = clip.size(1) / em.size(1) / SR
            for (i, _), sp in zip(keep, spans):
                if i == it["target"]:
                    score = float(sum(s.score * len(s) for s in sp) / max(1, sum(len(s) for s in sp)))
                    results.append({"id": it["id"], "start": round(it["t0"] + sp[0].start * ratio, 3),
                                    "end": round(it["t0"] + sp[-1].end * ratio, 3), "score": round(score, 3)})
        except Exception as e:  # one bad item must not sink the batch
            results.append({"id": it["id"], "error": str(e)[:200]})
    json.dump(results, sys.stdout)


if __name__ == "__main__":
    main()
