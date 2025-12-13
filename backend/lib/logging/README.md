# Backend Logging System

This directory contains the centralized logging infrastructure for the DaylightStation backend.

## Overview

All log events flow through a single pipeline:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           APPLICATION CODE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  index.js          websocket.js          cron.mjs          api.mjs          │
│      │                  │                   │                 │             │
│      └──────────────────┴───────────────────┴─────────────────┘             │
│                                   │                                         │
│                                   ▼                                         │
│                         ┌─────────────────┐                                 │
│                         │  createLogger() │  ← logger.js                    │
│                         │  (Logger Factory)│                                │
│                         └────────┬────────┘                                 │
│                                  │                                          │
└──────────────────────────────────┼──────────────────────────────────────────┘
                                   │
┌──────────────────────────────────┼──────────────────────────────────────────┐
│                           LOG DISPATCHER                                     │
├──────────────────────────────────┼──────────────────────────────────────────┤
│                                  ▼                                          │
│                         ┌─────────────────┐                                 │
│                         │  LogDispatcher  │  ← dispatcher.js                │
│                         │  (Central Hub)  │                                 │
│                         └────────┬────────┘                                 │
│                                  │                                          │
│              ┌───────────────────┼───────────────────┐                      │
│              │                   │                   │                      │
│              ▼                   ▼                   ▼                      │
│     ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐             │
│     │ConsoleTransport │ │ LogglyTransport │ │  (Future...)    │             │
│     │ transports/     │ │ transports/     │ │                 │             │
│     │ console.js      │ │ loggly.js       │ │                 │             │
│     └────────┬────────┘ └────────┬────────┘ └─────────────────┘             │
│              │                   │                                          │
│              ▼                   ▼                                          │
│         ┌─────────┐        ┌─────────┐                                      │
│         │ stdout  │        │ Loggly  │                                      │
│         │ stderr  │        │   API   │                                      │
│         └─────────┘        └─────────┘                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
backend/lib/logging/
├── README.md           # This file
├── dispatcher.js       # Central log routing hub
├── logger.js           # Logger factory (creates contextualized loggers)
├── ingestion.js        # Frontend log processing (WebSocket → Dispatcher)
├── config.js           # Configuration loading from YAML
└── transports/
    ├── index.js        # Transport exports
    ├── console.js      # Console output transport
    └── loggly.js       # Loggly bulk upload transport
```

## Quick Start

### Creating a Logger

```javascript
import { createLogger } from './lib/logging/logger.js';

// Create a logger for your module
const logger = createLogger({ 
  source: 'backend',   // 'backend' | 'frontend' | 'cron' | 'webhook'
  app: 'my-module'     // Module/component name
});

// Log events
logger.info('user.login', { userId: 123 });
logger.warn('cache.miss', { key: 'user:123' });
logger.error('db.connection.failed', { error: err.message });
```

### Child Loggers

Create child loggers with additional context that inherits from the parent:

```javascript
const requestLogger = logger.child({ 
  requestId: 'abc-123',
  path: '/api/users'
});

requestLogger.info('request.start');  // Includes requestId and path
requestLogger.info('request.complete', { duration: 150 });
```

## Core Components

### 1. LogDispatcher (`dispatcher.js`)

The central hub that routes all log events to registered transports.

**Initialization:**
```javascript
import { initializeLogging, getDispatcher } from './lib/logging/dispatcher.js';

// Initialize once at app startup
const dispatcher = initializeLogging({ defaultLevel: 'info' });

// Add transports
dispatcher.addTransport(consoleTransport);
dispatcher.addTransport(logglyTransport);
```

**Features:**
- Level filtering (debug, info, warn, error)
- Metrics tracking (sent, dropped, errors)
- Transport fan-out (sends to all registered transports)
- Health reporting via `getMetrics()`

### 2. Logger Factory (`logger.js`)

Creates contextualized logger instances.

**API:**
```javascript
const logger = createLogger({
  source: 'backend',      // Required: origin of logs
  app: 'api',             // Required: application/module name
  context: { env: 'prod' } // Optional: additional context
});

// Methods
logger.debug(event, data, options)
logger.info(event, data, options)
logger.warn(event, data, options)
logger.error(event, data, options)
logger.child(context)     // Create child with merged context
logger.getContext()       // Get current context
```

**Options parameter:**
```javascript
logger.info('user.created', { userId: 123 }, {
  message: 'User created successfully',  // Human-readable description
  context: { operation: 'signup' },       // Additional context (merged)
  tags: ['user', 'signup']                // Searchable tags for Loggly
});
```

### 3. Transports (`transports/`)

Pluggable output destinations. Each transport implements:

```javascript
{
  name: string,              // Unique identifier
  send(event): void,         // Called for each log event
  flush?(): Promise<void>    // Optional: flush pending writes
}
```

**Console Transport:**
```javascript
import { createConsoleTransport } from './transports/console.js';

const transport = createConsoleTransport({
  colorize: true,    // ANSI colors (disable in Docker)
  format: 'pretty'   // 'pretty' | 'json'
});
```

**Loggly Transport:**
```javascript
import { createLogglyTransport } from './transports/loggly.js';

const transport = createLogglyTransport({
  token: process.env.LOGGLY_TOKEN,
  subdomain: process.env.LOGGLY_SUBDOMAIN,
  tags: ['daylight', 'backend'],
  bufferSize: 1  // Events before flush
});
```

### 4. Ingestion Service (`ingestion.js`)

Processes frontend logs received via WebSocket.

```javascript
import { ingestFrontendLogs } from './lib/logging/ingestion.js';

// In websocket.js message handler
const clientMeta = { ip: '192.168.1.1', userAgent: 'Mozilla/5.0...' };
const count = ingestFrontendLogs(payload, clientMeta);
```

**Supported payload formats:**
```javascript
// Batch format (preferred)
{ topic: 'logging', events: [{ event: '...', data: {...} }, ...] }

// Single event
{ topic: 'logging', event: '...', data: {...} }

// Legacy playback-logger format
{ source: 'playback-logger', event: '...', payload: {...} }
```

## Log Event Schema

All log events conform to this structure:

```typescript
interface LogEvent {
  ts: string;           // ISO 8601 timestamp
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;        // Dot-notation event name
  message?: string;     // Human-readable description
  data: object;         // Structured payload
  context: {
    source: string;     // 'frontend' | 'backend' | 'cron' | 'webhook'
    app: string;        // Application/module name
    host?: string;      // Hostname (backend)
    ip?: string;        // Client IP (frontend)
    userAgent?: string; // Browser UA (frontend)
    [key: string]: any; // Additional context
  };
  tags: string[];       // Searchable tags
}
```

## Configuration

Logging configuration is loaded from `config/logging.yml`:

```yaml
defaultLevel: info

loggers:
  backend: info
  websocket: debug
  cron: info

loggly:
  enabled: true
  bufferSize: 1
  tags:
    - daylight
    - backend

console:
  enabled: true
  format: pretty
  colorize: true
```

## Observability

### Health Endpoint

```
GET /api/logging/health
```

Response:
```json
{
  "status": "ok",
  "dispatcher": {
    "sent": 1234,
    "dropped": 0,
    "errors": 0
  },
  "transports": [
    { "name": "console", "status": "ok" },
    { "name": "loggly", "status": "ok" }
  ],
  "level": "info"
}
```

### Metrics

```javascript
const dispatcher = getDispatcher();
const metrics = dispatcher.getMetrics();
// { sent: 1234, dropped: 0, errors: 0 }
```

## Best Practices

### Event Naming

Use dot-notation for hierarchical event names:

```javascript
// Good
logger.info('user.login.success', { userId: 123 });
logger.info('api.request.start', { method: 'GET', path: '/users' });
logger.error('db.query.failed', { query: 'SELECT...', error: err.message });

// Avoid
logger.info('User logged in');  // Not structured
logger.info('error', { ... });  // Generic name
```

### Error Logging

Always include error context:

```javascript
try {
  await doSomething();
} catch (err) {
  logger.error('operation.failed', {
    error: err.message,
    stack: err.stack,
    context: { input: someInput }
  });
}
```

### Performance-Sensitive Code

For high-frequency events, check level before expensive operations:

```javascript
// The logger already filters by level, but avoid expensive data prep
if (process.env.LOG_LEVEL === 'debug') {
  logger.debug('detailed.metrics', computeExpensiveMetrics());
}
```

