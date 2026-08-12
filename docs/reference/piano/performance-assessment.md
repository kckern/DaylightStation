# Performance Assessment

The performance service (`frontend/src/modules/Piano/performance/`) judges a live
performance against an expected one. It is pure and DOM-free; surfaces bind it to
notation, keyboards, or game chrome as they see fit. It answers one question —
*here is what was expected, here is what was played, how well did they match* —
and deliberately owns nothing else: no rendering, no content authoring, no
progression policy.

## Concept map

The domain as a whole, arranged so each concept belongs to exactly one stage.
Design notes: [rubric design](../../_wip/plans/2026-08-12-assessment-rubric-design.md).

```
PERFORMANCE ASSESSMENT
│
├─ 1. EXPECTATION — what should be played
│   ├─ Source
│   │   ├─ bank seed          authored, with expansion axes
│   │   ├─ bank instance      seed x axes, computed, never stored
│   │   └─ score range        measures selected from engraved music
│   ├─ Material               ordered events; each event = one onset holding pitches
│   └─ Declarations           <- MEASUREMENT config; owned by the item, never the rubric
│       ├─ ordering           strict | any        -> selects the matcher
│       ├─ supports           free|metronome|cued -> which modes are meaningful
│       ├─ tempo              start_bpm, target_bpm
│       └─ tolerances         chord window, plausibility window
│
├─ 2. RUN CONTEXT — the coordinates this attempt was made under
│   ├─ mode                   free | metronome | cued
│   ├─ tempo scale            what the player set, not what the item asks
│   ├─ hand mask              which staves were active
│   └─ Run measurements       achieved bpm, elapsed — facts about the whole run,
│                             belonging to no single note
│
├─ 3. OBSERVATION — what was played
│   ├─ Raw MIDI               note on/off, velocity, pedal
│   ├─ Decoder                applies the item's tolerances
│   │   ├─ onset grouping     expectation-aware window
│   │   └─ pedal handling
│   └─ Performed events
│
├─ 4. ALIGNMENT — how the two correspond
│   ├─ Matcher                chosen by `ordering` and mode, not by the rubric
│   │   ├─ cursor             wait-for-correct, no clock   (drills, learn)
│   │   ├─ held set           simultaneous pitch classes   (chords, flashcards)
│   │   └─ timed              attacks vs ms targets        (polish, hero)
│   ├─ Outcomes               a classified edit script, each error charged once
│   │   ├─ matched            with drift
│   │   ├─ omission           expected, absent
│   │   ├─ insertion          present, unexpected
│   │   └─ substitution       one wrong finger = ONE error
│   └─ Live events            per-note verdicts emitted DURING the run, consumed
│                             straight by renderers (note flash, wrong-note ghost).
│                             They bypass Judgement entirely — on the map because
│                             what is not on it gets wired ad hoc.
│
├─ 5. JUDGEMENT — how good it was
│   ├─ Criteria (scored 0-1)
│   │   ├─ completeness       did every expected note happen?
│   │   ├─ cleanliness        were there notes nobody asked for?
│   │   └─ placement          were they on the beat?
│   ├─ Gates (pass/fail)
│   │   └─ pace               did you reach target_bpm?
│   ├─ Diagnostics (measured, never scored)
│   │   ├─ stalls             gaps beyond the running pace
│   │   ├─ onset spread       how rolled each chord was
│   │   └─ transpositions     swap count
│   └─ Rubric                 <- JUDGEMENT config; owned by mode/context
│       ├─ enabled + weights
│       ├─ required (gates)
│       └─ thresholds
│
├─ 6. EXPRESSION — how it is said
│   ├─ Result                 criterion vector + verdict
│   │                         {score, gates: {name: {passed, actual, target}}}
│   │                         gates absent — not `true` — when none were enabled
│   └─ Projections
│       ├─ detail             per criterion, musically literate -> renderers
│       ├─ percentage
│       ├─ band               green / yellow / red
│       └─ letter             derived coarsely from the band; never stored
│
└─ 7. RECORD — what is remembered
    ├─ Attempt                vector + verdict + rubric version + instance id
    │                         status: completed | aborted | timeout | error —
    │                         only `completed` reaches Judgement at all
    └─ Aggregation            tallied over scope
```

Progression — skill estimate, level matching, `worstSpan` choosing the next
exercise — is deliberately NOT a stage. This service owns no progression policy;
that belongs to its consumers (`BankChallengePolicy` today).

**Scope** cuts across stages 1 and 4-7 identically: **note -> span -> run**.
Measures and cells are declared by the Expectation, not discovered later. A span is a
measure in a score, a transposition cell in a drill, or the whole thing for a
bare exercise. Hands become a scope once per-voice attribution exists.

**The rule that keeps the tree exclusive** is the split between stages 1 and 5.
Measurement config belongs to the item; judgement config belongs to the rubric.
Break it and `completeness` means different things for two children while
wearing the same name — which is what the arrangement exists to prevent.

Two deliberate overlaps, named so they do not read as duplication: tolerances
are *declared* in Expectation and *applied* in Observation; onset spread is
*measured* in Observation and *surfaced* in Judgement.

Most of stages 1, 2 and 6 are built; stages 3-5 are the design in progress. What
follows describes what exists today.

## Module map

| File | Role |
|---|---|
| `performanceTargets.js` | Compiles renderer-independent score notes into millisecond targets (tempo map resolved here; the judge deals only in ms) |
| `performanceJudge.js` | Timed runner: match presses to targets, resolve misses, close measures |
| `drillRun.js` | Untimed runner: span-by-span ordered matching with no tempo map |
| `heldSet.js` | Held-chord matcher (pitch-class equivalence, bass-root constraint) |
| `grading.js` | Dimensional graders, declared weights, green/yellow/red banding |
| `spans.js` | Aggregation: tally per-span grades, find the worst contiguous trouble block |

## Runners

- **Timed** — matches note attacks against millisecond targets compiled from an
  engraved score (tempo map in, perfect/good/miss windows). Used by Sheet Music
  polish and the hero game.
- **Untimed** — advances span-by-span through ordered expected pitches with no
  tempo map. A wrong note within two octaves of the target counts against the
  current span; anything farther is ignored as an unrelated key. There is no
  restart on a wrong note — the player flashes and continues. A degenerate
  (empty) span is ignored rather than blocking the run. Used by lesson drills.

The two runners exist because the questions differ: the judge cannot serve an
exercise with no tempo map, and a drill has none. Both feed the same graders.

## Matching

Held-set matching judges chords on what is currently held: pitch-class
equivalence, any wrong pitch class held is wrong, completion means the full set
is down at once, and by default the lowest note must be the chord root
(inversions rejected — an option relaxes this). Note releases matter only here.
The flashcard engine's chord evaluation delegates to this matcher.

## Grading and spans

Grading is dimensional — pitch accuracy, timing, continuity, simultaneity — with
weights an exercise may declare to say what it is about; defaults reproduce the
long-standing constants, and partial weight or threshold objects merge over
those defaults. Scores band to green/yellow/red on the same 0.9/0.6 thresholds
through `gradeBand`.

Ordered grading also counts **missed** notes. The untimed runner advances only
on the correct note, so a drill cannot leave one unplayed and passes none; a
timed score can be played straight past, and a note never struck has to cost
something. With none missed the maths reduces exactly to what it was.

Sheet Music polish grades through this service as of
`polish-shared-grading-v1`. It previously combined the same dimensions
multiplicatively under its own names, so a polish score and a drill score could
not be compared even though both claimed to mean "how well did that go".
Adopting the service moved the numbers, which is why results carry that policy
version — records written under the old maths stay distinguishable.

Assessment aggregates over spans: measures in a score, transposition cells in a
drill, one span for a bare exercise. A run tallies to an overall grade and
surfaces its heaviest contiguous block of trouble — the natural thing to go
drill next.

## Who binds what

| Surface | Runner | Matching | Grading | Aggregation |
|---|---|---|---|---|
| Sheet Music polish | timed | — | service (`grading`) | service (`spans`) |
| Sheet Music learn | timed targets, own follow tracker | — | per-measure practice records | — |
| Piano Hero | timed | — | judge results directly | — |
| Battle Stadium (card game) | own `advanceScaleProgress` | service (`heldSet`) | service (`grading`) | — |
| Exercises (bank) | service (`drillRun`, `heldSet`) | by the item's `ordering` | service (`grading`) | — |
| Flashcards | — | service (`heldSet`, via delegation) | — | — |

Deliberate non-unifications, so they are not "fixed" by accident:

- **Play feel stays per-surface.** The card game restarts a scale on a wrong
  note; the lesson drill flashes and continues. Both report into the same
  graders; the advance primitives are intentionally separate.
- **The card-game verifier lifecycle** (arm-after-release, commit-path
  hardening against batched MIDI snapshots) is battle-tested and stays its own.
- **Timing curves differ by intent, and now share an implementation.**
  `timingQualityFromDrift` takes a free tolerance and a falloff window: polish is
  gentle (80ms free, zero at 400ms) because a bar being learned should not read
  red for being slightly late, while beat-relative grading is tight. Different
  numbers, one formula.

## Live state

Runners are pure state machines: `(state, event) → { state, event }`. A surface
that renders per-note feedback holds run state in a ref and applies DOM feedback
directly, or subscribes through an external store — never by threading run
state through render-triggering props of a hot component. Per-span grades and
terminal summaries are ordinary low-frequency React state.

## Boundaries

Sequence matching is attack-only: ornaments, sustain pedal, and note durations
are not assessed. An onset group spanning two measures belongs to neither and is
excluded from per-measure grading. Per-voice (per-hand) attribution is not
performed — staves merge into one pitch set per onset.

## Producers

The service consumes expected-performance material; it never authors it. Scores
arrive via the target compiler, drills via seed expansion, card-game challenges
via the backend's adaptive policy.

The canonical counterpart is the [exercise bank](exercise-bank.md) at
`data/content/music/` — stable `collection/id` references shared across
surfaces, stored as seeds that expand into instances. It currently holds 58
seeds yielding 2,760 performable instances (Hanon 1–30, plus notes, intervals,
triads, sevenths, modes, arpeggios, blues/jazz/rock runs, beginner drills and
chord progressions), served
read-only at `/api/v1/piano/bank`. No surface reads it yet, so each producer
still owns its own content meanwhile.

## Not yet provided

- **Drill results are not persisted.** A completed drill run logs its summary
  (`piano.drill-complete`) and discards it, so the Exercises surface has no
  per-item scores or progress to show until runs are saved. The rubric's vector
  needs this too: the attempts endpoint validates a scalar 0-1, and a vector
  cannot be reconstructed from scalars after the fact.
- **Learn has a second cursor matcher.** `useFollowTracker` implements
  wait-for-correct advance independently of `drillRun` — same all-notes-at-a-step
  rule, same two-octave plausibility window, written twice. Unifying them is the
  cheapest step toward the matcher taxonomy above.
- **Abandoned runs are not scored**, though the untimed runner can finalize a
  partial run — surfacing that is a product decision, not a service gap.
- **No surface consumes the bank yet.** It is served at `/api/v1/piano/bank`
  (see [exercise-bank.md](exercise-bank.md)), but Sheet Music, lessons, and the
  card game still each own their content. Migrating them is the next step.
