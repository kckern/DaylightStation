# SchoolCalc product requirements

> **Status:** v0 greenfield requirements. This is the canonical scope and
> boundary document for SchoolCalc. Detailed protocol, GUI, packaging, and
> native-handoff documents refine this contract; they do not override it.

## 1. Product definition

SchoolCalc is DaylightStation School's calculator-native learning platform. It
turns a calculator into an offline-first course reader, practice device, and
assessment terminal with intermittent server synchronization.

The TI-86 is the first client. It is an adapter target, not the product model:
a later TI-89 shell must be able to consume the same School concepts and
application use cases through a different calculator-family adapter.

SchoolCalc comprises five cooperating parts:

1. a stable calculator client release: a shell, reusable on-device design
   system, and fixed reviewed runtime modules where the shell ceiling requires
   them;
2. data-authored School content and an installable content-pack contract;
3. device-neutral SchoolCalc use cases in the backend;
4. calculator-family compilation and transport adapters; and
5. an ESP relay that bridges the calculator's link cable to the School API.

“Online” means that the calculator can exchange Catalog, content, progress, and
results during a relay-attached sync session. The TI-86 does not receive an IP
stack and correctness must never require a permanent connection.

## 2. Product principles

The following are requirements, not implementation preferences:

- **School concepts are generic.** The product understands courses, units,
  lessons, examples, problems, flashcards, quizzes, and progress. It does not
  contain branches for math, chemistry, geography, economics, or another
  subject identity.
- **Content is data.** Ordinary courses and lessons are authored outside the
  codebase in configured School content mounts, using YAML and referenced
  assets.
- **Behavior is capability-driven.** A lesson requests `reader@1`, `quiz@1`,
  `graph@1`, or another renderer/interaction capability. It does not select a
  calculator family or subject-specific code path.
- **The shell and content are separate.** Installing a normal lesson never
  replaces the SchoolCalc executable.
- **Downloaded lesson data is non-executable.** Specialized executable code is
  reviewed and shipped as part of a compatible shell/adapter release, not
  smuggled inside a content pack.
- **Offline is the normal state.** Reading, practice, assessment, result
  queuing, and resume work with no relay attached.
- **Cable and QR converge.** The same result record enters the same import and
  grading use case regardless of how it reached the server.
- **Server state is authoritative.** The backend owns learner binding, grading,
  assignment/visibility policy, artifact history, and idempotency decisions.
- **Catalog is not commerce.** There are downloads and removals, but no store,
  purchases, prices, ownership, or licensing state.
- **No backward compatibility is required.** This is a new v0 protocol and
  content model.

## 3. Canonical learning taxonomy

SchoolCalc uses the School nomenclature:

```text
Catalog
└── Subject
    └── Course
        └── Unit
            └── Lesson
                └── Module
```

Every node has a stable ID, title, explicit order, and optional learner-facing
metadata. Subject values and the complete hierarchy are authored data.

Each enrolled `SchoolCalcDevice` has one required `catalogId`. The backend
projects only that Catalog into the calculator snapshot; the shared repository
may publish other Catalogs for other devices and surfaces. SchoolCalc opens
directly to the assigned Catalog's Subject list and never presents a
calculator-side Catalog selector. Enrollment supplies the assignment; it is
not a relay or calculator choice.

A lesson is an ordered sequence of modules. Standard module families are:

| Family | Purpose |
| --- | --- |
| Lecture notes | Readable explanations, definitions, formulas, and references |
| Examples | Demonstrations and ordered worked steps |
| Problems / drills | Practice with feedback, retry, and optional resurfacing |
| Flashcards | Prompt/reveal/self-report study cycles |
| Quiz | One-pass assessment whose authoritative grading occurs on the server |
| Activity / game | Generic matching, sorting, sequencing, timed-drill, or similar supported mechanics |
| Tool | Handoff to a declared native or SchoolCalc capability |
| Custom interactive | A registered code-backed renderer hydrated by content data |

QR is not another level beneath a quiz. It is an output action available when a
module produces progress, a result, or a server-resolved lesson action.

## 4. Authored content and content packs

### 4.1 Source content

Published SchoolCalc content lives under a configured operational content
mount, not under `backend/src`. YAML may define catalogs, subjects, courses,
units, lessons, module data, documents, question banks, and references to
assets. The filesystem layout is an adapter concern; the domain receives parsed
objects.

At minimum, a published lesson declares:

```yaml
lessonId: constant-velocity
title: Constant velocity
objectives:
  - Interpret a position-time graph
modules:
  - moduleId: notes
    type: lecture_notes
    document: kinematics/constant-velocity
  - moduleId: example-1
    type: examples
    examples: [...]
  - moduleId: practice
    type: problems
    bank: kinematics-constant-velocity-practice
  - moduleId: assessment
    type: quiz
    bank: kinematics-constant-velocity-quiz
requiredCapabilities:
  - reader@1
  - examples@1
  - problems@1
  - quiz@1
```

The actual schema is validated as School data before publication. Unknown
required module types or dangling references fail publication; they do not
become partially rendered lessons.

The executable promotion gate is:

```sh
npm run schoolcalc:validate -- --data-dir /path/to/data
```

It scans every configured-style Catalog/document/question-bank mount, resolves
every lesson through the same device-neutral bundle builder used at runtime,
and exits nonzero for malformed catalogs, unregistered tool/custom modules,
ID mismatches, missing references, or an empty publication. Comma-separated
mount overrides allow the command to validate a multi-pack candidate tree
before it replaces the published mount.

### 4.2 Pack and artifact meanings

The terms are intentionally distinct:

- An **authoring pack** is a replaceable collection of source YAML and assets.
- A **lesson bundle** is the validated, device-neutral application projection
  of one published lesson.
- A **delivery artifact** is the immutable calculator-family binary compiled
  from that lesson bundle.
- An **install set** is the one-or-more artifacts a Catalog action asks a
  device to install or remove.

The v0 TI-86 may use one artifact per lesson because its memory is small. The
model still permits a Catalog entry to request several artifacts as one logical
content pack. “Package” must never create another educational hierarchy.

Multi-lesson delivery grouping is optional top-level Catalog metadata, separate
from the pedagogical tree:

```yaml
installSets:
  - installSetId: kinematics-starter
    title: Kinematics starter
    lessonAddresses:
      - school-main/quantitative/physics/kinematics/velocity
      - school-main/quantitative/physics/kinematics/acceleration
```

Publication requires every member to resolve. Device projection derives the
set's aggregate compatibility, state, known size/artifact IDs, and immutable
content version. Generic application delivery applies the resulting artifacts
as one aggregate revision. A family codec may expose the action only when its
wire/runtime can represent it; the TI-86 v0 queue deliberately continues to
encode one lesson install or one exact artifact removal per record.

### 4.3 Device compatibility

The Catalog response is projected for the observed device and annotates each
lesson with:

- required and available capability versions;
- compatible, incompatible, installed, update-available, or requested state;
- compiled or estimated byte size and available storage;
- a human-readable incompatibility reason; and
- the immutable artifact/install-set identity when available.

An adapter must reject unsupported required content. It must never silently
drop a graded item or mark an incompatible lesson complete.

Every navigable Catalog node also exposes a device-scoped aggregate
availability state derived from its visible descendants: remote, installed,
downloading/requested, mixed, update available, or incompatible. Surfaces may
reduce those states to hollow, filled, or blinking availability markers, but
the selected item's text/action must expose the full state without relying on
animation alone.

## 5. TI-86 shell and design system

The TI-86 client is a stable assembly shell plus fixed, reviewed runtime
programs. `SCHLCALC` owns navigation, dispatch, local state,
installed-artifact discovery, cable variables, and recovery. It delegates
larger interactions to code-release modules: `SCLEARN` owns standard learning,
queue-preserving `SCQR` owns dynamic result QR generation and a private
self-reported output receipt, `SCCAT` owns hierarchy
browsing, `SCREQ` owns the delivery-intent queue, and `SCQUEUE` owns the
response/progress queue. Together they implement the reusable design system,
activities, offline queues, QR presentation, and eventual native-tool handoff.
Ordinary Catalog content remains non-executable and never selects a TI variable
name.

### 5.1 Foundations

- Every screen is designed against the complete 128×64 one-bit framebuffer.
- GUI golden sources use YAML arrays where each 128-character row contains
  only `.` (blank) and `█` (filled); previews may magnify but never crop.
- Runtime content remains compact text and structured data. The shell renders
  it through SchoolCalc's bitmap glyph map; full-screen bitmaps are reference
  assets, not the ordinary content format.
- The custom type system provides compact 3×5 chrome, mixed-case 4×6 reading
  text, and 5×7 display text.
- Icons are semantic one-bit glyphs. Controls already present as physical keys
  are not redundantly drawn as persistent UI buttons.

### 5.2 Shell layout

The default full-screen shell is:

```text
y=00..07  sticky inverted header
y=08      required blank breathing row
y=09..54  scrollable body; optional right-hand position rail
y=55      separator
y=56..63  fixed F1–F5 contextual-action bar
```

Views may take over the full framebuffer when their function requires it; QR
presentation is the primary example.

### 5.3 Component taxonomy

The reusable component library must provide the following abstractions.

| Group | Required components |
| --- | --- |
| Shell | Screen, sticky header, body region, separator, softkey bar, status/queue badges |
| Navigation | Menu, browse list, selectable list item, tab set, scroll rail, position label, breadcrumb/context label |
| Layout | Panel, stack, row, compact tile, content card, divider, modal surface |
| Content | Prose, definition, formula, worked example/step, table, callout, study card, icon/image block |
| Input | Choice group, numeric field, short text field, matching selector, ordering selector, confirmation dialog |
| Learning | Lesson reader, example walker, drill runner, quiz runner, flashcard deck, matching/sorting activity, generic game loop |
| Feedback | Progress meter, score/result summary, correctness/recovery notice, queue state, sync state, storage state, error notice |
| Integration | QR presenter, scan-action presenter, native-tool invitation, content install/remove action |

`Panel` is a logical region, not a mandate to draw a border. Ordinary lists and
reading views remain unboxed to preserve vertical pixels. Tabs and tiles are
used only when their grouping is clearer than a simple list.

### 5.4 Interaction rules

- Up/Down move focus or scroll; Left/Right change parent/child, page, or card
  only when the active view declares that meaning.
- ENTER opens, commits, or continues. EXIT moves up one SchoolCalc level;
  Home remains open. `2nd` + EXIT is the sole deliberate app quit.
- Numeric and ALPHA keys enter data; DEL deletes; CLEAR moves up one
  SchoolCalc level exactly like EXIT.
- F1–F5 are stable, contextual softkeys aligned to the five physical keys.
- F-key labels may select A–E directly or expose actions such as FLIP, MARK,
  INFO, GET, FIND, QR, CABLE, YES, and NO.
- A normal compact multiple-choice prompt renders labelled `A)`–`E)` rows in
  the same body and maps F1–F5 to those choices. A short one-page prompt may
  instead render each safe short answer label directly over F1–F5. Only a
  genuinely tall prompt uses F5 `NEXT` then `ANS`; its choice view provides
  `LEFT: Q` to reopen the final prompt page without losing the durable
  assessment position.
- On-screen softkeys do not duplicate arrows, ENTER, or EXIT merely to fill a
  slot. Catalog and reader views deliberately label F2 as `BACK` in addition
  to EXIT/CLEAR/LEFT; long reader views additionally use F1 `TOP`, F4 `PGUP`,
  and F5 `NEXT`, changing to `END` at the final block. The Subject root shows F5
  `OFF` when no relay is present; deeper lists use F5 `NEXT`/`END` rather than a transport action.
  Unused slots remain empty.
- Selection always has a non-inversion cue, such as a chevron, so focus remains
  legible on the physical LCD.
- Wrapping occurs only in reading/prompt regions. One-line navigation labels
  truncate predictably with `...`; identifiers and numeric values are never
  silently ellipsized.
- Wrap need is based on rendered pixel width, including proportional glyph
  advances and descenders, rather than a fixed character count. Bounded
  components fail validation if text escapes horizontally or vertically.
- Scroll model and key meanings remain stable for the lifetime of a view.

### 5.5 View templates

Required compositions include Home, Catalog, Course/Unit/Lesson browse,
document reader, study card, worked example, multiple-choice question,
numeric/text response, matching/sorting activity, result, sync, confirmation,
QR, and native handoff. A content pack hydrates these templates; it does not
specify raw framebuffer operations.

### 5.6 Optional external input devices

The calculator's physical keypad remains the complete baseline input device;
no required SchoolCalc workflow may depend on an external keyboard. SchoolCalc
must also support an optional relay-mediated external-input capability, with a
BLE HID QWERTY keyboard as the first profile.

- The ESP32 is the BLE central/HID host. The calculator is not presented as a
  USB or BLE HID device; the relay translates HID usages and modifiers into
  calculator-family input events.
- On TI-86 OS screens, the adapter uses remote-key command `0x87` and the
  translated TI-86 keycode table. While SchoolCalc is in the foreground, its
  shell must cooperatively service relay input and place it in the same logical
  event queue used by the physical keypad; it must not assume the OS link
  service remains active during arbitrary assembly execution.
- External arrows, ENTER, escape/back, delete, F1–F5, digits, operators, and
  supported text characters have the same semantic result as their calculator
  equivalents. Mapping, modifiers, repeat, and unsupported-key behavior are a
  versioned calculator-family adapter contract.
- Keyboard input works without Wi-Fi or a backend connection and contains no
  course-, subject-, or content-specific behavior.
- The relay serializes keyboard transactions with Catalog/content/result sync;
  packets may never be interleaved. Input is either safely queued within a
  documented bound or visibly paused during bulk transfer, without silent
  duplication, loss, or reordering.
- Pairing is an explicit local action. Only a bonded/allowlisted keyboard may
  inject input, and relay status must make the connected input device visible.
- With an idle link, acknowledged key input should meet a human-interactive
  target of 100 ms at the 95th percentile. Correct ordering and exactly-once
  delivery take precedence over that latency target.

**Physical proof, 2026-08-01:** through a TI-GRAPH LINK USB adapter, a host
sent TI-86 keycodes `0x1D 0x0C 0x1D 0x06` (`1 + 1 ENTER`) and the physical
TI-86 displayed `2`. This proves the TI-86 OS remote-key path and translated
keycodes. It does not yet prove the ESP32 BLE host, protected direct-jack
interface, sync arbitration, or foreground SchoolCalc input path.

### 5.7 Reviewed runtime programs

The shell may cross TI-OS's `_exec_assembly` boundary only through a closed,
build-owned registry. Before each call it durably commits the exact SCL1
continuation; after a normal return it reloads SCL1 rather than relying on
caller registers or transient pointers. Each runtime is an ordinary assembly
program in the digest-pinned client release, carries a bounded SCX1 ABI header,
and validates that header and payload CRC before mutating state. Missing,
damaged, or incompatible runtime code fails closed.

Runtime programs are client software, not lesson artifacts. Catalog YAML,
SCP1 data, API requests, and relay manifests cannot supply executable bytes,
program names, module codes, or dispatch addresses. The shell may advertise a
runtime-backed capability only after it independently verifies the compatible
runtime is installed and the interaction/recovery gates for that capability
pass.

## 6. Generic runtime hydration

Compiled content addresses a closed, versioned component/capability registry.
Each module contains declarative content and configuration for a renderer the
shell already supports.

The runtime must:

1. validate the artifact envelope and declared lengths before use;
2. reject an unsupported required capability with a useful explanation;
3. render known module/component IDs without subject-aware branching;
4. preserve stable catalog, lesson, module, and item addresses in local state;
5. retain a bounded local answer key for scoreable choice items so offline
   feedback never depends on a cable, while never rendering that key as learner
   content;
6. treat the resulting local score only as evidence: the backend independently
   regrades against the immutable interpretation snapshot before accepting it;
7. fail closed on malformed data without corrupting installed content, state,
   or queued results; and
8. dispatch code-backed behavior only through the closed reviewed-runtime
   registry, never through a name or address obtained from content.

## 7. Specialized interactive modules

Generic components will not adequately express every learning interaction.
Examples include a periodic table, interactive world map, historical timeline,
or a specialized simulation.

SchoolCalc therefore requires a registered custom-module extension point:

```text
module data requests capability `periodic-table@1`
        ↓
application validates neutral module schema and capability requirement
        ↓
TI-86 adapter declares support only if compatible reviewed code is installed
        ↓
shell dispatches to registered renderer and returns through normal view state
```

Rules for custom modules:

- the need for custom code is based on interaction shape, never subject name;
- the domain/application may know the neutral module schema and capability,
  but not TI-86 memory locations, key codes, or drawing routines;
- a content pack supplies only validated data/configuration for that module;
- executable renderer code is built and reviewed with the shell or a separately
  managed first-party code release, never downloaded as ordinary lesson data;
- missing capabilities make content visibly incompatible rather than degraded;
  and
- leaving the module restores the same SchoolCalc navigation/session model.

The v0 registry additionally requires a portable interaction declaration for
every custom definition. It is not authored per lesson and contains no subject
name:

```yaml
interaction:
  model: overview_detail
  topology: grid        # grid | ordered | spatial | relational
  navigation: snap
  inspector: stable
  focusIdentity: item_id
  positionMemory: session # or stable_item
  fallback: list        # or incompatible
  legend: info          # inline | info | none
```

The application attaches that reviewed declaration to the resolved lesson
bundle. A device adapter still decides whether its installed, digest-pinned
renderer implements the named capability; content cannot name a program or
drawing routine. This gives periodic tables, maps, timelines, dense reference
sets, and future spatial tools one predictable focus/inspection/continuation
grammar without pretending their geometry is data-driven generic UI.

The registry and compatibility contract are v0 requirements. Individual
periodic-table, map, timeline, and simulation implementations may be delivered
incrementally.

## 8. Native calculator and TI-BASIC bridge

Lessons may request portable native capabilities including:

- `calculator@1`;
- `graph@1`, including preconfigured equations and window settings;
- `table@1`;
- `solver@1`;
- `matrix@1`;
- `equation-editor@1`; and
- `native-program@1` for an allowlisted installed program.

On the TI-86, `native-program@1` may invoke an installed TI-BASIC program. The
lesson names a logical, allowlisted tool; it does not carry arbitrary BASIC or
assembly source to execute.

The TI-86 compiler replaces neutral tool configuration with a closed
`school.calc.ti86-native-plan/v1`: one finite operation, one finite OS launch,
a sorted list of exact snapshot resources, and bounded operation bytes.
Expressions use a reviewed arithmetic token grammar with no command, label,
program, arbitrary-variable, or source form. Native program names originate
only in an injected adapter allowlist whose default is empty. The runtime must
semantically decode the plan before its first write: exact operation/launch
pair, exact mutation scope, at most 1,152 payload bytes, complete framing,
canonical TI reals, a 192-byte/16-level expression-token grammar, and the same
unique native-program allowlist used by the compiler.

Native invocation is a durable suspend/resume boundary, not a nested call whose
Z80 stack must survive:

1. commit answer drafts and the exact SchoolCalc continuation to shell-private
   `DSLOCAL`;
2. snapshot every native variable the capability adapter will alter;
3. apply validated native configuration;
4. transfer control to the TI-86 OS tool or allowlisted program;
5. let the learner return to the OS normally;
6. relaunch SchoolCalc from its CUSTOM-menu entry;
7. restore native variables idempotently; and
8. resume the exact lesson, module, focus, scroll, and answer draft.

The client-private `SCN1` snapshot is at most 4,096 bytes, has canonical finite
resource entries and a CRC, and is generation/capability-bound to `SCL1`.
Graph and equation-editor handoff snapshot an opaque TI-OS function GDB so
equations, selection/styles, window, mode, and format restore together. A
mutation interface must refuse any resource that was not already snapshotted.
Snapshot deletion is last; a corrupt or missing pending snapshot never causes
guessed restoration.

An automatic EXIT hook is an optional later enhancement. v0 correctness uses
the explicit CUSTOM-menu relaunch and must survive errors, APD, power loss, and
repeated resume attempts.

## 9. Durable local state and offline queue

The shell separates disposable drawing state from durable learner/device state.
Durable state includes:

- provisioned device identity and state generation;
- installed artifacts and Catalog generation;
- current catalog/lesson/module address, focus, and scroll position;
- card/question position and draft/committed responses;
- native-tool continuation and restoration snapshot;
- the next device-global result sequence; and
- queued, sent, and acknowledged result/progress records.

Every completed assessment result or reportable progress event is durably
appended before the UI reports success. Records remain queued until the backend
returns `accepted` or `duplicate`; a transport send alone never deletes them.

The idempotency identity is `{deviceId, sequence}`:

- same identity and same normalized record means duplicate arrival and creates
  no duplicate School attempt;
- same identity and different bytes means conflict and receives no credit; and
- an interrupted import resumes only the missing downstream attempt events.

For a cable queue, the application preflights every decoded record against the
endpoint device before importing any of them. One foreign identity rejects the
whole batch without a ledger claim, grade, progress write, or acknowledgement;
this check occurs before the intentionally sequential, retryable import pass.

Re-enrollment creates a new device identity before its sequence can restart.

### Learner claim and My Progress

Learner selection follows the shared School/PianoKiosk soft-claim pattern, not
a permanent calculator assignment:

1. the generic School learner directory derives the eligible roster from
   household profiles plus `school.yml` policy, so parents or other profiles
   can be excluded without calculator-specific code;
2. each enrolled device maintains append-only stable 16-bit learner-key
   bindings; active configured learners are encoded in `SCU1`, while retired
   bindings remain server-resolvable for historical offline work;
3. the calculator asks who is studying, offers the configured learners plus
   synthetic nonpersistent Guest key zero, remembers an explicit choice, and
   always permits a later switch from settings;
4. switching is refused while a lesson session, pending result, or pending
   delivery continuation could be reattributed; a successful switch resets
   only profile-visible Catalog navigation and preserves installed content,
   Catalog generation, counters, and queues;
5. every non-Guest session, `SCR1` event, and `SCD1` request snapshots the
   stable learner key before later profile changes;
6. the offline `SCC1` projection carries `{learnerKeys, guest}` grants at every
   Catalog level and install set. `SCCAT` filters locally, while the backend
   independently reauthorizes new delivery claims before compilation or
   desired-state mutation;
7. My Progress is a generic School capability, not a TI-86 feature. Its pure
   evidence model supports learner, household, classroom/cohort scopes;
   arbitrary named semester/term/season windows or explicit dates; subject,
   area, course, unit, lesson, module, concept, classification, tag, activity,
   surface, verification, day, and month filtering/grouping; and generic
   continue/next/review/remediation follow-ups;
8. web, kiosk, calculator-family, and future surfaces consume the same progress
   semantics through application/API projections. TI-86 `SCG1` is merely a
   bounded all-active-learner adapter read model and deliberately omits Guest;
9. `SCPROF` promotes `DSPRGNEW` to `DSPROG` with staging deleted last, then My
   Progress renders the selected learner's evidence-backed
   Catalog→Subject→Course→Unit→Lesson→Module history as a bounded overview,
   movable focus, and stable inspector. The domain tree carries descendant
   summaries and direct evidence but never fabricates authored-parent
   completion. `SCG1` retains at most 12 preorder nodes per learner and 48
   fairly allocated across a shared device; and
10. a follow-up label becomes selectable only when that surface can durably
    express/execute its opaque generic action. For a connected remediation,
    `SCPROF` exposes F1 Tutor and hands off to `SCTUTOR`; that runtime snapshots
    the device, learner, follow-up, session, and request ID in `SCTQ`, then
    accepts only an exactly matching `SCTR` response. Other unsupported action
    kinds remain labels without false F-key affordances.

The TI-86 adapter release gate is an implementation proof for this contract,
not a separate progress model: an owned-ROM MAME run transfers the complete
bundle through its virtual Graph Link and verifies selection, direct Subject
browse within the one assigned Catalog, reader, quiz/result QR, profile switching, and the selected learner's SCG1
projection. The canonical release command and its physical-test boundary are
in [`emulator-testing.md`](./emulator-testing.md).

### Event time without a calculator RTC

The TI-86 has no battery-backed real-time clock. Its backup cell preserves
memory, while its approximately 200 Hz interrupt can measure only relative
foreground time. The consequences are mandatory:

1. `SCR1` v1 contains no calculator wall-clock timestamp, and the TI-86 adapter
   rejects fields that claim one.
2. Device-global `sequence` is authoritative for order and idempotency, not for
   elapsed or civil time.
3. The backend stamps every QR or relay observation with its own `receivedAt`.
   Multiple transports create multiple arrivals without creating another
   result.
4. A first accepted import retains `startedAt`; an interrupted retry records a
   new arrival but reuses the original start time for downstream attempts.
5. School attempt `at` and progress `recordedAt` for TI-86 evidence use that
   backend-received basis and never masquerade as physical completion time.
6. Relative ticks or relay time anchors require an explicit versioned future
   capability, provenance basis, and uncertainty. They cannot silently change
   the `SCR1` v1 meaning.

The evidence and complete vocabulary are specified in
[`time-model.md`](./time-model.md).

## 10. QR channel

QR generation is a first-class design-system component because it owns a
complete framebuffer and has strict payload, density, quiet-zone, and recovery
requirements.

### 10.1 School action QR

```text
sch:<16-character opaque token>
```

The server derives and registers a device-bound token from a dedicated HMAC
key, the lesson address, action ID, and explicit token version. The calculator
displays it without embedding the action target, provider details, learner
identity, or authorization policy. Persistent SchoolCalc lesson actions are a
closed low-risk set: print a mounted worksheet through the existing learner
quota/approval service, or launch mounted lesson media through the existing
trigger/debounce service. Broader short-lived School paper tickets may still
represent remediation or session recovery; downloadable calculator content
cannot mint those meanings.

The TI-86 profile is QR Version 1/EC-L, 21×21 modules at 2× scale plus a
four-module quiet zone: 58×58 pixels centered on the full display. The artifact
stores 63 row-major bytes, not a framebuffer. `SCLEARN` admits the QR affordance
only when `kind`, opaque token profile, byte tag/length, and every row-padding
bit validate. F1 opens a chrome-free presenter; F1, ENTER, EXIT, or LEFT returns
to the unchanged lesson page.

The token is repeatable by design, has no embedded expiry, and remains
revocable server-side. Removing/disabling the mounted action or incrementing
its `tokenVersion` invalidates existing scans. A deterministic token collision
with different meaning fails publication rather than rewriting a printed code.

### 10.2 Result/progress QR

```text
sch:r1:<BASE32 of exact SCR1 bytes>
```

`SCR1` is the same canonical record sent through the cable. It carries device
identity, monotonic sequence, immutable artifact reference, module/item
positions, and responses or progress. A response record also carries the
calculator's answer-key-derived `{correct,total,percent}` as visible offline
score evidence. The backend treats neither score nor calculator time as
authoritative: it recomputes the score from the named immutable artifact and
rejects inconsistent evidence.

The proven maximum-density profile is QR Version 9/EC-M: 53 modules plus
four-module quiet zones, occupying 61×61 pixels; the legacy experiment fits
238 ordered A–E responses in this frame. Production v0 deliberately caps an
assessment at 48 responses and uses a fixed Version 5/EC-M/mask-0 runtime
profile. Its 37 modules plus quiet zone occupy 45×45 pixels, and its 69-byte
raw-record bound covers the 67-byte maximum compact v0 result. The larger
modules improve camera margin. The fixed Z80 algorithm must match the host QR
reference module-for-module before physical release.

All household barcode ingress must route the case-sensitive `sch:` namespace
to School before route-specific scanner behavior. Dispatch distinguishes the
reserved `r1:` record form from opaque action tokens. QR-first followed by
cable upload must resolve as one record with two arrival observations.

## 11. Relay and cable synchronization

`_extensions/ticalc-relay` is the physical/network bridge. It speaks the TI
link protocol over the 2.5 mm cable, holds the backend relay credential, calls
the SchoolCalc HTTP API, and exposes local recovery/diagnostic status.

The calculator identifies itself with a provisioned compact device ID. That ID
is opaque and platform-neutral: its characters never encode `ti86`, `ti89`, a
learner, or a relay. The TI link protocol's calculator-family identity is not
sufficient to distinguish a fleet. One relay and one jack may therefore serve
multiple TI-86 calculators
sequentially: each calculator is read, identified, synchronized, and unplugged
before the next is attached. Simultaneous use would require electrically
separate ports or relays and is not a v0 requirement.

A normal attached sync is:

1. read shell/device info and observe capabilities/installed artifacts;
2. refresh the compact Catalog cache;
3. read pending install/remove requests;
4. obtain the server's desired manifest;
5. download immutable artifact bytes, verify them, and transfer named TI
   variables with link-level acknowledgement;
6. upload every queued result/progress record;
7. write acknowledgements only for backend `accepted` or `duplicate` records;
8. report final installed state and display safe-to-unplug status.

Transport awareness is a v0 protocol requirement, not optional polish:

1. Before work, the calculator displays `waiting` and treats raw line state as
   diagnostic evidence only; it never derives a verified peer from tip/ring
   voltage alone.
2. A peer is `verified` only after a valid current-session handshake or
   variable response. Historical verification is labelled as a last-session
   fact, not current attachment.
3. During work, both calculator and relay expose the same named phase,
   calculator-relative direction, current/total items when known, and exactly
   one cable instruction: `keep connected` or `safe to unplug`.
4. Calculator upload, backend wait, calculator download, and local validation
   are distinct states. A percentage is shown only for determinate work.
5. Success, blocker, cancellation, timeout, and error are terminal states with
   recovery copy and an explicit unplug instruction; no busy indicator may run
   forever.
6. Silent Link compatibility mode may expose live state only through the relay
   while TI-OS owns the calculator. The release learner flow uses a cooperative
   foreground handshake so the SchoolCalc Sync screen remains live during the
   exchange.
7. With the protected transmit/listener gates enabled, pressing Sync on the
   calculator initiates `SCF1 HELLO` and wakes the idle relay TI task directly;
   it does not require a WebSocket command, LAN request, or `LINK > RECV`.
8. Disconnect at any phase preserves the old committed Catalog/content and all
   unacknowledged result records. A complete local `DSSYNC` marker makes the
   remaining validation/commit independent of the cable.

The normative UI/evidence/foreground framing contract is
[`transport-awareness.md`](./transport-awareness.md).

Interactive request/response while the cable is attached is allowed, including
Catalog browse/download flows, but every operation must remain retryable after
disconnect. WebSocket notifications may wake the relay; canonical Catalog,
artifact, request, result, and sync operations remain HTTP.

### 11.1 Realtime adaptive remediation

Realtime chat is an optional connected module layered on the same durable sync
transport, never a requirement for offline study or scoring:

1. authored/configured assessment remediation policy decides whether a low
   result creates an offer; application and TI code do not branch on subject;
2. authoritative grading evidence identifies the concepts not yet mastered,
   and the durable offer snapshots only the relevant lesson, bank, concept,
   item, policy, learner, surface, and device context;
3. `SCPROF` exposes F1 Tutor only for the selected non-Guest learner's first
   actionable connected-remediation follow-up;
4. `SCTUTOR` sends one bounded `SCTQ` at a time. F1–F5 map to A–E, EXIT pauses,
   and the request remains byte-identical until its correlated response commits;
5. `ExchangeSchoolCalcInteraction` resolves device, learner, follow-up, session,
   sequence, and turn authority before invoking the generic remediation tutor;
6. the tutor may use the injected common `IAIGateway` to generate one compact
   adaptive explanation and mastery check. Domain validation owns choices,
   scoring, mastery, stopping conditions, bounds, and sequence advancement;
7. wrong choices lead to a different explanation/representation, continuing
   until policy-defined mastery, improvement, exhaustion, or cancellation;
8. `SCTR` contains client-safe body/prompt/A–E labels, the submitted answer's
   correctness/rationale, mastery/cursors, and session status—but never the
   assessment answer key or the next correct choice;
9. SCF1 ping/pong, phase age, verified-session state, and explicit cable safety
   provide live connection awareness. A missed heartbeat, HTTP timeout, or
   unplug returns to a retryable state rather than inventing a response; and
10. the durable request ID, client/server cursors, server-side action claim,
    response echo, and copy-on-write `DSTNEW`→`DSTURN` promotion make retry and
    resume idempotent across duplicate HTTP, cable pulls, APD, and power cuts.

## 12. Backend and DDD ownership

SchoolCalc remains inside the existing School bounded context and follows the
repository's dependency rule.

| Location | Responsibility |
| --- | --- |
| `backend/src/2_domains/school` | Pure Catalog/course/unit/lesson/module invariants, question-bank validation, grading, attempt/result rules; no calculator family or file I/O |
| `backend/src/3_applications/school/catalog` | Shared Catalog lesson hydration and module registry used by web, print, and device projections |
| `backend/src/3_applications/school/schoolcalc` | Calculator-product use cases: device Catalog projection, artifact build, install intent, sync, result import |
| `backend/src/1_adapters/schoolcalc/<platform>` | TI-86 now and TI-89 later: capabilities, codec/compiler, binary records, device limits |
| `backend/src/1_adapters/school/catalog` | Mounted YAML Catalog/content implementations |
| `backend/src/1_adapters/schoolcalc/persistence` | Device, artifact, progress, and result-ledger persistence implementations |
| `backend/src/4_api/v1/routers/school.mjs` | Mount the thin `/api/v1/school/calc` HTTP surface and map requests/responses only |
| `_extensions/ti86-app` | TI-86 shell, reusable device design system, build/render tools, hardware fixtures, and protocol-facing client code |
| `_extensions/ticalc-relay` | ESP firmware, TI link transport, School API client, relay diagnostics |
| configured `data/content` mounts | Authored School catalogs, lessons, documents, banks, and assets |

No `ti86`, `ti89`, LCD, graph-memory, TI variable, link packet, QR encoding, or
ESP concept belongs in `2_domains`. The API router does not read YAML, grade,
compile bytes, or decode TI packets. It invokes application use cases composed
with registered adapters.

## 13. Backend compile and API contract

Compilation is **on demand, then immutable**:

```text
published YAML
  → content repository adapter
  → validated device-neutral lesson bundle
  → registered calculator-family codec
  → immutable delivery artifact
  → artifact repository
  → relay download
```

The same normalized bundle and adapter version produce deterministic bytes and
artifact identity. An existing artifact ID can never be overwritten with
different bytes. Artifact retrieval never recompiles from mutable YAML; this is
what keeps old offline results interpretable after content changes.

The School namespace exposes:

```text
POST /api/v1/school/calc/devices/enroll
POST /api/v1/school/calc/devices/identify
POST /api/v1/school/calc/devices/:deviceId/observe
GET  /api/v1/school/calc/devices/:deviceId/catalog
POST /api/v1/school/calc/devices/:deviceId/requests
GET  /api/v1/school/calc/artifacts/:artifactId
POST /api/v1/school/calc/results/import
POST /api/v1/school/calc/devices/:deviceId/sync
```

`results/import` accepts canonical assessment-result and lesson-progress record
kinds. It resolves the enrolled device, authoritative learner binding, exact
artifact metadata, item IDs, and existing School grading path. Transport source
is recorded as arrival provenance only. The response exposes the backend's
`receivedAt`; TI-86 records have no authoritative `occurredAt`.

The relay is authenticated as a trusted bridge, but its credential does not
make calculator-provided learner IDs, scores, or completion claims
authoritative.

## 14. TI-86 resource requirements

A blank TI-86 exposes 98,224 bytes of user RAM and no archive/Flash tier.
SchoolCalc is intended to be the calculator's primary installed application,
while preserving enough free space to update content safely.

Initial allocation targets are:

| Use | Target |
| --- | ---: |
| Core shell, custom fonts, and common icons | at most 9 KB; below the 9,400-byte physical execution window |
| Standard reviewed learning runtime | 6 KB target; 8 KB ceiling |
| Dynamic result-QR runtime | 4 KB target; 6 KB ceiling |
| Generic Catalog browser runtime | 6 KB target; 8 KB ceiling |
| Delivery-request runtime | 6 KB target; 8 KB ceiling |
| Result/progress queue runtime | 4 KB target; 8 KB ceiling |
| Cooperative foreground-sync runtime | 6 KB target; 8 KB ceiling |
| Read-only native-plan guard runtime | 6 KB target; 8 KB ceiling |
| Learner-profile and compact-progress runtime | 6 KB target; 8 KB ceiling |
| Realtime remediation runtime | 6 KB target; 8 KB ceiling |
| Catalog index and durable shell state | 4–6 KB |
| Offline result/progress queue | 4–6 KB |
| Offline delivery-request queue | 0.5–2 KB |
| Realtime interaction request / committed response | 0.25 KB / 1 KB targets; 0.5 KB / 2 KB ceilings |
| Install/replace scratch and free safety margin | 10–12 KB |
| Downloadable content with standard client reserved | approximately 5–25 KiB |

An ordinary lesson artifact targets 8 KB and has a 12 KB hard ceiling. The
installer must check both final and temporary replacement space before
accepting a request. Low storage must produce an actionable remove-content
flow, never a partial overwrite.

The executable TI-86 adapter contract makes those ranges concrete:

- the shell build fails above 9,216 bytes of Z80 code and separately above the
  9,400-byte physical execution window;
- the standard runtime targets 6,144 bytes and fails above its 8,192-byte
  executable window;
- the QR runtime targets 4,096 bytes and fails above 6,144 bytes;
- the Catalog and delivery-request runtimes each target 6,144 bytes and fail
  above their 8,192-byte executable windows;
- the result/progress queue runtime targets 4,096 bytes and fails above its
  8,192-byte executable window;
- the foreground-sync runtime targets 6,144 bytes and fails above its
  8,192-byte executable window;
- the read-only native-plan guard targets 6,144 bytes and fails above its
  8,192-byte executable window;
- the learner-profile/progress runtime targets 6,144 bytes and fails above its
  8,192-byte TI-OS child-program execution window;
- the realtime-remediation runtime targets 6,144 bytes and fails above its
  9,216-byte product ceiling, still below the 9,400-byte physical window;
- the standard ten-program client is charged 32 conservative overhead bytes
  per TI variable, producing a 60,736-byte target. Independent component
  ceilings sum to 83,264 bytes, but the enforced reserve-safe aggregate maximum
  is 71,962 bytes;
- two 124-byte alternating local-state records plus a conservative 32-byte TI
  variable overhead per record reserve 312 bytes, leaving 3,272 target bytes
  and 5,832 maximum bytes for the `SCC1` Catalog record;
- the canonical `SCQ1` queue is capped at 6,144 bytes; its temporary `DSQB`
  replacement is charged to the scratch reserve rather than steady state;
- the independent fixed-layout `SCD1` delivery queue targets 512 bytes, is
  capped at 2,048 bytes and 32 records, and uses private `DSREQB` for recovery;
- 9,300 bytes always remain unavailable to new staging, and each staged
  variable is charged another conservative 32 bytes;
- transient `SCN1` is capped at 4,096 bytes and charged to that reserve with
  another 32 bytes of variable overhead; native preflight therefore preserves
  at least 5,472 bytes and refuses before any write when it cannot;
- the replaceable `SCU1` learner roster targets 256 bytes and is capped at 512
  bytes, with its in-flight `DSUSRNEW` copy charged to reported free memory;
- the replaceable all-learner `SCG1` progress projection targets 2,048 bytes,
  is capped at 4,096 bytes, and stages as `DSPRGNEW` before calculator-side
  promotion to `DSPROG`;
- fixed `SCTQ` interaction requests target 256 bytes and fail above 512;
  committed `SCTR` responses target 1,024 bytes and fail above 2,048; request
  IDs and bytes are retained across
  processing, disconnect, and retry;
- `DSQOUT` is a fixed 34-byte, calculator-private `SCO1` optical-output receipt
  plus 32 bytes of TI variable overhead; it never participates in relay upload
  or acknowledgement;
- the resulting nominal content target is 16,046 bytes at the client planning
  target and zero at the reserve-safe aggregate maximum; and
- lesson compilation emits an above-target warning after 8,192 bytes and
  fails above 12,288 bytes.

The `caacecbbb8b6` release is 8,092 bytes of shell, 9,208 bytes of learning runtime,
6,142 bytes of QR runtime, 8,175 bytes of Catalog runtime, 6,463 bytes of
delivery-request runtime, 4,135 bytes of result/progress queue runtime, 6,480
bytes of foreground-sync runtime, 6,756 bytes of native-plan guard, 8,177 bytes
of learner-profile/progress runtime, 8,012 bytes of realtime-remediation
runtime, and 320 bytes of conservative variable overhead: 71,960 bytes
installed. It is 11,224 bytes above the planning target, leaves 2 bytes
before the reserve-safe aggregate maximum, and leaves 5,122 bytes for content
after one-Catalog, learner-roster, compact-progress, interaction, and
QR-output-receipt target buffers.
Individual hard-ceiling headroom is 1,124 shell bytes (and 1,308 physical-window
bytes), 8 learning-runtime bytes, 2 QR-runtime bytes,
17 Catalog runtime bytes, 1,729 delivery-runtime bytes, 4,057 queue-runtime
bytes, 1,712 foreground-sync bytes, 1,436 native-guard bytes, 15
learner-profile bytes, and 1,204 realtime-remediation bytes (1,388 before video RAM).
Optional specialized first-party runtimes consume measured free RAM and trade
directly against installed lesson content; they are never silently included in
the standard allowance. Sync planning always uses the device's reported free
bytes.

These values originate in the TI-86 adapter. Application use cases receive
only neutral capability fields such as `reservedFreeBytes`,
`variableOverheadBytes`, and `artifactTargetBytes`; they do not branch on a
calculator family. A changed Catalog and every new artifact must fit together
while the protected reserve and all old artifacts remain present. Bytes that a
future commit will release never count as staging capacity.

## 15. Integrity, privacy, and failure behavior

- CRC/checksum and digest fields detect corruption; they are not
  authentication.
- The compact calculator device ID identifies a device; the relay credential
  authenticates server access.
- Learner attribution is resolved from server enrollment/session policy and is
  repairable through normal School attempt provenance.
- Server-graded answers are omitted from downloaded quiz/problem artifacts.
- QR payloads are visible and replayable, so correctness depends on opaque
  actions, immutable records, expiry/policy where appropriate, and idempotency.
- Power loss, APD, cable removal, a relay restart, duplicate delivery, or a
  native-tool error must not erase installed content or acknowledged/queued
  work.
- Malformed artifacts and result records fail closed with a useful recovery
  state; they do not become partial attempts.
- An old compatible artifact remains usable until a replacement has been fully
  received and verified.

## 16. v0 end-to-end acceptance

The initial system is complete when all of the following work on physical
hardware:

1. Enroll each TI-86 in a fleet with a stable distinct device identity.
2. Attach any enrolled calculator to a shared single-jack relay and fetch its
   compatible Catalog.
3. Browse Catalog → Subject → Course → Unit → Lesson; request a lesson, install
   it, disconnect, reopen it, and later remove it.
4. Use the common shell to read notes, step through examples, study flashcards,
   complete a drill/quiz, and resume after power-off or app exit.
5. Queue progress and quiz responses before reporting completion locally.
6. Upload one record by QR and later by cable; observe one credited result, one
   duplicate, and two arrival records.
7. Sync queued records by cable and delete them locally only after accepted or
   duplicate acknowledgements return.
8. Launch a preconfigured native graph/calculator tool and resume the exact
   SchoolCalc continuation with prior native settings restored.
9. Reject an unsupported custom capability and an oversized/corrupt artifact
   without damaging the previous installation or queue.
10. Render every golden GUI at exactly 128×64, validate typography/icons, and
    scan both the action and maximum supported result QR profiles.
11. Prove that a second calculator-family test adapter can satisfy the
    application contracts without adding TI-family branches to the School
    domain or use cases.
12. Pair an allowlisted BLE keyboard to the relay, disconnect the network, and
    navigate/type through the same ordered SchoolCalc input path while proving
    that a simultaneous sync is serialized without loss or duplication.

## 17. Explicitly outside v0

- purchases, paid content, licenses, or a commercial store;
- an IP stack or always-on socket on the calculator;
- simultaneous multi-calculator use through one electrical link port;
- arbitrary server-downloaded TI-BASIC or assembly execution;
- silent fallback that drops unsupported content or assessable items;
- dependence on a ROM EXIT hook for return from native tools;
- a production TI-89 shell; and
- completion of every proposed specialized renderer before the generic
  registry and core learning flow can ship.

## 18. Refining documents

- [System architecture](./system-architecture.md)
- [Component contracts](./component-contracts.md)
- [SchoolCalc packaging](./schoolcalc-packaging.md)
- [TI-86 runtime modules](./runtime-modules.md)
- [TI-86 GUI design system](./gui-design-system.md)
- [Native-tool handoff](./native-tool-handoff.md)
- [Relay/backend handoff](../../ticalc-relay/docs/backend-handoff.md)
- [Relay v1 protocol](../../ticalc-relay/docs/v1-protocol.md)
- [Content barcode relay](../../content-barcode-relay/README.md)
- [Kitchen scanner relay](../../kitchen-relay/README.md)
