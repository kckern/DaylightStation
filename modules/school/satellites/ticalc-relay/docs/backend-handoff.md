# Backend handoff: School content to calculator artifacts

> **Adaptive Study v1 scope:** Keep the DDD placement, codec registry,
> immutable artifact repository, authenticated relay boundary, and idempotent
> result importer described here. The canonical v1 application flow adds
> agenda-issued study sessions, code resolution, and device-bound
> prescriptions as specified in
> [`../../ti86-app/docs/schoolcalc-v1-requirements.md`](../../ti86-app/docs/schoolcalc-v1-requirements.md).
> Catalog/profile/progress/tutor use cases remain source/reference material and
> are not the default learner release.

Status: backend vertical slice implemented; the TI-86 application release now
has owned-ROM/virtual-Graph-Link acceptance evidence, while physical
shell/relay acceptance remains. Updated 2026-08-03.

SchoolCalc is a product capability inside the existing School bounded context.
It is calculator-neutral until a registered family codec is selected. The
first codec happens to target TI-86; adding TI-89 means registering another
adapter, not adding another School application.

## End-to-end ownership

```text
configured content mounts
  catalogs + documents + question banks (YAML)
                    │
                    ▼
1_adapters/schoolcalc/persistence
  parse files and implement application ports
                    │ raw authored values
                    ▼
2_domains/school
  pure Catalog/course/unit/lesson/module and submission invariants
                    │ validated domain values
                    ▼
3_applications/school/schoolcalc
  bundle, Catalog, device, delivery, result, and sync use cases
                    │ neutral bundle / requested platform
                    ▼
1_adapters/schoolcalc/<platform>
  TI-86 codec today; deterministic family bytes and capability limits
                    │ immutable artifact
                    ▼
1_adapters/schoolcalc/persistence
  first-write-wins artifact + durable device/result/progress state
                    │
                    ▼
4_api/v1/routers/schoolCalc.mjs
  authenticated HTTP translation only
                    │
                    ▼
_extensions/ticalc-relay → calculator shell
```

`backend/src/5_composition` is the repository's existing composition root. It
is not a newly invented DDD business layer. Its SchoolCalc module constructs
the concrete repositories/codecs, injects them into the application container,
creates authentication middleware, and mounts the API. No inward layer imports
it.

## Content is mounted data

Authored curriculum does not live under backend source. The composition module
resolves configured paths relative to the DaylightStation data directory:

```yaml
catalog:
  content:
    root: content/school/catalog
    catalog_directories: [...]
    document_directories: [...]
    question_bank_directories: [...]
    action_directories: [...]
  access:
    unassigned: hidden
    guest: none

schoolcalc:
  enabled: true
  ingress:
    relay_ids: [ticalc-relay-01]
```

The root defaults shown above are only path configuration. A household may
mount other media/content directories without changing application code.
Catalogs, subjects, courses, units, lessons, and question sources are data;
there are no geography/math/science branches.

## Neutral lesson assembly

`BuildLearningLesson`:

1. loads a published Catalog through `ILearningCatalogRepository`;
2. validates the generic hierarchy;
3. resolves a stable Catalog/subject/course/unit/lesson address;
4. loads referenced documents and banks through
   `ILearningContentRepository`;
5. validates their generic School shapes;
6. derives required capabilities from module types; and
7. returns `school.learning-lesson/v1`.

The use case has no calculator import or platform branch. A module that truly
needs custom interaction advertises a capability; a family adapter may support
or reject it explicitly.

## Family compilation and immutability

`BuildSchoolCalcArtifact` selects `ISchoolCalcCodec` through
`SchoolCalcCodecRegistry`. The TI-86 implementation:

- validates device capabilities;
- retains exactly one bounded correct-choice index for every assessed item so
  the disconnected calculator can score immediately;
- retains intentional local flashcard reveals;
- projects the neutral bundle into a deterministic typed binary document;
- wraps it in a versioned/checksummed `SCP1` envelope;
- derives `artifactId` from platform, codec version, and normalized source;
- derives the eight-character variable name as `DP` plus the first six
  base32 artifact-key characters; and
- returns exact bytes, length, SHA-256 byte digest, source digest, media type,
  and source references.

`FsSchoolCalcArtifactRepository` is first-write-wins. Saving the same artifact
ID with different bytes or metadata fails. `GetSchoolCalcArtifact` only reads
stored bytes; GET never recompiles current YAML. Offline results can therefore
always be interpreted against the exact artifact snapshot they name.

Compilation is on demand when a valid install request resolves a lesson. A
later publication-time cache may optimize this but cannot weaken immutable
retrieval.

## Application capabilities now present

| Use case | Responsibility |
|---|---|
| `EnrollSchoolCalcDevice` | create device aggregate and family-encoded identity record |
| `IdentifySchoolCalcDevice` | resolve an opaque identity through exactly one registered codec |
| `ObserveSchoolCalcDevice` | decode capabilities/install set and update the enrolled device |
| `GetSchoolCalcLearnerRoster` | reconcile the configured School roster into stable per-device learner keys and one family record |
| `GetSchoolCalcProgressProjection` | produce an all-active-learner generic My Progress read model and one family record |
| `ResolveSchoolCalcFollowUp` | reauthorize one opaque generic progress follow-up for the selected device learner |
| `CreateAdaptiveRemediationOffer` | create a policy/config-driven remediation offer from learning evidence |
| `AdaptiveRemediationTutor` | run sequenced, idempotent adaptive turns through the injected common `IAIGateway` |
| `ExchangeSchoolCalcInteraction` | decode one retained family request, resolve device/learner/action authority, invoke remediation, and encode one client-safe response |
| `GetSchoolCalcCatalog` | produce a compatible, installed-aware, learner-access-annotated offline projection and encode it |
| `BuildLearningLesson` | assemble generic validated content |
| `BuildSchoolCalcArtifact` | compile and persist one immutable family artifact |
| `RequestSchoolCalcDelivery` | claim replay-safe install/remove intents and desired state |
| `GetSchoolCalcArtifact` | retrieve immutable bytes and metadata |
| `ImportSchoolCalcResult` | decode/claim/grade one response or progress `SCR1` |
| `ImportSchoolCalcResultQueue` | decode `SCQ1` and import each exact record |
| `PlanSchoolCalcSync` | reconcile desired/installed state, memory, collisions, ACKs, Catalog, and commit manifest |
| `SyncSchoolCalcDevice` | run observe → queue import → request claim → outbound plan in retry-safe order |

Ports under `backend/src/3_applications/school/ports` cover codecs, Catalog and
content sources, artifacts, devices, result ledger, and progress. Filesystem
and TI-specific implementations remain in `1_adapters`.

## Records and codec ownership

All relayed TI-86 records use an outer magic/version/u16-length/CRC envelope.
`SCI1`, `SCC1`, and `SCP1` carry a deterministic typed binary document;
`SCD1`, `SCU1`, `SCG1`, `SCQ1`, `SCA1`, `SCM1`, compact `SCR1`, `SCTQ`, and
`SCTR` carry
bounded, record-specific fixed layouts. None is a UTF-8 JSON record.

| Magic | Role |
|---|---|
| `SCI1` | provisioned identity or device observation, distinguished by schema |
| `SCC1` | compact offline Catalog projection |
| `SCD1` | durable delivery-request batch; each entry snapshots a 16-bit learner key |
| `SCU1` | device-bound configured learner roster with stable positive keys; Guest is synthesized locally as key zero |
| `SCG1` | device-bound compact My Progress projection for all active configured learners; Guest omitted |
| `SCP1` | immutable lesson artifact |
| `SCQ1` | exact ordered result/progress record queue |
| `SCO1` | calculator-private QR-output receipt map (`DSQOUT`); relay never reads or writes it |
| `SCA1` | acknowledged result sequences |
| `SCM1` | transaction commit manifest |
| `SCR1` | compact response/progress event; same bytes via QR and cable |
| `SCTQ` | one durable device/learner/request-bound follow-up or A–E interaction request |
| `SCTR` | bounded client-safe tutor response that echoes the exact request identity and contains no answer key |

The backend API and ESP treat these as bytes. Only the selected family codec
knows their document fields. TI packet framing and TI String wrappers live in
the relay transport, outside backend layers.

The 2026-08-03 exact-release MAME gate transfers `DSID`, `DSUSERS`, and
`DSPROG` with the complete application bundle, selects a learner, and reads
the SCG1 projection through the TI-OS-launched `SCPROF` runtime. This confirms
the adapter boundary end to end without making MAME evidence a claim about the
ESP's protected physical interface; relay staging, telemetry, and cable work
remain independently governed by this handoff and the relay requirements.

For `school.calc.device-info/v1`, the relay also leaves the required
`runtimeModuleMask` opaque. The TI-86 shell derives its nine defined bits by validating
the installed SCX1 Programs; the TI-86 adapter rejects unknown bits and direct
unapproved capability claims. Runtime bits become portable capabilities only
after an explicit tested-client promotion gate.

## API and authentication

The mounted surface is:

```text
POST /api/v1/school/calc/devices/enroll
POST /api/v1/school/calc/devices/identify
POST /api/v1/school/calc/devices/:deviceId/observe
GET  /api/v1/school/calc/devices/:deviceId/learners
GET  /api/v1/school/calc/devices/:deviceId/progress
POST /api/v1/school/calc/devices/:deviceId/follow-ups/:actionKey/resolve
GET  /api/v1/school/calc/devices/:deviceId/catalog
POST /api/v1/school/calc/devices/:deviceId/requests
GET  /api/v1/school/calc/artifacts/:artifactId
POST /api/v1/school/calc/results/import
POST /api/v1/school/calc/devices/:deviceId/sync
GET  /api/v1/school/calc/devices/:deviceId/remediation
GET  /api/v1/school/calc/devices/:deviceId/remediation/:sessionId
POST /api/v1/school/calc/devices/:deviceId/remediation/:sessionId/actions
```

Handlers validate HTTP shape, invoke injected use cases, and map results. They
do not read YAML, decode family documents, grade, compile, or speak TI link.

SchoolCalc is explicitly enabled from `school.yml`. Allowed relay IDs are
listed at `schoolcalc.ingress.relay_ids`; their distinct secrets live in the
household auth service `ticalc-relay.relays.<relayId>.api_token`. Each secret is
at least 32 bytes. A bearer credential maps to one relay identity using
constant-time digest comparison; `X-SchoolCalc-Relay-Id` may only assert the
same identity.

The internal barcode dispatcher routes case-sensitive `sch:r1:` scans directly
to the same `ImportSchoolCalcResult` instance with transport `qr`. Other opaque
`sch:` action tokens keep their existing School lifecycle route. A
`learning_action` record on that route re-resolves its enrolled calculator,
mounted action, enablement, and `tokenVersion`. A persistent lesson code never
infers the learner who last used the calculator; learner-specific effects fail
safely until a future explicit signed dynamic-profile envelope exists. The
resolved action then delegates to the existing print quota/approval or media
trigger/debounce service. This
avoids a second QR grader, a second policy engine, or an HTTP relay credential
on the scanner.

SchoolCalc action publication additionally requires:

- configured `catalog.content.action_directories` (defaulting beneath the
  configured content root to `actions`); and
- a dedicated household-auth `schoolcalc.action_token_key` of at least 32
  bytes, separate from every relay bearer credential.

Diagnostics expose only `actionDirectories` and `actionTokensConfigured`;
secret material and action targets never appear in Catalog or artifact API
responses. If the key is absent, ordinary SchoolCalc can still mount, but any
lesson requiring `scan-action@1` fails artifact construction instead of
emitting a nonfunctional QR.

## Sync planning invariants

`PlanSchoolCalcSync` deliberately models TI silent-link overwrite behavior:

- all new artifacts must fit while old artifacts remain installed;
- bytes scheduled for deletion are not counted as staging space;
- a same-variable/different-artifact collision blocks the plan;
- desired and installed sets must each have unique variable names;
- each artifact variable must equal `DP` plus the first six characters of its
  immutable ten-character key (the locator is never an independent claim);
- Catalog generation, exact artifact metadata, removals, blockers, and ACK
  sequences are sealed into `SCM1`; and
- only a complete manifest written last authorizes calculator-side commit.

Tutor interaction is deliberately adjacent to, but not absorbed by, the
content transaction. Combined sync accepts an optional opaque `SCTQ`, invokes
`ExchangeSchoolCalcInteraction`, and returns exactly one bounded `SCTR`. The
relay stages it as `DSTNEW`; `SCTUTOR` accepts it only when device ID, learner
key, and 24-bit request ID match retained `DSTREQ`. Processing/retryable states
retain the identical request bytes; terminal acknowledgement deletes the
request only after verified `DSTURN` commit. Thus a timeout, repeated HTTP
request, cable pull, or power cut cannot advance the conversation twice.

A blocked plan still carries `SCA1` and `SCM1` so the shell can acknowledge
safe results and display actionable blockers. It does not transfer artifacts.

## Persistence and idempotency

Device identity is separate from learner identity. A device aggregate stores
platform, friendly label, append-only stable learner-key bindings, observed
capabilities, installed/desired artifacts, delivery requests, relay provenance,
and revision. Active bindings mirror the School-configured learner directory;
retired bindings remain resolvable so an old offline result can never be
reattributed after a roster reorder or profile switch.

The device has no permanent default learner. The calculator remembers one
explicit, switchable soft profile from `SCU1`, with synthetic Guest key zero.
Each assessment/progress session and every `SCD1` delivery entry snapshots its
16-bit key. New delivery claims require a current active binding (or explicit
Guest), resolve the target through the current Catalog projection, and enforce
its `{learnerKeys, guest}` access annotation before compilation or desired-state
mutation. The entire batch is preflighted first. A byte-identical persisted
replay remains a duplicate even after retirement so retries stay idempotent.

Catalog access is data/config driven. The application annotates lessons and
rolls their grants up through unit, course, subject, and Catalog; install-set
access is the intersection of all members. The TI adapter carries those
annotations in `SCC1`, and `SCCAT` filters every hierarchy level locally for
the selected key. No subject or named learner is hard-coded in an application
use case.

Results claim `{deviceId, sequence}` plus normalized-record digest:

| Claim | Outcome |
|---|---|
| unseen | `accepted`; grade/record once |
| same identity and bytes | `duplicate`; record arrival, no second credit |
| same identity and different bytes | `conflict`; no credit or ACK |
| interrupted accepted work | `resume`; append only missing downstream work |

Response `SCR1` includes the TI's answer-key-derived local score as evidence.
The importer recomputes it against the immutable named artifact before claiming
or grading the result, and rejects any mismatch. It resolves the snapshotted
16-bit learner key through the device's historical bindings; the calculator
never submits an authoritative learner ID. `SCR1 kind: progress` is stored through the progress repository but shares the
same queue and claim boundary. Transport (`qr` or `relay`) is arrival
provenance, never grading identity. Each arrival is stamped by the injected
backend clock as `receivedAt`; the TI-86 supplies no `occurredAt`. An
interrupted import retains its first `startedAt` for downstream attempt events
while recording every retry arrival independently. The relay never rewrites
opaque `SCR1` bytes to add time.

Queue import is identity-atomic before application side effects. The endpoint-
selected family codec first decodes every exact queued `SCR1` and proves its
`deviceId` equals the URL device. If any record is foreign, no record in that
batch reaches the result ledger, grader, progress repository, or ACK planner.
This prevents a valid B-owned `SCQ1` from crediting B when posted through A's
device sync endpoint.

Each sync also returns `profiles.record` (`SCU1`) and `progress.record`
(`SCG1`). The relay validates and stages them as `DSUSRNEW` and `DSPRGNEW`.
The calculator promotes each complete device-bound record to `DSUSERS` and
`DSPROG`, deleting staging last. `SCG1` contains generic summaries, at most one
recent score, two prioritized follow-ups, and a parent-indexed evidence-backed
curriculum-history prefix per active learner. The TI-86 codec caps each prefix
at 12 nodes and allocates at most 48 nodes round-robin across the device; every
retained child retains its parent. Structural kinds are Catalog, Subject,
Course, Unit, Lesson, and Module—subject names remain data, and no parent
completion is inferred without an authored outline. Guest has no durable
projection. Its generation excludes query time, so an unchanged learning state
does not churn calculator storage.

An optional `interactionRecord` in the same sync is one exact `SCTQ` retained
by the calculator. `ExchangeSchoolCalcInteraction` decodes it through the
device's registered family codec, resolves the historical device learner key,
reauthorizes the opaque follow-up/session/turn, and advances one idempotently
claimed remediation action. The encoded `SCTR` contains only bounded
learner-visible content and submitted-answer feedback. The relay stages it as
`DSTNEW`; it never deletes `DSTREQ` or interprets the turn.

## Transport split

HTTP is canonical for durable resources and exact binary downloads. WebSocket
may wake a relay and reports fleet health. The relay LAN server provides manual
sync/status and diagnostics. Neither WebSocket nor MQTT owns artifacts or the
only result copy; MQTT is outside v1.

Cable presence, direction, progress, and safe-to-unplug are transport facts
owned by the calculator/relay adapters. They do not enter the School domain or
application sync plan, and backend reachability is not treated as proof of a
connected calculator. Fleet telemetry may mirror the relay's named phase and
verified-peer age over WebSocket, but durable success is still proven only by
record validation, backend ledger outcomes, `DSSYNC`, and the calculator's next
committed observation. The exact awareness contract is
[`../../ti86-app/docs/transport-awareness.md`](../../ti86-app/docs/transport-awareness.md).

Calculator-initiated foreground sync is likewise an adapter concern. The idle
relay TI task accepts `SCF1 HELLO` locally and then invokes the same
variable-oriented sync session and HTTP API client as Silent Link. The backend
does not pre-arm a cable session, inspect line state, or branch on which side
initiated transport ownership.

## Non-negotiable boundaries

- No file I/O or calculator family in `2_domains`.
- No TI-86 branch in `3_applications` or `4_api`.
- No compilation or grading in HTTP handlers.
- No mutable-YAML rebuild on artifact GET.
- No assessed item without the bounded local answer key required for offline
  scoring; no calculator score is accepted without backend recomputation.
- No result removal on transport success alone.
- No distinct QR result schema, ledger, or grader.
- No server-provided executable lesson code.
- No direct API/adapters import from the domain; composition wires outward
  implementations to inward ports.
