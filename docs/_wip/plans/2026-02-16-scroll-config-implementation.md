# Scroll Config (`scroll.yml`) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement per-user `scroll.yml` config that controls feed assembly — interleaving ratio, spacing rules, per-source distribution caps, and focus mode.

**Architecture:** A new `ScrollConfigLoader` reads `data/users/{username}/config/scroll.yml` via DataService and merges with hardcoded defaults. FeedAssemblyService receives the loaded config per-request and delegates spacing enforcement to a new `SpacingEnforcer` module. The API router passes a new `focus` query param through to the service.

**Tech Stack:** Node.js, ES modules, YAML (via DataService), Jest for testing

---

## Task 1: ScrollConfigLoader — Defaults and Merging

**Files:**
- Create: `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs`
- Test: `tests/isolated/application/feed/ScrollConfigLoader.test.mjs`

This module reads `scroll.yml` from user config and deep-merges it with hardcoded defaults. If no file exists, defaults are returned. This is a pure function + DataService read — no side effects.

**Step 1: Write the failing test**

```javascript
// tests/isolated/application/feed/ScrollConfigLoader.test.mjs
import { jest } from '@jest/globals';
import { ScrollConfigLoader } from '#apps/feed/services/ScrollConfigLoader.mjs';

describe('ScrollConfigLoader', () => {
  let loader;
  let mockDataService;

  beforeEach(() => {
    mockDataService = {
      user: {
        read: jest.fn().mockReturnValue(null),
      },
    };
    loader = new ScrollConfigLoader({ dataService: mockDataService });
  });

  describe('load()', () => {
    test('returns defaults when no scroll.yml exists', () => {
      const config = loader.load('kckern');
      expect(config.batch_size).toBe(15);
      expect(config.algorithm.grounding_ratio).toBe(5);
      expect(config.algorithm.decay_rate).toBe(0.85);
      expect(config.algorithm.min_ratio).toBe(2);
      expect(config.spacing.max_consecutive).toBe(1);
      expect(config.sources).toEqual({});
      expect(mockDataService.user.read).toHaveBeenCalledWith('config/scroll', 'kckern');
    });

    test('merges user overrides with defaults', () => {
      mockDataService.user.read.mockReturnValue({
        batch_size: 20,
        algorithm: { grounding_ratio: 8 },
        sources: {
          reddit: { max_per_batch: 5, min_spacing: 2 },
        },
      });
      const config = loader.load('kckern');
      expect(config.batch_size).toBe(20);
      expect(config.algorithm.grounding_ratio).toBe(8);
      expect(config.algorithm.decay_rate).toBe(0.85); // default preserved
      expect(config.algorithm.min_ratio).toBe(2);      // default preserved
      expect(config.sources.reddit.max_per_batch).toBe(5);
    });

    test('merges focus_mode with defaults', () => {
      mockDataService.user.read.mockReturnValue({
        focus_mode: { grounding_ratio: 10 },
      });
      const config = loader.load('kckern');
      expect(config.focus_mode.grounding_ratio).toBe(10);
      expect(config.focus_mode.decay_rate).toBe(0.9);  // default
      expect(config.focus_mode.min_ratio).toBe(3);      // default
    });

    test('does not mutate defaults across calls', () => {
      mockDataService.user.read.mockReturnValue({ batch_size: 99 });
      loader.load('alice');
      mockDataService.user.read.mockReturnValue(null);
      const config = loader.load('bob');
      expect(config.batch_size).toBe(15); // not 99
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/ScrollConfigLoader.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/feed/services/ScrollConfigLoader.mjs
const DEFAULTS = Object.freeze({
  batch_size: 15,
  algorithm: Object.freeze({
    grounding_ratio: 5,
    decay_rate: 0.85,
    min_ratio: 2,
  }),
  focus_mode: Object.freeze({
    grounding_ratio: 8,
    decay_rate: 0.9,
    min_ratio: 3,
  }),
  spacing: Object.freeze({
    max_consecutive: 1,
  }),
  sources: Object.freeze({}),
});

export class ScrollConfigLoader {
  #dataService;

  constructor({ dataService }) {
    this.#dataService = dataService;
  }

  load(username) {
    const userConfig = this.#dataService.user.read('config/scroll', username) || {};
    return this.#merge(userConfig);
  }

  #merge(user) {
    return {
      batch_size: user.batch_size ?? DEFAULTS.batch_size,
      algorithm: {
        ...DEFAULTS.algorithm,
        ...user.algorithm,
      },
      focus_mode: {
        ...DEFAULTS.focus_mode,
        ...user.focus_mode,
      },
      spacing: {
        ...DEFAULTS.spacing,
        ...user.spacing,
      },
      sources: user.sources ?? { ...DEFAULTS.sources },
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/feed/ScrollConfigLoader.test.mjs --verbose`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/ScrollConfigLoader.mjs tests/isolated/application/feed/ScrollConfigLoader.test.mjs
git commit -m "feat(feed): add ScrollConfigLoader with defaults and merge logic"
```

---

## Task 2: SpacingEnforcer — Distribution and Spacing Pass

**Files:**
- Create: `backend/src/3_applications/feed/services/SpacingEnforcer.mjs`
- Test: `tests/isolated/application/feed/SpacingEnforcer.test.mjs`

This is a pure function module — takes an interleaved item array and scroll config, returns a reordered/trimmed array satisfying all spacing and distribution constraints.

**Algorithm overview:**
1. Enforce `sources.{name}.max_per_batch` — drop excess items per source
2. Enforce `sources.{name}.subsources.max_per_batch` — drop excess items per subsource
3. Enforce `spacing.max_consecutive` — no N+ items from same source in a row
4. Enforce `sources.{name}.min_spacing` — reposition items that are too close
5. Enforce `sources.{name}.subsources.min_spacing` — same at subsource level

**Step 1: Write the failing tests**

```javascript
// tests/isolated/application/feed/SpacingEnforcer.test.mjs
import { SpacingEnforcer } from '#apps/feed/services/SpacingEnforcer.mjs';

const item = (source, subsource = null, id = null) => ({
  id: id || `${source}:${subsource || 'x'}:${Math.random()}`,
  source,
  type: 'external',
  meta: { subreddit: subsource, sourceId: subsource, feedTitle: subsource },
});

describe('SpacingEnforcer', () => {
  const enforcer = new SpacingEnforcer();

  describe('enforce()', () => {
    test('passes through items unchanged when no rules violated', () => {
      const items = [item('reddit'), item('headlines'), item('reddit')];
      const config = { spacing: { max_consecutive: 1 }, sources: {} };
      const result = enforcer.enforce(items, config);
      expect(result).toHaveLength(3);
    });

    test('enforces max_per_batch per source', () => {
      const items = [
        item('reddit', 'r1', 'a'), item('reddit', 'r2', 'b'),
        item('reddit', 'r3', 'c'), item('headlines', 'h1', 'd'),
      ];
      const config = {
        spacing: { max_consecutive: 99 },
        sources: { reddit: { max_per_batch: 2 } },
      };
      const result = enforcer.enforce(items, config);
      const redditCount = result.filter(i => i.source === 'reddit').length;
      expect(redditCount).toBe(2);
      expect(result.find(i => i.source === 'headlines')).toBeTruthy();
    });

    test('enforces max_consecutive (no back-to-back same source)', () => {
      const items = [
        item('reddit', null, 'a'), item('reddit', null, 'b'),
        item('headlines', null, 'c'), item('headlines', null, 'd'),
      ];
      const config = { spacing: { max_consecutive: 1 }, sources: {} };
      const result = enforcer.enforce(items, config);
      for (let i = 1; i < result.length; i++) {
        expect(result[i].source).not.toBe(result[i - 1].source);
      }
    });

    test('enforces min_spacing between same source', () => {
      const items = [
        item('photos', null, 'a'), item('headlines', null, 'b'),
        item('photos', null, 'c'), item('headlines', null, 'd'),
        item('headlines', null, 'e'),
      ];
      const config = {
        spacing: { max_consecutive: 1 },
        sources: { photos: { min_spacing: 3 } },
      };
      const result = enforcer.enforce(items, config);
      const photoIndices = result
        .map((it, idx) => it.source === 'photos' ? idx : -1)
        .filter(i => i >= 0);
      for (let i = 1; i < photoIndices.length; i++) {
        expect(photoIndices[i] - photoIndices[i - 1]).toBeGreaterThanOrEqual(3);
      }
    });

    test('enforces subsource max_per_batch', () => {
      const items = [
        item('reddit', 'science', 'a'), item('reddit', 'science', 'b'),
        item('reddit', 'science', 'c'), item('reddit', 'tech', 'd'),
      ];
      const config = {
        spacing: { max_consecutive: 99 },
        sources: {
          reddit: { max_per_batch: 10, subsources: { max_per_batch: 2 } },
        },
      };
      const result = enforcer.enforce(items, config);
      const scienceCount = result.filter(
        i => i.source === 'reddit' && i.meta?.subreddit === 'science'
      ).length;
      expect(scienceCount).toBe(2);
    });

    test('returns empty array for empty input', () => {
      const result = enforcer.enforce([], { spacing: { max_consecutive: 1 }, sources: {} });
      expect(result).toEqual([]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/SpacingEnforcer.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/feed/services/SpacingEnforcer.mjs
/**
 * SpacingEnforcer
 *
 * Pure function module. Takes an interleaved feed item array and scroll config,
 * returns a reordered/trimmed array satisfying distribution and spacing rules.
 */
export class SpacingEnforcer {

  enforce(items, config) {
    if (!items.length) return [];

    let result = [...items];

    // 1. Source-level max_per_batch
    result = this.#enforceMaxPerBatch(result, config);

    // 2. Subsource-level max_per_batch
    result = this.#enforceSubsourceMaxPerBatch(result, config);

    // 3. max_consecutive (no N+ same source in a row)
    result = this.#enforceMaxConsecutive(result, config.spacing?.max_consecutive ?? 1);

    // 4. Source-level min_spacing
    result = this.#enforceMinSpacing(result, config);

    return result;
  }

  #enforceMaxPerBatch(items, config) {
    const counts = {};
    return items.filter(item => {
      const sourceConfig = config.sources?.[item.source];
      if (!sourceConfig?.max_per_batch) return true;
      counts[item.source] = (counts[item.source] || 0) + 1;
      return counts[item.source] <= sourceConfig.max_per_batch;
    });
  }

  #enforceSubsourceMaxPerBatch(items, config) {
    const counts = {};
    return items.filter(item => {
      const sourceConfig = config.sources?.[item.source];
      if (!sourceConfig?.subsources?.max_per_batch) return true;
      const subKey = this.#getSubsourceKey(item);
      if (!subKey) return true;
      const key = `${item.source}:${subKey}`;
      counts[key] = (counts[key] || 0) + 1;
      return counts[key] <= sourceConfig.subsources.max_per_batch;
    });
  }

  #enforceMaxConsecutive(items, maxConsecutive) {
    if (maxConsecutive <= 0 || items.length <= 1) return items;

    const result = [items[0]];
    const deferred = [];

    for (let i = 1; i < items.length; i++) {
      // Count how many consecutive items of same source are at tail of result
      let consecutive = 0;
      for (let j = result.length - 1; j >= 0; j--) {
        if (result[j].source === items[i].source) consecutive++;
        else break;
      }

      if (consecutive < maxConsecutive) {
        result.push(items[i]);
      } else {
        deferred.push(items[i]);
      }
    }

    // Try to re-insert deferred items at valid positions
    for (const item of deferred) {
      let inserted = false;
      for (let pos = 0; pos <= result.length; pos++) {
        if (this.#canInsertAt(result, pos, item.source, maxConsecutive)) {
          result.splice(pos, 0, item);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        result.push(item); // append at end as last resort
      }
    }

    return result;
  }

  #canInsertAt(arr, pos, source, maxConsecutive) {
    // Check backward
    let before = 0;
    for (let i = pos - 1; i >= 0; i--) {
      if (arr[i].source === source) before++;
      else break;
    }
    // Check forward
    let after = 0;
    for (let i = pos; i < arr.length; i++) {
      if (arr[i].source === source) after++;
      else break;
    }
    return (before + after + 1) <= maxConsecutive;
  }

  #enforceMinSpacing(items, config) {
    const result = [];
    const deferred = [];

    for (const item of items) {
      const minSpacing = config.sources?.[item.source]?.min_spacing || 0;
      if (minSpacing <= 0) {
        result.push(item);
        continue;
      }

      // Find last occurrence of same source in result
      let lastIdx = -1;
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].source === item.source) { lastIdx = i; break; }
      }

      if (lastIdx === -1 || (result.length - lastIdx) >= minSpacing) {
        result.push(item);
      } else {
        deferred.push(item);
      }
    }

    // Re-insert deferred items at valid positions
    for (const item of deferred) {
      const minSpacing = config.sources?.[item.source]?.min_spacing || 0;
      let inserted = false;
      for (let pos = 0; pos <= result.length; pos++) {
        if (this.#canInsertWithSpacing(result, pos, item.source, minSpacing)) {
          result.splice(pos, 0, item);
          inserted = true;
          break;
        }
      }
      if (!inserted) result.push(item);
    }

    return result;
  }

  #canInsertWithSpacing(arr, pos, source, minSpacing) {
    // Check nearest same-source before this position
    for (let i = pos - 1; i >= Math.max(0, pos - minSpacing); i--) {
      if (arr[i].source === source) return false;
    }
    // Check nearest same-source after this position
    for (let i = pos; i < Math.min(arr.length, pos + minSpacing); i++) {
      if (arr[i].source === source) return false;
    }
    return true;
  }

  #getSubsourceKey(item) {
    return item.meta?.subreddit || item.meta?.sourceId || item.meta?.feedTitle || null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/feed/SpacingEnforcer.test.mjs --verbose`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/SpacingEnforcer.mjs tests/isolated/application/feed/SpacingEnforcer.test.mjs
git commit -m "feat(feed): add SpacingEnforcer for distribution and spacing rules"
```

---

## Task 3: Refactor FeedAssemblyService to Use Scroll Config

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Test: `tests/isolated/application/feed/FeedAssemblyService.test.mjs` (create)

The service receives `scrollConfigLoader` and `spacingEnforcer` via constructor. On each `getNextBatch()` call, it:
1. Loads scroll config for the username
2. Filters `queryConfigs` to sources listed in scroll config (or all if `sources: {}`)
3. Uses scroll config algorithm params instead of hardcoded values
4. Selects `focus_mode` params when `focus` option is present
5. Delegates to SpacingEnforcer after interleaving
6. Uses `batch_size` from config if `limit` not explicitly provided

**Step 1: Write the failing test**

```javascript
// tests/isolated/application/feed/FeedAssemblyService.test.mjs
import { jest } from '@jest/globals';
import { FeedAssemblyService } from '#apps/feed/services/FeedAssemblyService.mjs';

describe('FeedAssemblyService scroll config integration', () => {
  let service;
  let mockScrollConfigLoader;
  let mockSpacingEnforcer;

  const defaultScrollConfig = {
    batch_size: 15,
    algorithm: { grounding_ratio: 5, decay_rate: 0.85, min_ratio: 2 },
    focus_mode: { grounding_ratio: 8, decay_rate: 0.9, min_ratio: 3 },
    spacing: { max_consecutive: 1 },
    sources: {},
  };

  const makeExternalItem = (source, id) => ({
    id: id || `${source}:${Math.random()}`,
    type: 'external',
    source,
    title: `${source} item`,
    meta: { sourceName: source },
  });

  const makeGroundingItem = (source, id, priority = 5) => ({
    id: id || `${source}:${Math.random()}`,
    type: 'grounding',
    source,
    title: `${source} item`,
    priority,
    meta: { sourceName: source },
  });

  beforeEach(() => {
    mockScrollConfigLoader = {
      load: jest.fn().mockReturnValue(defaultScrollConfig),
    };
    mockSpacingEnforcer = {
      enforce: jest.fn().mockImplementation((items) => items),
    };
  });

  function createService(queryConfigs, adapters = []) {
    return new FeedAssemblyService({
      freshRSSAdapter: null,
      headlineService: null,
      entropyService: null,
      queryConfigs,
      sourceAdapters: adapters,
      scrollConfigLoader: mockScrollConfigLoader,
      spacingEnforcer: mockSpacingEnforcer,
      logger: { info: jest.fn(), warn: jest.fn() },
    });
  }

  test('loads scroll config for the requesting user', async () => {
    const service = createService([]);
    await service.getNextBatch('alice');
    expect(mockScrollConfigLoader.load).toHaveBeenCalledWith('alice');
  });

  test('filters query configs to sources listed in scroll config', async () => {
    const mockAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue([makeExternalItem('reddit', 'r1')]),
    };
    const mockHealthAdapter = {
      sourceType: 'health',
      fetchItems: jest.fn().mockResolvedValue([makeGroundingItem('health', 'h1')]),
    };

    mockScrollConfigLoader.load.mockReturnValue({
      ...defaultScrollConfig,
      sources: { reddit: { max_per_batch: 5 } },
      // health NOT listed => should be skipped
    });

    const service = createService(
      [
        { type: 'reddit', feed_type: 'external' },
        { type: 'health', feed_type: 'grounding' },
      ],
      [mockAdapter, mockHealthAdapter],
    );

    await service.getNextBatch('kckern');
    expect(mockAdapter.fetchItems).toHaveBeenCalled();
    expect(mockHealthAdapter.fetchItems).not.toHaveBeenCalled();
  });

  test('fetches ALL sources when scroll config sources is empty object', async () => {
    const mockAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue([]),
    };

    mockScrollConfigLoader.load.mockReturnValue({
      ...defaultScrollConfig,
      sources: {},
    });

    const service = createService(
      [{ type: 'reddit', feed_type: 'external' }],
      [mockAdapter],
    );

    await service.getNextBatch('kckern');
    expect(mockAdapter.fetchItems).toHaveBeenCalled();
  });

  test('uses focus_mode algorithm params when focus option present', async () => {
    mockScrollConfigLoader.load.mockReturnValue({
      ...defaultScrollConfig,
      focus_mode: { grounding_ratio: 10, decay_rate: 0.95, min_ratio: 4 },
    });

    const service = createService([]);
    await service.getNextBatch('kckern', { focus: 'reddit:science' });
    // The spacing enforcer should be called (verifying the pipeline ran)
    expect(mockSpacingEnforcer.enforce).toHaveBeenCalled();
  });

  test('passes items through SpacingEnforcer', async () => {
    const mockAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue([
        makeExternalItem('reddit', 'r1'),
        makeExternalItem('reddit', 'r2'),
      ]),
    };

    const service = createService(
      [{ type: 'reddit', feed_type: 'external' }],
      [mockAdapter],
    );

    await service.getNextBatch('kckern');
    expect(mockSpacingEnforcer.enforce).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ spacing: { max_consecutive: 1 } }),
    );
  });

  test('uses batch_size from scroll config as default limit', async () => {
    mockScrollConfigLoader.load.mockReturnValue({
      ...defaultScrollConfig,
      batch_size: 5,
    });

    const mockAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => makeExternalItem('reddit', `r${i}`))
      ),
    };

    const service = createService(
      [{ type: 'reddit', feed_type: 'external' }],
      [mockAdapter],
    );

    const result = await service.getNextBatch('kckern');
    expect(result.items.length).toBeLessThanOrEqual(5);
  });

  test('explicit limit overrides batch_size from config', async () => {
    mockScrollConfigLoader.load.mockReturnValue({
      ...defaultScrollConfig,
      batch_size: 5,
    });

    const mockAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => makeExternalItem('reddit', `r${i}`))
      ),
    };

    const service = createService(
      [{ type: 'reddit', feed_type: 'external' }],
      [mockAdapter],
    );

    const result = await service.getNextBatch('kckern', { limit: 8 });
    expect(result.items.length).toBeLessThanOrEqual(8);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/FeedAssemblyService.test.mjs --verbose`
Expected: FAIL — scrollConfigLoader not used, source filtering not implemented

**Step 3: Modify FeedAssemblyService**

Apply these changes to `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`:

1. Add `#scrollConfigLoader` and `#spacingEnforcer` private fields
2. Accept them in constructor
3. In `getNextBatch()`:
   - Load scroll config: `const scrollConfig = this.#scrollConfigLoader?.load(username) || DEFAULTS`
   - Use `scrollConfig.batch_size` as default limit
   - Filter queries to enabled sources
   - Calculate grounding ratio from config params (not hardcoded)
   - Select focus_mode params when `options.focus` is truthy
   - After interleave + dedup, pass through spacingEnforcer
4. Replace hardcoded values in `#calculateGroundingRatio()`

**Modified `getNextBatch` signature:**

```javascript
async getNextBatch(username, { limit, cursor, sessionStartedAt, focus } = {}) {
  // Load scroll config
  const scrollConfig = this.#scrollConfigLoader
    ? this.#scrollConfigLoader.load(username)
    : { batch_size: 15, algorithm: { grounding_ratio: 5, decay_rate: 0.85, min_ratio: 2 },
        focus_mode: { grounding_ratio: 8, decay_rate: 0.9, min_ratio: 3 },
        spacing: { max_consecutive: 1 }, sources: {} };

  const effectiveLimit = limit ?? scrollConfig.batch_size;

  // Filter queries to enabled sources
  let queries = this.#queryConfigs || [];
  const enabledSources = scrollConfig.sources;
  if (enabledSources && Object.keys(enabledSources).length > 0) {
    queries = queries.filter(q => q.type in enabledSources || q._filename?.replace('.yml', '') in enabledSources);
  }

  // ... existing fan-out, classify, sort logic ...

  // Select algorithm params
  const algoParams = focus ? scrollConfig.focus_mode : scrollConfig.algorithm;

  // Calculate grounding ratio using config params
  const sessionMinutes = sessionStartedAt
    ? (Date.now() - new Date(sessionStartedAt).getTime()) / 60000
    : 0;
  const ratio = this.#calculateGroundingRatio(sessionMinutes, algoParams);

  // Interleave
  const interleaved = this.#interleave(external, grounding, ratio);

  // Deduplicate
  const seen = new Set();
  const deduplicated = interleaved.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  // Spacing enforcement
  const spaced = this.#spacingEnforcer
    ? this.#spacingEnforcer.enforce(deduplicated, scrollConfig)
    : deduplicated;

  const items = spaced.slice(0, effectiveLimit);
  // ...
}
```

**Modified `#calculateGroundingRatio`:**

```javascript
#calculateGroundingRatio(sessionMinutes, params = {}) {
  const { grounding_ratio = 5, decay_rate = 0.85, min_ratio = 2 } = params;
  return Math.max(min_ratio, Math.floor(grounding_ratio * Math.pow(decay_rate, sessionMinutes / 5)));
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/feed/FeedAssemblyService.test.mjs --verbose`
Expected: PASS (7 tests)

**Step 5: Run existing feed tests to verify no regression**

Run: `npx jest tests/isolated/api/feed/ --verbose`
Expected: PASS — existing router tests unaffected (they don't use scrollConfigLoader)

**Step 6: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs tests/isolated/application/feed/FeedAssemblyService.test.mjs
git commit -m "refactor(feed): integrate ScrollConfigLoader and SpacingEnforcer into FeedAssemblyService"
```

---

## Task 4: Wire New Dependencies in Bootstrap

**Files:**
- Modify: `backend/src/app.mjs` (lines ~708-720)

Wire `ScrollConfigLoader` and `SpacingEnforcer` into the FeedAssemblyService constructor in the bootstrap code.

**Step 1: Write the wiring code**

In `backend/src/app.mjs`, after the adapter instantiations (around line 707) and before FeedAssemblyService construction (line 708):

```javascript
const { ScrollConfigLoader } = await import('./3_applications/feed/services/ScrollConfigLoader.mjs');
const { SpacingEnforcer } = await import('./3_applications/feed/services/SpacingEnforcer.mjs');

const scrollConfigLoader = new ScrollConfigLoader({ dataService });
const spacingEnforcer = new SpacingEnforcer();
```

Then add to the FeedAssemblyService constructor call:

```javascript
const feedAssemblyService = new FeedAssemblyService({
  // ... existing params ...
  scrollConfigLoader,
  spacingEnforcer,
});
```

**Step 2: Update API router to pass `focus` query param**

In `backend/src/4_api/v1/routers/feed.mjs`, the scroll endpoint (line 117-128):

```javascript
router.get('/scroll', asyncHandler(async (req, res) => {
  const username = getUsername();
  const { cursor, limit, session, focus } = req.query;

  const result = await feedAssemblyService.getNextBatch(username, {
    limit: limit ? Number(limit) : undefined,
    cursor,
    sessionStartedAt: session || null,
    focus: focus || null,
  });

  res.json(result);
}));
```

Note: `limit` is now `undefined` by default (not `15`) so FeedAssemblyService can use `batch_size` from scroll config. When the caller passes `?limit=20`, it overrides.

**Step 3: Run full isolated test suite to verify no regression**

Run: `npx jest tests/isolated/ --verbose`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add backend/src/app.mjs backend/src/4_api/v1/routers/feed.mjs
git commit -m "feat(feed): wire ScrollConfigLoader and SpacingEnforcer in bootstrap, pass focus param"
```

---

## Task 5: Create Default `scroll.yml` for User

**Files:**
- Create: `data/users/kckern/config/scroll.yml` (via Dropbox data path)

This is a data file, not code. Create the default config matching the design spec.

**Step 1: Create the file**

Path: `{DAYLIGHT_DATA_PATH}/users/kckern/config/scroll.yml`

```yaml
# Scroll Config — controls feed assembly algorithm
# See docs/_wip/plans/2026-02-16-scroll-config-design.md for field reference

batch_size: 15

algorithm:
  grounding_ratio: 5
  decay_rate: 0.85
  min_ratio: 2

focus_mode:
  grounding_ratio: 8
  decay_rate: 0.9
  min_ratio: 3

spacing:
  max_consecutive: 1

sources:
  headlines:
    max_per_batch: 8
    subsources:
      max_per_batch: 3
      min_spacing: 3
  news:
    max_per_batch: 4
  reddit:
    max_per_batch: 5
    min_spacing: 2
    subsources:
      max_per_batch: 2
      min_spacing: 4
  entropy:
    max_per_batch: 3
  health:
    max_per_batch: 1
  weather:
    max_per_batch: 1
  gratitude:
    max_per_batch: 1
  fitness:
    max_per_batch: 1
  tasks:
    max_per_batch: 3
  photos:
    max_per_batch: 2
    min_spacing: 5
  plex:
    max_per_batch: 2
    min_spacing: 4
  plex-music:
    max_per_batch: 1
```

**Step 2: Verify DataService can read it**

Start dev server and test via API or add a quick manual check:

Run: `curl -s http://localhost:3112/api/v1/feed/scroll | jq '.items | length'`
Expected: Returns a number (feed still works)

**Step 3: Commit**

```bash
git add docs/_wip/plans/2026-02-16-scroll-config-design.md
git commit -m "docs(feed): add scroll.yml design spec"
```

Note: The `scroll.yml` data file lives in Dropbox and isn't tracked in git. Only the design doc is committed.

---

## Task 6: Source Filtering by Query Filename

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Modify: `tests/isolated/application/feed/FeedAssemblyService.test.mjs`

The scroll config `sources` keys map to query YAML **filenames** (without `.yml`), not adapter `type` values. For example, `plex-music` maps to `plex-music.yml` which has `type: plex`. The current filtering logic needs to check `query._filename` (set during bootstrap load) against scroll config source keys.

**Step 1: Write the failing test**

Add to `FeedAssemblyService.test.mjs`:

```javascript
test('filters by query _filename, not adapter type', async () => {
  const plexAdapter = {
    sourceType: 'plex',
    fetchItems: jest.fn().mockResolvedValue([]),
  };

  mockScrollConfigLoader.load.mockReturnValue({
    ...defaultScrollConfig,
    sources: { plex: { max_per_batch: 2 } },
    // 'plex-music' NOT listed => plex-music.yml should be filtered out
  });

  const service = createService(
    [
      { type: 'plex', feed_type: 'grounding', _filename: 'plex.yml' },
      { type: 'plex', feed_type: 'grounding', _filename: 'plex-music.yml' },
    ],
    [plexAdapter],
  );

  await service.getNextBatch('kckern');
  // Should only be called once (for plex.yml), not twice
  expect(plexAdapter.fetchItems).toHaveBeenCalledTimes(1);
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/FeedAssemblyService.test.mjs --verbose`
Expected: FAIL — currently filters by `type`, not `_filename`

**Step 3: Fix the filtering logic**

In FeedAssemblyService `getNextBatch()`, the source filtering should use `_filename`:

```javascript
if (enabledSources && Object.keys(enabledSources).length > 0) {
  queries = queries.filter(q => {
    const queryKey = q._filename ? q._filename.replace('.yml', '') : q.type;
    return queryKey in enabledSources;
  });
}
```

**Step 4: Run tests to verify pass**

Run: `npx jest tests/isolated/application/feed/FeedAssemblyService.test.mjs --verbose`
Expected: PASS (8 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs tests/isolated/application/feed/FeedAssemblyService.test.mjs
git commit -m "fix(feed): filter sources by query filename, not adapter type"
```

---

## Task 7: Focus Mode — Frontend Integration

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx`

When a user taps a source badge/label to drill in, the scroll component passes `focus=source:subsource` to the API.

**Step 1: Update `fetchItems` to accept focus param**

In `frontend/src/modules/Feed/Scroll/Scroll.jsx`, update the API call in `fetchItems()`:

```javascript
// Add focus to component state or prop
const [focusSource, setFocusSource] = useState(null);

// In fetchItems():
let url = `/api/v1/feed/scroll?limit=15&session=${sessionStart}`;
if (focusSource) url += `&focus=${encodeURIComponent(focusSource)}`;
const res = await DaylightAPI(url);
```

**Step 2: Verify manually**

Start dev server: `npm run dev`
Open feed at `http://localhost:3111/feed/scroll`
Manually test: `http://localhost:3111/feed/scroll?focus=reddit:science` (should show mostly reddit/science content with grounding cards interspersed)

**Step 3: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.jsx
git commit -m "feat(feed): pass focus param from frontend scroll to API"
```

---

## Task 8: Focus Mode — Backend Source Filtering

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Modify: `tests/isolated/application/feed/FeedAssemblyService.test.mjs`

When `focus` is set, external content is filtered to only the focused source (and optionally subsource). Grounding content remains unchanged.

**Step 1: Write the failing test**

Add to `FeedAssemblyService.test.mjs`:

```javascript
test('focus mode filters external items to focused source', async () => {
  const redditAdapter = {
    sourceType: 'reddit',
    fetchItems: jest.fn().mockResolvedValue([
      { ...makeExternalItem('reddit', 'r1'), meta: { subreddit: 'science', sourceName: 'reddit' } },
      { ...makeExternalItem('reddit', 'r2'), meta: { subreddit: 'tech', sourceName: 'reddit' } },
    ]),
  };
  const headlinesAdapter = {
    sourceType: 'headlines',
    fetchItems: jest.fn().mockResolvedValue([
      makeExternalItem('headline', 'h1'),
    ]),
  };
  const weatherAdapter = {
    sourceType: 'weather',
    fetchItems: jest.fn().mockResolvedValue([
      makeGroundingItem('weather', 'w1', 3),
    ]),
  };

  const service = createService(
    [
      { type: 'reddit', feed_type: 'external', _filename: 'reddit.yml' },
      { type: 'headlines', feed_type: 'external', _filename: 'headlines.yml' },
      { type: 'weather', feed_type: 'grounding', _filename: 'weather.yml' },
    ],
    [redditAdapter, headlinesAdapter, weatherAdapter],
  );

  const result = await service.getNextBatch('kckern', { focus: 'reddit' });
  const sources = result.items.map(i => i.source);
  // Should have reddit and weather (grounding), but NOT headlines
  expect(sources).not.toContain('headline');
  expect(sources).toContain('reddit');
});

test('focus mode with subsource filters to specific subsource', async () => {
  const redditAdapter = {
    sourceType: 'reddit',
    fetchItems: jest.fn().mockResolvedValue([
      { ...makeExternalItem('reddit', 'r1'), meta: { subreddit: 'science', sourceName: 'reddit' } },
      { ...makeExternalItem('reddit', 'r2'), meta: { subreddit: 'tech', sourceName: 'reddit' } },
    ]),
  };

  const service = createService(
    [{ type: 'reddit', feed_type: 'external', _filename: 'reddit.yml' }],
    [redditAdapter],
  );

  const result = await service.getNextBatch('kckern', { focus: 'reddit:science' });
  const subs = result.items.filter(i => i.source === 'reddit').map(i => i.meta?.subreddit);
  expect(subs).toEqual(['science']);
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/FeedAssemblyService.test.mjs --verbose`
Expected: FAIL — focus filtering not yet implemented

**Step 3: Add focus filtering after classification**

In `getNextBatch()`, after separating external/grounding and before interleaving:

```javascript
// Focus mode: filter external to focused source/subsource
if (focus) {
  const [focusSource, focusSubsource] = focus.split(':');
  external = external.filter(item => {
    // Match by query key (not adapter type) when possible
    if (item.source !== focusSource && item.meta?.queryKey !== focusSource) return false;
    if (focusSubsource) {
      const subKey = item.meta?.subreddit || item.meta?.sourceId || item.meta?.feedTitle;
      if (subKey !== focusSubsource) return false;
    }
    return true;
  });
}
```

Also tag items with `queryKey` during fetch so focus can match by filename:

In `#fetchSource()`, after getting items from adapter:
```javascript
const queryKey = query._filename ? query._filename.replace('.yml', '') : query.type;
return items.map(item => ({
  ...this.#normalizeToFeedItem(item),
  meta: { ...this.#normalizeToFeedItem(item).meta, queryKey },
}));
```

**Step 4: Run tests to verify pass**

Run: `npx jest tests/isolated/application/feed/FeedAssemblyService.test.mjs --verbose`
Expected: PASS (10 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs tests/isolated/application/feed/FeedAssemblyService.test.mjs
git commit -m "feat(feed): implement focus mode source/subsource filtering"
```

---

## Task 9: Update Router Test for Focus Param

**Files:**
- Modify: `tests/isolated/api/feed/feed.router.test.mjs`

**Step 1: Add test for focus query param passthrough**

```javascript
describe('GET /scroll', () => {
  test('passes focus param to feedAssemblyService', async () => {
    const mockFeedAssemblyService = {
      getNextBatch: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    // Recreate router with mockFeedAssemblyService
    const router = createFeedRouter({
      freshRSSAdapter: mockFreshRSSAdapter,
      headlineService: mockHeadlineService,
      feedAssemblyService: mockFeedAssemblyService,
      configService: mockConfigService,
    });
    const focusApp = express();
    focusApp.use(express.json());
    focusApp.use('/api/v1/feed', router);

    await request(focusApp).get('/api/v1/feed/scroll?focus=reddit:science');
    expect(mockFeedAssemblyService.getNextBatch).toHaveBeenCalledWith(
      'kckern',
      expect.objectContaining({ focus: 'reddit:science' }),
    );
  });

  test('limit defaults to undefined when not provided', async () => {
    const mockFeedAssemblyService = {
      getNextBatch: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    const router = createFeedRouter({
      freshRSSAdapter: mockFreshRSSAdapter,
      headlineService: mockHeadlineService,
      feedAssemblyService: mockFeedAssemblyService,
      configService: mockConfigService,
    });
    const limitApp = express();
    limitApp.use(express.json());
    limitApp.use('/api/v1/feed', router);

    await request(limitApp).get('/api/v1/feed/scroll');
    expect(mockFeedAssemblyService.getNextBatch).toHaveBeenCalledWith(
      'kckern',
      expect.objectContaining({ limit: undefined }),
    );
  });
});
```

**Step 2: Run test**

Run: `npx jest tests/isolated/api/feed/feed.router.test.mjs --verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/isolated/api/feed/feed.router.test.mjs
git commit -m "test(feed): add router tests for focus param and limit defaults"
```

---

## Task 10: End-to-End Smoke Test

**Files:**
- None new — manual verification against running dev server

**Step 1: Start dev server**

```bash
lsof -i :3111  # Check if already running
npm run dev     # Start if needed
```

**Step 2: Test default scroll behavior**

```bash
curl -s http://localhost:3112/api/v1/feed/scroll | jq '{ count: (.items | length), sources: [.items[].source] | unique, hasMore }'
```

Expected: Returns items from enabled sources, count ≤ batch_size, diverse source distribution

**Step 3: Test focus mode**

```bash
curl -s 'http://localhost:3112/api/v1/feed/scroll?focus=reddit' | jq '{ count: (.items | length), sources: [.items[].source] | unique }'
```

Expected: Only reddit (external) and grounding sources, no headlines/news

**Step 4: Test with explicit limit**

```bash
curl -s 'http://localhost:3112/api/v1/feed/scroll?limit=5' | jq '.items | length'
```

Expected: ≤ 5

**Step 5: Run full test suite**

```bash
npm run test:isolated
```

Expected: All PASS

**Step 6: Final commit (if any fixups needed)**

```bash
git add -A && git commit -m "fix(feed): scroll config smoke test fixups"
```

---

## Dependency Graph

```
Task 1 (ScrollConfigLoader)  ──┐
                                ├── Task 3 (FeedAssemblyService refactor) ── Task 4 (Bootstrap wiring)
Task 2 (SpacingEnforcer)     ──┘                                              │
                                                                               ├── Task 5 (scroll.yml data)
                                                                               ├── Task 6 (Filename filtering)
                                                                               ├── Task 7 (Frontend focus)
                                                                               ├── Task 8 (Backend focus filter)
                                                                               ├── Task 9 (Router test update)
                                                                               └── Task 10 (Smoke test)
```

Tasks 1 and 2 are independent and can be parallelized. Tasks 6-9 are independent of each other but all depend on Task 4.
