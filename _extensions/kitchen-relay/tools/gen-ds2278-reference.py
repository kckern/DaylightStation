#!/usr/bin/env python3
"""Build the DS2278 quick-reference barcode sheet (vector, no bitmaps).

    python3 tools/gen-ds2278-reference.py /path/to/ds2278-prg-en.pdf

Writes ds2278-quick-reference.{pdf,svg} beside the extension README.

WHY THIS EXISTS
---------------
Re-pairing the kitchen scanner means hunting through a 486-page Product
Reference Guide for four bar codes that live in three different chapters. This
collects them onto one page, in the order you actually scan them.

WHY IT CLIPS INSTEAD OF RE-DRAWING
----------------------------------
Every bar code here except the beeper-volume trio is lifted as VECTOR ARTWORK
straight out of the guide (`show_pdf_page` with a clip rect). Nothing is
re-encoded, so there is no way for a bug in this script to emit a bar code that
scans as something other than what its caption says.

The volume bar codes are the exception: the guide draws them as 141x32 px
images, which is both a bitmap and too coarse to print reliably. Those three are
decoded to their Code 128 symbol values, the mod-103 checksum is verified, and
they are re-drawn as vector. The script then asserts that re-encoding those
values reproduces the original module widths EXACTLY -- if it ever stops
matching, the build fails rather than emitting a bar code nobody verified.

Requires: pymupdf, pillow.
"""
import re
import sys
import os

import fitz
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import code128  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PDF = os.path.join(HERE, "ds2278-quick-reference.pdf")
OUT_SVG = os.path.join(HERE, "ds2278-quick-reference.svg")

# Vector bar codes, located by geometry in the guide and verified by decoding
# (see the module docstring). `page` is the PDF page number, not the printed
# folio -- printed 6-6 is PDF page 104.
VECTOR = {
    "unpair":        dict(page=127, rect=(73.0, 202.6, 277.9, 246.4), folio="6-29"),
    "hid_le":        dict(page=104, rect=(349.3, 498.1, 523.7, 540.6), folio="6-6"),
    "disc_general":  dict(page=109, rect=(115.7, 302.8, 236.6, 338.8), folio="6-11"),
    "disc_limited":  dict(page=109, rect=(376.0, 400.1, 497.0, 436.1), folio="6-11"),
    "restore":       dict(page=63,  rect=(129.5, 408.6, 203.5, 444.6), folio="5-5"),
    "factory":       dict(page=63,  rect=(390.5, 488.6, 464.4, 524.6), folio="5-5"),
}

# Beeper volume: raster in the guide (PDF page 65 / printed 5-7), re-drawn vector.
VOLUME_PAGE = 65
VOLUME_LABELS = ["Low Volume", "Medium Volume", "High Volume"]

PT = 1.0
MARGIN = 46
BAR_H = 40            # printed height of the re-drawn volume bar codes


def volume_symbol_values(doc):
    """Decode the three raster volume bar codes to Code 128 symbol values.

    Returns [(label, values)] and hard-fails unless every checksum verifies AND
    re-encoding reproduces the guide's own module widths exactly.
    """
    page = doc[VOLUME_PAGE - 1]
    imgs = page.get_images(full=True)
    if len(imgs) != 3:
        raise SystemExit(f"expected 3 volume images on PDF page {VOLUME_PAGE}, found {len(imgs)}")

    # Order by vertical position so Low/Medium/High match the guide's layout.
    placed = sorted(
        ((page.get_image_rects(i[0])[0], i[0]) for i in imgs),
        key=lambda t: (round(t[0].y0), t[0].x0),
    )

    out = []
    for (rect, xref), label in zip(placed, VOLUME_LABELS):
        raw = doc.extract_image(xref)
        tmp = os.path.join("/tmp", f"_ds2278_vol_{xref}.{raw['ext']}")
        with open(tmp, "wb") as fh:
            fh.write(raw["image"])
        runs = _runs_from_image(tmp)
        os.unlink(tmp)

        text, err = code128.decode_runs(runs)
        if err:
            raise SystemExit(f"{label}: refusing to emit an unverified bar code -- {err}")

        mods, _ = code128._runs_to_modules(runs)
        values = _values_from_modules(mods)
        regen = []
        for v in values + [code128.STOP]:
            regen.extend(int(c) for c in code128.PATTERNS[v])
        if regen != mods:
            raise SystemExit(f"{label}: re-encode does NOT reproduce the guide's bar code; aborting")

        out.append((label, values, text))
    return out


def _runs_from_image(path):
    im = Image.open(path).convert("L")
    w, h = im.size
    row = im.crop((0, h // 2, w, h // 2 + 1)).load()
    px = [1 if row[x, 0] < 128 else 0 for x in range(w)]
    first = next(i for i, v in enumerate(px) if v)
    last = len(px) - 1 - next(i for i, v in enumerate(reversed(px)) if v)
    px = px[first:last + 1]
    runs, cur, n = [], px[0], 0
    for v in px:
        if v == cur:
            n += 1
        else:
            runs.append(n)
            cur, n = v, 1
    runs.append(n)
    return runs


def _values_from_modules(mods):
    syms, i = [], 0
    while i + 6 <= len(mods):
        if len(mods) - i == 7:
            break
        syms.append("".join(str(m) for m in mods[i:i + 6]))
        i += 6
    return [code128.PATTERNS.index(s) for s in syms]


def draw_code128(page, values, x, y, module=1.0, height=BAR_H):
    """Draw Code 128 bars as filled vector rects, left edge at x, top at y."""
    widths = []
    for v in values + [code128.STOP]:
        widths.extend(int(c) for c in code128.PATTERNS[v])
    cx, is_bar = x, True
    for w in widths:
        if is_bar:
            page.draw_rect(fitz.Rect(cx, y, cx + w * module, y + height),
                           color=None, fill=(0, 0, 0))
        cx += w * module
        is_bar = not is_bar
    return cx - x


def main(src_path):
    src = fitz.open(src_path)
    volumes = volume_symbol_values(src)

    out = fitz.open()
    page = out.new_page(width=612, height=792)

    def text(s, x, y, size=9, bold=False, color=(0, 0, 0)):
        # Base-14 names: "hebo" is Helvetica-Bold ("helv-bold" is not a thing).
        #
        # ASCII ONLY, enforced. The base-14 fonts silently render anything outside
        # Latin-1 as a middle dot, and the first draft of this sheet shipped
        # "Do NOT scan .HID Bluetooth Classic." and "Only if . alone doesn.t
        # work" -- the em-dashes, curly quotes and circled numerals all collapsed
        # to the same character. On a page whose whole job is telling someone
        # which bar code to scan, a mangled instruction is worse than no sheet.
        non_ascii = sorted({c for c in s if ord(c) > 127})
        if non_ascii:
            raise SystemExit(f"non-ASCII {non_ascii} in drawn string {s!r}; base-14 cannot render it")
        page.insert_text((x, y), s, fontsize=size,
                         fontname="hebo" if bold else "helv", color=color)

    def rule(y, x0=MARGIN, x1=612 - MARGIN, color=(0.75, 0.75, 0.75)):
        page.draw_line(fitz.Point(x0, y), fitz.Point(x1, y), color=color, width=0.6)

    def place(key, x, y, caption, note=None):
        """Clip the vector bar code out of the guide at 1:1 scale."""
        spec = VECTOR[key]
        r = fitz.Rect(*spec["rect"])
        dest = fitz.Rect(x, y, x + r.width, y + r.height)
        out[0].show_pdf_page(dest, src, spec["page"] - 1, clip=r)
        text(caption, x, y + r.height + 11, size=8.5, bold=True)
        if note:
            text(note, x, y + r.height + 21, size=7, color=(0.35, 0.35, 0.35))
        text(f"PRG {spec['folio']}", x, y - 4, size=6, color=(0.55, 0.55, 0.55))
        return y + r.height + (30 if note else 22)

    y = MARGIN + 6
    text("Zebra DS2278 - kitchen-relay quick reference", MARGIN, y, size=14, bold=True)
    y += 14
    text("Bar codes lifted from the DS2278 Product Reference Guide (MN-002915). "
         "Scan them straight off this page.", MARGIN, y, size=8, color=(0.3, 0.3, 0.3))
    y += 20

    # ---- 1. re-bond ------------------------------------------------------
    rule(y); y += 14
    text("1. Re-bond the scanner to a relay board", MARGIN, y, size=11, bold=True)
    y += 11
    text("Do this after moving the gun to a different ESP32. A BLE bond is stored per-host: the "
         "old board's bond does NOT transfer.", MARGIN, y, size=7.5, color=(0.3, 0.3, 0.3))
    y += 8
    text("Scan TOP first, then BOTTOM. Then power-cycle the relay and watch its /status for "
         "barcode.connected: true.", MARGIN, y + 8, size=7.5, color=(0.3, 0.3, 0.3))
    y += 26

    y2 = place("unpair", MARGIN, y,
               "[1] Unpairing",
               "Drops the old host. Safe even if nothing is paired.")
    place("hid_le", MARGIN + 250, y,
          "[2] HID Bluetooth Low Energy (Discoverable)",
          "Puts the gun back in BLE HID mode + advertising.")
    y = y2 + 4

    text('Do NOT scan "HID Bluetooth Classic" (it sits just above [2] in the guide, PRG 6-6). '
         'It switches the gun to Classic BT,', MARGIN, y, size=7.5, color=(0.6, 0.1, 0.1))
    text("which the NimBLE firmware cannot see at all - the relay will simply never find it.",
         MARGIN, y + 9, size=7.5, color=(0.6, 0.1, 0.1))
    y += 24

    # ---- 2. discoverability ---------------------------------------------
    rule(y); y += 14
    text("2. Discoverable mode", MARGIN, y, size=11, bold=True)
    y += 11
    text("Only if [2] alone doesn't get it advertising. General is the factory default; Limited "
         "lasts 30 s then stops.", MARGIN, y, size=7.5, color=(0.3, 0.3, 0.3))
    y += 20
    y2 = place("disc_general", MARGIN, y, "General Discoverable Mode", "default")
    place("disc_limited", MARGIN + 250, y, "Limited Discoverable Mode", "30 s window, then off")
    y = y2 + 4

    # ---- 3. volume -------------------------------------------------------
    rule(y); y += 14
    text("3. Beeper volume", MARGIN, y, size=11, bold=True)
    y += 11
    text("Re-drawn as vector from the guide's bitmaps; symbol values and mod-103 checksums "
         "verified identical.", MARGIN, y, size=7.5, color=(0.3, 0.3, 0.3))
    y += 18

    col = MARGIN
    for (label, values, _txt), star in zip(volumes, ["", "", "  (default)"]):
        text("PRG 5-7", col, y - 4, size=6, color=(0.55, 0.55, 0.55))
        draw_code128(page, values, col, y, module=1.0, height=BAR_H)
        text(label + star, col, y + BAR_H + 11, size=8.5, bold=True)
        col += 175
    y += BAR_H + 26

    # ---- 4. reset --------------------------------------------------------
    rule(y); y += 14
    text("4. Reset - last resort", MARGIN, y, size=11, bold=True)
    y += 11
    text("Set Factory Defaults also reverts the host type, so you MUST re-scan [2] afterwards or "
         "the relay will never see the gun.", MARGIN, y, size=7.5, color=(0.6, 0.1, 0.1))
    y += 20
    y2 = place("restore", MARGIN, y, "Restore Defaults", "back to defaults (custom ones if set)")
    place("factory", MARGIN + 250, y, "Set Factory Defaults",
          "clears custom defaults too - then re-scan [2]")
    y = y2 + 6

    rule(y); y += 12
    text("Kitchen relay: _extensions/kitchen-relay | scanner MAC c8:1c:fe:fd:ce:90 | "
         "health at http://<relay-ip>/status",
         MARGIN, y, size=7, color=(0.45, 0.45, 0.45))
    text("Regenerate: python3 tools/gen-ds2278-reference.py <ds2278-prg-en.pdf>",
         MARGIN, y + 9, size=7, color=(0.45, 0.45, 0.45))

    out.save(OUT_PDF, garbage=4, deflate=True)

    # Round every coordinate to 2 dp (0.01 pt ~= 0.0035 mm, against ~1 pt bars --
    # far below anything a scanner or a printer can resolve).
    #
    # Not cosmetic: MuPDF emits per-glyph advances with long fractional tails, and
    # this repo is public, so the pre-commit secret guard scans added lines for
    # household digit patterns. One of those tails can contain such a pattern as a
    # substring and block the commit for a bar code sheet with no household data
    # in it at all. (It did, twice -- the second time on the comment that used to
    # quote an offending value as an example.) Rounding removes the false positive
    # and drops the file size by ~35%.
    svg = re.sub(r"\d+\.\d{3,}",
                 lambda m: f"{float(m.group()):.2f}".rstrip("0").rstrip("."),
                 out[0].get_svg_image(text_as_path=False))
    with open(OUT_SVG, "w", encoding="utf-8") as fh:
        fh.write(svg)
    print(f"[ds2278] wrote {OUT_PDF} ({os.path.getsize(OUT_PDF)} bytes)")
    print(f"[ds2278] wrote {OUT_SVG} ({os.path.getsize(OUT_SVG)} bytes)")
    for label, values, txt in volumes:
        print(f"[ds2278] verified {label}: values={values} decoded={txt!r}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
