# Feed Query System

How YAML query configs drive the feed scroll — from data files through adapter dispatch to rendered cards.

---

## Overview

The feed scroll is assembled from **query configs** — YAML files that each define a single content source. Queries live in two locations: **household-level** (shared across all users) and **user-level** (personal preferences). At server startup, household queries are loaded into memory. User queries are loaded on demand when a user requests their feed, and merged with household queries (user overrides household by filename).

### Where Queries Live

```
data/household/config/lists/
├── queries/       ← Household-level feed source configs (shared)
├── menus/         ← Content playlists for kiosk/TV app
├── programs/      ← Sequenced media programs (morning, evening)
└── watchlists/    ← Scripture/reading tracking lists

data/users/{username}/config/
└── queries/       ← User-scoped feed source configs (personal)
```

Only `queries/` directories are consumed by the feed system. The sibling directories serve other DaylightStation subsystems (content domain's `ListAdapter`).

### Household vs User Queries

Queries are split by scope:

| Scope | Path | Examples | Rationale |
|-------|------|----------|-----------|
| **Household** | `data/household/config/lists/queries/` | weather, entropy, headlines, health, photos, news | Shared infrastructure — same data regardless of user |
| **User** | `data/users/{username}/config/queries/` | reddit, youtube, googlenews, plex, komga, journal, tasks, fitness, gratitude, scripture-bom, goodreads | Personal subscriptions, accounts, and preferences |

**Merge behavior:** When a user query has the same filename as a household query, the user version takes precedence. This allows household-level defaults that individual users can override. The merge is cached per-user and invalidated on `FeedPoolManager.reset()`.

---

## Query YAML Schema

Each file defines one feed source. The filename (minus `.yml`) becomes the query key used for source filtering.

```yaml
type: <adapter-key>     # Required — maps to a registered source adapter or built-in handler
tier: <tier-name>        # Required — wire | library | scrapbook | compass
priority: <number>       # Optional — higher = more important within tier (default: 0)
limit: <number>          # Optional — max items to fetch from this source
params:                  # Optional — adapter-specific configuration
  <key>: <value>
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | Adapter key — must match a registered `IFeedSourceAdapter.sourceType` or a built-in handler (`freshrss`, `headlines`, `entropy`) |
| `tier` | string | yes | Which feed tier this source belongs to: `wire`, `library`, `scrapbook`, or `compass` |
| `priority` | number | no | Sort weight within the tier. Higher values surface first in priority-sorted tiers (compass). Default: `0` |
| `limit` | number | no | Maximum items the adapter should return. Adapters respect this as a cap. No default (adapter decides) |
| `params` | object | no | Adapter-specific config passed directly to `fetchItems()`. Each adapter interprets its own params |

### Internal Fields (added at load time)

| Field | Source | Description |
|-------|--------|-------------|
| `_filename` | Bootstrap | The original filename (e.g., `reddit.yml`). Used by `#filterQueries()` to match against user-enabled sources |
| `meta.queryName` | `FeedPoolManager` | The query filename (sans `.yml`), tagged onto each item during `#fetchSourcePage()`. Used by filter mode to match `?filter=` query-name expressions |

---

## All Query Files

> Queries below are marked **(H)** for household-scoped or **(U)** for user-scoped.

### Wire Tier (external content streams)

**`headlines.yml`** **(H)** — Harvested RSS headlines from the multi-page newspaper system
```yaml
type: headlines
tier: wire
limit: 30
```

**`news.yml`** **(H)** — FreshRSS self-hosted feed reader
```yaml
type: freshrss
tier: wire
limit: 20
params:
  excludeRead: true
```

**`reddit.yml`** **(U)** — Reddit posts from configured subreddits
```yaml
type: reddit
tier: wire
priority: 0
limit: 10
params:
  subreddits:
    - worldnews
    - technology
    - science
```

**`googlenews.yml`** **(U)** — Google News RSS by topic
```yaml
type: googlenews
tier: wire
priority: 0
limit: 8
params:
  topics:
    - artificial intelligence
    - space exploration
    - Utah
```

**`youtube.yml`** **(U)** — YouTube videos from channels and keyword searches
```yaml
type: youtube
tier: wire
priority: 0
limit: 5
params:
  channels:
    - UC_x5XG1OV2P6uZZ5FSM9Ttw
  keywords:
    - latter-day saints
```

### Library Tier (long-form reading material)

**`komga.yml`** **(U)** — Digital magazine issues from Komga
```yaml
type: komga
tier: library
priority: 5
limit: 1
params:
  series:
    - id: 0MRBEX5K1R45W
      label: MIT Technology Review
    - id: 0MRBEX5JXREYQ
      label: MIT Sloan Management Review
    - id: 0MRBEX5QXR9NZ
      label: National Geographic Interactive Magazine
  recent_issues: 6
```

### Scrapbook Tier (personal memories)

**`photos.yml`** **(H)** — Random photos and memories from Immich
```yaml
type: immich
tier: scrapbook
priority: 5
limit: 3
params:
  random: true
  preferMemories: true
```

**`journal.yml`** **(U)** — Personal journal entries
```yaml
type: journal
tier: scrapbook
priority: 5
limit: 2
```

### Compass Tier (life dashboard data)

**`weather.yml`** **(H)** — Current weather conditions
```yaml
type: weather
tier: compass
priority: 3
```

**`gratitude.yml`** **(U)** — Daily gratitude selections
```yaml
type: gratitude
tier: compass
priority: 5
limit: 1
```

**`plex.yml`** **(U)** — Recently added/watched Plex media
```yaml
type: plex
tier: compass
priority: 5
limit: 3
params:
  search:
    - new
    - recent
    - family
```

**`plex-music.yml`** **(U)** — Unwatched music from a specific Plex library
```yaml
type: plex
tier: compass
priority: 5
limit: 1
params:
  mode: children
  parentId: 175785
  unwatched: true
```

**`fitness.yml`** **(U)** — Recent Strava activities
```yaml
type: strava
tier: compass
priority: 10
params:
  source: strava
  daysBack: 3
```

**`health.yml`** **(H)** — Health metrics (weight, steps, calories)
```yaml
type: health
tier: compass
priority: 15
```

**`entropy.yml`** **(H)** — Data freshness alerts (stale integrations)
```yaml
type: entropy
tier: compass
priority: 20
params:
  onlyYellowRed: true
```

**`tasks.yml`** **(U)** — Todoist tasks due today or overdue
```yaml
type: tasks
tier: compass
priority: 25
params:
  source: tasks
  filter: overdue_or_due_today
```

### Non-Feed Query (content domain)

**`dailynews.yml`** **(H)** — Used by the content domain's `SavedQueryService`, not the feed scroll
```yaml
type: freshvideo
sources:
  - news/world_az
  - news/cnn
```

> This file has `type: freshvideo` which has no matching feed adapter, so `FeedAssemblyService` silently skips it (logs a warning and returns zero items).

---

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│  data/household/config/lists/queries/*.yml               │
│  Household-level queries (weather, headlines, etc.)      │
└──────────────────────┬──────────────────────────────────┘
                       │ Server startup (app.mjs)
                       │ readdirSync + dataService.household.read()
                       │ Each parsed object gets _filename appended
                       ▼
┌─────────────────────────────────────────────────────────┐
│  queryConfigs[] (household) + loadUserQueries() function │
│  Both injected into FeedPoolManager constructor          │
└──────────────────────┬──────────────────────────────────┘
                       │ GET /api/v1/feed/scroll
                       ▼
┌─────────────────────────────────────────────────────────┐
│  FeedAssemblyService.getNextBatch()                      │
│  Fresh load? → FeedPoolManager.reset()                   │
│  Load ScrollConfig, then get pool                        │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  FeedPoolManager.getPool()                               │
│  First call → #initializePool():                         │
│    #getQueryConfigs(username) — merge household + user   │
│      data/users/{username}/config/queries/*.yml           │
│      User queries override household by filename          │
│      Result cached per-user in #userQueryConfigs          │
│    #filterQueries() → match _filename to enabled sources │
│    Promise.allSettled fan-out to all sources              │
│    Age-filter results, record cursors                    │
│  Empty pool + sources remain → await #proactiveRefill()  │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  #fetchSourcePage() — per source                         │
│                                                          │
│  Adapter registry (Map<sourceType, IFeedSourceAdapter>): │
│    reddit, googlenews, youtube, komga, immich, journal,  │
│    plex, weather, gratitude, strava, health, tasks,      │
│    readalong, goodreads                                  │
│                                                          │
│  Built-in handlers (application-layer dependencies):     │
│    freshrss, headlines, entropy                          │
│                                                          │
│  Each returns { items, cursor }                          │
│  First page → FeedCacheService (stale-while-revalidate)  │
│  Subsequent pages → direct fetch (bypass cache)          │
└──────────────────────┬──────────────────────────────────┘
                       │ Pool of unseen items
                       ▼
              ┌────────┴────────┐
              │ ?filter= param? │  (FeedFilterResolver)
              └────────┬────────┘
           yes ┌───────┴───────┐ no
               ▼               ▼
     #getFilteredBatch() ┌────────┴────────┐
     Filter by tier,     │ ?source= param? │
     source, or query    └────────┬────────┘
     Sort by timestamp  yes ┌────┴────┐ no
     Return directly        ▼         ▼
                    Filter + sort  TierAssemblyService
                    by timestamp   .assemble()
                    return directly    │
                             ▼
                    ┌────────────────────┐
                    │ Bucket by tier      │
                    │ Within-tier select  │
                    │ Cross-tier interleave│
                    │ Deduplicate         │
                    │ SpacingEnforcer     │
                    └────────┬───────────┘
                             │
                             ▼
                    ┌────────────────────┐
                    │ Padding pass       │
                    │ markSeen() → refill│
                    │ Cache in LRU (500) │
                    │ Return JSON        │
                    └────────────────────┘
```

---

## Bootstrap Wiring

In `backend/src/app.mjs`:

1. **Load household query YAML files** — `readdirSync` the household queries directory, parse each with `dataService.household.read()`, append `_filename`
2. **Create `loadUserQueries` function** — a closure that reads `data/users/{username}/config/queries/*.yml` on demand using `dataService.user.read()`
3. **Instantiate adapters** — each adapter gets its required dependencies (dataService, API keys, etc.)
4. **Create pool manager** — `FeedPoolManager` receives `sourceAdapters`, `feedCacheService`, `queryConfigs` (household), `loadUserQueries` (user), and built-in service references
5. **Create assembly pipeline** — `ScrollConfigLoader` → `SpacingEnforcer` → `TierAssemblyService` → `FeedAssemblyService`
6. **Inject everything** — `FeedAssemblyService` receives `feedPoolManager`, `sourceAdapters` (for detail resolution), `scrollConfigLoader`, `tierAssemblyService`

```javascript
// Simplified bootstrap flow
const { readdirSync, existsSync } = await import('fs');

// Household queries — loaded at startup
const queryConfigs = readdirSync(queriesPath)
  .filter(f => f.endsWith('.yml'))
  .map(file => ({ ...dataService.household.read(`config/lists/queries/${key}`), _filename: file }))
  .filter(Boolean);

// User queries — loaded on demand per-user
const loadUserQueries = (username) => {
  const userQueriesPath = path.join(dataDir, 'users', username, 'config', 'queries');
  if (!existsSync(userQueriesPath)) return [];
  return readdirSync(userQueriesPath)
    .filter(f => f.endsWith('.yml'))
    .map(file => ({ ...dataService.user.read(`config/queries/${key}`, username), _filename: file }))
    .filter(Boolean);
};

const feedPoolManager = new FeedPoolManager({
  sourceAdapters: feedSourceAdapters,
  feedCacheService,
  queryConfigs,      // household-level
  loadUserQueries,   // user-level (on demand)
  freshRSSAdapter,
  headlineService,
  entropyService,
  logger,
});
```

---

## Adapter Interface

Every source adapter extends `IFeedSourceAdapter` (`backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs`):

```javascript
class IFeedSourceAdapter {
  get sourceType()                                        // Returns string matching query.type
  async fetchPage(query, username, { cursor } = {})      // Returns { items: Object[], cursor: string|null }
  async fetchItems(query, username)                      // @deprecated — use fetchPage instead
  async getDetail(localId, meta, username)               // Optional: returns { sections: [...] }
}
```

The `query` parameter passed to `fetchPage()` is the full parsed YAML object — adapters read `query.params`, `query.limit`, `query.tier`, and `query.priority` as needed. The `cursor` parameter is an opaque string from a previous `fetchPage` call; `undefined` on first fetch, a source-specific token for subsequent pages. Return `cursor: null` when no more pages are available.

### Type-to-Adapter Mapping

| `type` value | Adapter Class | Registration |
|-------------|---------------|-------------|
| `reddit` | `RedditFeedAdapter` | Adapter registry |
| `googlenews` | `GoogleNewsFeedAdapter` | Adapter registry |
| `youtube` | `YouTubeFeedAdapter` | Adapter registry |
| `komga` | `KomgaFeedAdapter` | Adapter registry |
| `immich` | `ImmichFeedAdapter` | Adapter registry |
| `journal` | `JournalFeedAdapter` | Adapter registry |
| `plex` | `PlexFeedAdapter` | Adapter registry |
| `weather` | `WeatherFeedAdapter` | Adapter registry |
| `gratitude` | `GratitudeFeedAdapter` | Adapter registry |
| `strava` | `StravaFeedAdapter` | Adapter registry |
| `health` | `HealthFeedAdapter` | Adapter registry |
| `tasks` | `TodoistFeedAdapter` | Adapter registry |
| `freshrss` | — | Built-in handler |
| `headlines` | — | Built-in handler |
| `entropy` | — | Built-in handler |

---

## Four-Tier System

Each query declares a `tier` that determines how its items are distributed in the final feed.

### Tier Definitions

| Tier | Purpose | Default Allocation | Sort Strategy | Examples |
|------|---------|--------------------|---------------|----------|
| **wire** | External content streams | Fills remaining slots | `timestamp_desc` | headlines, reddit, youtube, googlenews, freshrss |
| **library** | Long-form reading | 2 per batch | `random` | komga |
| **scrapbook** | Personal memories | 2 per batch | `random` | photos, journal |
| **compass** | Life dashboard | 6 per batch | `priority` | weather, health, fitness, plex, tasks, gratitude, entropy |

### Assembly Algorithm (TierAssemblyService)

1. **Wire decay** — adjust allocations based on batch number (wire decays to 0 over `wire_decay_batches`, freed slots go proportionally to non-wire tiers)
2. **Bucket** — partition all fetched items by `item.tier`
3. **Within-tier select** — apply sort strategy and source caps per tier config
4. **Interleave** — non-wire items are distributed evenly into the wire backbone at regular intervals
5. **Deduplicate** — remove items with duplicate IDs
6. **Spacing** — `SpacingEnforcer` prevents consecutive items from the same source

### Interleaving Example (Batch 1)

With default allocations (batch_size=15, first batch):
- compass: 6 items (weather, health, fitness, plex, tasks, gratitude)
- library: 2 items (komga)
- scrapbook: 2 items (photos, journal)
- wire: remaining 5 slots (reddit, headlines, youtube, etc.)

Non-wire items are inserted at even intervals into the wire list, producing a mixed feed. As the user scrolls deeper, wire decay shifts the balance: by batch N+1 (where N = `wire_decay_batches`), wire has 0 slots and all 15 items are personal content.

---

## User Scroll Config

Per-user overrides in `data/users/{username}/config/feed.yml` under the `scroll:` key:

```yaml
scroll:
  batch_size: 15
  wire_decay_batches: 10  # wire decays to 0 over N batches (default: 10, set 0 to disable)
  spacing:
    max_consecutive: 1
  tiers:
    compass:
      allocation: 6
      selection:
        sort: priority
      sources:
        weather:
          max_per_batch: 1
    wire:
      sources:
        reddit:
          max_per_batch: 3
```

`ScrollConfigLoader` deep-merges user config with `TIER_DEFAULTS`:

| Default Key | Value |
|------------|-------|
| `batch_size` | 15 |
| `wire_decay_batches` | 10 |
| `spacing.max_consecutive` | 1 |
| `wire.selection.sort` | `timestamp_desc` |
| `library.allocation` | 2 |
| `scrapbook.allocation` | 2 |
| `compass.allocation` | 6 |
| `compass.selection.sort` | `priority` |

### Source Filtering

`ScrollConfigLoader.getEnabledSources()` collects all source keys from the user's tier `sources:` config. If any sources are configured, `#filterQueries()` only dispatches queries whose `_filename` (sans `.yml`) appears in the enabled set. If no sources are configured, all queries pass through.

---

## Frontend Integration

### Scroll Request

`Scroll.jsx` calls `GET /api/v1/feed/scroll` with optional query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Override batch size |
| `cursor` | string | Pagination cursor (item ID of last loaded item) |
| `focus` | string | Focus on a source key, e.g., `reddit:science` |
| `source` | string | Comma-separated source filter, e.g., `komga,reddit` — bypasses tier assembly |
| `filter` | string | Compound ID expression resolved by `FeedFilterResolver` — see Filter Mode below |

### API Router

```javascript
// backend/src/4_api/v1/routers/feed.mjs
router.get('/scroll', asyncHandler(async (req, res) => {
  const { cursor, limit, focus, source, filter } = req.query;
  const result = await feedAssemblyService.getNextBatch(username, {
    limit: limit ? Number(limit) : undefined,
    cursor,
    focus: focus || null,
    sources: source ? source.split(',').map(s => s.trim()) : null,
    filter: filter || null,
  });
  res.json(result);
}));
```

### Response Shape

```json
{
  "items": [
    {
      "id": "reddit:abc123",
      "tier": "wire",
      "source": "reddit",
      "title": "Post title",
      "body": "Preview text...",
      "image": "https://...",
      "link": "https://...",
      "timestamp": "2026-02-16T...",
      "priority": 0,
      "meta": {
        "subreddit": "science",
        "sourceName": "r/science",
        "sourceIcon": "https://reddit.com"
      }
    }
  ],
  "hasMore": true
}
```

---

## Adding a New Query

1. Decide scope: **household** (shared infrastructure like weather, headlines) or **user** (personal subscriptions, accounts)
2. Create the YAML file in the appropriate directory:
   - Household: `data/household/config/lists/queries/{name}.yml`
   - User: `data/users/{username}/config/queries/{name}.yml`
3. Define `type`, `tier`, `priority`, `limit`, and `params`
4. Ensure a matching adapter exists (or create one extending `IFeedSourceAdapter`)
5. Register the adapter in `app.mjs` by adding it to the `sourceAdapters` array
6. Restart the server (household queries are loaded at startup; user queries are loaded on demand)
7. The new source will automatically appear in the scroll feed

### Dual-System Note

The household `queries/` directory is read by two independent systems:
- **Feed system** (`FeedPoolManager`) — interprets `type` as a feed adapter key
- **Content domain** (`SavedQueryService`) — interprets `type` as a content adapter key

Files like `dailynews.yml` (`type: freshvideo`) are consumed by the content system but silently ignored by the feed system (no matching feed adapter). This coexistence is by design — both systems share the same directory for operational convenience.

> **Note:** User-scoped queries are only consumed by the feed system. The content domain's `SavedQueryService` only reads from the household directory.

---

## Key Source Files

| File | Purpose |
|------|---------|
| `backend/src/app.mjs` | Bootstrap: loads YAML, creates adapters, wires FeedPoolManager + FeedAssemblyService |
| `backend/src/3_applications/feed/services/FeedPoolManager.mjs` | Pool management: paginated fetching, age filtering, refill, recycling |
| `backend/src/3_applications/feed/services/FeedAssemblyService.mjs` | Orchestrator: pool → filter/tier assembly → padding → caching, detail delegation |
| `backend/src/3_applications/feed/services/FeedFilterResolver.mjs` | 4-layer resolution chain for `?filter=` param (tier → source → query → alias) |
| `backend/src/3_applications/feed/services/TierAssemblyService.mjs` | Four-tier interleaving: bucket → select → interleave → dedupe → space |
| `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs` | Per-user scroll config loading, merging with defaults, age threshold resolution |
| `backend/src/3_applications/feed/services/SpacingEnforcer.mjs` | Prevents consecutive same-source items |
| `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs` | Port interface: `sourceType`, `fetchPage()`, `getDetail()` |
| `backend/src/1_adapters/feed/sources/*.mjs` | 14 source adapter implementations |
| `backend/src/4_api/v1/routers/feed.mjs` | Express router: `/scroll`, `/detail`, `/scroll/item/:slug` |
| `frontend/src/modules/Feed/Scroll/Scroll.jsx` | React scroll component: infinite scroll, detail navigation |
