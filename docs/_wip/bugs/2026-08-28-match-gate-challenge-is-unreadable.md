# The match gate's challenge is unreadable

**Date:** 2026-08-28
**Found by:** first real use — `kckern` opened chess with `gameGate` scoped on
**Status:** resolved on `feat/exercise-run-ux`. See `## Resolution` below.
**Spec:** `docs/superpowers/specs/2026-08-28-exercise-run-ux-design.md`
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

---

## Resolution

Shipped on `feat/exercise-run-ux`, against the design in
`docs/superpowers/specs/2026-08-28-exercise-run-ux-design.md`. The organizing change is
that **difficulty now selects a presentation tier**, so the level a child is on decides
what the screen *is* — not just how it is graded. Reference:
`docs/reference/piano/games-budget-gate.md`.

### A. The material

| # | Issue | What shipped |
|---|---|---|
| A1 | Opens on the hardest rung, cold | The five-axis rung is deleted. The ladder is a config-authored repertoire, easiest first, and a child opens at a per-child `startLevel` — `L1` (C major, right hand, free, eight notes) by default, `keys-1` (one lit key) for a preschooler. Nothing opens cued. |
| A2 | Four of five axes change nothing | The axes are gone rather than made real. A degrade moves one level, and every level differs from its neighbour in tier, root set, or timing — so "we made it a little easier" is true by construction, and the ladder-walk test asserts every step changes the level id. |
| A3 | `intervals` is a poor first ask | Material is authored per level. The shipped repertoire's first ask is a C major scale; held-dyad material only appears at the keyboard tiers, where it renders as lit keys and the ask says "play these notes together" before a note is played. |

### B. The notation

| # | Issue | What shipped |
|---|---|---|
| B1 | Bass clef renders for a treble-only exercise | Exercise notation no longer routes through `generateAbc`, the live-keyboard grand-staff visualiser. Free asks draw on a new single-staff sequence renderer; cued asks use the ABC path; score passages use the sheet-music renderer. The grand-staff renderer serves nothing on this surface, and no test can reach it from here. |
| B2 | `instance.staff` set and ignored | It is now the first authority for the clef — ahead of hand, ahead of pitch — matching the exercise bank's own contract, where `staff` is an independent re-notate axis ("a left hand can read treble"). Contradiction tests pin the priority, not merely the agreement. |
| B3 | A dyad is ambiguous by construction | The ask sentence is on screen *before* the attempt starts: "Play these notes together" versus "Play the lit keys in order". It is no longer buried in the `running` status line. |
| B4 | Range and clef disagree | The clef is chosen from the ask's own pitches, and the same answer that decides *whether* a staff is shown is the one it is drawn on. A G3+C4 ask ties the majority rule 1-1 and used to go treble, putting G3 off the bottom of the card; it now draws on bass, asserted on real engraved geometry in a headless browser. |

### C. The chrome

| # | Issue | What shipped |
|---|---|---|
| **C1** | **"Pass challenge" over a bare exercise title** | **Partly.** At the match gate, fixed: the header is a host-supplied **framing** line — "Play this to start Chess" — over the ask in plain words, and the bank title is not the headline. But the gate is the only host that supplies `framing`/`ask`. **A child who presses "Pass challenge" on a program step still sees the literal C1 screen** — the eyebrow "Pass challenge" over the bank's own title — because `ExerciseRunRoute` passes neither prop and `framingFor`'s `kind: 'program'` branch has no production caller. Not wired in this round: the two navigate sites are a small change, but the query-to-prop hand-off in the route is the part that could silently do nothing, and it cannot be tested without a router-and-bank harness that does not exist yet. |
| C2 | A bare key letter | The key chip appears only when a staff is shown, and reads "Key of F". It also spells correctly now: the black keys of a flat key draw as flats, resolved through the mode's relative major rather than the bare root letter. |
| C3 | Ready copy promises criteria it never shows | That line is deleted. The pass bar is not claimed because there is none to claim: every repertoire level is verdict-driven and `passScore` is gone from the config entirely. Where a number does exist — a cued level's cleanliness threshold — it is the rubric, not a second gate. |
| **C4** | **"Begin challenge" is a second tap for nothing** | **Partly.** The button is deleted for every mode, and a **free** ask now needs no gesture at all: the screen reads "Play the first note to begin" and the first correct note starts the attempt. A **cued** ask still needs one — it reads "Press any key to start. You'll hear 4 clicks, then play at that speed", and any key begins the count-in. That is not the old friction restored: it is on the piano rather than on a touch target, it exists because a metronome count-in has to begin deliberately, and the copy says what will happen before it happens. A child on a cued level does press a key before playing. |
| C5 | Nothing explains the bargain | The framing line is the bargain, said first: "Play this to start Chess". |

### D. Structural

| # | Issue | What shipped |
|---|---|---|
| D1 | No visual coverage of this surface | `ExerciseRun.measure.test.jsx`: the real components bundled into headless Chromium over the shipped compiled SCSS, at the kiosk's 1280×800 canvas, one scenario per tier plus the score stage. It asserts staff count, the clef glyph *as drawn* (a glyph that never sized itself renders invisible and fails), noteheads inside the staff box, the wrong-note ghost at its own height, the ask present before any input, no start button on a free ask, and no percentage on a tier-0 screen. Real abcjs and real OSMD engrave; only I/O is doubled. |
| D2 | No gate-aware presentation mode | `ExerciseRun` takes `tier`, `framing` and `ask` from its host and changes what it renders accordingly — one context-aware surface, not a gate fork. The gate passes its level's tier; practice and program steps pass their own. |

### Not addressed, deliberately

- **The enharmonic gap.** The exercise bank's root axis publishes only sharp-named pitch
  classes, so B♭ major is authored as `A#` and its scale spells with sharps. `roots: [Bb]`
  reads correctly to a person and addresses an instance id that does not exist. The
  shipped repertoire is written in the bank's own spelling and the reference doc says why;
  fixing it needs an enharmonic axis on the bank, which is not this branch.
- **Interval and chord spelling.** `intervals/all.yml` publishes a quality vocabulary
  (`minor-2nd`…`octave`) the accidental table does not cover, so a C minor-3rd still
  spells its E♭ as D♯. Not a regression — it was never covered — and no repertoire level
  serves that material today.
- **Program-step framing** (C1, above). The seam exists on both sides — `framingFor`
  already names the `program` shape, `ExerciseRun` already takes the props — and only the
  route's query hand-off is missing. It is one small change plus the test harness that
  would make it honest, and it belongs with whoever next touches the program surface.
- **Battle Stadium's rematch** and **the office screen** remain ungated, as before.

### Live state

`gameGate` is still scoped to `users.kckern` on `chess` only, and the household default is
still `enabled: false`. The data volume's block predates this work — it carries a
top-level `passScore`, a flat `material:` list, and no `repertoire`, so an enabled gate is
running on the built-in code fallback until the authored block is applied. The
ready-to-apply YAML and the canonical sample both live with this change; the config is
boot-cached, so applying it needs a container restart.
