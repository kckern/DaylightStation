#!/usr/bin/env python3
"""
omr-decode.py — decode Chatsworth OMR-1100 Binary-to-ASCII records.

Format (OMR-1102 Technical Manual §6.1.3, docs/recovered/):
  - one record per scanned card, terminated by <CR> (0x0D)
  - two bytes per column; bit5 (0x20) is forced high so a blank column reads
    0x20 0x20, keeping every byte printable (0x20-0x7F)
  - byte 1 carries the six rows on one side of the card, byte 2 the other six

      byte 1: bit0=row12  bit1=row11  bit2=row0  bit3=row1  bit4=row2  bit6=row3
      byte 2: bit0=row4   bit1=row5   bit2=row6  bit3=row7  bit4=row8  bit6=row9

Row names are Hollerith (12, 11, 0, 1..9 from the far edge toward the strobe
edge), so row 9 is the channel nearest the timing track.

Usage:  python3 omr-decode.py capture.bin
"""

import sys

# (label, byte index, bit mask) in physical top-to-bottom order; the strobe
# edge is at the bottom, so row 9 is the channel closest to the timing track.
ROWS = [
    ("12", 0, 0x01), ("11", 0, 0x02), ("0", 0, 0x04),
    ("1", 0, 0x08), ("2", 0, 0x10), ("3", 0, 0x40),
    ("4", 1, 0x01), ("5", 1, 0x02), ("6", 1, 0x04),
    ("7", 1, 0x08), ("8", 1, 0x10), ("9", 1, 0x40),
]


def decode_record(rec):
    """-> list of columns, each a set of marked row labels."""
    cols = []
    for i in range(0, len(rec) - 1, 2):
        b1, b2 = rec[i], rec[i + 1]
        pair = (b1, b2)
        marks = {label for label, idx, mask in ROWS if pair[idx] & mask}
        cols.append(marks)
    return cols


def render(cols):
    out = []
    width = len(cols)
    tens = "      " + "".join(str((c + 1) // 10 % 10) if (c + 1) % 10 == 0 else " "
                              for c in range(width))
    ones = "      " + "".join(str((c + 1) % 10) for c in range(width))
    out.append(tens)
    out.append(ones)
    for label, _, _ in ROWS:
        line = "  %3s " % label
        line += "".join("#" if label in col else "." for col in cols)
        out.append(line)
    return "\n".join(out)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "/dev/stdin"
    data = open(path, "rb").read()
    if not data:
        sys.exit("empty capture: %s" % path)

    records = [r for r in data.split(b"\x0d") if r]
    print("%s: %d bytes, %d record(s)\n" % (path, len(data), len(records)))

    for n, rec in enumerate(records, 1):
        cols = decode_record(rec)
        marked = sum(1 for c in cols if c)
        blank = sum(1 for c in cols if not c)
        full = sum(1 for c in cols if len(c) == 12)
        print("--- record %d: %d bytes -> %d columns "
              "(%d marked, %d blank, %d all-channel) ---"
              % (n, len(rec), len(cols), marked, blank, full))
        print(render(cols))
        print()
        if len(rec) % 2:
            print("  NOTE: odd byte count — record may be truncated\n")


if __name__ == "__main__":
    main()
