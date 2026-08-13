# Relative rhythm on the live chord staff

**Date:** 2026-08-12
**Status:** Implemented on `feature/chord-staff-rhythm`. Not yet verified on the kiosk.
**Code:** `frontend/src/modules/MusicNotation/model/noteFlow.js`,
`frontend/src/modules/MusicNotation/renderers/chordStaff.js`,
`frontend/src/modules/MusicNotation/renderers/ChordStaffRenderer.jsx`,
`frontend/src/modules/Piano/components/CurrentChordStaff.jsx`,
`tests/_infrastructure/harnesses/chord-staff-ink-sweep.mjs`

---

## Problem

`CurrentChordStaff` showed **order and nothing else**. Every column was engraved as a
quarter note, horizontal position carried sequence rather than time, and note-offs
were ignored. The one timing judgement it made was a 45ms simultaneity window.

**1. The window was too tight.** Two hands striking "together" spread further than
45ms, so real chords splintered into two or three columns marching rightward.

**2. There was no shape.** A fast arpeggio resolving onto a held chord drew
identically to eight evenly-spaced notes.

### Still out of scope

No metronome. No BPM. No time signature, barlines, or measures. No quantisation to a
grid. Every rhythmic mark is a ratio against how the player has been playing over the
last few seconds — play a passage twice as fast and it engraves identically.

---

## Design

### 1. Simultaneity: time AND key-down overlap

A batch of onsets joins the open column when **both** hold:

- it lands within `SIMULTANEITY_MS` (90) of the moment that column **opened** —
  measured from the start, so a slow roll can't daisy-chain into one stack a note at
  a time; and
- **every note already in that column is still held down.**

The overlap test is what separates a chord from a run without guessing from pitch.
`activeNotes` already tracks key-down state (`useMidiSubscription.js:64-65`, plus a
stale-note sweeper at `:101-109`), so this needed no new plumbing.

**A register-based rule was tried first and abandoned.** It used a wide (~250ms)
window when an onset looked like "the other hand" — more than 12 semitones from every
column note and on the far side of C4 — and a tight window otherwise. It failed in
both directions:

- *It missed its own motivating case.* An ordinary close-voiced two-hand C major
  (LH 48/52/55, RH 60/64/67) has nearest notes 5 semitones apart, so it never
  qualified for the wide window and splintered exactly as before.
- *It broke something that already worked.* A wide arpeggio crossing middle C
  (C2→E3→G4→C6 at 100ms/note) **did** qualify, and collapsed to `[C2], [E3+G4+C6]` —
  a regression against the display's core promise that you can see an arpeggio go up.

Both cases are now regression tests in `noteFlow.test.js`.

**`SIMULTANEITY_MS = 90` is reasoned, not measured.** It is above a plausible
two-hand spread including the piano → Jamcorder → backend → WS transport jitter the
timestamps carry (they are stamped on receipt, not at the keybed) and below the
~120-150ms per note of a fast run. A capture of real onsets off the kiosk would
settle it; the constant is flagged UNVERIFIED in the source.

### 2. Duration: three glyphs, decided retroactively

Eighth, quarter, half. A column's duration is fixed by the gap to the **next** onset
(inter-onset interval), not by how long the key was held. When column N+1 opens:

```
baseline = clamp(median(recentIois), 300, 800)   // ms; 500 when nothing measured yet

IOI <  0.6 × baseline  →  eighth
IOI >  1.5 × baseline  →  half
otherwise              →  quarter
```

The IOI is judged against the baseline **as it stood before that gap joined the
history** — "how you have been playing", excluding the note being judged.

**The duration is STORED on the column, not re-derived.** This is the difference
between a display that revises history and one that doesn't. The baseline moves with
every strike, so a derived duration would re-classify notes already on the staff:
play at 400ms, break into a 150ms run, and partway through the run the median flips
and every eighth already drawn reverts to a quarter with its beam dissolving —
glyphs changing under the player's hands a second after the notes were struck.

**Both ends of the clamp do real work.**

- The **floor (300ms)** is what makes a fast run readable. A purely relative baseline
  is self-defeating on a uniform passage: twelve notes at 120ms drive the median to
  120, the eighth threshold to 72ms, and the run classifies as ordinary quarters —
  the exact case the feature exists to draw. Flooring at 300 means anything under
  180ms reads as an eighth in any context. Above the floor the ratio does relative
  work as intended.
- The **ceiling (800ms)** keeps halves reachable. A half needs a gap past
  `SLOW_RATIO × baseline`, but a gap of `IDLE_CLEAR_MS` wipes the staff first. At the
  ceiling the threshold is 1200ms — a 400ms margin under the 1600ms clear. Without
  the ceiling, anyone playing slower than ~64 onsets/min would never see a half.

`DEFAULT_BASELINE_MS = 500` covers the first column of every phrase, since
`recentIois` clears with the flow. Without it the median of nothing is `NaN`, every
comparison is false, and a struck-and-held chord never promotes.

**Accepted property:** an adaptive baseline normalizes sustained tempo above the
floor. An eighth marks a burst against recent context, not absolute speed.

### 3. Baseline memory outlives the staff

`flow.recentIois` holds the last `IOI_MEMORY` (16) gaps and does **not** scroll with
the columns. `COLUMN_CAPACITY` is 8, so a baseline drawn only from visible columns
would see at most 7 gaps and be entirely rewritten by a single run. It clears with the
flow on idle reset.

### 4. The provisional newest column

The newest column has no gap yet. It draws as a **quarter**, and promotes to a
**half** once it has been held past the same threshold a closed column would clear.
That promotion is the only thing on the staff that moves with the clock, and it rides
an 80ms tick in `CurrentChordStaff` (`PROVISIONAL_TICK_MS`). The old 250ms idle sweep
could not carry it — `clearIfIdle` returns the *same object* when there is nothing to
clear, so the sweep triggers no re-render at all.

### 5. The idle clear holds off for held keys

`clearIfIdle` now takes the key-down surface and won't wipe while a key is down —
otherwise sitting on a final chord erases it 1.6s in, half note and all.
`HELD_CLEAR_MS` (6000) caps the reprieve so a lost note-off can't freeze the staff.

### 6. Duration belongs to the column

Treble, bass, and the `GhostNote` standing in for whichever staff a column doesn't
touch all take the same duration. Per-staff durations would give the two voices
different tick totals and drift the staves apart column by column.

### 7. The post-format snap

VexFlow's formatter spaces by ticks, so once durations vary, rewriting one column's
duration moves every column to its right — and a duration **is** rewritten
retroactively the moment the next column is struck. Notes would twitch sideways while
you play.

So the formatter decides widths and we decide positions: after `format()`, each
tickable is shifted onto a uniform slot grid. `getAbsoluteX()` is
`tickContext.getX() + stave.getNoteStartX() + padding`, so shifting by
`(target − tickContext.getX())` pins slot *i* to the same offset whatever its
duration. Both staves take the same shift.

This was expected to be the risky part and wasn't: the pre-rhythm renderer already
did a post-format `setXShift`, and VexFlow 4.2.5 threads `x_shift` through noteheads,
modifiers, stems, and `Beam`'s `getStemX()`.

**A pre-existing 0.73-unit treble/bass offset** (the bass clef's note-start sits a
hair right of the treble's) is unchanged by any of this — verified against the
original renderer. The test asserts it stays constant across durations rather than
asserting a zero it never had.

### 8. Beaming

Two or more consecutive eighth columns on one staff, built after the snap (so beams
span the real positions) and before the draw (so the notes suppress their own flags).
A slower column, or a slot that staff doesn't play, breaks the run. Beams are
decorative and wrapped — a beam failure must not cost the staff, the same bargain the
ottava markers make.

**A run also breaks where the stem direction changes, and the beam is built with
auto_stem OFF.** The first version used `Beam(notes, true)`, letting VexFlow pick one
majority direction for the group. The ink sweep caught it: on a low bass run that
flips stems away from the staff, and the beam — drawn at the stem tips, which are
lengthened to meet it — landed **10.9 units below the fixed frame, clipping in 336 of
151,944 renders**. `auto_stem`'s "stems point toward the staff" is the rule the frame
was measured against, so the beam has to live inside it rather than overrule it. With
the fix the sweep is back to 0 clipped and the ink extremes are *identical* to the
pre-rhythm baseline (top 30.5, bottom 249.2, left −6) — the new glyphs cost the frame
nothing.

### 9. Compatibility

The single-chord form (`notes` prop) used by `ChordCard.jsx` and `Notation.jsx` has no
flow and no gaps; columns without a duration default to quarters, so it is unchanged.

---

## Constants

| Name | Value | Notes |
|------|-------|-------|
| `SIMULTANEITY_MS` | 90 | was 45; reasoned, not measured |
| `FAST_RATIO` | 0.6 | below this × baseline → eighth |
| `SLOW_RATIO` | 1.5 | above this × baseline → half; also the promotion threshold |
| `IOI_MEMORY` | 16 | outlives the 8 visible columns |
| `BASELINE_MIN_MS` | 300 | floor — makes fast runs readable |
| `BASELINE_MAX_MS` | 800 | ceiling — keeps halves under the idle clear |
| `DEFAULT_BASELINE_MS` | 500 | first column of a phrase |
| `PROVISIONAL_TICK_MS` | 80 | in `CurrentChordStaff` |
| `HELD_CLEAR_MS` | 6000 | stuck-note backstop |
| `COLUMN_CAPACITY` | 8 | unchanged |
| `IDLE_CLEAR_MS` | 1600 | unchanged |

---

## Verification

- **`noteFlow.test.js`** — 44 tests. Both abandoned-heuristic regressions, the
  overlap test, ratio boundaries, the clamp at both ends, baseline memory surviving
  scroll-off, the held-key hold-off and its backstop, the provisional promotion, and
  a test that a closed column's duration never changes.
- **`chordStaff.test.js`** — 40 tests, 15 new. Mixed durations render; slot x is
  identical across duration configurations (the typewriter guarantee); slot 1 sits at
  the same x alone or first of four; beam groups form and break correctly; a lone
  eighth gets a flag; the frame is unmoved by duration; and three tests pin the
  clipping regression above by checking path coordinates against the viewBox (jsdom
  has no `getBBox`, so ink itself can only be measured by the sweep).
- **Ink sweep** (`chord-staff-ink-sweep.mjs`) — extended with a duration dimension
  (all-quarters, all-eighths, all-halves, alternating), since the sweep previously
  drew no flag, no hollow notehead, and no beam. 151,944 renders, 0 clipped. This is
  what found the beam bug; the unextended sweep passed clean on the broken code.
- **Full frontend suite** — 8,373 passing. The 16 failures (MediaApp, PianoApp,
  Agent runtime, the stray `lib/tempTest*.js`) reproduce identically with these
  changes stashed, so they are pre-existing and unrelated.

## Open

1. **`SIMULTANEITY_MS` is unmeasured.** Capture real two-hand onsets off the kiosk
   and re-tune. The transport stamps on WS receipt, so some of the observed spread is
   jitter rather than the player.
2. **Not verified on the kiosk.** Everything here is unit tests and a headless ink
   sweep. Nobody has played a piano into it.
