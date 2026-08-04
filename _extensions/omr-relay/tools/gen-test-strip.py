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

The `--thermal` variant is deliberately different: it produces a 1-bit PNG
whose pixels are native 8 dots/mm (203 dpi), the density published for the
Volcora 80 mm printer.  It has no outline or instructions: only marks that can
pass through the reader.  The paper is 79.5 mm rather than the nominal 82.55 mm
card width, but the furthest data mark ends at 77.8 mm, so it remains on stock.
Do NOT rescale this PNG in the print path.  Sending its 636 x 2032 pixels as an
ESC/POS raster image is the calibration test; if the printer clips it, that is
useful evidence that it cannot make OMR cards.

Usage:
  python3 gen-test-strip.py [out.pdf]
  python3 gen-test-strip.py --thermal [out.png]
  python3 gen-test-strip.py --thermal-bubbles [out.png]
  python3 gen-test-strip.py --thermal-blank-form [out.png]
"""

import sys
import zlib
import struct

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

# Volcora 80 mm receipt stock / print density.  Every OMR measurement below is
# rounded only once, to native dots; the adapter must not resize this raster.
THERMAL_DOTS_PER_MM = 8
THERMAL_PAPER_MM = 79.5
THERMAL_WIDTH = round(THERMAL_PAPER_MM * THERMAL_DOTS_PER_MM)  # 636 dots
THERMAL_HEIGHT = round(10 * 25.4 * THERMAL_DOTS_PER_MM)        # 2032 dots
# The Volcora feeds 80 mm stock but its thermal head prints 72 mm (576 dots).
# This is the real limit observed in the clipped first attempt, not the paper
# width advertised on the roll.
THERMAL_PRINTABLE_WIDTH = 576


def thermal_dot(inches):
    return round(inches * 25.4 * THERMAL_DOTS_PER_MM)


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


def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)


def build_thermal_png(path):
    """Write the unscaled 80 mm / 8-dot-per-mm OMR raster test strip."""
    # PNG grayscale: 0 = black mark, 255 = untouched receipt paper.
    pixels = [bytearray([255]) * THERMAL_WIDTH for _ in range(THERMAL_HEIGHT)]

    def mark(cx, cy):
        # Tick/data mark: 0.125 in across the width, 0.060 in along feed.
        half_w = thermal_dot(0.125) / 2
        half_h = thermal_dot(0.060) / 2
        x0, x1 = max(0, round(cx - half_w)), min(THERMAL_WIDTH, round(cx + half_w))
        y0, y1 = max(0, round(cy - half_h)), min(THERMAL_HEIGHT, round(cy + half_h))
        for y in range(y0, y1):
            pixels[y][x0:x1] = b'\x00' * (x1 - x0)

    # The printer feeds the top (leading edge) first.  Its strobe edge is the
    # left paper edge; data row 12 is still safely inside 79.5 mm stock.
    first_tick = thermal_dot(0.375)
    pitch = thermal_dot(0.250)
    x_strobe = 0
    y = first_tick
    column = 0
    while y <= THERMAL_HEIGHT - thermal_dot(0.250):
        mark(x_strobe + thermal_dot(0.125) / 2, y)
        if column < ((THERMAL_HEIGHT - thermal_dot(0.250) - first_tick) // pitch + 1) - BLANK_TAIL:
            row = (column % 12) + 1
            mark(thermal_dot(0.250) * row, y)
        y += pitch
        column += 1

    scanlines = b''.join(b'\x00' + bytes(row) for row in pixels)
    png = (
        b'\x89PNG\r\n\x1a\n'
        + png_chunk(b'IHDR', struct.pack(">IIBBBBB", THERMAL_WIDTH, THERMAL_HEIGHT, 8, 0, 0, 0, 0))
        + png_chunk(b'IDAT', zlib.compress(scanlines, 9))
        + png_chunk(b'IEND', b'')
    )
    with open(path, "wb") as fh:
        fh.write(png)
    print("wrote %s (%d bytes, %dx%d at %d dots/mm)" % (path, len(png), THERMAL_WIDTH, THERMAL_HEIGHT, THERMAL_DOTS_PER_MM))


def build_thermal_bubble_png(path):
    """Write a native-density comparison of filled and outline-only bubbles.

    Columns 1--4 are timing-only controls.  Columns 5--28 are twelve pairs,
    one pair per data row from the timing edge outward: the first is filled,
    the second is an identical bubble with a completely white interior.
    Remaining columns are timing-only controls.  Thus an outline being read is
    visible as a mark in each second column of a pair.
    """
    pixels = [bytearray([255]) * THERMAL_WIDTH for _ in range(THERMAL_HEIGHT)]

    def black_rect(cx, cy, width, height):
        x0, x1 = max(0, round(cx - width / 2)), min(THERMAL_WIDTH, round(cx + width / 2))
        y0, y1 = max(0, round(cy - height / 2)), min(THERMAL_HEIGHT, round(cy + height / 2))
        for y in range(y0, y1):
            pixels[y][x0:x1] = b'\x00' * (x1 - x0)

    def bubble(cx, cy, filled):
        # An ellipse exactly as tall/wide as the calibrated mark rectangle.  A
        # two-dot black rim leaves an unmistakably white interior in the empty
        # sample without moving its centre away from a reader mark position.
        rx, ry = thermal_dot(0.125) / 2, thermal_dot(0.060) / 2
        inner_rx, inner_ry = rx - 2, ry - 2
        for y in range(max(0, round(cy - ry)), min(THERMAL_HEIGHT, round(cy + ry) + 1)):
            for x in range(max(0, round(cx - rx)), min(THERMAL_WIDTH, round(cx + rx) + 1)):
                outer = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
                inner = inner_rx > 0 and inner_ry > 0 and ((x - cx) / inner_rx) ** 2 + ((y - cy) / inner_ry) ** 2 < 1
                if outer and (filled or not inner):
                    pixels[y][x] = 0

    first_tick = thermal_dot(0.375)
    pitch = thermal_dot(0.250)
    tick_width, tick_height = thermal_dot(0.125), thermal_dot(0.060)
    y = first_tick
    column = 1
    while y <= THERMAL_HEIGHT - thermal_dot(0.250):
        black_rect(tick_width / 2, y, tick_width, tick_height)
        pair_index = column - 5
        if 0 <= pair_index < 24:
            row = pair_index // 2 + 1
            bubble(thermal_dot(0.250) * row, y, filled=(pair_index % 2 == 0))
        y += pitch
        column += 1

    scanlines = b''.join(b'\x00' + bytes(row) for row in pixels)
    png = (
        b'\x89PNG\r\n\x1a\n'
        + png_chunk(b'IHDR', struct.pack(">IIBBBBB", THERMAL_WIDTH, THERMAL_HEIGHT, 8, 0, 0, 0, 0))
        + png_chunk(b'IDAT', zlib.compress(scanlines, 9))
        + png_chunk(b'IEND', b'')
    )
    with open(path, "wb") as fh:
        fh.write(png)
    print("wrote %s (%d bytes, filled/outline bubble comparison)" % (path, len(png)))


def build_thermal_blank_form_png(path):
    """Write a blank, fillable 7-digit / 50-answer H45070-style OMR card.

    It is a deliberate 72 mm thermal-printer crop of the 3.25 in card:
      columns 1--7: ten digit bubbles each (0--9),
      columns 8--32: upper A--E bubbles for questions 1--25 and lower A--E
                      positions for questions 26--50.  The lower E position is
                      omitted: it is physically beyond the printer's head.

    Tick positions and thickness are measured from the supplied H45070-0 image:
    0.171 in centres and 0.070 in along feed (not the 0.250 in generic test
    strip pitch).  The bracket ink remains outside the central pencil/read cell.
    """
    width = THERMAL_PRINTABLE_WIDTH
    height = round(7.375 * 25.4 * THERMAL_DOTS_PER_MM)
    pixels = [bytearray([255]) * width for _ in range(height)]

    def black_rect(cx, cy, width, height):
        x0, x1 = max(0, round(cx - width / 2)), min(len(pixels[0]), round(cx + width / 2))
        y0, y1 = max(0, round(cy - height / 2)), min(len(pixels), round(cy + height / 2))
        for y in range(y0, y1):
            pixels[y][x0:x1] = b'\x00' * (x1 - x0)

    def bracket_cell(cx, cy):
        # [   ] rails and arms are wholly outside the central 0.125 x 0.070 in
        # pencil/read window.  The reader should see a fill only when pencil
        # darkens that empty central cell.
        rail_x = thermal_dot(0.080)
        rail_half_y = thermal_dot(0.060)
        arm = thermal_dot(0.022)
        stroke = 2
        black_rect(cx - rail_x, cy, stroke, rail_half_y * 2)
        black_rect(cx + rail_x, cy, stroke, rail_half_y * 2)
        for yy in (cy - rail_half_y, cy + rail_half_y):
            black_rect(cx - rail_x + arm / 2, yy, arm, stroke)
            black_rect(cx + rail_x - arm / 2, yy, arm, stroke)

    tick_width, tick_height = thermal_dot(0.125), thermal_dot(0.070)
    pitch = thermal_dot(0.171)
    id_ys = [thermal_dot(0.840) + i * pitch for i in range(7)]
    answer_ys = [thermal_dot(2.740) + i * pitch for i in range(25)]
    for column, y in enumerate(id_ys + answer_ys, start=1):
        black_rect(tick_width / 2, y, tick_width, tick_height)
        if column <= 7:
            # Ten digit positions fit through 2.750 in; no horizontal scaling.
            for digit in range(10):
                bracket_cell(thermal_dot(0.500 + digit * 0.250), y)
        else:
            # Questions 1--25 have A--E.  Questions 26--50 retain A--D; E at
            # 3.000 in is beyond a 72 mm / 2.835 in thermal printhead.
            for index in range(5):
                bracket_cell(thermal_dot(0.500 + index * 0.250), y)
            for index in range(4):
                bracket_cell(thermal_dot(2.000 + index * 0.250), y)

    scanlines = b''.join(b'\x00' + bytes(row) for row in pixels)
    png = (
        b'\x89PNG\r\n\x1a\n'
        + png_chunk(b'IHDR', struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
        + png_chunk(b'IDAT', zlib.compress(scanlines, 9))
        + png_chunk(b'IEND', b'')
    )
    with open(path, "wb") as fh:
        fh.write(png)
    print("wrote %s (%d bytes, cropped 7-digit / 50-answer OMR form)" % (path, len(png)))


if __name__ == "__main__":
    if sys.argv[1:2] == ["--thermal"]:
        build_thermal_png(sys.argv[2] if len(sys.argv) > 2 else "omr1100-test-strip-80mm.png")
    elif sys.argv[1:2] == ["--thermal-bubbles"]:
        build_thermal_bubble_png(sys.argv[2] if len(sys.argv) > 2 else "omr1100-bubble-test-strip-80mm.png")
    elif sys.argv[1:2] == ["--thermal-blank-form"]:
        build_thermal_blank_form_png(sys.argv[2] if len(sys.argv) > 2 else "omr1100-blank-form-80mm.png")
    else:
        build_pdf(sys.argv[1] if len(sys.argv) > 1 else "omr1100-test-strip.pdf")
