# Feed Pool Pagination — On-Demand Source Pagination with Silent Recycling

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the fixed-pool feed assembly with on-demand source pagination so infinite scroll never runs dry — sources are paged deeper as the user scrolls, age-gated per source, with silent recycling when all sources exhaust.

**Architecture:** New `FeedPoolManager` application service sits between `FeedAssemblyService` and source adapters. Adapters gain a paginated `fetchPage()` contract via an updated `IFeedSourceAdapter` port. The pool manager tracks per-source cursors, proactively refills when the pool runs thin, enforces per-source age thresholds, and silently reshuffles seen items when all sources are exhausted. `FeedAssemblyService` delegates all source fetching to the pool manager and no longer owns `#fetchAllSources`.

**Tech Stack:** Node.js ES modules, existing DDD layer structure (ports in `3_applications`, adapters in `1_adapters`), YAML config via ScrollConfigLoader, Playwright for E2E test.

---

## Task 1: Update IFeedSourceAdapter Port Interface

**Files:**
- Modify: `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs`

**Step 1: Write the updated port interface**

Replace the current `fetchItems` method with `fetchPage` that accepts and returns a cursor. Keep `fetchItems` as a backwards-compat wrapper so existing callers don't break during migration.

```js
// backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs
export class IFeedSourceAdapter {
  get sourceType() {
    throw new Error('IFeedSourceAdapter.sourceType must be implemented');
  }

  /**
   * Fetch a page of items from this source.
   *
   * @param {Object} query - Query config object from YAML
   * @param {string} username - Current user
   * @param {Object} [options]
   * @param {string|null} [options.cursor] - Opaque cursor from a previous fetchPage call
   * @returns {Promise<{ items: Object[], cursor: string|null }>}
   *   cursor is null when no more pages are available.
   */
  async fetchPage(query, username, { cursor } = {}) {
    // Default implementation: delegate to legacy fetchItems, no cursor
    const items = await this.fetchItems(query, username);
    return { items, cursor: null };
  }

  /**
   * @deprecated Use fetchPage instead. Kept for backwards compatibility.
   */
  async fetchItems(query, username) {
    throw new Error('IFeedSourceAdapter.fetchItems must be implemented');
  }

  async getDetail(localId, meta, username) {
    return null;
  }
}

export function isFeedSourceAdapter(obj) {
  return obj &&
    typeof obj.sourceType === 'string' &&
    (typeof obj.fetchPage === 'function' || typeof obj.fetchItems === 'function');
}
```

**Step 2: Verify no tests break**

Run: `npx playwright test tests/live/flow/feed/ --reporter=line`
Expected: existing feed tests still pass (port is backwards-compatible).

**Step 3: Commit**

```bash
git add backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs
git commit -m "feat(feed): add fetchPage to IFeedSourceAdapter port with cursor support"
```

---

## Task 2: Add `max_age_hours` to ScrollConfigLoader

**Files:**
- Modify: `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs`

**Step 1: Add max_age_hours parsing and a static helper**

In `ScrollConfigLoader`, add a static method `getMaxAgeMs(scrollConfig, sourceKey)` that looks up `max_age_hours` from the source's tier config and returns milliseconds. Defaults:

| Tier | Default `max_age_hours` |
|------|------------------------|
| wire | 48 |
| library | `null` (unlimited) |
| scrapbook | `null` (unlimited) |
| compass | 48 |

Per-source overrides: `freshrss: 336`, `reddit: 168`, `headlines: 48`, `googlenews: 48`.

Add to `TIER_DEFAULTS` a `default_max_age_hours` per tier. Add to `DEFAULTS` a top-level `max_age_hours` object for source-level overrides.

```js
// Add after existing DEFAULTS (line ~38)

const DEFAULT_MAX_AGE_HOURS = Object.freeze({
  freshrss: 336,    // 2 weeks
  reddit: 168,      // 1 week
  headlines: 48,
  googlenews: 48,
});

const TIER_DEFAULT_MAX_AGE = Object.freeze({
  wire: 48,
  library: null,      // timeless
  scrapbook: null,    // timeless
  compass: 48,
});
```

Add static method:

```js
/**
 * Get max age in milliseconds for a source.
 * Returns null if the source has no age limit (timeless content).
 *
 * Priority: source-level config > tier-level config > hardcoded default
 *
 * @param {Object} scrollConfig - Merged scroll config
 * @param {string} sourceKey - Source identifier (e.g. 'reddit', 'freshrss')
 * @returns {number|null} Max age in ms, or null for unlimited
 */
static getMaxAgeMs(scrollConfig, sourceKey) {
  // Check source-level override in any tier
  const tiers = scrollConfig.tiers || {};
  for (const [tierName, tier] of Object.entries(tiers)) {
    const sourceCfg = tier.sources?.[sourceKey];
    if (sourceCfg && 'max_age_hours' in sourceCfg) {
      return sourceCfg.max_age_hours === null ? null : sourceCfg.max_age_hours * 3600000;
    }
  }

  // Check hardcoded source defaults
  if (sourceKey in DEFAULT_MAX_AGE_HOURS) {
    return DEFAULT_MAX_AGE_HOURS[sourceKey] * 3600000;
  }

  // Check tier-level default (find which tier this source belongs to)
  for (const [tierName, tier] of Object.entries(tiers)) {
    if (tier.sources?.[sourceKey] !== undefined) {
      const tierDefault = TIER_DEFAULT_MAX_AGE[tierName];
      return tierDefault === null ? null : (tierDefault ?? 48) * 3600000;
    }
  }

  // Absolute fallback: 48 hours
  return 48 * 3600000;
}
```

**Step 2: Verify no existing behavior changes**

Run: `npx playwright test tests/live/flow/feed/ --reporter=line`
Expected: PASS (new static method, nothing calls it yet).

**Step 3: Commit**

```bash
git add backend/src/3_applications/feed/services/ScrollConfigLoader.mjs
git commit -m "feat(feed): add max_age_hours config and getMaxAgeMs to ScrollConfigLoader"
```

---

## Task 3: Wire Pagination into FreshRSS (Built-in Handler)

**Files:**
- Modify: `backend/src/1_adapters/feed/FreshRSSFeedAdapter.mjs`

FreshRSS is a built-in handler in `FeedAssemblyService`, not a registered adapter. It already supports a `continuation` param in `getItems()` but the response discards the GReader API's continuation token.

**Step 1: Return continuation token from `getItems`**

Change `getItems` to return `{ items, continuation }` instead of just items. This is a **breaking change** to the return type, so callers must be updated.

```js
// FreshRSSFeedAdapter.mjs — getItems method (line 91)
async getItems(streamId, username, options = {}) {
  const count = options.count || 50;
  const exclude = options.excludeRead ? '&xt=user/-/state/com.google/read' : '';
  const cont = options.continuation ? `&c=${options.continuation}` : '';
  const path = `/stream/contents/${encodeURIComponent(streamId)}?output=json&n=${count}${exclude}${cont}`;

  const data = await this.#greaderRequest(path, username);

  const items = (data.items || []).map(item => ({
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

  return { items, continuation: data.continuation || null };
}
```

**Step 2: Update all callers of `getItems`**

There are two callers:
1. `FeedAssemblyService.#fetchFreshRSS` (line ~322) — destructure: `const { items } = await this.#freshRSSAdapter.getItems(...)`. The continuation is not used yet (Task 5 will wire it via pool manager).
2. The feed reader router (`4_api/v1/routers/feed.mjs`) — check this file and update it to destructure similarly.

Search for all usages:

```bash
grep -rn 'freshRSSAdapter.getItems\|freshRSSAdapter\.getItems' backend/src/
```

Update each caller to destructure `{ items }` or `{ items, continuation }` as appropriate.

**Step 3: Verify**

Run: `npx playwright test tests/live/flow/feed/ --reporter=line`
Expected: PASS.

**Step 4: Commit**

```bash
git add backend/src/1_adapters/feed/FreshRSSFeedAdapter.mjs
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs
git add backend/src/4_api/v1/routers/feed.mjs
git commit -m "feat(feed): return continuation token from FreshRSSFeedAdapter.getItems"
```

---

## Task 4: Wire Pagination into RedditFeedAdapter

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/RedditFeedAdapter.mjs`

**Step 1: Override `fetchPage` to pass Reddit's `after` cursor**

Reddit JSON API returns `data.after` as a pagination cursor. Add `fetchPage` to `RedditFeedAdapter`:

```js
/**
 * @param {Object} query
 * @param {string} username
 * @param {Object} [options]
 * @param {string|null} [options.cursor] - Reddit `after` token from previous page
 * @returns {Promise<{ items: Object[], cursor: string|null }>}
 */
async fetchPage(query, username, { cursor } = {}) {
  let subredditConfig = query.params?.subreddits;
  try {
    const feedConfig = this.#dataService.user.read('config/feed', username);
    if (feedConfig?.reddit?.subreddits) {
      subredditConfig = feedConfig.reddit.subreddits;
    }
  } catch { /* user config not found */ }

  if (!subredditConfig) return { items: [], cursor: null };

  try {
    const limit = query.limit || 15;
    const subs = this.#resolveSubreddits(subredditConfig);
    const { items, after } = await this.#fetchMultiSubredditPaginated(subs, limit, query, cursor);
    return { items: items.slice(0, limit), cursor: after || null };
  } catch (err) {
    this.#logger.warn?.('reddit.adapter.error', { error: err.message });
    return { items: [], cursor: null };
  }
}
```

Add `#fetchMultiSubredditPaginated` (copy of `#fetchMultiSubreddit` but accepts/returns `after`):

```js
async #fetchMultiSubredditPaginated(subreddits, limit, query, afterToken, attempt = 0) {
  const combined = subreddits.join('+');
  const afterParam = afterToken ? `&after=${afterToken}` : '';
  const url = `https://www.reddit.com/r/${combined}.json?limit=${limit}${afterParam}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (res.status === 429 && attempt < 2) {
    await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
    return this.#fetchMultiSubredditPaginated(subreddits, limit, query, afterToken, attempt + 1);
  }
  if (!res.ok) return { items: [], after: null };

  const data = await res.json();
  const posts = data?.data?.children || [];
  const after = data?.data?.after || null;

  const items = posts
    .filter(p => p.kind === 't3' && !p.data.stickied)
    .map(p => {
      // ... (same mapping as existing #fetchMultiSubreddit, lines 203-233)
      const post = p.data;
      const subreddit = post.subreddit;
      const youtubeId = this.#extractYoutubeId(post.url);
      const previewSource = post.preview?.images?.[0]?.source;
      const imageWidth = previewSource?.width || undefined;
      const imageHeight = previewSource?.height || undefined;
      const rawImage = this.#extractImage(post) || (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : null);
      const image = rawImage ? this.#proxyUrl(rawImage) : null;
      return {
        id: `reddit:${post.id}`,
        tier: query.tier || 'wire',
        source: 'reddit',
        title: post.title,
        body: post.selftext?.slice(0, 200) || null,
        image,
        link: `https://www.reddit.com${post.permalink}`,
        timestamp: new Date(post.created_utc * 1000).toISOString(),
        priority: query.priority || 0,
        meta: {
          subreddit,
          score: post.score,
          numComments: post.num_comments,
          postId: post.id,
          youtubeId: youtubeId || undefined,
          sourceName: `r/${subreddit}`,
          sourceIcon: `https://www.reddit.com/r/${subreddit}`,
          ...(imageWidth && imageHeight ? { imageWidth, imageHeight } : {}),
        },
      };
    });

  return { items, after };
}
```

**Step 2: Keep existing `fetchItems` working** (it delegates to `fetchPage` via the base class default, or keep it as-is for now — pool manager will call `fetchPage`).

**Step 3: Commit**

```bash
git add backend/src/1_adapters/feed/sources/RedditFeedAdapter.mjs
git commit -m "feat(feed): add fetchPage with after cursor to RedditFeedAdapter"
```

---

## Task 5: Wire Pagination into GoogleNewsFeedAdapter

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/GoogleNewsFeedAdapter.mjs`

Google News RSS has no native pagination. The "cursor" is an offset into the full parsed RSS result set.

**Step 1: Override `fetchPage` with offset-based cursor**

```js
async fetchPage(query, _username, { cursor } = {}) {
  const topics = query.params?.topics || [];
  const limit = query.limit || 10;
  const offset = cursor ? parseInt(cursor, 10) : 0;

  if (topics.length === 0) return { items: [], cursor: null };

  try {
    // Fetch ALL available items per topic (RSS feeds return ~20 each)
    const perTopic = 50; // fetch generously, slice later
    const results = await Promise.allSettled(
      topics.map(topic => this.#fetchTopic(topic, perTopic, query))
    );

    const allItems = [];
    for (const result of results) {
      if (result.status === 'fulfilled') allItems.push(...result.value);
    }

    // Sort by timestamp descending for stable ordering
    allItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Apply offset + limit
    const page = allItems.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    const hasMore = nextOffset < allItems.length;

    return {
      items: page,
      cursor: hasMore ? String(nextOffset) : null,
    };
  } catch (err) {
    this.#logger.warn?.('googlenews.adapter.error', { error: err.message });
    return { items: [], cursor: null };
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/feed/sources/GoogleNewsFeedAdapter.mjs
git commit -m "feat(feed): add offset-based fetchPage to GoogleNewsFeedAdapter"
```

---

## Task 6: Wire Pagination into Remaining Adapters

**Files:**
- Modify each adapter in `backend/src/1_adapters/feed/sources/`:
  - `KomgaFeedAdapter.mjs` — cursor = `{ seriesIdx, issueOffset }` serialized as JSON string. Each page picks the next series/issue.
  - `ImmichFeedAdapter.mjs` — cursor = page number if Immich API supports `page` param.
  - `PlexFeedAdapter.mjs` — cursor = offset into recently-added list.
  - All others (Weather, Health, Gratitude, Strava, Todoist, Journal, YouTube, Readalong) — keep default `fetchPage` from base class (returns `cursor: null`, one-shot sources). No code changes needed for these.

For each adapter that gains real pagination:

**Step 1: Add `fetchPage` override** following the same pattern as Tasks 4-5.

**Step 2: Commit per adapter** (or batch if small changes).

Note: The base class `fetchPage` default already wraps `fetchItems` and returns `cursor: null`, so one-shot sources require zero changes.

---

## Task 7: Create FeedPoolManager

**Files:**
- Create: `backend/src/3_applications/feed/services/FeedPoolManager.mjs`

This is the core new component. It manages the per-user item pool, cursor tracking, proactive refill, age filtering, and silent recycling.

**Step 1: Create the file**

```js
// backend/src/3_applications/feed/services/FeedPoolManager.mjs
/**
 * FeedPoolManager
 *
 * Manages a per-user pool of feed items with on-demand source pagination.
 * Sits between FeedAssemblyService and source adapters/cache.
 *
 * Responsibilities:
 * - Accumulates items from paginated source fetches
 * - Tracks per-source continuation cursors
 * - Proactively refills when pool runs thin
 * - Enforces per-source max_age_hours thresholds
 * - Silently recycles seen items when all sources exhaust
 *
 * @module applications/feed/services
 */

import { ScrollConfigLoader } from './ScrollConfigLoader.mjs';

export class FeedPoolManager {
  #sourceAdapters;       // Map<sourceType, adapter>
  #feedCacheService;
  #queryConfigs;
  #freshRSSAdapter;
  #headlineService;
  #entropyService;
  #logger;

  /** @type {Map<string, FeedItem[]>} Per-user accumulated pool */
  #pools = new Map();

  /** @type {Map<string, Set<string>>} Per-user seen item IDs */
  #seenIds = new Map();

  /** @type {Map<string, FeedItem[]>} Per-user history for recycling */
  #seenItems = new Map();

  /** @type {Map<string, Map<string, CursorState>>} Per-user, per-source cursor tracking */
  #cursors = new Map();

  /** @type {Map<string, boolean>} Per-user refill-in-progress flag */
  #refilling = new Map();

  /** @type {Map<string, Object>} Per-user cached scrollConfig */
  #scrollConfigs = new Map();

  static #REFILL_THRESHOLD_MULTIPLIER = 2; // refill when remaining < 2 × batch_size

  constructor({
    sourceAdapters = [],
    feedCacheService = null,
    queryConfigs = [],
    freshRSSAdapter = null,
    headlineService = null,
    entropyService = null,
    logger = console,
  }) {
    this.#sourceAdapters = new Map();
    for (const adapter of sourceAdapters) {
      this.#sourceAdapters.set(adapter.sourceType, adapter);
    }
    this.#feedCacheService = feedCacheService;
    this.#queryConfigs = queryConfigs;
    this.#freshRSSAdapter = freshRSSAdapter;
    this.#headlineService = headlineService;
    this.#entropyService = entropyService;
    this.#logger = logger;
  }

  /**
   * Get the current item pool for a user (excluding seen items).
   * Triggers proactive refill if pool is thin.
   *
   * @param {string} username
   * @param {Object} scrollConfig - Merged scroll config from ScrollConfigLoader
   * @returns {Promise<FeedItem[]>}
   */
  async getPool(username, scrollConfig) {
    this.#scrollConfigs.set(username, scrollConfig);

    // If no pool exists, this is a fresh load — initialize
    if (!this.#pools.has(username)) {
      await this.#initializePool(username, scrollConfig);
    }

    const pool = this.#pools.get(username) || [];
    const seen = this.#seenIds.get(username) || new Set();
    return pool.filter(item => !seen.has(item.id));
  }

  /**
   * Mark item IDs as seen (consumed by a batch).
   * Triggers proactive refill if remaining pool is thin.
   * Triggers silent recycling if pool is empty and all sources exhausted.
   *
   * @param {string} username
   * @param {string[]} itemIds
   */
  markSeen(username, itemIds) {
    const seen = this.#seenIds.get(username) || new Set();
    const history = this.#seenItems.get(username) || [];
    const pool = this.#pools.get(username) || [];

    for (const id of itemIds) {
      seen.add(id);
      const item = pool.find(i => i.id === id);
      if (item) history.push(item);
    }

    this.#seenIds.set(username, seen);
    this.#seenItems.set(username, history);

    // Check pool depth
    const remaining = pool.filter(i => !seen.has(i.id)).length;
    const scrollConfig = this.#scrollConfigs.get(username);
    const batchSize = scrollConfig?.batch_size ?? 15;
    const threshold = batchSize * FeedPoolManager.#REFILL_THRESHOLD_MULTIPLIER;

    if (remaining < threshold) {
      if (this.#hasRefillableSources(username)) {
        this.#proactiveRefill(username, scrollConfig);
      } else if (remaining === 0) {
        this.#recycle(username);
      }
    }
  }

  /**
   * Whether more items can be served (pool has unseen items OR sources are refillable).
   *
   * @param {string} username
   * @returns {boolean}
   */
  hasMore(username) {
    const pool = this.#pools.get(username) || [];
    const seen = this.#seenIds.get(username) || new Set();
    const remaining = pool.filter(i => !seen.has(i.id)).length;

    // Always true: either we have items, or we can refill, or we can recycle
    return remaining > 0 || this.#hasRefillableSources(username) || (this.#seenItems.get(username)?.length || 0) > 0;
  }

  /**
   * Reset all state for a user (called on fresh page load, no cursor).
   *
   * @param {string} username
   */
  reset(username) {
    this.#pools.delete(username);
    this.#seenIds.delete(username);
    this.#seenItems.delete(username);
    this.#cursors.delete(username);
    this.#refilling.delete(username);
    this.#scrollConfigs.delete(username);
  }

  // =========================================================================
  // Internal: Pool Initialization
  // =========================================================================

  async #initializePool(username, scrollConfig) {
    const queries = this.#filterQueries(scrollConfig);
    const results = await Promise.allSettled(
      queries.map(query => this.#fetchSourcePage(query, username, scrollConfig))
    );

    const allItems = [];
    const cursorMap = this.#cursors.get(username) || new Map();

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        const { items, cursor, sourceKey } = results[i].value;
        allItems.push(...items);
        cursorMap.set(sourceKey, {
          cursor,
          exhausted: cursor === null,
          lastFetch: Date.now(),
        });
      } else {
        this.#logger.warn?.('feed.pool.init.source.failed', {
          query: queries[i].type,
          error: results[i].reason?.message,
        });
      }
    }

    this.#cursors.set(username, cursorMap);
    this.#pools.set(username, allItems);
    this.#seenIds.set(username, new Set());
    this.#seenItems.set(username, []);
  }

  // =========================================================================
  // Internal: Source Fetching (Page-Aware)
  // =========================================================================

  /**
   * Fetch one page from a source, applying age filtering.
   * Returns { items, cursor, sourceKey }.
   */
  async #fetchSourcePage(query, username, scrollConfig, cursorToken = undefined) {
    const sourceKey = query._filename?.replace('.yml', '') || query.type;
    const maxAgeMs = ScrollConfigLoader.getMaxAgeMs(scrollConfig, sourceKey);
    const now = Date.now();

    let items, cursor;

    // Check adapter registry for fetchPage
    const adapter = this.#sourceAdapters.get(query.type);
    if (adapter && typeof adapter.fetchPage === 'function') {
      const fetchFn = () => adapter.fetchPage(query, username, { cursor: cursorToken });

      if (this.#feedCacheService && cursorToken === undefined) {
        // First page: use cache service
        const cached = await this.#feedCacheService.getItems(sourceKey, async () => {
          const result = await fetchFn();
          // Store cursor on the items array for retrieval (cache only stores items)
          result.items._cursor = result.cursor;
          return result.items;
        }, username);
        items = cached;
        cursor = cached._cursor ?? null;
        delete items._cursor;
      } else {
        // Subsequent pages: bypass cache (cache doesn't have page 2+)
        const result = await fetchFn();
        items = result.items;
        cursor = result.cursor;
      }
    } else if (adapter) {
      // Legacy adapter without fetchPage
      const fetchFn = () => adapter.fetchItems(query, username);
      if (this.#feedCacheService) {
        items = await this.#feedCacheService.getItems(sourceKey, fetchFn, username);
      } else {
        items = await fetchFn();
      }
      cursor = null;
    } else {
      // Built-in handlers (freshrss, headlines, entropy)
      const result = await this.#fetchBuiltinPage(query, username, cursorToken);
      items = result.items;
      cursor = result.cursor;
    }

    // Normalize items through FeedAssemblyService-style mapping
    // (Adapters already return normalized items, but built-ins need it)

    // Age filter: discard items older than max_age_hours
    if (maxAgeMs !== null) {
      const cutoff = now - maxAgeMs;
      const beforeCount = items.length;
      items = items.filter(item => {
        const ts = new Date(item.timestamp).getTime();
        return ts >= cutoff;
      });
      if (items.length < beforeCount) {
        this.#logger.info?.('feed.pool.age.filtered', {
          sourceKey,
          before: beforeCount,
          after: items.length,
          maxAgeHours: maxAgeMs / 3600000,
        });
      }
      // If entire page was stale, mark source exhausted
      if (items.length === 0 && beforeCount > 0) {
        cursor = null;
      }
    }

    return { items, cursor, sourceKey };
  }

  /**
   * Built-in handler dispatching (freshrss, headlines, entropy).
   * These depend on application-layer services, not adapter registry.
   */
  async #fetchBuiltinPage(query, username, cursorToken) {
    switch (query.type) {
      case 'freshrss': return this.#fetchFreshRSSPage(query, username, cursorToken);
      case 'headlines': return this.#fetchHeadlinesPage(query, username, cursorToken);
      case 'entropy':   return { items: await this.#fetchEntropy(query, username), cursor: null };
      default:
        this.#logger.warn?.('feed.pool.unknown.type', { type: query.type });
        return { items: [], cursor: null };
    }
  }

  async #fetchFreshRSSPage(query, username, cursorToken) {
    if (!this.#freshRSSAdapter) return { items: [], cursor: null };
    const { items: rawItems, continuation } = await this.#freshRSSAdapter.getItems(
      'user/-/state/com.google/reading-list',
      username,
      {
        excludeRead: query.params?.excludeRead ?? true,
        count: query.limit || 20,
        continuation: cursorToken || undefined,
      }
    );
    // Normalize to FeedItem shape (same as FeedAssemblyService.#fetchFreshRSS)
    const items = (rawItems || []).map(item => ({
      id: `freshrss:${item.id}`,
      tier: query.tier || 'wire',
      source: 'freshrss',
      title: item.title,
      body: item.content ? item.content.replace(/<[^>]*>/g, '').slice(0, 200) : null,
      image: this.#extractImage(item.content),
      link: item.link,
      timestamp: item.published?.toISOString?.() || item.published || new Date().toISOString(),
      priority: query.priority || 0,
      meta: {
        feedTitle: item.feedTitle,
        author: item.author,
        sourceName: item.feedTitle || 'RSS',
        sourceIcon: item.link ? (() => { try { return new URL(item.link).origin; } catch { return null; } })() : null,
      },
    }));
    return { items, cursor: continuation || null };
  }

  async #fetchHeadlinesPage(query, username, cursorToken) {
    if (!this.#headlineService) return { items: [], cursor: null };
    const pages = this.#headlineService.getPageList(username);
    const firstPageId = pages[0]?.id;
    if (!firstPageId) return { items: [], cursor: null };

    const result = await this.#headlineService.getAllHeadlines(username, firstPageId);
    const totalLimit = query.limit || 30;
    const offset = cursorToken ? parseInt(cursorToken, 10) : 0;
    const allItems = [];

    for (const [sourceId, source] of Object.entries(result.sources || {})) {
      for (const item of (source.items || [])) {
        allItems.push({
          id: `headline:${item.id || sourceId + ':' + item.link}`,
          tier: query.tier || 'wire',
          source: 'headline',
          title: item.title,
          body: item.desc || null,
          image: item.image || null,
          link: item.link,
          timestamp: item.timestamp || new Date().toISOString(),
          priority: query.priority || 0,
          meta: {
            sourceId,
            sourceLabel: source.label,
            sourceName: source.label || sourceId,
            sourceIcon: item.link ? (() => { try { return new URL(item.link).origin; } catch { return null; } })() : null,
            paywall: source.paywall || false,
            paywallProxy: source.paywall ? result.paywallProxy : null,
            ...(item.imageWidth && item.imageHeight
              ? { imageWidth: item.imageWidth, imageHeight: item.imageHeight }
              : {}),
          },
        });
      }
    }

    // Sort by timestamp descending for stable paging
    allItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const page = allItems.slice(offset, offset + totalLimit);
    const nextOffset = offset + totalLimit;
    const hasMore = nextOffset < allItems.length;

    return { items: page, cursor: hasMore ? String(nextOffset) : null };
  }

  async #fetchEntropy(query, username) {
    if (!this.#entropyService) return [];
    const report = await this.#entropyService.getReport(username);
    let items = report.items || [];
    if (query.params?.onlyYellowRed) {
      items = items.filter(item => item.status === 'yellow' || item.status === 'red');
    }
    return items.map(item => ({
      id: `entropy:${item.source}`,
      tier: query.tier || 'compass',
      source: 'entropy',
      title: item.name || item.source,
      body: item.label || `${item.value} since last update`,
      image: null,
      link: item.url || null,
      timestamp: item.lastUpdate || new Date().toISOString(),
      priority: query.priority || 20,
      meta: { status: item.status, icon: item.icon, value: item.value, weight: item.weight, sourceName: 'Data Freshness', sourceIcon: null },
    }));
  }

  // =========================================================================
  // Internal: Proactive Refill
  // =========================================================================

  #hasRefillableSources(username) {
    const cursorMap = this.#cursors.get(username);
    if (!cursorMap) return false;
    for (const state of cursorMap.values()) {
      if (!state.exhausted && state.cursor !== null) return true;
    }
    return false;
  }

  async #proactiveRefill(username, scrollConfig) {
    if (this.#refilling.get(username)) return; // already in-flight
    this.#refilling.set(username, true);

    try {
      const cursorMap = this.#cursors.get(username) || new Map();
      const queries = this.#filterQueries(scrollConfig);
      const pool = this.#pools.get(username) || [];
      const existingIds = new Set(pool.map(i => i.id));

      const refillable = queries.filter(q => {
        const key = q._filename?.replace('.yml', '') || q.type;
        const state = cursorMap.get(key);
        return state && !state.exhausted && state.cursor !== null;
      });

      const results = await Promise.allSettled(
        refillable.map(query => {
          const key = query._filename?.replace('.yml', '') || query.type;
          const cursorToken = cursorMap.get(key).cursor;
          return this.#fetchSourcePage(query, username, scrollConfig, cursorToken);
        })
      );

      let newItemCount = 0;
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') {
          const { items, cursor, sourceKey } = results[i].value;

          // Deduplicate against existing pool
          const fresh = items.filter(item => !existingIds.has(item.id));
          pool.push(...fresh);
          for (const item of fresh) existingIds.add(item.id);
          newItemCount += fresh.length;

          // Update cursor state
          cursorMap.set(sourceKey, {
            cursor,
            exhausted: cursor === null,
            lastFetch: Date.now(),
          });
        }
      }

      this.#pools.set(username, pool);
      this.#logger.info?.('feed.pool.refill.complete', { username, newItems: newItemCount });
    } catch (err) {
      this.#logger.warn?.('feed.pool.refill.error', { error: err.message });
    } finally {
      this.#refilling.delete(username);
    }
  }

  // =========================================================================
  // Internal: Silent Recycling
  // =========================================================================

  #recycle(username) {
    const history = this.#seenItems.get(username) || [];
    if (history.length === 0) return;

    // Fisher-Yates shuffle
    const shuffled = [...history];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Reset seen tracking, refill pool with shuffled history
    this.#pools.set(username, shuffled);
    this.#seenIds.set(username, new Set());
    // Keep seenItems intact (they accumulate across recycle cycles)

    this.#logger.info?.('feed.pool.recycled', { username, items: shuffled.length });
  }

  // =========================================================================
  // Internal: Helpers
  // =========================================================================

  #filterQueries(scrollConfig) {
    const enabledSources = ScrollConfigLoader.getEnabledSources(scrollConfig);
    if (enabledSources.size === 0) return this.#queryConfigs;
    return this.#queryConfigs.filter(query => {
      const key = query._filename?.replace('.yml', '');
      return key && enabledSources.has(key);
    });
  }

  #extractImage(html) {
    if (!html) return null;
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : null;
  }
}

export default FeedPoolManager;
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedPoolManager.mjs
git commit -m "feat(feed): create FeedPoolManager with pagination, age filtering, and recycling"
```

---

## Task 8: Refactor FeedAssemblyService to Use FeedPoolManager

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`

**Step 1: Replace source fetching with pool manager delegation**

Remove from `FeedAssemblyService`:
- `#freshRSSAdapter`, `#headlineService`, `#entropyService` fields
- `#queryConfigs`, `#sourceAdapters`, `#feedCacheService` fields
- `#seenIds` map (pool manager owns this now)
- `#fetchAllSources()`, `#fetchSource()`, `#fetchSourceDirect()`
- `#fetchFreshRSS()`, `#fetchHeadlines()`, `#fetchEntropy()`
- `#filterQueries()`
- `#extractImage()`
- `#getFaviconUrl()`

Add: `#feedPoolManager` field.

Constructor changes:
```js
constructor({
  feedPoolManager,           // NEW — replaces individual source deps
  scrollConfigLoader = null,
  tierAssemblyService = null,
  feedContentService = null,
  selectionTrackingStore = null,
  logger = console,
  // Legacy params accepted but unused (kept for bootstrap compat)
  dataService, configService, freshRSSAdapter, headlineService,
  entropyService, contentQueryService, contentRegistry, userDataService,
  queryConfigs, sourceAdapters, feedCacheService, spacingEnforcer,
}) {
  this.#feedPoolManager = feedPoolManager;
  this.#scrollConfigLoader = scrollConfigLoader;
  this.#tierAssemblyService = tierAssemblyService;
  this.#feedContentService = feedContentService || null;
  this.#selectionTrackingStore = selectionTrackingStore;
  this.#logger = logger;

  // Keep sourceAdapters ref for getDetail() — detail fetching is unrelated to pool
  this.#sourceAdapters = new Map();
  if (sourceAdapters) {
    for (const adapter of sourceAdapters) {
      this.#sourceAdapters.set(adapter.sourceType, adapter);
    }
  }
}
```

Rewrite `getNextBatch()`:
```js
async getNextBatch(username, { limit, cursor, focus, sources, nocache } = {}) {
  const scrollConfig = this.#scrollConfigLoader?.load(username)
    || { batch_size: 15, spacing: { max_consecutive: 1 }, tiers: {} };

  const effectiveLimit = limit ?? scrollConfig.batch_size ?? 15;

  // Fresh load: reset pool manager
  if (!cursor) {
    this.#feedPoolManager.reset(username);
  }

  // Get available items from pool
  const freshPool = await this.#feedPoolManager.getPool(username, scrollConfig);

  // Source filter: bypass tier assembly
  if (sources && sources.length > 0) {
    const filtered = freshPool
      .filter(item => sources.includes(item.source))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const batch = filtered.slice(0, effectiveLimit);
    for (const item of batch) this.#cacheItem(item);
    this.#feedPoolManager.markSeen(username, batch.map(i => i.id));
    return {
      items: batch,
      hasMore: this.#feedPoolManager.hasMore(username),
      colors: ScrollConfigLoader.extractColors(scrollConfig),
    };
  }

  // Load selection tracking for sort bias
  const selectionCounts = this.#selectionTrackingStore
    ? await this.#selectionTrackingStore.getAll(username)
    : null;

  // Primary pass: tier assembly
  const { items: primary } = this.#tierAssemblyService.assemble(
    freshPool, scrollConfig, { effectiveLimit, focus, selectionCounts }
  );

  let batch = primary.slice(0, effectiveLimit);

  // Padding pass
  if (batch.length < effectiveLimit) {
    const paddingSources = ScrollConfigLoader.getPaddingSources(scrollConfig);
    if (paddingSources.size > 0) {
      const batchIds = new Set(batch.map(i => i.id));
      const padding = freshPool.filter(i => paddingSources.has(i.source) && !batchIds.has(i.id));
      for (let i = padding.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [padding[i], padding[j]] = [padding[j], padding[i]];
      }
      batch = [...batch, ...padding.slice(0, effectiveLimit - batch.length)];
    }
  }

  // Mark seen + cache
  const batchIds = batch.map(i => i.id);
  this.#feedPoolManager.markSeen(username, batchIds);
  for (const item of batch) this.#cacheItem(item);

  // Selection tracking
  if (this.#selectionTrackingStore) {
    const trackableIds = batch
      .filter(i => i.id?.startsWith('headline:'))
      .map(i => i.id.replace(/^headline:/, ''));
    if (trackableIds.length) {
      await this.#selectionTrackingStore.incrementBatch(trackableIds, username);
    }
  }

  return {
    items: batch,
    hasMore: this.#feedPoolManager.hasMore(username),
    colors: ScrollConfigLoader.extractColors(scrollConfig),
  };
}
```

Keep `getDetail()`, `getItemWithDetail()`, `#cacheItem()`, `#getArticleDetail()` unchanged — they don't touch source fetching.

**Step 2: Verify**

Run: `npx playwright test tests/live/flow/feed/ --reporter=line`
Expected: PASS.

**Step 3: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs
git commit -m "refactor(feed): delegate source fetching to FeedPoolManager"
```

---

## Task 9: Update Bootstrap Wiring in app.mjs

**Files:**
- Modify: `backend/src/app.mjs` (lines ~649-802)

**Step 1: Construct FeedPoolManager and inject into FeedAssemblyService**

After the existing adapter construction (line ~749), add:

```js
const { FeedPoolManager } = await import('./3_applications/feed/services/FeedPoolManager.mjs');

const feedPoolManager = new FeedPoolManager({
  sourceAdapters: [redditAdapter, weatherAdapter, healthAdapter, gratitudeAdapter, stravaAdapter, todoistAdapter, immichAdapter, plexAdapter, journalAdapter, youtubeAdapter, googleNewsAdapter, komgaFeedAdapter, readalongFeedAdapter].filter(Boolean),
  feedCacheService,
  queryConfigs,
  freshRSSAdapter: feedServices.freshRSSAdapter,
  headlineService: feedServices.headlineService,
  entropyService: entropyServices?.entropyService || null,
  logger: rootLogger.child({ module: 'feed-pool' }),
});
```

Update `FeedAssemblyService` construction to pass `feedPoolManager` and keep `sourceAdapters` for detail resolution:

```js
const feedAssemblyService = new FeedAssemblyService({
  feedPoolManager,
  sourceAdapters: [redditAdapter, weatherAdapter, healthAdapter, gratitudeAdapter, stravaAdapter, todoistAdapter, immichAdapter, plexAdapter, journalAdapter, youtubeAdapter, googleNewsAdapter, komgaFeedAdapter, readalongFeedAdapter].filter(Boolean),
  scrollConfigLoader,
  tierAssemblyService,
  feedContentService,
  selectionTrackingStore,
  logger: rootLogger.child({ module: 'feed-assembly' }),
});
```

Remove the now-unused direct injections (`freshRSSAdapter`, `headlineService`, `entropyService`, `queryConfigs`, `feedCacheService`) from the `FeedAssemblyService` constructor call.

**Step 2: Verify full server starts and feed works**

```bash
# Start dev server and check feed endpoint
curl -s http://localhost:3112/api/v1/feed/scroll | jq '.items | length'
```

**Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(feed): wire FeedPoolManager into bootstrap"
```

---

## Task 10: Add `max_age_hours` to Scroll Config YAML

**Files:**
- Modify: User's feed config at `data/users/kckern/config/feed.yml`

**Step 1: Add `max_age_hours` to source configs**

Under `scroll.tiers`, add age limits to appropriate sources:

```yaml
scroll:
  tiers:
    wire:
      sources:
        reddit:
          max_age_hours: 168    # 1 week
        freshrss:
          max_age_hours: 336    # 2 weeks
        headlines:
          max_age_hours: 48
        googlenews:
          max_age_hours: 48
    library:
      sources:
        komga:
          max_age_hours: null   # timeless
    scrapbook:
      sources:
        photos:
          max_age_hours: null   # timeless
```

These are merged with existing source configs by `ScrollConfigLoader.#mergeTiers`.

**Step 2: Commit**

```bash
git add data/users/kckern/config/feed.yml
git commit -m "config(feed): add max_age_hours to scroll source configs"
```

---

## Task 11: Update E2E Test — Verify Deeper Pagination

**Files:**
- Modify: `tests/live/flow/feed/feed-scroll-infinite.runtime.test.mjs`

**Step 1: Add a test that scrolls through multiple batches**

```js
test('scrolling through 3+ batches loads progressively deeper content', async ({ page }) => {
  await page.goto('/feed/scroll', { waitUntil: 'networkidle', timeout: 30000 });
  await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

  const initialCount = await page.locator('.scroll-item-wrapper').count();
  console.log(`Initial card count: ${initialCount}`);

  let previousCount = initialCount;

  // Scroll through at least 3 batch boundaries
  for (let batch = 1; batch <= 3; batch++) {
    const sentinel = page.locator('.scroll-sentinel');
    if (await sentinel.count() === 0) {
      console.log(`Batch ${batch}: no sentinel — feed ended early`);
      break;
    }

    await sentinel.scrollIntoViewIfNeeded();

    await expect(async () => {
      const current = await page.locator('.scroll-item-wrapper').count();
      expect(current, `Batch ${batch} should add more cards`).toBeGreaterThan(previousCount);
    }).toPass({ timeout: 20000 });

    const newCount = await page.locator('.scroll-item-wrapper').count();
    console.log(`Batch ${batch}: ${newCount} cards (added ${newCount - previousCount})`);
    previousCount = newCount;
  }

  // After 3 batches we should have significantly more than initial
  const finalCount = await page.locator('.scroll-item-wrapper').count();
  expect(finalCount, 'Deep scroll should accumulate cards').toBeGreaterThan(initialCount * 1.5);
  console.log(`Final count: ${finalCount} (started at ${initialCount})`);
});
```

**Step 2: Run the test**

Run: `npx playwright test tests/live/flow/feed/feed-scroll-infinite.runtime.test.mjs --reporter=line`
Expected: PASS — 3 batches load progressively.

**Step 3: Commit**

```bash
git add tests/live/flow/feed/feed-scroll-infinite.runtime.test.mjs
git commit -m "test(feed): add multi-batch deep scroll E2E test"
```

---

## Task Summary

| Task | Description | Dependencies |
|------|------------|-------------|
| 1 | Update IFeedSourceAdapter port (add `fetchPage`) | None |
| 2 | Add `max_age_hours` to ScrollConfigLoader | None |
| 3 | Wire pagination into FreshRSS (return continuation) | Task 1 |
| 4 | Wire pagination into RedditFeedAdapter | Task 1 |
| 5 | Wire pagination into GoogleNewsFeedAdapter | Task 1 |
| 6 | Wire pagination into remaining adapters (Komga, Immich, Plex) | Task 1 |
| 7 | Create FeedPoolManager | Tasks 1, 2, 3 |
| 8 | Refactor FeedAssemblyService to use pool manager | Task 7 |
| 9 | Update bootstrap wiring in app.mjs | Tasks 7, 8 |
| 10 | Add `max_age_hours` to scroll config YAML | Task 2 |
| 11 | E2E test: multi-batch deep scroll | Tasks 8, 9 |
