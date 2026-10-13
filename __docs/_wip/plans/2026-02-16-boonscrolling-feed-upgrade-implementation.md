# Boonscrolling Feed Upgrade — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the Feed app's Scroll view from news-only to a unified mixed-content boonscrolling feed with photos, health, tasks, weather, gratitude, entropy alerts, and fitness activities — all driven by YAML query configs.

**Design Doc:** `__docs/_wip/plans/2026-02-16-boonscrolling-feed-upgrade-design.md`

**Tech Stack:** Express, DataService for YAML I/O, existing adapters (Immich, FreshRSS, Entropy, etc.), React + custom SCSS for frontend.

---

## Task 1: Create Query YAML Configs

**Files:**
- Create: `data/household/config/lists/queries/news.yml`
- Create: `data/household/config/lists/queries/headlines.yml`
- Create: `data/household/config/lists/queries/photos.yml`
- Create: `data/household/config/lists/queries/entropy.yml`
- Create: `data/household/config/lists/queries/health.yml`
- Create: `data/household/config/lists/queries/weather.yml`
- Create: `data/household/config/lists/queries/gratitude.yml`
- Create: `data/household/config/lists/queries/fitness.yml`
- Create: `data/household/config/lists/queries/tasks.yml`

**What:** Create all 9 query YAML files as defined in the design doc. Each file defines a content source type, feed classification (external/grounding), priority, limit, and source-specific params.

**Acceptance:** Each file is valid YAML with at minimum `type` and `feed_type` fields.

---

## Task 2: Create FeedAssemblyService

**Files:**
- Create: `__backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Test: `tests/isolated/application/feed/FeedAssemblyService.test.mjs`

**Step 1: Write the failing test**

Test that FeedAssemblyService:
- Loads query configs from DataService
- Calls source handlers for each query
- Normalizes results to FeedItem shape (`{ id, type, source, title, body, image, link, timestamp, priority, meta }`)
- Separates external vs grounding items
- Sorts external by timestamp desc, grounding by priority desc
- Interleaves at the correct ratio (1-in-5 for 0 session minutes)
- Returns `{ items, hasMore }`

Use mock source handlers that return canned data. Test with a mix of external and grounding items.

**Step 2: Implement FeedAssemblyService**

Constructor takes:
```javascript
constructor({
  dataService,          // for reading query YAMLs
  configService,        // for resolving paths
  freshRSSAdapter,      // existing
  headlineService,      // existing
  entropyService,       // existing (or null if unavailable)
  contentQueryService,  // existing (for Immich queries)
  logger
})
```

Core methods:
- `async getNextBatch(username, { limit, cursor, sessionStartedAt })` — main entry point
- `#loadQueries()` — reads all YAML files from `config/lists/queries/` via DataService
- `#fetchSource(query, username)` — dispatches to the right handler based on `query.type`
- `#normalizeToFeedItem(rawItem, query)` — maps adapter-specific shapes to FeedItem
- `#calculateGroundingRatio(sessionMinutes)` — `max(2, floor(5 * 0.85^(min/5)))`
- `#interleave(external, grounding, ratio)` — insert grounding every N external items

Source handler dispatch (inside `#fetchSource`):
- `freshrss` → `freshRSSAdapter.getItems('user/-/state/com.google/reading-list', username, { excludeRead: true, count: query.limit })`
- `headlines` → `headlineService.getAllHeadlines(username)` then flatten
- `immich` → `contentQueryService.search({ text: '', source: 'immich', take: query.limit, sort: 'random' })` (if available)
- `entropy` → `entropyService.getReport(username)` then filter yellow/red
- `health` → Read lifelog health data via DataService
- `weather` → Read lifelog weather data via DataService
- `gratitude` → Read gratitude selections via DataService
- `lifelog` → Read lifelog source data (strava/todoist) via DataService

Each handler wraps results in try/catch — failed sources are logged and skipped (graceful degradation, like the current scroll endpoint does with Promise.allSettled).

**Step 3: Verify test passes**

---

## Task 3: Wire FeedAssemblyService into Bootstrap

**Files:**
- Edit: `__backend/src/0_system/bootstrap.mjs` — add FeedAssemblyService creation in `createFeedServices()`
- Edit: `__backend/src/app.mjs` — pass additional dependencies

**What:**

In `createFeedServices()`, create FeedAssemblyService alongside existing services:

```javascript
const feedAssemblyService = new FeedAssemblyService({
  dataService,
  configService,
  freshRSSAdapter,
  headlineService,
  entropyService: null,  // wired from app.mjs if available
  contentQueryService: null,  // wired from app.mjs if available
  logger,
});
```

Return it in the feedServices object so the router can use it.

In `app.mjs`, pass `entropyService` and `contentQueryService` references into feedServices creation. These may be null if not configured — FeedAssemblyService handles gracefully.

**Acceptance:** FeedAssemblyService is created at boot time and available to the feed router.

---

## Task 4: Update Scroll API Endpoint

**Files:**
- Edit: `__backend/src/4_api/v1/routers/feed.mjs` — replace scroll endpoint implementation

**What:**

Replace the current inline scroll logic (the Promise.allSettled merge of FreshRSS + headlines) with a call to `feedAssemblyService.getNextBatch()`:

```javascript
router.get('/scroll', asyncHandler(async (req, res) => {
  const { cursor, limit = 15, session } = req.query;
  const username = getUsername();

  const result = await feedAssemblyService.getNextBatch(username, {
    limit: Number(limit),
    cursor,
    sessionStartedAt: session || null,
  });

  res.json(result);
}));
```

The response shape stays compatible: `{ items: [...], hasMore: boolean }`. Items now include all content types, not just news.

**Acceptance:** `GET /api/v1/feed/scroll` returns mixed content (news + grounding items). Existing Reader/Headlines endpoints unchanged.

---

## Task 5: Scroll Frontend — Card Components

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/cards/ArticleCard.jsx`
- Create: `frontend/src/modules/Feed/Scroll/cards/HeadlineCard.jsx`
- Create: `frontend/src/modules/Feed/Scroll/cards/PhotoCard.jsx`
- Create: `frontend/src/modules/Feed/Scroll/cards/EntropyCard.jsx`
- Create: `frontend/src/modules/Feed/Scroll/cards/HealthCard.jsx`
- Create: `frontend/src/modules/Feed/Scroll/cards/WeatherCard.jsx`
- Create: `frontend/src/modules/Feed/Scroll/cards/GratitudeCard.jsx`
- Create: `frontend/src/modules/Feed/Scroll/cards/FitnessCard.jsx`
- Create: `frontend/src/modules/Feed/Scroll/cards/TaskCard.jsx`
- Create: `frontend/src/modules/Feed/Scroll/cards/index.jsx` (card registry)

**What:**

Create card components for each content type. Each receives `{ item }` prop with the FeedItem shape. Design direction: social-media-style immersive cards on dark background.

**Card registry** (`index.jsx`):
```jsx
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
  const Card = CARD_MAP[item.source] || HeadlineCard;
  return <Card key={item.id} item={item} />;
}
```

**Key visual treatments:**
- **ArticleCard:** Large title, source pill with relative time, optional hero image, 2-line body excerpt, click opens link
- **PhotoCard:** Full-bleed image (edge-to-edge), text overlay on gradient scrim at bottom ("2 years ago"), people/location tags
- **EntropyCard:** Colored status dot (🔴🟡🟢), source name, "X days since last update"
- **HealthCard:** Compact metric row — weight, activity minutes, heart rate
- **WeatherCard:** Temperature + conditions text, subtle gradient background
- **GratitudeCard:** Centered italic text on warm amber-toned background
- **FitnessCard:** Activity type icon, distance, duration, avg HR
- **TaskCard:** Task title bold, project label muted, overdue badge if applicable
- **HeadlineCard:** Source-colored left border, title, 1-line desc

All grounding cards get a subtle warm left accent (amber/gold border-left) to visually distinguish from external content.

**Acceptance:** Each card renders correctly with sample data. Card registry dispatches to correct component.

---

## Task 6: Scroll Frontend — Container Redesign

**Files:**
- Edit: `frontend/src/modules/Feed/Scroll/Scroll.jsx` — rewrite with session timer and card registry
- Edit: `frontend/src/modules/Feed/Scroll/Scroll.scss` — dark theme, immersive layout
- Delete: `frontend/src/modules/Feed/Scroll/ScrollCard.jsx` — replaced by card components

**What:**

Rewrite Scroll.jsx:
- Track session start time in state (set on mount, passed as `session` query param)
- Use `renderFeedCard()` from card registry instead of `<ScrollCard>`
- Keep IntersectionObserver infinite scroll logic
- Dark background (#1a1b1e), max-width 540px centered
- Cards: 12px border-radius, subtle box-shadow, 12px vertical gap
- Remove old ScrollCard component

Rewrite Scroll.scss:
- Dark theme by default
- Card container styling (padding, border-radius, shadows)
- Photo card special treatment (no inner padding, full-bleed)
- Source pill styling (small colored badges)
- Grounding card accent (amber/gold left border)
- Smooth scroll, loading skeleton at bottom

**Acceptance:** Scroll view renders mixed content with correct card types. Infinite scroll works. Dark theme applied. Session time tracked.

---

## Task 7: Update Default Route

**Files:**
- Edit: `frontend/src/Apps/FeedApp.jsx` — change default redirect from `/feed/headlines` to `/feed/scroll`

**What:** Change the index route redirect so `/feed` goes to `/feed/scroll` instead of `/feed/headlines`. The scroll view is now the primary experience.

```jsx
<Route index element={<Navigate to="/feed/scroll" replace />} />
```

**Acceptance:** Navigating to `/feed` lands on the scroll view.

---

## Task 8: Integration Test

**Files:**
- Test via curl/browser

**What:** End-to-end verification:

1. Start dev server
2. Hit `GET /api/v1/feed/scroll?limit=10` — verify response includes items from multiple sources (news, photos, entropy, etc.)
3. Hit `GET /api/v1/feed/scroll?limit=10&session=<10-minutes-ago>` — verify grounding ratio increases
4. Load `/feed` in browser — verify:
   - Scroll view loads as default
   - Mixed content cards render (article cards, photo cards, entropy alerts, etc.)
   - Infinite scroll loads more items
   - Reader and Headlines tabs still work
5. Sources that are unavailable (e.g., Immich down) don't crash the feed — they're silently skipped

**Acceptance:** All 5 checks pass. No regressions to Reader or Headlines views.

---

## Task Order and Dependencies

```
Task 1 (Query YAMLs)           — no dependencies
Task 2 (FeedAssemblyService)   — needs Task 1 for query config format
Task 3 (Bootstrap wiring)      — needs Task 2
Task 4 (API endpoint update)   — needs Task 3
Task 5 (Card components)       — no dependencies (can parallel with 2-4)
Task 6 (Scroll container)      — needs Task 5 for card registry
Task 7 (Default route)         — needs Task 6
Task 8 (Integration test)      — needs all above
```

**Parallelizable:** Tasks 1+5 can run in parallel. Tasks 2-4 are sequential. Task 5 can start before backend is done.
