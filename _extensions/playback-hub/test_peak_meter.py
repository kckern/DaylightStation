"""
unittest suite for peak_meter.py.

Runs against a fake `popen_factory` so no real `pw-cat` process is ever
spawned. Real `pw-cat` integration is exercised only on the hub host.
"""
import os
import struct
import tempfile
import unittest
import wave
from unittest import mock

import peak_meter


def _write_wav(path, samples_s16, rate=44100):
    """Write a mono s16 WAV of the given int samples (what pw-cat produces)."""
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", s) for s in samples_s16))


class _FakeProc:
    """Minimal stand-in for subprocess.Popen — terminate/wait/poll only."""
    def __init__(self, returncode=0):
        self.returncode = returncode
        self.terminated = False

    def terminate(self):
        self.terminated = True

    def wait(self, timeout=None):
        return self.returncode

    def poll(self):
        return self.returncode


class SamplePeakDbfsTests(unittest.TestCase):
    """sample_peak_dbfs with an injected wav_peak_reader (no real pw-cat/WAV)."""

    def _sample(self, reader):
        proc = _FakeProc()
        return peak_meter.sample_peak_dbfs(
            "bluez_output.AA_BB.1",
            duration_sec=0.01,
            popen_factory=lambda *_a, **_kw: proc,
            sleep_factory=lambda _s: None,
            wav_peak_reader=reader,
        ), proc

    def test_full_scale_returns_zero_dbfs(self):
        result, proc = self._sample(lambda _p: 1.0)  # 20*log10(1.0) = 0 dB
        self.assertAlmostEqual(result, 0.0, places=3)
        self.assertTrue(proc.terminated)

    def test_half_amplitude_returns_minus_six_dbfs(self):
        result, _ = self._sample(lambda _p: 0.5)  # 20*log10(0.5) ≈ -6.0206 dB
        self.assertAlmostEqual(result, -6.0206, places=3)

    def test_no_samples_returns_none(self):
        result, _ = self._sample(lambda _p: None)
        self.assertIsNone(result)

    def test_silent_below_floor_clamps_to_floor(self):
        result, _ = self._sample(lambda _p: 0.00001)  # ≈ -100 dBFS → -90
        self.assertAlmostEqual(result, -90.0, places=3)


class SamplePeakDbfsEdgeCasesTests(unittest.TestCase):
    def test_empty_sink_name_returns_none_without_spawning(self):
        called = {"n": 0}
        def factory(*_a, **_kw):
            called["n"] += 1
            return _FakeProc()
        result = peak_meter.sample_peak_dbfs(
            "", duration_sec=0.01, popen_factory=factory,
            sleep_factory=lambda _s: None,
        )
        self.assertIsNone(result)
        self.assertEqual(called["n"], 0)

    def test_popen_filenotfound_returns_none(self):
        def factory(*_a, **_kw):
            raise FileNotFoundError("pw-cat not on PATH")
        result = peak_meter.sample_peak_dbfs(
            "bluez_output.AA_BB.1", duration_sec=0.01, popen_factory=factory,
            sleep_factory=lambda _s: None,
        )
        self.assertIsNone(result)


class WavPeakAmplitudeTests(unittest.TestCase):
    """The pure WAV parser — the real integration surface (pw-cat writes WAV)."""

    def _peak_of(self, samples):
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            _write_wav(path, samples)
            return peak_meter._wav_peak_amplitude(path)
        finally:
            os.unlink(path)

    def test_full_scale_s16(self):
        # -32768 is full negative scale → |peak|/32768 == 1.0
        self.assertAlmostEqual(self._peak_of([0, -32768, 100]), 1.0, places=4)

    def test_half_scale_s16(self):
        self.assertAlmostEqual(self._peak_of([0, 16384, -8192]), 0.5, places=4)

    def test_empty_frames_returns_none(self):
        self.assertIsNone(self._peak_of([]))

    def test_missing_file_returns_none(self):
        self.assertIsNone(peak_meter._wav_peak_amplitude("/nonexistent/x.wav"))

    def test_real_roundtrip_through_sample_peak_dbfs(self):
        # End-to-end with a real temp WAV: half-scale → ≈ -6 dBFS.
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        _write_wav(path, [16384, -16384, 0])
        try:
            result = peak_meter.sample_peak_dbfs(
                "bluez_output.AA_BB.1",
                duration_sec=0.0,
                popen_factory=lambda *_a, **_kw: _FakeProc(),
                sleep_factory=lambda _s: None,
                wav_peak_reader=lambda _p: peak_meter._wav_peak_amplitude(path),
            )
            self.assertAlmostEqual(result, -6.0206, places=3)
        finally:
            os.unlink(path)


class VerifyRouteTests(unittest.TestCase):
    """Drives Handler._verify_audio directly with a fake request.

    web.py uses stdlib http.server, so we can't trivially spin up a real
    server here — but the method's contract is small enough to test by
    instantiating the class without going through BaseHTTPRequestHandler
    setup. We monkeypatch the bits the method touches.
    """
    def _make_handler(self):
        import web  # noqa: WPS433 — local import keeps module load lazy
        h = web.Handler.__new__(web.Handler)
        h._json_calls = []
        def fake_json(data, status=200):
            h._json_calls.append({"data": data, "status": status})
        h._json = fake_json
        return h, web

    def test_verify_bt_disconnected_returns_null_peak_without_sampling(self):
        h, web = self._make_handler()
        device = {
            "color": "white", "mac": "9C:0C:35:75:B7:75", "slot": 5,
            "name": "10-SYNC", "class": "public",
        }
        with mock.patch.object(web, "read_devices", return_value=[device]), \
             mock.patch.object(web, "is_connected", return_value=False), \
             mock.patch("peak_meter.sample_peak_dbfs") as sampler:
            h._verify_audio("white")
            sampler.assert_not_called()

        self.assertEqual(len(h._json_calls), 1)
        body = h._json_calls[0]["data"]
        self.assertEqual(h._json_calls[0]["status"], 200)
        self.assertEqual(body["color"], "white")
        self.assertEqual(body["sink"], "bluez_output.9C_0C_35_75_B7_75.1")
        self.assertIsNone(body["peak_dbfs"])
        self.assertFalse(body["audio_flowing"])
        self.assertFalse(body["bt_connected"])
        self.assertEqual(body["sampled_ms"], 0)

    def test_verify_unknown_color_returns_404(self):
        h, web = self._make_handler()
        with mock.patch.object(web, "read_devices", return_value=[
            {"color": "red", "mac": "AA:BB", "slot": 1, "name": "x", "class": "private"}
        ]):
            h._verify_audio("orange")
        self.assertEqual(h._json_calls[0]["status"], 404)
        self.assertFalse(h._json_calls[0]["data"]["ok"])

    def test_verify_bt_connected_samples_and_returns_audio_flowing_true(self):
        h, web = self._make_handler()
        device = {
            "color": "white", "mac": "9C:0C:35:75:B7:75", "slot": 5,
            "name": "10-SYNC", "class": "public",
        }
        with mock.patch.object(web, "read_devices", return_value=[device]), \
             mock.patch.object(web, "is_connected", return_value=True), \
             mock.patch("peak_meter.sample_peak_dbfs", return_value=-3.2) as sampler:
            h._verify_audio("white")
        sampler.assert_called_once_with(
            "bluez_output.9C_0C_35_75_B7_75.1",
            duration_sec=0.5,
        )
        body = h._json_calls[0]["data"]
        self.assertEqual(body["peak_dbfs"], -3.2)
        self.assertTrue(body["audio_flowing"])
        self.assertEqual(body["sampled_ms"], 500)
        self.assertTrue(body["bt_connected"])

    def test_verify_bt_connected_below_threshold_returns_audio_flowing_false(self):
        h, web = self._make_handler()
        device = {
            "color": "white", "mac": "9C:0C:35:75:B7:75", "slot": 5,
            "name": "10-SYNC", "class": "public",
        }
        with mock.patch.object(web, "read_devices", return_value=[device]), \
             mock.patch.object(web, "is_connected", return_value=True), \
             mock.patch("peak_meter.sample_peak_dbfs", return_value=-72.0):
            h._verify_audio("white")
        body = h._json_calls[0]["data"]
        self.assertFalse(body["audio_flowing"])
        self.assertEqual(body["peak_dbfs"], -72.0)

    def test_verify_bt_connected_sample_returns_none_means_audio_flowing_false(self):
        h, web = self._make_handler()
        device = {
            "color": "red", "mac": "41:42:3A:E5:43:07", "slot": 1,
            "name": "musiCozy", "class": "private",
        }
        with mock.patch.object(web, "read_devices", return_value=[device]), \
             mock.patch.object(web, "is_connected", return_value=True), \
             mock.patch("peak_meter.sample_peak_dbfs", return_value=None):
            h._verify_audio("red")
        body = h._json_calls[0]["data"]
        self.assertIsNone(body["peak_dbfs"])
        self.assertFalse(body["audio_flowing"])


if __name__ == "__main__":
    unittest.main()
