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

**This is not rhythm.** No meter, no time signature, no quantisation, no rests — every
column is engraved with the same neutral quarter notehead. The horizontal axis carries
order only, so a rolled chord reads as a roll and an arpeggio reads as an arpeggio.

| Constant | Default | What it decides |
|---|---|---|
| `SIMULTANEITY_MS` | 45 | Onsets within this window of the **column's start** stack into it; later ones open a new column. Above the jitter of a two-hand strike (~30ms), below a musical roll (60ms+). Measured from the column start, not the previous note, so a slow roll can't daisy-chain into one stack. |
| `COLUMN_CAPACITY` | 8 | Columns held before the oldest scrolls off the left. |
| `IDLE_CLEAR_MS` | 1600 | Silence after which the line resets so the next phrase starts at the left. |

Mechanics worth knowing:

- **Onsets drive it, not held keys.** A note stays on the staff after release until it
  scrolls off or the line resets. This replaced the old note-decay/peak-chord scheme,
  which existed to stop a chord crumbling as fingers lifted unevenly — a problem the
  flow doesn't have, since a column is fixed the moment it is struck.
- **Grouping uses the timestamp the note arrived with**, not `Date.now()` at effect
  time. Be precise about what that stamp is: `useMidiSubscription` takes `Date.now()`
  when the browser handles the WebSocket message, so it carries the piano → Jamcorder →
  backend → WS latency and is **not** a device-side capture time. It is still the better
  of the two available clocks — per-message granularity, where effect time can collapse
  notes milliseconds apart into one identical `Date.now()` through React batching.
  `SIMULTANEITY_MS` is therefore tuned against transport-inclusive jitter, which is a
  reason to re-check it on the real instrument.
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

## Guardrail

`piano-theory-panel.runtime.test.mjs` measures real `getBoundingClientRect` boxes on
`/piano/studio` and fails if the circle, staff, or chord plaque escapes the top-pane
box — at rest and while a high note is held (the exact regression trigger). It also
asserts the staff viewBox is landscape, proving the aspect-fill ResizeObserver is live.
Run it against a specific dev server with `BASE_URL=http://localhost:<port> npx
playwright test tests/live/flow/piano/piano-theory-panel.runtime.test.mjs`.
