# SchoolCalc transport awareness

Status: user contract locked; Silent Link compatibility and cooperative
foreground implementations linked; exact-Z80 and protected-hardware execution
gates remain. Updated 2026-08-02.

## Outcome

The learner must never have to infer whether SchoolCalc is waiting, exchanging
calculator data, contacting the server, receiving content, validating a local
commit, stopped, or finished. Every transfer surface exposes three independent
facts:

1. **presence evidence** — what actually proves a relay peer was seen;
2. **direction/progress** — what the transaction is doing now; and
3. **cable safety** — `KEEP CONNECTED` or `SAFE TO UNPLUG`.

These are protocol state, not decorative animation. A stale spinner, a line
level, Wi-Fi connectivity, or the existence of a relay is never substituted
for a verified calculator/relay exchange.

## The physical limit

The TI link is a two-wire open-collector bus. Both lines released/high means a
usable electrically idle bus, but it does not prove that SchoolCalc is running
or that the peer will answer. With the recommended divider-to-ground interface,
an unplugged jack will normally sense both-low; another buffer or pull network
can produce a different absent level. Raw voltage is therefore useful
diagnostic evidence, never sufficient peer identity:

```text
line level  !=  verified SchoolCalc peer
```

Exactly one low line is a link-start/activity candidate. Both-low means no
usable idle bus—normally an absent jack with the documented divider, but also a
possible short or stuck line. Only a valid request/response handshake proves the
peer for the current session. Once traffic stops, the interface may retain
`last verified` age, but it returns to `unknown` rather than continuing to claim
`connected`.

## Evidence model

| Evidence | Meaning | UI may say |
| --- | --- | --- |
| no handshake and usable idle lines | listener armed; no current peer evidence | `CABLE: UNKNOWN WHILE IDLE` |
| both lines low | no usable idle bus: absent or electrical fault | relay `bus_unavailable` |
| exactly-one-low/recent edge only | possible packet start; not yet verified | `LINK ACTIVITY` |
| HELLO/HELLO_ACK nonce match | SchoolCalc relay verified for this session | `RELAY: VERIFIED` |
| valid Silent Link variable response | TI peer verified for that relay transaction | relay status `verified_session` |
| previous completed session | historical evidence only | `LAST SYNC ...`; never `CONNECTED` |

The relay `/status` document exposes `connection`, `presence`,
`foreground_listener_state`, `peer_verified_this_session`,
`last_verified_peer_ms_ago`, `last_initiator`, and raw/recent line activity
separately so diagnostics cannot collapse them into one misleading boolean.

## User-visible state machine

| State | Presence copy | Work copy | Safety |
| --- | --- | --- | --- |
| `unknown_idle` | `RELAY: WAITING` / `IDLE CABLE: UNKNOWN` | `NO TRANSFER ACTIVE` | safe |
| `negotiating` | `RELAY: VERIFYING` | handshake attempt | keep connected |
| `calculator_to_relay` | `RELAY: VERIFIED` | `SENDING TO RELAY` + current record/count | keep connected |
| `network` | verified this session | `RELAY CONTACTING SERVER` | keep connected |
| `relay_to_calculator` | `RELAY: VERIFIED` | `RECEIVING FROM RELAY` + current item/count | keep connected |
| `validating` | transfer complete | `VALIDATING LOCALLY` / commit step | safe once complete `DSSYNC` is local |
| `committed` | session ended | installed/ACK counts | safe |
| `blocked` | session ended | blocker and corrective action | safe |
| `error` | session stopped | error and retry action; queue/content preserved | safe |

`KEEP CONNECTED` is shown from the first handshake attempt until either a
complete commit marker has arrived or the transaction has stopped. A progress
percentage is allowed only when a nonzero total is known; otherwise the named
phase and an activity indicator are used. A timeout always changes the screen
to a terminal error—never an endless busy state.

The full-canvas golden screens are
[`sync-waiting.png`](./gui/sync-waiting.png),
[`sync-sending.png`](./gui/sync-sending.png),
[`sync-receiving.png`](./gui/sync-receiving.png),
[`sync-validating.png`](./gui/sync-validating.png), and
[`sync-error.png`](./gui/sync-error.png).

## Two transport ownership modes

### Silent Link compatibility mode

The relay acts as a computer and TI-OS owns the calculator link protocol. This
is the currently implemented variable adapter. It can synchronize while the
calculator is at an OS-compatible screen without requiring `LINK > RECV`.

During this mode, live direction/progress is visible on the M5 LED and relay
`/status`. SchoolCalc can show the honest waiting state before the exchange and
validate/display the terminal state when it next runs, but it cannot redraw its
own framebuffer while TI-OS owns the transfer. This mode remains useful for
provisioning, recovery, and unattended compatibility; it cannot satisfy the
full live-on-calculator UI by itself.

### SchoolCalc foreground mode

The v0 learner experience keeps the product on Sync while the separately
reviewed `SCSYNC` runtime owns TI-86 port 7 cooperatively. The calculator
initiates a bounded handshake. The idle relay task continuously arms for the
first link edge and accepts that `HELLO` without a WebSocket command, an HTTP
pre-arm, or `LINK > RECV`; the protected-interface transmit switch remains the
master safety gate. Explicit Silent Link and diagnostic jobs are serialized and
win atomically if already queued. The relay then exposes the same
variable-oriented port used by the existing sync use case. SCSYNC redraws
between acknowledged operations/chunks, so the screen and relay observe the
same transaction.

Foreground framing is implemented as a tested `SCF1` envelope carried inside
a standard TI DATA packet:

```text
"SCF1" | type u8 | flags=0 u8 | sequence u16 LE |
payloadLength u16 LE | payload (0..256) | CRC-16/CCITT-FALSE u16 LE
```

The default data chunk is 128 bytes. One frame is in flight at a time; every
frame is acknowledged or rejected before the next; sequence reuse inside a
session is invalid. The calculator supplies a nonzero, launch-mixed nonce in `HELLO`,
and the relay must echo it in `HELLO_ACK`. This nonce correlates a live session
and stale replies—it is not authentication. Device authority still comes from
the checksum-valid `DSID` resolved by the backend, and network authority still
comes from the relay credential.

The locked frame vocabulary is:

| Group | Frames |
| --- | --- |
| session | `HELLO`, `HELLO_ACK`, `PING`, `PONG`, `COMPLETE`, `CANCEL`, `ERROR` |
| awareness | `PHASE` |
| calculator upload | `READ_REQUEST`, `VARIABLE_BEGIN`, `VARIABLE_CHUNK`, `VARIABLE_END`, `VARIABLE_MISSING` |
| calculator download | `WRITE_BEGIN`, `WRITE_READY`, `WRITE_CHUNK`, `WRITE_END`, `VARIABLE_STORED` |
| reliability | `ACK` |

Variable names remain uppercase TI names of one through eight characters.
`VARIABLE_BEGIN` declares exact length before allocation; chunks carry exact
offsets; `VARIABLE_END` repeats total length and whole-record CRC. Unknown frame
types, flags, length, sequence, offset, name, or CRC fail closed. A handled
timeout/cancel deletes its partial write; abrupt power loss may leave only an
unselected partial staging/immutable variable, never a commit marker.
`DSSYNC` remains the final write.

The relay foreground adapter implements the existing
`ICalculatorVariables` port, so API, sync planning, idempotency, and curriculum
layers do not branch on foreground versus Silent Link transport.

## Relay LED contract

| LED | Meaning |
| --- | --- |
| blue | negotiating / verifying calculator peer |
| cyan | calculator → relay |
| yellow | relay contacting backend |
| purple | relay → calculator |
| green | terminal success / safe to unplug |
| red | stopped with error / safe to unplug |
| orange | backend WebSocket unavailable while no TI operation is active |

LED color is a secondary channel. The LCD copy and `/status` state remain the
authoritative explanation, including current item totals and error detail.

## Recovery invariants

- A cable pull or timeout stops all further writes, releases both open-drain
  outputs, and makes the terminal safety state explicit.
- A queued result is removed only by a complete, device-bound whole-batch ACK;
  a transport ACK alone is insufficient.
- A foreground cancellation before `DSSYNC` leaves old Catalog/install state
  selected and all queue records intact.
- A complete local `DSSYNC` permits unplugging before calculator validation;
  validation and commit no longer need the relay.
- On every assembly exit/error path, port 7 is restored to its released OS
  value before invoking TI-OS key or return routines.

## Implementation evidence and remaining gates

The typed SCF1 codec, relay foreground `ICalculatorVariables` adapter,
calculator-originated idle listener, phase observer, and complete sync use case
pass native/contract tests against a deterministic virtual calculator. The
ESP32 image compiles with the listener enabled. `SCSYNC` assembles inside its
independent 8 KiB window; contract tests cover its ABI, frame constants, closed
variable names and sizes, packet/CRC/retry boundaries, contiguous offsets,
partial-write cleanup, direct EXIT/CLEAR polling, line release, awareness copy,
shell commit order, listener arbitration, and status provenance. This is strong
source/build evidence, not assembled-Z80 execution evidence.
Completion still requires:

1. exact assembled-Z80 execution against a deterministic virtual port-7 peer;
2. protected-circuit bench tests for handshake, timeout, cancellation, unplug
   at every packet/frame/chunk boundary, and released-line voltage/current;
3. relay-offline and backend-timeout observation on the real M5 display; and
4. a fresh-main-and-backup-battery physical TI-86 acceptance run, repeated for
   every fleet ROM revision. No calculator transfer is
   authorized while the current calculator's backup battery condition is
   unresolved.
