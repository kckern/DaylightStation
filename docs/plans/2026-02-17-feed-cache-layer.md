# Feed Cache Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a stale-while-revalidate cache layer to the feed API so source adapter calls are served from a file-backed in-memory cache, eliminating per-request external API latency.

**Architecture:** A new `FeedCacheService` sits between `FeedAssemblyService` and source adapters. It holds an in-memory `Map<sourceKey, { items, fetchedAt }>` hydrated from `data/users/{username}/current/feed/_cache.yml` on first request. When a source's TTL expires, stale data is returned immediately while a background fetch refreshes the cache and flushes to disk. Disk writes are debounced (max once per 30s).

**Tech Stack:** Node.js ES modules, YAML persistence via existing DataService, no new dependencies.

---

## Task 1: Create FeedCacheService

**Files:**
- Create: `backend/src/3_applications/feed/services/FeedCacheService.mjs`

**Step 1: Create the cache service file**

```javascript
// backend/src/3_applications/feed/services/FeedCacheService.mjs
/**
 * FeedCacheService
 *
 * Stale-while-revalidate cache for feed source adapter results.
 * In-memory Map backed by YAML file for persistence across restarts.
 *
 * Lifecycle:
 * 1. First request: hydrate from _cache.yml into memory
 * 2. Fresh cache hit: serve from memory
 * 3. Stale cache hit: serve from memory, background refresh + disk flush
 * 4. Cold (no cache): await fetch, cache + flush
 *
 * @module applications/feed/services
 */

const CACHE_PATH = 'current/feed/_cache';

/** Default TTLs in milliseconds, keyed by source type */
const DEFAULT_TTLS = Object.freeze({
  headlines:  15 * 60 * 1000,
  freshrss:   10 * 60 * 1000,
  reddit:      5 * 60 * 1000,
  youtube:    15 * 60 * 1000,
  googlenews: 10 * 60 * 1000,
  komga:      30 * 60 * 1000,
  photos:     30 * 60 * 1000,
  journal:    30 * 60 * 1000,
  entropy:     5 * 60 * 1000,
  tasks:       5 * 60 * 1000,
  health:      5 * 60 * 1000,
  weather:     5 * 60 * 1000,
  fitness:     5 * 60 * 1000,
  gratitude:   5 * 60 * 1000,
  'plex-music': 30 * 60 * 1000,
  plex:       30 * 60 * 1000,
});

const DEFAULT_TTL = 10 * 60 * 1000; // 10 min fallback
const FLUSH_DEBOUNCE_MS = 30 * 1000; // 30 seconds

export class FeedCacheService {
  #dataService;
  #logger;

  /** @type {Map<string, { items: Object[], fetchedAt: string }>} */
  #cache = new Map();

  /** @type {Map<string, boolean>} tracks in-flight refreshes */
  #refreshing = new Map();

  #hydrated = false;
  #flushTimer = null;
  #dirty = false;

  /**
   * @param {Object} config
   * @param {Object} config.dataService - DataService for YAML I/O
   * @param {Object} [config.logger]
   */
  constructor({ dataService, logger = console }) {
    this.#dataService = dataService;
    this.#logger = logger;
  }

  /**
   * Get cached items for a source, using stale-while-revalidate strategy.
   *
   * @param {string} sourceKey - Source identifier (e.g. 'reddit', 'youtube')
   * @param {Function} fetchFn - Async function that returns items when called
   * @param {string} username - User identifier (for disk persistence path)
   * @param {Object} [options]
   * @param {boolean} [options.noCache] - Bypass cache, force fresh fetch
   * @returns {Promise<Object[]>} Cached or freshly fetched items
   */
  async getItems(sourceKey, fetchFn, username, { noCache = false } = {}) {
    this.#hydrateIfNeeded(username);

    if (noCache) {
      return this.#fetchAndCache(sourceKey, fetchFn, username);
    }

    const entry = this.#cache.get(sourceKey);
    if (!entry) {
      // Cold start for this source — must await
      return this.#fetchAndCache(sourceKey, fetchFn, username);
    }

    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    const ttl = DEFAULT_TTLS[sourceKey] ?? DEFAULT_TTL;

    if (age < ttl) {
      // Fresh — serve from cache
      return entry.items;
    }

    // Stale — serve cached, trigger background refresh
    this.#backgroundRefresh(sourceKey, fetchFn, username);
    return entry.items;
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  /**
   * Hydrate in-memory cache from disk on first access.
   */
  #hydrateIfNeeded(username) {
    if (this.#hydrated) return;
    this.#hydrated = true;

    try {
      const data = this.#dataService.user.read(CACHE_PATH, username);
      if (data && typeof data === 'object') {
        for (const [key, entry] of Object.entries(data)) {
          if (entry?.items && entry?.fetchedAt) {
            this.#cache.set(key, {
              items: entry.items,
              fetchedAt: entry.fetchedAt,
            });
          }
        }
        this.#logger.info?.('feed.cache.hydrated', {
          sources: this.#cache.size,
          keys: [...this.#cache.keys()],
        });
      }
    } catch (err) {
      this.#logger.warn?.('feed.cache.hydrate.error', { error: err.message });
    }
  }

  /**
   * Fetch from source, update cache, schedule disk flush.
   */
  async #fetchAndCache(sourceKey, fetchFn, username) {
    try {
      const items = await fetchFn();
      this.#cache.set(sourceKey, {
        items,
        fetchedAt: new Date().toISOString(),
      });
      this.#scheduleDiskFlush(username);
      return items;
    } catch (err) {
      this.#logger.warn?.('feed.cache.fetch.error', { sourceKey, error: err.message });
      // Return stale cache if available
      const stale = this.#cache.get(sourceKey);
      if (stale) {
        this.#logger.info?.('feed.cache.serving.stale', { sourceKey });
        return stale.items;
      }
      return [];
    }
  }

  /**
   * Background refresh — fire and forget, no await.
   */
  #backgroundRefresh(sourceKey, fetchFn, username) {
    if (this.#refreshing.get(sourceKey)) return; // already in-flight
    this.#refreshing.set(sourceKey, true);

    this.#fetchAndCache(sourceKey, fetchFn, username)
      .finally(() => this.#refreshing.delete(sourceKey));
  }

  /**
   * Debounced disk flush — writes full cache to _cache.yml at most once per 30s.
   */
  #scheduleDiskFlush(username) {
    this.#dirty = true;
    if (this.#flushTimer) return; // already scheduled

    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      if (!this.#dirty) return;
      this.#dirty = false;
      this.#flushToDisk(username);
    }, FLUSH_DEBOUNCE_MS);
  }

  /**
   * Write full cache to disk as YAML.
   */
  #flushToDisk(username) {
    try {
      const data = {};
      for (const [key, entry] of this.#cache.entries()) {
        data[key] = {
          fetchedAt: entry.fetchedAt,
          items: entry.items,
        };
      }
      this.#dataService.user.write(CACHE_PATH, data, username);
      this.#logger.debug?.('feed.cache.flushed', { sources: Object.keys(data).length });
    } catch (err) {
      this.#logger.warn?.('feed.cache.flush.error', { error: err.message });
    }
  }
}

export default FeedCacheService;
```

**Step 2: Verify file was created correctly**

Run: `node -e "import('./backend/src/3_applications/feed/services/FeedCacheService.mjs').then(m => console.log('OK:', typeof m.FeedCacheService))"`
Expected: `OK: function`

**Step 3: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedCacheService.mjs
git commit -m "feat(feed): add FeedCacheService with stale-while-revalidate"
```

---

## Task 2: Integrate FeedCacheService into FeedAssemblyService

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs:18-67` (constructor)
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs:218-235` (#fetchSource)

**Step 1: Add feedCacheService to constructor**

In `FeedAssemblyService`, add `#feedCacheService` private field and accept it in constructor.

Add after line 28 (`#logger;`):
```javascript
  #feedCacheService;
```

Add `feedCacheService = null,` to the constructor params (after `feedContentService = null,` on line 43).

Add after line 58 (`this.#feedContentService = feedContentService || null;`):
```javascript
    this.#feedCacheService = feedCacheService;
```

**Step 2: Wrap #fetchSource in cache layer**

Replace `#fetchSource` (lines 218-235) with:

```javascript
  async #fetchSource(query, username) {
    const sourceKey = query._filename?.replace('.yml', '') || query.type;

    // If no cache service, fetch directly (backwards compat)
    if (!this.#feedCacheService) {
      return this.#fetchSourceDirect(query, username);
    }

    const noCache = query._noCache || false;
    return this.#feedCacheService.getItems(
      sourceKey,
      () => this.#fetchSourceDirect(query, username),
      username,
      { noCache }
    );
  }

  async #fetchSourceDirect(query, username) {
    // Check adapter registry first
    const adapter = this.#sourceAdapters.get(query.type);
    if (adapter) {
      const items = await adapter.fetchItems(query, username);
      return items.map(item => this.#normalizeToFeedItem(item));
    }

    // Built-in handlers (depend on application-layer services)
    switch (query.type) {
      case 'freshrss': return this.#fetchFreshRSS(query, username);
      case 'headlines': return this.#fetchHeadlines(query, username);
      case 'entropy': return this.#fetchEntropy(query, username);
      default:
        this.#logger.warn?.('feed.assembly.unknown.type', { type: query.type });
        return [];
    }
  }
```

**Step 3: Verify the module still loads**

Run: `node -e "import('./backend/src/3_applications/feed/services/FeedAssemblyService.mjs').then(m => console.log('OK:', typeof m.FeedAssemblyService))"`
Expected: `OK: function`

**Step 4: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs
git commit -m "feat(feed): wire FeedCacheService into FeedAssemblyService#fetchSource"
```

---

## Task 3: Wire FeedCacheService in app.mjs bootstrap

**Files:**
- Modify: `backend/src/app.mjs:649` (import section)
- Modify: `backend/src/app.mjs:762-777` (FeedAssemblyService instantiation)

**Step 1: Add import for FeedCacheService**

After the `TierAssemblyService` import (line 746), add:
```javascript
    const { FeedCacheService } = await import('./3_applications/feed/services/FeedCacheService.mjs');
```

**Step 2: Instantiate FeedCacheService**

After `tierAssemblyService` instantiation (line 753), add:
```javascript
    const feedCacheService = new FeedCacheService({
      dataService,
      logger: rootLogger.child({ module: 'feed-cache' }),
    });
```

**Step 3: Inject into FeedAssemblyService constructor**

Add `feedCacheService,` to the FeedAssemblyService constructor call (after `tierAssemblyService,` around line 774):
```javascript
      feedCacheService,
```

**Step 4: Add nocache query param support to feed router**

In `backend/src/4_api/v1/routers/feed.mjs`, update the `/scroll` handler (line 134-146) to pass `nocache` through:

Replace:
```javascript
    const result = await feedAssemblyService.getNextBatch(username, {
      limit: limit ? Number(limit) : undefined,
      cursor,
      focus: focus || null,
      sources: source ? source.split(',').map(s => s.trim()) : null,
    });
```

With:
```javascript
    const nocache = req.query.nocache === '1';
    const result = await feedAssemblyService.getNextBatch(username, {
      limit: limit ? Number(limit) : undefined,
      cursor,
      focus: focus || null,
      sources: source ? source.split(',').map(s => s.trim()) : null,
      nocache,
    });
```

Then in `FeedAssemblyService.getNextBatch()`, pass `nocache` through to queries. Add after `const queries = ...` (around line 89):
```javascript
    // Pass nocache flag to each query for cache bypass
    if (nocache) {
      for (const q of queries) q._noCache = true;
    }
```

**Step 5: Verify server starts**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && node -e "import('./backend/src/app.mjs').catch(e => console.error(e.message))"`
Expected: No import errors (server may not fully start without env, but module graph should resolve)

**Step 6: Commit**

```bash
git add backend/src/app.mjs backend/src/4_api/v1/routers/feed.mjs backend/src/3_applications/feed/services/FeedAssemblyService.mjs
git commit -m "feat(feed): bootstrap FeedCacheService and add nocache param"
```

---

## Task 4: Fix FreshRSS query config filename mismatch

**Files:**
- Rename: `data/household/config/lists/queries/news.yml` → `data/household/config/lists/queries/freshrss.yml`

**Step 1: Rename the query config file**

```bash
cp /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/lists/queries/news.yml \
   /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/lists/queries/freshrss.yml
```

Verify the content still has `type: freshrss`:
```bash
cat /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/lists/queries/freshrss.yml
```

Then remove the old file:
```bash
rm /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/lists/queries/news.yml
```

**Step 2: Verify the scroll config source key matches**

The user's `feed.yml` already has `freshrss:` as the wire source key (changed earlier in this session). The query file `freshrss.yml` → `_filename` key `freshrss` → matches `enabledSources.has('freshrss')` → query passes filter. No code changes needed.

**Step 3: Commit (if data dir is tracked)**

If the queries dir is in the repo, commit. If it's on Dropbox only, no commit needed.

---

## Task 5: Smoke test the full flow

**Step 1: Restart the dev server**

```bash
# Kill existing
pkill -f 'node backend/index.js' 2>/dev/null; pkill -f 'nodemon' 2>/dev/null
# Start fresh
cd /Users/kckern/Documents/GitHub/DaylightStation && npm run dev &
# Wait for startup
sleep 5
```

**Step 2: First request (cold cache — populates cache)**

```bash
curl -s "http://localhost:3112/api/v1/feed/scroll?username=kckern" | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
items = data.get('items', [])
print(f'Total items: {len(items)}')
tiers = {}
for item in items:
    t = item.get('tier', 'unknown')
    tiers[t] = tiers.get(t, 0) + 1
print('BY TIER:', tiers)
wire = [i for i in items if i.get('tier') == 'wire']
sources = {}
for i in wire:
    s = i.get('source', '?')
    sources[s] = sources.get(s, 0) + 1
print('WIRE SOURCES:', sources)
"
```

Expected: Items from multiple wire sources (reddit, freshrss, youtube, googlenews, headline).

**Step 3: Second request (should be fast — served from cache)**

```bash
time curl -s "http://localhost:3112/api/v1/feed/scroll?username=kckern" > /dev/null
```

Expected: Response time significantly faster than first request (sub-100ms vs multi-second).

**Step 4: Verify cache file was written**

```bash
ls -la /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/users/kckern/current/feed/_cache.yml
```

Expected: File exists with recent timestamp.

**Step 5: Test nocache bypass**

```bash
time curl -s "http://localhost:3112/api/v1/feed/scroll?username=kckern&nocache=1" > /dev/null
```

Expected: Slower response (fresh fetch from all sources).
