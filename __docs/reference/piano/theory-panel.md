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
half) are coarse ratios against a moving baseline, never a measured tempo.

| Constant | Default | What it decides |
|---|---|---|
| `GAP_MS` | 150 | Longest silence between successive onsets of one gesture, measured from the column's **last** onset. An onset also joins only while every key already in the column is still down. |
| `SPAN_MAX_MS` | 250 | Longest a gesture may run from its first onset. |
| `MAX_COLUMN_NOTES` | 10 | Ten fingers; more is two gestures. A re-strike of a pitch already in the column also opens a new one. |
| `LEGATO_RELEASE_MS` | 160 | **Legato is not a roll.** When every key that landed before a later key of a young column (newest or second-newest) has let go, the last within this long of that key landing, and that key stays down longer, the line moved on: `pushReleases` splits the column there. A held roll never splits. |
| `LIFT_TOGETHER_MS` | 10 | Keys let go within this long of each other were lifted together — a chord (even a staccato roll), never split. The split is settled on the first `pushReleases` after this window: the next key event or the 80ms tick, whichever comes first. Chosen by the replay sweep (5/10/15/25 at GAP 150 / release 160) with the same rule as the others, since the key-up gaps show only a 0-5ms peak and no valley. The rule picked 5, but its lifted-together whole (90.6%) cleared the gate by only 0.6 points, so 10 was taken instead (92.0%, for +0.2 points of legato merged). |
| `LEGATO_MIN_STEP_MS` | 30 | A later key closer than this to the one before it was struck with it and never opens a legato split (short struck chords let go as fast as legato does). |
| `ROLL_MARK_MS` | 100 | A staff whose own arrivals span this long draws an arpeggio stroke. |
| `COLUMN_CAPACITY` | 8 | Columns held before the oldest scrolls off the left. |
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
- **Duration is a column property, and the staff snaps to the slot grid.** The VexFlow
  formatter spaces by ticks, so each slot's tick context is placed at its grid position
  (and the grid starts late enough to clear the key signature): an eighth, a quarter
  and a half sit on the same slot centres, and strokes land beside their own chord.
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
- **The formatter always lays out every slot**, padding with invisible `GhostNote`s.
  That is what makes it typewriter-like rather than rubber-band: slot 1 sits at the same
  x whether it's alone or the first of eight. Ghosts also fill the staff a column doesn't
  touch, keeping the two hands column-aligned without printing a rest (a rest would be a
  rhythmic claim).
- **How many slots is decided by the width available**, not by `COLUMN_CAPACITY`. The
  frame is fixed, so a column that doesn't fit is clipped rather than squeezed, and eight
  chords genuinely don't fit a sidebar staff — a narrow pane shows fewer, readable
  columns. The count is computed from the RESERVED head width (clef + widest key
  signature) so a modulation can't add or drop a column. The flow model still retains
  `COLUMN_CAPACITY`; this only decides how many are drawn.
- **Ordinary playing never clips horizontally** — verified by the ink sweep harness
  (`tests/_infrastructure/harnesses/chord-staff-ink-sweep.mjs`, 0 of ~38k renders). A
  twelve-note forearm cluster still can, and that is a known, accepted limit.
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
  `CurrentChordStaff` pipeline, one event per render (strictest case — the kiosk may
  batch), and prints chords kept whole, eighths, fragments, RH-on-bass, legato merged,
  rolled columns and why each split cluster split. **Two gates** (exit 1 on failure):
  chord whole % >= 90 and lifted-together whole % >= 90, plus RH-on-bass == 0. Exit 2
  means a crash, bad arguments or an empty corpus.
  - `--render <outDir>` screenshots chosen moments (VexFlow in Playwright at the Studio
    pane's size) with an index page and `moments.json`; `--moments <moments.json>`
    (needs `--render`) re-renders the SAME moments through the current code for
    before/after comparison.
  - `--sweep-gap` replays the corpus under each `GAP_MS` x `LEGATO_RELEASE_MS` pair and
    each `LIFT_TOGETHER_MS` / `LEGATO_MIN_STEP_MS` value, printing whole-chord % against
    legato merged % — how the constants were picked.
  - Also `--users a,b`, `--limit N` (captures per user), `--since YYYY-MM-DD`,
    `--media`, `--data`.

## Guardrail

`piano-theory-panel.runtime.test.mjs` measures real `getBoundingClientRect` boxes on
`/piano/studio` and fails if the circle, staff, or chord plaque escapes the top-pane
box — at rest and while a high note is held (the exact regression trigger). It also
asserts the staff viewBox is landscape, proving the aspect-fill ResizeObserver is live.
Run it against a specific dev server with `BASE_URL=http://localhost:<port> npx
playwright test tests/live/flow/piano/piano-theory-panel.runtime.test.mjs`.
