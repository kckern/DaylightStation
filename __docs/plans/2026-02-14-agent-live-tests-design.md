# Agent Live Tests Design

**Goal:** Add live integration tests for the agent API — echo agent for API contract validation, health-coach for full pipeline smoke testing.

**Location:** `tests/live/agent/`

---

## Test Structure

```
tests/live/agent/
├── _agent-test-helper.mjs           — shared fetch wrapper + constants
├── echo-agent.test.mjs              — echo API contract tests (6 cases)
└── health-coach-assignment.test.mjs — full pipeline smoke test (4 cases)
```

## Shared Helper (`_agent-test-helper.mjs`)

- `BASE_URL` from `getAppPort()` configHelper
- `agentAPI(path, opts)` — fetch wrapper for `/api/v1/agents`, returns `{ res, data }`
- `dashboardAPI(path, opts)` — fetch wrapper for `/api/v1/health-dashboard`
- `householdAPI(path)` — fetch wrapper for `/api/v1/admin/household`
- `today()` — returns `YYYY-MM-DD`

Does NOT swallow errors. Tests assert on `res.status` and `data` directly.

## Echo Agent Test (`echo-agent.test.mjs`)

API contract tests — validates every agent endpoint works. No external dependencies, always available.

| # | Test | Endpoint | Assertions |
|---|------|----------|------------|
| 1 | List agents | GET `/agents` | 200, `agents` array contains `{ id: 'echo' }` |
| 2 | List assignments | GET `/agents/echo/assignments` | 200, `assignments` array, each has `{ id, description, schedule }` |
| 3 | Run agent sync | POST `/agents/echo/run` `{ input: "hello" }` | 200, `{ agentId, output, toolCalls }` |
| 4 | Read memory | GET `/agents/echo/memory/_test-agent` | 200, `{ agentId, userId, entries }` |
| 5 | Clear memory | DELETE `/agents/echo/memory/_test-agent` | 200, `{ cleared: true }` |
| 6 | 404 for unknown | GET `/agents/nonexistent/assignments` | 404, `{ error }` contains 'not found' |

No preconditions needed. Standard 5s timeout. Test user: `_test-agent`.

## Health Coach Assignment Test (`health-coach-assignment.test.mjs`)

Full pipeline smoke test — triggers the daily-dashboard assignment, verifies dashboard output, memory state, and schema compliance.

**Preconditions (beforeAll, fail fast):**
- GET `/agents` — verify `health-coach` is registered. Throw if missing.
- GET `/admin/household` — get first real userId for the test.

| # | Test | What | Timeout |
|---|------|------|---------|
| 1 | Trigger assignment | POST `/agents/health-coach/assignments/daily-dashboard/run` `{ userId }` → status `complete` | 120s |
| 2 | Verify dashboard written | GET `/health-dashboard/:userId/:today` → has `curated` (with `up_next.primary`), `coach` (with non-empty `briefing`) | 5s |
| 3 | Verify memory updated | GET `/agents/health-coach/memory/:userId` → `entries` has >0 keys | 5s |
| 4 | Cleanup | DELETE `/health-dashboard/:userId/:today` → `{ deleted: true }` | 5s |

**Key constraints:**
- 120s timeout on assignment trigger (multiple LLM round-trips)
- Loose structure assertions (check keys exist, not exact values — LLM output varies)
- Cleanup deletes generated dashboard to avoid data pollution

## Test Runner

Jest-style `describe/test/expect` matching existing `tests/live/api/` pattern. Add `test:live:agent` npm script.

## Precondition Philosophy

Per project policy: **no silent skipping**. If health-coach is not registered (health services not configured), the test fails immediately in `beforeAll` with a descriptive error message explaining what's missing.
