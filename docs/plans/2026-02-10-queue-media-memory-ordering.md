# Queue Ordering with Media Memory

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Partition queue items by watch status so unwatched content always plays before watched content.

**Architecture:** The queue router partitions playables into unwatched/watched using `DefaultMediaProgressClassifier`, applies shuffle independently per partition, then concatenates. Backend-only change; no frontend work.

**Tech Stack:** Express router, YamlMediaProgressMemory, DefaultMediaProgressClassifier

---

## Problem

When a queue is built (e.g. Yiruma playlist with `shuffle: true`), all items are treated equally. A track played 48 times has the same priority as one never heard. Without shuffle, items return in their natural order regardless of watch history.

## Design

**Partition items by watch status, then order within each partition.**

Given a list of playable items from an adapter:

1. Look up each item's `MediaProgress` via `mediaProgressMemory`
2. Classify each using `DefaultMediaProgressClassifier.classify()` which returns `'unwatched' | 'in_progress' | 'watched'`
3. Partition into two groups:
   - **Unwatched**: classified as `'unwatched'` or `'in_progress'`
   - **Watched**: classified as `'watched'`
4. If shuffle requested: shuffle each partition independently
5. If no shuffle: preserve natural order within each partition
6. Concatenate: unwatched first, then watched
7. Apply limit (if any) after concatenation

### Why DefaultMediaProgressClassifier, not MediaProgress.isWatched()

`MediaProgress.isWatched()` uses a flat `percent >= 90` check. This fails for:
- **Short tracks** (10s music clip): playhead at 8s = 80%, but only 2s remaining — clearly finished
- **Seeking**: someone skipped to 95% but only watched 5 seconds total — not really watched

`DefaultMediaProgressClassifier` handles these correctly:
- Short content (<15min): uses 95% threshold
- Remaining seconds: <120s remaining = watched regardless of percent
- Anti-seeking: watchTime < 60s = in_progress even if playhead jumped ahead

## Behavior

| Shuffle | Result |
|---------|--------|
| `false` | Unwatched in natural order, then watched in natural order. Item[0] = next unwatched item. |
| `true`  | Unwatched shuffled, then watched shuffled. Fresh content always comes first. |

## Edge Cases

- **All items watched**: full list returned (shuffled or natural), no items suppressed
- **No memory entries**: everything is "unwatched", behavior identical to today
- **Item in progress** (e.g. 26% complete): stays in unwatched partition — will surface early

---

## Tasks

### Task 1: Write test for partition helper

**Files:**
- Create: `tests/isolated/api/queue/partitionByWatchStatus.test.mjs`

**Step 1: Write the test file**

```js
import { describe, it, expect } from 'vitest';
import { partitionByWatchStatus } from '../../../../backend/src/4_api/v1/routers/queue.mjs';

describe('partitionByWatchStatus', () => {
  const classifier = {
    classify: (progress) => {
      if (!progress || !progress.playhead) return 'unwatched';
      if (progress.percent >= 90) return 'watched';
      return 'in_progress';
    }
  };

  it('should put items with no progress in unwatched', () => {
    const items = [{ id: 'plex:1' }, { id: 'plex:2' }];
    const progressMap = new Map();
    const { unwatched, watched } = partitionByWatchStatus(items, progressMap, classifier);
    expect(unwatched).toHaveLength(2);
    expect(watched).toHaveLength(0);
  });

  it('should partition watched items to the end', () => {
    const items = [{ id: 'plex:1' }, { id: 'plex:2' }, { id: 'plex:3' }];
    const progressMap = new Map([
      ['plex:1', { playhead: 280, duration: 280, percent: 100, playCount: 5 }],
      ['plex:3', { playhead: 250, duration: 280, percent: 89, playCount: 1 }]
    ]);
    const { unwatched, watched } = partitionByWatchStatus(items, progressMap, classifier);
    expect(unwatched.map(i => i.id)).toEqual(['plex:2', 'plex:3']);
    expect(watched.map(i => i.id)).toEqual(['plex:1']);
  });

  it('should treat in_progress as unwatched', () => {
    const items = [{ id: 'plex:1' }];
    const progressMap = new Map([
      ['plex:1', { playhead: 50, duration: 280, percent: 18, playCount: 1, watchTime: 120 }]
    ]);
    const { unwatched, watched } = partitionByWatchStatus(items, progressMap, classifier);
    expect(unwatched).toHaveLength(1);
    expect(watched).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/api/queue/partitionByWatchStatus.test.mjs`
Expected: FAIL — `partitionByWatchStatus` is not exported from queue.mjs

### Task 2: Implement partitionByWatchStatus

**Files:**
- Modify: `backend/src/4_api/v1/routers/queue.mjs`

**Step 1: Add the partition function after `shuffleArray`**

```js
/**
 * Partition items into unwatched and watched groups using a classifier.
 * @param {Array} items - Playable items with .id property
 * @param {Map<string, Object>} progressMap - Map of itemId -> MediaProgress-like object
 * @param {Object} classifier - Object with classify(progress, contentMeta) method
 * @returns {{ unwatched: Array, watched: Array }}
 */
export function partitionByWatchStatus(items, progressMap, classifier) {
  const unwatched = [];
  const watched = [];

  for (const item of items) {
    const progress = progressMap.get(item.id);
    const status = progress
      ? classifier.classify(progress, { duration: item.duration })
      : 'unwatched';

    if (status === 'watched') {
      watched.push(item);
    } else {
      unwatched.push(item);
    }
  }

  return { unwatched, watched };
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run tests/isolated/api/queue/partitionByWatchStatus.test.mjs`
Expected: PASS

**Step 3: Commit**

```
feat: add partitionByWatchStatus helper to queue router
```

### Task 3: Write integration test for queue endpoint with media memory

**Files:**
- Modify: `tests/integrated/api/content/queue.test.mjs`

**Step 1: Add test case for watch-status ordering**

Add a test that verifies the queue endpoint returns unwatched items before watched items. This test will depend on the existing test fixtures and a running backend. Check the existing test file structure first, then add a test that:

1. Calls the queue endpoint for a known content source
2. Verifies items are returned with unwatched items first

The exact test content depends on existing fixtures in the file — read `tests/integrated/api/content/queue.test.mjs` before writing.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integrated/api/content/queue.test.mjs`
Expected: FAIL — queue endpoint doesn't yet use media memory

### Task 4: Wire mediaProgressMemory into queue router

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:704`
- Modify: `backend/src/4_api/v1/routers/queue.mjs`

**Step 1: Pass mediaProgressMemory in bootstrap.mjs**

At line 704, change:
```js
queue: createQueueRouter({ registry, contentIdResolver, logger }),
```
to:
```js
queue: createQueueRouter({ registry, contentIdResolver, mediaProgressMemory, logger }),
```

**Step 2: Update createQueueRouter to accept and use mediaProgressMemory**

In `queue.mjs`, update the `createQueueRouter` function:

1. Destructure `mediaProgressMemory` from config
2. Import `DefaultMediaProgressClassifier`
3. Create classifier instance: `const classifier = new DefaultMediaProgressClassifier();`
4. After `adapter.resolvePlayables(finalId)`, load progress and partition:

```js
import { DefaultMediaProgressClassifier } from '#domains/content/services/DefaultMediaProgressClassifier.mjs';

export function createQueueRouter(config) {
  const { registry, contentIdResolver, mediaProgressMemory, logger = console } = config;
  const classifier = new DefaultMediaProgressClassifier();
  const router = express.Router();

  const handleQueueRequest = asyncHandler(async (req, res) => {
    // ... existing source/adapter resolution ...

    const playables = await adapter.resolvePlayables(finalId);

    // Partition by watch status
    let items = playables;
    if (mediaProgressMemory) {
      const allProgress = await mediaProgressMemory.getAllFromAllLibraries(resolvedSource);
      const progressMap = new Map(allProgress.map(p => [p.itemId, p]));
      const { unwatched, watched } = partitionByWatchStatus(playables, progressMap, classifier);
      items = [
        ...(shuffle ? shuffleArray([...unwatched]) : unwatched),
        ...(shuffle ? shuffleArray([...watched]) : watched)
      ];
    } else if (shuffle) {
      items = shuffleArray([...items]);
    }

    if (limit) {
      items = items.slice(0, limit);
    }

    // ... rest of response ...
  });
```

**Step 3: Remove the old standalone shuffle block**

The old `if (shuffle) { items = shuffleArray([...items]); }` block (lines 106-108) is now handled inside the partition logic. Remove it.

**Step 4: Run tests**

Run: `npx vitest run tests/isolated/api/queue/partitionByWatchStatus.test.mjs`
Expected: PASS

Run: `npx vitest run tests/integrated/api/content/queue.test.mjs`
Expected: PASS (if backend running)

**Step 5: Commit**

```
feat: partition queue items by watch status using media memory
```

### Task 5: Manual verification

**Step 1: Start dev server if not running**

Check: `lsof -i :3111`
If not running: `npm run dev`

**Step 2: Test Yiruma queue without shuffle**

```bash
curl -s http://localhost:3112/api/v1/queue/plex:545064 | jq '[.items[] | {title, id}] | length'
```

Verify items are returned with unwatched first.

**Step 3: Test Yiruma queue with shuffle**

```bash
curl -s 'http://localhost:3112/api/v1/queue/plex:545064?shuffle=true' | jq '[.items[:3][] | {title, id}]'
```

Run it twice — verify the order differs (shuffle working) but unwatched items consistently appear before watched items.

**Step 4: Test a source with no media memory**

```bash
curl -s http://localhost:3112/api/v1/queue/plex:310787 | jq '.count'
```

Verify it still returns items normally (graceful fallback when no progress data exists).

---

## Not In Scope

- Frontend changes (frontend plays whatever order the queue returns)
- New query params (partition-by-watch is always-on — no scenario where watched items should precede unwatched)
- Changes to `MediaProgress.isWatched()` (the classifier is the right abstraction for this)
