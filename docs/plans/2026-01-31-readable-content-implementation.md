# Readable Content Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Komga and Audiobookshelf adapters for readable content (comics, ebooks, PDFs, magazines) with the new `ReadableItem` capability.

**Architecture:** Proxy-first approach. Source systems (Komga, Audiobookshelf) handle rendering. We normalize metadata to domain model and pass through content. Komga renders all content to page images; ABS serves raw EPUB for epub.js rendering on frontend.

**Tech Stack:** Node.js ES modules, Jest for testing, existing HttpClient for API calls, epub.js for frontend EPUB rendering.

---

## Task 1: ReadableItem Capability

**Files:**
- Create: `backend/src/2_domains/content/capabilities/Readable.mjs`
- Modify: `backend/src/2_domains/content/index.mjs`
- Test: `tests/unit/domains/content/Readable.test.mjs`

**Step 1: Write the failing test**

Create `tests/unit/domains/content/Readable.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { ReadableItem } from '#domains/content/capabilities/Readable.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('ReadableItem', () => {
  describe('constructor', () => {
    it('creates paged readable with required properties', () => {
      const readable = new ReadableItem({
        id: 'komga:book-123',
        source: 'komga',
        title: 'Batman #1',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24
      });

      expect(readable.id).toBe('komga:book-123');
      expect(readable.source).toBe('komga');
      expect(readable.title).toBe('Batman #1');
      expect(readable.contentType).toBe('paged');
      expect(readable.format).toBe('cbz');
      expect(readable.totalPages).toBe(24);
    });

    it('creates flow readable with required properties', () => {
      const readable = new ReadableItem({
        id: 'abs:ebook-456',
        source: 'abs',
        title: 'The Great Novel',
        contentType: 'flow',
        format: 'epub',
        contentUrl: '/api/v1/proxy/abs/api/items/ebook-456/ebook'
      });

      expect(readable.contentType).toBe('flow');
      expect(readable.format).toBe('epub');
      expect(readable.contentUrl).toBe('/api/v1/proxy/abs/api/items/ebook-456/ebook');
      expect(readable.totalPages).toBeNull();
    });

    it('throws ValidationError when contentType is missing', () => {
      expect(() => new ReadableItem({
        id: 'komga:book-123',
        source: 'komga',
        title: 'Test Book',
        format: 'cbz'
      })).toThrow(ValidationError);
    });

    it('throws ValidationError when format is missing', () => {
      expect(() => new ReadableItem({
        id: 'komga:book-123',
        source: 'komga',
        title: 'Test Book',
        contentType: 'paged'
      })).toThrow(ValidationError);
    });

    it('throws ValidationError for paged content without totalPages', () => {
      expect(() => new ReadableItem({
        id: 'komga:book-123',
        source: 'komga',
        title: 'Test Book',
        contentType: 'paged',
        format: 'cbz'
      })).toThrow(ValidationError);
    });

    it('throws ValidationError for flow content without contentUrl', () => {
      expect(() => new ReadableItem({
        id: 'abs:ebook-456',
        source: 'abs',
        title: 'Test Book',
        contentType: 'flow',
        format: 'epub'
      })).toThrow(ValidationError);
    });

    it('sets optional properties with defaults', () => {
      const readable = new ReadableItem({
        id: 'komga:book-123',
        source: 'komga',
        title: 'Batman #1',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24
      });

      expect(readable.pageLayout).toBe('single');
      expect(readable.readingDirection).toBe('ltr');
      expect(readable.resumable).toBe(true);
      expect(readable.resumePosition).toBeNull();
      expect(readable.manifestUrl).toBeNull();
      expect(readable.audioItemId).toBeNull();
    });

    it('accepts all optional properties', () => {
      const readable = new ReadableItem({
        id: 'komga:manga-789',
        source: 'komga',
        title: 'Manga Vol 1',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 200,
        pageLayout: 'facing',
        readingDirection: 'rtl',
        manifestUrl: '/api/v1/proxy/komga/api/v1/books/manga-789/manifest',
        thumbnail: '/api/v1/proxy/komga/api/v1/books/manga-789/thumbnail',
        resumePosition: { type: 'page', page: 42 },
        audioItemId: 'abs:audio-123',
        metadata: { publisher: 'Viz Media' }
      });

      expect(readable.pageLayout).toBe('facing');
      expect(readable.readingDirection).toBe('rtl');
      expect(readable.manifestUrl).toBe('/api/v1/proxy/komga/api/v1/books/manga-789/manifest');
      expect(readable.thumbnail).toBe('/api/v1/proxy/komga/api/v1/books/manga-789/thumbnail');
      expect(readable.resumePosition).toEqual({ type: 'page', page: 42 });
      expect(readable.audioItemId).toBe('abs:audio-123');
      expect(readable.metadata.publisher).toBe('Viz Media');
    });
  });

  describe('getPageUrl', () => {
    it('returns page URL for paged content', () => {
      const readable = new ReadableItem({
        id: 'komga:book-123',
        source: 'komga',
        title: 'Batman #1',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24,
        getPageUrl: (n) => `/api/v1/proxy/komga/api/v1/books/book-123/pages/${n}`
      });

      expect(readable.getPageUrl(1)).toBe('/api/v1/proxy/komga/api/v1/books/book-123/pages/1');
      expect(readable.getPageUrl(24)).toBe('/api/v1/proxy/komga/api/v1/books/book-123/pages/24');
    });

    it('returns null for flow content', () => {
      const readable = new ReadableItem({
        id: 'abs:ebook-456',
        source: 'abs',
        title: 'The Great Novel',
        contentType: 'flow',
        format: 'epub',
        contentUrl: '/api/v1/proxy/abs/api/items/ebook-456/ebook'
      });

      expect(readable.getPageUrl(1)).toBeNull();
    });
  });

  describe('getProgress', () => {
    it('calculates progress from page position', () => {
      const readable = new ReadableItem({
        id: 'komga:book-123',
        source: 'komga',
        title: 'Batman #1',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 100,
        resumePosition: { type: 'page', page: 50 }
      });

      expect(readable.getProgress()).toBe(50);
    });

    it('returns percent from flow position', () => {
      const readable = new ReadableItem({
        id: 'abs:ebook-456',
        source: 'abs',
        title: 'The Great Novel',
        contentType: 'flow',
        format: 'epub',
        contentUrl: '/epub.epub',
        resumePosition: { type: 'flow', cfi: '/6/14!/4/2/1:0', percent: 42.5 }
      });

      expect(readable.getProgress()).toBeCloseTo(42.5, 1);
    });

    it('returns null when no resume position', () => {
      const readable = new ReadableItem({
        id: 'komga:book-123',
        source: 'komga',
        title: 'Batman #1',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24
      });

      expect(readable.getProgress()).toBeNull();
    });
  });

  describe('isReadable', () => {
    it('returns true', () => {
      const readable = new ReadableItem({
        id: 'komga:book-123',
        source: 'komga',
        title: 'Batman #1',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24
      });

      expect(readable.isReadable()).toBe(true);
    });
  });

  describe('isComplete', () => {
    it('returns true when progress >= 90%', () => {
      const readable = new ReadableItem({
        id: 'komga:book-123',
        source: 'komga',
        title: 'Batman #1',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 100,
        resumePosition: { type: 'page', page: 95 }
      });

      expect(readable.isComplete()).toBe(true);
    });

    it('returns false when progress < 90%', () => {
      const readable = new ReadableItem({
        id: 'komga:book-123',
        source: 'komga',
        title: 'Batman #1',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 100,
        resumePosition: { type: 'page', page: 50 }
      });

      expect(readable.isComplete()).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/domains/content/Readable.test.mjs`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `backend/src/2_domains/content/capabilities/Readable.mjs`:

```javascript
// backend/src/2_domains/content/capabilities/Readable.mjs
import { Item } from '../entities/Item.mjs';
import { ValidationError } from '../../core/errors/index.mjs';

/**
 * @typedef {'paged' | 'flow'} ContentType
 * @typedef {'pdf' | 'cbz' | 'cbr' | 'epub'} ReadableFormat
 * @typedef {'single' | 'facing' | 'auto'} PageLayout
 * @typedef {'ltr' | 'rtl'} ReadingDirection
 */

/**
 * @typedef {Object} PagePosition
 * @property {'page'} type
 * @property {number} page - 1-indexed page number
 */

/**
 * @typedef {Object} FlowPosition
 * @property {'flow'} type
 * @property {string} cfi - EPUB CFI like "/6/14!/4/2/1:0"
 * @property {number} percent - 0-100 for progress bar
 */

/**
 * Readable capability - content with page-turn navigation
 * Use cases: Comics, manga, PDFs, ebooks, magazines
 */
export class ReadableItem extends Item {
  /**
   * @param {Object} props
   * @param {string} props.id - Compound ID
   * @param {string} props.source - Adapter source
   * @param {string} props.title - Display title
   * @param {ContentType} props.contentType - 'paged' or 'flow'
   * @param {ReadableFormat} props.format - pdf, cbz, cbr, epub
   * @param {number} [props.totalPages] - Fixed page count (paged only, required for paged)
   * @param {string} [props.contentUrl] - URL to raw content file (flow only, required for flow)
   * @param {PageLayout} [props.pageLayout='single'] - Page layout mode
   * @param {ReadingDirection} [props.readingDirection='ltr'] - Reading direction
   * @param {Function} [props.getPageUrl] - Function (page) => URL for page image
   * @param {string} [props.manifestUrl] - Readium WebPub manifest URL
   * @param {string} [props.thumbnail] - Thumbnail URL
   * @param {PagePosition|FlowPosition} [props.resumePosition] - Current reading position
   * @param {string} [props.audioItemId] - Linked PlayableItem for audio-synced reading
   * @param {Object} [props.metadata] - Additional metadata
   */
  constructor(props) {
    super(props);

    if (!props.contentType) {
      throw new ValidationError('ReadableItem requires contentType', {
        code: 'MISSING_CONTENT_TYPE',
        field: 'contentType'
      });
    }
    if (!props.format) {
      throw new ValidationError('ReadableItem requires format', {
        code: 'MISSING_FORMAT',
        field: 'format'
      });
    }
    if (props.contentType === 'paged' && !props.totalPages) {
      throw new ValidationError('Paged ReadableItem requires totalPages', {
        code: 'MISSING_TOTAL_PAGES',
        field: 'totalPages'
      });
    }
    if (props.contentType === 'flow' && !props.contentUrl) {
      throw new ValidationError('Flow ReadableItem requires contentUrl', {
        code: 'MISSING_CONTENT_URL',
        field: 'contentUrl'
      });
    }

    this.contentType = props.contentType;
    this.format = props.format;
    this.totalPages = props.totalPages ?? null;
    this.contentUrl = props.contentUrl ?? null;
    this.pageLayout = props.pageLayout ?? 'single';
    this.readingDirection = props.readingDirection ?? 'ltr';
    this._getPageUrl = props.getPageUrl ?? null;
    this.manifestUrl = props.manifestUrl ?? null;
    this.resumable = true;
    this.resumePosition = props.resumePosition ?? null;
    this.audioItemId = props.audioItemId ?? null;
  }

  /**
   * Get URL for a specific page (paged content only)
   * @param {number} page - 1-indexed page number
   * @returns {string|null}
   */
  getPageUrl(page) {
    if (this.contentType !== 'paged' || !this._getPageUrl) {
      return null;
    }
    return this._getPageUrl(page);
  }

  /**
   * Get progress as percentage (0-100)
   * @returns {number|null}
   */
  getProgress() {
    if (!this.resumePosition) {
      return null;
    }

    if (this.resumePosition.type === 'page' && this.totalPages) {
      return Math.round((this.resumePosition.page / this.totalPages) * 100);
    }

    if (this.resumePosition.type === 'flow') {
      return this.resumePosition.percent;
    }

    return null;
  }

  /**
   * Check if item is complete (>= 90% progress)
   * @returns {boolean}
   */
  isComplete() {
    const progress = this.getProgress();
    return progress !== null && progress >= 90;
  }

  /**
   * Check if reading is in progress
   * @returns {boolean}
   */
  isInProgress() {
    const progress = this.getProgress();
    return progress !== null && progress > 0 && !this.isComplete();
  }

  /**
   * Check if item is readable
   * @returns {boolean}
   */
  isReadable() {
    return true;
  }
}

export default ReadableItem;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/domains/content/Readable.test.mjs`
Expected: PASS

**Step 5: Export from index**

Modify `backend/src/2_domains/content/index.mjs`, add after ViewableItem export:

```javascript
export { ReadableItem } from './capabilities/Readable.mjs';
```

**Step 6: Commit**

```bash
git add backend/src/2_domains/content/capabilities/Readable.mjs \
        backend/src/2_domains/content/index.mjs \
        tests/unit/domains/content/Readable.test.mjs
git commit -m "feat(content): add ReadableItem capability for page-turn content"
```

---

## Task 2: KomgaProxyAdapter

**Files:**
- Create: `backend/src/1_adapters/proxy/KomgaProxyAdapter.mjs`
- Modify: `backend/src/1_adapters/proxy/index.mjs`
- Test: `tests/isolated/adapter/proxy/KomgaProxyAdapter.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapter/proxy/KomgaProxyAdapter.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { KomgaProxyAdapter } from '#adapters/proxy/KomgaProxyAdapter.mjs';
import { isProxyAdapter } from '#system/proxy/IProxyAdapter.mjs';

describe('KomgaProxyAdapter', () => {
  describe('constructor', () => {
    it('creates adapter with host and apiKey', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'https://mags.example.com',
        apiKey: 'test-api-key'
      });

      expect(adapter.getServiceName()).toBe('komga');
      expect(adapter.getBaseUrl()).toBe('https://mags.example.com');
      expect(adapter.isConfigured()).toBe(true);
    });

    it('normalizes host URL by removing trailing slash', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'https://mags.example.com/',
        apiKey: 'test-api-key'
      });

      expect(adapter.getBaseUrl()).toBe('https://mags.example.com');
    });

    it('reports not configured when host is missing', () => {
      const adapter = new KomgaProxyAdapter({
        apiKey: 'test-api-key'
      });

      expect(adapter.isConfigured()).toBe(false);
    });

    it('reports not configured when apiKey is missing', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'https://mags.example.com'
      });

      expect(adapter.isConfigured()).toBe(false);
    });
  });

  describe('IProxyAdapter interface', () => {
    it('implements IProxyAdapter interface', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'https://mags.example.com',
        apiKey: 'test-api-key'
      });

      expect(isProxyAdapter(adapter)).toBe(true);
    });
  });

  describe('getAuthHeaders', () => {
    it('returns X-API-Key header', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'https://mags.example.com',
        apiKey: 'my-secret-key'
      });

      const headers = adapter.getAuthHeaders();

      expect(headers).toEqual({
        'X-API-Key': 'my-secret-key'
      });
    });
  });

  describe('transformPath', () => {
    it('strips /komga prefix from path', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'https://mags.example.com',
        apiKey: 'test-key'
      });

      expect(adapter.transformPath('/komga/api/v1/books')).toBe('/api/v1/books');
      expect(adapter.transformPath('/komga/api/v1/books/123/pages/1')).toBe('/api/v1/books/123/pages/1');
    });

    it('passes through paths without /komga prefix', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'https://mags.example.com',
        apiKey: 'test-key'
      });

      expect(adapter.transformPath('/api/v1/books')).toBe('/api/v1/books');
    });
  });

  describe('getTimeout', () => {
    it('returns 60s timeout for page image loading', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'https://mags.example.com',
        apiKey: 'test-key'
      });

      expect(adapter.getTimeout()).toBe(60000);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/adapter/proxy/KomgaProxyAdapter.test.mjs`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `backend/src/1_adapters/proxy/KomgaProxyAdapter.mjs`:

```javascript
/**
 * KomgaProxyAdapter - Proxy adapter for Komga
 *
 * Implements IProxyAdapter for forwarding requests to Komga
 * with X-API-Key header authentication.
 *
 * @module adapters/proxy
 */

/**
 * @implements {import('../../0_system/proxy/IProxyAdapter.mjs').IProxyAdapter}
 */
export class KomgaProxyAdapter {
  #host;
  #apiKey;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Komga server URL (e.g., 'https://mags.kckern.net')
   * @param {string} config.apiKey - Komga API key
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#host = config.host?.replace(/\/$/, '') || '';
    this.#apiKey = config.apiKey || '';
    this.#logger = options.logger || console;
  }

  /**
   * Get service identifier
   * @returns {string}
   */
  getServiceName() {
    return 'komga';
  }

  /**
   * Get Komga server base URL
   * @returns {string}
   */
  getBaseUrl() {
    return this.#host;
  }

  /**
   * Check if adapter is configured
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.#host && this.#apiKey);
  }

  /**
   * Get authentication headers
   * Komga uses X-API-Key header
   * @returns {Object}
   */
  getAuthHeaders() {
    return {
      'X-API-Key': this.#apiKey
    };
  }

  /**
   * No auth params needed for Komga
   * @returns {null}
   */
  getAuthParams() {
    return null;
  }

  /**
   * Transform incoming path
   * Strips /komga prefix if present
   * @param {string} path
   * @returns {string}
   */
  transformPath(path) {
    return path.replace(/^\/komga/, '');
  }

  /**
   * Default retry configuration
   * @returns {{ maxRetries: number, delayMs: number }}
   */
  getRetryConfig() {
    return {
      maxRetries: 3,
      delayMs: 500
    };
  }

  /**
   * Standard retry logic
   * @param {number} statusCode
   * @returns {boolean}
   */
  shouldRetry(statusCode) {
    return statusCode >= 500 || statusCode === 429;
  }

  /**
   * Longer timeout for page image loading
   * @returns {number}
   */
  getTimeout() {
    return 60000;
  }
}

export default KomgaProxyAdapter;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/adapter/proxy/KomgaProxyAdapter.test.mjs`
Expected: PASS

**Step 5: Export from index**

Modify `backend/src/1_adapters/proxy/index.mjs`, add:

```javascript
export { KomgaProxyAdapter } from './KomgaProxyAdapter.mjs';
```

**Step 6: Commit**

```bash
git add backend/src/1_adapters/proxy/KomgaProxyAdapter.mjs \
        backend/src/1_adapters/proxy/index.mjs \
        tests/isolated/adapter/proxy/KomgaProxyAdapter.test.mjs
git commit -m "feat(adapters): add KomgaProxyAdapter for Komga API passthrough"
```

---

## Task 3: KomgaClient API Wrapper

**Files:**
- Create: `backend/src/1_adapters/content/readable/komga/KomgaClient.mjs`
- Test: `tests/isolated/adapter/content/KomgaClient.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapter/content/KomgaClient.test.mjs`:

```javascript
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { KomgaClient } from '#adapters/content/readable/komga/KomgaClient.mjs';

describe('KomgaClient', () => {
  const mockHttpClient = {
    get: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('throws error when host is missing', () => {
      expect(() => new KomgaClient({}, { httpClient: mockHttpClient }))
        .toThrow('KomgaClient requires host');
    });

    it('throws error when apiKey is missing', () => {
      expect(() => new KomgaClient({ host: 'http://localhost:8080' }, { httpClient: mockHttpClient }))
        .toThrow('KomgaClient requires apiKey');
    });

    it('throws error when httpClient is missing', () => {
      expect(() => new KomgaClient({ host: 'http://localhost:8080', apiKey: 'key' }, {}))
        .toThrow('KomgaClient requires httpClient');
    });

    it('normalizes host URL by removing trailing slash', () => {
      const client = new KomgaClient(
        { host: 'http://localhost:8080/', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );
      expect(client.host).toBe('http://localhost:8080');
    });
  });

  describe('getLibraries', () => {
    it('fetches all libraries', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: [
          { id: 'lib-1', name: 'Comics' },
          { id: 'lib-2', name: 'Manga' }
        ]
      });

      const client = new KomgaClient(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getLibraries();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/libraries',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'test-key'
          })
        })
      );
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Comics');
    });
  });

  describe('getSeries', () => {
    it('fetches series for a library', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          content: [
            { id: 'series-1', name: 'Batman', booksCount: 10 },
            { id: 'series-2', name: 'Superman', booksCount: 5 }
          ],
          totalElements: 2
        }
      });

      const client = new KomgaClient(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getSeries('lib-1');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/series?library_id=lib-1'),
        expect.any(Object)
      );
      expect(result.content).toHaveLength(2);
      expect(result.content[0].name).toBe('Batman');
    });
  });

  describe('getBooks', () => {
    it('fetches books for a series', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          content: [
            { id: 'book-1', name: 'Issue #1', media: { pagesCount: 24 } },
            { id: 'book-2', name: 'Issue #2', media: { pagesCount: 26 } }
          ],
          totalElements: 2
        }
      });

      const client = new KomgaClient(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getBooks('series-1');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/series/series-1/books'),
        expect.any(Object)
      );
      expect(result.content).toHaveLength(2);
      expect(result.content[0].media.pagesCount).toBe(24);
    });
  });

  describe('getBook', () => {
    it('fetches single book by ID', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'book-123',
          name: 'Batman #1',
          seriesId: 'series-1',
          media: {
            pagesCount: 24,
            mediaProfile: 'cbz'
          },
          metadata: {
            readingDirection: 'ltr'
          },
          readProgress: {
            page: 10,
            completed: false
          }
        }
      });

      const client = new KomgaClient(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getBook('book-123');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/books/book-123',
        expect.any(Object)
      );
      expect(result.id).toBe('book-123');
      expect(result.media.pagesCount).toBe(24);
      expect(result.readProgress.page).toBe(10);
    });
  });

  describe('updateProgress', () => {
    it('updates reading progress', async () => {
      mockHttpClient.get.mockResolvedValue({ data: {} });

      const client = new KomgaClient(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      // Mock patch method
      mockHttpClient.patch = jest.fn().mockResolvedValue({ data: {} });

      await client.updateProgress('book-123', 15, false);

      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/books/book-123/read-progress',
        { page: 15, completed: false },
        expect.any(Object)
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/adapter/content/KomgaClient.test.mjs`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create directory structure and file `backend/src/1_adapters/content/readable/komga/KomgaClient.mjs`:

```javascript
// backend/src/1_adapters/content/readable/komga/KomgaClient.mjs

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Low-level Komga API client for making authenticated requests.
 */
export class KomgaClient {
  #host;
  #apiKey;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Komga server URL
   * @param {string} config.apiKey - Komga API key
   * @param {Object} deps
   * @param {Object} deps.httpClient - HttpClient instance
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('KomgaClient requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!config.apiKey) {
      throw new InfrastructureError('KomgaClient requires apiKey', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'apiKey'
      });
    }
    if (!deps.httpClient) {
      throw new InfrastructureError('KomgaClient requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }

    this.#host = config.host.replace(/\/$/, '');
    this.#apiKey = config.apiKey;
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }

  get host() {
    return this.#host;
  }

  /**
   * Get default headers for Komga API
   * @returns {Object}
   */
  #getHeaders() {
    return {
      'X-API-Key': this.#apiKey,
      'Accept': 'application/json'
    };
  }

  /**
   * Get all libraries
   * @returns {Promise<Array>}
   */
  async getLibraries() {
    const response = await this.#httpClient.get(
      `${this.#host}/api/v1/libraries`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get series for a library
   * @param {string} libraryId
   * @param {Object} [options]
   * @param {number} [options.page=0]
   * @param {number} [options.size=20]
   * @returns {Promise<{content: Array, totalElements: number}>}
   */
  async getSeries(libraryId, options = {}) {
    const { page = 0, size = 20 } = options;
    const params = new URLSearchParams({
      library_id: libraryId,
      page: String(page),
      size: String(size)
    });

    const response = await this.#httpClient.get(
      `${this.#host}/api/v1/series?${params}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get books for a series
   * @param {string} seriesId
   * @param {Object} [options]
   * @param {number} [options.page=0]
   * @param {number} [options.size=20]
   * @returns {Promise<{content: Array, totalElements: number}>}
   */
  async getBooks(seriesId, options = {}) {
    const { page = 0, size = 20 } = options;
    const params = new URLSearchParams({
      page: String(page),
      size: String(size)
    });

    const response = await this.#httpClient.get(
      `${this.#host}/api/v1/series/${seriesId}/books?${params}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get a single book by ID
   * @param {string} bookId
   * @returns {Promise<Object>}
   */
  async getBook(bookId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/v1/books/${bookId}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get a single series by ID
   * @param {string} seriesId
   * @returns {Promise<Object>}
   */
  async getSeriesById(seriesId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/v1/series/${seriesId}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Update reading progress for a book
   * @param {string} bookId
   * @param {number} page - Current page (1-indexed)
   * @param {boolean} completed - Whether book is finished
   * @returns {Promise<void>}
   */
  async updateProgress(bookId, page, completed = false) {
    await this.#httpClient.patch(
      `${this.#host}/api/v1/books/${bookId}/read-progress`,
      { page, completed },
      {
        headers: {
          ...this.#getHeaders(),
          'Content-Type': 'application/json'
        }
      }
    );
  }
}

export default KomgaClient;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/adapter/content/KomgaClient.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/readable/komga/KomgaClient.mjs \
        tests/isolated/adapter/content/KomgaClient.test.mjs
git commit -m "feat(adapters): add KomgaClient for Komga API interactions"
```

---

## Task 4: KomgaAdapter Content Source

**Files:**
- Create: `backend/src/1_adapters/content/readable/komga/KomgaAdapter.mjs`
- Create: `backend/src/1_adapters/content/readable/komga/index.mjs`
- Test: `tests/isolated/adapter/content/KomgaAdapter.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapter/content/KomgaAdapter.test.mjs`:

```javascript
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { KomgaAdapter } from '#adapters/content/readable/komga/KomgaAdapter.mjs';

describe('KomgaAdapter', () => {
  const mockHttpClient = {
    get: jest.fn(),
    patch: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('has correct source and prefixes', () => {
      const adapter = new KomgaAdapter(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );
      expect(adapter.source).toBe('komga');
      expect(adapter.prefixes).toContainEqual({ prefix: 'komga' });
    });

    it('throws error when host is missing', () => {
      expect(() => new KomgaAdapter({}, { httpClient: mockHttpClient }))
        .toThrow('KomgaAdapter requires host');
    });
  });

  describe('getItem', () => {
    it('returns ReadableItem for book', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'book-123',
          name: 'Batman #1',
          seriesId: 'series-1',
          media: {
            pagesCount: 24,
            mediaProfile: 'CBZ'
          },
          metadata: {
            readingDirection: 'LEFT_TO_RIGHT'
          },
          readProgress: {
            page: 10,
            completed: false
          }
        }
      });

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('komga:book-123');

      expect(result.id).toBe('komga:book-123');
      expect(result.source).toBe('komga');
      expect(result.title).toBe('Batman #1');
      expect(result.contentType).toBe('paged');
      expect(result.format).toBe('cbz');
      expect(result.totalPages).toBe(24);
      expect(result.readingDirection).toBe('ltr');
      expect(result.resumePosition).toEqual({ type: 'page', page: 10 });
      expect(result.isReadable()).toBe(true);
    });

    it('returns null for non-existent book', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('Not found'));

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('komga:not-found');
      expect(result).toBeNull();
    });
  });

  describe('getList', () => {
    it('returns libraries when id is empty', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: [
          { id: 'lib-1', name: 'Comics' },
          { id: 'lib-2', name: 'Manga' }
        ]
      });

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('komga:lib:lib-1');
      expect(result[0].title).toBe('Comics');
      expect(result[0].itemType).toBe('container');
    });

    it('returns series for library id', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          content: [
            { id: 'series-1', name: 'Batman', booksCount: 10 }
          ]
        }
      });

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('komga:lib:lib-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('komga:series:series-1');
      expect(result[0].title).toBe('Batman');
      expect(result[0].childCount).toBe(10);
    });

    it('returns books for series id', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          content: [
            { id: 'book-1', name: 'Issue #1', media: { pagesCount: 24 } }
          ]
        }
      });

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('komga:series:series-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('komga:book-1');
      expect(result[0].title).toBe('Issue #1');
    });
  });

  describe('resolveReadables', () => {
    it('returns ReadableItem for book ID', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'book-123',
          name: 'Batman #1',
          media: { pagesCount: 24, mediaProfile: 'CBZ' },
          metadata: {}
        }
      });

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.resolveReadables('komga:book-123');

      expect(result).toHaveLength(1);
      expect(result[0].isReadable()).toBe(true);
    });
  });

  describe('resolvePlayables', () => {
    it('returns empty array (readables, not playables)', async () => {
      const adapter = new KomgaAdapter(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.resolvePlayables('komga:book-123');

      expect(result).toEqual([]);
    });
  });

  describe('getPageUrl helper', () => {
    it('generates correct page URL', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'book-123',
          name: 'Batman #1',
          media: { pagesCount: 24, mediaProfile: 'CBZ' },
          metadata: {}
        }
      });

      const adapter = new KomgaAdapter(
        { host: 'http://localhost:8080', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const item = await adapter.getItem('komga:book-123');

      expect(item.getPageUrl(1)).toBe('/api/v1/proxy/komga/api/v1/books/book-123/pages/1');
      expect(item.getPageUrl(24)).toBe('/api/v1/proxy/komga/api/v1/books/book-123/pages/24');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/adapter/content/KomgaAdapter.test.mjs`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `backend/src/1_adapters/content/readable/komga/KomgaAdapter.mjs`:

```javascript
// backend/src/1_adapters/content/readable/komga/KomgaAdapter.mjs

import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { ReadableItem } from '#domains/content/capabilities/Readable.mjs';
import { KomgaClient } from './KomgaClient.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Komga content source adapter.
 * Implements IContentSource for accessing Komga comics, manga, PDFs.
 */
export class KomgaAdapter {
  #client;
  #proxyPath;

  /**
   * @param {Object} config
   * @param {string} config.host - Komga server URL
   * @param {string} config.apiKey - Komga API key
   * @param {string} [config.proxyPath] - Proxy path for URLs (default: '/api/v1/proxy/komga')
   * @param {Object} deps
   * @param {Object} deps.httpClient - HttpClient instance
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('KomgaAdapter requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!config.apiKey) {
      throw new InfrastructureError('KomgaAdapter requires apiKey', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'apiKey'
      });
    }

    this.#client = new KomgaClient(config, deps);
    this.#proxyPath = config.proxyPath || '/api/v1/proxy/komga';
  }

  /** @returns {string} */
  get source() {
    return 'komga';
  }

  /** @returns {Array<{prefix: string}>} */
  get prefixes() {
    return [{ prefix: 'komga' }];
  }

  /**
   * Strip source prefix from ID
   * @param {string} id
   * @returns {string}
   */
  #stripPrefix(id) {
    return String(id || '').replace(/^komga:/, '');
  }

  /**
   * Build thumbnail URL
   * @param {string} bookId
   * @returns {string}
   */
  #thumbnailUrl(bookId) {
    return `${this.#proxyPath}/api/v1/books/${bookId}/thumbnail`;
  }

  /**
   * Build page URL function
   * @param {string} bookId
   * @returns {Function}
   */
  #createGetPageUrl(bookId) {
    return (page) => `${this.#proxyPath}/api/v1/books/${bookId}/pages/${page}`;
  }

  /**
   * Normalize Komga media profile to format
   * @param {string} mediaProfile
   * @returns {string}
   */
  #normalizeFormat(mediaProfile) {
    const profile = (mediaProfile || '').toUpperCase();
    if (profile.includes('PDF')) return 'pdf';
    if (profile.includes('CBR')) return 'cbr';
    if (profile.includes('EPUB')) return 'epub';
    return 'cbz'; // Default
  }

  /**
   * Normalize Komga reading direction
   * @param {string} direction
   * @returns {'ltr'|'rtl'}
   */
  #normalizeDirection(direction) {
    if (direction === 'RIGHT_TO_LEFT') return 'rtl';
    return 'ltr';
  }

  /**
   * Get single item by ID
   * @param {string} id - Compound ID (komga:book-123)
   * @returns {Promise<ReadableItem|null>}
   */
  async getItem(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Book ID (not prefixed with lib: or series:)
      if (!localId.startsWith('lib:') && !localId.startsWith('series:')) {
        const book = await this.#client.getBook(localId);
        return this.#toReadableItem(book);
      }

      return null;
    } catch (err) {
      console.error('[KomgaAdapter] getItem error:', err.message);
      return null;
    }
  }

  /**
   * Get list of items
   * @param {string} id - Empty for libraries, lib:xyz for series, series:xyz for books
   * @returns {Promise<ListableItem[]>}
   */
  async getList(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Empty = list all libraries
      if (!localId) {
        const libraries = await this.#client.getLibraries();
        return libraries.map(lib => this.#toLibraryListable(lib));
      }

      // Library: return series
      if (localId.startsWith('lib:')) {
        const libId = localId.replace('lib:', '');
        const result = await this.#client.getSeries(libId);
        return (result.content || []).map(series => this.#toSeriesListable(series));
      }

      // Series: return books
      if (localId.startsWith('series:')) {
        const seriesId = localId.replace('series:', '');
        const result = await this.#client.getBooks(seriesId);
        return (result.content || []).map(book => this.#toBookListable(book));
      }

      return [];
    } catch (err) {
      console.error('[KomgaAdapter] getList error:', err.message);
      return [];
    }
  }

  /**
   * Resolve to playable items (not applicable for Komga)
   * @returns {Promise<Array>}
   */
  async resolvePlayables() {
    return [];
  }

  /**
   * Resolve to readable items
   * @param {string} id
   * @returns {Promise<ReadableItem[]>}
   */
  async resolveReadables(id) {
    const item = await this.getItem(id);
    return item ? [item] : [];
  }

  /**
   * Convert book to ReadableItem
   * @param {Object} book
   * @returns {ReadableItem}
   */
  #toReadableItem(book) {
    const bookId = book.id;
    const resumePosition = book.readProgress?.page
      ? { type: 'page', page: book.readProgress.page }
      : null;

    return new ReadableItem({
      id: `komga:${bookId}`,
      source: 'komga',
      title: book.name,
      contentType: 'paged',
      format: this.#normalizeFormat(book.media?.mediaProfile),
      totalPages: book.media?.pagesCount || 0,
      pageLayout: 'single',
      readingDirection: this.#normalizeDirection(book.metadata?.readingDirection),
      getPageUrl: this.#createGetPageUrl(bookId),
      manifestUrl: `${this.#proxyPath}/api/v1/books/${bookId}/manifest`,
      thumbnail: this.#thumbnailUrl(bookId),
      resumePosition,
      metadata: {
        seriesId: book.seriesId,
        number: book.number,
        publisher: book.metadata?.publisher,
        ageRating: book.metadata?.ageRating,
        completed: book.readProgress?.completed || false
      }
    });
  }

  /**
   * Convert library to ListableItem
   * @param {Object} library
   * @returns {ListableItem}
   */
  #toLibraryListable(library) {
    return new ListableItem({
      id: `komga:lib:${library.id}`,
      source: 'komga',
      title: library.name,
      itemType: 'container',
      metadata: { type: 'library' }
    });
  }

  /**
   * Convert series to ListableItem
   * @param {Object} series
   * @returns {ListableItem}
   */
  #toSeriesListable(series) {
    return new ListableItem({
      id: `komga:series:${series.id}`,
      source: 'komga',
      title: series.name,
      itemType: 'container',
      childCount: series.booksCount || 0,
      thumbnail: `${this.#proxyPath}/api/v1/series/${series.id}/thumbnail`,
      metadata: { type: 'series' }
    });
  }

  /**
   * Convert book to ListableItem (for browse view)
   * @param {Object} book
   * @returns {ListableItem}
   */
  #toBookListable(book) {
    return new ListableItem({
      id: `komga:${book.id}`,
      source: 'komga',
      title: book.name,
      itemType: 'leaf',
      thumbnail: this.#thumbnailUrl(book.id),
      metadata: {
        type: 'book',
        pagesCount: book.media?.pagesCount,
        format: this.#normalizeFormat(book.media?.mediaProfile)
      }
    });
  }
}

export default KomgaAdapter;
```

**Step 4: Create index file**

Create `backend/src/1_adapters/content/readable/komga/index.mjs`:

```javascript
// backend/src/1_adapters/content/readable/komga/index.mjs

export { KomgaClient } from './KomgaClient.mjs';
export { KomgaAdapter } from './KomgaAdapter.mjs';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/isolated/adapter/content/KomgaAdapter.test.mjs`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/1_adapters/content/readable/komga/KomgaAdapter.mjs \
        backend/src/1_adapters/content/readable/komga/index.mjs \
        tests/isolated/adapter/content/KomgaAdapter.test.mjs
git commit -m "feat(adapters): add KomgaAdapter with IContentSource for comics and manga"
```

---

## Task 5: AudiobookshelfClient API Wrapper

**Files:**
- Create: `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs`
- Test: `tests/isolated/adapter/content/AudiobookshelfClient.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapter/content/AudiobookshelfClient.test.mjs`:

```javascript
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { AudiobookshelfClient } from '#adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs';

describe('AudiobookshelfClient', () => {
  const mockHttpClient = {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('throws error when host is missing', () => {
      expect(() => new AudiobookshelfClient({}, { httpClient: mockHttpClient }))
        .toThrow('AudiobookshelfClient requires host');
    });

    it('throws error when token is missing', () => {
      expect(() => new AudiobookshelfClient({ host: 'http://localhost' }, { httpClient: mockHttpClient }))
        .toThrow('AudiobookshelfClient requires token');
    });

    it('normalizes host URL by removing trailing slash', () => {
      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378/', token: 'test-token' },
        { httpClient: mockHttpClient }
      );
      expect(client.host).toBe('http://localhost:13378');
    });
  });

  describe('getLibraries', () => {
    it('fetches all libraries', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          libraries: [
            { id: 'lib-1', name: 'Audiobooks' },
            { id: 'lib-2', name: 'Ebooks' }
          ]
        }
      });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getLibraries();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:13378/api/libraries',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token'
          })
        })
      );
      expect(result.libraries).toHaveLength(2);
    });
  });

  describe('getLibraryItems', () => {
    it('fetches items for a library', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          results: [
            {
              id: 'item-1',
              media: {
                metadata: { title: 'The Great Novel' },
                ebookFile: { ebookFormat: 'epub' }
              }
            }
          ],
          total: 1
        }
      });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getLibraryItems('lib-1');

      expect(result.results).toHaveLength(1);
      expect(result.results[0].media.metadata.title).toBe('The Great Novel');
    });
  });

  describe('getItem', () => {
    it('fetches single item with expanded details', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'item-123',
          media: {
            metadata: {
              title: 'The Great Novel',
              authorName: 'Jane Author'
            },
            ebookFile: { ebookFormat: 'epub' },
            numAudioFiles: 0
          },
          userMediaProgress: {
            ebookLocation: '/6/14!/4/2/1:0',
            ebookProgress: 0.42
          }
        }
      });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getItem('item-123');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:13378/api/items/item-123?expanded=1',
        expect.any(Object)
      );
      expect(result.id).toBe('item-123');
      expect(result.userMediaProgress.ebookProgress).toBe(0.42);
    });
  });

  describe('getProgress', () => {
    it('fetches user progress for item', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          currentTime: 1234,
          progress: 0.5,
          ebookLocation: '/6/14!/4/2/1:0',
          ebookProgress: 0.42
        }
      });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getProgress('item-123');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:13378/api/me/progress/item-123',
        expect.any(Object)
      );
      expect(result.ebookProgress).toBe(0.42);
    });
  });

  describe('updateProgress', () => {
    it('updates ebook progress', async () => {
      mockHttpClient.patch.mockResolvedValue({ data: {} });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      await client.updateProgress('item-123', {
        ebookLocation: '/6/14!/4/2/1:100',
        ebookProgress: 0.55
      });

      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        'http://localhost:13378/api/me/progress/item-123',
        { ebookLocation: '/6/14!/4/2/1:100', ebookProgress: 0.55 },
        expect.any(Object)
      );
    });

    it('updates audiobook progress', async () => {
      mockHttpClient.patch.mockResolvedValue({ data: {} });

      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      await client.updateProgress('item-123', {
        currentTime: 1500,
        progress: 0.6
      });

      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        'http://localhost:13378/api/me/progress/item-123',
        { currentTime: 1500, progress: 0.6 },
        expect.any(Object)
      );
    });
  });

  describe('isEbook', () => {
    it('returns true when item has ebookFile', () => {
      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const item = {
        media: {
          ebookFile: { ebookFormat: 'epub' },
          numAudioFiles: 0
        }
      };

      expect(client.isEbook(item)).toBe(true);
    });

    it('returns false when item is audiobook', () => {
      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const item = {
        media: {
          numAudioFiles: 10,
          duration: 36000
        }
      };

      expect(client.isEbook(item)).toBe(false);
    });
  });

  describe('isAudiobook', () => {
    it('returns true when item has audio files', () => {
      const client = new AudiobookshelfClient(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const item = {
        media: {
          numAudioFiles: 10,
          duration: 36000
        }
      };

      expect(client.isAudiobook(item)).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/adapter/content/AudiobookshelfClient.test.mjs`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs`:

```javascript
// backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Low-level Audiobookshelf API client for making authenticated requests.
 */
export class AudiobookshelfClient {
  #host;
  #token;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Audiobookshelf server URL
   * @param {string} config.token - Audiobookshelf JWT token
   * @param {Object} deps
   * @param {Object} deps.httpClient - HttpClient instance
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('AudiobookshelfClient requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!config.token) {
      throw new InfrastructureError('AudiobookshelfClient requires token', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'token'
      });
    }
    if (!deps.httpClient) {
      throw new InfrastructureError('AudiobookshelfClient requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }

    this.#host = config.host.replace(/\/$/, '');
    this.#token = config.token;
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }

  get host() {
    return this.#host;
  }

  /**
   * Get default headers for Audiobookshelf API
   * @returns {Object}
   */
  #getHeaders() {
    return {
      'Authorization': `Bearer ${this.#token}`,
      'Accept': 'application/json'
    };
  }

  /**
   * Get all libraries
   * @returns {Promise<{libraries: Array}>}
   */
  async getLibraries() {
    const response = await this.#httpClient.get(
      `${this.#host}/api/libraries`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get items for a library
   * @param {string} libraryId
   * @param {Object} [options]
   * @param {number} [options.page=0]
   * @param {number} [options.limit=20]
   * @returns {Promise<{results: Array, total: number}>}
   */
  async getLibraryItems(libraryId, options = {}) {
    const { page = 0, limit = 20 } = options;
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit)
    });

    const response = await this.#httpClient.get(
      `${this.#host}/api/libraries/${libraryId}/items?${params}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get a single item by ID with expanded details
   * @param {string} itemId
   * @returns {Promise<Object>}
   */
  async getItem(itemId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/items/${itemId}?expanded=1`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get user progress for an item
   * @param {string} itemId
   * @returns {Promise<Object>}
   */
  async getProgress(itemId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/me/progress/${itemId}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Update user progress for an item
   * @param {string} itemId
   * @param {Object} progress
   * @param {number} [progress.currentTime] - Audio position in seconds
   * @param {number} [progress.progress] - Audio progress 0-1
   * @param {string} [progress.ebookLocation] - EPUB CFI
   * @param {number} [progress.ebookProgress] - Ebook progress 0-1
   * @returns {Promise<void>}
   */
  async updateProgress(itemId, progress) {
    await this.#httpClient.patch(
      `${this.#host}/api/me/progress/${itemId}`,
      progress,
      {
        headers: {
          ...this.#getHeaders(),
          'Content-Type': 'application/json'
        }
      }
    );
  }

  /**
   * Check if item is an ebook
   * @param {Object} item
   * @returns {boolean}
   */
  isEbook(item) {
    return Boolean(item.media?.ebookFile);
  }

  /**
   * Check if item is an audiobook
   * @param {Object} item
   * @returns {boolean}
   */
  isAudiobook(item) {
    return (item.media?.numAudioFiles || 0) > 0;
  }
}

export default AudiobookshelfClient;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/adapter/content/AudiobookshelfClient.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs \
        tests/isolated/adapter/content/AudiobookshelfClient.test.mjs
git commit -m "feat(adapters): add AudiobookshelfClient for Audiobookshelf API interactions"
```

---

## Task 6: AudiobookshelfAdapter Content Source

**Files:**
- Create: `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs`
- Create: `backend/src/1_adapters/content/readable/audiobookshelf/index.mjs`
- Test: `tests/isolated/adapter/content/AudiobookshelfAdapter.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapter/content/AudiobookshelfAdapter.test.mjs`:

```javascript
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { AudiobookshelfAdapter } from '#adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs';

describe('AudiobookshelfAdapter', () => {
  const mockHttpClient = {
    get: jest.fn(),
    patch: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('has correct source and prefixes', () => {
      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );
      expect(adapter.source).toBe('abs');
      expect(adapter.prefixes).toContainEqual({ prefix: 'abs' });
    });

    it('throws error when host is missing', () => {
      expect(() => new AudiobookshelfAdapter({}, { httpClient: mockHttpClient }))
        .toThrow('AudiobookshelfAdapter requires host');
    });
  });

  describe('getItem', () => {
    it('returns ReadableItem for ebook', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'item-123',
          media: {
            metadata: {
              title: 'The Great Novel',
              authorName: 'Jane Author',
              seriesName: 'Epic Series'
            },
            ebookFile: { ebookFormat: 'epub' },
            numAudioFiles: 0
          },
          userMediaProgress: {
            ebookLocation: '/6/14!/4/2/1:0',
            ebookProgress: 0.42
          }
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('abs:item-123');

      expect(result.id).toBe('abs:item-123');
      expect(result.source).toBe('abs');
      expect(result.title).toBe('The Great Novel');
      expect(result.contentType).toBe('flow');
      expect(result.format).toBe('epub');
      expect(result.contentUrl).toBe('/api/v1/proxy/abs/api/items/item-123/ebook');
      expect(result.resumePosition).toEqual({
        type: 'flow',
        cfi: '/6/14!/4/2/1:0',
        percent: 42
      });
      expect(result.isReadable()).toBe(true);
    });

    it('returns PlayableItem for audiobook', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'item-456',
          media: {
            metadata: {
              title: 'Audio Novel',
              authorName: 'John Narrator'
            },
            numAudioFiles: 10,
            duration: 36000,
            chapters: [{ title: 'Chapter 1', start: 0 }]
          },
          userMediaProgress: {
            currentTime: 1234
          }
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('abs:item-456');

      expect(result.id).toBe('abs:item-456');
      expect(result.mediaType).toBe('audio');
      expect(result.duration).toBe(36000);
      expect(result.resumePosition).toBe(1234);
      expect(result.isPlayable()).toBe(true);
    });

    it('returns null for non-existent item', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('Not found'));

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('abs:not-found');
      expect(result).toBeNull();
    });
  });

  describe('getList', () => {
    it('returns libraries when id is empty', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          libraries: [
            { id: 'lib-1', name: 'Audiobooks' },
            { id: 'lib-2', name: 'Ebooks' }
          ]
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('abs:lib:lib-1');
      expect(result[0].title).toBe('Audiobooks');
      expect(result[0].itemType).toBe('container');
    });

    it('returns items for library id', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          results: [
            {
              id: 'item-1',
              media: {
                metadata: { title: 'Book One' },
                ebookFile: { ebookFormat: 'epub' }
              }
            }
          ]
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('abs:lib:lib-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('abs:item-1');
      expect(result[0].title).toBe('Book One');
    });
  });

  describe('resolveReadables', () => {
    it('returns ReadableItem for ebook', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'item-123',
          media: {
            metadata: { title: 'The Great Novel' },
            ebookFile: { ebookFormat: 'epub' }
          }
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.resolveReadables('abs:item-123');

      expect(result).toHaveLength(1);
      expect(result[0].isReadable()).toBe(true);
    });

    it('returns empty array for audiobook', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'item-456',
          media: {
            metadata: { title: 'Audio Novel' },
            numAudioFiles: 10
          }
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.resolveReadables('abs:item-456');

      expect(result).toEqual([]);
    });
  });

  describe('resolvePlayables', () => {
    it('returns PlayableItem for audiobook', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'item-456',
          media: {
            metadata: { title: 'Audio Novel' },
            numAudioFiles: 10,
            duration: 36000
          }
        }
      });

      const adapter = new AudiobookshelfAdapter(
        { host: 'http://localhost:13378', token: 'test-token' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.resolvePlayables('abs:item-456');

      expect(result).toHaveLength(1);
      expect(result[0].isPlayable()).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/adapter/content/AudiobookshelfAdapter.test.mjs`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs`:

```javascript
// backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs

import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
import { ReadableItem } from '#domains/content/capabilities/Readable.mjs';
import { AudiobookshelfClient } from './AudiobookshelfClient.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Audiobookshelf content source adapter.
 * Implements IContentSource for accessing audiobooks and ebooks.
 */
export class AudiobookshelfAdapter {
  #client;
  #proxyPath;

  /**
   * @param {Object} config
   * @param {string} config.host - Audiobookshelf server URL
   * @param {string} config.token - Audiobookshelf JWT token
   * @param {string} [config.proxyPath] - Proxy path for URLs (default: '/api/v1/proxy/abs')
   * @param {Object} deps
   * @param {Object} deps.httpClient - HttpClient instance
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('AudiobookshelfAdapter requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!config.token) {
      throw new InfrastructureError('AudiobookshelfAdapter requires token', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'token'
      });
    }

    this.#client = new AudiobookshelfClient(config, deps);
    this.#proxyPath = config.proxyPath || '/api/v1/proxy/abs';
  }

  /** @returns {string} */
  get source() {
    return 'abs';
  }

  /** @returns {Array<{prefix: string}>} */
  get prefixes() {
    return [{ prefix: 'abs' }];
  }

  /**
   * Strip source prefix from ID
   * @param {string} id
   * @returns {string}
   */
  #stripPrefix(id) {
    return String(id || '').replace(/^abs:/, '');
  }

  /**
   * Build cover URL
   * @param {string} itemId
   * @returns {string}
   */
  #coverUrl(itemId) {
    return `${this.#proxyPath}/api/items/${itemId}/cover`;
  }

  /**
   * Build ebook URL
   * @param {string} itemId
   * @returns {string}
   */
  #ebookUrl(itemId) {
    return `${this.#proxyPath}/api/items/${itemId}/ebook`;
  }

  /**
   * Build audio play URL
   * @param {string} itemId
   * @returns {string}
   */
  #audioUrl(itemId) {
    return `${this.#proxyPath}/api/items/${itemId}/play`;
  }

  /**
   * Get single item by ID
   * @param {string} id - Compound ID (abs:item-123)
   * @returns {Promise<ReadableItem|PlayableItem|null>}
   */
  async getItem(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Skip library prefixes
      if (localId.startsWith('lib:')) {
        return null;
      }

      const item = await this.#client.getItem(localId);

      if (this.#client.isEbook(item)) {
        return this.#toReadableItem(item);
      }

      if (this.#client.isAudiobook(item)) {
        return this.#toPlayableItem(item);
      }

      return null;
    } catch (err) {
      console.error('[AudiobookshelfAdapter] getItem error:', err.message);
      return null;
    }
  }

  /**
   * Get list of items
   * @param {string} id - Empty for libraries, lib:xyz for library items
   * @returns {Promise<ListableItem[]>}
   */
  async getList(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Empty = list all libraries
      if (!localId) {
        const result = await this.#client.getLibraries();
        return (result.libraries || []).map(lib => this.#toLibraryListable(lib));
      }

      // Library: return items
      if (localId.startsWith('lib:')) {
        const libId = localId.replace('lib:', '');
        const result = await this.#client.getLibraryItems(libId);
        return (result.results || []).map(item => this.#toItemListable(item));
      }

      return [];
    } catch (err) {
      console.error('[AudiobookshelfAdapter] getList error:', err.message);
      return [];
    }
  }

  /**
   * Resolve to playable items (audiobooks only)
   * @param {string} id
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
    const item = await this.getItem(id);
    return (item && item.isPlayable?.()) ? [item] : [];
  }

  /**
   * Resolve to readable items (ebooks only)
   * @param {string} id
   * @returns {Promise<ReadableItem[]>}
   */
  async resolveReadables(id) {
    const item = await this.getItem(id);
    return (item && item.isReadable?.()) ? [item] : [];
  }

  /**
   * Convert ebook to ReadableItem
   * @param {Object} item
   * @returns {ReadableItem}
   */
  #toReadableItem(item) {
    const progress = item.userMediaProgress;
    const resumePosition = progress?.ebookLocation
      ? {
          type: 'flow',
          cfi: progress.ebookLocation,
          percent: Math.round((progress.ebookProgress || 0) * 100)
        }
      : null;

    return new ReadableItem({
      id: `abs:${item.id}`,
      source: 'abs',
      title: item.media?.metadata?.title || 'Untitled',
      contentType: 'flow',
      format: item.media?.ebookFile?.ebookFormat || 'epub',
      contentUrl: this.#ebookUrl(item.id),
      thumbnail: this.#coverUrl(item.id),
      resumePosition,
      metadata: {
        author: item.media?.metadata?.authorName,
        narrator: item.media?.metadata?.narratorName,
        series: item.media?.metadata?.seriesName,
        description: item.media?.metadata?.description
      }
    });
  }

  /**
   * Convert audiobook to PlayableItem
   * @param {Object} item
   * @returns {PlayableItem}
   */
  #toPlayableItem(item) {
    const progress = item.userMediaProgress;

    return new PlayableItem({
      id: `abs:${item.id}`,
      source: 'abs',
      title: item.media?.metadata?.title || 'Untitled',
      mediaType: 'audio',
      mediaUrl: this.#audioUrl(item.id),
      duration: item.media?.duration || null,
      resumable: true,
      resumePosition: progress?.currentTime || null,
      thumbnail: this.#coverUrl(item.id),
      metadata: {
        author: item.media?.metadata?.authorName,
        narrator: item.media?.metadata?.narratorName,
        series: item.media?.metadata?.seriesName,
        chapters: item.media?.chapters || []
      }
    });
  }

  /**
   * Convert library to ListableItem
   * @param {Object} library
   * @returns {ListableItem}
   */
  #toLibraryListable(library) {
    return new ListableItem({
      id: `abs:lib:${library.id}`,
      source: 'abs',
      title: library.name,
      itemType: 'container',
      metadata: { type: 'library' }
    });
  }

  /**
   * Convert item to ListableItem (for browse view)
   * @param {Object} item
   * @returns {ListableItem}
   */
  #toItemListable(item) {
    const isEbook = this.#client.isEbook(item);
    return new ListableItem({
      id: `abs:${item.id}`,
      source: 'abs',
      title: item.media?.metadata?.title || 'Untitled',
      itemType: 'leaf',
      thumbnail: this.#coverUrl(item.id),
      metadata: {
        type: isEbook ? 'ebook' : 'audiobook',
        author: item.media?.metadata?.authorName,
        duration: item.media?.duration
      }
    });
  }
}

export default AudiobookshelfAdapter;
```

**Step 4: Create index file**

Create `backend/src/1_adapters/content/readable/audiobookshelf/index.mjs`:

```javascript
// backend/src/1_adapters/content/readable/audiobookshelf/index.mjs

export { AudiobookshelfClient } from './AudiobookshelfClient.mjs';
export { AudiobookshelfAdapter } from './AudiobookshelfAdapter.mjs';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/isolated/adapter/content/AudiobookshelfAdapter.test.mjs`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs \
        backend/src/1_adapters/content/readable/audiobookshelf/index.mjs \
        tests/isolated/adapter/content/AudiobookshelfAdapter.test.mjs
git commit -m "feat(adapters): add AudiobookshelfAdapter for ebooks and audiobooks"
```

---

## Task 7: Final Integration Verification

**Step 1: Run all tests**

```bash
npm test -- tests/unit/domains/content/Readable.test.mjs \
            tests/isolated/adapter/proxy/KomgaProxyAdapter.test.mjs \
            tests/isolated/adapter/content/KomgaClient.test.mjs \
            tests/isolated/adapter/content/KomgaAdapter.test.mjs \
            tests/isolated/adapter/content/AudiobookshelfClient.test.mjs \
            tests/isolated/adapter/content/AudiobookshelfAdapter.test.mjs
```

Expected: All PASS

**Step 2: Verify imports work**

```bash
node -e "import('#adapters/content/readable/komga/index.mjs').then(m => console.log('Komga adapter:', Object.keys(m)))"
node -e "import('#adapters/content/readable/audiobookshelf/index.mjs').then(m => console.log('ABS adapter:', Object.keys(m)))"
```

**Step 3: Final commit summary**

```bash
git log --oneline -7
```

Should show:
- feat(adapters): add AudiobookshelfAdapter for ebooks and audiobooks
- feat(adapters): add AudiobookshelfClient for Audiobookshelf API interactions
- feat(adapters): add KomgaAdapter with IContentSource for comics and manga
- feat(adapters): add KomgaClient for Komga API interactions
- feat(adapters): add KomgaProxyAdapter for Komga API passthrough
- feat(content): add ReadableItem capability for page-turn content

---

## Summary

| Task | Component | Tests | Status |
|------|-----------|-------|--------|
| 1 | ReadableItem capability | 14 tests | |
| 2 | KomgaProxyAdapter | 7 tests | |
| 3 | KomgaClient | 6 tests | |
| 4 | KomgaAdapter | 8 tests | |
| 5 | AudiobookshelfClient | 10 tests | |
| 6 | AudiobookshelfAdapter | 9 tests | |
| 7 | Integration verification | - | |

**Total: 54 tests across 6 implementation tasks**

---

## Future Tasks (Not in this plan)

These items are mentioned in the design document but deferred:

1. **Proxy Routes** - Add `/api/v1/proxy/komga/*` route registration
2. **API Routes** - Add `/api/v1/readable/:id` endpoints
3. **Progress Sync** - Bidirectional progress synchronization
4. **Frontend PagedReader** - React component for Komga content
5. **Frontend FlowReader** - React component with epub.js for ABS ebooks
6. **Audio-synced reading** - Link audiobooks with companion ebooks
