# State Gates Policy Authoring

The household policy lives at:

```text
data/household[-{hid}]/state-gates/config.yml
```

It is loaded through `ConfigService` under the app key `state-gates`. Configuration is
runtime-cached, but policy activation calls the reload path before validation. Startup
also reconciles the current candidate. When this file is absent, composition supplies
the installed School/Fitness/Piano graph; an authored file replaces that candidate and
must include those definitions to retain the installed integration behavior. A candidate
becomes active only after the entire graph validates.

## Minimal policy

This policy is valid with the foundation's built-in `manual-attestation` publisher and
the default `parent` role:

```yaml
schema: daylight.state-gates-policy/v1
policy_revision: 1

publishers:
  manual-attestation:
    description: Authenticated human attestations

subject_sets: {}

claim_types:
  chores.daily.done:
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
  chores.daily-complete:
    schema_version: 1
    subject_kinds: [learner]
    period_kinds: [local_day]
    expression:
      claim:
        type: chores.daily.done
        publisher: manual-attestation
        subject: $subject
        period: $period

entitlements:
  media.evening:
    gate: chores.daily-complete
    failure_posture: fail_closed
```

Policy IDs must be stable namespaced IDs such as `chores.daily.done`,
`chores.daily-complete`, and `media.evening`.

## Top-level fields

| Field | Meaning |
|---|---|
| `schema` | Must be `daylight.state-gates-policy/v1`. |
| `policy_revision` | Positive integer. A changed graph must increase beyond the active revision. |
| `publishers` | Declared publisher IDs. Every one must also exist in composition's authenticated publisher catalog. |
| `subject_sets` | Named, homogeneous subject lists used by `count`. |
| `claim_types` | Typed published facts and their authority/validity contracts. |
| `gates` | Named four-state expressions. |
| `entitlements` | Binary capability decisions derived from gates. |

The adapter computes a canonical SHA-256 digest after decoding. If the digest matches
the active candidate, activation returns `unchanged`. A different digest with a policy
revision less than or equal to the active revision is rejected with
`POLICY_REVISION_CONFLICT`.

## Subjects and periods

Supported subject kinds are:

```text
learner | household | room | device
```

The subject catalog is built from household configuration:

- household ID → one `household` subject;
- household users → `learner` subjects;
- configured devices → `device` subjects; and
- unique device room/location values → `room` subjects.

Supported period kinds are:

```text
instant | local_day | local_week | interval | occurrence
```

`local_day` and `local_week` boundaries are resolved from the household IANA timezone.
If a request supplies explicit boundaries that disagree with that timezone, it is
rejected with `PERIOD_BOUNDARY_MISMATCH`. Period ends are exclusive.

Subject sets use one kind and must resolve against the catalog:

```yaml
subject_sets:
  learners:
    kind: learner
    members: [user_4, user_2]
```

Empty, mixed-kind, duplicate, or unknown-member sets fail whole-graph activation.

## Claim types

```yaml
claim_types:
  fitness.exercise.minutes:
    schema_version: 1
    value: { type: number, min: 0, unit: minute }
    subject_kinds: [learner]
    period_kinds: [local_day]
    accepted_publishers: [fitness]
    visibility: subscriber
    validity:
      max_age: P2D
      max_future_skew: PT5M
      must_fit_period: true
      actor_required: false
      accepted_actor_roles: []
```

| Field | Contract |
|---|---|
| `schema_version` | Currently `1`. |
| `value` | Closed typed schema: `boolean`, `integer`, `number`, `string`, `enum`, or `duration`. |
| `subject_kinds` | Non-empty supported subject kinds. |
| `period_kinds` | Non-empty supported period kinds. |
| `accepted_publishers` | Non-empty publisher IDs authorized for this claim type. |
| `visibility` | `subscriber` or `administrative`. Controls raw diagnostic visibility, not endpoint authentication. |
| `validity.max_age` | Non-negative finite milliseconds or a non-negative ISO-8601 duration after observation. |
| `validity.max_future_skew` | Non-negative finite milliseconds or a non-negative ISO-8601 duration; defaults to zero. |
| `validity.must_fit_period` | Requires assertion validity to fit the period. |
| `validity.actor_required` | Requires authenticated actor provenance. |
| `validity.accepted_actor_roles` | Roles accepted for actor-sensitive claims; every role must exist in auth configuration. |

Value schemas support these constraints:

| Type | Fields |
|---|---|
| `boolean` | no additional fields |
| `integer` | `min`, `max`, `unit` |
| `number` | `min`, `max`, `unit` |
| `string` | `max_length`, `pattern` |
| `enum` | `values` |
| `duration` | `min`, `max`, `unit` |

There is no arbitrary JSON value, JavaScript, function, I/O, or implicit
string-to-number coercion.

Duration decoding is lexical and strict. Values such as `PT5M`, `P2D`, and numeric
`300000` are accepted; human phrases, numeric strings, signs, mixed week/date forms,
`NaN`, and infinity are rejected with `INVALID_DURATION`. Diagnostics retain the YAML
field path, for example `claim_types.fitness.exercise.minutes.validity.max_age`.

Declaring a publisher in YAML is not enough. A producer such as `school` or `fitness`
must first be registered by composition with an authenticated fixed principal. Until
that migration exists, a policy that declares it fails with
`UNKNOWN_PUBLISHER_AUTHORITY`.

## Assertions

An assertion has this semantic shape:

```text
id, claimTypeId, subject, period, publisherId, value,
sourceRevision, observedAt, validFrom, validUntil?, actor?, evidenceRef?,
status, supersedesSourceRevision?, retractedAt?
```

The identity is `(publisherId, assertionId)`. Its fact slot is
`(claimTypeId, subject, period, publisherId)`.

- The first active value is observed at source revision 1 or greater.
- A correction uses the same assertion ID and a higher source revision.
- A retraction uses the same assertion ID and a higher source revision and leaves a
  tombstone.
- An equivalent retry at the current source revision is idempotent.
- Different content at the same revision is `SOURCE_REVISION_CONFLICT`.
- A lower revision is `STALE_SOURCE_REVISION`.
- An assertion ID cannot silently move to another claim/subject/period/publisher slot.

Two accepted publishers remain independent evidence sources. A gate selector always
names the intended publisher.

## Gate definitions

```yaml
gates:
  fitness.saturday-exercise:
    schema_version: 1
    subject_kinds: [learner]
    period_kinds: [local_day]
    expression: ...
    progress:
      from: /all/1
    reason_labels:
      THRESHOLD_NOT_MET: Exercise target has not been reached
```

`expression` is a closed recursive algebra. `progress` is optional and must select an
unambiguous numeric comparison or count node.

### Claim

Reads a boolean assertion from one explicit publisher:

```yaml
expression:
  claim:
    type: school.day.complete
    publisher: school
    subject: $subject
    period: $period
```

### Comparison

Compares a typed claim with a typed literal:

```yaml
expression:
  comparison:
    claim:
      type: fitness.exercise.minutes
      publisher: fitness
      subject: $subject
      period: $period
    op: gte
    value: { amount: 30, unit: minute }
```

Numeric/integer/duration claims allow `eq`, `neq`, `lt`, `lte`, `gt`, and `gte`.
String/enum claims allow `eq`, `neq`, and `in`. Units must match exactly.

### All, any, and not

```yaml
expression:
  all:
    - { claim: { type: chores.done, publisher: manual-attestation } }
    - not:
        claim: { type: screen.restricted, publisher: screen-policy }
```

`all` and `any` require at least one child. `not` accepts one child. Variables omitted
from a claim selector default to `$subject` and `$period`.

### Gate reference

```yaml
expression:
  reference:
    gate: chores.daily-complete
```

The referenced gate must have a compatible subject/period contract. Reference cycles
fail activation with `GATE_CYCLE`.

### Count over a subject set

```yaml
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
    threshold: { at_least: 2 }
```

Exactly one threshold is allowed: `at_least`, `at_most`, or `exactly`, with a
non-negative integer target.

### Schedule

```yaml
expression:
  schedule:
    days: [sat]
    start: "09:00"
    end: "17:00"
```

Days are `sun` through `sat`. Start is `00:00`–`23:59`; end additionally permits
`24:00`. End at or before start is treated as an overnight window. Evaluation uses the
supplied household timezone and exposes the next schedule boundary.

## Four-state evaluation

| State | Meaning |
|---|---|
| `satisfied` | Applicable evidence proves the expression true. |
| `unsatisfied` | Applicable evidence proves the expression false. |
| `indeterminate` | Evidence is missing, stale, retracted, not yet valid, conflicting, or otherwise unresolved. |
| `not_applicable` | The gate does not govern this subject/period contract. |

Missing evidence is never silently treated as false.

For `all`, unsatisfied wins, then indeterminate, then satisfied. For `any`, satisfied
wins, then indeterminate, then unsatisfied. `not_applicable` children are excluded; if
all children are not applicable, the result is not applicable. `not` swaps satisfied
and unsatisfied and preserves indeterminate/not-applicable.

For count evaluation, let `S` be satisfied members and `I` indeterminate members:

| Threshold | Satisfied | Unsatisfied | Otherwise |
|---|---|---|---|
| `at_least K` | `S >= K` | `S + I < K` | indeterminate |
| `at_most K` | `S + I <= K` | `S > K` | indeterminate |
| `exactly K` | `I = 0` and `S = K` | `S > K` or `S + I < K` | indeterminate |

Count excludes not-applicable members. If no members are applicable, the count is not
applicable.

## Progress and validity

Progress may be projected from:

- a positive `gte`/`gt` numeric or duration target; or
- an `at_least`/`exactly` count.

It contains `current`, `target`, `unit`, a `[0,1]` ratio, and the stable expression node
ID used as its basis. State Gates never invents weighted progress across unrelated
children.

An evaluation's next validity boundary is the earliest of:

- assertion expiration;
- schedule transition; and
- period end.

Composition arms a timer for the earliest boundary and reevaluates without requiring a
new assertion.

## Entitlements

```yaml
entitlements:
  piano.games:
    gate: school.day-complete
    failure_posture: fail_closed
```

| Gate state | Decision | Degraded |
|---|---|---|
| `satisfied` | `granted` | `false` |
| `unsatisfied` | `denied` | `false` |
| `indeterminate`, `fail_open` | `granted` | `true` |
| `indeterminate`, `fail_closed` | `denied` | `true` |
| `not_applicable` | `granted` | `false` |

An entitlement represents one binary capability. Tiers are separate capability IDs;
remaining counts/minutes and progress stay on the gate evaluation.

## Activation

Startup and `POST /api/v1/admin/state-gates/policy/activate` perform complete validation
before one atomic activation commit. Validation includes schemas, IDs, publisher
authority, actor roles, subject sets, bindings, typed values, operators, units,
thresholds, schedules, timezone, progress bases, references, cycles, and entitlement
failure posture.

If a new candidate is invalid and an active graph exists, the active graph and current
decisions are retained. If no valid graph has ever existed, queries return
`POLICY_UNAVAILABLE`. Administrative policy diagnostics report the candidate digest,
check time, and structured errors.
