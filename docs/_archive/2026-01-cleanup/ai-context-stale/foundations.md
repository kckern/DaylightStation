# Foundations Context

Shared components and services used across multiple apps.

## Player.jsx

**Location:** `frontend/src/modules/Player/`

**Purpose:** Media playback system - video, audio, streaming content.

**Key Features:**
- Shaka Player integration for streaming
- Plex media playback
- Playback state management
- Event callbacks (onPlay, onPause, onEnd)
- Resilience/error recovery

**Backend Dependencies:**
- `routers/media.mjs` - Media endpoints
- `lib/plex.mjs` - Plex API integration
- `routers/plexProxy.mjs` - Plex stream proxy

**Usage:**
```jsx
import Player from '../modules/Player/Player';

<Player
  src={mediaUrl}
  onEnded={handleNext}
  autoPlay={true}
/>
```

**Used By:** TVApp, FitnessApp, OfficeApp

---

## WebSocket / MessageBus

**Location:**
- Backend: `backend/routers/websocket.mjs`
- Frontend: `frontend/src/lib/` or direct WebSocket

**Purpose:** Real-time bidirectional communication.

**Message Types:**
- Fitness updates (heart rate, zones, session state)
- Media control commands
- Home automation events
- Log forwarding

**Backend Pattern:**
```javascript
// Broadcasting
wss.clients.forEach(client => {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ type: 'fitness.update', data }));
  }
});
```

**Frontend Pattern:**
```javascript
const ws = new WebSocket(`ws://${host}:${port}`);
ws.onmessage = (event) => {
  const { type, data } = JSON.parse(event.data);
  // Handle message by type
};
```

**Used By:** All apps for real-time updates

---

## ContentScroller

**Location:** `frontend/src/modules/ContentScroller/`

**Purpose:** Scrolling content display with configurable behavior.

**Key Features:**
- Horizontal/vertical scrolling
- Auto-scroll with configurable speed
- Content item rendering
- Navigation controls

**Used By:** TVApp, OfficeApp

---

## DaylightLogger

**Location:**
- Backend: `backend/lib/logging/`
- Frontend: `frontend/src/lib/logging/`

**Purpose:** Structured event-based logging with WebSocket transport.

**Pattern:**
```javascript
import { getLogger } from './lib/logging';

const logger = getLogger('fitness');

// Event-based (preferred)
logger.info('session.started', { sessionId, participants });

// Error logging
logger.error('device.connection_failed', { deviceId, error: err.message });
```

**Key Concepts:**
- Event names, not message strings
- Contextual metadata objects
- Frontend logs forward to backend via WebSocket
- All logs tee to `dev.log` in development

**Log Analysis:**
```bash
# View recent logs
tail -200 dev.log

# Filter by event pattern
tail -500 dev.log | grep "fitness."

# Pretty print JSON
tail -50 dev.log | jq '.'
```

---

## API Client (lib/api.mjs)

**Location:** `frontend/src/lib/api.mjs`

**Purpose:** HTTP client for backend communication.

**Pattern:**
```javascript
import api from '../lib/api';

// GET request
const sessions = await api.get('/fitness/sessions');

// POST request
const result = await api.post('/fitness/session/start', {
  participants: ['user1', 'user2']
});

// With query params
const data = await api.get('/media/search', { q: 'query' });
```

**Error Handling:** Throws on non-2xx responses, catch and handle appropriately.

---

## Auth / UserService

**Location:** `backend/lib/config/UserService.mjs`

**Purpose:** User identity and household context.

**Key Concepts:**
- **Household:** Container for users, configs, data
- **User/Profile:** Persistent identity (`userId` like "kckern")
- **Entity:** Session participation instance (for fitness)

**Pattern:**
```javascript
import { UserService } from './lib/config/UserService.mjs';

const user = await UserService.getUser(householdId, userId);
const allUsers = await UserService.getUsers(householdId);
```

---

## exe.mjs

**Location:** `backend/routers/exe.mjs`

**Purpose:** Command execution router - runs system commands safely.

**Key Features:**
- Executes predefined command types
- Parameter validation
- Output streaming
- Timeout handling

**Safety:** Only exposes specific command patterns, not arbitrary shell execution.

---

## Home Assistant Integration

**Location:** `backend/lib/homeassistant.mjs`

**Purpose:** Smart home control via Home Assistant API.

**Key Features:**
- Entity state queries
- Service calls (turn on/off, set values)
- Event subscription
- Light/switch/sensor control

**Pattern:**
```javascript
import { HomeAssistant } from './lib/homeassistant.mjs';

// Get entity state
const state = await HomeAssistant.getState('light.living_room');

// Call service
await HomeAssistant.callService('light', 'turn_on', {
  entity_id: 'light.living_room',
  brightness: 255
});
```

**Used By:** HomeApp, OfficeApp, FitnessApp (ambient lighting)

---

## io.mjs

**Location:** `backend/lib/io.mjs`

**Purpose:** YAML data file access with path resolution.

**Status:** Legacy - prefer ConfigService for config reads.

**Pattern:**
```javascript
import { readYaml, writeYaml, pathFor } from './lib/io.mjs';

// Read YAML file
const data = await readYaml(pathFor('households', hid, 'apps', 'fitness', 'config.yml'));

// Write YAML file
await writeYaml(path, data);
```

**Note:** When writing files, use SSH if on macOS due to mount permission issues.
