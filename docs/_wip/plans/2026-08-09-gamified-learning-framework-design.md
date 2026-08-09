# Gamified Learning Framework & Challenge Engine — Revised Design

**Date:** 2026-08-09
**Revision:** 2 — assumption-audit corrections
**Status:** Design only. No implementation authorized by this document.

The previously named “System Requirements Specification: Gamified Learning Framework &
Challenge Engine” is not present in this repository. Requirement IDs are retained for
continuity, but this document does not claim that an absent source requirement has been
satisfied. The canonical SRS must be committed or linked before implementation approval.

---

## 1. Purpose and evidence standard

Build a reusable game/challenge boundary in which a game can ask a domain provider to
measure a skill attempt. The first vertical slice is a **single-player card battle** whose
attacks are resolved by piano chord challenges.

The long-term goal is a data-driven engine capable of supporting card, track, grid, and
initiative-based games. That is a hypothesis to prove with executable fixtures, not a
capability this document declares complete.

This revision adopts three evidence rules:

1. A requirement is not **Met** until an automated acceptance fixture demonstrates it.
2. Existing code is not “reusable with no changes” unless its input, output, lifecycle,
   and correctness already match the new use case.
3. A data structure such as a graph or grid is not evidence that the rules of a game can
   be expressed.

### 1.1 Product hypothesis

The product hypothesis is that a short skill attempt can add useful practice to a game
without making the game feel punitive or slow. The following are hypotheses, not facts:

- A challenge can resolve quickly enough to preserve game flow.
- Mapping practice quality to game effects remains motivating after repeated use.
- Learners do not choose or exploit easier challenges merely to win the game.
- A game interruption does not reduce the quality of the musical practice.

These are tested with the card-battle pilot before a general rule language, mastery
system, fitness provider, or additional genre UI is authorized.

### 1.2 Scope decisions

| Decision | Revised position |
|---|---|
| Runtime | Client-side for immediate interaction; server persists versioned sessions and domain attempts |
| First release | One card battle and one piano chord provider |
| Data-driven rules | A small versioned schema for the vertical slice; a broader DSL is derived later from four executable genre fixtures |
| Presentation | The first game has a purpose-built React view. YAML-only presentation is not promised |
| Additional genres | Representative semantic fixtures precede DSL expansion; complete Monopoly/Sorry/Stratego implementations are not implied |
| Fitness | Deferred until the SPI works in field use; `GovernanceEngine` is not wrapped speculatively |
| Difficulty | Fixed/configured bands in the pilot; adaptive mastery is a later evidence-gated phase |
| Behaviors | Permitted, versioned code dependencies. A definition using one is not described as “pure YAML” |

### 1.3 Non-goals for the pilot

- Networked or multi-device play.
- Security-grade concealment of hidden state on a client-authoritative device.
- A generic visual editor or generic game renderer.
- Full commercial-board-game rules.
- Coin-economy rewards.
- Adaptive difficulty.
- Fitness, typing, or mental-math providers.

---

## 2. What exists and what it actually provides

### 2.1 Existing games

`frontend/src/modules/Piano/` contains five hand-written games behind
`gameRegistry.js`. They demonstrate input and kiosk integration but do not provide a
shared rules engine or shared scoring model.

`frontend/src/modules/GameShow/` contains a pure Jeopardy reducer and a game-specific
shell. It is evidence that reducer-driven state machines work in this repository; it is
not evidence that one reducer schema covers unrelated genres.

### 2.2 Existing piano components

| Existing component | Honest reuse assessment |
|---|---|
| `parseMusicXml`, score model, `scoreTimeline` | Reusable foundations, subject to the documented single-part/tempo limitations |
| `serializeMusicXml` | Reusable for supported v1 scores; does not round-trip arbitrary multipart scores or a general tempo map |
| `MusicXmlRenderer` / OSMD | Reusable renderer behind an adapter; it consumes MusicXML and has asynchronous layout readiness |
| `SvgStaffRenderer`, `ChordStaffRenderer` | Reusable presentation components for their existing input shapes |
| `NoteHighlightLayer` | SheetMusic/OSMD integration code; it mutates engraved SVG elements and is not a renderer-independent overlay |
| `clickScheduler`, `useMetronomeClick`, `countIn` | Useful timing implementation, but lifecycle and WebAudio ownership must be integrated into the provider runtime |
| `midiTap`, `noteHistory`, MIDI hooks | Useful normalization and transport pieces; the provider still needs one explicit input adapter |
| `flashcardEngine` chord vocabulary and match helpers | Reusable vocabulary and chord-set matching for untimed chord prompts |
| `scoreEvaluator.gradeMeasure` | **Not suitable for passage grading.** It checks distinct pitch presence, ignores sequence multiplicity, and does not penalize stray notes |
| `polishTiers`, `gradeTally` | Reusable only after a correct lower-level grader produces valid measure scores |

### 2.3 Required new piano foundation

The timed piano provider requires a new one-to-one performance aligner. It must match
expected note occurrences to performed note occurrences rather than compare pitch sets.
This is first-class product work, not a configuration wrapper around `gradeMeasure`.

---

## 3. Architecture

### 3.1 Runtime-neutral shared core

The validator, expression evaluator, reducer, projection rules, session contracts, and
seeded RNG live in a runtime-neutral root package:

```text
shared/gaming/
  contracts.mjs       commands, yields, events, results, serialized state
  definition.mjs      schema versioning and canonicalization
  expressions.mjs     parser/evaluator for the explicitly defined grammar
  reducer.mjs         pure state transition
  projection.mjs      viewer-relative state projection
  rng.mjs             seeded RNG implementation
  validator.mjs       static and semantic definition validation
```

The package imports no React, DOM, browser APIs, filesystem APIs, ConfigService, domain
provider, or backend layer. Both the browser and backend import this same implementation.

```text
frontend/src/modules/Gaming/
  runtime/             React host, controller, logging, API client
  views/               registered purpose-built views (card battle first)

frontend/src/modules/Piano/challenge/
  provider/            piano provider and challenge runtime
  grading/             new timed and untimed evaluators

backend/src/1_adapters/persistence/yaml/gaming/
  YamlGamingDefinitionStore.mjs
  YamlGamingSessionStore.mjs

backend/src/3_applications/gaming/
  definition and session use cases

backend/src/4_api/v1/routers/
  gaming.mjs
```

The backend domain layer may define gaming value objects and invariants, but filesystem
loading remains in an adapter. Application use cases depend on store ports and are wired
in `5_composition`.

### 3.2 Dependency enforcement

- `shared/gaming/**` may not import from `frontend/**`, `backend/**`, or a domain module.
- `frontend/src/modules/Gaming/**` may not import from Piano or Fitness.
- App composition registers providers and views.
- A new frontend-aware dependency audit must scan `.js`, `.jsx`, and `.mjs`; the current
  `audit:layers` script scans only backend `.mjs` and cannot enforce this rule unchanged.

### 3.3 Data locations

| Artifact | Canonical path |
|---|---|
| Gaming app config | `data/household[-{hid}]/config/gaming.yml` |
| Game definitions | `data/household[-{hid}]/apps/gaming/games/{game_id}/` |
| Household shared fragments | `data/household[-{hid}]/apps/gaming/shared/` |
| Immutable definitions used by sessions | `data/household[-{hid}]/history/gaming/_definitions/{definition_hash}.yml` |
| Gaming sessions | `data/household[-{hid}]/history/gaming/{YYYY-MM-DD}/{session_id}.yml` |
| Piano mastery cache | `data/users/{user_id}/apps/piano/mastery.yml` |
| Piano attempt ledger | `data/users/{user_id}/apps/piano/attempts/{YYYY-MM-DD}/{attempt_id}.yml` |

All paths are resolved by backend services using `ConfigService`; frontend code never
reads YAML files directly.

### 3.4 Definition loading and includes

A definition bundle contains `game.yml` and optional fragment files. The loader:

1. Resolves every file beneath the selected household’s gaming directory.
2. Rejects absolute paths, `..`, symlink escapes, duplicate keys, include cycles, and an
   include depth greater than the configured maximum.
3. Parses and merges in a documented deterministic order.
4. Validates against the declared `schema_version`.
5. Produces canonical JSON-compatible data and hashes that representation.
6. Stores the canonical definition by hash when a session starts.

An mtime cache must include the dependency mtimes of every included fragment. A running
session uses its pinned definition and never changes when an author saves a file.

---

## 4. Engine contract and execution semantics

### 4.1 Reducer

```js
transition(state, command, definition) -> {
  state,
  events,
  yield: null | YieldRequest
}
```

The transition is pure and deterministic for the same compatible engine version,
definition, state, command sequence, and seed. `events` are descriptive domain events;
the runtime decides how to log, animate, or persist them.

External work is represented by a yield. The engine never invokes a provider, React,
WebAudio, a network call, or an AI policy directly.

### 4.2 Commands and yields

Commands have `command_id`, `session_revision`, and a typed payload. Duplicate
`command_id` values are idempotent.

Initial command vocabulary:

- `start_session`
- `choose_action`
- `choose_target`
- `submit_choice`
- `submit_challenge_result`
- `abort_pending_action`
- `resume_session`

Initial yield vocabulary:

- `player_choice`
- `challenge`
- `handoff`
- `terminal`

### 4.3 Pending-action transaction

An action that yields is represented explicitly in `state.pending_action`.

1. Validate actor, phase, action, target, and cost.
2. Reserve the cost without committing it.
3. Create a stable challenge request and yield it.
4. On one valid result, atomically commit the cost and mapped outcome effects.
5. On `aborted`, `timeout`, or `error`, apply the definition’s explicit terminal policy.
6. Reject duplicate, stale, or mismatched results.

Defaults are conservative: aborted and infrastructure-failed challenges refund reserved
costs and leave the turn actionable. A game may override timeout behavior explicitly.

### 4.4 Execution safety

Every transition is atomic. If expression or effect evaluation fails, the prior state is
returned with a structured engine error; partially applied effects never escape.

Configured hard limits include:

- Effects per command
- Hook cascade depth
- Automatic phase transitions per command
- Tokens spawned per command and per session
- Expression length and AST node count
- Collection size used by expression functions

Exceeding a limit terminates the transaction loudly with the definition source path.

---

## 5. Versioned rule schema

### 5.1 Evidence before generalization

Before the broader rule schema is frozen, four engine-independent acceptance traces are
written as state/command/expected-state fixtures:

1. Card battle: draw, hand, energy cost, targeting, challenge result, defeat.
2. Track race: random move, exact-count rule, capture, extra turn.
3. Hidden-rank grid skirmish: private setup, legal movement, public position, private
   rank, combat reveal.
4. Initiative encounter: initiative order, timed modifier, defeat, round rollover.

These are representative mechanics, not claims to implement every rule of Monopoly,
Sorry, Trouble, or Stratego. Complete named games require their own rule corpus.

### 5.2 Definition shape

```yaml
schema_version: 1
game_id: scale-clash
view_id: card-battle-v1
required_behaviors: []

players:
  min: 1
  max: 2

zones: {}
entities: {}
turn: {}
actions: {}
hooks: []
end_conditions: []
```

`view_id` is an honest code dependency. Mechanics and content can be data-driven while a
purpose-built view controls layout, art, animation, accessibility, and kiosk interaction.
A game is not promised to be YAML-only unless it uses an existing compatible view and no
new behaviors.

### 5.3 Tokens, zones, and field visibility

Tokens and zones remain useful primitives, but visibility applies independently to token
existence and token fields:

```yaml
zones:
  battlefield:
    kind: grid
    width: 10
    height: 10
    visibility: public

entities:
  ranked_piece:
    owner_required: true
    attributes:
      rank: 1
    visibility:
      existence: public
      fields:
        attributes.rank: owner
```

Projection receives a viewer id. It may show an opponent piece and position while
redacting its rank. Revealed fields are represented as state changes, not projection
exceptions.

On a client-authoritative hot-seat device, projection is presentation privacy only. Full
state exists in memory and is inspectable. Security-grade hidden information requires a
server-authoritative or separate-device design and remains out of scope.

### 5.4 Expression grammar

Expressions are side-effect-free strings parsed into an AST. Schema v1 supports exactly:

```text
literals       number | string | true | false | null
references     root ("." identifier)*
unary          -expr | not expr
arithmetic     + - * / %
comparison     == != < <= > >=
boolean        and or
grouping       ( expr )
functions      min, max, abs, floor, ceil, round,
               count, contains, has, sum, distance
```

There is no assignment, arbitrary function dispatch, property call, `in` operator,
ternary, random function, or access to global objects in schema v1.

Base roots available everywhere:

- `game`
- `phase`
- `actor`
- `player`
- `target`
- `zones`
- `last_result`

Additional roots are context-specific:

| Context | Additional roots |
|---|---|
| Hook | `event`, `token`, `node`, `from_zone`, `to_zone` |
| End condition | `candidate_player` |
| Turn ordering | `candidate` |
| AI candidate scoring | `candidate` |

Unknown roots, functions, or properties are validation errors. Randomness is never an
expression scope; it is consumed only by explicit seeded effects.

### 5.5 Effects

Effects use one uniform shape rather than making each YAML key a different mini-language:

```yaml
- op: adjust
  path: target.pools.health
  by: "-actor.attributes.attack"
  when: "target.pools.health > 0"
```

Fields declared by the schema as references (`path`, `token`, `from`, `to`) use the same
dotted-reference grammar and are resolved as references, not arbitrary strings. Literal
strings occupy separately named fields such as `event`, `message`, or `modifier_id`.

Schema v1 effects:

- `set`
- `adjust`
- `move`
- `draw`
- `shuffle`
- `spawn`
- `destroy`
- `add_modifier`
- `remove_modifier`
- `roll`
- `emit`
- `goto_phase`
- `end_turn`
- `end_game`
- `behavior`

Player choice and challenge invocation are action resolution types, not effects. Messages
and animation hints are presentation metadata, not undeclared effect verbs.

### 5.6 Hooks

Hooks receive a typed event payload. A zero-pool hook is expressed without relying on the
truthiness of zero:

```yaml
hooks:
  - on: pool_changed
    when: "event.path == 'pools.health' and event.new_value == 0"
    effects:
      - { op: move, token: token, to: zones.discard }
      - { op: emit, event: creature_defeated }
```

Hook ordering is definition order. Events generated by effects enter a FIFO queue.
Cascade and phase-transition limits prevent infinite loops.

### 5.7 Turn order and AI

Turn order is structured rather than embedded in expression syntax:

```yaml
turn:
  order:
    type: initiative
    by: "candidate.attributes.speed"
    direction: desc
```

An AI policy evaluates legal action candidates produced by the engine:

```yaml
ai:
  policy: greedy
  score: "candidate.expected_value - candidate.risk"
```

`expected_value` and `risk` are declared numeric candidate fields produced by a registered
policy adapter; they are not arbitrary expression functions. The chosen candidate is
recorded as a command so replay does not rerun an evolving policy.

### 5.8 Behaviors

A behavior is a versioned pure function over validated engine primitives that returns
effects. Definitions declare every required behavior, and a session records the behavior
manifest hash.

A behavior may not perform I/O, use ambient randomness, read a clock, access the DOM, or
retain state. A game requiring a new behavior requires code review and is documented as a
code-plus-data game.

The registry count is not the quality gate. The quality gate is whether behaviors remain
generic, deterministic, tested, and shared by more than one definition. Per-game behavior
growth is evidence that the schema should not be generalized further.

---

## 6. Challenge provider contract

### 6.1 Lifecycle

A provider creates one runtime that owns its UI, input subscription, and clock:

```js
provider = {
  id: 'piano',
  version: '1',
  capabilities(),
  async createRuntime({ userId, signal, api, logger })
}

runtime = {
  Surface,
  ready, // Promise<void>
  async prepare(request),
  async start(prepared, { signal, notBeforeMs }),
  cancel(reason),
  dispose()
}
```

The runtime is created and optionally warmed before the first challenge. `ready` must
resolve before `start`. The runtime owns metronome phase, input buffers, cancellation, and
cleanup; `start` never operates against an unspecified external clock.

“Warm” means the UI and input adapter remain mounted. It does **not** mean the metronome
clicks throughout game decisions. Clicks begin during the explicit count-in and stop at
the challenge boundary.

### 6.2 Challenge request

```text
challenge_id       stable id; unique within the session
domain             provider id
kind               provider capability
difficulty         fixed band or explicit parameters
user_id            known roster user
timeout_ms         optional positive integer
context            game_id, action_id, turn, session_id
```

`prepare()` is asynchronous because it may preload profile or score data. It returns a
fully concrete, serializable `PreparedChallenge` containing the exact exercise, grading
policy version, expected events, and provider version. The prepared challenge is persisted
before execution so the attempt can be reproduced and audited.

### 6.3 Challenge result

```text
status              completed | aborted | timeout | error
score               0.00–1.00 for completed; null otherwise
metrics             provider-versioned domain metrics
provider_version    version used for preparation and grading
attempt_id           durable domain-attempt id when persistence succeeded
```

There is no separate `FAILED` status. A completed attempt may have a low score. Gaming
maps the continuous score to its own outcome bands; the provider never returns a combat
tier or stat modifier.

Every challenge action declares policies for `aborted`, `timeout`, and `error`, or accepts
the conservative refund-and-retry defaults. A rejected promise is normalized to `error`
and cannot leave `state.pending_action` wedged.

### 6.4 Outcome mapping

Thresholds belong to the game action or gaming config and are captured in the session’s
effective configuration:

```yaml
resolve:
  type: challenge
  domain: piano
  kind: chord
  difficulty: medium

outcomes:
  - { min_score: 0.95, id: perfect, effects: [] }
  - { min_score: 0.85, id: high, effects: [] }
  - { min_score: 0.70, id: medium, effects: [] }
  - { min_score: 0.50, id: low, effects: [] }
  - { min_score: 0.00, id: fail, effects: [] }

terminal_policy:
  aborted: retry
  timeout: retry
  error: retry
```

Validator rules require descending, complete, non-overlapping score coverage.

---

## 7. Piano grading and generation

### 7.1 Timed event model

Expected events use stable occurrence ids:

```text
id, midi, staff, onset_ms, duration_ms, chord_group, measure_index
```

Performed events include normalized MIDI onset, release, velocity, channel, and sustain
state. All timestamps use the provider runtime’s monotonic clock.

### 7.2 One-to-one alignment

The evaluator performs a bounded one-to-one alignment between expected and performed
occurrences. One performed event cannot satisfy several repeated expected notes, and one
expected event cannot consume several performances.

The grading policy specifies:

- Early and late timing windows
- Chord simultaneity tolerance
- Missing-note penalty
- Stray-note penalty
- Repeated-note/re-articulation rules
- Sustain handling
- Whether release duration contributes to score

The result reports at minimum:

- Expected, matched, missed, and stray occurrence counts
- Pitch accuracy
- Timing accuracy
- Mean and percentile absolute drift
- Worst measure/span
- Combined score with its grading policy version

Adversarial acceptance tests include:

- A scale played backward is not perfect.
- One note cannot satisfy four repeated occurrences.
- Correct notes plus garbage are penalized.
- A correct chord with a wrong bass follows the declared policy.
- No-input, early, late, duplicate, retriggered, and sustain-pedal cases are explicit.

### 7.3 Untimed mode

Untimed mode is a target/attempt state machine, not timed grading with timing set to zero.
Each wrong attempt is recorded and penalized according to policy. Correct input advances
the target without erasing prior attempts. It may reuse chord vocabulary and match
helpers, but it does not reuse the existing flashcard hook as the provider lifecycle.

### 7.4 Exercise generation

The generator emits the complete supported Score model, using the existing note/score
factories so pitch, MIDI, type, duration, voice, staff, chord, and measure structure agree.

Pilot constraints:

- One MusicXML part with up to two staves
- Constant tempo for the challenge
- Supported note values and 3:2 triplets only
- No mid-piece key or time-signature changes

Generated content is serialized for OSMD and separately normalized into expected grading
events. Static MusicXML is parsed and normalized into the same expected-event form, but
unsupported imported MusicXML is not forced through `serializeMusicXml` merely to claim a
round trip.

The first generator supports chord prompts. Scales, arpeggios, progressions, and passages
are added only after the occurrence aligner passes its acceptance corpus.

---

## 8. Persistence, resume, and replay

### 8.1 Backend API

```text
GET  /api/v1/gaming/definitions/:game_id
POST /api/v1/gaming/sessions
GET  /api/v1/gaming/sessions/:session_id
PUT  /api/v1/gaming/sessions/:session_id
POST /api/v1/gaming/sessions/:session_id/complete

GET  /api/v1/piano/users/:user_id/mastery
POST /api/v1/piano/users/:user_id/attempts
```

`POST sessions` pins the canonical definition, engine version, behavior manifest, seed,
participants, and effective gaming configuration. It returns `session_id` and revision 0.

`PUT sessions/:id` uses optimistic revision matching and idempotency keys to append ordered
commands/events and store a checkpoint. A stale revision returns 409. It supports active,
aborted, and abandoned sessions; persistence is not deferred until completion.

### 8.2 Session record

Each session stores:

```text
schema_version
session_id, household_id, participants, status
engine_version, definition_hash, behavior_manifest_hash
seed, effective_gaming_config
provider versions and relevant profile revisions
ordered commands and externally supplied results
prepared challenge snapshots and attempt ids
serialized state checkpoint and checkpoint revision
created_at, updated_at, completed_at
```

The backend validates envelope shape, session revision, participant membership, definition
identity, result bounds, and pending challenge identity. MIDI grading remains client-origin
data in the pilot and is labeled with its trust source; it is not silently treated as
tamper-proof.

### 8.3 Resume contract

The serialized checkpoint is the primary resume format. The ordered log is the audit and
verification format.

On load:

1. Load the pinned canonical definition.
2. Verify engine/schema/behavior compatibility.
3. Replay to the checkpoint in development/tests when compatible and compare canonical
   state hashes.
4. Resume from the checkpoint.

Exact replay is promised only for the same compatible engine and behavior versions. A
version mismatch invokes an explicit migration or refuses exact replay; a definition hash
alone is not claimed to version executable code.

### 8.4 Domain attempt ownership

Piano owns a durable attempt ledger covering game challenges and future non-game practice.
The gaming session stores the returned `attempt_id` plus the immutable result snapshot.
Mastery is derived from the piano attempt ledger, not only from gaming history.

A gaming session update and piano attempt write require idempotency keys. Reconciliation
can repair a session whose attempt write succeeded but session reference update failed.

### 8.5 Coin economy boundary

No direct “challenge completed → coins” subscriber is specified. Client-origin scores are
not sufficient authority for economy mutation. Any future integration requires a server
policy covering trust, caps, idempotency, reversals, and abuse resistance.

---

## 9. Difficulty and mastery

### 9.1 Pilot

The pilot uses explicit per-user configuration or a fixed band. Difficulty does not adapt
within a session. This isolates whether the game/challenge loop is useful before building
an inference system.

### 9.2 Later mastery model

Adaptive selection is authorized only after enough versioned attempts exist to evaluate
it offline. Its design must specify:

- A versioned skill-atom vocabulary
- How multi-atom exercises assign evidence
- Minimum observations and confidence intervals
- Cold-start defaults
- Recency/forgetting behavior
- Exploration versus exploitation
- Protection against repeatedly selecting easy material
- Migration/rebuild rules when scoring policy changes

Any target score range, including 0.70–0.85, begins as a configurable hypothesis and must
be validated against field completion and frustration data. An EWMA alone is not accepted
as a predictive model merely because it is easy to persist.

---

## 10. Presentation and field validation

### 10.1 First view

`card-battle-v1` is a purpose-built, touch-friendly React view. It owns:

- Board/card layout
- Art and asset manifest
- Action affordances and legal-target highlighting
- Animation driven by engine events
- Challenge transition and retry UI
- Resume/error states
- Accessibility labels and reduced-motion behavior
- Kiosk-safe focus and input handling

The view receives projected state and dispatches typed commands. It may not implement game
rules or mutate engine state directly.

### 10.2 Field gate

Before DSL expansion, supervised field sessions record:

- Challenge preparation, count-in, performance, and grading durations
- Aborts, retries, timeouts, and game abandonment
- Score distributions and obvious grading errors
- Whether learners request easier material or bypass practice
- Qualitative feedback on flow, punishment, clarity, and willingness to replay

The owner sets the sample size and acceptance thresholds before the pilot begins. The
decision is explicit: continue, revise the interaction, batch challenges, or stop. “Warm
surface” is an implementation option, not a substitute for this evidence.

---

## 11. Logging and observability

New frontend code uses the project logging framework. Required structured events include:

- Runtime mount, ready, dispose
- Definition load/validation success and failure
- Session start, checkpoint, resume, complete
- Command accepted, rejected, duplicate, stale
- Action pending, committed, aborted
- Provider prepare/start/result/cancel/error
- MIDI adapter connected/disconnected
- Grading summary with policy version, never raw high-frequency note spam at info level
- Replay/checkpoint divergence

High-frequency input and clock diagnostics use sampled debug logging. Domain `emit` events
are not automatically logs; the runtime deliberately maps relevant events to logging and
telemetry.

---

## 12. Testing strategy

| Layer | Required evidence |
|---|---|
| Shared contracts | Schema-version and serialization round trips |
| Expressions | Grammar corpus, unknown roots/functions, type errors, source positions, size limits |
| Effects | Atomic before/after fixtures, invalid paths, clamping, hook ordering, safety limits |
| Reducer | Deterministic command traces and duplicate/stale-command behavior |
| Pending action | Reserve/commit/refund, abort/timeout/error, duplicate results |
| Definition loader | Merge order, canonical hash, include invalidation, cycle/path escape rejection |
| Projection | Field-level owner redaction, reveal transitions, no hidden rank in projected state |
| Persistence | Start/update/complete, revision conflict, idempotency, checkpoint restore, reconciliation |
| Challenge SPI | Ready/start/cancel/dispose lifecycle and normalized failures |
| Piano aligner | Backward/repeated/stray/chord/timing/sustain adversarial corpus |
| Generator | Supported-model invariants and MusicXML renderability |
| Views | Command dispatch, legal affordances, retry/resume/error states |
| Genre corpus | Card, track, hidden-grid, and initiative traces run through the generalized schema before capability is claimed |

No conditional assertion skipping is permitted. Infrastructure failure fails the test.

---

## 13. Phasing and gates

| Phase | Deliverable | Exit gate |
|---|---|---|
| 0 | Four engine-independent genre traces; hard-coded card/chord UX prototype | Rules and interaction questions are concrete before a DSL is designed |
| 1 | New timed/untimed piano evaluator and provider-runtime spike | Adversarial MIDI corpus passes; lifecycle cancels and cleans up reliably |
| 2 | `shared/gaming` contracts/reducer for the card slice; purpose-built view | Card battle completes with scripted and real chord results |
| 3 | Versioned definition loading, session checkpoints, piano attempt persistence, logging | Abandoned session resumes; duplicate/stale writes are safe; attempt is durable |
| 4 | Supervised field pilot | Explicit go/revise/stop decision based on observed flow and grading |
| 5 | Generalized schema derived against all four prewritten traces | All four fixtures pass without per-game behavior; otherwise scope or abstraction is revised |
| 6 | Optional mastery model | Offline evaluation beats fixed-band baseline and documents confidence/cold start |
| 7 | Additional games/providers | Each earns its own rule corpus, view decision, and field gate |

The parser and effect vocabulary are not frozen in phases 0–3. The card implementation may
use a narrow schema or typed commands while evidence accumulates.

---

## 14. Risks and stop conditions

### R1 — Gamification may harm practice

If learners rush, choose trivial material, resent the interruption, or stop replaying, the
interaction is revised or stopped. More engine abstraction is not a mitigation.

### R2 — Passage grading is genuinely new

The occurrence aligner is the highest correctness risk. Direct event traces and
adversarial tests precede game integration.

### R3 — Generalization may not pay

If the four reference traces require unrelated behaviors or views, keep separate small
engines behind a shared challenge SPI. A universal DSL is optional, not a sunk-cost
obligation.

### R4 — Client authority limits trust

Client results are acceptable for household gameplay history but not automatically for
economy or security-sensitive rewards.

### R5 — Presentation may dominate cost

If each game needs substantial custom layout and animation, the value proposition becomes
shared engine/provider infrastructure rather than “new games are YAML.” The documentation
and estimates must say so plainly.

### Stop conditions

- The piano aligner cannot grade repeated and stray-note cases reliably.
- Median challenge flow is unacceptable in field use and batching does not help.
- The generalized schema needs per-game behaviors for most reference mechanics.
- Session persistence cannot resume safely across ordinary deployments.
- Learners show worse engagement or practice quality than the non-game baseline.

---

## 15. Requirements traceability

Statuses are deliberately conservative.

| Requirement | Status | Evidence required |
|---|---|---|
| FR-ENG-01 Pure YAML instantiation | **Unproven / modified** | A game using no new view or behavior; definitions with behaviors are code-plus-data |
| FR-ENG-02 Zero domain binding | **Designed** | Shared-core and frontend dependency audits pass |
| FR-ENG-03 Board/deck/encounter abstraction | **Unproven** | Four representative genre traces pass through one schema |
| FR-ENG-04 Variable resolution engines | **Designed** | Deterministic, seeded-random, and challenge action fixtures pass |
| FR-CHL-01 Invocation contract | **Designed** | Provider lifecycle contract tests pass |
| FR-CHL-02 Outcome contract | **Modified** | Continuous score plus terminal status; game owns outcome mapping |
| FR-PNO-01 Exercise vocabulary | **Partial** | Chords first; other exercise generators require separate fixtures |
| FR-PNO-02 Static + procedural selection | **Designed** | Both normalize into the occurrence event model |
| FR-PNO-03 Untimed mode | **New integration work** | Attempt-state corpus passes |
| FR-PNO-04 Metronome sync | **Integration work** | Provider-owned clock/lifecycle tests and field timing evidence |
| FR-PNO-05 Timing tolerance | **New grading work** | One-to-one alignment corpus passes |
| FR-PNO-06 Non-blocking stray notes | **New grading work** | Strays are recorded and penalized without freezing progression |
| FR-PNO-07 Dual-staff rendering | **Foundation exists** | Generated supported score renders correctly in provider surface |
| FR-PNO-08 Target overlay | **Integration work** | Provider surface usability test |
| FR-PNO-08 Split view | **Deferred pending field evidence** | Reconsider only if overlay is insufficient |
| FR-FIT-01 Abstract metric mapping | **Deferred** | Piano SPI field-proven first |
| FR-FIT-02 Fitness exit criteria | **Deferred** | Separate fitness-provider design |

No row moves to **Met** through documentation alone.

---

## 16. Related documentation

- `docs/reference/piano/piano-games.md`
- `docs/reference/piano/sheet-music-player.md`
- `docs/reference/piano/composer.md`
- `docs/reference/core/configuration.md`
- `docs/reference/core/backend-architecture.md`
- `docs/reference/core/layers-of-abstraction/`
- `docs/reference/economy/economy.md`
