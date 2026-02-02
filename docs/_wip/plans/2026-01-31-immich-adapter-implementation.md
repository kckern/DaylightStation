# Immich Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement ImmichClient + ImmichAdapter for gallery content, ViewableItem capability, and IMediaSearchable interface.

**Architecture:** Domain-first TDD approach. Create domain interfaces and capabilities first, then adapter layer, following Plex pattern. All image/video URLs proxied through existing ImmichProxyAdapter.

**Tech Stack:** Node.js ES modules, Jest for testing, existing HttpClient for API calls.

---

## Task 1: ViewableItem Capability

**Files:**
- Create: `backend/src/2_domains/content/capabilities/Viewable.mjs`
- Modify: `backend/src/2_domains/content/index.mjs`
- Test: `tests/isolated/domain/content/Viewable.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/domain/content/Viewable.test.mjs`:

```javascript
import { ViewableItem } from '#domains/content/capabilities/Viewable.mjs';

describe('ViewableItem', () => {
  describe('constructor', () => {
    test('creates viewable with required properties', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Beach Photo.jpg',
        imageUrl: '/api/v1/proxy/immich/assets/abc-123/original'
      });

      expect(viewable.id).toBe('immich:abc-123');
      expect(viewable.source).toBe('immich');
      expect(viewable.title).toBe('Beach Photo.jpg');
      expect(viewable.imageUrl).toBe('/api/v1/proxy/immich/assets/abc-123/original');
    });

    test('sets optional properties with defaults', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Photo.jpg',
        imageUrl: '/image.jpg'
      });

      expect(viewable.thumbnail).toBeNull();
      expect(viewable.width).toBeNull();
      expect(viewable.height).toBeNull();
      expect(viewable.mimeType).toBeNull();
    });

    test('accepts all optional properties', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Photo.jpg',
        imageUrl: '/original.jpg',
        thumbnail: '/thumb.jpg',
        width: 1920,
        height: 1080,
        mimeType: 'image/jpeg',
        metadata: { exif: { iso: 200 } }
      });

      expect(viewable.thumbnail).toBe('/thumb.jpg');
      expect(viewable.width).toBe(1920);
      expect(viewable.height).toBe(1080);
      expect(viewable.mimeType).toBe('image/jpeg');
      expect(viewable.metadata.exif.iso).toBe(200);
    });
  });

  describe('aspectRatio', () => {
    test('calculates aspect ratio from dimensions', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Photo.jpg',
        imageUrl: '/image.jpg',
        width: 1920,
        height: 1080
      });

      expect(viewable.aspectRatio).toBeCloseTo(1.777, 2);
    });

    test('returns null when dimensions missing', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Photo.jpg',
        imageUrl: '/image.jpg'
      });

      expect(viewable.aspectRatio).toBeNull();
    });

    test('returns null when only width provided', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Photo.jpg',
        imageUrl: '/image.jpg',
        width: 1920
      });

      expect(viewable.aspectRatio).toBeNull();
    });
  });

  describe('isViewable', () => {
    test('returns true', () => {
      const viewable = new ViewableItem({
        id: 'immich:abc-123',
        source: 'immich',
        title: 'Photo.jpg',
        imageUrl: '/image.jpg'
      });

      expect(viewable.isViewable()).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/domain/content/Viewable.test.mjs`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `backend/src/2_domains/content/capabilities/Viewable.mjs`:

```javascript
// backend/src/2_domains/content/capabilities/Viewable.mjs
import { Item } from '../entities/Item.mjs';

/**
 * Viewable capability - static media for display (not played)
 * Use cases: Art display, single photo view, ambient backgrounds
 */
export class ViewableItem extends Item {
  /**
   * @param {Object} props
   * @param {string} props.id - Compound ID
   * @param {string} props.source - Adapter source
   * @param {string} props.title - Display title
   * @param {string} props.imageUrl - Full resolution image URL (proxied)
   * @param {string} [props.thumbnail] - Thumbnail URL (for previews)
   * @param {number} [props.width] - Image width
   * @param {number} [props.height] - Image height
   * @param {string} [props.mimeType] - image/jpeg, image/webp, etc.
   * @param {Object} [props.metadata] - EXIF, location, people, etc.
   */
  constructor(props) {
    super(props);
    this.imageUrl = props.imageUrl;
    this.width = props.width ?? null;
    this.height = props.height ?? null;
    this.mimeType = props.mimeType ?? null;
  }

  /**
   * Get aspect ratio (width / height)
   * @returns {number|null}
   */
  get aspectRatio() {
    if (!this.width || !this.height) return null;
    return this.width / this.height;
  }

  /**
   * Check if item is viewable
   * @returns {boolean}
   */
  isViewable() {
    return true;
  }
}

export default ViewableItem;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/domain/content/Viewable.test.mjs`
Expected: PASS

**Step 5: Export from index**

Modify `backend/src/2_domains/content/index.mjs`, add after QueueableItem export:

```javascript
export { ViewableItem } from './capabilities/Viewable.mjs';
```

**Step 6: Commit**

```bash
git add backend/src/2_domains/content/capabilities/Viewable.mjs \
        backend/src/2_domains/content/index.mjs \
        tests/isolated/domain/content/Viewable.test.mjs
git commit -m "feat(content): add ViewableItem capability for static image display"
```

---

## Task 2: IMediaSearchable Interface

**Files:**
- Create: `backend/src/2_domains/media/IMediaSearchable.mjs`
- Modify: `backend/src/2_domains/media/index.mjs`
- Test: `tests/isolated/domain/media/IMediaSearchable.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/domain/media/IMediaSearchable.test.mjs`:

```javascript
import { isMediaSearchable, validateSearchQuery } from '#domains/media/IMediaSearchable.mjs';

describe('IMediaSearchable', () => {
  describe('isMediaSearchable', () => {
    test('returns true for object with search method', () => {
      const adapter = {
        search: async () => ({ items: [], total: 0 }),
        getSearchCapabilities: () => ['text']
      };
      expect(isMediaSearchable(adapter)).toBe(true);
    });

    test('returns false for object without search method', () => {
      const adapter = {
        getList: async () => []
      };
      expect(isMediaSearchable(adapter)).toBe(false);
    });

    test('returns false for null', () => {
      expect(isMediaSearchable(null)).toBe(false);
    });
  });

  describe('validateSearchQuery', () => {
    test('accepts valid query with text', () => {
      const query = { text: 'beach vacation' };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });

    test('accepts valid query with date range', () => {
      const query = { dateFrom: '2025-01-01', dateTo: '2025-12-31' };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });

    test('accepts valid query with people', () => {
      const query = { people: ['Felix', 'Milo'] };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });

    test('accepts valid query with mediaType', () => {
      const query = { mediaType: 'image' };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });

    test('rejects invalid mediaType', () => {
      const query = { mediaType: 'invalid' };
      expect(() => validateSearchQuery(query)).toThrow('Invalid mediaType');
    });

    test('accepts empty query', () => {
      expect(() => validateSearchQuery({})).not.toThrow();
    });

    test('accepts query with pagination', () => {
      const query = { take: 50, skip: 100 };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });

    test('rejects negative take', () => {
      const query = { take: -1 };
      expect(() => validateSearchQuery(query)).toThrow('take must be positive');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/domain/media/IMediaSearchable.test.mjs`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `backend/src/2_domains/media/IMediaSearchable.mjs`:

```javascript
// backend/src/2_domains/media/IMediaSearchable.mjs

/**
 * @typedef {Object} MediaSearchQuery
 * @property {string} [text] - Free text search (title, description)
 * @property {string[]} [people] - Person names or IDs
 * @property {string} [dateFrom] - ISO date start
 * @property {string} [dateTo] - ISO date end
 * @property {string} [location] - City, state, or country
 * @property {number[]} [coordinates] - [lat, lng] for geo search
 * @property {number} [radius] - Radius in km (with coordinates)
 * @property {'image'|'video'|'audio'} [mediaType] - Filter by type
 * @property {boolean} [favorites] - Only favorites
 * @property {number} [ratingMin] - Minimum rating (1-5)
 * @property {string[]} [tags] - Tag/label names
 * @property {number} [take] - Limit results
 * @property {number} [skip] - Offset for pagination
 * @property {'date'|'title'|'random'} [sort] - Sort order
 */

/**
 * @typedef {Object} MediaSearchResult
 * @property {Array} items - Matched items (ListableItem|PlayableItem|ViewableItem)
 * @property {number} total - Total matches (for pagination)
 * @property {Object} [facets] - Aggregations (people counts, date buckets)
 */

const VALID_MEDIA_TYPES = ['image', 'video', 'audio'];
const VALID_SORT_OPTIONS = ['date', 'title', 'random'];

/**
 * Check if an object implements IMediaSearchable
 * @param {Object} obj
 * @returns {boolean}
 */
export function isMediaSearchable(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.search === 'function' &&
    typeof obj.getSearchCapabilities === 'function'
  );
}

/**
 * Validate a search query object
 * @param {MediaSearchQuery} query
 * @throws {Error} If query is invalid
 */
export function validateSearchQuery(query) {
  if (query.mediaType && !VALID_MEDIA_TYPES.includes(query.mediaType)) {
    throw new Error(`Invalid mediaType: ${query.mediaType}. Must be one of: ${VALID_MEDIA_TYPES.join(', ')}`);
  }

  if (query.sort && !VALID_SORT_OPTIONS.includes(query.sort)) {
    throw new Error(`Invalid sort: ${query.sort}. Must be one of: ${VALID_SORT_OPTIONS.join(', ')}`);
  }

  if (query.take !== undefined && query.take < 0) {
    throw new Error('take must be positive');
  }

  if (query.skip !== undefined && query.skip < 0) {
    throw new Error('skip must be non-negative');
  }

  if (query.ratingMin !== undefined && (query.ratingMin < 1 || query.ratingMin > 5)) {
    throw new Error('ratingMin must be between 1 and 5');
  }
}

/**
 * IMediaSearchable interface definition (for documentation)
 */
export const IMediaSearchable = {
  /**
   * Search for media items matching query
   * @param {MediaSearchQuery} query
   * @returns {Promise<MediaSearchResult>}
   */
  async search(query) {},

  /**
   * Get available search capabilities for this adapter
   * @returns {string[]} - Supported query fields
   */
  getSearchCapabilities() {
    return [];
  }
};

export default { isMediaSearchable, validateSearchQuery, IMediaSearchable };
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/domain/media/IMediaSearchable.test.mjs`
Expected: PASS

**Step 5: Export from index**

Modify `backend/src/2_domains/media/index.mjs`, add:

```javascript
export { isMediaSearchable, validateSearchQuery, IMediaSearchable } from './IMediaSearchable.mjs';
```

**Step 6: Commit**

```bash
git add backend/src/2_domains/media/IMediaSearchable.mjs \
        backend/src/2_domains/media/index.mjs \
        tests/isolated/domain/media/IMediaSearchable.test.mjs
git commit -m "feat(media): add IMediaSearchable interface for unified search"
```

---

## Task 3: Update MediaKeyResolver for Immich

**Files:**
- Modify: `backend/src/2_domains/media/MediaKeyResolver.mjs`
- Test: `tests/unit/domains/media/MediaKeyResolver.test.mjs` (existing)

**Step 1: Write the failing test**

Add to existing `tests/unit/domains/media/MediaKeyResolver.test.mjs`:

```javascript
describe('Immich UUID pattern', () => {
  test('recognizes immich as known source', () => {
    const resolver = new MediaKeyResolver({
      knownSources: ['plex', 'immich', 'folder']
    });
    expect(resolver.isCompound('immich:abc-123-def')).toBe(true);
  });

  test('resolves UUID pattern to immich source', () => {
    const resolver = new MediaKeyResolver({
      knownSources: ['plex', 'immich', 'folder'],
      defaults: {
        patterns: [
          { match: '^\\d+$', source: 'plex' },
          { match: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', source: 'immich' }
        ],
        fallbackChain: ['plex', 'immich']
      }
    });

    const result = resolver.resolve('931cb18f-2642-489b-bff5-c554e8ad4249');
    expect(result).toBe('immich:931cb18f-2642-489b-bff5-c554e8ad4249');
  });

  test('numeric ID still resolves to plex', () => {
    const resolver = new MediaKeyResolver({
      knownSources: ['plex', 'immich', 'folder'],
      defaults: {
        patterns: [
          { match: '^\\d+$', source: 'plex' },
          { match: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', source: 'immich' }
        ],
        fallbackChain: ['plex', 'immich']
      }
    });

    const result = resolver.resolve('12345');
    expect(result).toBe('plex:12345');
  });
});
```

**Step 2: Run test to verify behavior**

Run: `npm test -- tests/unit/domains/media/MediaKeyResolver.test.mjs`
Expected: Tests should pass (MediaKeyResolver is already pattern-based; just needs config)

**Step 3: Commit**

```bash
git add tests/unit/domains/media/MediaKeyResolver.test.mjs
git commit -m "test(media): add MediaKeyResolver tests for Immich UUID pattern"
```

---

## Task 4: ImmichClient - API Wrapper

**Files:**
- Create: `backend/src/1_adapters/content/gallery/immich/ImmichClient.mjs`
- Test: `tests/isolated/adapter/content/ImmichClient.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapter/content/ImmichClient.test.mjs`:

```javascript
import { jest } from '@jest/globals';
import { ImmichClient } from '#adapters/content/gallery/immich/ImmichClient.mjs';

describe('ImmichClient', () => {
  const mockHttpClient = {
    get: jest.fn(),
    post: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('throws error when host is missing', () => {
      expect(() => new ImmichClient({}, { httpClient: mockHttpClient }))
        .toThrow('ImmichClient requires host');
    });

    test('throws error when apiKey is missing', () => {
      expect(() => new ImmichClient({ host: 'http://localhost:2283' }, { httpClient: mockHttpClient }))
        .toThrow('ImmichClient requires apiKey');
    });

    test('throws error when httpClient is missing', () => {
      expect(() => new ImmichClient({ host: 'http://localhost:2283', apiKey: 'test-key' }, {}))
        .toThrow('ImmichClient requires httpClient');
    });

    test('normalizes host URL by removing trailing slash', () => {
      const client = new ImmichClient(
        { host: 'http://localhost:2283/', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );
      expect(client.host).toBe('http://localhost:2283');
    });
  });

  describe('getAsset', () => {
    test('fetches single asset by ID', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'abc-123',
          type: 'IMAGE',
          originalFileName: 'photo.jpg'
        }
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getAsset('abc-123');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:2283/api/assets/abc-123',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-key'
          })
        })
      );
      expect(result.id).toBe('abc-123');
    });
  });

  describe('getAlbums', () => {
    test('fetches all albums', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: [
          { id: 'album-1', albumName: 'Vacation' },
          { id: 'album-2', albumName: 'Family' }
        ]
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getAlbums();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        'http://localhost:2283/api/albums',
        expect.any(Object)
      );
      expect(result).toHaveLength(2);
      expect(result[0].albumName).toBe('Vacation');
    });
  });

  describe('searchMetadata', () => {
    test('searches with filters', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: {
          assets: {
            items: [{ id: 'abc-123', type: 'IMAGE' }],
            total: 1
          }
        }
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.searchMetadata({ type: 'IMAGE', take: 10 });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        'http://localhost:2283/api/search/metadata',
        { type: 'IMAGE', take: 10 },
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-key',
            'Content-Type': 'application/json'
          })
        })
      );
      expect(result.items).toHaveLength(1);
    });
  });

  describe('getPeople', () => {
    test('fetches people list', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          people: [
            { id: 'person-1', name: 'Felix' },
            { id: 'person-2', name: 'Milo' }
          ]
        }
      });

      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await client.getPeople();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Felix');
    });
  });

  describe('parseDuration', () => {
    test('parses video duration string to seconds', () => {
      const client = new ImmichClient(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      expect(client.parseDuration('00:05:17.371')).toBe(317);
      expect(client.parseDuration('01:30:00.000')).toBe(5400);
      expect(client.parseDuration('0:00:00.00000')).toBeNull();
      expect(client.parseDuration(null)).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/adapter/content/ImmichClient.test.mjs`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create directory and file `backend/src/1_adapters/content/gallery/immich/ImmichClient.mjs`:

```javascript
// backend/src/1_adapters/content/gallery/immich/ImmichClient.mjs

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Low-level Immich API client for making authenticated requests.
 */
export class ImmichClient {
  #host;
  #apiKey;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.host - Immich server URL (e.g., http://localhost:2283)
   * @param {string} config.apiKey - Immich API key
   * @param {Object} deps
   * @param {Object} deps.httpClient - HttpClient instance
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('ImmichClient requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!config.apiKey) {
      throw new InfrastructureError('ImmichClient requires apiKey', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'apiKey'
      });
    }
    if (!deps.httpClient) {
      throw new InfrastructureError('ImmichClient requires httpClient', {
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
   * Get default headers for Immich API
   * @returns {Object}
   */
  #getHeaders() {
    return {
      'x-api-key': this.#apiKey,
      'Accept': 'application/json'
    };
  }

  /**
   * Get a single asset by ID
   * @param {string} id - Asset UUID
   * @returns {Promise<Object>}
   */
  async getAsset(id) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/assets/${id}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get all albums
   * @returns {Promise<Array>}
   */
  async getAlbums() {
    const response = await this.#httpClient.get(
      `${this.#host}/api/albums`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Get album with assets
   * @param {string} albumId - Album UUID
   * @returns {Promise<Object>}
   */
  async getAlbum(albumId) {
    const response = await this.#httpClient.get(
      `${this.#host}/api/albums/${albumId}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Search assets using metadata filters
   * @param {Object} query - Search parameters
   * @returns {Promise<{items: Array, total: number}>}
   */
  async searchMetadata(query) {
    const response = await this.#httpClient.post(
      `${this.#host}/api/search/metadata`,
      query,
      {
        headers: {
          ...this.#getHeaders(),
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.assets || { items: [], total: 0 };
  }

  /**
   * Get people (face recognition)
   * @returns {Promise<Array>}
   */
  async getPeople() {
    const response = await this.#httpClient.get(
      `${this.#host}/api/people`,
      { headers: this.#getHeaders() }
    );
    // API returns { people: [...] } or array directly
    return response.data.people || response.data || [];
  }

  /**
   * Get timeline buckets
   * @param {string} [size='MONTH'] - Bucket size (DAY, MONTH)
   * @returns {Promise<Array>}
   */
  async getTimelineBuckets(size = 'MONTH') {
    const response = await this.#httpClient.get(
      `${this.#host}/api/timeline/buckets?size=${size}`,
      { headers: this.#getHeaders() }
    );
    return response.data;
  }

  /**
   * Parse Immich duration string to seconds
   * @param {string} durationStr - "HH:MM:SS.mmm" format
   * @returns {number|null}
   */
  parseDuration(durationStr) {
    if (!durationStr || durationStr === '0:00:00.00000') return null;
    const parts = durationStr.split(':');
    if (parts.length !== 3) return null;
    const [h, m, rest] = parts;
    const [s] = rest.split('.');
    return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10);
  }
}

export default ImmichClient;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/adapter/content/ImmichClient.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/gallery/immich/ImmichClient.mjs \
        tests/isolated/adapter/content/ImmichClient.test.mjs
git commit -m "feat(adapters): add ImmichClient for Immich API interactions"
```

---

## Task 5: ImmichAdapter - Content Source

**Files:**
- Create: `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`
- Create: `backend/src/1_adapters/content/gallery/immich/manifest.mjs`
- Test: `tests/isolated/adapter/content/ImmichAdapter.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapter/content/ImmichAdapter.test.mjs`:

```javascript
import { jest } from '@jest/globals';
import { ImmichAdapter } from '#adapters/content/gallery/immich/ImmichAdapter.mjs';

describe('ImmichAdapter', () => {
  const mockHttpClient = {
    get: jest.fn(),
    post: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('has correct source and prefixes', () => {
      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );
      expect(adapter.source).toBe('immich');
      expect(adapter.prefixes).toContainEqual({ prefix: 'immich' });
    });

    test('throws error when host is missing', () => {
      expect(() => new ImmichAdapter({}, { httpClient: mockHttpClient }))
        .toThrow('ImmichAdapter requires host');
    });
  });

  describe('getItem', () => {
    test('returns ListableItem for image asset', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'abc-123',
          type: 'IMAGE',
          originalFileName: 'beach.jpg',
          width: 1920,
          height: 1080,
          thumbhash: 'abc',
          isFavorite: false,
          exifInfo: {
            dateTimeOriginal: '2025-12-25T10:00:00Z',
            city: 'Seattle'
          }
        }
      });

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('immich:abc-123');

      expect(result.id).toBe('immich:abc-123');
      expect(result.source).toBe('immich');
      expect(result.title).toBe('beach.jpg');
      expect(result.itemType).toBe('leaf');
      expect(result.thumbnail).toBe('/api/v1/proxy/immich/assets/abc-123/thumbnail');
    });

    test('returns PlayableItem for video asset', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'video-123',
          type: 'VIDEO',
          originalFileName: 'clip.mp4',
          duration: '00:01:30.000',
          width: 1920,
          height: 1080
        }
      });

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('immich:video-123');

      expect(result.id).toBe('immich:video-123');
      expect(result.mediaType).toBe('video');
      expect(result.duration).toBe(90);
      expect(result.mediaUrl).toBe('/api/v1/proxy/immich/assets/video-123/video/playback');
    });

    test('returns null for non-existent asset', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('Not found'));

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getItem('immich:not-found');
      expect(result).toBeNull();
    });
  });

  describe('getList', () => {
    test('returns albums when id is empty', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: [
          { id: 'album-1', albumName: 'Vacation', assetCount: 50, albumThumbnailAssetId: 'thumb-1' },
          { id: 'album-2', albumName: 'Family', assetCount: 100, albumThumbnailAssetId: 'thumb-2' }
        ]
      });

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('immich:album-1');
      expect(result[0].title).toBe('Vacation');
      expect(result[0].itemType).toBe('container');
      expect(result[0].childCount).toBe(50);
    });

    test('returns assets for album id', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'album-1',
          albumName: 'Vacation',
          assets: [
            { id: 'asset-1', type: 'IMAGE', originalFileName: 'photo1.jpg' },
            { id: 'asset-2', type: 'VIDEO', originalFileName: 'video1.mp4', duration: '00:00:30.000' }
          ]
        }
      });

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getList('immich:album:album-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('immich:asset-1');
      expect(result[1].id).toBe('immich:asset-2');
    });
  });

  describe('getViewable', () => {
    test('returns ViewableItem for image', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          id: 'abc-123',
          type: 'IMAGE',
          originalFileName: 'photo.jpg',
          originalMimeType: 'image/jpeg',
          width: 4000,
          height: 3000,
          exifInfo: { iso: 200, city: 'Seattle' },
          people: [{ id: 'p1', name: 'Felix' }]
        }
      });

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getViewable('immich:abc-123');

      expect(result.id).toBe('immich:abc-123');
      expect(result.imageUrl).toBe('/api/v1/proxy/immich/assets/abc-123/original');
      expect(result.thumbnail).toBe('/api/v1/proxy/immich/assets/abc-123/thumbnail');
      expect(result.width).toBe(4000);
      expect(result.height).toBe(3000);
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.isViewable()).toBe(true);
    });
  });

  describe('search', () => {
    test('searches with people filter', async () => {
      // Mock getPeople for name->ID resolution
      mockHttpClient.get.mockResolvedValueOnce({
        data: [
          { id: 'person-1', name: 'Felix' },
          { id: 'person-2', name: 'Milo' }
        ]
      });

      // Mock searchMetadata
      mockHttpClient.post.mockResolvedValue({
        data: {
          assets: {
            items: [{ id: 'abc-123', type: 'IMAGE', originalFileName: 'photo.jpg' }],
            total: 1
          }
        }
      });

      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.search({ people: ['Felix'], mediaType: 'image' });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/search/metadata'),
        expect.objectContaining({ personIds: ['person-1'], type: 'IMAGE' }),
        expect.any(Object)
      );
    });
  });

  describe('getSearchCapabilities', () => {
    test('returns supported search fields', () => {
      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const caps = adapter.getSearchCapabilities();

      expect(caps).toContain('text');
      expect(caps).toContain('people');
      expect(caps).toContain('dateFrom');
      expect(caps).toContain('dateTo');
      expect(caps).toContain('location');
      expect(caps).toContain('mediaType');
      expect(caps).toContain('favorites');
    });
  });

  describe('getStoragePath', () => {
    test('returns immich as storage path', async () => {
      const adapter = new ImmichAdapter(
        { host: 'http://localhost:2283', apiKey: 'test-key' },
        { httpClient: mockHttpClient }
      );

      const result = await adapter.getStoragePath('abc-123');
      expect(result).toBe('immich');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/adapter/content/ImmichAdapter.test.mjs`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`:

```javascript
// backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs

import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
import { ViewableItem } from '#domains/content/capabilities/Viewable.mjs';
import { ImmichClient } from './ImmichClient.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Immich content source adapter.
 * Implements IContentSource + IMediaSearchable for accessing Immich gallery.
 */
export class ImmichAdapter {
  #client;
  #proxyPath;
  #peopleCache;
  #peopleCacheTime;

  /**
   * @param {Object} config
   * @param {string} config.host - Immich server URL
   * @param {string} config.apiKey - Immich API key
   * @param {string} [config.proxyPath] - Proxy path for URLs (default: '/api/v1/proxy/immich')
   * @param {number} [config.slideDuration] - Default slide duration in seconds (default: 10)
   * @param {Object} deps
   * @param {Object} deps.httpClient - HttpClient instance
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('ImmichAdapter requires host', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'host'
      });
    }
    if (!config.apiKey) {
      throw new InfrastructureError('ImmichAdapter requires apiKey', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'apiKey'
      });
    }

    this.#client = new ImmichClient(config, deps);
    this.#proxyPath = config.proxyPath || '/api/v1/proxy/immich';
    this.slideDuration = config.slideDuration || 10;
    this.#peopleCache = null;
    this.#peopleCacheTime = 0;
  }

  /** @returns {string} */
  get source() {
    return 'immich';
  }

  /** @returns {Array<{prefix: string}>} */
  get prefixes() {
    return [{ prefix: 'immich' }];
  }

  /**
   * Strip source prefix from ID
   * @param {string} id
   * @returns {string}
   */
  #stripPrefix(id) {
    return String(id || '').replace(/^immich:/, '');
  }

  /**
   * Build thumbnail URL
   * @param {string} assetId
   * @returns {string}
   */
  #thumbnailUrl(assetId) {
    return `${this.#proxyPath}/assets/${assetId}/thumbnail`;
  }

  /**
   * Build video playback URL
   * @param {string} assetId
   * @returns {string}
   */
  #videoUrl(assetId) {
    return `${this.#proxyPath}/assets/${assetId}/video/playback`;
  }

  /**
   * Build original image URL
   * @param {string} assetId
   * @returns {string}
   */
  #originalUrl(assetId) {
    return `${this.#proxyPath}/assets/${assetId}/original`;
  }

  /**
   * Get single item by ID
   * @param {string} id - Compound ID (immich:abc-123)
   * @returns {Promise<ListableItem|PlayableItem|null>}
   */
  async getItem(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Check if it's an album reference
      if (localId.startsWith('album:')) {
        const albumId = localId.replace('album:', '');
        const album = await this.#client.getAlbum(albumId);
        return this.#toAlbumListable(album);
      }

      const asset = await this.#client.getAsset(localId);
      if (!asset) return null;

      if (asset.type === 'VIDEO') {
        return this.#toPlayableItem(asset);
      }
      return this.#toListableItem(asset);
    } catch (err) {
      console.error('[ImmichAdapter] getItem error:', err.message);
      return null;
    }
  }

  /**
   * Get list of items
   * @param {string} id - Empty for albums, album:xyz for album contents
   * @returns {Promise<ListableItem[]>}
   */
  async getList(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Empty = list all albums
      if (!localId) {
        const albums = await this.#client.getAlbums();
        return albums.map(album => this.#toAlbumListable(album));
      }

      // Album contents
      if (localId.startsWith('album:')) {
        const albumId = localId.replace('album:', '');
        const album = await this.#client.getAlbum(albumId);
        return (album.assets || []).map(asset =>
          asset.type === 'VIDEO' ? this.#toPlayableItem(asset) : this.#toListableItem(asset)
        );
      }

      return [];
    } catch (err) {
      console.error('[ImmichAdapter] getList error:', err.message);
      return [];
    }
  }

  /**
   * Resolve to playable items (for slideshows)
   * @param {string} id - Album or asset ID
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
    try {
      const localId = this.#stripPrefix(id);

      // Single asset
      if (!localId.startsWith('album:')) {
        const asset = await this.#client.getAsset(localId);
        if (!asset) return [];
        return [this.#toPlayableItem(asset, true)];
      }

      // Album = all assets as slideshow
      const albumId = localId.replace('album:', '');
      const album = await this.#client.getAlbum(albumId);
      return (album.assets || []).map(asset => this.#toPlayableItem(asset, true));
    } catch (err) {
      console.error('[ImmichAdapter] resolvePlayables error:', err.message);
      return [];
    }
  }

  /**
   * Get ViewableItem for static display
   * @param {string} id
   * @returns {Promise<ViewableItem|null>}
   */
  async getViewable(id) {
    try {
      const localId = this.#stripPrefix(id);
      const asset = await this.#client.getAsset(localId);
      if (!asset) return null;

      return new ViewableItem({
        id: `immich:${asset.id}`,
        source: 'immich',
        title: asset.originalFileName,
        imageUrl: this.#originalUrl(asset.id),
        thumbnail: this.#thumbnailUrl(asset.id),
        width: asset.width,
        height: asset.height,
        mimeType: asset.originalMimeType,
        metadata: {
          exif: asset.exifInfo,
          people: asset.people?.map(p => p.name) || [],
          capturedAt: asset.exifInfo?.dateTimeOriginal,
          favorite: asset.isFavorite
        }
      });
    } catch (err) {
      console.error('[ImmichAdapter] getViewable error:', err.message);
      return null;
    }
  }

  /**
   * Search for media items
   * @param {Object} query - MediaSearchQuery
   * @returns {Promise<{items: Array, total: number}>}
   */
  async search(query) {
    try {
      const immichQuery = await this.#buildImmichQuery(query);
      const result = await this.#client.searchMetadata(immichQuery);

      const items = (result.items || []).map(asset =>
        asset.type === 'VIDEO' ? this.#toPlayableItem(asset) : this.#toListableItem(asset)
      );

      return { items, total: result.total || items.length };
    } catch (err) {
      console.error('[ImmichAdapter] search error:', err.message);
      return { items: [], total: 0 };
    }
  }

  /**
   * Get search capabilities
   * @returns {string[]}
   */
  getSearchCapabilities() {
    return ['text', 'people', 'dateFrom', 'dateTo', 'location', 'mediaType', 'favorites', 'tags'];
  }

  /**
   * Get storage path for progress persistence
   * @returns {Promise<string>}
   */
  async getStoragePath() {
    return 'immich';
  }

  /**
   * Build Immich search query from MediaSearchQuery
   * @param {Object} query
   * @returns {Promise<Object>}
   */
  async #buildImmichQuery(query) {
    const immichQuery = {};

    if (query.text) {
      immichQuery.query = query.text;
    }

    if (query.mediaType) {
      immichQuery.type = query.mediaType.toUpperCase();
    }

    if (query.dateFrom) {
      immichQuery.takenAfter = query.dateFrom;
    }

    if (query.dateTo) {
      immichQuery.takenBefore = query.dateTo;
    }

    if (query.location) {
      immichQuery.city = query.location;
    }

    if (query.favorites) {
      immichQuery.isFavorite = true;
    }

    if (query.take) {
      immichQuery.take = query.take;
    }

    if (query.skip) {
      immichQuery.skip = query.skip;
    }

    // Resolve people names to IDs
    if (query.people?.length > 0) {
      const personIds = await this.#resolvePersonIds(query.people);
      if (personIds.length > 0) {
        immichQuery.personIds = personIds;
      }
    }

    return immichQuery;
  }

  /**
   * Resolve person names to Immich person IDs
   * @param {string[]} names
   * @returns {Promise<string[]>}
   */
  async #resolvePersonIds(names) {
    // Cache people for 5 minutes
    const now = Date.now();
    if (!this.#peopleCache || now - this.#peopleCacheTime > 300000) {
      this.#peopleCache = await this.#client.getPeople();
      this.#peopleCacheTime = now;
    }

    const lowerNames = names.map(n => n.toLowerCase());
    return this.#peopleCache
      .filter(p => lowerNames.includes(p.name?.toLowerCase()))
      .map(p => p.id);
  }

  /**
   * Convert album to ListableItem
   * @param {Object} album
   * @returns {ListableItem}
   */
  #toAlbumListable(album) {
    return new ListableItem({
      id: `immich:album:${album.id}`,
      source: 'immich',
      title: album.albumName,
      itemType: 'container',
      childCount: album.assetCount || album.assets?.length || 0,
      thumbnail: album.albumThumbnailAssetId
        ? this.#thumbnailUrl(album.albumThumbnailAssetId)
        : null,
      description: album.description || null,
      metadata: {
        type: 'album',
        shared: album.shared || false
      }
    });
  }

  /**
   * Convert asset to ListableItem (for images in browse view)
   * @param {Object} asset
   * @returns {ListableItem}
   */
  #toListableItem(asset) {
    return new ListableItem({
      id: `immich:${asset.id}`,
      source: 'immich',
      title: asset.originalFileName,
      itemType: 'leaf',
      thumbnail: this.#thumbnailUrl(asset.id),
      metadata: {
        type: asset.type?.toLowerCase() || 'image',
        width: asset.width,
        height: asset.height,
        capturedAt: asset.exifInfo?.dateTimeOriginal,
        location: asset.exifInfo?.city,
        favorite: asset.isFavorite
      }
    });
  }

  /**
   * Convert asset to PlayableItem (for videos or slideshow images)
   * @param {Object} asset
   * @param {boolean} [forSlideshow=false] - If true, images get synthetic duration
   * @returns {PlayableItem}
   */
  #toPlayableItem(asset, forSlideshow = false) {
    const isVideo = asset.type === 'VIDEO';
    const duration = isVideo
      ? this.#client.parseDuration(asset.duration)
      : (forSlideshow ? this.slideDuration : null);

    return new PlayableItem({
      id: `immich:${asset.id}`,
      source: 'immich',
      title: asset.originalFileName,
      mediaType: isVideo ? 'video' : 'image',
      mediaUrl: isVideo ? this.#videoUrl(asset.id) : this.#originalUrl(asset.id),
      duration,
      resumable: isVideo,
      thumbnail: this.#thumbnailUrl(asset.id),
      metadata: {
        type: asset.type?.toLowerCase(),
        width: asset.width,
        height: asset.height,
        capturedAt: asset.exifInfo?.dateTimeOriginal,
        location: asset.exifInfo?.city,
        favorite: asset.isFavorite,
        people: asset.people?.map(p => p.name) || []
      }
    });
  }
}

export default ImmichAdapter;
```

**Step 4: Create manifest**

Create `backend/src/1_adapters/content/gallery/immich/manifest.mjs`:

```javascript
// backend/src/1_adapters/content/gallery/immich/manifest.mjs

export default {
  provider: 'immich',
  capability: 'gallery',
  displayName: 'Immich Photo Library',

  adapter: () => import('./ImmichAdapter.mjs'),

  configSchema: {
    host: { type: 'string', required: true, description: 'Immich server URL (e.g., http://localhost:2283)' },
    apiKey: { type: 'string', secret: true, required: true, description: 'Immich API key' },
    slideDuration: { type: 'number', default: 10, description: 'Default slide duration in seconds for photo slideshows' }
  }
};
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/isolated/adapter/content/ImmichAdapter.test.mjs`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs \
        backend/src/1_adapters/content/gallery/immich/manifest.mjs \
        tests/isolated/adapter/content/ImmichAdapter.test.mjs
git commit -m "feat(adapters): add ImmichAdapter with IContentSource and IMediaSearchable"
```

---

## Task 6: Create Index File for Gallery Adapters

**Files:**
- Create: `backend/src/1_adapters/content/gallery/immich/index.mjs`

**Step 1: Create index**

Create `backend/src/1_adapters/content/gallery/immich/index.mjs`:

```javascript
// backend/src/1_adapters/content/gallery/immich/index.mjs

export { ImmichClient } from './ImmichClient.mjs';
export { ImmichAdapter } from './ImmichAdapter.mjs';
export { default as manifest } from './manifest.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/content/gallery/immich/index.mjs
git commit -m "feat(adapters): add Immich adapter index exports"
```

---

## Task 7: Final Integration Verification

**Step 1: Run all tests**

```bash
npm test -- tests/isolated/domain/content/Viewable.test.mjs \
            tests/isolated/domain/media/IMediaSearchable.test.mjs \
            tests/isolated/adapter/content/ImmichClient.test.mjs \
            tests/isolated/adapter/content/ImmichAdapter.test.mjs
```

Expected: All PASS

**Step 2: Verify imports work**

Create a quick smoke test (can delete after):

```bash
node -e "import('#adapters/content/gallery/immich/index.mjs').then(m => console.log('Immich adapter loaded:', Object.keys(m)))"
```

**Step 3: Final commit summary**

```bash
git log --oneline -6
```

Should show:
- feat(adapters): add Immich adapter index exports
- feat(adapters): add ImmichAdapter with IContentSource and IMediaSearchable
- feat(adapters): add ImmichClient for Immich API interactions
- test(media): add MediaKeyResolver tests for Immich UUID pattern
- feat(media): add IMediaSearchable interface for unified search
- feat(content): add ViewableItem capability for static image display

---

## Summary

| Task | Component | Tests | Status |
|------|-----------|-------|--------|
| 1 | ViewableItem capability | 8 tests | |
| 2 | IMediaSearchable interface | 9 tests | |
| 3 | MediaKeyResolver (Immich pattern) | 3 tests | |
| 4 | ImmichClient | 7 tests | |
| 5 | ImmichAdapter | 12 tests | |
| 6 | Index exports | - | |
| 7 | Integration verification | - | |

**Total: 39 tests across 6 implementation tasks**
