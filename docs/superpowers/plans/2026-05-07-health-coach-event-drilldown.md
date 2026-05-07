# Health-Coach Event Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the agent a way to surface individual events (workouts, meals, weigh-ins) with their natural identifiers (Strava ID, sessionId) and drill into a specific event for full detail. Enables conversation patterns like *"how was my run today?"* → agent describes the run and includes its IDs → user follows up *"what about HR?"* → agent calls `get_event_detail(id)` and runs `compute()` on the HR series.

**Architecture:** Two new tools in HealthQueryToolFactory: `query_events` (returns event rows with IDs) and `get_event_detail` (fetches one event by ID). Both wrap existing services (`sessionService.listSessionsInRange`, `sessionService.getById` or equivalent). Plus a prompt update that tells the agent to surface IDs in prose and drill in on follow-ups. Plus the two cosmetic carryovers (CSS overlay + latency wire).

**Tech Stack:** Existing fitness Session entity (already has `strava` metadata + HR `timeline.series`), existing sessionService.

---

## File structure

**Modified files:**

```
backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs   — NEW: wraps sessionService for event listing + detail
backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs — adds query_events + get_event_detail tools
backend/src/0_system/bootstrap.mjs                                               — wires sessionService into the new EventQueryService
backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs              — passes eventQueryService through deps
backend/src/3_applications/agents/health-coach/prompts/chat.mjs                  — adds Drill-down section + ID surfacing rule
frontend/src/modules/Agent/AgentChatSurface.scss                                 — overlay variant: assistant bg, composer, input
backend/src/1_adapters/agents/MastraAdapter.mjs                                  — emits latencyMs on tool-end SSE chunks
```

**New tests:**

```
tests/isolated/agents/health-coach/event_query/
  query_events.test.mjs
  get_event_detail.test.mjs
```

---

## Task 1: EventQueryService — list events with IDs

The service that powers `query_events`. Wraps `sessionService.listSessionsInRange` and returns event rows with the identifiers a follow-up needs (Strava ID, internal sessionId, type, date, duration, kcal, hr_avg, hr_max, distance, source).

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs`
- Create: `tests/isolated/agents/health-coach/event_query/query_events.test.mjs`

- [ ] **Step 1: Read the existing sessionService API**

```bash
cd /opt/Code/DaylightStation && grep -n "listSessionsByDate\|listSessionsInRange\|getById\|getSession" backend/src/3_applications/fitness/services/ backend/src/2_domains/fitness/ 2>&1 | head -10
cd /opt/Code/DaylightStation && cat backend/src/2_domains/fitness/entities/Session.mjs | head -60
```

Identify:
- Method to list sessions in a date range (likely `sessionService.listSessionsInRange(startDate, endDate, householdId)`)
- Method to get one session by id (look for `getById`, `findById`, or similar)
- The Session entity's exposed fields (`sessionId`, `startTime`, `endTime`, `durationMs`, `roster`, `strava`, `timeline.series`, etc.)

Note the Session's natural identifiers:
- `sessionId` — internal `YYYYMMDDHHmmss` 14-digit string
- `strava?.id` — Strava activity ID when present (sessions sourced from Strava webhook)
- `strava?.name` — Strava activity name (e.g. "Morning Run")
- `strava?.type` — Strava activity type ("Run", "Ride", etc.)

- [ ] **Step 2: Write failing tests**

```javascript
// tests/isolated/agents/health-coach/event_query/query_events.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { EventQueryService } from '../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

function makeSession({ sessionId, startTime, durationMs, type = 'Run', stravaId = null, hr_avg = 140, hr_max = 175, distance_mi = 4.2 }) {
  return {
    sessionId,
    startTime,
    durationMs,
    strava: stravaId ? { id: stravaId, type, name: `${type} on ${startTime.slice(0, 10)}` } : null,
    metadata: { hr_avg, hr_max, distance_mi, kcal: 380 },
  };
}

function makeSvc(sessions) {
  return new EventQueryService({
    sessionService: {
      listSessionsInRange: vi.fn(async () => sessions),
    },
    householdId: 'kckern',
  });
}

describe('EventQueryService.queryEvents — workouts', () => {
  it('returns one row per session with natural IDs', async () => {
    const sessions = [
      makeSession({ sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 38 * 60_000, stravaId: 12345 }),
      makeSession({ sessionId: '20260506180000', startTime: '2026-05-06T18:00:00Z', durationMs: 45 * 60_000, type: 'WeightTraining', stravaId: 12340 }),
    ];
    const svc = makeSvc(sessions);
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_7d' } });
    expect(r.events).toHaveLength(2);
    expect(r.events[0]).toMatchObject({
      session_id: '20260507060000',
      strava_id: 12345,
      type: 'Run',
      date: '2026-05-07',
      duration_min: 38,
      hr_avg: 140,
    });
    expect(r.events[1].type).toBe('WeightTraining');
  });

  it('handles sessions without Strava metadata', async () => {
    const sessions = [makeSession({ sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 30 * 60_000 })];
    const svc = makeSvc(sessions);
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_1d' } });
    expect(r.events[0].strava_id).toBe(null);
    expect(r.events[0].session_id).toBe('20260507060000');
  });

  it('filters by type when type filter passed', async () => {
    const sessions = [
      makeSession({ sessionId: '1', startTime: '2026-05-07T06:00:00Z', durationMs: 30_000, type: 'Run', stravaId: 1 }),
      makeSession({ sessionId: '2', startTime: '2026-05-06T06:00:00Z', durationMs: 30_000, type: 'Ride', stravaId: 2 }),
    ];
    const svc = makeSvc(sessions);
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_7d' }, filter: { type: 'Run' } });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].type).toBe('Run');
  });

  it('returns meta envelope', async () => {
    const svc = makeSvc([]);
    const r = await svc.queryEvents({ kind: 'workout', period: { rolling: 'last_7d' } });
    expect(r.meta).toMatchObject({ kind: 'workout', n: 0 });
  });

  it('throws on unsupported kind', async () => {
    const svc = makeSvc([]);
    await expect(svc.queryEvents({ kind: 'unsupported', period: { rolling: 'last_7d' } }))
      .rejects.toThrow(/kind/);
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/event_query/query_events.test.mjs
```

- [ ] **Step 4: Implement**

```javascript
// backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs

const SUPPORTED_KINDS = new Set(['workout']);  // future: 'meal', 'weigh_in'

export class EventQueryService {
  #sessionService;
  #householdId;
  #now;

  constructor({ sessionService, householdId, now = () => new Date() }) {
    if (!sessionService) throw new Error('EventQueryService: sessionService required');
    this.#sessionService = sessionService;
    this.#householdId = householdId;
    this.#now = now;
  }

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
      return {
        events,
        meta: { kind, period, n: events.length, generated_at: this.#now().toISOString() },
      };
    }
    return { events: [], meta: { kind, n: 0, generated_at: this.#now().toISOString() } };
  }

  async getEventDetail({ id, kind = 'workout' }) {
    if (!id) throw new Error('EventQueryService: id required');
    if (kind !== 'workout') throw new Error(`EventQueryService: unsupported kind "${kind}"`);

    // Try internal sessionId first; fall back to Strava ID lookup if needed.
    let session = null;
    if (typeof this.#sessionService.getById === 'function') {
      session = await this.#sessionService.getById(String(id), this.#householdId).catch(() => null);
    }
    if (!session && typeof this.#sessionService.findByStravaId === 'function') {
      session = await this.#sessionService.findByStravaId(id, this.#householdId).catch(() => null);
    }
    if (!session) {
      return { error: `event not found for id=${id}` };
    }
    return this.#sessionToDetail(session);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  #resolvePeriod(period) {
    if (typeof period === 'string') return this.#resolvePeriod({ rolling: period });
    if (period?.rolling) {
      const m = /^last_(\d+)d$/.exec(period.rolling);
      if (m) {
        const days = parseInt(m[1], 10);
        const today = this.#now();
        const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        const fromDate = new Date(todayUtc);
        fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
        return { from: fromDate.toISOString().slice(0, 10), to: todayUtc.toISOString().slice(0, 10) };
      }
    }
    if (period?.from && period?.to) return { from: period.from, to: period.to };
    throw new Error(`EventQueryService: unsupported period ${JSON.stringify(period)}`);
  }

  #sessionToEvent(s) {
    return {
      session_id: s.sessionId?.toString?.() ?? String(s.sessionId),
      strava_id: s.strava?.id ?? null,
      type: s.strava?.type ?? 'Workout',
      name: s.strava?.name ?? null,
      date: (s.startTime ?? '').slice(0, 10),
      start_time: s.startTime ?? null,
      duration_min: s.durationMs ? Math.round(s.durationMs / 60000) : null,
      kcal: s.metadata?.kcal ?? null,
      hr_avg: s.metadata?.hr_avg ?? null,
      hr_max: s.metadata?.hr_max ?? null,
      distance_mi: s.metadata?.distance_mi ?? null,
      source: s.strava ? 'strava' : 'local',
    };
  }

  #sessionToDetail(s) {
    return {
      ...this.#sessionToEvent(s),
      timeline: {
        // HR series per participant — keys are participant names, values are HR values per second.
        series: s.timeline?.series ?? {},
        events: s.timeline?.events ?? [],
      },
      metadata: s.metadata ?? {},
      strava: s.strava ?? null,
      strava_notes: s.strava_notes ?? null,
    };
  }
}

export default EventQueryService;
```

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/event_query/query_events.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs \
        tests/isolated/agents/health-coach/event_query/query_events.test.mjs
git commit -m "$(cat <<'EOF'
feat(health-coach): EventQueryService — list events with natural IDs

Plan / Task 1. Returns workout events as rows with sessionId + strava_id
+ type + duration + HR + distance. The agent uses these IDs for
follow-up drill-down via get_event_detail. Service-side; tools land
in Task 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: EventQueryService.getEventDetail — fetch one event by ID

The implementation already lives in Task 1's service file (`getEventDetail` method). This task just adds tests for it.

**Files:**
- Create: `tests/isolated/agents/health-coach/event_query/get_event_detail.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { EventQueryService } from '../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

function makeSession({ sessionId, startTime, durationMs, stravaId = null, hr_series = null }) {
  return {
    sessionId,
    startTime,
    durationMs,
    strava: stravaId ? { id: stravaId, type: 'Run', name: 'Morning Run' } : null,
    metadata: { hr_avg: 142, hr_max: 175, distance_mi: 4.2, kcal: 380 },
    timeline: hr_series ? { series: { kc: hr_series }, events: [] } : { series: {}, events: [] },
    strava_notes: null,
  };
}

describe('EventQueryService.getEventDetail', () => {
  it('returns full record when found by sessionId', async () => {
    const session = makeSession({
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 38 * 60_000,
      stravaId: 12345, hr_series: [120, 125, 130, 135, 140, 145, 150],
    });
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => []),
        getById: vi.fn(async () => session),
      },
      householdId: 'kckern',
    });
    const r = await svc.getEventDetail({ id: '20260507060000' });
    expect(r.session_id).toBe('20260507060000');
    expect(r.strava_id).toBe(12345);
    expect(r.timeline.series.kc).toEqual([120, 125, 130, 135, 140, 145, 150]);
  });

  it('falls back to findByStravaId when sessionService.getById returns null', async () => {
    const session = makeSession({
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 38 * 60_000,
      stravaId: 12345,
    });
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => []),
        getById: vi.fn(async () => null),
        findByStravaId: vi.fn(async (id) => id === 12345 ? session : null),
      },
      householdId: 'kckern',
    });
    const r = await svc.getEventDetail({ id: 12345 });
    expect(r.strava_id).toBe(12345);
  });

  it('returns error envelope when not found', async () => {
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => []),
        getById: vi.fn(async () => null),
        findByStravaId: vi.fn(async () => null),
      },
      householdId: 'kckern',
    });
    const r = await svc.getEventDetail({ id: 'unknown' });
    expect(r.error).toMatch(/not found/);
  });

  it('rejects when id missing', async () => {
    const svc = new EventQueryService({ sessionService: {}, householdId: 'kckern' });
    await expect(svc.getEventDetail({})).rejects.toThrow(/id/);
  });
});
```

- [ ] **Step 2: Run; pass** (the implementation lives in Task 1's file)

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/event_query/get_event_detail.test.mjs
```

If `sessionService.getById` or `sessionService.findByStravaId` don't exist on the real service, the tests still pass via the mocks; Task 4 (bootstrap wiring) will surface any real-world API gap. Note for the implementer: if real sessionService has different method names (`fetchById` vs `getById`), update the EventQueryService implementation to match.

- [ ] **Step 3: Commit**

```bash
git add tests/isolated/agents/health-coach/event_query/get_event_detail.test.mjs
git commit -m "test(health-coach): EventQueryService.getEventDetail tests

Plan / Task 2. Covers sessionId lookup, Strava-ID fallback, not-found
envelope, and missing-id reject.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire `query_events` and `get_event_detail` tools

Add the two tools to `HealthQueryToolFactory`. Their existence is what gives the agent a way to drill in.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs`
- Modify: `tests/isolated/agents/health-coach/query_health/tool.test.mjs`

- [ ] **Step 1: Read current HealthQueryToolFactory**

```bash
cd /opt/Code/DaylightStation && cat backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs
```

- [ ] **Step 2: Update tool.test.mjs to expect 5 tools**

Modify the existing factory test:

```javascript
// In tests/isolated/agents/health-coach/query_health/tool.test.mjs

function makeFactory() {
  const queryService     = { query: vi.fn(async () => ({ value: 1462, count: 30, meta: {} })) };
  const sandbox          = { evaluate: vi.fn(() => ({ value: 1986, type: 'number', expression: '...', durationMs: 1 })) };
  const constantsService = { get: vi.fn(async () => ({ height_cm: 180 })) };
  const eventQueryService = {
    queryEvents: vi.fn(async () => ({ events: [{ session_id: '1', strava_id: 12345, type: 'Run' }], meta: { kind: 'workout', n: 1 } })),
    getEventDetail: vi.fn(async () => ({ session_id: '1', strava_id: 12345, timeline: { series: { kc: [120, 130] }, events: [] } })),
  };
  return {
    factory: new HealthQueryToolFactory({ queryService, sandbox, constantsService, eventQueryService }),
    queryService, sandbox, constantsService, eventQueryService,
  };
}

it('produces five tools', () => {
  const { factory } = makeFactory();
  const names = factory.createTools().map(t => t.name).sort();
  expect(names).toEqual(['compute', 'get_event_detail', 'personal_constants', 'query_events', 'query_health']);
});

it('query_events forwards to eventQueryService', async () => {
  const { factory, eventQueryService } = makeFactory();
  const tool = factory.createTools().find(t => t.name === 'query_events');
  const r = await tool.execute({ kind: 'workout', period: { rolling: 'last_7d' } });
  expect(eventQueryService.queryEvents).toHaveBeenCalled();
  expect(r.events).toHaveLength(1);
  expect(r.events[0].strava_id).toBe(12345);
});

it('get_event_detail forwards to eventQueryService', async () => {
  const { factory, eventQueryService } = makeFactory();
  const tool = factory.createTools().find(t => t.name === 'get_event_detail');
  const r = await tool.execute({ id: '20260507060000' });
  expect(eventQueryService.getEventDetail).toHaveBeenCalledWith({ id: '20260507060000' });
  expect(r.timeline.series.kc).toEqual([120, 130]);
});
```

Keep the existing tests for `query_health`, `compute`, `personal_constants`. Just update the count assertion and add two more.

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/query_health/tool.test.mjs
```

- [ ] **Step 4: Update HealthQueryToolFactory**

Add the constructor dep + the two new tool definitions. Sketch:

```javascript
constructor({ queryService, sandbox, constantsService, eventQueryService }) {
  super();
  if (!queryService)       throw new Error('HealthQueryToolFactory: queryService required');
  if (!sandbox)            throw new Error('HealthQueryToolFactory: sandbox required');
  if (!constantsService)   throw new Error('HealthQueryToolFactory: constantsService required');
  if (!eventQueryService)  throw new Error('HealthQueryToolFactory: eventQueryService required');
  this.#queryService = queryService;
  this.#sandbox = sandbox;
  this.#constantsService = constantsService;
  this.#eventQueryService = eventQueryService;
}

createTools() {
  // ... existing 3 tools ...
  return [
    /* query_health */ ...,
    /* compute */      ...,
    /* personal_constants */ ...,
    {
      name: 'query_events',
      description: 'List individual events (workouts, etc.) with their natural identifiers — sessionId, strava_id, type, date, duration, kcal, hr_avg, hr_max, distance_mi. Use this when the user asks about specific events ("how was my run today?"); include the IDs in your prose so follow-up questions can drill in via get_event_detail.',
      parameters: {
        type: 'object',
        properties: {
          kind:   { type: 'string', enum: ['workout'], description: 'Event kind. Currently only "workout" is supported.' },
          period: { description: '{ rolling: "last_30d" } | { from, to } | bare string shorthand' },
          filter: { type: 'object', description: 'Optional filter, e.g. { type: "Run" }' },
          limit:  { type: 'number' },
          userId: { type: 'string' },
        },
        required: ['kind', 'period', 'userId'],
      },
      execute: async (args) => this.#eventQueryService.queryEvents(args),
    },
    {
      name: 'get_event_detail',
      description: 'Fetch full detail for a specific event by ID. Pass either the sessionId (YYYYMMDDHHmmss) or the Strava activity ID. Returns the event\\'s metadata + timeline.series (HR per second) + events. Use this for follow-up drill-down after query_events surfaces an ID.',
      parameters: {
        type: 'object',
        properties: {
          id:     { description: 'sessionId (string) or Strava activity ID (number).' },
          kind:   { type: 'string', enum: ['workout'], default: 'workout' },
          userId: { type: 'string' },
        },
        required: ['id', 'userId'],
      },
      execute: async ({ id, kind, userId }) => this.#eventQueryService.getEventDetail({ id, kind }),
    },
  ];
}
```

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/health-coach/query_health/tool.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs \
        tests/isolated/agents/health-coach/query_health/tool.test.mjs
git commit -m "$(cat <<'EOF'
feat(health-coach): query_events + get_event_detail tools

Plan / Task 3. Wires EventQueryService into the factory as two new
tools. query_events lists individual workouts with natural IDs;
get_event_detail fetches one by ID and returns the full record
including HR series. Together they enable conversation drill-down:
"how was my run today?" → IDs surfaced → "what about HR?" → drill in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Bootstrap wiring + agent registration

Wire the new service into bootstrap and pass it through to HealthCoachAgent.

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`

- [ ] **Step 1: Locate the existing health-coach service wiring in bootstrap**

```bash
cd /opt/Code/DaylightStation && grep -n "HealthQueryService\|sessionService\|HealthCoachAgent" backend/src/0_system/bootstrap.mjs | head -10
```

- [ ] **Step 2: Add EventQueryService construction**

Just below `personalConstantsService`, add:

```javascript
import { EventQueryService } from '#apps/agents/health-coach/services/EventQueryService.mjs';

// ... where the other services are constructed ...
const eventQueryService = new EventQueryService({
  sessionService,
  householdId,  // whatever variable holds the household id in scope
});
```

Add `eventQueryService` to the deps map passed to `agentOrchestrator.register(HealthCoachAgent, deps)`.

- [ ] **Step 3: Update HealthCoachAgent.registerTools**

In the `HealthQueryToolFactory` construction inside `registerTools()`, add `eventQueryService`:

```javascript
this.addToolFactory(new HealthQueryToolFactory({
  queryService:     healthQueryService,
  sandbox:          computeSandbox,
  constantsService: personalConstantsService,
  eventQueryService,
}));
```

- [ ] **Step 4: node -c**

```bash
cd /opt/Code/DaylightStation && node -c backend/src/0_system/bootstrap.mjs && node -c backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs && echo OK
```

- [ ] **Step 5: Full agent suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs
git commit -m "feat(health-coach): wire EventQueryService through bootstrap

Plan / Task 4. Constructs EventQueryService alongside other health-coach
services; passes through HealthCoachAgent deps; HealthQueryToolFactory
now receives all four services and registers the 5 tools.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Prompt — drill-down protocol + ID surfacing + conversation context

Three additions to `chat.mjs`:

1. New section "## Drill-down protocol" — when describing an event, surface IDs; on follow-ups, use `get_event_detail`.
2. Restore "## Default windows" guidance (dropped in the rewrite).
3. New "## Don't ask back" rail.

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/prompts/chat.mjs`

- [ ] **Step 1: Update the prompt**

Insert after "## Reasoning patterns":

```
## Drill-down protocol

When the user asks about specific events ("how was my run today?",
"what did I eat for lunch?"), use query_events to list them and
INCLUDE THEIR IDS in your prose:

  "Your run today (sessionId 20260507060000, Strava 12345): 38 min,
   142 avg HR, 9:14/mi pace."

When the user follows up with a question that drills into one of
those events ("what about HR?", "how were the splits?"), call
get_event_detail with the ID from prior context. Don't re-list — go
deep. The detail includes the full HR series — pass it to compute()
to extract zone breakdowns, max, drift, etc.

## Default windows

When the user doesn't specify a period:
- "today" or follow-up about an event mentioned earlier → last_1d
- "this week" / "lately" / "now" → last_7d
- "recent" or no temporal hint → last_30d
- Yearly questions → last_365d or this_year

Default first; don't punt with "what period?" — the user can correct
if they wanted a different window.

## Don't ask back

If the user's question has an obvious answer in the data (and an
obvious default for any unspecified parameter), DO NOT ask a clarifying
question. Run the query, present the result, and offer to refine if
needed.

  Bad:  "What period? Last 7 days? Last month?"
  Good: "Last 7 days you averaged X. Want a longer window?"

  Bad (after talking about today's run):
        "What period for heart rate?"
  Good: get_event_detail(<the run ID from prior turn>) → analyze HR
        → "Your HR averaged 142, peaked at 175, spent 22 min in zone 2."
```

- [ ] **Step 2: Verify the prompt still includes the canonical sections**

```bash
cd /opt/Code/DaylightStation && node -e "
import('./backend/src/3_applications/agents/health-coach/prompts/chat.mjs').then(m => {
  const checks = [
    ['Drill-down protocol', m.chatPrompt.includes('Drill-down protocol')],
    ['Default windows',     m.chatPrompt.includes('Default windows')],
    [\"Don't ask back\",     m.chatPrompt.includes(\"Don't ask back\")],
    ['query_events',         m.chatPrompt.includes('query_events')],
    ['get_event_detail',     m.chatPrompt.includes('get_event_detail')],
  ];
  for (const [name, ok] of checks) console.log(ok ? '✓' : '✗', name);
});
"
```

Expected: all five ✓.

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/prompts/chat.mjs
git commit -m "$(cat <<'EOF'
feat(health-coach): prompt — drill-down protocol + default windows + don't-ask-back

Plan / Task 5. Three additions to fix the live conversation patterns:
- Drill-down protocol: surface event IDs in prose; use get_event_detail
  on follow-ups. Compute on the HR series for zone/drift analysis.
- Default windows: restore the period-defaulting guidance dropped in
  the rewrite (last_1d for "today", last_7d for "lately", etc.).
- Don't ask back: explicit rail against punting clarifying questions
  when context is clear.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: CSS overlay variant fix

Carry-over from earlier diagnosis — the overlay variant only overrode `color` on assistant bubbles, leaving the gray-1 background that produces white-on-white in the dark theme.

**Files:**
- Modify: `frontend/src/modules/Agent/AgentChatSurface.scss`

- [ ] **Step 1: Replace the existing `.coach-chat--overlay` block**

Read the file first to confirm the existing block boundaries, then replace lines ~119-147 with:

```scss
.coach-chat--overlay {
  background: var(--mantine-color-background-0);
  color: var(--mantine-color-textHigh-0);

  --aui-primary: #2563eb;
  --aui-primary-foreground: #fff;
  --aui-background: var(--mantine-color-background-0);
  --aui-foreground: var(--mantine-color-textHigh-0);
  --aui-muted: var(--mantine-color-surface-0);
  --aui-muted-foreground: var(--mantine-color-textMid-0);
  --aui-border: var(--mantine-color-border-0);
  --aui-radius: 14px;

  .coach-chat__message--user [data-message-part-text] {
    background: var(--mantine-color-surface-0);
    color: var(--mantine-color-textHigh-0);
    border-radius: 14px;
    padding: 10px 14px;
    max-width: 70%;
    margin-left: auto;
    align-self: flex-end;
  }

  .coach-chat__message--assistant {
    background: var(--mantine-color-surface-0);
    color: var(--mantine-color-textHigh-0);
    border-radius: 14px;
    padding: 10px 14px;
    line-height: 1.6;
    max-width: 90%;
  }

  .coach-chat__composer {
    background: var(--mantine-color-background-0);
    border-top: 1px solid var(--mantine-color-border-0);
  }

  .coach-chat__input {
    background: var(--mantine-color-surface-0);
    color: var(--mantine-color-textHigh-0);
    border: 1px solid var(--mantine-color-border-0);

    &:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
    }

    &[data-empty]::before {
      color: var(--mantine-color-textLow-0);
    }
  }
}
```

- [ ] **Step 2: Vite build**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Agent/AgentChatSurface.scss
git commit -m "fix(coach-chat): overlay variant — assistant bg + composer + input

Plan / Task 6. The overlay variant only overrode text color on assistant
messages; background still inherited gray-1 (near-white) producing
white-on-white. Same issue for composer and input. Now uses surface-0
+ border-0 tokens consistently.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Latency wire — emit `latencyMs` on tool-end SSE chunks

Carry-over. Frontend already reads `event.latencyMs` (verified at `frontend/src/modules/Agent/runtime.js:88`). Server side: confirm `MastraAdapter.streamExecute` includes `latencyMs` on the `tool-end` chunks; if not, add it.

**Files:**
- Modify: `backend/src/1_adapters/agents/MastraAdapter.mjs` (only if needed)

- [ ] **Step 1: Inspect the streamExecute output**

```bash
cd /opt/Code/DaylightStation && grep -B 2 -A 8 "type: 'tool-end'\|type:'tool-end'" backend/src/1_adapters/agents/MastraAdapter.mjs | head -30
```

If the yielded chunk is `{ type: 'tool-end', toolName, result }` without `latencyMs`, that's the bug.

- [ ] **Step 2: Fix**

The fix depends on where the `tool-end` chunk is yielded. Likely:

```javascript
// Was:
yield { type: 'tool-end', toolName, result };

// Becomes:
yield { type: 'tool-end', toolName, result, latencyMs };
```

`latencyMs` is captured by timing the tool-call. If `streamExecute` doesn't currently track it, add a per-call timer:

```javascript
case 'tool_call_start': {
  this.#toolStartTimes.set(call.id, Date.now());
  yield { type: 'tool-start', toolName: call.toolName, args: call.args };
  break;
}
case 'tool_call_end': {
  const startedAt = this.#toolStartTimes.get(call.id);
  const latencyMs = startedAt ? Date.now() - startedAt : 0;
  this.#toolStartTimes.delete(call.id);
  yield { type: 'tool-end', toolName: call.toolName, result: call.result, latencyMs };
  break;
}
```

Read the actual streamExecute first; the structure depends on Mastra's event API. If Mastra exposes the duration directly in its tool-end event, just thread it through. If not, the per-call timer above works.

- [ ] **Step 3: Live smoke**

```bash
curl -N -X POST http://localhost:3111/api/v1/agents/health-coach/run-stream \
  -H "Content-Type: application/json" \
  -d '{"input":"what is my current weight?","context":{"userId":"kckern"}}' | head -50
```

Look for `tool-end` chunks — each should include `"latencyMs": <non-zero>`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/1_adapters/agents/MastraAdapter.mjs
git commit -m "fix(agents): MastraAdapter emits latencyMs on tool-end SSE chunks

Plan / Task 7. The transcript records real latencies but the SSE wire
to the frontend dropped them, so ToolCallAttribution renders 0ms for
every call. Adapter now captures tool-call duration and threads it
into the tool-end chunk; frontend already reads event.latencyMs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Build + deploy + live smoke (the conversation that failed)

Re-run the exact conversation pattern that motivated this plan.

- [ ] **Step 1: Full vitest**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

- [ ] **Step 2: Vite build**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3
```

- [ ] **Step 3: Build + deploy**

```bash
cd /opt/Code/DaylightStation && sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" . 2>&1 | tail -3 && \
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight 2>&1 | tail -3 && \
sleep 12
```

- [ ] **Step 4: Live smoke — the failing conversation**

Two-turn sequence: ask about today's run, then drill into HR.

```bash
echo "=== Turn 1: how was my run today? ==="
curl -sS -X POST http://localhost:3111/api/v1/agents/health-coach/run \
  -H "Content-Type: application/json" \
  -d '{"input":"how was my run today?","context":{"userId":"kckern"}}' \
  > /tmp/turn1.json
python3 -c "
import json
r = json.load(open('/tmp/turn1.json'))
print('toolCalls:', len(r.get('toolCalls', [])))
for tc in r.get('toolCalls', []):
    p = tc.get('payload', {}) if isinstance(tc, dict) else {}
    print('  ', p.get('toolName'), json.dumps(p.get('args', {}), default=str)[:80])
print('output:', (r.get('output') or '')[:600])
"

echo
echo "=== Turn 2: what about heart rate? ==="
curl -sS -X POST http://localhost:3111/api/v1/agents/health-coach/run \
  -H "Content-Type: application/json" \
  -d '{"input":"what about heart rate?","context":{"userId":"kckern"}}' \
  > /tmp/turn2.json
python3 -c "
import json
r = json.load(open('/tmp/turn2.json'))
print('toolCalls:', len(r.get('toolCalls', [])))
for tc in r.get('toolCalls', []):
    p = tc.get('payload', {}) if isinstance(tc, dict) else {}
    print('  ', p.get('toolName'), json.dumps(p.get('args', {}), default=str)[:80])
print('output:', (r.get('output') or '')[:600])
"
```

NOTE: The agent runs each turn fresh (no session continuity in single-shot HTTP — turn 2 doesn't see turn 1's context unless that's wired through working memory or conversation state). For a true multi-turn smoke, the SSE frontend chat is the better surface — open the UI and run the conversation manually.

For the curl smoke: turn 1 should show `query_events` being called and the output should mention sessionId or strava_id. Turn 2 (without prior context) should default to last_1d for "heart rate" and either query_events first, then drill in, OR just call get_event_detail if the agent reasons about today's events.

Expected pass criteria:
- Turn 1: at least one tool call (likely query_events for kind=workout, last_1d), output mentions a workout with IDs
- Turn 2 (in absence of context): falls back to default last_1d, surfaces HR data
- Either turn doesn't punt with "what period?"

If turn 2 punts because there's no conversation context at the API level, that's a separate issue (conversation state not threading through `/api/v1/agents/.../run`). Worth noting but out of scope here — the architectural fix is in place.

- [ ] **Step 5: Final empty commit**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore(health-coach): event drill-down + UX fixes shipped

8 tasks landed:
- T1-2: EventQueryService (queryEvents + getEventDetail)
- T3:   query_events + get_event_detail tools
- T4:   bootstrap + agent wiring
- T5:   prompt — drill-down protocol + default windows + don't-ask-back
- T6:   CSS overlay variant — fix white-on-white
- T7:   SSE wire emits latencyMs on tool-end chunks
- T8:   build + deploy + live smoke

Agent now surfaces individual events with their IDs (sessionId, Strava
ID), and follow-up questions drill in via get_event_detail. The HR
series is exposed for zone analysis via compute().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| Issue | Tasks |
|---|---|
| Agent can't drill into specific events with IDs | 1, 2, 3, 4 |
| Agent punts with clarifying questions | 5 |
| White-on-white CSS in chat overlay | 6 |
| Frontend latency display showing 0ms | 7 |
| Final verification + deploy | 8 |

---

## Notes for the implementer

- **Task 1 — sessionService API.** The plan's `listSessionsInRange(from, to, householdId)` signature is from grep. If the actual API is `listSessionsInRange(startDate, endDate, hid)` (different param names) or if the sessionService doesn't have this method at all, adapt EventQueryService to use whatever is there. Sometimes the sessionService is per-user vs per-household; check.

- **Task 1 — Session shape.** The HR series lives at `session.timeline.series[participantName]`. For health-coach, the participant key is likely the userId or a household member's name. EventQueryService passes the entire `series` object through; the agent picks the relevant participant in `compute()`.

- **Task 2 — sessionService.getById.** May not exist with that exact name. Look for `findById`, `loadById`, `get(id)`, etc. If nothing fits, the implementer can either:
  - Add `getById` to sessionService (small addition)
  - Implement it in EventQueryService by listing recent sessions and filtering by id

- **Task 5 — prompt iteration is iterative.** This adds three rails. If after deploy the agent STILL punts on certain shapes, log the failing transcript and add another rail. Don't try to handle every possible failure mode in one shot.

- **Task 8 — multi-turn context.** The single-shot HTTP API at `/api/v1/agents/.../run` doesn't carry conversation state between requests. For a real test of "how was my run today?" → "what about HR?", the SSE chat in the frontend UI carries assistant-ui's local conversation state. The curl smoke is approximate; the real validation is opening the chat UI and running the conversation.

- **Strava API usage.** This plan does not call Strava. `get_event_detail` returns whatever the local Session entity has (which already includes Strava metadata pulled at webhook time). If a session's HR series is sparse and we want to fetch from Strava live, that's a future addition — not in scope here.
