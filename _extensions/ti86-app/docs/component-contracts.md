# SchoolCalc v0 component contracts (retained reference)

> These contracts preserve reusable component and architecture research. The
> [SchoolCalc Adaptive Study v1 requirements](./schoolcalc-v1-requirements.md)
> define the canonical release boundary and supersede v0 learner navigation.

## Product boundary

SchoolCalc owns generic calculator-learning workflows. It understands catalogs,
courses, units, lessons, learning modules, and results. Actual subjects,
courses, and lesson content are published data. It translates a lesson into
capabilities a calculator can render and translates calculator responses back
into ordinary School attempts.

## School concepts reused unchanged

| School concept | SchoolCalc use |
|---|---|
| Catalog | Published tree a device can browse; no commerce semantics |
| Subject | Data-driven catalog grouping; values are never an application enum |
| Course | Ordered collection of units |
| Unit | Ordered collection of lessons around one theme |
| Lesson | Downloadable instructional sequence containing learning modules |
| Module | Notes, examples, problems, flashcards, quiz, or registered tool |
| Attempt | One attributed response event, graded by the existing engine |
| Result | One offline-capable set of module responses |

“Package” is transport vocabulary only. It serializes a lesson bundle; it does
not define another hierarchy.

## Application ports

### `ISchoolCalcCodec`

Implemented once per calculator family in `1_adapters`:

```js
platformId                         // e.g. ti86, ti89
describeCapabilities(rawInfo)      // device bytes -> neutral capability report
encodeDeviceIdentity(identity)      // enrollment -> family identity bytes
decodeDeviceIdentity(record)        // family identity bytes -> neutral identity
encodeCatalog(projection)           // neutral Catalog -> family cache bytes
decodeDeliveryRequests(record)      // family request bytes -> neutral intents
supports(bundle, capabilities)     // compatibility decision + named reasons
compile(bundle, capabilities)      // neutral lesson bundle -> immutable artifact
decodeResult(record)               // QR/cable record -> neutral result submission
decodeResultQueue(record)           // durable family queue -> exact result records
encodeAcknowledgements(acks)       // neutral acks -> device bytes
encodeSyncManifest(plan)            // neutral commit plan -> family bytes
```

The application depends on this port. TI link packets, CRC layouts, variable
names, LCD sizes, key maps, and graph-memory details live only in adapters.

### `ISchoolCalcDeviceRepository`

Owns enrolled device records:

```text
internalId, compactId, label, platform, learnerBindings,
lastCapabilities, installedArtifactIds, lastSeenAt
```

It returns device records, not YAML or database rows.

### `ISchoolCalcArtifactRepository`

Stores immutable compiled artifacts keyed by `artifactId`, plus the exact
source references required to interpret results. Saving different bytes under
an existing ID is an invariant violation.

### `ISchoolCalcResultLedger`

Claims `{deviceId, sequence}`, stores record digest/import state, and records
arrivals separately. It returns `new`, `duplicate`, `conflict`, or `resume`.

### Lesson-action ports

`ISchoolActionTokenIssuer.issue(binding)` accepts only
`{deviceId, address, actionId, tokenVersion}` and returns an atomically claimed
opaque token. The application never depends on HMAC, token alphabet, YAML, or
QR details.

`ISchoolLearningActionExecutor.execute(intent)` accepts one validated current
action plus resolved device/learner/scanner context. Its adapter bridges to the
existing print quota/approval service or media trigger/debounce service; it
does not create parallel authorization rules.

`ILearningContentRepository.getLearningAction(actionId)` returns mounted raw
action data. Catalog/document/action filesystem layout remains an adapter
concern.

## Application use cases

| Use case | Responsibility |
|---|---|
| `EnrollSchoolCalcDevice` | Assign compact ID and platform; provision the first configured learner-key bindings |
| `ObserveSchoolCalcDevice` | Decode current capabilities and installation state |
| `GetSchoolCalcLearnerRoster` | Reconcile configured students into stable active/retired device bindings and encode the active roster |
| `GetSchoolCalcProgressProjection` | Project generic progress and evidence-backed curriculum history for every active learner; omit synthetic Guest and leave device bounds to its codec |
| `ResolveSchoolCalcFollowUp` | Reauthorize an opaque generic follow-up for the selected device learner |
| `GetSchoolCalcCatalog` | Publish the device hierarchy with per-learner/Guest access and compatibility |
| `BuildSchoolCalcArtifact` | Resolve one lesson, compile via selected adapter, persist immutably |
| `HydrateSchoolCalcActions` | Bind validated action IDs to device-specific opaque tokens immediately before compilation |
| `ResolveSchoolCalcAction` | Re-resolve device, learner, current action/version, then invoke the side-effect port |
| `RequestSchoolCalcDelivery` | Resolve the request's learner snapshot, authorize Catalog access, and record desired install/remove state idempotently |
| `ImportSchoolCalcResult` | Decode, claim idempotency key, resolve artifact, grade, record arrival |
| `SyncSchoolCalcDevice` | Coordinate results, acknowledgements, requests, catalog, artifacts |
| `ExchangeSchoolCalcInteraction` | Decode one durable family request, invoke learner-scoped remediation, encode one bounded response |
| `CreateAdaptiveRemediationOffer` / `AdaptiveRemediationTutor` | Create evidence-driven offers and advance idempotent adaptive turns through the injected `IAIGateway` |

Each use case receives ports and existing School collaborators. No use case
imports a TI adapter directly.

`LearningModuleRegistry` definitions for custom code also carry a reviewed,
subject-neutral `overview_detail` interaction contract: topology, snap
navigation, stable inspector, stable item identity, position-memory scope,
fallback, and legend placement. `BuildLearningLesson` hydrates that
metadata after validating the module config. It never hydrates executable code,
renderer names, key codes, or device geometry; those remain inside a
capability-advertising adapter/client release.

## Lesson bundle contract

A bundle is created only from a validated catalog path and lesson:

```js
{
  context: {
    catalog: { catalogId, title },
    subject: { subjectId, title },
    course: { courseId, title },
    unit: { unitId, title }
  },
  lesson: { lessonId, title, objectives, modules },
  capabilities: [
    'reader@1',
    'examples@1',
    'problems@1',
    'quiz@1',
    'math@1'
  ]
}
```

Capabilities are derived from module and item types. They are not subject
labels. Geography and chemistry lessons using multiple-choice problems require
the same `problems@1` capability.

The v0 standard module types are `lecture_notes`, `examples`, `problems`,
`flashcards`, and `quiz`. A specialized module registers a new capability and
validator/renderer; ordinary content never adds application branches.

## Device adapter rules

An adapter MUST:

1. reject a bundle containing an unsupported required block/item type;
2. never silently drop an assessable question;
3. include only the bounded answer material required by a declared offline
   scoring/reveal interaction, never server policy, credentials, or an
   unrendered answer channel;
4. generate deterministic bytes from the same normalized inputs;
5. validate all inbound lengths and checksums before returning a submission;
6. expose incompatibility as data so Catalog can explain it;
7. keep device-specific naming and size limits out of application/domain code;
8. compile portable tool configuration to a closed family-owned data plan;
9. reject any native mutation not covered by an exact precommitted snapshot;
10. compile only an opaque token/QR for a lesson action, never its target or policy; and
11. keep neutral source identity independent of device-bound presentation data.

For TI-86 codec v4/package schema v2, the adapter—not School content—owns pagination. It
projects supported document/example segments into complete 23×5 reader pages,
rejects characters outside the installed ASCII glyph repertoire, and retains
source, segment, and continuation indices in every page record.

The TI-86 adapter may compile to an `SCP1` variable format and use `DSID`,
`DSQ`, and `DSACK`. A TI-89 adapter may use different storage and richer
rendering while satisfying the same port.

## Catalog contract

`GetSchoolCalcCatalog` reads:

- device and its append-only stable learner bindings;
- published data-driven catalog;
- configured learner/device visibility and assignment policy;
- installed artifact IDs;
- adapter capability report.

It returns the `subject → course → unit → lesson` tree annotated at every level
with compatibility, installation state, positive learner-key access, and an
independent Guest grant. A calculator surface filters that one offline
projection using the current remembered profile; the application never has a
permanent “current calculator user.” Catalog has download/remove actions, not
purchase/ownership state.

## Result contract

The calculator-family codec first returns validated positional evidence:

```js
{
  schema: 'school.calc.result/v1',
  kind: 'responses' | 'progress',
  deviceId,
  sequence,
  learnerKey, // stable 16-bit snapshot; never an authoritative learner ID
  artifactId,
  moduleIndex,
  responses: [{ itemIndex, given }], // or progress
  localScore: { correct, total, percent }, // responses only; evidence
  recordDigest
}
```

`ImportSchoolCalcResult` resolves the snapshotted key through the device's
historical bindings, resolves indices through the exact immutable artifact,
and constructs the device-neutral stable-ID submission before calling the
existing School grading path. The TI answer-key-derived score is useful offline
evidence, but the domain independently recomputes it and rejects disagreement.
An adapter never supplies reward, completion, learner identity, or calculator
wall time as authoritative facts.

The result ledger records `{recordDigest, transport, receivedAt}` for every
arrival independently of the logical claim. Import responses expose that
arrival's `receivedAt`. For TI-86 imports, attempt `at` and progress
`recordedAt` use the first import `startedAt` with
`timeBasis: backend_received`; `occurredAt` is absent because the hardware has
no RTC. See [`time-model.md`](./time-model.md).

## Generic generated-bank source

`IBankSource` should expose domain-neutral operations:

```js
resolve(bankId)       // standard raw bank or null
listSummaries()       // catalog metadata from recipes
```

The implementation belongs in `1_adapters` because it reads recipe/entity
files. The pure generator belongs in the School domain because “generate a
question bank from a recipe and entities” is content logic; it accepts explicit
IDs and metadata and knows no geography namespace. State/flag recipes are
ordinary content data.

## TI-86 adapter variables

These names are specific to the TI-86 adapter and shell, not SchoolCalc's
application contract:

| Variable | Purpose |
|---|---|
| `DSID` | provisioned compact device ID |
| `DSINFO` | shell version, gated capabilities, installed-runtime integrity mask, and live limits |
| `DSCAT` | cached Catalog projection |
| `DSREQ` | requested artifact installs/removals |
| `DSUSERS` / `DSUSRNEW` | committed/staged learner roster |
| `DSPROG` / `DSPRGNEW` | committed/staged My Progress projection |
| `DSTREQ` | durable current tutor/follow-up request; relay reads but never deletes |
| `DSTURN` / `DSTNEW` | committed/staged request-correlated tutor response |
| `DPxxxxxx` | immutable compiled lesson artifacts |
| `DSLOCAL0/1` | client-private alternating continuation/draft/native-handoff state; never relayed |
| `DSNATIVE` | client-private bounded `SCN1` native-settings snapshot; never relayed |
| `DSQ` | durable result queue |
| `DSREQB` | client-private delivery-request transaction backup; never relayed |
| `DSQB` | client-private result-queue transaction backup; never relayed |
| `DSCATNEW` | staged Catalog replacement |
| `DSACKNEW` | staged acknowledgements |
| `DSSYNC` | final transaction manifest written last by the relay |

The calculator never makes progress authoritative. `DSPROG` is a bounded,
device-scoped projection of the generic School read model; the selected stable
learner key is restored after SCG1 validation before an entry is resolved.
This prevents a parser scratch value from showing another learner's progress.
The exact-release MAME scenario requires Soren's distinct Math/80% projection,
so that property is exercised through TI-OS rather than only inferred from the
record codec.

Future adapters are free to represent the same contracts differently.

## TI-86 reviewed runtime boundary

The 9 KiB `SCHLCALC` shell may call separately packaged first-party runtime
programs through TI-OS `_exec_assembly`. This remains inside the TI-86 adapter
and extension boundary:

- the shell maps a neutral module/capability to a fixed program name;
- content artifacts contain typed data only and cannot carry that name;
- SCL1 is committed before the call and reloaded after return;
- every runtime uses the closed SCX1 ABI and its build-owned executable ceiling; and
- client release manifests pin exact program SHA-256 values.

Runtime installation/update is client software distribution, never a Catalog
purchase or lesson delivery. `SCLEARN` implements durable standard reading,
flashcards, multiple-choice assessment, and validated full-frame lesson-action
QR; `SCQR` implements queue-preserving dynamic
result QR plus its client-private scan receipt; `SCCAT` browses the generic hierarchy; `SCREQ` writes delivery
intents; and `SCQUEUE` writes response/progress records. `SCPROF` owns the
configured roster, profile switch, and My Progress; `SCTUTOR` owns durable
learner-scoped connected remediation and F1–F5 A–E response entry. None claims
runtime capabilities until its emulator and fleet recovery gates pass. `SCSYNC` owns
cooperative foreground link awareness and transfer. `SCNATIVE` independently
validates operations 1–6 and returns a locked,
read-only status. Native tool plans and `SCN1` recovery are implemented in the
family adapter/reference transaction, but no native capability is advertised
until Z80 snapshot/apply/restore/launch and ROM gates pass. See
[`runtime-modules.md`](./runtime-modules.md).

## Required tests

1. Application tests use fake codec/device/artifact/ledger ports and contain no
   TI bytes.
2. TI-86 adapter tests use golden byte fixtures and malformed-input cases.
3. Catalog tests prove its hierarchy and visibility are entirely data-driven.
4. Projection tests prove each scoreable TI choice item receives exactly one
   bounded local answer while credentials, server policy, and executable data
   never reach an artifact; import tests independently regrade it.
5. QR-first then relay produces one credited result and two arrivals.
6. Reusing a device sequence with changed bytes produces a conflict.
7. The unchanged TI-86/`sim89` application lifecycle contract covers identity,
   Catalog, delivery, immutable retrieval, QR/queue import, progress, ACK, and
   sync without a family branch.
8. TI-86 native mapper/snapshot tests reject source and unallowlisted names,
   decode operation/launch/snapshot/payload bytes again before mutation, and
   fault tests interrupt every configuration/restoration mutation while
   preserving continuation, native settings, and `DSQ`.
9. The lesson-action vertical test starts with authored Catalog/document/action
   data, compiles the real TI-86 artifact, compares its packed QR to the oracle,
   resolves the scanned registry record through current server policy, proves
   repeatability, and proves revocation prevents another side effect.
