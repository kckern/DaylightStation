# Shield TV Wake-and-Load Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the observability + verification gaps in the wake-and-load sequence so a failed Shield TV load no longer looks like success to the backend.

**Architecture:** Audit source: `docs/_wip/audits/2026-04-22-shield-wake-and-load-failure-audit.md`. Four fixes, each independently shippable: (1) Plex adapter structured errors, (2) Prewarm structured returns, (3) FKB adapter post-load URL verification, (4) Playback watchdog via `play.log` event-bus hook. No changes to the logging framework or event ordering semantics.

**Tech Stack:** Node.js ES modules (`.mjs`), Express, Jest via `tests/_infrastructure/harnesses/isolated.harness.mjs`, existing `EventBus` (`backend/src/0_system/eventbus/`), existing structured logger.

---

## File Structure

**Modified files:**

| File | Change |
|------|--------|
| `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` | Replace `console.error`/`console.warn` in `loadMediaUrl` with structured logger calls |
| `backend/src/3_applications/devices/services/TranscodePrewarmService.mjs` | Return `{ status, reason, token?, contentId? }` instead of null / bare token |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | Consume new prewarm shape; add playback watchdog after successful FKB load |
| `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` | Poll `getDeviceInfo().currentUrl` after `loadURL` until it matches expected |
| `backend/src/4_api/v1/routers/play.mjs` | Broadcast `playback.log` event via eventBus when `/play/log` POST arrives |

**New test files:**

| File | Purpose |
|------|---------|
| `tests/isolated/adapter/devices/FullyKioskContentAdapter.load.test.mjs` | Verify load() polls currentUrl and returns failure when URL doesn't render |
| `tests/isolated/application/devices/TranscodePrewarmService.test.mjs` | Verify prewarm returns structured skip vs failed status |
| `tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs` | Verify watchdog emits timeout event when no play.log arrives |
| `tests/isolated/api/routers/play-log-broadcast.test.mjs` | Verify play/log POST triggers event bus broadcast |

**Non-goals (deferred):**
- Automatic retry/recovery when the watchdog fires (scope creep; one-shot alarm is the MVP)
- ADB-based WebView renderer process monitoring (requires ADB everywhere; out of scope)
- Investigating the root cause of `isolated not needed` renderer deaths (separate effort)

---

## Task 1: Plex Adapter — structured error logging in `loadMediaUrl`

Replaces `console.error`/`console.warn` in `loadMediaUrl` with structured logger calls so upstream callers (TranscodePrewarmService) can see WHY a null was returned.

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:1631-1728`
- Test: `tests/isolated/adapter/content/PlexAdapter.test.mjs` (existing file, add a new describe block)

**Context:** The class already receives a `logger` in its constructor (check existing usage via `this.logger` or `this.#logger`). The audit finding: `catch (error) { console.error(...); return null; }` loses context — callers see `null` and cannot distinguish transient network failure from missing metadata. `console.error` goes nowhere useful in prod logs.

- [ ] **Step 1.1: Read the constructor to confirm the logger field name**

Run:
```bash
grep -nE "this\.logger|this\.#logger|logger\s*=|constructor" backend/src/1_adapters/content/media/plex/PlexAdapter.mjs | head -20
```

Note the exact field name (`this.logger` vs `this.#logger`). Use the same name below. If no logger is wired yet, add `logger = console` to the constructor deps (match the pattern in `TranscodePrewarmService.mjs:12`).

- [ ] **Step 1.2: Write the failing test**

Append to `tests/isolated/adapter/content/PlexAdapter.test.mjs`:

```javascript
describe('loadMediaUrl error logging', () => {
  test('logs structured warning when metadata is missing', async () => {
    const warn = jest.fn();
    const logger = { debug: jest.fn(), info: jest.fn(), warn, error: jest.fn() };
    const mockClient = {
      get: jest.fn(),
      post: jest.fn(),
      getMetadata: jest.fn().mockResolvedValue({ MediaContainer: {} }),
    };
    const adapter = new PlexAdapter(
      { host: 'http://localhost:32400', token: 't' },
      { httpClient: mockClient, logger }
    );
    // replace internal client so getMetadata returns empty
    adapter.client = mockClient;

    const result = await adapter.loadMediaUrl('999999');

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'plex.loadMediaUrl.metadataMissing',
      expect.objectContaining({ ratingKey: '999999' })
    );
  });

  test('logs structured warning on non-playable type', async () => {
    const warn = jest.fn();
    const logger = { debug: jest.fn(), info: jest.fn(), warn, error: jest.fn() };
    const mockClient = {
      get: jest.fn(), post: jest.fn(),
      getMetadata: jest.fn().mockResolvedValue({
        MediaContainer: { Metadata: [{ ratingKey: '1', type: 'show' }] }
      }),
    };
    const adapter = new PlexAdapter(
      { host: 'http://localhost:32400', token: 't' },
      { httpClient: mockClient, logger }
    );
    adapter.client = mockClient;

    const result = await adapter.loadMediaUrl('1');

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'plex.loadMediaUrl.nonPlayableType',
      expect.objectContaining({ type: 'show' })
    );
  });

  test('logs structured error when exception is thrown', async () => {
    const errorLog = jest.fn();
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: errorLog };
    const mockClient = {
      get: jest.fn(), post: jest.fn(),
      getMetadata: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const adapter = new PlexAdapter(
      { host: 'http://localhost:32400', token: 't' },
      { httpClient: mockClient, logger }
    );
    adapter.client = mockClient;

    const result = await adapter.loadMediaUrl('1');

    expect(result).toBeNull();
    expect(errorLog).toHaveBeenCalledWith(
      'plex.loadMediaUrl.exception',
      expect.objectContaining({ ratingKey: '1', error: 'boom' })
    );
  });
});
```

- [ ] **Step 1.3: Run the test to verify it fails**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only adapter --filter PlexAdapter
```

Expected: The three new tests fail because the logger calls don't match (they still use `console.error`/`console.warn`).

- [ ] **Step 1.4: Replace `console.error`/`console.warn` with structured logger calls**

In `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:1631-1728`, replace the four offending sites:

```javascript
// Line ~1641 — replace early return for missing metadata
if (!itemData) {
  this.logger?.warn?.('plex.loadMediaUrl.metadataMissing', { ratingKey });
  return null;
}

// Line ~1656 — replace console.warn for non-playable type
if (!['movie', 'episode', 'track', 'clip'].includes(type)) {
  this.logger?.warn?.('plex.loadMediaUrl.nonPlayableType', { ratingKey, type });
  return null;
}

// Line ~1678 — replace console.error for missing audio mediaKey
if (!mediaKey) {
  this.logger?.warn?.('plex.loadMediaUrl.audioMediaKeyMissing', { ratingKey });
  return null;
}

// Line ~1695 — replace console.warn for decision failure
if (!decisionResult.success) {
  this.logger?.warn?.('plex.loadMediaUrl.decisionFailed', {
    ratingKey,
    reason: decisionResult.error || 'unknown'
  });
  // ... existing fallback to transcode URL remains
}

// Line ~1726 — replace the catch
} catch (error) {
  this.logger?.error?.('plex.loadMediaUrl.exception', {
    ratingKey: typeof itemOrKey === 'string' || typeof itemOrKey === 'number'
      ? String(itemOrKey).replace(/^plex:/, '')
      : itemOrKey?.ratingKey,
    error: error.message,
    stack: error.stack
  });
  return null;
}
```

Note: `this.logger?.warn?.` uses optional chaining so older callers without a logger still work.

- [ ] **Step 1.5: Run the test to verify it passes**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only adapter --filter PlexAdapter
```

Expected: All PlexAdapter tests pass, including the three new ones.

- [ ] **Step 1.6: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/PlexAdapter.mjs tests/isolated/adapter/content/PlexAdapter.test.mjs
git commit -m "fix(plex): replace console.error in loadMediaUrl with structured logger"
```

---

## Task 2: TranscodePrewarmService — structured return type

Change prewarm to return `{ status, reason, token?, contentId? }` so callers can distinguish "not applicable" (skip) from "tried and failed" (error).

**Files:**
- Modify: `backend/src/3_applications/devices/services/TranscodePrewarmService.mjs`
- Test: `tests/isolated/application/devices/TranscodePrewarmService.test.mjs` (new file)

**Context:** Current returns: `null` (skip or error, indistinguishable) or `{ token, contentId }` (success). Audit finding: `prewarm.failed: loadMediaUrl returned null` was logged as a warning and caller treated it as "not applicable." Downstream, a real failure was invisible.

- [ ] **Step 2.1: Create the test directory and file**

Run:
```bash
mkdir -p tests/isolated/application/devices
```

Create `tests/isolated/application/devices/TranscodePrewarmService.test.mjs`:

```javascript
import { jest } from '@jest/globals';
import { TranscodePrewarmService } from '#apps/devices/services/TranscodePrewarmService.mjs';

function makeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('TranscodePrewarmService return shape', () => {
  test('returns { status: "skipped", reason: "no adapter" } when resolver has no adapter', async () => {
    const svc = new TranscodePrewarmService({
      contentIdResolver: { resolve: () => ({ adapter: null }) },
      queueService: { resolveQueue: jest.fn() },
      httpClient: { get: jest.fn() },
      logger: makeLogger()
    });
    const result = await svc.prewarm('plex:1');
    expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'no adapter' }));
  });

  test('returns { status: "skipped", reason: "empty queue" } when queue resolves to nothing', async () => {
    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'plex',
          localId: '1',
          adapter: { resolvePlayables: jest.fn().mockResolvedValue([]) }
        })
      },
      queueService: { resolveQueue: jest.fn().mockResolvedValue([]) },
      httpClient: { get: jest.fn() },
      logger: makeLogger()
    });
    const result = await svc.prewarm('plex:1');
    expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'empty queue' }));
  });

  test('returns { status: "skipped", reason: "not plex" } for non-Plex sources', async () => {
    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'poem',
          localId: 'remedy',
          adapter: { resolvePlayables: jest.fn(), loadMediaUrl: null }
        })
      },
      queueService: { resolveQueue: jest.fn().mockResolvedValue([{ source: 'poem', contentId: 'poem:remedy/01' }]) },
      httpClient: { get: jest.fn() },
      logger: makeLogger()
    });
    const result = await svc.prewarm('poem:remedy');
    expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'not plex' }));
  });

  test('returns { status: "failed", reason: "loadMediaUrl returned null" } when adapter returns null', async () => {
    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'plex',
          localId: '1',
          adapter: {
            resolvePlayables: jest.fn().mockResolvedValue([{ contentId: 'plex:1', source: 'plex' }]),
            loadMediaUrl: jest.fn().mockResolvedValue(null)
          }
        })
      },
      queueService: { resolveQueue: jest.fn().mockResolvedValue([{ source: 'plex', contentId: 'plex:1' }]) },
      httpClient: { get: jest.fn() },
      logger: makeLogger()
    });
    const result = await svc.prewarm('plex:1');
    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      reason: 'loadMediaUrl returned null'
    }));
  });

  test('returns { status: "ok", token, contentId } on success', async () => {
    const svc = new TranscodePrewarmService({
      contentIdResolver: {
        resolve: () => ({
          source: 'plex',
          localId: '1',
          adapter: {
            resolvePlayables: jest.fn().mockResolvedValue([{ contentId: 'plex:1', source: 'plex' }]),
            loadMediaUrl: jest.fn().mockResolvedValue('https://example/mpd')
          }
        })
      },
      queueService: { resolveQueue: jest.fn().mockResolvedValue([{ source: 'plex', contentId: 'plex:1' }]) },
      httpClient: { get: jest.fn().mockResolvedValue({}) },
      logger: makeLogger()
    });
    const result = await svc.prewarm('plex:1');
    expect(result.status).toBe('ok');
    expect(result.token).toEqual(expect.any(String));
    expect(result.contentId).toBe('plex:1');
  });

  test('returns { status: "failed", reason: "exception" } on thrown error', async () => {
    const svc = new TranscodePrewarmService({
      contentIdResolver: { resolve: () => { throw new Error('boom'); } },
      queueService: { resolveQueue: jest.fn() },
      httpClient: { get: jest.fn() },
      logger: makeLogger()
    });
    const result = await svc.prewarm('plex:1');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('exception');
    expect(result.error).toBe('boom');
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only application --filter TranscodePrewarm
```

Expected: Tests fail because current `prewarm()` returns plain `null` or `{ token, contentId }` without a `status` field.

- [ ] **Step 2.3: Update `TranscodePrewarmService.prewarm()` to return structured results**

Rewrite `prewarm()` in `backend/src/3_applications/devices/services/TranscodePrewarmService.mjs:19-68`:

```javascript
async prewarm(contentRef, opts = {}) {
  try {
    const resolved = this.#contentIdResolver.resolve(contentRef);
    if (!resolved?.adapter?.resolvePlayables) {
      this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'no adapter' });
      return { status: 'skipped', reason: 'no adapter' };
    }

    const finalId = `${resolved.source}:${resolved.localId}`;
    const playables = await resolved.adapter.resolvePlayables(finalId);
    const items = await this.#queueService.resolveQueue(
      playables, resolved.source, { shuffle: !!opts.shuffle }
    );

    if (!items?.length) {
      this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'empty queue' });
      return { status: 'skipped', reason: 'empty queue' };
    }

    const first = items[0];
    const isPlex = first.source === 'plex' || first.contentId?.startsWith('plex:');
    if (!isPlex || !resolved.adapter.loadMediaUrl) {
      this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'not plex', source: first.source });
      return { status: 'skipped', reason: 'not plex' };
    }

    const startOffset = first.resumePosition || first.playhead || 0;
    const ratingKey = first.ratingKey || first.contentId?.replace(/^plex:/, '');
    const dashUrl = await resolved.adapter.loadMediaUrl(ratingKey, 0, { startOffset });
    if (!dashUrl) {
      this.#logger.warn?.('prewarm.failed', { contentRef, reason: 'loadMediaUrl returned null' });
      return { status: 'failed', reason: 'loadMediaUrl returned null', contentRef };
    }

    this.#fetchMpd(dashUrl).catch(err => {
      this.#logger.debug?.('prewarm.mpd-fetch-failed', { error: err.message });
    });

    const token = this.#generateToken();
    const contentId = first.contentId || `plex:${ratingKey}`;
    this.#cache.set(token, { url: dashUrl, contentId, expiresAt: Date.now() + TOKEN_TTL_MS });
    this.#scheduleCleanup(token);

    this.#logger.info?.('prewarm.success', { contentRef, contentId, token });
    return { status: 'ok', token, contentId };
  } catch (err) {
    this.#logger.warn?.('prewarm.error', { contentRef, error: err.message });
    return { status: 'failed', reason: 'exception', error: err.message };
  }
}
```

- [ ] **Step 2.4: Run the test to verify it passes**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only application --filter TranscodePrewarm
```

Expected: All six tests pass.

- [ ] **Step 2.5: Update `WakeAndLoadService` to consume the new shape**

Edit `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:270-288`. Replace the existing prewarm handling block:

```javascript
try {
  prewarmResult = await this.#prewarmService.prewarm(contentQuery.queue, {
    shuffle: contentQuery.shuffle === '1' || contentQuery.shuffle === 'true'
  });
  if (prewarmResult?.status === 'ok') {
    contentQuery.prewarmToken = prewarmResult.token;
    contentQuery.prewarmContentId = prewarmResult.contentId;
    result.steps.prewarm = { ok: true, contentId: prewarmResult.contentId };
    this.#logger.info?.('wake-and-load.prewarm.done', {
      deviceId, dispatchId, contentId: prewarmResult.contentId, token: prewarmResult.token
    });
  } else if (prewarmResult?.status === 'failed') {
    result.steps.prewarm = { ok: false, reason: prewarmResult.reason, error: prewarmResult.error };
    this.#logger.warn?.('wake-and-load.prewarm.failed', {
      deviceId, dispatchId, reason: prewarmResult.reason, error: prewarmResult.error
    });
  } else {
    result.steps.prewarm = { skipped: true, reason: prewarmResult?.reason || 'unknown' };
    this.#logger.debug?.('wake-and-load.prewarm.skipped', {
      deviceId, dispatchId, reason: prewarmResult?.reason || 'unknown'
    });
  }
} catch (err) {
  result.steps.prewarm = { ok: false, error: err.message };
  this.#logger.warn?.('wake-and-load.prewarm.failed', { deviceId, dispatchId, error: err.message });
}
```

Note the new `warn`-level log event `wake-and-load.prewarm.failed` for real failures — previously this was logged at `debug` level and hidden in the "skipped" branch.

- [ ] **Step 2.6: Run the affected test suites**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only application
```

Expected: All application tests pass. If any existing tests depend on the old return shape, fix them.

- [ ] **Step 2.7: Commit**

```bash
git add backend/src/3_applications/devices/services/TranscodePrewarmService.mjs \
        backend/src/3_applications/devices/services/WakeAndLoadService.mjs \
        tests/isolated/application/devices/TranscodePrewarmService.test.mjs
git commit -m "fix(devices): distinguish prewarm skip from failure with structured return"
```

---

## Task 3: FullyKioskContentAdapter — post-`loadURL` verification poll

After `loadURL` returns HTTP 200, poll `getDeviceInfo()` until `currentUrl` matches the expected URL. If it never matches within a 10-second budget, return `ok: false`.

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs:248-320`
- Test: `tests/isolated/adapter/devices/FullyKioskContentAdapter.load.test.mjs` (new file)

**Context:** FKB's `loadURL` REST call acknowledges the command, not the outcome. During the incident, `loadURL` returned 200 but the WebView never navigated; `currentUrl` remained `/screen/office`. FKB DOES expose the real URL via `getDeviceInfo().currentUrl` — the adapter just never checks it post-load. The poll normalizes URLs (trailing slash, case) because FKB sometimes canonicalizes.

- [ ] **Step 3.1: Create test directory and failing test**

Run:
```bash
mkdir -p tests/isolated/adapter/devices
```

Create `tests/isolated/adapter/devices/FullyKioskContentAdapter.load.test.mjs`:

```javascript
import { jest } from '@jest/globals';
import { FullyKioskContentAdapter } from '#adapters/devices/FullyKioskContentAdapter.mjs';

function makeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

// Build a mock httpClient where each FKB `cmd=X` returns a scripted response.
function makeHttpClient(handler) {
  return {
    get: jest.fn(async (url) => {
      const match = url.match(/\bcmd=([^&]+)/);
      const cmd = match ? match[1] : null;
      return handler(cmd, url);
    })
  };
}

describe('FullyKioskContentAdapter.load verification', () => {
  test('returns ok:true when currentUrl matches expected after loadURL', async () => {
    const logger = makeLogger();
    let infoCalls = 0;
    const httpClient = makeHttpClient((cmd) => {
      if (cmd === 'loadURL') return { status: 200, data: { status: 'OK' } };
      if (cmd === 'deviceInfo' || cmd === 'getDeviceInfo') {
        infoCalls++;
        return {
          status: 200,
          data: {
            currentUrl: 'https://example.com/screen/living-room?queue=plex:1'
          }
        };
      }
      return { status: 200, data: {} };
    });
    const adapter = new FullyKioskContentAdapter(
      { host: '10.0.0.11', port: 2323, password: 'x', daylightHost: 'https://example.com' },
      { httpClient, logger }
    );

    const result = await adapter.load('/screen/living-room', { queue: 'plex:1' });

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(infoCalls).toBeGreaterThanOrEqual(1);
  });

  test('returns ok:false with urlMismatch when currentUrl never matches', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const httpClient = makeHttpClient((cmd) => {
      if (cmd === 'loadURL') return { status: 200, data: { status: 'OK' } };
      if (cmd === 'deviceInfo' || cmd === 'getDeviceInfo') {
        return {
          status: 200,
          data: { currentUrl: 'https://example.com/screen/office' } // wrong
        };
      }
      return { status: 200, data: {} };
    });
    const adapter = new FullyKioskContentAdapter(
      { host: '10.0.0.11', port: 2323, password: 'x', daylightHost: 'https://example.com' },
      { httpClient, logger }
    );

    const loadPromise = adapter.load('/screen/living-room', { queue: 'plex:1' });
    // Advance timers so the internal poll intervals fire immediately
    await jest.runAllTimersAsync();
    const result = await loadPromise;

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/URL did not appear|mismatch/i);
    jest.useRealTimers();
  });

  test('returns ok:true when currentUrl is undefined but loadURL succeeded (best-effort)', async () => {
    // FKB sometimes reports currentUrl=undefined even when WebView is rendering
    // correctly. We don't want to falsely fail in that case — the verification
    // step should degrade to "best effort" and log a warning.
    jest.useFakeTimers();
    const logger = makeLogger();
    const httpClient = makeHttpClient((cmd) => {
      if (cmd === 'loadURL') return { status: 200, data: { status: 'OK' } };
      if (cmd === 'deviceInfo' || cmd === 'getDeviceInfo') {
        return { status: 200, data: { currentUrl: undefined, currentPage: 'https://example.com/screen/living-room' } };
      }
      return { status: 200, data: {} };
    });
    const adapter = new FullyKioskContentAdapter(
      { host: '10.0.0.11', port: 2323, password: 'x', daylightHost: 'https://example.com' },
      { httpClient, logger }
    );

    const loadPromise = adapter.load('/screen/living-room', { queue: 'plex:1' });
    await jest.runAllTimersAsync();
    const result = await loadPromise;

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'fullykiosk.load.unverified',
      expect.any(Object)
    );
    jest.useRealTimers();
  });
});
```

- [ ] **Step 3.2: Run the test to verify it fails**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only adapter --filter FullyKiosk
```

Expected: Tests fail — `result.verified` field doesn't exist, the second test's URL mismatch still returns `ok: true`.

- [ ] **Step 3.3: Add `#verifyLoadedUrl` helper and hook it into `load()`**

In `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs`, inside the class and near the bottom of the private methods section (after `#isMicBlocked`, before the closing `}`):

```javascript
/**
 * Poll FKB deviceInfo.currentUrl until it matches the expected URL.
 * FKB's loadURL REST call is fire-and-forget — HTTP 200 means "received",
 * not "rendered". This closes the verification gap.
 *
 * Returns:
 *   { verified: true }                    — currentUrl matched within budget
 *   { verified: false, reason: '...' }    — timed out or never set
 *
 * @private
 * @param {string} expectedUrl - URL passed to loadURL
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=10000] - Total poll budget
 * @param {number} [opts.intervalMs=500]  - Delay between polls
 * @returns {Promise<{verified: boolean, currentUrl?: string, reason?: string}>}
 */
async #verifyLoadedUrl(expectedUrl, { timeoutMs = 10_000, intervalMs = 500 } = {}) {
  const normalize = (url) => {
    if (typeof url !== 'string') return null;
    return url.trim().replace(/\/$/, '').toLowerCase();
  };
  const target = normalize(expectedUrl);
  const deadline = Date.now() + timeoutMs;
  let lastSeen = null;

  while (Date.now() < deadline) {
    const info = await this.#sendCommand('getDeviceInfo');
    if (info.ok) {
      const current = info.data?.currentUrl;
      lastSeen = current;
      if (current && normalize(current) === target) {
        return { verified: true, currentUrl: current };
      }
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }

  return {
    verified: false,
    currentUrl: lastSeen,
    reason: lastSeen == null ? 'currentUrl never populated' : 'currentUrl did not match'
  };
}
```

Then modify the success branch of `load()` (around line 273-285). Replace:

```javascript
if (result.ok) {
  this.#logger.info?.('fullykiosk.load.success', {
    fullUrl, attempt, loadTimeMs: Date.now() - startTime
  });
  return { ok: true, url: fullUrl, attempt, loadTimeMs: Date.now() - startTime };
}
```

With:

```javascript
if (result.ok) {
  this.#logger.info?.('fullykiosk.load.acknowledged', {
    fullUrl, attempt, loadTimeMs: Date.now() - startTime
  });

  // Verify the WebView actually navigated. FKB acknowledges loadURL on receipt,
  // not on completion — poll currentUrl to confirm.
  const verification = await this.#verifyLoadedUrl(fullUrl);

  if (verification.verified) {
    this.#logger.info?.('fullykiosk.load.success', {
      fullUrl, attempt, loadTimeMs: Date.now() - startTime, verified: true
    });
    return {
      ok: true, url: fullUrl, attempt, verified: true,
      loadTimeMs: Date.now() - startTime
    };
  }

  // If FKB reports currentUrl as undefined but the command was accepted,
  // treat as unverified success (don't block playback on a known FKB quirk).
  if (verification.currentUrl == null) {
    this.#logger.warn?.('fullykiosk.load.unverified', {
      fullUrl, reason: verification.reason, loadTimeMs: Date.now() - startTime
    });
    return {
      ok: true, url: fullUrl, attempt, verified: false,
      loadTimeMs: Date.now() - startTime,
      warning: 'FKB did not report currentUrl'
    };
  }

  // Real mismatch — the WebView is showing something else.
  this.#logger.error?.('fullykiosk.load.urlMismatch', {
    fullUrl, actualUrl: verification.currentUrl, loadTimeMs: Date.now() - startTime
  });
  return {
    ok: false, url: fullUrl, attempt,
    error: `URL did not appear in WebView after load (got ${verification.currentUrl})`,
    actualUrl: verification.currentUrl,
    loadTimeMs: Date.now() - startTime
  };
}
```

- [ ] **Step 3.4: Run the test to verify it passes**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only adapter --filter FullyKiosk
```

Expected: All three new tests pass.

- [ ] **Step 3.5: Run the application layer tests to ensure WakeAndLoadService still works**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only application
```

Expected: No new failures. If `WakeAndLoadService` tests break because `load()` now returns `verified: true/false`, fix their assertions to match.

- [ ] **Step 3.6: Commit**

```bash
git add backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs \
        tests/isolated/adapter/devices/FullyKioskContentAdapter.load.test.mjs
git commit -m "fix(fkb): verify currentUrl after loadURL to catch silent WebView failures"
```

---

## Task 4: `/play/log` — broadcast playback event on event bus

When the frontend POSTs `/api/v1/play/log`, broadcast a `playback.log` event-bus message. This becomes the signal the watchdog (Task 5) subscribes to.

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs:46-165`
- Test: `tests/isolated/api/routers/play-log-broadcast.test.mjs` (new file)

**Context:** The frontend already POSTs `/play/log` every 10 seconds during playback. We don't add any new frontend code — we just broadcast existing activity onto the event bus so backend services can react. Using play.log as the watchdog signal is simpler than hooking into the log ingestion framework.

- [ ] **Step 4.1: Find how eventBus is wired into play.mjs**

Run:
```bash
grep -nE "eventBus|createPlayRouter|router.*play" backend/src/4_api/v1/routers/play.mjs backend/src/4_api/v1/index.mjs 2>&1 | head -20
```

Note whether `eventBus` is passed into `createPlayRouter(config)`. If not, you'll need to thread it through.

- [ ] **Step 4.2: Create the failing test**

Run:
```bash
mkdir -p tests/isolated/api/routers
```

Create `tests/isolated/api/routers/play-log-broadcast.test.mjs`:

```javascript
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from '#api/v1/routers/play.mjs';

function makeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('/play/log broadcasts playback.log event', () => {
  test('emits playback.log event on successful log POST', async () => {
    const publishedEvents = [];
    const mockEventBus = {
      publish: jest.fn((topic, payload) => { publishedEvents.push({ topic, payload }); })
    };
    const mockAdapter = {
      getStoragePath: jest.fn().mockResolvedValue('plex/library'),
      getItem: jest.fn().mockResolvedValue({ metadata: { title: 'Jupiter', duration: 3127000 } })
    };
    const mockRegistry = {
      get: jest.fn().mockReturnValue(mockAdapter),
      adapters: new Map()
    };
    const mockMediaProgress = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    };
    const app = express();
    app.use(express.json());
    app.use(createPlayRouter({
      registry: mockRegistry,
      mediaProgressMemory: mockMediaProgress,
      playResponseService: { toPlayResponse: () => ({}), getWatchState: () => null },
      contentIdResolver: { resolve: () => null },
      progressSyncSources: new Set(),
      eventBus: mockEventBus,
      logger: makeLogger()
    }));

    await request(app)
      .post('/log')
      .send({ type: 'plex', assetId: 'plex:251914', percent: 2, seconds: 63, title: 'Jupiter' })
      .expect(200);

    expect(mockEventBus.publish).toHaveBeenCalledWith(
      'playback.log',
      expect.objectContaining({
        contentId: 'plex:251914',
        type: 'plex',
        assetId: 'plex:251914',
        percent: 2,
        playhead: 63
      })
    );
  });

  test('does not emit event when eventBus is not provided', async () => {
    const mockAdapter = { getStoragePath: jest.fn().mockResolvedValue('plex') };
    const app = express();
    app.use(express.json());
    app.use(createPlayRouter({
      registry: { get: () => mockAdapter, adapters: new Map() },
      mediaProgressMemory: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
      playResponseService: { toPlayResponse: () => ({}), getWatchState: () => null },
      contentIdResolver: { resolve: () => null },
      progressSyncSources: new Set(),
      logger: makeLogger()
      // eventBus intentionally omitted
    }));

    // Must not throw
    await request(app)
      .post('/log')
      .send({ type: 'plex', assetId: 'plex:251914', percent: 2, seconds: 63 })
      .expect(200);
  });
});
```

Note: if `supertest` isn't already in devDependencies, check with `grep supertest package.json`. If missing, substitute with direct handler invocation as a plain function.

- [ ] **Step 4.3: Run the test to verify it fails**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only api --filter play-log-broadcast
```

Expected: Tests fail because `createPlayRouter` doesn't accept `eventBus` and doesn't publish anything.

- [ ] **Step 4.4: Add eventBus broadcast to `/log` handler**

Modify `backend/src/4_api/v1/routers/play.mjs`:

In `createPlayRouter(config)` at line 26, add `eventBus` to the destructured config:

```javascript
export function createPlayRouter(config) {
  const { registry, mediaProgressMemory, playResponseService, contentQueryService,
          contentIdResolver, progressSyncSources, progressSyncService,
          eventBus = null, logger = console } = config;
```

Then, after `logger.info?.('play.log.updated', ...)` call (around line 143-149) and BEFORE the `res.json(...)` response, add:

```javascript
// Broadcast playback.log so backend watchdogs (e.g. WakeAndLoadService)
// can observe that the device is actively playing.
if (eventBus?.publish) {
  try {
    eventBus.publish('playback.log', {
      contentId: compoundId,
      type,
      assetId,
      percent: normalizedPercent,
      playhead: normalizedSeconds,
      storagePath,
      timestamp: Date.now()
    });
  } catch (err) {
    logger.warn?.('play.log.broadcast_failed', { error: err.message });
  }
}
```

- [ ] **Step 4.5: Wire eventBus through to the router in bootstrap**

Find where `createPlayRouter` is called (likely `backend/src/4_api/v1/index.mjs` or a similar composition root):

```bash
grep -rn "createPlayRouter" backend/src/4_api backend/src/0_system
```

Add `eventBus` to the config object passed to `createPlayRouter`. The eventBus is already initialized in bootstrap (check `backend/src/0_system/bootstrap.mjs:1032`). Example:

```javascript
app.use('/api/v1/play', createPlayRouter({
  registry, mediaProgressMemory, playResponseService,
  contentQueryService, contentIdResolver,
  progressSyncSources, progressSyncService,
  eventBus,  // <-- add this line
  logger
}));
```

- [ ] **Step 4.6: Run the test to verify it passes**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only api --filter play-log-broadcast
```

Expected: Both tests pass.

- [ ] **Step 4.7: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs \
        backend/src/4_api/v1/index.mjs \
        tests/isolated/api/routers/play-log-broadcast.test.mjs
git commit -m "feat(play): broadcast playback.log event on /play/log POST"
```

---

## Task 5: WakeAndLoadService — playback watchdog

Subscribe to the `playback.log` event bus topic after a successful FKB load. If no `playback.log` for the loaded content arrives within 90 seconds, emit a `wake-and-load.playback.timeout` log + broadcast event. Returns immediately (non-blocking).

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`
- Test: `tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs` (new file)

**Context:** The watchdog does NOT block the load response — the caller (device router) gets `ok: true` immediately when the load step completes. The watchdog runs in the background and logs + broadcasts if playback never starts. This gives observability without changing the API contract.

- [ ] **Step 5.1: Create the failing test**

Create `tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs`:

```javascript
import { jest } from '@jest/globals';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

function makeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

// Minimal EventBus double implementing subscribe + publish
function makeEventBus() {
  const handlers = new Map();
  return {
    publish: (topic, payload) => {
      (handlers.get(topic) || []).forEach(h => h(payload));
    },
    subscribe: (topic, handler) => {
      if (!handlers.has(topic)) handlers.set(topic, []);
      handlers.get(topic).push(handler);
      return () => {
        const list = handlers.get(topic);
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
    getTopicSubscriberCount: () => 0,
    waitForMessage: () => Promise.reject(new Error('not used')),
  };
}

function makeDevice(overrides = {}) {
  return {
    id: 'living-room',
    screenPath: '/screen/living-room',
    defaultVolume: 10,
    hasCapability: () => false,
    powerOn: async () => ({ ok: true, verified: true, elapsedMs: 100 }),
    setVolume: async () => ({ ok: true }),
    prepareForContent: async () => ({ ok: true, coldRestart: false, cameraAvailable: true }),
    loadContent: async () => ({ ok: true, url: '/screen/living-room?queue=plex:1', verified: true }),
    ...overrides
  };
}

describe('WakeAndLoadService playback watchdog', () => {
  test('broadcasts timeout event when no playback.log arrives within 90s', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const broadcast = jest.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      logger
    });

    const result = await svc.execute('living-room', { queue: 'plex:1' });
    expect(result.ok).toBe(true);

    // Watchdog running — advance 90s
    await jest.advanceTimersByTimeAsync(90_000);
    await Promise.resolve(); // flush microtasks

    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'homeline:living-room',
        type: 'wake-progress',
        step: 'playback',
        status: 'timeout'
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.objectContaining({ deviceId: 'living-room' })
    );
    jest.useRealTimers();
  });

  test('cancels watchdog when playback.log arrives for the loaded content', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const broadcast = jest.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      logger
    });

    const result = await svc.execute('living-room', { queue: 'plex:1' });
    expect(result.ok).toBe(true);

    // Playback event arrives after 30s
    await jest.advanceTimersByTimeAsync(30_000);
    eventBus.publish('playback.log', { contentId: 'plex:1', playhead: 5 });

    await jest.advanceTimersByTimeAsync(70_000);
    await Promise.resolve();

    // timeout log should NOT have been emitted
    expect(logger.warn).not.toHaveBeenCalledWith(
      'wake-and-load.playback.timeout',
      expect.any(Object)
    );
    expect(logger.info).toHaveBeenCalledWith(
      'wake-and-load.playback.confirmed',
      expect.objectContaining({ deviceId: 'living-room', contentId: 'plex:1' })
    );
    jest.useRealTimers();
  });

  test('skips watchdog when queue param is missing', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const broadcast = jest.fn();
    const eventBus = makeEventBus();
    const device = makeDevice();
    const subscribeSpy = jest.spyOn(eventBus, 'subscribe');

    const svc = new WakeAndLoadService({
      deviceService: { get: () => device },
      readinessPolicy: { isReady: async () => ({ ready: true }) },
      broadcast,
      eventBus,
      logger
    });

    await svc.execute('living-room', {}); // no queue
    await jest.advanceTimersByTimeAsync(120_000);

    // With no content to track, don't arm the watchdog at all.
    expect(subscribeSpy).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
```

- [ ] **Step 5.2: Run the test to verify it fails**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only application --filter WakeAndLoadService.watchdog
```

Expected: Tests fail — watchdog code doesn't exist.

- [ ] **Step 5.3: Add `#armPlaybackWatchdog` method**

In `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`, near the bottom of the class (after `#emitProgress` at line 514), add:

```javascript
/**
 * After a successful load, subscribe to playback.log events for N seconds.
 * If none arrive for the loaded content, log + broadcast a timeout so the
 * phone UI (or an ops dashboard) can surface the silent failure.
 *
 * Non-blocking: the load() response has already been returned to the caller;
 * this runs asynchronously in the background.
 *
 * @private
 */
#armPlaybackWatchdog({ deviceId, dispatchId, topic, contentQuery, timeoutMs = 90_000 }) {
  if (!this.#eventBus || typeof this.#eventBus.subscribe !== 'function') return;

  // Extract a content identifier from the query. We use the same priority as
  // resolveContentId: explicit contentId wins, then queue/play/list.
  const expectedContentId =
    contentQuery.contentId || contentQuery.queue || contentQuery.play || contentQuery.list;
  if (!expectedContentId) return;

  let resolved = false;
  let timer = null;
  let unsubscribe = null;

  const cleanup = () => {
    resolved = true;
    if (timer) clearTimeout(timer);
    if (unsubscribe) unsubscribe();
  };

  unsubscribe = this.#eventBus.subscribe('playback.log', (payload) => {
    if (resolved) return;
    const incoming = payload?.contentId;
    if (!incoming) return;
    // Match if the incoming contentId equals, contains, or is contained by
    // the expected id (handles `plex:1` vs `plex:1:episode` normalization).
    const matches =
      incoming === expectedContentId ||
      incoming.includes(expectedContentId) ||
      expectedContentId.includes(incoming);
    if (matches) {
      cleanup();
      this.#logger.info?.('wake-and-load.playback.confirmed', {
        deviceId, dispatchId, contentId: incoming
      });
    }
  });

  timer = setTimeout(() => {
    if (resolved) return;
    cleanup();
    this.#logger.warn?.('wake-and-load.playback.timeout', {
      deviceId, dispatchId, expectedContentId, timeoutMs
    });
    this.#emitProgress(topic, dispatchId, 'playback', 'timeout', {
      expectedContentId, timeoutMs
    });
  }, timeoutMs);

  if (timer.unref) timer.unref();
}
```

- [ ] **Step 5.4: Arm the watchdog after the load step succeeds**

In `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`, at the end of `#executeInner`, RIGHT BEFORE the final `return result;` (around line 507), add:

```javascript
// Arm the playback watchdog — non-blocking. The response returns now;
// the watchdog fires asynchronously if playback never starts.
if (result.ok && !isAdopt && contentQuery.queue) {
  this.#armPlaybackWatchdog({
    deviceId, dispatchId, topic, contentQuery
  });
}
```

- [ ] **Step 5.5: Run the test to verify it passes**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only application --filter WakeAndLoadService.watchdog
```

Expected: All three watchdog tests pass.

- [ ] **Step 5.6: Run the full application test suite**

Run:
```bash
node tests/_infrastructure/harnesses/isolated.harness.mjs --only application
```

Expected: No regressions. Existing WakeAndLoadService tests continue to pass.

- [ ] **Step 5.7: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs \
        tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs
git commit -m "feat(devices): add playback watchdog to wake-and-load sequence"
```

---

## Task 6: Integration smoke test

Verify end-to-end behavior against the dev server using the `/api/v1/device/:id/load` endpoint. This catches wiring issues that unit tests miss (e.g., eventBus not passed through).

**Files:**
- None created — manual verification against running backend.

**Context:** The four prior tasks are each unit-level fixes. The integration test proves they compose correctly.

- [ ] **Step 6.1: Start the dev server**

Run:
```bash
node backend/index.js > /tmp/wake-and-load-verify.log 2>&1 &
sleep 5
lsof -i :3113 | head -5  # On kckern-server, backend port is 3113
```

Expected: Backend listening on the configured port. If not, check `/tmp/wake-and-load-verify.log` for errors.

- [ ] **Step 6.2: Fire a load request and observe logs**

Run (substitute the dev server URL for your environment):
```bash
# Trigger a known-good Plex load against a real device (or mock in dev)
curl -s "http://localhost:3113/api/v1/device/livingroom-tv/load?queue=plex:251914" | jq .ok
```

Then immediately tail the log for the watchdog lines:
```bash
grep -E "wake-and-load\.(prewarm|playback)|fullykiosk\.load\.(success|urlMismatch|unverified)|plex\.loadMediaUrl" /tmp/wake-and-load-verify.log | tail -20
```

Expected sequence when the Shield plays correctly:
```
wake-and-load.prewarm.done   (if Plex prewarm succeeded)
fullykiosk.load.acknowledged
fullykiosk.load.success      (verified: true)
wake-and-load.playback.confirmed   (within 90s — when frontend posts /play/log)
```

Expected sequence if the Shield doesn't play:
```
fullykiosk.load.success                   (or fullykiosk.load.urlMismatch if currentUrl polling catches it)
wake-and-load.playback.timeout            (after 90s, instead of .confirmed)
```

- [ ] **Step 6.3: Kill the dev server**

Run:
```bash
pkill -f 'node backend/index.js'
```

- [ ] **Step 6.4: Document the verification in the audit**

Append a "Verification" section to `docs/_wip/audits/2026-04-22-shield-wake-and-load-failure-audit.md`:

```markdown
---

## Verification (2026-04-22)

Implementation plan `docs/superpowers/plans/2026-04-22-shield-wake-and-load-reliability.md` landed in commits:
- `<task1-sha>` — Plex adapter structured logging
- `<task2-sha>` — Prewarm structured return shape
- `<task3-sha>` — FKB post-load URL verification
- `<task4-sha>` — /play/log event bus broadcast
- `<task5-sha>` — WakeAndLoadService playback watchdog

Observed sequence on a successful load: `prewarm.done` → `fullykiosk.load.success (verified)` → `playback.confirmed`. Silent failures now surface as either `fullykiosk.load.urlMismatch` (WebView showing wrong URL) or `wake-and-load.playback.timeout` (page loaded but never played) within 90 seconds.
```

Fill in the commit SHAs with `git log --oneline -n 6`.

- [ ] **Step 6.5: Commit the audit update**

```bash
git add docs/_wip/audits/2026-04-22-shield-wake-and-load-failure-audit.md
git commit -m "docs(audit): record wake-and-load reliability fixes verification"
```

---

## Self-Review Checklist

- **Spec coverage:** Four audit issues (prewarm error distinguishability, FKB load verification, playback watchdog, Plex error context) all map to tasks 1–5. Task 6 is the integration verification.
- **Placeholders:** None — every code block is complete and every command is literal.
- **Type consistency:** `prewarm` returns `{ status: 'ok'|'skipped'|'failed', reason, token?, contentId?, error? }` — all five consumers (tests + WakeAndLoadService) use these exact field names. FKB `load()` now returns `{ ok, verified, url, attempt, ... }` — tests and callers match. Watchdog uses `contentId` (not `content_id` or `contentID`) throughout.
- **Gaps:** The root cause of the WebView renderer dying after ~30s is NOT addressed — out of scope (see audit §"Gaps Not Covered"). The watchdog makes that failure observable; a future investigation can determine whether the cause is FKB config, app JS, or Android memory pressure.
