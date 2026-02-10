# Fix Plex StoragePath in Fast Path Episode Selection

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the `_getNextPlayableFromChild` fast path so it resolves the library-specific storagePath (e.g., `plex/17_lectures`) instead of hardcoding `'plex'`, which reads from an empty root file and ignores all viewing history.

**Architecture:** One-line fix in `ListAdapter.mjs` line 648, matching the correct pattern already used on line 667 of the same file. The fast path (used by PlexAdapter) must call `adapter.getStoragePath(child.id)` to resolve the Plex library path before passing it to `loadPlayableItemFromKey`. Update one existing test assertion that currently expects the broken behavior.

**Tech Stack:** Node.js (ES modules), Vitest, YAML-based media progress storage

---

## Bug Summary

**Reading (broken):** `ListAdapter._getNextPlayableFromChild` line 648 uses `child.source || 'plex'` → reads `plex.yml` (4 test entries, no real data)

**Writing (correct):** `play.mjs` router uses `adapter.getStoragePath(itemId)` → writes to `plex/17_lectures.yml` (real history)

**Result:** Episode selection ignores ALL viewing history for Plex items in programs. Every show always restarts from its first episode.

---

### Task 1: Update the failing test to expect correct storagePath

**Files:**
- Modify: `tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs:141-170`

**Step 1: Update the fast-path test to expect library-specific storagePath**

The existing test on line 168 asserts the broken behavior:
```javascript
expect(loadPlayableItemFromKey).toHaveBeenCalledWith('plex:show123', { storagePath: 'plex' });
```

Change the mock `getStoragePath` to return a library-specific path, and update the assertion:

```javascript
describe('_getNextPlayableFromChild — Plex fast path', () => {
  it('uses loadPlayableItemFromKey when available (skips resolvePlayables)', async () => {
    const fastItem = { id: 'plex:ep42', title: 'Smart Pick', mediaUrl: '/media/ep42.mp4' };
    const resolvePlayables = vi.fn(async () => { throw new Error('should not be called'); });
    const loadPlayableItemFromKey = vi.fn(async () => fastItem);

    const registry = {
      resolve: vi.fn(() => ({
        adapter: {
          loadPlayableItemFromKey,
          resolvePlayables,
          getStoragePath: vi.fn(async () => 'plex/17_lectures'),
          source: 'plex',
        },
        localId: 'show123',
      })),
    };
    const memory = makeMockMemory();
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    adapter._listCache.set('programs:fast-program', [
      { label: 'Show', input: 'plex:show123' },
    ]);

    const result = await adapter.resolvePlayables('program:fast-program', { applySchedule: false });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('plex:ep42');
    expect(loadPlayableItemFromKey).toHaveBeenCalledWith('plex:show123', { storagePath: 'plex/17_lectures' });
    expect(resolvePlayables).not.toHaveBeenCalled();
  });

  it('falls back to adapter source when getStoragePath is not available', async () => {
    const fastItem = { id: 'plex:ep42', title: 'Smart Pick', mediaUrl: '/media/ep42.mp4' };
    const loadPlayableItemFromKey = vi.fn(async () => fastItem);

    const registry = {
      resolve: vi.fn(() => ({
        adapter: {
          loadPlayableItemFromKey,
          source: 'plex',
          // no getStoragePath
        },
        localId: 'show123',
      })),
    };
    const memory = makeMockMemory();
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    adapter._listCache.set('programs:fallback-program', [
      { label: 'Show', input: 'plex:show123' },
    ]);

    const result = await adapter.resolvePlayables('program:fallback-program', { applySchedule: false });

    expect(result).toHaveLength(1);
    expect(loadPlayableItemFromKey).toHaveBeenCalledWith('plex:show123', { storagePath: 'plex' });
  });

  it('returns null when loadPlayableItemFromKey returns nothing', async () => {
    const loadPlayableItemFromKey = vi.fn(async () => null);

    const registry = {
      resolve: vi.fn(() => ({
        adapter: {
          loadPlayableItemFromKey,
          getStoragePath: vi.fn(async () => 'plex/17_lectures'),
          source: 'plex',
        },
        localId: 'show123',
      })),
    };
    const memory = makeMockMemory();
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    adapter._listCache.set('programs:empty-program', [
      { label: 'Show', input: 'plex:show123' },
    ]);

    const result = await adapter.resolvePlayables('program:empty-program', { applySchedule: false });

    // null items are filtered out, resulting in empty array
    expect(result).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs`
Expected: FAIL — `loadPlayableItemFromKey` called with `{ storagePath: 'plex' }` instead of `{ storagePath: 'plex/17_lectures' }`

---

### Task 2: Fix the fast path storagePath resolution

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs:647-650`

**Step 3: Apply the one-line fix**

Change lines 647-650 from:

```javascript
    if (adapter.loadPlayableItemFromKey) {
      const storagePath = child.source || 'plex';
      const item = await adapter.loadPlayableItemFromKey(child.id, { storagePath });
      return item || null;
    }
```

To:

```javascript
    if (adapter.loadPlayableItemFromKey) {
      const storagePath = (adapter.getStoragePath ? await adapter.getStoragePath(child.id) : null) || child.source || 'plex';
      const item = await adapter.loadPlayableItemFromKey(child.id, { storagePath });
      return item || null;
    }
```

This matches the existing correct pattern on line 667 of the same file.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs`
Expected: ALL PASS

**Step 5: Run full isolated test suite to check for regressions**

Run: `npx vitest run tests/isolated/`
Expected: ALL PASS

---

### Task 3: Verify with live API

**Step 6: Verify the fix against the running server**

Restart the dev server if needed, then:

Run: `curl -s http://localhost:3112/api/v1/queue/program:morning-program | jq '.items[] | select(.grandparentTitle == "Crash Course Kids") | {id, title, itemIndex}'`

Expected: The returned Crash Course Kids item should NOT be `plex:661881` ("Crash Course Kids Preview!") — it should be the next unwatched/in-progress episode based on the viewing history in `plex/17_lectures.yml`.

---

### Task 4: Commit

**Step 7: Commit the fix**

```bash
git add backend/src/1_adapters/content/list/ListAdapter.mjs tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs
git commit -m "fix: resolve library-specific storagePath in fast-path episode selection

The fast path in _getNextPlayableFromChild was using child.source ('plex')
as storagePath, reading from the root plex.yml with no real history data.
Now calls adapter.getStoragePath() to resolve the library-specific path
(e.g. plex/17_lectures), matching the pattern already used in the generic
fallback path on line 667.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
