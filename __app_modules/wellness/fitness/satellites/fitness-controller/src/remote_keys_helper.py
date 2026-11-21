#!/usr/bin/env python3
"""Bluetooth remote key reader: one JSON line per event on stdout.

Reads every Bluetooth input device that is NOT a game pad (pads go through the
browser Gamepad API) straight from the kernel, tagged with the device's
Bluetooth address, so two remotes of the same model stay apart. The browser
cannot do this: a KeyboardEvent carries no device identity.

Lines:
  {"type":"open","address","name","node"}           a device node was opened
  {"type":"gone","address","node"}                   it went away (sleep/reconnect)
  {"type":"key","address","name","code","scan","state"}
        code  = kernel KEY_* number; scan = HID usage from MSC_SCAN (or null)
        state = "down" | "up" | "repeat"
  {"type":"unmapped","address","report"}             a raw HID report with
        non-zero data that produced no key event: a button the kernel drops.

Devices are rediscovered every 2 s, so a remote that sleeps and reconnects
(new event/hidraw nodes) is picked up again. Never grabs: keys still reach X.
"""
import glob
import json
import os
import select
import struct
import sys
import time

EVENT = struct.Struct("llHHi")  # struct input_event on 64-bit
EV_KEY, EV_MSC, MSC_SCAN = 1, 4, 4
UNMAPPED_WAIT_S = 0.15


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def read(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return ""


def is_pad(input_dir):
    return bool(glob.glob(os.path.join(input_dir, "js*")))


def discover():
    """{node_path: (kind, address, name)} for Bluetooth non-pad devices."""
    out = {}
    for ev in glob.glob("/sys/class/input/event*"):
        dev = os.path.join(ev, "device")
        if read(os.path.join(dev, "id/bustype")) != "0005":
            continue
        addr = read(os.path.join(dev, "uniq")).upper()
        if not addr or is_pad(dev):
            continue
        out["/dev/input/" + os.path.basename(ev)] = ("ev", addr, read(os.path.join(dev, "name")))
    for hr in glob.glob("/sys/class/hidraw/hidraw*"):
        uevent = read(os.path.join(hr, "device/uevent"))
        fields = dict(l.split("=", 1) for l in uevent.splitlines() if "=" in l)
        addr = fields.get("HID_UNIQ", "").upper()
        if not addr or not fields.get("HID_ID", "").startswith("0005:"):
            continue
        if any(is_pad(d) for d in glob.glob(os.path.join(hr, "device/input/input*"))):
            continue
        out["/dev/" + os.path.basename(hr)] = ("raw", addr, fields.get("HID_NAME", ""))
    return out


def main():
    open_fds = {}          # fd -> (path, kind, addr, name)
    scan = {}              # fd -> last MSC_SCAN value
    last_key = {}          # addr -> monotonic time of last key event
    pending = []           # [(t, addr, hex)] raw reports awaiting a key
    next_discover = 0.0
    while True:
        now = time.monotonic()
        if now >= next_discover:
            next_discover = now + 2.0
            known = {v[0] for v in open_fds.values()}
            for path, (kind, addr, name) in discover().items():
                if path in known:
                    continue
                try:
                    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
                except OSError:
                    continue
                open_fds[fd] = (path, kind, addr, name)
                emit({"type": "open", "address": addr, "name": name, "node": path, "kind": kind})
        timeout = 0.05 if pending else 0.5
        ready = select.select(list(open_fds), [], [], timeout)[0] if open_fds else (time.sleep(timeout) or [])
        for fd in ready:
            path, kind, addr, name = open_fds[fd]
            try:
                data = os.read(fd, 4096)
            except OSError:
                data = b""
            if not data:
                os.close(fd)
                del open_fds[fd]
                scan.pop(fd, None)
                emit({"type": "gone", "address": addr, "node": path})
                continue
            if kind == "raw":
                if any(data[1:]):  # skip the all-zero release report
                    pending.append((time.monotonic(), addr, data.hex(" ")))
                continue
            for i in range(0, len(data) - EVENT.size + 1, EVENT.size):
                _, _, etype, code, value = EVENT.unpack_from(data, i)
                if etype == EV_MSC and code == MSC_SCAN:
                    scan[fd] = value
                elif etype == EV_KEY:
                    last_key[addr] = time.monotonic()
                    emit({"type": "key", "address": addr, "name": name, "code": code,
                          "scan": scan.pop(fd, None),
                          "state": {0: "up", 1: "down", 2: "repeat"}.get(value, str(value))})
        now = time.monotonic()
        keep = []
        for t, addr, hexs in pending:
            if last_key.get(addr, 0) >= t - 0.01:
                continue  # the kernel turned it into a key
            if now - t < UNMAPPED_WAIT_S:
                keep.append((t, addr, hexs))
            else:
                emit({"type": "unmapped", "address": addr, "report": hexs})
        pending = keep


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
