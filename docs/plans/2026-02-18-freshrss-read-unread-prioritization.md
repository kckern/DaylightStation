# FreshRSS Read/Unread Prioritization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the FreshRSS source adapter always return content (unread prioritized, read as backfill), add a standard `markRead` interface to all source adapters, and route dismiss through that interface.

**Architecture:** Two-pass fetch in `FreshRSSSourceAdapter.fetchPage()` — unread first, then all items to backfill. Read items are shuffled for variety. A new `markRead()` method on `IFeedSourceAdapter` replaces the hardcoded `freshrss:` prefix routing in the feed router's dismiss endpoint. Limits are config-driven from `feed.yml`.

**Tech Stack:** Node.js ES modules, Jest for testing, Express router, FreshRSS GReader API

---

### Task 1: Add `markRead()` to IFeedSourceAdapter interface

**Files:**
- Modify: `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs:30-32`
- Test: `tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs` (new file)

**Step 1: Add `markRead` to the interface**

In `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs`, add after the `getDetail` method (line 32):

```js
  /**
   * Mark items as read/consumed. No-op by default.
   * @param {string[]} itemIds - Prefixed item IDs (e.g. "freshrss:12345")
   * @param {string} username
   */
  async markRead(itemIds, username) {
    // No-op default — sources without read-state tracking ignore this
  }
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs
git commit -m "feat(feed): add markRead() to IFeedSourceAdapter interface"
```

---

### Task 2: Implement `markRead()` on FreshRSSSourceAdapter

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/FreshRSSSourceAdapter.mjs`
- Test: `tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs` (new file)

**Step 1: Write the failing test**

Create `tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs`:

```js
// tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs
import { jest } from '@jest/globals';
import { FreshRSSSourceAdapter } from '#adapters/feed/sources/FreshRSSSourceAdapter.mjs';

describe('FreshRSSSourceAdapter', () => {
  let adapter;
  let mockFreshRSSAdapter;

  beforeEach(() => {
    mockFreshRSSAdapter = {
      getItems: jest.fn().mockResolvedValue({ items: [], continuation: null }),
      markRead: jest.fn().mockResolvedValue(undefined),
    };
    adapter = new FreshRSSSourceAdapter({
      freshRSSAdapter: mockFreshRSSAdapter,
    });
  });

  describe('markRead', () => {
    test('strips freshrss: prefix and delegates to low-level adapter', async () => {
      await adapter.markRead(['freshrss:item-1', 'freshrss:item-2'], 'kckern');

      expect(mockFreshRSSAdapter.markRead).toHaveBeenCalledWith(
        ['item-1', 'item-2'],
        'kckern'
      );
    });

    test('handles IDs without prefix gracefully', async () => {
      await adapter.markRead(['item-1'], 'kckern');

      expect(mockFreshRSSAdapter.markRead).toHaveBeenCalledWith(
        ['item-1'],
        'kckern'
      );
    });

    test('no-ops when freshRSSAdapter is null', async () => {
      const nullAdapter = new FreshRSSSourceAdapter({ freshRSSAdapter: null });
      await expect(nullAdapter.markRead(['freshrss:item-1'], 'kckern')).resolves.toBeUndefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs --verbose
```

Expected: FAIL — `markRead` is not a function

**Step 3: Implement markRead on FreshRSSSourceAdapter**

In `backend/src/1_adapters/feed/sources/FreshRSSSourceAdapter.mjs`, add after the `fetchPage` method (after line 59):

```js
  /**
   * Mark items as read via FreshRSS GReader API.
   * @param {string[]} itemIds - Prefixed IDs ("freshrss:xxx") or raw IDs
   * @param {string} username
   */
  async markRead(itemIds, username) {
    if (!this.#freshRSSAdapter) return;
    const stripped = itemIds.map(id => id.startsWith('freshrss:') ? id.slice('freshrss:'.length) : id);
    await this.#freshRSSAdapter.markRead(stripped, username);
  }
```

**Step 4: Run test to verify it passes**

```bash
DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs --verbose
```

Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/sources/FreshRSSSourceAdapter.mjs tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs
git commit -m "feat(feed): implement markRead on FreshRSSSourceAdapter"
```

---

### Task 3: Add `reader` config section to feed.yml

**Files:**
- Modify: `data/users/kckern/config/feed.yml` (production data, mounted at `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/users/kckern/config/feed.yml`)

**Step 1: Add reader config**

Append to the end of `feed.yml` (after the `scroll:` section):

```yaml
reader:
  unread_per_source: 20
  total_limit: 100
```

**Step 2: Commit**

This file is in the data volume, not the git repo. No commit needed — it's runtime config.

---

### Task 4: Two-pass fetchPage in FreshRSSSourceAdapter

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/FreshRSSSourceAdapter.mjs`
- Test: `tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs`

**Step 1: Write failing tests for two-pass fetch**

Add to `tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs`:

```js
  describe('fetchPage — two-pass prioritization', () => {
    const makeItem = (id, title) => ({
      id, title, content: '', link: `https://example.com/${id}`,
      published: new Date('2026-02-18T12:00:00Z'), author: null,
      feedTitle: 'Test Feed', feedId: 'feed/1', categories: [],
    });

    test('returns unread items first, then read items shuffled', async () => {
      const unreadItems = [makeItem('u1', 'Unread 1'), makeItem('u2', 'Unread 2')];
      const allItems = [makeItem('u1', 'Unread 1'), makeItem('u2', 'Unread 2'), makeItem('r1', 'Read 1'), makeItem('r2', 'Read 2')];

      mockFreshRSSAdapter.getItems
        .mockResolvedValueOnce({ items: unreadItems, continuation: null })   // pass 1: unread
        .mockResolvedValueOnce({ items: allItems, continuation: 'cont-1' }); // pass 2: all

      const query = { tier: 'wire', limit: 20 };
      const result = await adapter.fetchPage(query, 'kckern', {});

      // First two items should be unread
      expect(result.items[0].title).toBe('Unread 1');
      expect(result.items[1].title).toBe('Unread 2');
      expect(result.items[0].meta.isRead).toBe(false);
      expect(result.items[1].meta.isRead).toBe(false);

      // Remaining items should be read
      const readItems = result.items.filter(i => i.meta.isRead);
      expect(readItems).toHaveLength(2);
      expect(readItems.map(i => i.title).sort()).toEqual(['Read 1', 'Read 2']);
    });

    test('makes only one call when unread fills the limit', async () => {
      const unreadItems = Array.from({ length: 20 }, (_, i) => makeItem(`u${i}`, `Unread ${i}`));
      mockFreshRSSAdapter.getItems.mockResolvedValueOnce({ items: unreadItems, continuation: 'more' });

      const query = { tier: 'wire', limit: 20 };
      const result = await adapter.fetchPage(query, 'kckern', {});

      // Only one getItems call (unread pass), no second call needed
      expect(mockFreshRSSAdapter.getItems).toHaveBeenCalledTimes(1);
      expect(result.items).toHaveLength(20);
      expect(result.items.every(i => i.meta.isRead === false)).toBe(true);
    });

    test('returns empty when adapter is null', async () => {
      const nullAdapter = new FreshRSSSourceAdapter({ freshRSSAdapter: null });
      const result = await nullAdapter.fetchPage({ tier: 'wire' }, 'kckern', {});
      expect(result.items).toHaveLength(0);
    });

    test('tags items with freshrss: prefix', async () => {
      mockFreshRSSAdapter.getItems.mockResolvedValueOnce({
        items: [makeItem('abc123', 'Test')],
        continuation: null,
      });

      const result = await adapter.fetchPage({ tier: 'wire' }, 'kckern', {});
      expect(result.items[0].id).toBe('freshrss:abc123');
    });

    test('respects cursor for pagination (passes to unread fetch)', async () => {
      mockFreshRSSAdapter.getItems.mockResolvedValueOnce({ items: [], continuation: null });

      await adapter.fetchPage({ tier: 'wire' }, 'kckern', { cursor: 'page-2-cursor' });

      expect(mockFreshRSSAdapter.getItems).toHaveBeenCalledWith(
        'user/-/state/com.google/reading-list',
        'kckern',
        expect.objectContaining({ continuation: 'page-2-cursor' }),
      );
    });
  });
```

**Step 2: Run tests to verify they fail**

```bash
DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs --verbose
```

Expected: FAIL — `meta.isRead` is undefined, read items missing

**Step 3: Rewrite fetchPage with two-pass logic**

Replace the `fetchPage` method and constructor in `backend/src/1_adapters/feed/sources/FreshRSSSourceAdapter.mjs`:

```js
export class FreshRSSSourceAdapter extends IFeedSourceAdapter {
  #freshRSSAdapter;
  #configService;
  #logger;

  static #DEFAULT_UNREAD_PER_SOURCE = 20;
  static #DEFAULT_TOTAL_LIMIT = 100;

  constructor({ freshRSSAdapter, configService = null, logger = console }) {
    super();
    this.#freshRSSAdapter = freshRSSAdapter;
    this.#configService = configService;
    this.#logger = logger;
  }

  get sourceType() { return 'freshrss'; }

  #getReaderConfig() {
    if (!this.#configService) {
      return {
        unreadPerSource: FreshRSSSourceAdapter.#DEFAULT_UNREAD_PER_SOURCE,
        totalLimit: FreshRSSSourceAdapter.#DEFAULT_TOTAL_LIMIT,
      };
    }
    const feedConfig = this.#configService.getAppConfig?.('feed') || {};
    const reader = feedConfig.reader || {};
    return {
      unreadPerSource: reader.unread_per_source ?? FreshRSSSourceAdapter.#DEFAULT_UNREAD_PER_SOURCE,
      totalLimit: reader.total_limit ?? FreshRSSSourceAdapter.#DEFAULT_TOTAL_LIMIT,
    };
  }

  async fetchPage(query, username, { cursor } = {}) {
    if (!this.#freshRSSAdapter) return { items: [], cursor: null };

    const { unreadPerSource, totalLimit } = this.#getReaderConfig();
    const streamId = 'user/-/state/com.google/reading-list';

    // Pass 1: unread items (prioritized)
    const { items: unreadRaw, continuation } = await this.#freshRSSAdapter.getItems(
      streamId, username, {
        excludeRead: true,
        count: unreadPerSource,
        continuation: cursor || undefined,
      }
    );

    const unreadIds = new Set(unreadRaw.map(i => i.id));
    const unreadItems = unreadRaw.map(item => this.#normalize(item, query, false));

    // If unread fills the limit, skip pass 2
    if (unreadItems.length >= totalLimit) {
      return { items: unreadItems.slice(0, totalLimit), cursor: continuation || null };
    }

    // Pass 2: all items (to backfill with read)
    let readItems = [];
    try {
      const { items: allRaw } = await this.#freshRSSAdapter.getItems(
        streamId, username, {
          excludeRead: false,
          count: totalLimit,
        }
      );
      const readRaw = allRaw.filter(i => !unreadIds.has(i.id));
      // Shuffle read items for variety
      readItems = readRaw.map(item => this.#normalize(item, query, true));
      for (let i = readItems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [readItems[i], readItems[j]] = [readItems[j], readItems[i]];
      }
    } catch (err) {
      this.#logger.warn?.('freshrss.backfill.error', { error: err.message });
    }

    const merged = [...unreadItems, ...readItems].slice(0, totalLimit);
    return { items: merged, cursor: continuation || null };
  }

  #normalize(item, query, isRead) {
    return {
      id: `freshrss:${item.id}`,
      tier: query.tier || 'wire',
      source: 'freshrss',
      title: item.title,
      body: item.content ? item.content.replace(/<[^>]*>/g, '').slice(0, 200) : null,
      image: this.#extractImage(item.content),
      link: item.link,
      timestamp: item.published?.toISOString?.() || item.published || new Date().toISOString(),
      priority: query.priority || 0,
      meta: {
        feedTitle: item.feedTitle,
        author: item.author,
        sourceName: item.feedTitle || 'RSS',
        sourceIcon: item.link ? (() => { try { return new URL(item.link).origin; } catch { return null; } })() : null,
        isRead,
      },
    };
  }

  async markRead(itemIds, username) {
    if (!this.#freshRSSAdapter) return;
    const stripped = itemIds.map(id => id.startsWith('freshrss:') ? id.slice('freshrss:'.length) : id);
    await this.#freshRSSAdapter.markRead(stripped, username);
  }

  #extractImage(html) {
    if (!html) return null;
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : null;
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs --verbose
```

Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/sources/FreshRSSSourceAdapter.mjs tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs
git commit -m "feat(feed): two-pass fetchPage — unread prioritized, read backfill"
```

---

### Task 5: Wire configService into FreshRSSSourceAdapter bootstrap

**Files:**
- Modify: `backend/src/app.mjs:828-831`

**Step 1: Pass configService to FreshRSSSourceAdapter constructor**

Change lines 828-831 of `backend/src/app.mjs` from:

```js
    const freshRSSFeedAdapter = new FreshRSSSourceAdapter({
      freshRSSAdapter: feedServices.freshRSSAdapter,
      logger: rootLogger.child({ module: 'freshrss-feed' }),
    });
```

to:

```js
    const freshRSSFeedAdapter = new FreshRSSSourceAdapter({
      freshRSSAdapter: feedServices.freshRSSAdapter,
      configService,
      logger: rootLogger.child({ module: 'freshrss-feed' }),
    });
```

**Step 2: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(feed): pass configService to FreshRSSSourceAdapter for reader limits"
```

---

### Task 6: Adapter-driven dismiss in feed router

**Files:**
- Modify: `backend/src/4_api/v1/routers/feed.mjs:26-27,173-211`
- Modify: `backend/src/app.mjs:870-878`
- Test: `tests/isolated/api/feed/feed.router.test.mjs`

**Step 1: Write failing test for adapter-driven dismiss**

Add to `tests/isolated/api/feed/feed.router.test.mjs`, inside a new describe block:

```js
  describe('POST /scroll/dismiss — adapter-driven', () => {
    let dismissApp;
    let mockSourceAdapters;
    let mockDismissedItemsStore;

    beforeEach(() => {
      mockSourceAdapters = [
        {
          sourceType: 'freshrss',
          markRead: jest.fn().mockResolvedValue(undefined),
        },
      ];
      mockDismissedItemsStore = { add: jest.fn() };

      const router = createFeedRouter({
        freshRSSAdapter: mockFreshRSSAdapter,
        headlineService: mockHeadlineService,
        configService: mockConfigService,
        sourceAdapters: mockSourceAdapters,
        dismissedItemsStore: mockDismissedItemsStore,
      });
      dismissApp = express();
      dismissApp.use(express.json());
      dismissApp.use('/api/v1/feed', router);
    });

    test('routes freshrss items through adapter markRead', async () => {
      const res = await request(dismissApp)
        .post('/api/v1/feed/scroll/dismiss')
        .send({ itemIds: ['freshrss:item-1', 'freshrss:item-2'] });

      expect(res.status).toBe(200);
      expect(mockSourceAdapters[0].markRead).toHaveBeenCalledWith(
        ['freshrss:item-1', 'freshrss:item-2'],
        'kckern'
      );
    });

    test('routes unknown source items to dismissedItemsStore', async () => {
      const res = await request(dismissApp)
        .post('/api/v1/feed/scroll/dismiss')
        .send({ itemIds: ['reddit:xyz', 'headline:abc'] });

      expect(res.status).toBe(200);
      expect(mockDismissedItemsStore.add).toHaveBeenCalledWith(['reddit:xyz', 'headline:abc']);
    });

    test('splits mixed items by source', async () => {
      const res = await request(dismissApp)
        .post('/api/v1/feed/scroll/dismiss')
        .send({ itemIds: ['freshrss:item-1', 'reddit:xyz'] });

      expect(res.status).toBe(200);
      expect(mockSourceAdapters[0].markRead).toHaveBeenCalledWith(['freshrss:item-1'], 'kckern');
      expect(mockDismissedItemsStore.add).toHaveBeenCalledWith(['reddit:xyz']);
    });
  });
```

**Step 2: Run test to verify it fails**

```bash
DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/api/feed/feed.router.test.mjs --verbose
```

Expected: FAIL — `sourceAdapters` not used in router

**Step 3: Update feed router to use adapter-driven dismiss**

In `backend/src/4_api/v1/routers/feed.mjs`, update the `createFeedRouter` function:

1. Add `sourceAdapters` to destructured config (line 27):

```js
  const { freshRSSAdapter, headlineService, feedAssemblyService, feedContentService, dismissedItemsStore, sourceAdapters, configService, logger = console } = config;
```

2. Build a source adapter map after `getUsername`:

```js
  // Build source adapter lookup for dismiss routing
  const adapterMap = new Map();
  if (sourceAdapters) {
    for (const adapter of sourceAdapters) {
      if (typeof adapter.markRead === 'function') {
        adapterMap.set(adapter.sourceType, adapter);
      }
    }
  }
```

3. Replace the dismiss endpoint (lines 173-211) with:

```js
  // Dismiss / mark-read items (routes through source adapter markRead interface)
  router.post('/scroll/dismiss', asyncHandler(async (req, res) => {
    const { itemIds } = req.body;
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds array required' });
    }

    const username = getUsername();

    // Partition items by source type
    const bySource = new Map();
    const otherIds = [];

    for (const id of itemIds) {
      const colonIdx = id.indexOf(':');
      if (colonIdx === -1) { otherIds.push(id); continue; }

      const sourceType = id.slice(0, colonIdx);
      if (adapterMap.has(sourceType)) {
        if (!bySource.has(sourceType)) bySource.set(sourceType, []);
        bySource.get(sourceType).push(id);
      } else {
        otherIds.push(id);
      }
    }

    const promises = [];

    for (const [sourceType, ids] of bySource) {
      promises.push(
        adapterMap.get(sourceType).markRead(ids, username).catch(err => {
          logger.warn?.('feed.dismiss.adapter.error', { sourceType, error: err.message, count: ids.length });
        })
      );
    }

    if (otherIds.length > 0 && dismissedItemsStore) {
      dismissedItemsStore.add(otherIds);
    }

    await Promise.all(promises);
    res.json({ dismissed: itemIds.length });
  }));
```

**Step 4: Pass sourceAdapters to createFeedRouter in app.mjs**

Change `backend/src/app.mjs` lines 870-878 from:

```js
    v1Routers.feed = createFeedRouter({
      freshRSSAdapter: feedServices.freshRSSAdapter,
      headlineService: feedServices.headlineService,
      feedAssemblyService,
      feedContentService,
      dismissedItemsStore,
      configService,
      logger: rootLogger.child({ module: 'feed' }),
    });
```

to:

```js
    v1Routers.feed = createFeedRouter({
      freshRSSAdapter: feedServices.freshRSSAdapter,
      headlineService: feedServices.headlineService,
      feedAssemblyService,
      feedContentService,
      dismissedItemsStore,
      sourceAdapters: feedSourceAdapters,
      configService,
      logger: rootLogger.child({ module: 'feed' }),
    });
```

**Step 5: Run tests to verify they pass**

```bash
DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/api/feed/feed.router.test.mjs --verbose
```

Expected: PASS (all tests including new dismiss tests)

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/feed.mjs backend/src/app.mjs tests/isolated/api/feed/feed.router.test.mjs
git commit -m "refactor(feed): adapter-driven dismiss routing via markRead interface"
```

---

### Task 7: Run all feed tests to verify no regressions

**Step 1: Run full isolated test suite for feed**

```bash
DAYLIGHT_DATA_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/adapter/feed/ tests/isolated/api/feed/ tests/isolated/application/feed/ --verbose
```

Expected: All existing tests pass alongside new ones.

**Step 2: If failures, fix and commit fixes**

---

### Task 8: Add reader config to production feed.yml

**Files:**
- Modify: `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/users/kckern/config/feed.yml`

**Step 1: Append reader section**

Add at the end of the file:

```yaml
reader:
  unread_per_source: 20
  total_limit: 100
```

**Step 2: Restart daylight-station to verify**

```bash
docker restart daylight-station
```

Wait 5 seconds, then test:

```bash
curl -s http://localhost:3111/api/v1/feed/reader/feeds | jq 'length'
```

Expected: Feed count > 0 (same as before, no regression)

---

## Summary of all files

| File | Action |
|------|--------|
| `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs` | Add `markRead()` |
| `backend/src/1_adapters/feed/sources/FreshRSSSourceAdapter.mjs` | Two-pass fetch + `markRead()` + `configService` |
| `backend/src/4_api/v1/routers/feed.mjs` | Adapter-driven dismiss, accept `sourceAdapters` |
| `backend/src/app.mjs` | Pass `configService` + `sourceAdapters` |
| `tests/isolated/adapter/feed/FreshRSSSourceAdapter.test.mjs` | New test file |
| `tests/isolated/api/feed/feed.router.test.mjs` | New dismiss tests |
| `data/users/kckern/config/feed.yml` | Add `reader:` config (runtime, not git) |
