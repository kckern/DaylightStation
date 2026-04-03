# Health Dashboard API & Nutrition Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified health dashboard API, direct nutrition input from the web UI, and a food catalog for quick-add — all following DDD with clean orchestration and no abstraction leakage.

**Architecture:** Three groups: (1) HistoryAggregator domain service + HealthDashboardUseCase application service + dashboard API endpoint, (2) WebNutribotAdapter + nutrition input API endpoint, (3) FoodCatalogEntry entity + FoodCatalogService + catalog persistence + catalog API endpoints + passive population + backfill. Each group is independently testable and builds on existing services.

**Tech Stack:** Express.js, YAML persistence via DataService, moment.js for dates, existing NutribotInputRouter, existing EntropyService/SessionService/LifePlan services.

**Spec:** `docs/superpowers/specs/2026-04-03-health-dashboard-api-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/2_domains/health/services/HistoryAggregator.mjs` | Create | Pure domain: daily→weekly→monthly rollup |
| `backend/src/2_domains/health/entities/FoodCatalogEntry.mjs` | Create | Food catalog entity |
| `backend/src/3_applications/health/HealthDashboardUseCase.mjs` | Create | Dashboard orchestration |
| `backend/src/3_applications/health/FoodCatalogService.mjs` | Create | Catalog CRUD, backfill, recording |
| `backend/src/3_applications/health/ports/IFoodCatalogDatastore.mjs` | Create | Catalog port interface |
| `backend/src/1_adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs` | Create | Catalog YAML persistence |
| `backend/src/1_adapters/nutribot/WebNutribotAdapter.mjs` | Create | Web transport for nutrition input |
| `backend/src/4_api/v1/routers/health.mjs` | Modify | Add dashboard, input, catalog endpoints |
| `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs` | Modify | Add catalog recording hook |
| `backend/src/3_applications/nutribot/usecases/LogFoodFromVoice.mjs` | Modify | Add catalog recording hook |
| `backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs` | Modify | Add catalog recording hook |
| `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs` | Modify | Add catalog recording hook |

---

### Task 1: HistoryAggregator domain service

**Files:**
- Create: `backend/src/2_domains/health/services/HistoryAggregator.mjs`

- [ ] **Step 1: Create the HistoryAggregator module**

```javascript
/**
 * HistoryAggregator - Pure domain service for rolling up daily health data
 * into weekly and monthly aggregates.
 *
 * No I/O, no dependencies. Takes an array of daily entries, returns tiered buckets.
 */

/**
 * Get ISO week string for a date
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string} e.g. "2026-W14"
 */
function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Get month string for a date
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string} e.g. "2026-01"
 */
function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

/**
 * Average of non-null numeric values
 */
function avg(values) {
  const valid = values.filter(v => v != null && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * Sum of numeric values (null-safe)
 */
function sum(values) {
  return values.reduce((a, b) => a + (b || 0), 0);
}

/**
 * Aggregate a bucket of daily entries into a single summary
 * @param {string} period - Bucket label (e.g., "2026-W14" or "2026-01")
 * @param {Array} entries - Daily entries in the bucket
 * @returns {Object} Aggregated bucket entry
 */
function aggregateBucket(period, entries) {
  if (!entries.length) return null;
  const dates = entries.map(e => e.date).sort();
  return {
    period,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    days: entries.length,
    weight: avg(entries.map(e => e.weight?.lbs)),
    nutrition: {
      calories: avg(entries.map(e => e.nutrition?.calories)),
    },
    workouts: {
      count: sum(entries.map(e => e.workouts?.length || 0)),
      totalMinutes: sum(entries.map(e =>
        (e.workouts || []).reduce((t, w) => t + (w.duration || 0), 0)
      )),
      totalCalories: sum(entries.map(e =>
        (e.workouts || []).reduce((t, w) => t + (w.calories || 0), 0)
      )),
    },
    sessions: {
      count: sum(entries.map(e => e.sessions?.length || 0)),
      totalCoins: sum(entries.map(e =>
        (e.sessions || []).reduce((t, s) => t + (s.totalCoins || 0), 0)
      )),
    },
  };
}

/**
 * Roll up daily health data into tiered history buckets.
 *
 * @param {Array} dailyEntries - Array of daily health metric objects, each with at least { date }
 * @param {Object} [options]
 * @param {number} [options.dailyCutoff=90] - Days for daily tier
 * @param {number} [options.weeklyCutoff=180] - Days for weekly tier
 * @param {number} [options.monthlyCutoff=730] - Days for monthly tier
 * @returns {{ daily: Array, weekly: Array, monthly: Array }}
 */
export function rollUpHistory(dailyEntries, options = {}) {
  const dailyCutoff = options.dailyCutoff ?? 90;
  const weeklyCutoff = options.weeklyCutoff ?? 180;
  const monthlyCutoff = options.monthlyCutoff ?? 730;

  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const daily = [];
  const weeklyBuckets = new Map();
  const monthlyBuckets = new Map();

  for (const entry of dailyEntries) {
    if (!entry?.date) continue;
    const daysAgo = Math.floor((new Date(today + 'T12:00:00Z') - new Date(entry.date + 'T12:00:00Z')) / 86400000);

    if (daysAgo < 0) continue; // future dates
    if (daysAgo <= dailyCutoff) {
      daily.push(entry);
    } else if (daysAgo <= weeklyCutoff) {
      const wk = isoWeek(entry.date);
      if (!weeklyBuckets.has(wk)) weeklyBuckets.set(wk, []);
      weeklyBuckets.get(wk).push(entry);
    } else if (daysAgo <= monthlyCutoff) {
      const mk = monthKey(entry.date);
      if (!monthlyBuckets.has(mk)) monthlyBuckets.set(mk, []);
      monthlyBuckets.get(mk).push(entry);
    }
  }

  const weekly = [];
  for (const [period, entries] of weeklyBuckets) {
    const agg = aggregateBucket(period, entries);
    if (agg) weekly.push(agg);
  }
  weekly.sort((a, b) => b.startDate.localeCompare(a.startDate));

  const monthly = [];
  for (const [period, entries] of monthlyBuckets) {
    const agg = aggregateBucket(period, entries);
    if (agg) monthly.push(agg);
  }
  monthly.sort((a, b) => b.startDate.localeCompare(a.startDate));

  return { daily, weekly, monthly };
}

export default { rollUpHistory };
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/2_domains/health/services/HistoryAggregator.mjs
git commit -m "feat(health): add HistoryAggregator domain service for tiered history rollup"
```

---

### Task 2: HealthDashboardUseCase

**Files:**
- Create: `backend/src/3_applications/health/HealthDashboardUseCase.mjs`

- [ ] **Step 1: Create the use case**

```javascript
/**
 * HealthDashboardUseCase - Orchestrates the unified health dashboard response.
 *
 * Composes existing services: AggregateHealthUseCase, SessionService,
 * EntropyService, LifePlanService, and HistoryAggregator.
 * No direct adapter calls — all I/O through injected ports.
 */

import { rollUpHistory } from '#domains/health/services/HistoryAggregator.mjs';

export class HealthDashboardUseCase {
  #healthService;
  #sessionService;
  #entropyService;
  #lifePlanRepository;
  #healthStore;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.healthService - AggregateHealthUseCase
   * @param {Object} config.sessionService - SessionService (fitness)
   * @param {Object} config.entropyService - EntropyService
   * @param {Object} config.lifePlanRepository - ILifePlanRepository
   * @param {Object} config.healthStore - IHealthDataDatastore
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.healthService) throw new Error('HealthDashboardUseCase requires healthService');
    if (!config.healthStore) throw new Error('HealthDashboardUseCase requires healthStore');

    this.#healthService = config.healthService;
    this.#sessionService = config.sessionService || null;
    this.#entropyService = config.entropyService || null;
    this.#lifePlanRepository = config.lifePlanRepository || null;
    this.#healthStore = config.healthStore;
    this.#logger = config.logger || console;
  }

  /**
   * Build the full dashboard response.
   * @param {string} userId - Username
   * @returns {Promise<Object>} Dashboard data
   */
  async execute(userId) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    this.#logger.debug?.('health.dashboard.start', { userId, today });

    // Load all data in parallel
    const [
      healthData,
      todaySessions,
      entropyReport,
      lifePlan,
      coachingData,
    ] = await Promise.all([
      this.#healthService.execute(userId, 730, now).catch(err => {
        this.#logger.error?.('health.dashboard.healthData.error', { error: err.message });
        return {};
      }),
      this.#loadTodaySessions(today),
      this.#loadEntropy(userId),
      this.#loadGoals(userId),
      this.#healthStore.loadCoachingData(userId).catch(() => ({})),
    ]);

    // Today's snapshot
    const todayMetric = healthData?.[today] || {};
    const todayCoaching = this.#extractTodayCoaching(coachingData, today);

    // Build today section
    const todaySection = {
      date: today,
      weight: todayMetric.weight || null,
      nutrition: todayMetric.nutrition || null,
      sessions: todaySessions,
      coaching: todayCoaching,
    };

    // Recency tracker from entropy
    const recency = entropyReport?.items?.map(item => ({
      source: item.source,
      name: item.name,
      lastUpdate: item.lastUpdate,
      daysSince: item.value,
      status: item.status,
    })) || [];

    // Active fitness goals from life plan
    const goals = this.#extractActiveGoals(lifePlan);

    // Historical tiers
    const allDays = Object.values(healthData || {}).filter(d => d?.date);
    const history = rollUpHistory(allDays);

    this.#logger.debug?.('health.dashboard.complete', {
      userId,
      hasWeight: !!todaySection.weight,
      sessionCount: todaySessions.length,
      recencyCount: recency.length,
      goalCount: goals.length,
      historyDays: history.daily.length,
      historyWeeks: history.weekly.length,
      historyMonths: history.monthly.length,
    });

    return { today: todaySection, recency, goals, history };
  }

  async #loadTodaySessions(today) {
    if (!this.#sessionService) return [];
    try {
      const sessions = await this.#sessionService.listSessionsByDate(today);
      return (sessions || []).map(s => ({
        sessionId: s.sessionId || s.session?.id,
        title: s.media?.primary?.title || null,
        showTitle: s.media?.primary?.showTitle || null,
        durationMs: s.durationMs,
        totalCoins: s.totalCoins || 0,
        participants: s.participants ? Object.keys(s.participants) : [],
      }));
    } catch (err) {
      this.#logger.error?.('health.dashboard.sessions.error', { error: err.message });
      return [];
    }
  }

  async #loadEntropy(userId) {
    if (!this.#entropyService) return { items: [] };
    try {
      return await this.#entropyService.getReport(userId);
    } catch (err) {
      this.#logger.error?.('health.dashboard.entropy.error', { error: err.message });
      return { items: [] };
    }
  }

  async #loadGoals(userId) {
    if (!this.#lifePlanRepository) return null;
    try {
      return await this.#lifePlanRepository.load(userId);
    } catch (err) {
      this.#logger.error?.('health.dashboard.goals.error', { error: err.message });
      return null;
    }
  }

  #extractTodayCoaching(coachingData, today) {
    if (!coachingData || typeof coachingData !== 'object') return [];
    // Coaching data is keyed by date or has entries with date field
    const todayEntries = coachingData[today];
    if (Array.isArray(todayEntries)) return todayEntries;
    if (todayEntries && typeof todayEntries === 'object') return [todayEntries];
    return [];
  }

  #extractActiveGoals(lifePlan) {
    if (!lifePlan) return [];
    // Goals are in lifePlan.goals or lifePlan.goalProgress, filtered by active state
    const goals = lifePlan.goals || lifePlan.goalProgress || [];
    return goals
      .filter(g => g.state === 'committed' || g.state === 'active')
      .map(g => ({
        id: g.id,
        name: g.name,
        state: g.state,
        metrics: g.metrics || [],
        deadline: g.deadline || null,
      }));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/3_applications/health/HealthDashboardUseCase.mjs
git commit -m "feat(health): add HealthDashboardUseCase for unified dashboard orchestration"
```

---

### Task 3: Dashboard API endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/health.mjs`

- [ ] **Step 1: Add dashboard endpoint**

In `health.mjs`, add the dashboard endpoint after the existing `/status` endpoint (around line 237). The `createHealthRouter` factory function needs a new dependency: `dashboardService` (the HealthDashboardUseCase instance).

First, update the destructuring at the top of `createHealthRouter` (line 27):

```javascript
const { healthService, healthStore, configService, nutriListStore, dashboardService, logger = console } = config;
```

Then add the endpoint:

```javascript
  /**
   * GET /api/v1/health/dashboard - Unified health dashboard
   * Query params:
   *   - userId: username (optional, defaults to head of household)
   */
  router.get('/dashboard', asyncHandler(async (req, res) => {
    if (!dashboardService) {
      return res.status(501).json({ error: 'Dashboard service not configured' });
    }
    const userId = req.query.userId || getDefaultUsername();
    logger.debug?.('health.dashboard.request', { userId });

    const dashboard = await dashboardService.execute(userId);
    return res.json(dashboard);
  }));
```

- [ ] **Step 2: Update the `/status` endpoint to include `/dashboard`**

Add `'/dashboard'` to the endpoints array in the status response.

- [ ] **Step 3: Wire the dashboard service in the app bootstrap**

Find where `createHealthRouter` is called (likely in the API mount file) and pass the `dashboardService` instance. This requires reading the bootstrap/wiring code to find the exact location.

Search for `createHealthRouter` in the codebase:

```bash
grep -rn "createHealthRouter" backend/src/
```

Add the HealthDashboardUseCase instantiation alongside the existing health service setup, injecting the available services (sessionService, entropyService, lifePlanRepository, healthStore).

- [ ] **Step 4: Test the endpoint**

```bash
curl -s http://localhost:3111/api/v1/health/dashboard | jq 'keys'
# Expected: ["goals", "history", "recency", "today"]

curl -s http://localhost:3111/api/v1/health/dashboard | jq '.today.date'
# Expected: "2026-04-03" (today's date)

curl -s http://localhost:3111/api/v1/health/dashboard | jq '.history | keys'
# Expected: ["daily", "monthly", "weekly"]
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/health.mjs
git commit -m "feat(health): add GET /dashboard endpoint to health router"
```

---

### Task 4: Wire HealthDashboardUseCase into app bootstrap

**Files:**
- Modify: The file that calls `createHealthRouter` (find via grep)

- [ ] **Step 1: Find the wiring location**

```bash
grep -rn "createHealthRouter" backend/src/
```

Read the file that instantiates and mounts the health router.

- [ ] **Step 2: Import and instantiate HealthDashboardUseCase**

```javascript
import { HealthDashboardUseCase } from '#apps/health/HealthDashboardUseCase.mjs';
```

Instantiate with the services that are already available in the bootstrap context:

```javascript
const dashboardService = new HealthDashboardUseCase({
  healthService,       // AggregateHealthUseCase (already exists)
  sessionService,      // SessionService (from fitness, find in bootstrap)
  entropyService,      // EntropyService (find in bootstrap)
  lifePlanRepository,  // ILifePlanRepository (find in bootstrap)
  healthStore,         // YamlHealthDatastore (already exists)
  logger,
});
```

Pass `dashboardService` to `createHealthRouter({ ..., dashboardService })`.

The exact variable names depend on what's available in the bootstrap scope — read the file to determine correct references.

- [ ] **Step 3: Commit**

```bash
git add backend/src/  # the modified bootstrap file
git commit -m "feat(health): wire HealthDashboardUseCase into app bootstrap"
```

---

### Task 5: FoodCatalogEntry entity

**Files:**
- Create: `backend/src/2_domains/health/entities/FoodCatalogEntry.mjs`

- [ ] **Step 1: Create the entity**

```javascript
/**
 * FoodCatalogEntry - Represents a food item in the user's personal catalog.
 *
 * Built passively from logged foods. Tracks usage frequency for quick-add.
 */

import { randomUUID } from 'crypto';

export class FoodCatalogEntry {
  constructor(data) {
    this.id = data.id || randomUUID();
    this.name = data.name;
    this.normalizedName = data.normalizedName || FoodCatalogEntry.normalize(data.name);
    this.nutrients = data.nutrients || { calories: 0, protein: 0, carbs: 0, fat: 0 };
    this.source = data.source || 'manual';
    this.barcodeUpc = data.barcodeUpc || null;
    this.useCount = data.useCount || 1;
    this.lastUsed = data.lastUsed || new Date().toISOString().split('T')[0];
    this.createdAt = data.createdAt || new Date().toISOString();
  }

  /**
   * Normalize a food name for dedup/search matching.
   * @param {string} name
   * @returns {string}
   */
  static normalize(name) {
    if (!name) return '';
    return name.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Record another usage of this entry.
   */
  recordUsage() {
    this.useCount++;
    this.lastUsed = new Date().toISOString().split('T')[0];
  }

  /**
   * Check if this entry matches a normalized name.
   * @param {string} normalizedName
   * @returns {boolean}
   */
  matches(normalizedName) {
    return this.normalizedName === normalizedName;
  }

  /**
   * Check if this entry's name contains the search query.
   * @param {string} query - Lowercase search string
   * @returns {boolean}
   */
  matchesSearch(query) {
    return this.normalizedName.includes(query.toLowerCase().trim());
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      normalizedName: this.normalizedName,
      nutrients: { ...this.nutrients },
      source: this.source,
      barcodeUpc: this.barcodeUpc,
      useCount: this.useCount,
      lastUsed: this.lastUsed,
      createdAt: this.createdAt,
    };
  }

  static fromJSON(data) {
    return new FoodCatalogEntry(data);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/2_domains/health/entities/FoodCatalogEntry.mjs
git commit -m "feat(health): add FoodCatalogEntry domain entity"
```

---

### Task 6: Food catalog port and persistence

**Files:**
- Create: `backend/src/3_applications/health/ports/IFoodCatalogDatastore.mjs`
- Create: `backend/src/1_adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs`

- [ ] **Step 1: Create the port interface**

```javascript
/**
 * IFoodCatalogDatastore - Port for food catalog persistence.
 */
export class IFoodCatalogDatastore {
  async findByNormalizedName(name, userId) { throw new Error('Not implemented'); }
  async search(query, userId, limit) { throw new Error('Not implemented'); }
  async getRecent(userId, limit) { throw new Error('Not implemented'); }
  async save(entry, userId) { throw new Error('Not implemented'); }
  async getById(id, userId) { throw new Error('Not implemented'); }
  async getAll(userId) { throw new Error('Not implemented'); }
}
```

- [ ] **Step 2: Create the YAML datastore**

```javascript
/**
 * YamlFoodCatalogDatastore - YAML persistence for food catalog.
 *
 * Storage: data/users/{username}/lifelog/nutrition/food_catalog.yml
 * Format: Array of FoodCatalogEntry objects.
 */

import { IFoodCatalogDatastore } from '#apps/health/ports/IFoodCatalogDatastore.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

export class YamlFoodCatalogDatastore extends IFoodCatalogDatastore {
  #dataService;
  #logger;

  static CATALOG_PATH = 'lifelog/nutrition/food_catalog';

  constructor(config) {
    super();
    if (!config.dataService) throw new Error('YamlFoodCatalogDatastore requires dataService');
    this.#dataService = config.dataService;
    this.#logger = config.logger || console;
  }

  async #loadCatalog(userId) {
    const raw = this.#dataService.user.read?.(YamlFoodCatalogDatastore.CATALOG_PATH, userId);
    if (!Array.isArray(raw)) return [];
    return raw.map(item => FoodCatalogEntry.fromJSON(item));
  }

  async #saveCatalog(entries, userId) {
    const data = entries.map(e => e.toJSON());
    this.#dataService.user.write?.(YamlFoodCatalogDatastore.CATALOG_PATH, data, userId);
  }

  async findByNormalizedName(name, userId) {
    const catalog = await this.#loadCatalog(userId);
    const normalized = FoodCatalogEntry.normalize(name);
    return catalog.find(e => e.matches(normalized)) || null;
  }

  async search(query, userId, limit = 10) {
    const catalog = await this.#loadCatalog(userId);
    return catalog
      .filter(e => e.matchesSearch(query))
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, limit);
  }

  async getRecent(userId, limit = 10) {
    const catalog = await this.#loadCatalog(userId);
    return catalog
      .sort((a, b) => b.lastUsed.localeCompare(a.lastUsed))
      .slice(0, limit);
  }

  async save(entry, userId) {
    const catalog = await this.#loadCatalog(userId);
    const idx = catalog.findIndex(e => e.id === entry.id);
    if (idx >= 0) {
      catalog[idx] = entry;
    } else {
      catalog.push(entry);
    }
    await this.#saveCatalog(catalog, userId);
  }

  async getById(id, userId) {
    const catalog = await this.#loadCatalog(userId);
    return catalog.find(e => e.id === id) || null;
  }

  async getAll(userId) {
    return this.#loadCatalog(userId);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/health/ports/IFoodCatalogDatastore.mjs \
       backend/src/1_adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs
git commit -m "feat(health): add food catalog port and YAML datastore"
```

---

### Task 7: FoodCatalogService

**Files:**
- Create: `backend/src/3_applications/health/FoodCatalogService.mjs`

- [ ] **Step 1: Create the service**

```javascript
/**
 * FoodCatalogService - Application service for food catalog operations.
 *
 * Handles recording, search, quick-add, and backfill.
 */

import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

export class FoodCatalogService {
  #catalogStore;
  #nutriListStore;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.catalogStore - IFoodCatalogDatastore
   * @param {Object} [config.nutriListStore] - NutriList store for quick-add and backfill
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.catalogStore) throw new Error('FoodCatalogService requires catalogStore');
    this.#catalogStore = config.catalogStore;
    this.#nutriListStore = config.nutriListStore || null;
    this.#logger = config.logger || console;
  }

  /**
   * Record usage of a food item in the catalog.
   * Called after every successful food log.
   * Finds or creates a catalog entry, increments useCount.
   *
   * @param {Object} foodItem - { name, calories, protein, carbs, fat, source?, barcodeUpc? }
   * @param {string} userId
   */
  async recordUsage(foodItem, userId) {
    if (!foodItem?.name) return;

    const normalized = FoodCatalogEntry.normalize(foodItem.name);
    const existing = await this.#catalogStore.findByNormalizedName(foodItem.name, userId);

    if (existing) {
      existing.recordUsage();
      // Update nutrients if the new data has them (latest wins)
      if (foodItem.calories != null) {
        existing.nutrients = {
          calories: foodItem.calories || existing.nutrients.calories,
          protein: foodItem.protein || existing.nutrients.protein,
          carbs: foodItem.carbs || existing.nutrients.carbs,
          fat: foodItem.fat || existing.nutrients.fat,
        };
      }
      await this.#catalogStore.save(existing, userId);
      this.#logger.debug?.('health.catalog.usage_recorded', { name: foodItem.name, useCount: existing.useCount });
    } else {
      const entry = new FoodCatalogEntry({
        name: foodItem.name,
        nutrients: {
          calories: foodItem.calories || 0,
          protein: foodItem.protein || 0,
          carbs: foodItem.carbs || 0,
          fat: foodItem.fat || 0,
        },
        source: foodItem.source || 'nutritionix',
        barcodeUpc: foodItem.barcodeUpc || null,
      });
      await this.#catalogStore.save(entry, userId);
      this.#logger.debug?.('health.catalog.entry_created', { name: foodItem.name, id: entry.id });
    }
  }

  /**
   * Quick-add a catalog entry as today's food log.
   * @param {string} catalogEntryId
   * @param {string} userId
   * @returns {Promise<Object>} The logged item
   */
  async quickAdd(catalogEntryId, userId) {
    const entry = await this.#catalogStore.getById(catalogEntryId, userId);
    if (!entry) throw new Error(`Catalog entry not found: ${catalogEntryId}`);

    if (!this.#nutriListStore) throw new Error('NutriListStore not configured for quick-add');

    const today = new Date().toISOString().split('T')[0];
    const { randomUUID } = await import('crypto');
    const item = {
      uuid: randomUUID(),
      label: entry.name,
      calories: entry.nutrients.calories,
      protein: entry.nutrients.protein,
      carbs: entry.nutrients.carbs,
      fat: entry.nutrients.fat,
      grams: 0,
      unit: 'serving',
      amount: 1,
      color: 'yellow',
      date: today,
    };

    await this.#nutriListStore.create(userId, item);
    entry.recordUsage();
    await this.#catalogStore.save(entry, userId);

    this.#logger.info?.('health.catalog.quickadd', { name: entry.name, id: entry.id });
    return item;
  }

  /**
   * Search the catalog by name substring.
   * @param {string} query
   * @param {string} userId
   * @param {number} [limit=10]
   */
  async search(query, userId, limit = 10) {
    return this.#catalogStore.search(query, userId, limit);
  }

  /**
   * Get recently used catalog entries.
   * @param {string} userId
   * @param {number} [limit=10]
   */
  async getRecent(userId, limit = 10) {
    return this.#catalogStore.getRecent(userId, limit);
  }

  /**
   * Backfill catalog from existing nutriday data.
   * Reads nutrilist entries and records each as catalog usage.
   *
   * @param {string} userId
   * @param {number} [daysBack=90]
   * @returns {Promise<{ processed: number, created: number, updated: number }>}
   */
  async backfill(userId, daysBack = 90) {
    if (!this.#nutriListStore) throw new Error('NutriListStore not configured for backfill');

    let processed = 0, created = 0, updated = 0;
    const now = new Date();

    for (let i = 0; i < daysBack; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const date = d.toISOString().split('T')[0];

      let items;
      try {
        items = await this.#nutriListStore.findByDate(userId, date);
      } catch {
        continue;
      }
      if (!Array.isArray(items) || items.length === 0) continue;

      for (const item of items) {
        if (!item?.label) continue;
        const existing = await this.#catalogStore.findByNormalizedName(item.label, userId);
        if (existing) {
          updated++;
        } else {
          created++;
        }
        await this.recordUsage({
          name: item.label,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
        }, userId);
        processed++;
      }
    }

    this.#logger.info?.('health.catalog.backfill', { userId, daysBack, processed, created, updated });
    return { processed, created, updated };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/3_applications/health/FoodCatalogService.mjs
git commit -m "feat(health): add FoodCatalogService for catalog CRUD and backfill"
```

---

### Task 8: Catalog API endpoints

**Files:**
- Modify: `backend/src/4_api/v1/routers/health.mjs`

- [ ] **Step 1: Add catalog dependencies to router factory**

Update the destructuring in `createHealthRouter` to accept `catalogService`:

```javascript
const { healthService, healthStore, configService, nutriListStore, dashboardService, catalogService, logger = console } = config;
```

- [ ] **Step 2: Add catalog endpoints**

Add after the existing nutrilist endpoints section (after line ~418):

```javascript
  // --- Food Catalog Endpoints ---
  if (catalogService) {

    /**
     * GET /api/v1/health/nutrition/catalog - Search food catalog
     * Query: q (search string), limit (default 10)
     */
    router.get('/nutrition/catalog', asyncHandler(async (req, res) => {
      const { q, limit } = req.query;
      const userId = getDefaultUsername();
      if (!q) {
        return res.status(400).json({ error: 'q query param required' });
      }
      const results = await catalogService.search(q, userId, parseInt(limit) || 10);
      return res.json({ items: results.map(e => e.toJSON()), count: results.length });
    }));

    /**
     * GET /api/v1/health/nutrition/catalog/recent - Recent catalog entries
     * Query: limit (default 10)
     */
    router.get('/nutrition/catalog/recent', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const limit = parseInt(req.query.limit) || 10;
      const results = await catalogService.getRecent(userId, limit);
      return res.json({ items: results.map(e => e.toJSON()), count: results.length });
    }));

    /**
     * POST /api/v1/health/nutrition/catalog/quickadd - Quick-add a catalog entry
     * Body: { catalogEntryId }
     */
    router.post('/nutrition/catalog/quickadd', asyncHandler(async (req, res) => {
      const { catalogEntryId } = req.body;
      if (!catalogEntryId) {
        return res.status(400).json({ error: 'catalogEntryId is required' });
      }
      const userId = getDefaultUsername();
      try {
        const item = await catalogService.quickAdd(catalogEntryId, userId);
        return res.json({ logged: true, item });
      } catch (err) {
        logger.error?.('health.catalog.quickadd.error', { catalogEntryId, error: err.message });
        return res.status(404).json({ error: err.message });
      }
    }));

    /**
     * POST /api/v1/health/nutrition/catalog/backfill - Seed catalog from existing data
     * Body: { daysBack } (default 90)
     */
    router.post('/nutrition/catalog/backfill', asyncHandler(async (req, res) => {
      const daysBack = parseInt(req.body.daysBack) || 90;
      const userId = getDefaultUsername();
      const result = await catalogService.backfill(userId, daysBack);
      return res.json(result);
    }));

  }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/health.mjs
git commit -m "feat(health): add food catalog API endpoints (search, recent, quickadd, backfill)"
```

---

### Task 9: WebNutribotAdapter

**Files:**
- Create: `backend/src/1_adapters/nutribot/WebNutribotAdapter.mjs`

- [ ] **Step 1: Understand NutribotInputRouter's event interface**

The router's `handleText`, `handleVoice`, `handleImage`, `handleUpc` methods all expect:
- `event` — `{ type, conversationId, userId, platformUserId?, platform?, payload: { text?, audioBuffer?, imageBuffer?, barcodeData? } }`
- `responseContext` — an object with `send(text)`, `sendPhoto(buffer)`, `editMessage(id, text)`, etc.

The WebNutribotAdapter needs to:
1. Convert HTTP request to this event shape
2. Provide a responseContext that captures the bot's response instead of sending to Telegram
3. Return the captured response as JSON

- [ ] **Step 2: Create the adapter**

```javascript
/**
 * WebNutribotAdapter - Adapts HTTP requests to the NutribotInputRouter interface.
 *
 * Replaces Telegram as the transport. Instead of sending responses back via
 * messaging gateway, it captures them and returns as JSON.
 */

export class WebNutribotAdapter {
  #inputRouter;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.inputRouter - NutribotInputRouter instance
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.inputRouter) throw new Error('WebNutribotAdapter requires inputRouter');
    this.#inputRouter = config.inputRouter;
    this.#logger = config.logger || console;
  }

  /**
   * Process a nutrition input from the web UI.
   *
   * @param {Object} input
   * @param {string} input.type - "text" | "voice" | "image" | "barcode"
   * @param {string} [input.content] - Text content or barcode string
   * @param {Buffer} [input.buffer] - Audio or image binary
   * @param {string} input.userId - Username
   * @returns {Promise<Object>} Response from the bot pipeline
   */
  async process(input) {
    const { type, content, buffer, userId } = input;
    const conversationId = `web:${userId}_${Date.now()}`;

    const event = {
      type,
      conversationId,
      userId,
      platform: 'web',
      platformUserId: userId,
      payload: {},
    };

    // Build payload based on type
    switch (type) {
      case 'text':
        event.payload.text = content;
        break;
      case 'barcode':
        event.payload.barcodeData = content;
        event.type = 'upc';
        break;
      case 'voice':
        event.payload.audioBuffer = buffer;
        break;
      case 'image':
        event.payload.imageBuffer = buffer;
        break;
      default:
        throw new Error(`Unsupported input type: ${type}`);
    }

    // Create a response context that captures the bot's response
    const captured = { messages: [], items: [], logged: false };
    const responseContext = this.#createCaptureContext(captured);

    this.#logger.debug?.('web-nutribot.process', { type, userId, conversationId });

    // Route to the appropriate handler
    try {
      switch (event.type) {
        case 'text':
          await this.#inputRouter.handleText(event, responseContext);
          break;
        case 'voice':
          await this.#inputRouter.handleVoice(event, responseContext);
          break;
        case 'image':
          await this.#inputRouter.handleImage(event, responseContext);
          break;
        case 'upc':
          await this.#inputRouter.handleUpc(event, responseContext);
          break;
      }
    } catch (err) {
      this.#logger.error?.('web-nutribot.error', { type, error: err.message });
      throw err;
    }

    return {
      items: captured.items,
      messages: captured.messages,
      logged: captured.logged,
      totalCalories: captured.items.reduce((t, i) => t + (i.calories || 0), 0),
    };
  }

  /**
   * Create a mock response context that captures bot output.
   * Mirrors the interface that TelegramAdapter provides.
   */
  #createCaptureContext(captured) {
    return {
      send: (text, options) => {
        captured.messages.push({ type: 'text', text, options });
        // Try to extract food items from the text/options
        if (options?.items) {
          captured.items.push(...options.items);
          captured.logged = true;
        }
        return Promise.resolve({ messageId: `web_${Date.now()}` });
      },
      editMessage: (messageId, text, options) => {
        captured.messages.push({ type: 'edit', messageId, text, options });
        if (options?.items) {
          captured.items.push(...options.items);
          captured.logged = true;
        }
        return Promise.resolve();
      },
      deleteMessage: () => Promise.resolve(),
      sendPhoto: (buffer, options) => {
        captured.messages.push({ type: 'photo', options });
        return Promise.resolve({ messageId: `web_${Date.now()}` });
      },
      reply: (text) => {
        captured.messages.push({ type: 'reply', text });
        return Promise.resolve();
      },
    };
  }
}
```

**Note:** The `#createCaptureContext` will likely need adjustment once you read the exact responseContext interface that the NutribotInputRouter expects. The key methods are `send`, `editMessage`, `deleteMessage`. Read the existing TelegramAdapter to see the full interface contract.

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/nutribot/WebNutribotAdapter.mjs
git commit -m "feat(nutribot): add WebNutribotAdapter for direct web nutrition input"
```

---

### Task 10: Nutrition input API endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/health.mjs`

- [ ] **Step 1: Add webNutribotAdapter to router factory**

Update the destructuring:

```javascript
const { healthService, healthStore, configService, nutriListStore, dashboardService, catalogService, webNutribotAdapter, logger = console } = config;
```

- [ ] **Step 2: Add the input endpoint**

```javascript
  // --- Direct Nutrition Input ---
  if (webNutribotAdapter) {

    /**
     * POST /api/v1/health/nutrition/input - Direct nutrition input
     * Body (JSON): { type: "text"|"barcode", content: string }
     * Body (multipart): type field + file field for voice/image
     */
    router.post('/nutrition/input', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { type, content } = req.body;

      if (!type) {
        return res.status(400).json({ error: 'type is required (text, voice, image, barcode)' });
      }

      try {
        const result = await webNutribotAdapter.process({
          type,
          content,
          userId,
        });
        return res.json(result);
      } catch (err) {
        logger.error?.('health.nutrition.input.error', { type, error: err.message });
        return res.status(500).json({ error: err.message });
      }
    }));

  }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/health.mjs
git commit -m "feat(health): add POST /nutrition/input endpoint for direct web input"
```

---

### Task 11: Passive catalog population in nutribot use cases

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs`
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromVoice.mjs`
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs`
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs`

- [ ] **Step 1: Read each use case to understand where food items are finalized**

In each `LogFoodFrom*.mjs`, find the point after items are parsed and saved to the food log store. The catalog recording should happen there — after a successful log, before the response is sent.

For `LogFoodFromText.mjs`, this is around lines 259-261 (after `this.#foodLogStore.save(nutriLog)`).

- [ ] **Step 2: Add catalogService as an optional dependency**

In each use case constructor, add:

```javascript
this.#catalogService = deps.catalogService || null;
```

- [ ] **Step 3: Add catalog recording after successful log**

After the food log is saved, add:

```javascript
// Record food items in catalog for quick-add
if (this.#catalogService) {
  for (const item of foodItems) {
    try {
      await this.#catalogService.recordUsage({
        name: item.label,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        source: 'nutritionix',
      }, userId);
    } catch (err) {
      this.#logger.warn?.('nutribot.catalog.record_failed', { name: item.label, error: err.message });
    }
  }
}
```

The exact variable names (`foodItems`, `item.label`) depend on each use case — read the specific file to match the local variable names. The pattern is identical: after the log save succeeds, loop through items and record each.

- [ ] **Step 4: Wire catalogService into use case construction**

Find where these use cases are instantiated (likely in the NutribotContainer or similar factory). Pass `catalogService` as an optional dependency. This is non-breaking — the `|| null` default means existing code works without it.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs \
       backend/src/3_applications/nutribot/usecases/LogFoodFromVoice.mjs \
       backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs \
       backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs
git commit -m "feat(nutribot): add passive food catalog recording to all LogFood use cases"
```

---

### Task 12: Wire catalog and web adapter into bootstrap

**Files:**
- Modify: The app bootstrap/wiring file (same as Task 4)

- [ ] **Step 1: Import new services**

```javascript
import { YamlFoodCatalogDatastore } from '#adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs';
import { FoodCatalogService } from '#apps/health/FoodCatalogService.mjs';
import { WebNutribotAdapter } from '#adapters/nutribot/WebNutribotAdapter.mjs';
```

- [ ] **Step 2: Instantiate**

```javascript
const foodCatalogStore = new YamlFoodCatalogDatastore({ dataService, logger });
const catalogService = new FoodCatalogService({ catalogStore: foodCatalogStore, nutriListStore, logger });
const webNutribotAdapter = new WebNutribotAdapter({ inputRouter: nutribotInputRouter, logger });
```

The exact variable names for `dataService`, `nutriListStore`, and `nutribotInputRouter` depend on what's available in the bootstrap scope.

- [ ] **Step 3: Pass to router factory**

```javascript
createHealthRouter({ ..., catalogService, webNutribotAdapter });
```

Also pass `catalogService` to the NutribotContainer or use case factory so it flows to `LogFoodFrom*` use cases.

- [ ] **Step 4: Commit**

```bash
git add backend/src/  # modified bootstrap file(s)
git commit -m "feat(health): wire food catalog and web nutribot adapter into bootstrap"
```

---

### Task 13: Backfill existing nutrition data into catalog

**Files:** None (runtime operation)

- [ ] **Step 1: Build and deploy**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 2: Run the backfill**

```bash
sleep 10 && curl -s -X POST http://localhost:3111/api/v1/health/nutrition/catalog/backfill \
  -H "Content-Type: application/json" \
  -d '{"daysBack": 90}' | jq .
```

Expected: `{ processed: N, created: N, updated: N }`

- [ ] **Step 3: Verify catalog**

```bash
curl -s "http://localhost:3111/api/v1/health/nutrition/catalog/recent?limit=5" | jq '.items[].name'
```

---

### Task 14: Integration testing

- [ ] **Step 1: Test dashboard endpoint**

```bash
curl -s http://localhost:3111/api/v1/health/dashboard | jq '{
  todayDate: .today.date,
  hasWeight: (.today.weight != null),
  sessionCount: (.today.sessions | length),
  recencyCount: (.recency | length),
  goalCount: (.goals | length),
  historyDays: (.history.daily | length),
  historyWeeks: (.history.weekly | length),
  historyMonths: (.history.monthly | length)
}'
```

- [ ] **Step 2: Test nutrition input**

```bash
curl -s -X POST http://localhost:3111/api/v1/health/nutrition/input \
  -H "Content-Type: application/json" \
  -d '{"type": "text", "content": "2 eggs and toast"}' | jq .
```

- [ ] **Step 3: Test catalog search**

```bash
curl -s "http://localhost:3111/api/v1/health/nutrition/catalog?q=eggs" | jq '.items | length'
```

- [ ] **Step 4: Test quick-add**

```bash
# Get a catalog entry ID
ENTRY_ID=$(curl -s "http://localhost:3111/api/v1/health/nutrition/catalog/recent?limit=1" | jq -r '.items[0].id')

# Quick-add it
curl -s -X POST http://localhost:3111/api/v1/health/nutrition/catalog/quickadd \
  -H "Content-Type: application/json" \
  -d "{\"catalogEntryId\": \"$ENTRY_ID\"}" | jq .
```

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix(health): integration test fixes for health dashboard and catalog"
```
