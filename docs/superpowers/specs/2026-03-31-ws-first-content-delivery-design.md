# WS-First Content Delivery for FKB Devices

**Date:** 2026-03-31
**Status:** Approved

## Problem

When loading new content on the living room TV (Shield TV with FullyKiosk Browser), the current `/load` pipeline always uses FKB's `loadURL` REST API, which triggers a full page refresh. This is overkill when the screen is already foregrounded and the app's WebSocket-connected screen framework is running — the frontend can accept content commands via WS and open the Player overlay without any navigation.

## Solution

Make the `load` step in `WakeAndLoadService` try WebSocket delivery first when FKB is already foregrounded. Fall back to FKB `loadURL` if WS delivery fails (no subscribers, no ack, or timeout).

## Precondition

The WS-first path only activates when **both** conditions are true:

1. The device has FKB content control (i.e., it's a `FullyKioskContentAdapter` device, not already WS-only).
2. The prepare step confirmed FKB was already foregrounded — `prepResult.coldRestart` is falsy.

If the device needed a cold restart during prepare, the screen framework hasn't mounted yet, so WS delivery won't work. Go straight to FKB `loadURL`.

## Delivery Flow (Load Step)

```
prepare confirms FKB foregrounded (coldRestart = false)
  │
  ▼
Check WS subscriber count for device topic
  │
  ├── 0 subscribers → skip to FKB loadURL
  │
  ▼
Broadcast content command via WS
  │
  ▼
Wait for content-ack (4s timeout)
  │
  ├── Ack received → done (no page refresh)
  │
  └── Timeout / error → fall back to FKB loadURL
```

## Ack Protocol

### Backend → Frontend (content command)

Standard WS broadcast on the device's screen topic. Payload is the same as existing WS content commands:

```json
{
  "topic": "living-room",
  "queue": "plex:642120",
  "shader": "dark",
  "shuffle": "1",
  "timestamp": 1711900000000
}
```

### Frontend → Backend (acknowledgment)

After `useScreenCommands` processes the content command and the Player overlay opens, the frontend sends back an ack:

```json
{
  "type": "content-ack",
  "screen": "living-room",
  "timestamp": 1711900000123
}
```

### Timeout

Backend waits **4 seconds** for the ack. This is generous — the screen framework processes WS commands synchronously (ActionBus emit → ScreenActionHandler → showOverlay). If 4s passes with no ack, something is wrong and the FKB page refresh is the right recovery.

## Changes

### `WakeAndLoadService` (backend)

The load step gains awareness of WS delivery. Before calling `device.loadContent()` (which goes through FKB), it checks:

1. Was this a warm prepare (no cold restart)?
2. Does the device support WS delivery? (new method on the content adapter or device)
3. Are there WS subscribers for this device's topic?

If all three: broadcast via WS, wait for ack. On success, set `result.steps.load = { ok: true, method: 'websocket' }`. On failure, proceed to `device.loadContent()` as before with `method: 'fkb-fallback'`.

### `FullyKioskContentAdapter` (backend)

Add a method to expose the device's WS topic and check subscriber readiness. Options:

- **Option A:** Add `tryWsDelivery(query)` directly to the adapter, giving it a reference to the WS bus. Returns `{ ok, acked }` or `{ ok: false }`.
- **Option B:** Keep the adapter focused on FKB. Let `WakeAndLoadService` handle the WS attempt using the broadcast function it already has.

**Recommendation: Option B.** The WakeAndLoadService already has `#broadcast` and the WS fallback logic (lines 253-288). Adding WS awareness to the FKB adapter muddles its responsibility. The orchestrator (WakeAndLoadService) decides the delivery strategy; the adapters just execute their specific protocol.

What the WakeAndLoadService needs from the infrastructure:
- `wsBus.getSubscribers(topic)` — already exists (used by `WebSocketContentAdapter.getStatus()`)
- `wsBus.broadcast(topic, payload)` — already exists
- A way to listen for a single `content-ack` response with a timeout — new. Implement as a `waitForMessage(predicate, timeoutMs)` method on the WS bus that returns a promise. Resolves on first message matching the predicate, rejects on timeout. Used once here, but generic enough to be useful elsewhere.

### `useScreenCommands` (frontend)

After handling a `queue` or `play` command that successfully opens the Player, send a `content-ack` back over WS.

The `WebSocketService` singleton already has a `send()` method (or equivalent) for outbound messages. The ack is a single small message.

### `WebSocketService` (frontend)

Verify that the `send()` or `emit()` method exists for outbound messages. If it only supports subscriptions (receive-only), add a `send(payload)` method that writes to the open socket.

## What Doesn't Change

- **Pipeline steps** — Still power → verify → volume → prepare → prewarm → load. No new step.
- **Progress events** — Phone UI still sees `load: running / done`. The WS attempt is an internal detail.
- **FKB `loadURL`** — Untouched. Remains the fallback path.
- **Office-tv and WS-only devices** — Unaffected. They already use `WebSocketContentAdapter` directly.
- **Cold-start path** — If FKB needed a cold restart, the entire existing flow runs as-is.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Screen connected but Player fails to mount | No ack sent, 4s timeout, FKB fallback refreshes page |
| Multiple WS subscribers on same topic | First ack wins, others ignored |
| WS disconnects mid-delivery | Ack never arrives, timeout triggers FKB fallback |
| Screen shows stale JS (FKB cache) | WS command may fail or ack may not be sent — FKB fallback refreshes with fresh content |
| Content command has no queue/play (just shader change) | Same WS-first logic applies — useScreenCommands already handles shader-only commands |

## Result Shape

Successful WS delivery:
```json
{
  "steps": {
    "load": { "ok": true, "method": "websocket", "ackMs": 120 }
  }
}
```

WS failed, FKB fallback:
```json
{
  "steps": {
    "load": { "ok": true, "method": "fkb-fallback", "wsError": "ack-timeout" }
  }
}
```

WS skipped (cold restart or no subscribers):
```json
{
  "steps": {
    "load": { "ok": true, "method": "fkb", "wsSkipped": "cold-restart" }
  }
}
```
