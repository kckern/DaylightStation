# Performance Assessment

Piano performance assessment compares authored musical material with player
input. The pure compiler and state machine live in
`frontend/src/modules/Piano/performance/assessmentAttempt.js`; first-party
consumers import their supported API from `assessmentSession.js`.

The service owns expectation compilation, matching, criteria, span/part
evidence, and terminal results. It does not own rendering, game scores,
curriculum progression, MIDI device decoding, or persistence authorization.
`assessmentRuntime.js` binds the pure lifecycle to MIDI subscriptions and clock
ticks. `attemptEvidence.js` builds portable records and provides the standard
browser HTTP client.

## Canonical expectation

All assessed material compiles to this immutable version-1 shape:

```js
{
  version: 1,
  source: { kind: 'score', id: 'bach-invention-1', revision: null },
  events: [{
    id: 'event-12',
    onsetQuarter: 8,
    durationQuarters: 1,
    spanId: 'measure:3',
    notes: [
      { id: 'event-12-rh-60', midi: 60, part: 'rh' },
      { id: 'event-12-lh-48', midi: 48, part: 'lh' },
    ],
  }],
  tempoMap: [{ onsetQuarter: 0, bpm: 90 }],
}
```

`source.kind` is `score`, `exercise`, or `chart`. Event and note ids must be
non-empty and globally unique; MIDI values are integer notes from 0 through
127. Onsets and durations are non-negative quarter-note values. Invalid
material is rejected during compilation instead of being silently repaired.

Score staff 0 maps to `rh`, staff 1 to `lh`, and later staves to `staff-N`.
The score compiler preserves onset grouping, rests, spans, authored durations,
tempo changes, and tied attacks. Exercise `hand: right|left` maps to `rh|lh`;
clef does not imply hand, and notes without authored hand data remain
`unassigned`. Active parts are filtered before an attempt is created.

`prepareExerciseAssessment` is the shared exercise boundary:

- `cued` selects `timed` for both sequences and chords.
- free or metronome plus `ordering: any` selects `held`.
- free or metronome plus strict ordering selects `cursor`.
- Authored `onsetQuarter`, `durationQuarters`, and recognized note values
  determine rhythm. An unknown value is rejected in cued mode.
- Generated cued requirements require completeness 1, cleanliness 1,
  placement 0.8, and the instance's starting BPM. Legacy single-onset bank
  material without an authored tempo uses the bank policy's 90 BPM compatibility
  default. Untimed requirements cannot include placement or a pace gate.

## Immutable lifecycle

The public transitions are:

```text
compileAssessmentExpectation / compileScoreExpectation / prepareExerciseAssessment
createAssessmentAttempt
startAssessmentAttempt
observeAssessment / advanceAssessment / closeAssessmentSpan
finalizeAssessmentAttempt
assessmentProgress
```

`cursor` is wait-for-correct: events are sequential, notes within one onset are
order-free, and empty/rest events skip. `held` compares the physical held MIDI
set with the current authored onset and latches one wrong result per gesture.
`timed` matches each attack to the nearest pending logical note inside the
configured window, accumulates chords, and records drift. One physical attack
may satisfy same-pitch logical notes in multiple parts at one onset.

Free and metronome attempts are untimed and never produce placement. Cued mode
requires a tempo map and timed matching. Metronome sound is presentation; it
does not turn a wait-for-correct attempt into a timed one.

Attempts begin as `prepared`. A completed finalization is valid only after
start; `aborted`, `timeout`, and `error` may close a prepared or running attempt.
Terminal transitions are idempotent. Input before start, after termination, or
after runtime disposal is ignored. When an attempt declares a named clock,
every observation must explicitly carry the same clock name; missing and
foreign clock claims are ignored. Timed observations also require numeric time.

The runtime owns subscription, tick, reset, abort, timeout, and disposal. It
batches ordinary state changes into low-frequency React snapshots (50 ms by
default), while start, reset, and terminal snapshots publish immediately. Pure
transition callbacks still receive every live event. The runtime never renders
or persists.

## Result contract

A completed result contains aggregate, per-part, and per-span evidence:

```js
{
  status: 'completed',
  score: 0.91,
  criteria: { completeness: 1, cleanliness: 0.91 },
  parts: {
    rh: {
      criteria: { completeness: 1, cleanliness: 0.95 },
      diagnostics: {
        expected_notes: 24, matched_notes: 24,
        wrong_notes: 1, missed_notes: 0,
      },
    },
  },
  spans: {
    'measure:3': { criteria: {}, parts: {}, diagnostics: {} },
  },
  diagnostics: {
    expected_notes: 32, matched_notes: 32,
    wrong_notes: 2, missed_notes: 0,
    response_median_ms: 780,
  },
  rubric: {
    id: 'sheet-learn-practice-v2',
    version: '2',
    weights: { completeness: 1, cleanliness: 1 },
    part_weights: { rh: 0.5, lh: 0.5 },
  },
  verdict: {
    score: 0.91,
    passed: true,
    failed_criteria: [],
    failed_gates: [],
  },
}
```

Active parts have equal weight by default, independent of note density.
Requirement or attempt grading may override part weights; unspecified active
parts receive raw weight 1, and persisted weights are normalized. Aggregate
completeness and placement are part-weighted means. Placement exists only for
timed attempts.

An unexpected note is attributed to the current expected part with nearest
pitch. Equal-distance ties are absent from per-part wrong-note diagnostics and
are divided fractionally by normalized part weights for aggregate cleanliness.
Criterion weights are persisted, and `score` is their normalized projection.
The record validator checks count arithmetic, part totals, applicable weighted
criteria, and scalar/verdict agreement while continuing to accept legacy scalar
records.

A cued pace gate records the configured effective run tempo as `actual` and the
required tempo as `target`; it is not an estimate of achieved performer tempo.
Interrupted results contain status and numeric diagnostics only—no score,
criteria, parts, spans, gates, rubric, or verdict. Surfaces persist an
interrupted attempt only after musical input occurred.

## Persistence and authorization

`buildPianoAttemptEvidence` adds attempt identity, stable activity or challenge
identity, purpose, surface, and provider/grading versions. Learn uses an
activity identity. Exercise practice uses an activity identity. Curricular and
game challenges use a challenge identity. Practice evidence may contain an
honest musical verdict, but `purpose: practice` remains ineligible for
curriculum advancement; the learning service re-evaluates only qualifying
challenge evidence against the current requirement.

`POST /api/v1/piano/users/:userId/attempts` validates the record and enforces
write authority:

- a trusted household piano kiosk/writer may write the selected known learner;
- an authenticated participant may write only its matching user id;
- practice requires `activity_id`, and challenge requires `challenge_id`;
- guest persistence is limited to an authorized `piano-challenge` challenge;
- unknown or unauthorized callers are rejected.

Attempt ids are idempotency keys per user across UTC day directories. Repeating
the same payload returns the stored record. Reusing an id with changed evidence
returns HTTP 409. The store adds `user_id` and `created_at`; clients cannot use
those storage fields to change the idempotency comparison.

Learn and ordinary Exercise practice skip non-persistent guest contexts. The
game challenge provider may use the explicit guest exception above. Native
arcade/control input does not create attempt evidence.

## First-party consumers

| Surface | Assessment boundary | Persistence |
|---|---|---|
| Sheet Music Learn | silent cursor attempt per whole-piece pass or loop lap; optional metronome remains untimed | practice ledger plus frontier derived from clean, complete spans |
| Sheet Music Polish | timed score expectation and span closure | existing per-score Polish record and tier-best projection |
| Exercises | shared exercise adapter and runtime | practice or challenge attempt as authorized |
| Battle Stadium | shared exercise adapter/runtime; pass-gated failure consumes the move with no effect | challenge attempt |
| Piano Hero | timed canonical chart; surface owns bars, points, and combo | memory by default |
| Flashcards | held attempt only when a musical result is needed; neutral recognition for theory | memory by default |
| Space Invaders | native mode uses visible-object pitch collision; Hero mode uses timed assessment | native mode has no assessment result |
| Tetris, Side Scroller, staff commands | neutral recognition | no criteria, verdict, or evidence |

Seek, range, active-hand, transpose, or mode changes abort the current Learn lap
and prepare a new one. A Learn measure advances the frontier only when its span
has completeness 1 and cleanliness 1. Metronome-assisted Learn writes no
placement.

The wireless drawing tablet/canvas is a separate Gaming input and checkpoint
interface. Its strokes are not MIDI observations and do not pass through this
assessment service.

## Boundaries and current limitations

Assessment is attack-based. It does not score sustain pedal, performed note
duration, articulation, dynamics, fingering, ornaments, chord-roll spread,
stalls, substitutions, transposition errors, or achieved BPM. Authored duration
and tie structure are retained for timing and future criteria. Part attribution
is only as reliable as authored staff/hand data.

Game points, combo, damage, block, focus, health, and tier display scores are
surface projections, not rubric criteria. Progression and next-exercise choice
belong to consumers such as `BankChallengePolicy`, not to the assessment
service. No `worstSpan` or automatic contiguous-trouble selector is part of the
public result.

Theory recognition and MIDI commands import the neutral
`input/recognition.js` helper. Piano Chess addresses, note-launcher selection,
and Producer chord detection likewise remain outside assessment.

## Module map

| File | Role |
|---|---|
| `assessmentSession.js` | Supported first-party façade. |
| `assessmentAttempt.js` | Pure compiler, matchers, lifecycle, and result builder. |
| `assessmentRuntime.js` | MIDI/timer external-store binding; no rendering or persistence. |
| `attemptEvidence.js` | Portable evidence builder, browser client, and safe telemetry projection. |
| `input/recognition.js` | Neutral held-set recognition with no assessment evidence. |
| `shared/music/assessmentRecord.mjs` | Backend/frontend portable record validation and re-projection. |

## Observability

The surfaces emit `score.learn.assessment`, `piano.exercise-assessment`, or
`piano.challenge-assessment`. The endpoint emits `piano.attempt.saved`,
`piano.attempt.rejected`, or `piano.attempt.failed`. Logs include surface,
matcher, mode, activity/challenge/attempt ids, purpose, terminal status,
criteria, part weights, failure names, numeric note counts, rubric/provider
versions, and persistence outcome/latency. They exclude raw MIDI, held sets,
prompts, and expected/per-note event streams.

Retries must reuse the original attempt id. A sustained persistence failure or
rejection burst is operationally actionable; a learner failing a musical gate
is a product outcome, not an infrastructure alert.

## Verification

Use each suite's actual runner:

```bash
npx vitest run \
  frontend/src/modules/Piano/performance/assessmentAttempt.test.js \
  frontend/src/modules/Piano/performance/assessmentRuntime.test.js \
  frontend/src/modules/Piano/performance/attemptEvidence.test.js

node --test shared/music/assessmentRecord.test.mjs

npx vitest run \
  backend/src/1_adapters/persistence/yaml/piano/YamlPianoAttemptStore.test.mjs \
  backend/src/4_api/v1/routers/piano.attempts.test.mjs

node cli/gaming-artifacts.cli.mjs verify card-game \
  --data-dir /path/to/daylight-data --json
```

The release gate also includes the affected Learn, Polish, Exercises, challenge
provider, Battle reducers, Hero, Flashcards, Space Invaders, and neutral-command
suites; frontend lint/build; backend Piano/Gaming suites; exercise-bank
validation; the layer-import audit; and the card-game artifact verifier. The
shared record test is a Node test and must not be passed to Vitest.
