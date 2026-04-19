# Multi-Printer Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `ThermalPrinterAdapter` support two physical printers (upstairs `10.0.0.137` and downstairs `10.0.0.50`) selectable via a trailing `:location?` URL segment, with downstairs as default.

**Architecture:** A new `ThermalPrinterRegistry` class holds N per-instance `ThermalPrinterAdapter`s keyed by name. Routers accept the registry, resolve an adapter from `req.params.location` (or fall back to default), and delegate as before. Config moves from singular `thermal_printer` to a `thermal_printers` map in `adapters.yml` + `services.yml`. The `ping()` method is rewritten byte-free (raw TCP handshake) so health checks can't cause phantom prints.

**Tech Stack:** Node.js ESM, Express, Jest (via `NODE_OPTIONS=--experimental-vm-modules npx jest`), `@jest/globals`, raw `net` module for byte-free TCP probe.

**Design doc:** `docs/plans/2026-04-18-multi-printer-design.md`

---

## Conventions

- Tests live under `tests/unit/adapters/hardware/thermal-printer/` (root-level `tests/`, matching working jest-style tests like `tests/unit/domains/content/Readable.test.mjs`).
- Tests import from `@jest/globals`, use `jest.fn()` (not vitest — vitest imports fail in this repo's jest setup).
- Each task ends with a commit. Commit messages follow `type(scope): summary` with the existing repo style.
- **Boot safety:** no task sends live TCP bytes to `10.0.0.137` or `10.0.0.50` until the final live-verification batch. All network calls in tests are mocked.

---

## Batch 1 — `ThermalPrinterRegistry` (unit tests first)

**Goal:** Build the registry class, fully unit-tested, before touching anything else.

### Task 1.1: Write failing registry tests

**Files:**
- Create: `tests/unit/adapters/hardware/thermal-printer/ThermalPrinterRegistry.test.mjs`

**Step 1:** Write the test file:

```javascript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ThermalPrinterRegistry } from '#adapters/hardware/thermal-printer/ThermalPrinterRegistry.mjs';

function makeAdapter(host, port = 9100) {
  return {
    getHost: () => host,
    getPort: () => port,
    isConfigured: () => true,
  };
}

describe('ThermalPrinterRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new ThermalPrinterRegistry();
  });

  describe('register', () => {
    it('stores an adapter under the given name', () => {
      registry.register('upstairs', makeAdapter('10.0.0.137'));
      expect(registry.has('upstairs')).toBe(true);
    });

    it('marks an adapter as default when isDefault: true', () => {
      registry.register('downstairs', makeAdapter('10.0.0.50'), { isDefault: true });
      expect(registry.getDefault().getHost()).toBe('10.0.0.50');
    });

    it('throws when registering the same name twice', () => {
      registry.register('upstairs', makeAdapter('10.0.0.137'));
      expect(() =>
        registry.register('upstairs', makeAdapter('10.0.0.200'))
      ).toThrow(/already registered/i);
    });

    it('throws when registering a second default', () => {
      registry.register('a', makeAdapter('10.0.0.1'), { isDefault: true });
      expect(() =>
        registry.register('b', makeAdapter('10.0.0.2'), { isDefault: true })
      ).toThrow(/default/i);
    });
  });

  describe('get', () => {
    it('returns the adapter registered under name', () => {
      const adapter = makeAdapter('10.0.0.137');
      registry.register('upstairs', adapter);
      expect(registry.get('upstairs')).toBe(adapter);
    });

    it('throws a 404-shaped error when name is unknown', () => {
      expect(() => registry.get('nowhere')).toThrow(/unknown printer/i);
    });
  });

  describe('getDefault', () => {
    it('throws when no default has been configured', () => {
      registry.register('upstairs', makeAdapter('10.0.0.137'));
      expect(() => registry.getDefault()).toThrow(/no default/i);
    });
  });

  describe('resolve', () => {
    beforeEach(() => {
      registry.register('upstairs', makeAdapter('10.0.0.137'));
      registry.register('downstairs', makeAdapter('10.0.0.50'), { isDefault: true });
    });

    it('returns the named adapter when a name is given', () => {
      expect(registry.resolve('upstairs').getHost()).toBe('10.0.0.137');
    });

    it('falls back to the default when name is undefined', () => {
      expect(registry.resolve(undefined).getHost()).toBe('10.0.0.50');
    });

    it('falls back to the default when name is empty string', () => {
      expect(registry.resolve('').getHost()).toBe('10.0.0.50');
    });

    it('throws on unknown name even when a default exists', () => {
      expect(() => registry.resolve('nowhere')).toThrow(/unknown printer/i);
    });
  });

  describe('list', () => {
    it('returns one descriptor per registered printer', () => {
      registry.register('upstairs', makeAdapter('10.0.0.137'));
      registry.register('downstairs', makeAdapter('10.0.0.50'), { isDefault: true });
      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list).toContainEqual({
        name: 'upstairs', host: '10.0.0.137', port: 9100, isDefault: false,
      });
      expect(list).toContainEqual({
        name: 'downstairs', host: '10.0.0.50', port: 9100, isDefault: true,
      });
    });

    it('returns empty array when nothing registered', () => {
      expect(registry.list()).toEqual([]);
    });
  });
});
```

**Step 2:** Run the test and confirm it fails:

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ThermalPrinterRegistry.test.mjs 2>&1 | tail -15
```

**Expected:** `Cannot find module '#adapters/hardware/thermal-printer/ThermalPrinterRegistry.mjs'` (file doesn't exist yet).

**Step 3:** Commit.

```bash
git add tests/unit/adapters/hardware/thermal-printer/ThermalPrinterRegistry.test.mjs
git commit -m "test(adapters): ThermalPrinterRegistry — unit tests (RED)"
```

---

### Task 1.2: Implement `ThermalPrinterRegistry` (GREEN)

**Files:**
- Create: `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterRegistry.mjs`

**Step 1:** Write the implementation:

```javascript
/**
 * ThermalPrinterRegistry - registry of named ThermalPrinterAdapter instances
 *
 * Holds N adapters keyed by location name (e.g. 'upstairs', 'downstairs').
 * One adapter may be flagged as the default; callers that don't specify
 * a name resolve to it.
 *
 * Pure in-memory — no network I/O, no disk I/O.
 *
 * @module adapters/hardware/thermal-printer
 */

export class ThermalPrinterRegistry {
  #printers = new Map();
  #defaultName = null;

  /**
   * @param {string} name
   * @param {ThermalPrinterAdapter} adapter
   * @param {{ isDefault?: boolean }} [options]
   */
  register(name, adapter, { isDefault = false } = {}) {
    if (this.#printers.has(name)) {
      throw new Error(`Printer "${name}" already registered`);
    }
    if (isDefault && this.#defaultName) {
      throw new Error(
        `Cannot register "${name}" as default — "${this.#defaultName}" is already the default`
      );
    }
    this.#printers.set(name, adapter);
    if (isDefault) this.#defaultName = name;
  }

  has(name) {
    return this.#printers.has(name);
  }

  get(name) {
    const adapter = this.#printers.get(name);
    if (!adapter) throw new Error(`Unknown printer location: "${name}"`);
    return adapter;
  }

  getDefault() {
    if (!this.#defaultName) throw new Error('No default printer configured');
    return this.#printers.get(this.#defaultName);
  }

  /**
   * Resolve a name to an adapter; falls back to default when name is empty.
   * Throws on unknown name.
   */
  resolve(name) {
    if (!name) return this.getDefault();
    return this.get(name);
  }

  list() {
    return Array.from(this.#printers.entries()).map(([name, adapter]) => ({
      name,
      host: adapter.getHost(),
      port: adapter.getPort(),
      isDefault: name === this.#defaultName,
    }));
  }
}

export default ThermalPrinterRegistry;
```

**Step 2:** Run the test and confirm it passes:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ThermalPrinterRegistry.test.mjs 2>&1 | tail -10
```

**Expected:** `Tests: N passed, N total` (all green).

**Step 3:** Commit.

```bash
git add backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterRegistry.mjs
git commit -m "feat(adapters): ThermalPrinterRegistry — named registry for multi-printer support"
```

---

### Task 1.3: Export registry from package index (ADDITIVE ONLY)

**Files:**
- Modify: `backend/src/1_adapters/hardware/thermal-printer/index.mjs`

**Step 1:** Edit `index.mjs` to append the registry export (keep the existing line unchanged):

```javascript
/**
 * Thermal Printer Adapter
 * @module adapters/hardware/thermal-printer
 */

export { ThermalPrinterAdapter, createThermalPrinterAdapter } from './ThermalPrinterAdapter.mjs';
export { ThermalPrinterRegistry } from './ThermalPrinterRegistry.mjs';
```

**Important context discovered during implementation:**
- `backend/src/1_adapters/hardware/index.mjs` (parent barrel) ALSO re-exports `createThermalPrinterAdapter`.
- `backend/src/0_system/bootstrap.mjs:1773` defines its OWN local function called `createThermalPrinterAdapter(config)` that uses `new ThermalPrinterAdapter()` directly.
- `backend/src/app.mjs` does NOT import the factory — it constructs `new ThermalPrinterAdapter()` inline.

So the factory at `ThermalPrinterAdapter.mjs:898` appears to be dead code today. Full cleanup happens in Batch 4 Task 4.3 (see updated task description).

**Step 2:** Verify the import still resolves:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ 2>&1 | tail -5
```

**Expected:** all green.

**Step 3:** Commit.

```bash
git add backend/src/1_adapters/hardware/thermal-printer/index.mjs
git commit -m "feat(adapters): export ThermalPrinterRegistry from thermal-printer/index"
```

---

### Batch 1 — Verification Gate

Report to architect:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ 2>&1 | tail -15
git log --oneline -3
```

**Expected:** 3 new commits, all registry tests green, nothing else touched. **Stop here and report for feedback.**

---

## Batch 2 — Byte-free `ping()` (RED → GREEN)

**Goal:** Rewrite `ThermalPrinterAdapter.ping()` to use raw `net.createConnection()` → `'connect'` → `end()`. Zero bytes written. This preserves boot safety when health checks probe either printer.

### Task 2.1: Write failing test for byte-free ping

**Files:**
- Create: `tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.ping.test.mjs`

**Step 1:** Write the test:

```javascript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventEmitter } from 'events';

const mockCreateConnection = jest.fn();
jest.unstable_mockModule('net', () => ({
  default: { createConnection: mockCreateConnection },
  createConnection: mockCreateConnection,
}));

const { ThermalPrinterAdapter } = await import(
  '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs'
);

function fakeSocket() {
  const sock = new EventEmitter();
  sock.end = jest.fn();
  sock.destroy = jest.fn();
  sock.setTimeout = jest.fn();
  sock.write = jest.fn();
  return sock;
}

describe('ThermalPrinterAdapter.ping (byte-free)', () => {
  beforeEach(() => {
    mockCreateConnection.mockReset();
  });

  it('returns { success: false, configured: false } when no host', async () => {
    const adapter = new ThermalPrinterAdapter({ host: '', port: 9100 });
    const result = await adapter.ping();
    expect(result).toMatchObject({ success: false, configured: false });
    expect(mockCreateConnection).not.toHaveBeenCalled();
  });

  it('opens a raw TCP connection and NEVER writes any bytes', async () => {
    const sock = fakeSocket();
    mockCreateConnection.mockReturnValue(sock);

    const adapter = new ThermalPrinterAdapter({ host: '10.0.0.50', port: 9100 });
    const pingPromise = adapter.ping();

    process.nextTick(() => sock.emit('connect'));
    const result = await pingPromise;

    expect(result.success).toBe(true);
    expect(result.host).toBe('10.0.0.50');
    expect(result.port).toBe(9100);
    expect(sock.write).not.toHaveBeenCalled();  // CRITICAL: no bytes written
    expect(sock.end).toHaveBeenCalled();
  });

  it('reports timeout when connection never opens', async () => {
    const sock = fakeSocket();
    mockCreateConnection.mockReturnValue(sock);

    const adapter = new ThermalPrinterAdapter({
      host: '10.0.0.99', port: 9100, timeout: 50,
    });
    const result = await adapter.ping();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timeout/i);
    expect(sock.write).not.toHaveBeenCalled();
    expect(sock.destroy).toHaveBeenCalled();
  });

  it('reports error on socket error event', async () => {
    const sock = fakeSocket();
    mockCreateConnection.mockReturnValue(sock);

    const adapter = new ThermalPrinterAdapter({ host: '10.0.0.99', port: 9100 });
    const pingPromise = adapter.ping();

    process.nextTick(() => sock.emit('error', new Error('ECONNREFUSED')));
    const result = await pingPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/i);
    expect(sock.write).not.toHaveBeenCalled();
  });
});
```

**Step 2:** Run and confirm it fails (current `ping()` uses `escpos-network` `Network.open()`, not `net.createConnection`):

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.ping.test.mjs 2>&1 | tail -15
```

**Expected:** tests fail — `mockCreateConnection` was not called (current code uses `escpos-network`).

**Step 3:** Commit.

```bash
git add tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.ping.test.mjs
git commit -m "test(adapters): byte-free ping — failing spec (RED)"
```

---

### Task 2.2: Rewrite `ping()` byte-free (GREEN)

**Files:**
- Modify: `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs` (lines ~15 import, ~109–156 `ping()` method)

**Step 1:** Add `net` import at the top of the file, right after the existing `import escpos from 'escpos'` block:

```javascript
import { createConnection } from 'net';
```

**Step 2:** Replace the entire `ping()` method (currently ~line 109–156) with the byte-free version:

```javascript
  /**
   * Ping printer to check if it's reachable.
   *
   * Opens a raw TCP connection and closes it immediately. NEVER writes any
   * bytes — this is important because raw port 9100 is ESC/POS, and any
   * unsolicited bytes would be spooled and printed as garbage.
   *
   * @returns {Promise<{success: boolean, latency?: number, error?: string, configured: boolean}>}
   */
  async ping() {
    if (!this.#host) {
      return { success: false, error: 'Printer IP not configured', configured: false };
    }

    const startTime = Date.now();
    const host = this.#host;
    const port = this.#port;
    const timeout = this.#timeout;

    return new Promise((resolve) => {
      const socket = createConnection({ host, port });
      let settled = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch { /* noop */ }
        resolve(result);
      };

      socket.setTimeout(timeout);

      socket.once('connect', () => {
        // Close cleanly WITHOUT writing anything.
        try { socket.end(); } catch { /* noop */ }
        finish({
          success: true,
          message: 'Printer is reachable',
          host, port,
          latency: Date.now() - startTime,
          configured: true,
        });
      });

      socket.once('timeout', () => {
        finish({
          success: false,
          error: 'Connection timeout',
          host, port,
          latency: Date.now() - startTime,
          configured: true,
        });
      });

      socket.once('error', (err) => {
        finish({
          success: false,
          error: err.message || 'Connection failed',
          host, port,
          latency: Date.now() - startTime,
          configured: true,
        });
      });
    });
  }
```

**Step 3:** Run the new ping test:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ThermalPrinterAdapter.ping.test.mjs 2>&1 | tail -10
```

**Expected:** all green.

**Step 4:** Run the whole thermal-printer test folder to catch regressions:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ 2>&1 | tail -10
```

**Expected:** all green.

**Step 5:** Commit.

```bash
git add backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs
git commit -m "refactor(adapters): ping — byte-free TCP probe (boot-safe)

Raw port 9100 is ESC/POS — any unsolicited bytes print garbage.
Replace escpos-network's Network.open() wrapper with net.createConnection()
+ immediate socket.end(). Zero bytes written, just a TCP handshake."
```

---

### Batch 2 — Verification Gate

Report to architect:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ 2>&1 | tail -10
git log --oneline -5
```

**Expected:** 5 commits total (3 from batch 1, 2 from batch 2), all thermal-printer unit tests green. **Stop here and report for feedback.**

---

## Batch 3 — Routers accept registry + `:location?`

**Goal:** Update `printer.mjs`, `gratitude.mjs`, `fitness.mjs` to receive a `printerRegistry` and resolve an adapter per-request from `req.params.location`.

### Task 3.1: Update `printer.mjs` router

**Files:**
- Modify: `backend/src/4_api/v1/routers/printer.mjs` (entire file)

**Step 1:** Replace the file body with:

```javascript
/**
 * Printer Router
 *
 * API endpoints for thermal printer control, keyed by location:
 *   /printer/<action>/:location?
 *
 * `:location` is optional and falls back to the default printer configured
 * in the registry.
 *
 * @module api/routers
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Resolve the adapter for a request. Throws with a 404-shaped message
 * when the location is unknown.
 * @param {import('#adapters/hardware/thermal-printer/ThermalPrinterRegistry.mjs').ThermalPrinterRegistry} registry
 * @param {express.Request} req
 */
function resolveAdapter(registry, req) {
  const name = req.params.location;
  try {
    return registry.resolve(name);
  } catch (err) {
    const e = new Error(err.message);
    e.statusCode = 404;
    throw e;
  }
}

/**
 * Create printer router
 * @param {Object} config
 * @param {import('#adapters/hardware/thermal-printer/ThermalPrinterRegistry.mjs').ThermalPrinterRegistry} config.printerRegistry
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createPrinterRouter(config) {
  const router = express.Router();
  const { printerRegistry, logger = console } = config;

  // GET /printer — list configured printers
  router.get('/', (req, res) => {
    res.json({
      message: 'Thermal Printer API',
      status: 'success',
      printers: printerRegistry.list(),
      endpoints: {
        'GET /ping/:location?': 'TCP handshake probe (no bytes written)',
        'GET /status/:location?': 'ESC/POS status query',
        'POST /text/:location?': 'Print text',
        'POST /image/:location?': 'Print image from path',
        'POST /receipt/:location?': 'Print receipt-style document',
        'POST /table/:location?': 'Print ASCII table',
        'POST /print/:location?': 'Print a custom job object',
        'GET /feed-button/:location?': 'Feed button status',
        'GET /feed-button/on/:location?': 'Enable feed button',
        'GET /feed-button/off/:location?': 'Disable feed button',
      },
    });
  });

  router.get('/ping/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const result = await adapter.ping();
    const statusCode = result.success ? 200 : (result.configured ? 503 : 501);
    res.status(statusCode).json(result);
  }));

  router.get('/status/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    res.json(await adapter.getStatus());
  }));

  router.post('/text/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const { text, options = {} } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    const printJob = adapter.createTextPrint(text, options);
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Text printed successfully' : 'Print failed', printJob });
  }));

  router.post('/image/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const { path, options = {} } = req.body;
    if (!path) return res.status(400).json({ error: 'Image path is required' });
    const printJob = adapter.createImagePrint(path, options);
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Image printed successfully' : 'Print failed', printJob });
  }));

  router.post('/receipt/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const receiptData = req.body;
    if (!receiptData) return res.status(400).json({ error: 'Receipt data is required' });
    const printJob = adapter.createReceiptPrint(receiptData);
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Receipt printed successfully' : 'Print failed', printJob });
  }));

  router.post('/table/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const tableData = req.body;
    if (!tableData?.headers && (!tableData?.rows || tableData.rows.length === 0)) {
      return res.status(400).json({ error: 'Table must have either headers or rows with data' });
    }
    const printJob = adapter.createTablePrint(tableData);
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Table printed successfully' : 'Print failed', printJob });
  }));

  router.post('/print/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const printJob = req.body;
    if (!printJob?.items) return res.status(400).json({ error: 'Valid print object with items array is required' });
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Print job completed successfully' : 'Print failed', printJob });
  }));

  router.get('/feed-button/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const status = await adapter.getStatus();
    res.json({
      success: status.success,
      feedButtonEnabled: status.feedButtonEnabled,
      note: 'Feed button status cannot be queried directly from most ESC/POS printers',
    });
  }));

  router.get('/feed-button/on/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const printJob = adapter.setFeedButton(true);
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Feed button enabled successfully' : 'Feed button enable failed', enabled: true });
  }));

  router.get('/feed-button/off/:location?', asyncHandler(async (req, res) => {
    const adapter = resolveAdapter(printerRegistry, req);
    const printJob = adapter.setFeedButton(false);
    const success = await adapter.print(printJob);
    res.json({ success, message: success ? 'Feed button disabled successfully' : 'Feed button disable failed', enabled: false });
  }));

  return router;
}

export default createPrinterRouter;
```

**Step 2:** Commit.

```bash
git add backend/src/4_api/v1/routers/printer.mjs
git commit -m "refactor(api): printer router accepts registry, adds :location? param"
```

---

### Task 3.2: Update `gratitude.mjs` router

**Files:**
- Modify: `backend/src/4_api/v1/routers/gratitude.mjs` (function signature, `/card/print` route)

**Step 1:** Find the destructure at ~line 85 (`printerAdapter,`) and change to `printerRegistry,`.

**Step 2:** Replace the `/card/print` route (currently `router.get('/card/print', ...)`) with `router.get('/card/print/:location?', ...)` and inside the handler resolve the adapter. Replace the existing guard (`if (!printerAdapter) {...}`) with registry resolution:

```javascript
  router.get('/card/print/:location?', asyncHandler(async (req, res) => {
    if (!createGratitudeCardCanvas) {
      return res.status(501).json({
        error: 'Gratitude card generation not configured',
        success: false,
      });
    }

    let printerAdapter;
    try {
      printerAdapter = printerRegistry.resolve(req.params.location);
    } catch (err) {
      return res.status(404).json({ error: err.message, success: false });
    }

    // ...rest of the handler unchanged (uses `printerAdapter` local)
```

Leave the body of the handler below that point unchanged — it already uses the `printerAdapter` local name.

**Step 3:** Commit.

```bash
git add backend/src/4_api/v1/routers/gratitude.mjs
git commit -m "refactor(api): gratitude router — :location? on /card/print"
```

---

### Task 3.3: Update `fitness.mjs` router

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (function signature, `/receipt/:sessionId/print` route ~line 464)

**Step 1:** Change the destructure at line 85 from `printerAdapter,` to `printerRegistry,`.

**Step 2:** Change the route definition from:

```javascript
router.get('/receipt/:sessionId/print', async (req, res) => {
```

to:

```javascript
router.get('/receipt/:sessionId/print/:location?', async (req, res) => {
```

**Step 3:** Inside the handler, replace the `if (!printerAdapter) { ... }` guard with:

```javascript
    let printerAdapter;
    try {
      printerAdapter = printerRegistry.resolve(req.params.location);
    } catch (err) {
      return res.status(404).json({ error: err.message });
    }
```

Rest of the handler stays identical — it uses the `printerAdapter` local.

**Step 4:** Commit.

```bash
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "refactor(api): fitness router — :location? on /receipt/:sessionId/print"
```

---

### Batch 3 — Verification Gate

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ 2>&1 | tail -5
git log --oneline -8
grep -n "printerAdapter" backend/src/4_api/v1/routers/printer.mjs backend/src/4_api/v1/routers/gratitude.mjs backend/src/4_api/v1/routers/fitness.mjs | head -10
```

**Expected:** unit tests still green; 8 commits total; no `printerAdapter` destructures remain in router config (local vars inside handlers are fine). **Stop here and report for feedback.**

---

## Batch 4 — Wire-up (`app.mjs` + `bootstrap.mjs`)

**Goal:** Build the registry at startup, pass it to all routers, update the health check. After this batch, the backend still points at the old config key (`thermal_printer`) via the new code path — wire-up is wrong intentionally so config swap in Batch 5 lights it up.

### Task 4.1: Update `app.mjs` wire-up + health check

**Files:**
- Modify: `backend/src/app.mjs` (lines ~1201–1230 wire-up, ~1341 health, ~1371 + ~1527 pass-through)

**Step 1:** Replace the printer wire-up block (currently `const printerAdapterConfig = configService.getAdapterConfig('thermal_printer')...` through the `printerAdapter` construction) with:

```javascript
  // Hardware adapters — thermal printer registry (multi-printer)
  const adaptersConfig = configService.getSystemConfig('adapters') || {};
  const printersConfig = adaptersConfig.thermal_printers || {};
  const printerDefaults = adaptersConfig.thermal_printer_defaults || {};

  const printerRegistry = new ThermalPrinterRegistry();
  for (const [name, cfg] of Object.entries(printersConfig)) {
    if (!cfg?.host) {
      logger?.warn?.('thermalPrinter.skipNoHost', { name });
      continue;
    }
    const adapter = new ThermalPrinterAdapter(
      {
        host: cfg.host,
        port: cfg.port || 9100,
        timeout: cfg.timeout ?? printerDefaults.timeout ?? 5000,
        encoding: cfg.encoding ?? printerDefaults.encoding ?? 'utf8',
        upsideDown: cfg.upsideDown ?? printerDefaults.upsideDown ?? true,
      },
      { logger }
    );
    printerRegistry.register(name, adapter, { isDefault: cfg.default === true });
  }

  const registered = printerRegistry.list();
  if (registered.length > 0) {
    const summary = registered
      .map(p => `${p.name} (${p.host}:${p.port}${p.isDefault ? ', default' : ''})`)
      .join(', ');
    logger?.info?.('thermalPrinter.registered', { count: registered.length, summary });
  } else {
    logger?.warn?.('thermalPrinter.noneConfigured');
  }
```

**Step 2:** Add the `ThermalPrinterRegistry` import near the top of `app.mjs`, next to the `ThermalPrinterAdapter` import. Use grep to find the existing line:

```bash
grep -n "ThermalPrinterAdapter" backend/src/app.mjs | head -3
```

Add alongside it:

```javascript
import { ThermalPrinterRegistry } from '#adapters/hardware/thermal-printer/ThermalPrinterRegistry.mjs';
```

(Or, if the existing import is from `index.mjs`, add `ThermalPrinterRegistry` to that named import list.)

**Step 3:** Replace `hardwareAdapters.printerAdapter = ...` with `hardwareAdapters.printerRegistry = printerRegistry;`. Search:

```bash
grep -n "printerAdapter" backend/src/app.mjs
```

For each occurrence:
- Wire-up result (~line 1219): swap `printer: { host, port, ... }` sub-object for `printerRegistry` (or just delete the sub-object since registry holds that now).
- Health check (~line 1341): replace `printer: hardwareAdapters.printerAdapter?.isConfigured() || false,` with:

  ```javascript
      printers: printerRegistry.list(),
  ```

- Pass-through (~line 1371 and ~line 1527): replace `printerAdapter: hardwareAdapters.printerAdapter,` with `printerRegistry: hardwareAdapters.printerRegistry,`.

**Step 4:** Start the dev backend briefly to confirm it boots (still using old config — expect "no printers configured" warning but no crash):

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
node backend/index.js 2>&1 | head -30 &
PID=$!
sleep 4
kill $PID 2>/dev/null
wait 2>/dev/null
```

**Expected:** backend boots without error; logs show `thermalPrinter.noneConfigured` or similar (because `thermal_printers` key doesn't exist yet — correct behavior).

**Step 5:** Commit.

```bash
git add backend/src/app.mjs
git commit -m "refactor(backend): app.mjs wire-up — ThermalPrinterRegistry replaces single adapter"
```

---

### Task 4.2: Update `bootstrap.mjs` pass-through

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1:** Find and replace in `bootstrap.mjs`:

```bash
grep -n "printerAdapter" backend/src/0_system/bootstrap.mjs
```

For each occurrence, replace `printerAdapter` → `printerRegistry`. These should all be pass-through / dependency-wiring references.

**Step 2:** Commit.

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "refactor(system): bootstrap — pass printerRegistry through"
```

---

### Task 4.3: Drop `createThermalPrinterAdapter` factory (full cleanup)

**Files:**
- Modify: `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs` (remove factory at bottom, ~lines 893–904)
- Modify: `backend/src/1_adapters/hardware/thermal-printer/index.mjs` (drop the factory name from the re-export)
- Modify: `backend/src/1_adapters/hardware/index.mjs` (parent barrel — line 12 re-exports `createThermalPrinterAdapter` too; drop it)
- Investigate: `backend/src/0_system/bootstrap.mjs:1773` defines a same-named local function. Determine if dead (no callers) and delete if so; leave alone if it's used.

**Step 1:** Remove the `createThermalPrinterAdapter` function (bottom of `ThermalPrinterAdapter.mjs`, ~lines 893–904).

**Step 2:** Update `thermal-printer/index.mjs`:

```javascript
export { ThermalPrinterAdapter } from './ThermalPrinterAdapter.mjs';
export { ThermalPrinterRegistry } from './ThermalPrinterRegistry.mjs';
```

**Step 3:** Update parent `hardware/index.mjs` (line 12 area):

```javascript
export { ThermalPrinterAdapter } from './thermal-printer/index.mjs';
export { ThermalPrinterRegistry } from './thermal-printer/index.mjs';
```

**Step 4:** Investigate `bootstrap.mjs:1773`:

```bash
grep -n "createThermalPrinterAdapter" backend/src/0_system/bootstrap.mjs
grep -rn "createThermalPrinterAdapter" backend/src/ | grep -v "bootstrap.mjs\|ThermalPrinterAdapter.mjs\|thermal-printer/index.mjs\|hardware/index.mjs"
```

If bootstrap.mjs's version has no external callers (grep returns no matches outside the files listed), delete it too.

**Step 5:** Grep for any remaining uses everywhere:

```bash
grep -rn "createThermalPrinterAdapter" backend/ tests/ 2>/dev/null
```

**Expected:** no matches at all.

**Step 3:** Re-run the full thermal-printer test folder:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ 2>&1 | tail -5
```

**Expected:** all green.

**Step 4:** Commit.

```bash
git add backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs
git commit -m "chore(adapters): drop createThermalPrinterAdapter factory — registry replaces it"
```

---

### Batch 4 — Verification Gate

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ 2>&1 | tail -5
grep -rn "printerAdapter" backend/src 2>/dev/null | grep -v "\.test\." | head
git log --oneline -12
```

**Expected:** unit tests green; no `printerAdapter` destructures from config objects remain in `backend/src` (local handler variables are fine); 12 commits total. **Stop here and report for feedback.**

---

## Batch 5 — Config swap (LAST, so dev stays bootable mid-batch)

**Goal:** Swap `thermal_printer` → `thermal_printers` in `adapters.yml` and `services.yml`. After this batch, both printers are registered, routes resolve, and the backend boots with the new shape.

### Task 5.1: Update `adapters.yml`

**Files:**
- Modify: `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/config/adapters.yml`

**Step 1:** Replace the existing block:

```yaml
thermal_printer:
  host: 10.0.0.50
  port: 9100
```

with:

```yaml
thermal_printers:
  upstairs:
    host: 10.0.0.137
    port: 9100
  downstairs:
    host: 10.0.0.50
    port: 9100
    default: true

thermal_printer_defaults:
  timeout: 5000
  upsideDown: true
```

**Step 2:** Verify YAML parses:

```bash
node -e "const yaml=require('js-yaml'); const fs=require('fs'); const c=yaml.load(fs.readFileSync('/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/config/adapters.yml','utf8')); console.log(JSON.stringify(c.thermal_printers, null, 2)); console.log('defaults:', c.thermal_printer_defaults);"
```

**Expected:** valid JSON output showing both printers and defaults.

---

### Task 5.2: Update `services.yml`

**Files:**
- Modify: `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/config/services.yml`

**Step 1:** Replace the existing block:

```yaml
thermal_printer:
  docker: http://10.0.0.50:9100
  kckern-server: http://10.0.0.50:9100
  kckern-macbook: http://10.0.0.50:9100
```

with:

```yaml
thermal_printers:
  upstairs:
    docker: http://10.0.0.137:9100
    kckern-server: http://10.0.0.137:9100
    kckern-macbook: http://10.0.0.137:9100
  downstairs:
    docker: http://10.0.0.50:9100
    kckern-server: http://10.0.0.50:9100
    kckern-macbook: http://10.0.0.50:9100
```

**Step 2:** Verify YAML parses:

```bash
node -e "const yaml=require('js-yaml'); const fs=require('fs'); const c=yaml.load(fs.readFileSync('/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/config/services.yml','utf8')); console.log(JSON.stringify(c.thermal_printers, null, 2));"
```

**Expected:** both printers resolved per-env.

---

### Task 5.3: Boot and confirm both printers register

**Step 1:** Start the dev backend:

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
node backend/index.js 2>&1 | tee /tmp/boot-check.log &
PID=$!
sleep 5
kill $PID 2>/dev/null
wait 2>/dev/null
grep -E "thermalPrinter|printer" /tmp/boot-check.log | head -10
```

**Expected log line (or similar):**

```
thermalPrinter.registered: count=2, summary=upstairs (10.0.0.137:9100), downstairs (10.0.0.50:9100, default)
```

**Step 2:** If the log shows only 1 printer or 0, stop — there's a config-loading bug. Otherwise commit.

```bash
git add "/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/config/adapters.yml" "/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/system/config/services.yml"
git commit -m "feat(config): thermal_printers — upstairs (.137) + downstairs (.50, default)"
```

---

### Batch 5 — Verification Gate

Report to architect with:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ 2>&1 | tail -5
git log --oneline -15
cat /tmp/boot-check.log | grep -E "thermalPrinter|printer"
```

**Expected:** all tests still green; 13 commits total; boot log shows both printers registered. **Stop here and report for feedback.**

---

## Batch 6 — Live verification (byte-free, no prints triggered)

**Goal:** Confirm both printers respond to `/printer/ping/:location` from the dev backend. **Only TCP handshakes — no print jobs triggered.**

### Task 6.1: Live ping — default (downstairs)

**Step 1:** Ensure dev backend is running (port 3112 on kckern-macbook):

```bash
lsof -i :3112 | head -3
```

If nothing listening, start it:

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
node backend/index.js > /tmp/backend-dev.log 2>&1 &
sleep 4
```

**Step 2:** Hit the default-routing ping endpoint:

```bash
curl -s http://localhost:3112/api/v1/printer/ping | jq .
```

**Expected:** `{ "success": true, "host": "10.0.0.50", "port": 9100, ... }` (downstairs, because it's default).

---

### Task 6.2: Live ping — named locations

**Step 1:**

```bash
echo "=== upstairs ==="
curl -s http://localhost:3112/api/v1/printer/ping/upstairs | jq .
echo "=== downstairs ==="
curl -s http://localhost:3112/api/v1/printer/ping/downstairs | jq .
echo "=== bogus ==="
curl -s -o /dev/stderr -w "HTTP %{http_code}\n" http://localhost:3112/api/v1/printer/ping/kitchen
```

**Expected:**
- `upstairs` → `success: true, host: "10.0.0.137"` (or timeout if Volcora is off — both legitimate responses, just not an HTTP 5xx)
- `downstairs` → `success: true, host: "10.0.0.50"`
- `kitchen` → HTTP 404 with `Unknown printer location` message

**Step 2:** Hit the info endpoint to confirm both printers listed:

```bash
curl -s http://localhost:3112/api/v1/printer | jq '.printers'
```

**Expected:** array of 2 printers with `isDefault: true` on downstairs.

---

### Task 6.3: Check the old printer still works end-to-end (safe path — ping only)

**Step 1:** Confirm the old-behavior URL (no location) still routes correctly to the default:

```bash
curl -s http://localhost:3112/api/v1/printer/ping | jq '.host'
```

**Expected:** `"10.0.0.50"` — the physical button that hits `/printer/ping` still hits the same printer as before.

**Step 2:** Stop the dev backend.

```bash
pkill -f 'node backend/index.js'
```

**Step 3:** Final commit — mark design doc complete.

```bash
# Edit the design doc status line
```

In `docs/plans/2026-04-18-multi-printer-design.md`, change the top-of-file `**Status:** Design validated, ready for implementation` to `**Status:** Implemented 2026-04-18`.

```bash
git add docs/plans/2026-04-18-multi-printer-design.md
git commit -m "docs: mark multi-printer design as implemented"
```

---

### Batch 6 — Verification Gate (Final)

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/adapters/hardware/thermal-printer/ 2>&1 | tail -5
git log --oneline -15
```

**Expected:** all unit tests green; clean git log showing the progression batch-by-batch.

---

## After all batches complete

Use `superpowers:finishing-a-development-branch` to decide how to integrate (merge to `main`, PR, etc.).

Deferred / explicitly out of scope for this plan:
- Live dashboard / status pings at boot (boot-safety rule — don't write to 9100 unless an operator asks)
- `getStatus()` safety audit — kept as-is with warning in adapter docs (separate task)
- Removal of `escpos-network` dependency — still used by `print()`; byte-free only affects `ping()`
- Any new CLI tools / UI surfacing the registry — not requested
