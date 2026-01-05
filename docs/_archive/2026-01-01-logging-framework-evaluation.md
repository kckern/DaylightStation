# DaylightStation Logging Framework - Deep Dive & Vision Evaluation

**Date**: 2026-01-01
**Author**: System Analysis
**Status**: Evaluation & Gap Analysis

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Vision Statement](#vision-statement)
3. [Current Architecture](#current-architecture)
4. [Current State Analysis](#current-state-analysis)
5. [Gap Analysis](#gap-analysis)
6. [Recommendations](#recommendations)
7. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

DaylightStation has a **sophisticated, well-architected logging framework** with clear separation of concerns, transport abstraction, and WebSocket-based frontend-to-backend log ingestion. The system is **80% aligned with the vision** but has critical gaps around automatic console error capture and file transport management.

### Readiness Score: 8/10

**Strengths:**
- ✅ WebSocket transport for frontend logs (batched & buffered)
- ✅ Backend ingestion service with format normalization
- ✅ Dispatcher pattern with pluggable transports
- ✅ Console and Loggly cloud transports
- ✅ Environment-aware formatting (JSON in Docker, pretty in dev)
- ✅ Shell redirection captures all output in dev mode

**Critical Gaps:**
- ❌ No automatic console.error/warn/log capture on frontend
- ❌ No window.onerror or unhandled promise rejection handlers
- ❌ No dedicated file transport (relies on shell `tee`)
- ❌ Container logs not explicitly routed to syslog in production

---

## Vision Statement

> **All frontend logs (including console errors) should be piped to the backend via WebSocket and dumped to:**
> - **Development**: `dev.log` file
> - **Production (Docker)**: System log (container stdout/stderr)

### Key Requirements

1. **Automatic Capture**: All `console.log`, `console.warn`, `console.error` calls should be intercepted and forwarded
2. **Error Handling**: Uncaught errors (`window.onerror`) and unhandled promise rejections should be logged
3. **WebSocket Transport**: All frontend logs batched and sent to backend
4. **Environment-Aware Output**:
   - **Dev**: Append to `dev.log` file in project root
   - **Prod**: Output to Docker container stdout/stderr (captured by Docker logging drivers)
5. **No Data Loss**: Logs should queue during WebSocket disconnection and flush on reconnect

---

## Current Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Application Code                                                │
│       │                                                          │
│       ├─ DaylightLogger.info('event', data)  ──────┐            │
│       ├─ console.log('message')  ────────────────┐ │            │
│       └─ throw new Error()  ─────────────────┐   │ │            │
│                                               │   │ │            │
│                                      [NOT CAPTURED] │            │
│                                               │   │ │            │
│                                               ▼   ▼ ▼            │
│                                           Logger.js              │
│                                               │                  │
│                                               ├─ Console Output  │
│                                               │                  │
│                                               ├─ WebSocket       │
│                                               │   Transport      │
│                                               │   (Buffered)     │
│                                               │                  │
└───────────────────────────────────────────────┼──────────────────┘
                                                │
                                     WebSocket (batched)
                                                │
┌───────────────────────────────────────────────▼──────────────────┐
│                         BACKEND                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  WebSocket Router (websocket.mjs)                                │
│       │                                                          │
│       ├─ Receives batched events { topic: 'logging', events }   │
│       │                                                          │
│       ▼                                                          │
│  Log Ingestion (ingestion.js)                                   │
│       │                                                          │
│       ├─ Normalizes payload formats                             │
│       ├─ Unwraps nested structures                              │
│       ├─ Enriches with client metadata (IP, userAgent)          │
│       │                                                          │
│       ▼                                                          │
│  Log Dispatcher (dispatcher.js)                                 │
│       │                                                          │
│       ├─ Level filtering (debug/info/warn/error)                │
│       ├─ Event validation                                       │
│       ├─ Fans out to transports                                 │
│       │                                                          │
│       ├───────────────┬────────────────┐                        │
│       ▼               ▼                ▼                        │
│  Console         Loggly            [No File]                    │
│  Transport       Transport         Transport                    │
│       │               │                                          │
│       ▼               ▼                                          │
│  stdout/stderr   Cloud Service                                  │
│       │                                                          │
└───────┼──────────────────────────────────────────────────────────┘
        │
        │ (In dev: shell pipes to dev.log)
        ▼
    2>&1 | tee -a dev.log
```

### Components

#### Frontend: `frontend/src/lib/logging/`

1. **`Logger.js`** - Singleton logger with WebSocket batching
   - Batches events (default: 20 events per batch)
   - Flush interval: 1000ms
   - Max queue: 500 events
   - Auto-reconnect with exponential backoff
   - Sends to backend via `{ topic: 'logging', events: [...] }`

2. **`index.js`** - Core logger factory
   - `createLogger()` - Factory for creating loggers
   - `createBufferingWebSocketTransport()` - Batched WS transport
   - `consoleTransport()` - Local console output

3. **`singleton.js`** - Global logger instance
   - Configures logger from `window.DAYLIGHT_*` env vars
   - Exposes `window.DaylightLogger` globally

#### Backend: `backend/lib/logging/`

1. **`dispatcher.js`** - Central event hub
   - Manages transport registry
   - Filters by log level (debug/info/warn/error)
   - Validates events before dispatch
   - Tracks metrics (sent, dropped, errors)

2. **`ingestion.js`** - Frontend log normalization
   - `ingestFrontendLogs(payload, clientMeta)` - Entry point
   - Handles multiple legacy formats
   - Unwraps nested event structures
   - Enriches with client IP and userAgent

3. **`logger.js`** - Logger factory
   - `createLogger({ source, app, context })` - Create contextualized logger
   - Supports child loggers with inherited context
   - Falls back to console if dispatcher not initialized

4. **`config.js`** - Configuration management
   - Loads `config/logging.yml`
   - Environment variable overrides (`LOG_LEVEL_*`)
   - Resolves Loggly credentials

5. **`transports/console.js`** - Console output
   - JSON format (Docker/prod)
   - Pretty format with colors (dev)
   - Writes to `process.stdout` (info/debug) or `process.stderr` (warn/error)

6. **`transports/loggly.js`** - Cloud logging
   - Winston-based Loggly bulk transport
   - Buffers 50 events before sending
   - Retry logic with exponential backoff
   - Throttles high-frequency startup metrics

---

## Current State Analysis

### ✅ What's Working

#### 1. Frontend WebSocket Transport (Excellent)

**Code**: `frontend/src/lib/logging/Logger.js`

```javascript
const enqueue = (event) => {
  if (wsState.queue.length >= config.maxQueue) {
    wsState.queue.shift(); // Drop oldest
  }
  wsState.queue.push(event);

  ensureWebSocket();

  if (wsState.queue.length >= config.batchSize) {
    flush();
  } else {
    scheduleFlush();
  }
};
```

**Status**: ✅ **Fully Functional**
- Batches 20 events before sending
- Flushes every 1000ms if queue not full
- Handles disconnection/reconnection gracefully
- Max queue of 500 events prevents memory leaks

#### 2. Backend Ingestion Pipeline (Excellent)

**Code**: `backend/lib/logging/ingestion.js`

```javascript
export function ingestFrontendLogs(payload, clientMeta = {}) {
  const dispatcher = getDispatcher();
  const events = normalizePayload(payload);

  let processed = 0;
  for (const event of events) {
    const normalized = normalizeEvent(event, clientMeta);
    if (normalized) {
      dispatcher.dispatch(normalized);
      processed++;
    }
  }
  return processed;
}
```

**Status**: ✅ **Fully Functional**
- Handles multiple payload formats (backward compatible)
- Normalizes inconsistent event structures
- Enriches with client metadata
- Returns count of processed events

#### 3. WebSocket Endpoint Integration (Excellent)

**Code**: `backend/routers/websocket.mjs`

```javascript
if (data.topic === 'logging') {
  const clientMeta = {
    ip: ws._clientMeta?.ip,
    userAgent: ws._clientMeta?.userAgent
  };
  ingestFrontendLogs(data, clientMeta);
}
```

**Status**: ✅ **Fully Functional**
- Receives batched events on `logging` topic
- Captures client IP and user agent
- Forwards to ingestion service

#### 4. Transport Dispatcher (Excellent)

**Code**: `backend/lib/logging/dispatcher.js`

```javascript
dispatch(event) {
  if (!this.isLevelEnabled(event.level)) {
    this.metrics.dropped++;
    return;
  }

  const validated = this.validate(event);
  if (!validated) return;

  this.metrics.sent++;
  for (const transport of this.transports) {
    try {
      transport.send(validated);
    } catch (err) {
      this.metrics.errors++;
    }
  }
}
```

**Status**: ✅ **Fully Functional**
- Level filtering with priority system
- Event validation
- Error isolation per transport
- Metrics tracking

#### 5. Environment-Aware Console Output (Good)

**Code**: `backend/index.js`

```javascript
dispatcher.addTransport(createConsoleTransport({
  colorize: !isDocker,
  format: isDocker ? 'json' : 'pretty'
}));
```

**Status**: ✅ **Works as Designed**
- **Dev mode**: Pretty-printed with ANSI colors
- **Docker mode**: JSON lines to stdout/stderr

#### 6. Dev Mode File Logging (Good, but indirect)

**Code**: `package.json`

```json
{
  "backend:dev": "nodemon backend/index.js 2>&1 | tee -a dev.log",
  "frontend:dev": "npm run dev --prefix frontend 2>&1 | tee -a dev.log"
}
```

**Status**: ✅ **Works via Shell Redirection**
- All stdout/stderr piped to `dev.log`
- Appends to existing file
- Works for both frontend build output and backend logs
- **Limitation**: Not a proper transport, relies on shell

---

### ❌ What's Missing

#### 1. **CRITICAL: No Automatic Console Capture on Frontend**

**Current State**: Frontend code uses `console.log()` directly but these are **NOT** forwarded to backend automatically.

**Evidence**: `frontend/src/lib/logging/Logger.js:194-198`

```javascript
// Console output (immediate)
if (config.consoleEnabled) {
  const dataStr = Object.keys(event.data).length ? JSON.stringify(event.data) : '';
  devOutput(level, `${event.event}${dataStr ? ' ' + dataStr : ''}`);
}
```

This only logs events that explicitly call `DaylightLogger.info()`, not native `console.log()`.

**Impact**:
- ❌ Third-party library errors not captured
- ❌ Quick debug `console.log()` statements not forwarded
- ❌ Legacy code using console.* not integrated

**Gap**: **HIGH PRIORITY** - Need global console interception

---

#### 2. **CRITICAL: No Global Error Handlers on Frontend**

**Current State**: No `window.onerror` or `unhandledrejection` handlers found.

**Evidence**: Grep search found zero results for:
```
window.onerror
window.addEventListener('error')
window.addEventListener('unhandledrejection')
```

**Impact**:
- ❌ Uncaught JavaScript errors not logged
- ❌ Unhandled promise rejections not captured
- ❌ Runtime errors in production go unnoticed

**Gap**: **CRITICAL** - Must implement global error boundaries

---

#### 3. **MEDIUM: No Dedicated File Transport**

**Current State**: Dev logs written via shell redirection (`2>&1 | tee -a dev.log`)

**Limitations**:
- Only works when npm scripts are run with shell
- No log rotation
- No max file size enforcement
- Mixes frontend build output with backend logs
- Cannot be configured per-logger or per-level

**Evidence**: No file transport in `backend/lib/logging/transports/`

**Gap**: **MEDIUM PRIORITY** - Implement proper file transport

---

#### 4. **LOW: Docker Logs Not Explicitly Routed to Syslog**

**Current State**: Logs go to container stdout/stderr, which is captured by Docker's logging driver (default: json-file).

**Docker Logging Drivers**:
- Default: `json-file` (stored in `/var/lib/docker/containers/<id>/<id>-json.log`)
- Can be configured for: `syslog`, `journald`, `gelf`, `fluentd`, etc.

**Current Configuration**: No explicit driver configuration in `docker-compose.yml`

**Impact**:
- Container logs ARE captured (via Docker)
- Accessible via `docker logs <container>`
- Not directly in host system log (`/var/log/syslog`)

**Gap**: **LOW PRIORITY** - Docker already captures logs; explicit syslog routing is optional

---

## Gap Analysis

### Summary Table

| Requirement | Current State | Status | Priority | Effort |
|-------------|---------------|--------|----------|--------|
| Frontend logs via WebSocket | ✅ Implemented (batched) | **Complete** | - | - |
| Backend ingestion pipeline | ✅ Fully functional | **Complete** | - | - |
| Console transport | ✅ stdout/stderr | **Complete** | - | - |
| Loggly cloud transport | ✅ Implemented | **Complete** | - | - |
| Dev logs to dev.log | ⚠️ Via shell tee | **Partial** | Medium | Low |
| Prod logs to container | ✅ stdout/stderr | **Complete** | - | - |
| **Auto-capture console.log** | ❌ **Not implemented** | **Missing** | **HIGH** | **Medium** |
| **Auto-capture console.error** | ❌ **Not implemented** | **Missing** | **CRITICAL** | **Medium** |
| **Global error handlers** | ❌ **Not implemented** | **Missing** | **CRITICAL** | **Low** |
| File transport | ❌ Not implemented | **Missing** | Medium | Medium |
| Syslog routing (Docker) | ⚠️ Optional config | **Optional** | Low | Low |

---

## Recommendations

### Phase 1: Critical Error Capture (High Priority)

#### 1.1 Implement Global Error Handlers on Frontend

**File**: `frontend/src/lib/logging/errorHandlers.js` (new file)

```javascript
import { getDaylightLogger } from './singleton.js';

export function setupGlobalErrorHandlers() {
  const logger = getDaylightLogger();

  // Capture uncaught errors
  window.onerror = (message, source, lineno, colno, error) => {
    logger.error('window.onerror', {
      message: String(message),
      source,
      lineno,
      colno,
      stack: error?.stack,
      name: error?.name
    });
    return false; // Let default handler run too
  };

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    logger.error('unhandledrejection', {
      reason: event.reason?.message || String(event.reason),
      promise: String(event.promise),
      stack: event.reason?.stack
    });
  });

  // Capture React errors (if using error boundary)
  window.addEventListener('error', (event) => {
    if (event.error) {
      logger.error('window.error.event', {
        message: event.error.message,
        stack: event.error.stack,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    }
  });
}
```

**Integration**: `frontend/src/main.jsx`

```javascript
import { setupGlobalErrorHandlers } from './lib/logging/errorHandlers.js';

configureDaylightLogger({ ... });
setupGlobalErrorHandlers(); // ← Add this

ReactDOM.createRoot(document.getElementById('root')).render(...);
```

**Impact**: ✅ All uncaught errors and promise rejections logged to backend

---

#### 1.2 Intercept Native Console Methods

**File**: `frontend/src/lib/logging/consoleInterceptor.js` (new file)

```javascript
import { getDaylightLogger } from './singleton.js';

export function interceptConsole() {
  const logger = getDaylightLogger();

  // Save original methods
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  };

  // Intercept console.log
  console.log = (...args) => {
    originalConsole.log(...args);
    logger.debug('console.log', { args: args.map(String) });
  };

  // Intercept console.warn
  console.warn = (...args) => {
    originalConsole.warn(...args);
    logger.warn('console.warn', { args: args.map(String) });
  };

  // Intercept console.error
  console.error = (...args) => {
    originalConsole.error(...args);
    logger.error('console.error', {
      args: args.map(a => a instanceof Error ? {
        message: a.message,
        stack: a.stack,
        name: a.name
      } : String(a))
    });
  };

  // Intercept console.info
  console.info = (...args) => {
    originalConsole.info(...args);
    logger.info('console.info', { args: args.map(String) });
  };

  // Optional: console.debug
  console.debug = (...args) => {
    originalConsole.debug(...args);
    logger.debug('console.debug', { args: args.map(String) });
  };

  // Return cleanup function
  return () => {
    Object.assign(console, originalConsole);
  };
}
```

**Integration**: `frontend/src/main.jsx`

```javascript
import { interceptConsole } from './lib/logging/consoleInterceptor.js';

configureDaylightLogger({ ... });
setupGlobalErrorHandlers();
interceptConsole(); // ← Add this

ReactDOM.createRoot(document.getElementById('root')).render(...);
```

**Impact**: ✅ All `console.log/warn/error/info` calls forwarded to backend

**Note**: Consider adding a rate limiter to prevent log spam from noisy libraries.

---

### Phase 2: File Transport Implementation (Medium Priority)

#### 2.1 Create File Transport for Backend

**File**: `backend/lib/logging/transports/file.js` (new file)

```javascript
import fs from 'fs';
import path from 'path';

/**
 * Create a file transport
 * @param {Object} options
 * @param {string} options.filename - Path to log file (required)
 * @param {string} options.format - 'json' | 'pretty' (default: 'json')
 * @param {number} options.maxSize - Max file size in bytes before rotation (default: 10MB)
 * @param {number} options.maxFiles - Max number of rotated files to keep (default: 5)
 * @returns {Object} Transport object
 */
export function createFileTransport(options = {}) {
  const {
    filename,
    format = 'json',
    maxSize = 10 * 1024 * 1024, // 10 MB
    maxFiles = 5
  } = options;

  if (!filename) {
    throw new Error('File transport requires a filename');
  }

  // Ensure directory exists
  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let stream = fs.createWriteStream(filename, { flags: 'a' });
  let currentSize = fs.existsSync(filename) ? fs.statSync(filename).size : 0;

  const rotateIfNeeded = () => {
    if (currentSize < maxSize) return;

    try {
      stream.end();

      // Rotate files: file.log.4 → file.log.5, ..., file.log → file.log.1
      for (let i = maxFiles - 1; i >= 1; i--) {
        const oldPath = i === 1 ? filename : `${filename}.${i}`;
        const newPath = `${filename}.${i + 1}`;
        if (fs.existsSync(oldPath)) {
          if (i === maxFiles - 1 && fs.existsSync(newPath)) {
            fs.unlinkSync(newPath); // Delete oldest
          }
          fs.renameSync(oldPath, newPath);
        }
      }

      // Create new stream
      stream = fs.createWriteStream(filename, { flags: 'a' });
      currentSize = 0;
    } catch (err) {
      process.stderr.write(`[FileTransport] Rotation failed: ${err.message}\n`);
    }
  };

  return {
    name: 'file',

    send(event) {
      const output = format === 'json'
        ? JSON.stringify(event)
        : formatPretty(event);

      const line = output + '\n';
      stream.write(line);
      currentSize += Buffer.byteLength(line);

      rotateIfNeeded();
    },

    async flush() {
      return new Promise((resolve) => {
        if (stream.writable) {
          stream.once('finish', resolve);
          stream.end();
        } else {
          resolve();
        }
      });
    }
  };
}

function formatPretty(event) {
  return `[${event.ts}] [${event.level.toUpperCase()}] ${event.event} ${JSON.stringify(event.data)}`;
}

export default createFileTransport;
```

**Integration**: `backend/index.js`

```javascript
import { createFileTransport } from './lib/logging/transports/file.js';

// Add file transport in dev mode
if (!isDocker) {
  dispatcher.addTransport(createFileTransport({
    filename: path.join(__dirname, '..', 'dev.log'),
    format: 'json',
    maxSize: 50 * 1024 * 1024, // 50 MB
    maxFiles: 3
  }));
}
```

**Impact**:
- ✅ Dedicated file transport with log rotation
- ✅ Configurable max size and file count
- ✅ Independent of shell redirection

---

### Phase 3: Docker Syslog Integration (Optional, Low Priority)

#### 3.1 Configure Docker Logging Driver

**File**: `docker-compose.yml`

```yaml
services:
  daylight-backend:
    image: daylight-station
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "3"
        labels: "daylight,backend"
    # Alternative: Route to host syslog
    # logging:
    #   driver: "syslog"
    #   options:
    #     syslog-address: "udp://localhost:514"
    #     tag: "daylight-backend"
```

**Impact**:
- Container logs managed by Docker
- Accessible via `docker logs`
- Optional syslog forwarding to host

---

## Implementation Roadmap

### Week 1: Critical Error Capture

**Goal**: Capture all frontend errors and console logs

**Tasks**:
1. ✅ Create `frontend/src/lib/logging/errorHandlers.js`
2. ✅ Create `frontend/src/lib/logging/consoleInterceptor.js`
3. ✅ Integrate in `frontend/src/main.jsx`
4. ✅ Test uncaught errors and promise rejections
5. ✅ Verify console.log/warn/error forwarding to backend
6. ✅ Add sampling/rate limiting for noisy console logs

**Deliverables**:
- All frontend errors logged to backend
- Console methods intercepted and forwarded
- No breaking changes to existing code

---

### Week 2: File Transport

**Goal**: Replace shell redirection with proper file transport

**Tasks**:
1. ✅ Create `backend/lib/logging/transports/file.js`
2. ✅ Add log rotation logic (max size, max files)
3. ✅ Integrate file transport in `backend/index.js` (dev mode only)
4. ✅ Update `package.json` scripts to remove `| tee` redirection
5. ✅ Test log rotation behavior
6. ✅ Document file transport configuration

**Deliverables**:
- Dedicated file transport with rotation
- Cleaner npm scripts
- Configurable log file location

---

### Week 3: Production Optimization (Optional)

**Goal**: Optimize Docker logging and add health checks

**Tasks**:
1. ⚠️ Configure Docker logging driver in `docker-compose.yml`
2. ⚠️ Add logging health check endpoint (`/api/logging/status`)
3. ⚠️ Implement log sampling for high-frequency events
4. ⚠️ Add metrics dashboard (sent, dropped, errors)
5. ⚠️ Document production logging best practices

**Deliverables**:
- Docker logging configured
- Logging metrics exposed
- Production runbook

---

## Appendix

### A. File Locations

#### Frontend Logging
- `frontend/src/lib/logging/index.js` - Core logger factory
- `frontend/src/lib/logging/Logger.js` - Singleton with WebSocket batching
- `frontend/src/lib/logging/singleton.js` - Global instance configuration
- `frontend/src/main.jsx` - Logger initialization

#### Backend Logging
- `backend/lib/logging/dispatcher.js` - Central event hub
- `backend/lib/logging/ingestion.js` - Frontend log normalization
- `backend/lib/logging/logger.js` - Logger factory
- `backend/lib/logging/config.js` - Configuration loader
- `backend/lib/logging/transports/console.js` - Console transport
- `backend/lib/logging/transports/loggly.js` - Loggly transport
- `backend/routers/websocket.mjs` - WebSocket endpoint
- `backend/index.js` - Logging initialization

#### Configuration
- `config/logging.yml` - Logging configuration (per-logger levels)
- `package.json` - npm scripts with log redirection

---

### B. Log Flow Diagram (Current State)

```
Frontend App
    │
    ├─ DaylightLogger.info()  ──────┐
    │                                │
    └─ console.log()  ───────────────┼─── [NOT CAPTURED] ❌
                                     │
                                     ▼
                            Logger.js (singleton)
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
            Local Console    WebSocket Queue   [Error Handlers Missing] ❌
                    │                │
                    │         (Batch 20 events)
                    │                │
                    │         (Flush every 1s)
                    │                │
                    ▼                ▼
            Browser DevTools   WebSocket Send
                                     │
                                     │ { topic: 'logging', events: [...] }
                                     │
                                     ▼
                          Backend WebSocket Router
                                     │
                                     ▼
                          Log Ingestion Service
                                     │
                          (Normalize & Enrich)
                                     │
                                     ▼
                            Log Dispatcher
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
            Console Transport  Loggly Transport  [File Transport Missing] ❌
                    │                │
                    │                ├─── Cloud Service
                    │                │
                    ▼                ▼
              stdout/stderr     Loggly API
                    │
                    │ (In dev mode only)
                    ▼
            2>&1 | tee -a dev.log
                    │
                    ▼
                dev.log file
```

---

### C. Proposed Log Flow (After Implementation)

```
Frontend App
    │
    ├─ DaylightLogger.info()  ──────┐
    │                                │
    ├─ console.log() ────────────────┼─── [INTERCEPTED] ✅
    │                                │
    └─ throw Error() ────────────────┼─── [CAUGHT BY window.onerror] ✅
                                     │
                                     ▼
                            Logger.js (singleton)
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
            Local Console    WebSocket Queue   Error Handlers ✅
                    │                │                │
                    │         (Batch 20 events)       │
                    │                │                │
                    │         (Flush every 1s)        │
                    │                │                │
                    ▼                ▼                ▼
            Browser DevTools   WebSocket Send ← All Events
                                     │
                                     │ { topic: 'logging', events: [...] }
                                     │
                                     ▼
                          Backend WebSocket Router
                                     │
                                     ▼
                          Log Ingestion Service
                                     │
                          (Normalize & Enrich)
                                     │
                                     ▼
                            Log Dispatcher
                                     │
                    ┌────────────────┼────────────────┬───────────────┐
                    │                │                │               │
                    ▼                ▼                ▼               ▼
            Console Transport  Loggly Transport  File Transport ✅  [Future]
                    │                │                │
                    │                ├─── Cloud       ├─── dev.log
                    │                │                │
                    ▼                ▼                ▼
              stdout/stderr     Loggly API      Rotated Files
                    │
                    │ (Docker captures for prod)
                    ▼
            Container Logs (json-file driver)
```

---

## Conclusion

DaylightStation's logging framework is **architecturally sound and production-ready** for explicit logging calls. However, to achieve the vision of "all frontend logs piped to backend," **critical gaps must be addressed**:

1. **Implement global error handlers** (window.onerror, unhandledrejection)
2. **Intercept native console methods** (console.log, console.warn, console.error)
3. **Add file transport** to replace shell redirection

With these changes, the system will be **100% aligned with the vision** and provide comprehensive observability across the entire stack.

**Next Steps**: Prioritize Phase 1 (error capture) and implement in Week 1. File transport can follow in Week 2.
