# Health-Coach Eager-Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user asks a narrow question about specific events ("how was my run today?"), `query_events` returns hydrated rows with full HR statistics computed from the timeline series, so the agent describes the event meaningfully **in one response** — no clarifying questions, no "no details available" punt.

**Architecture:** Two pure helpers (`computeHrStats`, `pickPrimaryHrSeries`) added to `EventQueryService`. `queryEvents` gains a hydration step: when result set size is ≤ 3, each row is enriched by calling `sessionService.getSession` (full Session entity) and folding in `metadata.hr_avg/hr_max/kcal/distance_mi` PLUS computed `hr_stats` (mean, max, p50, p90, drift, HR-band seconds) derived from `timeline.series`. Wide queries skip hydration. The prompt instructs the agent to describe runs directly from `hr_stats` — no follow-up turn required, no fallback to "unfortunately."

**Tech Stack:** Existing `EventQueryService` + `sessionService.getSession(sessionId, householdId)` (real method, confirmed in `SessionService.mjs:173`) + Session entity's `timeline.series` (object keyed by participant, values are per-second HR arrays).

---

## Exit criteria (verifiable end-to-end)

The plan is **not** done until this single-shot conversation produces a real answer:

```bash
curl -sS -m 90 -X POST http://localhost:3111/api/v1/agents/health-coach/run \
  -H "Content-Type: application/json" \
  -d '{"input":"how was my run today?","context":{"userId":"user_1"}}'
```

Output text must satisfy ALL of:

1. Mentions duration in minutes (e.g. "28 min" / "28 minutes")
2. Mentions a numeric HR average (e.g. "avg 139", "averaged 139", "HR 139")
3. Mentions at least one of: peak HR, max HR, zone, band, distribution, drift
4. Does NOT contain: "unfortunately", "no details", "if you have more data", clarifying questions about period

Plus exactly ONE tool call (`query_events`) — the row should be rich enough that no `get_event_detail` follow-up is needed.

The Task 5 smoke script encodes these as regex assertions and exits non-zero if any fails.

---

## File structure

**Modified files:**

```
backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs   — adds computeHrStats, pickPrimaryHrSeries, #hydrate; queryEvents now hydrates n ≤ 3
backend/src/3_applications/agents/health-coach/prompts/chat.mjs                  — Drill-down protocol section rewritten around hr_stats
```

**New tests:**

```
tests/isolated/agents/health-coach/event_query/
  hr_stats.test.mjs         — pure tests for computeHrStats
  pick_series.test.mjs      — pure tests for pickPrimaryHrSeries
  query_events.test.mjs     — extended with hydration tests (existing file)
```

---

## Task 1: HR stats helper — `computeHrStats(series)`

Pure function. Takes a per-second HR series, returns summary stats. Tested in isolation; no service dep.

**Files:**
- Create: `tests/isolated/agents/health-coach/event_query/hr_stats.test.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/agents/health-coach/event_query/hr_stats.test.mjs
import { describe, it, expect } from 'vitest';
import { computeHrStats } from '../../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

describe('computeHrStats', () => {
  it('returns null fields for empty/missing series', () => {
    const empty = {
      n: 0, mean: null, max: null, min: null, p50: null, p90: null,
      drift_pct: null,
      bands: { lt120: 0, b120_139: 0, b140_159: 0, b160_179: 0, gte180: 0 },
    };
    expect(computeHrStats([])).toEqual(empty);
    expect(computeHrStats(null)).toEqual(empty);
    expect(computeHrStats(undefined)).toEqual(empty);
  });

  it('computes mean/max/min over a flat series', () => {
    const s = Array(60).fill(140);
    const r = computeHrStats(s);
    expect(r.n).toBe(60);
    expect(r.mean).toBe(140);
    expect(r.max).toBe(140);
    expect(r.min).toBe(140);
    expect(r.p50).toBe(140);
    expect(r.p90).toBe(140);
  });

  it('drops nullish values', () => {
    const s = [120, null, 130, undefined, 140, 'oops', 150]; // string + null/undefined dropped
    const r = computeHrStats(s);
    expect(r.n).toBe(4);
    expect(r.min).toBe(120);
    expect(r.max).toBe(150);
  });

  it('computes drift_pct as (last-third mean / first-third mean - 1) * 100', () => {
    // First third 130, last third 150 → drift = (150/130 - 1)*100 ≈ 15.38
    const s = [...Array(20).fill(130), ...Array(20).fill(140), ...Array(20).fill(150)];
    const r = computeHrStats(s);
    expect(r.drift_pct).toBeCloseTo(15.38, 1);
  });

  it('counts seconds in HR bands', () => {
    const s = [
      ...Array(10).fill(110),  // <120 → 10
      ...Array(20).fill(130),  // 120-139 → 20
      ...Array(30).fill(150),  // 140-159 → 30
      ...Array(15).fill(170),  // 160-179 → 15
      ...Array(5).fill(185),   // ≥180 → 5
    ];
    const r = computeHrStats(s);
    expect(r.bands).toEqual({ lt120: 10, b120_139: 20, b140_159: 30, b160_179: 15, gte180: 5 });
  });

  it('returns drift_pct null when series < 9 points', () => {
    const r = computeHrStats([130, 140, 150, 160]);
    expect(r.drift_pct).toBe(null);
  });

  it('rounds mean and drift_pct to 1dp / 2dp', () => {
    // n=10, sum=1234, mean=123.4
    const s = [120, 121, 122, 123, 124, 125, 126, 124, 125, 124];
    const r = computeHrStats(s);
    expect(r.mean).toBe(123.4);
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/event_query/hr_stats.test.mjs
```

Expected: import error — `computeHrStats` is not exported.

- [ ] **Step 3: Implement**

Add to `backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs`, after the class but BEFORE the `export default` line:

```javascript
export function computeHrStats(series) {
  const empty = {
    n: 0, mean: null, max: null, min: null, p50: null, p90: null,
    drift_pct: null,
    bands: { lt120: 0, b120_139: 0, b140_159: 0, b160_179: 0, gte180: 0 },
  };
  if (!Array.isArray(series) || series.length === 0) return empty;

  const xs = series.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (xs.length === 0) return empty;

  const sorted = [...xs].sort((a, b) => a - b);
  const sum = xs.reduce((a, b) => a + b, 0);
  const mean = sum / xs.length;

  const pct = (p) => {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  };

  const bands = { lt120: 0, b120_139: 0, b140_159: 0, b160_179: 0, gte180: 0 };
  for (const v of xs) {
    if (v < 120) bands.lt120++;
    else if (v < 140) bands.b120_139++;
    else if (v < 160) bands.b140_159++;
    else if (v < 180) bands.b160_179++;
    else bands.gte180++;
  }

  let drift_pct = null;
  if (xs.length >= 9) {
    const third = Math.floor(xs.length / 3);
    const firstMean = xs.slice(0, third).reduce((a, b) => a + b, 0) / third;
    const lastMean  = xs.slice(-third).reduce((a, b) => a + b, 0) / third;
    if (firstMean > 0) drift_pct = (lastMean / firstMean - 1) * 100;
  }

  return {
    n: xs.length,
    mean: Math.round(mean * 10) / 10,
    max: Math.max(...xs),
    min: Math.min(...xs),
    p50: pct(50),
    p90: pct(90),
    drift_pct: drift_pct === null ? null : Math.round(drift_pct * 100) / 100,
    bands,
  };
}
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/event_query/hr_stats.test.mjs
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs \
  tests/isolated/agents/health-coach/event_query/hr_stats.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): computeHrStats — series → mean/max/p50/p90/drift/bands

Plan / Task 1. Pure function: takes per-second HR series, returns
summary stats (mean/max/min/p50/p90, drift_pct, bands of seconds in
HR ranges <120, 120-139, 140-159, 160-179, ≥180). Used by queryEvents
to enrich narrow result sets so the agent can describe runs in one
response.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Series picker — `pickPrimaryHrSeries(seriesMap)`

`timeline.series` is `{ participantKey: HR[] }`. Pick the longest series so we don't need to know participant keys at construction time.

**Files:**
- Create: `tests/isolated/agents/health-coach/event_query/pick_series.test.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/agents/health-coach/event_query/pick_series.test.mjs
import { describe, it, expect } from 'vitest';
import { pickPrimaryHrSeries } from '../../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

describe('pickPrimaryHrSeries', () => {
  it('returns empty array for missing/null/non-object', () => {
    expect(pickPrimaryHrSeries(null)).toEqual([]);
    expect(pickPrimaryHrSeries(undefined)).toEqual([]);
    expect(pickPrimaryHrSeries({})).toEqual([]);
    expect(pickPrimaryHrSeries('oops')).toEqual([]);
  });

  it('returns the only series when one participant', () => {
    const r = pickPrimaryHrSeries({ kc: [120, 130, 140] });
    expect(r).toEqual([120, 130, 140]);
  });

  it('picks longest when multiple participants', () => {
    const r = pickPrimaryHrSeries({
      guest: [110, 115],
      kc: [120, 130, 140, 150],
      visitor: [],
    });
    expect(r).toEqual([120, 130, 140, 150]);
  });

  it('handles non-array values defensively', () => {
    const r = pickPrimaryHrSeries({ kc: 'oops', guest: [120, 130] });
    expect(r).toEqual([120, 130]);
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/event_query/pick_series.test.mjs
```

- [ ] **Step 3: Implement**

Add to `backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs`, near `computeHrStats`:

```javascript
export function pickPrimaryHrSeries(seriesMap) {
  if (!seriesMap || typeof seriesMap !== 'object' || Array.isArray(seriesMap)) return [];
  let best = [];
  for (const v of Object.values(seriesMap)) {
    if (Array.isArray(v) && v.length > best.length) best = v;
  }
  return best;
}
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/event_query/pick_series.test.mjs
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs \
  tests/isolated/agents/health-coach/event_query/pick_series.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): pickPrimaryHrSeries — longest participant wins

Plan / Task 2. Defensive helper for picking the user's HR series from
timeline.series without needing to know participant keys. Picks
longest array among the map's values.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Eager hydration in `queryEvents`

When the result set has n ≤ 3 events, fetch each session's full detail via `sessionService.getSession` and fold the populated metadata + computed HR stats into the row.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs`
- Modify: `tests/isolated/agents/health-coach/event_query/query_events.test.mjs`

- [ ] **Step 1: Append failing tests for eager hydration**

Append at the bottom of `tests/isolated/agents/health-coach/event_query/query_events.test.mjs`:

```javascript
describe('EventQueryService.queryEvents — eager hydration (n ≤ 3)', () => {
  it('hydrates rows with full metadata + computed HR stats when n=1', async () => {
    const sparseSummary = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 28 * 60_000,
      strava: { id: 12345, type: 'Run', name: 'Morning Run' },
      metadata: { kcal: null, hr_avg: null, hr_max: null, distance_mi: null },
    };
    const fullSession = {
      ...sparseSummary,
      metadata: { kcal: 380, hr_avg: 142, hr_max: 175, distance_mi: 4.2 },
      timeline: { series: { kc: [...Array(60).fill(130), ...Array(60).fill(150)] }, events: [] },
      strava_notes: null,
    };
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [sparseSummary]),
        getSession: vi.fn(async (id) => id === '20260507060000' ? fullSession : null),
      },
      householdId: 'user_1',
    });
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_1d' } });
    expect(r.events).toHaveLength(1);
    const e = r.events[0];
    expect(e.hr_avg).toBe(142);
    expect(e.hr_max).toBe(175);
    expect(e.kcal).toBe(380);
    expect(e.distance_mi).toBe(4.2);
    expect(e.hr_stats).toBeDefined();
    expect(e.hr_stats.n).toBe(120);
    expect(e.hr_stats.mean).toBe(140);
    expect(e.hr_stats.bands.b120_139).toBe(60);
    expect(e.hr_stats.bands.b140_159).toBe(60);
  });

  it('does NOT hydrate when n > 3 (avoid N×getSession on wide queries)', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      sessionId: `2026050${i + 1}060000`, startTime: `2026-05-0${i + 1}T06:00:00Z`,
      durationMs: 30 * 60_000, strava: null,
      metadata: { kcal: null, hr_avg: null, hr_max: null, distance_mi: null },
    }));
    const getSession = vi.fn();
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => five),
        getSession,
      },
      householdId: 'user_1',
    });
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_7d' } });
    expect(r.events).toHaveLength(5);
    expect(getSession).not.toHaveBeenCalled();
    expect(r.events[0].hr_stats).toBeUndefined();
  });

  it('falls back to series-derived hr_avg when metadata.hr_avg is null but series exists', async () => {
    const sparseSummary = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 30 * 60_000,
      strava: { id: 12345, type: 'Run', name: 'Morning Run' },
      metadata: { hr_avg: null, hr_max: null },
    };
    const fullSession = {
      ...sparseSummary,
      metadata: { hr_avg: null, hr_max: null },                       // detail metadata also missing
      timeline: { series: { kc: Array(120).fill(145) }, events: [] }, // but series has data
    };
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [sparseSummary]),
        getSession: vi.fn(async () => fullSession),
      },
      householdId: 'user_1',
    });
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_1d' } });
    expect(r.events[0].hr_avg).toBe(145);  // derived from series
    expect(r.events[0].hr_max).toBe(145);
    expect(r.events[0].hr_stats.n).toBe(120);
  });

  it('survives getSession failure — returns sparse row, no throw', async () => {
    const sparseSummary = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 30 * 60_000,
      strava: null, metadata: {},
    };
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => [sparseSummary]),
        getSession: vi.fn(async () => { throw new Error('boom'); }),
      },
      householdId: 'user_1',
    });
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_1d' } });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].hr_avg).toBe(null);  // unhydrated, but no crash
    expect(r.events[0].hr_stats).toBeUndefined();
  });

  it('skips hydration entirely when getSession is not on the service', async () => {
    const sparseSummary = {
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 30 * 60_000,
      strava: null, metadata: {},
    };
    const svc = new EventQueryService({
      sessionService: { listSessionsInRange: vi.fn(async () => [sparseSummary]) },  // no getSession
      householdId: 'user_1',
    });
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_1d' } });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].hr_stats).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/event_query/query_events.test.mjs
```

Expected: 5 new tests fail (existing 5 still pass).

- [ ] **Step 3: Modify `queryEvents` and add `#hydrate`**

In `backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs`:

Replace the existing `queryEvents` method body (the `kind === 'workout'` branch) with:

```javascript
async queryEvents({ kind, period, filter, limit }) {
  if (!SUPPORTED_KINDS.has(kind)) {
    throw new Error(`EventQueryService: unsupported kind "${kind}"`);
  }
  const { from, to } = this.#resolvePeriod(period);

  if (kind === 'workout') {
    const sessions = await this.#sessionService.listSessionsInRange(from, to, this.#householdId);
    let events = sessions.map(s => this.#sessionToEvent(s));
    if (filter?.type) events = events.filter(e => e.type === filter.type);
    if (limit) events = events.slice(0, limit);

    // Eager hydration for narrow questions: when result set is small, fold the
    // full Session detail (populated metadata + computed HR stats) into each row
    // so the agent can describe events in one response — no get_event_detail
    // follow-up needed. Wide queries skip hydration to avoid N×getSession.
    if (events.length > 0 && events.length <= 3) {
      events = await Promise.all(events.map(e => this.#hydrate(e)));
    }

    return {
      events,
      meta: { kind, period, n: events.length, generated_at: this.#now().toISOString() },
    };
  }
  return { events: [], meta: { kind, n: 0, generated_at: this.#now().toISOString() } };
}

async #hydrate(event) {
  if (typeof this.#sessionService.getSession !== 'function') return event;
  let full;
  try {
    full = await this.#sessionService.getSession(event.session_id, this.#householdId);
  } catch {
    return event;
  }
  if (!full) return event;
  const series = pickPrimaryHrSeries(full.timeline?.series);
  const hr_stats = computeHrStats(series);
  return {
    ...event,
    kcal:        full.metadata?.kcal        ?? event.kcal,
    hr_avg:      full.metadata?.hr_avg      ?? hr_stats.mean ?? event.hr_avg,
    hr_max:      full.metadata?.hr_max      ?? hr_stats.max  ?? event.hr_max,
    distance_mi: full.metadata?.distance_mi ?? event.distance_mi,
    hr_stats,
  };
}
```

NOTE: `pickPrimaryHrSeries` and `computeHrStats` are exported from the same module — no `this.` prefix, no extra import.

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/event_query/
```

Expected: 5 (hr_stats) + 4 (pick_series) + 5 existing query_events + 4 new query_events + 4 get_event_detail = 22 tests pass.

- [ ] **Step 5: Full agent suite — no regressions**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

Expected: 1568+ tests pass (180+ files).

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs \
  tests/isolated/agents/health-coach/event_query/query_events.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): query_events eagerly hydrates narrow result sets

Plan / Task 3. When n ≤ 3 events come back from the list path, each row
is hydrated by calling sessionService.getSession to fold in full
metadata (hr_avg, hr_max, kcal, distance_mi) plus computed HR stats
from the timeline series (mean, max, p50, p90, drift_pct, bands of
seconds in HR ranges). The agent now sees real numbers for narrow
questions like "how was my run today?" and describes them in one
response — no follow-up needed.

Wide queries (n > 3) skip hydration to avoid N×getSession.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Prompt — describe runs from `hr_stats`, ban "no details" punts

Rewrite the Drill-down protocol section to push the agent to describe events directly from `hr_stats` fields, and explicitly forbid the "no details available" punt.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/prompts/chat.mjs`

- [ ] **Step 1: Read the current prompt to find the existing Drill-down section**

```bash
cd /opt/Code/DaylightStation && grep -n "Drill-down protocol" backend/src/3_applications/agents/health-coach/prompts/chat.mjs
```

- [ ] **Step 2: Replace the Drill-down protocol block**

Use the Edit tool: `old_string` is the entire existing `## Drill-down protocol` section through (but not including) the next `## ` heading. `new_string` is:

```
## Drill-down protocol

When the user asks about specific events ("how was my run today?",
"what did I eat for lunch?"), use query_events to list them.

For NARROW questions (n ≤ 3), query_events returns hydrated rows with
full HR stats already computed. Each event includes:

  duration_min, kcal, distance_mi, hr_avg, hr_max
  hr_stats.n          — number of HR samples in the series
  hr_stats.mean       — average HR (1dp)
  hr_stats.max / min  — peak / trough
  hr_stats.p50 / p90  — median / 90th percentile
  hr_stats.drift_pct  — last-third / first-third HR drift (%)
  hr_stats.bands      — seconds in HR bands:
                        { lt120, b120_139, b140_159, b160_179, gte180 }

DESCRIBE THE EVENT DIRECTLY FROM THESE FIELDS. Convert band-seconds
to minutes (Math.floor(seconds / 60)). Surface the IDs in your prose
so the user can ask follow-ups.

Example (good):
  "Your 28-min run today (sessionId 20260507060000, Strava 12345):
   avg HR 142, peak 175. Spent 15 min in 140-159 (steady-state Z2/Z3),
   9 min in 120-139, 1 min above 160. 2.1% drift across the run."

FORBIDDEN responses when hr_stats.n > 0:
  "Unfortunately there are no details on heart rate."
  "No details available."
  "If you have more data, let me know."
  "Make sure your device is capturing all the data."

If hr_stats.n > 0 the data IS there — describe it. Only say "no HR
data" if hr_stats.n === 0.

DO NOT call get_event_detail unless you need the raw per-second
series to feed compute() for a custom metric not already in hr_stats.
The hydrated row covers narrative needs.

For WIDE questions (multiple events, weekly/monthly summaries,
trends), hr_stats is NOT present on rows. Use query_health for
aggregates, or narrow your period to last_1d to get a single
hydrated row.

```

(Keep the trailing newline before the next `## ` heading.)

- [ ] **Step 3: Verify the prompt has all expected markers**

```bash
cd /opt/Code/DaylightStation && node -e "
import('./backend/src/3_applications/agents/health-coach/prompts/chat.mjs').then(m => {
  const p = m.chatPrompt;
  const checks = [
    ['hr_stats',                          p.includes('hr_stats')],
    ['hr_stats.bands',                    p.includes('hr_stats.bands')],
    ['drift_pct',                         p.includes('drift_pct')],
    ['FORBIDDEN responses',               p.includes('FORBIDDEN responses')],
    ['Unfortunately',                     p.includes('Unfortunately')],
    ['Default windows still present',     p.includes('Default windows')],
    [\"Don't ask back still present\",   p.includes(\"Don't ask back\")],
    ['Playbook protocol still present',   p.includes('Playbook protocol')],
  ];
  let all = true;
  for (const [n, ok] of checks) { console.log(ok ? '✓' : '✗', n); if (!ok) all = false; }
  process.exit(all ? 0 : 1);
});
"
```

Expected: all 8 ✓.

- [ ] **Step 4: Full agent suite — sanity (prompt edits should not break tests)**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add backend/src/3_applications/agents/health-coach/prompts/chat.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): prompt — describe runs from hr_stats, ban "no details" punts

Plan / Task 4. Drill-down protocol section rewritten around the new
hr_stats schema. Lists every available field, gives a worked example,
and explicitly forbids the "Unfortunately, no details" / "If you have
more data" / "Make sure your device is capturing" patterns when
hr_stats.n > 0. Tells the agent to convert band-seconds to minutes
and surface IDs in prose.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Build, deploy, exit-criteria smoke

The exit criteria from the plan header is the gate. This task does NOT pass unless the regex assertions on the live response all hit.

- [ ] **Step 1: Full vitest sanity**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

Expected: all green.

- [ ] **Step 2: Vite build**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3
```

Expected: `✓ built in <N>s`.

- [ ] **Step 3: Build + deploy + wait for ready**

```bash
cd /opt/Code/DaylightStation && sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" . 2>&1 | tail -3 && \
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight 2>&1 | tail -3 && \
until curl -sS -m 3 http://localhost:3111/api/v1/agents > /dev/null 2>&1; do sleep 2; done && echo READY
```

- [ ] **Step 4: Exit-criteria smoke**

```bash
curl -sS -m 90 -X POST http://localhost:3111/api/v1/agents/health-coach/run \
  -H "Content-Type: application/json" \
  -d '{"input":"how was my run today?","context":{"userId":"user_1"}}' \
  > /tmp/exit.json

python3 <<'PY'
import json, re, sys
r = json.load(open('/tmp/exit.json'))
out = (r.get('output') or '').strip()
print('---OUTPUT---')
print(out)
print('---TOOL CALLS---')
for tc in r.get('toolCalls', []):
    p = tc.get('payload', tc)
    print(' -', p.get('toolName'), json.dumps(p.get('args'), default=str)[:120])
print('---CHECKS---')
checks = [
  ('mentions duration in min',
   bool(re.search(r'\b\d{1,3}\s*(?:min|minute)', out, re.I))),
  ('mentions numeric HR avg',
   bool(re.search(r'(?:avg(?:erag\w*)?(?:\s*HR)?|HR\s*avg(?:erage)?|averag\w*)\D{0,8}\b1[0-9]{2}\b', out, re.I))
   or bool(re.search(r'\b1[0-9]{2}\b\s*(?:bpm|avg)', out, re.I))),
  ('mentions peak/max/zone/band/drift',
   bool(re.search(r'\b(peak|max(?!imize)|zone|band|drift|distrib|spent.*in|min.*in.*\d)', out, re.I))),
  ('does NOT punt',
   not re.search(r'unfortunately|no details|if you have more data|sync.*properly|could you (?:check|clarify)', out, re.I)),
]
all_ok = True
for label, ok in checks:
    print(('✓' if ok else '✗'), label)
    all_ok = all_ok and ok
sys.exit(0 if all_ok else 1)
PY
```

Expected: all 4 ✓ marks AND exit code 0. If ANY ✗, the plan is NOT done — read the OUTPUT block, identify the gap, and either tighten the prompt (Task 4 follow-up) or surface more data on the row (Task 3 follow-up). Re-run smoke.

- [ ] **Step 5: Final summary commit**

```bash
cd /opt/Code/DaylightStation && git commit --allow-empty -m "$(cat <<'EOF'
chore(health-coach): eager-detail shipped — runs described in one response

5 tasks landed:
- T1: computeHrStats (mean/max/p50/p90/drift_pct/bands)
- T2: pickPrimaryHrSeries
- T3: queryEvents eagerly hydrates n ≤ 3 result sets
- T4: prompt — describe runs from hr_stats, ban "no details" punts
- T5: deploy + exit-criteria smoke pass

Exit criteria met: "how was my run today?" produces a single response
with duration in minutes, HR avg as a number, and at least one of
{peak, max, zone, band, drift} — no clarifying question, no
"unfortunately"/"no details" punt.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| Failure mode (from 9:36 UI transcript) | Tasks |
|---|---|
| `query_events` returned `hr_avg: null` even though full session has data | T3 (eager hydration via getSession) |
| Agent reported "Unfortunately, no details on heart rate" | T4 (prompt forbids the phrase, T3 surfaces hr_stats) |
| No HR distribution / zone / drift in narrative | T1 (compute), T3 (surface), T4 (instruct) |
| Wide queries should still be cheap | T3 (n ≤ 3 gate) |
| Verifiable end-to-end | T5 (regex assertion script with non-zero exit on fail) |

---

## Notes for the implementer

- **The hydrate path uses `getSession`, not `getById`.** The earlier plan added a chain of fallbacks (`getById` → `findByStravaId` → 60-day scan) but on this codebase `sessionService.getSession(sessionId, householdId)` is the real method (confirmed at `backend/src/3_applications/fitness/services/SessionService.mjs:173`). The hydrate path here should ONLY call `getSession` — don't reintroduce the fallback chain in this hot path.
- **The earlier plan's `getEventDetail` already calls `getSession`** for 14-digit IDs. So an alternative implementation of `#hydrate` could call `this.getEventDetail({ id: e.session_id })` instead of touching `sessionService` directly. That's cleaner. Consider it — but watch for double-roundtripping on 14-digit IDs through the regex path. Either approach is fine; the tests (which mock `sessionService.getSession`) will pass either way as long as `getSession` is called.
- **Ban list in the prompt is intentional.** The model has a known tendency to soften failures with "unfortunately" / "if you have more data". Listing the forbidden phrases verbatim in the prompt is the most reliable nudge.
- **Wide-query threshold (n ≤ 3) is a starting point.** If the agent asks for narrow data via filters (e.g. only Runs in last 7d → 2 events), hydration kicks in. If the user asks "how was my last run?" with a 1d window → 1 event, hydration kicks in. Tune the threshold up if narrative quality at n=2/3 is good but n=4 is poor.
- **`hr_stats.bands` uses 5 fixed HR ranges**, not personal HR zones. The agent CAN compute personal zones via `personal_constants` (max HR = 220 - age) + `compute()` if the user asks, but the bands work as a generic narrative crutch without any personalization.
