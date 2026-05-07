# Health-Coach Reasoning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 30+ retrieval/analytical tools with a 9-tool surface (`query_health`, `compute`, `personal_constants`, 2 playbook tools + 4 existing period tools) and an in-memory playbook library so the health-coach agent thinks rather than parrots.

**Architecture:** One rich SQL-equivalent data tool (`query_health`) + one sandboxed math tool (`compute`) + a memory-resident playbook library (8 seeded patterns). Agent composes queries + math; physiological formulas live as text in playbooks; no canned domain-reasoning tools. Implementation in a new `HealthQueryService` behind the tool, a `vm.runInNewContext`-based sandbox, and a YAML seed file.

**Tech Stack:** Node ESM (.mjs), Vitest, Mastra adapter (existing). Built on the agent framework convergence (Phases 1–4) already landed.

**Spec:** [`docs/superpowers/specs/2026-05-06-health-coach-reasoning-design.md`](../specs/2026-05-06-health-coach-reasoning-design.md)

---

## File structure

**New files:**

```
backend/src/3_applications/agents/health-coach/
  tools/
    HealthQueryToolFactory.mjs            — wraps service: query_health, compute, personal_constants
    PlaybookToolFactory.mjs               — record_playbook, update_playbook
  services/
    HealthQueryService.mjs                — implementation behind query_health (single class)
    ComputeSandbox.mjs                    — vm-based JS expression evaluator
    PersonalConstantsService.mjs          — reads config + computes derived values (BMR inputs)
  playbooks/
    seed.yml                              — 8 starter playbooks (text)
    seedLoader.mjs                        — first-turn auto-seed logic

tests/isolated/agents/health-coach/
  query_health/
    metric_vocabulary.test.mjs            — every metric returns a series
    aggregates.test.mjs                   — mean/sum/regression/histogram/...
    group_by.test.mjs                     — weekday_vs_weekend, day_of_week, etc.
    filter.test.mjs                       — row-level constraints
    join.test.mjs                         — joined metrics on rows
    correlate.test.mjs                    — pearson, spearman, lag
    rolling.test.mjs                      — windowed stats
    tool.test.mjs                         — tool wraps service correctly
  compute.test.mjs                        — sandbox safety + math + errors
  personal_constants.test.mjs             — read + canonical shape
  playbooks/
    record_playbook.test.mjs
    update_playbook.test.mjs
    seedLoader.test.mjs                   — first-turn behavior
  integration/
    playbook_recipes.test.mjs             — replay each seeded playbook against fixture data
```

**Modified files:**

```
backend/src/3_applications/agents/health-coach/
  HealthCoachAgent.mjs                    — registerTools wires new factories, retires old ones
  prompts/chat.mjs                        — full rewrite per spec §"Prompt changes"

backend/src/0_system/bootstrap.mjs         — wires HealthQueryService + PersonalConstantsService dependencies
```

**Deleted files:**

```
backend/src/3_applications/agents/health-coach/tools/
  HealthAnalyticsToolFactory.mjs          — entire file (15+ retired tools)
  HealthToolFactory.mjs                   — entire file (8 retired tools — all retired; the survivors here are zero)
  LongitudinalToolFactory.mjs             — most of file; preserve query_named_period/list_periods/remember_period/forget_period/read_notes_file in new factory
  ReconciliationToolFactory.mjs           — entire file (3 retired tools; replaced by query_health joins)
  ComplianceToolFactory.mjs               — entire file (1 retired tool)

(Service-side cleanup — only if nothing imports them):
  backend/src/2_domains/health/services/HealthAnalyticsService.mjs
  backend/src/2_domains/health/HealthAnalyticsHelpers.mjs
```

The 4 period tools (`list_periods`, `query_named_period`, `remember_period`, `forget_period`) and the 5 CRUD/content tools (`read_notes_file`, `write_dashboard`, `get_user_goals`, `log_coaching_note`, `send_channel_message`, `browse_fitness_catalog`, `get_fitness_content`, `get_program_state`, `update_program_state`, `get_recently_watched_fitness`) **survive** in their existing factories or move to a new "health-coach/tools/CrudToolFactory.mjs" — implementer's choice. They are not analytical and don't change.

---

## Conventions

- Vitest. Run individual files with `npx vitest run <path>`.
- TDD: test → run-FAIL → impl → run-PASS → commit per task.
- Every commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Backend ESM (.mjs); aliases `#system/`, `#domains/`, `#apps/`, `#adapters/`, `#api/`.
- After each task that adds/modifies a tool, run the agent-isolated suite to confirm no regression:
  ```bash
  cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/
  ```
- Old tools stay live alongside the new ones until Task 19 (additive deployment).

---

## Task 1: HealthQueryService skeleton + metric resolution

Service that the `query_health` tool will wrap. Starts with the metric vocabulary — every metric returns a `{date, value}[]` series for a given period.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs`
- Create: `tests/isolated/agents/health-coach/query_health/metric_vocabulary.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/agents/health-coach/query_health/metric_vocabulary.test.mjs
import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeStore() {
  return {
    loadWeightData: async () => ({
      '2026-04-30': { lbs: 170.5, fat_pct: 22.1 },
      '2026-05-01': { lbs: 170.3, fat_pct: 22.0 },
      '2026-05-02': { lbs: 170.8, fat_pct: 22.2 },
    }),
    loadNutritionData: async () => ({
      '2026-04-30': { calories: 1500, protein: 95, carbs: 130, fat: 50, fiber: 30 },
      '2026-05-01': { calories: 1450, protein: 90, carbs: 125, fat: 48, fiber: 28 },
      '2026-05-02': { calories: 1480, protein: 92, carbs: 128, fat: 49, fiber: 29 },
    }),
  };
}
function makeHealthService() {
  return {
    getHealthForRange: async (userId, from, to) => ({
      '2026-04-30': { workouts: [{ type: 'run', duration: 30, kcal: 300, hr_avg: 145 }] },
      '2026-05-01': { workouts: [] },
      '2026-05-02': { workouts: [{ type: 'lift', duration: 45, kcal: 200, hr_avg: 110 }] },
    }),
  };
}

const today = () => new Date('2026-05-02T12:00:00Z');

describe('HealthQueryService.query — metric vocabulary', () => {
  it('returns weight_lbs daily series', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'weight_lbs', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({ date: '2026-04-30', value: 170.5 });
    expect(r.meta.metric).toBe('weight_lbs');
  });

  it('returns calories daily series', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'calories', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.rows.map(x => x.value)).toEqual([1500, 1450, 1480]);
  });

  it('returns protein_g daily series', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'protein_g', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.rows.map(x => x.value)).toEqual([95, 90, 92]);
  });

  it('returns workout_count daily series (counts workouts on each date)', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'workout_count', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.rows.map(x => x.value)).toEqual([1, 0, 1]);
  });

  it('returns workout_kcal daily series (sums kcal across workouts on each date)', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'workout_kcal', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.rows.map(x => x.value)).toEqual([300, 0, 200]);
  });

  it('returns fat_pct daily series', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'fat_pct', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.rows.map(x => x.value)).toEqual([22.1, 22.0, 22.2]);
  });

  it('throws on unknown metric', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    await expect(svc.query({ metric: 'unknown_metric', period: { rolling: 'last_3d' }, userId: 'kc' }))
      .rejects.toThrow(/unknown metric/i);
  });

  it('returns meta envelope with metric, period, granularity, n, generated_at', async () => {
    const svc = new HealthQueryService({ healthStore: makeStore(), healthService: makeHealthService(), now: today });
    const r = await svc.query({ metric: 'weight_lbs', period: { rolling: 'last_3d' }, granularity: 'daily', userId: 'kc' });
    expect(r.meta).toMatchObject({ metric: 'weight_lbs', granularity: 'daily', n: 3 });
    expect(r.meta.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.meta.period).toEqual({ rolling: 'last_3d' });
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/query_health/metric_vocabulary.test.mjs
```

- [ ] **Step 3: Implement skeleton + metric resolution**

```javascript
// backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs

const KNOWN_METRICS = new Set([
  'weight_lbs', 'weight_kg', 'fat_pct', 'lean_mass_lbs',
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'tracking_density',
  'workout_count', 'workout_duration_min', 'workout_kcal',
  'hr_avg', 'hr_max', 'hr_minutes_zone2',
]);

export class HealthQueryService {
  #healthStore;
  #healthService;
  #now;

  constructor({ healthStore, healthService, now = () => new Date() }) {
    if (!healthStore) throw new Error('HealthQueryService: healthStore required');
    if (!healthService) throw new Error('HealthQueryService: healthService required');
    this.#healthStore = healthStore;
    this.#healthService = healthService;
    this.#now = now;
  }

  async query({ metric, period, granularity = 'daily', userId, ...rest }) {
    if (!KNOWN_METRICS.has(metric)) {
      throw new Error(`HealthQueryService: unknown metric "${metric}"`);
    }
    if (!userId) throw new Error('HealthQueryService: userId required');

    const { from, to } = this.#resolvePeriod(period);
    const series = await this.#fetchSeries(metric, userId, from, to);

    return {
      rows: series,
      meta: {
        metric,
        period,
        granularity,
        n: series.length,
        generated_at: this.#now().toISOString(),
      },
    };
  }

  #resolvePeriod(period) {
    if (period?.rolling) {
      const m = /^last_(\d+)d$/.exec(period.rolling);
      if (m) {
        const days = parseInt(m[1], 10);
        const today = this.#now();
        const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        const from = new Date(todayUtc);
        from.setUTCDate(from.getUTCDate() - (days - 1));
        return { from: from.toISOString().slice(0, 10), to: todayUtc.toISOString().slice(0, 10) };
      }
    }
    if (period?.from && period?.to) return { from: period.from, to: period.to };
    throw new Error(`HealthQueryService: unsupported period ${JSON.stringify(period)}`);
  }

  async #fetchSeries(metric, userId, from, to) {
    if (['weight_lbs', 'weight_kg', 'fat_pct', 'lean_mass_lbs'].includes(metric)) {
      const data = (await this.#healthStore.loadWeightData(userId)) ?? {};
      return Object.entries(data)
        .filter(([d]) => d >= from && d <= to)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, body]) => ({ date, value: this.#bodyMetric(body, metric) }));
    }
    if (['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'tracking_density'].includes(metric)) {
      const data = (await this.#healthStore.loadNutritionData(userId)) ?? {};
      return Object.entries(data)
        .filter(([d]) => d >= from && d <= to)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, n]) => ({ date, value: this.#nutritionMetric(n, metric) }));
    }
    if (['workout_count', 'workout_duration_min', 'workout_kcal', 'hr_avg', 'hr_max', 'hr_minutes_zone2'].includes(metric)) {
      const range = (await this.#healthService.getHealthForRange(userId, from, to)) ?? {};
      return Object.entries(range)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, day]) => ({ date, value: this.#workoutMetric(day?.workouts ?? [], metric) }));
    }
    return [];
  }

  #bodyMetric(body, metric) {
    switch (metric) {
      case 'weight_lbs': return body.lbs ?? null;
      case 'weight_kg':  return body.lbs ? body.lbs * 0.453592 : (body.kg ?? null);
      case 'fat_pct':    return body.fat_pct ?? null;
      case 'lean_mass_lbs': return body.lbs && body.fat_pct ? body.lbs * (1 - body.fat_pct / 100) : null;
      default: return null;
    }
  }
  #nutritionMetric(n, metric) {
    switch (metric) {
      case 'calories':         return n.calories ?? 0;
      case 'protein_g':        return n.protein ?? 0;
      case 'carbs_g':          return n.carbs ?? 0;
      case 'fat_g':            return n.fat ?? 0;
      case 'fiber_g':          return n.fiber ?? 0;
      case 'tracking_density': return n.tracking_density ?? null;
      default: return null;
    }
  }
  #workoutMetric(workouts, metric) {
    switch (metric) {
      case 'workout_count':        return workouts.length;
      case 'workout_duration_min': return workouts.reduce((s, w) => s + (w.duration ?? 0), 0);
      case 'workout_kcal':         return workouts.reduce((s, w) => s + (w.kcal ?? 0), 0);
      case 'hr_avg':               return workouts.length ? workouts.reduce((s, w) => s + (w.hr_avg ?? 0), 0) / workouts.length : null;
      case 'hr_max':               return workouts.reduce((m, w) => Math.max(m, w.hr_max ?? 0), 0);
      case 'hr_minutes_zone2':     return workouts.reduce((s, w) => s + (w.zone2_min ?? 0), 0);
      default: return null;
    }
  }
}

export default HealthQueryService;
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/query_health/metric_vocabulary.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs \
        tests/isolated/agents/health-coach/query_health/metric_vocabulary.test.mjs
git commit -m "$(cat <<'EOF'
feat(health-coach): HealthQueryService skeleton + metric vocabulary

Plan / Task 1. Service that powers the query_health tool. Resolves
the metric vocabulary to a {date, value}[] series for a period. Period
resolution covers rolling last_Nd + explicit {from, to}; calendar/named
periods land in later tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: HealthQueryService aggregates

Add `aggregate` parameter — mean, sum, min, max, count, p10/p50/p90, stdev, regression, histogram. `none` (default) returns rows.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs`
- Create: `tests/isolated/agents/health-coach/query_health/aggregates.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/agents/health-coach/query_health/aggregates.test.mjs
import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeSvc(weightSeries) {
  const data = Object.fromEntries(weightSeries.map(([d, v]) => [d, { lbs: v }]));
  return new HealthQueryService({
    healthStore: { loadWeightData: async () => data, loadNutritionData: async () => ({}) },
    healthService: { getHealthForRange: async () => ({}) },
    now: () => new Date('2026-05-10T12:00:00Z'),
  });
}

describe('HealthQueryService.query — aggregates', () => {
  const series = [
    ['2026-05-04', 170.0], ['2026-05-05', 170.5], ['2026-05-06', 171.0],
    ['2026-05-07', 170.7], ['2026-05-08', 171.2], ['2026-05-09', 170.9],
    ['2026-05-10', 171.3],
  ];

  it('mean', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'mean', userId: 'kc' });
    expect(r.value).toBeCloseTo(170.8, 1);
    expect(r.count).toBe(7);
  });

  it('sum', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'sum', userId: 'kc' });
    expect(r.value).toBeCloseTo(1195.6, 1);
  });

  it('min / max', async () => {
    const min = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'min', userId: 'kc' });
    const max = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'max', userId: 'kc' });
    expect(min.value).toBe(170.0);
    expect(max.value).toBe(171.3);
  });

  it('count', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'count', userId: 'kc' });
    expect(r.value).toBe(7);
  });

  it('p50 (median)', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'p50', userId: 'kc' });
    expect(r.value).toBeCloseTo(170.9, 1);
  });

  it('stdev', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'stdev', userId: 'kc' });
    expect(r.value).toBeGreaterThan(0);
    expect(r.value).toBeLessThan(1);
    expect(r.mean).toBeCloseTo(170.8, 1);
  });

  it('regression', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: 'regression', userId: 'kc' });
    expect(r).toMatchObject({ slope: expect.any(Number), intercept: expect.any(Number), r_squared: expect.any(Number), n: 7 });
    expect(r.slope).toBeGreaterThan(0);  // slight uptrend
  });

  it('histogram', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, aggregate: { op: 'histogram', bins: 3 }, userId: 'kc' });
    expect(r.bins).toHaveLength(3);
    expect(r.bins.reduce((s, b) => s + b.count, 0)).toBe(7);
    expect(r.bins[0]).toMatchObject({ lower: expect.any(Number), upper: expect.any(Number), count: expect.any(Number) });
  });

  it('aggregate=none (default) returns rows', async () => {
    const r = await makeSvc(series).query({ metric: 'weight_lbs', period: { rolling: 'last_7d' }, userId: 'kc' });
    expect(r.rows).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement aggregates in `HealthQueryService.query`**

Add after `#fetchSeries` returns the series, before building the response:

```javascript
async query({ metric, period, granularity = 'daily', aggregate = 'none', userId, ...rest }) {
  // ...existing validation + fetch...
  const series = await this.#fetchSeries(metric, userId, from, to);
  const values = series.map(r => r.value).filter(v => v !== null && v !== undefined && Number.isFinite(v));

  const meta = { metric, period, granularity, n: series.length, generated_at: this.#now().toISOString() };

  if (aggregate === 'none' || aggregate === undefined) return { rows: series, meta };

  const op = typeof aggregate === 'string' ? aggregate : aggregate.op;
  const opts = typeof aggregate === 'object' ? aggregate : {};

  switch (op) {
    case 'mean':  return { value: this.#mean(values), count: values.length, meta };
    case 'sum':   return { value: values.reduce((s, v) => s + v, 0), count: values.length, meta };
    case 'min':   return { value: Math.min(...values), count: values.length, meta };
    case 'max':   return { value: Math.max(...values), count: values.length, meta };
    case 'count': return { value: values.length, count: values.length, meta };
    case 'p10':   return { value: this.#percentile(values, 10), count: values.length, meta };
    case 'p50':   return { value: this.#percentile(values, 50), count: values.length, meta };
    case 'p90':   return { value: this.#percentile(values, 90), count: values.length, meta };
    case 'stdev': {
      const m = this.#mean(values);
      const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, values.length - 1);
      return { value: Math.sqrt(v), mean: m, count: values.length, meta };
    }
    case 'regression': return { ...this.#regress(series), meta };
    case 'histogram':  return { bins: this.#histogram(values, opts.bins ?? 10), meta };
    default: throw new Error(`HealthQueryService: unknown aggregate "${op}"`);
  }
}

#mean(vs) { return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; }

#percentile(vs, p) {
  if (!vs.length) return null;
  const sorted = [...vs].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

#regress(series) {
  const points = series.filter(r => Number.isFinite(r.value)).map((r, i) => ({ x: i, y: r.value }));
  const n = points.length;
  if (n < 2) return { slope: null, intercept: null, r_squared: null, n };
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const num = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  const ssTot = points.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const r_squared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r_squared, n };
}

#histogram(vs, bins) {
  if (!vs.length) return [];
  const min = Math.min(...vs), max = Math.max(...vs);
  const width = (max - min) / bins || 1;
  const result = Array.from({ length: bins }, (_, i) => ({
    lower: min + i * width, upper: min + (i + 1) * width, count: 0,
  }));
  for (const v of vs) {
    const idx = Math.min(bins - 1, Math.floor((v - min) / width));
    result[idx].count += 1;
  }
  return result;
}
```

- [ ] **Step 4: Run; pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs \
        tests/isolated/agents/health-coach/query_health/aggregates.test.mjs
git commit -m "feat(health-coach): query_health aggregate ops

Plan / Task 2. mean / sum / min / max / count / p10/p50/p90 / stdev /
regression / histogram. Default 'none' returns rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: HealthQueryService group_by + filter + join

Three composable refinements: bucket rows before aggregating (`group_by`), drop rows that don't match (`filter`), pull related metrics onto each row (`join`).

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs`
- Create: `tests/isolated/agents/health-coach/query_health/group_by.test.mjs`
- Create: `tests/isolated/agents/health-coach/query_health/filter.test.mjs`
- Create: `tests/isolated/agents/health-coach/query_health/join.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/agents/health-coach/query_health/group_by.test.mjs
import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeSvc() {
  // 2026-05-04 = Mon, 05 = Tue, 06 = Wed, 07 = Thu, 08 = Fri, 09 = Sat, 10 = Sun
  return new HealthQueryService({
    healthStore: {
      loadWeightData: async () => ({}),
      loadNutritionData: async () => ({
        '2026-05-04': { calories: 1500 },  // weekday
        '2026-05-05': { calories: 1400 },
        '2026-05-06': { calories: 1450 },
        '2026-05-07': { calories: 1500 },
        '2026-05-08': { calories: 1600 },  // weekday
        '2026-05-09': { calories: 1900 },  // weekend
        '2026-05-10': { calories: 1850 },  // weekend
      }),
    },
    healthService: { getHealthForRange: async () => ({}) },
    now: () => new Date('2026-05-10T12:00:00Z'),
  });
}

describe('HealthQueryService.query — group_by', () => {
  it('weekday_vs_weekend mean', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_7d' },
      group_by: 'weekday_vs_weekend', aggregate: 'mean', userId: 'kc',
    });
    expect(r.groups.weekday.value).toBeCloseTo(1490, 0);
    expect(r.groups.weekday.count).toBe(5);
    expect(r.groups.weekend.value).toBeCloseTo(1875, 0);
    expect(r.groups.weekend.count).toBe(2);
  });

  it('day_of_week mean', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_7d' },
      group_by: 'day_of_week', aggregate: 'mean', userId: 'kc',
    });
    expect(Object.keys(r.groups).sort()).toEqual(['Fri', 'Mon', 'Sat', 'Sun', 'Thu', 'Tue', 'Wed']);
    expect(r.groups.Sat.value).toBe(1900);
  });
});
```

```javascript
// tests/isolated/agents/health-coach/query_health/filter.test.mjs
import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeSvc() {
  return new HealthQueryService({
    healthStore: {
      loadWeightData: async () => ({}),
      loadNutritionData: async () => ({
        '2026-05-08': { calories: 800 },
        '2026-05-09': { calories: 1500 },
        '2026-05-10': { calories: 950 },
      }),
    },
    healthService: { getHealthForRange: async () => ({}) },
    now: () => new Date('2026-05-10T12:00:00Z'),
  });
}

describe('HealthQueryService.query — filter', () => {
  it('keeps only rows where value < 1000', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      filter: [{ field: 'value', op: '<', value: 1000 }],
      userId: 'kc',
    });
    expect(r.rows.map(x => x.date)).toEqual(['2026-05-08', '2026-05-10']);
  });

  it('chains multiple filters (AND)', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      filter: [
        { field: 'value', op: '>=', value: 800 },
        { field: 'value', op: '<', value: 1000 },
      ],
      userId: 'kc',
    });
    expect(r.rows.map(x => x.date)).toEqual(['2026-05-08', '2026-05-10']);
  });

  it('supports == and in', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      filter: [{ field: 'value', op: 'in', value: [950, 1500] }],
      userId: 'kc',
    });
    expect(r.rows.map(x => x.value).sort((a, b) => a - b)).toEqual([950, 1500]);
  });
});
```

```javascript
// tests/isolated/agents/health-coach/query_health/join.test.mjs
import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeSvc() {
  return new HealthQueryService({
    healthStore: {
      loadWeightData: async () => ({
        '2026-05-08': { lbs: 170.0 },
        '2026-05-09': { lbs: 170.5 },
        '2026-05-10': { lbs: 170.3 },
      }),
      loadNutritionData: async () => ({
        '2026-05-08': { calories: 1500 },
        '2026-05-09': { calories: 1450 },
        '2026-05-10': { calories: 1480 },
      }),
    },
    healthService: { getHealthForRange: async () => ({}) },
    now: () => new Date('2026-05-10T12:00:00Z'),
  });
}

describe('HealthQueryService.query — join', () => {
  it('joins weight_lbs onto calories rows', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      join: ['weight_lbs'],
      userId: 'kc',
    });
    expect(r.rows[0]).toMatchObject({ date: '2026-05-08', value: 1500, weight_lbs: 170.0 });
  });

  it('filter can reference joined fields', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      join: ['weight_lbs'],
      filter: [{ field: 'weight_lbs', op: '>', value: 170.2 }],
      userId: 'kc',
    });
    expect(r.rows.map(x => x.date)).toEqual(['2026-05-09', '2026-05-10']);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement group_by + filter + join in `HealthQueryService`**

Update `query` to apply joins before filter, filter before group_by + aggregate. Add helpers:

```javascript
async query({ metric, period, granularity = 'daily', aggregate = 'none', group_by, filter, join, userId, ...rest }) {
  if (!KNOWN_METRICS.has(metric)) throw new Error(`HealthQueryService: unknown metric "${metric}"`);
  if (!userId) throw new Error('HealthQueryService: userId required');
  const { from, to } = this.#resolvePeriod(period);
  let series = await this.#fetchSeries(metric, userId, from, to);

  // Join — pull other metrics onto each row by date
  if (join?.length) {
    const joined = {};
    for (const otherMetric of join) {
      const otherRows = await this.#fetchSeries(otherMetric, userId, from, to);
      joined[otherMetric] = Object.fromEntries(otherRows.map(r => [r.date, r.value]));
    }
    series = series.map(row => {
      const out = { ...row };
      for (const m of join) out[m] = joined[m]?.[row.date] ?? null;
      return out;
    });
  }

  // Filter — chainable AND
  if (filter?.length) {
    const filters = Array.isArray(filter) ? filter : [filter];
    series = series.filter(row => filters.every(f => this.#matchesFilter(row, f)));
  }

  const meta = { metric, period, granularity, n: series.length, generated_at: this.#now().toISOString() };

  if (group_by) {
    const groups = this.#groupBy(series, group_by, aggregate === 'none' ? 'mean' : aggregate);
    return { groups, meta };
  }

  return this.#aggregate(series, aggregate, meta);
}

#matchesFilter(row, { field, op, value }) {
  const lhs = row[field];
  switch (op) {
    case '<':      return lhs < value;
    case '<=':     return lhs <= value;
    case '==':     return lhs === value;
    case '>':      return lhs > value;
    case '>=':     return lhs >= value;
    case 'in':     return Array.isArray(value) && value.includes(lhs);
    case 'not_in': return Array.isArray(value) && !value.includes(lhs);
    default: throw new Error(`HealthQueryService: unknown filter op "${op}"`);
  }
}

#groupBy(series, key, aggregate) {
  const buckets = new Map();
  for (const row of series) {
    const k = this.#bucketKey(row, key);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(row);
  }
  const out = {};
  for (const [k, rows] of buckets) {
    const r = this.#aggregate(rows, aggregate, { metric: '', period: {}, granularity: '', n: rows.length, generated_at: '' });
    out[k] = { value: r.value, count: r.count };
  }
  return out;
}

#bucketKey(row, key) {
  if (key === 'day_of_week') {
    const day = new Date(row.date + 'T00:00:00Z').getUTCDay();  // 0 = Sun
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day];
  }
  if (key === 'weekday_vs_weekend') {
    const day = new Date(row.date + 'T00:00:00Z').getUTCDay();
    return (day === 0 || day === 6) ? 'weekend' : 'weekday';
  }
  if (key === 'month') return row.date.slice(0, 7);
  if (key === 'year') return row.date.slice(0, 4);
  throw new Error(`HealthQueryService: unsupported group_by "${key}"`);
}

// Refactor previously-inline aggregate logic into a helper:
#aggregate(series, aggregate, meta) {
  const values = series.map(r => r.value).filter(v => v !== null && v !== undefined && Number.isFinite(v));
  if (aggregate === 'none' || aggregate === undefined) return { rows: series, meta };
  // ... existing switch on aggregate op, returning { value, count, ... } ...
}
```

- [ ] **Step 4: Run; pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs \
        tests/isolated/agents/health-coach/query_health/group_by.test.mjs \
        tests/isolated/agents/health-coach/query_health/filter.test.mjs \
        tests/isolated/agents/health-coach/query_health/join.test.mjs
git commit -m "feat(health-coach): query_health group_by + filter + join

Plan / Task 3. Group by day_of_week / weekday_vs_weekend / month / year.
Chainable AND filters with <, <=, ==, >, >=, in, not_in. Join pulls related
metrics onto each row; filter can reference joined fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: HealthQueryService correlate + rolling

Two more refinements: `correlate.with` runs Pearson/Spearman against another metric; `rolling.fn/window` returns a rolling-statistic series before aggregating.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs`
- Create: `tests/isolated/agents/health-coach/query_health/correlate.test.mjs`
- Create: `tests/isolated/agents/health-coach/query_health/rolling.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/agents/health-coach/query_health/correlate.test.mjs
import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeSvc() {
  // calories and weight perfectly inversely correlated
  return new HealthQueryService({
    healthStore: {
      loadWeightData: async () => ({
        '2026-05-08': { lbs: 171.0 },
        '2026-05-09': { lbs: 170.5 },
        '2026-05-10': { lbs: 170.0 },
      }),
      loadNutritionData: async () => ({
        '2026-05-08': { calories: 1300 },
        '2026-05-09': { calories: 1500 },
        '2026-05-10': { calories: 1700 },
      }),
    },
    healthService: { getHealthForRange: async () => ({}) },
    now: () => new Date('2026-05-10T12:00:00Z'),
  });
}

describe('HealthQueryService.query — correlate', () => {
  it('pearson correlation between calories and weight', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      correlate: { with: 'weight_lbs', method: 'pearson' },
      userId: 'kc',
    });
    expect(r.r).toBeCloseTo(-1, 1);
    expect(r.n).toBe(3);
  });

  it('spearman rank correlation', async () => {
    const r = await makeSvc().query({
      metric: 'calories', period: { rolling: 'last_3d' },
      correlate: { with: 'weight_lbs', method: 'spearman' },
      userId: 'kc',
    });
    expect(r.r).toBeCloseTo(-1, 1);
  });
});
```

```javascript
// tests/isolated/agents/health-coach/query_health/rolling.test.mjs
import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';

function makeSvc() {
  const data = {};
  for (let i = 1; i <= 14; i++) {
    const d = `2026-05-${String(i).padStart(2, '0')}`;
    data[d] = { lbs: 170 + i * 0.1 };
  }
  return new HealthQueryService({
    healthStore: { loadWeightData: async () => data, loadNutritionData: async () => ({}) },
    healthService: { getHealthForRange: async () => ({}) },
    now: () => new Date('2026-05-14T12:00:00Z'),
  });
}

describe('HealthQueryService.query — rolling', () => {
  it('rolling 7-day mean smooths the series', async () => {
    const r = await makeSvc().query({
      metric: 'weight_lbs', period: { rolling: 'last_14d' },
      rolling: { fn: 'mean', window: 7 },
      userId: 'kc',
    });
    expect(r.rows).toHaveLength(14);
    // First 6 entries have insufficient window — value should be null
    expect(r.rows[5].value).toBe(null);
    // 7th entry onward has values
    expect(r.rows[6].value).toBeCloseTo(170.4, 1);
    expect(r.rows[13].value).toBeCloseTo(171.1, 1);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement correlate + rolling**

Add to `query`:

```javascript
async query({ metric, period, granularity = 'daily', aggregate = 'none', group_by, filter, join, correlate, rolling, userId, ...rest }) {
  // ... existing setup, fetch, join, filter ...

  if (rolling) {
    series = this.#rollingSeries(series, rolling.fn, rolling.window);
  }

  if (correlate) {
    return { ...this.#correlate(series, correlate, userId, from, to), meta };
  }

  // ... existing group_by + aggregate ...
}

async #correlate(series, { with: otherMetric, method = 'pearson', lag = 0 }, userId, from, to) {
  const otherRows = await this.#fetchSeries(otherMetric, userId, from, to);
  const otherByDate = Object.fromEntries(otherRows.map(r => [r.date, r.value]));
  const pairs = series
    .map((r, i) => {
      const otherIdx = i + lag;
      const otherDate = series[otherIdx]?.date;
      return otherDate ? { x: r.value, y: otherByDate[otherDate] } : null;
    })
    .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));

  if (pairs.length < 2) return { r: null, n: pairs.length };

  if (method === 'spearman') {
    const rankX = this.#ranks(pairs.map(p => p.x));
    const rankY = this.#ranks(pairs.map(p => p.y));
    return { r: this.#pearson(rankX, rankY), n: pairs.length, method: 'spearman' };
  }
  return { r: this.#pearson(pairs.map(p => p.x), pairs.map(p => p.y)), n: pairs.length, method: 'pearson' };
}

#pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx  += (xs[i] - mx) ** 2;
    dy  += (ys[i] - my) ** 2;
  }
  return dx * dy === 0 ? null : num / Math.sqrt(dx * dy);
}

#ranks(vs) {
  const sorted = vs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(vs.length);
  sorted.forEach((entry, rank) => { ranks[entry.i] = rank + 1; });
  return ranks;
}

#rollingSeries(series, fn, window) {
  const out = [];
  for (let i = 0; i < series.length; i++) {
    if (i + 1 < window) { out.push({ ...series[i], value: null }); continue; }
    const slice = series.slice(i - window + 1, i + 1).map(r => r.value).filter(v => Number.isFinite(v));
    let v = null;
    if (slice.length === window) {
      switch (fn) {
        case 'mean': v = slice.reduce((s, x) => s + x, 0) / slice.length; break;
        case 'sum':  v = slice.reduce((s, x) => s + x, 0); break;
        case 'min':  v = Math.min(...slice); break;
        case 'max':  v = Math.max(...slice); break;
        default: throw new Error(`HealthQueryService: unsupported rolling fn "${fn}"`);
      }
    }
    out.push({ ...series[i], value: v });
  }
  return out;
}
```

- [ ] **Step 4: Run; pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs \
        tests/isolated/agents/health-coach/query_health/correlate.test.mjs \
        tests/isolated/agents/health-coach/query_health/rolling.test.mjs
git commit -m "feat(health-coach): query_health correlate + rolling

Plan / Task 4. Correlate (pearson/spearman/lag) and rolling (mean/sum/
min/max with window).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: ComputeSandbox

Sandboxed JS expression evaluator using Node's built-in `vm`. Frozen scope, 50ms timeout, structured errors. The `compute` tool will wrap this.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/services/ComputeSandbox.mjs`
- Create: `tests/isolated/agents/health-coach/compute.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/agents/health-coach/compute.test.mjs
import { describe, it, expect } from 'vitest';
import { ComputeSandbox } from '../../../backend/src/3_applications/agents/health-coach/services/ComputeSandbox.mjs';

describe('ComputeSandbox.evaluate', () => {
  const sandbox = new ComputeSandbox();

  it('evaluates basic arithmetic', () => {
    const r = sandbox.evaluate('1 + 2 * 3');
    expect(r.value).toBe(7);
    expect(r.type).toBe('number');
  });

  it('binds named inputs as identifiers', () => {
    const r = sandbox.evaluate('a + b', { a: 5, b: 10 });
    expect(r.value).toBe(15);
  });

  it('handles object property access on inputs', () => {
    const r = sandbox.evaluate('result.slope * 30', { result: { slope: -0.0014, intercept: 170.36 } });
    expect(r.value).toBeCloseTo(-0.042, 3);
  });

  it('exposes Math object', () => {
    const r = sandbox.evaluate('Math.sqrt(16) + Math.PI');
    expect(r.value).toBeCloseTo(4 + Math.PI, 5);
  });

  it('returns boolean when expression is comparison', () => {
    const r = sandbox.evaluate('density >= 0.8', { density: 0.42 });
    expect(r.value).toBe(false);
    expect(r.type).toBe('boolean');
  });

  it('rejects access to require', () => {
    const r = sandbox.evaluate('require("fs")');
    expect(r.error).toBe('runtime');
  });

  it('rejects access to process', () => {
    const r = sandbox.evaluate('process.env.SECRET');
    expect(r.error).toBe('runtime');
  });

  it('rejects eval', () => {
    const r = sandbox.evaluate('eval("1+1")');
    expect(r.error).toBe('runtime');
  });

  it('rejects Function constructor', () => {
    const r = sandbox.evaluate('new Function("return 1")()');
    expect(r.error).toBe('runtime');
  });

  it('returns syntax error structured', () => {
    const r = sandbox.evaluate('1 + ');
    expect(r.error).toBe('syntax');
    expect(r.message).toBeTruthy();
  });

  it('returns runtime error structured for undefined identifiers', () => {
    const r = sandbox.evaluate('foo + 1');
    expect(r.error).toBe('runtime');
    expect(r.message).toMatch(/foo/);
  });

  it('times out on infinite loop', () => {
    // Note: vm timeout works on synchronous expressions only; infinite loop is sync
    const r = sandbox.evaluate('(function(){ while(true); })()');
    expect(r.error).toBe('timeout');
  }, 200);

  it('captures duration in result', () => {
    const r = sandbox.evaluate('1 + 1');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('echoes expression in result', () => {
    const r = sandbox.evaluate('1 + 1');
    expect(r.expression).toBe('1 + 1');
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```javascript
// backend/src/3_applications/agents/health-coach/services/ComputeSandbox.mjs
import vm from 'node:vm';

/**
 * Sandboxed JS expression evaluator. No I/O, no async, no imports.
 * Whitelist scope: Math, parseFloat, parseInt, isFinite, isNaN, Array.isArray
 * + the caller's named inputs.
 */
export class ComputeSandbox {
  #timeoutMs;
  constructor({ timeoutMs = 50 } = {}) { this.#timeoutMs = timeoutMs; }

  evaluate(expression, inputs = {}) {
    const startedAt = Date.now();
    const scope = Object.freeze({
      ...inputs,
      Math,
      parseFloat,
      parseInt,
      isFinite,
      isNaN,
      Array: { isArray: Array.isArray },
    });
    const context = vm.createContext(scope, { codeGeneration: { strings: false, wasm: false } });
    try {
      const value = vm.runInContext(`(${expression})`, context, {
        timeout: this.#timeoutMs,
        displayErrors: true,
      });
      return {
        value,
        type: typeOf(value),
        expression,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      const isTimeout = /Script execution timed out/.test(err.message);
      const isSyntax = err instanceof SyntaxError;
      return {
        error: isTimeout ? 'timeout' : (isSyntax ? 'syntax' : 'runtime'),
        message: err.message,
        expression,
        durationMs: Date.now() - startedAt,
      };
    }
  }
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export default ComputeSandbox;
```

- [ ] **Step 4: Run; pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/services/ComputeSandbox.mjs \
        tests/isolated/agents/health-coach/compute.test.mjs
git commit -m "feat(health-coach): ComputeSandbox — sandboxed JS expression evaluator

Plan / Task 5. vm.runInContext with frozen whitelist scope (Math + named
inputs only). 50ms timeout. Structured errors (syntax/runtime/timeout).
codeGeneration disabled to block eval and new Function.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: PersonalConstantsService

Reads calibration values for a user. Wraps the existing user-data loader; returns the canonical shape used by playbook recipes.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/services/PersonalConstantsService.mjs`
- Create: `tests/isolated/agents/health-coach/personal_constants.test.mjs`

- [ ] **Step 1: Read where user-side personal data lives today**

```bash
cd /opt/Code/DaylightStation && find data/users -maxdepth 4 -type d | head -10
cd /opt/Code/DaylightStation && grep -rn "weight_kg\|height_cm\|bmr_formula" data/users/ 2>/dev/null | head -5
```

If the calibration values aren't in user data yet, the implementer creates the file at `data/users/<userId>/profile/health.yml` with the shape below. The service reads that file via the existing `dataService.user.read(userId, 'profile/health.yml')` API.

- [ ] **Step 2: Write failing test**

```javascript
// tests/isolated/agents/health-coach/personal_constants.test.mjs
import { describe, it, expect } from 'vitest';
import { PersonalConstantsService } from '../../../backend/src/3_applications/agents/health-coach/services/PersonalConstantsService.mjs';

describe('PersonalConstantsService.get', () => {
  it('returns canonical shape from user profile', async () => {
    const svc = new PersonalConstantsService({
      dataService: {
        user: {
          read: async (userId, path) => {
            if (path === 'profile/health.yml') {
              return { height_cm: 180, age: 40, sex: 'M', activity_pal: 1.55, scale_bias_lbs: 0 };
            }
            return null;
          },
        },
      },
      healthStore: {
        loadWeightData: async () => ({
          '2026-05-09': { lbs: 171.0 },
          '2026-05-10': { lbs: 170.8 },
        }),
      },
    });
    const c = await svc.get('kc');
    expect(c).toMatchObject({
      height_cm: 180,
      age: 40,
      sex: 'M',
      weight_lbs: 170.8,                                  // most recent weigh-in
      weight_kg: expect.closeTo(77.47, 1),
      activity_pal: 1.55,
      scale_bias_lbs: 0,
      bmr_formula: 'mifflin-st-jeor',
      calorie_per_lb_fat: 3500,
    });
  });

  it('throws when user profile missing', async () => {
    const svc = new PersonalConstantsService({
      dataService: { user: { read: async () => null } },
      healthStore: { loadWeightData: async () => ({}) },
    });
    await expect(svc.get('kc')).rejects.toThrow(/profile/);
  });
});
```

- [ ] **Step 3: Run; FAIL**

- [ ] **Step 4: Implement**

```javascript
// backend/src/3_applications/agents/health-coach/services/PersonalConstantsService.mjs
export class PersonalConstantsService {
  #dataService;
  #healthStore;
  constructor({ dataService, healthStore }) {
    this.#dataService = dataService;
    this.#healthStore = healthStore;
  }

  async get(userId) {
    const profile = await this.#dataService.user.read(userId, 'profile/health.yml');
    if (!profile) throw new Error(`PersonalConstantsService: profile/health.yml not found for ${userId}`);

    const weight = (await this.#healthStore.loadWeightData(userId)) ?? {};
    const dates = Object.keys(weight).sort();
    const latestDate = dates.at(-1);
    const weight_lbs = latestDate ? weight[latestDate].lbs : null;

    return {
      height_cm: profile.height_cm,
      age: profile.age,
      sex: profile.sex,
      weight_lbs,
      weight_kg: weight_lbs ? +(weight_lbs * 0.453592).toFixed(2) : null,
      activity_pal: profile.activity_pal ?? 1.55,
      scale_bias_lbs: profile.scale_bias_lbs ?? 0,
      bmr_formula: 'mifflin-st-jeor',
      calorie_per_lb_fat: 3500,
    };
  }
}

export default PersonalConstantsService;
```

- [ ] **Step 5: Create the user profile YAML if missing**

```bash
sudo docker exec daylight-station sh -c "cat > data/users/kckern/profile/health.yml << 'EOF'
height_cm: 180
age: 40
sex: M
activity_pal: 1.55
scale_bias_lbs: 0
EOF
"
```

(Adjust the actual user/values to match what's accurate. The implementer should not commit secrets; the file lives in the data volume, not the repo.)

- [ ] **Step 6: Run; pass**

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/services/PersonalConstantsService.mjs \
        tests/isolated/agents/health-coach/personal_constants.test.mjs
git commit -m "feat(health-coach): PersonalConstantsService

Plan / Task 6. Reads height/age/sex/activity_pal from user profile YAML;
joins with most recent weight from healthStore. Returns canonical shape
used by playbook recipes (Mifflin-St Jeor inputs, calorie_per_lb_fat,
scale_bias).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: HealthQueryToolFactory — query_health, compute, personal_constants tools

Wraps the three services into ToolBundle-shaped tools.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs`
- Create: `tests/isolated/agents/health-coach/query_health/tool.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// tests/isolated/agents/health-coach/query_health/tool.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HealthQueryToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs';

function makeFactory() {
  const queryService = { query: vi.fn(async () => ({ value: 1462, count: 30, meta: { metric: 'calories' } })) };
  const sandbox      = { evaluate: vi.fn(() => ({ value: 1986, type: 'number', expression: '...', durationMs: 1 })) };
  const constantsService = { get: vi.fn(async () => ({ height_cm: 180, age: 40, sex: 'M' })) };
  return { factory: new HealthQueryToolFactory({ queryService, sandbox, constantsService }), queryService, sandbox, constantsService };
}

describe('HealthQueryToolFactory', () => {
  it('produces three tools', () => {
    const { factory } = makeFactory();
    const tools = factory.createTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['compute', 'personal_constants', 'query_health']);
  });

  it('query_health forwards to service with userId injected', async () => {
    const { factory, queryService } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'query_health');
    const r = await tool.execute({ metric: 'calories', period: { rolling: 'last_30d' }, aggregate: 'mean', userId: 'kc' });
    expect(queryService.query).toHaveBeenCalledWith(expect.objectContaining({
      metric: 'calories', userId: 'kc', aggregate: 'mean',
    }));
    expect(r.value).toBe(1462);
  });

  it('compute forwards to sandbox', async () => {
    const { factory, sandbox } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'compute');
    const r = await tool.execute({ expression: 'a + b', inputs: { a: 1, b: 2 } });
    expect(sandbox.evaluate).toHaveBeenCalledWith('a + b', { a: 1, b: 2 });
    expect(r.value).toBe(1986);
  });

  it('personal_constants forwards to service', async () => {
    const { factory, constantsService } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'personal_constants');
    const r = await tool.execute({ userId: 'kc' });
    expect(constantsService.get).toHaveBeenCalledWith('kc');
    expect(r.height_cm).toBe(180);
  });

  it('query_health declares the parameter shape (metric, period, aggregate, etc.)', () => {
    const { factory } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'query_health');
    const props = tool.parameters.properties;
    expect(props).toHaveProperty('metric');
    expect(props).toHaveProperty('period');
    expect(props).toHaveProperty('granularity');
    expect(props).toHaveProperty('aggregate');
    expect(props).toHaveProperty('group_by');
    expect(props).toHaveProperty('filter');
    expect(props).toHaveProperty('join');
    expect(props).toHaveProperty('correlate');
    expect(props).toHaveProperty('rolling');
    expect(tool.parameters.required).toContain('metric');
    expect(tool.parameters.required).toContain('period');
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```javascript
// backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs
import { ToolFactory } from '../../framework/ToolFactory.mjs';

export class HealthQueryToolFactory extends ToolFactory {
  static domain = 'health-coach';
  #queryService;
  #sandbox;
  #constantsService;

  constructor({ queryService, sandbox, constantsService }) {
    super();
    if (!queryService)      throw new Error('HealthQueryToolFactory: queryService required');
    if (!sandbox)           throw new Error('HealthQueryToolFactory: sandbox required');
    if (!constantsService)  throw new Error('HealthQueryToolFactory: constantsService required');
    this.#queryService = queryService;
    this.#sandbox = sandbox;
    this.#constantsService = constantsService;
  }

  createTools() {
    const queryService = this.#queryService;
    const sandbox = this.#sandbox;
    const constantsService = this.#constantsService;

    return [
      {
        name: 'query_health',
        description: 'Query the user\'s health data. SQL-flavored: pass a metric, a period, optional aggregate / group_by / filter / join / correlate / rolling. Returns rows or an aggregate value.',
        parameters: {
          type: 'object',
          properties: {
            metric: { type: 'string', description: 'See vocabulary: weight_lbs, weight_kg, fat_pct, lean_mass_lbs, calories, protein_g, carbs_g, fat_g, fiber_g, tracking_density, workout_count, workout_duration_min, workout_kcal, hr_avg, hr_max, hr_minutes_zone2.' },
            period: { type: 'object', description: 'Rolling: { rolling: "last_30d" }. Calendar: { calendar: "2024" }. Named: { named: "2017-cut" }. Explicit: { from, to }.' },
            granularity: { type: 'string', enum: ['raw', 'daily', 'weekly', 'monthly'], default: 'daily' },
            aggregate: { description: 'none | mean | sum | min | max | count | p10 | p50 | p90 | stdev | regression | histogram. For histogram, pass { op: "histogram", bins: number }.' },
            group_by: { description: 'day_of_week | weekday_vs_weekend | workout_type | month | year' },
            filter: { type: 'array', description: '[{ field, op: "<"|"<="|"=="|">"|">="|"in"|"not_in", value }]. Chainable AND.' },
            join: { type: 'array', items: { type: 'string' }, description: 'Other metrics to pull onto each row by date.' },
            correlate: { type: 'object', description: '{ with: metricName, method: "pearson"|"spearman", lag: number }' },
            rolling: { type: 'object', description: '{ fn: "mean"|"sum"|"min"|"max", window: number }' },
            userId: { type: 'string' },
          },
          required: ['metric', 'period', 'userId'],
        },
        execute: async (args) => queryService.query(args),
      },
      {
        name: 'compute',
        description: 'Sandboxed math evaluator. Pass a JS expression; bind values via inputs. Use this for any arithmetic on query_health results — do NOT do mental math in your prose.',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'A JS expression. Example: "(intake - tdee) * 30 / 3500". Math object available; no I/O, no async.' },
            inputs:     { type: 'object', description: 'Named values bound as identifiers in the expression scope.' },
          },
          required: ['expression'],
        },
        execute: async ({ expression, inputs }) => sandbox.evaluate(expression, inputs ?? {}),
      },
      {
        name: 'personal_constants',
        description: 'Return the user\'s personal calibration values: weight_kg, weight_lbs, height_cm, age, sex, activity_pal, scale_bias_lbs, bmr_formula, calorie_per_lb_fat. Read these for any metabolic calculation.',
        parameters: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
        execute: async ({ userId }) => constantsService.get(userId),
      },
    ];
  }
}

export default HealthQueryToolFactory;
```

- [ ] **Step 4: Run; pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs \
        tests/isolated/agents/health-coach/query_health/tool.test.mjs
git commit -m "feat(health-coach): HealthQueryToolFactory — query_health, compute, personal_constants

Plan / Task 7. Wraps three services into ToolFactory-shaped tools.
Tool descriptions surface the vocabulary + parameter shape so the LLM
has enough info to compose without reading docs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Playbook tools — record_playbook, update_playbook

Two helpers for writing playbooks to working memory. Read happens automatically via `WorkingMemoryState.serialize()` rendering into the prompt's working-memory section.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/tools/PlaybookToolFactory.mjs`
- Create: `tests/isolated/agents/health-coach/playbooks/record_playbook.test.mjs`
- Create: `tests/isolated/agents/health-coach/playbooks/update_playbook.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/agents/health-coach/playbooks/record_playbook.test.mjs
import { describe, it, expect } from 'vitest';
import { PlaybookToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/PlaybookToolFactory.mjs';
import { WorkingMemoryState } from '../../../../backend/src/3_applications/agents/framework/WorkingMemory.mjs';

describe('record_playbook', () => {
  it('writes a new playbook to memory.playbooks', async () => {
    const memory = new WorkingMemoryState();
    const tool = new PlaybookToolFactory().createTools().find(t => t.name === 'record_playbook');
    const r = await tool.execute(
      { id: 'test-pattern', fact: 'Test pattern fact.', recipe: 'Step 1: ...' },
      { memory }
    );
    expect(r.ok).toBe(true);
    expect(memory.get('playbooks')).toHaveLength(1);
    expect(memory.get('playbooks')[0]).toMatchObject({
      id: 'test-pattern', fact: 'Test pattern fact.', confidence: 'unverified',
    });
  });

  it('replaces existing playbook with same id', async () => {
    const memory = new WorkingMemoryState();
    memory.set('playbooks', [{ id: 'a', fact: 'old', recipe: 'old' }]);
    const tool = new PlaybookToolFactory().createTools().find(t => t.name === 'record_playbook');
    await tool.execute({ id: 'a', fact: 'new', recipe: 'new' }, { memory });
    expect(memory.get('playbooks')).toHaveLength(1);
    expect(memory.get('playbooks')[0].fact).toBe('new');
  });

  it('rejects when id missing', async () => {
    const memory = new WorkingMemoryState();
    const tool = new PlaybookToolFactory().createTools().find(t => t.name === 'record_playbook');
    const r = await tool.execute({ fact: 'x', recipe: 'y' }, { memory });
    expect(r.error).toMatch(/id/);
  });

  it('rejects when memory is missing from context', async () => {
    const tool = new PlaybookToolFactory().createTools().find(t => t.name === 'record_playbook');
    const r = await tool.execute({ id: 'a', fact: 'b', recipe: 'c' }, {});
    expect(r.error).toMatch(/memory/);
  });
});
```

```javascript
// tests/isolated/agents/health-coach/playbooks/update_playbook.test.mjs
import { describe, it, expect } from 'vitest';
import { PlaybookToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/PlaybookToolFactory.mjs';
import { WorkingMemoryState } from '../../../../backend/src/3_applications/agents/framework/WorkingMemory.mjs';

describe('update_playbook', () => {
  it('updates last_verified on existing playbook', async () => {
    const memory = new WorkingMemoryState();
    memory.set('playbooks', [{ id: 'a', fact: 'f', recipe: 'r' }]);
    const tool = new PlaybookToolFactory().createTools().find(t => t.name === 'update_playbook');
    const r = await tool.execute({
      id: 'a',
      last_verified: { at: '2026-05-06T17:00Z', period: 'last_30d', result: { gap: 0.99 } },
      confidence: 'high',
    }, { memory });
    expect(r.ok).toBe(true);
    const updated = memory.get('playbooks')[0];
    expect(updated.last_verified.result.gap).toBe(0.99);
    expect(updated.confidence).toBe('high');
    expect(updated.fact).toBe('f');  // unchanged
  });

  it('errors when id not found', async () => {
    const memory = new WorkingMemoryState();
    memory.set('playbooks', [{ id: 'a', fact: 'f', recipe: 'r' }]);
    const tool = new PlaybookToolFactory().createTools().find(t => t.name === 'update_playbook');
    const r = await tool.execute({ id: 'nonexistent', notes: 'x' }, { memory });
    expect(r.error).toMatch(/not found/);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```javascript
// backend/src/3_applications/agents/health-coach/tools/PlaybookToolFactory.mjs
import { ToolFactory } from '../../framework/ToolFactory.mjs';

export class PlaybookToolFactory extends ToolFactory {
  static domain = 'health-coach';

  createTools() {
    return [
      {
        name: 'record_playbook',
        description: 'Save (or replace by id) an analytical playbook to user memory. The library auto-renders into the prompt every turn.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable slug; updates rewrite by this id.' },
            fact: { type: 'string', description: 'One declarative sentence describing the pattern.' },
            recipe: { type: 'string', description: 'Prose with worked example tool calls.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low', 'unverified'] },
            tags: { type: 'array', items: { type: 'string' } },
            related_playbooks: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
          },
          required: ['id', 'fact', 'recipe'],
        },
        execute: async (args, ctx) => {
          if (!ctx?.memory) return { error: 'no_memory_context' };
          if (!args?.id) return { error: 'id required' };
          const list = ctx.memory.get('playbooks') ?? [];
          const playbook = {
            id: args.id,
            fact: args.fact,
            recipe: args.recipe,
            confidence: args.confidence ?? 'unverified',
            tags: args.tags ?? [],
            related_playbooks: args.related_playbooks ?? [],
            notes: args.notes ?? null,
          };
          const idx = list.findIndex(p => p.id === args.id);
          if (idx >= 0) list[idx] = { ...list[idx], ...playbook };
          else list.push(playbook);
          ctx.memory.set('playbooks', list);
          return { ok: true, action: idx >= 0 ? 'replaced' : 'created' };
        },
      },
      {
        name: 'update_playbook',
        description: 'Refresh the last_verified field (and optionally confidence/notes) on an existing playbook after running its recipe.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            last_verified: {
              type: 'object',
              properties: {
                at: { type: 'string' },
                period: {},
                result: { type: 'object' },
              },
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low', 'unverified'] },
            notes: { type: 'string' },
          },
          required: ['id'],
        },
        execute: async (args, ctx) => {
          if (!ctx?.memory) return { error: 'no_memory_context' };
          const list = ctx.memory.get('playbooks') ?? [];
          const idx = list.findIndex(p => p.id === args.id);
          if (idx < 0) return { error: `playbook "${args.id}" not found` };
          const merged = { ...list[idx] };
          if (args.last_verified) merged.last_verified = args.last_verified;
          if (args.confidence)    merged.confidence    = args.confidence;
          if (args.notes !== undefined) merged.notes   = args.notes;
          list[idx] = merged;
          ctx.memory.set('playbooks', list);
          return { ok: true };
        },
      },
    ];
  }
}

export default PlaybookToolFactory;
```

- [ ] **Step 4: Run; pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/PlaybookToolFactory.mjs \
        tests/isolated/agents/health-coach/playbooks/
git commit -m "feat(health-coach): PlaybookToolFactory — record_playbook, update_playbook

Plan / Task 8. Two helpers that operate on context.memory's 'playbooks'
key. record_playbook adds-or-replaces by id; update_playbook merges
last_verified/confidence/notes. Read path is automatic via the prompt's
Working Memory section.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Pre-seeded playbook library

8 starter playbooks shipped as a YAML file, loaded into memory on the agent's first turn for a user.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/playbooks/seed.yml`
- Create: `backend/src/3_applications/agents/health-coach/playbooks/seedLoader.mjs`
- Create: `tests/isolated/agents/health-coach/playbooks/seedLoader.test.mjs`

- [ ] **Step 1: Write the seed file**

```yaml
# backend/src/3_applications/agents/health-coach/playbooks/seed.yml
- id: under-reporting-calories
  fact: "User's logged calories under-report actual intake. Verify by reconciling logged deficit against actual weight slope."
  confidence: unverified
  tags: [nutrition, weight, energy-balance]
  recipe: |
    Compute TDEE from body comp + activity, compare predicted Δweight from
    logged deficit to actual weight slope. Gap = % of deficit unlogged.

    Steps (sub period as needed):
      1. query_health({ metric: 'weight_lbs',   period: P, aggregate: 'regression' }) → slope
      2. query_health({ metric: 'calories',     period: P, aggregate: 'mean' })       → intake
      3. query_health({ metric: 'workout_kcal', period: P, aggregate: 'mean' })       → activity
      4. personal_constants()                                                          → kg/cm/age/sex
      5. compute("10*kg + 6.25*cm - 5*age + 5 + activity")                             → tdee     (Mifflin-St Jeor for men; subtract 161 for women)
      6. compute("(intake - tdee) * <days> / 3500")                                    → predicted_dw
      7. compute("slope * <days>")                                                     → actual_dw
      8. compute("1 - actual_dw / predicted_dw")                                       → gap_pct

- id: weight-trend-noise
  fact: "Daily weight has ±2 lb water/sodium swing; only 7-day-smoothed trends are signal. Don't conclude on raw daily slopes."
  confidence: high
  tags: [weight, methodology]
  recipe: |
    When assessing weight trend, query with rolling 7d mean and run
    regression on the smoothed series, not the raw.

      query_health({
        metric: 'weight_lbs', period: P,
        rolling: { fn: 'mean', window: 7 },
        aggregate: 'regression'
      })

- id: tracking-density-reliability
  fact: "Tracking density ≥ 0.8 means nutrition logs are reliable. < 0.6 means under-logged; nutrition conclusions need a confidence caveat."
  confidence: high
  tags: [nutrition, data-quality]
  recipe: |
    Before claiming "you ate X" or drawing nutrition conclusions:
      query_health({ metric: 'tracking_density', period: P, aggregate: 'mean' })
    If < 0.6, qualify the conclusion as low-confidence.
    If between 0.6 and 0.8, note caveat.
    If ≥ 0.8, nutrition data is trustworthy.

- id: workout-source-reconciliation
  fact: "Workouts can land in three places: logged manually, captured by HR device, or pulled from Strava. Real activity = the union; logged-only counts under-state."
  confidence: medium
  tags: [activity, data-quality]
  recipe: |
    Compare workout counts across data sources (when source-aware queries
    are available). Today, query_health aggregates across sources by
    default — flag if a known source seems missing for the period.

      query_health({ metric: 'workout_count', period: P, aggregate: 'sum' })
    Sanity-check against the user's intuition; if they say "I worked out
    5 times last week" but the count is 3, surface the gap.

- id: protein-adequacy
  fact: "Target protein is ~0.8 g/lb of lean mass. Below 0.6 g/lb is under-fueling; above 1.0 g/lb is fine but expensive."
  confidence: high
  tags: [nutrition, fitness]
  recipe: |
      query_health({ metric: 'protein_g',     period: P, aggregate: 'mean' }) → protein
      query_health({ metric: 'lean_mass_lbs', period: P, aggregate: 'mean' }) → lean
      compute("protein / lean")                                                → ratio
    Compare ratio to thresholds 0.6, 0.8, 1.0. Report adequacy.

- id: weekly-cadence
  fact: "Personal baseline is ~3-4 strength sessions + 2-3 cardio sessions per week. Below 2 total = recovery week; above 6 = potential overreach."
  confidence: medium
  tags: [activity, baseline]
  recipe: |
      query_health({
        metric: 'workout_count', period: P,
        granularity: 'weekly', aggregate: 'sum'
      })
    Compare each week's count to the 2 / 6 thresholds; flag deviations.

- id: weekend-vs-weekday-divergence
  fact: "User's nutrition tends to drift higher on weekends. Quantify with grouped means; weekly average can hide compensation."
  confidence: medium
  tags: [nutrition, pattern]
  recipe: |
      query_health({
        metric: 'calories', period: { rolling: 'last_90d' },
        group_by: 'weekday_vs_weekend', aggregate: 'mean'
      })
    Call out the gap if > 200 kcal/day. Higher weekend kcal explains weight
    plateau even when weekly average looks reasonable.

- id: heart-rate-zone-load
  fact: "Time in zone 2 (60-70% HRmax) is the highest-value cardio. Below 90 min/week of zone 2 = undertrained for endurance."
  confidence: high
  tags: [activity, cardiovascular]
  recipe: |
      query_health({
        metric: 'hr_minutes_zone2', period: P,
        granularity: 'weekly', aggregate: 'sum'
      })
    Compare to 90 min/week threshold. Flag weeks below.
```

- [ ] **Step 2: Write failing test for the loader**

```javascript
// tests/isolated/agents/health-coach/playbooks/seedLoader.test.mjs
import { describe, it, expect } from 'vitest';
import { loadSeedIfEmpty, readSeedFile } from '../../../../backend/src/3_applications/agents/health-coach/playbooks/seedLoader.mjs';
import { WorkingMemoryState } from '../../../../backend/src/3_applications/agents/framework/WorkingMemory.mjs';

describe('seedLoader.readSeedFile', () => {
  it('parses the YAML seed file into an array of playbook objects', async () => {
    const playbooks = await readSeedFile();
    expect(Array.isArray(playbooks)).toBe(true);
    expect(playbooks.length).toBeGreaterThanOrEqual(8);
    expect(playbooks[0]).toMatchObject({
      id: expect.any(String),
      fact: expect.any(String),
      recipe: expect.any(String),
    });
    expect(playbooks.map(p => p.id)).toContain('under-reporting-calories');
  });
});

describe('seedLoader.loadSeedIfEmpty', () => {
  it('writes seed playbooks when memory has none', async () => {
    const memory = new WorkingMemoryState();
    const result = await loadSeedIfEmpty(memory);
    expect(result.loaded).toBe(true);
    expect(memory.get('playbooks').length).toBeGreaterThanOrEqual(8);
  });

  it('does NOT overwrite existing playbooks', async () => {
    const memory = new WorkingMemoryState();
    memory.set('playbooks', [{ id: 'pre-existing', fact: 'x', recipe: 'y' }]);
    const result = await loadSeedIfEmpty(memory);
    expect(result.loaded).toBe(false);
    expect(memory.get('playbooks')).toEqual([{ id: 'pre-existing', fact: 'x', recipe: 'y' }]);
  });
});
```

- [ ] **Step 3: Run; FAIL**

- [ ] **Step 4: Implement**

```javascript
// backend/src/3_applications/agents/health-coach/playbooks/seedLoader.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(HERE, 'seed.yml');

let cached = null;

export async function readSeedFile() {
  if (cached) return cached;
  const text = await readFile(SEED_PATH, 'utf8');
  cached = yaml.load(text);
  return cached;
}

export async function loadSeedIfEmpty(memory) {
  const existing = memory.get('playbooks');
  if (Array.isArray(existing) && existing.length > 0) return { loaded: false };
  const seed = await readSeedFile();
  memory.set('playbooks', seed);
  return { loaded: true, count: seed.length };
}
```

- [ ] **Step 5: Run; pass**

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/playbooks/ \
        tests/isolated/agents/health-coach/playbooks/seedLoader.test.mjs
git commit -m "feat(health-coach): seed playbook library + loader

Plan / Task 9. 8 starter playbooks covering under-reporting, weight
noise, tracking density, source reconciliation, protein adequacy,
weekly cadence, weekend divergence, and HR zone load. Loader writes
on empty memory; never overwrites existing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Wire seed loading into HealthCoachAgent

The agent calls `loadSeedIfEmpty(memory)` once per turn during prompt assembly. The auto-seed lands the first time a user's memory is empty; subsequent turns are no-ops.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`

- [ ] **Step 1: Read existing HealthCoachAgent for the prompt-assembly hook**

```bash
cd /opt/Code/DaylightStation && grep -n "buildPromptSections\|getSystemPrompt\|registerTools" backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs
```

- [ ] **Step 2: Wire the loader**

In `HealthCoachAgent.mjs`, override `buildPromptSections` (or add to the existing override) to call the loader:

```javascript
import { loadSeedIfEmpty } from './playbooks/seedLoader.mjs';

// Inside the class:
async buildPromptSections(context, memory) {
  if (memory) {
    await loadSeedIfEmpty(memory);
  }
  return super.buildPromptSections(context, memory);
}
```

The loader is idempotent — it only acts on the first empty-memory turn. After that, it's a no-op.

- [ ] **Step 3: Verify with the existing agent test suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/ tests/isolated/agents/framework/
```

Expected: all green (we didn't change behavior, just added an idempotent step).

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs
git commit -m "feat(health-coach): seed playbooks on first turn

Plan / Task 10. Wires loadSeedIfEmpty into buildPromptSections so the
seed library lands when a user's memory has no playbooks yet. Idempotent
on subsequent turns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Replace chat.mjs prompt

Wholesale rewrite per spec §"Prompt changes". The 22-row tool cheatsheet table goes away; four new sections (Tools, Reasoning patterns, Playbook protocol, Self-consistency) replace it.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/prompts/chat.mjs`

- [ ] **Step 1: Replace the file body**

```javascript
// backend/src/3_applications/agents/health-coach/prompts/chat.mjs

export const chatPrompt = `You are a personal health coach. Answer the user's question in clear, concise prose grounded in real data fetched via your tools and computed via your sandbox. Do NOT produce JSON. Reference specific numbers from tool results.

## Personality
- Direct and data-driven. Reference specific numbers (weight, macros, session counts).
- Brief and actionable. No motivational fluff or filler.
- Acknowledge patterns with data. "Three workouts this week" not "Great job staying active!"
- Suggest, don't lecture. "Protein has averaged 95g — target is 145g" not "You need to eat more protein."

## Tools

You have three primary analytical tools and a small library of helpers:

- query_health(...) — single data-access tool. Pass metric, period, optional
  aggregate / group_by / filter / join / correlate / rolling. Examples in the
  playbooks.
- compute(expression, inputs?) — sandboxed math. Use this for any arithmetic
  on query_health results. Do NOT do mental math in your prose. The user
  will catch errors and the analysis will be wrong.
- personal_constants() — height, age, sex, current weight in kg/lb, scale
  bias, default activity multiplier. Read these for any metabolic calculation.

Helpers: list_periods, query_named_period, remember_period, forget_period,
remember_note, recall_note, record_playbook, update_playbook.

## Reasoning patterns

When the user asks you to confirm a hypothesis, explain a discrepancy, or
'show your work':

  1. Look at the playbooks in Working Memory. If one matches the question,
     follow its recipe. If not, plan your own chain.
  2. Run query_health calls to gather the inputs.
  3. Run compute() calls to do the math. Each compute is one labeled step.
  4. State the conclusion with magnitude and the chain that produced it:
     "TDEE 1986 (Mifflin + activity 350). Logged 1462 → 524/day apparent
      deficit → predicted 4.5 lb/30d. Actual 0.04 lb. Gap: 99%."

Do not paraphrase a tool result and call that an analysis. If the question
asks for synthesis or causation, you must compute something — not just
reword retrieved numbers.

## Playbook protocol

The Working Memory section above contains analytical playbooks — known
patterns about this user with recipes to verify them.

When the user's question matches a playbook's fact:
  1. Reference the playbook's last_verified result first if recent (< 30 days).
  2. Run the recipe to refresh the verification — fresh numbers > stale claims.
  3. Call update_playbook with the new last_verified.
  4. If a pattern flips, update confidence and notes.

When you discover a stable pattern through analysis (n ≥ 30, effect beyond
noise), call record_playbook.

## Self-consistency

Within a single turn, do not contradict an earlier tool result. If
query_health returned tracking_density 0.92 in step 2, do not later say
"tracking is low" without re-querying. Your prior tool calls are in your
context — re-read them before making a claim.

If two playbooks disagree, call it out and run a verification rather than
picking one.

## Period syntax
Most analytical tools take a \`period\` argument. Accepted forms:
- Rolling: { "rolling": "last_30d" }, { "rolling": "last_year" }
- Calendar: { "calendar": "2024" }, { "calendar": "2024-Q3" }, { "calendar": "this_month" }
- Named: { "named": "2017-cut" } — see list_periods for what's available
- Explicit: { "from": "2024-01-01", "to": "2024-03-31" }

Bare strings ("last_30d", "this_year") are also accepted as shorthand.

## Output
Write conversational prose. No JSON, no markdown headers unless the user
asks for a list or table. Keep replies tight: 2-5 sentences for simple
questions, longer only when the user asks for depth.`;
```

- [ ] **Step 2: Run agent suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/prompts/chat.mjs
git commit -m "feat(health-coach): rewrite chat prompt for query+compute+playbooks

Plan / Task 11. Replaces the 22-row tool cheatsheet with four new
sections: Tools (3 primary + helpers), Reasoning patterns (show-your-work
discipline), Playbook protocol (use the in-memory library), Self-consistency
(don't contradict earlier tool results).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Wire new factories into HealthCoachAgent.registerTools (additive)

Add `HealthQueryToolFactory` and `PlaybookToolFactory` alongside the existing factories. Don't retire anything yet — this task ships the new tools and leaves the old ones in place. Tasks 13–14 retire.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` (wires the new services into deps)

- [ ] **Step 1: Read bootstrap to find where HealthCoachAgent's deps are wired**

```bash
cd /opt/Code/DaylightStation && grep -n "HealthCoachAgent\|healthAnalyticsService\|healthStore\|healthService" backend/src/0_system/bootstrap.mjs | head -20
```

- [ ] **Step 2: Wire services in bootstrap**

Just before `agentOrchestrator.register(HealthCoachAgent, deps)`, add:

```javascript
import { HealthQueryService }       from '#apps/agents/health-coach/services/HealthQueryService.mjs';
import { ComputeSandbox }           from '#apps/agents/health-coach/services/ComputeSandbox.mjs';
import { PersonalConstantsService } from '#apps/agents/health-coach/services/PersonalConstantsService.mjs';

const healthQueryService = new HealthQueryService({ healthStore, healthService });
const computeSandbox = new ComputeSandbox();
const personalConstantsService = new PersonalConstantsService({ dataService, healthStore });

// Add to the deps passed to register:
agentOrchestrator.register(HealthCoachAgent, {
  // ... existing deps ...
  healthQueryService,
  computeSandbox,
  personalConstantsService,
});
```

- [ ] **Step 3: Wire the new factories in HealthCoachAgent.registerTools**

In `HealthCoachAgent.mjs`, append to `registerTools()`:

```javascript
import { HealthQueryToolFactory } from './tools/HealthQueryToolFactory.mjs';
import { PlaybookToolFactory }    from './tools/PlaybookToolFactory.mjs';

// inside registerTools():
const { healthQueryService, computeSandbox, personalConstantsService } = this.deps;
this.addToolFactory(new HealthQueryToolFactory({
  queryService: healthQueryService,
  sandbox:      computeSandbox,
  constantsService: personalConstantsService,
}));
this.addToolFactory(new PlaybookToolFactory());
```

- [ ] **Step 4: Run agent suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/ tests/isolated/agents/framework/ tests/isolated/adapters/agents/
```

Expected: all green. The agent now has BOTH the new tools and the old ones.

- [ ] **Step 5: node -c parse check**

```bash
cd /opt/Code/DaylightStation && node -c backend/src/0_system/bootstrap.mjs && echo OK
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs \
        backend/src/0_system/bootstrap.mjs
git commit -m "feat(health-coach): wire HealthQueryToolFactory + PlaybookToolFactory (additive)

Plan / Task 12. Adds the new tools alongside existing factories. Old
tools still register; cleanup in Task 13.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Retire legacy analytical tool factories

Delete the four bloated factories. Verify with grep that nothing else imports them. Tests for the deleted tools get deleted.

**Files:**
- Delete: `backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs`
- Delete: `backend/src/3_applications/agents/health-coach/tools/HealthToolFactory.mjs`
- Delete: `backend/src/3_applications/agents/health-coach/tools/ReconciliationToolFactory.mjs`
- Delete: `backend/src/3_applications/agents/health-coach/tools/ComplianceToolFactory.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs` — keep only the period vocabulary tools
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs` — remove `addToolFactory` calls for the deleted factories

- [ ] **Step 1: Grep for external imports of the four factories**

```bash
cd /opt/Code/DaylightStation && grep -rn "HealthAnalyticsToolFactory\|HealthToolFactory\|ReconciliationToolFactory\|ComplianceToolFactory" backend/ tests/ --include="*.mjs" | grep -v "node_modules"
```

Expected: only HealthCoachAgent.mjs and the doomed factories themselves. If anything else imports them, escalate.

- [ ] **Step 2: Trim LongitudinalToolFactory to keep only the period vocabulary tools**

Read the existing LongitudinalToolFactory:

```bash
cd /opt/Code/DaylightStation && grep -n "name: '" backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs
```

Keep only: `query_named_period`, `read_notes_file`. Delete the rest (`query_historical_*`, `find_similar_period`, `query_historical_reconciliation`, `query_historical_coaching`). The removed tools' functionality is covered by `query_health` with appropriate periods.

(`list_periods`, `remember_period`, `forget_period` may live in HealthAnalyticsToolFactory rather than LongitudinalToolFactory — check; move them to a small `PeriodToolFactory.mjs` if they need a new home, OR keep them in LongitudinalToolFactory.)

- [ ] **Step 3: Delete the four factories**

```bash
cd /opt/Code/DaylightStation && rm -v \
  backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs \
  backend/src/3_applications/agents/health-coach/tools/HealthToolFactory.mjs \
  backend/src/3_applications/agents/health-coach/tools/ReconciliationToolFactory.mjs \
  backend/src/3_applications/agents/health-coach/tools/ComplianceToolFactory.mjs
```

- [ ] **Step 4: Update HealthCoachAgent.registerTools**

Remove the `addToolFactory` calls for the deleted factories:

```bash
cd /opt/Code/DaylightStation && grep -n "addToolFactory" backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs
```

Remove imports + calls for HealthAnalyticsToolFactory, HealthToolFactory, ReconciliationToolFactory, ComplianceToolFactory. The remaining factories: HealthQueryToolFactory, PlaybookToolFactory, LongitudinalToolFactory (trimmed), DashboardToolFactory, FitnessContentToolFactory, MessagingChannelToolFactory.

- [ ] **Step 5: Find test files that imported the deleted factories**

```bash
cd /opt/Code/DaylightStation && grep -rln "HealthAnalyticsToolFactory\|HealthToolFactory\|ReconciliationToolFactory\|ComplianceToolFactory" tests/ backend/tests/ --include="*.mjs"
```

For each found test file: if it tests the OLD tools, delete it. If it tests something else and just imported one of these factories incidentally, update the import.

- [ ] **Step 6: Run agent suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/ tests/isolated/agents/framework/ tests/isolated/adapters/agents/
```

Expected: all green. The new tools cover the surface; the old tests for retired tools are deleted.

- [ ] **Step 7: Verify tool count is reduced**

```bash
cd /opt/Code/DaylightStation && grep -c "name: '" backend/src/3_applications/agents/health-coach/tools/*.mjs | sort -t: -k2
```

Should sum to ~10-12 tools across the surviving factories (down from 30+).

- [ ] **Step 8: node -c parse check + commit**

```bash
cd /opt/Code/DaylightStation && node -c backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs && echo OK

git add -A
git commit -m "$(cat <<'EOF'
chore(health-coach): retire 4 bloated tool factories

Plan / Task 13. Deletes HealthAnalyticsToolFactory + HealthToolFactory +
ReconciliationToolFactory + ComplianceToolFactory entirely. Trims
LongitudinalToolFactory to just the period vocabulary tools.

The retired tools' surface is fully replaced by query_health (with
appropriate aggregates / groupings / joins) + compute + the playbook
recipes that show how to compose them.

Tool count drops from ~30 to ~10. Smaller menu = sharper signal for
LLM tool selection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Integration test — replay each seeded playbook

Each of the 8 seeded playbooks should run end-to-end against fixture data: agent runtime + memory + tools execute the recipe, produce numeric output. Catches wiring bugs that unit tests miss.

**Files:**
- Create: `tests/isolated/agents/health-coach/integration/playbook_recipes.test.mjs`

- [ ] **Step 1: Write the integration test**

```javascript
// tests/isolated/agents/health-coach/integration/playbook_recipes.test.mjs
import { describe, it, expect } from 'vitest';
import { HealthQueryService } from '../../../../backend/src/3_applications/agents/health-coach/services/HealthQueryService.mjs';
import { ComputeSandbox } from '../../../../backend/src/3_applications/agents/health-coach/services/ComputeSandbox.mjs';
import { PersonalConstantsService } from '../../../../backend/src/3_applications/agents/health-coach/services/PersonalConstantsService.mjs';

function makeFixtureServices() {
  // 30 days of synthetic data with a known under-reporting pattern:
  // Logged: 1462 kcal/day (steady), workouts: 350 kcal/day
  // Weight: starts 170, slope -0.0014 lb/day → ~ -0.04 lb total
  // → predicted Δw from logged deficit ≈ -4.5 lb (with TDEE ~1986)
  // → actual Δw ≈ -0.04 lb → ~99% gap
  const startDate = new Date('2026-04-08T00:00:00Z');
  const weightData = {};
  const nutritionData = {};
  const workoutData = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(startDate);
    d.setUTCDate(startDate.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    weightData[date]    = { lbs: 170.0 - 0.0014 * i, fat_pct: 22.0 };
    nutritionData[date] = { calories: 1462, protein: 95, carbs: 130, fat: 50, fiber: 30, tracking_density: 0.92 };
    workoutData[date]   = { workouts: [{ type: 'mixed', duration: 45, kcal: 350, hr_avg: 130 }] };
  }
  return {
    healthStore: {
      loadWeightData:    async () => weightData,
      loadNutritionData: async () => nutritionData,
    },
    healthService: { getHealthForRange: async () => workoutData },
    dataService: {
      user: {
        read: async (userId, path) => path === 'profile/health.yml'
          ? { height_cm: 180, age: 40, sex: 'M', activity_pal: 1.55, scale_bias_lbs: 0 }
          : null,
      },
    },
    now: () => new Date('2026-05-07T12:00:00Z'),
  };
}

describe('integration: under-reporting-calories playbook recipe', () => {
  it('produces a ~99% gap as expected', async () => {
    const fix = makeFixtureServices();
    const queryService     = new HealthQueryService({ healthStore: fix.healthStore, healthService: fix.healthService, now: fix.now });
    const sandbox          = new ComputeSandbox();
    const constantsService = new PersonalConstantsService({ dataService: fix.dataService, healthStore: fix.healthStore });

    const slopeResult = await queryService.query({
      metric: 'weight_lbs', period: { rolling: 'last_30d' }, aggregate: 'regression', userId: 'kc',
    });
    const intakeResult = await queryService.query({
      metric: 'calories', period: { rolling: 'last_30d' }, aggregate: 'mean', userId: 'kc',
    });
    const activityResult = await queryService.query({
      metric: 'workout_kcal', period: { rolling: 'last_30d' }, aggregate: 'mean', userId: 'kc',
    });
    const constants = await constantsService.get('kc');

    const tdee = sandbox.evaluate(
      "10*kg + 6.25*cm - 5*age + 5 + activity",
      { kg: constants.weight_kg, cm: constants.height_cm, age: constants.age, activity: activityResult.value }
    );
    const predictedDw = sandbox.evaluate(
      "(intake - tdee) * 30 / 3500",
      { intake: intakeResult.value, tdee: tdee.value }
    );
    const actualDw = sandbox.evaluate(
      "slope * 30",
      { slope: slopeResult.slope }
    );
    const gap = sandbox.evaluate(
      "1 - actual_dw / predicted_dw",
      { actual_dw: actualDw.value, predicted_dw: predictedDw.value }
    );

    expect(intakeResult.value).toBeCloseTo(1462, 0);
    expect(activityResult.value).toBeCloseTo(350, 0);
    expect(tdee.value).toBeGreaterThan(1900);
    expect(tdee.value).toBeLessThan(2050);
    expect(predictedDw.value).toBeLessThan(-3);    // strong predicted loss
    expect(actualDw.value).toBeCloseTo(-0.042, 2);  // tiny actual loss
    expect(gap.value).toBeGreaterThan(0.95);        // ~99% gap
  });
});

describe('integration: weight-trend-noise — rolling smoothing', () => {
  it('rolling-7-day mean produces a smoothed series', async () => {
    const fix = makeFixtureServices();
    const queryService = new HealthQueryService({ healthStore: fix.healthStore, healthService: fix.healthService, now: fix.now });
    const r = await queryService.query({
      metric: 'weight_lbs', period: { rolling: 'last_30d' },
      rolling: { fn: 'mean', window: 7 },
      userId: 'kc',
    });
    expect(r.rows).toHaveLength(30);
    // First 6 should be null due to insufficient window
    expect(r.rows[5].value).toBe(null);
    expect(r.rows[6].value).toBeCloseTo(170 - 0.0014 * 3, 2);
  });
});

describe('integration: weekend-vs-weekday-divergence', () => {
  it('groups calories by weekday/weekend correctly', async () => {
    const fix = makeFixtureServices();
    const queryService = new HealthQueryService({ healthStore: fix.healthStore, healthService: fix.healthService, now: fix.now });
    const r = await queryService.query({
      metric: 'calories', period: { rolling: 'last_30d' },
      group_by: 'weekday_vs_weekend', aggregate: 'mean',
      userId: 'kc',
    });
    // Synthetic data has identical kcal every day, so weekday and weekend means are equal
    expect(r.groups.weekday.value).toBeCloseTo(r.groups.weekend.value, 1);
    expect(r.groups.weekday.count + r.groups.weekend.count).toBe(30);
  });
});
```

- [ ] **Step 2: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/integration/playbook_recipes.test.mjs
```

- [ ] **Step 3: Commit**

```bash
git add tests/isolated/agents/health-coach/integration/playbook_recipes.test.mjs
git commit -m "test(health-coach): integration replay of seeded playbook recipes

Plan / Task 14. Synthetic 30-day fixture wired through real
HealthQueryService + ComputeSandbox + PersonalConstantsService.
Validates under-reporting recipe ends at ~99% gap, rolling smooths,
weekday/weekend grouping splits cleanly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Final verification + deploy + live smoke

- [ ] **Step 1: Full vitest**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/agents/ \
  tests/isolated/adapters/agents/ \
  backend/src/4_api/v1/agents/ \
  tests/isolated/api/routers/health-mentions.test.mjs
```

Expected: all green.

- [ ] **Step 2: Vite build**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3
```

- [ ] **Step 3: Backend parse check**

```bash
cd /opt/Code/DaylightStation && node -c backend/src/app.mjs && node -c backend/src/0_system/bootstrap.mjs && echo OK
```

- [ ] **Step 4: Build + deploy**

```bash
cd /opt/Code/DaylightStation && sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  . 2>&1 | tail -5

sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight 2>&1 | tail -3
sleep 12
```

- [ ] **Step 5: Live smoke — the parrot question**

```bash
curl -sS -X POST http://localhost:3111/api/v1/agents/health-coach/run \
  -H "Content-Type: application/json" \
  -d '{"input":"Am I under-reporting calories given my activity level? Show your work.","context":{"userId":"kckern"}}' \
  | tee /tmp/parrot-test.json | python3 -c "
import json, sys
r = json.loads(sys.stdin.read())
print('output:', (r.get('output') or '')[:600])
print('tool calls:', len(r.get('toolCalls') or []))
for tc in (r.get('toolCalls') or [])[:10]:
    p = tc.get('payload', {})
    print('  -', p.get('toolName'), p.get('args', {}).get('expression') or p.get('args', {}).get('metric') or '')
"
```

Expected:
- The output references concrete numbers (TDEE, predicted Δw, actual Δw, gap %).
- Multiple `query_health` and `compute` tool calls in `toolCalls`.
- The output should NOT just paraphrase — it should show the chain. If it still parrots, the prompt needs another iteration; the architecture is correct.

- [ ] **Step 6: Final empty commit**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore(health-coach): reasoning architecture complete

15 tasks landed:
- HealthQueryService (1-4): SQL-equivalent retriever + aggregator
- ComputeSandbox (5): vm.runInContext math eval
- PersonalConstantsService (6): calibration values
- HealthQueryToolFactory (7): wraps the 3 services into 3 tools
- PlaybookToolFactory (8): record/update playbook helpers
- Seed library + loader (9-10): 8 starter playbooks
- Prompt rewrite (11): query+compute+playbooks instead of 22-row cheatsheet
- Wire new factories (12)
- Retire 4 bloated factories (13)
- Integration playbook replay (14)
- Live deploy + smoke (15)

Tool count: 30+ → ~10. Agent now does math via compute() (not in head),
references playbooks for known patterns, follows show-your-work
discipline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| Spec section | Task |
|---|---|
| `query_health` skeleton + metric vocabulary | 1 |
| `query_health` aggregates | 2 |
| `query_health` group_by + filter + join | 3 |
| `query_health` correlate + rolling | 4 |
| `compute` sandbox | 5 |
| `personal_constants` service | 6 |
| `HealthQueryToolFactory` (3 tools wrapped) | 7 |
| `record_playbook` + `update_playbook` | 8 |
| Pre-seeded playbook library | 9 |
| First-turn auto-seed | 10 |
| Prompt rewrite | 11 |
| Wire new factories (additive) | 12 |
| Retire legacy factories | 13 |
| Integration replay tests | 14 |
| Final verification + deploy | 15 |

All spec requirements covered.

---

## Notes for the implementer

- **`personal_constants` data path.** The user profile YAML may not exist for all users yet. Task 6 Step 5 creates one for `kckern`; for others, the service throws a clear error message. Acceptable — users without profile data can't use the metabolic-reasoning playbooks until calibration is set.
- **Period vocabulary.** Task 1's `#resolvePeriod` only handles rolling `last_Nd` and explicit `from/to`. Calendar periods (`{ calendar: '2024-Q3' }`) and named periods (`{ named: '2017-cut' }`) are deferred — the existing period resolution code in `LongitudinalToolFactory` or `HealthAnalyticsService` may have richer parsing already; the implementer can lift that pattern into `HealthQueryService.#resolvePeriod`. If unsure, ship with rolling+explicit only and iterate.
- **`personal_constants` Mifflin formula sex correction.** The seed playbook for `under-reporting-calories` uses `+ 5` for men. For women it should be `- 161`. Playbook recipe notes this; the agent reads the user's `sex` from `personal_constants()` and adjusts the formula text it passes to `compute()`. No code branching needed.
- **`query_event_log`.** The spec mentions it as a possible second tool (returning individual workouts/meals as rows). This plan defers it — `query_health({ granularity: 'raw' })` could cover it if needed; revisit if a playbook recipe genuinely requires per-event detail.
- **Tool count post-cleanup.** Target is ~10 tools. The exact count depends on which period vocabulary tools survive in LongitudinalToolFactory (3-5) plus the 3 new query/compute tools, the 2 new playbook tools, and the surviving CRUD/content tools (DashboardToolFactory, FitnessContentToolFactory, MessagingChannelToolFactory). Implementer counts after Task 13.
- **Live smoke is the gate.** If Task 15 Step 5's curl response still produces parrot output despite the architecture being right, the prompt may need another iteration (e.g., explicit few-shots showing the exact tool-call chain for the under-reporting question). Architecture issues are different from prompt issues — diagnose before fixing.
