# Health Dashboard API & Nutrition Input

## Problem

The health backend is mature (aggregation, nutrition CRUD, weight processing, coaching agent, entropy tracking, life plan goals) but the API surface is fragmented — weight, nutrition, fitness sessions, coaching, and mental health indicators are served by separate routers with no unified view. Additionally, nutrition input only works through Telegram (nutribot), and there's no food catalog for quick-add of common items.

## Requirements

### Dashboard API
1. **Unified dashboard endpoint** — `GET /health/dashboard` returns today's snapshot, recency tracker, fitness goals, and tiered history in one call.
2. **Today's snapshot** — weight, nutrition (with items), fitness sessions, coaching messages.
3. **Recency tracker** — leverages existing entropy service to show days-since-last-activity per self-care category (weigh-in, journal, gratitude, fitness, voice memo, nutrition). Leading indicator for mental health.
4. **Fitness goals** — active goals from life plan with current/target metrics.
5. **Tiered history** — last 90 days daily, 91-180 days weekly aggregates, 181-730 days monthly aggregates.
6. **Individual endpoints remain** — `/health/weight`, `/health/nutrition`, etc. for drill-down.

### Direct Nutrition Input
7. **Web nutrition input** — bot-like interaction from `/health` UI, bypassing Telegram. Reuses existing NutribotInputRouter and use cases (LogFoodFromText, LogFoodFromVoice, LogFoodFromPhoto, etc.).
8. **Same pipeline** — AI parsing, Nutritionix lookup, nutrilist persistence all reused. Only the transport changes.

### Food Catalog
9. **New data model** — FoodCatalogEntry entity tracking common/recent foods with nutrient data and usage frequency.
10. **Passive population** — every food log (Telegram or web) checks catalog, creates or increments entry.
11. **Quick-add** — log a catalog entry without re-parsing.
12. **Search + recent** — query catalog by name or recency.
13. **Backfill** — seed catalog from existing nutriday data.

## Design

### 1. Application Layer — HealthDashboardUseCase

**File:** `backend/src/3_applications/health/HealthDashboardUseCase.mjs`

Orchestrates existing services — no new domain logic, no direct adapter calls. Injected dependencies:

| Dependency | Source | Purpose |
|-----------|--------|---------|
| `AggregateHealthUseCase` | `3_applications/health/` | Today's metrics + historical daily data |
| `SessionService` | `3_applications/fitness/` | Today's fitness sessions |
| `EntropyService` | `3_applications/entropy/` | Recency tracker (days-since per source) |
| `LifePlanService` | `3_applications/lifeplan/` | Active fitness goals |
| `IHealthDataDatastore` | Port | Coaching messages |
| `HistoryAggregator` | `2_domains/health/` | Daily-to-weekly-to-monthly rollup |

**Single method:** `async execute(userId)` returns the full dashboard response shape.

Flow:
1. Load today's date
2. In parallel: fetch today's health metrics, today's sessions, entropy report, active goals, coaching messages, historical data (730 days)
3. Pass historical data through HistoryAggregator for tiered rollup
4. Assemble and return

### 2. Domain Layer — HistoryAggregator

**File:** `backend/src/2_domains/health/services/HistoryAggregator.mjs`

Pure domain service. No I/O, no dependencies. Takes an array of daily HealthMetric entries, returns three tiers.

**Input:** Array of `{ date, weight, nutrition, workouts, sessions }` entries sorted by date descending.

**Output:**
```javascript
{
  daily: [...],    // last 90 days — pass-through
  weekly: [...],   // days 91-180 — grouped by ISO week
  monthly: [...]   // days 181-730 — grouped by YYYY-MM
}
```

**Aggregation rules:**
- Weight: average of non-null values in bucket
- Nutrition calories: daily average
- Workouts: count (sum), totalMinutes (sum), totalCalories (sum)
- Sessions: count (sum), totalCoins (sum)

**Bucket entry shape:** `{ period: "2026-W04" | "2026-01", startDate, endDate, weight, nutrition, workouts, sessions }`

### 3. API Layer — Dashboard Endpoint

**File:** Modify `backend/src/4_api/v1/routers/health.mjs`

**New endpoint:** `GET /api/v1/health/dashboard`

Query params: `?userId=kckern` (optional, defaults to primary user)

**Response shape:**
```javascript
{
  today: {
    date: "2026-04-03",
    weight: { lbs, trend, fatPercent },
    nutrition: { calories, protein, carbs, fat, items: [...] },
    sessions: [{ sessionId, title, duration, coins, participants }],
    coaching: [{ message, assignment, timestamp }]
  },
  recency: [
    { source: "weight", name: "Weigh-in", lastUpdate: "2026-04-03", daysSince: 0, status: "green" },
    { source: "journal", name: "Journal", lastUpdate: "2026-03-30", daysSince: 4, status: "yellow" },
    ...
  ],
  goals: [
    { id, name, state, metrics: [{ current, target }], deadline }
  ],
  history: {
    daily: [...],
    weekly: [...],
    monthly: [...]
  }
}
```

### 4. Direct Nutrition Input — WebNutribotAdapter

**File:** `backend/src/1_adapters/nutribot/WebNutribotAdapter.mjs`

Adapts HTTP request/response to the same interface TelegramAdapter provides to NutribotInputRouter. Responsibilities:

- Accept structured input: `{ type, content }` or multipart for voice/photo
- Create a conversation context (non-Telegram) with a conversation ID like `web:{userId}_{timestamp}`
- Pass to `NutribotInputRouter.route()` with the same message shape the router expects
- Collect the response (parsed food items, nutrients) and return as JSON instead of sending a Telegram message

**Key difference from TelegramAdapter:** No message sending, no callback queries, no inline keyboards. The response goes directly back to the HTTP caller.

### 5. API Layer — Nutrition Input Endpoint

**File:** Modify `backend/src/4_api/v1/routers/health.mjs`

**New endpoint:** `POST /api/v1/health/nutrition/input`

```javascript
// Request (JSON for text/barcode)
{ type: "text", content: "2 eggs and toast with butter" }
{ type: "barcode", content: "012345678901" }

// Request (multipart for voice/photo)
// form field "type" = "voice" | "photo"
// form field "file" = binary

// Response
{
  items: [
    { name: "Eggs", qty: 2, calories: 140, protein: 12, carbs: 1, fat: 10 },
    { name: "Toast with butter", qty: 1, calories: 180, protein: 3, carbs: 24, fat: 8 }
  ],
  totalCalories: 320,
  logged: true
}
```

### 6. Domain Layer — FoodCatalogEntry Entity

**File:** `backend/src/2_domains/health/entities/FoodCatalogEntry.mjs`

```javascript
{
  id: string,              // UUID
  name: string,            // "2 eggs and toast with butter"
  normalizedName: string,  // lowercase trimmed — for dedup/search
  nutrients: { calories, protein, carbs, fat },
  source: "manual" | "nutritionix" | "barcode",
  barcodeUpc: string | null,
  useCount: number,        // incremented each time logged
  lastUsed: ISO date,      // updated each time logged
  createdAt: ISO timestamp
}
```

### 7. Persistence — YamlFoodCatalogDatastore

**File:** `backend/src/1_adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs`

**Storage path:** `data/users/{username}/lifelog/nutrition/food_catalog.yml`

**Port:** `backend/src/3_applications/health/ports/IFoodCatalogDatastore.mjs`

Methods:
- `findByNormalizedName(name, userId)` — exact match for dedup
- `search(query, userId, limit)` — substring match, sorted by useCount desc
- `getRecent(userId, limit)` — sorted by lastUsed desc
- `save(entry, userId)` — create or update
- `getById(id, userId)` — single entry lookup
- `getAll(userId)` — full catalog (for backfill checks)

### 8. Application Layer — FoodCatalogService

**File:** `backend/src/3_applications/health/FoodCatalogService.mjs`

Orchestrates catalog operations:
- `recordUsage(foodItem, userId)` — called after every successful food log. Normalizes name, finds or creates catalog entry, increments useCount, updates lastUsed.
- `quickAdd(catalogEntryId, userId)` — loads entry, logs it via nutrilist, records usage.
- `search(query, userId, limit)` — delegates to datastore.
- `getRecent(userId, limit)` — delegates to datastore.
- `backfill(userId, daysBack)` — reads nutrilist entries for the last N days, calls `recordUsage` for each item.

### 9. API Layer — Catalog Endpoints

**File:** Modify `backend/src/4_api/v1/routers/health.mjs`

```
GET  /api/v1/health/nutrition/catalog?q=eggs&limit=10
  → Search by name, sorted by useCount desc

GET  /api/v1/health/nutrition/catalog/recent?limit=10
  → Sorted by lastUsed desc

POST /api/v1/health/nutrition/catalog/quickadd
  → { catalogEntryId: "uuid" } — logs entry for today

POST /api/v1/health/nutrition/catalog/backfill
  → { daysBack: 90 } — seeds catalog from existing nutriday data
```

### 10. Integration — Passive Catalog Population

After every successful food log (in both the Telegram and web pipelines), call `FoodCatalogService.recordUsage()`. This happens in the nutribot use cases (LogFoodFromText, LogFoodFromVoice, etc.) — add a catalog recording step at the end of each use case's `execute()` method.

## Files Summary

| Layer | File | Action | Purpose |
|-------|------|--------|---------|
| Domain | `2_domains/health/services/HistoryAggregator.mjs` | Create | Daily→weekly→monthly rollup |
| Domain | `2_domains/health/entities/FoodCatalogEntry.mjs` | Create | Food catalog entity |
| Application | `3_applications/health/HealthDashboardUseCase.mjs` | Create | Dashboard orchestration |
| Application | `3_applications/health/FoodCatalogService.mjs` | Create | Catalog CRUD + backfill |
| Application | `3_applications/health/ports/IFoodCatalogDatastore.mjs` | Create | Catalog port |
| Adapter | `1_adapters/nutribot/WebNutribotAdapter.mjs` | Create | Web transport for nutrition input |
| Adapter | `1_adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs` | Create | Catalog YAML persistence |
| API | `4_api/v1/routers/health.mjs` | Modify | Add dashboard, input, catalog endpoints |
| Application | `3_applications/nutribot/usecases/LogFoodFromText.mjs` | Modify | Add catalog recording after log |
| Application | `3_applications/nutribot/usecases/LogFoodFromVoice.mjs` | Modify | Add catalog recording after log |
| Application | `3_applications/nutribot/usecases/LogFoodFromImage.mjs` | Modify | Add catalog recording after log |
| Application | `3_applications/nutribot/usecases/LogFoodFromUPC.mjs` | Modify | Add catalog recording after log |
