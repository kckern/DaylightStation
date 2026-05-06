# Health Analytics — Period Memory & Reflection Implementation Plan (Plan 4/5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `PeriodMemory` and `HistoryReflector` sub-services. Extend `PeriodResolver` to handle `{named: 'X'}` lookups across playbook + working memory. Expose 5 new agent tools (`list_periods`, `deduce_period`, `remember_period`, `forget_period`, `analyze_history`) and 5 new dscli subcommands.

**Architecture:** Period addressability lives in three sources, unified through one `list_periods` API:
- **Declared:** `playbook.named_periods` (read via existing `personalContextLoader`)
- **Deduced (cached):** `period.deduced.<slug>` keys in agent working memory (TTL-backed)
- **Remembered:** `period.remembered.<slug>` keys in agent working memory (no TTL)

`PeriodResolver.resolve()` becomes **async** in Plan 4 (was sync in Plans 1-3) to allow named-period lookup. All callers update to `await resolve()`. `{deduced: criteria}` continues to throw — callers run `deduce_period()` explicitly first and pass the result as `{from, to}`.

**Tech Stack:** Same as Plans 1-3, plus the existing `IWorkingMemory` framework (`backend/src/3_applications/agents/framework/`).

**Spec:** [docs/superpowers/specs/2026-05-05-health-coach-data-tier-design.md](../specs/2026-05-05-health-coach-data-tier-design.md) — "Period vocabulary", "Period memory", and "Address by period" / "Reflect" sections.

**Prerequisites:** Plans 1-3 merged to main.

---

## File structure

**New files:**
- `backend/src/2_domains/health/services/PeriodMemory.mjs`
- `tests/isolated/domain/health/services/PeriodMemory.test.mjs`
- `backend/src/2_domains/health/services/HistoryReflector.mjs`
- `tests/isolated/domain/health/services/HistoryReflector.test.mjs`

**Modified files:**
- `backend/src/2_domains/health/services/PeriodResolver.mjs` — `resolve()` becomes async, accepts optional `playbookLoader` + `workingMemoryAdapter` deps, handles `{named: 'X'}` lookup.
- `tests/isolated/domain/health/services/PeriodResolver.test.mjs` — update tests for async + named cases.
- `backend/src/2_domains/health/services/MetricAggregator.mjs` — `await this.periodResolver.resolve(...)`.
- `backend/src/2_domains/health/services/MetricComparator.mjs` — same.
- `backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs` — same.
- `backend/src/2_domains/health/services/HealthAnalyticsService.mjs` — instantiate `PeriodMemory` + `HistoryReflector`, add 5 delegate methods.
- `backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs` — add 5 tools.
- `tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs` — extend (new total: 18 tools).
- `cli/commands/health.mjs` — add 5 actions: `periods` (with sub-actions list/deduce/remember/forget) + `analyze`.
- `tests/unit/cli/commands/health.test.mjs` — extend.
- `backend/src/0_system/bootstrap.mjs` — pass `personalContextLoader` and `workingMemory` to `HealthAnalyticsService` construction.
- `cli/_bootstrap.mjs` — wire equivalent deps for CLI (or pass `null` and document that named-period lookup requires those deps).

---

## Conventions

- All commits end with: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- Working memory key namespace:
  - `period.deduced.<slug>` — TTL = 30 days (configurable via `deducedTtlMs` option)
  - `period.remembered.<slug>` — no TTL
- Slug format: lowercase, alphanumeric + hyphens, max 64 chars. Validate at `remember_period`.
- Working memory adapter is the framework `IWorkingMemory` (`load(agentId, userId)` / `save(agentId, userId, state)`). The agent ID for analytics is `'health-coach'`. The userId is per-call.

---

## Task 1: PeriodResolver — async + named lookup

**Files:**
- Modify: `backend/src/2_domains/health/services/PeriodResolver.mjs`
- Modify: `tests/isolated/domain/health/services/PeriodResolver.test.mjs`

- [ ] **Step 1: Update existing tests to await resolve()**

The existing 19 tests in `PeriodResolver.test.mjs` use `r.resolve(...)` synchronously. Wrap each in `await` (and make the `it` callbacks async). Run to confirm still passing.

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/domain/health/services/PeriodResolver.test.mjs
```

- [ ] **Step 2: Append failing tests for named lookup**

```javascript
describe('PeriodResolver — named periods (Plan 4)', () => {
  function makeResolver({ playbook = null, working = null } = {}) {
    const playbookLoader = playbook ? { loadPlaybook: async () => playbook } : null;
    const workingMemoryAdapter = working ? {
      load: async () => working,
    } : null;
    return new PeriodResolver({
      now: fixedNow,
      playbookLoader,
      workingMemoryAdapter,
    });
  }

  it('resolves named period from playbook.named_periods', async () => {
    const r = makeResolver({
      playbook: { named_periods: { '2017-cut': { from: '2017-01-15', to: '2017-04-30' } } },
    });
    const out = await r.resolve({ named: '2017-cut' }, { userId: 'kc' });
    expect(out.from).toBe('2017-01-15');
    expect(out.to).toBe('2017-04-30');
    expect(out.label).toBe('2017-cut');
    expect(out.source).toBe('named');
    expect(out.subSource).toBe('declared');
  });

  it('resolves named period from working memory remembered', async () => {
    const wm = makeWorkingMemoryStateFixture({
      'period.remembered.stable-195': {
        from: '2024-08-01', to: '2024-11-15',
        label: 'Stable 195', description: 'Maintenance window',
      },
    });
    const r = makeResolver({ working: wm });
    const out = await r.resolve({ named: 'stable-195' }, { userId: 'kc' });
    expect(out.from).toBe('2024-08-01');
    expect(out.to).toBe('2024-11-15');
    expect(out.subSource).toBe('remembered');
  });

  it('prefers remembered over declared on slug collision', async () => {
    const wm = makeWorkingMemoryStateFixture({
      'period.remembered.cut': { from: '2024-01-01', to: '2024-03-31', label: 'Recent cut' },
    });
    const r = makeResolver({
      playbook: { named_periods: { 'cut': { from: '2017-01-15', to: '2017-04-30' } } },
      working: wm,
    });
    const out = await r.resolve({ named: 'cut' }, { userId: 'kc' });
    expect(out.from).toBe('2024-01-01');
    expect(out.subSource).toBe('remembered');
  });

  it('throws when slug not found in any source', async () => {
    const r = makeResolver({ playbook: { named_periods: {} } });
    await expect(r.resolve({ named: 'unknown-slug' }, { userId: 'kc' })).rejects.toThrow(/named period not found/);
  });

  it('throws when no playbook/workingMemory deps wired', async () => {
    const r = new PeriodResolver({ now: fixedNow });  // no deps
    await expect(r.resolve({ named: 'anything' }, { userId: 'kc' })).rejects.toThrow(/named period lookup requires/);
  });

  it('still throws on { deduced: ... } with explicit Plan-4 hint', async () => {
    const r = makeResolver();
    await expect(r.resolve({ deduced: { criteria: {} } }, { userId: 'kc' }))
      .rejects.toThrow(/deduced period.*deduce_period/i);
  });
});

// Helper: build a WorkingMemoryState-like object whose getAll() returns the
// fixture entries. The PeriodResolver should call .getAll() on the loaded
// state to enumerate keys.
function makeWorkingMemoryStateFixture(entries) {
  return {
    getAll: () => ({ ...entries }),
  };
}
```

Note: the test helper `makeWorkingMemoryStateFixture` builds a stub matching the framework's `WorkingMemoryState.getAll()` shape. Real WorkingMemoryState has more methods, but resolver only needs `getAll()`.

- [ ] **Step 3: Run; FAIL.**

- [ ] **Step 4: Implement async + named lookup**

Replace the resolve() and add helpers:

```javascript
// backend/src/2_domains/health/services/PeriodResolver.mjs

const AGENT_ID = 'health-coach';
const PERIOD_REMEMBERED_PREFIX = 'period.remembered.';
const PERIOD_DEDUCED_PREFIX    = 'period.deduced.';

export class PeriodResolver {
  constructor({
    now = () => new Date(),
    playbookLoader = null,
    workingMemoryAdapter = null,
  } = {}) {
    this.now = now;
    this.playbookLoader = playbookLoader;
    this.workingMemoryAdapter = workingMemoryAdapter;
  }

  /**
   * Resolve a polymorphic period input to absolute date bounds.
   *
   * Sync forms (rolling/calendar/explicit) resolve immediately; named
   * periods do an async lookup across playbook + working memory.
   *
   * @param {object} input
   * @param {object} [ctx] - { userId } required for named-period lookup
   */
  async resolve(input, ctx = {}) {
    if (!input || typeof input !== 'object') {
      throw new Error('PeriodResolver.resolve: input must be an object');
    }
    if (typeof input.rolling === 'string') return this.#resolveRolling(input.rolling);
    if (typeof input.calendar === 'string') return this.#resolveCalendar(input.calendar);
    if (typeof input.from === 'string' && typeof input.to === 'string') {
      return { from: input.from, to: input.to, label: `${input.from}..${input.to}`, source: 'explicit' };
    }
    if (typeof input.named === 'string') {
      return this.#resolveNamed(input.named, ctx);
    }
    if (input.deduced) {
      throw new Error('Period kind "deduced" inline resolution is not supported. Call deduce_period() first and pass the result as { from, to }.');
    }
    throw new Error('PeriodResolver.resolve: unknown period input shape');
  }

  // ... existing #today, #fmt, #resolveRolling, #resolveCalendar unchanged ...

  async #resolveNamed(slug, ctx) {
    if (!this.playbookLoader && !this.workingMemoryAdapter) {
      throw new Error('PeriodResolver: named period lookup requires playbookLoader or workingMemoryAdapter dep');
    }
    const userId = ctx?.userId;

    // 1) workingMemory.period.remembered.<slug>
    if (this.workingMemoryAdapter && userId) {
      const state = await this.workingMemoryAdapter.load(AGENT_ID, userId);
      const all = (typeof state?.getAll === 'function') ? state.getAll() : {};
      const remembered = all[`${PERIOD_REMEMBERED_PREFIX}${slug}`];
      if (remembered) {
        return {
          from: remembered.from, to: remembered.to,
          label: remembered.label ?? slug,
          source: 'named', subSource: 'remembered',
        };
      }
      // 2) workingMemory.period.deduced.<slug>
      const deduced = all[`${PERIOD_DEDUCED_PREFIX}${slug}`];
      if (deduced) {
        return {
          from: deduced.from, to: deduced.to,
          label: deduced.label ?? slug,
          source: 'named', subSource: 'deduced',
        };
      }
    }

    // 3) playbook.named_periods.<slug>
    if (this.playbookLoader && userId) {
      const playbook = await this.playbookLoader.loadPlaybook(userId);
      const period = playbook?.named_periods?.[slug];
      if (period) {
        return {
          from: formatYmd(period.from),
          to:   formatYmd(period.to),
          label: slug,
          source: 'named', subSource: 'declared',
        };
      }
    }

    throw new Error(`PeriodResolver: named period not found: "${slug}"`);
  }
}

function formatYmd(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}
```

- [ ] **Step 5: Run; tests pass.**

- [ ] **Step 6: Commit**

```bash
git add backend/src/2_domains/health/services/PeriodResolver.mjs \
        tests/isolated/domain/health/services/PeriodResolver.test.mjs
git commit -m "feat(health-analytics): PeriodResolver async + named-period lookup

Plan 4 / Task 1. resolve() now returns Promise (was sync). Named periods
look up across working memory remembered → deduced → playbook declared.
{ deduced: ... } continues to throw with a hint to call deduce_period()
explicitly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Update sub-services to `await resolve()`

**Files:**
- Modify: `backend/src/2_domains/health/services/MetricAggregator.mjs`
- Modify: `backend/src/2_domains/health/services/MetricComparator.mjs`
- Modify: `backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs`

In each file, find every `this.periodResolver.resolve(...)` call and add `await`. Pass `{ userId }` as the second argument so named-period lookups have the user context.

The pattern transforms from:
```javascript
const resolved = this.periodResolver.resolve(period);
```
to:
```javascript
const resolved = await this.periodResolver.resolve(period, { userId });
```

- [ ] **Step 1: Update MetricAggregator** — locate all `resolve()` calls (5 of them: aggregate, aggregateSeries, distribution, percentile, snapshot). Add `await` and pass `{ userId }`. Also any internal helpers that call `#collectDailyRows` already pass userId; just thread it.

- [ ] **Step 2: Update MetricComparator** — 4 calls (compare via aggregator, summarizeChange, conditionalAggregate, correlateMetrics). Same pattern.

- [ ] **Step 3: Update MetricTrendAnalyzer** — 4 calls. Same pattern.

- [ ] **Step 4: Run all existing tests for the three services**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/domain/health/services/MetricAggregator.test.mjs \
  tests/isolated/domain/health/services/MetricComparator.test.mjs \
  tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs
```

The existing test fixtures construct the `PeriodResolver` without playbookLoader/workingMemory — that's fine, since the tests only use rolling/calendar/explicit forms which don't need those deps.

Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/MetricAggregator.mjs \
        backend/src/2_domains/health/services/MetricComparator.mjs \
        backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs
git commit -m "refactor(health-analytics): await periodResolver.resolve() everywhere

Plan 4 / Task 2. All sub-services now await the async resolve() introduced
in Task 1. Pass { userId } as ctx so named-period lookups land correctly
when callers reach Plan 4 features.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: PeriodMemory — list / deduce / remember / forget

**Files:**
- Create: `backend/src/2_domains/health/services/PeriodMemory.mjs`
- Test: `tests/isolated/domain/health/services/PeriodMemory.test.mjs`

PeriodMemory operates against a `WorkingMemoryAdapter` (the framework `IWorkingMemory` interface) for state and the existing `playbookLoader` for playbook data.

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/domain/health/services/PeriodMemory.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { PeriodMemory } from '../../../../../backend/src/2_domains/health/services/PeriodMemory.mjs';

// Fake WorkingMemoryState with KV semantics
function makeState(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: (k) => map.get(k),
    set: (k, v, opts = {}) => { map.set(k, v); return opts; },
    remove: (k) => { map.delete(k); },
    getAll: () => Object.fromEntries(map),
  };
}

function makeAdapter(initialState = {}) {
  let state = makeState(initialState);
  return {
    load: vi.fn(async () => state),
    save: vi.fn(async (_a, _u, s) => { state = s; }),
    __getState: () => state,
  };
}

function makePlaybookLoader(playbook) {
  return { loadPlaybook: vi.fn(async () => playbook) };
}

function makeAggregator() {
  return {
    aggregateSeries: vi.fn(async ({ metric, period }) => ({
      metric, period: { from: period.from || '2024-01-01', to: period.to || '2024-12-31', label: 'fake', source: 'explicit' },
      buckets: [],
    })),
  };
}

describe('PeriodMemory.listPeriods', () => {
  it('returns declared + remembered + deduced merged with sources', async () => {
    const adapter = makeAdapter({
      'period.remembered.stable-195': { from: '2024-08-01', to: '2024-11-15', label: 'Stable 195' },
      'period.deduced.weight-low':    { from: '2024-03-01', to: '2024-04-30', label: 'Weight low' },
    });
    const playbookLoader = makePlaybookLoader({
      named_periods: {
        '2017-cut': { from: '2017-01-15', to: '2017-04-30', description: 'Initial cut' },
      },
    });
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter, playbookLoader });

    const out = await memory.listPeriods({ userId: 'kc' });
    expect(out.periods).toHaveLength(3);

    const slugs = out.periods.map(p => p.slug).sort();
    expect(slugs).toEqual(['2017-cut', 'stable-195', 'weight-low']);

    const sources = Object.fromEntries(out.periods.map(p => [p.slug, p.source]));
    expect(sources['2017-cut']).toBe('declared');
    expect(sources['stable-195']).toBe('remembered');
    expect(sources['weight-low']).toBe('deduced');
  });

  it('returns empty list when no sources have any periods', async () => {
    const adapter = makeAdapter({});
    const playbookLoader = makePlaybookLoader({});
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter, playbookLoader });
    const out = await memory.listPeriods({ userId: 'kc' });
    expect(out.periods).toEqual([]);
  });
});

describe('PeriodMemory.rememberPeriod / forgetPeriod', () => {
  it('remembers a period under period.remembered.<slug>', async () => {
    const adapter = makeAdapter();
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter });
    const out = await memory.rememberPeriod({
      userId: 'kc', slug: 'stable-195',
      from: '2024-08-01', to: '2024-11-15',
      label: 'Stable 195',
      description: 'Maintenance window',
    });
    expect(out.slug).toBe('stable-195');
    const stored = adapter.__getState().get('period.remembered.stable-195');
    expect(stored).toMatchObject({ from: '2024-08-01', to: '2024-11-15', label: 'Stable 195' });
    expect(adapter.save).toHaveBeenCalled();
  });

  it('forgets a remembered period', async () => {
    const adapter = makeAdapter({
      'period.remembered.stable-195': { from: '2024-08-01', to: '2024-11-15', label: 'Stable 195' },
    });
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter });
    await memory.forgetPeriod({ userId: 'kc', slug: 'stable-195' });
    expect(adapter.__getState().get('period.remembered.stable-195')).toBeUndefined();
  });

  it('throws on invalid slug', async () => {
    const adapter = makeAdapter();
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter });
    await expect(memory.rememberPeriod({
      userId: 'kc', slug: 'NOT VALID', from: '2024-01-01', to: '2024-12-31', label: 'x',
    })).rejects.toThrow(/invalid slug/i);
  });
});

describe('PeriodMemory.deducePeriod', () => {
  // Fixture: 60 days. Days 10-40 have weight in [193,197], else outside.
  function buildBandedFixture() {
    const out = {};
    const start = new Date(Date.UTC(2024, 0, 1));
    for (let i = 0; i < 60; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      let lbs;
      if (i < 10) lbs = 200;
      else if (i < 41) lbs = 195;
      else lbs = 200;
      out[key] = { lbs, lbs_adjusted_average: lbs };
    }
    return out;
  }

  it('finds candidates matching value_range over all_time', async () => {
    const adapter = makeAdapter();
    const trendAnalyzer = {
      detectSustained: vi.fn(async (args) => ({
        runs: [
          { from: '2024-01-11', to: '2024-02-10', durationDays: 31, summary: { mean: 195, min: 195, max: 195 } },
        ],
      })),
    };
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter, trendAnalyzer });

    const out = await memory.deducePeriod({
      userId: 'kc',
      criteria: { metric: 'weight_lbs', value_range: [193, 197], min_duration_days: 21 },
      max_results: 3,
    });
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].from).toBe('2024-01-11');
    expect(out.candidates[0].durationDays).toBe(31);
    expect(out.candidates[0].score).toBeGreaterThan(0);
    // Caches under period.deduced.<auto-slug>
    const all = adapter.__getState().getAll();
    const deducedKeys = Object.keys(all).filter(k => k.startsWith('period.deduced.'));
    expect(deducedKeys.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty candidates when criteria match nothing', async () => {
    const adapter = makeAdapter();
    const trendAnalyzer = {
      detectSustained: vi.fn(async () => ({ runs: [] })),
    };
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter, trendAnalyzer });
    const out = await memory.deducePeriod({
      userId: 'kc',
      criteria: { metric: 'weight_lbs', value_range: [50, 60], min_duration_days: 30 },
    });
    expect(out.candidates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Implement PeriodMemory**

```javascript
// backend/src/2_domains/health/services/PeriodMemory.mjs

const AGENT_ID = 'health-coach';
const PERIOD_REMEMBERED_PREFIX = 'period.remembered.';
const PERIOD_DEDUCED_PREFIX    = 'period.deduced.';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_DEDUCED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Period memory — list / deduce / remember / forget.
 *
 * Stores periods under namespaced keys in agent working memory:
 *   period.remembered.<slug> — promoted by the agent, persistent
 *   period.deduced.<slug>    — auto-cached from deduce_period(), TTL 30d
 *
 * Reads declared periods from playbook.named_periods.
 *
 * @typedef {object} PeriodMemoryDeps
 * @property {object} workingMemoryAdapter - IWorkingMemory implementation
 * @property {object} [playbookLoader]     - { loadPlaybook(userId) }
 * @property {object} [trendAnalyzer]      - { detectSustained(args) } for deduce
 * @property {number} [deducedTtlMs]
 */
export class PeriodMemory {
  constructor(deps) {
    if (!deps?.workingMemoryAdapter) throw new Error('PeriodMemory requires workingMemoryAdapter');
    this.adapter = deps.workingMemoryAdapter;
    this.playbookLoader = deps.playbookLoader ?? null;
    this.trendAnalyzer = deps.trendAnalyzer ?? null;
    this.deducedTtlMs = deps.deducedTtlMs ?? DEFAULT_DEDUCED_TTL_MS;
  }

  async listPeriods({ userId }) {
    const periods = [];

    // Working memory: remembered + deduced
    const state = await this.adapter.load(AGENT_ID, userId);
    const all = (typeof state?.getAll === 'function') ? state.getAll() : {};
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(PERIOD_REMEMBERED_PREFIX)) {
        const slug = key.slice(PERIOD_REMEMBERED_PREFIX.length);
        periods.push(makeListEntry(slug, value, 'remembered'));
      } else if (key.startsWith(PERIOD_DEDUCED_PREFIX)) {
        const slug = key.slice(PERIOD_DEDUCED_PREFIX.length);
        periods.push(makeListEntry(slug, value, 'deduced'));
      }
    }

    // Playbook: declared
    if (this.playbookLoader) {
      const playbook = await this.playbookLoader.loadPlaybook(userId);
      const named = playbook?.named_periods ?? {};
      for (const [slug, raw] of Object.entries(named)) {
        periods.push({
          slug,
          label: slug,
          from: formatYmd(raw.from),
          to: formatYmd(raw.to),
          source: 'declared',
          description: raw.description ?? null,
        });
      }
    }

    // Sort by slug for stable output
    periods.sort((a, b) => a.slug.localeCompare(b.slug));

    return { periods };
  }

  async rememberPeriod({ userId, slug, from, to, label, description = null }) {
    if (!SLUG_RE.test(slug)) {
      throw new Error(`PeriodMemory: invalid slug "${slug}" (must match ${SLUG_RE})`);
    }
    if (!from || !to) throw new Error('PeriodMemory: from and to are required');
    if (!label) throw new Error('PeriodMemory: label is required');

    const state = await this.adapter.load(AGENT_ID, userId);
    const entry = { from, to, label, description, promotedAt: new Date().toISOString() };
    state.set(`${PERIOD_REMEMBERED_PREFIX}${slug}`, entry);  // no TTL
    await this.adapter.save(AGENT_ID, userId, state);
    return { slug, ...entry };
  }

  async forgetPeriod({ userId, slug }) {
    const state = await this.adapter.load(AGENT_ID, userId);
    state.remove(`${PERIOD_REMEMBERED_PREFIX}${slug}`);
    await this.adapter.save(AGENT_ID, userId, state);
    return { slug, removed: true };
  }

  async deducePeriod({ userId, criteria, max_results = 3 }) {
    if (!this.trendAnalyzer) {
      throw new Error('PeriodMemory.deducePeriod requires trendAnalyzer dep (provides detectSustained)');
    }
    if (!criteria?.metric) throw new Error('PeriodMemory.deducePeriod: criteria.metric is required');
    if (!Number.isFinite(criteria.min_duration_days)) {
      throw new Error('PeriodMemory.deducePeriod: criteria.min_duration_days is required');
    }

    // Map criteria to detectSustained's condition vocabulary.
    let condition;
    if (Array.isArray(criteria.value_range) && criteria.value_range.length === 2) {
      condition = { value_range: criteria.value_range };
    } else if (typeof criteria.field_above === 'number') {
      condition = { field_above: criteria.field_above };
    } else if (typeof criteria.field_below === 'number') {
      condition = { field_below: criteria.field_below };
    } else {
      throw new Error('PeriodMemory.deducePeriod: criteria must include value_range, field_above, or field_below');
    }

    const result = await this.trendAnalyzer.detectSustained({
      userId,
      metric: criteria.metric,
      period: criteria.period ?? { rolling: 'all_time' },
      condition,
      min_duration_days: criteria.min_duration_days,
    });

    const candidates = (result.runs || [])
      .map((run, idx) => ({
        slug: makeAutoSlug(criteria, run, idx),
        from: run.from, to: run.to,
        durationDays: run.durationDays,
        label: makeAutoLabel(criteria, run),
        stats: run.summary,
        score: run.durationDays,  // simple score; longer runs rank higher
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, max_results);

    // Cache each candidate under period.deduced.<slug> with TTL.
    if (candidates.length) {
      const state = await this.adapter.load(AGENT_ID, userId);
      for (const c of candidates) {
        state.set(`${PERIOD_DEDUCED_PREFIX}${c.slug}`,
          { from: c.from, to: c.to, label: c.label, criteria, score: c.score },
          { ttl: this.deducedTtlMs });
      }
      await this.adapter.save(AGENT_ID, userId, state);
    }

    return { criteria, candidates };
  }
}

export default PeriodMemory;

// ---------- helpers ----------

function makeListEntry(slug, value, source) {
  return {
    slug, label: value?.label ?? slug,
    from: value?.from, to: value?.to,
    source,
    description: value?.description ?? null,
  };
}

function makeAutoSlug(criteria, run, idx) {
  const base = criteria.metric.replace(/_/g, '-');
  const yr = run.from.slice(0, 4);
  return `${base}-${yr}-${idx + 1}`;
}

function makeAutoLabel(criteria, run) {
  const metric = criteria.metric;
  if (Array.isArray(criteria.value_range)) {
    return `${metric} in [${criteria.value_range[0]}, ${criteria.value_range[1]}] (${run.from} → ${run.to})`;
  }
  if ('field_above' in criteria) return `${metric} > ${criteria.field_above} (${run.from} → ${run.to})`;
  if ('field_below' in criteria) return `${metric} < ${criteria.field_below} (${run.from} → ${run.to})`;
  return `${metric} (${run.from} → ${run.to})`;
}

function formatYmd(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/PeriodMemory.mjs \
        tests/isolated/domain/health/services/PeriodMemory.test.mjs
git commit -m "feat(health-analytics): PeriodMemory — list/deduce/remember/forget

Plan 4 / Task 3. Three-source period catalog (declared/remembered/deduced)
backed by working memory + playbook. deduce_period delegates to
detectSustained from Plan 3 and caches matches under period.deduced.<slug>
with TTL.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: HistoryReflector — analyze_history

**Files:**
- Create: `backend/src/2_domains/health/services/HistoryReflector.mjs`
- Test: `tests/isolated/domain/health/services/HistoryReflector.test.mjs`

`analyze_history` composes existing primitives:
1. `metric_snapshot({ rolling: 'all_time' })` — overall vital signs
2. For each `{metric, criteria}` in a stock list, `deduce_period(criteria)` → candidates
3. `detect_regime_change` for each headline metric → observations

The stock criteria for Plan 4:
- `weight_lbs` sustained band 5-lb wide (193-197 if focus is 'weight'; else use the median ± 2.5 from current snapshot)
- `tracking_density` sustained > 0.7 for 60+ days

For Plan 4 we ship a SIMPLE composition that calls these primitives and surfaces the results. Future plans can enrich.

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/domain/health/services/HistoryReflector.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HistoryReflector } from '../../../../../backend/src/2_domains/health/services/HistoryReflector.mjs';

function makeReflector(overrides = {}) {
  const aggregator = {
    snapshot: vi.fn(async () => ({
      period: { from: '2020-01-01', to: '2026-05-05', label: 'all_time', source: 'rolling' },
      metrics: [
        { metric: 'weight_lbs', value: 195, daysCovered: 100, daysInPeriod: 1900 },
      ],
    })),
  };
  const trendAnalyzer = {
    detectRegimeChange: vi.fn(async () => ({ changes: [] })),
  };
  const periodMemory = {
    deducePeriod: vi.fn(async () => ({ candidates: [] })),
  };
  return new HistoryReflector({
    aggregator: overrides.aggregator || aggregator,
    trendAnalyzer: overrides.trendAnalyzer || trendAnalyzer,
    periodMemory: overrides.periodMemory || periodMemory,
  });
}

describe('HistoryReflector.analyzeHistory', () => {
  it('returns snapshot + candidates + observations shape', async () => {
    const reflector = makeReflector();
    const out = await reflector.analyzeHistory({ userId: 'kc' });
    expect(out.summary).toBeDefined();
    expect(out.summary.metrics.length).toBeGreaterThan(0);
    expect(Array.isArray(out.candidates)).toBe(true);
    expect(Array.isArray(out.observations)).toBe(true);
  });

  it('focus=weight only runs weight-related criteria', async () => {
    const periodMemory = {
      deducePeriod: vi.fn(async () => ({ candidates: [] })),
    };
    const reflector = makeReflector({ periodMemory });
    await reflector.analyzeHistory({ userId: 'kc', focus: 'weight' });
    // deducePeriod called at least once for weight_lbs
    const calls = periodMemory.deducePeriod.mock.calls.map(c => c[0]?.criteria?.metric);
    expect(calls).toContain('weight_lbs');
    expect(calls).not.toContain('tracking_density');
  });

  it('surfaces regime-change observations as text', async () => {
    const trendAnalyzer = {
      detectRegimeChange: vi.fn(async ({ metric }) => ({
        changes: [
          { date: '2024-08-15', confidence: 0.8, magnitude: 2.5, before: { mean: 200 }, after: { mean: 195 }, description: `mean shifted from 200 to 195` },
        ],
      })),
    };
    const reflector = makeReflector({ trendAnalyzer });
    const out = await reflector.analyzeHistory({ userId: 'kc' });
    expect(out.observations.length).toBeGreaterThan(0);
    const obs = out.observations.join(' ');
    expect(obs).toMatch(/2024-08-15/);
  });

  it('aggregates candidates from periodMemory across criteria', async () => {
    const periodMemory = {
      deducePeriod: vi.fn(async ({ criteria }) => ({
        candidates: [{
          slug: `${criteria.metric}-fake-1`,
          from: '2024-01-01', to: '2024-03-31', durationDays: 90,
          label: 'fake', stats: { mean: 195 }, score: 90,
        }],
      })),
    };
    const reflector = makeReflector({ periodMemory });
    const out = await reflector.analyzeHistory({ userId: 'kc' });
    expect(out.candidates.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Implement HistoryReflector**

```javascript
// backend/src/2_domains/health/services/HistoryReflector.mjs

/**
 * Reflective composition over the analytical primitives. Surfaces a
 * multi-metric snapshot, candidate periods worth remembering, and
 * narrative observations from regime-change detection.
 *
 * @typedef {object} HistoryReflectorDeps
 * @property {object} aggregator    - MetricAggregator (for snapshot)
 * @property {object} trendAnalyzer - MetricTrendAnalyzer (for detectRegimeChange)
 * @property {object} periodMemory  - PeriodMemory (for deducePeriod)
 */
export class HistoryReflector {
  constructor(deps) {
    if (!deps?.aggregator)    throw new Error('HistoryReflector requires aggregator');
    if (!deps?.trendAnalyzer) throw new Error('HistoryReflector requires trendAnalyzer');
    if (!deps?.periodMemory)  throw new Error('HistoryReflector requires periodMemory');
    this.aggregator = deps.aggregator;
    this.trendAnalyzer = deps.trendAnalyzer;
    this.periodMemory = deps.periodMemory;
  }

  /**
   * Scan the user's full history and surface candidate periods + a
   * vital-signs snapshot + narrative observations.
   */
  async analyzeHistory({ userId, focus = null }) {
    const period = { rolling: 'all_time' };

    // 1) Snapshot: vital signs across all_time
    const summary = await this.aggregator.snapshot({ userId, period });

    // 2) Candidates: deduce_period across stock criteria
    const stock = stockCriteriaFor(focus);
    const candidateGroups = await Promise.all(
      stock.map(async (criteria) => {
        try {
          const r = await this.periodMemory.deducePeriod({ userId, criteria });
          return r.candidates || [];
        } catch {
          return [];
        }
      })
    );
    const candidates = candidateGroups.flat();

    // 3) Observations: regime changes in headline metrics
    const observationMetrics = focus === 'weight' ? ['weight_lbs'] :
                               focus === 'nutrition' ? ['calories', 'protein_g'] :
                               focus === 'training' ? ['workout_count'] :
                               ['weight_lbs', 'tracking_density'];

    const observations = [];
    for (const metric of observationMetrics) {
      try {
        const result = await this.trendAnalyzer.detectRegimeChange({
          userId, metric, period, max_results: 2,
        });
        for (const ch of (result.changes || [])) {
          observations.push(`${metric}: ${ch.description ?? `regime change at ${ch.date}`}`);
        }
      } catch { /* best-effort */ }
    }

    return { summary, candidates, observations };
  }
}

export default HistoryReflector;

// ---------- helpers ----------

function stockCriteriaFor(focus) {
  const all = [
    { metric: 'weight_lbs',       value_range: [193, 197], min_duration_days: 30 },
    { metric: 'weight_lbs',       value_range: [188, 192], min_duration_days: 30 },
    { metric: 'tracking_density', field_above: 0.7,        min_duration_days: 60 },
    { metric: 'calories',         field_below: 1800,       min_duration_days: 21 },
  ];
  if (focus === 'weight') return all.filter(c => c.metric === 'weight_lbs');
  if (focus === 'nutrition') return all.filter(c => c.metric === 'calories' || c.metric === 'tracking_density');
  if (focus === 'training') return [];
  return all;
}
```

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/HistoryReflector.mjs \
        tests/isolated/domain/health/services/HistoryReflector.test.mjs
git commit -m "feat(health-analytics): HistoryReflector.analyzeHistory

Plan 4 / Task 4. Composes snapshot + deduce_period + detectRegimeChange
into a single 'reflect on the past' callable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: HealthAnalyticsService — wire PeriodMemory + HistoryReflector

**Files:**
- Modify: `backend/src/2_domains/health/services/HealthAnalyticsService.mjs`
- Modify: `tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs`

The service needs new optional deps: `playbookLoader`, `workingMemoryAdapter`. When present, instantiate `PeriodMemory` + `HistoryReflector` + thread the deps into PeriodResolver.

Pattern: when those deps are absent (CLI without backend wiring), the new methods throw clear errors but the existing methods continue to work.

- [ ] **Step 1: Update HealthAnalyticsService**

```javascript
import { MetricAggregator } from './MetricAggregator.mjs';
import { MetricComparator } from './MetricComparator.mjs';
import { MetricTrendAnalyzer } from './MetricTrendAnalyzer.mjs';
import { PeriodMemory } from './PeriodMemory.mjs';
import { HistoryReflector } from './HistoryReflector.mjs';
import { PeriodResolver } from './PeriodResolver.mjs';

export class HealthAnalyticsService {
  constructor(deps) {
    if (!deps?.healthStore)    throw new Error('HealthAnalyticsService requires healthStore');
    if (!deps?.healthService)  throw new Error('HealthAnalyticsService requires healthService');
    if (!deps?.periodResolver) throw new Error('HealthAnalyticsService requires periodResolver');

    // If the resolver was constructed without playbookLoader/workingMemoryAdapter,
    // and we have those deps, replace it with one that does.
    let periodResolver = deps.periodResolver;
    if ((deps.playbookLoader || deps.workingMemoryAdapter)
        && !periodResolver.playbookLoader && !periodResolver.workingMemoryAdapter) {
      periodResolver = new PeriodResolver({
        now: periodResolver.now,
        playbookLoader: deps.playbookLoader,
        workingMemoryAdapter: deps.workingMemoryAdapter,
      });
    }

    this.aggregator = new MetricAggregator({ ...deps, periodResolver });
    this.comparator = new MetricComparator({
      aggregator: this.aggregator,
      periodResolver,
      healthStore: deps.healthStore,
      healthService: deps.healthService,
    });
    this.trendAnalyzer = new MetricTrendAnalyzer({
      aggregator: this.aggregator,
      periodResolver,
    });

    if (deps.workingMemoryAdapter) {
      this.periodMemory = new PeriodMemory({
        workingMemoryAdapter: deps.workingMemoryAdapter,
        playbookLoader: deps.playbookLoader,
        trendAnalyzer: this.trendAnalyzer,
      });
      this.historyReflector = new HistoryReflector({
        aggregator: this.aggregator,
        trendAnalyzer: this.trendAnalyzer,
        periodMemory: this.periodMemory,
      });
    } else {
      this.periodMemory = null;
      this.historyReflector = null;
    }
  }

  // ... aggregator delegates (5) ...
  // ... comparator delegates (4) ...
  // ... trend analyzer delegates (4) ...

  // PeriodMemory delegates (guarded)
  listPeriods(args) {
    if (!this.periodMemory) throw new Error('HealthAnalyticsService.listPeriods requires workingMemoryAdapter dep');
    return this.periodMemory.listPeriods(args);
  }
  deducePeriod(args) {
    if (!this.periodMemory) throw new Error('HealthAnalyticsService.deducePeriod requires workingMemoryAdapter dep');
    return this.periodMemory.deducePeriod(args);
  }
  rememberPeriod(args) {
    if (!this.periodMemory) throw new Error('HealthAnalyticsService.rememberPeriod requires workingMemoryAdapter dep');
    return this.periodMemory.rememberPeriod(args);
  }
  forgetPeriod(args) {
    if (!this.periodMemory) throw new Error('HealthAnalyticsService.forgetPeriod requires workingMemoryAdapter dep');
    return this.periodMemory.forgetPeriod(args);
  }

  // HistoryReflector delegate (guarded)
  analyzeHistory(args) {
    if (!this.historyReflector) throw new Error('HealthAnalyticsService.analyzeHistory requires workingMemoryAdapter dep');
    return this.historyReflector.analyzeHistory(args);
  }
}

export default HealthAnalyticsService;
```

- [ ] **Step 2: Append test**

```javascript
  it('exposes PeriodMemory + HistoryReflector when workingMemoryAdapter provided', async () => {
    const periodResolver = new PeriodResolver({ now: fixedNow });
    const fakeWMState = { get: () => undefined, set: () => {}, remove: () => {}, getAll: () => ({}) };
    const workingMemoryAdapter = { load: async () => fakeWMState, save: async () => {} };

    const service = new HealthAnalyticsService({
      healthStore: { loadWeightData: vi.fn(async () => ({})), loadNutritionData: vi.fn(async () => ({})) },
      healthService: { getHealthForRange: vi.fn(async () => ({})) },
      periodResolver,
      workingMemoryAdapter,
    });

    expect(typeof service.listPeriods).toBe('function');
    expect(typeof service.deducePeriod).toBe('function');
    expect(typeof service.rememberPeriod).toBe('function');
    expect(typeof service.forgetPeriod).toBe('function');
    expect(typeof service.analyzeHistory).toBe('function');

    const out = await service.listPeriods({ userId: 'kc' });
    expect(out.periods).toEqual([]);
  });

  it('PeriodMemory delegates throw when workingMemoryAdapter is absent', async () => {
    const periodResolver = new PeriodResolver({ now: fixedNow });
    const service = new HealthAnalyticsService({
      healthStore: { loadWeightData: vi.fn(async () => ({})), loadNutritionData: vi.fn(async () => ({})) },
      healthService: { getHealthForRange: vi.fn(async () => ({})) },
      periodResolver,
    });
    expect(() => service.listPeriods({ userId: 'kc' })).toThrow(/workingMemoryAdapter/);
  });
```

- [ ] **Step 3: Run; tests pass.**

- [ ] **Step 4: Commit**

```bash
git add backend/src/2_domains/health/services/HealthAnalyticsService.mjs \
        tests/isolated/domain/health/services/HealthAnalyticsService.test.mjs
git commit -m "feat(health-analytics): wire PeriodMemory + HistoryReflector

Plan 4 / Task 5. Optional workingMemoryAdapter + playbookLoader deps gate
the new period-memory + reflection methods. When absent, the methods
throw a clear error; existing methods continue to work.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: HealthAnalyticsToolFactory — add 5 tools

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs`
- Modify: `tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs`

5 new tools: `list_periods`, `deduce_period`, `remember_period`, `forget_period`, `analyze_history`. Note: the LongitudinalToolFactory in Plan 1 already exposes a `find_similar_period` — we don't duplicate. The other 5 names are unique.

- [ ] **Step 1: Update `makeFactory` defaults to include the 5 new methods**

```javascript
function makeFactory(overrides = {}) {
  const healthAnalyticsService = {
    // ... existing 13 methods ...
    listPeriods:     vi.fn(async () => ({ periods: [] })),
    deducePeriod:    vi.fn(async () => ({ candidates: [] })),
    rememberPeriod:  vi.fn(async () => ({ slug: 'x' })),
    forgetPeriod:    vi.fn(async () => ({ slug: 'x', removed: true })),
    analyzeHistory:  vi.fn(async () => ({ summary: { metrics: [] }, candidates: [], observations: [] })),
    ...overrides,
  };
  return { factory: new HealthAnalyticsToolFactory({ healthAnalyticsService }), healthAnalyticsService };
}
```

- [ ] **Step 2: Append tests**

```javascript
  it('createTools returns 18 tools after Plan 4', () => {
    const { factory } = makeFactory();
    const names = factory.createTools().map(t => t.name).sort();
    expect(names).toContain('list_periods');
    expect(names).toContain('deduce_period');
    expect(names).toContain('remember_period');
    expect(names).toContain('forget_period');
    expect(names).toContain('analyze_history');
    expect(names.length).toBe(18);
  });

  it('list_periods calls service.listPeriods', async () => {
    const m = vi.fn(async () => ({ periods: [] }));
    const { factory } = makeFactory({ listPeriods: m });
    const tool = factory.createTools().find(t => t.name === 'list_periods');
    await tool.execute({ userId: 'kc' });
    expect(m).toHaveBeenCalled();
  });

  it('deduce_period calls service.deducePeriod', async () => {
    const m = vi.fn(async () => ({ candidates: [] }));
    const { factory } = makeFactory({ deducePeriod: m });
    const tool = factory.createTools().find(t => t.name === 'deduce_period');
    await tool.execute({
      userId: 'kc',
      criteria: { metric: 'weight_lbs', value_range: [193, 197], min_duration_days: 30 },
    });
    expect(m).toHaveBeenCalled();
  });

  it('remember_period calls service.rememberPeriod', async () => {
    const m = vi.fn(async () => ({ slug: 'x' }));
    const { factory } = makeFactory({ rememberPeriod: m });
    const tool = factory.createTools().find(t => t.name === 'remember_period');
    await tool.execute({
      userId: 'kc', slug: 'stable-195',
      from: '2024-08-01', to: '2024-11-15', label: 'Stable 195',
    });
    expect(m).toHaveBeenCalled();
  });

  it('forget_period calls service.forgetPeriod', async () => {
    const m = vi.fn(async () => ({ slug: 'x', removed: true }));
    const { factory } = makeFactory({ forgetPeriod: m });
    const tool = factory.createTools().find(t => t.name === 'forget_period');
    await tool.execute({ userId: 'kc', slug: 'stable-195' });
    expect(m).toHaveBeenCalled();
  });

  it('analyze_history calls service.analyzeHistory', async () => {
    const m = vi.fn(async () => ({ summary: { metrics: [] }, candidates: [], observations: [] }));
    const { factory } = makeFactory({ analyzeHistory: m });
    const tool = factory.createTools().find(t => t.name === 'analyze_history');
    await tool.execute({ userId: 'kc' });
    expect(m).toHaveBeenCalled();
  });
```

Update the tool-count test to expect 18.

- [ ] **Step 3: Run; FAIL.**

- [ ] **Step 4: Add 5 tool definitions** at the end of `createTools()` array:

```javascript
      createTool({
        name: 'list_periods',
        description:
          'Enumerate all addressable periods (declared in playbook + ' +
          'remembered + cached deduced). Each entry has slug, label, ' +
          'from, to, source.',
        parameters: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.listPeriods(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'deduce_period',
        description:
          'Find date ranges in history matching a metric criterion. Caches ' +
          'matches under period.deduced.<slug> with a 30-day TTL. Criteria: ' +
          '{ metric, value_range: [min, max], min_duration_days } | ' +
          '{ metric, field_above, min_duration_days } | ' +
          '{ metric, field_below, min_duration_days }.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            criteria: { type: 'object', description: 'Structured criteria; see description.' },
            max_results: { type: 'number', minimum: 1, default: 3 },
          },
          required: ['userId', 'criteria'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.deducePeriod(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'remember_period',
        description:
          'Promote a period into long-lived agent working memory under ' +
          'period.remembered.<slug>. No TTL. Slug must be alphanumeric/' +
          'hyphen, max 64 chars.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            slug: { type: 'string' },
            from: { type: 'string', description: 'YYYY-MM-DD' },
            to:   { type: 'string', description: 'YYYY-MM-DD' },
            label: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['userId', 'slug', 'from', 'to', 'label'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.rememberPeriod(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'forget_period',
        description:
          'Remove a remembered period from agent working memory.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            slug: { type: 'string' },
          },
          required: ['userId', 'slug'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.forgetPeriod(args); }
          catch (err) { return { error: err.message }; }
        },
      }),

      createTool({
        name: 'analyze_history',
        description:
          'Reflective scan: returns multi-metric snapshot, candidate periods ' +
          'worth remembering (from stock criteria), and narrative observations ' +
          'from regime-change detection. Optional `focus` narrows to a domain.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            focus: {
              type: 'string',
              enum: ['weight', 'nutrition', 'training'],
              description: 'Narrow analysis to one domain.',
            },
          },
          required: ['userId'],
        },
        execute: async (args) => {
          try { return await healthAnalyticsService.analyzeHistory(args); }
          catch (err) { return { error: err.message }; }
        },
      }),
```

- [ ] **Step 5: Run; tests pass.**

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/HealthAnalyticsToolFactory.mjs \
        tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs
git commit -m "feat(health-coach): 5 period-memory + reflection tools

Plan 4 / Task 6. list_periods, deduce_period, remember_period, forget_period,
analyze_history.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: cli/commands/health.mjs — add 5 actions

**Files:**
- Modify: `cli/commands/health.mjs`
- Modify: `tests/unit/cli/commands/health.test.mjs`

CLI shape (per spec):
- `dscli health periods list`
- `dscli health periods deduce --metric <m> --range <lo> <hi> --min-duration-days <n>`
- `dscli health periods remember --slug <s> --from <d> --to <d> --label <l> --allow-write`
- `dscli health periods forget --slug <s> --allow-write`
- `dscli health analyze [--focus weight|nutrition|training]`

The `periods` action takes a sub-action (list/deduce/remember/forget). Mirrors how the existing `concierge` command takes sub-actions.

- [ ] **Step 1: Append tests**

```javascript
  describe('periods list action', () => {
    it('emits JSON for `health periods list`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        { subcommand: 'health', positional: ['periods', 'list'], flags: {}, help: false },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            listPeriods: async () => ({ periods: [
              { slug: 'cut-2024', label: '2024 Cut', from: '2024-01-01', to: '2024-04-30', source: 'declared' },
            ] }),
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.periods).toHaveLength(1);
    });
  });

  describe('periods deduce action', () => {
    it('emits JSON for `health periods deduce --metric weight_lbs --range 193 197 --min-duration-days 30`', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['periods', 'deduce'],
          flags: { metric: 'weight_lbs', range: '193 197', 'min-duration-days': '30' },
          help: false,
        },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            deducePeriod: async (args) => { captured = args; return { candidates: [] }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.criteria).toEqual({
        metric: 'weight_lbs',
        value_range: [193, 197],
        min_duration_days: 30,
      });
    });

    it('exits 2 when --metric or --min-duration-days missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        { subcommand: 'health', positional: ['periods', 'deduce'], flags: { metric: 'weight_lbs' }, help: false },
        { stdout, stderr, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
    });
  });

  describe('periods remember action', () => {
    it('requires --allow-write', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['periods', 'remember'],
          flags: { slug: 'stable', from: '2024-01-01', to: '2024-12-31', label: 'Stable' },
          help: false,
        },
        { stdout, stderr, allowWrite: false, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/allow_write_required/);
    });

    it('calls service.rememberPeriod when --allow-write set', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['periods', 'remember'],
          flags: { slug: 'stable', from: '2024-01-01', to: '2024-12-31', label: 'Stable' },
          help: false,
        },
        {
          stdout, stderr, allowWrite: true,
          getHealthAnalytics: async () => ({
            rememberPeriod: async (args) => { captured = args; return { slug: args.slug }; },
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(captured.slug).toBe('stable');
    });
  });

  describe('periods forget action', () => {
    it('requires --allow-write', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        {
          subcommand: 'health',
          positional: ['periods', 'forget'],
          flags: { slug: 'stable' },
          help: false,
        },
        { stdout, stderr, allowWrite: false, getHealthAnalytics: async () => ({}) },
      );
      expect(result.exitCode).toBe(2);
    });

    it('calls service.forgetPeriod when --allow-write set', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      await health.run(
        {
          subcommand: 'health',
          positional: ['periods', 'forget'],
          flags: { slug: 'stable' },
          help: false,
        },
        {
          stdout, stderr, allowWrite: true,
          getHealthAnalytics: async () => ({
            forgetPeriod: async (args) => { captured = args; return { slug: args.slug, removed: true }; },
          }),
        },
      );
      expect(captured.slug).toBe('stable');
    });
  });

  describe('analyze action', () => {
    it('emits JSON for `health analyze`', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await health.run(
        { subcommand: 'health', positional: ['analyze'], flags: {}, help: false },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            analyzeHistory: async () => ({
              summary: { metrics: [{ metric: 'weight_lbs', value: 195 }] },
              candidates: [],
              observations: ['weight_lbs flat across all_time'],
            }),
          }),
        },
      );
      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.observations).toHaveLength(1);
    });

    it('passes --focus through', async () => {
      const { stdout, stderr } = makeBuffers();
      let captured;
      await health.run(
        { subcommand: 'health', positional: ['analyze'], flags: { focus: 'weight' }, help: false },
        {
          stdout, stderr,
          getHealthAnalytics: async () => ({
            analyzeHistory: async (args) => { captured = args; return { summary: { metrics: [] }, candidates: [], observations: [] }; },
          }),
        },
      );
      expect(captured.focus).toBe('weight');
    });
  });
```

- [ ] **Step 2: Run; FAIL.**

- [ ] **Step 3: Implement actions in `cli/commands/health.mjs`**

```javascript
async function actionPeriods(args, deps) {
  const sub = args.positional[1];
  if (!sub || !PERIOD_SUB_ACTIONS[sub]) {
    deps.stderr.write(`dscli health periods: unknown sub-action: ${sub ?? '(none)'}\n`);
    deps.stderr.write(HELP);
    return { exitCode: EXIT_USAGE };
  }
  return PERIOD_SUB_ACTIONS[sub](args, deps);
}

async function actionPeriodsList(args, deps) {
  let svc;
  try { svc = await deps.getHealthAnalytics(); }
  catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  let result;
  try { result = await svc.listPeriods({ userId: resolveUserId(args) }); }
  catch (err) {
    printError(deps.stderr, { error: 'list_periods_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionPeriodsDeduce(args, deps) {
  if (!args.flags.metric) {
    printError(deps.stderr, { error: 'metric_required', message: 'pass --metric <name>.' });
    return { exitCode: EXIT_USAGE };
  }
  if (!args.flags['min-duration-days']) {
    printError(deps.stderr, { error: 'min_duration_required', message: 'pass --min-duration-days <n>.' });
    return { exitCode: EXIT_USAGE };
  }
  const criteria = {
    metric: args.flags.metric,
    min_duration_days: parseInt(args.flags['min-duration-days'], 10),
  };
  if (args.flags.range) {
    const parts = String(args.flags.range).trim().split(/\s+/).map(parseFloat);
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      criteria.value_range = parts;
    } else {
      printError(deps.stderr, { error: 'invalid_range', message: '--range expects "<min> <max>".' });
      return { exitCode: EXIT_USAGE };
    }
  } else if (args.flags['field-above']) {
    criteria.field_above = parseFloat(args.flags['field-above']);
  } else if (args.flags['field-below']) {
    criteria.field_below = parseFloat(args.flags['field-below']);
  } else {
    printError(deps.stderr, { error: 'criteria_required', message: 'pass --range "<min> <max>" or --field-above <v> or --field-below <v>.' });
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
    result = await svc.deducePeriod({
      userId: resolveUserId(args),
      criteria,
      ...(max_results ? { max_results } : {}),
    });
  } catch (err) {
    printError(deps.stderr, { error: 'deduce_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionPeriodsRemember(args, deps) {
  if (!deps.allowWrite) {
    printError(deps.stderr, { error: 'allow_write_required', command: 'periods remember', message: 'Write commands require --allow-write.' });
    return { exitCode: EXIT_USAGE };
  }
  const { slug, from, to, label, description } = args.flags;
  if (!slug || !from || !to || !label) {
    printError(deps.stderr, { error: 'missing_required_flag', message: '--slug, --from, --to, --label are all required.' });
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
    result = await svc.rememberPeriod({
      userId: resolveUserId(args),
      slug, from, to, label, description: description ?? null,
    });
  } catch (err) {
    printError(deps.stderr, { error: 'remember_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }

  // Optional write-audit (matches existing dscli pattern; skip if no auditor)
  try {
    if (deps.getWriteAuditor) {
      const audit = await deps.getWriteAuditor();
      await audit.log({ command: 'health', action: 'periods remember', args: { slug, from, to }, result });
    }
  } catch { /* best-effort */ }

  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionPeriodsForget(args, deps) {
  if (!deps.allowWrite) {
    printError(deps.stderr, { error: 'allow_write_required', command: 'periods forget', message: 'Write commands require --allow-write.' });
    return { exitCode: EXIT_USAGE };
  }
  if (!args.flags.slug) {
    printError(deps.stderr, { error: 'slug_required', message: 'pass --slug <name>.' });
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
    result = await svc.forgetPeriod({ userId: resolveUserId(args), slug: args.flags.slug });
  } catch (err) {
    printError(deps.stderr, { error: 'forget_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }

  try {
    if (deps.getWriteAuditor) {
      const audit = await deps.getWriteAuditor();
      await audit.log({ command: 'health', action: 'periods forget', args: { slug: args.flags.slug }, result });
    }
  } catch { /* best-effort */ }

  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

async function actionAnalyze(args, deps) {
  let svc;
  try { svc = await deps.getHealthAnalytics(); }
  catch (err) {
    printError(deps.stderr, { error: 'config_error', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  let result;
  try {
    result = await svc.analyzeHistory({
      userId: resolveUserId(args),
      ...(args.flags.focus ? { focus: args.flags.focus } : {}),
    });
  } catch (err) {
    printError(deps.stderr, { error: 'analyze_failed', message: err.message });
    return { exitCode: EXIT_FAIL };
  }
  if (result?.error) {
    printError(deps.stderr, { error: 'service_error', message: result.error });
    return { exitCode: EXIT_FAIL };
  }
  printJson(deps.stdout, result);
  return { exitCode: EXIT_OK };
}

const PERIOD_SUB_ACTIONS = {
  list: actionPeriodsList,
  deduce: actionPeriodsDeduce,
  remember: actionPeriodsRemember,
  forget: actionPeriodsForget,
};
```

Add to `ACTIONS`:
```javascript
const ACTIONS = {
  // ... existing ...
  periods: actionPeriods,
  analyze: actionAnalyze,
};
```

Update `HELP` to include the new actions and flags (`periods list/deduce/remember/forget`, `analyze`, `--slug`, `--label`, `--range`, `--field-above`, `--field-below`, `--focus`).

- [ ] **Step 4: Run; tests pass.**

- [ ] **Step 5: Commit**

```bash
git add cli/commands/health.mjs tests/unit/cli/commands/health.test.mjs
git commit -m "feat(dscli): health periods (list/deduce/remember/forget) + analyze

Plan 4 / Task 7. Period memory + reflection commands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: bootstrap.mjs + cli/_bootstrap.mjs — wire new deps

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`
- Modify: `cli/_bootstrap.mjs`

- [ ] **Step 1: bootstrap.mjs**

Find the `HealthAnalyticsService` construction (Plan 1 / Task 11, around line 3019). Pass `playbookLoader` and `workingMemoryAdapter`:

```javascript
    const healthAnalyticsService = new HealthAnalyticsService({
      healthStore,
      healthService,
      periodResolver,
      playbookLoader: personalContextLoader,    // ← new
      workingMemoryAdapter: workingMemory,      // ← new
    });
```

These are the same instances already constructed elsewhere in the bootstrap and passed to `agentOrchestrator.register(HealthCoachAgent, ...)`.

- [ ] **Step 2: cli/_bootstrap.mjs**

In `getHealthAnalytics()`, also wire the new deps. The CLI doesn't have a working memory by default — using the same `YamlWorkingMemoryAdapter` pattern from `getMemory()`:

```javascript
export async function getHealthAnalytics() {
  if (_healthAnalytics) return _healthAnalytics;
  if (_healthAnalyticsInitPromise) return _healthAnalyticsInitPromise;

  _healthAnalyticsInitPromise = (async () => {
    const cfg = await getConfigService();
    const { dataService } = await import('#system/config/index.mjs');

    const { YamlHealthDatastore }    = await import('#adapters/persistence/yaml/YamlHealthDatastore.mjs');
    const { AggregateHealthUseCase } = await import('#apps/health/AggregateHealthUseCase.mjs');
    const { HealthAnalyticsService } = await import('#domains/health/services/HealthAnalyticsService.mjs');
    const { PeriodResolver }         = await import('#domains/health/services/PeriodResolver.mjs');
    const { PersonalContextLoader }  = await import('#apps/health/PersonalContextLoader.mjs');
    const { YamlWorkingMemoryAdapter } = await import('#adapters/agents/YamlWorkingMemoryAdapter.mjs');

    const healthStore    = new YamlHealthDatastore({ dataService, configService: cfg });
    const healthService  = new AggregateHealthUseCase({ healthStore });
    const periodResolver = new PeriodResolver();
    const playbookLoader = new PersonalContextLoader({ dataService, configService: cfg });
    const workingMemoryAdapter = new YamlWorkingMemoryAdapter({ dataService });

    _healthAnalytics = new HealthAnalyticsService({
      healthStore, healthService, periodResolver,
      playbookLoader, workingMemoryAdapter,
    });
    return _healthAnalytics;
  })();

  return _healthAnalyticsInitPromise;
}
```

If `PersonalContextLoader`'s constructor doesn't match this exact shape (it might require additional deps), match the actual constructor signature.

- [ ] **Step 3: Verify**

```bash
node -c backend/src/0_system/bootstrap.mjs
node -c cli/_bootstrap.mjs
```

- [ ] **Step 4: Run all tests on changed files**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/domain/health/services/ \
  tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs \
  tests/isolated/agents/health-coach/HealthCoachAgent.analytics-wiring.test.mjs \
  tests/unit/cli/commands/health.test.mjs \
  tests/unit/cli/_bootstrap.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs cli/_bootstrap.mjs
git commit -m "feat(health-analytics): wire playbook + working memory into service

Plan 4 / Task 8. Backend bootstrap + CLI bootstrap now both pass
playbookLoader and workingMemoryAdapter to HealthAnalyticsService so the
new period-memory + reflection methods light up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: End-to-end smoke verification

- [ ] **Step 1: Run all related tests**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/domain/health/services/ \
  tests/isolated/agents/health-coach/HealthAnalyticsToolFactory.test.mjs \
  tests/unit/cli/commands/health.test.mjs
```

- [ ] **Step 2: `dscli health --help` shows new actions**

```bash
node cli/dscli.mjs health --help
```

Expect: `periods list/deduce/remember/forget` and `analyze` documented.

- [ ] **Step 3: Final empty commit (optional)**

```bash
git commit --allow-empty -m "chore(health-analytics): Plan 4 complete — period memory + reflection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage map

| Spec section | Task |
|---|---|
| Polymorphic period — `{ named: 'X' }` | 1 |
| Polymorphic period — `{ deduced: ... }` | DEFERRED (continues to throw with hint to use deduce_period explicitly) |
| `list_periods` (3 sources merged) | 3, 5, 6, 7 |
| `deduce_period` | 3, 5, 6, 7 |
| `remember_period` | 3, 5, 6, 7 |
| `forget_period` | 3, 5, 6, 7 |
| `analyze_history` | 4, 5, 6, 7 |
| Working-memory wiring (declared/deduced/remembered) | 3, 8 |
| Backend bootstrap | 8 |
| CLI bootstrap | 8 |
