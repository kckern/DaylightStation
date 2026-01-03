# PRD: Bulletproof Message Bus for DaylightStation

## 1. Problem Statement
The current WebSocket implementation uses a "broadcast-to-all" approach. Every message from the backend (including high-frequency sensor data from the fitness extension) is sent to every connected client. Frontend applications must then implement complex filtering logic to ignore irrelevant messages. This leads to:
- **Excessive Bandwidth Usage**: Frontend apps receive data they don't need.
- **CPU Overhead**: Each client must parse and filter every single message.
- **Maintainability Issues**: Filtering logic (e.g., `isOfficeMessage`) is hardcoded in frontend contexts and becomes fragile as new message types are added.

## 2. Objectives
- **Server-Side Filtering**: Clients only receive messages they have subscribed to.
- **Typed Message Routing**: Standardized message format with mandatory `source` and `topic` fields.
- **Simplified Frontend Consumers**: Remove complex filtering predicates from frontend apps.
- **Persistence**: Subscriptions should automatically restore upon WebSocket reconnection.

## 3. Proposed Solution

### 3.1 Topic-Based Architecture
The message bus will move to a Publish/Subscribe model. 

#### Message Format
All messages MUST follow this structure:
```json
{
  "source": "string",  // e.g., "fitness-extension", "backend-api"
  "topic": "string",   // e.g., "vibration", "playback", "system"
  "payload": { ... },   // The actual data
  "timestamp": "ISO8601"
}
```

#### Protocol Commands
Clients interact with the bus using control messages:
- **SUBSCRIBE**: `{"type": "bus_command", "action": "subscribe", "topics": ["fitness", "vibration"]}`
- **UNSUBSCRIBE**: `{"type": "bus_command", "action": "unsubscribe", "topics": ["fitness"]}`

### 3.2 Backend Implementation (`websocket.mjs`)
- **Subscription Registry**: Map `ws` client objects to a `Set` of subscribed topics.
- **Smart Broadcast**: The `broadcastToWebsockets(data)` function will be updated to:
    1. Identify the message `topic`.
    2. Only send to clients whose subscription set contains that `topic`.
- **System Topics**: Certain topics (e.g., `connection_status`) might be broadcast to all by default.

### 3.3 Frontend Implementation (`WebSocketService.js`)
- **Centralized Registry**: Maintain a list of active subscriptions.
- **Protocol Integration**: Automatically send `SUBSCRIBE` commands to the backend when `wsService.subscribe()` is called.
- **Reconnection Logic**: On `onopen`, re-send all active subscriptions to the backend to restore routing.
- **Simplified `_dispatch`**: Remove the heavy `filter` functions and rely on backend-provided relevance, while still allowing light local dispatching for overlapping topics.

### 3.4 Migration Plan
1.  **Phase 1**: Update Backend to support `SUBSCRIBE` command but keep broadcasting by default for backward compatibility.
2.  **Phase 2**: Update `WebSocketService.js` to send `SUBSCRIBE` commands.
3.  **Phase 3**: Toggle Backend to "opt-in only" mode, where clients receive nothing unless subscribed (except for legacy fallback topics).
4.  **Phase 4**: Refactor `OfficeApp` and `FitnessApp` to use simple topic strings instead of predicate functions.

## 4. Success Criteria
- [ ] OfficeApp receives 0% of fitness sensor data.
- [ ] FitnessApp only receives vibration and fitness data unless explicitly asking for more.
- [ ] `isOfficeMessage` predicate in `WebSocketContext.jsx` can be replaced with a simple topic list.
- [ ] No regression in message delivery latency.

## 5. Security & Performance
- **Rate Limiting**: Backend should monitor high-frequency topics (like vibration) and ensure they don't swamp the bus.
- **Validation**: Strict Zod-based validation of message structures on the backend before routing.

---

## 6. Detailed Technical Design

### 6.1 Backend WebSocket Extension (`backend/routers/websocket.mjs`)

#### Client Management
Each `ws` client will be assigned a metadata object containing its subscriptions.
```javascript
// State structure in wssNav.clients
client._busMeta = {
  subscriptions: new Set(['*']), // Default to wildcard for Phase 1
  id: uuid()
};
```

#### Command Processing
The `message` handler will intercept `type: "bus_command"` messages before routing them as data.
```javascript
if (data.type === 'bus_command') {
  handleBusCommand(ws, data);
  return;
}
```

#### Routing Logic
`broadcastToWebsockets(data)` will be updated to:
```javascript
const topic = data.topic || 'legacy';
wssNav.clients.forEach(client => {
  const subs = client._busMeta?.subscriptions;
  if (subs && (subs.has(topic) || subs.has('*'))) {
     client.send(JSON.stringify(data));
  }
});
```

### 6.2 Frontend Service (`frontend/src/services/WebSocketService.js`)

#### Subscription Persistence
The service will maintain a local registry of topics requested by the application.
```javascript
class WebSocketService {
  constructor() {
    this.activeTopics = new Set();
    // ... existing props
  }
  
  subscribe(filter, callback) {
    if (typeof filter === 'string') this.activeTopics.add(filter);
    if (Array.isArray(filter)) filter.forEach(t => this.activeTopics.add(t));
    
    this._syncSubscriptions(); // Send current set to backend
    // ... existing logic
  }
}
```

#### Connection Recovery
On every `onopen` event, the service will "refresh" the backend with its currently required topics.
```javascript
this.ws.onopen = () => {
  this._syncSubscriptions();
  // ... existing flush
};
```

---

## 7. Phased Implementation Plan

### Phase 1: Robust Backend Infrastructure (Target: Today)
- [ ] Implement `_busMeta` on WebSocket clients.
- [ ] Add `handleBusCommand` to process `subscribe` and `unsubscribe` actions.
- [ ] Refactor `broadcastToWebsockets` to use the subscription set.
- [ ] **Default**: Set new clients to `subscriptions: ['*']` to ensure zero breaking changes.

### Phase 2: Frontend Service Protocol (Target: Tomorrow)
- [ ] Update `WebSocketService.js` to track active topics for the current session.
- [ ] Implement `_syncSubscriptions()` to send `bus_command` to backend.
- [ ] Verify that `wsService` correctly re-subscribes after a simulated network drop.

### Phase 3: Consumer Migration & Logic Simplification
- [ ] **Fitness**: Update `FitnessContext` to subscribe to `['fitness', 'vibration']`.
- [ ] **Office**: Update `WebSocketContext` to subscribe to `['playback', 'menu', 'system']`.
- [ ] **Logic**: Remove the manual `isOfficeMessage` predicate from `WebSocketContext.jsx` and rely on the stream.

### Phase 4: Full Cut-over & Optimization
- [ ] Change Backend default subscription from `['*']` to `['system']` (opt-in mode).
- [ ] Monitor CPU/Memory on the backend for routing overhead.
- [ ] Remove legacy "broadcast-all" code paths.
