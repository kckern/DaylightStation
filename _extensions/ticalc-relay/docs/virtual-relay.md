# Virtual TI-86 relay test harness specification

**Status:** implemented two-lane emulator/semantic acceptance harness.  
**Updated:** 2026-08-03  
**Applies to:** [`../firmware`](../firmware), [`../../ti86-app`](../../ti86-app),
and the SchoolCalc backend API.

Normative companion documents are the [relay v1 protocol](./v1-protocol.md),
[transport-awareness contract](../../ti86-app/docs/transport-awareness.md),
[calculator durable-storage contract](../../ti86-app/docs/durable-storage.md),
and [TI-86 emulator gate](../../ti86-app/docs/emulator-testing.md).

## 1. Purpose

This specification defines a **virtual ticalc-relay** test system. It must
prove the SchoolCalc relay transaction without an M5, protected interface
board, TI-86, physical 2.5 mm cable, household credentials, or LAN service.
Its test boundary begins once the calculator has durably created `DSREQ` or
`DSQ`; creating those records through the learner UI remains the responsibility
of the TI-86 application/runtime tests. A later MAME UI-preparation profile may
exercise that earlier boundary, but is not a prerequisite for this harness.

The virtual relay must make these product flows reproducible:

1. A learner requests a Catalog lesson/module and receives the planned real
   `SCP1` artifact plus the staged Catalog/install transaction.
2. A completed quiz or reportable progress event is forwarded as its exact
   queued `SCR1` bytes, is imported idempotently, and receives the matching
   acknowledgement needed to retire the local queue.
3. Learner roster and My Progress projections are staged by the relay and
   promoted only through the calculator-owned transaction.

The virtual relay is a test harness, not a second implementation. It must run
the existing production relay session core and use real TI-86 codec records; it
must not reproduce the transaction in JavaScript merely because that is easier
to test.

There are two intentional fidelity levels:

| Level | Name | What it proves | Default |
| --- | --- | --- | --- |
| 1 | Host virtual relay | Production C++ sync session, API contract, records, staging order, calculator reference commits, and fault recovery | required |
| 2 | TilEm wire relay | Exact `SCSYNC` Z80 plus production bit/packet transport over TilEm's raw virtual BlackLink | required |

Level 1 is the fast complete transaction regression loop. Level 2 uses TilEm
2's TI-86 core and raw BlackLink API to compile the production
`TiLinkTransport` and `TiForegroundFrameChannel`, then runs the exact
validated `SCSYNC.86p` at its normal RAM address. It starts from simulated
`ON`, validates ENTER/CLEAR matrix transitions, completes SCF1 negotiation,
and round-trips ordered phase/progress frames through the actual Z80 port-7
routine.

The owned SchoolCalc 1.4 ROM is accepted: MAME provisions its complete bundle
through Graph Link and launches it through TI-OS before the TilEm wire lane
uses the resulting execution/RAM checkpoint. TilEm cannot resume MAME's
TI-OS VAT helper state after that cross-emulator transfer, so the semantic
Level 1 lane remains the evidence for complete String-variable catalog,
artifact, quiz/progress, and staging flow. This is a simulator transfer
limitation, not a reason to require a 1.6 ROM. The runner never downloads,
stores, or reports ROM bytes.

Stock MAME still cannot serve this wire lane: its TI-86 driver marks port 7 as
TODO and reports TI-86 serial link as non-working. MAME remains useful for its
owned-ROM keyboard/UI gates only. Neither emulator lane is electrical proof;
the protected-cable hardware ladder remains mandatory.

## 2. Scope

### 2.1 Goals

The completed system shall:

- run deterministically with no network, ROM, hardware, credentials, or
  generated firmware `config.h` in its default mode;
- call `SchoolCalcRelaySession::run()` for every virtual sync and never bypass
  it by directly writing staged variables;
- generate semantic records with `Ti86SchoolCalcCodec` and the backend test
  composition, not handwritten mock envelopes;
- model the relay-visible TI String-variable boundary exactly, including
  missing, too-large, read-failed, and write-failed outcomes;
- cover the Catalog/artifact, quiz/result queue, reportable-progress, roster,
  and progress flows in section 8;
- reuse the existing calculator reference models for staged sync commit and
  roster/progress promotion rather than making a duplicate state model;
- inject faults by stable scenario ID and named operation ordinal, never by
  wall-clock timing;
- emit a redaction-safe trace; and
- keep an optional MAME run for the real TI-86 keyboard/UI path, without
  claiming that stock MAME tests port-7 traffic.

### 2.2 Non-goals

This work shall not:

- make a full ESP32, Wi-Fi radio, BLE stack, or M5 ATOM emulator the primary
  mechanism;
- claim divider voltage, MOSFET reset release, pull-up current, cable
  capacitance, radio scheduling, or noise tolerance from virtual results;
- change SchoolCalc schemas, backend behavior, calculator ABI, relay API, or
  electrical safety requirements;
- add another grader, artifact compiler, result importer, or calculator commit
  algorithm for tests;
- put TI-86 branches into School domain/application layers; or
- depend on a real server for deterministic regression tests.

## 3. Terms and invariants

| Term | Meaning |
| --- | --- |
| Virtual calculator | Host object implementing `ICalculatorVariables` over a map of TI variable names to exact record bytes. It is not the TI-86 shell. |
| Staging transaction | Relay work through `DSSYNC`: read allowed uplinks, call the API, write stages, and publish the final manifest. |
| Calculator commit | Client-owned operation that validates stages, selects alternating snapshots, applies a complete acknowledgement, repairs `DSINST`, removes retired artifacts, and deletes `DSSYNC` last. |
| Semantic fixture | Reproducible, valid backend/codec records with deterministic identities, content, outcomes, and expected calls. |
| Cut | A simulated disconnect, timeout, write error, or power loss after one named operation. |

These invariants are mandatory:

1. The session reads `DSID`, calls `identify` with its exact bytes, then reads
   required `DSINFO`. `identify` is the sole API call permitted before
   `DSINFO`; sync, Catalog/artifact fetches, and every write require valid
   `DSINFO`. Every run resolves the current `DSID`; no prior calculator
   identity, bytes, or plan can leak.
2. The relay reads only `DSID`, `DSINFO`, optional `DSINST`, `DSQ`, `DSREQ`,
   and `DSTREQ`. It writes only `DSUSRNEW`, `DSPRGNEW`, optional `DSTNEW`,
   `DSCATNEW`, planned `DPxxxxxx`, `DSACKNEW`, and `DSSYNC`.
3. The virtual relay must reject access to calculator-private variables,
   including `DSLOCAL0/1`, `DSCAT0/1`, `DSINST0/1`, `DSQB`, `DSREQB`,
   `DSUSERS`, `DSPROG`, and `DSTURN`.
4. The relay treats Catalogs, artifacts, roster/progress records, result
   records, acknowledgements, and manifests as opaque exact bytes. It validates
   the envelope, declared bounds, plan metadata, artifact locator, and the
   fetch length/SHA-256 promise, but never grades, selects a learner, or adds a
   clock to `SCR1`. An envelope-valid record with a wrong *inner* device or
   other identity checked by the relevant calculator commit can be staged and
   published by the current relay; that commit/promotion must reject it before
   a canonical mutation. The calculator has no learner-directory authority:
   an envelope-valid same-device roster/progress projection with an unauthorized
   but structurally valid learner key may be canonically promoted. Backend
   composition/router tests, not calculator tests, must prove that it is never
   produced for the device.
5. `DSSYNC` is strictly the final relay write. A failure before its completed
   write may leave stages but cannot authorize a calculator commit.
6. A `DSSYNC` write is not an installed-content success. Success requires the
   calculator-side commit and later committed `DSINST` observation.
7. Queue removal is authorized only if the acknowledgement covers the exact
   complete ordered `DSQ` batch. A partial acknowledgement preserves the
   original queue bytes exactly.
8. A released line is not a verified peer. Only a successful protocol exchange
   can establish current-session peer evidence in the wire lane.

## 4. Existing authorities to compose

| Concern | Authority | Requirement for this harness |
| --- | --- | --- |
| Relay session | `firmware/src/SchoolCalcRelaySession.{h,cpp}` | Execute it unmodified in both levels. |
| Relay record validation | `firmware/src/SchoolCalcWire.*` and `docs/v1-protocol.md` | Preserve names, bounds, envelope validation, and declared error states. |
| TI link transport | `firmware/src/TiLinkTransport.*` | Level 1 uses its variable-port boundary; Level 2 compiles this exact source with a host GPIO shim. |
| API contract | `ISchoolCalcApi`, `SchoolCalcHttpApi`, backend router/use cases | Use fixture adapters in hermetic tests and real router responses in API-backed tests. Do not create another API shape. |
| TI records | `backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs` | Generate `SCI1`, `SCC1`, `SCP1`, `SCQ1`, `SCR1`, `SCU1`, `SCG1`, `SCA1`, and `SCM1` bytes. |
| Content commit | `ti86-app/tools/lib/ti86-sync-commit.mjs` | Run after relay success to prove the calculator-owned content transaction. |
| Result delivery queue | `ti86-app/tools/lib/ti86-durable-queue.mjs` | `commitTi86StagedSync()` uses its complete-batch acknowledgement rule; assert `DSQ` is retained unless `SCA1` covers every sequence in order. |
| Roster/progress promotion | `ti86-app/tools/lib/ti86-profile-state.mjs` | Run independently to prove `DSUSRNEW` and `DSPRGNEW` promotion/recovery. |
| Request delivery queue | `ti86-app/tools/lib/ti86-delivery-queue.mjs` | Apply complete `SCM1.acknowledgedRequestIds` after content commit; preserve `DSREQ` byte-for-byte for partial/mismatched acknowledgement. |
| Exact calculator execution | `ti86-app/tools/ti86-mame-scenario-harness.mjs` | Reuse owned-ROM, digest-pinned release, provisioning, and output conventions. |

The production `SchoolCalcHttpApi` depends on Arduino/FreeRTOS. The host lane
therefore proves the production C++ transaction core, generated records, and
API contract, but must not claim to execute that concrete adapter until the
shared HTTP translator in section 10.2 exists. API-backed mode otherwise only
proves that fixture records are responses of the actual backend composition
rather than invented test data.

## 5. Proposed layout and commands

The `test/` and `tools/` paths are new test-only code. The two `src/` paths are
new shared production code extracted to make the HTTP translator and TI-link
adapter testable without changing their firmware behavior:

```text
_extensions/ticalc-relay/
├── docs/virtual-relay.md
└── firmware/
    ├── test/
    │   ├── virtual/
    │   │   ├── VirtualCalculator.{h,cpp}
    │   │   ├── VirtualRelayApi.{h,cpp}
    │   │   ├── VirtualRelayScenario.{h,cpp}
    │   │   └── test_virtual_relay.cpp
    │   ├── mame/
    │       ├── HostArduinoShim.{h,cpp}
    │       ├── MameBitSocketBridge.{h,cpp}
    │       ├── VirtualOpenDrainBus.{h,cpp}
    │       └── test_mame_wire_relay.cpp
    │   └── tilem/
    │       ├── TilemBlackLinkBridge.{h,cpp}
    │       ├── TilemHostArduinoShim.{h,cpp}
    │       ├── TilemSupport.cpp
    │       └── tilem_virtual_relay_main.cpp
    ├── src/
    │   ├── SchoolCalcHttpContract.{h,cpp}
    │   └── SchoolCalcTiLinkAdapters.{h,cpp}
    └── tools/
        ├── generate-virtual-relay-fixtures.mjs
        ├── test-virtual-relay.mjs
        ├── test-mame-wire-relay.mjs
        └── test-tilem-wire-relay.mjs
```

Default deterministic run:

```sh
node _extensions/ticalc-relay/firmware/tools/test-virtual-relay.mjs
```

Current implementation: this command is a hermetic composite happy-path lane.
It compiles and executes the unmodified `SchoolCalcRelaySession` with a virtual
TI variable boundary, byte-compares all six codec-generated uplinks and all
seven staged outputs, then invokes the existing calculator commit and delivery
queue reference models. It proves one Catalog artifact download plus exact quiz
and reportable-progress queue upload/retirement. The scenario/negative/cut/API
matrix below remains the implementation backlog; this command must not be
reported as satisfying that matrix by itself.

It must use a private `mkdtemp` workspace. It removes that workspace on
success. On failure it copies only a redaction-validated diagnostic subset to a
new private retained directory and reports that path; it then removes the
working workspace. It must not bind a normal development port or read household
configuration.

MAME keyboard-input run (not a wire test with stock MAME):

```sh
node _extensions/ti86-app/tools/ti86-mame-input-gate.mjs \
  --rom /secure/path/owned-ti86.rom \
  --program _extensions/ti86-app/dist/SCINFO.86p
```

The MAME input gate applies the existing ROM length/SHA-1 verification and
never copies the ROM into the repository, fixture directory, output trace, or
CI artifact. It must not be rebranded as evidence of working TI-86 port-7
traffic.

TilEm wire run (the required exact-data emulator lane):

```sh
TI86_ROM=/tmp/schoolcalc-ti86a.rom \
TILEM_SOURCE=/secure/path/tilem-2-source \
node _extensions/ticalc-relay/firmware/tools/test-tilem-wire-relay.mjs
```

The runner compiles the GPLv3-licensed TilEm core, pinned to Debian Salsa
revision `74bf2f4ef12bf0ac95e1af3666343528a5381f18`, into a private `mkdtemp`
workspace. TilEm source and the ROM are explicit external inputs; no
machine-specific default is used. It deletes the workspace unless
`--keep-temp` is explicit. TilEm source/output and ROM bytes are neither
checked in nor CI artifacts. This is a local test-execution boundary, not a
distribution or firmware-linking claim; distributing a combined executable
requires a separate GPLv3 licensing review. Its one fixture convenience is six
short TI-OS installer programs built from valid TI String containers; the
relay transaction itself uses the production C++ path and exact `SCSYNC`.

## 6. Level 1 design: host virtual relay

### 6.1 Composition

```text
fixture builder (Node; real codec + backend test composition)
       │ semantic records, plan, descriptors, expectations
       ▼
generated C++ scenario include in a private temp directory
       ▼
VirtualCalculator ─ ICalculatorVariables ─ SchoolCalcRelaySession ─ ISchoolCalcApi ─ VirtualRelayApi
       │
       └──── exact staged variables + trace ────► calculator reference commit/promotion models
```

The C++ binary links the same source set as the existing native relay tests,
including `SchoolCalcWire.cpp`, `SchoolCalcForegroundSession.cpp`,
`SchoolCalcTransportAwareness.cpp`, and `SchoolCalcRelaySession.cpp`.
`SchoolCalcRelaySession.cpp` is not copied, mocked, or replaced.

### 6.2 Fixture generation

`generate-virtual-relay-fixtures.mjs` is the only source of scenario bytes. It
shall:

1. create deterministic device IDs, learner bindings, Catalog/source content,
   desired/installed state, results, and clock values;
2. use `Ti86SchoolCalcCodec` to create every calculator record and artifact;
3. use the SchoolCalc backend test composition to obtain each combined-sync
   plan, acknowledgement, manifest, catalog, and artifact response; and
4. emit a generated C++ include with byte arrays, expected API calls,
   descriptor metadata, fault schedules, and digest-only assertions.

The include is generated into a temporary directory at test time. It is not a
checked-in source artifact. The test compiler receives that directory on its
include path; the runner deletes it in a `finally` path. The runner prints a
fixture-definition digest and record lengths/digests, not payloads.

Semantic scenarios may not use a string like `"SCC1"` as a fake Catalog or a
handwritten byte envelope. Tiny synthetic envelopes are limited to existing
unit tests whose assertion is explicitly only envelope behavior.

### 6.3 VirtualCalculator

`VirtualCalculator` implements the existing port:

```cpp
VariableReadStatus read(const char* name, MutableBytes& output) override;
bool write(const char* name, ByteView record) override;
const char* lastError() const override;
```

Its exact rules are:

- map canonical uppercase variable name to owned exact record bytes;
- return `Found`, `Missing`, `TooLarge`, or `Failed` exactly as the port
  contract states; do not change `output` on `TooLarge`/`Failed`;
- model each write outcome explicitly: `RejectedBeforePersist`,
  `PersistedThenTransportFailure`, and `AcknowledgedThenDisconnect`. The
  latter two replace same-name bytes before reporting failure/disconnect, so a
  failed session can still leave a completed `DSSYNC` write;
- record immutable operation metadata and expose the persisted outcome to the
  scenario assertions;
- replace same-name writes, matching TI Silent Link behavior;
- reject forbidden/private variable names and a mis-cased/non-TI name;
- match injected failures by stable operation ordinal, for example
  `write:DPABC234#1`, rather than race-prone timing; and
- expose state cloning/fingerprinting only outside an active relay run.

It works above the TI String container because that is the established
`ICalculatorVariables` boundary. String framing is tested in the transport
layer, especially Level 2.

### 6.4 VirtualRelayApi

`VirtualRelayApi` implements `ISchoolCalcApi`. It is a scripted adapter, not a
parallel backend. For every call it asserts and traces:

- exact `DSID` identity bytes received by `identify` and compact returned
  device/platform IDs;
- device ID plus exact bytes/absence of `DSINFO`, `DSINST`, `DSQ`, `DSREQ`, and
  `DSTREQ` in `SyncRequest`;
- generated `SyncPlan` and exact `SCA1`, `SCM1`, `SCU1`, `SCG1`, optional
  `SCTR` records; and
- Catalog/artifact request device ID, generation, descriptor, byte length, and
  SHA-256 digest.

It supports identity/sync rejection, malformed response, bad descriptor,
catalog/artifact failure, and observer/liveness failure. It makes no content,
grading, learner, or acknowledgement decision; the fixture builder/backend
composition does that.

### 6.5 Trace and redaction

Every scenario writes `virtual-relay-trace.json` under its temporary directory.
Schema: `school.calc.virtual-relay-trace/v1`.

```json
{
  "scenario": "VR-QUIZ-001",
  "fixtureDigest": "sha256:...",
  "outcome": { "ok": true, "state": "awaiting_calculator_commit" },
  "events": [
    { "ordinal": 1, "kind": "calculator_read", "name": "DSID", "length": 42 },
    { "ordinal": 2, "kind": "api_sync", "deviceId": "86A001" },
    { "ordinal": 3, "kind": "calculator_write", "name": "DSSYNC", "length": 188 }
  ]
}
```

Only names, lengths, SHA-256 digests, bounded state/error names, generated
test device IDs, and fault labels are permitted. Payload bytes/base64, tokens,
Wi-Fi values, real learner labels, questions, choices, responses, and Catalog
text are prohibited. The runner redaction-scans every retained trace, log,
screenshot, core dump, and artifact against this allowlist before retention;
the scenario fails if a scan fails. `--keep-artifacts` retains only that scanned
diagnostic subset, never the working directory.

## 7. Calculator-owned completion simulation

The relay correctly ends at `AwaitingCalculatorCommit`; it must not simulate a
completed install itself. After a successful staging run, the Node harness
copies the exact variable map and:

1. runs `commitTi86StagedSync()` for a ready manifest and asserts selected
   Catalog/install snapshots, `DSINST`, installed artifact set, exact complete
   `DSQ` acknowledgement via `acknowledgeTi86QueueBatch()`, and stage cleanup;
2. after a successful content commit, runs
   `acknowledgeTi86DeliveryQueueBatch()` from `ti86-delivery-queue.mjs`.
   It retires `DSREQ` only when `SCM1.acknowledgedRequestIds` exactly equals the
   complete ordered request batch. A partial, reordered, or mismatched list
   preserves `DSREQ` byte-for-byte;
3. runs `promoteTi86LearnerRoster()` and
   `promoteTi86ProgressProjection()` independently, proving canonical copies
   change only after a valid device-bound stage and the stage is deleted last;
4. injects an interruption after every mutation of these existing reference
   models, recovers/retries, and compares the result to the clean final map
   fingerprint. For `DSREQ`, apply every
   `ti86DeliveryCommitStages()` prefix and use `recoverTi86DeliveryQueue()`;
   this includes both content-then-acknowledgement cuts and must converge
   without losing an unacknowledged request.

These models are host-contract evidence only, not a claim that assembled Z80
has executed. Level 2 and the physical test gate provide stronger evidence.

## 8. Required scenario catalog

### 8.1 Product flows

| ID | Scenario | Required evidence |
| --- | --- | --- |
| `VR-CAT-001` | **Catalog module download.** Valid device has old installed state and a durable `DSREQ` for one accessible module; sync plans changed Catalog plus one real `SCP1`. | Only allowed uplinks are read. The parametric order is `DSUSRNEW`, `DSPRGNEW`, optional `DSTNEW`, optional `DSCATNEW`, each planned `DPxxxxxx` in plan order, `DSACKNEW`, then `DSSYNC`. Commit selects the new Catalog/install snapshot and preserves old artifact until the commit point; the complete acknowledged request list retires that one `DSREQ` only after content commit. |
| `VR-CAT-002` | **No content delta.** Valid device has no requested new artifact. | No Catalog/artifact fetch/write occurs; valid roster/progress/ACK/manifest stages are still written. Existing content remains byte-identical after commit. |
| `VR-CAT-003` | **Replacement/removal.** Existing artifact is replaced by a distinct planned artifact. | Manifest has complete post-commit installed set. New `SCP1` is verified before old variable removal; every cut converges or preserves old set. |
| `VR-PROG-001` | **Quiz upload refreshes progress.** `DSQ` holds exact valid quiz `SCR1`; backend accepts and returns changed `SCG1`. | Backend receives exact `SCQ1`/`SCR1`; matching `SCA1`/`SCM1` stage; complete ACK removes `DSQ` only in commit; progress promotion replaces `DSPROG` and selected learner gets expected bounded projection. |
| `VR-PROG-002` | **Reportable progress upload.** `DSQ` holds `SCR1 kind: progress`. | Uses the identical queue/import/ACK path, has no quiz-only relay branch, and does not derive client wall time. |
| `VR-QUIZ-001` | **QR-first, cable-later duplicate.** Ledger already accepted exact record by QR. | Cable import is duplicate rather than new credit, stages a full-batch ACK, and cleans queue only after calculator commit. Exact result bytes/digest are unchanged. |
| `VR-QUIZ-002` | **Retry after backend acceptance but failed relay write.** Backend accepts/grades first exact `SCR1`, then a later relay write fails; second sync retries. | Capture first-run ledger/grader/progress effects. Retry submits byte-identical `SCQ1`/`SCR1` and is duplicate/resume as the backend contract specifies. Across both runs there is exactly one credit and progress mutation, delivery order behaves as specified, and `DSQ` is removed only after a full ACK is committed. |
| `VR-PROG-003` | **Reportable-progress retry.** Backend accepts first exact progress `SCR1`, then staging fails and sync is retried. | Same byte identity and exactly-once evidence as `VR-QUIZ-002`: one reportable-progress mutation total and no queue deletion before the full ACK commit. |
| `VR-DEV-001` | **Sequential calculators.** Run A then B using same session/buffers; B omits A inputs. | B identity, Catalog, and calls are isolated; omitted fields are zero length; no A bytes/plan/artifact leak. |

### 8.2 Integrity and negative flows

| ID | Fault | Required evidence |
| --- | --- | --- |
| `VR-NEG-001` | missing/corrupt `DSID` or `DSINFO` | Bad/missing `DSID`: no API call or write. Bad/missing `DSINFO`: exact `identify` has occurred, but no sync/fetch/write occurs. |
| `VR-NEG-002` | malformed/oversized optional `DSINST`, `DSQ`, `DSREQ`, `DSTREQ` | Exact `identify` has occurred; no sync/fetch/write occurs; expected `SessionError`; previous state unchanged. |
| `VR-NEG-003` | queue contains foreign-device `SCR1` | Backend rejects whole batch before ledger/grading/progress side effects; no authorizing ACK. |
| `VR-NEG-004` | malformed/oversized plan, ACK, manifest, roster, progress, or interaction envelope | Relay rejects transport/envelope/bounds failures before calculator write. |
| `VR-SEM-001` | envelope-valid record with a wrong device ID or another identity the relevant commit validates | Current relay may stage/publish opaque bytes. The calculator commit/promotion rejects those device-bound/validated semantics before canonical state changes. Tests must not assert a relay pre-write rejection that production does not implement. |
| `VR-SEM-002` | same-device roster/progress projection with an unauthorized but structurally valid learner key | The calculator has no learner-directory oracle and may promote it. Backend composition/router negative tests must show it is rejected or never emitted for the device before relay staging; this is not a calculator semantic-rejection assertion. |
| `VR-NEG-005` | Catalog/artifact bad CRC, wrong locator/name, over ceiling, or fetch length/SHA-256 promise violation | `DSSYNC` absent; old committed state/queue retained. Earlier stages may exist but never become authorized. A digest mismatch is a session failure only when `ISchoolCalcApi::fetchArtifact` fulfills its specified length/SHA-256 verification promise. |
| `VR-NEG-006` | blocked plan | No Catalog/artifact fetch. Diagnostic ACK/manifest stages allowed; calculator commit rejects blocked plan without content/queue mutation. |
| `VR-NEG-007` | partial/mismatched ACK | Commit keeps entire `DSQ` byte-for-byte. |
| `VR-NEG-008` | same sequence, different bytes | Backend returns conflict/no ACK; no second credit; queue remains. |
| `VR-NEG-009` | foreign roster/progress stage | Promotion rejects before changing `DSUSERS`/`DSPROG`. |
| `VR-NEG-010` | partial, reordered, or mismatched `SCM1.acknowledgedRequestIds` | Content commit may finish, but delivery-queue acknowledgement preserves the complete `DSREQ` bytes. Recovery/retry may retire it only after an exact complete ordered list. |

### 8.3 Cut matrix

The cut matrix is data-driven: inject every applicable fault at every actual
operation occurrence in the generated plan (read, API call, fetch, and write),
including each optional `DSTNEW`/`DSCATNEW` and each of zero through eight
artifact writes. `RejectedBeforePersist`, `PersistedThenTransportFailure`, and
`AcknowledgedThenDisconnect` apply to each write. It is not a fixed twelve-case
list.

For each prefix, assert:

- no relay mutation changed calculator-owned canonical Catalog/install/roster/
  progress variables or removed an old artifact/queue record;
- `DSSYNC` is absent for `RejectedBeforePersist`, but may be present for
  `PersistedThenTransportFailure` or `AcknowledgedThenDisconnect`; subsequent
  calculator commit/retry must remain safe in all three cases;
- retry reaches clean staged state or returns explicit configured failure, never
  a mixed manifest; and
- in Level 2, both sink outputs finish released.

`VR-COMMIT-001` applies existing staged-sync commit interruption coverage.
`VR-PROMOTE-001` and `VR-PROMOTE-002` apply roster and progress promotion
interruption coverage. They use existing interruption classes rather than
recreating a mutation schedule.

## 9. Level 2 design: TilEm wire relay

### 9.1 Topology and execution boundary

TilEm 2 implements the TI-86 CPU, keypad matrix, TI-OS ROM, and raw BlackLink
port. The harness warms TI-OS with a simulated `ON` keypress, then MAME
provisions the complete release and six generated fixture Strings over virtual
Graph Link and launches ASCHL/SCSYNC through TI-OS. TilEm restores that checked
point and re-enters SCSYNC after its already-rendered UI status calls, which
avoids an unsafe return through a foreign emulator's TI-OS executor. This runs
the exact foreground port-7 code and a production frame peer; MAME remains the
separate launch/navigation proof. It does not emulate `SCSYNC` in JavaScript.

```text
TilEm TI-86 / exact SCSYNC
       │ BlackLink low-line masks
       ▼
TilemBlackLinkBridge ─ TilemHostArduinoShim
                                  │
                    TiLinkTransport.cpp (unchanged)
                                  │
          TiForegroundFrameChannel -> raw phase/progress peer
```

TilEm returns electrically high bits; the bridge converts them once into the
same asserted-low masks used by the relay's open-drain GPIO contract. The CPU
runs in one thread and the production transport busy-waits in the other. The
only shared state is atomic per-line low masks; any peer assertion is therefore
visible without a simulated high drive. Production edge and packet timeouts
remain enabled.

### 9.2 ROM and dependency gates

The runner takes `TI86_ROM` and `TILEM_SOURCE` as explicit external paths. It verifies
the ROM against the existing known TI-86 digest registry and validates the
exact `SCSYNC.86p` container before compilation/execution. It builds only the
TilEm GPLv3 core at Debian Salsa revision
`74bf2f4ef12bf0ac95e1af3666343528a5381f18` in a private temporary directory
and provides a small local allocation/logging shim; neither TilEm source nor
ROM bytes enter this repository or a CI artifact.

The application uses historic TI-OS helper addresses, so an emulator boot is
not sufficient evidence. The harness therefore requires MAME Graph Link
provisioning and the TI-OS launcher/UI sequence, followed by a raw TilEm
SCSYNC wire exchange. The owned v1.4 ROM passes those paths; its only retained
limitation is TilEm's inability to resume MAME's VAT helper state for a full
cross-emulator String-variable service transaction.

### 9.3 Required wire scenario

`test-tilem-wire-relay.mjs` has one dense deterministic scenario:

1. `ON` wakes TI-OS and actual `ENTER`/`CLEAR` press-release events must pull
   then release their selected TilEm keypad-matrix bits; failure to activate
   the LCD or restore a matrix bit fails keyboard evidence. This is keypad
   injection evidence, not a TI-OS menu-navigation claim.
2. MAME virtual Graph Link persists the complete release plus valid `DSID`,
   `DSINFO`, `DSINST`, `DSQ`, `DSREQ`, and `DSTREQ` Strings, then the real
   TI-OS ASCHL sequence reaches SCSYNC.
3. Exact `SCSYNC` emits/accepts the `SCF1` HELLO through the production
   packet transport.
4. Exact SCSYNC round-trips two ordered relay phase/progress frames and their
   ACKs over the production packet transport.
5. The same command runs the hermetic unmodified relay session, which
   byte-compares all six fixture uplinks, decodes quiz/progress `SCR1` records,
   fetches one Catalog (`SCC1`) and artifact (`SCP1`), and stages
   `DSUSRNEW`, `DSPRGNEW`, `DSTNEW`, `DSCATNEW`, `DP7L3CWY`, `DSACKNEW`, and
   `DSSYNC` in production order.
6. The report requires calculator and relay line transitions, two phase ACKs,
   and keyboard transitions.

This is a transport/session gate, not the calculator-owned post-return commit
gate. Existing durable-queue and staged-sync tests retain responsibility for
verifying DSQ/DSREQ retirement and canonical promotion after the shell returns.

## 10. API-backed fixture and HTTP translator conformance

Default host mode is hermetic. `test-virtual-relay.mjs --api-backed` adds a
private backend router/app fixture without normal dev ports or household data:

1. Create generated test relay credentials/identity.
2. Call identify, combined sync, Catalog, and artifact HTTP routes through
   actual request/response shapes.
3. Capture returned record bytes/descriptors/headers into a fixture.
4. Run identical C++ host scenario and calculator reference models.

This proves backend accepts virtual calculator records and that the relay core
accepts backend-derived responses. It does **not**, by itself, prove
`SchoolCalcHttpApi`'s ArduinoJson parsing, base64url decode, or HTTP header
translation. It does not replace hermetic mode, whose full fault matrix is
required on every change.

### 10.2 Shared production HTTP translator

Before this specification may claim concrete HTTP-adapter compatibility, move
the response and request translation that is currently buried in
`SchoolCalcHttpApi` into host-compilable production source
`SchoolCalcHttpContract.{h,cpp}`. It shall accept framework-neutral complete
HTTP response body/header values and produce the same typed identify, plan,
Catalog, and artifact responses used by `SchoolCalcHttpApi`; the production
adapter must delegate to it rather than duplicate it. A small request builder
in the same shared source must compose the authorization and required request
headers used by the production adapter.

The native conformance test feeds this shared translator the exact private
router captures, and independently checks every concrete field and header:
status mapping, JSON/base64url field names and decoding, device/plan fields,
record bytes, Catalog generation, artifact locator/name/length/SHA-256, and
authorization/request headers. It includes malformed/missing/duplicate field
and bad header cases. This is the only basis for the stronger concrete-adapter
claim in acceptance criterion 6; the ESP build still covers the framework I/O
shell.

## 11. Fault, observability, and cleanup requirements

Required fault classes:

| Layer | Required faults |
| --- | --- |
| Variable port | missing, too-large, corruption, read failure, rejected-before-persist, persisted-then-transport-failure, acknowledged-then-disconnect |
| API/session | identify/sync reject, malformed plan, descriptor/catalog/artifact error, liveness loss |
| Backend semantics | foreign queue, exact duplicate, sequence conflict, partial ACK, blocked plan, cross-device projection |
| Calculator commit | every existing reference-model durable mutation cut |
| Wire | edge/packet timeout, checksum retry, stuck line, one-side release, disconnect at frame/chunk boundary |

Each successful trace must include expected relay state progression from
`ReadingIdentity` through `Synchronizing`, each applicable staging state,
`PublishingManifest`, and `AwaitingCalculatorCommit`. It must show applicable
Calculator-to-Relay, Network, and Relay-to-Calculator directions. Each failure
names final `SessionError`, last operation, fault target, and whether the final
write persisted.

Every runner exits nonzero on assertion failure and terminates child
server/MAME/PTY processes. Failure output includes scenario ID, phase, operation
ordinal, last state, and retained trace path. No retained artifact contains
protected payload or secret data.

## 12. CI policy and implementation sequence

| Lane | Gate | Inputs |
| --- | --- | --- |
| Existing relay native tests | required | C++ compiler and Node |
| Host virtual relay | required | C++ compiler and Node; no network |
| API-backed virtual relay | integration required | private test app/data; generated test credentials |
| TilEm wire relay | promotion gate for raw foreground frames | TilEm 2 source and the owned TI-OS 1.4 ROM |
| Protected-cable ladder | hardware release gate | actual M5/interface/TI-86 with healthy batteries |

Implementation order:

1. Fixture generator, virtual calculator/API, trace writer, and `VR-CAT-001`.
2. All core product flows and calculator reference commit/promotion integration.
3. Every negative/cut scenario.
4. API-backed fixture mode and the shared production HTTP translator
   conformance test.
5. Extract production TI-link adapters; then TilEm BlackLink raw-frame
   scenario with the owned TI-OS 1.4 ROM.

No increment relaxes a hardware gate or advertises foreground capability.

## 13. Acceptance criteria

Implementation is complete only when evidence proves all of the following:

1. Default host command executes production C++ session core with semantic
   codec/backend-generated records and no ROM, hardware, network, credentials,
   or firmware config.
2. `VR-CAT-001`, `VR-PROG-001`, and `VR-QUIZ-001` prove Catalog module download,
   progress update, and quiz upload/duplicate behavior.
3. Successful staging has parametric documented write order and `DSSYNC` last;
   a pre-persist failure proves its absence, while persisted-but-reported-failed
   `DSSYNC` cases prove commit/retry safety.
4. Calculator reference models prove all-or-nothing `DSQ` ACK and complete
   ordered `DSREQ` retirement behavior, content commit recovery, roster
   promotion, and progress promotion across every cut.
5. Negative scenarios distinguish relay transport/envelope rejection from
   calculator semantic rejection; neither permits an invalid canonical mutation
   or loses an old queue/artifact. Retry scenarios prove one backend credit or
   reportable-progress mutation despite backend-before-write failure.
6. API-backed mode proves backend-derived record compatibility; the shared
   production HTTP translator conformance test proves concrete router
   record/header translation.
7. MAME is restricted to the explicit TI-86 keyboard/UI gate. Stock MAME
   `bitsock` is an expected blocker for port 7 and is never a wire pass lane.
   Level 1 is never represented as exact Z80 evidence.
8. Current native relay, TI-86 record/commit, and relevant backend suites pass;
   test artifacts meet redaction/cleanup rules.
9. Physical safety/testing requirements in companion documents remain explicit
   and unmodified.

## 14. Review and approval

Before implementation begins, an independent Sol review must:

1. compare this document with current relay, TI-86, and backend contracts;
2. provide concrete findings on omissions, invalid assumptions, safety, and
   testability;
3. have every actionable finding addressed in this document; and
4. explicitly approve the revised specification.

| Reviewer | Review state | Findings addressed | Approval |
| --- | --- | --- | --- |
| Sol | approved | Initial and follow-up findings incorporated on 2026-08-03 | approved 2026-08-03 |
