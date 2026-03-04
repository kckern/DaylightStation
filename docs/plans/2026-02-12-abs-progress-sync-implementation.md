# ABS Bidirectional Progress Sync - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bidirectional sync of audiobook playback position and finished state between DaylightStation and Audiobookshelf, with jump-skepticism and bookmark safety net.

**Architecture:** Two pure domain functions handle conflict resolution and committability checks. A stateful application service orchestrates debounced writes to ABS, skeptical jump tracking, and session bookmarks. The play router delegates to this service for ABS items only, with null-guard degradation when ABS is unconfigured.

**Tech Stack:** Node.js ESM, Jest (with `@jest/globals`), Express router, YAML persistence, Audiobookshelf REST API

**Design doc:** `docs/plans/2026-02-12-abs-progress-sync-design.md`

---

### Task 1: Domain — `resolveProgressConflict` (pure function)

**Files:**
- Create: `backend/src/2_domains/content/services/resolveProgressConflict.mjs`
- Test: `tests/isolated/domain/content/resolveProgressConflict.test.mjs`

**Step 1: Write the failing tests**

Create `tests/isolated/domain/content/resolveProgressConflict.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { resolveProgressConflict } from '#domains/content/services/resolveProgressConflict.mjs';

describe('resolveProgressConflict', () => {
  // Rule 1: Null handling
  describe('null handling', () => {
    it('returns local when remote is null', () => {
      const local = { playhead: 300, duration: 1000, isWatched: false, lastPlayed: '2026-02-12T10:00:00Z', watchTime: 100 };
      const result = resolveProgressConflict(local, null);
      expect(result.source).toBe('local');
      expect(result.playhead).toBe(300);
    });

    it('returns remote when local is null', () => {
      const remote = { currentTime: 500, isFinished: false, lastUpdate: 1739354400, duration: 1000 };
      const result = resolveProgressConflict(null, remote);
      expect(result.source).toBe('remote');
      expect(result.playhead).toBe(500);
    });

    it('returns null when both are null', () => {
      const result = resolveProgressConflict(null, null);
      expect(result).toBeNull();
    });
  });

  // Rule 2: Sanity guard — reject zero when other side has >60s
  describe('sanity guard', () => {
    it('rejects remote zero when local has >60s playhead', () => {
      const local = { playhead: 300, duration: 1000, isWatched: false, lastPlayed: '2026-02-10T10:00:00Z', watchTime: 100 };
      const remote = { currentTime: 0, isFinished: false, lastUpdate: 1739440800, duration: 1000 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('local');
      expect(result.playhead).toBe(300);
    });

    it('rejects local zero when remote has >60s playhead', () => {
      const local = { playhead: 0, duration: 1000, isWatched: false, lastPlayed: '2026-02-12T10:00:00Z', watchTime: 0 };
      const remote = { currentTime: 500, isFinished: false, lastUpdate: 1739354400, duration: 1000 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('remote');
      expect(result.playhead).toBe(500);
    });

    it('allows zero when other side is under 60s', () => {
      const local = { playhead: 30, duration: 1000, isWatched: false, lastPlayed: '2026-02-10T10:00:00Z', watchTime: 10 };
      const remote = { currentTime: 0, isFinished: false, lastUpdate: 1739440800, duration: 1000 };
      // Zero isn't rejected, so latest-timestamp rule kicks in
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('remote');
    });
  });

  // Rule 3: Finished propagation
  describe('finished propagation', () => {
    it('propagates finished from remote', () => {
      const local = { playhead: 500, duration: 1000, isWatched: false, lastPlayed: '2026-02-12T10:00:00Z', watchTime: 300 };
      const remote = { currentTime: 950, isFinished: true, lastUpdate: 1739354400, duration: 1000 };
      const result = resolveProgressConflict(local, remote);
      expect(result.isFinished).toBe(true);
    });

    it('propagates finished from local (isWatched)', () => {
      const local = { playhead: 950, duration: 1000, isWatched: true, lastPlayed: '2026-02-10T10:00:00Z', watchTime: 900 };
      const remote = { currentTime: 500, isFinished: false, lastUpdate: 1739440800, duration: 1000 };
      const result = resolveProgressConflict(local, remote);
      expect(result.isFinished).toBe(true);
    });
  });

  // Rule 4: Latest timestamp wins
  describe('latest timestamp wins', () => {
    it('uses remote when remote is newer', () => {
      const local = { playhead: 300, duration: 1000, isWatched: false, lastPlayed: '2026-02-10T10:00:00Z', watchTime: 100 };
      const remote = { currentTime: 500, isFinished: false, lastUpdate: 1739440800, duration: 1000 }; // Feb 13
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('remote');
      expect(result.playhead).toBe(500);
    });

    it('uses local when local is newer', () => {
      const local = { playhead: 700, duration: 1000, isWatched: false, lastPlayed: '2026-02-13T10:00:00Z', watchTime: 400 };
      const remote = { currentTime: 500, isFinished: false, lastUpdate: 1739354400, duration: 1000 }; // Feb 12
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('local');
      expect(result.playhead).toBe(700);
    });
  });

  // Rule 5: Tie-breaker — furthest playhead
  describe('tie-breaker', () => {
    it('uses furthest playhead when timestamps are equal', () => {
      const ts = '2026-02-12T10:00:00Z';
      const epoch = Date.parse(ts) / 1000;
      const local = { playhead: 300, duration: 1000, isWatched: false, lastPlayed: ts, watchTime: 100 };
      const remote = { currentTime: 700, isFinished: false, lastUpdate: epoch, duration: 1000 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('remote');
      expect(result.playhead).toBe(700);
    });

    it('uses furthest playhead when timestamps are missing', () => {
      const local = { playhead: 800, duration: 1000, isWatched: false, lastPlayed: null, watchTime: 500 };
      const remote = { currentTime: 300, isFinished: false, lastUpdate: null, duration: 1000 };
      const result = resolveProgressConflict(local, remote);
      expect(result.source).toBe('local');
      expect(result.playhead).toBe(800);
    });
  });

  // Output shape
  describe('output shape', () => {
    it('returns playhead, duration, isFinished, source', () => {
      const local = { playhead: 300, duration: 1000, isWatched: false, lastPlayed: '2026-02-12T10:00:00Z', watchTime: 100 };
      const result = resolveProgressConflict(local, null);
      expect(result).toEqual(expect.objectContaining({
        playhead: expect.any(Number),
        duration: expect.any(Number),
        isFinished: expect.any(Boolean),
        source: expect.stringMatching(/^(local|remote)$/)
      }));
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/content/resolveProgressConflict.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `backend/src/2_domains/content/services/resolveProgressConflict.mjs`:

```javascript
/**
 * Resolve a progress conflict between DS local state and ABS remote state.
 *
 * Rules (evaluated in order):
 * 1. Null handling — use whichever exists
 * 2. Sanity guard — reject zero when opposite side has >60s
 * 3. Finished propagation — finished wins (books don't un-finish)
 * 4. Latest timestamp wins
 * 5. Tie-breaker — furthest playhead
 *
 * @param {Object|null} local  - DS media_memory progress
 * @param {Object|null} remote - ABS progress { currentTime, isFinished, lastUpdate, duration }
 * @returns {{ playhead: number, duration: number, isFinished: boolean, source: 'local'|'remote' } | null}
 */
export function resolveProgressConflict(local, remote) {
  // Rule 1: Null handling
  if (!local && !remote) return null;
  if (!local) return _fromRemote(remote);
  if (!remote) return _fromLocal(local);

  const localPlayhead = local.playhead ?? 0;
  const remotePlayhead = remote.currentTime ?? 0;

  // Rule 2: Sanity guard — reject zero when other side has >60s
  if (remotePlayhead === 0 && localPlayhead > 60) return _fromLocal(local);
  if (localPlayhead === 0 && remotePlayhead > 60) return _fromRemote(remote);

  // Rule 3: Finished propagation
  const localFinished = local.isWatched === true;
  const remoteFinished = remote.isFinished === true;
  if (localFinished || remoteFinished) {
    // Use the finished side's data, or the one further along
    const winner = localPlayhead >= remotePlayhead ? _fromLocal(local) : _fromRemote(remote);
    winner.isFinished = true;
    return winner;
  }

  // Rule 4: Latest timestamp wins
  const localTs = local.lastPlayed ? Date.parse(local.lastPlayed) : null;
  const remoteTs = remote.lastUpdate != null ? remote.lastUpdate * 1000 : null;

  if (localTs != null && remoteTs != null && localTs !== remoteTs) {
    return localTs > remoteTs ? _fromLocal(local) : _fromRemote(remote);
  }

  // Rule 5: Tie-breaker — furthest playhead
  return localPlayhead >= remotePlayhead ? _fromLocal(local) : _fromRemote(remote);
}

function _fromLocal(local) {
  return {
    playhead: local.playhead ?? 0,
    duration: local.duration ?? 0,
    isFinished: local.isWatched === true,
    source: 'local'
  };
}

function _fromRemote(remote) {
  return {
    playhead: remote.currentTime ?? 0,
    duration: remote.duration ?? 0,
    isFinished: remote.isFinished === true,
    source: 'remote'
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/content/resolveProgressConflict.test.mjs --verbose`
Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/services/resolveProgressConflict.mjs tests/isolated/domain/content/resolveProgressConflict.test.mjs
git commit -m "feat(abs-sync): add resolveProgressConflict domain function"
```

---

### Task 2: Domain — `isProgressCommittable` (pure function)

**Files:**
- Create: `backend/src/2_domains/content/services/isProgressCommittable.mjs`
- Test: `tests/isolated/domain/content/isProgressCommittable.test.mjs`

**Step 1: Write the failing tests**

Create `tests/isolated/domain/content/isProgressCommittable.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { isProgressCommittable } from '#domains/content/services/isProgressCommittable.mjs';

describe('isProgressCommittable', () => {
  describe('small jumps (≤5 minutes)', () => {
    it('commits when jump is within 5 minutes', () => {
      const result = isProgressCommittable({ sessionWatchTime: 0, lastCommittedPlayhead: 100, newPlayhead: 200 });
      expect(result.committable).toBe(true);
    });

    it('commits backward jump within 5 minutes (30s rewind button)', () => {
      const result = isProgressCommittable({ sessionWatchTime: 0, lastCommittedPlayhead: 200, newPlayhead: 170 });
      expect(result.committable).toBe(true);
    });

    it('commits exactly at 5-minute boundary', () => {
      const result = isProgressCommittable({ sessionWatchTime: 0, lastCommittedPlayhead: 0, newPlayhead: 300 });
      expect(result.committable).toBe(true);
    });
  });

  describe('large jumps (>5 minutes)', () => {
    it('rejects immediate large jump', () => {
      const result = isProgressCommittable({ sessionWatchTime: 0, lastCommittedPlayhead: 100, newPlayhead: 1000 });
      expect(result.committable).toBe(false);
      expect(result.skeptical).toBe(true);
    });

    it('rejects at 59s of watch time after large jump', () => {
      const result = isProgressCommittable({ sessionWatchTime: 59, lastCommittedPlayhead: 100, newPlayhead: 1000 });
      expect(result.committable).toBe(false);
    });

    it('commits after 60s of continuous listening at new position', () => {
      const result = isProgressCommittable({ sessionWatchTime: 60, lastCommittedPlayhead: 100, newPlayhead: 1000 });
      expect(result.committable).toBe(true);
    });

    it('commits with more than 60s of watch time', () => {
      const result = isProgressCommittable({ sessionWatchTime: 120, lastCommittedPlayhead: 100, newPlayhead: 1000 });
      expect(result.committable).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles zero lastCommittedPlayhead', () => {
      const result = isProgressCommittable({ sessionWatchTime: 0, lastCommittedPlayhead: 0, newPlayhead: 50 });
      expect(result.committable).toBe(true);
    });

    it('handles large backward jump', () => {
      const result = isProgressCommittable({ sessionWatchTime: 0, lastCommittedPlayhead: 5000, newPlayhead: 100 });
      expect(result.committable).toBe(false);
      expect(result.skeptical).toBe(true);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/content/isProgressCommittable.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `backend/src/2_domains/content/services/isProgressCommittable.mjs`:

```javascript
const SMALL_JUMP_THRESHOLD = 300; // 5 minutes in seconds
const SKEPTICAL_WATCH_REQUIREMENT = 60; // 60 seconds of continuous listening

/**
 * Determine whether a progress update should be trusted and persisted.
 *
 * If the user jumps >5 minutes from last committed position, we enter
 * "skeptical" mode and require 60s of continuous listening before committing.
 * Small jumps (≤5 min) commit immediately — they represent chapter skips
 * or 30s forward/back buttons.
 *
 * @param {Object} params
 * @param {number} params.sessionWatchTime - Seconds of watch time accumulated since the jump
 * @param {number} params.lastCommittedPlayhead - Last committed playhead position
 * @param {number} params.newPlayhead - Proposed new playhead position
 * @returns {{ committable: boolean, skeptical?: boolean }}
 */
export function isProgressCommittable({ sessionWatchTime, lastCommittedPlayhead, newPlayhead }) {
  const jumpDistance = Math.abs(newPlayhead - lastCommittedPlayhead);

  if (jumpDistance <= SMALL_JUMP_THRESHOLD) {
    return { committable: true };
  }

  // Large jump — require proof of continuous listening
  if (sessionWatchTime >= SKEPTICAL_WATCH_REQUIREMENT) {
    return { committable: true };
  }

  return { committable: false, skeptical: true };
}
```

**Step 4: Run tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/content/isProgressCommittable.test.mjs --verbose`
Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/services/isProgressCommittable.mjs tests/isolated/domain/content/isProgressCommittable.test.mjs
git commit -m "feat(abs-sync): add isProgressCommittable domain function"
```

---

### Task 3: Entity — Add `bookmark` field to MediaProgress

**Files:**
- Modify: `backend/src/2_domains/content/entities/MediaProgress.mjs`
- Test: `tests/isolated/domain/content/MediaProgress.bookmark.test.mjs`

**Step 1: Write the failing tests**

Create `tests/isolated/domain/content/MediaProgress.bookmark.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';

describe('MediaProgress bookmark', () => {
  it('stores bookmark when provided', () => {
    const bookmark = { playhead: 500, reason: 'session-start', createdAt: '2026-02-12T10:00:00Z' };
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000, bookmark });
    expect(progress.bookmark).toEqual(bookmark);
  });

  it('defaults bookmark to null when not provided', () => {
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000 });
    expect(progress.bookmark).toBeNull();
  });

  it('includes bookmark in toJSON when present', () => {
    const bookmark = { playhead: 500, reason: 'pre-jump', createdAt: '2026-02-12T10:00:00Z' };
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000, bookmark });
    const json = progress.toJSON();
    expect(json.bookmark).toEqual(bookmark);
  });

  it('omits bookmark from toJSON when null', () => {
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000 });
    const json = progress.toJSON();
    expect(json).not.toHaveProperty('bookmark');
  });

  it('ignores expired bookmarks (>7 days old)', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const bookmark = { playhead: 500, reason: 'session-start', createdAt: eightDaysAgo };
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000, bookmark });
    expect(progress.bookmark).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/content/MediaProgress.bookmark.test.mjs --verbose`
Expected: FAIL — `progress.bookmark` is undefined

**Step 3: Modify MediaProgress entity**

Edit `backend/src/2_domains/content/entities/MediaProgress.mjs`:

In the constructor, after `this._storedPercent = props.percent ?? null;` (line 31), add:

```javascript
    // Bookmark for position recovery (optional, expires after 7 days)
    const rawBookmark = props.bookmark ?? null;
    if (rawBookmark && rawBookmark.createdAt) {
      const age = Date.now() - Date.parse(rawBookmark.createdAt);
      this.bookmark = age <= 7 * 24 * 60 * 60 * 1000 ? rawBookmark : null;
    } else {
      this.bookmark = rawBookmark;
    }
```

In `toJSON()`, after `watchTime: this.watchTime` (line 73), add bookmark conditionally:

```javascript
  toJSON() {
    const json = {
      itemId: this.itemId,
      playhead: this.playhead,
      duration: this.duration,
      percent: this.percent,
      playCount: this.playCount,
      lastPlayed: this.lastPlayed,
      watchTime: this.watchTime
    };
    if (this.bookmark) json.bookmark = this.bookmark;
    return json;
  }
```

**Step 4: Run tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/content/MediaProgress.bookmark.test.mjs --verbose`
Expected: All PASS

**Step 5: Run existing MediaProgress-dependent tests to check for regressions**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/mediaMemory.unit.test.mjs tests/unit/domains/content/Readable.test.mjs --verbose`
Expected: All PASS (no regressions)

**Step 6: Commit**

```bash
git add backend/src/2_domains/content/entities/MediaProgress.mjs tests/isolated/domain/content/MediaProgress.bookmark.test.mjs
git commit -m "feat(abs-sync): add bookmark field to MediaProgress entity"
```

---

### Task 4: Adapter — Schema + YAML persistence bookmark support

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/mediaProgressSchema.mjs` (line 13-20)
- Modify: `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs` (line 86-96)
- Test: `tests/isolated/adapter/persistence/YamlMediaProgressBookmark.test.mjs`

**Step 1: Write the failing tests**

Create `tests/isolated/adapter/persistence/YamlMediaProgressBookmark.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { CANONICAL_FIELDS } from '#adapters/persistence/yaml/mediaProgressSchema.mjs';

describe('mediaProgressSchema — bookmark support', () => {
  it('includes bookmark in canonical fields', () => {
    expect(CANONICAL_FIELDS).toContain('bookmark');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/adapter/persistence/YamlMediaProgressBookmark.test.mjs --verbose`
Expected: FAIL — `bookmark` not in CANONICAL_FIELDS

**Step 3: Add `bookmark` to CANONICAL_FIELDS**

Edit `backend/src/1_adapters/persistence/yaml/mediaProgressSchema.mjs` line 13-20. Add `'bookmark'` to the array:

```javascript
export const CANONICAL_FIELDS = Object.freeze([
  'playhead',
  'duration',
  'percent',
  'playCount',
  'lastPlayed',
  'watchTime',
  'bookmark'
]);
```

**Step 4: Pass bookmark through in `_toDomainEntity`**

Edit `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs` line 86-96. Add `bookmark`:

```javascript
  _toDomainEntity(itemId, data) {
    return new MediaProgress({
      itemId,
      playhead: data.playhead ?? 0,
      duration: data.duration ?? 0,
      percent: data.percent ?? null,
      playCount: data.playCount ?? 0,
      lastPlayed: data.lastPlayed ?? null,
      watchTime: data.watchTime ?? 0,
      bookmark: data.bookmark ?? null
    });
  }
```

**Step 5: Run tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/adapter/persistence/YamlMediaProgressBookmark.test.mjs --verbose`
Expected: All PASS

**Step 6: Run existing tests to check for regressions**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/mediaMemory.unit.test.mjs --verbose`
Expected: All PASS

**Step 7: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/mediaProgressSchema.mjs backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs tests/isolated/adapter/persistence/YamlMediaProgressBookmark.test.mjs
git commit -m "feat(abs-sync): add bookmark support to schema and YAML persistence"
```

---

### Task 5: Application — `ABSProgressSyncService`

**Files:**
- Create: `backend/src/3_applications/content/services/ABSProgressSyncService.mjs`
- Test: `tests/isolated/application/content/ABSProgressSyncService.test.mjs`

This is the largest task. The service has three methods: `reconcileOnPlay`, `onProgressUpdate`, `flush`.

**Step 1: Write the failing tests**

Create `tests/isolated/application/content/ABSProgressSyncService.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { ABSProgressSyncService } from '#apps/content/services/ABSProgressSyncService.mjs';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';

// Stub dependencies
function createMockAbsClient() {
  return {
    getProgress: jest.fn(),
    updateProgress: jest.fn()
  };
}

function createMockMediaProgressMemory() {
  const store = new Map();
  return {
    get: jest.fn(async (itemId) => store.get(itemId) || null),
    set: jest.fn(async (state) => store.set(state.itemId, state)),
    _store: store
  };
}

describe('ABSProgressSyncService', () => {
  let service, absClient, memory;

  beforeEach(() => {
    absClient = createMockAbsClient();
    memory = createMockMediaProgressMemory();
    service = new ABSProgressSyncService({
      absClient,
      mediaProgressMemory: memory,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });
  });

  afterEach(() => {
    service.dispose();
  });

  describe('reconcileOnPlay', () => {
    it('returns local progress when ABS fetch fails', async () => {
      const localProgress = new MediaProgress({ itemId: 'abs:123', playhead: 300, duration: 1000, lastPlayed: '2026-02-12T10:00:00Z' });
      memory._store.set('abs:123', localProgress);
      absClient.getProgress.mockRejectedValue(new Error('Network error'));

      const result = await service.reconcileOnPlay('abs:123', 'abs', '123');
      expect(result).not.toBeNull();
      expect(result.playhead).toBe(300);
    });

    it('returns remote progress when local is null', async () => {
      absClient.getProgress.mockResolvedValue({ currentTime: 500, isFinished: false, lastUpdate: Date.now() / 1000, duration: 19766 });

      const result = await service.reconcileOnPlay('abs:123', 'abs', '123');
      expect(result.playhead).toBe(500);
    });

    it('saves session-start bookmark', async () => {
      const localProgress = new MediaProgress({ itemId: 'abs:123', playhead: 300, duration: 1000, lastPlayed: '2026-02-12T10:00:00Z' });
      memory._store.set('abs:123', localProgress);
      absClient.getProgress.mockResolvedValue({ currentTime: 300, isFinished: false, lastUpdate: Date.now() / 1000, duration: 1000 });

      await service.reconcileOnPlay('abs:123', 'abs', '123');

      // Check that set was called with a bookmark
      const setCalls = memory.set.mock.calls;
      expect(setCalls.length).toBeGreaterThan(0);
      const savedState = setCalls[setCalls.length - 1][0];
      expect(savedState.bookmark).toBeTruthy();
      expect(savedState.bookmark.reason).toBe('session-start');
    });

    it('updates local when remote wins', async () => {
      const localProgress = new MediaProgress({ itemId: 'abs:123', playhead: 300, duration: 1000, lastPlayed: '2026-02-10T10:00:00Z' });
      memory._store.set('abs:123', localProgress);
      absClient.getProgress.mockResolvedValue({ currentTime: 700, isFinished: false, lastUpdate: Date.now() / 1000, duration: 1000 });

      const result = await service.reconcileOnPlay('abs:123', 'abs', '123');
      expect(result.playhead).toBe(700);
      expect(memory.set).toHaveBeenCalled();
    });

    it('returns null when both are null and ABS returns 404-like', async () => {
      absClient.getProgress.mockResolvedValue(null);
      const result = await service.reconcileOnPlay('abs:123', 'abs', '123');
      expect(result).toBeNull();
    });
  });

  describe('onProgressUpdate', () => {
    it('buffers small jump for debounced ABS write', () => {
      // Initialize committed playhead by a reconcile
      service._skepticalMap.set('abs:123', { lastCommittedPlayhead: 100, watchTimeAccumulated: 0 });

      service.onProgressUpdate('abs:123', '123', { playhead: 200, duration: 1000, percent: 20, watchTime: 50 });

      // Should be in debounce map
      expect(service._debounceMap.has('abs:123')).toBe(true);
    });

    it('enters skeptical state on large jump', () => {
      service._skepticalMap.set('abs:123', { lastCommittedPlayhead: 100, watchTimeAccumulated: 0 });

      service.onProgressUpdate('abs:123', '123', { playhead: 5000, duration: 10000, percent: 50, watchTime: 0 });

      // Should NOT be in debounce map (not committed)
      expect(service._debounceMap.has('abs:123')).toBe(false);
    });

    it('commits after sufficient watch time post-jump', () => {
      service._skepticalMap.set('abs:123', { lastCommittedPlayhead: 100, watchTimeAccumulated: 0 });

      // Large jump — not committed
      service.onProgressUpdate('abs:123', '123', { playhead: 5000, duration: 10000, percent: 50, watchTime: 0 });
      expect(service._debounceMap.has('abs:123')).toBe(false);

      // Accumulate enough watch time
      service.onProgressUpdate('abs:123', '123', { playhead: 5060, duration: 10000, percent: 50, watchTime: 65 });
      expect(service._debounceMap.has('abs:123')).toBe(true);
    });
  });

  describe('flush', () => {
    it('writes all pending debounced updates', async () => {
      absClient.updateProgress.mockResolvedValue({});
      service._debounceMap.set('abs:123', {
        timer: null,
        localId: '123',
        latestProgress: { currentTime: 500, isFinished: false }
      });

      await service.flush();

      expect(absClient.updateProgress).toHaveBeenCalledWith('123', { currentTime: 500, isFinished: false });
      expect(service._debounceMap.size).toBe(0);
    });

    it('handles ABS errors during flush gracefully', async () => {
      absClient.updateProgress.mockRejectedValue(new Error('timeout'));
      service._debounceMap.set('abs:123', {
        timer: null,
        localId: '123',
        latestProgress: { currentTime: 500, isFinished: false }
      });

      // Should not throw
      await service.flush();
      expect(service._debounceMap.size).toBe(0);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/application/content/ABSProgressSyncService.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `backend/src/3_applications/content/services/ABSProgressSyncService.mjs`:

```javascript
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import { resolveProgressConflict } from '#domains/content/services/resolveProgressConflict.mjs';
import { isProgressCommittable } from '#domains/content/services/isProgressCommittable.mjs';

const DEBOUNCE_MS = 30_000;

/**
 * Orchestrates bidirectional progress sync between DS media_memory and Audiobookshelf.
 *
 * Stateful: maintains in-memory debounce and skeptical-jump maps.
 * No persistence needed — worst case on crash, ABS is ~30s behind,
 * fixed by next reconcileOnPlay.
 */
export class ABSProgressSyncService {
  /** @type {Map<string, { timer: any, localId: string, latestProgress: Object }>} */
  _debounceMap = new Map();

  /** @type {Map<string, { lastCommittedPlayhead: number, watchTimeAccumulated: number }>} */
  _skepticalMap = new Map();

  #absClient;
  #mediaProgressMemory;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.absClient - AudiobookshelfClient instance
   * @param {Object} deps.mediaProgressMemory - IMediaProgressMemory
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    this.#absClient = deps.absClient;
    this.#mediaProgressMemory = deps.mediaProgressMemory;
    this.#logger = deps.logger || console;
  }

  /**
   * Called on play start for ABS items. Reconciles DS vs ABS progress.
   *
   * @param {string} itemId - Compound ID (e.g. "abs:7e7da933")
   * @param {string} storagePath - YAML storage path (always "abs")
   * @param {string} localId - ABS-native item ID (e.g. "7e7da933")
   * @returns {Promise<MediaProgress|null>}
   */
  async reconcileOnPlay(itemId, storagePath, localId) {
    // Parallel fetch: local + remote
    const [local, remote] = await Promise.all([
      this.#mediaProgressMemory.get(itemId, storagePath),
      this.#fetchRemoteProgress(localId)
    ]);

    // Save session-start bookmark (captures position before playback begins)
    if (local && local.playhead > 0) {
      const bookmarked = new MediaProgress({
        ...local.toJSON(),
        bookmark: { playhead: local.playhead, reason: 'session-start', createdAt: new Date().toISOString() }
      });
      await this.#mediaProgressMemory.set(bookmarked, storagePath);
    }

    // Resolve conflict
    const resolution = resolveProgressConflict(
      local ? { playhead: local.playhead, duration: local.duration, isWatched: local.isWatched(), lastPlayed: local.lastPlayed, watchTime: local.watchTime } : null,
      remote
    );

    if (!resolution) return local || null;

    // Initialize skeptical tracking for this item
    this._skepticalMap.set(itemId, {
      lastCommittedPlayhead: resolution.playhead,
      watchTimeAccumulated: 0
    });

    if (resolution.source === 'remote') {
      // Update local with remote values
      const updated = new MediaProgress({
        itemId,
        playhead: resolution.playhead,
        duration: resolution.duration || local?.duration || 0,
        playCount: local?.playCount ?? 0,
        lastPlayed: new Date().toISOString(),
        watchTime: local?.watchTime ?? 0,
        bookmark: local?.bookmark ?? null
      });
      await this.#mediaProgressMemory.set(updated, storagePath);
      return updated;
    }

    // Local won — buffer write-back to ABS
    if (local) {
      this.#bufferABSWrite(itemId, localId, {
        currentTime: local.playhead,
        isFinished: local.isWatched()
      });
    }

    // Re-read to get the version with bookmark
    return await this.#mediaProgressMemory.get(itemId, storagePath) || local;
  }

  /**
   * Called on each progress update for ABS items. Handles skeptical-jump
   * tracking and debounced write-back to ABS.
   *
   * @param {string} itemId - Compound ID
   * @param {string} localId - ABS-native item ID
   * @param {Object} progressData - { playhead, duration, percent, watchTime }
   */
  onProgressUpdate(itemId, localId, progressData) {
    let tracking = this._skepticalMap.get(itemId);
    if (!tracking) {
      tracking = { lastCommittedPlayhead: 0, watchTimeAccumulated: 0 };
      this._skepticalMap.set(itemId, tracking);
    }

    const jumpDistance = Math.abs(progressData.playhead - tracking.lastCommittedPlayhead);

    // Large jump — save pre-jump bookmark (fire-and-forget)
    if (jumpDistance > 300 && tracking.lastCommittedPlayhead > 0) {
      this.#savePreJumpBookmark(itemId, tracking.lastCommittedPlayhead, progressData.duration);
      tracking.watchTimeAccumulated = progressData.watchTime || 0;
    } else {
      tracking.watchTimeAccumulated = progressData.watchTime || 0;
    }

    const { committable } = isProgressCommittable({
      sessionWatchTime: tracking.watchTimeAccumulated,
      lastCommittedPlayhead: tracking.lastCommittedPlayhead,
      newPlayhead: progressData.playhead
    });

    if (!committable) return;

    // Commit: update tracking and buffer ABS write
    tracking.lastCommittedPlayhead = progressData.playhead;
    tracking.watchTimeAccumulated = 0;

    const isFinished = (progressData.percent || 0) >= 90;
    this.#bufferABSWrite(itemId, localId, {
      currentTime: progressData.playhead,
      isFinished
    });
  }

  /**
   * Flush all pending debounced writes. Called on SIGTERM.
   * @param {number} [timeoutMs=5000]
   */
  async flush(timeoutMs = 5000) {
    const entries = [...this._debounceMap.entries()];
    this._debounceMap.clear();

    // Cancel timers
    for (const [, entry] of entries) {
      if (entry.timer) clearTimeout(entry.timer);
    }

    if (entries.length === 0) return;

    this.#logger.info?.('abs-sync.flush', { pendingCount: entries.length });

    const writePromises = entries.map(([itemId, entry]) =>
      Promise.race([
        this.#absClient.updateProgress(entry.localId, entry.latestProgress)
          .catch(err => this.#logger.error?.('abs-sync.flush.write_failed', { itemId, error: err.message })),
        new Promise(resolve => setTimeout(resolve, timeoutMs))
      ])
    );

    await Promise.allSettled(writePromises);
  }

  /**
   * Clean up timers. Call when service is no longer needed.
   */
  dispose() {
    for (const [, entry] of this._debounceMap) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this._debounceMap.clear();
    this._skepticalMap.clear();
  }

  // --- Private helpers ---

  async #fetchRemoteProgress(localId) {
    try {
      const data = await this.#absClient.getProgress(localId);
      return data || null;
    } catch (err) {
      this.#logger.warn?.('abs-sync.remote_fetch_failed', { localId, error: err.message });
      return null;
    }
  }

  #bufferABSWrite(itemId, localId, progress) {
    const existing = this._debounceMap.get(itemId);
    if (existing?.timer) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      this._debounceMap.delete(itemId);
      this.#absClient.updateProgress(localId, progress)
        .catch(err => this.#logger.error?.('abs-sync.debounce_write_failed', { itemId, error: err.message }));
    }, DEBOUNCE_MS);

    this._debounceMap.set(itemId, { timer, localId, latestProgress: progress });
  }

  async #savePreJumpBookmark(itemId, playhead, duration) {
    try {
      const existing = await this.#mediaProgressMemory.get(itemId, 'abs');
      if (!existing) return;

      const bookmarked = new MediaProgress({
        ...existing.toJSON(),
        bookmark: { playhead, reason: 'pre-jump', createdAt: new Date().toISOString() }
      });
      await this.#mediaProgressMemory.set(bookmarked, 'abs');
    } catch (err) {
      this.#logger.warn?.('abs-sync.bookmark_save_failed', { itemId, error: err.message });
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/application/content/ABSProgressSyncService.test.mjs --verbose`
Expected: All PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/services/ABSProgressSyncService.mjs tests/isolated/application/content/ABSProgressSyncService.test.mjs
git commit -m "feat(abs-sync): add ABSProgressSyncService application service"
```

---

### Task 6: API — Play router integration

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs` (lines 25-26, 108-199, 332-338, 386-391)
- Test: `tests/isolated/api/routers/play.absSync.test.mjs`

**Step 1: Write the failing tests**

Create `tests/isolated/api/routers/play.absSync.test.mjs`:

```javascript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createPlayRouter } from '#api/v1/routers/play.mjs';

// Minimal stub registry with an abs adapter
function createStubRegistry() {
  const absAdapter = {
    source: 'abs',
    getStoragePath: jest.fn(async () => 'abs'),
    getItem: jest.fn(async (localId) => ({
      id: `abs:${localId}`,
      mediaUrl: `/api/v1/proxy/abs/stream/${localId}`,
      mediaType: 'audio',
      title: 'Test Audiobook',
      duration: 19766,
      resumable: true,
      thumbnail: null,
      metadata: {}
    }))
  };
  return {
    get: jest.fn((source) => source === 'abs' ? absAdapter : null),
    _absAdapter: absAdapter
  };
}

function createStubContentIdResolver(registry) {
  return {
    resolve: jest.fn((compoundId) => {
      const colonIdx = compoundId.indexOf(':');
      if (colonIdx < 0) return null;
      const source = compoundId.slice(0, colonIdx);
      const localId = compoundId.slice(colonIdx + 1);
      const adapter = registry.get(source);
      return adapter ? { source, localId, adapter } : null;
    })
  };
}

function createStubMediaProgressMemory() {
  return {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {})
  };
}

function createStubAbsSyncService() {
  return {
    reconcileOnPlay: jest.fn(async (itemId, storagePath, localId) => null),
    onProgressUpdate: jest.fn()
  };
}

function buildApp(config) {
  const app = express();
  app.use(express.json());
  app.use('/play', createPlayRouter(config));
  return app;
}

describe('play router — ABS sync integration', () => {
  let registry, memory, resolver, syncService;

  beforeEach(() => {
    registry = createStubRegistry();
    memory = createStubMediaProgressMemory();
    resolver = createStubContentIdResolver(registry);
    syncService = createStubAbsSyncService();
  });

  describe('GET /play/abs:itemId — play start', () => {
    it('calls absSyncService.reconcileOnPlay for abs items', async () => {
      const app = buildApp({ registry, mediaProgressMemory: memory, contentIdResolver: resolver, absSyncService: syncService });

      await request(app).get('/play/abs:abc123').expect(200);

      expect(syncService.reconcileOnPlay).toHaveBeenCalledWith('abs:abc123', 'abs', 'abc123');
    });

    it('falls back to mediaProgressMemory when absSyncService is null', async () => {
      const app = buildApp({ registry, mediaProgressMemory: memory, contentIdResolver: resolver, absSyncService: null });

      await request(app).get('/play/abs:abc123').expect(200);

      expect(memory.get).toHaveBeenCalledWith('abs:abc123', 'abs');
    });

    it('uses sync service result for resume_position', async () => {
      syncService.reconcileOnPlay.mockResolvedValue({
        itemId: 'abs:abc123', playhead: 5000, duration: 19766, isWatched: () => false, isInProgress: () => true, toJSON: () => ({ playhead: 5000, duration: 19766 })
      });
      const app = buildApp({ registry, mediaProgressMemory: memory, contentIdResolver: resolver, absSyncService: syncService });

      const res = await request(app).get('/play/abs:abc123').expect(200);
      expect(res.body.resume_position).toBe(5000);
    });
  });

  describe('POST /play/log — progress update', () => {
    it('calls absSyncService.onProgressUpdate for abs items', async () => {
      const app = buildApp({ registry, mediaProgressMemory: memory, contentIdResolver: resolver, absSyncService: syncService });

      await request(app)
        .post('/play/log')
        .send({ type: 'abs', assetId: 'abc123', percent: 50, seconds: 5000, watched_duration: 30 })
        .expect(200);

      expect(syncService.onProgressUpdate).toHaveBeenCalled();
      const [itemId, localId, data] = syncService.onProgressUpdate.mock.calls[0];
      expect(itemId).toBe('abs:abc123');
      expect(localId).toBe('abc123');
    });

    it('does not call sync for non-abs items', async () => {
      const app = buildApp({ registry, mediaProgressMemory: memory, contentIdResolver: resolver, absSyncService: syncService });

      await request(app)
        .post('/play/log')
        .send({ type: 'plex', assetId: '12345', percent: 50, seconds: 5000 })
        .expect(200);

      expect(syncService.onProgressUpdate).not.toHaveBeenCalled();
    });
  });

  describe('GET /play/abs:itemId?bookmark=true — bookmark restore', () => {
    it('uses bookmark playhead as resume_position', async () => {
      syncService.reconcileOnPlay.mockResolvedValue({
        itemId: 'abs:abc123', playhead: 5000, duration: 19766,
        bookmark: { playhead: 1000, reason: 'session-start', createdAt: new Date().toISOString() },
        isWatched: () => false, isInProgress: () => true,
        toJSON: () => ({ playhead: 5000, duration: 19766, bookmark: { playhead: 1000, reason: 'session-start', createdAt: new Date().toISOString() } })
      });
      const app = buildApp({ registry, mediaProgressMemory: memory, contentIdResolver: resolver, absSyncService: syncService });

      const res = await request(app).get('/play/abs:abc123?bookmark=true').expect(200);
      expect(res.body.resume_position).toBe(1000);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/api/routers/play.absSync.test.mjs --verbose`
Expected: FAIL — `reconcileOnPlay` never called (router doesn't know about sync service yet)

Note: You may need to install `supertest` if not already available: `npm install --save-dev supertest` from the project root.

**Step 3: Modify the play router**

Edit `backend/src/4_api/v1/routers/play.mjs`:

**3a.** Update the config destructure (line 26) to accept `absSyncService`:

```javascript
  const { registry, mediaProgressMemory, contentQueryService, contentIdResolver, absSyncService, logger = console } = config;
```

**3b.** In the `POST /log` handler, after `mediaProgressMemory.set(newState, storagePath)` (after line 181), add ABS sync fire-and-forget:

```javascript
      // ABS sync: debounced write-back (fire-and-forget)
      if (type === 'abs' && absSyncService) {
        const localId = assetId.includes(':') ? assetId.split(':').slice(1).join(':') : assetId;
        absSyncService.onProgressUpdate(compoundId, localId, {
          playhead: normalizedSeconds,
          duration: estimatedDuration,
          percent: statePercent,
          watchTime: sessionWatchTime
        });
      }
```

**3c.** Create a helper function inside `createPlayRouter` (after the `toPlayResponse` function, around line 89) for resolving watch state:

```javascript
  /**
   * Get watch state for an item, using ABS sync service for ABS items.
   */
  async function getWatchState(item, storagePath, adapter) {
    // Use ABS sync for abs items when available
    if (absSyncService && adapter?.source === 'abs') {
      const colonIdx = item.id.indexOf(':');
      const localId = colonIdx > 0 ? item.id.slice(colonIdx + 1) : item.id;
      return absSyncService.reconcileOnPlay(item.id, storagePath, localId);
    }
    return mediaProgressMemory ? mediaProgressMemory.get(item.id, storagePath) : null;
  }
```

**3d.** Replace all `mediaProgressMemory.get(...)` calls in the GET handlers with `getWatchState(...)`:

In `GET /:source/*` (the wildcard handler):

- Line 291: `const watchState = mediaProgressMemory ? await mediaProgressMemory.get(selectedItem.id, storagePath) : null;`
  → `const watchState = await getWatchState(selectedItem, storagePath, adapter);`

- Line 327: `const watchState = mediaProgressMemory ? await mediaProgressMemory.get(selectedItem.id, storagePath) : null;`
  → `const watchState = await getWatchState(selectedItem, storagePath, adapter);`

- Line 336: `const watchState = mediaProgressMemory ? await mediaProgressMemory.get(item.id, storagePath) : null;`
  → `const watchState = await getWatchState(item, storagePath, adapter);`

In `GET /:source` (the compound ID handler):

- Line 383: `const watchState = mediaProgressMemory ? await mediaProgressMemory.get(selectedItem.id, storagePath) : null;`
  → `const watchState = await getWatchState(selectedItem, storagePath, adapter);`

- Line 390: `const watchState = mediaProgressMemory ? await mediaProgressMemory.get(item.id, storagePath) : null;`
  → `const watchState = await getWatchState(item, storagePath, adapter);`

**3e.** Add bookmark restore support. In the `toPlayResponse` call sites for the single-item GET paths (lines 338 and 391), add bookmark handling after `toPlayResponse`:

The cleanest approach: modify the `toPlayResponse` function to accept an options bag. After line 53 (`response.resume_percent = progress.percent;`), add:

Actually, simpler: add bookmark override at the `getWatchState` call sites. In the wildcard handler's single-item path (around line 336-338), before calling `toPlayResponse`:

```javascript
      // Bookmark restore: override playhead with bookmark position
      if (req.query.bookmark === 'true' && watchState?.bookmark) {
        watchState.playhead = watchState.bookmark.playhead;
      }
```

Add the same bookmark logic before each `toPlayResponse` call for single items.

**Step 4: Run tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/api/routers/play.absSync.test.mjs --verbose`
Expected: All PASS

**Step 5: Run existing play-related tests to check regressions**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/ --verbose 2>&1 | head -80`
Expected: No new failures from existing tests

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs tests/isolated/api/routers/play.absSync.test.mjs
git commit -m "feat(abs-sync): integrate ABSProgressSyncService into play router"
```

---

### Task 7: DI — app.mjs construction + SIGTERM flush

**Files:**
- Modify: `backend/src/app.mjs` (around line 317, 402)
- Modify: `backend/src/0_system/bootstrap.mjs` (line 674-675, 732)

**Step 1: Add AudiobookshelfClient import and sync service construction to app.mjs**

In `backend/src/app.mjs`, after the `audiobookshelfConfig` construction (line 317), add:

```javascript
  // ABS Progress Sync — bidirectional progress sync between DS and Audiobookshelf
  let absSyncService = null;
  if (audiobookshelfConfig) {
    const { AudiobookshelfClient } = await import('./1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs');
    const { ABSProgressSyncService } = await import('./3_applications/content/services/ABSProgressSyncService.mjs');
    const absClient = new AudiobookshelfClient(audiobookshelfConfig, { httpClient: axios });
    absSyncService = new ABSProgressSyncService({
      absClient,
      mediaProgressMemory,
      logger: rootLogger.child({ module: 'abs-sync' })
    });
  }
```

Note: This block must come AFTER `mediaProgressMemory` is created (line 342). Place it after line 342.

**Step 2: Pass `absSyncService` through to `createApiRouters`**

In the `createApiRouters` call (line 402), add `absSyncService`:

```javascript
  const { routers: contentRouters, services: contentServices } = createApiRouters({
    registry: contentRegistry,
    mediaProgressMemory,
    absSyncService,                // <-- add this
    loadFile: contentLoadFile,
    // ... rest unchanged
  });
```

**Step 3: Thread `absSyncService` through bootstrap.mjs**

In `backend/src/0_system/bootstrap.mjs`:

Update the `createApiRouters` function signature (line 674-675) to accept `absSyncService`:

```javascript
export function createApiRouters(config) {
  const { registry, mediaProgressMemory, absSyncService, loadFile, saveFile, ... } = config;
```

Update the `createPlayRouter` call (line 732) to pass it:

```javascript
      play: createPlayRouter({ registry, mediaProgressMemory, contentQueryService, contentIdResolver, absSyncService, logger }),
```

**Step 4: Add SIGTERM flush handler**

In `backend/src/app.mjs`, at the end of `configureApp()` (before the return), add:

```javascript
  // Graceful shutdown: flush pending ABS sync writes
  if (absSyncService) {
    process.on('SIGTERM', async () => {
      await absSyncService.flush();
    });
  }
```

**Step 5: Verify manually**

Start the dev server and check logs for no errors:
```bash
node backend/index.js 2>&1 | head -20
```

If ABS is configured, check that the sync service initializes without error. Kill the server with SIGTERM and verify flush logs appear.

**Step 6: Run the full test suite**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/ tests/unit/ --verbose 2>&1 | tail -30`
Expected: All existing + new tests PASS

**Step 7: Commit**

```bash
git add backend/src/app.mjs backend/src/0_system/bootstrap.mjs
git commit -m "feat(abs-sync): wire ABSProgressSyncService into DI and SIGTERM handler"
```

---

### Task 8: Final verification and cleanup

**Step 1: Run all new tests together**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/content/resolveProgressConflict.test.mjs tests/isolated/domain/content/isProgressCommittable.test.mjs tests/isolated/domain/content/MediaProgress.bookmark.test.mjs tests/isolated/adapter/persistence/YamlMediaProgressBookmark.test.mjs tests/isolated/application/content/ABSProgressSyncService.test.mjs tests/isolated/api/routers/play.absSync.test.mjs --verbose
```
Expected: All PASS

**Step 2: Run the full existing test suite for regressions**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest --verbose 2>&1 | tail -40`
Expected: No new failures

**Step 3: Squash-merge or final commit if needed**

Review all commits with `git log --oneline -10` and ensure the feature is complete.

---

## File Inventory

### New files (6)
| File | Layer | Purpose |
|------|-------|---------|
| `backend/src/2_domains/content/services/resolveProgressConflict.mjs` | Domain | Conflict resolution pure function |
| `backend/src/2_domains/content/services/isProgressCommittable.mjs` | Domain | Jump skepticism pure function |
| `backend/src/3_applications/content/services/ABSProgressSyncService.mjs` | Application | Sync orchestration service |
| `tests/isolated/domain/content/resolveProgressConflict.test.mjs` | Test | Conflict resolution tests |
| `tests/isolated/domain/content/isProgressCommittable.test.mjs` | Test | Committability tests |
| `tests/isolated/domain/content/MediaProgress.bookmark.test.mjs` | Test | Bookmark entity tests |
| `tests/isolated/adapter/persistence/YamlMediaProgressBookmark.test.mjs` | Test | Schema bookmark test |
| `tests/isolated/application/content/ABSProgressSyncService.test.mjs` | Test | Sync service tests |
| `tests/isolated/api/routers/play.absSync.test.mjs` | Test | Router integration tests |

### Modified files (5)
| File | Change |
|------|--------|
| `backend/src/2_domains/content/entities/MediaProgress.mjs` | Add `bookmark` field with 7-day expiry |
| `backend/src/1_adapters/persistence/yaml/mediaProgressSchema.mjs` | Add `bookmark` to `CANONICAL_FIELDS` |
| `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs` | Pass `bookmark` through in `_toDomainEntity` |
| `backend/src/4_api/v1/routers/play.mjs` | Accept `absSyncService`, delegate for ABS items, bookmark restore |
| `backend/src/app.mjs` | Construct `ABSProgressSyncService`, pass to routers, SIGTERM flush |
| `backend/src/0_system/bootstrap.mjs` | Thread `absSyncService` through `createApiRouters` to play router |

### Unchanged (confirmed)
| File | Reason |
|------|--------|
| `AudiobookshelfClient.mjs` | `getProgress()` + `updateProgress()` already exist |
| `AudiobookshelfAdapter.mjs` | Still reads ABS progress on getItem — sync adds write-back |
