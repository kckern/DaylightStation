# The match gate's challenge is unreadable

**Date:** 2026-08-28
**Found by:** first real use — `kckern` opened chess with `gameGate` scoped on
**Status:** open. The gate works; what it *shows* does not.
**Severity:** blocks turning the gate on for any child.

---

## What happened

The gate fired correctly. It picked material, mounted `ExerciseRun` with
`intent=challenge`, and stood between the child and the chess board — every
mechanism reviewed across three rounds behaved as designed.

The screen it produced could not be acted on. An adult who *built the feature*
could not tell what was being asked: whether to play two notes together or in
sequence, why a bass clef was on screen, what "F" meant, or what the tempo had
to do with anything.

---

## Why this was missed

Task 9 of the implementation plan reused `ExerciseRun` wholesale — the plan
treated "the gate drives the run surface" as a **wiring** problem. Every review
that followed was adversarial about *logic*: pass/fail correctness off the floor,
fail-open paths, double-charging, D12 bypasses, the geometry of one button. Not
one of them asked **what a child sees**, because no task asked for that and no
reviewer was pointed at it.

The one test that renders this surface for a gate asserts callback wiring and
rendered *strings*. jsdom cannot see layout, and no assertion covers legibility,
so the entire presentation shipped unexamined and fully green.

`ExerciseRun` is a **practice** surface for a child who chose an exercise from a
browser, already knows what it is, and has its detail page one tap behind them.
The gate drops the same surface in front of a child who chose *chess* and has no
context at all. Reuse was correct; reusing it *unchanged* was not.

---

## The issues

### A. The material is wrong for a gate

**A1. The gate opens on the hardest rung, cold.** `initialRung()` is
`{timing:'cued', hands:2, span:2, difficulty:'exotic', direction:'both'}`, so a
child's *first ever* gate is a metronome-timed attempt graded at `passScore 0.80`.
The ladder only eases after `retriesBeforeDegrade: 3` failures — three failures
before the first mercy, on the way to a game.

**A2. Only one of the five ladder axes does anything.** `prepareExerciseAssessment`
consumes `requirement.mode`, `gates.pace.target_bpm`, and `rubric` — nothing reads
`hands`, `span`, `difficulty`, or `direction`, and no live bank instance carries
`axes.hands`. So the ladder is one real step (`cued → free`) plus the floor. Four
of the five "we made it easier" moves change nothing the child can feel.

**A3. `intervals` is a poor first ask.** `data/content/music/intervals/all.yml` is
`ordering: any` — a *held dyad*, matcher `held`. It is a recognition drill, not
something you "play". Whatever the gate asks for first should be unmistakably
playable: a scale, or a single note.

### B. The notation is wrong

**B1. A bass clef renders for a treble-only exercise.** `ordering: 'any'` routes
to `generateAbc` (`frontend/src/modules/MusicNotation/renderers/abc.js:101`),
which hardcodes a grand staff:

```
%%staves {(RH) (LH)}
V:RH clef=treble
V:LH clef=bass
```

The bass voice gets `x` (an invisible rest) but **the staff and clef still draw**.
That function is the live keyboard visualiser — "what am I holding right now",
for two hands — not an exercise renderer. It was never meant to answer "what
should I play".

**B2. `instance.staff` is set and ignored.** The intervals bank declares
`staff: treble`. Nothing in the notation path reads it; the only consumer in the
repo is a metadata line in the exercise browser (`Exercises.jsx:374`). The data to
render one correct staff is present and unused.

**B3. A dyad is ambiguous by construction.** `generateAbc` stacks simultaneous
notes into a chord, which is *correct* for a held interval — but nothing on screen
distinguishes "play these together" from "play these in order". The only text that
would ("Play the complete chord") lives in the `running` status line, so it appears
**after** the child has already had to decide.

**B4. Range and clef disagree.** The reported figure spans middle F upward, which
belongs on a treble staff; the bass staff below it is empty. Nothing chooses a
clef from the actual pitch range.

### C. The chrome is written for a different context

**C1. "Pass challenge" over a bare exercise title.** The header eyebrow is
`challenge ? 'Pass challenge' : 'Practice'` and the `h1` is `instance.title`
(`ExerciseRun.jsx:345`). "Pass challenge / Intervals" says nothing about *why*
this is on screen — the child asked for chess.

**C2. A bare key letter in the top right.** `<span>{instance.key}</span>` renders
"F" with no label. It is the key signature; it reads like a grade.

**C3. The ready copy promises criteria it never shows.** "The tempo and pass
criteria are fixed for this run" — the tempo is never stated (`requirementForRung`
emits no `gates`, so the BPM element never renders) and the pass score is never
shown. It names two things and displays neither.

**C4. "Begin challenge" is a second tap for nothing.** The child already tapped
chess. `ready` exists so a *cued* attempt can start its count-in deliberately — a
real need for mode `cued`, and pure friction otherwise.

**C5. Nothing explains the bargain.** No copy anywhere says "play this and chess
opens". The gate's whole justification is invisible at the moment it is imposed.

### D. Structural

**D1. No visual coverage of this surface at all.** `GameGate.measure.test.jsx`
measures one Leave button's geometry. Nothing renders a gate challenge and looks
at it. Every issue above is invisible to the suite.

**D2. `ExerciseRun` has no gate-aware presentation mode.** It branches on
`intent === 'challenge'` for *authorization* and *judging*, but its layout, copy,
and notation are the practice surface's.

---

## Fixes, in the order they buy the most

1. **Change the first ask.** Open the ladder at `free` mode on a single-hand
   scale, not `cued` on an exotic two-hand interval. This is one edit to
   `initialRung()` and the material config, and it removes A1 and A3 at once.
2. **Render one staff.** Honour `instance.staff`, or derive the clef from the
   pitch range. Do not send exercise notation through the live-keyboard renderer.
3. **Say what is being asked, before it is asked.** Move "play these together" /
   "play these in order" into the `ready` state.
4. **Rewrite the chrome for the gate.** Name the bargain ("Play this to start
   chess"), label or drop the key letter, state the pass bar if it is claimed, and
   drop the extra tap for un-cued modes.
5. **Fix the ladder's inert axes, or stop pretending they exist.** Either thread
   `hands`/`span`/`difficulty`/`direction` into the requirement, or reduce the
   ladder to what it actually does so "we made it a little easier" is true.
6. **Add one Playwright measurement** that renders a gate challenge and asserts
   staff count, clef, and that the ask is stated before the start button.

---

## Live state

`gameGate` is scoped to `users.kckern` on `chess` only, so no child is exposed.
The household default is `enabled: false`. `gameLimit` is off entirely.

Config is in `data/household/piano/config.yml`; it is boot-cached, so a change
needs a container restart.
