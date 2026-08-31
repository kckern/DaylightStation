# State Gates — Architecture Reference

**Date:** 2026-08-30

**Status:** Implemented foundation; producer/consumer migrations remain opt-in

**Scope:** Backend contracts, ownership, persistence, delivery, and verification

**Architecture authority:** [DDD reference](../core/layers-of-abstraction/ddd-reference.md), [domain guidelines](../core/layers-of-abstraction/domain-layer-guidelines.md), [application guidelines](../core/layers-of-abstraction/application-layer-guidelines.md), [adapter guidelines](../core/adapter-layer-guidelines.md), [API guidelines](../core/layers-of-abstraction/api-layer-guidelines.md), and [decision register](../core/layers-of-abstraction/decision-register.md)

---

## 1. Decision

State Gates (`state-gates`) is a Level 1 shared bounded context. It receives authenticated,
typed assertions from existing producer contexts, evaluates household-authored policy,
and publishes current gate state plus binary entitlement decisions for registered
consumers.

The context is a policy projection, not a replacement for School, Piano, Fitness,
chores, or the screen framework. Those contexts remain authoritative for their own
state machines. They publish only the facts they choose to expose through the
the State Gates published language. State Gates never reaches into their repositories
or interprets their private records.

The event bus remains transport. It cannot establish truth. Only an authenticated
assertion command accepted by the State Gates application can change the projection.
Arbitrary event-bus messages cannot establish truth.

The implemented foundation lives under the corresponding `state-gates` domain,
application, adapter, API, and composition folders. It does **not** migrate an existing
gate, change a frontend, or alter a current producer state machine.

### Goals

- Give unrelated producers and consumers one stable, system-wide vocabulary for facts,
  gates, progress, and entitlements.
- Keep policy deterministic, typed, inspectable, and non-scriptable.
- Preserve source identity and provenance rather than collapsing competing producers
  into an implicit latest value.
- Support stale or unavailable evidence without pretending that unknown means false.
- Make current state queryable and transitions replayable after a disconnect.
- Make policy replacement, assertion correction, and assertion retraction safe and
  auditable.
- Follow the repository's layer rules with no exceptions.

### Non-goals

- A general workflow engine, rules scripting language, scheduler, or event store.
- A frontend governance model for hiding, disabling, replacing, pausing, or celebrating
  content.
- Cross-context reads into School, Piano, Fitness, chores, screen-framework, or other
  private stores.
- A migration of the existing Piano games budget, School completion state, Fitness
  governance, companion-media gate, or any current screen binding.
- Internet-public access. In this document, **public** means the controlled
  system-wide published language available to authorized household clients.

---

## 2. Ubiquitous language

| Term | Meaning |
|---|---|
| **Publisher** | An authenticated application, service, or device allowed to assert one or more claim types. |
| **Claim type** | The versioned definition of a fact's name, value type, subject/period contract, publishers, visibility, and validity rules. |
| **Assertion** | One publisher's versioned observation of one claim for one subject and period. |
| **Gate** | A named four-state policy expression over qualified assertions and other gates. |
| **Evaluation** | The current state, optional progress, sanitized reasons, validity, and revision for a gate instance. |
| **Entitlement** | A named binary capability whose decision is based on one gate and an explicit failure posture. |
| **Decision** | The current granted/denied result for one entitlement instance. |
| **Observation** | A complete, replayable statement of current evaluation or decision state at a revision. |
| **Transition** | A past-tense event emitted only when an already-materialized gate state or entitlement decision genuinely changes. |
| **Policy graph** | The atomically activated aggregate containing subject sets, claim types, gates, and entitlements. |
| **Source revision** | A publisher-monotonic revision for one assertion identity. It is distinct from the household revision. |
| **Household revision** | A monotonic sequence assigned to every accepted state-changing State Gates commit in one household. |

An assertion is evidence, not a decision. A gate interprets evidence. An
entitlement turns one gate state into one binary capability decision. A consumer
then decides how that capability looks on its own surface.

---

## 3. Context boundary and published language

The context relationship is customer/supplier with an explicit published language:

```text
School / Fitness / chores / other producers
  private state machines
        |
        | producer-owned translation policy
        v
authenticated State Gates assertion command
        |
        v
State Gates policy graph -> evaluations -> entitlement decisions
        |
        +------ current-state queries
        +------ observation and transition publications
                         |
                         v
              Piano / screens / Fitness / other consumers
                    consumer-owned presentation
```

Producer-specific publication policy stays in the producer application context. For
example, School decides what its private completion states mean before publishing
`school.day.complete`; State Gates does not import School entities and rediscover that
meaning. Likewise, Fitness decides how private workout/session data becomes a typed
`fitness.exercise.minutes` assertion.

The published language consists of:

- versioned assertion commands;
- current gate evaluations;
- current entitlement decisions;
- state observations;
- past-tense transition events; and
- sanitized reason codes.

Private producer entities, storage paths, role claims supplied by clients, raw evidence,
and event-bus payloads outside this contract are not part of the language.

---

## 4. Layer placement

### `0_system` — unchanged runtime plumbing

Keep the generic event bus, clock plumbing, structured logging, scheduler mechanics,
and FileIO exactly generic. Do not add gate IDs, policy parsing, assertion
persistence, state evaluation, publisher authority, or entitlement knowledge to this
layer.

### `2_domains/state-gates` — pure Level 1 shared domain

Own immutable references and definitions, the `Assertion` and `PolicyGraph` aggregates,
four-state evaluation, typed comparisons, counts, schedules, progress, decisions, and
domain events.

The domain:

- has no ports;
- performs no I/O, serialization, logging, publication, config access, or path work;
- never reads an ambient clock or default timezone;
- receives `now`, household timezone, identities, and validation catalogs as values;
- imports only Level 0 domain foundations; and
- returns domain records and events rather than wire or YAML shapes.

The `state-gates` domain appears in both Level 1 hierarchy tables in
`domain-layer-guidelines.md` and `ddd-reference.md`, as required by Decision D6.

### `3_applications/state-gates` — orchestration

Own use cases, application DTOs, ports, authorization decisions, revision allocation,
idempotency handling, durable commit order, reconciliation, query filtering, and the
`StateGatesContainer`.

All State Gates ports live here. The container receives concrete implementations from
composition and never imports an adapter, rendering implementation, API module,
ConfigService, FileIO, Node I/O, or the generic event bus.

Producer-specific translators remain in their producer application contexts. A producer
may define its own semantic assertion-sink port; composition can bind that port to the
State Gates ingress use case without moving the producer's translation policy into
composition.

### `1_adapters` — boundary translation

Own household YAML decoding, domain hydration/dehydration, FileIO-backed current-state
and transition storage, event-bus serialization, and publisher/client authentication at
ingress. Adapters translate; they do not decide whether a gate is satisfied.

Every flagship gateway or repository for which an application port exists must `extends`
that port, per Decision D7. Internal parsers and shared storage helpers remain exempt.

### `4_api` — HTTP translation only

Own injected router/handler factories for gate, entitlement, transition,
administrative policy, diagnostics, and manual-attestation resources. Handlers extract
HTTP input, obtain the authenticated principal from request context, call injected use
cases, and format responses.

The API never imports domains, applications, adapters, rendering, configuration, Node
I/O, or a repository. In particular, a claimed actor or role in the request body is never
trusted.

### `5_composition` — wiring and lifecycle only

Construct adapters, the container, producer bridges, router dependencies, and lifecycle
callbacks. Resolve configuration and pass semantic values or loader functions rather
than ConfigService. Composition may order startup/reconciliation and schedule validity
boundary callbacks, but may not map School/Fitness state, evaluate policy, choose failure
posture, or serialize events.

### `1_rendering` and frontend

The foundation adds nothing to `1_rendering`. A later server-rendered indicator must
receive a complete presentation model through an injected rendering port; a renderer
must not query State Gates state.

Frontend consumers own presentation behavior. `hide`, `disable`, `replace`, `pause`,
warning copy, and satisfaction ceremonies do not belong in the backend entitlement
model.

### Source layout

```text
backend/src/
  2_domains/state-gates/
    aggregates/Assertion.mjs
    aggregates/PolicyGraph.mjs
    definitions/
    evaluations/
    events/
    refs/
    services/
    index.mjs

  3_applications/state-gates/
    StateGatesContainer.mjs
    contracts/
    ports/
      IStateGatesPolicySource.mjs
      IStateGatesProjectionRepository.mjs
      IStateGatesTransitionRepository.mjs
      IStateGatesEventPublisher.mjs
      IStateGatesAdministrationAuthorizer.mjs
    usecases/

  1_adapters/state-gates/
    config/YamlStateGatesPolicySource.mjs
    persistence/YamlStateGatesProjectionRepository.mjs
    persistence/YamlStateGatesTransitionRepository.mjs
    eventbus/StateGatesEventBusPublisher.mjs
    ingress/AuthenticatedStateGatesIngress.mjs

  4_api/v1/
    routers/state-gates.mjs
  5_composition/modules/stateGates.mjs
```

The concrete files may be split further inside these folders, but the ownership
boundaries above are fixed.

---

## 5. Domain contracts

All domain records below are immutable. Timestamps are instants, not formatted strings;
adapters own textual representation. Identifiers are validated, namespaced strings such
as `school.day.complete`, `fitness.exercise.minutes`, and `piano.games`.

### 5.1 `SubjectRef` and `PeriodRef`

```text
SubjectRef
  kind: learner | household | room | device
  id: non-empty stable identifier

PeriodRef
  kind: instant | local_day | local_week | interval | occurrence
  id: stable identifier within the household
  startsAt: Instant
  endsAt: Instant?       # exclusive when present
```

`SubjectRef` identifies what a claim is about. It does not prove that a subject exists;
`PolicyGraph` construction receives a roster/catalog and validates authored references.
The household is the application partition and is not smuggled into every domain ID.

`PeriodRef` is explicit so a late correction updates the intended day/session rather than
whatever period happens to contain the current clock. `startsAt`/`endsAt` are already
resolved instants. Local-day and local-week construction receives the household timezone
as an argument.

### 5.2 `ClaimTypeDefinition`

```text
ClaimTypeDefinition
  id: namespaced ClaimTypeId
  schemaVersion: positive integer
  valueSchema:
    boolean
    | integer { min?, max?, unit? }
    | number  { min?, max?, unit? }
    | string  { maxLength, pattern? }
    | enum    { values[] }
    | duration { unit }
  subjectKinds: non-empty set<SubjectKind>
  periodKinds: non-empty set<PeriodKind>
  acceptedPublishers: non-empty set<PublisherId>
  visibility: subscriber | administrative
  validity:
    maxAge?: Duration
    maxFutureSkew?: Duration
    mustFitPeriod?: boolean
    actorRequired?: boolean
    acceptedActorRoles?: set<RoleId>
```

The value schema is a closed typed union, not arbitrary JSON. New value kinds require a
domain change and tests. Regex support, if retained, is data validation only: it may not
execute code or make network/filesystem calls.

`acceptedPublishers` grants claim-type authority only after the caller's publisher
identity has been authenticated. A matching string in an event or request body grants
nothing.

`visibility` controls raw-claim diagnostic exposure. It does not make any endpoint
anonymous or internet-public.

### 5.3 `Assertion` aggregate

```text
Assertion
  id: stable publisher-issued AssertionId
  claimTypeId: ClaimTypeId
  subject: SubjectRef
  period: PeriodRef
  publisherId: authenticated PublisherId
  value: value conforming to ClaimTypeDefinition
  sourceRevision: positive integer
  observedAt: Instant
  validFrom: Instant
  validUntil: Instant?
  actor?: AuthenticatedActorRef
  evidenceRef?: opaque string
  status: active | retracted
  supersedesSourceRevision?: positive integer
  retractedAt?: Instant
```

The assertion identity is the pair `(publisherId, assertionId)`. Its fact slot is
`(claimTypeId, subject, period, publisherId)`. A publisher must keep the same assertion
ID when correcting or retracting that slot. Two publishers asserting the same claim type
therefore remain two independent sources.

Aggregate invariants include:

- claim type, value type, subject kind, and period kind must agree;
- the authenticated publisher must be accepted by the claim type;
- validity must be ordered and comply with the claim type rules;
- the observation cannot exceed the allowed future skew;
- an actor is required when the claim type says so;
- any role-sensitive rule uses only roles on an authenticated actor reference;
- source revisions increase monotonically for the assertion identity; and
- a retracted assertion cannot be silently made active without a higher-revision
  correction/observation.

Operations are explicit and auditable:

- `Assertion.observe(...)` creates the first active revision;
- `assertion.correct(replacement, correctionContext)` creates a higher revision and an
  `AssertionCorrected` event;
- `assertion.retract(retractionContext)` creates a higher-revision tombstone and an
  `AssertionRetracted` event.

These operations return a new aggregate version and events. They never delete a record
and never mutate an evaluation. Evaluations are derived again from active assertions.

`evidenceRef` is opaque to the domain. Only an administrative diagnostics adapter may
resolve it, and resolution is outside this foundation.

### 5.4 `GateDefinition` and expression tree

```text
GateDefinition
  id: namespaced GateId
  schemaVersion: positive integer
  subjectKinds: non-empty set<SubjectKind>
  periodKinds: non-empty set<PeriodKind>
  expression: GateExpression
  progress?: ProgressProjection
  reasonLabels?: sanitized code mapping
```

`GateExpression` is a closed, recursively validated algebra. Each YAML node maps
to exactly one of these types:

| Node | Purpose |
|---|---|
| `claim` | Read one explicitly qualified boolean claim source. |
| `reference` | Reuse another gate with compatible subject/period binding. |
| `all` | Require every applicable child. |
| `any` | Require at least one applicable child. |
| `not` | Negate one child's satisfied/unsatisfied result. |
| `comparison` | Compare one explicitly qualified typed claim to a typed literal. |
| `count` | Count satisfied members from an explicit list or named subject-set binding. |
| `schedule` | Test a household-timezone calendar window and expose its next boundary. |

A `claim` or `comparison` selector must name `claimTypeId` **and** `publisherId`.
There is no unqualified “latest assertion for this claim type” lookup. A policy that
accepts either of two producers writes two claim nodes under `any`; one that requires
both writes them under `all`. This makes source selection reviewable and prevents one
producer from overwriting another.

The expression language has no JavaScript, expression strings, template evaluation,
dynamic property access, I/O nodes, arbitrary functions, or event-bus queries.

### 5.5 `PolicyGraph` aggregate

```text
PolicyGraph
  schemaVersion: positive integer
  policyRevision: positive integer
  digest: content digest supplied by application/adapter
  subjectSets: map<SubjectSetId, immutable SubjectRef[]>
  claimTypes: map<ClaimTypeId, ClaimTypeDefinition>
  gates: map<GateId, GateDefinition>
  entitlements: map<CapabilityId, EntitlementDefinition>
  activatedAt: Instant
```

`PolicyGraph.create(candidate, validationContext)` owns the graph invariants. The
validation context contains values—not services—including the roster, known publisher
authorities, supported subject/period kinds, and timezone identifier.

The graph is the activation unit. No caller can add one definition directly to the
active graph.

### 5.6 `GateEvaluation`

```text
GateEvaluation
  gateId: GateId
  subject: SubjectRef
  period: PeriodRef
  state: satisfied | unsatisfied | indeterminate | not_applicable
  progress?: Progress
  reasons: SanitizedReason[]
  validFrom: Instant
  validUntil: Instant?
  nextBoundary?: { at: Instant, kind: evidence_expiry | schedule | period_end }
  policyRevision: positive integer
  householdRevision: positive integer
```

`Progress` is factual presentation data, never a decision:

```text
Progress
  current: finite non-negative number
  target: finite positive number
  unit: namespaced unit or count
  ratio: number clamped to [0, 1]
  basisNodeId: stable expression-node identifier
```

Reasons exposed outside administrative diagnostics are stable codes plus safe parameters,
for example `CLAIM_MISSING`, `CLAIM_STALE`, `THRESHOLD_NOT_MET`, and
`OUTSIDE_SCHEDULE`. They never contain an actor, evidence reference, storage path, raw
claim value marked administrative, stack, or producer credential.

### 5.7 `EntitlementDefinition` and `EntitlementDecision`

```text
EntitlementDefinition
  capabilityId: namespaced CapabilityId
  gateId: GateId
  failurePosture: fail_open | fail_closed

EntitlementDecision
  capabilityId: CapabilityId
  gateId: GateId
  subject: SubjectRef
  period: PeriodRef
  decision: granted | denied
  basisState: satisfied | unsatisfied | indeterminate | not_applicable
  degraded: boolean
  reasons: SanitizedReason[]
  validFrom: Instant
  validUntil: Instant?
  policyRevision: positive integer
  householdRevision: positive integer
```

An entitlement is exactly one binary capability. It has no tier number, remaining
minutes, UI action, or hidden/disabled state. Tiers are separate capability IDs such as
`piano.games.basic`, `piano.games.standard`, and `piano.games.extended`. Incremental
progress remains on the gate evaluation.

### 5.8 Observations and domain events

All events are past tense. The minimum domain set is:

- `AssertionObserved`
- `AssertionCorrected`
- `AssertionRetracted`
- `PolicyGraphActivated`
- `GateStateChanged`
- `EntitlementDecisionChanged`
- `StateRetired`

Assertion lifecycle events are internal administrative signals. After the corresponding
state commit succeeds, the application writes sanitized structured logs containing IDs,
revisions, and occurrence time only. They are not placed in subscriber replay or on the
household event bus.

Publication also uses a non-ceremonial current-state record:

```text
StateObservation
  observationId: stable transition ID
  kind: gate | entitlement
  key: gate/capability + subject + period
  current: sanitized GateEvaluation | EntitlementDecision
  initial: boolean
  cause: assertion_observed | assertion_corrected | assertion_retracted
       | policy_activated | validity_boundary | reconciliation
  householdRevision: positive integer
  occurredAt: Instant
```

Policy replacement also publishes `StateRetired` for every previously materialized
gate or entitlement instance absent from the new graph. Its subscriber-safe payload
identifies the instance key, kind, subject, period, and new policy revision, but carries
neither previous state nor assertion provenance.

The first materialization of a key emits `StateObservation { initial: true }` and **does
not** emit `GateStateChanged` or `EntitlementDecisionChanged`. A new subscriber
can render current state, but cannot mistake bootstrap or policy activation for a child
having just satisfied something.

After materialization:

- `GateStateChanged` is emitted only when the four-state value changes;
- `EntitlementDecisionChanged` is emitted when granted/denied, degraded, or basis state
  changes; and
- progress-only or reason-only changes emit a new observation but no satisfaction
  ceremony event.

Each event contains `from`, `to`, `cause`, policy revision, household revision, validity,
and sanitized reasons as appropriate. Raw assertions and detailed provenance are not
placed on the household event bus.

---

## 6. Evaluation semantics

Evaluation is a pure function of:

```text
(policyGraph, activeAssertions, gateId, subject, period, now, timezone)
  -> GateEvaluation draft
```

No evaluation may depend on call order, file order, insertion order, an ambient clock,
the process timezone, or an event-bus cache.

### 6.1 Claim resolution

For a qualified `(claimType, publisher, subject, period)` selector:

| Condition | State |
|---|---|
| Boolean `true` assertion is active and valid | `satisfied` |
| Boolean `false` assertion is active and valid | `unsatisfied` |
| No assertion, retracted assertion, stale assertion, type conflict, or unresolved evidence | `indeterminate` |
| Gate does not apply to the requested subject/period contract | `not_applicable` |

A missing or stale assertion is not false. A producer must publish false when it knows a
claim is false. Retraction restores uncertainty; it does not assert the opposite.

Comparisons support only compatible typed operations:

- number/integer/duration: `eq`, `neq`, `lt`, `lte`, `gt`, `gte`;
- enum/string: `eq`, `neq`, and explicitly schema-approved membership; and
- boolean: direct `claim`, `eq`, or `neq`.

Unit-bearing operands must use the same canonical unit after adapter/domain construction.
There is no implicit string-to-number, local-time, enum, or duration coercion.

### 6.2 Four-state combinators

`not_applicable` children are excluded from applicable-child precedence. If every child
is `not_applicable`, the composite is `not_applicable`.

| `all(children)` | Result |
|---|---|
| Any applicable child is `unsatisfied` | `unsatisfied` |
| Otherwise any applicable child is `indeterminate` | `indeterminate` |
| Otherwise at least one applicable child is `satisfied` | `satisfied` |
| All children are `not_applicable` | `not_applicable` |

| `any(children)` | Result |
|---|---|
| Any applicable child is `satisfied` | `satisfied` |
| Otherwise any applicable child is `indeterminate` | `indeterminate` |
| Otherwise at least one applicable child is `unsatisfied` | `unsatisfied` |
| All children are `not_applicable` | `not_applicable` |

| `not(child)` input | Result |
|---|---|
| `satisfied` | `unsatisfied` |
| `unsatisfied` | `satisfied` |
| `indeterminate` | `indeterminate` |
| `not_applicable` | `not_applicable` |

These precedence rules are normative, including mixed cases such as
`all(satisfied, not_applicable) = satisfied` and
`any(unsatisfied, not_applicable) = unsatisfied`.

### 6.3 Count semantics

Count excludes `not_applicable` members. Let:

- `S` = satisfied members;
- `I` = indeterminate members; and
- `A` = applicable members (`satisfied + unsatisfied + indeterminate`).

If `A = 0`, the count is `not_applicable`. Otherwise:

| Threshold | Satisfied when | Unsatisfied when | Indeterminate when |
|---|---|---|---|
| `at_least K` | `S >= K` | `S + I < K` | otherwise |
| `at_most K` | `S + I <= K` | `S > K` | otherwise |
| `exactly K` | `I = 0` and `S = K` | `S > K` or `S + I < K` | otherwise |

Therefore an unresolved member produces `indeterminate` only when resolving it could
change the threshold result. For example, `at_least 2` with three satisfied and two
indeterminate members is already satisfied; `at_least 4` remains indeterminate.

### 6.4 Progress

Progress is emitted only when it is unambiguous:

- a numeric/duration comparison against a positive `gte`/`gt` target may expose current,
  target, unit, and clamped ratio;
- a count exposes `S` against its threshold for `at_least`/`exactly`;
- a gate may explicitly select one expression node as its progress basis;
- `all` and `any` do not invent weighted progress across incompatible children; and
- `not`, `at_most`, and an arbitrary boolean composition omit progress unless policy
  names a valid projection with clear semantics.

An evaluation may be satisfied while displaying a clamped `1.0` ratio even if the raw
current value exceeds the target. Raw current may still be returned when its claim
visibility permits it.

### 6.5 Schedules, timezone, and validity

A `schedule` node is a calendar predicate. It receives `now` and an IANA household
timezone and returns `satisfied` while inside an authored window and `unsatisfied`
outside it. It also returns the next instant at which membership can change. Windows
support day-of-week plus local start/end time; overnight windows are normalized at graph
construction. DST gaps and folds follow the chosen timezone library's documented
earliest-valid-instant rule and are covered by tests.

Schedules never call a clock or read a config singleton. Composition supplies the
household timezone and invokes reevaluation at the earliest next boundary.

An evaluation's `validUntil` is the earliest known boundary among:

- an assertion expiry;
- a schedule boundary; and
- the end of the requested period.

An entitlement decision inherits the gate's validity. When the boundary passes,
the application reevaluates even if no new assertion arrived.

### 6.6 Entitlement decision table

| Gate state | Failure posture | Decision | Degraded |
|---|---|---|---|
| `satisfied` | either | `granted` | `false` |
| `unsatisfied` | either | `denied` | `false` |
| `indeterminate` | `fail_open` | `granted` | `true` |
| `indeterminate` | `fail_closed` | `denied` | `true` |
| `not_applicable` | either | `granted` | `false` |

Failure posture is mandatory on every entitlement even when current policy authors
expect evidence always to be available. `not_applicable` grants because the policy says
the gate does not govern that subject/period; it is not degraded evidence.

---

## 7. Household policy configuration

The household policy is the State Gates config. Under the repository's current
domain-first layout it lives at:

```text
data/household[-{hid}]/state-gates/config.yml
```

The grouped path does not recreate the retired flat `household/config/` directory.
`shared/contracts/householdConfig.mjs` registers
`'state-gates': 'state-gates/config'`; the
composition loader resolves it and injects a semantic policy loader/source.

### 7.1 Schema sketch

```yaml
schema: daylight.state-gates-policy/v1

publishers:
  school:
    description: School application published facts
  fitness:
    description: Fitness application published facts
  manual-attestation:
    description: Authenticated human attestations

subject_sets:
  learners:
    kind: learner
    members: [learner-a, learner-b, learner-c]

claim_types:
  school.day.complete:
    schema_version: 1
    value: { type: boolean }
    subject_kinds: [learner]
    period_kinds: [local_day]
    accepted_publishers: [school]
    visibility: subscriber
    validity:
      max_age: P2D
      must_fit_period: true

  fitness.exercise.minutes:
    schema_version: 1
    value: { type: number, min: 0, unit: minute }
    subject_kinds: [learner]
    period_kinds: [local_day]
    accepted_publishers: [fitness]
    visibility: subscriber
    validity:
      max_age: P2D
      must_fit_period: true

  chores.daily.attested:
    schema_version: 1
    value: { type: boolean }
    subject_kinds: [learner]
    period_kinds: [local_day]
    accepted_publishers: [manual-attestation]
    visibility: administrative
    validity:
      actor_required: true
      accepted_actor_roles: [parent]
      must_fit_period: true

gates:
  school.day-complete:
    schema_version: 1
    subject_kinds: [learner]
    period_kinds: [local_day]
    expression:
      claim:
        type: school.day.complete
        publisher: school
        subject: $subject
        period: $period

  fitness.saturday-exercise:
    schema_version: 1
    subject_kinds: [learner]
    period_kinds: [local_day]
    expression:
      all:
        - schedule:
            days: [sat]
            start: "00:00"
            end: "24:00"
        - comparison:
            claim:
              type: fitness.exercise.minutes
              publisher: fitness
              subject: $subject
              period: $period
            op: gte
            value: { amount: 30, unit: minute }
    progress:
      from: /all/1

  household.school-complete:
    schema_version: 1
    subject_kinds: [household]
    period_kinds: [local_day]
    expression:
      count:
        over: learners
        as: learner
        where:
          claim:
            type: school.day.complete
            publisher: school
            subject: $learner
            period: $period
        threshold: { at_least: 3 }

entitlements:
  piano.games:
    gate: school.day-complete
    failure_posture: fail_closed

  fitness.cartoons:
    gate: fitness.saturday-exercise
    failure_posture: fail_closed

  household.celebration:
    gate: household.school-complete
    failure_posture: fail_open
```

The YAML adapter validates syntax and translates snake_case, duration strings, local
times, and tagged values into domain types. YAML keys and string parsing never leak into
the domain or application.

### 7.2 Complete validation before activation

`ActivatePolicyGraph` rejects the entire candidate if any check fails:

1. document and nested schema versions are supported;
2. identifiers are namespaced, unique, and within size limits;
3. publisher declarations resolve to composition's authenticated publisher catalog;
4. accepted-publisher lists are non-empty and authorized for the claim type;
5. subject sets are non-empty, homogeneous, duplicate-free, and resolve against the
   household roster;
6. claim, gate, subject-set, and entitlement references exist;
7. subject and period bindings are compatible end to end;
8. claim values, comparison operators, units, thresholds, and progress projections are
   type-correct;
9. schedules and the household timezone are valid;
10. the gate-reference graph is acyclic;
11. every entitlement has exactly one gate and a declared `fail_open` or
    `fail_closed` posture; and
12. the complete graph can be constructed without an invariant violation.

Only after all checks pass is the graph committed as one new household revision. A
failure leaves the last valid active graph and all current projections untouched. It is
logged and returned to the administrative caller as a structured validation error; it
does not emit `PolicyGraphActivated`.

On a first boot with no valid graph to retain, State Gates reports
`POLICY_UNAVAILABLE`, publishes no fabricated entitlement decisions, and exposes the
validation diagnostics only to administration.

---

## 8. Application layer

### 8.1 Use cases

| Use case | Responsibility |
|---|---|
| `ObserveAssertion` | Validate the authenticated publisher context, enforce source idempotency/ordering, construct or correct the aggregate, recompute affected projections, and commit. |
| `RetractAssertion` | Authorize the same publisher or an administrative correction path, create a tombstone, recompute, and commit. |
| `ObserveManualAttestation` | Authorize an authenticated actor for the claim type, build the fixed `manual-attestation` publisher command, and delegate to assertion observation. |
| `ActivatePolicyGraph` | Load a candidate, validate the complete graph, dry-evaluate it against current assertions, and atomically replace the active graph. |
| `EvaluateGates` | Purely evaluate requested or affected gate instances using supplied time/timezone, then materialize observations and genuine transitions. |
| `DecideEntitlements` | Apply the normative decision table to evaluations. |
| `GetCurrentGates` | Return subscriber-safe current evaluations/definitions with filters and revision. |
| `GetCurrentEntitlements` | Return current binary decisions with filters and revision. |
| `GetGateDiagnostics` | Enforce administrative access and return raw assertions/provenance. |
| `ReplayGateTransitions` | Return ordered publication envelopes after a revision cursor. |
| `FlushPendingTransitions` | Retry the currently durable unpublished transition batch without policy activation or reevaluation. |
| `ReconcileStateGates` | On startup, repair an interrupted commit/publication, reevaluate time validity, and resume delivery. |

`EvaluateGates` and `DecideEntitlements` can be internal collaborators as long as
they remain independently testable. Query use cases return plain application DTOs so the
API does not import domain classes.

### 8.2 Ports

All ports are abstract classes in `3_applications/state-gates/ports/`.

```text
IStateGatesPolicySource
  loadCandidate(householdId) -> CandidatePolicyGraph

IStateGatesProjectionRepository
  load(householdId) -> GatesProjectionSnapshot?
  commitRevision(householdId, expectedRevision, nextSnapshot, transitionBatch)
    -> committed | revision_conflict

IStateGatesTransitionRepository
  replayAfter(householdId, revision, limit) -> ReplayPage
  oldestAvailableRevision(householdId) -> revision
  markPublished(householdId, transitionIds) -> void
  compactThrough(householdId, revision) -> void

IStateGatesEventPublisher
  publish(publicationEnvelopes) -> void

IStateGatesAdministrationAuthorizer
  authorize(actor, action, resource) -> allowed | denied
```

`commitRevision` includes the transition batch so a concrete transactional store can
atomically persist current projection plus journal/outbox state. The transition port
owns replay, delivery checkpoints, and bounded compaction. A FileIO implementation may
back both port objects with one injected atomic state engine; the application still sees
two semantic interfaces, and each concrete port adapter extends its declared port.

Clock and timezone are not domain ports. Composition injects a `now()` semantic function
and a resolved IANA timezone, or invokes a use case with explicit values. The function's
result is captured once per command and passed through every domain operation.

### 8.3 `StateGatesContainer`

The container receives:

- the five ports above;
- a roster-snapshot loader and authenticated publisher-authority catalog supplied as
  semantic values/functions;
- `now` and household timezone values/functions;
- a domain evaluator set or constructors;
- an ID/digest generator supplied as a semantic function; and
- a structured child logger for application-level failures.

It constructs and exposes use cases. It imports domain code and application ports only.
It does not import or instantiate YAML, FileIO, the event bus, authentication adapters,
routers, ConfigService, or producer applications.

### 8.4 Source ordering and idempotency

For `(publisherId, assertionId)`:

- a higher `sourceRevision` is eligible;
- the same source revision with byte/domain-equivalent content is an idempotent no-op;
- the same source revision with different content is `SOURCE_REVISION_CONFLICT`;
- a lower source revision is `STALE_SOURCE_REVISION`; and
- an idempotent or stale retry does not allocate a household revision or publish an
  observation.

Every accepted state-changing command allocates `currentHouseholdRevision + 1` inside a
compare-and-swap commit. Concurrent conflicts reload and retry evaluation from the new
snapshot; they do not reuse stale projections.

Transition IDs are deterministic from household, household revision, event kind, and
instance key. Journal appends and `markPublished` are idempotent by transition ID.
Publication is at least once; subscribers deduplicate by transition ID.

### 8.5 Commit and recovery sequence

For an assertion, validity boundary, or policy activation:

1. Load the active projection and expected household revision.
2. Construct/validate domain changes in memory with one captured `now`.
3. Evaluate only the dependency-graph closure affected by the change; full evaluation is
   allowed as a correctness-first initial implementation.
4. Create observations and genuine transitions with the next household revision.
5. Atomically commit the next current projection and transition/outbox batch through the
   projection repository.
6. Publish committed envelopes through `IStateGatesEventPublisher`.
7. Mark transition IDs published.

If the process stops after step 5, `ReconcileStateGates` republishes the unmarked
envelopes. If it stops after publication but before step 7, at-least-once redelivery is
safe because transition IDs are stable. No event is published before its authoritative
state is durable.

While the process remains live, composition retries pending batches independently per
household with exponential backoff. Boundary evaluation/refresh failures use a separate
backoff timer, so transport failure cannot stall validity reevaluation or vice versa.

Policy activation uses this same sequence. The active graph, its digest, and the
projections derived from it become visible at one household revision.

---

## 9. Adapter contracts

### YAML policy source

`YamlStateGatesPolicySource extends IStateGatesPolicySource`:

- receives a semantic loader or resolved file capability from composition;
- maps YAML field names and textual values into domain/application candidates;
- decodes the versioned YAML shape into a frozen candidate; and
- performs no gate evaluation or fallback selection.

The application, not the adapter, decides whether the candidate is valid for activation
and retains the last valid graph.

### FileIO-backed persistence

`YamlStateGatesProjectionRepository` and
`YamlStateGatesTransitionRepository` extend their application ports and use injected
FileIO capabilities. No raw `fs` or `path` import is allowed.

The domain-first household layout is:

```text
data/household[-{hid}]/state-gates/
  config.yml                     # authored candidate policy
  current.yml                    # one atomic state + bounded journal/outbox envelope
```

Exact file splitting is an adapter decision, but the stored semantics are fixed:

- active policy graph/digest/revision;
- active and retracted assertion records with source revision/provenance;
- current gate evaluations;
- current entitlement decisions;
- household revision and delivery checkpoint; and
- ordered, bounded transition/publication records.

The first FileIO implementation uses one `current.yml` envelope so graph activation,
projection replacement, and insertion of the corresponding transition/outbox batch are
one atomic save. The two repository adapters receive the same internal state engine from
composition and expose different application ports over that envelope. A future
transactional database may split the physical records without changing either port.

Domain objects contain no `toJSON`, `fromJSON`, YAML field names, file extensions, or
storage paths.

Journal compaction may remove entries only at or below a durable projection checkpoint.
The configured retention is expressed as a maximum age and/or entry count. If a replay
cursor predates the oldest retained revision, the repository returns `CURSOR_EXPIRED`
with `oldestAvailableRevision` and `currentRevision`; it never silently returns a partial
history.

Retraction tombstones remain in current assertion provenance even when their transition
record ages out. Correction metadata retains the superseded source revision. This keeps
current provenance honest while allowing a bounded delivery journal.

### Event-bus publication

`StateGatesEventBusPublisher extends IStateGatesEventPublisher` wraps the generic
system event bus. It owns wire topic names, schema versioning, serialization, and generic
transport error translation.

It accepts only application-created publication envelopes. It cannot subscribe to an
arbitrary topic and turn messages into assertions. State Gates ingress is a command
boundary, never a generic bus listener.

### Authenticated ingress

`AuthenticatedStateGatesIngress` is an inbound adapter. It authenticates a service,
device, or client principal using the existing auth boundary, resolves it to a configured
publisher ID, and only then calls `ObserveAssertion`/`RetractAssertion` with an immutable
publisher context.

In-process producer bindings receive a fixed publisher identity from composition. HTTP
or device producers derive identity from verified request/device context. A body field
such as `publisher: school`, `actor: parent`, or `roles: [sysadmin]` is ignored or
rejected; it cannot create authority.

---

## 10. API surface and access

One injected `createStateGatesRouter(deps)` may mount smaller resource handlers. The
important boundary is factory injection, not the number of router files.

### Subscriber resources

| Method | Resource | Use case |
|---|---|---|
| `GET` | `/api/v1/state-gates` | Current declared gates/evaluations filtered by subject/period. |
| `GET` | `/api/v1/state-gates/:gateId` | One current evaluation and safe definition. |
| `GET` | `/api/v1/entitlements` | Current binary decisions filtered by subject/period/capability. |
| `GET` | `/api/v1/entitlements/:capabilityId` | One current decision. |
| `GET` | `/api/v1/state-gates/transitions?afterRevision=...` | Ordered replay page plus next cursor/current revision. |

### Attestation and administration

| Method | Resource | Use case |
|---|---|---|
| `POST` | `/api/v1/state-gates/attestations` | `ObserveManualAttestation`; actor comes from request context. |
| `DELETE` | `/api/v1/state-gates/attestations/:assertionId` | Authorized retraction; source revision is required. |
| `POST` | `/api/v1/admin/state-gates/policy/activate` | Validate and atomically activate the current candidate source. |
| `GET` | `/api/v1/admin/state-gates/assertions` | Raw claim/provenance diagnostics. |
| `GET` | `/api/v1/admin/state-gates/policy` | Active digest/revision and last candidate validation result. |

These route names and access boundaries are the implemented contract.

### Manual-attestation request

```json
{
  "assertionId": "chores:learner-a:2026-08-30",
  "claimTypeId": "chores.daily.attested",
  "subject": { "kind": "learner", "id": "learner-a" },
  "period": { "kind": "local_day", "id": "2026-08-30" },
  "value": true,
  "sourceRevision": 1,
  "observedAt": "2026-08-30T18:00:00-07:00",
  "evidenceRef": "chores/checklist/2026-08-30/learner-a"
}
```

There is deliberately no actor or role field. The handler obtains the authenticated
actor from request context and passes a plain actor DTO to the injected use case. The
application authorization port and claim-type actor rule determine whether the
attestation is allowed.

### Access tiers

| Data/action | Registered subscriber | Administrative diagnostics |
|---|---:|---:|
| Declared safe gate definitions | Read | Read |
| Gate evaluations and progress | Read | Read |
| Entitlement decisions | Read | Read |
| Sanitized observations/transitions | Read/replay | Read/replay |
| Manual attestation | Only with explicit attestation permission | Yes |
| Raw assertions and administrative claim values | No | Read |
| Actor, evidence reference, detailed provenance | No | Read |
| Policy activation/validation details | No | Yes |

Authentication middleware establishes identity; the application authorizer establishes
semantic permission. HTTP handlers do not infer parent/admin status from payloads.

Expected errors include `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN`
(403), `NOT_FOUND` (404), source/revision conflict (409), expired replay cursor (410),
and `POLICY_UNAVAILABLE` (503). Handlers map application error codes to HTTP without
importing domain error classes or hand-writing business fallback behavior.

---

## 11. Composition and lifecycle

`5_composition/modules/stateGates.mjs` owns construction:

1. Resolve the household config loader, roster snapshot/loader, publisher-principal
   catalog, timezone, auth verifier, FileIO capabilities, generic event bus, logger, and
   `now` function.
2. Construct YAML policy, projection, transition, event-publisher, and authorization
   adapters.
3. Construct `StateGatesContainer` with only semantic dependencies.
4. Construct authenticated ingress with fixed or verified publisher resolution.
5. Bind producer-owned translators to ingress without adding transformation logic.
6. Inject query/attestation/admin use cases into API router factories.
7. Reconcile durable state before exposing current-state endpoints or publishing live
   transitions.
8. Schedule the next supplied validity boundary and reschedule after every commit.

The lifecycle order is:

```text
load last durable projection
  -> repair journal/outbox and replay interrupted delivery
  -> load and validate candidate policy
  -> retain old graph on candidate failure OR atomically activate valid candidate
  -> reevaluate expired/time-sensitive instances with supplied now/timezone
  -> expose API and producer ingress
  -> publish live observations/transitions
```

Composition passes resolved values or semantic loader functions. `ConfigService` never
enters `3_applications/state-gates`, and no policy fallback, claim mapping, or event
serialization is embedded in bootstrap.

---

## 12. Current state, transition delivery, and replay

Domain records in the projection are authoritative. The generic event bus is ephemeral
delivery and never the source of truth.

Each publication envelope contains:

```text
schema: daylight.state-gates-event/v1
transitionId
householdRevision
occurredAt
kind
payload                # sanitized observation or past-tense transition
```

Properties:

- household revisions are strictly monotonic per household;
- every envelope in one commit shares the household revision and has deterministic
  ordinal ordering;
- reconnecting subscribers first replay `afterRevision`, then switch to live delivery;
- a subscriber records both revision and transition ID so at-least-once overlap is safe;
- current-state responses include `currentRevision` for race-free handoff;
- transition replay never exposes administrative claim/provenance fields; and
- `StateRetired` deletes an obsolete instance from a subscriber projection; and
- cursor expiry requires a new current-state snapshot followed by replay from that
  snapshot's revision.

A safe subscriber algorithm is:

1. Fetch current state and record `currentRevision = R`.
2. Subscribe to live events, buffering them temporarily.
3. Replay transitions after `R`.
4. Apply replay plus buffered live envelopes in `(revision, ordinal)` order, deduplicated
   by transition ID and deleting keys named by `StateRetired`.
5. On `CURSOR_EXPIRED`, discard the local projection and repeat from step 1.

---

## 13. Worked examples

These examples show boundary ownership. They are not migrations authorized by this
foundation phase.

### 13.1 School completion unlocks Piano games

School's application observes its existing private completion state machine. When School
decides the learner's local day is complete, its producer-owned translator publishes:

```text
claimTypeId: school.day.complete
publisherId: school                 # fixed by authenticated composition binding
subject: learner-a
period: local_day/2026-08-30
value: true
sourceRevision: 7
```

Gate `school.day-complete` selects the `school` publisher explicitly.
Entitlement `piano.games` is `fail_closed`. Piano asks for the binary decision and owns
the local choice to disable its Games button, replace the content, or show progress. A
later School correction to false is a higher assertion source revision and produces a
real gate/decision transition; it does not edit the Piano state directly.

### 13.2 Exercise plus Saturday schedule unlocks Fitness cartoons

Fitness publishes its own aggregate `fitness.exercise.minutes` for the learner/day. The
gate combines:

- a schedule predicate satisfied only on Saturday in the supplied household timezone;
  and
- `fitness.exercise.minutes >= 30` from publisher `fitness`.

At 29 minutes the evaluation is unsatisfied with progress `29/30 minute`. At 30 it is
satisfied. Before or after Saturday the schedule predicate is unsatisfied and exposes
the next boundary. If evidence expires while inside Saturday, the gate becomes
indeterminate and the `fail_closed` entitlement is denied with `degraded: true`.

The consumer—not State Gates—chooses which cartoon rail, pause behavior, or explanatory
screen to show.

### 13.3 Role-aware chore attestation

A parent submits a manual attestation. The API ignores any actor/role in the body and
uses the authenticated request actor. `ObserveManualAttestation` asks
`IStateGatesAdministrationAuthorizer` for the attestation permission, then the domain
checks the claim type's `actorRequired` and `acceptedActorRoles: [parent]` invariant.

The resulting assertion carries an opaque evidence reference and authenticated actor
provenance. Subscribers see only `chores complete` state and safe reason codes;
administrative diagnostics can inspect who attested and what was corrected/retracted.

### 13.4 Household aggregation over a named learner set

Policy defines `subject_sets.learners` and activation validates every member against the
household roster. `household.school-complete` counts the explicitly School-published
completion assertion for each bound learner.

For `at_least 3`, three satisfied learners plus one missing assertion is already
satisfied. Two satisfied, one unsatisfied, and one missing is indeterminate because the
missing learner could reach the threshold. One satisfied, two unsatisfied, and one
missing is unsatisfied because the unresolved learner cannot reach three.

The household evaluation exposes count progress without inventing or copying a household
School record.

### 13.5 Screen and Fitness subscriber bindings

Composition injects State Gates query/replay dependencies into a screen-framework
subscriber and a Fitness subscriber. Each binds one declared capability ID to local
presentation:

```text
piano.games denied          -> Piano locally disables/replaces Games
fitness.cartoons denied     -> Fitness locally selects its denied-state presentation
```

State Gates publishes no `hide`, `disable`, `pause`, route, component, content ID, or
ceremony instruction. Consumers can change presentation independently without changing
the policy model. They ignore `initial: true` observations for satisfaction ceremonies
and may celebrate only a genuine transition to satisfied/granted.

---

## 14. Failure and security posture

| Failure | Required behavior |
|---|---|
| Candidate YAML cannot be decoded | Keep last valid graph; return/log diagnostics; no state transition. |
| Graph validation fails | Keep last valid graph and projections atomically. |
| No prior valid graph exists | Report `POLICY_UNAVAILABLE`; fabricate no decision. |
| Assertion is missing/retracted/stale | Evaluate `indeterminate`, then apply the entitlement's declared posture. |
| Publisher is unauthenticated or unauthorized | Reject before domain observation; allocate no revision. |
| Source revision is repeated | Equivalent retry is no-op; conflicting retry is 409. |
| Projection revision races | Reload and retry from current state; never overwrite. |
| Process stops after durable commit | Reconciliation resumes idempotent journal publication. |
| Event-bus subscriber disconnects | Query current state and replay after cursor. |
| Replay cursor is pruned | Return explicit cursor expiry and require snapshot resync. |
| Timezone/DST boundary arrives | Reevaluate with supplied instant/timezone and publish only genuine changes. |

Administrative logs may include stable IDs, revisions, error codes, and adapter-specific
diagnostics. They must not log credentials or unnecessarily copy raw administrative
claims/evidence. Domain code logs nothing. Event-bus output is always subscriber-safe.

---

## 15. Verification strategy

### Domain tests

- immutable construction and invariant failures for every reference/definition;
- assertion observation, correction, retraction, tombstones, and monotonic source
  revisions;
- explicit publisher isolation for the same claim/subject/period;
- complete `all`, `any`, and `not` four-state truth tables;
- `at_least`, `at_most`, and `exactly` count bounds, including irrelevant unknowns;
- typed comparisons, units, and invalid coercions;
- progress projection and clamping;
- schedule boundaries, overnight windows, DST gap/fold behavior, and injected time;
- gate reference resolution and cycle rejection;
- entitlement fail-open/fail-closed/not-applicable table; and
- initial observation versus genuine transition generation.

### Application tests with fake ports

- observe/correct/retract use cases and affected-graph reevaluation;
- whole-graph validation and atomic replacement;
- invalid candidate retains the last valid graph;
- source isolation, source-revision idempotency, and conflicting retries;
- monotonic household revisions and compare-and-swap retry;
- fail-open and fail-closed decisions;
- scheduled validity expiry without a new assertion;
- commit-before-publish ordering and unpublished-outbox recovery;
- restart reconciliation from current projection/journal;
- ordered replay, duplicate transition IDs, pagination, and cursor expiry;
- subscriber-safe versus administrative query projection; and
- authenticated manual-attestation authorization.

### Adapter tests

- YAML-to-domain mapping for every expression/value kind;
- source-located schema errors and no policy decisions in the decoder;
- FileIO atomic current-state persistence, hydration, tombstones, and journal compaction;
- interrupted-write/restart fixtures;
- event-bus topic/schema serialization and generic error translation;
- authenticated publisher mapping and rejection of body-claimed identities; and
- D7 inheritance: every flagship State Gates adapter extends its live application port.

### API tests

- injected fake container/use cases with no layer imports;
- request/response mapping and documented error statuses;
- subject/period/revision filter validation as HTTP syntax only;
- authenticated actor derived from request context;
- body-supplied actor/role cannot escalate an attestation;
- registered-subscriber and administrative read tiers;
- raw provenance never appears in subscriber resources; and
- errors propagate through shared middleware rather than being swallowed.

### Composition and architecture tests

- repository, event publisher, authorization, container, producer bridge, and router
  dependency wiring;
- startup reconciliation occurs before live ingress/publication;
- supplied clock/timezone reach domain evaluation unchanged;
- no transformation or policy logic in `5_composition`;
- `node scripts/audit-layer-imports.mjs --domain-hierarchy-report` includes the new Level
  1 domain and remains clean;
- FileIO/raw-filesystem audit remains at zero; and
- API/application/domain/adapter import gates remain at zero hard findings.

### Scenario tests

- School completion to Piano games grant and correction back to denial;
- Saturday exercise threshold to Fitness cartoons, including stale evidence;
- authorized and unauthorized manual chore attestations;
- named learner-set aggregation with satisfied/unsatisfied/indeterminate members;
- household timezone midnight and DST boundaries;
- policy activation failure retaining prior decisions;
- disconnected subscriber current-state plus replay recovery; and
- initial materialization does not fire a satisfaction ceremony event.

No live household controller, physical device, or second backend instance is required for
foundation verification. Scenario tests use isolated adapters/fakes until a later
integration phase explicitly migrates a producer or consumer.

---

## 16. Producer and consumer migration boundaries

The domain, application, adapter, API, composition, persistence, recovery, and access
foundations are implemented together. Producer and consumer migrations remain separate,
opt-in changes.

Producer/consumer migrations are separate decisions. Each must identify:

- the producer's private authoritative state and producer-owned translation policy;
- stable claim type, publisher, subject, period, value, and source revision semantics;
- the consumer capability ID and failure posture;
- its current-state bootstrap plus replay binding; and
- which presentation behavior remains local.

The foundation must not preempt those decisions by embedding current School, Piano,
Fitness, chore, or screen-framework behavior into the State Gates bounded context.

---

## 17. Assumptions resolved by this design

- “Public” means authorized system-wide published language, not anonymous or
  internet-public data.
- Existing producer state machines remain private and authoritative.
- The event bus is transport, not persistence, replay storage, or truth ingress.
- Household revisions order State Gates commits; publisher source revisions order one
  assertion identity. They are deliberately different counters.
- Missing/stale/retracted evidence is indeterminate, not false.
- Entitlements are binary; tiers use separate capability IDs and progress stays on the
  gate.
- Failure posture is authored per entitlement and required at activation.
- Policy replacement is whole-graph and atomic; failed candidates never partially land.
- Initial materialization is observation, not a transition ceremony.
- Raw claims, actor provenance, and evidence are administrative diagnostics only.
- Time and timezone are supplied values at every domain evaluation boundary.
- No foundation change is needed in `0_system`, `1_rendering`, or any frontend.
