# Performance Assessment

The performance service (`frontend/src/modules/Piano/performance/`) judges a live
performance against an expected one. It is pure and DOM-free; surfaces bind it to
notation, keyboards, or game chrome as they see fit. It answers one question —
*here is what was expected, here is what was played, how well did they match* —
and deliberately owns nothing else: no rendering, no content authoring, no
progression policy.

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
| Lesson drills (Hanon) | service (`drillRun`) | exact-pitch (in runner) | service (`grading`) | service (`spans`) |
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
  (`piano.drill-complete`) and discards it; the lessons browsing surface has no
  per-drill scores or progress to show until runs are saved.
- **Abandoned runs are not scored**, though the untimed runner can finalize a
  partial run — surfacing that is a product decision, not a service gap.
- **No surface consumes the bank yet.** It is served at `/api/v1/piano/bank`
  (see [exercise-bank.md](exercise-bank.md)), but Sheet Music, lessons, and the
  card game still each own their content. Migrating them is the next step.
