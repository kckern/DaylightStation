# Relative rhythm on the live chord staff

**Date:** 2026-08-12
**Status:** Design, validated in conversation. Not implemented.
**Touches:** `frontend/src/modules/MusicNotation/model/noteFlow.js`,
`frontend/src/modules/MusicNotation/renderers/chordStaff.js`,
`frontend/src/modules/MusicNotation/renderers/ChordStaffRenderer.jsx`,
`frontend/src/modules/Piano/components/CurrentChordStaff.jsx`

---

## Problem

`CurrentChordStaff` currently shows **order and nothing else**. Every column is
engraved as a quarter note, horizontal position carries sequence rather than time,
and note-offs are ignored. The one timing judgement it makes is a 45ms simultaneity
window for stacking a struck chord into one column.

Two things are wrong with that in practice.

**1. The simultaneity window is too tight.** Two hands striking "together" spread
further than 45ms, so real chords splinter into two or three columns marching
rightward instead of one stack under one stem.

**2. There is no shape.** A fast arpeggio resolving onto a held chord draws
identically to eight evenly-spaced notes. The display can carry a coarse sense of
relative pace without claiming to have measured tempo.

### Explicitly still out of scope

No metronome. No BPM. No time signature, barlines, or measures. No quantisation to a
grid. Nothing absolute — every rhythmic mark is relative to how the player has been
playing in the last few seconds.

---

## Design

### 1. Two simultaneity windows

A single wide window cannot work: a run at 120ms/note is *faster* than any chord
tolerance worth having, so one wide window swallows runs into a single stacked
column and the rhythm feature never fires.

The wide tolerance is specifically for **the two hands landing not-quite-together**.
So the window depends on where the incoming onset sits relative to the open column:

| Case | Window |
|------|--------|
| Onset is plausibly the *other hand* | `CROSS_HAND_SIMULTANEITY_MS = 250` |
| Onset is in the same region as the column | `SIMULTANEITY_MS = 60` (was 45) |

**Other-hand test** (pure, in `noteFlow.js`) — an onset counts as the other hand when
both hold:

- its distance to *every* note already in the open column is more than 12 semitones, and
- it falls on the opposite side of C4 (MIDI 60) from the column's pitch centroid.

`splitByHand` in `model/handSplit.js` is **not** reusable here: it classifies a whole
set at once and is context-dependent, so it gives no stable per-onset boundary.

As today, the window is measured from the column's **start**, not from the last note
added, so a slow roll cannot daisy-chain itself into one stack a note at a time.

**Known limitation:** a two-hand chord where the right hand *also* rolls across more
than 60ms will split the right hand into a second column. Accepted.

### 2. Duration classification

Three glyphs only: **eighth, quarter, half**.

A column's duration is set **retroactively by the gap to the next onset**
(inter-onset interval), not by how long the key was held. Note-offs stay ignored.

When column N+1 opens, column N's IOI is fixed and classified against a rolling
baseline:

```
baseline = clamp(median(recentIois), 180, 1200)   // ms

IOI <  0.6 × baseline  →  eighth
IOI >  1.7 × baseline  →  half
otherwise              →  quarter
```

**The newest column has no IOI yet.** It draws as a **quarter provisionally**, and
promotes itself to a **half** once its own age crosses `1.7 × baseline` — the same
rule, applied to age instead of IOI. That is the held-note case, and it is why the
component needs a faster tick (below).

### 3. Baseline memory outlives the visible staff

`flow` gains one field: `recentIois`, a plain array capped at **16** entries and
cleared by `clearIfIdle` along with the columns.

This matters. `COLUMN_CAPACITY` is 8, so baseline memory drawn only from visible
columns gives at most 7 IOIs — a fast run fills the staff, the baseline converges to
the run's own rate, and the run stops reading as eighths halfway through itself.

Durations are otherwise **derived, not stored**: a new pure
`flowDurations(flow, now) → Array<'8'|'q'|'h'>` computes them on demand.

**Accepted property:** any adaptive baseline normalizes sustained tempo. Play fast
for ten seconds and everything reverts to quarters. An eighth marks a *burst against
recent context*, not absolute speed. This follows directly from "no fixed BPM."

### 4. Duration belongs to the column, not to a staff

Treble and bass at slot N always receive the same duration, and the `GhostNote`
filling an untouched staff mirrors it. That is what keeps the two voices
tick-aligned — per-staff durations would let the two staves drift apart column by
column.

`Voice` moves to soft / non-strict mode: mixed durations with no meter will not
satisfy a strict tick count.

### 5. Retroactive rewrite vs. the typewriter grid

The sharpest constraint. VexFlow's formatter spaces by ticks, so rewriting column 2
from quarter to eighth drags columns 3–8 leftward — notes visibly jumping while you
play, destroying the current guarantee that "slot 1 sits at the same x whether it is
alone or the first of eight."

**Fix: post-format snap.** Format once as today over the full `COLUMN_CAPACITY`
slots, then override each tickable's `x_shift` onto a uniform slot grid computed from
`noteAreaW`. Both staves snap to the same grid, so column alignment survives and
glyphs can change without anything moving.

This is the main implementation unknown — verify the VexFlow 4 API behaves as
expected post-format (see Risks).

### 6. Beaming

Built **after** the snap, since beams need final x positions. A group is 2+
consecutive eighth columns on the same staff, broken by any non-eighth column or by a
ghost on that staff.

**Caveat:** `Beam` forces a single stem direction across its group, overriding the
`auto_stem` that currently keeps stems pointing toward the staff. On extreme chords
this can push stems into the frame's headroom.

### 7. Live re-render

- `notesKey` in `ChordStaffRenderer` gains the duration string, so a duration-only
  change still triggers a re-render.
- The provisional-quarter → half promotion needs its own tick at
  `PROVISIONAL_TICK_MS = 80`, replacing reliance on the 250ms idle sweep. At 250ms the
  promotion is visibly late.

### 8. Compatibility

`ChordStaffRenderer` also serves a single-chord form (`notes` prop) used by
`ChordCard.jsx` and `Notation.jsx`. That path has no flow and no IOIs — it keeps
drawing quarters, unchanged.

---

## Constants

| Name | Value | Notes |
|------|-------|-------|
| `SIMULTANEITY_MS` | 60 | same-region window (was 45) |
| `CROSS_HAND_SIMULTANEITY_MS` | 250 | opposite-hand window |
| `FAST_RATIO` | 0.6 | below this × baseline → eighth |
| `SLOW_RATIO` | 1.7 | above this × baseline → half; also the provisional promotion threshold |
| `IOI_MEMORY` | 16 | `recentIois` cap |
| `BASELINE_CLAMP` | 180–1200ms | keeps one wild gap from wrecking the scale |
| `PROVISIONAL_TICK_MS` | 80 | promotion tick |
| `COLUMN_CAPACITY` | 8 | unchanged |
| `IDLE_CLEAR_MS` | 1600 | unchanged |

---

## Testing

**`model/noteFlow.test.js`** (pure, extends the existing suite):

- cross-hand onset at 200ms merges; same-region onset at 200ms opens a new column
- same-region onset at 40ms merges
- window measured from column start — a 3-note roll at 50ms intervals does not
  daisy-chain into one column
- classification at the ratio boundaries, and the clamp
- `recentIois` caps at 16 and is cleared by `clearIfIdle`
- baseline survives columns scrolling off the staff
- provisional column reports quarter, then half once aged past threshold

**`renderers/chordStaff.test.js`**:

- mixed-duration flow renders without throwing (soft voice)
- slot x positions are identical before and after a column's duration is rewritten
  (the typewriter guarantee)
- beam groups form across consecutive eighths and break on a quarter

---

## Risks

1. **`x_shift` snap** — the whole typewriter guarantee rests on overriding positions
   after `Formatter.format()`. Spike this first; if VexFlow 4 fights it, the fallback
   is hand-placing tickables and dropping the formatter for note x entirely.
2. **Beam vs. `auto_stem`** — forced stem direction may clip tall chords. May need a
   per-group majority-direction rule, or to drop beams and ship flags alone.
3. **Baseline normalizes sustained tempo** — accepted, documented above, but it will
   read as a bug to anyone who hasn't been told.
4. **Cross-hand test is a heuristic** — an octave-plus leap within one hand across
   C4 will be misread as the other hand and merged. Rare in practice.

---

## Sequencing

1. `noteFlow.js` — two windows, `recentIois`, `flowDurations`. Fully testable with no
   rendering.
2. Spike the `x_shift` snap in `chordStaff.js` against a fixed mixed-duration flow.
3. Wire durations through `chordStaff.js` → `ChordStaffRenderer` → `CurrentChordStaff`,
   including the 80ms promotion tick.
4. Beams last — the most likely piece to be cut.
