# Barcode → Screen Pipeline Design

How scanned barcodes flow from MQTT into the screen-framework to trigger media playback, menu navigation, and other screen actions — gated by a configurable approval layer.

**Date:** 2026-03-30

---

## Overview

```
USB Scanner
    │  evdev grab + keystroke assembly
    ▼
MQTT: daylight/scanner/barcode
    │  { barcode, timestamp, device }
    ▼
MQTTBarcodeAdapter (adapter layer)
    │  parse barcode string → BarcodePayload
    ▼
BarcodeScanService (application layer)
    │  resolve target screen, policy group
    ▼
BarcodeGatekeeper (domain layer)
    │  evaluate(scanContext) → approved/denied
    ▼
WS broadcast to target screen topic
    │  { topic, action, contentId, source, device }
    ▼
useScreenCommands (frontend)
    │  action → ActionBus event
    ▼
ScreenActionHandler → Player / Menu overlay
```

---

## Barcode Format & Parsing

### MQTT Message

**Topic:** `daylight/scanner/barcode`

```json
{
  "barcode": "plex:12345",
  "timestamp": "2026-03-30T01:21:31.824+00:00",
  "device": "symbol-scanner"
}
```

### Barcode String Formats

The barcode string supports three formats, parsed right-to-left. The last two segments are always `source:id` (the contentId). Preceding segments are optional screen and/or action.

| Format | Example | Screen | Action | ContentId |
|--------|---------|--------|--------|-----------|
| `source:id` | `plex:12345` | from device config | from pipeline config | `plex:12345` |
| `action:source:id` | `queue:plex:12345` | from device config | `queue` | `plex:12345` |
| `screen:action:source:id` | `living-room:queue:plex:12345` | `living-room` | `queue` | `plex:12345` |

**Disambiguation:** The parser checks each prefix segment against the `actions` list from `barcode.yml` (`queue`, `play`, `open`). If it's not a recognized action, it's treated as a screen name. The action list is passed to `BarcodePayload` at construction time.

### BarcodePayload Value Object

**File:** `backend/src/2_domains/barcode/BarcodePayload.mjs`

Parses and validates the barcode string. Exposes:
- `.contentId` — `source:id` string (e.g. `plex:12345`)
- `.targetScreen` — explicit screen override, or `null`
- `.action` — explicit action, or `null` (falls back to pipeline default)
- `.device` — scanner device ID from MQTT payload
- `.timestamp` — scan timestamp from MQTT payload

Rejects barcodes that don't contain at least `source:id` (two colon-separated segments).

---

## Adapter Layer — MQTTBarcodeAdapter

**File:** `backend/src/1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs`

Dedicated MQTT adapter for barcode scanning. Subscribes to the barcode topic and emits parsed payloads upstream.

### Responsibilities

- Connect to MQTT broker (same host/port as vibration adapter, separate connection)
- Subscribe to barcode topic (default: `daylight/scanner/barcode`, configurable in `barcode.yml`)
- Validate incoming JSON shape: `barcode` (string, required), `timestamp` (string, required), `device` (string, required)
- Parse barcode string into `BarcodePayload`
- Call `onScan(payload)` callback with the parsed result
- Auto-reconnect with exponential backoff (same pattern as `MQTTSensorAdapter`)
- Graceful shutdown

### What It Does NOT Do

- No business logic — doesn't know about screens, policies, or queues
- No content resolution — passes the raw contentId through
- No gatekeeper evaluation — that's the application layer's job

---

## Domain Layer — BarcodeGatekeeper

**File:** `backend/src/2_domains/barcode/BarcodeGatekeeper.mjs`

Abstract approval layer with a strategy pattern. Decides whether a barcode scan should be acted upon.

### Interface

```javascript
async evaluate(scanContext) → { approved: boolean, reason?: string }
```

**scanContext:**
```javascript
{
  contentId,      // "plex:12345"
  targetScreen,   // "office"
  action,         // "queue"
  device,         // "symbol-scanner"
  timestamp,      // ISO string
  policyGroup,    // "default"
}
```

### Strategy Execution

The gatekeeper holds an ordered list of strategy functions loaded from config. Each is an async function with the same `evaluate(scanContext)` signature. Strategies run in order — first denial wins. If all approve (or no strategies are configured), the scan is approved.

### Implementations

**AutoApproveStrategy** (ships now):
- `backend/src/2_domains/barcode/strategies/AutoApproveStrategy.mjs`
- Returns `{ approved: true }` unconditionally

**Future strategies** (interface supports, not built now):
- `HomeAssistantConfirmStrategy` — push HA notification, await response
- `TimeWindowStrategy` — approve only during configured hours
- `ContentRatingStrategy` — deny based on content metadata

---

## Application Layer — BarcodeScanService

**File:** `backend/src/3_applications/barcode/BarcodeScanService.mjs`

Pipeline orchestrator. Receives parsed barcode payloads, resolves context, runs gatekeeper, and broadcasts to screens.

### Flow

1. **Receive** parsed `BarcodePayload` from adapter callback
2. **Resolve target screen** — use barcode's explicit `.targetScreen`, or fall back to scanner device's `target_screen` from `devices.yml`
3. **Resolve action** — use barcode's explicit `.action`, or fall back to `default_action` from `barcode.yml`
4. **Resolve policy group** — look up scanner device's `policy_group` in `devices.yml`, load matching policy from `barcode.yml`
5. **Run gatekeeper** — `await gatekeeper.evaluate(scanContext)`
6. **If denied:** log reason, emit `barcode:denied` event, stop
7. **If approved:** broadcast WS message to target screen's topic

### WS Broadcast Payload

```json
{
  "topic": "office",
  "action": "queue",
  "contentId": "plex:12345",
  "source": "barcode",
  "device": "symbol-scanner"
}
```

### Dependencies (constructor-injected)

- `gatekeeper` — `BarcodeGatekeeper` instance
- `deviceConfigResolver` — reads scanner entries from `devices.yml`
- `broadcastEvent` — WS broadcast function from bootstrap
- `pipelineConfig` — parsed `barcode.yml` (action list, defaults, gatekeeper policies)
- `logger`

---

## Frontend — useScreenCommands Integration

**File:** `frontend/src/screen-framework/commands/useScreenCommands.js`

Minimal change. The existing command handler already processes WS messages and emits ActionBus events. Add handling for barcode-sourced messages:

When a WS message arrives with `source: 'barcode'`, map the `action` field to an ActionBus event:

| Barcode Action | ActionBus Event | Effect |
|----------------|-----------------|--------|
| `queue` | `media:queue` | Append to current queue / start Player |
| `play` | `media:play` | Replace queue, start immediately |
| `open` | `menu:open` | Open content in menu system |

The `contentId` is passed through as the event payload, matching the existing pattern for WS-driven content loading.

---

## Configuration

### devices.yml — Per-Scanner Config

```yaml
symbol-scanner:
  type: barcode-scanner
  target_screen: office
  policy_group: default
```

Each scanner device declares:
- `type: barcode-scanner` — identifies it as a barcode scanner
- `target_screen` — default screen to send content to
- `policy_group` — which gatekeeper policy to apply

### barcode.yml — Pipeline Config

```yaml
topic: daylight/scanner/barcode
default_action: queue
actions:
  - queue
  - play
  - open
gatekeeper:
  default_policy: auto-approve
  policies:
    auto-approve:
      strategies: []
```

- `topic` — MQTT topic to subscribe to
- `default_action` — action when barcode doesn't include one
- `actions` — valid action names (used by parser for disambiguation)
- `gatekeeper.policies` — named policy groups with ordered strategy lists

---

## Bootstrap Wiring

**`bootstrap.mjs`:**
- Create `MQTTBarcodeAdapter` with broker config from `configService.getAdapterConfig('mqtt')`
- Create `BarcodeGatekeeper` with `AutoApproveStrategy`
- Create `BarcodeScanService` with gatekeeper, device config, broadcast function, pipeline config
- Wire adapter's `onScan` callback → `barcodeScanService.handle(payload)`

**`app.mjs`:**
- Initialize barcode adapter alongside vibration adapter (same broker, separate connection)
- Pass `broadcastEvent` to service for WS output
- Initialize with scanner device list from `devices.yml` (filtered by `type: barcode-scanner`)

---

## File Summary

| Layer | File | Purpose |
|-------|------|---------|
| Domain | `backend/src/2_domains/barcode/BarcodePayload.mjs` | Value object — parse and validate barcode strings |
| Domain | `backend/src/2_domains/barcode/BarcodeGatekeeper.mjs` | Abstract approve/deny evaluation with strategy pattern |
| Domain | `backend/src/2_domains/barcode/strategies/AutoApproveStrategy.mjs` | Default strategy — approve everything |
| Adapter | `backend/src/1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs` | MQTT subscription, payload validation, parse + emit |
| Application | `backend/src/3_applications/barcode/BarcodeScanService.mjs` | Orchestrator — resolve context, gatekeeper, broadcast |
| Frontend | `frontend/src/screen-framework/commands/useScreenCommands.js` | Handle barcode WS messages → ActionBus events |
| Config | `data/household/config/barcode.yml` | Pipeline config (topic, actions, gatekeeper policies) |
| Config | `data/household/config/devices.yml` | Scanner device entries (target screen, policy group) |
| System | `backend/src/0_system/bootstrap.mjs` | Wiring — create adapter, gatekeeper, service |
| System | `backend/src/app.mjs` | Initialize barcode adapter, pass broadcast function |
