# State Gates Integration and Operations

This reference covers the seams around State Gates: authenticated producers, state
consumers, durable commits, startup recovery, time boundaries, logging, and migration
rules.

## Current foundation status

No existing feature is migrated. Root composition constructs the State Gates module,
mounts its APIs, registers `manual-attestation`, and supplies no `producerPrincipals`.
Consequences:

- a policy containing only `manual-attestation` claims can activate now;
- a policy declaring `school`, `fitness`, or another producer is rejected until an
  explicit authenticated binding is added;
- no current Piano, School, Fitness, companion-media, chore, or screen gate changes
  behavior; and
- no frontend or rendering component consumes gate state yet.

This is intentional. A producer/consumer migration is a separate domain decision, not
a configuration-only switch.

## Composition

`createStateGatesModule` constructs:

- `YamlStateGatesPolicySource`;
- shared `YamlStateGatesStateEngine`;
- projection and transition repository views over that engine;
- `StateGatesEventBusPublisher`;
- role-based administration authorizer;
- household subject catalog;
- `StateGatesContainer` and engine;
- authenticated producer ingress;
- subscriber, entitlement, and admin routers; and
- one validity-boundary timer per configured household.

The application receives semantic functions and ports. `ConfigService`, FileIO, the
generic event bus, Express, and timers do not cross into the domain.

## Producer integration

A producer remains authoritative for its private state. Its application layer decides
how that state becomes a stable State Gates assertion; State Gates never reads the
producer repository and guesses.

### Required producer contract

Every migration must define:

| Field | Decision required |
|---|---|
| Publisher ID | Stable namespaced authority such as `school` or `fitness`. |
| Principal binding | Fixed authenticated service/device principal configured in composition. |
| Claim type ID | Stable fact name such as `school.day.complete`. |
| Subject | Exact subject kind and stable ID. |
| Period | Exact period kind, ID, and boundary semantics. |
| Value | Typed value and canonical unit. |
| Assertion ID | Stable across retries, corrections, and retractions of one fact slot. |
| Source revision | Monotonic producer-owned counter for that assertion identity. |
| Validity | Observation time, valid range, max age, and future-skew posture. |
| Correction/retraction | When and how the producer replaces or withdraws prior evidence. |

### Authenticated ingress

`AuthenticatedStateGatesIngress` accepts a trusted principal and resolves it through the
composition-owned `producerPrincipals` map. It then injects the fixed publisher ID into
`observeAssertion` or `retractAssertion`.

```text
producer private state
  -> producer-owned translator
  -> fixed authenticated principal
  -> AuthenticatedStateGatesIngress
  -> publisherId injected by trusted binding
  -> State Gates command
```

A command body cannot choose its publisher. A YAML `publishers:` entry cannot authorize
itself. The event bus is not accepted as assertion ingress.

### Source revision rules

Source revision and household revision solve different ordering problems:

- `sourceRevision` orders one publisher's versions of `(publisherId, assertionId)`;
- `householdRevision` orders accepted State Gates commits for one household.

Producers retry the same content at the same source revision safely. They must allocate
a higher source revision for corrections or retractions. A different value at the same
revision is a conflict, not last-write-wins.

## Consumer integration

A consumer declares one or more capability IDs and owns their presentation or action.
The State Gates decision contains no route, component, content ID, hide/disable action,
pause command, or ceremony instruction.

Every migration must define:

- capability ID;
- gate ID;
- `fail_open` or `fail_closed` behavior for indeterminate evidence;
- current-state bootstrap query and filters;
- replay/live subscription handoff;
- transition-ID deduplication;
- cursor-expiry resynchronization; and
- local presentation for granted, denied, and degraded decisions.

Consumers should use entitlement decisions for binary gating and gate evaluations for
explanations/progress. They should not reconstruct policy from raw assertions.

### Initial state versus transitions

The first projection for an instance is `StateObservation { initial: true }`. It is not
a child accomplishment and must not trigger a celebration. A consumer may celebrate a
genuine later `GateStateChanged` to `satisfied` or `EntitlementDecisionChanged` to
`granted`, subject to its own presentation rules.

### Bootstrap and replay

Use the snapshot/subscription/replay algorithm in [API and events](api-and-events.md).
Never treat the event bus as a complete history. Replay retention is bounded and a
consumer must handle `CURSOR_EXPIRED` by taking a new snapshot.

## Persistence

State is stored at:

```text
data/household[-{hid}]/state-gates/current.yml
```

The envelope schema is `daylight.state-gates-state/v1` and contains:

- current projection;
- active policy candidate and validation context;
- active and retracted assertions;
- gate evaluations;
- entitlement decisions;
- household revision;
- bounded journal of publication envelopes;
- compaction checkpoint; and
- delivery checkpoint.

The projection and journal are written atomically through FileIO. Repository adapters
share one internal engine so projection replacement and outbox insertion cannot split
across files.

### Commit sequence

1. Load current projection.
2. Build the active graph.
3. Validate/apply the command.
4. Derive gate evaluations, entitlement decisions, and publication envelopes.
5. Compare-and-swap the expected household revision.
6. Atomically save projection plus unpublished envelopes.
7. Publish envelopes to the event bus.
8. Mark them published and advance delivery checkpoint.

Revision races reload and retry up to three times, then return `REVISION_CONFLICT`.
Publication failure does not roll back the committed state; the command response sets
`deliveryPending: true`. Composition retries the durable outbox while the process stays
up and startup reconciliation provides an additional recovery pass after restart.

Delivery and boundary failures use independent per-household exponential backoff:
1 second initially, doubled after each failure, capped at 60 seconds. Each delay receives
deterministic per-household/channel jitter of up to ±20%, so simultaneous failures do
not create a retry herd and a restart computes the same schedule. The composition module
accepts `retryPolicy` overrides (`initialDelayMs`, `multiplier`, `maxDelayMs`, and
`jitterRatio`). `jitterRatio: 0` provides exact timing for deterministic tests; accepted
ratios are from 0 through 1.

### Journal retention

Default retention is:

- maximum 5,000 entries; and
- maximum age 30 days.

Compaction removes only complete published revision batches, oldest first. It never
removes an unpublished batch. Retraction tombstones stay in current assertion
provenance even after their transition envelopes age out.

## Startup lifecycle

For every configured household, composition performs:

```text
load durable state
  -> publish pending outbox envelopes
  -> reload and validate candidate policy
  -> activate valid candidate OR retain prior active graph
  -> reevaluate expired time-sensitive instances
  -> arm earliest next boundary
```

If no valid active graph exists and the candidate is missing/invalid, the module logs
`state-gates.startup.unavailable`. The exception is contained so unrelated household
capabilities still start. State Gates query routes then return `POLICY_UNAVAILABLE`.

If an active graph exists and a new candidate is invalid, startup retains the active
graph and records candidate diagnostics.

## Boundary timers

Every evaluation exposes its earliest known next boundary from evidence expiration,
schedule transition, or period end. Composition arms one timer per household for the
earliest boundary.

- Timers are unreferenced so they do not keep Node alive.
- Delays are capped below the platform's maximum timer value and rearmed when needed.
- Every accepted mutation refreshes the household timer.
- A timer reevaluates with cause `validity_boundary`, reloads state, and arms the next
  boundary.
- Timer-refresh failure is logged after the durable command succeeds and does not make
  the caller retry a committed mutation.
- A failed boundary evaluation is rearmed with backoff; success resets backoff and arms
  the next real validity boundary.

## Failure behavior

| Failure | Behavior |
|---|---|
| Missing candidate, no active graph | `POLICY_UNAVAILABLE`; fabricate no decision. |
| Invalid candidate, active graph exists | Retain active graph and decisions; expose admin diagnostics. |
| Missing/stale/retracted evidence | Gate becomes `indeterminate`; entitlement applies authored posture. |
| Unauthenticated producer | Reject before allocating a household revision. |
| Equivalent source retry | Idempotent no-op. |
| Conflicting/stale source revision | HTTP/application conflict; no revision allocated. |
| Projection revision race | Reload/retry, then `REVISION_CONFLICT`. |
| Event publication failure | Durable state remains; pending outbox retries live with backoff and at startup reconciliation. |
| Replay cursor pruned | `CURSOR_EXPIRED`; consumer takes a new snapshot. |
| Boundary timer fires | Reevaluate and publish only meaningful observations/transitions. |

## Logging

State Gates uses the structured logging framework under module `state-gates`.

Key events:

| Event | Meaning |
|---|---|
| `state-gates.startup.unavailable` | No usable policy during startup; other modules continue. |
| `state-gates.policy.candidate_rejected` | Candidate failed but an active graph was retained. |
| `state-gates.policy.activated` | A validated policy graph was durably activated. |
| `state-gates.delivery.pending` | Durable envelopes could not be published and remain in the outbox. |
| `state-gates.delivery.recovered` | A pending durable batch was successfully republished. |
| `state-gates.delivery.retry_failed` | A live delivery retry failed and was rearmed. |
| `state-gates.boundary.failed` | Scheduled reevaluation failed. |
| `state-gates.boundary.retry_failed` | A boundary evaluation or refresh retry failed and was rearmed. |
| `state-gates.boundary.refresh_failed` | A committed mutation succeeded but its timer refresh failed. |
| `state-gates.assertion.observed|corrected|retracted` | Sanitized administrative assertion lifecycle record emitted after durable commit. |

Assertion lifecycle logs contain only household/assertion/publisher IDs, household and
source revisions, and occurrence time. They never include values, evidence references,
subjects, actors, or roles.

Useful log queries:

```text
context.module:"state-gates" AND _time:24h
"state-gates.startup.unavailable" AND _time:24h
"state-gates.delivery.pending" AND _time:24h
```

Logs may include household IDs, stable entity IDs, revisions, error codes, and counts.
They must not contain credentials or unnecessarily copy administrative claim values,
actor provenance, or evidence.

## Migration checklist

### Producer

- [ ] Private authoritative state and translation policy identified.
- [ ] Publisher ID and fixed authenticated principal registered.
- [ ] Claim type, subject, period, value, unit, and validity authored.
- [ ] Stable assertion ID and source revision allocation defined.
- [ ] Correction and retraction behavior tested.
- [ ] Policy activation succeeds with the authenticated publisher catalog.

### Consumer

- [ ] Capability ID, gate ID, and failure posture authored.
- [ ] Snapshot filters and revision storage defined.
- [ ] Replay/live buffering and transition deduplication implemented.
- [ ] `CURSOR_EXPIRED` resnapshot behavior tested.
- [ ] Granted, denied, and degraded presentation remains consumer-owned.
- [ ] Initial observations do not trigger transition ceremonies.

### Verification

- [x] Domain truth tables and typed policy semantics covered.
- [x] Assertion retry/correction/retraction scenarios covered with fake authenticated producers.
- [x] Snapshot, ordered replay, cursor expiry, and outbox recovery covered with isolated consumers/adapters.
- [x] Invalid policy retains the prior graph.
- [x] Missing and stale evidence exercise both failure postures.
- [x] Household timezone, overnight schedule, and DST gap/fold behavior covered.
- [x] CAS exhaustion, interrupted writes, whole-batch compaction, startup ordering,
  refresh failure, disposal, jitter, and multi-household isolation covered.

These checks exercise the State Gates published language with isolated principals and
fakes. They do not import a real School, Fitness, Piano, chore, or screen domain; those
producer/consumer migrations remain separate work.
