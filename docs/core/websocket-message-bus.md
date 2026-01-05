# WebSocket Message Bus

The WebSocket Message Bus is a real-time communication system that connects the backend server to multiple frontend applications. It enables instant updates, remote control, and cross-app coordination without page refreshes.

## Overview

The system follows a publish/subscribe pattern where:
- **Backend** broadcasts messages to connected clients
- **Clients** subscribe to specific topics of interest
- **Messages** are routed only to clients that have subscribed to the relevant topic

This allows multiple apps (OfficeApp, FitnessApp, TVApp) to share a single WebSocket connection while only receiving messages relevant to their function.

## Connection Flow

```
                                                    ┌─────────────────┐
                                                    │  ANT+ Fitness   │
                                                    │  Controller     │
                                                    │  (Raspberry Pi) │
                                                    └────────┬────────┘
                                                             │ WS (client)
                                                             ▼
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   Frontend      │   WS    │    Backend      │   WS    │  MQTT Bridge    │
│   Apps          │◄───────►│    Server       │◄────────│  (Zigbee2MQTT)  │
│  (Browser)      │  /ws    │  (Node.js)      │         └─────────────────┘
└─────────────────┘         └────────┬────────┘
                                     │
                                     │ HTTP
                                     ▼
                            ┌─────────────────┐
                            │  REST APIs      │
                            │  (Chatbots,     │
                            │   Gratitude)    │
                            └─────────────────┘
```

**Key**: The backend acts as a message hub. External sources (Fitness Controller, MQTT) connect as WebSocket clients and send data. The backend then broadcasts to frontend apps that have subscribed to relevant topics.

### Connection Lifecycle

1. **Connect**: Frontend opens WebSocket to `ws://server:3112/ws`
2. **Subscribe**: Client sends subscription commands for desired topics
3. **Receive**: Server routes matching messages to the client
4. **Reconnect**: On disconnect, client retries with exponential backoff (up to 10 attempts)

## Topics

Topics are labels that categorize messages. Clients subscribe to topics and only receive messages tagged with those topics.

### Available Topics

| Topic | Description | Used By |
|-------|-------------|---------|
| `fitness` | Heart rate data, workout events, governance state | FitnessApp |
| `vibration` | Equipment sensor events (punching bag, step platform) | FitnessApp |
| `playback` | Media playback control commands | OfficeApp |
| `menu` | Menu display and navigation | OfficeApp |
| `system` | System-level notifications | OfficeApp |
| `gratitude` | Gratitude jar entries and updates | OfficeApp |
| `logging` | Frontend log ingestion | Backend only |
| `legacy` | Messages without explicit topic (backward compatibility) | Various |

### Wildcard Subscription

Subscribing to `*` receives all messages regardless of topic. This is used by predicate-based filters that need to evaluate message content.

## Message Format

All messages are JSON objects with at least a `topic` field:

```json
{
  "topic": "fitness",
  "source": "fitness-simulator",
  "action": "heartrate_update",
  "data": {
    "userId": "kckern",
    "heartRate": 142,
    "zone": "warm"
  }
}
```

### Common Fields

| Field | Description |
|-------|-------------|
| `topic` | Routing category (required for proper delivery) |
| `source` | Origin of the message (e.g., `fitness`, `mqtt`, `api`) |
| `action` | Type of event or command |
| `data` | Payload specific to the message type |

## Subscription Commands

Clients manage their subscriptions by sending special `bus_command` messages:

### Subscribe to Topics

```json
{
  "type": "bus_command",
  "action": "subscribe",
  "topics": ["fitness", "vibration"]
}
```

### Unsubscribe from Topics

```json
{
  "type": "bus_command",
  "action": "unsubscribe",
  "topics": ["vibration"]
}
```

### Clear All Subscriptions

```json
{
  "type": "bus_command",
  "action": "clear_subscriptions"
}
```

### Acknowledgment

After any subscription command, the server responds with current state:

```json
{
  "type": "bus_ack",
  "action": "subscribe",
  "currentSubscriptions": ["fitness", "vibration"]
}
```

## Frontend Usage

### WebSocketService (Singleton)

The `WebSocketService` is the centralized connection manager. All apps should use this instead of creating their own connections.

```javascript
import { wsService } from '../services/WebSocketService';

// Subscribe to specific topics
const unsubscribe = wsService.subscribe(['fitness', 'vibration'], (data) => {
  console.log('Received:', data);
});

// Subscribe with a predicate function
const unsubscribe = wsService.subscribe(
  (data) => data.menu || data.playback,
  handleCommand
);

// Send a message
wsService.send({ topic: 'fitness', action: 'start_session' });

// Cleanup
unsubscribe();
```

### React Hooks

Three hooks provide WebSocket functionality in React components:

#### useWebSocketStatus

Monitor connection state:

```javascript
const { connected, connecting, reconnectAttempts } = useWebSocketStatus();

if (connecting) return <Spinner />;
if (!connected) return <ConnectionError />;
```

#### useWebSocketSubscription

Subscribe to messages within a component:

```javascript
useWebSocketSubscription(['fitness', 'vibration'], (data) => {
  setHeartRate(data.heartRate);
}, []);
```

#### useWebSocketSend

Get a send function:

```javascript
const sendMessage = useWebSocketSend();
sendMessage({ topic: 'fitness', action: 'pause' });
```

### WebSocketContext (OfficeApp)

OfficeApp uses a React Context that wraps the WebSocketService for its specific needs:

```javascript
const {
  websocketConnected,
  messageReceived,
  registerPayloadCallback,
  restartWebSocketServer
} = useWebSocket();
```

## Backend Broadcasting

The backend broadcasts messages to subscribed clients:

```javascript
import { broadcastToWebsockets } from './websocket.mjs';

// Broadcast to clients subscribed to 'gratitude' topic
broadcastToWebsockets({
  topic: 'gratitude',
  action: 'new_entry',
  data: { text: 'Grateful for sunny weather', user: 'kckern' }
});
```

### Message Sources

Messages originate from various backend systems:

| Source | Trigger | Topic |
|--------|---------|-------|
| MQTT Subscriber | Zigbee sensor events | `vibration` |
| Fitness Controller | Heart rate monitor data | `fitness` |
| Gratitude API | New gratitude entries | `gratitude` |
| Exe Router | Remote control commands | `playback`, `menu` |
| Chatbots | Automated responses | Various |

## ANT+ Fitness Controller

The Fitness Controller is a separate service that bridges ANT+ hardware (heart rate monitors, cadence sensors) to the WebSocket message bus. It typically runs on a dedicated device (Raspberry Pi) with USB ANT+ dongles attached.

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  ANT+ Sensors   │     │  Fitness        │     │  DaylightStation│     │  Frontend       │
│  (HR monitors,  │────►│  Controller     │────►│  Backend        │────►│  Apps           │
│  cadence, etc.) │ RF  │  (Raspberry Pi) │ WS  │  (Node.js)      │ WS  │  (FitnessApp)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

### How It Works

1. **Hardware Detection**: On startup, the controller scans for ANT+ USB dongles (up to 4 devices)
2. **Sensor Scanning**: Each dongle listens for ANT+ broadcasts from nearby sensors
3. **Data Capture**: When a sensor transmits (heart rate, cadence, power), the controller receives it
4. **WebSocket Forward**: Data is packaged as JSON and sent to DaylightStation's `/ws` endpoint
5. **Backend Broadcast**: DaylightStation adds `topic: 'fitness'` and broadcasts to subscribed clients
6. **Frontend Display**: FitnessApp receives the data and updates the UI in real-time

### Message Flow

The controller connects as a WebSocket **client** to the backend server:

```javascript
// Controller sends to backend
{
  "topic": "fitness",
  "source": "fitness",
  "type": "ant",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "profile": "HR",
  "deviceId": 7138,
  "dongleIndex": 0,
  "data": {
    "DeviceID": 7138,
    "ComputedHeartRate": 142,
    "BeatCount": 1523,
    "BeatTime": 45678,
    "BatteryLevel": 85,
    "BatteryStatus": "Good"
  }
}
```

### Supported Sensor Types

| Profile | ANT+ Device Type | Data Fields |
|---------|------------------|-------------|
| `HR` | Heart Rate Monitor | `ComputedHeartRate`, `BeatCount`, `BeatTime`, `BatteryLevel` |
| `CAD` | Cadence Sensor | `CalculatedCadence`, `CumulativeCadenceRevolutionCount` |
| `PWR` | Power Meter | Power output, cadence, torque |
| `SPD` | Speed Sensor | Speed, distance |

### Multi-Dongle Support

The controller supports multiple ANT+ USB dongles simultaneously, allowing more sensors to be tracked. Each dongle operates on its own channel and can receive from multiple sensors.

```
Dongle 0: HR sensors (deviceId 7138, 7183)
Dongle 1: Cadence sensors (deviceId 8001)
Dongle 2: Power meters
```

### Simulation Mode

For testing without hardware, a simulator generates realistic fitness data:

```bash
# Run simulator with all configured devices
node simulation.mjs

# Limit to 2 heart rate users and 1 cadence device
node simulation.mjs 2 1
```

The simulator:
- Reads device configuration from the fitness config file
- Generates phased heart rate patterns (warm-up → build → peak → cooldown)
- Applies per-device variations so each user has unique curves
- Sends data every 2 seconds with `source: 'fitness-simulator'`

### Configuration

The controller is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP API port for status/health checks |
| `DAYLIGHT_HOST` | localhost | DaylightStation server hostname |
| `DAYLIGHT_PORT` | 3112 | DaylightStation server port |
| `SERIAL_DEVICE` | /dev/ttyUSB0 | Serial port for TV control |

### TV Control

The controller also provides TV power control via RS-232 serial commands:

```
GET /tv/on   → Turn TV on
GET /tv/off  → Turn TV off
GET /status  → Controller status (ANT+ devices, WebSocket state)
GET /health  → Health check
```

### Reconnection

If the connection to DaylightStation drops:
- The controller logs a warning (once)
- Schedules reconnection attempts every 30 seconds
- Silently retries until successful
- Logs success only after recovering from a failure

## Message Routing

When a message is broadcast, the server evaluates each connected client:

1. Check if client has subscribed to the message's `topic`
2. Check if client has wildcard `*` subscription
3. If either matches, deliver the message
4. Otherwise, skip this client

This ensures clients only receive relevant traffic, reducing bandwidth and processing overhead.

## OfficeApp Command Handling

OfficeApp receives commands that control the media player interface:

### Menu Commands

```json
{
  "menu": {
    "title": "Select an option",
    "items": [
      { "label": "Play Music", "action": "play_music" },
      { "label": "Show Photos", "action": "show_photos" }
    ]
  }
}
```

### Playback Commands

```json
{
  "playback": "play"    // play, pause, toggle, next, previous, stop
}
```

Playback commands are translated to keyboard events:
- `play`/`pause`/`toggle` → Space key
- `next`/`skip` → Tab key
- `previous`/`back` → Backspace key
- `forward`/`ff` → Right arrow
- `rewind`/`rw` → Left arrow
- `stop`/`exit` → Escape key

### Content Commands

```json
{
  "hymn": "how-great-thou-art",
  "action": "play"
}
```

```json
{
  "plex": "12345",
  "action": "queue"
}
```

## Security Guardrails

OfficeApp filters out messages that shouldn't reach it:

### Blocked Topics
- `vibration` - Sensor telemetry
- `fitness` - Workout data
- `sensor` - Raw sensor data
- `telemetry` - Device telemetry
- `logging` - Frontend logs

### Blocked Sources
- `mqtt` - Raw MQTT messages
- `fitness` - Fitness controller
- `fitness-simulator` - Test data
- `playback-logger` - Log events

This prevents sensor spam from flooding the media interface.

## Reconnection Behavior

When the connection drops:

1. **Immediate notification**: Status listeners are informed
2. **Message queueing**: Outgoing messages are buffered
3. **Exponential backoff**: Retry delays: 1s, 2s, 4s, 8s, 16s, 30s (max)
4. **Attempt limit**: After 10 failures, stops reconnecting
5. **On reconnect**: Subscriptions are re-synced, queued messages sent

## Server Restart

If the WebSocket server becomes unresponsive, it can be restarted via API:

```javascript
const restartWebSocketServer = async () => {
  await fetch('/exe/ws/restart', { method: 'POST' });
};
```

This closes all connections, recreates the server, and clients will auto-reconnect.

## Logging Integration

Frontend apps can send logs through the WebSocket for centralized collection:

```json
{
  "source": "playback-logger",
  "topic": "logging",
  "level": "info",
  "event": "video.started",
  "data": { "mediaId": "12345" }
}
```

These messages are routed to the logging ingestion service rather than broadcast to other clients.

## Architecture Benefits

1. **Single Connection**: All apps share one WebSocket, reducing server load
2. **Topic Isolation**: Apps only receive relevant messages
3. **Automatic Reconnection**: Resilient to network interruptions
4. **Message Queuing**: No lost messages during brief disconnects
5. **Centralized Management**: One place to manage all real-time communication
