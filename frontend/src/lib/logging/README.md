# Frontend Logging System

This directory contains the frontend logging module for DaylightStation.

## Overview

Frontend logs are batched and sent via WebSocket to the backend, which normalizes and forwards them to Loggly.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND APPLICATION                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Components          Hooks              Services          PlaybackLogger    │
│      │                 │                   │                    │           │
│      └─────────────────┴───────────────────┴────────────────────┘           │
│                                   │                                         │
│                                   ▼                                         │
│                         ┌─────────────────┐                                 │
│                         │   getLogger()   │  ← Logger.js                    │
│                         │   (Singleton)   │                                 │
│                         └────────┬────────┘                                 │
│                                  │                                          │
│                                  ▼                                          │
│                         ┌─────────────────┐                                 │
│                         │  Event Queue    │                                 │
│                         │  (Batching)     │                                 │
│                         └────────┬────────┘                                 │
│                                  │                                          │
│                    ┌─────────────┴─────────────┐                            │
│                    │                           │                            │
│                    ▼                           ▼                            │
│           ┌─────────────────┐       ┌─────────────────┐                     │
│           │ Console Output  │       │   WebSocket     │                     │
│           │ (Development)   │       │   Transport     │                     │
│           └─────────────────┘       └────────┬────────┘                     │
│                                              │                              │
└──────────────────────────────────────────────┼──────────────────────────────┘
                                               │
                                               │  { topic: 'logging',
                                               │    events: [...] }
                                               │
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  WebSocket Server → Ingestion Service → Dispatcher → Loggly                  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
frontend/src/lib/logging/
├── README.md        # This file
├── Logger.js        # Main logging module (singleton)
├── index.js         # Legacy DaylightLogger (backward compatibility)
└── singleton.js     # Legacy singleton wrapper (deprecated)
```

## Quick Start

### Basic Usage

```javascript
import { getLogger } from '../lib/logging/Logger.js';

// Get the singleton logger
const logger = getLogger();

// Log events
logger.info('button.clicked', { buttonId: 'submit' });
logger.warn('form.validation.failed', { field: 'email', reason: 'invalid' });
logger.error('api.request.failed', { endpoint: '/users', status: 500 });
```

### Configuration

```javascript
import { configure, getLogger } from '../lib/logging/Logger.js';

// Configure before first use
configure({
  level: 'debug',           // 'debug' | 'info' | 'warn' | 'error'
  consoleEnabled: true,     // Show in browser console
  websocketEnabled: true,   // Send to backend
  context: {
    app: 'daylight-frontend',
    version: '1.0.0'
  }
});

const logger = getLogger();
```

### Child Loggers

Create scoped loggers with additional context:

```javascript
const logger = getLogger();

// Create a child logger for a specific component
const playerLogger = logger.child({ 
  component: 'VideoPlayer',
  sessionId: 'abc-123'
});

playerLogger.info('video.started', { videoId: 'xyz' });
// Logs include: component='VideoPlayer', sessionId='abc-123'
```

## API Reference

### `getLogger()`

Returns the singleton logger instance.

```javascript
const logger = getLogger();
```

### `configure(options)`

Configure the logger. Call before first `getLogger()` or to update settings.

```javascript
configure({
  name: 'frontend',           // Source name (default: 'frontend')
  level: 'info',              // Minimum log level
  context: {},                // Default context for all events
  topic: 'logging',           // WebSocket topic (default: 'logging')
  maxQueue: 500,              // Max events in queue before dropping oldest
  batchSize: 20,              // Events per WebSocket message
  flushInterval: 1000,        // Ms between auto-flushes
  reconnectBaseDelay: 800,    // Initial reconnect delay
  reconnectMaxDelay: 6000,    // Max reconnect delay
  consoleEnabled: true,       // Enable console output
  websocketEnabled: true,     // Enable WebSocket transport
  websocketUrl: null          // Override WebSocket URL
});
```

### Logger Methods

```javascript
// Log at specific levels
logger.debug(event, data, options)
logger.info(event, data, options)
logger.warn(event, data, options)
logger.error(event, data, options)

// Generic log with explicit level
logger.log(level, event, data, options)

// Create child logger with merged context
logger.child(context)
```

**Parameters:**
- `event` (string): Dot-notation event name (e.g., `'user.login.success'`)
- `data` (object): Structured event payload
- `options` (object, optional):
  - `message` (string): Human-readable description
  - `context` (object): Additional context (merged with logger context)
  - `tags` (string[]): Searchable tags
  - `source` (string): Override source

### Utility Functions

```javascript
import { getConfig, getStatus } from '../lib/logging/Logger.js';

// Get current configuration
const config = getConfig();

// Get WebSocket connection status
const status = getStatus();
// { connected: true, queueLength: 5, reconnecting: false }
```

## Log Event Schema

Events sent to the backend follow this structure:

```typescript
interface LogEvent {
  ts: string;           // ISO 8601 timestamp
  level: string;        // 'debug' | 'info' | 'warn' | 'error'
  event: string;        // Dot-notation event name
  message?: string;     // Human-readable description
  data: object;         // Event payload
  source: string;       // Origin (default: 'frontend')
  context: object;      // Merged context from logger hierarchy
  tags: string[];       // Searchable tags
}
```

## WebSocket Protocol

### Message Format

Events are batched and sent as:

```json
{
  "topic": "logging",
  "events": [
    {
      "ts": "2025-12-13T19:30:00.000Z",
      "level": "info",
      "event": "page.loaded",
      "data": { "path": "/home" },
      "source": "frontend",
      "context": { "app": "daylight-frontend" },
      "tags": []
    }
  ]
}
```

### Connection Management

```
┌─────────────────────────────────────────────────────────────────┐
│                     WebSocket State Machine                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐                                                │
│  │   CLOSED    │◄─────────────────────────────────┐             │
│  └──────┬──────┘                                  │             │
│         │ connect()                               │ onclose     │
│         ▼                                         │             │
│  ┌─────────────┐                           ┌──────┴──────┐      │
│  │ CONNECTING  │───────onopen─────────────►│    OPEN     │      │
│  └──────┬──────┘                           └──────┬──────┘      │
│         │ onerror                                 │              │
│         ▼                                         │ onerror      │
│  ┌─────────────┐                                  │              │
│  │   WAITING   │◄─────────────────────────────────┘              │
│  │ (reconnect) │                                                │
│  └──────┬──────┘                                                │
│         │ timer expires                                         │
│         │ (exponential backoff)                                 │
│         └───────────────► connect()                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Reconnection Strategy:**
- Initial delay: 800ms
- Exponential backoff: delay × 2
- Max delay: 6000ms
- Events queued during disconnection (up to `maxQueue`)

## Integration with PlaybackLogger

The `playbackLogger.js` module uses `Logger.js` internally:

```javascript
// playbackLogger.js (simplified)
import { getLogger } from '../../../lib/logging/Logger.js';

const playbackLogger = getLogger().child({ channel: 'playback' });

// All playback events include channel='playback' context
playbackLogger.info('video.started', { videoId: 'abc' });
```

## Best Practices

### Event Naming

Use dot-notation hierarchical names:

```javascript
// Good - hierarchical and specific
logger.info('player.video.started', { videoId: '123' });
logger.info('player.video.paused', { position: 45.2 });
logger.info('player.video.ended', { watchTime: 120 });

// Avoid - generic or sentence-like
logger.info('Video started playing');
logger.info('event', { type: 'video-start' });
```

### Context Hierarchy

Use child loggers to avoid repetition:

```javascript
// Component-level logger
const componentLogger = getLogger().child({ 
  component: 'SearchBar' 
});

// Handler with request context
function handleSearch(query) {
  const requestLogger = componentLogger.child({ 
    requestId: generateId(),
    query 
  });
  
  requestLogger.info('search.started');
  // ... perform search ...
  requestLogger.info('search.completed', { resultCount: 42 });
}
```

### Error Logging

Always capture error details:

```javascript
try {
  await fetchData();
} catch (err) {
  logger.error('api.fetch.failed', {
    error: err.message,
    stack: err.stack,
    endpoint: '/api/data'
  });
}
```

### Performance Events

For high-frequency events, consider debouncing or sampling:

```javascript
// Debounce scroll events
let lastScrollLog = 0;
window.addEventListener('scroll', () => {
  const now = Date.now();
  if (now - lastScrollLog > 1000) {  // Max once per second
    logger.debug('page.scrolled', { position: window.scrollY });
    lastScrollLog = now;
  }
});
```

## Debugging

### Check Connection Status

```javascript
import { getStatus } from '../lib/logging/Logger.js';

console.log(getStatus());
// { connected: true, queueLength: 0, reconnecting: false }
```

### View Configuration

```javascript
import { getConfig } from '../lib/logging/Logger.js';

console.log(getConfig());
// { name: 'frontend', level: 'info', ... }
```

### Force Flush

The logger auto-flushes, but you can monitor the queue:

```javascript
const status = getStatus();
console.log(`Queue length: ${status.queueLength}`);
```

## Migration from Legacy Loggers

### From `singleton.js` (DaylightLogger)

```javascript
// Old
import { getDaylightLogger } from '../lib/logging/singleton.js';
const logger = getDaylightLogger();
logger.info('event.name', { data }, { context });

// New
import { getLogger } from '../lib/logging/Logger.js';
const logger = getLogger();
logger.info('event.name', { data }, { context });
```

### From `playbackLogger.js` (direct WebSocket)

```javascript
// Old - had separate WebSocket connection
import { playbackLog } from '../modules/Player/lib/playbackLogger.js';
playbackLog('event', payload);

// Now - playbackLogger internally uses Logger.js
// No migration needed for playbackLog() callers
```

## Troubleshooting

### Events Not Reaching Backend

1. Check WebSocket connection:
   ```javascript
   console.log(getStatus().connected);  // Should be true
   ```

2. Verify backend is running:
   ```bash
   curl http://localhost:3112/api/logging/health
   ```

3. Check browser console for WebSocket errors

### Queue Growing Without Sending

- WebSocket may be disconnected
- Check `getStatus().reconnecting`
- Events are queued up to `maxQueue` (default 500), oldest dropped after

### Console Output Not Showing

```javascript
import { configure } from '../lib/logging/Logger.js';
configure({ consoleEnabled: true, level: 'debug' });
```
