# SchoolCalc system architecture

> **v1 boundary:** This is retained v0 architecture research. The canonical
> release contract is [SchoolCalc Adaptive Study v1](./schoolcalc-v1-requirements.md),
> whose code-first agenda flow makes Catalog/profile/general-lesson routes
> inactive. Reuse the backend, immutable-artifact, queue, importer, and relay
> patterns here only where the v1 contract retains them.

## Purpose and name

**SchoolCalc** is the calculator-native learning product inside DaylightStation
School. It is not tied to one subject or one calculator. The first client is the
TI-86 shell in this extension; a TI-89 client can later implement the same
application ports with a different adapter.

The first binary may be named `SCHLCALC.86p` to fit the TI-86's eight-character
variable-name limit. “School86” is not backend vocabulary.

## Generic learning model

SchoolCalc understands educational structure and interactions, while all
actual subjects and content are data:

```text
catalog
  └─ subject
       └─ course
            └─ unit
                 └─ lesson
                      ├─ lecture notes
                      ├─ examples
                      ├─ problems / drills
                      ├─ flashcards
                      ├─ quiz
                      └─ specialized tool modules
```

The application knows what catalogs, subjects, courses, units, lessons,
examples, problems, flashcards, and quizzes mean. It does not know that a
specific subject is geography, math, chemistry, or economics. Subject IDs,
titles, course trees, lesson text, problems, and answer keys are published
configuration/content.

Specialized modules are registered by capability rather than subject. A `math`
or `plot` renderer may support algebra, physics, chemistry, and finance alike;
a `periodic-table` module is code because it has a specialized interaction,
not because the application branches on “chemistry.”

Every v0 custom definition declares the same portable overview/detail grammar:
neutral topology, snap focus, stable inspector, item identity, position-memory
scope, list/incompatible fallback, and legend placement. The application can
therefore validate and hydrate interaction semantics while the capability's
reviewed client code alone owns geometry and rendering. Lesson content carries
config/data only and cannot select executable code.

This is a v0 model. There is no legacy/implicit-lesson compatibility contract.

## DDD placement

Dependencies point inward, following the repository DDD reference:

| Layer | SchoolCalc responsibility |
|---|---|
| `2_domains/school` | Generic catalog/course/unit/lesson/module invariants, grading, attempt events |
| `3_applications/school` | SchoolCalc use cases and ports; one-Catalog device assignment and device-neutral lesson bundles |
| `1_adapters` | TI-86/TI-89 codecs, TI link transport, ESP API client, artifact/device persistence |
| `4_api` | HTTP request/response mapping only |
| `_extensions/ti86-app` | TI-86 shell, design-system/build tools, and hardware notes |
| `_extensions/ticalc-relay` | ESP relay firmware, TI link transport, and SchoolCalc API client |

No `ti86`, `ti89`, link packet, variable name, CRC, LCD, key code, or QR
encoding belongs in `2_domains`.

## Components

```text
Published School curriculum + assignments + attempts
                         │
                         ▼
              SchoolCalc application use cases
              ┌──────────────────────────────┐
              │ catalog manifest             │
              │ lesson-bundle composition    │
              │ lesson-action binding        │
              │ result import                │
              │ sync orchestration           │
              └───────────┬──────────────────┘
                          │ device-neutral ports
              ┌───────────┴──────────────────┐
              │ calculator-family adapter    │
              │ TI-86 now; TI-89 later       │
              └───────────┬──────────────────┘
                          │ family-specific bytes
                    ESP / cable relay
                          │
          calculator shell + reviewed runtimes
```

On TI-86, reviewed runtime programs extend the fixed shell through TI-OS's
module executor. They are calculator-family implementation code, not School
application concepts and not downloadable lesson artifacts. The shell owns a
closed capability-to-program map and commits durable continuation before a
call. Full ABI and recovery rules are in
[`runtime-modules.md`](./runtime-modules.md).

## Device-neutral learning lesson

The shared Catalog application hands web, print, or a calculator adapter a
`school.learning-lesson/v1` projection:

```yaml
context:
  catalog: { catalogId: school-main, title: School }
  subject: { subjectId: quantitative-studies, title: Quantitative studies }
  course: { courseId: introductory-physics, title: Introductory physics }
  unit: { unitId: kinematics, title: Kinematics }
lesson:
  lessonId: constant-velocity
  title: Constant velocity
  objectives: [...]
  modules:
    - { moduleId: notes-1, type: lecture_notes, documentId: notes/one, document: {...} }
    - { moduleId: examples-1, type: examples, examples: [...] }
    - { moduleId: drill-1, type: problems, mode: drill, items: [...] }
    - { moduleId: quiz-1, type: quiz, items: [...] }
capabilities: [reader@1, problems@1, quiz@1, math@1]
```

Every node has a stable ID; sequence/order is authored data. The application
validates references and module shapes at publication time, before a calculator
can see the lesson. `npm run schoolcalc:validate -- --data-dir <path>` is the
eager promotion gate: it walks all mounted Catalog YAML and resolves every
document, question bank, standard module, and registered tool/custom module.
Its stable report aggregates errors by Catalog ID and full lesson address and
fails closed for an unreadable or empty publication.

The adapter projects the lesson to what its device can represent. TI-86 codec
v4 emits package schema v2 and turns resolved notes and examples into ordered,
source-indexed 23-column by five-line pages of at most 119 ASCII bytes. The Z80
reader rejects any longer string, so authored prose cannot disappear behind an
implicit 120-byte cut. Unsupported
required content makes that unit incompatible; it is never silently presented
as complete. The TI-86 projection retains one bounded answer index for every
locally scoreable choice item and intentional flashcard reveals. The backend's
immutable interpretation remains independent and authoritative, so a submitted
local score is always recomputed before credit.

Portable `tool` modules take the same route. The application validates
capabilities such as `graph@1` but contains no calculator-family branch. The
TI-86 codec replaces neutral configuration with a closed native plan containing
finite operation/launch/resource codes and bounded equation/numeric data. The
calculator's `SCNATIVE` guard independently decodes its exact launch, mutation
scope, framing, token grammar, and numeric representation, then currently
refuses without mutation. The reference transaction proves the later
family-owned `SCN1` snapshot/apply/restore ordering; those Z80 operations and
TI-OS launch still require owned-ROM evidence. Installed native program names and
snapshot ownership come only from an injected adapter allowlist; ordinary
lesson data cannot select a TI variable, OS address, BASIC source, or assembly.

## Artifact identity

`lessonId` remains the learning identity. A downloaded byte package is a
separate immutable **delivery artifact** identified by `artifactId`, derived
from its exact normalized lesson bundle and target adapter version.

An optional Catalog `installSets` collection groups full lesson addresses for
delivery without adding a level to Catalog → Subject → Course → Unit → Lesson.
`BuildSchoolCalcInstallSet` compiles its one-or-more immutable artifacts in
authored order, and the device aggregate applies the resulting IDs atomically.
The projected set carries a stable authored `installSetId` and a content-derived
`versionId`; its member list remains explicit for partial/requested diagnostics.

This distinction matters because transport revisions are not curriculum:

```text
lessonId:    constant-velocity         stable School identity
artifactId:  sc:ti86:7K3M9P           exact compiled calculator bytes
```

Results name the artifact and lesson. The backend retains enough
artifact metadata to interpret offline results after curriculum changes. A
TI-89 build of the same lesson has another artifact ID but resolves to the same
lesson modules and assessment items.

## Data-driven catalog and generated banks

SchoolCalc knows no subject or named course values in code. Catalogs, subjects,
courses, units, lessons, and ordinary modules are configuration/content. A
generated question-bank source is also generic:

- recipes declare explicit bank IDs, titles, subject metadata, item types,
  templates, entity datasets, answer fields, and distractor rules;
- entity datasets contain the content;
- one generic generator produces a standard School question bank;
- a generic bank-source adapter loads recipes and datasets;
- geography is merely the currently shipped recipe set.

Specialized renderers such as a periodic table or clickable map are separately
delivered capabilities. The registry and portable interaction contract exist;
individual device renderers remain future work. The application sees a typed
content requirement, not “geography” or “chemistry” branches.

## Catalog behavior

Catalog is an offline-capable content browser; there are no purchases,
ownership transactions, prices, or licenses in its state model:

1. The backend publishes the content visible to the learner/device.
2. It filters/annotates lessons for the connected adapter's capabilities and the
   device's installed artifacts.
3. The relay caches a compact manifest on the calculator.
4. The learner selects compatible lessons to download or remove.
5. The next cable sync transfers immutable artifacts.

A calculator device has its own ID, capabilities, installed set, queue, and
append-only stable learner-key bindings. It has no permanent default learner.
School-configured students plus synthetic Guest are selectable offline; the
explicit choice is remembered but switchable, and each session/result/delivery
request snapshots its learner key before later profile changes. Catalog and My
Progress are filtered locally to that selection. Device identity and learner
identity remain separate concepts.

## Connected adaptive remediation

Offline lessons, answer-key scoring, queues, and QR export remain complete
without a relay. When policy/config creates a remediation follow-up, a
connected learner may invoke the separate tutor runtime:

```text
authoritative result + weak concepts
  → generic remediation offer/follow-up
  → SCPROF F1 Tutor
  → retained SCTQ / relay sync / ExchangeSchoolCalcInteraction
  → AdaptiveRemediationTutor → injected common IAIGateway
  → bounded SCTR → SCTUTOR body + prompt + F1–F5 choices
```

The School domain owns offer/session/mastery/sequence invariants; application
owns orchestration and ports; persistence, AI, TI-86 codecs, relay transport,
HTTP, and Z80 rendering remain in their existing outward layers. Every turn is
scoped to device and learner, claimed by client sequence and payload digest,
and resumable after unplug. The server never sends the next correct answer to
the calculator; it sends only learner-visible turn content and feedback for an
already submitted choice.

## Offline results and two transports

The shell durably appends a completed result before reporting success. The
TI-86 adapter encodes one immutable positional transport record containing:

```text
deviceId · device-global sequence · learnerKey snapshot · artifactId ·
moduleIndex · responses/progress · local score evidence · checksum
```

The application resolves `moduleIndex` and response `itemIndex` values against
the immutable artifact interpretation to recover stable lesson/module/item IDs,
resolves the key through historical device bindings, and recomputes the score
from the immutable answer key. A forged or stale local score fails before
credit. The TI-86 has no RTC, so this record has no wall-clock timestamp.

The same record can leave through either route:

```text
offline queue ── cable/relay ──┐
                               ├─> one SchoolCalc result-import use case
QR display ─── phone scan ─────┘
```

The idempotency key is `{deviceId, sequence}`. The backend retains the complete
normalized record or a collision-resistant digest:

- same key and same record: duplicate arrival, no duplicate attempts;
- same key and different record: conflict, no credit;
- interrupted first import: resume only missing attempt events.

Transport (`qr` or `relay`) is arrival provenance, never part of identity or
grading. Every observation receives a backend-authored `receivedAt`; sequence
preserves calculator order, while physical `occurredAt` remains unknown. A
resumed import retains its first `startedAt` for School attempt timestamps and
records the retry as another arrival. See [`time-model.md`](./time-model.md).

## Lesson-action QR

An authored learning document may contain `scan_action` with only an action ID
and label. Publication resolves that ID against the configured action mount and
admits only the closed `print_document` and `launch_media` definitions. The
neutral bundle retains no token or target.

Immediately before device compilation, `HydrateSchoolCalcActions` asks the
injected action-token port for a device/address/action/version binding. The
HMAC adapter atomically claims a deterministic 80-bit opaque token in the same
registry used by the ordinary School scan lifecycle. TI-86 codec v4 compiles
only that token and 63 packed QR bytes; target, learner, provider, command,
quota, approval, and debounce state never reach the calculator.

```text
mounted action definition ── publication validation ──┐
                                                      ▼
device + lesson address ── opaque token claim ── TI artifact/QR
                                                      │ camera
                                                      ▼
shared School scan resolver ── current action/version/device/learner lookup
                                                      │
                          existing print policy or trigger policy adapter
```

Persistent lesson actions are repeatable locators, not authentication. The
server can disable/remove an action, revoke a token, or increment
`tokenVersion`; scans always execute current mounted policy. Token collisions
with different meaning fail closed. Print actions retain existing learner
quota/approval behavior, and media actions retain scanner-target/debounce
behavior.

## Fleet identity

TI link protocol identifies a calculator family, not an individual unit.
Enrollment therefore provisions a compact, opaque SchoolCalc device ID. Its
characters never encode calculator family, learner, or relay; `platformId`
remains a separate server-owned field. On a shared single-jack relay, identity
is always the first read. The backend maps the
compact ID to its internal device record, friendly label, platform, stable
active/retired learner bindings, and last observed capabilities.

Re-enrollment creates a new device ID, allowing the device-global sequence to
restart without colliding with old results. The compact ID is identification;
the relay's server credential provides authentication.

## Generic backend API

The normal relay surface is product-oriented, not TI-oriented:

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

Enrollment accepts `{ platformId, label, catalogId }`. `catalogId` is the
durable one-Catalog assignment for that device; the Catalog endpoint compiles
that single assignment and starts the calculator at its Subject list.

`results/import` accepts both assessment-result and lesson-progress record
kinds, keeping QR and cable ingestion behind one idempotent boundary.

The device record's `platform` selects an injected codec adapter. Routes and
use cases contain no `if (platform === 'ti86')` branches; composition registers
available adapters by platform ID.

## Initial delivery sequence

1. Define the v0 catalog/course/unit/lesson/module domain contracts.
2. Replace the geography-specific generated-bank source with a generic,
   recipe-driven adapter; subject-specific recipes remain data.
3. Implement the TI-86 codec adapter and golden byte fixtures.
4. Build Catalog and lesson-artifact use cases.
5. Implement device/artifact/result-ledger persistence adapters and API.
6. Build the TI-86 shell reader, bank runner, offline queue, QR, and Catalog.
7. Implement the direct ESP relay.
8. Add future calculator families by registering another adapter.
