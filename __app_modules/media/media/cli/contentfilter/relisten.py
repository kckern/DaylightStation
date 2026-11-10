# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "mlx-whisper; sys_platform == 'darwin' and platform_machine == 'arm64'",
#   "openai-whisper; sys_platform != 'darwin' or platform_machine != 'arm64'",
# ]
# ///
"""
Re-listen to short windows around tagged words the full-film transcript missed
(used by `contentfilter pin`, where a person has marked where the word is).

  uv run --script relisten.py < request.json > reply.json

request: { "src": path or URL, "items": [ { "id", "prompt", "windows": [[t0, dur], ...] } ] }
reply:   { "items": [ { "id", "windows": [ { "t0", "words": [ {w, s, e, p} ] } ] } ] }

Each window is transcribed with the expected word as the initial prompt. Word
times are media seconds. The caller decides which hits to trust: prompting can
make the model invent the word, so it compares windows that start at different
times.
"""
import json, os, platform, subprocess, sys, tempfile

APPLE = sys.platform == "darwin" and platform.machine() == "arm64"


def clip(src, t0, dur, wav):
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{max(0, t0):.3f}", "-t", f"{dur:.3f}", "-i", src,
                    "-map", "0:a:0", "-ac", "1", "-ar", "16000", wav], check=True)


def transcribe(wav, prompt):
    opts = dict(word_timestamps=True, language="en", condition_on_previous_text=False, verbose=False,
                initial_prompt=prompt.capitalize() + ".")
    if APPLE:
        import mlx_whisper
        return mlx_whisper.transcribe(wav, path_or_hf_repo="mlx-community/whisper-large-v3-turbo", **opts)
    import whisper
    global _model
    try:
        _model
    except NameError:
        _model = whisper.load_model("small.en")
    return _model.transcribe(wav, fp16=False, **opts)


def main():
    req = json.load(sys.stdin)
    out = []
    with tempfile.TemporaryDirectory(prefix="cf-relisten-") as d:
        wav = os.path.join(d, "a.wav")
        for item in req["items"]:
            wins = []
            for t0, dur in item["windows"]:
                t0 = max(0.0, t0)
                clip(req["src"], t0, dur, wav)
                r = transcribe(wav, item["prompt"])
                words = [{"w": w["word"].strip(), "s": round(t0 + w["start"], 3), "e": round(t0 + w["end"], 3),
                          "p": round(w.get("probability", 0), 3)} for s in r["segments"] for w in s.get("words", [])]
                wins.append({"t0": round(t0, 3), "words": words})
            out.append({"id": item["id"], "windows": wins})
            print(f"relisten {item['id']}", file=sys.stderr, flush=True)
    json.dump({"items": out}, sys.stdout)


if __name__ == "__main__":
    main()
