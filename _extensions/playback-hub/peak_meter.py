"""
peak_meter.py — sample a PipeWire sink's monitor port and return the peak
amplitude in dBFS. Pure helper used by web.py's /api/verify/<color> route and
by operational health checks.

pw-cat on this box's PipeWire (1.0.x) has **no `--raw` flag** — the earlier
implementation passed it, so pw-cat errored out immediately and the endpoint
ALWAYS returned `audio_flowing: false` (a silent false-negative that helped hide
the 2026-07-06 outage). This version records a short WAV to a temp file with
`pw-cat --record --format=s16 <file>` and parses it with the stdlib `wave`
module — the approach verified working on the hub.

Test seams: `popen_factory` (spawn), `sleep_factory` (record duration), and
`wav_peak_reader` (parse) are injected by unit tests so no real pw-cat process
or filesystem WAV is needed. `_wav_peak_amplitude` and `_to_dbfs` are pure.
"""
import logging
import math
import os
import struct
import subprocess
import tempfile
import time
import wave
from typing import Callable, Optional

logger = logging.getLogger(__name__)

DEFAULT_SAMPLE_SEC = 0.5
AUDIO_FLOWING_THRESHOLD_DBFS = -60.0
DBFS_FLOOR = -90.0
DBFS_CEIL = 0.0


def _to_dbfs(peak: float) -> float:
    """Convert a normalized peak amplitude (0.0–1.0) to dBFS, clamped."""
    if peak <= 0.0:
        return DBFS_FLOOR
    dbfs = 20.0 * math.log10(peak)
    if dbfs < DBFS_FLOOR:
        return DBFS_FLOOR
    if dbfs > DBFS_CEIL:
        return DBFS_CEIL
    return dbfs


def _wav_peak_amplitude(wav_path: str) -> Optional[float]:
    """Return the peak sample amplitude in a WAV file, normalized to 0.0–1.0,
    or None if the file has no readable audio frames. Pure/deterministic."""
    try:
        with wave.open(wav_path, "rb") as w:
            width = w.getsampwidth()
            nframes = w.getnframes()
            raw = w.readframes(nframes)
    except (wave.Error, EOFError, OSError) as err:
        logger.warning("peak_meter.wav_parse_failed path=%s err=%s", wav_path, err)
        return None
    if not raw or width < 1:
        return None
    full_scale = float(1 << (8 * width - 1))  # e.g. 32768 for s16
    count = len(raw) // width
    if count == 0:
        return None
    peak = 0
    if width == 2:  # fast path for the common s16 case
        for (sample,) in struct.iter_unpack("<h", raw[: count * 2]):
            a = -sample if sample < 0 else sample
            if a > peak:
                peak = a
    else:
        for i in range(count):
            chunk = raw[i * width:(i + 1) * width]
            sample = int.from_bytes(chunk, "little", signed=True)
            a = -sample if sample < 0 else sample
            if a > peak:
                peak = a
    return peak / full_scale


def sample_peak_dbfs(
    sink_name: str,
    duration_sec: float = DEFAULT_SAMPLE_SEC,
    popen_factory: Callable = subprocess.Popen,
    sleep_factory: Callable[[float], None] = time.sleep,
    wav_peak_reader: Callable[[str], Optional[float]] = _wav_peak_amplitude,
) -> Optional[float]:
    """
    Record `duration_sec` from `<sink_name>:monitor_FL` to a temp WAV via pw-cat
    and return the peak amplitude in dBFS, or None on failure / no samples.
    """
    if not sink_name:
        return None
    target = f"{sink_name}:monitor_FL"
    fd, wav_path = tempfile.mkstemp(prefix="pkmeter_", suffix=".wav")
    os.close(fd)
    # NOTE: no `--raw` (unsupported); pw-cat writes a WAV to the file path.
    cmd = [
        "pw-cat", "--record",
        "--target", target,
        "--format=s16",
        "--rate", "44100",
        "--channels", "1",
        wav_path,
    ]
    try:
        proc = popen_factory(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (FileNotFoundError, OSError) as err:
        logger.warning("peak_meter.popen_failed sink=%s err=%s", sink_name, err)
        _cleanup(wav_path)
        return None

    try:
        sleep_factory(duration_sec)
    finally:
        try:
            proc.terminate()
        except Exception:
            pass
        try:
            proc.wait(timeout=1)
        except Exception:
            pass

    peak = wav_peak_reader(wav_path)
    _cleanup(wav_path)
    if not peak:  # None or 0.0 → no audio captured
        return None
    return _to_dbfs(peak)


def _cleanup(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass
