# Chatsworth OMR card specification

Transcribed from *Technical Manual for OMR 1102*, Appendix A "Document
Specifications" (retained as PDF in
`_extensions/scantron-relay/docs/recovered/`), cross-checked against the
OMR-1100 operator guide and the ACP-100 datasheet, which state the same
geometry.

This is what makes a card readable. Getting any of it wrong produces a card that
transports normally and reads as nothing — the failure is silent.

---

## Dimensions

| Property | Requirement |
|---|---|
| Width | **3.250 in (82.55 mm) ± 0.010 in** |
| Length | 3.25–12 in per Appendix A; the OMR-1100 guide gives 5–14 in and notes 3 in minimum to transport, practical range 7⅜–14 in |
| Thickness | 0.004–0.008 in (0.102–0.203 mm) |

The width tolerance is the unusual number. Commercial print trim is typically
quoted at ±1/16 in (0.0625), six times looser. See *Printing your own* below.

## Paper stock

| Property | Requirement |
|---|---|
| Type | white, 100% wood pulp, no ground wood; soft content ≤40% |
| Prohibited | smudges, watermarks, embossed or printed patterns, **fluorescent additives** |
| Weight | 20 lb bond / 50 lb offset minimum; 40 lb bond / 100 lb offset maximum |
| Reflectance | ≥75% in the red to near-infrared region |
| Dirt | ≤10 parts per million |
| Smoothness | 100–200 Sheffield |
| Porosity | 10–15 Gurley |
| Grain | **long** — parallel to the direction of feed |
| Tear resistance | 40–70 g Elmendorf either direction |
| Curl | ≤0.05 in from flat |

Two of these routinely get missed when ordering. **Fluorescent additives** —
optical brighteners — are present in most modern bright-white stock and are
explicitly forbidden. And the weight range means ordinary paper to light text
weight, **not cardstock**: 65 lb cover runs about 0.010 in and is too thick for
the transport.

Grain direction matters because paper expands across the grain with humidity;
running grain-long minimizes width change and therefore jamming.

## Printing

In the active data section, print must be either **reflective** (red, on readers
with the ink read head option) or **black non-reflective**.

| Element | Requirement |
|---|---|
| Strobe and pre-printed data marks | non-reflective black, **<10% reflectance** |
| Background printing | reflective, **>80% reflectance** |
| Suggested dropout red | **PMS 177** |

Permitted background PMS inks per the manual: 101, 102, 106–108, 113–116, 120–123,
127–130, 134–137, 141–144, 148–151, 155–158, 162–165, 169–172, 176–178, 182–185,
189–192, 196–198, 203–205, 210–212, 217–219, 223–225, 230–232, 236–238, 243–245,
250–252, 485–489.

Outside the data area — instructions, logos, advertising — any color may be used,
with two exceptions: **no printing on the edge containing the strobe area**, and
**the leading 0.125 in must be clear of print in all channels** so the reader can
detect the media.

> This unit is the **Visible Red** variant, so background printing must be in the
> warm-red dropout range. Green or black background print will be read as marks.
> Infrared units are the opposite — they tolerate colored background printing but
> read pencil only.

## Format

### Strobe (timing) marks

Printed along the **bottom edge of the card with the leading edge to the left
when viewing the card face up**.

| Property | Requirement |
|---|---|
| Height (across the width) | 0.125 in ± 0.005 (3.127 ± 0.127 mm) |
| Thickness (along the length) | ≥0.030 in (0.762 mm) |
| Gap between marks | ≥0.050 in (1.27 mm), edge to edge |
| Pitch | 0.250 in centers |
| Leading edge to first mark | ≥0.250 in (6.35 mm) |
| Last mark to trailing edge | ≥0.250 in (6.35 mm) |

The data read area coincides exactly with the length of the strobe mark, so a
strobe mark printed in line with the data marking area must be **as wide as, or
wider than (no less than 95% of), the data marking field**.

### Data areas

Twelve marking channels across the width, each **directly above its strobe
mark**.

| Property | Requirement |
|---|---|
| Channels | exactly 12 |
| Bottom row centerline | 0.250 in ± 0.005 from the bottom edge |
| Row spacing | 0.250 in ± 0.005 increments (tolerance non-accumulative) |
| Top row centerline | 0.250 in ± 0.005 from the top edge |
| Marking area height | 0.125 in minimum, 0.215 in maximum |
| Columns | up to 126 |

### Timing track placement and alignment

Selectable in configuration: **bottom = left side as the card enters**, top =
right side. A single form may carry only one timing track. Alignment is either
**inline** (data mark area between the leading and trailing edges of the timing
mark) or **offset** (data mark area between timing marks).

This unit is configured bottom timing, inline alignment.

## Environment

Store cards packed flat, protected from folding and edge damage, in a sealed
cellophane package of ≤1000, off the floor, away from condensation. Storage
0–60 °C, 20–80% RH non-condensing; operating 0–55 °C at 20–80% RH.

---

## Full-page layouts

The vendor's standard trick for using letter-size paper: place a microperf
**3¼ in from the right edge**, leaving the left portion for questions,
instructions, and logos. The respondent tears off the answer strip and feeds
only that.

A second common layout puts two perforations on a sheet, leaving a 2 in tab on
the left for branding and yielding two cards per form.

---

## Printing your own

`_extensions/scantron-relay/tools/gen-test-strip.py` generates a spec-conforming
strip as PDF, carrying a walking-diagonal mark pattern whose decode is
self-evident — one mark per column stepping through all twelve rows, then two
blank columns. This is the only card verified to work on this reader.

Print at **100% / actual size**. Any "fit to page" scaling breaks the 0.250 in
pitch and the card becomes unreadable.

**Make the strobe marks bleed.** Rather than hunting for a shop that will
guarantee ±0.010 in trim, draw the strobe marks running past the cut line so the
blade passes through them. The marks are then flush to the finished edge
wherever the cut actually lands, which converts a precision-machining
requirement into an ordinary print job. This is the recommended approach for any
outside printer or cutting service.

---

## Historical stock cards

Chatsworth sold pre-printed cards in the correct width. **This product line is
defunct** — these numbers are an inquiry reference for asking a printer whether
they still hold the artwork, not a live catalog. Prices are from the 2006 sheet;
minimum order was 1,000.

| Part | Layout | Size | Then-price |
|---|---|---|---|
| `LP2745` | 9-position ID + 20 questions A–E | 3¼ × 5¾ in | $39/M |
| `H45070-0` | 7-position ID + 50 questions A–E | 3¼ × 7⅜ in | $41/M |
| `B350060-2` | 5-position ID + 50 questions A–E | 3¼ × 7½ in | $41/M |
| `H35070-0` | 7-position ID + 100 questions A–E | 3¼ × 11 in | $54/M |
| `B350010-2` | 5-position ID + 100 questions A–E | 3¼ × 11 in | $54/M |
| `2093-6` | 50-item test answer card | 3¼ in | — |
| `2731-a` | Scott Foresman Reading, double sided | 3¼ × 11 in | $70/M |

**Avoid `05SD` and `06SD`.** These double-sided 3¼ × 11 cards are marked *"use
with pencil only OMR's (I.R.)"* — printed for infrared readers, so their
background ink would be read as marks on this Visible Red unit.

The `LP` prefix is Lincolnshire Printing's own, and the OMR-1102 datasheet
credits them for card `2093-6`; they printed this line originally. See the
sourcing section of [`README.md`](README.md).

## What does not fit

Scantron and NCS forms are a different geometry and will not read on this
device, regardless of looking like bubble sheets. Verified against a current
vendor catalog:

| Form | Size | |
|---|---|---|
| Scantron 815-E / ScanRite 3289 ES-15 | 3⅜ × 6 in | ⅛ in too wide — tested, reads nothing |
| Scantron 2020 | 4.25 × 6 in | too wide |
| 881-E, 882-E, 889-E, 9702 | 4.25 × 11–12 in | too wide |
| 883-E | 5.5 × 11 in | too wide |
| 884-E, 888-E, 9700 | 8.5 × 11–12 in | too wide |
