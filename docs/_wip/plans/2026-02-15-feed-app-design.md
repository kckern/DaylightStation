# FeedApp Design

> RSS reader, headline scanner, and boonscrolling in one app

**Last Updated:** 2026-02-15
**Status:** Design Complete, Ready for Implementation

---

## Overview

FeedApp provides three views of external content under `/feed`:

| View | Route | Data Source | UX Model |
|------|-------|-------------|----------|
| **Reader** | `/feed/reader` | FreshRSS proxy passthrough | Feedly — full articles, read/unread |
| **Headlines** | `/feed/headlines` | Harvested + cached headlines | Netvibes — grid of source panels |
| **Scroll** | `/feed/scroll` | Merged feed (FreshRSS + headlines) | Infinite scroll (boonscrolling skeleton) |

### Approach: Hybrid

- **Reader** proxies directly to FreshRSS's Google Reader API. FreshRSS handles feed fetching, caching, and read/unread state. No duplication.
- **Headlines** harvests high-volume RSS feeds on a schedule and caches lightweight headline data (source, title, desc, link, timestamp) in per-source YAML files. Sources come from two places: standalone RSS URLs configured independently, plus select FreshRSS feeds tagged for headline use.
- **Scroll** merges FreshRSS unread items + headline cache into a chronological infinite scroll. This is the skeleton for future boonscrolling grounding injection (see `2026-01-30-boonscrolling-feed-design.md`).

### User Scoping

Each user has their own FreshRSS API key (`data/users/{username}/auth/freshrss.yml`) and feed config (`data/users/{username}/apps/feed/config.yml`).

---

## Architecture

### Backend Layers

```
0_system/
  └── scheduling/TaskRegistry.mjs       (existing — add feed harvest task)

1_adapters/
  ├── proxy/FreshRSSProxyAdapter.mjs     (exists)
  ├── feed/
  │   ├── FreshRSSFeedAdapter.mjs        (wraps proxy for structured feed data)
  │   └── RssHeadlineHarvester.mjs       (fetches standalone + FreshRSS headline feeds)
  └── persistence/yaml/
      └── YamlHeadlineCacheStore.mjs     (per-source YAML, rolling 24-48hr window)

2_domains/feed/
  └── entities/
      └── Headline.mjs                  (source, title, desc, link, timestamp)

3_applications/feed/
  ├── ports/
  │   ├── IFeedSource.mjs
  │   └── IHeadlineStore.mjs
  └── services/
      ├── HeadlineService.mjs           (harvest, prune, merge sources)
      └── HeadlineHarvestJob.mjs        (scheduled task — runs hourly)

4_api/v1/routers/
  └── feed.mjs                          (all three views' endpoints)
```

### Scheduler Registration

```javascript
taskRegistry.register('feed:harvest-headlines', {
  cron: '0 * * * *',  // hourly
  handler: () => headlineHarvestJob.execute()
});
```

The job iterates all configured headline sources (standalone URLs + FreshRSS-tagged feeds), fetches each, stores to per-source YAML, prunes entries older than the configured retention window (default 48 hours).

---

## API Endpoints

### Reader (FreshRSS Proxy)

```
GET  /api/v1/feed/reader/categories        → FreshRSS categories/folders
GET  /api/v1/feed/reader/feeds              → FreshRSS subscriptions list
GET  /api/v1/feed/reader/items?feed={id}    → FreshRSS articles (full content)
POST /api/v1/feed/reader/items/mark         → Mark read/unread in FreshRSS
```

Thin wrappers around FreshRSS's Google Reader API (`/api/greader.php`). Backend handles auth injection (API key from user's `freshrss.yml`) so the frontend never sees credentials.

### Headlines (Cached)

```
GET  /api/v1/feed/headlines                 → All cached headlines (grouped by source)
GET  /api/v1/feed/headlines/:source         → Headlines for one source
POST /api/v1/feed/headlines/harvest         → Trigger manual harvest
```

Response format:

```json
{
  "sources": {
    "cnn": {
      "label": "CNN",
      "items": [
        {
          "title": "Breaking: Something happened",
          "desc": "Officials confirmed today that the situation has...",
          "link": "https://cnn.com/article/123",
          "timestamp": "2026-02-15T09:45:00Z"
        }
      ]
    },
    "foxnews": { "label": "Fox News", "items": [] }
  },
  "lastHarvest": "2026-02-15T10:00:00Z"
}
```

### Scroll

```
GET  /api/v1/feed/scroll?cursor={id}&limit=20  → Next batch of scroll items
POST /api/v1/feed/scroll/mark                   → Mark items consumed
```

Initially merges FreshRSS unread + headline cache into a chronological stream. Later, this is where grounding injection plugs in (see boonscrolling design doc).

### Config

```
GET  /api/v1/feed/config                    → User's feed config
PUT  /api/v1/feed/config                    → Update feed config
```

---

## Frontend Components

```
frontend/src/
  Apps/
    FeedApp.jsx              ← Shell: tab bar + React Router <Outlet>
    FeedApp.scss

  modules/Feed/
    Reader/
      Reader.jsx             ← Feedly view: sidebar + article pane
      FeedList.jsx           ← Left sidebar: categories → feeds → unread counts
      ArticleList.jsx        ← Middle: article titles for selected feed
      ArticleView.jsx        ← Right: full article content
      Reader.scss

    Headlines/
      Headlines.jsx          ← Netvibes view: grid of source panels
      SourcePanel.jsx        ← Single panel: source name + scrollable headline list
      HeadlineRow.jsx        ← One headline: title + desc + external link
      Headlines.scss

    Scroll/
      Scroll.jsx             ← Boonscrolling: infinite scroll container
      ScrollCard.jsx         ← Single card: image, title, source badge, link
      Scroll.scss
```

### FeedApp Shell

```jsx
<MantineProvider>
  <div className="feed-app">
    <nav className="feed-tabs">
      <NavLink to="/feed/reader">Reader</NavLink>
      <NavLink to="/feed/headlines">Headlines</NavLink>
      <NavLink to="/feed/scroll">Scroll</NavLink>
    </nav>
    <Outlet />
  </div>
</MantineProvider>
```

### Reader View

Three-pane layout: sidebar (categories/feeds with unread counts) | article list (titles for selected feed) | article view (full content). Clicking a feed loads articles from FreshRSS proxy. Clicking an article shows full content and marks it read.

### Headlines View

CSS grid of `SourcePanel` boxes. Each panel has a source name header and a fixed-height scrollable list of headlines. Each `HeadlineRow` shows the title as a link, a muted one-line `desc` underneath (truncated via CSS `text-overflow: ellipsis`), and an age badge. Clicking opens the link externally.

### Scroll View

Vertical infinite scroll of `ScrollCard` components. Each card renders source icon, title, optional thumbnail, and link. Calls `/feed/scroll?cursor=...` on scroll-to-bottom. Skeleton for future grounding card types.

---

## Data Model

### Headline Entity

```javascript
// 2_domains/feed/entities/Headline.mjs
{
  source,     // string — source ID (e.g., 'cnn', 'freshrss-12')
  title,      // string — headline text
  desc,       // string|null — first sentence or first 120 chars of body, truncated
  link,       // string — URL to original article
  timestamp   // Date — publication time
}
```

The `desc` field is extracted from the RSS `<description>` or `<content:encoded>` element — first sentence or first 120 characters, whichever is shorter. Falls back to `null` if the feed provides no body.

---

## User Config & Data

### Config

**File:** `data/users/{username}/apps/feed/config.yml`

```yaml
# FreshRSS feeds to include in Headlines view (merged with standalone)
freshrss_headline_feeds:
  - feed_id: 12
    label: "AP News"
  - feed_id: 34
    label: "Reuters"

# Standalone headline sources (not in FreshRSS)
headline_sources:
  - id: cnn
    label: "CNN"
    url: "http://rss.cnn.com/rss/edition.rss"
  - id: foxnews
    label: "Fox News"
    url: "https://moxie.foxnews.com/google-publisher/latest.xml"
  - id: bbc
    label: "BBC"
    url: "https://feeds.bbci.co.uk/news/rss.xml"

# Headline cache settings
headlines:
  retention_hours: 48
  harvest_interval_minutes: 60

# Scroll view settings
scroll:
  batch_size: 20
  sources:
    - freshrss
    - headlines
```

### Auth

**File (exists):** `data/users/{username}/auth/freshrss.yml`

```yaml
key: <FreshRSS API key>
```

### Cache

**Directory:** `data/users/{username}/cache/feed/headlines/`

```
headlines/
  cnn.yml
  foxnews.yml
  bbc.yml
  freshrss-12.yml    ← FreshRSS feed ID 12 (AP News)
  freshrss-34.yml    ← FreshRSS feed ID 34 (Reuters)
```

**Per-source cache file** (e.g., `cnn.yml`):

```yaml
source: cnn
label: CNN
last_harvest: 2026-02-15T10:00:00Z
items:
  - title: "Breaking: Something happened"
    desc: "Officials confirmed today that the situation has developed significantly..."
    link: "https://cnn.com/article/123"
    timestamp: 2026-02-15T09:45:00Z
  - title: "Another story"
    desc: "The committee released findings showing a pattern of..."
    link: "https://cnn.com/article/124"
    timestamp: 2026-02-15T08:30:00Z
```

---

## Implementation Plan

### Phase 1: Backend Infrastructure
1. Create `Headline` entity in `2_domains/feed/entities/`
2. Create `IFeedSource` and `IHeadlineStore` ports in `3_applications/feed/ports/`
3. Create `YamlHeadlineCacheStore` in `1_adapters/persistence/yaml/`
4. Create `RssHeadlineHarvester` in `1_adapters/feed/`
5. Create `FreshRSSFeedAdapter` in `1_adapters/feed/` (wraps proxy for structured data)
6. Create `HeadlineService` in `3_applications/feed/services/`
7. Create `HeadlineHarvestJob` and register in TaskRegistry
8. Wire in bootstrap.mjs

### Phase 2: API Layer
9. Create `feed.mjs` router with reader proxy endpoints
10. Add headlines endpoints (cached data serving)
11. Add scroll endpoints (merged chronological feed)
12. Add config endpoints
13. Mount router in app.mjs

### Phase 3: Frontend
14. Create `FeedApp.jsx` shell with tab navigation and sub-routes
15. Add route in `main.jsx`
16. Build Reader view (three-pane FreshRSS UI)
17. Build Headlines view (source panel grid)
18. Build Scroll view (infinite scroll cards)

### Phase 4: Polish
19. Headline desc truncation and fallback logic
20. Reader article styling (sanitized HTML rendering)
21. Scroll card thumbnails (extract from RSS media/enclosure)
22. Manual harvest trigger from Headlines view
23. Error states and loading skeletons

---

## Future: Boonscrolling Integration

The Scroll view is designed as a skeleton for the full boonscrolling experience described in `2026-01-30-boonscrolling-feed-design.md`. Future additions:

- Grounding content injection (photos, entropy, todos)
- Time-decay algorithm (more grounding the longer you scroll)
- Interactive feed items (buttons, ratings, text input)
- Session tracking and time warnings
- Nostr integration (social layer)
- Content bridging (comment on external content via Nostr)

These plug into the existing scroll endpoint — the frontend `ScrollCard` component just needs additional card types for grounding content.

---

## Cross-References

| Topic | Document |
|-------|----------|
| Boonscrolling full design | `docs/_wip/plans/2026-01-30-boonscrolling-feed-design.md` |
| Backend architecture | `docs/reference/core/backend-architecture.md` |
| FreshRSS proxy adapter | `backend/src/1_adapters/proxy/FreshRSSProxyAdapter.mjs` |
| Services config | `data/system/config/services.yml` |
