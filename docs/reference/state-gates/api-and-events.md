# State Gates API and Events

State Gates exposes subscriber-safe current state and replay under `/api/v1`, plus
administrative policy/provenance resources under `/api/v1/admin/state-gates`.

All resources are household-scoped through the existing request middleware. “Public”
in the architecture means published to authorized household clients, not anonymous or
internet-public.

## Authentication and authorization

The authentication configuration maps both route families to the `state-gates`
application permission:

```yaml
app_routes:
  state-gates:
    - state-gates/*
    - entitlements/*
```

The startup compatibility helper adds this mapping to existing authored auth
configuration so an unmapped new route cannot accidentally become public.

Default application access:

| Role | State Gates subscriber routes |
|---|---:|
| `sysadmin` | Yes, through `*` |
| `admin` | Yes |
| `parent` | Yes |
| `member` | Yes |
| `kiosk` | Yes |

Application access only reaches the router. Semantic authorization inside the State
Gates application is narrower:

| Action | Allowed roles |
|---|---|
| Read safe gates, entitlements, and replay | Any authenticated principal with route permission |
| Create/retract manual attestation | `sysadmin`, `admin`, `parent` |
| Activate policy | `sysadmin`, `admin` |
| Read raw assertions/policy diagnostics | `sysadmin`, `admin` |

The actor is derived from a verified token (`req.user.sub`) or the existing trusted
local-network boundary. `X-Daylight-Device` is an observability hint, not a credential.
Body-supplied `actor`, `roles`, and `publisher` values do not create authority.

## Query filters

Collection resources accept these optional query parameters:

| Parameter | Meaning |
|---|---|
| `subjectKind` | `learner`, `household`, `room`, or `device` |
| `subjectId` | Stable subject ID |
| `periodKind` | `instant`, `local_day`, `local_week`, `interval`, or `occurrence` |
| `periodId` | Stable period ID |

`GET /entitlements` also accepts `capabilityId`. Gate detail uses the path `gateId`.

## Gate resources

### `GET /api/v1/state-gates`

Returns declared gate definitions plus materialized evaluations matching the filters.

```json
{
  "schema": "daylight.state-gates-query/v1",
  "currentRevision": 12,
  "definitions": [
    {
      "id": "chores.daily-complete",
      "schemaVersion": 1,
      "subjectKinds": ["learner"],
      "periodKinds": ["local_day"],
      "expression": {},
      "progress": null,
      "reasonLabels": {}
    }
  ],
  "items": [
    {
      "definition": { "id": "chores.daily-complete" },
      "evaluation": {
        "gateId": "chores.daily-complete",
        "subject": { "kind": "learner", "id": "learner-a" },
        "period": { "kind": "local_day", "id": "2026-08-30" },
        "state": "satisfied",
        "progress": null,
        "reasons": [],
        "validFrom": 1788130800000,
        "validUntil": 1788163200000,
        "nextBoundary": { "at": 1788163200000, "kind": "period_end" },
        "policyRevision": 2,
        "householdRevision": 12
      }
    }
  ]
}
```

Definitions are returned even if no occurrence has yet materialized an evaluation.

### `GET /api/v1/state-gates/:gateId`

Returns one safe definition and its matching evaluation, or `evaluation: null` when the
gate is declared but no instance is materialized for the supplied filters. An unknown
gate returns `404 GATE_NOT_FOUND`.

## Entitlement resources

### `GET /api/v1/entitlements`

Returns declared entitlement definitions plus current binary decisions:

```json
{
  "schema": "daylight.entitlements-query/v1",
  "currentRevision": 12,
  "definitions": [
    {
      "capabilityId": "media.evening",
      "gateId": "chores.daily-complete",
      "failurePosture": "fail_closed"
    }
  ],
  "items": [
    {
      "capabilityId": "media.evening",
      "gateId": "chores.daily-complete",
      "subject": { "kind": "learner", "id": "learner-a" },
      "period": { "kind": "local_day", "id": "2026-08-30" },
      "decision": "granted",
      "basisState": "satisfied",
      "degraded": false,
      "reasons": [],
      "validFrom": 1788130800000,
      "validUntil": 1788163200000,
      "policyRevision": 2,
      "householdRevision": 12
    }
  ]
}
```

### `GET /api/v1/entitlements/:capabilityId`

Returns one definition and matching decision, or `decision: null` if declared but not
materialized. An unknown capability returns `404 ENTITLEMENT_NOT_FOUND`.

## Manual attestations

### `POST /api/v1/state-gates/attestations`

Creates or corrects an assertion under the fixed authenticated publisher
`manual-attestation`:

```json
{
  "assertionId": "chores:learner-a:2026-08-30",
  "claimTypeId": "chores.daily.done",
  "subject": { "kind": "learner", "id": "learner-a" },
  "period": {
    "kind": "local_day",
    "id": "2026-08-30"
  },
  "value": true,
  "sourceRevision": 1,
  "observedAt": "2026-08-30T18:00:00-07:00",
  "validFrom": "2026-08-30T18:00:00-07:00",
  "validUntil": "2026-08-31T00:00:00-07:00",
  "evidenceRef": "chores/checklist/2026-08-30/learner-a"
}
```

`validFrom` defaults to `observedAt`. Timestamp fields accept finite epoch numbers or
date strings parseable by `Date.parse`; domain/application validation remains
authoritative. Local-day/week boundaries are resolved from household timezone.

The response is a command result, for example:

```json
{
  "result": "observed",
  "currentRevision": 12,
  "deliveryPending": false
}
```

Possible successful `result` values include `observed`, `corrected`, and `idempotent`.
The actor and publisher are never accepted from the body.

### `DELETE /api/v1/state-gates/attestations/:assertionId`

Creates a higher-revision retraction tombstone:

```json
{
  "sourceRevision": 2,
  "retractedAt": "2026-08-30T19:00:00-07:00",
  "evidenceRef": "chores/checklist/2026-08-30/learner-a"
}
```

`sourceRevision` is required. Retraction restores uncertainty; it does not assert
`false` and does not delete provenance.

## Administrative resources

### `POST /api/v1/admin/state-gates/policy/activate`

Reloads the candidate YAML, validates the entire graph, and atomically activates it.
Results include `activated`, `unchanged`, or an error. Activation is authorized inside
the application, not merely by reaching the admin router.

### `GET /api/v1/admin/state-gates/policy`

Returns:

```json
{
  "currentRevision": 12,
  "active": { "digest": "...", "policyRevision": 2 },
  "candidateValidation": {
    "valid": true,
    "checkedAt": 1788130800000,
    "digest": "...",
    "errors": []
  }
}
```

Candidate validation is process memory; active policy identity and projection are
durable. Diagnostics cover source loading/decoding, graph validation, policy-revision,
and dry-evaluation failures—not only failures reached after YAML decoding.

### `GET /api/v1/admin/state-gates/assertions`

Returns current active and retracted assertions, including administrative provenance.
This data is intentionally absent from subscriber gate, entitlement, and event payloads.

## Replay

### `GET /api/v1/state-gates/transitions`

Query parameters:

| Parameter | Default | Bounds |
|---|---:|---|
| `afterRevision` | `0` | non-negative integer |
| `limit` | `100` | positive integer, capped at 500 revision batches |

Response:

```json
{
  "schema": "daylight.state-gates-replay/v1",
  "afterRevision": 10,
  "nextRevision": 12,
  "currentRevision": 12,
  "oldestAvailableRevision": 1,
  "hasMore": false,
  "events": []
}
```

Pagination is by whole household revision, not by individual event. If the cursor is
ahead of current state, the API returns `INVALID_REPLAY_CURSOR`. If retention already
compacted it, the route returns HTTP 410 `CURSOR_EXPIRED` with
`oldestAvailableRevision` and `currentRevision`.

## Event-bus publication

Events publish on topic `state-gates` with schema
`daylight.state-gates-event/v1`:

```json
{
  "schema": "daylight.state-gates-event/v1",
  "transitionId": "state-gates:home:12:00001:GateStateChanged:...",
  "householdRevision": 12,
  "ordinal": 1,
  "occurredAt": 1788130800000,
  "kind": "GateStateChanged",
  "payload": {}
}
```

Published kinds are:

| Kind | When |
|---|---|
| `PolicyGraphActivated` | A new graph is durably activated. |
| `StateObservation` | A gate evaluation or entitlement decision is first materialized or its meaningful projection changes. |
| `GateStateChanged` | A previously materialized gate changes four-state value. |
| `EntitlementDecisionChanged` | Decision, degradation, or basis state changes. |
| `StateRetired` | Policy activation removed a previously materialized gate or entitlement instance. |

Initial materialization emits `StateObservation { initial: true }`, not a state-change
event. Progress-only and reason-only changes emit a new observation without a false
satisfaction ceremony.

`StateRetired` carries no prior state or assertion provenance. Its payload is:

```json
{
  "observationKind": "gate",
  "key": "school.required|learner:child|local_day:2026-08-30",
  "gateId": "school.required",
  "subject": { "kind": "learner", "id": "child" },
  "period": { "kind": "local_day", "id": "2026-08-30", "startsAt": 1788073200000, "endsAt": 1788159600000 },
  "cause": "policy_activated",
  "policyRevision": 3
}
```

Entitlement retirement uses `observationKind: entitlement` and `capabilityId` instead
of `gateId`. Consumers delete the identified entry from their local projection.

Every event in one commit shares a household revision and has deterministic ordinal
ordering. Publication is at least once: consumers deduplicate by `transitionId`.

## Safe consumer handoff

1. Fetch current state and record `currentRevision = R`.
2. Subscribe to live `state-gates` events and buffer temporarily.
3. Replay transitions after `R`.
4. Apply replay and buffered events in `(householdRevision, ordinal)` order,
   deduplicating by `transitionId`; apply `StateRetired` by deleting its instance key.
5. On `CURSOR_EXPIRED`, discard the local projection and restart from current state.

The event bus is ephemeral transport. A consumer must always be able to rebuild from a
current snapshot plus replay.

## Errors

| Status | Representative codes |
|---:|---|
| 400 | `VALIDATION_ERROR`, `INVALID_SOURCE_REVISION`, `INVALID_REPLAY_CURSOR`, `INVALID_REPLAY_LIMIT` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN`, `PUBLISHER_UNAUTHENTICATED` |
| 404 | `GATE_NOT_FOUND`, `ENTITLEMENT_NOT_FOUND`, `CLAIM_TYPE_NOT_FOUND`, `ASSERTION_NOT_FOUND` |
| 409 | `SOURCE_REVISION_CONFLICT`, `STALE_SOURCE_REVISION`, `POLICY_REVISION_CONFLICT`, `REVISION_CONFLICT` |
| 410 | `CURSOR_EXPIRED` |
| 503 | `POLICY_UNAVAILABLE`, `STATE_GATES_STATE_UNAVAILABLE` |

Subscriber error responses go through the shared error middleware. Internal paths,
stacks, credentials, raw evidence, and administrative claim values must not be exposed.
