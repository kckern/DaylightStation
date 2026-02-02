# ContentQueryService.resolve() Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire ItemSelectionService into the playback resolution flow so "play this folder" respects watch state, priority, and scheduling filters.

**Architecture:** Extend ContentQueryService with a `resolve()` method that: (1) calls adapter.resolvePlayables() to get flat items, (2) enriches items with watch state from mediaProgressMemory, (3) applies ItemSelectionService.select() to filter/sort/pick. Routes call this instead of adapters directly.

**Tech Stack:** Node.js ES modules, Jest for testing, existing DDD layers

---

## Task 1: Add mediaProgressMemory to ContentQueryService constructor

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs:7-16`
- Test: `tests/isolated/application/content/ContentQueryService.test.mjs` (create)

**Step 1: Write the failing test**

Create test file:

```javascript
// tests/isolated/application/content/ContentQueryService.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';

describe('ContentQueryService', () => {
  describe('constructor', () => {
    it('accepts mediaProgressMemory as optional dependency', () => {
      const mockRegistry = { get: vi.fn(), list: vi.fn(() => []) };
      const mockMemory = { get: vi.fn(), getAll: vi.fn() };

      const service = new ContentQueryService({
        registry: mockRegistry,
        mediaProgressMemory: mockMemory
      });

      expect(service).toBeDefined();
    });

    it('works without mediaProgressMemory', () => {
      const mockRegistry = { get: vi.fn(), list: vi.fn(() => []) };

      const service = new ContentQueryService({ registry: mockRegistry });

      expect(service).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: PASS (constructor already accepts object, just doesn't store mediaProgressMemory)

**Step 3: Modify constructor to store mediaProgressMemory**

In `ContentQueryService.mjs`, update constructor:

```javascript
export class ContentQueryService {
  #registry;
  #mediaProgressMemory;

  /**
   * @param {Object} deps
   * @param {import('#domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} deps.registry
   * @param {import('#apps/content/ports/IMediaProgressMemory.mjs').IMediaProgressMemory} [deps.mediaProgressMemory]
   */
  constructor({ registry, mediaProgressMemory = null }) {
    this.#registry = registry;
    this.#mediaProgressMemory = mediaProgressMemory;
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs tests/isolated/application/content/ContentQueryService.test.mjs
git commit -m "feat(content): add mediaProgressMemory to ContentQueryService constructor"
```

---

## Task 2: Add #enrichWithWatchState private method

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs`
- Test: `tests/isolated/application/content/ContentQueryService.test.mjs`

**Step 1: Write the failing test**

Add to test file:

```javascript
describe('resolve', () => {
  describe('#enrichWithWatchState (tested via resolve)', () => {
    it('adds percent field from mediaProgressMemory', async () => {
      const mockRegistry = {
        get: vi.fn(() => ({
          resolvePlayables: vi.fn(async () => [
            { id: 'plex:123', title: 'Episode 1' },
            { id: 'plex:456', title: 'Episode 2' }
          ]),
          getStoragePath: vi.fn(async () => 'plex/1_shows')
        })),
        list: vi.fn(() => ['plex'])
      };

      const mockMemory = {
        get: vi.fn(async (itemId) => {
          if (itemId === 'plex:123') return { percent: 95, playhead: 1800, duration: 1900 };
          if (itemId === 'plex:456') return { percent: 10, playhead: 100, duration: 1000 };
          return null;
        }),
        getAll: vi.fn()
      };

      const service = new ContentQueryService({
        registry: mockRegistry,
        mediaProgressMemory: mockMemory
      });

      const result = await service.resolve('plex', 'shows/123', { now: new Date() });

      // Items should be enriched with percent
      expect(result.items[0].percent).toBe(95);
      expect(result.items[1].percent).toBe(10);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: FAIL with "service.resolve is not a function"

**Step 3: Implement #enrichWithWatchState and stub resolve**

Add to ContentQueryService:

```javascript
/**
 * Enrich items with watch state from mediaProgressMemory.
 * @param {Array} items - Items to enrich
 * @param {Object} adapter - Adapter for storage path resolution
 * @returns {Promise<Array>} Enriched items
 */
async #enrichWithWatchState(items, adapter) {
  if (!this.#mediaProgressMemory || items.length === 0) {
    return items;
  }

  return Promise.all(items.map(async (item) => {
    const storagePath = typeof adapter.getStoragePath === 'function'
      ? await adapter.getStoragePath(item.id)
      : adapter.source || 'default';

    const progress = await this.#mediaProgressMemory.get(item.id, storagePath);

    if (!progress) return item;

    return {
      ...item,
      percent: progress.percent ?? 0,
      playhead: progress.playhead ?? 0,
      duration: progress.duration ?? item.duration ?? 0,
      watched: (progress.percent ?? 0) >= 90
    };
  }));
}

/**
 * Resolve a query to playable items with selection applied.
 * @param {string} source - Source name
 * @param {string} localId - Local ID/path within source
 * @param {Object} [context] - Selection context
 * @param {Date} [context.now] - Current date
 * @param {Object} [overrides] - Selection strategy overrides
 * @returns {Promise<{items: Array, strategy: Object}>}
 */
async resolve(source, localId, context = {}, overrides = {}) {
  const adapter = this.#registry.get(source);
  if (!adapter) {
    throw new Error(`Unknown source: ${source}`);
  }

  const items = await adapter.resolvePlayables(localId);
  const enriched = await this.#enrichWithWatchState(items, adapter);

  // TODO: Apply ItemSelectionService in next task
  return { items: enriched, strategy: null };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs tests/isolated/application/content/ContentQueryService.test.mjs
git commit -m "feat(content): add watch state enrichment to ContentQueryService"
```

---

## Task 3: Integrate ItemSelectionService into resolve()

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs`
- Test: `tests/isolated/application/content/ContentQueryService.test.mjs`

**Step 1: Write the failing test**

Add to test file:

```javascript
it('applies ItemSelectionService to filter watched items', async () => {
  const mockRegistry = {
    get: vi.fn(() => ({
      resolvePlayables: vi.fn(async () => [
        { id: 'plex:123', title: 'Episode 1' },
        { id: 'plex:456', title: 'Episode 2' },
        { id: 'plex:789', title: 'Episode 3' }
      ]),
      getStoragePath: vi.fn(async () => 'plex/1_shows')
    })),
    list: vi.fn(() => ['plex'])
  };

  const mockMemory = {
    get: vi.fn(async (itemId) => {
      if (itemId === 'plex:123') return { percent: 95 }; // watched
      if (itemId === 'plex:456') return { percent: 10 }; // in progress
      return null; // not started
    }),
    getAll: vi.fn()
  };

  const service = new ContentQueryService({
    registry: mockRegistry,
    mediaProgressMemory: mockMemory
  });

  const result = await service.resolve('plex', 'shows/123', {
    now: new Date(),
    containerType: 'folder'
  });

  // With watchlist strategy (default for folder), watched items filtered out
  // Should return in_progress first (plex:456), then unwatched (plex:789)
  expect(result.items.length).toBeLessThan(3);
  expect(result.items[0].id).toBe('plex:456'); // in_progress gets priority
  expect(result.strategy.name).toBe('watchlist');
});

it('returns all items when filter=none override', async () => {
  const mockRegistry = {
    get: vi.fn(() => ({
      resolvePlayables: vi.fn(async () => [
        { id: 'plex:123', title: 'Episode 1' },
        { id: 'plex:456', title: 'Episode 2' }
      ]),
      getStoragePath: vi.fn(async () => 'plex/1_shows')
    })),
    list: vi.fn(() => ['plex'])
  };

  const mockMemory = {
    get: vi.fn(async (itemId) => {
      if (itemId === 'plex:123') return { percent: 95 }; // watched
      return null;
    }),
    getAll: vi.fn()
  };

  const service = new ContentQueryService({
    registry: mockRegistry,
    mediaProgressMemory: mockMemory
  });

  const result = await service.resolve('plex', 'shows/123',
    { now: new Date() },
    { filter: 'none' }
  );

  // With filter=none, all items returned
  expect(result.items.length).toBe(2);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: FAIL - items not filtered, strategy is null

**Step 3: Wire ItemSelectionService into resolve()**

Update resolve() method:

```javascript
import { ItemSelectionService } from '#domains/content/index.mjs';

// ... in resolve() method:

async resolve(source, localId, context = {}, overrides = {}) {
  const adapter = this.#registry.get(source);
  if (!adapter) {
    throw new Error(`Unknown source: ${source}`);
  }

  const items = await adapter.resolvePlayables(localId);
  const enriched = await this.#enrichWithWatchState(items, adapter);

  // Determine container type from adapter if not provided
  const containerType = context.containerType
    || (typeof adapter.getContainerType === 'function'
        ? adapter.getContainerType(localId)
        : 'folder');

  const selectionContext = {
    ...context,
    containerType,
    now: context.now || new Date()
  };

  const strategy = ItemSelectionService.resolveStrategy(selectionContext, overrides);
  const selected = ItemSelectionService.select(enriched, selectionContext, overrides);

  return {
    items: selected,
    strategy: {
      name: strategy.name || 'inferred',
      filter: strategy.filter,
      sort: strategy.sort,
      pick: strategy.pick
    }
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs tests/isolated/application/content/ContentQueryService.test.mjs
git commit -m "feat(content): integrate ItemSelectionService into ContentQueryService.resolve()"
```

---

## Task 4: Update bootstrap to inject mediaProgressMemory into ContentQueryService

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:545-546`

**Step 1: No test needed (wiring change)**

This is a wiring change in bootstrap - tested via integration.

**Step 2: Update createApiRouters**

Change line 546 from:
```javascript
const contentQueryService = new ContentQueryService({ registry });
```

To:
```javascript
const contentQueryService = new ContentQueryService({ registry, mediaProgressMemory });
```

**Step 3: Verify manually**

Start dev server and check that ContentQueryService is instantiated without errors:
```bash
npm run dev
# Check logs for any startup errors
```

**Step 4: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(bootstrap): inject mediaProgressMemory into ContentQueryService"
```

---

## Task 5: Update play.mjs to use ContentQueryService.resolve()

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs`

**Step 1: Write integration test**

Create or add to: `tests/live/api/play.test.mjs`

```javascript
import { describe, it, expect } from 'vitest';

describe('GET /api/v1/play/:source/*', () => {
  it('returns selected item based on watch state', async () => {
    // This is an integration test - requires running server
    // Test that playing a folder with watched items skips them

    // For now, manual verification via curl:
    // curl http://localhost:3112/api/v1/play/folder/FHE
    // Should return unwatched item, not first alphabetically
  });
});
```

**Step 2: Update play.mjs to accept contentQueryService**

Modify createPlayRouter signature:

```javascript
export function createPlayRouter(config) {
  const { registry, mediaProgressMemory, contentQueryService, logger = console } = config;
```

**Step 3: Update wildcard route to use resolve()**

Replace lines 283-318 (the container resolution logic):

```javascript
// If shuffle modifier, use resolve with random pick
if (modifiers.shuffle && adapter.resolvePlayables) {
  const result = contentQueryService
    ? await contentQueryService.resolve(source, localId, { now: new Date() }, { pick: 'random' })
    : { items: await adapter.resolvePlayables(localId) };

  if (!result.items.length) {
    return res.status(404).json({ error: 'No playable items found' });
  }

  const selectedItem = result.items[0];
  const storagePath = typeof adapter.getStoragePath === 'function'
    ? await adapter.getStoragePath(selectedItem.id)
    : source;
  const watchState = mediaProgressMemory ? await mediaProgressMemory.get(selectedItem.id, storagePath) : null;

  return res.json(toPlayResponse(selectedItem, watchState));
}

// ... existing getItem code ...

// Check if it's a container (needs resolution to playable)
if (item.isContainer?.() || item.itemType === 'container') {
  const result = contentQueryService
    ? await contentQueryService.resolve(source, localId, { now: new Date() })
    : { items: await adapter.resolvePlayables(compoundId) };

  if (!result.items.length) {
    return res.status(404).json({ error: 'No playable items in container' });
  }

  const selectedItem = result.items[0];
  const storagePath = typeof adapter.getStoragePath === 'function'
    ? await adapter.getStoragePath(selectedItem.id)
    : source;
  const watchState = mediaProgressMemory ? await mediaProgressMemory.get(selectedItem.id, storagePath) : null;

  return res.json(toPlayResponse(selectedItem, watchState));
}
```

**Step 4: Verify via dev server**

```bash
npm run dev
curl http://localhost:3112/api/v1/play/folder/FHE
# Verify response includes selected item based on watch state
```

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs
git commit -m "feat(play): use ContentQueryService.resolve() for smart selection"
```

---

## Task 6: Update bootstrap to pass contentQueryService to play router

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:552`

**Step 1: Update createApiRouters**

Change line 552 from:
```javascript
play: createPlayRouter({ registry, mediaProgressMemory, logger }),
```

To:
```javascript
play: createPlayRouter({ registry, mediaProgressMemory, contentQueryService, logger }),
```

**Step 2: Verify manually**

```bash
npm run dev
curl http://localhost:3112/api/v1/play/folder/FHE
```

**Step 3: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(bootstrap): pass contentQueryService to play router"
```

---

## Task 7: Add priority enrichment from folder config

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs`
- Test: `tests/isolated/application/content/ContentQueryService.test.mjs`

**Step 1: Write failing test**

```javascript
it('preserves priority field from source items', async () => {
  const mockRegistry = {
    get: vi.fn(() => ({
      resolvePlayables: vi.fn(async () => [
        { id: 'plex:123', title: 'Episode 1', priority: 'high' },
        { id: 'plex:456', title: 'Episode 2', priority: 'low' }
      ]),
      getStoragePath: vi.fn(async () => 'plex/1_shows')
    })),
    list: vi.fn(() => ['plex'])
  };

  const mockMemory = {
    get: vi.fn(async () => null),
    getAll: vi.fn()
  };

  const service = new ContentQueryService({
    registry: mockRegistry,
    mediaProgressMemory: mockMemory
  });

  const result = await service.resolve('plex', 'shows/123', {
    now: new Date(),
    containerType: 'folder'
  });

  // High priority item should come first
  expect(result.items[0].priority).toBe('high');
});

it('sets priority to in_progress when percent > 0 and < 90', async () => {
  const mockRegistry = {
    get: vi.fn(() => ({
      resolvePlayables: vi.fn(async () => [
        { id: 'plex:123', title: 'Episode 1' },
        { id: 'plex:456', title: 'Episode 2' }
      ]),
      getStoragePath: vi.fn(async () => 'plex/1_shows')
    })),
    list: vi.fn(() => ['plex'])
  };

  const mockMemory = {
    get: vi.fn(async (itemId) => {
      if (itemId === 'plex:456') return { percent: 45 };
      return null;
    }),
    getAll: vi.fn()
  };

  const service = new ContentQueryService({
    registry: mockRegistry,
    mediaProgressMemory: mockMemory
  });

  const result = await service.resolve('plex', 'shows/123', {
    now: new Date(),
    containerType: 'folder'
  });

  // In-progress item should come first with priority set
  expect(result.items[0].id).toBe('plex:456');
  expect(result.items[0].priority).toBe('in_progress');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: FAIL - priority not set to in_progress

**Step 3: Update #enrichWithWatchState to set priority**

```javascript
async #enrichWithWatchState(items, adapter) {
  if (!this.#mediaProgressMemory || items.length === 0) {
    return items;
  }

  return Promise.all(items.map(async (item) => {
    const storagePath = typeof adapter.getStoragePath === 'function'
      ? await adapter.getStoragePath(item.id)
      : adapter.source || 'default';

    const progress = await this.#mediaProgressMemory.get(item.id, storagePath);

    if (!progress) return item;

    const percent = progress.percent ?? 0;
    const isInProgress = percent > 0 && percent < 90;

    return {
      ...item,
      percent,
      playhead: progress.playhead ?? 0,
      duration: progress.duration ?? item.duration ?? 0,
      watched: percent >= 90,
      // Set priority to in_progress if partially watched (unless already set)
      priority: isInProgress && !item.priority ? 'in_progress' : item.priority
    };
  }));
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs tests/isolated/application/content/ContentQueryService.test.mjs
git commit -m "feat(content): set in_progress priority based on watch state"
```

---

## Task 8: Handle missing adapter gracefully

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs`
- Test: `tests/isolated/application/content/ContentQueryService.test.mjs`

**Step 1: Write failing test**

```javascript
it('throws descriptive error for unknown source', async () => {
  const mockRegistry = {
    get: vi.fn(() => null),
    list: vi.fn(() => ['plex'])
  };

  const service = new ContentQueryService({ registry: mockRegistry });

  await expect(service.resolve('unknown', 'path'))
    .rejects.toThrow('Unknown source: unknown');
});

it('throws descriptive error when adapter lacks resolvePlayables', async () => {
  const mockRegistry = {
    get: vi.fn(() => ({ name: 'broken-adapter' })),
    list: vi.fn(() => ['broken'])
  };

  const service = new ContentQueryService({ registry: mockRegistry });

  await expect(service.resolve('broken', 'path'))
    .rejects.toThrow('Adapter broken does not support resolvePlayables');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: FAIL - second test throws different error

**Step 3: Add validation in resolve()**

```javascript
async resolve(source, localId, context = {}, overrides = {}) {
  const adapter = this.#registry.get(source);
  if (!adapter) {
    throw new Error(`Unknown source: ${source}`);
  }

  if (typeof adapter.resolvePlayables !== 'function') {
    throw new Error(`Adapter ${source} does not support resolvePlayables`);
  }

  // ... rest of method
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs tests/isolated/application/content/ContentQueryService.test.mjs
git commit -m "feat(content): add validation for adapter capabilities in resolve()"
```

---

## Task 9: Run full test suite and fix any regressions

**Files:**
- Various (any failing tests)

**Step 1: Run all content-related tests**

```bash
npx vitest run tests/isolated/domain/content/
npx vitest run tests/isolated/application/content/
```

**Step 2: Fix any failures**

Address any test failures from existing tests.

**Step 3: Run ItemSelectionService tests to ensure no regressions**

```bash
npx vitest run tests/isolated/domain/content/services/ItemSelectionService.test.mjs
```

Expected: All 57 tests PASS

**Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix: address test regressions from ContentQueryService.resolve()"
```

---

## Task 10: Update documentation

**Files:**
- Modify: `docs/reference/content/item-selection-service.md`

**Step 1: Add integration section**

Add to end of item-selection-service.md:

```markdown
---

## 13. Integration with ContentQueryService

ItemSelectionService is wired into the playback flow via `ContentQueryService.resolve()`:

```javascript
// Application layer orchestrates the pipeline
const result = await contentQueryService.resolve('folder', 'FHE', {
  now: new Date(),
  containerType: 'folder'
});

// Returns: { items: [...selected], strategy: { name, filter, sort, pick } }
```

### Resolution Flow

```
Route (/api/v1/play/:source/*)
    ↓
ContentQueryService.resolve()
    ↓
adapter.resolvePlayables()     → Flat list of items
    ↓
#enrichWithWatchState()        → Add percent, watched, priority from memory
    ↓
ItemSelectionService.select()  → Filter → Sort → Pick
    ↓
Selected items returned
```

### Watch State Enrichment

Before selection, items are enriched with:

| Field | Source | Purpose |
|-------|--------|---------|
| `percent` | mediaProgressMemory | Watch progress (0-100) |
| `watched` | percent >= 90 | Boolean for filter |
| `priority` | 'in_progress' if 0 < percent < 90 | Sort ordering |
| `playhead` | mediaProgressMemory | Resume position |

This ensures ItemSelectionService has the data it needs to apply watchlist filters.
```

**Step 2: Commit**

```bash
git add docs/reference/content/item-selection-service.md
git commit -m "docs: add ContentQueryService integration section to ItemSelectionService reference"
```

---

## Summary

After completing all tasks:

1. **ContentQueryService** has a new `resolve()` method that orchestrates playback resolution
2. **mediaProgressMemory** is injected and used to enrich items with watch state
3. **ItemSelectionService** is called to apply filter/sort/pick based on strategy
4. **play.mjs** route uses the new resolve() instead of calling adapters directly
5. **Documentation** updated to explain the integration

The "play this folder" request now respects watch state, priority, and scheduling filters.
