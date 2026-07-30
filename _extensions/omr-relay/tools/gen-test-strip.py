#!/usr/bin/env python3
"""
gen-test-strip.py — generate a printable Chatsworth OMR-1100 test strip PDF.

Geometry follows the recovered document specification (OMR-1102 Technical
Manual, Appendix A — docs/recovered/omr1102_techmanual.pdf), which also governs
the OMR-1100:

  - card 3.250" wide, strip here is 10" long (spec allows 5"-14")
  - strobe (timing) ticks: solid black, flush to one long edge, 0.125" tall
    (across the width), 0.060" thick (along the length; spec minimum 0.030"),
    on 0.250" centers, first tick 0.375" from the leading edge (spec >=0.250"),
    last tick >=0.250" from the trailing edge
  - leading 0.125" of the card completely unprinted (media-detect zone)
  - 12 data rows; row centerlines at 0.250" increments from the strobe edge,
    top row centerline 0.250" from the far edge
  - data marks share each tick's column position (inline timing) and are the
    same 0.060" length; 0.125" tall

Printed pattern: a walking diagonal — column k carries exactly one mark, in row
((k) mod 12) + 1 — with the last two columns left blank. In the reader's
Binary-to-ASCII mode (I00) each column returns two bytes (0x20-0x7F, bit6 of
byte1 forced high), so the expected stream is a rolling single-bit walk ending
in "  " (two spaces) pairs, terminated by CR. Unmistakable.

Output PDF is one US-Letter page. PRINT AT 100% / ACTUAL SIZE (never
"fit to page") on plain 20-24 lb paper, then cut on the solid outline.

Usage:  python3 gen-test-strip.py [out.pdf]
"""

import sys
import zlib

PT = 72.0  # points per inch

# Strip placement on the letter page (612 x 792 pt)
X0 = 0.5 * PT            # strobe edge (left edge of strip)
W = 3.25 * PT            # card width
Y_BOT = 0.5 * PT         # trailing edge
Y_TOP = 10.5 * PT        # leading edge (top of page feeds first)

TICK_H = 0.125 * PT      # across width
TICK_T = 0.060 * PT      # along length
PITCH = 0.250 * PT
FIRST_TICK = 0.375 * PT  # center distance from leading edge
ROW_PITCH = 0.250 * PT
BLANK_TAIL = 2           # trailing blank columns


def rect(x, y, w, h):
    return "%.2f %.2f %.2f %.2f re f\n" % (x, y, w, h)


def build_content():
    c = []
    c.append("0 g\n")

    # Column tick centers, walking down from the leading (top) edge.
    ys = []
    y = Y_TOP - FIRST_TICK
    while y >= Y_BOT + 0.250 * PT:
        ys.append(y)
        y -= PITCH

    for k, yc in enumerate(ys):
        # strobe tick flush to the left (strobe) edge
        c.append(rect(X0, yc - TICK_T / 2, TICK_H, TICK_T))
        # diagonal data mark: one row per column, last BLANK_TAIL columns empty
        if k < len(ys) - BLANK_TAIL:
            row = (k % 12) + 1                      # 1 = nearest strobe edge
            xc = X0 + ROW_PITCH * row
            c.append(rect(xc - TICK_H / 2, yc - TICK_T / 2, TICK_H, TICK_T))

    # Strip outline (cut line) — thin, outside-safe
    c.append("0.4 w 0 G %.2f %.2f %.2f %.2f re S\n" % (X0, Y_BOT, W, Y_TOP - Y_BOT))

    # Instructions, right of the strip (never printed on the card itself)
    tx = X0 + W + 0.35 * PT
    lines = [
        (10.3, 12, "CHATSWORTH OMR-1100 TEST STRIP"),
        (10.0, 9, "Print at 100%% / Actual Size - NEVER 'fit to page'."),
        (9.8, 9, "Cut precisely on the solid outline (width must be 3-1/4\")."),
        (9.4, 10, "FEED: this top end goes in FIRST."),
        (9.2, 10, "Ticks toward the timing sensor (left side),"),
        (9.0, 10, "printed face toward the red glow."),
        (8.6, 9, "Pattern: walking diagonal, 1 mark per column,"),
        (8.4, 9, "last 2 columns blank. Binary mode I00 returns"),
        (8.2, 9, "2 bytes/column (0x20-0x7F), CR-terminated."),
        (7.8, 9, "Geometry: ticks 0.125 x 0.060 in, 0.250 in centers,"),
        (7.6, 9, "first tick 0.375 in from leading edge; 12 rows at"),
        (7.4, 9, "0.250 in centerlines from strobe edge."),
        (7.0, 9, "Spec: omr1102_techmanual.pdf Appendix A"),
        (6.8, 9, "(docs/recovered/, via web.archive.org)"),
    ]
    for yin, size, s in lines:
        s = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        c.append("BT /F1 %d Tf %.2f %.2f Td (%s) Tj ET\n" % (size, tx, yin * PT, s))

    # Leading-end arrow beside the strip
    ax = X0 + W + 0.15 * PT
    c.append("1.5 w 0 G %.2f %.2f m %.2f %.2f l S\n" % (ax, 9.9 * PT, ax, 10.45 * PT))
    c.append("%.2f %.2f m %.2f %.2f l %.2f %.2f l S\n" % (
        ax - 4, 10.35 * PT, ax, 10.45 * PT, ax + 4, 10.35 * PT))

    return "".join(c).encode("latin-1")


def build_pdf(path):
    content = build_content()
    stream = zlib.compress(content)

    objs = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>")
    objs.append(b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(stream)
                + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref_at = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1)
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += (b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
            % (len(objs) + 1, xref_at))

    with open(path, "wb") as fh:
        fh.write(bytes(out))
    print("wrote %s (%d bytes)" % (path, len(out)))


if __name__ == "__main__":
    build_pdf(sys.argv[1] if len(sys.argv) > 1 else "omr1100-test-strip.pdf")
