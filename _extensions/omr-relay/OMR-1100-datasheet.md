# Chatsworth Data OMR-1100 — datasheet extract

**Source:** <https://www.printlpp.com/resources/omr1100.pdf> (Lincolnshire Printing
& Promotions, a Chatsworth/Sekonic OMR reseller). Retrieved 2026-07-21.

> **Provenance:** everything on this page is transcribed from the vendor
> datasheet. **Nothing here has been measured on our unit yet.** Per
> `feedback_dont_assert_unverified_device_facts`, treat these as *documented*
> claims — confirm against the physical reader during bring-up, and mark any
> field that turns out to differ.
>
> Bare `printlpp.com` does not resolve — use `www.printlpp.com`. Sibling
> datasheets on the same host: `omr1102ds.pdf`, `omr2000ds.pdf`, `omr9002.pdf`.

## What it is

A low-cost desktop data-entry terminal that detects marks on scannable forms and
transfers the data to a computer over RS-232 "for processing by application
software." Forms are inserted and automatically transported past a fixed read
head.

**It is read-only.** It does not print, imprint, endorse, score, or grade
anything — there is no printer, no ink, and no marking mechanism in the unit.
All scoring happens downstream on the host. (The spec line "**Graded** index
fiber read head" is an *optics* term — graded-index optical fiber — and has
nothing to do with grading tests.) Every other occurrence of "print" in the
datasheet refers to what *you* print on the form: background ink color, or
"pre-printed marks" the reader can detect.

## Specifications

| Field | Value |
|---|---|
| **Form size** | **3-1/4" wide** × 5" to 14" long (8.255cm × 12.7–35.6cm) |
| **Scan area** | up to **12 × 105 mark positions** on a 3-1/4" × 11" form |
| **Rows** | body text says forms may contain up to **126 rows** of 12 positions |
| **Interface** | RS-232C asynchronous, **300–38400 baud, full duplex** |
| **Data output** | **ASCII character**, binary, download mask |
| **Read technique** | graded-index fiber, **single-sided** |
| **Threshold** | self-adjusting per channel |
| **Paper weight** | 18–100 lb (.004"–.010" thick) |
| **Feed method** | manual; feed-through or reciprocating |
| **Speed** | up to 2000 11" cards/hour; ~20–35 forms/min typical |
| **Scanning speed** | 18" (45.7cm) per second |
| **Microprocessor** | 68HC11 |
| **Power** | 114–125VAC 60Hz (220VAC 50Hz available), external PSU |
| **Weight** | 9 lb (4.10kg) |
| **Dimensions** | 5.74"W × 4.5"H × 9.5"D |
| **Operating** | 41–113°F (5–45°C), 30–80% RH non-condensing |

## Form width is the hard constraint

**3-1/4" is fixed.** Standard Scantron forms (882-E and relatives) are 4.25" or
8.5" wide and **will not physically feed**. Custom forms are mandatory.

The datasheet's sanctioned workaround:

> Input forms may also be part of a larger 8 1/2" x 11" sheet using a
> perforation at 3 1/4" to separate the input portion of the sheet from the Text
> portion.

So the intended pattern is a full-size sheet with the questions/text on the
large portion and a 3-1/4" answer strip perforated off to feed the reader.

## Two optical variants — determine which unit we have

This constrains form design more than paper size does.

| Variant | Reads | Background printing constraint |
|---|---|---|
| **Infra Red** | #2 pencil, key-punched slots, pre-printed marks — **no pen** | any color allowed |
| **Visible Red** | pencil, **blue/black ballpoint, blue/black felt tip**, punched slots, pre-printed marks | background **must be "warm red"** dropout |

If ours is Visible Red, every form must be printed in warm-red dropout ink or
the reader will see our own gridlines as marks.

## In the box (per datasheet)

External power supply, serial data cable (Macintosh **or** PC), Operator Guide,
**test cards**, and setup/demo/diagnostic software.

> The **test cards** matter for bring-up: they are known-good input, so we can
> debug the serial link without simultaneously debugging a hand-printed form.
