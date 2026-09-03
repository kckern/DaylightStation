# Practice-staff opacity/colour fix — report

Branch: `fix/exercise-note-opacity`
Component: `frontend/src/modules/MusicNotation/renderers/SvgSequenceStaff.jsx` (+ `.scss`, `.test.jsx`)

## The rule, restated as implemented

Opacity carries exactly one meaning: "this is your finger, not the music."
Every notated notehead — done, at the cursor, or todo — renders at full
opacity always. Colour carries everything else:

- **done** (before the cursor): jet black, full opacity.
- **todo** (at or after the cursor, at rest): brown, full opacity. This
  includes the cursor's own entry while nothing is held against it — the
  amendment's "brown ahead of you, black behind you" model.
- **active** (the cursor entry, while at least one key is held anywhere):
  colour applies **per notehead**, not per entry —
  - a target pitch being held → green, full opacity;
  - a target pitch not being held → red, full opacity, red stem *only if
    every notehead in the entry agrees* (see the mixed-chord decision below);
  - a held pitch that is not one of *this entry's* targets → a stemless,
    semi-opaque black ghost at the pitch actually played.
- Everything above is a pure function of `activeNotes` (the currently-held
  set) and `cursorIndex`. There is no other state to go stale: release a key
  and the next render is correct with nothing left over.

## The per-notehead state model

Per entry (`columns[i]` in `SvgSequenceStaff.jsx`):

```
isCursor = index === cursorIndex
active   = isCursor && attemptInProgress      // attemptInProgress = activeNotes.size > 0
state    = index < cursorIndex ? 'done'
         : active ? 'active'
         : 'todo'                              // covers "todo" AND a resting cursor entry
```

Per notehead within that entry:

```
hit       = active ? activeNotes.has(head.midi) : null
noteState = state === 'active' ? (hit ? 'hit' : 'miss') : state   // done | todo | hit | miss
```

`noteState` is the notehead's *entire* visual state — one CSS class
(`sequence-note-{done,todo,hit,miss}`), always full opacity, colour only.
The accidental glyph carries a matching modifier class
(`action-staff__accidental--{todo,hit,miss}`; `done` needs none, it's the
sheet's own base black).

The cursor rectangle (`.sequence-staff__cursor`) is unrelated to this and
unchanged — it marks *where* the cursor is regardless of attempt state.

### The ghost

Scoped to the **cursor entry's own targets**, not the whole sequence — a
held pitch that matches some other (already-done, or still-todo) entry is
just as off-target as an unrelated pitch, because it isn't what *this* entry
is asking for right now:

```js
cursorTargetMidis = new Set(entries[cursorIndex]?.midis ?? [])
heldGhosts = [...activeNotes]
  .filter(([midi]) => !cursorTargetMidis.has(midi))
  .map(([midi]) => ({ midi, ...getStaffPositionOnClef(midi, activeClef, accidental) }))
```

Rendered identically regardless of "how wrong" the pitch is — one visual
treatment (`.sequence-note-wrong-ghost`, recoloured to semi-opaque black, no
stem, class name kept for continuity with the existing measure-test/OWNED
selector list). Previously this was TWO separate mechanisms (a single
engine-tracked `wrongMidi` ghost with ledger+accidental, and a fainter
`.sequence-staff__held-ghost` for anything else); they are now one path,
driven purely by `activeNotes`, because rule 4 ("ghosts clear on key-up")
requires the ghost to be a pure function of what is *currently* held, not of
an engine flag that can outlive the key press. The previous ±ledger-band
clamp on the fainter ghost is gone too — every ghost is "always drawn",
matching what the louder ghost already did (a child needs to see how far off
they are, however far that is).

## Mixed-chord stem decision

**Decision: a mixed chord (some hit, some miss) leaves the shared stem
UNCOLOURED — the plain black ink, same as `done`.** Only a *unanimous* entry
(all hit, or all miss — which is also what every single-note ask always is)
colours the stem green or red.

Reasoning: the stem is one SVG line shared by every notehead in the column.
Painting it a single colour is inescapably an entry-level verdict — and rule
2 explicitly forbids exactly that ("NOT a verdict on the attempt as a
whole"). Each notehead already carries its own colour; a stem colour on top
of a mixed chord would either double down on one of those verdicts (which
one — the first miss? the majority?) or invent a third meaning nobody asked
for. Leaving it black when the chord is mixed says "no verdict here, read
the noteheads" — which is the literal content of the rule. A fully-hit or
fully-missed entry has no such ambiguity, so its stem takes the one colour
that's true of the whole thing.

`data-stem-state` on the entry group (`done | todo | hit | miss | mixed`)
carries this; `mixed` gets no CSS override and reads as the plain base ink.

## The brown amendment

Added `.sequence-note-todo` / `[data-stem-state='todo']` /
`.action-staff__accidental--todo` = `rgba(120, 66, 22, 1)` — a saddle-brown,
**full opacity**, defined the same way this file already defines its other
run-state colours (a literal `rgba()` in the rule; this file lives outside
`audit-ui-tokens.mjs`'s scanned `ROOTS`, so there's no shared token to reuse,
and the neighbouring green/red are the same kind of literal already — see
"Audit-ui" below). `done` no longer needs an override at all: jet black IS
the sheet's own base ink (`.action-staff__note`), so `.sequence-note-done`
now states that explicitly rather than riding on "whatever the default
happens to be" (the file's comment on this says as much).

The old model had this backwards: `done` was green and `todo` was black at
55% opacity. Both violations of the current rule (opacity used as a state
signal; done colour reused for a different, no-longer-correct meaning) are
gone.

## Prop/contract changes — every consumer updated

**`SvgSequenceStaff` no longer accepts a `wrongMidi` prop.** It is redundant
once hit/miss/ghost are all derived from `activeNotes`, and keeping it would
mean shipping a second, laggier source of truth that could disagree with the
real-time one required by rule 4 (`wrongMidi`, as `lastWrong?.midi` in
`ExerciseRun.jsx`, is engine-tracked and does not necessarily clear the
instant a key comes up).

Updated call sites:
- `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/KeysAsk.jsx` — no
  longer forwards `wrongMidi` to its internal `<SvgSequenceStaff>`. `KeysAsk`
  itself keeps its own `wrongMidi` prop unchanged (still feeds
  `PianoKeyboard`'s `wrongNotes`, a separate surface/rule not in scope).
- `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx` —
  no longer passes `wrongMidi={lastWrong?.midi ?? null}` to `<SvgSequenceStaff>`
  in the `sequence`/`single-note` stage. Still passes it to `<KeysAsk>`
  (tier 0/1) and `<ScorePassage>` (score stage), neither of which is
  `SvgSequenceStaff`-based.
- `frontend/src/modules/Piano/ask/stagecraft.js` — two doc comments referenced
  a ghost-position clamp band that no longer exists; reworded, no behaviour
  change (this file doesn't import the removed constant).

Test files updated for the dropped prop (mocks/wiring assertions, not
behaviour):
- `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/KeysAsk.test.jsx` —
  mock no longer exposes `data-wrong`; the "passes it the same
  cursor/wrong/accidental" test now asserts `data-active` (activeNotes
  forwarding) instead.
- `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.component.test.jsx` —
  same mock change; the `sequence-staff` row was removed from the
  tier/wrong-note `it.each` table (that table asserts a "wrong flag" prop
  the staff no longer takes) and replaced with a dedicated test that HOLDS a
  wrong note and asserts `data-active` — proving the run still forwards the
  live held set, which is what the real component now needs.
- `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.measure.test.jsx`
  (real-browser Playwright test) — "tier 2 draws a wrong note at ITS OWN
  height" now HOLDS the wrong note (`probe.hold([61])`) instead of
  press-and-release, matching the real-time contract: the old press-release
  helper worked only because `wrongMidi`/`lastWrong` persisted past the key
  coming up; the new component's ghost would not exist by the time the old
  test's assertions ran.

No other file in the repo imports or renders `SvgSequenceStaff` with
`wrongMidi`.

## Screenshots — real browser, real key input (not a stub)

Verified against a **live dev server** on port 3150 (backend 3151), driving
the **real app**, not a component harness. Notes were fed through the app's
own dev-only keyboard-to-MIDI fallback
(`frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.js`'s `DEV_KEY_MAP`,
active whenever `location.hostname === 'localhost'`): keys `1 3 5` → C4/E4/G4
(60/64/67), `1 2` → C4/D4 (60/62) for the scale exercise. Playwright drove
`page.keyboard.down/up` — real `keydown`/`keyup` events into the real
`activeNotes` store the whole app reads, exactly as a physical key would.

Two real bank instances, no fixtures:
- `drills/five-finger/play-cde` (`/piano/exercises/run/...`, tier 2,
  `data-stage="sequence"`) — an ordered C-D-E sequence.
- `chords/triads` (root C, major, root position; tier 1,
  `data-stage="keys"` with the tier-1 reinforcement staff shown) — a
  simultaneous C-E-G triad.

**(a) resting cursor, nothing held.** All three notes brown, full opacity;
cursor lane over note 1; nothing coloured green/red; no ghost. Confirms the
brown-amendment resting palette and rule 5 (no verdict with nothing held).

**(b) full match on a single note.** Pressed key `1` (C4, the target).
Caught ~8ms after key-down, before the assessment runtime's next tick
advanced the cursor: notehead AND stem green, full opacity, cursor still on
entry 0. (At the default screenshot delay the app advances the cursor within
~50ms and the note is already `done`/black — the fast capture is what proves
the green *hit* state exists and isn't purely theoretical.)

**(c) a chord with some notes held and some not.** Held `1`+`3` (C4+E4) of
the C-E-G triad, leaving G4 unheld. DOM dump: `midi 60 → sequence-note-hit`,
`midi 64 → sequence-note-hit`, `midi 67 → sequence-note-miss`,
`data-stem-state="mixed"`, **no** `.sequence-note-wrong-ghost` element.
Screenshot shows two green noteheads (bottom, middle) and one red (top), all
full opacity, sharing one plain-black stem. Matches the owner's worked
example and the mixed-chord stem decision exactly.

**(d) a wrong pitch held.** Released C4, cursor advanced to entry 1 (target
D4). Held `1` again (C4 — now off-target for THIS entry, even though it was
correct a moment ago for entry 0). Result: entry-1 notehead+stem red
(`sequence-note-miss`, `data-stem-state="miss"`); a semi-opaque black,
stemless ghost at C4's own staff position (`data-midi="60"`), a step below
the red target; entry 0 stays plain black (done); entry 2 stays brown
(todo).

**(e) immediately after release.** Released the held C4. Ghost gone; entry 1
reverted to plain brown (todo) — it had NOT been answered correctly, so it
does not advance and does not stay red. Pixel-sampled the (d)→(e) pair
against the mid-exercise frame below: nothing persists.

**Bonus — mid-exercise frame (amendment's explicit ask).** After playing C4
correctly and releasing: entry 0 pure black (`rgb(0,0,0)`, sampled directly
from the PNG), entries 1–2 brown (`rgb(120,66,22)`, sampled directly from the
PNG — exactly the SCSS literal). **Black and brown are clearly
distinguishable in the captured image** — this is not a lightness/opacity
difference (a "faded black" would sample as a grey, e.g. ~`rgb(128,128,128)`
at 50%); it's a genuine hue change at full opacity, sampled pixel-for-pixel
against the two literal colour values in the stylesheet. The same frame with
an attempt in progress (state (d) above) shows the identical black/brown
split behind/ahead of an actively-coloured cursor entry, satisfying the
"second frame" the amendment asked for.

All five original states plus the chord case plus the two amendment frames
were captured; DOM state (`data-state`, `data-stem-state`, `data-midi`,
notehead classes) was dumped via `page.evaluate` alongside every screenshot
so the visual read and the underlying contract could be checked against each
other, not just eyeballed.

## Deliberate breakage — pinning the contract

Five targeted, one-line breaks to `SvgSequenceStaff.jsx`, each run against
`SvgSequenceStaff.test.jsx`, each restored via a clean copy of the file
before the next:

1. **Rule 1 (opacity).** Added `opacity={head.noteState === 'todo' ? 0.5 :
   undefined}` to the notehead. → 1 test failed: *"never sets a
   partial-opacity attribute on a notated notehead, done or todo"*
   (`expected '0.5' to be null`). Restored — 45/45 pass.

2. **Rule 5 (colouring gated on an attempt).** Changed
   `active = isCursor && attemptInProgress` to `active = isCursor` (ignores
   whether anything is held). → 5 tests failed, all in "an attempt in
   progress at the cursor" / rule-4 revert: the resting cursor now showed
   `miss` (permanently red) with nothing held. Restored — 45/45 pass.

3. **Rule 3 (ghost scoped to the cursor entry).** Inverted the ghost filter
   (`if (!cursorTargetMidis.has(midi)) continue;`, i.e. ghost only a TARGET
   pitch). → 11 tests failed across "the off-target ghost" (ghosts vanished
   for genuinely off-target pitches; a held target pitch nonsensically
   ghosted instead). Restored — 45/45 pass.

4. **Mixed-chord stem decision.** Changed the stem rule to
   `drawn.some(h => h.noteState === 'hit') ? 'hit' : 'miss'` (any hit colours
   the whole stem green). → 1 test failed: *"a mixed chord leaves the shared
   stem uncoloured"* (`expected 'hit' to be 'mixed'`). Restored — 45/45 pass.

5. **Rule 2 scoping (colouring must stay on the cursor entry only).**
   Changed `state = index < cursorIndex ? 'done' : active ? 'active' :
   'todo'` to `index < cursorIndex ? 'done' : 'active'` (every entry from the
   cursor onward is permanently "active", regardless of index or hold
   state). → 7 tests failed (future/other entries picking up hit/miss
   colouring; ghost-revert test breaking because a second entry stayed
   coloured). Restored — 45/45 pass.

`git diff --stat` on `SvgSequenceStaff.jsx` before and after each break/
restore cycle confirmed an exact revert (`diff` against a saved pristine
copy was empty each time) before moving to the next break.

## Test commands and real output

```
$ npx vitest run frontend/src/modules/MusicNotation/
 Test Files  25 passed (25)
      Tests  348 passed (348)

$ npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Exercises/
 Test Files  12 passed (12)
      Tests  231 passed (231)
```

(`ExerciseRun.measure.test.jsx`, the real-Chromium layout-engine suite, is
inside that second directory and is included in the 231/12 above — its own
run in isolation: 19/19 passed, ~39s.)

`SvgSequenceStaff.test.jsx` alone (the file most heavily rewritten): 45/45,
up from 35 (10 new tests: the resting-palette/attempt/ghost-scoping
contract, the mixed-chord and fully-hit/fully-missed chord cases, and the
release-clears-everything round-trip).

```
$ npm run audit:ui
raw-color             546 (baseline 548) ok
raw-motion             74 (baseline 75) ok
raw-keydown             4 (baseline 4) ok
native-control         43 (baseline 43) ok
undefined-token        12 (baseline 12) ok

$ node scripts/check-parse.mjs
Parse gate OK — 9042 parsed, 9541 files scanned for conflict markers.
```

(`MusicNotation`/`Piano` are outside `audit-ui-tokens.mjs`'s scanned
`ROOTS` list, so this file's raw `rgba()` literals were never counted either
before or after this change — consistent with how its existing green/red/
ghost colours were already written, which is what "use the way the
neighbouring colours are defined" means for this specific file.)

## Concerns / notes for the owner

- No `check:scss` npm script exists in this repo (the task brief assumed
  one). Verified SCSS syntax directly by compiling
  `SvgSequenceStaff.scss` with the repo's own `sass` package (`sass.compile`)
  — clean compile, 3.6KB output — and via the real esbuild+sass-embedded
  bundle `ExerciseRun.measure.test.jsx` builds and runs Chromium against,
  which is the only place in the repo that actually compiles this
  component's shipped stylesheet end to end.
- The `sequence-note-wrong-ghost` / `sequence-staff__ghost-accidental` /
  `sequence-staff__ghost-ledger` class names are kept from the old,
  single-purpose "wrong note" mechanism even though they now serve EVERY
  off-target ghost (not just an engine-flagged one) — deliberate, to avoid
  churning the real-browser measure test's `OWNED` stylesheet-selector guard
  and its position/paint assertions, which still hold under the new,
  unified meaning.
- Getting a real browser onto a genuinely free port required a local overlay
  data directory (symlinks to the real Dropbox-mounted `data/`, with a
  private `system/config/system.yml` overriding just `app.ports.default` to
  3150) — the shared config volume is read-only to this agent and I did not
  want to write a new port entry into it. Nothing under `data/` was
  modified; the overlay lived entirely in the scratchpad and is not part of
  this commit.

## Commit

See the commit this report accompanies for the exact SHA.
