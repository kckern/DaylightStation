"""
unittest suite for peak_meter.py.

Runs against a fake `popen_factory` so no real `pw-cat` process is ever
spawned. Real `pw-cat` integration is exercised only on the hub host.
"""
import io
import struct
import unittest
from unittest import mock

import peak_meter


def _f32_bytes(samples):
    """Pack a list of floats into raw f32 little-endian bytes (pw-cat format)."""
    return b"".join(struct.pack("<f", s) for s in samples)


class _FakeProc:
    """Minimal stand-in for subprocess.Popen — exposes stdout, terminate, wait."""
    def __init__(self, payload_bytes, returncode=0):
        self.stdout = io.BytesIO(payload_bytes)
        self.returncode = returncode
        self.terminated = False

    def terminate(self):
        self.terminated = True

    def wait(self, timeout=None):
        return self.returncode

    def poll(self):
        return self.returncode


class SamplePeakDbfsTests(unittest.TestCase):
    def test_full_scale_sample_returns_zero_dbfs(self):
        # Single full-scale (+1.0) sample → peak = 1.0 → 20*log10(1.0) = 0 dB
        payload = _f32_bytes([1.0])
        proc = _FakeProc(payload)
        result = peak_meter.sample_peak_dbfs(
            "bluez_output.AA_BB.1",
            duration_sec=0.01,
            popen_factory=lambda *_a, **_kw: proc,
            now_factory=iter([0.0, 0.02]).__next__,
        )
        self.assertAlmostEqual(result, 0.0, places=3)
        self.assertTrue(proc.terminated)

    def test_half_amplitude_returns_minus_six_dbfs(self):
        proc = _FakeProc(_f32_bytes([0.5, -0.25, 0.1]))
        result = peak_meter.sample_peak_dbfs(
            "bluez_output.AA_BB.1",
            duration_sec=0.01,
            popen_factory=lambda *_a, **_kw: proc,
            now_factory=iter([0.0, 0.02]).__next__,
        )
        # Peak |amp| = 0.5  →  20 * log10(0.5) ≈ -6.0206 dB
        self.assertAlmostEqual(result, -6.0206, places=3)


class SamplePeakDbfsEdgeCasesTests(unittest.TestCase):
    def test_no_samples_returns_none(self):
        proc = _FakeProc(b"")
        result = peak_meter.sample_peak_dbfs(
            "bluez_output.AA_BB.1",
            duration_sec=0.01,
            popen_factory=lambda *_a, **_kw: proc,
            now_factory=iter([0.0, 0.02]).__next__,
        )
        self.assertIsNone(result)

    def test_empty_sink_name_returns_none_without_spawning(self):
        called = {"n": 0}
        def factory(*_a, **_kw):
            called["n"] += 1
            return _FakeProc(b"")
        result = peak_meter.sample_peak_dbfs(
            "",
            duration_sec=0.01,
            popen_factory=factory,
            now_factory=iter([0.0, 0.02]).__next__,
        )
        self.assertIsNone(result)
        self.assertEqual(called["n"], 0)

    def test_popen_filenotfound_returns_none(self):
        def factory(*_a, **_kw):
            raise FileNotFoundError("pw-cat not on PATH")
        result = peak_meter.sample_peak_dbfs(
            "bluez_output.AA_BB.1",
            duration_sec=0.01,
            popen_factory=factory,
            now_factory=iter([0.0, 0.02]).__next__,
        )
        self.assertIsNone(result)

    def test_silent_samples_below_floor_return_floor_value(self):
        # 0.00001 ≈ -100 dBFS → clamped to -90.
        proc = _FakeProc(_f32_bytes([0.00001, -0.00001]))
        result = peak_meter.sample_peak_dbfs(
            "bluez_output.AA_BB.1",
            duration_sec=0.01,
            popen_factory=lambda *_a, **_kw: proc,
            now_factory=iter([0.0, 0.02]).__next__,
        )
        self.assertAlmostEqual(result, -90.0, places=3)


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


if __name__ == "__main__":
    unittest.main()
