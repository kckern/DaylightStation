# WebSocket Broadcast Targeting Audit

**Date:** 2026-03-31
**Trigger:** Barcode scan targeted at `office` plays content on both office AND living room screens.

## Symptom

```
GET /api/v1/device/livingroom-tv/load?queue=plex:59493&shuffle=1
```
Content plays on BOTH living room TV and office screen.

Barcode scan of `plex:593939` with `shuffle` targeted at `office` also plays on both screens.

## Root Cause

**Three compounding issues:**

### Issue 1: Wildcard subscriptions defeat topic-based routing

The EventBus broadcasts to clients subscribed to the **message topic** OR **`*` (wildcard)**:

```javascript
// WebSocketEventBus.mjs line 240
if (subs.has(topic) || subs.has('*')) {
  ws.send(msg);
}
```

`useScreenCommands` uses a **predicate filter** (function), which causes `WebSocketService._syncSubscriptions()` to request a wildcard:

```javascript
// WebSocketService.js line 255
} else if (typeof filter === 'function') {
  // Predicate functions currently require a wildcard because we can't
  // evaluate them on the backend.
  needsWildcard = true;
}
```

**Result:** The living room screen subscribes to `*` and receives EVERY broadcast in the system, regardless of topic. Topic-based routing is meaningless when any screen with a predicate filter gets everything.

### Issue 2: Barcode service doesn't include `targetDevice` in payload

BarcodeScanService broadcasts with `targetScreen` as the WS **topic**, but the payload contains no `targetDevice` field:

```javascript
// BarcodeScanService.mjs line 122
this.#broadcastEvent(targetScreen, {
  action,
  contentId: payload.contentId,
  ...(payload.options || {}),
  source: 'barcode',
  device: payload.device,    // ← scanner device ID, NOT target device
});
```

The `useScreenCommands` guardrail checks `data.targetDevice`, which is `undefined`:

```javascript
// useScreenCommands.js line 42
if (data.targetDevice && g.device && data.targetDevice !== g.device) {
  return; // never reached — data.targetDevice is undefined
}
```

Since `undefined` is falsy, the entire guard is skipped. Both screens process the command.

### Issue 3: WakeAndLoadService WS-first broadcast has same problem

The WS-first path (commit `e227532`) and the existing WS fallback both broadcast content commands. While they include `targetDevice: deviceId`, the broadcast goes to topic `homeline:${deviceId}`. But wildcard subscribers still receive it. The `targetDevice` guard works here only because WakeAndLoadService sets it — but the barcode path doesn't.

## Data Flow Trace

### Barcode scan for office:

```
Scanner → MQTT → BarcodeScanService
  → broadcastEvent("office", { action:"play", contentId:"plex:593939", source:"barcode" })
    → eventBus.broadcast("office", payload)
      → Office screen: subscribed to ["office","playback","menu","system","gratitude"] → RECEIVES ✓
      → Living room screen: subscribed to ["*"] (predicate wildcard) → RECEIVES ✗ (should not)
        → useScreenCommands predicate: msg.play? no. msg.queue? no. msg.source==='barcode'? YES → processes it
        → targetDevice check: data.targetDevice is undefined → guard skipped → PLAYS CONTENT
```

### WakeAndLoadService load for livingroom-tv:

```
/load?queue=plex:59493 → WakeAndLoadService
  → broadcast({ topic:"homeline:livingroom-tv", targetDevice:"livingroom-tv", queue:"plex:59493" })
    → eventBus.broadcast("homeline:livingroom-tv", payload)
      → Living room: subscribed to ["*"] → RECEIVES ✓
        → targetDevice="livingroom-tv", guardrails.device="livingroom-tv" → match → processes it
      → Office: subscribed to ["office","playback","menu","system","gratitude"] → NOT subscribed → doesn't receive
        BUT if office used predicate filter → would receive → would check targetDevice → would reject (office-tv ≠ livingroom-tv)
```

The `/load` path works because: (a) the topic is device-specific, and (b) `targetDevice` is set. But it only works by coincidence — the office screen uses topic-based subscription, so it doesn't receive `homeline:livingroom-tv`. If office ever switched to predicate-based subscription, it would receive and need to filter.

## All Broadcast Sources (Content Commands)

| Source | Topic | Has targetDevice? | Risk |
|--------|-------|--------------------|------|
| BarcodeScanService content | `targetScreen` (e.g., "office") | **NO** | **HIGH — wildcard subscribers receive + no guard** |
| BarcodeScanService command | `targetScreen` | **NO** | **HIGH — same issue** |
| WakeAndLoadService WS-first | `homeline:${deviceId}` | YES | Low — guard works |
| WakeAndLoadService WS fallback | `homeline:${deviceId}` | YES | Low — guard works |
| WakeAndLoadService old WS fallback | uses `contentQuery` spread | YES (since 890bacea) | Low |

## All Frontend Consumers

| Consumer | Subscription | Has targetDevice guard? | Has topic guard? |
|----------|-------------|------------------------|-----------------|
| useScreenCommands (living-room) | Predicate → wildcard `*` | YES (but needs payload to set it) | Partial (blocked_topics only) |
| OfficeApp websocketHandler | Topics: `["office","playback","menu","system","gratitude"]` | YES (hardcoded "office-tv") | Implicit (topic-filtered) |
| useScreenSubscriptions | Topic array from YAML | N/A (overlay system) | YES (topic match) |
| useMediaQueue | `"media:queue"` | NO | Implicit (topic-filtered) |

## The Fix

The problem has two layers:

**Layer 1 (immediate):** BarcodeScanService must include targeting info so the client-side guard works.

**Layer 2 (structural):** Wildcard subscriptions are a design debt. Any component using a predicate filter subscribes to `*` and relies entirely on client-side filtering. This is fragile — one missing guard and content leaks across screens.

### Recommended Fix

**BarcodeScanService** should map `targetScreen` → device ID and include it as `targetDevice` in the payload. The mapping exists in `devices.yml` — each device has a `content_control.topic` (for WS devices like office-tv) or can be mapped from screen config.

However, the cleanest approach is: **don't use `targetDevice` at all. Use the screen ID that both sides already know.**

The barcode broadcast topic IS the screen name (e.g., "office"). The screen knows its own `screenId` (e.g., "living-room"). The fix:

```javascript
// useScreenCommands — reject messages whose topic is a different screen
if (data.topic && screenIdRef.current && data.source === 'barcode') {
  if (data.topic !== screenIdRef.current) {
    return; // barcode meant for a different screen
  }
}
```

This is clean because:
- No mapping needed between screen IDs and device IDs
- The barcode service already broadcasts on the correct topic
- The screen already knows its own ID
- Only applies to barcode-sourced messages (other broadcasts have their own targeting)

But this still relies on client-side filtering over a wildcard subscription. The structural fix would be to make `useScreenCommands` subscribe to its own screen topic instead of `*`, but that requires the predicate-to-topic migration noted in WebSocketService.js.

### Pragmatic short-term fix

Add screen-level topic filtering in `useScreenCommands` for barcode messages, AND add `targetDevice` to BarcodeScanService for defense-in-depth.
