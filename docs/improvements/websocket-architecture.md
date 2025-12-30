# WebSocket Architecture Improvement Plan

## Current State Analysis

### Problem Summary

The DaylightStation frontend has **three separate WebSocket handling patterns** across different apps, leading to:
- Code duplication
- Inconsistent message filtering
- Cross-talk bugs (e.g., vibration data triggering OfficeApp menus)
- No centralized message routing
- Each app maintains its own connection logic

### Current Architecture

```
                           ┌─────────────────────────────────────┐
                           │     Backend WebSocket Server        │
                           │     (backend/routers/websocket.mjs) │
                           └──────────────┬──────────────────────┘
                                          │
                                          │ broadcastToWebsockets()
                                          │ (broadcasts ALL messages to ALL clients)
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              │                           │                           │
              ▼                           ▼                           ▼
┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐
│      OfficeApp          │ │      FitnessApp         │ │       TVApp             │
│  WebSocketContext.jsx   │ │   FitnessContext.jsx    │ │   (No WS handling)      │
│                         │ │                         │ │                         │
│  - Own WS connection    │ │  - Own WS connection    │ │  - Uses query params    │
│  - Whitelist filter     │ │  - topic filter         │ │  - No real-time updates │
│  - payloadCallback      │ │  - session.ingestData() │ │                         │
└─────────────────────────┘ └─────────────────────────┘ └─────────────────────────┘
```

### App-Specific WebSocket Handling

| App | Location | Connection | Filtering | Message Types |
|-----|----------|------------|-----------|---------------|
| **OfficeApp** | `WebSocketContext.jsx` | Shared context | Whitelist | menu, playback, gratitude, content |
| **FitnessApp** | `FitnessContext.jsx` | Own connection | topic-based | fitness, vibration |
| **TVApp** | N/A | None | N/A | Uses URL params only |

### Message Sources (Backend)

| Source | Topic | Destination App(s) |
|--------|-------|-------------------|
| `mqtt.mjs` | `vibration` | FitnessApp only |
| `websocket.mjs` | `fitness` | FitnessApp only |
| `/exe/ws` endpoint | (various) | OfficeApp |
| `gratitude.mjs` | `gratitude_item` | OfficeApp |
| `homebot` | `gratitude` | OfficeApp |

---

## Proposed Architecture

### Option A: Unified WebSocket Service (Recommended)

Create a centralized WebSocket service that all apps can subscribe to with topic-based filtering.

```
                           ┌─────────────────────────────────────┐
                           │     Backend WebSocket Server        │
                           └──────────────┬──────────────────────┘
                                          │
                                          ▼
                           ┌─────────────────────────────────────┐
                           │     WebSocketService (singleton)    │
                           │                                     │
                           │  - Single connection                │
                           │  - Topic-based subscriptions        │
                           │  - Auto-reconnect                   │
                           │  - Message queue during disconnect  │
                           └──────────────┬──────────────────────┘
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              │                           │                           │
              ▼                           ▼                           ▼
     subscribe('office')         subscribe('fitness')        subscribe('tv')
     subscribe('gratitude')      subscribe('vibration')      subscribe('playback')
              │                           │                           │
              ▼                           ▼                           ▼
┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐
│      OfficeApp          │ │      FitnessApp         │ │       TVApp             │
└─────────────────────────┘ └─────────────────────────┘ └─────────────────────────┘
```

#### Implementation: `WebSocketService.js`

```javascript
// frontend/src/services/WebSocketService.js

class WebSocketService {
  constructor() {
    this.ws = null;
    this.subscribers = new Map(); // topic -> Set<callback>
    this.connected = false;
    this.reconnectAttempts = 0;
    this.messageQueue = []; // Buffer messages during reconnect
  }

  connect() {
    if (this.ws?.readyState === WebSocket.CONNECTING) return;
    
    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.flushMessageQueue();
    };
    
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.dispatch(data);
      } catch (e) {
        // ignore non-JSON
      }
    };
    
    this.ws.onclose = () => {
      this.connected = false;
      this.scheduleReconnect();
    };
  }

  /**
   * Subscribe to messages matching a filter
   * @param {string|string[]|function} filter - Topic name(s) or predicate function
   * @param {function} callback - Called with matching messages
   * @returns {function} Unsubscribe function
   */
  subscribe(filter, callback) {
    const key = typeof filter === 'function' ? filter : JSON.stringify(filter);
    
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, { filter, callbacks: new Set() });
    }
    
    this.subscribers.get(key).callbacks.add(callback);
    
    // Return unsubscribe function
    return () => {
      const sub = this.subscribers.get(key);
      if (sub) {
        sub.callbacks.delete(callback);
        if (sub.callbacks.size === 0) {
          this.subscribers.delete(key);
        }
      }
    };
  }

  dispatch(data) {
    for (const [, { filter, callbacks }] of this.subscribers) {
      let matches = false;
      
      if (typeof filter === 'function') {
        matches = filter(data);
      } else if (Array.isArray(filter)) {
        matches = filter.includes(data.topic) || filter.includes(data.type);
      } else if (typeof filter === 'string') {
        matches = data.topic === filter || data.type === filter;
      }
      
      if (matches) {
        for (const cb of callbacks) {
          try {
            cb(data);
          } catch (err) {
            console.error('WebSocket subscriber error:', err);
          }
        }
      }
    }
  }

  send(data) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  // ... reconnect logic, cleanup, etc.
}

// Singleton export
export const wsService = new WebSocketService();
```

#### Usage in Apps

**FitnessContext.jsx:**
```javascript
import { wsService } from '../services/WebSocketService';

useEffect(() => {
  // Subscribe to fitness and vibration topics
  const unsubscribe = wsService.subscribe(
    ['fitness', 'vibration'],
    (data) => {
      if (data.topic === 'vibration') {
        handleVibrationEvent(data);
      } else {
        session.ingestData(data);
      }
    }
  );
  
  return unsubscribe;
}, []);
```

**OfficeApp (via WebSocketContext):**
```javascript
import { wsService } from '../services/WebSocketService';

useEffect(() => {
  // Subscribe using a predicate function for complex filtering
  const unsubscribe = wsService.subscribe(
    (data) => {
      // Whitelist logic
      if (data.menu || data.playback || data.action) return true;
      if (data.hymn || data.scripture || data.talk || data.primary || data.plex) return true;
      if (data.play || data.queue) return true;
      if (data.type === 'gratitude_item' || data.type === 'gratitude') return true;
      return false;
    },
    (data) => payloadCallbackRef.current?.(data)
  );
  
  return unsubscribe;
}, []);
```

---

### Option B: Backend Topic-Based Channels

Create separate WebSocket endpoints for different message categories.

```
Backend:
  /ws/office    → Menu commands, playback, gratitude
  /ws/fitness   → ANT+ data, heart rate, cadence
  /ws/sensors   → MQTT vibration, environmental data
  /ws/broadcast → System-wide announcements
```

**Pros:**
- Clean separation at the server level
- Clients only connect to channels they need
- Reduces bandwidth per client

**Cons:**
- Multiple connections per app if it needs multiple topics
- More complex backend routing
- Breaking change for existing integrations

---

### Option C: Message Bus Pattern (EventEmitter)

Use a frontend event bus that wraps the WebSocket.

```javascript
// frontend/src/services/MessageBus.js
import { EventEmitter } from 'events';

class MessageBus extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
  }

  connect() {
    // ... WebSocket setup
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // Emit by topic
      if (data.topic) {
        this.emit(data.topic, data);
      }
      
      // Emit by type
      if (data.type) {
        this.emit(`type:${data.type}`, data);
      }
      
      // Always emit to wildcard
      this.emit('*', data);
    };
  }
}

export const messageBus = new MessageBus();
```

**Usage:**
```javascript
// FitnessApp
messageBus.on('fitness', handleFitnessData);
messageBus.on('vibration', handleVibrationData);

// OfficeApp
messageBus.on('type:gratitude_item', handleGratitude);
messageBus.on('type:gratitude', handleGratitude);
```

---

## Recommended Implementation Plan

### Phase 1: Create WebSocketService (Week 1)

1. Create `frontend/src/services/WebSocketService.js`
2. Implement singleton with:
   - Single connection management
   - Topic-based subscription API
   - Predicate-based subscription for complex filtering
   - Auto-reconnect with exponential backoff
   - Connection status observable

### Phase 2: Migrate FitnessContext (Week 2)

1. Replace inline WebSocket code with `wsService.subscribe()`
2. Test heart rate, cadence, and vibration data flow
3. Verify no regressions in FitnessApp

### Phase 3: Migrate WebSocketContext (Week 2)

1. Replace inline WebSocket code with `wsService.subscribe()`
2. Move whitelist logic into subscription predicate
3. Test OfficeApp menu, playback, gratitude flows

### Phase 4: Add TVApp Real-Time Support (Week 3)

1. Add WebSocket subscription for playback commands
2. Enable remote control of TVApp via WebSocket
3. Add `playback` topic support

### Phase 5: Cleanup & Documentation (Week 3)

1. Remove duplicate WebSocket code from contexts
2. Add TypeScript types for message schemas
3. Document message topics and payloads
4. Add logging/debugging tools

---

## Message Schema Standardization

### Proposed Message Format

```typescript
interface WebSocketMessage {
  // Required: Message routing
  topic: 'fitness' | 'vibration' | 'office' | 'gratitude' | 'playback' | 'system';
  
  // Optional: Sub-categorization
  type?: string;
  action?: string;
  
  // Required: Traceability
  timestamp: string; // ISO 8601
  source: string;    // Origin identifier
  
  // Payload
  data?: Record<string, unknown>;
}
```

### Topic Registry

| Topic | Types | Description |
|-------|-------|-------------|
| `fitness` | `ant`, `session`, `user` | Fitness session data |
| `vibration` | - | MQTT sensor telemetry |
| `office` | `menu`, `playback`, `reset` | OfficeApp commands |
| `gratitude` | `item`, `list` | Gratitude display |
| `playback` | `play`, `pause`, `next`, `stop` | Media control |
| `system` | `restart`, `config` | System-wide events |

---

## Migration Checklist

- [x] Create `WebSocketService.js` singleton
- [x] Add subscription API with topic/predicate support
- [x] Add connection status hook `useWebSocketStatus()`
- [x] Migrate `FitnessContext.jsx` to use service
- [x] Migrate `WebSocketContext.jsx` to use service
- [x] Remove duplicate connection code
- [ ] Add TVApp WebSocket support
- [ ] Standardize message schemas
- [ ] Add TypeScript definitions
- [ ] Update backend to use consistent topics
- [ ] Add integration tests
- [ ] Document API for external integrations

---

## Benefits

1. **Single Connection**: One WebSocket per browser tab instead of 2+
2. **Consistent Filtering**: Centralized topic-based routing
3. **No Cross-Talk**: Apps only receive messages they subscribe to
4. **Easier Debugging**: Single point to log/trace all messages
5. **Better Reconnect**: Shared reconnection logic with buffering
6. **Type Safety**: Standardized message schemas
7. **Testability**: Mock the service for unit tests
