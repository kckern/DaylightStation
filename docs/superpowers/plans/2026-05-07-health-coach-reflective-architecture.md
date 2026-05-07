# Health-Coach Reflective Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the health coach from a fitness-only decision-tree into a reflective agent that traverses fitness + nutrition + weight uniformly through an event abstraction, surfaces the rich data each domain already exposes (HR series, voice memos, meal items, weight trends, Strava maps), and reasons against a working model of the user (rolling baselines + goals + recent context) — so it stops inventing numbers, parroting back questions, and listing facts without analysis.

**Architecture (the abstraction shifts):**

**Shift #1 — Unified domain surface.** Introduce an `EventAdapter` interface implemented by per-domain adapters: `FitnessEventAdapter` (workouts), `NutritionEventAdapter` (meals), `WeightEventAdapter` (weigh-ins). Each adapter exposes three methods: `list(period, filter)`, `detail(id)`, `summary(period)`. `EventQueryService` becomes a dispatcher keyed on `kind`. The coach reasons in events, not in services.

**Shift #2 — Pass-through richness, not thin slices.** `get_event_detail` returns the full domain object (Session.toJSON() / NutriLog / WeightTrend) PLUS coach-friendly structured summaries (HR profile, voice memo transcripts, snapshot refs, treasure stats, map polyline ref, meal item totals). The coach can describe what's actually there.

**Shift #3 — Working model of the user.** New `PersonalBaselineService` rolls daily baselines per domain (typical week's workout cadence, typical run HR profile, typical kcal/day, weight trend slope). Cached at `data/users/<userId>/profile/baselines.yml`, refreshed if older than 24h. Loaded into prompt context every turn alongside profile + recent context. Every event row is annotated with `vs_baseline: { delta, delta_pct, percentile_rank }` so the agent reasons about significance without inventing norms.

**Shift #4 — Reasoning rails over reporting.** Three explicit prompt rails: **citation** (every number traces to a tool result or baseline — no invented numbers), **validation** (when the user offers an interpretation, test against data and confirm or push back), **comparison** (when comparison is asked or implied, always compute the delta — don't just list).

**Tech Stack:** Existing `EventQueryService`, `HealthQueryService`, `SessionService`, `FoodLogService` (nutrition daily/weekly summaries), `healthStore` (weigh-ins via metric query), `dataService` (user YAML), `workingMemoryAdapter` (goals). New `PersonalBaselineService`. Existing tools `query_events`, `get_event_detail`, `query_health`, `compute`, `personal_constants`, `record_playbook`, `update_playbook` — extended with `personal_baselines` and `personal_goals`.

---

## Exit criteria (verifiable end-to-end)

The plan is **not** done until this 6-turn UI-style conversation produces real coaching across multiple domains:

```
Q1: how was my run today?
  Required: numeric HR, bands, drift; vs_baseline delta cited
            ("avg 136 — that's 12 bpm below your typical run pace")

Q2: how does it compare to my runs last week?
  Required: numeric delta with sign for both duration AND HR
            ("Today: 28 min @ 136. Last week's runs (n=6): 35 min avg @ 148.
             So today was 7 min shorter and 12 bpm easier.")

Q3: i took it more easy today
  Required: data-grounded confirmation OR pushback
            ("Yes — your HR averaged 12 bpm below your typical run, no zone 4.")

Q4: what about my weight training? show me my recent strength sessions
  Required: filter works (kind: 'strength' or filter: { type: 'WeightTraining' });
            no fabricated baselines; rich data per session.

Q5: how am I doing on protein this week?
  Required: hits NutritionEventAdapter; reports actual numbers
            ("Avg 132g/day this week, up from 118g/day baseline.")

Q6: any voice memos from my run?
  Required: surfaces snapshots.captures or voice_memo array contents
            ("You recorded one memo at 18:12 — '<transcript>'.")
```

The Task 11 smoke script encodes regex assertions for each turn AND verifies the user model is non-empty in the prompt context.

---

## Phases

| Phase | Goal | Tasks |
|---|---|---|
| 1. Filter + type contract | Stop silent drops + mistyped filters | T1 (filter validation), T2 (canonical kind vocabulary) |
| 2. Domain abstraction | Unified surface across fitness/nutrition/weight | T3 (EventAdapter contract), T4 (FitnessEventAdapter refactor), T5 (NutritionEventAdapter), T6 (WeightEventAdapter) |
| 3. Rich detail pass-through | Surface session richness the fitness UI already shows | T7 (full pass-through + structured summaries) |
| 4. User model | PersonalBaselineService + prompt context | T8 (baselines), T9 (user model loader + tools) |
| 5. Reflection annotations | vs_baseline on every event row | T10 (annotation pass) |
| 6. Reasoning rails + verify | Prompt + multi-turn smoke | T11 (prompt rewrite), T12 (build/deploy/smoke) |

---

## File structure

**New files:**

```
backend/src/3_applications/agents/health-coach/services/
  EventAdapter.mjs                      — interface contract (JSDoc)
  adapters/
    FitnessEventAdapter.mjs             — wraps SessionService (currently in EventQueryService)
    NutritionEventAdapter.mjs           — wraps FoodLogService
    WeightEventAdapter.mjs              — wraps healthStore weigh-ins
  PersonalBaselineService.mjs           — rolling baselines per domain
  UserModelService.mjs                  — composes profile + baselines + recent context

backend/src/3_applications/agents/health-coach/tools/
  PersonalBaselineToolFactory.mjs       — personal_baselines + personal_goals tools
```

**Modified files:**

```
backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs
  — becomes a kind-keyed dispatcher; existing fitness logic moves to FitnessEventAdapter
backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs
  — query_events accepts new kinds (meal, weigh_in); filter validation surfaces tool errors
backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs
  — registers PersonalBaselineToolFactory; consumes UserModelService
backend/src/3_applications/agents/health-coach/prompts/chat.mjs
  — three new rails (citation, validation, comparison); per-tool docs; user model section
backend/src/0_system/bootstrap.mjs
  — wires new adapters + services
```

**New tests:**

```
tests/isolated/agents/health-coach/
  filter_validation/filter_contract.test.mjs
  kind_vocabulary/kind_normalize.test.mjs
  adapters/
    fitness_adapter.test.mjs
    nutrition_adapter.test.mjs
    weight_adapter.test.mjs
  baselines/
    compute_baselines.test.mjs
    baseline_service.test.mjs
  user_model/loader.test.mjs
  annotations/vs_baseline.test.mjs
```

---

## Task 1: Filter contract — validate or throw

The agent passed `filter: "type == 'run'"` (string). The service silently drops it. Validate: filter must be a plain object whose keys are allowed (`type`, `kind`); throw a clear tool error otherwise so the LLM self-corrects on retry.

**Files:**
- Create: `tests/isolated/agents/health-coach/filter_validation/filter_contract.test.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/agents/health-coach/filter_validation/filter_contract.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { EventQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

const makeSvc = (sessions = []) => new EventQueryService({
  sessionService: { listSessionsInRange: vi.fn(async () => sessions) },
  householdId: 'kckern',
});

describe('queryEvents — filter contract', () => {
  it('rejects string filter with a clear error', async () => {
    const svc = makeSvc();
    await expect(svc.queryEvents({ kind: 'workout', period: 'last_7d', filter: "type == 'run'" }))
      .rejects.toThrow(/filter must be an object/i);
  });

  it('rejects array filter', async () => {
    const svc = makeSvc();
    await expect(svc.queryEvents({ kind: 'workout', period: 'last_7d', filter: ['type', 'run'] }))
      .rejects.toThrow(/filter must be an object/i);
  });

  it('rejects unknown filter keys', async () => {
    const svc = makeSvc();
    await expect(svc.queryEvents({ kind: 'workout', period: 'last_7d', filter: { sql: 'foo' } }))
      .rejects.toThrow(/unknown filter key.*sql/i);
  });

  it('accepts undefined filter', async () => {
    const svc = makeSvc([]);
    const r = await svc.queryEvents({ kind: 'workout', period: 'last_7d' });
    expect(r.events).toEqual([]);
  });

  it('accepts valid object filter', async () => {
    const svc = makeSvc([]);
    const r = await svc.queryEvents({ kind: 'workout', period: 'last_7d', filter: { type: 'Run' } });
    expect(r.events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/filter_validation/filter_contract.test.mjs
```

- [ ] **Step 3: Add validation at the top of `queryEvents`**

In `EventQueryService.mjs`, just after the SUPPORTED_KINDS check:

```javascript
const ALLOWED_FILTER_KEYS = new Set(['type', 'kind']);

function validateFilter(filter) {
  if (filter === null || filter === undefined) return;
  if (typeof filter !== 'object' || Array.isArray(filter)) {
    throw new Error(`filter must be an object like { type: 'Run' } or { kind: 'strength' } — got ${typeof filter}: ${JSON.stringify(filter)}`);
  }
  for (const k of Object.keys(filter)) {
    if (!ALLOWED_FILTER_KEYS.has(k)) {
      throw new Error(`unknown filter key "${k}" — allowed keys: ${[...ALLOWED_FILTER_KEYS].join(', ')}`);
    }
  }
}
```

Place `ALLOWED_FILTER_KEYS` and `validateFilter` at module scope (near `SUPPORTED_KINDS`). Call `validateFilter(filter)` at the top of `queryEvents` before the period resolve.

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/filter_validation/filter_contract.test.mjs tests/isolated/agents/health-coach/event_query/
```

Expected: 5 new + 25 existing = 30 pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs \
  tests/isolated/agents/health-coach/filter_validation/filter_contract.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): queryEvents validates filter shape

Plan / Task 1. Reject string filters (was silently dropped) and unknown
keys with a clear error so Mastra surfaces it back to the LLM and the
agent retries with the correct shape. Allowed keys: type, kind.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Canonical kind vocabulary

Strava activity types are inconsistent (`Run`, `TrailRun`, `WeightTraining`, `Workout`, `Ride`, `VirtualRide`, …). Add `normalizeKind(stravaType)` that maps to canonical kinds: `run | strength | cycle | walk | yoga | swim | other`. `query_events` rows carry both `type` (raw) and `kind` (canonical); `filter` accepts either.

**Files:**
- Create: `tests/isolated/agents/health-coach/kind_vocabulary/kind_normalize.test.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/agents/health-coach/kind_vocabulary/kind_normalize.test.mjs
import { describe, it, expect } from 'vitest';
import { normalizeKind } from '../../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

describe('normalizeKind', () => {
  it('maps runs', () => {
    for (const t of ['Run', 'TrailRun', 'VirtualRun']) expect(normalizeKind(t)).toBe('run');
  });
  it('maps cycles', () => {
    for (const t of ['Ride', 'VirtualRide', 'EBikeRide', 'GravelRide', 'MountainBikeRide']) expect(normalizeKind(t)).toBe('cycle');
  });
  it('maps strength', () => {
    for (const t of ['WeightTraining', 'Crossfit', 'Workout']) expect(normalizeKind(t)).toBe('strength');
  });
  it('maps walks', () => {
    for (const t of ['Walk', 'Hike']) expect(normalizeKind(t)).toBe('walk');
  });
  it('maps yoga / swim', () => {
    expect(normalizeKind('Yoga')).toBe('yoga');
    expect(normalizeKind('Swim')).toBe('swim');
  });
  it('maps null/unknown to other', () => {
    expect(normalizeKind(null)).toBe('other');
    expect(normalizeKind('AlpineSki')).toBe('other');
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/kind_vocabulary/kind_normalize.test.mjs
```

- [ ] **Step 3: Implement `normalizeKind` in EventQueryService.mjs**

```javascript
const KIND_MAP = {
  Run: 'run', TrailRun: 'run', VirtualRun: 'run',
  Ride: 'cycle', VirtualRide: 'cycle', EBikeRide: 'cycle', GravelRide: 'cycle', MountainBikeRide: 'cycle',
  WeightTraining: 'strength', Crossfit: 'strength', Workout: 'strength',
  Walk: 'walk', Hike: 'walk',
  Yoga: 'yoga',
  Swim: 'swim',
};

export function normalizeKind(stravaType) {
  if (!stravaType) return 'other';
  return KIND_MAP[stravaType] || 'other';
}
```

Then in `#sessionToEvent`, add `kind: normalizeKind(s.strava?.type)` next to the existing `type`.

In the filter logic inside `queryEvents`, support both keys:

```javascript
if (filter?.type) events = events.filter(e => e.type === filter.type);
if (filter?.kind) events = events.filter(e => e.kind === filter.kind);
```

- [ ] **Step 4: Run; pass + extend query_events tests**

Add to `tests/isolated/agents/health-coach/event_query/query_events.test.mjs`:

```javascript
it('attaches canonical kind to each row', async () => {
  const sessions = [
    { sessionId: '1', startTime: '2026-05-07T06:00:00Z', durationMs: 60_000, strava: { id: 1, type: 'TrailRun' }, metadata: {} },
    { sessionId: '2', startTime: '2026-05-06T06:00:00Z', durationMs: 60_000, strava: { id: 2, type: 'WeightTraining' }, metadata: {} },
  ];
  const svc = new EventQueryService({
    sessionService: { listSessionsInRange: vi.fn(async () => sessions) },
    householdId: 'kckern',
  });
  const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_7d' } });
  expect(r.events[0].kind).toBe('run');
  expect(r.events[1].kind).toBe('strength');
});

it('filters by canonical kind', async () => {
  const sessions = [
    { sessionId: '1', startTime: '2026-05-07T06:00:00Z', durationMs: 60_000, strava: { id: 1, type: 'TrailRun' }, metadata: {} },
    { sessionId: '2', startTime: '2026-05-06T06:00:00Z', durationMs: 60_000, strava: { id: 2, type: 'WeightTraining' }, metadata: {} },
  ];
  const svc = new EventQueryService({
    sessionService: { listSessionsInRange: vi.fn(async () => sessions) },
    householdId: 'kckern',
  });
  const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_7d' }, filter: { kind: 'strength' } });
  expect(r.events).toHaveLength(1);
  expect(r.events[0].type).toBe('WeightTraining');
});
```

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs \
  tests/isolated/agents/health-coach/kind_vocabulary/kind_normalize.test.mjs \
  tests/isolated/agents/health-coach/event_query/query_events.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): canonical kind vocabulary on event rows

Plan / Task 2. Each event row carries both raw Strava type and a
canonical kind ('run' | 'strength' | 'cycle' | 'walk' | 'yoga' |
'swim' | 'other'). Filter accepts { type } (raw) OR { kind }
(canonical) — agent doesn't have to know Strava's type spelling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: EventAdapter contract

Define a JSDoc-typed interface that all per-domain adapters implement. No behavior change — this is the contract that T4-T6 implement.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/services/EventAdapter.mjs`

- [ ] **Step 1: Write the contract**

```javascript
// backend/src/3_applications/agents/health-coach/services/EventAdapter.mjs

/**
 * EventAdapter — domain-agnostic interface for the health coach.
 *
 * Each implementation wraps a domain service (fitness, nutrition, weight) and
 * surfaces three primitives:
 *
 *   list({ period, filter, limit }) → { events: EventRow[], meta }
 *   detail(id) → EventDetail | { error }
 *   summary({ period }) → DomainSummary
 *
 * EventRow shape (consistent across kinds):
 *   {
 *     kind: 'workout' | 'meal' | 'weigh_in',
 *     id: string,                    // primary key for detail()
 *     timestamp: string,             // ISO
 *     date: string,                  // YYYY-MM-DD
 *     label: string,                 // human-readable ("28 min Run", "Lunch — 480 kcal", "175.2 lbs")
 *     scalars: object,               // domain metric snapshot (kcal, hr_avg, weight_lbs, etc.)
 *     vs_baseline?: object,          // attached by Task 10
 *     domain_extras: object,         // domain-specific fields (strava_id, items[], etc.)
 *   }
 *
 * EventDetail shape — pass-through of the domain object PLUS coach-friendly
 * structured summaries. See per-adapter docs.
 */
export class EventAdapter {
  /** @param {{ period, filter?, limit? }} args */
  async list(args) { throw new Error('EventAdapter.list not implemented'); }
  /** @param {string} id */
  async detail(id) { throw new Error('EventAdapter.detail not implemented'); }
  /** @param {{ period }} args */
  async summary(args) { throw new Error('EventAdapter.summary not implemented'); }
}

export const EVENT_KINDS = Object.freeze(['workout', 'meal', 'weigh_in']);
```

- [ ] **Step 2: node -c**

```bash
cd /opt/Code/DaylightStation && node -c backend/src/3_applications/agents/health-coach/services/EventAdapter.mjs && echo OK
```

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation && git add backend/src/3_applications/agents/health-coach/services/EventAdapter.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): EventAdapter interface contract

Plan / Task 3. JSDoc interface that all per-domain adapters implement
(list / detail / summary). Defines the consistent EventRow shape so
the coach reasons in events, not in domain services.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: FitnessEventAdapter — refactor existing logic into adapter

Move the workout-handling logic from `EventQueryService` into a `FitnessEventAdapter`. `EventQueryService` becomes a kind-dispatcher.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/services/adapters/FitnessEventAdapter.mjs`
- Create: `tests/isolated/agents/health-coach/adapters/fitness_adapter.test.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs`

- [ ] **Step 1: Read existing EventQueryService to understand what's moving**

```bash
cd /opt/Code/DaylightStation && cat backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs
```

The methods being relocated:
- The `kind === 'workout'` branch in `queryEvents`
- `getEventDetail` for kind=workout
- `#sessionToEvent`, `#sessionToDetail`, `#hydrate`, `#toIso`, `#resolvePeriod` (period resolver lives in EventQueryService still — see Step 3)

`computeHrStats`, `pickPrimaryHrSeries`, `normalizeKind`, `validateFilter` stay as exports of EventQueryService.mjs (or move to a shared `internals.mjs` — choose whichever keeps imports cleaner).

- [ ] **Step 2: Write tests for FitnessEventAdapter**

```javascript
// tests/isolated/agents/health-coach/adapters/fitness_adapter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { FitnessEventAdapter } from '../../../../../backend/src/3_applications/agents/health-coach/services/adapters/FitnessEventAdapter.mjs';

const FROZEN_NOW = () => new Date('2026-05-07T12:00:00Z');

describe('FitnessEventAdapter', () => {
  it('list returns event rows with kind + id + timestamp + label + scalars', async () => {
    const sessions = [{
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 28 * 60_000,
      strava: { id: 12345, type: 'Run', name: 'Morning Run' },
      metadata: { hr_avg: 142, hr_max: 175, distance_mi: 4.2, kcal: 380 },
    }];
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => sessions),
        getSession: vi.fn(async () => ({ ...sessions[0], timeline: { series: { kc: Array(60).fill(140) } } })),
      },
      householdId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.list({ period: { rolling: 'last_1d' } });
    const e = r.events[0];
    expect(e.kind).toBe('workout');
    expect(e.id).toBe('20260507060000');
    expect(e.label).toMatch(/28.*Run/);
    expect(e.scalars).toEqual(expect.objectContaining({ duration_min: 28, hr_avg: 142, hr_max: 175 }));
    expect(e.domain_extras).toEqual(expect.objectContaining({ strava_id: 12345, type: 'Run', kind_canonical: 'run' }));
    // hydration on n ≤ 3
    expect(e.scalars.hr_stats).toBeDefined();
  });

  it('detail returns the full session JSON pass-through (T7 expands this)', async () => {
    const session = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 28 * 60_000,
      strava: { id: 12345, type: 'Run' }, metadata: { hr_avg: 142 },
      timeline: { series: { kc: [120, 130, 140] }, events: [] },
    };
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => []),
        getSession: vi.fn(async () => session),
      },
      householdId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.detail('20260507060000');
    expect(r.id).toBe('20260507060000');
    expect(r.timeline?.series?.kc).toEqual([120, 130, 140]);
    expect(r.scalars?.hr_stats).toBeDefined();
  });

  it('summary returns domain summary (workouts/week, kinds breakdown)', async () => {
    const sessions = [
      { sessionId: '1', startTime: '2026-05-07T06:00:00Z', durationMs: 30 * 60_000, strava: { type: 'Run' }, metadata: {} },
      { sessionId: '2', startTime: '2026-05-06T06:00:00Z', durationMs: 45 * 60_000, strava: { type: 'WeightTraining' }, metadata: {} },
      { sessionId: '3', startTime: '2026-05-05T06:00:00Z', durationMs: 30 * 60_000, strava: { type: 'Run' }, metadata: {} },
    ];
    const svc = new FitnessEventAdapter({
      sessionService: { listSessionsInRange: vi.fn(async () => sessions) },
      householdId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.summary({ period: { rolling: 'last_7d' } });
    expect(r.n).toBe(3);
    expect(r.by_kind.run).toBe(2);
    expect(r.by_kind.strength).toBe(1);
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/adapters/fitness_adapter.test.mjs
```

- [ ] **Step 4: Implement FitnessEventAdapter**

```javascript
// backend/src/3_applications/agents/health-coach/services/adapters/FitnessEventAdapter.mjs
import { EventAdapter } from '../EventAdapter.mjs';
import { computeHrStats, pickPrimaryHrSeries, normalizeKind, resolvePeriod, toIso } from '../EventQueryService.mjs';

export class FitnessEventAdapter extends EventAdapter {
  #sessionService;
  #householdId;
  #now;

  constructor({ sessionService, householdId, now = () => new Date() }) {
    super();
    if (!sessionService) throw new Error('FitnessEventAdapter: sessionService required');
    this.#sessionService = sessionService;
    this.#householdId = householdId;
    this.#now = now;
  }

  async list({ period, filter, limit }) {
    const { from, to } = resolvePeriod(period, this.#now);
    const sessions = await this.#sessionService.listSessionsInRange(from, to, this.#householdId);
    let events = sessions.map(s => this.#sessionToEvent(s));
    if (filter?.type) events = events.filter(e => e.domain_extras.type === filter.type);
    if (filter?.kind) events = events.filter(e => e.domain_extras.kind_canonical === filter.kind);
    if (limit) events = events.slice(0, limit);
    if (events.length > 0 && events.length <= 3) {
      events = await Promise.all(events.map(e => this.#hydrate(e)));
    }
    return { events, meta: { kind: 'workout', period, n: events.length } };
  }

  async detail(id) {
    if (!id) throw new Error('FitnessEventAdapter: id required');
    const idStr = String(id);
    let session = null;
    if (/^\d{14}$/.test(idStr) && typeof this.#sessionService.getSession === 'function') {
      session = await this.#sessionService.getSession(idStr, this.#householdId).catch(() => null);
    }
    if (!session) {
      // Fallback: scan recent
      const today = this.#now();
      const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const fromDate = new Date(todayUtc); fromDate.setUTCDate(fromDate.getUTCDate() - 60);
      const all = await this.#sessionService.listSessionsInRange(
        fromDate.toISOString().slice(0, 10), todayUtc.toISOString().slice(0, 10), this.#householdId,
      ).catch(() => []);
      session = all.find(s => String(s.sessionId) === idStr || (s.strava && String(s.strava.id) === idStr)) ?? null;
    }
    if (!session) return { error: `event not found for id=${id}` };

    // Pass-through full session shape + add structured summaries (T7 will expand this).
    const baseEvent = this.#sessionToEvent(session);
    const series = pickPrimaryHrSeries(session.timeline?.series);
    const hr_stats = computeHrStats(series);
    return {
      ...baseEvent,
      // Pass-through domain object
      session_full: typeof session.toJSON === 'function' ? session.toJSON() : session,
      timeline: session.timeline ?? null,
      strava: session.strava ?? null,
      strava_notes: session.strava_notes ?? null,
      treasureBox: session.treasureBox ?? null,
      snapshots: session.snapshots ?? null,
      entities: session.entities ?? null,
      summary_block: session.summary ?? null,
      // Coach-friendly summaries (T7 expands)
      scalars: { ...baseEvent.scalars, hr_stats },
    };
  }

  async summary({ period }) {
    const { from, to } = resolvePeriod(period, this.#now);
    const sessions = await this.#sessionService.listSessionsInRange(from, to, this.#householdId);
    const by_kind = {};
    let total_min = 0;
    for (const s of sessions) {
      const k = normalizeKind(s.strava?.type);
      by_kind[k] = (by_kind[k] || 0) + 1;
      if (s.durationMs) total_min += Math.round(s.durationMs / 60000);
    }
    return { n: sessions.length, by_kind, total_min };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  #sessionToEvent(s) {
    const iso = toIso(s.startTime);
    return {
      kind: 'workout',
      id: s.sessionId?.toString?.() ?? String(s.sessionId),
      timestamp: iso,
      date: iso ? iso.slice(0, 10) : null,
      label: `${s.durationMs ? Math.round(s.durationMs / 60000) : '?'} min ${s.strava?.type ?? 'Workout'}`,
      scalars: {
        duration_min: s.durationMs ? Math.round(s.durationMs / 60000) : null,
        kcal: s.metadata?.kcal ?? null,
        hr_avg: s.metadata?.hr_avg ?? null,
        hr_max: s.metadata?.hr_max ?? null,
        distance_mi: s.metadata?.distance_mi ?? null,
      },
      domain_extras: {
        strava_id: s.strava?.id ?? null,
        type: s.strava?.type ?? null,
        kind_canonical: normalizeKind(s.strava?.type),
        name: s.strava?.name ?? null,
        source: s.strava ? 'strava' : 'local',
      },
    };
  }

  async #hydrate(event) {
    if (typeof this.#sessionService.getSession !== 'function') return event;
    let full;
    try { full = await this.#sessionService.getSession(event.id, this.#householdId); } catch { return event; }
    if (!full) return event;
    const series = pickPrimaryHrSeries(full.timeline?.series);
    const hr_stats = computeHrStats(series);
    return {
      ...event,
      scalars: {
        ...event.scalars,
        kcal:        full.metadata?.kcal        ?? event.scalars.kcal,
        hr_avg:      full.metadata?.hr_avg      ?? hr_stats.mean ?? event.scalars.hr_avg,
        hr_max:      full.metadata?.hr_max      ?? hr_stats.max  ?? event.scalars.hr_max,
        distance_mi: full.metadata?.distance_mi ?? event.scalars.distance_mi,
        hr_stats,
      },
    };
  }
}

export default FitnessEventAdapter;
```

- [ ] **Step 5: Refactor EventQueryService into a dispatcher**

```javascript
// backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs

const SUPPORTED_KINDS = new Set(['workout', 'meal', 'weigh_in']);
const ALLOWED_FILTER_KEYS = new Set(['type', 'kind']);

export function validateFilter(filter) { /* T1 implementation */ }

const KIND_MAP = { /* T2 map */ };
export function normalizeKind(stravaType) { /* T2 implementation */ }

export function pickPrimaryHrSeries(seriesMap) { /* existing */ }
export function computeHrStats(series) { /* existing */ }

export function toIso(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return new Date(v).toISOString();
  try { return new Date(v).toISOString(); } catch { return null; }
}

export function resolvePeriod(period, now = () => new Date()) {
  if (typeof period === 'string') return resolvePeriod({ rolling: period }, now);
  if (period?.rolling) {
    const m = /^last_(\d+)d$/.exec(period.rolling);
    if (m) {
      const days = parseInt(m[1], 10);
      const today = now();
      const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const fromDate = new Date(todayUtc); fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
      return { from: fromDate.toISOString().slice(0, 10), to: todayUtc.toISOString().slice(0, 10) };
    }
  }
  if (period?.from && period?.to) return { from: period.from, to: period.to };
  throw new Error(`unsupported period ${JSON.stringify(period)}`);
}

export class EventQueryService {
  #adapters;

  constructor({ adapters }) {
    if (!adapters || typeof adapters !== 'object') throw new Error('EventQueryService: adapters map required');
    this.#adapters = adapters;
  }

  async queryEvents({ kind, period, filter, limit }) {
    if (!SUPPORTED_KINDS.has(kind)) throw new Error(`unsupported kind "${kind}"`);
    validateFilter(filter);
    const adapter = this.#adapters[kind];
    if (!adapter) return { events: [], meta: { kind, period, n: 0 } };
    return adapter.list({ period, filter, limit });
  }

  async getEventDetail({ id, kind = 'workout' }) {
    if (!id) throw new Error('id required');
    if (!SUPPORTED_KINDS.has(kind)) throw new Error(`unsupported kind "${kind}"`);
    const adapter = this.#adapters[kind];
    if (!adapter) return { error: `no adapter for kind ${kind}` };
    return adapter.detail(id);
  }

  async getDomainSummary({ kind, period }) {
    if (!SUPPORTED_KINDS.has(kind)) throw new Error(`unsupported kind "${kind}"`);
    const adapter = this.#adapters[kind];
    if (!adapter) return { kind, n: 0 };
    return adapter.summary({ period });
  }
}

export default EventQueryService;
```

- [ ] **Step 6: Update existing tests for the new dispatcher shape**

Tests under `tests/isolated/agents/health-coach/event_query/` that constructed `new EventQueryService({ sessionService, householdId })` directly need to use the new `{ adapters: { workout: new FitnessEventAdapter({ sessionService, householdId, now }) } }` shape.

```bash
cd /opt/Code/DaylightStation && grep -rln "new EventQueryService" tests/ backend/src/
```

For each test/usage site, swap to the adapter wrapping. Update the field names where rows assert old field positions (e.g. `r.events[0].session_id` → `r.events[0].id` and `r.events[0].domain_extras.strava_id`; `hr_avg` and `hr_max` move from row top-level to `scalars`).

This is a meaningful refactor — test paths to fix:
- `event_query/query_events.test.mjs` (existing)
- `event_query/get_event_detail.test.mjs` (existing)
- `event_query/hr_stats.test.mjs` (no change — pure function tests)
- `event_query/pick_series.test.mjs` (no change)

For each existing assertion: keep the test name but adapt to new shape.

- [ ] **Step 7: Run all health-coach tests; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/services/adapters/FitnessEventAdapter.mjs \
  backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs \
  tests/isolated/agents/health-coach/adapters/fitness_adapter.test.mjs \
  tests/isolated/agents/health-coach/event_query/
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
refactor(health-coach): EventQueryService is a kind-dispatcher; FitnessEventAdapter

Plan / Task 4. Workout-specific logic lives in FitnessEventAdapter
(implements EventAdapter contract). EventQueryService dispatches by
kind. Event row shape unified: { kind, id, timestamp, date, label,
scalars, domain_extras }. Test fixtures updated to match.

This is the foundation for adding meal + weigh_in adapters next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: NutritionEventAdapter

Wraps `FoodLogService` so the agent can query meals + nutrition summaries via `query_events({ kind: 'meal', ... })`.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/services/adapters/NutritionEventAdapter.mjs`
- Create: `tests/isolated/agents/health-coach/adapters/nutrition_adapter.test.mjs`

- [ ] **Step 1: Inspect FoodLogService API**

```bash
cd /opt/Code/DaylightStation && sed -n '1,60p' backend/src/2_domains/nutrition/services/FoodLogService.mjs
cd /opt/Code/DaylightStation && grep -n "^  async\|^  [a-zA-Z]" backend/src/2_domains/nutrition/services/FoodLogService.mjs
```

Confirm methods: `getLogsByDate(userId, date)`, `getLogsInRange(userId, startDate, endDate)`, `getDailySummary(userId, date)`, `getWeeklySummary(userId, weekStart)`, `getLogById(userId, logId)`, `getAcceptedLogs(userId)`.

Inspect the FoodLog/NutriLog entity shape so you can map fields:

```bash
cd /opt/Code/DaylightStation && sed -n '1,60p' backend/src/2_domains/nutrition/entities/NutriLog.mjs
```

You're looking for fields like: `logId`, `timestamp`, `mealType` (breakfast/lunch/dinner/snack), `items[]`, total calories/protein/carbs/fats. Adapt the implementation to match the actual entity.

- [ ] **Step 2: Write tests**

```javascript
// tests/isolated/agents/health-coach/adapters/nutrition_adapter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { NutritionEventAdapter } from '../../../../../backend/src/3_applications/agents/health-coach/services/adapters/NutritionEventAdapter.mjs';

const FROZEN_NOW = () => new Date('2026-05-07T12:00:00Z');

function makeLog({ logId, timestamp, mealType = 'lunch', kcal = 480, protein_g = 32, items = [] }) {
  return { logId, timestamp, mealType, items, totals: { calories: kcal, protein_g, carbs_g: 50, fat_g: 18 } };
}

describe('NutritionEventAdapter', () => {
  it('list returns meal events with kind=meal + scalars from totals', async () => {
    const logs = [
      makeLog({ logId: 'a', timestamp: '2026-05-07T12:30:00Z', mealType: 'lunch', kcal: 480 }),
      makeLog({ logId: 'b', timestamp: '2026-05-07T08:00:00Z', mealType: 'breakfast', kcal: 380 }),
    ];
    const svc = new NutritionEventAdapter({
      foodLogService: {
        getLogsInRange: vi.fn(async () => logs),
        getDailySummary: vi.fn(),
        getWeeklySummary: vi.fn(),
      },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.list({ period: { rolling: 'last_1d' } });
    expect(r.events).toHaveLength(2);
    expect(r.events[0].kind).toBe('meal');
    expect(r.events[0].scalars.kcal).toBe(480);
    expect(r.events[0].scalars.protein_g).toBe(32);
    expect(r.events[0].domain_extras.meal_type).toBe('lunch');
  });

  it('detail returns full log + structured items summary', async () => {
    const log = makeLog({
      logId: 'a', timestamp: '2026-05-07T12:30:00Z', mealType: 'lunch', kcal: 480,
      items: [{ name: 'Chicken thigh', kcal: 280 }, { name: 'Rice', kcal: 200 }],
    });
    const svc = new NutritionEventAdapter({
      foodLogService: { getLogById: vi.fn(async () => log) },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.detail('a');
    expect(r.id).toBe('a');
    expect(r.scalars.kcal).toBe(480);
    expect(r.items_summary.count).toBe(2);
    expect(r.items_summary.top_kcal).toEqual(['Chicken thigh', 'Rice']);
  });

  it('summary returns weekly nutrition aggregate', async () => {
    const svc = new NutritionEventAdapter({
      foodLogService: {
        getWeeklySummary: vi.fn(async () => ({ days: 7, kcal_total: 14_000, kcal_avg: 2000, protein_g_avg: 130 })),
      },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.summary({ period: { rolling: 'last_7d' } });
    expect(r.kcal_avg).toBe(2000);
    expect(r.protein_g_avg).toBe(130);
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/adapters/nutrition_adapter.test.mjs
```

- [ ] **Step 4: Implement**

```javascript
// backend/src/3_applications/agents/health-coach/services/adapters/NutritionEventAdapter.mjs
import { EventAdapter } from '../EventAdapter.mjs';
import { resolvePeriod, toIso } from '../EventQueryService.mjs';

export class NutritionEventAdapter extends EventAdapter {
  #foodLogService;
  #userId;
  #now;

  constructor({ foodLogService, userId, now = () => new Date() }) {
    super();
    if (!foodLogService) throw new Error('NutritionEventAdapter: foodLogService required');
    if (!userId) throw new Error('NutritionEventAdapter: userId required');
    this.#foodLogService = foodLogService;
    this.#userId = userId;
    this.#now = now;
  }

  async list({ period, filter, limit }) {
    const { from, to } = resolvePeriod(period, this.#now);
    const logs = await this.#foodLogService.getLogsInRange(this.#userId, from, to);
    let events = (logs || []).map(l => this.#logToEvent(l));
    if (filter?.type) events = events.filter(e => e.domain_extras.meal_type === filter.type);
    if (filter?.kind) events = events.filter(e => e.domain_extras.meal_type === filter.kind);
    if (limit) events = events.slice(0, limit);
    return { events, meta: { kind: 'meal', period, n: events.length } };
  }

  async detail(id) {
    if (!id) throw new Error('NutritionEventAdapter: id required');
    let log;
    try { log = await this.#foodLogService.getLogById(this.#userId, String(id)); } catch { return { error: `meal not found for id=${id}` }; }
    if (!log) return { error: `meal not found for id=${id}` };
    const base = this.#logToEvent(log);
    const items = log.items || [];
    return {
      ...base,
      log_full: log,
      items_summary: {
        count: items.length,
        names: items.map(i => i?.name).filter(Boolean),
        top_kcal: [...items]
          .filter(i => i && typeof i.kcal === 'number')
          .sort((a, b) => b.kcal - a.kcal)
          .slice(0, 3)
          .map(i => i.name),
      },
    };
  }

  async summary({ period }) {
    const { from, to } = resolvePeriod(period, this.#now);
    // Prefer weekly if range is exactly 7 days; daily otherwise
    if (typeof this.#foodLogService.getWeeklySummary === 'function') {
      try {
        const weekly = await this.#foodLogService.getWeeklySummary(this.#userId, from);
        if (weekly) return { kind: 'meal', period, ...weekly };
      } catch {}
    }
    // Fallback: aggregate from logs
    const logs = await this.#foodLogService.getLogsInRange(this.#userId, from, to).catch(() => []);
    const days = new Set(logs.map(l => (toIso(l.timestamp) ?? '').slice(0, 10))).size || 1;
    const kcal_total = logs.reduce((a, l) => a + (l.totals?.calories || 0), 0);
    const protein_total = logs.reduce((a, l) => a + (l.totals?.protein_g || 0), 0);
    return {
      kind: 'meal', period, days, kcal_total,
      kcal_avg: Math.round(kcal_total / days),
      protein_g_avg: Math.round(protein_total / days),
      n: logs.length,
    };
  }

  #logToEvent(l) {
    const iso = toIso(l.timestamp);
    const kcal = l.totals?.calories ?? null;
    const meal_type = l.mealType || 'meal';
    return {
      kind: 'meal',
      id: l.logId?.toString?.() ?? String(l.logId),
      timestamp: iso,
      date: iso ? iso.slice(0, 10) : null,
      label: `${meal_type} — ${kcal != null ? `${kcal} kcal` : '? kcal'}`,
      scalars: {
        kcal,
        protein_g: l.totals?.protein_g ?? null,
        carbs_g: l.totals?.carbs_g ?? null,
        fat_g: l.totals?.fat_g ?? null,
      },
      domain_extras: {
        meal_type,
        items_count: (l.items || []).length,
      },
    };
  }
}

export default NutritionEventAdapter;
```

NOTE: actual NutriLog field names may differ — read the entity in Step 1 and adjust `#logToEvent`. If totals live at `l.calories` instead of `l.totals.calories`, fix the access; same for protein/carbs/fats.

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/adapters/nutrition_adapter.test.mjs
```

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/services/adapters/NutritionEventAdapter.mjs \
  tests/isolated/agents/health-coach/adapters/nutrition_adapter.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): NutritionEventAdapter — meals as events

Plan / Task 5. Wraps FoodLogService. query_events({ kind: 'meal' })
now lists meals with kcal + protein + carbs + fat scalars.
get_event_detail returns full log + structured items_summary.
getDomainSummary returns weekly aggregate (kcal_avg, protein_g_avg).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: WeightEventAdapter

Wraps `healthStore` weigh-in records.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/services/adapters/WeightEventAdapter.mjs`
- Create: `tests/isolated/agents/health-coach/adapters/weight_adapter.test.mjs`

- [ ] **Step 1: Find weigh-in API on healthStore / healthService**

```bash
cd /opt/Code/DaylightStation && grep -rn "weight\|getMetric\|metric.*weight" backend/src/2_domains/health/ backend/src/3_applications/health/ backend/src/1_adapters/persistence/yaml/YamlHealthDatastore.mjs 2>&1 | head -20
```

Identify the read path: likely `healthStore.getMetricInRange('weight_lbs', from, to, userId)` or `healthService.getHealthForRange(userId, from, to)` returning days with `weigh_ins`.

- [ ] **Step 2: Write tests**

```javascript
// tests/isolated/agents/health-coach/adapters/weight_adapter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { WeightEventAdapter } from '../../../../../backend/src/3_applications/agents/health-coach/services/adapters/WeightEventAdapter.mjs';

const FROZEN_NOW = () => new Date('2026-05-07T12:00:00Z');

describe('WeightEventAdapter', () => {
  it('list returns weigh-in events with kind=weigh_in', async () => {
    const points = [
      { date: '2026-05-07', weight_lbs: 175.2 },
      { date: '2026-05-06', weight_lbs: 175.6 },
    ];
    const svc = new WeightEventAdapter({
      healthService: { getHealthMetric: vi.fn(async () => points) },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.list({ period: { rolling: 'last_7d' } });
    expect(r.events).toHaveLength(2);
    expect(r.events[0].kind).toBe('weigh_in');
    expect(r.events[0].scalars.weight_lbs).toBe(175.2);
    expect(r.events[0].label).toMatch(/175\.2/);
  });

  it('summary returns trend slope + trim mean', async () => {
    const points = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      weight_lbs: 175 + (i * 0.05),       // gentle uptrend
    }));
    const svc = new WeightEventAdapter({
      healthService: { getHealthMetric: vi.fn(async () => points) },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.summary({ period: { rolling: 'last_30d' } });
    expect(r.n).toBe(30);
    expect(r.trim_mean).toBeCloseTo(175.7, 0);
    expect(r.slope_lbs_per_30d).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/adapters/weight_adapter.test.mjs
```

- [ ] **Step 4: Implement**

```javascript
// backend/src/3_applications/agents/health-coach/services/adapters/WeightEventAdapter.mjs
import { EventAdapter } from '../EventAdapter.mjs';
import { resolvePeriod } from '../EventQueryService.mjs';

export class WeightEventAdapter extends EventAdapter {
  #healthService;
  #userId;
  #now;

  constructor({ healthService, userId, now = () => new Date() }) {
    super();
    if (!healthService) throw new Error('WeightEventAdapter: healthService required');
    if (!userId) throw new Error('WeightEventAdapter: userId required');
    this.#healthService = healthService;
    this.#userId = userId;
    this.#now = now;
  }

  async list({ period, filter, limit }) {
    const { from, to } = resolvePeriod(period, this.#now);
    const points = await this.#healthService.getHealthMetric(this.#userId, 'weight_lbs', from, to).catch(() => []);
    let events = (points || []).map(p => this.#pointToEvent(p));
    if (limit) events = events.slice(0, limit);
    return { events, meta: { kind: 'weigh_in', period, n: events.length } };
  }

  async detail(id) {
    // weigh-ins are point measurements; detail = the row + recent context (5d window)
    if (!id) throw new Error('WeightEventAdapter: id required');
    const date = String(id).slice(0, 10);
    const target = new Date(date + 'T00:00:00Z');
    const fromDate = new Date(target); fromDate.setUTCDate(fromDate.getUTCDate() - 4);
    const toDate = new Date(target); toDate.setUTCDate(toDate.getUTCDate() + 1);
    const points = await this.#healthService.getHealthMetric(this.#userId, 'weight_lbs',
      fromDate.toISOString().slice(0, 10), toDate.toISOString().slice(0, 10)).catch(() => []);
    const focal = points.find(p => p.date === date);
    if (!focal) return { error: `weigh-in not found for date=${date}` };
    return {
      ...this.#pointToEvent(focal),
      context_window: points,    // 5-day window around the focal point
    };
  }

  async summary({ period }) {
    const { from, to } = resolvePeriod(period, this.#now);
    const points = await this.#healthService.getHealthMetric(this.#userId, 'weight_lbs', from, to).catch(() => []);
    const xs = points.map(p => p.weight_lbs).filter(v => Number.isFinite(v));
    if (xs.length === 0) return { kind: 'weigh_in', period, n: 0 };
    // Trim mean (drop top + bottom 10%)
    const sorted = [...xs].sort((a, b) => a - b);
    const trimN = Math.floor(sorted.length * 0.1);
    const trimmed = sorted.slice(trimN, sorted.length - trimN);
    const trim_mean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    // Slope: simple linear fit
    let slope = 0;
    if (xs.length >= 2) {
      const xMean = (xs.length - 1) / 2;
      const yMean = xs.reduce((a, b) => a + b, 0) / xs.length;
      let num = 0, den = 0;
      for (let i = 0; i < xs.length; i++) {
        num += (i - xMean) * (xs[i] - yMean);
        den += (i - xMean) * (i - xMean);
      }
      slope = den > 0 ? num / den : 0;
    }
    return {
      kind: 'weigh_in', period, n: xs.length,
      trim_mean: Math.round(trim_mean * 10) / 10,
      slope_lbs_per_30d: Math.round(slope * 30 * 100) / 100,
    };
  }

  #pointToEvent(p) {
    return {
      kind: 'weigh_in',
      id: p.date,
      timestamp: p.date + 'T00:00:00Z',
      date: p.date,
      label: `${p.weight_lbs} lbs`,
      scalars: { weight_lbs: p.weight_lbs },
      domain_extras: {},
    };
  }
}

export default WeightEventAdapter;
```

If `healthService.getHealthMetric` doesn't exist, look at what's actually available (`getHealthForRange` probably returns a `{date: {weight_lbs, ...}}` map) and adapt the `list/summary` method. The adapter shape stays the same; only the internal data fetch changes.

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/adapters/weight_adapter.test.mjs
```

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/services/adapters/WeightEventAdapter.mjs \
  tests/isolated/agents/health-coach/adapters/weight_adapter.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): WeightEventAdapter — weigh-ins as events

Plan / Task 6. Wraps healthService weight metric. query_events({
kind: 'weigh_in' }) lists daily weights. getDomainSummary returns
trim mean + slope (lbs/30d) for trend reasoning.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Rich detail pass-through + structured summaries

Currently `detail()` returns a thin slice. Now: pass through the full domain object (Session.toJSON / log) AND attach coach-friendly structured summaries (voice memo transcripts, snapshot refs, treasure stats, strava map ref, items breakdown) so the agent can describe the richness.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/services/adapters/FitnessEventAdapter.mjs`

- [ ] **Step 1: Read what's actually in snapshots, treasureBox, strava on real sessions**

```bash
cd /opt/Code/DaylightStation && sudo docker exec daylight-station sh -c 'cat data/sessions/default/2026-05/*.yml 2>/dev/null | head -120'
```

Note the actual shape of `snapshots.captures` (have `transcript`? `imageUrl`?), `treasureBox` (has `totalCoins`, `buckets`?), `strava` (has `map.summary_polyline`? `start_latlng`? `gear`?). Adapt the structured summary fields below to match.

- [ ] **Step 2: Add tests for the rich detail surface**

Append to `tests/isolated/agents/health-coach/adapters/fitness_adapter.test.mjs`:

```javascript
describe('FitnessEventAdapter.detail — rich surface', () => {
  it('surfaces voice memo transcripts from snapshots', async () => {
    const session = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 60_000,
      strava: { id: 1, type: 'Run' }, metadata: {},
      timeline: { series: { kc: [120] }, events: [] },
      snapshots: {
        captures: [
          { type: 'voice_memo', timestamp: 1746599400000, transcript: 'feeling strong, picking up pace' },
          { type: 'screenshot', timestamp: 1746599700000, imageRef: '/media/sessions/.../shot.jpg' },
        ],
      },
    };
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => []),
        getSession: vi.fn(async () => session),
      },
      householdId: 'kckern',
    });
    const r = await svc.detail('20260507060000');
    expect(r.voice_memos).toHaveLength(1);
    expect(r.voice_memos[0].transcript).toBe('feeling strong, picking up pace');
    expect(r.snapshot_refs).toHaveLength(1);
  });

  it('surfaces treasureBox stats', async () => {
    const session = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 60_000,
      strava: { id: 1, type: 'Run' }, metadata: {},
      timeline: { series: {}, events: [] },
      treasureBox: { totalCoins: 47, coinTimeUnitMs: 5000, buckets: { z2: 23, z3: 18, z4: 6 } },
    };
    const svc = new FitnessEventAdapter({
      sessionService: { listSessionsInRange: vi.fn(async () => []), getSession: vi.fn(async () => session) },
      householdId: 'kckern',
    });
    const r = await svc.detail('20260507060000');
    expect(r.treasure_stats).toEqual({ total_coins: 47, buckets: { z2: 23, z3: 18, z4: 6 } });
  });

  it('surfaces strava map polyline + gear if present', async () => {
    const session = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 60_000,
      strava: {
        id: 1, type: 'Run', name: 'Morning Run',
        map: { summary_polyline: 'abc123' },
        start_latlng: [47.5, -122.0],
        total_elevation_gain: 45,
        gear: { name: 'Asics Cumulus 25' },
      },
      metadata: {},
      timeline: { series: {}, events: [] },
    };
    const svc = new FitnessEventAdapter({
      sessionService: { listSessionsInRange: vi.fn(async () => []), getSession: vi.fn(async () => session) },
      householdId: 'kckern',
    });
    const r = await svc.detail('20260507060000');
    expect(r.strava_summary.map_polyline).toBe('abc123');
    expect(r.strava_summary.gear).toBe('Asics Cumulus 25');
    expect(r.strava_summary.elevation_gain_m).toBe(45);
    expect(r.strava_summary.start_latlng).toEqual([47.5, -122.0]);
  });
});
```

- [ ] **Step 3: Extend FitnessEventAdapter.detail**

In `FitnessEventAdapter.mjs`, replace the existing `detail` method's return statement to include structured summaries:

```javascript
return {
  ...baseEvent,
  // Pass-through full session shape
  session_full: typeof session.toJSON === 'function' ? session.toJSON() : session,
  timeline: session.timeline ?? null,
  strava: session.strava ?? null,
  strava_notes: session.strava_notes ?? null,
  treasureBox: session.treasureBox ?? null,
  snapshots: session.snapshots ?? null,
  entities: session.entities ?? null,
  summary_block: session.summary ?? null,
  // Coach-friendly structured summaries
  scalars: { ...baseEvent.scalars, hr_stats },
  voice_memos: this.#extractVoiceMemos(session),
  snapshot_refs: this.#extractSnapshotRefs(session),
  treasure_stats: this.#extractTreasureStats(session),
  strava_summary: this.#extractStravaSummary(session),
};
```

Add these private methods:

```javascript
#extractVoiceMemos(session) {
  const captures = session.snapshots?.captures ?? [];
  return captures
    .filter(c => c?.type === 'voice_memo' || c?.transcript)
    .map(c => ({ timestamp: c.timestamp, transcript: c.transcript ?? null }));
}

#extractSnapshotRefs(session) {
  const captures = session.snapshots?.captures ?? [];
  return captures
    .filter(c => c?.type !== 'voice_memo' && (c?.imageRef || c?.imageUrl))
    .map(c => ({ timestamp: c.timestamp, ref: c.imageRef ?? c.imageUrl }));
}

#extractTreasureStats(session) {
  if (!session.treasureBox) return null;
  return {
    total_coins: session.treasureBox.totalCoins ?? 0,
    buckets: session.treasureBox.buckets ?? null,
  };
}

#extractStravaSummary(session) {
  const s = session.strava;
  if (!s) return null;
  return {
    id: s.id ?? null,
    name: s.name ?? null,
    type: s.type ?? null,
    map_polyline: s.map?.summary_polyline ?? null,
    start_latlng: s.start_latlng ?? null,
    elevation_gain_m: s.total_elevation_gain ?? null,
    gear: s.gear?.name ?? null,
    description: s.description ?? null,
  };
}
```

If real session shapes diverge (e.g. `snapshots.captures` items have a `kind` instead of `type` field, or voice memos live elsewhere), adjust based on what Step 1 revealed.

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/adapters/fitness_adapter.test.mjs
```

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/services/adapters/FitnessEventAdapter.mjs \
  tests/isolated/agents/health-coach/adapters/fitness_adapter.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): FitnessEventAdapter.detail — voice memos, treasure, strava summary

Plan / Task 7. detail() now passes through the full Session.toJSON()
PLUS structured coach summaries: voice_memos[], snapshot_refs[],
treasure_stats, strava_summary (map polyline + gear + elevation +
start_latlng). The agent can describe runs the way the fitness UI
already does.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: PersonalBaselineService

Rolls baselines per domain from history. Cached at `data/users/<userId>/profile/baselines.yml`. Refreshed when older than 24h.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/services/PersonalBaselineService.mjs`
- Create: `tests/isolated/agents/health-coach/baselines/compute_baselines.test.mjs`
- Create: `tests/isolated/agents/health-coach/baselines/baseline_service.test.mjs`

- [ ] **Step 1: Tests for pure baseline computation**

```javascript
// tests/isolated/agents/health-coach/baselines/compute_baselines.test.mjs
import { describe, it, expect } from 'vitest';
import { computeFitnessBaseline, computeNutritionBaseline, computeWeightBaseline } from '../../../../../backend/src/3_applications/agents/health-coach/services/PersonalBaselineService.mjs';

describe('computeFitnessBaseline', () => {
  it('rolls workouts/week by kind from session list', () => {
    const sessions = [
      // 90-day window simulated; only counts matter for cadence
      ...Array(12).fill(null).map((_, i) => ({ kind: 'run', duration_min: 35, hr_avg: 148, hr_max: 172, distance_mi: 4.5 })),
      ...Array(8).fill(null).map(() => ({ kind: 'strength', duration_min: 30 })),
    ];
    const r = computeFitnessBaseline({ events: sessions, period_days: 90 });
    expect(r.workouts_per_week_total).toBeCloseTo(1.55, 1); // 20/90*7
    expect(r.workouts_per_week_by_kind.run).toBeCloseTo(0.93, 1);  // 12/90*7
    expect(r.run.median_duration_min).toBe(35);
    expect(r.run.median_hr_avg).toBe(148);
  });

  it('handles empty input', () => {
    const r = computeFitnessBaseline({ events: [], period_days: 90 });
    expect(r.workouts_per_week_total).toBe(0);
    expect(r.run).toBe(null);
  });
});

describe('computeNutritionBaseline', () => {
  it('returns kcal_avg + protein_g_avg from log totals', () => {
    const logs = [
      { date: '2026-04-01', totals: { calories: 2200, protein_g: 130 } },
      { date: '2026-04-02', totals: { calories: 2400, protein_g: 140 } },
      { date: '2026-04-03', totals: { calories: 2000, protein_g: 120 } },
    ];
    const r = computeNutritionBaseline({ logs, period_days: 30 });
    expect(r.kcal_avg).toBeCloseTo(2200, 0);
    expect(r.protein_g_avg).toBeCloseTo(130, 0);
  });
});

describe('computeWeightBaseline', () => {
  it('returns trim mean + slope', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, weight_lbs: 175 + (i * 0.05) }));
    const r = computeWeightBaseline({ points, period_days: 30 });
    expect(r.trim_mean).toBeCloseTo(175.7, 0);
    expect(r.slope_lbs_per_30d).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/baselines/compute_baselines.test.mjs
```

- [ ] **Step 3: Implement pure functions in PersonalBaselineService.mjs**

```javascript
// backend/src/3_applications/agents/health-coach/services/PersonalBaselineService.mjs

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function computeFitnessBaseline({ events, period_days }) {
  if (!events?.length) {
    return {
      n: 0,
      period_days,
      workouts_per_week_total: 0,
      workouts_per_week_by_kind: {},
      run: null,
      strength: null,
    };
  }
  const by_kind = {};
  for (const e of events) {
    const k = e.kind || 'other';
    by_kind[k] = (by_kind[k] || 0) + 1;
  }
  const weeks = period_days / 7;
  const workouts_per_week_by_kind = Object.fromEntries(
    Object.entries(by_kind).map(([k, n]) => [k, Math.round((n / weeks) * 100) / 100])
  );
  const workouts_per_week_total = Math.round((events.length / weeks) * 100) / 100;

  const runs = events.filter(e => e.kind === 'run' && e.duration_min);
  const run = runs.length ? {
    n: runs.length,
    median_duration_min: median(runs.map(e => e.duration_min)),
    median_hr_avg: median(runs.map(e => e.hr_avg).filter(Number.isFinite)),
    median_hr_max: median(runs.map(e => e.hr_max).filter(Number.isFinite)),
    median_distance_mi: median(runs.map(e => e.distance_mi).filter(Number.isFinite)),
  } : null;

  const strs = events.filter(e => e.kind === 'strength' && e.duration_min);
  const strength = strs.length ? { n: strs.length, median_duration_min: median(strs.map(e => e.duration_min)) } : null;

  return { n: events.length, period_days, workouts_per_week_total, workouts_per_week_by_kind, run, strength };
}

export function computeNutritionBaseline({ logs, period_days }) {
  if (!logs?.length) return { n: 0, period_days, kcal_avg: null, protein_g_avg: null };
  const days = new Set(logs.map(l => (l.date || (l.timestamp || '').slice(0, 10)))).size || 1;
  const kcal_total = logs.reduce((a, l) => a + (l.totals?.calories || 0), 0);
  const protein_total = logs.reduce((a, l) => a + (l.totals?.protein_g || 0), 0);
  return {
    n: logs.length, period_days, days,
    kcal_avg: Math.round(kcal_total / days),
    protein_g_avg: Math.round(protein_total / days),
  };
}

export function computeWeightBaseline({ points, period_days }) {
  if (!points?.length) return { n: 0, period_days, trim_mean: null, slope_lbs_per_30d: null };
  const xs = points.map(p => p.weight_lbs).filter(Number.isFinite);
  if (xs.length === 0) return { n: 0, period_days, trim_mean: null, slope_lbs_per_30d: null };
  const sorted = [...xs].sort((a, b) => a - b);
  const trimN = Math.floor(sorted.length * 0.1);
  const trimmed = sorted.slice(trimN, sorted.length - trimN);
  const trim_mean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  let slope = 0;
  if (xs.length >= 2) {
    const xMean = (xs.length - 1) / 2;
    const yMean = xs.reduce((a, b) => a + b, 0) / xs.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (i - xMean) * (xs[i] - yMean);
      den += (i - xMean) * (i - xMean);
    }
    slope = den > 0 ? num / den : 0;
  }
  return {
    n: xs.length, period_days,
    trim_mean: Math.round(trim_mean * 10) / 10,
    slope_lbs_per_30d: Math.round(slope * 30 * 100) / 100,
  };
}

export class PersonalBaselineService {
  #adapters;
  #dataService;
  #cacheTtlMs;
  #now;

  constructor({ adapters, dataService, cacheTtlMs = 24 * 60 * 60_000, now = () => new Date() }) {
    if (!adapters) throw new Error('PersonalBaselineService: adapters map required');
    if (!dataService) throw new Error('PersonalBaselineService: dataService required');
    this.#adapters = adapters;
    this.#dataService = dataService;
    this.#cacheTtlMs = cacheTtlMs;
    this.#now = now;
  }

  async getBaselines({ userId }) {
    const cached = await this.#readCache(userId);
    if (cached && this.#isFresh(cached)) return cached;
    const fresh = await this.#computeAll(userId);
    await this.#writeCache(userId, fresh);
    return fresh;
  }

  async #computeAll(userId) {
    const period = { rolling: 'last_90d' };
    const [fit, nut, wt] = await Promise.all([
      this.#adapters.workout?.list({ period, limit: 10_000 }).catch(() => ({ events: [] })),
      this.#adapters.meal?.list({ period: { rolling: 'last_30d' }, limit: 10_000 }).catch(() => ({ events: [] })),
      this.#adapters.weigh_in?.list({ period: { rolling: 'last_30d' }, limit: 10_000 }).catch(() => ({ events: [] })),
    ]);
    const fitnessEvents = (fit?.events || []).map(e => ({
      kind: e.domain_extras?.kind_canonical || 'other',
      duration_min: e.scalars?.duration_min ?? null,
      hr_avg: e.scalars?.hr_avg ?? null,
      hr_max: e.scalars?.hr_max ?? null,
      distance_mi: e.scalars?.distance_mi ?? null,
    }));
    const nutritionLogs = (nut?.events || []).map(e => ({
      date: e.date,
      totals: { calories: e.scalars?.kcal, protein_g: e.scalars?.protein_g },
    }));
    const weightPoints = (wt?.events || []).map(e => ({ date: e.date, weight_lbs: e.scalars?.weight_lbs }));
    return {
      computed_at: this.#now().toISOString(),
      fitness: computeFitnessBaseline({ events: fitnessEvents, period_days: 90 }),
      nutrition: computeNutritionBaseline({ logs: nutritionLogs, period_days: 30 }),
      weight: computeWeightBaseline({ points: weightPoints, period_days: 30 }),
    };
  }

  #isFresh(cached) {
    if (!cached?.computed_at) return false;
    const age = this.#now().getTime() - new Date(cached.computed_at).getTime();
    return age < this.#cacheTtlMs;
  }

  async #readCache(userId) {
    try { return await this.#dataService.user.read('profile/baselines', userId); }
    catch { return null; }
  }

  async #writeCache(userId, payload) {
    try { await this.#dataService.user.write('profile/baselines', payload, userId); }
    catch (e) { /* non-fatal */ }
  }
}

export default PersonalBaselineService;
```

NOTE: `dataService.user.read/write` API: signature is `read(path, username)` / `write(path, payload, username)` — confirmed from the previous reasoning-architecture plan.

- [ ] **Step 4: Tests for caching behavior**

```javascript
// tests/isolated/agents/health-coach/baselines/baseline_service.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { PersonalBaselineService } from '../../../../../backend/src/3_applications/agents/health-coach/services/PersonalBaselineService.mjs';

const FROZEN_NOW = () => new Date('2026-05-07T12:00:00Z');

function makeSvc({ workoutAdapter, mealAdapter, weighinAdapter, dataService }) {
  return new PersonalBaselineService({
    adapters: { workout: workoutAdapter, meal: mealAdapter, weigh_in: weighinAdapter },
    dataService,
    now: FROZEN_NOW,
  });
}

describe('PersonalBaselineService', () => {
  it('returns cached baselines when fresh', async () => {
    const cached = { computed_at: '2026-05-07T08:00:00Z', fitness: { n: 0 }, nutrition: { n: 0 }, weight: { n: 0 } };
    const dataService = { user: { read: vi.fn(async () => cached), write: vi.fn() } };
    const workoutAdapter = { list: vi.fn(async () => ({ events: [] })) };
    const svc = makeSvc({ workoutAdapter, dataService });
    const r = await svc.getBaselines({ userId: 'kckern' });
    expect(r).toBe(cached);
    expect(workoutAdapter.list).not.toHaveBeenCalled();
  });

  it('recomputes when cache is stale', async () => {
    const cached = { computed_at: '2026-05-01T08:00:00Z', fitness: {} };
    const dataService = {
      user: { read: vi.fn(async () => cached), write: vi.fn(async () => {}) },
    };
    const workoutAdapter = { list: vi.fn(async () => ({ events: [] })) };
    const mealAdapter = { list: vi.fn(async () => ({ events: [] })) };
    const weighinAdapter = { list: vi.fn(async () => ({ events: [] })) };
    const svc = makeSvc({ workoutAdapter, mealAdapter, weighinAdapter, dataService });
    const r = await svc.getBaselines({ userId: 'kckern' });
    expect(workoutAdapter.list).toHaveBeenCalled();
    expect(dataService.user.write).toHaveBeenCalledWith('profile/baselines', expect.any(Object), 'kckern');
    expect(r.computed_at).toBe('2026-05-07T12:00:00.000Z');
  });
});
```

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/baselines/
```

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/services/PersonalBaselineService.mjs \
  tests/isolated/agents/health-coach/baselines/
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): PersonalBaselineService — rolling baselines per domain

Plan / Task 8. Computes fitness baseline (workouts/week by kind,
median run profile), nutrition baseline (kcal_avg, protein_g_avg
over 30d), weight baseline (trim mean + 30d slope) by composing the
domain adapters. Caches to data/users/<userId>/profile/baselines.yml,
refreshed if older than 24h.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: User model loader + tools

Inject the user model (profile + baselines + recent context) into the agent's system prompt every turn. Also expose `personal_baselines` and `personal_goals` tools so the agent can re-query if needed.

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/services/UserModelService.mjs`
- Create: `tests/isolated/agents/health-coach/user_model/loader.test.mjs`
- Create: `backend/src/3_applications/agents/health-coach/tools/PersonalBaselineToolFactory.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/prompts/chat.mjs`

- [ ] **Step 1: Tests for UserModelService.composeContext**

```javascript
// tests/isolated/agents/health-coach/user_model/loader.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { UserModelService } from '../../../../../backend/src/3_applications/agents/health-coach/services/UserModelService.mjs';

describe('UserModelService.composeContext', () => {
  it('composes a markdown block of profile + baselines', async () => {
    const profile = { weight_lbs: 175, height_cm: 180, age: 38, sex: 'M' };
    const baselines = {
      computed_at: '2026-05-07T08:00:00Z',
      fitness: {
        workouts_per_week_total: 4.2,
        workouts_per_week_by_kind: { run: 2.5, strength: 1.5, walk: 0.2 },
        run: { median_duration_min: 35, median_hr_avg: 148, median_hr_max: 172 },
      },
      nutrition: { kcal_avg: 2200, protein_g_avg: 130 },
      weight: { trim_mean: 175.4, slope_lbs_per_30d: -0.5 },
    };
    const svc = new UserModelService({
      personalConstantsService: { get: vi.fn(async () => profile) },
      baselineService: { getBaselines: vi.fn(async () => baselines) },
    });
    const ctx = await svc.composeContext({ userId: 'kckern' });
    expect(ctx).toMatch(/Profile/);
    expect(ctx).toMatch(/175 lbs/);
    expect(ctx).toMatch(/Workouts: 4\.2\/wk/);
    expect(ctx).toMatch(/Typical run.*35.*148/);
    expect(ctx).toMatch(/Calories: 2200\/d avg/);
    expect(ctx).toMatch(/Weight: 175\.4 lbs.*-0\.5 lbs\/30d/);
  });

  it('handles missing baselines gracefully', async () => {
    const svc = new UserModelService({
      personalConstantsService: { get: vi.fn(async () => ({})) },
      baselineService: { getBaselines: vi.fn(async () => null) },
    });
    const ctx = await svc.composeContext({ userId: 'kckern' });
    expect(ctx).toMatch(/No baselines available yet/);
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/user_model/loader.test.mjs
```

- [ ] **Step 3: Implement UserModelService**

```javascript
// backend/src/3_applications/agents/health-coach/services/UserModelService.mjs

export class UserModelService {
  #personalConstantsService;
  #baselineService;

  constructor({ personalConstantsService, baselineService }) {
    this.#personalConstantsService = personalConstantsService;
    this.#baselineService = baselineService;
  }

  async composeContext({ userId }) {
    const [profile, baselines] = await Promise.all([
      this.#personalConstantsService?.get?.(userId).catch(() => ({})),
      this.#baselineService?.getBaselines?.({ userId }).catch(() => null),
    ]);

    const lines = [];
    lines.push('## Your model of this user (auto-loaded each turn)');
    lines.push('');
    lines.push('### Profile');
    if (profile?.weight_lbs)  lines.push(`- Weight: ${profile.weight_lbs} lbs`);
    if (profile?.height_cm)   lines.push(`- Height: ${profile.height_cm} cm`);
    if (profile?.age)         lines.push(`- Age: ${profile.age}`);
    if (profile?.sex)         lines.push(`- Sex: ${profile.sex}`);
    lines.push('');

    lines.push('### Baselines (rolling)');
    if (!baselines) {
      lines.push('- No baselines available yet (insufficient history).');
    } else {
      const f = baselines.fitness;
      if (f && f.n > 0) {
        const byKind = Object.entries(f.workouts_per_week_by_kind || {})
          .map(([k, v]) => `${v} ${k}`).join(', ');
        lines.push(`- Workouts: ${f.workouts_per_week_total}/wk total (${byKind})`);
        if (f.run) {
          lines.push(`- Typical run: ${f.run.median_duration_min} min @ ${f.run.median_hr_avg} avg HR / ${f.run.median_hr_max} max HR`);
        }
      }
      const n = baselines.nutrition;
      if (n && n.kcal_avg != null) {
        lines.push(`- Calories: ${n.kcal_avg}/d avg, protein ${n.protein_g_avg}g/d`);
      }
      const w = baselines.weight;
      if (w && w.trim_mean != null) {
        const slopeStr = w.slope_lbs_per_30d > 0 ? `+${w.slope_lbs_per_30d}` : `${w.slope_lbs_per_30d}`;
        lines.push(`- Weight: ${w.trim_mean} lbs (trend: ${slopeStr} lbs/30d)`);
      }
    }
    lines.push('');
    return lines.join('\n');
  }
}

export default UserModelService;
```

- [ ] **Step 4: Wire UserModelService into HealthCoachAgent**

In `HealthCoachAgent.mjs`, the agent must inject the user model into the system prompt at the start of each turn. Locate the `executeRun` / `prepareContext` / `runImpl` method (whichever assembles the prompt before the LLM call) and prepend the composed context to the system message.

A safe pattern: before invoking the runtime, fetch the model context and inject as part of system instructions.

```javascript
// In HealthCoachAgent.runImpl (or similar method that handles execution)
async runImpl(input, context) {
  const userId = context.userId || this.deps.defaultUserId;
  const userModelMd = await this.deps.userModelService?.composeContext({ userId }).catch(() => '');
  // Prepend to system prompt
  const baseSystem = this.deps.prompts?.chat || '';
  const augmentedSystem = userModelMd ? `${userModelMd}\n\n${baseSystem}` : baseSystem;
  return super.runImpl(input, { ...context, systemPrompt: augmentedSystem });
}
```

The exact integration depends on how the BaseAgent / orchestrator threads systemPrompt. Read the base class first; if there's no prepend hook, expose a `getSystemContext()` method on the agent that the orchestrator merges before calling Mastra.

- [ ] **Step 5: Add personal_baselines + personal_goals tools**

```javascript
// backend/src/3_applications/agents/health-coach/tools/PersonalBaselineToolFactory.mjs
import { ToolFactory } from '../../../tools/ToolFactory.mjs';   // adjust import per actual base class

export class PersonalBaselineToolFactory extends ToolFactory {
  #baselineService;

  constructor({ baselineService }) {
    super();
    if (!baselineService) throw new Error('PersonalBaselineToolFactory: baselineService required');
    this.#baselineService = baselineService;
  }

  createTools() {
    return [
      {
        name: 'personal_baselines',
        description: 'Rolling baselines for this user (workouts/wk by kind, typical run profile, kcal_avg, protein_g_avg, weight trim mean + slope). Use these as the canonical answer to "what is typical for this user?"',
        parameters: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
        execute: async ({ userId }) => this.#baselineService.getBaselines({ userId }),
      },
    ];
  }
}

export default PersonalBaselineToolFactory;
```

(Same pattern matches existing ToolFactory implementations — read one for the exact base shape if needed.)

- [ ] **Step 6: Wire bootstrap**

In `backend/src/0_system/bootstrap.mjs`, in the section that constructs health-coach services:

```javascript
import { FitnessEventAdapter }   from '#apps/agents/health-coach/services/adapters/FitnessEventAdapter.mjs';
import { NutritionEventAdapter } from '#apps/agents/health-coach/services/adapters/NutritionEventAdapter.mjs';
import { WeightEventAdapter }    from '#apps/agents/health-coach/services/adapters/WeightEventAdapter.mjs';
import { PersonalBaselineService } from '#apps/agents/health-coach/services/PersonalBaselineService.mjs';
import { UserModelService } from '#apps/agents/health-coach/services/UserModelService.mjs';
import { PersonalBaselineToolFactory } from '#apps/agents/health-coach/tools/PersonalBaselineToolFactory.mjs';

const householdId = configService?.getDefaultHouseholdId?.() ?? 'default';
const defaultUserId = configService?.getHeadOfHousehold?.() ?? householdId;

const fitnessAdapter = new FitnessEventAdapter({ sessionService, householdId });
const nutritionAdapter = foodLogService
  ? new NutritionEventAdapter({ foodLogService, userId: defaultUserId })
  : null;
const weightAdapter = healthService
  ? new WeightEventAdapter({ healthService, userId: defaultUserId })
  : null;

const eventQueryService = new EventQueryService({
  adapters: {
    workout: fitnessAdapter,
    ...(nutritionAdapter ? { meal: nutritionAdapter } : {}),
    ...(weightAdapter ? { weigh_in: weightAdapter } : {}),
  },
});

const baselineService = new PersonalBaselineService({
  adapters: {
    workout: fitnessAdapter,
    ...(nutritionAdapter ? { meal: nutritionAdapter } : {}),
    ...(weightAdapter ? { weigh_in: weightAdapter } : {}),
  },
  dataService,
});

const userModelService = new UserModelService({
  personalConstantsService,
  baselineService,
});
```

Then add `userModelService`, `baselineService` to the deps map passed to `agentOrchestrator.register(HealthCoachAgent, ...)`, and `foodLogService` if not already wired.

In `HealthCoachAgent.registerTools`:

```javascript
const { healthQueryService, computeSandbox, personalConstantsService, eventQueryService, baselineService } = this.deps;
if (!healthQueryService || !computeSandbox || !personalConstantsService || !eventQueryService || !baselineService) return;
this.addToolFactory(new PersonalBaselineToolFactory({ baselineService }));
```

- [ ] **Step 7: Update prompt to include placeholder for user model**

In `chat.mjs` add at the very top (above all other sections):

```
{{user_model}}

(everything else)
```

…and in the agent runtime, replace `{{user_model}}` with the composed context. If your prompt machinery doesn't do template substitution, just prepend in code (Step 4 covered this).

- [ ] **Step 8: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
cd /opt/Code/DaylightStation && node -c backend/src/0_system/bootstrap.mjs && echo OK
```

- [ ] **Step 9: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/services/UserModelService.mjs \
  backend/src/3_applications/agents/health-coach/tools/PersonalBaselineToolFactory.mjs \
  backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs \
  backend/src/3_applications/agents/health-coach/prompts/chat.mjs \
  backend/src/0_system/bootstrap.mjs \
  tests/isolated/agents/health-coach/user_model/
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): user model loaded into prompt + personal_baselines tool

Plan / Task 9. UserModelService composes profile + baselines into a
markdown block prepended to the system prompt every turn. Agent
reasons against this model instead of inventing baselines. New tool:
personal_baselines for explicit re-query.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: vs_baseline annotations on event rows

Each `query_events` row gets `vs_baseline: { delta, delta_pct, percentile_rank? }` based on the user's typical for that kind. Agent narrates significance without computing.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/services/adapters/FitnessEventAdapter.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs` (dispatcher passes baselines through)
- Create: `tests/isolated/agents/health-coach/annotations/vs_baseline.test.mjs`

- [ ] **Step 1: Write tests**

```javascript
// tests/isolated/agents/health-coach/annotations/vs_baseline.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { FitnessEventAdapter } from '../../../../../backend/src/3_applications/agents/health-coach/services/adapters/FitnessEventAdapter.mjs';

describe('FitnessEventAdapter — vs_baseline annotations', () => {
  it('attaches vs_baseline to run rows when baseline supplied', async () => {
    const fullSession = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 28 * 60_000,
      strava: { id: 12345, type: 'Run' },
      metadata: { hr_avg: 136, hr_max: 158, distance_mi: 4.2 },
      timeline: { series: { kc: Array(60).fill(135) }, events: [] },
    };
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [fullSession]),
        getSession: vi.fn(async () => fullSession),
      },
      householdId: 'kckern',
    });
    const baseline = {
      run: { median_duration_min: 35, median_hr_avg: 148, median_hr_max: 172, median_distance_mi: 4.5 },
    };
    const r = await svc.list({ period: { rolling: 'last_1d' } }, { baseline });
    expect(r.events[0].vs_baseline).toEqual({
      duration_min: { typical: 35, delta: -7,  delta_pct: -20 },
      hr_avg:       { typical: 148, delta: -12, delta_pct: -8.1 },
      hr_max:       { typical: 172, delta: -14, delta_pct: -8.1 },
      distance_mi:  { typical: 4.5, delta: -0.3, delta_pct: -6.7 },
    });
  });

  it('skips vs_baseline when no run baseline present', async () => {
    const fullSession = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 28 * 60_000,
      strava: { id: 12345, type: 'Run' }, metadata: { hr_avg: 136 },
      timeline: { series: {}, events: [] },
    };
    const svc = new FitnessEventAdapter({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [fullSession]),
        getSession: vi.fn(async () => fullSession),
      },
      householdId: 'kckern',
    });
    const r = await svc.list({ period: { rolling: 'last_1d' } }, { baseline: { run: null } });
    expect(r.events[0].vs_baseline).toBeUndefined();
  });
});
```

- [ ] **Step 2: Update FitnessEventAdapter.list to accept and apply baseline**

```javascript
async list({ period, filter, limit }, { baseline = null } = {}) {
  const { from, to } = resolvePeriod(period, this.#now);
  const sessions = await this.#sessionService.listSessionsInRange(from, to, this.#householdId);
  let events = sessions.map(s => this.#sessionToEvent(s));
  if (filter?.type) events = events.filter(e => e.domain_extras.type === filter.type);
  if (filter?.kind) events = events.filter(e => e.domain_extras.kind_canonical === filter.kind);
  if (limit) events = events.slice(0, limit);
  if (events.length > 0 && events.length <= 3) {
    events = await Promise.all(events.map(e => this.#hydrate(e)));
  }
  if (baseline) events = events.map(e => this.#annotateBaseline(e, baseline));
  return { events, meta: { kind: 'workout', period, n: events.length } };
}

#annotateBaseline(event, baseline) {
  const kind = event.domain_extras.kind_canonical;
  const b = baseline?.[kind];
  if (!b) return event;

  const compare = (typical, actual) => {
    if (typical == null || actual == null) return null;
    const delta = Math.round((actual - typical) * 10) / 10;
    const delta_pct = typical !== 0 ? Math.round(((actual - typical) / typical) * 1000) / 10 : null;
    return { typical, delta, delta_pct };
  };

  const vs = {};
  const dm = compare(b.median_duration_min, event.scalars.duration_min); if (dm) vs.duration_min = dm;
  const ha = compare(b.median_hr_avg, event.scalars.hr_avg);              if (ha) vs.hr_avg = ha;
  const hx = compare(b.median_hr_max, event.scalars.hr_max);              if (hx) vs.hr_max = hx;
  const di = compare(b.median_distance_mi, event.scalars.distance_mi);    if (di) vs.distance_mi = di;
  if (Object.keys(vs).length === 0) return event;
  return { ...event, vs_baseline: vs };
}
```

NutritionEventAdapter and WeightEventAdapter get analogous methods (`#annotateBaseline` comparing kcal/protein for meals; `weight_lbs` for weigh-ins). Add them similarly.

- [ ] **Step 3: Dispatcher (EventQueryService) loads baseline once and passes to adapter.list**

```javascript
// EventQueryService.queryEvents
async queryEvents({ kind, period, filter, limit, userId }) {
  if (!SUPPORTED_KINDS.has(kind)) throw new Error(`unsupported kind "${kind}"`);
  validateFilter(filter);
  const adapter = this.#adapters[kind];
  if (!adapter) return { events: [], meta: { kind, period, n: 0 } };
  const baseline = await this.#baselineService?.getBaselines({ userId }).catch(() => null);
  const baselineForKind = baseline?.[kind === 'workout' ? 'fitness' : kind === 'meal' ? 'nutrition' : 'weight'];
  return adapter.list({ period, filter, limit }, { baseline: baselineForKind });
}
```

Add `baselineService` to EventQueryService constructor:

```javascript
constructor({ adapters, baselineService = null }) {
  if (!adapters) throw new Error('adapters map required');
  this.#adapters = adapters;
  this.#baselineService = baselineService;
}
```

Update bootstrap to pass `baselineService` into EventQueryService.

- [ ] **Step 4: Tool factory passes userId from agent context**

In `HealthQueryToolFactory`, the `query_events` tool's `execute` already receives `userId` from the args. Forward it:

```javascript
execute: async (args) => this.#eventQueryService.queryEvents(args),
```

(args already includes userId.)

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/
```

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs \
  backend/src/3_applications/agents/health-coach/services/adapters/ \
  backend/src/0_system/bootstrap.mjs \
  tests/isolated/agents/health-coach/annotations/
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): vs_baseline annotations on event rows

Plan / Task 10. Each query_events row carries vs_baseline:
{ duration_min, hr_avg, hr_max, distance_mi }.{ typical, delta,
delta_pct }. Agent narrates significance without inventing baselines.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Prompt rewrite — citation, validation, comparison rails + tool docs

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/prompts/chat.mjs`

- [ ] **Step 1: Read current prompt structure**

```bash
cd /opt/Code/DaylightStation && grep -n "^## " backend/src/3_applications/agents/health-coach/prompts/chat.mjs
```

- [ ] **Step 2: Replace tool docs + add the three rails**

The new sections (insert/replace):

```
## Tools

You have these tools — use them in this order of preference:

1. **query_events({ kind, period, filter?, userId })** — list events of a kind.
   - kind: 'workout' | 'meal' | 'weigh_in'
   - period: bare string ('last_1d', 'last_7d', 'last_30d', 'last_365d') OR { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
   - filter: object only — { type: 'Run' } (raw Strava) OR { kind: 'strength' } (canonical: run|strength|cycle|walk|yoga|swim|other). NEVER pass strings like "type == 'run'" — they are rejected with an error.
   - For NARROW questions (n ≤ 3), each row has full hr_stats + vs_baseline.
   - For WIDE questions (n > 3), rows are sparser; use query_health for aggregates.

2. **get_event_detail({ id, kind?, userId })** — full rich record for one event.
   - Returns kind-specific richness:
     workout → timeline.series, voice_memos[], snapshot_refs[], treasure_stats, strava_summary (map polyline, gear, elevation), hr_stats
     meal    → log_full, items_summary, totals
     weigh_in → context_window (5d around the date)

3. **personal_baselines({ userId })** — canonical answer to "what is typical for this user?" Returns:
   - fitness.workouts_per_week_total + by_kind, fitness.run.median_*
   - nutrition.kcal_avg, protein_g_avg
   - weight.trim_mean, slope_lbs_per_30d

4. **personal_constants({ userId })** — height/weight/age/sex/etc.

5. **query_health({ metric, period, ... })** — time-series aggregates (workout_count, kcal_in, kcal_out, weight_lbs, etc.).

6. **compute({ expression, inputs })** — sandboxed JS evaluator for custom math.

7. **record_playbook / update_playbook** — long-term observations about THIS user.

## Citation rail

EVERY numeric claim in your response must trace to a tool result OR a baseline you fetched THIS turn. NO INVENTED NUMBERS.

  Forbidden examples:
    "your typical baseline of 3-4 strength sessions and 2-3 cardio per week"
       (unless you actually called personal_baselines and got those numbers)
    "for someone your age, 145 bpm is moderate"
       (made up — cite max HR formula or actual baselines)

  If you don't have a baseline number, say "I don't have a baseline for that yet — let me check" and call personal_baselines.

## Validation rail

When the user offers an interpretation of their data ("I took it easy today",
"I felt tired", "I crushed it"), TEST IT against the data and either
CONFIRM it with numbers OR PUSH BACK with numbers.

  User: "i took it more easy today"
  Bad:  reads back the same numbers without taking a position
  Good: "Yes — your avg HR was 136 today vs your typical 148. No zone 4
         minutes. Consistent with an easy effort." OR
        "Actually the data says otherwise — your peak hit 175 (3 bpm
         above typical max) and you spent 8 min above 160."

## Comparison rail

When the user asks to compare ("how does X compare to Y?", "vs last week")
ALWAYS COMPUTE THE DELTA. Never just list two values side-by-side.

  Bad:  "Today: 28 min. Last week's runs were 38 min and 45 min."
  Good: "Today: 28 min @ 136 avg HR. Last week's runs (n=6): avg 35 min
         @ 148. So today was 7 min shorter and 12 bpm easier than your
         typical recent run."

If you have to fetch two periods, do both calls then compute the delta
in your response (or use compute() for the math).

## Drill-down protocol

For NARROW questions (n ≤ 3), query_events returns hydrated rows with hr_stats and vs_baseline already attached. Describe the event directly — DO NOT call get_event_detail unless the user asks for raw timeline data, voice memos, or map info.

When you DO call get_event_detail, surface what's actually there:
  - voice_memos: quote them ("you said at 18:12: 'feeling strong'")
  - snapshot_refs: count them ("you took 3 photos")
  - treasure_stats: report coins + zone breakdown
  - strava_summary: surface gear, elevation, location if relevant

## Default windows

When the user doesn't specify a period:
- "today" or follow-up about today → last_1d
- "this week" / "lately" / "now" → last_7d
- "recent" or no temporal hint → last_30d
- Yearly questions → last_365d

DO NOT ask the user "what period?" — pick a default, run the query, offer to refine.

## Don't ask back

If the user's question has an obvious answer in the data (and an obvious default
for any unspecified parameter), DO NOT ask a clarifying question. Run the query,
present the result, and offer to refine if needed.

(... existing Playbook protocol section ...)
```

Use Edit to replace the existing Tools / Drill-down protocol / Default windows / Don't ask back sections with this. Keep the Playbook protocol section intact.

- [ ] **Step 3: Verify all markers**

```bash
cd /opt/Code/DaylightStation && node -e "
import('./backend/src/3_applications/agents/health-coach/prompts/chat.mjs').then(m => {
  const p = m.chatPrompt;
  const checks = [
    ['Citation rail',     p.includes('Citation rail')],
    ['Validation rail',   p.includes('Validation rail')],
    ['Comparison rail',   p.includes('Comparison rail')],
    ['NO INVENTED NUMBERS', p.includes('NO INVENTED NUMBERS')],
    ['ALWAYS COMPUTE THE DELTA', p.includes('ALWAYS COMPUTE THE DELTA')],
    ['kind: meal',        p.includes(\"meal'\")],
    ['kind: weigh_in',    p.includes('weigh_in')],
    ['personal_baselines', p.includes('personal_baselines')],
    ['voice_memos',       p.includes('voice_memos')],
    ['Playbook protocol still present', p.includes('Playbook protocol')],
  ];
  let all = true;
  for (const [n, ok] of checks) { console.log(ok ? '✓' : '✗', n); if (!ok) all = false; }
  process.exit(all ? 0 : 1);
});
"
```

Expected: all 10 ✓.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add backend/src/3_applications/agents/health-coach/prompts/chat.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): prompt — citation/validation/comparison rails + multi-domain tools

Plan / Task 11. Three explicit reasoning rails:
- Citation: every number traces to a tool result or baseline.
- Validation: test user's interpretation against data, confirm or push back.
- Comparison: always compute the delta when comparison is asked.

Tool docs updated for new kinds (meal, weigh_in), filter contract,
voice_memos and other rich detail surfaces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Build, deploy, multi-turn smoke

**Files:**
- (none — verification only)

- [ ] **Step 1: Full vitest**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

Expected: green.

- [ ] **Step 2: Vite build**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3
```

- [ ] **Step 3: Build + deploy + ready**

```bash
cd /opt/Code/DaylightStation && sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" . 2>&1 | tail -3 && \
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight 2>&1 | tail -3 && \
until curl -sS -m 3 http://localhost:3111/api/v1/agents > /dev/null 2>&1; do sleep 2; done && echo READY
```

- [ ] **Step 4: Multi-turn smoke**

```bash
python3 <<'PY'
import json, re, subprocess, sys

TURNS = [
  ("how was my run today?",
   {
     'duration_min':  r'\b\d{1,3}\s*(?:min|minute)',
     'hr_avg_number': r'(?:avg|HR|averag)\D{0,8}\b1[0-9]{2}\b',
     'vs_baseline_or_band': r'\b(typical|baseline|peak|max|zone|band|drift|spent.*in)',
     'no_punt': r'^(?!.*(?:unfortunately|no details|if you have more data|sync.*properly|could you (?:check|clarify))).*$'
   }),
  ("how does it compare to my runs last week?",
   {
     'numeric_delta_or_diff': r'\b(?:shorter|longer|easier|harder|slower|faster|less|more|delta|diff|\d+\s*bpm\s*(?:lower|higher|less|more|below|above))',
     'two_periods_referenced': r'(today|this run).*(last week|last 7 days)|last week.*today',
   }),
  ("i took it more easy today",
   {
     'data_grounded_position': r'(yes|agree|confirm|consistent|actually|but|however|disagree)',
     'cited_numbers': r'\b1[0-9]{2}\b',
   }),
  ("what about my weight training? show me my recent strength sessions",
   {
     'has_strength_events': r'(strength|weight\s*training|lift)',
     'no_hallucinated_baseline': r'^(?!.*(?:typical baseline of \d+-\d+ (?:strength|cardio))).*$',
   }),
  ("how am I doing on protein this week?",
   {
     'mentions_protein_grams': r'\b\d{2,3}\s*g(?:rams?)?\s*(?:of\s*)?protein|protein.*\b\d{2,3}\s*g',
     'mentions_period': r'(this week|last 7 days|7d)',
   }),
  ("any voice memos from my run?",
   {
     'either_quotes_or_says_none': r"(\".*\"|no (?:voice )?memos?|didn't (?:record|leave) (?:any )?memo|no recordings? from)",
   }),
]

def run(input_text):
    r = subprocess.run(
      ['curl', '-sS', '-m', '90', '-X', 'POST',
       'http://localhost:3111/api/v1/agents/health-coach/run',
       '-H', 'Content-Type: application/json',
       '-d', json.dumps({'input': input_text, 'context': {'userId': 'kckern'}})],
      capture_output=True, text=True
    )
    return json.loads(r.stdout)

all_ok = True
for input_text, checks in TURNS:
  print(f'\n=== Q: {input_text} ===')
  res = run(input_text)
  out = (res.get('output') or '').strip()
  print('OUT:', out[:600])
  print('TOOLS:', [tc.get('payload', tc).get('toolName') for tc in res.get('toolCalls', [])])
  for label, pattern in checks.items():
    ok = bool(re.search(pattern, out, re.I | re.S))
    print('  ', '✓' if ok else '✗', label)
    all_ok = all_ok and ok

print('\n=== EXIT', '✓ ALL PASS' if all_ok else '✗ FAIL', '===')
sys.exit(0 if all_ok else 1)
PY
```

If any ✗: read the failing turn's output, identify the specific gap, and fix in the appropriate task (T2 prompt, T8 baselines, T10 annotations). Re-deploy and re-run.

- [ ] **Step 5: Final summary commit**

```bash
cd /opt/Code/DaylightStation && git commit --allow-empty -m "$(cat <<'EOF'
chore(health-coach): reflective architecture shipped

12 plan tasks landed:
- T1-T2:  Filter contract + canonical kind vocabulary
- T3-T6:  EventAdapter + Fitness/Nutrition/Weight adapters (unified surface)
- T7:     Rich detail pass-through (voice memos, treasure, strava map)
- T8-T9:  PersonalBaselineService + UserModelService (working model of user)
- T10:    vs_baseline annotations on event rows (no invented norms)
- T11:    Citation + validation + comparison rails in prompt
- T12:    Multi-turn smoke pass

The coach now reasons against a working model of the user across
fitness + nutrition + weight, surfaces the rich data the fitness UI
already shows, and stops inventing baselines / parroting questions /
listing facts without analysis.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| User-reported failure | Tasks |
|---|---|
| Filter `"type == 'run'"` silently dropped | T1 (validate + throw) + T2 (canonical kind) + T11 (prompt teaches the contract) |
| No real comparison ("how does X compare to Y") | T11 (Comparison rail) + T10 (vs_baseline puts deltas in the row) |
| "I took it easier" → parrot read-back | T11 (Validation rail) + T10 (vs_baseline gives the agent something to take a position on) |
| Hallucinated "3-4 strength baseline" | T8 (real baselines) + T9 (loaded into context) + T11 (Citation rail forbids invented numbers) |
| Missing episode/program metadata | T7 (rich detail pass-through; episode info appears in `session_full` and `strava_summary.name`) |
| Coach blind to nutrition | T5 (NutritionEventAdapter) + T11 (kind: 'meal' tool docs) |
| Coach blind to weight trend | T6 (WeightEventAdapter) + T8 (weight baseline) |
| Voice memos / snapshots / maps invisible | T7 (rich detail pass-through with structured summaries) |
| Coach has no model of user | T8 + T9 (baselines + user model loader) |
| Decision-tree feel | T3-T6 (one event surface, three primitives per domain) + T10 (annotations) + T11 (rails enforce reasoning over reporting) |

---

## Notes for the implementer

- **The plan is BIG.** 12 tasks ≈ 12 commits. Take them one at a time. Subagent-driven execution is the right approach — fresh subagent per task with two-stage review keeps each task focused.
- **T4 is a refactor with breaking changes.** Existing event_query/* tests assert old field shapes (`r.events[0].session_id`, `r.events[0].hr_avg`). After T4, fields move (`r.events[0].id`, `r.events[0].scalars.hr_avg`). Update the tests as part of T4 — don't leave them broken.
- **Baseline freshness.** Baselines are cached for 24h. On first run for a user (no cache, sparse history), they may be empty — `UserModelService` handles "No baselines available yet" gracefully. After history accumulates, baselines become meaningful. Don't fake-populate baselines for a smoke test; instead, ensure your test user has 30+ days of session/health history.
- **NutritionEventAdapter shape.** The actual `NutriLog` entity may not have `totals` exactly as drafted. Read the entity in T5 Step 1 and adapt field accesses. Same for the weigh-in API in T6.
- **`#extractVoiceMemos` filter logic.** If real `snapshots.captures[i]` items don't have a `type: 'voice_memo'` discriminator, but voice memos always have a `transcript` field, just filter by `c.transcript` presence. Adjust based on Step 1 inspection.
- **`personal_goals` tool was punted from T9.** Goals storage isn't formalized yet in this codebase. Ship `personal_baselines` first; add `personal_goals` once a goals YAML format is settled. Mention in the prompt that goals come from working memory for now.
- **T11 prompt is long.** The system prompt token cost grows. If you hit context budget pressure, consider: (a) dropping the playbook section to a shorter form, (b) moving tool docs into Mastra's tool descriptions instead of duplicating in the prompt, (c) trimming the user model markdown when no baselines are present.
- **Conversation context (multi-turn memory).** Still out of scope. The exit criteria smoke uses single-shot HTTP, so each turn is fresh. The UI carries thread state via assistant-ui, so live conversations behave better. If multi-turn memory is needed at API level, that's a separate plan.
