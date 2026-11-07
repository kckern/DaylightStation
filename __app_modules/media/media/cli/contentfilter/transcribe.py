# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "mlx-whisper; sys_platform == 'darwin' and platform_machine == 'arm64'",
#   "faster-whisper; sys_platform != 'darwin' or platform_machine != 'arm64'",
# ]
# ///
"""
Word-timestamp transcript of a whole media file, for `contentfilter refine`.

  uv run --script transcribe.py <media path or URL> <out.json> [--model NAME]

Audio is decoded with ffmpeg to 16 kHz mono on the media timeline (sample 0 =
media time 0). Uses mlx-whisper when it can be imported (Apple Silicon), otherwise
faster-whisper on CPU (int8); the choice is automatic and recorded as `backend`.

Output: { "model", "backend", "words": [{w, s, e, p, seg}], "segments": [{id, s, e, text}] }
Times are media seconds. The transcript is a candidate source only: the
refiner never takes a word time from it as the answer.
"""
import json, os, subprocess, sys, tempfile, time


RECONNECT = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1",
             "-reconnect_delay_max", "10", "-rw_timeout", "30000000"]


def probe_duration(src):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                         capture_output=True, text=True, check=True).stdout.strip()
    return float(out)


def decode(src, wav, attempts=4):
    """Decode the audio; HTTP reads can end early, so check the length and retry a short decode."""
    want = probe_duration(src)
    net = RECONNECT if src.startswith("http") else []
    for attempt in range(attempts):
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *net, "-i", src, "-map", "0:a:0", "-ac", "1",
                        "-ar", "16000", "-c:a", "pcm_s16le", wav], check=False)
        got = (os.path.getsize(wav) - 44) / 32000 if os.path.exists(wav) else 0
        if got >= want - 2:
            return
        print(f"decode short: {got:.0f} of {want:.0f} s (attempt {attempt + 1})", file=sys.stderr)
        time.sleep(2 ** attempt)
    raise RuntimeError(f"audio decode stayed short of {want:.0f} s; not writing a truncated transcript")


def pick_backend():
    """mlx-whisper when importable, else faster-whisper. Raises if neither is installed."""
    try:
        import mlx_whisper  # noqa: F401
        return "mlx-whisper"
    except ImportError:
        pass
    try:
        import faster_whisper  # noqa: F401
        return "faster-whisper"
    except ImportError:
        raise RuntimeError("no transcription backend: install mlx-whisper (Apple Silicon) or faster-whisper")


def run_mlx(wav, model):
    import mlx_whisper
    model = model or "mlx-community/whisper-large-v3-turbo"
    r = mlx_whisper.transcribe(wav, path_or_hf_repo=model, word_timestamps=True, language="en",
                               condition_on_previous_text=False, verbose=False)
    return r, model


def run_faster(wav, model):
    """CPU, int8. Returns the same shape mlx-whisper does: {"segments": [{id,start,end,text,words}]}."""
    from faster_whisper import WhisperModel
    model = model or "small.en"
    m = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)
    def collect(**extra):
        segs, _info = m.transcribe(wav, language="en", word_timestamps=True, condition_on_previous_text=False, **extra)
        out = []
        for i, s in enumerate(segs):
            out.append({"id": i, "start": s.start, "end": s.end, "text": s.text,
                        "words": [{"word": w.word, "start": w.start, "end": w.end, "probability": w.probability}
                                  for w in (s.words or [])]})
        return out
    try:
        out = collect()
    except IndexError:
        # faster-whisper's word aligner can fail on a segment with no usable tokens (music, silence).
        # Retrying with the voice-activity filter skips those stretches; times stay on the media timeline.
        print("faster-whisper word alignment failed; retrying with vad_filter", file=sys.stderr)
        out = collect(vad_filter=True)
    return {"segments": out}, model


TRANSCRIBERS = {"mlx-whisper": run_mlx, "faster-whisper": run_faster}


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__, file=sys.stderr); sys.exit(2)
    src, out = args[0], args[1]
    model = None
    if "--model" in args:
        model = args[args.index("--model") + 1]
    t0 = time.time()
    with tempfile.TemporaryDirectory(prefix="cf-transcribe-") as d:
        wav = os.path.join(d, "a.wav")
        decode(src, wav)
        backend = pick_backend()
        r, model = TRANSCRIBERS[backend](wav, model)
    words, segs = [], []
    for s in r["segments"]:
        segs.append({"id": s["id"], "s": round(s["start"], 3), "e": round(s["end"], 3), "text": s["text"].strip()})
        for w in s.get("words", []):
            words.append({"w": w["word"].strip(), "s": round(w["start"], 3), "e": round(w["end"], 3),
                          "p": round(w.get("probability", 0), 3), "seg": s["id"]})
    with open(out, "w") as f:
        json.dump({"model": model, "backend": backend, "words": words, "segments": segs}, f)
    print(json.dumps({"words": len(words), "segments": len(segs), "seconds": round(time.time() - t0)}), file=sys.stderr)


if __name__ == "__main__":
    main()
