# WebSocket Topic Routing Design

**Date:** 2026-01-20
**Status:** Ready for implementation

## Problem Statement

OfficeApp was receiving unintended WebSocket messages (MQTT sensor data, fitness telemetry) because:

1. The `'legacy'` topic acted as a catch-all for any message without an explicit topic
2. A bug in `broadcastEvent('sensor', payload)` sent the string `'sensor'` as the payload with `topic: 'legacy'`
3. The `/exe/ws` endpoint broadcasts messages without setting a topic, defaulting to `'legacy'`

This caused the Player component to spin trying to "play" sensor data.

## Design

### Approach: Remove Legacy Topic

Remove the `'legacy'` catch-all and require all OfficeApp-bound messages to use explicit topics.

### Changes Required

#### 1. Frontend: Remove Legacy Topic

**File:** `frontend/src/contexts/WebSocketContext.jsx`

```javascript
// Before
const OFFICE_TOPICS = ['playback', 'menu', 'system', 'gratitude', 'legacy'];

// After
const OFFICE_TOPICS = ['playback', 'menu', 'system', 'gratitude'];
```

#### 2. Backend: Default Topic for /exe/ws

**File:** `backend/_legacy/routers/exe.mjs`

Update the `/exe/ws` endpoint to add a default topic:

```javascript
const message = {
    topic: payload.topic || 'playback',  // Default to playback for office commands
    timestamp: new Date().toISOString(),
    ...payload
};
```

This ensures Home Assistant automations (which don't set topic) continue working.

### Already Completed

These fixes were applied during the debugging session:

1. **MQTT broadcast fix** (`backend/src/app.mjs`):
   ```javascript
   // Before (broken - 'sensor' became the payload)
   broadcastEvent('sensor', payload);

   // After (fixed)
   broadcastEvent({ topic: 'sensor', ...payload });
   ```

2. **Logging improvements** (`frontend/src/lib/OfficeApp/websocketHandler.js`):
   - Replaced `console.log` with proper logger
   - Logs now pipe to backend via WebSocket transport
   - Added guardrails for blocked topics/sources

## Message Flow After Changes

```
[Home Assistant]
      |
      v
  /exe/ws endpoint
      |
      | topic: 'playback' (default)
      v
  EventBus.broadcast('playback', message)
      |
      v
  WebSocket clients subscribed to 'playback'
      |
      v
  OfficeApp receives message
```

```
[MQTT Sensor]
      |
      v
  MQTTSensorAdapter
      |
      | topic: 'sensor'
      v
  EventBus.broadcast('sensor', message)
      |
      v
  FitnessApp (subscribed to 'sensor')
  OfficeApp (NOT subscribed - message ignored)
```

## Valid Topics for OfficeApp

| Topic | Purpose |
|-------|---------|
| `playback` | Play/queue media, playback controls |
| `menu` | Open menus, navigate UI |
| `system` | System commands (reset, shader changes) |
| `gratitude` | Gratitude card notifications |

## Defense in Depth

The websocketHandler.js guardrails remain as secondary protection:

```javascript
const BLOCKED_TOPICS = ['vibration', 'fitness', 'sensor', 'telemetry', 'logging'];
const BLOCKED_SOURCES = ['mqtt', 'fitness', 'fitness-simulator', 'playback-logger'];
```

These catch any messages that somehow bypass topic filtering.

## Testing

After implementation:

1. Send a test command via Home Assistant - should play on OfficeApp
2. Trigger MQTT sensor - should NOT appear in OfficeApp logs
3. Check Docker logs for `office.websocket.selection` events

## Rollback

If issues occur, revert by adding `'legacy'` back to `OFFICE_TOPICS`. This is a safe, reversible change.
