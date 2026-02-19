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
│  │         FeedPoolManager                                │         │
│  │  • Paginated source fetching (fetchPage + cursors)     │         │
│  │  • Per-source age filtering (max_age_hours)            │         │
│  │  • Proactive refill when pool runs thin                │         │
│  │  • Silent recycling when all sources exhaust           │         │
│  └────────────────────────────┬───────────────────────────┘         │
│                               │                                      │
│  ┌────────────────────────────┼───────────────────────────┐         │
│  │         FeedAssemblyService                            │         │
│  │  • Four-tier assembly via TierAssemblyService          │         │
│  │  • Spacing enforcement (SpacingEnforcer)               │         │
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
│  │ FeedCard           │  │ ArticleSection        │                   │
│  │ (body modules)     │  │ CommentsSection        │                   │
│  └────────────────────┘  │ PlayerSection (ctrl)   │                   │
│                          │ EmbedSection           │                   │
│  ┌────────────────────┐  │ StatsSection           │                   │
│  │ Playback           │  │ MetadataSection        │                   │
│  │ PersistentPlayer   │  │ MediaSection           │                   │
│  │ FeedPlayerMiniBar  │  │ BodySection            │                   │
│  │ usePlaybackObserver│  │ ActionsSection         │                   │
│  └────────────────────┘  └──────────────────────┘                   │
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
| **Application** | `backend/src/3_applications/feed/services/FeedAssemblyService.mjs` | Scroll orchestration — pool → tier assembly → padding → cycling → caching, detail delegation, filter bypass |
| **Application** | `backend/src/3_applications/feed/services/FeedFilterResolver.mjs` | 4-layer resolution chain for `?filter=` param — tier → source type → query name → alias |
| **Application** | `backend/src/3_applications/feed/services/FeedPoolManager.mjs` | Item pool management — paginated source fetching, age filtering, proactive refill, silent recycling |
| **Application** | `backend/src/3_applications/feed/services/TierAssemblyService.mjs` | Four-tier bucketing, flex allocation, within-tier selection, cross-tier interleaving |
| **Application** | `backend/src/3_applications/feed/services/FlexAllocator.mjs` | CSS flexbox-inspired slot distribution — iterative grow/shrink/basis with min/max clamping |
| **Application** | `backend/src/3_applications/feed/services/FlexConfigParser.mjs` | YAML flex config normalization — parses shorthand, aliases, and legacy keys into flex descriptors |
| **Application** | `backend/src/3_applications/feed/services/SpacingEnforcer.mjs` | Prevents consecutive items from same source/subsource, enforces min spacing |
| **Application** | `backend/src/3_applications/feed/services/FeedCacheService.mjs` | Stale-while-revalidate cache with per-source TTLs, disk persistence |
| **Application** | `backend/src/3_applications/feed/services/HeadlineService.mjs` | Multi-page headline management — harvesting, caching, pruning |
| **Application** | `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs` | Loads scroll config from `config/feed` user data, merges with tier defaults |
| **API** | `backend/src/4_api/v1/routers/feed.mjs` | Express router — scroll, headlines, detail, icon proxy endpoints |

---

## Source Adapters

Each adapter extends `IFeedSourceAdapter` and implements `fetchPage(query, username, { cursor })` (or the legacy `fetchItems(query, username)`). Adapters that support pagination return a `cursor` for the next page; those that don't return `cursor: null`. Adapters that support expanded detail also implement `getDetail(localId, meta, username)`.

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
2. Extend `IFeedSourceAdapter`, implement `get sourceType()` and `fetchPage(query, username, { cursor })`
3. Return `{ items, cursor }` — set `cursor` to `null` if the source has no pagination
4. Optionally implement `getDetail(localId, meta, username)` for detail view support
5. Register in `backend/src/app.mjs` by adding to the `feedSourceAdapters` array
6. Add a query config YAML — household queries in `data/household/config/lists/queries/`, user-scoped queries in `data/users/{username}/config/queries/` (see `docs/reference/feed/feed-query-system.md`)
7. Map the source type to a card component in `frontend/src/modules/Feed/Scroll/cards/index.jsx`

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

`FeedAssemblyService.getNextBatch()` orchestrates the scroll via a multi-stage pipeline. See `docs/reference/feed/feed-assembly-process.md` for the complete walkthrough.

**Summary:**

1. **Reset pool** — on fresh load (no cursor), `FeedPoolManager.reset()` clears per-user state
2. **Get pool** — `FeedPoolManager.getPool()` returns all unseen items (initializes on first call by fetching page 1 from all sources in parallel, with age filtering). Recycled items tagged `_seen` for deprioritization
3. **Filter/source bypass** — if `?filter=` or `?source=`, resolve via `FeedFilterResolver` and bypass tier assembly (see `docs/reference/feed/feed-assembly-process.md`)
4. **Flex slot allocation** — `FlexAllocator` distributes batch slots across tiers using CSS flexbox-inspired grow/shrink/basis/min/max descriptors (two-level: batch→tiers, then tier→sources)
5. **Wire decay** — exponential decay: `factor = 0.5^((batch-1)/halfLife)`, default halfLife=2. Freed wire slots cascade to non-wire tiers proportionally, with overflow redistribution
6. **Tier assembly** — `TierAssemblyService.assemble()` runs within-tier selection (sort → cap → filler sources), shortfall redistribution across exhausted tiers, then cross-tier interleaving
7. **Spacing** — `SpacingEnforcer` enforces max_consecutive (default: 1), max_consecutive_subsource (default: 2), source/subsource min_spacing
8. **Padding** — fill short batches from sources marked `padding: true`
9. **Cycling** — last-resort duplication of batch items if still short after padding
10. **Image probe** — parallel dimension probing for items with images (enables masonry pre-calculation)
11. **Mark seen** — `FeedPoolManager.markSeen()` triggers proactive refill (when pool thins) or silent recycling (when all sources exhausted)
12. **Cache** — stores returned items in an LRU cache (max 500) for deep-link resolution

### Pagination and Pool Management

`FeedPoolManager` accumulates items across paginated source fetches. Adapters that support pagination (`RedditFeedAdapter`, `FreshRSSFeedAdapter`, `GoogleNewsFeedAdapter`) return continuation cursors. When the unseen pool drops below `2 × batch_size`, the pool manager proactively fetches the next page from non-exhausted sources. When all sources exhaust (hit age threshold or have no more content), seen items are Fisher-Yates shuffled back into the pool for infinite scroll.

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
| `player` | `PlayerSection` | Playback controller — play button (idle) or scrubber/controls (active). Actual Player lives in PersistentPlayer at Scroll level |
| `actions` | `ActionsSection` | Action buttons |
| `gallery` | `GallerySection` | Photo gallery with navigation |
| `scripture` | `ScriptureSection` | Scripture verse display |
| `timeline` | `TimelineSection` | Timeline/history display |

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
| | Query: `limit`, `cursor`, `focus`, `source`, `filter` | |
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
| `frontend/src/modules/Feed/Scroll/Scroll.jsx` | Scroll feed — infinite scroll, route-driven detail, swipe navigation, persistent player owner |
| `frontend/src/modules/Feed/Scroll/Scroll.scss` | Scroll styles — masonry layout on desktop (>900px), mini player bar |
| `frontend/src/modules/Feed/Scroll/hooks/useMasonryLayout.js` | JS-driven absolute-positioned masonry layout — greedy shortest-column placement, ResizeObserver measurement |
| `frontend/src/modules/Feed/Scroll/PersistentPlayer.jsx` | Persistent Player wrapper — keeps `<Player>` alive at Scroll level across navigation |
| `frontend/src/modules/Feed/Scroll/FeedPlayerMiniBar.jsx` | Mini player bar — thumbnail, play/pause, progress bar, source/title |
| `frontend/src/modules/Feed/Scroll/hooks/usePlaybackObserver.js` | Polls playerRef for playback state (playing, currentTime, duration), drives progress bar via rAF |
| `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx` | Feed card — hero image, source bar, body module, direct-play button for media items |
| `frontend/src/modules/Feed/Scroll/cards/index.jsx` | Card factory — `renderFeedCard(item, colors, { onDismiss, onPlay })` |
| `frontend/src/modules/Feed/Scroll/cards/bodies/index.js` | Body module registry — maps source types to body components |
| `frontend/src/modules/Feed/Scroll/detail/DetailView.jsx` | Detail overlay — hero image, sections, swipe/touch navigation |
| `frontend/src/modules/Feed/Scroll/detail/DetailView.scss` | Detail view styles |
| `frontend/src/modules/Feed/Scroll/detail/DetailModal.jsx` | Desktop modal wrapper for DetailView |
| `frontend/src/modules/Feed/Scroll/detail/sections/*.jsx` | Section renderers (12 types — see Section Types table) |

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
- **Masonry layout** on desktop (>900px) via `useMasonryLayout` hook — absolute-positioned cards with greedy shortest-column placement, ResizeObserver-based measurement, stable positions on append

### Persistent Media Player

Media playback (Plex, Immich video) uses a persistent player architecture where the `<Player>` component lives at the Scroll level and never unmounts during navigation.

```
Scroll.jsx
├── scroll-view (card list)
│   └── FeedCard → play button (e.stopPropagation → handlePlay, bypasses detail)
├── DetailView / DetailModal
│   └── PlayerSection (controller-only: play/pause, scrubber, time — no <Player>)
├── PersistentPlayer (owns <Player ref={playerRef}>, visually hidden for audio)
└── FeedPlayerMiniBar (thumbnail, play/pause toggle, progress bar)
```

**State flow:**
- `activeMedia` (`{ item, contentId }`) lives in Scroll — set by card play button or detail play button
- `playerRef` (useRef) points to Player's imperative handle: `seek()`, `play()`, `pause()`, `toggle()`, `getCurrentTime()`, `getDuration()`, `getMediaElement()`
- `usePlaybackObserver` hook polls playerRef at 500ms intervals for React state (`playing`, `currentTime`, `duration`) and uses `requestAnimationFrame` for smooth progress bar updates via direct DOM manipulation (`progressElRef`)

**Card-level play:** Clicking the play triangle overlay on a card's hero image starts playback directly without opening the detail view. The mini bar appears at the bottom. `e.stopPropagation()` prevents the card click from navigating to detail.

**Mini bar:** Shows when media is active and detail view is closed (`activeMedia && !urlSlug`). Displays: thumbnail (40x40), source name, title, play/pause toggle, close button, and a full-width progress bar.

**Detail controller:** When detail view is open for the playing item, `PlayerSection` renders a controller UI (seekable scrubber, play/pause, time labels, stop button) that talks to the persistent player via the shared `playback` prop.

**`contentId` derivation:** For Plex items, `contentId` equals `item.id` (both use `plex:{ratingKey}` format), so no extra API call is needed for card-level play.

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
  batch_size: 50
  wire_decay_half_life: 2   # wire halves every N batches (exponential decay, default: 2)
  spacing:
    max_consecutive: 1           # max same-source in a row (default: 1)
    max_consecutive_subsource: 2 # max same-subsource in a row (default: 2)
  tiers:
    wire:
      flex: "1 0 auto"          # grow=1, fills remaining space
      min: 20
      selection:
        sort: timestamp_desc
      sources:
        feeds:
          flex: dominant         # grow=2, 2x share
          max: 15
        social:
          flex: "1 0 auto"
          max: 11
        news:
          flex: filler           # fills remaining wire space
          max: 10
          min: 3
    compass:
      flex: "0 0 6"             # fixed 6 slots
      min: 4
    scrapbook:
      flex: "0 0 5"
      min: 3
    library:
      flex: "0 0 5"
      min: 2
```

Flex shorthand supports named aliases (`filler`, `dominant`, `fixed`, `none`, `padding`, `auto`), string format (`"grow shrink basis"`), number format (`flex: 2`), or explicit keys (`grow:`, `shrink:`, `basis:`, `min:`, `max:`). Legacy keys (`allocation`, `max_per_batch`, `role`) are still supported. See `docs/reference/feed/feed-assembly-process.md` for the full FlexAllocator algorithm.

### Query Configs (Two-Tier)

Queries live in two locations. Household queries (shared) load at startup; user queries (personal) load on demand per-user. User queries override household by filename. See `docs/reference/feed/feed-query-system.md` for full details.

| Scope | Path | Examples |
|-------|------|----------|
| Household | `data/household/config/lists/queries/*.yml` | weather, headlines, entropy, health, photos, news |
| User | `data/users/{username}/config/queries/*.yml` | reddit, youtube, komga, plex, journal, tasks, fitness |

```yaml
# weather.yml (household) — same for all users
type: weather
tier: compass
priority: 3
```

```yaml
# reddit.yml (user) — personal subreddit selections
type: reddit
tier: wire
limit: 10
params:
  subreddits: [science, technology, worldnews]
```

---

## Key Design Decisions

1. **Pool-based pagination** — `FeedPoolManager` accumulates items across paginated source fetches, enabling infinite scroll beyond initial source limits. Proactive refill fetches next pages when pool runs thin; silent recycling reshuffles seen items when all sources exhaust
2. **Age-filtered pagination** — Per-source `max_age_hours` thresholds prevent pagination from reaching arbitrarily old content. Entire stale pages mark the source as exhausted
3. **LRU item cache** — 500-item Map-based cache enables deep-link resolution without a database; items expire naturally as new items push old ones out
4. **Base64url encoding** — Item IDs (which contain colons) are base64url-encoded for URL-safe routing
5. **FlexAllocator (CSS flexbox-inspired)** — Slot distribution uses an iterative grow/shrink/basis algorithm with min/max clamping, operating at two levels (batch→tiers and tier→sources). Supports named aliases (`filler`, `dominant`) and legacy config migration
6. **Four-tier assembly** — Items are bucketed into wire/library/scrapbook/compass tiers with flex-based allocations, sort strategies, and source caps. Non-wire items are interleaved into the wire backbone at even intervals
7. **Wire decay (exponential)** — Wire allocation decays as `0.5^((batch-1)/halfLife)` (default halfLife=2). Freed slots cascade to non-wire tiers with overflow redistribution, creating a "news first, personal later" scroll experience
8. **Shortfall redistribution** — When tiers can't fill their allocation, surplus slots redistribute to scrapbook → library → compass, re-selecting items with expanded allocations
9. **Filler sources** — Sources marked `flex: filler` or `role: filler` get guaranteed minimums and absorb remaining tier capacity after primary sources are capped
10. **SpacingEnforcer** — Six-rule enforcement pipeline with source and subsource granularity. Subsource key derived from `meta.subreddit || meta.sourceId || meta.outlet || meta.feedTitle`
11. **Filter mode** — `?filter=` param resolves through a 4-layer chain (tier → source type → query name → alias) via `FeedFilterResolver`, bypassing tier assembly for single-source or single-tier browsing
12. **Config consolidation** — User feed config in unified `config/feed.yml`
13. **ContentDrawer replaced by DetailView** — Full-page route-driven detail view supporting typed sections, swipe navigation, and deep-linking
14. **Two-tier query configs** — Queries split between household (shared infrastructure) and user scope (personal subscriptions). User queries override household by filename, loaded on demand and cached per-user
15. **Stale-while-revalidate caching** — `FeedCacheService` caches first-page fetches with per-source TTLs (5–30 min), serving stale data immediately while refreshing in the background
