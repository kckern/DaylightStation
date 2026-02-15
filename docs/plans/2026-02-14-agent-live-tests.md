# Agent Live Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add live integration tests for the agent API — echo agent for API contract validation, health-coach for full pipeline smoke testing.

**Architecture:** Three files in a new `tests/live/agent/` directory: a shared helper for fetch wrappers, an echo agent test covering every API endpoint, and a health-coach pipeline test that triggers an assignment and verifies dashboard output + memory state. The live harness gets `'agent'` added to its TARGETS so `--only=agent` works.

**Tech Stack:** Jest (via live harness), fetch API, configHelper for ports

**Design spec:** `docs/plans/2026-02-14-agent-live-tests-design.md`

---

### Task 1: Shared test helper

Create the fetch wrapper used by both test files.

**Files:**
- Create: `tests/live/agent/_agent-test-helper.mjs`

**Step 1: Write the helper**

```javascript
// tests/live/agent/_agent-test-helper.mjs

import { getAppPort } from '../../_lib/configHelper.mjs';

const APP_PORT = getAppPort();
const BASE_URL = `http://localhost:${APP_PORT}`;

/**
 * Fetch a JSON endpoint and return { res, data }.
 * Does NOT swallow errors — callers assert on res.status.
 */
async function fetchJSON(url, opts = {}) {
  const { method = 'GET', body, timeout = 5000 } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const fetchOpts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
  };
  if (body !== undefined) {
    fetchOpts.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, fetchOpts);
    clearTimeout(timer);
    const data = await res.json().catch(() => null);
    return { res, data };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export function agentAPI(path, opts) {
  return fetchJSON(`${BASE_URL}/api/v1/agents${path}`, opts);
}

export function dashboardAPI(path, opts) {
  return fetchJSON(`${BASE_URL}/api/v1/health-dashboard${path}`, opts);
}

export function householdAPI(path, opts) {
  return fetchJSON(`${BASE_URL}/api/v1/admin/household${path || ''}`, opts);
}

export function today() {
  return new Date().toISOString().split('T')[0];
}

export { BASE_URL };
```

**Step 2: Commit**

```bash
git add tests/live/agent/_agent-test-helper.mjs
git commit -m "test(agents): add shared test helper for agent live tests"
```

---

### Task 2: Echo agent API contract test

Test every agent API endpoint against the always-available echo agent.

**Files:**
- Create: `tests/live/agent/echo-agent.test.mjs`

**Step 1: Write the test file**

```javascript
// tests/live/agent/echo-agent.test.mjs
/**
 * Echo Agent API Contract Tests
 *
 * Validates the full agent API surface against the echo agent,
 * which is always registered and requires no external dependencies.
 */

import { agentAPI } from './_agent-test-helper.mjs';

const TEST_USER = '_test-agent';

describe('Echo Agent API', () => {

  test('GET /agents — lists agents including echo', async () => {
    const { res, data } = await agentAPI('/');
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agents');
    expect(Array.isArray(data.agents)).toBe(true);

    const echo = data.agents.find(a => a.id === 'echo');
    expect(echo).toBeDefined();
    expect(echo.id).toBe('echo');
  });

  test('GET /agents/echo/assignments — returns assignments array', async () => {
    const { res, data } = await agentAPI('/echo/assignments');
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agentId', 'echo');
    expect(data).toHaveProperty('assignments');
    expect(Array.isArray(data.assignments)).toBe(true);
  });

  test('POST /agents/echo/run — runs agent and returns output', async () => {
    const { res, data } = await agentAPI('/echo/run', {
      method: 'POST',
      body: { input: 'hello from test' },
      timeout: 30000,
    });
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agentId', 'echo');
    expect(data).toHaveProperty('output');
    expect(typeof data.output).toBe('string');
    expect(data).toHaveProperty('toolCalls');
    expect(Array.isArray(data.toolCalls)).toBe(true);
  }, 30000);

  test('GET /agents/echo/memory/:userId — reads memory entries', async () => {
    const { res, data } = await agentAPI(`/echo/memory/${TEST_USER}`);
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agentId', 'echo');
    expect(data).toHaveProperty('userId', TEST_USER);
    expect(data).toHaveProperty('entries');
    expect(typeof data.entries).toBe('object');
  });

  test('DELETE /agents/echo/memory/:userId — clears all memory', async () => {
    const { res, data } = await agentAPI(`/echo/memory/${TEST_USER}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('cleared', true);
  });

  test('GET /agents/nonexistent/assignments — returns 404', async () => {
    const { res, data } = await agentAPI('/nonexistent/assignments');
    expect(res.status).toBe(404);
    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/not found/i);
  });
});
```

**Step 2: Run the test to verify it passes**

Run: `npx jest tests/live/agent/echo-agent.test.mjs --runInBand --colors`

Expected: 6 tests, all PASS (requires running dev server on configured port).

If server is not running, start it first: `npm run dev` (in a separate terminal).

**Step 3: Commit**

```bash
git add tests/live/agent/echo-agent.test.mjs
git commit -m "test(agents): add echo agent API contract tests"
```

---

### Task 3: Health coach assignment pipeline test

Full pipeline smoke test: trigger assignment, verify dashboard, verify memory, cleanup.

**Files:**
- Create: `tests/live/agent/health-coach-assignment.test.mjs`

**Step 1: Write the test file**

```javascript
// tests/live/agent/health-coach-assignment.test.mjs
/**
 * Health Coach Assignment Pipeline Test
 *
 * Triggers the daily-dashboard assignment and verifies the full pipeline:
 * 1. Assignment completes successfully
 * 2. Dashboard file is written with correct structure
 * 3. Working memory is updated
 * 4. Cleanup: delete generated dashboard
 *
 * Requires: health-coach agent registered, health services configured, LLM API key.
 * Fails fast if prerequisites are missing.
 */

import { agentAPI, dashboardAPI, householdAPI, today } from './_agent-test-helper.mjs';

const AGENT_ID = 'health-coach';
const ASSIGNMENT_ID = 'daily-dashboard';
const DATE = today();

describe('Health Coach Assignment Pipeline', () => {
  let userId;

  beforeAll(async () => {
    // Verify health-coach is registered
    const { res, data } = await agentAPI('/');
    if (!res.ok) {
      throw new Error(`Agent API not responding: ${res.status}`);
    }

    const agent = data.agents?.find(a => a.id === AGENT_ID);
    if (!agent) {
      throw new Error(
        `Agent '${AGENT_ID}' is not registered. ` +
        'Health services are likely not configured. ' +
        `Available agents: ${data.agents?.map(a => a.id).join(', ') || 'none'}`
      );
    }

    // Get a real userId from household
    const { data: hhData } = await householdAPI();
    const members = hhData?.members || [];
    if (members.length === 0) {
      throw new Error('No household members found — cannot determine userId for test');
    }
    userId = members[0].username || members[0].id;
  });

  test('triggers daily-dashboard assignment and gets success', async () => {
    const { res, data } = await agentAPI(
      `/${AGENT_ID}/assignments/${ASSIGNMENT_ID}/run`,
      {
        method: 'POST',
        body: { userId },
        timeout: 120000,
      }
    );

    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agentId', AGENT_ID);
    expect(data).toHaveProperty('assignmentId', ASSIGNMENT_ID);
    expect(data).toHaveProperty('status', 'complete');
    expect(data).toHaveProperty('result');
  }, 120000);

  test('dashboard was written with expected structure', async () => {
    const { res, data } = await dashboardAPI(`/${userId}/${DATE}`);

    expect(res.status).toBe(200);
    expect(data).toHaveProperty('dashboard');

    const db = data.dashboard;

    // Top-level structure
    expect(db).toHaveProperty('curated');
    expect(db).toHaveProperty('coach');

    // Curated content: up_next with primary
    expect(db.curated).toHaveProperty('up_next');
    expect(db.curated.up_next).toHaveProperty('primary');
    expect(db.curated.up_next.primary).toHaveProperty('content_id');
    expect(db.curated.up_next.primary).toHaveProperty('title');

    // Coach content: briefing is a non-empty string
    expect(db.coach).toHaveProperty('briefing');
    expect(typeof db.coach.briefing).toBe('string');
    expect(db.coach.briefing.length).toBeGreaterThan(0);
  });

  test('working memory was updated', async () => {
    const { res, data } = await agentAPI(`/${AGENT_ID}/memory/${userId}`);

    expect(res.status).toBe(200);
    expect(data).toHaveProperty('entries');
    expect(typeof data.entries).toBe('object');

    const keys = Object.keys(data.entries);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('cleanup: delete generated dashboard', async () => {
    const { res, data } = await dashboardAPI(`/${userId}/${DATE}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    expect(data).toHaveProperty('deleted', true);
  });
});
```

**Step 2: Run the test to verify it passes**

Run: `npx jest tests/live/agent/health-coach-assignment.test.mjs --runInBand --colors`

Expected: 4 tests, all PASS. Takes ~60-120s due to LLM calls.

If health-coach is not registered, `beforeAll` will throw with a descriptive message — this is intentional (fail fast, no silent skipping).

**Step 3: Commit**

```bash
git add tests/live/agent/health-coach-assignment.test.mjs
git commit -m "test(agents): add health-coach assignment pipeline smoke test"
```

---

### Task 4: Wire into test harness

Add `'agent'` to the live harness TARGETS so the test runner discovers agent tests, and add an npm script.

**Files:**
- Modify: `tests/_infrastructure/harnesses/live.harness.mjs` (line 11)
- Modify: `package.json` (scripts section)

**Step 1: Update live harness TARGETS**

In `tests/_infrastructure/harnesses/live.harness.mjs`, change line 11 from:

```javascript
const TARGETS = ['api', 'adapter', 'flow'];
```

to:

```javascript
const TARGETS = ['api', 'adapter', 'flow', 'agent'];
```

**Step 2: Add npm script**

In `package.json`, in the `scripts` section, add after `"test:live:adapter"`:

```json
"test:live:agent": "node tests/_infrastructure/harnesses/live.harness.mjs --only=agent",
```

**Step 3: Verify the harness discovers the tests**

Run: `npm run test:live:agent -- --dry-run`

Expected output:
```
Checking backend at ...
✓ Backend ready
Files that would run:
  .../tests/live/agent/echo-agent.test.mjs
  .../tests/live/agent/health-coach-assignment.test.mjs
```

**Step 4: Commit**

```bash
git add tests/_infrastructure/harnesses/live.harness.mjs package.json
git commit -m "test(agents): wire agent tests into live harness with npm script"
```

---

### Task 5: Run all agent tests end-to-end

Run the full suite through the harness to verify everything works together.

**Step 1: Run via harness**

Run: `npm run test:live:agent`

Expected: Both test files run, all 10 tests pass.

**Step 2: Run the full live suite to verify no regressions**

Run: `npm run test:live -- --dry-run`

Expected: Agent test files appear alongside existing api/adapter/flow files.

**Step 3: Commit any fixes**

If any issues were found and fixed:

```bash
git add -A
git commit -m "fix(agents): address issues found during live test verification"
```

---

## Summary

| Task | Files | What |
|------|-------|------|
| 1 | `_agent-test-helper.mjs` | Shared fetch wrapper |
| 2 | `echo-agent.test.mjs` | Echo API contract (6 tests) |
| 3 | `health-coach-assignment.test.mjs` | Pipeline smoke test (4 tests) |
| 4 | `live.harness.mjs`, `package.json` | Harness wiring + npm script |
| 5 | — | End-to-end verification |
