#!/usr/bin/env python3
"""
omr-listen.py — ENABLE the OMR-1100 and stream scan data.

Protocol facts established 2026-07-21 by omr-query.py against the real unit
(firmware "OMR-1100 - Version 1.04, Wed Oct 2 1996"):
  - Serial: 9600 baud, 7E1 (even parity) — confirmed, not guessed.
  - Command framing: Ctrl-R ESC <cmd> Ctrl-R E  (0x12 0x1b ... 0x12 0x45).
  - Responses are CR-terminated, followed by "G" CR (ack/prompt).
  - GETCONFIG on this unit: "22 00 80 EVEINL80 1.5" (flags 00 = no flow
    control, no feed control; bottom timing; inline; 80% threshold).
  - Power-on STATUS is 0: bit5 "transport enabled" = 0. The reader will move
    a card but reads nothing until the host sends ENABLE. This was the entire
    cause of the zero-byte mystery.

This tool sends ENABLE (non-persistent; cleared by power cycle) plus the
read-only STATUS query, then streams every received byte to disk and stdout,
Ctrl-C safe. It never sends EEPROM-writing commands.
"""

import os
import sys
import time

try:
    import serial
except ImportError:
    sys.exit("pyserial missing:  pip3 install pyserial")

CTRL_R = b"\x12"
ESC = b"\x1b"


def frame(cmd):
    return CTRL_R + ESC + cmd + CTRL_R + b"E"


def download(cmd):
    # Download-command framing per OMR-1102 Technical Manual §6: Ctrl-R,
    # command string, Ctrl-R, "E" — note NO ESC, unlike the factory command
    # set. Modes are VOLATILE: cleared at power-off, must be re-sent after
    # every power cycle. "G"<CR> = accepted, "...?"<CR> = rejected.
    return CTRL_R + cmd + CTRL_R + b"E"


def render(buf, base=0, width=16):
    out = []
    for off in range(0, len(buf), width):
        chunk = buf[off:off + width]
        hexs = " ".join("%02x" % b for b in chunk).ljust(width * 3 - 1)
        text = "".join(chr(b) if 32 <= b <= 126 else "." for b in chunk)
        out.append("  %04x  %s  |%s|" % (base + off, hexs, text))
    return "\n".join(out)


def main():
    port = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB1"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "/root/omr/captures"
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "scan-%d.bin" % int(time.time()))

    ser = serial.Serial(port=port, baudrate=9600, bytesize=serial.SEVENBITS,
                        parity=serial.PARITY_EVEN, stopbits=serial.STOPBITS_ONE,
                        timeout=0.2, rtscts=False, dsrdtr=False, xonxoff=False)
    ser.dtr = True
    ser.rts = True
    time.sleep(0.2)

    # THE FIX (found in OMR-1102 Technical Manual §5-6, 2026-07-21): the
    # reader powers up with NO conversion mode active, so scans translate
    # zero columns and emit nothing. Download Binary-to-ASCII mode for all
    # columns: 2 bytes/column, values 32-127, CR-terminated per card.
    ser.write(download(b"I00"))
    ser.flush()
    time.sleep(0.5)
    ack = ser.read(64)
    print("I00 (binary mode, all columns) ack: %s  %s" % (
        " ".join("%02x" % b for b in ack) or "(none)",
        "-- ACCEPTED" if b"G" in ack else "-- NOT ACCEPTED, expect no data"))
    print("listening on %s @ 9600 7E1 — streaming to %s (Ctrl-C safe)" % (port, path))
    print("-" * 60)
    sys.stdout.flush()

    total = 0
    fh = open(path, "ab", buffering=0)
    try:
        while True:
            chunk = ser.read(4096)
            if not chunk:
                continue
            fh.write(chunk)
            print(render(chunk, base=total))
            sys.stdout.flush()
            total += len(chunk)
    except KeyboardInterrupt:
        print("\n(interrupted)")
    finally:
        fh.close()
        ser.close()
    print("total: %d bytes" % total)


if __name__ == "__main__":
    main()
