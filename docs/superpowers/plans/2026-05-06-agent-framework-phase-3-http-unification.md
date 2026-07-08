# Agent Framework HTTP Unification Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the agent HTTP layer onto a single `mountAgentHttp(app, opts)` helper with two wire-format presets (`'native'` and `'openai-chat-completions'`), so concierge and the framework agents share one mounting story. After this plan, `agents.mjs`, `agents-stream.mjs`, `concierge.mjs`, and `OpenAIChatCompletionsTranslator.mjs` are deleted (or reduced to one-line shims that delegate to `mountAgentHttp`). The OpenAI Chat Completions wire format becomes a per-mount option, not a separate router.

**Architecture:** Two new pure-data modules under `backend/src/4_api/v1/agents/wireFormats/` define `parseRequest`, `respondSync`, `respondStream`, `respondError`. `mountAgentHttp.mjs` registers `/run`, `/run-stream`, `/run-background` routes that delegate parsing and response shaping to the wire-format module while talking to `orchestrator.run` / `orchestrator.streamExecute` / `orchestrator.runInBackground`. Concierge gets the same helper called with `wireFormat: 'openai-chat-completions'` plus a satellite-bearer-token middleware. Memory CRUD and the `GET /` agent-list endpoint move to a small `createAgentMetaRouter` mounted once at `/api/v1/agents`.

**Tech Stack:** Node ESM (.mjs), Vitest for new unit tests, Express. Existing AgentOrchestrator surface unchanged — this plan is HTTP-layer only.

**Audit reference:** Implements §4A-1, DRY-H6, Q5 from `docs/_wip/audits/2026-05-06-concierge-vs-healthcoach-agent-framework-audit.md`. Phase 1 (`docs/superpowers/plans/2026-05-06-agent-framework-phase-1-foundations.md`) and Phase 2 (`docs/superpowers/plans/2026-05-06-agent-framework-phase-2-concierge-migration.md`) MUST be merged first — concierge needs to already be running through `agentOrchestrator.run/streamExecute` for this plan's `'openai-chat-completions'` wire to work.

---

## Why this plan exists

After Phase 2, concierge's runtime path is unified: `agentOrchestrator.run('concierge', ...)` and `agentOrchestrator.streamExecute('concierge', ...)` work identically to `orchestrator.run('health-coach', ...)`. **But** the HTTP surfaces are still two completely separate code paths:

- **Framework agents** (echo, lifeplan-guide, paged-media-toc, health-coach):
  - `createAgentsRouter` (`backend/src/4_api/v1/routers/agents.mjs`) — sync `POST /:agentId/run`, background `POST /:agentId/run-background`, listing `GET /`, memory CRUD `GET/DELETE /:agentId/memory/:userId[/:key]`, assignment surface
  - `createAgentsStreamRouter` (`backend/src/4_api/v1/routers/agents-stream.mjs`) — SSE `POST /:agentId/run-stream`
  - Both consume `orchestrator.run` / `orchestrator.streamExecute` and emit framework-native JSON / SSE.

- **Concierge** (HA Voice satellites speak this):
  - `createConciergeRouter` (`backend/src/4_api/v1/routers/concierge.mjs`) — bearer-auth middleware → `/v1/chat/completions` + `/v1/models`
  - Delegates to `OpenAIChatCompletionsTranslator` (`backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs`) which:
    1. Builds the OpenAI envelope around `runner.runChat(...)` for non-stream
    2. Writes `chat.completion.chunk` SSE deltas around `runner.streamChat(...)` for stream
    3. **Suppresses tool-start/tool-end events** (HA Voice clients don't want them — Spec §7.2)

After Phase 2, both paths converge at `orchestrator.run` / `orchestrator.streamExecute`. The wire format (JSON vs OpenAI envelope, native SSE vs `chat.completion.chunk` SSE) is the only divergence left.

This plan extracts the wire format into a per-mount preset and consolidates everything onto `mountAgentHttp(app, { orchestrator, agentId, mountPath, wireFormat, authMiddleware?, contextExtractor? })`. Health-coach calls it with `wireFormat: 'native'`; concierge calls it with `wireFormat: 'openai-chat-completions'` plus a `satelliteBearerAuth` middleware.

**Critical constraint:** HA Voice clients consume the concierge SSE stream **byte-for-byte**. Any drift in the `chat.completion.chunk` envelope, the `[DONE]` terminator, the X-Accel-Buffering header, or the tool-event suppression breaks production. Phase 3's golden-master strategy is to **capture a baseline SSE response BEFORE refactoring**, then assert byte-for-byte equality after.

---

## File structure

**New files:**

```
backend/src/4_api/v1/agents/
  mountAgentHttp.mjs                            — central mounting helper
  mountAgentHttp.test.mjs                       — unit tests (wireFormat='native')
  createAgentMetaRouter.mjs                     — GET /api/v1/agents listing + memory CRUD + assignments
  createAgentMetaRouter.test.mjs
  middlewares/
    satelliteBearerAuth.mjs                     — extracted from concierge.mjs
    satelliteBearerAuth.test.mjs
  wireFormats/
    native.mjs                                  — JSON-in/JSON-out + SSE chunks 1:1
    native.test.mjs
    openaiChatCompletions.mjs                   — chat.completion + chat.completion.chunk envelopes
    openaiChatCompletions.test.mjs

tests/isolated/api/agents/
  mountAgentHttp.native.runStream.test.mjs      — golden master for native SSE shape
  mountAgentHttp.openai.runStream.test.mjs      — golden master for OpenAI SSE shape
  mountAgentHttp.openai.bearerAuth.test.mjs
  mountAgentHttp.runBackground.test.mjs
```

**Modified files:**

```
backend/src/0_system/bootstrap.mjs
  - createAgentsApiRouter() body deletes the createAgentsRouter+createAgentsStreamRouter
    plumbing, replaces with mountAgentHttp(app, ...) calls per agent
  - createConciergeServices() returns the constructed pieces (orchestrator,
    satelliteRegistry, etc.) instead of a router; app.mjs calls mountAgentHttp
    for /v1/chat/completions

backend/src/app.mjs
  - calls mountAgentHttp once per registered agent (native preset)
  - calls mountAgentHttp once for concierge (openai-chat-completions preset
    with satelliteBearerAuth middleware)
  - mounts createAgentMetaRouter once at /api/v1/agents
```

**Deleted files (after migration verified green):**

```
backend/src/4_api/v1/routers/agents.mjs
backend/src/4_api/v1/routers/agents-stream.mjs
backend/src/4_api/v1/routers/concierge.mjs
backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs
backend/tests/unit/api/routers/concierge.test.mjs              ← superseded by mountAgentHttp.openai.* tests
backend/tests/unit/api/translators/OpenAIChatCompletionsTranslator.test.mjs ← superseded
tests/isolated/api/routers/agents.runStream.test.mjs           ← superseded by mountAgentHttp.native.runStream test
```

The existing `tests/isolated/api/routers/agents.runStream.test.mjs` shape is preserved verbatim in the new `mountAgentHttp.native.runStream.test.mjs` — same assertions, same SSE-event order — so the regression bar is exactly today's bar.

---

## Conventions

- Vitest for new tests under `tests/isolated/` and `backend/src/.../*.test.mjs`. node:test stays for the legacy `backend/tests/unit/` tests until they're deleted in Task 6 / Task 7.
- TDD: write golden-master test → run-FAIL → implement → run-PASS → commit per task.
- After each task, run the **full agents + api test suite** to confirm no regression:
  ```bash
  cd /opt/Code/DaylightStation && npx vitest run \
    tests/isolated/agents/ \
    tests/isolated/adapters/agents/ \
    tests/isolated/api/
  ```
- Every commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Commits reference "Plan / Phase 3 Task N" in the body.
- HA Voice byte-exactness gate: Task 0 captures a baseline SSE blob; Task 9 asserts equality. If Task 9 fails, fix the wire-format module — never modify the baseline.
- The `X-Accel-Buffering: no` header MUST be present on every SSE response (both wire formats). Validated in unit tests.
- `res.on('close')` disconnect handler MUST be preserved — when the client disconnects mid-stream the iterator must stop calling `res.write` (otherwise Node 24 emits "Cannot write after end" warnings, documented in earlier work on agents-stream.mjs).

---

## Task 0: Capture HA-Voice SSE baseline (before any refactor)

Phase 3's hardest constraint is byte-for-byte preservation of the OpenAI Chat Completions SSE stream. Capture a baseline NOW, against the current `OpenAIChatCompletionsTranslator`, so Task 7's wire-format module has an immutable target.

**Files:**
- Create: `tests/isolated/api/agents/_baselines/openai-chat-completions-sse.txt` — the captured SSE blob
- Create: `tests/isolated/api/agents/_baselines/openai-chat-completions-sync.json` — the captured non-stream JSON envelope
- Create: `tests/isolated/api/agents/_baselines/CAPTURE.md` — how it was captured (so anyone can re-capture with same fixtures)

- [ ] **Step 1: Read the current translator's stream output shape**

```bash
cd /opt/Code/DaylightStation && sed -n '80,162p' backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs
```

Confirm:
- First chunk is `{ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' } }] }`
- Subsequent text chunks are `{ ..., choices: [{ index: 0, delta: { content: <text> } }] }`
- Tool events (`type: 'tool-start' / 'tool-end'` from the runtime) are NOT emitted to the client
- Final chunk is `{ ..., choices: [{ index: 0, delta: {}, finish_reason: <reason> }] }`
- Stream terminates with `data: [DONE]\n\n`

- [ ] **Step 2: Write the capture script as a test that runs against the in-process translator**

```javascript
// tests/isolated/api/agents/_baselines/capture.test.mjs
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { OpenAIChatCompletionsTranslator } from '../../../../../backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

class FakeRunner {
  async runChat() {
    return {
      content: 'Hello from the kitchen.',
      toolCalls: [],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    };
  }
  async *streamChat() {
    yield { type: 'text-delta', text: 'Hello' };
    yield { type: 'tool-start', toolName: 'remember_note', args: { text: 'pizza tonight' } };
    yield { type: 'tool-end', toolName: 'remember_note', result: { ok: true } };
    yield { type: 'text-delta', text: ' from' };
    yield { type: 'text-delta', text: ' the kitchen.' };
    yield { type: 'finish', reason: 'stop' };
  }
}

function streamingFakeRes() {
  const writes = [];
  const headers = {};
  return {
    setHeader(h, v) { headers[h] = v; return this; },
    status() { return this; },
    write(d) { writes.push(d); return true; },
    end() {},
    flushHeaders() {},
    _state: () => ({ writes, headers }),
  };
}

function fakeRes() {
  let body = null, status = 200;
  const headers = {};
  return {
    setHeader(h, v) { headers[h] = v; return this; },
    status(s) { status = s; return this; },
    json(b) { body = b; return this; },
    _state: () => ({ status, body }),
  };
}

const SATELLITE = { id: 'kitchen', area: 'kitchen', allowedSkills: ['memory'] };
const FIXED_DATE = 1735689600; // 2026-01-01T00:00:00Z — for deterministic 'created' stamp
// CAUTION: 'created' and 'id' (UUID) are non-deterministic in production. We
// post-process the captured blob to redact them.

describe('SSE baseline capture', () => {
  it.skip('captures stream baseline', async () => {
    const tx = new OpenAIChatCompletionsTranslator({ runner: new FakeRunner(), logger: silentLogger });
    const req = { body: { model: 'daylight-house', messages: [{ role: 'user', content: 'hi' }], stream: true } };
    const res = streamingFakeRes();
    await tx.handle(req, res, SATELLITE);
    const blob = res._state().writes.join('')
      .replace(/"id":"chatcmpl-[^"]+"/g, '"id":"chatcmpl-{UUID}"')
      .replace(/"created":\d+/g, '"created":{TS}');
    writeFileSync('tests/isolated/api/agents/_baselines/openai-chat-completions-sse.txt', blob);
  });

  it.skip('captures sync baseline', async () => {
    const tx = new OpenAIChatCompletionsTranslator({ runner: new FakeRunner(), logger: silentLogger });
    const req = { body: { model: 'daylight-house', messages: [{ role: 'user', content: 'hi' }], stream: false } };
    const res = fakeRes();
    await tx.handle(req, res, SATELLITE);
    const body = JSON.parse(JSON.stringify(res._state().body)
      .replace(/"id":"chatcmpl-[^"]+"/g, '"id":"chatcmpl-{UUID}"')
      .replace(/"created":\d+/g, '"created":{TS}'));
    writeFileSync('tests/isolated/api/agents/_baselines/openai-chat-completions-sync.json', JSON.stringify(body, null, 2));
  });
});
```

- [ ] **Step 3: Un-skip both tests, run, and inspect the produced files**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/api/agents/_baselines/capture.test.mjs
```

Then `cat tests/isolated/api/agents/_baselines/openai-chat-completions-sse.txt`. The file should look roughly like:

```
data: {"id":"chatcmpl-{UUID}","object":"chat.completion.chunk","created":{TS},"model":"daylight-house","choices":[{"index":0,"delta":{"role":"assistant"}}]}

data: {"id":"chatcmpl-{UUID}","object":"chat.completion.chunk","created":{TS},"model":"daylight-house","choices":[{"index":0,"delta":{"content":"Hello"}}]}

data: {"id":"chatcmpl-{UUID}","object":"chat.completion.chunk","created":{TS},"model":"daylight-house","choices":[{"index":0,"delta":{"content":" from"}}]}

data: {"id":"chatcmpl-{UUID}","object":"chat.completion.chunk","created":{TS},"model":"daylight-house","choices":[{"index":0,"delta":{"content":" the kitchen."}}]}

data: {"id":"chatcmpl-{UUID}","object":"chat.completion.chunk","created":{TS},"model":"daylight-house","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]

```

Note: NO `tool-start` / `tool-end` events appear in the captured stream — that's the suppression behavior we MUST preserve.

- [ ] **Step 4: Re-skip both tests in capture.test.mjs**

After capture, restore `it.skip` so the tests don't accidentally overwrite the baseline on a later run. The skipped tests document how to re-capture if a baseline change is ever genuinely needed.

- [ ] **Step 5: Write the capture provenance file**

```markdown
<!-- tests/isolated/api/agents/_baselines/CAPTURE.md -->
# OpenAI Chat Completions wire-format baseline

These two files capture the byte-exact response shape that
`OpenAIChatCompletionsTranslator` (the pre-Phase-3 implementation) produced for
a known fixture. They serve as golden masters for the Phase 3
`wireFormats/openaiChatCompletions.mjs` module.

**Recapture:** un-skip the two tests in `capture.test.mjs` and re-run. They
write the files automatically, with `id` and `created` redacted as
`{UUID}` / `{TS}` (non-deterministic).

**Fixture:** see `capture.test.mjs` — a fake runner that yields:
1. text-delta "Hello"
2. tool-start remember_note (suppressed)
3. tool-end remember_note (suppressed)
4. text-delta " from"
5. text-delta " the kitchen."
6. finish stop

**Why this matters:** HA Voice satellites parse this stream with their own
OpenAI-compatible SSE consumer. Any deviation — extra fields, removed fields,
different framing — is a production-breaking change.
```

- [ ] **Step 6: Commit**

```bash
git add tests/isolated/api/agents/_baselines/
git commit -m "$(cat <<'EOF'
test(agents): capture OpenAI Chat Completions wire baseline

Plan / Phase 3 Task 0. Captures byte-exact stream + sync responses
from the current OpenAIChatCompletionsTranslator against a known
fixture, with id/created redacted. Used as golden master in Task 7
when wireFormats/openaiChatCompletions.mjs is implemented.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: Define wire-format interface + native preset

The wire-format module is a small object exporting four functions:

```js
{
  parseRequest(req): { input, context }            // body → orchestrator args
  respondSync(res, result, opts): void             // orchestrator.run result → HTTP body
  respondStream(res, asyncIter, opts): Promise<void> // orchestrator.streamExecute → SSE
  respondError(res, err, opts): void               // any error path
}
```

Native preset mirrors `agents.mjs` + `agents-stream.mjs` behavior verbatim. Same JSON shape, same SSE chunks 1:1, same `'done'`/`'error'` events, same `X-Accel-Buffering: no` header, same `res.on('close')` disconnect handling.

**Files:**
- Create: `backend/src/4_api/v1/agents/wireFormats/native.mjs`
- Create: `backend/src/4_api/v1/agents/wireFormats/native.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// backend/src/4_api/v1/agents/wireFormats/native.test.mjs
import { describe, it, expect, vi } from 'vitest';
import nativeWire from './native.mjs';

function fakeRes() {
  const writes = [];
  const headers = {};
  let status = 200;
  let ended = false;
  let closeHandler = null;
  const r = {
    setHeader(h, v) { headers[h] = v; return r; },
    status(s) { status = s; return r; },
    json(b) { r._jsonBody = b; return r; },
    write(d) { writes.push(d); return true; },
    end() { ended = true; },
    flushHeaders() {},
    on(event, fn) { if (event === 'close') closeHandler = fn; return r; },
    _state: () => ({ status, headers, writes, ended, jsonBody: r._jsonBody, closeHandler }),
    _triggerClose: () => { if (closeHandler) closeHandler(); },
  };
  return r;
}

describe('nativeWire.parseRequest', () => {
  it('extracts input and context from JSON body', () => {
    const req = { body: { input: 'hello', context: { userId: 'kc' } } };
    expect(nativeWire.parseRequest(req)).toEqual({ input: 'hello', context: { userId: 'kc' } });
  });

  it('defaults context to {} when missing', () => {
    const req = { body: { input: 'hi' } };
    expect(nativeWire.parseRequest(req)).toEqual({ input: 'hi', context: {} });
  });

  it('returns input=null when body is empty', () => {
    expect(nativeWire.parseRequest({}).input).toBe(null);
  });
});

describe('nativeWire.respondSync', () => {
  it('writes JSON envelope with agentId, output, toolCalls', () => {
    const res = fakeRes();
    nativeWire.respondSync(res, { output: 'hi', toolCalls: [{ name: 't', args: {} }] }, { agentId: 'echo' });
    const { jsonBody } = res._state();
    expect(jsonBody).toEqual({ agentId: 'echo', output: 'hi', toolCalls: [{ name: 't', args: {} }] });
  });
});

describe('nativeWire.respondStream', () => {
  it('emits SSE chunks 1:1 followed by done event', async () => {
    async function* gen() {
      yield { type: 'text-delta', text: 'Hi' };
      yield { type: 'tool-start', toolName: 'foo', args: {} };
      yield { type: 'tool-end', toolName: 'foo', result: { ok: true } };
      yield { type: 'finish', reason: 'stop' };
    }
    const res = fakeRes();
    await nativeWire.respondStream(res, gen(), { agentId: 'echo' });
    const { writes, ended } = res._state();
    const events = writes.map((w) => JSON.parse(w.replace(/^data: /, '').replace(/\n\n$/, '')));
    expect(events.map((e) => e.type)).toEqual(['text-delta', 'tool-start', 'tool-end', 'finish', 'done']);
    expect(ended).toBe(true);
  });

  it('sets the X-Accel-Buffering: no header (nginx pass-through)', async () => {
    async function* gen() { yield { type: 'finish', reason: 'stop' }; }
    const res = fakeRes();
    await nativeWire.respondStream(res, gen(), { agentId: 'echo' });
    const { headers } = res._state();
    expect(headers['X-Accel-Buffering']).toBe('no');
    expect(headers['Content-Type']).toBe('text/event-stream');
    expect(headers['Cache-Control']).toBe('no-cache');
    expect(headers['Connection']).toBe('keep-alive');
  });

  it('stops iterating when client disconnects (res.on(close))', async () => {
    let yielded = 0;
    async function* gen() {
      while (true) {
        yielded++;
        yield { type: 'text-delta', text: '.' };
        await new Promise((r) => setTimeout(r, 5));
        if (yielded > 100) throw new Error('iterator should have been stopped by close');
      }
    }
    const res = fakeRes();
    const promise = nativeWire.respondStream(res, gen(), { agentId: 'echo' });
    await new Promise((r) => setTimeout(r, 15));
    res._triggerClose();
    await promise;
    expect(yielded).toBeLessThan(100);
  });

  it('emits error event when iterator throws', async () => {
    async function* gen() {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('boom');
    }
    const res = fakeRes();
    await nativeWire.respondStream(res, gen(), { agentId: 'echo' });
    const { writes, ended } = res._state();
    const events = writes.map((w) => JSON.parse(w.replace(/^data: /, '').replace(/\n\n$/, '')));
    expect(events.find((e) => e.type === 'error')).toBeDefined();
    expect(events.find((e) => e.type === 'error').message).toMatch(/boom/);
    expect(ended).toBe(true);
  });
});

describe('nativeWire.respondError', () => {
  it('returns 400 when error message includes "input is required"', () => {
    const res = fakeRes();
    nativeWire.respondError(res, new Error('input is required'));
    const { status, jsonBody } = res._state();
    expect(status).toBe(400);
    expect(jsonBody.error).toMatch(/input is required/);
  });

  it('returns 404 when error message includes "not found"', () => {
    const res = fakeRes();
    nativeWire.respondError(res, new Error("Agent 'foo' not found"));
    const { status, jsonBody } = res._state();
    expect(status).toBe(404);
    expect(jsonBody.error).toMatch(/not found/);
  });

  it('returns 500 for generic errors', () => {
    const res = fakeRes();
    nativeWire.respondError(res, new Error('something went wrong'));
    const { status } = res._state();
    expect(status).toBe(500);
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/4_api/v1/agents/wireFormats/native.test.mjs
```

- [ ] **Step 3: Implement**

```javascript
// backend/src/4_api/v1/agents/wireFormats/native.mjs

/**
 * Native wire format — JSON in, JSON out for /run, raw orchestrator chunks
 * over SSE for /run-stream. Mirrors the legacy agents.mjs + agents-stream.mjs
 * behavior byte-for-byte.
 *
 * Request shape:    { input: string, context?: object }
 * Sync response:    { agentId, output, toolCalls }
 * Stream response:  data: <json>\n\n   per orchestrator chunk
 *                   data: {"type":"done"}\n\n   on success
 *                   data: {"type":"error","message":"..."}\n\n   on failure
 */

export function parseRequest(req) {
  const body = req?.body || {};
  return {
    input: body.input ?? null,
    context: body.context ?? {},
  };
}

export function respondSync(res, result, { agentId } = {}) {
  res.json({
    agentId,
    output: result?.output,
    toolCalls: result?.toolCalls ?? [],
  });
}

export async function respondStream(res, asyncIter, { agentId, logger } = {}) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  res.on('close', () => { closed = true; });

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    logger?.info?.('agents.runStream.start', { agentId });
    for await (const chunk of asyncIter) {
      if (closed) break;
      send(chunk);
    }
    if (!closed) send({ type: 'done' });
    res.end();
    logger?.info?.('agents.runStream.complete', { agentId });
  } catch (err) {
    logger?.error?.('agents.runStream.error', { agentId, error: err.message });
    if (!closed) send({ type: 'error', message: err.message });
    res.end();
  }
}

export function respondError(res, err) {
  const msg = err?.message ?? String(err);
  if (/input is required/i.test(msg)) {
    return res.status(400).json({ error: msg });
  }
  if (/not found/i.test(msg)) {
    return res.status(404).json({ error: msg });
  }
  return res.status(500).json({ error: msg });
}

export default {
  name: 'native',
  parseRequest,
  respondSync,
  respondStream,
  respondError,
};
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/4_api/v1/agents/wireFormats/native.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/agents/wireFormats/native.mjs \
        backend/src/4_api/v1/agents/wireFormats/native.test.mjs
git commit -m "$(cat <<'EOF'
feat(agents): wireFormats/native — JSON+SSE preset for mountAgentHttp

Plan / Phase 3 Task 1. Mirrors the legacy agents.mjs +
agents-stream.mjs behavior — parseRequest / respondSync /
respondStream / respondError. X-Accel-Buffering header, res.on(close)
disconnect handling, and 'done'/'error' SSE events all preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `mountAgentHttp` skeleton + native integration

Build the central mounting helper. Routes registered:

- `POST {mountPath}/{agentId}/run`            → sync via `orchestrator.run`
- `POST {mountPath}/{agentId}/run-stream`     → SSE via `orchestrator.streamExecute`
- `POST {mountPath}/{agentId}/run-background` → async via `orchestrator.runInBackground`

For `'native'`, `mountPath` is `'/api/v1/agents'` and the route paths above match the existing agents routers.

For wire formats with a single fixed endpoint (like OpenAI's `/chat/completions`), `mountAgentHttp` will use a different routing strategy in Task 7 — the helper has to be wire-format-aware. This task implements the native shape; Task 7 extends with the openai shape.

**Files:**
- Create: `backend/src/4_api/v1/agents/mountAgentHttp.mjs`
- Create: `backend/src/4_api/v1/agents/mountAgentHttp.test.mjs`

- [ ] **Step 1: Write failing test (native preset)**

```javascript
// backend/src/4_api/v1/agents/mountAgentHttp.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mountAgentHttp } from './mountAgentHttp.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

function postJson(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'POST', hostname: 'localhost', port, path,
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c.toString(); });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: buf ? JSON.parse(buf) : null,
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function postSSE(port, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'POST', hostname: 'localhost', port, path,
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let buf = '';
      const events = [];
      res.on('data', (chunk) => {
        buf += chunk.toString();
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
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

describe('mountAgentHttp(native)', () => {
  it('POST /run delegates to orchestrator.run and returns JSON envelope', async () => {
    const orchestrator = {
      run: vi.fn(async () => ({ output: 'echo: hi', toolCalls: [] })),
      streamExecute: vi.fn(),
      runInBackground: vi.fn(),
      has: () => true,
    };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, {
      orchestrator, agentId: 'echo', mountPath: '/api/v1/agents',
      wireFormat: 'native', logger: silentLogger,
    });
    const { server, port } = await startServer(app);
    try {
      const r = await postJson(port, '/api/v1/agents/echo/run', { input: 'hi', context: { userId: 'kc' } });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ agentId: 'echo', output: 'echo: hi', toolCalls: [] });
      expect(orchestrator.run).toHaveBeenCalledWith('echo', 'hi', { userId: 'kc' });
    } finally { server.close(); }
  });

  it('POST /run returns 400 when input missing', async () => {
    const orchestrator = { run: vi.fn(), streamExecute: vi.fn(), runInBackground: vi.fn(), has: () => true };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, { orchestrator, agentId: 'echo', mountPath: '/api/v1/agents', wireFormat: 'native', logger: silentLogger });
    const { server, port } = await startServer(app);
    try {
      const r = await postJson(port, '/api/v1/agents/echo/run', {});
      expect(r.status).toBe(400);
    } finally { server.close(); }
  });

  it('POST /run-stream emits SSE in order ending with done', async () => {
    async function* gen() {
      yield { type: 'text-delta', text: 'Hi ' };
      yield { type: 'tool-start', toolName: 'foo', args: {} };
      yield { type: 'tool-end', toolName: 'foo', result: { ok: true } };
      yield { type: 'finish', reason: 'stop' };
    }
    const orchestrator = {
      run: vi.fn(),
      streamExecute: vi.fn(() => gen()),
      runInBackground: vi.fn(),
      has: () => true,
    };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, { orchestrator, agentId: 'health-coach', mountPath: '/api/v1/agents', wireFormat: 'native', logger: silentLogger });
    const { server, port } = await startServer(app);
    try {
      const r = await postSSE(port, '/api/v1/agents/health-coach/run-stream', { input: 'hi', context: { userId: 'kc' } });
      expect(r.status).toBe(200);
      expect(r.headers['x-accel-buffering']).toBe('no');
      expect(r.events.map((e) => e.type)).toEqual(['text-delta', 'tool-start', 'tool-end', 'finish', 'done']);
    } finally { server.close(); }
  });

  it('POST /run-background returns 202 with taskId', async () => {
    const orchestrator = {
      run: vi.fn(),
      streamExecute: vi.fn(),
      runInBackground: vi.fn(async () => ({ taskId: 'task-abc' })),
      has: () => true,
    };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, { orchestrator, agentId: 'echo', mountPath: '/api/v1/agents', wireFormat: 'native', logger: silentLogger });
    const { server, port } = await startServer(app);
    try {
      const r = await postJson(port, '/api/v1/agents/echo/run-background', { input: 'hi' });
      expect(r.status).toBe(202);
      expect(r.body).toMatchObject({ agentId: 'echo', taskId: 'task-abc', status: 'accepted' });
    } finally { server.close(); }
  });

  it('contextExtractor merges into context passed to orchestrator', async () => {
    const orchestrator = {
      run: vi.fn(async () => ({ output: 'ok' })),
      streamExecute: vi.fn(),
      runInBackground: vi.fn(),
      has: () => true,
    };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, {
      orchestrator, agentId: 'echo', mountPath: '/api/v1/agents', wireFormat: 'native',
      contextExtractor: (_req) => ({ injectedFlag: true }),
      logger: silentLogger,
    });
    const { server, port } = await startServer(app);
    try {
      await postJson(port, '/api/v1/agents/echo/run', { input: 'hi', context: { userId: 'kc' } });
      expect(orchestrator.run).toHaveBeenCalledWith('echo', 'hi', { userId: 'kc', injectedFlag: true });
    } finally { server.close(); }
  });

  it('runs authMiddleware before the route handler', async () => {
    const orchestrator = { run: vi.fn(async () => ({ output: 'ok' })), streamExecute: vi.fn(), runInBackground: vi.fn(), has: () => true };
    const authCalls = [];
    const auth = (req, res, next) => { authCalls.push(req.path); next(); };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, {
      orchestrator, agentId: 'echo', mountPath: '/api/v1/agents',
      wireFormat: 'native', authMiddleware: [auth], logger: silentLogger,
    });
    const { server, port } = await startServer(app);
    try {
      await postJson(port, '/api/v1/agents/echo/run', { input: 'hi' });
      expect(authCalls.length).toBeGreaterThan(0);
    } finally { server.close(); }
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/4_api/v1/agents/mountAgentHttp.test.mjs
```

- [ ] **Step 3: Implement skeleton**

```javascript
// backend/src/4_api/v1/agents/mountAgentHttp.mjs
import express from 'express';
import nativeWire from './wireFormats/native.mjs';

const WIRE_FORMATS = {
  native: nativeWire,
  // 'openai-chat-completions' added in Task 7
};

/**
 * Mount an agent's HTTP surface onto an Express app.
 *
 * @param {express.Application} app
 * @param {Object} opts
 * @param {Object}        opts.orchestrator     — AgentOrchestrator instance
 * @param {string}        opts.agentId          — registered agent id
 * @param {string}        opts.mountPath        — e.g. '/api/v1/agents'
 * @param {string}        opts.wireFormat       — 'native' | 'openai-chat-completions'
 * @param {Function[]}    [opts.authMiddleware] — array of express middleware (concierge: bearer auth)
 * @param {Function}      [opts.contextExtractor] — (req) => partial-context-object merged into orchestrator context
 * @param {Object}        [opts.logger]
 * @returns {void}
 */
export function mountAgentHttp(app, opts) {
  const {
    orchestrator,
    agentId,
    mountPath,
    wireFormat,
    authMiddleware = [],
    contextExtractor = null,
    logger = console,
  } = opts;

  if (!orchestrator) throw new Error('mountAgentHttp: orchestrator required');
  if (!agentId) throw new Error('mountAgentHttp: agentId required');
  if (!mountPath) throw new Error('mountAgentHttp: mountPath required');

  const wire = WIRE_FORMATS[wireFormat];
  if (!wire) throw new Error(`mountAgentHttp: unknown wireFormat '${wireFormat}'`);

  // Native preset uses path-prefixed routes. OpenAI preset (Task 7) uses a
  // single fixed endpoint, so we'll branch later.
  if (wireFormat === 'native') {
    mountNative({ app, mountPath, agentId, orchestrator, wire, authMiddleware, contextExtractor, logger });
    return;
  }

  // Future: openaiChatCompletions branch lives in Task 7.
  throw new Error(`mountAgentHttp: wireFormat '${wireFormat}' not yet implemented`);
}

function mountNative({ app, mountPath, agentId, orchestrator, wire, authMiddleware, contextExtractor, logger }) {
  const router = express.Router();
  for (const mw of authMiddleware) router.use(mw);

  router.post(`/${agentId}/run`, async (req, res) => {
    try {
      const { input, context } = wire.parseRequest(req);
      if (!input) return wire.respondError(res, new Error('input is required'));
      const merged = mergeContext(context, contextExtractor, req);
      logger.info?.('agents.run.request', { agentId, inputLength: input.length });
      const result = await orchestrator.run(agentId, input, merged);
      wire.respondSync(res, result, { agentId });
    } catch (err) {
      logger.error?.('agents.run.error', { agentId, error: err.message });
      wire.respondError(res, err);
    }
  });

  router.post(`/${agentId}/run-stream`, async (req, res) => {
    try {
      const { input, context } = wire.parseRequest(req);
      if (!input) return wire.respondError(res, new Error('input is required'));
      const merged = mergeContext(context, contextExtractor, req);
      const iter = orchestrator.streamExecute(agentId, input, merged);
      await wire.respondStream(res, iter, { agentId, logger });
    } catch (err) {
      // Pre-stream errors come out as JSON. Once respondStream is in flight,
      // it owns the response.
      logger.error?.('agents.runStream.error', { agentId, error: err.message });
      wire.respondError(res, err);
    }
  });

  router.post(`/${agentId}/run-background`, async (req, res) => {
    try {
      const { input, context } = wire.parseRequest(req);
      if (!input) return wire.respondError(res, new Error('input is required'));
      const merged = mergeContext(context, contextExtractor, req);
      logger.info?.('agents.runBackground.request', { agentId });
      const { taskId } = await orchestrator.runInBackground(agentId, input, merged);
      res.status(202).json({ agentId, taskId, status: 'accepted' });
    } catch (err) {
      logger.error?.('agents.runBackground.error', { agentId, error: err.message });
      wire.respondError(res, err);
    }
  });

  app.use(mountPath, router);
  logger.info?.('agents.http.mounted', { agentId, mountPath, wireFormat: 'native' });
}

function mergeContext(bodyContext, contextExtractor, req) {
  const extracted = contextExtractor ? contextExtractor(req) : null;
  return { ...(bodyContext || {}), ...(extracted || {}) };
}

export default mountAgentHttp;
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/4_api/v1/agents/mountAgentHttp.test.mjs
```

- [ ] **Step 5: Sanity — verify native SSE event set matches the existing legacy router**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  backend/src/4_api/v1/agents/mountAgentHttp.test.mjs \
  tests/isolated/api/routers/agents.runStream.test.mjs
```

The legacy `agents.runStream.test.mjs` still asserts `['text-delta', 'tool-start', 'tool-end', 'text-delta', 'finish', 'done']` against `createAgentsStreamRouter`. The new `mountAgentHttp` test asserts the same shape. Both must be green simultaneously — that proves the native wire is a drop-in.

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/agents/mountAgentHttp.mjs \
        backend/src/4_api/v1/agents/mountAgentHttp.test.mjs
git commit -m "$(cat <<'EOF'
feat(agents): mountAgentHttp helper (native preset)

Plan / Phase 3 Task 2. Central mounting helper that registers
/run, /run-stream, /run-background routes. Wire format pluggable
via the wireFormat option. authMiddleware array runs before route
handlers; contextExtractor merges per-request context into
orchestrator calls.

OpenAI Chat Completions branch lands in Task 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migrate native-wire agents in bootstrap to `mountAgentHttp`

Switch the four framework agents (echo, lifeplan-guide, paged-media-toc, health-coach) from `createAgentsRouter` + `createAgentsStreamRouter` over to `mountAgentHttp(native)`. Memory CRUD and the `GET /` listing temporarily stay in the legacy router (Task 4 + Task 5 split them out).

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (`createAgentsApiRouter`)
- Modify: `backend/src/app.mjs`

- [ ] **Step 1: Read the current `createAgentsApiRouter` end and where it returns the router**

```bash
cd /opt/Code/DaylightStation && sed -n '3140,3175p' backend/src/0_system/bootstrap.mjs
```

The function currently returns `createAgentsRouter({ agentOrchestrator, workingMemory, scheduler, logger })`. We need to change the contract: `createAgentsApiRouter` now returns the orchestrator + supporting deps (no router), and `app.mjs` calls `mountAgentHttp` for each registered agent.

- [ ] **Step 2: Refactor `createAgentsApiRouter` to return components, not a router**

In `backend/src/0_system/bootstrap.mjs`, replace the final block:

```javascript
// OLD
const router = createAgentsRouter({ agentOrchestrator, workingMemory, scheduler, logger });
router.orchestrator = agentOrchestrator;
router.scheduler = scheduler;
router.coachingOrchestrator = coachingOrchestrator;
router.healthAnalyticsService = sharedHealthAnalyticsService;
return router;
```

with:

```javascript
// NEW
return {
  orchestrator: agentOrchestrator,
  workingMemory,
  scheduler,
  coachingOrchestrator,
  healthAnalyticsService: sharedHealthAnalyticsService,
};
```

The function name (`createAgentsApiRouter`) is now misleading — it builds services, not a router. Rename to `createAgentsServices`. (Update the import in `app.mjs` to match.)

- [ ] **Step 3: In `app.mjs`, replace the router mount with `mountAgentHttp` per agent**

Read the existing block first:

```bash
cd /opt/Code/DaylightStation && sed -n '1965,2005p' backend/src/app.mjs
```

Replace:

```javascript
// OLD
v1Routers.agents = await createAgentsApiRouter({ ... });

v1Routers.agentsStream = createAgentsStreamRouter({
  orchestrator: v1Routers.agents.orchestrator,
  logger: rootLogger.child({ module: 'agents-stream' }),
});
app.use('/api/v1/agents', v1Routers.agentsStream);
```

with:

```javascript
// NEW
const agentsServices = await createAgentsServices({ ... });   // same deps as before

// Mount each registered agent's HTTP surface via mountAgentHttp(native)
for (const { id: agentId } of agentsServices.orchestrator.list()) {
  mountAgentHttp(app, {
    orchestrator: agentsServices.orchestrator,
    agentId,
    mountPath: '/api/v1/agents',
    wireFormat: 'native',
    logger: rootLogger.child({ module: `agents/${agentId}` }),
  });
}

// Expose orchestrator etc. on a stub for compat with downstream consumers
// (createHealthMentionsRouter expects v1Routers.agents.healthAnalyticsService)
v1Routers.agents = {
  orchestrator: agentsServices.orchestrator,
  scheduler: agentsServices.scheduler,
  coachingOrchestrator: agentsServices.coachingOrchestrator,
  healthAnalyticsService: agentsServices.healthAnalyticsService,
};
```

CRITICAL: The legacy `agents.mjs` router (memory CRUD, `GET /`, assignments) is still unmounted at this point. We need to keep those endpoints reachable until Tasks 4 + 5 finish. Add a temporary one-line re-mount of the legacy router AFTER the per-agent loop:

```javascript
// TEMPORARY (deleted in Tasks 4+5): legacy router for GET /, memory CRUD, assignments
const { createAgentsRouter } = await import('./4_api/v1/routers/agents.mjs');
v1Routers.agentsLegacy = createAgentsRouter({
  agentOrchestrator: agentsServices.orchestrator,
  workingMemory: agentsServices.workingMemory,
  logger: rootLogger.child({ module: 'agents-legacy' }),
});
app.use('/api/v1/agents', v1Routers.agentsLegacy);
```

Important Express ordering caveat: the legacy router defines `POST /:agentId/run`. `mountAgentHttp(native)` ALSO defines `POST /:agentId/run` for the same path. Both routers live under `/api/v1/agents`. Express dispatches in registration order, so the per-agent mountAgentHttp router comes FIRST and the legacy router only sees requests where no per-agent route matched. Since memory CRUD and assignments are pinned to `/:agentId/memory/...` / `/:agentId/assignments/...` paths the per-agent helper doesn't define, they fall through cleanly. The duplicate `/:agentId/run` is shadowed safely.

Verify by enumerating handlers:

```bash
cd /opt/Code/DaylightStation && curl -s http://localhost:3111/api/v1/agents | head -20
```

(Should still return the agents list — comes from the legacy router's `GET /`.)

- [ ] **Step 4: Run all api + agent tests**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/api/ \
  tests/isolated/agents/ \
  backend/src/4_api/v1/agents/
```

Expected: all green. The `agents.runStream.test.mjs` legacy test still passes because the legacy stream router is no longer mounted but the test instantiates its own express app inline. Same for the legacy router's tests if any.

- [ ] **Step 5: Live smoke — verify native SSE still streams identically**

Start the dev server (or test against the deployed instance):

```bash
# Echo agent — sync
curl -X POST http://localhost:3111/api/v1/agents/echo/run \
  -H "Content-Type: application/json" \
  -d '{"input":"hello","context":{"userId":"user_1"}}'

# Echo agent — stream
curl -N -X POST http://localhost:3111/api/v1/agents/echo/run-stream \
  -H "Content-Type: application/json" \
  -d '{"input":"hello","context":{"userId":"user_1"}}' | head -20

# Health-coach — stream
curl -N -X POST http://localhost:3111/api/v1/agents/health-coach/run-stream \
  -H "Content-Type: application/json" \
  -d '{"input":"What is my weight?","context":{"userId":"user_1"}}' | head -20

# Memory CRUD (legacy router still serves this)
curl -s http://localhost:3111/api/v1/agents/echo/memory/kckern

# Listing (legacy router)
curl -s http://localhost:3111/api/v1/agents
```

All must succeed. The streamed events shape should match pre-refactor exactly.

- [ ] **Step 6: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "$(cat <<'EOF'
refactor(agents): mount native HTTP surface via mountAgentHttp

Plan / Phase 3 Task 3. createAgentsApiRouter renamed
createAgentsServices and now returns the orchestrator + scheduler
+ workingMemory rather than a fully-built router. app.mjs iterates
the registered agents and calls mountAgentHttp(native) per agent.

Legacy createAgentsRouter still mounted alongside (one line) for
GET /, memory CRUD, assignments — those split out in Tasks 4 + 5.

agents.runStream / agents.run paths now flow through mountAgentHttp.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Memory CRUD surface — extract to `createAgentMemoryRouter`

The memory CRUD endpoints (`GET /:agentId/memory/:userId`, `DELETE /:agentId/memory/:userId[/:key]`) are debug/admin tools, not chat endpoints. They have NO place inside `mountAgentHttp` — they're agent-agnostic in implementation (any registered agent works), they don't speak the wire format at all (always JSON), and they apply to the orchestrator and working-memory store as a whole.

**Decision: extract to a separate `createAgentMemoryRouter` mounted ONCE at `/api/v1/agents`, not per-agent.**

Rationale: routes like `/:agentId/memory/...` are dispatched by the SAME mount path as `mountAgentHttp(native)` (both at `/api/v1/agents`), so they coexist via Express's path matching — `/echo/run` hits mountAgentHttp's router, `/echo/memory/kc` hits the memory router. Per-agent `mountAgentHttp` routes don't define memory paths, so there's no conflict.

**Files:**
- Create: `backend/src/4_api/v1/agents/createAgentMemoryRouter.mjs`
- Create: `backend/src/4_api/v1/agents/createAgentMemoryRouter.test.mjs`
- Modify: `backend/src/app.mjs` (mount once, instead of relying on the legacy router)

- [ ] **Step 1: Write failing test**

```javascript
// backend/src/4_api/v1/agents/createAgentMemoryRouter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createAgentMemoryRouter } from './createAgentMemoryRouter.mjs';
import { WorkingMemoryState } from '../../../3_applications/agents/framework/WorkingMemory.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function startServer(app) {
  return new Promise((r) => { const s = app.listen(0, () => r({ server: s, port: s.address().port })); });
}
function req(method, port, path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ method, hostname: 'localhost', port, path, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let buf = ''; res.on('data', (c) => buf += c.toString());
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

describe('createAgentMemoryRouter', () => {
  function setup({ has = () => true, store = new Map() } = {}) {
    const orchestrator = { has };
    const workingMemory = {
      load: async (agentId, userId) => {
        const key = `${agentId}/${userId}`;
        if (!store.has(key)) store.set(key, new WorkingMemoryState());
        return store.get(key);
      },
      save: async (agentId, userId, state) => { store.set(`${agentId}/${userId}`, state); },
    };
    const app = express(); app.use(express.json());
    app.use('/api/v1/agents', createAgentMemoryRouter({ orchestrator, workingMemory, logger: silentLogger }));
    return { app, store, workingMemory };
  }

  it('GET /:agentId/memory/:userId returns the entries', async () => {
    const store = new Map();
    const state = new WorkingMemoryState();
    state.set('note', 'hello');
    store.set('echo/kc', state);
    const { app } = setup({ store });
    const { server, port } = await startServer(app);
    try {
      const r = await req('GET', port, '/api/v1/agents/echo/memory/kc');
      expect(r.status).toBe(200);
      expect(r.body.entries.note).toBeDefined();
    } finally { server.close(); }
  });

  it('GET returns 404 when agent not registered', async () => {
    const { app } = setup({ has: () => false });
    const { server, port } = await startServer(app);
    try {
      const r = await req('GET', port, '/api/v1/agents/missing/memory/kc');
      expect(r.status).toBe(404);
    } finally { server.close(); }
  });

  it('DELETE /:agentId/memory/:userId clears all entries', async () => {
    const store = new Map();
    const state = new WorkingMemoryState();
    state.set('a', 'x'); state.set('b', 'y');
    store.set('echo/kc', state);
    const { app } = setup({ store });
    const { server, port } = await startServer(app);
    try {
      const r = await req('DELETE', port, '/api/v1/agents/echo/memory/kc');
      expect(r.status).toBe(200);
      expect(r.body.cleared).toBe(true);
      expect(store.get('echo/kc').getAll()).toEqual({});
    } finally { server.close(); }
  });

  it('DELETE /:agentId/memory/:userId/:key removes one entry', async () => {
    const store = new Map();
    const state = new WorkingMemoryState();
    state.set('a', 'x'); state.set('b', 'y');
    store.set('echo/kc', state);
    const { app } = setup({ store });
    const { server, port } = await startServer(app);
    try {
      const r = await req('DELETE', port, '/api/v1/agents/echo/memory/kc/a');
      expect(r.status).toBe(200);
      expect(r.body.deleted).toBe(true);
      expect(store.get('echo/kc').get('a')).toBeUndefined();
      expect(store.get('echo/kc').get('b')).toBeDefined();
    } finally { server.close(); }
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/4_api/v1/agents/createAgentMemoryRouter.test.mjs
```

- [ ] **Step 3: Implement**

```javascript
// backend/src/4_api/v1/agents/createAgentMemoryRouter.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { WorkingMemoryState } from '#apps/agents/framework/WorkingMemory.mjs';

/**
 * Memory CRUD endpoints — admin/debug surface for inspecting and clearing
 * agent working memory. Agent-agnostic; mounted ONCE at /api/v1/agents.
 *
 * Routes:
 *   GET    /:agentId/memory/:userId
 *   DELETE /:agentId/memory/:userId
 *   DELETE /:agentId/memory/:userId/:key
 */
export function createAgentMemoryRouter({ orchestrator, workingMemory, logger = console } = {}) {
  if (!orchestrator) throw new Error('createAgentMemoryRouter: orchestrator required');
  if (!workingMemory) throw new Error('createAgentMemoryRouter: workingMemory required');

  const router = express.Router();

  router.get('/:agentId/memory/:userId', asyncHandler(async (req, res) => {
    const { agentId, userId } = req.params;
    if (!orchestrator.has(agentId)) return res.status(404).json({ error: `Agent '${agentId}' not found` });
    const state = await workingMemory.load(agentId, userId);
    const entries = state.toJSON();
    logger.info?.('agents.memory.read', { agentId, userId, count: Object.keys(entries).length });
    res.json({ agentId, userId, entries });
  }));

  router.delete('/:agentId/memory/:userId', asyncHandler(async (req, res) => {
    const { agentId, userId } = req.params;
    if (!orchestrator.has(agentId)) return res.status(404).json({ error: `Agent '${agentId}' not found` });
    await workingMemory.save(agentId, userId, new WorkingMemoryState());
    logger.info?.('agents.memory.cleared', { agentId, userId });
    res.json({ agentId, userId, cleared: true });
  }));

  router.delete('/:agentId/memory/:userId/:key', asyncHandler(async (req, res) => {
    const { agentId, userId, key } = req.params;
    if (!orchestrator.has(agentId)) return res.status(404).json({ error: `Agent '${agentId}' not found` });
    const state = await workingMemory.load(agentId, userId);
    const existed = state.get(key) !== undefined;
    state.remove(key);
    await workingMemory.save(agentId, userId, state);
    logger.info?.('agents.memory.entry.deleted', { agentId, userId, key });
    res.json({ agentId, userId, key, deleted: existed });
  }));

  return router;
}

export default createAgentMemoryRouter;
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/4_api/v1/agents/createAgentMemoryRouter.test.mjs
```

- [ ] **Step 5: Mount in `app.mjs`**

Just below the per-agent `mountAgentHttp` loop, add:

```javascript
import { createAgentMemoryRouter } from './4_api/v1/agents/createAgentMemoryRouter.mjs';

// ... inside the bootstrap function, after the per-agent loop ...
v1Routers.agentMemory = createAgentMemoryRouter({
  orchestrator: agentsServices.orchestrator,
  workingMemory: agentsServices.workingMemory,
  logger: rootLogger.child({ module: 'agent-memory' }),
});
app.use('/api/v1/agents', v1Routers.agentMemory);
```

- [ ] **Step 6: Live smoke**

```bash
# All registered agents — GET memory
curl -s http://localhost:3111/api/v1/agents/echo/memory/kckern
curl -s http://localhost:3111/api/v1/agents/health-coach/memory/kckern

# Confirm 404 for nonexistent agent
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3111/api/v1/agents/no-such-agent/memory/kckern

# DELETE single key (don't run unless you have throwaway data)
# curl -X DELETE http://localhost:3111/api/v1/agents/echo/memory/kckern/test_key
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/4_api/v1/agents/createAgentMemoryRouter.mjs \
        backend/src/4_api/v1/agents/createAgentMemoryRouter.test.mjs \
        backend/src/app.mjs
git commit -m "$(cat <<'EOF'
feat(agents): createAgentMemoryRouter — extract memory CRUD

Plan / Phase 3 Task 4. Working-memory CRUD endpoints
(GET/DELETE /:agentId/memory/:userId[/:key]) are agent-agnostic —
they work for any registered agent without per-agent wiring. Extract
out of the legacy createAgentsRouter into a single router mounted
once at /api/v1/agents. Coexists with the per-agent mountAgentHttp
routers because their path patterns don't overlap.

Legacy createAgentsRouter still mounted for GET / + assignments
until Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Agent listing + assignments — extract to `createAgentMetaRouter`

`GET /api/v1/agents` (list registered agents) and the assignment endpoints (`GET /:agentId/assignments`, `POST /:agentId/assignments/:assignmentId/run`) are also agent-agnostic. Move them to a dedicated router mounted once.

**Files:**
- Create: `backend/src/4_api/v1/agents/createAgentMetaRouter.mjs`
- Create: `backend/src/4_api/v1/agents/createAgentMetaRouter.test.mjs`
- Modify: `backend/src/app.mjs`

- [ ] **Step 1: Write failing test**

```javascript
// backend/src/4_api/v1/agents/createAgentMetaRouter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createAgentMetaRouter } from './createAgentMetaRouter.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function startServer(app) {
  return new Promise((r) => { const s = app.listen(0, () => r({ server: s, port: s.address().port })); });
}
function req(method, port, path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ method, hostname: 'localhost', port, path, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let buf = ''; res.on('data', (c) => buf += c.toString());
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

describe('createAgentMetaRouter', () => {
  it('GET / lists registered agents', async () => {
    const orchestrator = {
      list: () => [{ id: 'echo', description: 'd1' }, { id: 'health-coach', description: 'd2' }],
    };
    const app = express(); app.use(express.json());
    app.use('/api/v1/agents', createAgentMetaRouter({ orchestrator, logger: silentLogger }));
    const { server, port } = await startServer(app);
    try {
      const r = await req('GET', port, '/api/v1/agents');
      expect(r.status).toBe(200);
      expect(r.body.agents).toEqual([
        { id: 'echo', description: 'd1' },
        { id: 'health-coach', description: 'd2' },
      ]);
    } finally { server.close(); }
  });

  it('GET /:agentId/assignments returns 404 when agent missing', async () => {
    const orchestrator = { list: () => [], has: () => false, listInstances: () => [] };
    const app = express(); app.use(express.json());
    app.use('/api/v1/agents', createAgentMetaRouter({ orchestrator, logger: silentLogger }));
    const { server, port } = await startServer(app);
    try {
      const r = await req('GET', port, '/api/v1/agents/foo/assignments');
      expect(r.status).toBe(404);
    } finally { server.close(); }
  });

  it('GET /:agentId/assignments enumerates assignments', async () => {
    class FakeAssignment { static id = 'daily'; static description = 'Daily digest'; static schedule = '0 7 * * *'; }
    const fakeAgent = { constructor: { id: 'echo' }, getAssignments: () => [new FakeAssignment()] };
    const orchestrator = {
      list: () => [{ id: 'echo' }],
      has: () => true,
      listInstances: () => [fakeAgent],
    };
    const app = express(); app.use(express.json());
    app.use('/api/v1/agents', createAgentMetaRouter({ orchestrator, logger: silentLogger }));
    const { server, port } = await startServer(app);
    try {
      const r = await req('GET', port, '/api/v1/agents/echo/assignments');
      expect(r.status).toBe(200);
      expect(r.body.assignments).toEqual([{ id: 'daily', description: 'Daily digest', schedule: '0 7 * * *' }]);
    } finally { server.close(); }
  });

  it('POST /:agentId/assignments/:assignmentId/run delegates to orchestrator', async () => {
    const orchestrator = {
      list: () => [{ id: 'echo' }],
      has: () => true,
      runAssignment: vi.fn(async () => ({ output: 'ran' })),
    };
    const app = express(); app.use(express.json());
    app.use('/api/v1/agents', createAgentMetaRouter({ orchestrator, logger: silentLogger }));
    const { server, port } = await startServer(app);
    try {
      const r = await req('POST', port, '/api/v1/agents/echo/assignments/daily/run', { userId: 'kc' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ agentId: 'echo', assignmentId: 'daily', status: 'complete' });
      expect(orchestrator.runAssignment).toHaveBeenCalledWith('echo', 'daily', expect.objectContaining({ userId: 'kc', triggeredBy: 'api' }));
    } finally { server.close(); }
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```javascript
// backend/src/4_api/v1/agents/createAgentMetaRouter.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Agent metadata + admin endpoints — listing and assignment management.
 * Mounted ONCE at /api/v1/agents (does not duplicate per-agent).
 *
 * Routes:
 *   GET  /                                     — list registered agents
 *   GET  /:agentId/assignments                 — list assignments for an agent
 *   POST /:agentId/assignments/:assignmentId/run — manually trigger an assignment
 */
export function createAgentMetaRouter({ orchestrator, logger = console } = {}) {
  if (!orchestrator) throw new Error('createAgentMetaRouter: orchestrator required');
  const router = express.Router();

  router.get('/', asyncHandler(async (_req, res) => {
    res.json({ agents: orchestrator.list() });
  }));

  router.get('/:agentId/assignments', asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    if (!orchestrator.has(agentId)) return res.status(404).json({ error: `Agent '${agentId}' not found` });
    const instances = orchestrator.listInstances?.() ?? [];
    const agent = instances.find((a) => a?.constructor?.id === agentId);
    const assignments = (agent?.getAssignments?.() || []).map((a) => ({
      id: a.constructor.id,
      description: a.constructor.description || '',
      schedule: a.constructor.schedule || null,
    }));
    res.json({ agentId, assignments });
  }));

  router.post('/:agentId/assignments/:assignmentId/run', asyncHandler(async (req, res) => {
    const { agentId, assignmentId } = req.params;
    const { userId, context = {} } = req.body || {};
    logger.info?.('agents.runAssignment.request', { agentId, assignmentId, userId });
    try {
      const result = await orchestrator.runAssignment(agentId, assignmentId, {
        userId, context, triggeredBy: 'api',
      });
      res.json({ agentId, assignmentId, status: 'complete', result });
    } catch (error) {
      logger.error?.('agents.runAssignment.error', { agentId, assignmentId, error: error.message });
      if (/not found|Unknown assignment/i.test(error.message)) {
        return res.status(404).json({ error: error.message });
      }
      throw error;
    }
  }));

  return router;
}

export default createAgentMetaRouter;
```

- [ ] **Step 4: Run; pass**

- [ ] **Step 5: Mount in `app.mjs`**

```javascript
import { createAgentMetaRouter } from './4_api/v1/agents/createAgentMetaRouter.mjs';

v1Routers.agentMeta = createAgentMetaRouter({
  orchestrator: agentsServices.orchestrator,
  logger: rootLogger.child({ module: 'agent-meta' }),
});
app.use('/api/v1/agents', v1Routers.agentMeta);
```

- [ ] **Step 6: Live smoke**

```bash
# Listing
curl -s http://localhost:3111/api/v1/agents | jq '.agents | length'

# Assignments
curl -s http://localhost:3111/api/v1/agents/health-coach/assignments
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/4_api/v1/agents/createAgentMetaRouter.mjs \
        backend/src/4_api/v1/agents/createAgentMetaRouter.test.mjs \
        backend/src/app.mjs
git commit -m "$(cat <<'EOF'
feat(agents): createAgentMetaRouter — listing + assignments

Plan / Phase 3 Task 5. Listing (GET /api/v1/agents) and assignment
endpoints split out of the legacy createAgentsRouter into their own
router mounted once. Agent-agnostic; no per-agent duplication.

Legacy createAgentsRouter is now redundant and gets deleted in Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Delete legacy `agents.mjs` + `agents-stream.mjs`

Now the legacy router serves zero unique paths — every endpoint is reachable through `mountAgentHttp(native)`, `createAgentMemoryRouter`, or `createAgentMetaRouter`. Delete the files.

**Files:**
- Delete: `backend/src/4_api/v1/routers/agents.mjs`
- Delete: `backend/src/4_api/v1/routers/agents-stream.mjs`
- Delete: `tests/isolated/api/routers/agents.runStream.test.mjs` (already superseded by `mountAgentHttp.test.mjs`)
- Modify: `backend/src/0_system/bootstrap.mjs` (remove `import { createAgentsRouter }`)
- Modify: `backend/src/4_api/v1/routers/index.mjs` (remove the export)
- Modify: `backend/src/app.mjs` (remove the `import { createAgentsStreamRouter }` and the temporary one-line legacy mount from Task 3)

- [ ] **Step 1: Verify no other importers**

```bash
cd /opt/Code/DaylightStation && grep -rn "createAgentsRouter\b\|createAgentsStreamRouter\b\|/routers/agents.mjs\|/routers/agents-stream.mjs" \
  backend/ tests/ | grep -v node_modules
```

Expected output: only the lines in the files we're about to delete + the temporary mount in `app.mjs` from Task 3 + the legacy test file.

- [ ] **Step 2: Remove the temporary legacy mount in `app.mjs`**

Delete the lines added at the end of Task 3:

```javascript
// DELETE
const { createAgentsRouter } = await import('./4_api/v1/routers/agents.mjs');
v1Routers.agentsLegacy = createAgentsRouter({ ... });
app.use('/api/v1/agents', v1Routers.agentsLegacy);
```

- [ ] **Step 3: Remove imports**

In `backend/src/app.mjs`:
```javascript
// DELETE
import { createAgentsStreamRouter } from './4_api/v1/routers/agents-stream.mjs';
```

In `backend/src/0_system/bootstrap.mjs`:
```javascript
// DELETE
import { createAgentsRouter } from '#api/v1/routers/agents.mjs';
```

In `backend/src/4_api/v1/routers/index.mjs`:
```javascript
// DELETE the line
export { createAgentsRouter } from './agents.mjs';
```

- [ ] **Step 4: Delete the files**

```bash
cd /opt/Code/DaylightStation
git rm backend/src/4_api/v1/routers/agents.mjs
git rm backend/src/4_api/v1/routers/agents-stream.mjs
git rm tests/isolated/api/routers/agents.runStream.test.mjs
```

- [ ] **Step 5: Run all tests**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/api/ \
  tests/isolated/agents/ \
  backend/src/4_api/v1/agents/
```

Expected: all green. If something imports a deleted file, fix the import to use the new modules.

- [ ] **Step 6: Live smoke (full native surface)**

```bash
curl -s http://localhost:3111/api/v1/agents | jq '.agents | length'                                              # listing
curl -s -X POST http://localhost:3111/api/v1/agents/echo/run -H 'Content-Type: application/json' -d '{"input":"hi"}'  # sync
curl -N -X POST http://localhost:3111/api/v1/agents/echo/run-stream -H 'Content-Type: application/json' -d '{"input":"hi"}' | head -10  # stream
curl -s http://localhost:3111/api/v1/agents/echo/memory/kckern                                                     # memory
curl -s http://localhost:3111/api/v1/agents/health-coach/assignments                                              # assignments
```

All should succeed identically to before.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(agents): delete legacy agents.mjs + agents-stream.mjs routers

Plan / Phase 3 Task 6. After Tasks 3-5, every endpoint of the legacy
routers is served by mountAgentHttp / createAgentMemoryRouter /
createAgentMetaRouter. Delete the legacy files, their export, the
import in app.mjs, and the legacy SSE test (superseded by
mountAgentHttp.test.mjs which asserts the same shape).

Native HTTP surface is now wholly owned by backend/src/4_api/v1/agents/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Define openai-chat-completions wire format

Now build the second wire format. The translator's full behavior — sync envelope, stream `chat.completion.chunk` chunks, suppress tool events, terminate with `[DONE]` — moves into `wireFormats/openaiChatCompletions.mjs`.

**Files:**
- Create: `backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.mjs`
- Create: `backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.test.mjs`

- [ ] **Step 1: Read the legacy translator one more time**

```bash
cd /opt/Code/DaylightStation && sed -n '1,162p' backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs
```

Confirm the exact behavior the new module must replicate:
- Non-stream: `chat.completion` envelope with `choices[0].message.content` and optional `tool_calls`, `usage` defaults to zeros
- Stream: opening chunk with `delta.role: 'assistant'` → text-delta chunks with `delta.content` → final chunk with `delta: {}, finish_reason` → `data: [DONE]\n\n`
- Tool-start / tool-end events from the orchestrator are SUPPRESSED (never written to the wire)
- Same headers as native (Content-Type, Cache-Control, Connection, X-Accel-Buffering)
- Mid-stream errors emit a synthetic content delta `(error: ...)` with `finish_reason: 'error'`, then close cleanly

- [ ] **Step 2: Write failing tests using the captured baselines from Task 0**

```javascript
// backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import openaiWire from './openaiChatCompletions.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function fakeRes() {
  const writes = []; const headers = {}; let status = 200; let ended = false;
  let closeHandler = null;
  const r = {
    setHeader(h, v) { headers[h] = v; return r; },
    status(s) { status = s; return r; },
    json(b) { r._jsonBody = b; return r; },
    write(d) { writes.push(d); return true; },
    end() { ended = true; },
    flushHeaders() {},
    on(event, fn) { if (event === 'close') closeHandler = fn; return r; },
    _state: () => ({ status, headers, writes, ended, jsonBody: r._jsonBody }),
    _triggerClose: () => { if (closeHandler) closeHandler(); },
  };
  return r;
}

function redact(blob) {
  return blob
    .replace(/"id":"chatcmpl-[^"]+"/g, '"id":"chatcmpl-{UUID}"')
    .replace(/"created":\d+/g, '"created":{TS}');
}

describe('openaiWire.parseRequest', () => {
  it('extracts messages, model, stream, conversation_id', () => {
    const req = {
      body: {
        model: 'daylight-house', stream: true,
        messages: [{ role: 'user', content: 'hi' }],
        conversation_id: 'conv-1',
      },
    };
    const parsed = openaiWire.parseRequest(req);
    expect(parsed.input).toEqual([{ role: 'user', content: 'hi' }]);
    expect(parsed.context.model).toBe('daylight-house');
    expect(parsed.context.stream).toBe(true);
    expect(parsed.context.conversationId).toBe('conv-1');
  });
});

describe('openaiWire.respondSync', () => {
  it('builds chat.completion envelope', () => {
    const res = fakeRes();
    openaiWire.respondSync(res, {
      output: 'Hi.',
      toolCalls: [],
      usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    }, { model: 'daylight-house' });
    const { jsonBody } = res._state();
    expect(jsonBody.object).toBe('chat.completion');
    expect(jsonBody.choices[0].message.content).toBe('Hi.');
    expect(jsonBody.choices[0].finish_reason).toBe('stop');
    expect(jsonBody.usage).toEqual({ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 });
  });
});

describe('openaiWire.respondStream — golden master', () => {
  it('matches the captured baseline byte-for-byte (after redaction)', async () => {
    const expected = readFileSync(
      join(process.cwd(), 'tests/isolated/api/agents/_baselines/openai-chat-completions-sse.txt'),
      'utf8',
    );
    async function* gen() {
      yield { type: 'text-delta', text: 'Hello' };
      yield { type: 'tool-start', toolName: 'remember_note', args: { text: 'pizza tonight' } };
      yield { type: 'tool-end', toolName: 'remember_note', result: { ok: true } };
      yield { type: 'text-delta', text: ' from' };
      yield { type: 'text-delta', text: ' the kitchen.' };
      yield { type: 'finish', reason: 'stop' };
    }
    const res = fakeRes();
    await openaiWire.respondStream(res, gen(), { model: 'daylight-house', logger: silentLogger });
    const blob = redact(res._state().writes.join(''));
    expect(blob).toBe(expected);
  });
});

describe('openaiWire.respondStream — invariants', () => {
  it('sets X-Accel-Buffering: no', async () => {
    async function* gen() { yield { type: 'finish', reason: 'stop' }; }
    const res = fakeRes();
    await openaiWire.respondStream(res, gen(), { model: 'daylight-house' });
    expect(res._state().headers['X-Accel-Buffering']).toBe('no');
  });

  it('does NOT emit tool-start / tool-end to the wire', async () => {
    async function* gen() {
      yield { type: 'text-delta', text: 'hi' };
      yield { type: 'tool-start', toolName: 'foo', args: {} };
      yield { type: 'tool-end', toolName: 'foo', result: { ok: true } };
      yield { type: 'finish', reason: 'stop' };
    }
    const res = fakeRes();
    await openaiWire.respondStream(res, gen(), { model: 'daylight-house' });
    const blob = res._state().writes.join('');
    expect(blob).not.toMatch(/tool-start|tool-end|tool_start|tool_end/);
  });

  it('terminates with data: [DONE]', async () => {
    async function* gen() { yield { type: 'finish', reason: 'stop' }; }
    const res = fakeRes();
    await openaiWire.respondStream(res, gen(), { model: 'daylight-house' });
    const blob = res._state().writes.join('');
    expect(blob.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('mid-stream error emits content delta with finish_reason: error and still ends with [DONE]', async () => {
    async function* gen() {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('upstream broke');
    }
    const res = fakeRes();
    await openaiWire.respondStream(res, gen(), { model: 'daylight-house', logger: silentLogger });
    const blob = res._state().writes.join('');
    expect(blob).toMatch(/upstream broke/);
    expect(blob).toMatch(/"finish_reason":"error"/);
    expect(blob.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('stops iterating when client closes connection', async () => {
    let yielded = 0;
    async function* gen() {
      while (true) {
        yielded++;
        yield { type: 'text-delta', text: '.' };
        await new Promise((r) => setTimeout(r, 5));
        if (yielded > 100) throw new Error('iterator should have been stopped by close');
      }
    }
    const res = fakeRes();
    const promise = openaiWire.respondStream(res, gen(), { model: 'daylight-house' });
    await new Promise((r) => setTimeout(r, 15));
    res._triggerClose();
    await promise;
    expect(yielded).toBeLessThan(100);
  });
});

describe('openaiWire.respondError', () => {
  it('400 for bad request', () => {
    const res = fakeRes();
    openaiWire.respondError(res, new Error('messages required'), { isPreflight: true });
    const { status, jsonBody } = res._state();
    expect(status).toBe(400);
    expect(jsonBody.error.code).toBe('bad_request');
  });

  it('502 for upstream errors', () => {
    const res = fakeRes();
    openaiWire.respondError(res, new Error('mastra failed'));
    const { status, jsonBody } = res._state();
    expect(status).toBe(502);
    expect(jsonBody.error.code).toBe('upstream_unavailable');
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.test.mjs
```

- [ ] **Step 4: Implement**

```javascript
// backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.mjs
import crypto from 'node:crypto';

/**
 * OpenAI Chat Completions wire format.
 *
 * Request:  { messages, model, stream, conversation_id?, conversationId? }
 *           messages is the orchestrator "input" — preserved as an array.
 *           Other fields go into context.
 *
 * Sync response:   chat.completion envelope
 * Stream response: opening role chunk → content-delta chunks (tool events SUPPRESSED) →
 *                  closing finish_reason chunk → data: [DONE]\n\n
 *
 * Mirrors the legacy OpenAIChatCompletionsTranslator byte-for-byte (Task 0
 * baseline).
 */

export function parseRequest(req) {
  const body = req?.body ?? {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return {
    input: messages,
    context: {
      model: body.model ?? 'daylight-house',
      stream: !!body.stream,
      conversationId: body.conversation_id ?? body.conversationId ?? null,
      tools: body.tools ?? [],
    },
  };
}

export function respondSync(res, result, { model = 'daylight-house' } = {}) {
  const envelope = buildEnvelope(result, model);
  res.status(200).json(envelope);
}

export async function respondStream(res, asyncIter, { model = 'daylight-house', logger } = {}) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const send = (chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);

  let closed = false;
  res.on('close', () => { closed = true; });

  // Opening chunk — assistant role
  send({
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta: { role: 'assistant' } }],
  });

  let finishReason = 'stop';
  let errored = false;
  try {
    for await (const part of asyncIter) {
      if (closed) break;
      if (part.type === 'text-delta' && part.text) {
        send({
          id, object: 'chat.completion.chunk', created, model,
          choices: [{ index: 0, delta: { content: part.text } }],
        });
      } else if (part.type === 'finish') {
        finishReason = part.reason ?? 'stop';
      }
      // type === 'tool-start' / 'tool-end' intentionally suppressed (HA Voice Spec §7.2)
    }
  } catch (error) {
    errored = true;
    logger?.error?.('agents.openai.stream.error', { error: error.message });
    if (!closed) {
      send({
        id, object: 'chat.completion.chunk', created, model,
        choices: [{ index: 0, delta: { content: ` (error: ${error.message})` }, finish_reason: 'error' }],
      });
    }
  }

  if (!closed && !errored) {
    send({
      id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    });
  }

  if (!closed) res.write('data: [DONE]\n\n');
  res.end();
}

export function respondError(res, err, { isPreflight = false } = {}) {
  const message = err?.message ?? String(err);
  if (isPreflight || /messages required|invalid_request/i.test(message)) {
    return res.status(400).json({ error: { message, type: 'invalid_request_error', code: 'bad_request' } });
  }
  return res.status(502).json({ error: { message, type: 'server_error', code: 'upstream_unavailable' } });
}

function buildEnvelope(result, model) {
  const content = result?.output ?? '';
  const toolCalls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
  const usage = result?.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      finish_reason: 'stop',
    }],
    usage,
  };
}

export default {
  name: 'openai-chat-completions',
  parseRequest,
  respondSync,
  respondStream,
  respondError,
};
```

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.test.mjs
```

The golden-master test is the gate. If it fails, the wire format is byte-divergent from the captured baseline — adjust the implementation, NOT the baseline.

- [ ] **Step 6: Wire up the new format in `mountAgentHttp.mjs`**

In `mountAgentHttp.mjs`:

```javascript
import nativeWire from './wireFormats/native.mjs';
import openaiWire from './wireFormats/openaiChatCompletions.mjs';

const WIRE_FORMATS = {
  native: nativeWire,
  'openai-chat-completions': openaiWire,
};

// ... mountAgentHttp body unchanged at top ...

  if (wireFormat === 'native') {
    mountNative({ ... });
    return;
  }
  if (wireFormat === 'openai-chat-completions') {
    mountOpenAI({ app, mountPath, agentId, orchestrator, wire, authMiddleware, contextExtractor, logger });
    return;
  }

  throw new Error(`mountAgentHttp: unknown wireFormat '${wireFormat}'`);
}

function mountOpenAI({ app, mountPath, agentId, orchestrator, wire, authMiddleware, contextExtractor, logger }) {
  const router = express.Router();
  for (const mw of authMiddleware) router.use(mw);

  // POST /chat/completions — single endpoint, branches on body.stream
  router.post('/chat/completions', async (req, res) => {
    let parsed;
    try {
      parsed = wire.parseRequest(req);
    } catch (err) {
      return wire.respondError(res, err, { isPreflight: true });
    }
    const { input: messages, context: wireContext } = parsed;
    if (!messages || messages.length === 0) {
      return wire.respondError(res, new Error('messages required'), { isPreflight: true });
    }
    const merged = mergeContext(wireContext, contextExtractor, req);

    if (wireContext.stream) {
      // Stream — use orchestrator.streamExecute. Input is an array of OpenAI
      // messages; the agent must accept this shape (concierge does — see
      // ConciergeAgent.streamChat). Other agents wired with this format will
      // need to do the same.
      try {
        const iter = orchestrator.streamExecute(agentId, messages, merged);
        await wire.respondStream(res, iter, { model: wireContext.model, logger });
      } catch (err) {
        // Pre-stream error
        wire.respondError(res, err);
      }
      return;
    }

    // Non-stream
    try {
      logger.info?.('agents.openai.run.request', { agentId, model: wireContext.model });
      const result = await orchestrator.run(agentId, messages, merged);
      wire.respondSync(res, result, { model: wireContext.model });
    } catch (err) {
      logger.error?.('agents.openai.run.error', { agentId, error: err.message });
      wire.respondError(res, err);
    }
  });

  // GET /models — advertised model list (used by HA Voice's discovery probe)
  // Keep this here rather than in a separate file — it's HA-Voice-coupled,
  // openai-wire-coupled, and trivial. Configurable via `advertisedModels`.
  router.get('/models', (_req, res) => {
    const models = opts.advertisedModels ?? ['daylight-house', 'gpt-4o-mini'];
    const created = Math.floor(Date.now() / 1000);
    res.status(200).json({
      object: 'list',
      data: models.map((id) => ({ id, object: 'model', created, owned_by: 'daylight' })),
    });
  });

  app.use(mountPath, router);
  logger.info?.('agents.http.mounted', { agentId, mountPath, wireFormat: 'openai-chat-completions' });
}
```

CRITICAL: The reference to `opts.advertisedModels` inside `mountOpenAI` requires threading through the function args. Update the function signature to take `advertisedModels` and update the `mountAgentHttp` dispatch accordingly:

```javascript
export function mountAgentHttp(app, opts) {
  const {
    orchestrator, agentId, mountPath, wireFormat,
    authMiddleware = [], contextExtractor = null,
    advertisedModels,        // NEW
    logger = console,
  } = opts;
  // ... existing checks ...
  if (wireFormat === 'openai-chat-completions') {
    mountOpenAI({ app, mountPath, agentId, orchestrator, wire, authMiddleware, contextExtractor, advertisedModels, logger });
    return;
  }
  // ... etc
}
```

- [ ] **Step 7: Add a mountAgentHttp(openai) integration test**

```javascript
// backend/src/4_api/v1/agents/mountAgentHttp.openai.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mountAgentHttp } from './mountAgentHttp.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function startServer(app) {
  return new Promise((r) => { const s = app.listen(0, () => r({ server: s, port: s.address().port })); });
}
function postJson(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ method: 'POST', hostname: 'localhost', port, path, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let buf = ''; res.on('data', (c) => buf += c.toString());
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null, headers: res.headers }));
    });
    r.on('error', reject); r.write(JSON.stringify(body)); r.end();
  });
}

describe('mountAgentHttp(openai-chat-completions)', () => {
  it('POST /chat/completions non-stream returns chat.completion envelope', async () => {
    const orchestrator = {
      run: vi.fn(async () => ({ output: 'hi.', toolCalls: [], usage: null })),
      streamExecute: vi.fn(),
      runInBackground: vi.fn(),
      has: () => true,
    };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, {
      orchestrator, agentId: 'concierge', mountPath: '/v1',
      wireFormat: 'openai-chat-completions', logger: silentLogger,
    });
    const { server, port } = await startServer(app);
    try {
      const r = await postJson(port, '/v1/chat/completions', {
        model: 'daylight-house',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      });
      expect(r.status).toBe(200);
      expect(r.body.object).toBe('chat.completion');
      expect(r.body.choices[0].message.content).toBe('hi.');
    } finally { server.close(); }
  });

  it('returns 400 when messages missing', async () => {
    const orchestrator = { run: vi.fn(), streamExecute: vi.fn(), runInBackground: vi.fn(), has: () => true };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, {
      orchestrator, agentId: 'concierge', mountPath: '/v1',
      wireFormat: 'openai-chat-completions', logger: silentLogger,
    });
    const { server, port } = await startServer(app);
    try {
      const r = await postJson(port, '/v1/chat/completions', { stream: false });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('bad_request');
    } finally { server.close(); }
  });

  it('GET /models returns advertised list', async () => {
    const orchestrator = { run: vi.fn(), streamExecute: vi.fn(), runInBackground: vi.fn(), has: () => true };
    const app = express(); app.use(express.json());
    mountAgentHttp(app, {
      orchestrator, agentId: 'concierge', mountPath: '/v1',
      wireFormat: 'openai-chat-completions',
      advertisedModels: ['daylight-house'],
      logger: silentLogger,
    });
    const { server, port } = await startServer(app);
    try {
      const r = await new Promise((resolve, reject) => {
        const req = http.request({ method: 'GET', hostname: 'localhost', port, path: '/v1/models' }, (res) => {
          let buf = ''; res.on('data', (c) => buf += c.toString());
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
        });
        req.on('error', reject); req.end();
      });
      expect(r.status).toBe(200);
      expect(r.body.data.map((m) => m.id)).toEqual(['daylight-house']);
    } finally { server.close(); }
  });
});
```

- [ ] **Step 8: Run; pass all tests**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  backend/src/4_api/v1/agents/ \
  tests/isolated/api/
```

- [ ] **Step 9: Commit**

```bash
git add backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.mjs \
        backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.test.mjs \
        backend/src/4_api/v1/agents/mountAgentHttp.mjs \
        backend/src/4_api/v1/agents/mountAgentHttp.openai.test.mjs
git commit -m "$(cat <<'EOF'
feat(agents): wireFormats/openaiChatCompletions + mountAgentHttp openai branch

Plan / Phase 3 Task 7. Second wire-format preset for mountAgentHttp,
mirroring the legacy OpenAIChatCompletionsTranslator byte-for-byte
(verified via Task 0 baseline). Tool-start / tool-end events from
the orchestrator stream are SUPPRESSED on the wire (HA Voice spec
§7.2). data: [DONE] terminator preserved. X-Accel-Buffering header
preserved.

mountAgentHttp now handles both 'native' and 'openai-chat-completions'
wire formats. The openai branch exposes a single POST /chat/completions
endpoint plus GET /models.

Translator + concierge router are still mounted at this point; Task 8
swings the actual mount over.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Extract `satelliteBearerAuth` middleware + migrate concierge

The bearer-token auth currently lives inline inside `createConciergeRouter`. Extract it as a standalone middleware factory, then swing concierge over to `mountAgentHttp(openai-chat-completions)`.

**Files:**
- Create: `backend/src/4_api/v1/agents/middlewares/satelliteBearerAuth.mjs`
- Create: `backend/src/4_api/v1/agents/middlewares/satelliteBearerAuth.test.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` (`createConciergeServices` returns components, not router)
- Modify: `backend/src/app.mjs` (call `mountAgentHttp(openai)` instead of mounting the legacy router)
- Delete: `backend/src/4_api/v1/routers/concierge.mjs`
- Delete: `backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs`
- Delete: `backend/tests/unit/api/routers/concierge.test.mjs` (superseded)
- Delete: `backend/tests/unit/api/translators/OpenAIChatCompletionsTranslator.test.mjs` (superseded)

- [ ] **Step 1: Write failing middleware test**

```javascript
// backend/src/4_api/v1/agents/middlewares/satelliteBearerAuth.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { satelliteBearerAuth } from './satelliteBearerAuth.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function fakeRes() {
  let status = 200; let jsonBody = null;
  return {
    status(s) { status = s; return this; },
    json(b) { jsonBody = b; return this; },
    _state: () => ({ status, jsonBody }),
  };
}

describe('satelliteBearerAuth', () => {
  it('returns 401 when Authorization header missing', async () => {
    const mw = satelliteBearerAuth({ satelliteRegistry: { findByToken: vi.fn() }, logger: silentLogger });
    const req = { headers: {}, ip: '1.2.3.4' };
    const res = fakeRes();
    await mw(req, res, () => { throw new Error('next should not be called'); });
    expect(res._state().status).toBe(401);
    expect(res._state().jsonBody.error.code).toBe('missing_token');
  });

  it('returns 401 when Authorization is not Bearer', async () => {
    const mw = satelliteBearerAuth({ satelliteRegistry: { findByToken: vi.fn() }, logger: silentLogger });
    const req = { headers: { authorization: 'Basic xyz' }, ip: '1.2.3.4' };
    const res = fakeRes();
    await mw(req, res, () => { throw new Error('next should not be called'); });
    expect(res._state().status).toBe(401);
  });

  it('returns 401 when token is invalid', async () => {
    const findByToken = vi.fn(async () => null);
    const mw = satelliteBearerAuth({ satelliteRegistry: { findByToken }, logger: silentLogger });
    const req = { headers: { authorization: 'Bearer bad' }, ip: '1.2.3.4' };
    const res = fakeRes();
    await mw(req, res, () => { throw new Error('next should not be called'); });
    expect(res._state().status).toBe(401);
    expect(res._state().jsonBody.error.code).toBe('invalid_token');
    expect(findByToken).toHaveBeenCalledWith('bad');
  });

  it('attaches req.satellite and calls next on valid token', async () => {
    const sat = { id: 'kitchen', area: 'kitchen', allowedSkills: ['memory'] };
    const findByToken = vi.fn(async (t) => (t === 'good' ? sat : null));
    const mw = satelliteBearerAuth({ satelliteRegistry: { findByToken }, logger: silentLogger });
    const req = { headers: { authorization: 'Bearer good' }, ip: '1.2.3.4' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(req.satellite).toBe(sat);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```javascript
// backend/src/4_api/v1/agents/middlewares/satelliteBearerAuth.mjs

/**
 * Bearer-token auth middleware that resolves to a satellite via
 * ISatelliteRegistry. On success: attaches `req.satellite` and calls next().
 * On failure: 401 with OpenAI-style error envelope.
 *
 * Extracted from the legacy createConciergeRouter (which inlined this).
 */
export function satelliteBearerAuth({ satelliteRegistry, logger = console } = {}) {
  if (!satelliteRegistry?.findByToken) {
    throw new Error('satelliteBearerAuth: satelliteRegistry.findByToken required');
  }

  return async function bearerAuth(req, res, next) {
    const auth = req.headers.authorization || req.headers.Authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      logger.warn?.('agents.openai.auth.failed', { code: 'missing_token', ip: req.ip });
      return res.status(401).json({ error: { message: 'missing_token', type: 'auth', code: 'missing_token' } });
    }
    const token = auth.slice(7).trim();
    const satellite = await satelliteRegistry.findByToken(token);
    if (!satellite) {
      logger.warn?.('agents.openai.auth.failed', { code: 'invalid_token', ip: req.ip, token_prefix: token.slice(0, 6) });
      return res.status(401).json({ error: { message: 'invalid_token', type: 'auth', code: 'invalid_token' } });
    }
    req.satellite = satellite;
    next();
  };
}

export default satelliteBearerAuth;
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/4_api/v1/agents/middlewares/satelliteBearerAuth.test.mjs
```

- [ ] **Step 5: Refactor `createConciergeServices` in bootstrap.mjs**

The function currently returns a router built via `createConciergeRouter`. After Phase 2 the orchestrator already has `concierge` registered. Now `createConciergeServices` should just return the satellite registry + advertised models (everything else is owned by the shared orchestrator):

Locate the function (around line 3204) and replace its tail:

```javascript
// OLD
const router = createConciergeRouter({
  satelliteRegistry: conciergeSatelliteRegistry,
  chatCompletionRunner: conciergeApp,
  logger: logger.child({ component: 'router' }),
  mediaLogsDir,
});
logger.info?.('concierge.mounted', { path: '/v1', skills: conciergeSkills.map(s => s.name) });
return router;
```

with:

```javascript
// NEW
return {
  satelliteRegistry: conciergeSatelliteRegistry,
  advertisedModels: conciergeConfig?.advertised_models ?? ['daylight-house', 'gpt-4o-mini'],
  // mediaLogsDir is no longer needed at HTTP level — transcripts are
  // written by the orchestrator after Phase 2.
};
```

NOTE: After Phase 2, `ConciergeApplication`, `ConciergeAgent.runChat`, and the `chatCompletionRunner` plumbing are already gone — `concierge` is a regular agent in the orchestrator. If Phase 2 hasn't fully converted concierge yet at the time of writing this task, leave the `ConciergeApplication` plumbing in place but DON'T mount it as a router; instead expose it on the returned object so app.mjs can route around it. (This is unlikely — Phase 3 should not start before Phase 2 is complete. If the working tree disagrees, stop and revisit.)

Also remove the unused import:

```javascript
// DELETE
const { createConciergeRouter } = await import('#api/v1/routers/concierge.mjs');
```

- [ ] **Step 6: Update `app.mjs` to call `mountAgentHttp(openai)`**

Read the existing block:

```bash
cd /opt/Code/DaylightStation && sed -n '2343,2362p' backend/src/app.mjs
```

Replace:

```javascript
// OLD
try {
  const conciergeRouter = await createConciergeServices({ ... });
  app.use('/v1', conciergeRouter);
} catch (error) {
  rootLogger.error('concierge.mount_failed', { ... });
}
```

with:

```javascript
// NEW
try {
  const conciergeServices = await createConciergeServices({ ... });

  const bearerAuth = satelliteBearerAuth({
    satelliteRegistry: conciergeServices.satelliteRegistry,
    logger: rootLogger.child({ module: 'concierge-auth' }),
  });

  mountAgentHttp(app, {
    orchestrator: agentsServices.orchestrator,
    agentId: 'concierge',
    mountPath: '/v1',
    wireFormat: 'openai-chat-completions',
    authMiddleware: [bearerAuth],
    contextExtractor: (req) => ({
      satellite: req.satellite,
      conversationId: req.body?.conversation_id ?? req.body?.conversationId ?? null,
    }),
    advertisedModels: conciergeServices.advertisedModels,
    logger: rootLogger.child({ module: 'agents/concierge' }),
  });
} catch (error) {
  rootLogger.error('concierge.mount_failed', { error: error.message, stack: error.stack });
}
```

Add the imports near the top:

```javascript
import { mountAgentHttp } from './4_api/v1/agents/mountAgentHttp.mjs';
import { satelliteBearerAuth } from './4_api/v1/agents/middlewares/satelliteBearerAuth.mjs';
```

- [ ] **Step 7: Run all tests + smoke**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  backend/src/4_api/v1/agents/ \
  tests/isolated/api/ \
  tests/isolated/agents/

# After deploy or in dev:
# Sync (no auth — should 401)
curl -X POST http://localhost:3111/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}],"stream":false}'

# Sync with bearer (replace TOKEN with actual satellite token)
curl -X POST http://localhost:3111/v1/chat/completions \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer TOKEN' \
  -d '{"messages":[{"role":"user","content":"hi"}],"stream":false}'

# Stream
curl -N -X POST http://localhost:3111/v1/chat/completions \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer TOKEN' \
  -d '{"messages":[{"role":"user","content":"hi"}],"stream":true}' | head -10

# Models
curl -s http://localhost:3111/v1/models -H 'Authorization: Bearer TOKEN' | jq
```

The streaming response shape MUST match the captured baseline (after id/created redaction). If it doesn't, debug — don't ship.

- [ ] **Step 8: Delete the legacy concierge files**

```bash
cd /opt/Code/DaylightStation
git rm backend/src/4_api/v1/routers/concierge.mjs
git rm backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs
git rm backend/tests/unit/api/routers/concierge.test.mjs
git rm backend/tests/unit/api/translators/OpenAIChatCompletionsTranslator.test.mjs
```

Verify nothing else imports them:

```bash
grep -rn "createConciergeRouter\|OpenAIChatCompletionsTranslator" backend/ tests/ | grep -v node_modules
```

Should be empty.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(agents): concierge mount via mountAgentHttp(openai); delete translator

Plan / Phase 3 Task 8. Concierge HTTP surface unified onto the same
helper as native agents. Bearer auth extracted to a reusable
middleware factory (satelliteBearerAuth). createConciergeServices
returns components, not a router; app.mjs calls mountAgentHttp once.

createConciergeRouter, OpenAIChatCompletionsTranslator, and their
tests deleted. The wire-format module
(wireFormats/openaiChatCompletions.mjs) plus the captured baseline
in tests/isolated/api/agents/_baselines/ guarantee byte-for-byte
preservation against HA Voice clients.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Live HA-Voice synthetic smoke test

Phase 3's biggest risk is breaking real HA Voice satellites. Build a synthetic curl invocation that mimics what HA Voice actually sends, capture the SSE response, and compare against the Task 0 baseline (after redaction).

**Files:**
- Create: `tests/live/agents/concierge-openai-wire.smoke.mjs` — runnable script, not a vitest file (we don't have HA Voice in unit-test land; this exercises the deployed instance)

- [ ] **Step 1: Look up a valid satellite token**

```bash
# In the deployed container — find the kitchen satellite token (used by HA Voice)
sudo docker exec daylight-station sh -c 'cat data/household/config/concierge.yml | head -40' | grep -E 'token|id:|area:'
```

Grab the bearer token from the kitchen satellite entry (it's stored either inline in concierge.yml or in Infisical-resolved secret form). Note the value but DO NOT commit it.

- [ ] **Step 2: Write the smoke script**

```javascript
#!/usr/bin/env node
// tests/live/agents/concierge-openai-wire.smoke.mjs

/**
 * Live smoke test against the deployed /v1/chat/completions endpoint.
 *
 * Posts the exact request shape HA Voice satellites send, captures the
 * SSE stream, redacts non-deterministic fields, and compares against the
 * baseline.
 *
 * Usage:
 *   CONCIERGE_HOST=http://localhost:3111 \
 *   CONCIERGE_TOKEN=<kitchen-satellite-token> \
 *     node tests/live/agents/concierge-openai-wire.smoke.mjs
 *
 * Exit code 0 on baseline match, 1 on mismatch.
 */
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

const HOST = process.env.CONCIERGE_HOST || 'http://localhost:3111';
const TOKEN = process.env.CONCIERGE_TOKEN;
if (!TOKEN) {
  console.error('CONCIERGE_TOKEN env var required');
  process.exit(2);
}

const url = new URL('/v1/chat/completions', HOST);
const reqBody = JSON.stringify({
  model: 'daylight-house',
  stream: true,
  messages: [
    { role: 'system', content: 'You are a household assistant.' },
    { role: 'user', content: 'Remind me to order pizza tonight.' },
  ],
});

const req = (url.protocol === 'https:' ? httpsRequest : request)({
  method: 'POST',
  hostname: url.hostname,
  port: url.port || (url.protocol === 'https:' ? 443 : 80),
  path: url.pathname,
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(reqBody),
    'Authorization': `Bearer ${TOKEN}`,
  },
}, (res) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => {
    const blob = Buffer.concat(chunks).toString();
    // Redact non-deterministic fields the same way the baseline did
    const redacted = blob
      .replace(/"id":"chatcmpl-[^"]+"/g, '"id":"chatcmpl-{UUID}"')
      .replace(/"created":\d+/g, '"created":{TS}')
      // Concierge has variable text content; for shape-only comparison we
      // assert structural invariants instead of byte equality on the live
      // response. (The unit test in Task 7 covers byte equality with
      // controlled fixtures.)
      ;
    const expectations = [
      { pattern: /"object":"chat\.completion\.chunk"/, label: 'chunk envelope present' },
      { pattern: /"delta":\{"role":"assistant"\}/, label: 'opening assistant role chunk' },
      { pattern: /"delta":\{"content":/, label: 'at least one content delta' },
      { pattern: /"finish_reason":"(stop|error)"/, label: 'closing finish_reason' },
      { pattern: /data: \[DONE\]\n\n$/, label: 'terminator [DONE]' },
    ];
    const negations = [
      { pattern: /tool-start|tool_start/, label: 'no tool-start emission' },
      { pattern: /tool-end|tool_end/, label: 'no tool-end emission' },
    ];
    let failed = 0;
    for (const e of expectations) {
      if (!e.pattern.test(redacted)) { console.error(`MISSING: ${e.label}`); failed++; }
      else console.log(`OK: ${e.label}`);
    }
    for (const n of negations) {
      if (n.pattern.test(redacted)) { console.error(`UNEXPECTED: ${n.label}`); failed++; }
      else console.log(`OK: ${n.label}`);
    }
    console.log(`\nstatus=${res.statusCode} content-type=${res.headers['content-type']}`);
    console.log(`x-accel-buffering=${res.headers['x-accel-buffering']}`);
    if (res.headers['x-accel-buffering'] !== 'no') {
      console.error('MISSING: X-Accel-Buffering: no header');
      failed++;
    }
    process.exit(failed > 0 ? 1 : 0);
  });
});
req.on('error', (err) => { console.error('request error', err); process.exit(2); });
req.write(reqBody);
req.end();
```

- [ ] **Step 3: Run the smoke against the deployed instance**

```bash
cd /opt/Code/DaylightStation
CONCIERGE_HOST=http://localhost:3111 \
CONCIERGE_TOKEN=<token-from-step-1> \
  node tests/live/agents/concierge-openai-wire.smoke.mjs
```

Expected output: every expectation `OK`, every negation `OK`, exit code 0.

If anything fails:
- `MISSING: opening assistant role chunk` → wireFormats/openaiChatCompletions.mjs is dropping the opening chunk; debug
- `UNEXPECTED: no tool-start emission` → suppression broke; the orchestrator stream is producing tool events and the wire format isn't filtering them
- `MISSING: X-Accel-Buffering: no header` → header missing on the response; either nginx is stripping it (operational issue, not code) or the wire format isn't setting it

DO NOT modify the script's expectations to match a regression — fix the wire format until expectations pass.

- [ ] **Step 4: Run the same smoke from outside the host (real HA Voice path)**

```bash
# From a host that's NOT the docker host — simulates real HA Voice traffic
CONCIERGE_HOST=https://daylight.kckern.net \
CONCIERGE_TOKEN=<kitchen-satellite-token> \
  node tests/live/agents/concierge-openai-wire.smoke.mjs
```

Expected: same OK/OK output. If `X-Accel-Buffering: no` is missing here but present locally, NPM (the reverse proxy) may be stripping it — that's not a code issue but is operationally important to flag.

- [ ] **Step 5: Add the script to the live-test runner if applicable**

Check if `tests/live/agents/` is run by `npm run test:live`. If yes, the file extension and naming convention need to match the harness; if no, document the manual invocation in a comment at the top.

- [ ] **Step 6: Commit**

```bash
git add tests/live/agents/concierge-openai-wire.smoke.mjs
git commit -m "$(cat <<'EOF'
test(agents): live smoke for concierge OpenAI wire shape

Plan / Phase 3 Task 9. Posts a realistic HA-Voice-style request to
the deployed /v1/chat/completions and asserts the SSE stream has the
required shape: chunk envelope, opening role, content deltas, closing
finish_reason, [DONE] terminator, X-Accel-Buffering header, and NO
tool-start/tool-end emissions. Run manually with CONCIERGE_HOST +
CONCIERGE_TOKEN env vars.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: (Optional) Concierge dual-mount — native + openai

If we want to be able to test concierge from in-app (without a satellite token), we can mount it under BOTH wire formats: `mountAgentHttp(native)` at `/api/v1/agents/concierge` AND `mountAgentHttp(openai-chat-completions)` at `/v1`. The helper supports stacking — same agent, different mounts.

This is purely additive; skip it if there's no concrete need for in-app concierge testing at this time.

**Files:**
- Modify: `backend/src/app.mjs`

- [ ] **Step 1: Decide whether to ship**

Check if there's any in-app surface that wants to call concierge directly without going through HA Voice. As of Phase 3 there is NOT — concierge is HA-Voice-only. But future plans may want a debug surface (e.g., `/api/v1/agents/concierge/run` accessible via a simple curl with the standard Daylight token).

If unclear, default to NOT shipping this — easier to add later than to undo.

- [ ] **Step 2 (if shipping): Add a second mount in app.mjs**

After the existing `mountAgentHttp(openai)` block for concierge:

```javascript
// Native mount for in-app debugging — protected by the standard household
// auth middleware (composed at the app level outside mountAgentHttp). Skip
// if you don't want this exposure.
mountAgentHttp(app, {
  orchestrator: agentsServices.orchestrator,
  agentId: 'concierge',
  mountPath: '/api/v1/agents',
  wireFormat: 'native',
  logger: rootLogger.child({ module: 'agents/concierge-native' }),
});
```

The agent already responds to both invocations — the mount is purely an HTTP-routing concern. The native mount goes through the standard `/api/v1/agents` permission gate; the openai mount uses bearer auth.

- [ ] **Step 3 (if shipping): Live smoke**

```bash
# In-app native run
curl -X POST http://localhost:3111/api/v1/agents/concierge/run \
  -H 'Content-Type: application/json' \
  -d '{"input":[{"role":"user","content":"remind me to order pizza"}]}'
```

NOTE: concierge's "input" is an array of OpenAI-style messages, not a string. The native wire's `parseRequest` returns whatever's in `body.input` — this works as long as the agent's `run` method accepts array-shaped inputs (concierge's does, post-Phase-2).

- [ ] **Step 4 (if shipping): Commit**

```bash
git add backend/src/app.mjs
git commit -m "$(cat <<'EOF'
feat(agents): concierge dual-mount — native + openai

Plan / Phase 3 Task 10 (optional). Concierge now responds at both
/v1/chat/completions (HA Voice openai wire) and
/api/v1/agents/concierge/run (in-app native wire) — same agent, two
HTTP surfaces. Demonstrates that mountAgentHttp supports stacking
multiple mounts on the same agentId.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  tests/isolated/agents/ \
  tests/isolated/adapters/agents/ \
  tests/isolated/api/ \
  backend/src/4_api/v1/agents/ \
  backend/src/3_applications/agents/framework/
```

Expected: all green. Track the test count at this point — the post-Phase-3 baseline.

- [ ] **Step 2: Build the frontend (sanity that nothing imports a deleted backend file)**

```bash
cd /opt/Code/DaylightStation && npm run build 2>&1 | tail -30
```

Expected: clean build. The frontend doesn't import backend files directly, but the build script may reference paths that have moved.

- [ ] **Step 3: Live smoke against deployed instance — every wire format, every endpoint**

```bash
# Native wire — sync, stream, background, memory, listing, assignments
curl -s http://localhost:3111/api/v1/agents | jq '.agents | length'
curl -s -X POST http://localhost:3111/api/v1/agents/echo/run -H 'Content-Type: application/json' -d '{"input":"hi"}'
curl -N -X POST http://localhost:3111/api/v1/agents/echo/run-stream -H 'Content-Type: application/json' -d '{"input":"hi"}' | head -10
curl -s -X POST http://localhost:3111/api/v1/agents/echo/run-background -H 'Content-Type: application/json' -d '{"input":"hi"}'
curl -s http://localhost:3111/api/v1/agents/echo/memory/kckern
curl -s http://localhost:3111/api/v1/agents/health-coach/assignments

# OpenAI wire — sync, stream, models
curl -s http://localhost:3111/v1/models -H 'Authorization: Bearer <token>' | jq
curl -X POST http://localhost:3111/v1/chat/completions \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}],"stream":false}' | jq
curl -N -X POST http://localhost:3111/v1/chat/completions \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}],"stream":true}' | head -10
```

All must succeed.

- [ ] **Step 4: Run the live HA-Voice smoke (Task 9)**

```bash
CONCIERGE_HOST=http://localhost:3111 \
CONCIERGE_TOKEN=<kitchen-satellite-token> \
  node tests/live/agents/concierge-openai-wire.smoke.mjs
```

Expected: exit code 0, every assertion `OK`.

- [ ] **Step 5: Confirm the file structure matches the plan**

```bash
cd /opt/Code/DaylightStation && ls backend/src/4_api/v1/agents/
# Expected:
#   createAgentMemoryRouter.mjs
#   createAgentMemoryRouter.test.mjs
#   createAgentMetaRouter.mjs
#   createAgentMetaRouter.test.mjs
#   middlewares/
#     satelliteBearerAuth.mjs
#     satelliteBearerAuth.test.mjs
#   mountAgentHttp.mjs
#   mountAgentHttp.openai.test.mjs
#   mountAgentHttp.test.mjs
#   wireFormats/
#     native.mjs
#     native.test.mjs
#     openaiChatCompletions.mjs
#     openaiChatCompletions.test.mjs

ls backend/src/4_api/v1/routers/ | grep -E 'agents|concierge'
# Expected: nothing (all deleted)

ls backend/src/4_api/v1/translators/ 2>/dev/null
# Expected: empty or directory missing
```

- [ ] **Step 6: Final empty commit marking Phase 3 complete**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore(agents): Phase 3 HTTP unification complete

Six legacy HTTP files removed:
- backend/src/4_api/v1/routers/agents.mjs
- backend/src/4_api/v1/routers/agents-stream.mjs
- backend/src/4_api/v1/routers/concierge.mjs
- backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs
- backend/tests/unit/api/routers/concierge.test.mjs
- backend/tests/unit/api/translators/OpenAIChatCompletionsTranslator.test.mjs

Replaced by:
- backend/src/4_api/v1/agents/mountAgentHttp.mjs        (the helper)
- backend/src/4_api/v1/agents/wireFormats/native.mjs    (json+sse preset)
- backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.mjs
- backend/src/4_api/v1/agents/middlewares/satelliteBearerAuth.mjs
- backend/src/4_api/v1/agents/createAgentMetaRouter.mjs (listing+assignments)
- backend/src/4_api/v1/agents/createAgentMemoryRouter.mjs (memory CRUD)

Health-coach + echo + lifeplan-guide + paged-media-toc all mounted via
mountAgentHttp(native). Concierge mounted via
mountAgentHttp(openai-chat-completions) with satelliteBearerAuth.

HA Voice byte-exactness preserved: golden-master baseline captured in
tests/isolated/api/agents/_baselines/openai-chat-completions-sse.txt
guards the openai wire format. Live smoke
(tests/live/agents/concierge-openai-wire.smoke.mjs) verifies the
deployed instance.

Substrate ready for Phase 4 (frontend convergence).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| Audit finding | Phase 3 task | Status after Phase 3 |
|---|---|---|
| **§4A-1** Unified mountAgentHttp helper | Tasks 2 + 7 | Resolved |
| **DRY-H6** Two backend HTTP layers | Tasks 3 (native migration) + 8 (concierge migration) + 6 (delete legacy) | Resolved |
| **Q5** Concierge SSE compatibility | Tasks 0 (baseline capture), 7 (golden-master test), 9 (live smoke) | Verified |
| Tool-event suppression preserved | Task 7 (wire format) + Task 9 (live smoke negation) | Verified |
| X-Accel-Buffering header preserved | Tasks 1 + 7 (wire format unit tests) + Task 9 (live smoke) | Verified |
| res.on('close') disconnect handler | Tasks 1 + 7 (unit tests) | Verified |
| `done`/`error` SSE events on native | Task 1 (wire format) + Task 2 (mountAgentHttp test) | Preserved |
| `[DONE]` terminator on openai | Task 7 (golden-master test) + Task 9 (live smoke) | Preserved |
| Memory CRUD endpoints | Task 4 (extracted to createAgentMemoryRouter) | Resolved (mounted once, not per-agent) |
| Listing endpoint | Task 5 (extracted to createAgentMetaRouter) | Resolved |
| Assignments endpoints | Task 5 | Preserved |
| Bearer-token auth | Task 8 (satelliteBearerAuth middleware) | Resolved (now reusable) |
| `/run-background` | Task 2 (mountAgentHttp native branch) | Preserved |
| `/v1/models` discovery | Task 7 (mountAgentHttp openai branch) | Preserved |
| DRY-H7 frontend chat surfaces | — | Phase 4 |
| DRY-M4 SSE consumers | — | Phase 4 (lift parseSSE) |

---

## Notes for the implementer

- **HA Voice byte-exactness is NON-NEGOTIABLE.** Task 0 captures the baseline before any refactor; Task 7's golden-master test asserts the wire format produces an identical blob (after redaction); Task 9's live smoke verifies the deployed instance matches HA Voice's expectations. If Task 7 fails, fix the implementation, never the baseline.

- **`X-Accel-Buffering: no` MUST be present** on every SSE response. NPM (the reverse proxy) honors this header to disable response buffering. Without it, HA Voice clients may see chunks arrive in big bursts instead of token-by-token. Both wire formats set it; both have unit tests asserting the header is set.

- **`res.on('close')` disconnect handler MUST be preserved.** When a client disconnects mid-stream, the orchestrator's async iterator continues yielding chunks. Without the close handler, `res.write` is called on a closed socket — Node 24 emits "Cannot write after end" warnings (documented in earlier work on `agents-stream.mjs`). Both wire formats have `res.on('close', () => { closed = true; })` plus a `if (closed) break;` check before each write.

- **Tool-event suppression is concierge-specific.** The native wire MUST emit `tool-start`/`tool-end` (health-coach UI's `ToolCallAttribution` component depends on them). The openai wire MUST NOT emit them (HA Voice clients reject unknown SSE event types). The unit tests in Tasks 1 and 7 enforce both directions.

- **Concierge's input shape is an array of OpenAI messages, not a string.** Other native-wire agents use `body.input: string`. The `parseRequest` of the openai wire returns `input: messages` (array). The orchestrator's `run` and `streamExecute` methods accept whatever shape the agent's `run` accepts — concierge's agent (after Phase 2) accepts arrays. If a future agent gets mounted under both wire formats, its `run` method has to handle both shapes.

- **Express path-prefix routing is order-dependent.** Multiple routers under `/api/v1/agents` (mountAgentHttp per agent, createAgentMemoryRouter, createAgentMetaRouter) work because their path patterns don't overlap: per-agent has `/:agentId/run|run-stream|run-background`; meta has `/` and `/:agentId/assignments...`; memory has `/:agentId/memory/...`. Express tries each in registration order until one matches; routes that don't match fall through. If you add new routes that DO overlap (e.g., a per-agent route at `/:agentId/foo` plus a generic route at `/:agentId/:something`), Express will dispatch to whichever was registered first.

- **`mountAgentHttp` doesn't compose at app-level auth.** The standard Daylight household + token + permission middleware is composed at app level (`app.mjs:272-281`) and runs BEFORE any router. `authMiddleware` in `mountAgentHttp` runs AFTER the app-level pipeline but BEFORE the route handler — it's for additional auth (concierge's bearer auth replaces nothing; it adds to the request's resolved identity). For native agents, `authMiddleware` is empty by default; the standard pipeline is the only auth.

- **Don't mount the legacy `agents.mjs` and the new mounts simultaneously in production.** Task 3 keeps the legacy as a one-line temporary safety net for memory CRUD and listing. Tasks 4 + 5 move those to dedicated routers and Task 6 deletes the legacy. Don't ship a Docker build that has both — Express's first-match dispatch can route requests inconsistently when both routers serve the same path.

- **Don't abstract the openai wire format prematurely.** It might be tempting to design a generic "openai wire" that supports completions, embeddings, and assistants APIs. Resist. The audit's §4A-1 is specifically about /v1/chat/completions; HA Voice doesn't use anything else. If a second openai endpoint gets needed, factor it then.

- **The `advertisedModels` option threading.** `mountAgentHttp` passes it through to `mountOpenAI` which uses it in the `GET /models` handler. Don't forget to propagate it through the function signature when copying the implementation between tasks.

- **GET /models is openai-wire-specific.** It only makes sense for HA-Voice-like clients that probe model availability. If a future wire format needs a different discovery shape, add a discovery hook to the wire-format module instead of putting it in `mountAgentHttp`.

- **The test count after Phase 3.** Phase 1 ended at ~1530 tests. Phase 2 should add ~30. Phase 3 adds: Task 1 (~10), Task 2 (~7), Task 4 (~5), Task 5 (~5), Task 7 (~10), Task 8 (~5) = ~42 new tests. Phase 3 deletes: Task 6 (-3 in agents.runStream.test.mjs), Task 8 (-12 in concierge + translator legacy tests). Net: ~+27. Track the count to catch silent test losses.

- **Phase 4 (frontend convergence) doesn't depend on Phase 3.** Frontend convergence (DRY-H7, DRY-M4) can land before, after, or in parallel with Phase 3. They're independent files.

---

## What comes next (Phase 4 preview)

**Phase 4 — Frontend Convergence** (audit §7 step 10). After Phases 1–3:

- Lift `parseSSE` to `frontend/src/lib/sse/parseSSE.js` — single SSE reader for any agent stream
- Build `<AgentChatSurface agentId, userId, mentions?>` based on `Health/CoachChat` (assistant-ui primitives)
- Migrate `Health/CoachChat` to a thin wrapper passing health-specific `mentions` config
- Delete `frontend/src/modules/Chat/ChatPanel.jsx`, `Chat/useChatEngine.js` (broken — wrong URL prefix as flagged in audit Q4)
- Replace `Life/views/coach/CoachChat.jsx` with `<AgentChatSurface agentId='lifeplan-guide' />`
- (Optional) Add a debug `<AgentChatSurface agentId='concierge' />` page for testing concierge from the dashboard (depends on Phase 3 Task 10 dual-mount being shipped)
- Risk: frontend regression in the lifeplan view (currently broken, so blast radius is limited)
- Estimated tasks: ~8

After Phase 4, the audit's `DRY-H7` (three frontend chat surfaces) and `DRY-M4` (two SSE consumers) are resolved, and the agent framework convergence is functionally complete. Optional Phase 5 (declarative `agents.config.yml` registration) is a polish step that can land any time.
