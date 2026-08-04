# SchoolCalc TI relay — locked v1 design

Status: approved design; backend and host-testable relay vertical slice
implemented, calculator shell and physical relay acceptance incomplete.
Updated 2026-08-02.

This is the single decision record for the first calculator learning system.
Detailed byte/API shapes are in [`v1-protocol.md`](./v1-protocol.md); backend
layer ownership is in [`backend-handoff.md`](./backend-handoff.md).

## Approved design

### 1. Product boundary

SchoolCalc is a generic, offline-capable calculator learning surface:

```text
catalog → subject → course → unit → lesson → modules → result
```

Subjects and curriculum are published data. The application may understand
standard modules (`lecture_notes`, `examples`, `problems`, `flashcards`, `quiz`
and registered tools), but it does not branch on a named subject.

The first client is TI-86. TI-89 is a future platform adapter using the same
SchoolCalc application, artifact identity, result ledger, and grading path.

### 2. Trusted shell; untrusted content data

`SCHLCALC.86p` is the stable trusted TI-86 assembly shell. It is installed only
through an intentional shell update path.

Curriculum is never delivered as assembly. A downloaded lesson is an immutable
`SCP1` data package in a calculator variable named `DPxxxxxx`. The shell
validates its version, lengths, checksum, compatibility, and format before use.
It never executes package bytes.

### 3. Authored content, compilation, and immutable storage

YAML is authored source content. File reading/parsing belongs in concrete
`1_adapters` repositories; the School domain validates parsed content but does
not read files.

The delivery path is fixed:

```text
YAML repository → validated neutral lesson bundle → family codec → immutable artifact
```

`BuildLearningLesson` is device-neutral application logic.
`Ti86SchoolCalcCodec.compile()` is family-specific adapter logic. Compilation
happens when an install request needs an artifact, then the artifact repository
stores it first-write-wins. Artifact GET returns the stored bytes; it never
recompiles from current YAML.

The server stores the immutable interpretation snapshot required to regrade
each artifact even after authored YAML changes. TI-86 `SCP1` also carries one
bounded correct-choice index per locally scoreable item so the disconnected
calculator can show an immediate score. That local answer key and score are
never accepted as authority; the backend independently regrades the same
responses against its immutable interpretation and rejects disagreement.

### 4. Four relay responsibilities

1. **Catalog/read models:** fetch the access-annotated Catalog plus configured
   learner roster and all-active-learner progress projection, then stage them
   so the calculator can browse, switch profiles, and inspect My Progress
   offline.
2. **Delivery:** read durable `DSREQ` install/remove requests, obtain immutable
   artifacts, and transfer named TI data variables.
3. **Uplink:** read append-only `DSQ` response/progress records, submit them,
   and write only safe server acknowledgements back as staged `DSACKNEW`.
4. **Connected interaction:** read one retained `DSTREQ`, exchange it through
   the same authenticated sync API, and stage one exactly correlated `DSTNEW`
   response without acknowledging or deleting the calculator's request.

The calculator only knows the direct TI link. The relay is the sole networked
client and holds the relay credential.

### 5. Canonical formats and directions

| Format | Direction | Calculator variable | Meaning |
|---|---|---|---|
| `SCI1` | backend → calculator | `DSID` | provisioned device identity |
| `SCI1` | calculator → backend | `DSINFO` | shell version, capability/memory/install report |
| `SCC1` | backend → calculator | `DSCAT` | compact catalog cache |
| `SCD1` | calculator → backend | `DSREQ` | install/remove requests |
| `SCU1` | backend → calculator | staged `DSUSRNEW` | active configured learners with stable device keys |
| `SCG1` | backend → calculator | staged `DSPRGNEW` | generic all-active-learner My Progress projection |
| `SCTQ` | calculator → backend | `DSTREQ` | one durable learner/request-bound follow-up or A–E action |
| `SCTR` | backend → calculator | staged `DSTNEW`, committed `DSTURN` | bounded client-safe tutor response |
| `SCP1` | backend → calculator | `DPxxxxxx` | immutable lesson package |
| `SCQ1` | calculator → backend | `DSQ` | exact queued `SCR1` records |
| `SCR1` | calculator → backend | inside `DSQ` or QR | immutable response/progress record |
| `SCA1` | backend → calculator | staged `DSACKNEW` | accepted/duplicate result sequences sealed into `DSSYNC` |
| `SCM1` | backend → calculator | `DSSYNC` | final transaction commit manifest |

Every format uses an adapter-owned versioned/checksummed envelope. `SCI1`,
`SCC1`, and `SCP1` use deterministic typed binary documents, not JSON.
`SCD1`, `SCU1`, `SCG1`, `SCQ1`, `SCA1`, `SCM1`, compact `SCR1`, `SCTQ`, and
`SCTR` use bounded
fixed layouts inside the same envelope. The TI link packet checksum is an additional transport check,
not a replacement for the payload checksum.

`DS1:DEMO:<score>` and `DS1:R:...` document prior QR experiments only. `SCR1`
is the sole production result format. QR renders its exact bytes as
`sch:r1:<BASE32>`.

### 6. Result, grading, and idempotency

The shell writes an immutable result to `DSQ` before success feedback or QR
rendering. The same `SCR1` bytes are sent via relay or camera scan.

The backend ledger identity is `{deviceId, sequence}` plus record digest:

| Incoming state | Outcome |
|---|---|
| unseen identity | grade and return `accepted` |
| same identity and digest | return `duplicate`; no second credit |
| same identity, different digest | return `conflict`; no credit |
| interrupted prior grading | return `resume`; append only missing attempts |

The calculator determines an immediate offline score from its bounded embedded
answer key; the relay never grades or trusts it. The backend remains
authoritative for correctness, learner attribution, reward, and completion: it
resolves the snapshotted device learner key and independently recomputes the
score. `DSACKNEW` only includes `accepted`/`duplicate`
sequences from the exact queue uploaded in that transaction. TI-86 v0 deletes
the queue only when that ordered ACK list covers the complete batch; a partial
ACK retains the complete queue for idempotent replay. Before any result import
side effect, the application decodes every queued record with the enrolled
family codec and verifies that every record belongs to the endpoint device. A
single foreign record rejects the whole batch before ledger claims, grading,
progress writes, or acknowledgements.

### 7. Network transport

HTTP routes in `backend/src/4_api` are authoritative for catalog retrieval,
artifact bytes, requests, progress, result import, and sync. This suits
request/response errors, cache validators, binary streaming, and durable
idempotent acknowledgement.

WebSocket is the live relay fleet channel: presence, health, and an optional
`sync-requested` notification. It never carries the only copy of an artifact or
result. The relay pulls HTTP state once a calculator is physically attached.

The relay's own LAN WebServer is operational only. Its read-only screenshot
probe lives at `/diagnostics/link/screenshot`; it is not exposed through the
SchoolCalc backend API and is not a calculator-family concept in application or
domain code.

MQTT is out of scope for v1. If the household fleet standardizes on a broker,
it may carry presence/notifications only; canonical artifact/result resources
remain HTTP.

### 8. Sync and failure behavior

One sync transaction resolves opaque `DSID`, observes `DSINFO`, imports `DSQ`,
claims `DSREQ`, exchanges optional retained `DSTREQ`, gets an outbound plan,
then stages the learner roster, compact progress projection, optional
request-correlated `DSTNEW`, Catalog, artifacts, and acknowledgements. It writes
`DSSYNC` last. Only a matching complete manifest
authorizes the shell to commit stages, remove old artifacts, or consume queue
records. It is safe to repeat after any cable pull, calculator reset, Wi-Fi
outage, or server reconnect.

The TI bit-handshake and packet layer runs in its own dedicated task; network
loops cannot block timing. Failed transfer never deletes an existing package,
pending delivery request, or `DSQ` result.

### 9. Transport awareness

Raw interface levels are diagnostic evidence, not peer identity: an absent
jack's sensed level depends on the divider/buffer topology, and released/high
only proves a usable idle bus. Before a handshake the UI says waiting/unknown;
after a current-session reply it says verified. The dedicated TI task arms a
foreground listener while idle and accepts the calculator's `SCF1 HELLO`
without manual pre-arming. Direction, item progress, phase age, and exactly one
of keep connected/safe to unplug are visible throughout the transaction. Silent
Link provides live state on the relay; cooperative `SCF1` foreground mode keeps
the calculator's Sync screen live. See
[`../../ti86-app/docs/transport-awareness.md`](../../ti86-app/docs/transport-awareness.md).

### 10. Electrical boundary

The 2.5 mm TRS link is 5 V open-collector:

```text
tip/red and ring/white → divider to ESP input + separate open-drain sink
sleeve/black            → common ground
```

The ESP32 never drives a calculator line high. Each sink defaults released
during boot, reset, or power loss. See [`wiring.md`](./wiring.md).

## Open questions and design gaps

These must be resolved before the corresponding subsystem can be called v1
complete. They do not reopen the approved architectural boundaries above.

| Priority | Gap / question | Needed decision or proof |
|---|---|---|
| Resolved | M5 target | M5Stack ATOM Lite / ESP32-PICO-D4 (`m5stack-atom` PlatformIO board), matching the existing relay fleet. |
| P0 | ATOM Lite GPIO verification | Verify the selected exposed GPIOs and their boot/reset state on the physical ATOM before treating the provisional relay pin map as production wiring. |
| P0 | TRS interface circuit | Choose and bench-test discrete MOSFET/divider versus a level-shifter PCB; measure logic levels, reset release, and bus timing/capacitance. |
| Partial | TI link transport | Bit handshake, packets, ACK echo-length handling, timeouts/retries, screenshot, String-variable read/write, relay phase observer, SCF1 frame codec/adapter, calculator-originated listener, and TI-86 foreground client are implemented and host/build tested; exact-Z80 and protected-circuit hardware proof remain. |
| Partial | TI variable container | TI-86 String type `0Ch` and silent read/write transaction are implemented; physical atomic/interruption behavior remains to be bench-proven. |
| Resolved | Result QR capacity | Exact SCR1 bytes use uppercase unpadded Base32 in a `sch:r1:` payload; the V9/M 61×61 profile, 238-choice bound, generated fixture, and physical camera scan are proven. |
| Resolved | Grading snapshot persistence | First-write-wins artifact persistence stores the exact server-only `school.calc.artifact-interpretation/v1` bundle alongside immutable bytes; result import requires it and GET never recompiles YAML. |
| Resolved | YAML repository layout | Configurable mounted Catalog/document/bank directories with generic YAML repositories; no authored content in backend source. |
| Resolved | Artifact/build persistence | Filesystem artifact/device/result/progress repositories with first-write-wins and revision/idempotency checks. |
| Resolved | Shared-relay device selection | Each job resolves the attached calculator's provisioned `DSID` before reading device state or constructing device URLs. Reused-session native tests prove A→B buffer reset and device-specific Catalog fetches; application conformance proves isolated A/B/C learner, desired-state, queue, and ACK namespaces on one relay ID. |
| P1 | API auth/TLS | Define relay credential lifecycle, LAN TLS policy, token rotation, and QR importer authorization/learner-selection policy. |
| Resolved | Catalog visibility | Config-driven assignments produce explicit `{learnerKeys, guest}` access at every hierarchy level; install sets intersect member grants, SCCAT filters locally by the switchable profile, and delivery reauthorizes before mutation. |
| Resolved | Variable-name collision | A same-name/different-installed-artifact plan is blocked before transfer; shell commit still needs physical acceptance proof. |
| Resolved | Memory and package limits | The adapter enforces 98,224 user bytes, per-program/reserve-safe aggregate client bounds, 10 KiB reserve, bounded state/queue/roster/progress/interaction buckets, 8 KiB artifact target, and 12 KiB artifact ceiling; sync still plans from reported free RAM. |
| Partial | `SCI1`/`SCC1`/`SCD1`/`SCU1`/`SCG1`/`SCP1`/`SCQ1`/`SCA1`/`SCM1`/`SCTQ`/`SCTR` implementation | Backend codecs, goldens, relay rejection/staging, Z80 identity/manifest/artifact/Catalog/roster/progress/interaction/ACK/queue validation, and atomic promotion/commit exist; owned-ROM and physical acceptance remain. Reportable events remain `SCR1`; `SCG1` is a server-to-calculator read model, not an `SCS1` event log. |
| Resolved | Progress semantics | Generic School progress is the durable cross-surface source; its evidence-backed curriculum-history tree never invents authored coverage. Device-local SCL1 is only continuation, SCR1 carries queued evidence, and SCG1 gives every active configured learner a fairly bounded overview/focus/inspector snapshot while Guest remains nonpersistent. |
| Resolved | Connected remediation | A config-driven offer resolves to retained SCTQ, backend device/learner/action authorization, idempotent adaptive tutor action, bounded SCTR, and DSTNEW→DSTURN recovery; protected-cable execution remains part of the physical transport gate. |
| P2 | Install/removal UX | Define user-visible pending/download/failed/full-memory states, removal confirmation, and how stale artifacts are collected. |
| P2 | Relay cache | Decide flash-cache size, eviction, checksum validation, and write-wear policy. Calculator `DSQ` remains the durable result source regardless. |
| P2 | TI-89 adapter | Research link, file, screen, memory, and UI differences before sharing a package format or transport assumptions. |

## Required verification before a real learner trial

1. Golden tests cover every envelope, malformed length/checksum, deterministic
   artifact bytes, bounded local answer keys plus independent backend regrading,
   result conflicts, and QR/cable duplicate imports.
2. Hardware tests prove safe idle line behavior before any packet is sent.
3. The screenshot exchange proves bidirectional TI transport without modifying
   calculator storage.
4. A test data variable proves transfer, readback, and interrupted retry.
5. One real `SCP1` lesson installs, parses, resumes, queues an `SCR1` result,
   imports exactly once, and receives a transaction-bound `DSACKNEW`/
   `DSSYNC` acknowledgement.
