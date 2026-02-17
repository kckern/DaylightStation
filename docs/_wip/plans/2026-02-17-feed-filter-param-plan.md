# Feed Filter Parameter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `?filter=` query parameter to `/api/v1/feed/scroll` that resolves through a 4-layer chain (tier, source type, query name, alias) to provide single-source or single-tier feed views.

**Architecture:** A new `FeedFilterResolver` class (modeled on `ContentIdResolver`) parses filter expressions into typed results. `FeedAssemblyService.getNextBatch()` uses the resolved filter to narrow item selection and bypass tier assembly. The frontend reads `?filter=` from URL search params.

**Tech Stack:** Node.js ES modules, Express, React (useSearchParams), Jest + supertest for testing.

**Design doc:** `docs/_wip/plans/2026-02-17-feed-filter-param-design.md`

---

### Task 1: Create FeedFilterResolver — failing tests

**Files:**
- Create: `tests/isolated/assembly/feed/FeedFilterResolver.test.mjs`

**Step 1: Write the failing tests**

```javascript
// tests/isolated/assembly/feed/FeedFilterResolver.test.mjs
import { FeedFilterResolver } from '#applications/feed/services/FeedFilterResolver.mjs';

describe('FeedFilterResolver', () => {
  let resolver;

  beforeEach(() => {
    resolver = new FeedFilterResolver({
      sourceTypes: ['reddit', 'youtube', 'googlenews', 'headlines', 'freshrss', 'komga', 'weather', 'health'],
      queryNames: ['scripture-bom', 'goodreads'],
      aliases: { photos: 'immich', news: 'headlines' },
    });
  });

  describe('null/empty input', () => {
    test('returns null for empty string', () => {
      expect(resolver.resolve('')).toBeNull();
    });

    test('returns null for undefined', () => {
      expect(resolver.resolve(undefined)).toBeNull();
    });
  });

  describe('Layer 1: tier match', () => {
    test('resolves bare tier name', () => {
      expect(resolver.resolve('compass')).toEqual({ type: 'tier', tier: 'compass' });
    });

    test('resolves all four tiers', () => {
      for (const tier of ['wire', 'library', 'scrapbook', 'compass']) {
        expect(resolver.resolve(tier)).toEqual({ type: 'tier', tier });
      }
    });

    test('tier match is case-insensitive', () => {
      expect(resolver.resolve('Compass')).toEqual({ type: 'tier', tier: 'compass' });
    });
  });

  describe('Layer 2: source type match', () => {
    test('resolves bare source type', () => {
      expect(resolver.resolve('reddit')).toEqual({
        type: 'source', sourceType: 'reddit', subsources: null,
      });
    });

    test('resolves source with subsources', () => {
      expect(resolver.resolve('reddit:worldnews,usnews')).toEqual({
        type: 'source', sourceType: 'reddit', subsources: ['worldnews', 'usnews'],
      });
    });

    test('resolves source with single subsource', () => {
      expect(resolver.resolve('youtube:veritasium')).toEqual({
        type: 'source', sourceType: 'youtube', subsources: ['veritasium'],
      });
    });

    test('trims whitespace from subsources', () => {
      expect(resolver.resolve('reddit:worldnews, usnews')).toEqual({
        type: 'source', sourceType: 'reddit', subsources: ['worldnews', 'usnews'],
      });
    });
  });

  describe('Layer 3: query name match (exact)', () => {
    test('resolves exact query name', () => {
      expect(resolver.resolve('scripture-bom')).toEqual({
        type: 'query', queryName: 'scripture-bom',
      });
    });

    test('does not partial-match query names', () => {
      expect(resolver.resolve('scripture')).toBeNull();
    });
  });

  describe('Layer 4: alias', () => {
    test('resolves alias to source type', () => {
      expect(resolver.resolve('photos')).toEqual({
        type: 'source', sourceType: 'immich', subsources: null,
      });
    });

    test('resolves alias with subsource', () => {
      expect(resolver.resolve('photos:felix')).toEqual({
        type: 'source', sourceType: 'immich', subsources: ['felix'],
      });
    });

    test('resolves alias to query name', () => {
      // Alias target can be a query name too
      const r = new FeedFilterResolver({
        sourceTypes: ['reddit'],
        queryNames: ['scripture-bom'],
        aliases: { scripture: 'scripture-bom' },
      });
      expect(r.resolve('scripture')).toEqual({
        type: 'query', queryName: 'scripture-bom',
      });
    });
  });

  describe('Layer priority', () => {
    test('tier wins over source type if same name', () => {
      // "wire" could theoretically be a source type too — tier wins
      const r = new FeedFilterResolver({
        sourceTypes: ['wire'],
        queryNames: [],
        aliases: {},
      });
      expect(r.resolve('wire')).toEqual({ type: 'tier', tier: 'wire' });
    });

    test('source type wins over query name if same name', () => {
      const r = new FeedFilterResolver({
        sourceTypes: ['reddit'],
        queryNames: ['reddit'],
        aliases: {},
      });
      expect(r.resolve('reddit')).toEqual({
        type: 'source', sourceType: 'reddit', subsources: null,
      });
    });
  });

  describe('no match', () => {
    test('returns null for unknown prefix', () => {
      expect(resolver.resolve('xyzzy')).toBeNull();
    });

    test('returns null for unknown prefix with rest', () => {
      expect(resolver.resolve('xyzzy:foo')).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/assembly/feed/FeedFilterResolver.test.mjs --no-cache`
Expected: FAIL — `Cannot find module '#applications/feed/services/FeedFilterResolver.mjs'`

---

### Task 2: Create FeedFilterResolver — implementation

**Files:**
- Create: `backend/src/3_applications/feed/services/FeedFilterResolver.mjs`

**Step 1: Write the implementation**

```javascript
// backend/src/3_applications/feed/services/FeedFilterResolver.mjs
/**
 * FeedFilterResolver
 *
 * 4-layer resolution chain for feed filter expressions.
 * Modeled after ContentIdResolver — parses "prefix:rest" compound IDs
 * into typed filter results.
 *
 * Layer 1: Tier match (wire, library, scrapbook, compass)
 * Layer 2: Source type match (reddit, youtube, etc.)
 * Layer 3: Query name match (exact, from query config filenames)
 * Layer 4: Alias (configurable shortcut map)
 *
 * @module applications/feed/services
 */

const TIER_NAMES = new Set(['wire', 'library', 'scrapbook', 'compass']);

export class FeedFilterResolver {
  #sourceTypes;
  #queryNames;
  #aliases;

  /**
   * @param {Object} options
   * @param {string[]} options.sourceTypes - Registered adapter sourceType values (e.g. ['reddit', 'youtube'])
   * @param {string[]} options.queryNames - Query config filenames without .yml (e.g. ['scripture-bom'])
   * @param {Object<string, string>} [options.aliases] - Shortcut map (e.g. { photos: 'immich' })
   */
  constructor({ sourceTypes = [], queryNames = [], aliases = {} } = {}) {
    this.#sourceTypes = new Set(sourceTypes);
    this.#queryNames = new Set(queryNames);
    this.#aliases = aliases;
  }

  /**
   * Resolve a filter expression to a typed result.
   *
   * @param {string} expression - e.g. "reddit:worldnews,usnews", "compass", "scripture-bom"
   * @returns {{ type: 'tier', tier: string }
   *         | { type: 'source', sourceType: string, subsources: string[]|null }
   *         | { type: 'query', queryName: string }
   *         | null}
   */
  resolve(expression) {
    if (!expression) return null;

    const colonIdx = expression.indexOf(':');
    const prefix = (colonIdx === -1 ? expression : expression.slice(0, colonIdx)).toLowerCase().trim();
    const rest = colonIdx === -1 ? null : expression.slice(colonIdx + 1).trim();
    const subsources = rest ? rest.split(',').map(s => s.trim()).filter(Boolean) : null;

    // Layer 1: Tier match
    if (TIER_NAMES.has(prefix)) {
      return { type: 'tier', tier: prefix };
    }

    // Layer 2: Source type match
    if (this.#sourceTypes.has(prefix)) {
      return { type: 'source', sourceType: prefix, subsources };
    }

    // Layer 3: Query name match (exact)
    if (this.#queryNames.has(prefix)) {
      return { type: 'query', queryName: prefix };
    }

    // Layer 4: Alias — resolve and re-run from Layer 2
    if (this.#aliases[prefix]) {
      const target = this.#aliases[prefix];
      // Re-resolve: target could be a source type or query name
      if (this.#sourceTypes.has(target)) {
        return { type: 'source', sourceType: target, subsources };
      }
      if (this.#queryNames.has(target)) {
        return { type: 'query', queryName: target };
      }
    }

    return null;
  }
}
```

**Step 2: Run tests to verify they pass**

Run: `npx jest tests/isolated/assembly/feed/FeedFilterResolver.test.mjs --no-cache`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedFilterResolver.mjs tests/isolated/assembly/feed/FeedFilterResolver.test.mjs
git commit -m "feat(feed): add FeedFilterResolver with 4-layer resolution chain

Modeled after ContentIdResolver. Resolves filter expressions through:
tier -> source type -> query name -> alias."
```

---

### Task 3: Wire FeedFilterResolver into FeedAssemblyService — failing test

**Files:**
- Modify: `tests/isolated/api/feed/feed.router.test.mjs`

This test verifies the full path: router parses `?filter=`, passes to assembly service, which receives the resolved filter object.

**Step 1: Add failing test to the existing scroll describe block**

Add these tests inside the existing `describe('GET /scroll', ...)` block in `tests/isolated/api/feed/feed.router.test.mjs` (after line 176):

```javascript
    test('passes filter param to feedAssemblyService', async () => {
      await request(scrollApp).get('/api/v1/feed/scroll?filter=reddit:worldnews,usnews');
      expect(mockFeedAssemblyService.getNextBatch).toHaveBeenCalledWith(
        'kckern',
        expect.objectContaining({ filter: 'reddit:worldnews,usnews' }),
      );
    });

    test('filter param defaults to null when not provided', async () => {
      await request(scrollApp).get('/api/v1/feed/scroll');
      expect(mockFeedAssemblyService.getNextBatch).toHaveBeenCalledWith(
        'kckern',
        expect.objectContaining({ filter: null }),
      );
    });
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/api/feed/feed.router.test.mjs --no-cache -t "passes filter param"`
Expected: FAIL — `filter` not in the options object

---

### Task 4: Router and FeedAssemblyService — implementation

**Files:**
- Modify: `backend/src/4_api/v1/routers/feed.mjs:134-147`
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs:29-64` (constructor) and `:77-153` (getNextBatch)
- Modify: `backend/src/app.mjs:795-803` (FeedAssemblyService construction)

**Step 1: Update the router to parse `?filter=` and pass it through**

In `backend/src/4_api/v1/routers/feed.mjs`, replace lines 134-147 (the `GET /scroll` handler):

```javascript
  router.get('/scroll', asyncHandler(async (req, res) => {
    const username = getUsername();
    const { cursor, limit, focus, source, nocache, filter } = req.query;

    const result = await feedAssemblyService.getNextBatch(username, {
      limit: limit ? Number(limit) : undefined,
      cursor,
      focus: focus || null,
      sources: source ? source.split(',').map(s => s.trim()) : null,
      nocache: nocache === '1',
      filter: filter || null,
    });

    res.json(result);
  }));
```

The only change is adding `filter` to the destructured query params and passing `filter: filter || null` to `getNextBatch`.

**Step 2: Update FeedAssemblyService constructor to accept FeedFilterResolver**

In `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`, add to the import at the top (after line 14):

```javascript
import { ScrollConfigLoader } from './ScrollConfigLoader.mjs';
import { FeedFilterResolver } from './FeedFilterResolver.mjs';
```

Add `#feedFilterResolver` to the private fields (after line 22):

```javascript
  #feedFilterResolver;
```

In the constructor (around line 37), add the parameter and assignment:

```javascript
    feedFilterResolver = null,
```

And in the constructor body (around line 56):

```javascript
    this.#feedFilterResolver = feedFilterResolver;
```

**Step 3: Update `getNextBatch()` to handle the filter param**

In `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`, update the `getNextBatch` method signature (line 77) to accept `filter`:

```javascript
  async getNextBatch(username, { limit, cursor, focus, sources, nocache, filter } = {}) {
```

Then, after loading scrollConfig and effectiveLimit (after line 81), add filter resolution and handling. Insert this block before the `if (!cursor)` check:

```javascript
    // Resolve ?filter= param (takes precedence over ?source= and ?focus=)
    if (filter && this.#feedFilterResolver) {
      const resolved = this.#feedFilterResolver.resolve(filter);
      if (resolved) {
        return this.#getFilteredBatch(username, resolved, scrollConfig, effectiveLimit, cursor);
      }
    }
```

Then add the `#getFilteredBatch` private method at the bottom of the class (before `#cacheItem`):

```javascript
  /**
   * Return a filtered batch — bypasses tier assembly.
   * Items are sorted by timestamp (newest first).
   */
  async #getFilteredBatch(username, resolved, scrollConfig, effectiveLimit, cursor) {
    if (!cursor) {
      this.#feedPoolManager.reset(username);
    }

    const freshPool = await this.#feedPoolManager.getPool(username, scrollConfig);

    let filtered;
    switch (resolved.type) {
      case 'tier':
        filtered = freshPool.filter(item => item.tier === resolved.tier);
        break;
      case 'source':
        filtered = freshPool.filter(item => item.source === resolved.sourceType);
        if (resolved.subsources) {
          const subs = new Set(resolved.subsources.map(s => s.toLowerCase()));
          filtered = filtered.filter(item => {
            const itemSub = (item.meta?.subreddit || item.meta?.sourceName || '').toLowerCase();
            return subs.has(itemSub);
          });
        }
        break;
      case 'query':
        // Query items have their source set by the adapter; match by query._filename
        // For now, filter by the query's adapter type (stored in the query config)
        filtered = freshPool.filter(item =>
          item.meta?.queryName === resolved.queryName
        );
        break;
      default:
        filtered = freshPool;
    }

    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const batch = filtered.slice(0, effectiveLimit);

    for (const item of batch) this.#cacheItem(item);
    this.#feedPoolManager.markSeen(username, batch.map(i => i.id));

    return {
      items: batch,
      hasMore: this.#feedPoolManager.hasMore(username),
      colors: ScrollConfigLoader.extractColors(scrollConfig),
    };
  }
```

**Step 4: Wire FeedFilterResolver in app.mjs**

In `backend/src/app.mjs`, add the import and construction before the FeedAssemblyService construction (around line 795).

After the `feedPoolManager` construction (line 793) and before `feedAssemblyService` (line 795), add:

```javascript
    const { FeedFilterResolver } = await import('./3_applications/feed/services/FeedFilterResolver.mjs');
    const feedFilterResolver = new FeedFilterResolver({
      sourceTypes: [redditAdapter, weatherAdapter, healthAdapter, gratitudeAdapter, stravaAdapter, todoistAdapter, immichAdapter, plexAdapter, journalAdapter, youtubeAdapter, googleNewsAdapter, komgaFeedAdapter, readalongFeedAdapter, goodreadsFeedAdapter]
        .filter(Boolean).map(a => a.sourceType),
      queryNames: queryConfigs.map(q => q._filename?.replace('.yml', '')).filter(Boolean),
      builtinTypes: ['freshrss', 'headlines', 'entropy'],
      aliases: {},
    });
```

Then add `feedFilterResolver` to the FeedAssemblyService constructor call (after line 802):

```javascript
    const feedAssemblyService = new FeedAssemblyService({
      feedPoolManager,
      sourceAdapters: [...].filter(Boolean),
      scrollConfigLoader,
      tierAssemblyService,
      feedContentService,
      selectionTrackingStore,
      feedFilterResolver,
      logger: rootLogger.child({ module: 'feed-assembly' }),
    });
```

**Step 5: Run the router tests**

Run: `npx jest tests/isolated/api/feed/feed.router.test.mjs --no-cache`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/feed.mjs backend/src/3_applications/feed/services/FeedAssemblyService.mjs backend/src/app.mjs tests/isolated/api/feed/feed.router.test.mjs
git commit -m "feat(feed): wire ?filter= param through router to assembly service

Router parses ?filter= and passes to getNextBatch(). Assembly service
resolves via FeedFilterResolver and returns filtered batch bypassing
tier assembly. Sorted by timestamp, no interleaving."
```

---

### Task 5: Tag pool items with queryName for query-type filter matching

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedPoolManager.mjs`

The `query` filter type needs to match items to their originating query config. Currently items don't carry query name metadata. We need FeedPoolManager to stamp `meta.queryName` on items as they're fetched.

**Step 1: Find the normalization point in FeedPoolManager**

In `FeedPoolManager.mjs`, the `#fetchSourcePage` method (around line 191) fetches items via adapters. After items are returned, they need `meta.queryName` set. Look for where items are pushed into the pool after fetching.

Find the code in `#fetchSourcePage` or `#initializePool` where fetched items are added to the pool (the line that does something like `pool.push(...items)`). Add this after each item is fetched:

```javascript
    // Tag items with query name for filter matching
    const queryName = query._filename?.replace('.yml', '') || null;
    for (const item of items) {
      if (queryName) {
        item.meta = item.meta || {};
        item.meta.queryName = queryName;
      }
    }
```

**Step 2: Run existing tests to ensure nothing breaks**

Run: `npx jest tests/isolated/ --no-cache`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedPoolManager.mjs
git commit -m "feat(feed): tag pool items with queryName metadata

Stamps meta.queryName on items as they're fetched, enabling
query-type filter matching in FeedFilterResolver."
```

---

### Task 6: Update Scroll.jsx to pass ?filter= to API

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx:1-2` (imports) and `:63-96` (fetchItems)

**Step 1: Add useSearchParams import**

At line 2 of `Scroll.jsx`, add `useSearchParams` to the react-router-dom import:

```javascript
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
```

**Step 2: Read searchParams in the component**

Inside the `Scroll` component (after line 24, after `const navigate = useNavigate();`), add:

```javascript
  const [searchParams] = useSearchParams();
```

**Step 3: Pass filter to API call**

In the `fetchItems` callback (around line 70-73), add the filter param. After the existing `if (focusSource) params.set('focus', focusSource);` line, add:

```javascript
      const filterParam = searchParams.get('filter');
      if (filterParam) params.set('filter', filterParam);
```

**Step 4: Add searchParams to the useCallback dependency array**

Update the `fetchItems` useCallback dependency array (line 96) from `[focusSource]` to:

```javascript
  }, [focusSource, searchParams]);
```

**Step 5: Verify the dev server works**

Start the dev server (if not running) and manually test:
- `http://localhost:3111/feed/scroll` — normal feed, should work as before
- `http://localhost:3111/feed/scroll?filter=compass` — should show only compass-tier items

**Step 6: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.jsx
git commit -m "feat(feed): read ?filter= from URL and pass to scroll API

Scroll.jsx reads the filter search param and includes it in the
API call. URL-only feature for v1, no UI controls."
```

---

### Task 7: Add subsource filtering to RedditFeedAdapter

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/RedditFeedAdapter.mjs`

This is the highest-value adapter for subsource filtering. When `?filter=reddit:worldnews,usnews` is used, items should be filtered to only those subreddits.

**Step 1: Understand the current filtering**

The subsource filter needs to work at the pool level — items are already fetched from Reddit with all configured subreddits. The `#getFilteredBatch` method in FeedAssemblyService already filters by `item.meta.subreddit`. Check that Reddit items have `meta.subreddit` set.

Read `RedditFeedAdapter.mjs` around line 243-263 where items are normalized. The `meta.subreddit` field should already be set (confirmed from the explore agent: `meta: { subreddit, score, numComments, ... }`).

**This means Reddit subsource filtering already works** via the `#getFilteredBatch` method's subsource check:

```javascript
const itemSub = (item.meta?.subreddit || item.meta?.sourceName || '').toLowerCase();
return subs.has(itemSub);
```

**Step 2: Verify with a manual test**

With the dev server running:
- `http://localhost:3111/feed/scroll?filter=reddit` — should show only reddit items
- `http://localhost:3111/api/v1/feed/scroll?filter=reddit` — API should return only reddit items

No adapter code changes needed for Reddit — the pool-level filtering handles it.

**Step 3: Commit (if any adapter changes were needed)**

If no changes needed, skip this commit.

---

### Task 8: Add built-in types to FeedFilterResolver construction

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedFilterResolver.mjs` (constructor)
- Modify: `backend/src/app.mjs` (construction site)

The FeedFilterResolver constructor currently accepts `sourceTypes` but the built-in types (freshrss, headlines, entropy) are not registered as adapters — they're handled directly in FeedPoolManager. They need to be included in the resolver's source type set.

**Step 1: Update FeedFilterResolver constructor to merge builtinTypes**

In `FeedFilterResolver.mjs`, update the constructor to accept and merge `builtinTypes`:

```javascript
  constructor({ sourceTypes = [], queryNames = [], aliases = {}, builtinTypes = [] } = {}) {
    this.#sourceTypes = new Set([...sourceTypes, ...builtinTypes]);
    this.#queryNames = new Set(queryNames);
    this.#aliases = aliases;
  }
```

**Step 2: Verify app.mjs already passes builtinTypes**

Check that the construction in app.mjs (from Task 4) already includes `builtinTypes: ['freshrss', 'headlines', 'entropy']`. It should from Task 4.

**Step 3: Add a test for built-in types**

Add to `FeedFilterResolver.test.mjs` in the "Layer 2" describe block:

```javascript
    test('resolves built-in types not in adapter list', () => {
      const r = new FeedFilterResolver({
        sourceTypes: ['reddit'],
        queryNames: [],
        aliases: {},
        builtinTypes: ['freshrss', 'headlines', 'entropy'],
      });
      expect(r.resolve('freshrss')).toEqual({
        type: 'source', sourceType: 'freshrss', subsources: null,
      });
      expect(r.resolve('headlines:cnn,cbs')).toEqual({
        type: 'source', sourceType: 'headlines', subsources: ['cnn', 'cbs'],
      });
    });
```

**Step 4: Run all tests**

Run: `npx jest tests/isolated/assembly/feed/FeedFilterResolver.test.mjs tests/isolated/api/feed/feed.router.test.mjs --no-cache`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedFilterResolver.mjs tests/isolated/assembly/feed/FeedFilterResolver.test.mjs
git commit -m "feat(feed): support built-in types (freshrss, headlines, entropy) in filter resolver"
```

---

### Task 9: End-to-end manual verification

**No code changes — verification only.**

**Step 1: Ensure dev server is running**

Run: `lsof -i :3111`
If not running: `npm run dev` (from project root)

**Step 2: Test each filter type via API**

```bash
# Tier filter
curl -s 'http://localhost:3112/api/v1/feed/scroll?filter=compass' | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d);console.log('items:',r.items.length,'tiers:',new Set(r.items.map(i=>i.tier)))})"

# Source filter
curl -s 'http://localhost:3112/api/v1/feed/scroll?filter=reddit' | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d);console.log('items:',r.items.length,'sources:',new Set(r.items.map(i=>i.source)))})"

# No filter (normal feed)
curl -s 'http://localhost:3112/api/v1/feed/scroll' | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d);console.log('items:',r.items.length,'sources:',new Set(r.items.map(i=>i.source)))})"
```

**Step 3: Test frontend**

Open in browser:
- `http://localhost:3111/feed/scroll` — normal feed
- `http://localhost:3111/feed/scroll?filter=reddit` — reddit only
- `http://localhost:3111/feed/scroll?filter=compass` — compass tier only

**Step 4: Run all isolated tests**

Run: `npx jest tests/isolated/ --no-cache`
Expected: ALL PASS

---

### Task 10: Update design doc with implementation notes

**Files:**
- Modify: `docs/_wip/plans/2026-02-17-feed-filter-param-design.md`

**Step 1: Add implementation status**

Add a section at the bottom of the design doc:

```markdown
---

## Implementation Status

- [x] FeedFilterResolver class with 4-layer chain
- [x] Router parses `?filter=` param
- [x] FeedAssemblyService bypasses assembly for filtered views
- [x] Scroll.jsx passes `?filter=` to API
- [x] Pool items tagged with `queryName` metadata
- [x] Built-in types (freshrss, headlines, entropy) supported
- [ ] Alias config in user's feed.yml (deferred)
- [ ] UI filter controls (deferred)
- [ ] Per-adapter subsource filtering beyond meta.subreddit (deferred)
```

**Step 2: Commit**

```bash
git add docs/_wip/plans/2026-02-17-feed-filter-param-design.md
git commit -m "docs: update feed filter design doc with implementation status"
```
