# Health Analytics — Comparison & Correlation Implementation Plan (Plan 2/5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `MetricComparator` sub-service to the Health Analytics tier with four primitives (`compare_metric`, `summarize_change`, `conditional_aggregate`, `correlate_metrics`), wire them into `HealthAnalyticsService`, expose them as agent tools and dscli subcommands.

**Architecture:** New domain service `MetricComparator` in `backend/src/2_domains/health/services/`. Reuses `PeriodResolver` and `MetricRegistry` from Plan 1. `HealthAnalyticsService` gets four new delegate methods. `HealthAnalyticsToolFactory` adds four tools. `cli/commands/health.mjs` adds four subcommand actions: `compare`, `summarize-change`, `conditional`, `correlate`.

**Tech Stack:** Same as Plan 1. Vitest, ES modules, path aliases via `package.json` `imports`.

**Spec:** [docs/superpowers/specs/2026-05-05-health-coach-data-tier-design.md](../specs/2026-05-05-health-coach-data-tier-design.md) — Tier 2 capability "Compare" and "Correlate / condition" sections.

**Prerequisites:** Plan 1 (`worktree-health-analytics-foundation`) merged to main. `PeriodResolver`, `MetricRegistry`, `MetricAggregator`, `HealthAnalyticsService`, `HealthAnalyticsToolFactory`, and `cli/commands/health.mjs` already exist.

---

## File structure

**New files:**
- `backend/src/2_domains/health/services/MetricComparator.mjs` — pure domain service with the four methods.
- `tests/isolated/domain/health/services/MetricComparator.test.mjs`

**Modified files:**
- `backend/src/2_domains/health/services/HealthAnalyticsService.mjs` — instantiate `MetricComparator` in constructor, add 4 delegate methods.
- `tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs` — extend pass-through test.
- `backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs` — add 4 tools.
- `tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs` — extend tests.
- `cli/commands/health.mjs` — add 4 actions.
- `tests/unit/cli/commands/health.test.mjs` — extend tests.

---

## Conventions (recap from Plan 1)

- Vitest. Tests in `tests/isolated/...` and `tests/unit/cli/...` use vitest imports. Run individually with `npx vitest run <path>`.
- Domain services pure (no I/O of their own; pull from `healthStore` and `healthService` via deps).
- Tool factory wraps domain methods, returns `{ ..., error }` envelope on failure.
- CLI uses `printJson` / `printError` from `cli/_output.mjs`. Period parsed via `parsePeriodFlag()`.
- All commits end with: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- UTC dates, `YYYY-MM-DD` strings.

---

## Task 1: MetricComparator — `compare` (single-metric across two periods)

**Files:**
- Create: `backend/src/2_domains/health/services/MetricComparator.mjs`
- Test: `tests/isolated/domain/health/services/MetricComparator.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// tests/isolated/domain/health/services/MetricComparator.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { MetricComparator } from '../../../../../backend/src/2_domains/health/services/MetricComparator.mjs';
import { MetricAggregator } from '../../../../../backend/src/2_domains/health/services/MetricAggregator.mjs';
import { PeriodResolver } from '../../../../../backend/src/2_domains/health/services/PeriodResolver.mjs';

const NOW = new Date('2026-05-05T12:00:00Z');
const fixedNow = () => NOW;

// 30-day weight fixture: 2026-04-06..2026-05-05, slow downward drift
function buildWeightFixture() {
  const out = {};
  let lbs = 200;
  const start = new Date(Date.UTC(2026, 3, 6));
  for (let i = 0; i < 30; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    out[key] = { lbs, lbs_adjusted_average: lbs };
    lbs -= 0.1;
  }
  return out;
}

// 60-day weight fixture: 2026-03-07..2026-05-05, slow downward drift
function buildLongWeightFixture() {
  const out = {};
  let lbs = 205;
  const start = new Date(Date.UTC(2026, 2, 7));
  for (let i = 0; i < 60; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    out[key] = { lbs, lbs_adjusted_average: lbs };
    lbs -= 0.1;
  }
  return out;
}

function makeComparator(weightFixture = buildWeightFixture(), nutritionFixture = {}) {
  const healthStore = {
    loadWeightData: vi.fn(async () => weightFixture),
    loadNutritionData: vi.fn(async () => nutritionFixture),
  };
  const healthService = { getHealthForRange: vi.fn(async () => ({})) };
  const periodResolver = new PeriodResolver({ now: fixedNow });
  const aggregator = new MetricAggregator({ healthStore, healthService, periodResolver });
  return {
    comparator: new MetricComparator({ aggregator, periodResolver, healthStore, healthService }),
    healthStore, healthService, periodResolver, aggregator,
  };
}

describe('MetricComparator.compare', () => {
  it('returns delta and percentChange across two rolling periods', async () => {
    const { comparator } = makeComparator(buildLongWeightFixture());
    const out = await comparator.compare({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.metric).toBe('weight_lbs');
    expect(out.statistic).toBe('mean');
    expect(out.a.value).not.toBeNull();
    expect(out.b.value).not.toBeNull();
    expect(out.delta).toBeCloseTo(out.a.value - out.b.value, 6);
    expect(out.percentChange).toBeCloseTo((out.a.value - out.b.value) / out.b.value, 6);
    expect(['high', 'medium', 'low']).toContain(out.reliability);
  });

  it('passes statistic through to both aggregations', async () => {
    const { comparator } = makeComparator(buildLongWeightFixture());
    const out = await comparator.compare({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
      statistic: 'min',
    });
    expect(out.statistic).toBe('min');
    expect(typeof out.a.value).toBe('number');
  });

  it('marks reliability=high when both periods have full coverage', async () => {
    const { comparator } = makeComparator(buildLongWeightFixture());
    const out = await comparator.compare({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.reliability).toBe('high');
  });

  it('marks reliability=low when one period has no data', async () => {
    const sparse = {};
    sparse['2026-05-05'] = { lbs: 200, lbs_adjusted_average: 200 };
    const { comparator } = makeComparator(sparse);
    const out = await comparator.compare({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.reliability).toBe('low');
  });

  it('returns null delta when one period has no value', async () => {
    const onlyA = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.UTC(2026, 3, 6));
      d.setUTCDate(d.getUTCDate() + i);
      onlyA[d.toISOString().slice(0, 10)] = { lbs: 200, lbs_adjusted_average: 200 };
    }
    const { comparator } = makeComparator(onlyA);
    const out = await comparator.compare({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.b.value).toBe(null);
    expect(out.delta).toBe(null);
    expect(out.percentChange).toBe(null);
  });
});
```

- [ ] **Step 2: Run; FAIL with "Cannot find module MetricComparator.mjs"**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricComparator.test.mjs
```

- [ ] **Step 3: Implement MetricComparator with `compare` only**

```javascript
// backend/src/2_domains/health/services/MetricComparator.mjs

import { MetricRegistry } from './MetricRegistry.mjs';

/**
 * Comparison and correlation primitives. Builds on MetricAggregator —
 * comparator constructs aggregate calls, then assembles a compressed answer.
 *
 * Reliability scoring: based on how complete the data is for each period.
 * Threshold ratios (daysCovered / daysInPeriod):
 *   >= 0.7 → high
 *   >= 0.4 → medium
 *   else  → low
 *
 * @typedef {object} MetricComparatorDeps
 * @property {object} aggregator      - MetricAggregator instance
 * @property {object} periodResolver  - PeriodResolver instance
 * @property {object} healthStore     - IHealthDataDatastore
 * @property {object} healthService   - exposes getHealthForRange()
 */
export class MetricComparator {
  constructor(deps) {
    if (!deps?.aggregator)     throw new Error('MetricComparator requires aggregator');
    if (!deps?.periodResolver) throw new Error('MetricComparator requires periodResolver');
    if (!deps?.healthStore)    throw new Error('MetricComparator requires healthStore');
    if (!deps?.healthService)  throw new Error('MetricComparator requires healthService');
    this.aggregator = deps.aggregator;
    this.periodResolver = deps.periodResolver;
    this.healthStore = deps.healthStore;
    this.healthService = deps.healthService;
  }

  /**
   * Compare a metric across two periods.
   *
   * @returns {Promise<{
   *   metric: string, statistic: string,
   *   a: { period, value, daysCovered, daysInPeriod },
   *   b: { period, value, daysCovered, daysInPeriod },
   *   delta: number|null, percentChange: number|null,
   *   reliability: 'high'|'medium'|'low'
   * }>}
   */
  async compare({ userId, metric, period_a, period_b, statistic = 'mean' }) {
    const [a, b] = await Promise.all([
      this.aggregator.aggregate({ userId, metric, period: period_a, statistic }),
      this.aggregator.aggregate({ userId, metric, period: period_b, statistic }),
    ]);

    const delta = (a.value != null && b.value != null) ? a.value - b.value : null;
    const percentChange = (delta != null && b.value !== 0 && b.value != null)
      ? delta / b.value
      : null;

    const reliability = scoreReliability(a, b);

    return {
      metric, statistic,
      a: { period: a.period, value: a.value, daysCovered: a.daysCovered, daysInPeriod: a.daysInPeriod },
      b: { period: b.period, value: b.value, daysCovered: b.daysCovered, daysInPeriod: b.daysInPeriod },
      delta, percentChange, reliability,
    };
  }
}

export default MetricComparator;

// ---------- helpers ----------

function scoreReliability(a, b) {
  const minRatio = Math.min(coverageRatio(a), coverageRatio(b));
  if (minRatio >= 0.7) return 'high';
  if (minRatio >= 0.4) return 'medium';
  return 'low';
}

function coverageRatio(side) {
  if (!side || side.daysInPeriod <= 0) return 0;
  return side.daysCovered / side.daysInPeriod;
}
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricComparator.mjs \
        tests/isolated/domain/health/services/MetricComparator.test.mjs
git commit -m "$(cat <<'EOF'
feat(health-analytics): MetricComparator.compare — single-metric two-period

Plan 2 / Task 1. Delta + percent change + reliability scoring across two
PeriodResolver-resolved windows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: MetricComparator — `summarizeChange`

**Files:**
- Modify: `backend/src/2_domains/health/services/MetricComparator.mjs`
- Modify: `tests/isolated/domain/health/services/MetricComparator.test.mjs`

This builds on `compare()` but adds change-shape detection: returns `changeShape: 'monotonic' | 'volatile' | 'step' | 'reversal'`, optional `inflectionDate`, per-side variances, and structured `drivers`.

For Plan 2 we ship a SIMPLE classifier:
- Compute the daily series across `[from of B, to of A]` using `aggregateSeries({ granularity: 'daily' })` (note: this requires the periods be contiguous or overlapping — for non-contiguous, we just analyze the union range).
- `changeShape`: if monotonic across the union range → `monotonic`. If stdev/mean ratio > 0.5 → `volatile`. Else → `step` (default placeholder).
- `inflectionDate`: if a clear single inflection point exists (largest single-day delta), return that date; else null.
- `drivers`: empty array in Plan 2 (placeholder for future enrichment with conditional analysis).

This keeps Plan 2 compact while shipping useful behavior. Plan 3 (regime detection) will provide a richer `inflectionDate`.

- [ ] **Step 1: Append tests:**

```javascript
describe('MetricComparator.summarizeChange', () => {
  it('returns delta + changeShape for two adjacent periods', async () => {
    const { comparator } = makeComparator(buildLongWeightFixture());
    const out = await comparator.summarizeChange({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.metric).toBe('weight_lbs');
    expect(typeof out.delta).toBe('number');
    expect(['monotonic', 'volatile', 'step', 'reversal']).toContain(out.changeShape);
    expect(out.varianceA).toBeGreaterThanOrEqual(0);
    expect(out.varianceB).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(out.drivers)).toBe(true);
  });

  it('identifies monotonic shape when fixture drifts steadily', async () => {
    // The buildLongWeightFixture is strictly monotonic decreasing
    const { comparator } = makeComparator(buildLongWeightFixture());
    const out = await comparator.summarizeChange({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.changeShape).toBe('monotonic');
  });

  it('returns null delta when one period has no value', async () => {
    const sparse = {};
    sparse['2026-05-05'] = { lbs: 200, lbs_adjusted_average: 200 };
    const { comparator } = makeComparator(sparse);
    const out = await comparator.summarizeChange({
      userId: 'kc',
      metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' },
      period_b: { rolling: 'prev_30d' },
    });
    expect(out.delta).toBe(null);
    expect(out.changeShape).toBe('step');
  });
});
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Add `summarizeChange` method to the class:**

```javascript
  /**
   * Richer comparison than `compare`: classifies change shape, identifies
   * inflection point, and reports per-side variance.
   *
   * @returns {Promise<{
   *   metric, statistic, a, b, delta, percentChange,
   *   changeShape: 'monotonic'|'volatile'|'step'|'reversal',
   *   inflectionDate: string|null,
   *   varianceA: number, varianceB: number,
   *   drivers: Array
   * }>}
   */
  async summarizeChange({ userId, metric, period_a, period_b, statistic = 'mean' }) {
    const cmp = await this.compare({ userId, metric, period_a, period_b, statistic });

    // Pull per-day series for both sides for variance + shape detection.
    const [seriesA, seriesB] = await Promise.all([
      this.aggregator.aggregateSeries({ userId, metric, period: period_a, granularity: 'daily', statistic }),
      this.aggregator.aggregateSeries({ userId, metric, period: period_b, granularity: 'daily', statistic }),
    ]);

    const valuesA = seriesA.buckets.map(b => b.value).filter(v => typeof v === 'number' && Number.isFinite(v));
    const valuesB = seriesB.buckets.map(b => b.value).filter(v => typeof v === 'number' && Number.isFinite(v));

    const varianceA = computeVariance(valuesA);
    const varianceB = computeVariance(valuesB);

    let changeShape;
    if (cmp.delta == null) {
      changeShape = 'step';   // can't classify with missing data
    } else {
      // Concatenate the two series chronologically (b before a, by their resolved from/to)
      const combined = [...seriesB.buckets, ...seriesA.buckets].map(b => b.value)
        .filter(v => typeof v === 'number' && Number.isFinite(v));
      changeShape = classifyShape(combined, varianceA + varianceB);
    }

    // Inflection: the daily index in the combined series with the largest
    // absolute step. We map back to the date by walking the combined series.
    const combinedBuckets = [...seriesB.buckets, ...seriesA.buckets];
    const inflectionDate = findInflectionDate(combinedBuckets);

    return {
      metric: cmp.metric,
      statistic: cmp.statistic,
      a: cmp.a,
      b: cmp.b,
      delta: cmp.delta,
      percentChange: cmp.percentChange,
      changeShape,
      inflectionDate,
      varianceA, varianceB,
      drivers: [],   // Plan 2 placeholder; future plans enrich this
    };
  }
```

Add helpers at the bottom:

```javascript
function computeVariance(values) {
  if (!values.length) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
}

function classifyShape(values, totalVariance) {
  if (values.length < 2) return 'step';
  // Monotonic: every consecutive delta has the same sign (or is zero).
  let monotonicallyUp = true;
  let monotonicallyDown = true;
  let signFlips = 0;
  let prevSign = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) { monotonicallyDown = false; if (prevSign === -1) signFlips++; prevSign = 1; }
    else if (d < 0) { monotonicallyUp = false; if (prevSign === 1) signFlips++; prevSign = -1; }
  }
  if (monotonicallyUp || monotonicallyDown) return 'monotonic';
  if (signFlips >= 3) return 'volatile';
  // Coefficient of variation > 0.5 → volatile fallback
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean !== 0) {
    const stdev = Math.sqrt(totalVariance / 2);
    if (Math.abs(stdev / mean) > 0.5) return 'volatile';
  }
  // Has the trend reversed direction overall? sign of first-half slope vs second-half
  const mid = Math.floor(values.length / 2);
  const slopeA = (values[mid] - values[0]) / Math.max(1, mid);
  const slopeB = (values[values.length - 1] - values[mid]) / Math.max(1, values.length - 1 - mid);
  if (slopeA * slopeB < 0) return 'reversal';
  return 'step';
}

function findInflectionDate(buckets) {
  if (buckets.length < 2) return null;
  let maxAbs = 0;
  let maxIdx = -1;
  for (let i = 1; i < buckets.length; i++) {
    const a = buckets[i - 1].value;
    const b = buckets[i].value;
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    const d = Math.abs(b - a);
    if (d > maxAbs) { maxAbs = d; maxIdx = i; }
  }
  if (maxIdx < 0) return null;
  return buckets[maxIdx].period;
}
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricComparator.mjs \
        tests/isolated/domain/health/services/MetricComparator.test.mjs
git commit -m "feat(health-analytics): MetricComparator.summarizeChange

Plan 2 / Task 2. Classifies monotonic/volatile/step/reversal shape, finds
inflection date from daily series, exposes per-side variance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: MetricComparator — `conditionalAggregate`

This is the workhorse for "when X happens, what does Y do" questions.

**Files:**
- Modify: `backend/src/2_domains/health/services/MetricComparator.mjs`
- Modify: `tests/isolated/domain/health/services/MetricComparator.test.mjs`

The condition vocabulary (initial set per spec):
- `{ tracked: true | false }`
- `{ workout: true | false }`
- `{ day_closed: true | false }`
- `{ weekday: 'Mon'|'Tue'|... }`
- `{ weekend: true | false }`
- `{ season: 'winter'|'spring'|'summer'|'fall' }`
- `{ since: 'YYYY-MM-DD' }` / `{ before: 'YYYY-MM-DD' }`
- `{ tag_includes: 'travel' }`
- `{ field_above: { metric, value } }` / `{ field_below: { metric, value } }`

For Plan 2 we ship the **6 most commonly useful**: `tracked`, `workout`, `weekday`, `weekend`, `since`, `before`. Others are added in a later polish pass — they're not blocking core coaching questions.

- [ ] **Step 1: Append tests:**

```javascript
describe('MetricComparator.conditionalAggregate', () => {
  // Build a fixture where: 30 days of weight + nutrition. Days where i%2===0
  // have nutrition logged (calories>0); odd days do not.
  function buildPairedFixture() {
    const weight = {};
    const nutrition = {};
    let lbs = 200;
    const start = new Date(Date.UTC(2026, 3, 6)); // Mon 2026-04-06
    for (let i = 0; i < 30; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      weight[key] = { lbs, lbs_adjusted_average: lbs };
      if (i % 2 === 0) {
        nutrition[key] = { calories: 2000, protein: 150 };
      }
      lbs -= 0.1;
    }
    return { weight, nutrition };
  }

  it('splits a metric by tracked vs untracked condition', async () => {
    const { weight, nutrition } = buildPairedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.conditionalAggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { tracked: true },
    });
    expect(out.metric).toBe('weight_lbs');
    expect(out.matching.daysMatched).toBe(15);  // even-indexed days
    expect(out.notMatching.daysNotMatched).toBe(15);
    expect(typeof out.matching.value).toBe('number');
    expect(typeof out.notMatching.value).toBe('number');
    expect(typeof out.delta).toBe('number');
  });

  it('weekday condition splits by ISO day-of-week', async () => {
    const { weight, nutrition } = buildPairedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.conditionalAggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { weekday: 'Mon' },
    });
    // 30 days from Mon 2026-04-06 → 5 Mondays
    expect(out.matching.daysMatched).toBe(5);
  });

  it('weekend condition matches Sat+Sun', async () => {
    const { weight, nutrition } = buildPairedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.conditionalAggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { weekend: true },
    });
    // 30-day window = 4 weeks + 2 days; 4*2 = 8 weekend days
    expect(out.matching.daysMatched).toBe(8);
  });

  it('since condition keeps only days >= cutoff', async () => {
    const { weight, nutrition } = buildPairedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.conditionalAggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { since: '2026-04-20' },
    });
    expect(out.matching.daysMatched).toBe(16);
  });

  it('throws on unknown condition shape', async () => {
    const { weight, nutrition } = buildPairedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    await expect(comparator.conditionalAggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { magic: 'unicorn' },
    })).rejects.toThrow(/unknown condition/);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Add `conditionalAggregate` method:**

```javascript
  /**
   * Compute a metric statistic separately for days matching vs not matching
   * a condition. Returns the matched / not-matched values plus their delta.
   *
   * Conditions (Plan 2):
   *   { tracked: true|false }      — nutrition was/wasn't logged that day
   *   { workout: true|false }      — at least one workout that day
   *   { weekday: 'Mon'|'Tue'|... } — ISO day-of-week
   *   { weekend: true|false }      — Sat/Sun vs weekday
   *   { since: 'YYYY-MM-DD' }      — date >= cutoff
   *   { before: 'YYYY-MM-DD' }     — date < cutoff
   */
  async conditionalAggregate({ userId, metric, period, condition, statistic = 'mean' }) {
    const reg = MetricRegistry.get(metric);
    const resolved = this.periodResolver.resolve(period);
    const dateMatcher = buildDateMatcher(condition);
    const presenceMatcher = await this.#buildPresenceMatcher(condition, userId, resolved);

    // Pull all daily values across the period.
    const series = await this.aggregator.aggregateSeries({
      userId, metric, period, granularity: 'daily', statistic,
    });

    const matching = [];
    const notMatching = [];
    for (const bucket of series.buckets) {
      const date = bucket.period;  // 'YYYY-MM-DD' for daily granularity
      const matches = dateMatcher(date) && presenceMatcher(date);
      if (matches) matching.push(bucket.value);
      else notMatching.push(bucket.value);
    }

    // Compute the requested statistic over each side.
    const matchValue = matching.length ? aggregateBucket(matching, statistic, reg.kind) : null;
    const notMatchValue = notMatching.length ? aggregateBucket(notMatching, statistic, reg.kind) : null;
    const delta = (matchValue != null && notMatchValue != null) ? matchValue - notMatchValue : null;

    return {
      metric, statistic,
      period: resolved,
      condition: { description: describeCondition(condition), ...condition },
      matching:    { value: matchValue,    daysMatched:    matching.length },
      notMatching: { value: notMatchValue, daysNotMatched: notMatching.length },
      delta,
    };
  }

  // Build a presence matcher for conditions that need to consult store data
  // (e.g. tracked/workout). Returns a sync (date) -> boolean function.
  async #buildPresenceMatcher(condition, userId, resolved) {
    if (Object.prototype.hasOwnProperty.call(condition, 'tracked')) {
      const data = await this.healthStore.loadNutritionData(userId);
      const desired = condition.tracked === true;
      return (date) => {
        const e = data?.[date];
        const tracked = !!(e && typeof e.calories === 'number' && e.calories > 0);
        return tracked === desired;
      };
    }
    if (Object.prototype.hasOwnProperty.call(condition, 'workout')) {
      const range = await this.healthService.getHealthForRange(userId, resolved.from, resolved.to);
      const desired = condition.workout === true;
      return (date) => {
        const arr = range?.[date]?.workouts;
        const has = Array.isArray(arr) && arr.length > 0;
        return has === desired;
      };
    }
    return () => true;
  }
```

Add helpers at module level:

```javascript
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function buildDateMatcher(condition) {
  if ('weekday' in condition) {
    const idx = WEEKDAY_INDEX[condition.weekday];
    if (idx === undefined) throw new Error(`MetricComparator: unknown weekday "${condition.weekday}"`);
    return (date) => new Date(date + 'T00:00:00Z').getUTCDay() === idx;
  }
  if ('weekend' in condition) {
    const desired = condition.weekend === true;
    return (date) => {
      const d = new Date(date + 'T00:00:00Z').getUTCDay();
      return ((d === 0 || d === 6) === desired);
    };
  }
  if ('since' in condition) {
    return (date) => date >= condition.since;
  }
  if ('before' in condition) {
    return (date) => date < condition.before;
  }
  // For tracked/workout conditions, the presence matcher does the work; the
  // date matcher passes through.
  if ('tracked' in condition || 'workout' in condition) {
    return () => true;
  }
  throw new Error(`MetricComparator: unknown condition shape ${JSON.stringify(condition)}`);
}

function describeCondition(condition) {
  if ('tracked' in condition)  return condition.tracked  ? 'days with nutrition logged' : 'days without nutrition logged';
  if ('workout' in condition)  return condition.workout  ? 'days with at least one workout' : 'days with no workouts';
  if ('weekday' in condition)  return `${condition.weekday}s`;
  if ('weekend' in condition)  return condition.weekend  ? 'weekends' : 'weekdays';
  if ('since' in condition)    return `since ${condition.since}`;
  if ('before' in condition)   return `before ${condition.before}`;
  return 'unknown';
}

function aggregateBucket(values, statistic, kind) {
  if (kind === 'ratio') {
    const matched = values.filter(v => v === 1).length;
    return values.length > 0 ? matched / values.length : null;
  }
  if (statistic === 'count') return values.length;
  if (statistic === 'sum')   return values.reduce((s, v) => s + v, 0);
  if (statistic === 'min')   return Math.min(...values);
  if (statistic === 'max')   return Math.max(...values);
  // mean is default
  return values.reduce((s, v) => s + v, 0) / values.length;
}
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricComparator.mjs \
        tests/isolated/domain/health/services/MetricComparator.test.mjs
git commit -m "feat(health-analytics): MetricComparator.conditionalAggregate

Plan 2 / Task 3. Splits a metric by condition (tracked/workout/weekday/
weekend/since/before). Returns matching vs notMatching values + delta.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: MetricComparator — `correlateMetrics`

**Files:**
- Modify: `backend/src/2_domains/health/services/MetricComparator.mjs`
- Modify: `tests/isolated/domain/health/services/MetricComparator.test.mjs`

Pearson + Spearman over two metrics across a period. Uses `aggregateSeries` to align values per-day (or per-bucket if granularity provided).

- [ ] **Step 1: Append tests:**

```javascript
describe('MetricComparator.correlateMetrics', () => {
  // Fixture: 30 days. Weight drifts down, calories drift up — should produce
  // strong negative correlation.
  function buildCorrelatedFixture() {
    const weight = {};
    const nutrition = {};
    let lbs = 200;
    let cal = 1800;
    const start = new Date(Date.UTC(2026, 3, 6));
    for (let i = 0; i < 30; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      weight[key] = { lbs, lbs_adjusted_average: lbs };
      nutrition[key] = { calories: cal, protein: 150 };
      lbs -= 0.5;
      cal += 10;
    }
    return { weight, nutrition };
  }

  it('returns Spearman + Pearson correlations across daily series', async () => {
    const { weight, nutrition } = buildCorrelatedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.correlateMetrics({
      userId: 'kc',
      metric_a: 'weight_lbs',
      metric_b: 'calories',
      period: { from: '2026-04-06', to: '2026-05-05' },
      granularity: 'daily',
    });
    expect(out.metric_a).toBe('weight_lbs');
    expect(out.metric_b).toBe('calories');
    // Both go monotonically (weight down, calories up) → strong negative
    expect(out.correlation).toBeLessThan(-0.9);
    expect(out.pearson).toBeLessThan(-0.9);
    expect(out.pairs).toBe(30);
    expect(out.interpretation).toBe('strong-negative');
  });

  it('skips days where either metric is null', async () => {
    const weight = {};
    const nutrition = {};
    weight['2026-05-01'] = { lbs: 200, lbs_adjusted_average: 200 };
    weight['2026-05-02'] = { lbs: 199, lbs_adjusted_average: 199 };
    weight['2026-05-03'] = { lbs: 198, lbs_adjusted_average: 198 };
    nutrition['2026-05-02'] = { calories: 2000, protein: 150 };
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.correlateMetrics({
      userId: 'kc',
      metric_a: 'weight_lbs',
      metric_b: 'calories',
      period: { from: '2026-05-01', to: '2026-05-03' },
      granularity: 'daily',
    });
    // Only 2026-05-02 has both → 1 pair → correlation = NaN/undefined → 0
    expect(out.pairs).toBe(1);
    expect(out.interpretation).toBe('none');
  });

  it('classifies interpretation', async () => {
    const { weight, nutrition } = buildCorrelatedFixture();
    const { comparator } = makeComparator(weight, nutrition);
    const out = await comparator.correlateMetrics({
      userId: 'kc',
      metric_a: 'weight_lbs',
      metric_b: 'calories',
      period: { from: '2026-04-06', to: '2026-05-05' },
      granularity: 'daily',
    });
    expect(['strong-positive', 'weak-positive', 'none', 'weak-negative', 'strong-negative']).toContain(out.interpretation);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Add `correlateMetrics` method:**

```javascript
  /**
   * Joint behavior of two metrics over a period. Returns rank correlation
   * (Spearman) and Pearson correlation, the number of paired observations,
   * and a coarse interpretation.
   */
  async correlateMetrics({ userId, metric_a, metric_b, period, granularity = 'daily' }) {
    const resolved = this.periodResolver.resolve(period);
    const [seriesA, seriesB] = await Promise.all([
      this.aggregator.aggregateSeries({ userId, metric: metric_a, period, granularity }),
      this.aggregator.aggregateSeries({ userId, metric: metric_b, period, granularity }),
    ]);

    // Align by bucket period key.
    const indexB = new Map(seriesB.buckets.map(b => [b.period, b.value]));
    const pairs = [];
    for (const a of seriesA.buckets) {
      const bv = indexB.get(a.period);
      if (typeof a.value === 'number' && Number.isFinite(a.value)
          && typeof bv === 'number' && Number.isFinite(bv)) {
        pairs.push([a.value, bv]);
      }
    }

    const pearson = pearsonCorrelation(pairs);
    const spearman = spearmanCorrelation(pairs);
    const headline = Number.isFinite(spearman) ? spearman : 0;

    return {
      metric_a, metric_b,
      period: resolved,
      granularity,
      correlation: Number.isFinite(spearman) ? spearman : 0,
      pearson:     Number.isFinite(pearson)  ? pearson  : 0,
      pairs: pairs.length,
      interpretation: classifyCorrelation(headline, pairs.length),
    };
  }
```

Add the correlation helpers at module level:

```javascript
function pearsonCorrelation(pairs) {
  const n = pairs.length;
  if (n < 2) return 0;
  const meanA = pairs.reduce((s, [a]) => s + a, 0) / n;
  const meanB = pairs.reduce((s, [, b]) => s + b, 0) / n;
  let cov = 0, varA = 0, varB = 0;
  for (const [a, b] of pairs) {
    cov  += (a - meanA) * (b - meanB);
    varA += (a - meanA) * (a - meanA);
    varB += (b - meanB) * (b - meanB);
  }
  if (varA === 0 || varB === 0) return 0;
  return cov / Math.sqrt(varA * varB);
}

function spearmanCorrelation(pairs) {
  const n = pairs.length;
  if (n < 2) return 0;
  const ranksA = rankValues(pairs.map(([a]) => a));
  const ranksB = rankValues(pairs.map(([, b]) => b));
  const ranked = ranksA.map((ra, i) => [ra, ranksB[i]]);
  return pearsonCorrelation(ranked);
}

function rankValues(values) {
  // Standard fractional ranking (ties get the average of the positions).
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based avg
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function classifyCorrelation(r, pairs) {
  if (pairs < 2) return 'none';
  const a = Math.abs(r);
  if (a < 0.2) return 'none';
  if (a < 0.5) return r > 0 ? 'weak-positive' : 'weak-negative';
  return r > 0 ? 'strong-positive' : 'strong-negative';
}
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricComparator.mjs \
        tests/isolated/domain/health/services/MetricComparator.test.mjs
git commit -m "feat(health-analytics): MetricComparator.correlateMetrics

Plan 2 / Task 4. Spearman + Pearson correlation between two metrics over
a period. Aligns by daily bucket (or other granularity). Returns rho,
pairs count, and a coarse interpretation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: HealthAnalyticsService — wire MetricComparator

**Files:**
- Modify: `backend/src/2_domains/health/services/HealthAnalyticsService.mjs`
- Modify: `tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs`

- [ ] **Step 1: Update HealthAnalyticsService**

```javascript
// backend/src/2_domains/health/services/HealthAnalyticsService.mjs

import { MetricAggregator } from './MetricAggregator.mjs';
import { MetricComparator } from './MetricComparator.mjs';

export class HealthAnalyticsService {
  constructor(deps) {
    if (!deps?.healthStore)    throw new Error('HealthAnalyticsService requires healthStore');
    if (!deps?.healthService)  throw new Error('HealthAnalyticsService requires healthService');
    if (!deps?.periodResolver) throw new Error('HealthAnalyticsService requires periodResolver');

    this.aggregator = new MetricAggregator(deps);
    this.comparator = new MetricComparator({
      aggregator: this.aggregator,
      periodResolver: deps.periodResolver,
      healthStore: deps.healthStore,
      healthService: deps.healthService,
    });
  }

  // Aggregator delegates
  aggregate(args)        { return this.aggregator.aggregate(args); }
  aggregateSeries(args)  { return this.aggregator.aggregateSeries(args); }
  distribution(args)     { return this.aggregator.distribution(args); }
  percentile(args)       { return this.aggregator.percentile(args); }
  snapshot(args)         { return this.aggregator.snapshot(args); }

  // Comparator delegates
  compare(args)              { return this.comparator.compare(args); }
  summarizeChange(args)      { return this.comparator.summarizeChange(args); }
  conditionalAggregate(args) { return this.comparator.conditionalAggregate(args); }
  correlateMetrics(args)     { return this.comparator.correlateMetrics(args); }
}

export default HealthAnalyticsService;
```

- [ ] **Step 2: Update test**

Append test cases that exercise the new delegates:

```javascript
  it('exposes compare / summarizeChange / conditionalAggregate / correlateMetrics via MetricComparator', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => ({
        '2026-05-04': { lbs: 200, lbs_adjusted_average: 199 },
        '2026-05-05': { lbs: 199, lbs_adjusted_average: 198 },
      })),
      loadNutritionData: vi.fn(async () => ({})),
    };
    const healthService = { getHealthForRange: vi.fn(async () => ({})) };
    const periodResolver = new PeriodResolver({ now: fixedNow });
    const service = new HealthAnalyticsService({ healthStore, healthService, periodResolver });

    expect(typeof service.compare).toBe('function');
    expect(typeof service.summarizeChange).toBe('function');
    expect(typeof service.conditionalAggregate).toBe('function');
    expect(typeof service.correlateMetrics).toBe('function');

    const cmp = await service.compare({
      userId: 'kc', metric: 'weight_lbs',
      period_a: { rolling: 'last_2d' }, period_b: { rolling: 'prev_2d' },
    });
    expect(cmp.metric).toBe('weight_lbs');
  });
```

- [ ] **Step 3: Run; tests pass.**

- [ ] **Step 4: Commit**

```bash
git add backend/src/2_domains/health/services/HealthAnalyticsService.mjs \
        tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs
git commit -m "feat(health-analytics): wire MetricComparator into composition root

Plan 2 / Task 5. Adds compare/summarizeChange/conditionalAggregate/
correlateMetrics delegate methods.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: HealthAnalyticsToolFactory — add 4 tools

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs`
- Modify: `tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs`

- [ ] **Step 1: Append tests**

```javascript
  it('createTools returns 9 tools (5 from Plan 1 + 4 from Plan 2)', () => {
    const { factory } = makeFactory();
    const tools = factory.createTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'aggregate_metric', 'aggregate_series',
      'compare_metric', 'conditional_aggregate', 'correlate_metrics',
      'metric_distribution', 'metric_percentile', 'metric_snapshot',
      'summarize_change',
    ]);
  });

  it('compare_metric calls service.compare', async () => {
    const compareMock = vi.fn(async (args) => ({ ...args, delta: 1, percentChange: 0.005 }));
    const { factory } = makeFactory({ compare: compareMock });
    const tool = factory.createTools().find(t => t.name === 'compare_metric');
    await tool.execute({
      userId: 'kc', metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' }, period_b: { rolling: 'prev_30d' },
    });
    expect(compareMock).toHaveBeenCalled();
  });

  it('summarize_change calls service.summarizeChange', async () => {
    const summMock = vi.fn(async () => ({ changeShape: 'monotonic' }));
    const { factory } = makeFactory({ summarizeChange: summMock });
    const tool = factory.createTools().find(t => t.name === 'summarize_change');
    await tool.execute({
      userId: 'kc', metric: 'weight_lbs',
      period_a: { rolling: 'last_30d' }, period_b: { rolling: 'prev_30d' },
    });
    expect(summMock).toHaveBeenCalled();
  });

  it('conditional_aggregate calls service.conditionalAggregate', async () => {
    const condMock = vi.fn(async () => ({ matching: { value: 1, daysMatched: 5 }, notMatching: { value: 2, daysNotMatched: 5 }, delta: -1 }));
    const { factory } = makeFactory({ conditionalAggregate: condMock });
    const tool = factory.createTools().find(t => t.name === 'conditional_aggregate');
    await tool.execute({
      userId: 'kc', metric: 'weight_lbs',
      period: { rolling: 'last_30d' },
      condition: { tracked: true },
    });
    expect(condMock).toHaveBeenCalled();
  });

  it('correlate_metrics calls service.correlateMetrics', async () => {
    const corrMock = vi.fn(async () => ({ correlation: 0.85, interpretation: 'strong-positive' }));
    const { factory } = makeFactory({ correlateMetrics: corrMock });
    const tool = factory.createTools().find(t => t.name === 'correlate_metrics');
    await tool.execute({
      userId: 'kc', metric_a: 'weight_lbs', metric_b: 'calories',
      period: { rolling: 'last_30d' },
    });
    expect(corrMock).toHaveBeenCalled();
  });
```

Update the existing `makeFactory` helper to include defaults for the new methods:

```javascript
function makeFactory(overrides = {}) {
  const healthAnalyticsService = {
    aggregate:        vi.fn(async (args) => ({ ...args, value: 100, unit: 'lbs', daysCovered: 5, daysInPeriod: 7 })),
    aggregateSeries:  vi.fn(async (args) => ({ ...args, buckets: [] })),
    distribution:     vi.fn(async (args) => ({ ...args, count: 0 })),
    percentile:       vi.fn(async (args) => ({ ...args, percentile: 50 })),
    snapshot:         vi.fn(async (args) => ({ ...args, metrics: [] })),
    compare:              vi.fn(async (args) => ({ ...args, delta: 0, percentChange: 0 })),
    summarizeChange:      vi.fn(async (args) => ({ ...args, changeShape: 'step' })),
    conditionalAggregate: vi.fn(async (args) => ({ ...args, matching: { value: 0, daysMatched: 0 }, notMatching: { value: 0, daysNotMatched: 0 }, delta: 0 })),
    correlateMetrics:     vi.fn(async (args) => ({ ...args, correlation: 0, pairs: 0, interpretation: 'none' })),
    ...overrides,
  };
  return { factory: new HealthAnalyticsToolFactory({ healthAnalyticsService }), healthAnalyticsService };
}
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Add 4 tool definitions to the factory**

In `HealthAnalyticsToolFactory.mjs`, inside `createTools()`, add (after the existing `metric_snapshot` entry, before the closing array bracket):

```javascript
      createTool({
        name: 'compare_metric',
        description:
          'Compare a metric across two periods. Returns delta, percentChange, ' +
          'and reliability scoring based on data coverage.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period_a: periodSchema,
            period_b: periodSchema,
            statistic: {
              type: 'string',
              enum: ['mean','median','min','max','count','sum','p25','p75','stdev'],
              default: 'mean',
            },
          },
          required: ['userId', 'metric', 'period_a', 'period_b'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.compare(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'summarize_change',
        description:
          'Richer comparison than compare_metric — classifies change shape ' +
          '(monotonic/volatile/step/reversal), reports inflection date and ' +
          'per-side variance.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period_a: periodSchema,
            period_b: periodSchema,
            statistic: {
              type: 'string',
              enum: ['mean','median','min','max','count','sum','p25','p75','stdev'],
              default: 'mean',
            },
          },
          required: ['userId', 'metric', 'period_a', 'period_b'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.summarizeChange(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'conditional_aggregate',
        description:
          'Compute a metric statistic for days matching a condition vs not. ' +
          'Conditions: { tracked }, { workout }, { weekday }, { weekend }, ' +
          '{ since: \'YYYY-MM-DD\' }, { before: \'YYYY-MM-DD\' }.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            condition: { type: 'object', description: 'Structured condition object — see description.' },
            statistic: {
              type: 'string',
              enum: ['mean','median','min','max','count','sum','p25','p75','stdev'],
              default: 'mean',
            },
          },
          required: ['userId', 'metric', 'period', 'condition'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.conditionalAggregate(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'correlate_metrics',
        description:
          'Joint behavior of two metrics over a period. Returns Spearman ' +
          'and Pearson correlations, paired-observation count, and a coarse ' +
          'interpretation (strong/weak positive/negative or none).',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric_a: { type: 'string' },
            metric_b: { type: 'string' },
            period: periodSchema,
            granularity: {
              type: 'string',
              enum: ['daily','weekly','monthly','quarterly','yearly'],
              default: 'daily',
            },
          },
          required: ['userId', 'metric_a', 'metric_b', 'period'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.correlateMetrics(args); }
          catch (err) { return { error: err.message }; }
        },
      }),
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs \
        tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs
git commit -m "feat(health-coach): 4 comparison tools — compare/summarize/conditional/correlate

Plan 2 / Task 6. Adds compare_metric, summarize_change, conditional_aggregate,
correlate_metrics to HealthAnalyticsToolFactory.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: cli/commands/health.mjs — add 4 actions

**Files:**
- Modify: `cli/commands/health.mjs`
- Modify: `tests/unit/cli/commands/health.test.mjs`

- [ ] **Step 1: Append tests**

```javascript
  describe('compare action', () => {
    it('emits JSON for `health compare <metric> --a <p> --b <p>`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['compare', 'weight_lbs'],
          flags: { a: 'last_30d', b: 'prev_30d' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            compare: async (args) => ({
              metric: args.metric, statistic: 'mean',
              a: { value: 197 }, b: { value: 200 },
              delta: -3, percentChange: -0.015, reliability: 'high',
            }),
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.delta).toBe(-3);
    });

    it('exits 2 when --a or --b missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['compare', 'weight_lbs'],
          flags: { a: 'last_30d' },  // missing b
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
    });
  });

  describe('summarize-change action', () => {
    it('emits JSON for `health summarize-change <metric> --a <p> --b <p>`', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['summarize-change', 'weight_lbs'],
          flags: { a: 'last_30d', b: 'prev_30d' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            summarizeChange: async (args) => { captured = args; return { changeShape: 'monotonic' }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.metric).toBe('weight_lbs');
    });
  });

  describe('conditional action', () => {
    it('emits JSON for `health conditional <metric> --period <p> --condition <json>`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['conditional', 'weight_lbs'],
          flags: { period: 'last_30d', condition: '{"tracked":true}' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            conditionalAggregate: async (args) => ({
              matching: { value: 197, daysMatched: 15 },
              notMatching: { value: 199, daysNotMatched: 15 },
              delta: -2,
            }),
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.matching.daysMatched).toBe(15);
    });

    it('exits 2 when --condition missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['conditional', 'weight_lbs'],
          flags: { period: 'last_30d' },
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
    });

    it('exits 2 when --condition is malformed JSON', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['conditional', 'weight_lbs'],
          flags: { period: 'last_30d', condition: 'not-json' },
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
    });
  });

  describe('correlate action', () => {
    it('emits JSON for `health correlate <a> <b> --period <p>`', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['correlate', 'weight_lbs', 'calories'],
          flags: { period: 'last_30d', granularity: 'weekly' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            correlateMetrics: async (args) => { captured = args; return { correlation: -0.85, pearson: -0.84, pairs: 4, interpretation: 'strong-negative' }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.metric_a).toBe('weight_lbs');
      expect(captured.metric_b).toBe('calories');
      expect(captured.granularity).toBe('weekly');
    });

    it('exits 2 when second metric missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['correlate', 'weight_lbs'],
          flags: { period: 'last_30d' },
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
    });
  });
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Implement the 4 new actions in `cli/commands/health.mjs`**

Add a helper for parsing the dual-period flags and a JSON-condition flag near the top:

```javascript
function parseCondition(rawJson) {
  try { return JSON.parse(rawJson); }
  catch (err) { throw new Error(`invalid JSON in --condition: ${err.message}`); }
}

function parsePeriodOrFromTo(args, prefix /* '' for default flags, 'a' or 'b' for compare */) {
  const periodFlag = prefix ? args.flags[prefix] : args.flags.period;
  const fromFlag = prefix ? args.flags[`${prefix}-from`] : args.flags.from;
  const toFlag   = prefix ? args.flags[`${prefix}-to`]   : args.flags.to;
  if (fromFlag && toFlag) return { from: fromFlag, to: toFlag };
  if (periodFlag) return parsePeriodFlag(periodFlag);
  return null;
}
```

Add the four action functions:

```javascript
async function actionCompare(args, deps) {
  const metric = args.positional[1];
  if (!metric) {
    deps.stderr.write('dscli health compare: missing required <metric>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }
  let period_a, period_b;
  try {
    period_a = args.flags.a ? parsePeriodFlag(args.flags.a) : null;
    period_b = args.flags.b ? parsePeriodFlag(args.flags.b) : null;
  } catch (err) {
    printError(deps.stderr, { error: 'invalid_period', message: err.message });
    return { exitCode: EXIT_USAGE };
  }
  if (!period_a || !period_b) {
    printError(deps.stderr, { error: 'period_required', message: 'pass --a <shorthand> and --b <shorthand>.' });
    return { exitCode: EXIT_USAGE };
  }

  let svc;
  try { svc = await deps.getHealthAnalytics(); }
  catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  let result;
  try {
    result = await svc.compare({
      userId: resolveUserId(args),
      metric, period_a, period_b,
      statistic: args.flags.statistic,
    });
  } catch (err) {
    printError(deps.stderr, { error: 'compare_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionSummarizeChange(args, deps) {
  const metric = args.positional[1];
  if (!metric) {
    deps.stderr.write('dscli health summarize-change: missing required <metric>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }
  let period_a, period_b;
  try {
    period_a = args.flags.a ? parsePeriodFlag(args.flags.a) : null;
    period_b = args.flags.b ? parsePeriodFlag(args.flags.b) : null;
  } catch (err) {
    printError(deps.stderr, { error: 'invalid_period', message: err.message });
    return { exitCode: EXIT_USAGE };
  }
  if (!period_a || !period_b) {
    printError(deps.stderr, { error: 'period_required', message: 'pass --a <shorthand> and --b <shorthand>.' });
    return { exitCode: EXIT_USAGE };
  }

  let svc;
  try { svc = await deps.getHealthAnalytics(); }
  catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  let result;
  try {
    result = await svc.summarizeChange({
      userId: resolveUserId(args),
      metric, period_a, period_b,
      statistic: args.flags.statistic,
    });
  } catch (err) {
    printError(deps.stderr, { error: 'summarize_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionConditional(args, deps) {
  const metric = args.positional[1];
  if (!metric) {
    deps.stderr.write('dscli health conditional: missing required <metric>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }
  if (!args.flags.condition) {
    printError(deps.stderr, { error: 'condition_required', message: 'pass --condition <json>.' });
    return { exitCode: EXIT_USAGE };
  }
  let condition;
  try { condition = parseCondition(args.flags.condition); }
  catch (err) {
    printError(deps.stderr, { error: 'invalid_condition', message: err.message });
    return { exitCode: EXIT_USAGE };
  }
  let period;
  try {
    period = args.flags.from && args.flags.to
      ? { from: args.flags.from, to: args.flags.to }
      : args.flags.period ? parsePeriodFlag(args.flags.period) : null;
  } catch (err) {
    printError(deps.stderr, { error: 'invalid_period', message: err.message });
    return { exitCode: EXIT_USAGE };
  }
  if (!period) {
    printError(deps.stderr, { error: 'period_required', message: 'pass --period <shorthand> or --from / --to.' });
    return { exitCode: EXIT_USAGE };
  }

  let svc;
  try { svc = await deps.getHealthAnalytics(); }
  catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  let result;
  try {
    result = await svc.conditionalAggregate({
      userId: resolveUserId(args),
      metric, period, condition,
      statistic: args.flags.statistic,
    });
  } catch (err) {
    printError(deps.stderr, { error: 'conditional_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionCorrelate(args, deps) {
  const metric_a = args.positional[1];
  const metric_b = args.positional[2];
  if (!metric_a || !metric_b) {
    deps.stderr.write('dscli health correlate: requires <metric_a> <metric_b>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }
  let period;
  try {
    period = args.flags.from && args.flags.to
      ? { from: args.flags.from, to: args.flags.to }
      : args.flags.period ? parsePeriodFlag(args.flags.period) : null;
  } catch (err) {
    printError(deps.stderr, { error: 'invalid_period', message: err.message });
    return { exitCode: EXIT_USAGE };
  }
  if (!period) {
    printError(deps.stderr, { error: 'period_required', message: 'pass --period <shorthand> or --from / --to.' });
    return { exitCode: EXIT_USAGE };
  }

  let svc;
  try { svc = await deps.getHealthAnalytics(); }
  catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  let result;
  try {
    result = await svc.correlateMetrics({
      userId: resolveUserId(args),
      metric_a, metric_b,
      period,
      granularity: args.flags.granularity || 'daily',
    });
  } catch (err) {
    printError(deps.stderr, { error: 'correlate_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}
```

Update the `ACTIONS` table:

```javascript
const ACTIONS = {
  aggregate: actionAggregate,
  compare: actionCompare,
  'summarize-change': actionSummarizeChange,
  conditional: actionConditional,
  correlate: actionCorrelate,
};
```

Update the `HELP` string to document the 4 new actions:

```javascript
const HELP = `
dscli health — health analytics surface

Usage:
  dscli health <action> [args] [flags]

Actions (Plans 1-2):
  aggregate <metric>                    Single-value summary over a period.
  compare <metric>                      Compare metric across two periods (--a, --b).
  summarize-change <metric>             Richer compare with shape classification.
  conditional <metric>                  Split metric by condition (--condition <json>).
  correlate <metric_a> <metric_b>       Spearman/Pearson correlation across a period.

Period shorthand (--period, --a, --b, or --from/--to):
  last_7d / last_30d / last_90d / last_180d / last_365d / last_2y / last_5y / last_10y / all_time
  prev_7d / prev_30d / prev_90d / prev_180d / prev_365d
  this_week / this_month / this_quarter / this_year / last_quarter / last_year
  YYYY / YYYY-MM / YYYY-Qn

Other flags:
  --statistic <name>     mean (default) | median | min | max | count | sum | p25 | p75 | stdev
  --user <id>            override user id (defaults to $DSCLI_USER_ID or 'default')
  --from / --to          explicit YYYY-MM-DD bounds (overrides --period)
  --condition <json>     JSON condition for 'conditional' action
  --granularity <g>      daily (default) | weekly | monthly | quarterly | yearly (correlate)

Environment:
  DSCLI_USER_ID          default user id when --user not provided
`.trimStart();
```

- [ ] **Step 4: Run tests; pass.**

- [ ] **Step 5: Commit**

```bash
git add cli/commands/health.mjs tests/unit/cli/commands/health.test.mjs
git commit -m "feat(dscli): health compare/summarize-change/conditional/correlate

Plan 2 / Task 7. Four new actions on dscli health.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: End-to-end smoke verification

- [ ] **Step 1: Run all related tests**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run tests/isolated/domain/health/services/MetricComparator.test.mjs \
                 tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs \
                 tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs \
                 tests/unit/cli/commands/health.test.mjs
```

- [ ] **Step 2: `dscli health --help` shows new actions**

```bash
cd /opt/Code/DaylightStation && node cli/dscli.mjs health --help
```

- [ ] **Step 3: Done — final empty commit (optional)**

```bash
git commit --allow-empty -m "chore(health-analytics): Plan 2 complete

Adds compare/summarize-change/conditional/correlate primitives across
domain, agent, and CLI surfaces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage map

| Spec section | Task |
|---|---|
| `compare_metric` | 1, 5, 6, 7 |
| `summarize_change` | 2, 5, 6, 7 |
| `conditional_aggregate` (6 conditions: tracked/workout/weekday/weekend/since/before) | 3, 5, 6, 7 |
| `correlate_metrics` (Spearman + Pearson) | 4, 5, 6, 7 |
| Other conditions (day_closed, season, tag_includes, field_above/below) | DEFERRED — added in a later polish pass |
