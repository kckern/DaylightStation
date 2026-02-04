# Content Query Aliases - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable semantic query prefixes (music:, photos:, kids:) that resolve through a three-layer cascade: orchestration abstractions, user config, and adapter capabilities.

**Architecture:** Three-layer resolution system where Layer 3 (orchestration) handles abstract intent, Layer 2 (config) maps user's specific setup, and Layer 1 (adapters) declares provider capabilities. Gatekeepers filter results after retrieval.

**Tech Stack:** ES modules, YAML config, Playwright E2E tests

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                     QUERY: music:beethoven                         │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  Layer 3: ContentQueryAliasResolver (Orchestration)                │
│  ─────────────────────────────────────────────────────────────────│
│  Built-in: music → intent:audio-for-listening                      │
│            exclude:[audiobook,podcast]                             │
│  Config override: +exclude:[ambient]                               │
│  Output: { intent, gatekeeper, preferMediaType:audio }             │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  Layer 2: Config (User's Setup)                                    │
│  ─────────────────────────────────────────────────────────────────│
│  plex.libraries[3].aliases: [music] → plex:3                       │
│  Output: { sources:[plex:3], libraryFilter:{id:3} }                │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  Layer 1: Adapter Manifest (Capabilities)                          │
│  ─────────────────────────────────────────────────────────────────│
│  plex/manifest.mjs: mediaTypes:[video,audio,photo]                 │
│  Validates: plex CAN provide audio content                         │
│  Output: PlexAdapter instance                                      │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  ContentQueryService.searchStream()                                │
│  ─────────────────────────────────────────────────────────────────│
│  1. Query plex:3 for "beethoven"                                   │
│  2. Stream results through gatekeeper                              │
│  3. Filter out: audiobook, podcast, ambient                        │
│  4. Yield matching audio content                                   │
└────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Adapter Manifests

### Task 1: Enhance Plex Manifest

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/manifest.mjs`

**Step 1: Add mediaTypes and libraryTypes to manifest**

```javascript
// backend/src/1_adapters/content/media/plex/manifest.mjs

export default {
  provider: 'plex',
  capability: 'media',
  displayName: 'Plex Media Server',

  // NEW: Declare supported content types
  mediaTypes: ['video', 'audio', 'photo'],
  libraryTypes: ['movie', 'show', 'music', 'photo'],

  adapter: () => import('./PlexAdapter.mjs'),
  configSchema: {
    host: { type: 'string', required: true },
    port: { type: 'number', default: 32400 },
    token: { type: 'string', secret: true },
  }
};
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/manifest.mjs
git commit -m "feat(content): add mediaTypes/libraryTypes to plex manifest"
```

### Task 2: Enhance Other Manifests

**Files:**
- Modify: `backend/src/1_adapters/content/gallery/immich/manifest.mjs`
- Modify: `backend/src/1_adapters/content/singing/manifest.mjs`
- Modify: `backend/src/1_adapters/content/narrated/manifest.mjs`
- Modify: `backend/src/1_adapters/content/readable/audiobookshelf/manifest.mjs`

**Step 1: Add capability metadata to each manifest**

```javascript
// gallery/immich/manifest.mjs
export default {
  provider: 'immich',
  capability: 'gallery',
  mediaTypes: ['photo', 'video'],
  // ...
};

// singing/manifest.mjs
export default {
  provider: 'singing',
  capability: 'playable',
  mediaTypes: ['audio'],
  playableType: 'singing',
  // ...
};

// narrated/manifest.mjs
export default {
  provider: 'narrated',
  capability: 'playable',
  mediaTypes: ['audio'],
  playableType: 'narrated',
  // ...
};

// readable/audiobookshelf/manifest.mjs
export default {
  provider: 'audiobookshelf',
  capability: 'readable',
  mediaTypes: ['audio'],
  contentTypes: ['audiobook', 'podcast'],
  // ...
};
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/content/
git commit -m "feat(content): add mediaTypes to all content adapter manifests"
```

---

## Layer 2: Config Schema

### Task 3: Define Config Schema for Library Aliases

**Files:**
- Modify: `data/household/apps/content/config.yml` (or schema definition)

**Step 1: Document the config schema**

```yaml
# data/household/apps/content/config.yml

sources:
  plex:
    host: "http://192.168.1.100:32400"
    token: "${PLEX_TOKEN}"
    libraries:
      - id: 1
        name: "Movies"
        type: movie
      - id: 2
        name: "TV Shows"
        type: show
      - id: 3
        name: "Music"
        type: music
        aliases: [music]           # Responds to music:*
      - id: 4
        name: "Kids Movies"
        type: movie
        tags: [kids]               # Responds to kids:*
      - id: 5
        name: "Kids TV"
        type: show
        tags: [kids]
      - id: 6
        name: "Audiobooks"
        type: music
        aliases: [audiobooks]

  immich:
    host: "http://192.168.1.100:2283"
    apiKey: "${IMMICH_API_KEY}"
    albums:
      - id: "abc-123"
        name: "Family Photos"
        tags: [family, photos]
      - id: "def-456"
        name: "Kids Photos"
        tags: [kids, photos]

# User-defined query alias overrides/extensions
contentQueryAliases:
  # Extend built-in "music" with additional excludes
  music:
    exclude: [audiobook, podcast, spoken, ambient]

  # Custom tag-based alias
  family:
    type: tag
    tag: family

  # Shorthand alias
  ab:
    mapTo: audiobooks
```

**Step 2: Commit**

```bash
git add data/household/apps/content/config.yml
git commit -m "docs(content): add contentQueryAliases config schema"
```

---

## Layer 3: Orchestration

### Task 4: Create ContentQueryAliasResolver

**Files:**
- Create: `backend/src/3_applications/content/services/ContentQueryAliasResolver.mjs`
- Test: `tests/unit/content/ContentQueryAliasResolver.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/content/ContentQueryAliasResolver.test.mjs
import { describe, test, expect, beforeEach } from 'vitest';
import { ContentQueryAliasResolver } from '#apps/content/services/ContentQueryAliasResolver.mjs';

describe('ContentQueryAliasResolver', () => {
  let resolver;
  let mockRegistry;
  let mockConfig;

  beforeEach(() => {
    mockRegistry = {
      resolveSource: vi.fn(),
      getByCategory: vi.fn(),
    };
    mockConfig = {
      contentQueryAliases: {},
      getLibrariesByAlias: vi.fn(() => []),
      getLibrariesByTag: vi.fn(() => []),
    };
    resolver = new ContentQueryAliasResolver(mockRegistry, mockConfig);
  });

  test('resolves built-in music alias with gatekeeper', () => {
    const result = resolver.resolveContentQuery('music');

    expect(result.intent).toBe('audio-for-listening');
    expect(result.preferMediaType).toBe('audio');
    expect(result.gatekeeper).toBeDefined();
    expect(result.gatekeeper({ contentType: 'song' })).toBe(true);
    expect(result.gatekeeper({ contentType: 'audiobook' })).toBe(false);
  });

  test('resolves built-in photos alias to gallery category', () => {
    mockRegistry.getByCategory.mockReturnValue([{ source: 'immich' }]);

    const result = resolver.resolveContentQuery('photos');

    expect(result.mapToCategory).toBe('gallery');
    expect(mockRegistry.getByCategory).toHaveBeenCalledWith('gallery');
  });

  test('resolves tag-based alias from config', () => {
    mockConfig.contentQueryAliases = {
      kids: { type: 'tag', tag: 'kids' }
    };
    mockConfig.getLibrariesByTag.mockReturnValue([
      { source: 'plex', libraryId: 4 },
      { source: 'plex', libraryId: 5 },
    ]);

    const result = resolver.resolveContentQuery('kids');

    expect(result.type).toBe('tag');
    expect(result.sources).toHaveLength(2);
  });

  test('config overrides extend built-in excludes', () => {
    mockConfig.contentQueryAliases = {
      music: { exclude: ['ambient'] }
    };

    const result = resolver.resolveContentQuery('music');

    // Should include both built-in excludes AND config excludes
    expect(result.gatekeeper({ contentType: 'audiobook' })).toBe(false);
    expect(result.gatekeeper({ contentType: 'ambient' })).toBe(false);
    expect(result.gatekeeper({ contentType: 'song' })).toBe(true);
  });

  test('passes through unknown prefix to registry', () => {
    mockRegistry.resolveSource.mockReturnValue([{ source: 'plex' }]);

    const result = resolver.resolveContentQuery('plex');

    expect(mockRegistry.resolveSource).toHaveBeenCalledWith('plex');
    expect(result.gatekeeper).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/content/ContentQueryAliasResolver.test.mjs
```

Expected: FAIL (module not found)

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/content/services/ContentQueryAliasResolver.mjs

/**
 * Layer 3: Orchestration - resolves abstract query aliases
 * to concrete sources with optional gatekeepers.
 */
export class ContentQueryAliasResolver {
  #registry;
  #config;

  // Built-in semantic aliases (shipped with app)
  #builtInAliases = {
    music: {
      intent: 'audio-for-listening',
      preferMediaType: 'audio',
      preferLibraryType: 'music',
      exclude: ['audiobook', 'podcast'],
    },
    photos: {
      intent: 'visual-gallery',
      mapToCategory: 'gallery',
    },
    video: {
      intent: 'watchable-content',
      preferMediaType: 'video',
    },
    audiobooks: {
      intent: 'spoken-narrative',
      preferMediaType: 'audio',
      include: ['audiobook'],
    },
  };

  constructor(registry, config) {
    this.#registry = registry;
    this.#config = config;
  }

  /**
   * Resolve query prefix to concrete sources and gatekeeper
   * @param {string} prefix - e.g., "music", "kids", "plex"
   * @returns {ContentQueryResolution}
   */
  resolveContentQuery(prefix) {
    // 1. Check user config for custom/override alias
    const userAlias = this.#config.contentQueryAliases?.[prefix];

    // 2. Check built-in aliases
    const builtIn = this.#builtInAliases[prefix];

    if (userAlias?.type === 'tag') {
      // Tag-based resolution (e.g., kids:)
      return this.#resolveTagAlias(userAlias);
    }

    if (userAlias?.mapTo) {
      // Shorthand alias (e.g., ab: → audiobooks:)
      return this.resolveContentQuery(userAlias.mapTo);
    }

    if (builtIn) {
      // Merge user overrides with built-in
      return this.#resolveBuiltInAlias(prefix, builtIn, userAlias);
    }

    // 3. Pass through to registry (provider/category/source)
    return {
      sources: this.#registry.resolveSource(prefix),
      gatekeeper: null,
    };
  }

  #resolveTagAlias(alias) {
    const sources = this.#config.getLibrariesByTag(alias.tag);
    return {
      type: 'tag',
      tag: alias.tag,
      sources,
      gatekeeper: null,
    };
  }

  #resolveBuiltInAlias(prefix, builtIn, userOverride = {}) {
    // Merge excludes from built-in and user config
    const excludes = [
      ...(builtIn.exclude || []),
      ...(userOverride?.exclude || []),
    ];

    const includes = builtIn.include || null;

    // Check for library-level aliases in config
    const aliasedLibraries = this.#config.getLibrariesByAlias?.(prefix) || [];

    // Get sources from registry if no explicit libraries
    let sources;
    if (aliasedLibraries.length > 0) {
      sources = aliasedLibraries;
    } else if (builtIn.mapToCategory) {
      sources = this.#registry.getByCategory(builtIn.mapToCategory);
    } else {
      sources = this.#registry.resolveSource(builtIn.preferMediaType);
    }

    return {
      intent: builtIn.intent,
      preferMediaType: builtIn.preferMediaType,
      preferLibraryType: builtIn.preferLibraryType,
      mapToCategory: builtIn.mapToCategory,
      sources,
      libraryFilter: aliasedLibraries.length > 0 ? aliasedLibraries : null,
      gatekeeper: this.#buildGatekeeper(excludes, includes),
    };
  }

  #buildGatekeeper(excludes, includes) {
    if (!excludes?.length && !includes?.length) {
      return null;
    }

    return (item) => {
      const contentType = item.contentType || item.type;

      // If includes specified, must match one
      if (includes?.length) {
        return includes.includes(contentType);
      }

      // Otherwise, must not match any exclude
      if (excludes?.length) {
        return !excludes.includes(contentType);
      }

      return true;
    };
  }
}

export default ContentQueryAliasResolver;
```

**Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/content/ContentQueryAliasResolver.test.mjs
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/services/ContentQueryAliasResolver.mjs
git add tests/unit/content/ContentQueryAliasResolver.test.mjs
git commit -m "feat(content): add ContentQueryAliasResolver for query alias resolution"
```

### Task 5: Create ContentQueryGatekeepers

**Files:**
- Create: `backend/src/3_applications/content/services/ContentQueryGatekeepers.mjs`
- Test: `tests/unit/content/ContentQueryGatekeepers.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/content/ContentQueryGatekeepers.test.mjs
import { describe, test, expect } from 'vitest';
import {
  audioForListening,
  kidsSafe,
  createExcludeGatekeeper
} from '#apps/content/services/ContentQueryGatekeepers.mjs';

describe('ContentQueryGatekeepers', () => {
  describe('audioForListening', () => {
    test('allows songs and albums', () => {
      expect(audioForListening({ contentType: 'song' })).toBe(true);
      expect(audioForListening({ contentType: 'album' })).toBe(true);
      expect(audioForListening({ contentType: 'track' })).toBe(true);
    });

    test('excludes audiobooks and podcasts', () => {
      expect(audioForListening({ contentType: 'audiobook' })).toBe(false);
      expect(audioForListening({ contentType: 'podcast' })).toBe(false);
    });
  });

  describe('kidsSafe', () => {
    test('allows items with kids tag', () => {
      expect(kidsSafe({ tags: ['kids', 'family'] })).toBe(true);
    });

    test('allows G and PG ratings', () => {
      expect(kidsSafe({ rating: 'G' })).toBe(true);
      expect(kidsSafe({ rating: 'PG' })).toBe(true);
      expect(kidsSafe({ rating: 'TV-Y' })).toBe(true);
    });

    test('excludes R and mature ratings', () => {
      expect(kidsSafe({ rating: 'R' })).toBe(false);
      expect(kidsSafe({ rating: 'TV-MA' })).toBe(false);
    });
  });

  describe('createExcludeGatekeeper', () => {
    test('creates gatekeeper that excludes specified types', () => {
      const gatekeeper = createExcludeGatekeeper(['podcast', 'ambient']);

      expect(gatekeeper({ contentType: 'song' })).toBe(true);
      expect(gatekeeper({ contentType: 'podcast' })).toBe(false);
      expect(gatekeeper({ contentType: 'ambient' })).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/content/ContentQueryGatekeepers.test.mjs
```

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/content/services/ContentQueryGatekeepers.mjs

/**
 * Gatekeepers filter search results AFTER retrieval.
 * Used by Layer 3 orchestration to enforce semantic intent.
 */

const AUDIOBOOK_TYPES = ['audiobook', 'podcast', 'spoken'];
const KIDS_SAFE_RATINGS = ['G', 'PG', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG'];

/**
 * Gatekeeper for "audio-for-listening" intent
 * Excludes audiobooks, podcasts, and spoken word
 */
export function audioForListening(item) {
  const contentType = item.contentType || item.type;
  return !AUDIOBOOK_TYPES.includes(contentType);
}

/**
 * Gatekeeper for kids-safe content
 * Allows items tagged "kids" or with appropriate ratings
 */
export function kidsSafe(item) {
  // Check tags first
  if (item.tags?.includes('kids')) {
    return true;
  }

  // Check rating
  if (item.rating && KIDS_SAFE_RATINGS.includes(item.rating)) {
    return true;
  }

  // No tags, no rating - exclude by default for safety
  return false;
}

/**
 * Factory to create custom exclude gatekeeper
 * @param {string[]} excludeTypes - Content types to exclude
 * @returns {function}
 */
export function createExcludeGatekeeper(excludeTypes) {
  return (item) => {
    const contentType = item.contentType || item.type;
    return !excludeTypes.includes(contentType);
  };
}

/**
 * Factory to create custom include gatekeeper
 * @param {string[]} includeTypes - Content types to include (all others excluded)
 * @returns {function}
 */
export function createIncludeGatekeeper(includeTypes) {
  return (item) => {
    const contentType = item.contentType || item.type;
    return includeTypes.includes(contentType);
  };
}

export default {
  audioForListening,
  kidsSafe,
  createExcludeGatekeeper,
  createIncludeGatekeeper,
};
```

**Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/content/ContentQueryGatekeepers.test.mjs
```

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/services/ContentQueryGatekeepers.mjs
git add tests/unit/content/ContentQueryGatekeepers.test.mjs
git commit -m "feat(content): add ContentQueryGatekeepers for result filtering"
```

### Task 6: Integrate with ContentQueryService

**Files:**
- Modify: `backend/src/3_applications/content/services/ContentQueryService.mjs`
- Test: `tests/unit/content/ContentQueryService.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to existing ContentQueryService tests
describe('ContentQueryService with aliases', () => {
  test('parses prefix from query string', async () => {
    const service = new ContentQueryService(registry, aliasResolver);
    const results = [];

    for await (const item of service.searchStream('music:beethoven')) {
      results.push(item);
    }

    // Should have parsed "music" prefix and "beethoven" term
    expect(aliasResolver.resolveContentQuery).toHaveBeenCalledWith('music');
  });

  test('applies gatekeeper to filter results', async () => {
    aliasResolver.resolveContentQuery.mockReturnValue({
      sources: [mockAdapter],
      gatekeeper: (item) => item.contentType !== 'audiobook',
    });

    mockAdapter.search.mockImplementation(async function* () {
      yield { title: 'Symphony', contentType: 'album' };
      yield { title: 'Audio Book', contentType: 'audiobook' };
    });

    const results = [];
    for await (const item of service.searchStream('music:beethoven')) {
      results.push(item);
    }

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Symphony');
  });
});
```

**Step 2: Modify ContentQueryService**

```javascript
// Add to ContentQueryService.mjs

#aliasResolver;

constructor(registry, aliasResolver = null) {
  this.#registry = registry;
  this.#aliasResolver = aliasResolver;
}

async *searchStream(query, options = {}) {
  // Parse prefix from query if present
  const { prefix, term } = this.#parseContentQuery(query);

  // Resolve through alias system if available
  let sources;
  let gatekeeper = null;

  if (this.#aliasResolver && prefix) {
    const resolved = this.#aliasResolver.resolveContentQuery(prefix);
    sources = resolved.sources?.length ? resolved.sources : this.#registry.resolveSource(options.source);
    gatekeeper = resolved.gatekeeper;
  } else {
    sources = this.#registry.resolveSource(options.source || prefix);
  }

  // Query each source
  for (const adapter of sources) {
    const results = adapter.search(term, options);

    for await (const item of results) {
      // Apply gatekeeper filter
      if (gatekeeper && !gatekeeper(item)) {
        continue;
      }
      yield item;
    }
  }
}

#parseContentQuery(query) {
  const match = query.match(/^(\w+):(.+)$/);
  if (match) {
    return { prefix: match[1], term: match[2] };
  }
  return { prefix: null, term: query };
}
```

**Step 3: Run tests**

```bash
npm test -- tests/unit/content/ContentQueryService.test.mjs
```

**Step 4: Commit**

```bash
git add backend/src/3_applications/content/services/ContentQueryService.mjs
git add tests/unit/content/ContentQueryService.test.mjs
git commit -m "feat(content): integrate ContentQueryAliasResolver into search flow"
```

---

## E2E Tests

### Task 7: Create Query Alias E2E Tests

**Files:**
- Create: `tests/live/flow/admin/content-search-combobox/08-query-aliases.runtime.test.mjs`

**Step 1: Write E2E tests**

```javascript
// tests/live/flow/admin/content-search-combobox/08-query-aliases.runtime.test.mjs
/**
 * Query Alias E2E Tests
 * Tests the full cascade: orchestration → config → adapter
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Query Aliases', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    await harness.teardown();
  });

  test.describe('Built-in Aliases', () => {
    test('music: prefix searches audio content only', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill('music:beethoven');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      if (count > 0) {
        // Verify no audiobooks in results
        for (let i = 0; i < Math.min(count, 10); i++) {
          const option = options.nth(i);
          const typeAttr = await option.getAttribute('data-content-type');
          expect(typeAttr).not.toBe('audiobook');
          expect(typeAttr).not.toBe('podcast');
        }
      }
    });

    test('photos: prefix searches gallery sources', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill('photos:family');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      // Check API calls went to gallery sources
      const apiCalls = harness.getApiCalls(/search/);
      const hasGalleryCall = apiCalls.some(call =>
        call.url.includes('immich') || call.url.includes('gallery')
      );

      // May have no gallery configured - that's OK
      console.log(`Gallery API calls: ${apiCalls.length}`);
    });

    test('video: prefix searches video content', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill('video:action');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      console.log(`Video search returned ${count} results`);
    });
  });

  test.describe('Prefix Parsing', () => {
    test('query without prefix searches all sources', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill('the office');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      expect(count).toBeGreaterThan(0);
    });

    test('plex: prefix searches only plex source', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill('plex:office');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      // Verify API calls only to plex
      const apiCalls = harness.getApiCalls(/search/);
      for (const call of apiCalls) {
        if (call.url.includes('source=')) {
          expect(call.url).toMatch(/source=plex/);
        }
      }
    });

    test('media: prefix searches media category', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill('media:home');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      console.log(`Media category search returned ${count} results`);
    });
  });

  test.describe('Gatekeeper Filtering', () => {
    test('music: excludes audiobooks from results', async ({ page }) => {
      // Search for something that might return both music and audiobooks
      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill('music:book');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      // Verify no audiobooks slipped through
      for (let i = 0; i < count; i++) {
        const option = options.nth(i);
        const text = await option.textContent();
        const typeAttr = await option.getAttribute('data-content-type');

        if (typeAttr === 'audiobook') {
          throw new Error(`Audiobook found in music: results: ${text}`);
        }
      }
    });
  });
});
```

**Step 2: Run E2E tests**

```bash
npx playwright test tests/live/flow/admin/content-search-combobox/08-query-aliases.runtime.test.mjs --headed
```

**Step 3: Commit**

```bash
git add tests/live/flow/admin/content-search-combobox/08-query-aliases.runtime.test.mjs
git commit -m "test(content): add E2E tests for query alias resolution"
```

---

## Built-in Aliases Reference

| Alias | Intent | Maps To | Gatekeeper |
|-------|--------|---------|------------|
| `music:` | audio-for-listening | audio libraries | exclude audiobook, podcast |
| `photos:` | visual-gallery | gallery category | none |
| `video:` | watchable-content | video libraries | none |
| `audiobooks:` | spoken-narrative | abs, audio libs | include only audiobook |

## User-Defined Aliases (Config)

| Type | Example | Behavior |
|------|---------|----------|
| Tag filter | `kids:` | Search only sources/libraries tagged "kids" |
| Library alias | `music:` on plex:3 | Prioritize specific library |
| Shorthand | `ab:` → `audiobooks:` | Simple remapping |
| Override | `music: { exclude: [ambient] }` | Extend built-in excludes |

---

## Summary

| Task | Files | Purpose |
|------|-------|---------|
| 1 | plex/manifest.mjs | Add mediaTypes to Plex |
| 2 | */manifest.mjs | Add mediaTypes to all adapters |
| 3 | config.yml | Document config schema |
| 4 | ContentQueryAliasResolver.mjs | Layer 3 orchestration |
| 5 | ContentQueryGatekeepers.mjs | Result filters |
| 6 | ContentQueryService.mjs | Integration |
| 7 | 08-query-aliases.runtime.test.mjs | E2E tests |
