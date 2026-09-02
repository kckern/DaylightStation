# Health App LoseIt-Style Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Health app as a log-first daily food log (LoseIt-style) on the new design system, with budget math, favorites, saved meals, barcode→custom-food, medical readings, and a coach `log_food` tool.

**Architecture:** Additive backend (new YAML stores + services + endpoints on the existing health router; catalog-first UPC resolution; one new coach tool) and a big-bang frontend rebuild consuming `@/lib/ui` primitives. Existing NutriLog/NutriList pipelines are reused, not rebuilt.

**Tech Stack:** Node ESM backend (DDD layers, `#domains/#apps/#adapters/#api` aliases), YAML persistence via `dataService.user.read/write`, React 18 + Mantine 7.11 + DS primitives, vitest + Playwright.

**Specs:** `docs/superpowers/specs/2026-09-02-health-loseit-revamp-design.md` (requirements) and `docs/superpowers/specs/2026-09-02-webapp-design-system-unification-design.md` (this is Phase 2 of that program).
**Prerequisite:** the DS foundation plan (`2026-09-02-webapp-design-system.md`) is fully executed — `@/lib/ui` and `@/lib/theme` exist.

## Global Constraints

- **DDD layer rules are audited at commit** (`audit:layers`): domains import nothing upward and no node IO and no ambient clock; applications never import adapters (deps injected); API routers never import adapters/apps/domains directly (services arrive via config); composition (`5_composition/`) does the wiring.
- **Backend data paths:** per-user YAML via `dataService.user.read(path, userId)` / `dataService.user.write(path, data, userId)` — path is relative to the user dir, no extension (e.g. `apps/health/goals` → `users/{id}/apps/health/goals.yml`).
- **Persistence adapters own hydration/dehydration** (no `toJSON`/`fromJSON` on entities — audited).
- **Strict finite numbers, no coercion** in domain validation (house style; see ScanNutritionService).
- **Logging:** structured framework only; backend services take an injected `logger`; frontend uses `createAppLogger('health')` children. `context.app: 'health'`.
- **Frontend:** DS primitives + tokens only (the `audit:ui` gate is live); icons are inline SVG; no sliders (discrete tap targets); Mantine `Button`/`ActionIcon` (never raw `<button>` in app code — audit rule).
- **Meal buckets:** data values stay `morning|afternoon|evening|night`; UI labels map morning→Breakfast, afternoon→Lunch, evening→Dinner, night→Snacks; missing → UNGROUPED.
- **Tests:** backend/domain unit + frontend component via `npx vitest run <path>`; API tests in `tests/live/api/health/`; flows in `tests/live/flow/health/`. Skipping is not passing — a test that can't set up its scenario fails.
- **Commit after every task** (pre-commit gates run). Backend config is cached at startup — nodemon restarts on backend file edits; for manual checks against the dev server confirm it's running (`ss -tlnp | grep 3112`).
- Existing endpoints reused as-is: `POST /api/v1/health/nutrition/input` (`{type, content}` → `{ messages: [{ text, choices: [[{text, callback_data}]] }] }`), `POST /api/v1/health/nutrition/callback` (`{callbackData}`), `GET/POST/PUT/DELETE /api/v1/health/nutrilist...`, `POST /nutrition/catalog/quickadd`, `GET /api/v1/health/dashboard`, `GET /api/v1/lifelog/weight`.

---

## Part B — Backend

### Task B1: BudgetMath (pure domain)

**Files:**
- Create: `backend/src/2_domains/health/services/BudgetMath.mjs`
- Create: `backend/src/2_domains/health/services/BudgetMath.test.mjs`

**Interfaces:**
- Produces: `computeDailyBudget({ weightLbs, heightIn, ageYears, sex, activityBaseline, weeklyRateLbs, budgetFloor }) → number` (integer kcal). Mifflin-St Jeor BMR × activity − weekly-rate deficit, floored. Throws `ValidationError`-style `Error` with `code: 'INVALID_BUDGET_INPUT'` on non-finite numeric inputs. No clock, no IO (domain rules).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/2_domains/health/services/BudgetMath.test.mjs
import { describe, it, expect } from 'vitest';
import { computeDailyBudget } from './BudgetMath.mjs';

const base = {
  weightLbs: 200, heightIn: 70, ageYears: 40, sex: 'male',
  activityBaseline: 1.35, weeklyRateLbs: 1, budgetFloor: 1200,
};

describe('computeDailyBudget', () => {
  it('computes Mifflin-St Jeor male fixture', () => {
    // kg=90.718, cm=177.8 → BMR = 10*90.718 + 6.25*177.8 - 5*40 + 5 = 1823.4
    // TDEE = 1823.4*1.35 = 2461.6; deficit 3500/7=500 → 1962
    expect(computeDailyBudget(base)).toBe(1962);
  });

  it('female offset is -161', () => {
    const m = computeDailyBudget(base);
    const f = computeDailyBudget({ ...base, sex: 'female' });
    expect(m - f).toBe(Math.round(166 * 1.35)); // (5 - -161) * activity
  });

  it('applies the floor', () => {
    expect(computeDailyBudget({ ...base, weeklyRateLbs: 5 })).toBeGreaterThanOrEqual(1200);
    expect(computeDailyBudget({ ...base, weightLbs: 100, weeklyRateLbs: 3 })).toBe(1200);
  });

  it('rejects non-finite inputs without coercion', () => {
    expect(() => computeDailyBudget({ ...base, weightLbs: '200' })).toThrow(/INVALID_BUDGET_INPUT/);
    expect(() => computeDailyBudget({ ...base, ageYears: NaN })).toThrow(/INVALID_BUDGET_INPUT/);
  });

  it('rejects unknown sex', () => {
    expect(() => computeDailyBudget({ ...base, sex: 'x' })).toThrow(/INVALID_BUDGET_INPUT/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/2_domains/health/services/BudgetMath.test.mjs`
Expected: FAIL — cannot resolve `./BudgetMath.mjs`

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/2_domains/health/services/BudgetMath.mjs
//
// Daily calorie budget: Mifflin-St Jeor BMR x activity baseline minus the
// weekly-rate deficit, floored. Pure and deterministic — age arrives as a
// number (domains carry no clock).

const LB_TO_KG = 0.45359237;
const IN_TO_CM = 2.54;
const KCAL_PER_LB = 3500;

const finite = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    const err = new Error(`INVALID_BUDGET_INPUT: ${name} must be a finite number`);
    err.code = 'INVALID_BUDGET_INPUT';
    throw err;
  }
  return v;
};

export function computeDailyBudget({
  weightLbs, heightIn, ageYears, sex,
  activityBaseline = 1.35, weeklyRateLbs = 1, budgetFloor = 1200,
}) {
  finite(weightLbs, 'weightLbs');
  finite(heightIn, 'heightIn');
  finite(ageYears, 'ageYears');
  finite(activityBaseline, 'activityBaseline');
  finite(weeklyRateLbs, 'weeklyRateLbs');
  finite(budgetFloor, 'budgetFloor');
  if (sex !== 'male' && sex !== 'female') {
    const err = new Error('INVALID_BUDGET_INPUT: sex must be male|female');
    err.code = 'INVALID_BUDGET_INPUT';
    throw err;
  }

  const kg = weightLbs * LB_TO_KG;
  const cm = heightIn * IN_TO_CM;
  const bmr = 10 * kg + 6.25 * cm - 5 * ageYears + (sex === 'male' ? 5 : -161);
  const tdee = bmr * activityBaseline;
  const budget = Math.round(tdee - (weeklyRateLbs * KCAL_PER_LB) / 7);
  return Math.max(budget, Math.round(budgetFloor));
}

export default computeDailyBudget;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/2_domains/health/services/BudgetMath.test.mjs`
Expected: PASS (5 tests). If the male fixture is off by 1 from rounding, correct the expected constant in the test to the actual rounded value — the formula, not the fixture, is the contract.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/BudgetMath.mjs backend/src/2_domains/health/services/BudgetMath.test.mjs
git commit -m "feat(health): BudgetMath — Mifflin-St Jeor daily budget, pure domain"
```

---

### Task B2: Goals datastore + BudgetService

**Files:**
- Create: `backend/src/3_applications/health/ports/IHealthGoalsDatastore.mjs`
- Create: `backend/src/1_adapters/persistence/yaml/YamlHealthGoalsDatastore.mjs`
- Create: `backend/src/3_applications/health/BudgetService.mjs`
- Create: `backend/src/3_applications/health/BudgetService.test.mjs`

**Interfaces:**
- Consumes: `computeDailyBudget` (B1); `healthStore.loadWeightData(userId)` (date-keyed object with `lbs_adjusted_average`), `healthStore.getWorkoutsForDate(userId, date)`, `nutriListStore.findByDate(userId, date)`; `dataService.user.read/write`.
- Produces: `IHealthGoalsDatastore` (`load(userId)`, `save(goals, userId)`); `YamlHealthGoalsDatastore` (path `apps/health/goals`); `BudgetService` with `getGoals(userId)`, `setGoals(userId, goals)`, `getBudget(userId, date) → { date, budget, food, exercise, net, remaining, status: 'under'|'over', stale, sessions, goals }`. Goals shape: `{ targetWeightLbs, weeklyRateLbs, activityBaseline, budgetFloor, heightIn, birthYear, sex }`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/3_applications/health/BudgetService.test.mjs
import { describe, it, expect } from 'vitest';
import { BudgetService } from './BudgetService.mjs';

const GOALS = {
  targetWeightLbs: 180, weeklyRateLbs: 1, activityBaseline: 1.35,
  budgetFloor: 1200, heightIn: 70, birthYear: 1986, sex: 'male',
};

const makeService = (over = {}) => new BudgetService({
  goalsStore: { load: async () => GOALS, save: async () => {}, ...over.goalsStore },
  healthStore: {
    loadWeightData: async () => ({
      '2026-09-01': { lbs_adjusted_average: 200 },
      '2026-08-30': { lbs_adjusted_average: 201 },
    }),
    getWorkoutsForDate: async () => ([{ type: 'cycling', calories: 320, duration_min: 42 }]),
    ...over.healthStore,
  },
  nutriListStore: {
    findByDate: async () => ([
      { calories: 400, status: 'accepted' },
      { calories: 880 },
      { calories: 999, status: 'pending' }, // pending never counts
    ]),
    ...over.nutriListStore,
  },
  clock: { now: () => new Date('2026-09-02T12:00:00Z').getTime() },
  logger: { debug() {}, info() {}, warn() {}, error() {} },
});

describe('BudgetService.getBudget', () => {
  it('assembles the equation from goals, weight, food, exercise', async () => {
    const b = await makeService().getBudget('kckern', '2026-09-02');
    expect(b.budget).toBe(1962); // B1 fixture: 200lbs, 70in, age 40, male
    expect(b.food).toBe(1280);   // 400 + 880; pending excluded
    expect(b.exercise).toBe(320);
    expect(b.remaining).toBe(1962 - 1280 + 320);
    expect(b.status).toBe('under');
    expect(b.sessions).toHaveLength(1);
  });

  it('marks weight stale when the latest reading is >7 days old', async () => {
    const svc = makeService({
      healthStore: {
        loadWeightData: async () => ({ '2026-08-20': { lbs_adjusted_average: 200 } }),
        getWorkoutsForDate: async () => [],
      },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b.stale).toBe(true);
    expect(b.budget).toBe(1962); // still computed from last known weight
  });

  it('throws a coded error when goals are not configured', async () => {
    const svc = makeService({ goalsStore: { load: async () => null } });
    await expect(svc.getBudget('kckern', '2026-09-02')).rejects.toThrow(/GOALS_NOT_CONFIGURED/);
  });

  it('over status when food exceeds budget+exercise', async () => {
    const svc = makeService({
      nutriListStore: { findByDate: async () => [{ calories: 3000 }] },
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b.status).toBe('over');
    expect(b.remaining).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/3_applications/health/BudgetService.test.mjs`
Expected: FAIL — cannot resolve `./BudgetService.mjs`

- [ ] **Step 3: Write the implementations**

```javascript
// backend/src/3_applications/health/ports/IHealthGoalsDatastore.mjs
/** Port for the per-user health goals document. */
export class IHealthGoalsDatastore {
  async load(userId) { throw new Error('IHealthGoalsDatastore.load must be implemented'); }
  async save(goals, userId) { throw new Error('IHealthGoalsDatastore.save must be implemented'); }
}
export default IHealthGoalsDatastore;
```

```javascript
// backend/src/1_adapters/persistence/yaml/YamlHealthGoalsDatastore.mjs
// Storage: data/users/{username}/apps/health/goals.yml
import { IHealthGoalsDatastore } from '#apps/health/ports/IHealthGoalsDatastore.mjs';

export class YamlHealthGoalsDatastore extends IHealthGoalsDatastore {
  #dataService;
  static GOALS_PATH = 'apps/health/goals';

  constructor(config) {
    super();
    if (!config.dataService) throw new Error('YamlHealthGoalsDatastore requires dataService');
    this.#dataService = config.dataService;
  }

  async load(userId) {
    const raw = this.#dataService.user.read?.(YamlHealthGoalsDatastore.GOALS_PATH, userId);
    return raw && typeof raw === 'object' ? raw : null;
  }

  async save(goals, userId) {
    this.#dataService.user.write?.(YamlHealthGoalsDatastore.GOALS_PATH, goals, userId);
  }
}
export default YamlHealthGoalsDatastore;
```

```javascript
// backend/src/3_applications/health/BudgetService.mjs
//
// The one home of the daily calorie equation:
//   remaining = budget - food + exercise
// The UI and the coach both read this — budget math is never computed
// client-side (spec, Data model §1).
import { computeDailyBudget } from '#domains/health/services/BudgetMath.mjs';

const STALE_WEIGHT_DAYS = 7;
const COUNTED = (item) => item?.status !== 'pending' && item?.status !== 'rejected' && item?.status !== 'deleted';

// Tolerant calorie summer: workouts arrive as an array of session objects or
// a keyed object; count numeric `calories` (fallback `total_calories`).
const sumExerciseCalories = (workouts) => {
  const list = Array.isArray(workouts) ? workouts
    : (workouts && typeof workouts === 'object' ? Object.values(workouts) : []);
  return list.reduce((sum, w) => {
    const c = Number(w?.calories ?? w?.total_calories);
    return sum + (Number.isFinite(c) ? c : 0);
  }, 0);
};

export class BudgetService {
  #goalsStore; #healthStore; #nutriListStore; #clock; #logger;

  constructor({ goalsStore, healthStore, nutriListStore, clock, logger }) {
    if (!goalsStore || !healthStore || !nutriListStore || !clock?.now) {
      throw new Error('BudgetService requires goalsStore, healthStore, nutriListStore, clock');
    }
    this.#goalsStore = goalsStore;
    this.#healthStore = healthStore;
    this.#nutriListStore = nutriListStore;
    this.#clock = clock;
    this.#logger = logger || console;
  }

  async getGoals(userId) {
    return this.#goalsStore.load(userId);
  }

  async setGoals(userId, goals) {
    await this.#goalsStore.save(goals, userId);
    this.#logger.info?.('health.budget.goals_saved', { userId });
    return goals;
  }

  async getBudget(userId, date) {
    const goals = await this.#goalsStore.load(userId);
    if (!goals) {
      const err = new Error('GOALS_NOT_CONFIGURED: set goals before requesting a budget');
      err.code = 'GOALS_NOT_CONFIGURED';
      throw err;
    }

    // Latest known adjusted-average weight at or before `date`
    const weightData = await this.#healthStore.loadWeightData(userId) || {};
    const dates = Object.keys(weightData).filter((d) => d <= date).sort();
    const latestDate = dates.at(-1) || null;
    const weightLbs = latestDate ? Number(weightData[latestDate]?.lbs_adjusted_average) : NaN;
    if (!Number.isFinite(weightLbs)) {
      const err = new Error('NO_WEIGHT_DATA: no usable weight reading for budget');
      err.code = 'NO_WEIGHT_DATA';
      throw err;
    }
    const daysOld = (new Date(`${date}T12:00:00Z`) - new Date(`${latestDate}T12:00:00Z`)) / 86400000;
    const stale = daysOld > STALE_WEIGHT_DAYS;

    const now = new Date(this.#clock.now());
    const ageYears = now.getUTCFullYear() - Number(goals.birthYear);

    const budget = computeDailyBudget({
      weightLbs,
      heightIn: Number(goals.heightIn),
      ageYears,
      sex: goals.sex,
      activityBaseline: Number(goals.activityBaseline ?? 1.35),
      weeklyRateLbs: Number(goals.weeklyRateLbs ?? 1),
      budgetFloor: Number(goals.budgetFloor ?? 1200),
    });

    const items = await this.#nutriListStore.findByDate(userId, date) || [];
    const food = items.filter(COUNTED).reduce((sum, i) => {
      const c = Number(i?.calories);
      return sum + (Number.isFinite(c) ? c : 0);
    }, 0);

    const workouts = await this.#healthStore.getWorkoutsForDate(userId, date);
    const exercise = Math.round(sumExerciseCalories(workouts));
    const sessions = Array.isArray(workouts) ? workouts
      : (workouts && typeof workouts === 'object' ? Object.values(workouts) : []);

    const remaining = budget - food + exercise;
    return {
      date, budget, food: Math.round(food), exercise, net: Math.round(food) - exercise,
      remaining, status: remaining >= 0 ? 'under' : 'over', stale, sessions, goals,
    };
  }
}
export default BudgetService;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/3_applications/health/BudgetService.test.mjs`
Expected: PASS (4 tests). The `1962` fixture must equal whatever B1's corrected fixture settled on — if B1's rounding adjusted it, adjust here identically.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/health/ports/IHealthGoalsDatastore.mjs backend/src/1_adapters/persistence/yaml/YamlHealthGoalsDatastore.mjs backend/src/3_applications/health/BudgetService.mjs backend/src/3_applications/health/BudgetService.test.mjs
git commit -m "feat(health): goals store and BudgetService — server-side calorie equation"
```

---

### Task B3: Budget + goals endpoints and wiring

**Files:**
- Modify: `backend/src/4_api/v1/routers/health.mjs` (destructure `budgetService` from config; add endpoints)
- Modify: `backend/src/5_composition/modules/healthApi.mjs` (construct `YamlHealthGoalsDatastore` + `BudgetService`, pass `budgetService` into `createHealthRouter`)

**Interfaces:**
- Consumes: `BudgetService` (B2); router config pattern of `health.mjs` (`asyncHandler`, `getDefaultUsername()`, `sendInternalError` — reuse the file's existing helpers exactly as neighboring endpoints do).
- Produces: `GET /api/v1/health/budget?date=YYYY-MM-DD` (default: today via the router's existing date helper or `new Date().toISOString().slice(0,10)`), `GET /api/v1/health/goals`, `PUT /api/v1/health/goals` (body = goals object, echoed back). `GOALS_NOT_CONFIGURED` / `NO_WEIGHT_DATA` map to HTTP 409 with `{ error, code }` (the UI treats 409 as "set up your goals", not a failure).

- [ ] **Step 1: Add the endpoints**

In `backend/src/4_api/v1/routers/health.mjs`, add `budgetService` to the config destructure at line 60, then add (next to the catalog block, gated the same way):

```javascript
  // ==========================================================================
  // Budget & Goals (BudgetService)
  // ==========================================================================
  if (budgetService) {
    router.get('/budget', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      try {
        return res.json(await budgetService.getBudget(userId, date));
      } catch (err) {
        if (err.code === 'GOALS_NOT_CONFIGURED' || err.code === 'NO_WEIGHT_DATA') {
          return res.status(409).json({ error: err.message, code: err.code });
        }
        logger.error?.('health.budget.error', { date, error: err.message });
        return sendInternalError(res, { error: err.message });
      }
    }));

    router.get('/goals', asyncHandler(async (req, res) => {
      const goals = await budgetService.getGoals(getDefaultUsername());
      return res.json({ goals });
    }));

    router.put('/goals', asyncHandler(async (req, res) => {
      const goals = await budgetService.setGoals(getDefaultUsername(), req.body);
      return res.json({ goals });
    }));
  }
```

(Match the file's actual helper names — `getDefaultUsername`, `asyncHandler`, `sendInternalError` are used by the neighboring nutrition-input block at `health.mjs:565+`; copy their exact usage.)

- [ ] **Step 2: Wire in composition**

In `backend/src/5_composition/modules/healthApi.mjs`: import `YamlHealthGoalsDatastore` and `BudgetService`; after the `healthOperations` construction add:

```javascript
  const goalsStore = new YamlHealthGoalsDatastore({ dataService });
  const budgetService = new BudgetService({
    goalsStore,
    healthStore: healthServices.healthStore,
    nutriListStore: healthServices.nutriListStore,
    clock: { now: () => Date.now() },
    logger,
  });
```

and pass `budgetService` in the `createHealthRouter({...})` call.

- [ ] **Step 3: Verify against the dev server**

Restart/let nodemon restart, then:

```bash
curl -s "http://localhost:3112/api/v1/health/goals"
curl -s -X PUT "http://localhost:3112/api/v1/health/goals" -H 'Content-Type: application/json' \
  -d '{"targetWeightLbs":180,"weeklyRateLbs":1,"activityBaseline":1.35,"budgetFloor":1200,"heightIn":70,"birthYear":1986,"sex":"male"}'
curl -s "http://localhost:3112/api/v1/health/budget" | head -c 400
```

Expected: goals round-trip; budget returns the full equation payload (or a clean 409 before goals are set). Use the backend port from `.claude/settings.local.json` if not 3112.

- [ ] **Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/health.mjs backend/src/5_composition/modules/healthApi.mjs
git commit -m "feat(health): budget and goals endpoints"
```

---

### Task B4: Catalog favorites, suggest ranking, custom foods, UPC lookup

**Files:**
- Modify: `backend/src/2_domains/health/entities/FoodCatalogEntry.mjs` (add `favorite`)
- Modify: `backend/src/1_adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs` (persist `favorite`; add `findByUpc`)
- Modify: `backend/src/3_applications/health/FoodCatalogService.mjs` (add `suggest`, `setFavorite`, `createCustom`, `getByUpc`)
- Modify: `backend/src/4_api/v1/routers/health.mjs` (add suggest/favorite/create endpoints inside the existing `if (catalogService)` block)
- Create: `backend/src/3_applications/health/FoodCatalogService.suggest.test.mjs`

**Interfaces:**
- Produces: `FoodCatalogEntry.favorite` (boolean, default false); datastore `findByUpc(upc, userId)`; service `suggest(query, userId, limit=12) → FoodCatalogEntry[]` (favorites first, then `useCount / (1 + daysSinceUse/30)` score, then name matches; empty query = favorites + recents), `setFavorite(id, userId, favorite)`, `createCustom({ name, calories, protein, carbs, fat, barcodeUpc? }, userId) → entry` (source `'custom'`), `getByUpc(upc, userId)`. Endpoints: `GET /nutrition/catalog/suggest?q=&limit=` → `{ items }`, `PUT /nutrition/catalog/favorite` (body `{ id?, name?, favorite }` — resolves by id or normalized name) → `{ entry }`, `POST /nutrition/catalog` (custom-create body) → `{ entry }`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/3_applications/health/FoodCatalogService.suggest.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { FoodCatalogService } from './FoodCatalogService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

const NOW = new Date('2026-09-02T12:00:00Z').getTime();
const entry = (over) => new FoodCatalogEntry({
  id: over.id, name: over.name, nutrients: { calories: 100, protein: 1, carbs: 1, fat: 1 },
  useCount: over.useCount ?? 1, favorite: over.favorite ?? false,
  barcodeUpc: over.barcodeUpc ?? null,
  lastUsed: over.lastUsed ?? '2026-09-01', createdAt: '2026-01-01T00:00:00Z',
});

const makeStore = (entries) => {
  const map = new Map(entries.map((e) => [e.id, e]));
  return {
    getAll: async () => [...map.values()],
    getById: async (id) => map.get(id) || null,
    findByNormalizedName: async (name) =>
      [...map.values()].find((e) => e.matches(FoodCatalogEntry.normalize(name))) || null,
    findByUpc: async (upc) => [...map.values()].find((e) => e.barcodeUpc === upc) || null,
    search: async () => [],
    getRecent: async () => [],
    save: async (e) => { map.set(e.id, e); },
  };
};

describe('FoodCatalogService.suggest', () => {
  let svc, store;
  beforeEach(() => {
    store = makeStore([
      entry({ id: 'a', name: 'chicken breast', useCount: 40, lastUsed: '2026-06-01' }),
      entry({ id: 'b', name: 'chicken thigh', useCount: 3, lastUsed: '2026-09-01', favorite: true }),
      entry({ id: 'c', name: 'chickpeas', useCount: 8, lastUsed: '2026-09-01' }),
      entry({ id: 'd', name: 'oatmeal', useCount: 90, lastUsed: '2026-09-01' }),
    ]);
    svc = new FoodCatalogService({
      catalogStore: store, clock: { now: () => NOW }, createId: () => 'new-id',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
  });

  it('query filters and puts favorites first', async () => {
    const out = await svc.suggest('chick', 'u');
    expect(out.map((e) => e.id)[0]).toBe('b'); // favorite outranks higher useCount
    expect(out.map((e) => e.id)).not.toContain('d');
  });

  it('recency-weighted frequency orders non-favorites', async () => {
    const out = await svc.suggest('chick', 'u');
    // c: 8/(1+1/30) ≈ 7.7 vs a: 40/(1+93/30) ≈ 9.8 → a before c
    expect(out.map((e) => e.id).slice(1)).toEqual(['a', 'c']);
  });

  it('empty query returns favorites + recents ranked', async () => {
    const out = await svc.suggest('', 'u', 3);
    expect(out[0].id).toBe('b');
    expect(out).toHaveLength(3);
  });

  it('setFavorite toggles and persists', async () => {
    await svc.setFavorite('a', 'u', true);
    expect((await store.getById('a')).favorite).toBe(true);
  });

  it('createCustom stores a custom-source entry with the barcode', async () => {
    const e = await svc.createCustom({ name: 'Local Granola', calories: 210, protein: 5, carbs: 30, fat: 8, barcodeUpc: '012345678905' }, 'u');
    expect(e.source).toBe('custom');
    expect((await svc.getByUpc('012345678905', 'u')).name).toBe('Local Granola');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/3_applications/health/FoodCatalogService.suggest.test.mjs`
Expected: FAIL — `suggest is not a function` (and `favorite` not honored)

- [ ] **Step 3: Write the implementations**

`FoodCatalogEntry.mjs` — in the constructor add after `this.useCount = ...`:

```javascript
    this.favorite = data.favorite === true;
```

`YamlFoodCatalogDatastore.mjs` — add `favorite: entry.favorite === true,` to `#dehydrate`, and add:

```javascript
  async findByUpc(upc, userId) {
    if (!upc) return null;
    const catalog = await this.#loadCatalog(userId);
    return catalog.find(e => e.barcodeUpc === upc) || null;
  }
```

(`#hydrate` spreads `raw`, so `favorite` round-trips through the constructor change.)

`FoodCatalogService.mjs` — add methods:

```javascript
  /**
   * One ranked suggestion list for the add-combobox: favorites first, then
   * recency-weighted frequency, then name matches. Empty query = favorites
   * plus recent/frequent entries.
   */
  async suggest(query, userId, limit = 12) {
    const all = await this.#catalogStore.getAll(userId);
    const q = (query || '').toLowerCase().trim();
    const nowDay = new Date(this.#clock.now());
    const score = (e) => {
      const daysSince = Math.max(0, (nowDay - new Date(`${e.lastUsed}T12:00:00Z`)) / 86400000);
      return e.useCount / (1 + daysSince / 30);
    };
    return all
      .filter((e) => (q ? e.matchesSearch(q) : true))
      .sort((a, b) =>
        (b.favorite === true) - (a.favorite === true)
        || score(b) - score(a)
        || a.normalizedName.localeCompare(b.normalizedName))
      .slice(0, limit);
  }

  async setFavorite(id, userId, favorite) {
    const entry = await this.#catalogStore.getById(id, userId);
    if (!entry) throw new Error(`Catalog entry not found: ${id}`);
    entry.favorite = favorite === true;
    await this.#catalogStore.save(entry, userId);
    this.#logger.info?.('health.catalog.favorite', { id, favorite: entry.favorite });
    return entry;
  }

  async setFavoriteByName(name, userId, favorite) {
    const existing = await this.#catalogStore.findByNormalizedName(name, userId);
    if (!existing) throw new Error(`Catalog entry not found by name: ${name}`);
    return this.setFavorite(existing.id, userId, favorite);
  }

  async getByUpc(upc, userId) {
    return this.#catalogStore.findByUpc(upc, userId);
  }

  /** Create a user-authored food, optionally mapped to a barcode. */
  async createCustom({ name, calories, protein, carbs, fat, barcodeUpc = null }, userId) {
    if (!name) throw new Error('createCustom requires name');
    const entry = new FoodCatalogEntry({
      id: this.#createId(),
      name,
      nutrients: {
        calories: Number(calories) || 0,
        protein: Number(protein) || 0,
        carbs: Number(carbs) || 0,
        fat: Number(fat) || 0,
      },
      source: 'custom',
      barcodeUpc,
      lastUsed: new Date(this.#clock.now()).toISOString().slice(0, 10),
      createdAt: new Date(this.#clock.now()).toISOString(),
    });
    await this.#catalogStore.save(entry, userId);
    this.#logger.info?.('health.catalog.custom_created', { name, barcodeUpc });
    return entry;
  }
```

`health.mjs` router — inside the existing `if (catalogService)` block add:

```javascript
    router.get('/nutrition/catalog/suggest', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { q = '', limit } = req.query;
      const items = await catalogService.suggest(q, userId, parseInt(limit) || 12);
      return res.json({ items });
    }));

    router.put('/nutrition/catalog/favorite', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { id, name, favorite } = req.body;
      if (!id && !name) return res.status(400).json({ error: 'id or name is required' });
      try {
        const entry = id
          ? await catalogService.setFavorite(id, userId, favorite)
          : await catalogService.setFavoriteByName(name, userId, favorite);
        return res.json({ entry });
      } catch (err) {
        return res.status(404).json({ error: err.message });
      }
    }));

    router.post('/nutrition/catalog', asyncHandler(async (req, res) => {
      const userId = getDefaultUsername();
      const { name, calories, protein, carbs, fat, barcodeUpc } = req.body;
      if (!name) return res.status(400).json({ error: 'name is required' });
      const entry = await catalogService.createCustom({ name, calories, protein, carbs, fat, barcodeUpc }, userId);
      return res.json({ entry });
    }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/3_applications/health/FoodCatalogService.suggest.test.mjs`
Expected: PASS (5 tests). Also run existing catalog-adjacent tests if any: `npx vitest run backend/src --reporter=dot -t catalog` (no regressions).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/entities/FoodCatalogEntry.mjs backend/src/1_adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs backend/src/3_applications/health/FoodCatalogService.mjs backend/src/3_applications/health/FoodCatalogService.suggest.test.mjs backend/src/4_api/v1/routers/health.mjs
git commit -m "feat(health): catalog favorites, ranked suggest, custom foods, UPC index"
```

---

### Task B5: Catalog-first UPC resolution + unknownUpc signal

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs`
- Modify: `backend/src/1_adapters/nutribot/WebNutribotAdapter.mjs` (thread use-case result fields through the web response)
- Create: `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.catalog.test.mjs`

**Interfaces:**
- Consumes: `catalogService.getByUpc(upc, userId)` (B4) — `LogFoodFromUPC` already receives `catalogService` in deps (`LogFoodFromUPC.mjs:41`).
- Produces: in `execute()`, **before** `upcGateway.lookup` (step 3, line ~110): a catalog hit becomes the product (`{ name, brand: null, imageUrl: null, serving: { size: 1, unit: 'serving' }, nutrition: entry.nutrients }`) and the external gateway is not called. A double miss returns `{ success: false, error: 'Product not found', unknownUpc: true, upc }` (currently returns only `{success, error}` at line 123). The web response from `POST /nutrition/input {type:'barcode'}` carries `unknownUpc` and `upc` at the top level.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.catalog.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { LogFoodFromUPC } from './LogFoodFromUPC.mjs';

const messagingStub = () => ({
  sendMessage: vi.fn(async () => ({ messageId: 'm1' })),
  sendPhoto: vi.fn(async () => ({ messageId: 'm2' })),
  updateMessage: vi.fn(async () => {}),
  deleteMessage: vi.fn(async () => {}),
});

const makeUseCase = ({ catalogHit = null, gatewayHit = null } = {}) => {
  const upcGateway = { lookup: vi.fn(async () => gatewayHit) };
  const foodLogStore = { save: vi.fn(async () => {}) };
  const uc = new LogFoodFromUPC({
    messagingGateway: messagingStub(),
    upcGateway,
    foodLogStore,
    catalogService: {
      getByUpc: vi.fn(async () => catalogHit),
      recordUsage: vi.fn(async () => {}),
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return { uc, upcGateway, foodLogStore };
};

describe('LogFoodFromUPC catalog-first', () => {
  it('a catalog UPC hit short-circuits the external gateway', async () => {
    const { uc, upcGateway, foodLogStore } = makeUseCase({
      catalogHit: {
        name: 'Local Granola',
        nutrients: { calories: 210, protein: 5, carbs: 30, fat: 8 },
      },
    });
    const result = await uc.execute({ userId: 'u', conversationId: 'c', upc: '012345678905' });
    expect(result.success).toBe(true);
    expect(result.product.name).toBe('Local Granola');
    expect(upcGateway.lookup).not.toHaveBeenCalled();
    expect(foodLogStore.save).toHaveBeenCalled();
  });

  it('a double miss reports unknownUpc with the code', async () => {
    const { uc } = makeUseCase({});
    const result = await uc.execute({ userId: 'u', conversationId: 'c', upc: '000000000000' });
    expect(result.success).toBe(false);
    expect(result.unknownUpc).toBe(true);
    expect(result.upc).toBe('000000000000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.catalog.test.mjs`
Expected: FAIL — external gateway called on catalog hit / `unknownUpc` undefined

- [ ] **Step 3: Modify the use case**

In `LogFoodFromUPC.execute`, replace step 3 (`// 3. Call UPC gateway`, line ~109) with:

```javascript
      // 3. Resolve product: user's catalog first (custom mappings win and can
      // override bad upstream data — spec Data model §3), then the gateway.
      let product = null;
      if (this.#catalogService?.getByUpc) {
        try {
          const entry = await this.#catalogService.getByUpc(upc, userId);
          if (entry) {
            product = {
              name: entry.name,
              brand: null,
              imageUrl: null,
              serving: { size: 1, unit: 'serving' },
              nutrition: { ...entry.nutrients },
            };
            this.#logger.info?.('logUPC.catalogHit', { upc, name: entry.name });
          }
        } catch (e) {
          this.#logger.warn?.('logUPC.catalogLookupFailed', { upc, error: e.message });
        }
      }
      if (!product && this.#upcGateway) {
        product = await this.#upcGateway.lookup(upc);
      }
```

And change the not-found return (line ~123) to:

```javascript
        return { success: false, error: 'Product not found', unknownUpc: true, upc };
```

- [ ] **Step 4: Thread through the web adapter**

Read `backend/src/1_adapters/nutribot/WebNutribotAdapter.mjs` and find where `process({type:'barcode'})` returns its captured-messages result. Merge the use-case result into the response so `unknownUpc`/`upc` (and `success`) reach the HTTP caller, e.g. `return { ...useCaseResult, messages: captured }` — preserving the existing `messages` key exactly as the frontend consumes it today.

- [ ] **Step 5: Run tests to verify**

Run: `npx vitest run backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.catalog.test.mjs`
Expected: PASS (2 tests)

Also run the existing nutribot suite to check for regressions: `npx vitest run backend/src/3_applications/nutribot --reporter=dot`

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs backend/src/1_adapters/nutribot/WebNutribotAdapter.mjs backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.catalog.test.mjs
git commit -m "feat(nutribot): catalog-first UPC resolution and unknownUpc signal"
```

---

### Task B6: Saved meals

**Files:**
- Create: `backend/src/3_applications/health/ports/ISavedMealsDatastore.mjs`
- Create: `backend/src/1_adapters/persistence/yaml/YamlSavedMealsDatastore.mjs`
- Create: `backend/src/3_applications/health/SavedMealsService.mjs`
- Create: `backend/src/3_applications/health/SavedMealsService.test.mjs`
- Modify: `backend/src/4_api/v1/routers/health.mjs` (endpoints, gated `if (savedMealsService)`)
- Modify: `backend/src/5_composition/modules/healthApi.mjs` (wire store + service, pass to router)

**Interfaces:**
- Consumes: `nutriListStore.saveMany(items)` (existing; items need `uuid,userId,name,item,calories,protein,carbs,fat,grams,unit,amount,color,date,log_uuid` — quickAdd precedent at `FoodCatalogService.mjs:92-107`), `dataService.user.read/write`.
- Produces: `ISavedMealsDatastore` (`list(userId)`, `getById(id,userId)`, `save(meal,userId)`, `remove(id,userId)`); `YamlSavedMealsDatastore` (path `apps/health/meals`, plain objects — no entity class, the service validates); `SavedMealsService`: `list(userId)`, `create({name, items}, userId) → meal` (items snapshot `{name, calories, protein, carbs, fat, color?}` — later catalog edits never mutate a saved meal), `logToDate(mealId, userId, { date, mealTime }) → { items }` (writes NutriList rows `log_uuid: 'SAVEDMEAL'`, bumps `useCount`/`lastUsed`), `remove(id, userId)`. Endpoints: `GET /nutrition/meals` → `{ meals }`, `POST /nutrition/meals` `{name, items}` → `{ meal }`, `POST /nutrition/meals/:id/log` `{date?, mealTime?}` → `{ items }`, `DELETE /nutrition/meals/:id` → `{ ok: true }`. (Deliberate deviation from the spec's "writes one NutriLog": saved-meal logging follows the QUICKADD precedent — direct NutriList rows — so it reuses the exact mechanism quick-add already ships.)

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/3_applications/health/SavedMealsService.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SavedMealsService } from './SavedMealsService.mjs';

describe('SavedMealsService', () => {
  let store, nutriList, svc;
  beforeEach(() => {
    const meals = new Map();
    store = {
      list: async () => [...meals.values()],
      getById: async (id) => meals.get(id) || null,
      save: async (m) => { meals.set(m.id, m); },
      remove: async (id) => { meals.delete(id); },
    };
    nutriList = { saveMany: vi.fn(async () => {}) };
    svc = new SavedMealsService({
      mealsStore: store, nutriListStore: nutriList,
      clock: { now: () => new Date('2026-09-02T18:00:00Z').getTime() },
      createId: (() => { let n = 0; return () => `id-${n++}`; })(),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
  });

  it('create snapshots items and initializes usage', async () => {
    const meal = await svc.create({
      name: 'Protein breakfast',
      items: [{ name: 'Eggs', calories: 140, protein: 12, carbs: 1, fat: 10 }],
    }, 'u');
    expect(meal.id).toBe('id-0');
    expect(meal.useCount).toBe(0);
    expect(meal.items[0].calories).toBe(140);
  });

  it('create rejects empty items', async () => {
    await expect(svc.create({ name: 'x', items: [] }, 'u')).rejects.toThrow(/items/);
  });

  it('logToDate writes SAVEDMEAL nutrilist rows for the date and bumps usage', async () => {
    const meal = await svc.create({
      name: 'PB', items: [{ name: 'Eggs', calories: 140, protein: 12, carbs: 1, fat: 10 }],
    }, 'u');
    const out = await svc.logToDate(meal.id, 'u', { date: '2026-09-02', mealTime: 'morning' });
    expect(nutriList.saveMany).toHaveBeenCalledTimes(1);
    const rows = nutriList.saveMany.mock.calls[0][0];
    expect(rows[0]).toMatchObject({
      name: 'Eggs', calories: 140, date: '2026-09-02',
      log_uuid: 'SAVEDMEAL', mealTime: 'morning', userId: 'u',
    });
    expect(out.items).toHaveLength(1);
    expect((await store.getById(meal.id)).useCount).toBe(1);
  });

  it('logToDate defaults date to today and mealTime from the hour', async () => {
    const meal = await svc.create({ name: 'PB', items: [{ name: 'Eggs', calories: 140 }] }, 'u');
    await svc.logToDate(meal.id, 'u', {});
    const rows = nutriList.saveMany.mock.calls[0][0];
    expect(rows[0].date).toBe('2026-09-02');
    expect(['morning', 'afternooon', 'afternoon', 'evening', 'night']).toContain(rows[0].mealTime);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/3_applications/health/SavedMealsService.test.mjs`
Expected: FAIL — cannot resolve `./SavedMealsService.mjs`

- [ ] **Step 3: Write the implementations**

```javascript
// backend/src/3_applications/health/ports/ISavedMealsDatastore.mjs
export class ISavedMealsDatastore {
  async list(userId) { throw new Error('ISavedMealsDatastore.list must be implemented'); }
  async getById(id, userId) { throw new Error('ISavedMealsDatastore.getById must be implemented'); }
  async save(meal, userId) { throw new Error('ISavedMealsDatastore.save must be implemented'); }
  async remove(id, userId) { throw new Error('ISavedMealsDatastore.remove must be implemented'); }
}
export default ISavedMealsDatastore;
```

```javascript
// backend/src/1_adapters/persistence/yaml/YamlSavedMealsDatastore.mjs
// Storage: data/users/{username}/apps/health/meals.yml — array of meal objects.
import { ISavedMealsDatastore } from '#apps/health/ports/ISavedMealsDatastore.mjs';

export class YamlSavedMealsDatastore extends ISavedMealsDatastore {
  #dataService;
  static MEALS_PATH = 'apps/health/meals';

  constructor(config) {
    super();
    if (!config.dataService) throw new Error('YamlSavedMealsDatastore requires dataService');
    this.#dataService = config.dataService;
  }

  #load(userId) {
    const raw = this.#dataService.user.read?.(YamlSavedMealsDatastore.MEALS_PATH, userId);
    return Array.isArray(raw) ? raw : [];
  }
  #write(meals, userId) {
    this.#dataService.user.write?.(YamlSavedMealsDatastore.MEALS_PATH, meals, userId);
  }

  async list(userId) { return this.#load(userId); }
  async getById(id, userId) { return this.#load(userId).find((m) => m.id === id) || null; }
  async save(meal, userId) {
    const meals = this.#load(userId);
    const idx = meals.findIndex((m) => m.id === meal.id);
    if (idx >= 0) meals[idx] = meal; else meals.push(meal);
    this.#write(meals, userId);
  }
  async remove(id, userId) {
    this.#write(this.#load(userId).filter((m) => m.id !== id), userId);
  }
}
export default YamlSavedMealsDatastore;
```

```javascript
// backend/src/3_applications/health/SavedMealsService.mjs
//
// Named multi-item meal templates. Items are SNAPSHOTS — a later catalog
// edit never mutates a saved meal. Logging writes NutriList rows directly
// (log_uuid 'SAVEDMEAL'), the same mechanism quick-add uses.

const mealTimeFromHour = (h) => (h < 11 ? 'morning' : h < 15 ? 'afternoon' : h < 20 ? 'evening' : 'night');

const snapshotItem = (item) => ({
  name: String(item.name),
  calories: Number(item.calories) || 0,
  protein: Number(item.protein) || 0,
  carbs: Number(item.carbs) || 0,
  fat: Number(item.fat) || 0,
  color: item.color || 'yellow',
});

export class SavedMealsService {
  #mealsStore; #nutriListStore; #clock; #createId; #logger;

  constructor({ mealsStore, nutriListStore, clock, createId, logger }) {
    if (!mealsStore || !nutriListStore || !clock?.now || typeof createId !== 'function') {
      throw new Error('SavedMealsService requires mealsStore, nutriListStore, clock, createId');
    }
    this.#mealsStore = mealsStore;
    this.#nutriListStore = nutriListStore;
    this.#clock = clock;
    this.#createId = createId;
    this.#logger = logger || console;
  }

  async list(userId) {
    const meals = await this.#mealsStore.list(userId);
    return meals.sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
  }

  async create({ name, items }, userId) {
    if (!name) throw new Error('SavedMeal requires name');
    if (!Array.isArray(items) || items.length === 0) throw new Error('SavedMeal requires items');
    const meal = {
      id: this.#createId(),
      name,
      items: items.map(snapshotItem),
      createdAt: new Date(this.#clock.now()).toISOString(),
      useCount: 0,
      lastUsed: null,
    };
    await this.#mealsStore.save(meal, userId);
    this.#logger.info?.('health.meals.created', { name, itemCount: meal.items.length });
    return meal;
  }

  async logToDate(mealId, userId, { date, mealTime } = {}) {
    const meal = await this.#mealsStore.getById(mealId, userId);
    if (!meal) throw new Error(`Saved meal not found: ${mealId}`);

    const now = new Date(this.#clock.now());
    const targetDate = date || now.toISOString().slice(0, 10);
    const targetMealTime = mealTime || mealTimeFromHour(now.getHours());

    const rows = meal.items.map((item) => ({
      uuid: this.#createId(),
      userId,
      item: item.name,
      name: item.name,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
      grams: 0,
      unit: 'serving',
      amount: 1,
      color: item.color,
      date: targetDate,
      mealTime: targetMealTime,
      log_uuid: 'SAVEDMEAL',
    }));
    await this.#nutriListStore.saveMany(rows);

    meal.useCount = (meal.useCount || 0) + 1;
    meal.lastUsed = targetDate;
    await this.#mealsStore.save(meal, userId);

    this.#logger.info?.('health.meals.logged', { mealId, date: targetDate, items: rows.length });
    return { items: rows };
  }

  async remove(id, userId) {
    await this.#mealsStore.remove(id, userId);
    this.#logger.info?.('health.meals.removed', { id });
  }
}
export default SavedMealsService;
```

Router endpoints (in `health.mjs`, new gated block; add `savedMealsService` to the config destructure):

```javascript
  if (savedMealsService) {
    router.get('/nutrition/meals', asyncHandler(async (req, res) =>
      res.json({ meals: await savedMealsService.list(getDefaultUsername()) })));

    router.post('/nutrition/meals', asyncHandler(async (req, res) => {
      const { name, items } = req.body;
      try {
        return res.json({ meal: await savedMealsService.create({ name, items }, getDefaultUsername()) });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }));

    router.post('/nutrition/meals/:id/log', asyncHandler(async (req, res) => {
      const { date, mealTime } = req.body || {};
      try {
        return res.json(await savedMealsService.logToDate(req.params.id, getDefaultUsername(), { date, mealTime }));
      } catch (err) {
        return res.status(404).json({ error: err.message });
      }
    }));

    router.delete('/nutrition/meals/:id', asyncHandler(async (req, res) => {
      await savedMealsService.remove(req.params.id, getDefaultUsername());
      return res.json({ ok: true });
    }));
  }
```

Wiring in `healthApi.mjs` (next to the budget wiring from B3):

```javascript
  const savedMealsService = new SavedMealsService({
    mealsStore: new YamlSavedMealsDatastore({ dataService }),
    nutriListStore: healthServices.nutriListStore,
    clock: { now: () => Date.now() },
    createId: uuidv4,
    logger,
  });
```

…and pass `savedMealsService` to `createHealthRouter`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/3_applications/health/SavedMealsService.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/health/ports/ISavedMealsDatastore.mjs backend/src/1_adapters/persistence/yaml/YamlSavedMealsDatastore.mjs backend/src/3_applications/health/SavedMealsService.mjs backend/src/3_applications/health/SavedMealsService.test.mjs backend/src/4_api/v1/routers/health.mjs backend/src/5_composition/modules/healthApi.mjs
git commit -m "feat(health): saved meals — snapshot templates, one-tap logging"
```

---

### Task B7: Medical readings store + endpoints

**Files:**
- Create: `backend/src/3_applications/health/ports/IMedicalReadingsDatastore.mjs`
- Create: `backend/src/1_adapters/persistence/yaml/YamlMedicalReadingsDatastore.mjs`
- Create: `backend/src/3_applications/health/MedicalReadingsService.mjs`
- Create: `backend/src/3_applications/health/MedicalReadingsService.test.mjs`
- Modify: `backend/src/4_api/v1/routers/health.mjs` + `backend/src/5_composition/modules/healthApi.mjs` (endpoints + wiring, same pattern as B6)

**Interfaces:**
- Produces: readings shape `{ id, metric, value, value2, unit, date, note }` stored at `apps/health/medical` as `{ readings: [...] }`. Service: `listGrouped(userId) → { metrics: [{ metric, unit, latest, readings }] }` (readings date-desc), `add(reading, userId) → reading` (validates: `metric` non-empty string, `value` finite number, `value2` finite-or-null, `date` `YYYY-MM-DD` — rejects non-finite without coercion), `remove(id, userId)`. Endpoints: `GET /medical`, `POST /medical`, `DELETE /medical/:id`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/3_applications/health/MedicalReadingsService.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { MedicalReadingsService } from './MedicalReadingsService.mjs';

describe('MedicalReadingsService', () => {
  let svc, saved;
  beforeEach(() => {
    saved = { readings: [] };
    svc = new MedicalReadingsService({
      store: {
        load: async () => saved,
        save: async (doc) => { saved = doc; },
      },
      createId: (() => { let n = 0; return () => `r-${n++}`; })(),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
  });

  it('adds a BP reading with value2', async () => {
    const r = await svc.add({ metric: 'bp', value: 120, value2: 80, unit: 'mmHg', date: '2026-09-02' }, 'u');
    expect(r.id).toBe('r-0');
    expect(saved.readings).toHaveLength(1);
  });

  it('rejects non-finite values without coercion', async () => {
    await expect(svc.add({ metric: 'bp', value: '120', unit: 'mmHg', date: '2026-09-02' }, 'u'))
      .rejects.toThrow(/INVALID_READING/);
    await expect(svc.add({ metric: 'glucose', value: NaN, unit: 'mg/dL', date: '2026-09-02' }, 'u'))
      .rejects.toThrow(/INVALID_READING/);
  });

  it('rejects malformed dates and empty metrics', async () => {
    await expect(svc.add({ metric: '', value: 1, unit: 'x', date: '2026-09-02' }, 'u')).rejects.toThrow(/INVALID_READING/);
    await expect(svc.add({ metric: 'bp', value: 1, unit: 'x', date: '9/2/26' }, 'u')).rejects.toThrow(/INVALID_READING/);
  });

  it('groups by metric with latest first', async () => {
    await svc.add({ metric: 'bp', value: 120, value2: 80, unit: 'mmHg', date: '2026-09-01' }, 'u');
    await svc.add({ metric: 'bp', value: 118, value2: 78, unit: 'mmHg', date: '2026-09-02' }, 'u');
    await svc.add({ metric: 'glucose', value: 92, unit: 'mg/dL', date: '2026-09-02' }, 'u');
    const { metrics } = await svc.listGrouped('u');
    expect(metrics).toHaveLength(2);
    const bp = metrics.find((m) => m.metric === 'bp');
    expect(bp.latest.value).toBe(118);
    expect(bp.readings[0].date).toBe('2026-09-02');
  });

  it('removes by id', async () => {
    const r = await svc.add({ metric: 'bp', value: 120, value2: 80, unit: 'mmHg', date: '2026-09-02' }, 'u');
    await svc.remove(r.id, 'u');
    expect(saved.readings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/3_applications/health/MedicalReadingsService.test.mjs`
Expected: FAIL — cannot resolve `./MedicalReadingsService.mjs`

- [ ] **Step 3: Write the implementations**

```javascript
// backend/src/3_applications/health/ports/IMedicalReadingsDatastore.mjs
export class IMedicalReadingsDatastore {
  async load(userId) { throw new Error('IMedicalReadingsDatastore.load must be implemented'); }
  async save(doc, userId) { throw new Error('IMedicalReadingsDatastore.save must be implemented'); }
}
export default IMedicalReadingsDatastore;
```

```javascript
// backend/src/1_adapters/persistence/yaml/YamlMedicalReadingsDatastore.mjs
// Storage: data/users/{username}/apps/health/medical.yml — { readings: [...] }
import { IMedicalReadingsDatastore } from '#apps/health/ports/IMedicalReadingsDatastore.mjs';

export class YamlMedicalReadingsDatastore extends IMedicalReadingsDatastore {
  #dataService;
  static MEDICAL_PATH = 'apps/health/medical';

  constructor(config) {
    super();
    if (!config.dataService) throw new Error('YamlMedicalReadingsDatastore requires dataService');
    this.#dataService = config.dataService;
  }

  async load(userId) {
    const raw = this.#dataService.user.read?.(YamlMedicalReadingsDatastore.MEDICAL_PATH, userId);
    return raw && Array.isArray(raw.readings) ? raw : { readings: [] };
  }
  async save(doc, userId) {
    this.#dataService.user.write?.(YamlMedicalReadingsDatastore.MEDICAL_PATH, doc, userId);
  }
}
export default YamlMedicalReadingsDatastore;
```

```javascript
// backend/src/3_applications/health/MedicalReadingsService.mjs
//
// Deliberately dumb store of manual medical readings (BP, labs). Validation
// only — no interpretation. value2 exists for BP diastolic.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const invalid = (msg) => {
  const err = new Error(`INVALID_READING: ${msg}`);
  err.code = 'INVALID_READING';
  return err;
};

export class MedicalReadingsService {
  #store; #createId; #logger;

  constructor({ store, createId, logger }) {
    if (!store || typeof createId !== 'function') {
      throw new Error('MedicalReadingsService requires store and createId');
    }
    this.#store = store;
    this.#createId = createId;
    this.#logger = logger || console;
  }

  async add(reading, userId) {
    const { metric, value, value2 = null, unit = '', date, note = '' } = reading || {};
    if (typeof metric !== 'string' || !metric.trim()) throw invalid('metric required');
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid('value must be a finite number');
    if (value2 !== null && (typeof value2 !== 'number' || !Number.isFinite(value2))) throw invalid('value2 must be a finite number or null');
    if (typeof date !== 'string' || !DATE_RE.test(date)) throw invalid('date must be YYYY-MM-DD');

    const doc = await this.#store.load(userId);
    const entry = { id: this.#createId(), metric: metric.trim(), value, value2, unit, date, note };
    doc.readings.push(entry);
    await this.#store.save(doc, userId);
    this.#logger.info?.('health.medical.added', { metric: entry.metric, date });
    return entry;
  }

  async listGrouped(userId) {
    const doc = await this.#store.load(userId);
    const byMetric = new Map();
    for (const r of doc.readings) {
      if (!byMetric.has(r.metric)) byMetric.set(r.metric, []);
      byMetric.get(r.metric).push(r);
    }
    const metrics = [...byMetric.entries()].map(([metric, readings]) => {
      const sorted = [...readings].sort((a, b) => b.date.localeCompare(a.date));
      return { metric, unit: sorted[0].unit, latest: sorted[0], readings: sorted };
    }).sort((a, b) => a.metric.localeCompare(b.metric));
    return { metrics };
  }

  async remove(id, userId) {
    const doc = await this.#store.load(userId);
    doc.readings = doc.readings.filter((r) => r.id !== id);
    await this.#store.save(doc, userId);
    this.#logger.info?.('health.medical.removed', { id });
  }
}
export default MedicalReadingsService;
```

Router (gated `if (medicalService)`, config-destructured like the others):

```javascript
  if (medicalService) {
    router.get('/medical', asyncHandler(async (req, res) =>
      res.json(await medicalService.listGrouped(getDefaultUsername()))));

    router.post('/medical', asyncHandler(async (req, res) => {
      try {
        return res.json({ reading: await medicalService.add(req.body, getDefaultUsername()) });
      } catch (err) {
        if (err.code === 'INVALID_READING') return res.status(400).json({ error: err.message });
        throw err;
      }
    }));

    router.delete('/medical/:id', asyncHandler(async (req, res) => {
      await medicalService.remove(req.params.id, getDefaultUsername());
      return res.json({ ok: true });
    }));
  }
```

Wiring in `healthApi.mjs`:

```javascript
  const medicalService = new MedicalReadingsService({
    store: new YamlMedicalReadingsDatastore({ dataService }),
    createId: uuidv4,
    logger,
  });
```

…passed to `createHealthRouter`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/3_applications/health/MedicalReadingsService.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/health/ports/IMedicalReadingsDatastore.mjs backend/src/1_adapters/persistence/yaml/YamlMedicalReadingsDatastore.mjs backend/src/3_applications/health/MedicalReadingsService.mjs backend/src/3_applications/health/MedicalReadingsService.test.mjs backend/src/4_api/v1/routers/health.mjs backend/src/5_composition/modules/healthApi.mjs
git commit -m "feat(health): medical readings store and endpoints"
```

---

### Task B8: mealTime on NutriList rows

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs:163-173` (`syncFromLog` row construction)
- Modify: `backend/src/3_applications/health/FoodCatalogService.mjs` (`quickAdd` rows get `mealTime` from the hour)
- Create: `backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mealtime.test.mjs`

**Interfaces:**
- Produces: every NutriList row synced from a log carries `mealTime: nutriLog.meal?.time ?? null` (values `morning|afternoon|evening|night`); quick-add rows derive it from the wall-clock hour (same thresholds as `SavedMealsService.mealTimeFromHour`: <11 morning, <15 afternoon, <20 evening, else night). The existing `PUT /nutrilist/:uuid` update path must pass `mealTime` through unchanged — check `update()` at `YamlNutriListDatastore.mjs:323`; if it whitelists fields, add `mealTime`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mealtime.test.mjs
import { describe, it, expect } from 'vitest';
import { YamlNutriListDatastore } from './YamlNutriListDatastore.mjs';

// Minimal in-memory dataService shim matching the read/write surface this
// datastore uses (inspect its constructor/#readFile to match exactly).
const makeStore = () => {
  const files = new Map();
  // NOTE: adapt this shim to the datastore's actual IO surface on first run —
  // the constructor signature is visible at the top of YamlNutriListDatastore.mjs.
  const dataService = {
    user: {
      read: (p, u) => files.get(`${u}:${p}`) ?? null,
      write: (p, data, u) => { files.set(`${u}:${p}`, data); },
    },
  };
  return { store: new YamlNutriListDatastore({ dataService }), files };
};

const fakeLog = {
  id: 'log-1', uuid: 'log-1', userId: 'u', isAccepted: true,
  meal: { date: '2026-09-02', time: 'afternoon' },
  items: [{ uuid: 'item-1', label: 'Sandwich', calories: 400, protein: 20, carbs: 40, fat: 15 }],
};

describe('mealTime denormalization', () => {
  it('syncFromLog copies meal.time onto each row', async () => {
    const { store } = makeStore();
    await store.syncFromLog(fakeLog);
    const rows = await store.findByDate('u', '2026-09-02');
    expect(rows).toHaveLength(1);
    expect(rows[0].mealTime).toBe('afternoon');
  });

  it('a log without meal.time yields mealTime null (UNGROUPED)', async () => {
    const { store } = makeStore();
    await store.syncFromLog({ ...fakeLog, meal: { date: '2026-09-02' } });
    const rows = await store.findByDate('u', '2026-09-02');
    expect(rows[0].mealTime).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mealtime.test.mjs`
Expected: FAIL — `mealTime` undefined. **If the constructor/IO shim doesn't match** (the datastore may use `#getPath`/direct file IO helpers rather than `dataService.user`), read the constructor at the top of `YamlNutriListDatastore.mjs` first and adjust the shim so the test exercises the real `syncFromLog` — do not weaken the assertions.

- [ ] **Step 3: Make the changes**

In `syncFromLog` (line ~166), add to the mapped row object:

```javascript
        mealTime: nutriLog.meal?.time ?? null,
```

In `FoodCatalogService.quickAdd` (line ~92), add to the `item` object:

```javascript
      mealTime: (() => { const h = new Date(this.#clock.now()).getHours(); return h < 11 ? 'morning' : h < 15 ? 'afternoon' : h < 20 ? 'evening' : 'night'; })(),
```

Check `update()` (line ~323): if it merges `updates` wholesale, nothing to do; if it whitelists fields, add `mealTime` to the whitelist.

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mealtime.test.mjs`
Expected: PASS (2 tests). Then `npx vitest run backend/src/1_adapters/persistence/yaml --reporter=dot` for regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mealtime.test.mjs backend/src/3_applications/health/FoodCatalogService.mjs
git commit -m "feat(health): denormalize mealTime onto NutriList rows"
```

---

### Task B9: Coach log_food tool

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/tools/NutritionActionToolFactory.mjs`
- Create: `backend/src/3_applications/agents/health-coach/tools/NutritionActionToolFactory.test.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs` (import + guarded registration in `registerTools()`, line ~250)
- Modify: the composition site constructing `HealthCoachAgent` (find with `grep -rn "new HealthCoachAgent" backend/src/5_composition/`) — add `nutritionInput` to its deps, wired to the same `webNutribotAdapter` the health router uses.

**Interfaces:**
- Consumes: `nutritionInput.process({ type: 'text', content, userId })` (the `WebNutribotAdapter` surface `HealthOperations.processNutritionInput` delegates to at `HealthOperations.mjs:129`).
- Produces: tool `log_food` — parameters `{ userId, description, date? }`; runs the text pipeline; returns `{ status: 'pending_confirmation', summary }` where `summary` is the first message text from the pipeline result. **Never accepts** — the human confirms in the UI. Errors return `{ error }` (tool-envelope convention, see `PersonalBaselineToolFactory.mjs:44-48`).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/3_applications/agents/health-coach/tools/NutritionActionToolFactory.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { NutritionActionToolFactory } from './NutritionActionToolFactory.mjs';

describe('NutritionActionToolFactory', () => {
  const make = (process) => {
    const factory = new NutritionActionToolFactory({ nutritionInput: { process } });
    const tools = factory.createTools();
    return tools.find((t) => t.name === 'log_food');
  };

  it('creates a pending log via the text pipeline and never accepts', async () => {
    const process = vi.fn(async () => ({ messages: [{ text: '🟡 2 eggs — 140 kcal' }] }));
    const tool = make(process);
    const out = await tool.execute({ userId: 'u', description: '2 eggs' });
    expect(process).toHaveBeenCalledWith({ type: 'text', content: '2 eggs', userId: 'u' });
    expect(out.status).toBe('pending_confirmation');
    expect(out.summary).toContain('2 eggs');
  });

  it('returns an error envelope on pipeline failure', async () => {
    const tool = make(vi.fn(async () => { throw new Error('parse failed'); }));
    const out = await tool.execute({ userId: 'u', description: 'gibberish' });
    expect(out.error).toMatch(/parse failed/);
  });

  it('requires a description', async () => {
    const tool = make(vi.fn());
    const out = await tool.execute({ userId: 'u', description: '' });
    expect(out.error).toMatch(/description/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/3_applications/agents/health-coach/tools/NutritionActionToolFactory.test.mjs`
Expected: FAIL — cannot resolve the factory

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/3_applications/agents/health-coach/tools/NutritionActionToolFactory.mjs
import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

/**
 * Registers `log_food` — the coach's WRITE path into nutrition. It runs the
 * same text pipeline the web AddBar uses, so entries land as PENDING and the
 * human confirms them in the UI. The coach can never auto-accept a meal.
 */
export class NutritionActionToolFactory extends ToolFactory {
  static domain = 'health-coach';
  #nutritionInput;

  constructor({ nutritionInput }) {
    super({ nutritionInput });
    if (!nutritionInput) throw new Error('NutritionActionToolFactory: nutritionInput required');
    this.#nutritionInput = nutritionInput;
  }

  createTools() {
    const nutritionInput = this.#nutritionInput;
    return [
      createTool({
        name: 'log_food',
        description:
          'Log food the user described in conversation. Parses the description '
          + 'into itemized entries with estimated macros and creates a PENDING '
          + 'log the user must confirm in the Health app — you cannot accept it '
          + 'for them. Use when the user asks you to log/record a meal. Returns '
          + '{ status: "pending_confirmation", summary }.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            description: { type: 'string', description: 'The food in the user\'s words, e.g. "chipotle bowl, no rice"' },
          },
          required: ['userId', 'description'],
        },
        execute: async ({ userId, description }) => {
          try {
            if (!description || !description.trim()) {
              return { error: 'description is required' };
            }
            const result = await nutritionInput.process({
              type: 'text', content: description.trim(), userId,
            });
            const summary = result?.messages?.[0]?.text || 'Logged (pending confirmation)';
            return { status: 'pending_confirmation', summary };
          } catch (err) {
            return { error: err?.message || String(err) };
          }
        },
      }),
    ];
  }
}
export default NutritionActionToolFactory;
```

In `HealthCoachAgent.registerTools()` (after the PersonalBaselineToolFactory registration, line ~311), add:

```javascript
    // NutritionActionToolFactory: the coach's write path into food logging.
    if (this.deps.nutritionInput) {
      this.addToolFactory(new NutritionActionToolFactory({ nutritionInput: this.deps.nutritionInput }));
    }
```

…with the matching import at the top of the file. Then find the composition site (`grep -rn "new HealthCoachAgent" backend/src/5_composition/`) and add `nutritionInput: webNutribotAdapter` to its deps (the adapter is already constructed for the health router — pass the same instance).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/3_applications/agents/health-coach/tools/NutritionActionToolFactory.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/NutritionActionToolFactory.mjs backend/src/3_applications/agents/health-coach/tools/NutritionActionToolFactory.test.mjs backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs backend/src/5_composition/
git commit -m "feat(health): coach log_food tool — pending-only write path"
```

---

## Part F — Frontend

All Part F components live under `frontend/src/modules/Health/` in new subfolders (`today/`, `capture/`, `progress/`, `medical/`); the app entry is `frontend/src/Apps/HealthApp.jsx`. Shared styling in `frontend/src/modules/Health/health.scss` — **`var(--ds-*)` tokens only** (the `audit:ui` gate rejects raw colors). Logging via `createAppLogger('health')`.

Meal-bucket vocabulary used throughout Part F (define once in F2's `mealBuckets.js`):

```javascript
export const BUCKETS = [
  { id: 'morning',   label: 'Breakfast' },
  { id: 'afternoon', label: 'Lunch' },
  { id: 'evening',   label: 'Dinner' },
  { id: 'night',     label: 'Snacks' },
];
export const UNGROUPED = { id: null, label: 'Ungrouped' };
```

### Task F1: App shell — tabs, theme pack, hotkey

**Files:**
- Rewrite: `frontend/src/Apps/HealthApp.jsx`
- Create: `frontend/src/modules/Health/health.scss`
- Delete: `frontend/src/Apps/HealthApp.scss`, `frontend/src/Apps/HealthApp.theme.js` (superseded by the DS pack)

**Interfaces:**
- Consumes: `AppThemeProvider, AppChrome, DismissStackProvider, AskAffordance` from `@/lib/ui`; `useHotkey` from `@/lib/hooks/useHotkey.js`; existing `ChatOverlay` + `CoachChat` (kept as-is for the ⌘K overlay).
- Produces: four-tab shell (`today | progress | health | coach`); tab state in a `useState` (no router change — `/health` stays a bare route); ⌘K opens the chat overlay from any tab. Tab views arrive in later tasks — F1 mounts placeholder `<EmptyState>`s so the shell ships runnable.

- [ ] **Step 1: Rewrite the entry**

```jsx
// frontend/src/Apps/HealthApp.jsx
import { useState } from 'react';
import '@mantine/core/styles.css';
import {
  AppThemeProvider, AppChrome, DismissStackProvider, EmptyState,
} from '@/lib/ui';
import { useHotkey } from '@/lib/hooks/useHotkey.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import CoachChat from '../modules/Health/CoachChat';
import { ChatOverlay } from '../modules/Health/ChatOverlay/index.jsx';
import '../modules/Health/health.scss';

const Icon = ({ d }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const TABS = [
  { id: 'today', label: 'Today', icon: <Icon d="M4 10h12M10 4v12" /> },
  { id: 'progress', label: 'Progress', icon: <Icon d="M3 15l4-6 4 3 6-8" /> },
  { id: 'health', label: 'Health', icon: <Icon d="M10 17s-6-3.5-6-8a3.5 3.5 0 016-2.4A3.5 3.5 0 0116 9c0 4.5-6 8-6 8z" /> },
  { id: 'coach', label: 'Coach', icon: <Icon d="M3 5h14v9H8l-4 3v-3H3z" /> },
];

const userId = (typeof window !== 'undefined' && window.DAYLIGHT_USER_ID) || 'default';

const HealthApp = () => {
  useDocumentTitle('Health');
  const [tab, setTab] = useState('today');
  const [overlayOpen, setOverlayOpen] = useState(false);
  useHotkey('mod+k', () => setOverlayOpen(true));

  return (
    <AppThemeProvider pack="health">
      <DismissStackProvider>
        <AppChrome title="Health" tabs={TABS} activeTab={tab} onTabChange={setTab}>
          {tab === 'today' && <EmptyState title="Today" hint="Log view lands in Task F4" />}
          {tab === 'progress' && <EmptyState title="Progress" hint="Lands in Task F9" />}
          {tab === 'health' && <EmptyState title="Health" hint="Lands in Task F9" />}
          {tab === 'coach' && <CoachChat userId={userId} variant="full" />}
        </AppChrome>
        <ChatOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} userId={userId}>
          <CoachChat userId={userId} variant="overlay" />
        </ChatOverlay>
      </DismissStackProvider>
    </AppThemeProvider>
  );
};

export default HealthApp;
```

Create `frontend/src/modules/Health/health.scss` with just the file header comment for now (styles accrete in later tasks). Delete `HealthApp.scss` and `HealthApp.theme.js`; grep for any remaining importers of the theme file (`grep -rn "HealthApp.theme" frontend/src`) and remove those imports.

- [ ] **Step 2: Verify in the browser**

Load `/health` on the dev server: shell renders with four tabs (bottom bar at phone width, left rail at desktop width), Coach tab shows the chat, ⌘K opens the overlay, Escape closes it. No console errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Apps/HealthApp.jsx frontend/src/modules/Health/health.scss
git rm frontend/src/Apps/HealthApp.scss frontend/src/Apps/HealthApp.theme.js
git commit -m "feat(health-ui): DS shell — four tabs, pack theme, cmd-k overlay"
```

---

### Task F2: Day-state hooks (useHealthDay, useBudget) + bucket vocabulary

**Files:**
- Create: `frontend/src/modules/Health/today/mealBuckets.js` (the `BUCKETS`/`UNGROUPED` block above, verbatim)
- Create: `frontend/src/modules/Health/today/useHealthDay.js`
- Create: `frontend/src/modules/Health/today/useHealthDay.test.jsx`

**Interfaces:**
- Consumes: `useApiResource` (DS), `DaylightAPI`.
- Produces: `useHealthDay(date)` → `{ items, byBucket, budget, budgetError, loading, error, reload, mutate }` where:
  - `items`: the day's NutriList rows (`GET api/v1/health/nutrilist/{date}` — returns the day's row array; verify the exact envelope on first run against the dev server and unwrap `.items` if present);
  - `byBucket`: `Map<bucketId|null, rows[]>` grouped on `row.mealTime`;
  - `budget`: the B3 payload or `null`; `budgetError`: the error when `/budget` 409s or fails (the log must render regardless — spec, failure modes);
  - `mutate(fn)`: runs an async mutation then reloads both resources;
  - both resources also reload on window focus (`focus` event listener).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Health/today/useHealthDay.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { useHealthDay } from './useHealthDay.js';

const ROWS = [
  { uuid: '1', name: 'Eggs', calories: 140, mealTime: 'morning' },
  { uuid: '2', name: 'Sandwich', calories: 400, mealTime: 'afternoon' },
  { uuid: '3', name: 'Mystery', calories: 100 }, // no mealTime → ungrouped
];
const BUDGET = { budget: 2100, food: 640, exercise: 0, remaining: 1460, status: 'under', sessions: [] };

describe('useHealthDay', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path) =>
      path.includes('/budget') ? BUDGET : ROWS);
  });

  it('groups rows by mealTime with null → ungrouped', async () => {
    const { result } = renderHook(() => useHealthDay('2026-09-02'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.byBucket.get('morning')).toHaveLength(1);
    expect(result.current.byBucket.get('afternoon')).toHaveLength(1);
    expect(result.current.byBucket.get(null)).toHaveLength(1);
    expect(result.current.budget.remaining).toBe(1460);
  });

  it('a failing budget endpoint leaves the log usable', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('/budget')) { const e = new Error('409'); e.status = 409; throw e; }
      return ROWS;
    });
    const { result } = renderHook(() => useHealthDay('2026-09-02'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.budget).toBeNull();
    expect(result.current.budgetError.status).toBe(409);
  });

  it('mutate runs the action then reloads', async () => {
    const { result } = renderHook(() => useHealthDay('2026-09-02'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const action = vi.fn(async () => {});
    const callsBefore = apiMock.mock.calls.length;
    await act(() => result.current.mutate(action));
    expect(action).toHaveBeenCalled();
    expect(apiMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Health/today/useHealthDay.test.jsx`
Expected: FAIL — cannot resolve `./useHealthDay.js`

- [ ] **Step 3: Write the implementation**

```javascript
// frontend/src/modules/Health/today/useHealthDay.js
import { useCallback, useEffect, useMemo } from 'react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { BUCKETS } from './mealBuckets.js';

const logger = createAppLogger('health').child('use-health-day');

export function useHealthDay(date) {
  const list = useApiResource(`api/v1/health/nutrilist/${date}`, { deps: [date], label: 'nutrilist', logger });
  const budgetRes = useApiResource(`api/v1/health/budget?date=${date}`, { deps: [date], label: 'budget', logger });

  // The day's rows: the endpoint serves the array directly (Nutrition.jsx
  // precedent); unwrap an {items} envelope defensively.
  const items = useMemo(() => {
    const d = list.data;
    return Array.isArray(d) ? d : (Array.isArray(d?.items) ? d.items : []);
  }, [list.data]);

  const byBucket = useMemo(() => {
    const map = new Map([...BUCKETS.map((b) => [b.id, []]), [null, []]]);
    for (const row of items) {
      const key = map.has(row.mealTime) ? row.mealTime : null;
      map.get(key).push(row);
    }
    return map;
  }, [items]);

  const reload = useCallback(() => { list.reload(); budgetRes.reload(); }, [list.reload, budgetRes.reload]);

  const mutate = useCallback(async (action) => {
    try {
      await action();
    } finally {
      reload();
    }
  }, [reload]);

  // Kitchen-scale / Telegram entries appear when the tab regains focus.
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  return {
    items,
    byBucket,
    budget: budgetRes.error ? null : budgetRes.data,
    budgetError: budgetRes.error,
    loading: list.loading,
    error: list.error,
    reload,
    mutate,
  };
}

export default useHealthDay;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Health/today/useHealthDay.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/today/
git commit -m "feat(health-ui): useHealthDay hook and meal-bucket vocabulary"
```

---

### Task F3: Equation strip + macro footer

**Files:**
- Create: `frontend/src/modules/Health/today/EquationStrip.jsx`
- Create: `frontend/src/modules/Health/today/MacroFooter.jsx`
- Modify: `frontend/src/modules/Health/health.scss`
- Create: `frontend/src/modules/Health/today/EquationStrip.test.jsx`

**Interfaces:**
- Consumes: budget payload (B3), `DateStepper` (DS).
- Produces: `<EquationStrip budget budgetError date onDateChange today>` — one line: DateStepper + `2,100 − 1,280 + 320 = 1,140 under` (or `— set up goals` linking budgetError 409 → the Progress tab's goal editor via `onSetupGoals` prop); `<MacroFooter items coachLine onCoachTap>` — `P 82 · C 110 · F 41` summed from items + the coach one-liner.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Health/today/EquationStrip.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EquationStrip } from './EquationStrip.jsx';

const budget = { budget: 2100, food: 1280, exercise: 320, remaining: 1140, status: 'under' };

describe('EquationStrip', () => {
  it('renders the full equation with under status', () => {
    render(<EquationStrip budget={budget} date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />);
    expect(screen.getByText('2,100')).toBeTruthy();
    expect(screen.getByText('1,280')).toBeTruthy();
    expect(screen.getByText('320')).toBeTruthy(); // exercise term (ops render as separate spans)
    expect(screen.getByText('1,140')).toBeTruthy();
    expect(screen.getByText(/under/)).toBeTruthy();
  });

  it('over status gets the over class', () => {
    const { container } = render(
      <EquationStrip budget={{ ...budget, remaining: -200, status: 'over' }}
        date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />);
    expect(container.querySelector('.health-equation--over')).toBeTruthy();
  });

  it('budget failure renders a setup notice, not a crash', () => {
    const err = new Error('conflict'); err.status = 409;
    render(<EquationStrip budget={null} budgetError={err} onSetupGoals={() => {}}
      date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />);
    expect(screen.getByRole('button', { name: /set up goals/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Health/today/EquationStrip.test.jsx`
Expected: FAIL — cannot resolve `./EquationStrip.jsx`

- [ ] **Step 3: Write the implementations**

```jsx
// frontend/src/modules/Health/today/EquationStrip.jsx
import { Button } from '@mantine/core';
import { DateStepper } from '@/lib/ui';

const n = (v) => Number(v || 0).toLocaleString();

/** The LoseIt signature: Budget − Food + Exercise = Net, under/over. */
export function EquationStrip({ budget, budgetError, date, today, onDateChange, onSetupGoals }) {
  return (
    <div className={`health-equation${budget?.status === 'over' ? ' health-equation--over' : ''}`}>
      <DateStepper date={date} onChange={onDateChange} max={today} />
      {budget ? (
        <div className="health-equation__math" aria-label="Calorie equation">
          <span>{n(budget.budget)}</span>
          <span className="health-equation__op">−</span>
          <span>{n(budget.food)}</span>
          <span className="health-equation__op">+</span>
          <span>{n(budget.exercise)}</span>
          <span className="health-equation__op">=</span>
          <strong className="health-equation__net">{n(Math.abs(budget.remaining))}</strong>
          <span className="health-equation__status">{budget.status}</span>
          {budget.stale ? <span className="health-equation__stale" title="Latest weigh-in is over a week old">stale wt</span> : null}
        </div>
      ) : budgetError?.status === 409 ? (
        <Button size="xs" variant="light" onClick={onSetupGoals}>Set up goals</Button>
      ) : (
        <span className="health-equation__math">—</span>
      )}
    </div>
  );
}
export default EquationStrip;
```

```jsx
// frontend/src/modules/Health/today/MacroFooter.jsx
const sum = (items, key) => Math.round(items.reduce((s, i) => s + (Number(i[key]) || 0), 0));

export function MacroFooter({ items = [], coachLine, onCoachTap, children }) {
  return (
    <div className="health-footer">
      {coachLine ? (
        <button type="button" className="health-footer__coach" onClick={onCoachTap}>💬 {coachLine}</button>
      ) : null}
      <div className="health-footer__row">
        <span className="health-footer__macros">
          P {sum(items, 'protein')}g · C {sum(items, 'carbs')}g · F {sum(items, 'fat')}g
        </span>
        <span className="health-footer__actions">{children}</span>
      </div>
    </div>
  );
}
export default MacroFooter;
```

Append to `health.scss`:

```scss
.health-equation {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 0.25rem 0.75rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--ds-border);

  &__math { display: flex; align-items: baseline; gap: 0.35rem; font-variant-numeric: tabular-nums; color: var(--ds-text-high); }
  &__op { color: var(--ds-text-low); }
  &__net { font-size: 1.1rem; }
  &__status { font-size: 0.75rem; text-transform: uppercase; color: var(--ds-success); }
  &--over &__status, &--over &__net { color: var(--ds-danger); }
  &__stale { font-size: 0.7rem; color: var(--ds-warning); }
}

.health-footer {
  display: flex; flex-direction: column; gap: 0.25rem;
  &__coach { background: none; border: none; text-align: left; cursor: pointer; color: var(--ds-text-mid); font-size: 0.8rem; padding: 0; }
  &__row { display: flex; align-items: center; justify-content: space-between; }
  &__macros { font-size: 0.8rem; color: var(--ds-text-mid); font-variant-numeric: tabular-nums; }
  &__actions { display: flex; gap: 0.4rem; }
}
```

(The `<button>` in MacroFooter's coach line violates the `native-control` audit rule — use Mantine `UnstyledButton` instead: `import { UnstyledButton } from '@mantine/core'` and swap the element. Do the same anywhere else a bare button creeps in.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Health/today/EquationStrip.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/today/ frontend/src/modules/Health/health.scss
git commit -m "feat(health-ui): equation strip and macro footer"
```

---

### Task F4: The log table — meal sections, entry rows, exercise section

**Files:**
- Create: `frontend/src/modules/Health/today/LogTable.jsx`
- Create: `frontend/src/modules/Health/today/EntryRow.jsx`
- Create: `frontend/src/modules/Health/today/TodayView.jsx`
- Modify: `frontend/src/Apps/HealthApp.jsx` (mount `TodayView` for the today tab)
- Modify: `frontend/src/modules/Health/health.scss`
- Create: `frontend/src/modules/Health/today/LogTable.test.jsx`

**Interfaces:**
- Consumes: `useHealthDay` (F2), `BUCKETS/UNGROUPED` (F2), `EquationStrip`/`MacroFooter` (F3), `LoadingState/ErrorState/EmptyState` (DS).
- Produces: `<TodayView onSetupGoals onCoachTap>` — the centerpiece screen. `<LogTable byBucket sessions onAddTo(bucketId) onRowTap(row)>` — one section per bucket with kcal subtotal and a `+ Add food…` row (fires `onAddTo(bucketId)`); UNGROUPED section renders only when non-empty; EXERCISE section renders read-only session rows (`type/duration/+calories`). `<EntryRow row onTap>` — noom color dot (colored `<span>` circle, not emoji), name, portion, kcal.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Health/today/LogTable.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LogTable } from './LogTable.jsx';
import { BUCKETS } from './mealBuckets.js';

const byBucket = new Map([
  ['morning', [{ uuid: '1', name: 'Eggs', calories: 140, amount: 2, unit: 'lg', color: 'green' }]],
  ['afternoon', []], ['evening', []], ['night', []],
  [null, []],
]);

describe('LogTable', () => {
  it('renders bucket labels, rows, and kcal subtotals', () => {
    render(<LogTable byBucket={byBucket} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} />);
    expect(screen.getByText('Breakfast')).toBeTruthy();
    expect(screen.getByText('Eggs')).toBeTruthy();
    expect(screen.getByText('140 kcal')).toBeTruthy();
    expect(screen.getAllByText(/Add food/)).toHaveLength(BUCKETS.length);
  });

  it('hides UNGROUPED when empty, shows it when populated', () => {
    const { rerender } = render(<LogTable byBucket={byBucket} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} />);
    expect(screen.queryByText('Ungrouped')).toBeNull();
    const withOrphan = new Map(byBucket);
    withOrphan.set(null, [{ uuid: '9', name: 'Mystery', calories: 100 }]);
    rerender(<LogTable byBucket={withOrphan} sessions={[]} onAddTo={() => {}} onRowTap={() => {}} />);
    expect(screen.getByText('Ungrouped')).toBeTruthy();
  });

  it('renders exercise sessions read-only with credit', () => {
    render(<LogTable byBucket={byBucket}
      sessions={[{ type: 'cycling', duration_min: 42, calories: 320 }]}
      onAddTo={() => {}} onRowTap={() => {}} />);
    expect(screen.getByText('Exercise')).toBeTruthy();
    expect(screen.getByText(/\+320/)).toBeTruthy();
  });

  it('add and row taps fire with the right arguments', () => {
    const onAddTo = vi.fn(); const onRowTap = vi.fn();
    render(<LogTable byBucket={byBucket} sessions={[]} onAddTo={onAddTo} onRowTap={onRowTap} />);
    fireEvent.click(screen.getAllByText(/Add food/)[0]);
    expect(onAddTo).toHaveBeenCalledWith('morning');
    fireEvent.click(screen.getByText('Eggs'));
    expect(onRowTap).toHaveBeenCalledWith(expect.objectContaining({ uuid: '1' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Health/today/LogTable.test.jsx`
Expected: FAIL — cannot resolve `./LogTable.jsx`

- [ ] **Step 3: Write the implementations**

```jsx
// frontend/src/modules/Health/today/EntryRow.jsx
import { UnstyledButton } from '@mantine/core';

const NOOM = { green: 'var(--ds-success)', yellow: 'var(--ds-warning)', orange: 'var(--ds-danger)' };

export function EntryRow({ row, onTap }) {
  const portion = [row.amount, row.unit].filter(Boolean).join(' ') || (row.grams ? `${row.grams} g` : '');
  return (
    <UnstyledButton className="health-row" onClick={() => onTap(row)}>
      <span className="health-row__dot" style={{ background: NOOM[row.color] || 'var(--ds-text-low)' }} />
      <span className="health-row__name">{row.name || row.item || row.label}</span>
      <span className="health-row__portion">{portion}</span>
      <span className="health-row__kcal">{Math.round(row.calories || 0)}</span>
    </UnstyledButton>
  );
}
export default EntryRow;
```

```jsx
// frontend/src/modules/Health/today/LogTable.jsx
import { UnstyledButton } from '@mantine/core';
import { BUCKETS, UNGROUPED } from './mealBuckets.js';
import { EntryRow } from './EntryRow.jsx';

const kcal = (rows) => Math.round(rows.reduce((s, r) => s + (Number(r.calories) || 0), 0));

function Section({ label, rows, onAdd, onRowTap }) {
  return (
    <section className="health-meal">
      <header className="health-meal__header">
        <h4 className="health-meal__label">{label}</h4>
        <span className="health-meal__kcal">{rows.length ? `${kcal(rows)} kcal` : '—'}</span>
      </header>
      {rows.map((row) => <EntryRow key={row.uuid} row={row} onTap={onRowTap} />)}
      {onAdd ? (
        <UnstyledButton className="health-meal__add" onClick={onAdd}>+ Add food…</UnstyledButton>
      ) : null}
    </section>
  );
}

export function LogTable({ byBucket, sessions = [], onAddTo, onRowTap, addSlot, addingTo }) {
  const orphans = byBucket.get(null) || [];
  return (
    <div className="health-log">
      {BUCKETS.map((b) => (
        <div key={b.id}>
          <Section label={b.label} rows={byBucket.get(b.id) || []}
            onAdd={() => onAddTo(b.id)} onRowTap={onRowTap} />
          {addingTo === b.id && addSlot ? addSlot : null}
        </div>
      ))}
      {sessions.length ? (
        <section className="health-meal health-meal--exercise">
          <header className="health-meal__header">
            <h4 className="health-meal__label">Exercise</h4>
            <span className="health-meal__kcal">+{kcal(sessions)} kcal</span>
          </header>
          {sessions.map((s, i) => (
            <div key={i} className="health-row health-row--readonly">
              <span className="health-row__name">{s.type || s.title || 'Workout'}</span>
              <span className="health-row__portion">{s.duration_min ? `${Math.round(s.duration_min)} min` : ''}</span>
              <span className="health-row__kcal">+{Math.round(s.calories || 0)}</span>
            </div>
          ))}
        </section>
      ) : null}
      {orphans.length ? (
        <Section label={UNGROUPED.label} rows={orphans} onRowTap={onRowTap} />
      ) : null}
    </div>
  );
}
export default LogTable;
```

```jsx
// frontend/src/modules/Health/today/TodayView.jsx
import { useState } from 'react';
import { LoadingState, ErrorState } from '@/lib/ui';
import { useHealthDay } from './useHealthDay.js';
import { EquationStrip } from './EquationStrip.jsx';
import { MacroFooter } from './MacroFooter.jsx';
import { LogTable } from './LogTable.jsx';

const todayISO = () => new Date().toISOString().slice(0, 10);

export function TodayView({ onSetupGoals, onCoachTap }) {
  const [date, setDate] = useState(todayISO());
  const day = useHealthDay(date);
  const [addingTo, setAddingTo] = useState(null);   // bucketId | null — F5 renders the combobox here
  const [editingRow, setEditingRow] = useState(null); // row | null — F6 renders the edit sheet

  return (
    <div className="health-today">
      <EquationStrip budget={day.budget} budgetError={day.budgetError}
        date={date} today={todayISO()} onDateChange={setDate} onSetupGoals={onSetupGoals} />
      {day.loading ? <LoadingState label="food log" rows={6} /> : null}
      {day.error ? <ErrorState error={day.error} onRetry={day.reload} label="Food log" /> : null}
      {!day.loading && !day.error ? (
        <LogTable byBucket={day.byBucket} sessions={day.budget?.sessions || []}
          onAddTo={setAddingTo} onRowTap={setEditingRow} addingTo={addingTo} addSlot={null} />
      ) : null}
      <MacroFooter items={day.items} coachLine={null} onCoachTap={onCoachTap} />
      {/* F5 mounts the add combobox via addSlot; F6 mounts the edit sheet on editingRow */}
    </div>
  );
}
export default TodayView;
```

In `HealthApp.jsx`, replace the today-tab placeholder with:

```jsx
          {tab === 'today' && <TodayView onSetupGoals={() => setTab('progress')} onCoachTap={() => setOverlayOpen(true)} />}
```

Append to `health.scss`:

```scss
.health-meal {
  margin-top: 0.75rem;
  &__header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--ds-border); padding-bottom: 0.2rem; }
  &__label { margin: 0; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ds-text-mid); }
  &__kcal { font-size: 0.8rem; color: var(--ds-text-low); font-variant-numeric: tabular-nums; }
  &__add { display: block; width: 100%; text-align: left; padding: 0.5rem 0.25rem; color: var(--ds-text-low); font-size: 0.85rem; border-radius: 6px;
    &:focus-visible { outline: 2px solid var(--ds-accent); outline-offset: 2px; } }
  &--exercise .health-row__kcal { color: var(--ds-success); }
}

.health-row {
  display: grid; grid-template-columns: 14px 1fr auto 3.5rem; gap: 0.5rem;
  align-items: center; width: 100%;
  padding: 0.45rem 0.25rem; border-radius: 6px; text-align: left;
  color: var(--ds-text-high);
  &:focus-visible { outline: 2px solid var(--ds-accent); outline-offset: 2px; }
  &__dot { width: 10px; height: 10px; border-radius: 50%; }
  &__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__portion { font-size: 0.75rem; color: var(--ds-text-low); }
  &__kcal { text-align: right; font-variant-numeric: tabular-nums; }
  &--readonly { grid-template-columns: 1fr auto 3.5rem; color: var(--ds-text-mid); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Health/today/LogTable.test.jsx`
Expected: PASS (4 tests). Load `/health` — the real day log renders with buckets, subtotals, and the equation strip.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/today/ frontend/src/modules/Health/health.scss frontend/src/Apps/HealthApp.jsx
git commit -m "feat(health-ui): the log table — meal sections, entry rows, exercise credit"
```

---

### Task F5: Add combobox + pending confirm card

**Files:**
- Create: `frontend/src/modules/Health/today/AddCombobox.jsx`
- Create: `frontend/src/modules/Health/today/PendingConfirmCard.jsx`
- Modify: `frontend/src/modules/Health/today/TodayView.jsx` (mount both via `addSlot`)
- Modify: `frontend/src/modules/Health/health.scss`
- Create: `frontend/src/modules/Health/today/AddCombobox.test.jsx`

**Interfaces:**
- Consumes: `GET api/v1/health/nutrition/catalog/suggest?q=` (B4), `POST api/v1/health/nutrition/catalog/quickadd` (existing), `POST api/v1/health/nutrition/input` + `/callback` (existing — the `{ messages, choices, callback_data }` contract from `NutritionCard.jsx:33-57`), `PUT api/v1/health/nutrilist/:uuid` (to stamp `mealTime` on quick-added rows).
- Produces: `<AddCombobox bucketId onDone onCancel>` — autofocused text input inline in the meal section; keystrokes (250ms debounce) fetch suggestions; ↑/↓/Enter keyboard nav; picking a suggestion quick-adds it then PUTs `mealTime: bucketId`; pressing Enter on free text with no selection submits the sentence to the NL pipeline and swaps to `<PendingConfirmCard>`; Escape cancels. `<PendingConfirmCard messages callbackData onDone onDiscard>` — itemized parse, Accept/Revise/Discard; Revise opens a text field whose submission re-enters the input pipeline; failure keeps the original text with a Retry button.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Health/today/AddCombobox.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { AddCombobox } from './AddCombobox.jsx';

const SUGGEST = { items: [
  { id: 'a', name: 'Chicken breast', favorite: true, nutrients: { calories: 231 } },
  { id: 'b', name: 'Chicken thigh', favorite: false, nutrients: { calories: 280 } },
] };

describe('AddCombobox', () => {
  beforeEach(() => { apiMock.mockReset(); });

  it('typing fetches suggestions; favorites are marked', async () => {
    apiMock.mockResolvedValue(SUGGEST);
    render(<AddCombobox bucketId="afternoon" onDone={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'chick' } });
    await waitFor(() => expect(screen.getByText('Chicken breast')).toBeTruthy());
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('suggest?q=chick'));
    expect(screen.getByText('Chicken breast').closest('.health-suggest__item--fav')).toBeTruthy();
  });

  it('picking a suggestion quick-adds with the bucket and calls onDone', async () => {
    apiMock.mockImplementation(async (path, body) => {
      if (path.includes('suggest')) return SUGGEST;
      if (path.includes('quickadd')) return { uuid: 'row-1' };
      return {};
    });
    const onDone = vi.fn();
    render(<AddCombobox bucketId="afternoon" onDone={onDone} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'chick' } });
    await waitFor(() => screen.getByText('Chicken breast'));
    fireEvent.click(screen.getByText('Chicken breast'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const quickaddCall = apiMock.mock.calls.find(([p]) => p.includes('quickadd'));
    expect(quickaddCall[1]).toMatchObject({ catalogEntryId: 'a' });
    const putCall = apiMock.mock.calls.find(([p]) => p.includes('nutrilist/row-1'));
    expect(putCall[1]).toMatchObject({ mealTime: 'afternoon' });
  });

  it('free sentence with no pick submits to the NL pipeline', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return { items: [] };
      if (path.includes('nutrition/input')) return {
        messages: [{ text: '2 eggs — 140 kcal', choices: [[{ text: '✅ Accept', callback_data: 'cb-1' }]] }],
      };
      return {};
    });
    render(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '2 eggs and toast' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/140 kcal/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /accept/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Health/today/AddCombobox.test.jsx`
Expected: FAIL — cannot resolve `./AddCombobox.jsx`

- [ ] **Step 3: Write the implementations**

```jsx
// frontend/src/modules/Health/today/PendingConfirmCard.jsx
import { useState } from 'react';
import { Button, TextInput } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('pending-card');
const findCallback = (messages, label) =>
  (messages?.[0]?.choices?.flat?.() || []).find((c) => c.text?.includes(label))?.callback_data || null;

/** Accept / Revise / Discard funnel for AI-parsed entries. */
export function PendingConfirmCard({ messages, onDone, onDiscard }) {
  const [revising, setRevising] = useState(false);
  const [revision, setRevision] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const act = async (label, after) => {
    const callbackData = findCallback(messages, label);
    setBusy(true); setError(null);
    try {
      if (callbackData) await DaylightAPI('api/v1/health/nutrition/callback', { callbackData }, 'POST');
      logger.info('pending.action', { label });
      after();
    } catch (err) {
      logger.error('pending.action_failed', { label, error: err?.message });
      setError(err);
    } finally { setBusy(false); }
  };

  const submitRevision = async () => {
    if (!revision.trim()) return;
    setBusy(true); setError(null);
    try {
      await DaylightAPI('api/v1/health/nutrition/input', { type: 'text', content: revision.trim() }, 'POST');
      onDone();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="health-pending" role="status">
      {(messages || []).map((m, i) => <p key={i} className="health-pending__line">{m.text}</p>)}
      {error ? <p className="health-pending__error">{error.message} — input preserved, retry below.</p> : null}
      {revising ? (
        <div className="health-pending__actions">
          <TextInput size="xs" value={revision} onChange={(e) => setRevision(e.target.value)}
            placeholder="e.g. that was 2 slices, not 1" autoFocus style={{ flex: 1 }} />
          <Button size="xs" loading={busy} onClick={submitRevision}>Send</Button>
        </div>
      ) : (
        <div className="health-pending__actions">
          <Button size="xs" color="green" loading={busy} onClick={() => act('Accept', onDone)}>Accept</Button>
          <Button size="xs" variant="light" onClick={() => setRevising(true)}>Revise</Button>
          <Button size="xs" variant="subtle" color="red" onClick={() => act('Discard', onDiscard)}>Discard</Button>
        </div>
      )}
    </div>
  );
}
export default PendingConfirmCard;
```

```jsx
// frontend/src/modules/Health/today/AddCombobox.jsx
import { useEffect, useRef, useState } from 'react';
import { TextInput, UnstyledButton, Loader } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { PendingConfirmCard } from './PendingConfirmCard.jsx';

const logger = createAppLogger('health').child('add-combobox');

export function AddCombobox({ bucketId, onDone, onCancel }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [phase, setPhase] = useState('typing'); // typing | parsing | review
  const [pending, setPending] = useState(null); // { messages }
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!text.trim()) { setItems([]); return undefined; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await DaylightAPI(`api/v1/health/nutrition/catalog/suggest?q=${encodeURIComponent(text.trim())}`);
        setItems(res?.items || []);
        setHighlight(-1);
      } catch (err) {
        logger.warn('suggest.failed', { error: err?.message });
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [text]);

  const pick = async (entry) => {
    setPhase('parsing'); setError(null);
    try {
      const row = await DaylightAPI('api/v1/health/nutrition/catalog/quickadd', { catalogEntryId: entry.id }, 'POST');
      if (row?.uuid && bucketId) {
        await DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, { mealTime: bucketId }, 'PUT');
      }
      logger.info('quickadd.done', { entry: entry.name, bucket: bucketId });
      onDone();
    } catch (err) {
      logger.error('quickadd.failed', { error: err?.message });
      setError(err); setPhase('typing');
    }
  };

  const submitSentence = async () => {
    if (!text.trim()) return;
    setPhase('parsing'); setError(null);
    logger.info('sentence.submit', { length: text.length });
    try {
      const result = await DaylightAPI('api/v1/health/nutrition/input', { type: 'text', content: text.trim() }, 'POST');
      setPending({ messages: result?.messages || [] });
      setPhase('review');
    } catch (err) {
      logger.error('sentence.failed', { error: err?.message });
      setError(err); setPhase('typing'); // text preserved — input never lost
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') return onCancel();
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, -1)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight >= 0 && items[highlight]) pick(items[highlight]);
      else submitSentence();
    }
  };

  if (phase === 'review' && pending) {
    return <PendingConfirmCard messages={pending.messages} onDone={onDone} onDiscard={onCancel} />;
  }

  return (
    <div className="health-suggest">
      <TextInput autoFocus size="sm" value={text} placeholder="Food name, or a sentence to parse…"
        onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
        rightSection={phase === 'parsing' ? <Loader size="xs" /> : null} />
      {error ? <p className="health-suggest__error">{error.message}</p> : null}
      <ul className="health-suggest__list" role="listbox">
        {items.map((entry, i) => (
          <li key={entry.id}>
            <UnstyledButton
              className={`health-suggest__item${entry.favorite ? ' health-suggest__item--fav' : ''}${i === highlight ? ' health-suggest__item--hi' : ''}`}
              role="option" aria-selected={i === highlight}
              onClick={() => pick(entry)}>
              {entry.favorite ? <span className="health-suggest__star" aria-label="favorite">★</span> : null}
              <span>{entry.name}</span>
              <span className="health-suggest__kcal">{entry.nutrients?.calories ?? ''}</span>
            </UnstyledButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
export default AddCombobox;
```

In `TodayView.jsx`, wire the slot:

```jsx
        <LogTable byBucket={day.byBucket} sessions={day.budget?.sessions || []}
          onAddTo={setAddingTo} onRowTap={setEditingRow} addingTo={addingTo}
          addSlot={addingTo ? (
            <AddCombobox bucketId={addingTo}
              onDone={() => { setAddingTo(null); day.reload(); }}
              onCancel={() => setAddingTo(null)} />
          ) : null} />
```

Append to `health.scss`:

```scss
.health-suggest {
  padding: 0.4rem 0.25rem;
  &__list { list-style: none; margin: 0.25rem 0 0; padding: 0; }
  &__item {
    display: flex; gap: 0.4rem; align-items: baseline; width: 100%;
    padding: 0.4rem 0.5rem; border-radius: 6px; color: var(--ds-text-high);
    &--hi, &:hover { background: var(--ds-surface-alt); }
    &--fav .health-suggest__star { color: var(--ds-warning); }
  }
  &__kcal { margin-left: auto; color: var(--ds-text-low); font-variant-numeric: tabular-nums; font-size: 0.8rem; }
  &__error { color: var(--ds-danger); font-size: 0.8rem; margin: 0.25rem 0 0; }
}
.health-pending {
  border: 1px solid var(--ds-border); border-left: 3px solid var(--ds-warning);
  border-radius: 9px; padding: 0.6rem 0.75rem; margin: 0.4rem 0;
  &__line { margin: 0 0 0.35rem; white-space: pre-wrap; font-size: 0.85rem; }
  &__actions { display: flex; gap: 0.4rem; align-items: center; }
  &__error { color: var(--ds-danger); font-size: 0.8rem; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Health/today/AddCombobox.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/today/ frontend/src/modules/Health/health.scss
git commit -m "feat(health-ui): add combobox with suggest ranking and NL pending funnel"
```

---

### Task F6: Entry edit sheet

**Files:**
- Create: `frontend/src/modules/Health/today/EntryEditSheet.jsx`
- Modify: `frontend/src/modules/Health/today/TodayView.jsx` (mount on `editingRow`)
- Create: `frontend/src/modules/Health/today/EntryEditSheet.test.jsx`

**Interfaces:**
- Consumes: `Sheet` (DS), `PUT/DELETE api/v1/health/nutrilist/:uuid`, `PUT api/v1/health/nutrition/catalog/favorite` (B4, by-name), `POST api/v1/health/nutrition/meals` (B6), `BUCKETS` (F2).
- Produces: `<EntryEditSheet row open onClose onChanged>` — portion stepper (×¼ … ×4 discrete buttons — no sliders, house rule; PUT scales calories/macros by factor via the existing `updatePortion` semantics: send `{ amount, calories, protein, carbs, fat }` scaled client-side from the row's current values), macro number inputs, move-to-bucket segmented buttons (PUT `{ mealTime }`), star (favorite by name), delete (DELETE with `window.confirm`), "Save as meal" (creates a single-item saved meal from this row; multi-select save-as-meal arrives in F8).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Health/today/EntryEditSheet.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiMock = vi.fn(async () => ({}));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { DismissStackProvider } from '@/lib/ui';
import { EntryEditSheet } from './EntryEditSheet.jsx';

const row = { uuid: 'r1', name: 'Eggs', calories: 140, protein: 12, carbs: 1, fat: 10, amount: 2, unit: 'lg', mealTime: 'morning' };
const mount = (props) => render(
  <DismissStackProvider>
    <EntryEditSheet row={row} open onClose={() => {}} onChanged={() => {}} {...props} />
  </DismissStackProvider>
);

describe('EntryEditSheet', () => {
  beforeEach(() => apiMock.mockClear());

  it('portion x2 PUTs scaled values', async () => {
    const onChanged = vi.fn();
    mount({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: '×2' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [path, body, method] = apiMock.mock.calls[0];
    expect(path).toContain('nutrilist/r1');
    expect(method).toBe('PUT');
    expect(body.calories).toBe(280);
    expect(body.protein).toBe(24);
  });

  it('move to Dinner PUTs mealTime evening', async () => {
    const onChanged = vi.fn();
    mount({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: 'Dinner' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiMock.mock.calls[0][1]).toMatchObject({ mealTime: 'evening' });
  });

  it('star favorites by name', async () => {
    mount({});
    fireEvent.click(screen.getByRole('button', { name: /favorite/i }));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    const call = apiMock.mock.calls.find(([p]) => p.includes('catalog/favorite'));
    expect(call[1]).toMatchObject({ name: 'Eggs', favorite: true });
  });

  it('delete confirms then DELETEs', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onChanged = vi.fn();
    mount({ onChanged });
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const call = apiMock.mock.calls.find(([, , m]) => m === 'DELETE');
    expect(call[0]).toContain('nutrilist/r1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Health/today/EntryEditSheet.test.jsx`
Expected: FAIL — cannot resolve `./EntryEditSheet.jsx`

- [ ] **Step 3: Write the implementation**

```jsx
// frontend/src/modules/Health/today/EntryEditSheet.jsx
import { useState } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { BUCKETS } from './mealBuckets.js';

const logger = createAppLogger('health').child('entry-edit');
const FACTORS = [0.25, 0.33, 0.5, 0.75, 1.5, 2, 3];
const scale = (row, f) => ({
  amount: Math.round((Number(row.amount) || 1) * f * 100) / 100,
  calories: Math.round((Number(row.calories) || 0) * f),
  protein: Math.round((Number(row.protein) || 0) * f),
  carbs: Math.round((Number(row.carbs) || 0) * f),
  fat: Math.round((Number(row.fat) || 0) * f),
});

export function EntryEditSheet({ row, open, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [starred, setStarred] = useState(false);
  const [error, setError] = useState(null);
  if (!row) return null;

  const run = async (fn, event) => {
    setBusy(true); setError(null);
    try {
      await fn();
      logger.info(event, { uuid: row.uuid });
      onChanged();
      onClose();
    } catch (err) {
      logger.error(`${event}.failed`, { uuid: row.uuid, error: err?.message });
      setError(err);
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title={row.name || row.item}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">{Math.round(row.calories || 0)} kcal · P {row.protein}g · C {row.carbs}g · F {row.fat}g</Text>
        {error ? <Text size="sm" c="red">{error.message}</Text> : null}

        <Text size="xs" fw={600} tt="uppercase">Portion</Text>
        <Group gap="xs">
          {FACTORS.map((f) => (
            <Button key={f} size="xs" variant="light" disabled={busy}
              onClick={() => run(() => DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, scale(row, f), 'PUT'), 'portion')}>
              ×{f === 0.25 ? '¼' : f === 0.33 ? '⅓' : f === 0.5 ? '½' : f === 0.75 ? '¾' : f}
            </Button>
          ))}
        </Group>

        <Text size="xs" fw={600} tt="uppercase">Move to</Text>
        <Group gap="xs">
          {BUCKETS.map((b) => (
            <Button key={b.id} size="xs" disabled={busy}
              variant={row.mealTime === b.id ? 'filled' : 'light'}
              onClick={() => run(() => DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, { mealTime: b.id }, 'PUT'), 'move')}>
              {b.label}
            </Button>
          ))}
        </Group>

        <Group gap="xs" mt="xs">
          <Button size="xs" variant="light" disabled={busy || starred} aria-label="favorite"
            onClick={async () => {
              try {
                await DaylightAPI('api/v1/health/nutrition/catalog/favorite',
                  { name: row.name || row.item, favorite: true }, 'PUT');
                setStarred(true);
                logger.info('favorite', { name: row.name });
              } catch (err) { setError(err); }
            }}>
            {starred ? '★ Favorited' : '☆ Favorite'}
          </Button>
          <Button size="xs" variant="light" disabled={busy}
            onClick={() => run(() => DaylightAPI('api/v1/health/nutrition/meals', {
              name: row.name || row.item,
              items: [{ name: row.name || row.item, calories: row.calories, protein: row.protein, carbs: row.carbs, fat: row.fat, color: row.color }],
            }, 'POST'), 'save-as-meal')}>
            Save as meal
          </Button>
          <Button size="xs" color="red" variant="subtle" disabled={busy}
            onClick={() => {
              if (!window.confirm(`Delete ${row.name || row.item}?`)) return;
              run(() => DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, {}, 'DELETE'), 'delete');
            }}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Sheet>
  );
}
export default EntryEditSheet;
```

In `TodayView.jsx`, after the footer:

```jsx
      <EntryEditSheet row={editingRow} open={Boolean(editingRow)}
        onClose={() => setEditingRow(null)} onChanged={day.reload} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Health/today/EntryEditSheet.test.jsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/today/
git commit -m "feat(health-ui): entry edit sheet — portion, bucket move, star, delete"
```

---

### Task F7: Capture — barcode, photo, voice, custom food

**Files:**
- Create: `frontend/src/modules/Health/capture/BarcodeCapture.jsx`
- Create: `frontend/src/modules/Health/capture/PhotoCapture.jsx`
- Create: `frontend/src/modules/Health/capture/VoiceCapture.jsx`
- Create: `frontend/src/modules/Health/capture/CustomFoodSheet.jsx`
- Create: `frontend/src/modules/Health/capture/useNutritionInput.js`
- Modify: `frontend/src/modules/Health/today/TodayView.jsx` + `MacroFooter` usage (capture buttons in footer)
- Create: `frontend/src/modules/Health/capture/useNutritionInput.test.jsx`
- Modify: `package.json` — add `@zxing/browser` (run `npm install @zxing/browser --legacy-peer-deps`)

**Interfaces:**
- Consumes: `POST api/v1/health/nutrition/input` with `{type: 'barcode'|'image'|'voice', content}`; B5's `unknownUpc` field in the response; `Sheet` (DS); `POST api/v1/health/nutrition/catalog` + `/quickadd` (B4).
- Produces: `useNutritionInput()` → `{ submit(type, content) → result, busy, error }` (shared submit + logging); `<BarcodeCapture open onClose onResult>` — camera stream decoded via native `BarcodeDetector` when present, else dynamic-import `@zxing/browser`; **always renders a manual UPC input** (the honest seam Playwright uses — same `submit('barcode', upc)` path as a camera decode); on `unknownUpc` result calls `onResult({ unknownUpc, upc })`; camera permission denial shows the manual field with a notice. `<PhotoCapture>` / `<VoiceCapture>` — `<input type="file" accept="image/*" capture="environment">` → data-URL → `submit('image', dataUrl)`; MediaRecorder → data-URL → `submit('voice', dataUrl)`. **Verify the content encoding `WebNutribotAdapter` expects for image/voice on first run** (`backend/src/1_adapters/nutribot/WebNutribotAdapter.mjs`) and match it — data URL vs bare base64 is that adapter's call, not a new convention. `<CustomFoodSheet upc open onClose onCreated>` — name/calories/protein/carbs/fat inputs → `POST /nutrition/catalog` with `barcodeUpc: upc` → quick-add → done.

- [ ] **Step 1: Write the failing hook test**

```jsx
// frontend/src/modules/Health/capture/useNutritionInput.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { useNutritionInput } from './useNutritionInput.js';

describe('useNutritionInput', () => {
  beforeEach(() => apiMock.mockReset());

  it('submits typed content to the pipeline', async () => {
    apiMock.mockResolvedValue({ messages: [] });
    const { result } = renderHook(() => useNutritionInput());
    await act(() => result.current.submit('barcode', '012345678905'));
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/input',
      { type: 'barcode', content: '012345678905' }, 'POST');
  });

  it('surfaces unknownUpc results', async () => {
    apiMock.mockResolvedValue({ success: false, unknownUpc: true, upc: '000', messages: [] });
    const { result } = renderHook(() => useNutritionInput());
    let out;
    await act(async () => { out = await result.current.submit('barcode', '000'); });
    expect(out.unknownUpc).toBe(true);
  });

  it('keeps the error and clears busy on failure', async () => {
    apiMock.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useNutritionInput());
    await act(async () => { try { await result.current.submit('image', 'data:...'); } catch {} });
    expect(result.current.error.message).toBe('down');
    expect(result.current.busy).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Health/capture/useNutritionInput.test.jsx`
Expected: FAIL — cannot resolve the hook

- [ ] **Step 3: Write the implementations**

```javascript
// frontend/src/modules/Health/capture/useNutritionInput.js
import { useCallback, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('capture');

export function useNutritionInput() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = useCallback(async (type, content) => {
    setBusy(true); setError(null);
    logger.info('capture.submit', { type, size: String(content || '').length });
    try {
      const result = await DaylightAPI('api/v1/health/nutrition/input', { type, content }, 'POST');
      logger.info('capture.result', { type, unknownUpc: result?.unknownUpc === true });
      return result;
    } catch (err) {
      logger.error('capture.failed', { type, error: err?.message });
      setError(err);
      throw err;
    } finally { setBusy(false); }
  }, []);

  return { submit, busy, error };
}
export default useNutritionInput;
```

```jsx
// frontend/src/modules/Health/capture/BarcodeCapture.jsx
import { useEffect, useRef, useState } from 'react';
import { Button, TextInput, Text } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('barcode-capture');

/**
 * Camera barcode scan with a manual-UPC field that is ALWAYS present —
 * it is the permission-denied fallback and the test seam: both paths call
 * the same onDecode(upc).
 */
export function BarcodeCapture({ open, onClose, onDecode, busy }) {
  const videoRef = useRef(null);
  const [manualUpc, setManualUpc] = useState('');
  const [cameraState, setCameraState] = useState('starting'); // starting | live | denied

  useEffect(() => {
    if (!open) return undefined;
    let stream, stopped = false, zxingControls = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraState('live');

        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({ formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8'] });
          const tick = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes.length) { logger.info('decode.native', {}); return onDecode(codes[0].rawValue); }
            } catch { /* frame not ready */ }
            requestAnimationFrame(tick);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          zxingControls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
            if (result && !stopped) { logger.info('decode.zxing', {}); onDecode(result.getText()); }
          });
        }
      } catch (err) {
        logger.warn('camera.unavailable', { error: err?.message });
        setCameraState('denied');
      }
    })();

    return () => {
      stopped = true;
      zxingControls?.stop?.();
      stream?.getTracks?.().forEach((t) => t.stop());
    };
  }, [open, onDecode]);

  return (
    <Sheet open={open} onClose={onClose} title="Scan barcode">
      {cameraState !== 'denied' ? (
        <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 9 }} />
      ) : (
        <Text size="sm" c="dimmed">Camera unavailable — enter the barcode number instead.</Text>
      )}
      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
        <TextInput size="sm" style={{ flex: 1 }} inputMode="numeric" placeholder="UPC number"
          value={manualUpc} onChange={(e) => setManualUpc(e.target.value)}
          aria-label="Manual UPC entry" />
        <Button size="sm" loading={busy} disabled={!manualUpc.trim()}
          onClick={() => onDecode(manualUpc.trim())}>Look up</Button>
      </div>
    </Sheet>
  );
}
export default BarcodeCapture;
```

```jsx
// frontend/src/modules/Health/capture/PhotoCapture.jsx
import { useRef } from 'react';
import { ActionIcon } from '@mantine/core';

const CameraIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="2" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="9" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6 5l1-2h4l1 2" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/** Photo → data URL → the image pipeline. */
export function PhotoCapture({ onCapture, busy }) {
  const inputRef = useRef(null);
  return (
    <>
      <ActionIcon aria-label="Photo log" loading={busy} onClick={() => inputRef.current?.click()}>
        <CameraIcon />
      </ActionIcon>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onCapture(reader.result); // data URL
          reader.readAsDataURL(file);
          e.target.value = '';
        }} />
    </>
  );
}
export default PhotoCapture;
```

```jsx
// frontend/src/modules/Health/capture/VoiceCapture.jsx
import { useRef, useState } from 'react';
import { ActionIcon } from '@mantine/core';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('voice-capture');
const MicIcon = ({ active }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="6.5" y="2" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.5"
      fill={active ? 'currentColor' : 'none'} />
    <path d="M4 9a5 5 0 0010 0M9 14v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** Tap to record, tap to stop → data URL → the voice pipeline. */
export function VoiceCapture({ onCapture, busy }) {
  const recRef = useRef(null);
  const [recording, setRecording] = useState(false);

  const toggle = async () => {
    if (recording) { recRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const reader = new FileReader();
        reader.onload = () => onCapture(reader.result);
        reader.readAsDataURL(new Blob(chunks, { type: rec.mimeType }));
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      logger.info('voice.start', {});
    } catch (err) {
      logger.warn('voice.mic_unavailable', { error: err?.message });
    }
  };

  return (
    <ActionIcon aria-label={recording ? 'Stop recording' : 'Voice log'} loading={busy}
      color={recording ? 'red' : undefined} onClick={toggle}>
      <MicIcon active={recording} />
    </ActionIcon>
  );
}
export default VoiceCapture;
```

```jsx
// frontend/src/modules/Health/capture/CustomFoodSheet.jsx
import { useState } from 'react';
import { Button, NumberInput, Stack, Text, TextInput } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('custom-food');

/** Unknown barcode → create a catalog food mapped to it → quick-add it. */
export function CustomFoodSheet({ upc, open, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const { entry } = await DaylightAPI('api/v1/health/nutrition/catalog',
        { ...form, barcodeUpc: upc }, 'POST');
      await DaylightAPI('api/v1/health/nutrition/catalog/quickadd', { catalogEntryId: entry.id }, 'POST');
      logger.info('custom.created', { name: form.name, upc });
      onCreated();
    } catch (err) {
      logger.error('custom.failed', { error: err?.message });
      setError(err);
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New food">
      <Stack gap="xs">
        <Text size="sm" c="dimmed">Barcode {upc} isn't in any database — describe it once and it's yours forever.</Text>
        {error ? <Text size="sm" c="red">{error.message}</Text> : null}
        <TextInput label="Name" value={form.name} onChange={set('name')} autoFocus data-autofocus />
        <NumberInput label="Calories (per serving)" value={form.calories} onChange={set('calories')} min={0} />
        <NumberInput label="Protein g" value={form.protein} onChange={set('protein')} min={0} />
        <NumberInput label="Carbs g" value={form.carbs} onChange={set('carbs')} min={0} />
        <NumberInput label="Fat g" value={form.fat} onChange={set('fat')} min={0} />
        <Button loading={busy} disabled={!form.name.trim()} onClick={save}>Create & log</Button>
      </Stack>
    </Sheet>
  );
}
export default CustomFoodSheet;
```

Wire into `TodayView.jsx`: add state `const [captureMode, setCaptureMode] = useState(null); // 'barcode' | null` and `const [unknownUpc, setUnknownUpc] = useState(null);` plus the `useNutritionInput()` hook; pass capture buttons into the footer:

```jsx
      <MacroFooter items={day.items} coachLine={null} onCoachTap={onCoachTap}>
        <PhotoCapture busy={nutrition.busy}
          onCapture={async (dataUrl) => { await nutrition.submit('image', dataUrl); day.reload(); }} />
        <BarcodeButton onClick={() => setCaptureMode('barcode')} />
        <VoiceCapture busy={nutrition.busy}
          onCapture={async (dataUrl) => { await nutrition.submit('voice', dataUrl); day.reload(); }} />
      </MacroFooter>
      <BarcodeCapture open={captureMode === 'barcode'} busy={nutrition.busy}
        onClose={() => setCaptureMode(null)}
        onDecode={async (upc) => {
          const result = await nutrition.submit('barcode', upc);
          if (result?.unknownUpc) { setCaptureMode(null); setUnknownUpc(result.upc); }
          else { setCaptureMode(null); day.reload(); }
        }} />
      <CustomFoodSheet upc={unknownUpc} open={Boolean(unknownUpc)}
        onClose={() => setUnknownUpc(null)}
        onCreated={() => { setUnknownUpc(null); day.reload(); }} />
```

(`BarcodeButton` is a small `ActionIcon` with an inline-SVG barcode glyph — define it next to the footer wiring.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Health/capture/useNutritionInput.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/capture/ frontend/src/modules/Health/today/TodayView.jsx package.json package-lock.json
git commit -m "feat(health-ui): barcode/photo/voice capture and custom-food creation"
```

---

### Task F8: Saved meals picker + copy meal to today

**Files:**
- Create: `frontend/src/modules/Health/today/SavedMealsSheet.jsx`
- Modify: `frontend/src/modules/Health/today/AddCombobox.jsx` (a "Saved meals ▸" footer row opens the sheet)
- Modify: `frontend/src/modules/Health/today/LogTable.jsx` + `TodayView.jsx` (when viewing a past day, each non-empty meal section header gains a "Copy to today" action)
- Create: `frontend/src/modules/Health/today/SavedMealsSheet.test.jsx`

**Interfaces:**
- Consumes: `GET/POST api/v1/health/nutrition/meals`, `POST api/v1/health/nutrition/meals/:id/log` (B6).
- Produces: `<SavedMealsSheet open onClose onLogged bucketId>` — lists saved meals (name, item count, total kcal); tap → `POST /:id/log { mealTime: bucketId }` → `onLogged()`. Copy-to-today: `Section` gains an optional `headerAction` node; `TodayView` passes (only when `date !== today` and the bucket has rows) a "Copy to today" button that POSTs a new saved meal from the rows then immediately logs it to today — implemented as one helper `copyMealToToday(rows, bucketId)` in `TodayView.jsx` that: `POST /nutrition/meals {name: 'Copied <label>', items: rows}` → `POST /nutrition/meals/:id/log {date: today, mealTime: bucketId}` → `DELETE /nutrition/meals/:id` (the template was transport, not a keeper).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Health/today/SavedMealsSheet.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { DismissStackProvider } from '@/lib/ui';
import { SavedMealsSheet } from './SavedMealsSheet.jsx';

const MEALS = { meals: [
  { id: 'm1', name: 'Protein breakfast', items: [{ name: 'Eggs', calories: 140 }, { name: 'Toast', calories: 180 }] },
] };

describe('SavedMealsSheet', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path) => path.endsWith('nutrition/meals') ? MEALS : { items: [] });
  });

  it('lists saved meals with item count and kcal', async () => {
    render(<DismissStackProvider>
      <SavedMealsSheet open onClose={() => {}} onLogged={() => {}} bucketId="morning" />
    </DismissStackProvider>);
    await waitFor(() => expect(screen.getByText('Protein breakfast')).toBeTruthy());
    expect(screen.getByText(/2 items · 320 kcal/)).toBeTruthy();
  });

  it('tapping a meal logs it to the bucket', async () => {
    const onLogged = vi.fn();
    render(<DismissStackProvider>
      <SavedMealsSheet open onClose={() => {}} onLogged={onLogged} bucketId="morning" />
    </DismissStackProvider>);
    await waitFor(() => screen.getByText('Protein breakfast'));
    fireEvent.click(screen.getByText('Protein breakfast'));
    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    const logCall = apiMock.mock.calls.find(([p]) => p.includes('/m1/log'));
    expect(logCall[1]).toMatchObject({ mealTime: 'morning' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Health/today/SavedMealsSheet.test.jsx`
Expected: FAIL — cannot resolve `./SavedMealsSheet.jsx`

- [ ] **Step 3: Write the implementation**

```jsx
// frontend/src/modules/Health/today/SavedMealsSheet.jsx
import { UnstyledButton, Text } from '@mantine/core';
import { Sheet, LoadingState, EmptyState } from '@/lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('saved-meals');
const kcal = (meal) => Math.round(meal.items.reduce((s, i) => s + (Number(i.calories) || 0), 0));

export function SavedMealsSheet({ open, onClose, onLogged, bucketId }) {
  const { data, loading } = useApiResource(open ? 'api/v1/health/nutrition/meals' : null, { deps: [open], label: 'saved-meals', logger });
  const meals = data?.meals || [];

  const log = async (meal) => {
    try {
      await DaylightAPI(`api/v1/health/nutrition/meals/${meal.id}/log`, { mealTime: bucketId }, 'POST');
      logger.info('meal.logged', { id: meal.id });
      onLogged();
    } catch (err) {
      logger.error('meal.log_failed', { id: meal.id, error: err?.message });
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Saved meals">
      {loading ? <LoadingState label="saved meals" /> : null}
      {!loading && meals.length === 0 ? (
        <EmptyState title="No saved meals yet" hint="Save one from any logged item's edit sheet." />
      ) : null}
      {meals.map((meal) => (
        <UnstyledButton key={meal.id} className="health-suggest__item" onClick={() => log(meal)}>
          <span>{meal.name}</span>
          <Text size="xs" c="dimmed" ml="auto">{meal.items.length} items · {kcal(meal)} kcal</Text>
        </UnstyledButton>
      ))}
    </Sheet>
  );
}
export default SavedMealsSheet;
```

In `AddCombobox.jsx` add below the list a `UnstyledButton` "Saved meals ▸" firing a new `onSavedMeals` prop; `TodayView` holds `const [savedMealsFor, setSavedMealsFor] = useState(null)` and mounts `<SavedMealsSheet open={Boolean(savedMealsFor)} bucketId={savedMealsFor} onLogged={() => { setSavedMealsFor(null); setAddingTo(null); day.reload(); }} onClose={() => setSavedMealsFor(null)} />`.

Copy-to-today in `TodayView.jsx`:

```jsx
  const copyMealToToday = async (rows, bucketId, label) => {
    const items = rows.map((r) => ({ name: r.name || r.item, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat, color: r.color }));
    const { meal } = await DaylightAPI('api/v1/health/nutrition/meals', { name: `Copied ${label}`, items }, 'POST');
    await DaylightAPI(`api/v1/health/nutrition/meals/${meal.id}/log`, { date: todayISO(), mealTime: bucketId }, 'POST');
    await DaylightAPI(`api/v1/health/nutrition/meals/${meal.id}`, {}, 'DELETE');
    day.reload();
  };
```

`LogTable`'s `Section` gains `headerAction` (rendered next to the kcal subtotal); `LogTable` accepts `bucketHeaderAction(bucketId, rows, label)` and `TodayView` passes it:

- **Viewing a past day** (`date !== todayISO()`, rows non-empty): `<Button size="compact-xs" variant="subtle" onClick={() => copyMealToToday(rows, bucketId, label)}>Copy to today</Button>`.
- **Viewing today** (rows non-empty): `<Button size="compact-xs" variant="subtle" onClick={() => saveBucketAsMeal(rows, label)}>Save as meal</Button>` — this is US-2.2's "save several logged items as a named meal":

```jsx
  const saveBucketAsMeal = async (rows, label) => {
    const name = window.prompt('Name this meal:', `My ${label.toLowerCase()}`);
    if (!name) return;
    const items = rows.map((r) => ({ name: r.name || r.item, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat, color: r.color }));
    await DaylightAPI('api/v1/health/nutrition/meals', { name, items }, 'POST');
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Health/today/SavedMealsSheet.test.jsx`
Expected: PASS (2 tests). Re-run the F5 combobox test for regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/today/
git commit -m "feat(health-ui): saved meals picker and copy-meal-to-today"
```

---

### Task F9: Progress, Health (medical), coach insight; retire old surfaces

**Files:**
- Create: `frontend/src/modules/Health/progress/ProgressView.jsx` (absorbs `Weight.jsx`'s chart + goal editor)
- Create: `frontend/src/modules/Health/medical/MedicalView.jsx`
- Modify: `frontend/src/Apps/HealthApp.jsx` (mount both; coach insight line into TodayView)
- Modify: `frontend/src/modules/Health/today/TodayView.jsx` (fetch the coach dashboard one-liner)
- Delete: `frontend/src/modules/Health/HealthHub.jsx`, `HealthHub/` (folder), `HealthDetail.jsx`, `detail/` (folder), `cards/` (folder), `Nutrition.jsx`, `NutritionDay.jsx`, `Nutrition.scss`, `Weight.jsx`, `Weight.scss`, `AskBar/` (superseded by `AskAffordance`)

**Interfaces:**
- Consumes: `GET api/v1/lifelog/weight` (date-keyed; fields `lbs_adjusted_average`, `fat_percent_adjusted_average`, `lbs_adjusted_average_7day_trend`), `GET/PUT api/v1/health/goals` + `GET api/v1/health/budget` (B3), `GET/POST/DELETE api/v1/health/medical` (B7), `GET api/v1/health/dashboard` (existing — `today`, `history`), Highcharts via `highcharts-react-official` (already a dependency — `Weight.jsx` precedent), `SectionCard/StatCard/useApiResource/LoadingState/ErrorState/EmptyState/Sheet` (DS).
- Produces: **ProgressView** — weight Highcharts line (adjusted average) + flat goal line at `goals.targetWeightLbs`; StatCards (current weight, 7-day trend ×7 as lbs/week, body fat %); weekly adherence bars (last 14 days: per-day food kcal vs budget from `GET /budget?date=` — fetch sequentially, render as simple flex bars, color `--ds-success`/`--ds-danger` by under/over); goal editor form (all goals fields, PUT on save). **MedicalView** — grouped metrics as SectionCards (latest value large, history rows with date + note, delete per row), an "Add reading" Sheet (metric text input with datalist suggestions `bp, resting_hr, glucose, a1c, cholesterol_total, ldl, hdl, triglycerides`, value, value2 shown when metric is `bp`, unit, date, note). **Coach insight**: TodayView fetches `GET api/v1/health/dashboard` and passes `dashboard?.today?.coaching?.headline || dashboard?.coachLine || null` into `MacroFooter` — inspect the dashboard payload on the dev server for the exact field carrying the daily one-liner and use that; when absent, the footer simply omits the line (no fabricated copy).

- [ ] **Step 1: Build ProgressView**

Structure (write in full — the chart config is ported from `Weight.jsx`'s existing Highcharts usage, keeping its series options but swapping hardcoded colors for token values read via `getComputedStyle` or Highcharts' CSS-styled mode):

```jsx
// frontend/src/modules/Health/progress/ProgressView.jsx — skeleton to flesh out
import { useMemo, useState } from 'react';
import HighchartsReact from 'highcharts-react-official';
import Highcharts from 'highcharts';
import { Button, NumberInput, SegmentedControl, Stack } from '@mantine/core';
import { SectionCard, StatCard, LoadingState, ErrorState } from '@/lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
```

- Weight data: `useApiResource('api/v1/lifelog/weight')`; sort keys, build `[timestamp, lbs_adjusted_average]` series + a constant goal-line series.
- Stats row: latest entry → StatCards.
- Goal editor: `useApiResource('api/v1/health/goals')`; local form state; `DaylightAPI('api/v1/health/goals', form, 'PUT')` on save; `sex` via SegmentedControl (male/female), numbers via NumberInput (no sliders).
- Adherence: fetch the last 14 days of `api/v1/health/budget?date=` in one `Promise.all` on mount (own `useEffect` + state, tolerating per-day 409s as gaps), bars in a flex row.

- [ ] **Step 2: Build MedicalView**

Full CRUD per the interface block: list from `useApiResource('api/v1/health/medical')`, add-Sheet POSTs then reloads, delete button per reading row (`window.confirm` first). BP entry shows paired systolic/diastolic NumberInputs mapping to `value`/`value2`.

- [ ] **Step 3: Wire tabs + insight, delete old files**

`HealthApp.jsx`: `{tab === 'progress' && <ProgressView />}`, `{tab === 'health' && <MedicalView />}`. TodayView: `const dash = useApiResource('api/v1/health/dashboard', { label: 'dashboard' });` → coach line into MacroFooter.

Delete the retired files (`git rm -r`), then `grep -rn "HealthHub\|HealthDetail\|NutritionDay\|modules/Health/Weight" frontend/src` and fix any残 importers (FitnessApp or others may import `Weight.jsx` — if something outside Health imports a deleted file, keep that file and note it; do not break another app in this task).

- [ ] **Step 4: Verify**

`npx vitest run frontend/src/modules/Health` — all Health tests green (delete the test files of deleted components). Load `/health`: all four tabs render real content; add a BP reading; edit goals and watch the equation strip change after reload.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/modules/Health frontend/src/Apps/HealthApp.jsx
git commit -m "feat(health-ui): progress and medical tabs; retire hub-era surfaces"
```

---

### Task F10: API integration tests

**Files:**
- Create: `tests/live/api/health/loseit-endpoints.api.test.mjs`

**Interfaces:** exercises B3/B4/B6/B7 against the running dev server (the live harness checks backend health first — `npm run test:live:api`).

- [ ] **Step 1: Write the tests**

Follow the structure of an existing file in `tests/live/api/` (read one first for the harness's base-URL/import conventions), covering:

```javascript
// tests/live/api/health/loseit-endpoints.api.test.mjs — shape per existing api tests
// 1. goals round-trip: PUT goals → GET goals returns them
// 2. budget: GET /budget returns { budget, food, exercise, remaining, status } with numbers
//    (or a 409 with code GOALS_NOT_CONFIGURED — assert one of the two, never skip)
// 3. suggest: POST /nutrition/catalog {name:'ZZZ Integration Food', calories:123} →
//    GET /nutrition/catalog/suggest?q=zzz returns it; PUT favorite {name, favorite:true} →
//    suggest returns it first
// 4. saved meals: POST → GET lists it → POST /:id/log {date: <today>} → GET nutrilist/<today>
//    contains the item rows (log_uuid SAVEDMEAL) → DELETE meal; DELETE the nutrilist rows created
// 5. medical: POST bp reading → GET grouped shows metric bp latest → DELETE → gone
```

Each numbered case is a real `test()` with real assertions on values, using the repo's live-api test conventions. Clean up every row/meal/reading the test created (DELETE endpoints exist for all of them) so reruns stay deterministic.

- [ ] **Step 2: Run**

Run: `npm run test:live:api -- --filter=health` (or the harness's actual filter flag; fall back to `npx vitest run tests/live/api/health/ --config <the live config>` matching how other live api tests run — read `tests/_infrastructure/harnesses/live.harness.mjs` to see how it invokes them).
Expected: PASS. A down backend is a FAIL, not a skip.

- [ ] **Step 3: Commit**

```bash
git add tests/live/api/health/
git commit -m "test(health): live API coverage for budget, catalog, meals, medical"
```

---

### Task F11: Playwright flows

**Files:**
- Create: `tests/live/flow/health/health-fast-log.runtime.test.mjs`
- Create: `tests/live/flow/health/health-sentence-parse.runtime.test.mjs`
- Create: `tests/live/flow/health/health-barcode-lifecycle.runtime.test.mjs`

**Interfaces:** the two benchmark journeys + barcode lifecycle, against `/health` on the configured port (SSOT via `tests/_lib/configHelper.mjs` / `tests/_fixtures/runtime/urls.mjs`).

- [ ] **Step 1: Fast log**

```javascript
// tests/live/flow/health/health-fast-log.runtime.test.mjs
import { test, expect } from '@playwright/test';

test('per-meal add → suggest pick → row lands in the section, equation updates', async ({ page, request }) => {
  // Seed a distinctive catalog food via the API (idempotent by name).
  await request.post('/api/v1/health/nutrition/catalog', {
    data: { name: 'Playwright Chicken 6oz', calories: 231, protein: 43, carbs: 0, fat: 5 },
  });

  await page.goto('/health');
  await expect(page.getByText('Breakfast')).toBeVisible();

  const equationBefore = await page.locator('.health-equation__math').textContent();

  await page.getByText(/Add food/).first().click();
  await page.getByPlaceholder(/Food name/).fill('playwright chick');
  await expect(page.getByText('Playwright Chicken 6oz')).toBeVisible();
  await page.getByText('Playwright Chicken 6oz').click();

  // The row appears inside the Breakfast section
  const breakfast = page.locator('.health-meal', { hasText: 'Breakfast' });
  await expect(breakfast.getByText('Playwright Chicken 6oz')).toBeVisible();

  // Equation strip moved (food total changed)
  await expect(page.locator('.health-equation__math')).not.toHaveText(equationBefore);

  // Cleanup: delete the row via the edit sheet
  page.on('dialog', (d) => d.accept());
  await breakfast.getByText('Playwright Chicken 6oz').click();
  await page.getByRole('button', { name: /^Delete$/ }).click();
  await expect(breakfast.getByText('Playwright Chicken 6oz')).not.toBeVisible();
});
```

- [ ] **Step 2: Sentence parse**

```javascript
// tests/live/flow/health/health-sentence-parse.runtime.test.mjs
import { test, expect } from '@playwright/test';

test('free sentence → pending card → accept → totals move', async ({ page }) => {
  test.setTimeout(90_000); // real AI parse in the loop
  await page.goto('/health');
  await page.getByText(/Add food/).first().click();
  const input = page.getByPlaceholder(/Food name/);
  await input.fill('two scrambled eggs and a slice of sourdough toast');
  await input.press('Enter');

  // Pending card with itemized parse — the AI gateway being down FAILS here (no-skip policy).
  const card = page.locator('.health-pending');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByRole('button', { name: /accept/i })).toBeVisible();
  await card.getByRole('button', { name: /accept/i }).click();

  // Accepted entries land in the log
  await expect(page.locator('.health-row', { hasText: /egg/i }).first()).toBeVisible({ timeout: 15_000 });

  // Cleanup: delete what we logged
  page.on('dialog', (d) => d.accept());
  for (const pattern of [/egg/i, /toast|sourdough/i]) {
    const row = page.locator('.health-row', { hasText: pattern }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.click();
      await page.getByRole('button', { name: /^Delete$/ }).click();
    }
  }
});
```

- [ ] **Step 3: Barcode lifecycle (manual-UPC seam — no camera in headless)**

```javascript
// tests/live/flow/health/health-barcode-lifecycle.runtime.test.mjs
import { test, expect } from '@playwright/test';

const FAKE_UPC = '999999000001'; // not in OFF/Nutritionix; exercises unknownUpc

test('unknown UPC → custom food sheet → create → rescan hits the catalog', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/health');

  // Open barcode capture, use the manual-UPC field (the same submit path as a camera decode)
  await page.getByRole('button', { name: /barcode/i }).click();
  await page.getByLabel('Manual UPC entry').fill(FAKE_UPC);
  await page.getByRole('button', { name: /look up/i }).click();

  // Unknown → CustomFoodSheet
  await expect(page.getByText(/isn't in any database/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Name').fill('Playwright Granola');
  await page.getByLabel(/Calories/).fill('210');
  await page.getByRole('button', { name: /create & log/i }).click();
  await expect(page.locator('.health-row', { hasText: 'Playwright Granola' })).toBeVisible({ timeout: 15_000 });

  // Rescan: same UPC now resolves from the catalog (no unknown sheet)
  await page.getByRole('button', { name: /barcode/i }).click();
  await page.getByLabel('Manual UPC entry').fill(FAKE_UPC);
  await page.getByRole('button', { name: /look up/i }).click();
  await expect(page.getByText(/isn't in any database/)).not.toBeVisible({ timeout: 30_000 });

  // Cleanup rows created by both scans
  page.on('dialog', (d) => d.accept());
  for (let i = 0; i < 2; i++) {
    const row = page.locator('.health-row', { hasText: 'Playwright Granola' }).first();
    if (!(await row.isVisible().catch(() => false))) break;
    await row.click();
    await page.getByRole('button', { name: /^Delete$/ }).click();
  }
});
```

- [ ] **Step 4: Run all three**

Run: `npx playwright test tests/live/flow/health/ --reporter=line`
Expected: PASS ×3. The sentence test failing on AI-gateway downtime is correct behavior — investigate the gateway, don't weaken the test.

- [ ] **Step 5: Commit**

```bash
git add tests/live/flow/health/
git commit -m "test(health): benchmark journey flows — fast log, sentence parse, barcode lifecycle"
```

---

### Task F12: Docs, deploy, final gates

**Files:**
- Create: `docs/reference/health/README.md` (present-tense endstate: the log-first app, the budget equation and its one server-side home, capture funnels, meal buckets, saved meals, custom foods, medical readings, coach `log_food`; navigation table row in `CLAUDE.md`)
- Modify: `docs/reference/nutrition/README.md` (add a short "Web app surface" cross-link section — the fridge/scale pipeline is unchanged and both write the same log)

- [ ] **Step 1: Write the docs** per house convention (endstate, no class names, no instance-specific values).

- [ ] **Step 2: Full verification suite**

```bash
npm run test:unit:vitest          # repo vitest gate
npm run audit:ui                  # anti-slop gate — new Health UI must not raise counts
npx playwright test tests/live/flow/health/ tests/live/flow/ds/ --reporter=line
npm run test:live:api
```

All green before proceeding.

- [ ] **Step 3: Deploy (kckern-server rules)**

```bash
./scripts/deploy-gate.sh          # must exit 0 — HALT the sequence otherwise
./scripts/build-daylight.sh
./scripts/deploy-gate.sh          # re-run after the build (someone may have walked up)
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

No garage-kiosk reload needed (no `frontend/src/modules/Fitness/` changes) — but hard-reload any open `/health` tab.

- [ ] **Step 4: Manual checklist (phone + desktop)**

- Phone: camera barcode scan of a real product; photo log of a plate; voice log; four-tap benchmark journey stopwatch-honest.
- Desktop: sidebar/rail layout, ⌘K, goal edit → equation change.
- Kitchen-scale entry (or Telegram text log) appears on the Today view after refocus.

- [ ] **Step 5: Final commit**

```bash
git add docs/
git commit -m "docs(health): reference for the log-first health app"
```

---

## Final verification (whole plan)

- [ ] All Part B unit tests: `npx vitest run backend/src/2_domains/health backend/src/3_applications/health backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.catalog.test.mjs backend/src/3_applications/agents/health-coach/tools backend/src/1_adapters/persistence/yaml`
- [ ] All Part F unit tests: `npx vitest run frontend/src/modules/Health`
- [ ] `npm run test:unit:vitest`, `npm run audit:ui`, `npm run audit:layers` all green
- [ ] Live: `npm run test:live:api` + `npx playwright test tests/live/flow/health/ --reporter=line`
- [ ] Deployed via the gated sequence; `/health` on prod serves the new app

