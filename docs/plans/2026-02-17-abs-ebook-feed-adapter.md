# ABS Ebook Feed Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an AudioBookShelf ebook feed source that surfaces random chapters from non-fiction books in the feed scroll.

**Architecture:** New `ABSEbookFeedAdapter` extends `IFeedSourceAdapter`, reuses existing `AudiobookshelfClient` for API access. Fetches genre-filtered library items, picks a random book with a meaningful EPUB TOC, and returns a random chapter as a feed card. Chapter data is cached to disk via `DataService` to avoid repeated API calls.

**Tech Stack:** Node.js ESM, AudioBookShelf REST API, Jest for testing

---

### Task 1: Extend AudiobookshelfClient with filter and sort support

**Files:**
- Modify: `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs:84-93`
- Test: `tests/isolated/adapter/feed/ABSEbookFeedAdapter.test.mjs` (created in Task 2)

**Step 1: Add filter and sort options to getLibraryItems**

In `AudiobookshelfClient.mjs`, update `getLibraryItems` to accept `filter` and `sort` options:

```javascript
async getLibraryItems(libraryId, options = {}) {
  const page = options.page ?? 0;
  const limit = options.limit ?? 50;

  const params = new URLSearchParams({ page, limit });
  if (options.filter) params.set('filter', options.filter);
  if (options.sort) params.set('sort', options.sort);
  if (options.desc != null) params.set('desc', options.desc ? '1' : '0');

  const response = await this.#httpClient.get(
    `${this.#host}/api/libraries/${libraryId}/items?${params}`,
    { headers: this.#getHeaders() }
  );
  return response.data;
}
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs
git commit -m "feat: add filter/sort support to AudiobookshelfClient.getLibraryItems"
```

---

### Task 2: Write failing tests for ABSEbookFeedAdapter

**Files:**
- Create: `tests/isolated/adapter/feed/ABSEbookFeedAdapter.test.mjs`

**Step 1: Write the test file**

```javascript
// tests/isolated/adapter/feed/ABSEbookFeedAdapter.test.mjs
import { jest } from '@jest/globals';
import { ABSEbookFeedAdapter } from '#adapters/feed/sources/ABSEbookFeedAdapter.mjs';

// Mock absClient
const mockAbsClient = {
  getLibraryItems: jest.fn(),
  getItem: jest.fn(),
};

// Mock dataService for chapter caching
const mockDataService = {
  household: {
    read: jest.fn().mockReturnValue(null),
    write: jest.fn(),
  },
};

describe('ABSEbookFeedAdapter', () => {
  const logger = { warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDataService.household.read.mockReturnValue(null);
  });

  test('sourceType is abs-ebooks', () => {
    const adapter = new ABSEbookFeedAdapter({
      absClient: mockAbsClient,
      dataService: mockDataService,
      logger,
    });
    expect(adapter.sourceType).toBe('abs-ebooks');
  });

  test('returns feed card with chapter title when book has chapters', async () => {
    // Mock library items response (list of books)
    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [{
        id: 'book-123',
        media: {
          metadata: {
            title: 'Atomic Habits',
            authorName: 'James Clear',
            genres: ['Self-Improvement'],
          },
          ebookFile: { ebookFormat: 'epub' },
          chapters: [
            { id: 0, start: 0, end: 1, title: 'Introduction' },
            { id: 1, start: 1, end: 2, title: 'The Surprising Power of Atomic Habits' },
            { id: 2, start: 2, end: 3, title: 'How Your Habits Shape Your Identity' },
          ],
        },
      }],
      total: 1,
    });

    // Mock expanded item (getItem) with chapters
    mockAbsClient.getItem.mockResolvedValueOnce({
      id: 'book-123',
      libraryId: 'lib-abc',
      media: {
        metadata: {
          title: 'Atomic Habits',
          authorName: 'James Clear',
          genres: ['Self-Improvement'],
        },
        ebookFile: { ebookFormat: 'epub' },
        chapters: [
          { id: 0, start: 0, end: 1, title: 'Introduction' },
          { id: 1, start: 1, end: 2, title: 'The Surprising Power of Atomic Habits' },
          { id: 2, start: 2, end: 3, title: 'How Your Habits Shape Your Identity' },
        ],
        numChapters: 3,
      },
    });

    const adapter = new ABSEbookFeedAdapter({
      absClient: mockAbsClient,
      dataService: mockDataService,
      logger,
    });

    const items = await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: {
        library: 'lib-abc',
        genres: ['Self-Improvement'],
      },
    }, 'testuser');

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('abs-ebooks');
    expect(items[0].tier).toBe('library');
    expect(items[0].id).toMatch(/^abs-ebooks:book-123:/);
    expect(items[0].title).toBeTruthy();
    expect(items[0].body).toContain('James Clear');
    expect(items[0].body).toContain('Atomic Habits');
    expect(items[0].image).toContain('/api/v1/proxy/abs/items/book-123/cover');
    expect(items[0].meta.sourceName).toBe('Audiobookshelf');
  });

  test('skips books without meaningful chapters', async () => {
    // Book with no chapters
    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [{
        id: 'book-no-toc',
        media: {
          metadata: {
            title: 'Flat PDF Book',
            authorName: 'Nobody',
            genres: ['Self-Improvement'],
          },
          ebookFile: { ebookFormat: 'pdf' },
        },
      }],
      total: 1,
    });

    mockAbsClient.getItem.mockResolvedValueOnce({
      id: 'book-no-toc',
      libraryId: 'lib-abc',
      media: {
        metadata: {
          title: 'Flat PDF Book',
          authorName: 'Nobody',
          genres: ['Self-Improvement'],
        },
        ebookFile: { ebookFormat: 'pdf' },
        chapters: [],
      },
    });

    const adapter = new ABSEbookFeedAdapter({
      absClient: mockAbsClient,
      dataService: mockDataService,
      logger,
    });

    const items = await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: {
        library: 'lib-abc',
        genres: ['Self-Improvement'],
      },
    }, 'testuser');

    expect(items).toHaveLength(0);
  });

  test('returns empty array when no books match query', async () => {
    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [],
      total: 0,
    });

    const adapter = new ABSEbookFeedAdapter({
      absClient: mockAbsClient,
      dataService: mockDataService,
      logger,
    });

    const items = await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: {
        library: 'lib-abc',
        genres: ['Self-Improvement'],
      },
    }, 'testuser');

    expect(items).toHaveLength(0);
  });

  test('uses cached chapter data when available', async () => {
    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [{
        id: 'book-cached',
        media: {
          metadata: {
            title: 'Cached Book',
            authorName: 'Author',
            genres: ['Self-Improvement'],
          },
          ebookFile: { ebookFormat: 'epub' },
        },
      }],
      total: 1,
    });

    // Cached chapter data — getItem should NOT be called
    mockDataService.household.read.mockReturnValue({
      bookId: 'book-cached',
      title: 'Cached Book',
      author: 'Author',
      chapters: [
        { id: 0, title: 'Chapter 1: Basics' },
        { id: 1, title: 'Chapter 2: Advanced' },
      ],
    });

    const adapter = new ABSEbookFeedAdapter({
      absClient: mockAbsClient,
      dataService: mockDataService,
      logger,
    });

    const items = await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: {
        library: 'lib-abc',
        genres: ['Self-Improvement'],
      },
    }, 'testuser');

    expect(items).toHaveLength(1);
    // getItem should NOT have been called since cache hit
    expect(mockAbsClient.getItem).not.toHaveBeenCalled();
  });

  test('builds correct genre filter for ABS API', async () => {
    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [],
      total: 0,
    });

    const adapter = new ABSEbookFeedAdapter({
      absClient: mockAbsClient,
      dataService: mockDataService,
      logger,
    });

    await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: {
        library: 'lib-abc',
        genres: ['Self-Improvement'],
      },
    }, 'testuser');

    // Verify the filter param passed to getLibraryItems
    expect(mockAbsClient.getLibraryItems).toHaveBeenCalledWith(
      'lib-abc',
      expect.objectContaining({
        filter: 'genres.U2VsZi1JbXByb3ZlbWVudA==',
      })
    );
  });

  test('caches chapter data to disk after fetching', async () => {
    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [{
        id: 'book-new',
        media: {
          metadata: {
            title: 'New Book',
            authorName: 'Writer',
            genres: ['Self-Improvement'],
          },
          ebookFile: { ebookFormat: 'epub' },
        },
      }],
      total: 1,
    });

    mockAbsClient.getItem.mockResolvedValueOnce({
      id: 'book-new',
      libraryId: 'lib-abc',
      media: {
        metadata: {
          title: 'New Book',
          authorName: 'Writer',
          genres: ['Self-Improvement'],
        },
        ebookFile: { ebookFormat: 'epub' },
        chapters: [
          { id: 0, start: 0, end: 1, title: 'Opening' },
          { id: 1, start: 1, end: 2, title: 'Deep Dive' },
        ],
      },
    });

    // No cache hit
    mockDataService.household.read.mockReturnValue(null);

    const adapter = new ABSEbookFeedAdapter({
      absClient: mockAbsClient,
      dataService: mockDataService,
      logger,
    });

    await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: {
        library: 'lib-abc',
        genres: ['Self-Improvement'],
      },
    }, 'testuser');

    // Verify cache write
    expect(mockDataService.household.write).toHaveBeenCalledWith(
      'common/abs/chapters/book-new.yml',
      expect.objectContaining({
        bookId: 'book-new',
        title: 'New Book',
        author: 'Writer',
        chapters: expect.arrayContaining([
          expect.objectContaining({ title: 'Opening' }),
        ]),
      })
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/adapter/feed/ABSEbookFeedAdapter.test.mjs --no-coverage`
Expected: FAIL — module `#adapters/feed/sources/ABSEbookFeedAdapter.mjs` does not exist

**Step 3: Commit**

```bash
git add tests/isolated/adapter/feed/ABSEbookFeedAdapter.test.mjs
git commit -m "test: add failing tests for ABSEbookFeedAdapter"
```

---

### Task 3: Implement ABSEbookFeedAdapter

**Files:**
- Create: `backend/src/1_adapters/feed/sources/ABSEbookFeedAdapter.mjs`

**Reference files:**
- Pattern: `backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs`
- Interface: `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs`
- Client: `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs`

**Step 1: Write the adapter implementation**

```javascript
// backend/src/1_adapters/feed/sources/ABSEbookFeedAdapter.mjs
/**
 * ABSEbookFeedAdapter
 *
 * Fetches random non-fiction ebook chapters from AudioBookShelf.
 * Picks a random book from genre-filtered library items, extracts its
 * chapter list, and returns a random chapter as a feed item.
 *
 * Chapter data is cached to disk via DataService to avoid repeated API calls.
 *
 * @module adapters/feed/sources/ABSEbookFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class ABSEbookFeedAdapter extends IFeedSourceAdapter {
  #absClient;
  #dataService;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.absClient - AudiobookshelfClient instance
   * @param {Object} deps.dataService - DataService for chapter cache
   * @param {Object} [deps.logger]
   */
  constructor({ absClient, dataService, logger = console }) {
    super();
    if (!absClient) throw new Error('ABSEbookFeedAdapter requires absClient');
    if (!dataService) throw new Error('ABSEbookFeedAdapter requires dataService');
    this.#absClient = absClient;
    this.#dataService = dataService;
    this.#logger = logger;
  }

  get sourceType() { return 'abs-ebooks'; }

  /**
   * Fetch feed items from AudioBookShelf.
   *
   * Fetches genre-filtered library items, shuffles them, walks through
   * until finding a book with a meaningful TOC, and returns a random
   * chapter as a feed card.
   *
   * @param {Object} query - Query config from YAML
   * @param {string} query.params.library - ABS library ID
   * @param {string[]} [query.params.genres] - Genre names to filter by
   * @param {string} username
   * @returns {Promise<Object[]>} Normalized FeedItem-shaped objects
   */
  async fetchItems(query, username) {
    const libraryId = query.params?.library;
    if (!libraryId) return [];

    const genres = query.params?.genres || [];

    // Build ABS genre filter (base64-encoded genre name)
    const filter = genres.length > 0
      ? `genres.${Buffer.from(genres[0]).toString('base64')}`
      : undefined;

    let data;
    try {
      data = await this.#absClient.getLibraryItems(libraryId, {
        limit: 100,
        filter,
      });
    } catch (err) {
      this.#logger.warn?.('abs-ebooks.adapter.list.error', { error: err.message });
      return [];
    }

    const books = data?.results || [];
    if (books.length === 0) return [];

    // Shuffle books
    const shuffled = [...books].sort(() => Math.random() - 0.5);

    // Walk through shuffled books until we find one with a meaningful TOC
    for (const book of shuffled) {
      const bookId = book.id;
      const metadata = book.media?.metadata || {};

      // Get chapters (cached or from API)
      const chapterData = await this.#getChapters(bookId, metadata);
      if (!chapterData || !this.#hasMeaningfulToc(chapterData.chapters)) {
        continue;
      }

      // Pick a random chapter
      const chapters = chapterData.chapters;
      const chapter = chapters[Math.floor(Math.random() * chapters.length)];

      const coverUrl = `/api/v1/proxy/abs/items/${bookId}/cover`;
      const author = metadata.authorName || metadata.author || '';
      const title = metadata.title || 'Untitled';

      return [{
        id: `abs-ebooks:${bookId}:${chapter.id}`,
        tier: query.tier || 'library',
        source: 'abs-ebooks',
        title: chapter.title,
        body: `${author} — ${title}`,
        image: coverUrl,
        link: null,
        timestamp: new Date().toISOString(),
        priority: query.priority || 5,
        meta: {
          bookId,
          chapterId: chapter.id,
          bookTitle: title,
          author,
          sourceName: 'Audiobookshelf',
          sourceIcon: null,
        },
      }];
    }

    // No book had a meaningful TOC
    return [];
  }

  /**
   * Get chapter data for a book, using disk cache to avoid repeated API calls.
   *
   * Cache path: household common/abs/chapters/{bookId}.yml
   *
   * @param {string} bookId
   * @param {Object} metadata - Book metadata from list response
   * @returns {Promise<Object|null>} Chapter data with { bookId, title, author, chapters }
   */
  async #getChapters(bookId, metadata) {
    const cachePath = `common/abs/chapters/${bookId}.yml`;
    const cached = this.#dataService.household.read(cachePath);
    if (cached) return cached;

    // Fetch expanded item for chapter data
    let item;
    try {
      item = await this.#absClient.getItem(bookId);
    } catch (err) {
      this.#logger.warn?.('abs-ebooks.adapter.item.error', { bookId, error: err.message });
      return null;
    }

    const chapters = (item?.media?.chapters || []).map(ch => ({
      id: ch.id,
      title: ch.title || '',
    }));

    const chapterData = {
      bookId,
      title: metadata.title || item?.media?.metadata?.title || '',
      author: metadata.authorName || metadata.author || '',
      chapters,
    };

    // Persist to cache
    this.#dataService.household.write(cachePath, chapterData);

    return chapterData;
  }

  /**
   * Check if a chapters array represents a meaningful TOC.
   * Requires at least 2 chapters with non-empty titles.
   *
   * @param {Array} chapters
   * @returns {boolean}
   */
  #hasMeaningfulToc(chapters) {
    if (!Array.isArray(chapters) || chapters.length < 2) return false;
    const titled = chapters.filter(ch => ch.title && ch.title.trim().length > 0);
    return titled.length >= 2;
  }
}
```

**Step 2: Run tests to verify they pass**

Run: `npx jest tests/isolated/adapter/feed/ABSEbookFeedAdapter.test.mjs --no-coverage`
Expected: All 7 tests PASS

**Step 3: Commit**

```bash
git add backend/src/1_adapters/feed/sources/ABSEbookFeedAdapter.mjs
git commit -m "feat: add ABSEbookFeedAdapter for random ebook chapters in feed"
```

---

### Task 4: Wire up ABSEbookFeedAdapter in app.mjs

**Files:**
- Modify: `backend/src/app.mjs` (near line 664 for import, near line 770 for instantiation, line 820 for registration)

**Step 1: Add import**

After the GoodreadsFeedAdapter import (line 666), add:

```javascript
    const { ABSEbookFeedAdapter } = await import('./1_adapters/feed/sources/ABSEbookFeedAdapter.mjs');
```

**Step 2: Add adapter instantiation**

After the `goodreadsFeedAdapter` instantiation (line 771), add:

```javascript
    const absEbookFeedAdapter = audiobookshelfConfig ? new ABSEbookFeedAdapter({
      absClient: new (await import('./1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs')).AudiobookshelfClient(audiobookshelfConfig, { httpClient: axios }),
      dataService,
      logger: rootLogger.child({ module: 'abs-ebooks-feed' }),
    }) : null;
```

Note: We create a fresh `AudiobookshelfClient` here because the existing `absClient` is scoped inside the progress-sync `if` block (line 402-413) and not accessible at the feed section. The `audiobookshelfConfig` object and `axios` are both in scope.

**Step 3: Add to feedSourceAdapters array**

On line 820, add `absEbookFeedAdapter` to the array:

```javascript
    const feedSourceAdapters = [redditAdapter, weatherAdapter, healthAdapter, gratitudeAdapter, stravaAdapter, todoistAdapter, immichAdapter, plexAdapter, journalAdapter, youtubeAdapter, googleNewsAdapter, komgaFeedAdapter, readalongFeedAdapter, goodreadsFeedAdapter, freshRSSFeedAdapter, headlineFeedAdapter, entropyFeedAdapter, absEbookFeedAdapter].filter(Boolean);
```

**Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat: wire ABSEbookFeedAdapter into feed bootstrap"
```

---

### Task 5: Create query YAML and update feed.yml

**Files:**
- Create: `data/users/kckern/config/queries/abs-ebooks.yml` (actual path: `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/users/kckern/config/queries/abs-ebooks.yml`)
- Modify: `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/users/kckern/config/feed.yml` (add `abs-ebooks` to library sources)

**Step 1: Create query YAML**

```yaml
type: abs-ebooks
tier: library
priority: 5
limit: 1
params:
  library: 72920089-cfb8-4309-8adc-aba315a59089
  genres:
    - Self-Improvement
```

**Step 2: Add abs-ebooks to feed.yml library sources**

In `feed.yml`, under `scroll.tiers.library.sources`, add after the `komga` entry:

```yaml
        abs-ebooks:
          max_per_batch: 1
          padding: true
          max_age_hours: null
```

**Step 3: Commit**

```bash
git add -A
git commit -m "config: add abs-ebooks query and feed scroll entry"
```

---

### Task 6: Verify end-to-end

**Step 1: Run the full test suite for feed adapters**

Run: `npx jest tests/isolated/adapter/feed/ --no-coverage`
Expected: All tests pass including the new ABSEbookFeedAdapter tests

**Step 2: Verify the dev server starts without errors**

Check if the dev server is running: `lsof -i :3111`

If running, check logs for abs-ebooks-related errors.
If not running, start it and verify no startup crashes related to the new adapter.
