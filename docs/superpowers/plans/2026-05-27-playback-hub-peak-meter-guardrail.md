# Playback-Hub Peak-Meter Guardrail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `peak-meter audio-flowing` guardrail so the Admin UI can distinguish "playback truly audible at the speaker" from "claimed playing but speaker silent" (the silent-mpv-after-BT-start failure mode).

**Architecture:** A new `GET /api/verify/<color>` endpoint on the playback-hub samples PipeWire's monitor port for the device's BT sink (via `pw-cat` for 500 ms) and returns a `peak_dbfs` reading + `audio_flowing` boolean. The DaylightStation backend exposes this as `GET /api/v1/playback-hub/verify/:color` via a thin `VerifyAudioFlowing` use case wired through the existing gateway port. The Admin UI's `TransportRow` schedules a verify call 5 s after a successful `Play Now` and surfaces the result as a Mantine toast.

**Tech Stack:** Python 3 (`pw-cat`, `subprocess`, stdlib `struct`/`math`); Node.js (Express, vitest, `node:http` test servers); React + Mantine (`@mantine/notifications`); existing logging framework (`getLogger()` on JS side, `logging.getLogger` on Python).

---

## File Structure

**Hub side (`_extensions/playback-hub/`):**
- Create `peak_meter.py` — pure helper that spawns `pw-cat`, parses f32 samples, returns dBFS.
- Create `test_peak_meter.py` — stdlib `unittest` tests (avoids the missing-`pytest` dependency; existing hub tests in `tests/playback-hub/test_validate_config_parity.py` use raw `assert` + subprocess and can be run with either runner — we use `unittest` because it ships with stdlib and matches the hub's "no external deps" style).
- Modify `web.py` — add `GET /api/verify/<color>` route + dispatch in `do_GET`.

**Backend (`backend/src/`):**
- Modify `3_applications/playback-hub/ports/IPlaybackHubGateway.mjs` — add `verifyAudio(color)` to the abstract contract.
- Modify `3_applications/playback-hub/test/FakeHubGateway.mjs` — add `verifyAudio` implementation with `setNextVerifyResult` / `setVerifyError` / `verifyCalls` recording.
- Modify `1_adapters/playback-hub/HttpPlaybackHubAdapter.mjs` — implement `verifyAudio(color)`.
- Create `3_applications/playback-hub/usecases/VerifyAudioFlowing.mjs` — thin use case wrapper.
- Modify `3_applications/playback-hub/PlaybackHubContainer.mjs` — wire `verifyAudioFlowing`.
- Modify `4_api/v1/routers/playbackHub.mjs` — add `router.get('/verify/:color', ...)`.

**Backend tests (`tests/`):**
- Create `tests/applications/playback-hub/VerifyAudioFlowing.test.mjs` — use-case unit tests.
- Modify `tests/adapters/playback-hub/HttpPlaybackHubAdapter.test.mjs` — append `describe('verifyAudio', ...)`.
- Modify `tests/api/v1/routers/playbackHub.test.mjs` — append `describe('GET /verify/:color', ...)`.
- Modify `tests/applications/playback-hub/PlaybackHubContainer.test.mjs` — append a getter test for `verifyAudioFlowing`.

**Frontend (`frontend/src/modules/Admin/PlaybackHub/`):**
- Modify `hooks/useHubMutations.js` — add `verifyAudio(color)` mutation.
- Modify `hooks/useHubMutations.test.jsx` — append `describe('verifyAudio', ...)`.
- Modify `components/TransportRow.jsx` — schedule post-Play verify + Mantine notifications.
- Modify `components/TransportRow.test.jsx` — assert post-Play verify timer + notification behavior.

**Tunable constant:** Frontend `POST_PLAY_VERIFY_DELAY_MS = 5000` defined in `TransportRow.jsx`. Documented inline as "tunable; cold-start BT may need longer."

---

## Decisions (open questions, locked in)

1. **Threshold `peak_dbfs > -60` for `audio_flowing`** — no other audio-detection threshold exists in the codebase (no prior `pw-cat`/peak code). −60 dBFS sits well above SBC A2DP self-noise (~−72 dBFS measured floor) yet catches even very quiet program material. Constant lives in `peak_meter.py` as `AUDIO_FLOWING_THRESHOLD_DBFS = -60.0`.
2. **Sample window 500 ms** — kept. Defined as `DEFAULT_SAMPLE_SEC = 0.5` in `peak_meter.py`.
3. **Post-Play delay 5 s** — kept. Defined as the tunable constant `POST_PLAY_VERIFY_DELAY_MS = 5000` in `TransportRow.jsx` with an inline comment naming cold-start BT as the variable that may push this longer.

---

## Task 1: Python — `sample_peak_dbfs` happy path + threshold constant

**Files:**
- Create: `_extensions/playback-hub/peak_meter.py`
- Create: `_extensions/playback-hub/test_peak_meter.py`

- [ ] **Step 1: Write the failing test** — `_extensions/playback-hub/test_peak_meter.py`

```python
"""
unittest suite for peak_meter.py.

Runs against a fake `popen_factory` so no real `pw-cat` process is ever
spawned. Real `pw-cat` integration is exercised only on the hub host.
"""
import io
import struct
import unittest

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


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/Code/DaylightStation/_extensions/playback-hub && python3 -m unittest test_peak_meter.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'peak_meter'`

- [ ] **Step 3: Write minimal implementation** — `_extensions/playback-hub/peak_meter.py`

```python
"""
peak_meter.py — sample PipeWire monitor stream and return peak amplitude
in dBFS. Pure helper used by web.py's /api/verify/<color> route.

Spawns `pw-cat --record --target <sink>:monitor_FL --format=f32 --raw
--rate 44100 --channels 1 -` and reads raw float32 samples from stdout
for `duration_sec`. Computes max(abs(samples)) and converts to dBFS
clamped to [-90, 0].

Test-seam parameters `popen_factory` and `now_factory` are injected by
unit tests so we never spawn real subprocesses. In production, defaults
are used (subprocess.Popen + time.monotonic).
"""
import logging
import math
import struct
import subprocess
import time
from typing import Callable, Optional

logger = logging.getLogger(__name__)

DEFAULT_SAMPLE_SEC = 0.5
AUDIO_FLOWING_THRESHOLD_DBFS = -60.0
DBFS_FLOOR = -90.0
DBFS_CEIL = 0.0
SAMPLE_BYTES = 4  # float32 little-endian


def _to_dbfs(peak: float) -> float:
    if peak <= 0.0:
        return DBFS_FLOOR
    dbfs = 20.0 * math.log10(peak)
    if dbfs < DBFS_FLOOR:
        return DBFS_FLOOR
    if dbfs > DBFS_CEIL:
        return DBFS_CEIL
    return dbfs


def sample_peak_dbfs(
    sink_name: str,
    duration_sec: float = DEFAULT_SAMPLE_SEC,
    popen_factory: Callable = subprocess.Popen,
    now_factory: Callable[[], float] = time.monotonic,
) -> Optional[float]:
    """
    Spawn pw-cat to record from `<sink_name>:monitor_FL` for `duration_sec`,
    return peak amplitude in dBFS or None on failure/no samples.
    """
    if not sink_name:
        return None
    target = f"{sink_name}:monitor_FL"
    cmd = [
        "pw-cat", "--record",
        "--target", target,
        "--format=f32",
        "--raw",
        "--rate", "44100",
        "--channels", "1",
        "-",
    ]
    try:
        proc = popen_factory(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except (FileNotFoundError, OSError) as err:
        logger.warning("peak_meter.popen_failed sink=%s err=%s", sink_name, err)
        return None

    deadline = now_factory() + duration_sec
    peak = 0.0
    try:
        while now_factory() < deadline:
            chunk = proc.stdout.read(SAMPLE_BYTES)
            if not chunk or len(chunk) < SAMPLE_BYTES:
                break
            (sample,) = struct.unpack("<f", chunk)
            amp = abs(sample)
            if amp > peak:
                peak = amp
    finally:
        try:
            proc.terminate()
        except Exception:
            pass
        try:
            proc.wait(timeout=1)
        except Exception:
            pass

    if peak == 0.0:
        return None
    return _to_dbfs(peak)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/Code/DaylightStation/_extensions/playback-hub && python3 -m unittest test_peak_meter.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add _extensions/playback-hub/peak_meter.py _extensions/playback-hub/test_peak_meter.py
git commit -m "feat(playback-hub): add sample_peak_dbfs helper for monitor-port amplitude sampling"
```

---

## Task 2: Python — `sample_peak_dbfs` returns None on no samples + popen failure

**Files:**
- Modify: `_extensions/playback-hub/test_peak_meter.py`

- [ ] **Step 1: Append failing tests** — at the end of `_extensions/playback-hub/test_peak_meter.py`, just before the `if __name__ == "__main__":` line:

```python
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
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd /opt/Code/DaylightStation/_extensions/playback-hub && python3 -m unittest test_peak_meter.py -v`
Expected: PASS for 4 new tests as well, because the implementation already covers None and the floor — IF instead of PASS you see FAIL, **stop and re-read peak_meter.py** to verify the implementation matches the contract (this task is intentionally green-on-first-run because Task 1's implementation was designed to cover these edges).

- [ ] **Step 3: Commit**

```bash
git add _extensions/playback-hub/test_peak_meter.py
git commit -m "test(playback-hub): cover sample_peak_dbfs edge cases (no samples, popen fail, floor clamp)"
```

---

## Task 3: Python — `/api/verify/<color>` route, BT-disconnected branch

**Files:**
- Modify: `_extensions/playback-hub/web.py`

- [ ] **Step 1: Write the failing test** — append a new test class to `_extensions/playback-hub/test_peak_meter.py`:

```python
import json
from unittest import mock


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/Code/DaylightStation/_extensions/playback-hub && python3 -m unittest test_peak_meter.py -v`
Expected: FAIL — `AttributeError: 'Handler' object has no attribute '_verify_audio'`

- [ ] **Step 3: Add `_verify_audio` to `web.py`** — inside the `Handler` class in `_extensions/playback-hub/web.py`, add this method below `_post_play` (around line 1418):

```python
    def _verify_audio(self, color):
        """GET /api/verify/<color> — peak-meter guardrail.

        Looks up the device by color, builds the BT sink name
        (`bluez_output.<MAC underscored>.1`), and samples its monitor port
        for 500 ms via peak_meter.sample_peak_dbfs. Returns peak_dbfs +
        audio_flowing so the Admin UI can distinguish "mpv claims playing"
        from "speaker actually receiving samples."

        Short-circuits with audio_flowing=false when BT is not connected
        — there is no sink to sample.
        """
        from peak_meter import (
            sample_peak_dbfs,
            DEFAULT_SAMPLE_SEC,
            AUDIO_FLOWING_THRESHOLD_DBFS,
        )

        device = next((d for d in read_devices() if d.get("color") == color), None)
        if device is None:
            return self._json({"ok": False, "error": f"unknown color: {color}"}, 404)

        mac = device.get("mac", "")
        mac_underscored = mac.replace(":", "_")
        sink = f"bluez_output.{mac_underscored}.1"
        connected = is_connected(mac)

        if not connected:
            return self._json({
                "color": color,
                "sink": sink,
                "peak_dbfs": None,
                "audio_flowing": False,
                "sampled_ms": 0,
                "bt_connected": False,
            })

        peak_dbfs = sample_peak_dbfs(sink, duration_sec=DEFAULT_SAMPLE_SEC)
        audio_flowing = (
            peak_dbfs is not None
            and peak_dbfs > AUDIO_FLOWING_THRESHOLD_DBFS
        )
        return self._json({
            "color": color,
            "sink": sink,
            "peak_dbfs": peak_dbfs,
            "audio_flowing": audio_flowing,
            "sampled_ms": int(DEFAULT_SAMPLE_SEC * 1000),
            "bt_connected": True,
        })
```

- [ ] **Step 4: Add the route dispatch** — in `_extensions/playback-hub/web.py`, inside `do_GET` (around line 1052), append before `self.send_error(404)`:

```python
        if path.startswith("/api/verify/"):
            color = path[len("/api/verify/"):]
            return self._verify_audio(color)
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd /opt/Code/DaylightStation/_extensions/playback-hub && python3 -m unittest test_peak_meter.py -v`
Expected: PASS — all tests (6 from earlier + 2 new = 8 total).

- [ ] **Step 6: Commit**

```bash
git add _extensions/playback-hub/web.py _extensions/playback-hub/test_peak_meter.py
git commit -m "feat(playback-hub): add GET /api/verify/<color> peak-meter route"
```

---

## Task 4: Python — `/api/verify/<color>` samples when BT connected

**Files:**
- Modify: `_extensions/playback-hub/test_peak_meter.py`

- [ ] **Step 1: Write the failing test** — append to the `VerifyRouteTests` class in `_extensions/playback-hub/test_peak_meter.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify pass**

Run: `cd /opt/Code/DaylightStation/_extensions/playback-hub && python3 -m unittest test_peak_meter.py -v`
Expected: PASS (11 tests total). If FAIL, re-read Task 3's `_verify_audio` implementation.

- [ ] **Step 3: Commit**

```bash
git add _extensions/playback-hub/test_peak_meter.py
git commit -m "test(playback-hub): cover /api/verify sampling + threshold cases"
```

---

## Task 5: Backend port — `IPlaybackHubGateway.verifyAudio` abstract method

**Files:**
- Modify: `backend/src/3_applications/playback-hub/ports/IPlaybackHubGateway.mjs`
- Create: `tests/applications/playback-hub/IPlaybackHubGateway.test.mjs`

- [ ] **Step 1: Write the failing test** — `tests/applications/playback-hub/IPlaybackHubGateway.test.mjs`

```javascript
import { describe, it, expect } from 'vitest';
import {
  IPlaybackHubGateway,
  isPlaybackHubGateway,
} from '../../../backend/src/3_applications/playback-hub/ports/IPlaybackHubGateway.mjs';

describe('IPlaybackHubGateway', () => {
  it('verifyAudio() throws "must be implemented" by default', async () => {
    const g = new IPlaybackHubGateway();
    await expect(g.verifyAudio('red')).rejects.toThrow(
      /verifyAudio must be implemented/
    );
  });

  it('isPlaybackHubGateway requires getStatus, sendCommand, AND verifyAudio', () => {
    expect(isPlaybackHubGateway({
      getStatus: () => {}, sendCommand: () => {}, verifyAudio: () => {},
    })).toBe(true);
    expect(isPlaybackHubGateway({
      getStatus: () => {}, sendCommand: () => {},
    })).toBe(false);
    expect(isPlaybackHubGateway(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/applications/playback-hub/IPlaybackHubGateway.test.mjs`
Expected: FAIL — `verifyAudio is not a function` (or "Cannot read properties").

- [ ] **Step 3: Add the method + update the structural check** — `backend/src/3_applications/playback-hub/ports/IPlaybackHubGateway.mjs`:

Replace the `sendCommand` method block with one that ALSO declares `verifyAudio`. Specifically, after the existing `sendCommand` method body (the one ending with `throw new Error('IPlaybackHubGateway.sendCommand must be implemented');`), append BEFORE the closing brace of the class:

```javascript
  /**
   * Sample the BT sink's PipeWire monitor port and return a peak-meter
   * reading. Lets callers distinguish "playback claimed playing" from
   * "speaker actually receiving samples."
   *
   * @param {string} color
   * @returns {Promise<{
   *   color: string,
   *   sink: string,
   *   peak_dbfs: number|null,
   *   audio_flowing: boolean,
   *   sampled_ms: number,
   *   bt_connected: boolean
   * }>}
   */
  async verifyAudio(color) {
    throw new Error('IPlaybackHubGateway.verifyAudio must be implemented');
  }
```

And update the `isPlaybackHubGateway` function (right below the class):

```javascript
export function isPlaybackHubGateway(obj) {
  return Boolean(obj)
    && typeof obj.getStatus === 'function'
    && typeof obj.sendCommand === 'function'
    && typeof obj.verifyAudio === 'function';
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/applications/playback-hub/IPlaybackHubGateway.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/playback-hub/ports/IPlaybackHubGateway.mjs tests/applications/playback-hub/IPlaybackHubGateway.test.mjs
git commit -m "feat(playback-hub): add verifyAudio() to IPlaybackHubGateway port"
```

---

## Task 6: Backend test double — `FakeHubGateway.verifyAudio`

**Files:**
- Modify: `backend/src/3_applications/playback-hub/test/FakeHubGateway.mjs`
- Create: `tests/applications/playback-hub/FakeHubGateway.verifyAudio.test.mjs`

- [ ] **Step 1: Write the failing test** — `tests/applications/playback-hub/FakeHubGateway.verifyAudio.test.mjs`

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeHubGateway } from '../../../backend/src/3_applications/playback-hub/test/FakeHubGateway.mjs';

describe('FakeHubGateway.verifyAudio', () => {
  let gateway;
  beforeEach(() => { gateway = new FakeHubGateway(); });

  it('returns the seeded result and records the call', async () => {
    gateway.setNextVerifyResult({
      color: 'white',
      sink: 'bluez_output.9C_0C_35_75_B7_75.1',
      peak_dbfs: -3.2,
      audio_flowing: true,
      sampled_ms: 500,
      bt_connected: true,
    });
    const result = await gateway.verifyAudio('white');
    expect(result.audio_flowing).toBe(true);
    expect(result.peak_dbfs).toBe(-3.2);
    expect(gateway.verifyCalls).toEqual([{ color: 'white' }]);
  });

  it('returns a default audio_flowing=false payload when not seeded', async () => {
    const result = await gateway.verifyAudio('red');
    expect(result).toEqual({
      color: 'red', sink: '', peak_dbfs: null, audio_flowing: false,
      sampled_ms: 0, bt_connected: false,
    });
  });

  it('throws the seeded error and clears it (single-shot)', async () => {
    gateway.setVerifyError(new Error('hub down'));
    await expect(gateway.verifyAudio('red')).rejects.toThrow('hub down');
    // Next call: default payload, no longer errors.
    const result = await gateway.verifyAudio('red');
    expect(result.audio_flowing).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/applications/playback-hub/FakeHubGateway.verifyAudio.test.mjs`
Expected: FAIL — `setNextVerifyResult is not a function`.

- [ ] **Step 3: Implement** — add to `backend/src/3_applications/playback-hub/test/FakeHubGateway.mjs`.

Inside the class body, add new private fields near the existing ones (right after `#commandError = null;` around line 25):

```javascript
  #verifyResult = null;
  #verifyError = null;

  /** @type {Array<{ color: string }>} */
  verifyCalls = [];
```

Add new setter methods (right after `setCommandError` around line 92):

```javascript
  /**
   * Seed the next verifyAudio() response.
   */
  setNextVerifyResult(result) {
    if (result === null || typeof result !== 'object') {
      throw new Error('FakeHubGateway.setNextVerifyResult requires an object');
    }
    this.#verifyResult = result;
    this.#verifyError = null;
  }

  /**
   * Seed the next verifyAudio() to reject. Single-shot — cleared after one throw.
   */
  setVerifyError(err) {
    this.#verifyError = err;
  }
```

Add the implementation override at the bottom of the class, right before the closing brace:

```javascript
  /**
   * @override
   * @param {string} color
   * @returns {Promise<object>}
   */
  async verifyAudio(color) {
    this.verifyCalls.push({ color });
    if (this.#verifyError) {
      const err = this.#verifyError;
      this.#verifyError = null; // single-shot
      throw err;
    }
    if (this.#verifyResult) {
      return this.#verifyResult;
    }
    return {
      color,
      sink: '',
      peak_dbfs: null,
      audio_flowing: false,
      sampled_ms: 0,
      bt_connected: false,
    };
  }
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/applications/playback-hub/FakeHubGateway.verifyAudio.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/playback-hub/test/FakeHubGateway.mjs tests/applications/playback-hub/FakeHubGateway.verifyAudio.test.mjs
git commit -m "test(playback-hub): add verifyAudio support to FakeHubGateway"
```

---

## Task 7: Use case — `VerifyAudioFlowing` happy path

**Files:**
- Create: `backend/src/3_applications/playback-hub/usecases/VerifyAudioFlowing.mjs`
- Create: `tests/applications/playback-hub/VerifyAudioFlowing.test.mjs`

- [ ] **Step 1: Write the failing test** — `tests/applications/playback-hub/VerifyAudioFlowing.test.mjs`

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { VerifyAudioFlowing } from '../../../backend/src/3_applications/playback-hub/usecases/VerifyAudioFlowing.mjs';
import { FakeHubGateway } from '../../../backend/src/3_applications/playback-hub/test/FakeHubGateway.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';
import { InfrastructureError } from '../../../backend/src/0_system/utils/errors/InfrastructureError.mjs';

describe('VerifyAudioFlowing', () => {
  let gateway, useCase;
  beforeEach(() => {
    gateway = new FakeHubGateway();
    useCase = new VerifyAudioFlowing({ gateway });
  });

  it('returns the gateway response as-is on success', async () => {
    gateway.setNextVerifyResult({
      color: 'white',
      sink: 'bluez_output.9C_0C_35_75_B7_75.1',
      peak_dbfs: -3.2,
      audio_flowing: true,
      sampled_ms: 500,
      bt_connected: true,
    });
    const result = await useCase.execute({ color: 'white' });
    expect(result.audio_flowing).toBe(true);
    expect(result.peak_dbfs).toBe(-3.2);
    expect(gateway.verifyCalls).toEqual([{ color: 'white' }]);
  });

  it('rejects empty color with ValidationError (no gateway call)', async () => {
    await expect(useCase.execute({ color: '' })).rejects.toThrow(ValidationError);
    expect(gateway.verifyCalls).toEqual([]);
  });

  it('rejects non-string color with ValidationError', async () => {
    await expect(useCase.execute({ color: null })).rejects.toThrow(ValidationError);
    await expect(useCase.execute({ color: 42 })).rejects.toThrow(ValidationError);
    expect(gateway.verifyCalls).toEqual([]);
  });

  it('lets InfrastructureError bubble (caller maps to 502/504)', async () => {
    gateway.setVerifyError(new InfrastructureError('hub timeout', { code: 'HUB_TIMEOUT' }));
    await expect(useCase.execute({ color: 'red' })).rejects.toThrow(InfrastructureError);
  });

  it('throws when constructed without a gateway', () => {
    expect(() => new VerifyAudioFlowing({})).toThrow(/gateway/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/applications/playback-hub/VerifyAudioFlowing.test.mjs`
Expected: FAIL — `Cannot find module '.../VerifyAudioFlowing.mjs'`.

- [ ] **Step 3: Implement** — `backend/src/3_applications/playback-hub/usecases/VerifyAudioFlowing.mjs`:

```javascript
/**
 * VerifyAudioFlowing use case.
 *
 * Asks the gateway to sample the BT sink's PipeWire monitor port and report
 * back whether real audio samples are flowing. Returns the gateway response
 * unchanged — callers (the API router) serialize it onto the wire.
 *
 * Input validation:
 *   - color must be a non-empty string → otherwise ValidationError.
 *
 * Error policy:
 *   - InfrastructureError from the gateway bubbles up (the router maps it
 *     to 502/504 per its standard mapping).
 *   - All other errors bubble too.
 */

import { ValidationError } from '../../../2_domains/core/errors/ValidationError.mjs';

export class VerifyAudioFlowing {
  /** @type {import('../ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway} */ #gateway;
  /** @type {object} */ #logger;

  /**
   * @param {{
   *   gateway: import('../ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway,
   *   logger?: object
   * }} deps
   */
  constructor({ gateway, logger } = {}) {
    if (!gateway) throw new Error('VerifyAudioFlowing: gateway required');
    this.#gateway = gateway;
    this.#logger = logger || console;
  }

  /**
   * @param {{ color: string }} input
   * @returns {Promise<object>}
   */
  async execute({ color } = {}) {
    if (typeof color !== 'string' || color.length === 0) {
      throw new ValidationError('VerifyAudioFlowing.color must be a non-empty string', {
        code: 'INVALID_COLOR', field: 'color', value: color,
      });
    }
    const result = await this.#gateway.verifyAudio(color);
    this.#logger.debug?.('playback-hub.verify.completed', {
      color,
      audio_flowing: result?.audio_flowing,
      peak_dbfs: result?.peak_dbfs,
      bt_connected: result?.bt_connected,
    });
    return result;
  }
}

export default VerifyAudioFlowing;
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/applications/playback-hub/VerifyAudioFlowing.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/playback-hub/usecases/VerifyAudioFlowing.mjs tests/applications/playback-hub/VerifyAudioFlowing.test.mjs
git commit -m "feat(playback-hub): add VerifyAudioFlowing use case"
```

---

## Task 8: Container wiring — `container.verifyAudioFlowing`

**Files:**
- Modify: `backend/src/3_applications/playback-hub/PlaybackHubContainer.mjs`
- Modify: `tests/applications/playback-hub/PlaybackHubContainer.test.mjs`

- [ ] **Step 1: Write the failing test** — append to `tests/applications/playback-hub/PlaybackHubContainer.test.mjs` inside the existing `describe('PlaybackHubContainer', ...)` block (or add a fresh `describe` at the end of the file if you prefer):

```javascript
import { VerifyAudioFlowing } from '../../../backend/src/3_applications/playback-hub/usecases/VerifyAudioFlowing.mjs';

describe('PlaybackHubContainer.verifyAudioFlowing', () => {
  it('exposes a VerifyAudioFlowing use case wired to the gateway', () => {
    // Re-use the existing test scaffolding pattern in this file — build
    // a container with the FakeHubGateway + FakeHubConfigRepository + a
    // no-op eventPublisher.
    const { FakeHubGateway } = require('../../../backend/src/3_applications/playback-hub/test/FakeHubGateway.mjs');
    const { FakeHubConfigRepository } = require('../../../backend/src/3_applications/playback-hub/test/FakeHubConfigRepository.mjs');
    const { PlaybackHubContainer } = require('../../../backend/src/3_applications/playback-hub/PlaybackHubContainer.mjs');

    const container = new PlaybackHubContainer({
      gateway: new FakeHubGateway(),
      configRepository: new FakeHubConfigRepository(),
      eventPublisher: { publish: () => {} },
    });

    expect(container.verifyAudioFlowing).toBeInstanceOf(VerifyAudioFlowing);
    // Memoized — second access returns same instance.
    expect(container.verifyAudioFlowing).toBe(container.verifyAudioFlowing);
  });
});
```

> NOTE: If the existing PlaybackHubContainer.test.mjs uses ESM `import` instead of `require`, prefer the ESM form to match. Read the first 30 lines of that file before pasting and adjust the imports to top-of-file ESM imports + a plain `it(...)` block.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/applications/playback-hub/PlaybackHubContainer.test.mjs`
Expected: FAIL — `container.verifyAudioFlowing` is undefined.

- [ ] **Step 3: Wire the use case** — `backend/src/3_applications/playback-hub/PlaybackHubContainer.mjs`:

At the top of the file, after the existing imports (around line 17):

```javascript
import { VerifyAudioFlowing } from './usecases/VerifyAudioFlowing.mjs';
```

Add a private memoization slot alongside the existing ones (after `#deleteScheduledFire;` around line 32):

```javascript
  #verifyAudioFlowing;
```

Add the getter right after the existing `get deleteScheduledFire()` block (around line 122):

```javascript
  /** @returns {VerifyAudioFlowing} */
  get verifyAudioFlowing() {
    if (!this.#verifyAudioFlowing) {
      this.#verifyAudioFlowing = new VerifyAudioFlowing({
        gateway: this.#gateway,
        logger: this.#logger,
      });
    }
    return this.#verifyAudioFlowing;
  }
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/applications/playback-hub/PlaybackHubContainer.test.mjs`
Expected: PASS — new container test + all pre-existing container tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/playback-hub/PlaybackHubContainer.mjs tests/applications/playback-hub/PlaybackHubContainer.test.mjs
git commit -m "feat(playback-hub): wire VerifyAudioFlowing in PlaybackHubContainer"
```

---

## Task 9: Adapter — `HttpPlaybackHubAdapter.verifyAudio` happy path

**Files:**
- Modify: `backend/src/1_adapters/playback-hub/HttpPlaybackHubAdapter.mjs`
- Modify: `tests/adapters/playback-hub/HttpPlaybackHubAdapter.test.mjs`

- [ ] **Step 1: Write the failing test** — append at the end of `tests/adapters/playback-hub/HttpPlaybackHubAdapter.test.mjs`, inside the existing top-level `describe('HttpPlaybackHubAdapter', ...)` block (or as a sibling `describe`):

```javascript
  // -----------------------------------------------------------------------
  // verifyAudio
  // -----------------------------------------------------------------------

  describe('verifyAudio', () => {
    it('GETs /api/verify/<color> and returns the parsed body', async () => {
      let receivedPath = null;
      const listening = await listenWith((req, res) => {
        receivedPath = req.url;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          color: 'white',
          sink: 'bluez_output.9C_0C_35_75_B7_75.1',
          peak_dbfs: -3.2,
          audio_flowing: true,
          sampled_ms: 500,
          bt_connected: true,
        }));
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      const result = await adapter.verifyAudio('white');
      expect(receivedPath).toBe('/api/verify/white');
      expect(result.audio_flowing).toBe(true);
      expect(result.peak_dbfs).toBe(-3.2);
      expect(result.bt_connected).toBe(true);
    });

    it('URL-encodes the color path segment', async () => {
      let receivedPath = null;
      const listening = await listenWith((req, res) => {
        receivedPath = req.url;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          color: 'weird color', sink: '', peak_dbfs: null,
          audio_flowing: false, sampled_ms: 0, bt_connected: false,
        }));
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      await adapter.verifyAudio('weird color');
      expect(receivedPath).toBe('/api/verify/weird%20color');
    });

    it('404 from hub → throws InfrastructureError(HUB_HTTP_ERROR)', async () => {
      const listening = await listenWith((_req, res) => {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'unknown color' }));
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      await expect(adapter.verifyAudio('orange')).rejects.toThrow(InfrastructureError);
    });

    it('non-JSON response body → throws InfrastructureError(HUB_BAD_RESPONSE)', async () => {
      const listening = await listenWith((_req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        res.end('not-json');
      });
      server = listening.server;
      adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${listening.port}` });
      await expect(adapter.verifyAudio('red')).rejects.toThrow(/HUB_BAD_RESPONSE|expected JSON/);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/adapters/playback-hub/HttpPlaybackHubAdapter.test.mjs`
Expected: FAIL — `adapter.verifyAudio is not a function`.

- [ ] **Step 3: Implement** — `backend/src/1_adapters/playback-hub/HttpPlaybackHubAdapter.mjs`:

Add the new method to the class, immediately after the existing `sendCommand` method (around line 116), before the private helpers section:

```javascript
  /**
   * GET /api/verify/<color> — sample the BT sink's PipeWire monitor port
   * and return the peak-meter snapshot.
   *
   * @param {string} color
   * @returns {Promise<{
   *   color: string,
   *   sink: string,
   *   peak_dbfs: number|null,
   *   audio_flowing: boolean,
   *   sampled_ms: number,
   *   bt_connected: boolean
   * }>}
   */
  async verifyAudio(color) {
    const path = `/api/verify/${encodeURIComponent(color)}`;
    const response = await this.#request('GET', path, null);
    if (response.status >= 400) {
      throw new InfrastructureError(
        `playback hub ${path} returned ${response.status}`,
        { code: 'HUB_HTTP_ERROR', status: response.status, body: response.body }
      );
    }
    const body = response.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new InfrastructureError(`playback hub ${path}: expected JSON object`, {
        code: 'HUB_BAD_RESPONSE', body: typeof body
      });
    }
    return body;
  }
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/adapters/playback-hub/HttpPlaybackHubAdapter.test.mjs`
Expected: PASS — 4 new `verifyAudio` tests + all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/playback-hub/HttpPlaybackHubAdapter.mjs tests/adapters/playback-hub/HttpPlaybackHubAdapter.test.mjs
git commit -m "feat(playback-hub): implement HttpPlaybackHubAdapter.verifyAudio"
```

---

## Task 10: API router — `GET /api/v1/playback-hub/verify/:color`

**Files:**
- Modify: `backend/src/4_api/v1/routers/playbackHub.mjs`
- Modify: `tests/api/v1/routers/playbackHub.test.mjs`

- [ ] **Step 1: Write the failing test** — append to `tests/api/v1/routers/playbackHub.test.mjs`:

```javascript
// ---------------------------------------------------------------------------
// GET /verify/:color
// ---------------------------------------------------------------------------

describe('GET /verify/:color', () => {
  it('200 with the gateway payload on success', async () => {
    const container = makeFakeContainer({});
    container.verifyAudioFlowing = { execute: vi.fn().mockResolvedValue({
      color: 'white',
      sink: 'bluez_output.9C_0C_35_75_B7_75.1',
      peak_dbfs: -3.2,
      audio_flowing: true,
      sampled_ms: 500,
      bt_connected: true,
    }) };
    const app = buildApp(container);
    const res = await request(app).get('/api/v1/playback-hub/verify/white');
    expect(res.status).toBe(200);
    expect(res.body.audio_flowing).toBe(true);
    expect(res.body.peak_dbfs).toBe(-3.2);
    expect(container.verifyAudioFlowing.execute).toHaveBeenCalledWith({ color: 'white' });
  });

  it('400 when use case throws ValidationError', async () => {
    const container = makeFakeContainer({});
    container.verifyAudioFlowing = { execute: vi.fn().mockRejectedValue(
      new ValidationError('bad color', { code: 'INVALID_COLOR' })
    ) };
    const app = buildApp(container);
    const res = await request(app).get('/api/v1/playback-hub/verify/%20');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('504 when InfrastructureError code is HUB_TIMEOUT', async () => {
    const container = makeFakeContainer({});
    container.verifyAudioFlowing = { execute: vi.fn().mockRejectedValue(
      new InfrastructureError('timed out', { code: 'HUB_TIMEOUT' })
    ) };
    const app = buildApp(container);
    const res = await request(app).get('/api/v1/playback-hub/verify/white');
    expect(res.status).toBe(504);
    expect(res.body.code).toBe('HUB_TIMEOUT');
  });

  it('502 for any other InfrastructureError', async () => {
    const container = makeFakeContainer({});
    container.verifyAudioFlowing = { execute: vi.fn().mockRejectedValue(
      new InfrastructureError('upstream 500', { code: 'HUB_HTTP_ERROR', status: 500 })
    ) };
    const app = buildApp(container);
    const res = await request(app).get('/api/v1/playback-hub/verify/white');
    expect(res.status).toBe(502);
  });
});
```

Also update the existing `makeFakeContainer` helper near the top of the file to include a default `verifyAudioFlowing`. Find this block:

```javascript
function makeFakeContainer(overrides = {}) {
  return {
    getHubStatus: { execute: overrides.getHubStatus ?? vi.fn() },
    getHubConfig: { execute: overrides.getHubConfig ?? vi.fn() },
    sendHubCommand: { execute: overrides.sendHubCommand ?? vi.fn() },
    updateDeviceConfig: { execute: overrides.updateDeviceConfig ?? vi.fn() },
    saveScheduledFire: { execute: overrides.saveScheduledFire ?? vi.fn() },
    deleteScheduledFire: { execute: overrides.deleteScheduledFire ?? vi.fn() },
  };
}
```

Replace it with:

```javascript
function makeFakeContainer(overrides = {}) {
  return {
    getHubStatus: { execute: overrides.getHubStatus ?? vi.fn() },
    getHubConfig: { execute: overrides.getHubConfig ?? vi.fn() },
    sendHubCommand: { execute: overrides.sendHubCommand ?? vi.fn() },
    updateDeviceConfig: { execute: overrides.updateDeviceConfig ?? vi.fn() },
    saveScheduledFire: { execute: overrides.saveScheduledFire ?? vi.fn() },
    deleteScheduledFire: { execute: overrides.deleteScheduledFire ?? vi.fn() },
    verifyAudioFlowing: { execute: overrides.verifyAudioFlowing ?? vi.fn() },
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/api/v1/routers/playbackHub.test.mjs`
Expected: FAIL — 404 (route not registered) for the happy-path test.

- [ ] **Step 3: Add the route + HUB_TIMEOUT mapping** — `backend/src/4_api/v1/routers/playbackHub.mjs`:

First, update `statusForError` so a HUB_TIMEOUT InfrastructureError yields 504 instead of 502. Replace the existing function:

```javascript
export function statusForError(err) {
  if (err instanceof EntityNotFoundError) return 404;
  if (err instanceof DomainInvariantError) return 422;
  if (err instanceof ValidationError) return 400;
  if (err instanceof InfrastructureError) {
    return err?.code === 'HUB_TIMEOUT' ? 504 : 502;
  }
  return 500;
}
```

Next, add the GET route inside `createPlaybackHubRouter`, right after the existing `router.delete('/scheduled/:id', ...)` block (around line 174):

```javascript
  // -- GET /verify/:color ---------------------------------------------------
  router.get('/verify/:color', asyncHandler(async (req, res) => {
    const payload = await container.verifyAudioFlowing.execute({
      color: req.params.color,
    });
    res.json(payload);
  }));
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/api/v1/routers/playbackHub.test.mjs`
Expected: PASS — 4 new tests + all pre-existing ones.

Cross-check the `statusForError mapping` tests in the existing suite — they assert `InfrastructureError → 502`. The change is backwards-compatible because the existing test constructs `new InfrastructureError('hub down')` with no `code`, so it still maps to 502.

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/playbackHub.mjs tests/api/v1/routers/playbackHub.test.mjs
git commit -m "feat(playback-hub): expose GET /api/v1/playback-hub/verify/:color route"
```

---

## Task 11: Frontend mutation — `useHubMutations.verifyAudio`

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.js`
- Modify: `frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx`

- [ ] **Step 1: Write the failing test** — append at the end of `frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx`, before the closing `});` of the outer `describe('useHubMutations', ...)`:

```javascript
  // --------------------------------------------------------------------
  // verifyAudio
  // --------------------------------------------------------------------

  describe('verifyAudio', () => {
    it('GETs /verify/:color and returns the parsed body', async () => {
      global.fetch.mockReturnValueOnce(ok({
        color: 'white',
        sink: 'bluez_output.9C_0C_35_75_B7_75.1',
        peak_dbfs: -3.2,
        audio_flowing: true,
        sampled_ms: 500,
        bt_connected: true,
      }));

      const { result } = renderHook(() => useHubMutations({ revalidate }));

      let response;
      await act(async () => {
        response = await result.current.verifyAudio('white');
      });

      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe('/api/v1/playback-hub/verify/white');
      expect(opts?.method ?? 'GET').toBe('GET');
      expect(response.audio_flowing).toBe(true);
      expect(response.peak_dbfs).toBe(-3.2);
    });

    it('URL-encodes special characters in color', async () => {
      global.fetch.mockReturnValueOnce(ok({}));
      const { result } = renderHook(() => useHubMutations({ revalidate }));
      await act(async () => {
        await result.current.verifyAudio('weird color');
      });
      expect(global.fetch.mock.calls[0][0]).toBe(
        '/api/v1/playback-hub/verify/weird%20color'
      );
    });

    it('returns { ok:false, error } on non-2xx response (does NOT throw)', async () => {
      global.fetch.mockReturnValueOnce(ok(
        { ok: false, error: 'hub timeout', code: 'HUB_TIMEOUT' },
        504
      ));
      const { result } = renderHook(() => useHubMutations({ revalidate }));
      let response;
      await act(async () => {
        response = await result.current.verifyAudio('white');
      });
      expect(response.ok).toBe(false);
      expect(response.error).toBe('hub timeout');
    });

    it('returns { ok:false, error } on fetch rejection (network failure)', async () => {
      global.fetch.mockRejectedValueOnce(new Error('network down'));
      const { result } = renderHook(() => useHubMutations({ revalidate }));
      let response;
      await act(async () => {
        response = await result.current.verifyAudio('white');
      });
      expect(response.ok).toBe(false);
      expect(response.error).toMatch(/network down/);
    });

    it('does NOT call revalidate (verify is read-only)', async () => {
      global.fetch.mockReturnValueOnce(ok({ audio_flowing: true }));
      const { result } = renderHook(() => useHubMutations({ revalidate }));
      await act(async () => {
        await result.current.verifyAudio('white');
      });
      expect(revalidate).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx`
Expected: FAIL — `result.current.verifyAudio is not a function`.

- [ ] **Step 3: Implement** — `frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.js`:

Add the `verifyAudio` mutation. Inside the `useHubMutations` function, after `deleteFire` (right before `return { sendCommand, updateDevice, saveFire, deleteFire };`):

```javascript
  const verifyAudio = useCallback(async (color) => {
    try {
      const r = await fetch(
        `/api/v1/playback-hub/verify/${encodeURIComponent(color)}`
      );
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        return {
          ok: false,
          error: body?.error ?? `HTTP ${r.status}`,
          code: body?.code ?? null,
        };
      }
      return body;
    } catch (err) {
      return { ok: false, error: err?.message ?? 'network error' };
    }
  }, []);
```

Update the return to include it:

```javascript
  return { sendCommand, updateDevice, saveFire, deleteFire, verifyAudio };
```

Update the JSDoc return type block (the comment block above `export function useHubMutations(...)`) to add `verifyAudio: (color: string) => Promise<object>,` alongside the other mutation entries.

- [ ] **Step 4: Run test to verify pass**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx`
Expected: PASS — 5 new `verifyAudio` tests + all pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.js frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx
git commit -m "feat(playback-hub-admin): add verifyAudio mutation to useHubMutations"
```

---

## Task 12: Frontend UI — `TransportRow` schedules verify 5 s after Play Now

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/TransportRow.jsx`
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/TransportRow.test.jsx`

- [ ] **Step 1: Write the failing test** — append inside the existing `describe('TransportRow', ...)` in `frontend/src/modules/Admin/PlaybackHub/components/TransportRow.test.jsx`:

```javascript
  // -- post-Play verify ------------------------------------------------------
  describe('post-Play verify guardrail', () => {
    let notificationsMock;

    beforeEach(() => {
      notificationsMock = { show: vi.fn() };
      vi.doMock('@mantine/notifications', () => ({ notifications: notificationsMock }));
    });

    afterEach(() => {
      vi.doUnmock('@mantine/notifications');
    });

    it('after a successful Play Now, calls verifyAudio after 5s and shows a green toast when audio_flowing', async () => {
      vi.useFakeTimers();
      const { TransportRow: Subject } = await import('./TransportRow.jsx');

      const mutations = {
        sendCommand: vi.fn().mockResolvedValue({ ok: true, applied: ['red'], skipped: [] }),
        verifyAudio: vi.fn().mockResolvedValue({ audio_flowing: true, peak_dbfs: -3.2, bt_connected: true }),
      };

      render(
        <MantineProvider>
          <Subject slot={mkSlot()} status={mkStatus()} mutations={mutations} />
        </MantineProvider>
      );

      act(() => { pickerOnChangeRef('plex:670208'); });
      fireEvent.click(screen.getByRole('button', { name: /play now/i }));

      // verifyAudio should NOT have been called yet.
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(mutations.verifyAudio).not.toHaveBeenCalled();

      // Advance just under 5s — still not called.
      await act(async () => { await vi.advanceTimersByTimeAsync(4900); });
      expect(mutations.verifyAudio).not.toHaveBeenCalled();

      // Cross 5s threshold.
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(mutations.verifyAudio).toHaveBeenCalledWith('red');

      // Settle the verifyAudio promise.
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(notificationsMock.show).toHaveBeenCalledTimes(1);
      const call = notificationsMock.show.mock.calls[0][0];
      expect(call.color).toBe('green');
      expect(String(call.message)).toMatch(/Audio verified/i);
    });

    it('shows a red toast (autoClose 15000) when audio_flowing is false', async () => {
      vi.useFakeTimers();
      const { TransportRow: Subject } = await import('./TransportRow.jsx');

      const mutations = {
        sendCommand: vi.fn().mockResolvedValue({ ok: true, applied: ['red'], skipped: [] }),
        verifyAudio: vi.fn().mockResolvedValue({ audio_flowing: false, peak_dbfs: -90, bt_connected: true }),
      };

      render(
        <MantineProvider>
          <Subject slot={mkSlot()} status={mkStatus()} mutations={mutations} />
        </MantineProvider>
      );

      act(() => { pickerOnChangeRef('plex:670208'); });
      fireEvent.click(screen.getByRole('button', { name: /play now/i }));

      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(notificationsMock.show).toHaveBeenCalledTimes(1);
      const call = notificationsMock.show.mock.calls[0][0];
      expect(call.color).toBe('red');
      expect(call.autoClose).toBe(15000);
      expect(String(call.message)).toMatch(/No audio.*red/i);
    });

    it('shows NO toast on verifyAudio { ok: false } (silent fallback)', async () => {
      vi.useFakeTimers();
      const { TransportRow: Subject } = await import('./TransportRow.jsx');

      const mutations = {
        sendCommand: vi.fn().mockResolvedValue({ ok: true, applied: ['red'], skipped: [] }),
        verifyAudio: vi.fn().mockResolvedValue({ ok: false, error: 'hub timeout' }),
      };

      render(
        <MantineProvider>
          <Subject slot={mkSlot()} status={mkStatus()} mutations={mutations} />
        </MantineProvider>
      );

      act(() => { pickerOnChangeRef('plex:670208'); });
      fireEvent.click(screen.getByRole('button', { name: /play now/i }));

      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(notificationsMock.show).not.toHaveBeenCalled();
    });

    it('does NOT schedule verify when Play Now applied is empty', async () => {
      vi.useFakeTimers();
      const { TransportRow: Subject } = await import('./TransportRow.jsx');

      const mutations = {
        sendCommand: vi.fn().mockResolvedValue({
          ok: true,
          applied: [],
          skipped: [{ color: 'red', reason: 'unreachable' }],
        }),
        verifyAudio: vi.fn(),
      };

      render(
        <MantineProvider>
          <Subject slot={mkSlot()} status={mkStatus()} mutations={mutations} />
        </MantineProvider>
      );

      act(() => { pickerOnChangeRef('plex:670208'); });
      fireEvent.click(screen.getByRole('button', { name: /play now/i }));

      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
      expect(mutations.verifyAudio).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/PlaybackHub/components/TransportRow.test.jsx`
Expected: FAIL — `mutations.verifyAudio` was never called (current `handlePlayNow` does not schedule verify).

- [ ] **Step 3: Implement** — `frontend/src/modules/Admin/PlaybackHub/components/TransportRow.jsx`:

Add the imports at the top of the file. Replace the existing import header (lines 1–9):

```javascript
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Group, Slider, Button, ActionIcon, Box } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconPlayerPlay,
  IconPlayerPause,
} from '@tabler/icons-react';
import { LabeledContentPicker } from './LabeledContentPicker.jsx';
import getLogger from '../../../../lib/logging/Logger.js';
```

> NOTE: The relative path `../../../../lib/logging/Logger.js` is from `frontend/src/modules/Admin/PlaybackHub/components/` → `frontend/src/lib/logging/Logger.js`. Verify in your editor before pasting.

Add constants just below the existing `VOLUME_DEBOUNCE_MS` (around line 11):

```javascript
const VOLUME_DEBOUNCE_MS = 300;
// Tunable. We saw mpv take ~5s to stabilize after BT A2DP comes up. Cold-start
// BT (e.g. the 10-SYNC bulb after a wedged state) may need longer; bump if
// false-negative toasts become noisy in practice.
const POST_PLAY_VERIFY_DELAY_MS = 5000;
const VERIFY_ERROR_AUTOCLOSE_MS = 15000;
const VERIFY_OK_AUTOCLOSE_MS = 3000;
```

Inside the `TransportRow` component, add a logger and a ref for the pending verify timer near the existing `userInteractingRef` (around line 38):

```javascript
  const logger = useMemo(
    () => getLogger().child({ component: 'TransportRow' }),
    []
  );
  const verifyTimerRef = useRef(null);
```

Clean up the timer on unmount — extend the existing useEffect cleanup (around line 59):

```javascript
  useEffect(() => () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current);
  }, []);
```

Replace the existing `handlePlayNow` (around lines 72–79) with an async version that schedules verify:

```javascript
  const handlePlayNow = async () => {
    if (!pickedValue) return;
    let cmdResult;
    try {
      cmdResult = await mutations.sendCommand({
        action: 'play',
        target: slot.color,
        contentId: pickedValue,
      });
    } catch (err) {
      logger.warn('play-now.send-command-failed', {
        color: slot.color, error: err?.message,
      });
      return;
    }
    const applied = Array.isArray(cmdResult?.applied) ? cmdResult.applied : [];
    if (!applied.includes(slot.color)) {
      logger.debug('play-now.not-applied-skip-verify', {
        color: slot.color, applied, skipped: cmdResult?.skipped,
      });
      return;
    }
    logger.info('play-now.verify-scheduled', {
      color: slot.color, delayMs: POST_PLAY_VERIFY_DELAY_MS,
    });
    if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current);
    verifyTimerRef.current = setTimeout(async () => {
      verifyTimerRef.current = null;
      let result;
      try {
        result = await mutations.verifyAudio(slot.color);
      } catch (err) {
        logger.warn('play-now.verify-threw', {
          color: slot.color, error: err?.message,
        });
        return;
      }
      if (!result || result.ok === false) {
        logger.warn('play-now.verify-network-failed', {
          color: slot.color, error: result?.error,
        });
        return;
      }
      if (result.audio_flowing === true) {
        logger.info('play-now.verify-ok', {
          color: slot.color, peak_dbfs: result.peak_dbfs,
        });
        notifications.show({
          color: 'green',
          title: 'Audio verified',
          message: `Audio verified at ${slot.color}`,
          autoClose: VERIFY_OK_AUTOCLOSE_MS,
        });
      } else {
        logger.warn('play-now.verify-silent', {
          color: slot.color,
          peak_dbfs: result.peak_dbfs,
          bt_connected: result.bt_connected,
        });
        notifications.show({
          color: 'red',
          title: 'No audio at speaker',
          message: `No audio at ${slot.color} speaker — try Play again`,
          autoClose: VERIFY_ERROR_AUTOCLOSE_MS,
        });
      }
    }, POST_PLAY_VERIFY_DELAY_MS);
  };
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd /opt/Code/DaylightStation && ./frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/PlaybackHub/components/TransportRow.test.jsx`
Expected: PASS — 4 new tests + all pre-existing ones (the pre-existing Play Now test still passes; it asserts `mutations.sendCommand` was called and doesn't enforce timer state).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Admin/PlaybackHub/components/TransportRow.jsx frontend/src/modules/Admin/PlaybackHub/components/TransportRow.test.jsx
git commit -m "feat(playback-hub-admin): show peak-meter guardrail toast 5s after Play Now"
```

---

## Task 13: Full-suite regression sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the full isolated harness**

Run: `cd /opt/Code/DaylightStation && npm run test:isolated`
Expected: All tests pass — including the existing playback-hub use case, adapter, router, hook, and component tests.

- [ ] **Step 2: Run the Python hub tests once more**

Run: `cd /opt/Code/DaylightStation/_extensions/playback-hub && python3 -m unittest test_peak_meter.py -v`
Expected: 11 tests PASS.

- [ ] **Step 3: If anything fails, fix it before declaring done.** Do not skip or comment out tests. Investigate, fix the root cause, commit, and re-run.

- [ ] **Step 4: No commit needed — this task is verification only.**

---

## Manual verification (post-merge, on `kckern-server`)

Once the work merges to main and the hub is updated (the hub runs `web.py` directly on the playback-hub Raspberry Pi, not in Docker — deploy the new `web.py` + `peak_meter.py` separately):

1. Confirm `pw-cat` exists on the hub: `ssh playback-hub which pw-cat`
2. Hit the hub endpoint directly: `curl -s http://playback-hub:8080/api/verify/white | jq` — should return `peak_dbfs` and `audio_flowing`.
3. Hit through DaylightStation: `curl -s http://localhost:3111/api/v1/playback-hub/verify/white | jq` — same shape.
4. Trigger Play Now on the Admin UI; 5 s later a Mantine toast should appear (green if audible, red if silent).
5. Reproduce the original silent-mpv bug: fire Play Now on `white` from a cold BT state. If the bug still occurs, the red toast should fire — confirming the guardrail works.
