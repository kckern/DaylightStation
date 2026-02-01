# Content Query Interface Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a unified content query interface that enables searching and listing content across multiple sources (Immich, Plex, Audiobookshelf) with canonical key translation, container aliases, and random selection.

**Architecture:** API layer normalizes HTTP params → Application service orchestrates multi-source queries with canonical key translation → Domain registry resolves source/category/provider → Adapters execute queries with their specific field mappings.

**Tech Stack:** Express.js, ES Modules, Jest for testing

**Reference:** `docs/reference/content/query-interface.md`

---

## Completed Tasks

- [x] Task 1.1: Extend ContentSourceRegistry with category/provider indexing
- [x] Task 1.2: Update bootstrap to pass category/provider to registry
- [x] Task 2.1: Create query parser for HTTP param normalization

---

## Task 2.2: Create Range Parser

**Files:**
- Create: `backend/src/4_api/v1/parsers/rangeParser.mjs`
- Test: `tests/isolated/api/parsers/rangeParser.test.mjs`

### Step 1: Write the failing tests

```javascript
// tests/isolated/api/parsers/rangeParser.test.mjs
import { describe, it, expect } from '@jest/globals';
import { parseDuration, parseTime, parseRange } from '#api/v1/parsers/rangeParser.mjs';

describe('rangeParser', () => {
  describe('parseDuration', () => {
    it('parses plain seconds', () => {
      expect(parseDuration('30')).toEqual({ value: 30 });
    });

    it('parses minutes', () => {
      expect(parseDuration('3m')).toEqual({ value: 180 });
    });

    it('parses hours', () => {
      expect(parseDuration('1h')).toEqual({ value: 3600 });
    });

    it('parses combined hours and minutes', () => {
      expect(parseDuration('1h30m')).toEqual({ value: 5400 });
    });

    it('parses range with both bounds', () => {
      expect(parseDuration('3m..10m')).toEqual({ from: 180, to: 600 });
    });

    it('parses open-ended range (max only)', () => {
      expect(parseDuration('..5m')).toEqual({ from: null, to: 300 });
    });

    it('parses open-ended range (min only)', () => {
      expect(parseDuration('30m..')).toEqual({ from: 1800, to: null });
    });

    it('returns null for invalid input', () => {
      expect(parseDuration('invalid')).toBeNull();
    });
  });

  describe('parseTime', () => {
    it('parses year', () => {
      const result = parseTime('2025');
      expect(result.from).toBe('2025-01-01');
      expect(result.to).toBe('2025-12-31');
    });

    it('parses year-month', () => {
      const result = parseTime('2025-06');
      expect(result.from).toBe('2025-06-01');
      expect(result.to).toBe('2025-06-30');
    });

    it('parses full date as single value', () => {
      const result = parseTime('2025-06-15');
      expect(result.value).toBe('2025-06-15');
    });

    it('parses year range', () => {
      const result = parseTime('2024..2025');
      expect(result.from).toBe('2024-01-01');
      expect(result.to).toBe('2025-12-31');
    });

    it('parses summer as June-August', () => {
      const result = parseTime('summer');
      expect(result.from).toContain('-06-01');
      expect(result.to).toContain('-08-31');
    });
  });

  describe('parseRange', () => {
    it('parses range with both bounds', () => {
      expect(parseRange('a..b')).toEqual({ from: 'a', to: 'b' });
    });

    it('parses single value', () => {
      expect(parseRange('value')).toEqual({ value: 'value' });
    });

    it('parses open-ended from', () => {
      expect(parseRange('..b')).toEqual({ from: null, to: 'b' });
    });

    it('parses open-ended to', () => {
      expect(parseRange('a..')).toEqual({ from: 'a', to: null });
    });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npm test -- tests/isolated/api/parsers/rangeParser.test.mjs`
Expected: FAIL with "Cannot find module"

### Step 3: Write the implementation

```javascript
// backend/src/4_api/v1/parsers/rangeParser.mjs

/**
 * Parse a duration string into seconds or a range of seconds.
 * Formats: 30, 3m, 1h, 1h30m, 3m..10m, ..5m, 30m..
 *
 * @param {string} value - Duration string
 * @returns {{ value?: number, from?: number|null, to?: number|null } | null}
 */
export function parseDuration(value) {
  if (!value || typeof value !== 'string') return null;

  // Check for range
  if (value.includes('..')) {
    const { from, to } = parseRange(value);
    return {
      from: from ? parseDurationValue(from) : null,
      to: to ? parseDurationValue(to) : null,
    };
  }

  const seconds = parseDurationValue(value);
  if (seconds === null) return null;
  return { value: seconds };
}

/**
 * Parse a single duration value to seconds.
 * @param {string} value
 * @returns {number|null}
 */
function parseDurationValue(value) {
  if (!value) return null;

  // Plain number = seconds
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10);
  }

  // Hours and/or minutes: 1h, 30m, 1h30m
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?$/);
  if (!match || (!match[1] && !match[2])) return null;

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  return hours * 3600 + minutes * 60;
}

/**
 * Season definitions (month ranges).
 */
const SEASONS = {
  spring: { fromMonth: 3, toMonth: 5 },
  summer: { fromMonth: 6, toMonth: 8 },
  fall: { fromMonth: 9, toMonth: 11 },
  autumn: { fromMonth: 9, toMonth: 11 },
  winter: { fromMonth: 12, toMonth: 2 }, // Crosses year boundary
};

/**
 * Parse a time string into a date or date range.
 * Formats: 2025, 2025-06, 2025-06-15, 2024..2025, summer
 *
 * @param {string} value - Time string
 * @returns {{ value?: string, from?: string, to?: string } | null}
 */
export function parseTime(value) {
  if (!value || typeof value !== 'string') return null;

  const lowerValue = value.toLowerCase();

  // Check for season
  if (SEASONS[lowerValue]) {
    const season = SEASONS[lowerValue];
    const year = new Date().getFullYear();
    const fromMonth = String(season.fromMonth).padStart(2, '0');
    const toMonth = String(season.toMonth).padStart(2, '0');
    const toDay = new Date(year, season.toMonth, 0).getDate(); // Last day of month
    return {
      from: `${year}-${fromMonth}-01`,
      to: `${year}-${toMonth}-${String(toDay).padStart(2, '0')}`,
    };
  }

  // Check for range
  if (value.includes('..')) {
    const { from, to } = parseRange(value);
    const fromDate = from ? parseTimeValue(from, 'start') : null;
    const toDate = to ? parseTimeValue(to, 'end') : null;
    return { from: fromDate, to: toDate };
  }

  // Single value
  const result = parseTimeValue(value, 'single');
  if (!result) return null;

  // If it's a year or year-month, return as range
  if (/^\d{4}$/.test(value)) {
    return {
      from: `${value}-01-01`,
      to: `${value}-12-31`,
    };
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return {
      from: `${value}-01`,
      to: `${value}-${String(lastDay).padStart(2, '0')}`,
    };
  }

  return { value: result };
}

/**
 * Parse a single time value to ISO date string.
 * @param {string} value
 * @param {'start'|'end'|'single'} mode
 * @returns {string|null}
 */
function parseTimeValue(value, mode) {
  if (!value) return null;

  // Full date: 2025-06-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  // Year-month: 2025-06
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number);
    if (mode === 'end') {
      const lastDay = new Date(year, month, 0).getDate();
      return `${value}-${String(lastDay).padStart(2, '0')}`;
    }
    return `${value}-01`;
  }

  // Year: 2025
  if (/^\d{4}$/.test(value)) {
    return mode === 'end' ? `${value}-12-31` : `${value}-01-01`;
  }

  return null;
}

/**
 * Parse a generic range string.
 * Formats: a..b, ..b, a.., value
 *
 * @param {string} value
 * @returns {{ value?: string, from?: string|null, to?: string|null }}
 */
export function parseRange(value) {
  if (!value || typeof value !== 'string') {
    return { value: '' };
  }

  if (!value.includes('..')) {
    return { value };
  }

  const [from, to] = value.split('..');
  return {
    from: from || null,
    to: to || null,
  };
}

export default { parseDuration, parseTime, parseRange };
```

### Step 4: Run tests to verify they pass

Run: `npm test -- tests/isolated/api/parsers/rangeParser.test.mjs`
Expected: All tests PASS

### Step 5: Commit

```bash
git add backend/src/4_api/v1/parsers/rangeParser.mjs tests/isolated/api/parsers/rangeParser.test.mjs
git commit -m "feat(api): add range parser for duration and time values"
```

---

## Task 3.1: Create ContentQueryService

**Files:**
- Create: `backend/src/3_applications/content/ContentQueryService.mjs`
- Test: `tests/isolated/application/content/ContentQueryService.test.mjs`

### Step 1: Write the failing tests

```javascript
// tests/isolated/application/content/ContentQueryService.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';

describe('ContentQueryService', () => {
  let service;
  let mockRegistry;
  let mockAdapter1;
  let mockAdapter2;

  beforeEach(() => {
    mockAdapter1 = {
      source: 'immich',
      search: jest.fn().mockResolvedValue({ items: [{ id: 'immich:1', source: 'immich' }], total: 1 }),
      getList: jest.fn().mockResolvedValue([{ id: 'immich:album:1', source: 'immich', itemType: 'container' }]),
      getSearchCapabilities: jest.fn().mockReturnValue({ canonical: ['text', 'person'], specific: [] }),
      getQueryMappings: jest.fn().mockReturnValue({ person: 'personIds' }),
      getContainerAliases: jest.fn().mockReturnValue({ playlists: 'album:' }),
    };

    mockAdapter2 = {
      source: 'plex',
      search: jest.fn().mockResolvedValue({ items: [{ id: 'plex:1', source: 'plex' }], total: 1 }),
      getList: jest.fn().mockResolvedValue([{ id: 'plex:playlist:1', source: 'plex', itemType: 'container' }]),
      getSearchCapabilities: jest.fn().mockReturnValue({ canonical: ['text'], specific: ['actor'] }),
      getQueryMappings: jest.fn().mockReturnValue({}),
      getContainerAliases: jest.fn().mockReturnValue({ playlists: 'playlist:' }),
    };

    mockRegistry = {
      resolveSource: jest.fn().mockReturnValue([mockAdapter1, mockAdapter2]),
      get: jest.fn().mockImplementation(source => {
        if (source === 'immich') return mockAdapter1;
        if (source === 'plex') return mockAdapter2;
        return null;
      }),
    };

    service = new ContentQueryService({ registry: mockRegistry });
  });

  describe('search', () => {
    it('searches across multiple sources', async () => {
      const result = await service.search({ text: 'test' });

      expect(mockRegistry.resolveSource).toHaveBeenCalledWith(undefined);
      expect(mockAdapter1.search).toHaveBeenCalled();
      expect(mockAdapter2.search).toHaveBeenCalled();
      expect(result.items).toHaveLength(2);
      expect(result.sources).toContain('immich');
      expect(result.sources).toContain('plex');
    });

    it('filters by source', async () => {
      mockRegistry.resolveSource.mockReturnValue([mockAdapter1]);

      const result = await service.search({ source: 'gallery', text: 'test' });

      expect(mockRegistry.resolveSource).toHaveBeenCalledWith('gallery');
      expect(result.items).toHaveLength(1);
    });

    it('translates canonical keys to adapter-specific', async () => {
      mockRegistry.resolveSource.mockReturnValue([mockAdapter1]);

      await service.search({ person: 'alice' });

      expect(mockAdapter1.search).toHaveBeenCalledWith(
        expect.objectContaining({ personIds: 'alice' })
      );
    });

    it('handles adapter failures gracefully', async () => {
      mockAdapter2.search.mockRejectedValue(new Error('Connection failed'));

      const result = await service.search({ text: 'test' });

      expect(result.items).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].source).toBe('plex');
    });
  });

  describe('list', () => {
    it('lists containers from alias', async () => {
      const result = await service.list({ from: 'playlists' });

      expect(mockAdapter1.getList).toHaveBeenCalledWith('album:');
      expect(mockAdapter2.getList).toHaveBeenCalledWith('playlist:');
      expect(result.items).toHaveLength(2);
    });

    it('returns empty for unknown alias', async () => {
      mockAdapter1.getContainerAliases.mockReturnValue({});
      mockAdapter2.getContainerAliases.mockReturnValue({});

      const result = await service.list({ from: 'unknown' });

      expect(result.items).toHaveLength(0);
    });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npm test -- tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: FAIL with "Cannot find module"

### Step 3: Write the implementation

```javascript
// backend/src/3_applications/content/ContentQueryService.mjs

/**
 * Application service for orchestrating content queries across multiple sources.
 * Handles canonical key translation, result merging, and capability filtering.
 */
export class ContentQueryService {
  #registry;

  /**
   * @param {Object} deps
   * @param {import('#domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} deps.registry
   */
  constructor({ registry }) {
    this.#registry = registry;
  }

  /**
   * Search across multiple content sources.
   *
   * @param {Object} query - Normalized query object
   * @returns {Promise<{items: Array, total: number, sources: string[], warnings?: Array}>}
   */
  async search(query) {
    const adapters = this.#registry.resolveSource(query.source);
    const results = [];
    const warnings = [];

    await Promise.all(
      adapters.map(async (adapter) => {
        try {
          if (!this.#canHandle(adapter, query)) return;

          const translated = this.#translateQuery(adapter, query);
          const result = await adapter.search(translated);
          results.push({ adapter, result });
        } catch (error) {
          warnings.push({
            source: adapter.source,
            error: error.message,
          });
        }
      })
    );

    return this.#mergeResults(results, query, warnings);
  }

  /**
   * List containers from an alias (e.g., "playlists") across sources.
   *
   * @param {Object} query - Query with 'from' alias
   * @returns {Promise<{items: Array, total: number, sources: string[], picked?: Object}>}
   */
  async list(query) {
    const { from, source, pick } = query;
    const adapters = this.#registry.resolveSource(source);
    const results = [];
    const warnings = [];

    await Promise.all(
      adapters.map(async (adapter) => {
        try {
          const aliases = adapter.getContainerAliases?.() ?? {};
          const containerPath = aliases[from];

          if (!containerPath) return;

          const items = await adapter.getList(containerPath);
          results.push({ adapter, result: { items, total: items.length } });
        } catch (error) {
          warnings.push({
            source: adapter.source,
            error: error.message,
          });
        }
      })
    );

    const merged = this.#mergeResults(results, query, warnings);

    // Handle pick=random
    if (pick === 'random' && merged.items.length > 0) {
      return this.#pickRandom(merged, query);
    }

    return merged;
  }

  /**
   * Pick a random container and return its contents.
   *
   * @param {Object} listResult - Result from list()
   * @param {Object} query - Original query for filtering contents
   * @returns {Promise<Object>}
   */
  async #pickRandom(listResult, query) {
    const containers = listResult.items.filter(i => i.itemType === 'container');
    if (containers.length === 0) {
      return { ...listResult, picked: null };
    }

    const picked = containers[Math.floor(Math.random() * containers.length)];
    const [source] = picked.id.split(':');
    const adapter = this.#registry.get(source);

    if (!adapter) {
      return { ...listResult, picked, items: [], total: 0 };
    }

    // Get contents of picked container
    const localId = picked.id.replace(`${source}:`, '');
    const contents = await adapter.getList(localId);

    // Apply filters to contents
    let filteredContents = contents;
    if (query.mediaType) {
      filteredContents = contents.filter(
        item => item.metadata?.type === query.mediaType || item.mediaType === query.mediaType
      );
    }

    return {
      from: query.from,
      picked: {
        id: picked.id,
        source: picked.source,
        title: picked.title,
      },
      sources: [picked.source],
      total: filteredContents.length,
      items: filteredContents,
    };
  }

  /**
   * Check if adapter can handle the query.
   */
  #canHandle(adapter, query) {
    const caps = adapter.getSearchCapabilities?.() ?? { canonical: [], specific: [] };
    const queryKeys = Object.keys(query).filter(k => !['source', 'take', 'skip', 'sort'].includes(k));

    // Must support at least one query key (or query is empty = list all)
    if (queryKeys.length === 0) return true;

    return queryKeys.some(k =>
      caps.canonical?.includes(k) || caps.specific?.includes(k)
    );
  }

  /**
   * Translate canonical query keys to adapter-specific.
   */
  #translateQuery(adapter, query) {
    const mappings = adapter.getQueryMappings?.() ?? {};
    const translated = {};

    for (const [key, value] of Object.entries(query)) {
      // Skip meta keys
      if (['source', 'capability'].includes(key)) continue;

      const mapping = mappings[key];
      if (mapping) {
        if (typeof mapping === 'string') {
          translated[mapping] = value;
        } else if (mapping.from && mapping.to && typeof value === 'object' && value.from !== undefined) {
          // Range mapping
          if (value.from) translated[mapping.from] = value.from;
          if (value.to) translated[mapping.to] = value.to;
        } else if (typeof mapping === 'object' && mapping.from) {
          // Range value as string "a..b"
          if (typeof value === 'string' && value.includes('..')) {
            const [from, to] = value.split('..');
            if (from) translated[mapping.from] = from;
            if (to) translated[mapping.to] = to;
          } else {
            translated[mapping.from] = value;
          }
        }
      } else {
        // Pass through unmapped keys
        translated[key] = value;
      }
    }

    return translated;
  }

  /**
   * Merge results from multiple adapters.
   */
  #mergeResults(results, query, warnings = []) {
    let items = results.flatMap(r => r.result.items || []);

    // Apply capability filter
    if (query.capability) {
      items = items.filter(item => this.#hasCapability(item, query.capability));
    }

    // Apply sort
    if (query.sort === 'random') {
      items = this.#shuffle(items);
    }

    // Apply pagination
    const skip = query.skip || 0;
    const take = query.take || items.length;
    const total = items.length;
    items = items.slice(skip, skip + take);

    const sources = [...new Set(items.map(i => i.source))];

    const result = { items, total, sources };
    if (warnings.length > 0) {
      result.warnings = warnings;
    }
    return result;
  }

  /**
   * Check if item has a capability.
   */
  #hasCapability(item, capability) {
    const capMap = {
      playable: () => typeof item.isPlayable === 'function' ? item.isPlayable() : !!item.mediaUrl,
      viewable: () => typeof item.isViewable === 'function' ? item.isViewable() : !!item.imageUrl,
      readable: () => typeof item.isReadable === 'function' ? item.isReadable() : !!item.contentUrl,
      listable: () => typeof item.isContainer === 'function' ? item.isContainer() : item.itemType === 'container',
    };
    return capMap[capability]?.() ?? false;
  }

  /**
   * Fisher-Yates shuffle.
   */
  #shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

export default ContentQueryService;
```

### Step 4: Create index.mjs export

```javascript
// backend/src/3_applications/content/index.mjs (update if exists, create if not)
export { ContentQueryService } from './ContentQueryService.mjs';
```

### Step 5: Run tests to verify they pass

Run: `npm test -- tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: All tests PASS

### Step 6: Commit

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs backend/src/3_applications/content/index.mjs tests/isolated/application/content/ContentQueryService.test.mjs
git commit -m "feat(app): add ContentQueryService for multi-source queries"
```

---

## Task 4.1: Add Query Mappings to ImmichAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`
- Test: `tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs` (add tests)

### Step 1: Add the methods to ImmichAdapter

Add these methods to the ImmichAdapter class:

```javascript
/**
 * Get canonical → adapter-specific query key mappings.
 * @returns {Object}
 */
getQueryMappings() {
  return {
    person: 'personIds',
    time: { from: 'takenAfter', to: 'takenBefore' },
    duration: { from: 'durationMin', to: 'durationMax' },
  };
}

/**
 * Get container alias → internal path mappings.
 * @returns {Object}
 */
getContainerAliases() {
  return {
    playlists: 'album:',
    albums: 'album:',
    people: 'person:',
    cameras: 'camera:',
  };
}

/**
 * Get list of root containers for browsing.
 * @returns {string[]}
 */
getRootContainers() {
  return ['albums', 'people', 'cameras'];
}
```

### Step 2: Update getList to handle new container types

Extend the existing `getList()` method to handle `person:` and `camera:` paths (if not already implemented).

### Step 3: Verify existing tests still pass

Run: `npm test -- tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs`
Expected: All tests PASS

### Step 4: Commit

```bash
git add backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs
git commit -m "feat(immich): add query mappings and container aliases"
```

---

## Task 4.2: Add Query Mappings to PlexAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`

### Step 1: Add the methods to PlexAdapter

Add these methods to the PlexAdapter class:

```javascript
/**
 * Get canonical → adapter-specific query key mappings.
 * @returns {Object}
 */
getQueryMappings() {
  return {
    person: null, // Plex doesn't have a simple person filter; use actor/director specifically
    creator: 'director',
    time: 'year',
  };
}

/**
 * Get container alias → internal path mappings.
 * @returns {Object}
 */
getContainerAliases() {
  return {
    playlists: 'playlist:',
    collections: 'collection:',
    artists: 'artist:',
    albums: 'album:',
  };
}

/**
 * Get list of root containers for browsing.
 * @returns {string[]}
 */
getRootContainers() {
  return ['playlists', 'collections'];
}
```

### Step 2: Extend getList for playlists

Ensure `getList('playlist:')` returns all playlists. Add to existing getList:

```javascript
// In getList(), add handling for playlist: prefix
if (localId === 'playlist:' || localId === 'playlists') {
  const data = await this.client.getContainer('/playlists/all');
  const playlists = data.MediaContainer?.Metadata || [];
  return playlists.map(p => this._toListableItem(p));
}
```

### Step 3: Verify syntax and existing tests

Run: `npm test -- tests/isolated/adapter/content/PlexAdapter.test.mjs`
Expected: Tests PASS

### Step 4: Commit

```bash
git add backend/src/1_adapters/content/media/plex/PlexAdapter.mjs
git commit -m "feat(plex): add query mappings and container aliases"
```

---

## Task 4.3: Add Query Mappings to AudiobookshelfAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs`
- Create: `backend/src/1_adapters/content/readable/audiobookshelf/manifest.mjs`

### Step 1: Create manifest file

```javascript
// backend/src/1_adapters/content/readable/audiobookshelf/manifest.mjs

export default {
  provider: 'abs',
  capability: 'readable',
  displayName: 'Audiobookshelf',

  adapter: () => import('./AudiobookshelfAdapter.mjs'),

  configSchema: {
    host: { type: 'string', required: true, description: 'Audiobookshelf server URL' },
    token: { type: 'string', secret: true, required: true, description: 'API token' },
  }
};
```

### Step 2: Add the methods to AudiobookshelfAdapter

```javascript
/**
 * Get canonical → adapter-specific query key mappings.
 * @returns {Object}
 */
getQueryMappings() {
  return {
    person: 'narrator', // or author, best effort
    creator: 'author',
  };
}

/**
 * Get container alias → internal path mappings.
 * @returns {Object}
 */
getContainerAliases() {
  return {
    libraries: 'lib:',
    authors: 'author:',
    narrators: 'narrator:',
    series: 'series:',
  };
}

/**
 * Get list of root containers for browsing.
 * @returns {string[]}
 */
getRootContainers() {
  return ['libraries', 'authors', 'series'];
}
```

### Step 3: Update bootstrap to import ABS manifest

Add to bootstrap.mjs imports:

```javascript
import absManifest from '#adapters/content/readable/audiobookshelf/manifest.mjs';
```

Update ABS registration (if it exists) to pass metadata.

### Step 4: Commit

```bash
git add backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs backend/src/1_adapters/content/readable/audiobookshelf/manifest.mjs backend/src/0_system/bootstrap.mjs
git commit -m "feat(abs): add query mappings, container aliases, and manifest"
```

---

## Task 5.1: Update Content Router

**Files:**
- Modify: `backend/src/4_api/v1/routers/content.mjs`

### Step 1: Import dependencies

Add imports at top of content.mjs:

```javascript
import { parseContentQuery, validateContentQuery } from '../parsers/contentQueryParser.mjs';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';
```

### Step 2: Add /search endpoint (or update existing)

```javascript
/**
 * GET /content/search
 * Search across content sources
 */
router.get('/search', async (req, res) => {
  try {
    const query = parseContentQuery(req.query);
    const validation = validateContentQuery(query);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors,
      });
    }

    const result = await req.contentQueryService.search(query);
    res.json({
      query,
      ...result,
    });
  } catch (error) {
    console.error('[ContentRouter] search error:', error.message);
    res.status(500).json({ error: 'Search failed', message: error.message });
  }
});
```

### Step 3: Add /list endpoint

```javascript
/**
 * GET /content/list
 * List containers (playlists, albums, people, etc.)
 */
router.get('/list', async (req, res) => {
  try {
    const query = parseContentQuery(req.query);
    const validation = validateContentQuery(query);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors,
      });
    }

    if (!query.from) {
      return res.status(400).json({
        error: 'Missing required parameter: from',
      });
    }

    const result = await req.contentQueryService.list(query);
    res.json({
      from: query.from,
      ...result,
    });
  } catch (error) {
    console.error('[ContentRouter] list error:', error.message);
    res.status(500).json({ error: 'List failed', message: error.message });
  }
});
```

### Step 4: Update router factory to accept ContentQueryService

Ensure the router factory receives contentQueryService in its config and attaches it to req.

### Step 5: Update bootstrap to create and pass ContentQueryService

In bootstrap.mjs where content router is created, instantiate ContentQueryService and pass it.

### Step 6: Verify syntax

Run: `node --check backend/src/4_api/v1/routers/content.mjs`
Expected: No errors

### Step 7: Commit

```bash
git add backend/src/4_api/v1/routers/content.mjs backend/src/0_system/bootstrap.mjs
git commit -m "feat(api): add /content/search and /content/list endpoints"
```

---

## Task 6.1: Unit Tests for Registry

**Files:**
- Create: `tests/isolated/domain/content/ContentSourceRegistry.test.mjs`

### Step 1: Write comprehensive registry tests

```javascript
// tests/isolated/domain/content/ContentSourceRegistry.test.mjs
import { describe, it, expect, beforeEach } from '@jest/globals';
import { ContentSourceRegistry } from '#domains/content/services/ContentSourceRegistry.mjs';

describe('ContentSourceRegistry', () => {
  let registry;

  const mockAdapter = (source, prefixes = []) => ({
    source,
    prefixes: prefixes.map(p => ({ prefix: p })),
  });

  beforeEach(() => {
    registry = new ContentSourceRegistry();
  });

  describe('register', () => {
    it('registers adapter with metadata', () => {
      const adapter = mockAdapter('immich', ['immich']);
      registry.register(adapter, { category: 'gallery', provider: 'immich' });

      expect(registry.get('immich')).toBe(adapter);
    });

    it('indexes by category', () => {
      const adapter = mockAdapter('immich', ['immich']);
      registry.register(adapter, { category: 'gallery', provider: 'immich' });

      expect(registry.getByCategory('gallery')).toContain(adapter);
    });

    it('indexes by provider', () => {
      const adapter = mockAdapter('immich', ['immich']);
      registry.register(adapter, { category: 'gallery', provider: 'immich' });

      expect(registry.getByProvider('immich')).toContain(adapter);
    });
  });

  describe('resolveSource', () => {
    beforeEach(() => {
      registry.register(mockAdapter('immich', ['immich']), { category: 'gallery', provider: 'immich' });
      registry.register(mockAdapter('immich-family', ['immich-family']), { category: 'gallery', provider: 'immich' });
      registry.register(mockAdapter('plex', ['plex']), { category: 'media', provider: 'plex' });
    });

    it('resolves exact source', () => {
      const result = registry.resolveSource('immich');
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('immich');
    });

    it('resolves by provider (multiple instances)', () => {
      const result = registry.resolveSource('immich');
      // 'immich' matches exact source, not provider
      expect(result).toHaveLength(1);
    });

    it('resolves by category', () => {
      const result = registry.resolveSource('gallery');
      expect(result).toHaveLength(2);
    });

    it('returns all when no filter', () => {
      const result = registry.resolveSource();
      expect(result).toHaveLength(3);
    });

    it('returns empty for unknown source', () => {
      const result = registry.resolveSource('unknown');
      expect(result).toHaveLength(0);
    });
  });
});
```

### Step 2: Run tests

Run: `npm test -- tests/isolated/domain/content/ContentSourceRegistry.test.mjs`
Expected: All tests PASS

### Step 3: Commit

```bash
git add tests/isolated/domain/content/ContentSourceRegistry.test.mjs
git commit -m "test(domain): add ContentSourceRegistry unit tests"
```

---

## Task Dependencies Summary

```
[DONE] 1.1 Registry
[DONE] 1.2 Bootstrap
[DONE] 2.1 QueryParser
   │
   ├──► 2.2 RangeParser
   │
   ├──► 3.1 ContentQueryService
   │
   ├──► 4.1 ImmichAdapter mappings
   ├──► 4.2 PlexAdapter mappings
   ├──► 4.3 ABSAdapter mappings
   │
   └──► 5.1 Content Router
           │
           └──► 6.1 Unit Tests
```

---

## Notes

- Working in `composed-presentation` worktree
- Reference design: `docs/reference/content/query-interface.md`
- All adapters already have `search()` - we're adding mappings
- ContentSourceRegistry extended with category/provider indexing (done)
- Query parser created (done)
