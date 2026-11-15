# Theory Panel

The **TheoryPanel** is the shared music-theory composite shown alongside the piano
kiosk's Studio and Videos modes: a circle of fifths, a live "current chord" grand
staff, and a chord-name plaque, all reading from the same live MIDI surface.

- Component: `__app_modules/learning/piano/browser/components/TheoryPanel.jsx` (+ `TheoryPanel.scss`)
- Regression test: `tests/live/flow/piano/piano-theory-panel.runtime.test.mjs`

## One component, two layouts

`<TheoryPanel activeNotes={...} layout="row" | "column" />`

| Layout | Orientation | Used by |
|--------|-------------|---------|
| `row` (default) | circle · staff · chord, horizontal | Studio Play + Playback top pane (`StudioPlay.jsx`, `StudioPlayback.jsx`, inside `StudioTopPane`) |
| `column` | circle / staff / chord, vertical | Videos lecture-player sidebar (`PianoVideoPlayer.jsx`) |

It replaced two hand-rolled composites (`StudioTriptych`, `PianoChordColumn`) that
wired the same three children with divergent, per-consumer layout plumbing.

The three children are unchanged and reused as-is:
`CircleOfFifths`, `CurrentChordStaff` (→ `ChordStaffRenderer`), `ChordNamePanel`.

## The sizing contract (why the staff can't balloon)

The live staff is a VexFlow SVG (`renderers/chordStaff.js` via `ChordStaffRenderer.jsx`).
An SVG with `height:100%` and no definite-height ancestor falls back to its **viewBox
intrinsic aspect** — historically ballooning to ~2653px tall inside a 256px card and
shoving the circle and chord plaque out of the clipped pane (only high-note stems
peeked in). The fix makes the staff physically unable to drive layout:

1. **The renderer host owns its box** (`ChordStaffRenderer.scss`): `.chord-staff` is a
   normal block that fills its container; the `<svg>` is `position:absolute; inset:0`.
   A container that fails to size the host yields a small/empty staff — **never** a
   viewport-height balloon.
2. **The engraving FILLS its box** (`computeChordStaffLayout` in `chordStaff.js`): a
   `ResizeObserver` in `ChordStaffRenderer.jsx` measures the host's real box aspect
   (bucketed to 0.05 to avoid re-render thrash) and sizes the stave width to match,
   so the viewBox aspect equals the box aspect and the staff lines span the full
   width with no side gutters. Floored at the content minimum for narrow slots and
   capped at `MAX_STAVE_ASPECT` (3:1) so an extremely wide pane centres the staff
   instead of stretching it edge to edge. Content flows from the LEFT (clef → key
   signature → notes).
3. **The panel provides definite heights** (`TheoryPanel.scss`): flexbox only, every
   slot carries `min-width/height: 0` so percentage chains resolve. In `column` layout
   the staff slot is given a bounded, definite height (it must not flex-grab the whole
   sidebar — a single chord shouldn't be 600px tall).

**Consequence for new consumers:** just drop `<TheoryPanel>` into a sized box. You do
not need to reconstruct a definite-height ancestor chain — the renderer owns that now.

## The staff is FIXED (it never moves as you play)

Position and size depend on the host box **and nothing else**. Not the chord, not the
key. `computeChordStaffLayout` takes the box aspect and a cap — no note input at all,
which is the contract in one line: nothing you play can reach the geometry.

An earlier version fitted the viewBox to the measured ink (`svg.getBBox()`), so the
engraving breathed — a low note or an 8vb marker grew the box and `meet` rescaled and
re-centred everything. Measured in Chrome at 560×210, between a middle-C triad and a
36+96 two-hander: the treble staff shrank **147.5px → 107.7px (−27%)** and drifted
60px right and 32px down. In the narrow sidebar it kept its size but still slid 28px
vertically.

The fix is a constant frame defined in `model/staffGeometry.js` and consumed by both
register feasibility and engraving. Treble stays at y=58, the staff-to-staff anchor
gap is 80 units, and the frame is y=20..272. The extra fixed gap clears octave-clef
labels; it does not grow or shrink while someone plays. The independent browser ink
checks include the heads, modifiers, stems, flags, beams and clef indications.

Two consequences worth knowing:

- **Ordinary chords engrave smaller than they used to.** The worst case is always
  reserved, so a quiet triad gets the same frame as a two-hander with both markers.
  That is the price of "never moves, never clips", and it was the explicit ask.
- **The width floor reserves 7 accidentals, not the current key's.** The displayed key
  is detected from what is being played (`useDetectedKey`) and moves under your hands;
  sizing the floor to the live accidental count let a modulation shove the staff
  sideways. Guarded by a test that renders the same chord in C, G, F♯, D♭ and G♭ and
  asserts one identical viewBox.

## Enharmonic spelling (B♭, not A♯)

`MusicNotation/model/spelling.js` is the single speller, and `identifyChord` produces the
chord's NAME and its note SPELLINGS from one computation — the staff is handed that map,
so the plaque and the notes beside it cannot describe different chords. A cross-module
test sweeps 5 chord shapes × 12 roots × 13 keys asserting they match. (An earlier version
of that test swept major triads only — the one subset where the quality-sensitive rules
can't fire — and stayed green while the plaque read "G♯ minor" over a staff drawing A♭.)
`TheoryPanel` owns one `useDetectedKey` read and passes it to the circle, staff and plaque
alike.

Three tiers pick the ROOT — **in the key → the key decides**; **chromatic → lean by
scale degree** (♯1 and ♯4 sharp, ♭3/♭6/♭7 flat); **chord roots → quality breaks the two
ties** (G♯ minor not A♭ minor; D♭ major not C♯ major). The rest of a chord's tones follow
the letters their degrees demand, so a chord is spelled as a stack of thirds rather than
note by note.

Full rules, worked examples, rejected alternatives and limitations:
**[enharmonic-spelling.md](enharmonic-spelling.md)**.

## The note flow (left-to-right, order not rhythm)

`model/noteFlow.js` turns the live MIDI surface into **columns** that march left to
right like typed characters, instead of piling every note onto one stack.

**This is not meter.** No time signature, quantisation or rests; thin phrase separators mark breaths, not measured bars. The
horizontal axis carries order, so a rolled chord reads as a roll and an arpeggio reads as
an arpeggio.

A column is one **gesture** — a struck or rolled chord. Durations (eighth / quarter /
half) are coarse ratios against a moving baseline, never a measured tempo. The ratios are
biased toward eighths so a phrase beams into one connected line: a gap up to
`FAST_RATIO` (1.2) × your recent pace is an eighth, a quarter means clearly held back,
and only a gap past `SLOW_RATIO` (2.0) × pace is a half. On the replay corpus that draws
~70% of columns as eighths (it was ~30% at the old 0.6 / 1.5). The newest column starts as
an eighth and grows to a quarter, then a half, while you hold it.

| Constant | Default | What it decides |
|---|---|---|
| `GAP_MS` | 150 | Longest silence between successive onsets of one gesture, measured from the column's **last** onset. An onset also joins only while every key already in the column is still down. |
| `SPAN_MAX_MS` | 250 | Longest a gesture may run from its first onset. |
| `MAX_COLUMN_NOTES` | 10 | Ten fingers; more is two gestures. A re-strike of a pitch already in the column also opens a new one. |
| `LEGATO_RELEASE_MS` | 160 | **Legato is not a roll.** When every key that landed before a later key of a young column (newest or second-newest) has let go, the last within this long of that key landing, and that key stays down longer, the line moved on: `pushReleases` splits the column there. A held roll never splits. |
| `LIFT_TOGETHER_MS` | 15 | Keys lifted within this window stay a chord. A pending split settles on the next key event or 80ms tick. On the expanded 338-take corpus, 10ms kept 89.9% of lifted-together chords whole; 15ms kept 91.2%, with chord-whole unchanged at 95.2% and sequential legato merged rising from 13.2% to 13.8%. |
| `LEGATO_MIN_STEP_MS` | 30 | A later key closer than this to the one before it was struck with it and never opens a legato split (short struck chords let go as fast as legato does). |
| `ROLL_MARK_MS` | 100 | A staff whose own arrivals span this long draws an arpeggio stroke. |
| `BREATH_RATIO` | 2.0 | A gap longer than this × the PACE (median of recent gaps, floored at 300ms but not capped) before a column is a breath: a thin bar line before it, and the beat count restarts. At an ordinary pace it is exactly the half threshold; against the real pace, a slow chorale (a chord every 2s) draws no bars. A long gap right after another long gap is not a breath either (slowing into long notes draws one bar where the pause began). The first gap of a line is never a breath. |
| `SMOOTH_RATIO` | 1.15 | A LONE late note: a column whose gap lands within 15% above the eighth → quarter cut-off closes as an eighth when the column before it closed and is drawn as a plain eighth (not itself smoothed, not held into a half; no breath between). Decided at close; the newest's provisional glyph uses the same cut-off. |
| `COLUMN_CAPACITY` | 16 | Columns the model keeps. Not how many are drawn — the renderer draws the newest that fit (see the layout rule below); 16 covers the densest line (~12 eighths at the Studio pane). |
| `IDLE_CLEAR_MS` | 3000 | Silence after which the next strike starts a fresh line at the left (nothing is wiped before that strike). |
| `STALE_CLEAR_MS` | 30000 | Silence after which an untouched staff is emptied outright. |

Gesture thresholds are verified against real recordings with the replay harness.
Chord-whole and lifted-together-whole must each be >=90%. The former absolute-C4
"RH-on-bass" heuristic is informational only: an upper part can correctly be below C4,
and a lower part can correctly be above it. Labeled phrases, original-pitch coverage,
and register-epoch consistency are the adaptive assignment gates.

Mechanics worth knowing:

- **Onsets drive it; releases only refine it.** A note stays on the staff after release
  until it scrolls off or the line resets. Releases do two things: freeze a held
  column's duration, and split a young column that turns out to be a legato line. A
  column more than one back never changes shape.
- **Grouping uses the timestamp the note arrived with**, not `Date.now()` at effect
  time. Be precise about what that stamp is: `useMidiSubscription` takes `Date.now()`
  when the browser handles the WebSocket message, so it carries the piano → Jamcorder →
  backend → WS latency and is **not** a device-side capture time. It is still the better
  of the two available clocks — per-message granularity, where effect time can collapse
  notes milliseconds apart into one identical `Date.now()` through React batching.
  `GAP_MS` and the legato thresholds are therefore tuned against transport-inclusive
  jitter, which is a reason to re-check them on the real instrument.
- **Live staff assignment uses phrase context**, described below. `splitByHand()`
  remains the compatible stateless fallback for unplanned exercise/game callers;
  its C4 boundary and 14-semitone reach are not live-planner prohibitions.
- **A roll is per staff.** The column carries its arrivals (`{ midi, at }`); each staff
  draws its own stroke from `staffRoll`: needs >= 2 heads on that staff, its own
  arrivals spanning `ROLL_MARK_MS`, direction from its first arrival against its last.
  One-note staves get no stroke. The renderer, the live log and the replay harness all
  go through `columnRolls`, so the strokes counted are the strokes drawn.
- **Columns are spaced by duration, floored at what their ink needs**
  (`chordStaff.js` `layoutColumns`). Widths are in units of `W_Q`, a quarter's width:
  the room a C-major line has after its clef, over 8 — the old grid's slot width
  (floored at 54 units so a sidebar staff stays readable). An eighth takes 2/3 `W_Q`, a
  quarter 1, a half 4/3 — close to engraving's square-root spacing, so at the Studio pane
  (`W_Q` ≈ 71) an all-quarter line in C shows 8 columns and an all-eighth run 12. Head to head:
  `x[i+1] = x[i] + max(width(i), right(i) + 6 + left(i+1))`, where `left`/`right` are the
  columns' ink reach from VexFlow's tick-context metrics (accidentals, roll stroke,
  displaced heads, flag) plus two things the metrics miss — an 8va/8vb label's drawn
  width, and the second head of a letter spelled both ways in one chord (E with E♯ on
  one line) — measured over BOTH stem directions because a beam group can
  flip a column's stem after it is drawn. The 6-unit gap is sized from the ink sweep
  (VexFlow's metrics run ~2.5 units short of drawn outlines; the sweep gates on 2 units of
  real air between neighbours). The formatter only lays each column out internally; every
  column's tick context is then pinned to its `x` (the tick context, not `x_shift`, so
  accidentals and strokes move with their notes). The line starts late enough for the
  first column's left ink to clear the key signature.
- **Nothing already drawn moves while you play.** A column's `x` depends only on the
  columns to its left. A closed column's width comes from the duration it CLOSED with
  (`closeDuration` on the flow column, passed as `widthDuration`): a later hold
  promotion to a half changes the glyph, not the width. Only the newest column's width
  tracks its provisional duration (8 → q → h), and nothing is to its right. One thing
  CAN move the line between strikes: a key change. A wider key signature takes room, so
  the oldest column may drop off the left and the line shifts (the scroll); a key change
  respells the columns anyway.
- **The window is the newest columns that fit**, at least one. When the newest grows
  past the room, or a new column arrives, the oldest drops off the left and the line
  shifts — the scroll. `chordStaffWindow` exposes the same layout without drawing, and
  the replay harness lists exactly those columns. The window is measured from the real
  key signature, so seven sharps leave room for a column or so fewer than C; a
  quarter's width never depends on the key, so a modulation never re-spaces the line.
- **Consecutive eighths on a staff beam as one group with ONE stem direction** — down
  when the noteheads of the group's FIRST TWO columns sit on or above the middle line on
  average, up below — so a melody crossing the middle line reads as one line instead of
  breaking at every stem flip, and appending notes never flips stems already drawn.
  Groups and directions are VOTED on the durations the columns closed with
  (`widthDuration`, the newest counting as the eighth it starts as), while beams are
  DRAWN only through columns still drawn as eighths. So a held column promoted to a
  half shows its half without its neighbours re-voting their stems, and when the newest
  grows to a quarter and leaves a pair, the other eighth keeps the direction it was
  drawn with (with a flag). Groups and directions are planned BEFORE the formatter runs,
  so accidentals and strokes are laid out around the displaced heads of the final
  direction; the Beam objects are built after positioning.
- **An off-staff note never drags a beam off the frame.** A note outside the staff whose
  stem the group would turn away from the staff (a high ledger note stemmed up, a low one
  stemmed down) keeps its own flag and splits the group, which keeps every beam inside
  the fixed frame (ink sweep: 0 clipped).
- **Cross-staff clearance uses the actual opposing notes**, including ledger notes
  outside the five lines. Near the gap, bass-down/treble-up wins when safe; flags
  and local octave labels also have to remain inside the frame. If neither direction
  gives clearance, one staff's whole note/modifier group is displaced horizontally
  using its own tick context, and the width is reserved before column placement.
  Beam groups retain their established direction and split at incompatible extensions
  or clef-register changes.
- **A note with an ottava marker is never beamed.** Its 8va/8vb/15ma/15mb label is
  placed from the note's own stem end; under a beam that end is the beam, and the label
  drew on top of it. The marked note keeps its own stem and flag and splits the group.
- **One letter, one staff position — on the staff.** The chord speller can write two
  neighbouring pitch classes with one letter (A and A♯ in F♯ major), which puts two
  heads on one line and an accidental through the other head. The staff alone rewrites
  the altered one to its other spelling (A♯ → B♭) when that letter is free in the column
  (`separateLetters`); the chord-name plaque keeps the speller's names. When that free
  letter is the only one, the respelling can put a ♯ in a flat key (or a ♭ in a sharp
  key): one line per note wins over the key's accidental habit.
- **The tick is part of the model.** The staff re-reads the clock every 80ms:
  `clearIfIdle` (fresh line after `IDLE_CLEAR_MS`, emptied after `STALE_CLEAR_MS`) and
  `pushReleases` (so a pending legato split settles on the tick, not only on the next
  key event). A hold-aware half is frozen at its release.
- **Every column is spelled in the CURRENT key** (`buildRenderColumns`), so letters
  always agree with the key signature beside them. An earlier design froze each closed
  column's spelling; after a key change that drew a double flat under six sharps, which
  is worse than a respell, so the cache was dropped. A key change respells history —
  made rare by hysteresis.
- **The key holds still** (`detectKey`): a rival must beat the current key's own
  Krumhansl–Kessler score by 10% and the buffer must hold 8 notes before a known key
  yields (an unknown one adopts at 5). One chromatic improvisation re-detected its key
  90 times in 4.5 minutes at 5% / 5 notes.
- **A light pulse, claiming no meter.** Each column carries `unitStart` — where it
  starts in eighth-units (8 = 1, q = 2, h = 4, by close duration), counted from the line
  start or the last breath — set when it OPENS, so it never shifts and travels with the
  column when the oldest scrolls off. A beam never crosses a boundary of 4 units (two
  beats: eighths group in fours, 4/4-style), and a group whose vote (its first two) would
  push one of those two out (off the frame or into the other staff) takes the other
  direction. A breath (`breathBefore`, `BREATH_RATIO`) draws one thin bar line across
  both staves before the column after it — only once that column exists — and restarts
  the count; none is drawn before the first column on screen. The bar adds `BAR_SPACE`
  (12) to the step into that column and sits `BAR_AIR` (6) left of its leftmost ink, so
  it clears accidentals and strokes (ink sweep: 0 of ~30k bars within 2 units of ink).
  Replay: 1.57 beat groups per phrase, 65% of them full fours.
- **Ghost notes fill the staff a column doesn't touch**, keeping the two hands
  column-aligned without printing a rest (a rest would be a rhythmic claim).
- **Ink clearance is a release gate**, not a claim inferred from note grouping.
  The sweep checks clipping, neighboring-column air, beams, breath bars and actual
  cross-staff glyph masks. The focused register gate independently reconstructs
  sounding MIDI from rendered note positions, accidental outlines and visible octave
  indications. Forearm-sized stress clusters remain separately reported.
- **Accidentals are resolved per column against the key only** — deliberately not
  VexFlow's `Accidental.applyAccidentals`, whose measure semantics would print a
  repeated F♯'s sharp once and leave the second bare, reading as a different note on a
  live display. Watch out: parse the accidental positionally, since the letter `b` is
  itself a `'b'` (`spelling.includes('b')` marked every B natural as B flat).
- **Octave interpretation belongs to a register epoch** in the live staff. A local
  residual ottava is available for an outlier or acquisition fallback. Legacy
  unplanned callers retain the per-column ottava behavior.

## Adaptive staff assignment and register

`staffPlanner.js` owns the live decisions. It consumes distinct onset gestures,
not the median of accumulated held keys, and shares its original-pitch assignments
with roll strokes, measurement, the VexFlow renderer and corpus replay. Stable flow
column IDs distinguish equal timestamps; origin IDs keep a delayed legato split from
becoming new register evidence.

The planner ranks lower/upper partitions and octave pairs -2..2 using staff-center
and ledger burden, continuity, reach and predicted clearance. Compact groups may
contain both parts. It considers local whole-chord octave fitting before choosing
membership, so acquisition does not flatten two remote ranges onto one staff.

At most eight distinct origins contribute evidence; plans retain at most sixteen
columns. Acquisition needs four origins, three consecutive challenger votes, and
an improvement of at least `max(1, 20% of incumbent cost)`. A change takes effect at
a new column on a breath or four-eighth-unit group boundary. No-op ticks, key changes,
releases, growing rolls and hold promotions do not add votes. Ties favor the current
reading. A paired shift is preferred for a whole passage played lower/higher;
independent changes are allowed when one part moves.

The clef carries a small 8 or 15 above/below it. Positive register means sounding
above the written notes; negative means sounding below them:

```text
displayed MIDI = sounding MIDI - 12 * (clef octave + residual octave)
```

An inline clef marks each forward change, including an ordinary clef on return to
zero. The left header describes the first visible epoch when older columns scroll
away. Completed assignments/epochs are not reinterpreted; the newest two columns
remain provisional while gesture/release refinement is possible. Sound, chord names,
recording and grading always use original MIDI.

This assigns musical parts, not known physical hands. An isolated note and crossed
or overlapping lines can be ambiguous. Display begins immediately with a conservative
reading. The register may take several gestures to settle; rare local octave marks
are preferable to a prematurely changing header. The pure model is published through
the capability's `staffPlanner.js` facet and browser index. Optional ABC snapshots
consume the same plan; abcjs double-octave snapshots use explicit 15ma/15mb text and
sounding transpose because that library does not implement double-octave clefs.

## Harnesses (run after changing flow, assignment or engraving)

- `node tests/_infrastructure/harnesses/chord-staff-register-check.mjs`: 1,201 focused
  key/aspect/duration/register cases, with positive controls for overlap, incorrect
  clef sign and a missing notehead. Pass an optional `rendered-columns.json` path
  to verify the exact captured replay moments with the same independent oracle. The browser reads actual drawn pitch and ink.
- `node tests/_infrastructure/harnesses/chord-staff-ink-sweep.mjs`: the full 151,944-case keyboard,
  chord, key, duration and aspect sweep. Independent cross-staff raster masks confirm
  suspected geometric contact; zero ordinary clipping/collisions is required.
- `node tests/_infrastructure/harnesses/chord-staff-replay.mjs --data <data> --media <media>`:
  read-only replay of Studio takes and MIDI history through the live planner. Exit 1
  means a failed chord/staff invariant gate; exit 2 means setup/crash/empty corpus.
  Private corpora must be explicitly available; absence does not pass.
  `--render <dir>` writes selected images, `moments.json`, `rendered-columns.json`
  and an index. `--moments <manifest>` reuses exact event indices for comparisons.
  Existing `--users`, `--limit`, `--since`, and grouping-threshold sweep options remain.

Replay still models one event per render and per-event arrival timestamps. Real
React batching and coarse release timestamps can change gesture grouping; passing
replay does not establish physical-hand truth or replace checking rendered examples.
Use the configured data/media paths; never recursively crawl the SMB mount.

## Live logs

`CurrentChordStaff` (component `current-chord-staff`) emits two sampled **debug** events,
20 a minute each: `chord-staff.column-closed` (notes, span, per-staff roll, duration) as
each column closes, and `chord-staff.legato-split` (`notes`, `next`, `stepMs`) when a
release splits a drawn column into a legato line. Enable with `DAYLIGHT_LOG_LEVEL = 'debug'`.
Register transitions also emit `chord-staff.register-changed` at info; engraving
displacements emit sampled `chord-staff.engraving-fallback` at debug.

## Guardrail

`piano-theory-panel.runtime.test.mjs` measures real `getBoundingClientRect` boxes on
`/piano/studio` and fails if the circle, staff, or chord plaque escapes the top-pane
box — at rest and while a high note is held (the exact regression trigger). It also
asserts the staff viewBox is landscape, proving the aspect-fill ResizeObserver is live.
Run it against a specific dev server with `BASE_URL=http://localhost:<port> npx
playwright test tests/live/flow/piano/piano-theory-panel.runtime.test.mjs`.
