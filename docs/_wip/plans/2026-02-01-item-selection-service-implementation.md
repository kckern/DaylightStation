# ItemSelectionService Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a unified ItemSelectionService that provides strategy-based item selection (filter, sort, pick) for content queries.

**Architecture:** Pure domain service with static methods for each filter/sort/pick operation. Uses named strategy presets that combine these operations. Strategy resolution follows a layered approach: inference from context, config defaults, explicit overrides.

**Tech Stack:** ES modules (.mjs), Jest for testing, follows DDD domain layer guidelines.

---

## Task 1: Create ItemSelectionService with Strategy Registry

**Files:**
- Create: `backend/src/2_domains/content/services/ItemSelectionService.mjs`
- Test: `tests/isolated/domain/content/services/ItemSelectionService.test.mjs`

**Step 1: Write the failing test for strategy registry**

Create `tests/isolated/domain/content/services/ItemSelectionService.test.mjs`:

```javascript
// tests/isolated/domain/content/services/ItemSelectionService.test.mjs
import { jest } from '@jest/globals';
import { ItemSelectionService } from '#domains/content/services/ItemSelectionService.mjs';

describe('ItemSelectionService', () => {
  describe('getStrategy', () => {
    test('returns watchlist strategy', () => {
      const strategy = ItemSelectionService.getStrategy('watchlist');
      expect(strategy).toEqual({
        filter: ['skipAfter', 'waitUntil', 'hold', 'watched', 'days'],
        sort: 'priority',
        pick: 'first'
      });
    });

    test('returns binge strategy', () => {
      const strategy = ItemSelectionService.getStrategy('binge');
      expect(strategy).toEqual({
        filter: ['watched'],
        sort: 'source_order',
        pick: 'all'
      });
    });

    test('returns album strategy', () => {
      const strategy = ItemSelectionService.getStrategy('album');
      expect(strategy).toEqual({
        filter: [],
        sort: 'track_order',
        pick: 'all'
      });
    });

    test('returns playlist strategy', () => {
      const strategy = ItemSelectionService.getStrategy('playlist');
      expect(strategy).toEqual({
        filter: [],
        sort: 'source_order',
        pick: 'all'
      });
    });

    test('returns discovery strategy', () => {
      const strategy = ItemSelectionService.getStrategy('discovery');
      expect(strategy).toEqual({
        filter: [],
        sort: 'random',
        pick: 'first'
      });
    });

    test('returns chronological strategy', () => {
      const strategy = ItemSelectionService.getStrategy('chronological');
      expect(strategy).toEqual({
        filter: [],
        sort: 'date_asc',
        pick: 'all'
      });
    });

    test('returns slideshow strategy', () => {
      const strategy = ItemSelectionService.getStrategy('slideshow');
      expect(strategy).toEqual({
        filter: [],
        sort: 'random',
        pick: 'all'
      });
    });

    test('throws for unknown strategy', () => {
      expect(() => ItemSelectionService.getStrategy('unknown'))
        .toThrow('Unknown strategy: unknown');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `backend/src/2_domains/content/services/ItemSelectionService.mjs`:

```javascript
// backend/src/2_domains/content/services/ItemSelectionService.mjs

/**
 * Named strategy presets for item selection.
 * Each strategy defines filter, sort, and pick operations.
 */
const STRATEGIES = {
  watchlist: {
    filter: ['skipAfter', 'waitUntil', 'hold', 'watched', 'days'],
    sort: 'priority',
    pick: 'first'
  },
  binge: {
    filter: ['watched'],
    sort: 'source_order',
    pick: 'all'
  },
  album: {
    filter: [],
    sort: 'track_order',
    pick: 'all'
  },
  playlist: {
    filter: [],
    sort: 'source_order',
    pick: 'all'
  },
  discovery: {
    filter: [],
    sort: 'random',
    pick: 'first'
  },
  chronological: {
    filter: [],
    sort: 'date_asc',
    pick: 'all'
  },
  slideshow: {
    filter: [],
    sort: 'random',
    pick: 'all'
  }
};

/**
 * ItemSelectionService provides unified item selection logic for content queries.
 * Pure domain service with no I/O dependencies.
 *
 * @class ItemSelectionService
 */
export class ItemSelectionService {
  /**
   * Get a named strategy preset.
   *
   * @param {string} name - Strategy name
   * @returns {{ filter: string[], sort: string, pick: string }}
   * @throws {Error} If strategy name is unknown
   */
  static getStrategy(name) {
    const strategy = STRATEGIES[name];
    if (!strategy) {
      throw new Error(`Unknown strategy: ${name}`);
    }
    return { ...strategy };
  }
}

export default ItemSelectionService;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/isolated/domain/content/services/ItemSelectionService.test.mjs backend/src/2_domains/content/services/ItemSelectionService.mjs
git commit -m "$(cat <<'EOF'
feat(content): add ItemSelectionService with strategy registry

Introduces strategy presets for item selection: watchlist, binge, album,
playlist, discovery, chronological, slideshow.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add Filter Methods (Reuse QueueService)

**Files:**
- Modify: `backend/src/2_domains/content/services/ItemSelectionService.mjs`
- Modify: `tests/isolated/domain/content/services/ItemSelectionService.test.mjs`

**Step 1: Write the failing test for applyFilter**

Add to test file:

```javascript
describe('applyFilter', () => {
  const now = new Date('2026-01-15');

  test('applies skipAfter filter', () => {
    const items = [
      { id: '1', skipAfter: '2026-01-20' }, // valid
      { id: '2', skipAfter: '2026-01-10' }, // expired
      { id: '3' } // no skipAfter
    ];
    const result = ItemSelectionService.applyFilter(items, 'skipAfter', { now });
    expect(result.map(i => i.id)).toEqual(['1', '3']);
  });

  test('applies waitUntil filter', () => {
    const items = [
      { id: '1', waitUntil: '2026-01-14' }, // past
      { id: '2', waitUntil: '2026-01-17' }, // within 2 days
      { id: '3', waitUntil: '2026-01-25' }, // too far
      { id: '4' } // no waitUntil
    ];
    const result = ItemSelectionService.applyFilter(items, 'waitUntil', { now });
    expect(result.map(i => i.id)).toEqual(['1', '2', '4']);
  });

  test('applies hold filter', () => {
    const items = [
      { id: '1', hold: true },
      { id: '2', hold: false },
      { id: '3' }
    ];
    const result = ItemSelectionService.applyFilter(items, 'hold', { now });
    expect(result.map(i => i.id)).toEqual(['2', '3']);
  });

  test('applies watched filter', () => {
    const items = [
      { id: '1', percent: 95 },
      { id: '2', watched: true },
      { id: '3', percent: 50 },
      { id: '4' }
    ];
    const result = ItemSelectionService.applyFilter(items, 'watched', { now });
    expect(result.map(i => i.id)).toEqual(['3', '4']);
  });

  test('applies days filter', () => {
    // Jan 15 2026 is Thursday (day 4)
    const thursday = new Date(2026, 0, 15);
    const items = [
      { id: '1', days: [4] }, // Thursday only
      { id: '2', days: [1, 2, 3] }, // M-W
      { id: '3' } // no days
    ];
    const result = ItemSelectionService.applyFilter(items, 'days', { now: thursday });
    expect(result.map(i => i.id)).toEqual(['1', '3']);
  });

  test('throws for unknown filter', () => {
    expect(() => ItemSelectionService.applyFilter([], 'unknown', { now }))
      .toThrow('Unknown filter: unknown');
  });

  test('throws if now not provided for date-dependent filters', () => {
    expect(() => ItemSelectionService.applyFilter([], 'skipAfter', {}))
      .toThrow('now date required');
  });
});

describe('applyFilters (multiple)', () => {
  test('applies multiple filters in sequence', () => {
    const now = new Date('2026-01-15');
    const items = [
      { id: '1', hold: false, percent: 0 },
      { id: '2', hold: true, percent: 0 },
      { id: '3', hold: false, percent: 95 }
    ];
    const result = ItemSelectionService.applyFilters(items, ['hold', 'watched'], { now });
    expect(result.map(i => i.id)).toEqual(['1']);
  });

  test('returns all items when filter list is empty', () => {
    const items = [{ id: '1' }, { id: '2' }];
    const result = ItemSelectionService.applyFilters(items, [], { now: new Date() });
    expect(result.length).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: FAIL with "applyFilter is not a function"

**Step 3: Write minimal implementation**

Add to `ItemSelectionService.mjs`:

```javascript
import { QueueService } from './QueueService.mjs';

// Add after STRATEGIES constant:

/**
 * Filter type to QueueService method mapping.
 */
const FILTER_METHODS = {
  skipAfter: (items, ctx) => QueueService.filterBySkipAfter(items, ctx.now),
  waitUntil: (items, ctx) => QueueService.filterByWaitUntil(items, ctx.now),
  hold: (items) => QueueService.filterByHold(items),
  watched: (items) => QueueService.filterByWatched(items),
  days: (items, ctx) => QueueService.filterByDayOfWeek(items, ctx.now)
};

/**
 * Filters that require a date.
 */
const DATE_REQUIRED_FILTERS = ['skipAfter', 'waitUntil', 'days'];

// Add to class:

  /**
   * Apply a single named filter to items.
   *
   * @param {Array} items - Items to filter
   * @param {string} filterName - Filter name (skipAfter, waitUntil, hold, watched, days)
   * @param {Object} context - Filter context
   * @param {Date} context.now - Current date (required for date-dependent filters)
   * @returns {Array} Filtered items
   * @throws {Error} If filter is unknown or required context missing
   */
  static applyFilter(items, filterName, context) {
    const filterFn = FILTER_METHODS[filterName];
    if (!filterFn) {
      throw new Error(`Unknown filter: ${filterName}`);
    }
    if (DATE_REQUIRED_FILTERS.includes(filterName) && (!context.now || !(context.now instanceof Date))) {
      throw new Error('now date required for date-dependent filters');
    }
    return filterFn(items, context);
  }

  /**
   * Apply multiple named filters to items in sequence.
   *
   * @param {Array} items - Items to filter
   * @param {string[]} filterNames - Filter names to apply
   * @param {Object} context - Filter context
   * @returns {Array} Filtered items
   */
  static applyFilters(items, filterNames, context) {
    return filterNames.reduce(
      (result, filterName) => this.applyFilter(result, filterName, context),
      items
    );
  }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/services/ItemSelectionService.mjs tests/isolated/domain/content/services/ItemSelectionService.test.mjs
git commit -m "$(cat <<'EOF'
feat(content): add filter methods to ItemSelectionService

Delegates to QueueService static methods. Supports skipAfter, waitUntil,
hold, watched, and days filters with date injection.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Sort Methods

**Files:**
- Modify: `backend/src/2_domains/content/services/ItemSelectionService.mjs`
- Modify: `tests/isolated/domain/content/services/ItemSelectionService.test.mjs`

**Step 1: Write the failing test for applySort**

Add to test file:

```javascript
describe('applySort', () => {
  test('sorts by priority', () => {
    const items = [
      { id: '1', priority: 'low' },
      { id: '2', priority: 'in_progress', percent: 50 },
      { id: '3', priority: 'high' }
    ];
    const result = ItemSelectionService.applySort(items, 'priority');
    expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
  });

  test('sorts by track_order', () => {
    const items = [
      { id: '1', discNumber: 1, trackNumber: 3 },
      { id: '2', discNumber: 1, trackNumber: 1 },
      { id: '3', discNumber: 2, trackNumber: 1 }
    ];
    const result = ItemSelectionService.applySort(items, 'track_order');
    expect(result.map(i => i.id)).toEqual(['2', '1', '3']);
  });

  test('sorts by source_order (preserves original)', () => {
    const items = [
      { id: '1' },
      { id: '2' },
      { id: '3' }
    ];
    const result = ItemSelectionService.applySort(items, 'source_order');
    expect(result.map(i => i.id)).toEqual(['1', '2', '3']);
  });

  test('sorts by date_asc', () => {
    const items = [
      { id: '1', date: '2026-03-01' },
      { id: '2', date: '2026-01-01' },
      { id: '3', date: '2026-02-01' }
    ];
    const result = ItemSelectionService.applySort(items, 'date_asc');
    expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
  });

  test('sorts by date_desc', () => {
    const items = [
      { id: '1', date: '2026-01-01' },
      { id: '2', date: '2026-03-01' },
      { id: '3', date: '2026-02-01' }
    ];
    const result = ItemSelectionService.applySort(items, 'date_desc');
    expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
  });

  test('sorts by random (shuffles items)', () => {
    // Use seed for deterministic test
    const items = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }];
    const result = ItemSelectionService.applySort(items, 'random');
    expect(result.length).toBe(5);
    expect(new Set(result.map(i => i.id)).size).toBe(5); // all unique
  });

  test('sorts by title', () => {
    const items = [
      { id: '1', title: 'Zebra' },
      { id: '2', title: 'Apple' },
      { id: '3', title: 'Mango' }
    ];
    const result = ItemSelectionService.applySort(items, 'title');
    expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
  });

  test('throws for unknown sort', () => {
    expect(() => ItemSelectionService.applySort([], 'unknown'))
      .toThrow('Unknown sort: unknown');
  });

  test('uses itemIndex as fallback for track_order', () => {
    const items = [
      { id: '1', itemIndex: 3 },
      { id: '2', itemIndex: 1 },
      { id: '3', itemIndex: 2 }
    ];
    const result = ItemSelectionService.applySort(items, 'track_order');
    expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
  });

  test('uses takenAt as fallback for date sorts', () => {
    const items = [
      { id: '1', takenAt: '2026-03-01' },
      { id: '2', takenAt: '2026-01-01' }
    ];
    const result = ItemSelectionService.applySort(items, 'date_asc');
    expect(result.map(i => i.id)).toEqual(['2', '1']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: FAIL with "applySort is not a function"

**Step 3: Write minimal implementation**

Add to `ItemSelectionService.mjs`:

```javascript
// Add after FILTER_METHODS:

/**
 * Sort methods.
 */
const SORT_METHODS = {
  priority: (items) => QueueService.sortByPriority(items),

  track_order: (items) => {
    return [...items].sort((a, b) => {
      const discA = a.discNumber ?? 1;
      const discB = b.discNumber ?? 1;
      if (discA !== discB) return discA - discB;

      const trackA = a.trackNumber ?? a.itemIndex ?? 0;
      const trackB = b.trackNumber ?? b.itemIndex ?? 0;
      return trackA - trackB;
    });
  },

  source_order: (items) => [...items],

  date_asc: (items) => {
    return [...items].sort((a, b) => {
      const dateA = a.date || a.takenAt || '';
      const dateB = b.date || b.takenAt || '';
      return dateA.localeCompare(dateB);
    });
  },

  date_desc: (items) => {
    return [...items].sort((a, b) => {
      const dateA = a.date || a.takenAt || '';
      const dateB = b.date || b.takenAt || '';
      return dateB.localeCompare(dateA);
    });
  },

  random: (items) => {
    // Fisher-Yates shuffle
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  },

  title: (items) => {
    return [...items].sort((a, b) => {
      const titleA = a.title || '';
      const titleB = b.title || '';
      return titleA.localeCompare(titleB);
    });
  }
};

// Add to class:

  /**
   * Apply a named sort to items.
   *
   * @param {Array} items - Items to sort
   * @param {string} sortName - Sort name (priority, track_order, source_order, date_asc, date_desc, random, title)
   * @returns {Array} Sorted items (new array)
   * @throws {Error} If sort is unknown
   */
  static applySort(items, sortName) {
    const sortFn = SORT_METHODS[sortName];
    if (!sortFn) {
      throw new Error(`Unknown sort: ${sortName}`);
    }
    return sortFn(items);
  }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/services/ItemSelectionService.mjs tests/isolated/domain/content/services/ItemSelectionService.test.mjs
git commit -m "$(cat <<'EOF'
feat(content): add sort methods to ItemSelectionService

Supports priority, track_order, source_order, date_asc, date_desc,
random (Fisher-Yates), and title sorts. Reuses QueueService.sortByPriority.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add Pick Methods

**Files:**
- Modify: `backend/src/2_domains/content/services/ItemSelectionService.mjs`
- Modify: `tests/isolated/domain/content/services/ItemSelectionService.test.mjs`

**Step 1: Write the failing test for applyPick**

Add to test file:

```javascript
describe('applyPick', () => {
  test('picks first item', () => {
    const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const result = ItemSelectionService.applyPick(items, 'first');
    expect(result).toEqual([{ id: '1' }]);
  });

  test('picks all items', () => {
    const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const result = ItemSelectionService.applyPick(items, 'all');
    expect(result.length).toBe(3);
  });

  test('picks random item', () => {
    const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const result = ItemSelectionService.applyPick(items, 'random');
    expect(result.length).toBe(1);
    expect(items.some(i => i.id === result[0].id)).toBe(true);
  });

  test('picks first N items with take:N', () => {
    const items = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
    const result = ItemSelectionService.applyPick(items, 'take:2');
    expect(result.map(i => i.id)).toEqual(['1', '2']);
  });

  test('handles take:N when N > items.length', () => {
    const items = [{ id: '1' }, { id: '2' }];
    const result = ItemSelectionService.applyPick(items, 'take:5');
    expect(result.length).toBe(2);
  });

  test('returns empty array for empty input', () => {
    expect(ItemSelectionService.applyPick([], 'first')).toEqual([]);
    expect(ItemSelectionService.applyPick([], 'all')).toEqual([]);
    expect(ItemSelectionService.applyPick([], 'random')).toEqual([]);
  });

  test('throws for unknown pick', () => {
    expect(() => ItemSelectionService.applyPick([], 'unknown'))
      .toThrow('Unknown pick: unknown');
  });

  test('throws for invalid take:N format', () => {
    expect(() => ItemSelectionService.applyPick([], 'take:abc'))
      .toThrow('Invalid take format');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: FAIL with "applyPick is not a function"

**Step 3: Write minimal implementation**

Add to `ItemSelectionService.mjs`:

```javascript
// Add to class:

  /**
   * Apply a pick operation to select subset of items.
   *
   * @param {Array} items - Items to pick from
   * @param {string} pickType - Pick type (first, all, random, take:N)
   * @returns {Array} Selected items
   * @throws {Error} If pick type is unknown or invalid format
   */
  static applyPick(items, pickType) {
    if (items.length === 0) return [];

    if (pickType === 'first') {
      return [items[0]];
    }

    if (pickType === 'all') {
      return [...items];
    }

    if (pickType === 'random') {
      const index = Math.floor(Math.random() * items.length);
      return [items[index]];
    }

    if (pickType.startsWith('take:')) {
      const n = parseInt(pickType.slice(5), 10);
      if (isNaN(n)) {
        throw new Error('Invalid take format: expected take:N where N is a number');
      }
      return items.slice(0, n);
    }

    throw new Error(`Unknown pick: ${pickType}`);
  }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/services/ItemSelectionService.mjs tests/isolated/domain/content/services/ItemSelectionService.test.mjs
git commit -m "$(cat <<'EOF'
feat(content): add pick methods to ItemSelectionService

Supports first, all, random, and take:N pick operations.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add Strategy Resolution

**Files:**
- Modify: `backend/src/2_domains/content/services/ItemSelectionService.mjs`
- Modify: `tests/isolated/domain/content/services/ItemSelectionService.test.mjs`

**Step 1: Write the failing test for resolveStrategy**

Add to test file:

```javascript
describe('resolveStrategy', () => {
  describe('inference from context', () => {
    test('infers watchlist for folder container', () => {
      const strategy = ItemSelectionService.resolveStrategy({
        containerType: 'folder'
      });
      expect(strategy.sort).toBe('priority');
    });

    test('infers album for album container', () => {
      const strategy = ItemSelectionService.resolveStrategy({
        containerType: 'album'
      });
      expect(strategy.sort).toBe('track_order');
    });

    test('infers playlist for playlist container', () => {
      const strategy = ItemSelectionService.resolveStrategy({
        containerType: 'playlist'
      });
      expect(strategy.sort).toBe('source_order');
    });

    test('infers chronological for person query', () => {
      const strategy = ItemSelectionService.resolveStrategy({
        query: { person: 'John' }
      });
      expect(strategy.sort).toBe('date_asc');
    });

    test('infers chronological for time query', () => {
      const strategy = ItemSelectionService.resolveStrategy({
        query: { time: '2025' }
      });
      expect(strategy.sort).toBe('date_asc');
    });

    test('infers discovery for text query', () => {
      const strategy = ItemSelectionService.resolveStrategy({
        query: { text: 'vacation' }
      });
      expect(strategy.sort).toBe('random');
    });

    test('infers slideshow for display action', () => {
      const strategy = ItemSelectionService.resolveStrategy({
        action: 'display'
      });
      expect(strategy.sort).toBe('random');
      expect(strategy.pick).toBe('all');
    });
  });

  describe('override priority', () => {
    test('explicit strategy overrides inference', () => {
      const strategy = ItemSelectionService.resolveStrategy(
        { containerType: 'folder' },
        { strategy: 'binge' }
      );
      expect(strategy.sort).toBe('source_order');
    });

    test('explicit sort overrides strategy', () => {
      const strategy = ItemSelectionService.resolveStrategy(
        { containerType: 'folder' },
        { sort: 'random' }
      );
      expect(strategy.sort).toBe('random');
      expect(strategy.filter).toContain('watched'); // rest from watchlist
    });

    test('explicit pick overrides strategy', () => {
      const strategy = ItemSelectionService.resolveStrategy(
        { containerType: 'folder' },
        { pick: 'all' }
      );
      expect(strategy.pick).toBe('all');
    });

    test('filter: none disables filtering', () => {
      const strategy = ItemSelectionService.resolveStrategy(
        { containerType: 'folder' },
        { filter: 'none' }
      );
      expect(strategy.filter).toEqual([]);
    });
  });

  describe('defaults', () => {
    test('defaults to discovery when no signals', () => {
      const strategy = ItemSelectionService.resolveStrategy({});
      expect(strategy.sort).toBe('random');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: FAIL with "resolveStrategy is not a function"

**Step 3: Write minimal implementation**

Add to `ItemSelectionService.mjs`:

```javascript
// Add after STRATEGIES constant:

/**
 * Inference rules: context signal -> strategy name
 */
const INFERENCE_RULES = [
  { match: (ctx) => ctx.containerType === 'folder', strategy: 'watchlist' },
  { match: (ctx) => ctx.containerType === 'album', strategy: 'album' },
  { match: (ctx) => ctx.containerType === 'playlist', strategy: 'playlist' },
  { match: (ctx) => ctx.query?.person, strategy: 'chronological' },
  { match: (ctx) => ctx.query?.time, strategy: 'chronological' },
  { match: (ctx) => ctx.query?.text, strategy: 'discovery' },
  { match: (ctx) => ctx.action === 'display', strategy: 'slideshow' }
];

// Add to class:

  /**
   * Resolve a strategy from context and overrides.
   * Resolution order: inference -> explicit strategy -> individual overrides
   *
   * @param {Object} context - Selection context
   * @param {string} [context.action] - play, queue, display, list, read
   * @param {string} [context.containerType] - folder, album, playlist, search
   * @param {Object} [context.query] - Query filters (person, time, text)
   * @param {Object} [overrides] - Explicit overrides
   * @param {string} [overrides.strategy] - Named strategy to use
   * @param {string} [overrides.sort] - Override sort only
   * @param {string} [overrides.pick] - Override pick only
   * @param {string} [overrides.filter] - 'none' to disable filtering
   * @returns {{ filter: string[], sort: string, pick: string }}
   */
  static resolveStrategy(context, overrides = {}) {
    // 1. Infer base strategy from context
    let strategyName = 'discovery'; // default
    for (const rule of INFERENCE_RULES) {
      if (rule.match(context)) {
        strategyName = rule.strategy;
        break;
      }
    }

    // 2. Override with explicit strategy if provided
    if (overrides.strategy) {
      strategyName = overrides.strategy;
    }

    // 3. Get base strategy
    const strategy = this.getStrategy(strategyName);

    // 4. Apply individual overrides
    if (overrides.filter === 'none') {
      strategy.filter = [];
    }
    if (overrides.sort) {
      strategy.sort = overrides.sort;
    }
    if (overrides.pick) {
      strategy.pick = overrides.pick;
    }

    return strategy;
  }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/services/ItemSelectionService.mjs tests/isolated/domain/content/services/ItemSelectionService.test.mjs
git commit -m "$(cat <<'EOF'
feat(content): add strategy resolution to ItemSelectionService

Resolves strategy from context via inference rules. Supports explicit
overrides for strategy, sort, pick, and filter=none.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add Main select() Method

**Files:**
- Modify: `backend/src/2_domains/content/services/ItemSelectionService.mjs`
- Modify: `tests/isolated/domain/content/services/ItemSelectionService.test.mjs`

**Step 1: Write the failing test for select()**

Add to test file:

```javascript
describe('select', () => {
  const now = new Date('2026-01-15');

  test('applies full watchlist pipeline', () => {
    const items = [
      { id: '1', priority: 'low', hold: false, percent: 0 },
      { id: '2', priority: 'high', hold: false, percent: 0 },
      { id: '3', priority: 'medium', hold: true, percent: 0 }, // filtered
      { id: '4', priority: 'in_progress', hold: false, percent: 50 }
    ];
    const result = ItemSelectionService.select(items, {
      containerType: 'folder',
      now
    });
    // Filtered (hold), sorted by priority, pick first
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('4'); // in_progress first
  });

  test('applies album pipeline (no filter, track_order)', () => {
    const items = [
      { id: '1', trackNumber: 3 },
      { id: '2', trackNumber: 1 },
      { id: '3', trackNumber: 2 }
    ];
    const result = ItemSelectionService.select(items, {
      containerType: 'album',
      now
    });
    expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
  });

  test('respects override pick', () => {
    const items = [
      { id: '1', priority: 'high', hold: false, percent: 0 },
      { id: '2', priority: 'low', hold: false, percent: 0 }
    ];
    const result = ItemSelectionService.select(
      items,
      { containerType: 'folder', now },
      { pick: 'all' }
    );
    expect(result.length).toBe(2);
  });

  test('applies urgency promotion before sort', () => {
    const items = [
      { id: '1', priority: 'medium', skipAfter: '2026-01-20' }, // within 8 days -> urgent
      { id: '2', priority: 'high' }
    ];
    const result = ItemSelectionService.select(
      items,
      { containerType: 'folder', now },
      { pick: 'all' }
    );
    expect(result[0].id).toBe('1'); // promoted to urgent, before high
    expect(result[0].priority).toBe('urgent');
  });

  test('handles empty result after filtering', () => {
    const items = [
      { id: '1', hold: true }
    ];
    const result = ItemSelectionService.select(items, {
      containerType: 'folder',
      now
    });
    expect(result).toEqual([]);
  });

  test('throws if now not provided for watchlist strategy', () => {
    const items = [{ id: '1' }];
    expect(() => ItemSelectionService.select(items, { containerType: 'folder' }))
      .toThrow('now date required');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: FAIL with "select is not a function"

**Step 3: Write minimal implementation**

Add to `ItemSelectionService.mjs`:

```javascript
// Add to class:

  /**
   * Select items based on context and strategy.
   * Main entry point for item selection.
   *
   * @param {Array} items - Pre-enriched items (with metadata.percent, etc.)
   * @param {Object} context - Selection context
   * @param {string} [context.action] - play, queue, display, list, read
   * @param {string} [context.containerType] - folder, album, playlist, search
   * @param {Object} [context.query] - Query filters used (person, time, text)
   * @param {Date} context.now - Current date (required for filtering)
   * @param {Object} [overrides] - Explicit strategy overrides
   * @returns {Array} Selected items
   */
  static select(items, context, overrides = {}) {
    const strategy = this.resolveStrategy(context, overrides);

    // Apply urgency promotion for watchlist-like strategies
    let processed = items;
    if (strategy.filter.includes('skipAfter') && context.now) {
      processed = QueueService.applyUrgency(processed, context.now);
    }

    // Filter
    if (strategy.filter.length > 0) {
      if (!context.now || !(context.now instanceof Date)) {
        throw new Error('now date required for filtering');
      }
      processed = this.applyFilters(processed, strategy.filter, context);
    }

    // Sort
    processed = this.applySort(processed, strategy.sort);

    // Pick
    processed = this.applyPick(processed, strategy.pick);

    return processed;
  }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/services/ItemSelectionService.mjs tests/isolated/domain/content/services/ItemSelectionService.test.mjs
git commit -m "$(cat <<'EOF'
feat(content): add select() method to ItemSelectionService

Main entry point that orchestrates filter -> sort -> pick pipeline.
Applies urgency promotion for watchlist strategies.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add Fallback Cascade for Empty Results

**Files:**
- Modify: `backend/src/2_domains/content/services/ItemSelectionService.mjs`
- Modify: `tests/isolated/domain/content/services/ItemSelectionService.test.mjs`

**Step 1: Write the failing test for fallback**

Add to test file:

```javascript
describe('select with fallback', () => {
  const now = new Date('2026-01-15');

  test('relaxes skipAfter/hold if all filtered', () => {
    const items = [
      { id: '1', hold: true, percent: 0 }
    ];
    const result = ItemSelectionService.select(
      items,
      { containerType: 'folder', now },
      { allowFallback: true }
    );
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('1');
  });

  test('relaxes watched if still empty after hold', () => {
    const items = [
      { id: '1', hold: true, percent: 95 }
    ];
    const result = ItemSelectionService.select(
      items,
      { containerType: 'folder', now },
      { allowFallback: true }
    );
    expect(result.length).toBe(1);
  });

  test('does not fallback without allowFallback', () => {
    const items = [
      { id: '1', hold: true }
    ];
    const result = ItemSelectionService.select(
      items,
      { containerType: 'folder', now }
    );
    expect(result.length).toBe(0);
  });

  test('preserves sort and pick after fallback', () => {
    const items = [
      { id: '1', hold: true, priority: 'low' },
      { id: '2', hold: true, priority: 'high' }
    ];
    const result = ItemSelectionService.select(
      items,
      { containerType: 'folder', now },
      { allowFallback: true, pick: 'all' }
    );
    expect(result.map(i => i.id)).toEqual(['2', '1']); // sorted by priority
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: FAIL (fallback not implemented)

**Step 3: Update implementation**

Update `select()` method in `ItemSelectionService.mjs`:

```javascript
  /**
   * Select items based on context and strategy.
   * Main entry point for item selection.
   *
   * @param {Array} items - Pre-enriched items (with metadata.percent, etc.)
   * @param {Object} context - Selection context
   * @param {string} [context.action] - play, queue, display, list, read
   * @param {string} [context.containerType] - folder, album, playlist, search
   * @param {Object} [context.query] - Query filters used (person, time, text)
   * @param {Date} context.now - Current date (required for filtering)
   * @param {Object} [overrides] - Explicit strategy overrides
   * @param {boolean} [overrides.allowFallback] - Enable fallback cascade for empty results
   * @returns {Array} Selected items
   */
  static select(items, context, overrides = {}) {
    const strategy = this.resolveStrategy(context, overrides);

    // Apply urgency promotion for watchlist-like strategies
    let processed = items;
    if (strategy.filter.includes('skipAfter') && context.now) {
      processed = QueueService.applyUrgency(processed, context.now);
    }

    // Filter with optional fallback
    if (strategy.filter.length > 0) {
      if (!context.now || !(context.now instanceof Date)) {
        throw new Error('now date required for filtering');
      }
      processed = this.#applyFiltersWithFallback(
        processed,
        strategy.filter,
        context,
        overrides.allowFallback
      );
    }

    // Sort
    processed = this.applySort(processed, strategy.sort);

    // Pick
    processed = this.applyPick(processed, strategy.pick);

    return processed;
  }

  /**
   * Apply filters with fallback cascade.
   * If result is empty and allowFallback, progressively relax filters.
   * @private
   */
  static #applyFiltersWithFallback(items, filters, context, allowFallback) {
    // Define which filters to relax in order
    const relaxOrder = ['skipAfter', 'hold', 'watched', 'waitUntil'];

    let result = this.applyFilters(items, filters, context);

    if (result.length > 0 || !allowFallback) {
      return result;
    }

    // Progressive relaxation
    let activeFilters = [...filters];
    for (const filterToRelax of relaxOrder) {
      if (activeFilters.includes(filterToRelax)) {
        activeFilters = activeFilters.filter(f => f !== filterToRelax);
        result = this.applyFilters(items, activeFilters, context);
        if (result.length > 0) {
          return result;
        }
      }
    }

    return result;
  }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/services/ItemSelectionService.mjs tests/isolated/domain/content/services/ItemSelectionService.test.mjs
git commit -m "$(cat <<'EOF'
feat(content): add fallback cascade to ItemSelectionService

When allowFallback=true and all items filtered, progressively relaxes
skipAfter, hold, watched, waitUntil filters until results found.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Export from Domain Index

**Files:**
- Modify: `backend/src/2_domains/content/index.mjs`

**Step 1: Verify current exports**

Run: `grep -n "ItemSelectionService" backend/src/2_domains/content/index.mjs`
Expected: No output (not yet exported)

**Step 2: Add export**

Add to `backend/src/2_domains/content/index.mjs` in the Services section:

```javascript
export { ItemSelectionService } from './services/ItemSelectionService.mjs';
```

**Step 3: Verify export works**

Run: `node -e "import('#domains/content').then(m => console.log(typeof m.ItemSelectionService))"`
Expected: `function`

**Step 4: Commit**

```bash
git add backend/src/2_domains/content/index.mjs
git commit -m "$(cat <<'EOF'
feat(content): export ItemSelectionService from domain index

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Run Full Test Suite

**Step 1: Run all ItemSelectionService tests**

Run: `npm test -- tests/isolated/domain/content/services/ItemSelectionService.test.mjs --coverage`
Expected: All tests PASS

**Step 2: Run related QueueService tests (ensure no regression)**

Run: `npm test -- tests/isolated/domain/content/services/QueueService.test.mjs`
Expected: All tests PASS

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

---

## Task 10: Update Design Document Status

**Files:**
- Modify: `docs/plans/2026-02-01-item-selection-service-design.md`

**Step 1: Update status**

Change line 4 from:
```markdown
**Status:** Design
```
To:
```markdown
**Status:** Implemented
```

**Step 2: Add implementation notes**

Add after References section:

```markdown
---

## Implementation Notes (2026-02-01)

- Created `ItemSelectionService` in domain layer with static methods
- Reused QueueService filter methods (filterBySkipAfter, filterByWaitUntil, etc.)
- Added new sort methods: track_order, date_asc, date_desc, random, title
- Implemented fallback cascade via private `#applyFiltersWithFallback`
- Exported from `backend/src/2_domains/content/index.mjs`
- Test coverage in `tests/isolated/domain/content/services/ItemSelectionService.test.mjs`
```

**Step 3: Commit**

```bash
git add docs/plans/2026-02-01-item-selection-service-design.md
git commit -m "$(cat <<'EOF'
docs: mark ItemSelectionService design as implemented

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Strategy registry | ItemSelectionService.mjs, test file |
| 2 | Filter methods | Same files |
| 3 | Sort methods | Same files |
| 4 | Pick methods | Same files |
| 5 | Strategy resolution | Same files |
| 6 | Main select() | Same files |
| 7 | Fallback cascade | Same files |
| 8 | Export from index | index.mjs |
| 9 | Full test suite | - |
| 10 | Update docs | design doc |

**Total commits:** 10
