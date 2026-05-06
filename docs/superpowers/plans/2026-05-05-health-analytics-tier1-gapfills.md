# Health Analytics — Tier 1 Gap-Fills Implementation Plan (Plan 5/5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the five small Tier 1 gaps identified in the design spec — add `yearly_avg` aggregation, longitudinal reconciliation/coaching mirrors, workout count aggregations, and a nutrition-density tool — all on the existing `LongitudinalToolFactory`.

**Architecture:** This plan adds new tools to the existing `LongitudinalToolFactory` (in `backend/src/3_applications/agents/health-coach/tools/`) — NOT to the new `HealthAnalyticsToolFactory` from Plans 1-4. These are tool-layer extensions to the pre-existing longitudinal surface; they consume `IHealthDataDatastore` directly via the factory's existing pattern.

**Tech Stack:** Same as Plans 1-4. Vitest, ES modules.

**Spec:** [docs/superpowers/specs/2026-05-05-health-coach-data-tier-design.md](../specs/2026-05-05-health-coach-data-tier-design.md) — "Tier 1 gap-fills (ship in the same pass)" section. Plan 5 closes the same items the spec listed; Plans 1-4 didn't touch them.

**Prerequisites:** None — this plan is INDEPENDENT of Plans 2-4 (touches different files). It runs cleanly against any Plan-1-onwards baseline.

**Note:** This plan extends `LongitudinalToolFactory` only — no `HealthAnalyticsService`/`HealthAnalyticsToolFactory`/CLI changes. Future polish could expose these as `dscli health` actions but that's out of scope here.

---

## File structure

**Modified files:**
- `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs` — add 4 new tools, extend 2 existing.
- `tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs` — extend test fixture and add new test cases.

---

## Conventions

- Match the LongitudinalToolFactory pattern: domain `'health'`, `createTools()` returns array of `createTool({ name, description, parameters, execute })`.
- Errors → `{ ..., error: <message> }` envelope (don't throw).
- All commits end with: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- For longitudinal queries with redaction (reconciliation), apply the same 14-day maturity window the existing `query_historical_nutrition` uses.

---

## Task 1: Add `yearly_avg` to query_historical_weight aggregations

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs`
- Modify: `tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs`

The existing `AGGREGATIONS` const in the factory is `['daily', 'weekly_avg', 'monthly_avg', 'quarterly_avg']`. We add `'yearly_avg'`. The `bucketKey` switch needs a `'yearly_avg'` case returning the year as `YYYY`.

- [ ] **Step 1: Append failing test**

```javascript
describe('query_historical_weight — yearly_avg (Plan 5)', () => {
  it('aggregates 2 years of data into 2 yearly buckets', async () => {
    const fixture = {};
    let lbs = 200;
    const start = new Date(Date.UTC(2024, 0, 1));
    for (let i = 0; i < 730; i++) {  // 2 years
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      fixture[d.toISOString().slice(0, 10)] = {
        date: d.toISOString().slice(0, 10),
        lbs, lbs_adjusted_average: lbs - 0.5, source: 'consumer-bia',
      };
      lbs -= 0.01;
    }
    const { factory } = makeFactory({ loadWeightData: vi.fn(async () => fixture) });
    const tool = getQueryTool(factory);
    const out = await tool.execute({
      userId: 'kc',
      from: '2024-01-01', to: '2025-12-31',
      aggregation: 'yearly_avg',
    });
    expect(out.aggregation).toBe('yearly_avg');
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0].period).toBe('2024');
    expect(out.rows[1].period).toBe('2025');
    expect(typeof out.rows[0].lbs).toBe('number');
  });

  it('rejects unknown aggregation with structured error', async () => {
    const { factory } = makeFactory();
    const tool = getQueryTool(factory);
    const out = await tool.execute({
      userId: 'kc', from: '2024-01-01', to: '2024-12-31',
      aggregation: 'centurial_avg',
    });
    expect(out.error).toMatch(/Unknown aggregation/);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs
```

- [ ] **Step 3: Add `'yearly_avg'` to AGGREGATIONS and the bucketKey switch**

In `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs`:

Find:
```javascript
const AGGREGATIONS = ['daily', 'weekly_avg', 'monthly_avg', 'quarterly_avg'];
```
Replace with:
```javascript
const AGGREGATIONS = ['daily', 'weekly_avg', 'monthly_avg', 'quarterly_avg', 'yearly_avg'];
```

Find the bucketKey selection in `makeQueryWeightExecutor` (approximately):
```javascript
      const bucketKey =
        aggregation === 'weekly_avg' ? isoWeek :
        aggregation === 'monthly_avg' ? isoMonth :
        quarter; // 'quarterly_avg'
```
Replace with:
```javascript
      const bucketKey =
        aggregation === 'weekly_avg' ? isoWeek :
        aggregation === 'monthly_avg' ? isoMonth :
        aggregation === 'quarterly_avg' ? quarter :
        isoYear; // 'yearly_avg'
```

Add `isoYear` helper at the bottom of the file alongside `isoMonth`, `quarter`, `isoWeek`:

```javascript
function isoYear(dateStr) {
  // 'YYYY-MM-DD' → 'YYYY'
  return dateStr.slice(0, 4);
}
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs \
        tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs
git commit -m "feat(health-coach): query_historical_weight supports yearly_avg

Plan 5 / Task 1. Closes Tier 1 gap from spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add `query_historical_reconciliation`

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs`
- Modify: `tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs`

The new tool reads `healthStore.loadReconciliationData(userId)` and returns days within `[from, to]`. Apply 14-day maturity redaction (mirror `query_historical_nutrition` and the existing `ReconciliationToolFactory.get_reconciliation_summary`).

- [ ] **Step 1: Append failing tests**

```javascript
describe('query_historical_reconciliation (Plan 5)', () => {
  function buildReconciliationFixture(today) {
    const data = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      data[date] = {
        tracked_calories: 2100 - i,
        exercise_calories: 300 + i,
        tracking_accuracy: 0.85,
        implied_intake: 2000 + i,
        calorie_adjustment: -100,
      };
    }
    return data;
  }

  it('returns days in window with matured/redacted fields per row', async () => {
    const today = new Date();  // anchor; tests ARE time-sensitive
    const fixture = buildReconciliationFixture(today);
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
      loadReconciliationData: vi.fn(async () => fixture),
    };
    const factory = new LongitudinalToolFactory({ healthStore });
    const tool = factory.createTools().find(t => t.name === 'query_historical_reconciliation');
    expect(tool).toBeDefined();

    const todayStr = today.toISOString().slice(0, 10);
    const fromDate = new Date(today);
    fromDate.setUTCDate(fromDate.getUTCDate() - 29);
    const fromStr = fromDate.toISOString().slice(0, 10);

    const out = await tool.execute({ userId: 'kc', from: fromStr, to: todayStr });
    expect(out.days.length).toBe(30);
    // Last 14 days redacted: only tracked_calories and exercise_calories present
    const recent = out.days.find(d => d.date === todayStr);
    expect(recent.tracked_calories).toBeDefined();
    expect(recent.exercise_calories).toBeDefined();
    expect(recent.tracking_accuracy).toBeUndefined();
    expect(recent.implied_intake).toBeUndefined();
    expect(recent.calorie_adjustment).toBeUndefined();
    // Old days (> 14 days back) keep all fields
    const oldDate = new Date(today);
    oldDate.setUTCDate(oldDate.getUTCDate() - 20);
    const oldStr = oldDate.toISOString().slice(0, 10);
    const old = out.days.find(d => d.date === oldStr);
    expect(old.tracking_accuracy).toBeDefined();
    expect(old.implied_intake).toBeDefined();
  });

  it('returns empty days for an out-of-range window', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
      loadReconciliationData: vi.fn(async () => ({ '2024-01-15': { tracked_calories: 2000 } })),
    };
    const factory = new LongitudinalToolFactory({ healthStore });
    const tool = factory.createTools().find(t => t.name === 'query_historical_reconciliation');
    const out = await tool.execute({ userId: 'kc', from: '2025-01-01', to: '2025-12-31' });
    expect(out.days).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Add the tool to `createTools()`**

In `LongitudinalToolFactory.mjs`, add this entry to the tools array (e.g. after `read_notes_file` or `find_similar_period`):

```javascript
      createTool({
        name: 'query_historical_reconciliation',
        description:
          'Query reconciliation data over an inclusive [from, to] date range. ' +
          'Returns per-day tracked_calories and exercise_calories. The 14-day ' +
          'maturity gate strips implied_intake / tracking_accuracy / ' +
          'calorie_adjustment from days less than 14 days old (those values ' +
          'depend on weight smoothing that hasn\'t settled).',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            from:   { type: 'string', description: 'YYYY-MM-DD inclusive' },
            to:     { type: 'string', description: 'YYYY-MM-DD inclusive' },
          },
          required: ['userId', 'from', 'to'],
        },
        execute: async ({ userId, from, to }) => {
          try {
            HealthArchiveScope.assertValidUserId(userId);
            const data = await healthStore.loadReconciliationData?.(userId) || {};
            const dates = Object.keys(data).filter(d => d >= from && d <= to).sort();

            const MATURITY_DAYS = 14;
            const now = new Date();
            const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
            const cutoff = new Date(todayUtc);
            cutoff.setUTCDate(cutoff.getUTCDate() - MATURITY_DAYS);

            const days = dates.map(date => {
              const entry = data[date] || {};
              const dateObj = new Date(date + 'T00:00:00Z');
              const isMature = dateObj <= cutoff;
              const day = {
                date,
                tracked_calories: entry.tracked_calories ?? 0,
                exercise_calories: entry.exercise_calories ?? 0,
              };
              if (isMature) {
                if (entry.tracking_accuracy   !== undefined) day.tracking_accuracy   = entry.tracking_accuracy;
                if (entry.implied_intake      !== undefined) day.implied_intake      = entry.implied_intake;
                if (entry.calorie_adjustment  !== undefined) day.calorie_adjustment  = entry.calorie_adjustment;
              }
              return day;
            });

            return { days };
          } catch (err) {
            return { days: [], error: err.message };
          }
        },
      }),
```

(Where `healthStore` is destructured at the top of `createTools()` — match the existing pattern.)

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs \
        tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs
git commit -m "feat(health-coach): query_historical_reconciliation

Plan 5 / Task 2. Reconciliation longitudinal query with 14-day maturity
redaction matching the existing rolling-window tool.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add `query_historical_coaching`

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs`
- Modify: `tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs`

Reads `healthStore.loadCoachingData(userId)`. The shape is `{ date: [{ type, text, timestamp }, ...] }` per the existing `ReconciliationToolFactory.get_coaching_history`.

- [ ] **Step 1: Append tests**

```javascript
describe('query_historical_coaching (Plan 5)', () => {
  it('returns entries grouped by date in the window', async () => {
    const fixture = {
      '2024-06-15': [{ type: 'morning_brief', text: 'Hello', timestamp: '2024-06-15T08:00:00Z' }],
      '2024-07-01': [{ type: 'feedback', text: 'Good week', timestamp: '2024-07-01T19:00:00Z' }],
      '2024-08-15': [{ type: 'morning_brief', text: 'Pulling cut tight' }],
    };
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
      loadCoachingData: vi.fn(async () => fixture),
    };
    const factory = new LongitudinalToolFactory({ healthStore });
    const tool = factory.createTools().find(t => t.name === 'query_historical_coaching');
    expect(tool).toBeDefined();

    const out = await tool.execute({ userId: 'kc', from: '2024-07-01', to: '2024-12-31' });
    expect(out.entries).toHaveLength(2);
    const dates = out.entries.map(e => e.date);
    expect(dates).toEqual(['2024-07-01', '2024-08-15']);
    expect(out.entries[0].messages[0].text).toBe('Good week');
  });

  it('returns empty when no entries in range', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
      loadCoachingData: vi.fn(async () => ({ '2024-01-01': [{ text: 'Older entry' }] })),
    };
    const factory = new LongitudinalToolFactory({ healthStore });
    const tool = factory.createTools().find(t => t.name === 'query_historical_coaching');
    const out = await tool.execute({ userId: 'kc', from: '2025-01-01', to: '2025-12-31' });
    expect(out.entries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Add the tool**

```javascript
      createTool({
        name: 'query_historical_coaching',
        description:
          'Query past coaching messages over an inclusive [from, to] date ' +
          'range. Returns per-date entries with type/text/timestamp.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            from:   { type: 'string' },
            to:     { type: 'string' },
          },
          required: ['userId', 'from', 'to'],
        },
        execute: async ({ userId, from, to }) => {
          try {
            HealthArchiveScope.assertValidUserId(userId);
            const data = await healthStore.loadCoachingData?.(userId) || {};
            const dates = Object.keys(data).filter(d => d >= from && d <= to).sort();
            const entries = dates.map(date => ({
              date,
              messages: (data[date] || []).map(entry => ({
                type: entry.type,
                text: entry.text || entry.message,
                timestamp: entry.timestamp,
              })),
            }));
            return { entries };
          } catch (err) {
            return { entries: [], error: err.message };
          }
        },
      }),
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs \
        tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs
git commit -m "feat(health-coach): query_historical_coaching

Plan 5 / Task 3. Coaching history longitudinal query.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extend `query_historical_workouts` with count aggregations

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs`
- Modify: `tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs`

Add an optional `aggregation: 'weekly_count' | 'monthly_count' | 'yearly_count'` parameter. When present, returns per-bucket `{ period, count, totalDuration }` rolling-up across days. When absent (default), returns the existing flat list.

- [ ] **Step 1: Append tests**

```javascript
describe('query_historical_workouts — count aggregations (Plan 5)', () => {
  it('returns weekly_count buckets with workouts per week + total duration', async () => {
    const healthService = {
      getHealthForRange: vi.fn(async () => ({
        '2024-08-05': { workouts: [{ type: 'run', title: 'Mon run', duration: 30 }] },     // Mon W32
        '2024-08-07': { workouts: [{ type: 'run', title: 'Wed run', duration: 35 }] },     // Wed W32
        '2024-08-12': { workouts: [{ type: 'ride', title: 'Mon ride', duration: 60 }] },   // Mon W33
      })),
    };
    const factory = new LongitudinalToolFactory({
      healthStore: { loadWeightData: vi.fn(async () => ({})), loadNutritionData: vi.fn(async () => ({})) },
      healthService,
    });
    const tool = factory.createTools().find(t => t.name === 'query_historical_workouts');
    const out = await tool.execute({
      userId: 'kc',
      from: '2024-08-01', to: '2024-08-15',
      aggregation: 'weekly_count',
    });
    expect(out.aggregation).toBe('weekly_count');
    expect(out.rows.length).toBe(2);
    // W32 has 2 workouts totaling 65 min, W33 has 1 totaling 60 min
    const w32 = out.rows.find(r => r.period.endsWith('W32'));
    const w33 = out.rows.find(r => r.period.endsWith('W33'));
    expect(w32.count).toBe(2);
    expect(w32.totalDurationMin).toBe(65);
    expect(w33.count).toBe(1);
    expect(w33.totalDurationMin).toBe(60);
  });

  it('returns monthly_count buckets', async () => {
    const healthService = {
      getHealthForRange: vi.fn(async () => ({
        '2024-08-05': { workouts: [{ type: 'run', duration: 30 }] },
        '2024-08-15': { workouts: [{ type: 'run', duration: 35 }] },
        '2024-09-10': { workouts: [{ type: 'ride', duration: 60 }] },
      })),
    };
    const factory = new LongitudinalToolFactory({
      healthStore: { loadWeightData: vi.fn(async () => ({})), loadNutritionData: vi.fn(async () => ({})) },
      healthService,
    });
    const tool = factory.createTools().find(t => t.name === 'query_historical_workouts');
    const out = await tool.execute({
      userId: 'kc',
      from: '2024-08-01', to: '2024-09-30',
      aggregation: 'monthly_count',
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0].period).toBe('2024-08');
    expect(out.rows[0].count).toBe(2);
    expect(out.rows[1].period).toBe('2024-09');
    expect(out.rows[1].count).toBe(1);
  });

  it('returns yearly_count buckets', async () => {
    const healthService = {
      getHealthForRange: vi.fn(async () => ({
        '2024-03-15': { workouts: [{ duration: 30 }, { duration: 30 }] },
        '2024-12-25': { workouts: [{ duration: 45 }] },
        '2025-01-10': { workouts: [{ duration: 30 }] },
      })),
    };
    const factory = new LongitudinalToolFactory({
      healthStore: { loadWeightData: vi.fn(async () => ({})), loadNutritionData: vi.fn(async () => ({})) },
      healthService,
    });
    const tool = factory.createTools().find(t => t.name === 'query_historical_workouts');
    const out = await tool.execute({
      userId: 'kc',
      from: '2024-01-01', to: '2025-12-31',
      aggregation: 'yearly_count',
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({ period: '2024', count: 3, totalDurationMin: 105 });
    expect(out.rows[1]).toMatchObject({ period: '2025', count: 1, totalDurationMin: 30 });
  });

  it('returns the existing flat list when aggregation not provided (no regression)', async () => {
    const healthService = {
      getHealthForRange: vi.fn(async () => ({
        '2024-08-05': { workouts: [{ type: 'run', title: 'Run', duration: 30 }] },
      })),
    };
    const factory = new LongitudinalToolFactory({
      healthStore: { loadWeightData: vi.fn(async () => ({})), loadNutritionData: vi.fn(async () => ({})) },
      healthService,
    });
    const tool = factory.createTools().find(t => t.name === 'query_historical_workouts');
    const out = await tool.execute({ userId: 'kc', from: '2024-08-01', to: '2024-08-31' });
    expect(out.workouts).toBeDefined();
    expect(out.workouts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Update `makeQueryWorkoutsExecutor`**

Replace the existing executor with one that conditionally aggregates:

```javascript
function makeQueryWorkoutsExecutor(healthService) {
  return async function queryWorkouts({ userId, from, to, type = null, name_contains = null, aggregation = null }) {
    try {
      guardUserId(userId);
      const healthData = await healthService.getHealthForRange(userId, from, to);

      const needle = typeof name_contains === 'string' && name_contains.length
        ? name_contains.toLowerCase() : null;

      const workouts = [];
      for (const [date, metric] of Object.entries(healthData || {})) {
        for (const w of (metric?.workouts || [])) {
          if (type != null && w.type !== type) continue;
          if (needle != null) {
            const label = (w.title || w.name || '').toLowerCase();
            if (!label.includes(needle)) continue;
          }
          workouts.push({
            date,
            title: w.title || w.name,
            type: w.type,
            duration: w.duration,
            calories: w.calories,
            avgHr: w.avgHr,
          });
        }
      }
      workouts.sort((a, b) => a.date.localeCompare(b.date));

      // Optional rollup
      if (aggregation) {
        const validAggregations = ['weekly_count', 'monthly_count', 'yearly_count'];
        if (!validAggregations.includes(aggregation)) {
          return { aggregation, rows: [], error: `Unknown aggregation: ${aggregation}` };
        }
        const bucketKey = aggregation === 'weekly_count' ? isoWeek :
                          aggregation === 'monthly_count' ? isoMonth :
                          isoYear;
        const buckets = new Map();
        for (const w of workouts) {
          const key = bucketKey(w.date);
          if (!buckets.has(key)) buckets.set(key, { period: key, count: 0, totalDurationMin: 0 });
          const b = buckets.get(key);
          b.count++;
          if (typeof w.duration === 'number' && Number.isFinite(w.duration)) {
            b.totalDurationMin += w.duration;
          }
        }
        const rows = [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period));
        return { aggregation, rows };
      }

      return { workouts };
    } catch (err) {
      return { workouts: [], error: err.message };
    }
  };
}
```

Update the tool's `parameters` schema (in the `createTool({ name: 'query_historical_workouts', ... })` block) to add the new optional `aggregation` field:

```javascript
            aggregation: {
              type: 'string',
              enum: ['weekly_count', 'monthly_count', 'yearly_count'],
              description: 'Optional rollup. When present, returns per-bucket count + totalDurationMin instead of a flat list.',
            },
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs \
        tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs
git commit -m "feat(health-coach): query_historical_workouts supports count aggregations

Plan 5 / Task 4. Optional aggregation: weekly_count | monthly_count |
yearly_count returns per-bucket { count, totalDurationMin }.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Add `query_nutrition_density`

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs`
- Modify: `tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs`

Returns per-bucket "% of days logged" series. A "logged" day is one with any nutrition entry that has `calories > 0` (mirror MetricRegistry's `tracking_density.read` behavior from Plan 1).

- [ ] **Step 1: Append tests**

```javascript
describe('query_nutrition_density (Plan 5)', () => {
  function buildDensityFixture() {
    // 60 days. Days 0-29: log every other day (50% density).
    // Days 30-59: log every day (100% density).
    const data = {};
    const start = new Date(Date.UTC(2024, 5, 1)); // June 1
    for (let i = 0; i < 60; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const isLogged = i < 30 ? (i % 2 === 0) : true;
      if (isLogged) data[key] = { calories: 2000 };
    }
    return data;
  }

  it('returns monthly density buckets', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => buildDensityFixture()),
    };
    const factory = new LongitudinalToolFactory({ healthStore });
    const tool = factory.createTools().find(t => t.name === 'query_nutrition_density');
    expect(tool).toBeDefined();

    const out = await tool.execute({
      userId: 'kc',
      from: '2024-06-01', to: '2024-07-30',
      granularity: 'monthly',
    });
    expect(out.granularity).toBe('monthly');
    expect(out.rows.length).toBe(2);

    const june = out.rows.find(r => r.period === '2024-06');
    expect(june).toBeDefined();
    // June 1-30 = 30 days; days 0-29 of fixture; logged on even i (0,2,4,...,28) = 15 logged
    expect(june.daysLogged).toBe(15);
    expect(june.daysInPeriod).toBe(30);
    expect(june.density).toBeCloseTo(15 / 30, 5);

    const july = out.rows.find(r => r.period === '2024-07');
    expect(july).toBeDefined();
    expect(july.density).toBe(1);  // every day logged
  });

  it('returns weekly density', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({
        '2024-06-03': { calories: 2000 },  // Mon W23
        '2024-06-04': { calories: 2100 },  // Tue W23
        '2024-06-05': { calories: 0 },     // Wed W23 — calories=0 → not logged
        '2024-06-10': { calories: 1900 },  // Mon W24
      })),
    };
    const factory = new LongitudinalToolFactory({ healthStore });
    const tool = factory.createTools().find(t => t.name === 'query_nutrition_density');
    const out = await tool.execute({
      userId: 'kc',
      from: '2024-06-03', to: '2024-06-16',
      granularity: 'weekly',
    });
    expect(out.rows.length).toBe(2);
  });

  it('rejects unknown granularity', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
    };
    const factory = new LongitudinalToolFactory({ healthStore });
    const tool = factory.createTools().find(t => t.name === 'query_nutrition_density');
    const out = await tool.execute({
      userId: 'kc',
      from: '2024-06-01', to: '2024-12-31',
      granularity: 'fortnightly',
    });
    expect(out.error).toMatch(/unknown granularity/i);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Add the tool**

```javascript
      createTool({
        name: 'query_nutrition_density',
        description:
          'Per-bucket "tracking density" series. A "logged" day is one with ' +
          'a nutrition entry whose calories > 0. Returns per-bucket ' +
          '{ daysLogged, daysInPeriod, density } at the requested granularity ' +
          '(daily | weekly | monthly | quarterly | yearly).',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            from:   { type: 'string' },
            to:     { type: 'string' },
            granularity: {
              type: 'string',
              enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
              default: 'monthly',
            },
          },
          required: ['userId', 'from', 'to'],
        },
        execute: async ({ userId, from, to, granularity = 'monthly' }) => {
          try {
            HealthArchiveScope.assertValidUserId(userId);
            const allowed = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
            if (!allowed.includes(granularity)) {
              return { rows: [], error: `Unknown granularity: ${granularity}` };
            }
            const data = await healthStore.loadNutritionData?.(userId) || {};
            const bucketKey = granularity === 'daily' ? (d) => d :
                              granularity === 'weekly' ? isoWeek :
                              granularity === 'monthly' ? isoMonth :
                              granularity === 'quarterly' ? quarter :
                              isoYear;

            // Walk every date in [from, to]; classify each as logged or not.
            const buckets = new Map();
            const f = new Date(from + 'T00:00:00Z');
            const t = new Date(to + 'T00:00:00Z');
            for (let d = new Date(f); d <= t; d.setUTCDate(d.getUTCDate() + 1)) {
              const date = d.toISOString().slice(0, 10);
              const entry = data[date];
              const logged = entry && typeof entry.calories === 'number' && entry.calories > 0;
              const key = bucketKey(date);
              if (!buckets.has(key)) buckets.set(key, { period: key, daysLogged: 0, daysInPeriod: 0 });
              const b = buckets.get(key);
              b.daysInPeriod++;
              if (logged) b.daysLogged++;
            }

            const rows = [...buckets.values()]
              .sort((a, b) => a.period.localeCompare(b.period))
              .map(b => ({
                period: b.period,
                daysLogged: b.daysLogged,
                daysInPeriod: b.daysInPeriod,
                density: b.daysInPeriod > 0 ? b.daysLogged / b.daysInPeriod : 0,
              }));

            return { granularity, rows };
          } catch (err) {
            return { rows: [], error: err.message };
          }
        },
      }),
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs \
        tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs
git commit -m "feat(health-coach): query_nutrition_density

Plan 5 / Task 5. Per-bucket tracking-density series. Closes the last
Tier 1 gap from the design spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: End-to-end smoke verification

- [ ] **Step 1: Run the LongitudinalToolFactory test file**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/LongitudinalToolFactory.test.mjs
```

All existing pre-Plan-5 tests + the new tests must pass.

- [ ] **Step 2: Run all health-coach tool factory tests to confirm no regression**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/
```

- [ ] **Step 3: Final empty commit (optional)**

```bash
git commit --allow-empty -m "chore(health-analytics): Plan 5 complete — Tier 1 gap-fills

yearly_avg aggregation, query_historical_reconciliation,
query_historical_coaching, workout count aggregations, and
query_nutrition_density.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage map

| Spec section | Task |
|---|---|
| `yearly_avg` aggregation | 1 |
| `query_historical_reconciliation` | 2 |
| `query_historical_coaching` | 3 |
| `query_historical_workouts` count aggregations | 4 |
| `query_nutrition_density` | 5 |
