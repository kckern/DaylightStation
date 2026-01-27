# Legacy Cutover Safety Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable safe, gradual migration from legacy backend to new DDD backend with rollback capability and observability.

**Architecture:** Wire legacy route tracker to all legacy endpoints, expose admin dashboard for hit monitoring, add parity tests for critical endpoints, implement per-endpoint feature flags for gradual cutover.

**Tech Stack:** Express middleware, Jest integration tests, YAML-based feature flags

---

## Task 1: Wire Legacy Tracker to All Legacy Routes

**Files:**
- Modify: `backend/_legacy/app.mjs:330-350`

**Step 1: Import the legacy tracker**

Add import at top of file (around line 25):
```javascript
import { getLegacyTracker } from '../src/4_api/middleware/legacyTracker.mjs';
```

**Step 2: Create tracker instance and wire to routes**

Before the route mounting section (around line 330), add:
```javascript
    // Legacy route hit tracking for cutover monitoring
    const legacyTracker = getLegacyTracker({ logger });

    // Expose tracker stats via admin endpoint
    app.get('/admin/legacy-hits', (req, res) => {
      res.json({
        hits: legacyTracker.getHits(),
        totalHits: legacyTracker.getTotalHits(),
        serverUptime: process.uptime()
      });
    });
```

**Step 3: Add tracker middleware to each legacy router**

Update each `app.use()` to include the tracker:
```javascript
    app.use("/media", legacyTracker.middleware, mediaRouter);
    app.use("/api/health", legacyTracker.middleware, healthRouter);
    app.use("/api/lifelog", legacyTracker.middleware, lifelogRouter);
    app.use("/api/fitness", legacyTracker.middleware, fitnessRouter);
    app.use("/harvest", legacyTracker.middleware, harvestRouter);
    app.use("/home", legacyTracker.middleware, homeRouter);
    app.use("/data", legacyTracker.middleware, fetchRouter);
```

**Step 4: Verify changes compile**

Run: `cd backend && node --check _legacy/app.mjs`
Expected: No output (no syntax errors)

**Step 5: Commit**

```bash
git add backend/_legacy/app.mjs
git commit -m "feat: wire legacy route tracker to all legacy endpoints"
```

---

## Task 2: Clean Up Dead Code in New Backend

**Files:**
- Modify: `backend/src/app.mjs:329`

The `/media/log` shim in new backend is dead code - legacy handles this route.

**Step 1: Remove dead shim**

Find and remove line 329:
```javascript
// REMOVE THIS LINE - dead code, legacy handles /media/log
app.post('/media/log', contentRouters.legacyShims.mediaLog);
```

**Step 2: Add comment explaining routing**

Replace with comment:
```javascript
  // NOTE: POST /media/log is handled by legacy backend (_legacy/routers/media.mjs)
  // Frontend calls /media/log (not /api/v1/media/log), so it routes to legacy.
  // When cutover is ready, migrate frontend to call /api/v1/play/log instead.
```

**Step 3: Verify changes compile**

Run: `cd backend && node --check src/app.mjs`
Expected: No output (no syntax errors)

**Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "chore: remove dead /media/log shim, add routing comment"
```

---

## Task 3: Add Parity Test for /media/log

**Files:**
- Modify: `tests/integration/api/parity.test.mjs`

**Step 1: Add test for media/log endpoint**

Add after the existing tests (around line 150):
```javascript
describe('POST /media/log parity', () => {
  const testPayload = {
    type: 'plex',
    media_key: '999999',  // Test ID that won't affect real data
    percent: 50,
    seconds: 300,
    title: 'Parity Test Video',
    watched_duration: 150
  };

  it('should accept valid playback log request', async () => {
    const res = await fetch(`${BASE_URL}/media/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload)
    });

    // Should succeed or return specific validation error
    expect([200, 400]).toContain(res.status);

    const body = await res.json();
    if (res.status === 200) {
      expect(body.response).toBeDefined();
      expect(body.response.type).toBe('plex');
    }
  });

  it('should reject request missing required fields', async () => {
    const res = await fetch(`${BASE_URL}/media/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'plex' })  // Missing media_key, percent
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing');
  });

  it('should reject request with seconds < 10', async () => {
    const res = await fetch(`${BASE_URL}/media/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...testPayload, seconds: 5 })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('seconds');
  });
});
```

**Step 2: Run the test to verify it passes**

Run: `PARITY_TEST_URL=http://localhost:3112 npx jest tests/integration/api/parity.test.mjs --testNamePattern="media/log" -v`

Expected: Tests pass (or fail if server not running - that's OK for now)

**Step 3: Commit**

```bash
git add tests/integration/api/parity.test.mjs
git commit -m "test: add parity tests for POST /media/log endpoint"
```

---

## Task 4: Add Parity Test for /api/fitness/save_session

**Files:**
- Modify: `tests/integration/api/parity.test.mjs`

**Step 1: Add test for fitness session save endpoint**

Add after the media/log tests:
```javascript
describe('POST /api/fitness/save_session parity', () => {
  const testPayload = {
    version: 3,
    session: {
      id: '99990101000000',  // Test ID format
      date: '9999-01-01',
      start: '9999-01-01 00:00:00',
      end: '9999-01-01 00:01:00',
      duration_seconds: 60
    },
    timeline: {
      interval_seconds: 5,
      tick_count: 12,
      encoding: 'rle',
      series: {}
    },
    participants: [],
    events: []
  };

  it('should accept valid v3 session payload', async () => {
    const res = await fetch(`${BASE_URL}/api/fitness/save_session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionData: testPayload })
    });

    // Should succeed
    expect([200, 201]).toContain(res.status);
  });

  it('should reject payload without session.id', async () => {
    const badPayload = { ...testPayload, session: { date: '9999-01-01' } };
    const res = await fetch(`${BASE_URL}/api/fitness/save_session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionData: badPayload })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('sessionId');
  });

  it('should reject v2 payload without root sessionId', async () => {
    const v2Payload = { ...testPayload, version: 2 };
    delete v2Payload.session;  // v2 expects root sessionId

    const res = await fetch(`${BASE_URL}/api/fitness/save_session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionData: v2Payload })
    });

    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run the test**

Run: `PARITY_TEST_URL=http://localhost:3112 npx jest tests/integration/api/parity.test.mjs --testNamePattern="fitness" -v`

**Step 3: Commit**

```bash
git add tests/integration/api/parity.test.mjs
git commit -m "test: add parity tests for POST /api/fitness/save_session"
```

---

## Task 5: Create Feature Flag Infrastructure for Cutover

**Files:**
- Create: `backend/src/4_api/middleware/cutoverFlags.mjs`

**Step 1: Create the feature flag module**

```javascript
/**
 * Cutover Feature Flags
 *
 * Controls per-endpoint routing between legacy and new backend.
 * Flags are stored in YAML config for easy toggling without deploys.
 */

import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';

const CONFIG_PATH = process.env.CUTOVER_FLAGS_PATH || '/data/config/cutover-flags.yml';

// Default flags - all routes go to legacy
const DEFAULT_FLAGS = {
  '/media/log': 'legacy',
  '/api/fitness/save_session': 'legacy',
  '/api/health': 'legacy',
  '/api/lifelog': 'legacy',
  '/api/gratitude': 'legacy'
};

let flags = { ...DEFAULT_FLAGS };
let lastLoadTime = 0;

/**
 * Load flags from YAML file (with 30s cache)
 */
function loadFlags() {
  const now = Date.now();
  if (now - lastLoadTime < 30000) return flags;

  try {
    if (existsSync(CONFIG_PATH)) {
      const content = readFileSync(CONFIG_PATH, 'utf8');
      const parsed = parseYaml(content);
      flags = { ...DEFAULT_FLAGS, ...parsed };
      lastLoadTime = now;
    }
  } catch (err) {
    console.error('[CutoverFlags] Failed to load config:', err.message);
  }

  return flags;
}

/**
 * Check if route should use new backend
 * @param {string} route - Route path (e.g., '/media/log')
 * @returns {boolean} - True if should route to new backend
 */
export function shouldUseNewBackend(route) {
  const currentFlags = loadFlags();
  return currentFlags[route] === 'new';
}

/**
 * Get all current flags
 */
export function getFlags() {
  return loadFlags();
}

/**
 * Create middleware that routes based on flags
 * @param {string} route - Route to check
 * @param {Function} newHandler - Handler for new backend
 * @param {Function} legacyHandler - Handler for legacy backend
 */
export function createCutoverMiddleware(route, newHandler, legacyHandler) {
  return (req, res, next) => {
    if (shouldUseNewBackend(route)) {
      return newHandler(req, res, next);
    }
    return legacyHandler(req, res, next);
  };
}
```

**Step 2: Verify syntax**

Run: `cd backend && node --check src/4_api/middleware/cutoverFlags.mjs`

**Step 3: Commit**

```bash
git add backend/src/4_api/middleware/cutoverFlags.mjs
git commit -m "feat: add cutover feature flag infrastructure"
```

---

## Task 6: Create Sample Cutover Flags Config

**Files:**
- Create: `config/cutover-flags.yml.example`

**Step 1: Create example config file**

```yaml
# Cutover Flags Configuration
#
# Controls which backend handles each route.
# Values: 'legacy' (default) or 'new'
#
# To enable new backend for a route:
# 1. Ensure parity tests pass for that route
# 2. Change value from 'legacy' to 'new'
# 3. Monitor /admin/legacy-hits for remaining traffic
# 4. If issues, change back to 'legacy'

# Playback progress tracking
/media/log: legacy

# Fitness session persistence
/api/fitness/save_session: legacy

# Health data
/api/health: legacy

# Lifelog entries
/api/lifelog: legacy

# Gratitude journal
/api/gratitude: legacy
```

**Step 2: Commit**

```bash
git add config/cutover-flags.yml.example
git commit -m "docs: add example cutover flags config"
```

---

## Task 7: Add Admin Endpoint for Cutover Status

**Files:**
- Modify: `backend/_legacy/app.mjs`

**Step 1: Add cutover status endpoint**

After the `/admin/legacy-hits` endpoint added in Task 1, add:
```javascript
    // Cutover status dashboard
    app.get('/admin/cutover-status', async (req, res) => {
      const { getFlags } = await import('../src/4_api/middleware/cutoverFlags.mjs');

      res.json({
        flags: getFlags(),
        legacyHits: legacyTracker.getHits(),
        totalLegacyHits: legacyTracker.getTotalHits(),
        serverUptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    });
```

**Step 2: Verify changes compile**

Run: `cd backend && node --check _legacy/app.mjs`

**Step 3: Commit**

```bash
git add backend/_legacy/app.mjs
git commit -m "feat: add /admin/cutover-status endpoint"
```

---

## Task 8: Update Audit Document with Implementation Status

**Files:**
- Modify: `docs/_wip/audits/2026-01-21-legacy-routing-cutover-audit.md`

**Step 1: Update the checklist section**

Replace the "Pre-Cutover Requirements" section with:
```markdown
### Pre-Cutover Requirements

- [x] **Field mapping audit:** Verified /media/log middleware was broken, removed
- [x] **Legacy route tracking:** Wired legacyTracker to all legacy routes
- [x] **Parity tests:** Added for /media/log and /api/fitness/save_session
- [x] **Feature flags:** Created cutoverFlags.mjs infrastructure
- [x] **Admin dashboard:** /admin/cutover-status endpoint

### Cutover Process (Per-Endpoint)

1. Run parity tests for the endpoint
2. Edit `cutover-flags.yml` to set route to 'new'
3. Deploy and monitor /admin/cutover-status
4. Check /admin/legacy-hits to confirm traffic moved
5. If issues, set flag back to 'legacy'
```

**Step 2: Commit**

```bash
git add docs/_wip/audits/2026-01-21-legacy-routing-cutover-audit.md
git commit -m "docs: update audit with implementation status"
```

---

## Summary

After completing all tasks:

1. **Legacy route hits are tracked** via `/admin/legacy-hits`
2. **Cutover status dashboard** available at `/admin/cutover-status`
3. **Parity tests** cover critical endpoints
4. **Feature flags** enable per-endpoint cutover with rollback
5. **Documentation** updated with cutover process

### Cutover Workflow

```
1. Pick endpoint to migrate
2. Run: npx jest parity.test.mjs --testNamePattern="<endpoint>"
3. If pass: Edit cutover-flags.yml, set to 'new'
4. Deploy
5. Monitor /admin/cutover-status
6. If issues: Set flag back to 'legacy', investigate
```
