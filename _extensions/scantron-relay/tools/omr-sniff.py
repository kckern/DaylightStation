#!/usr/bin/env python3
"""
omr-sniff.py — RS-232 protocol discovery for the Chatsworth Data OMR-1100.

Runs on a Linux host with the reader's DB9 on a USB-serial adapter (the Keyspan
USA-19H works there; it does NOT work on Apple silicon — see ../README.md).

Exists so protocol discovery does not depend on the ATOM firmware. Once the
baud/framing and frame layout are known they get locked into scantrons.yml and
the ATOM takes over as the permanent relay.

DESIGN NOTE — bytes are streamed to disk the instant they arrive, and every
capture prints live. An earlier version buffered in RAM for a fixed window,
which meant you could not inspect a run in progress and killing it destroyed the
data. Never do that again: a capture must be safe to Ctrl-C at any moment.

Usage
-----
  # tail the line forever, printing bytes as they land (Ctrl-C when done)
  ./omr-sniff.py --port /dev/ttyUSB1 --baud 9600

  # check the physical link BEFORE blaming baud (see --lines below)
  ./omr-sniff.py --port /dev/ttyUSB1 --lines

  # sweep the documented range, short dwells
  ./omr-sniff.py --port /dev/ttyUSB1 --sweep --seconds 8

Diagnostic rule of thumb
------------------------
  garbage bytes  -> wiring is FINE, baud/framing is wrong  -> sweep
  zero bytes     -> wiring/power/paper problem, NOT baud   -> do not sweep
Wrong baud still yields bytes, because the UART samples regardless. Total
silence means no transitions reached RX at all.
"""

import argparse
import os
import sys
import time

try:
    import serial
except ImportError:
    sys.exit("pyserial missing:  pip3 install pyserial   (or apt install python3-serial)")

BAUDS = [9600, 2400, 4800, 1200, 19200, 38400, 300]
FRAMINGS = ["8N1", "7E1"]

FRAMING_MAP = {
    "8N1": (serial.EIGHTBITS, serial.PARITY_NONE, serial.STOPBITS_ONE),
    "7E1": (serial.SEVENBITS, serial.PARITY_EVEN, serial.STOPBITS_ONE),
    "7O1": (serial.SEVENBITS, serial.PARITY_ODD, serial.STOPBITS_ONE),
    "8E1": (serial.EIGHTBITS, serial.PARITY_EVEN, serial.STOPBITS_ONE),
}


def ascii_score(buf):
    """Fraction of bytes plausible in a text record (0.0-1.0)."""
    if not buf:
        return 0.0
    good = sum(1 for b in buf if 32 <= b <= 126 or b in (0x0A, 0x0D, 0x09, 0x02, 0x03))
    return good / len(buf)


def render(buf, base=0, width=16):
    out = []
    for off in range(0, len(buf), width):
        chunk = buf[off:off + width]
        hexs = " ".join("%02x" % b for b in chunk).ljust(width * 3 - 1)
        text = "".join(chr(b) if 32 <= b <= 126 else "." for b in chunk)
        out.append("  %04x  %s  |%s|" % (base + off, hexs, text))
    return "\n".join(out)


def open_port(port, baud, framing):
    bits, parity, stop = FRAMING_MAP[framing]
    return serial.Serial(
        port=port, baudrate=baud, bytesize=bits, parity=parity,
        stopbits=stop, timeout=0.2,
        # Never require flow control: the reader may be wired without handshake
        # lines, and demanding them is a classic false "it's dead".
        rtscts=False, dsrdtr=False, xonxoff=False,
    )


def probe_lines(port):
    """Report modem control line states — distinguishes 'nothing connected'
    from 'connected but not transmitting'."""
    with open_port(port, 9600, "8N1") as ser:
        print("port open: %s" % ser.name)
        print("\ncontrol lines (inputs from the reader):")
        for _ in range(3):
            print("  CTS=%-5s DSR=%-5s CD=%-5s RI=%s" % (ser.cts, ser.dsr, ser.cd, ser.ri))
            time.sleep(0.4)
        print("\nasserting DTR+RTS (fake a 'ready host' for handshake-gated devices)...")
        ser.dtr = True
        ser.rts = True
        time.sleep(0.6)
        print("  CTS=%-5s DSR=%-5s CD=%-5s RI=%s" % (ser.cts, ser.dsr, ser.cd, ser.ri))
        got = ser.read(4096)
        print("  bytes after assert: %d" % len(got))
        if got:
            print(render(got[:256]))
        print("\nIf every line reads False and no bytes ever arrive, suspect:")
        print("  - TX/RX swap  -> swap DB9 pins 2<->3")
        print("  - missing common ground")
        print("  - DB9 not actually seated on the reader")


def stream(port, baud, framing, seconds, out_path):
    """Tail the port, printing and flushing to disk as bytes arrive."""
    total = 0
    fh = open(out_path, "ab", buffering=0) if out_path else None
    deadline = (time.time() + seconds) if seconds else None
    try:
        with open_port(port, baud, framing) as ser:
            ser.reset_input_buffer()
            print("listening on %s @ %d %s%s" % (
                port, baud, framing,
                (" for %gs" % seconds) if seconds else " (Ctrl-C to stop)"))
            if out_path:
                print("streaming to %s" % out_path)
            print("-" * 60)
            while deadline is None or time.time() < deadline:
                chunk = ser.read(4096)
                if not chunk:
                    continue
                if fh:
                    fh.write(chunk)
                print(render(chunk, base=total))
                sys.stdout.flush()
                total += len(chunk)
    except KeyboardInterrupt:
        print("\n(interrupted)")
    finally:
        if fh:
            fh.close()
    print("-" * 60)
    print("total: %d bytes" % total)
    return total


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", default="/dev/ttyUSB1")
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--framing", default="8N1", choices=sorted(FRAMING_MAP))
    ap.add_argument("--seconds", type=float, default=0,
                    help="dwell; 0 = run until Ctrl-C (default)")
    ap.add_argument("--sweep", action="store_true", help="cycle documented bauds x framings")
    ap.add_argument("--lines", action="store_true", help="probe modem control lines and exit")
    ap.add_argument("--out", default="/root/omr/captures", help="capture directory")
    args = ap.parse_args()

    if not os.path.exists(args.port):
        sys.exit("no such port: %s" % args.port)

    if args.lines:
        probe_lines(args.port)
        return 0

    if args.out:
        os.makedirs(args.out, exist_ok=True)

    if args.sweep:
        dwell = args.seconds or 8
        combos = [(b, f) for f in FRAMINGS for b in BAUDS]
        print("sweeping %d settings x %gs -- FEED A SHEET IN EVERY WINDOW\n" % (len(combos), dwell))
        results = []
        for baud, framing in combos:
            path = os.path.join(args.out, "sweep-%d-%s.bin" % (baud, framing))
            n = stream(args.port, baud, framing, dwell, path)
            if n:
                data = open(path, "rb").read()
                results.append((ascii_score(data), baud, framing, n))
            print()
        print("=" * 60)
        if not results:
            print("NO BYTES AT ANY SETTING -> physical problem, not baud.")
            print("  - swap DB9 pins 2<->3 (TX/RX)")
            print("  - verify common ground")
            print("  - confirm the sheet is a REAL OMR form with a timing track")
            print("  - jumper 4<->6 and 7<->8 to defeat a handshake stall")
        else:
            for score, baud, framing, n in sorted(results, reverse=True):
                print("  %5d %s  %5d bytes  ascii=%.0f%%" % (baud, framing, n, score * 100))
        return 0

    ts = int(time.time())
    path = os.path.join(args.out, "omr1100-%d-%s-%d.bin" % (args.baud, args.framing, ts)) if args.out else None
    stream(args.port, args.baud, args.framing, args.seconds, path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
