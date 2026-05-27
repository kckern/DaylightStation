#!/usr/bin/env python3
"""
avrcp_dispatch.py — translate AVRCP key events from a Bluetooth headset
into mpv IPC commands on a specific slot's socket.

Each connected musiCozy headset exposes its AVRCP buttons as a virtual
Linux input device under /dev/input/eventN. This script reads input_event
structs from one such device and dispatches the matching control to the
slot's mpv-socket. One process per slot; lifecycle is bound to the BT
connection by musicozy.sh.

Usage:
    avrcp_dispatch.py <event_device> <mpv_socket> <slot_tag>

stdlib-only; runs on the same Python 3 already required by web.py.
"""

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
KEY_PLAYPAUSE = 164
KEY_PLAY = 207
KEY_PAUSE = 119
KEY_NEXTSONG = 163
KEY_PREVIOUSSONG = 165
KEY_STOPCD = 166
KEY_VOLUMEUP = 115
KEY_VOLUMEDOWN = 114

KEY_TO_MPV = {
    KEY_PLAYPAUSE:    ["cycle", "pause"],
    KEY_PLAY:         ["set_property", "pause", False],
    KEY_PAUSE:        ["set_property", "pause", True],
    KEY_STOPCD:       ["set_property", "pause", True],
    KEY_NEXTSONG:     ["playlist-next"],
    KEY_PREVIOUSSONG: ["playlist-prev"],
}

KEY_NAMES = {
    KEY_PLAYPAUSE: "PLAYPAUSE",
    KEY_PLAY: "PLAY",
    KEY_PAUSE: "PAUSE",
    KEY_STOPCD: "STOP",
    KEY_NEXTSONG: "NEXT",
    KEY_PREVIOUSSONG: "PREV",
    KEY_VOLUMEUP: "VOL+",
    KEY_VOLUMEDOWN: "VOL-",
}


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


def main():
    if len(sys.argv) < 3:
        print(f"usage: {sys.argv[0]} <event_device> <mpv_socket> [tag]", file=sys.stderr)
        sys.exit(2)

    event_path = sys.argv[1]
    sock_path = sys.argv[2]
    tag = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(event_path)

    log(tag, f"avrcp dispatch: {event_path} → {sock_path}")

    try:
        fd = open(event_path, "rb", buffering=0)
    except FileNotFoundError:
        log(tag, f"event device disappeared before open: {event_path}")
        sys.exit(0)
    except PermissionError as e:
        log(tag, f"permission denied on {event_path}: {e}")
        sys.exit(1)

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
                # Volume keys handled by audio layer; log at low verbosity only.
                if ev_code in (KEY_VOLUMEUP, KEY_VOLUMEDOWN):
                    continue
                log(tag, f"ignored key {key_name}")
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
