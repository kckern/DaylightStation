# Relay operations and diagnostics

Status: implemented in the M5 ATOM firmware; physical TI-link and BLE-keyboard
behavior still require protected-hardware bench proof. Updated 2026-08-02.

This is the operator runbook for one SchoolCalc relay. The local WebServer is
the first diagnostic surface when calculator transfer, backend delivery,
WebSocket presence, or keyboard input fails. It remains available on the LAN
even when the backend WebSocket is disconnected.

## Local endpoints

| Method and path | Purpose | Mutates state |
|---|---|---|
| `GET /health` | complete status document; retained as a compatibility alias | no |
| `GET /status` | current counters, state, last errors, memory headroom, and faults | no |
| `GET /diagnostics/events` | bounded payload-free event journal | no |
| `GET /diagnostics/config` | generated configuration identity with secrets redacted | no |
| `POST /sync` | enqueue a Silent Link sync/recovery job | yes |
| `POST /sync/foreground` | enqueue an explicit foreground sync job | yes |
| `POST /diagnostics/link/screenshot` | enqueue the gated read-only screenshot probe | yes |
| `GET /diagnostics/link/screenshot.raw` | retrieve the latest 1,024-byte screen image | no |
| `POST /input/ble/pair` | open the bounded pairing window for the configured keyboard | yes |
| `POST /input/ble/forget` | forget only the configured keyboard bond | yes |

The sync and screenshot routes return `202` only when the single TI job slot
accepts the operation. `409` means the link is busy, its workspace is
unavailable, or the protected transmit gate is disabled. A queued operation's
ID appears as `ti_link.active_operation_id` and
`diagnostics.active_correlation`.

## Status evidence

`GET /status` intentionally separates evidence that operators must not
conflate:

- `tr` reports raw tip/ring levels, activity, changes, and the both-low fault;
- `ti_link.connection` and `presence` distinguish unknown idle, line activity,
  negotiation, and a peer verified in this session;
- `ti_link.direction`, item counters, phase age, and `safe_to_unplug` explain
  what the link task is doing;
- `ti_link.last_interaction_staged` distinguishes a successful bounded tutor
  response stage from a sync that had no `DSTREQ`; `staging_interaction` is a
  named phase, not generic artifact download;
- `ti_link.packets` separates edge timeouts, busy-bus errors, checksum errors,
  unexpected packets, byte totals, and the last packet header;
- `calculator_io` counts variable operations and foreground frames;
- `backend.api` records request counts, byte totals, last operation, HTTP
  status, duration, and error;
- `ws` records connection transitions, messages, byte totals, heartbeat
  successes/failures, ages, and the last error;
- `input.ble_keyboard` exposes the flash-configured and resolved Bluetooth
  address, label, bond/encryption/authentication/identity/subscription state,
  liveness, RSSI, report counts, reconnect deadline, and last reason/error;
- `input.delivery` exposes the translated input queue, accepted/acknowledged/
  rejected counts, delivery path, latency, and last error;
- `memory` reports total, current free, minimum-ever-free, and largest
  allocatable heap bytes; and
- `faults` collects current conditions without pretending every degraded
  optional channel makes durable HTTP sync impossible.

Released link lines are not proof that a calculator or cable is present. Only
a valid current-session protocol reply produces verified peer evidence.

## Event journal

The firmware keeps the newest 48 events in RAM. It overwrites the oldest event
when full and exposes lifetime `total_recorded`, `overwritten`, and
`next_sequence` counters so a collector can detect gaps. Reboot clears the
events and uptime-relative ages.

Each event may contain:

```text
sequence, at_ms, ms_ago, subsystem, severity, name, detail,
correlation, bytes, status, duration_ms
```

Subsystems are `system`, `wifi`, `websocket`, `http_api`, `ti_electrical`,
`ti_packet`, `ti_session`, `ble_keyboard`, and `input_queue`. Severities are
`debug`, `info`, `warning`, and `error`.

The `correlation` field has two explicit namespaces:

- TI session, calculator-variable, foreground-frame, electrical-fault, and
  backend HTTP events use the parent `active_operation_id`; and
- keyboard/input-queue events use the input event sequence.

Filters are applied before `limit`; the response returns the newest matching
events in chronological order:

```sh
curl 'http://<relay-ip>/diagnostics/events?limit=20'
curl 'http://<relay-ip>/diagnostics/events?after=125&min_severity=warning'
curl 'http://<relay-ip>/diagnostics/events?correlation=17'
curl 'http://<relay-ip>/diagnostics/events?subsystem=ble_keyboard'
```

An unknown subsystem/severity or non-positive limit returns `400`. Because the
journal is deliberately small, a monitoring client should poll with `after`
and treat an increased `overwritten` count as lost diagnostic history.

## Redaction contract

Diagnostics never store or return calculator variable bodies, artifact bytes,
quiz answers, result records, learner content, API tokens, or the Wi-Fi
password. `/diagnostics/config` returns only booleans for token/password
presence. It intentionally returns relay identity, backend location, Wi-Fi
SSID, configured keyboard address/label, pin assignments, build time, and the
generated configuration fingerprint because those values are needed to prove
which unit was flashed. Keep the operational LAN trusted.

## Failure runbooks

### Cable state is unknown or foreground sync never starts

1. Confirm `ti_link.transmit_enabled`, `foreground_listener_enabled`,
   `workspace_ready`, and `foreground_listener_state`.
2. Inspect `tr.tip_low`, `ring_low`, recent activity, and
   `both_low_fault`. Both low for 100 ms indicates a short, stuck bus, or
   invalid interface state; disconnect and meter the protected circuit.
3. Treat `armed_unknown_idle` as ready but unverified. Start Sync on SchoolCalc
   and look for `hello_candidate`, a new operation ID, packet RX, and then
   `verified_session`.
4. If only line changes occur, inspect edge timeouts and unexpected packet
   headers. Do not infer that increasing the timeout will fix reversed wiring
   or an unsafe level shifter.

### A transfer starts but fails

1. Record `active_operation_id` or `last_operation_id`, then fetch events by
   that `correlation` before 48 newer events overwrite them.
2. Use `ti_link.last_state`, direction, phase age, item counters, and last error
   to locate the failed phase.
3. Distinguish electrical/bus-busy/edge timeout, checksum/retransmission, and
   unexpected-packet failures using `ti_link.packets` and `ti_packet` events.
4. A failure does not consume `DSQ`, `DSREQ`, `DSTREQ`, or the prior committed Catalog.
   Correct the cause and repeat the same sync; backend claims and calculator
   staging are idempotent.

### Calculator data does not reach the server

1. In the same operation correlation, find the last `http_api` event and check
   `backend.api.last_operation`, status, duration, byte counts, and error.
2. Verify Wi-Fi independently from WebSocket. HTTP is canonical; a disconnected
   WebSocket is degraded fleet presence, not proof that result import failed.
3. Confirm the session reached calculator-to-relay and network phases. If it
   failed earlier, no API request was expected.
4. Never clear the calculator queue manually. Accepted or byte-identical
   duplicate ACKs are the only authority for calculator-side queue removal.

### BLE keyboard input does not type

1. Compare `/diagnostics/config`'s address, label, address type, and fingerprint
   with the intended flash-time household configuration.
2. Require `trusted_ready`: connected, bonded, encrypted, identity verified,
   subscribed, and—when configured—authenticated with MITM protection.
3. Check liveness/RSSI, connect attempts, disconnect/auth failures, raw report
   counts, invalid/dropped reports, and the reconnect deadline.
4. Check `input.delivery` for queue-full rejection, translation, attempts,
   acknowledgement, delivery path, latency, and last error. TI ownership is
   serialized, so a key may wait behind a bounded sync but must not disappear.

### WebSocket presence is missing

1. Check Wi-Fi, `ws.connected`, transition counts, last error, RX/TX ages, and
   heartbeat success/failure counts.
2. Confirm the configured backend host/path and relay fingerprint.
3. Continue diagnosing durable sync through HTTP fields. WebSocket may wake a
   relay, but it never owns the only result or artifact copy.

### The cable is unplugged mid-session

The active operation terminates with a failed state once its bounded wait
expires. `safe_to_unplug` becomes true only after the relay no longer requires
wire I/O. Existing calculator records and committed content remain intact;
partial inbound variables are staging only. Reconnect, return SchoolCalc to its
Sync screen, and retry. For Tutor, `DSTREQ` remains byte-identical and F1/ENTER
resends its existing request ID; a matching committed `DSTURN` handles a cut
after response promotion. The immutable `{deviceId, sequence}` result identity,
request IDs, server claims, and staged-record validation make repetition safe.

## Physical acceptance still required

A successful firmware build and native session tests prove bounds and state
transitions, not the direct electrical link. Before enabling writes, complete
the meter and protected-cable gates in [`wiring.md`](./wiring.md), then capture
one operation's `/status` and correlated event journal for the hardware test
record. BLE address resolution, bonding, real HID reports, direct remote keys,
and foreground input also require the configured keyboard and calculator.
