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
import json, os, re, subprocess, sys, tempfile, time

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

        # HTTP range reads on the Plex part are intermittently truncated
        # ("partial file"); retry a few times before giving up on a window.
        def extract():
            subprocess.run(
                ["ffmpeg", "-nostdin", "-loglevel", "error",
                 "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
                 "-rw_timeout", "30000000",
                 "-ss", str(wstart), "-i", part, "-t", str(window * 2),
                 "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-y", wav],
                check=True,
            )
            if os.path.getsize(wav) < 2000:  # ~empty wav -> treat as failure
                raise RuntimeError("empty extraction")

        err = None
        for attempt in range(4):
            try:
                extract()
                r = model.transcribe(wav, word_timestamps=True, language="en", fp16=False, verbose=False)
                err = None
                break
            except Exception as e:  # noqa: BLE001
                err = str(e)[:120]
                time.sleep(0.6 * (attempt + 1))
        if err is not None:
            out.append({"id": s["id"], "edl": sec, "snapped": None, "error": err})
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
        # word start AND end from the AUDIO (Whisper) — the authoritative boundary.
        # (SRT end is unreliable: it marks caption-clear, not speech-end.)
        out.append({"id": s["id"], "edl": sec,
                    "snapped": round(wstart + h["start"], 3),
                    "end": round(wstart + h["end"], 3)})

    print(json.dumps(out))

if __name__ == "__main__":
    main()
