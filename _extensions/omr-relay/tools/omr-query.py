#!/usr/bin/env python3
"""
omr-query.py — READ-ONLY interrogation of the Chatsworth Data OMR-1100.

Uses the documented command set from "OMR1100 Commands Rev. B" (Chatsworth Data
Corporation, recovered via web.archive.org from omrsys.com/pdf_doc_files/).
Command framing:  Ctrl-R  ESC  <command>  Ctrl-R  E
                  0x12    0x1b  ...       0x12    0x45

SAFETY: this tool sends ONLY read-only queries plus XON:
    XON (0x11)   — releases the reader if it is XOFF-blocked; changes nothing
    GETCONFIG    — returns baud code, EEPROM flags byte, timing, parity, threshold
    GETTBLS      — returns threshold + decay
    S            — returns 8-bit status byte
    V            — returns firmware version string
It NEVER sends SETBAUD / SETFLAGS / SETPARITY / PROGRAM / SETFACTORY / RESET /
SHOE or any other command that writes EEPROM or moves the transport. Those exist
in the command set and must only be sent deliberately, with the user's approval.

The reader's factory example config is EVEN parity ("EVEINL80"), so queries are
tried at 7E1 first, then 8N1, then 8E1, at 9600 baud (GETCONFIG example shows
baud code 2 = 9600 as the shipped rate) and then the rest of the documented
range. Any response at all also tells us the TXD path is electrically alive.
"""

import sys
import time

try:
    import serial
except ImportError:
    sys.exit("pyserial missing:  pip3 install pyserial")

CTRL_R = b"\x12"
ESC = b"\x1b"
XON = b"\x11"

FRAMING_MAP = {
    "7E1": (serial.SEVENBITS, serial.PARITY_EVEN, serial.STOPBITS_ONE),
    "8N1": (serial.EIGHTBITS, serial.PARITY_NONE, serial.STOPBITS_ONE),
    "8E1": (serial.EIGHTBITS, serial.PARITY_EVEN, serial.STOPBITS_ONE),
}

# Documented read-only queries (OMR1100 Commands Rev. B, items 6, 7, 21, 22).
QUERIES = [
    ("GETCONFIG", b"GETCONFIG"),
    ("GETTBLS", b"GETTBLS"),
    ("STATUS", b"S"),
    ("VERSION", b"V"),
]


def frame(cmd_bytes):
    return CTRL_R + ESC + cmd_bytes + CTRL_R + b"E"


def render(buf):
    hexs = " ".join("%02x" % b for b in buf)
    text = "".join(chr(b) if 32 <= b <= 126 else "." for b in buf)
    return "%s  |%s|" % (hexs, text)


def drain(ser, quiet=0.6, overall=3.0):
    """Read until the line goes quiet or the overall window expires."""
    buf = bytearray()
    start = time.time()
    last = start
    while time.time() - start < overall:
        chunk = ser.read(512)
        if chunk:
            buf += chunk
            last = time.time()
        elif buf and time.time() - last > quiet:
            break
    return bytes(buf)


def interrogate(port, baud, framing):
    bits, parity, stop = FRAMING_MAP[framing]
    got_any = False
    with serial.Serial(port=port, baudrate=baud, bytesize=bits, parity=parity,
                       stopbits=stop, timeout=0.2,
                       rtscts=False, dsrdtr=False, xonxoff=False) as ser:
        ser.dtr = True   # look like a ready host
        ser.rts = True   # satisfies RTS/CTS-gated output if configured
        time.sleep(0.3)

        # Anything buffered from a previous scan? XON releases XOFF-blocked
        # output. Do NOT flush the input buffer first — buffered data is gold.
        ser.write(XON)
        ser.flush()
        pre = drain(ser, overall=1.5)
        if pre:
            got_any = True
            print("  [%d %s] after XON: %d bytes" % (baud, framing, len(pre)))
            print("    " + render(pre))

        for name, cmd in QUERIES:
            ser.write(frame(cmd))
            ser.flush()
            resp = drain(ser)
            if resp:
                got_any = True
                print("  [%d %s] %s -> %d bytes" % (baud, framing, name, len(resp)))
                print("    " + render(resp))
            else:
                print("  [%d %s] %s -> no response" % (baud, framing, name))
    return got_any


def main():
    port = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB1"
    # 9600 is the documented shipped rate; try it in all framings before
    # walking the rest of the documented range.
    for baud in (9600, 19200, 38400, 4800, 2400, 1200, 600, 300):
        for framing in ("7E1", "8N1", "8E1"):
            print("== %d %s ==" % (baud, framing))
            if interrogate(port, baud, framing):
                print("\nRESPONSE OBTAINED at %d %s — TXD path is alive." % (baud, framing))
                return 0
    print("\nNo response to any read-only query at any baud/framing.")
    print("The reader's TXD is not reaching this host's RXD (cable pin issue),")
    print("or its receiver never saw the queries (RXD toward reader broken).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
