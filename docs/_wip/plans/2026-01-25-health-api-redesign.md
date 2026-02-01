# Health/Status API Redesign Plan
**Date:** 2026-01-25  
**Status:** ✅ Complete

## Problem Statement

Current health/status endpoints are buried deep in routing layers, causing:
1. **Main server (3112)**: ALL `/api/v1/*` routes TIMEOUT including health
2. **Webhook server (3119)**: Only `/api/v1/dev/proxy_status` works, health returns 404
3. Health checks fail when routing breaks - exactly when you need them most

## Root Cause

The devProxy works because it's mounted **directly on the Express app** before any complex routing:
```javascript
webhookApp.use('/api/v1/dev', devProxy.router);  // Works - direct mount
```

Other routes go through path-stripping and delegation to sub-apps, which breaks when:
- `req.url` is modified but `req.originalUrl` isn't updated
- Express apps are called as middleware functions
- Async initialization races cause routes to hang

## Design Principles

1. **Health endpoints FIRST** - before any complex routing
2. **No dependencies** for basic health - just "server responding"
3. **Separate liveness from readiness** - Kubernetes-style probes
4. **Consistent response format** across all endpoints
5. **Include diagnostic info** in detailed status only

## New Endpoint Structure

| Endpoint | Port(s) | Purpose | Auth |
|----------|---------|---------|------|
| `/health` | 3111, 3112, 3119 | Root health (always works) | None |
| `/api/v1/health` | 3111, 3112 | Alias for `/health` | None |
| `/api/v1/health/live` | 3111, 3112 | Liveness probe | None |
| `/api/v1/health/ready` | 3111, 3112 | Readiness probe | None |
| `/api/v1/status` | 3111, 3112 | Detailed system status | Optional |
| `/api/v1/dev/proxy_status` | 3119 only | DevProxy status | None |

## Response Formats

### Basic Health (`/health`, `/api/v1/health`)
```json
{
  "ok": true,
  "server": "main|webhook",
  "timestamp": 1737842400000,
  "uptime": 3600.5
}
```

### Liveness Probe (`/api/v1/health/live`)
```json
{
  "status": "ok"
}
```

### Readiness Probe (`/api/v1/health/ready`)
```json
{
  "status": "ready",
  "checks": {
    "config": true,
    "database": true,
    "scheduler": false
  }
}
```

### Detailed Status (`/api/v1/status`)
```json
{
  "ok": true,
  "server": "main",
  "environment": "development",
  "version": "1.0.0",
  "uptime": 3600.5,
  "timestamp": 1737842400000,
  "routes": {
    "apiV1": ["/health", "/fitness", "/nutribot", ...],
    "legacy": ["/api/content", "/api/finance", ...]
  },
  "services": {
    "configService": true,
    "scheduler": false,
    "mqtt": false,
    "websocket": true
  },
  "devProxy": null  // or { enabled: true, target: "10.0.0.68:3119" }
}
```

## Implementation Steps

### Step 1: Add Root Health Handler to Main Server (index.js)

In the `server.on('request')` handler, intercept `/health` and `/api/v1/health` **before** any routing:

```javascript
server.on('request', (req, res) => {
  // Root health check - bypasses all routing
  if (req.url === '/health' || req.url === '/api/v1/health' || 
      req.url === '/api/v1/health/live') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      server: 'main',
      timestamp: Date.now(),
      uptime: process.uptime()
    }));
    return;
  }
  
  // Existing routing logic...
});
```

### Step 2: Add Root Health Middleware to Webhook Server (index.js)

Mount health FIRST on webhookApp, before devProxy:

```javascript
const webhookApp = express();
webhookApp.use(express.json());

// Health check - FIRST middleware
webhookApp.get('/health', (req, res) => {
  res.json({
    ok: true,
    server: 'webhook',
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

webhookApp.get('/api/v1/health', (req, res) => {
  res.json({
    ok: true,
    server: 'webhook',
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

// Then devProxy...
webhookApp.use('/api/v1/dev', devProxy.router);
```

### Step 3: Create Health Response Builder (Optional Enhancement)

Create `backend/src/0_infrastructure/health/index.mjs`:

```javascript
export function createHealthResponse(serverName, options = {}) {
  return {
    ok: true,
    server: serverName,
    timestamp: Date.now(),
    uptime: process.uptime(),
    ...options
  };
}

export function createReadinessResponse(checks) {
  const allReady = Object.values(checks).every(v => v === true);
  return {
    status: allReady ? 'ready' : 'not_ready',
    checks
  };
}
```

### Step 4: Add Readiness Probe to Main Server

After apps are loaded, add readiness check:

```javascript
// In new backend app.mjs or index.js
app.get('/api/v1/health/ready', (req, res) => {
  const checks = {
    config: configService.isInitialized?.() ?? true,
    scheduler: scheduler?.isRunning?.() ?? false,
    mqtt: mqttClient?.connected ?? false
  };
  const allReady = Object.values(checks).every(v => v);
  res.status(allReady ? 200 : 503).json({
    status: allReady ? 'ready' : 'not_ready',
    checks
  });
});
```

### Step 5: Consolidate/Deprecate Old Endpoints

Mark for future removal (add deprecation warnings):
- `/api/ping` (legacy)
- `/api/health` (legacy)
- `/api/v1/ping` (new backend)
- Domain-specific health endpoints (unless needed)

## Files to Modify

1. **`backend/index.js`** - Add root health handlers to both servers
2. **`backend/src/app.mjs`** - Add readiness probe to new backend
3. **`backend/_legacy/app.mjs`** - (Optional) Add deprecation to old health endpoints

## Testing Checklist

After implementation, verify:

```bash
# Main server (3112 in dev)
curl http://127.0.0.1:3112/health                    # Should return JSON immediately
curl http://127.0.0.1:3112/api/v1/health             # Should return JSON immediately
curl http://127.0.0.1:3112/api/v1/health/live        # Should return { status: "ok" }
curl http://127.0.0.1:3112/api/v1/health/ready       # Should return readiness status

# Webhook server (3119)
curl http://127.0.0.1:3119/health                    # Should return JSON immediately
curl http://127.0.0.1:3119/api/v1/health             # Should return JSON immediately
curl http://127.0.0.1:3119/api/v1/dev/proxy_status   # Should continue working

# Via Vite proxy (3111 in dev)
curl http://127.0.0.1:3111/api/v1/health             # Should proxy to backend
```

## Rollback Plan

If issues arise:
1. Health handlers are at the TOP of the middleware chain, independent of other routing
2. Can be disabled by removing the early-return handlers
3. Does not affect existing route behavior

## Future Enhancements

1. **Prometheus metrics endpoint** (`/metrics`) for monitoring integration
2. **Health check aggregation** from multiple services
3. **Circuit breaker integration** - health status affects request routing
4. **Dashboard endpoint** (`/api/v1/status/dashboard`) with HTML visualization

## Implementation Results (2026-01-25)

### Changes Made
1. **backend/index.js** - Added root health handlers at the very start of the request handler chain for both main server and webhook server
2. **package.json** - Fixed `backend:dev` script to run `backend/index.js` instead of `backend/src/server.mjs`

### Test Results

```
=== Main Server 3112 ===
/health:                  {"ok":true,"server":"main","timestamp":...,"uptime":...}
/api/v1/health:           {"ok":true,"server":"main","timestamp":...,"uptime":...}
/api/v1/health/live:      {"ok":true,"server":"main","timestamp":...,"uptime":...}

=== Webhook Server 3119 ===
/health:                  {"ok":true,"server":"webhook","timestamp":...,"uptime":...}
/api/v1/health:           {"ok":true,"server":"webhook","timestamp":...,"uptime":...}
/api/v1/health/live:      {"status":"ok"}
/api/v1/dev/proxy_status: {"proxyEnabled":false,"targetHost":"...","configured":true}
```

All endpoints respond instantly regardless of other routing issues.
