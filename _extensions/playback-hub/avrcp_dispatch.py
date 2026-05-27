#!/usr/bin/env python3
"""
avrcp_dispatch.py — translate AVRCP key events from a Bluetooth headset
into mpv IPC commands on a specific slot's socket.

Each connected musiCozy headset exposes its AVRCP buttons as a virtual
Linux input device under /dev/input/eventN. This script reads input_event
structs from one such device and dispatches the matching control to the
slot's mpv-socket. One process per slot; lifecycle is bound to the BT
connection by playback-hub.sh.

Usage:
    avrcp_dispatch.py <event_device> <mpv_socket> <slot_tag>
                      [--min-volume N] [--max-volume N]

stdlib-only; runs on the same Python 3 already required by web.py.
"""

import argparse
import json
import os
import socket
import struct
import sys
import time

# struct input_event on 64-bit Linux:
#   struct timeval { long tv_sec; long tv_usec; }  (16 bytes)
#   __u16 type
#   __u16 code
#   __s32 value
# Total: 24 bytes. Format: 'qqHHi' (q=8B signed long, H=2B unsigned, i=4B int).
EVENT_FORMAT = "qqHHi"
EVENT_SIZE = struct.calcsize(EVENT_FORMAT)  # 24

EV_KEY = 0x01
KEY_DOWN = 1   # value=1 on press, 0 on release, 2 on autorepeat

# Linux input-event-codes.h key codes commonly emitted by BT AVRCP CT devices.
# musiCozy headsets emit PLAYPAUSE (single click) and NEXTSONG/PREVIOUSSONG
# (long-press +/-). Volume keys are handled by ALSA/PipeWire — we no-op them
# here so volume control still works without interfering with playback.
# Modern key codes (linux/input-event-codes.h)
KEY_PLAYPAUSE = 164
KEY_PLAY = 207
KEY_PAUSE = 119
KEY_NEXTSONG = 163
KEY_PREVIOUSSONG = 165
KEY_STOPCD = 166

# Legacy "CD-style" media keys — musiCozy headsets emit these instead
# of the modern ones above. The headset alternates PLAYCD/PAUSECD based
# on what it thinks the state is, but mpv tracks its own state, so we
# treat both as "toggle" to stay in sync regardless of who's right.
KEY_PLAYCD = 200
KEY_PAUSECD = 201
KEY_FORWARD = 159
KEY_REWIND = 168
KEY_FASTFORWARD = 208

KEY_VOLUMEUP = 115
KEY_VOLUMEDOWN = 114

KEY_TO_MPV = {
    KEY_PLAYPAUSE:    ["cycle", "pause"],
    KEY_PLAY:         ["set_property", "pause", False],
    KEY_PAUSE:        ["set_property", "pause", True],
    KEY_STOPCD:       ["set_property", "pause", True],
    KEY_NEXTSONG:     ["playlist-next"],
    KEY_PREVIOUSSONG: ["playlist-prev"],
    # Legacy musiCozy mapping:
    KEY_PLAYCD:       ["cycle", "pause"],
    KEY_PAUSECD:      ["cycle", "pause"],
    KEY_FORWARD:      ["playlist-next"],
    KEY_FASTFORWARD:  ["playlist-next"],
    KEY_REWIND:       ["playlist-prev"],
}

KEY_NAMES = {
    KEY_PLAYPAUSE: "PLAYPAUSE",
    KEY_PLAY: "PLAY",
    KEY_PAUSE: "PAUSE",
    KEY_STOPCD: "STOP",
    KEY_NEXTSONG: "NEXT",
    KEY_PREVIOUSSONG: "PREV",
    KEY_PLAYCD: "PLAYCD",
    KEY_PAUSECD: "PAUSECD",
    KEY_FORWARD: "FORWARD",
    KEY_FASTFORWARD: "FFWD",
    KEY_REWIND: "REWIND",
    KEY_VOLUMEUP: "VOL+",
    KEY_VOLUMEDOWN: "VOL-",
}


# For STARTUP_PAUSE_GRACE_S after the dispatcher starts, suppress any
# key event that would PAUSE playback. Some headsets emit a spurious
# pause shortly after connecting (their interpretation of AVRCP state
# sync). playback-hub guarantees connect = play, so we treat early pause
# keys as no-ops — and convert them to an explicit "play" command in
# case mpv-mpris already saw the pause directly from MediaPlayer1.
STARTUP_PAUSE_GRACE_S = 5.0


def log(tag, msg):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] [{tag}] {msg}", flush=True)


def send_mpv(sock_path, command):
    """Send one IPC command to mpv via Unix-domain socket.

    Returns True on success, False if socket missing / mpv not alive.
    Connection refusal is not fatal — mpv may briefly be unreachable
    during reload; the next button press will reconnect.
    """
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(0.5)
        s.connect(sock_path)
        payload = json.dumps({"command": command}) + "\n"
        s.send(payload.encode("utf-8"))
        s.close()
        return True
    except (FileNotFoundError, ConnectionRefusedError, socket.timeout, OSError):
        return False


VOL_STEP = 5   # mpv volume change per VOL+/VOL- key press


def adjust_volume(sock_path, delta, vmin, vmax, tag):
    """Get current mpv volume, clamp(current+delta, [vmin, vmax]), set.

    A single read+write isn't atomic (someone else could change volume
    between the two), but this is the only writer in practice — the
    sink stays at 100% and BlueZ is configured not to push absolute
    volume into mpv. So racing isn't a real concern here.
    """
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(0.5)
        s.connect(sock_path)
        s.send((json.dumps({"command": ["get_property", "volume"], "request_id": 1}) + "\n").encode())
        # Read up to one response line — mpv may emit events before the reply.
        buf = b""
        deadline = time.monotonic() + 0.5
        cur = None
        while time.monotonic() < deadline:
            chunk = s.recv(4096)
            if not chunk:
                break
            buf += chunk
            for line in buf.splitlines():
                try:
                    j = json.loads(line.decode())
                except Exception:
                    continue
                if j.get("request_id") == 1 and "data" in j:
                    cur = j["data"]
                    break
            if cur is not None:
                break
        s.close()
        if cur is None:
            return None
        new_vol = max(vmin, min(vmax, cur + delta))
        if new_vol == cur:
            log(tag, f"VOL{'+' if delta > 0 else '-'} at clamp ({cur}, range [{vmin},{vmax}])")
            return cur
        send_mpv(sock_path, ["set_property", "volume", new_vol])
        log(tag, f"volume {cur} → {new_vol} (delta={delta:+d}, clamped [{vmin},{vmax}])")
        return new_vol
    except (FileNotFoundError, ConnectionRefusedError, socket.timeout, OSError) as e:
        log(tag, f"adjust_volume failed: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("event_path")
    parser.add_argument("sock_path")
    parser.add_argument("tag", nargs="?", default=None)
    parser.add_argument("--min-volume", type=int, default=0)
    parser.add_argument("--max-volume", type=int, default=100)
    args, _ = parser.parse_known_args()

    event_path = args.event_path
    sock_path = args.sock_path
    tag = args.tag if args.tag else os.path.basename(event_path)
    vmin = max(0, min(100, args.min_volume))
    vmax = max(vmin, min(100, args.max_volume))

    log(tag, f"avrcp dispatch: {event_path} → {sock_path} (volume range [{vmin},{vmax}])")

    try:
        fd = open(event_path, "rb", buffering=0)
    except FileNotFoundError:
        log(tag, f"event device disappeared before open: {event_path}")
        sys.exit(0)
    except PermissionError as e:
        log(tag, f"permission denied on {event_path}: {e}")
        sys.exit(1)

    # Keys that would PAUSE playback. Suppressed during the connect
    # grace window so spurious headset-side pause sync can't override
    # the "always start playing" guarantee playback-hub makes.
    pausing_keys = {KEY_PAUSE, KEY_PAUSECD, KEY_STOPCD}
    started_at = time.monotonic()

    try:
        while True:
            try:
                data = fd.read(EVENT_SIZE)
            except OSError as e:
                # Device removed — BT disconnect tore down the AVRCP node.
                log(tag, f"event device gone: {e}")
                break

            if not data:
                # EOF — same case as OSError, file ended.
                log(tag, "event stream ended (EOF)")
                break
            if len(data) != EVENT_SIZE:
                # Partial read at shutdown; drop.
                continue

            _, _, ev_type, ev_code, ev_value = struct.unpack(EVENT_FORMAT, data)
            if ev_type != EV_KEY or ev_value != KEY_DOWN:
                continue

            cmd = KEY_TO_MPV.get(ev_code)
            key_name = KEY_NAMES.get(ev_code, f"code={ev_code}")
            if cmd is None:
                # Volume keys: actively manage mpv volume with clamps.
                # BlueZ's AbsoluteVolume forwarding to the BT sink should
                # be disabled (see /etc/bluetooth/main.conf), so mpv's
                # internal volume is now the single source of truth.
                if ev_code == KEY_VOLUMEUP:
                    adjust_volume(sock_path, +VOL_STEP, vmin, vmax, tag)
                    continue
                if ev_code == KEY_VOLUMEDOWN:
                    adjust_volume(sock_path, -VOL_STEP, vmin, vmax, tag)
                    continue
                log(tag, f"ignored key {key_name}")
                continue

            # Connect-time pause suppression: if this would pause playback
            # AND we're inside the grace window, force playing state
            # instead. KEY_PLAYCD and KEY_PLAYPAUSE pass through (they
            # cycle, which from a paused state still goes to playing).
            elapsed = time.monotonic() - started_at
            if elapsed < STARTUP_PAUSE_GRACE_S and ev_code in pausing_keys:
                send_mpv(sock_path, ["set_property", "pause", False])
                log(tag, f"{key_name} suppressed within {STARTUP_PAUSE_GRACE_S:.0f}s connect grace — forced play")
                continue

            ok = send_mpv(sock_path, cmd)
            log(tag, f"{key_name} → {cmd}{'' if ok else ' (FAILED — socket unreachable)'}")
    finally:
        try:
            fd.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
