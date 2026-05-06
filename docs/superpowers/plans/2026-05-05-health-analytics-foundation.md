# Health Analytics Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the domain foundation (`PeriodResolver`, `MetricRegistry`, `MetricAggregator`, `HealthAnalyticsService`) plus the in-process tool factory and one end-to-end CLI command (`dscli health aggregate`), proving the architecture for subsequent capability plans.

**Architecture:** New domain services in `backend/src/2_domains/health/services/` are pure (no I/O of their own; they delegate to the existing `IHealthDataDatastore` and `healthService`). A new `HealthAnalyticsToolFactory` in `backend/src/3_applications/agents/health-coach/tools/` wraps service methods as agent tools and is registered alongside the existing factories in `HealthCoachAgent`. A new `cli/commands/health.mjs` adapter calls the same domain service via a `getHealthAnalytics()` factory in `cli/_bootstrap.mjs`. One transport per consumer; one set of analytics code.

**Tech Stack:** Node ESM, vitest (`tests/isolated/...` + `tests/unit/cli/...`), the `#system/*`, `#domains/*`, `#adapters/*`, `#apps/*` path aliases in `package.json`. No new runtime dependencies.

**Spec:** [docs/superpowers/specs/2026-05-05-health-coach-data-tier-design.md](../specs/2026-05-05-health-coach-data-tier-design.md). This plan implements the foundation slice: `PeriodResolver` (rolling/calendar/explicit forms only — `named:` and `deduced:` are wired to throw `not_implemented` with a clear message that points to Plan 4) plus `MetricAggregator` (`aggregate_metric`, `aggregate_series`, `metric_distribution`, `metric_percentile`, `metric_snapshot`) plus `dscli health aggregate` end-to-end.

---

## File structure

**New files:**

- `backend/src/2_domains/health/services/PeriodResolver.mjs` — pure domain service that turns the polymorphic period input into `{ from, to, label, source }`. Plan 1 handles `rolling`, `calendar`, and explicit `from/to`. `named` and `deduced` throw `Error('Period kind \"named\" not yet supported (Plan 4 — period-memory)')`.
- `backend/src/2_domains/health/services/MetricRegistry.mjs` — table of per-metric reader functions. One entry per metric (`weight_lbs`, `calories`, `protein_g`, …). Each entry declares `source: 'weight' | 'nutrition' | 'workouts'`, `read(entry)`, `unit`, and `kind: 'value' | 'count' | 'sum' | 'ratio'`.
- `backend/src/2_domains/health/services/MetricAggregator.mjs` — uses PeriodResolver + MetricRegistry + the existing `IHealthDataDatastore` and `healthService.getHealthForRange()` to compute the five aggregator operations.
- `backend/src/2_domains/health/services/HealthAnalyticsService.mjs` — composition root that exposes `aggregate / aggregateSeries / distribution / percentile / snapshot`. Plan 1 has only `MetricAggregator` wired; Plans 2–4 add `MetricComparator`, `MetricTrendAnalyzer`, `PeriodMemory`, `HistoryReflector`.
- `backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs` — wraps the 5 service methods as agent tools.
- `cli/commands/health.mjs` — Plan 1 ships only the `aggregate` action; a help banner reserves the future actions documented in the spec.
- `tests/isolated/domain/health/services/PeriodResolver.test.mjs`
- `tests/isolated/domain/health/services/MetricRegistry.test.mjs`
- `tests/isolated/domain/health/services/MetricAggregator.test.mjs`
- `tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs`
- `tests/unit/cli/commands/health.test.mjs`

**Modified files:**

- `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs` — extra `addToolFactory(new HealthAnalyticsToolFactory({ healthAnalyticsService }))` in `registerTools()`. Pulls `healthAnalyticsService` out of `this.deps`.
- `backend/src/0_system/bootstrap.mjs` — instantiate `HealthAnalyticsService` once where the other health domain services are wired (around lines 2990-3015), and add `healthAnalyticsService` to the deps bag passed to `agentOrchestrator.register(HealthCoachAgent, { ... })` (around line 3017-3034).
- `cli/_bootstrap.mjs` — add `getHealthAnalytics()` factory.
- `cli/dscli.mjs` — add `'health'` to `KNOWN_SUBCOMMANDS`; add line `'  health    Health analytics: aggregate, ...,'` to top-level help; add `getHealthAnalytics: bootstrap.getHealthAnalytics` to the deps bag.

**No persistence-layer changes.** `IHealthDataDatastore` already exposes everything needed (`loadWeightData`, `loadNutritionData`, `getHealthForRange`).

---

## Conventions

**Test framework:** vitest. CLI tests use Writable buffers + dependency-injected fakes (mirror `tests/unit/cli/commands/system.test.mjs`).

**Date handling:** UTC throughout. `'YYYY-MM-DD'` strings everywhere. The resolver and aggregator parse with `new Date(dateStr + 'T00:00:00Z')`.

**Error envelope:** every tool returns `{ ..., error?: string }` rather than throwing — matches the existing factory pattern (see `HealthToolFactory`, `LongitudinalToolFactory`).

**Commit cadence:** each task ends with one commit. Use the prefix `feat(health-analytics):` for net-new files, `feat(dscli):` for CLI changes, `refactor(health-coach):` for the agent factory wiring change.

---

## Task 1: PeriodResolver — domain service skeleton

**Files:**
- Create: `backend/src/2_domains/health/services/PeriodResolver.mjs`
- Test: `tests/isolated/domain/health/services/PeriodResolver.test.mjs`

- [ ] **Step 1: Write the test file with one failing case**

```javascript
// tests/isolated/domain/health/services/PeriodResolver.test.mjs
import { describe, it, expect } from 'vitest';
import { PeriodResolver } from '../../../../../backend/src/2_domains/health/services/PeriodResolver.mjs';

// Anchor "today" so date math is deterministic.
const NOW = new Date('2026-05-05T12:00:00Z');
const fixedNow = () => NOW;

describe('PeriodResolver', () => {
  describe('rolling', () => {
    it('resolves last_30d to a 30-day window ending today', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ rolling: 'last_30d' });
      expect(out.from).toBe('2026-04-06');
      expect(out.to).toBe('2026-05-05');
      expect(out.label).toBe('last_30d');
      expect(out.source).toBe('rolling');
    });
  });
});
```

- [ ] **Step 2: Run test; it should fail with "PeriodResolver is not defined"**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/PeriodResolver.test.mjs
```
Expected: FAIL — `Cannot find module ...PeriodResolver.mjs`.

- [ ] **Step 3: Create PeriodResolver with rolling-only support**

```javascript
// backend/src/2_domains/health/services/PeriodResolver.mjs

/**
 * Resolves polymorphic period inputs into a concrete `{ from, to, label, source }`
 * tuple. Pure domain service — no I/O.
 *
 * Plan 1 handles:
 *   { rolling: 'last_<N>d' | 'last_<N>y' | 'all_time' | 'prev_<N>d' | 'prev_<N>y' }
 *   { calendar: 'YYYY' | 'YYYY-MM' | 'YYYY-Qn' | 'this_week' | 'this_month'
 *               | 'this_quarter' | 'this_year' | 'last_quarter' | 'last_year' }
 *   { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *
 * `named` and `deduced` forms throw — they're wired in Plan 4.
 */

const MS_PER_DAY = 86400000;

export class PeriodResolver {
  /**
   * @param {object} [opts]
   * @param {() => Date} [opts.now] - injectable clock (defaults to new Date())
   */
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
  }

  /**
   * Resolve a polymorphic period input to absolute date bounds.
   *
   * @param {object} input
   * @returns {{from: string, to: string, label: string, source: 'rolling'|'calendar'|'explicit'|'named'|'deduced'}}
   */
  resolve(input) {
    if (!input || typeof input !== 'object') {
      throw new Error('PeriodResolver.resolve: input must be an object');
    }
    if (typeof input.rolling === 'string') return this.#resolveRolling(input.rolling);
    if (typeof input.calendar === 'string') return this.#resolveCalendar(input.calendar);
    if (typeof input.from === 'string' && typeof input.to === 'string') {
      return { from: input.from, to: input.to, label: `${input.from}..${input.to}`, source: 'explicit' };
    }
    if (typeof input.named === 'string') {
      throw new Error('Period kind "named" not yet supported (Plan 4 — period-memory)');
    }
    if (input.deduced) {
      throw new Error('Period kind "deduced" not yet supported (Plan 4 — period-memory)');
    }
    throw new Error('PeriodResolver.resolve: unknown period input shape');
  }

  #today() {
    const d = this.now();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  #fmt(date) {
    return date.toISOString().slice(0, 10);
  }

  #resolveRolling(label) {
    const today = this.#today();
    if (label === 'all_time') {
      return { from: '1900-01-01', to: this.#fmt(today), label, source: 'rolling' };
    }
    const m = /^(last|prev)_(\d+)([dy])$/.exec(label);
    if (!m) {
      throw new Error(`PeriodResolver: unknown rolling label "${label}"`);
    }
    const [, kind, nStr, unit] = m;
    const n = parseInt(nStr, 10);
    const days = unit === 'y' ? n * 365 : n;
    const to = new Date(today);
    const from = new Date(today);
    if (kind === 'last') {
      from.setUTCDate(today.getUTCDate() - (days - 1));
    } else { // prev
      to.setUTCDate(today.getUTCDate() - days);
      from.setUTCDate(today.getUTCDate() - (days * 2 - 1));
    }
    return { from: this.#fmt(from), to: this.#fmt(to), label, source: 'rolling' };
  }

  #resolveCalendar(label) {
    const today = this.#today();
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth(); // 0-11

    if (label === 'this_year') {
      return { from: `${year}-01-01`, to: `${year}-12-31`, label, source: 'calendar' };
    }
    if (label === 'last_year') {
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, label, source: 'calendar' };
    }
    if (label === 'this_month') {
      const last = new Date(Date.UTC(year, month + 1, 0));
      return { from: `${year}-${String(month + 1).padStart(2, '0')}-01`, to: this.#fmt(last), label, source: 'calendar' };
    }
    if (label === 'this_quarter' || label === 'last_quarter') {
      const q = Math.floor(month / 3) + (label === 'last_quarter' ? 0 : 1);
      const refYear = label === 'last_quarter' ? (q === 0 ? year - 1 : year) : year;
      const qIdx = label === 'last_quarter' ? (q === 0 ? 3 : q - 1) : q - 1; // 0..3
      const startMonth = qIdx * 3;
      const endMonth = startMonth + 2;
      const last = new Date(Date.UTC(refYear, endMonth + 1, 0));
      return {
        from: `${refYear}-${String(startMonth + 1).padStart(2, '0')}-01`,
        to: this.#fmt(last),
        label,
        source: 'calendar',
      };
    }
    if (label === 'this_week') {
      // ISO week: Mon..Sun
      const dow = today.getUTCDay() || 7; // 1..7
      const monday = new Date(today);
      monday.setUTCDate(today.getUTCDate() - (dow - 1));
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      return { from: this.#fmt(monday), to: this.#fmt(sunday), label, source: 'calendar' };
    }

    // YYYY
    let m = /^(\d{4})$/.exec(label);
    if (m) {
      const y = parseInt(m[1], 10);
      return { from: `${y}-01-01`, to: `${y}-12-31`, label, source: 'calendar' };
    }
    // YYYY-MM
    m = /^(\d{4})-(\d{2})$/.exec(label);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const last = new Date(Date.UTC(y, mo, 0));
      return { from: `${y}-${String(mo).padStart(2, '0')}-01`, to: this.#fmt(last), label, source: 'calendar' };
    }
    // YYYY-Qn
    m = /^(\d{4})-Q([1-4])$/.exec(label);
    if (m) {
      const y = parseInt(m[1], 10);
      const q = parseInt(m[2], 10);
      const startMonth = (q - 1) * 3;
      const last = new Date(Date.UTC(y, startMonth + 3, 0));
      return {
        from: `${y}-${String(startMonth + 1).padStart(2, '0')}-01`,
        to: this.#fmt(last),
        label,
        source: 'calendar',
      };
    }
    throw new Error(`PeriodResolver: unknown calendar label "${label}"`);
  }
}
```

- [ ] **Step 4: Run test; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/PeriodResolver.test.mjs
```
Expected: PASS (1 test).

- [ ] **Step 5: Add the rest of the test cases**

Append to `tests/isolated/domain/health/services/PeriodResolver.test.mjs` inside the existing top-level `describe`:

```javascript
  describe('rolling — additional', () => {
    it('resolves last_7d', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ rolling: 'last_7d' });
      expect(out.from).toBe('2026-04-29');
      expect(out.to).toBe('2026-05-05');
    });

    it('resolves last_2y as 730 days', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ rolling: 'last_2y' });
      expect(out.to).toBe('2026-05-05');
      // 2y = 730 days; from = today - 729
      expect(out.from).toBe('2024-05-06');
    });

    it('resolves all_time with from=1900-01-01', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ rolling: 'all_time' });
      expect(out.from).toBe('1900-01-01');
      expect(out.to).toBe('2026-05-05');
      expect(out.label).toBe('all_time');
    });

    it('resolves prev_30d as the 30 days adjacent to last_30d', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ rolling: 'prev_30d' });
      // last_30d is 2026-04-06..2026-05-05; prev_30d is 2026-03-07..2026-04-05
      expect(out.from).toBe('2026-03-07');
      expect(out.to).toBe('2026-04-05');
    });

    it('throws on unknown rolling label', () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect(() => r.resolve({ rolling: 'forever' })).toThrow(/unknown rolling label/);
    });
  });

  describe('calendar', () => {
    it('resolves YYYY', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ calendar: '2024' });
      expect(out.from).toBe('2024-01-01');
      expect(out.to).toBe('2024-12-31');
      expect(out.source).toBe('calendar');
    });

    it('resolves YYYY-MM with correct end-of-month', () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect(r.resolve({ calendar: '2024-02' }).to).toBe('2024-02-29'); // leap year
      expect(r.resolve({ calendar: '2025-02' }).to).toBe('2025-02-28');
      expect(r.resolve({ calendar: '2024-04' }).to).toBe('2024-04-30');
    });

    it('resolves YYYY-Qn', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const q3 = r.resolve({ calendar: '2024-Q3' });
      expect(q3.from).toBe('2024-07-01');
      expect(q3.to).toBe('2024-09-30');
    });

    it('resolves this_year', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ calendar: 'this_year' });
      expect(out.from).toBe('2026-01-01');
      expect(out.to).toBe('2026-12-31');
    });

    it('resolves this_month', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ calendar: 'this_month' });
      expect(out.from).toBe('2026-05-01');
      expect(out.to).toBe('2026-05-31');
    });

    it('resolves this_quarter (today=May = Q2)', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ calendar: 'this_quarter' });
      expect(out.from).toBe('2026-04-01');
      expect(out.to).toBe('2026-06-30');
    });

    it('resolves last_quarter (today=May = Q2; last=Q1)', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ calendar: 'last_quarter' });
      expect(out.from).toBe('2026-01-01');
      expect(out.to).toBe('2026-03-31');
    });

    it('resolves this_week (Mon..Sun)', () => {
      // 2026-05-05 is a Tuesday (verified externally); week starts 2026-05-04 Mon, ends 2026-05-10 Sun
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ calendar: 'this_week' });
      expect(out.from).toBe('2026-05-04');
      expect(out.to).toBe('2026-05-10');
    });

    it('throws on unknown calendar label', () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect(() => r.resolve({ calendar: 'someday' })).toThrow(/unknown calendar label/);
    });
  });

  describe('explicit', () => {
    it('passes through from/to', () => {
      const r = new PeriodResolver({ now: fixedNow });
      const out = r.resolve({ from: '2024-01-15', to: '2024-02-10' });
      expect(out.from).toBe('2024-01-15');
      expect(out.to).toBe('2024-02-10');
      expect(out.source).toBe('explicit');
      expect(out.label).toBe('2024-01-15..2024-02-10');
    });
  });

  describe('not-yet-supported', () => {
    it('throws on { named: ... } with a Plan-4 hint', () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect(() => r.resolve({ named: '2017 Cut' })).toThrow(/Plan 4/);
    });

    it('throws on { deduced: ... } with a Plan-4 hint', () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect(() => r.resolve({ deduced: { criteria: {} } })).toThrow(/Plan 4/);
    });

    it('throws on null input', () => {
      const r = new PeriodResolver({ now: fixedNow });
      expect(() => r.resolve(null)).toThrow();
    });
  });
```

- [ ] **Step 6: Run all tests; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/PeriodResolver.test.mjs
```
Expected: PASS — all tests green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/2_domains/health/services/PeriodResolver.mjs \
        tests/isolated/domain/health/services/PeriodResolver.test.mjs
git commit -m "$(cat <<'EOF'
feat(health-analytics): PeriodResolver — rolling/calendar/explicit forms

Plan 1 / Task 1. Pure domain service that turns polymorphic period input
into { from, to, label, source }. Named and deduced forms throw with a
Plan-4 hint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: MetricRegistry — per-metric reader table

**Files:**
- Create: `backend/src/2_domains/health/services/MetricRegistry.mjs`
- Test: `tests/isolated/domain/health/services/MetricRegistry.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/health/services/MetricRegistry.test.mjs
import { describe, it, expect } from 'vitest';
import { MetricRegistry } from '../../../../../backend/src/2_domains/health/services/MetricRegistry.mjs';

describe('MetricRegistry', () => {
  describe('weight metrics', () => {
    it('weight_lbs prefers lbs_adjusted_average over lbs', () => {
      const m = MetricRegistry.get('weight_lbs');
      expect(m.read({ lbs: 200, lbs_adjusted_average: 198 })).toBe(198);
      expect(m.read({ lbs: 200 })).toBe(200);
      expect(m.read({})).toBe(null);
      expect(m.source).toBe('weight');
      expect(m.unit).toBe('lbs');
      expect(m.kind).toBe('value');
    });

    it('fat_percent prefers fat_percent_average over fat_percent', () => {
      const m = MetricRegistry.get('fat_percent');
      expect(m.read({ fat_percent: 20, fat_percent_average: 19 })).toBe(19);
      expect(m.read({ fat_percent: 20 })).toBe(20);
      expect(m.read({})).toBe(null);
      expect(m.source).toBe('weight');
    });
  });

  describe('nutrition metrics', () => {
    it('calories reads .calories', () => {
      const m = MetricRegistry.get('calories');
      expect(m.read({ calories: 2100 })).toBe(2100);
      expect(m.read({})).toBe(null);
      expect(m.source).toBe('nutrition');
    });

    it('protein_g reads .protein', () => {
      expect(MetricRegistry.get('protein_g').read({ protein: 150 })).toBe(150);
    });
    it('carbs_g reads .carbs', () => {
      expect(MetricRegistry.get('carbs_g').read({ carbs: 200 })).toBe(200);
    });
    it('fat_g reads .fat', () => {
      expect(MetricRegistry.get('fat_g').read({ fat: 70 })).toBe(70);
    });
    it('fiber_g reads .fiber', () => {
      expect(MetricRegistry.get('fiber_g').read({ fiber: 30 })).toBe(30);
    });
  });

  describe('workout metrics', () => {
    it('workout_count counts entries', () => {
      const m = MetricRegistry.get('workout_count');
      expect(m.kind).toBe('count');
      expect(m.source).toBe('workouts');
      expect(m.read([{}, {}, {}])).toBe(3);
      expect(m.read([])).toBe(0);
      expect(m.read(undefined)).toBe(0);
    });

    it('workout_duration_min sums duration', () => {
      const m = MetricRegistry.get('workout_duration_min');
      expect(m.kind).toBe('sum');
      expect(m.read([{ duration: 30 }, { duration: 45 }])).toBe(75);
      expect(m.read([{ duration: 30 }, {}])).toBe(30);
      expect(m.read([])).toBe(0);
    });

    it('workout_calories sums calories', () => {
      const m = MetricRegistry.get('workout_calories');
      expect(m.read([{ calories: 200 }, { calories: 150 }])).toBe(350);
    });
  });

  describe('density metrics', () => {
    it('tracking_density returns 1 when calories logged, 0 when not', () => {
      const m = MetricRegistry.get('tracking_density');
      expect(m.kind).toBe('ratio');
      expect(m.source).toBe('nutrition');
      expect(m.read({ calories: 1800 })).toBe(1);
      expect(m.read({ calories: 0 })).toBe(0);
      expect(m.read({})).toBe(0);
      expect(m.read(null)).toBe(0);
    });
  });

  describe('list and unknown', () => {
    it('list() returns all known metric names', () => {
      const names = MetricRegistry.list();
      expect(names).toContain('weight_lbs');
      expect(names).toContain('calories');
      expect(names).toContain('workout_count');
      expect(names).toContain('tracking_density');
    });

    it('get() throws on unknown metric', () => {
      expect(() => MetricRegistry.get('does_not_exist')).toThrow(/unknown metric/);
    });
  });
});
```

- [ ] **Step 2: Run test; FAIL with "MetricRegistry not defined"**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricRegistry.test.mjs
```

- [ ] **Step 3: Implement MetricRegistry**

```javascript
// backend/src/2_domains/health/services/MetricRegistry.mjs

/**
 * Per-metric reader table. Each entry says where the metric lives in the
 * underlying datastore, how to extract a value from one row, and what kind
 * of aggregation makes sense by default.
 *
 * Sources:
 *   'weight'    — entries from healthStore.loadWeightData(userId)[date]
 *   'nutrition' — entries from healthStore.loadNutritionData(userId)[date]
 *   'workouts'  — array of workouts from healthService.getHealthForRange(...)[date].workouts
 *
 * Kinds:
 *   'value' — numeric daily value (weight, fat%); aggregated as mean by default
 *   'count' — read returns the count from a workout array; aggregated as sum
 *   'sum'   — read returns a per-day sum from a workout array; aggregated as sum
 *   'ratio' — read returns 0 or 1; aggregated as count(1) / daysInPeriod
 */

const REGISTRY = Object.freeze({
  // ---------- weight (per-day numeric) ----------
  weight_lbs: {
    source: 'weight',
    unit: 'lbs',
    kind: 'value',
    read: (entry) => entry?.lbs_adjusted_average ?? entry?.lbs ?? null,
  },
  fat_percent: {
    source: 'weight',
    unit: '%',
    kind: 'value',
    read: (entry) => entry?.fat_percent_average ?? entry?.fat_percent ?? null,
  },

  // ---------- nutrition (per-day numeric) ----------
  calories:  { source: 'nutrition', unit: 'kcal', kind: 'value', read: (e) => e?.calories ?? null },
  protein_g: { source: 'nutrition', unit: 'g',    kind: 'value', read: (e) => e?.protein  ?? null },
  carbs_g:   { source: 'nutrition', unit: 'g',    kind: 'value', read: (e) => e?.carbs    ?? null },
  fat_g:     { source: 'nutrition', unit: 'g',    kind: 'value', read: (e) => e?.fat      ?? null },
  fiber_g:   { source: 'nutrition', unit: 'g',    kind: 'value', read: (e) => e?.fiber    ?? null },

  // ---------- workouts (per-day rollups) ----------
  workout_count: {
    source: 'workouts',
    unit: 'workouts',
    kind: 'count',
    read: (workouts) => Array.isArray(workouts) ? workouts.length : 0,
  },
  workout_duration_min: {
    source: 'workouts',
    unit: 'min',
    kind: 'sum',
    read: (workouts) => Array.isArray(workouts)
      ? workouts.reduce((s, w) => s + (typeof w?.duration === 'number' ? w.duration : 0), 0)
      : 0,
  },
  workout_calories: {
    source: 'workouts',
    unit: 'kcal',
    kind: 'sum',
    read: (workouts) => Array.isArray(workouts)
      ? workouts.reduce((s, w) => s + (typeof w?.calories === 'number' ? w.calories : 0), 0)
      : 0,
  },

  // ---------- density (presence-only) ----------
  tracking_density: {
    source: 'nutrition',
    unit: 'ratio',
    kind: 'ratio',
    // 1 when nutrition was logged that day (calories > 0), 0 otherwise.
    read: (entry) => (entry && typeof entry.calories === 'number' && entry.calories > 0) ? 1 : 0,
  },
});

export const MetricRegistry = Object.freeze({
  get(name) {
    const entry = REGISTRY[name];
    if (!entry) throw new Error(`MetricRegistry: unknown metric "${name}"`);
    return entry;
  },
  list() {
    return Object.keys(REGISTRY);
  },
});

export default MetricRegistry;
```

- [ ] **Step 4: Run tests; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricRegistry.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricRegistry.mjs \
        tests/isolated/domain/health/services/MetricRegistry.test.mjs
git commit -m "$(cat <<'EOF'
feat(health-analytics): MetricRegistry — per-metric reader table

11 metrics across weight, nutrition, workouts, and density. Pure
declaration; no I/O.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: MetricAggregator — `aggregate` (single-value)

**Files:**
- Create: `backend/src/2_domains/health/services/MetricAggregator.mjs`
- Test: `tests/isolated/domain/health/services/MetricAggregator.test.mjs`

This task implements the `aggregate({ userId, metric, period, statistic })` method. Subsequent tasks (4-7) extend the same class.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/health/services/MetricAggregator.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { MetricAggregator } from '../../../../../backend/src/2_domains/health/services/MetricAggregator.mjs';
import { PeriodResolver } from '../../../../../backend/src/2_domains/health/services/PeriodResolver.mjs';

const NOW = new Date('2026-05-05T12:00:00Z');
const fixedNow = () => NOW;

// Fixture: 7 consecutive days of weight, with a small drift.
const WEIGHT_FIXTURE = {
  '2026-04-29': { date: '2026-04-29', lbs: 200, lbs_adjusted_average: 199.5, fat_percent: 20, fat_percent_average: 19.8 },
  '2026-04-30': { date: '2026-04-30', lbs: 199.5, lbs_adjusted_average: 199.0, fat_percent: 20, fat_percent_average: 19.7 },
  '2026-05-01': { date: '2026-05-01', lbs: 199, lbs_adjusted_average: 198.5, fat_percent: 19.5, fat_percent_average: 19.6 },
  '2026-05-02': { date: '2026-05-02', lbs: 198.5, lbs_adjusted_average: 198.0, fat_percent: 19.5, fat_percent_average: 19.5 },
  '2026-05-03': { date: '2026-05-03', lbs: 198, lbs_adjusted_average: 197.5, fat_percent: 19.0, fat_percent_average: 19.4 },
  '2026-05-04': { date: '2026-05-04', lbs: 197.5, lbs_adjusted_average: 197.0, fat_percent: 19.0, fat_percent_average: 19.3 },
  '2026-05-05': { date: '2026-05-05', lbs: 197, lbs_adjusted_average: 196.5, fat_percent: 18.5, fat_percent_average: 19.2 },
};

const NUTRITION_FIXTURE = {
  '2026-04-29': { calories: 2100, protein: 150 },
  '2026-04-30': { calories: 2200, protein: 145 },
  '2026-05-01': { calories: 2050, protein: 160 },
  // 2026-05-02 missing — untracked
  '2026-05-03': { calories: 2150, protein: 155 },
  '2026-05-04': { calories: 2000, protein: 140 },
  '2026-05-05': { calories: 2080, protein: 152 },
};

function makeAggregator(overrides = {}) {
  const healthStore = {
    loadWeightData: vi.fn(async () => WEIGHT_FIXTURE),
    loadNutritionData: vi.fn(async () => NUTRITION_FIXTURE),
    ...overrides,
  };
  const healthService = {
    getHealthForRange: vi.fn(async () => ({})), // empty workouts unless overridden
    ...overrides,
  };
  const resolver = new PeriodResolver({ now: fixedNow });
  return { aggregator: new MetricAggregator({ healthStore, healthService, periodResolver: resolver }), healthStore, healthService };
}

describe('MetricAggregator.aggregate', () => {
  it('mean weight_lbs over last_7d', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.aggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
    });
    expect(out.metric).toBe('weight_lbs');
    expect(out.unit).toBe('lbs');
    expect(out.statistic).toBe('mean');
    expect(out.daysCovered).toBe(7);
    expect(out.daysInPeriod).toBe(7);
    expect(out.value).toBeCloseTo((199.5 + 199 + 198.5 + 198 + 197.5 + 197 + 196.5) / 7, 6);
  });

  it('median weight_lbs over last_7d', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.aggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
      statistic: 'median',
    });
    expect(out.value).toBe(198);
  });

  it('min and max', async () => {
    const { aggregator } = makeAggregator();
    const min = await aggregator.aggregate({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, statistic: 'min' });
    const max = await aggregator.aggregate({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, statistic: 'max' });
    expect(min.value).toBe(196.5);
    expect(max.value).toBe(199.5);
  });

  it('count of nutrition logged days (via tracking_density kind=ratio)', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.aggregate({
      userId: 'kc',
      metric: 'tracking_density',
      period: { rolling: 'last_7d' },
    });
    // 6 of 7 days logged
    expect(out.daysCovered).toBe(6);
    expect(out.daysInPeriod).toBe(7);
    expect(out.value).toBeCloseTo(6 / 7, 6);
    expect(out.unit).toBe('ratio');
  });

  it('returns null value when no covered days', async () => {
    const { aggregator } = makeAggregator({ loadWeightData: async () => ({}) });
    const out = await aggregator.aggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
    });
    expect(out.value).toBe(null);
    expect(out.daysCovered).toBe(0);
    expect(out.daysInPeriod).toBe(7);
  });

  it('throws on unknown metric', async () => {
    const { aggregator } = makeAggregator();
    await expect(aggregator.aggregate({ userId: 'kc', metric: 'nope', period: { rolling: 'last_7d' } }))
      .rejects.toThrow(/unknown metric/);
  });

  it('throws on unknown statistic', async () => {
    const { aggregator } = makeAggregator();
    await expect(aggregator.aggregate({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, statistic: 'mode' }))
      .rejects.toThrow(/unknown statistic/);
  });

  it('count statistic returns covered-day count even for value-kind metric', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.aggregate({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
      statistic: 'count',
    });
    expect(out.value).toBe(7);
  });

  it('sum statistic for value-kind metric (calories) totals across logged days', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.aggregate({
      userId: 'kc',
      metric: 'calories',
      period: { rolling: 'last_7d' },
      statistic: 'sum',
    });
    expect(out.value).toBe(2100 + 2200 + 2050 + 2150 + 2000 + 2080); // 12580
    expect(out.daysCovered).toBe(6);
  });
});
```

- [ ] **Step 2: Run; FAIL with "MetricAggregator not defined"**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricAggregator.test.mjs
```

- [ ] **Step 3: Create MetricAggregator with the `aggregate` method only**

```javascript
// backend/src/2_domains/health/services/MetricAggregator.mjs

import { MetricRegistry } from './MetricRegistry.mjs';

const STATS = ['mean', 'median', 'min', 'max', 'count', 'sum', 'p25', 'p75', 'stdev'];

/**
 * Five operations for aggregating per-day metric data over a period:
 *   - aggregate({ userId, metric, period, statistic? }) → single value
 *   - aggregateSeries (Task 4)
 *   - distribution    (Task 5)
 *   - percentile      (Task 6)
 *   - snapshot        (Task 7)
 *
 * Pulls daily values via the existing IHealthDataDatastore (weight + nutrition)
 * and via healthService.getHealthForRange() (workouts). PeriodResolver turns
 * the polymorphic period input into [from, to].
 *
 * @typedef {object} MetricAggregatorDeps
 * @property {object} healthStore    - IHealthDataDatastore
 * @property {object} healthService  - exposes getHealthForRange(userId, from, to)
 * @property {object} periodResolver - PeriodResolver instance
 */
export class MetricAggregator {
  /** @param {MetricAggregatorDeps} deps */
  constructor(deps) {
    if (!deps?.healthStore) throw new Error('MetricAggregator requires healthStore');
    if (!deps?.healthService) throw new Error('MetricAggregator requires healthService');
    if (!deps?.periodResolver) throw new Error('MetricAggregator requires periodResolver');
    this.healthStore = deps.healthStore;
    this.healthService = deps.healthService;
    this.periodResolver = deps.periodResolver;
  }

  /**
   * Compute a single statistic for a metric over a period.
   *
   * @returns {Promise<{
   *   metric: string, period: object, statistic: string,
   *   value: number|null, unit: string,
   *   daysCovered: number, daysInPeriod: number
   * }>}
   */
  async aggregate({ userId, metric, period, statistic = 'mean' }) {
    const reg = MetricRegistry.get(metric);  // throws on unknown
    if (!STATS.includes(statistic)) {
      throw new Error(`MetricAggregator: unknown statistic "${statistic}"`);
    }
    const resolved = this.periodResolver.resolve(period);
    const daysInPeriod = daysBetweenInclusive(resolved.from, resolved.to);

    const { values, daysCovered } = await this.#collectValues({ userId, reg, from: resolved.from, to: resolved.to });

    let value;
    if (reg.kind === 'ratio') {
      // For ratio metrics (e.g. tracking_density), `values` contains 0s and
      // 1s (read returns 1 for tracked days, 0 for untracked-but-present
      // entries). The headline value is matched / daysInPeriod, NOT
      // mean(values) — the latter would double-count by ignoring days with
      // no entry at all. `statistic` is ignored on ratio metrics.
      const matched = values.filter(v => v === 1).length;
      value = daysInPeriod > 0 ? matched / daysInPeriod : null;
    } else if (statistic === 'count') {
      value = daysCovered;
    } else if (values.length === 0) {
      value = null;
    } else {
      value = computeStatistic(values, statistic);
    }

    return {
      metric,
      period: resolved,
      statistic,
      value,
      unit: reg.unit,
      daysCovered,
      daysInPeriod,
    };
  }

  /**
   * Pull the raw per-day numeric values for a metric over [from, to].
   * Returns the values array (only the days that produced a numeric reading)
   * plus a daysCovered count. For ratio kind, "covered" is days where
   * read() returned 1.
   *
   * @returns {Promise<{ values: number[], daysCovered: number }>}
   */
  async #collectValues({ userId, reg, from, to }) {
    if (reg.source === 'weight') {
      const data = await this.healthStore.loadWeightData(userId);
      return collectFromKeyedRows(data, from, to, reg.read);
    }
    if (reg.source === 'nutrition') {
      const data = await this.healthStore.loadNutritionData(userId);
      return collectFromKeyedRows(data, from, to, reg.read);
    }
    if (reg.source === 'workouts') {
      const range = await this.healthService.getHealthForRange(userId, from, to);
      const values = [];
      let daysCovered = 0;
      for (const [date, metricEntry] of Object.entries(range || {})) {
        if (date < from || date > to) continue;
        const v = reg.read(metricEntry?.workouts);
        if (typeof v === 'number' && Number.isFinite(v)) {
          values.push(v);
          if (v > 0) daysCovered++;  // a "covered" workout day is one with at least one workout
        }
      }
      return { values, daysCovered };
    }
    throw new Error(`MetricAggregator: unknown metric source "${reg.source}"`);
  }
}

// ---------- helpers ----------

function collectFromKeyedRows(data, from, to, readFn) {
  const values = [];
  let daysCovered = 0;
  for (const [date, entry] of Object.entries(data || {})) {
    if (date < from || date > to) continue;
    const v = readFn(entry);
    if (typeof v === 'number' && Number.isFinite(v)) {
      values.push(v);
      if (v > 0 || (v === 0 && readFn === undefined)) {
        // Currently only ratio readers return 0 for "absent". The values
        // array only includes finite numbers. For ratio metrics the count of
        // 1-readings IS daysCovered.
      }
      daysCovered++;
    }
  }
  return { values, daysCovered };
}

function daysBetweenInclusive(from, to) {
  const f = new Date(from + 'T00:00:00Z');
  const t = new Date(to + 'T00:00:00Z');
  return Math.round((t - f) / 86400000) + 1;
}

function computeStatistic(values, stat) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (stat === 'mean') return sorted.reduce((s, v) => s + v, 0) / n;
  if (stat === 'sum')  return sorted.reduce((s, v) => s + v, 0);
  if (stat === 'min')  return sorted[0];
  if (stat === 'max')  return sorted[n - 1];
  if (stat === 'median') return percentileFromSorted(sorted, 0.5);
  if (stat === 'p25')    return percentileFromSorted(sorted, 0.25);
  if (stat === 'p75')    return percentileFromSorted(sorted, 0.75);
  if (stat === 'stdev') {
    const mean = sorted.reduce((s, v) => s + v, 0) / n;
    const variance = sorted.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
    return Math.sqrt(variance);
  }
  throw new Error(`computeStatistic: unhandled statistic "${stat}"`);
}

function percentileFromSorted(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Exports for unit tests of helpers if they grow.
export { computeStatistic, percentileFromSorted };
```

**Why the ratio branch counts `values.filter(v => v === 1)` instead of using `daysCovered`:** For `tracking_density`, `read()` returns 1 for tracked days and 0 for untracked-but-present entries. `collectFromKeyedRows` pushes BOTH 1 and 0 into `values` (both are finite numbers). So `daysCovered` counts entries-of-any-shape and `values.filter(v => v === 1).length` counts only the actually-tracked days. The aggregator's headline ratio is `matched / daysInPeriod`, which gives "tracked days / total days in window" regardless of how the data is shaped.

- [ ] **Step 4: Run tests; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricAggregator.test.mjs
```
Expected: PASS — 9 tests in describe('MetricAggregator.aggregate').

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricAggregator.mjs \
        tests/isolated/domain/health/services/MetricAggregator.test.mjs
git commit -m "$(cat <<'EOF'
feat(health-analytics): MetricAggregator.aggregate — single-value op

Plan 1 / Task 3. Mean/median/min/max/count/sum/p25/p75/stdev over a
PeriodResolver-resolved window for any registered metric. Ratio metrics
(tracking_density) compute matched/daysInPeriod.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: MetricAggregator — `aggregateSeries` (bucketed)

**Files:**
- Modify: `backend/src/2_domains/health/services/MetricAggregator.mjs`
- Modify: `tests/isolated/domain/health/services/MetricAggregator.test.mjs`

- [ ] **Step 1: Append failing test cases**

Add a new `describe` block to the existing test file:

```javascript
describe('MetricAggregator.aggregateSeries', () => {
  it('weekly buckets for weight_lbs over a 4-week period', async () => {
    // 28-day fixture, 4 ISO weeks. Use the same weight fixture pattern.
    const data = {};
    let lbs = 200;
    const start = new Date(Date.UTC(2026, 3, 6)); // Mon 2026-04-06
    for (let i = 0; i < 28; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      data[date] = { date, lbs, lbs_adjusted_average: lbs };
      lbs -= 0.1;
    }
    const { aggregator } = (() => {
      const healthStore = { loadWeightData: vi.fn(async () => data), loadNutritionData: vi.fn(async () => ({})) };
      const healthService = { getHealthForRange: vi.fn(async () => ({})) };
      const resolver = new PeriodResolver({ now: fixedNow });
      return { aggregator: new MetricAggregator({ healthStore, healthService, periodResolver: resolver }) };
    })();

    const out = await aggregator.aggregateSeries({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-03' },
      granularity: 'weekly',
    });
    expect(out.granularity).toBe('weekly');
    expect(out.buckets).toHaveLength(4);
    // Each bucket has 7 days, mean is the midpoint of its 7-value run
    expect(out.buckets[0].count).toBe(7);
    expect(out.buckets[0].value).toBeCloseTo(200 - 0.3, 5); // mean of lbs..lbs-0.6
  });

  it('monthly buckets for weight_lbs over Q1-2024', async () => {
    const data = {};
    // Synthesize one entry on the 15th of Jan, Feb, Mar 2024.
    data['2024-01-15'] = { lbs: 200, lbs_adjusted_average: 200 };
    data['2024-02-15'] = { lbs: 201, lbs_adjusted_average: 201 };
    data['2024-03-15'] = { lbs: 202, lbs_adjusted_average: 202 };
    const healthStore = { loadWeightData: vi.fn(async () => data), loadNutritionData: vi.fn(async () => ({})) };
    const healthService = { getHealthForRange: vi.fn(async () => ({})) };
    const resolver = new PeriodResolver({ now: fixedNow });
    const aggregator = new MetricAggregator({ healthStore, healthService, periodResolver: resolver });

    const out = await aggregator.aggregateSeries({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { calendar: '2024-Q1' },
      granularity: 'monthly',
    });
    expect(out.buckets).toHaveLength(3);
    expect(out.buckets[0]).toMatchObject({ period: '2024-01', value: 200, count: 1 });
    expect(out.buckets[1]).toMatchObject({ period: '2024-02', value: 201, count: 1 });
    expect(out.buckets[2]).toMatchObject({ period: '2024-03', value: 202, count: 1 });
  });

  it('throws on unknown granularity', async () => {
    const { aggregator } = makeAggregator();
    await expect(aggregator.aggregateSeries({
      userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, granularity: 'fortnightly',
    })).rejects.toThrow(/unknown granularity/);
  });
});
```

- [ ] **Step 2: Run; should FAIL with "aggregator.aggregateSeries is not a function"**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricAggregator.test.mjs
```

- [ ] **Step 3: Add `aggregateSeries` method**

In `backend/src/2_domains/health/services/MetricAggregator.mjs`, add a class method (above the helpers):

```javascript
  /**
   * Bucketed series — same metric/statistic semantics as `aggregate`, but
   * returns one row per bucket. Granularity: daily | weekly | monthly |
   * quarterly | yearly.
   */
  async aggregateSeries({ userId, metric, period, granularity, statistic = 'mean' }) {
    const reg = MetricRegistry.get(metric);
    if (!STATS.includes(statistic)) throw new Error(`MetricAggregator: unknown statistic "${statistic}"`);
    if (!['daily','weekly','monthly','quarterly','yearly'].includes(granularity)) {
      throw new Error(`MetricAggregator: unknown granularity "${granularity}"`);
    }
    const resolved = this.periodResolver.resolve(period);
    const dailyRows = await this.#collectDailyRows({ userId, reg, from: resolved.from, to: resolved.to });

    // Group by bucket key.
    const bucketKey = bucketKeyFn(granularity);
    const buckets = new Map();
    for (const row of dailyRows) {
      const key = bucketKey(row.date);
      if (!buckets.has(key)) buckets.set(key, { period: key, values: [] });
      buckets.get(key).values.push(row.value);
    }

    const out = [...buckets.values()]
      .sort((a, b) => a.period.localeCompare(b.period))
      .map(b => {
        let value;
        if (reg.kind === 'ratio') {
          const matched = b.values.filter(v => v === 1).length;
          value = matched / b.values.length;
        } else if (statistic === 'count') {
          value = b.values.length;
        } else {
          value = computeStatistic(b.values, statistic);
        }
        return { period: b.period, value, count: b.values.length };
      });

    return { metric, period: resolved, granularity, statistic, unit: reg.unit, buckets: out };
  }

  /**
   * Internal: like #collectValues, but returns per-row { date, value } so the
   * caller can group them by bucket key. Mirrors the same source dispatch.
   */
  async #collectDailyRows({ userId, reg, from, to }) {
    const rows = [];
    if (reg.source === 'weight') {
      const data = await this.healthStore.loadWeightData(userId);
      for (const [date, entry] of Object.entries(data || {})) {
        if (date < from || date > to) continue;
        const v = reg.read(entry);
        if (typeof v === 'number' && Number.isFinite(v)) rows.push({ date, value: v });
      }
    } else if (reg.source === 'nutrition') {
      const data = await this.healthStore.loadNutritionData(userId);
      for (const [date, entry] of Object.entries(data || {})) {
        if (date < from || date > to) continue;
        const v = reg.read(entry);
        if (typeof v === 'number' && Number.isFinite(v)) rows.push({ date, value: v });
      }
    } else if (reg.source === 'workouts') {
      const range = await this.healthService.getHealthForRange(userId, from, to);
      for (const [date, metricEntry] of Object.entries(range || {})) {
        if (date < from || date > to) continue;
        const v = reg.read(metricEntry?.workouts);
        if (typeof v === 'number' && Number.isFinite(v)) rows.push({ date, value: v });
      }
    }
    return rows;
  }
```

Add the bucket-key helper at the bottom of the file:

```javascript
function bucketKeyFn(granularity) {
  if (granularity === 'daily')     return (d) => d;
  if (granularity === 'monthly')   return (d) => d.slice(0, 7);
  if (granularity === 'yearly')    return (d) => d.slice(0, 4);
  if (granularity === 'quarterly') return (d) => {
    const m = parseInt(d.slice(5, 7), 10);
    return `${d.slice(0, 4)}-Q${Math.ceil(m / 3)}`;
  };
  // weekly: ISO week
  return (d) => {
    const [y, m, day] = d.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, day));
    const dow = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dow);
    const isoYear = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 4));
    const ysDow = yearStart.getUTCDay() || 7;
    yearStart.setUTCDate(yearStart.getUTCDate() + 4 - ysDow);
    const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
    return `${isoYear}-W${String(week).padStart(2, '0')}`;
  };
}
```

- [ ] **Step 4: Run tests; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricAggregator.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricAggregator.mjs \
        tests/isolated/domain/health/services/MetricAggregator.test.mjs
git commit -m "$(cat <<'EOF'
feat(health-analytics): MetricAggregator.aggregateSeries — bucketed

Plan 1 / Task 4. Daily/weekly/monthly/quarterly/yearly bucketing of any
registered metric over a resolved period.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: MetricAggregator — `distribution`

**Files:**
- Modify: `backend/src/2_domains/health/services/MetricAggregator.mjs`
- Modify: `tests/isolated/domain/health/services/MetricAggregator.test.mjs`

- [ ] **Step 1: Append failing test cases**

```javascript
describe('MetricAggregator.distribution', () => {
  it('returns count, min/max, mean, median, stdev, and quartiles', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.distribution({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
    });
    expect(out.count).toBe(7);
    expect(out.min).toBe(196.5);
    expect(out.max).toBe(199.5);
    expect(out.median).toBe(198);
    expect(out.quartiles.p25).toBeCloseTo(197.25, 5);
    expect(out.quartiles.p75).toBeCloseTo(198.75, 5);
    expect(out.mean).toBeCloseTo(198, 5);
    expect(typeof out.stdev).toBe('number');
  });

  it('returns histogram when bins provided', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.distribution({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
      bins: 3,
    });
    expect(out.histogram).toHaveLength(3);
    const totalCount = out.histogram.reduce((s, b) => s + b.count, 0);
    expect(totalCount).toBe(7);
  });

  it('returns null stats when no data', async () => {
    const { aggregator } = makeAggregator({ loadWeightData: async () => ({}) });
    const out = await aggregator.distribution({
      userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' },
    });
    expect(out.count).toBe(0);
    expect(out.min).toBe(null);
    expect(out.max).toBe(null);
    expect(out.median).toBe(null);
  });
});
```

- [ ] **Step 2: Run; FAIL with "distribution is not a function"**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricAggregator.test.mjs
```

- [ ] **Step 3: Add `distribution` method**

Add to the `MetricAggregator` class:

```javascript
  async distribution({ userId, metric, period, bins = null }) {
    const reg = MetricRegistry.get(metric);
    const resolved = this.periodResolver.resolve(period);
    const rows = await this.#collectDailyRows({ userId, reg, from: resolved.from, to: resolved.to });
    const values = rows.map(r => r.value);
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;

    const out = {
      metric,
      period: resolved,
      unit: reg.unit,
      count: n,
      min: n ? sorted[0] : null,
      max: n ? sorted[n - 1] : null,
      mean: n ? sorted.reduce((s, v) => s + v, 0) / n : null,
      median: n ? percentileFromSorted(sorted, 0.5) : null,
      stdev: n ? computeStatistic(values, 'stdev') : null,
      quartiles: {
        p25: n ? percentileFromSorted(sorted, 0.25) : null,
        p50: n ? percentileFromSorted(sorted, 0.5)  : null,
        p75: n ? percentileFromSorted(sorted, 0.75) : null,
      },
    };

    if (typeof bins === 'number' && bins >= 1 && n > 0) {
      const lo = sorted[0];
      const hi = sorted[n - 1];
      const span = hi - lo || 1; // avoid divide-by-zero on degenerate distributions
      const histogram = [];
      for (let i = 0; i < bins; i++) {
        const binStart = lo + (span * i) / bins;
        const binEnd = lo + (span * (i + 1)) / bins;
        const isLast = i === bins - 1;
        const count = sorted.filter(v => v >= binStart && (isLast ? v <= binEnd : v < binEnd)).length;
        histogram.push({ binStart, binEnd, count });
      }
      out.histogram = histogram;
    }

    return out;
  }
```

- [ ] **Step 4: Run tests; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricAggregator.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricAggregator.mjs \
        tests/isolated/domain/health/services/MetricAggregator.test.mjs
git commit -m "feat(health-analytics): MetricAggregator.distribution + histogram

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: MetricAggregator — `percentile`

**Files:**
- Modify: `backend/src/2_domains/health/services/MetricAggregator.mjs`
- Modify: `tests/isolated/domain/health/services/MetricAggregator.test.mjs`

- [ ] **Step 1: Append failing test cases**

```javascript
describe('MetricAggregator.percentile', () => {
  it('finds the percentile rank of a value within a period', async () => {
    const { aggregator } = makeAggregator();
    // The 7-day weight values are 199.5, 199, 198.5, 198, 197.5, 197, 196.5
    const out = await aggregator.percentile({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_7d' },
      value: 198,
    });
    expect(out.metric).toBe('weight_lbs');
    expect(out.value).toBe(198);
    expect(out.rank).toBe(4); // 4th smallest in ascending sort
    expect(out.total).toBe(7);
    expect(out.percentile).toBeCloseTo(50, 5); // (4-1)/(7-1) * 100 = 50
  });

  it('classifies extreme values', async () => {
    const { aggregator } = makeAggregator();
    const lowest = await aggregator.percentile({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, value: 196.5 });
    expect(lowest.percentile).toBe(0);
    expect(lowest.interpretation).toBe('below typical');
    const highest = await aggregator.percentile({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, value: 199.5 });
    expect(highest.percentile).toBe(100);
    expect(highest.interpretation).toBe('above typical');
  });

  it('returns null percentile when no data', async () => {
    const { aggregator } = makeAggregator({ loadWeightData: async () => ({}) });
    const out = await aggregator.percentile({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_7d' }, value: 198 });
    expect(out.percentile).toBe(null);
    expect(out.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricAggregator.test.mjs
```

- [ ] **Step 3: Add `percentile` method**

```javascript
  async percentile({ userId, metric, period, value }) {
    const reg = MetricRegistry.get(metric);
    const resolved = this.periodResolver.resolve(period);
    const rows = await this.#collectDailyRows({ userId, reg, from: resolved.from, to: resolved.to });
    const sorted = rows.map(r => r.value).sort((a, b) => a - b);
    const total = sorted.length;

    if (total === 0) {
      return { metric, period: resolved, unit: reg.unit, value, percentile: null, rank: 0, total: 0, interpretation: 'no data' };
    }

    // Rank: 1-based position of `value` within `sorted` (count of values <= value).
    let rank = 0;
    for (const v of sorted) { if (v <= value) rank++; else break; }
    if (rank === 0) rank = 0; // value below all
    const percentile = total === 1 ? 50 : ((rank - 1) / (total - 1)) * 100;

    let interpretation;
    if (percentile <= 10) interpretation = 'below typical';
    else if (percentile >= 90) interpretation = 'above typical';
    else interpretation = 'typical';
    if (percentile === 0 || percentile === 100) {
      // Edge cases: explicitly below/above
      interpretation = percentile === 0 ? 'below typical' : 'above typical';
    }

    return { metric, period: resolved, unit: reg.unit, value, percentile, rank, total, interpretation };
  }
```

- [ ] **Step 4: Run tests; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricAggregator.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricAggregator.mjs \
        tests/isolated/domain/health/services/MetricAggregator.test.mjs
git commit -m "feat(health-analytics): MetricAggregator.percentile

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: MetricAggregator — `snapshot` (multi-metric)

**Files:**
- Modify: `backend/src/2_domains/health/services/MetricAggregator.mjs`
- Modify: `tests/isolated/domain/health/services/MetricAggregator.test.mjs`

- [ ] **Step 1: Append failing test**

```javascript
describe('MetricAggregator.snapshot', () => {
  it('returns one row per default metric over a period', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.snapshot({
      userId: 'kc',
      period: { rolling: 'last_7d' },
    });
    expect(out.period.from).toBe('2026-04-29');
    expect(out.metrics.length).toBeGreaterThan(0);
    const names = out.metrics.map(m => m.metric);
    expect(names).toContain('weight_lbs');
    expect(names).toContain('calories');
    expect(names).toContain('protein_g');
    expect(names).toContain('tracking_density');
  });

  it('honors explicit metrics list', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.snapshot({
      userId: 'kc',
      period: { rolling: 'last_7d' },
      metrics: ['weight_lbs', 'fat_percent'],
    });
    expect(out.metrics).toHaveLength(2);
    expect(out.metrics[0].metric).toBe('weight_lbs');
    expect(out.metrics[1].metric).toBe('fat_percent');
  });

  it('each row has value/daysCovered/daysInPeriod/unit', async () => {
    const { aggregator } = makeAggregator();
    const out = await aggregator.snapshot({
      userId: 'kc',
      period: { rolling: 'last_7d' },
      metrics: ['weight_lbs'],
    });
    const row = out.metrics[0];
    expect(row).toHaveProperty('value');
    expect(row).toHaveProperty('daysCovered');
    expect(row).toHaveProperty('daysInPeriod');
    expect(row).toHaveProperty('unit');
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricAggregator.test.mjs
```

- [ ] **Step 3: Add `snapshot` method + DEFAULT_SNAPSHOT_METRICS**

At the top of `MetricAggregator.mjs`, below the imports:

```javascript
const DEFAULT_SNAPSHOT_METRICS = [
  'weight_lbs',
  'fat_percent',
  'calories',
  'protein_g',
  'workout_count',
  'workout_duration_min',
  'tracking_density',
];
```

Add the method to the class:

```javascript
  /**
   * Compressed multi-metric "vital signs" view of a period. One row per
   * requested metric. Default metric set is the head-of-household coaching
   * dashboard; pass `metrics` to override.
   */
  async snapshot({ userId, period, metrics }) {
    const list = Array.isArray(metrics) && metrics.length ? metrics : DEFAULT_SNAPSHOT_METRICS;
    // Run aggregations in parallel — different metrics may pull from
    // different stores, so this overlaps I/O.
    const rows = await Promise.all(
      list.map(async (metric) => {
        try {
          const reg = MetricRegistry.get(metric);
          const single = await this.aggregate({ userId, metric, period });
          // For rate-style metrics ('count' / 'sum') flip the headline statistic.
          let row = {
            metric,
            value: single.value,
            unit: single.unit,
            daysCovered: single.daysCovered,
            daysInPeriod: single.daysInPeriod,
          };
          if (reg.kind === 'count' || reg.kind === 'sum') {
            const summed = await this.aggregate({ userId, metric, period, statistic: 'sum' });
            row.value = summed.value;
          }
          return row;
        } catch (err) {
          return { metric, error: err.message };
        }
      })
    );

    const resolved = this.periodResolver.resolve(period);
    return { period: resolved, metrics: rows };
  }
```

- [ ] **Step 4: Run tests; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/MetricAggregator.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricAggregator.mjs \
        tests/isolated/domain/health/services/MetricAggregator.test.mjs
git commit -m "feat(health-analytics): MetricAggregator.snapshot — multi-metric

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: HealthAnalyticsService — composition root

**Files:**
- Create: `backend/src/2_domains/health/services/HealthAnalyticsService.mjs`
- Test: extend `tests/isolated/domain/health/services/MetricAggregator.test.mjs` (or new file `HealthAnalyticsService.test.mjs` — pick the new file for clarity)

- [ ] **Step 1: Create the test file**

```javascript
// tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HealthAnalyticsService } from '../../../../../backend/src/2_domains/health/services/HealthAnalyticsService.mjs';
import { PeriodResolver } from '../../../../../backend/src/2_domains/health/services/PeriodResolver.mjs';

const NOW = new Date('2026-05-05T12:00:00Z');
const fixedNow = () => NOW;

describe('HealthAnalyticsService', () => {
  it('exposes aggregate / aggregateSeries / distribution / percentile / snapshot via MetricAggregator', async () => {
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

    const agg = await service.aggregate({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_2d' } });
    expect(agg.value).toBe(198.5);

    const series = await service.aggregateSeries({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_2d' }, granularity: 'daily' });
    expect(series.buckets).toHaveLength(2);

    const dist = await service.distribution({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_2d' } });
    expect(dist.count).toBe(2);

    const pct = await service.percentile({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_2d' }, value: 199 });
    expect(pct.total).toBe(2);

    const snap = await service.snapshot({ userId: 'kc', period: { rolling: 'last_2d' }, metrics: ['weight_lbs'] });
    expect(snap.metrics[0].metric).toBe('weight_lbs');
  });

  it('throws when constructed without required deps', () => {
    expect(() => new HealthAnalyticsService({})).toThrow();
  });
});
```

- [ ] **Step 2: Run; FAIL with "HealthAnalyticsService not defined"**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs
```

- [ ] **Step 3: Implement HealthAnalyticsService**

```javascript
// backend/src/2_domains/health/services/HealthAnalyticsService.mjs

import { MetricAggregator } from './MetricAggregator.mjs';

/**
 * Composition root for the analytical surface. Plan 1 only wires
 * MetricAggregator. Plans 2-4 will add MetricComparator, MetricTrendAnalyzer,
 * PeriodMemory, and HistoryReflector, exposing their methods on this service.
 *
 * @typedef {object} HealthAnalyticsDeps
 * @property {object} healthStore
 * @property {object} healthService
 * @property {object} periodResolver
 */
export class HealthAnalyticsService {
  /** @param {HealthAnalyticsDeps} deps */
  constructor(deps) {
    if (!deps?.healthStore)    throw new Error('HealthAnalyticsService requires healthStore');
    if (!deps?.healthService)  throw new Error('HealthAnalyticsService requires healthService');
    if (!deps?.periodResolver) throw new Error('HealthAnalyticsService requires periodResolver');

    this.aggregator = new MetricAggregator(deps);
  }

  // Delegate methods. Adding more sub-services in later plans means more
  // delegate forwards here; the public surface stays a single service.
  aggregate(args)        { return this.aggregator.aggregate(args); }
  aggregateSeries(args)  { return this.aggregator.aggregateSeries(args); }
  distribution(args)     { return this.aggregator.distribution(args); }
  percentile(args)       { return this.aggregator.percentile(args); }
  snapshot(args)         { return this.aggregator.snapshot(args); }
}

export default HealthAnalyticsService;
```

- [ ] **Step 4: Run; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/HealthAnalyticsService.mjs \
        tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs
git commit -m "feat(health-analytics): HealthAnalyticsService composition root

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: HealthAnalyticsToolFactory — agent tool wrapper

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs`
- Test: `tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HealthAnalyticsToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs';

function makeFactory(overrides = {}) {
  const healthAnalyticsService = {
    aggregate:        vi.fn(async (args) => ({ ...args, value: 100, unit: 'lbs', daysCovered: 5, daysInPeriod: 7 })),
    aggregateSeries:  vi.fn(async (args) => ({ ...args, buckets: [] })),
    distribution:     vi.fn(async (args) => ({ ...args, count: 0 })),
    percentile:       vi.fn(async (args) => ({ ...args, percentile: 50 })),
    snapshot:         vi.fn(async (args) => ({ ...args, metrics: [] })),
    ...overrides,
  };
  return { factory: new HealthAnalyticsToolFactory({ healthAnalyticsService }), healthAnalyticsService };
}

describe('HealthAnalyticsToolFactory', () => {
  it('createTools returns 5 tools with the expected names', () => {
    const { factory } = makeFactory();
    const tools = factory.createTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'aggregate_metric',
      'aggregate_series',
      'metric_distribution',
      'metric_percentile',
      'metric_snapshot',
    ]);
  });

  it('aggregate_metric calls service.aggregate with mapped args', async () => {
    const { factory, healthAnalyticsService } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'aggregate_metric');
    const out = await tool.execute({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_30d' },
      statistic: 'mean',
    });
    expect(healthAnalyticsService.aggregate).toHaveBeenCalledWith({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { rolling: 'last_30d' },
      statistic: 'mean',
    });
    expect(out.value).toBe(100);
  });

  it('returns { error } envelope when the service throws', async () => {
    const { factory } = makeFactory({
      aggregate: async () => { throw new Error('unknown metric'); },
    });
    const tool = factory.createTools().find(t => t.name === 'aggregate_metric');
    const out = await tool.execute({ userId: 'kc', metric: 'nope', period: { rolling: 'last_7d' } });
    expect(out.error).toMatch(/unknown metric/);
  });

  it('aggregate_series passes granularity', async () => {
    const { factory, healthAnalyticsService } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'aggregate_series');
    await tool.execute({ userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_30d' }, granularity: 'weekly' });
    expect(healthAnalyticsService.aggregateSeries).toHaveBeenCalledWith({
      userId: 'kc', metric: 'weight_lbs', period: { rolling: 'last_30d' }, granularity: 'weekly',
    });
  });

  it('metric_snapshot accepts optional metrics list', async () => {
    const { factory, healthAnalyticsService } = makeFactory();
    const tool = factory.createTools().find(t => t.name === 'metric_snapshot');
    await tool.execute({ userId: 'kc', period: { rolling: 'last_30d' }, metrics: ['weight_lbs'] });
    expect(healthAnalyticsService.snapshot).toHaveBeenCalledWith({
      userId: 'kc', period: { rolling: 'last_30d' }, metrics: ['weight_lbs'],
    });
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs
```

- [ ] **Step 3: Implement the factory**

```javascript
// backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

/**
 * Wraps HealthAnalyticsService methods as agent tools.
 *
 * Plan 1 surface: aggregate_metric, aggregate_series, metric_distribution,
 * metric_percentile, metric_snapshot. Each tool:
 *   - has a structured JSON-schema parameter list (the model uses this
 *     directly to construct calls)
 *   - returns the service's response shape on success, or
 *     { error: <message> } on failure (no throws — matches the existing
 *     tool-factory pattern)
 *
 * The polymorphic period input is documented as an object with one of
 * { rolling, calendar, named, deduced, from+to }. Plan 1 only resolves
 * rolling, calendar, and from+to; named/deduced surface a clear error.
 */
export class HealthAnalyticsToolFactory extends ToolFactory {
  static domain = 'health';

  createTools() {
    const { healthAnalyticsService } = this.deps;
    if (!healthAnalyticsService) {
      throw new Error('HealthAnalyticsToolFactory requires healthAnalyticsService dep');
    }

    const periodSchema = {
      type: 'object',
      description:
        'Polymorphic period input. Pass exactly one of: ' +
        '{ rolling: \'last_30d\' } | { calendar: \'2024-Q3\' } | ' +
        '{ from: \'YYYY-MM-DD\', to: \'YYYY-MM-DD\' }. ' +
        '(Named periods and deduced periods are added in Plan 4.)',
    };

    return [
      createTool({
        name: 'aggregate_metric',
        description:
          'Single-value summary of a metric over a period. ' +
          'Returns { value, unit, statistic, daysCovered, daysInPeriod }.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            statistic: {
              type: 'string',
              enum: ['mean','median','min','max','count','sum','p25','p75','stdev'],
              default: 'mean',
            },
          },
          required: ['userId', 'metric', 'period'],
        },
        execute: async ({ userId, metric, period, statistic }) => {
          try {
            return await healthAnalyticsService.aggregate({ userId, metric, period, statistic });
          } catch (err) {
            return { error: err.message };
          }
        },
      }),

      createTool({
        name: 'aggregate_series',
        description:
          'Bucketed series — one value per bucket over a period. ' +
          'Granularity: daily | weekly | monthly | quarterly | yearly.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            granularity: { type: 'string', enum: ['daily','weekly','monthly','quarterly','yearly'] },
            statistic: { type: 'string', enum: ['mean','median','min','max','count','sum','p25','p75','stdev'], default: 'mean' },
          },
          required: ['userId', 'metric', 'period', 'granularity'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.aggregateSeries(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'metric_distribution',
        description:
          'Quartiles + optional histogram for a metric over a period.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            bins:   { type: 'number', minimum: 1 },
          },
          required: ['userId', 'metric', 'period'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.distribution(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'metric_percentile',
        description:
          'Where a specific value sits in the metric\'s distribution over a period.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            metric: { type: 'string' },
            period: periodSchema,
            value:  { type: 'number' },
          },
          required: ['userId', 'metric', 'period', 'value'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.percentile(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'metric_snapshot',
        description:
          'Multi-metric "vital signs" view of a period. One row per metric. ' +
          'Default metric set: weight_lbs, fat_percent, calories, protein_g, ' +
          'workout_count, workout_duration_min, tracking_density. Pass ' +
          '`metrics: [...]` to override.',
        parameters: {
          type: 'object',
          properties: {
            userId:  { type: 'string' },
            period:  periodSchema,
            metrics: { type: 'array', items: { type: 'string' } },
          },
          required: ['userId', 'period'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.snapshot(args); }
          catch (err) { return { error: err.message }; }
        },
      }),
    ];
  }
}

export default HealthAnalyticsToolFactory;
```

- [ ] **Step 4: Run tests; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs \
        tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs
git commit -m "$(cat <<'EOF'
feat(health-coach): HealthAnalyticsToolFactory wrapping the 5 service ops

Plan 1 / Task 9. aggregate_metric / aggregate_series / metric_distribution /
metric_percentile / metric_snapshot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire HealthAnalyticsToolFactory into HealthCoachAgent

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`

This is a small surgical change — add one tool factory to `registerTools()`.

- [ ] **Step 1: Read the current `registerTools()` shape**

Current shape (around line 115-169):

```javascript
registerTools() {
  const {
    healthStore, healthService, fitnessPlayableService, sessionService,
    mediaProgressMemory, dataService, messagingGateway, conversationId,
    personalContextLoader, archiveScopeFactory, similarPeriodFinder, dataRoot,
  } = this.deps;
  // ... existing factories
}
```

- [ ] **Step 2: Add the import and the new factory line**

At the top of `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`, add the import next to the others:

```javascript
import { HealthAnalyticsToolFactory } from './tools/HealthAnalyticsToolFactory.mjs';
```

In `registerTools()`, pull `healthAnalyticsService` out of `this.deps`:

```javascript
    const {
      healthStore, healthService, fitnessPlayableService, sessionService,
      mediaProgressMemory, dataService, messagingGateway, conversationId,
      personalContextLoader, archiveScopeFactory, similarPeriodFinder,
      dataRoot,
      healthAnalyticsService,           // ← new
    } = this.deps;
```

Add the factory registration after the other factories (after `ComplianceToolFactory`, before `registerAssignment`):

```javascript
    // F-201 / Plan 1: Analytical primitives — aggregate / series /
    // distribution / percentile / snapshot. Pulled from the dedicated
    // domain service so the math lives in one testable place.
    if (healthAnalyticsService) {
      this.addToolFactory(new HealthAnalyticsToolFactory({ healthAnalyticsService }));
    }
```

The `if (...)` guard means existing tests (which don't yet wire `healthAnalyticsService`) keep passing without modification. Plans 2-4 will widen this guard or remove it.

- [ ] **Step 3: Run the existing HealthCoachAgent tests to confirm no regression**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/
```
Expected: PASS — every existing test stays green; the new factory only registers when `healthAnalyticsService` is present in deps.

- [ ] **Step 4: Add a smoke test confirming tools register when the dep is present**

Append to `tests/isolated/agents/health-coach/HealthCoachAgent.tools.test.mjs` if a relevant describe exists, or create a new file if not. (Verify path before extending.)

If creating a new test file:

```javascript
// tests/isolated/agents/health-coach/HealthCoachAgent.analytics-wiring.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HealthCoachAgent } from '../../../../backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs';

describe('HealthCoachAgent — analytics wiring (Plan 1)', () => {
  it('registers HealthAnalyticsToolFactory when healthAnalyticsService is provided', () => {
    const agent = new HealthCoachAgent({
      healthStore: { loadHealthData: vi.fn(), loadWeightData: vi.fn(), loadNutritionData: vi.fn() },
      healthService: { getHealthForRange: vi.fn() },
      fitnessPlayableService: { listPlayables: vi.fn() },
      dataService: {},
      messagingGateway: null,
      conversationId: null,
      healthAnalyticsService: {
        aggregate: vi.fn(), aggregateSeries: vi.fn(),
        distribution: vi.fn(), percentile: vi.fn(), snapshot: vi.fn(),
      },
    });
    agent.registerTools();
    const names = agent.getTools().map(t => t.name);
    expect(names).toContain('aggregate_metric');
    expect(names).toContain('aggregate_series');
    expect(names).toContain('metric_distribution');
    expect(names).toContain('metric_percentile');
    expect(names).toContain('metric_snapshot');
  });

  it('skips analytics tools cleanly when healthAnalyticsService is absent', () => {
    const agent = new HealthCoachAgent({
      healthStore: { loadHealthData: vi.fn(), loadWeightData: vi.fn(), loadNutritionData: vi.fn() },
      healthService: { getHealthForRange: vi.fn() },
      fitnessPlayableService: { listPlayables: vi.fn() },
      dataService: {},
      messagingGateway: null,
      conversationId: null,
      // no healthAnalyticsService
    });
    agent.registerTools();
    const names = agent.getTools().map(t => t.name);
    expect(names).not.toContain('aggregate_metric');
  });
});
```

- [ ] **Step 5: Run the new test; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/HealthCoachAgent.analytics-wiring.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs \
        tests/isolated/agents/health-coach/HealthCoachAgent.analytics-wiring.test.mjs
git commit -m "$(cat <<'EOF'
refactor(health-coach): register HealthAnalyticsToolFactory when wired

Plan 1 / Task 10. Guarded behind presence of healthAnalyticsService dep so
tests that don't wire it stay green. Plans 2-4 widen the dep set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Wire HealthAnalyticsService into bootstrap.mjs

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

The agentOrchestrator registers `HealthCoachAgent` with a deps bag (around lines 3017-3034). We add `healthAnalyticsService` to that bag, instantiated where the other health domain services are wired (around lines 2998-3015 where `similarPeriodFinder`, `patternDetector`, `calibrationConstants` are constructed).

- [ ] **Step 1: Locate the HealthCoachAgent registration block**

```bash
cd /opt/Code/DaylightStation && grep -n "agentOrchestrator.register(HealthCoachAgent" backend/src/0_system/bootstrap.mjs
```
Expected: one line number around 3017.

- [ ] **Step 2: Locate the imports**

```bash
cd /opt/Code/DaylightStation && grep -n "PatternDetector\|SimilarPeriodFinder\|CalibrationConstants" backend/src/0_system/bootstrap.mjs | head -10
```
Verify the import block for these services. We're adding two more imports next to them.

- [ ] **Step 3: Add the imports**

Find the existing block of imports (near the top of the file) for `PatternDetector`, `SimilarPeriodFinder`, `CalibrationConstants`. Add:

```javascript
import { HealthAnalyticsService } from '#domains/health/services/HealthAnalyticsService.mjs';
import { PeriodResolver } from '#domains/health/services/PeriodResolver.mjs';
```

- [ ] **Step 4: Construct the service in the same block as the other health domain services**

Right before `agentOrchestrator.register(HealthCoachAgent, { ... })`:

```javascript
    // Plan 1: HealthAnalyticsService composition root for Tier 2 analytical
    // primitives. Wires PeriodResolver + healthStore + healthService into a
    // single addressable service used by both the agent (via
    // HealthAnalyticsToolFactory) and the dscli health surface.
    const periodResolver = new PeriodResolver();
    const healthAnalyticsService = new HealthAnalyticsService({
      healthStore,
      healthService,
      periodResolver,
    });
```

- [ ] **Step 5: Add `healthAnalyticsService` to the agentOrchestrator deps bag**

In the `agentOrchestrator.register(HealthCoachAgent, { ... })` call, add the new dep:

```javascript
    agentOrchestrator.register(HealthCoachAgent, {
      workingMemory,
      healthStore,
      healthService,
      fitnessPlayableService,
      sessionService,
      mediaProgressMemory,
      dataService,
      configService,
      messagingGateway,
      conversationId: conversationId ?? configService?.getNutribotConversationId?.() ?? null,
      personalContextLoader,
      archiveScopeFactory,
      similarPeriodFinder,
      patternDetector,
      calibrationConstants,
      dataRoot,
      healthAnalyticsService,  // ← new
    });
```

- [ ] **Step 6: Run a smoke test against the bootstrap path**

There may not be a unit test that exercises `agentOrchestrator.register(HealthCoachAgent, ...)` at the bootstrap level. The Task-10 wiring test confirms the agent picks up the dep correctly, and the dev-server smoke test in Task 15 confirms the full path. So no additional test here.

- [ ] **Step 7: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "$(cat <<'EOF'
feat(health-analytics): wire HealthAnalyticsService into HealthCoachAgent

Plan 1 / Task 11. Construct PeriodResolver + HealthAnalyticsService in the
same block as the other health domain services and pass to the agent
orchestrator's register() call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: cli/_bootstrap.mjs — `getHealthAnalytics()` factory

**Files:**
- Modify: `cli/_bootstrap.mjs`

- [ ] **Step 1: Add the cache var and factory function**

Add to the module-level cache vars (around line 38):

```javascript
let _healthAnalytics = null;
let _healthAnalyticsInitPromise = null;
```

Add the factory function after `getFinanceDirect`:

```javascript
/**
 * Build the household's HealthAnalyticsService for the dscli health
 * subcommands. Uses the same domain service the in-process HealthCoachAgent
 * uses — one set of analytics, two transports.
 *
 * Wiring (mirrors backend/src/0_system/bootstrap.mjs around line 2610):
 *   healthStore     ← YamlHealthDatastore({ dataDir })
 *   healthService   ← AggregateHealthUseCase({ healthStore })   (exposes getHealthForRange)
 *   periodResolver  ← new PeriodResolver()
 *
 * No HTTP, no backend running needed.
 */
export async function getHealthAnalytics() {
  if (_healthAnalytics) return _healthAnalytics;
  if (_healthAnalyticsInitPromise) return _healthAnalyticsInitPromise;

  _healthAnalyticsInitPromise = (async () => {
    const cfg = await getConfigService();
    const dataDir = cfg.getDataDir();

    const { YamlHealthDatastore }   = await import('#adapters/persistence/yaml/YamlHealthDatastore.mjs');
    const { AggregateHealthUseCase } = await import('#apps/health/AggregateHealthUseCase.mjs');
    const { HealthAnalyticsService } = await import('#domains/health/services/HealthAnalyticsService.mjs');
    const { PeriodResolver }         = await import('#domains/health/services/PeriodResolver.mjs');

    const healthStore    = new YamlHealthDatastore({ dataDir });
    const healthService  = new AggregateHealthUseCase({ healthStore });
    const periodResolver = new PeriodResolver();
    _healthAnalytics = new HealthAnalyticsService({ healthStore, healthService, periodResolver });
    return _healthAnalytics;
  })();

  return _healthAnalyticsInitPromise;
}
```

The class is `AggregateHealthUseCase` (in `backend/src/3_applications/health/AggregateHealthUseCase.mjs`), not `HealthAggregationService` — the latter exists but is the inner `HealthAggregator` library. The use-case wraps `healthStore` and exposes the `.getHealthForRange()` method `MetricAggregator` calls.

- [ ] **Step 2: Update `_resetForTests` to clear the new caches**

In the `_resetForTests` function at the bottom of the file:

```javascript
  _healthAnalytics = null;
  _healthAnalyticsInitPromise = null;
```

- [ ] **Step 3: Add a unit test for the factory**

Append to `tests/unit/cli/_bootstrap.test.mjs` (verify file exists; if not, create it following the existing pattern):

Run a quick recon first:

```bash
cd /opt/Code/DaylightStation && ls tests/unit/cli/_bootstrap.test.mjs && head -30 tests/unit/cli/_bootstrap.test.mjs
```

If the file exists, append:

```javascript
describe('getHealthAnalytics', () => {
  beforeEach(() => bootstrap._resetForTests());

  it('returns a memoized HealthAnalyticsService', async () => {
    // Configure DAYLIGHT_BASE_PATH to a temp dir with minimal data layout
    // OR mock as appropriate for the existing test pattern.
    // For Plan 1 we keep this assertion shallow: the factory shape returns
    // an object with the expected methods.
    const original = process.env.DAYLIGHT_BASE_PATH;
    process.env.DAYLIGHT_BASE_PATH = original || '/tmp';
    try {
      const svc = await bootstrap.getHealthAnalytics();
      expect(typeof svc.aggregate).toBe('function');
      expect(typeof svc.aggregateSeries).toBe('function');
      expect(typeof svc.distribution).toBe('function');
      expect(typeof svc.percentile).toBe('function');
      expect(typeof svc.snapshot).toBe('function');
      const second = await bootstrap.getHealthAnalytics();
      expect(second).toBe(svc);
    } finally {
      if (original === undefined) delete process.env.DAYLIGHT_BASE_PATH;
      else process.env.DAYLIGHT_BASE_PATH = original;
    }
  });
});
```

If the existing file doesn't exist, create the minimum scaffold:

```javascript
// tests/unit/cli/_bootstrap.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import * as bootstrap from '../../../cli/_bootstrap.mjs';
// (then the describe block above)
```

- [ ] **Step 4: Run tests; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/unit/cli/_bootstrap.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add cli/_bootstrap.mjs tests/unit/cli/_bootstrap.test.mjs
git commit -m "$(cat <<'EOF'
feat(dscli): getHealthAnalytics() bootstrap factory

Plan 1 / Task 12. Lazy-memoized HealthAnalyticsService for dscli health
subcommands. Constructs healthStore, healthService, periodResolver from
the local data dir — no backend needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: cli/commands/health.mjs — `aggregate` action (template)

**Files:**
- Create: `cli/commands/health.mjs`
- Test: `tests/unit/cli/commands/health.test.mjs`

This is the FIRST end-to-end CLI command. Plans 2-4 will add more actions to this same file.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/cli/commands/health.test.mjs
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import health from '../../../../cli/commands/health.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({ write(chunk, _enc, cb) { stdoutChunks.push(chunk); cb(); } });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({ write(chunk, _enc, cb) { stderrChunks.push(chunk); cb(); } });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

function fakeAnalytics(overrides = {}) {
  return async () => ({
    aggregate: async ({ userId, metric, period, statistic }) => ({
      metric, period: { from: '2026-04-29', to: '2026-05-05', label: 'last_7d', source: 'rolling' },
      statistic: statistic || 'mean', value: 198.0, unit: 'lbs',
      daysCovered: 7, daysInPeriod: 7,
    }),
    ...overrides,
  });
}

describe('cli/commands/health', () => {
  describe('help', () => {
    it('prints usage when help=true', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        { subcommand: 'health', positional: [], flags: {}, help: true },
        { stdout, stderr, getHealthAnalytics: fakeAnalytics() },
      );
      expect(result.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/aggregate/);
    });
  });

  describe('aggregate action', () => {
    it('emits JSON for `health aggregate <metric> --period last_7d`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: { period: 'last_7d' },
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: fakeAnalytics() },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.metric).toBe('weight_lbs');
      expect(out.value).toBe(198);
      expect(out.unit).toBe('lbs');
    });

    it('passes --statistic through', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: { period: 'last_7d', statistic: 'median' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            aggregate: async (args) => { captured = args; return { ...args, value: 198 }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.statistic).toBe('median');
    });

    it('parses YYYY calendar shorthand', async () => {
      let captured;
      const { stdout, stderr } = makeBuffers();
      await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: { period: '2024' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            aggregate: async (args) => { captured = args; return { value: 0 }; },
          }),
        },
      );
      expect(captured.period).toEqual({ calendar: '2024' });
    });

    it('parses YYYY-MM calendar shorthand', async () => {
      let captured;
      const { stdout, stderr } = makeBuffers();
      await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: { period: '2024-08' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            aggregate: async (args) => { captured = args; return { value: 0 }; },
          }),
        },
      );
      expect(captured.period).toEqual({ calendar: '2024-08' });
    });

    it('parses --from / --to override', async () => {
      let captured;
      const { stdout, stderr } = makeBuffers();
      await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: { from: '2024-01-15', to: '2024-02-10' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            aggregate: async (args) => { captured = args; return { value: 0 }; },
          }),
        },
      );
      expect(captured.period).toEqual({ from: '2024-01-15', to: '2024-02-10' });
    });

    it('exits 2 when --period and --from/--to are missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: {},
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: fakeAnalytics() },
      );
      expect(result.exitCode).toBe(2);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toMatch(/period_required/);
    });

    it('exits 2 when metric arg is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate'],
          flags: { period: 'last_7d' },
          help: false,
        },
        { stdout, stderr, getHealthAnalytics: fakeAnalytics() },
      );
      expect(result.exitCode).toBe(2);
    });
  });

  describe('unknown action', () => {
    it('exits 2 with usage', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        { subcommand: 'health', positional: ['fly'], flags: {}, help: false },
        { stdout, stderr },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/unknown action/i);
    });
  });

  describe('userId resolution', () => {
    it('uses --user flag when provided', async () => {
      let captured;
      const { stdout, stderr } = makeBuffers();
      await health.run(
        {
          subcommand: 'health',
          positional: ['aggregate', 'weight_lbs'],
          flags: { period: 'last_7d', user: 'someone-else' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            aggregate: async (args) => { captured = args; return { value: 0 }; },
          }),
        },
      );
      expect(captured.userId).toBe('someone-else');
    });

    it('falls back to DSCLI_USER_ID env, then "default"', async () => {
      let captured;
      const { stdout, stderr } = makeBuffers();
      const original = process.env.DSCLI_USER_ID;
      process.env.DSCLI_USER_ID = 'env-user';
      try {
        await health.run(
          {
            subcommand: 'health',
            positional: ['aggregate', 'weight_lbs'],
            flags: { period: 'last_7d' },
            help: false,
          },
          {
            stdout, stderr,
            getHealthAnalytics: async () => ({
              aggregate: async (args) => { captured = args; return { value: 0 }; },
            }),
          },
        );
        expect(captured.userId).toBe('env-user');
      } finally {
        if (original === undefined) delete process.env.DSCLI_USER_ID;
        else process.env.DSCLI_USER_ID = original;
      }
    });
  });
});
```

- [ ] **Step 2: Run; FAIL ("Cannot find module …health.mjs")**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/unit/cli/commands/health.test.mjs
```

- [ ] **Step 3: Implement `cli/commands/health.mjs`**

```javascript
// cli/commands/health.mjs
/**
 * dscli health — health analytics surface (Plan 1 foundation).
 *
 * Plan 1 actions:
 *   dscli health aggregate <metric> --period <shorthand> [--statistic <s>] [--user <id>]
 *
 * Subsequent plans add: aggregate-series, distribution, percentile, snapshot,
 * compare, summarize-change, conditional, correlate, trajectory, regime-change,
 * anomalies, sustained, periods *, deduce, analyze.
 *
 * Period shorthand:
 *   bare token        → rolling: 'last_30d', 'last_year', 'prev_30d', 'all_time'
 *   YYYY              → calendar: { calendar: '2024' }
 *   YYYY-MM           → calendar: { calendar: '2024-08' }
 *   YYYY-Qn           → calendar: { calendar: '2024-Q3' }
 *   --from / --to     → explicit { from, to } (highest precedence)
 *
 * (Named and deduced shorthand land in Plan 4.)
 */

import { printJson, printError, EXIT_OK, EXIT_USAGE, EXIT_FAIL } from '../_output.mjs';

const HELP = `
dscli health — health analytics surface

Usage:
  dscli health <action> [args] [flags]

Actions (Plan 1):
  aggregate <metric>     Single-value summary of a metric over a period.
                         Returns: { metric, period, statistic, value, unit,
                                    daysCovered, daysInPeriod }
                         Required flag: --period <shorthand> OR --from / --to

Future actions (later plans): aggregate-series, distribution, percentile,
  snapshot, compare, summarize-change, conditional, correlate, trajectory,
  regime-change, anomalies, sustained, periods (list/deduce/remember/forget),
  analyze.

Period shorthand (--period):
  last_7d / last_30d / last_90d / last_180d / last_365d / last_2y / last_5y / last_10y / all_time
  prev_7d / prev_30d / prev_90d / prev_180d / prev_365d
  this_week / this_month / this_quarter / this_year / last_quarter / last_year
  YYYY / YYYY-MM / YYYY-Qn

Other flags:
  --statistic <name>     mean (default) | median | min | max | count | sum | p25 | p75 | stdev
  --user <id>            override user id (defaults to $DSCLI_USER_ID or 'default')
  --from / --to          explicit YYYY-MM-DD bounds (overrides --period)

Environment:
  DSCLI_USER_ID          default user id when --user not provided
`.trimStart();

/**
 * Translate a CLI period shorthand into the polymorphic period input the
 * domain layer accepts. Returns the period object or throws on syntax errors.
 */
function parsePeriodFlag(shorthand) {
  if (!shorthand || typeof shorthand !== 'string') return null;
  const s = shorthand.trim();

  // Rolling: last_*, prev_*, all_time
  if (s === 'all_time' || /^(last|prev)_\d+[dy]$/.test(s)) {
    return { rolling: s };
  }

  // Calendar named labels
  const CALENDAR_LABELS = ['this_week','this_month','this_quarter','this_year','last_quarter','last_year'];
  if (CALENDAR_LABELS.includes(s)) {
    return { calendar: s };
  }

  // Calendar absolute: YYYY, YYYY-MM, YYYY-Qn
  if (/^\d{4}$/.test(s) || /^\d{4}-\d{2}$/.test(s) || /^\d{4}-Q[1-4]$/.test(s)) {
    return { calendar: s };
  }

  throw new Error(`unknown period shorthand "${shorthand}"`);
}

function resolveUserId(args) {
  if (args.flags.user) return args.flags.user;
  if (process.env.DSCLI_USER_ID) return process.env.DSCLI_USER_ID;
  return 'default';
}

async function actionAggregate(args, deps) {
  const metric = args.positional[1];
  if (!metric) {
    deps.stderr.write('dscli health aggregate: missing required <metric>\n');
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }

  // Period: --from/--to wins, else --period shorthand.
  let period;
  if (args.flags.from && args.flags.to) {
    period = { from: args.flags.from, to: args.flags.to };
  } else if (args.flags.period) {
    try { period = parsePeriodFlag(args.flags.period); }
    catch (err) {
      printError(deps.stderr, { error: 'invalid_period', message: err.message });
      return { exitCode: EXIT_USAGE };
    }
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
    result = await svc.aggregate({
      userId: resolveUserId(args),
      metric,
      period,
      statistic: args.flags.statistic,
    });
  } catch (err) {
    printError(deps.stderr, { error: 'aggregate_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }

  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }

  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

const ACTIONS = {
  aggregate: actionAggregate,
};

export default {
  name: 'health',
  description: 'Health analytics: aggregate (Plan 1)',
  requiresBackend: false,
  async run(args, deps) {
    if (args.help) {
      deps.stdout.write(HELP);
      return { exitCode: EXIT_OK };
    }
    const action = args.positional[0];
    if (!action || !ACTIONS[action]) {
      deps.stderr.write(`dscli health: unknown action: ${action ?? '(none)'}\n`);
      deps.stderr.write(HELP);
      return { exitCode: EXIT_USAGE };
    }
    return ACTIONS[action](args, deps);
  },
};
```

- [ ] **Step 4: Run tests; should pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/unit/cli/commands/health.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add cli/commands/health.mjs tests/unit/cli/commands/health.test.mjs
git commit -m "$(cat <<'EOF'
feat(dscli): health command — aggregate action (Plan 1)

Plan 1 / Task 13. dscli health aggregate <metric> --period <shorthand>
end-to-end. Period shorthand parser handles rolling, calendar, and
explicit from/to forms.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: dscli.mjs — register `health` subcommand

**Files:**
- Modify: `cli/dscli.mjs`

- [ ] **Step 1: Add `'health'` to the KNOWN_SUBCOMMANDS list**

Find the line:

```javascript
const KNOWN_SUBCOMMANDS = ['system', 'ha', 'content', 'memory', 'finance', 'concierge'];
```

Replace with:

```javascript
const KNOWN_SUBCOMMANDS = ['system', 'ha', 'content', 'memory', 'finance', 'concierge', 'health'];
```

- [ ] **Step 2: Add the help-banner entry**

Find the `Subcommands:` block in `printTopLevelHelp` and add `health`:

```javascript
    'Subcommands:',
    '  system    Health, config, reload',
    '  ha        Home Assistant entity state and control',
    '  content   Search, resolve, and play media content',
    '  memory    Read and write concierge memory state',
    '  finance   Buxfer accounts and transactions',
    '  concierge List satellites and read transcript files',
    '  health    Health analytics — aggregate, etc.',
```

- [ ] **Step 3: Add `getHealthAnalytics` to the deps bag**

In the `deps = { ... }` block in `main()`:

```javascript
  const deps = {
    stdout: process.stdout,
    stderr: process.stderr,
    fetch: globalThis.fetch,
    allowWrite,
    cliSatelliteId,
    getConfigService: bootstrap.getConfigService,
    getHttpClient: bootstrap.getHttpClient,
    getHaGateway: bootstrap.getHaGateway,
    getContentQuery: bootstrap.getContentQuery,
    getMemory: bootstrap.getMemory,
    getFinance: bootstrap.getFinance,
    getFinanceDirect: bootstrap.getFinanceDirect,
    getWriteAuditor: bootstrap.getWriteAuditor,
    getConciergeConfig: bootstrap.getConciergeConfig,
    getTranscriptDir: bootstrap.getTranscriptDir,
    getHealthAnalytics: bootstrap.getHealthAnalytics,  // ← new
  };
```

- [ ] **Step 4: Add a smoke test for the dispatcher recognizing `health`**

Append to `tests/unit/cli/dscli.test.mjs` if it has a relevant describe block, or run a quick subprocess test. (Recon: `head -50 tests/unit/cli/dscli.test.mjs` to see the existing pattern.)

If a subprocess test exists, append:

```javascript
  it('dispatches health subcommand', async () => {
    const { exitCode, stdout } = await runDscli(['health', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/aggregate/);
  });
```

If subprocess test doesn't exist, the Task-13 in-process tests already cover the dispatch path.

- [ ] **Step 5: Run tests**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/unit/cli/dscli.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add cli/dscli.mjs tests/unit/cli/dscli.test.mjs
git commit -m "$(cat <<'EOF'
feat(dscli): register health subcommand in dispatcher

Plan 1 / Task 14. Adds 'health' to KNOWN_SUBCOMMANDS, the top-level help
banner, and threads getHealthAnalytics through the deps bag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: End-to-end smoke verification

**Files:**
- (no new files)

- [ ] **Step 1: Run the full unit test suite for the new code**

```bash
cd /opt/Code/DaylightStation && \
  npx vitest run tests/isolated/domain/health/services/ \
                 tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs \
                 tests/isolated/agents/health-coach/HealthCoachAgent.analytics-wiring.test.mjs \
                 tests/unit/cli/commands/health.test.mjs \
                 tests/unit/cli/_bootstrap.test.mjs
```
Expected: all green.

- [ ] **Step 2: Run `dscli health --help` against the repo**

```bash
cd /opt/Code/DaylightStation && node cli/dscli.mjs health --help
```
Expected: stdout contains "aggregate" and the period-shorthand block; exit 0.

- [ ] **Step 3: Run `dscli health aggregate weight_lbs --period last_7d` against real data**

```bash
cd /opt/Code/DaylightStation && DSCLI_USER_ID=kckern node cli/dscli.mjs health aggregate weight_lbs --period last_7d
```
Expected: a JSON object on stdout with `metric: 'weight_lbs'`, `unit: 'lbs'`, `daysInPeriod: 7`. The exact `value` depends on actual data.

If the data dir is unreadable from the working directory (the `claude` user can't read the Docker volume on prod host — see CLAUDE.local.md), run inside the container:

```bash
sudo docker exec daylight-station node /usr/src/app/cli/dscli.mjs health aggregate weight_lbs --period last_7d
```

- [ ] **Step 4: Run the full agent-side smoke test**

Confirm the in-process agent picks up the new tools when wired:

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/
```
Expected: every existing health-coach test still passes; the new analytics-wiring test passes.

- [ ] **Step 5: Tag the foundation milestone (informational commit, optional)**

If everything is green, no separate commit is needed — the foundation is the cumulative result of Tasks 1-14.

If you want a marker:

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore(health-analytics): Plan 1 foundation complete — green end-to-end

Plan 1 ships:
  - PeriodResolver (rolling/calendar/explicit)
  - MetricRegistry (11 metrics)
  - MetricAggregator (aggregate/series/distribution/percentile/snapshot)
  - HealthAnalyticsService composition root
  - HealthAnalyticsToolFactory (5 tools, registered in HealthCoachAgent)
  - dscli health aggregate (end-to-end template)

Plans 2-4 will add MetricComparator, MetricTrendAnalyzer, PeriodMemory,
HistoryReflector and their dscli surfaces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| Spec section | Task |
|---|---|
| `aggregate_metric` primitive | 3, 9 |
| `aggregate_series` primitive | 4, 9 |
| `metric_distribution` primitive | 5, 9 |
| `metric_percentile` primitive | 6, 9 |
| `metric_snapshot` primitive (incl. default metrics list) | 7, 9 |
| Polymorphic period vocabulary (rolling / calendar / explicit) | 1 |
| Polymorphic period vocabulary (named / deduced) | DEFERRED to Plan 4 (PeriodResolver throws explicit error) |
| `HealthAnalyticsService` composition root | 8 |
| `HealthAnalyticsToolFactory` agent surface | 9, 10 |
| Bootstrap wiring into agent | 11 |
| `cli/_bootstrap.mjs` factory | 12 |
| `dscli health aggregate` end-to-end | 13, 14 |
| Tier 1 gap-fills | DEFERRED to Plan 5 (independent — can run in parallel) |
| `MetricComparator` | DEFERRED to Plan 2 |
| `MetricTrendAnalyzer` | DEFERRED to Plan 3 |
| `PeriodMemory` / `HistoryReflector` | DEFERRED to Plan 4 |

---

## Notes for the implementer

- **Path aliases:** Use `#domains/...`, `#adapters/...`, `#apps/...`, `#system/...` per `package.json` `imports`. Don't use relative paths across DDD layers.
- **Test framework:** vitest, run via `npx vitest run <path>`. **Important:** the `tests/isolated/` harness (`npm run test:isolated`) tries to run tests with Jest, which fails on vitest-style imports — this is a pre-existing inconsistency (see MEMORY note "Dead vitest tests"). New isolated tests in this plan match the existing pattern: vitest imports, run individually with `npx vitest run`. They will appear as failures in the isolated harness, alongside the pre-existing dead vitest tests there. Don't try to "fix" this in Plan 1 — it's a separate test-infrastructure cleanup.
- **No `node:test`:** The newer health-coach tests use vitest. Don't accidentally bring in `node:test` patterns — older `HealthToolFactory.test.mjs` uses `node:test` but the rest of the directory has migrated.
- **Inject the clock for date tests.** Pass `now: () => new Date('2026-05-05T12:00:00Z')` into `PeriodResolver`. Don't mock `Date` globally.
- **Error envelopes, not throws.** Tools return `{ ..., error }` rather than throwing — match the pattern in `LongitudinalToolFactory` and `HealthToolFactory`.
- **Don't forget:** every commit should pass `git diff --check` (no trailing whitespace, no merge markers). Pre-commit hooks may also flag style issues — fix them rather than `--no-verify`.
- **If a test fixture conflicts with timezone:** All date math is UTC. Construct dates with `new Date(Date.UTC(y, m-1, d))` and format with `.toISOString().slice(0, 10)`. If a test fails because of TZ drift, that's a real bug — not a test environment quirk.
