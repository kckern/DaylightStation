# Piano gate run: missing progress chrome, a cursor that does not contain its note, and two notation SSOT breaks

**Date:** 2026-09-13
**Surfaces:** piano kiosk (yellow-room tablet), office screen
**Reported from:** live observation at the piano + the log store, 2026-09-13 ~16:19–16:21

Four defects, found together while watching a sight-reading gate run immediately
before a Connect Four launch. They are separate faults with separate fixes; they
share only the screen they appear on.

---

## What the logs say happened

The gate ran three times in two minutes, each one the price of a Connect Four
launch. Every run passed and every run was the same rung:

| time | event | material |
|---|---|---|
| 16:19:00 | `gate.attempt` / `piano.exercise-runtime-installed` | `keys/lit@notes=3,arrangement=sequence,reps=3,pick=0` |
| 16:19:20 | `piano.exercise-complete` `score:0.875` | 9 expected notes, 9 matched |
| 16:19:24 | `game.ladder-loaded` | `connect-four`, level 7 |
| 16:20:13 | `gate.attempt` | `…,pick=1` |
| 16:20:23 | `piano.exercise-complete` `score:0.909` | 9 / 9 |
| 16:20:26 | `game.ladder-loaded` | `connect-four` |
| 16:20:53 | `gate.attempt` | `…,pick=2` |
| 16:21:15 | `piano.exercise-complete` `score:0.875` | 9 / 9 |

`notes=3, reps=3` is the 3×3 the run shows: **three pitches, three consecutive
cards each, nine cards in the deck** (`gateMaterial.js:93-103`, pinned by
`ask/flashcardLevel.test.js`). The rung is `sightread-1`, tier 1, presentation
`{ prompt: read, secondary: keyboard-strip, notationStyle: flashcard }` — so the
run mounts the `single-note` flashcard stage: one big notehead at a time, plus a
keyboard strip underneath.

The same two minutes also carry the other child's chess gate on the scale drill
(`scales/modes@root=D,…`, rung `L2`), which is the run that *does* get the
progress chrome — and that contrast is problem 1.

---

## Problem 1 — the 3×3 deck shows no progress chrome; the approved pills never render

**What is on screen now:** two lines of text above the card (the framing line and
the ask sentence), the card, then one or two lines of instruction text below it
("Play the first note to begin." → "Follow the highlighted notes. Hold the lowest
and highest keys for two seconds to leave."). Nothing says which of the three
pitches is being asked, or which of its three reps is in flight.

**What should be there:** the drill chrome that already exists and was already
approved — `DrillProgress` (`modes/Exercises/DrillProgress.jsx`): one cluster per
set, one ring per rep, banked rings filled, the in-flight rep drawn as a ring
that fills. It ships, it has tests (`DrillProgress.test.jsx`), and it renders
today for the scale drill.

**Root cause — it is wired to one material kind only.** `ExerciseRun` builds the
chrome from host-supplied program coordinates:

```js
// ExerciseRun.jsx:991
const drillProgress = programId && stepId ? (<DrillProgress … />) : null;
…
{drillProgress ?? standingInstruction}          // ExerciseRun.jsx:1137
```

`programId`/`stepId` reach it only from `GameGate.jsx:885-887`, and the gate only
ever sets them for `{ kind: 'drill' }` material (`gateDrill.js` →
`GameGate.jsx:503-517`). A `{ kind: 'keys' }` rung — which is what
`sightread-1` is — passes neither, so `drillProgress` is `null` and the
`standingInstruction` fallback renders instead. That fallback is the text the
user is describing: *"all that's really ugly and nobody even reads it."*

So the set/rep structure is genuinely present in the material (nine events in
three consecutive-identical groups, ids `lit-1-1 … lit-3-3`) and is simply never
projected into the chrome that exists to draw it.

**Fix direction:** derive a `DrillProgress`-shaped projection from the
instance's own event grouping (consecutive events with identical note content =
one set; the group's length = its `required_passes`; the cursor's position =
`pass_count`), and hand it to the same component. The host-supplied drill
projection keeps precedence when there is one. Then drop the standing
instruction and the ask sentence on any run that has chrome — the pills say
where you are and the card says what to play, and the drill path already
established that a run with pills does not also get told what to do.

Labels must NOT name the pitch on a reading rung: a cluster labelled "C4" hands
the child the answer they are being asked to read off the staff. The clusters
carry no label at all here (`DrillProgress` already renders an empty label
when a step declares none — the placard needs the matching guard so it does not
draw an empty line).

---

## Problem 2 — the cursor lane does not contain middle C

`SvgSequenceStaff` draws the cursor as a lane behind the notehead
(`SvgSequenceStaff.jsx:400-408`):

```js
y={TOP_PAD - LINE_SPACING}          // 28 - 14  = 14
height={LINE_SPACING * 6}           // 84       → bottom edge at y = 98
```

Middle C on a treble staff is staff position **−2**, which is
`BOTTOM_LINE_Y − (−2 × STEP_SIZE)` = **y = 98** — exactly the lane's bottom
edge. With `NOTEHEAD_RY = 6.5` the notehead runs to y = 104.5 and its ledger
line sits on y = 98, so **the lower half of the note and its whole ledger line
fall outside the cursor.** This is the "middle C spilled out of it" the user
saw, and C4 is one of the commonest cards the deck deals.

The same arithmetic bites at the top, harder: the deck's pitch pool reaches
**C6** (`WHITE_KEYS` ends at 84), staff position 12, **y = 0** — the cursor's
top edge is y = 14, and the viewBox itself starts at 0, so a C6 card loses the
top of its notehead to the SVG viewport as well as to the cursor.

**Fix direction:** the lane must span the full band the engraver can draw ink
in — one ledger position beyond each staff edge plus a notehead radius plus air
— rather than a hard-coded six line-spacings, and the viewBox needs the same
headroom so the top card is not clipped.

---

## Problem 3 — two ghost-note treatments in one house

A ghost note (a held key drawn where it actually lands) has two different looks
depending on which engraver drew it:

| renderer | ghost treatment | landed |
|---|---|---|
| `SvgSequenceStaff` | **filled semi-transparent black** — `fill rgba(0,0,0,0.45)`, `stroke rgba(0,0,0,0.6)`, solid, width 1 (`SvgSequenceStaff.scss:171-175`) | 2026-08-27 |
| `SvgStaffRenderer` | **hollow and dashed** — `fill: none`, `stroke rgba(0,0,0,0.55)` width 1.6, `strokeDasharray "3.5 2.5"`; ledger lines dashed too (`SvgStaffRenderer.jsx:294-297`) | 2026-09-11 |

`StaffNoteLabel` — the rim card shared by every addressed-board game (chess's
file/rank rim, checkers' rim, Connect Four's column rail) — renders through
`SvgStaffRenderer`, so those boards show dashed hollow ghosts while the exercise
run beside them shows solid translucent ones.

The dashed treatment was itself a fix: the commit that introduced it
(`0907aa4de`, "a card a child can recognise twice") was replacing
`fill rgba(0,0,0,0.15)` at `opacity 0.5` — about 7% black on a paper card,
effectively invisible — and reached for an outline instead of for the house
value. The house value (45% fill) solves the same visibility problem without
inventing a second vocabulary.

**Fix direction:** `SvgStaffRenderer`'s ghost adopts the sequence staff's
values, and the values stop being written twice. Both renderers already share
their glyphs through `staffGlyphs.jsx`; the ghost treatment belongs in the same
shared place, so a third renderer cannot invent a third look.

---

## Problem 4 — the same game, the same player, two different addressing schemes on two screens

Observed: a chess game played at the piano kiosk used **staff cards** for its
file/rank rim; the same game, same player, opened on the office screen came up
addressed by **chords**.

**Root cause — the office host does not pass the addressing policy.** Both hosts
mount the same lazy game component, but only one of them tells it who is playing
and what their reading ladder says:

```js
// kiosk — modes/Games/Games.jsx:423-427
addressingPolicy={{
  config: config.gameAddressing,
  learnerId,
  completedGames: boardGameDay.completedGames,
}}
```

```js
// office — PianoVisualizer.jsx:522-537
<MountedGame … appConfig={appConfig} gameConfig={…} currentUser={currentUser} … />
// no addressingPolicy
```

Every board game defaults the prop to `null`
(`PianoChessGame.jsx:119`, `PianoCheckers.jsx:105`, `PianoConnectFour.jsx:106`)
and then calls `managedAddressingAt(addressingPolicy?.config, …)` with
`undefined`, so the office falls all the way back to the built-in default —
which for chess is `chords` (`docs/reference/piano/grid-addressing.md` §3.1:
"Chess currently defaults to `chords`"). The kiosk resolves the learner's rung
off `gameAddressing` and gets `staff`.

The kiosk run logged `scheme: "letters-by-difficulty-v1"` with
`difficulty: "learner"` on every `mounted` event today; the office mount has no
learner standing to resolve against at all.

This is not a chess bug — it is host-shaped, so it affects checkers and Connect
Four identically, and it will affect every future addressed-board game.

**Fix direction:** the addressing policy is a property of the *player*, not of
the screen. `PianoVisualizer` already knows `currentUser` and already holds
`appConfig`; it needs to pass the same `addressingPolicy` object the kiosk does,
sourcing `completedGames` from the same `useBoardGameDay(learnerId)` hook rather
than a second one. Better still, the two hosts should build that object from one
shared helper so a third host cannot forget it — the shape being duplicated at
two call sites is exactly how this drifted.

---

## Summary

| # | Problem | Where | Kind |
|---|---|---|---|
| 1 | 3×3 flashcard deck renders instruction text instead of the approved set/rep pills | `ExerciseRun.jsx:991`, `GameGate.jsx:885` | feature wired to one material kind only |
| 2 | Cursor lane (and viewBox) does not contain middle C or the top card | `SvgSequenceStaff.jsx:400-408` | geometry |
| 3 | Two ghost-note treatments — dashed/hollow vs. solid translucent | `SvgStaffRenderer.jsx:294-297` vs `SvgSequenceStaff.scss:171` | house-style SSOT |
| 4 | Addressing scheme differs per screen for the same player | `PianoVisualizer.jsx:522` vs `Games.jsx:423` | host-config SSOT |

Problems 3 and 4 are the same disease in two places: a value that describes the
*house* (how a ghost looks) or the *player* (how they address a board) written
at each consuming site instead of resolved once.

---

## Two more, found while fixing the four above

### 5 — a cued scale rung told a child a tempo it did not grade at

At 16:33 the same day, the gate served rung `L4` (tier 3, cued):
`scales/modes@root=C,mode=ionian,direction=up,span_octaves=1`. Three attempts,
all failed, the first two scoring **0 of 8 notes matched**.

He did nothing wrong. The observations name the pitches he played:

```
16:33:08.03  wrong  midi 60      16:33:09.64  wrong  midi 64
16:33:08.78  wrong  midi 62      16:33:10.53  wrong  midi 65
                                 16:33:11.56  wrong  midi 67
```

C D E F G, in order, evenly, about 870ms apart — the tempo he had just been
counted in at (`piano.exercise-countdown-started bpm: 60, durationMs: 4000`,
four clicks one second apart). Every one was scored `wrong`, and every expected
event `miss`ed, with the cursor never leaving 0.

**The grader's grid was twice the speed of the grid he was given.** The misses
fire 500ms apart, not 1000: the instance's events are `value: "8th"` against
`tempo: { unit: quarter, start_bpm: 60 }`, so the ask is eight notes in four
beats — two per click. The count-in is a quarter-note pulse by design
(`countInPlan` coarsens above ~140bpm and never subdivides), and the ready line
said, in full: *"Press any key to start. You'll hear 4 clicks, then play at that
speed."*

That sentence was false, and it was the only instruction on the screen. He
played at that speed, which is exactly what he was told to do.

**Fixed:** `askPace` + `countInSentence` (`SheetMusic/countIn.js`) derive the
ask's note rate from the **compiled expectation** — the grid the engine actually
grades on, not the instance's written values — and the run now says *"then play
two notes on every click."* An ask with no steady pulse, or one note, keeps the
generic line rather than inventing a rate.

### 6 — the "Not this time" screen

Four grey sentences of equal weight, stacked and centred on a flat black field
under a browser-default `h2`. It was the only screen in the gate nobody had
designed, and the only one a child sees exclusively on a bad day — while the
pass side has a whole ceremony (`GateCeremony`, mahogany/ivory/antique gold).

It also could not say **what went wrong**. It said "Try the exercise again",
which answers *what now* and never *what happened* — so a child with no answer
to the second question tries the identical thing again, which is precisely what
happened three times running above.

**Fixed:** the panel is one card in the instrument's palette (the same three
colours as the ceremony and the drill rail), with an eyebrow, a real heading, a
ruled-off "ways out" block, and a breathing key glyph on the press-any-key line.
And `failureCoaching.js` adds one honest sentence naming the weakest criterion
— "None of the notes landed in time. Listen to the clicks first, and start on
the next one." for exactly the run above — returning `null` rather than guessing
when nothing can be said. No percentage, then or now: `requirementForLevel`
writes `passScore: null` for every authorable level, so a number would have no
bar beside it.

---

## Resolution

All six fixed in one pass, 2026-09-13.

| # | Fix | Landed in |
|---|---|---|
| 1 | `deckProgress.js` reads a run's own set/rep structure and feeds the existing `DrillProgress`; the ask sentence and standing instruction drop wherever chrome actually draws | `modes/Exercises/deckProgress.js`, `ExerciseRun.jsx`, `DrillProgress.jsx` |
| 2 | Cursor lane spans the full ink band; `INK_PAD` gives the viewBox room for a notehead beyond two ledger positions | `SvgSequenceStaff.jsx` |
| 3 | `GHOST_INK` in `staffGlyphs.jsx` is the single ghost treatment, applied as attributes by both renderers | `staffGlyphs.jsx`, `SvgStaffRenderer.jsx`, `SvgSequenceStaff.jsx/.scss` |
| 4 | `addressingPolicyFor` builds the policy; the office host passes it, sourcing `completedGames` from the same `useBoardGameDay` hook | `addressing/addressingPolicy.js`, `PianoVisualizer.jsx`, `Games.jsx` |
| 5 | `askPace` / `countInSentence` state the real note rate | `SheetMusic/countIn.js`, `ExerciseRun.jsx` |
| 6 | Failure panel redesigned; `failureAdvice` names what went wrong | `Games/failureCoaching.js`, `GameGate.jsx/.scss` |

Guarded by new tests in `deckProgress.test.js`, `ExerciseRun.component.test.jsx`,
`SvgSequenceStaff.test.jsx` (cursor containment), `ghostHouseStyle.test.jsx`
(one ghost, both engravers), `addressingPolicy.test.js` (including a source
check that **both** hosts pass one), `countIn.test.js` and
`failureCoaching.test.js`. 5,538 piano + notation specs green.

---

## Two more, reported the same evening

### 7 — half the board was unreachable: a dyad axis matched by letters, not pitch

**Reported:** "look at the first and the fifth on the treble clef — one is B and E
and the other one is E and B. When we press E and B it seems not to be honoring
the octave, so it's impossible to hit the fifth one because the first one keeps
getting caught."

**Confirmed, and it is worse than two cards.** A dyad axis is eight two-note
shapes built over a pool that spans an octave *inclusive*, so the pool's last
entry is the octave of its first. Running the real generator for the seed the
log recorded (`mounted … "seed":"493680518","scheme":"letters-by-difficulty-v1"`):

```
TREBLE (files)                         BASS (ranks)
 card 1: C4+G4   pc {0,7}               card 1: F2+B2   pc {5,11}
 card 2: D4+A4   pc {2,9}               card 2: G2+C3   pc {0,7}
 card 3: E4+B4   pc {4,11}              card 3: A2+D3   pc {2,9}
 card 4: F4+C5   pc {0,5}               card 4: B2+E3   pc {4,11}
 card 5: G4+C5   pc {0,7}  <- card 1    card 5: B2+F3   pc {5,11} <- card 1
 card 6: A4+D5   pc {2,9}  <- card 2    card 6: C3+G3   pc {0,7}  <- card 2
 card 7: B4+E5   pc {4,11} <- card 3    card 7: D3+A3   pc {2,9}  <- card 3
 card 8: C5+F5   pc {0,5}  <- card 4    card 8: E3+B3   pc {4,11} <- card 4
 -> 4 of 8 reachable                    -> 4 of 8 reachable
```

The top four cards of each axis are octave-transposed inversions of the bottom
four — the same two letters, the other way up. `staffAxisMatch` compared
**pitch-class sets** (`pcKey`) and took `findIndex`, the first hit, so the lower
card of each pair answered for both. **Sixteen of the sixty-four squares could be
addressed at all.**

`validateStaffScheme` never caught it because it compares by exact MIDI
(`tokenKey`) — eight distinct shapes, scheme valid. The matcher's notion of
identity was looser than the validator's, which is how a dealt board can be
legal and unplayable at the same time.

The log shows the symptom plainly: 148 `chess.rejected` / `unrecognised_chord` in
six hours, and three `pickup-window-missed` on `a2` in eight seconds at 19:21 —
a child holding a piece and being told nothing was there.

**Fixed:** `matchAxis` now matches EXACT pitch first and falls back to letters
only as a nearness tiebreak — the same rule `axisIndex` has always used for the
single-note axis, where C appears twice for the same reason. A hand that is
exactly right always wins its own card; a hand an octave off still lands on
whichever card it is nearer to, never on whichever was dealt first. All 64
squares address.

### 8 — the clefs were placed by bounding box, not by the line they name

**Reported:** "the bass clef is floating way too high… the treble clef,
shouldn't it be stuck on the G?"

Both true, and the cause is one line. `ClefGlyph` drew a Unicode `<text>`
(U+1D11E / U+1D122) in `serif`, measured its bounding box at runtime, scaled it
to `min(2.2 spaces wide, 6 spaces tall)` and pinned the **top of that box** one
space above the top staff line.

A clef is not placed by its outline. It is placed by its line — a G clef's
spiral curls around the G line, an F clef's two dots straddle the F line — and a
box fit says nothing about where either landmark ends up:

| | drawn at | should be |
|---|---|---|
| treble | ~85% size, spiral ~¼ space above the G line | full size, spiral **on** the G line |
| bass | ~80% size (the width constraint binds), top pinned 2 spaces above the F line | full size, dots straddling the **F line**, one space lower |

And none of it was deterministic: the measurement is of whatever font the device
resolved for `serif`, so a card engraved differently on the kiosk than in a test.
`staffGlyphs.jsx`'s own opening note already forbids exactly this for
accidentals; the clefs were the last font glyph in the engraver.

**Fixed:** both clefs are Bravura outlines now — the SMuFL reference font, the
same one OSMD engraves the full score pages with — expressed in staff spaces
with the origin **on** the defining line, so placement is
`translate(x, lineY) scale(lineSpacing)` and nothing else. No measuring, no
state, no effect.

Two things worth writing down about the conversion: the outline coordinates in
the vendored dump are **1.44× the declared metrics** beside them (360 units per
staff space, not 250), which drew the clefs half again too large on the first
pass; the scale is now derived per glyph from its own metrics and checked on both
axes. And `clefWidth` was a single guessed constant (`2.2` spaces, "about what a
bass clef is") — it answers from the real outlines now, per clef.

Verified in a real layout engine, not jsdom: `expectClefOnItsLine` measures the
drawn glyph against the five staff lines and requires the anchor to land within
1.5px of its own line.

**Also fixed while in there:** the cursor lane now hugs the music instead of
filling the box. Item 2 made it span the whole ink band so middle C could not
fall out of it, which on a one-card flashcard was a full-height yellow column
behind a single notehead, marking a position with no alternative. It is sized
from the ask's own drawn columns now: staff height for notes on the staff,
extended exactly far enough to hold a ledger note and its head.

## Resolution (2)

| # | Fix | Landed in |
|---|---|---|
| 7 | Exact-pitch axis matching with a nearness tiebreak; all 64 squares reachable | `PianoChessGame/staffAddress.js` |
| 8 | Bravura clef outlines anchored on the G and F lines; real widths; lane hugs the music | `MusicNotation/renderers/staffGlyphs.jsx`, `SvgSequenceStaff.jsx` |

Guarded by `staffAddressOctave.test.js` (8 files, 8 ranks, 64 squares, octave
tiebreak) and, in Chromium over the shipped SCSS, `ExerciseRun.measure.test.jsx`
(`expectClefOnItsLine`). 5,547 piano + notation specs green.

---

## Two more, from watching the younger child

### 9 — a third of every three-key ask arrived with no staff

**Reported:** "some of them didn't even have a staff on them — just the keyboard
took the whole screen. It should always have a staff in front of them."

**Confirmed, and it is one in three.** The lit-key rungs the younger learner
climbs all author a staff: `keys-2` and `keys-3` carry
`presentation: { prompt: follow, secondary: staff }`. But the staff is drawn only
when `staffFitsAsk` says it is legible — no wider than an octave
(`MAX_ASK_SPAN = 12`) and holdable on one clef — and `keysInstance` applies its
spread between **adjacent** notes, so three notes a fifth apart span a ninth:

```
keys-3 / sightread-1, sweeping the pick index
  pick  2: E4 B4 F5   span 13   staff NO
  pick  5: A4 E5 B5   span 14   staff NO   (and no single clef holds it)
  pick  8: D4 A4 E5   span 14   staff NO
  pick 11: G4 D5 A5   span 14   staff NO
  pick 14: C4 G4 D5   span 14   staff NO
  pick 17: F4 C5 G5   span 14   staff NO
  pick 20: B4 F5 C6   span 13   staff NO   (and no single clef holds it)
  => 7 of 21 picks lose the staff
```

The pick index is persisted and advances on every serve, so this is not a rare
shape — it is every third launch, unpredictably, with nothing in the ask to
explain why this one had notation and the last one did not. The log confirms he
met it: of his eight `keys-3` runs today, picks 8, 11 and 14 were bare keyboards.

Two-key asks were never affected (0 of 21), and the flashcard deck keeps its
staff regardless of this flag — it draws through the sequence staff, not
`KeysAsk` — so `sightread-1` was fine.

**Fixed:** the spread is chosen from the intervals that keep the whole shape
inside the staff's window, instead of being chosen first and found illegible
afterwards. 0 of 42 picks now lose the staff, and 14 distinct shapes survive, so
the rung still varies rather than settling on one memorable triad.

### 10 — the younger learner was addressing the board in chord symbols

**Reported:** "check the configuration for connect four, chess, checkers for
[the younger learner] — it's giving him chords. Instead of chords we should be
giving him note cards."

`gameAddressing.users` had him on `vocabulary: chords`, which puts chord symbols
(`Am7`) on every board rim. He is a preschooler whose match-gate rung is
`sightread-1` — one note on a staff, find the key. The two vocabularies are not
difficulty levels of each other (grid-addressing.md §3.1): one is reading, the
other is spelling, and he is being taught the first.

**Fixed** in the household config (`gameAddressing.users.<learner>.vocabulary:
staff`), with the reason recorded beside it. Note that one other learner is still
on `chords` and was not part of this request.

## Resolution (3)

| # | Fix | Landed in |
|---|---|---|
| 9 | Lit-key spread chosen to fit the staff window | `Games/gateMaterial.js` (+ `gateMaterialStaffFit.test.js`) |
| 10 | Learner moved to `staff` addressing | household `piano/config.yml` (data, not code) |

### 11 — the chess mount log named the wrong vocabulary, every time

Found while confirming #10. `mounted` logged `scheme: scheme.id` — the component
**prop**, whose default is `DEFAULT_CHORD_SCHEME` — not the scheme the board is
addressed with. So every chess game ever recorded reads
`scheme: "letters-by-difficulty-v1"` whatever the child was actually reading.

Today's 19:14 game logs that line and, eight seconds later, a `move-played`
carrying `chords: ["E–B/A–D","E–B/C–G"]` — staff dyads. The mount line was wrong
and the move line was right; the board resolves its addressing into `game.scheme`
after mount, and the log never looked there.

This is the one field an investigation reaches for to ask which vocabulary a
learner was on. It nearly sent this one to the wrong conclusion about #10.

**Fixed:** the line logs `liveScheme.id` (`game.scheme`) plus an explicit
`vocabulary: staff | chords`, and re-fires when the addressing resolves.
