# SchoolCalc delivery matrix

> This is the live requirement-to-evidence ledger for
> [`schoolcalc-requirements.md`](./schoolcalc-requirements.md). A requirement is
> complete only when its research/design decision, implementation, automated
> verification, and any required physical-hardware evidence all exist.

## Status legend

| Mark | Meaning |
| --- | --- |
| `done` | Direct evidence exists and covers the stated requirement |
| `partial` | Useful implementation/evidence exists but does not cover the full requirement |
| `missing` | Required implementation or proof does not yet exist |
| `hardware` | Software-side work may be done, but physical verification is still required |
| `n/a` | Deliberately outside v0; the boundary itself is specified and tested where possible |

“Documented” never means “implemented.” Tests count only for the behavior they
exercise. A generated image or binary counts only after its generator and
validator pass.

## 1. Product definition

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-1.1 | Stable calculator client and reusable design system | done | done | partial | Release `295065f74710` passes owned-ROM/virtual-Graph-Link MAME scenarios for shell, Catalog, reader, learner/profile progress, local quiz/result, and QR; protected-cable and fleet execution gates remain |
| SC-1.2 | YAML-authored, installable/removable content packs | done | done | partial | Mounted YAML adapters, neutral bundles, immutable artifacts, Catalog UI, durable delivery intent, and sync plans exist; emulator/fleet execution remains |
| SC-1.3 | Device-neutral backend use cases | done | done | done | Shared Catalog/list/hydration/session opening plus enrollment, identity, observation, artifact build, delivery, result/queue import, planning, and combined sync have focused tests |
| SC-1.4 | Calculator-family compilation and transport adapters | done | done | partial | The TI-86 adapter covers the v0 record set/relay integration and a simulated second family passes the shared lifecycle; physical transport evidence remains |
| SC-1.5 | ESP relay from TI link to School API | done | done | partial | Firmware implements bounded variables, authenticated HTTP, complete sync staging, status/LED awareness, and native tests; protected-jack hardware gates remain |
| SC-1.6 | Intermittently online, always offline-capable | done | done | partial | Host models prove durable recovery; Z80 browsing, requests, notes/examples/flashcards/choice assessments, and response/progress append-before-success work without transport; end-to-end execution gates remain |

## 2. Product principles

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-2.1 | Generic School concepts; no subject branches | done | done | done | Catalog/module tests plus `schoolcalcArchitecture.test.mjs` reject subject vocabulary and outward dependencies in domain/application production code |
| SC-2.2 | Ordinary content is operational YAML/data, not source code | done | done | done | Configured data-root composition and YAML catalog/document/bank adapters are covered by persistence and composition tests |
| SC-2.3 | Behavior selected by versioned capabilities | done | partial | partial | Exact capabilities, generic activity mechanics, registered tool/custom definitions, and fixed SCX1 runtime dispatch exist; component-to-runtime routing and capability advertisement remain |
| SC-2.4 | Stable shell separate from content | done | done | done | `SCHLCALC` remains stable while SCC1/SCP1 variables hydrate through the bounded record reader; build/contract tests contain no embedded lesson fixture |
| SC-2.5 | Downloaded lesson data is non-executable | done | done | done | Closed module/document schemas reject executable-shaped fields; SCP1 contains typed data only and the shell has no downloaded-code loader |
| SC-2.6 | Offline is normal | done | done | partial | Durable host/Z80 continuation, full hierarchy browse/actions, learning, choice assessment, response/progress append-before-success queues, and read-only QR exist; emulator/fleet proof remains |
| SC-2.7 | Cable and QR use one canonical record/importer | done | done | done | Exact SCR1 bytes enter one importer; QR/cable replay produces one grade, two arrivals, and one idempotency identity |
| SC-2.8 | Backend authoritative for identity, grading, policy, artifacts, idempotency | done | done | done | Enrollment lookup, immutable interpretation snapshots, School grading, progress policy, and result ledger are application-owned and tested |
| SC-2.9 | Catalog contains no commerce semantics | done | done | done | Static architecture coverage rejects commerce vocabulary across SchoolCalc production layers |
| SC-2.10 | Greenfield v0; no compatibility shims | done | done | done | Versioned codecs fail closed on unknown versions and no legacy SchoolCalc translation surface exists |

## 3. Canonical learning taxonomy

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-3.1 | Catalog → Subject → Course → Unit → Lesson → Module | done | done | done | Pure validation, flattening, addressing, and bundle resolution preserve the full authored hierarchy and order |
| SC-3.2 | Stable IDs, titles, authored order, optional metadata | done | done | done | IDs, uniqueness, titles, order, objectives, descriptions, short titles, duration, tags, area IDs, and classifications are validated and projected |
| SC-3.3 | Lecture-notes module | done | done | partial | Compiler v2 produces bounded pages and the exact MAME release reaches the installed `FIND TEN PERCENT` reader; fleet/physical interruption proof remains |
| SC-3.4 | Examples/worked-steps module | done | done | partial | Prompt/steps become ordered bounded pages in the durable SCLEARN walker; runtime proof remains |
| SC-3.5 | Problems/practice/drill module | done | done | partial | Subject-neutral multiple-choice projection, F1–F5 runner, draft resume, and queue append build; emulator/fleet proof remains |
| SC-3.6 | Flashcards module | done | done | partial | Intentional answers, front/back page navigation, durable position, and viewed/completed progress queueing build; runtime proof remains |
| SC-3.7 | One-pass offline-scored, server-verified quiz module | done | done | partial | The exact MAME release completes the bundled three-question F-key quiz, reaches the durable offline-result screen, and presents QR; physical recovery and server-import proof remain |
| SC-3.8 | Embedded learning probe with immediate feedback and bounded retry | done | done | partial | Shared schema, web runner, TI-86 two-byte/item continuation, first-response-only local score, SCR1 mode-3 queueing, importer evidence separation, and byte-oracle/source tests are complete; owned-ROM/fleet execution proof remains |
| SC-3.9 | Generic activity/game modules | done | partial | partial | Matching, sorting, sequencing, timed-drill, and memory schemas/capabilities are tested; calculator runners remain |
| SC-3.10 | Tool module | done | partial | partial | Portable registered tool schemas are implemented and tested; calculator-family mapping and shell handoff remain |
| SC-3.11 | Registered custom-interactive module | done | partial | partial | Injected schema registry, capability compatibility, and executable-field rejection exist; shell renderer dispatch remains |
| SC-3.12 | QR is an output action, not taxonomy | done | done | partial | `scan_action` remains a document block/capability; publication, device-bound hydration, packed QR projection, SCLEARN F1/full-frame presentation, and server scan execution are linked and source/integration tested; emulator/fleet proof remains |

## 4. Authored content and content packs

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-4.1 | Configured content mount owns YAML catalogs/lessons/banks/assets | done | done | done | Independent `school.catalog` composition resolves configured directories under the data root; generic YAML adapters discover IDs without domain/application paths or SchoolCalc enablement |
| SC-4.2 | Published lesson schema with objectives/modules/capabilities | done | done | done | Catalog validation covers objectives, closed modules, and exact versioned required capabilities; bundle tests prove projection |
| SC-4.3 | Publication rejects unknown modules/dangling references | done | done | done | `schoolcalc:validate` eagerly walks real mounted YAML, aggregates every Catalog/lesson error, resolves registered modules and references through the production bundle builder, rejects empty publications, and exits nonzero; focused and filesystem-integration tests pass |
| SC-4.4 | Authoring pack definition | done | n/a | n/a | Data-management boundary, not a calculator runtime type |
| SC-4.5 | Device-neutral lesson bundle | done | done | done | `BuildLearningLesson` focused tests pass |
| SC-4.6 | Immutable family-specific delivery artifact | done | done | done | Deterministic TI-86 compilation and first-write-wins verified artifact persistence are tested |
| SC-4.7 | Logical install set of one or more artifacts | done | done | done | Optional top-level Catalog sets group validated lesson addresses outside the learning hierarchy; projection derives version/state/compatibility/size, the builder resolves one-or-more artifacts in order, and generic delivery applies them atomically; domain/application/projection tests pass while TI-86 v0 honestly retains one target per wire record |
| SC-4.8 | TI-86 v0 may use one artifact per lesson | done | done | done | Catalog address, build use case, delivery request, and sync planner converge on one immutable artifact per lesson |
| SC-4.9 | Catalog annotates capability, state, size, and reasons | done | done | done | `GetSchoolCalcCatalog` projects hierarchy, compatibility reasons, install/update/request state, sizes, identity, and a bounded encoded record without compiling |
| SC-4.10 | Unsupported content is rejected, never silently dropped | done | done | partial | Codec refuses compilation; SCCAT makes `incompatible` non-actionable and traverses every projected reason in a wrapped detail view; assembled/source-contract proof passes, emulator/fleet proof remains |

## 5. TI-86 shell and design system

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-5.1 | Stable assembly client owns UI/state/artifacts/queue/QR/link/native handoff | done | done | partial | Shell plus nine fixed runtimes link real input, bitmap text, staged sync, hierarchy browse/actions, content hydration, standard learning, backup-first request/result/progress queues, learner/progress/tutor views, result QR, foreground link, and a read-only native-plan guard; native mutation/launch and emulator/fleet execution proof remain |
| SC-5.2 | Exact 128×64 one-bit golden screens | done | done | done | YAML renderer validates and emits full-canvas PNGs |
| SC-5.3 | Runtime structured text rendered by bitmap glyph maps | done | done | done | Height-stride glyph maps pack per-glyph advance and optional reader descender metadata into otherwise unused bits; clipped/wrapped Z80 renderer, production-shell linking, and probe builds are covered |
| SC-5.4 | Compact, reader, and display typography roles | done | done | done | All three bitmap roles share one asset contract; the mixed-case reader uses proportional 2–5 px advances and seventh-scanline descenders in both host and Z80 renderers while production runtimes link only required roles |
| SC-5.5 | Semantic icon set without redundant hardware controls | done | done | done | Reviewable YAML icon definitions compile to host and Z80 assets; contract tests preserve order and semantics |
| SC-5.6 | Sticky header, one-pixel margin, scroll body/rail, separator, F-bar | done | partial | partial | Golden layouts plus the SCLEARN sticky header, margin, wrapped body, item rail, separator, and empty unused F slots exist; remaining view compositions/runtime pixel proof remain |
| SC-5.7 | Full-frame takeover for QR | done | done | partial | Shell invokes queue-preserving SCQR from durable Result; F1 records only a private SCO1 self-report and F5 defers it, while SCLEARN expands validated V1/L action bytes in a centered chrome-free frame; host oracles/source tests pass and static QR scanned physically, while exact dynamic runtime scans remain |
| SC-5.8 | Shell/navigation/layout/content/input/learning/feedback/integration components | done | partial | partial | Machine-readable registry defines 38 components across all eight categories and all have golden compositions; runtime coverage remains partial |
| SC-5.9 | Unboxed ordinary surfaces; restrained tabs/tiles | done | done | done | Pure pixel lint rejects boxed ordinary content and enforces the exact header margin, separator, softkey occupancy, and full-frame exceptions before rendering |
| SC-5.10 | Stable physical-key and F1–F5 interaction rules | done | done | partial | Shared raw scans, emergency exit, shell navigation, assessment A–E, flashcard flip, Result F1 QR, and lesson-action F1 QR/return are source-tested; behavioral emulator/fleet tests remain |
| SC-5.11 | Wrapping/truncation/focus/scroll rules | done | partial | partial | SCLEARN uses reusable Z80 clipping/wrapping and a durable item rail; within-block continuation and behavioral emulator assertions remain |
| SC-5.12 | Required view templates | done | partial | done | All 23 required templates, including course, unit, My Progress, custom-module, and storage, have linted 128×64 compositions; corresponding runtime coverage remains partial |
| SC-5.13 | Optional relay-mediated BLE keyboard feeds canonical input; keypad remains complete | done | done | partial | Exact-address bonded BLE HID host, Boot Keyboard translation/repeat, bounded ordered queue, serialized Silent Link/foreground delivery, flash-time identity config, and diagnostics are implemented; configured-keyboard/direct-jack proof remains |

## 6. Generic runtime hydration

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-6.1 | Closed, versioned component/capability registry | done | done | partial | Domain/application registries, fixed SCX1 dispatch, and shell-side Program/header/code/ceiling/CRC discovery feed DSINFO `runtimeModuleMask`; promotion remains disabled until emulator/fleet recovery proof |
| SC-6.2 | Validate envelope and every declared length | done | done | done | Adapter and paged Z80 readers validate size/magic/version/length/CRC/string table/value tree before production SCC1/SCP1 traversal; corrupt fixtures fail closed |
| SC-6.3 | Explain unsupported capabilities | done | done | partial | SCCAT opens a non-actionable wrapped reason view and traverses multiple server-projected reasons with arrows/rail; assembly and record/source contracts pass, emulator/fleet pixel proof remains |
| SC-6.4 | Subject-neutral renderer dispatch | done | done | partial | Compiler v2 and SCLEARN dispatch closed `lecture_notes`, `examples`, `problems`, `flashcards`, `quiz`, and `learning_probe` shapes with static forbidden-subject coverage; execution proof/custom shapes remain |
| SC-6.5 | Stable addresses retained in local state | done | done | done | The shell persists the validated artifact/module address and SCLEARN alternates SCL1 before page redraw; host/source tests cover all canonical address fields |
| SC-6.6 | Bounded offline answer key with independent server regrading | done | done | done | TI-86 projection retains exactly one correct-choice index per scoreable item; SCLEARN scores immediately, SCR1 carries evidence, and domain/import tests reject disagreement with the immutable interpretation |
| SC-6.7 | Answer material is exposed only through its declared interaction | done | done | done | Flashcard answers render only after flip; quiz/problem correct-choice bytes are consumed only by scoring and never rendered as learner content |
| SC-6.8 | Malformed data fails without corrupting old content/state/queue | done | partial | partial | Codec/record-reader rejection and exhaustive host commit power-cut tests exist; end-to-end Z80 malformed-lesson traversal remains |

## 7. Specialized interactive modules

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-7.1 | Registered custom-module extension point | done | done | done | `LearningModuleRegistry` injects unique versioned custom validators independently of family support |
| SC-7.2 | Interaction-driven, not subject-driven dispatch | done | done | done | Generic mechanics and custom capabilities are contract-tested; static architecture tests reject subject-specific branches |
| SC-7.3 | Domain/application know neutral schema, not TI internals | done | done | done | The injected validator contract exposes capability/kind/config only; layer tests reject family/link/display vocabulary |
| SC-7.4 | Packs contain only validated module data/config | done | done | done | Catalog, module registry, bundle builder, and compiler fail closed on malformed or executable-shaped configuration |
| SC-7.5 | Executable renderer ships only through reviewed code release | done | done | done | Typed SCP1 data is rejected as SCX1 code; a closed registry, checksummed modules, assembly-only group validation, and a digest-pinned client manifest enforce the separate code-release path |
| SC-7.6 | Missing capability is visibly incompatible | done | done | partial | Lesson rows carry an incompatibility marker and activation opens the reason view without reaching delivery code; emulator/fleet proof remains |
| SC-7.7 | Custom module returns through normal session/navigation state | done | partial | partial | The shell durably saves, invokes fixed `SCLEARN`, reloads state, and redraws; custom routing plus emulator/fleet call-return proof remain |

## 8. Native calculator and TI-BASIC bridge

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-8.1 | Portable calculator/graph/table/solver/matrix/equation/native-program capabilities | done | partial | partial | All schemas map to closed bounded TI-86 plans; host decoding plus SCNATIVE reject launch/scope/token/real/framing tampering before writes for operations 1–6; native-program stays runtime-rejected under the empty allowlist, and mutation/advertisement remain |
| SC-8.2 | Preconfigured graph equations/window | done | partial | partial | Logical slots compile to bounded equation tokens and exact TI reals; SCNATIVE revalidates both and window ordering, while GDB-backed Z80 apply/display remains |
| SC-8.3 | Allowlisted installed TI-BASIC invocation; no source delivery | done | partial | partial | Injected empty-by-default mapper owns installed names, scalar kinds, bounds, and snapshot resources; SCNATIVE deliberately rejects operation 7 until a reviewed calculator allowlist/helper ships |
| SC-8.4 | Commit exact continuation before handoff | done | partial | partial | Reference transaction commits SCN1 then alternating SCL1 before mutation/launch and passes every host power cut; Z80 wiring remains |
| SC-8.5 | Snapshot only variables the adapter will alter | done | partial | partial | SCN1 has canonical finite resources/per-resource limits, and the mutation facade rejects unsnapshotted writes; TI-OS capture remains |
| SC-8.6 | Apply validated configuration and yield to OS | done | partial | hardware | Compiled plan/apply boundary is implemented and tested; TI-OS GDB/config adapters, tail-transfer, emulator, and fleet proof remain |
| SC-8.7 | CUSTOM-menu relaunch restores idempotently and resumes exact view | done | partial | hardware | Reference restore is generation/capability-bound, idempotent, cleanup-last, and preserves exact SCL1/DSQ; Z80 and physical APD/error proof remain |
| SC-8.8 | EXIT hook is optional and never required for correctness | done | n/a | n/a | Boundary locked in native-handoff design |

## 9. Durable local state and offline queue

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-9.1 | Persist identity/generation/install/Catalog/session/draft/native/sequence/queue | done | partial | partial | SCL1, SCN1, SCQ1/SCD1, alternating Catalog/install snapshots, independent counters, and backup-first mutations exist; native Z80 wiring remains |
| SC-9.2 | Append before displaying local success | done | done | partial | Final answer is saved, canonical SCR1 is committed through DSQB→DSQ, sequence advances, then Result appears; emulator/power-cut execution proof remains |
| SC-9.3 | Retain until accepted or duplicate acknowledgement | done | done | partial | Backend/relay eligibility and whole-batch ACK plus Z80 staged ACK/queue recovery exist; physical interruption proof remains |
| SC-9.4 | `{deviceId, sequence}` is immutable identity | done | done | done | SCR1 codec, domain validation, atomic ledger, importer, and two-family fleet tests prove A/B/C may each use the same sequence without crossing namespaces |
| SC-9.5 | Same identity+digest duplicates; changed digest conflicts | done | done | done | Atomic YAML ledger and application conflict/replay tests pass; QR-first/cable-second fleet coverage produces one credit and two arrivals |
| SC-9.6 | Interrupted import resumes missing attempt events only | done | done | done | Import ledger plus provenance scan resumes only absent downstream events and preserves first import time |
| SC-9.7 | Re-enrollment rotates identity before sequence restart | done | partial | partial | Enrollment generates collision-checked platform-neutral IDs; the calculator-side reprovision/reset transaction remains |
| SC-9.8 | TI-86 never fabricates a wall-clock timestamp | done | done | done | `SCR1` has no time bytes; codec/domain rejection tests and hardware research record pass |
| SC-9.9 | Backend timestamps every QR/relay arrival independently | done | done | done | Importer and YAML ledger persist canonical `receivedAt`; QR/cable test proves two arrivals |
| SC-9.10 | Interrupted retries preserve first import time | done | done | done | Result ledger `startedAt`, attempt/progress time basis, and interruption test pass |
| SC-9.11 | PianoKiosk-style configured learner picker, Guest, and remembered switchable soft claim | done | done | partial | Host/source/build tests plus exact MAME learner selection, switch, Home return, and picker reopen pass; physical fleet UX remains |
| SC-9.12 | Session/result/delivery work snapshots learner before later switching | done | done | done | SCL1 session key, SCR1 learner key, SCD1 learner key, pending-work switch lock, historical binding resolution, and replay tests prevent reattribution |
| SC-9.13 | Learner/Guest-scoped Catalog and delivery authorization | done | done | partial | Assignment/config-driven grants filter shared web list/hydration, annotate SCC1, drive SCCAT filtering, and are batch-atomically reauthorized; direct hidden hydration returns not-found and physical empty/changed-roster browse remains |
| SC-9.14 | Cross-surface My Progress with bounded TI projection | done | done | partial | Pure evidence aggregation now includes an honest curriculum-history tree; API/web overview-detail and bounded SCG1/DSPRGNEW→DSPROG/SCPROF views exist, and exact MAME proves the selected learner's Soren Math/80% view; physical fleet proof remains |
| SC-9.15 | Generic follow-up actions are executable on each surface | done | done | partial | Domain/frontend dispatch and learner-scoped TI F1 Tutor handoff exist; SCTUTOR durably issues the opaque follow-up request and accepts only its exact device/learner/request response; emulator/fleet UX remains |

## 10. QR channel

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-10.1 | QR presenter owns complete framebuffer/profile/recovery | done | done | partial | SCQR validates/encodes queued V5/M results and exposes sparse F1 DONE/F5 LATER receipt actions beneath the quiet zone; exact MAME reaches the result QR after a scored quiz. Physical camera scanning and interruption recovery remain |
| SC-10.2 | Opaque `sch:<token>` actions | done | done | done | Profile/classifier/generator tests and reference PNG exist |
| SC-10.3 | Actions expose no provider/identity/policy | done | done | done | Closed action schema forbids provider/identity/policy/command fields; device-bound HMAC issuance and the authored-data→artifact→scan→policy-executor integration test prove only the opaque token reaches the calculator |
| SC-10.4 | Action profile V1/L, 58×58 | done | done | partial | Generator matches the QR oracle; SCP1 stores exact 63-byte rows and SCLEARN builds the centered 2× full frame; exact runtime/camera proof remains |
| SC-10.5 | `sch:r1:<BASE32 SCR1>` result/progress form | done | done | done | Codec equality and QR tests pass |
| SC-10.6 | Result carries local score evidence, never authoritative score/time | done | done | done | TI-86 scores from its embedded answer key and transmits `{correct,total,percent}`; domain/importer recompute against immutable content, reject mismatch, resolve the learner binding, and assign receipt time |
| SC-10.7 | V9/M, 61×61, 238-choice proven bound | done | done | done | Generator test/reference/physical scan evidence exists |
| SC-10.8 | `sch:` dispatch outranks scanner default; action/result split | done | done | done | Composition dispatch tests route `sch:r1:` to the canonical importer before opaque School action handling or reader defaults |
| SC-10.9 | QR-first then cable creates one result/two arrivals | done | done | done | Import application test proves one grade, accepted+duplicate, and two timestamped arrivals |

## 11. Relay and cable synchronization

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-11.1 | Relay owns protected TI link, credential, HTTP client, diagnostics | done | done | partial | Firmware has bounded TI transport, authenticated HTTP adapter, sync task, and `/status`; protected-circuit bench proof remains |
| SC-11.2 | Provisioned compact identity distinguishes fleet | done | done | done | Shell validates DSID, relay resolves opaque SCI1 through backend, and codec/API/session tests reject malformed or ambiguous identity |
| SC-11.3 | One jack serves calculators sequentially | done | done | hardware | A reused relay session/buffer set resolves A then B, clears missing optional records, uploads distinct queue bytes, fetches each device's Catalog, and emits separate commits; A/B/C application isolation also passes, while successive physical calculators remain a bench gate |
| SC-11.4 | Observe DSINFO and installed artifacts | done | done | done | Relay reads bounded SCI1/SCM1 variables and combined sync use case observes them; native/API tests pass |
| SC-11.5 | Refresh compact Catalog cache | done | done | partial | SCC1 adapter/API/relay staging and calculator atomic Catalog commit exist; physical transfer/browse remains |
| SC-11.6 | Read durable install/remove requests and desired manifest | done | done | done | SCD1, delivery reconciliation, complete SCM1 manifest, and relay session are covered by codec/application/native tests |
| SC-11.7 | Verify/download/transfer/commit immutable artifacts | done | done | partial | Relay verifies metadata/SHA/envelope and writes DSSYNC last; Z80 validates/copy-on-write commits; physical interruption matrix remains |
| SC-11.8 | Upload entire queue and write eligible acknowledgements only | done | done | done | Complete identity preflight makes cross-device rejection side-effect-free; exact transaction-scoped SCA1/SCM1 ACKs exclude historical QR-only records and whole-batch deletion/replay/partial/fault tests pass |
| SC-11.9 | Final installed state and safe-to-unplug status | done | done | partial | Relay observer/status/LED plus SCSYNC live phase/terminal UI and post-return shell commit exist; emulator and physical proof remain |
| SC-11.10 | Attached interactivity is retryable after disconnect | done | done | partial | Transaction/queue power-cut models, bounded foreground timeouts, partial-write cleanup, and DSSYNC-last recovery exist; exact-Z80 and physical cable-pull suites remain |
| SC-11.11 | WebSocket wakes; HTTP remains canonical | done | done | partial | WS queues sync only; authenticated HTTP owns durable bytes; live deployment proof remains |
| SC-11.12 | Bonded BLE HID input is offline, ordered, and serialized with sync | done | done | partial | Exact-identity bonded/encrypted BLE HID central, raw-report queue, canonical key translator/repeat, ACK-only dequeue, retry, TI-job serialization, telemetry, config tests, native input tests, and firmware build exist; direct-link input and bulk-transfer contention still require hardware proof |
| SC-11.13 | Presence evidence never confuses raw line state with a verified peer | done | done | partial | Relay reports bus-unavailable/armed/candidate/occupied separately from unknown/activity/negotiating/verified, and shell says idle unknown; electrical bench evidence remains |
| SC-11.14 | Direction, progress, phase age, and cable safety are visible before/during/after | done | done | partial | Relay observer/LED/status, five goldens, and SCSYNC verified-presence/direction/progress/safety rendering exist; exact-Z80 and physical observation remain |
| SC-11.15 | Cooperative foreground link keeps Sync UI live | done | done | partial | Relay variable adapter, calculator-originated idle listener/arbitration, virtual peer tests, and bounded Z80 port-7/TI-packet/SCF1 client plus shell commit handoff exist; owned-ROM emulator and protected-hardware gates remain |
| SC-11.16 | Stage roster/progress projections without risking prior canonical copies | done | done | partial | Relay validates SCU1/SCG1 bounds and writes DSUSRNEW then DSPRGNEW; SCPROF promotes each device-bound record with staging deleted last; native/power-cut models pass and physical interruption remains |
| SC-11.17 | Realtime remediation is optional, policy-invoked, and learner-scoped | done | done | partial | Configurable follow-ups can invoke the generic remediation application after low performance; the server may use `IAIGateway` to adapt turns, while SCTUTOR exposes only bounded text and A–E responses; live model/relay proof remains |
| SC-11.18 | Mid-session unplug is visible, resumable, and idempotent | done | done | partial | Heartbeat/phase telemetry, retained canonical SCTQ bytes, request-ID replay, processing/retry responses, DSTNEW copy-on-write promotion, and exhaustive host interruption tests converge; protected-cable pull proof remains |

## 12. Backend and DDD ownership

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-12.1 | Pure School domain owns generic invariants/grading only | done | done | done | Domain purity and forbidden-vocabulary architecture tests cover Catalog, modules, delivery, result evidence, grading, and attempts |
| SC-12.2 | Application owns use cases/ports and no family branches | done | done | done | Complete use-case/port set uses injected codec/module registries; static tests permit only inward domain/port imports |
| SC-12.3 | Calculator-family codecs/limits live in adapters | done | done | done | TI-86 binary codec/limits are isolated under `1_adapters/schoolcalc/ti86`; application conformance tests inject another family |
| SC-12.4 | YAML/device/artifact/ledger persistence lives in adapters | done | done | done | Shared Catalog/content YAML adapters live under `1_adapters/school/catalog`; calculator device/artifact/progress/ledger adapters remain under `1_adapters/schoolcalc/persistence`; discovery, first-write, optimistic-lock, atomic-ledger, and timestamp tests pass |
| SC-12.5 | API mounts thin `/school/calc` translation surface | done | done | done | Injected handlers/router expose enrollment, identity, observation, learners, progress, Catalog, requests, artifacts, import, remediation, and sync beneath School |
| SC-12.6 | TI-86 shell and tools stay in extension | done | done | done | Production shell, assembly modules, generated fixtures, render/build tools, binaries, and hardware gates all remain under `_extensions/ti86-app` |
| SC-12.7 | ESP/link code stays in relay extension | done | done | done | Link, HTTP, sync-session, foreground-frame, awareness, and ESP adapters remain under `_extensions/ticalc-relay` with native seams |
| SC-12.8 | Authored data stays in configured content mounts | done | done | done | Composition resolves operational mount configuration; production SchoolCalc source layers contain no authored subject catalogs |
| SC-12.9 | No family/LCD/link/QR/ESP concepts enter School domain | done | done | done | Targeted static architecture tests reject family/wire/display vocabulary across domain and application production files |
| SC-12.10 | API does not read YAML, grade, compile, or decode TI records | done | done | done | API layer is injection-only, accepts JSON/binary transport shapes, and is statically plus integration tested |
| SC-12.11 | My Progress remains generic School domain/application behavior | done | done | done | Append-only evidence, scopes, academic periods, filters/groups, follow-ups, ports, API, and frontend consume no TI vocabulary; SCG1 remains adapter-only |
| SC-12.12 | Shared Catalog exists independently of SchoolCalc | done | done | done | `BuildLearningLesson`, `LearningModuleRegistry`, neutral ports/adapters, `GetLearningCatalog`, and `school.catalog` composition serve web/print/device consumers even when `schoolcalc.enabled` is absent; composition and architecture tests pass |

## 13. Backend compile and API contract

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-13.1 | YAML adapter → validated bundle → registered codec → immutable repository | done | done | done | Production composition wires the complete chain and tests create an artifact from mounted data through the registered TI-86 codec |
| SC-13.2 | Deterministic bytes and artifact identity | done | done | done | Golden digest test passes |
| SC-13.3 | Existing artifact ID cannot change bytes | done | done | done | Filesystem repository is first-write-wins, rejects conflicting metadata/bytes, and verifies bytes on read |
| SC-13.4 | Artifact GET never recompiles | done | done | done | Dedicated retrieval use case and binary API test prove codec compilation count is unchanged |
| SC-13.5 | Enroll endpoint | done | done | done | Use case validates family/learner, generates a collision-checked identity, persists the aggregate, and returns adapter bytes through authenticated API |
| SC-13.6 | Observe endpoint | done | done | done | Adapter decodes device info/state, aggregate records relay observation, and binary API route is tested |
| SC-13.7 | Device Catalog endpoint | done | done | done | Device-specific projection and encoded Catalog route include validators/304 behavior without compilation |
| SC-13.8 | Install/remove requests endpoint | done | done | done | Device-bound decoded batches, idempotency/conflict, on-demand build, and one aggregate save are tested through use case/API |
| SC-13.9 | Immutable artifact endpoint with metadata | done | done | done | Binary bytes, immutable validators, ID/name/digest/length headers, and conditional GET are implemented |
| SC-13.10 | Result/progress import endpoint | done | done | done | One binary/text handler drives canonical idempotent assessment/progress import and returns backend receipt time |
| SC-13.11 | Device sync endpoint | done | done | done | Combined retry-safe orchestration observes, imports the exact queue, applies requests, and emits bounded Catalog/artifact/ACK/manifest plans |
| SC-13.12 | Resolve device, learner, artifact, item IDs, existing grader | done | done | done | Importer reconstructs stable IDs from immutable artifact interpretation and invokes the existing School grading/progress paths |
| SC-13.13 | Relay authentication does not authorize client claims | done | done | done | Per-relay constant-time bearer authentication is composition-owned; authority-field and contradictory-header tests fail closed |
| SC-13.14 | Learner roster and progress projection endpoints/sync records | done | done | done | Stable SCU1 roster and SCG1 progress routes have ETags/bounds; combined sync returns both and charges their staging bytes |
| SC-13.15 | Delivery request learner/access claim is batch-atomic and replay-safe | done | done | done | SCD1 snapshots learnerKey; use case preflights bindings, duplicate conflicts, Catalog targets/grants, and the whole batch before compilation/save while persisted exact replay bypasses later retirement safely |
| SC-13.16 | Web Catalog sessions re-resolve authority and evidence context | done | done | done | Learner-scoped list/hydration and `OpenCatalogLearningSession` derive the published bank, mode, concept/area/classification/tags, reject client disagreement, and grade an immutable mounted snapshot; forged client curriculum context is ignored in focused/API tests |

## 14. TI-86 resource requirements

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-14.1 | Base budget uses 98,224-byte blank RAM and no archive | done | n/a | done | TI guidebook evidence recorded; physical calculator agrees |
| SC-14.2 | Core shell ≤9 KB and physical execution window | done | done | done | Build gates pass; current Z80 code is 7,903 bytes (7,980-byte `.86p`), leaving 1,313 bytes in the product ceiling and 1,497 bytes in the 9,400-byte execution window |
| SC-14.3 | One-Catalog state target/hard ceiling | done | done | done | One assigned Catalog opens directly at Subject; adapter targets `SCC1` at 3,272 bytes and caps it at 5,832 bytes, with two 124-byte `SCL1` slots plus overhead in the 6 KiB ceiling |
| SC-14.4 | Queue 4–6 KB | done | done | done | `SCQ1`, host durable queue, relay buffer, and cross-language contract share the 6,144-byte bound |
| SC-14.5 | Scratch/free reserve 9–12 KB | done | done | done | Sync preserves 9,600 bytes; SCN1 is capped at 4,096 transient bytes and preflight leaves 5,472 after variable overhead; low-memory tests pass |
| SC-14.6 | Standard runtime and downloadable-content budget | done | done | done | Ten-program contract: 60,736-byte planning target, 83,264 independent component ceiling, and 71,662 reserve-safe aggregate maximum. The 71,391-byte release is 10,655 above target, leaves 271 aggregate bytes and 5,391 content bytes after one-Catalog/learner/progress/interaction/QR-output targets, with every per-program bound enforced |
| SC-14.7 | Lesson target 8 KB, hard ceiling 12 KB | done | done | done | Compiler warning and hard-failure tests pass; relay independently rejects descriptors above 12,288 bytes |
| SC-14.8 | Check replacement working space; never partial overwrite | done | done | done | Planner preserves old content/reserve, relay publishes manifest last, host model exhausts every mutation-boundary power cut, and Z80 validates then performs backup-first commits |

## 15. Integrity, privacy, and failure behavior

| ID | Requirement item | Research/design | Code | Verification | Evidence / next gap |
| --- | --- | --- | --- | --- | --- |
| SC-15.1 | Checksums/digests detect corruption but do not authenticate | done | done | done | Every calculator record has CRC, artifacts have verified SHA-256 metadata, and separate relay bearer authentication is explicit/tested |
| SC-15.2 | Device ID identifies; relay credential authenticates | done | done | done | Provisioned opaque device identity and per-relay bearer credentials have separate use cases, records, middleware, and negative tests |
| SC-15.3 | Server resolves learner attribution; provenance repairable | done | done | done | Importer uses enrollment binding and immutable artifact provenance; School attempts retain repairable source identity and backend-received time basis |
| SC-15.4 | Bounded quiz/problem answer key supports offline scoring | done | done | done | Projection retains exactly one locally scoreable choice, TI runtime displays and queues the score, and backend verification rejects forged/stale local evidence |
| SC-15.5 | Visible/replayable QR is safe through opaque actions/idempotency | done | done | done | Results converge by device sequence/digest; lesson actions use opaque device-bound HMAC tokens, atomic meaning claims, repeatable low-risk policy, server revocation/version rotation, and current print/media controls; vertical replay/revocation tests pass |
| SC-15.6 | Power/APD/disconnect/restart/duplicate/native errors preserve data | done | partial | partial | State/sync/native models exhaust every durable mutation, including interrupted configuration/restoration; exact-Z80 and physical APD/native faults remain |
| SC-15.7 | Malformed artifact/result fails closed without partial attempts | done | done | done | Production hydration and staged commit fully validate records before display/mutation; importer validates authority/stable positions before claim or grading |
| SC-15.8 | Old artifact remains until replacement verified | done | done | done | Sync planner charges copy-on-write peak space; relay writes immutable staging first and DSSYNC last; host/Z80 commit recovery never selects a partial replacement |

## 16. v0 end-to-end acceptance

| ID | Acceptance item | Software state | Hardware state | Required evidence |
| --- | --- | --- | --- | --- |
| SC-16.1 | Enroll three physical TI-86s with distinct stable identities | done | hardware | Software enrollment/DSID/identify path and collision tests pass; provision and record the three-device fleet after battery remediation |
| SC-16.2 | Shared-jack Catalog fetch for any enrolled calculator | done | hardware | Reused-session native coverage fetches/stages A's then B's Catalog using their resolved identities and proves buffer reset; two-family application conformance isolates three calculators on one relay ID; physical sequential-plug proof remains |
| SC-16.3 | Browse/install/disconnect/reopen/remove lesson | partial | hardware | SCCAT walks the generic hierarchy and SCREQ commits install/remove/update intents; backend/relay/staged commit exist, while exact-binary disconnected execution remains |
| SC-16.4 | Notes/examples/flashcards/drill/quiz and power/app resume | partial | hardware | All five generic paths and same-artifact continuation build/source-test; owned-ROM behavioral tests plus calculator proof remain |
| SC-16.5 | Queue progress/results before local success | partial | hardware | SCQUEUE appends assessment responses and lesson/flashcard viewed/completed progress through Z80 DSQB→DSQ before success; execution/power-cut proof remains |
| SC-16.6 | QR then cable gives accepted+duplicate and two arrivals | done | hardware | Two-family three-device conformance proves one credited A result, QR+relay arrivals, independent same-number B/C results, and transaction-only ACKs; physical scan/sync remains |
| SC-16.7 | Cable ACK removes only accepted/duplicate queue records | done | hardware | Backend, relay, codec, and whole-batch deletion/power-cut tests pass; physical calculator confirmation remains |
| SC-16.8 | Native graph/calculator resumes exact continuation/settings | partial | hardware | Mapper/runtime semantic decoder, read-only SCNATIVE operations 1–6 guard, SCN1, exact continuation, pre-mutation tamper rejection, and exhaustive idempotent host restoration pass; implement Z80 snapshot/GDB/apply/restore/launch and run ROM-fleet tests |
| SC-16.9 | Unsupported/oversized/corrupt content preserves prior state | partial | hardware | Adapter/planner/relay/commit-model rejection tests pass; hydrated shell and physical corruption cases remain |
| SC-16.10 | All GUI/typography/icon/QR goldens validate and scan | partial | partial | Host goldens, V5 result oracle, V1 action oracle, and assembled full-frame source contracts pass; static QR scanned physically, exact dynamic/full-screen suite remains |
| SC-16.11 | Fake second-family codec passes shared application contracts | done | n/a | One unchanged lifecycle suite runs enrollment, identity, observation, Catalog, delivery, compilation, retrieval, QR/queue import, progress, ACK, and sync against TI-86 and `sim89` codecs |
| SC-16.12 | Optional BLE keyboard navigates and types through the ESP relay without network access | done | hardware | The software path is exact-address BLE HID → bounded raw reports → canonical translation/repeat → retained input queue → serialized remote-key or foreground ACK; direct-jack acceptance must cover navigation, repeat/modifiers, disconnect recovery, and simultaneous sync scheduling |

## 17. Explicit v0 exclusions

| ID | Excluded behavior | Boundary state | Verification |
| --- | --- | --- | --- |
| SC-17.1 | Commerce/store semantics | done | Static production-vocabulary contract test passes |
| SC-17.2 | Calculator IP stack or always-on socket | done | Architecture and relay-boundary review pass |
| SC-17.3 | Simultaneous calculators on one electrical port | done | Documented sequential lifecycle |
| SC-17.4 | Arbitrary downloaded TI-BASIC/assembly execution | done | Tool/custom schema negative tests reject source/code/assembly/BASIC/program-name fields; explicit artifact-section invariant remains |
| SC-17.5 | Silent dropping of unsupported/assessable content | done | Bundle/codec/Catalog negative tests fail closed and SCCAT presents/traverses reasons without an install path; execution evidence remains gated |
| SC-17.6 | Native-return correctness depending on ROM hook | done | Native bridge contract tests pending |
| SC-17.7 | Production TI-89 shell | done | The `sim89` full application conformance suite is the v0 proof; no TI-89 production code is planned |
| SC-17.8 | Every custom renderer before core v0 | done | Generic custom registry/capability compatibility exists; individual renderers remain incremental |

## 18. Refining-document coherence

| ID | Requirement item | State | Evidence / next gap |
| --- | --- | --- | --- |
| SC-18.1 | Architecture, contracts, packaging, GUI, native, runtime, relay/backend, and relay protocol agree | partial | Ten-program/two-group release, queues/sync/interactions, identity/learners/progress, time semantics, foreground arbitration, BLE HID input, TI native plans, read-only Z80 guard, and SCN1 recovery agree; capability promotion, native TI-OS mutation/launch, and physical proof remain |
| SC-18.2 | Research decisions cite primary/manufacturer evidence | partial | TI memory/link/battery/clock/OS/GDB/token/real-format evidence is recorded; exact TI-OS invocation and every fleet ROM remain named gates |
| SC-18.3 | Every implemented contract has a test or named hardware gate | partial | The delivery-ledger structural verifier now enforces groups/IDs/statuses/links; finish runtime/emulator and physical gates for incomplete slices |

## Current critical path

1. Freeze and execute the learner pilot protocol; author representative probes, and add the remaining adult intervention write/resolution loop before treating instructional signals as closed-loop.
2. Prove installed-runtime discovery and nested SCX1 calls in the owned-ROM emulator, then explicitly promote only the passing capabilities.
3. Extend the bounded read-only SCNATIVE guard with proven SCN1 snapshot/recovery and TI-OS adapters, then run owned-ROM GDB/apply/relaunch fault tests.
4. Bench-prove the configured BLE keyboard, ordered foreground delivery, reconnect behavior, and bulk-sync arbitration over the protected direct link.
5. Complete cross-component disconnected/fault conformance, including exact dynamic QR and queue recovery execution.
6. Execute the protected-interface, fresh-battery, QR, foreground-initiation, native-return, and three-calculator fleet hardware gates.
