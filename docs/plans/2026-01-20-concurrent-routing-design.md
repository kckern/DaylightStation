# Concurrent Backend Routing Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run legacy and new backends concurrently with path-based routing instead of toggle switching.

**Architecture:** Single HTTP server routes `/api/v1/*` to new DDD backend, everything else to legacy. Legacy owns shared infrastructure (WebSocket, MQTT, scheduler).

**Tech Stack:** Express, Node.js HTTP server, existing DDD structure

---

## Architecture

```
                    HTTP Server (port 3112)
                           │
                    ┌──────┴──────┐
                    │  Router MW  │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    /api/v1/*         /ws/*            everything else
          │                │                │
    ┌─────┴─────┐    ┌─────┴─────┐    ┌─────┴─────┐
    │  New App  │    │  EventBus │    │ Legacy App│
    │ (src/)    │    │ (shared)  │    │ (_legacy/)│
    └───────────┘    └───────────┘    └───────────┘
```

**Key principles:**
- Legacy app handles all existing routes (preserves current functionality)
- New app mounts only at `/api/v1/*` prefix (fresh API design)
- EventBus/WebSocket initialized by legacy, used as singleton by both
- No toggle - both always active simultaneously
- X-Backend header indicates which backend served request

---

## Entry Point Implementation

**File: `backend/index.js`**

```javascript
server.on('request', (req, res) => {
  res.setHeader('X-Backend', req.url.startsWith('/api/v1') ? 'new' : 'legacy');

  if (req.url.startsWith('/api/v1')) {
    // Strip /api/v1 prefix before passing to new app
    req.url = req.url.replace('/api/v1', '') || '/';
    return newApp(req, res, (err) => {
      if (err && !res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    });
  }

  // Everything else -> legacy
  return legacyApp(req, res, (err) => {
    if (err && !res.headersSent) {
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });
});
```

**New app configuration:**
```javascript
const newApp = await createNewApp({
  server,
  enableScheduler: false,  // legacy handles cron
  enableMqtt: false,       // legacy handles MQTT
});
```

---

## New App Route Structure

Clean `/api/v1/*` API (separate from legacy, not mirroring):

```
/api/v1/
├── /health          GET     - Health check
├── /status          GET     - Server status
│
├── /content/        - Media & content domain
│   ├── /plex/*      - Plex integration
│   ├── /local/*     - Local content
│   └── /watchlist   - Watchlist management
│
├── /fitness/        - Fitness domain
│   ├── /sessions    - Workout sessions
│   ├── /equipment   - Equipment config
│   └── /metrics     - Health metrics
│
├── /finance/        - Finance domain
│   ├── /budget      - Budget data
│   └── /transactions
│
├── /home/           - Home automation
│   ├── /scenes      - HA scenes
│   ├── /devices     - Device control
│   └── /keyboard    - Keyboard configs
│
└── /scheduling/     - Cron/job management (read-only)
```

---

## Implementation Tasks

### Task 1: Rewrite backend/index.js

**Files:**
- Modify: `backend/index.js`

Replace toggle-based routing with path-based routing:
1. Remove toggle state variable and toggle endpoint handler
2. Add path prefix check for `/api/v1`
3. Strip prefix before passing to new app
4. Keep proper `done` callback on both app calls

### Task 2: Clean up backend/src/app.mjs

**Files:**
- Modify: `backend/src/app.mjs`

Remove legacy baggage from new app:
1. Remove legacy router imports (lines ~670-690)
2. Remove legacy redirect shims (lines ~586-662)
3. Remove `legacyTracker` middleware and imports
4. Keep only DDD routers mounted at their natural paths

### Task 3: Verify legacy app unchanged

**Files:**
- Read: `backend/_legacy/app.mjs`

Confirm legacy app needs no changes - it continues to:
- Own WebSocket/EventBus
- Own MQTT subscriber
- Own scheduler/cron
- Handle all existing routes

### Task 4: Test concurrent routing

Run server and verify:
1. `/api/status` returns response with `X-Backend: legacy`
2. `/api/v1/health` returns response with `X-Backend: new`
3. WebSocket connects successfully
4. No crashes on startup

---

## Migration Path

1. Frontend can start using `/api/v1/*` endpoints immediately
2. Legacy endpoints continue working unchanged
3. Gradually update frontend to prefer v1 endpoints
4. Eventually deprecate legacy routes

---

## What Gets Deleted

From `backend/src/app.mjs`:
- ~100 lines of legacy router imports and mounting
- ~80 lines of legacy redirect shims
- Legacy tracker middleware

From `backend/index.js`:
- Toggle state and endpoint (~50 lines)
