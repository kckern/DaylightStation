"""Backend selection for transcribe.py. Run: python3 -I test_transcribe_backend.py"""
import importlib.util, os, sys, types, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("transcribe", os.path.join(HERE, "transcribe.py"))
transcribe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transcribe)

FAKE = types.ModuleType("fake")


class ProbeDuration(unittest.TestCase):
    """The decode is judged against the audio's own end, not the container's (Sonic, 2026-11-22)."""
    def run_with(self, fmt, packets):
        def fake(cmd, **kw):
            out = fmt if "format=duration" in cmd else packets
            return types.SimpleNamespace(stdout=out)
        with mock.patch.object(transcribe.subprocess, "run", side_effect=fake):
            return transcribe.probe_duration("film.mkv")

    def test_audio_that_ends_before_the_picture(self):
        self.assertAlmostEqual(self.run_with("5945.319\n", "5933.376000,0.032000\n5933.408000,0.032000\n"), 5933.44, places=2)

    def test_falls_back_to_the_container_without_audio_packets(self):
        self.assertEqual(self.run_with("100.5\n", ""), 100.5)

    def test_ignores_an_audio_end_past_the_container(self):
        self.assertEqual(self.run_with("100.0\n", "250.0,0.032\n"), 100.0)


class PickBackend(unittest.TestCase):
    def test_mlx_wins_when_importable(self):
        with mock.patch.dict(sys.modules, {"mlx_whisper": FAKE, "faster_whisper": FAKE}):
            self.assertEqual(transcribe.pick_backend(), "mlx-whisper")

    def test_faster_whisper_when_mlx_missing(self):
        with mock.patch.dict(sys.modules, {"mlx_whisper": None, "faster_whisper": FAKE}):
            self.assertEqual(transcribe.pick_backend(), "faster-whisper")

    def test_error_when_neither(self):
        with mock.patch.dict(sys.modules, {"mlx_whisper": None, "faster_whisper": None}):
            with self.assertRaises(RuntimeError):
                transcribe.pick_backend()

    def test_faster_runs_cpu_int8_and_normalises(self):
        W = types.SimpleNamespace
        seg = W(start=0.0, end=1.0, text=" hi there", words=[W(word=" hi", start=0.0, end=0.4, probability=0.9)])
        calls = {}
        class Model:
            def __init__(self, name, **kw): calls["name"], calls["kw"] = name, kw
            def transcribe(self, wav, **kw): return iter([seg]), None
        mod = types.ModuleType("faster_whisper"); mod.WhisperModel = Model
        with mock.patch.dict(sys.modules, {"faster_whisper": mod}):
            r, model = transcribe.run_faster("a.wav", None)
        self.assertEqual(calls["kw"]["device"], "cpu")
        self.assertEqual(calls["kw"]["compute_type"], "int8")
        self.assertEqual(r["segments"][0]["words"][0]["word"], " hi")
        self.assertEqual(r["segments"][0]["id"], 0)

    def test_faster_retries_with_vad_on_alignment_indexerror(self):
        seen = []
        class Model:
            def __init__(self, name, **kw): pass
            def transcribe(self, wav, **kw):
                seen.append(kw.get("vad_filter", False))
                if not kw.get("vad_filter"):
                    def boom():
                        raise IndexError("boolean index did not match")
                        yield
                    return boom(), None
                return iter([]), None
        mod = types.ModuleType("faster_whisper"); mod.WhisperModel = Model
        with mock.patch.dict(sys.modules, {"faster_whisper": mod}):
            r, _ = transcribe.run_faster("a.wav", None)
        self.assertEqual(seen, [False, True])
        self.assertEqual(r["segments"], [])


if __name__ == "__main__":
    unittest.main()
