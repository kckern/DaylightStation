# State Gates

State Gates is the shared bounded context for answering this question:

> Given the household's current evidence and policy, is this named capability
> available for this subject and period?

It receives authenticated, typed assertions from authoritative producer contexts,
evaluates named gates, and publishes both four-state gate evaluations and binary
entitlement decisions. It does not execute the gated action or decide how a denied
capability looks in a UI.

**Implementation status:** the backend foundation is complete. No School, Piano,
Fitness, chore, or screen producer/consumer migration is included yet. With no valid
household policy, the rest of DaylightStation starts normally and State Gates reports
`POLICY_UNAVAILABLE`.

## Reference map

| Read this | For |
|---|---|
| [Policy authoring](policy-authoring.md) | YAML schema, claims, expressions, four-state semantics, progress, schedules, validation, and activation. |
| [API and events](api-and-events.md) | HTTP resources, authorization, response contracts, replay, event envelopes, and errors. |
| [Integration and operations](integration-and-operations.md) | Producer/consumer migrations, identity, revisions, persistence, startup recovery, timers, and diagnostics. |
| [Architecture](architecture.md) | Complete bounded-context design, layer ownership, invariants, failure posture, and verification strategy. |

## The model

```text
producer-owned state
      |
      | authenticated assertion
      v
claim type + assertion provenance
      |
      | gate policy expression
      v
gate evaluation
  satisfied | unsatisfied | indeterminate | not_applicable
      |
      | entitlement failure posture
      v
capability decision
  granted | denied     (+ degraded when evidence is indeterminate)
      |
      v
consumer-owned presentation or behavior
```

The separation is deliberate:

- An **assertion** is evidence, not a decision.
- A **gate** interprets qualified evidence for a subject and period.
- An **entitlement** turns one gate state into a binary capability decision.
- A **consumer** owns the local behavior: hide, disable, replace, pause, explain,
  celebrate, or do nothing.

The event bus is delivery only. An arbitrary event cannot establish truth; only an
authenticated assertion command accepted by the State Gates application can change
the projection.

## Ubiquitous language

| Term | Meaning |
|---|---|
| Publisher | An authenticated application, service, or device allowed to assert claim types. |
| Claim type | A versioned definition of a fact's value type, subject/period contract, accepted publishers, visibility, and validity. |
| Assertion | One publisher's versioned observation of one claim for one subject and period. |
| Gate | A named policy expression over qualified assertions and other gates. |
| Gate evaluation | Current four-state result, progress, safe reasons, validity, and revisions for one gate instance. |
| Entitlement | A named binary capability based on one gate and an explicit failure posture. |
| Entitlement decision | `granted` or `denied`, with its basis state and degradation flag. |
| Observation | A complete statement of current gate or entitlement state at a household revision. |
| Transition | A past-tense event emitted only after an already-materialized state genuinely changes. |
| Retirement | A subscriber-safe instruction to remove a gate or entitlement instance eliminated by policy activation. |
| Source revision | Publisher-monotonic revision of one assertion identity. |
| Household revision | Monotonic revision of accepted State Gates commits within one household. |

## What State Gates owns

State Gates owns:

- typed claim definitions and assertion invariants;
- assertion observation, correction, retraction, and provenance;
- atomic policy-graph validation and activation;
- deterministic four-state evaluation;
- explicit progress projections and validity boundaries;
- binary entitlement decisions with `fail_open` or `fail_closed` posture;
- durable current projection and bounded transition journal;
- current-state queries, replay, and administrative diagnostics; and
- startup reconciliation, live delivery recovery, and time-bound reevaluation.

It does not own:

- School, Fitness, chores, Piano, or screen-framework state machines;
- producer-specific translation from private state into published assertions;
- consumer presentation or action execution;
- arbitrary scripting, workflows, or a general scheduler;
- authentication credentials or network transport; or
- an internet-public API.

## Current technical contract

| Concern | Contract |
|---|---|
| Bounded-context namespace | `state-gates` |
| Policy file | `data/household[-{hid}]/state-gates/config.yml` |
| Durable state | `data/household[-{hid}]/state-gates/current.yml` |
| Policy schema | `daylight.state-gates-policy/v1` |
| State schema | `daylight.state-gates-state/v1` |
| Query schema | `daylight.state-gates-query/v1` |
| Replay schema | `daylight.state-gates-replay/v1` |
| Event schema | `daylight.state-gates-event/v1` |
| Event-bus topic | `state-gates` |
| Subscriber API | `/api/v1/state-gates`, `/api/v1/entitlements` |
| Administrative API | `/api/v1/admin/state-gates` |

Policy uses `gates:` for gate definitions and `gate:` inside each entitlement. Public
DTOs use `gateId`. There are no compatibility aliases for the short-lived
`requirements` foundation name because no household policy or consumer migration
shipped under that name.

## Code map

| Layer | Location | Responsibility |
|---|---|---|
| Domain | `backend/src/2_domains/state-gates/` | Immutable model, policy invariants, evaluation, and decisions. |
| Application | `backend/src/3_applications/state-gates/` | Use cases, ports, revisions, commits, queries, replay, and reconciliation. |
| Adapters | `backend/src/1_adapters/state-gates/` | YAML translation, FileIO persistence, event publication, identity, and authorization. |
| API | `backend/src/4_api/v1/routers/state-gates.mjs` | Subscriber, replay, and attestation HTTP translation. |
| Admin API | `backend/src/4_api/v1/routers/admin/state-gates.mjs` | Policy activation and diagnostics. |
| Composition | `backend/src/5_composition/modules/stateGates.mjs` | Wiring, startup reconciliation, boundary timers, and delivery retries. |
| Shared config registry | `shared/contracts/householdConfig.mjs` | Maps `state-gates` to `state-gates/config`. |

State Gates is a Level 1 shared domain. Feature domains may depend on its published
language through application ports; State Gates must not import their private models.

## Non-negotiable semantics

- Missing, stale, retracted, not-yet-valid, or type-conflicting evidence is
  `indeterminate`, not `unsatisfied`.
- A producer identity comes from a trusted composition/authentication binding, never
  from `publisher`, `actor`, or `roles` fields supplied in a request body.
- Assertion identity is `(publisherId, assertionId)`. Source revisions for that
  identity increase monotonically.
- Every claim selector names both a claim type and a publisher. There is no implicit
  “latest source wins.”
- Policy activation is whole-graph and atomic. An invalid candidate cannot partially
  replace the active graph.
- The first materialization emits an observation, not a change ceremony.
- Policy removal emits a retirement record so replay consumers can delete stale state.
- Event publication occurs after the projection and its outbox batch are durably
  committed.
- Current state is authoritative; the event bus is not persistence or truth ingress.
- Every entitlement declares a failure posture. No consumer invents one locally.
- Domain evaluation receives `now` and household timezone explicitly.

## Current access model

Route permission maps place State Gates and entitlement resources behind the
`state-gates` application permission. Default `admin`, `parent`, `member`, and `kiosk`
roles receive that application; `sysadmin` already has `*`.

Semantic authorization is narrower:

- `sysadmin`, `admin`, and `parent` may create or retract manual attestations.
- `sysadmin` and `admin` may activate policy or read raw diagnostics.
- subscriber resources expose safe definitions, evaluations, decisions, and replay
  envelopes—not raw actor/evidence provenance.

See [API and events](api-and-events.md) for exact resources and error behavior.

## Foundation boundary

The root composition currently registers `manual-attestation` as the only authenticated
publisher. `producerPrincipals` is empty unless a producer migration explicitly adds a
fixed principal binding. Merely declaring `school` or `fitness` under `publishers:` in
YAML cannot authorize it; activation rejects publishers absent from the authenticated
catalog.

Likewise, no existing gate has been replaced. Piano games, Fitness governance, School
completion, companion media, and screen behavior continue to use their existing
mechanisms until each migration defines its source assertion, revision semantics,
capability ID, failure posture, bootstrap/replay behavior, and local presentation.
