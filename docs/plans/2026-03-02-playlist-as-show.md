# Playlist-as-Show Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow Plex playlists to appear as show cards in FitnessMenu and render with virtual paginated seasons in FitnessShow.

**Architecture:** The list router (HTTP layer) detects when a requested ID is a playlist and returns a single container item instead of expanding its children. FitnessShow detects `info.type === 'playlist'` and creates virtual season groups client-side from a configurable page size. PlexAdapter internals (`getList`, `resolvePlayables`) are unchanged — only the HTTP response shape changes for playlists.

**Tech Stack:** Express (backend list router), React (FitnessShow.jsx), PlexAdapter (getContainerInfo fix), YAML config

---

### Task 1: Fix PlexAdapter.getContainerInfo for playlist thumbnails

Playlists use `composite` (auto-generated mosaic) instead of `thumb` for their image. Currently `getContainerInfo()` only checks `item.thumb`, so playlist images return `null`.

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:1036`
- Test: `tests/isolated/adapter/content/PlexAdapter.test.mjs`

**Step 1: Write the failing test**

Add to the existing `PlexAdapter.test.mjs` file, in a new describe block after the existing `getList polymorphic input` block (after line 583):

```javascript
describe('getContainerInfo', () => {
  let adapter;
  let mockClient;
  let mockHttpClient;

  beforeEach(() => {
    mockHttpClient = { get: jest.fn(), post: jest.fn() };
    adapter = new PlexAdapter(
      { host: 'http://localhost:32400', token: 'test-token' },
      { httpClient: mockHttpClient }
    );
    mockClient = {
      getContainer: jest.fn(),
      getMetadata: jest.fn()
    };
    adapter.client = mockClient;
  });

  test('uses composite thumbnail for playlists', async () => {
    mockClient.getMetadata.mockResolvedValue({
      MediaContainer: {
        Metadata: [{
          ratingKey: '450234',
          title: 'Stretch Playlist',
          type: 'playlist',
          playlistType: 'video',
          composite: '/playlists/450234/composite/abc123',
          leafCount: 45
        }]
      }
    });

    const info = await adapter.getContainerInfo('plex:450234');
    expect(info.image).toContain('/playlists/450234/composite/abc123');
    expect(info.type).toBe('playlist');
  });

  test('uses thumb for non-playlist containers', async () => {
    mockClient.getMetadata.mockResolvedValue({
      MediaContainer: {
        Metadata: [{
          ratingKey: '662027',
          title: '630',
          type: 'show',
          thumb: '/library/metadata/662027/thumb/abc',
          leafCount: 120
        }]
      }
    });

    const info = await adapter.getContainerInfo('plex:662027');
    expect(info.image).toContain('/library/metadata/662027/thumb/abc');
    expect(info.type).toBe('show');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/content/PlexAdapter.test.mjs --testNamePattern="getContainerInfo" -v`
Expected: The playlist test FAILS because `info.image` is `null` (only `item.thumb` is checked, not `item.composite`).

**Step 3: Write minimal implementation**

In `PlexAdapter.mjs`, change line 1036 from:

```javascript
image: item.thumb ? `${this.proxyPath}${item.thumb}` : null,
```

to:

```javascript
image: (item.thumb || item.composite) ? `${this.proxyPath}${item.thumb || item.composite}` : null,
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/adapter/content/PlexAdapter.test.mjs --testNamePattern="getContainerInfo" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/PlexAdapter.mjs tests/isolated/adapter/content/PlexAdapter.test.mjs
git commit -m "fix(plex): use composite thumbnail for playlists in getContainerInfo"
```

---

### Task 2: List router returns playlist as single container item

When the list API resolves a playlist ID, instead of returning 100+ individual tracks, it returns a single "show" container item. This makes playlists appear as show cards in FitnessMenu with zero frontend changes.

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs:404-450`
- Test: `tests/isolated/api/list-router-playlist.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/isolated/api/list-router-playlist.test.mjs`:

```javascript
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createListRouter } from '../../../backend/src/4_api/v1/routers/list.mjs';

/**
 * Test that the list router wraps playlists as single container items.
 * When /api/v1/list/plex/{playlistId} is called and the ID is a playlist,
 * the response should contain a single "show" container item (not the playlist's tracks).
 */
describe('list router playlist-as-show', () => {
  let app;
  let mockAdapter;
  let mockRegistry;
  let mockContentIdResolver;

  beforeEach(() => {
    // Mock adapter with playlist behavior
    mockAdapter = {
      getList: jest.fn(),
      getItem: jest.fn(),
      getContainerInfo: jest.fn()
    };

    mockRegistry = {
      get: jest.fn().mockReturnValue(mockAdapter)
    };

    mockContentIdResolver = {
      resolve: jest.fn().mockReturnValue({
        adapter: mockAdapter,
        localId: '450234',
        source: 'plex'
      })
    };

    const router = createListRouter({
      registry: mockRegistry,
      contentIdResolver: mockContentIdResolver,
      logger: { info: jest.fn(), warn: jest.fn() }
    });

    app = express();
    app.use('/api/v1/list', router);
  });

  test('wraps playlist as single show container item', async () => {
    // getList returns playlist tracks (normal adapter behavior)
    mockAdapter.getList.mockResolvedValue([
      { id: 'plex:1001', title: 'Track 1', mediaUrl: '/stream/1001', itemType: 'leaf', metadata: { type: 'episode' } },
      { id: 'plex:1002', title: 'Track 2', mediaUrl: '/stream/1002', itemType: 'leaf', metadata: { type: 'episode' } }
    ]);

    // getItem returns playlist metadata
    mockAdapter.getItem.mockResolvedValue({
      id: 'plex:450234',
      title: 'Stretch Playlist',
      thumbnail: '/proxy/plex/composite/450234'
    });

    // getContainerInfo identifies it as a playlist
    mockAdapter.getContainerInfo.mockResolvedValue({
      key: '450234',
      title: 'Stretch Playlist',
      image: '/proxy/plex/composite/450234',
      type: 'playlist',
      playlistType: 'video',
      childCount: 45
    });

    const res = await request(app).get('/api/v1/list/plex/450234');

    expect(res.status).toBe(200);
    // Should return exactly 1 item (the playlist as a container), not 2 tracks
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type).toBe('show');
    expect(res.body.items[0].itemType).toBe('container');
    expect(res.body.items[0].title).toBe('Stretch Playlist');
    expect(res.body.items[0].id).toBe('plex:450234');
  });

  test('does NOT wrap collections as containers', async () => {
    mockAdapter.getList.mockResolvedValue([
      { id: 'plex:662027', title: '630', itemType: 'container', metadata: { type: 'show' } },
      { id: 'plex:662028', title: 'HIIT', itemType: 'container', metadata: { type: 'show' } }
    ]);

    mockAdapter.getItem.mockResolvedValue({
      id: 'plex:364851',
      title: 'Stretch Collection',
      thumbnail: '/proxy/plex/thumb/364851'
    });

    mockAdapter.getContainerInfo.mockResolvedValue({
      key: '364851',
      title: 'Stretch Collection',
      type: 'collection',
      childCount: 12
    });

    const res = await request(app).get('/api/v1/list/plex/364851');

    expect(res.status).toBe(200);
    // Should return the 2 shows, NOT a single container
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].type).toBe('show');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/api/list-router-playlist.test.mjs -v`
Expected: FAIL — the playlist test returns 2 items (tracks) instead of 1 (container).

**Step 3: Write minimal implementation**

In `list.mjs`, add the playlist wrapping logic after the `containerInfo` and `info` are fetched (after line 411), before the `parents` block:

```javascript
      // Build response
      const containerInfo = adapter.getItem ? await adapter.getItem(compoundId) : null;

      // Build info object for FitnessShow compatibility
      let info = null;
      if (adapter.getContainerInfo) {
        info = await adapter.getContainerInfo(compoundId);
      }

      // === NEW: Playlist-as-show wrapping ===
      // When the container is a playlist, return a single "show" container item
      // instead of the playlist's individual tracks. This makes playlists appear
      // as show cards in FitnessMenu. resolvePlayables() (used by FitnessShow)
      // calls the adapter directly and is NOT affected by this HTTP-layer change.
      if (info?.type === 'playlist') {
        const playlistItem = {
          id: `${source}:${localId}`,
          localId: String(localId),
          title: containerInfo?.title || info?.title || localId,
          label: containerInfo?.title || info?.title || localId,
          itemType: 'container',
          childCount: info?.childCount || items.length,
          thumbnail: containerInfo?.thumbnail || info?.image,
          metadata: {
            type: 'show',
            sourceType: 'playlist',
            rating: null
          },
          actions: {
            list: { contentId: `${source}:${localId}`, [source]: String(localId) }
          }
        };
        items = [playlistItem];
      }
      // === END playlist-as-show wrapping ===
```

This goes right after the `info` assignment (after line 411) and before the `parents` block (line 414).

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/api/list-router-playlist.test.mjs -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/list.mjs tests/isolated/api/list-router-playlist.test.mjs
git commit -m "feat(list-api): wrap playlists as show containers in list response"
```

---

### Task 3: FitnessShow virtual seasons for playlists

When FitnessShow receives a response where `info.type === 'playlist'`, it creates virtual season groups from the flat item list using a configurable page size from the fitness config.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessShow.jsx:254-255`
- Test: `tests/isolated/frontend/playlistVirtualSeasons.test.mjs` (new)

**Step 1: Write the failing test for the utility function**

Extract the virtual season logic into a testable pure function. Create `tests/isolated/frontend/playlistVirtualSeasons.test.mjs`:

```javascript
import { describe, test, expect } from '@jest/globals';
import { buildVirtualSeasons } from '../../../frontend/src/modules/Fitness/lib/playlistVirtualSeasons.js';

describe('buildVirtualSeasons', () => {
  test('creates virtual parents and assigns parentId to items', () => {
    const items = Array.from({ length: 45 }, (_, i) => ({
      id: `plex:${1000 + i}`,
      title: `Episode ${i + 1}`
    }));

    const { parents, items: tagged } = buildVirtualSeasons(items, 20);

    // 45 items / 20 per page = 3 virtual seasons
    expect(Object.keys(parents)).toHaveLength(3);

    // Season titles are range-based
    const titles = Object.values(parents).map(p => p.title);
    expect(titles).toEqual(['1–20', '21–40', '41–45']);

    // All items have parentId assigned
    expect(tagged.every(item => item.parentId != null)).toBe(true);

    // First 20 items belong to first season
    const firstSeasonId = Object.keys(parents)[0];
    expect(tagged.slice(0, 20).every(item => item.parentId === firstSeasonId)).toBe(true);

    // Items 20-39 belong to second season
    const secondSeasonId = Object.keys(parents)[1];
    expect(tagged.slice(20, 40).every(item => item.parentId === secondSeasonId)).toBe(true);
  });

  test('handles items fewer than page size (single season)', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `plex:${i}`,
      title: `Episode ${i + 1}`
    }));

    const { parents, items: tagged } = buildVirtualSeasons(items, 20);

    expect(Object.keys(parents)).toHaveLength(1);
    expect(Object.values(parents)[0].title).toBe('1–5');
  });

  test('handles empty items', () => {
    const { parents, items: tagged } = buildVirtualSeasons([], 20);
    expect(Object.keys(parents)).toHaveLength(0);
    expect(tagged).toHaveLength(0);
  });

  test('respects custom page size', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: `plex:${i}`,
      title: `Episode ${i + 1}`
    }));

    const { parents } = buildVirtualSeasons(items, 10);

    expect(Object.keys(parents)).toHaveLength(3);
    const titles = Object.values(parents).map(p => p.title);
    expect(titles).toEqual(['1–10', '11–20', '21–30']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/frontend/playlistVirtualSeasons.test.mjs -v`
Expected: FAIL — module `playlistVirtualSeasons.js` does not exist.

**Step 3: Create the utility function**

Create `frontend/src/modules/Fitness/lib/playlistVirtualSeasons.js`:

```javascript
/**
 * Build virtual season groups from a flat playlist item list.
 * Used by FitnessShow to paginate playlists that have no real seasons.
 *
 * @param {Object[]} items - Flat array of playlist items
 * @param {number} pageSize - Number of items per virtual season
 * @returns {{ parents: Object, items: Object[] }} Virtual parents map and items with parentId assigned
 */
export function buildVirtualSeasons(items, pageSize) {
  if (!items || items.length === 0) {
    return { parents: {}, items: [] };
  }

  const parents = {};
  const tagged = items.map((item, i) => {
    const pageNum = Math.floor(i / pageSize);
    const virtualId = `virtual-season-${pageNum}`;
    const start = pageNum * pageSize + 1;
    const end = Math.min(start + pageSize - 1, items.length);

    if (!parents[virtualId]) {
      parents[virtualId] = {
        index: pageNum,
        title: `${start}–${end}`,
        thumbnail: null
      };
    }

    return { ...item, parentId: virtualId, parentIndex: pageNum };
  });

  return { parents, items: tagged };
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/frontend/playlistVirtualSeasons.test.mjs -v`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/playlistVirtualSeasons.js tests/isolated/frontend/playlistVirtualSeasons.test.mjs
git commit -m "feat(fitness): add buildVirtualSeasons utility for playlist pagination"
```

---

### Task 4: Integrate virtual seasons into FitnessShow

Wire up the `buildVirtualSeasons` utility in FitnessShow's `fetchShowData` callback.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessShow.jsx:242-255`

**Step 1: Add import**

At the top of `FitnessShow.jsx`, add after the existing imports:

```javascript
import { buildVirtualSeasons } from './lib/playlistVirtualSeasons.js';
```

**Step 2: Add virtual season logic in fetchShowData**

In the `fetchShowData` callback, replace line 255:

```javascript
      setShowData(response);
```

with:

```javascript
      // If this is a playlist, create virtual seasons for pagination
      if (response.info?.type === 'playlist') {
        const pageSize = plexConfig?.playlist_episodes_per_season || 20;
        const { parents, items: taggedItems } = buildVirtualSeasons(response.items || [], pageSize);
        response.parents = parents;
        response.items = taggedItems;
        // Use playlist image for show display
        if (!response.image && response.info?.image) {
          response.image = response.info.image;
        }
      }
      setShowData(response);
```

Note: `plexConfig` is available via `useFitnessContext()`. Check that FitnessShow destructures it from context. If not already available, add it to the destructured values from the fitness context hook near the top of the component.

**Step 3: Verify plexConfig availability**

Check the top of FitnessShow.jsx for context usage. If `plexConfig` is not already destructured, add it. The fitness context exposes `plexConfig` (see `FitnessContext.jsx:468`). Find where FitnessShow calls `useFitnessContext()` or receives plex config as a prop, and ensure `plexConfig` is accessible in `fetchShowData`.

If it comes via props or context, add it to the `useCallback` dependency array:

```javascript
  }, [showId, nomusicLabelSet, plexConfig]);
```

**Step 4: Manual test**

1. Update fitness.yml on prod (Task 5) to add `playlist_episodes_per_season: 20` and playlist 450234 to Stretch collection_ids
2. Navigate to Stretch in the fitness app
3. Verify the playlist appears as a show card alongside other shows
4. Click the playlist card — FitnessShow should open with virtual season tabs ("1–20", "21–40", etc.)
5. Verify season filtering works and episodes play correctly

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessShow.jsx
git commit -m "feat(fitness): integrate virtual seasons for playlist-as-show in FitnessShow"
```

---

### Task 5: Add config to fitness.yml

Add the playlist page size config and update the Stretch nav_item.

**Files:**
- Modify: `data/household/config/fitness.yml` (on prod via SSH/Docker)

**Step 1: Add playlist_episodes_per_season to plex section**

Under `plex:` (after existing fields like `resumable_labels`), add:

```yaml
plex:
  library_id: 14
  playlist_episodes_per_season: 20
  # ... rest of existing config
```

**Step 2: Update Stretch nav_item**

Change the Stretch entry in `nav_items` from:

```yaml
    - type: plex_collection_group
      name: Stretch
      icon: stretch
      order: 90
      target:
        collection_ids: [364851] # playlist: 450234
```

to:

```yaml
    - type: plex_collection_group
      name: Stretch
      icon: stretch
      order: 90
      target:
        collection_ids: [364851, 450234]
```

**Step 3: Restart Docker container to pick up config change**

```bash
ssh homeserver.local 'docker restart daylight-station'
```

**Step 4: Verify**

Navigate to `/fitness` → click Stretch → confirm playlist 450234 appears as a show card in the grid alongside collection 364851's shows.

---

### Task 6: End-to-end verification

**Step 1: Verify menu flow**

1. Open `/fitness` → click Stretch nav item
2. Confirm the grid shows shows from collection 364851 PLUS one card for playlist 450234
3. The playlist card should have the playlist's composite thumbnail and title

**Step 2: Verify show flow**

1. Click the playlist card
2. FitnessShow opens with virtual season tabs: "1–20", "21–40", etc.
3. Click between seasons — episode grid filters correctly
4. Click an episode — it plays via the normal video player

**Step 3: Verify non-regression**

1. Click a real show (non-playlist) from the Stretch grid — FitnessShow works normally with real seasons
2. Navigate to other collections (Strength, Cardio, etc.) — no changes in behavior
3. Music playlist selector still works (uses config, not list API)
