# Feed Assembly Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add headline selection tracking with deterministic short IDs, replace assembled-list caching with per-session seen-ID dedup, and add padding-source fallback for short batches.

**Architecture:** Three interconnected changes: (1) Headline entity gets deterministic IDs via `shortIdFromUuid(link)`, with selection counts tracked in a separate YAML file and used as a sort tiebreaker in TierAssemblyService. (2) FeedAssemblyService drops `#assembledCache` in favor of `#seenIds` per user, doing fresh assembly each call. (3) Sources marked `padding: true` in scroll config fill remaining batch slots when primary content is exhausted.

**Tech Stack:** Node.js ES modules, Jest for testing, YAML persistence via DataService, existing `shortIdFromUuid` from `2_domains/core/utils/id.mjs`.

---

### Task 1: Headline Entity — Add `id` Field and Factory

**Files:**
- Modify: `backend/src/2_domains/feed/entities/Headline.mjs`
- Modify: `tests/isolated/domain/feed/Headline.test.mjs`

**Step 1: Update tests for id requirement and factory**

Add these tests to `tests/isolated/domain/feed/Headline.test.mjs`:

```js
// At top of file, add import:
import { shortIdFromUuid } from '#domains/core/utils/id.mjs';

// Add to validData:
const validData = {
  id: 'testid1234',  // ADD THIS
  source: 'cnn',
  title: 'Breaking: Something happened',
  desc: 'Officials confirmed today that the situation has developed...',
  link: 'https://cnn.com/article/123',
  timestamp: new Date('2026-02-15T09:45:00Z'),
};

// New tests:
test('throws on missing id', () => {
  const { id, ...noId } = validData;
  expect(() => new Headline(noId)).toThrow('Headline requires id');
});

test('create() generates deterministic id from link', () => {
  const { id, ...createData } = validData;
  const headline = Headline.create(createData);
  expect(headline.id).toBe(shortIdFromUuid(createData.link));
});

test('create() produces same id for same link', () => {
  const { id, ...createData } = validData;
  const h1 = Headline.create(createData);
  const h2 = Headline.create(createData);
  expect(h1.id).toBe(h2.id);
});

test('toJSON includes id', () => {
  const headline = new Headline(validData);
  const json = headline.toJSON();
  expect(json.id).toBe('testid1234');
});

test('fromJSON roundtrips with id', () => {
  const headline = new Headline(validData);
  const restored = Headline.fromJSON(headline.toJSON());
  expect(restored.id).toBe(headline.id);
});
```

Update existing `toJSON` test expectation to include `id: 'testid1234'`.

**Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/domain/feed/Headline.test.mjs --verbose`
Expected: FAIL — "Headline requires id", missing `id` in toJSON, etc.

**Step 3: Implement Headline changes**

In `backend/src/2_domains/feed/entities/Headline.mjs`:

```js
import { shortIdFromUuid } from '../../core/utils/id.mjs';

export class Headline {
  constructor(data) {
    if (!data.id) throw new Error('Headline requires id');
    if (!data.source) throw new Error('Headline requires source');
    if (!data.title) throw new Error('Headline requires title');
    if (!data.link) throw new Error('Headline requires link');

    this.id = data.id;
    this.source = data.source;
    this.title = data.title;
    this.desc = data.desc || null;
    this.link = data.link;
    this.timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
  }

  truncateDesc(maxLength = 120) {
    if (!this.desc) return null;
    if (this.desc.length <= maxLength) return this.desc;
    return this.desc.substring(0, maxLength) + '...';
  }

  toJSON() {
    return {
      id: this.id,
      source: this.source,
      title: this.title,
      desc: this.desc,
      link: this.link,
      timestamp: this.timestamp.toISOString(),
    };
  }

  static fromJSON(data) {
    return new Headline({
      ...data,
      timestamp: new Date(data.timestamp),
    });
  }

  static create(data) {
    return new Headline({
      ...data,
      id: shortIdFromUuid(data.link),
    });
  }
}

export default Headline;
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/domain/feed/Headline.test.mjs --verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/feed/entities/Headline.mjs tests/isolated/domain/feed/Headline.test.mjs
git commit -m "feat(feed): add deterministic id and create() factory to Headline entity"
```

---

### Task 2: RssHeadlineHarvester — Use `Headline.create()`

**Files:**
- Modify: `backend/src/1_adapters/feed/RssHeadlineHarvester.mjs`
- Modify: `tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs`

**Step 1: Update harvester test to expect `id` on items**

In `tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs`, find the test that checks harvested items and add:

```js
test('harvested items have deterministic id from link', async () => {
  // Use existing mock setup from the test file
  const result = await harvester.harvest(source);
  for (const item of result.items) {
    expect(item.id).toBeDefined();
    expect(typeof item.id).toBe('string');
    expect(item.id.length).toBe(10);
  }
});

test('same link produces same id across harvests', async () => {
  const result1 = await harvester.harvest(source);
  const result2 = await harvester.harvest(source);
  expect(result1.items[0].id).toBe(result2.items[0].id);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs --verbose`
Expected: FAIL — items don't have `id`

**Step 3: Update RssHeadlineHarvester**

In `backend/src/1_adapters/feed/RssHeadlineHarvester.mjs`, add import and use `Headline.create()`:

```js
// At top:
import { Headline } from '#domains/feed/entities/Headline.mjs';

// In harvest() method, replace the item construction (lines 32-44) with:
const headline = Headline.create({
  source: source.id,
  title: item.title?.trim(),
  desc: this.#extractDesc(item),
  link: item.link?.trim(),
  timestamp: this.#parseDate(item),
});
const entry = headline.toJSON();
const imageData = this.#extractImageWithDims(item);
if (imageData) {
  entry.image = imageData.url;
  if (imageData.width) entry.imageWidth = imageData.width;
  if (imageData.height) entry.imageHeight = imageData.height;
}
allItems.push(entry);
```

**Note:** `Headline.create()` will throw if `title` or `link` is falsy. Add a guard to skip items with missing required fields:

```js
if (!item.title?.trim() || !item.link?.trim()) continue;
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs --verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/RssHeadlineHarvester.mjs tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs
git commit -m "feat(feed): use Headline.create() in RssHeadlineHarvester for deterministic IDs"
```

---

### Task 3: YamlHeadlineCacheStore — Persist `id` Field

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlHeadlineCacheStore.mjs`
- Modify: `tests/isolated/adapter/feed/YamlHeadlineCacheStore.test.mjs`

**Step 1: Update test to verify id roundtrip**

```js
test('saveSource and loadSource roundtrip preserves item id', async () => {
  const data = {
    source: 'cnn',
    label: 'CNN',
    lastHarvest: '2026-02-17T00:00:00Z',
    items: [{ id: 'abc123defg', title: 'Test', link: 'https://cnn.com/1', timestamp: '2026-02-17T00:00:00Z' }],
  };
  await store.saveSource('cnn', data, 'testuser');
  const loaded = await store.loadSource('cnn', 'testuser');
  expect(loaded.items[0].id).toBe('abc123defg');
});
```

**Step 2: Run test — should already pass** since YAML serialization preserves all fields. If it does, this is just a verification step.

Run: `npx jest tests/isolated/adapter/feed/YamlHeadlineCacheStore.test.mjs --verbose`

**Step 3: Commit** (test-only, documents the contract)

```bash
git add tests/isolated/adapter/feed/YamlHeadlineCacheStore.test.mjs
git commit -m "test(feed): verify YamlHeadlineCacheStore preserves headline id field"
```

---

### Task 4: ISelectionTrackingStore Port

**Files:**
- Create: `backend/src/3_applications/feed/ports/ISelectionTrackingStore.mjs`
- Create: `tests/isolated/contract/feed/ISelectionTrackingStore.test.mjs`

**Step 1: Write contract test**

```js
// tests/isolated/contract/feed/ISelectionTrackingStore.test.mjs
import { ISelectionTrackingStore } from '#apps/feed/ports/ISelectionTrackingStore.mjs';

describe('ISelectionTrackingStore contract', () => {
  test('getAll throws not implemented', async () => {
    const store = new ISelectionTrackingStore();
    await expect(store.getAll('user')).rejects.toThrow('Not implemented');
  });

  test('incrementBatch throws not implemented', async () => {
    const store = new ISelectionTrackingStore();
    await expect(store.incrementBatch(['id1'], 'user')).rejects.toThrow('Not implemented');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/contract/feed/ISelectionTrackingStore.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Implement port**

```js
// backend/src/3_applications/feed/ports/ISelectionTrackingStore.mjs
/**
 * Port interface for feed item selection tracking.
 * Tracks how many times items have been selected into batches.
 * Generic — usable by any feed source, not just headlines.
 *
 * @module applications/feed/ports
 */
export class ISelectionTrackingStore {
  /**
   * Get all tracking records for a user.
   * @param {string} username
   * @returns {Promise<Map<string, { count: number, last: string }>>}
   */
  async getAll(username) {
    throw new Error('Not implemented');
  }

  /**
   * Increment selection count for a batch of item IDs.
   * @param {string[]} itemIds - Short IDs of items selected into a batch
   * @param {string} username
   * @returns {Promise<void>}
   */
  async incrementBatch(itemIds, username) {
    throw new Error('Not implemented');
  }
}

export default ISelectionTrackingStore;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/contract/feed/ISelectionTrackingStore.test.mjs --verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/ports/ISelectionTrackingStore.mjs tests/isolated/contract/feed/ISelectionTrackingStore.test.mjs
git commit -m "feat(feed): add ISelectionTrackingStore port interface"
```

---

### Task 5: YamlSelectionTrackingStore Adapter

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlSelectionTrackingStore.mjs`
- Create: `tests/isolated/adapter/feed/YamlSelectionTrackingStore.test.mjs`

**Step 1: Write tests**

```js
// tests/isolated/adapter/feed/YamlSelectionTrackingStore.test.mjs
import { jest } from '@jest/globals';
import { YamlSelectionTrackingStore } from '../../../../backend/src/1_adapters/persistence/yaml/YamlSelectionTrackingStore.mjs';

describe('YamlSelectionTrackingStore', () => {
  let store;
  let mockDataService;
  let storedData;

  beforeEach(() => {
    storedData = null;
    mockDataService = {
      user: {
        read: jest.fn(() => storedData),
        write: jest.fn((path, data) => { storedData = data; return true; }),
      },
    };
    store = new YamlSelectionTrackingStore({ dataService: mockDataService });
  });

  test('getAll returns empty Map when no data exists', async () => {
    const result = await store.getAll('testuser');
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  test('incrementBatch creates new records', async () => {
    await store.incrementBatch(['abc123', 'def456'], 'testuser');
    const result = await store.getAll('testuser');
    expect(result.get('abc123').count).toBe(1);
    expect(result.get('def456').count).toBe(1);
    expect(result.get('abc123').last).toBeDefined();
  });

  test('incrementBatch increments existing records', async () => {
    await store.incrementBatch(['abc123'], 'testuser');
    await store.incrementBatch(['abc123'], 'testuser');
    const result = await store.getAll('testuser');
    expect(result.get('abc123').count).toBe(2);
  });

  test('incrementBatch updates last timestamp', async () => {
    await store.incrementBatch(['abc123'], 'testuser');
    const first = (await store.getAll('testuser')).get('abc123').last;
    // Small delay to ensure different timestamp
    await new Promise(r => setTimeout(r, 10));
    await store.incrementBatch(['abc123'], 'testuser');
    const second = (await store.getAll('testuser')).get('abc123').last;
    expect(new Date(second).getTime()).toBeGreaterThanOrEqual(new Date(first).getTime());
  });

  test('writes to correct path', async () => {
    await store.incrementBatch(['abc123'], 'testuser');
    expect(mockDataService.user.write).toHaveBeenCalledWith(
      'current/feed/_selection_tracking',
      expect.any(Object),
      'testuser'
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/adapter/feed/YamlSelectionTrackingStore.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Implement adapter**

```js
// backend/src/1_adapters/persistence/yaml/YamlSelectionTrackingStore.mjs
/**
 * YamlSelectionTrackingStore
 *
 * YAML-backed persistence for feed item selection tracking.
 * Stores per-item count and last-selected timestamp.
 *
 * Path: current/feed/_selection_tracking (DataService appends .yml)
 *
 * @module adapters/persistence/yaml
 */
import { ISelectionTrackingStore } from '#apps/feed/ports/ISelectionTrackingStore.mjs';

const TRACKING_PATH = 'current/feed/_selection_tracking';

export class YamlSelectionTrackingStore extends ISelectionTrackingStore {
  #dataService;
  #logger;

  constructor({ dataService, logger = console }) {
    super();
    this.#dataService = dataService;
    this.#logger = logger;
  }

  async getAll(username) {
    const raw = this.#dataService.user.read(TRACKING_PATH, username) || {};
    const map = new Map();
    for (const [id, record] of Object.entries(raw)) {
      map.set(id, { count: record.count || 0, last: record.last || null });
    }
    return map;
  }

  async incrementBatch(itemIds, username) {
    if (!itemIds.length) return;
    const raw = this.#dataService.user.read(TRACKING_PATH, username) || {};
    const now = new Date().toISOString();

    for (const id of itemIds) {
      if (!raw[id]) raw[id] = { count: 0, last: null };
      raw[id].count += 1;
      raw[id].last = now;
    }

    this.#dataService.user.write(TRACKING_PATH, raw, username);
    this.#logger.debug?.('selection.tracking.incremented', { count: itemIds.length, username });
  }
}

export default YamlSelectionTrackingStore;
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/adapter/feed/YamlSelectionTrackingStore.test.mjs --verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlSelectionTrackingStore.mjs tests/isolated/adapter/feed/YamlSelectionTrackingStore.test.mjs
git commit -m "feat(feed): add YamlSelectionTrackingStore adapter"
```

---

### Task 6: TierAssemblyService — Selection Count Sort Bias

**Files:**
- Modify: `backend/src/3_applications/feed/services/TierAssemblyService.mjs`
- Create: `tests/isolated/application/feed/TierAssemblyService.test.mjs`

**Step 1: Write tests**

```js
// tests/isolated/application/feed/TierAssemblyService.test.mjs
import { TierAssemblyService, TIERS } from '#apps/feed/services/TierAssemblyService.mjs';

describe('TierAssemblyService', () => {
  let service;

  beforeEach(() => {
    service = new TierAssemblyService({ logger: { info: () => {} } });
  });

  const makeItem = (id, tier, source, timestamp, priority = 0) => ({
    id, tier, source, title: `Item ${id}`, timestamp, priority,
  });

  const defaultConfig = {
    batch_size: 50,
    spacing: { max_consecutive: 1 },
    tiers: {
      wire: { selection: { sort: 'timestamp_desc' }, sources: {} },
      library: { allocation: 2, selection: { sort: 'random' }, sources: {} },
      scrapbook: { allocation: 2, selection: { sort: 'random' }, sources: {} },
      compass: { allocation: 3, selection: { sort: 'priority' }, sources: {} },
    },
  };

  test('assembles items from multiple tiers', () => {
    const items = [
      makeItem('w1', 'wire', 'reddit', '2026-02-17T10:00:00Z'),
      makeItem('w2', 'wire', 'headline', '2026-02-17T09:00:00Z'),
      makeItem('c1', 'compass', 'entropy', '2026-02-17T08:00:00Z', 10),
    ];
    const result = service.assemble(items, defaultConfig, { effectiveLimit: 50 });
    expect(result.items.length).toBe(3);
  });

  test('deduplicates items by id', () => {
    const items = [
      makeItem('w1', 'wire', 'reddit', '2026-02-17T10:00:00Z'),
      makeItem('w1', 'wire', 'reddit', '2026-02-17T10:00:00Z'),
    ];
    const result = service.assemble(items, defaultConfig, { effectiveLimit: 50 });
    expect(result.items.length).toBe(1);
  });

  describe('selectionCounts sort bias', () => {
    test('prefers lower selection count within same hour', () => {
      const selectionCounts = new Map([
        ['w1', { count: 5, last: '2026-02-17T09:00:00Z' }],
        ['w2', { count: 0, last: null }],
      ]);
      const items = [
        makeItem('w1', 'wire', 'reddit', '2026-02-17T10:00:00Z'),
        makeItem('w2', 'wire', 'headline', '2026-02-17T10:05:00Z'),
      ];
      const result = service.assemble(items, defaultConfig, {
        effectiveLimit: 50,
        selectionCounts,
      });
      const wireItems = result.items.filter(i => i.tier === 'wire');
      expect(wireItems[0].id).toBe('w2'); // lower count comes first
    });

    test('timestamp still wins across different hours', () => {
      const selectionCounts = new Map([
        ['w1', { count: 0, last: null }],
        ['w2', { count: 10, last: '2026-02-17T09:00:00Z' }],
      ]);
      const items = [
        makeItem('w1', 'wire', 'reddit', '2026-02-17T08:00:00Z'),
        makeItem('w2', 'wire', 'headline', '2026-02-17T12:00:00Z'),
      ];
      const result = service.assemble(items, defaultConfig, {
        effectiveLimit: 50,
        selectionCounts,
      });
      const wireItems = result.items.filter(i => i.tier === 'wire');
      expect(wireItems[0].id).toBe('w2'); // newer timestamp wins despite higher count
    });

    test('works without selectionCounts (backwards compat)', () => {
      const items = [
        makeItem('w1', 'wire', 'reddit', '2026-02-17T10:00:00Z'),
        makeItem('w2', 'wire', 'headline', '2026-02-17T09:00:00Z'),
      ];
      const result = service.assemble(items, defaultConfig, { effectiveLimit: 50 });
      expect(result.items.length).toBe(2);
    });
  });
});
```

**Step 2: Run tests to verify sort bias tests fail**

Run: `npx jest tests/isolated/application/feed/TierAssemblyService.test.mjs --verbose`
Expected: Basic tests PASS, selectionCounts tests FAIL (parameter not threaded)

**Step 3: Implement selectionCounts threading**

In `backend/src/3_applications/feed/services/TierAssemblyService.mjs`:

1. Add `selectionCounts` to `assemble()` options (line 63):

```js
assemble(allItems, scrollConfig, { effectiveLimit, focus, selectionCounts } = {}) {
```

2. Pass `selectionCounts` through `#selectForTier` (line 74):

```js
selected[tier] = this.#selectForTier(tier, candidates, config, { focus, selectionCounts });
```

3. Update `#selectForTier` signature (line 155):

```js
#selectForTier(tier, candidates, config, { focus, selectionCounts } = {}) {
```

4. Pass to `#applyTierSort` (line 167):

```js
items = this.#applyTierSort(items, config.selection, selectionCounts);
```

5. Update `#applyTierSort` (line 194) to accept and use `selectionCounts`:

```js
#applyTierSort(items, selection, selectionCounts) {
  const sort = selection?.sort || 'timestamp_desc';

  switch (sort) {
    case 'timestamp_desc':
      return [...items].sort((a, b) => {
        const timeDiff = new Date(b.timestamp) - new Date(a.timestamp);
        if (selectionCounts && Math.abs(timeDiff) < 3600000) {
          const aCount = selectionCounts.get(a.id)?.count || 0;
          const bCount = selectionCounts.get(b.id)?.count || 0;
          if (aCount !== bCount) return aCount - bCount;
        }
        return timeDiff;
      });

    // ... priority and random cases unchanged
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/application/feed/TierAssemblyService.test.mjs --verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/TierAssemblyService.mjs tests/isolated/application/feed/TierAssemblyService.test.mjs
git commit -m "feat(feed): add selectionCounts sort bias to TierAssemblyService"
```

---

### Task 7: ScrollConfigLoader — `getPaddingSources()`

**Files:**
- Modify: `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs`
- Create: `tests/isolated/application/feed/ScrollConfigLoader.test.mjs`

**Step 1: Write test**

```js
// tests/isolated/application/feed/ScrollConfigLoader.test.mjs
import { ScrollConfigLoader } from '#apps/feed/services/ScrollConfigLoader.mjs';

describe('ScrollConfigLoader', () => {
  describe('getPaddingSources', () => {
    test('returns empty set when no padding sources configured', () => {
      const config = {
        tiers: {
          wire: { sources: { reddit: { max_per_batch: 10 } } },
          library: { sources: { komga: { max_per_batch: 5 } } },
        },
      };
      const result = ScrollConfigLoader.getPaddingSources(config);
      expect(result.size).toBe(0);
    });

    test('returns sources with padding: true', () => {
      const config = {
        tiers: {
          library: { sources: { komga: { max_per_batch: 5, padding: true } } },
          scrapbook: { sources: { photos: { max_per_batch: 4, padding: true }, journal: { max_per_batch: 1 } } },
        },
      };
      const result = ScrollConfigLoader.getPaddingSources(config);
      expect(result).toEqual(new Set(['komga', 'photos']));
    });

    test('handles missing tiers gracefully', () => {
      const result = ScrollConfigLoader.getPaddingSources({});
      expect(result.size).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/ScrollConfigLoader.test.mjs --verbose`
Expected: FAIL — `getPaddingSources` is not a function

**Step 3: Implement**

Add to `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs` after `extractColors()`:

```js
/**
 * Get source keys marked as padding sources.
 * Padding sources fill remaining batch slots when primary content is exhausted.
 *
 * @param {Object} scrollConfig - Merged scroll config
 * @returns {Set<string>} Set of source keys with padding: true
 */
static getPaddingSources(scrollConfig) {
  const padding = new Set();
  const tiers = scrollConfig.tiers || {};
  for (const tier of Object.values(tiers)) {
    for (const [key, cfg] of Object.entries(tier.sources || {})) {
      if (cfg.padding) padding.add(key);
    }
  }
  return padding;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/application/feed/ScrollConfigLoader.test.mjs --verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/ScrollConfigLoader.mjs tests/isolated/application/feed/ScrollConfigLoader.test.mjs
git commit -m "feat(feed): add getPaddingSources() to ScrollConfigLoader"
```

---

### Task 8: FeedAssemblyService — Caching Redesign

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Modify: `tests/isolated/application/feed/FeedAssemblyService.test.mjs`

This is the largest task. It replaces `#assembledCache` with `#seenIds` and adds the two-pass assembly with padding.

**Step 1: Write new/updated tests**

Add to `tests/isolated/application/feed/FeedAssemblyService.test.mjs`. The existing tests need a `tierAssemblyService` mock. Update `createService`:

```js
import { TierAssemblyService } from '#apps/feed/services/TierAssemblyService.mjs';

// Replace createService with:
function createService(queryConfigs, adapters = [], overrides = {}) {
  return new FeedAssemblyService({
    freshRSSAdapter: null,
    headlineService: null,
    entropyService: null,
    queryConfigs,
    sourceAdapters: adapters,
    scrollConfigLoader: mockScrollConfigLoader,
    tierAssemblyService: overrides.tierAssemblyService || new TierAssemblyService({
      logger: { info: jest.fn() },
    }),
    logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  });
}
```

Update `defaultScrollConfig` to use tier-based structure:

```js
const defaultScrollConfig = {
  batch_size: 15,
  spacing: { max_consecutive: 1 },
  tiers: {
    wire: { selection: { sort: 'timestamp_desc' }, sources: {} },
    library: { allocation: 2, selection: { sort: 'random' }, sources: {} },
    scrapbook: { allocation: 2, selection: { sort: 'random' }, sources: {} },
    compass: { allocation: 3, selection: { sort: 'priority' }, sources: {} },
  },
};
```

Add new tests:

```js
describe('seenIds dedup', () => {
  test('fresh load (no cursor) returns full batch', async () => {
    const adapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          id: `reddit:r${i}`, tier: 'wire', source: 'reddit',
          title: `Post ${i}`, timestamp: new Date(2026, 1, 17, 10 - i).toISOString(),
        }))
      ),
    };
    const service = createService(
      [{ type: 'reddit', _filename: 'reddit.yml' }],
      [adapter],
    );
    const result = await service.getNextBatch('testuser');
    expect(result.items.length).toBe(15);
    expect(result.hasMore).toBe(true);
  });

  test('continuation (with cursor) excludes previously sent items', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `reddit:r${i}`, tier: 'wire', source: 'reddit',
      title: `Post ${i}`, timestamp: new Date(2026, 1, 17, 10 - i).toISOString(),
    }));
    const adapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue(items),
    };
    const service = createService(
      [{ type: 'reddit', _filename: 'reddit.yml' }],
      [adapter],
    );

    const batch1 = await service.getNextBatch('testuser');
    const batch2 = await service.getNextBatch('testuser', { cursor: 'continue' });

    const batch1Ids = new Set(batch1.items.map(i => i.id));
    const batch2Ids = new Set(batch2.items.map(i => i.id));
    // No overlap
    for (const id of batch2Ids) {
      expect(batch1Ids.has(id)).toBe(false);
    }
  });

  test('fresh load clears seenIds from previous session', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `reddit:r${i}`, tier: 'wire', source: 'reddit',
      title: `Post ${i}`, timestamp: new Date(2026, 1, 17, 10 - i).toISOString(),
    }));
    const adapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue(items),
    };
    const service = createService(
      [{ type: 'reddit', _filename: 'reddit.yml' }],
      [adapter],
    );

    const batch1 = await service.getNextBatch('testuser');
    // Fresh load — same items should come back
    const batch2 = await service.getNextBatch('testuser'); // no cursor
    expect(batch2.items.length).toBe(batch1.items.length);
  });
});

describe('padding', () => {
  test('fills remaining slots from padding sources', async () => {
    mockScrollConfigLoader.load.mockReturnValue({
      batch_size: 10,
      spacing: { max_consecutive: 1 },
      tiers: {
        wire: { selection: { sort: 'timestamp_desc' }, sources: {} },
        library: { allocation: 2, selection: { sort: 'random' }, sources: {} },
        scrapbook: {
          allocation: 2,
          selection: { sort: 'random' },
          sources: { photos: { max_per_batch: 2, padding: true } },
        },
        compass: { allocation: 3, selection: { sort: 'priority' }, sources: {} },
      },
    });

    // Only 3 wire items, but 10 photos available for padding
    const wireAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue(
        Array.from({ length: 3 }, (_, i) => ({
          id: `reddit:r${i}`, tier: 'wire', source: 'reddit',
          title: `Post ${i}`, timestamp: new Date().toISOString(),
        }))
      ),
    };
    const photoAdapter = {
      sourceType: 'photos',
      fetchItems: jest.fn().mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          id: `photo:p${i}`, tier: 'scrapbook', source: 'photos',
          title: `Photo ${i}`, timestamp: new Date().toISOString(),
        }))
      ),
    };

    const service = createService(
      [
        { type: 'reddit', _filename: 'reddit.yml' },
        { type: 'photos', _filename: 'photos.yml' },
      ],
      [wireAdapter, photoAdapter],
    );

    const result = await service.getNextBatch('testuser');
    expect(result.items.length).toBeGreaterThan(3); // padded beyond just wire items
    expect(result.items.some(i => i.source === 'photos')).toBe(true);
  });
});
```

**Step 2: Run tests to verify new tests fail**

Run: `npx jest tests/isolated/application/feed/FeedAssemblyService.test.mjs --verbose`
Expected: New seenIds/padding tests FAIL

**Step 3: Implement FeedAssemblyService changes**

In `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`:

1. Remove `#assembledCache` and `#ASSEMBLED_TTL` (lines 36-37)
2. Add `#seenIds`:

```js
/** Per-user seen-IDs for cross-batch dedup (cleared on fresh load) */
#seenIds = new Map();
```

3. Replace `getNextBatch()` body (lines 87-176) with:

```js
async getNextBatch(username, { limit, cursor, focus, sources, nocache } = {}) {
  const scrollConfig = this.#scrollConfigLoader?.load(username)
    || { batch_size: 15, spacing: { max_consecutive: 1 }, tiers: {} };

  const effectiveLimit = limit ?? scrollConfig.batch_size ?? 15;

  // Fresh load: clear seen IDs
  if (!cursor) {
    this.#seenIds.delete(username);
  }
  const seenIds = this.#seenIds.get(username) || new Set();

  // Fetch all sources
  const allItems = await this.#fetchAllSources(scrollConfig, username, { nocache, sources });

  // Source filter: bypass tier assembly
  if (sources && sources.length > 0) {
    const filtered = allItems
      .filter(item => sources.includes(item.source) && !seenIds.has(item.id))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const batch = filtered.slice(0, effectiveLimit);
    for (const item of batch) {
      seenIds.add(item.id);
      this.#cacheItem(item);
    }
    this.#seenIds.set(username, seenIds);
    return { items: batch, hasMore: filtered.length > batch.length, colors: ScrollConfigLoader.extractColors(scrollConfig) };
  }

  // Remove already-seen items
  const freshPool = allItems.filter(i => !seenIds.has(i.id));

  // Primary pass: normal tier assembly
  const { items: primary } = this.#tierAssemblyService.assemble(
    freshPool, scrollConfig, { effectiveLimit, focus }
  );

  let batch = primary.slice(0, effectiveLimit);

  // Padding pass: fill remaining slots from padding sources
  if (batch.length < effectiveLimit) {
    const paddingSources = ScrollConfigLoader.getPaddingSources(scrollConfig);
    if (paddingSources.size > 0) {
      const batchIds = new Set(batch.map(i => i.id));
      const padding = freshPool.filter(i => paddingSources.has(i.source) && !batchIds.has(i.id));
      // Shuffle padding
      for (let i = padding.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [padding[i], padding[j]] = [padding[j], padding[i]];
      }
      batch = [...batch, ...padding.slice(0, effectiveLimit - batch.length)];
    }
  }

  // Record seen IDs
  for (const item of batch) {
    seenIds.add(item.id);
    this.#cacheItem(item);
  }
  this.#seenIds.set(username, seenIds);

  return {
    items: batch,
    hasMore: freshPool.length > seenIds.size,
    colors: ScrollConfigLoader.extractColors(scrollConfig),
  };
}
```

4. Extract `#fetchAllSources()`:

```js
async #fetchAllSources(scrollConfig, username, { nocache, sources } = {}) {
  const queries = this.#filterQueries(this.#queryConfigs || [], scrollConfig);

  if (nocache) {
    for (const q of queries) q._noCache = true;
  }

  const results = await Promise.allSettled(
    queries.map(query => this.#fetchSource(query, username))
  );

  const allItems = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      allItems.push(...results[i].value);
    } else {
      this.#logger.warn?.('feed.assembly.source.failed', {
        query: queries[i].type,
        error: results[i].reason?.message || 'Unknown error',
      });
    }
  }
  return allItems;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/application/feed/FeedAssemblyService.test.mjs --verbose`
Expected: ALL PASS (some old tests may need minor adjustments to work with tier-based config)

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs tests/isolated/application/feed/FeedAssemblyService.test.mjs
git commit -m "feat(feed): replace assembledCache with seenIds dedup and padding pass"
```

---

### Task 9: Selection Tracking Integration in FeedAssemblyService

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Modify: `tests/isolated/application/feed/FeedAssemblyService.test.mjs`

**Step 1: Write test**

```js
test('passes selectionCounts to tier assembly and increments after batch', async () => {
  const mockTrackingStore = {
    getAll: jest.fn().mockResolvedValue(new Map([
      ['abc123', { count: 5, last: '2026-02-17T00:00:00Z' }],
    ])),
    incrementBatch: jest.fn().mockResolvedValue(undefined),
  };
  const adapter = {
    sourceType: 'reddit',
    fetchItems: jest.fn().mockResolvedValue([
      { id: 'headline:abc123', tier: 'wire', source: 'headline', title: 'H1', timestamp: new Date().toISOString() },
      { id: 'reddit:xyz', tier: 'wire', source: 'reddit', title: 'R1', timestamp: new Date().toISOString() },
    ]),
  };

  const service = createService(
    [{ type: 'reddit', _filename: 'reddit.yml' }],
    [adapter],
    { selectionTrackingStore: mockTrackingStore },
  );

  await service.getNextBatch('testuser');
  expect(mockTrackingStore.getAll).toHaveBeenCalledWith('testuser');
  expect(mockTrackingStore.incrementBatch).toHaveBeenCalledWith(
    ['abc123'], // only headline-prefixed items, with prefix stripped
    'testuser'
  );
});
```

Update `createService` to accept `selectionTrackingStore` in overrides and pass it to `FeedAssemblyService`.

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/FeedAssemblyService.test.mjs --verbose`

**Step 3: Implement**

In `FeedAssemblyService`:

1. Add `#selectionTrackingStore` to constructor:

```js
this.#selectionTrackingStore = selectionTrackingStore || null;
```

2. In `getNextBatch()`, before the primary pass:

```js
// Load selection tracking for sort bias
const selectionCounts = this.#selectionTrackingStore
  ? await this.#selectionTrackingStore.getAll(username)
  : null;
```

3. Pass to `assemble()`:

```js
const { items: primary } = this.#tierAssemblyService.assemble(
  freshPool, scrollConfig, { effectiveLimit, focus, selectionCounts }
);
```

4. After recording seen IDs, increment tracking for headline items:

```js
// Increment selection tracking for headline items
if (this.#selectionTrackingStore) {
  const trackableIds = batch
    .filter(i => i.id?.startsWith('headline:'))
    .map(i => i.id.replace(/^headline:/, ''));
  if (trackableIds.length) {
    await this.#selectionTrackingStore.incrementBatch(trackableIds, username);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/application/feed/FeedAssemblyService.test.mjs --verbose`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs tests/isolated/application/feed/FeedAssemblyService.test.mjs
git commit -m "feat(feed): integrate selectionTrackingStore into FeedAssemblyService"
```

---

### Task 10: Config and Bootstrap Wiring

**Files:**
- Modify: `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/users/kckern/config/feed.yml` (lines 367-383)
- Modify: `backend/src/app.mjs` (lines ~758-790)

**Step 1: Add `padding: true` to config**

In `feed.yml`, update `photos` and `komga` sources:

```yaml
    library:
      color: '#be4bdb'
      allocation: 5
      selection:
        sort: random
        filter: []
        freshness: false
      sources:
        komga:
          max_per_batch: 5
          padding: true
    scrapbook:
      color: '#748ffc'
      allocation: 5
      selection:
        sort: random
        filter: []
        prefer: anniversary
      sources:
        photos:
          max_per_batch: 4
          min_spacing: 3
          padding: true
        journal:
          max_per_batch: 1
          min_spacing: 4
```

**Step 2: Wire `YamlSelectionTrackingStore` in bootstrap**

In `backend/src/app.mjs`, near line 758 (where other feed services are created):

```js
const { YamlSelectionTrackingStore } = await import('./1_adapters/persistence/yaml/YamlSelectionTrackingStore.mjs');
const selectionTrackingStore = new YamlSelectionTrackingStore({ dataService, logger: rootLogger.child({ module: 'selection-tracking' }) });
```

Add `selectionTrackingStore` to the `FeedAssemblyService` constructor call:

```js
const feedAssemblyService = new FeedAssemblyService({
  // ...existing deps...
  selectionTrackingStore,
});
```

**Step 3: Run the dev server and verify no startup crashes**

Run: `node backend/index.js` (or check if already running)
Expected: Server starts without errors

**Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(feed): wire YamlSelectionTrackingStore and add padding config"
```

---

### Task 11: Scroll.jsx IntersectionObserver Fix

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx` (already done)

**Step 1: Verify the fix is in place**

The dependency array at the IntersectionObserver effect should read:

```js
}, [hasMore, loadingMore, fetchItems, loading]);
```

**Step 2: Run Playwright test**

Run: `npx playwright test tests/live/flow/feed/feed-scroll-infinite.runtime.test.mjs --headed`
Expected: Scroll sentinel triggers, 2nd batch loads

**Step 3: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.jsx
git commit -m "fix(feed): add loading to IntersectionObserver deps so 2nd batch loads"
```

---

### Task 12: FeedAssemblyService — Update `#fetchHeadlines` to Use Short IDs

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs` (lines 326-365)

**Step 1: Update `#fetchHeadlines` inline handler**

The inline handler at line 344 currently builds IDs as `headline:${sourceId}:${item.link}`. Update to use the headline's persisted `id` field (now set by `Headline.create()` via the harvester):

```js
// Change line 344 from:
id: `headline:${sourceId}:${item.link}`,
// To:
id: `headline:${item.id || sourceId + ':' + item.link}`,
```

If `item.id` exists (set by harvester via `Headline.create().toJSON()`), use it. Fallback for any pre-existing cached items without `id`.

**Step 2: Run full test suite**

Run: `npx jest tests/isolated/ --verbose`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs
git commit -m "feat(feed): use headline short id in feed assembly"
```

---

## Execution Order

Tasks 1-5 are independent domain/adapter work. Task 6-7 are independent application-layer additions. Task 8-9 depend on 6-7. Task 10 depends on all. Task 11 is independent. Task 12 depends on 1-3.

**Parallelizable groups:**
- Group A (can run in parallel): Tasks 1, 4, 6, 7, 11
- Group B (after Group A): Tasks 2, 3, 5
- Group C (after Group B): Tasks 8, 9, 12
- Group D (after Group C): Task 10
