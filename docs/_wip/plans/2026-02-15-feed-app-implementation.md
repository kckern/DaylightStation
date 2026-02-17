# FeedApp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a FeedApp with three views — FreshRSS reader, headline scanner, and infinite scroll — with real data flowing end-to-end.

**Architecture:** Hybrid approach. Reader proxies to FreshRSS Google Reader API. Headlines are harvested hourly from standalone RSS URLs + select FreshRSS feeds, cached as per-source YAML files. Scroll merges both into a chronological stream. User-scoped config and auth.

**Tech Stack:** Express routers, `rss-parser` (already installed), `DataService` for YAML I/O, Jest for tests, React + Mantine + React Router 6 for frontend.

**Design Doc:** `docs/_wip/plans/2026-02-15-feed-app-design.md`

---

## Task 1: Headline Entity

**Files:**
- Create: `backend/src/2_domains/feed/entities/Headline.mjs`
- Test: `tests/isolated/domain/feed/Headline.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/isolated/domain/feed/Headline.test.mjs
import { Headline } from '#domains/feed/entities/Headline.mjs';

describe('Headline', () => {
  const validData = {
    source: 'cnn',
    title: 'Breaking: Something happened',
    desc: 'Officials confirmed today that the situation has developed...',
    link: 'https://cnn.com/article/123',
    timestamp: new Date('2026-02-15T09:45:00Z'),
  };

  test('creates from valid data', () => {
    const headline = new Headline(validData);
    expect(headline.source).toBe('cnn');
    expect(headline.title).toBe('Breaking: Something happened');
    expect(headline.desc).toBe('Officials confirmed today that the situation has developed...');
    expect(headline.link).toBe('https://cnn.com/article/123');
    expect(headline.timestamp).toEqual(new Date('2026-02-15T09:45:00Z'));
  });

  test('desc defaults to null', () => {
    const { desc, ...noDesc } = validData;
    const headline = new Headline(noDesc);
    expect(headline.desc).toBeNull();
  });

  test('truncateDesc truncates long descriptions', () => {
    const longDesc = 'A'.repeat(200);
    const headline = new Headline({ ...validData, desc: longDesc });
    const truncated = headline.truncateDesc(120);
    expect(truncated.length).toBeLessThanOrEqual(123); // 120 + '...'
    expect(truncated.endsWith('...')).toBe(true);
  });

  test('truncateDesc returns short desc as-is', () => {
    const headline = new Headline({ ...validData, desc: 'Short' });
    expect(headline.truncateDesc(120)).toBe('Short');
  });

  test('toJSON serializes correctly', () => {
    const headline = new Headline(validData);
    const json = headline.toJSON();
    expect(json).toEqual({
      source: 'cnn',
      title: 'Breaking: Something happened',
      desc: 'Officials confirmed today that the situation has developed...',
      link: 'https://cnn.com/article/123',
      timestamp: '2026-02-15T09:45:00.000Z',
    });
  });

  test('fromJSON roundtrips', () => {
    const headline = new Headline(validData);
    const restored = Headline.fromJSON(headline.toJSON());
    expect(restored.source).toBe(headline.source);
    expect(restored.title).toBe(headline.title);
    expect(restored.link).toBe(headline.link);
  });

  test('throws on missing source', () => {
    const { source, ...noSource } = validData;
    expect(() => new Headline(noSource)).toThrow();
  });

  test('throws on missing title', () => {
    const { title, ...noTitle } = validData;
    expect(() => new Headline(noTitle)).toThrow();
  });

  test('throws on missing link', () => {
    const { link, ...noLink } = validData;
    expect(() => new Headline(noLink)).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/domain/feed/Headline.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/2_domains/feed/entities/Headline.mjs
/**
 * Headline Entity
 *
 * Lightweight representation of a news headline for the Headlines view.
 * Stores only source, title, desc, link, timestamp.
 *
 * @module domains/feed/entities
 */

export class Headline {
  /**
   * @param {Object} data
   * @param {string} data.source - Source ID (e.g., 'cnn', 'freshrss-12')
   * @param {string} data.title - Headline text
   * @param {string|null} [data.desc] - Short description (first sentence or 120 chars)
   * @param {string} data.link - URL to original article
   * @param {Date|string} [data.timestamp] - Publication time
   */
  constructor(data) {
    if (!data.source) throw new Error('Headline requires source');
    if (!data.title) throw new Error('Headline requires title');
    if (!data.link) throw new Error('Headline requires link');

    this.source = data.source;
    this.title = data.title;
    this.desc = data.desc || null;
    this.link = data.link;
    this.timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
  }

  /**
   * Truncate desc to maxLength with ellipsis
   * @param {number} maxLength
   * @returns {string|null}
   */
  truncateDesc(maxLength = 120) {
    if (!this.desc) return null;
    if (this.desc.length <= maxLength) return this.desc;
    return this.desc.substring(0, maxLength) + '...';
  }

  toJSON() {
    return {
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
}

export default Headline;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/domain/feed/Headline.test.mjs --verbose`
Expected: PASS — all 9 tests

**Step 5: Commit**

```bash
git add backend/src/2_domains/feed/entities/Headline.mjs tests/isolated/domain/feed/Headline.test.mjs
git commit -m "feat(feed): add Headline entity with tests"
```

---

## Task 2: IHeadlineStore Port

**Files:**
- Create: `backend/src/3_applications/feed/ports/IHeadlineStore.mjs`
- Test: `tests/isolated/contract/feed/IHeadlineStore.test.mjs`

**Step 1: Write the failing contract test**

```javascript
// tests/isolated/contract/feed/IHeadlineStore.test.mjs
import { IHeadlineStore } from '#apps/feed/ports/IHeadlineStore.mjs';

describe('IHeadlineStore contract', () => {
  test('all methods throw "Not implemented"', async () => {
    const store = new IHeadlineStore();
    await expect(store.loadSource('cnn', 'user1')).rejects.toThrow('Not implemented');
    await expect(store.saveSource('cnn', [], 'user1')).rejects.toThrow('Not implemented');
    await expect(store.loadAllSources('user1')).rejects.toThrow('Not implemented');
    await expect(store.pruneOlderThan('cnn', new Date(), 'user1')).rejects.toThrow('Not implemented');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/contract/feed/IHeadlineStore.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/feed/ports/IHeadlineStore.mjs
/**
 * IHeadlineStore Port
 *
 * Interface for headline cache persistence.
 * Stores per-source headline YAML files.
 *
 * @module applications/feed/ports
 */

export class IHeadlineStore {
  /**
   * Load cached headlines for a single source
   * @param {string} sourceId - e.g., 'cnn', 'freshrss-12'
   * @param {string} username
   * @returns {Promise<{ source: string, label: string, lastHarvest: string|null, items: Object[] } | null>}
   */
  async loadSource(sourceId, username) {
    throw new Error('Not implemented');
  }

  /**
   * Save headlines for a single source
   * @param {string} sourceId
   * @param {Object} data - { source, label, lastHarvest, items }
   * @param {string} username
   * @returns {Promise<boolean>}
   */
  async saveSource(sourceId, data, username) {
    throw new Error('Not implemented');
  }

  /**
   * Load all cached sources for a user
   * @param {string} username
   * @returns {Promise<Object>} - { sourceId: { source, label, lastHarvest, items } }
   */
  async loadAllSources(username) {
    throw new Error('Not implemented');
  }

  /**
   * Remove items older than cutoff for a source
   * @param {string} sourceId
   * @param {Date} cutoff
   * @param {string} username
   * @returns {Promise<number>} - Number of items pruned
   */
  async pruneOlderThan(sourceId, cutoff, username) {
    throw new Error('Not implemented');
  }
}

export default IHeadlineStore;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/contract/feed/IHeadlineStore.test.mjs --verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/ports/IHeadlineStore.mjs tests/isolated/contract/feed/IHeadlineStore.test.mjs
git commit -m "feat(feed): add IHeadlineStore port interface"
```

---

## Task 3: YamlHeadlineCacheStore

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlHeadlineCacheStore.mjs`
- Test: `tests/isolated/adapter/feed/YamlHeadlineCacheStore.test.mjs`

**Context:** Uses `dataService.user.read(path, username)` / `dataService.user.write(path, data, username)`. User cache path: `cache/feed/headlines/{sourceId}`. DataService auto-appends `.yml`.

**Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/feed/YamlHeadlineCacheStore.test.mjs
import { jest } from '@jest/globals';
import { YamlHeadlineCacheStore } from '#adapters/persistence/yaml/YamlHeadlineCacheStore.mjs';

describe('YamlHeadlineCacheStore', () => {
  let store;
  let mockDataService;

  beforeEach(() => {
    mockDataService = {
      user: {
        read: jest.fn(),
        write: jest.fn(() => true),
      },
    };
    store = new YamlHeadlineCacheStore({ dataService: mockDataService });
  });

  describe('loadSource', () => {
    test('reads from correct path', async () => {
      mockDataService.user.read.mockReturnValue({
        source: 'cnn',
        label: 'CNN',
        last_harvest: '2026-02-15T10:00:00Z',
        items: [{ title: 'Test', link: 'https://cnn.com/1', timestamp: '2026-02-15T09:00:00Z' }],
      });

      const result = await store.loadSource('cnn', 'kckern');
      expect(mockDataService.user.read).toHaveBeenCalledWith('cache/feed/headlines/cnn', 'kckern');
      expect(result.source).toBe('cnn');
      expect(result.items).toHaveLength(1);
    });

    test('returns null when no file exists', async () => {
      mockDataService.user.read.mockReturnValue(null);
      const result = await store.loadSource('cnn', 'kckern');
      expect(result).toBeNull();
    });
  });

  describe('saveSource', () => {
    test('writes to correct path', async () => {
      const data = {
        source: 'cnn',
        label: 'CNN',
        lastHarvest: '2026-02-15T10:00:00Z',
        items: [],
      };
      await store.saveSource('cnn', data, 'kckern');
      expect(mockDataService.user.write).toHaveBeenCalledWith(
        'cache/feed/headlines/cnn',
        expect.objectContaining({ source: 'cnn' }),
        'kckern'
      );
    });
  });

  describe('loadAllSources', () => {
    test('loads all source files from directory listing', async () => {
      // loadAllSources needs to list files in the cache dir
      // DataService doesn't have a list method, so store uses fs to list
      // For now, mock the internal listing
      mockDataService.user.read.mockReturnValue({
        source: 'cnn',
        label: 'CNN',
        last_harvest: '2026-02-15T10:00:00Z',
        items: [],
      });

      // This test verifies the method exists and returns correct shape
      // Full integration test will verify file system listing
      const result = await store.loadAllSources('kckern');
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  describe('pruneOlderThan', () => {
    test('removes items older than cutoff', async () => {
      const now = new Date('2026-02-15T12:00:00Z');
      const cutoff = new Date('2026-02-15T00:00:00Z');
      mockDataService.user.read.mockReturnValue({
        source: 'cnn',
        label: 'CNN',
        last_harvest: now.toISOString(),
        items: [
          { title: 'New', link: 'https://cnn.com/1', timestamp: '2026-02-15T10:00:00Z' },
          { title: 'Old', link: 'https://cnn.com/2', timestamp: '2026-02-14T10:00:00Z' },
        ],
      });

      const pruned = await store.pruneOlderThan('cnn', cutoff, 'kckern');
      expect(pruned).toBe(1);
      expect(mockDataService.user.write).toHaveBeenCalledWith(
        'cache/feed/headlines/cnn',
        expect.objectContaining({
          items: [expect.objectContaining({ title: 'New' })],
        }),
        'kckern'
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/YamlHeadlineCacheStore.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/1_adapters/persistence/yaml/YamlHeadlineCacheStore.mjs
/**
 * YamlHeadlineCacheStore
 *
 * Stores per-source headline cache as YAML files.
 * Path: users/{username}/cache/feed/headlines/{sourceId}.yml
 *
 * @module adapters/persistence/yaml
 */

import fs from 'fs';
import path from 'path';
import { IHeadlineStore } from '#apps/feed/ports/IHeadlineStore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const CACHE_BASE = 'cache/feed/headlines';

export class YamlHeadlineCacheStore extends IHeadlineStore {
  #dataService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.dataService - DataService for YAML I/O
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ dataService, logger = console }) {
    super();
    if (!dataService) {
      throw new InfrastructureError('YamlHeadlineCacheStore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService',
      });
    }
    this.#dataService = dataService;
    this.#logger = logger;
  }

  async loadSource(sourceId, username) {
    const data = this.#dataService.user.read(`${CACHE_BASE}/${sourceId}`, username);
    if (!data) return null;
    return {
      source: data.source || sourceId,
      label: data.label || sourceId,
      lastHarvest: data.last_harvest || null,
      items: data.items || [],
    };
  }

  async saveSource(sourceId, data, username) {
    this.#logger.debug?.('headline.cache.save', { sourceId, username, itemCount: data.items?.length });
    return this.#dataService.user.write(`${CACHE_BASE}/${sourceId}`, {
      source: data.source || sourceId,
      label: data.label || sourceId,
      last_harvest: data.lastHarvest || new Date().toISOString(),
      items: data.items || [],
    }, username);
  }

  async loadAllSources(username) {
    const result = {};
    const userDataDir = this.#dataService.user.getBasePath?.(username);
    if (!userDataDir) return result;

    const cacheDir = path.join(userDataDir, CACHE_BASE.split('/').join(path.sep));
    if (!fs.existsSync(cacheDir)) return result;

    const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.yml'));
    for (const file of files) {
      const sourceId = file.replace('.yml', '');
      const data = await this.loadSource(sourceId, username);
      if (data) {
        result[sourceId] = data;
      }
    }
    return result;
  }

  async pruneOlderThan(sourceId, cutoff, username) {
    const data = await this.loadSource(sourceId, username);
    if (!data || !data.items?.length) return 0;

    const cutoffTime = cutoff.getTime();
    const before = data.items.length;
    data.items = data.items.filter(item => new Date(item.timestamp).getTime() >= cutoffTime);
    const pruned = before - data.items.length;

    if (pruned > 0) {
      await this.saveSource(sourceId, data, username);
      this.#logger.debug?.('headline.cache.pruned', { sourceId, username, pruned });
    }

    return pruned;
  }
}

export default YamlHeadlineCacheStore;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/adapter/feed/YamlHeadlineCacheStore.test.mjs --verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlHeadlineCacheStore.mjs tests/isolated/adapter/feed/YamlHeadlineCacheStore.test.mjs
git commit -m "feat(feed): add YamlHeadlineCacheStore adapter"
```

---

## Task 4: RssHeadlineHarvester

**Files:**
- Create: `backend/src/1_adapters/feed/RssHeadlineHarvester.mjs`
- Test: `tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs`

**Context:** Uses `rss-parser` (already in `backend/package.json`). Fetches RSS feed, extracts title, desc (first 120 chars of `contentSnippet` or `content`), link, timestamp.

**Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs
import { jest } from '@jest/globals';
import { RssHeadlineHarvester } from '#adapters/feed/RssHeadlineHarvester.mjs';

describe('RssHeadlineHarvester', () => {
  let harvester;
  let mockRssParser;

  const fakeFeed = {
    title: 'CNN Top Stories',
    items: [
      {
        title: 'Breaking news headline',
        contentSnippet: 'Officials say the situation has developed significantly over the past 24 hours with new developments emerging from multiple sources.',
        link: 'https://cnn.com/article/1',
        pubDate: 'Sat, 15 Feb 2026 09:00:00 GMT',
      },
      {
        title: 'Another story',
        content: '<p>Some HTML content here that should be stripped for description purposes.</p>',
        link: 'https://cnn.com/article/2',
        pubDate: 'Sat, 15 Feb 2026 08:00:00 GMT',
      },
      {
        title: 'No description story',
        link: 'https://cnn.com/article/3',
        pubDate: 'Sat, 15 Feb 2026 07:00:00 GMT',
      },
    ],
  };

  beforeEach(() => {
    mockRssParser = {
      parseURL: jest.fn().mockResolvedValue(fakeFeed),
    };
    harvester = new RssHeadlineHarvester({ rssParser: mockRssParser });
  });

  test('fetches and parses feed', async () => {
    const result = await harvester.harvest({
      id: 'cnn',
      label: 'CNN',
      url: 'http://rss.cnn.com/rss/cnn_topstories.rss',
    });

    expect(mockRssParser.parseURL).toHaveBeenCalledWith('http://rss.cnn.com/rss/cnn_topstories.rss');
    expect(result.source).toBe('cnn');
    expect(result.label).toBe('CNN');
    expect(result.items).toHaveLength(3);
  });

  test('extracts desc from contentSnippet', async () => {
    const result = await harvester.harvest({
      id: 'cnn',
      label: 'CNN',
      url: 'http://rss.cnn.com/rss/cnn_topstories.rss',
    });

    expect(result.items[0].desc).toBeDefined();
    expect(result.items[0].desc.length).toBeLessThanOrEqual(123); // 120 + '...'
  });

  test('strips HTML from content for desc', async () => {
    const result = await harvester.harvest({
      id: 'cnn',
      label: 'CNN',
      url: 'http://rss.cnn.com/rss/cnn_topstories.rss',
    });

    expect(result.items[1].desc).not.toContain('<p>');
    expect(result.items[1].desc).not.toContain('</p>');
  });

  test('desc is null when no content available', async () => {
    const result = await harvester.harvest({
      id: 'cnn',
      label: 'CNN',
      url: 'http://rss.cnn.com/rss/cnn_topstories.rss',
    });

    expect(result.items[2].desc).toBeNull();
  });

  test('includes lastHarvest timestamp', async () => {
    const result = await harvester.harvest({
      id: 'cnn',
      label: 'CNN',
      url: 'http://rss.cnn.com/rss/cnn_topstories.rss',
    });

    expect(result.lastHarvest).toBeDefined();
    expect(new Date(result.lastHarvest)).toBeInstanceOf(Date);
  });

  test('returns empty items on parse failure', async () => {
    mockRssParser.parseURL.mockRejectedValue(new Error('Network error'));
    const result = await harvester.harvest({
      id: 'cnn',
      label: 'CNN',
      url: 'http://bad-url.com/rss',
    });

    expect(result.items).toHaveLength(0);
    expect(result.error).toBe('Network error');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/1_adapters/feed/RssHeadlineHarvester.mjs
/**
 * RssHeadlineHarvester
 *
 * Fetches RSS feeds and extracts lightweight headline data.
 * Used for both standalone RSS URLs and FreshRSS-sourced headline feeds.
 *
 * @module adapters/feed
 */

export class RssHeadlineHarvester {
  #rssParser;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.rssParser - rss-parser instance
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ rssParser, logger = console }) {
    this.#rssParser = rssParser;
    this.#logger = logger;
  }

  /**
   * Harvest headlines from an RSS feed
   * @param {Object} source - { id, label, url }
   * @returns {Promise<{ source, label, lastHarvest, items, error? }>}
   */
  async harvest(source) {
    try {
      const feed = await this.#rssParser.parseURL(source.url);

      const items = feed.items.map(item => ({
        title: item.title,
        desc: this.#extractDesc(item),
        link: item.link,
        timestamp: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      }));

      this.#logger.debug?.('headline.harvest.success', {
        source: source.id,
        count: items.length,
      });

      return {
        source: source.id,
        label: source.label,
        lastHarvest: new Date().toISOString(),
        items,
      };
    } catch (error) {
      this.#logger.error?.('headline.harvest.error', {
        source: source.id,
        url: source.url,
        error: error.message,
      });

      return {
        source: source.id,
        label: source.label,
        lastHarvest: new Date().toISOString(),
        items: [],
        error: error.message,
      };
    }
  }

  /**
   * Extract desc from RSS item — first 120 chars of contentSnippet or stripped content
   * @private
   */
  #extractDesc(item) {
    const raw = item.contentSnippet || this.#stripHtml(item.content) || null;
    if (!raw) return null;
    const trimmed = raw.trim();
    if (trimmed.length <= 120) return trimmed;
    return trimmed.substring(0, 120) + '...';
  }

  /**
   * Strip HTML tags from string
   * @private
   */
  #stripHtml(html) {
    if (!html) return null;
    return html.replace(/<[^>]*>/g, '').trim();
  }
}

export default RssHeadlineHarvester;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs --verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/RssHeadlineHarvester.mjs tests/isolated/adapter/feed/RssHeadlineHarvester.test.mjs
git commit -m "feat(feed): add RssHeadlineHarvester adapter"
```

---

## Task 5: HeadlineService

**Files:**
- Create: `backend/src/3_applications/feed/services/HeadlineService.mjs`
- Test: `tests/isolated/application/feed/HeadlineService.test.mjs`

**Context:** Orchestrates harvesting — reads user config, iterates sources, calls harvester, saves to store, prunes old entries.

**Step 1: Write the failing test**

```javascript
// tests/isolated/application/feed/HeadlineService.test.mjs
import { jest } from '@jest/globals';
import { HeadlineService } from '#apps/feed/services/HeadlineService.mjs';

describe('HeadlineService', () => {
  let service;
  let mockStore;
  let mockHarvester;
  let mockConfigService;
  let mockDataService;

  const userConfig = {
    headline_sources: [
      { id: 'cnn', label: 'CNN', url: 'http://rss.cnn.com/rss/cnn_topstories.rss' },
      { id: 'abc', label: 'ABC News', url: 'https://abcnews.go.com/abcnews/topstories' },
    ],
    freshrss_headline_feeds: [],
    headlines: { retention_hours: 48 },
  };

  beforeEach(() => {
    mockStore = {
      loadSource: jest.fn().mockResolvedValue(null),
      saveSource: jest.fn().mockResolvedValue(true),
      loadAllSources: jest.fn().mockResolvedValue({}),
      pruneOlderThan: jest.fn().mockResolvedValue(0),
    };
    mockHarvester = {
      harvest: jest.fn().mockResolvedValue({
        source: 'cnn',
        label: 'CNN',
        lastHarvest: new Date().toISOString(),
        items: [{ title: 'Test', link: 'https://cnn.com/1', timestamp: new Date().toISOString() }],
      }),
    };
    mockDataService = {
      user: {
        read: jest.fn().mockReturnValue(userConfig),
      },
    };
    mockConfigService = {
      getHeadOfHousehold: jest.fn().mockReturnValue('kckern'),
    };
    service = new HeadlineService({
      headlineStore: mockStore,
      harvester: mockHarvester,
      dataService: mockDataService,
      configService: mockConfigService,
    });
  });

  describe('harvestAll', () => {
    test('harvests all configured sources', async () => {
      const result = await service.harvestAll('kckern');

      expect(mockHarvester.harvest).toHaveBeenCalledTimes(2);
      expect(mockStore.saveSource).toHaveBeenCalledTimes(2);
      expect(result.harvested).toBe(2);
    });

    test('prunes old items after harvest', async () => {
      await service.harvestAll('kckern');
      expect(mockStore.pruneOlderThan).toHaveBeenCalledTimes(2);
    });

    test('continues on individual source failure', async () => {
      mockHarvester.harvest
        .mockResolvedValueOnce({ source: 'cnn', label: 'CNN', lastHarvest: new Date().toISOString(), items: [], error: 'fail' })
        .mockResolvedValueOnce({ source: 'abc', label: 'ABC', lastHarvest: new Date().toISOString(), items: [{ title: 'X' }] });

      const result = await service.harvestAll('kckern');
      expect(result.harvested).toBe(2);
      expect(result.errors).toBe(1);
    });
  });

  describe('getAllHeadlines', () => {
    test('returns all sources from store', async () => {
      mockStore.loadAllSources.mockResolvedValue({
        cnn: { source: 'cnn', label: 'CNN', items: [{ title: 'A' }] },
        abc: { source: 'abc', label: 'ABC News', items: [{ title: 'B' }] },
      });

      const result = await service.getAllHeadlines('kckern');
      expect(result.sources).toHaveProperty('cnn');
      expect(result.sources).toHaveProperty('abc');
    });
  });

  describe('getSourceHeadlines', () => {
    test('returns single source from store', async () => {
      mockStore.loadSource.mockResolvedValue({
        source: 'cnn',
        label: 'CNN',
        items: [{ title: 'A' }],
      });

      const result = await service.getSourceHeadlines('cnn', 'kckern');
      expect(result.source).toBe('cnn');
      expect(result.items).toHaveLength(1);
    });

    test('returns null for unknown source', async () => {
      mockStore.loadSource.mockResolvedValue(null);
      const result = await service.getSourceHeadlines('unknown', 'kckern');
      expect(result).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/feed/HeadlineService.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/feed/services/HeadlineService.mjs
/**
 * HeadlineService
 *
 * Orchestrates headline harvesting, caching, and retrieval.
 * Reads user config for source list, delegates to harvester and store.
 *
 * @module applications/feed/services
 */

const FEED_CONFIG_PATH = 'apps/feed/config';

export class HeadlineService {
  #headlineStore;
  #harvester;
  #dataService;
  #configService;
  #logger;

  constructor({ headlineStore, harvester, dataService, configService, logger = console }) {
    this.#headlineStore = headlineStore;
    this.#harvester = harvester;
    this.#dataService = dataService;
    this.#configService = configService;
    this.#logger = logger;
  }

  /**
   * Get user's feed config
   * @param {string} username
   * @returns {Object}
   */
  #getUserConfig(username) {
    return this.#dataService.user.read(FEED_CONFIG_PATH, username) || {};
  }

  /**
   * Get all headline sources from config (standalone + FreshRSS)
   * @param {string} username
   * @returns {Array<{ id, label, url }>}
   */
  #getSources(username) {
    const config = this.#getUserConfig(username);
    const sources = [];

    // Standalone RSS sources
    if (config.headline_sources) {
      sources.push(...config.headline_sources);
    }

    // FreshRSS headline feeds would be resolved here
    // (requires FreshRSS adapter to map feed_id to URL — future enhancement)

    return sources;
  }

  /**
   * Harvest all configured headline sources
   * @param {string} username
   * @returns {Promise<{ harvested, errors, totalItems }>}
   */
  async harvestAll(username) {
    const sources = this.#getSources(username);
    const config = this.#getUserConfig(username);
    const retentionHours = config.headlines?.retention_hours || 48;
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    let errors = 0;
    let totalItems = 0;

    for (const source of sources) {
      try {
        const result = await this.#harvester.harvest(source);
        await this.#headlineStore.saveSource(source.id, result, username);
        await this.#headlineStore.pruneOlderThan(source.id, cutoff, username);

        if (result.error) errors++;
        totalItems += result.items.length;

        this.#logger.debug?.('headline.service.harvested', {
          source: source.id,
          items: result.items.length,
        });
      } catch (error) {
        errors++;
        this.#logger.error?.('headline.service.harvest.error', {
          source: source.id,
          error: error.message,
        });
      }
    }

    this.#logger.info?.('headline.service.harvestAll.complete', {
      username,
      harvested: sources.length,
      errors,
      totalItems,
    });

    return { harvested: sources.length, errors, totalItems };
  }

  /**
   * Get all cached headlines grouped by source
   * @param {string} username
   * @returns {Promise<{ sources: Object, lastHarvest: string|null }>}
   */
  async getAllHeadlines(username) {
    const sources = await this.#headlineStore.loadAllSources(username);
    const lastHarvest = Object.values(sources)
      .map(s => s.lastHarvest)
      .filter(Boolean)
      .sort()
      .pop() || null;

    return { sources, lastHarvest };
  }

  /**
   * Get headlines for a single source
   * @param {string} sourceId
   * @param {string} username
   * @returns {Promise<Object|null>}
   */
  async getSourceHeadlines(sourceId, username) {
    return this.#headlineStore.loadSource(sourceId, username);
  }
}

export default HeadlineService;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/feed/HeadlineService.test.mjs --verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/HeadlineService.mjs tests/isolated/application/feed/HeadlineService.test.mjs
git commit -m "feat(feed): add HeadlineService for harvest orchestration"
```

---

## Task 6: FreshRSSFeedAdapter

**Files:**
- Create: `backend/src/1_adapters/feed/FreshRSSFeedAdapter.mjs`
- Test: `tests/isolated/adapter/feed/FreshRSSFeedAdapter.test.mjs`

**Context:** Wraps FreshRSS Google Reader API via the existing ProxyService. Provides structured methods: `getCategories()`, `getFeeds()`, `getItems(feedId)`, `markRead(itemIds)`. Authenticates using user's API key from `data/users/{username}/auth/freshrss.yml`. The FreshRSS GReader API base is `/api/greader.php/reader/api/0/`.

**Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/feed/FreshRSSFeedAdapter.test.mjs
import { jest } from '@jest/globals';
import { FreshRSSFeedAdapter } from '#adapters/feed/FreshRSSFeedAdapter.mjs';

describe('FreshRSSFeedAdapter', () => {
  let adapter;
  let mockFetch;
  let mockDataService;

  const freshrssHost = 'https://rss.example.com';
  const apiKey = 'test-api-key-123';

  beforeEach(() => {
    mockFetch = jest.fn();
    mockDataService = {
      user: {
        read: jest.fn().mockReturnValue({ key: apiKey }),
      },
    };
    adapter = new FreshRSSFeedAdapter({
      freshrssHost,
      dataService: mockDataService,
      fetchFn: mockFetch,
    });
  });

  describe('getCategories', () => {
    test('fetches tag list from GReader API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          tags: [
            { id: 'user/-/label/Tech', type: 'folder' },
            { id: 'user/-/label/News', type: 'folder' },
          ],
        }),
      });

      const categories = await adapter.getCategories('kckern');
      expect(mockFetch).toHaveBeenCalledWith(
        `${freshrssHost}/api/greader.php/reader/api/0/tag/list?output=json`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `GoogleLogin auth=${apiKey}`,
          }),
        })
      );
      expect(categories).toHaveLength(2);
      expect(categories[0].id).toBe('user/-/label/Tech');
    });
  });

  describe('getFeeds', () => {
    test('fetches subscription list', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          subscriptions: [
            { id: 'feed/1', title: 'Hacker News', categories: [{ id: 'user/-/label/Tech' }] },
          ],
        }),
      });

      const feeds = await adapter.getFeeds('kckern');
      expect(feeds).toHaveLength(1);
      expect(feeds[0].title).toBe('Hacker News');
    });
  });

  describe('getItems', () => {
    test('fetches stream contents for a feed', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          items: [
            {
              id: 'tag:google.com,2005:reader/item/000000000000001F',
              title: 'Test Article',
              summary: { content: '<p>Article body</p>' },
              canonical: [{ href: 'https://example.com/article' }],
              published: 1708000000,
            },
          ],
        }),
      });

      const items = await adapter.getItems('feed/1', 'kckern');
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Test Article');
      expect(items[0].link).toBe('https://example.com/article');
    });
  });

  describe('markRead', () => {
    test('sends edit-tag request', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

      await adapter.markRead(['item-id-1'], 'kckern');
      expect(mockFetch).toHaveBeenCalledWith(
        `${freshrssHost}/api/greader.php/reader/api/0/edit-tag`,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('auth', () => {
    test('reads API key from user auth file', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ tags: [] }) });
      await adapter.getCategories('kckern');
      expect(mockDataService.user.read).toHaveBeenCalledWith('auth/freshrss', 'kckern');
    });

    test('throws when no API key configured', async () => {
      mockDataService.user.read.mockReturnValue(null);
      await expect(adapter.getCategories('kckern')).rejects.toThrow('FreshRSS API key not configured');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/FreshRSSFeedAdapter.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/1_adapters/feed/FreshRSSFeedAdapter.mjs
/**
 * FreshRSSFeedAdapter
 *
 * Wraps FreshRSS Google Reader API for structured feed access.
 * Authenticates per-user via API key from auth/freshrss.yml.
 *
 * GReader API base: /api/greader.php/reader/api/0/
 *
 * @module adapters/feed
 */

const GREADER_BASE = '/api/greader.php/reader/api/0';

export class FreshRSSFeedAdapter {
  #freshrssHost;
  #dataService;
  #fetchFn;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.freshrssHost - FreshRSS server URL
   * @param {Object} config.dataService - DataService for reading user auth
   * @param {Function} [config.fetchFn] - fetch implementation (for testing)
   * @param {Object} [config.logger]
   */
  constructor({ freshrssHost, dataService, fetchFn, logger = console }) {
    this.#freshrssHost = freshrssHost;
    this.#dataService = dataService;
    this.#fetchFn = fetchFn || globalThis.fetch;
    this.#logger = logger;
  }

  /**
   * Get API key for user
   * @private
   */
  #getApiKey(username) {
    const auth = this.#dataService.user.read('auth/freshrss', username);
    if (!auth?.key) throw new Error('FreshRSS API key not configured');
    return auth.key;
  }

  /**
   * Make authenticated GReader API request
   * @private
   */
  async #greaderRequest(path, username, options = {}) {
    const apiKey = this.#getApiKey(username);
    const url = `${this.#freshrssHost}${GREADER_BASE}${path}`;
    const response = await this.#fetchFn(url, {
      ...options,
      headers: {
        'Authorization': `GoogleLogin auth=${apiKey}`,
        ...options.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`FreshRSS API error: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Get categories/folders
   * @param {string} username
   * @returns {Promise<Array<{ id, type }>>}
   */
  async getCategories(username) {
    const data = await this.#greaderRequest('/tag/list?output=json', username);
    return data.tags || [];
  }

  /**
   * Get subscribed feeds
   * @param {string} username
   * @returns {Promise<Array<{ id, title, categories, url }>>}
   */
  async getFeeds(username) {
    const data = await this.#greaderRequest('/subscription/list?output=json', username);
    return data.subscriptions || [];
  }

  /**
   * Get items for a feed/category stream
   * @param {string} streamId - e.g., 'feed/1' or 'user/-/label/Tech'
   * @param {string} username
   * @param {Object} [options] - { count, continuation, excludeRead }
   * @returns {Promise<Array>}
   */
  async getItems(streamId, username, options = {}) {
    const count = options.count || 50;
    const exclude = options.excludeRead ? '&xt=user/-/state/com.google/read' : '';
    const cont = options.continuation ? `&c=${options.continuation}` : '';
    const path = `/stream/contents/${encodeURIComponent(streamId)}?output=json&n=${count}${exclude}${cont}`;

    const data = await this.#greaderRequest(path, username);

    return (data.items || []).map(item => ({
      id: item.id,
      title: item.title,
      content: item.summary?.content || '',
      link: item.canonical?.[0]?.href || item.alternate?.[0]?.href || '',
      published: item.published ? new Date(item.published * 1000) : null,
      author: item.author || null,
      feedTitle: item.origin?.title || null,
      feedId: item.origin?.streamId || null,
      categories: item.categories || [],
    }));
  }

  /**
   * Mark items as read
   * @param {string[]} itemIds - GReader item IDs
   * @param {string} username
   */
  async markRead(itemIds, username) {
    const body = new URLSearchParams();
    body.append('a', 'user/-/state/com.google/read');
    for (const id of itemIds) {
      body.append('i', id);
    }

    await this.#greaderRequest('/edit-tag', username, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  /**
   * Mark items as unread
   * @param {string[]} itemIds
   * @param {string} username
   */
  async markUnread(itemIds, username) {
    const body = new URLSearchParams();
    body.append('r', 'user/-/state/com.google/read');
    for (const id of itemIds) {
      body.append('i', id);
    }

    await this.#greaderRequest('/edit-tag', username, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }
}

export default FreshRSSFeedAdapter;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/adapter/feed/FreshRSSFeedAdapter.test.mjs --verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/FreshRSSFeedAdapter.mjs tests/isolated/adapter/feed/FreshRSSFeedAdapter.test.mjs
git commit -m "feat(feed): add FreshRSSFeedAdapter for Google Reader API"
```

---

## Task 7: Feed API Router

**Files:**
- Create: `backend/src/4_api/v1/routers/feed.mjs`
- Test: `tests/isolated/api/feed/feed.router.test.mjs`

**Context:** Follows the `createEntropyRouter` pattern. Three sub-groups: `/reader/*` (FreshRSS proxy), `/headlines/*` (cached headlines), `/scroll/*` (merged feed). Mounted at `/api/v1/feed`.

**Step 1: Write the failing test**

```javascript
// tests/isolated/api/feed/feed.router.test.mjs
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createFeedRouter } from '#api/v1/routers/feed.mjs';

describe('Feed Router', () => {
  let app;
  let mockFreshRSSAdapter;
  let mockHeadlineService;
  let mockConfigService;

  beforeEach(() => {
    mockFreshRSSAdapter = {
      getCategories: jest.fn().mockResolvedValue([
        { id: 'user/-/label/Tech', type: 'folder' },
      ]),
      getFeeds: jest.fn().mockResolvedValue([
        { id: 'feed/1', title: 'Hacker News', categories: [] },
      ]),
      getItems: jest.fn().mockResolvedValue([
        { id: 'item1', title: 'Test Article', link: 'https://example.com', content: '<p>Body</p>' },
      ]),
      markRead: jest.fn().mockResolvedValue(undefined),
    };
    mockHeadlineService = {
      getAllHeadlines: jest.fn().mockResolvedValue({
        sources: {
          cnn: { source: 'cnn', label: 'CNN', items: [{ title: 'News', link: 'https://cnn.com/1' }] },
        },
        lastHarvest: '2026-02-15T10:00:00Z',
      }),
      getSourceHeadlines: jest.fn().mockResolvedValue({
        source: 'cnn',
        label: 'CNN',
        items: [{ title: 'News' }],
      }),
      harvestAll: jest.fn().mockResolvedValue({ harvested: 2, errors: 0, totalItems: 15 }),
    };
    mockConfigService = {
      getHeadOfHousehold: jest.fn().mockReturnValue('kckern'),
    };

    const router = createFeedRouter({
      freshRSSAdapter: mockFreshRSSAdapter,
      headlineService: mockHeadlineService,
      configService: mockConfigService,
    });

    app = express();
    app.use(express.json());
    app.use('/api/v1/feed', router);
  });

  // Reader endpoints
  describe('GET /reader/categories', () => {
    test('returns FreshRSS categories', async () => {
      const res = await request(app).get('/api/v1/feed/reader/categories');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(mockFreshRSSAdapter.getCategories).toHaveBeenCalledWith('kckern');
    });
  });

  describe('GET /reader/feeds', () => {
    test('returns FreshRSS subscriptions', async () => {
      const res = await request(app).get('/api/v1/feed/reader/feeds');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe('GET /reader/items', () => {
    test('returns items for a feed', async () => {
      const res = await request(app).get('/api/v1/feed/reader/items?feed=feed/1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(mockFreshRSSAdapter.getItems).toHaveBeenCalledWith('feed/1', 'kckern', expect.any(Object));
    });

    test('returns 400 without feed param', async () => {
      const res = await request(app).get('/api/v1/feed/reader/items');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /reader/items/mark', () => {
    test('marks items read', async () => {
      const res = await request(app)
        .post('/api/v1/feed/reader/items/mark')
        .send({ itemIds: ['item1'], action: 'read' });
      expect(res.status).toBe(200);
      expect(mockFreshRSSAdapter.markRead).toHaveBeenCalledWith(['item1'], 'kckern');
    });
  });

  // Headlines endpoints
  describe('GET /headlines', () => {
    test('returns all cached headlines', async () => {
      const res = await request(app).get('/api/v1/feed/headlines');
      expect(res.status).toBe(200);
      expect(res.body.sources).toHaveProperty('cnn');
      expect(mockHeadlineService.getAllHeadlines).toHaveBeenCalledWith('kckern');
    });
  });

  describe('GET /headlines/:source', () => {
    test('returns headlines for one source', async () => {
      const res = await request(app).get('/api/v1/feed/headlines/cnn');
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('cnn');
    });

    test('returns 404 for unknown source', async () => {
      mockHeadlineService.getSourceHeadlines.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/feed/headlines/unknown');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /headlines/harvest', () => {
    test('triggers manual harvest', async () => {
      const res = await request(app).post('/api/v1/feed/headlines/harvest');
      expect(res.status).toBe(200);
      expect(res.body.harvested).toBe(2);
      expect(mockHeadlineService.harvestAll).toHaveBeenCalledWith('kckern');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/api/feed/feed.router.test.mjs --verbose`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/4_api/v1/routers/feed.mjs
/**
 * Feed API Router
 *
 * Three sub-groups:
 * - /reader/*  — FreshRSS Google Reader API proxy
 * - /headlines/* — Cached headline data
 * - /scroll/*  — Merged chronological feed (boonscrolling skeleton)
 *
 * @module api/v1/routers/feed
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * @param {Object} config
 * @param {Object} config.freshRSSAdapter - FreshRSSFeedAdapter instance
 * @param {Object} config.headlineService - HeadlineService instance
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createFeedRouter(config) {
  const { freshRSSAdapter, headlineService, configService, logger = console } = config;
  const router = express.Router();

  router.use(express.json());

  const getUsername = () => {
    return configService?.getHeadOfHousehold?.() || 'default';
  };

  // =========================================================================
  // Reader (FreshRSS proxy)
  // =========================================================================

  router.get('/reader/categories', asyncHandler(async (req, res) => {
    const username = getUsername();
    const categories = await freshRSSAdapter.getCategories(username);
    res.json(categories);
  }));

  router.get('/reader/feeds', asyncHandler(async (req, res) => {
    const username = getUsername();
    const feeds = await freshRSSAdapter.getFeeds(username);
    res.json(feeds);
  }));

  router.get('/reader/items', asyncHandler(async (req, res) => {
    const { feed, count, continuation, excludeRead } = req.query;
    if (!feed) {
      return res.status(400).json({ error: 'feed parameter required' });
    }
    const username = getUsername();
    const items = await freshRSSAdapter.getItems(feed, username, {
      count: count ? Number(count) : undefined,
      continuation,
      excludeRead: excludeRead === 'true',
    });
    res.json(items);
  }));

  router.post('/reader/items/mark', asyncHandler(async (req, res) => {
    const { itemIds, action } = req.body;
    const username = getUsername();

    if (action === 'read') {
      await freshRSSAdapter.markRead(itemIds, username);
    } else if (action === 'unread') {
      await freshRSSAdapter.markUnread(itemIds, username);
    } else {
      return res.status(400).json({ error: 'action must be "read" or "unread"' });
    }

    res.json({ ok: true });
  }));

  // =========================================================================
  // Headlines (cached)
  // =========================================================================

  router.get('/headlines', asyncHandler(async (req, res) => {
    const username = getUsername();
    const result = await headlineService.getAllHeadlines(username);
    res.json(result);
  }));

  router.get('/headlines/:source', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const username = getUsername();
    const result = await headlineService.getSourceHeadlines(source, username);

    if (!result) {
      return res.status(404).json({ error: 'Source not found', source });
    }

    res.json(result);
  }));

  router.post('/headlines/harvest', asyncHandler(async (req, res) => {
    const username = getUsername();
    const result = await headlineService.harvestAll(username);
    res.json(result);
  }));

  // =========================================================================
  // Scroll (merged feed — skeleton)
  // =========================================================================

  router.get('/scroll', asyncHandler(async (req, res) => {
    const username = getUsername();
    const { cursor, limit = 20 } = req.query;

    // Phase 1: merge FreshRSS unread + headline cache chronologically
    const [rssItems, headlines] = await Promise.all([
      freshRSSAdapter.getItems('user/-/state/com.google/reading-list', username, {
        count: Number(limit),
        continuation: cursor,
        excludeRead: true,
      }),
      headlineService.getAllHeadlines(username),
    ]);

    // Flatten headline items with source metadata
    const headlineItems = Object.values(headlines.sources || {}).flatMap(src =>
      (src.items || []).map(item => ({
        id: `headline:${src.source}:${item.link}`,
        type: 'headline',
        source: src.source,
        sourceLabel: src.label,
        title: item.title,
        desc: item.desc || null,
        link: item.link,
        timestamp: item.timestamp,
      }))
    );

    // Map RSS items to common format
    const rssItemsMapped = rssItems.map(item => ({
      id: item.id,
      type: 'article',
      source: 'freshrss',
      sourceLabel: item.feedTitle,
      title: item.title,
      desc: null,
      link: item.link,
      content: item.content,
      timestamp: item.published?.toISOString() || new Date().toISOString(),
    }));

    // Merge and sort by timestamp descending
    const merged = [...rssItemsMapped, ...headlineItems]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, Number(limit));

    res.json({
      items: merged,
      hasMore: rssItems.length >= Number(limit),
    });
  }));

  // =========================================================================
  // Error handler
  // =========================================================================

  router.use((err, req, res, next) => {
    logger.error?.('feed.router.error', { error: err.message, url: req.url });
    res.status(500).json({ error: err.message });
  });

  return router;
}

export default createFeedRouter;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/api/feed/feed.router.test.mjs --verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/feed.mjs tests/isolated/api/feed/feed.router.test.mjs
git commit -m "feat(feed): add feed API router with reader, headlines, scroll endpoints"
```

---

## Task 8: Bootstrap Wiring + Router Mounting

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` — add `createFeedServices()` factory
- Modify: `backend/src/4_api/v1/routers/index.mjs` — export `createFeedRouter`
- Modify: `backend/src/4_api/v1/routers/api.mjs` — add `/feed` to routeMap
- Modify: `backend/src/app.mjs` — create feed services and mount router

**Step 1: Add export to router index**

In `backend/src/4_api/v1/routers/index.mjs`, add:

```javascript
// Domain routers - Feed
export { createFeedRouter } from './feed.mjs';
```

**Step 2: Add `/feed` to route map**

In `backend/src/4_api/v1/routers/api.mjs`, add to the `routeMap` object:

```javascript
'/feed': 'feed',
```

**Step 3: Add `createFeedServices()` to bootstrap.mjs**

Add this factory function to `backend/src/0_system/bootstrap.mjs`:

```javascript
// Near top — imports
import { FreshRSSFeedAdapter } from '#adapters/feed/FreshRSSFeedAdapter.mjs';
import { RssHeadlineHarvester } from '#adapters/feed/RssHeadlineHarvester.mjs';
import { YamlHeadlineCacheStore } from '#adapters/persistence/yaml/YamlHeadlineCacheStore.mjs';
import { HeadlineService } from '#apps/feed/services/HeadlineService.mjs';
import { createFeedRouter } from '#api/v1/routers/feed.mjs';
import RSSParser from 'rss-parser';

// Factory function
/**
 * Create feed domain services
 * @param {Object} config
 * @param {Object} config.dataService
 * @param {Object} config.configService
 * @param {string} config.freshrssHost - FreshRSS server URL
 * @param {Object} [config.logger]
 * @returns {{ freshRSSAdapter, headlineService, feedRouter, headlineHarvestJob }}
 */
export function createFeedServices(config) {
  const { dataService, configService, freshrssHost, logger = console } = config;

  const freshRSSAdapter = new FreshRSSFeedAdapter({
    freshrssHost,
    dataService,
    logger,
  });

  const rssParser = new RSSParser();
  const harvester = new RssHeadlineHarvester({ rssParser, logger });

  const headlineStore = new YamlHeadlineCacheStore({ dataService, logger });

  const headlineService = new HeadlineService({
    headlineStore,
    harvester,
    dataService,
    configService,
    logger,
  });

  const feedRouter = createFeedRouter({
    freshRSSAdapter,
    headlineService,
    configService,
    logger,
  });

  // Harvest job for scheduler
  const headlineHarvestJob = async () => {
    const username = configService.getHeadOfHousehold();
    return headlineService.harvestAll(username);
  };

  return { freshRSSAdapter, headlineService, feedRouter, headlineHarvestJob };
}
```

**Step 4: Wire in app.mjs**

Add to `backend/src/app.mjs` — find where other routers are created (near the `v1Routers` object) and add:

```javascript
// Import at top
import { createFeedServices } from './0_system/bootstrap.mjs';

// Near other service creation (before v1Routers)
const freshrssConfig = configService.getServiceUrl('freshrss');
const feedServices = freshrssConfig ? createFeedServices({
  dataService,
  configService,
  freshrssHost: freshrssConfig,
  logger: rootLogger.child({ module: 'feed' }),
}) : null;

// Register harvest job if feed services exist
if (feedServices && taskRegistry) {
  taskRegistry.register('feed:harvest-headlines', {
    schedule: '0 * * * *',
    handler: feedServices.headlineHarvestJob,
  });
}

// Add to v1Routers object:
// feed: feedServices?.feedRouter,
```

**Step 5: Verify server starts without error**

Run: `node backend/index.js` (or check dev server logs)
Expected: Server starts, `/api/v1/feed` routes are mounted

**Step 6: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/4_api/v1/routers/index.mjs backend/src/4_api/v1/routers/api.mjs backend/src/app.mjs
git commit -m "feat(feed): wire feed services in bootstrap and mount router"
```

---

## Task 9: User Config Seed + Live Integration Test

**Files:**
- Create: `data/users/kckern/apps/feed/config.yml` (via Dropbox data path)
- Test: `tests/integrated/api/feed/feed.api.test.mjs`

**Context:** Seed the initial config with CNN and ABC News headline sources. Write an integration test that hits the running dev server.

**Step 1: Create user config file**

Write to the Dropbox data path (where user data lives):

```yaml
# data/users/kckern/apps/feed/config.yml

headline_sources:
  - id: cnn
    label: "CNN Top Stories"
    url: "http://rss.cnn.com/rss/cnn_topstories.rss"
  - id: abc
    label: "ABC News Top Stories"
    url: "https://abcnews.go.com/abcnews/topstories"

freshrss_headline_feeds: []

headlines:
  retention_hours: 48
  harvest_interval_minutes: 60

scroll:
  batch_size: 20
  sources:
    - freshrss
    - headlines
```

**Step 2: Write integration test**

```javascript
// tests/integrated/api/feed/feed.api.test.mjs
import { getAppPort } from '#testlib/configHelper.mjs';

const port = getAppPort();
const BASE = `http://localhost:${port}/api/v1/feed`;

describe('Feed API (integrated)', () => {
  // Reader endpoints (require FreshRSS to be reachable)
  describe('Reader', () => {
    test('GET /reader/categories returns array', async () => {
      const res = await fetch(`${BASE}/reader/categories`);
      // May fail if FreshRSS is unreachable — that's OK for this test
      if (res.ok) {
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
      } else {
        expect(res.status).toBe(500); // FreshRSS down
      }
    });

    test('GET /reader/feeds returns array', async () => {
      const res = await fetch(`${BASE}/reader/feeds`);
      if (res.ok) {
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
      }
    });

    test('GET /reader/items requires feed param', async () => {
      const res = await fetch(`${BASE}/reader/items`);
      expect(res.status).toBe(400);
    });
  });

  // Headlines endpoints
  describe('Headlines', () => {
    test('POST /headlines/harvest triggers harvest', async () => {
      const res = await fetch(`${BASE}/headlines/harvest`, { method: 'POST' });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.harvested).toBeGreaterThanOrEqual(0);
    }, 30000);

    test('GET /headlines returns sources after harvest', async () => {
      const res = await fetch(`${BASE}/headlines`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.sources).toBeDefined();
    });

    test('GET /headlines/cnn returns CNN headlines', async () => {
      const res = await fetch(`${BASE}/headlines/cnn`);
      // May be 404 if harvest hasn't run yet
      if (res.ok) {
        const data = await res.json();
        expect(data.source).toBe('cnn');
        expect(data.items.length).toBeGreaterThan(0);
      }
    });

    test('GET /headlines/nonexistent returns 404', async () => {
      const res = await fetch(`${BASE}/headlines/nonexistent`);
      expect(res.status).toBe(404);
    });
  });

  // Scroll endpoints
  describe('Scroll', () => {
    test('GET /scroll returns items array', async () => {
      const res = await fetch(`${BASE}/scroll?limit=5`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.items)).toBe(true);
      expect(data).toHaveProperty('hasMore');
    });
  });
});
```

**Step 3: Run harvest manually via curl to verify real data**

Run: `curl -X POST http://localhost:3112/api/v1/feed/headlines/harvest | jq .`
Expected: `{ "harvested": 2, "errors": 0, "totalItems": <number> }`

Run: `curl http://localhost:3112/api/v1/feed/headlines | jq '.sources | keys'`
Expected: `["abc", "cnn"]`

Run: `curl http://localhost:3112/api/v1/feed/headlines/cnn | jq '.items[0]'`
Expected: A headline object with `title`, `desc`, `link`, `timestamp`

**Step 4: Run integration tests**

Run: `npx jest tests/integrated/api/feed/feed.api.test.mjs --verbose`
Expected: PASS (headlines tests pass; reader tests may gracefully handle FreshRSS being unreachable)

**Step 5: Commit**

```bash
git add tests/integrated/api/feed/feed.api.test.mjs
# Config file is in Dropbox data dir, not in git
git commit -m "feat(feed): add integration tests and seed headline config"
```

---

## Task 10: Frontend — FeedApp Shell + Routes

**Files:**
- Create: `frontend/src/Apps/FeedApp.jsx`
- Create: `frontend/src/Apps/FeedApp.scss`
- Modify: `frontend/src/main.jsx` — add `/feed/*` route

**Context:** Follows AdminApp pattern — nested `<Routes>` with `<Outlet />`. Tab bar uses React Router `NavLink`. Three child routes: reader, headlines, scroll.

**Step 1: Create FeedApp shell**

```jsx
// frontend/src/Apps/FeedApp.jsx
import { useMemo } from 'react';
import { Routes, Route, NavLink, Navigate, Outlet } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import './FeedApp.scss';

function FeedLayout() {
  return (
    <div className="feed-app">
      <nav className="feed-tabs">
        <NavLink to="/feed/reader" className={({ isActive }) => isActive ? 'active' : ''}>
          Reader
        </NavLink>
        <NavLink to="/feed/headlines" className={({ isActive }) => isActive ? 'active' : ''}>
          Headlines
        </NavLink>
        <NavLink to="/feed/scroll" className={({ isActive }) => isActive ? 'active' : ''}>
          Scroll
        </NavLink>
      </nav>
      <div className="feed-content">
        <Outlet />
      </div>
    </div>
  );
}

function ReaderPlaceholder() {
  return <div className="feed-placeholder">Reader — coming next</div>;
}

function HeadlinesPlaceholder() {
  return <div className="feed-placeholder">Headlines — coming next</div>;
}

function ScrollPlaceholder() {
  return <div className="feed-placeholder">Scroll — coming next</div>;
}

const FeedApp = () => {
  return (
    <MantineProvider>
      <Routes>
        <Route element={<FeedLayout />}>
          <Route index element={<Navigate to="/feed/reader" replace />} />
          <Route path="reader" element={<ReaderPlaceholder />} />
          <Route path="headlines" element={<HeadlinesPlaceholder />} />
          <Route path="scroll" element={<ScrollPlaceholder />} />
        </Route>
      </Routes>
    </MantineProvider>
  );
};

export default FeedApp;
```

**Step 2: Create base SCSS**

```scss
// frontend/src/Apps/FeedApp.scss
.feed-app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8f9fa;
}

.feed-tabs {
  display: flex;
  gap: 0;
  background: #1a1b1e;
  padding: 0 1rem;

  a {
    padding: 0.75rem 1.5rem;
    color: #888;
    text-decoration: none;
    font-weight: 500;
    font-size: 0.9rem;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;

    &:hover {
      color: #ccc;
    }

    &.active {
      color: #fff;
      border-bottom-color: #228be6;
    }
  }
}

.feed-content {
  flex: 1;
  overflow-y: auto;
}

.feed-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 50vh;
  color: #888;
  font-size: 1.2rem;
}
```

**Step 3: Add route to main.jsx**

In `frontend/src/main.jsx`, add import and route:

```javascript
// Import (near other App imports)
import FeedApp from './Apps/FeedApp.jsx';

// Route (inside <Routes>, before the catch-all)
<Route path="/feed/*" element={<FeedApp />} />
```

**Step 4: Verify in browser**

Navigate to `http://localhost:3111/feed`
Expected: Tab bar with Reader/Headlines/Scroll, redirects to `/feed/reader`, tabs switch between placeholder views

**Step 5: Commit**

```bash
git add frontend/src/Apps/FeedApp.jsx frontend/src/Apps/FeedApp.scss frontend/src/main.jsx
git commit -m "feat(feed): add FeedApp shell with tab navigation and routes"
```

---

## Task 11: Frontend — Headlines View

**Files:**
- Create: `frontend/src/modules/Feed/Headlines/Headlines.jsx`
- Create: `frontend/src/modules/Feed/Headlines/SourcePanel.jsx`
- Create: `frontend/src/modules/Feed/Headlines/Headlines.scss`
- Modify: `frontend/src/Apps/FeedApp.jsx` — replace placeholder

**Step 1: Create SourcePanel component**

```jsx
// frontend/src/modules/Feed/Headlines/SourcePanel.jsx
import './Headlines.scss';

export function SourcePanel({ source, label, items }) {
  return (
    <div className="source-panel">
      <div className="source-panel-header">
        <h3>{label}</h3>
        <span className="source-panel-count">{items.length}</span>
      </div>
      <div className="source-panel-items">
        {items.map((item, i) => (
          <a
            key={i}
            className="headline-row"
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="headline-title">{item.title}</span>
            {item.desc && <span className="headline-desc">{item.desc}</span>}
          </a>
        ))}
        {items.length === 0 && (
          <div className="headline-empty">No headlines</div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create Headlines container**

```jsx
// frontend/src/modules/Feed/Headlines/Headlines.jsx
import { useState, useEffect } from 'react';
import { SourcePanel } from './SourcePanel.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';
import './Headlines.scss';

export default function Headlines() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [harvesting, setHarvesting] = useState(false);

  const fetchHeadlines = async () => {
    try {
      const result = await DaylightAPI('/api/v1/feed/headlines');
      setData(result);
    } catch (err) {
      console.error('Failed to fetch headlines:', err);
    } finally {
      setLoading(false);
    }
  };

  const triggerHarvest = async () => {
    setHarvesting(true);
    try {
      await DaylightAPI('/api/v1/feed/headlines/harvest', {}, 'POST');
      await fetchHeadlines();
    } catch (err) {
      console.error('Harvest failed:', err);
    } finally {
      setHarvesting(false);
    }
  };

  useEffect(() => { fetchHeadlines(); }, []);

  if (loading) return <div className="feed-placeholder">Loading headlines...</div>;

  const sources = data?.sources || {};
  const sourceKeys = Object.keys(sources);

  return (
    <div className="headlines-view">
      <div className="headlines-toolbar">
        <span className="headlines-meta">
          {sourceKeys.length} sources
          {data?.lastHarvest && ` \u00b7 Last updated ${new Date(data.lastHarvest).toLocaleTimeString()}`}
        </span>
        <button
          className="headlines-harvest-btn"
          onClick={triggerHarvest}
          disabled={harvesting}
        >
          {harvesting ? 'Harvesting...' : 'Refresh'}
        </button>
      </div>
      <div className="headlines-grid">
        {sourceKeys.map(key => (
          <SourcePanel
            key={key}
            source={key}
            label={sources[key].label}
            items={sources[key].items || []}
          />
        ))}
        {sourceKeys.length === 0 && (
          <div className="feed-placeholder">
            No headline sources configured. Run a harvest first.
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Create Headlines SCSS**

```scss
// frontend/src/modules/Feed/Headlines/Headlines.scss
.headlines-view {
  padding: 1rem;
}

.headlines-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding: 0.5rem 0;
}

.headlines-meta {
  color: #666;
  font-size: 0.85rem;
}

.headlines-harvest-btn {
  padding: 0.4rem 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 0.85rem;

  &:hover { background: #f0f0f0; }
  &:disabled { opacity: 0.5; cursor: default; }
}

.headlines-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 1rem;
}

.source-panel {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}

.source-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 1rem;
  background: #1a1b1e;
  color: #fff;

  h3 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
  }
}

.source-panel-count {
  font-size: 0.75rem;
  color: #888;
}

.source-panel-items {
  max-height: 400px;
  overflow-y: auto;
}

.headline-row {
  display: block;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #f0f0f0;
  text-decoration: none;
  color: inherit;

  &:hover { background: #f8f9fa; }
  &:last-child { border-bottom: none; }
}

.headline-title {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  color: #1a1b1e;
  line-height: 1.3;
}

.headline-desc {
  display: block;
  font-size: 0.75rem;
  color: #888;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.headline-empty {
  padding: 1rem;
  text-align: center;
  color: #aaa;
  font-size: 0.85rem;
}
```

**Step 4: Update FeedApp.jsx**

Replace `HeadlinesPlaceholder` import with real component:

```jsx
// Replace the placeholder function with import
import Headlines from '../modules/Feed/Headlines/Headlines.jsx';

// In the Routes, replace HeadlinesPlaceholder with Headlines:
<Route path="headlines" element={<Headlines />} />
```

**Step 5: Verify in browser**

Navigate to `http://localhost:3111/feed/headlines`
Expected: Grid of source panels (CNN, ABC) with real headlines. Refresh button triggers harvest.

**Step 6: Commit**

```bash
git add frontend/src/modules/Feed/Headlines/ frontend/src/Apps/FeedApp.jsx
git commit -m "feat(feed): add Headlines view with source panels and live data"
```

---

## Task 12: Frontend — Scroll View

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/Scroll.jsx`
- Create: `frontend/src/modules/Feed/Scroll/ScrollCard.jsx`
- Create: `frontend/src/modules/Feed/Scroll/Scroll.scss`
- Modify: `frontend/src/Apps/FeedApp.jsx` — replace placeholder

**Step 1: Create ScrollCard**

```jsx
// frontend/src/modules/Feed/Scroll/ScrollCard.jsx
import './Scroll.scss';

export function ScrollCard({ item }) {
  const age = getAge(item.timestamp);

  return (
    <a
      className={`scroll-card scroll-card--${item.type}`}
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="scroll-card-source">
        <span className="scroll-card-source-label">{item.sourceLabel || item.source}</span>
        <span className="scroll-card-age">{age}</span>
      </div>
      <h3 className="scroll-card-title">{item.title}</h3>
      {item.desc && <p className="scroll-card-desc">{item.desc}</p>}
    </a>
  );
}

function getAge(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
```

**Step 2: Create Scroll container with infinite scroll**

```jsx
// frontend/src/modules/Feed/Scroll/Scroll.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { ScrollCard } from './ScrollCard.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';
import './Scroll.scss';

export default function Scroll() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef(null);
  const sentinelRef = useRef(null);

  const fetchItems = useCallback(async (append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const cursor = append && items.length > 0 ? items[items.length - 1].id : undefined;
      const params = cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20';
      const result = await DaylightAPI(`/api/v1/feed/scroll${params}`);

      if (append) {
        setItems(prev => [...prev, ...result.items]);
      } else {
        setItems(result.items);
      }
      setHasMore(result.hasMore);
    } catch (err) {
      console.error('Failed to fetch scroll items:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [items]);

  useEffect(() => { fetchItems(); }, []);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loadingMore) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingMore) {
          fetchItems(true);
        }
      },
      { threshold: 0.1 }
    );

    observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [hasMore, loadingMore, fetchItems]);

  if (loading) return <div className="feed-placeholder">Loading feed...</div>;

  return (
    <div className="scroll-view">
      <div className="scroll-items">
        {items.map((item, i) => (
          <ScrollCard key={item.id || i} item={item} />
        ))}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="scroll-sentinel">
          {loadingMore && <div className="scroll-loading">Loading more...</div>}
        </div>
      )}
      {!hasMore && items.length > 0 && (
        <div className="scroll-end">You've reached the end</div>
      )}
      {!hasMore && items.length === 0 && (
        <div className="feed-placeholder">No feed items. Try harvesting headlines first.</div>
      )}
    </div>
  );
}
```

**Step 3: Create Scroll SCSS**

```scss
// frontend/src/modules/Feed/Scroll/Scroll.scss
.scroll-view {
  max-width: 600px;
  margin: 0 auto;
  padding: 1rem;
}

.scroll-items {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.scroll-card {
  display: block;
  padding: 1rem;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  text-decoration: none;
  color: inherit;

  &:hover { border-color: #228be6; }
}

.scroll-card-source {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.4rem;
}

.scroll-card-source-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #228be6;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.scroll-card-age {
  font-size: 0.7rem;
  color: #999;
}

.scroll-card-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.3;
  color: #1a1b1e;
}

.scroll-card-desc {
  margin: 0.3rem 0 0;
  font-size: 0.85rem;
  color: #666;
  line-height: 1.4;
}

.scroll-card--headline {
  border-left: 3px solid #fab005;
}

.scroll-card--article {
  border-left: 3px solid #228be6;
}

.scroll-sentinel {
  height: 100px;
}

.scroll-loading,
.scroll-end {
  text-align: center;
  padding: 1rem;
  color: #999;
  font-size: 0.85rem;
}
```

**Step 4: Update FeedApp.jsx**

Replace `ScrollPlaceholder` with import:

```jsx
import Scroll from '../modules/Feed/Scroll/Scroll.jsx';

// In Routes:
<Route path="scroll" element={<Scroll />} />
```

**Step 5: Verify in browser**

Navigate to `http://localhost:3111/feed/scroll`
Expected: Chronological cards from FreshRSS + headlines, infinite scroll loads more

**Step 6: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/ frontend/src/Apps/FeedApp.jsx
git commit -m "feat(feed): add Scroll view with infinite scroll and ScrollCards"
```

---

## Task 13: Frontend — Reader View

**Files:**
- Create: `frontend/src/modules/Feed/Reader/Reader.jsx`
- Create: `frontend/src/modules/Feed/Reader/Reader.scss`
- Modify: `frontend/src/Apps/FeedApp.jsx` — replace placeholder

**Step 1: Create Reader component (three-pane)**

```jsx
// frontend/src/modules/Feed/Reader/Reader.jsx
import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import './Reader.scss';

export default function Reader() {
  const [feeds, setFeeds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedFeed, setSelectedFeed] = useState(null);
  const [articles, setArticles] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const [cats, subs] = await Promise.all([
          DaylightAPI('/api/v1/feed/reader/categories'),
          DaylightAPI('/api/v1/feed/reader/feeds'),
        ]);
        setCategories(cats || []);
        setFeeds(subs || []);
      } catch (err) {
        console.error('Failed to load feeds:', err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const loadArticles = async (feedId) => {
    setSelectedFeed(feedId);
    setSelectedArticle(null);
    try {
      const items = await DaylightAPI(`/api/v1/feed/reader/items?feed=${encodeURIComponent(feedId)}&excludeRead=true`);
      setArticles(items || []);
    } catch (err) {
      console.error('Failed to load articles:', err);
      setArticles([]);
    }
  };

  const selectArticle = async (article) => {
    setSelectedArticle(article);
    // Mark as read
    try {
      await DaylightAPI('/api/v1/feed/reader/items/mark', { itemIds: [article.id], action: 'read' }, 'POST');
    } catch (err) {
      console.error('Failed to mark read:', err);
    }
  };

  if (loading) return <div className="feed-placeholder">Loading feeds...</div>;

  return (
    <div className="reader-view">
      <div className="reader-sidebar">
        <h4 className="reader-sidebar-title">Feeds</h4>
        {feeds.map(feed => (
          <button
            key={feed.id}
            className={`reader-feed-item ${selectedFeed === feed.id ? 'active' : ''}`}
            onClick={() => loadArticles(feed.id)}
          >
            {feed.title}
          </button>
        ))}
        {feeds.length === 0 && (
          <div className="reader-empty">No FreshRSS feeds found</div>
        )}
      </div>

      <div className="reader-articles">
        {selectedFeed ? (
          articles.length > 0 ? (
            articles.map((article, i) => (
              <button
                key={article.id || i}
                className={`reader-article-item ${selectedArticle?.id === article.id ? 'active' : ''}`}
                onClick={() => selectArticle(article)}
              >
                <span className="reader-article-title">{article.title}</span>
                <span className="reader-article-meta">
                  {article.author && `${article.author} · `}
                  {article.published && new Date(article.published).toLocaleDateString()}
                </span>
              </button>
            ))
          ) : (
            <div className="reader-empty">No unread articles</div>
          )
        ) : (
          <div className="reader-empty">Select a feed</div>
        )}
      </div>

      <div className="reader-content">
        {selectedArticle ? (
          <>
            <h2 className="reader-content-title">{selectedArticle.title}</h2>
            <div className="reader-content-meta">
              {selectedArticle.feedTitle && <span>{selectedArticle.feedTitle}</span>}
              {selectedArticle.author && <span> · {selectedArticle.author}</span>}
              {selectedArticle.published && (
                <span> · {new Date(selectedArticle.published).toLocaleString()}</span>
              )}
            </div>
            <div
              className="reader-content-body"
              dangerouslySetInnerHTML={{ __html: selectedArticle.content }}
            />
            {selectedArticle.link && (
              <a
                className="reader-content-link"
                href={selectedArticle.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open original
              </a>
            )}
          </>
        ) : (
          <div className="reader-empty">Select an article to read</div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create Reader SCSS**

```scss
// frontend/src/modules/Feed/Reader/Reader.scss
.reader-view {
  display: grid;
  grid-template-columns: 220px 300px 1fr;
  height: calc(100vh - 42px);
}

.reader-sidebar {
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
  background: #f8f9fa;
  padding: 0.5rem 0;
}

.reader-sidebar-title {
  padding: 0.5rem 1rem;
  margin: 0;
  font-size: 0.75rem;
  text-transform: uppercase;
  color: #888;
  letter-spacing: 0.05em;
}

.reader-feed-item {
  display: block;
  width: 100%;
  padding: 0.5rem 1rem;
  border: none;
  background: none;
  text-align: left;
  font-size: 0.85rem;
  cursor: pointer;
  color: #333;

  &:hover { background: #e9ecef; }
  &.active { background: #dee2e6; font-weight: 600; }
}

.reader-articles {
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
  background: #fff;
}

.reader-article-item {
  display: block;
  width: 100%;
  padding: 0.75rem 1rem;
  border: none;
  border-bottom: 1px solid #f0f0f0;
  background: none;
  text-align: left;
  cursor: pointer;

  &:hover { background: #f8f9fa; }
  &.active { background: #e7f5ff; }
}

.reader-article-title {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  line-height: 1.3;
  color: #1a1b1e;
}

.reader-article-meta {
  display: block;
  font-size: 0.7rem;
  color: #999;
  margin-top: 4px;
}

.reader-content {
  overflow-y: auto;
  padding: 2rem;
  background: #fff;
}

.reader-content-title {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
  line-height: 1.3;
}

.reader-content-meta {
  font-size: 0.8rem;
  color: #888;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #eee;
}

.reader-content-body {
  font-size: 0.95rem;
  line-height: 1.7;
  color: #333;

  img { max-width: 100%; height: auto; border-radius: 4px; }
  a { color: #228be6; }
  pre { background: #f8f9fa; padding: 1rem; border-radius: 4px; overflow-x: auto; }
}

.reader-content-link {
  display: inline-block;
  margin-top: 1.5rem;
  padding: 0.5rem 1rem;
  background: #228be6;
  color: #fff;
  border-radius: 4px;
  text-decoration: none;
  font-size: 0.85rem;

  &:hover { background: #1c7ed6; }
}

.reader-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #aaa;
  font-size: 0.9rem;
}
```

**Step 3: Update FeedApp.jsx**

Replace `ReaderPlaceholder` with import:

```jsx
import Reader from '../modules/Feed/Reader/Reader.jsx';

// In Routes:
<Route path="reader" element={<Reader />} />
```

**Step 4: Verify in browser**

Navigate to `http://localhost:3111/feed/reader`
Expected: Three-pane layout. Left: FreshRSS feeds. Middle: article list. Right: article content. Clicking articles marks them read.

**Step 5: Commit**

```bash
git add frontend/src/modules/Feed/Reader/ frontend/src/Apps/FeedApp.jsx
git commit -m "feat(feed): add Reader view with three-pane FreshRSS UI"
```

---

## Task 14: Final Verification

**Step 1: Run all isolated tests**

Run: `npx jest tests/isolated/domain/feed/ tests/isolated/adapter/feed/ tests/isolated/application/feed/ tests/isolated/api/feed/ --verbose`
Expected: All tests PASS

**Step 2: Run integration tests**

Run: `npx jest tests/integrated/api/feed/ --verbose`
Expected: Headlines tests PASS, Reader tests pass or gracefully handle FreshRSS unavailability

**Step 3: Manual verification checklist**

- [ ] `http://localhost:3111/feed` redirects to `/feed/reader`
- [ ] Tab navigation works between Reader, Headlines, Scroll
- [ ] Headlines: source panels show real CNN/ABC headlines
- [ ] Headlines: Refresh button triggers harvest and updates
- [ ] Scroll: cards appear with source labels and timestamps
- [ ] Reader: FreshRSS feeds load in sidebar (if FreshRSS reachable)
- [ ] Reader: clicking feed loads articles
- [ ] Reader: clicking article shows content and marks read
- [ ] `curl http://localhost:3112/api/v1/feed/headlines | jq '.sources | keys'` returns `["abc","cnn"]`
- [ ] Scheduler: `feed:harvest-headlines` task registered (check `/api/v1/scheduling`)

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(feed): FeedApp complete — reader, headlines, scroll views"
```
