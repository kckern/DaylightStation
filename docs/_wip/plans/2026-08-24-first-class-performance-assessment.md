# First-Class Piano Performance Assessment

**Status:** Problem statement and target architecture  
**Date:** 2026-08-24  
**Scope:** `frontend/src/modules/Piano/performance/` and its piano-surface adapters

## Executive summary

Daylight needs one reusable performance-assessment capability that can answer:

> Given an authored musical expectation and a stream of piano input, what did
> the player complete, what did they play incorrectly, and—only when a clock is
> part of the exercise—how well did they place it in time?

The current `assessmentSession.js` is the beginning of that capability, but it
is not yet a first-class attempt runtime. Timed Sheet Music Polish is a complete
consumer. Sheet Music Learn uses only a stateless cursor-step classifier.
Exercises compiles and runs attempts inside a kiosk React component. Battle
Stadium independently rebuilds an exercise runner from flattened MIDI arrays.
Several games borrow classifiers for command recognition, and Space Invaders
adapts key-based collision behavior through a timed assessment even when timing
is deliberately irrelevant.

This leaves Daylight with shared primitives but not one shared performance
model. A feature can import matching or grading functions, but it cannot yet
take a score range or exercise-bank instance and run a canonical self-paced or
paced attempt from start through final result.

The target is a pure, event-based assessment runtime with small surface
adapters. It must support self-paced wait-for-correct reading, paced play-along,
held chords, exercise runs, score passages, and explicit game challenges. It
must keep rendering, game mechanics, curriculum selection, and persistence out
of the core while returning enough structured evidence for each of them.

## Product benchmark and intended learning loop

The commercial benchmark exposes two distinct and complementary learning
interactions.

### Self-paced recognition: flowkey Wait Mode

flowkey describes Wait Mode as listening to the learner and waiting for the
right notes. The learner controls time. The product combines that interaction
with one-hand practice, loops, demonstrations, and slower playback:

- <https://www.flowkey.com/en>
- <https://www.flowkey.com/en/intermediate-piano-songs>

This interaction asks:

> What comes next, and did the learner eventually play the complete expected
> onset?

It does not ask whether the learner was early or late. Response time can be a
useful diagnostic, but there is no beat-relative placement criterion while the
cursor is waiting.

### Paced play-along: Playground Sessions

Playground Sessions centers a running transport with adjustable tempo,
count-in, metronome, backing track, real-time pitch/rhythm coloring, and an end
score. Correct notes, wrong notes, and rhythmically inaccurate notes receive
different live feedback:

- <https://www.playgroundsessions.com/>
- <https://support.playgroundsessions.com/hc/en-us/articles/4408365708948-How-do-the-features-in-the-Toolbar-work-on-the-iPad-iPhone-app>
- <https://support.playgroundsessions.com/hc/en-us/articles/360001035926-How-are-scores-calculated>

This interaction asks:

> Did the learner play the expected music while the musical clock continued,
> and how accurately was it placed?

### Implication for Daylight

These are not competing implementations of one mode. They are separate matcher
semantics:

| Learning interaction | Clock owns advancement | Pitch judged | Timing judged | Daylight destination |
|---|---:|---:|---:|---|
| Demonstration | yes | no | no | Listen |
| Wait for correct | no; player advances | yes | no | Learn |
| Play along | yes | yes | yes | Polish |
| Presentation/performance | product-dependent | optional | optional | Perform |

Daylight's ladder should therefore read clearly:

1. **Listen** — the machine demonstrates.
2. **Learn** — the player advances a wait-for-correct cursor.
3. **Polish** — the player follows transport and receives timing-aware grades.
4. **Perform** — the piece is presented without teaching chrome; recording or
   assessment is an explicit future choice, not an implication of the name.

An optional metronome in Learn is a reference aid. It must not silently convert
a self-paced attempt into a timed one. Timing becomes judged only when the user
or owning context explicitly starts a paced attempt.

## Where we were

Before `assessmentSession.js`, each surface answered performance questions in
its own terms:

- Sheet Music Polish had its own note/timing formula and per-measure grades.
- Sheet Music Learn owned its own cursor matching and wrong-note accounting.
- Exercise runners owned their own sequence matching and completion rules.
- Games owned nearest-target matching, chord recognition, scores, and errors.
- Flashcards and theory utilities each interpreted held notes independently.

That was locally convenient but produced incompatible meanings. A wrong note
could affect a score differently in a drill, score, or game. A game result could
not safely satisfy an exercise requirement. Similar-looking percentages were
not comparable, and improvements to chord or timing logic had to be repeated.

The first consolidation correctly established several important ideas:

- assessment is pure and presentation-independent;
- expectation, observation, criteria, gates, and projection are separate;
- completeness, cleanliness, and placement are portable criteria;
- pace is a gate rather than a score multiplier;
- game points and visual feedback remain surface projections;
- timed, cursor, and held musical questions require different matchers.

Those decisions remain the foundation of the target system.

## Where we are: the current intermediate state

### The public file is both façade and compatibility toolbox

`assessmentSession.js` currently contains three different kinds of export:

1. complete session lifecycle functions such as `createAssessmentSession`,
   `applyAssessmentPress`, and `finalizeAssessment`;
2. stateless matching/grading helpers such as `classifyCursorStep`,
   `advanceOrderedCursor`, and `classifyHeldNotes`;
3. result and span projections such as `evaluateAssessment`,
   `gradeAssessmentSpan`, and `tallyAssessmentGrades`.

This was a practical migration boundary, but it permits consumers to share one
small decision while continuing to own incompatible attempt state around it.
The shared API therefore does not guarantee a shared lifecycle or result.

### Sheet Music Polish is the strongest complete consumer

Polish compiles score events into timed targets, owns a timed session, applies
live note attacks, closes measures, and derives per-measure grades. It is the
best example of the desired separation:

- the performance service owns matching and grading;
- the sheet surface owns transport, measure washes, summaries, and tier bests.

### Sheet Music Learn shares classification, not an assessment attempt

`useFollowTracker` calls `classifyCursorStep`, but it owns the struck-note set,
step advancement, completion, and callbacks. `ScorePlayer` separately owns
wrong counts, wrong measures, loop invalidation, completion, telemetry, and
practice-record writes.

The resulting evidence is coarse. A completed loop increments an attempt for
every measure and increments a pass if that measure saw no wrong note. Learn
does not produce a portable criterion vector or finalized assessment result.

Learn also has two different identities today. With a focus range and looping
enabled, it is a silent wait-for-correct gate. Without that combination,
"machine Learn" performs the active hands and behaves much more like Listen.
The benchmark suggests this ambiguity should be removed: Learn should always
mean self-paced player advancement, while machine demonstration belongs to
Listen.

### Exercises has a surface, not a reusable exercise runtime

`ExerciseRun.jsx` privately implements the important compilation and lifecycle
logic:

- converting strict events to cursor spans;
- converting paced events to millisecond targets;
- deriving a default requirement;
- creating held-chord expectations;
- finalizing and persisting attempts.

Only the React component is exported. There is no supported API that accepts an
exercise-bank instance and returns a canonical free, metronome, or cued attempt.
Other surfaces cannot reuse Exercise behavior without copying it.

### Battle Stadium rebuilds a second exercise runner

`BankChallengePolicy` correctly selects and materializes exercise-bank
instances for chord, scale, arpeggio, figure, and sequence challenges. It sends
both `expected_events` and a flattened `expected_midi` prompt.

The frontend provider ignores the event structure and advances through the
flat MIDI array. It independently tracks progress, wrong notes, timing quality,
completion, persistence, and game results. If target offsets are absent, paced
grading assumes one beat per flattened note. That cannot faithfully represent
rests, different note values, or simultaneous pitches.

The current Battle Stadium definition also labels `timed-pattern` moves as
rhythm challenges while requesting only a curriculum. Backend selection then
defaults to free mode, so those adaptive patterns are currently untimed unless
an exact requirement supplies a cued mode and pace gate.

The provider returns both a score and portable assessment evidence, but Battle
Stadium resolves move outcomes from `result.score`; it does not use
`verdict.passed` as a generic success gate. Quality-scaled damage is supported.
"This move succeeds only when the authored requirement passes" is not yet a
first-class game rule.

### Games expose both valid reuse and boundary leakage

- Piano Hero is a legitimate timed consumer. Timing is inherent to its musical
  question, while points and combo remain game projections.
- Flashcards legitimately reuse held-set matching and can produce a session
  result when the card is an authored musical expectation.
- Space Invaders' embedded Hero mode can legitimately use timing. Native
  Invaders mode cannot: any matching visible key is a hit and every hit is
  called perfect. Its assessment result is currently returned but neither used
  nor persisted. Key/laser collision should stay game logic rather than being
  made to look like musical timing assessment.
- Tetris and Side Scroller use held notes as controller commands. Sharing a
  well-tested recognizer may be convenient, but these are not assessment
  attempts and must not produce musical evidence.

### Persistence is correct in principle but split by surface

Exercise challenges and bank-backed game challenges can write portable attempt
evidence. Sheet Music keeps a separate per-score practice record. Ordinary game
runs remain in memory. These are defensible persistence policies, but today the
shape of the live attempt depends too much on which surface produced it.

## The core problem

Daylight has centralized several algorithms without centralizing the musical
attempt they belong to.

As a result:

1. **A consumer cannot start from canonical musical material.** There is no
   public function that accepts ordered onset events plus a run context and
   creates the correct cursor, held, or timed attempt.
2. **Self-paced assessment is second-class.** Learn shares a classifier but not
   lifecycle, criteria, diagnostics, spans, or a result.
3. **Event structure is lost at integration boundaries.** Flattening to MIDI
   arrays discards chords, rests, durations, and meaningful onset grouping.
4. **Surface behavior and measurement are duplicated.** Wrong counts, partial
   chords, progress, completion, and timing observations are reimplemented.
5. **The API boundary is too permissive.** Stateless helpers make incremental
   migration easy but allow new permanent forks.
6. **Assessment and control recognition are blurred.** A MIDI command or arcade
   collision can import assessment helpers even though no learner expectation
   is being evaluated.
7. **Scores and verdicts are not consistently consumable.** Games can scale an
   effect from a score, but cannot declaratively require a passed rubric.
8. **There is no reusable UI/runtime adapter.** Each React surface binds MIDI,
   clocks, reset, interruption, and completion itself.

## Where we want to be

### One canonical musical expectation

The shared input to every assessment should be ordered onset events, not a flat
note list:

```js
{
  id: 'event-12',
  pitches: [60, 64, 67],
  onsetQuarter: 8,
  durationQuarter: 1,
  spanId: 'measure-3',
  voices: [{ staff: 0, pitches: [60, 64, 67] }]
}
```

Not every field must be judged immediately. Preserving the event is what lets
the same expectation support order-free chords in Learn, beat-relative targets
in Polish, and later duration, pedal, or per-hand assessment without another
content migration.

Expectation producers remain separate:

- the exercise bank materializes bank instances;
- score extraction produces renderer-independent score ranges;
- a game may author an explicit prompt;
- none of those producers owns matching or grading.

### Three first-class matcher families

#### Self-paced cursor

The cursor advances through ordered onset events. Pitches inside one event may
arrive in any order. A policy decides whether an unexpected note counts, is
ignored as unrelated activity, restarts a sequence, or merely flashes while
progress is retained.

The cursor measures:

- expected pitches;
- matched pitches;
- unexpected pitches;
- completed events and spans;
- partial current onset;
- response time as an ungraded diagnostic.

It does not measure beat placement.

#### Timed alignment

The timed matcher compares note attacks with millisecond targets compiled from
the same event stream and a tempo map. The clock advances even when the player
does nothing, so omissions and placement are observable.

It measures completeness, cleanliness, and placement and may apply a pace gate.

#### Held set

The held matcher evaluates a current snapshot for exact MIDI or pitch-class
equivalence, optional doublings/extras, and root-in-bass policy. It is suitable
for held chord exercises and flashcards.

Using the same set recognizer for a game command remains allowed as a utility,
but command recognition does not create or finalize an assessment attempt.

### One complete attempt lifecycle

Every assessment-capable surface should be able to use the same lifecycle:

```text
prepare expectation
    -> create attempt
    -> start attempt
    -> observe note-on / note-off / held snapshot / clock
    -> emit live classified events and progress
    -> close span or complete range
    -> finalize, abort, or time out
    -> project and optionally persist result
```

The pure core owns musical state transitions. A small runtime adapter may own
subscriptions and clocks. The surface owns whether completion shows wet ink, a
score card, damage, a laser, or nothing.

### One portable result, different authorized projections

A completed attempt returns:

```js
{
  status: 'completed',
  score: 0.91,
  criteria: {
    completeness: 1,
    cleanliness: 0.91,
    // placement exists only for a timed attempt
  },
  diagnostics: {
    wrong_notes: 2,
    response_median_ms: 780,
  },
  spans: {},
  gates: undefined,
  rubric: { id: 'sheet-learn-practice-v1', version: '1' },
  verdict: { score: 0.91, passed: true },
}
```

Persistence remains explicit:

- a Learn loop may update the per-score practice frontier;
- an Exercise challenge may write curriculum evidence;
- an exact bank-backed Battle Stadium challenge may write the same evidence;
- an ordinary arcade game may discard the result;
- controller commands never produce a result.

The core returns evidence but never decides whether that evidence is authorized
to unlock curriculum.

## Required use cases

| Surface/use case | Expectation source | Matcher | Criteria | Durable evidence |
|---|---|---|---|---|
| Sheet Music Learn, whole piece | score events + active hands | self-paced cursor | completeness, cleanliness | per-score practice only |
| Sheet Music Learn, looped range | score-range events | self-paced cursor, reset each valid lap | completeness, cleanliness; response diagnostics | per-measure/range practice |
| Sheet Music Polish | score events + tempo map | timed | completeness, cleanliness, placement | per-score tier best |
| Free Exercise practice | bank instance | self-paced cursor or held | completeness, cleanliness | practice attempt; no gate advancement |
| Paced Exercise challenge | bank instance + requirement | timed | completeness, cleanliness, placement + pace gate | curriculum-eligible attempt |
| Untimed Battle Stadium run | bank instance | self-paced cursor | completeness, cleanliness | bank challenge attempt |
| Paced Battle Stadium pattern | bank instance + requirement | timed | completeness, cleanliness, placement + pace gate | bank challenge attempt |
| Battle Stadium chord | bank instance | held | completeness, cleanliness; simultaneity diagnostic | bank challenge attempt |
| Piano Hero | chart events | timed | musical result in memory | none by default |
| Flashcard note/chord | card expectation | held | completeness, cleanliness | none by default |
| Space Invaders native mode | visible game objects | none | game hit/miss only | none |
| Tetris/Side Scroller command | control binding | no assessment; recognizer utility only | none | none |

## First-class reusable building blocks

### 1. Expectation compiler

Introduce a renderer-independent compiler that accepts canonical onset events
and run context, then produces matcher-ready expectations without losing event
identity.

Responsibilities:

- preserve onset groups and spans;
- filter active hands/voices;
- compile a tempo map to millisecond targets for timed attempts;
- retain source identity for evidence;
- validate that the requested mode is meaningful for the material.

This replaces private `ExerciseRun.jsx` target construction and prevents Battle
Stadium from flattening event structure.

### 2. Complete self-paced session runner

Extend or replace `drillRun.js` so an ordered run is a sequence of onset sets,
not merely a flat ordered MIDI list. Promote `classifyCursorStep` from a
standalone helper into the runner's transition logic.

Required policies include:

- pitches within an onset: `any` or `strict`;
- unexpected input: `count-and-continue`, `restart`, or `ignore-unrelated`;
- plausibility window;
- span/range boundaries;
- loop reset without losing prior finalized evidence.

### 3. Stable assessment-session API

The public API should create an attempt from material and context rather than
requiring each surface to understand internal runner shapes. One possible
direction is:

```js
const attempt = createAssessmentAttempt({
  expectation,
  context: { mode: 'free', activeParts, source },
  policy,
  requirement,
});

observeAssessment(attempt, { type: 'note_on', pitch, atMs });
advanceAssessmentClock(attempt, atMs);       // timed only
closeAssessmentSpan(attempt, spanId);
finalizeAssessmentAttempt(attempt);
```

Exact names are an implementation decision. The contract must make invalid
combinations difficult: a free cursor attempt should not accept timing targets,
and a held snapshot should not be sent through note-attack matching.

Compatibility helpers can remain temporarily, but first-party assessment
surfaces should converge on the full lifecycle.

### 4. Framework adapter, not framework ownership

Provide a small React hook or external-store adapter for the repetitive binding
work:

- subscribe to MIDI once;
- hold hot attempt state outside React render state;
- expose low-frequency progress/result state;
- manage start, reset, abort, timeout, and cleanup;
- forward live classified events to surface callbacks.

The pure engine must remain usable from tests, non-React games, and future
hardware/runtime integrations.

### 5. Exercise-attempt adapter

Extract exercise compilation and result construction from `ExerciseRun.jsx`.
It should accept a materialized bank instance and run intent and return a
canonical attempt configuration. Both Exercises and Battle Stadium should use
it.

It must support:

- free strict sequences;
- free order-independent chords;
- metronome-assisted but ungraded practice;
- cued/paced challenges;
- exact authored requirements;
- adaptive selected material;
- rests, note values, and simultaneous events.

### 6. Explicit game challenge contract

The Gaming runtime needs to distinguish two projections:

- **quality projection:** map assessment score bands to damage/block/focus;
- **requirement gate:** require `verdict.passed` before an action is considered
  successful or before durable curriculum credit is granted.

A game definition should be able to request either or both without recreating
musical grading rules.

### 7. Evidence adapters

Keep writers outside the core, but standardize what they receive. Provide
adapters for:

- per-score Learn practice cycles;
- per-score Polish tier bests;
- piano attempt ledger records;
- in-memory game projections.

The adapter decides authorization and storage identity. It does not recompute
the musical observation.

## Surface migrations

### Sheet Music Learn

1. Make Learn consistently player-driven and wait-for-correct.
2. Compile the selected score/range and active hands into canonical onset
   events.
3. Replace `useFollowTracker`'s private struck/progress state with a self-paced
   assessment attempt.
4. Keep wet ink, cursor motion, reveal assistance, range selection, and cycle
   invalidation in `ScorePlayer`.
5. Finalize each valid lap and project spans into the existing practice
   frontier, retaining response-time diagnostics without grading them.

### Exercises

1. Extract private run builders and requirement construction from
   `ExerciseRun.jsx`.
2. Bind the component to the common attempt runtime.
3. Preserve the distinction between practice evidence and curriculum-eligible
   challenge evidence.

### Battle Stadium

1. Consume `expected_events`, not only `expected_midi`.
2. Use the exercise-attempt adapter for free and cued bank material.
3. Make paced adaptive selection carry a real tempo/requirement.
4. Let game definitions explicitly choose score-scaled outcomes, pass-gated
   outcomes, or both.
5. Preserve the provider's proven prepare/start/dispose, stale-input, virtual
   keyboard, and persistence lifecycle as a surface adapter.

### Sheet Music Polish

Retain its current timed session architecture, then migrate target compilation
to the canonical event compiler. Polish is the reference implementation for
span closing and timing-aware results.

### Piano Hero

Retain timed matching and the separation between musical assessment and
points/combo. Migrate only where the canonical expectation and lifecycle reduce
special casing.

### Space Invaders

Remove assessment from native Invaders collision and unused result projection.
If Hero-style timed levels remain in this engine, isolate their timed adapter so
the mode boundary is explicit.

### Flashcards and command-driven games

Flashcards may adopt a complete held attempt when they need a portable result.
Tetris and Side Scroller should depend on a neutral held-combination recognizer,
not create assessment sessions.

## Non-goals and boundaries

- The assessment core does not select curriculum or difficulty.
- It does not render notation, feedback, or game chrome.
- It does not award points, damage, stars, or progression.
- It does not decide whether a user or context is authorized to persist evidence.
- It does not turn every MIDI comparison into an assessment; controller input
  and arcade collision remain outside.
- It does not grade timing in a wait-for-correct interaction.
- Sustain, duration, articulation, dynamics, and per-hand attribution remain
  future measurement dimensions. The canonical event model should preserve the
  information needed to add them later.

## Acceptance criteria

The performance assessment capability is first-class when all of the following
are true:

1. A test can materialize either a score range or bank instance, choose free or
   cued mode, feed MIDI events, and obtain a complete portable result without
   mounting React.
2. Sheet Music Learn uses a full self-paced session and no longer owns an
   independent chord-step matcher or wrong-note tally.
3. Learn results never contain `placement`, even when its optional metronome is
   sounding.
4. Polish and paced exercises compile timing from canonical events and tempo
   maps rather than flat note assumptions.
5. Exercises and Battle Stadium use the same exercise-attempt compiler.
6. A Battle Stadium definition can request an adaptive untimed run, a genuinely
   paced pattern, or an exact exercise requirement without frontend-specific
   MIDI content.
7. Game mechanics can consume either assessment score or pass verdict without
   recomputing criteria.
8. Native Space Invaders and controller-command games do not masquerade as
   musical assessment consumers.
9. Live event classification, final criteria, span totals, and persisted
   diagnostics agree across surfaces for the same expectation and performed
   input.
10. Existing surface projections—Learn ink, Polish washes, Exercise pass cards,
    Hero combo, and Battle Stadium damage—remain surface-owned.

## Suggested delivery sequence

1. **Canonical event and expectation compiler.** Preserve onset groups, spans,
   durations, source identity, hands, and tempo coordinates.
2. **Self-paced runner.** Consolidate `classifyCursorStep`, `drillRun`, and
   ordered challenge progression behind one full session lifecycle.
3. **Exercise adapter.** Extract Exercise run construction and cover free,
   held, and paced material with pure tests.
4. **Learn migration.** Make wait-for-correct a full assessment consumer and
   adapt finalized laps into the existing practice record.
5. **Battle Stadium migration.** Consume event structure and add explicit
   quality/pass game semantics.
6. **Timed compiler convergence.** Move Polish, paced Exercises, and Hero to the
   canonical expectation compiler.
7. **Boundary cleanup.** Remove native Space Invaders assessment and move game
   command matching behind a neutral recognizer API.
8. **Public API cleanup.** Deprecate compatibility exports once all first-party
   assessment surfaces use complete attempts.

## Open design decisions

- Whether the self-paced matcher is named `cursor`, `cursor-set`, or represented
  as `cursor` plus an onset-order policy.
- Whether a complete session object remains immutable return-by-replacement or
  is wrapped by a mutable runtime while retaining a pure reducer underneath.
- Whether Learn writes full attempt records in addition to its compact per-score
  frontier. It must not become curriculum-eligible merely because its evidence
  becomes richer.
- How score ranges receive stable identity if they are later used as explicit
  game or curriculum challenges.
- Whether a failed game requirement retries the move, produces a weak effect,
  or consumes the turn. The assessment service supplies the verdict; the game
  definition owns that consequence.

## Outcome

The desired end state is not one giant piano mode and not one universal score.
It is one trustworthy musical attempt model used in different contexts.

Learn remains patient. Polish remains clocked. Exercises remain curricular.
Battle Stadium remains a game. Hero retains its combo. Commands remain
commands. What becomes shared is the musical truth underneath them: what was
expected, what was played, how they aligned, and what evidence that produced.
