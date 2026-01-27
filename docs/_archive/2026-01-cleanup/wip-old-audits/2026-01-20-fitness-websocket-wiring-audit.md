# Fitness WebSocket Wiring Audit

**Date:** 2026-01-20
**Status:** Root cause identified

## Problem Statement

HR data from the garage server (daylight-fitness container) is not appearing in the frontend FitnessContext, despite the garage showing active HR readings in logs.

## Architecture Overview

```
[Garage Server]          [Homeserver]              [Frontend]
daylight-fitness  --->   daylight-station   --->   FitnessContext
    |                         |                         |
    |  WebSocket              |  EventBus               |  WebSocket
    |  wss://daylightlocal    |  broadcast('fitness')   |  subscribe('fitness')
    |  .kckern.net:443/ws     |                         |
    v                         v                         v
ANT+ HR Monitor        Message Handler         session.ingestData()
```

## Data Flow Analysis

### 1. Garage → Homeserver Connection

**Configuration:**
- Host: `daylightlocal.kckern.net` (resolves to 10.0.0.10)
- Port: 443 (wss:// via HTTPS proxy)
- Path: `/ws`

**Status:** Connection established but unstable (frequent reconnects every ~30 seconds)

### 2. Homeserver Message Handler

Located in `backend/src/app.mjs:179-185`:

```javascript
eventBus.onClientMessage((clientId, message) => {
  // Fitness controller messages - rebroadcast to all fitness subscribers
  if (message.source === 'fitness' || message.source === 'fitness-simulator') {
    eventBus.broadcast('fitness', message);
    return;
  }
  // ... messages without source are silently dropped
});
```

**Requirement:** Messages MUST have `source: 'fitness'` to be rebroadcast.

### 3. BLE Manager (Working)

Located in `garage:/usr/src/app/src/decoders/jumprope.mjs`:

```javascript
formatForWebSocket(deviceConfig) {
  return {
    topic: 'fitness',
    source: 'fitness',  // ✅ Correct
    type: 'ble_jumprope',
    // ...
  };
}
```

### 4. ANT+ Manager (Broken)

Located in `garage:/usr/src/app/src/ant.mjs`:

```javascript
this.broadcastFitnessData({
  type: 'ant',
  profile,
  deviceId,
  dongleIndex: deviceIndex,
  data  // Contains HR
});  // ❌ Missing source: 'fitness'
```

**Bug:** ANT+ messages are missing `source: 'fitness'`, causing the homeserver to silently drop them.

## Root Cause

**The ANT+ manager in the garage fitness container does not set `source: 'fitness'` on outgoing messages.**

The homeserver's message handler requires this field to identify fitness data and rebroadcast it to frontend clients. Without it, messages are dropped with no error logging.

## Evidence

1. Garage logs show HR data being received:
   ```
   [04:54:42] 40475 HR: HR:99
   [04:54:28] 40475 HR: HR:88
   ```

2. Homeserver logs show no fitness data being processed:
   - No `eventbus.fitness.broadcast` logs
   - No `websocket.unknown_source` warnings (messages don't reach handler)

3. WebSocket reconnection pattern indicates unstable connection:
   ```
   ⚠️  WebSocket connection lost, will retry...
   🔄 Scheduling WebSocket reconnection...
   ✅ WebSocket reconnected successfully
   ```

## Recommended Fix

In `garage:/usr/src/app/src/ant.mjs`, modify the `broadcastFitnessData` call to include `source`:

```javascript
this.broadcastFitnessData({
  topic: 'fitness',        // Add this
  source: 'fitness',       // Add this
  type: 'ant',
  profile,
  deviceId,
  dongleIndex: deviceIndex,
  data
});
```

## Secondary Issue: WebSocket Instability

The garage container shows frequent WebSocket reconnections (~every 30 seconds). This may be caused by:

1. HTTPS proxy timeout settings
2. Nginx Proxy Manager keepalive configuration
3. WebSocket heartbeat/ping-pong not implemented

This should be investigated separately but is not blocking - data should flow during connected periods once the `source` field is added.

## Related Files

| Location | File | Purpose |
|----------|------|---------|
| Garage | `/usr/src/app/src/ant.mjs` | ANT+ HR monitoring (needs fix) |
| Garage | `/usr/src/app/src/decoders/jumprope.mjs` | BLE decoder (correct format) |
| Homeserver | `backend/src/app.mjs:179-185` | Message handler (expects source) |
| Frontend | `frontend/src/context/FitnessContext.jsx:982-1027` | WebSocket subscription |
