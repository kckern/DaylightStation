#!/opt/homebrew/opt/python@3.11/bin/python3.11
"""
Whisper aligner for `contentfilter calibrate --method whisper`.

Reads a job from stdin:
  { "partUrl": "...", "window": 6, "model": "small.en",
    "samples": [ { "id": "va123", "sec": 168, "stems": ["fuck","fucking"] }, ... ] }

For each sample, extracts a +/-window audio window from partUrl (ffmpeg over HTTP),
runs Whisper word-timestamps, and finds the nearest word matching a stem.

Writes JSON to stdout: [ { "id", "edl": <sec>, "snapped": <abs sec|null> } ]
"""
import json, os, re, subprocess, sys, tempfile

def norm(w):
    return re.sub(r"[^a-z]", "", w.lower())

def matches(word, stems):
    n = norm(word)
    return any(n.startswith(s) or s in n for s in stems)

def main():
    job = json.load(sys.stdin)
    part = job["partUrl"]
    window = float(job.get("window", 6))
    model_name = job.get("model", "small.en")
    samples = job["samples"]

    import whisper
    model = whisper.load_model(model_name)
    workdir = tempfile.mkdtemp(prefix="cf-align-")
    out = []

    for s in samples:
        sec = float(s["sec"])
        stems = s["stems"]
        wstart = max(0, sec - window)
        wav = os.path.join(workdir, f"{s['id']}.wav")
        try:
            subprocess.run(
                ["ffmpeg", "-nostdin", "-loglevel", "error",
                 "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2",
                 "-ss", str(wstart), "-i", part, "-t", str(window * 2),
                 "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-y", wav],
                check=True,
            )
            r = model.transcribe(wav, word_timestamps=True, language="en", fp16=False, verbose=False)
        except Exception as e:  # noqa: BLE001
            out.append({"id": s["id"], "edl": sec, "snapped": None, "error": str(e)[:120]})
            continue

        words = []
        for seg in r.get("segments", []):
            for w in seg.get("words", []):
                words.append(w)
        hits = [w for w in words if matches(w["word"], stems)]
        if not hits:
            out.append({"id": s["id"], "edl": sec, "snapped": None})
            continue
        center = window
        h = min(hits, key=lambda w: abs(((w["start"] + w["end"]) / 2) - center))
        out.append({"id": s["id"], "edl": sec, "snapped": round(wstart + h["start"], 3)})

    print(json.dumps(out))

if __name__ == "__main__":
    main()
