# SchoolCalc relay protocol v1

> **Product-scope update:** The transport envelope, TI packet handling, SCF1
> foreground framing, CRC rules, result queue, acknowledgements, and write-last
> commit behavior remain infrastructure for SchoolCalc Adaptive Study v1. The
> canonical product contract is
> [`../../ti86-app/docs/schoolcalc-v1-requirements.md`](../../ti86-app/docs/schoolcalc-v1-requirements.md).
> Its `DSENTRY`/`SCE1`, `DSSTUDY`/`SCSP`, `DSSTDNEW`, and compact adaptive-result
> additions supersede the learner-facing `DSCODE`/Catalog/profile route here.
> Existing record tables describe the implemented v0 transport baseline until
> the adaptive codecs are added; they must not be read as the default v1
> installation manifest.

Status: backend, Silent Link transaction, calculator commit, awareness model,
foreground codec/adapters, TI-86 client, and calculator-initiated listener
implemented; exact-Z80 and physical cable transaction still require proof.
Updated 2026-08-02.

This document is the concrete boundary shared by the SchoolCalc application,
calculator-family codec, ESP relay, and TI-86 shell. The relay transports
calculator records but never interprets curriculum, results, or grading data.

## Layered wire formats

Three independent integrity layers are intentionally nested:

1. The SchoolCalc record has a family-specific magic, version, declared
   payload length, and CRC-16/CCITT-FALSE.
2. A TI-86 String variable adds its own two-byte string length.
3. The TI link packet adds a command length and 16-bit additive checksum.

Relayed TI-86 records use this outer envelope:

```text
magic (4 ASCII) | codecVersion (u8 = 1) | payloadLength (u16 LE) |
payload bytes | CRC-16/CCITT-FALSE (u16 LE)
```

`SCI1`, `SCC1`, and `SCP1` use a typed payload document. It is not JSON:
it supports null, booleans, signed 32-bit integers, float64, interned UTF-8
strings, arrays, maps, and byte strings. Mapping keys are sorted and repeated
strings share a table, so equal normalized input produces equal bytes.

`SCD1`, `SCU1`, `SCG1`, `SCQ1`, `SCA1`, `SCM1`, `SCR1`, `SCTQ`, and `SCTR` instead use
bounded fixed-layout payloads.
Those layouts make the calculator's mutation, recovery, and validation paths
small enough to implement and audit directly in Z80 assembly.

`SCR1` is a purpose-built compact result encoding because a result must also
fit the TI-86 QR profile. QR renders the exact record bytes as:

```text
sch:r1:<RFC 4648 BASE32 without padding>
```

The cable carries those same `SCR1` bytes inside `SCQ1`; QR and cable therefore
share identity, validation, grading, and idempotency.

A response `SCR1` contains the snapshotted positive learner key and the TI's
bounded-answer-key score `{correct,total,percent}`. That makes the disconnected
result useful before upload; it does not make the claim authoritative. The
backend resolves the key through historical device bindings, independently
regrades against the immutable artifact interpretation, and rejects mismatched
score evidence before credit or acknowledgement. Guest key zero is never
persisted in `SCR1`.

`SCR1` v1 contains no wall-clock field. The TI-86 backup battery preserves RAM
but does not provide an RTC; a 200 Hz interrupt is useful only for relative
foreground timing. The relay must transport the record byte-for-byte and must
not substitute its own uptime, NTP clock, or HTTP time. The backend assigns a
separate `receivedAt` to every import observation. Exact device-local order is
the 24-bit result sequence. See
[`../../ti86-app/docs/time-model.md`](../../ti86-app/docs/time-model.md).

## Calculator variables

All records are stored as ordinary TI-86 String variables (type `0Ch`). Lesson
content is data, never executable assembly.

| Variable | Magic | Direction | Purpose |
|---|---:|---|---|
| `DSID` | `SCI1` | server → calculator | provisioned opaque device-identity record |
| `DSINFO` | `SCI1` | calculator → server | shell version, gated capabilities, SCX1 integrity mask, free bytes, installed artifact IDs |
| `DSCAT` | `SCC1` | server → calculator | committed offline Catalog projection |
| `DSINST` | `SCM1` | calculator → server | repairable relay-facing copy of complete committed install state |
| `DSREQ` | `SCD1` | calculator → server | durable install/remove intents |
| `DSUSERS` | `SCU1` | client-private | committed configured learner roster; Guest is synthesized as key zero |
| `DSUSRNEW` | `SCU1` | server → calculator | staged complete learner-roster replacement |
| `DSPROG` | `SCG1` | client-private | committed all-active-learner My Progress projection |
| `DSPRGNEW` | `SCG1` | server → calculator | staged complete progress replacement |
| `DSTREQ` | `SCTQ` | calculator → server | one durable learner-scoped interaction request retained for exact retry |
| `DSTURN` | `SCTR` | client-private | last validated interaction response/current tutor turn |
| `DSTNEW` | `SCTR` | server → calculator | staged interaction response awaiting exact request-bound promotion |
| `DPxxxxxx` | `SCP1` | server → calculator | immutable compiled lesson artifact |
| `DSQ` | `SCQ1` | calculator → server | exact ordered `SCR1` result/progress records |
| `DSLOCAL0` | `SCL1` | client-private | alternating continuation-state slot 0 |
| `DSLOCAL1` | `SCL1` | client-private | alternating continuation-state slot 1 |
| `DSQB` | `SCQ1` | client-private | verified next result/progress queue during replacement |
| `DSREQB` | `SCD1` | client-private | verified next delivery-request queue during replacement |
| `DSCAT0/1` | `SCC1` | shell-private | alternating committed Catalog snapshots |
| `DSINST0/1` | `SCM1` | shell-private | alternating committed install snapshots |
| `DSCATNEW` | `SCC1` | relay → calculator | staged Catalog replacement |
| `DSACKNEW` | `SCA1` | relay → calculator | staged acknowledgements |
| `DSSYNC` | `SCM1` | relay → calculator | final commit manifest and transaction marker |

For an artifact ID `sc:ti86:KKKKKKKKKK`, its v0 variable name is exactly
`DPKKKKKK`. The ten key characters and the six locator characters use uppercase
base32 (`A`–`Z`, `2`–`7`). Backend and calculator validators reject a manifest
whose name is not derived from its key.

`SCI1` intentionally has two schemas. `DSID` contains
`school.calc.device-identity/v1`; `DSINFO` contains
`school.calc.device-info/v1`. The backend codec—not the relay—distinguishes
them.

`DSINFO.runtimeModuleMask` is a required non-negative `int32`; only bits 0–8
are defined. They correspond in order to `SCLEARN`, `SCQR`, `SCCAT`, `SCREQ`,
`SCQUEUE`, `SCSYNC`, `SCNATIVE`, `SCPROF`, and `SCTUTOR`. Before publishing
DSINFO, the shell independently validates each
installed Program wrapper, fixed SCX1 header and registry code, program-specific
ceiling, declared length, reserved bytes, and payload CRC. A missing or damaged
program clears only its bit. The relay transports this field without mapping
it. The TI-86 adapter owns the bit-to-portable-capability mapping, and that
mapping remains promotion-disabled until emulator and fleet recovery gates
pass; DSINFO cannot directly claim unapproved runtime capabilities.

There is no relayed `DSSTATE`/`SCS1` record in v1. Shell-private continuation,
draft, and native-handoff state lives in alternating `DSLOCAL0`/`DSLOCAL1`
`SCL1` records. The relay never reads or writes those alternating/private
variables. It uploads only the repairable canonical `DSINST` installed-state
copy and canonical `DSQ`. A
reportable progress update is an `SCR1` record with
`kind: progress`, queued in `DSQ` and imported through the same idempotent
ledger as an assessed response record.

TI-86 v1 record ceilings are part of the wire contract: `SCC1` is at most
5,832 bytes (the rest of the 6 KiB Catalog/state allocation is reserved for two
durable `SCL1` slots and conservative TI variable overhead); `SCQ1` and `SCM1`
are at most 6,144 bytes; `SCD1` is at most 2,048 bytes and 32 strictly
increasing request IDs; `SCU1` is at most 512 bytes and 16 active configured
learners; `SCG1` is at most 4,096 bytes and carries at most those same 16
positive learner keys, at most 12 curriculum-history nodes per learner, and at
most 48 history nodes across the shared device; `SCQ1`, `SCA1`, and the
result-ACK suffix carry at most
170 strictly increasing sequences; the delivery-ACK suffix carries at most 32
request IDs; `SCA1` is at most 544 bytes; and each `SCP1` artifact is at most
12,288 bytes. `SCTQ` is at most 512 bytes and `SCTR` is at most 2,048 bytes;
each response must echo the exact device ID, learner key, and 24-bit request ID
of the retained request. The backend codec, relay, shell, and cross-language resource test
enforce the same literals.

Every `SCD1` entry carries `requestId u24`, `learnerKey u16`, action, and
target. Positive keys are remembered configured learners and key zero is an
explicit Guest claim. The backend preflights the whole new batch, resolves each
key, and authorizes each target against the current learner/Guest Catalog grant
before compiling or changing desired state. Byte-identical persisted replay is
still duplicate-safe after a later roster or assignment change.

## TI-86 link container

The link packet is:

```text
machineId | command | declaredLength (u16 LE) | optional data |
optional additive checksum (u16 LE)
```

Host and calculator IDs are `06h` and `86h`. Implemented commands are `VAR
06h`, `CTS 09h`, `DATA 15h`, `EXIT/SKIP 36h`, `ACK 56h`, `ERR 5Ah`, screenshot
`6Dh`, `EOT 92h`, `REQ A2h`, and `RTS C9h`.

Control packets such as ACK and CTS carry no body even when their length field
echoes a prior packet length. The transport must not wait for nonexistent ACK
data. Data-packet checksum failure is bounded to two retransmission requests;
edge and packet waits are bounded as well.

The protected electrical interface is open-collector. Firmware may only sink
tip or ring through the external transistor circuit; it never drives either
calculator line high.

### Transport ownership and awareness

Silent Link compatibility mode uses the commands above while TI-OS owns the
calculator. The relay exposes live state, direction, item progress, phase age,
last verified-peer age, and cable safety through its LED and `/status`; the
SchoolCalc program can show only honest pre/post state in that mode.

The live learner flow uses cooperative foreground framing while SchoolCalc owns
port 7. `SCF1` frames are carried inside TI DATA packets:

```text
"SCF1" | type u8 | flags=0 u8 | sequence u16 LE |
payloadLength u16 LE | payload (0..256) | CRC-16/CCITT-FALSE u16 LE
```

The tested frame vocabulary covers HELLO/HELLO_ACK, PHASE, ping/pong,
read-variable, write-variable, ACK, cancel, error, and completion. One frame is
in flight at a time and the default chunk is 128 bytes. The foreground relay
adapter implements the same `ICalculatorVariables` boundary as Silent Link, so
no backend or School application use case knows which transport owns the wire.

Raw line levels depend on the protected input circuit and are not peer proof.
The foreground listener distinguishes `safety_disabled`, `disabled`,
`bus_unavailable`, `armed_unknown_idle`, `hello_candidate`, and `occupied`;
connection evidence separately exposes `unknown_idle`, `line_activity_only`,
`negotiating`, or `verified_session`. It never infers `connected` from line
levels. The normative state/safety contract is
[`../../ti86-app/docs/transport-awareness.md`](../../ti86-app/docs/transport-awareness.md).

## Identity and a shared relay

The TI packet machine ID identifies the calculator family, not an individual
calculator. Every enrolled device gets a distinct compact SchoolCalc ID in
`DSID`.

A normal relay does not parse `DSID`. It reads the opaque `SCI1` record and
posts it to:

```text
POST /api/v1/school/calc/devices/identify
Content-Type: application/octet-stream
```

The backend selects exactly one registered family codec, validates the record,
and returns authoritative `deviceId` and `platformId`. One physical relay and
one jack can therefore serve any number of calculators sequentially. Each is
identified before a device-specific URL is constructed.

## Backend HTTP contract

Paths below are relative to `/api/v1/school/calc`. Every HTTP route is protected
by the relay ingress authenticator. Each relay sends both:

```text
Authorization: Bearer <distinct random token of at least 32 bytes>
X-SchoolCalc-Relay-Id: <relay ID owned by that token>
```

The identity header is a consistency assertion, not an identity selector. A
token maps to exactly one relay ID, and two relays may not share a token.

| Endpoint | Transport shape | Purpose |
|---|---|---|
| `POST /devices/enroll` | JSON → device JSON + base64url `SCI1` | create a device and provision `DSID` |
| `POST /devices/identify` | opaque `SCI1` → device JSON | resolve `DSID` before constructing device URLs |
| `POST /devices/:deviceId/observe` | opaque `SCI1` | validate and persist capability/install observation |
| `GET /devices/:deviceId/learners` | JSON metadata + base64url `SCU1` | inspect/retrieve the active configured roster |
| `GET /devices/:deviceId/progress` | binary `SCG1` + generation/ETag headers | retrieve the compact all-learner progress projection |
| `POST /devices/:deviceId/follow-ups/:actionKey/resolve` | learner-key JSON → opaque action resolution | reauthorize one generic follow-up for the selected device learner |
| `GET /devices/:deviceId/catalog` | binary `SCC1` + generation/ETag headers | retrieve the compiled offline Catalog |
| `POST /devices/:deviceId/requests` | opaque `SCD1` | claim install/remove intents idempotently |
| `GET /artifacts/:artifactId` | binary `SCP1` + exact metadata headers | retrieve immutable, previously compiled bytes |
| `POST /results/import` | one binary `SCR1` or `sch:r1:` text | shared cable/QR importer |
| `POST /devices/:deviceId/sync` | JSON containing base64url opaque records | observe, import queue, claim requests, and plan outbound state |
| `GET /devices/:deviceId/remediation` | JSON | list learner-scoped adaptive-remediation sessions |
| `GET /devices/:deviceId/remediation/:sessionId` | JSON | resume bounded remediation turns |
| `POST /devices/:deviceId/remediation/:sessionId/actions` | sequenced JSON action → next turn | submit an idempotent A–E/cancel action |

The relay uses the combined sync route for its normal transaction. The separate
observe/request/result routes remain product API operations and diagnostics;
they do not create a second semantic path.

### Combined sync request

```json
{
  "rawInfo": { "encoding": "base64url", "data": "...SCI1..." },
  "installedState": { "encoding": "base64url", "data": "...SCM1..." },
  "resultQueue": { "encoding": "base64url", "data": "...SCQ1..." },
  "requestRecord": { "encoding": "base64url", "data": "...SCD1..." },
  "interactionRecord": { "encoding": "base64url", "data": "...SCTQ..." },
  "catalogGeneration": null
}
```

`rawInfo` is required by the relay session. Installed-state, queue, and request
fields are omitted when their calculator variables do not exist. `DSTREQ` is
not a fire-and-forget message: the calculator retains the exact `SCTQ` bytes
until a terminal matching `SCTR` acknowledges that request. `DSINST` is
the complete last committed set and takes precedence over any probe-era
installed-ID list embedded in `DSINFO`. The current relay passes no
Catalog generation and therefore safely refreshes `DSCATNEW` every sync; a
future opaque cache hint may avoid that transfer without changing record
semantics.

### Combined sync response

The response contains operation outcomes plus `plan`. Important plan fields are:

```json
{
  "profiles": { "record": { "encoding": "base64url", "data": "...SCU1..." } },
  "progress": { "record": { "encoding": "base64url", "data": "...SCG1..." } },
  "interaction": {
    "status": "complete",
    "record": { "encoding": "base64url", "data": "...SCTR..." }
  },
  "plan": {
    "ready": true,
    "generation": "sha256:...",
    "catalog": { "generation": "sha256:...", "changed": true },
    "removals": [{ "artifactId": "...", "variableName": "DP......" }],
    "artifacts": [{
      "artifactId": "sc:ti86:...",
      "variableName": "DP......",
      "mediaType": "application/vnd.daylight.schoolcalc.ti86",
      "byteLength": 1234,
      "byteDigest": "<64 lowercase SHA-256 hex>"
    }],
    "installedArtifacts": [{
      "artifactId": "sc:ti86:...",
      "variableName": "DP......",
      "byteLength": 1234,
      "byteDigest": "<64 lowercase SHA-256 hex>"
    }],
    "blockers": [],
    "acknowledgement": { "encoding": "base64url", "data": "...SCA1..." },
    "manifest": { "encoding": "base64url", "data": "...SCM1..." }
  }
}
```

`installedArtifacts` is the complete post-commit set, never a delta. When
`ready` is false it remains the current installed set because no requested
install/removal delta may be applied. `ready: false` carries blockers such as
`INSUFFICIENT_STAGING_STORAGE` or
`VARIABLE_NAME_COLLISION`. The relay still stages acknowledgements and the
manifest so the shell can show diagnostics, but it transfers no artifacts.

## Immutable download checks

Catalog responses must include
`X-SchoolCalc-Catalog-Generation`. Artifact responses include:

```text
X-SchoolCalc-Artifact-Id
X-SchoolCalc-Variable-Name
X-SchoolCalc-Byte-Digest
X-SchoolCalc-Byte-Length
Content-Length
```

Before a TI write, the relay verifies every artifact header against the sync
plan, reads exactly `Content-Length` bounded by its transfer buffer, calculates
SHA-256, validates the `SCP1` envelope/CRC, and validates the planned TI variable
name. The backend artifact repository is first-write-wins, and artifact GET
never recompiles mutable YAML.

## Transaction and commit order

The implemented attached transaction is:

1. Read and envelope-check required `DSID`.
2. Resolve it through `/devices/identify`.
3. Read and envelope-check required `DSINFO`.
4. Read optional `DSINST`, `DSQ`, `DSREQ`, and `DSTREQ`; reject malformed or oversized
   records before networking.
5. POST one combined sync request.
6. Validate returned `SCA1`, `SCM1`, and any request-correlated `SCTR` record.
7. Validate and write the complete roster and progress projections as
   `DSUSRNEW` and `DSPRGNEW`; neither replaces its canonical copy directly.
8. If present, write the response as `DSTNEW`; this is independent of the
   content commit and never deletes `DSTREQ`.
9. If changed, download and write Catalog bytes as `DSCATNEW`.
10. If `ready`, download, verify, and write every new `DPxxxxxx` artifact.
11. Write acknowledgements as `DSACKNEW`.
12. Write `DSSYNC` **last**.
13. Return `awaiting_calculator_commit`; the next observation proves the
    calculator's installed set.

Silent-link variable writes replace duplicate names. Transaction safety
therefore cannot depend on “write the new value and hope.” The server requires
enough free bytes while the old artifacts still exist and blocks a planned
artifact whose variable name collides with a different installed artifact.

The calculator-side content transaction first validates identity, Catalog
generation, complete installed set, staged artifact identity/length/digest,
and exact acknowledgement sequences without mutating anything. It then writes
the Catalog and complete `SCM1` snapshot to inactive `DSCAT0/1` and
`DSINST0/1` slots. A v0 ACK authorizes queue deletion only when the exact,
ordered ACK sequence list equals every record in the uploaded `DSQ`; a partial
or mismatched ACK preserves the entire queue byte-for-byte for idempotent
replay. The shell deletes that whole queue before committing both slot selectors
in one alternating `SCL1` write. Only after that durable commit may it publish
the repairable `DSINST` uplink, remove superseded artifacts, and delete
`DSSYNC` last. A cable pull before relay step 10 leaves only ignored
staging/orphan variables; a power cut during calculator commit selects either
the old complete snapshot or the new complete snapshot. A retry after queue
deletion recognizes the already-committed snapshot before requiring the now
absent queue/ACK staging records.

`SCPROF` separately validates each staged projection against the calculator
identity, promotes `DSUSRNEW` → `DSUSERS` and `DSPRGNEW` → `DSPROG`, and
deletes staging last. A cable pull or reset before promotion leaves the prior
canonical records intact; replaying the same complete projection converges.

`SCTUTOR` separately validates `DSTNEW` against `DSID`, the selected learner,
and the exact retained `DSTREQ`, replaces and verifies `DSTURN`, deletes
`DSTREQ` only for terminal acknowledged dispositions, and deletes `DSTNEW`
last. Processing/retryable dispositions retain the canonical request bytes.
Every injected cut converges to the same response and never duplicates a tutor
action.

`DSQ` remains authoritative until the backend has returned an `SCA1` sequence
and the shell commits it. `accepted` and byte-identical `duplicate` are safe to
acknowledge; a same-sequence/different-record conflict is never acknowledged.

## Runtime channels

- HTTP is canonical for identity, sync, Catalog, artifact, request, and result
  resources.
- WebSocket carries relay presence/health and may enqueue a sync; it never
  carries the only artifact or result copy.
- The relay's LAN `POST /sync` enqueues the same transaction for operations and
  recovery.
- The normal live learner path needs no server or LAN trigger: with
  `FOREGROUND_LISTENER_ENABLED` and the protected transmit gate enabled, the
  idle TI task accepts the calculator-originated `SCF1 HELLO`. The listener is
  serialized with every explicit TI job and verifies the frame/nonce before
  reporting a peer.
- Optional auto-sync polls for `DSID` every 15 seconds and is disabled until
  protected-circuit and manual-sync bench tests pass. This is a separate
  relay-initiated Silent Link compatibility path.
- MQTT is outside v1.

### Operational diagnostics

The relay's local `/status` document exposes current state, counters, last
errors, operation IDs, packet classes, BLE configured/resolved identity and
security/liveness, backend/WebSocket activity, input delivery, faults, and heap
headroom. `/diagnostics/config` exposes flash identity while reducing API-token
and Wi-Fi-password values to configured booleans.

`/diagnostics/events` exposes a volatile, payload-free, 48-entry journal.
Accepted TI jobs receive a local operation ID used as `correlation` by their TI
session, calculator-variable, foreground-frame, electrical-fault, and backend
HTTP events. Silent Link packet classes remain cumulative status counters to
avoid flooding the journal. Query filters are `after`, `correlation`,
`subsystem`, `min_severity`, and `limit`; filtering precedes selection of the
newest matches. Keyboard queue events use their input sequence as a separate
correlation namespace. The full schema and diagnostic procedures are in
[`operations-and-diagnostics.md`](./operations-and-diagnostics.md).

## Current bounded relay resources

At boot the firmware reserves one 45,088-byte workspace and reuses it for all
syncs: 512-byte identity; 4 KiB device info; 6 KiB installed state; 6 KiB result
queue; 2 KiB delivery request; 512-byte interaction request; 512-byte learner
roster; 4 KiB progress projection; 2 KiB interaction response; 544-byte
acknowledgement; 6 KiB outbound manifest; and 12 KiB shared
Catalog/artifact transfer space. There is one TI job at a time.
An oversized installed state or queue is rejected before network access; an
oversized Catalog or artifact is rejected before a calculator write.

## Failure invariants

- No malformed calculator record reaches a backend use case.
- No unverified response reaches a TI variable write.
- No manifest is published after a failed Catalog/artifact/ACK write.
- No old artifact is counted as staging space for its replacement.
- No sync consumes the device-reported protected free-space reserve.
- Changed Catalog bytes, artifact bytes, and per-variable overhead all count
  toward staging space before `ready` can be true.
- No relay grades, trusts a score, selects a learner, or decodes family data.
- No result is removed merely because it was transmitted.
- Every network and cable operation is bounded and retryable.
