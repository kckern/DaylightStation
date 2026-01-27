# Backend Toggle Gate Design

**Date:** 2026-01-20
**Status:** Approved
**Branch:** backend-refactor

## Problem

Need a runtime toggle between `backend/_legacy` and `backend/src` to:
- Test frontend against legacy backend
- Switch to new backend, confirm/debug
- Easily revert to legacy without restart
- Eventually drop legacy once validated

## Solution

In-memory global toggle with `/api/toggle_backend` endpoint.

## Architecture

```
Request → index.js → Toggle Middleware → _legacy/app.mjs OR src/app.mjs
                          ↑
              /api/toggle_backend endpoint
```

### Components

1. **Toggle State** - In-memory variable: `let activeBackend = 'legacy'`
2. **Toggle Endpoint** (`/api/toggle_backend`)
   - `GET` - Returns `{ active: "legacy" | "new" }`
   - `POST { target: "legacy" | "new" }` - Switches, returns `{ active, switched: true }`
3. **Routing Middleware** - Routes all requests to active backend
4. **Both backends loaded** - Initialize at startup for instant switching

### Behavior

- Default: `legacy` on every restart (safe)
- Switch: Instant, affects next request
- Both backends share port 3112
- Response header `X-Backend: legacy|new` indicates which served the request

## File Changes

| File | Action |
|------|--------|
| `backend/index.js` | Rewrite with toggle logic, shared initialization |
| `backend/_legacy/app.mjs` | New - extract Express app from index.js |
| `backend/_legacy/index.js` | Slim down to import app.mjs + listen() |
| `backend/src/app.mjs` | New - extract Express app from server.mjs |
| `backend/src/server.mjs` | Slim down to import app.mjs + listen() |

## Implementation Details

### backend/index.js (new structure)

```javascript
import express from 'express';
import { createServer } from 'http';

// Shared initialization (config, logging, MQTT) done once here
// ...

// Toggle state
let activeBackend = 'legacy';

const app = express();
app.use(express.json());

// Toggle endpoint
app.get('/api/toggle_backend', (req, res) => {
  res.json({ active: activeBackend });
});

app.post('/api/toggle_backend', (req, res) => {
  const { target } = req.body;
  if (target !== 'legacy' && target !== 'new') {
    return res.status(400).json({ error: 'target must be "legacy" or "new"' });
  }
  activeBackend = target;
  res.json({ active: activeBackend, switched: true });
});

// Load both backends
let legacyApp, newApp;
async function initBackends() {
  const legacy = await import('./_legacy/app.mjs');
  const newBackend = await import('./src/app.mjs');
  legacyApp = legacy.default;
  newApp = newBackend.default;
}

// Routing middleware
app.use((req, res, next) => {
  res.setHeader('X-Backend', activeBackend);
  const target = activeBackend === 'legacy' ? legacyApp : newApp;
  target(req, res, next);
});

// Start server after backends initialized
initBackends().then(() => {
  const server = createServer(app);
  server.listen(3112, '0.0.0.0');
});
```

### _legacy/app.mjs and src/app.mjs

Extract all Express app setup, export the app without calling `listen()`.

### Scheduler handling

**Legacy (`_legacy/cron.mjs`):** No changes - scheduler runs as normal via `setInterval`.

**New (`src/app.mjs`):** Pass `{ enableScheduler: false }` when initializing via toggle:
```javascript
// In index.js when loading new backend
const newBackend = await import('./src/app.mjs');
newApp = newBackend.createApp({ enableScheduler: false });
```

The new backend's `createApp()` function accepts options and conditionally starts the scheduler.

## Edge Cases

1. **WebSocket** - Both backends attach WS to same HTTP server
2. **Shared state** - Config, logging, MQTT initialized once in index.js
3. **Secondary API (port 3119)** - Stays on legacy, not toggled
4. **Cold start** - Both backends initialize at startup, no delay on switch
5. **Cron/Scheduler** - Legacy scheduler only; new backend's scheduler disabled during toggle phase
   - Legacy `setInterval` in `cron.mjs` continues running regardless of toggle
   - New `Scheduler` class is NOT started when loaded via toggle
   - HTTP routes to `/cron/*` follow the toggle (for manual triggers)
   - Once toggle is removed and new backend is primary, new scheduler activates

## Shared Infrastructure

The legacy backend already imports many src/ components:
- Services: HealthAggregationService, GratitudeService, ProxyService
- Adapters: ThermalPrinterAdapter, TTSAdapter, MQTTSensorAdapter, GmailAdapter
- Infrastructure: EventBus, routing toggle system

This is fine because:
1. Services/adapters are stateless - no conflicting state
2. The toggle switches the **routing layer**, not underlying services
3. Both backends effectively share the same infrastructure

## Out of Scope

- Per-route toggling (existing routing.yml handles this)
- Persistence across restarts (intentionally resets to legacy)
- UI for toggle (use curl/Postman or add later)

## Migration Path

1. Implement toggle gate
2. Test frontend with legacy (baseline)
3. Switch to new, fix issues
4. Iterate until new backend passes all tests
5. Update index.js to point directly to src/app.mjs
6. Delete _legacy/ directory
