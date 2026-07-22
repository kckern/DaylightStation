# scantron-relay — bring-up status and remaining work

**Date:** 2026-07-21
**Status:** protocol SOLVED and verified on hardware; relay and backend NOT built
**Owner:** KC
**Reference:** [`docs/reference/scantron/`](../../reference/scantron/README.md) —
protocol, card spec, and troubleshooting live there and are authoritative.

## Where this landed

The Chatsworth OMR-1100 now reads cards correctly and its output decodes. Two
findings account for the whole difficulty, and both are the kind that stay
invisible until someone reads the vendor manual:

1. **The link is 9600 7E1**, not 8N1. Wrong framing on this device produces
   silence rather than garbage, which inverts the usual serial triage rule and
   makes a healthy link look like a wiring fault.
2. **Conversion modes are volatile.** A powered-up reader has no mode loaded and
   emits nothing at all while otherwise behaving perfectly — lamp on, card
   transported, all ready lines asserted. The host must download a mode (`I00`)
   before any scan produces output.

Neither is discoverable by experiment in reasonable time; both came out of
vendor documentation recovered from the Wayback Machine index of the vendor's
dead domain, now archived in `_extensions/scantron-relay/docs/recovered/`.

First successful read, 2026-07-21 — the generated test strip, 39 columns, all 36
designed marks correct and nothing spurious:

```
      123456789012345678901234567890123456789
   12 ...........#...........#...........#..#
    …  (walking diagonal, three cycles)
    9 #...........#...........#.............#
```

The trailing all-channel column is the strip's printed cut-line, not data — the
generator should drop that border.

## Done

- Serial contract established and verified against the live unit
  (firmware `Version 1.04, Wed Oct 2 1996`; `GETCONFIG` reports factory defaults).
- Vendor manuals, command set, card specification, and original DOS utilities
  recovered and archived in-repo.
- Tools: `omr-query.py`, `omr-listen.py`, `omr-decode.py`, `gen-test-strip.py`.
- Firmware `handleFrame()` decodes `I00` records into 12-bit column masks; mode
  re-arms every 60 s while idle so it self-heals across reader power cycles.
- Config examples carry the verified `9600 / 7E1` with a warning against
  "correcting" them back to 8N1.

## Remaining work

### 1. Backend dispatch

Add `backend/src/3_applications/hardware/scantronRelay.mjs`, mirroring
`foodScaleRelay.mjs`; wire it in `app.mjs`; re-broadcast on `scantron`; persist
to `household/history/scantron/<reader-id>/<YYYY-MM-DD>.yml`.

Note the persistence lesson from the food-scale relay: appends must be
serialized, because a naive async read-modify-write races and loses records.

**Scoring belongs here, not in the relay.** The reader is read-only — it cannot
print, imprint, or grade — so the answer key and any grading logic are backend
concerns. The relay deliberately reports raw column masks rather than answers,
since column-to-question mapping is per-form.

### 2. Cards

Decide between ordering stock cards and designing custom ones; both paths and
the part numbers are in the reference doc. The blocker is not technical — it is
deciding what the household will actually use these for (quizzes, chore
checkoffs, surveys, ballots), because that determines the form layout. Ordering
1,000 of the wrong layout is the main waste risk here.

Whatever is chosen, confirm the background ink is warm-red dropout: this is a
Visible Red unit and will read ordinary black or green background printing as
marks.

### 3. Relay hardware

The ATOM Lite and ATOMIC RS232 base are not yet assembled. A Linux host with a
Keyspan USA-19HS is standing in and is sufficient for development. When the ATOM
is built: signal must pass through the MAX3232 (RS-232 swings ±12 V and will
destroy a 3.3 V GPIO), and **TX is genuinely required** — unlike the other
relays, this device will not talk until it is spoken to.

### 4. Small cleanups

- Drop the cut-line border from `gen-test-strip.py`, or move it outside the
  scanned area, so captures do not carry a phantom all-channel column.
- `omr-sniff.py` still defaults to `9600 8N1` from the pre-protocol era. It is
  retained for framing investigations but the default is now misleading.

## Decisions worth recording

- **Binary mode (`I00`) over Hollerith (`H##`).** Hollerith returns one tidy
  ASCII character per column, but bakes a punched-card character mapping into
  the reader that we would have to reverse. Binary reports every mark without
  imposing an interpretation, which keeps form semantics in the backend where
  they can change without touching firmware.
- **Re-arm on a timer rather than tracking reader power.** The relay cannot
  observe the reader's power state, and the download is idempotent, so a
  periodic idle-time re-send is simpler and strictly more robust than trying to
  detect a power cycle.
- **No blind command probing.** Writing unknown command bytes to this device can
  change persistent EEPROM settings — baud, parity, flow control, feed control —
  some of which would cost the link entirely. Read-only queries only, unless
  there is a specific reason and an explicit decision to write.
