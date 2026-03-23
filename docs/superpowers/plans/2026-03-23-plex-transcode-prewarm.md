# Plex Transcode Pre-Warming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 15s stall + player remount when loading Plex DASH content via the device load API, by pre-warming the transcode session during the wake-and-load flow.

**Architecture:** New `TranscodePrewarmService` resolves the queue and kicks off the Plex transcode before loading the page. A token-based cache passes the pre-warmed DASH URL to the frontend, which injects it into the first queue item so the player skips the `/play` API call and uses the already-warm stream.

**Tech Stack:** Node.js/Express backend, React frontend, Plex transcode decision API, DASH streaming

**Spec:** `docs/superpowers/specs/2026-03-23-plex-transcode-prewarm-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/3_applications/devices/services/TranscodePrewarmService.mjs` | Create | Resolve queue, create Plex transcode session, fetch MPD, cache result |
| `backend/src/4_api/v1/routers/prewarm.mjs` | Create | `GET /api/v1/prewarm/:token` — redeem cached DASH URL |
| `backend/src/0_system/bootstrap.mjs` | Modify | Factory function for TranscodePrewarmService |
| `backend/src/app.mjs` | Modify | Wire up prewarm service + router |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | Modify | Add pre-warm step before load |
| `frontend/src/lib/parseAutoplayParams.js` | Modify | Pass through `prewarmToken` and `prewarmContentId` |
| `frontend/src/modules/Player/hooks/useQueueController.js` | Modify | Redeem token, inject pre-warmed URL into first queue item |
| `tests/isolated/services/transcode-prewarm.test.mjs` | Create | Unit tests for TranscodePrewarmService |
| `tests/isolated/api/prewarm-router.test.mjs` | Create | Unit tests for prewarm token redemption |

---

### Task 1: TranscodePrewarmService — Token Cache + Core Service

**Files:**
- Create: `backend/src/3_applications/devices/services/TranscodePrewarmService.mjs`
- Test: `tests/isolated/services/transcode-prewarm.test.mjs`

- [ ] **Step 1: Write the failing test for prewarm with a Plex queue**

```javascript
// tests/isolated/services/transcode-prewarm.test.mjs
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { TranscodePrewarmService } from '../../../backend/src/3_applications/devices/services/TranscodePrewarmService.mjs';

describe('TranscodePrewarmService', () => {
  let service;
  let mockContentIdResolver;
  let mockQueueService;
  let mockHttpClient;

  beforeEach(() => {
    mockContentIdResolver = {
      resolve: jest.fn().mockReturnValue({
        adapter: {
          resolvePlayables: jest.fn().mockResolvedValue([
            { contentId: 'plex:663135', source: 'plex', ratingKey: '663135', duration: 2167 }
          ]),
          loadMediaUrl: jest.fn().mockResolvedValue(
            '/api/v1/proxy/plex/video/:/transcode/universal/start.mpd?path=%2Flibrary%2Fmetadata%2F663135&X-Plex-Client-Identifier=api-abc123'
          )
        },
        source: 'plex',
        localId: '663135'
      })
    };
    mockQueueService = {
      resolveQueue: jest.fn().mockImplementation((items) => Promise.resolve(items))
    };
    mockHttpClient = {
      get: jest.fn().mockResolvedValue({ status: 200 })
    };

    service = new TranscodePrewarmService({
      contentIdResolver: mockContentIdResolver,
      queueService: mockQueueService,
      httpClient: mockHttpClient,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
    });
  });

  test('returns token and contentId for Plex queue', async () => {
    const result = await service.prewarm('slow-tv', { shuffle: true });

    expect(result).not.toBeNull();
    expect(result.token).toEqual(expect.any(String));
    expect(result.contentId).toBe('plex:663135');
  });

  test('redeems token for cached DASH URL', async () => {
    const result = await service.prewarm('slow-tv', {});
    const url = service.redeem(result.token);

    expect(url).toBe('/api/v1/proxy/plex/video/:/transcode/universal/start.mpd?path=%2Flibrary%2Fmetadata%2F663135&X-Plex-Client-Identifier=api-abc123');
  });

  test('redeem returns null for unknown token', () => {
    expect(service.redeem('bogus')).toBeNull();
  });

  test('fetches start.mpd to warm transcode', async () => {
    await service.prewarm('slow-tv', {});
    expect(mockHttpClient.get).toHaveBeenCalledWith(
      expect.stringContaining('start.mpd')
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/services/transcode-prewarm.test.mjs --no-cache`
Expected: FAIL — module not found

- [ ] **Step 3: Write TranscodePrewarmService implementation**

```javascript
// backend/src/3_applications/devices/services/TranscodePrewarmService.mjs

const TOKEN_TTL_MS = 60_000;

export class TranscodePrewarmService {
  #contentIdResolver;
  #queueService;
  #httpClient;
  #logger;
  #cache = new Map(); // token -> { url, contentId, expiresAt }

  constructor({ contentIdResolver, queueService, httpClient, logger = console }) {
    this.#contentIdResolver = contentIdResolver;
    this.#queueService = queueService;
    this.#httpClient = httpClient;
    this.#logger = logger;
  }

  /**
   * Pre-warm the Plex transcode for the first item in a queue.
   * @param {string} contentRef - Queue content reference (e.g., "slow-tv")
   * @param {Object} opts - { shuffle: boolean }
   * @returns {Promise<{ token: string, contentId: string } | null>}
   */
  async prewarm(contentRef, opts = {}) {
    try {
      // 1. Resolve the queue (same path as /api/v1/queue/:source)
      const resolved = this.#contentIdResolver.resolve(contentRef);
      if (!resolved?.adapter?.resolvePlayables) {
        this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'no adapter' });
        return null;
      }

      const finalId = `${resolved.source}:${resolved.localId}`;
      const playables = await resolved.adapter.resolvePlayables(finalId);
      const items = await this.#queueService.resolveQueue(
        playables, resolved.source, { shuffle: !!opts.shuffle }
      );

      if (!items?.length) {
        this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'empty queue' });
        return null;
      }

      // 2. Check if first item is Plex
      const first = items[0];
      const isPlex = first.source === 'plex' || first.contentId?.startsWith('plex:');
      if (!isPlex || !resolved.adapter.loadMediaUrl) {
        this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'not plex', source: first.source });
        return null;
      }

      // 3. Get the resume offset if partially watched
      const startOffset = first.resumePosition || first.playhead || 0;

      // 4. Create the transcode session
      const ratingKey = first.ratingKey || first.contentId?.replace(/^plex:/, '');
      const dashUrl = await resolved.adapter.loadMediaUrl(ratingKey, 0, { startOffset });
      if (!dashUrl) {
        this.#logger.warn?.('prewarm.failed', { contentRef, reason: 'loadMediaUrl returned null' });
        return null;
      }

      // 5. Fire MPD fetch to kick off transcoding (best-effort)
      this.#fetchMpd(dashUrl).catch(err => {
        this.#logger.debug?.('prewarm.mpd-fetch-failed', { error: err.message });
      });

      // 6. Cache and return token
      const token = this.#generateToken();
      const contentId = first.contentId || `plex:${ratingKey}`;
      this.#cache.set(token, { url: dashUrl, contentId, expiresAt: Date.now() + TOKEN_TTL_MS });
      this.#scheduleCleanup(token);

      this.#logger.info?.('prewarm.success', { contentRef, contentId, token });
      return { token, contentId };
    } catch (err) {
      this.#logger.warn?.('prewarm.error', { contentRef, error: err.message });
      return null;
    }
  }

  /**
   * Redeem a token for the cached DASH URL.
   * @param {string} token
   * @returns {string|null}
   */
  redeem(token) {
    const entry = this.#cache.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.#cache.delete(token);
      return null;
    }
    this.#cache.delete(token); // single-use
    return entry.url;
  }

  async #fetchMpd(dashUrl) {
    // dashUrl is a relative path like /api/v1/proxy/plex/video/...
    // The httpClient should be configured to hit the local Plex server
    await this.#httpClient.get(dashUrl);
  }

  #generateToken() {
    return Math.random().toString(36).substring(2, 10) +
           Math.random().toString(36).substring(2, 10);
  }

  #scheduleCleanup(token) {
    setTimeout(() => this.#cache.delete(token), TOKEN_TTL_MS + 1000);
  }
}

export default TranscodePrewarmService;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/services/transcode-prewarm.test.mjs --no-cache`
Expected: PASS (4 tests)

- [ ] **Step 5: Write tests for edge cases (non-Plex, failures)**

Add to the same test file:

```javascript
  test('returns null for non-Plex content', async () => {
    mockContentIdResolver.resolve.mockReturnValue({
      adapter: {
        resolvePlayables: jest.fn().mockResolvedValue([
          { contentId: 'filesystem:clips/cube', source: 'filesystem' }
        ])
        // no loadMediaUrl
      },
      source: 'filesystem',
      localId: 'clips/cube'
    });
    mockQueueService.resolveQueue.mockImplementation((items) => Promise.resolve(items));

    const result = await service.prewarm('clips/cube', {});
    expect(result).toBeNull();
  });

  test('returns null when adapter resolution fails', async () => {
    mockContentIdResolver.resolve.mockReturnValue(null);
    const result = await service.prewarm('nonexistent', {});
    expect(result).toBeNull();
  });

  test('returns null when loadMediaUrl fails', async () => {
    mockContentIdResolver.resolve.mockReturnValue({
      adapter: {
        resolvePlayables: jest.fn().mockResolvedValue([
          { contentId: 'plex:999', source: 'plex', ratingKey: '999' }
        ]),
        loadMediaUrl: jest.fn().mockResolvedValue(null)
      },
      source: 'plex',
      localId: '999'
    });
    mockQueueService.resolveQueue.mockImplementation((items) => Promise.resolve(items));

    const result = await service.prewarm('plex:999', {});
    expect(result).toBeNull();
  });

  test('token is single-use — second redeem returns null', async () => {
    const result = await service.prewarm('slow-tv', {});
    const url = service.redeem(result.token);
    expect(url).not.toBeNull();
    const url2 = service.redeem(result.token);
    expect(url2).toBeNull();
  });
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/services/transcode-prewarm.test.mjs --no-cache`
Expected: PASS (8 tests)

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/devices/services/TranscodePrewarmService.mjs tests/isolated/services/transcode-prewarm.test.mjs
git commit -m "feat: add TranscodePrewarmService for Plex pre-warming"
```

---

### Task 2: Prewarm Token Redemption Router

**Files:**
- Create: `backend/src/4_api/v1/routers/prewarm.mjs`
- Test: `tests/isolated/api/prewarm-router.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/api/prewarm-router.test.mjs
import { describe, test, expect, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createPrewarmRouter } from '../../../backend/src/4_api/v1/routers/prewarm.mjs';

describe('prewarm router', () => {
  const mockPrewarmService = {
    redeem: jest.fn()
  };

  const app = express();
  app.use('/api/v1/prewarm', createPrewarmRouter({
    prewarmService: mockPrewarmService
  }));

  test('GET /:token returns DASH URL for valid token', async () => {
    mockPrewarmService.redeem.mockReturnValue('/api/v1/proxy/plex/video/start.mpd?session=abc');

    const res = await request(app).get('/api/v1/prewarm/abc123');
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('/api/v1/proxy/plex/video/start.mpd?session=abc');
  });

  test('GET /:token returns 404 for unknown/expired token', async () => {
    mockPrewarmService.redeem.mockReturnValue(null);

    const res = await request(app).get('/api/v1/prewarm/bogus');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/api/prewarm-router.test.mjs --no-cache`
Expected: FAIL — module not found

- [ ] **Step 3: Write the router**

```javascript
// backend/src/4_api/v1/routers/prewarm.mjs
import { Router } from 'express';

/**
 * Prewarm token redemption router.
 * Frontend redeems a short token for the full pre-warmed DASH URL.
 *
 * GET /api/v1/prewarm/:token → { url: "..." } or 404
 */
export function createPrewarmRouter(config) {
  const { prewarmService } = config;
  if (!prewarmService) throw new Error('prewarmService is required');

  const router = Router();

  router.get('/:token', (req, res) => {
    const url = prewarmService.redeem(req.params.token);
    if (!url) {
      return res.status(404).json({ error: 'Token not found or expired' });
    }
    res.json({ url });
  });

  return router;
}

export default createPrewarmRouter;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/api/prewarm-router.test.mjs --no-cache`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/prewarm.mjs tests/isolated/api/prewarm-router.test.mjs
git commit -m "feat: add prewarm token redemption endpoint"
```

---

### Task 3: Wire Up Bootstrap + App Registration

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (~line 1645)
- Modify: `backend/src/app.mjs` (~lines 1436-1443)
- Modify: `backend/src/4_api/v1/routers/api.mjs` (~line 103)

- [ ] **Step 1: Add factory function to bootstrap.mjs**

After the `createWakeAndLoadService` function (~line 1645), add:

```javascript
/**
 * Create TranscodePrewarmService
 * @param {Object} config
 * @param {Object} config.contentIdResolver - ContentIdResolver for queue resolution
 * @param {Object} config.mediaProgressMemory - For QueueService watch-state enrichment
 * @param {string} config.appBaseUrl - Local app URL for MPD fetch (e.g., "http://localhost:3111")
 * @param {Object} [config.logger]
 * @returns {{ prewarmService: TranscodePrewarmService }}
 */
export function createTranscodePrewarmService(config) {
  const { contentIdResolver, mediaProgressMemory, appBaseUrl, logger = console } = config;

  // QueueService is instantiated inline (same pattern as queue router at line 773)
  const queueService = new QueueService({ mediaProgressMemory });

  // httpClient fetches the MPD through the app's own proxy endpoint
  // (dashUrl is a relative path like /api/v1/proxy/plex/video/...)
  const httpClient = {
    async get(url) {
      try {
        const fullUrl = `${appBaseUrl}${url}`;
        const resp = await fetch(fullUrl, { signal: AbortSignal.timeout(10_000) });
        return { status: resp.status };
      } catch (err) {
        logger.debug?.('prewarm.httpClient.error', { url, error: err.message });
        return { status: 0 };
      }
    }
  };

  const prewarmService = new TranscodePrewarmService({
    contentIdResolver, queueService, httpClient, logger
  });

  return { prewarmService };
}
```

Add the imports at the top of bootstrap.mjs:

```javascript
import { TranscodePrewarmService } from '#apps/devices/services/TranscodePrewarmService.mjs';
```

(`QueueService` is already imported at line 58.)

- [ ] **Step 2: Wire up in app.mjs — create prewarmService BEFORE wakeAndLoadService**

**Important:** `prewarmService` must be created before `wakeAndLoadService` because it gets injected into it. Insert BEFORE the `createWakeAndLoadService` call (~line 1430):

```javascript
  // Transcode pre-warming for device loads
  // Must be created before WakeAndLoadService since it's injected into it.
  const { prewarmService } = createTranscodePrewarmService({
    contentIdResolver: contentServices.contentIdResolver,
    mediaProgressMemory: contentServices.mediaProgressMemory,
    appBaseUrl: `http://localhost:${appPort}`,
    logger: rootLogger.child({ module: 'prewarm' })
  });
```

Note: `contentServices.mediaProgressMemory` — verify this is exposed. If not, the `mediaProgressMemory` variable from the content bootstrap scope (~line 430) is available in `app.mjs` scope. Use whichever is accessible.

Then modify the existing `createWakeAndLoadService` call to include `prewarmService`:

```javascript
  const { wakeAndLoadService } = createWakeAndLoadService({
    deviceService: deviceServices.deviceService,
    haGateway: homeAutomationAdapters.haGateway,
    devicesConfig: devicesConfig.devices || {},
    broadcast: broadcastEvent,
    prewarmService,  // NEW — injected into WakeAndLoadService
    logger: rootLogger.child({ module: 'wake-and-load' })
  });
```

- [ ] **Step 3: Update createWakeAndLoadService in bootstrap.mjs to accept and pass prewarmService**

In the `createWakeAndLoadService` factory (~line 1608), add `prewarmService` to destructuring and pass it through:

```javascript
export function createWakeAndLoadService(config) {
  const { deviceService, haGateway, devicesConfig, broadcast, prewarmService, logger = console } = config;
  // ... existing sensor map / policy code ...

  const wakeAndLoadService = new WakeAndLoadService({
    deviceService,
    readinessPolicy,
    broadcast,
    prewarmService,  // NEW
    logger
  });

  return { wakeAndLoadService };
}
```

- [ ] **Step 4: Wire up prewarm router**

After the device router creation (~line 1443), add:

```javascript
  // Prewarm token redemption
  const { createPrewarmRouter } = await import('./4_api/v1/routers/prewarm.mjs');
  v1Routers.prewarm = createPrewarmRouter({
    prewarmService,
    logger: rootLogger.child({ module: 'prewarm-api' })
  });
```

Note: `createDeviceApiRouter` does NOT need `prewarmService` — `WakeAndLoadService` already has it via constructor injection.

- [ ] **Step 3: Add prewarm to the API route map**

In `backend/src/4_api/v1/routers/api.mjs`, add to `routeMap` (~line 103):

```javascript
    '/prewarm': 'prewarm',
```

- [ ] **Step 4: Verify the app starts without errors**

Run: `node -e "import('./backend/src/app.mjs')" 2>&1 | head -5`
Or check existing dev server logs if running.

- [ ] **Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/app.mjs backend/src/4_api/v1/routers/api.mjs
git commit -m "feat: wire TranscodePrewarmService into bootstrap and routing"
```

---

### Task 4: Integrate Pre-warm into WakeAndLoadService

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`

Note: `prewarmService` is already injected via constructor from Task 3 (bootstrap wiring). No changes needed to device.mjs or bootstrap.mjs here.

- [ ] **Step 1: Add prewarmService to WakeAndLoadService constructor**

In `WakeAndLoadService.mjs`, add a new private field and update constructor:

```javascript
  #prewarmService;

  constructor(deps) {
    this.#deviceService = deps.deviceService;
    this.#readinessPolicy = deps.readinessPolicy;
    this.#broadcast = deps.broadcast;
    this.#prewarmService = deps.prewarmService || null;
    this.#logger = deps.logger || console;
  }
```

- [ ] **Step 2: Add pre-warm step between prepare and load**

In `#executeInner`, after the prepare step (after line 182) and before load (line 187), insert:

```javascript
    // --- Step 5: Pre-warm transcode (best-effort) ---
    let prewarmResult = null;
    if (this.#prewarmService && contentQuery.queue) {
      this.#emitProgress(topic, 'prewarm', 'running');
      this.#logger.info?.('wake-and-load.prewarm.start', { deviceId, queue: contentQuery.queue });

      try {
        prewarmResult = await this.#prewarmService.prewarm(contentQuery.queue, {
          shuffle: contentQuery.shuffle === '1' || contentQuery.shuffle === 'true'
        });
        if (prewarmResult) {
          contentQuery.prewarmToken = prewarmResult.token;
          contentQuery.prewarmContentId = prewarmResult.contentId;
          result.steps.prewarm = { ok: true, contentId: prewarmResult.contentId };
          this.#logger.info?.('wake-and-load.prewarm.done', {
            deviceId, contentId: prewarmResult.contentId, token: prewarmResult.token
          });
        } else {
          result.steps.prewarm = { skipped: true, reason: 'not applicable' };
          this.#logger.debug?.('wake-and-load.prewarm.skipped', { deviceId, reason: 'not applicable' });
        }
      } catch (err) {
        result.steps.prewarm = { ok: false, error: err.message };
        this.#logger.warn?.('wake-and-load.prewarm.failed', { deviceId, error: err.message });
      }
      this.#emitProgress(topic, 'prewarm', 'done');
    } else {
      result.steps.prewarm = { skipped: true, reason: contentQuery.queue ? 'no service' : 'no queue' };
    }

    // --- Step 6: Load Content ---
```

- [ ] **Step 3: Update STEPS constant**

```javascript
const STEPS = ['power', 'verify', 'volume', 'prepare', 'prewarm', 'load'];
```

- [ ] **Step 4: Verify with manual test**

If dev server is running, trigger a device load and check logs for `wake-and-load.prewarm.*` events:

```bash
curl -s "http://localhost:3112/api/v1/device/livingroom-tv/load?queue=slow-tv&shader=minimal&shuffle=1" | jq '.steps'
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs
git commit -m "feat: integrate pre-warm step into wake-and-load flow"
```

---

### Task 5: Frontend — Pass Pre-warm Params Through Autoplay

**Files:**
- Modify: `frontend/src/lib/parseAutoplayParams.js` (~line 12)

- [ ] **Step 1: Add prewarmToken and prewarmContentId to CONFIG_KEYS**

In `parseAutoplayParams.js`, add to the `CONFIG_KEYS` array (line 12):

```javascript
const CONFIG_KEYS = [
  'volume', 'shader', 'playbackRate', 'shuffle', 'continuous',
  'repeat', 'loop', 'overlay', 'advance', 'interval', 'mode', 'frame',
  'prewarmToken', 'prewarmContentId'   // NEW — transcode pre-warming
];
```

This ensures `prewarmToken` and `prewarmContentId` from the URL query string flow through as config properties into the `autoplay.queue` object, which gets emitted via `bus.emit('media:queue', ...)` in `ScreenRenderer.jsx` (line 82).

- [ ] **Step 2: Verify the params reach the Player**

No code change needed — `ScreenAutoplay` at line 82 already spreads config into the queue action:

```javascript
bus.emit('media:queue', { contentId: autoplay.queue.contentId, ...autoplay.queue });
```

So `prewarmToken` and `prewarmContentId` will be in the emitted payload, which reaches `useQueueController` via the `play` or `queue` prop.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/parseAutoplayParams.js
git commit -m "feat: pass prewarm params through autoplay URL parsing"
```

---

### Task 6: Frontend — Redeem Token and Inject Pre-warmed URL

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js` (~lines 87-114)

- [ ] **Step 1: Add token redemption to initQueue**

In `useQueueController.js`, inside the `initQueue` function, after the queue items are mapped from the API response (~line 109), add the pre-warm injection logic.

First, extract prewarmToken and prewarmContentId from the source object. Add after `itemOverrides` extraction (~line 99):

```javascript
      const prewarmToken = sourceObj.prewarmToken || null;
      const prewarmContentId = sourceObj.prewarmContentId || null;
```

Then, after the line where `newQueue` is built from the API response (~line 109), add:

```javascript
          // Inject pre-warmed DASH URL into first matching queue item
          if (prewarmToken && prewarmContentId && newQueue.length > 0) {
            const firstItem = newQueue[0];
            if (firstItem.contentId === prewarmContentId) {
              try {
                const resp = await DaylightAPI(`api/v1/prewarm/${prewarmToken}`);
                if (resp?.url) {
                  firstItem.mediaUrl = resp.url;
                  firstItem.format = 'dash_video';
                  firstItem.mediaType = 'dash_video';
                  playbackLog('prewarm-applied', {
                    contentId: prewarmContentId,
                    token: prewarmToken
                  }, { level: 'info' });
                }
              } catch (err) {
                playbackLog('prewarm-redeem-failed', {
                  contentId: prewarmContentId,
                  error: err?.message
                }, { level: 'warn' });
                // Fall through — normal /play API flow will handle it
              }
            } else {
              playbackLog('prewarm-mismatch', {
                expected: prewarmContentId,
                actual: firstItem.contentId
              }, { level: 'debug' });
            }
          }
```

Insert this block right after line 110 (`fetchedAudio = response.audio || null;`) and before the closing brace of the `else if (contentRef)` block.

- [ ] **Step 2: Verify SinglePlayer direct-play bypass handles it**

No code change needed. `SinglePlayer.jsx` line 230 checks:
```javascript
if (isSelfContainedFormat || ((directMediaUrl && directFormat && !getRenderer(directFormat)) && !isRecoveryRemount))
```

With `format: 'dash_video'` and `mediaUrl` set, and `getRenderer('dash_video')` returning undefined (dash_video is not a content format renderer), the bypass triggers correctly. The player skips the `/play` API call and uses the pre-warmed URL directly.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js
git commit -m "feat: redeem prewarm token and inject DASH URL into first queue item"
```

---

### Task 7: End-to-End Validation

**Files:** None (testing only)

- [ ] **Step 1: Run all unit tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/services/transcode-prewarm.test.mjs tests/isolated/api/prewarm-router.test.mjs --no-cache
```

Expected: All pass

- [ ] **Step 2: Test with dev server (if available)**

Start the dev server and trigger a device load:

```bash
curl -s "http://localhost:3112/api/v1/device/livingroom-tv/load?queue=slow-tv&shader=minimal&shuffle=1&volume=10" | jq '.'
```

Check backend logs for:
- `wake-and-load.prewarm.start`
- `prewarm.success` (with token and contentId)
- `wake-and-load.prewarm.done`

The FKB URL should now include `prewarmToken=...&prewarmContentId=plex:...`.

- [ ] **Step 3: Check prod logs after deployment**

After deploying, trigger slowtv and verify in logs:
- `prewarm-applied` in frontend logs (from useQueueController)
- No `resilience-transcode-warming` events
- No `player-remount` with `startup-deadline-exceeded`
- Single overlay wait key (no flickering)
- `playback.video-ready` within ~5s of page load

- [ ] **Step 4: Final commit with any fixups**

```bash
git add -A
git commit -m "fix: address any issues found during validation"
```

---

## Known Limitations (v1)

- **Shuffled queues:** Pre-warm resolves the queue with shuffle on the backend, but the frontend fetches the queue again independently with its own shuffle. The first item will likely differ, causing a `prewarm-mismatch` and falling back to normal flow. This is acceptable since the primary use case (slow-tv) uses shuffle but the 15s improvement still helps on non-shuffled loads. For a future iteration, consider passing the resolved queue order from the backend to avoid double-resolution.
- **Recovery remounts:** If the resilience system fires a remount even after pre-warming (e.g., real network stall), the remount skips the direct-play bypass (`isRecoveryRemount` check) and creates a fresh Plex session via `/play` API. This is correct — a remount means the pre-warmed session failed.
