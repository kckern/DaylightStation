# Performance Assessment Service — Design (v2)

**Date:** 2026-08-11
**Status:** Implemented — see docs/reference/piano/performance-assessment.md and docs/superpowers/plans/2026-08-11-performance-assessment-adoption.md.

## What changed from v1

v1 claimed the assessment idea "was never named" and proposed building it. That was
false: `frontend/src/modules/Piano/performance/` already exists — `performanceJudge.js`
and `performanceTargets.js`, pure, tested, consumed today by Sheet Music (polish) and
PianoHeroGame. v2 is therefore an **adopt-and-extend** spec, not a create spec. v2 also
splits composition from assessment (per review and product direction), cuts five
speculative parameters, resolves the migration/timing contradiction by sequencing, and
fixes four factual errors (`pitchEquivalence` already exists in the flashcard engine;
`nearestEvent` and `pedalEdge` are not assessment donors; the capability matrix missed
Learn's per-measure records and Hero mode entirely).

## Problem

Five surfaces ask a player to play specified notes and judge the result: Sheet Music
Polish, Sheet Music Learn, PianoHeroGame, the card-game challenge provider, and the
Hanon lesson drill. Two of the five already share the extracted judge. The other three
do not, because the judge answers only one shape of question — *timed* attack matching
against a tempo map — and nobody built the untimed shape or moved the grading math to
where all five could reach it.

Consequences:

- The card game and polish compute note accuracy with independently written formulas
  (`pianoChallengeGrading.js` vs `scoreEvaluator.js`).
- Held-chord matching (pitch-class equivalence with a bass-must-be-root constraint)
  lives inside the flashcard engine and is reached by the card game via a cross-module
  import.
- Aggregation and weak-spot analysis (`gradeTally`, `worstSpan`) are polish-private.
- The Hanon drill — content whose entire purpose is evenness and accuracy — awards
  nothing. It advances a cursor and flashes red.

## The split: composition vs assessment

**Composition** produces an expected-performance model. **Assessment** consumes one and
judges a live performance against it. They agree only on the model's shape.

This spec is **assessment only**. Producers stay exactly where they are today:

| producer | surface | status |
|---|---|---|
| score adapter (`buildPerformanceTargets` from engraved notes) | polish, learn, hero | exists |
| drill expansion (`expandDrill` + `handMidiSequence`) | lessons | exists |
| backend adaptive policy (`preparePianoChallenge` → materialized pitches) | card game | exists, stays backend |

A composition service (symbolic chord/Roman-numeral realization, new drill vocabularies)
is a **separate future spec** with its own customer. Nothing here depends on it.

## Where it runs

Frontend shared module: `frontend/src/modules/Piano/performance/`. All five consumers
are frontend; input is live MIDI in the browser. The backend keeps what it has
(challenge materialization, persistence endpoints) unchanged.

## The service

One module, two runners, shared grading and aggregation.

### Timed runner (exists — unchanged)

`createPerformanceRun` / `applyPerformancePress` / `advancePerformanceRun` /
`closePerformanceMeasure`. Matches attacks against millisecond targets with
perfect/good/miss windows. Consumers: polish, hero. **No behavior change in this
work** — its existing tests are the equivalence guard.

### Untimed runner (new: `drillRun`)

For ordered exercises with no tempo map — the shape the judge cannot serve and the
reason lessons never adopted it. Spans of expected MIDI; exact-pitch advance; wrong
notes counted within a plausibility window (±24 semitones, matching the lesson drill's
current behavior) and ignored outside it; no restart on wrong (the lesson-drill policy;
the card game's restart-on-wrong `advanceScaleProgress` remains its own primitive —
behavior is not being unified, grading is).

### Held-set matcher (moved, not invented)

The flashcard engine's `evaluateChordMatch` semantics, relocated to the service:
pitch-class equivalence, wrongness = any wrong pitch class currently held, completion =
full set simultaneously held, bass-must-be-root as an option that defaults on. This is
the codebase's real `pitchEquivalence`, constraint included. The v1 three-value enum is
dropped; the two modes that exist (`exact`, `pitchClass` + bass constraint) are the two
modes shipped.

### Grading (moved + one addition)

`gradeOrderedPerformance`, `gradeChordPerformance`, `timingQuality` move from
`challenge/provider/` into the service. One addition: **weights become a parameter**
(defaulting to today's constants), so an exercise can declare what it is about —
Hanon weights continuity, a rhythm drill weights timing — with no new code. A small
`gradeBand(score, thresholds)` maps a 0–1 score to green/yellow/red using polish's
existing 0.9/0.6 thresholds.

### Spans and aggregation (moved)

`tallyGrades` and `worstSpan` relocate to the service unchanged — they already operate
on `{spanIndex: {grade}}` and contain nothing measure-specific. A drill is one span per
transposition cell; a piece is one span per measure; a bare exercise is one span.
`worstSpan` pointed at Hanon identifies the failing transposition — the first new
user-visible capability and the payoff proof.

## Explicit exclusions (assessment model limits)

Stated, not discovered later:

- **Attack-only for sequence matching.** Ornaments (grace notes, trills, rolled chords)
  in engraved pieces produce unmatched presses today and continue to. Sustain-pedal CC
  is transport input (page turns), never assessed. Note duration is computed into
  targets and not graded.
- **Held-set matching is the one place note-offs matter**, and it is scoped to the
  chord matcher (which already implements release-to-arm).
- **Span boundaries, v1 rule = current behavior:** an onset group spanning measures gets
  `measureIndex: null` and is excluded from per-measure grading. Documented as the rule;
  changing it is a grading-policy bump, not a refactor side effect.
- **No per-voice matching.** Polish merges staves into one pitch set per onset and that
  stays. Per-hand attribution for two-handed drills is deferred until a surface commits
  to displaying it.

## Timing contract — sequenced, not contradictory

v1 demanded byte-identical migration *and* retired polish's fixed 80ms window. Cannot
both hold. Resolution:

- **This work changes no timing math.** Polish keeps its fixed windows and 5× ramp; the
  card game keeps beat-relative `timingQuality`. Equivalence testing is therefore
  well-defined: existing tests pass unchanged.
- **Unification (beat-relative tolerance for matching, tier multiplier for reward) is a
  future change gated behind a grading-policy version bump**, following the pattern the
  card game already stamps (`grading_policy_version`) and practice records already use
  (fingerprint-guarded discard). Old records are left as-is; no re-scoring.

## Live-state contract

The recurring failure mode in this codebase is per-note state crossing into React.
The contract, stated once:

- Runners are pure: `(state, event) → {state, event}`. No React inside the service.
- A surface that renders live state holds run state in a ref and applies DOM feedback
  directly (the `applyHighlight` / `applyScaleNoteFeedback` pattern), or subscribes via
  an external store with per-press snapshot identity — never by threading run state
  through render-triggering props of a hot component.
- Per-span grades and terminal results are ordinary React state (low frequency).

## Adoption sequence

1. **Relocate grading + spans + held-set into `Piano/performance/`** with re-export
   shims at old paths. No consumer behavior changes; existing tests move with the code.
2. **Build `drillRun`** (untimed runner) on the shared grading.
3. **Lesson drill adopts `drillRun`** — Hanon gets per-cell grades, a run score, and a
   worst-span readout for the first time.
4. **Card-game provider imports flip** to the service paths (its hardened verifier
   lifecycle is deliberately untouched; recent commit history earned that caution).
5. **Reference doc** for the service; the surfaces' docs point at it.

Learn/polish continue on the timed runner they already use. Rebuilding the lessons
*surface* (browsing/UX) is out of scope here.

## Testing

- Pure modules, unit-tested end to end; relocated modules carry their tests with them.
- **Equivalence guard:** polish's `useScoreEvaluator`/`scoreEvaluator` tests and the
  provider's grading tests must pass unchanged — any diff is a bug because no math
  changed.
- `drillRun` is TDD'd against a Hanon-shaped fixture (cells of 8, two-octave climb).

## Risks

- **Shim drift:** old-path re-exports must be temporary; each shim carries a removal
  note. (Known repo gotcha: re-exports have no local binding — shims are export-only.)
- **Provider version:** the provider stamps `provider_version` into recorded attempts;
  flipping its imports bumps it so attempt records stay attributable.
- **`ScorePlayer.jsx` (~2,200 lines) is deliberately not restructured here.** Its
  evaluator hooks already sit outside it; further extraction is its own future task.

## Deferred (cut from v1)

`unordered` ordering, `duration(ms)` completion, `octave` equivalence, symbolic
realization (chords/Roman numerals), multi-voice matching, persistence unification,
reps-ladder completion, timing-math unification (sequenced above), lessons-surface
rebuild.
