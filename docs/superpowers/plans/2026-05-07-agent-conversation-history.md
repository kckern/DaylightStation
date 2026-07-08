# Agent Conversation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forward the full multi-turn message thread from the chat UI through to the LLM on every turn, so the agent has conversation memory. Currently the frontend extracts only the last message and ships a single `input` string per turn, leaving every assistant response context-blind. After this lands, follow-ups like *"what day was that?"*, *"i just told you"*, and *"the map widget"* work because the agent sees the prior turns.

**Architecture:**

The chat UI (assistant-ui) already manages thread state on the client. The fix is plumbing — three layers:

1. **Frontend** (`frontend/src/modules/Agent/runtime.js`) — extract the full `messages: [{role, content}]` array from the thread, cap to the last 20 messages, ship in the request body alongside `input` (kept for back-compat).
2. **Backend wire format** (`backend/src/4_api/v1/agents/wireFormats/native.mjs`) — parse `messages` from the body. When absent (cron, scheduled jobs, OpenAI-compat callers), synthesize a single-user-message array from `input`.
3. **Mastra adapter** (`backend/src/1_adapters/agents/MastraAdapter.mjs`) — pass the messages array to `mastraAgent.generate(messages)` and `mastraAgent.stream(messages)` instead of the bare input string. Mastra natively accepts message arrays; the system prompt continues to flow through `instructions`.

Server-side conversation persistence is **out of scope**. The client trust model is: assistant-ui carries the thread state; the server is stateless per turn. If we later need server persistence (for resumable threads, voice satellites, etc.), that's a separate plan.

**Hard cap:** last 20 messages (≈10 user + 10 assistant turns). Plenty for coaching depth; bounds token cost. Older history is dropped silently.

**Tech Stack:** assistant-ui ChatRuntimeProvider on the frontend, Mastra Agent on the backend, native SSE wire format.

---

## Exit criteria (verifiable end-to-end)

The plan is **not** done until this 4-turn UI conversation produces coherent multi-turn coaching. The smoke script POSTs to `/api/v1/agents/health-coach/run` with an explicit `messages` array (simulating the thread the UI sends):

```javascript
// Turn 4 of a 4-turn thread:
{
  input: "what day was that?",
  context: { userId: "user_1" },
  messages: [
    { role: "user",      content: "what was my hardest recent run?" },
    { role: "assistant", content: "Your hardest run was on May 2, 2026 — 45 minutes (+18.4% vs typical 38 min)." },
    { role: "user",      content: "what day was that?" },
  ]
}
```

Output text must:
1. Reference May 2 explicitly (or "Saturday" — May 2, 2026 is a Saturday)
2. Not contain "Could you clarify" / "what event are you referring to" / "specify which workout"
3. The agent should NOT call `query_events` for this turn — the answer is in the prior assistant turn

The smoke script encodes these as regex assertions and exits non-zero on fail.

---

## File structure

**Modified files:**

```
frontend/src/modules/Agent/runtime.js
  — extract full messages array from assistant-ui thread; cap to last 20; ship in body

backend/src/4_api/v1/agents/wireFormats/native.mjs
  — parse messages from body; synthesize from input if absent

backend/src/3_applications/agents/framework/AgentOrchestrator.mjs
  — thread messages through to runtime.execute / runtime.streamExecute

backend/src/3_applications/agents/framework/BaseAgent.mjs
  — runImpl signature accepts messages; passes through

backend/src/1_adapters/agents/MastraAdapter.mjs
  — execute({ messages, ... }) and streamExecute({ messages, ... }) call mastraAgent.generate/stream(messages)
```

**New tests:**

```
tests/isolated/agents/conversation_history/
  wire_format.test.mjs        — body parsing: messages + input fallback
  orchestrator_thread.test.mjs — orchestrator threads messages to runtime
  mastra_adapter.test.mjs      — adapter calls mastraAgent.generate(messages)
  frontend_runtime.test.js     — frontend ships messages array
  multi_turn_smoke.runtime.test.mjs — live HTTP smoke with explicit messages
```

---

## Task 1: Backend wire format — parse `messages` from body

**Files:**
- Modify: `backend/src/4_api/v1/agents/wireFormats/native.mjs`
- Create: `tests/isolated/agents/conversation_history/wire_format.test.mjs`

- [ ] **Step 1: Read the existing wire format**

```bash
cd /opt/Code/DaylightStation && cat backend/src/4_api/v1/agents/wireFormats/native.mjs
```

The current `parseRequest` returns `{ input, context }`. Add a `messages` field with the parsing rules:

- If `body.messages` is a non-empty array → use it as-is (after sanitization)
- If `body.messages` is missing / empty / not an array → synthesize `[{ role: 'user', content: body.input }]` IF `body.input` is a non-empty string, else empty array

Sanitization: each message must be `{ role: 'user'|'assistant'|'system', content: string }`. Drop entries with invalid roles or non-string content. Cap to last 20 entries.

- [ ] **Step 2: Write failing tests**

```javascript
// tests/isolated/agents/conversation_history/wire_format.test.mjs
import { describe, it, expect } from 'vitest';
import { parseRequest } from '../../../../backend/src/4_api/v1/agents/wireFormats/native.mjs';

const makeReq = (body) => ({ body });

describe('native wire format — parseRequest messages', () => {
  it('passes through a valid messages array', () => {
    const r = parseRequest(makeReq({
      input: 'last',
      context: { userId: 'user_1' },
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'last' },
      ],
    }));
    expect(r.messages).toHaveLength(3);
    expect(r.messages[0]).toEqual({ role: 'user', content: 'first' });
    expect(r.input).toBe('last');
  });

  it('synthesizes [user] from input when messages missing', () => {
    const r = parseRequest(makeReq({ input: 'hello', context: { userId: 'kc' } }));
    expect(r.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('synthesizes [user] from input when messages is empty array', () => {
    const r = parseRequest(makeReq({ input: 'hi', messages: [] }));
    expect(r.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('returns empty array when both input and messages are missing', () => {
    const r = parseRequest(makeReq({}));
    expect(r.messages).toEqual([]);
    expect(r.input).toBe(null);
  });

  it('drops messages with invalid roles', () => {
    const r = parseRequest(makeReq({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'frog', content: 'b' },        // invalid
        { role: 'assistant', content: 'c' },
      ],
    }));
    expect(r.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'c' },
    ]);
  });

  it('drops messages with non-string content', () => {
    const r = parseRequest(makeReq({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: { complex: 'shape' } },   // dropped
        { role: 'user', content: null },                    // dropped
        { role: 'assistant', content: 'b' },
      ],
    }));
    expect(r.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
  });

  it('caps to last 20 messages', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    const r = parseRequest(makeReq({ messages: many }));
    expect(r.messages).toHaveLength(20);
    expect(r.messages[0].content).toBe('m10');
    expect(r.messages[19].content).toBe('m29');
  });

  it('extracts text from content arrays (assistant-ui shape)', () => {
    const r = parseRequest(makeReq({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: '!' }] },
      ],
    }));
    expect(r.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello!' },
    ]);
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/conversation_history/wire_format.test.mjs
```

- [ ] **Step 4: Implement**

In `backend/src/4_api/v1/agents/wireFormats/native.mjs`, replace `parseRequest` with:

```javascript
const VALID_ROLES = new Set(['user', 'assistant', 'system']);
const MAX_MESSAGES = 20;

function extractContentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');
  }
  return null;
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    if (!VALID_ROLES.has(m.role)) continue;
    const text = extractContentText(m.content);
    if (typeof text !== 'string') continue;
    out.push({ role: m.role, content: text });
  }
  // Cap to last MAX_MESSAGES
  return out.length > MAX_MESSAGES ? out.slice(out.length - MAX_MESSAGES) : out;
}

export function parseRequest(req) {
  const body = req?.body || {};
  const input = body.input ?? null;
  let messages = sanitizeMessages(body.messages);
  if (messages.length === 0 && typeof input === 'string' && input.length > 0) {
    messages = [{ role: 'user', content: input }];
  }
  return {
    input,
    context: body.context ?? {},
    messages,
  };
}
```

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/conversation_history/wire_format.test.mjs
```

Expected: 7 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/4_api/v1/agents/wireFormats/native.mjs \
  tests/isolated/agents/conversation_history/wire_format.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): wire format parses messages array with input fallback

Plan / Task 1 (conversation history). parseRequest now returns
{ input, context, messages }. Messages array is sanitized (valid
roles, string content extracted from assistant-ui shape, capped at
last 20). When messages is missing/empty and input is present, falls
back to [{ role: 'user', content: input }] for cron/OpenAI-compat
callers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Orchestrator + BaseAgent thread messages through

The HTTP wire produces `messages`. The orchestrator's `run` and `runStream` methods need to accept and pass through to the runtime.

**Files:**
- Modify: `backend/src/3_applications/agents/framework/AgentOrchestrator.mjs` (or wherever the framework's run methods live — search to confirm)
- Modify: `backend/src/3_applications/agents/framework/BaseAgent.mjs`
- Modify: `backend/src/4_api/v1/agents/mountAgentHttp.mjs` (the place that takes parsed body and calls orchestrator)
- Create: `tests/isolated/agents/conversation_history/orchestrator_thread.test.mjs`

- [ ] **Step 1: Locate the call chain from HTTP → orchestrator → runtime**

```bash
cd /opt/Code/DaylightStation && find backend/src/3_applications/agents/framework -type f -name '*.mjs' 2>&1
cd /opt/Code/DaylightStation && grep -n "run\|runStream\|execute\|streamExecute\|messages" backend/src/3_applications/agents/framework/*.mjs | head -30
cd /opt/Code/DaylightStation && cat backend/src/4_api/v1/agents/mountAgentHttp.mjs | head -120
```

The chain (likely): HTTP handler → `orchestrator.run({ agentId, input, context, messages })` → agent.runImpl → `runtime.execute({ ..., messages })` → MastraAdapter.

- [ ] **Step 2: Write failing tests**

```javascript
// tests/isolated/agents/conversation_history/orchestrator_thread.test.mjs
import { describe, it, expect, vi } from 'vitest';
// adjust import path based on actual file:
import { AgentOrchestrator } from '../../../../backend/src/3_applications/agents/framework/AgentOrchestrator.mjs';
import { BaseAgent } from '../../../../backend/src/3_applications/agents/framework/BaseAgent.mjs';

class StubAgent extends BaseAgent {
  constructor(deps = {}) { super({ id: 'stub', deps }); }
  async getSystemPrompt() { return 'system'; }
  registerTools() { /* none */ }
}

describe('AgentOrchestrator — messages threading', () => {
  it('passes messages through to runtime.execute', async () => {
    const fakeRuntime = {
      execute: vi.fn(async () => ({ output: 'ok', toolCalls: [], turnId: 'x' })),
      streamExecute: vi.fn(),
    };
    const orchestrator = new AgentOrchestrator({ runtime: fakeRuntime, /* other deps */ });
    orchestrator.register(StubAgent, {});
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ];
    await orchestrator.run({
      agentId: 'stub', input: 'second', context: { userId: 'user_1' }, messages,
    });
    expect(fakeRuntime.execute).toHaveBeenCalledWith(
      expect.objectContaining({ messages, input: 'second' }),
    );
  });

  it('passes messages through to runtime.streamExecute', async () => {
    const fakeRuntime = {
      execute: vi.fn(),
      streamExecute: vi.fn(async function* () { yield { type: 'done' }; }),
    };
    const orchestrator = new AgentOrchestrator({ runtime: fakeRuntime, /* other deps */ });
    orchestrator.register(StubAgent, {});
    const messages = [{ role: 'user', content: 'hi' }];
    const iter = orchestrator.runStream({
      agentId: 'stub', input: 'hi', context: { userId: 'kc' }, messages,
    });
    for await (const _ of iter) break;
    expect(fakeRuntime.streamExecute).toHaveBeenCalledWith(
      expect.objectContaining({ messages }),
    );
  });
});
```

NOTE: actual constructor / register signatures depend on how AgentOrchestrator is built. Read the file first; adjust the test setup accordingly.

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/conversation_history/orchestrator_thread.test.mjs
```

- [ ] **Step 4: Implement — thread messages through the call chain**

Three coupled edits:

**4a) AgentOrchestrator.run / runStream**: accept `messages` in args, pass through.

```javascript
async run({ agentId, input, context = {}, messages = [], attachments = [] }) {
  // ... existing setup (load working memory, etc.)
  const result = await this.#runtime.execute({
    agent, agentId, input, messages, tools, systemPrompt, context, attachments,
  });
  // ... existing post-processing
  return result;
}

async *runStream({ agentId, input, context = {}, messages = [], attachments = [] }) {
  // ... existing setup
  const stream = this.#runtime.streamExecute({
    agent, agentId, input, messages, tools, systemPrompt, context, attachments,
  });
  for await (const chunk of stream) yield chunk;
  // ... existing post-processing
}
```

**4b) BaseAgent.runImpl**: if it has its own logic, accept `messages` similarly. Many agents may not need a custom override — the orchestrator passes through to runtime directly.

**4c) mountAgentHttp.mjs (HTTP handler)**: forward `messages` from parsed body into orchestrator call.

```javascript
// In the /run handler:
const { input, context, messages } = wireFormat.parseRequest(req);
const result = await orchestrator.run({ agentId, input, context, messages });
respondSync(res, result, { agentId });

// In the /run-stream handler — same forwarding.
```

- [ ] **Step 5: Run orchestrator tests; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/conversation_history/orchestrator_thread.test.mjs
```

- [ ] **Step 6: Run full agents framework + adapters suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

Expected: all green. If existing tests break because of new arg shape, the orchestrator's `run({ messages = [] })` default-empty-array makes it backward compatible — they should still pass.

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/framework/ \
  backend/src/4_api/v1/agents/mountAgentHttp.mjs \
  tests/isolated/agents/conversation_history/orchestrator_thread.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): orchestrator threads messages array to runtime

Plan / Task 2 (conversation history). AgentOrchestrator.run /
runStream accept a messages array and pass it through to
runtime.execute / streamExecute. HTTP handlers in mountAgentHttp
forward the parsed messages from the wire layer.

Default messages = [] keeps existing callers (cron, scheduled jobs,
internal invocations) backward compatible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: MastraAdapter passes messages to mastraAgent.generate / stream

**Files:**
- Modify: `backend/src/1_adapters/agents/MastraAdapter.mjs`
- Create: `tests/isolated/agents/conversation_history/mastra_adapter.test.mjs`

- [ ] **Step 1: Inspect current execute / streamExecute signatures**

```bash
cd /opt/Code/DaylightStation && sed -n '180,310p' backend/src/1_adapters/agents/MastraAdapter.mjs
```

Currently `execute({ agent, agentId, input, ... })` calls `mastraAgent.generate(input)`. Same for `streamExecute` calling `mastraAgent.stream(input)`. We need to accept `messages` and pass it instead when present.

- [ ] **Step 2: Write failing tests**

```javascript
// tests/isolated/agents/conversation_history/mastra_adapter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { MastraAdapter } from '../../../../backend/src/1_adapters/agents/MastraAdapter.mjs';

// We can't easily mock Mastra's Agent constructor without DI; instead we
// inspect what happens by stubbing the model layer or by spying on Agent.
// Simplest approach: pass a fake Agent factory via constructor option if
// MastraAdapter supports DI; otherwise, integration-test with a recording
// fake model.

describe('MastraAdapter.execute — messages', () => {
  it('calls mastraAgent.generate with messages array when provided', async () => {
    // The adapter calls `new Agent({ name, instructions, model, tools })`.
    // We need to verify mastraAgent.generate(messages) — that means either:
    //   (a) Inject a fake Agent class via constructor option, or
    //   (b) Read the implementation and verify the call site directly.
    // For this test, prefer (a) if the constructor accepts it, else write
    // an integration-level test with a fake model that records inputs.
    //
    // Concrete plan: add `agentClass` to MastraAdapter constructor (defaults to
    // Mastra's Agent), then test by injecting a recording stub.
    const recordedCalls = [];
    class FakeAgent {
      constructor(opts) { this.opts = opts; }
      async generate(arg) { recordedCalls.push({ method: 'generate', arg }); return { text: 'ok', toolCalls: [], finishReason: 'stop' }; }
      async stream(arg) { recordedCalls.push({ method: 'stream', arg }); return { fullStream: (async function*(){ yield { type: 'finish', text: 'ok' }; })() }; }
    }
    const adapter = new MastraAdapter({
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      agentClass: FakeAgent,
      model: {},
    });
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ];
    await adapter.execute({
      agent: { id: 'stub' },
      agentId: 'stub',
      input: 'second',
      messages,
      tools: [],
      systemPrompt: 'sys',
      context: { userId: 'kc' },
    });
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].method).toBe('generate');
    expect(recordedCalls[0].arg).toEqual(messages);
  });

  it('falls back to generate(input) when messages is empty', async () => {
    const recordedCalls = [];
    class FakeAgent {
      constructor() {}
      async generate(arg) { recordedCalls.push(arg); return { text: 'ok', toolCalls: [], finishReason: 'stop' }; }
    }
    const adapter = new MastraAdapter({
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      agentClass: FakeAgent,
      model: {},
    });
    await adapter.execute({
      agent: { id: 'stub' }, agentId: 'stub',
      input: 'hi', messages: [],
      tools: [], systemPrompt: 'sys', context: {},
    });
    // String fallback: generate('hi')
    expect(recordedCalls[0]).toBe('hi');
  });
});
```

- [ ] **Step 3: Implement DI hook + messages pass-through**

```javascript
// In MastraAdapter constructor — add `agentClass` option (default Mastra Agent):
constructor({ logger, model, mediaDir, timeoutMs, agentClass } = {}) {
  // ... existing init
  this.#AgentClass = agentClass || Agent;  // Agent imported from @mastra/core
}

// In execute:
async execute({ agent, agentId, input, messages = [], tools, systemPrompt, context = {} }) {
  // ... existing setup
  const mastraAgent = new this.#AgentClass({ name, instructions: systemPrompt, model: this.#model, tools: mastraTools });
  // ... existing timeout/transcript boilerplate
  const callArg = (Array.isArray(messages) && messages.length > 0) ? messages : input;
  const response = await Promise.race([
    mastraAgent.generate(callArg),
    timeoutPromise,
  ]);
  // ... rest unchanged
}

// Same change in streamExecute:
const callArg = (Array.isArray(messages) && messages.length > 0) ? messages : input;
const output = await mastraAgent.stream(callArg);
```

- [ ] **Step 4: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/conversation_history/mastra_adapter.test.mjs
```

- [ ] **Step 5: Full agents + adapter suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

Expected: still green. Existing tests don't pass `messages`, so they hit the `input` fallback path — same behavior as before this plan.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/1_adapters/agents/MastraAdapter.mjs \
  tests/isolated/agents/conversation_history/mastra_adapter.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): MastraAdapter passes messages array to generate / stream

Plan / Task 3 (conversation history). When the orchestrator threads
a non-empty messages array through, the adapter calls
mastraAgent.generate(messages) / stream(messages). Empty messages
falls back to generate(input) for back-compat.

Adds an `agentClass` constructor option (defaults to @mastra/core
Agent) so tests can inject a recording fake without spinning up an
LLM.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend forwards messages array

**Files:**
- Modify: `frontend/src/modules/Agent/runtime.js`
- Create: `tests/isolated/frontend/agent_runtime/messages.test.js` (or extend existing `runtime.test.js`)

- [ ] **Step 1: Inspect current frontend runtime**

```bash
cd /opt/Code/DaylightStation && cat frontend/src/modules/Agent/runtime.js
```

Currently `run({ messages, ... })` extracts `text = extractText(last)` and ships `{ input: text, context }`. We need to also build a sanitized messages array from the full thread and ship it.

- [ ] **Step 2: Write failing tests**

If `runtime.test.js` already exists, append to it. Otherwise create new.

```javascript
// frontend/src/modules/Agent/runtime.test.js (or messages.test.js if separate)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentRuntime } from './runtime.js';

const mockFetch = (responseBody) => vi.fn(async () => ({
  ok: true, status: 200,
  json: async () => responseBody,
}));

describe('AgentRuntime — messages forwarding', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('ships full messages array (capped at 20) along with input', async () => {
    const fetchSpy = mockFetch({ output: 'ok', toolCalls: [] });
    global.fetch = fetchSpy;
    const runtime = createAgentRuntime({ agentId: 'health-coach', baseUrl: 'http://x' });
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'last' },
    ];
    await runtime.run({ messages, userId: 'user_1' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0]).toEqual({ role: 'user', content: 'first' });
    expect(body.input).toBe('last');
  });

  it('caps shipped messages to last 20', async () => {
    const fetchSpy = mockFetch({ output: 'ok', toolCalls: [] });
    global.fetch = fetchSpy;
    const runtime = createAgentRuntime({ agentId: 'health-coach', baseUrl: 'http://x' });
    const messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    await runtime.run({ messages, userId: 'user_1' });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(20);
    expect(body.messages[0].content).toBe('m10');
  });

  it('handles content arrays (assistant-ui shape) by flattening to text', async () => {
    const fetchSpy = mockFetch({ output: 'ok', toolCalls: [] });
    global.fetch = fetchSpy;
    const runtime = createAgentRuntime({ agentId: 'health-coach', baseUrl: 'http://x' });
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: '!' }] },
    ];
    await runtime.run({ messages, userId: 'user_1' });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello!' },
    ]);
  });

  it('drops messages with no extractable text', async () => {
    const fetchSpy = mockFetch({ output: 'ok', toolCalls: [] });
    global.fetch = fetchSpy;
    const runtime = createAgentRuntime({ agentId: 'health-coach', baseUrl: 'http://x' });
    const messages = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: [{ type: 'image', url: '/foo.png' }] },  // no text part
      { role: 'user', content: 'b' },
    ];
    await runtime.run({ messages, userId: 'user_1' });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
  });
});
```

- [ ] **Step 3: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Agent/runtime.test.js
```

- [ ] **Step 4: Implement**

In `frontend/src/modules/Agent/runtime.js`, add a `serializeMessages` helper that mirrors the backend's `sanitizeMessages` shape, then include it in the request body:

```javascript
const VALID_ROLES = new Set(['user', 'assistant', 'system']);
const MAX_MESSAGES = 20;

function serializeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const m of messages) {
    if (!m || !VALID_ROLES.has(m.role)) continue;
    const text = extractText(m);
    if (typeof text !== 'string' || text.length === 0) continue;
    out.push({ role: m.role, content: text });
  }
  return out.length > MAX_MESSAGES ? out.slice(out.length - MAX_MESSAGES) : out;
}
```

(`extractText` is the existing helper at the bottom of runtime.js — handles both string content and content-part arrays.)

Update both `run` and `runStream` request bodies:

```javascript
body: JSON.stringify({
  input: text,
  context: { userId, attachments },
  messages: serializeMessages(messages),
}),
```

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Agent/runtime.test.js
```

Expected: 4 new tests pass, existing tests still pass.

- [ ] **Step 6: Vite build sanity**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3
```

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  frontend/src/modules/Agent/runtime.js \
  frontend/src/modules/Agent/runtime.test.js
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): frontend ships full messages array with each request

Plan / Task 4 (conversation history). AgentRuntime.run / runStream
extract a sanitized messages array from the assistant-ui thread
(valid roles, flattened content text, capped at last 20) and
include it in the request body alongside input.

The existing input field stays for back-compat with the wire format.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Build, deploy, multi-turn smoke

**Files:**
- (none — verification only)

- [ ] **Step 1: Full vitest sanity**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/ frontend/src/modules/Agent/
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

# Simulate a 4-turn thread. The first three turns establish context that
# turn 4 needs to answer correctly.
TURNS = [
    ("what was my hardest recent run?", []),
    ("what day was that?", [
        {"role": "user", "content": "what was my hardest recent run?"},
        {"role": "assistant", "content": "Your hardest recent run was on May 2, 2026 — 45 minutes (+18.4% vs typical 38 min)."},
        {"role": "user", "content": "what day was that?"},
    ]),
]

def run(input_text, messages):
    body = {"input": input_text, "context": {"userId": "user_1"}}
    if messages:
        body["messages"] = messages
    r = subprocess.run(
        ["curl", "-sS", "-m", "90", "-X", "POST",
         "http://localhost:3111/api/v1/agents/health-coach/run",
         "-H", "Content-Type: application/json",
         "-d", json.dumps(body)],
        capture_output=True, text=True
    )
    try: return json.loads(r.stdout)
    except: return {}

print("=== Turn 1 (no history): hardest recent run ===")
r1 = run(TURNS[0][0], [])
out1 = (r1.get("output") or "").strip()
print("OUT:", out1[:400])

# Build the messages array as the UI would after assistant responded.
history = [
    {"role": "user", "content": TURNS[0][0]},
    {"role": "assistant", "content": out1},
    {"role": "user", "content": TURNS[1][0]},
]

print("\n=== Turn 2 (WITH history): what day was that? ===")
r2 = run(TURNS[1][0], history)
out2 = (r2.get("output") or "").strip()
print("OUT:", out2[:400])
tools2 = [tc.get("payload", tc).get("toolName") for tc in r2.get("toolCalls", [])]
print("TOOLS:", tools2)

print("\n=== CHECKS ===")
checks = [
    ("Turn 2 references May 2 or Saturday",
     bool(re.search(r"\b(may\s*2|saturday)", out2, re.I))),
    ("Turn 2 does NOT punt with 'clarify'",
     not re.search(r"clarif|specify which|what event|what (?:are )?you (?:referring|asking) about", out2, re.I)),
    ("Turn 2 makes 0-1 tool calls (data is in prior turn)",
     len(tools2) <= 1),
]
all_ok = True
for label, ok in checks:
    print(("✓" if ok else "✗"), label)
    all_ok = all_ok and ok
sys.exit(0 if all_ok else 1)
PY
echo "exit: $?"
```

Expected: all 3 ✓. If turn 2 still asks for clarification, the messages aren't reaching Mastra — investigate the wire chain (logs should show `agents.run.request` with messages count).

- [ ] **Step 5: Final summary commit**

```bash
cd /opt/Code/DaylightStation && git commit --allow-empty -m "$(cat <<'EOF'
chore(agents): conversation history threading shipped

5 tasks landed:
- T1: wire format parses messages array (with input fallback)
- T2: orchestrator + HTTP handlers thread messages through
- T3: MastraAdapter calls mastraAgent.generate(messages) / stream(messages)
- T4: frontend ships sanitized messages array (cap 20)
- T5: multi-turn smoke pass

Multi-turn coaching now works:
  Q1: "what was my hardest recent run?"
  A1: "Your hardest run was on May 2, 2026..."
  Q2: "what day was that?"
  A2: "Saturday, May 2." (no clarifying question; uses prior turn)

Server-side persistence remains out of scope — assistant-ui
manages thread state on the client; the server is stateless per
request. Last 20 messages are forwarded each turn.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| Failure mode | Tasks |
|---|---|
| "what day was that?" → "Could you clarify?" (no memory of prior turn) | T1-T5 (full chain) |
| "i just told you" → context-blind | T1-T5 |
| "the map widget" → no recall of prior offer | T1-T5 |
| Hallucinated tool args because user reference is unclear | T1-T5 (prior turn provides the reference) |
| Cron / scheduled / OpenAI-compat callers (no messages) | T1 (input → synthesized single-message array) |

---

## Notes for the implementer

- **Test-only DI for MastraAdapter (Task 3).** The cleanest way to unit-test that `mastraAgent.generate(messages)` is called is to inject a fake Agent class via constructor option. If the adapter doesn't accept a constructor option for this today, add one (`agentClass`). Don't try to mock `@mastra/core`'s `Agent` class — fragile and brittle.
- **Token cost.** Each turn now ships up to 20 prior messages. Coaching turns are short (a few hundred tokens each); 20 messages ≈ 4k tokens of history on top of the system prompt + tool docs + user model. Watch for context pressure on long sessions; if it bites, reduce the cap or add tiered summarization (out of scope here).
- **Working memory vs conversation history.** These are different things — keep them distinct. Working memory persists across SESSIONS per user (playbooks, long-term observations). Conversation history is WITHIN a session, client-managed. This plan only addresses conversation history.
- **OpenAI-compat path.** That wire format already accepts `messages` natively (it's what the OpenAI Chat Completions API requires). No changes needed there. Verify the OpenAI-compat tests still pass.
- **Server-side persistence is a separate, larger feature.** If voice satellites or other stateless callers need server-side conversation continuity, that's a future plan involving thread IDs, Mastra memory adapters, persistence schema, and multi-device sync. Not this plan.
- **Follow-up plan: GPS / reverse-geocode tool.** The user noticed that `strava_summary.start_latlng` lat/lng pairs aren't humanized ("Coal Creek Trail" vs "[47.41, -122.17]"). A separate plan should add a `geocode_location({lat, lng})` tool — could call a free Nominatim-like service or a paid Mapbox/Google API. Worth ~1-3 tasks. Don't fold it into this plan.
