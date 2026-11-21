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
  {"type":"gatt","address","name","att","value"}     an ATT notification from a
        remote (read off the HCI monitor channel, like btmon). Some remotes send
        input on a HID report their own report map does not declare, so BlueZ
        receives it and the kernel drops it (Magicsee R1 gamepad mode: 2-byte
        reports on ATT handle 0x001f). remoteKeys.mjs decodes known ones.

Devices are rediscovered every 2 s, so a remote that sleeps and reconnects
(new event/hidraw nodes) is picked up again. Never grabs: keys still reach X.
"""
import ctypes
import ctypes.util
import glob
import json
import re
import socket
import subprocess
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


AF_BLUETOOTH, BTPROTO_HCI, HCI_DEV_NONE, HCI_CHANNEL_MONITOR = 31, 1, 0xFFFF, 2
MON_EVENT, MON_ACL_RX = 3, 5


def open_monitor():
    """Read-only HCI monitor socket (what btmon uses), or None."""
    try:
        libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
        sock = socket.socket(AF_BLUETOOTH, socket.SOCK_RAW, BTPROTO_HCI)
        addr = struct.pack("<HHH", AF_BLUETOOTH, HCI_DEV_NONE, HCI_CHANNEL_MONITOR)
        if libc.bind(sock.fileno(), ctypes.create_string_buffer(addr), len(addr)) != 0:
            sock.close()
            return None
        sock.setblocking(False)
        return sock
    except OSError:
        return None


def connection_handles():
    """{hci connection handle: ADDRESS} from `hcitool con`."""
    out = {}
    try:
        text = subprocess.run(["hcitool", "con"], capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        return out
    for m in re.finditer(r"([0-9A-F:]{17}) handle (\d+)", text, re.I):
        out[int(m.group(2))] = m.group(1).upper()
    return out


def parse_monitor(frame, handles):
    """One monitor frame -> ("gatt", handle, att, value) | ("conn", handle, addr) | ("disc", handle) | None."""
    if len(frame) < 6:
        return None
    opcode, _index, length = struct.unpack_from("<HHH", frame, 0)
    d = frame[6:6 + length]
    if opcode == MON_ACL_RX and len(d) >= 11:
        hf, _dlen, _l2len, cid = struct.unpack_from("<HHHH", d, 0)
        if (hf >> 12) & 0x3 != 0x2 or cid != 0x0004 or d[8] != 0x1B:
            return None
        return ("gatt", hf & 0x0FFF, struct.unpack_from("<H", d, 9)[0], bytes(d[11:]))
    if opcode == MON_EVENT and len(d) >= 2:
        code = d[0]
        if code == 0x3E and len(d) >= 14 and d[2] in (0x01, 0x0A) and d[3] == 0:
            addr = ":".join("%02X" % b for b in reversed(d[8:14]))
            return ("conn", struct.unpack_from("<H", d, 4)[0] & 0x0FFF, addr)
        if code == 0x05 and len(d) >= 6:
            return ("disc", struct.unpack_from("<H", d, 3)[0] & 0x0FFF)
    return None


def main():
    open_fds = {}          # fd -> (path, kind, addr, name)
    scan = {}              # fd -> last MSC_SCAN value
    last_key = {}          # addr -> monotonic time of last key event
    pending = []           # [(t, addr, hex)] raw reports awaiting a key
    next_discover = 0.0
    names = {}             # ADDRESS -> HID name, for remotes we read
    monitor = open_monitor()
    handles = connection_handles() if monitor else {}
    if monitor is None:
        emit({"type": "monitor-unavailable"})
    while True:
        now = time.monotonic()
        if now >= next_discover:
            next_discover = now + 2.0
            known = {v[0] for v in open_fds.values()}
            found = discover()
            names = {}
            for _p, (kind, addr, name) in found.items():
                if kind == "raw" or addr not in names:
                    names[addr] = name
            for path, (kind, addr, name) in found.items():
                if path in known:
                    continue
                try:
                    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
                except OSError:
                    continue
                open_fds[fd] = (path, kind, addr, name)
                emit({"type": "open", "address": addr, "name": name, "node": path, "kind": kind})
        timeout = 0.05 if pending else 0.5
        watch = list(open_fds) + ([monitor] if monitor else [])
        ready = select.select(watch, [], [], timeout)[0] if watch else (time.sleep(timeout) or [])
        if monitor in ready:
            ready.remove(monitor)
            while True:
                try:
                    frame = monitor.recv(4096)
                except BlockingIOError:
                    break
                except OSError:
                    monitor = None
                    emit({"type": "monitor-unavailable"})
                    break
                ev = parse_monitor(frame, handles)
                if not ev:
                    continue
                if ev[0] == "conn":
                    handles[ev[1]] = ev[2]
                elif ev[0] == "disc":
                    handles.pop(ev[1], None)
                else:
                    _, hci, att, value = ev
                    if hci not in handles:
                        handles.update(connection_handles())
                    addr = handles.get(hci)
                    if addr in names:  # only remotes we read; never HR straps etc.
                        emit({"type": "gatt", "address": addr, "name": names[addr],
                              "att": att, "value": value.hex()})
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
