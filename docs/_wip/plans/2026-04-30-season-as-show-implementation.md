# Season-as-Show Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a Plex season ID to be placed in a Fitness `collection_ids` array and surface it as a standalone tile in `FitnessMenu`, mirroring the existing playlist-as-show pattern.

**Architecture:** Three small backend changes: (1) `PlexAdapter.getContainerInfo` exposes `rating`/`userRating` (for tile sorting) and `parentRatingKey` (for show label inheritance); (2) the list router gains a `season` branch parallel to its existing `playlist` branch, wrapping the season as one show-shaped tile; (3) `FitnessPlayableService` detects `info.type === 'season'` and copies labels from the parent show's `getContainerInfo` into the season's `info` so governance/resume/sequential flags propagate. Frontend requires no changes — `FitnessShow`'s existing single-season render path handles `info.type='season'` correctly.

**Tech Stack:** Node.js 20+, Express, Plex API (HTTP), Jest (test harness invokes via `tests/_infrastructure/harnesses/isolated.harness.mjs` for `tests/isolated/api/`, `tests/isolated/adapter/`, `tests/isolated/application/`).

**Spec:** `docs/_wip/plans/2026-04-30-season-as-show-design.md`

**Out of scope (per spec):** Plex CLI rename support, fitness.yml edits, override maps, virtual sub-seasons, hiding parent show. Frontend code changes.

---

## File Structure

| File | Role |
|------|------|
| `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` | Modify `getContainerInfo` to surface rating + parent linkage. |
| `backend/src/4_api/v1/routers/list.mjs` | Add season-tile wrapper alongside existing playlist wrapper. |
| `backend/src/3_applications/fitness/FitnessPlayableService.mjs` | Inherit parent show's labels into season `info`. |
| `tests/isolated/adapter/content/PlexAdapter.test.mjs` | Add cases for `getContainerInfo` returning rating + parentRatingKey. |
| `tests/isolated/api/list-router-season.test.mjs` | New file. Mirrors `list-router-playlist.test.mjs` for season. |
| `tests/isolated/application/fitness/FitnessPlayableService.season.test.mjs` | New file. Covers label inheritance and missing-parent fallback. |

No new files in production code; no frontend changes.

---

## Task 1: Expose rating + parentRatingKey from `PlexAdapter.getContainerInfo`

**Why this first:** Tasks 2 and 3 read these fields from `getContainerInfo`'s response. Without them the downstream code would have no rating to sort the tile by and no parent ratingKey to fetch the show's labels.

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:1064-1080`
- Modify: `tests/isolated/adapter/content/PlexAdapter.test.mjs`

- [ ] **Step 1: Find the existing `getContainerInfo` test block**

Run: `grep -n "describe.*getContainerInfo\|getContainerInfo" tests/isolated/adapter/content/PlexAdapter.test.mjs | head`

Expected: at least one match showing where `getContainerInfo` is exercised, OR no match (in which case we add a new `describe` block at the bottom of the file).

- [ ] **Step 2: Add the failing tests**

Append (or extend the existing `describe('getContainerInfo')` block) at the bottom of `tests/isolated/adapter/content/PlexAdapter.test.mjs`:

```js
describe('getContainerInfo - rating and parent linkage', () => {
  test('exposes rating and userRating from Plex metadata', async () => {
    const mockClient = {
      getMetadata: vi.fn().mockResolvedValue({
        MediaContainer: {
          Metadata: [{
            ratingKey: '603856',
            type: 'season',
            title: 'Season 2023121',
            thumb: '/library/metadata/603856/thumb/1',
            userRating: 8,
            rating: 7.5,
            parentRatingKey: '603855',
            parentTitle: 'Super Blocks'
          }]
        }
      })
    };
    const adapter = new PlexAdapter({ client: mockClient, proxyPath: '/proxy' });

    const info = await adapter.getContainerInfo('plex:603856');

    expect(info.rating).toBe(7.5);
    expect(info.userRating).toBe(8);
  });

  test('exposes parentRatingKey for seasons', async () => {
    const mockClient = {
      getMetadata: vi.fn().mockResolvedValue({
        MediaContainer: {
          Metadata: [{
            ratingKey: '603856',
            type: 'season',
            title: 'Season 2023121',
            parentRatingKey: '603855',
            parentTitle: 'Super Blocks'
          }]
        }
      })
    };
    const adapter = new PlexAdapter({ client: mockClient, proxyPath: '/proxy' });

    const info = await adapter.getContainerInfo('plex:603856');

    expect(info.parentRatingKey).toBe('603855');
    expect(info.type).toBe('season');
  });

  test('rating fields default to null when absent', async () => {
    const mockClient = {
      getMetadata: vi.fn().mockResolvedValue({
        MediaContainer: {
          Metadata: [{
            ratingKey: '999',
            type: 'show',
            title: 'No Rating Show'
          }]
        }
      })
    };
    const adapter = new PlexAdapter({ client: mockClient, proxyPath: '/proxy' });

    const info = await adapter.getContainerInfo('plex:999');

    expect(info.rating).toBeNull();
    expect(info.userRating).toBeNull();
    expect(info.parentRatingKey).toBeNull();
  });
});
```

If the existing test file's `import` line for `vi` is missing, add `import { vi } from 'vitest';` at the top — match the pattern of other tests in `tests/isolated/adapter/content/`.

- [ ] **Step 3: Run the new tests to confirm they fail**

Run: `npx jest tests/isolated/adapter/content/PlexAdapter.test.mjs -t "rating and parent linkage"`

Expected: FAIL with messages like `Expected: 7.5, Received: undefined` and `Expected: "603855", Received: undefined`. The first two new tests fail because the current `getContainerInfo` return object has no rating/parentRatingKey keys; the third may pass partially (existing fields default reasonably) but its `parentRatingKey` assertion fails.

- [ ] **Step 4: Update `getContainerInfo` to expose the new fields**

Modify `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` lines 1064-1080.

Replace the return object with:

```js
      return {
        key: localId,
        title: item.title,
        image: (item.thumb || item.composite) ? `${this.proxyPath}${item.thumb || item.composite}` : null,
        summary: item.summary || null,
        tagline: item.tagline || null,
        year: item.year || null,
        studio: item.studio || null,
        type: item.type || null,
        contentType: item.type || null,
        labels,
        collections,
        // Additional fields that might be useful
        duration: item.duration ? Math.floor(item.duration / 1000) : null,
        ratingKey: item.ratingKey,
        childCount: item.leafCount || item.childCount || 0,
        // Rating fields for season-as-show tile sorting (FitnessMenu)
        rating: item.userRating ?? item.rating ?? item.audienceRating ?? null,
        userRating: item.userRating ?? null,
        // Parent linkage for season label inheritance (season -> show)
        parentRatingKey: item.parentRatingKey ?? null,
        parentTitle: item.parentTitle ?? null
      };
```

- [ ] **Step 5: Run the new tests to confirm they pass**

Run: `npx jest tests/isolated/adapter/content/PlexAdapter.test.mjs -t "rating and parent linkage"`

Expected: 3 passing.

- [ ] **Step 6: Run the full PlexAdapter test file to confirm no regression**

Run: `npx jest tests/isolated/adapter/content/PlexAdapter.test.mjs`

Expected: all tests pass (existing + 3 new). If any pre-existing test breaks because it asserted on the exact shape of `getContainerInfo`'s return object, update its expected shape — the new fields are additive, so the only failure mode is `toEqual({...})` comparisons that need the new keys.

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/PlexAdapter.mjs tests/isolated/adapter/content/PlexAdapter.test.mjs
git commit -m "feat(plex): expose rating + parentRatingKey from getContainerInfo

Adds rating, userRating, parentRatingKey, parentTitle to the
getContainerInfo response. Required for season-as-show: list router
sorts tiles by rating, FitnessPlayableService walks parentRatingKey
to inherit show labels."
```

---

## Task 2: Wrap seasons as single tiles in the list router

**Why now:** With `getContainerInfo` exposing rating, the list router can build a season tile that sorts correctly in `FitnessMenu`.

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs:432-451` (add a parallel `season` branch immediately after the `playlist` branch)
- Create: `tests/isolated/api/list-router-season.test.mjs`

- [ ] **Step 1: Create the failing test file**

Create `tests/isolated/api/list-router-season.test.mjs`:

```js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createListRouter } from '#backend/src/4_api/v1/routers/list.mjs';

/**
 * Test that the list router wraps seasons as single container items.
 * When /api/v1/list/plex/{seasonId} is called and the ID is a Plex season,
 * the response should contain a single "show" container item with
 * sourceType:'season' (not the season's individual episodes), so it appears
 * as a single tile in FitnessMenu alongside collection shows and playlists.
 */
describe('list router season-as-show', () => {
  let app;
  let mockAdapter;
  let mockContentIdResolver;

  beforeEach(() => {
    mockAdapter = {
      getList: vi.fn(),
      getItem: vi.fn(),
      getContainerInfo: vi.fn()
    };

    mockContentIdResolver = {
      resolve: vi.fn().mockReturnValue({
        adapter: mockAdapter,
        localId: '603856',
        source: 'plex'
      })
    };

    const router = createListRouter({
      registry: {},
      contentIdResolver: mockContentIdResolver,
      logger: { info: vi.fn(), warn: vi.fn() }
    });

    app = express();
    app.use('/api/v1/list', router);
  });

  test('wraps season as single show container item with sourceType=season', async () => {
    // getList returns the season's episodes (normal adapter behavior for a season ID)
    mockAdapter.getList.mockResolvedValue([
      { id: 'plex:1001', title: 'Day 1', mediaUrl: '/stream/1001', itemType: 'leaf', metadata: { type: 'episode' } },
      { id: 'plex:1002', title: 'Day 2', mediaUrl: '/stream/1002', itemType: 'leaf', metadata: { type: 'episode' } }
    ]);

    mockAdapter.getItem.mockResolvedValue({
      id: 'plex:603856',
      title: 'LIIFT MORE Super Block',
      thumbnail: '/proxy/plex/library/metadata/603856/thumb/1'
    });

    mockAdapter.getContainerInfo.mockResolvedValue({
      key: '603856',
      title: 'LIIFT MORE Super Block',
      image: '/proxy/plex/library/metadata/603856/thumb/1',
      type: 'season',
      childCount: 22,
      rating: 9,
      userRating: 9,
      parentRatingKey: '603855',
      parentTitle: 'Super Blocks',
      labels: []
    });

    const res = await request(app).get('/api/v1/list/plex/603856');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const tile = res.body.items[0];
    expect(tile.id).toBe('plex:603856');
    expect(tile.title).toBe('LIIFT MORE Super Block');
    expect(tile.itemType).toBe('container');
    expect(tile.type).toBe('show');
    expect(tile.metadata?.sourceType).toBe('season');
    expect(tile.metadata?.type).toBe('show');
  });

  test('passes rating through to tile metadata for menu sorting', async () => {
    mockAdapter.getList.mockResolvedValue([]);
    mockAdapter.getItem.mockResolvedValue({ id: 'plex:603856', title: 'LIIFT MORE Super Block' });
    mockAdapter.getContainerInfo.mockResolvedValue({
      key: '603856',
      title: 'LIIFT MORE Super Block',
      type: 'season',
      childCount: 22,
      rating: 9,
      userRating: 9,
      parentRatingKey: '603855'
    });

    const res = await request(app).get('/api/v1/list/plex/603856');

    expect(res.status).toBe(200);
    const tile = res.body.items[0];
    // toListItem flattens metadata.rating and metadata.userRating to top-level
    expect(tile.rating).toBe(9);
    expect(tile.userRating).toBe(9);
  });

  test('uses season image as tile thumbnail', async () => {
    mockAdapter.getList.mockResolvedValue([]);
    mockAdapter.getItem.mockResolvedValue({ id: 'plex:603856', title: 'LIIFT MORE Super Block' });
    mockAdapter.getContainerInfo.mockResolvedValue({
      key: '603856',
      title: 'LIIFT MORE Super Block',
      image: '/proxy/plex/library/metadata/603856/thumb/1',
      type: 'season',
      childCount: 22,
      rating: 9
    });

    const res = await request(app).get('/api/v1/list/plex/603856');

    expect(res.status).toBe(200);
    const tile = res.body.items[0];
    expect(tile.thumbnail).toBe('/proxy/plex/library/metadata/603856/thumb/1');
  });

  test('absent rating falls through to null without crashing', async () => {
    mockAdapter.getList.mockResolvedValue([]);
    mockAdapter.getItem.mockResolvedValue({ id: 'plex:603856', title: 'Unrated Season' });
    mockAdapter.getContainerInfo.mockResolvedValue({
      key: '603856',
      title: 'Unrated Season',
      type: 'season',
      childCount: 5
      // no rating field
    });

    const res = await request(app).get('/api/v1/list/plex/603856');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const tile = res.body.items[0];
    // null/undefined rating is acceptable; the existing FitnessMenu sort
    // uses (b.rating || 0) so unrated tiles sink to the bottom.
    expect(tile.rating == null).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/isolated/api/list-router-season.test.mjs`

Expected: 4 failing tests. The first three fail because the router currently does not match `info?.type === 'season'`, so the response contains the raw episode list (or empty array) instead of a single wrapped tile. The fourth test will likely also fail in the same way.

- [ ] **Step 3: Add the season branch to the list router**

Modify `backend/src/4_api/v1/routers/list.mjs`. Locate the existing playlist wrapping block at lines 432-451:

```js
      if (info?.type === 'playlist') {
        const playlistItem = {
          id: `${source}:${localId}`,
          ...
        };
        items = [playlistItem];
      }
```

**Immediately after** that closing `}`, insert:

```js
      // === Season-as-show wrapping ===
      // When the container is a Plex season, return a single "show" container
      // item instead of the season's episodes. The season is then surfaced as
      // its own tile in FitnessMenu alongside collection shows and playlists.
      // Rating comes from the season's own Plex metadata, so the tile sorts
      // by its individual rating (Q6: seasons sort like regular shows).
      // resolvePlayables() (used by FitnessShow) calls the adapter directly
      // and is NOT affected by this HTTP-layer change.
      if (info?.type === 'season') {
        const seasonItem = {
          id: `${source}:${localId}`,
          localId: String(localId),
          title: containerInfo?.title || info?.title || localId,
          label: containerInfo?.title || info?.title || localId,
          itemType: 'container',
          childCount: info?.childCount || items.length,
          thumbnail: info?.image || containerInfo?.thumbnail,
          metadata: {
            type: 'show',
            sourceType: 'season',
            rating: info?.rating ?? null,
            userRating: info?.userRating ?? null
          },
          actions: {
            list: { contentId: `${source}:${localId}`, [source]: String(localId) }
          }
        };
        items = [seasonItem];
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/isolated/api/list-router-season.test.mjs`

Expected: 4 passing.

- [ ] **Step 5: Run the playlist test to confirm no regression**

Run: `npx jest tests/isolated/api/list-router-playlist.test.mjs`

Expected: all existing tests still pass. The playlist branch is unchanged; the season branch only fires when `info.type === 'season'`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/list.mjs tests/isolated/api/list-router-season.test.mjs
git commit -m "feat(api): wrap Plex seasons as single show tiles in list router

Mirrors the existing playlist-as-show wrapping. When
GET /api/v1/list/plex/{id} resolves to a Plex season, the response
contains one tile with sourceType:'season' instead of the season's
episodes. Rating is taken from the season's own Plex metadata so
the tile sorts correctly in FitnessMenu's rating-based sort."
```

---

## Task 3: Inherit show labels in `FitnessPlayableService` for seasons

**Why now:** With Task 2 the menu tile renders correctly. Tapping it routes to `FitnessShow`, which calls `/api/v1/fitness/show/{seasonId}/playable`. Without label inheritance, governance/resumable/sequential flags collapse to defaults — wrong for any season inside a tagged show.

**Files:**
- Modify: `backend/src/3_applications/fitness/FitnessPlayableService.mjs:78-95`
- Create: `tests/isolated/application/fitness/FitnessPlayableService.season.test.mjs`

- [ ] **Step 1: Create the failing test file**

Create `tests/isolated/application/fitness/FitnessPlayableService.season.test.mjs`:

```js
import { describe, test, expect, vi } from 'vitest';
import { FitnessPlayableService } from '#backend/src/3_applications/fitness/FitnessPlayableService.mjs';

/**
 * Tests for season-as-show label inheritance.
 * When the playable target is a Plex season (info.type='season'),
 * the service must fetch the parent show's metadata and copy its labels
 * onto the season's info so governance/resumable/sequential flags
 * propagate to the FitnessShow UI.
 */
describe('FitnessPlayableService - season label inheritance', () => {
  function buildDeps(overrides = {}) {
    return {
      fitnessConfigService: {
        loadRawConfig: vi.fn().mockReturnValue({ progressClassification: {} })
      },
      contentAdapter: {
        resolvePlayables: vi.fn().mockResolvedValue([]),
        getContainerInfo: vi.fn(),
        getItem: vi.fn().mockResolvedValue(null)
      },
      contentQueryService: null,
      createProgressClassifier: () => ({ classify: () => 'unknown' }),
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
      ...overrides
    };
  }

  test('copies parent show labels onto season info', async () => {
    const deps = buildDeps();
    deps.contentAdapter.getContainerInfo.mockImplementation(async (id) => {
      if (id === 'plex:603856') {
        return {
          key: '603856',
          title: 'LIIFT MORE Super Block',
          type: 'season',
          labels: [],                          // season has no labels of its own
          parentRatingKey: '603855',
          parentTitle: 'Super Blocks'
        };
      }
      if (id === 'plex:603855') {
        return {
          key: '603855',
          title: 'Super Blocks',
          type: 'show',
          labels: ['Strength', 'Sequential']   // labels live on the show
        };
      }
      return null;
    });

    const svc = new FitnessPlayableService(deps);
    const result = await svc.getPlayableEpisodes('603856');

    expect(result.info.type).toBe('season');
    expect(result.info.labels).toEqual(['Strength', 'Sequential']);
    // Parent fetch should have happened
    expect(deps.contentAdapter.getContainerInfo).toHaveBeenCalledWith('plex:603855');
  });

  test('preserves the season own title and image (does not overwrite with show)', async () => {
    const deps = buildDeps();
    deps.contentAdapter.getContainerInfo.mockImplementation(async (id) => {
      if (id === 'plex:603856') {
        return {
          key: '603856',
          title: 'LIIFT MORE Super Block',
          image: '/season-thumb',
          summary: 'Curated lift season',
          type: 'season',
          labels: [],
          parentRatingKey: '603855'
        };
      }
      if (id === 'plex:603855') {
        return {
          key: '603855',
          title: 'Super Blocks',
          image: '/show-thumb',
          summary: 'Whole show summary',
          type: 'show',
          labels: ['Strength']
        };
      }
      return null;
    });

    const svc = new FitnessPlayableService(deps);
    const result = await svc.getPlayableEpisodes('603856');

    expect(result.info.title).toBe('LIIFT MORE Super Block');   // season title wins
    expect(result.info.image).toBe('/season-thumb');             // season image wins
    expect(result.info.summary).toBe('Curated lift season');     // season summary wins
    expect(result.info.labels).toEqual(['Strength']);            // labels inherited
  });

  test('falls back to empty labels when parent show fetch fails', async () => {
    const deps = buildDeps();
    deps.contentAdapter.getContainerInfo.mockImplementation(async (id) => {
      if (id === 'plex:603856') {
        return {
          key: '603856',
          title: 'LIIFT MORE Super Block',
          type: 'season',
          labels: [],
          parentRatingKey: '603855'
        };
      }
      if (id === 'plex:603855') {
        throw new Error('Plex 503');
      }
      return null;
    });

    const svc = new FitnessPlayableService(deps);
    const result = await svc.getPlayableEpisodes('603856');

    expect(result.info.type).toBe('season');
    expect(result.info.labels).toEqual([]); // degraded — no labels, no exception
  });

  test('does not run inheritance for non-season info (existing show flow unchanged)', async () => {
    const deps = buildDeps();
    deps.contentAdapter.getContainerInfo.mockImplementation(async (id) => {
      if (id === 'plex:603855') {
        return {
          key: '603855',
          title: 'Super Blocks',
          type: 'show',
          labels: ['Strength']
        };
      }
      return null;
    });

    const svc = new FitnessPlayableService(deps);
    await svc.getPlayableEpisodes('603855');

    // Only one call — no parent lookup for shows
    expect(deps.contentAdapter.getContainerInfo).toHaveBeenCalledTimes(1);
    expect(deps.contentAdapter.getContainerInfo).toHaveBeenCalledWith('plex:603855');
  });

  test('skips inheritance when season has its own labels (do not double up)', async () => {
    const deps = buildDeps();
    deps.contentAdapter.getContainerInfo.mockImplementation(async (id) => {
      if (id === 'plex:603856') {
        return {
          key: '603856',
          title: 'LIIFT MORE Super Block',
          type: 'season',
          labels: ['Lift'],                  // explicit labels on the season
          parentRatingKey: '603855'
        };
      }
      return null;
    });

    const svc = new FitnessPlayableService(deps);
    const result = await svc.getPlayableEpisodes('603856');

    expect(result.info.labels).toEqual(['Lift']);
    // Parent fetch should NOT have happened
    expect(deps.contentAdapter.getContainerInfo).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/isolated/application/fitness/FitnessPlayableService.season.test.mjs`

Expected: tests 1, 2, 3 fail because the service currently does no inheritance and `result.info.labels` will remain `[]`. Tests 4 and 5 may pass already because they assert *no* inheritance; verify the call counts to make sure.

- [ ] **Step 3: Add the inheritance branch**

Modify `backend/src/3_applications/fitness/FitnessPlayableService.mjs`. Find the section at lines 78-95 that fetches `info` and `containerItem`:

```js
    // Get container info and item for show metadata
    const [info, containerItem] = await Promise.all([
      this.#contentAdapter.getContainerInfo
        ? this.#contentAdapter.getContainerInfo(compoundId)
        : null,
      this.#contentAdapter.getItem
        ? this.#contentAdapter.getItem(compoundId)
        : null
    ]);

    return {
      compoundId,
      showId,
      items,
      parents,
      info,
      containerItem
    };
  }
```

Replace with:

```js
    // Get container info and item for show metadata
    const [info, containerItem] = await Promise.all([
      this.#contentAdapter.getContainerInfo
        ? this.#contentAdapter.getContainerInfo(compoundId)
        : null,
      this.#contentAdapter.getItem
        ? this.#contentAdapter.getItem(compoundId)
        : null
    ]);

    // Season-as-show: inherit labels from parent show.
    // Plex seasons rarely carry labels of their own; governance/resumable/
    // sequential flags live on the parent show. We fetch the show metadata
    // once and copy its labels onto the season's info so FitnessShow's
    // existing label-driven logic works unchanged.
    if (info?.type === 'season'
        && (!Array.isArray(info.labels) || info.labels.length === 0)
        && info.parentRatingKey
        && this.#contentAdapter.getContainerInfo) {
      try {
        const parentInfo = await this.#contentAdapter.getContainerInfo(`plex:${info.parentRatingKey}`);
        if (parentInfo && Array.isArray(parentInfo.labels) && parentInfo.labels.length > 0) {
          info.labels = parentInfo.labels;
        }
      } catch (err) {
        this.#logger.warn?.('fitness.playable.season_label_fetch_failed', {
          seasonId: compoundId,
          parentRatingKey: info.parentRatingKey,
          error: err.message
        });
        // Degraded: leave info.labels as-is (empty). User loses governance/
        // resume/sequential gating for this load only — preferable to a 500.
      }
    }

    return {
      compoundId,
      showId,
      items,
      parents,
      info,
      containerItem
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/isolated/application/fitness/FitnessPlayableService.season.test.mjs`

Expected: 5 passing.

- [ ] **Step 5: Run the existing FitnessPlayableService test to confirm no regression**

Run: `npx jest tests/isolated/application/fitness/FitnessPlayableService.completedAt.test.mjs`

Expected: all existing tests still pass. The new code path is gated on `info?.type === 'season'` and is a no-op for shows and playlists.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/fitness/FitnessPlayableService.mjs tests/isolated/application/fitness/FitnessPlayableService.season.test.mjs
git commit -m "feat(fitness): inherit parent show labels for season-as-show

When the playable target is a Plex season (info.type='season'), fetch
the parent show via parentRatingKey and copy its labels onto the
season info. This makes governance/resumable/sequential flags propagate
correctly so FitnessShow's existing label-driven UI works unchanged.

Failure to fetch the parent leaves labels empty (degraded UX, no
exception)."
```

---

## Task 4: End-to-end verification

**Why this exists:** Each task above tested its layer in isolation. This task confirms the layers compose correctly. We do not deploy or change config — we run the full isolated test suite to confirm nothing else broke.

**Files:** none modified.

- [ ] **Step 1: Run the full isolated test suite**

Run: `npm run test:isolated 2>&1 | tail -40`

Expected: all green. If anything outside the three modified files breaks, investigate before continuing.

- [ ] **Step 2: Verify no frontend code was touched**

Run: `git diff --name-only main..HEAD | grep -v ^backend/ | grep -v ^tests/ | grep -v ^docs/`

Expected: empty output. Per the spec, frontend has zero code changes. If this command lists any frontend files, audit those changes — they should not exist for this plan.

- [ ] **Step 3: Sanity-trace the data flow**

Read these three files in order to confirm the contract holds end to end:
1. `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:1064-1085` — `getContainerInfo` exposes `rating`, `userRating`, `parentRatingKey`.
2. `backend/src/4_api/v1/routers/list.mjs` (search for `season-as-show`) — wrapper builds tile with `metadata.sourceType='season'` and pulls rating from `info`.
3. `backend/src/3_applications/fitness/FitnessPlayableService.mjs` (search for `Season-as-show: inherit labels`) — reads `info.parentRatingKey` and copies labels.

Confirm: types match (`parentRatingKey` is a string in both files; `rating` is number-or-null in both), and there are no orphan references to fields that weren't added.

- [ ] **Step 4: Document deployment gating in the spec**

The spec already documents the operator workflow (section 8). No changes needed; this step is a reminder that the feature ships dormant: the code is live but no `fitness.yml` references a season ID until the operator completes the Plex-side rename of season 603856 in a separate task.

No commit for this step.

---

## Self-Review

Verifying the plan covers the spec:

- **Spec §4.1 (Data hygiene):** out of scope — operator task, not code. ✓
- **Spec §4.2 (List endpoint season branch):** Task 2. ✓
- **Spec §4.2 (Playable endpoint season branch + label inheritance):** Task 3. ✓
- **Spec §4.2.1 (Label inheritance via parentRatingKey):** Task 3, with fail-soft on parent fetch error. ✓
- **Spec §4.3 (Config syntax):** out of scope — operator change, not code. ✓
- **Spec §4.4 (Frontend):** zero changes; Task 4 step 2 verifies. ✓
- **Spec §6 edge cases:**
  - Wrong Plex type — existing list-router playlist path returns the items as-is for collections, and Task 2's branch is gated on `info?.type === 'season'`. Other types (`show`, `movie`, `episode`) fall through unchanged. ✓
  - Stale season title — operator concern, no code path needed. ✓
  - Season rating absent — Task 2 test 4 covers (`tile.rating == null`). ✓
  - Grandparent fetch fails — Task 3 test 3 covers (try/catch returns empty labels). ✓
  - Season has zero episodes — `getList` returns `[]`, Task 2's wrapper still constructs a single tile. Existing FitnessShow empty state handles the playable response. ✓
  - Episode `grandparentId` continuity — no change to episode shaping; Plex populates `grandparentRatingKey` natively. ✓
  - Inherited sequential lock — Task 3 verifies labels are copied; FitnessShow's existing `lockedEpisodeIds` consumes them unchanged. ✓
- **Spec §7 testing:**
  - Backend unit tests: Tasks 1–3. ✓
  - Live smoke (manual): not in this plan; gated on operator data hygiene. Spec section 8 documents the order. ✓
  - Plex CLI workflow validation: out of scope. ✓
- **Spec §8 (Order of operations):** code from this plan = step 1; steps 2 and 3 are operator tasks. ✓

**Placeholder scan:** none. All steps include exact file paths, exact code, exact commands, exact expected output.

**Type consistency:** verified across tasks:
- `parentRatingKey` is the Plex string from `item.parentRatingKey` (e.g. `'603855'`) in Task 1, and Task 3's inheritance code passes it through `\`plex:${info.parentRatingKey}\`` to `getContainerInfo`. ✓
- `rating` and `userRating` are numbers (or null) in Task 1, and Task 2 reads them from `info?.rating`/`info?.userRating` with `?? null` fallback. ✓
- `info.labels` is an array in all references; Task 3's gate is `!Array.isArray(info.labels) || info.labels.length === 0`. ✓

No gaps found.
