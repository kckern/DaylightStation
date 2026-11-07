"""Backend selection for transcribe.py. Run: python3 -I test_transcribe_backend.py"""
import importlib.util, os, sys, types, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("transcribe", os.path.join(HERE, "transcribe.py"))
transcribe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transcribe)

FAKE = types.ModuleType("fake")


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
