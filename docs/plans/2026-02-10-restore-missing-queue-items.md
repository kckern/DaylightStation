# Restore Missing Queue Items — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore 4 missing items from the morning-program queue: `app:wrapup`, `freshvideo:teded`, `watchlist:cfmscripture`, and `query:dailynews`.

**Architecture:** Four independent fixes: (1) make AppRegistryAdapter return app items as playables, (2) create FreshVideoAdapter for `freshvideo:` prefix, (3) add "never empty" fallback to watchlist resolution, (4) fix query:dailynews program resolution chain. All changes are backend, in the DDD adapter/bootstrap layers.

**Tech Stack:** Node.js ES modules, Vitest for testing, YAML config files.

**Design doc:** `docs/plans/2026-02-10-restore-missing-queue-items-design.md`

---

### Task 1: AppRegistryAdapter — return app items as playables

**Files:**
- Modify: `backend/src/1_adapters/content/app-registry/AppRegistryAdapter.mjs:79-81`
- Create: `tests/isolated/adapter/content/app-registry/AppRegistryAdapter.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapter/content/app-registry/AppRegistryAdapter.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { AppRegistryAdapter } from '#adapters/content/app-registry/AppRegistryAdapter.mjs';

describe('AppRegistryAdapter.resolvePlayables', () => {
  const apps = {
    wrapup: { label: 'Wrap Up' },
    webcam: { label: 'Webcam' },
  };

  it('returns a single app item with format "app"', async () => {
    const adapter = new AppRegistryAdapter({ apps });
    const result = await adapter.resolvePlayables('app:wrapup');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'app:wrapup',
      title: 'Wrap Up',
      source: 'app',
      mediaType: 'app',
      format: 'app',
      duration: 0,
      resumable: false,
    });
  });

  it('returns app item even without prefix', async () => {
    const adapter = new AppRegistryAdapter({ apps });
    const result = await adapter.resolvePlayables('wrapup');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('app:wrapup');
  });

  it('returns empty array for unknown app', async () => {
    const adapter = new AppRegistryAdapter({ apps });
    const result = await adapter.resolvePlayables('app:nonexistent');

    expect(result).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/content/app-registry/AppRegistryAdapter.test.mjs`
Expected: FAIL — `resolvePlayables` returns `[]` for all cases

**Step 3: Implement resolvePlayables**

In `AppRegistryAdapter.mjs`, replace the `resolvePlayables` method (lines 75-81):

```javascript
  /**
   * Return app as a playable queue item so it appears in program queues.
   * Frontend PlayableAppShell.jsx handles rendering via format: 'app'.
   * @param {string} [id] - e.g. "app:wrapup" or "wrapup"
   * @returns {Promise<Array>}
   */
  async resolvePlayables(id) {
    if (!id) return [];
    const item = await this.getItem(id);
    if (!item) return [];

    return [{
      id: item.id,
      title: item.title,
      source: 'app',
      mediaUrl: null,
      mediaType: 'app',
      format: 'app',
      duration: 0,
      resumable: false,
      metadata: item.metadata,
    }];
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/content/app-registry/AppRegistryAdapter.test.mjs`
Expected: PASS (3/3)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/app-registry/AppRegistryAdapter.mjs tests/isolated/adapter/content/app-registry/AppRegistryAdapter.test.mjs
git commit -m "feat: AppRegistryAdapter.resolvePlayables returns app items for queue"
```

---

### Task 2: Create FreshVideoAdapter

**Files:**
- Create: `backend/src/1_adapters/content/freshvideo/FreshVideoAdapter.mjs`
- Create: `backend/src/1_adapters/content/freshvideo/manifest.mjs`
- Create: `tests/isolated/adapter/content/freshvideo/FreshVideoAdapter.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapter/content/freshvideo/FreshVideoAdapter.test.mjs`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { FreshVideoAdapter } from '#adapters/content/freshvideo/FreshVideoAdapter.mjs';

// Helper: create mock FileAdapter that returns video items for a folder
function makeMockFileAdapter(items) {
  return {
    getList: vi.fn(async () => items.map(f => ({ localId: f, itemType: 'leaf' }))),
    getItem: vi.fn(async (localId) => ({
      id: `files:${localId}`,
      localId,
      title: localId.split('/').pop(),
      source: 'files',
      mediaUrl: `/api/v1/proxy/media/stream/${encodeURIComponent(localId)}`,
      metadata: {},
    })),
  };
}

function makeMockProgress(watchedKeys = []) {
  return {
    get: vi.fn(async (key) => {
      const percent = watchedKeys.includes(key) ? 95 : 0;
      return { percent };
    }),
  };
}

describe('FreshVideoAdapter', () => {
  it('returns the latest unwatched video', async () => {
    const files = [
      'video/news/teded/20260122.mp4',
      'video/news/teded/20260127.mp4',
    ];
    const adapter = new FreshVideoAdapter({
      fileAdapter: makeMockFileAdapter(files),
      mediaProgressMemory: makeMockProgress([]),
    });

    const result = await adapter.resolvePlayables('teded');

    expect(result).toHaveLength(1);
    expect(result[0].localId).toBe('video/news/teded/20260127.mp4');
  });

  it('skips watched videos and returns next unwatched', async () => {
    const files = [
      'video/news/teded/20260122.mp4',
      'video/news/teded/20260127.mp4',
    ];
    const adapter = new FreshVideoAdapter({
      fileAdapter: makeMockFileAdapter(files),
      mediaProgressMemory: makeMockProgress(['video/news/teded/20260127.mp4']),
    });

    const result = await adapter.resolvePlayables('teded');

    expect(result).toHaveLength(1);
    expect(result[0].localId).toBe('video/news/teded/20260122.mp4');
  });

  it('falls back to newest when all watched', async () => {
    const files = [
      'video/news/teded/20260122.mp4',
      'video/news/teded/20260127.mp4',
    ];
    const adapter = new FreshVideoAdapter({
      fileAdapter: makeMockFileAdapter(files),
      mediaProgressMemory: makeMockProgress([
        'video/news/teded/20260122.mp4',
        'video/news/teded/20260127.mp4',
      ]),
    });

    const result = await adapter.resolvePlayables('teded');

    expect(result).toHaveLength(1);
    // Falls back to newest (never empty)
    expect(result[0].localId).toBe('video/news/teded/20260127.mp4');
  });

  it('returns empty only when folder has no videos', async () => {
    const adapter = new FreshVideoAdapter({
      fileAdapter: makeMockFileAdapter([]),
      mediaProgressMemory: makeMockProgress([]),
    });

    const result = await adapter.resolvePlayables('teded');
    expect(result).toHaveLength(0);
  });

  it('has source "freshvideo" and prefix "freshvideo"', () => {
    const adapter = new FreshVideoAdapter({
      fileAdapter: makeMockFileAdapter([]),
      mediaProgressMemory: makeMockProgress([]),
    });

    expect(adapter.source).toBe('freshvideo');
    expect(adapter.prefixes).toEqual([{ prefix: 'freshvideo' }]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/content/freshvideo/FreshVideoAdapter.test.mjs`
Expected: FAIL — module not found

**Step 3: Create the manifest**

Create `backend/src/1_adapters/content/freshvideo/manifest.mjs`:

```javascript
export default {
  provider: 'freshvideo',
  capability: 'freshvideo',
  displayName: 'Fresh Video (Daily Content)',
  mediaTypes: ['video'],
  playableType: 'video',
  implicit: true,
  adapter: () => import('./FreshVideoAdapter.mjs'),
  configSchema: {},
};
```

**Step 4: Create the adapter**

Create `backend/src/1_adapters/content/freshvideo/FreshVideoAdapter.mjs`:

```javascript
// backend/src/1_adapters/content/freshvideo/FreshVideoAdapter.mjs

const WATCHED_THRESHOLD = 90;

/**
 * Content adapter for fresh video sources (news, teded, etc.).
 *
 * Fixed strategy: always returns the latest unwatched video from a folder.
 * Falls back to the newest video if all are watched (never empty).
 *
 * Folder convention: media/video/news/{localId}/YYYYMMDD.mp4
 */
export class FreshVideoAdapter {
  #fileAdapter;
  #mediaProgressMemory;

  constructor({ fileAdapter, mediaProgressMemory }) {
    this.#fileAdapter = fileAdapter;
    this.#mediaProgressMemory = mediaProgressMemory || null;
  }

  get source() { return 'freshvideo'; }
  get prefixes() { return [{ prefix: 'freshvideo' }]; }
  getCapabilities() { return ['playable']; }

  /**
   * Resolve a freshvideo source to the latest unwatched video.
   * @param {string} id - e.g. "freshvideo:teded" or "teded"
   * @returns {Promise<Array>} Single-item array or empty if no videos exist
   */
  async resolvePlayables(id) {
    const localId = id.replace(/^freshvideo:/, '');
    const videoPath = `video/news/${localId}`;

    const listing = await this.#fileAdapter.getList(videoPath);
    const leaves = (listing || []).filter(item => item.itemType === 'leaf');
    if (leaves.length === 0) return [];

    // Build full items with date extracted from filename
    const items = [];
    for (const leaf of leaves) {
      const fullItem = await this.#fileAdapter.getItem(leaf.localId);
      if (!fullItem) continue;

      const filename = leaf.localId.split('/').pop() || '';
      const dateMatch = filename.match(/^(\d{8})/);
      const date = dateMatch ? dateMatch[1] : '00000000';

      items.push({ ...fullItem, date });
    }

    if (items.length === 0) return [];

    // Sort by date descending (newest first)
    items.sort((a, b) => b.date.localeCompare(a.date));

    // Enrich with watch state and pick latest unwatched
    if (this.#mediaProgressMemory) {
      for (const item of items) {
        const mediaKey = item.localId || item.id?.replace(/^(files|media):/, '');
        const state = await this.#mediaProgressMemory.get(mediaKey, 'files');
        item.percent = state?.percent || 0;
        item.watched = item.percent >= WATCHED_THRESHOLD;
      }

      const unwatched = items.find(item => !item.watched);
      if (unwatched) return [unwatched];
    }

    // Fallback: newest video (never empty)
    return [items[0]];
  }

  async getItem(id) {
    const results = await this.resolvePlayables(id);
    return results[0] || null;
  }

  async getList(id) {
    return this.getItem(id);
  }

  async resolveSiblings() {
    return { parent: null, items: [] };
  }

  async search() { return []; }
}
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/content/freshvideo/FreshVideoAdapter.test.mjs`
Expected: PASS (5/5)

**Step 6: Commit**

```bash
git add backend/src/1_adapters/content/freshvideo/
git add tests/isolated/adapter/content/freshvideo/
git commit -m "feat: FreshVideoAdapter for freshvideo: prefix (latest unwatched)"
```

---

### Task 3: Register FreshVideoAdapter in bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (imports near line 28, registration near line 513)

**Step 1: Add import**

Add after line 28 (`import { QueryAdapter }...`):

```javascript
import { FreshVideoAdapter } from '#adapters/content/freshvideo/FreshVideoAdapter.mjs';
import freshvideoManifest from '#adapters/content/freshvideo/manifest.mjs';
```

**Step 2: Add registration**

Add after the QueryAdapter registration block (after line 513), before Immich:

```javascript
  // Register FreshVideoAdapter for freshvideo: prefix (teded, kidnuz, etc.)
  // Uses FileAdapter for file listing and mediaProgressMemory for watch state
  if (config.mediaBasePath) {
    const fileAdapter = registry.get('files');
    if (fileAdapter) {
      registry.register(
        new FreshVideoAdapter({ fileAdapter, mediaProgressMemory }),
        { category: freshvideoManifest.capability, provider: freshvideoManifest.provider }
      );
    }
  }
```

**Step 3: Run existing tests to verify no regressions**

Run: `npx vitest run tests/isolated/`
Expected: All existing tests PASS

**Step 4: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat: register FreshVideoAdapter in content source registry"
```

---

### Task 4: Watchlist "never empty" fallback

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs:941-989` (watchlist path)
- Modify: `tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs`

**Step 1: Write the failing test**

Add to the end of `tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs`:

```javascript
describe('Watchlist "never empty" fallback', () => {
  it('returns first item when all watchlist items are filtered out', async () => {
    const episodes = makeEpisodes(3);
    const registry = makeMockRegistry(episodes);
    const memory = makeMockMemory();
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    // Simulate a watchlist where ALL items have expired skipAfter dates
    // We need to mock getList to return enriched children with metadata
    const mockChildren = [
      {
        id: 'plex:item1',
        source: 'plex',
        actions: { play: { url: '/play' } },
        metadata: { skipAfter: '2025-01-01', percent: 0 }, // expired
      },
      {
        id: 'plex:item2',
        source: 'plex',
        actions: { play: { url: '/play' } },
        metadata: { skipAfter: '2025-06-01', percent: 0 }, // expired
      },
    ];

    // Override getList to return a mock watchlist with children
    adapter.getList = vi.fn(async () => ({
      id: 'watchlist:cfmscripture',
      title: 'Scripture',
      children: mockChildren,
    }));

    const result = await adapter.resolvePlayables('watchlist:cfmscripture');

    // Should NOT be empty — fallback to first item
    expect(result.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs`
Expected: FAIL — the watchlist-never-empty test returns `[]`

**Step 3: Implement the fallback**

In `ListAdapter.mjs`, in the watchlist path of `resolvePlayables`, after the batch resolution loop (around line 987-989), add the fallback before the return:

Find this code block (approximately lines 978-989):
```javascript
      // Run in parallel batches to avoid overwhelming external APIs
      const BATCH_SIZE = 10;
      const playables = [];
      for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
        const batch = tasks.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(fn => fn()));
        for (const items of batchResults) {
          if (items?.length) playables.push(...items);
        }
      }

      return playables;
```

Replace the `return playables;` at the end with:

```javascript
      // Watchlist "never empty" fallback: if all items were filtered out
      // but the list has children, resolve the first child as fallback
      if (playables.length === 0 && list.children?.length > 0) {
        const firstChild = list.children[0];
        const resolved = this.registry.resolve(firstChild.id);
        if (resolved?.adapter) {
          const fallback = await this._getNextPlayableFromChild(firstChild, resolved);
          if (fallback) playables.push(fallback);
        }
      }

      return playables;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs`
Expected: ALL tests PASS (including new fallback test)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/list/ListAdapter.mjs tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs
git commit -m "feat: watchlist never-empty fallback returns first item when all filtered"
```

---

### Task 5: Debug and fix query:dailynews in program resolution

**Files:**
- Modify: `tests/isolated/adapter/content/query/QueryAdapter.test.mjs` (or create if needed)
- Possibly modify: `backend/src/1_adapters/content/query/QueryAdapter.mjs`
- Possibly modify: `backend/src/1_adapters/content/list/ListAdapter.mjs` (program path)

**Context:** `query:dailynews` resolves through `QueryAdapter.resolvePlayables()` which calls `#resolveFreshVideo()`. The code looks correct — `SavedQueryService.getQuery()` normalizes field names. The failure may be in the program resolution chain: `ListAdapter._getNextPlayableFromChild()` calls `resolved.adapter.resolvePlayables()` then tries to pick a "next up" item. If QueryAdapter returns items with shapes that `_getNextPlayableFromChild` doesn't expect, items may be silently lost.

**Step 1: Write isolated QueryAdapter test**

Verify `QueryAdapter.resolvePlayables('query:dailynews')` returns items when given proper mocks:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { QueryAdapter } from '#adapters/content/query/QueryAdapter.mjs';

describe('QueryAdapter freshvideo resolution', () => {
  it('returns single latest unwatched video from freshvideo query', async () => {
    const adapter = new QueryAdapter({
      savedQueryService: {
        getQuery: vi.fn(() => ({
          title: 'Daily News',
          source: 'freshvideo',
          filters: { sources: ['news/world_az'] },
        })),
      },
      fileAdapter: {
        getList: vi.fn(async () => [
          { localId: 'video/news/world_az/20260121.mp4', itemType: 'leaf' },
          { localId: 'video/news/world_az/20260127.mp4', itemType: 'leaf' },
        ]),
        getItem: vi.fn(async (localId) => ({
          id: `files:${localId}`,
          localId,
          title: localId.split('/').pop(),
          source: 'files',
          metadata: {},
        })),
      },
      mediaProgressMemory: {
        get: vi.fn(async () => ({ percent: 0 })),
      },
    });

    const result = await adapter.resolvePlayables('query:dailynews');
    expect(result.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test**

Run: `npx vitest run tests/isolated/adapter/content/query/QueryAdapter.test.mjs`

If PASS: The issue is in how `ListAdapter._getNextPlayableFromChild` handles QueryAdapter results. Debug that path.

If FAIL: The issue is in QueryAdapter itself — likely `ItemSelectionService.select()` filtering all items. Fix accordingly.

**Step 3: Fix the identified issue**

The fix depends on what step 2 reveals. Most likely scenarios:

**Scenario A — ItemSelectionService freshvideo strategy filters all items:**
The `freshvideo` strategy uses `filter: ['watched']` which removes items with `watched: true`. If the filter also removes items missing a `watched` field, that's the bug. Fix: ensure items without explicit `watched: false` default to unwatched.

**Scenario B — Program path drops QueryAdapter results:**
`_getNextPlayableFromChild` expects items with specific fields. If QueryAdapter items lack `id` with the right prefix or `localId`, the progress lookup fails. Fix: ensure QueryAdapter returns items matching the expected shape.

**Step 4: Run all tests**

Run: `npx vitest run tests/isolated/`
Expected: ALL pass

**Step 5: Commit**

```bash
git add -A  # stage relevant changed files
git commit -m "fix: query:dailynews freshvideo resolution in program queue"
```

---

### Task 6: Integration verification

**Step 1: Start dev server if not running**

```bash
lsof -i :3111  # check if already running
# If not: npm run dev
```

**Step 2: Curl the API and count items**

```bash
curl -s http://localhost:3111/api/v1/queue/program:morning-program | jq '.count, [.items[].title]'
```

**Expected:** Count should be 8 (was 4). All these titles should appear:
- Good Morning (sfx/intro)
- 10 Min News (query:dailynews)
- Come Follow Me Supplement (watchlist:comefollowme2025)
- Crash Course Kids (plex:375839)
- Ted Ed (freshvideo:teded)
- D&C item (watchlist:cfmscripture — fallback)
- General Conference talk (talk:ldsgc)
- Wrap Up (app:wrapup)

**Step 3: If any missing, debug with curl to individual sources**

```bash
# Test freshvideo directly
curl -s http://localhost:3111/api/v1/queue/freshvideo:teded | jq '.count'

# Test query directly
curl -s http://localhost:3111/api/v1/queue/query:dailynews | jq '.count'

# Test app directly
curl -s http://localhost:3111/api/v1/queue/app:wrapup | jq '.count'
```

**Step 4: Final commit if any integration fixes needed**

```bash
git commit -m "fix: integration fixes for morning-program queue resolution"
```
