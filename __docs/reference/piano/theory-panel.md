# Theory Panel

The **TheoryPanel** is the shared music-theory composite shown alongside the piano
kiosk's Studio and Videos modes: a circle of fifths, a live "current chord" grand
staff, and a chord-name plaque, all reading from the same live MIDI surface.

- Component: `frontend/src/modules/Piano/components/TheoryPanel.jsx` (+ `TheoryPanel.scss`)
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

The fix is a constant frame (`FRAME_TOP`/`FRAME_BOTTOM` in `chordStaff.js`) that always
reserves the worst-case headroom. The bounds are measured, and the thing that measures
them is committed: `node tests/_infrastructure/harnesses/chord-staff-ink-sweep.mjs`
renders ~38k cases and exits non-zero if any ink lands outside the frame. Current
extremes: ink y ∈ [30.5, 249.2], x ≥ −6 (the brace overhangs the stave's left edge).
Ottava shifting is what bounds it: the displayed range can never exceed A6 on top or
go below E2 at the bottom, so only those notes' ledger lines and the 8va/8vb markers
reach the extremes.

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

**This is not meter.** No time signature, no barline, no quantisation, no rests. The
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
| `LIFT_TOGETHER_MS` | 10 | Keys let go within this long of each other were lifted together — a chord (even a staccato roll), never split. The split is settled on the first `pushReleases` after this window: the next key event or the 80ms tick, whichever comes first. Chosen by the replay sweep (5/10/15/25 at GAP 150 / release 160) with the same rule as the others, since the key-up gaps show only a 0-5ms peak and no valley. The rule picked 5, but its lifted-together whole (90.6%) cleared the gate by only 0.6 points, so 10 was taken instead (92.0%, for +0.2 points of legato merged). |
| `LEGATO_MIN_STEP_MS` | 30 | A later key closer than this to the one before it was struck with it and never opens a legato split (short struck chords let go as fast as legato does). |
| `ROLL_MARK_MS` | 100 | A staff whose own arrivals span this long draws an arpeggio stroke. |
| `BREATH_RATIO` | 2.0 | A gap of at least this × baseline before a column is a breath: a thin bar line before it, and the beat count restarts. Same as the half threshold, so a bar marks where a phrase rested. Replay: ~20 per take, about one per 10 columns. |
| `SMOOTH_RATIO` | 1.15 | A column after an eighth whose gap lands within 15% above the eighth → quarter cut-off closes as an eighth (decided at close; the newest's provisional glyph uses the same cut-off). Replay: 3.2% of columns. |
| `COLUMN_CAPACITY` | 16 | Columns the model keeps. Not how many are drawn — the renderer draws the newest that fit (see the layout rule below); 16 covers the densest line (~12 eighths at the Studio pane). |
| `IDLE_CLEAR_MS` | 3000 | Silence after which the next strike starts a fresh line at the left (nothing is wiped before that strike). |
| `STALE_CLEAR_MS` | 30000 | Silence after which an untouched staff is emptied outright. |

`GAP_MS`, `LEGATO_RELEASE_MS`, `LEGATO_MIN_STEP_MS` and `LIFT_TOGETHER_MS` were chosen by replaying real
playing: `node tests/_infrastructure/harnesses/chord-staff-replay.mjs --sweep-gap`
prints chords kept whole against legato steps merged for each pair; the plain run
gates on chords kept whole >= 90%, chords lifted together kept whole >= 90% (an
independent population: every key let go within 30ms) and no right-hand chord on the
bass staff. The choice rule: both gates >= 90%, held chords kept whole >= 95%, then the
fewest legato steps (lifted in sequence) drawn as one column.

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
- **Hands are inferred from register first** (`model/handSplit.js`, `splitByHand`). A
  column that fits under one hand (span <= `HAND_SPAN`, 14 semitones) is ONE hand: whole
  to treble when its mean is at/above middle C (`HAND_PIVOT`, 60), else whole to bass.
  A wider column that straddles middle C is two hands, divided at the best split point
  over every possible one (both hands within reach, then fewest notes on the wrong side
  of C4, then least overflow, then widest gap). A wider column wholly on one side of C4
  stays whole in that clef (the **one-side rule**): splitting it to satisfy reach drew
  right-hand notes on the bass staff, the original complaint (the replay gate counts
  that as a fault and requires zero). Known limit: a left-hand Alberti figure in the
  C4 octave reads as treble — telling it apart needs voice tracking across columns.
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
- **No beam crosses into the other staff.** A stem runs 3.5 spaces past its farthest
  head and the staves are 2.6 spaces apart, so a treble note stemmed down below G4
  (line 1.9) or a bass note stemmed up above F3 (line 4.1) would carry the beam into the
  other staff's lines — where it once crossed the other hand's beam. Such a note leaves
  the group like an off-staff note does (own stem, own flag). A note with no beam whose
  own stem would do the same (a wide treble chord, E♭4 under A5 B♭5, stems down by
  auto_stem) is turned to its staff's outer side instead, when that stays in the frame.
  The ink sweep gates on 0 beams entering the other staff and reports lone stems.
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
- **Ordinary playing never clips, and neighbouring columns never collide** — verified
  by the ink sweep harness (`tests/_infrastructure/harnesses/chord-staff-ink-sweep.mjs`:
  ~152k renders including 16-column flows; 0 clipped, 0 neighbouring-column pairs under
  2 units of air, which is part of its exit code). A twelve-note forearm cluster can
  still overrun a narrow pane, a known, accepted limit.
- **Accidentals are resolved per column against the key only** — deliberately not
  VexFlow's `Accidental.applyAccidentals`, whose measure semantics would print a
  repeated F♯'s sharp once and leave the second bare, reading as a different note on a
  live display. Watch out: parse the accidental positionally, since the letter `b` is
  itself a `'b'` (`spelling.includes('b')` marked every B natural as B flat).
- **Ottava is decided per column**, so one low bass note gets its own 8vb without
  dragging the rest of the phrase down an octave.

## Harnesses (run these after touching the flow, split or renderer)

Both are committed under `tests/_infrastructure/harnesses/` and need the real corpora
(`DAYLIGHT_DATA_PATH`, optionally `DAYLIGHT_MEDIA_PATH`; read-only).

- **Ink sweep** — `node tests/_infrastructure/harnesses/chord-staff-ink-sweep.mjs`.
  Renders ~38k cases and exits non-zero if any ink leaves the fixed frame.
- **Replay** — `node tests/_infrastructure/harnesses/chord-staff-replay.mjs`. Replays the
  Studio takes and the always-on MIDI capture history through the exact
  `CurrentChordStaff` pipeline, one event per render, and prints chords kept whole, eighths, fragments, RH-on-bass, legato merged,
  rolled columns and why each split cluster split. **Two gates** (exit 1 on failure):
  chord whole % >= 90 and lifted-together whole % >= 90, plus RH-on-bass == 0. Exit 2
  means a crash, bad arguments or an empty corpus.
  - Its gate figures are an **upper bound** for the kiosk: the harness feeds one event per
    render at the event's own time, while on the kiosk React may batch several events
    into one render, and a key-up is stamped at effect or 80ms-tick time (not on receipt,
    as arrivals are), so release timing — and with it the legato split — is coarser there.
  - `--render <outDir>` screenshots chosen moments (VexFlow in Playwright at the Studio
    pane's size) with an index page and `moments.json`; `--moments <moments.json>`
    (needs `--render`) re-renders the SAME moments through the current code for
    before/after comparison.
  - `--sweep-gap` replays the corpus under each `GAP_MS` x `LEGATO_RELEASE_MS` pair and
    each `LIFT_TOGETHER_MS` / `LEGATO_MIN_STEP_MS` value, printing whole-chord % against
    legato merged % — how the constants were picked.
  - Also `--users a,b`, `--limit N` (captures per user), `--since YYYY-MM-DD`,
    `--media`, `--data`.

## Live logs

`CurrentChordStaff` (component `current-chord-staff`) emits two sampled **debug** events,
20 a minute each: `chord-staff.column-closed` (notes, span, per-staff roll, duration) as
each column closes, and `chord-staff.legato-split` (`notes`, `next`, `stepMs`) when a
release splits a drawn column into a legato line. Enable with `DAYLIGHT_LOG_LEVEL = 'debug'`.

## Guardrail

`piano-theory-panel.runtime.test.mjs` measures real `getBoundingClientRect` boxes on
`/piano/studio` and fails if the circle, staff, or chord plaque escapes the top-pane
box — at rest and while a high note is held (the exact regression trigger). It also
asserts the staff viewBox is landscape, proving the aspect-fill ResizeObserver is live.
Run it against a specific dev server with `BASE_URL=http://localhost:<port> npx
playwright test tests/live/flow/piano/piano-theory-panel.runtime.test.mjs`.
