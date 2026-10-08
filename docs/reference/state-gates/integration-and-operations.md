# State Gates Integration and Operations

This reference covers the seams around State Gates: authenticated producers, state
consumers, durable commits, startup recovery, time boundaries, logging, and migration
rules.

## Current integration status

The first production slice is active:

- School publishes `school.day.complete` after session outcomes, piano lessons and
  challenges, story reads, program bypasses, assignment/enrollment edits, startup
  reconciliation, a 15-second authoritative-state reconciliation backstop, and
  study-day rollover; an indeterminate School result retracts completion evidence
  so `piano.games` remains denied with `degraded: true`;
- the fail-closed `piano.games` entitlement controls PianoKiosk Games;
- Fitness publishes roster-wide `fitness.weekly.rings` after startup, session writes,
  session finalization/deletion, five-minute reconciliation, and weekly rollover; and
- `AgendaStatusBoard` reads the active `fitness.weekly-rings` progress count.

Both producers enter through fixed authenticated principals. Consumers bootstrap from
current HTTP state, refresh from the live `state-gates` WebSocket topic, and retain
periodic snapshot polling as disconnect recovery. The old domain reads remain additive
compatibility surfaces, not fallbacks used by the migrated consumers.

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
- the installed School/Fitness policy when no household candidate exists;
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
- live refresh or replay/subscription handoff;
- gap and duplicate handling appropriate to that mode; and
- resynchronization after disconnect or cursor expiry; and
- local presentation for granted, denied, and degraded decisions.

Consumers should use entitlement decisions for binary gating and gate evaluations for
explanations/progress. They should not reconstruct policy from raw assertions.

### Initial state versus transitions

The first projection for an instance is `StateObservation { initial: true }`. It is not
a child accomplishment and must not trigger a celebration. A consumer may celebrate a
genuine later `GateStateChanged` to `satisfied` or `EntitlementDecisionChanged` to
`granted`, subject to its own presentation rules.

### Bootstrap and replay

Consumers that maintain a local projection or react to exact transitions must use the
snapshot/subscription/replay algorithm in [API and events](api-and-events.md). Replay
retention is bounded, so they must handle `CURSOR_EXPIRED` by taking a new snapshot.

A consumer may instead treat every live event only as an invalidation signal and
immediately refetch its filtered current-state snapshot. In that mode, event gaps,
duplicates, and ordering do not alter local truth; periodic and visibility-triggered
snapshot refresh provide disconnect recovery. PianoKiosk and `AgendaStatusBoard` use
this invalidation-and-refetch mode. Neither mode may treat the event bus as history or
truth.

## Persistence

State is stored at:

```text
data/household[-{hid}]/state-gates/current.json
```

The envelope schema is `daylight.state-gates-state/v2`: compact JSON with camelCase
keys, and the same contents list:

- current projection;
- active policy candidate and validation context;
- active and retracted assertions;
- gate evaluations;
- entitlement decisions;
- household revision;
- bounded journal of publication envelopes;
- compaction checkpoint; and
- delivery checkpoint.

Before 2026-09-25 the state was YAML (`current.yml`, v1, snake_case). The engine reads
`current.yml` on each cold read (every process start, until the first commit writes
`current.json`) whenever `current.json` is absent, logs `state-gates.state.migrated`
once per read, and writes `current.json` on the next commit. `current.json` therefore
does not appear immediately after a deploy — `reconcile` writes nothing when nothing is
pending, so its absence right after a restart with no pending work is normal, not a
failed migration. The engine never modifies or deletes `current.yml`.

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

- maximum 500 entries; and
- maximum age 7 days.

The journal shares `current.json` with the projection and every commit rewrites
the whole file, so these bounds are the cost of every write — not just a
storage ceiling. They were 5,000 / 30 days until 2026-09-02, which let the file
reach 2.6 MB and never compact; see
`docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md`.
Each write is about 5 ms (`state-gates.state.written`, sampled).

Compaction removes only complete published revision batches, oldest first. It never
removes an unpublished batch. Retraction tombstones stay in current assertion
provenance even after their transition envelopes age out.

### Rollback

- A build older than 2026-09-25 reads the stale `current.yml`:
  - the household revision regresses;
  - changes since the switch are lost;
  - subscribers holding a newer replay cursor get `INVALID_REPLAY_CURSOR` (400)
    and resubscribe.
- A deliberate rollback is not lossless just by running the converter: the new
  build keeps committing between the CLI run and the container stop — about
  255 commits a day, 2–3 a minute during a workout — and anything committed in
  that window is lost. Do it in this order:
  1. confirm `./scripts/deploy-gate.sh` reports clear;
  2. run the converter inside the container:
     `node cli/state-gates-legacy-yaml.cli.mjs data/household/state-gates/current.json data/household/state-gates/current.yml`
  3. immediately stop the container — anything committed between step 2 and
     this step is the residual loss window, not covered by the converter;
  4. move `current.json` into `data/_deleteme/`;
  5. `chown node:node` the converted `current.yml` (`docker exec` runs as
     root, so the file it just wrote is root-owned);
  6. start the older build.
- Rolling forward again after an older build has written `current.yml`
  makes State Gates refuse to start (`STATE_GATES_STATE_UNAVAILABLE`, cause
  `LEGACY_STATE_NEWER`). Choose one:
  - keep the newer YAML: move `current.json` aside, and it re-migrates;
  - keep the JSON: move `current.yml` aside.
- A lost or damaged `current.json` is recovered from Dropbox version history
  on the data tree.

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

## Auditing a past day

"Was this child allowed games on the 22nd, and why?" has no single answer in State Gates,
because the projection keeps only the present:

- **The entitlement query lies about the past, by design.** Every finished period
  re-evaluates to `denied` / `indeterminate` / `CLAIM_STALE` at its boundary, earned or not
  (see [api-and-events.md](./api-and-events.md#get-apiv1entitlements)). The nightly flip
  also lands in the journal as a granted→denied transition for every learner — it is expiry,
  not revocation.
- **The School producer will not republish a finished day**, so a past period cannot be
  corrected after the fact; nothing prunes it either, so `current.yml` grows by one entry
  per learner per day.
- **The journal** (`GET /api/v1/state-gates/transitions`) covers at most 7 days / 500
  entries.

Reconstruct a day from the consumers instead, in this order:

| Question | Source |
|---|---|
| What did the piano surfaces believe, and when did it change? | Log store: `"piano.school-access.verdict"` — edge-triggered per surface on `(learnerId, state, unlocked)`, 7-day retention. `context.app:piano-kiosk` is the tablet, `context.app:piano` the office display. |
| Who was selected, and what launched? | `piano.user.select` (tablet), `launcher.user-selected` / `launcher.game-selected` / `launcher.game-exited` (office), `game.mount` / `game.unmount` (tablet), `gate.presented` / `gate.passed` (both). |
| What work was done that day? | `school.outcome.recorded`, `school.print.scan-session-graded`, `school.piano-ceremony.satisfied` in the log store; the term grid (`GET /api/v1/school/lifecycle/learners/:id/term`) for older days. |
| What satisfied the gate? | `GET /api/v1/admin/state-gates/assertions` — `evidenceRef: school-completion:<state>`, last answer only. |
| Who actually played? | `data/household/gaming/log/{game}/{date}/` — one archive per match with `user_id`. |

A match whose `user_id` had no `unlocked=true` verdict on that surface before its
`gate.presented`, or whose player is in `gameAccess.disabledFor`, is a bypass.

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
- [ ] Invalidation/refetch or replay/live buffering behavior implemented.
- [ ] Disconnect recovery and, when replay is used, `CURSOR_EXPIRED` behavior tested.
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

These checks exercise the State Gates language with isolated principals and fakes plus
the real School and Fitness translators and the Piano/Agenda consumer models. Chore,
companion-media, and screen producer/consumer migrations remain separate work.

### Piano office launcher recovery

The office TV visualizer shares the kiosk's `piano.games` entitlement check.
The client selects an active `school-day:YYYY-MM-DD` interval explicitly;
other interval types (including fitness weeks) must not supply this decision.
A missing school-day verdict keeps games locked.

The Games lock pauses game selection, but the highest-key change-player command
remains available. The lock screen explains that command and the two-second
lowest/highest-key hold that returns to free play. Returning to free play retains
the selected profile; changing profiles uses the player picker.
