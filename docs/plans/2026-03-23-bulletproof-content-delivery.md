# Bulletproof Content Delivery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate silent failures in the TV content delivery pipeline so that content (morning program, etc.) always reaches the screen, even when FKB has transient network issues.

**Architecture:** Two-layer resilience: (1) FKB adapter retries loadURL with exponential backoff, (2) WakeAndLoadService falls back to WebSocket content delivery when URL loading fails entirely. Tests cover both layers independently.

**Tech Stack:** Node.js backend (ES modules), Vitest unit tests, FKB REST API, WebSocket broadcast

---

## Background

On 2026-03-23, triggering "Morning Program" on the living room TV failed silently:
- `FullyKioskContentAdapter.load()` sent one `loadURL` command to FKB
- FKB responded with "socket hang up" (transient network hiccup)
- The adapter gave up immediately — zero retries
- FKB eventually loaded the base URL `/screen/living-room` without query params
- The screen showed the menu instead of autoplaying the morning program
- No fallback mechanism existed to deliver the content another way

## What Was Already Fixed (implementation in this branch)

1. **`FullyKioskContentAdapter.load()`** — Added retry loop (3 attempts, exponential backoff)
2. **`WakeAndLoadService.execute()`** — Added WebSocket fallback when URL load fails with content query

## What Remains (this plan)

Tests for both changes, plus a WakeAndLoadService unit test file (doesn't exist yet).

---

### Task 1: Add `load()` retry tests to FullyKioskContentAdapter

**Files:**
- Modify: `backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs`

**Step 1: Write failing tests for load() retry behavior**

Add a new `describe('load')` block with three tests:

```javascript
describe('load', () => {
  it('should succeed on first attempt when loadURL succeeds', async () => {
    const httpClient = createMockHttpClient();
    const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });

    const result = await adapter.load('/screen/living-room', { queue: 'morning-program' });

    expect(result.ok).toBe(true);
    expect(result.attempt).toBe(1);
    expect(result.url).toContain('/screen/living-room?queue=morning-program');
  });

  it('should retry and succeed on second attempt after transient failure', async () => {
    let callCount = 0;
    const httpClient = {
      get: vi.fn(async (url) => {
        const cmd = url.match(/[?&]cmd=([^&]+)/)?.[1];
        if (cmd === 'loadURL') {
          callCount++;
          if (callCount === 1) throw new Error('socket hang up');
          return { status: 200, data: '{}' };
        }
        return { status: 200, data: '{}' };
      }),
    };

    const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });
    const result = await adapter.load('/screen/living-room', { queue: 'morning-program' });

    expect(result.ok).toBe(true);
    expect(result.attempt).toBe(2);
    // Verify warn was logged for the failed attempt
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'fullykiosk.load.attemptException',
      expect.objectContaining({ attempt: 1, error: 'socket hang up' })
    );
  });

  it('should fail after exhausting all retries', async () => {
    const httpClient = {
      get: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    };

    const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });
    const result = await adapter.load('/screen/living-room', { queue: 'morning-program' });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.error).toBe('ECONNREFUSED');
    // Should have logged error (not warn) for final failure
    expect(mockLogger.error).toHaveBeenCalledWith(
      'fullykiosk.load.failed',
      expect.objectContaining({ attempts: 3 })
    );
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs`
Expected: All tests PASS (implementation already exists)

**Step 3: Commit**

```bash
git add backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
git commit -m "test(fkb): add load() retry behavior tests"
```

---

### Task 2: Create WakeAndLoadService unit test file

**Files:**
- Create: `backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs`

**Step 1: Write failing tests for WakeAndLoadService**

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

describe('WakeAndLoadService', () => {
  let mockLogger;
  let mockBroadcast;

  // Minimal device mock that passes all pre-load steps
  function createMockDevice(overrides = {}) {
    return {
      id: 'living-room',
      screenPath: '/screen/living-room',
      defaultVolume: null,
      hasCapability: () => false,
      powerOn: vi.fn(async () => ({ ok: true, verified: true })),
      prepareForContent: vi.fn(async () => ({ ok: true })),
      loadContent: overrides.loadContent || vi.fn(async () => ({ ok: true, url: 'http://test/screen/living-room' })),
      ...overrides,
    };
  }

  function createMockDeviceService(device) {
    return { get: vi.fn(() => device) };
  }

  function createMockReadinessPolicy() {
    return { isReady: vi.fn(async () => ({ ready: true })) };
  }

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    mockBroadcast = vi.fn();
  });

  it('should complete successfully when all steps pass', async () => {
    const device = createMockDevice();
    const service = new WakeAndLoadService({
      deviceService: createMockDeviceService(device),
      readinessPolicy: createMockReadinessPolicy(),
      broadcast: mockBroadcast,
      logger: mockLogger,
    });

    const result = await service.execute('living-room', { queue: 'morning-program' });

    expect(result.ok).toBe(true);
    expect(result.failedStep).toBeUndefined();
    expect(device.loadContent).toHaveBeenCalledWith('/screen/living-room', { queue: 'morning-program' });
  });

  it('should use WebSocket fallback when URL load fails with content query', async () => {
    let loadCallCount = 0;
    const device = createMockDevice({
      loadContent: vi.fn(async (_path, query) => {
        loadCallCount++;
        // First call (with query) fails; second call (base URL) succeeds
        if (loadCallCount === 1) return { ok: false, error: 'socket hang up' };
        return { ok: true, url: 'http://test/screen/living-room' };
      }),
    });

    const service = new WakeAndLoadService({
      deviceService: createMockDeviceService(device),
      readinessPolicy: createMockReadinessPolicy(),
      broadcast: mockBroadcast,
      logger: mockLogger,
    });

    const result = await service.execute('living-room', { queue: 'morning-program' });

    expect(result.ok).toBe(true);
    expect(result.steps.load.method).toBe('websocket-fallback');
    expect(result.steps.load.urlError).toBe('socket hang up');

    // Verify WS broadcast was called with the content query
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'morning-program' })
    );
  });

  it('should fail when URL load fails with NO content query', async () => {
    const device = createMockDevice({
      loadContent: vi.fn(async () => ({ ok: false, error: 'socket hang up' })),
    });

    const service = new WakeAndLoadService({
      deviceService: createMockDeviceService(device),
      readinessPolicy: createMockReadinessPolicy(),
      broadcast: mockBroadcast,
      logger: mockLogger,
    });

    const result = await service.execute('living-room', {});

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('load');
    expect(result.error).toBe('socket hang up');
  });

  it('should return device not found for unknown device', async () => {
    const service = new WakeAndLoadService({
      deviceService: { get: () => null },
      readinessPolicy: createMockReadinessPolicy(),
      broadcast: mockBroadcast,
      logger: mockLogger,
    });

    const result = await service.execute('nonexistent', {});

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Device not found');
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs`
Expected: All 4 tests PASS

Note: The WS fallback test uses real `setTimeout` delays (3s + 2s). If this is too slow, consider using `vi.useFakeTimers()` and advancing time. But 5s is acceptable for a unit test.

**Step 3: Commit**

```bash
git add backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs
git commit -m "test(devices): add WakeAndLoadService unit tests with WS fallback coverage"
```

---

### Task 3: Commit the implementation changes

**Files:**
- Modified: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` (already changed)
- Modified: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` (already changed)

**Step 1: Run full test suite to verify no regressions**

Run: `npx vitest run backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs`
Expected: All tests PASS

**Step 2: Commit implementation**

```bash
git add backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs backend/src/3_applications/devices/services/WakeAndLoadService.mjs
git commit -m "fix(devices): add retry + WS fallback for content delivery

FullyKioskContentAdapter.load() now retries up to 3 times with exponential
backoff (1s, 2s) before giving up.

WakeAndLoadService.execute() now falls back to WebSocket content delivery
when URL load fails: loads the base screen URL, waits for mount, then
broadcasts the content query via WS for the screen's command handler.

Fixes: morning program silent failure on 2026-03-23 caused by single
'socket hang up' error with no retry or fallback."
```

---

### Task 4: Deploy and verify on prod

**Step 1: Deploy**

User runs `deploy.sh` manually (per CLAUDE.md rules).

**Step 2: Verify via prod logs**

After deploy, trigger morning program again and check logs for:
- `fullykiosk.load.success` with `attempt: 1` (happy path)
- OR `fullykiosk.load.attemptFailed` + `fullykiosk.load.success` with `attempt: 2+` (retry worked)
- OR `wake-and-load.load.wsFallbackSent` (WS fallback engaged)

```bash
ssh homeserver.local 'docker logs daylight-station --since 5m 2>&1' | grep -E 'fullykiosk.load|wake-and-load.load'
```
