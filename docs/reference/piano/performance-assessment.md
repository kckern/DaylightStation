# Performance Assessment

The performance service (`frontend/src/modules/Piano/performance/`) judges a live
performance against an expected one. It is pure and DOM-free; surfaces bind it to
notation, keyboards, or game chrome as they see fit. It answers one question —
*here is what was expected, here is what was played, how well did they match* —
and deliberately owns nothing else: no rendering, no content authoring, no
progression policy.

## Canonical expectation and lifecycle

The supported façade is `performance/assessmentSession.js`. New consumers
compile score, exercise, or chart material into version-1 onset events. Each
event preserves its quarter-note onset and duration, span identity, and logical
notes with stable ids and parts. Score staves map to `rh`, `lh`, then
`staff-N`; exercise hands map only from authored `hand` data, with missing data
remaining `unassigned`.

Attempts are immutable values. Create and start an attempt, feed attacks or
held snapshots through `observeAssessment`, advance a timed clock when needed,
and finalize once. Cursor and held matching are untimed in both free and
metronome modes. Only cued mode uses timed matching and emits placement.
Terminal transitions are idempotent, and input before start, after termination,
or from another clock domain is recorded as ignored rather than graded.

`createAssessmentRuntime` and `useAssessmentRuntime` are thin subscription
bindings over that pure lifecycle. They own MIDI subscriptions and clock ticks,
but never render or persist.

## Portable result and attribution

Completed results carry aggregate criteria plus `parts` and `spans`. Active
parts receive equal aggregate weight by default even when one hand has many
more notes. A rubric or attempt may override those weights; the normalized
weights and criterion weights are stored with the result. Wrong notes are
charged to the current part whose expected register is nearest. An equal-distance
tie is not asserted as per-part evidence and is divided by normalized part
weight only for aggregate cleanliness. One physical unison attack can satisfy
multiple logical part notes at the same onset.

Interrupted attempts retain numeric diagnostics but have no score, criteria,
or verdict. A completed practice verdict remains non-curricular because
`purpose: practice` is an authorization boundary, not a weaker kind of score.

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

The matcher, observation, judgement, and projection stages are implemented
behind one public session API. Raw MIDI decoding still belongs to the kiosk
input layer, and sustain/note-duration assessment remains outside the current
contract.

## Module map

| File | Role |
|---|---|
| `assessmentSession.js` | Supported façade. Exports expectation compilers, immutable attempt transitions, runtime bindings, progress, span closure, and finalization. |
| `assessmentAttempt.js` | Canonical event compiler and pure cursor, held, and timed lifecycle. Produces aggregate, part, and span evidence. |
| `assessmentRuntime.js` | Thin external-store binding for MIDI subscription, clock ticks, timeout, abort, reset, and low-frequency React snapshots. It never renders or persists. |
| `heldSet.js` | Neutral held-set recognition for theory and command input that must not create assessment evidence. |
| `performanceTargets.js` | Legacy visual timing projection used only where a surface needs millisecond drawing coordinates; it is not assessment authority. |

The façade is deliberately surface-neutral. A typical timed consumer replaces
its attempt with every pure transition result:

```js
const expectation = compileAssessmentExpectation({
  source: { kind: 'chart', id: 'example', revision: null },
  events,
  tempoMap: [{ onsetQuarter: 0, bpm: 90 }],
});
let attempt = createAssessmentAttempt({
  matcher: 'timed',
  mode: 'cued',
  expectation,
  requirement,
});

attempt = startAssessmentAttempt(attempt, { time: 0, leadInMs: 2000 });
attempt = observeAssessment(attempt, { midi, time: atMs }).attempt;
attempt = advanceAssessment(attempt, now).attempt;
const result = finalizeAssessmentAttempt(attempt, { status: 'completed' }).result;
```

### Public consumer contract

Consumers import only compilation, lifecycle, and runtime functions from
`assessmentSession.js`. Surface-only projections such as Polish wash bands and
worst-range selection live beside their surfaces. Command recognition imports
from `input/recognition.js` and creates no result, verdict, or attempt evidence.

## Runners

- **Timed** — cued mode only. It matches attacks to logical note identities,
  accumulates chords, handles cross-part unisons, and retains per-note drift.
- **Cursor** — untimed wait-for-correct matching. Events remain sequential while
  pitches inside one onset are order-free; rests skip automatically.
- **Held** — untimed exact held-event matching for authored order-free material.
  Neutral theory/controller recognition uses a separate non-assessment helper.

The matchers differ because their musical questions differ; they share one
session/result contract and one rubric evaluator.

## Matching

Held-set matching judges chords on what is currently held: any wrong pitch
class held is wrong, completion means the full set is down at once, and the
policy may require the lowest note to be the chord root (inversions rejected).
Note releases matter only here. A held session counts at most one wrong attempt
per key gesture instead of charging every render snapshot.

## Grading and spans

Completed grading uses completeness and cleanliness for every matcher, plus
placement only for timed attempts. Aggregate completeness and placement are
normalized part-weighted means; cleanliness also accounts for ambiguous wrong
notes without inventing per-part attribution. Rubric criterion weights and
normalized part weights are persisted with the verdict.

Sheet Music Polish uses canonical span evidence under
`polish-canonical-span-v2`. Its established tier score remains a local display
projection so existing tier bests stay comparable.

Assessment aggregates over spans: measures in a score, transposition cells in a
drill, one span for a bare exercise. A run tallies to an overall grade and
surfaces its heaviest contiguous block of trouble — the natural thing to go
drill next.

## Consumers and projections

| Surface | Common matcher/judgement | Surface-owned projection | Durable piano evidence |
|---|---|---|---|
| Exercises | cursor for self-paced strict material; held for order-free chords; timed for paced challenges; common rubric + pace gate | notation cursor, wrong-note state, pass screen | Practice and challenge attempts are written; only qualifying challenges advance programs |
| Sheet Music Learn | canonical cursor attempt per whole-piece pass or loop lap | follow cursor, wet ink, range completion | Practice ledger record plus per-score frontier derived from span criteria |
| Sheet Music Polish | canonical timed attempt and span-close evidence | measure washes, unchanged tier score and tier bests | Existing per-score Polish record; not bank challenge evidence |
| Piano Hero | canonical timed chart attempt | points, combo, sparks, Hero accuracy | In memory by default |
| Battle Stadium card game | shared exercise adapter and runtime | score-scaled effects; failed pass-gated moves consume the turn with no effect | Completed bank-backed challenges are written to the attempt ledger |
| Flashcards | canonical held attempt where a musical score is needed; neutral recognition for theory | card score, level, rolling accuracy | In memory by default |
| Space Invaders | native mode uses visible-object pitch collision; Hero mode uses timed assessment | lasers, health, points, combo | Native mode creates no musical evidence |
| Video engagement prompt | held classifier through the flashcard engine | resume-video gate | None; this anti-idle prompt is not a curriculum checkpoint |
| Tetris and Side Scroller | exact-MIDI held classifier only | MIDI commands, hold-repeat, game score | None; command recognition is not an assessment |

The theory engine's standalone chord, interval, and scale-step grading helpers
also delegate to the common classifiers. They are utilities, not durable
assessment consumers.

Deliberate non-unifications, so they are not "fixed" by accident:

- **The card-game verifier lifecycle** (arm-after-release, commit-path
  hardening against batched MIDI snapshots) is battle-tested and stays its own.
- **Game scores are projections, not rubrics.** Hero points/combo, Space
  Invaders health/points, Flashcard level points, card-game damage, and Tetris
  line score remain local. Musical criteria and pass/fail judgement do not.

## Live state

Runners are pure state machines: `(state, event) → { state, event }`. A surface
that renders per-note feedback holds run state in a ref and applies DOM feedback
directly, or subscribes through an external store — never by threading run
state through render-triggering props of a hot component. Per-span grades and
terminal summaries are ordinary low-frequency React state.

## Boundaries

Sequence matching is attack-only: ornaments, sustain pedal, articulation,
dynamics, fingering, and performed note durations are not assessed. Authored
durations and ties remain in the expectation for timing and future criteria.
Part attribution is limited to authored staff/hand identity; clef never implies
a hand, and unassigned exercise notes remain `unassigned`.

Piano Chess chord addresses, the note launcher's combo and selection keys, and
Producer chord detection intentionally remain outside assessment. They interpret MIDI as a
control or musical description; they do not compare a learner's performance to
an authored expectation. Tetris and Side Scroller sit on the boundary: their
note-command recognition uses the common held classifier, but ordinary play
does not generate a grade or advancement evidence.

## Producers

The service consumes expected-performance material; it never authors it. Scores
arrive via the target compiler, drills via seed expansion, card-game challenges
via the backend's adaptive policy.

The canonical counterpart is the [exercise bank](exercise-bank.md) at
`data/content/music/` — stable `collection/id` references shared across
surfaces, stored as seeds that expand into instances. It currently holds 58
seeds yielding 2,760 performable instances (Hanon 1–30, plus notes, intervals,
triads, sevenths, modes, arpeggios, blues/jazz/rock runs, beginner drills and
chord progressions), served read-only at `/api/v1/piano/bank` and browsed in
`/piano/exercises`. `BankChallengePolicy` also materializes exact bank
requirements for games and lesson checkpoints. Sheet Music remains a separate
score-range producer.

## Persistence and remaining boundaries

- **Only explicit evidence writers persist results.** Learn, Exercises, and the
  card-game provider use the shared piano attempt client. Completed records carry
  `purpose`, criterion vector, parts, spans, gates,
  diagnostics, rubric version, verdict, and stable bank-instance id. Practice
  is visible history but is intentionally ineligible for advancement. Hero,
  Flashcards, and Space Invaders expose common results in memory, but ordinary
  game sessions do not silently unlock curriculum. A future challenge-launch
  adapter must provide a persistent user, stable exercise/requirement identity,
  and challenge purpose before those results become evidence.
- **The learning service re-evaluates evidence.** It checks stored criteria
  against the current named requirement instead of trusting a surface-specific
  “complete” flag.
- **Interrupted runs are persisted only after musical input.** They carry
  terminal status and numeric diagnostics, but no score, criteria, or verdict.
- **Sheet Music does not consume bank instances.** Exercises, exact game
  challenges, and video exit checkpoints now do. Sheet Music still produces
  expectations from engraved score ranges, which is a deliberate separate
  content source rather than a missing bank migration.
