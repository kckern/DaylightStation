# Session Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add opt-in per-app session logging that writes timestamped `.jsonl` files to `media/logs/{app}/` alongside normal log dispatch.

**Architecture:** Frontend loggers opt in via `sessionLog: true` in `child()` context. The flag rides on every event through the existing WebSocket pipeline. Backend ingestion detects it and writes events to a session file transport in addition to normal dispatch. Session boundaries are signaled by an auto-emitted `session-log.start` event when the child logger is created. Files are pruned after 3 days on server startup.

**Tech Stack:** Node.js `fs` (write streams), Jest for testing, existing logging framework.

---

### Task 1: Session File Transport — Core Write Logic

**Files:**
- Create: `backend/src/0_system/logging/transports/sessionFile.mjs`
- Test: `tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs`

**Step 1: Write the failing test**

```js
// tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  initSessionFileTransport,
  getSessionFileTransport,
  resetSessionFileTransport
} from '#backend/src/0_system/logging/transports/sessionFile.mjs';

describe('SessionFileTransport', () => {
  let tmpDir;

  beforeEach(() => {
    resetSessionFileTransport();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-log-test-'));
  });

  afterEach(async () => {
    const sft = getSessionFileTransport();
    if (sft) await sft.flush();
    resetSessionFileTransport();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('write after session-log.start creates file and appends event', () => {
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
    const sft = getSessionFileTransport();

    // Start a session
    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'session-log.start',
      data: { app: 'fitness' },
      context: { app: 'fitness', sessionLog: true }
    });

    // Write a regular event
    sft.write({
      ts: '2026-02-24T16:00:01.000',
      level: 'info',
      event: 'fitness-app-mount',
      data: { foo: 'bar' },
      context: { app: 'fitness', sessionLog: true }
    });

    // Verify file was created in fitness/ subdirectory
    const appDir = path.join(tmpDir, 'fitness');
    expect(fs.existsSync(appDir)).toBe(true);

    const files = fs.readdirSync(appDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.jsonl$/);

    // Verify contents
    const content = fs.readFileSync(path.join(appDir, files[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe('session-log.start');
    expect(JSON.parse(lines[1]).event).toBe('fitness-app-mount');
  });

  test('events without prior session-log.start auto-create a session', () => {
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
    const sft = getSessionFileTransport();

    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'some-event',
      data: {},
      context: { app: 'admin', sessionLog: true }
    });

    const appDir = path.join(tmpDir, 'admin');
    expect(fs.existsSync(appDir)).toBe(true);
    const files = fs.readdirSync(appDir);
    expect(files).toHaveLength(1);
  });

  test('new session-log.start closes previous session and opens new file', async () => {
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
    const sft = getSessionFileTransport();

    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'session-log.start',
      data: {},
      context: { app: 'fitness', sessionLog: true }
    });

    // Small delay to ensure different timestamp in filename
    await new Promise(r => setTimeout(r, 50));

    sft.write({
      ts: '2026-02-24T16:05:00.000',
      level: 'info',
      event: 'session-log.start',
      data: {},
      context: { app: 'fitness', sessionLog: true }
    });

    const appDir = path.join(tmpDir, 'fitness');
    const files = fs.readdirSync(appDir);
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  test('different apps get separate subdirectories', () => {
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
    const sft = getSessionFileTransport();

    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'session-log.start',
      data: {},
      context: { app: 'fitness', sessionLog: true }
    });

    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'session-log.start',
      data: {},
      context: { app: 'admin', sessionLog: true }
    });

    expect(fs.existsSync(path.join(tmpDir, 'fitness'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'admin'))).toBe(true);
  });

  test('events without sessionLog context are ignored', () => {
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });
    const sft = getSessionFileTransport();

    sft.write({
      ts: '2026-02-24T16:00:00.000',
      level: 'info',
      event: 'random-event',
      data: {},
      context: { app: 'fitness' }
    });

    // No directories should be created
    const entries = fs.readdirSync(tmpDir);
    expect(entries).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs --verbose`
Expected: FAIL — cannot resolve `#backend/src/0_system/logging/transports/sessionFile.mjs`

**Step 3: Write minimal implementation**

```js
// backend/src/0_system/logging/transports/sessionFile.mjs
/**
 * Session File Transport
 *
 * Writes log events to per-app session files in media/logs/{app}/.
 * Sessions are bounded by session-log.start events.
 * Old files are pruned on initialization based on maxAgeDays.
 */

import fs from 'fs';
import path from 'path';

let instance = null;

/**
 * Initialize the session file transport singleton
 * @param {Object} options
 * @param {string} options.baseDir - Base directory for session logs (e.g., media/logs)
 * @param {number} options.maxAgeDays - Delete files older than this (default: 3)
 */
export function initSessionFileTransport({ baseDir, maxAgeDays = 3 }) {
  if (!baseDir) {
    throw new Error('Session file transport requires a baseDir option');
  }

  // Ensure base directory exists
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  // Prune old files on init
  pruneOldFiles(baseDir, maxAgeDays);

  const activeSessions = new Map(); // app -> { filePath, stream }

  const openSession = (app, ts) => {
    // Close existing session for this app
    const existing = activeSessions.get(app);
    if (existing?.stream?.writable) {
      existing.stream.end();
    }

    // Create app subdirectory
    const appDir = path.join(baseDir, app);
    if (!fs.existsSync(appDir)) {
      fs.mkdirSync(appDir, { recursive: true });
    }

    // Generate filename from timestamp
    const timestamp = ts || new Date().toISOString();
    const safeName = timestamp.replace(/:/g, '-').replace(/\.\d+Z?$/, '');
    const filePath = path.join(appDir, `${safeName}.jsonl`);

    const stream = fs.createWriteStream(filePath, { flags: 'a' });
    activeSessions.set(app, { filePath, stream });

    return { filePath, stream };
  };

  instance = {
    write(event) {
      const app = event?.context?.app;
      if (!app || !event?.context?.sessionLog) return;

      // session-log.start opens a new file
      if (event.event === 'session-log.start') {
        const session = openSession(app, event.ts);
        const line = JSON.stringify(event) + '\n';
        session.stream.write(line);
        return;
      }

      // Regular event — append to active session (auto-create if none)
      if (!activeSessions.has(app)) {
        openSession(app, event.ts);
      }

      const session = activeSessions.get(app);
      if (session?.stream?.writable) {
        const line = JSON.stringify(event) + '\n';
        session.stream.write(line);
      }
    },

    async flush() {
      const promises = [];
      for (const [, session] of activeSessions) {
        if (session.stream?.writable) {
          promises.push(new Promise(resolve => session.stream.end(resolve)));
        }
      }
      await Promise.all(promises);
      activeSessions.clear();
    },

    getStatus() {
      const sessions = {};
      for (const [app, session] of activeSessions) {
        sessions[app] = { filePath: session.filePath, writable: session.stream?.writable || false };
      }
      return { name: 'session-file', baseDir, sessions };
    }
  };

  return instance;
}

/**
 * Get the initialized session file transport
 * @returns {Object|null} Transport instance or null if not initialized
 */
export function getSessionFileTransport() {
  return instance;
}

/**
 * Reset the session file transport (for testing)
 */
export function resetSessionFileTransport() {
  if (instance) {
    // Best-effort flush
    instance.flush().catch(() => {});
  }
  instance = null;
}

/**
 * Delete session log files older than maxAgeDays
 */
function pruneOldFiles(baseDir, maxAgeDays) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  let appDirs;
  try {
    appDirs = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return; // baseDir doesn't exist or not readable
  }

  for (const appName of appDirs) {
    const appDir = path.join(baseDir, appName);
    let files;
    try {
      files = fs.readdirSync(appDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(appDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Ignore stat/unlink errors
      }
    }
  }
}

export default getSessionFileTransport;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs --verbose`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/logging/transports/sessionFile.mjs tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs
git commit -m "feat(logging): add session file transport with retention cleanup"
```

---

### Task 2: Session File Transport — Retention Pruning Tests

**Files:**
- Modify: `tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs`

**Step 1: Add pruning tests to existing test file**

Append to the existing `describe('SessionFileTransport')` block:

```js
  describe('retention pruning', () => {
    test('deletes files older than maxAgeDays on init', () => {
      // Create app dir with an old file
      const appDir = path.join(tmpDir, 'fitness');
      fs.mkdirSync(appDir, { recursive: true });
      const oldFile = path.join(appDir, '2026-02-20T10-00-00.jsonl');
      fs.writeFileSync(oldFile, '{"event":"old"}\n');

      // Backdate the file to 5 days ago
      const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
      fs.utimesSync(oldFile, new Date(fiveDaysAgo), new Date(fiveDaysAgo));

      // Create a recent file
      const newFile = path.join(appDir, '2026-02-24T10-00-00.jsonl');
      fs.writeFileSync(newFile, '{"event":"new"}\n');

      // Init triggers pruning with 3-day max
      initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });

      expect(fs.existsSync(oldFile)).toBe(false);
      expect(fs.existsSync(newFile)).toBe(true);
    });

    test('ignores non-jsonl files during pruning', () => {
      const appDir = path.join(tmpDir, 'fitness');
      fs.mkdirSync(appDir, { recursive: true });
      const readmeFile = path.join(appDir, 'README.md');
      fs.writeFileSync(readmeFile, 'keep me');

      // Backdate it
      const oldDate = Date.now() - 10 * 24 * 60 * 60 * 1000;
      fs.utimesSync(readmeFile, new Date(oldDate), new Date(oldDate));

      initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });

      expect(fs.existsSync(readmeFile)).toBe(true);
    });
  });
```

**Step 2: Run tests**

Run: `npx jest tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs --verbose`
Expected: All 7 tests PASS

**Step 3: Commit**

```bash
git add tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs
git commit -m "test(logging): add retention pruning tests for session file transport"
```

---

### Task 3: Add Session File Transport to Barrel Export

**Files:**
- Modify: `backend/src/0_system/logging/transports/index.mjs:1-9`

**Step 1: Add export**

Add to `backend/src/0_system/logging/transports/index.mjs`:

```js
export { initSessionFileTransport, getSessionFileTransport } from './sessionFile.mjs';
```

**Step 2: Verify import resolves**

Run: `node -e "import('#backend/src/0_system/logging/transports/index.mjs').then(m => console.log(Object.keys(m)))"`
Expected: Output includes `initSessionFileTransport` and `getSessionFileTransport`

**Step 3: Commit**

```bash
git add backend/src/0_system/logging/transports/index.mjs
git commit -m "feat(logging): export session file transport from barrel"
```

---

### Task 4: Wire Session File Transport into Server Startup

**Files:**
- Modify: `backend/src/server.mjs:17-18` (imports) and `backend/src/server.mjs:104-116` (after file transport init)

**Step 1: Add import**

At `backend/src/server.mjs:18`, update the transport import line:

```js
import { createConsoleTransport, createFileTransport, createLogglyTransport, initSessionFileTransport } from './0_system/logging/transports/index.mjs';
```

**Step 2: Add initialization after existing transports**

After the Loggly transport block (after line 116), add:

```js
  // Session file transport - writes per-app session logs to media/logs/
  const mediaDir = configService.getMediaDir();
  initSessionFileTransport({
    baseDir: join(mediaDir, 'logs'),
    maxAgeDays: 3
  });
  console.log(`[Logging] Session file transport enabled: ${join(mediaDir, 'logs')} (3-day retention)`);
```

**Step 3: Commit**

```bash
git add backend/src/server.mjs
git commit -m "feat(logging): initialize session file transport on server startup"
```

---

### Task 5: Hook Session File Transport into Ingestion

**Files:**
- Modify: `backend/src/0_system/logging/ingestion.mjs:7` (import) and `backend/src/0_system/logging/ingestion.mjs:27-30` (after dispatch)
- Test: `tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs` (add integration test)

**Step 1: Write the failing integration test**

Add to `tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs`:

```js
describe('ingestion integration', () => {
  let tmpDir;

  beforeEach(() => {
    resetSessionFileTransport();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-log-ingest-'));
  });

  afterEach(async () => {
    const sft = getSessionFileTransport();
    if (sft) await sft.flush();
    resetSessionFileTransport();
    resetLogging();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('ingestFrontendLogs writes to session file when sessionLog context is set', () => {
    // Set up dispatcher (required for ingestion)
    initializeLogging({ defaultLevel: 'debug' });
    const mockTransport = { name: 'mock', send: jest.fn() };
    getDispatcher().addTransport(mockTransport);

    // Set up session file transport
    initSessionFileTransport({ baseDir: tmpDir, maxAgeDays: 3 });

    // Ingest a session-log.start event
    ingestFrontendLogs({
      events: [
        {
          ts: '2026-02-24T16:00:00.000',
          level: 'info',
          event: 'session-log.start',
          data: {},
          context: { app: 'admin', sessionLog: true }
        },
        {
          ts: '2026-02-24T16:00:01.000',
          level: 'info',
          event: 'admin-page-loaded',
          data: { page: 'config' },
          context: { app: 'admin', sessionLog: true }
        }
      ]
    });

    // Normal dispatch should still work
    expect(mockTransport.send).toHaveBeenCalledTimes(2);

    // Session file should also have been written
    const appDir = path.join(tmpDir, 'admin');
    expect(fs.existsSync(appDir)).toBe(true);
    const files = fs.readdirSync(appDir);
    expect(files).toHaveLength(1);

    const content = fs.readFileSync(path.join(appDir, files[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});
```

Add these imports at the top of the test file:

```js
import { ingestFrontendLogs } from '#backend/src/0_system/logging/ingestion.mjs';
import {
  initializeLogging,
  resetLogging,
  getDispatcher
} from '#backend/src/0_system/logging/dispatcher.mjs';
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs --verbose -t "ingestion integration"`
Expected: FAIL — ingestion doesn't write to session file transport yet

**Step 3: Modify ingestion.mjs**

At `backend/src/0_system/logging/ingestion.mjs:7`, add import:

```js
import { getSessionFileTransport } from './transports/sessionFile.mjs';
```

At `backend/src/0_system/logging/ingestion.mjs:28`, after `dispatcher.dispatch(normalized);`, add:

```js
      // Write to session file if sessionLog flag is set
      const sft = getSessionFileTransport();
      if (sft && normalized.context?.sessionLog) {
        sft.write(normalized);
      }
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs --verbose`
Expected: All tests PASS (including the integration test)

**Step 5: Commit**

```bash
git add backend/src/0_system/logging/ingestion.mjs tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs
git commit -m "feat(logging): hook session file transport into frontend log ingestion"
```

---

### Task 6: Frontend — Auto-Emit session-log.start in child()

**Files:**
- Modify: `frontend/src/lib/logging/Logger.js:169-180`

**Step 1: Modify child() to auto-emit start signal**

Replace `frontend/src/lib/logging/Logger.js:169-180`:

```js
const child = (childContext = {}) => {
  const parentContext = { ...config.context };
  const childLogger = {
    log: (level, eventName, data, opts) => emit(level, eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    debug: (eventName, data, opts) => emit('debug', eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    info: (eventName, data, opts) => emit('info', eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    warn: (eventName, data, opts) => emit('warn', eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    error: (eventName, data, opts) => emit('error', eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    sampled: emitSampled,
    child: (ctx) => child({ ...parentContext, ...childContext, ...ctx })
  };

  // Auto-emit session start signal for session-logged apps
  if (childContext.sessionLog) {
    childLogger.info('session-log.start', { app: childContext.app || parentContext.app });
  }

  return childLogger;
};
```

**Step 2: Verify no regressions**

Run: `npx jest tests/isolated/assembly/logging/frontend-sampled-logger.test.mjs --verbose`
Expected: PASS (existing frontend logger tests still pass)

**Step 3: Commit**

```bash
git add frontend/src/lib/logging/Logger.js
git commit -m "feat(logging): auto-emit session-log.start when child has sessionLog: true"
```

---

### Task 7: Opt In FitnessApp

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx:43`

**Step 1: Add sessionLog flag**

Change line 43 from:

```js
  const logger = useMemo(() => getLogger().child({ app: 'fitness' }), []);
```

To:

```js
  const logger = useMemo(() => getLogger().child({ app: 'fitness', sessionLog: true }), []);
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "feat(fitness): enable session logging for fitness app"
```

---

### Task 8: Delete Design Draft and Verify End-to-End

**Files:**
- Delete: `docs/plans/2026-02-24-session-logging-design.md` (superseded by this plan)

**Step 1: Run all logging tests**

Run: `npx jest tests/isolated/assembly/infrastructure/logging/ --verbose`
Expected: All tests PASS

**Step 2: Run full test suite to check for regressions**

Run: `npx jest tests/isolated/ --verbose 2>&1 | tail -20`
Expected: No new failures

**Step 3: Clean up design draft**

```bash
git rm docs/plans/2026-02-24-session-logging-design.md
```

**Step 4: Final commit**

```bash
git add docs/plans/2026-02-24-session-logging.md
git commit -m "docs: finalize session logging implementation plan"
```
