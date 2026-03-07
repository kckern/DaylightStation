# Fitness Watch Progress Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two bugs where fitness workout watch progress is lost — classified watchProgress gets overwritten by Plex resumePosition in `toListItem`, and play.log receives wrong `type` for Plex items causing progress to be stored in the wrong file.

**Architecture:** Bug 1 is a data precedence issue in `toListItem()` (backend API layer) — classified watch state should take priority over raw Plex resumePosition. Bug 2 is a missing `source` field on queue items constructed in `FitnessShow.jsx` (frontend) — the play.log type resolution chain falls through to `'episode'` instead of `'plex'`.

**Tech Stack:** Node.js (backend, ES modules), React (frontend), Jest (unit tests)

---

### Task 1: Write failing test for Bug 1 — toListItem overwrites classified watchProgress

**Files:**
- Modify: `tests/unit/suite/api/list-toListItem.test.mjs`

**Step 1: Write the failing test**

Add this test to the existing describe block in `tests/unit/suite/api/list-toListItem.test.mjs`:

```js
it('does NOT overwrite classified watchProgress with resumePosition', () => {
  // Simulates a fitness item where FitnessPlayableService set watchProgress: 100
  // but Plex still has a partial resumePosition (viewOffset)
  const item = {
    id: 'plex:600174',
    localId: '600174',
    title: 'Eccentric Upper',
    type: 'episode',
    metadata: { type: 'episode' },
    mediaUrl: '/api/v1/proxy/plex/stream/600174',
    // Classified values from FitnessPlayableService
    watchProgress: 100,
    watchSeconds: 1960,
    isWatched: true,
    lastPlayed: '2026-03-02',
    // Raw Plex resume position (partial — user didn't finish in one sitting)
    resumePosition: 338,
    duration: 1960
  };

  const result = toListItem(item);

  // Classified values must survive — NOT be overwritten by resumePosition
  expect(result.watchProgress).toBe(100);
  expect(result.watchSeconds).toBe(1960);
  // resumePosition should still be present for resume-from-position use
  expect(result.resumePosition).toBe(338);
});

it('uses resumePosition for watchProgress when no classified value exists', () => {
  // Non-fitness item where watchProgress was never set by classification
  const item = {
    id: 'plex:99999',
    localId: '99999',
    title: 'Some Movie',
    type: 'movie',
    metadata: { type: 'movie' },
    mediaUrl: '/some/url',
    resumePosition: 600,
    duration: 3600
  };

  const result = toListItem(item);

  // Should derive watchProgress from resumePosition since no classified value
  expect(result.watchProgress).toBe(17); // Math.round(600/3600*100)
  expect(result.watchSeconds).toBe(600);
  expect(result.resumePosition).toBe(600);
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/api/list-toListItem.test.mjs --verbose`
Expected: First test FAILS — `watchProgress` is 17 instead of 100. Second test passes.

---

### Task 2: Fix Bug 1 — guard watchProgress/watchSeconds overwrite in toListItem

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs:228-237`

**Step 1: Implement the fix**

At line 228-237 in `list.mjs`, change the resumePosition block to only set `watchProgress` and `watchSeconds` if they haven't already been set by the classification pipeline:

```js
// Progress/resume fields from PlayableItem
if (item.resumePosition !== undefined && item.resumePosition !== null) {
  base.resumePosition = item.resumePosition;
  base.resumeSeconds = item.resumePosition;
  // Only set watchSeconds/watchProgress from resumePosition if not already classified
  if (base.watchSeconds === undefined) {
    base.watchSeconds = item.resumePosition;
  }
  if (base.watchProgress === undefined && item.duration && item.duration > 0) {
    base.watchProgress = Math.round((item.resumePosition / item.duration) * 100);
  }
}
```

The key change: `base.watchSeconds` and `base.watchProgress` are guarded with `=== undefined` checks. These fields may have been set earlier (lines 120-121 from classified item, or lines 129-130 from metadata). The `resumePosition` block now only fills them in as a fallback.

**Step 2: Run test to verify it passes**

Run: `npx jest tests/unit/suite/api/list-toListItem.test.mjs --verbose`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/unit/suite/api/list-toListItem.test.mjs backend/src/4_api/v1/routers/list.mjs
git commit -m "fix(list): don't overwrite classified watchProgress with Plex resumePosition"
```

---

### Task 3: Write failing test for Bug 2 — play.log type resolution

This bug is in the frontend (`FitnessPlayer.jsx` line 846). The `computeEpisodeStatusPayload` callback computes `type` from a priority chain. The queue item constructed in `FitnessShow.jsx` (line 591-613) sets `plex: plexId` but does NOT set `source`. When `plexId` is null (item ID didn't start with `plex:`, and `episode.plex` / `episode.play.plex` were both absent), the chain falls through: `undefined || null || 'episode' || 'files'` = `'episode'`.

The root cause: queue items should carry `source: 'plex'` when they're Plex items, so the type chain resolves correctly regardless of whether `plexId` is set.

**Files:**
- Create: `tests/unit/suite/fitness/fitnessQueueItem-source.test.mjs`

**Step 1: Write the failing test**

This is a pure logic test — we extract and test the type resolution logic inline:

```js
// tests/unit/suite/fitness/fitnessQueueItem-source.test.mjs
import { describe, it, expect } from '@jest/globals';

/**
 * Reproduces the type resolution logic from FitnessPlayer.jsx line 846:
 *   type: currentItem.source || (currentItem.plex ? 'plex' : null) || currentItem.type || 'files'
 */
function resolvePlayLogType(item) {
  return item.source || (item.plex ? 'plex' : null) || item.type || 'files';
}

describe('play.log type resolution', () => {
  it('resolves to "plex" when source is set to "plex"', () => {
    const item = { source: 'plex', plex: '600174', type: 'episode' };
    expect(resolvePlayLogType(item)).toBe('plex');
  });

  it('resolves to "plex" via plex field fallback', () => {
    const item = { plex: '600174', type: 'episode' };
    expect(resolvePlayLogType(item)).toBe('plex');
  });

  it('falls through to "episode" when plex is null and no source (current bug)', () => {
    // This demonstrates the bug: plex is null, source is undefined
    const item = { plex: null, type: 'episode' };
    expect(resolvePlayLogType(item)).toBe('episode'); // Bug: should be 'plex' for Plex content
  });

  it('falls through to "files" when nothing is set', () => {
    const item = {};
    expect(resolvePlayLogType(item)).toBe('files');
  });
});
```

**Step 2: Run test to verify behavior**

Run: `npx jest tests/unit/suite/fitness/fitnessQueueItem-source.test.mjs --verbose`
Expected: All pass (these document current behavior). The third test shows the bug scenario.

---

### Task 4: Fix Bug 2 — add `source: 'plex'` to queue items in FitnessShow.jsx

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessShow.jsx:591-613` (handlePlayEpisode queue item)
- Modify: `frontend/src/modules/Fitness/player/FitnessShow.jsx:1027-1035` (addToQueue queue item)

**Step 1: Add `source` field to handlePlayEpisode queue item**

In `FitnessShow.jsx` at line 591, add `source` to the queueItem object. Insert after line 592 (`plex: plexId`):

```js
const queueItem = {
  id: plexId || episode.id || `episode-${Date.now()}`,
  plex: plexId,
  source: plexId ? 'plex' : (episode.source || null),
  show: showTitle,
  // ... rest unchanged
```

This ensures `currentItem.source` is `'plex'` for Plex items, which is the FIRST thing checked in the type resolution chain (line 846 of FitnessPlayer.jsx). Even if `plexId` were somehow lost downstream, `source` persists.

**Step 2: Add `source` field to addToQueue queue item**

Find the second queue item construction in `addToQueue` (around line 1035). It follows the same pattern — add the same `source` field there:

```js
source: plexId ? 'plex' : (episode.source || null),
```

**Step 3: Run the dev server and verify**

Run: `npm run dev` (if not already running)

Verify by checking that navigating to a fitness show and playing an episode produces play.log requests with `type: 'plex'` (visible in backend logs or browser network tab).

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessShow.jsx
git commit -m "fix(fitness): add source field to queue items so play.log uses correct type"
```

---

### Task 5: Run full test suite and verify no regressions

**Step 1: Run existing toListItem tests**

Run: `npx jest tests/unit/suite/api/list-toListItem.test.mjs --verbose`
Expected: All PASS

**Step 2: Run list router tests**

Run: `npx jest tests/isolated/api/routers/list.test.mjs --verbose`
Expected: All PASS

**Step 3: Run play router tests**

Run: `npx jest tests/isolated/api/routers/play.test.mjs --verbose`
Expected: All PASS

**Step 4: Run fitness-related tests**

Run: `npx jest tests/unit/suite/fitness/ --verbose`
Expected: All PASS

**Step 5: Commit (if any adjustments were needed)**

```bash
git add -A
git commit -m "test: verify no regressions from watch progress fixes"
```
