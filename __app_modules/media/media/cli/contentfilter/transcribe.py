# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "mlx-whisper; sys_platform == 'darwin' and platform_machine == 'arm64'",
#   "openai-whisper; sys_platform != 'darwin' or platform_machine != 'arm64'",
# ]
# ///
"""
Word-timestamp transcript of a whole media file, for `contentfilter refine`.

  uv run --script transcribe.py <media path or URL> <out.json> [--model NAME]

Audio is decoded with ffmpeg to 16 kHz mono on the media timeline (sample 0 =
media time 0). Uses mlx-whisper on Apple Silicon, openai-whisper elsewhere.

Output: { "model", "backend", "words": [{w, s, e, p, seg}], "segments": [{id, s, e, text}] }
Times are media seconds. The transcript is a candidate source only: the
refiner never takes a word time from it as the answer.
"""
import json, os, platform, subprocess, sys, tempfile, time


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


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__, file=sys.stderr); sys.exit(2)
    src, out = args[0], args[1]
    model = None
    if "--model" in args:
        model = args[args.index("--model") + 1]
    apple = sys.platform == "darwin" and platform.machine() == "arm64"
    t0 = time.time()
    with tempfile.TemporaryDirectory(prefix="cf-transcribe-") as d:
        wav = os.path.join(d, "a.wav")
        decode(src, wav)
        opts = dict(word_timestamps=True, language="en", condition_on_previous_text=False, verbose=False)
        if apple:
            import mlx_whisper
            model = model or "mlx-community/whisper-large-v3-turbo"
            r = mlx_whisper.transcribe(wav, path_or_hf_repo=model, **opts)
            backend = "mlx-whisper"
        else:
            import whisper
            model = model or "small.en"
            r = whisper.load_model(model).transcribe(wav, fp16=False, **opts)
            backend = "openai-whisper"
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
