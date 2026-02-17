# Boonscrolling Feed Upgrade Design

> Upgrade the Feed app from news-only to a unified mixed-content feed with grounding injection

**Last Updated:** 2026-02-16
**Status:** Design Complete, Ready for Implementation
**Depends on:** `2026-02-15-feed-app-design.md` (Phase 1, already built)

---

## Overview

The existing Feed app has three views: Reader (FreshRSS proxy), Headlines (cached RSS), and Scroll (merged news). This upgrade transforms the Scroll view into a full boonscrolling experience that mixes external content (news) with grounding content (photos, health, tasks, weather, gratitude, entropy alerts, fitness) using configurable query YAMLs.

### What Changes

| Component | Before | After |
|-----------|--------|-------|
| Scroll data | FreshRSS + headlines only | All content sources via query YAMLs |
| Scroll UI | Basic text cards | Social-media-style immersive cards per content type |
| Backend | Ad-hoc merge in router | FeedAssemblyService with source handlers |
| Config | Hardcoded sources | YAML query definitions in `config/lists/queries/` |
| Default route | `/feed/headlines` | `/feed/scroll` |

### What Stays the Same

- Reader view (FreshRSS proxy) — unchanged
- Headlines view (cached RSS grid) — unchanged
- All existing API endpoints — unchanged
- FreshRSSFeedAdapter, HeadlineService — unchanged

---

## Architecture

### Content Pipeline

```
Query YAMLs (config/lists/queries/)     Existing Adapters/Services
  ├── news.yml                          ├── FreshRSSFeedAdapter
  ├── headlines.yml                     ├── HeadlineService
  ├── photos.yml                        ├── ImmichAdapter (via ContentQueryService)
  ├── entropy.yml                       ├── EntropyService
  ├── health.yml                        ├── AggregateHealthUseCase
  ├── weather.yml                       ├── Lifelog weather data
  ├── gratitude.yml                     ├── GratitudeHouseholdService
  ├── fitness.yml                       ├── Lifelog Strava data
  └── tasks.yml                         └── Lifelog Todoist data
         │                                       │
         └──────────────┬────────────────────────┘
                        ▼
              FeedAssemblyService
              ├── Loads query configs
              ├── Fans out to source handlers (parallel)
              ├── Normalizes all results to FeedItem shape
              ├── Separates external vs grounding
              ├── Calculates grounding ratio (time decay)
              ├── Interleaves external + grounding
              ├── Deduplicates
              └── Returns paginated items[]
                        │
                        ▼
              GET /api/v1/feed/scroll
              (replaces current ad-hoc merge)
```

### DDD Layer Placement

```
backend/src/
├── 3_applications/feed/
│   └── services/
│       ├── HeadlineService.mjs          (exists — unchanged)
│       └── FeedAssemblyService.mjs      (NEW — orchestrates all sources)
│
└── 4_api/v1/routers/
    └── feed.mjs                         (exists — scroll endpoint updated)
```

FeedAssemblyService lives in the application layer because it orchestrates multiple adapters/services. No new domain entities needed — we use plain FeedItem objects (not class instances).

---

## Data Model

### FeedItem (plain object shape)

```javascript
{
  id: 'immich:abc-123',           // source:localId — unique across all sources
  type: 'grounding',              // 'external' | 'grounding'
  source: 'photo',                // source identifier for card rendering
  title: '2 years ago',           // headline text
  body: null,                     // optional longer text (excerpt, description)
  image: '/api/v1/proxy/immich/assets/abc-123/thumbnail',  // image URL or null
  link: null,                     // external click-through URL or null
  timestamp: '2024-02-16T...',    // ISO string, used for chronological sort
  priority: 5,                    // grounding sort priority (higher = more important)
  meta: {                         // source-specific rendering hints
    people: ['Alice', 'Bob'],
    location: 'Seattle',
    yearsAgo: 2,
  },
}
```

### Query YAML Format

Each file in `config/lists/queries/` defines one content source:

```yaml
# Required
type: immich          # maps to source handler in FeedAssemblyService

# Feed classification
feed_type: grounding  # 'external' or 'grounding' — determines interleaving
priority: 5           # sort priority within grounding items (higher = shown sooner)

# Limits
limit: 3              # max items to fetch per batch

# Source-specific parameters
params:
  random: true
  preferMemories: true
```

### Source Handler Registry

| Query `type` | Source Handler | Adapter/Service Used |
|-------------|---------------|---------------------|
| `freshrss` | FreshRSS unread articles | `FreshRSSFeedAdapter.getItems()` |
| `headlines` | Cached RSS headlines | `HeadlineService.getAllHeadlines()` |
| `immich` | Random/memory photos | Immich proxy for thumbnails |
| `entropy` | Data freshness alerts | `EntropyService.getReport()` |
| `health` | Daily health summary | `AggregateHealthUseCase.execute()` |
| `weather` | Current conditions | Lifelog weather data (DataService) |
| `gratitude` | Random past entries | DataService reads gratitude selections |
| `lifelog` | Strava/Todoist/etc | DataService reads lifelog YAML files |

---

## Algorithm

### Grounding Ratio (Time Decay)

The feed interleaves external content (news, articles) with grounding content (photos, health, tasks). The ratio shifts over time:

| Session Duration | Grounding Ratio | Effect |
|-----------------|----------------|--------|
| 0–5 minutes | 1 in 5 (20%) | Light grounding |
| 5–10 minutes | 1 in 4 (25%) | Moderate |
| 10–20 minutes | 1 in 3 (33%) | Noticeable |
| 20+ minutes | 1 in 2 (50%) | Heavy grounding |

Formula: `ratio = max(2, floor(5 * 0.85^(minutes/5)))`

The session start time is passed as a query param from the frontend. No server-side session state needed for Phase 1.

### Interleaving

```
external[0]  external[1]  external[2]  external[3]  GROUNDING[0]
external[4]  external[5]  external[6]  external[7]  GROUNDING[1]
...
```

Grounding items are sorted by priority descending (entropy alerts before weather). External items sorted by timestamp descending (newest first).

---

## API Changes

### Updated Scroll Endpoint

```
GET /api/v1/feed/scroll?limit=15&cursor=X&session=<ISO-timestamp>
```

**New param:** `session` — ISO timestamp of when the user started scrolling. Used for grounding ratio calculation. If omitted, defaults to now (no time decay).

**Response shape** (unchanged):
```json
{
  "items": [
    {
      "id": "freshrss:tag:google.com,...",
      "type": "external",
      "source": "freshrss",
      "title": "Article title",
      "body": "First 200 chars...",
      "image": null,
      "link": "https://example.com/article",
      "timestamp": "2026-02-16T10:00:00Z",
      "priority": 0,
      "meta": { "feedTitle": "CNN", "author": "John" }
    },
    {
      "id": "immich:abc-123",
      "type": "grounding",
      "source": "photo",
      "title": "2 years ago",
      "body": null,
      "image": "/api/v1/proxy/immich/assets/abc-123/thumbnail",
      "link": null,
      "timestamp": "2024-02-16T14:30:00Z",
      "priority": 5,
      "meta": { "yearsAgo": 2, "location": "Seattle" }
    }
  ],
  "hasMore": true
}
```

---

## Frontend: Scroll View Redesign

### Design Direction: Social Media Scroll

Instagram/Twitter-style immersive cards. Full-bleed photos, large type, source-colored pills, dark background.

### Card Types

| Source | Card Component | Visual |
|--------|---------------|--------|
| `freshrss` | ArticleCard | Hero image (if available), large title, source pill, 2-line excerpt |
| `headline` | HeadlineCard | Compact text, source accent border, title + desc |
| `photo` | PhotoCard | Full-bleed image, overlay text on gradient scrim, people/location tags |
| `entropy` | EntropyCard | Colored status dot (red/yellow/green), source name, days stale |
| `health` | HealthCard | Metric numbers (weight, activity), compact row |
| `weather` | WeatherCard | Temperature, conditions, gradient background |
| `gratitude` | GratitudeCard | Centered italic text, warm background |
| `fitness` | FitnessCard | Activity type, distance/duration/HR stats |
| `tasks` | TaskCard | Task title, project label, overdue indicator |

### Layout

- Container: max-width 540px, centered, dark background (#1a1b1e)
- Cards: 12px border-radius, subtle shadow, 12px gap between cards
- Photo cards: full-width within column, no inner padding
- Text cards: 16px inner padding
- Source pills: small colored badges (per-source accent color)
- Grounding cards: subtle amber/gold left accent to distinguish from external

### Component Structure

```
frontend/src/modules/Feed/Scroll/
  ├── Scroll.jsx              (container, infinite scroll logic, session timer)
  ├── Scroll.scss             (dark theme, card layout)
  ├── cards/
  │   ├── ArticleCard.jsx     (RSS articles with optional hero image)
  │   ├── HeadlineCard.jsx    (compact headline)
  │   ├── PhotoCard.jsx       (full-bleed Immich photo)
  │   ├── EntropyCard.jsx     (data freshness alert)
  │   ├── HealthCard.jsx      (daily health metrics)
  │   ├── WeatherCard.jsx     (current conditions)
  │   ├── GratitudeCard.jsx   (past gratitude entry)
  │   ├── FitnessCard.jsx     (Strava activity)
  │   ├── TaskCard.jsx        (Todoist task)
  │   └── index.jsx           (card registry: source → component)
  └── Scroll.scss
```

### Card Registry

```javascript
// cards/index.jsx
const CARD_MAP = {
  freshrss: ArticleCard,
  headline: HeadlineCard,
  photo: PhotoCard,
  entropy: EntropyCard,
  health: HealthCard,
  weather: WeatherCard,
  gratitude: GratitudeCard,
  fitness: FitnessCard,
  tasks: TaskCard,
};

export function renderFeedCard(item) {
  const Card = CARD_MAP[item.source] || HeadlineCard; // fallback
  return <Card key={item.id} item={item} />;
}
```

---

## Query YAML Definitions

These go in `/data/household/config/lists/queries/`:

### news.yml
```yaml
type: freshrss
feed_type: external
limit: 20
params:
  excludeRead: true
```

### headlines.yml
```yaml
type: headlines
feed_type: external
limit: 30
```

### photos.yml
```yaml
type: immich
feed_type: grounding
priority: 5
limit: 3
params:
  random: true
  preferMemories: true
```

### entropy.yml
```yaml
type: entropy
feed_type: grounding
priority: 20
params:
  onlyYellowRed: true
```

### health.yml
```yaml
type: health
feed_type: grounding
priority: 15
```

### weather.yml
```yaml
type: weather
feed_type: grounding
priority: 3
```

### gratitude.yml
```yaml
type: gratitude
feed_type: grounding
priority: 5
limit: 1
```

### fitness.yml
```yaml
type: lifelog
feed_type: grounding
priority: 10
params:
  source: strava
  daysBack: 3
```

### tasks.yml
```yaml
type: lifelog
feed_type: grounding
priority: 25
params:
  source: todoist
  filter: overdue_or_due_today
```

---

## Cross-References

| Topic | Document |
|-------|----------|
| Original boonscrolling vision | `docs/_wip/plans/2026-01-30-boonscrolling-feed-design.md` |
| Phase 1 feed app (already built) | `docs/_wip/plans/2026-02-15-feed-app-design.md` |
| Backend architecture | `docs/reference/core/backend-architecture.md` |
| Content query service | `backend/src/3_applications/content/ContentQueryService.mjs` |
