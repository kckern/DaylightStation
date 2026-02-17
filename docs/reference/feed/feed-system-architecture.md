# Feed System Architecture

A comprehensive reference for the DaylightStation feed system — from RSS harvesting and source adapters through scroll assembly, detail views, and the frontend card/detail rendering pipeline.

---

## System Overview

The feed system aggregates content from external services (RSS, Reddit, YouTube, Google News) and internal data sources (photos, fitness, weather, journal, tasks, Plex, Komga) into a unified scrollable feed. It supports three presentation modes: a **Reader** (FreshRSS integration), **Headlines** (config-driven multi-page newspaper layout), and **Scroll** (algorithmic mobile-first feed with detail views).

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL SOURCES                              │
│                                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ RSS Feeds│ │ Reddit   │ │ YouTube  │ │ Google   │ │ Komga    │  │
│  │ (multi)  │ │ JSON API │ │ Data API │ │ News RSS │ │ REST API │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │
│       └─────────────┴────────────┴─────────────┴────────────┘        │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────┼──────────────────────────────────────┐
│                        BACKEND (Node.js)                             │
│                                │                                     │
│  ┌────────────────────────────┼────────────────────────────────────┐ │
│  │            Feed Source Adapters (IFeedSourceAdapter)             │ │
│  │  Reddit · Weather · Health · Gratitude · Strava · Todoist ·     │ │
│  │  Immich · Plex · Journal · YouTube · GoogleNews · Komga         │ │
│  └────────────────────────────┬────────────────────────────────────┘ │
│                               │                                      │
│  ┌────────────────────────────┼───────────────────────────┐         │
│  │         FeedAssemblyService                            │         │
│  │  • Dispatches queries to source adapters               │         │
│  │  • Interleaves external vs grounding items             │         │
│  │  • Enforces spacing rules (SpacingEnforcer)            │         │
│  │  • LRU item cache for deep-link resolution             │         │
│  │  • Detail delegation to source adapters                │         │
│  └────────────────────────────┬───────────────────────────┘         │
│                               │                                      │
│  ┌────────────────────────────┼───────────────────────────┐         │
│  │  HeadlineService           │  FeedContentService       │         │
│  │  • Multi-page config       │  • Article extraction     │         │
│  │  • RSS harvesting          │  • og:image / og:desc     │         │
│  │  • Scheduled refresh       │  • Paywall proxy          │         │
│  └────────────────────────────┼───────────────────────────┘         │
│                               │                                      │
│  ┌────────────────────────────▼───────────────────────────┐         │
│  │  Feed API Router (/api/v1/feed/*)                      │         │
│  │  GET  /scroll         GET  /headlines                  │         │
│  │  GET  /detail/:id     GET  /headlines/pages            │         │
│  │  GET  /scroll/item/:slug   POST /headlines/harvest     │         │
│  └────────────────────────────┬───────────────────────────┘         │
└───────────────────────────────┼──────────────────────────────────────┘
                                │ HTTP/JSON
┌───────────────────────────────┼──────────────────────────────────────┐
│                        FRONTEND (React)                              │
│                                │                                     │
│  ┌─────────────────────────────▼─────────────────────────────────┐   │
│  │  FeedApp (Routes)                                              │   │
│  │  /feed/reader     → Reader (FreshRSS)                         │   │
│  │  /feed/headlines/:pageId → Headlines (newspaper grid)         │   │
│  │  /feed/scroll     → Scroll (card feed)                        │   │
│  │  /feed/scroll/:itemId → DetailView (expanded content)         │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌────────────────────┐  ┌──────────────────────┐                   │
│  │ Card Components    │  │ Detail Sections       │                   │
│  │ ExternalCard       │  │ ArticleSection        │                   │
│  │ GroundingCard      │  │ CommentsSection        │                   │
│  │ MediaCard          │  │ PlayerSection          │                   │
│  └────────────────────┘  │ EmbedSection           │                   │
│                          │ StatsSection           │                   │
│                          │ MetadataSection        │                   │
│                          │ MediaSection           │                   │
│                          │ BodySection            │                   │
│                          │ ActionsSection         │                   │
│                          └──────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## DDD Layer Map

| Layer | File | Purpose |
|-------|------|---------|
| **System** | `backend/src/0_system/bootstrap.mjs` | Creates feed services, configures RSSParser with `media:content`/`media:thumbnail` custom fields |
| **Adapter** | `backend/src/1_adapters/feed/RssHeadlineHarvester.mjs` | Harvests RSS feeds (supports multi-URL sources), extracts images from media:content/thumbnail/enclosure |
| **Adapter** | `backend/src/1_adapters/feed/WebContentAdapter.mjs` | Fetches web pages, extracts readable content + og:image + og:description |
| **Adapter** | `backend/src/1_adapters/feed/sources/*.mjs` | 12 source adapters (see Source Adapters section) |
| **Application** | `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs` | Base class defining `fetchItems()` and optional `getDetail()` |
| **Application** | `backend/src/3_applications/feed/services/FeedAssemblyService.mjs` | Core scroll orchestration — dispatching, interleaving, spacing, caching, detail delegation |
| **Application** | `backend/src/3_applications/feed/services/HeadlineService.mjs` | Multi-page headline management — harvesting, caching, pruning |
| **Application** | `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs` | Loads scroll config from `config/feed` user data |
| **Application** | `backend/src/3_applications/feed/services/SpacingEnforcer.mjs` | Prevents consecutive items from same source/subsource |
| **API** | `backend/src/4_api/v1/routers/feed.mjs` | Express router — scroll, headlines, detail, icon proxy endpoints |

---

## Source Adapters

Each adapter extends `IFeedSourceAdapter` and implements `fetchItems(query, username)`. Adapters that support expanded detail also implement `getDetail(localId, meta, username)`.

| Adapter | Source Type | Feed Type | Detail Support | Data Source |
|---------|------------|-----------|----------------|-------------|
| `RedditFeedAdapter` | `reddit` | external | Comments + body text | Reddit JSON API |
| `WeatherFeedAdapter` | `weather` | grounding | Stats (temp, feels, AQI) | WeatherAPI via existing service |
| `HealthFeedAdapter` | `health` | grounding | Stats (weight, steps, cals) | Apple Health / Withings data |
| `GratitudeFeedAdapter` | `gratitude` | grounding | - | Local YAML selections |
| `StravaFeedAdapter` | `fitness` | grounding | Stats (HR, duration, suffer) | Strava API |
| `TodoistFeedAdapter` | `tasks` | grounding | Metadata (priority, project) | Todoist API |
| `ImmichFeedAdapter` | `photo` | grounding | EXIF metadata + full image / video player | Immich API |
| `PlexFeedAdapter` | `plex` | media | Inline player | Plex API via content registry |
| `JournalFeedAdapter` | `journal` | grounding | - | Local journalist/messages.yml |
| `YouTubeFeedAdapter` | `youtube` | external | YouTube embed player | YouTube Data API v3 |
| `GoogleNewsFeedAdapter` | `googlenews` | external | - | Google News public RSS |
| `KomgaFeedAdapter` | `komga` | grounding | Page image + metadata | Komga REST API + PDF TOC extraction |

### Adding a New Source Adapter

1. Create `backend/src/1_adapters/feed/sources/{Name}FeedAdapter.mjs`
2. Extend `IFeedSourceAdapter`, implement `get sourceType()` and `fetchItems(query, username)`
3. Optionally implement `getDetail(localId, meta, username)` for detail view support
4. Register in `backend/src/app.mjs` by importing and adding to the `sourceAdapters` array
5. Add a query config YAML in `data/household/shared/apps/feed/queries/` (e.g., `youtube.yml`)
6. Map the source type to a card component in `frontend/src/modules/Feed/Scroll/cards/index.jsx`

---

## FeedItem Shape

Every source adapter returns items normalized to this shape:

```javascript
{
  id: 'reddit:abc123',        // Globally unique: "{source}:{localId}"
  type: 'external',           // 'external' | 'grounding' | 'media'
  source: 'reddit',           // Source type key
  title: 'Post title',
  body: 'Optional body text',
  image: 'https://...',       // Optional image URL
  link: 'https://...',        // Optional external link
  timestamp: '2026-02-16T...',
  priority: 0,                // Higher = more important
  meta: {                     // Source-specific metadata
    subreddit: 'science',
    postId: 'abc123',
    sourceName: 'r/science',  // Display name
    sourceIcon: 'https://reddit.com', // For favicon proxy
  }
}
```

---

## Scroll Assembly Algorithm

`FeedAssemblyService.getNextBatch()` orchestrates the scroll:

1. **Load scroll config** — batch size, grounding ratios, decay parameters from `config/feed` user data
2. **Dispatch queries** — sends each YAML query config to the matching source adapter in parallel
3. **Source filtering** — if `?source=reddit,youtube` is specified, bypasses interleaving and returns filtered items sorted by timestamp
4. **Focus mode** — if `?focus=reddit:science` is specified, uses `focus_mode` params from scroll config
5. **Classify items** — separates `external` from `grounding` types
6. **Calculate grounding ratio** — based on session duration and decay curve (`grounding_ratio`, `grounding_min`, `decay_rate`)
7. **Interleave** — merges external and grounding items according to the calculated ratio
8. **Deduplicate** — removes items with duplicate IDs
9. **Enforce spacing** — `SpacingEnforcer` prevents consecutive items from same source (configurable min gaps per source)
10. **Cache** — stores returned items in an LRU cache (max 500) for deep-link resolution

### Grounding Ratio

The ratio of grounding-to-external items decreases over session time:

```
ratio = max(grounding_min, grounding_ratio × e^(-decay_rate × sessionMinutes))
```

Default: starts at 1:1, decays to 0.1 over ~60 minutes.

---

## Detail System

The detail system provides expanded content when a user taps a scroll card.

### Backend Flow

1. Frontend navigates to `/feed/scroll/{base64url-encoded-item-id}`
2. Frontend calls `GET /api/v1/feed/detail/{itemId}?link=...&meta=...`
3. `FeedAssemblyService.getDetail()` routes to the matching source adapter's `getDetail()` method
4. If no adapter-specific detail, falls back to article extraction via `WebContentAdapter`
5. Returns `{ sections: [{ type, data }] }` — a list of typed content sections

### Deep-Link Resolution

For direct URL access (shared links):
1. Frontend calls `GET /api/v1/feed/scroll/item/{base64url-slug}`
2. Server decodes slug to item ID, looks up in LRU cache
3. Returns `{ item, sections, ogImage, ogDescription }` or 404 if expired

### Section Types

Adapters return sections with these types, rendered by matching React components:

| Section Type | Component | Purpose |
|-------------|-----------|---------|
| `article` | `ArticleSection` | Extracted article HTML content |
| `body` | `BodySection` | Plain text body (e.g., Reddit self-text) |
| `comments` | `CommentsSection` | Threaded comments with author/score/depth |
| `stats` | `StatsSection` | Key-value stat grid (health, fitness, weather) |
| `metadata` | `MetadataSection` | Key-value metadata list (EXIF, task info) |
| `embed` | `EmbedSection` | Embedded iframe (YouTube videos) |
| `media` | `MediaSection` | Image gallery with captions |
| `player` | `PlayerSection` | Integrated content player (Plex, Immich video) |
| `actions` | `ActionsSection` | Action buttons |

---

## Headlines System

### Multi-Page Config-Driven Layout

Headlines are organized into **pages** defined in the user's `config/feed.yml`:

```yaml
headline_pages:
  - id: mainstream
    label: News
    grid:
      rows: [1, 2, 3]
      cols: [1, 2, 3, 4, 5]
    col_colors:
      - 'hsl(215, 50%, 40%)'    # left — blue
      - 'hsl(210, 30%, 35%)'    # center-left
      - 'hsl(220, 8%, 38%)'     # center — neutral
      - 'hsl(0, 25%, 35%)'      # center-right
      - 'hsl(0, 45%, 38%)'      # right — red
    sources:
      - id: nyt
        label: NYT
        url: https://rss.nytimes.com/...
        row: 1
        col: 1
      - id: bbc
        label: BBC
        urls:                    # Multi-URL sources supported
          - https://feeds.bbci.co.uk/news/rss.xml
          - https://feeds.bbci.co.uk/news/world/rss.xml
        row: 1
        col: 3
```

### RSS Harvesting

- `RssHeadlineHarvester` supports both single `url` and multi-URL `urls` fields
- Extracts images from `media:content`, `media:thumbnail`, and `enclosure` tags
- Multi-URL sources are merged and sorted by timestamp descending
- Pruning respects a `max_per_source` minimum — low-volume feeds keep all items even past retention window

### Paywall Proxy

Headlines from sources marked with `paywall: true` in config are proxied through a configurable URL prefix to bypass paywalls.

---

## API Endpoints

### Scroll

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/feed/scroll` | Fetch next batch of scroll items |
| | Query: `limit`, `cursor`, `session`, `focus`, `source` | |
| `GET` | `/api/v1/feed/scroll/item/:slug` | Deep-link resolution (base64url item ID) |
| `GET` | `/api/v1/feed/detail/:itemId` | Fetch detail sections for an item |
| | Query: `link`, `meta` (JSON) | |

### Headlines

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/feed/headlines/pages` | List configured headline pages `[{id, label}]` |
| `GET` | `/api/v1/feed/headlines?page=ID` | Get headlines for a page (defaults to first page) |
| `GET` | `/api/v1/feed/headlines/:source` | Get headlines for a single source |
| `POST` | `/api/v1/feed/headlines/harvest?page=ID` | Trigger harvest for all sources (or one page) |
| `POST` | `/api/v1/feed/headlines/harvest/:source` | Harvest a single source by ID |

### Reader & Other

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/feed/readable?url=` | Extract readable article content |
| `GET` | `/api/v1/feed/icon?url=` | Favicon proxy (avoids CORS) |

---

## Frontend Components

### File Map

| File | Purpose |
|------|---------|
| `frontend/src/Apps/FeedApp.jsx` | Root layout — tab navigation, route definitions, headline page tabs |
| `frontend/src/Apps/FeedApp.scss` | App-level styles (dark background) |
| `frontend/src/modules/Feed/Headlines/Headlines.jsx` | Headline page — fetches data, renders grid of SourcePanels |
| `frontend/src/modules/Feed/Headlines/SourcePanel.jsx` | Single source column — favicon, headline list, tooltips with images |
| `frontend/src/modules/Feed/Headlines/Headlines.scss` | Headline styles — grid layout, tooltips, dark theme |
| `frontend/src/modules/Feed/Scroll/Scroll.jsx` | Scroll feed — infinite scroll, route-driven detail, swipe navigation |
| `frontend/src/modules/Feed/Scroll/Scroll.scss` | Scroll styles — 3-column layout on wide screens, mini player bar |
| `frontend/src/modules/Feed/Scroll/FeedPlayerMiniBar.jsx` | Persistent mini player bar for active media playback |
| `frontend/src/modules/Feed/Scroll/cards/index.jsx` | Card registry — maps source types to card components |
| `frontend/src/modules/Feed/Scroll/cards/ExternalCard.jsx` | External content card (headlines, Reddit, YouTube, Google News) |
| `frontend/src/modules/Feed/Scroll/cards/GroundingCard.jsx` | Grounding card (weather, health, journal, tasks, gratitude) |
| `frontend/src/modules/Feed/Scroll/cards/MediaCard.jsx` | Media card (photos, Plex) — inline player support for Plex |
| `frontend/src/modules/Feed/Scroll/detail/DetailView.jsx` | Detail overlay — hero image, sections, swipe/touch navigation |
| `frontend/src/modules/Feed/Scroll/detail/DetailView.scss` | Detail view styles |
| `frontend/src/modules/Feed/Scroll/detail/sections/*.jsx` | Section renderers (9 types — see Section Types table) |

### Routing

```
/feed                    → Redirect to /feed/scroll
/feed/reader             → FreshRSS Reader
/feed/headlines           → Redirect to /feed/headlines/{first-page-id}
/feed/headlines/:pageId   → Headlines page (dynamic tabs from API)
/feed/scroll             → Scroll feed (card list)
/feed/scroll/:itemId     → Detail view (base64url-encoded item ID)
```

### Scroll Navigation

- **Card tap** → navigates to `/feed/scroll/{base64url(item.id)}`, saves scroll position
- **Back button** → returns to scroll list, restores scroll position
- **Swipe left/right** → navigates to next/previous item in the loaded list
- **Tabs** are hidden when viewing the scroll (immersive mode)
- **3-column layout** on wide screens (>900px) with sidebars flanking the 540px feed column

---

## Configuration

### User Config: `data/users/{username}/config/feed.yml`

```yaml
# Headline pages
headline_pages:
  - id: mainstream
    label: News
    grid: { rows: [1,2,3], cols: [1,2,3,4,5] }
    col_colors: [...]
    sources: [...]
  - id: tech
    label: Tech
    grid: { rows: [1,2], cols: [1,2,3] }
    sources: [...]

# Headline settings
headlines:
  retention_hours: 48
  max_per_source: 12
  paywall:
    enabled: true
    url_prefix: https://proxy.example.com/
    sources: [wsj, economist]

# Scroll settings
scroll:
  batch_size: 15
  grounding_ratio: 1.0
  grounding_min: 0.1
  decay_rate: 0.05

# Reddit config (moved from config/reddit.yml)
reddit:
  subreddits: [science, technology, worldnews]
```

### Query Configs: `data/household/shared/apps/feed/queries/*.yml`

Each YAML file defines a source query:

```yaml
# reddit.yml
source: reddit
feed_type: external
limit: 10
priority: 0
params:
  subreddits: [science, technology]
```

```yaml
# komga.yml
source: komga
feed_type: grounding
limit: 1
priority: 5
params:
  series:
    - id: "abc123"
      label: "Scientific American"
  recent_issues: 6
```

---

## Key Design Decisions

1. **Inline markdown stripping** — `FeedAssemblyService.#stripInlineMarkdown()` removes `[text](url)`, `**bold**`, `*italic*`, `` `code` `` from titles/bodies, extracting the first URL as a fallback link
2. **LRU item cache** — 500-item Map-based cache enables deep-link resolution without a database; items expire naturally as new items push old ones out
3. **Base64url encoding** — Item IDs (which contain colons) are base64url-encoded for URL-safe routing
4. **Grounding ratio decay** — Session-aware algorithm reduces "grounding" content (personal data) over time, shifting toward external content as the user scrolls longer
5. **SpacingEnforcer subsource** — Only uses `meta.subreddit` for subsource spacing (not sourceId or feedTitle), preventing Reddit domination without over-constraining other sources
6. **Config consolidation** — User feed config moved from separate `config/scroll.yml` and `config/reddit.yml` into unified `config/feed.yml`
7. **ContentDrawer replaced by DetailView** — The old inline drawer was replaced with a full-page route-driven detail view supporting typed sections, swipe navigation, and deep-linking
