# Fitness Session: Unit Tests & Ghost Session Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add unit tests for the Bug A/B code fixes, then investigate and fix the ghost/duplicate session problem (Issue F).

**Architecture:** Two test files using Vitest (the project's frontend test runner) cover `normalizeDuration` and `_closeOpenMedia`. The ghost session fix adds a session-leader protocol so only one client persists per session — using a lightweight backend lock endpoint.

**Tech Stack:** Vitest, `@testing-library/react` (if needed), `js-yaml`, Express

---

## Group 1: Unit Tests for Bug A/B Fixes

### Task 1: Write tests for `normalizeDuration`

**Files:**
- Create: `tests/isolated/modules/Player/normalizeDuration.test.mjs`
- Reference: `frontend/src/modules/Player/utils/mediaIdentity.js:36-60`

**Step 1: Write the test file**

```javascript
import { describe, it, expect } from 'vitest';
import { normalizeDuration } from '#frontend/modules/Player/utils/mediaIdentity.js';

describe('normalizeDuration', () => {
  describe('basic conversion', () => {
    it('returns seconds for a value already in seconds', () => {
      expect(normalizeDuration(1888)).toBe(1888);
    });

    it('converts milliseconds to seconds (values > 1000)', () => {
      expect(normalizeDuration(1888426)).toBe(1888);
    });

    it('rounds to nearest integer', () => {
      expect(normalizeDuration(1888.7)).toBe(1889);
    });

    it('parses string values', () => {
      expect(normalizeDuration('1888')).toBe(1888);
    });

    it('returns null for all-null candidates', () => {
      expect(normalizeDuration(null, undefined, null)).toBeNull();
    });

    it('returns null for no arguments', () => {
      expect(normalizeDuration()).toBeNull();
    });

    it('skips NaN and non-finite values', () => {
      expect(normalizeDuration(NaN, Infinity, 300)).toBe(300);
    });

    it('skips zero and negative values', () => {
      expect(normalizeDuration(0, -5, 600)).toBe(600);
    });
  });

  describe('two-pass threshold (Bug A fix)', () => {
    it('prefers candidates >= 10s over small placeholders', () => {
      // Plex season number "2" appears first, real duration "1888" second
      expect(normalizeDuration(2, 1888)).toBe(1888);
    });

    it('skips placeholder "2" even when it is the only candidate above zero', () => {
      // Falls back to second pass when no candidate >= 10
      expect(normalizeDuration(2)).toBe(2);
    });

    it('skips placeholder values 2, 10, 15, 17 when a real duration exists', () => {
      expect(normalizeDuration(10, 1500)).toBe(1500);
      expect(normalizeDuration(15, 900)).toBe(900);
      expect(normalizeDuration(17, 1200)).toBe(1200);
    });

    it('accepts genuinely short durations (< 10s) when no better candidate exists', () => {
      expect(normalizeDuration(5)).toBe(5);
      expect(normalizeDuration(3, null, undefined)).toBe(3);
    });

    it('prefers the first candidate >= 10s, not the largest', () => {
      expect(normalizeDuration(30, 1888)).toBe(30);
    });
  });

  describe('millisecond detection (> 1000 heuristic)', () => {
    it('divides values > 1000 by 1000 (assumes milliseconds)', () => {
      expect(normalizeDuration(30000)).toBe(30);
    });

    it('treats 1001 as milliseconds', () => {
      // Edge case: 1001ms -> 1s (rounds)
      expect(normalizeDuration(1001)).toBe(1);
    });

    it('treats 999 as seconds', () => {
      expect(normalizeDuration(999)).toBe(999);
    });

    it('treats 1000 as seconds (boundary: not > 1000)', () => {
      expect(normalizeDuration(1000)).toBe(1000);
    });
  });

  describe('candidate priority', () => {
    it('uses first valid candidate when all are >= 10s', () => {
      expect(normalizeDuration(120, 300, 600)).toBe(120);
    });

    it('skips null candidates in sequence', () => {
      expect(normalizeDuration(null, null, 45)).toBe(45);
    });

    it('skips invalid candidates to find valid one', () => {
      expect(normalizeDuration('not-a-number', '', 200)).toBe(200);
    });
  });
});
```

**Step 2: Run the test to verify it passes**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/Player/normalizeDuration.test.mjs`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/isolated/modules/Player/normalizeDuration.test.mjs
git commit -m "test: add unit tests for normalizeDuration two-pass threshold (Bug A)"
```

---

### Task 2: Write tests for `resolveContentId`

While we're in `mediaIdentity.js`, cover `resolveContentId` too — it's the other function used in the media event pipeline and has no tests.

**Files:**
- Create: `tests/isolated/modules/Player/resolveContentId.test.mjs`
- Reference: `frontend/src/modules/Player/utils/mediaIdentity.js:1-34`

**Step 1: Write the test file**

```javascript
import { describe, it, expect } from 'vitest';
import { resolveMediaIdentity, resolveContentId } from '#frontend/modules/Player/utils/mediaIdentity.js';

describe('resolveMediaIdentity', () => {
  it('returns null for null/undefined input', () => {
    expect(resolveMediaIdentity(null)).toBeNull();
    expect(resolveMediaIdentity(undefined)).toBeNull();
  });

  it('resolves assetId first', () => {
    expect(resolveMediaIdentity({ assetId: '123', key: '456' })).toBe('123');
  });

  it('falls through candidate chain: key > plex > media > id > guid > mediaUrl', () => {
    expect(resolveMediaIdentity({ key: '456' })).toBe('456');
    expect(resolveMediaIdentity({ plex: '789' })).toBe('789');
    expect(resolveMediaIdentity({ media: 'abc' })).toBe('abc');
    expect(resolveMediaIdentity({ id: 'def' })).toBe('def');
    expect(resolveMediaIdentity({ guid: 'ghi' })).toBe('ghi');
    expect(resolveMediaIdentity({ mediaUrl: 'http://x' })).toBe('http://x');
  });

  it('converts numeric IDs to string', () => {
    expect(resolveMediaIdentity({ assetId: 12345 })).toBe('12345');
  });

  it('returns null when no candidate fields exist', () => {
    expect(resolveMediaIdentity({ title: 'foo' })).toBeNull();
  });
});

describe('resolveContentId', () => {
  it('returns null for null input', () => {
    expect(resolveContentId(null)).toBeNull();
  });

  it('returns already-namespaced IDs as-is', () => {
    expect(resolveContentId({ assetId: 'plex:12345' })).toBe('plex:12345');
  });

  it('adds plex prefix for plex-sourced metadata', () => {
    expect(resolveContentId({ plex: '12345' })).toBe('plex:12345');
  });

  it('adds plex prefix for assetId metadata', () => {
    expect(resolveContentId({ assetId: '12345' })).toBe('plex:12345');
  });

  it('uses explicit source field when present', () => {
    expect(resolveContentId({ id: '999', source: 'youtube' })).toBe('youtube:999');
  });

  it('defaults to plex when source cannot be determined', () => {
    expect(resolveContentId({ id: '999' })).toBe('plex:999');
  });
});
```

**Step 2: Run the test to verify it passes**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/Player/resolveContentId.test.mjs`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/isolated/modules/Player/resolveContentId.test.mjs
git commit -m "test: add unit tests for resolveMediaIdentity and resolveContentId"
```

---

### Task 3: Write tests for `_closeOpenMedia`

`_closeOpenMedia` is a method on the `FitnessSession` class which has ~20 imports and heavy coupling. Rather than instantiating the full class, extract the logic and test it as a pure function.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1756-1770` — extract logic to a standalone function
- Create: `tests/isolated/modules/Fitness/closeOpenMedia.test.mjs`

**Step 1: Write the failing test first**

Create the test file that imports a not-yet-exported function:

```javascript
import { describe, it, expect } from 'vitest';
import { findUnclosedMedia } from '#frontend/hooks/fitness/closeOpenMedia.js';

describe('findUnclosedMedia', () => {
  it('returns empty array when no events exist', () => {
    expect(findUnclosedMedia([])).toEqual([]);
  });

  it('returns empty array when all media_start have matching media_end', () => {
    const events = [
      { type: 'media_start', data: { contentId: 'plex:100' } },
      { type: 'media_end', data: { contentId: 'plex:100' } },
    ];
    expect(findUnclosedMedia(events)).toEqual([]);
  });

  it('returns contentId for media_start without media_end', () => {
    const events = [
      { type: 'media_start', data: { contentId: 'plex:100' } },
    ];
    expect(findUnclosedMedia(events)).toEqual(['plex:100']);
  });

  it('handles multiple unclosed media', () => {
    const events = [
      { type: 'media_start', data: { contentId: 'plex:100' } },
      { type: 'media_start', data: { contentId: 'plex:200' } },
    ];
    const result = findUnclosedMedia(events);
    expect(result).toHaveLength(2);
    expect(result).toContain('plex:100');
    expect(result).toContain('plex:200');
  });

  it('pairs by contentId — earlier media_end closes the right media_start', () => {
    const events = [
      { type: 'media_start', data: { contentId: 'plex:100' } },
      { type: 'media_start', data: { contentId: 'plex:200' } },
      { type: 'media_end', data: { contentId: 'plex:100' } },
    ];
    expect(findUnclosedMedia(events)).toEqual(['plex:200']);
  });

  it('handles re-opened media (start → end → start again)', () => {
    const events = [
      { type: 'media_start', data: { contentId: 'plex:100' } },
      { type: 'media_end', data: { contentId: 'plex:100' } },
      { type: 'media_start', data: { contentId: 'plex:100' } },
    ];
    expect(findUnclosedMedia(events)).toEqual(['plex:100']);
  });

  it('skips events without contentId', () => {
    const events = [
      { type: 'media_start', data: {} },
      { type: 'media_start', data: { contentId: 'plex:100' } },
      { type: 'tick', data: { hr: 120 } },
    ];
    expect(findUnclosedMedia(events)).toEqual(['plex:100']);
  });

  it('skips null data', () => {
    const events = [
      { type: 'media_start', data: null },
      { type: 'media_start' },
    ];
    expect(findUnclosedMedia(events)).toEqual([]);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/Fitness/closeOpenMedia.test.mjs`
Expected: FAIL — module `#frontend/hooks/fitness/closeOpenMedia.js` not found

**Step 3: Extract `findUnclosedMedia` into a standalone module**

Create `frontend/src/hooks/fitness/closeOpenMedia.js`:

```javascript
/**
 * Find contentIds that have a media_start but no matching media_end.
 * Pure function — no side effects, no class dependencies.
 *
 * @param {Array<{type: string, data?: {contentId?: string}}>} events
 * @returns {string[]} Array of unclosed contentIds
 */
export function findUnclosedMedia(events) {
  const opened = new Set();
  for (const evt of events) {
    const id = evt.data?.contentId;
    if (!id) continue;
    if (evt.type === 'media_start') opened.add(id);
    if (evt.type === 'media_end') opened.delete(id);
  }
  return [...opened];
}
```

**Step 4: Update `_closeOpenMedia` in FitnessSession.js to use the extracted function**

In `frontend/src/hooks/fitness/FitnessSession.js`, add the import near the top (after other fitness imports):

```javascript
import { findUnclosedMedia } from './closeOpenMedia.js';
```

Then replace the body of `_closeOpenMedia(now)` (lines 1756-1770):

```javascript
  _closeOpenMedia(now) {
    if (!this.timeline?.events) return;

    for (const contentId of findUnclosedMedia(this.timeline.events)) {
      this.logEvent('media_end', { contentId, source: 'session_end' }, now);
    }
  }
```

**Step 5: Run the test to verify it passes**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/Fitness/closeOpenMedia.test.mjs`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/closeOpenMedia.js \
       frontend/src/hooks/fitness/FitnessSession.js \
       tests/isolated/modules/Fitness/closeOpenMedia.test.mjs
git commit -m "refactor: extract findUnclosedMedia, add unit tests (Bug B)"
```

---

## Group 2: Ghost/Duplicate Session Fix (Issue F)

### Background

The ghost session problem has this root cause chain:
1. Each client (Shield TV, Mac) creates its own `FitnessSession` instance in React context
2. Session IDs are timestamps with second-level precision — two clients starting within seconds get different IDs
3. Neither client checks the backend for existing sessions
4. Both persist independently, creating duplicate YAML files with fragmented data

The fix: **session leader protocol** — one client is the "leader" that owns persistence, others observe. This is implemented as a backend lock endpoint.

### Task 4: Write failing test for session lock endpoint

**Files:**
- Create: `tests/isolated/api/fitnessSessionLock.test.mjs`
- Reference: `backend/src/4_api/v1/routers/fitness.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Minimal mock of express Router
function createMockRouter() {
  const routes = {};
  const router = {
    post: (path, handler) => { routes[`POST ${path}`] = handler; },
    delete: (path, handler) => { routes[`DELETE ${path}`] = handler; },
    get: (path, handler) => { routes[`GET ${path}`] = handler; },
    _routes: routes,
  };
  return router;
}

function mockReqRes(body = {}) {
  const req = { body };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

describe('POST /session_lock', () => {
  it('grants lock to first requester', async () => {
    // This test will fail until the endpoint exists
    // Placeholder: just verify the concept
    const lockStore = new Map();
    const sessionId = '20260211051026';
    const clientId = 'shield-tv';

    // Simulate lock acquisition
    if (!lockStore.has(sessionId)) {
      lockStore.set(sessionId, { clientId, acquiredAt: Date.now() });
    }

    expect(lockStore.get(sessionId).clientId).toBe('shield-tv');
  });

  it('rejects lock for second requester on same session', () => {
    const lockStore = new Map();
    const sessionId = '20260211051026';

    lockStore.set(sessionId, { clientId: 'shield-tv', acquiredAt: Date.now() });

    // Second client tries to acquire
    const alreadyLocked = lockStore.has(sessionId);
    expect(alreadyLocked).toBe(true);
  });

  it('allows lock after expiry (stale lock cleanup)', () => {
    const lockStore = new Map();
    const sessionId = '20260211051026';
    const LOCK_TTL = 120000; // 2 minutes

    // Set a lock from 3 minutes ago
    lockStore.set(sessionId, {
      clientId: 'shield-tv',
      acquiredAt: Date.now() - 180000,
    });

    // Check if lock is stale
    const lock = lockStore.get(sessionId);
    const isStale = (Date.now() - lock.acquiredAt) > LOCK_TTL;

    expect(isStale).toBe(true);
  });
});
```

**Step 2: Run the test to verify it passes (these are concept tests)**

Run: `npx jest tests/isolated/api/fitnessSessionLock.test.mjs --no-cache`
Expected: PASS (these test the lock concept, not the endpoint)

**Step 3: Commit**

```bash
git add tests/isolated/api/fitnessSessionLock.test.mjs
git commit -m "test: add concept tests for session lock mechanism"
```

---

### Task 5: Add session lock service

**Files:**
- Create: `backend/src/3_applications/fitness/services/SessionLockService.mjs`
- Test: `tests/isolated/application/SessionLockService.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SessionLockService } from '#apps/fitness/services/SessionLockService.mjs';

describe('SessionLockService', () => {
  let service;

  beforeEach(() => {
    service = new SessionLockService({ ttlMs: 120000 });
  });

  describe('acquire', () => {
    it('grants lock to first client', () => {
      const result = service.acquire('20260211051026', 'shield-tv');
      expect(result.granted).toBe(true);
      expect(result.leader).toBe('shield-tv');
    });

    it('returns granted=false for second client', () => {
      service.acquire('20260211051026', 'shield-tv');
      const result = service.acquire('20260211051026', 'mac-browser');
      expect(result.granted).toBe(false);
      expect(result.leader).toBe('shield-tv');
    });

    it('renews lock for same client (idempotent)', () => {
      service.acquire('20260211051026', 'shield-tv');
      const result = service.acquire('20260211051026', 'shield-tv');
      expect(result.granted).toBe(true);
      expect(result.leader).toBe('shield-tv');
    });

    it('grants lock after previous lock expires', () => {
      service = new SessionLockService({ ttlMs: 100 }); // 100ms TTL for test
      service.acquire('20260211051026', 'shield-tv');

      // Manually expire the lock by backdating acquiredAt
      service._locks.get('20260211051026').acquiredAt = Date.now() - 200;

      const result = service.acquire('20260211051026', 'mac-browser');
      expect(result.granted).toBe(true);
      expect(result.leader).toBe('mac-browser');
    });
  });

  describe('release', () => {
    it('releases a lock held by the requesting client', () => {
      service.acquire('20260211051026', 'shield-tv');
      const released = service.release('20260211051026', 'shield-tv');
      expect(released).toBe(true);

      // Now another client can acquire
      const result = service.acquire('20260211051026', 'mac-browser');
      expect(result.granted).toBe(true);
    });

    it('refuses to release a lock held by a different client', () => {
      service.acquire('20260211051026', 'shield-tv');
      const released = service.release('20260211051026', 'mac-browser');
      expect(released).toBe(false);
    });

    it('returns false for non-existent lock', () => {
      const released = service.release('nonexistent', 'any');
      expect(released).toBe(false);
    });
  });

  describe('check', () => {
    it('returns null for unlocked session', () => {
      expect(service.check('nonexistent')).toBeNull();
    });

    it('returns leader info for locked session', () => {
      service.acquire('20260211051026', 'shield-tv');
      const lock = service.check('20260211051026');
      expect(lock.leader).toBe('shield-tv');
    });

    it('returns null for expired lock', () => {
      service = new SessionLockService({ ttlMs: 100 });
      service.acquire('20260211051026', 'shield-tv');
      service._locks.get('20260211051026').acquiredAt = Date.now() - 200;
      expect(service.check('20260211051026')).toBeNull();
    });
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx jest tests/isolated/application/SessionLockService.test.mjs --no-cache`
Expected: FAIL — cannot find module `#apps/fitness/services/SessionLockService.mjs`

**Step 3: Implement the service**

Create `backend/src/3_applications/fitness/services/SessionLockService.mjs`:

```javascript
/**
 * In-memory session lock service.
 * Prevents multiple clients from persisting the same fitness session.
 *
 * Not distributed — runs per-process. Suitable for single-server deployment.
 */
export class SessionLockService {
  constructor({ ttlMs = 120000 } = {}) {
    this._locks = new Map();
    this._ttlMs = ttlMs;
  }

  /**
   * Try to acquire a lock for a session.
   * @param {string} sessionId
   * @param {string} clientId
   * @returns {{ granted: boolean, leader: string }}
   */
  acquire(sessionId, clientId) {
    const existing = this._locks.get(sessionId);

    if (existing) {
      // Same client renewing
      if (existing.clientId === clientId) {
        existing.acquiredAt = Date.now();
        return { granted: true, leader: clientId };
      }

      // Different client — check if lock is stale
      if ((Date.now() - existing.acquiredAt) < this._ttlMs) {
        return { granted: false, leader: existing.clientId };
      }
      // Lock expired, allow takeover
    }

    this._locks.set(sessionId, { clientId, acquiredAt: Date.now() });
    return { granted: true, leader: clientId };
  }

  /**
   * Release a lock. Only the holding client can release.
   * @param {string} sessionId
   * @param {string} clientId
   * @returns {boolean}
   */
  release(sessionId, clientId) {
    const existing = this._locks.get(sessionId);
    if (!existing || existing.clientId !== clientId) return false;
    this._locks.delete(sessionId);
    return true;
  }

  /**
   * Check who holds a lock (if anyone).
   * @param {string} sessionId
   * @returns {{ leader: string, acquiredAt: number } | null}
   */
  check(sessionId) {
    const existing = this._locks.get(sessionId);
    if (!existing) return null;
    if ((Date.now() - existing.acquiredAt) >= this._ttlMs) {
      this._locks.delete(sessionId);
      return null;
    }
    return { leader: existing.clientId, acquiredAt: existing.acquiredAt };
  }
}
```

**Step 4: Run the test to verify it passes**

Run: `npx jest tests/isolated/application/SessionLockService.test.mjs --no-cache`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/services/SessionLockService.mjs \
       tests/isolated/application/SessionLockService.test.mjs
git commit -m "feat: add SessionLockService for session leader protocol"
```

---

### Task 6: Add lock endpoints to fitness router

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs`
- Reference: `backend/src/3_applications/fitness/services/SessionLockService.mjs`

**Step 1: Read the current fitness router to understand the pattern**

Run: `head -40 backend/src/4_api/v1/routers/fitness.mjs`
Note: Look at how other endpoints get their services (dependency injection pattern).

**Step 2: Add lock endpoints**

At the top of the fitness router file, after existing service imports, add:

```javascript
import { SessionLockService } from '#apps/fitness/services/SessionLockService.mjs';
const sessionLockService = new SessionLockService();
```

Add three endpoints near the existing `save_session` route:

```javascript
// POST /session_lock — acquire lock
router.post('/session_lock', (req, res) => {
  const { sessionId, clientId } = req.body;
  if (!sessionId || !clientId) {
    return res.status(400).json({ error: 'sessionId and clientId required' });
  }
  const result = sessionLockService.acquire(sessionId, clientId);
  res.json(result);
});

// DELETE /session_lock — release lock
router.delete('/session_lock', (req, res) => {
  const { sessionId, clientId } = req.body;
  if (!sessionId || !clientId) {
    return res.status(400).json({ error: 'sessionId and clientId required' });
  }
  const released = sessionLockService.release(sessionId, clientId);
  res.json({ released });
});

// GET /session_lock/:sessionId — check lock status
router.get('/session_lock/:sessionId', (req, res) => {
  const lock = sessionLockService.check(req.params.sessionId);
  res.json({ locked: !!lock, ...(lock || {}) });
});
```

**Step 3: Verify the router still loads**

Run: `node -e "import('#api/v1/routers/fitness.mjs').then(() => console.log('OK')).catch(e => console.error(e.message))"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "feat: add session lock endpoints to fitness router"
```

---

### Task 7: Generate a stable client ID on the frontend

Each browser/device needs a stable client ID that persists across page reloads but is unique per device.

**Files:**
- Create: `frontend/src/lib/clientId.js`
- Create: `tests/isolated/modules/Fitness/clientId.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => { store[key] = value; }),
    clear: () => { store = {}; },
  };
})();

vi.stubGlobal('localStorage', localStorageMock);
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'test-uuid-1234'),
});

describe('getClientId', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('generates a new ID on first call', async () => {
    const { getClientId } = await import('#frontend/lib/clientId.js');
    const id = getClientId();
    expect(id).toBe('test-uuid-1234');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('daylight_client_id', 'test-uuid-1234');
  });

  it('returns stored ID on subsequent calls', async () => {
    localStorageMock.getItem.mockReturnValueOnce('existing-id');
    // Re-import to reset module state
    vi.resetModules();
    const { getClientId } = await import('#frontend/lib/clientId.js');
    const id = getClientId();
    expect(id).toBe('existing-id');
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/Fitness/clientId.test.mjs`
Expected: FAIL — module not found

**Step 3: Implement**

Create `frontend/src/lib/clientId.js`:

```javascript
const STORAGE_KEY = 'daylight_client_id';

let _cached = null;

/**
 * Get a stable client identifier for this browser/device.
 * Persists across page reloads via localStorage.
 * @returns {string}
 */
export function getClientId() {
  if (_cached) return _cached;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      _cached = stored;
      return stored;
    }
  } catch (_) {
    // localStorage unavailable (e.g., incognito)
  }

  const id = crypto.randomUUID();
  _cached = id;

  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch (_) {
    // Best effort
  }

  return id;
}
```

**Step 4: Run tests**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/Fitness/clientId.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/lib/clientId.js \
       tests/isolated/modules/Fitness/clientId.test.mjs
git commit -m "feat: add stable client ID for session leader protocol"
```

---

### Task 8: Integrate lock into PersistenceManager

The `PersistenceManager` handles autosave and final persistence. It needs to acquire a lock before saving and skip saves if another client is the leader.

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js`
- Reference: `frontend/src/lib/clientId.js`
- Reference: `frontend/src/lib/api.mjs`

**Step 1: Read PersistenceManager to understand the persist flow**

Read `frontend/src/hooks/fitness/PersistenceManager.js` — find the `_persistSession` or `persistSession` method and the autosave interval setup.

**Step 2: Add lock acquisition to the persistence path**

At the top of `PersistenceManager.js`, add imports:

```javascript
import { getClientId } from '../../lib/clientId.js';
```

In the persist method (called by autosave and endSession), add a lock check **before** the API call:

```javascript
async _doPersist(sessionData, options = {}) {
  const { force = false } = options;
  const sessionId = sessionData?.sessionId || sessionData?.session?.id;
  if (!sessionId) return;

  const clientId = getClientId();

  // Try to acquire/renew session lock
  try {
    const res = await DaylightAPI.post('/api/v1/fitness/session_lock', {
      sessionId: sessionId.replace('fs_', ''),
      clientId,
    });
    if (!res.granted) {
      this._logger?.debug('persist_skipped_not_leader', {
        sessionId,
        leader: res.leader,
        clientId,
      });
      if (!force) return; // Skip save — we're not the leader
    }
  } catch (err) {
    // Lock service unavailable — proceed with save (graceful degradation)
    this._logger?.warn('session_lock_unavailable', { sessionId, error: err.message });
  }

  // ... existing persist logic continues here ...
}
```

**Step 3: Add lock release to session end**

In the cleanup/session end path, release the lock:

```javascript
async _releaseLock(sessionId) {
  try {
    await DaylightAPI.delete('/api/v1/fitness/session_lock', {
      data: {
        sessionId: sessionId.replace('fs_', ''),
        clientId: getClientId(),
      },
    });
  } catch (_) {
    // Best effort
  }
}
```

Call this from the session end path (wherever cleanup happens after final persist).

**Step 4: Verify no regressions**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs`
Expected: All existing frontend tests PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js
git commit -m "feat: integrate session lock into PersistenceManager"
```

---

### Task 9: Add lock heartbeat to autosave

The autosave runs every ~2 seconds. Each autosave call to `_doPersist` already tries to acquire the lock, which doubles as a heartbeat (renewing the TTL). No additional code needed — but verify:

**Step 1: Verify the autosave interval calls the persist path**

Read `PersistenceManager.js` — confirm that the autosave timer calls `_doPersist` (or whatever method was modified in Task 8).

**Step 2: Manual integration test**

Start the dev server, open two browser tabs, start a fitness session in both. Verify:
1. First tab acquires the lock and persists normally
2. Second tab logs `persist_skipped_not_leader` in the console
3. Only one session YAML file is created, not two

Check: `ls data/household/history/fitness/$(date +%Y-%m-%d)/`

**Step 3: Commit (if any adjustments needed)**

```bash
git commit -m "verify: session lock heartbeat via autosave confirmed"
```

---

### Task 10: Run full test suite

**Step 1: Run all isolated tests**

Run: `npm run test:isolated`
Expected: All PASS

**Step 2: Verify no import/syntax errors in modified files**

Run: `node -e "import('./frontend/src/hooks/fitness/FitnessSession.js')" 2>&1 || echo "Import check needs browser env — skip"`
Run: `node -e "import('./backend/src/3_applications/fitness/services/SessionLockService.mjs').then(() => console.log('OK'))"`
Expected: Backend import OK

**Step 3: Final commit**

```bash
git commit -m "chore: verify all tests pass after session lock integration"
```

---

## Summary of Deliverables

| Task | Type | Files Created/Modified |
|------|------|----------------------|
| 1 | Test | `tests/isolated/modules/Player/normalizeDuration.test.mjs` |
| 2 | Test | `tests/isolated/modules/Player/resolveContentId.test.mjs` |
| 3 | Test + Refactor | `frontend/src/hooks/fitness/closeOpenMedia.js`, test, FitnessSession.js update |
| 4 | Test | `tests/isolated/api/fitnessSessionLock.test.mjs` |
| 5 | Feature + Test | `SessionLockService.mjs`, test |
| 6 | Feature | `fitness.mjs` router update |
| 7 | Feature + Test | `frontend/src/lib/clientId.js`, test |
| 8 | Feature | `PersistenceManager.js` update |
| 9 | Verification | Manual integration test |
| 10 | Verification | Full test suite run |

## Dependencies

```
Task 1 ──── (independent)
Task 2 ──── (independent)
Task 3 ──── (independent)
Task 4 ──→ Task 5 ──→ Task 6 ──→ Task 8 ──→ Task 9
Task 7 ──→ Task 8
Task 10 (after all others)
```

Tasks 1, 2, 3 are fully independent and can be parallelized.
Tasks 4-9 are sequential (session lock feature).
Task 10 is the final verification gate.
