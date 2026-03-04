# Flexbox Feed Allocation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the ad-hoc feed allocation system with a CSS flexbox-inspired engine that uses proportional values, a standard flex algorithm, and vendor-agnostic content types.

**Architecture:** Three new application-layer services (FlexAllocator, FlexConfigParser, SourceResolver) plus a `CONTENT_TYPES` enum and `provides` getter on the existing `IFeedSourceAdapter` port. TierAssemblyService is updated to delegate allocation to FlexAllocator. All 18 adapter implementations declare their content types. Legacy config keys are parsed as flex equivalents for backward compatibility.

**Tech Stack:** Node.js ES modules (.mjs), Jest for testing, YAML config files, DDD hexagonal architecture.

**DDD Layer Rules:**
- `3_applications/feed/ports/` — Port interfaces (IFeedSourceAdapter) and shared enums (CONTENT_TYPES)
- `3_applications/feed/services/` — FlexAllocator, FlexConfigParser, SourceResolver (application services)
- `1_adapters/feed/sources/` — Adapter implementations (add `provides` getter)
- `0_system/` — No changes
- `2_domains/` — No changes (flex allocation is application-specific, not universal domain logic)
- `4_api/` — No changes

---

## Task 1: Add CONTENT_TYPES Enum and `provides` Getter to IFeedSourceAdapter Port

**Files:**
- Modify: `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs`
- Test: `tests/isolated/application/feed/IFeedSourceAdapter.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/isolated/application/feed/IFeedSourceAdapter.test.mjs`:

```javascript
import { jest } from '@jest/globals';
import { IFeedSourceAdapter, isFeedSourceAdapter, CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

describe('IFeedSourceAdapter', () => {
  describe('CONTENT_TYPES', () => {
    test('exports a frozen object with expected keys', () => {
      expect(Object.isFrozen(CONTENT_TYPES)).toBe(true);
      expect(CONTENT_TYPES.FEEDS).toBe('feeds');
      expect(CONTENT_TYPES.NEWS).toBe('news');
      expect(CONTENT_TYPES.SOCIAL).toBe('social');
      expect(CONTENT_TYPES.PHOTOS).toBe('photos');
      expect(CONTENT_TYPES.COMICS).toBe('comics');
      expect(CONTENT_TYPES.EBOOKS).toBe('ebooks');
      expect(CONTENT_TYPES.AUDIO).toBe('audio');
      expect(CONTENT_TYPES.VIDEO).toBe('video');
      expect(CONTENT_TYPES.JOURNAL).toBe('journal');
      expect(CONTENT_TYPES.BOOK_REVIEWS).toBe('book-reviews');
      expect(CONTENT_TYPES.TASKS).toBe('tasks');
      expect(CONTENT_TYPES.WEATHER).toBe('weather');
      expect(CONTENT_TYPES.HEALTH).toBe('health');
      expect(CONTENT_TYPES.FITNESS).toBe('fitness');
      expect(CONTENT_TYPES.GRATITUDE).toBe('gratitude');
      expect(CONTENT_TYPES.ENTROPY).toBe('entropy');
      expect(CONTENT_TYPES.SCRIPTURE).toBe('scripture');
    });
  });

  describe('provides getter', () => {
    test('base class returns empty array', () => {
      const adapter = new IFeedSourceAdapter();
      expect(adapter.provides).toEqual([]);
    });

    test('subclass can override provides', () => {
      class TestAdapter extends IFeedSourceAdapter {
        get sourceType() { return 'test'; }
        get provides() { return [CONTENT_TYPES.FEEDS]; }
      }
      const adapter = new TestAdapter();
      expect(adapter.provides).toEqual(['feeds']);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/IFeedSourceAdapter.test.mjs --no-coverage`
Expected: FAIL — `CONTENT_TYPES` is not exported, `provides` getter doesn't exist.

**Step 3: Write minimal implementation**

Modify `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs` — add before the class:

```javascript
export const CONTENT_TYPES = Object.freeze({
  FEEDS:        'feeds',
  NEWS:         'news',
  SOCIAL:       'social',
  PHOTOS:       'photos',
  COMICS:       'comics',
  EBOOKS:       'ebooks',
  AUDIO:        'audio',
  VIDEO:        'video',
  JOURNAL:      'journal',
  BOOK_REVIEWS: 'book-reviews',
  TASKS:        'tasks',
  WEATHER:      'weather',
  HEALTH:       'health',
  FITNESS:      'fitness',
  GRATITUDE:    'gratitude',
  ENTROPY:      'entropy',
  SCRIPTURE:    'scripture',
});
```

And add inside the `IFeedSourceAdapter` class body:

```javascript
  get provides() { return []; }
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/feed/IFeedSourceAdapter.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs tests/isolated/application/feed/IFeedSourceAdapter.test.mjs
git commit -m "feat(feed): add CONTENT_TYPES enum and provides getter to IFeedSourceAdapter port"
```

---

## Task 2: Add `provides` Getter to All 18 Adapter Implementations

**Files:**
- Modify: All 18 files in `backend/src/1_adapters/feed/sources/*.mjs`
- Test: `tests/isolated/adapter/feed/AdapterProvides.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/isolated/adapter/feed/AdapterProvides.test.mjs`:

```javascript
import { CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

// Import all adapters
import { FreshRSSSourceAdapter } from '#adapters/feed/sources/FreshRSSSourceAdapter.mjs';
import { HeadlineFeedAdapter } from '#adapters/feed/sources/HeadlineFeedAdapter.mjs';
import { GoogleNewsFeedAdapter } from '#adapters/feed/sources/GoogleNewsFeedAdapter.mjs';
import { RedditFeedAdapter } from '#adapters/feed/sources/RedditFeedAdapter.mjs';
import { ImmichFeedAdapter } from '#adapters/feed/sources/ImmichFeedAdapter.mjs';
import { KomgaFeedAdapter } from '#adapters/feed/sources/KomgaFeedAdapter.mjs';
import { ABSEbookFeedAdapter } from '#adapters/feed/sources/ABSEbookFeedAdapter.mjs';
import { PlexFeedAdapter } from '#adapters/feed/sources/PlexFeedAdapter.mjs';
import { YouTubeFeedAdapter } from '#adapters/feed/sources/YouTubeFeedAdapter.mjs';
import { JournalFeedAdapter } from '#adapters/feed/sources/JournalFeedAdapter.mjs';
import { GoodreadsFeedAdapter } from '#adapters/feed/sources/GoodreadsFeedAdapter.mjs';
import { TodoistFeedAdapter } from '#adapters/feed/sources/TodoistFeedAdapter.mjs';
import { WeatherFeedAdapter } from '#adapters/feed/sources/WeatherFeedAdapter.mjs';
import { HealthFeedAdapter } from '#adapters/feed/sources/HealthFeedAdapter.mjs';
import { StravaFeedAdapter } from '#adapters/feed/sources/StravaFeedAdapter.mjs';
import { GratitudeFeedAdapter } from '#adapters/feed/sources/GratitudeFeedAdapter.mjs';
import { EntropyFeedAdapter } from '#adapters/feed/sources/EntropyFeedAdapter.mjs';
import { ReadalongFeedAdapter } from '#adapters/feed/sources/ReadalongFeedAdapter.mjs';

const EXPECTED = [
  [FreshRSSSourceAdapter,   'freshrss',    [CONTENT_TYPES.FEEDS]],
  [HeadlineFeedAdapter,     'headlines',   [CONTENT_TYPES.NEWS]],
  [GoogleNewsFeedAdapter,   'googlenews',  [CONTENT_TYPES.NEWS]],
  [RedditFeedAdapter,       'reddit',      [CONTENT_TYPES.SOCIAL]],
  [ImmichFeedAdapter,       'immich',      [CONTENT_TYPES.PHOTOS]],
  [KomgaFeedAdapter,        'komga',       [CONTENT_TYPES.COMICS]],
  [ABSEbookFeedAdapter,     'abs-ebooks',  [CONTENT_TYPES.EBOOKS]],
  [PlexFeedAdapter,         'plex',        [CONTENT_TYPES.VIDEO]],
  [YouTubeFeedAdapter,      'youtube',     [CONTENT_TYPES.VIDEO]],
  [JournalFeedAdapter,      'journal',     [CONTENT_TYPES.JOURNAL]],
  [GoodreadsFeedAdapter,    'goodreads',   [CONTENT_TYPES.BOOK_REVIEWS]],
  [TodoistFeedAdapter,      'todoist',     [CONTENT_TYPES.TASKS]],
  [WeatherFeedAdapter,      'weather',     [CONTENT_TYPES.WEATHER]],
  [HealthFeedAdapter,       'health',      [CONTENT_TYPES.HEALTH]],
  [StravaFeedAdapter,       'strava',      [CONTENT_TYPES.FITNESS]],
  [GratitudeFeedAdapter,    'gratitude',   [CONTENT_TYPES.GRATITUDE]],
  [EntropyFeedAdapter,      'entropy',     [CONTENT_TYPES.ENTROPY]],
  [ReadalongFeedAdapter,    'readalong',   [CONTENT_TYPES.SCRIPTURE]],
];

describe('Adapter provides declarations', () => {
  test.each(EXPECTED)('%s declares sourceType=%s and provides=%j',
    (AdapterClass, expectedType, expectedProvides) => {
      // Construct with minimal deps (provides is a static getter, no deps needed)
      const adapter = Object.create(AdapterClass.prototype);
      expect(adapter.provides).toEqual(expectedProvides);
    }
  );

  test('every provides value is a valid CONTENT_TYPES value', () => {
    const validValues = new Set(Object.values(CONTENT_TYPES));
    for (const [AdapterClass] of EXPECTED) {
      const adapter = Object.create(AdapterClass.prototype);
      for (const ct of adapter.provides) {
        expect(validValues.has(ct)).toBe(true);
      }
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/AdapterProvides.test.mjs --no-coverage`
Expected: FAIL — `provides` returns `[]` for all adapters (inherited default).

**Step 3: Write minimal implementation**

Add `get provides()` to each adapter class. Pattern:

```javascript
// In each adapter file, inside the class body, after `get sourceType()`:
import { CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';
// ... (add to existing import if IFeedSourceAdapter already imported)

get provides() { return [CONTENT_TYPES.FEEDS]; }  // varies per adapter
```

Complete list — add this one-liner to each adapter class:

| Adapter File | Add getter |
|-------------|-----------|
| `FreshRSSSourceAdapter.mjs` | `get provides() { return [CONTENT_TYPES.FEEDS]; }` |
| `HeadlineFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.NEWS]; }` |
| `GoogleNewsFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.NEWS]; }` |
| `RedditFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.SOCIAL]; }` |
| `ImmichFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.PHOTOS]; }` |
| `KomgaFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.COMICS]; }` |
| `ABSEbookFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.EBOOKS]; }` |
| `PlexFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.VIDEO]; }` |
| `YouTubeFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.VIDEO]; }` |
| `JournalFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.JOURNAL]; }` |
| `GoodreadsFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.BOOK_REVIEWS]; }` |
| `TodoistFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.TASKS]; }` |
| `WeatherFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.WEATHER]; }` |
| `HealthFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.HEALTH]; }` |
| `StravaFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.FITNESS]; }` |
| `GratitudeFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.GRATITUDE]; }` |
| `EntropyFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.ENTROPY]; }` |
| `ReadalongFeedAdapter.mjs` | `get provides() { return [CONTENT_TYPES.SCRIPTURE]; }` |

Each adapter already imports `IFeedSourceAdapter` from `#apps/feed/ports/IFeedSourceAdapter.mjs`. Update the import to also include `CONTENT_TYPES`:

```javascript
import { IFeedSourceAdapter, CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';
```

If the adapter uses a default import or only imports `IFeedSourceAdapter`, switch to a named import that includes `CONTENT_TYPES`.

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/adapter/feed/AdapterProvides.test.mjs --no-coverage`
Expected: PASS (18 adapters + 1 validation test)

**Step 5: Run existing adapter tests to check for regressions**

Run: `npx jest tests/isolated/adapter/feed/ --no-coverage`
Expected: All existing tests still pass.

**Step 6: Commit**

```bash
git add backend/src/1_adapters/feed/sources/*.mjs tests/isolated/adapter/feed/AdapterProvides.test.mjs
git commit -m "feat(feed): add provides() content type declaration to all 18 adapters"
```

---

## Task 3: Create FlexAllocator — Pure Flex Distribution Algorithm

**Files:**
- Create: `backend/src/3_applications/feed/services/FlexAllocator.mjs`
- Test: `tests/isolated/application/feed/FlexAllocator.test.mjs` (new)

This is the core algorithm. It is a pure, stateless function: numbers in, numbers out. No knowledge of feeds, tiers, or sources.

**Step 1: Write the failing tests**

Create `tests/isolated/application/feed/FlexAllocator.test.mjs`:

```javascript
import { FlexAllocator } from '#apps/feed/services/FlexAllocator.mjs';

describe('FlexAllocator', () => {
  describe('distribute', () => {
    test('distributes equally when all children have grow:1 and basis:0', () => {
      const children = [
        { key: 'a', grow: 1, shrink: 1, basis: 0, min: 0, max: Infinity, available: 100 },
        { key: 'b', grow: 1, shrink: 1, basis: 0, min: 0, max: Infinity, available: 100 },
      ];
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('a')).toBe(5);
      expect(result.get('b')).toBe(5);
    });

    test('respects basis allocation before grow', () => {
      const children = [
        { key: 'a', grow: 1, shrink: 1, basis: 0.6, min: 0, max: Infinity, available: 100 },
        { key: 'b', grow: 1, shrink: 1, basis: 0.2, min: 0, max: Infinity, available: 100 },
      ];
      // basis: a=30, b=10 → sum=40 → 10 free → split 5/5 → a=35, b=15
      const result = FlexAllocator.distribute(50, children);
      expect(result.get('a')).toBe(35);
      expect(result.get('b')).toBe(15);
    });

    test('grow:0 children do not receive free space', () => {
      const children = [
        { key: 'fixed', grow: 0, shrink: 0, basis: 0.2, min: 0, max: Infinity, available: 100 },
        { key: 'flex',  grow: 1, shrink: 1, basis: 0,   min: 0, max: Infinity, available: 100 },
      ];
      const result = FlexAllocator.distribute(50, children);
      expect(result.get('fixed')).toBe(10);  // 0.2 * 50 = 10
      expect(result.get('flex')).toBe(40);   // gets all free space
    });

    test('shrinks proportionally on overflow', () => {
      const children = [
        { key: 'a', grow: 0, shrink: 1, basis: 0.6, min: 0, max: Infinity, available: 100 },
        { key: 'b', grow: 0, shrink: 1, basis: 0.6, min: 0, max: Infinity, available: 100 },
      ];
      // basis: a=30, b=30 → sum=60 → overflow=10 → weighted: a=1*30=30, b=1*30=30
      // a_reduction = 10 * 30/60 = 5 → a=25, b=25
      const result = FlexAllocator.distribute(50, children);
      expect(result.get('a')).toBe(25);
      expect(result.get('b')).toBe(25);
    });

    test('clamps to min and max', () => {
      const children = [
        { key: 'a', grow: 1, shrink: 1, basis: 0, min: 8, max: Infinity, available: 100 },
        { key: 'b', grow: 1, shrink: 1, basis: 0, min: 0, max: 3,       available: 100 },
      ];
      // Without clamp: a=5, b=5. With clamp: b→3, freed 2→a. a=7 but min 8 → a=8, total=11>10
      // Re-run: b frozen at 3, a gets 7 but min is 8 → 8. Total 11 exceeds 10.
      // When min constraints exceed container, min wins (same as CSS).
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('a')).toBeGreaterThanOrEqual(8);
      expect(result.get('b')).toBeLessThanOrEqual(3);
    });

    test('clamps to available items', () => {
      const children = [
        { key: 'a', grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 3 },
        { key: 'b', grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
      ];
      const result = FlexAllocator.distribute(20, children);
      expect(result.get('a')).toBe(3);      // clamped to available
      expect(result.get('b')).toBe(17);     // gets remainder
    });

    test('implicit floor: children with available > 0 get at least 1', () => {
      const children = [
        { key: 'big',   grow: 10, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
        { key: 'small', grow: 0,  shrink: 0, basis: 0, min: 0, max: Infinity, available: 5 },
      ];
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('small')).toBeGreaterThanOrEqual(1);
    });

    test('children with available: 0 get 0 slots', () => {
      const children = [
        { key: 'a', grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 0 },
        { key: 'b', grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 50 },
      ];
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('a')).toBe(0);
      expect(result.get('b')).toBe(10);
    });

    test('rounds to integers and distributes remainder to highest-grow', () => {
      const children = [
        { key: 'a', grow: 2, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
        { key: 'b', grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
      ];
      // 10 slots: a=6.67, b=3.33. Rounded: a=7, b=3 (remainder to highest grow)
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('a') + result.get('b')).toBe(10);
      expect(result.get('a')).toBeGreaterThan(result.get('b'));
    });

    test('auto basis uses min of available and containerSize', () => {
      const children = [
        { key: 'a', grow: 0, shrink: 1, basis: 'auto', min: 0, max: Infinity, available: 3 },
        { key: 'b', grow: 1, shrink: 1, basis: 0,      min: 0, max: Infinity, available: 100 },
      ];
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('a')).toBe(3);  // auto → min(3, 10) = 3
      expect(result.get('b')).toBe(7);
    });

    test('empty children returns empty map', () => {
      const result = FlexAllocator.distribute(10, []);
      expect(result.size).toBe(0);
    });

    test('single child gets full container (clamped to available)', () => {
      const children = [
        { key: 'only', grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
      ];
      const result = FlexAllocator.distribute(10, children);
      expect(result.get('only')).toBe(10);
    });

    test('dominant alias pattern: grow:2 gets double the share of grow:1', () => {
      const children = [
        { key: 'dominant', grow: 2, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
        { key: 'normal',   grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
        { key: 'normal2',  grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity, available: 100 },
      ];
      // Total grow = 4. dominant = 2/4 = 50%, others 25% each.
      const result = FlexAllocator.distribute(40, children);
      expect(result.get('dominant')).toBe(20);
      expect(result.get('normal')).toBe(10);
      expect(result.get('normal2')).toBe(10);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/FlexAllocator.test.mjs --no-coverage`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `backend/src/3_applications/feed/services/FlexAllocator.mjs`:

```javascript
// backend/src/3_applications/feed/services/FlexAllocator.mjs
/**
 * FlexAllocator
 *
 * Pure, stateless flex-distribution algorithm modeled after CSS flexbox.
 * Runs identically at both nesting levels (batch → tier, tier → source).
 *
 * Input: container size + child descriptors with {key, grow, shrink, basis, min, max, available}.
 * Output: Map<key, slots> where slots are non-negative integers summing to ≤ containerSize.
 *
 * @module applications/feed/services
 */

const MAX_ITERATIONS = 10;

export class FlexAllocator {
  /**
   * Distribute containerSize slots among children using flex rules.
   *
   * @param {number} containerSize - Total slots to distribute
   * @param {Array<{key: string, grow: number, shrink: number, basis: number|'auto', min: number, max: number, available: number}>} children
   * @returns {Map<string, number>} Allocated slots per child key
   */
  static distribute(containerSize, children) {
    if (!children.length) return new Map();

    // Phase 1: Resolve basis and build working copies
    const items = children.map(c => ({
      key: c.key,
      grow: c.grow,
      shrink: c.shrink,
      basis: FlexAllocator.#resolveBasis(c.basis, c.available, containerSize),
      min: c.min,
      max: Math.min(c.max, c.available),
      available: c.available,
      frozen: c.available === 0,
      size: 0,
    }));

    // Freeze zero-available children immediately
    for (const item of items) {
      if (item.frozen) item.size = 0;
    }

    // Phase 2: Iterative flex resolution (handles re-clamping)
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const unfrozen = items.filter(i => !i.frozen);
      if (unfrozen.length === 0) break;

      // Sum bases of unfrozen items
      const basisSum = unfrozen.reduce((s, i) => s + i.basis, 0);
      const frozenSum = items.filter(i => i.frozen).reduce((s, i) => s + i.size, 0);
      const space = containerSize - frozenSum;
      const delta = space - basisSum;

      // Assign sizes
      for (const item of unfrozen) {
        if (delta > 0 && item.grow > 0) {
          const totalGrow = unfrozen.reduce((s, i) => s + i.grow, 0);
          item.size = item.basis + (delta * item.grow / totalGrow);
        } else if (delta < 0 && item.shrink > 0) {
          const weightedTotal = unfrozen.reduce((s, i) => s + i.shrink * i.basis, 0);
          const reduction = weightedTotal > 0
            ? (-delta) * (item.shrink * item.basis) / weightedTotal
            : 0;
          item.size = item.basis - reduction;
        } else {
          item.size = item.basis;
        }
      }

      // Distribute grow to grow-eligible items even if some have grow:0
      if (delta > 0) {
        const totalGrow = unfrozen.reduce((s, i) => s + i.grow, 0);
        if (totalGrow > 0) {
          for (const item of unfrozen) {
            item.size = item.basis + (delta * item.grow / totalGrow);
          }
        }
      }

      // Clamp and freeze any that hit bounds
      let anyFrozen = false;
      for (const item of unfrozen) {
        const clamped = Math.max(item.min, Math.min(item.max, item.size));
        if (clamped !== item.size) {
          item.size = clamped;
          item.frozen = true;
          anyFrozen = true;
        }
      }

      if (!anyFrozen) break;
    }

    // Phase 3: Implicit floor — any child with available > 0 gets at least 1
    for (const item of items) {
      if (item.available > 0 && item.size < 1) {
        item.size = 1;
      }
    }

    // Phase 4: Round to integers
    const result = FlexAllocator.#roundToIntegers(items, containerSize);
    return result;
  }

  static #resolveBasis(basis, available, containerSize) {
    if (basis === 'auto') return Math.min(available, containerSize);
    if (typeof basis === 'number') return basis * containerSize;
    return 0;
  }

  static #roundToIntegers(items, containerSize) {
    // Floor all, track remainders
    const entries = items.map(item => ({
      key: item.key,
      floored: Math.max(0, Math.floor(item.size)),
      remainder: item.size - Math.floor(item.size),
      grow: item.grow,
    }));

    let total = entries.reduce((s, e) => s + e.floored, 0);
    let remainder = containerSize - total;

    // Distribute remainder to highest-grow children first (by remainder desc as tiebreak)
    if (remainder > 0) {
      const sorted = [...entries]
        .filter(e => e.remainder > 0 || e.grow > 0)
        .sort((a, b) => b.grow - a.grow || b.remainder - a.remainder);

      for (const entry of sorted) {
        if (remainder <= 0) break;
        entry.floored += 1;
        remainder -= 1;
      }
    }

    const result = new Map();
    for (const entry of entries) {
      result.set(entry.key, entry.floored);
    }
    return result;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/feed/FlexAllocator.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/FlexAllocator.mjs tests/isolated/application/feed/FlexAllocator.test.mjs
git commit -m "feat(feed): add FlexAllocator — pure flex distribution algorithm"
```

---

## Task 4: Create FlexConfigParser — Parse Flex Shorthand, Aliases, and Legacy Keys

**Files:**
- Create: `backend/src/3_applications/feed/services/FlexConfigParser.mjs`
- Test: `tests/isolated/application/feed/FlexConfigParser.test.mjs` (new)

**Step 1: Write the failing tests**

Create `tests/isolated/application/feed/FlexConfigParser.test.mjs`:

```javascript
import { FlexConfigParser } from '#apps/feed/services/FlexConfigParser.mjs';

describe('FlexConfigParser', () => {
  describe('parseFlexNode', () => {
    test('parses shorthand string "2 0 5"', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: '2 0 5' }, 50);
      expect(result).toEqual({ grow: 2, shrink: 0, basis: 5 / 50, min: 0, max: Infinity });
    });

    test('parses shorthand string "1 1 auto"', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: '1 1 auto' }, 50);
      expect(result).toEqual({ grow: 1, shrink: 1, basis: 'auto', min: 0, max: Infinity });
    });

    test('parses single number flex: 2 as grow only', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 2 }, 50);
      expect(result).toEqual({ grow: 2, shrink: 1, basis: 0, min: 0, max: Infinity });
    });

    test('parses explicit keys', () => {
      const result = FlexConfigParser.parseFlexNode({ grow: 3, shrink: 0, basis: 10 }, 50);
      expect(result).toEqual({ grow: 3, shrink: 0, basis: 10 / 50, min: 0, max: Infinity });
    });

    test('explicit keys override shorthand', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: '1 1 auto', grow: 5 }, 50);
      expect(result.grow).toBe(5);
    });

    test('parses "filler" alias', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'filler' }, 50);
      expect(result).toEqual({ grow: 1, shrink: 1, basis: 0, min: 0, max: Infinity });
    });

    test('parses "fixed" alias', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'fixed' }, 50);
      expect(result).toEqual({ grow: 0, shrink: 0, basis: 'auto', min: 0, max: Infinity });
    });

    test('parses "none" alias', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'none' }, 50);
      expect(result).toEqual({ grow: 0, shrink: 0, basis: 'auto', min: 0, max: Infinity });
    });

    test('parses "dominant" alias', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'dominant' }, 50);
      expect(result).toEqual({ grow: 2, shrink: 0, basis: 'auto', min: 0, max: Infinity });
    });

    test('parses "padding" alias', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'padding' }, 50);
      expect(result).toEqual({ grow: 1, shrink: 0, basis: 0, min: 0, max: Infinity });
    });

    test('parses "auto" alias', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'auto' }, 50);
      expect(result).toEqual({ grow: 1, shrink: 1, basis: 'auto', min: 0, max: Infinity });
    });

    test('normalizes integer min/max as proportion of parent', () => {
      const result = FlexConfigParser.parseFlexNode({ flex: 'auto', min: 20, max: 40 }, 50);
      expect(result.min).toBe(20);  // min/max stay as absolute item counts
      expect(result.max).toBe(40);
    });

    test('uses defaults when no flex properties present', () => {
      const result = FlexConfigParser.parseFlexNode({}, 50);
      expect(result).toEqual({ grow: 0, shrink: 1, basis: 'auto', min: 0, max: Infinity });
    });
  });

  describe('parseLegacyNode', () => {
    test('maps allocation to basis', () => {
      const result = FlexConfigParser.parseFlexNode({ allocation: 6 }, 50);
      expect(result.basis).toBe(6 / 50);
    });

    test('maps max_per_batch to max', () => {
      const result = FlexConfigParser.parseFlexNode({ max_per_batch: 11 }, 50);
      expect(result.max).toBe(11);
    });

    test('maps min_per_batch to min', () => {
      const result = FlexConfigParser.parseFlexNode({ min_per_batch: 3 }, 50);
      expect(result.min).toBe(3);
    });

    test('maps role: filler to filler alias', () => {
      const result = FlexConfigParser.parseFlexNode({ role: 'filler' }, 50);
      expect(result.grow).toBe(1);
      expect(result.shrink).toBe(1);
      expect(result.basis).toBe(0);
    });

    test('maps padding: true to padding alias', () => {
      const result = FlexConfigParser.parseFlexNode({ padding: true }, 50);
      expect(result.grow).toBe(1);
      expect(result.shrink).toBe(0);
      expect(result.basis).toBe(0);
    });

    test('flex keys take precedence over legacy', () => {
      const result = FlexConfigParser.parseFlexNode(
        { allocation: 6, flex: 'dominant' }, 50
      );
      expect(result.grow).toBe(2);        // from dominant
      expect(result.basis).toBe('auto');   // from dominant, not allocation
    });
  });

  describe('normalizeBasis', () => {
    test('float 0.0-1.0 stays as proportion', () => {
      const result = FlexConfigParser.parseFlexNode({ basis: 0.5 }, 50);
      expect(result.basis).toBe(0.5);
    });

    test('integer > 1 normalized to proportion', () => {
      const result = FlexConfigParser.parseFlexNode({ basis: 10 }, 50);
      expect(result.basis).toBe(10 / 50);
    });

    test('"auto" stays as "auto"', () => {
      const result = FlexConfigParser.parseFlexNode({ basis: 'auto' }, 50);
      expect(result.basis).toBe('auto');
    });

    test('0 stays as 0', () => {
      const result = FlexConfigParser.parseFlexNode({ basis: 0 }, 50);
      expect(result.basis).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/FlexConfigParser.test.mjs --no-coverage`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `backend/src/3_applications/feed/services/FlexConfigParser.mjs`:

```javascript
// backend/src/3_applications/feed/services/FlexConfigParser.mjs
/**
 * FlexConfigParser
 *
 * Parses flex config nodes from YAML into normalized descriptors for FlexAllocator.
 * Supports: shorthand strings, explicit keys, named aliases, and legacy key migration.
 *
 * @module applications/feed/services
 */

const ALIASES = Object.freeze({
  filler:   { grow: 1, shrink: 1, basis: 0 },
  fixed:    { grow: 0, shrink: 0, basis: 'auto' },
  none:     { grow: 0, shrink: 0, basis: 'auto' },
  dominant: { grow: 2, shrink: 0, basis: 'auto' },
  padding:  { grow: 1, shrink: 0, basis: 0 },
  auto:     { grow: 1, shrink: 1, basis: 'auto' },
});

const DEFAULTS = Object.freeze({ grow: 0, shrink: 1, basis: 'auto', min: 0, max: Infinity });

export class FlexConfigParser {
  /**
   * Parse a config node into a normalized flex descriptor.
   *
   * @param {Object} node - Raw YAML config node
   * @param {number} parentSize - Parent container size (for normalizing integers to proportions)
   * @returns {{ grow: number, shrink: number, basis: number|'auto', min: number, max: number }}
   */
  static parseFlexNode(node, parentSize) {
    // Layer 1: Legacy key mapping (lowest priority)
    const legacy = FlexConfigParser.#parseLegacy(node, parentSize);

    // Layer 2: Flex shorthand or alias
    const flexParsed = FlexConfigParser.#parseFlex(node.flex, parentSize);

    // Layer 3: Explicit keys (highest priority)
    const explicit = FlexConfigParser.#parseExplicit(node, parentSize);

    // Merge: defaults ← legacy ← flex ← explicit
    return {
      grow:   explicit.grow   ?? flexParsed.grow   ?? legacy.grow   ?? DEFAULTS.grow,
      shrink: explicit.shrink ?? flexParsed.shrink ?? legacy.shrink ?? DEFAULTS.shrink,
      basis:  explicit.basis  ?? flexParsed.basis  ?? legacy.basis  ?? DEFAULTS.basis,
      min:    explicit.min    ?? flexParsed.min    ?? legacy.min    ?? DEFAULTS.min,
      max:    explicit.max    ?? flexParsed.max    ?? legacy.max    ?? DEFAULTS.max,
    };
  }

  static #parseFlex(flex, parentSize) {
    const result = { grow: undefined, shrink: undefined, basis: undefined, min: undefined, max: undefined };
    if (flex == null) return result;

    // Number → grow shorthand
    if (typeof flex === 'number') {
      result.grow = flex;
      result.shrink = 1;
      result.basis = 0;
      return result;
    }

    if (typeof flex !== 'string') return result;

    // Named alias
    const alias = ALIASES[flex.trim().toLowerCase()];
    if (alias) {
      result.grow = alias.grow;
      result.shrink = alias.shrink;
      result.basis = alias.basis;
      return result;
    }

    // Shorthand string: "grow shrink basis"
    const parts = flex.trim().split(/\s+/);
    if (parts.length >= 1) result.grow = Number(parts[0]);
    if (parts.length >= 2) result.shrink = Number(parts[1]);
    if (parts.length >= 3) {
      result.basis = parts[2] === 'auto' ? 'auto' : FlexConfigParser.#normalizeBasis(Number(parts[2]), parentSize);
    }

    return result;
  }

  static #parseExplicit(node, parentSize) {
    return {
      grow:   node.grow   !== undefined ? node.grow   : undefined,
      shrink: node.shrink !== undefined ? node.shrink : undefined,
      basis:  node.basis  !== undefined ? FlexConfigParser.#normalizeBasis(node.basis, parentSize) : undefined,
      min:    node.min    !== undefined ? node.min    : undefined,
      max:    node.max    !== undefined ? node.max    : undefined,
    };
  }

  static #parseLegacy(node, parentSize) {
    const result = { grow: undefined, shrink: undefined, basis: undefined, min: undefined, max: undefined };

    // role: filler → filler alias
    if (node.role === 'filler') {
      const alias = ALIASES.filler;
      result.grow = alias.grow;
      result.shrink = alias.shrink;
      result.basis = alias.basis;
    }

    // padding: true → padding alias
    if (node.padding === true) {
      const alias = ALIASES.padding;
      result.grow = alias.grow;
      result.shrink = alias.shrink;
      result.basis = alias.basis;
    }

    // allocation → basis
    if (node.allocation !== undefined) {
      result.basis = FlexConfigParser.#normalizeBasis(node.allocation, parentSize);
    }

    // max_per_batch → max
    if (node.max_per_batch !== undefined) result.max = node.max_per_batch;

    // min_per_batch → min
    if (node.min_per_batch !== undefined) result.min = node.min_per_batch;

    return result;
  }

  /**
   * Normalize a basis value:
   * - 'auto' → 'auto'
   * - 0 → 0
   * - float 0.0-1.0 → proportion (as-is)
   * - integer > 1 → divide by parentSize
   */
  static #normalizeBasis(value, parentSize) {
    if (value === 'auto') return 'auto';
    if (value === 0) return 0;
    if (typeof value === 'number' && value > 0 && value <= 1) return value;
    if (typeof value === 'number' && value > 1 && parentSize > 0) return value / parentSize;
    return value;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/feed/FlexConfigParser.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/FlexConfigParser.mjs tests/isolated/application/feed/FlexConfigParser.test.mjs
git commit -m "feat(feed): add FlexConfigParser — flex shorthand, aliases, and legacy key parsing"
```

---

## Task 5: Create SourceResolver — Instance + Content Type Resolution

**Files:**
- Create: `backend/src/3_applications/feed/services/SourceResolver.mjs`
- Test: `tests/isolated/application/feed/SourceResolver.test.mjs` (new)

**Step 1: Write the failing tests**

Create `tests/isolated/application/feed/SourceResolver.test.mjs`:

```javascript
import { SourceResolver } from '#apps/feed/services/SourceResolver.mjs';

describe('SourceResolver', () => {
  const mockAdapters = [
    { sourceType: 'freshrss',    provides: ['feeds'] },
    { sourceType: 'headlines',   provides: ['news'] },
    { sourceType: 'googlenews',  provides: ['news'] },
    { sourceType: 'reddit',      provides: ['social'] },
    { sourceType: 'immich',      provides: ['photos'] },
    { sourceType: 'plex',        provides: ['video'] },
    { sourceType: 'youtube',     provides: ['video'] },
    { sourceType: 'komga',       provides: ['comics'] },
  ];

  let resolver;

  beforeEach(() => {
    resolver = new SourceResolver(mockAdapters);
  });

  test('resolves vendor alias to single adapter', () => {
    const result = resolver.resolve('freshrss');
    expect(result).toHaveLength(1);
    expect(result[0].sourceType).toBe('freshrss');
  });

  test('resolves content type to all matching adapters', () => {
    const result = resolver.resolve('news');
    expect(result).toHaveLength(2);
    expect(result.map(a => a.sourceType).sort()).toEqual(['googlenews', 'headlines']);
  });

  test('resolves video content type to plex + youtube', () => {
    const result = resolver.resolve('video');
    expect(result).toHaveLength(2);
    expect(result.map(a => a.sourceType).sort()).toEqual(['plex', 'youtube']);
  });

  test('vendor alias takes precedence over content type', () => {
    // 'reddit' is both a vendor alias and could theoretically be a content type
    const result = resolver.resolve('reddit');
    expect(result).toHaveLength(1);
    expect(result[0].sourceType).toBe('reddit');
  });

  test('returns empty array for unknown key', () => {
    const result = resolver.resolve('nonexistent');
    expect(result).toHaveLength(0);
  });

  test('getInstanceMap returns all vendor aliases', () => {
    const map = resolver.getInstanceMap();
    expect(map.has('freshrss')).toBe(true);
    expect(map.has('plex')).toBe(true);
  });

  test('getContentMap returns content type to adapter mapping', () => {
    const map = resolver.getContentMap();
    expect(map.get('news')).toHaveLength(2);
    expect(map.get('feeds')).toHaveLength(1);
    expect(map.get('video')).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/SourceResolver.test.mjs --no-coverage`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `backend/src/3_applications/feed/services/SourceResolver.mjs`:

```javascript
// backend/src/3_applications/feed/services/SourceResolver.mjs
/**
 * SourceResolver
 *
 * Builds instance (vendor alias) and content type maps from adapter list.
 * Resolves config source keys to adapters — vendor alias first, content type second.
 *
 * @module applications/feed/services
 */

export class SourceResolver {
  #instanceMap;
  #contentMap;

  /**
   * @param {Array<{sourceType: string, provides: string[]}>} adapters
   */
  constructor(adapters) {
    this.#instanceMap = new Map();
    this.#contentMap = new Map();

    for (const adapter of adapters) {
      // Instance map: vendor alias → adapter
      this.#instanceMap.set(adapter.sourceType, adapter);

      // Content map: content type → [adapters]
      for (const ct of adapter.provides) {
        if (!this.#contentMap.has(ct)) this.#contentMap.set(ct, []);
        this.#contentMap.get(ct).push(adapter);
      }
    }
  }

  /**
   * Resolve a config key to adapter(s).
   * 1. Try as vendor alias (instanceMap) → single adapter
   * 2. Try as content type (contentMap) → all adapters providing that type
   * 3. Not found → empty array
   *
   * @param {string} key - Config source key (vendor alias or content type)
   * @returns {Array<{sourceType: string, provides: string[]}>}
   */
  resolve(key) {
    const instance = this.#instanceMap.get(key);
    if (instance) return [instance];

    const byContent = this.#contentMap.get(key);
    if (byContent) return [...byContent];

    return [];
  }

  getInstanceMap() { return new Map(this.#instanceMap); }
  getContentMap() { return new Map(this.#contentMap); }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/feed/SourceResolver.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/SourceResolver.mjs tests/isolated/application/feed/SourceResolver.test.mjs
git commit -m "feat(feed): add SourceResolver — instance + content type resolution"
```

---

## Task 6: Integrate FlexAllocator into TierAssemblyService

**Files:**
- Modify: `backend/src/3_applications/feed/services/TierAssemblyService.mjs`
- Test: `tests/isolated/application/feed/TierAssemblyService.test.mjs` (update existing tests + add new)

This task replaces the ad-hoc allocation/cap logic in TierAssemblyService with FlexAllocator calls at both nesting levels.

**Step 1: Update existing tests and add new flex-based tests**

Read the existing `TierAssemblyService.test.mjs` to understand current assertions, then update the test file.

Add these tests to `tests/isolated/application/feed/TierAssemblyService.test.mjs`:

```javascript
// Add to imports:
// import { FlexAllocator } from '#apps/feed/services/FlexAllocator.mjs';

describe('flex-based allocation', () => {
  test('uses FlexAllocator for tier distribution when flex config present', () => {
    const flexConfig = {
      batch_size: 50,
      spacing: { max_consecutive: 1 },
      tiers: {
        wire: {
          flex: '1 0 auto',
          min: 20,
          selection: { sort: 'timestamp_desc' },
          sources: {
            feeds: { flex: 'dominant', max: 15 },
            social: { flex: '1 0 auto', max: 11 },
          },
        },
        compass: {
          flex: '0 0 6',
          min: 4,
          selection: { sort: 'priority' },
          sources: { entropy: { flex: '0 0 auto' } },
        },
        scrapbook: {
          flex: '0 0 5',
          min: 3,
          selection: { sort: 'random' },
          sources: { photos: { flex: '1 0 auto' } },
        },
        library: {
          flex: '0 0 5',
          min: 2,
          selection: { sort: 'random' },
          sources: { comics: { flex: '1 0 auto' } },
        },
      },
    };

    const items = [
      ...Array.from({ length: 30 }, (_, i) => makeItem(`w${i}`, 'wire', 'feeds', `2026-02-17T${String(10 - Math.floor(i / 6)).padStart(2, '0')}:${String(59 - (i % 60)).padStart(2, '0')}:00Z`)),
      ...Array.from({ length: 5 }, (_, i) => makeItem(`c${i}`, 'compass', 'entropy', `2026-02-17T08:${String(i).padStart(2, '0')}:00Z`, 10)),
      ...Array.from({ length: 5 }, (_, i) => makeItem(`s${i}`, 'scrapbook', 'photos', `2026-02-17T07:${String(i).padStart(2, '0')}:00Z`)),
      ...Array.from({ length: 5 }, (_, i) => makeItem(`l${i}`, 'library', 'comics', `2026-02-17T06:${String(i).padStart(2, '0')}:00Z`)),
    ];

    const result = service.assemble(items, flexConfig, { effectiveLimit: 50 });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThanOrEqual(50);
  });

  test('legacy config still works via FlexConfigParser migration', () => {
    // This is the current config format — it should still produce valid results
    const items = [
      makeItem('w1', 'wire', 'reddit', '2026-02-17T10:00:00Z'),
      makeItem('w2', 'wire', 'headlines', '2026-02-17T09:00:00Z'),
      makeItem('c1', 'compass', 'entropy', '2026-02-17T08:00:00Z', 10),
      makeItem('l1', 'library', 'komga', '2026-02-17T07:00:00Z'),
    ];
    const result = service.assemble(items, defaultConfig, { effectiveLimit: 50 });
    expect(result.items.length).toBe(4);
  });
});
```

**Important:** Existing tests MUST continue to pass. The legacy config format (`allocation`, `max_per_batch`, etc.) must work unchanged — FlexConfigParser handles the translation transparently.

**Step 2: Run existing tests to establish baseline**

Run: `npx jest tests/isolated/application/feed/TierAssemblyService.test.mjs --no-coverage`
Expected: All existing tests PASS.

**Step 3: Modify TierAssemblyService to use FlexAllocator**

In `backend/src/3_applications/feed/services/TierAssemblyService.mjs`:

1. Add imports at top:
```javascript
import { FlexAllocator } from './FlexAllocator.mjs';
import { FlexConfigParser } from './FlexConfigParser.mjs';
```

2. Replace `#resolveTierConfig` to build flex descriptors:
   - Parse each tier node through `FlexConfigParser.parseFlexNode(tierConfig, batchSize)`
   - Build child descriptors for `FlexAllocator.distribute(batchSize, tierDescriptors)`

3. Replace the allocation logic in `#selectForTier` to use FlexAllocator at the source level:
   - Parse each source node through `FlexConfigParser.parseFlexNode(sourceConfig, tierSlots)`
   - Build child descriptors for `FlexAllocator.distribute(tierSlots, sourceDescriptors)`
   - Use allocated slots as per-source caps

4. Keep the existing filler logic, sort strategies, focus filter, and spacing enforcement unchanged — they operate after allocation.

5. Keep wire decay logic but adapt it to work with flex values (decay reduces the wire tier's resolved size).

The key architectural change: allocation numbers now come from FlexAllocator instead of being read directly from config. The rest of the pipeline (sort, filter, interleave, spacing) is unchanged.

**Step 4: Run all tests**

Run: `npx jest tests/isolated/application/feed/TierAssemblyService.test.mjs --no-coverage`
Expected: All tests PASS (both old and new).

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/TierAssemblyService.mjs tests/isolated/application/feed/TierAssemblyService.test.mjs
git commit -m "feat(feed): integrate FlexAllocator into TierAssemblyService for tier and source allocation"
```

---

## Task 7: Wire SourceResolver into Feed Bootstrap

**Files:**
- Modify: `backend/src/app.mjs`

**Step 1: Verify existing tests pass before change**

Run: `npx jest tests/isolated/ --no-coverage`
Expected: All tests PASS.

**Step 2: Add SourceResolver to app.mjs bootstrap**

In `backend/src/app.mjs`, in the feed services block (around line 794):

1. Import SourceResolver:
```javascript
const { SourceResolver } = await import('./3_applications/feed/services/SourceResolver.mjs');
```

2. After building `feedSourceAdapters` array (line ~842), create the resolver:
```javascript
const sourceResolver = new SourceResolver(feedSourceAdapters);
```

3. Pass it to FeedAssemblyService constructor:
```javascript
const feedAssemblyService = new FeedAssemblyService({
  feedPoolManager,
  sourceAdapters: feedSourceAdapters,
  sourceResolver,  // NEW
  scrollConfigLoader,
  tierAssemblyService,
  // ... rest unchanged
});
```

4. Pass it to TierAssemblyService constructor:
```javascript
const tierAssemblyService = new TierAssemblyService({
  spacingEnforcer,
  sourceResolver,  // NEW
  logger: rootLogger.child({ module: 'tier-assembly' }),
});
```

**Step 3: Run tests to check for regressions**

Run: `npx jest tests/isolated/ --no-coverage`
Expected: All tests PASS. (TierAssemblyService constructor accepts optional sourceResolver without breaking.)

**Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(feed): wire SourceResolver into feed bootstrap"
```

---

## Task 8: Migrate feed.yml Config to Flex Format

**Files:**
- Modify: `data/users/kckern/config/feed.yml` (prod config on Docker volume)

**Step 1: Write the new scroll config section**

Replace the `scroll:` section in `data/users/kckern/config/feed.yml` with the flex format from the design doc. The legacy keys will still work (FlexConfigParser handles them), but migrate to the new format for clarity:

```yaml
scroll:
  batch_size: 50
  spacing:
    max_consecutive: 1
  tiers:
    wire:
      flex: "1 0 auto"
      min: 20
      selection:
        sort: timestamp_desc
        filter: []
        diversity: source
      sources:
        feeds:
          flex: dominant
          max: 15
          max_age_hours: 336
        social:
          flex: "1 0 auto"
          max: 11
          min_spacing: 2
          max_age_hours: 168
          subsources:
            max_per_batch: 2
            min_spacing: 4
        news:
          flex: filler
          max: 10
          min: 3
          max_age_hours: 48
        video:
          flex: none
          max: 7
          min_spacing: 3
    compass:
      flex: "0 0 6"
      min: 4
      selection:
        sort: priority
        filter: []
        freshness: true
      sources:
        entropy: { flex: "0 0 auto" }
        tasks: { flex: "0 0 auto" }
        weather: { flex: none }
        health: { flex: none }
        fitness: { flex: none }
        gratitude: { flex: none }
        scripture: { flex: none }
    scrapbook:
      flex: "0 0 5"
      min: 3
      selection:
        sort: random
        filter: []
        prefer: anniversary
      sources:
        photos:
          flex: "1 0 auto"
          min_spacing: 3
          max_age_hours: null
        journal:
          flex: none
          min_spacing: 4
        book-reviews:
          flex: none
          min_spacing: 4
    library:
      flex: "0 0 5"
      min: 2
      selection:
        sort: random
        filter: []
        freshness: false
      sources:
        comics:
          flex: "1 0 auto"
          max_age_hours: null
        ebooks:
          flex: none
          max_age_hours: null
        audio:
          flex: none
          max_age_hours: null
```

Note: `news` replaces both `headlines` and `googlenews` config entries — SourceResolver will resolve `news` to both adapters and pool their items. If separate control is needed, vendor aliases (`headlines`, `googlenews`) can still be used instead.

**Step 2: Verify by testing against dev server**

Start dev server, hit the scroll endpoint, and verify the batch distribution looks correct. Compare tier and source counts.

**Step 3: Commit**

```bash
git add data/users/kckern/config/feed.yml
git commit -m "config(feed): migrate scroll config to flex format"
```

**Note:** This is the prod config file on the Docker volume. After committing, deploy to verify.

---

## Task 9: Run Full Test Suite and Fix Any Regressions

**Files:**
- All test files under `tests/isolated/`

**Step 1: Run complete test suite**

Run: `npx jest tests/isolated/ --no-coverage`

**Step 2: Fix any failing tests**

Address any failures caused by the FlexAllocator integration. Common issues:
- Tests that hardcode allocation numbers may need updating
- Tests that check exact item counts may shift due to proportional allocation
- FeedAssemblyService tests may need a mock sourceResolver

**Step 3: Run again to confirm all pass**

Run: `npx jest tests/isolated/ --no-coverage`
Expected: All tests PASS.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(feed): address test regressions from flex allocation migration"
```

---

## Summary

| Task | Component | Layer | New/Modify |
|------|-----------|-------|------------|
| 1 | CONTENT_TYPES + provides | Port (3_applications) | Modify |
| 2 | 18 adapter provides | Adapter (1_adapters) | Modify |
| 3 | FlexAllocator | Application (3_applications) | New |
| 4 | FlexConfigParser | Application (3_applications) | New |
| 5 | SourceResolver | Application (3_applications) | New |
| 6 | TierAssemblyService integration | Application (3_applications) | Modify |
| 7 | Bootstrap wiring | System (app.mjs) | Modify |
| 8 | Config migration | Data (YAML) | Modify |
| 9 | Regression sweep | Tests | Fix |

**DDD compliance:**
- No domain layer (`2_domains/`) changes — flex allocation is application-specific
- Port (`IFeedSourceAdapter`) owns the `CONTENT_TYPES` enum — it defines the contract
- Adapters (`1_adapters/`) declare `provides` — they implement the contract
- Application services (`3_applications/`) contain FlexAllocator, FlexConfigParser, SourceResolver — they orchestrate
- API layer (`4_api/`) unchanged — same endpoints, same response shape
- Dependencies point inward: adapters → port, application services → port
