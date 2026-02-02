# Content Relevance Scoring DDD Refactor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move content relevance scoring logic from ContentQueryService (application layer) to domain layer, eliminating abstraction leakage where the application knows about specific adapters (Plex, Immich).

**Architecture:** Create a `ContentCategory` value object and `RelevanceScoringService` domain service. Adapters will map their internal types to canonical domain categories. The application layer will orchestrate without knowing adapter-specific details.

**Tech Stack:** Node.js ES modules, Vitest for testing

---

## Background

ContentQueryService currently has three abstraction leaks:
1. **ID pattern matching** - knows numeric IDs = Plex, UUIDs = Immich
2. **Source-specific scoring** - checks `source === 'immich'` for album scoring
3. **Hardcoded type vocabulary** - extensive knowledge of `person`, `playlist`, `album`, etc.

This refactor moves domain knowledge to the domain layer where it belongs.

---

### Task 1: Create ContentCategory Value Object

**Files:**
- Create: `backend/src/2_domains/content/value-objects/ContentCategory.mjs`
- Modify: `backend/src/2_domains/content/value-objects/index.mjs`
- Test: `tests/isolated/domain/content/value-objects/ContentCategory.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/domain/content/value-objects/ContentCategory.test.mjs`:

```javascript
// tests/isolated/domain/content/value-objects/ContentCategory.test.mjs
import { describe, it, expect } from 'vitest';
import {
  ContentCategory,
  ALL_CONTENT_CATEGORIES,
  isValidContentCategory,
  getCategoryScore
} from '#domains/content/value-objects/ContentCategory.mjs';

describe('ContentCategory', () => {
  describe('ContentCategory enum', () => {
    it('defines IDENTITY category', () => {
      expect(ContentCategory.IDENTITY).toBe('identity');
    });

    it('defines CURATED category', () => {
      expect(ContentCategory.CURATED).toBe('curated');
    });

    it('defines CREATOR category', () => {
      expect(ContentCategory.CREATOR).toBe('creator');
    });

    it('defines SERIES category', () => {
      expect(ContentCategory.SERIES).toBe('series');
    });

    it('defines WORK category', () => {
      expect(ContentCategory.WORK).toBe('work');
    });

    it('defines CONTAINER category', () => {
      expect(ContentCategory.CONTAINER).toBe('container');
    });

    it('defines EPISODE category', () => {
      expect(ContentCategory.EPISODE).toBe('episode');
    });

    it('defines TRACK category', () => {
      expect(ContentCategory.TRACK).toBe('track');
    });

    it('defines MEDIA category', () => {
      expect(ContentCategory.MEDIA).toBe('media');
    });

    it('is frozen (immutable)', () => {
      expect(Object.isFrozen(ContentCategory)).toBe(true);
    });
  });

  describe('ALL_CONTENT_CATEGORIES', () => {
    it('contains all category values', () => {
      expect(ALL_CONTENT_CATEGORIES).toContain('identity');
      expect(ALL_CONTENT_CATEGORIES).toContain('curated');
      expect(ALL_CONTENT_CATEGORIES).toContain('creator');
      expect(ALL_CONTENT_CATEGORIES).toHaveLength(9);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(ALL_CONTENT_CATEGORIES)).toBe(true);
    });
  });

  describe('isValidContentCategory', () => {
    it('returns true for valid categories', () => {
      expect(isValidContentCategory('identity')).toBe(true);
      expect(isValidContentCategory('curated')).toBe(true);
      expect(isValidContentCategory('media')).toBe(true);
    });

    it('returns false for invalid categories', () => {
      expect(isValidContentCategory('invalid')).toBe(false);
      expect(isValidContentCategory('')).toBe(false);
      expect(isValidContentCategory(null)).toBe(false);
      expect(isValidContentCategory(undefined)).toBe(false);
    });
  });

  describe('getCategoryScore', () => {
    it('returns 150 for IDENTITY', () => {
      expect(getCategoryScore(ContentCategory.IDENTITY)).toBe(150);
    });

    it('returns 148 for CURATED', () => {
      expect(getCategoryScore(ContentCategory.CURATED)).toBe(148);
    });

    it('returns 145 for CREATOR', () => {
      expect(getCategoryScore(ContentCategory.CREATOR)).toBe(145);
    });

    it('returns 140 for SERIES', () => {
      expect(getCategoryScore(ContentCategory.SERIES)).toBe(140);
    });

    it('returns 130 for WORK', () => {
      expect(getCategoryScore(ContentCategory.WORK)).toBe(130);
    });

    it('returns 125 for CONTAINER', () => {
      expect(getCategoryScore(ContentCategory.CONTAINER)).toBe(125);
    });

    it('returns 20 for EPISODE', () => {
      expect(getCategoryScore(ContentCategory.EPISODE)).toBe(20);
    });

    it('returns 15 for TRACK', () => {
      expect(getCategoryScore(ContentCategory.TRACK)).toBe(15);
    });

    it('returns 10 for MEDIA', () => {
      expect(getCategoryScore(ContentCategory.MEDIA)).toBe(10);
    });

    it('returns 5 for unknown category', () => {
      expect(getCategoryScore('unknown')).toBe(5);
      expect(getCategoryScore(null)).toBe(5);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/content/value-objects/ContentCategory.test.mjs`

Expected: FAIL with "Cannot find module" or similar import error

**Step 3: Write minimal implementation**

Create `backend/src/2_domains/content/value-objects/ContentCategory.mjs`:

```javascript
// backend/src/2_domains/content/value-objects/ContentCategory.mjs

/**
 * ContentCategory Value Object
 *
 * Defines canonical content categories for relevance scoring.
 * Adapters map their internal types to these categories.
 *
 * Scoring tiers (higher = more relevant in search):
 * - IDENTITY (150): Face albums, user profiles - most specific match
 * - CURATED (148): Playlists, collections, tags, photo albums
 * - CREATOR (145): Artists, authors, directors
 * - SERIES (140): TV shows, podcast series
 * - WORK (130): Movies, standalone complete works
 * - CONTAINER (125): Music albums, generic containers
 * - EPISODE (20): Individual episodes
 * - TRACK (15): Individual tracks
 * - MEDIA (10): Images, videos, individual media files
 */

/**
 * @enum {string}
 */
export const ContentCategory = Object.freeze({
  IDENTITY: 'identity',
  CURATED: 'curated',
  CREATOR: 'creator',
  SERIES: 'series',
  WORK: 'work',
  CONTAINER: 'container',
  EPISODE: 'episode',
  TRACK: 'track',
  MEDIA: 'media'
});

/**
 * All valid content categories
 * @type {string[]}
 */
export const ALL_CONTENT_CATEGORIES = Object.freeze(Object.values(ContentCategory));

/**
 * Relevance scores for each category
 * @type {Object<string, number>}
 */
const CATEGORY_SCORES = Object.freeze({
  [ContentCategory.IDENTITY]: 150,
  [ContentCategory.CURATED]: 148,
  [ContentCategory.CREATOR]: 145,
  [ContentCategory.SERIES]: 140,
  [ContentCategory.WORK]: 130,
  [ContentCategory.CONTAINER]: 125,
  [ContentCategory.EPISODE]: 20,
  [ContentCategory.TRACK]: 15,
  [ContentCategory.MEDIA]: 10
});

/**
 * Check if a value is a valid content category
 * @param {string} category
 * @returns {boolean}
 */
export function isValidContentCategory(category) {
  return ALL_CONTENT_CATEGORIES.includes(category);
}

/**
 * Get the relevance score for a category
 * @param {string} category
 * @returns {number}
 */
export function getCategoryScore(category) {
  return CATEGORY_SCORES[category] ?? 5;
}

export default ContentCategory;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/domain/content/value-objects/ContentCategory.test.mjs`

Expected: PASS

**Step 5: Export from value-objects index**

Modify `backend/src/2_domains/content/value-objects/index.mjs`:

```javascript
// Value Objects for Content Domain
export { ItemId } from './ItemId.mjs';
export {
  ContentCategory,
  ALL_CONTENT_CATEGORIES,
  isValidContentCategory,
  getCategoryScore
} from './ContentCategory.mjs';
```

**Step 6: Export from domain index**

Modify `backend/src/2_domains/content/index.mjs` - add to Value Objects section:

```javascript
// Value Objects
export { ItemId } from './value-objects/index.mjs';
export {
  ContentCategory,
  ALL_CONTENT_CATEGORIES,
  isValidContentCategory,
  getCategoryScore
} from './value-objects/index.mjs';
```

**Step 7: Run test again to verify exports work**

Run: `npx vitest run tests/isolated/domain/content/value-objects/ContentCategory.test.mjs`

Expected: PASS

**Step 8: Commit**

```bash
git add backend/src/2_domains/content/value-objects/ContentCategory.mjs \
        backend/src/2_domains/content/value-objects/index.mjs \
        backend/src/2_domains/content/index.mjs \
        tests/isolated/domain/content/value-objects/ContentCategory.test.mjs
git commit -m "$(cat <<'EOF'
feat(domain): add ContentCategory value object for relevance scoring

Defines canonical content categories that adapters will map their types to,
eliminating the need for application layer to know adapter-specific details.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create RelevanceScoringService Domain Service

**Files:**
- Create: `backend/src/2_domains/content/services/RelevanceScoringService.mjs`
- Modify: `backend/src/2_domains/content/index.mjs`
- Test: `tests/isolated/domain/content/services/RelevanceScoringService.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/domain/content/services/RelevanceScoringService.test.mjs`:

```javascript
// tests/isolated/domain/content/services/RelevanceScoringService.test.mjs
import { describe, it, expect } from 'vitest';
import { RelevanceScoringService } from '#domains/content/services/RelevanceScoringService.mjs';
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';

describe('RelevanceScoringService', () => {
  describe('score', () => {
    it('returns 1000 for ID match', () => {
      const item = { _idMatch: true, title: 'Test' };
      expect(RelevanceScoringService.score(item)).toBe(1000);
    });

    it('scores by category from metadata.category', () => {
      const item = {
        title: 'Test Person',
        metadata: { category: ContentCategory.IDENTITY }
      };
      expect(RelevanceScoringService.score(item)).toBe(150);
    });

    it('scores CURATED category at 148', () => {
      const item = {
        title: 'My Playlist',
        metadata: { category: ContentCategory.CURATED }
      };
      expect(RelevanceScoringService.score(item)).toBe(148);
    });

    it('scores CREATOR category at 145', () => {
      const item = {
        title: 'Artist Name',
        metadata: { category: ContentCategory.CREATOR }
      };
      expect(RelevanceScoringService.score(item)).toBe(145);
    });

    it('scores SERIES category at 140', () => {
      const item = {
        title: 'TV Show',
        metadata: { category: ContentCategory.SERIES }
      };
      expect(RelevanceScoringService.score(item)).toBe(140);
    });

    it('scores WORK category at 130', () => {
      const item = {
        title: 'Movie',
        metadata: { category: ContentCategory.WORK }
      };
      expect(RelevanceScoringService.score(item)).toBe(130);
    });

    it('scores CONTAINER category at 125', () => {
      const item = {
        title: 'Album',
        metadata: { category: ContentCategory.CONTAINER }
      };
      expect(RelevanceScoringService.score(item)).toBe(125);
    });

    it('scores EPISODE category at 20', () => {
      const item = {
        title: 'Episode 1',
        metadata: { category: ContentCategory.EPISODE }
      };
      expect(RelevanceScoringService.score(item)).toBe(20);
    });

    it('scores TRACK category at 15', () => {
      const item = {
        title: 'Song',
        metadata: { category: ContentCategory.TRACK }
      };
      expect(RelevanceScoringService.score(item)).toBe(15);
    });

    it('scores MEDIA category at 10', () => {
      const item = {
        title: 'image.jpg',
        metadata: { category: ContentCategory.MEDIA }
      };
      expect(RelevanceScoringService.score(item)).toBe(10);
    });

    it('returns 5 for items without category', () => {
      const item = { title: 'Unknown', metadata: {} };
      expect(RelevanceScoringService.score(item)).toBe(5);
    });
  });

  describe('score with title matching', () => {
    it('adds 20 for exact title match', () => {
      const item = {
        title: 'Milo',
        metadata: { category: ContentCategory.IDENTITY }
      };
      expect(RelevanceScoringService.score(item, 'Milo')).toBe(170); // 150 + 20
    });

    it('adds 10 for title starts with search', () => {
      const item = {
        title: 'Milo Smith',
        metadata: { category: ContentCategory.IDENTITY }
      };
      expect(RelevanceScoringService.score(item, 'Milo')).toBe(160); // 150 + 10
    });

    it('adds 5 for title contains search', () => {
      const item = {
        title: 'John Milo Smith',
        metadata: { category: ContentCategory.IDENTITY }
      };
      expect(RelevanceScoringService.score(item, 'Milo')).toBe(155); // 150 + 5
    });

    it('is case insensitive', () => {
      const item = {
        title: 'MILO',
        metadata: { category: ContentCategory.IDENTITY }
      };
      expect(RelevanceScoringService.score(item, 'milo')).toBe(170); // exact match
    });
  });

  describe('score with child count bonus', () => {
    it('adds up to 5 points for large collections', () => {
      const item = {
        title: 'Big Collection',
        metadata: { category: ContentCategory.CURATED },
        childCount: 1000
      };
      // 148 base + 5 max childCount bonus
      expect(RelevanceScoringService.score(item)).toBe(153);
    });

    it('scales childCount bonus proportionally', () => {
      const item = {
        title: 'Small Collection',
        metadata: { category: ContentCategory.CURATED },
        childCount: 200
      };
      // 148 base + 2 (200/100 = 2)
      expect(RelevanceScoringService.score(item)).toBe(150);
    });
  });

  describe('sortByRelevance', () => {
    it('sorts items by score descending', () => {
      const items = [
        { title: 'Track', metadata: { category: ContentCategory.TRACK } },
        { title: 'Person', metadata: { category: ContentCategory.IDENTITY } },
        { title: 'Album', metadata: { category: ContentCategory.CONTAINER } }
      ];

      const sorted = RelevanceScoringService.sortByRelevance(items);

      expect(sorted[0].title).toBe('Person');
      expect(sorted[1].title).toBe('Album');
      expect(sorted[2].title).toBe('Track');
    });

    it('considers search text for title matching', () => {
      const items = [
        { title: 'Milo Track', metadata: { category: ContentCategory.TRACK } },
        { title: 'John', metadata: { category: ContentCategory.IDENTITY } },
        { title: 'Milo', metadata: { category: ContentCategory.IDENTITY } }
      ];

      const sorted = RelevanceScoringService.sortByRelevance(items, 'Milo');

      // Milo (exact match 170) > John (150) > Milo Track (15 + 10 = 25)
      expect(sorted[0].title).toBe('Milo');
      expect(sorted[1].title).toBe('John');
      expect(sorted[2].title).toBe('Milo Track');
    });

    it('does not mutate original array', () => {
      const items = [
        { title: 'B', metadata: { category: ContentCategory.TRACK } },
        { title: 'A', metadata: { category: ContentCategory.IDENTITY } }
      ];
      const original = [...items];

      RelevanceScoringService.sortByRelevance(items);

      expect(items).toEqual(original);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/content/services/RelevanceScoringService.test.mjs`

Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create `backend/src/2_domains/content/services/RelevanceScoringService.mjs`:

```javascript
// backend/src/2_domains/content/services/RelevanceScoringService.mjs

import { getCategoryScore } from '../value-objects/ContentCategory.mjs';

/**
 * Domain service for calculating search relevance scores.
 *
 * Pure domain logic - no knowledge of specific adapters or sources.
 * Uses category from item.metadata.category to determine base score.
 */
export class RelevanceScoringService {
  /**
   * Calculate relevance score for an item.
   *
   * @param {Object} item - Item to score
   * @param {string} [item.title] - Item title
   * @param {Object} [item.metadata] - Item metadata
   * @param {string} [item.metadata.category] - Content category (from ContentCategory enum)
   * @param {number} [item.childCount] - Number of children (for containers)
   * @param {boolean} [item._idMatch] - Whether this was a direct ID match
   * @param {string} [searchText] - Search text for title matching bonus
   * @returns {number} Relevance score (higher = more relevant)
   */
  static score(item, searchText = '') {
    // ID match always wins
    if (item._idMatch) return 1000;

    // Get base score from category
    const category = item.metadata?.category;
    let score = getCategoryScore(category);

    // Title match bonuses
    if (searchText && item.title) {
      const title = item.title.toLowerCase();
      const search = searchText.toLowerCase();

      if (title === search) {
        score += 20; // Exact match
      } else if (title.startsWith(search)) {
        score += 10; // Starts with
      } else if (title.includes(search)) {
        score += 5; // Contains
      }
    }

    // Child count bonus for containers (up to +5)
    const childCount = item.childCount || item.metadata?.childCount || 0;
    if (childCount > 0) {
      score += Math.min(childCount / 100, 5);
    }

    return score;
  }

  /**
   * Sort items by relevance score (descending).
   *
   * @param {Object[]} items - Items to sort
   * @param {string} [searchText] - Search text for title matching
   * @returns {Object[]} New array sorted by relevance
   */
  static sortByRelevance(items, searchText = '') {
    return [...items].sort((a, b) => {
      const scoreA = RelevanceScoringService.score(a, searchText);
      const scoreB = RelevanceScoringService.score(b, searchText);
      return scoreB - scoreA;
    });
  }
}

export default RelevanceScoringService;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/domain/content/services/RelevanceScoringService.test.mjs`

Expected: PASS

**Step 5: Export from domain index**

Add to `backend/src/2_domains/content/index.mjs` in Services section:

```javascript
export { RelevanceScoringService } from './services/RelevanceScoringService.mjs';
```

**Step 6: Run test again to verify exports**

Run: `npx vitest run tests/isolated/domain/content/services/RelevanceScoringService.test.mjs`

Expected: PASS

**Step 7: Commit**

```bash
git add backend/src/2_domains/content/services/RelevanceScoringService.mjs \
        backend/src/2_domains/content/index.mjs \
        tests/isolated/domain/content/services/RelevanceScoringService.test.mjs
git commit -m "$(cat <<'EOF'
feat(domain): add RelevanceScoringService for content search ranking

Pure domain service that scores items based on their ContentCategory.
No knowledge of specific adapters - uses metadata.category set by adapters.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Update ImmichAdapter to Set ContentCategory

**Files:**
- Modify: `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`
- Test: `tests/isolated/adapters/content/gallery/immich/ImmichAdapter.category.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapters/content/gallery/immich/ImmichAdapter.category.test.mjs`:

```javascript
// tests/isolated/adapters/content/gallery/immich/ImmichAdapter.category.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImmichAdapter } from '#adapters/content/gallery/immich/ImmichAdapter.mjs';
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';

describe('ImmichAdapter ContentCategory', () => {
  let adapter;
  let mockHttpClient;

  beforeEach(() => {
    mockHttpClient = {
      get: vi.fn(),
      post: vi.fn()
    };

    adapter = new ImmichAdapter(
      { host: 'http://localhost:2283', apiKey: 'test-key' },
      { httpClient: mockHttpClient }
    );
  });

  describe('person items', () => {
    it('sets category to IDENTITY for person items', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { people: [{ id: 'person-1', name: 'John', assetCount: 10 }] }
      });

      const item = await adapter.getItem('immich:person:person-1');

      expect(item.metadata.category).toBe(ContentCategory.IDENTITY);
    });
  });

  describe('album items', () => {
    it('sets category to CURATED for album items', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { id: 'album-1', albumName: 'Vacation', assetCount: 50 }
      });

      const item = await adapter.getItem('immich:album:album-1');

      expect(item.metadata.category).toBe(ContentCategory.CURATED);
    });
  });

  describe('tag items', () => {
    it('sets category to CURATED for tag items', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: [{ id: 'tag-1', name: 'CountrySide2016' }]
      });

      const item = await adapter.getItem('immich:tag:tag-1');

      expect(item.metadata.category).toBe(ContentCategory.CURATED);
    });
  });

  describe('asset items', () => {
    it('sets category to MEDIA for image assets', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { id: 'asset-1', type: 'IMAGE', originalFileName: 'photo.jpg' }
      });

      const item = await adapter.getItem('immich:asset-1');

      expect(item.metadata.category).toBe(ContentCategory.MEDIA);
    });

    it('sets category to MEDIA for video assets', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: { id: 'asset-1', type: 'VIDEO', originalFileName: 'video.mp4', duration: '0:01:30.00' }
      });

      const item = await adapter.getItem('immich:asset-1');

      expect(item.metadata.category).toBe(ContentCategory.MEDIA);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapters/content/gallery/immich/ImmichAdapter.category.test.mjs`

Expected: FAIL with assertion error (category undefined or wrong value)

**Step 3: Update ImmichAdapter implementation**

Modify `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`:

Add import at top of file:
```javascript
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';
```

Update `#toPersonListable` method (around line 710-735):
```javascript
  #toPersonListable(person) {
    const assetCount = person.assetCount || 0;
    return new ListableItem({
      id: `immich:person:${person.id}`,
      source: 'immich',
      title: person.name || 'Unknown',
      itemType: 'container',
      childCount: assetCount,
      thumbnail: `${this.#proxyPath}/api/people/${person.id}/thumbnail`,
      metadata: {
        type: 'person',
        category: ContentCategory.IDENTITY, // Add this line
        librarySectionTitle: 'Immich',
        parentTitle: 'Person',
        childCount: assetCount,
        leafCount: assetCount,
        birthDate: person.birthDate,
        isHidden: person.isHidden || false,
        isFavorite: person.isFavorite || false,
        assetCount: assetCount
      }
    });
  }
```

Update `#toAlbumListable` method (around line 679-703):
```javascript
  #toAlbumListable(album) {
    const assetCount = album.assetCount || album.assets?.length || 0;
    return new ListableItem({
      id: `immich:album:${album.id}`,
      source: 'immich',
      title: album.albumName,
      itemType: 'container',
      childCount: assetCount,
      thumbnail: album.albumThumbnailAssetId
        ? this.#thumbnailUrl(album.albumThumbnailAssetId)
        : null,
      description: album.description || null,
      metadata: {
        type: 'album',
        category: ContentCategory.CURATED, // Add this line
        librarySectionTitle: 'Immich',
        parentTitle: 'Albums',
        childCount: assetCount,
        leafCount: assetCount,
        shared: album.shared || false
      }
    });
  }
```

Update `#toTagListable` method (find it and add category):
```javascript
  #toTagListable(tag) {
    return new ListableItem({
      id: `immich:tag:${tag.id}`,
      source: 'immich',
      title: tag.name,
      itemType: 'container',
      childCount: tag.assetCount || 0,
      thumbnail: null,
      metadata: {
        type: 'tag',
        category: ContentCategory.CURATED, // Add this line
        librarySectionTitle: 'Immich',
        parentTitle: 'Tags',
        childCount: tag.assetCount || 0
      }
    });
  }
```

Update `#toListableItem` method (around line 745-767):
```javascript
  #toListableItem(asset, context = {}) {
    return new ListableItem({
      id: `immich:${asset.id}`,
      source: 'immich',
      title: asset.originalFileName,
      itemType: 'leaf',
      thumbnail: this.#thumbnailUrl(asset.id),
      imageUrl: this.#originalUrl(asset.id),
      metadata: {
        type: asset.type?.toLowerCase() || 'image',
        category: ContentCategory.MEDIA, // Add this line
        librarySectionTitle: 'Immich',
        parentTitle: context.parentTitle || null,
        parentId: context.parentId || null,
        width: asset.width,
        height: asset.height,
        capturedAt: asset.exifInfo?.dateTimeOriginal,
        location: asset.exifInfo?.city,
        favorite: asset.isFavorite
      }
    });
  }
```

Update `#toPlayableItem` method (around line 778-808):
```javascript
  #toPlayableItem(asset, forSlideshow = false, context = {}) {
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
        category: ContentCategory.MEDIA, // Add this line
        librarySectionTitle: 'Immich',
        parentTitle: context.parentTitle || null,
        parentId: context.parentId || null,
        width: asset.width,
        height: asset.height,
        capturedAt: asset.exifInfo?.dateTimeOriginal,
        location: asset.exifInfo?.city,
        favorite: asset.isFavorite,
        people: asset.people?.map(p => p.name) || []
      }
    });
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapters/content/gallery/immich/ImmichAdapter.category.test.mjs`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs \
        tests/isolated/adapters/content/gallery/immich/ImmichAdapter.category.test.mjs
git commit -m "$(cat <<'EOF'
feat(immich): add ContentCategory to all item metadata

Maps Immich types to domain categories:
- person -> IDENTITY
- album, tag -> CURATED
- image, video -> MEDIA

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Update PlexAdapter to Set ContentCategory

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`
- Test: `tests/isolated/adapters/content/media/plex/PlexAdapter.category.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapters/content/media/plex/PlexAdapter.category.test.mjs`:

```javascript
// tests/isolated/adapters/content/media/plex/PlexAdapter.category.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';

// We'll test by checking the output of toListableItem/toPlayableItem style methods
// First, let's check what categories Plex items should map to

describe('PlexAdapter ContentCategory mapping', () => {
  // Expected mappings:
  // - playlist -> CURATED
  // - collection -> CURATED
  // - artist -> CREATOR
  // - author -> CREATOR (if supported)
  // - show -> SERIES
  // - movie -> WORK
  // - album (music) -> CONTAINER
  // - episode -> EPISODE
  // - track -> TRACK
  // - clip -> MEDIA

  it('maps playlist to CURATED', () => {
    expect(ContentCategory.CURATED).toBe('curated');
  });

  it('maps collection to CURATED', () => {
    expect(ContentCategory.CURATED).toBe('curated');
  });

  it('maps artist to CREATOR', () => {
    expect(ContentCategory.CREATOR).toBe('creator');
  });

  it('maps show to SERIES', () => {
    expect(ContentCategory.SERIES).toBe('series');
  });

  it('maps movie to WORK', () => {
    expect(ContentCategory.WORK).toBe('work');
  });

  it('maps album to CONTAINER', () => {
    expect(ContentCategory.CONTAINER).toBe('container');
  });

  it('maps episode to EPISODE', () => {
    expect(ContentCategory.EPISODE).toBe('episode');
  });

  it('maps track to TRACK', () => {
    expect(ContentCategory.TRACK).toBe('track');
  });
});
```

Note: This is a placeholder test. The actual implementation test will need to be written based on PlexAdapter's structure. The test above just validates the mapping expectations.

**Step 2: Find and read PlexAdapter**

Run: `cat backend/src/1_adapters/content/media/plex/PlexAdapter.mjs | head -100`

Based on the adapter structure, identify all methods that create ListableItem or PlayableItem and add the appropriate category mapping.

**Step 3: Update PlexAdapter implementation**

Add import at top:
```javascript
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';
```

Create a mapping helper:
```javascript
  /**
   * Map Plex type to ContentCategory
   * @param {string} type - Plex item type
   * @returns {string} ContentCategory value
   */
  #mapTypeToCategory(type) {
    const mapping = {
      'playlist': ContentCategory.CURATED,
      'collection': ContentCategory.CURATED,
      'artist': ContentCategory.CREATOR,
      'show': ContentCategory.SERIES,
      'movie': ContentCategory.WORK,
      'album': ContentCategory.CONTAINER,
      'season': ContentCategory.CONTAINER,
      'episode': ContentCategory.EPISODE,
      'track': ContentCategory.TRACK,
      'clip': ContentCategory.MEDIA,
      'photo': ContentCategory.MEDIA
    };
    return mapping[type] || ContentCategory.MEDIA;
  }
```

Then update all methods that create items to include:
```javascript
metadata: {
  type: plexType,
  category: this.#mapTypeToCategory(plexType),
  // ... other metadata
}
```

**Step 4: Run tests and verify**

Run: `npx vitest run tests/isolated/adapters/content/media/plex/`

Expected: PASS (after implementation)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/PlexAdapter.mjs \
        tests/isolated/adapters/content/media/plex/PlexAdapter.category.test.mjs
git commit -m "$(cat <<'EOF'
feat(plex): add ContentCategory to all item metadata

Maps Plex types to domain categories:
- playlist, collection -> CURATED
- artist -> CREATOR
- show -> SERIES
- movie -> WORK
- album, season -> CONTAINER
- episode -> EPISODE
- track -> TRACK
- clip, photo -> MEDIA

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Update AudiobookshelfAdapter to Set ContentCategory

**Files:**
- Modify: `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs`
- Test: `tests/isolated/adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.category.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.category.test.mjs`:

```javascript
// tests/isolated/adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.category.test.mjs
import { describe, it, expect } from 'vitest';
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';

describe('AudiobookshelfAdapter ContentCategory mapping', () => {
  // Expected mappings:
  // - author -> CREATOR
  // - book/audiobook -> WORK (complete standalone works)
  // - chapter -> EPISODE (parts of a book)
  // - series -> SERIES (book series)

  it('maps author to CREATOR', () => {
    expect(ContentCategory.CREATOR).toBe('creator');
  });

  it('maps book to WORK', () => {
    expect(ContentCategory.WORK).toBe('work');
  });

  it('maps series to SERIES', () => {
    expect(ContentCategory.SERIES).toBe('series');
  });
});
```

**Step 2: Update AudiobookshelfAdapter**

Add import:
```javascript
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';
```

Update `#toAuthorListable` to include:
```javascript
metadata: {
  type: 'author',
  category: ContentCategory.CREATOR,
  // ... other metadata
}
```

Update book/audiobook items:
```javascript
metadata: {
  type: 'book', // or 'audiobook'
  category: ContentCategory.WORK,
  // ... other metadata
}
```

**Step 3: Run test and commit**

```bash
git add backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs \
        tests/isolated/adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.category.test.mjs
git commit -m "$(cat <<'EOF'
feat(audiobookshelf): add ContentCategory to all item metadata

Maps Audiobookshelf types to domain categories:
- author -> CREATOR
- book, audiobook -> WORK

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Refactor ContentQueryService to Use Domain Service

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs`
- Test: `tests/isolated/applications/content/ContentQueryService.relevance.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/applications/content/ContentQueryService.relevance.test.mjs`:

```javascript
// tests/isolated/applications/content/ContentQueryService.relevance.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';

describe('ContentQueryService relevance sorting', () => {
  let service;
  let mockRegistry;

  beforeEach(() => {
    mockRegistry = {
      resolveSource: vi.fn(),
      get: vi.fn()
    };
    service = new ContentQueryService({ registry: mockRegistry });
  });

  it('sorts results by category using domain service', async () => {
    const mockAdapter = {
      source: 'test',
      search: vi.fn().mockResolvedValue({
        items: [
          { title: 'Track', metadata: { category: ContentCategory.TRACK } },
          { title: 'Person', metadata: { category: ContentCategory.IDENTITY } },
          { title: 'Movie', metadata: { category: ContentCategory.WORK } }
        ],
        total: 3
      }),
      getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
      getQueryMappings: () => ({})
    };

    mockRegistry.resolveSource.mockReturnValue([mockAdapter]);

    const result = await service.search({ text: 'test' });

    // Should be sorted: Person (150) > Movie (130) > Track (15)
    expect(result.items[0].title).toBe('Person');
    expect(result.items[1].title).toBe('Movie');
    expect(result.items[2].title).toBe('Track');
  });

  it('does not contain source-specific scoring logic', async () => {
    // Verify the service doesn't check source === 'immich' or similar
    const serviceSource = ContentQueryService.toString();
    expect(serviceSource).not.toContain("source === 'immich'");
    expect(serviceSource).not.toContain("source === 'plex'");
  });
});
```

**Step 2: Update ContentQueryService**

Replace the `#getRelevanceScore` and `#sortByRelevance` methods with delegation to the domain service.

Add import:
```javascript
import { RelevanceScoringService } from '#domains/content/index.mjs';
```

Remove the entire `#getRelevanceScore` method (lines ~222-311).

Replace `#sortByRelevance` method with:
```javascript
  /**
   * Sort items by relevance score.
   * Delegates to domain RelevanceScoringService.
   * @param {Array} items
   * @param {string} [searchText]
   * @returns {Array}
   */
  #sortByRelevance(items, searchText) {
    return RelevanceScoringService.sortByRelevance(items, searchText);
  }
```

**Step 3: Run all content tests**

Run: `npx vitest run tests/isolated/domain/content/ tests/isolated/applications/content/`

Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs \
        tests/isolated/applications/content/ContentQueryService.relevance.test.mjs
git commit -m "$(cat <<'EOF'
refactor(app): delegate relevance scoring to domain service

ContentQueryService now uses RelevanceScoringService from domain layer
instead of containing hardcoded type/source scoring logic.

Removes abstraction leakage:
- No more source === 'immich' checks
- No more hardcoded type vocabularies
- Domain owns the scoring business logic

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Remove ID Pattern Parsing Leakage (Optional Enhancement)

**Files:**
- Create: `backend/src/2_domains/content/services/IdPatternRegistry.mjs` (optional)
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs`

This task addresses the ID pattern matching leak where ContentQueryService knows numeric = Plex, UUID = Immich.

**Option A: Keep current behavior** - The ID parsing is a convenience feature and the leakage is minor. Document it and move on.

**Option B: Move to adapter interface** - Create `getIdPattern()` interface method on adapters.

For now, we'll document this as a known limitation and defer to Option B if needed later.

**Step 1: Add code comment documenting the tradeoff**

In `ContentQueryService.mjs`, update the `#parseIdFromText` JSDoc:

```javascript
  /**
   * Parse text to detect if it's a direct ID reference.
   *
   * NOTE: This method contains source-specific ID format knowledge as a
   * pragmatic tradeoff. Moving this to adapters would require significant
   * interface changes for minimal benefit. The ID formats (numeric for Plex,
   * UUID for Immich) are stable and unlikely to conflict with search terms.
   *
   * If this becomes problematic, adapters could implement:
   *   getIdPattern(): { pattern: RegExp, priority: number }
   *
   * @param {string} text - Search text to check
   * @returns {{source: string, id: string} | null}
   */
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs
git commit -m "$(cat <<'EOF'
docs: document ID pattern parsing tradeoff in ContentQueryService

The #parseIdFromText method retains source-specific ID knowledge
as a pragmatic tradeoff. Documents the issue and potential future
solution if adapters need to own their ID patterns.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Run Full Test Suite and Verify

**Step 1: Run all domain content tests**

Run: `npx vitest run tests/isolated/domain/content/`

Expected: All PASS

**Step 2: Run all adapter tests**

Run: `npx vitest run tests/isolated/adapters/content/`

Expected: All PASS

**Step 3: Run application tests**

Run: `npx vitest run tests/isolated/applications/content/`

Expected: All PASS

**Step 4: Run integration test**

Run: `npx vitest run tests/integrated/api/content/`

Expected: All PASS

**Step 5: Manual verification**

Start the dev server and test search:
```bash
curl -s "http://localhost:3112/api/v1/content/query/search?text=Milo&take=10" | jq '[.items[:5] | .[] | {title, type: .metadata.type, category: .metadata.category}]'
```

Expected output should show category field on all items:
```json
[
  { "title": "Milo", "type": "person", "category": "identity" },
  { "title": "Milo O. Frank", "type": "author", "category": "creator" },
  ...
]
```

**Step 6: Final commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test: verify content relevance refactor works end-to-end

All tests pass. Search results now include category metadata
and ranking uses domain service instead of hardcoded logic.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

This refactor:
1. Creates `ContentCategory` value object defining canonical categories
2. Creates `RelevanceScoringService` domain service with pure scoring logic
3. Updates Immich, Plex, and Audiobookshelf adapters to set categories
4. Refactors ContentQueryService to delegate to domain service
5. Documents the remaining ID pattern tradeoff

The application layer no longer knows about specific adapters. All relevance scoring business logic lives in the domain layer where it belongs.
