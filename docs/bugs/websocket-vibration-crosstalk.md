# WebSocket Vibration Crosstalk Bug

## Summary
The OfficeApp's websocket handler is being triggered by MQTT vibration messages, causing unintended behavior. Vibration sensor data broadcasted from `mqtt.mjs` is leaking into the OfficeApp's command handler.

## Data Flow Diagram

```
[Zigbee Sensor] → [MQTT Broker] → [mqtt.mjs] → [broadcastToWebsockets()]
                                                        ↓
                                              [All WS Clients]
                                                   /        \
                                                  ↓          ↓
                                         [FitnessApp]   [OfficeApp] ← PROBLEM
                                         (filtered)     (NOT filtered)
```

## Root Cause Analysis

### 1. Backend: mqtt.mjs broadcasts to ALL websocket clients
In [mqtt.mjs#L186](../backend/lib/mqtt.mjs), vibration data is broadcast to all clients:
```javascript
broadcastToWebsockets(payload);
```

The payload structure:
```javascript
{
  topic: 'vibration',
  source: 'mqtt',
  equipmentId: 'punching_bag',
  equipmentName: 'Punching Bag',
  equipmentType: 'cardio',
  thresholds: { low: 5, medium: 15, high: 30 },
  timestamp: 1735507200000,
  data: {
    vibration: true,
    x_axis: 12.5,
    y_axis: -8.3,
    z_axis: 4.2,
    battery: 85,
    battery_low: false,
    linkquality: 150
  }
}
```

### 2. Frontend: WebSocketContext.jsx partially filters
In [WebSocketContext.jsx#L87-L91](../frontend/src/contexts/WebSocketContext.jsx), only `topic: 'fitness'` is filtered:
```javascript
// Filter out fitness messages - they'll be handled by FitnessApp separately
if (data.topic === 'fitness') {
  return;
}
```

**BUG**: Vibration messages have `topic: 'vibration'`, NOT `topic: 'fitness'`, so they pass through!

### 3. Frontend: websocketHandler.js tries to process as menu command
In [websocketHandler.js#L77-L140](../frontend/src/lib/OfficeApp/websocketHandler.js), the handler receives the vibration payload and attempts to interpret it:

```javascript
return (data) => {
  setLastPayloadMessage(data);  // ← Vibration data stored here
  delete data.timestamp;

  // data.menu = undefined, skips this
  if (data.menu) { ... }

  // data.action = undefined, skips this
  if (data.action === "reset") { ... }

  // data.playback = undefined, skips this
  if (data.playback) { ... }

  // Falls through to action determination logic!
  const hasPlayKey = Object.keys(data).includes('play');  // false
  const hasQueueKey = Object.keys(data).includes('queue');  // false
  const isContentItem = data.hymn || data.scripture || data.talk || data.primary;  // all undefined
  const isPlaylistItem = ...  // false

  const action = data.action || ... || 'play';  // defaults to 'play'!

  const selection = {
    label: "wscmd",
    play: data  // ← Entire vibration payload passed as "play" command!
  };

  handleMenuSelection(selection);  // ← TRIGGERS MENU SYSTEM
};
```

## Impact

Every vibration MQTT message (~0.5-2 per second during activity):
1. Gets passed to `handleMenuSelection()`
2. May trigger UI state changes
3. Logs `{selection}` to console (polluting logs)
4. Could potentially trigger Player component or other unintended actions

## Solution Options

### Option A: Filter `topic: 'vibration'` in WebSocketContext (Recommended)
Add vibration to the filter list in WebSocketContext.jsx:

```javascript
// Filter out fitness and vibration messages - handled elsewhere
if (data.topic === 'fitness' || data.topic === 'vibration') {
  return;
}
```

**Pros**: Simple, single point of filtering
**Cons**: Must remember to add new sensor topics

### Option B: Whitelist approach in WebSocketContext
Only process messages with expected topics:

```javascript
const OFFICE_TOPICS = ['menu', 'playback', 'command', 'gratitude'];
if (data.topic && !OFFICE_TOPICS.includes(data.topic)) {
  return;
}
```

**Pros**: More defensive, unknown topics ignored
**Cons**: May miss legitimate new topics

### Option C: Guard in websocketHandler.js
Add early return for sensor data:

```javascript
return (data) => {
  // Ignore sensor telemetry data
  if (data.source === 'mqtt' || data.topic === 'vibration') {
    return;
  }
  // ... rest of handler
};
```

**Pros**: Handler-specific filtering
**Cons**: Duplicate filtering logic

### Option D: Separate WebSocket channels (Backend change)
Create separate WS endpoints for different data types:
- `/ws/nav` - Navigation/menu commands
- `/ws/sensors` - MQTT sensor telemetry
- `/ws/fitness` - Fitness app data

**Pros**: Clean separation of concerns
**Cons**: Larger refactor, multiple connections

## Recommended Fix

**Option A** - Add vibration filter in WebSocketContext.jsx at line 87:

```javascript
// Filter out fitness and vibration messages - handled by dedicated contexts
if (data.topic === 'fitness' || data.topic === 'vibration') {
  return;
}
```

This is the minimal change that fixes the immediate issue while maintaining consistency with the existing fitness filtering pattern.

## Testing

1. Run vibration simulation: `node ./_extentions/fitness/vibration-simulation.mjs`
2. Open OfficeApp in browser
3. Verify no unexpected UI changes or console spam
4. Verify FitnessApp still receives vibration data correctly
