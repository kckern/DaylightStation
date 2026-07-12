# Trigger Pipeline — Observability

> The unified trigger pipeline emits one consistent, source-tagged observability
> surface. This is the SSOT for what a trigger event logs and broadcasts, across
> every source (NFC, barcode, state, and future sources like SMS/keyboard).

## Dispatch events (the SSOT — same for every source)

Every trigger, regardless of source, flows through `TriggerDispatchService.handleEvent`
and logs the **`trigger.fired`** event. The `modality` field is the source
discriminator (`nfc` | `state` | `barcode` | …), so all dispatch telemetry is
filterable by source uniformly.

| Event | When | Key fields |
|---|---|---|
| `trigger.fired` | Every dispatch outcome (success, unregistered, error) | `location`, `modality`, `value`, `registered`, `action`, `target`, `ok`, `elapsedMs`, `dispatchId`, `error`, `code` |
| `trigger.debounced` | Repeat within the per-key debounce window | `location`, `modality`, `value`, `sinceMs`, `windowMs` |
| `trigger.denied` | `authorize` stage denied the event | `location`, `modality`, `value`, `reason` |
| `trigger.guard.suppressed` | HA zombie-wake-guard suppressed for a target | `target`, `guardEntity`, `durationMs` |
| `trigger.observed_recorded` | Unknown NFC tag recorded to history | `location`, `uid` |
| `trigger.note_set` | NFC tag note curated | `location`, `value`, `created` |

**WS broadcast:** every dispatch emits on topic **`trigger:<location>:<modality>`**
with `type: 'trigger.fired'` (or `'trigger.note_set'`) and the summary payload
(`location`, `modality`, `value`, `action`, `target`, `ok`, `dispatchId`). Same
shape for every source.

## Response-handler events (per response kind)

| Event | Handler |
|---|---|
| `trigger.content.ack` / `.ack_timeout` / `.no_ack_channel` / `.fallback_failed` | `ContentDispatcher` (optimistic content posture) |
| `trigger.transport.unknown` | `transport` handler (unknown command) |
| `trigger.script.called` / `.unknown_endpoint` / `.failed` / `.no_gateway` | `script` handler + `HttpEndpointGateway` |

## Ingress-transport telemetry (intentionally source-namespaced)

Ingress adapters log their own transport-level telemetry — this is deliberately
NOT folded into `trigger.fired`, the same way an HTTP access log is separate from
application logs. These fire *before* an event enters the dispatch core.

| Namespace | Source | Notes |
|---|---|---|
| `barcode.pipeline.ready` / `barcode.dispatcher.ready` | barcode boot | **Documented boot markers** — kept stable for the deploy verification procedure (see CLAUDE.local.md). |
| `trigger.ingress.barcode.*` | barcode ingress (`display.on`, `display.failed`, `dispatch.failed`) | Operational ingress logs, unified under the `trigger.*` namespace. |
| `barcode_relay.*` | the ESP32 relay adapter (`scan`, `persist.*`, `ready`) | Generic relay-adapter telemetry, shared convention with `food-scale-relay`. |

## What was retired

The old barcode dispatch path (`BarcodeScanService`) logged a separate
`barcode.approved` / `barcode.denied` / `barcode.ack.*` / `barcode.command`
vocabulary. That path was deleted (Plan 4); barcode dispatch outcomes now log
`trigger.fired` like every other source. The dormant `barcode.mqtt.*` adapter is
inert (not loaded).

## History / state

- NFC discovery (observed scans, unnamed placeholders): `history/triggers/nfc.observed.yml` (machine-written; see the config/state split in the design spec).
- Per-scanner barcode day-logs: `household/history/barcode/<device>/<YYYY-MM-DD>.yml` (relay persistence).
