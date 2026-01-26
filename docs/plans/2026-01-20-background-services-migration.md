# Background Services Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all background services (WebSocket/EventBus, MQTT, scheduler) from legacy backend to new DDD backend.

**Architecture:** Flip infrastructure ownership - new backend initializes first and owns WebSocket, MQTT, and scheduler. Legacy becomes a pure API compatibility layer.

**Tech Stack:** Express, WebSocket (ws), MQTT, node-cron

---

## Current State

```
index.js loads:
  1. Legacy (creates WebSocket, MQTT, scheduler)
  2. New (infrastructure disabled)
```

## Target State

```
index.js loads:
  1. New (creates WebSocket, MQTT, scheduler) ← owns infrastructure
  2. Legacy (infrastructure disabled) ← pure API layer
```

---

## Task 1: Add disable flags to legacy app.mjs

**Files:**
- Modify: `backend/_legacy/app.mjs`

**Step 1: Update function signature to accept new options**

Add `enableWebSocket` and `enableScheduler` parameters to `createApp`:

```javascript
export async function createApp({
  server,
  logger,
  configPaths,
  configExists,
  enableWebSocket = true,  // NEW
  enableScheduler = true   // NEW (enableMqtt already exists via DISABLE_MQTT)
}) {
```

**Step 2: Guard WebSocket initialization**

Find the line (around line 135):
```javascript
// Initialize WebSocket server after config is loaded
await createWebsocketServer(server);
```

Replace with:
```javascript
// Initialize WebSocket server after config is loaded
if (enableWebSocket) {
  await createWebsocketServer(server);
} else {
  rootLogger.info('websocket.disabled', { reason: 'Infrastructure owned by new backend' });
}
```

**Step 3: Guard MQTT initialization**

The MQTT section (around lines 138-159) already has `DISABLE_MQTT` support. Update to also respect a parameter:

Find:
```javascript
if (process.env.DISABLE_MQTT) {
  rootLogger.info('mqtt.disabled', { reason: 'DISABLE_MQTT environment variable set' });
} else if (process.env.mqtt) {
  initMqttSubscriber(equipmentConfig);
}
```

Update to:
```javascript
if (process.env.DISABLE_MQTT || !enableWebSocket) {
  rootLogger.info('mqtt.disabled', {
    reason: process.env.DISABLE_MQTT
      ? 'DISABLE_MQTT environment variable set'
      : 'Infrastructure owned by new backend'
  });
} else if (process.env.mqtt) {
  initMqttSubscriber(equipmentConfig);
}
```

Note: MQTT in legacy is tied to WebSocket context, so we use `enableWebSocket` flag for both.

**Step 4: Guard scheduler/cron**

The legacy scheduler runs via the `/cron` router, which has its own internal `cronEnabled` check. We don't need to change the router itself - the scheduler will simply not be triggered when the new backend owns it.

However, to be explicit about what's running where, add a log when mounting:

Find (around line 301):
```javascript
app.use('/cron', cron);
```

Replace with:
```javascript
if (enableScheduler) {
  app.use('/cron', cron);
  rootLogger.info('cron.router.mounted', { path: '/cron' });
} else {
  // Mount read-only status endpoint only
  app.get('/cron/status', (req, res) => {
    res.json({
      status: 'disabled',
      reason: 'Scheduler owned by new backend',
      redirect: '/api/scheduling/status'
    });
  });
  rootLogger.info('cron.disabled', { reason: 'Scheduler owned by new backend' });
}
```

**Step 5: Commit**

```bash
git add backend/_legacy/app.mjs
git commit -m "feat(legacy): Add infrastructure disable flags

- Add enableWebSocket and enableScheduler parameters
- Guard WebSocket, MQTT, and cron initialization
- Legacy can now run as pure API layer"
```

---

## Task 2: Flip infrastructure ownership in index.js

**Files:**
- Modify: `backend/index.js`

**Step 1: Swap load order - new backend first**

Find (around lines 118-133):
```javascript
// Load legacy backend (owns scheduler, MQTT, WebSocket/EventBus)
const { createApp: createLegacyApp } = await import('./_legacy/app.mjs');
const legacyApp = await createLegacyApp({ server, logger, configPaths, configExists });
logger.info('router.legacy_loaded', { message: 'Legacy backend loaded' });

// Load new backend (scheduler and MQTT disabled - legacy owns them)
const { createApp: createNewApp } = await import('./src/app.mjs');
const newApp = await createNewApp({
  server,
  logger,
  configPaths,
  configExists,
  enableScheduler: false,
  enableMqtt: false
});
logger.info('router.new_loaded', { message: 'New backend loaded (scheduler/MQTT disabled)' });
```

Replace with:
```javascript
// Load new backend first (owns WebSocket/EventBus, MQTT, scheduler)
const { createApp: createNewApp } = await import('./src/app.mjs');
const newApp = await createNewApp({
  server,
  logger,
  configPaths,
  configExists
  // enableScheduler: true (default)
  // enableMqtt: true (default)
});
logger.info('router.new_loaded', { message: 'New backend loaded (owns infrastructure)' });

// Load legacy backend (pure API layer - infrastructure disabled)
const { createApp: createLegacyApp } = await import('./_legacy/app.mjs');
const legacyApp = await createLegacyApp({
  server,
  logger,
  configPaths,
  configExists,
  enableWebSocket: false,
  enableScheduler: false
});
logger.info('router.legacy_loaded', { message: 'Legacy backend loaded (API layer only)' });
```

**Step 2: Update comment block at file top**

Find (lines 1-10):
```javascript
// backend/index.js
/**
 * DaylightStation Backend Entry Point with Path-Based Routing
 *
 * Routes requests based on URL path:
 * - /api/v1/* -> new DDD backend (in src/)
 * - Everything else -> legacy backend (in _legacy/)
 *
 * Legacy owns shared infrastructure: WebSocket/EventBus, MQTT, scheduler.
 */
```

Replace with:
```javascript
// backend/index.js
/**
 * DaylightStation Backend Entry Point with Path-Based Routing
 *
 * Routes requests based on URL path:
 * - /api/v1/* -> new DDD backend (in src/)
 * - Everything else -> legacy backend (in _legacy/)
 *
 * New backend owns shared infrastructure: WebSocket/EventBus, MQTT, scheduler.
 * Legacy is a pure API compatibility layer.
 */
```

**Step 3: Commit**

```bash
git add backend/index.js
git commit -m "feat: Flip infrastructure ownership to new backend

- New backend now loads first and owns WebSocket, MQTT, scheduler
- Legacy loads second with infrastructure disabled
- Legacy is now pure API compatibility layer"
```

---

## Task 3: Verify scheduler runs from new backend

**Files:**
- Read: `backend/src/app.mjs` (lines 541-578)
- Test manually

**Step 1: Review new backend scheduler initialization**

Verify in `src/app.mjs` that when `enableScheduler` is true (default), the scheduler starts:

```javascript
// Start scheduler (only if enableScheduler is true - disabled in toggle mode)
if (enableScheduler) {
  scheduler.start();
} else {
  rootLogger.info('scheduler.disabled', { reason: 'toggle mode - legacy scheduler will run instead' });
}
```

Update the else message since it's no longer about toggle mode:

```javascript
if (enableScheduler) {
  scheduler.start();
  rootLogger.info('scheduler.started', { intervalMs: 5000 });
} else {
  rootLogger.info('scheduler.disabled', { reason: 'Disabled by configuration' });
}
```

**Step 2: Commit**

```bash
git add backend/src/app.mjs
git commit -m "fix: Update scheduler log message for new ownership model"
```

---

## Task 4: Test the migration

**Verification steps:**

1. Start the server:
```bash
cd /root/Code/DaylightStation/backend
PORT=3500 SECONDARY_PORT=3501 DISABLE_MQTT=true node index.js 2>&1 | tee /tmp/migration-test.log
```

2. Check startup logs for correct ordering:
   - `router.new_loaded` with "owns infrastructure" appears FIRST
   - `router.legacy_loaded` with "API layer only" appears SECOND
   - `scheduler.started` or `scheduler.disabled` from new backend (not legacy)
   - `websocket.disabled` from legacy
   - `cron.disabled` from legacy

3. Test API endpoints:
```bash
# Legacy route (should work)
curl http://localhost:3500/api/status | jq .

# New route (should work)
curl http://localhost:3500/api/v1/api/status | jq .

# Check X-Backend headers
curl -I http://localhost:3500/api/status 2>&1 | grep X-Backend
curl -I http://localhost:3500/api/v1/api/status 2>&1 | grep X-Backend

# Scheduler status (from new backend)
curl http://localhost:3500/api/v1/api/scheduling/status | jq .

# Legacy cron status (should show disabled)
curl http://localhost:3500/cron/status | jq .
```

4. Test WebSocket connection:
```bash
# Should connect successfully (EventBus owned by new backend)
websocat ws://localhost:3500/ws
```

---

## Task 5: Update design document

**Files:**
- Modify: `docs/plans/2026-01-20-concurrent-routing-design.md`

Add a section documenting the infrastructure ownership change:

```markdown
---

## Infrastructure Ownership (Updated 2026-01-20)

After initial concurrent routing implementation, infrastructure ownership was flipped:

**Before:** Legacy owned WebSocket, MQTT, scheduler
**After:** New backend owns all infrastructure

```
index.js loads:
  1. New backend (src/) - owns WebSocket, MQTT, scheduler
  2. Legacy backend (_legacy/) - pure API compatibility layer
```

This change simplifies the migration path - new features use new backend infrastructure directly.
```

**Commit:**

```bash
git add docs/plans/2026-01-20-concurrent-routing-design.md
git commit -m "docs: Update design for infrastructure ownership flip"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add disable flags to legacy | `_legacy/app.mjs` |
| 2 | Flip ownership in index.js | `index.js` |
| 3 | Update scheduler logging | `src/app.mjs` |
| 4 | Test migration | Manual verification |
| 5 | Update design docs | `concurrent-routing-design.md` |

After completing all tasks:
- New backend owns WebSocket/EventBus, MQTT, scheduler
- Legacy is pure API layer with no background services
- Frontend can migrate to `/api/v1/*` endpoints at own pace
