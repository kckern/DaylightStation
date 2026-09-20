# Piano timed run: the cursor was drawn off the page, and every cued attempt for a week failed

**Date:** 2026-09-18
**Surface:** piano kiosk — exercise run, engraved (abc) notation stage
**Reported from:** live observation at the piano, then the log store and a real-browser measurement

A learner ran the tier-3 cued rung three times, played a clean C major scale on
the beat each time, and was given nothing. The screen showed no cursor at all.
When the gate eased him down a rung, the cursor reappeared on the grand staff
"in the middle at the bottom", covering no note.

Both are one defect. It is not a regression from this week's work: **every
timed attempt in the log store's entire seven-day window failed — 90 of 90,
across scales, arpeggios, sevenths, single notes, Hanon and runs. The cued rung
has never once been passed.**

---

## What the logs say happened

Three `gate.attempt` rows on rung `L4`, `mode: cued`, tier 3, material
`scales/modes@root=C,mode=ionian,direction=up,span_octaves=1,hand=R` — eight
eighth-notes at 60 bpm, so a 500 ms grid after a four-click count-in at 1000 ms.

| time (UTC) | event | detail |
|---|---|---|
| 01:21:24.97 | `phase: countdown` | lead-in 4000 ms, `displayedCursor: -1` |
| 01:21:28.98 | `phase: running` | `elapsed: 17`, `displayedCursor: 0` |
| 01:21:29.38 | `observation` `miss` `event-1` | miss window closes at downbeat + 420 ms |
| 01:21:29.52 | `observation` `wrong` `event-2` `midi: 60` | first key, **559 ms after the downbeat** |
| …repeats… | every note `wrong` against the NEXT event | owed note `miss`ed behind it |
| 01:21:32.98 | `exercise-complete` | `score: 0.55`, `passed: false` |

The two later attempts scored `0`. The notes played were `60 62 64 65 67 69 71
72` — the scale, in order, evenly. The engine's own `criteria.placement` on the
first attempt was **0.9**: it agrees he was locked to a beat. He was locked to
the wrong one, by exactly one note value, because his first note was 559 ms
late — more than the 500 ms that separates two events at this tempo. One late
downbeat displaces every match for the rest of the run.

---

## Root cause — the lane is measured in one coordinate space and drawn in another

`ExerciseNotation` positions the yellow cursor lane by measuring the notehead
with `rootBox()`, then portals a `<rect>` into a `<g>` at the SVG root.

`rootBox()` mapped the notehead's `getBBox()` through **`element.getCTM()`**.
That returns the element → **viewport** matrix, which *includes the root's own
viewBox transform*. The rect, being a child of the `<svg>`, is drawn in **user
units**, which the viewBox then scales. The two spaces differ by exactly the
viewBox factor — and `AbcRenderer`'s `fitContent` rewrites the viewBox to hug
the engraving on every render, so that factor is never 1.

Measured in headless Chromium on the material the bank actually ships:

| material | viewBox | factor | lane written at | result |
|---|---|---|---|---|
| one-hand scale, 8ths | `302.05` wide, `90.09` tall | **4.1x** | `x=406, y=129` | outside the viewBox on both axes — **nothing on screen** |
| grand staff, 8ths | `590.52` wide, `175.70` tall | **2.1x** | both lanes `x=238` (true `x` is `116.4`) | treble lane lands over the **bass** stave; bass lane falls past the bottom edge |

That is the whole of it: the single-staff lane is off the page, and the
grand-staff lanes are displaced onto the wrong stave and out of view.

### Where it came from

`89a866a55` (2026-09-07), item 4, introduced `rootBox()` to correct for abcjs
wrapping a stave in a transformed group, and closed with "falling back to the
raw box where there is no CTM so nothing changes without transforms". The root
viewBox *is* a transform and is always present, so the fallback never applies.
Measurement shows a notehead's `getCTM()` is byte-identical to the root
`<svg>`'s on this renderer — there are no intermediate transforms to correct
for, so the guard corrected nothing and added the viewBox scale as pure error.

`ScorePassage` — the score stage, whose cursor was never wrong — already does
this correctly: `svg.getScreenCTM().inverse()` composed with the element's
screen box, which cancels the viewBox.

### Fix

`rootBox()` composes the root's screen matrix inverse with the element's, which
cancels the viewBox and leaves only the transforms *between* them — the
correction the original was reaching for, and the mapping the score stage
already used. Falls back to the raw `getBBox()` where there is no CTM (jsdom),
where there is no transform to correct for anyway.

---

## Why a fully green suite never saw it

1. **The one real-browser test that draws this cursor asserts existence and
   rightward motion, never containment.** In the timed block, the
   `inside(note, cursor)` check is inside `if (surface === 'score')`. For the
   notation surface the assertions are `count(...) > 0`, `painted === true`,
   and `movedCursor.cx > firstCursor.cx`. An SVG child's
   `getBoundingClientRect()` reports its geometry whether or not it lies inside
   the viewBox, so a lane drawn 4x off-scale and entirely off the page
   satisfied all three. Two green measurements, a blank screen.

2. **The harness fixture is not the material the bank ships.** `SCALE` is
   `value: 'quarter'` at 90 bpm with `staff: 'treble'`. Every published scale
   rung is `value: '8th'` (which beams) and half are `staff: 'grand'` (which
   draws two lanes). **No measurement in the file had ever mounted grand-staff
   material**, so the two-lane path had never been rendered by a test at all.

3. **jsdom cannot see any of this.** The notation unit suites assert class
   names — `exercise-note-next`, `exercise-note-done` — and every one of them
   was correct. The defect is purely geometric.

Regression cover added: `the engraved cursor, on the material the bank ships`
in `ExerciseRun.measure.test.jsx`, with fixtures shaped like the bank's output
(`value: '8th'`, `staff: 'grand'`), asserting each lane is inside the engraving
and encloses the notehead it points at. Both cases fail on the old code.

---

## Fixed alongside — the count-in pulse was half the speed of the ask

Not fixed here, and it is the other half of why the run gave no credit.

`countInPlan` counts a cued run in on the **quarter** pulse. A scale out of the
bank is written in **eighths**. So the rung clicks four times at 1000 ms and
then grades eight notes 500 ms apart. `countIn.js`'s own `askPace` docstring
already records this happening on **2026-09-13** — same rung, same shape, three
attempts, every note `wrong` with a `miss` beside it. The mitigation shipped
then was a *sentence* (`countInSentence`: "play two notes on every click"),
rendered only in the `ready` phase — before the arming key, gone the moment the
count-in starts. 90 timed attempts since, still zero passes.

With the cursor visible the child now has a visual pulse at the true rate, which
should carry most of this. What remains is the downbeat itself: the lane is
hidden during the count-in (`displayedCursor: -1`, deliberate and documented)
and appears *on* beat one, so a child who reacts rather than anticipates is
late by their reaction time — which at this tempo is more than one note value,
which is precisely the 559 ms observed.

**Taken:** the count-in now pulses at the ask's own onset spacing
(`askPulseQuarters`). A scale in eighths at 60bpm is counted in at 120, eight
clicks to the measure — one click, one note — and the running metronome carries
that same pulse through the downbeat instead of reverting to quarters exactly
as the child starts playing. The count-in's length is unchanged: still one
measure of the music. An ask with no single spacing keeps the quarter.

The sentence follows for free: `askPace` against the new pulse reports one note
per click, so the ready line reads "You'll hear 8 clicks, then play one note on
every click." It is now a description of the grid rather than a warning about
a mismatch.

Every existing cued fixture in the suite is written in QUARTERS, where the old
quarter pulse happened to equal the ask's own — which is why 100 green tests
never saw this. Both new tests mount `value: '8th'` material, the shape every
published scale rung actually has.
