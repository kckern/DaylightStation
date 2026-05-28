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
        while True:
            chunk = proc.stdout.read(SAMPLE_BYTES)
            if not chunk or len(chunk) < SAMPLE_BYTES:
                break
            (sample,) = struct.unpack("<f", chunk)
            amp = abs(sample)
            if amp > peak:
                peak = amp
            if now_factory() >= deadline:
                break
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
