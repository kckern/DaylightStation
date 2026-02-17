# Feed Query System

How YAML query configs drive the feed scroll — from data files through adapter dispatch to rendered cards.

---

## Overview

The feed scroll is assembled from **query configs** — YAML files that each define a single content source. At server startup, all `*.yml` files in `data/household/config/lists/queries/` are read into memory and passed to `FeedAssemblyService`. On each scroll request, every query is dispatched to its matching source adapter in parallel, and the results are assembled into a unified feed using the four-tier system.

### Where Queries Live

```
data/household/config/lists/
├── queries/       ← Feed source configs (this document)
├── menus/         ← Content playlists for kiosk/TV app
├── programs/      ← Sequenced media programs (morning, evening)
└── watchlists/    ← Scripture/reading tracking lists
```

Only `queries/` is consumed by the feed system. The sibling directories serve other DaylightStation subsystems (content domain's `ListAdapter`).

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

---

## All Query Files

### Wire Tier (external content streams)

**`headlines.yml`** — Harvested RSS headlines from the multi-page newspaper system
```yaml
type: headlines
tier: wire
limit: 30
```

**`news.yml`** — FreshRSS self-hosted feed reader
```yaml
type: freshrss
tier: wire
limit: 20
params:
  excludeRead: true
```

**`reddit.yml`** — Reddit posts from configured subreddits
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

**`googlenews.yml`** — Google News RSS by topic
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

**`youtube.yml`** — YouTube videos from channels and keyword searches
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

**`komga.yml`** — Digital magazine issues from Komga
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

**`photos.yml`** — Random photos and memories from Immich
```yaml
type: immich
tier: scrapbook
priority: 5
limit: 3
params:
  random: true
  preferMemories: true
```

**`journal.yml`** — Personal journal entries
```yaml
type: journal
tier: scrapbook
priority: 5
limit: 2
```

### Compass Tier (life dashboard data)

**`weather.yml`** — Current weather conditions
```yaml
type: weather
tier: compass
priority: 3
```

**`gratitude.yml`** — Daily gratitude selections
```yaml
type: gratitude
tier: compass
priority: 5
limit: 1
```

**`plex.yml`** — Recently added/watched Plex media
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

**`plex-music.yml`** — Unwatched music from a specific Plex library
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

**`fitness.yml`** — Recent Strava activities
```yaml
type: strava
tier: compass
priority: 10
params:
  source: strava
  daysBack: 3
```

**`health.yml`** — Health metrics (weight, steps, calories)
```yaml
type: health
tier: compass
priority: 15
```

**`entropy.yml`** — Data freshness alerts (stale integrations)
```yaml
type: entropy
tier: compass
priority: 20
params:
  onlyYellowRed: true
```

**`tasks.yml`** — Todoist tasks due today or overdue
```yaml
type: tasks
tier: compass
priority: 25
params:
  source: tasks
  filter: overdue_or_due_today
```

### Non-Feed Query (content domain)

**`dailynews.yml`** — Used by the content domain's `SavedQueryService`, not the feed scroll
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
│  17 YAML files, each defining one source                 │
└──────────────────────┬──────────────────────────────────┘
                       │ Server startup (app.mjs)
                       │ readdirSync + dataService.household.read()
                       │ Each parsed object gets _filename appended
                       ▼
┌─────────────────────────────────────────────────────────┐
│  queryConfigs[] array                                    │
│  Injected into FeedAssemblyService constructor           │
└──────────────────────┬──────────────────────────────────┘
                       │ GET /api/v1/feed/scroll
                       ▼
┌─────────────────────────────────────────────────────────┐
│  ScrollConfigLoader.load(username)                       │
│  Reads users/{username}/config/feed.yml → scroll section │
│  Merges with TIER_DEFAULTS                               │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  #filterQueries()                                        │
│  Matches query._filename against getEnabledSources()     │
│  (If no sources configured, all queries pass through)    │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Promise.allSettled — parallel fan-out                    │
│  Each query dispatched to matching adapter by query.type  │
│                                                          │
│  Adapter registry (Map<sourceType, IFeedSourceAdapter>): │
│    reddit, googlenews, youtube, komga, immich, journal,  │
│    plex, weather, gratitude, strava, health, tasks        │
│                                                          │
│  Built-in handlers (application-layer dependencies):     │
│    freshrss, headlines, entropy                          │
└──────────────────────┬──────────────────────────────────┘
                       │ Each adapter returns FeedItem[]
                       ▼
┌─────────────────────────────────────────────────────────┐
│  #normalizeToFeedItem()                                  │
│  Strips inline markdown, ensures uniform shape           │
│  Sets tier from query config                             │
└──────────────────────┬──────────────────────────────────┘
                       │
              ┌────────┴────────┐
              │ ?source= param? │
              └────────┬────────┘
           yes ┌───────┴───────┐ no
               ▼               ▼
     Filter + sort by    TierAssemblyService
     timestamp, return   .assemble()
     directly               │
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
                    │ Slice to limit     │
                    │ Cache in LRU (500) │
                    │ Return JSON        │
                    └────────────────────┘
```

---

## Bootstrap Wiring

In `backend/src/app.mjs` (lines 666–777):

1. **Load query YAML files** — `readdirSync` the queries directory, parse each with `dataService.household.read()`, append `_filename`
2. **Instantiate adapters** — each adapter gets its required dependencies (dataService, API keys, etc.)
3. **Create assembly pipeline** — `ScrollConfigLoader` → `SpacingEnforcer` → `TierAssemblyService` → `FeedAssemblyService`
4. **Inject everything** — `FeedAssemblyService` receives `queryConfigs`, `sourceAdapters[]`, `scrollConfigLoader`, `tierAssemblyService`

```javascript
// Simplified bootstrap flow
const queryConfigs = readdirSync(queriesPath)
  .filter(f => f.endsWith('.yml'))
  .map(file => ({ ...dataService.household.read(`config/lists/queries/${key}`), _filename: file }))
  .filter(Boolean);

const feedAssemblyService = new FeedAssemblyService({
  queryConfigs,
  sourceAdapters: [redditAdapter, weatherAdapter, /* ... 10 more */],
  scrollConfigLoader,
  tierAssemblyService,
  // ...
});
```

---

## Adapter Interface

Every source adapter extends `IFeedSourceAdapter` (`backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs`):

```javascript
class IFeedSourceAdapter {
  get sourceType()                           // Returns string matching query.type
  async fetchItems(query, username)          // Returns FeedItem[] from the query config
  async getDetail(localId, meta, username)   // Optional: returns { sections: [...] }
}
```

The `query` parameter passed to `fetchItems()` is the full parsed YAML object — adapters read `query.params`, `query.limit`, `query.tier`, and `query.priority` as needed.

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

1. **Bucket** — partition all fetched items by `item.tier`
2. **Within-tier select** — apply sort strategy and source caps per tier config
3. **Interleave** — non-wire items are distributed evenly into the wire backbone at regular intervals
4. **Deduplicate** — remove items with duplicate IDs
5. **Spacing** — `SpacingEnforcer` prevents consecutive items from the same source

### Interleaving Example

With default allocations (batch_size=15):
- compass: 6 items (weather, health, fitness, plex, tasks, gratitude)
- library: 2 items (komga)
- scrapbook: 2 items (photos, journal)
- wire: remaining 5 slots (reddit, headlines, youtube, etc.)

Non-wire items are inserted at even intervals into the wire list, producing a mixed feed.

---

## User Scroll Config

Per-user overrides in `data/users/{username}/config/feed.yml` under the `scroll:` key:

```yaml
scroll:
  batch_size: 15
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

### API Router

```javascript
// backend/src/4_api/v1/routers/feed.mjs
router.get('/scroll', asyncHandler(async (req, res) => {
  const { cursor, limit, focus, source } = req.query;
  const result = await feedAssemblyService.getNextBatch(username, {
    limit: limit ? Number(limit) : undefined,
    cursor,
    focus: focus || null,
    sources: source ? source.split(',').map(s => s.trim()) : null,
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

1. Create `data/household/config/lists/queries/{name}.yml` with `type`, `tier`, `priority`, `limit`, and `params`
2. Ensure a matching adapter exists (or create one extending `IFeedSourceAdapter`)
3. Register the adapter in `app.mjs` by adding it to the `sourceAdapters` array
4. Restart the server (queries are loaded at bootstrap time)
5. The new source will automatically appear in the scroll feed

### Dual-System Note

The `queries/` directory is read by two independent systems:
- **Feed system** (`FeedAssemblyService`) — interprets `type` as a feed adapter key
- **Content domain** (`SavedQueryService`) — interprets `type` as a content adapter key

Files like `dailynews.yml` (`type: freshvideo`) are consumed by the content system but silently ignored by the feed system (no matching feed adapter). This coexistence is by design — both systems share the same directory for operational convenience.

---

## Key Source Files

| File | Purpose |
|------|---------|
| `backend/src/app.mjs` (L666–777) | Bootstrap: loads YAML, creates adapters, wires FeedAssemblyService |
| `backend/src/3_applications/feed/services/FeedAssemblyService.mjs` | Orchestrator: fan-out, normalization, source filtering, detail delegation |
| `backend/src/3_applications/feed/services/TierAssemblyService.mjs` | Four-tier interleaving: bucket → select → interleave → dedupe → space |
| `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs` | Per-user scroll config loading and merging with defaults |
| `backend/src/3_applications/feed/services/SpacingEnforcer.mjs` | Prevents consecutive same-source items |
| `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs` | Port interface: `sourceType`, `fetchItems()`, `getDetail()` |
| `backend/src/1_adapters/feed/sources/*.mjs` | 12 source adapter implementations |
| `backend/src/4_api/v1/routers/feed.mjs` | Express router: `/scroll`, `/detail`, `/scroll/item/:slug` |
| `frontend/src/modules/Feed/Scroll/Scroll.jsx` | React scroll component: infinite scroll, detail navigation |
