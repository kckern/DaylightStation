# Feed Assembly Decomposition Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Decompose the monolithic FeedAssemblyService into DDD-compliant adapters behind a port interface, fix quick wins from the audit, and build the frontend card redesign.

**Architecture:** Extract each `#fetch*` private method into a separate adapter in `1_adapters/feed/sources/`, all implementing a shared `IFeedSourceAdapter` port interface. FeedAssemblyService shrinks to a pure orchestrator that loads configs, fans out to adapters, and interleaves results. Frontend gets three unified card layouts replacing 11 separate cards.

**Tech Stack:** Node.js ES modules, Express, React, SCSS, YAML configs

**Reference:** `docs/_wip/audits/2026-02-16-feed-assembly-service-audit.md`

---

## Phase 1: Quick Fixes (from audit R4-R6, O4)

### Task 1: Remove API URL construction from application layer

Fixes audit item R4. The application layer currently builds `/api/v1/feed/icon?url=...` strings — coupling 3_applications to 4_api route paths.

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`

**Step 1: Fix `#getFaviconUrl` to return raw domain URLs**

Replace the current implementation (lines 695-701):

```javascript
// BEFORE (builds API route — DDD violation)
#getFaviconUrl(link) {
  if (!link) return null;
  try {
    const domain = new URL(link).origin;
    return `/api/v1/feed/icon?url=${encodeURIComponent(domain)}`;
  } catch { return null; }
}
```

With:

```javascript
// AFTER (returns raw domain — presentation-agnostic)
#getFaviconUrl(link) {
  if (!link) return null;
  try {
    return new URL(link).origin;
  } catch { return null; }
}
```

**Step 2: Fix Reddit sourceIcon to return raw URL**

Replace line 553:

```javascript
// BEFORE
sourceIcon: `/api/v1/feed/icon?url=${encodeURIComponent(`https://www.reddit.com/r/${subreddit}`)}`,
```

With:

```javascript
// AFTER
sourceIcon: `https://www.reddit.com/r/${subreddit}`,
```

**Step 3: Update the frontend to proxy sourceIcon through the icon endpoint**

In every card component that uses `item.meta.sourceIcon`, wrap the URL:

File: `frontend/src/modules/Feed/Scroll/cards/utils.js`

Add helper:

```javascript
export function proxyIcon(rawUrl) {
  if (!rawUrl) return null;
  if (rawUrl.startsWith('/api/')) return rawUrl; // already proxied
  return `/api/v1/feed/icon?url=${encodeURIComponent(rawUrl)}`;
}
```

**Step 4: Verify via curl**

Run: `curl -s 'http://localhost:3112/api/v1/feed/scroll?limit=5' | python3 -c "import json,sys; d=json.load(sys.stdin); [print(i['meta'].get('sourceIcon','null')) for i in d['items'][:5]]"`

Expected: Raw URLs like `https://www.aljazeera.com` and `https://www.reddit.com/r/science` — NOT `/api/v1/feed/icon?url=...`

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs frontend/src/modules/Feed/Scroll/cards/utils.js
git commit -m "fix: remove API URL construction from FeedAssemblyService (R4)"
```

---

### Task 2: Replace readdirSync with async config loading

Fixes audit item R5. `import { readdirSync } from 'fs'` in the application layer violates DDD and blocks the event loop.

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Modify: `backend/src/app.mjs`

**Step 1: Add queryConfigs as constructor parameter**

In FeedAssemblyService constructor, add `queryConfigs` to the parameter list:

```javascript
constructor({
  dataService,
  configService,
  freshRSSAdapter,
  headlineService,
  entropyService = null,
  contentQueryService = null,
  contentRegistry = null,
  userDataService = null,
  queryConfigs = null,  // NEW: pre-loaded query configs
  logger = console,
}) {
  // ... existing assignments ...
  this.#queryConfigs = queryConfigs;
}
```

Add private field: `#queryConfigs;`

**Step 2: Update `#loadQueries` to prefer injected configs**

```javascript
#loadQueries() {
  if (this.#queryConfigs) return this.#queryConfigs;

  // Fallback: load from filesystem (legacy path)
  const queriesPath = this.#configService.getHouseholdPath(QUERY_CONFIG_DIR);
  if (!queriesPath) {
    this.#logger.warn?.('feed.assembly.no.queries.path');
    return [];
  }

  try {
    const { readdirSync } = await import('fs');
    const files = readdirSync(queriesPath).filter(f => f.endsWith('.yml'));
    return files.map(file => {
      const key = file.replace('.yml', '');
      const data = this.#dataService.household.read(`${QUERY_CONFIG_DIR}/${key}`);
      return data ? { ...data, _filename: file } : null;
    }).filter(Boolean);
  } catch (err) {
    this.#logger.error?.('feed.assembly.queries.load.error', { error: err.message });
    return [];
  }
}
```

**Step 3: Remove top-level `import { readdirSync } from 'fs'`**

Delete line 13 entirely.

Note: Since `#loadQueries` is not async and the fallback uses dynamic `import('fs')`, convert `#loadQueries` to be sync-only when `queryConfigs` are injected (the primary path). The fallback can use `readdirSync` inline. Actually simpler: just keep the fs import as a fallback inline:

```javascript
#loadQueries() {
  if (this.#queryConfigs) return this.#queryConfigs;

  const queriesPath = this.#configService.getHouseholdPath(QUERY_CONFIG_DIR);
  if (!queriesPath) {
    this.#logger.warn?.('feed.assembly.no.queries.path');
    return [];
  }

  try {
    // Fallback: synchronous load (will be removed once all callers inject configs)
    const fs = require('fs');
    const files = fs.readdirSync(queriesPath).filter(f => f.endsWith('.yml'));
    return files.map(file => {
      const key = file.replace('.yml', '');
      const data = this.#dataService.household.read(`${QUERY_CONFIG_DIR}/${key}`);
      return data ? { ...data, _filename: file } : null;
    }).filter(Boolean);
  } catch (err) {
    this.#logger.error?.('feed.assembly.queries.load.error', { error: err.message });
    return [];
  }
}
```

Wait — ES modules don't have `require`. Keep the `import { readdirSync } from 'fs'` but only use it as fallback. Better approach: load configs in bootstrap and always inject them.

**Step 3 (revised): Load configs in bootstrap and inject**

In `backend/src/app.mjs`, before creating FeedAssemblyService:

```javascript
// Load query configs at bootstrap time
const queriesPath = configService.getHouseholdPath('config/lists/queries');
let queryConfigs = [];
if (queriesPath) {
  const { readdirSync } = await import('fs');
  const files = readdirSync(queriesPath).filter(f => f.endsWith('.yml'));
  queryConfigs = files.map(file => {
    const key = file.replace('.yml', '');
    const data = dataService.household.read(`config/lists/queries/${key}`);
    return data ? { ...data, _filename: file } : null;
  }).filter(Boolean);
}
```

Then pass `queryConfigs` to FeedAssemblyService constructor.

**Step 4: Remove `import { readdirSync } from 'fs'` from FeedAssemblyService**

Delete line 13 and the `QUERY_CONFIG_DIR` constant (line 15). Simplify `#loadQueries`:

```javascript
#loadQueries() {
  return this.#queryConfigs || [];
}
```

**Step 5: Verify via curl**

Run: `curl -s 'http://localhost:3112/api/v1/feed/scroll?limit=3' | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['items']), 'items')"`

Expected: `3 items`

**Step 6: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs backend/src/app.mjs
git commit -m "fix: inject query configs at bootstrap, remove fs import from app layer (R5)"
```

---

### Task 3: Cap headlines per source and fix total limit

Fixes audit item R6. Currently `query.limit` (30) applies per headline source, not total — yielding 90+ headlines when 3 sources are active.

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`

**Step 1: Add total cap to `#fetchHeadlines`**

Replace the current `#fetchHeadlines` method. Key change: track total items across sources and stop when limit reached.

```javascript
async #fetchHeadlines(query, username) {
  if (!this.#headlineService) return [];
  const result = await this.#headlineService.getAllHeadlines(username);
  const items = [];
  const totalLimit = query.limit || 30;
  const perSourceLimit = Math.ceil(totalLimit / Math.max(1, Object.keys(result.sources || {}).length));

  for (const [sourceId, source] of Object.entries(result.sources || {})) {
    if (items.length >= totalLimit) break;
    const remaining = totalLimit - items.length;
    const sourceLimit = Math.min(perSourceLimit, remaining);

    for (const item of (source.items || []).slice(0, sourceLimit)) {
      items.push(this.#normalizeToFeedItem({
        id: `headline:${sourceId}:${item.link}`,
        type: query.feed_type || 'external',
        source: 'headline',
        title: item.title,
        body: item.desc || null,
        image: null,
        link: item.link,
        timestamp: item.timestamp || new Date().toISOString(),
        priority: query.priority || 0,
        meta: {
          sourceId,
          sourceLabel: source.label,
          sourceName: source.label || sourceId,
          sourceIcon: this.#getFaviconUrl(item.link),
        },
      }));
    }
  }
  return items;
}
```

**Step 2: Verify via curl**

Run: `curl -s 'http://localhost:3112/api/v1/feed/scroll?limit=50' | python3 -c "import json,sys; d=json.load(sys.stdin); print('headlines:', sum(1 for i in d['items'] if i['source']=='headline'))"`

Expected: `headlines: 30` (not 40+ as before)

**Step 3: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs
git commit -m "fix: cap headlines total across all sources (R6)"
```

---

### Task 4: Fix missing Plex sourceName/sourceIcon in children mode

Fixes audit item O4.

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`

**Step 1: Add sourceName and sourceIcon to Plex children-mode meta**

In `#fetchPlex`, the children-mode branch (lines 428-445) — add to the `meta` object:

```javascript
meta: {
  type: item.type || item.metadata?.type,
  year: item.year || item.metadata?.year,
  sourceName: 'Plex',
  sourceIcon: null,
},
```

**Step 2: Verify the Plex children-mode path returns sourceName**

Run: `curl -s 'http://localhost:3112/api/v1/feed/scroll?limit=50' | python3 -c "import json,sys; d=json.load(sys.stdin); plex=[i for i in d['items'] if i['source']=='plex']; print([(p['title'], p['meta'].get('sourceName')) for p in plex])"`

Expected: Each Plex item shows `('Album Title', 'Plex')`

**Step 3: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs
git commit -m "fix: add missing sourceName/sourceIcon to Plex children mode (O4)"
```

---

## Phase 2: Port Interface & Adapter Extraction

### Task 5: Create IFeedSourceAdapter port interface

**Files:**
- Create: `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs`

**Step 1: Write the port interface**

```javascript
// backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs
/**
 * IFeedSourceAdapter — port interface for feed content sources.
 *
 * Each adapter fetches items from one external system (Reddit, Plex, weather, etc.)
 * and returns normalized FeedItem-shaped objects.
 *
 * @module applications/feed/ports/IFeedSourceAdapter
 */
export class IFeedSourceAdapter {
  /**
   * @returns {string} Source type identifier (matches query YAML `type` field)
   */
  get sourceType() {
    throw new Error('IFeedSourceAdapter.sourceType must be implemented');
  }

  /**
   * Fetch items for this source.
   *
   * @param {Object} query - Query config object from YAML
   * @param {string} username - Current user
   * @returns {Promise<Object[]>} Array of normalized FeedItem-shaped objects
   */
  async fetchItems(query, username) {
    throw new Error('IFeedSourceAdapter.fetchItems must be implemented');
  }
}

/**
 * Duck-type check for IFeedSourceAdapter compliance.
 * @param {Object} obj
 * @returns {boolean}
 */
export function isFeedSourceAdapter(obj) {
  return obj &&
    typeof obj.sourceType === 'string' &&
    typeof obj.fetchItems === 'function';
}
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs
git commit -m "feat: add IFeedSourceAdapter port interface"
```

---

### Task 6: Extract RedditFeedAdapter

The Reddit handler is the clearest DDD violation — it makes raw `fetch()` calls to reddit.com from the application layer. Extract it into `1_adapters/feed/sources/`.

**Files:**
- Create: `backend/src/1_adapters/feed/sources/RedditFeedAdapter.mjs`
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`

**Step 1: Create RedditFeedAdapter**

```javascript
// backend/src/1_adapters/feed/sources/RedditFeedAdapter.mjs
/**
 * RedditFeedAdapter
 *
 * Fetches Reddit posts via JSON API and normalizes to FeedItem shape.
 * Reads user-specific subreddit lists from DataService.
 *
 * @module adapters/feed/sources/RedditFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

const USER_AGENT = 'Mozilla/5.0 (compatible; DaylightStation/1.0)';

export class RedditFeedAdapter extends IFeedSourceAdapter {
  #dataService;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.dataService - DataService for reading user config
   * @param {Object} [deps.logger]
   */
  constructor({ dataService, logger = console }) {
    super();
    if (!dataService) throw new Error('RedditFeedAdapter requires dataService');
    this.#dataService = dataService;
    this.#logger = logger;
  }

  get sourceType() { return 'reddit'; }

  /**
   * @param {Object} query - Query config from YAML
   * @param {string} username
   * @returns {Promise<Object[]>} Normalized FeedItem-shaped objects
   */
  async fetchItems(query, username) {
    let subreddits = query.params?.subreddits;

    // Prefer user-specific config
    try {
      const userConfig = this.#dataService.user.read('config/reddit', username);
      if (userConfig?.subreddits?.length) {
        subreddits = userConfig.subreddits;
      }
    } catch { /* user config not found */ }

    if (!subreddits || !Array.isArray(subreddits) || subreddits.length === 0) return [];

    try {
      const maxSubs = query.params?.maxSubs || 5;
      const sampled = [...subreddits].sort(() => Math.random() - 0.5).slice(0, maxSubs);
      const perSub = Math.ceil((query.limit || 10) / sampled.length);

      const results = await Promise.allSettled(
        sampled.map(sub => this.#fetchSubreddit(sub, perSub, query))
      );

      const items = [];
      for (const result of results) {
        if (result.status === 'fulfilled') items.push(...result.value);
      }

      items.sort(() => Math.random() - 0.5);
      return items.slice(0, query.limit || 10);
    } catch (err) {
      this.#logger.warn?.('reddit.adapter.error', { error: err.message });
      return [];
    }
  }

  async #fetchSubreddit(subreddit, limit, query) {
    const url = `https://www.reddit.com/r/${subreddit}.json?limit=${limit}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    });
    if (!res.ok) return [];

    const data = await res.json();
    const posts = data?.data?.children || [];

    return posts
      .filter(p => p.kind === 't3' && !p.data.stickied)
      .map(p => {
        const post = p.data;
        const thumb = post.thumbnail && !['self', 'default', 'nsfw', 'spoiler', ''].includes(post.thumbnail)
          ? post.thumbnail : null;
        return {
          id: `reddit:${post.id}`,
          type: query.feed_type || 'external',
          source: 'reddit',
          title: post.title,
          body: post.selftext?.slice(0, 200) || null,
          image: thumb,
          link: `https://www.reddit.com${post.permalink}`,
          timestamp: new Date(post.created_utc * 1000).toISOString(),
          priority: query.priority || 0,
          meta: {
            subreddit,
            score: post.score,
            numComments: post.num_comments,
            postId: post.id,
            sourceName: `r/${subreddit}`,
            sourceIcon: `https://www.reddit.com/r/${subreddit}`,
          },
        };
      });
  }
}
```

**Step 2: Update FeedAssemblyService to use adapter registry**

Add `#sourceAdapters` private field and constructor param:

```javascript
// In constructor:
this.#sourceAdapters = new Map();
if (sourceAdapters) {
  for (const adapter of sourceAdapters) {
    this.#sourceAdapters.set(adapter.sourceType, adapter);
  }
}
```

Update `#fetchSource` dispatch:

```javascript
async #fetchSource(query, username) {
  // Check adapter registry first
  const adapter = this.#sourceAdapters.get(query.type);
  if (adapter) {
    const items = await adapter.fetchItems(query, username);
    return items.map(item => this.#normalizeToFeedItem(item));
  }

  // Fallback to built-in handlers (to be migrated)
  switch (query.type) {
    case 'freshrss': return this.#fetchFreshRSS(query, username);
    case 'headlines': return this.#fetchHeadlines(query, username);
    // ... remaining handlers unchanged
    default:
      this.#logger.warn?.('feed.assembly.unknown.type', { type: query.type });
      return [];
  }
}
```

Remove `case 'reddit'` from the switch and delete `#fetchReddit` and `#fetchSubredditJSON` methods entirely.

**Step 3: Wire in bootstrap (app.mjs)**

```javascript
const { RedditFeedAdapter } = await import('./1_adapters/feed/sources/RedditFeedAdapter.mjs');
const redditAdapter = new RedditFeedAdapter({
  dataService,
  logger: rootLogger.child({ module: 'reddit-feed' }),
});

const feedAssemblyService = new FeedAssemblyService({
  // ... existing params ...
  sourceAdapters: [redditAdapter],
});
```

**Step 4: Verify reddit items still appear**

Run: `curl -s 'http://localhost:3112/api/v1/feed/scroll?limit=50' | python3 -c "import json,sys; d=json.load(sys.stdin); reddit=[i for i in d['items'] if i['source']=='reddit']; print(f'reddit: {len(reddit)} items'); [print(f'  r/{r[\"meta\"][\"subreddit\"]}: {r[\"title\"][:60]}') for r in reddit[:3]]"`

Expected: `reddit: N items` with subreddit names and titles

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/sources/RedditFeedAdapter.mjs backend/src/3_applications/feed/services/FeedAssemblyService.mjs backend/src/app.mjs
git commit -m "feat: extract RedditFeedAdapter from FeedAssemblyService"
```

---

### Task 7: Extract WeatherFeedAdapter and HealthFeedAdapter

Two grounding sources that read from DataService. Extract both — they follow the same pattern.

**Files:**
- Create: `backend/src/1_adapters/feed/sources/WeatherFeedAdapter.mjs`
- Create: `backend/src/1_adapters/feed/sources/HealthFeedAdapter.mjs`
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Modify: `backend/src/app.mjs`

**Step 1: Create WeatherFeedAdapter**

```javascript
// backend/src/1_adapters/feed/sources/WeatherFeedAdapter.mjs
import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

const WMO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle',
  55: 'Dense drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Severe thunderstorm',
};

export class WeatherFeedAdapter extends IFeedSourceAdapter {
  #dataService;
  #logger;

  constructor({ dataService, logger = console }) {
    super();
    if (!dataService) throw new Error('WeatherFeedAdapter requires dataService');
    this.#dataService = dataService;
    this.#logger = logger;
  }

  get sourceType() { return 'weather'; }

  async fetchItems(query, _username) {
    try {
      const data = this.#dataService.household.read('common/weather');
      if (!data?.current) return [];

      const current = data.current;
      const tempF = Math.round(current.temp * 9 / 5 + 32);
      const feelsF = Math.round(current.feel * 9 / 5 + 32);
      const condition = WMO_CODES[current.code] || 'Weather';

      return [{
        id: `weather:${new Date().toISOString().split('T')[0]}`,
        type: query.feed_type || 'grounding',
        source: 'weather',
        title: condition,
        body: `${tempF}\u00b0F (feels ${feelsF}\u00b0F)`,
        image: null,
        link: null,
        timestamp: data.now || new Date().toISOString(),
        priority: query.priority || 3,
        meta: {
          tempF, feelsF, tempC: Math.round(current.temp),
          cloud: current.cloud, precip: current.precip,
          aqi: Math.round(current.aqi || 0), code: current.code,
          sourceName: 'Weather', sourceIcon: null,
        },
      }];
    } catch (err) {
      this.#logger.warn?.('weather.adapter.error', { error: err.message });
      return [];
    }
  }
}
```

**Step 2: Create HealthFeedAdapter**

```javascript
// backend/src/1_adapters/feed/sources/HealthFeedAdapter.mjs
import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class HealthFeedAdapter extends IFeedSourceAdapter {
  #userDataService;
  #logger;

  constructor({ userDataService, logger = console }) {
    super();
    if (!userDataService) throw new Error('HealthFeedAdapter requires userDataService');
    this.#userDataService = userDataService;
    this.#logger = logger;
  }

  get sourceType() { return 'health'; }

  async fetchItems(query, username) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const data = this.#userDataService.getLifelogData(username, 'health');
      if (!data) return [];

      const dayData = data[today] || Object.values(data).pop();
      if (!dayData) return [];

      return [{
        id: `health:${today}`,
        type: query.feed_type || 'grounding',
        source: 'health',
        title: 'Daily Health',
        body: this.#formatSummary(dayData),
        image: null,
        link: null,
        timestamp: new Date().toISOString(),
        priority: query.priority || 15,
        meta: { ...dayData, sourceName: 'Health', sourceIcon: null },
      }];
    } catch (err) {
      this.#logger.warn?.('health.adapter.error', { error: err.message });
      return [];
    }
  }

  #formatSummary(data) {
    const parts = [];
    if (data.weight?.lbs) parts.push(`${data.weight.lbs} lbs`);
    if (data.weight?.trend != null) {
      const sign = data.weight.trend > 0 ? '+' : '';
      parts.push(`${sign}${data.weight.trend} trend`);
    }
    if (data.steps) parts.push(`${data.steps} steps`);
    if (data.nutrition?.calories) parts.push(`${data.nutrition.calories} cal`);
    if (data.nutrition?.protein) parts.push(`${data.nutrition.protein}g protein`);
    return parts.join(' \u00b7 ') || 'No data';
  }
}
```

**Step 3: Wire in bootstrap, remove from FeedAssemblyService**

In `app.mjs`, import and instantiate both adapters, add to `sourceAdapters` array.

In FeedAssemblyService, remove `case 'weather'` and `case 'health'` from the switch, and delete `#fetchWeather`, `#fetchHealth`, `#formatHealthSummary`, and `#weatherCodeToLabel` methods.

**Step 4: Verify**

Run: `curl -s 'http://localhost:3112/api/v1/feed/scroll?limit=50' | python3 -c "import json,sys; d=json.load(sys.stdin); sources=set(i['source'] for i in d['items']); print('sources:', sorted(sources))"`

Expected: Same sources as before (weather may still be 0 if data is empty, but no errors)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/sources/WeatherFeedAdapter.mjs backend/src/1_adapters/feed/sources/HealthFeedAdapter.mjs backend/src/3_applications/feed/services/FeedAssemblyService.mjs backend/src/app.mjs
git commit -m "feat: extract WeatherFeedAdapter and HealthFeedAdapter"
```

---

### Task 8: Extract remaining grounding adapters (Gratitude, Fitness, Todoist)

**Files:**
- Create: `backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs`
- Create: `backend/src/1_adapters/feed/sources/StravaFeedAdapter.mjs`
- Create: `backend/src/1_adapters/feed/sources/TodoistFeedAdapter.mjs`
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Modify: `backend/src/app.mjs`

**Step 1: Create all three adapters**

Each follows the same pattern as Task 7. The adapter reads data (via DataService or UserDataService), applies source-specific normalization, and returns FeedItem-shaped objects.

Key moves:
- `#fetchGratitude` → `GratitudeFeedAdapter` (uses `dataService.household.read`)
- `#normalizeStravaItems` + `#formatFitnessSummary` → `StravaFeedAdapter` (uses `userDataService.getLifelogData`)
- `#normalizeTodoistItems` → `TodoistFeedAdapter` (uses `userDataService.getLifelogData`)

The `#fetchLifelog` dispatch method in FeedAssemblyService that switches on `source === 'strava'` / `source === 'tasks'` gets replaced by direct adapter registration.

Note: The query YAML for fitness has `type: lifelog` with `params.source: strava`. The adapter's `sourceType` should match the dispatch key. Two options:
1. Register adapter as `sourceType: 'lifelog'` and have it internally check `query.params.source`
2. Change query YAML to `type: strava` / `type: tasks` and register separate adapters

Option 2 is cleaner — each adapter handles one source. Update `fitness.yml` to `type: strava` and `tasks.yml` to `type: tasks`.

**Step 2: Update query YAML configs**

- `fitness.yml`: Change `type: lifelog` to `type: strava`
- `tasks.yml`: Change `type: lifelog` to `type: tasks` (already has `type: lifelog, params.source: tasks`)

**Step 3: Wire in bootstrap, remove `#fetchLifelog`, `#normalizeStravaItems`, `#normalizeTodoistItems`, `#formatFitnessSummary`, `#fetchGratitude` from FeedAssemblyService**

**Step 4: Verify**

Run same curl check as Task 7 Step 4.

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs backend/src/1_adapters/feed/sources/StravaFeedAdapter.mjs backend/src/1_adapters/feed/sources/TodoistFeedAdapter.mjs backend/src/3_applications/feed/services/FeedAssemblyService.mjs backend/src/app.mjs
git commit -m "feat: extract Gratitude, Strava, Todoist feed adapters"
```

---

### Task 9: Extract ImmichFeedAdapter and PlexFeedAdapter

**Files:**
- Create: `backend/src/1_adapters/feed/sources/ImmichFeedAdapter.mjs`
- Create: `backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs`
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Modify: `backend/src/app.mjs`

**Step 1: Create ImmichFeedAdapter**

Uses `contentQueryService.search()` — receives it as constructor dependency.

**Step 2: Create PlexFeedAdapter**

Uses both `contentRegistry.get('plex')` for children mode and `contentQueryService.search()` for search mode.

**Step 3: Wire in bootstrap, remove `#fetchImmich`, `#fetchPlex` from FeedAssemblyService**

**Step 4: Verify all sources**

Full source audit:

```bash
curl -s 'http://localhost:3112/api/v1/feed/scroll?limit=50' | python3 -c "
import json,sys
from collections import Counter
d=json.load(sys.stdin)
c=Counter(i['source'] for i in d['items'])
for s,n in c.most_common(): print(f'  {s}: {n}')
"
```

**Step 5: Commit**

```bash
git add backend/src/1_adapters/feed/sources/ImmichFeedAdapter.mjs backend/src/1_adapters/feed/sources/PlexFeedAdapter.mjs backend/src/3_applications/feed/services/FeedAssemblyService.mjs backend/src/app.mjs
git commit -m "feat: extract Immich and Plex feed adapters"
```

---

### Task 10: Clean up FeedAssemblyService — pure orchestrator

After Tasks 6-9, FeedAssemblyService should only contain: constructor, `getNextBatch`, `#loadQueries`, `#fetchSource` (adapter dispatch + remaining built-in handlers for `freshrss`, `headlines`, `entropy`), `#normalizeToFeedItem`, `#calculateGroundingRatio`, `#interleave`, and `#getFaviconUrl`.

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`

**Step 1: Remove all deleted handler methods and helpers**

Verify no dead code remains:
- `#fetchReddit`, `#fetchSubredditJSON` — deleted in Task 6
- `#fetchWeather`, `#weatherCodeToLabel` — deleted in Task 7
- `#fetchHealth`, `#formatHealthSummary` — deleted in Task 7
- `#fetchGratitude` — deleted in Task 8
- `#fetchLifelog`, `#normalizeStravaItems`, `#normalizeTodoistItems`, `#formatFitnessSummary` — deleted in Task 8
- `#fetchImmich`, `#fetchPlex` — deleted in Task 9

**Step 2: Audit remaining imports**

Should only import from `0_system/` or standard lib. No `fs`, no `fetch`, no external APIs.

**Step 3: Verify line count**

Target: ~200-250 lines (down from 815).

**Step 4: Full regression test**

```bash
curl -s 'http://localhost:3112/api/v1/feed/scroll?limit=50' | python3 -c "
import json,sys
from collections import Counter
d=json.load(sys.stdin)
items=d['items']
sources=Counter(i['source'] for i in items)
types=Counter(i['type'] for i in items)
print(f'Total: {len(items)}')
print('Sources:', dict(sources.most_common()))
print('Types:', dict(types.most_common()))
icons=sum(1 for i in items if i['meta'].get('sourceIcon'))
print(f'Icons: {icons}/{len(items)}')
"
```

**Step 5: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs
git commit -m "refactor: FeedAssemblyService is now a pure orchestrator"
```

---

## Phase 3: Frontend Card Redesign

### Task 11: Build ExternalCard component

Unified card for headline, freshrss, reddit — replacing HeadlineCard and ArticleCard.

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/cards/ExternalCard.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/cards/index.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/cards/utils.js`

**Step 1: Add `proxyIcon` and `formatAge` to utils.js (if not already there)**

**Step 2: Build ExternalCard**

Layout:
- Header row: 16px circle icon (via `proxyIcon(meta.sourceIcon)`) + sourceName + age pill
- Hero image (if `item.image`, full-width, 180px max-height, object-fit cover)
- Title: 2-line clamp, bold
- Body: 2-line clamp, muted
- Reddit extras: score badge + comment count (if `source === 'reddit'`)
- Tap → open link

**Step 3: Update card registry**

```javascript
const CARD_MAP = {
  freshrss: ExternalCard,
  headline: ExternalCard,
  reddit: ExternalCard,
  // ... rest unchanged
};
```

**Step 4: Verify in browser**

Open `http://localhost:3111/feed/scroll` and confirm headline/reddit/freshrss cards render with the new layout.

**Step 5: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/cards/ExternalCard.jsx frontend/src/modules/Feed/Scroll/cards/index.jsx frontend/src/modules/Feed/Scroll/cards/utils.js
git commit -m "feat: add unified ExternalCard for headlines, RSS, and Reddit"
```

---

### Task 12: Build GroundingCard component

Unified card for entropy, health, weather, fitness, tasks, gratitude.

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/cards/GroundingCard.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/cards/index.jsx`

**Step 1: Build GroundingCard**

Layout:
- Amber left border (4px `#fab005`)
- Header: sourceName + age
- Three sub-layouts based on content:
  - **Stats**: grid of key-value pairs (health, fitness) — detected by `meta.weight` or `meta.minutes`
  - **Text**: body text in italic (gratitude) — detected by `source === 'gratitude'`
  - **Status**: status dot + label (entropy, weather, tasks) — default

**Step 2: Update card registry**

```javascript
const CARD_MAP = {
  // ... external cards ...
  entropy: GroundingCard,
  health: GroundingCard,
  weather: GroundingCard,
  gratitude: GroundingCard,
  fitness: GroundingCard,
  tasks: GroundingCard,
};
```

**Step 3: Verify in browser**

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/cards/GroundingCard.jsx frontend/src/modules/Feed/Scroll/cards/index.jsx
git commit -m "feat: add unified GroundingCard for all grounding sources"
```

---

### Task 13: Build MediaCard component

Unified card for photo and plex — full-bleed with overlay.

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/cards/MediaCard.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/cards/index.jsx`

**Step 1: Build MediaCard**

Layout:
- Full-bleed image (negative margin to break container padding)
- Bottom scrim gradient overlay
- Title + subtitle overlaid on scrim
- Plex badge if `source === 'plex'`

**Step 2: Update card registry**

```javascript
const CARD_MAP = {
  // ... external + grounding cards ...
  photo: MediaCard,
  plex: MediaCard,
};
```

**Step 3: Verify, commit**

```bash
git add frontend/src/modules/Feed/Scroll/cards/MediaCard.jsx frontend/src/modules/Feed/Scroll/cards/index.jsx
git commit -m "feat: add unified MediaCard for photos and Plex"
```

---

### Task 14: Build ContentDrawer and wire into Scroll.jsx

Slide-down drawer below cards for article preview and Reddit comments.

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/ContentDrawer.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.scss`

**Step 1: Build ContentDrawer**

- Receives `{ item, onClose }`
- If Reddit: fetches `https://www.reddit.com/comments/{postId}.json` via client, renders top comments
- If article: fetches `/api/v1/feed/readable?url={link}`, renders extracted text
- Close button at top-right
- Slide-down animation via Web Animations API (TV app kills CSS transitions)

**Step 2: Add expandedItemId state to Scroll.jsx**

```javascript
const [expandedItemId, setExpandedItemId] = useState(null);
```

Double-tap detection on ExternalCard → sets `expandedItemId`. ContentDrawer renders below the expanded card.

**Step 3: Add drawer styles to Scroll.scss**

**Step 4: Verify in browser — double-tap a Reddit card, see comments load**

**Step 5: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/ContentDrawer.jsx frontend/src/modules/Feed/Scroll/Scroll.jsx frontend/src/modules/Feed/Scroll/Scroll.scss
git commit -m "feat: add ContentDrawer with Reddit comments and article preview"
```

---

### Task 15: Clean up old card components

Delete the old per-source card components that are now replaced by the three unified cards.

**Files:**
- Delete: `frontend/src/modules/Feed/Scroll/cards/HeadlineCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/ArticleCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/EntropyCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/HealthCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/WeatherCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/GratitudeCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/FitnessCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/TaskCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/PlexCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/cards/PhotoCard.jsx`
- Delete: `frontend/src/modules/Feed/Scroll/ScrollCard.jsx` (already unused)
- Modify: `frontend/src/modules/Feed/Scroll/cards/index.jsx` (remove old imports)

**Step 1: Update index.jsx to only import ExternalCard, GroundingCard, MediaCard**

**Step 2: Delete old files**

**Step 3: Verify no import errors in browser**

**Step 4: Commit**

```bash
git add -A frontend/src/modules/Feed/Scroll/cards/ frontend/src/modules/Feed/Scroll/ScrollCard.jsx
git commit -m "refactor: remove old per-source card components"
```
