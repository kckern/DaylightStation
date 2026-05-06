# HealthApp Polish + Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two coordinated CoachChat improvements (mentions/all fanout, SSE streaming, markdown rendering) AND a full HealthApp visual redesign (dark theme, hero metric cards with sparklines, persistent AskBar + ChatOverlay replacing tabs, ✦ AI mark) in one combined plan, one merge, one deploy.

**Architecture:** Backend gets a streaming endpoint + a fanout fix. Frontend gets a persistent ask-bar + slide-up chat overlay pattern that retires the existing Tabs structure. Theme tokens move to a Mantine override scoped to HealthApp. CoachChat keeps its existing module but gains a `variant="overlay"` prop, markdown rendering via `react-markdown`, and an async-generator streaming runtime.

**Tech Stack:** React 18 + Mantine 7 + `@mantine/charts` (already installed) + Vitest + `@testing-library/react`. New runtime deps: `react-markdown`, `remark-gfm`. Backend: Express + existing `MastraAdapter.streamExecute`.

**Specs:**
- [docs/superpowers/specs/2026-05-06-coachchat-polish-design.md](../specs/2026-05-06-coachchat-polish-design.md) — mentions/all + streaming + markdown
- [docs/superpowers/specs/2026-05-06-healthapp-redesign-design.md](../specs/2026-05-06-healthapp-redesign-design.md) — visual redesign

**Prerequisites:** All earlier plans merged. CoachChat (v1) on main. AgentTranscript on main. `MastraAdapter.streamExecute()` present.

---

## File structure

**New files:**

```
backend/src/4_api/v1/routers/agents-stream.mjs              — separate file for the streaming route (cleaner than appending to agents.mjs)
tests/isolated/api/routers/agents.runStream.test.mjs

frontend/src/modules/Health/AiMark/
  index.jsx
  AiMark.scss
  AiMark.test.jsx

frontend/src/modules/Health/AskBar/
  index.jsx
  AskBar.scss
  AskBar.test.jsx

frontend/src/modules/Health/ChatOverlay/
  index.jsx
  ChatOverlay.scss
  ChatOverlay.test.jsx

frontend/src/modules/Health/CoachChat/parseSSE.js
frontend/src/modules/Health/CoachChat/parseSSE.test.js
frontend/src/modules/Health/CoachChat/MarkdownText.jsx
frontend/src/modules/Health/CoachChat/MarkdownText.test.jsx
frontend/src/modules/Health/CoachChat/ToolCallAttribution.jsx
frontend/src/modules/Health/CoachChat/ToolCallAttribution.test.jsx

frontend/src/modules/Health/HealthHub/cards/WeightHeroCard.jsx
frontend/src/modules/Health/HealthHub/cards/WorkoutsHeroCard.jsx
frontend/src/modules/Health/HealthHub/cards/CaloriesHeroCard.jsx
frontend/src/modules/Health/HealthHub/cards/HeroCards.test.jsx

frontend/src/Apps/HealthApp.theme.js                        — Mantine theme override (dark)
```

**Modified files:**

```
backend/src/4_api/v1/routers/health-mentions.mjs            — extract internal helpers, fan out /all to all 3 cats with round-robin
backend/src/3_applications/agents/AgentOrchestrator.mjs     — add streamExecute() method
backend/src/3_applications/agents/framework/BaseAgent.mjs   — add runStream() method
backend/src/app.mjs                                         — wire agents-stream.mjs router
tests/isolated/api/routers/health-mentions.test.mjs         — extend /all tests for new fanout

frontend/package.json                                       — add react-markdown, remark-gfm
frontend/src/modules/Health/CoachChat/runtime.js            — async-generator streaming consumer
frontend/src/modules/Health/CoachChat/index.jsx             — variant prop, MarkdownText override on AssistantMessage, ToolCallAttribution
frontend/src/modules/Health/CoachChat/CoachChat.scss        — dark-theme bubbles for variant="overlay"
frontend/src/modules/Health/HealthHub/index.jsx             — refactor to hero + secondary layout
frontend/src/modules/Health/HealthHub/HealthHub.scss        — dark-theme styling
frontend/src/Apps/HealthApp.jsx                             — restructure: no tabs, AskBar + ChatOverlay always mounted
frontend/src/Apps/HealthApp.scss                            — page chrome, dark backdrop
```

---

## Conventions

- Vitest. Run individual files with `npx vitest run <path>`.
- TDD: test → run-FAIL → impl → run-PASS → commit per task.
- All commits end with: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- Path aliases: `#system/`, `#domains/`, `#adapters/`, `#apps/`, `#api/` (backend); `@/...` and `#frontend/...` (frontend).
- Frontend tests use `MantineProvider` wrapper for any component that uses Mantine primitives.
- Dark theme is the default for HealthApp; tests set `defaultColorScheme="dark"` on the wrapper.

---

## Task 1: `/mentions/all` fanout — extract helpers + round-robin merge

**Files:**
- Modify: `backend/src/4_api/v1/routers/health-mentions.mjs`
- Modify: `tests/isolated/api/routers/health-mentions.test.mjs`

- [ ] **Step 1: Append failing tests**

```javascript
describe('GET /api/v1/health/mentions/all (refactored fanout)', () => {
  function makeRichApp() {
    return makeApp({
      healthAnalyticsService: {
        listPeriods: vi.fn(async () => ({
          periods: [
            { slug: '2017-cut', label: '2017 Cut', from: '2017-01-15', to: '2017-04-30', source: 'declared' },
          ],
        })),
      },
      healthStore: {
        loadWeightData: async () => ({ '2026-05-04': { lbs: 197 }, '2026-05-05': { lbs: 196.5 } }),
        loadNutritionData: async () => ({ '2026-05-03': { calories: 2000 }, '2026-05-05': { calories: 2100 } }),
      },
      healthService: {
        getHealthForRange: async () => ({
          '2026-05-04': { workouts: [{ type: 'run', duration: 30 }] },
        }),
      },
      now: () => new Date('2026-05-05T12:00:00Z'),
    });
  }

  it('returns suggestions across periods, days, and metrics groups', async () => {
    const { app } = makeRichApp();
    const res = await request(app).get('/api/v1/health/mentions/all?user=kc');
    expect(res.status).toBe(200);
    const groups = new Set(res.body.suggestions.map(s => s.group));
    expect(groups.has('period')).toBe(true);
    expect(groups.has('day')).toBe(true);
    expect(groups.has('metric')).toBe(true);
  });

  it('respects per-category limits (8 periods + 14 days + 6 metrics)', async () => {
    const { app } = makeRichApp();
    const res = await request(app).get('/api/v1/health/mentions/all?user=kc');
    const byGroup = res.body.suggestions.reduce((acc, s) => {
      acc[s.group] = (acc[s.group] || 0) + 1;
      return acc;
    }, {});
    expect(byGroup.period).toBeLessThanOrEqual(8);
    expect(byGroup.day).toBeLessThanOrEqual(14);
    expect(byGroup.metric).toBeLessThanOrEqual(6);
  });

  it('round-robin interleaves so first 3 results span all groups', async () => {
    const { app } = makeRichApp();
    const res = await request(app).get('/api/v1/health/mentions/all?user=kc');
    const firstThreeGroups = res.body.suggestions.slice(0, 3).map(s => s.group);
    expect(new Set(firstThreeGroups).size).toBe(3);
  });

  it('filters by prefix across all groups', async () => {
    const { app } = makeRichApp();
    const res = await request(app).get('/api/v1/health/mentions/all?user=kc&prefix=weight');
    expect(res.status).toBe(200);
    const slugs = res.body.suggestions.map(s => s.slug);
    expect(slugs).toContain('weight_lbs');
  });

  it('returns 400 when user query param missing', async () => {
    const { app } = makeRichApp();
    const res = await request(app).get('/api/v1/health/mentions/all');
    expect(res.status).toBe(400);
  });

  it('existing /periods route still works (regression)', async () => {
    const { app } = makeRichApp();
    const res = await request(app).get('/api/v1/health/mentions/periods?user=kc');
    expect(res.status).toBe(200);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    expect(res.body.suggestions.every(s => s.group === 'period')).toBe(true);
  });

  it('existing /recent-days route still works (regression)', async () => {
    const { app } = makeRichApp();
    const res = await request(app).get('/api/v1/health/mentions/recent-days?user=kc&days=7');
    expect(res.status).toBe(200);
    expect(res.body.suggestions.every(s => s.group === 'day')).toBe(true);
  });
});
```

- [ ] **Step 2: Run; FAIL — current `/all` returns only periods + metrics; round-robin assertion + per-category cap fails**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/api/routers/health-mentions.test.mjs
```

- [ ] **Step 3: Refactor health-mentions.mjs to extract internal helpers + new /all**

Replace the existing `/all` handler and extract three internal helpers. Keep the existing `/periods`, `/recent-days`, `/metrics` route handlers thin — they delegate to the helpers.

```javascript
// backend/src/4_api/v1/routers/health-mentions.mjs (sketch — preserve existing code structure)

import { Router } from 'express';

const ROLLING_LABELS = [
  'last_7d','last_30d','last_90d','last_180d','last_365d','last_2y','last_5y','last_10y','all_time',
  'prev_7d','prev_30d','prev_90d','prev_180d','prev_365d',
];
const CALENDAR_LABELS = [
  'this_week','this_month','this_quarter','this_year','last_quarter','last_year',
];
const METRIC_LIST = [
  'weight_lbs','fat_percent',
  'calories','protein_g','carbs_g','fat_g','fiber_g',
  'workout_count','workout_duration_min','workout_calories',
  'tracking_density',
];

export function createHealthMentionsRouter({
  healthAnalyticsService,
  healthStore = null,
  healthService = null,
  now = () => new Date(),
}) {
  const router = Router();

  // ── Internal helpers (used by both per-route handlers and /all fanout) ──

  async function fetchPeriodsInternal({ userId, prefix, limit = 50 }) {
    const out = [];
    for (const label of ROLLING_LABELS) {
      out.push({ slug: label, label: humanizeRollingLabel(label), value: { rolling: label }, group: 'period' });
    }
    for (const label of CALENDAR_LABELS) {
      out.push({ slug: label, label: humanizeCalendarLabel(label), value: { calendar: label }, group: 'period' });
    }
    if (healthAnalyticsService?.listPeriods) {
      try {
        const r = await healthAnalyticsService.listPeriods({ userId });
        for (const p of (r.periods || [])) {
          out.push({
            slug: p.slug, label: p.label || p.slug, value: { named: p.slug },
            group: 'period', subSource: p.source,
          });
        }
      } catch { /* graceful */ }
    }
    const filtered = prefix
      ? out.filter(s => s.slug.toLowerCase().includes(prefix) || (s.label || '').toLowerCase().includes(prefix))
      : out;
    return filtered.slice(0, limit);
  }

  async function fetchRecentDaysInternal({ userId, prefix, has = null, days = 30, limit = 50 }) {
    const today = now();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const fromDate = new Date(todayUtc);
    fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = todayUtc.toISOString().slice(0, 10);

    const [weight, nutrition, range] = await Promise.all([
      healthStore?.loadWeightData?.(userId).catch(() => ({})) ?? Promise.resolve({}),
      healthStore?.loadNutritionData?.(userId).catch(() => ({})) ?? Promise.resolve({}),
      healthService?.getHealthForRange?.(userId, fromStr, toStr).catch(() => ({})) ?? Promise.resolve({}),
    ]);

    const results = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(todayUtc);
      d.setUTCDate(todayUtc.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      const hasWeight = !!weight?.[date];
      const hasNutrition = !!nutrition?.[date] && (nutrition[date].calories ?? 0) > 0;
      const hasWorkout = Array.isArray(range?.[date]?.workouts) && range[date].workouts.length > 0;

      const entry = {
        slug: date, label: date, value: { date }, group: 'day',
        has: { weight: hasWeight, nutrition: hasNutrition, workout: hasWorkout },
      };
      if (has === 'weight'    && !hasWeight)    continue;
      if (has === 'nutrition' && !hasNutrition) continue;
      if (has === 'workout'   && !hasWorkout)   continue;
      results.push(entry);
    }

    const filtered = prefix
      ? results.filter(s => s.slug.toLowerCase().includes(prefix))
      : results;
    return filtered.slice(0, limit);
  }

  function fetchMetricsInternal({ prefix, limit = 50 }) {
    const out = METRIC_LIST.map(name => ({
      slug: name, label: name, value: { metric: name }, group: 'metric',
    }));
    const filtered = prefix
      ? out.filter(s => s.slug.toLowerCase().includes(prefix))
      : out;
    return filtered.slice(0, limit);
  }

  // ── Routes ─────────────────────────────────────────────────────────────

  router.get('/periods', async (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).json({ error: 'user query param required' });
    const prefix = (req.query.prefix || '').toString().toLowerCase();
    res.json({ suggestions: await fetchPeriodsInternal({ userId, prefix }) });
  });

  router.get('/recent-days', async (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).json({ error: 'user query param required' });
    const prefix = (req.query.prefix || '').toString().toLowerCase();
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const has = req.query.has || null;
    res.json({ suggestions: await fetchRecentDaysInternal({ userId, prefix, has, days }) });
  });

  router.get('/metrics', (req, res) => {
    const prefix = (req.query.prefix || '').toString().toLowerCase();
    res.json({ suggestions: fetchMetricsInternal({ prefix }) });
  });

  router.get('/all', async (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).json({ error: 'user query param required' });
    const prefix = (req.query.prefix || '').toString().toLowerCase();

    const [periods, days, metrics] = await Promise.all([
      fetchPeriodsInternal({ userId, prefix, limit: 8 }),
      fetchRecentDaysInternal({ userId, prefix, days: 14, limit: 14 }),
      Promise.resolve(fetchMetricsInternal({ prefix, limit: 6 })),
    ]);

    res.json({ suggestions: roundRobin([periods, days, metrics]) });
  });

  return router;
}

// Helpers

function humanizeRollingLabel(label) {
  if (label === 'all_time') return 'All time';
  const m = /^(last|prev)_(\d+)([dy])$/.exec(label);
  if (!m) return label;
  const [, kind, n, u] = m;
  const unit = u === 'y' ? 'year' : 'day';
  const plural = parseInt(n, 10) === 1 ? '' : 's';
  return `${kind === 'last' ? 'Last' : 'Previous'} ${n} ${unit}${plural}`;
}

function humanizeCalendarLabel(label) {
  return label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function roundRobin(buckets) {
  const out = [];
  let i = 0;
  let any = true;
  while (any) {
    any = false;
    for (const b of buckets) {
      if (i < b.length) { out.push(b[i]); any = true; }
    }
    i++;
  }
  return out;
}

export default createHealthMentionsRouter;
```

- [ ] **Step 4: Run tests; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/api/routers/health-mentions.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/health-mentions.mjs \
        tests/isolated/api/routers/health-mentions.test.mjs
git commit -m "$(cat <<'EOF'
feat(health-mentions): /all fans out to periods+days+metrics with round-robin

Plan / Task 1. Extract internal helpers (fetchPeriodsInternal,
fetchRecentDaysInternal, fetchMetricsInternal) used by both per-route
handlers and the /all fanout. Per-category caps: 8/14/6. Round-robin
interleave so the dropdown shows variety at the top instead of
slicing periods only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: BaseAgent.runStream + AgentOrchestrator.streamExecute

**Files:**
- Modify: `backend/src/3_applications/agents/framework/BaseAgent.mjs`
- Modify: `backend/src/3_applications/agents/AgentOrchestrator.mjs`
- Create: `tests/isolated/agents/framework/BaseAgent.runStream.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// tests/isolated/agents/framework/BaseAgent.runStream.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

class FakeAgent extends BaseAgent {
  static id = 'fake';
  getSystemPrompt() { return 'SYS'; }
}

describe('BaseAgent.runStream', () => {
  it('yields chunks from agentRuntime.streamExecute', async () => {
    async function* fakeStream() {
      yield { type: 'text-delta', text: 'Hi ' };
      yield { type: 'text-delta', text: 'there' };
      yield { type: 'finish', reason: 'stop', usage: { totalTokens: 10 } };
    }
    const agentRuntime = { streamExecute: vi.fn(() => fakeStream()) };
    const agent = new FakeAgent({
      agentRuntime,
      workingMemory: { load: async () => null, save: async () => {} },
    });

    const collected = [];
    for await (const chunk of agent.runStream('hi', { context: { userId: 'kc' } })) {
      collected.push(chunk);
    }
    expect(collected).toHaveLength(3);
    expect(collected[0].type).toBe('text-delta');
    expect(collected[2].type).toBe('finish');
    expect(agentRuntime.streamExecute).toHaveBeenCalled();
  });

  it('passes mode default chat in context', async () => {
    let capturedContext;
    async function* fakeStream() { yield { type: 'finish' }; }
    const agentRuntime = { streamExecute: vi.fn((args) => {
      capturedContext = args.context;
      return fakeStream();
    }) };
    const agent = new FakeAgent({
      agentRuntime,
      workingMemory: { load: async () => null, save: async () => {} },
    });
    for await (const _ of agent.runStream('hi', { context: { userId: 'kc' } })) { /* drain */ }
    expect(capturedContext.mode).toBe('chat');
  });
});
```

- [ ] **Step 2: Run; FAIL — runStream not defined**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/framework/BaseAgent.runStream.test.mjs
```

- [ ] **Step 3: Add `runStream` to BaseAgent**

In `backend/src/3_applications/agents/framework/BaseAgent.mjs`, alongside `run()`:

```javascript
  /**
   * Streaming variant of run. Yields chunks from the agent runtime as the
   * model produces them. Same userId resolution + assemble-prompt flow as
   * run(); the runtime's own streamExecute handles transcript flush at end.
   *
   * @yields { type: 'text-delta'|'tool-start'|'tool-end'|'finish', ... }
   */
  async *runStream(input, { userId, context = {} } = {}) {
    const effectiveUserId = userId ?? context?.userId ?? null;
    const augmentedContext = { mode: 'chat', ...context, userId: effectiveUserId };

    const memory = effectiveUserId
      ? await this.#workingMemory.load(this.constructor.id, effectiveUserId)
      : null;

    const stream = this.#agentRuntime.streamExecute({
      agent: this,
      agentId: this.constructor.id,
      input,
      tools: this.getTools(),
      systemPrompt: await this.#assemblePrompt(memory, augmentedContext),
      context: { ...augmentedContext, memory },
    });

    for await (const chunk of stream) {
      yield chunk;
    }

    if (memory) {
      await this.#workingMemory.save(this.constructor.id, effectiveUserId, memory);
    }
  }
```

NOTE: `#assemblePrompt` is private to BaseAgent (the class, not the instance — JS private fields). The above accesses it via `this.#assemblePrompt(...)` which works from within the class body.

- [ ] **Step 4: Add `streamExecute` to AgentOrchestrator**

In `backend/src/3_applications/agents/AgentOrchestrator.mjs`, alongside `run()`:

```javascript
  /**
   * Streaming variant of run. Yields chunks from the agent's runStream.
   * Resolves userId + generates turnId same as run().
   */
  async *streamExecute(agentId, input, context = {}) {
    const agent = this.#getAgent(agentId);
    const turnId = context.turnId ?? crypto.randomUUID();
    const userId = this.#resolveUserId(context.userId);
    const augmented = { ...context, turnId, userId };

    this.#logger.info?.('orchestrator.streamExecute', {
      agentId, turnId, userId, contextKeys: Object.keys(context),
    });

    yield* agent.runStream(input, { context: augmented });
  }
```

- [ ] **Step 5: Run tests; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/
```

Expected: existing agents tests still pass; new BaseAgent.runStream tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/framework/BaseAgent.mjs \
        backend/src/3_applications/agents/AgentOrchestrator.mjs \
        tests/isolated/agents/framework/BaseAgent.runStream.test.mjs
git commit -m "$(cat <<'EOF'
feat(agents): BaseAgent.runStream + AgentOrchestrator.streamExecute

Plan / Task 2. runStream is the async-generator sibling to run(); same
userId resolution + assemble-prompt flow, delegates to agentRuntime.
streamExecute (already present in MastraAdapter). Orchestrator surfaces
streamExecute(agentId, input, context) for the new streaming HTTP route.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: SSE streaming agent endpoint

**Files:**
- Create: `backend/src/4_api/v1/routers/agents-stream.mjs`
- Modify: `backend/src/app.mjs` (wire the new router)
- Create: `tests/isolated/api/routers/agents.runStream.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// tests/isolated/api/routers/agents.runStream.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import { createAgentsStreamRouter } from '../../../../backend/src/4_api/v1/routers/agents-stream.mjs';
import http from 'node:http';

function startServer(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

async function readSSE(port, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'POST',
      hostname: 'localhost',
      port,
      path,
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let buffer = '';
      const events = [];
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = block.split('\n').find(l => l.startsWith('data: '));
          if (dataLine) events.push(JSON.parse(dataLine.slice(6)));
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, events }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

describe('POST /api/v1/agents/:id/run-stream', () => {
  it('streams SSE events in order, ending with done', async () => {
    async function* fakeStream() {
      yield { type: 'text-delta', text: 'Hi ' };
      yield { type: 'tool-start', toolName: 'metric_trajectory', args: { metric: 'weight_lbs' } };
      yield { type: 'tool-end', toolName: 'metric_trajectory', result: { slope: -0.04 } };
      yield { type: 'text-delta', text: 'there' };
      yield { type: 'finish', reason: 'stop' };
    }
    const orchestrator = { streamExecute: vi.fn(() => fakeStream()) };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/agents', createAgentsStreamRouter({ orchestrator, logger: { info: () => {}, error: () => {} } }));

    const { server, port } = await startServer(app);
    try {
      const { status, headers, events } = await readSSE(port, '/api/v1/agents/health-coach/run-stream', { input: 'hi', context: { userId: 'kc' } });
      expect(status).toBe(200);
      expect(headers['content-type']).toMatch(/text\/event-stream/);
      expect(events.length).toBeGreaterThanOrEqual(6);
      expect(events.map(e => e.type)).toEqual(['text-delta', 'tool-start', 'tool-end', 'text-delta', 'finish', 'done']);
    } finally {
      server.close();
    }
  });

  it('returns 400 when input missing', async () => {
    const orchestrator = { streamExecute: vi.fn() };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/agents', createAgentsStreamRouter({ orchestrator, logger: { info: () => {}, error: () => {} } }));

    const { server, port } = await startServer(app);
    try {
      const { status } = await readSSE(port, '/api/v1/agents/health-coach/run-stream', {});
      expect(status).toBe(400);
    } finally {
      server.close();
    }
  });

  it('emits an error event when streamExecute throws', async () => {
    async function* fakeStream() {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('boom');
    }
    const orchestrator = { streamExecute: vi.fn(() => fakeStream()) };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/agents', createAgentsStreamRouter({ orchestrator, logger: { info: () => {}, error: () => {} } }));

    const { server, port } = await startServer(app);
    try {
      const { events } = await readSSE(port, '/api/v1/agents/health-coach/run-stream', { input: 'hi' });
      expect(events.find(e => e.type === 'error')).toBeDefined();
    } finally {
      server.close();
    }
  });
});
```

- [ ] **Step 2: Run; FAIL — module not found**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/api/routers/agents.runStream.test.mjs
```

- [ ] **Step 3: Implement the router**

```javascript
// backend/src/4_api/v1/routers/agents-stream.mjs
import { Router } from 'express';

/**
 * Streaming variant of /api/v1/agents/:agentId/run.
 *
 * Reads the orchestrator's streamExecute() async generator and emits
 * each chunk as an SSE event. Ends with a 'done' event on success or
 * 'error' on failure.
 */
export function createAgentsStreamRouter({ orchestrator, logger }) {
  const router = Router();

  router.post('/:agentId/run-stream', async (req, res) => {
    const { agentId } = req.params;
    const { input, context = {} } = req.body || {};

    if (!input) {
      return res.status(400).json({ error: 'input is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      logger.info?.('agents.runStream.start', { agentId });
      for await (const chunk of orchestrator.streamExecute(agentId, input, context)) {
        send(chunk);
      }
      send({ type: 'done' });
      res.end();
      logger.info?.('agents.runStream.complete', { agentId });
    } catch (err) {
      logger.error?.('agents.runStream.error', { agentId, error: err.message });
      send({ type: 'error', message: err.message });
      res.end();
    }
  });

  return router;
}

export default createAgentsStreamRouter;
```

- [ ] **Step 4: Wire into app.mjs**

In `backend/src/app.mjs`, find where `v1Routers.agents` is created (around line 1954). Add immediately after:

```javascript
import { createAgentsStreamRouter } from './4_api/v1/routers/agents-stream.mjs';
// ...
v1Routers.agentsStream = createAgentsStreamRouter({
  orchestrator: v1Routers.agents.orchestrator,
  logger: rootLogger.child({ module: 'agents-stream' }),
});
app.use('/api/v1/agents', v1Routers.agentsStream);  // mounted on the same path; route param differs
```

NOTE: `v1Routers.agents.orchestrator` may not be the correct accessor — check how the orchestrator is wired in `createAgentsApiRouter` and adjust. If needed, expose it via the return value of `createAgentsApiRouter`.

- [ ] **Step 5: Run tests; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/api/routers/agents.runStream.test.mjs tests/isolated/api/routers/health-mentions.test.mjs
```

- [ ] **Step 6: `node -c` parse check**

```bash
cd /opt/Code/DaylightStation && node -c backend/src/app.mjs
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/4_api/v1/routers/agents-stream.mjs \
        backend/src/app.mjs \
        tests/isolated/api/routers/agents.runStream.test.mjs
git commit -m "$(cat <<'EOF'
feat(agents): POST /api/v1/agents/:id/run-stream — SSE streaming

Plan / Task 3. Reads orchestrator.streamExecute() async-generator
chunks and emits each as an SSE event. Ends with 'done' on success or
'error' on failure. Mirrors the concierge /v1/chat/completions SSE
pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Install react-markdown + remark-gfm

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`

- [ ] **Step 1: Install**

```bash
cd /opt/Code/DaylightStation/frontend && npm install --save react-markdown remark-gfm
```

- [ ] **Step 2: Verify pinned**

```bash
cd /opt/Code/DaylightStation/frontend && grep -E "react-markdown|remark-gfm" package.json
```

Expected: two `^` version lines under `dependencies`.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/package.json frontend/package-lock.json
git commit -m "chore(deps): add react-markdown + remark-gfm

Plan / Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: parseSSE.js helper

**Files:**
- Create: `frontend/src/modules/Health/CoachChat/parseSSE.js`
- Create: `frontend/src/modules/Health/CoachChat/parseSSE.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/src/modules/Health/CoachChat/parseSSE.test.js
import { describe, it, expect } from 'vitest';
import { parseSSE } from './parseSSE.js';

function readableStreamFrom(strings) {
  return new ReadableStream({
    async start(controller) {
      for (const s of strings) controller.enqueue(new TextEncoder().encode(s));
      controller.close();
    },
  });
}

describe('parseSSE', () => {
  it('parses a single complete event', async () => {
    const stream = readableStreamFrom(['data: {"type":"text-delta","text":"hi"}\n\n']);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([{ type: 'text-delta', text: 'hi' }]);
  });

  it('parses multiple events split across chunks', async () => {
    const stream = readableStreamFrom([
      'data: {"type":"text-delta","text":"a"}\n\ndata: {"type"',
      ':"text-delta","text":"b"}\n\n',
    ]);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([
      { type: 'text-delta', text: 'a' },
      { type: 'text-delta', text: 'b' },
    ]);
  });

  it('skips empty/comment lines', async () => {
    const stream = readableStreamFrom([': comment\n\ndata: {"type":"finish"}\n\n']);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([{ type: 'finish' }]);
  });

  it('handles partial trailing chunk gracefully', async () => {
    const stream = readableStreamFrom(['data: {"type":"finish"}\n\ndata: {"partial"']);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([{ type: 'finish' }]);  // partial discarded
  });

  it('handles malformed JSON by skipping that event (logs to console)', async () => {
    const stream = readableStreamFrom(['data: not-json\n\ndata: {"type":"ok"}\n\n']);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([{ type: 'ok' }]);
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/CoachChat/parseSSE.test.js
```

- [ ] **Step 3: Implement parseSSE**

```javascript
// frontend/src/modules/Health/CoachChat/parseSSE.js

/**
 * Async-generator over a `ReadableStream<Uint8Array>` that yields parsed
 * JSON payloads from `data:` SSE lines. Comments/empty lines are skipped.
 * Malformed JSON events are logged to console.warn and skipped.
 *
 * @param {ReadableStream<Uint8Array>} stream
 * @yields {object} parsed event payload
 */
export async function* parseSSE(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of block.split('\n')) {
          if (!line || line.startsWith(':')) continue;
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          try {
            yield JSON.parse(payload);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[parseSSE] malformed JSON, skipping:', payload);
          }
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

export default parseSSE;
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/CoachChat/parseSSE.test.js
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/CoachChat/parseSSE.js \
        frontend/src/modules/Health/CoachChat/parseSSE.test.js
git commit -m "feat(coach-chat): parseSSE async-generator helper

Plan / Task 5. Reads ReadableStream<Uint8Array>, yields parsed JSON
from data: lines. Handles partial chunks, comments, malformed JSON.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: MarkdownText component

**Files:**
- Create: `frontend/src/modules/Health/CoachChat/MarkdownText.jsx`
- Create: `frontend/src/modules/Health/CoachChat/MarkdownText.test.jsx`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/src/modules/Health/CoachChat/MarkdownText.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownText } from './MarkdownText.jsx';

describe('MarkdownText', () => {
  it('renders **bold** as <strong>', () => {
    render(<MarkdownText text="**hi**" />);
    const el = screen.getByText('hi');
    expect(el.tagName).toBe('STRONG');
  });

  it('renders bullet lists', () => {
    render(<MarkdownText text={'- one\n- two'} />);
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.getByText('one').closest('ul')).not.toBeNull();
  });

  it('renders GFM tables', () => {
    const md = `
| col1 | col2 |
|---|---|
| a | b |
`.trim();
    render(<MarkdownText text={md} />);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('a').closest('table')).not.toBeNull();
  });

  it('renders inline code', () => {
    render(<MarkdownText text={'use `metric_trajectory` here'} />);
    const el = screen.getByText('metric_trajectory');
    expect(el.tagName).toBe('CODE');
  });

  it('handles empty string without crashing', () => {
    const { container } = render(<MarkdownText text="" />);
    expect(container).toBeTruthy();
  });

  it('handles partial markdown during streaming (incomplete bold)', () => {
    // Streaming case: model has emitted "**hi" but not closing **
    render(<MarkdownText text="**hi" />);
    // Renders as literal text — no crash
    expect(screen.getByText(/\*\*hi/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/CoachChat/MarkdownText.test.jsx
```

- [ ] **Step 3: Implement MarkdownText**

```javascript
// frontend/src/modules/Health/CoachChat/MarkdownText.jsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Render markdown for assistant chat messages. GFM-flavored (tables,
 * strikethrough, autolinks). HTML is sandboxed by react-markdown.
 *
 * Streaming-safe: re-parses on every text prop change. Partial markdown
 * (e.g. "**hi" mid-stream) renders as literal text until the closing
 * delimiter arrives.
 *
 * @param {{ text: string }} props
 */
export function MarkdownText({ text }) {
  return (
    <div className="coach-chat__markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="coach-chat__md-p">{children}</p>,
          ul: ({ children }) => <ul className="coach-chat__md-ul">{children}</ul>,
          ol: ({ children }) => <ol className="coach-chat__md-ol">{children}</ol>,
          li: ({ children }) => <li className="coach-chat__md-li">{children}</li>,
          code: ({ inline, children, ...rest }) =>
            inline
              ? <code className="coach-chat__md-code-inline" {...rest}>{children}</code>
              : <pre className="coach-chat__md-code-block"><code {...rest}>{children}</code></pre>,
          table: ({ children }) => <table className="coach-chat__md-table">{children}</table>,
          strong: ({ children }) => <strong className="coach-chat__md-strong">{children}</strong>,
          em: ({ children }) => <em className="coach-chat__md-em">{children}</em>,
        }}
      >
        {text || ''}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownText;
```

- [ ] **Step 4: Run tests; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/CoachChat/MarkdownText.test.jsx
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/CoachChat/MarkdownText.jsx \
        frontend/src/modules/Health/CoachChat/MarkdownText.test.jsx
git commit -m "feat(coach-chat): MarkdownText component

Plan / Task 6. ReactMarkdown + remark-gfm with class-tagged elements
for SCSS styling. Streaming-safe — handles partial markdown mid-stream.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: AiMark component

**Files:**
- Create: `frontend/src/modules/Health/AiMark/index.jsx`
- Create: `frontend/src/modules/Health/AiMark/AiMark.scss`
- Create: `frontend/src/modules/Health/AiMark/AiMark.test.jsx`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/src/modules/Health/AiMark/AiMark.test.jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AiMark } from './index.jsx';

describe('AiMark', () => {
  it('renders at default size 24', () => {
    const { container } = render(<AiMark />);
    const el = container.querySelector('.ai-mark');
    expect(el).toBeTruthy();
    expect(el.style.width).toBe('24px');
    expect(el.style.height).toBe('24px');
  });

  it('renders at custom size', () => {
    const { container } = render(<AiMark size={16} />);
    const el = container.querySelector('.ai-mark');
    expect(el.style.width).toBe('16px');
    expect(el.style.height).toBe('16px');
  });

  it('contains the ✦ glyph', () => {
    const { container } = render(<AiMark />);
    expect(container.textContent).toContain('✦');
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/AiMark/AiMark.test.jsx
```

- [ ] **Step 3: Implement AiMark**

```javascript
// frontend/src/modules/Health/AiMark/index.jsx
import './AiMark.scss';

/**
 * Gradient circle with the ✦ glyph — the consistent AI mark used across
 * AskBar, ChatOverlay header, and tool-call attribution rows.
 */
export function AiMark({ size = 24 }) {
  const fontSize = Math.round(size * 0.5);
  return (
    <span
      className="ai-mark"
      style={{ width: `${size}px`, height: `${size}px`, fontSize: `${fontSize}px` }}
      aria-hidden="true"
    >
      ✦
    </span>
  );
}

export default AiMark;
```

```scss
// frontend/src/modules/Health/AiMark/AiMark.scss
.ai-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #2563eb, #10b981);
  border-radius: 50%;
  color: #fff;
  flex-shrink: 0;
  line-height: 1;
}
```

- [ ] **Step 4: Run; pass; Commit**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/AiMark/AiMark.test.jsx
git add frontend/src/modules/Health/AiMark/
git commit -m "feat(health-app): AiMark gradient ✦ component

Plan / Task 7. Configurable size; gradient blue→emerald background.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Hero metric cards (Weight/Workouts/Calories)

**Files:**
- Create: `frontend/src/modules/Health/HealthHub/cards/WeightHeroCard.jsx`
- Create: `frontend/src/modules/Health/HealthHub/cards/WorkoutsHeroCard.jsx`
- Create: `frontend/src/modules/Health/HealthHub/cards/CaloriesHeroCard.jsx`
- Create: `frontend/src/modules/Health/HealthHub/cards/HeroCards.test.jsx`

- [ ] **Step 1: Write failing tests**

```javascript
// frontend/src/modules/Health/HealthHub/cards/HeroCards.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { WeightHeroCard } from './WeightHeroCard.jsx';
import { WorkoutsHeroCard } from './WorkoutsHeroCard.jsx';
import { CaloriesHeroCard } from './CaloriesHeroCard.jsx';

function r(ui) { return render(<MantineProvider defaultColorScheme="dark">{ui}</MantineProvider>); }

describe('WeightHeroCard', () => {
  it('renders current value, unit, and trend', () => {
    r(<WeightHeroCard data={{
      current: { lbs: 170.7, date: '2026-05-06' },
      trend: { direction: 'down', slopePerWeek: -0.04 },
      history: [170.5, 170.6, 170.7, 170.6, 170.7],
    }} onClick={vi.fn()} />);
    expect(screen.getByText('WEIGHT')).toBeInTheDocument();
    expect(screen.getByText('170.7')).toBeInTheDocument();
    expect(screen.getByText(/lbs/)).toBeInTheDocument();
    expect(screen.getByText(/0.04/)).toBeInTheDocument();
  });

  it('invokes onClick when clicked', () => {
    const onClick = vi.fn();
    r(<WeightHeroCard data={{ current: { lbs: 170.7 }, trend: { direction: 'down', slopePerWeek: -0.04 }, history: [] }} onClick={onClick} />);
    fireEvent.click(screen.getByText('WEIGHT').closest('button'));
    expect(onClick).toHaveBeenCalled();
  });

  it('handles missing trend gracefully', () => {
    r(<WeightHeroCard data={{ current: { lbs: 170.7 } }} onClick={vi.fn()} />);
    expect(screen.getByText('170.7')).toBeInTheDocument();
  });
});

describe('WorkoutsHeroCard', () => {
  it('renders weekly count + breakdown', () => {
    r(<WorkoutsHeroCard data={{
      weekCount: 10,
      breakdown: [{ type: 'run', count: 3 }, { type: 'lift', count: 3 }],
    }} onClick={vi.fn()} />);
    expect(screen.getByText('WORKOUTS')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });
});

describe('CaloriesHeroCard', () => {
  it('renders avg calories + protein', () => {
    r(<CaloriesHeroCard data={{ avg: { calories: 1470, protein: 103 } }} onClick={vi.fn()} />);
    expect(screen.getByText('CALORIES')).toBeInTheDocument();
    expect(screen.getByText(/1,470/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/HealthHub/cards/HeroCards.test.jsx
```

- [ ] **Step 3: Implement the three hero cards**

```javascript
// frontend/src/modules/Health/HealthHub/cards/WeightHeroCard.jsx
import { Sparkline } from '@mantine/charts';

const TREND_COLOR = { down: '#10b981', up: '#ef4444', flat: '#94a3b8' };
const TREND_ARROW = { down: '▼', up: '▲', flat: '–' };

export function WeightHeroCard({ data, onClick }) {
  const lbs = data?.current?.lbs;
  const trend = data?.trend;
  const history = data?.history || [];

  return (
    <button className="metric-card metric-card--hero" onClick={onClick} type="button">
      <div className="metric-card__label">WEIGHT</div>
      <div className="metric-card__value">
        {typeof lbs === 'number' ? lbs.toFixed(1) : '—'} <span className="metric-card__unit">lbs</span>
      </div>
      {trend && typeof trend.slopePerWeek === 'number' && (
        <div className="metric-card__trend" style={{ color: TREND_COLOR[trend.direction] || TREND_COLOR.flat }}>
          {TREND_ARROW[trend.direction] || '–'} {Math.abs(trend.slopePerWeek).toFixed(2)} lbs/wk
          <span className="metric-card__trend-period"> · last 30d</span>
        </div>
      )}
      {history.length >= 2 && (
        <div className="metric-card__sparkline">
          <Sparkline
            data={history.map(h => typeof h === 'number' ? h : (h?.lbs ?? null)).filter(Number.isFinite)}
            color="blue"
            curveType="natural"
            fillOpacity={0.2}
            strokeWidth={1.5}
            h={28}
          />
        </div>
      )}
    </button>
  );
}

export default WeightHeroCard;
```

```javascript
// frontend/src/modules/Health/HealthHub/cards/WorkoutsHeroCard.jsx
export function WorkoutsHeroCard({ data, onClick }) {
  const count = data?.weekCount ?? 0;
  const breakdown = data?.breakdown || [];
  const breakdownText = breakdown.map(b => `${b.count} ${b.type}${b.count !== 1 ? 's' : ''}`).join(' · ');

  return (
    <button className="metric-card metric-card--hero" onClick={onClick} type="button">
      <div className="metric-card__label">WORKOUTS</div>
      <div className="metric-card__value">{count}</div>
      <div className="metric-card__trend">
        this week{breakdownText ? ` · ${breakdownText}` : ''}
      </div>
    </button>
  );
}

export default WorkoutsHeroCard;
```

```javascript
// frontend/src/modules/Health/HealthHub/cards/CaloriesHeroCard.jsx
export function CaloriesHeroCard({ data, onClick }) {
  const cal = data?.avg?.calories;
  const protein = data?.avg?.protein;

  return (
    <button className="metric-card metric-card--hero" onClick={onClick} type="button">
      <div className="metric-card__label">CALORIES</div>
      <div className="metric-card__value">
        {typeof cal === 'number' ? cal.toLocaleString() : '—'}
      </div>
      <div className="metric-card__trend">
        avg · 30d{typeof protein === 'number' ? ` · ${protein}g protein` : ''}
      </div>
    </button>
  );
}

export default CaloriesHeroCard;
```

- [ ] **Step 4: Run; pass; commit**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/HealthHub/cards/HeroCards.test.jsx
git add frontend/src/modules/Health/HealthHub/cards/
git commit -m "feat(health-hub): three hero metric cards (Weight/Workouts/Calories)

Plan / Task 8. Weight gets a Mantine Sparkline; Workouts shows weekly
count + breakdown; Calories shows avg + protein. Each is a button —
click invokes the parent onClick(type) for detail-view navigation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: HealthApp theme override

**Files:**
- Create: `frontend/src/Apps/HealthApp.theme.js`
- Modify: `frontend/src/Apps/HealthApp.scss`

- [ ] **Step 1: Create the theme file**

```javascript
// frontend/src/Apps/HealthApp.theme.js
import { createTheme } from '@mantine/core';

/**
 * Mantine theme override for HealthApp's dark dashboard aesthetic.
 * Tokens used by the cards and chrome via `var(--mantine-color-*)`.
 */
export const healthTheme = createTheme({
  primaryColor: 'blue',
  colors: {
    background: ['#0f1419','#0f1419','#0f1419','#0f1419','#0f1419','#0f1419','#0f1419','#0f1419','#0f1419','#0f1419'],
    surface:    ['#1c2229','#1c2229','#1c2229','#1c2229','#1c2229','#1c2229','#1c2229','#1c2229','#1c2229','#1c2229'],
    surfaceAlt: ['#0a0e12','#0a0e12','#0a0e12','#0a0e12','#0a0e12','#0a0e12','#0a0e12','#0a0e12','#0a0e12','#0a0e12'],
    border:     ['#2d3743','#2d3743','#2d3743','#2d3743','#2d3743','#2d3743','#2d3743','#2d3743','#2d3743','#2d3743'],
    textHigh:   ['#e8eef3','#e8eef3','#e8eef3','#e8eef3','#e8eef3','#e8eef3','#e8eef3','#e8eef3','#e8eef3','#e8eef3'],
    textMid:    ['#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8'],
    textLow:    ['#6b7785','#6b7785','#6b7785','#6b7785','#6b7785','#6b7785','#6b7785','#6b7785','#6b7785','#6b7785'],
  },
});

export default healthTheme;
```

(Mantine's color arrays expect 10 shades; we replicate the same value across all 10 since these are single-value tokens. Future: derive a real shade range if we use Mantine's `theme.colors.surface[3]` etc.)

- [ ] **Step 2: Update HealthApp.scss with chrome styles**

Replace `frontend/src/Apps/HealthApp.scss` body with:

```scss
.health-app {
  background: var(--mantine-color-background-0);
  color: var(--mantine-color-textHigh-0);
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  padding-bottom: 80px; // space for the persistent AskBar
}

.health-app__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--mantine-color-surface-0);
}

.health-app__header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--mantine-color-textMid-0);
}

.health-app__status-dot {
  width: 8px;
  height: 8px;
  background: #10b981;
  border-radius: 50%;
  animation: health-status-pulse 2s ease-in-out infinite;
}

@keyframes health-status-pulse {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .health-app__status-dot { animation: none; }
}

.health-app__header-right {
  font-size: 11px;
  color: var(--mantine-color-textLow-0);
}

// Hero card shared styles
.metric-card {
  background: var(--mantine-color-surface-0);
  padding: 16px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  text-align: left;
  transition: border-color 150ms ease;
}

.metric-card:hover {
  border-color: var(--mantine-color-border-0);
}

.metric-card__label {
  font-size: 10px;
  color: var(--mantine-color-textMid-0);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.metric-card__value {
  font-size: 36px;
  font-weight: 700;
  line-height: 1.1;
  margin-top: 4px;
  font-feature-settings: 'tnum';
}

.metric-card__unit {
  font-size: 14px;
  color: var(--mantine-color-textMid-0);
  font-weight: 400;
}

.metric-card__trend {
  font-size: 12px;
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.metric-card__trend-period {
  color: var(--mantine-color-textLow-0);
}

.metric-card__sparkline {
  margin-top: 12px;
}

// Hub layout
.health-hub {
  padding: 20px;
  max-width: 980px;
  margin: 0 auto;
}

.health-hub__hero {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}

.health-hub__secondary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Apps/HealthApp.theme.js frontend/src/Apps/HealthApp.scss
git commit -m "feat(health-app): dark theme tokens + chrome SCSS

Plan / Task 9. Mantine theme override defines background/surface/
border/text tokens. Status dot pulse keyframe (respects prefers-reduced-
motion). Metric card shared styles + hub grid layout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: HealthHub refactor

**Files:**
- Modify: `frontend/src/modules/Health/HealthHub/index.jsx` (or whatever the existing entry is — verify path)
- Modify: `tests/...` for any existing HealthHub test

The existing HealthHub component takes `dashboard` + `onCardClick`. We rebuild it to use the hero + secondary pattern.

- [ ] **Step 1: Read existing HealthHub**

```bash
cd /opt/Code/DaylightStation && find frontend/src/modules/Health/HealthHub -name "*.jsx" -o -name "*.js" | head -5
```

Inspect what's there. There's likely an `index.jsx` exporting the default component.

- [ ] **Step 2: Replace HealthHub with hero + secondary structure**

```javascript
// frontend/src/modules/Health/HealthHub/index.jsx
import { Skeleton } from '@mantine/core';
import { WeightHeroCard } from './cards/WeightHeroCard.jsx';
import { WorkoutsHeroCard } from './cards/WorkoutsHeroCard.jsx';
import { CaloriesHeroCard } from './cards/CaloriesHeroCard.jsx';
import './HealthHub.scss';

export default function HealthHub({ dashboard, loading, onCardClick = () => {}, onRefresh }) {
  if (loading) return <HealthHubSkeleton />;

  return (
    <main className="health-hub">
      <section className="health-hub__hero">
        <WeightHeroCard data={dashboard?.weight} onClick={() => onCardClick('weight')} />
        <WorkoutsHeroCard data={dashboard?.workouts} onClick={() => onCardClick('workouts')} />
        <CaloriesHeroCard data={dashboard?.nutrition} onClick={() => onCardClick('nutrition')} />
      </section>

      {dashboard?.cards?.length > 0 && (
        <section className="health-hub__secondary">
          {dashboard.cards.map(card => (
            <DetailCardPlaceholder key={card.type} data={card} onClick={() => onCardClick(card.type)} />
          ))}
        </section>
      )}
    </main>
  );
}

function HealthHubSkeleton() {
  return (
    <main className="health-hub">
      <section className="health-hub__hero">
        <Skeleton height={140} radius="md" />
        <Skeleton height={140} radius="md" />
        <Skeleton height={140} radius="md" />
      </section>
      <section className="health-hub__secondary">
        <Skeleton height={100} radius="md" />
        <Skeleton height={100} radius="md" />
      </section>
    </main>
  );
}

// Placeholder for existing detail cards — adapter for whatever shape `dashboard.cards[]` has.
// If existing detail cards are imported here, swap this for the real component.
function DetailCardPlaceholder({ data, onClick }) {
  return (
    <button className="metric-card" onClick={onClick} type="button">
      <div className="metric-card__label">{data.type?.toUpperCase?.() || 'CARD'}</div>
      <div className="metric-card__value" style={{ fontSize: 18 }}>
        {data.title || JSON.stringify(data).slice(0, 80)}
      </div>
    </button>
  );
}
```

NOTE: If the existing HealthHub has named card components for sleep/water/etc., import them and pass them through instead of `DetailCardPlaceholder`. Verify before replacing.

- [ ] **Step 3: HealthHub.scss — placeholder**

If `frontend/src/modules/Health/HealthHub/HealthHub.scss` doesn't exist or is generic, the styles in `HealthApp.scss` (Task 9) cover the layout. The `.scss` file can be empty or contain only component-specific overrides as needed.

- [ ] **Step 4: Run any existing HealthHub tests**

```bash
cd /opt/Code/DaylightStation && find tests -name "HealthHub*" -o -path "*/HealthHub*test*"
```

If tests exist, run them and adapt.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/HealthHub/
git commit -m "refactor(health-hub): hero + secondary layout

Plan / Task 10. HealthHub now renders 3 hero cards (Weight/Workouts/
Calories) above a flexible secondary grid. Skeleton loader matches the
shape. onCardClick(type) propagates to HealthApp for detail navigation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: AskBar component

**Files:**
- Create: `frontend/src/modules/Health/AskBar/index.jsx`
- Create: `frontend/src/modules/Health/AskBar/AskBar.scss`
- Create: `frontend/src/modules/Health/AskBar/AskBar.test.jsx`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/src/modules/Health/AskBar/AskBar.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { AskBar } from './index.jsx';

function r(ui) { return render(<MantineProvider defaultColorScheme="dark">{ui}</MantineProvider>); }

describe('AskBar', () => {
  it('renders placeholder + ⌘K hint', () => {
    r(<AskBar onActivate={vi.fn()} />);
    expect(screen.getByText(/Ask your coach/)).toBeInTheDocument();
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });

  it('invokes onActivate on click', () => {
    const onActivate = vi.fn();
    r(<AskBar onActivate={onActivate} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onActivate).toHaveBeenCalled();
  });

  it('invokes onActivate on Enter keypress', () => {
    const onActivate = vi.fn();
    r(<AskBar onActivate={onActivate} />);
    const btn = screen.getByRole('button');
    btn.focus();
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/AskBar/AskBar.test.jsx
```

- [ ] **Step 3: Implement AskBar**

```javascript
// frontend/src/modules/Health/AskBar/index.jsx
import { AiMark } from '../AiMark/index.jsx';
import './AskBar.scss';

export function AskBar({ onActivate }) {
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate?.();
    }
  };

  return (
    <div
      className="ask-bar"
      role="button"
      tabIndex={0}
      aria-label="Ask the health coach"
      onClick={() => onActivate?.()}
      onKeyDown={handleKey}
    >
      <AiMark size={24} />
      <span className="ask-bar__placeholder">
        Ask your coach…
        <span className="ask-bar__hint"> type @ to mention a period or workout</span>
      </span>
      <kbd className="ask-bar__shortcut">⌘K</kbd>
    </div>
  );
}

export default AskBar;
```

```scss
// frontend/src/modules/Health/AskBar/AskBar.scss
.ask-bar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 32px);
  max-width: 800px;
  background: var(--mantine-color-surface-0);
  padding: 10px 14px;
  border-radius: 24px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--mantine-color-border-0);
  cursor: text;
  z-index: 40;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}

.ask-bar:focus-visible,
.ask-bar:hover {
  border-color: #2563eb;
  outline: none;
}

.ask-bar__placeholder {
  color: var(--mantine-color-textMid-0);
  font-size: 13px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ask-bar__hint {
  color: var(--mantine-color-textLow-0);
}

.ask-bar__shortcut {
  background: var(--mantine-color-border-0);
  color: var(--mantine-color-textMid-0);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-family: inherit;
}
```

- [ ] **Step 4: Run; pass; commit**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/AskBar/AskBar.test.jsx
git add frontend/src/modules/Health/AskBar/
git commit -m "feat(health-app): AskBar persistent bottom widget

Plan / Task 11. Fixed-position pill with ✦ avatar, placeholder text,
@-hint, ⌘K shortcut chip. Click or Enter activates onActivate handler.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: ChatOverlay component

**Files:**
- Create: `frontend/src/modules/Health/ChatOverlay/index.jsx`
- Create: `frontend/src/modules/Health/ChatOverlay/ChatOverlay.scss`
- Create: `frontend/src/modules/Health/ChatOverlay/ChatOverlay.test.jsx`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/src/modules/Health/ChatOverlay/ChatOverlay.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ChatOverlay } from './index.jsx';

function r(ui) { return render(<MantineProvider defaultColorScheme="dark">{ui}</MantineProvider>); }

describe('ChatOverlay', () => {
  it('aria-hidden when closed', () => {
    r(<ChatOverlay open={false} onClose={vi.fn()} userId="kc">child</ChatOverlay>);
    const el = document.querySelector('.chat-overlay');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('aria-hidden=false when open', () => {
    r(<ChatOverlay open={true} onClose={vi.fn()} userId="kc">child</ChatOverlay>);
    const el = document.querySelector('.chat-overlay');
    expect(el.getAttribute('aria-hidden')).toBe('false');
  });

  it('Esc closes', () => {
    const onClose = vi.fn();
    r(<ChatOverlay open={true} onClose={onClose} userId="kc">child</ChatOverlay>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('scrim click closes', () => {
    const onClose = vi.fn();
    r(<ChatOverlay open={true} onClose={onClose} userId="kc">child</ChatOverlay>);
    fireEvent.click(document.querySelector('.chat-overlay__scrim'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders userId in header', () => {
    r(<ChatOverlay open={true} onClose={vi.fn()} userId="kckern">x</ChatOverlay>);
    expect(screen.getByText(/kckern/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/ChatOverlay/ChatOverlay.test.jsx
```

- [ ] **Step 3: Implement ChatOverlay**

```javascript
// frontend/src/modules/Health/ChatOverlay/index.jsx
import { useEffect } from 'react';
import { AiMark } from '../AiMark/index.jsx';
import './ChatOverlay.scss';

export function ChatOverlay({ open, onClose, userId, children }) {
  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <div
      className={`chat-overlay ${open ? 'chat-overlay--open' : ''}`}
      aria-hidden={!open}
    >
      <div className="chat-overlay__scrim" onClick={() => onClose?.()} />
      <div className="chat-overlay__panel" role="dialog" aria-modal="true">
        <header className="chat-overlay__header">
          <AiMark size={24} />
          <span className="chat-overlay__title">Health Coach</span>
          {userId && <span className="chat-overlay__user">· {userId}</span>}
          <button className="chat-overlay__close" onClick={() => onClose?.()} type="button">
            Esc to dismiss
          </button>
        </header>
        <div className="chat-overlay__body">
          {children}
        </div>
      </div>
    </div>
  );
}

export default ChatOverlay;
```

```scss
// frontend/src/modules/Health/ChatOverlay/ChatOverlay.scss
.chat-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  pointer-events: none;
}

.chat-overlay--open { pointer-events: auto; }

.chat-overlay__scrim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0);
  transition: background 200ms ease-out;
}

.chat-overlay--open .chat-overlay__scrim {
  background: rgba(0, 0, 0, 0.6);
}

.chat-overlay__panel {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 80vh;
  background: var(--mantine-color-background-0);
  color: var(--mantine-color-textHigh-0);
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  display: flex;
  flex-direction: column;
  transform: translateY(100%);
  transition: transform 200ms ease-out;
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.5);
}

.chat-overlay--open .chat-overlay__panel { transform: translateY(0); }

.chat-overlay__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--mantine-color-surface-0);
}

.chat-overlay__title {
  font-size: 13px;
  font-weight: 500;
}

.chat-overlay__user {
  font-size: 11px;
  color: var(--mantine-color-textLow-0);
}

.chat-overlay__close {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--mantine-color-border-0);
  color: var(--mantine-color-textMid-0);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  cursor: pointer;
}

.chat-overlay__close:hover { color: var(--mantine-color-textHigh-0); }

.chat-overlay__body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

@media (prefers-reduced-motion: reduce) {
  .chat-overlay__panel { transition: none; }
  .chat-overlay__scrim { transition: none; }
}
```

- [ ] **Step 4: Run; pass; commit**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/ChatOverlay/ChatOverlay.test.jsx
git add frontend/src/modules/Health/ChatOverlay/
git commit -m "feat(health-app): ChatOverlay slide-up dialog

Plan / Task 12. role=dialog, aria-modal, focus-trap-able.
translateY animation 200ms ease-out, scrim fade 0→0.6 alpha. Esc /
scrim-click / close-button all close. Body scroll locked while open.
Respects prefers-reduced-motion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: ToolCallAttribution component

**Files:**
- Create: `frontend/src/modules/Health/CoachChat/ToolCallAttribution.jsx`
- Create: `frontend/src/modules/Health/CoachChat/ToolCallAttribution.test.jsx`

- [ ] **Step 1: Write failing test**

```javascript
// frontend/src/modules/Health/CoachChat/ToolCallAttribution.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallAttribution } from './ToolCallAttribution.jsx';

describe('ToolCallAttribution', () => {
  it('renders nothing when toolCalls is empty', () => {
    const { container } = render(<ToolCallAttribution toolCalls={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one row per tool call with name and latency', () => {
    render(<ToolCallAttribution toolCalls={[
      { toolName: 'metric_trajectory', args: { x: 1 }, result: { y: 2 }, latencyMs: 9, status: 'done' },
      { toolName: 'aggregate_metric', args: {}, result: {}, latencyMs: 12, status: 'done' },
    ]} />);
    expect(screen.getByText(/metric_trajectory/)).toBeInTheDocument();
    expect(screen.getByText(/aggregate_metric/)).toBeInTheDocument();
    expect(screen.getByText(/9ms/)).toBeInTheDocument();
  });

  it('shows "running…" indicator for in-flight calls', () => {
    render(<ToolCallAttribution toolCalls={[
      { toolName: 'slow_tool', args: {}, status: 'running' },
    ]} />);
    expect(screen.getByText(/running/)).toBeInTheDocument();
  });

  it('expands to show args and result on click', () => {
    render(<ToolCallAttribution toolCalls={[
      { toolName: 'foo', args: { a: 1 }, result: { b: 2 }, latencyMs: 5, status: 'done' },
    ]} />);
    fireEvent.click(screen.getByText(/foo/));
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
    expect(screen.getByText(/"b": 2/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/CoachChat/ToolCallAttribution.test.jsx
```

- [ ] **Step 3: Implement**

```javascript
// frontend/src/modules/Health/CoachChat/ToolCallAttribution.jsx
import { useState } from 'react';
import { AiMark } from '../AiMark/index.jsx';

export function ToolCallAttribution({ toolCalls }) {
  const [expanded, setExpanded] = useState(false);
  if (!toolCalls?.length) return null;

  return (
    <div className="tool-call-attribution">
      <button
        className="tool-call-attribution__toggle"
        onClick={() => setExpanded(e => !e)}
        type="button"
      >
        {toolCalls.map((tc, i) => (
          <span key={i} className="tool-call-attribution__row">
            <AiMark size={16} />
            {tc.status === 'running'
              ? <span>using <code>{tc.toolName}</code> · running…</span>
              : <span>used <code>{tc.toolName}</code> · {tc.latencyMs}ms</span>
            }
          </span>
        ))}
      </button>
      {expanded && (
        <pre className="tool-call-attribution__details">
          {JSON.stringify(toolCalls, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default ToolCallAttribution;
```

Add SCSS to `CoachChat.scss` (Task 16 wires this in):

```scss
.tool-call-attribution {
  margin-top: 8px;
}
.tool-call-attribution__toggle {
  background: rgba(37, 99, 235, 0.1);
  border: none;
  border-left: 2px solid #3b82f6;
  border-radius: 4px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--mantine-color-textMid-0);
  cursor: pointer;
  text-align: left;
  width: 100%;
}
.tool-call-attribution__row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tool-call-attribution__row code {
  color: #3b82f6;
}
.tool-call-attribution__details {
  margin-top: 8px;
  padding: 10px;
  background: var(--mantine-color-surfaceAlt-0);
  border-radius: 4px;
  font-size: 11px;
  color: var(--mantine-color-textMid-0);
  overflow-x: auto;
}
```

- [ ] **Step 4: Run; pass; commit**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/CoachChat/ToolCallAttribution.test.jsx
git add frontend/src/modules/Health/CoachChat/ToolCallAttribution.jsx \
        frontend/src/modules/Health/CoachChat/ToolCallAttribution.test.jsx
git commit -m "feat(coach-chat): ToolCallAttribution inline pill

Plan / Task 13. Compact 'used X · Yms' row per tool call. Click to
expand args+result JSON. Shows 'running…' for in-flight tool calls
during streaming.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Streaming runtime adapter

**Files:**
- Modify: `frontend/src/modules/Health/CoachChat/runtime.js`
- Modify: `frontend/src/modules/Health/CoachChat/runtime.test.js`

- [ ] **Step 1: Append failing tests**

```javascript
describe('healthCoachChatModel.runStream (async generator)', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  function readableStreamFrom(strings) {
    return new ReadableStream({
      async start(controller) {
        for (const s of strings) controller.enqueue(new TextEncoder().encode(s));
        controller.close();
      },
    });
  }

  it('yields incremental message updates as text-deltas arrive', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      body: readableStreamFrom([
        'data: {"type":"text-delta","text":"Hi "}\n\n',
        'data: {"type":"text-delta","text":"there"}\n\n',
        'data: {"type":"finish"}\n\ndata: {"type":"done"}\n\n',
      ]),
    }));

    const messages = [{ role: 'user', content: [{ type: 'text', text: 'q' }] }];
    const updates = [];
    for await (const u of healthCoachChatModel.runStream({ messages, userId: 'kc' })) {
      updates.push(u);
    }
    // Should yield at least 2 incremental updates (after each text-delta)
    expect(updates.length).toBeGreaterThanOrEqual(2);
    const lastText = updates.at(-1).content.find(p => p.type === 'text').text;
    expect(lastText).toBe('Hi there');
  });

  it('threads attachments through to the request body', async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url, opts) => {
      captured = JSON.parse(opts.body);
      return {
        ok: true,
        body: readableStreamFrom(['data: {"type":"finish"}\n\ndata: {"type":"done"}\n\n']),
      };
    });

    const attachments = [{ type: 'period', value: { rolling: 'last_30d' }, label: 'Last 30 days' }];
    for await (const _ of healthCoachChatModel.runStream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'kc',
      attachments,
    })) { /* drain */ }
    expect(captured.context.attachments).toEqual(attachments);
  });

  it('throws when SSE error event arrives', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      body: readableStreamFrom(['data: {"type":"error","message":"boom"}\n\n']),
    }));

    await expect((async () => {
      for await (const _ of healthCoachChatModel.runStream({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
        userId: 'kc',
      })) { /* drain */ }
    })()).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/CoachChat/runtime.test.js
```

- [ ] **Step 3: Update runtime.js to add streaming**

Append to `frontend/src/modules/Health/CoachChat/runtime.js`:

```javascript
import { parseSSE } from './parseSSE.js';

// ... existing healthCoachChatModel.run kept for non-streaming use ...

healthCoachChatModel.runStream = async function* runStream({ messages, userId, attachments = [], abortSignal }) {
  const last = messages.at(-1);
  const text = (typeof last?.content === 'string')
    ? last.content
    : (Array.isArray(last?.content) ? last.content.filter(p => p?.type === 'text').map(p => p.text).join('\n') : '');

  const res = await fetch('/api/v1/agents/health-coach/run-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text, context: { userId, attachments } }),
    signal: abortSignal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Agent stream failed: ${res.status} ${res.statusText || ''}`.trim());
  }

  let assistantText = '';
  const toolCalls = [];

  for await (const event of parseSSE(res.body)) {
    if (event.type === 'text-delta') {
      assistantText += event.text || '';
      yield {
        role: 'assistant',
        content: [
          { type: 'text', text: assistantText },
        ],
        metadata: { toolCalls: toolCalls.slice() },
      };
    } else if (event.type === 'tool-start') {
      toolCalls.push({
        toolName: event.toolName,
        args: event.args,
        status: 'running',
      });
      yield {
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
        metadata: { toolCalls: toolCalls.slice() },
      };
    } else if (event.type === 'tool-end') {
      const inflight = toolCalls.find(t => t.toolName === event.toolName && t.status === 'running');
      if (inflight) {
        inflight.status = 'done';
        inflight.result = event.result;
        // latency unknown from chunk shape; default to 0 — backend can populate
        inflight.latencyMs = inflight.latencyMs ?? 0;
      } else {
        toolCalls.push({
          toolName: event.toolName,
          result: event.result,
          status: 'done',
          latencyMs: 0,
        });
      }
      yield {
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
        metadata: { toolCalls: toolCalls.slice() },
      };
    } else if (event.type === 'finish') {
      yield {
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
        metadata: { toolCalls: toolCalls.slice(), finishReason: event.reason, usage: event.usage },
      };
    } else if (event.type === 'done') {
      return;
    } else if (event.type === 'error') {
      throw new Error(event.message || 'agent stream error');
    }
  }
};
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/CoachChat/runtime.test.js
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/CoachChat/runtime.js \
        frontend/src/modules/Health/CoachChat/runtime.test.js
git commit -m "feat(coach-chat): streaming runtime adapter (async generator)

Plan / Task 14. healthCoachChatModel.runStream consumes SSE from
/api/v1/agents/health-coach/run-stream via parseSSE. Yields
incremental message states with toolCalls metadata. Throws on
error events.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Wire markdown + streaming + tool attribution into CoachChat

**Files:**
- Modify: `frontend/src/modules/Health/CoachChat/index.jsx`
- Modify: `frontend/src/modules/Health/CoachChat/CoachChat.scss`

- [ ] **Step 1: Update CoachChat to use MarkdownText, ToolCallAttribution, runStream**

In `frontend/src/modules/Health/CoachChat/index.jsx`:

```javascript
// Top of file, alongside existing imports:
import { MarkdownText } from './MarkdownText.jsx';
import { ToolCallAttribution } from './ToolCallAttribution.jsx';

// In the adapter passed to useLocalRuntime — switch from run() to async-generator:
const adapter = useMemo(() => ({
  async *run({ messages, abortSignal }) {
    const attachments = [
      ...collectAttachments(messages),
      ...pendingMentionsRef.current,
    ];
    pendingMentionsRef.current = [];
    yield* healthCoachChatModel.runStream({ messages, userId, attachments, abortSignal });
  },
}), [userId]);

// In AssistantMessage — render text via MarkdownText, append ToolCallAttribution:
function AssistantMessage() {
  // assistant-ui passes message + metadata via context; we read both via Parts override
  return (
    <MessagePrimitive.Root className="coach-chat__message coach-chat__message--assistant">
      <MessagePrimitive.Parts
        components={{
          Text: ({ part }) => <MarkdownText text={part?.text || ''} />,
        }}
      />
      <AssistantMessageToolCalls />
    </MessagePrimitive.Root>
  );
}

// New helper that reads tool calls from the assistant-ui message context.
// assistant-ui v0.12.x exposes useMessage() / useMessagePart() for this.
function AssistantMessageToolCalls() {
  // If assistant-ui exposes a hook that gives us the current message's metadata,
  // use it. Otherwise the metadata travels via runStream's yielded payloads
  // and assistant-ui stores it on the message — verify the actual API
  // surface during implementation. Below is a defensive default.
  try {
    // Pseudocode — replace with the actual hook from assistant-ui
    const message = useMessage?.(); // may not exist
    const toolCalls = message?.metadata?.toolCalls;
    return <ToolCallAttribution toolCalls={toolCalls} />;
  } catch {
    return null;
  }
}
```

NOTE: The hook `useMessage()` in assistant-ui v0.12.x may have a different name. Verify against the installed `@assistant-ui/react` types. Fall back to passing `toolCalls` through a different mechanism (e.g., using the `MessagePrimitive.Root` render-prop pattern) if the hook isn't exposed.

- [ ] **Step 2: Add dark-theme variant CSS to CoachChat.scss**

Append to `frontend/src/modules/Health/CoachChat/CoachChat.scss`:

```scss
// Dark-theme variant for use inside ChatOverlay
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
    color: var(--mantine-color-textHigh-0);
    line-height: 1.6;
    max-width: 90%;
  }
}

// Markdown styles (light + overlay both use these)
.coach-chat__markdown {
  font-size: 13px;
  line-height: 1.6;
}

.coach-chat__md-p { margin: 0 0 8px 0; }
.coach-chat__md-p:last-child { margin-bottom: 0; }
.coach-chat__md-ul, .coach-chat__md-ol { margin: 6px 0; padding-left: 20px; }
.coach-chat__md-li { margin-bottom: 2px; }
.coach-chat__md-strong { font-weight: 600; }
.coach-chat__md-em { font-style: italic; }

.coach-chat__md-code-inline {
  background: var(--mantine-color-surface-0);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.coach-chat__md-code-block {
  background: var(--mantine-color-surfaceAlt-0);
  padding: 10px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 11px;
  margin: 6px 0;
}

.coach-chat__md-table {
  border-collapse: collapse;
  margin: 6px 0;
  font-size: 12px;
}

.coach-chat__md-table th,
.coach-chat__md-table td {
  border: 1px solid var(--mantine-color-border-0);
  padding: 4px 8px;
  text-align: left;
}
```

Add a `variant` prop to the CoachChat component (default "light"):

```javascript
export function CoachChat({ userId, variant = 'light', style }) {
  // ... existing body ...
  return (
    <div className={`coach-chat ${variant === 'overlay' ? 'coach-chat--overlay' : ''}`} style={style}>
      {/* ... existing content ... */}
    </div>
  );
}
```

- [ ] **Step 3: Run all CoachChat tests; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/CoachChat/
```

- [ ] **Step 4: vite build smoke**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -8
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Health/CoachChat/
git commit -m "$(cat <<'EOF'
feat(coach-chat): wire markdown + streaming + tool attribution + variant prop

Plan / Task 15. Adapter switched to async-generator that yields from
runStream. AssistantMessage now renders text via MarkdownText.
ToolCallAttribution renders inline beneath assistant messages.
variant='overlay' enables dark-theme bubbles for ChatOverlay use.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: HealthApp.jsx restructure (no tabs)

**Files:**
- Modify: `frontend/src/Apps/HealthApp.jsx`

- [ ] **Step 1: Rewrite HealthApp.jsx**

```javascript
// frontend/src/Apps/HealthApp.jsx
import { useState, useEffect, useMemo, useCallback } from 'react';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import './HealthApp.scss';
import { DaylightAPI } from '../lib/api.mjs';
import { getChildLogger } from '../lib/logging/singleton.js';
import HealthHub from '../modules/Health/HealthHub';
import HealthDetail from '../modules/Health/HealthDetail';
import CoachChat from '../modules/Health/CoachChat';
import { AskBar } from '../modules/Health/AskBar/index.jsx';
import { ChatOverlay } from '../modules/Health/ChatOverlay/index.jsx';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { healthTheme } from './HealthApp.theme.js';

const HealthApp = () => {
  useDocumentTitle('Health');
  const logger = useMemo(() => getChildLogger({ app: 'health' }), []);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailType, setDetailType] = useState(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

  const userId = useMemo(() =>
    (typeof window !== 'undefined' && window.DAYLIGHT_USER_ID) || 'default',
    []
  );

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await DaylightAPI('/api/v1/health/dashboard');
      setDashboard(data);
    } catch (err) {
      logger.error('health.dashboard.fetch.failed', { error: err?.message });
    } finally {
      setLoading(false);
    }
  }, [logger]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // ⌘K / Ctrl+K opens the chat overlay from anywhere
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOverlayOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const openDetail = useCallback((type) => setDetailType(type), []);
  const backToHub = useCallback(() => setDetailType(null), []);

  return (
    <MantineProvider theme={healthTheme} defaultColorScheme="dark">
      <div className="health-app">
        <header className="health-app__header">
          <div className="health-app__header-left">
            <span className="health-app__status-dot" />
            <span>Health · {userId}</span>
          </div>
          <div className="health-app__header-right">
            {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </header>

        {detailType
          ? <HealthDetail type={detailType} dashboard={dashboard} onBack={backToHub} />
          : <HealthHub dashboard={dashboard} loading={loading} onCardClick={openDetail} onRefresh={fetchDashboard} />
        }

        <AskBar onActivate={() => setOverlayOpen(true)} />

        <ChatOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} userId={userId}>
          <CoachChat userId={userId} variant="overlay" />
        </ChatOverlay>
      </div>
    </MantineProvider>
  );
};

export default HealthApp;
```

NOTE: removed `Tabs` import — no longer used. Removed `IconLayoutDashboard` and `IconMessageCircle` from `@tabler/icons-react` since header now has minimal chrome. If other parts of the file still use them, keep the imports.

- [ ] **Step 2: Verify vite build**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -8
```

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/Apps/HealthApp.jsx
git commit -m "$(cat <<'EOF'
refactor(health-app): no tabs, AskBar + ChatOverlay always-mounted

Plan / Task 16. HealthApp uses healthTheme override (dark default).
Hub IS the page; HealthDetail replaces Hub when card clicked.
AskBar persists at bottom; ⌘K listener at this level opens overlay.
ChatOverlay wraps CoachChat with variant=overlay.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: HealthHub.scss + secondary card adapter

**Files:**
- Verify or create: `frontend/src/modules/Health/HealthHub/HealthHub.scss`

- [ ] **Step 1: Confirm HealthHub.scss state**

```bash
cd /opt/Code/DaylightStation && cat frontend/src/modules/Health/HealthHub/HealthHub.scss 2>/dev/null | head -20
```

If the file exists with old styles that conflict (light theme, old card layout), replace its contents with this minimal stub — the global `HealthApp.scss` from Task 9 covers most styling:

```scss
// frontend/src/modules/Health/HealthHub/HealthHub.scss
// Component-specific overrides only. Global hub layout lives in HealthApp.scss.

.health-hub__hero .metric-card--hero {
  min-height: 130px;
  display: flex;
  flex-direction: column;
}

.health-hub__hero .metric-card--hero .metric-card__sparkline {
  margin-top: auto;  // pin to bottom of the card
}
```

If the file doesn't exist, create it.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Health/HealthHub/HealthHub.scss
git commit -m "feat(health-hub): scss component overrides

Plan / Task 17.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: End-to-end verification + smoke

- [ ] **Step 1: Full unit test run**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/agents/ \
  tests/isolated/adapters/agents/ \
  tests/isolated/api/routers/health-mentions.test.mjs \
  tests/isolated/api/routers/agents.runStream.test.mjs \
  frontend/src/modules/Health/
```

Expected: all green.

- [ ] **Step 2: vite build**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -5
```

Expected: built clean.

- [ ] **Step 3: `node -c` parse on backend changes**

```bash
cd /opt/Code/DaylightStation && \
  node -c backend/src/app.mjs && \
  node -c backend/src/4_api/v1/routers/agents-stream.mjs && \
  node -c backend/src/4_api/v1/routers/health-mentions.mjs && \
  echo "OK"
```

- [ ] **Step 4: Final empty commit (optional)**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore(health-app): plan complete — polish + redesign shipped

Backend: /mentions/all fanout fixed, SSE streaming endpoint live.
Frontend: dark-theme HealthApp, hero metric cards, persistent AskBar,
ChatOverlay slide-up, markdown rendering, streaming runtime.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| Spec section | Task |
|---|---|
| **Polish spec — A. /mentions/all fanout** | 1 |
| **Polish spec — B. Streaming agent endpoint (server)** | 2, 3 |
| **Polish spec — B. Streaming runtime (frontend)** | 5, 14 |
| **Polish spec — C. Markdown rendering** | 4, 6, 15 |
| **Redesign — Dark theme tokens** | 9 |
| **Redesign — HealthAppHeader** | 9 (CSS), 16 (JSX) |
| **Redesign — Hero metric cards (Weight/Workouts/Calories)** | 8 |
| **Redesign — HealthHub refactor** | 10 |
| **Redesign — HealthHubSkeleton** | 10 |
| **Redesign — AskBar** | 11 |
| **Redesign — ChatOverlay** | 12 |
| **Redesign — AiMark** | 7 |
| **Redesign — CoachChat variant=overlay** | 15 |
| **Redesign — ToolCallAttribution** | 13, 15 |
| **Redesign — HealthApp.jsx restructure (no tabs)** | 16 |
| **Verification** | 18 |

---

## Notes for the implementer

- **assistant-ui v0.12.28 message hooks.** Task 15's `AssistantMessageToolCalls` uses a hypothetical `useMessage()` hook to read message metadata. Verify the actual hook name in `@assistant-ui/react` — if it's different (e.g., `useMessageContext`, `useThreadMessage`), adapt. If no hook exists, fall back to passing `toolCalls` via a render-prop pattern on `<MessagePrimitive.Root>`.
- **Tool-call render order.** Some streaming chunk shapes split `tool-start` and `tool-end` events such that the same toolName appears multiple times. The adapter in Task 14 finds the in-flight match by `(toolName, status)`. If a tool runs twice in one turn, both calls are recorded — preferred over silent overwrites.
- **Mantine `<Sparkline>` import path.** `@mantine/charts` exports `Sparkline` from its main entry. If the version in `package.json` is older and doesn't have it, fall back to a tiny inline SVG sparkline (~20 lines).
- **HealthDetail unchanged.** This plan doesn't touch HealthDetail — it inherits the new dark theme automatically via `MantineProvider`. If it looks broken in dark mode, follow up with a small style pass.
- **Existing tests on HealthApp.** Search `grep -rn "HealthApp" tests/` before starting Task 16 — old tests asserting Tabs presence will need to be removed or updated.
- **Mantine theme array shape.** Task 9's theme defines colors as 10-element arrays of identical strings. This is Mantine's required shape; future polish could derive a real shade range, but identical-fill works for our token-style usage.
- **CSS variable naming.** Mantine generates `--mantine-color-{key}-{shade}` from the theme. Task 9's tokens are accessed as `var(--mantine-color-surface-0)` etc. (always shade `0` since all 10 shades are identical for our tokens). Don't accidentally use shade `1`-`9` and expect different colors.
