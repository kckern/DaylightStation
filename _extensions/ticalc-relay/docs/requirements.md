# TI calculator relay requirements

> **Adaptive Study v1 scope:** Electrical, transport, immutable-artifact,
> result-uplink, and acknowledgement requirements remain applicable. Catalog,
> roster/progress, install/remove, and tutor workflows below are retained v0
> research rather than active learner routes. The canonical code-resolution
> and staged-prescription contract is
> [`../../ti86-app/docs/schoolcalc-v1-requirements.md`](../../ti86-app/docs/schoolcalc-v1-requirements.md).

Status: requirements locked, implementation in progress. Updated 2026-08-02.

This document records the agreed boundary between the TI calculator shell,
downloadable SchoolCalc content, the ESP32 relay, and the School backend.

## Four-part relay contract

The relay has four functional responsibilities. In every case, the
calculator talks to the relay over the TI link; the relay translates that
interaction into HTTP/WebSocket calls to the backend.

### 1. Catalog API: discover, refresh, and cache

The relay must provide the calculator with a compact, refreshable projection of
the available SchoolCalc catalog:

```text
catalog → subjects → courses → units → lessons → modules
```

It must be able to fetch catalog updates from the backend, transfer the
projection to the calculator, and retain a usable cached copy when the relay or
backend is temporarily offline. Catalog entries include compatibility and
installation state where relevant.

The same attached sync supplies a School-configured learner roster and compact
generic My Progress projection for every active configured learner. These are
replaceable offline read models, not relay-owned identity or grading state.

### 2. Artifact API: select and download learning content

After the learner selects a catalog item, the relay must obtain the associated
immutable lesson artifact from the backend and install it on the calculator.
The artifact is compiled into the target calculator data format (`SCP1` for
the initial TI-86 adapter) and transferred as a normal calculator data
variable, such as `DPxxxxxx`.

The transfer must validate identity, format, length, checksum, compatibility,
and calculator-side commit acknowledgement. A partial download must be
resumable or safely retried without destroying an already-installed artifact.

### 3. Uplink API: progress and results

The relay must retrieve calculator progress and completed result records,
upload them to the School backend, and return acknowledgements to the
calculator. Results are stored in the calculator's durable `DSQ` queue until
the server accepts or recognizes them as duplicates; only then may the relay
write `DSACK`.

QR is an optional alternate uplink for the same canonical result envelope:

```text
calculator result → DSQ → relay upload ─┐
                                        ├─ same backend importer
calculator result → QR scan ────────────┘
```

QR and relay delivery must therefore share device ID, sequence, payload
validation, digest, idempotency, and grading semantics.

### 4. Connected interaction API: adaptive remediation

When a configured generic follow-up requires a connection, the relay reads the
calculator's retained `DSTREQ`/`SCTQ` through the ordinary sync transaction and
returns the backend's bounded `SCTR` as staged `DSTNEW`. It does not interpret
tutor content, select a learner, grade a response, or delete/acknowledge the
request. The calculator accepts only an exact device/learner/request match.

F1–F5 may submit A–E remediation choices. A cable pull, missed heartbeat,
backend timeout, duplicate sync, or reset preserves the same request bytes and
request ID so the backend action claim and calculator promotion remain
idempotent. Offline lesson use, assessment scoring, result queueing, and QR
export never depend on this connected module.

## Locked requirements

### Product shape

1. The calculator receives one trusted, stable assembly shell, initially a
   TI-86 `.86p` program such as `SCHLCALC.86p`.
2. Curriculum is not delivered as executable `.86p` programs. Courses, units,
   lessons, examples, drills, and quizzes are downloadable data artifacts.
3. The shell provides an offline-capable browsable catalog, lesson selection,
   artifact installation, lesson execution, and result creation.
4. The catalog is data-driven and generic. It must not branch on subjects such
   as geography, chemistry, or math.
5. TI-89 support is a future calculator-family adapter, not a second SchoolCalc
   application or backend grading path.

### Pack and calculator storage

1. A backend lesson bundle is compiled by the calculator-family adapter into a
   deterministic, versioned binary data artifact. The current TI-86 codec
   encodes this as an `SCP1` envelope.
2. The calculator stores compiled lesson artifacts as ordinary TI variables
   named `DPxxxxxx`, never as executable programs.
3. `DSCAT` stores the compact Catalog projection; `DSID` stores the provisioned
   compact device ID; alternating `DSLOCAL0/1` stores shell-private state and is
   never relayed. `DSUSERS`/`DSPROG` are calculator-promoted canonical roster
   and progress projections; the relay writes only `DSUSRNEW`/`DSPRGNEW` stages.
   `DSTREQ` is the calculator-owned interaction uplink; `DSTURN` is its private
   committed response, and the relay writes only staged `DSTNEW`.
4. Every downloaded artifact includes an artifact ID, source lesson ID,
   format/version information, bounded lengths, and integrity validation.
5. The same artifact bytes must be reproducible from the same normalized lesson
   bundle and adapter version.
6. The shell must reject malformed, incompatible, truncated, or unrecognized
   artifacts. Server-supplied data must never be executable assembly.

### Relay download and transfer

1. The ESP32 relay downloads catalog manifests and immutable artifacts from the
   School API and transfers them to the calculator over the protected 2.5 mm
   TRS TI link.
2. The relay must use the TI link packet protocol; it must not stream raw SCP1
   bytes directly onto the cable.
3. Artifact transfer must support packet framing, checksums, acknowledgements,
   retries, interruption, and calculator-side commit confirmation.
4. The relay may stream artifacts in bounded chunks and need not hold a full
   artifact in RAM. It may cache artifacts for retry and repeated calculator
   connections.
5. A failed, interrupted, or disconnected transfer must not delete the prior
   calculator artifact or backend request.
6. The calculator's `DSQ` result queue remains authoritative until the backend
   returns `accepted` or `duplicate` and the calculator commits the matching
   staged acknowledgement.

### Learner identity, Catalog access, and progress

1. Every device has append-only stable 16-bit learner-key bindings. Active
   entries come from the generic School learner directory, which filters the
   household roster through `school.yml`; parents need not appear.
2. The calculator presents active configured learners plus synthetic Guest,
   remembers an explicit selection, and always permits switching later from
   settings when no session/result/delivery continuation is active.
3. Guest key zero is nonpersistent. A named learner's session, result, progress
   event, and delivery request snapshot that learner's key before profile
   changes can occur.
4. `SCC1` carries explicit positive learner-key and Guest grants at every
   hierarchy level. The calculator filters offline, and the backend rechecks
   current access before accepting a new install/remove intent.
5. `SCG1` projects generic My Progress summaries, recent scores, prioritized
   follow-ups, and a bounded evidence-backed curriculum-history tree for every
   active configured learner. It omits Guest; the history semantics are usable
   by any calculator-family adapter, frontend, or future surface, while the
   parent-index encoding and byte limits remain TI-86 adapter details.
6. Progress remains a School domain/read-model concept. TI-86 continuation,
   wire records, memory bounds, and promotion variables remain in adapters.
7. Only an actionable connected-remediation follow-up may open the tutor.
   Device, learner key, opaque action key, session/turn cursors, and 24-bit
   request ID are reauthorized on every exchange; Guest cannot create one.

### Transport awareness

1. Relay diagnostics distinguish raw line state/recent activity, foreground
   listener readiness, a negotiating session, a verified current-session peer,
   and unknown idle. Interface-level voltages vary when the jack is absent, so
   they never report `connected` solely from tip/ring levels.
2. Every sync phase reports direction (`negotiating`, calculator-to-relay,
   network, relay-to-calculator, or idle), current/total items when known, phase
   age, last verified-peer age, and `safe_to_unplug`.
3. The local LED mirrors direction: blue negotiating, cyan upload, yellow
   backend, purple download, green terminal success, and red terminal failure.
   LED state never replaces textual error/status diagnostics.
4. A queued or active operation says keep connected. Awaiting calculator-local
   commit and stopped/error states say safe to unplug because no further relay
   I/O is required.
5. TI-86 live progress requires a cooperative foreground session. Its `SCF1`
   frames use bounded lengths, monotonic per-session sequence numbers, and
   CRC-16; the relay foreground adapter implements the same
   `ICalculatorVariables` port as Silent Link so application/API behavior does
   not branch on transport ownership.
6. Silent Link remains a provisioning/recovery compatibility mode. While TI-OS
   owns that transfer, live progress is available on the relay rather than the
   SchoolCalc framebuffer; the calculator shows honest pre/post state.
7. When the protected-interface transmit gate and foreground-listener gate are
   enabled, the idle TI task accepts a calculator-originated `SCF1 HELLO`; the
   learner does not need a WebSocket command, HTTP pre-arm, or `LINK > RECV`.
   A queued Silent Link, screenshot, key, or explicit foreground operation owns
   the wire atomically and suppresses listener acceptance until it finishes.
8. During a tutor session, SCF1 ping/pong and verified-session/phase age provide
   connection awareness. Heartbeat loss becomes a visible retryable state; it
   never fabricates a tutor response or discards `DSTREQ`.

### Result identity and grading

1. A completed result is durably appended to `DSQ` before the calculator reports
   completion or displays its QR result.
2. The result identity is `{deviceId, sequence}`. Sequence values are
   device-global, monotonic, and never reused.
3. QR and relay delivery use the exact same result record and backend import
   path. Transport is arrival provenance, not grading identity.
4. The calculator computes and displays an immediate offline score from the
   bounded answer key in its immutable artifact. The backend resolves the
   snapshotted learner key and independently recomputes that score before it
   determines authoritative correctness, credit, rewards, or completion. The
   relay never grades or trusts the score.
5. Replaying the same identity and bytes is a duplicate; reusing the identity
   with different bytes is a conflict; neither creates duplicate credit.
6. The relay forwards exact `SCR1` bytes without adding or rewriting event
   time. The TI-86 has no RTC; the backend stamps each import arrival as
   `receivedAt`, while device sequence remains the ordering fact.
7. QR-first and later cable upload are two arrivals for one immutable result,
   never two attempts; acknowledgements may remove the offline queue only after
   accepted or byte-identical duplicate outcomes.

### Relay fleet behavior

1. WebSocket is the live fleet channel for presence, health heartbeats, and
   future sync commands. It reconnects automatically.
2. HTTP is the durable SchoolCalc API channel for manifests, artifact downloads,
   result import, and sync operations. Result submission remains idempotent
   across retries.
3. The local WebServer is the operational channel for `/health`, `/status`,
   manual sync, and bring-up diagnostics, independent of WebSocket state.
4. MQTT is not required for the first implementation. It may be added later as
   an adapter only if the wider fleet adopts a broker standard.
5. The TI link task must remain independent of WebSocket and HTTP loops so
   network activity cannot corrupt calculator bit timing.
6. HTTP endpoints in `backend/src/4_api` are the canonical catalog, artifact,
   request, result-import, and sync interface. WebSocket may notify the relay
   to sync, but it does not replace HTTP resource retrieval or acknowledgement.
7. Every attached job starts by reading and server-resolving that calculator's
   `DSID`; no device identity, optional-variable length, queue byte, desired
   state, or Catalog request may carry across jobs. Native session tests reuse
   the same session object and buffers for A then B, fetch each device's own
   Catalog, and prove omitted B inputs reset to zero length. Application
   conformance tests independently run A, B, and C through one relay identity.

### Operational observability

1. `/status` exposes current and cumulative evidence for Wi-Fi, backend HTTP,
   WebSocket/heartbeat, TI electrical/packet/session state, calculator variable
   I/O, BLE identity/security/liveness/reports, input delivery, heap headroom,
   and current faults. It never equates released lines with a verified peer.
2. Every accepted TI operation receives a monotonic local operation ID. Its
   session, calculator-variable, foreground-frame, electrical-fault, and
   backend HTTP events share that correlation so one transaction can be
   reconstructed end-to-end; Silent Link packet-class counters remain in
   `/status` without flooding the bounded journal.
3. A fixed allocation-free 48-event journal overwrites oldest entries, exposes
   monotonic sequence/overwrite counters, and supports `after`, `correlation`,
   `subsystem`, `min_severity`, and newest-matching `limit` filters.
4. Diagnostics never capture calculator payloads, learner/result/answer data,
   tokens, or passwords. Flash-time relay/keyboard identity, network endpoint,
   SSID, pin map, build identity, counters, sizes, statuses, and bounded error
   text are operational metadata and may be exposed on the trusted LAN.
5. A cable pull, Wi-Fi loss, HTTP failure, WebSocket loss, BLE disconnect,
   queue-full condition, or authentication failure leaves a named last error
   and counter/event evidence. The operator runbook maps each symptom to those
   fields and to a retry path that preserves durable calculator state.
6. The event journal is volatile diagnostic evidence, not an audit ledger.
   Durable learning results, requests, and acknowledgements remain in their
   SchoolCalc records and backend repositories.

### Optional input-device bridge

1. The relay supports a BLE HID QWERTY keyboard as an optional local input
   device; every required SchoolCalc workflow remains usable from the
   calculator keypad alone.
2. The ESP32 is the BLE HID host and translates keyboard events into a
   versioned calculator-family key map. For TI-86 OS screens this uses remote
   key command `0x87`; SchoolCalc foreground input uses the shell's cooperative
   relay-input path and canonical logical input queue.
3. Keyboard input is local and offline. It must not depend on Wi-Fi, the School
   API, or content-specific server logic.
4. The relay permits input only from an explicitly paired, bonded/allowlisted
   keyboard and reports its connection state through local status diagnostics.
5. TI link ownership is serialized: remote-key and sync packets are never
   interleaved. A bulk transfer may visibly pause or boundedly queue keyboard
   input, but may not silently lose, duplicate, or reorder it.
6. On an otherwise idle link, acknowledged key delivery targets 100 ms at the
   95th percentile. Correctness takes precedence over latency.
7. The physical USB Graph Link proof on 2026-08-01 successfully injected
   `1 + 1 ENTER` and produced `2`. Direct ESP electrical signaling, BLE HID,
   sync arbitration, and foreground shell input remain separate acceptance
   gates.

### Electrical safety

1. Tip/red and ring/white are 5 V open-collector calculator bus lines. Sleeve/
   black is common ground.
2. Each line has a high-impedance 5 V-to-3.3 V sense path and a separate
   open-drain/open-collector sink.
3. The ESP32 must never drive either calculator line high.
4. Sink gates/bases default to released during reset, boot, and power loss.
5. The actual M5 brick model and pinout must be verified before the default
   firmware pin map is treated as production wiring.

## Remaining open questions

These do not change the locked product boundary, but must be answered before
the corresponding implementation is declared complete.

1. The target board is the M5Stack ATOM Lite / ESP32-PICO-D4 used by the other
   relay devices. The final exposed GPIO selection and boot-state measurements
   still need hardware validation.
2. Will the TRS interface be a discrete 2N7002/BSS138 plus divider circuit, or
   a small level-shifter PCB/module? The chosen board needs measured VIH/VIL,
   bus capacitance, and reset behavior.
3. What authentication and TLS strategy is appropriate for a relay on the
   household LAN? The current bring-up image supports configurable HTTP API
   credentials but is not a production TLS design.
4. How much artifact retry cache should the relay retain in flash, and
   what wear-limiting strategy is required?
5. Which specialized interactive modules are required after the generic notes,
   examples, problems, flashcards, and quiz runtime is physically accepted?
6. What exact TI-89 link, memory, UI, and artifact constraints differ enough
    to require a separate adapter version?

The `SCP1`/TI-variable schemas, command set, Catalog projection, backend
accepted/duplicate/conflict/resume behavior, and memory bounds are now locked
and tested in software. They remain subject to the named owned-ROM and physical
cable acceptance gates, not open architectural decisions.

## First implementation slice

The next vertical slice is intentionally narrow:

1. Verify the hardware model and protected TRS wiring.
2. Implement TI wire-bit timing in a dedicated transport task.
3. Request and validate the read-only TI-86 screenshot packet.
4. Add golden packet fixtures and malformed/checksum tests.
5. Transfer one known non-executable test variable.
6. Define `SCP1` and transfer one artifact into `DPxxxxxx`.
7. Read one `DSQ` record, import it over HTTP, and write `DSACK` only after
   an idempotent backend acknowledgement.
