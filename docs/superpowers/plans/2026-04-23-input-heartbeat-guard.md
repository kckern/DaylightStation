# Input Heartbeat Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining hole in the office keypad guard by requiring the browser to prove its input system is functioning — not just that the backend keymap data exists — before the backend will dispatch content to a device.

**Architecture:** The frontend `ScreenRenderer` pings a lightweight HTTP heartbeat (`POST /api/v1/device/:deviceId/input/heartbeat`) every 30 seconds once its input adapter attaches with a non-empty keymap. A small in-memory store on the backend records the last heartbeat timestamp per device. The existing `checkInputPrecondition` in the device router extends its current "keymap non-empty" check to also require a heartbeat within the last 60 seconds when `input.required: true`. Missing heartbeat → `HTTP 503`, wake-and-load never runs.

**Tech Stack:** Node.js ESM backend (DDD layers: `#apps` for services, `#api` for routers), `node:test` + `node:assert` for backend tests, React for the frontend, no new runtime deps.

---

## Scope Check

Single subsystem (device input handshake). One plan is appropriate. The three layers (store + endpoint + frontend) all change together and should be shipped atomically.

## File Structure

**Created:**
- `backend/src/3_applications/devices/services/InputHeartbeatStore.mjs` — plain in-memory store mapping `deviceId → { ts, keyboardId, keymapSize, userAgent }`. Three methods: `record`, `get`, `isFresh`.
- `backend/tests/unit/applications/devices/InputHeartbeatStore.test.mjs` — 6 cases covering record/get/isFresh and the `requiredKeyboardId` mismatch guard.
- `backend/tests/unit/api/device.inputHeartbeat.test.mjs` — 5 cases for the new POST endpoint + extended precondition.

**Modified:**
- `backend/src/4_api/v1/routers/device.mjs` — add `POST /:deviceId/input/heartbeat`; extend `checkInputPrecondition` to require a fresh heartbeat.
- `backend/src/0_system/bootstrap.mjs` — construct the shared `InputHeartbeatStore`, thread it through `createDeviceApiRouter`.
- `backend/src/app.mjs` — pass the store through the bootstrap wiring where the device router is created.
- `frontend/src/screen-framework/ScreenRenderer.jsx` — after `manager.ready` and `adapter.isHealthy()`, start a heartbeat interval if `config.websocket?.guardrails?.device` is set.

**Not modified (intentionally):**
- `NumpadAdapter` / `RemoteAdapter` — adapters stay pure input handlers. Session-level heartbeating lives one layer up in ScreenRenderer.
- `WakeAndLoadService` — input precondition is a router concern (matches the existing pattern from today's keymap-empty fix).

---

## Pre-flight

- [ ] **Step 0a: Confirm branch and clean state**

Run: `git rev-parse --abbrev-ref HEAD && git status --short`
Expected: `main`. Working tree may have untracked docs but no staged changes. The last three commits should include `ef206269`, `4279578f`, `46e44ea1` (the input failsafe + guard landed earlier today).

- [ ] **Step 0b: Verify `node --test` works**

Run: `node --test backend/tests/unit/api/device.inputPrecondition.test.mjs 2>&1 | tail -3`
Expected: `pass 6` / `fail 0`. This confirms the existing input-precondition test still runs so we have a baseline.

- [ ] **Step 0c: Confirm current container is the one from commit `46e44ea1` or newer**

Run: `sudo docker exec daylight-station sh -c 'cat /build.txt'`
Expected: `Commit: 4279578f` or similar. If older, the pre-existing keymap guard isn't deployed — note in the final deploy step that this rebuild picks up today's prior fixes too.

---

## Task 1: `InputHeartbeatStore` domain utility

**Files:**
- Create: `backend/src/3_applications/devices/services/InputHeartbeatStore.mjs`
- Create: `backend/tests/unit/applications/devices/InputHeartbeatStore.test.mjs`

- [ ] **Step 1.1: Write the failing test**

Create `backend/tests/unit/applications/devices/InputHeartbeatStore.test.mjs`:

```javascript
// backend/tests/unit/applications/devices/InputHeartbeatStore.test.mjs
//
// Unit tests for InputHeartbeatStore — an in-memory record of the last
// time a screen reported its input adapter healthy. Used by the device
// router to refuse loads when no browser is currently acting as the
// device with functioning input.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { InputHeartbeatStore } from '../../../../src/3_applications/devices/services/InputHeartbeatStore.mjs';

describe('InputHeartbeatStore', () => {
  let store;
  let now;
  beforeEach(() => {
    now = 1_700_000_000_000;
    store = new InputHeartbeatStore({ clock: () => now });
  });

  it('record() stores the heartbeat fields and timestamp from the clock', () => {
    store.record('office-tv', { keyboardId: 'officekeypad', keymapSize: 8, userAgent: 'ua' });
    const hb = store.get('office-tv');
    assert.strictEqual(hb.keyboardId, 'officekeypad');
    assert.strictEqual(hb.keymapSize, 8);
    assert.strictEqual(hb.userAgent, 'ua');
    assert.strictEqual(hb.ts, now);
  });

  it('get() returns undefined when nothing has been recorded', () => {
    assert.strictEqual(store.get('office-tv'), undefined);
  });

  it('isFresh() returns false when no heartbeat exists', () => {
    assert.strictEqual(store.isFresh('office-tv', { maxAgeMs: 60_000 }), false);
  });

  it('isFresh() returns true when heartbeat is within the window', () => {
    store.record('office-tv', { keyboardId: 'officekeypad', keymapSize: 8 });
    now += 30_000;
    assert.strictEqual(store.isFresh('office-tv', { maxAgeMs: 60_000 }), true);
  });

  it('isFresh() returns false when heartbeat is older than the window', () => {
    store.record('office-tv', { keyboardId: 'officekeypad', keymapSize: 8 });
    now += 90_000;
    assert.strictEqual(store.isFresh('office-tv', { maxAgeMs: 60_000 }), false);
  });

  it('isFresh() rejects when requiredKeyboardId does not match recorded keyboardId', () => {
    store.record('office-tv', { keyboardId: 'tv-remote', keymapSize: 8 });
    now += 30_000;
    assert.strictEqual(
      store.isFresh('office-tv', { maxAgeMs: 60_000, requiredKeyboardId: 'officekeypad' }),
      false
    );
  });
});
```

- [ ] **Step 1.2: Run test — expect failure**

Run: `node --test backend/tests/unit/applications/devices/InputHeartbeatStore.test.mjs 2>&1 | tail -20`
Expected: all 6 tests fail with `Cannot find module '.../InputHeartbeatStore.mjs'`.

- [ ] **Step 1.3: Implement `InputHeartbeatStore`**

Create `backend/src/3_applications/devices/services/InputHeartbeatStore.mjs`:

```javascript
// backend/src/3_applications/devices/services/InputHeartbeatStore.mjs

/**
 * InputHeartbeatStore — in-memory record of the last time each device's
 * screen reported a functioning input adapter. Used by the device router
 * to decide whether it is safe to dispatch content.
 *
 * Reset on container restart — screens must re-heartbeat within their
 * interval before loads can succeed. The frontend heartbeat is
 * automatic (ScreenRenderer starts it as soon as the adapter attaches),
 * so a restart causes at most one heartbeat-interval of rejected loads.
 *
 * @module applications/devices/services
 */

export class InputHeartbeatStore {
  #entries;
  #clock;

  /**
   * @param {Object} [deps]
   * @param {() => number} [deps.clock] - Returns ms since epoch. Defaults to Date.now.
   */
  constructor(deps = {}) {
    this.#entries = new Map();
    this.#clock = deps.clock || (() => Date.now());
  }

  /**
   * Record a heartbeat for a device.
   *
   * @param {string} deviceId
   * @param {Object} data
   * @param {string} data.keyboardId
   * @param {number} data.keymapSize
   * @param {string} [data.userAgent]
   */
  record(deviceId, { keyboardId, keymapSize, userAgent } = {}) {
    this.#entries.set(deviceId, {
      ts: this.#clock(),
      keyboardId: keyboardId || null,
      keymapSize: Number.isFinite(keymapSize) ? keymapSize : 0,
      userAgent: userAgent || null,
    });
  }

  /**
   * Return the last recorded heartbeat for a device, or undefined.
   *
   * @param {string} deviceId
   * @returns {{ts: number, keyboardId: string|null, keymapSize: number, userAgent: string|null}|undefined}
   */
  get(deviceId) {
    return this.#entries.get(deviceId);
  }

  /**
   * Is there a heartbeat within the window, optionally matching a keyboardId?
   *
   * @param {string} deviceId
   * @param {Object} opts
   * @param {number} opts.maxAgeMs
   * @param {string} [opts.requiredKeyboardId] - If set, also require matching keyboardId.
   * @returns {boolean}
   */
  isFresh(deviceId, { maxAgeMs, requiredKeyboardId } = {}) {
    const hb = this.#entries.get(deviceId);
    if (!hb) return false;
    if ((this.#clock() - hb.ts) > maxAgeMs) return false;
    if (requiredKeyboardId && hb.keyboardId !== requiredKeyboardId) return false;
    return true;
  }
}

export default InputHeartbeatStore;
```

- [ ] **Step 1.4: Re-run test — expect pass**

Run: `node --test backend/tests/unit/applications/devices/InputHeartbeatStore.test.mjs 2>&1 | tail -5`
Expected: `pass 6` / `fail 0`.

- [ ] **Step 1.5: Commit**

```bash
git add backend/src/3_applications/devices/services/InputHeartbeatStore.mjs \
        backend/tests/unit/applications/devices/InputHeartbeatStore.test.mjs
git commit -m "$(cat <<'EOF'
feat(devices): add InputHeartbeatStore for per-device input-health tracking

Small in-memory map recording the last time a screen reported its input
adapter healthy (keymap loaded, handler attached). The device router will
use it to refuse loads when no browser is currently acting as the device
with working input.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Heartbeat POST endpoint + extended precondition

**Files:**
- Create: `backend/tests/unit/api/device.inputHeartbeat.test.mjs`
- Modify: `backend/src/4_api/v1/routers/device.mjs`

The router currently accepts an injected `configService` + `loadFile`. We add a new injected dep `inputHeartbeatStore` and two changes:
1. `POST /:deviceId/input/heartbeat` records into the store.
2. `checkInputPrecondition` gains a heartbeat-freshness check.

Constants we'll use:
- `HEARTBEAT_MAX_AGE_MS = 60_000` (60s — tolerates one missed beat when the frontend pings every 30s).

- [ ] **Step 2.1: Write the failing test**

Create `backend/tests/unit/api/device.inputHeartbeat.test.mjs`:

```javascript
// backend/tests/unit/api/device.inputHeartbeat.test.mjs
//
// Tests for POST /device/:id/input/heartbeat and the
// heartbeat-freshness extension of the load pre-flight guard.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'node:http';
import { createDeviceRouter } from '../../../src/4_api/v1/routers/device.mjs';
import { InputHeartbeatStore } from '../../../src/3_applications/devices/services/InputHeartbeatStore.mjs';

function makeApp({
  deviceConfig,
  keyboardEntries = [],
  heartbeatStore = new InputHeartbeatStore(),
  wakeAndLoad = async () => ({ ok: true }),
}) {
  const app = express();
  app.use(express.json());
  const router = createDeviceRouter({
    deviceService: { listDevices: () => [], get: () => ({ id: 'office-tv' }) },
    wakeAndLoadService: { execute: wakeAndLoad },
    configService: { getDeviceConfig: () => deviceConfig },
    loadFile: () => keyboardEntries,
    inputHeartbeatStore: heartbeatStore,
    logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
  });
  app.use('/', router);
  return app;
}

function request(app, { method, path, body }) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const data = body ? JSON.stringify(body) : null;
      const req = http.request({
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      }, (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
        });
      });
      if (data) req.write(data);
      req.end();
    });
  });
}

describe('device router — input heartbeat', () => {
  it('POST /:id/input/heartbeat records into the store and returns 204', async () => {
    const store = new InputHeartbeatStore();
    const app = makeApp({ deviceConfig: null, heartbeatStore: store });
    const res = await request(app, {
      method: 'POST',
      path: '/office-tv/input/heartbeat',
      body: { keyboardId: 'officekeypad', keymapSize: 8 },
    });
    assert.strictEqual(res.status, 204);
    const hb = store.get('office-tv');
    assert.strictEqual(hb.keyboardId, 'officekeypad');
    assert.strictEqual(hb.keymapSize, 8);
    assert.ok(hb.ts > 0);
  });

  it('POST /:id/input/heartbeat rejects with 400 when body is missing keyboardId', async () => {
    const store = new InputHeartbeatStore();
    const app = makeApp({ deviceConfig: null, heartbeatStore: store });
    const res = await request(app, {
      method: 'POST',
      path: '/office-tv/input/heartbeat',
      body: { keymapSize: 8 },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(store.get('office-tv'), undefined);
  });

  it('GET /:id/load refuses when heartbeat missing (keymap non-empty, input.required)', async () => {
    let executed = false;
    const store = new InputHeartbeatStore();
    const app = makeApp({
      deviceConfig: { input: { keyboard_id: 'officekeypad', required: true } },
      keyboardEntries: [{ folder: 'officekeypad', key: '1', label: 'play', function: 'playback' }],
      heartbeatStore: store,
      wakeAndLoad: async () => { executed = true; return { ok: true }; },
    });
    const res = await request(app, { method: 'GET', path: '/office-tv/load' });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.failedStep, 'input');
    assert.match(res.body.error, /no recent input heartbeat/i);
    assert.strictEqual(executed, false);
  });

  it('GET /:id/load proceeds when a fresh heartbeat exists', async () => {
    let executed = false;
    const store = new InputHeartbeatStore();
    store.record('office-tv', { keyboardId: 'officekeypad', keymapSize: 8 });
    const app = makeApp({
      deviceConfig: { input: { keyboard_id: 'officekeypad', required: true } },
      keyboardEntries: [{ folder: 'officekeypad', key: '1', label: 'play', function: 'playback' }],
      heartbeatStore: store,
      wakeAndLoad: async () => { executed = true; return { ok: true }; },
    });
    const res = await request(app, { method: 'GET', path: '/office-tv/load' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(executed, true);
  });

  it('GET /:id/load refuses when heartbeat references a different keyboard', async () => {
    let executed = false;
    const store = new InputHeartbeatStore();
    store.record('office-tv', { keyboardId: 'tv-remote', keymapSize: 6 });
    const app = makeApp({
      deviceConfig: { input: { keyboard_id: 'officekeypad', required: true } },
      keyboardEntries: [{ folder: 'officekeypad', key: '1', label: 'play', function: 'playback' }],
      heartbeatStore: store,
      wakeAndLoad: async () => { executed = true; return { ok: true }; },
    });
    const res = await request(app, { method: 'GET', path: '/office-tv/load' });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.failedStep, 'input');
    assert.strictEqual(executed, false);
  });
});
```

- [ ] **Step 2.2: Run test — expect failures**

Run: `node --test backend/tests/unit/api/device.inputHeartbeat.test.mjs 2>&1 | tail -25`
Expected: all 5 tests fail. Two different failure modes:
- The POST endpoint tests fail because the route does not exist (404).
- The GET tests fail because the precondition doesn't look at the heartbeat yet (it passes when keymap is non-empty, so 200 is returned everywhere).

- [ ] **Step 2.3: Edit `device.mjs` — add the dep, the POST route, and extend the precondition**

Open `backend/src/4_api/v1/routers/device.mjs`. Three edits, in order:

**Edit A — destructure `inputHeartbeatStore` from config.** Find the block starting `export function createDeviceRouter(config) {` and its existing destructuring (`const { deviceService, wakeAndLoadService, ... } = config;`). Add the new dep — replace the existing destructuring with:

```javascript
  const router = express.Router();
  const {
    deviceService,
    wakeAndLoadService,
    sessionControlService,
    dispatchIdempotencyService = new DispatchIdempotencyService({
      logger: config?.logger || undefined,
    }),
    configService,
    loadFile,
    inputHeartbeatStore,
    logger = console,
  } = config;

  const HEARTBEAT_MAX_AGE_MS = 60_000;
```

**Edit B — extend `checkInputPrecondition`.** Find the existing `function checkInputPrecondition(deviceId)`. Replace the whole function with:

```javascript
  function checkInputPrecondition(deviceId) {
    if (!configService?.getDeviceConfig) return { ok: true };
    const deviceConfig = configService.getDeviceConfig(deviceId);
    const inputCfg = deviceConfig?.input;
    if (!inputCfg?.required || !inputCfg?.keyboard_id) return { ok: true };

    if (typeof loadFile !== 'function') {
      return {
        ok: false,
        error: 'input precondition cannot be verified (loadFile not wired)',
        keyboardId: inputCfg.keyboard_id,
      };
    }

    const keyboardData = loadFile('config/keyboard') || [];
    const normalize = (s) => s?.replace(/\s+/g, '').toLowerCase();
    const target = normalize(inputCfg.keyboard_id);
    const entries = keyboardData.filter(k => normalize(k.folder) === target && k.key && k.function);
    if (entries.length === 0) {
      return {
        ok: false,
        error: `input device '${inputCfg.keyboard_id}' has no keymap entries`,
        keyboardId: inputCfg.keyboard_id,
      };
    }

    if (!inputHeartbeatStore) {
      // No store wired — fall back to keymap-only behavior. Logged warn so
      // misconfigured deployments surface rather than silently accepting.
      logger.warn?.('device.router.load.heartbeat-store-missing', { deviceId });
      return { ok: true, keymapSize: entries.length };
    }

    const fresh = inputHeartbeatStore.isFresh(deviceId, {
      maxAgeMs: HEARTBEAT_MAX_AGE_MS,
      requiredKeyboardId: inputCfg.keyboard_id,
    });
    if (!fresh) {
      return {
        ok: false,
        error: `no recent input heartbeat from a screen acting as '${deviceId}' with keyboard '${inputCfg.keyboard_id}'`,
        keyboardId: inputCfg.keyboard_id,
      };
    }
    return { ok: true, keymapSize: entries.length };
  }
```

**Edit C — add the heartbeat POST route.** Insert the following block immediately after `createDeviceRouter`'s `checkInputPrecondition` function closes (before any `router.get(...)` definitions — find the `router.get('/config', ...)` block and insert above it):

```javascript
  /**
   * POST /:deviceId/input/heartbeat
   *
   * Frontend ScreenRenderer calls this every ~30s after its input adapter
   * attaches with a non-empty keymap. Used by checkInputPrecondition to
   * refuse loads when no browser is currently acting as the device with
   * working input.
   */
  router.post('/:deviceId/input/heartbeat', express.json(), (req, res) => {
    const { deviceId } = req.params;
    const { keyboardId, keymapSize } = req.body || {};
    if (!isNonEmptyString(keyboardId)) {
      return res.status(400).json({ ok: false, error: 'keyboardId is required' });
    }
    if (!inputHeartbeatStore) {
      logger.warn?.('device.router.heartbeat.no-store', { deviceId });
      return res.status(503).json({ ok: false, error: 'heartbeat store not configured' });
    }
    inputHeartbeatStore.record(deviceId, {
      keyboardId,
      keymapSize: Number.isFinite(keymapSize) ? keymapSize : 0,
      userAgent: req.headers['user-agent'] || null,
    });
    logger.debug?.('device.router.heartbeat.recorded', { deviceId, keyboardId, keymapSize });
    res.status(204).end();
  });
```

- [ ] **Step 2.4: Re-run test — expect pass**

Run: `node --test backend/tests/unit/api/device.inputHeartbeat.test.mjs 2>&1 | tail -5`
Expected: `pass 5` / `fail 0`.

- [ ] **Step 2.5: Run the existing precondition tests to ensure they still pass**

Run: `node --test backend/tests/unit/api/device.inputPrecondition.test.mjs 2>&1 | tail -5`
Expected: `pass 6` / `fail 0`.

Rationale: the existing suite does not inject `inputHeartbeatStore`, and the new precondition code falls back to keymap-only behavior when the store is missing (with a warn log). Those tests therefore keep passing unchanged.

- [ ] **Step 2.6: Commit**

```bash
git add backend/src/4_api/v1/routers/device.mjs \
        backend/tests/unit/api/device.inputHeartbeat.test.mjs
git commit -m "$(cat <<'EOF'
feat(device): input heartbeat endpoint + extended load precondition

Adds POST /device/:id/input/heartbeat so the frontend can report a
functioning input adapter. The load pre-flight now also requires a
fresh (<60s old) heartbeat with matching keyboardId when the device
declares input.required: true — catching the case where the backend
keymap data is fine but the browser failed to apply it.

When inputHeartbeatStore isn't injected, the precondition falls back to
keymap-only behavior so legacy wiring is unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire the store through `bootstrap.mjs` and `app.mjs`

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`
- Modify: `backend/src/app.mjs`

The existing `createDeviceApiRouter` in `bootstrap.mjs` currently threads `deviceServices`, `wakeAndLoadService`, `dispatchIdempotencyService`, `configService`, `loadFile`, `logger`. We add `inputHeartbeatStore`. `app.mjs` is where the store is constructed (singleton for the app lifetime).

- [ ] **Step 3.1: Edit `bootstrap.mjs` — thread the dep**

Open `backend/src/0_system/bootstrap.mjs`. Find `export function createDeviceApiRouter(config)`. Replace its body with:

```javascript
export function createDeviceApiRouter(config) {
  const {
    deviceServices,
    wakeAndLoadService,
    sessionControlService,
    dispatchIdempotencyService,
    configService,
    loadFile,
    inputHeartbeatStore,
    logger = console
  } = config;

  return createDeviceRouter({
    deviceService: deviceServices.deviceService,
    wakeAndLoadService,
    sessionControlService,
    dispatchIdempotencyService,
    configService,
    loadFile,
    inputHeartbeatStore,
    logger
  });
}
```

- [ ] **Step 3.2: Edit `app.mjs` — construct and inject the store**

Open `backend/src/app.mjs`. Find the block that calls `createDeviceApiRouter(...)`:

```javascript
  v1Routers.device = createDeviceApiRouter({
    deviceServices,
    wakeAndLoadService,
    dispatchIdempotencyService,
    configService,
    loadFile,
    logger: rootLogger.child({ module: 'device-api' })
  });
```

Replace that block with the import + construction + updated call:

```javascript
  const { InputHeartbeatStore } = await import('#apps/devices/services/InputHeartbeatStore.mjs');
  const inputHeartbeatStore = new InputHeartbeatStore();

  v1Routers.device = createDeviceApiRouter({
    deviceServices,
    wakeAndLoadService,
    dispatchIdempotencyService,
    configService,
    loadFile,
    inputHeartbeatStore,
    logger: rootLogger.child({ module: 'device-api' })
  });
```

The `#apps/...` path alias is the standard ESM alias used throughout this file — grep in `app.mjs` for other `await import('#apps/...')` calls to confirm.

- [ ] **Step 3.3: Syntax + import smoke**

Run: `node --check backend/src/app.mjs && node --check backend/src/0_system/bootstrap.mjs`
Expected: (no output, zero exit code).

Run: `node -e "import('./backend/src/4_api/v1/routers/device.mjs').then(m=>console.log('ok:', Object.keys(m))).catch(e=>console.error('FAIL:', e.message))"`
Expected: `ok: [ 'createDeviceRouter', 'default' ]`

- [ ] **Step 3.4: Re-run both API test files to confirm nothing broke**

Run: `node --test backend/tests/unit/api/device.inputHeartbeat.test.mjs backend/tests/unit/api/device.inputPrecondition.test.mjs 2>&1 | tail -5`
Expected: `pass 11` / `fail 0` (5 heartbeat + 6 precondition).

- [ ] **Step 3.5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "$(cat <<'EOF'
wire(device-api): construct InputHeartbeatStore and inject into device router

Singleton per app process. Container restart resets the store — screens
must re-heartbeat before loads can succeed, which is the intended
fail-closed behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend — `ScreenRenderer` emits heartbeat while adapter healthy

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx`

Frontend tests in this repo live in vitest-style files that are not actually executed by the jest harness (see the `suite/` dead-tests memory). We skip a unit test here and rely on a live curl verification in Task 5.

The existing `useEffect` that initializes the input system already awaits `manager.ready` and sets `inputHealthyRef.current` from `adapter.isHealthy()`. We extend the same effect to also start a heartbeat interval when the adapter is healthy and the screen config declares a guardrail device.

- [ ] **Step 4.1: Edit `ScreenRenderer.jsx`**

Open `frontend/src/screen-framework/ScreenRenderer.jsx`. Locate the input-initialization effect (it begins with `// Initialize input system` and contains `const manager = createInputManager(getActionBus(), config.input);`). Replace the entire effect block with:

```javascript
  // Initialize input system
  useEffect(() => {
    if (!config?.input) return;
    const manager = createInputManager(getActionBus(), config.input);

    // Tracks whether we've already started the heartbeat so the cleanup
    // path knows whether there's an interval to clear.
    let cancelled = false;
    let heartbeatIntervalId = null;

    const guardrailDeviceId = config.websocket?.guardrails?.device || null;
    const HEARTBEAT_INTERVAL_MS = 30_000;

    async function postHeartbeat(adapter) {
      if (!guardrailDeviceId) return;
      const keyboardId = config.input?.keyboard_id || null;
      const keymapSize = adapter?.keymap ? Object.keys(adapter.keymap).length : 0;
      try {
        await fetch(`/api/v1/device/${encodeURIComponent(guardrailDeviceId)}/input/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyboardId, keymapSize }),
        });
      } catch {
        // Swallow — a failed heartbeat just means the next load will be
        // refused, which is the correct fail-closed behavior.
      }
    }

    manager.ready
      .then(() => {
        if (cancelled) return;
        const adapter = manager.adapter;
        const healthy = typeof adapter?.isHealthy === 'function'
          ? adapter.isHealthy()
          : true;
        inputHealthyRef.current = healthy;
        if (!healthy) return;
        // Immediate heartbeat so the first load after page load doesn't
        // wait a full interval. Interval pings follow.
        postHeartbeat(adapter);
        heartbeatIntervalId = setInterval(() => postHeartbeat(adapter), HEARTBEAT_INTERVAL_MS);
      })
      .catch(() => {
        if (cancelled) return;
        inputHealthyRef.current = false;
      });

    return () => {
      cancelled = true;
      if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
      manager.destroy();
      inputHealthyRef.current = false;
    };
  }, [config]);
```

- [ ] **Step 4.2: Syntax check via node**

Run: `node -e "require('fs').readFileSync('frontend/src/screen-framework/ScreenRenderer.jsx','utf8').length" 2>&1`
Expected: prints a number — the file is readable and has non-zero size.

- [ ] **Step 4.3: Commit**

```bash
git add frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "$(cat <<'EOF'
feat(screen-framework): POST input heartbeat every 30s while adapter healthy

ScreenRenderer posts to /api/v1/device/:id/input/heartbeat immediately
after the adapter reports isHealthy() true, then every 30s. The backend
device router refuses loads when no fresh heartbeat exists — closing
the gap where the backend keymap is fine but the browser failed to
apply it.

guardrailDeviceId comes from the existing screen config field
websocket.guardrails.device; screens without one skip the heartbeat.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Build, deploy, live verification

- [ ] **Step 5.1: Build the image**

Run:
```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  . 2>&1 | tail -5
```
Expected: `naming to docker.io/kckern/daylight-station:latest done` (or equivalent success line).

- [ ] **Step 5.2: Deploy**

Run: `sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight && sleep 18`
Expected: `Container daylight-station started.`

Tail briefly: `sudo docker logs --tail 5 daylight-station 2>&1 | tail -3`
Expected: recent log lines from the new container (any activity confirms boot).

- [ ] **Step 5.3: Live negative test — load should fail on a fresh container (no heartbeats yet)**

Immediately after the deploy, before the office screen browser has refreshed and re-heartbeated, trigger a load:

```bash
curl -sS -m 6 "http://localhost:3111/api/v1/device/office-tv/load?queue=office-program" | python3 -m json.tool
```

Expected: HTTP 503 body with `"failedStep": "input"` and `"error": "no recent input heartbeat ..."`. The TV does NOT power on.

Also verify the backend log:
```bash
sudo docker logs --since 15s daylight-station 2>&1 | grep -E 'input-precondition|device.router.load' | tail -5
```
Expected: one `device.router.load.input-precondition-failed` entry, no `wake-and-load.power.start`.

- [ ] **Step 5.4: Confirm the office screen eventually heartbeats once it loads the new JS**

Tail the backend for heartbeats (the office Brave reloads automatically after the WS degraded-mode timeout, or the user can reload manually). Run until you see at least one record:

```bash
sudo docker logs -f --since 1s daylight-station 2>&1 | grep --line-buffered 'device.router.heartbeat.recorded' | head -1
```

Expected: a single log line showing `{"deviceId":"office-tv","keyboardId":"officekeypad","keymapSize":<N>}` where N is the actual keymap entry count.

If no heartbeat arrives within 2 minutes, reload the office browser manually (since this is the initial migration and the pre-existing JS can't heartbeat). That's expected for the one-time upgrade.

- [ ] **Step 5.5: Live positive test — after heartbeat, load succeeds**

Immediately after step 5.4 succeeds:

```bash
curl -sS -m 30 "http://localhost:3111/api/v1/device/office-tv/load?queue=office-program" | python3 -c "import json,sys;d=json.load(sys.stdin);print('ok:',d.get('ok'),'failedStep:',d.get('failedStep','none'),'totalElapsedMs:',d.get('totalElapsedMs'))"
```

Expected: `ok: True failedStep: none totalElapsedMs: <some number>`. The TV powers on, content dispatches as before.

- [ ] **Step 5.6: Confirm keypad actually works on the office screen**

Press a key on the office keypad that maps to a visible action (e.g. key `2` = pause). Check backend logs:

```bash
sudo docker logs --since 15s daylight-station 2>&1 | grep -E 'numpad.key' | tail -3
```

Expected: at least one `"event":"numpad.key"` log — confirming the frontend is actually receiving and dispatching keystrokes. If none appears, the keypad is still not routing to the browser (OS-level focus / USB issue) — note in the bug report and keep investigating, but the guard itself is still protecting the user from unstoppable playback.

- [ ] **Step 5.7: Append verification notes to the existing bug report and commit**

Open `docs/_wip/bugs/2026-04-23-office-keypad-dead-unstoppable-video.md` and append under the existing "What this doesn't yet catch" section a new subsection:

```markdown
---

## Heartbeat guard shipped 2026-04-23

- Commits:
  - `InputHeartbeatStore` domain utility (Task 1)
  - Heartbeat endpoint + extended precondition (Task 2)
  - Bootstrap wiring (Task 3)
  - ScreenRenderer heartbeat loop (Task 4)
- Behavior: `POST /api/v1/device/:id/input/heartbeat` records a timestamp + keyboardId + keymapSize. `GET /device/:id/load` with `input.required: true` refuses with 503 unless a heartbeat within the last 60s matches the configured keyboardId.
- Verified: fresh container refused load with 503, then after office screen reloaded and sent its first heartbeat, load succeeded and keypad fired `numpad.key` events.
```

Commit:
```bash
git add docs/_wip/bugs/2026-04-23-office-keypad-dead-unstoppable-video.md
git commit -m "$(cat <<'EOF'
docs(bugs): record input heartbeat guard verification

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Rollback

If anything in Task 5 fails or the office screen never heartbeats:

1. **Loosen the guard immediately without rolling back code:** edit `data/household/config/devices.yml` to set `office-tv.input.required: false`. Restart the container. Loads proceed using the pre-existing keymap-only behavior (still better than before today). This is reversible and takes under a minute.

2. **Full code rollback:** `git revert` the four task commits in reverse order. Rebuild and redeploy.

---

## Out of scope

- Multi-browser reconciliation: if two browsers open `/screen/office`, they both heartbeat and the guard accepts whichever is freshest. Not a real problem for a single-kiosk setup but worth knowing.
- Heartbeat authentication: the POST endpoint accepts any caller on localhost. Since the router is not exposed through the NPM proxy, a remote attacker cannot spoof heartbeats. Revisit if the endpoint ever becomes externally reachable.
- Persistence across container restarts: the store is in-memory. Intentional — restart should force the browser to re-prove input health before loads can succeed.
- Frontend unit tests: the existing vitest-style tests under `frontend/src/screen-framework/input/` aren't picked up by the jest harness, so adding more of them would be dead code. Live verification in Task 5 is the meaningful check. Add a jest-compatible test only if a real unit-test harness appears for frontend code.
