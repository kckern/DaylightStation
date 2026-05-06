# Health Analytics — Trends & Detection Implementation Plan (Plan 3/5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `MetricTrendAnalyzer` sub-service to the Health Analytics tier with four primitives (`metric_trajectory`, `detect_regime_change`, `detect_anomalies`, `detect_sustained`), wire them into `HealthAnalyticsService`, expose them as agent tools and dscli subcommands.

**Architecture:** New domain service `MetricTrendAnalyzer` in `backend/src/2_domains/health/services/`. Reuses `MetricAggregator` for daily series collection. `HealthAnalyticsService` gets four new delegate methods. `HealthAnalyticsToolFactory` adds four tools. `cli/commands/health.mjs` adds four subcommand actions.

**Tech Stack:** Same as Plans 1-2.

**Spec:** [docs/superpowers/specs/2026-05-05-health-coach-data-tier-design.md](../specs/2026-05-05-health-coach-data-tier-design.md) — Tier 2 capability "Analyze trend / trajectory" and "Detect" sections.

**Prerequisites:** Plans 1 and 2 merged to main. `MetricAggregator`, `MetricComparator`, `HealthAnalyticsService` (with 9 methods so far), `HealthAnalyticsToolFactory` (9 tools), `cli/commands/health.mjs` (5 actions) all exist.

---

## File structure

**New files:**
- `backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs`
- `tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs`

**Modified files:**
- `backend/src/2_domains/health/services/HealthAnalyticsService.mjs` — instantiate `MetricTrendAnalyzer`, add 4 delegate methods.
- `tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs` — extend pass-through test.
- `backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs` — add 4 tools.
- `tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs` — extend tests (new total: 13 tools).
- `cli/commands/health.mjs` — add 4 actions: `trajectory`, `regime-change`, `anomalies`, `sustained`.
- `tests/unit/cli/commands/health.test.mjs` — extend tests.

---

## Conventions (recap)

- Vitest, `npx vitest run <path>`. ES modules, path aliases.
- Domain services pure. Tool factory returns `{ ..., error }` envelope. CLI uses `printJson`/`printError`.
- All commits end with: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- UTC, `YYYY-MM-DD` strings.

---

## Task 1: MetricTrendAnalyzer.trajectory — slope + direction + r²

**Files:**
- Create: `backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs`
- Test: `tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { MetricTrendAnalyzer } from '../../../../../backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs';
import { MetricAggregator } from '../../../../../backend/src/2_domains/health/services/MetricAggregator.mjs';
import { PeriodResolver } from '../../../../../backend/src/2_domains/health/services/PeriodResolver.mjs';

const NOW = new Date('2026-05-05T12:00:00Z');
const fixedNow = () => NOW;

// Strictly downward 30-day weight fixture: 200, 199.9, 199.8, ..., 197.1
function buildDownwardWeight() {
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

// Flat 30-day fixture
function buildFlatWeight() {
  const out = {};
  const start = new Date(Date.UTC(2026, 3, 6));
  for (let i = 0; i < 30; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    out[key] = { lbs: 200, lbs_adjusted_average: 200 };
  }
  return out;
}

function makeAnalyzer(weightFixture = buildDownwardWeight()) {
  const healthStore = {
    loadWeightData: vi.fn(async () => weightFixture),
    loadNutritionData: vi.fn(async () => ({})),
  };
  const healthService = { getHealthForRange: vi.fn(async () => ({})) };
  const periodResolver = new PeriodResolver({ now: fixedNow });
  const aggregator = new MetricAggregator({ healthStore, healthService, periodResolver });
  return {
    analyzer: new MetricTrendAnalyzer({ aggregator, periodResolver }),
    healthStore, healthService, periodResolver, aggregator,
  };
}

describe('MetricTrendAnalyzer.trajectory', () => {
  it('returns slope, direction=down, and high rSquared for monotonic descent', async () => {
    const { analyzer } = makeAnalyzer();
    const out = await analyzer.trajectory({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.metric).toBe('weight_lbs');
    expect(out.slope).toBeCloseTo(-0.1, 5); // -0.1 lbs/day
    expect(out.slopePerWeek).toBeCloseTo(-0.7, 5);
    expect(out.direction).toBe('down');
    expect(out.rSquared).toBeCloseTo(1, 5);  // perfect linear fit
    expect(out.start.value).toBe(200);
    expect(out.end.value).toBeCloseTo(200 - 0.1 * 29, 5);
  });

  it('returns direction=flat for a constant series', async () => {
    const { analyzer } = makeAnalyzer(buildFlatWeight());
    const out = await analyzer.trajectory({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.slope).toBe(0);
    expect(out.direction).toBe('flat');
  });

  it('returns optional bucketed series when granularity provided', async () => {
    const { analyzer } = makeAnalyzer();
    const out = await analyzer.trajectory({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      granularity: 'weekly',
    });
    expect(Array.isArray(out.bucketed)).toBe(true);
    expect(out.bucketed.length).toBeGreaterThan(0);
  });

  it('returns null slope when fewer than 2 data points', async () => {
    const { analyzer } = makeAnalyzer({});
    const out = await analyzer.trajectory({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.slope).toBe(null);
    expect(out.direction).toBe('flat');
    expect(out.rSquared).toBe(null);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs
```

- [ ] **Step 3: Implement MetricTrendAnalyzer with `trajectory` only**

```javascript
// backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs

/**
 * Trend and detection primitives. Builds on MetricAggregator —
 * trajectory uses ordinary-least-squares linear regression over a daily
 * series to produce slope/direction/r². Detection methods (regime change,
 * anomalies, sustained runs) operate on the same daily series.
 *
 * @typedef {object} MetricTrendAnalyzerDeps
 * @property {object} aggregator     - MetricAggregator instance
 * @property {object} periodResolver - PeriodResolver instance
 */
export class MetricTrendAnalyzer {
  constructor(deps) {
    if (!deps?.aggregator)     throw new Error('MetricTrendAnalyzer requires aggregator');
    if (!deps?.periodResolver) throw new Error('MetricTrendAnalyzer requires periodResolver');
    this.aggregator = deps.aggregator;
    this.periodResolver = deps.periodResolver;
  }

  /**
   * Slope, direction, fit quality over a period. Optionally returns the
   * bucketed series at the requested granularity.
   */
  async trajectory({ userId, metric, period, granularity = null, statistic = 'mean' }) {
    const resolved = this.periodResolver.resolve(period);
    const dailySeries = await this.aggregator.aggregateSeries({
      userId, metric, period, granularity: 'daily', statistic,
    });

    const points = dailySeries.buckets
      .map(b => ({ date: b.period, value: b.value }))
      .filter(p => typeof p.value === 'number' && Number.isFinite(p.value));

    if (points.length < 2) {
      return {
        metric, period: resolved,
        slope: null, slopePerWeek: null,
        direction: 'flat', rSquared: null,
        start: points[0] ?? null, end: points[points.length - 1] ?? null,
      };
    }

    const x = points.map((_, i) => i);  // day index 0..n-1
    const y = points.map(p => p.value);
    const reg = linearRegression(x, y);

    const slopePerWeek = reg.slope * 7;
    let direction;
    if (Math.abs(reg.slope) < 1e-9) direction = 'flat';
    else direction = reg.slope > 0 ? 'up' : 'down';

    const result = {
      metric, period: resolved,
      slope: reg.slope,
      slopePerWeek,
      direction,
      rSquared: reg.rSquared,
      start: { date: points[0].date, value: points[0].value },
      end:   { date: points[points.length - 1].date, value: points[points.length - 1].value },
    };

    if (granularity && granularity !== 'daily') {
      const bucketed = await this.aggregator.aggregateSeries({
        userId, metric, period, granularity, statistic,
      });
      result.bucketed = bucketed.buckets;
    }

    return result;
  }
}

export default MetricTrendAnalyzer;

// ---------- helpers ----------

function linearRegression(xs, ys) {
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    cov  += (xs[i] - meanX) * (ys[i] - meanY);
    varX += (xs[i] - meanX) * (xs[i] - meanX);
    varY += (ys[i] - meanY) * (ys[i] - meanY);
  }

  if (varX === 0) {
    return { slope: 0, intercept: meanY, rSquared: 1 };
  }
  const slope = cov / varX;
  const intercept = meanY - slope * meanX;
  // rSquared = 1 - SSres/SStot. For OLS, this equals correlation².
  const rSquared = varY === 0 ? 1 : (cov * cov) / (varX * varY);
  return { slope, intercept, rSquared };
}

export { linearRegression };
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs \
        tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs
git commit -m "feat(health-analytics): MetricTrendAnalyzer.trajectory

Plan 3 / Task 1. OLS slope + direction + r² over a daily series. Optional
bucketed series when granularity is provided.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: detect_regime_change — CUSUM-style inflection points

**Files:**
- Modify: `backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs`
- Modify: `tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs`

We use a simple two-window approach: for each candidate split point in the series, compare the mean of the left window vs the right. The largest standardized difference is the candidate change point; report any that exceed a threshold.

- [ ] **Step 1: Append tests**

```javascript
describe('MetricTrendAnalyzer.detectRegimeChange', () => {
  // Step fixture: 30 days where first 15 are at lbs=200 and last 15 are at lbs=195
  function buildStepFixture() {
    const out = {};
    const start = new Date(Date.UTC(2026, 3, 6));
    for (let i = 0; i < 30; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      out[key] = { lbs: i < 15 ? 200 : 195, lbs_adjusted_average: i < 15 ? 200 : 195 };
    }
    return out;
  }

  it('finds a strong regime change at the step point', async () => {
    const { analyzer } = makeAnalyzer(buildStepFixture());
    const out = await analyzer.detectRegimeChange({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.changes.length).toBeGreaterThanOrEqual(1);
    const top = out.changes[0];
    // Step occurs at index 15 → date 2026-04-21
    expect(top.date).toBe('2026-04-21');
    expect(top.confidence).toBeGreaterThan(0.5);
    expect(top.before.mean).toBeCloseTo(200, 5);
    expect(top.after.mean).toBeCloseTo(195, 5);
    expect(top.magnitude).toBeGreaterThan(1);
  });

  it('returns empty changes for a flat series', async () => {
    const { analyzer } = makeAnalyzer(buildFlatWeight());
    const out = await analyzer.detectRegimeChange({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.changes).toEqual([]);
  });

  it('handles too-few-points gracefully', async () => {
    const { analyzer } = makeAnalyzer({});
    const out = await analyzer.detectRegimeChange({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.changes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Add `detectRegimeChange` method**

```javascript
  /**
   * Find inflection points where the metric's mean shifted significantly.
   * Returns up to `max_results` candidates ranked by magnitude.
   *
   * Algorithm: for each candidate split point i in [4, n-4], compute the
   * standardized difference between mean(values[0..i)) and mean(values[i..n)).
   * Threshold: |z| > 2 → candidate. Sort by magnitude descending.
   */
  async detectRegimeChange({ userId, metric, period, max_results = 3 }) {
    const resolved = this.periodResolver.resolve(period);
    const series = await this.aggregator.aggregateSeries({
      userId, metric, period, granularity: 'daily',
    });
    const points = series.buckets
      .map(b => ({ date: b.period, value: b.value }))
      .filter(p => typeof p.value === 'number' && Number.isFinite(p.value));

    if (points.length < 8) {
      return { metric, period: resolved, changes: [] };
    }

    const candidates = [];
    const minWindow = 4;
    for (let i = minWindow; i < points.length - minWindow; i++) {
      const before = points.slice(0, i).map(p => p.value);
      const after  = points.slice(i).map(p => p.value);
      const meanB = before.reduce((s, v) => s + v, 0) / before.length;
      const meanA = after.reduce((s, v) => s + v, 0) / after.length;
      const stdB = Math.sqrt(before.reduce((s, v) => s + (v - meanB) ** 2, 0) / before.length);
      const stdA = Math.sqrt(after.reduce((s, v) => s + (v - meanA) ** 2, 0) / after.length);
      const pooledStd = Math.sqrt((stdB ** 2 + stdA ** 2) / 2);
      const magnitude = pooledStd > 0 ? Math.abs(meanA - meanB) / pooledStd : Math.abs(meanA - meanB);
      if (magnitude < 2) continue;
      // Slope on each side
      const slopeB = before.length > 1 ? (before[before.length - 1] - before[0]) / (before.length - 1) : 0;
      const slopeA = after.length > 1 ? (after[after.length - 1] - after[0]) / (after.length - 1) : 0;
      candidates.push({
        date: points[i].date,
        confidence: Math.min(1, magnitude / 4),  // saturating confidence
        before: { mean: meanB, slope: slopeB, daysCovered: before.length },
        after:  { mean: meanA, slope: slopeA, daysCovered: after.length },
        magnitude,
        description: `mean shifted from ${meanB.toFixed(2)} to ${meanA.toFixed(2)} (z=${magnitude.toFixed(2)})`,
      });
    }

    candidates.sort((a, b) => b.magnitude - a.magnitude);
    return { metric, period: resolved, changes: candidates.slice(0, max_results) };
  }
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs \
        tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs
git commit -m "feat(health-analytics): MetricTrendAnalyzer.detectRegimeChange

Plan 3 / Task 2. Two-window standardized-difference detection of regime
shifts. Returns up to N ranked candidates with before/after stats.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: detect_anomalies — z-score over rolling baseline

**Files:**
- Modify: `backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs`
- Modify: `tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs`

For each day in the period, the baseline is the previous 30 days (or all available days if fewer). Compare today's value to baseline mean ± stdev → z-score. Days with |z| > threshold (default 2) are anomalies.

- [ ] **Step 1: Append tests**

```javascript
describe('MetricTrendAnalyzer.detectAnomalies', () => {
  // 60-day fixture: 200 lbs flat for 50 days, then a spike to 210 on day 51,
  // then back to 200. The spike should be detected.
  function buildSpikeFixture() {
    const out = {};
    const start = new Date(Date.UTC(2026, 2, 7)); // 60 days back from 2026-05-05
    for (let i = 0; i < 60; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      let lbs = 200;
      if (i === 50) lbs = 210; // spike
      out[key] = { lbs, lbs_adjusted_average: lbs };
    }
    return out;
  }

  it('detects a clear spike as an anomaly', async () => {
    const { analyzer } = makeAnalyzer(buildSpikeFixture());
    const out = await analyzer.detectAnomalies({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-03-07', to: '2026-05-05' },
    });
    expect(out.anomalies.length).toBeGreaterThanOrEqual(1);
    const spike = out.anomalies.find(a => a.value === 210);
    expect(spike).toBeDefined();
    expect(spike.direction).toBe('high');
    expect(Math.abs(spike.zScore)).toBeGreaterThan(2);
  });

  it('returns no anomalies for a flat series', async () => {
    const { analyzer } = makeAnalyzer(buildFlatWeight());
    const out = await analyzer.detectAnomalies({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.anomalies).toEqual([]);
  });

  it('honors zScore_threshold parameter', async () => {
    const { analyzer } = makeAnalyzer(buildSpikeFixture());
    const out = await analyzer.detectAnomalies({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-03-07', to: '2026-05-05' },
      zScore_threshold: 100,  // unreachable
    });
    expect(out.anomalies).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Add `detectAnomalies` method**

```javascript
  /**
   * Days where the metric deviates from its rolling baseline by more than
   * `zScore_threshold` standard deviations.
   *
   * Baseline: previous `baseline_window_days` days (default 30) prior to each
   * day. Days early in the period that don't have a full baseline use what's
   * available, with a minimum of 5 baseline points required.
   */
  async detectAnomalies({
    userId, metric, period,
    zScore_threshold = 2,
    baseline_window_days = 30,
  }) {
    const resolved = this.periodResolver.resolve(period);
    const series = await this.aggregator.aggregateSeries({
      userId, metric, period, granularity: 'daily',
    });
    const points = series.buckets
      .map(b => ({ date: b.period, value: b.value }))
      .filter(p => typeof p.value === 'number' && Number.isFinite(p.value));

    const anomalies = [];
    for (let i = 5; i < points.length; i++) {
      const baseStart = Math.max(0, i - baseline_window_days);
      const baseline = points.slice(baseStart, i).map(p => p.value);
      if (baseline.length < 5) continue;
      const mean = baseline.reduce((s, v) => s + v, 0) / baseline.length;
      const variance = baseline.reduce((s, v) => s + (v - mean) ** 2, 0) / baseline.length;
      const stdev = Math.sqrt(variance);
      if (stdev === 0) continue;  // flat baseline → no anomaly possible
      const value = points[i].value;
      const zScore = (value - mean) / stdev;
      if (Math.abs(zScore) >= zScore_threshold) {
        anomalies.push({
          date: points[i].date,
          value,
          baselineMean: mean,
          baselineStdev: stdev,
          zScore,
          direction: zScore > 0 ? 'high' : 'low',
        });
      }
    }

    return {
      metric,
      period: resolved,
      baseline_period: { rolling_window_days: baseline_window_days },
      anomalies,
      count: anomalies.length,
    };
  }
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs \
        tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs
git commit -m "feat(health-analytics): MetricTrendAnalyzer.detectAnomalies

Plan 3 / Task 3. Z-score-based anomaly detection over rolling baseline
window. Configurable threshold (default 2σ) and baseline size (default 30d).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: detect_sustained — find runs matching a condition

**Files:**
- Modify: `backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs`
- Modify: `tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs`

Reuses condition vocabulary from MetricComparator (specifically `field_above`, `field_below`, plus a special case for raw value range).

For Plan 3, the condition forms supported here are:
- `{ value_range: [min, max] }` — value within the range (inclusive)
- `{ field_above: value }` — value > threshold
- `{ field_below: value }` — value < threshold

These act on the metric being analyzed (no cross-metric condition for now — that's Plan 4 territory).

- [ ] **Step 1: Append tests**

```javascript
describe('MetricTrendAnalyzer.detectSustained', () => {
  // 30 days: lbs starts at 200, stays in [193, 197] for days 10-25 (16 days),
  // and is outside that range otherwise.
  function buildBandedFixture() {
    const out = {};
    const start = new Date(Date.UTC(2026, 3, 6));
    const sequence = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      let lbs;
      if (i < 10) lbs = 200;
      else if (i < 26) lbs = 195;  // in [193, 197] for days 10..25 (16 days)
      else lbs = 200;
      out[key] = { lbs, lbs_adjusted_average: lbs };
      sequence.push({ key, lbs });
    }
    return out;
  }

  it('finds a sustained run within value_range', async () => {
    const { analyzer } = makeAnalyzer(buildBandedFixture());
    const out = await analyzer.detectSustained({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { value_range: [193, 197] },
      min_duration_days: 7,
    });
    expect(out.runs.length).toBe(1);
    const run = out.runs[0];
    // Days 10..25 are in range
    expect(run.from).toBe('2026-04-16');
    expect(run.to).toBe('2026-05-01');
    expect(run.durationDays).toBe(16);
    expect(run.summary.mean).toBeCloseTo(195, 5);
  });

  it('drops runs shorter than min_duration_days', async () => {
    const { analyzer } = makeAnalyzer(buildBandedFixture());
    const out = await analyzer.detectSustained({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { value_range: [193, 197] },
      min_duration_days: 30,  // longer than the 16-day run
    });
    expect(out.runs).toEqual([]);
  });

  it('handles field_above condition', async () => {
    const { analyzer } = makeAnalyzer(buildBandedFixture());
    const out = await analyzer.detectSustained({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { field_above: 198 },
      min_duration_days: 5,
    });
    expect(out.runs.length).toBeGreaterThanOrEqual(1);
    // The first 10 days (lbs=200) should match
    const first = out.runs.find(r => r.from === '2026-04-06');
    expect(first).toBeDefined();
    expect(first.durationDays).toBe(10);
  });

  it('handles field_below condition', async () => {
    const { analyzer } = makeAnalyzer(buildBandedFixture());
    const out = await analyzer.detectSustained({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { field_below: 198 },
      min_duration_days: 5,
    });
    // Days 10..25 are at 195 (< 198) → 16-day run
    expect(out.runs.length).toBe(1);
    expect(out.runs[0].durationDays).toBe(16);
  });

  it('throws on unknown condition shape', async () => {
    const { analyzer } = makeAnalyzer();
    await expect(analyzer.detectSustained({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      condition: { magic: 'unicorn' },
      min_duration_days: 5,
    })).rejects.toThrow(/unknown condition/);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Add `detectSustained` method**

```javascript
  /**
   * Find consecutive-day runs where the metric satisfies a condition,
   * lasting at least `min_duration_days`.
   *
   * Conditions:
   *   { value_range: [min, max] }  — value within inclusive range
   *   { field_above: value }       — value > threshold
   *   { field_below: value }       — value < threshold
   */
  async detectSustained({ userId, metric, period, condition, min_duration_days }) {
    const resolved = this.periodResolver.resolve(period);
    const matcher = buildSustainedMatcher(condition);

    const series = await this.aggregator.aggregateSeries({
      userId, metric, period, granularity: 'daily',
    });
    const points = series.buckets
      .map(b => ({ date: b.period, value: b.value }))
      .filter(p => typeof p.value === 'number' && Number.isFinite(p.value));

    const runs = [];
    let runStart = -1;
    let runValues = [];

    for (let i = 0; i < points.length; i++) {
      const matches = matcher(points[i].value);
      if (matches) {
        if (runStart < 0) {
          runStart = i;
          runValues = [];
        }
        runValues.push(points[i].value);
      } else if (runStart >= 0) {
        // close current run
        const run = makeRun(points, runStart, i - 1, runValues);
        if (run.durationDays >= min_duration_days) runs.push(run);
        runStart = -1;
        runValues = [];
      }
    }
    if (runStart >= 0) {
      const run = makeRun(points, runStart, points.length - 1, runValues);
      if (run.durationDays >= min_duration_days) runs.push(run);
    }

    return {
      metric,
      period: resolved,
      condition,
      min_duration_days,
      runs,
    };
  }
```

Add helpers:

```javascript
function buildSustainedMatcher(condition) {
  if (Array.isArray(condition?.value_range) && condition.value_range.length === 2) {
    const [lo, hi] = condition.value_range;
    return (v) => v >= lo && v <= hi;
  }
  if (typeof condition?.field_above === 'number') {
    const t = condition.field_above;
    return (v) => v > t;
  }
  if (typeof condition?.field_below === 'number') {
    const t = condition.field_below;
    return (v) => v < t;
  }
  throw new Error(`MetricTrendAnalyzer: unknown condition shape ${JSON.stringify(condition)}`);
}

function makeRun(points, fromIdx, toIdx, values) {
  const fromDate = points[fromIdx].date;
  const toDate = points[toIdx].date;
  // Days inclusive
  const f = new Date(fromDate + 'T00:00:00Z');
  const t = new Date(toDate + 'T00:00:00Z');
  const durationDays = Math.round((t - f) / 86400000) + 1;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    from: fromDate, to: toDate, durationDays,
    summary: { mean, min, max },
  };
}
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs \
        tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs
git commit -m "feat(health-analytics): MetricTrendAnalyzer.detectSustained

Plan 3 / Task 4. Find consecutive-day runs satisfying value_range / field_above
/ field_below for at least min_duration_days.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: HealthAnalyticsService — wire MetricTrendAnalyzer

**Files:**
- Modify: `backend/src/2_domains/health/services/HealthAnalyticsService.mjs`
- Modify: `tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs`

- [ ] **Step 1: Update HealthAnalyticsService**

```javascript
// backend/src/2_domains/health/services/HealthAnalyticsService.mjs

import { MetricAggregator } from './MetricAggregator.mjs';
import { MetricComparator } from './MetricComparator.mjs';
import { MetricTrendAnalyzer } from './MetricTrendAnalyzer.mjs';

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
    this.trendAnalyzer = new MetricTrendAnalyzer({
      aggregator: this.aggregator,
      periodResolver: deps.periodResolver,
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

  // TrendAnalyzer delegates
  trajectory(args)         { return this.trendAnalyzer.trajectory(args); }
  detectRegimeChange(args) { return this.trendAnalyzer.detectRegimeChange(args); }
  detectAnomalies(args)    { return this.trendAnalyzer.detectAnomalies(args); }
  detectSustained(args)    { return this.trendAnalyzer.detectSustained(args); }
}

export default HealthAnalyticsService;
```

- [ ] **Step 2: Append test**

```javascript
  it('exposes trajectory / detectRegimeChange / detectAnomalies / detectSustained via MetricTrendAnalyzer', async () => {
    const healthStore = {
      loadWeightData: vi.fn(async () => {
        const out = {};
        for (let i = 0; i < 30; i++) {
          const d = new Date(Date.UTC(2026, 3, 6 + i));
          out[d.toISOString().slice(0, 10)] = { lbs: 200 - i * 0.1, lbs_adjusted_average: 200 - i * 0.1 };
        }
        return out;
      }),
      loadNutritionData: vi.fn(async () => ({})),
    };
    const healthService = { getHealthForRange: vi.fn(async () => ({})) };
    const periodResolver = new PeriodResolver({ now: fixedNow });
    const service = new HealthAnalyticsService({ healthStore, healthService, periodResolver });

    expect(typeof service.trajectory).toBe('function');
    expect(typeof service.detectRegimeChange).toBe('function');
    expect(typeof service.detectAnomalies).toBe('function');
    expect(typeof service.detectSustained).toBe('function');

    const traj = await service.trajectory({
      userId: 'kc', metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(traj.direction).toBe('down');
  });
```

- [ ] **Step 3: Run; tests pass.**

- [ ] **Step 4: Commit**

```bash
git add backend/src/2_domains/health/services/HealthAnalyticsService.mjs \
        tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs
git commit -m "feat(health-analytics): wire MetricTrendAnalyzer into composition root

Plan 3 / Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: HealthAnalyticsToolFactory — add 4 trend tools

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs`
- Modify: `tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs`

- [ ] **Step 1: Update `makeFactory` helper to include defaults for the 4 new methods**

```javascript
function makeFactory(overrides = {}) {
  const healthAnalyticsService = {
    // ... existing 9 methods ...
    trajectory:           vi.fn(async (args) => ({ ...args, slope: 0, direction: 'flat' })),
    detectRegimeChange:   vi.fn(async (args) => ({ ...args, changes: [] })),
    detectAnomalies:      vi.fn(async (args) => ({ ...args, anomalies: [], count: 0 })),
    detectSustained:      vi.fn(async (args) => ({ ...args, runs: [] })),
    ...overrides,
  };
  return { factory: new HealthAnalyticsToolFactory({ healthAnalyticsService }), healthAnalyticsService };
}
```

- [ ] **Step 2: Append tests**

```javascript
  it('createTools returns 13 tools after Plan 3', () => {
    const { factory } = makeFactory();
    const names = factory.createTools().map(t => t.name).sort();
    expect(names).toEqual([
      'aggregate_metric', 'aggregate_series',
      'compare_metric', 'conditional_aggregate', 'correlate_metrics',
      'detect_anomalies', 'detect_regime_change', 'detect_sustained',
      'metric_distribution', 'metric_percentile', 'metric_snapshot',
      'metric_trajectory',
      'summarize_change',
    ]);
  });

  it('metric_trajectory calls service.trajectory', async () => {
    const trajMock = vi.fn(async () => ({ slope: -0.1, direction: 'down' }));
    const { factory } = makeFactory({ trajectory: trajMock });
    const tool = factory.createTools().find(t => t.name === 'metric_trajectory');
    await tool.execute({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_30d' } });
    expect(trajMock).toHaveBeenCalled();
  });

  it('detect_regime_change calls service.detectRegimeChange', async () => {
    const rcMock = vi.fn(async () => ({ changes: [] }));
    const { factory } = makeFactory({ detectRegimeChange: rcMock });
    const tool = factory.createTools().find(t => t.name === 'detect_regime_change');
    await tool.execute({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_2y' } });
    expect(rcMock).toHaveBeenCalled();
  });

  it('detect_anomalies calls service.detectAnomalies', async () => {
    const anMock = vi.fn(async () => ({ anomalies: [], count: 0 }));
    const { factory } = makeFactory({ detectAnomalies: anMock });
    const tool = factory.createTools().find(t => t.name === 'detect_anomalies');
    await tool.execute({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_90d' } });
    expect(anMock).toHaveBeenCalled();
  });

  it('detect_sustained calls service.detectSustained', async () => {
    const susMock = vi.fn(async () => ({ runs: [] }));
    const { factory } = makeFactory({ detectSustained: susMock });
    const tool = factory.createTools().find(t => t.name === 'detect_sustained');
    await tool.execute({
      userId: 'kc', metric: 'weight_lbs',
      period: { rolling: 'last_year' },
      condition: { value_range: [193, 197] },
      min_duration_days: 30,
    });
    expect(susMock).toHaveBeenCalled();
  });
```

Update the existing `'returns 9 tools'` test (rename to `'returns 13 tools'` or remove — the new test supersedes it).

- [ ] **Step 3: Run; FAIL.**

- [ ] **Step 4: Add 4 tool definitions** at the end of the factory's `createTools()` array (before the closing `]`):

```javascript
      createTool({
        name: 'metric_trajectory',
        description:
          'Slope, direction, and r² over a period. Optional bucketed series ' +
          'when granularity provided.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            granularity: { type: 'string', enum: ['daily','weekly','monthly','quarterly','yearly'] },
            statistic: { type: 'string', enum: ['mean','median','min','max','count','sum','p25','p75','stdev'], default: 'mean' },
          },
          required: ['userId', 'metric', 'period'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.trajectory(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'detect_regime_change',
        description:
          'Find inflection points where a metric\'s mean shifted significantly. ' +
          'Returns up to max_results ranked candidates with before/after stats.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            max_results: { type: 'number', minimum: 1, default: 3 },
          },
          required: ['userId', 'metric', 'period'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.detectRegimeChange(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'detect_anomalies',
        description:
          'Days where the metric deviates from rolling baseline by more than ' +
          'zScore_threshold standard deviations.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            zScore_threshold: { type: 'number', default: 2 },
            baseline_window_days: { type: 'number', default: 30 },
          },
          required: ['userId', 'metric', 'period'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.detectAnomalies(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'detect_sustained',
        description:
          'Find consecutive-day runs satisfying a condition for at least ' +
          'min_duration_days. Conditions: { value_range: [min, max] }, ' +
          '{ field_above: value }, { field_below: value }.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            condition: { type: 'object', description: 'Structured condition; see description.' },
            min_duration_days: { type: 'number', minimum: 1 },
          },
          required: ['userId', 'metric', 'period', 'condition', 'min_duration_days'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.detectSustained(args); }
          catch (err) { return { error: err.message }; }
        },
      }),
```

- [ ] **Step 5: Run; tests pass.**

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs \
        tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs
git commit -m "feat(health-coach): 4 trend & detection tools

Plan 3 / Task 6. Adds metric_trajectory, detect_regime_change,
detect_anomalies, detect_sustained.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: cli/commands/health.mjs — add 4 actions

**Files:**
- Modify: `cli/commands/health.mjs`
- Modify: `tests/unit/cli/commands/health.test.mjs`

- [ ] **Step 1: Append tests**

```javascript
  describe('trajectory action', () => {
    it('emits JSON for `health trajectory <metric> --period <p>`', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['trajectory', 'weight_lbs'],
          flags: { period: 'last_90d', granularity: 'weekly' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            trajectory: async (args) => { captured = args; return { slope: -0.1, direction: 'down', rSquared: 0.95 }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.granularity).toBe('weekly');
    });
  });

  describe('regime-change action', () => {
    it('emits JSON for `health regime-change <metric> --period <p>`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['regime-change', 'weight_lbs'],
          flags: { period: 'last_2y', 'max-results': '5' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            detectRegimeChange: async () => ({ changes: [{ date: '2024-08-15', confidence: 0.8, magnitude: 2.5 }] }),
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.changes.length).toBe(1);
    });
  });

  describe('anomalies action', () => {
    it('emits JSON for `health anomalies <metric> --period <p>`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['anomalies', 'workout_calories'],
          flags: { period: 'last_90d' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            detectAnomalies: async () => ({ anomalies: [], count: 0 }),
          }),
        },
      );
      expect(result.exitCode).toBe(0);
    });

    it('passes z-score threshold flag', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      await health.run(
        {
          subcommand: 'health',
          positional: ['anomalies', 'weight_lbs'],
          flags: { period: 'last_90d', 'z-threshold': '3' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            detectAnomalies: async (args) => { captured = args; return { anomalies: [], count: 0 }; },
          }),
        },
      );
      expect(captured.zScore_threshold).toBe(3);
    });
  });

  describe('sustained action', () => {
    it('emits JSON for `health sustained <metric> --period <p> --condition <json> --min-duration-days <n>`', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['sustained', 'weight_lbs'],
          flags: { period: 'last_year', condition: '{"value_range":[193,197]}', 'min-duration-days': '30' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            detectSustained: async (args) => { captured = args; return { runs: [] }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.condition).toEqual({ value_range: [193, 197] });
      expect(captured.min_duration_days).toBe(30);
    });

    it('exits 2 when --min-duration-days missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['sustained', 'weight_lbs'],
          flags: { period: 'last_year', condition: '{"value_range":[193,197]}' },
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
    });
  });
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Implement the 4 new actions**

Add to `cli/commands/health.mjs`:

```javascript
async function actionTrajectory(args, deps) {
  const metric = args.positional[1];
  if (!metric) {
    deps.stderr.write('dscli health trajectory: missing required <metric>\n');
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
    result = await svc.trajectory({
      userId: resolveUserId(args),
      metric, period,
      granularity: args.flags.granularity || null,
      statistic: args.flags.statistic,
    });
  } catch (err) {
    printError(deps.stderr, { error: 'trajectory_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionRegimeChange(args, deps) {
  const metric = args.positional[1];
  if (!metric) {
    deps.stderr.write('dscli health regime-change: missing required <metric>\n');
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
    const max_results = args.flags['max-results'] ? parseInt(args.flags['max-results'], 10) : undefined;
    result = await svc.detectRegimeChange({
      userId: resolveUserId(args),
      metric, period,
      ...(max_results ? { max_results } : {}),
    });
  } catch (err) {
    printError(deps.stderr, { error: 'regime_change_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionAnomalies(args, deps) {
  const metric = args.positional[1];
  if (!metric) {
    deps.stderr.write('dscli health anomalies: missing required <metric>\n');
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
    const opts = { userId: resolveUserId(args), metric, period };
    if (args.flags['z-threshold']) opts.zScore_threshold = parseFloat(args.flags['z-threshold']);
    if (args.flags['baseline-days']) opts.baseline_window_days = parseInt(args.flags['baseline-days'], 10);
    result = await svc.detectAnomalies(opts);
  } catch (err) {
    printError(deps.stderr, { error: 'anomalies_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionSustained(args, deps) {
  const metric = args.positional[1];
  if (!metric) {
    deps.stderr.write('dscli health sustained: missing required <metric>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }
  if (!args.flags.condition) {
    printError(deps.stderr, { error: 'condition_required', message: 'pass --condition <json>.' });
    return { exitCode: EXIT_USAGE };
  }
  if (!args.flags['min-duration-days']) {
    printError(deps.stderr, { error: 'min_duration_required', message: 'pass --min-duration-days <n>.' });
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
    result = await svc.detectSustained({
      userId: resolveUserId(args),
      metric, period, condition,
      min_duration_days: parseInt(args.flags['min-duration-days'], 10),
    });
  } catch (err) {
    printError(deps.stderr, { error: 'sustained_failed', message: err.message });
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
  trajectory: actionTrajectory,
  'regime-change': actionRegimeChange,
  anomalies: actionAnomalies,
  sustained: actionSustained,
};
```

Update the `HELP` string to add the 4 new action lines and document the new flags (`--max-results`, `--z-threshold`, `--baseline-days`, `--min-duration-days`).

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add cli/commands/health.mjs tests/unit/cli/commands/health.test.mjs
git commit -m "feat(dscli): health trajectory/regime-change/anomalies/sustained

Plan 3 / Task 7. Four new actions on dscli health.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: End-to-end smoke verification

- [ ] **Step 1: Run all related tests**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs \
                 tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs \
                 tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs \
                 tests/unit/cli/commands/health.test.mjs
```

- [ ] **Step 2: `dscli health --help` shows new actions**

```bash
cd /opt/Code/DaylightStation && node cli/dscli.mjs health --help
```

Expect: `trajectory`, `regime-change`, `anomalies`, `sustained` all visible.

- [ ] **Step 3: Final empty commit (optional)**

```bash
git commit --allow-empty -m "chore(health-analytics): Plan 3 complete — trends & detection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage map

| Spec section | Task |
|---|---|
| `metric_trajectory` | 1, 5, 6, 7 |
| `detect_regime_change` | 2, 5, 6, 7 |
| `detect_anomalies` | 3, 5, 6, 7 |
| `detect_sustained` | 4, 5, 6, 7 |
