# Mastra Memory Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** The conversation history threading plan (`2026-05-07-agent-conversation-history.md`) has shipped. Per-turn message arrays now flow through to `mastraAgent.generate(messages)`. This plan layers Mastra Memory on top.

**Goal:** Adopt `@mastra/memory` to give all agents (health-coach first, then lifeplan-guide) cross-session continuity, observational compression of long threads, semantic recall over deep history, and shared user state by `resourceId`. Move from "client carries the thread, server is stateless per turn" to "server owns thread persistence, client just supplies resource + thread identifiers."

**Architecture:**

Five subsystems composed into one `Memory` instance attached to each Mastra `Agent`:

1. **Storage backend.** LibSQL (file-backed SQLite) for zero-infra start. File lives at `data/agents/memory.db` (mounted by Docker, persists across container restarts). Migration to Postgres deferred until we add Postgres for some other reason — LibSQL handles low-volume coaching traffic comfortably and avoids a new operational dependency.
2. **Message history.** `lastMessages: 20` window. Replaces the client-supplied messages array as the primary continuity mechanism. Client still ships messages for back-compat and as a fallback when threadId is absent (cron / OpenAI-compat callers).
3. **Working memory (Zod schema).** Structured user state the LLM updates inline via the auto-injected `updateWorkingMemory` tool. Coexists with our YAML playbook system — YAML for code-curated baselines/playbooks, Mastra working memory for LLM-observed transient state ("user mentioned poor sleep yesterday"). Resource-scoped (cross-thread, cross-agent).
4. **Observational memory.** Background Observer + Reflector agents auto-compress threads when they exceed ~30K tokens. Use `gpt-4o-mini` for memory ops while the main coach stays on the strong model. 5-40× compression with relevance-based fading.
5. **Semantic recall — feature-flagged off by default.** RAG over embedded past messages using pgvector (or LibSQL vector ext if it works). Per-turn embedding cost (~100-400ms) is real; enable only when deep-history queries become a visible need.

**Thread strategy:**
- `resource` = `userId` (e.g. `'kckern'`). Stable forever; shared across all agents and threads.
- `thread` = stable per-chat-surface UUID generated client-side, persisted in `localStorage` keyed by `${agentId}:${userId}`. The frontend ships `threadId` in the request body alongside `messages`. New thread = "Start new conversation" button (future UI, not in this plan).

**Migration story:**
- YAML playbooks/baselines: keep. They're the curated, code-maintained snapshot of long-term knowledge. Mastra working memory is the LLM-maintained transient observations layer. Different problems, different solutions.
- The conversation-history-shipping `messages` array stays in the wire format as a fallback for callers without threadId (cron, OpenAI-compat, voice satellites until they implement threadIds). When `threadId` is present, server-side message history takes precedence.
- Existing transcripts (`media/logs/agents/health-coach/...`) continue to work — they're separate observability artifacts, not the source of truth.

**Tech Stack:** `@mastra/memory`, `@mastra/libsql`, existing Mastra `Agent`, existing `MastraAdapter`. New file at `data/agents/memory.db`.

---

## Exit criteria (verifiable end-to-end)

The plan is **not** done until this 3-turn cross-session smoke produces a coherent answer:

```
# Step 1: Open chat (no prior thread). Agent generates threadId T1.
POST /run-stream { input: "I'm focusing on Z2 endurance work this month",
                   context: { userId: 'kckern', threadId: 'T1' },
                   messages: [...] }
A1: "Got it — I'll keep that in mind for analysis."

# Step 2: Close browser. Open it again. Same user, SAME threadId T1.
# Client supplies threadId from localStorage; sends FRESH (empty)
# messages array — server reconstructs history from Mastra Memory.
POST /run-stream { input: "what was I focusing on this month?",
                   context: { userId: 'kckern', threadId: 'T1' },
                   messages: [] }
A2: "You said you're focusing on Z2 endurance work this month."

# Step 3 (cross-agent): switch to lifeplan-guide. Different threadId T2,
# but same userId. Working memory should have captured the focus area
# via shared resource scope.
POST /run-stream agent=lifeplan-guide, { input: "what does kc want to focus on?",
                   context: { userId: 'kckern', threadId: 'T2' },
                   messages: [] }
A3: "Z2 endurance work this month, per recent conversation."
```

Output text must satisfy:
1. Turn 2 references "Z2 endurance" without the user repeating it — proves message history persisted server-side
2. Turn 3 (different agent, different thread) references it too — proves working memory shared by resource
3. Empty `messages: []` in turns 2-3 — proves server reconstructs from Memory, not just from client

The Task 8 smoke script encodes these as regex assertions and exits non-zero on fail.

---

## Phases

| Phase | Goal | Tasks |
|---|---|---|
| 1. Storage + Memory plumbing | LibSQL file mounted, Memory instance constructed, attached to Agent | T1 (deps + storage), T2 (Memory in MastraAdapter) |
| 2. Thread routing | threadId from client → backend → Mastra | T3 (wire), T4 (frontend localStorage threadId) |
| 3. Working memory schema | LLM-maintained user observation block | T5 |
| 4. Observational compression | gpt-4o-mini Observer + Reflector | T6 |
| 5. Verification + deploy | Cross-session + cross-agent smoke | T7 (build/deploy), T8 (smoke) |

Semantic recall is **deferred** — design notes only at the end of this plan; not implemented here.

---

## File structure

**New files:**

```
backend/src/0_system/memory/
  buildMastraMemory.mjs           — factory; builds Memory with LibSQL storage + working memory schema + observational config

backend/src/3_applications/agents/health-coach/memory/
  workingMemorySchema.mjs         — Zod schema for health-coach working memory (recent observations, focus areas, mentioned topics)
```

**Modified files:**

```
backend/src/0_system/bootstrap.mjs
  — wire mastraMemory into MastraAdapter

backend/src/1_adapters/agents/MastraAdapter.mjs
  — accept memory in constructor; attach to Agent; pass { memory: { resource, thread } } to generate/stream

backend/src/4_api/v1/agents/wireFormats/native.mjs
  — parse threadId from body / context

backend/src/3_applications/agents/framework/BaseAgent.mjs
  — extract threadId from context, thread to runtime

backend/src/3_applications/agents/AgentOrchestrator.mjs
  — (if needed; should be no-op since context passes through)

backend/src/4_api/v1/agents/mountAgentHttp.mjs
  — forward threadId from parsed body into merged context

frontend/src/modules/Agent/runtime.js
  — generate / read threadId from localStorage; ship in request body

backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs
  — pass workingMemorySchema to MastraAdapter (per-agent override)

package.json
  — add @mastra/memory @mastra/libsql

docker/Dockerfile (or volume mount config)
  — ensure data/agents/ is included in the data volume mount
```

**New tests:**

```
tests/isolated/agents/memory/
  buildMastraMemory.test.mjs      — factory builds correct Memory instance
  thread_id_wire.test.mjs         — wire format + orchestrator thread routing
  working_memory_schema.test.mjs  — Zod schema accepts canonical shapes
  cross_session_smoke.runtime.test.mjs — multi-turn smoke (live HTTP)
```

---

## Task 1: Add packages, scaffold storage path

**Files:**
- Modify: `package.json`
- Verify: `data/agents/` directory exists in container volume (modify Docker config if not)

- [ ] **Step 1: Add packages**

```bash
cd /opt/Code/DaylightStation && npm install @mastra/memory @mastra/libsql
```

Pin specific versions in `package.json` (don't trust `^` for in-flux libraries). Check `https://www.npmjs.com/package/@mastra/memory` for latest stable; pick the version that matches our `@mastra/core` version. The Memory research found compat shims for older `@mastra/core` versions, so verify compatibility before locking.

- [ ] **Step 2: Verify the version compatibility**

```bash
cd /opt/Code/DaylightStation && cat node_modules/@mastra/memory/package.json | grep -A2 peerDependencies
cd /opt/Code/DaylightStation && cat node_modules/@mastra/core/package.json | grep version | head -1
```

If peerDependencies mention a `@mastra/core` version range that doesn't include our installed version, pick a compatible Memory version.

- [ ] **Step 3: Decide storage location**

Storage path: `/usr/src/app/data/agents/memory.db` (inside container — same data volume that's mounted at `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data` on the host).

```bash
cd /opt/Code/DaylightStation && sudo docker exec daylight-station sh -c 'ls -la data/ | head -5'
cd /opt/Code/DaylightStation && sudo docker exec daylight-station sh -c 'mkdir -p data/agents'
cd /opt/Code/DaylightStation && sudo docker exec daylight-station sh -c 'ls -la data/agents/'
```

Add a `.gitkeep` to `data/agents/` and commit so the directory exists in fresh checkouts. The actual `memory.db` file is data — don't commit it (already covered by `.gitignore` if data/ is gitignored; otherwise add `data/agents/*.db` to `.gitignore`).

- [ ] **Step 4: Commit packages + scaffold**

```bash
cd /opt/Code/DaylightStation && git add package.json package-lock.json
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): add @mastra/memory + @mastra/libsql packages

Plan / Task 1 (mastra memory). Pinned compatible versions for
adoption. Storage path: data/agents/memory.db (inside container,
mounted from host data volume so it persists across restarts).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Sanity import**

```bash
cd /opt/Code/DaylightStation && node -e "
import('@mastra/memory').then(m => console.log('keys:', Object.keys(m)));
import('@mastra/libsql').then(m => console.log('libsql keys:', Object.keys(m)));
"
```

Expected: `keys: ['Memory']` (or similar) and the libsql storage class export name. Note these — they're used in T2.

---

## Task 2: Build Memory factory + wire into MastraAdapter

**Files:**
- Create: `backend/src/0_system/memory/buildMastraMemory.mjs`
- Create: `tests/isolated/agents/memory/buildMastraMemory.test.mjs`
- Modify: `backend/src/1_adapters/agents/MastraAdapter.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

- [ ] **Step 1: Write tests for the factory**

```javascript
// tests/isolated/agents/memory/buildMastraMemory.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { buildMastraMemory } from '../../../../backend/src/0_system/memory/buildMastraMemory.mjs';

describe('buildMastraMemory', () => {
  it('returns a Memory instance with storage configured', () => {
    const memory = buildMastraMemory({ dbPath: ':memory:' });  // in-memory SQLite for tests
    expect(memory).toBeDefined();
    expect(typeof memory.getThreadById).toBe('function');  // or whatever method Memory exposes
  });

  it('throws when dbPath missing', () => {
    expect(() => buildMastraMemory({})).toThrow(/dbPath/);
  });

  it('respects lastMessages option', () => {
    const memory = buildMastraMemory({ dbPath: ':memory:', lastMessages: 30 });
    // verify config — Memory's API for inspecting config may vary;
    // simplest check: it constructs without throwing.
    expect(memory).toBeDefined();
  });
});
```

NOTE: Memory's exact API surface depends on the version. The test is light — it asserts construction works and a known method exists. If `getThreadById` isn't the right method name (it could be `query`, `getMessages`, or wrapped differently), adjust based on what the actual API exposes after the import in T1.

- [ ] **Step 2: Implement factory**

```javascript
// backend/src/0_system/memory/buildMastraMemory.mjs
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';   // verify name from T1.5 import smoke

/**
 * Build a Mastra Memory instance with LibSQL storage.
 *
 * @param {object} config
 * @param {string} config.dbPath              — path to SQLite file (or ':memory:' for tests)
 * @param {number} [config.lastMessages=20]   — message history window
 * @param {object} [config.workingMemory]     — Zod schema (per-agent; passed by HealthCoachAgent etc.)
 * @param {object} [config.observational]     — observational memory config (gpt-4o-mini etc.)
 * @returns {Memory}
 */
export function buildMastraMemory({ dbPath, lastMessages = 20, workingMemory = null, observational = null } = {}) {
  if (!dbPath) throw new Error('buildMastraMemory: dbPath required');

  const storage = new LibSQLStore({ url: dbPath.startsWith(':') ? dbPath : `file:${dbPath}` });

  const opts = { lastMessages };
  if (workingMemory) opts.workingMemory = workingMemory;
  if (observational) opts.observationalMemory = observational;

  return new Memory({ storage, options: opts });
}
```

- [ ] **Step 3: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/memory/buildMastraMemory.test.mjs
```

If a test fails because the assumed Memory API differs, check the installed package's TypeScript declarations to find the actual method names and adjust.

- [ ] **Step 4: Wire into MastraAdapter**

In `backend/src/1_adapters/agents/MastraAdapter.mjs`:

**4a) Constructor accepts a `memory` option (already-constructed Memory instance):**

```javascript
#memory;

constructor(deps = {}) {
  this.#model = deps.model || 'openai/gpt-4o';
  this.#logger = deps.logger || console;
  this.#maxToolCalls = deps.maxToolCalls || 50;
  this.#timeoutMs = deps.timeoutMs || 120000;
  this.#mediaDir = deps.mediaDir || null;
  this.#AgentClass = deps.agentClass || Agent;
  this.#memory = deps.memory || null;
}
```

**4b) Pass memory to the new Agent in execute() AND streamExecute():**

```javascript
const mastraAgent = new this.#AgentClass({
  name,
  instructions: systemPrompt,
  model: this.#model,
  tools: mastraTools,
  ...(this.#memory ? { memory: this.#memory } : {}),
});
```

**4c) Pass `{ memory: { resource, thread } }` as the second arg to generate / stream when threadId + userId are both present:**

```javascript
const userId = context.userId ?? null;
const threadId = context.threadId ?? null;
const callArg = (Array.isArray(messages) && messages.length > 0) ? messages : input;
const memoryOpts = (this.#memory && userId && threadId)
  ? { memory: { resource: userId, thread: threadId } }
  : undefined;

const response = await Promise.race([
  memoryOpts ? mastraAgent.generate(callArg, memoryOpts) : mastraAgent.generate(callArg),
  timeoutPromise,
]);
```

Same pattern for `streamExecute`.

- [ ] **Step 5: Wire bootstrap**

In `backend/src/0_system/bootstrap.mjs`, locate the MastraAdapter construction and add memory:

```javascript
import { buildMastraMemory } from '#system/memory/buildMastraMemory.mjs';

// Near the top of createAgentsServices:
const mastraMemory = buildMastraMemory({
  dbPath: configService?.getPath?.('data') + '/agents/memory.db' || 'data/agents/memory.db',
  lastMessages: 20,
  // workingMemory + observational come from per-agent overrides — leave null at the framework default.
});

// MastraAdapter construction:
const agentRuntime = new MastraAdapter({
  logger,
  mediaDir,
  memory: mastraMemory,
});
```

NOTE: per-agent working memory schemas are tricky here. Mastra Memory accepts a schema globally; per-agent overrides are not first-class. Two approaches:
- **(a) Single shared schema** — define a union schema covering all agents' fields. Simpler.
- **(b) Per-agent Memory instances** — construct one Memory per agent, attach in HealthCoachAgent / LifeplanGuide / etc.

Approach (b) is cleaner and more isolated. For T5 we'll use (b). T2 wires a default Memory; T5 overrides per-agent.

- [ ] **Step 6: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/ tests/isolated/adapters/agents/
```

Existing tests should still pass — the memory option is optional and defaults to no-memory behavior.

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/0_system/memory/ \
  backend/src/1_adapters/agents/MastraAdapter.mjs \
  backend/src/0_system/bootstrap.mjs \
  tests/isolated/agents/memory/buildMastraMemory.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): MastraAdapter accepts Mastra Memory instance

Plan / Task 2 (mastra memory). buildMastraMemory factory constructs
a Memory instance backed by LibSQL at data/agents/memory.db. The
adapter attaches the Memory to each new Agent and passes
{ memory: { resource: userId, thread: threadId } } to generate/stream
when threadId is present in context.

Memory is optional — adapter falls back to stateless behavior when
not configured, preserving back-compat with cron / OpenAI-compat
callers and any test paths that don't supply memory.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire `threadId` from client through the backend

**Files:**
- Modify: `backend/src/4_api/v1/agents/wireFormats/native.mjs` — parse threadId
- Modify: `backend/src/4_api/v1/agents/mountAgentHttp.mjs` — forward into merged context
- Modify: `backend/src/3_applications/agents/framework/BaseAgent.mjs` — context.threadId already passes through; just verify it's documented
- Create: `tests/isolated/agents/memory/thread_id_wire.test.mjs`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/isolated/agents/memory/thread_id_wire.test.mjs
import { describe, it, expect } from 'vitest';
import { parseRequest } from '../../../../backend/src/4_api/v1/agents/wireFormats/native.mjs';

const makeReq = (body) => ({ body });

describe('wire format — threadId', () => {
  it('parses threadId from body root', () => {
    const r = parseRequest(makeReq({ input: 'hi', threadId: 'T-abc' }));
    expect(r.threadId).toBe('T-abc');
  });

  it('parses threadId from body.context if not at root', () => {
    const r = parseRequest(makeReq({ input: 'hi', context: { threadId: 'T-xyz' } }));
    expect(r.threadId).toBe('T-xyz');
  });

  it('returns null threadId when missing', () => {
    const r = parseRequest(makeReq({ input: 'hi' }));
    expect(r.threadId).toBe(null);
  });

  it('rejects non-string threadId', () => {
    const r = parseRequest(makeReq({ input: 'hi', threadId: 123 }));
    expect(r.threadId).toBe(null);
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/memory/thread_id_wire.test.mjs
```

- [ ] **Step 3: Implement parseRequest update**

In `backend/src/4_api/v1/agents/wireFormats/native.mjs::parseRequest`:

```javascript
export function parseRequest(req) {
  const body = req?.body || {};
  const input = body.input ?? null;
  let messages = sanitizeMessages(body.messages);
  if (messages.length === 0 && typeof input === 'string' && input.length > 0) {
    messages = [{ role: 'user', content: input }];
  }
  // threadId: prefer body.threadId, fall back to body.context.threadId
  let threadId = null;
  if (typeof body.threadId === 'string' && body.threadId.length > 0) {
    threadId = body.threadId;
  } else if (typeof body.context?.threadId === 'string' && body.context.threadId.length > 0) {
    threadId = body.context.threadId;
  }
  return {
    input,
    context: body.context ?? {},
    messages,
    threadId,
  };
}
```

- [ ] **Step 4: Update mountAgentHttp to forward threadId**

In `backend/src/4_api/v1/agents/mountAgentHttp.mjs::mountNative`, all three handlers:

```javascript
const { input, context, messages, threadId } = wire.parseRequest(req);
// ...
const merged = { ...mergeContext(context, contextExtractor, req), messages, threadId };
```

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/memory/thread_id_wire.test.mjs tests/isolated/agents/
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/4_api/v1/agents/wireFormats/native.mjs \
  backend/src/4_api/v1/agents/mountAgentHttp.mjs \
  tests/isolated/agents/memory/thread_id_wire.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): wire format parses threadId; mountAgentHttp forwards

Plan / Task 3 (mastra memory). parseRequest extracts threadId from
body root or body.context. mountAgentHttp threads it into the merged
context so it travels through orchestrator → BaseAgent → MastraAdapter
which uses it as the Mastra Memory thread key.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend generates / persists threadId, ships in body

**Files:**
- Modify: `frontend/src/modules/Agent/runtime.js`
- Modify: `frontend/src/modules/Agent/runtime.test.js`
- Modify: `frontend/src/modules/Agent/AgentChatSurface.jsx` (if needed — runtime is owned by the surface)

- [ ] **Step 1: Read AgentChatSurface to see how runtime gets userId / agentId**

```bash
cd /opt/Code/DaylightStation && grep -n "createAgentRuntime\|userId\|threadId" frontend/src/modules/Agent/AgentChatSurface.jsx | head -10
```

You're looking for the code path that constructs the runtime. We need a place to read/generate threadId from localStorage.

- [ ] **Step 2: Add threadId helpers to runtime.js**

```javascript
// At the top of runtime.js (or in a small helper file)
const THREAD_PREFIX = 'daylight-station:agent-thread:';

export function getOrCreateThreadId(agentId, userId) {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  if (!agentId || !userId) return null;
  const key = `${THREAD_PREFIX}${agentId}:${userId}`;
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(key, id);
  }
  return id;
}

export function resetThread(agentId, userId) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const key = `${THREAD_PREFIX}${agentId}:${userId}`;
  window.localStorage.removeItem(key);
}
```

- [ ] **Step 3: Ship threadId in request body**

In both `run` and `runStream`, build the threadId before the fetch and include in body:

```javascript
async run({ messages, userId, attachments = [] }) {
  const last = messages.at(-1);
  const text = extractText(last);
  const threadId = getOrCreateThreadId(agentId, userId);

  const res = await fetch(runUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: text,
      context: { userId, attachments },
      messages: serializeMessages(messages),
      threadId,
    }),
  });
  // ... rest unchanged
}
```

- [ ] **Step 4: Tests**

```javascript
// In frontend/src/modules/Agent/runtime.test.js, append:

describe('createAgentRuntime("health-coach").run — threadId', () => {
  let originalFetch, originalLocalStorage;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      _store: {},
      getItem(k) { return this._store[k] || null; },
      setItem(k, v) { this._store[k] = v; },
      removeItem(k) { delete this._store[k]; },
    };
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  });

  it('ships a threadId in the request body', async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url, opts) => {
      captured = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ output: 'ok', toolCalls: [] }) };
    });
    const runtime = createAgentRuntime('health-coach');
    await runtime.run({ messages: [{ role: 'user', content: 'hi' }], userId: 'kckern' });
    expect(captured.threadId).toMatch(/^t-/);
  });

  it('reuses the same threadId across calls for same userId', async () => {
    const captured = [];
    globalThis.fetch = vi.fn(async (url, opts) => {
      captured.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ output: 'ok', toolCalls: [] }) };
    });
    const runtime = createAgentRuntime('health-coach');
    await runtime.run({ messages: [{ role: 'user', content: 'a' }], userId: 'kckern' });
    await runtime.run({ messages: [{ role: 'user', content: 'b' }], userId: 'kckern' });
    expect(captured[0].threadId).toBe(captured[1].threadId);
  });

  it('uses different threadIds per agentId', async () => {
    const captured = [];
    globalThis.fetch = vi.fn(async (url, opts) => {
      captured.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ output: 'ok', toolCalls: [] }) };
    });
    const a = createAgentRuntime('health-coach');
    const b = createAgentRuntime('lifeplan-guide');
    await a.run({ messages: [{ role: 'user', content: 'x' }], userId: 'kckern' });
    await b.run({ messages: [{ role: 'user', content: 'y' }], userId: 'kckern' });
    expect(captured[0].threadId).not.toBe(captured[1].threadId);
  });
});
```

- [ ] **Step 5: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Agent/
```

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  frontend/src/modules/Agent/runtime.js \
  frontend/src/modules/Agent/runtime.test.js
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): frontend generates and persists threadId per agent+user

Plan / Task 4 (mastra memory). Runtime auto-generates a stable
thread ID on first call and persists it to localStorage keyed by
agentId+userId. Subsequent calls reuse it. Different agents get
different threads. Browser refresh preserves the thread (so the
agent picks up from where the user left off).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Working memory schema for health-coach

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs`
- Create: `tests/isolated/agents/memory/working_memory_schema.test.mjs`
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` — pass per-agent memory

- [ ] **Step 1: Define the schema**

```javascript
// backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs
import { z } from 'zod';

/**
 * Health coach working memory — LLM-maintained transient observations.
 *
 * Distinct from our YAML-based playbooks/baselines (code-curated, structured).
 * This is what the LLM notices in conversation and wants to remember across
 * turns without us having to write code to persist it.
 *
 * Examples:
 *   recent_focus_areas: ["Z2 endurance", "morning fasted runs"]
 *   recent_observations: ["mentioned poor sleep on 2026-05-06", "asked for fewer hard runs"]
 *   stated_goals: ["sub-3:30 marathon by October"]
 *   active_constraints: ["recovering from sore left knee since 2026-05-01"]
 */
export const healthCoachWorkingMemorySchema = z.object({
  recent_focus_areas: z.array(z.string()).max(8).optional()
    .describe('What the user has mentioned focusing on lately (e.g., "Z2 endurance", "morning fasted runs"). Most recent first.'),
  recent_observations: z.array(z.string()).max(20).optional()
    .describe('Notable things the user has shared in recent conversations (e.g., "mentioned poor sleep on 2026-05-06"). Each entry should include a date if relevant.'),
  stated_goals: z.array(z.string()).max(5).optional()
    .describe('Long-term goals the user has explicitly stated (e.g., "sub-3:30 marathon by October").'),
  active_constraints: z.array(z.string()).max(5).optional()
    .describe('Current limitations or restrictions (injury, illness, life event). Each should include a start date if known.'),
  preferences: z.record(z.string(), z.string()).optional()
    .describe('Coaching preferences the user has expressed (e.g., { "tone": "direct", "metric_priority": "HR over pace" }).'),
});

export default healthCoachWorkingMemorySchema;
```

- [ ] **Step 2: Tests**

```javascript
// tests/isolated/agents/memory/working_memory_schema.test.mjs
import { describe, it, expect } from 'vitest';
import { healthCoachWorkingMemorySchema } from '../../../../backend/src/3_applications/agents/health-coach/memory/workingMemorySchema.mjs';

describe('healthCoachWorkingMemorySchema', () => {
  it('accepts canonical shape', () => {
    const r = healthCoachWorkingMemorySchema.safeParse({
      recent_focus_areas: ['Z2 endurance'],
      recent_observations: ['mentioned poor sleep on 2026-05-06'],
      stated_goals: ['sub-3:30 marathon by October'],
      active_constraints: ['sore left knee since 2026-05-01'],
      preferences: { tone: 'direct' },
    });
    expect(r.success).toBe(true);
  });

  it('accepts empty object (all fields optional)', () => {
    const r = healthCoachWorkingMemorySchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('rejects oversized arrays', () => {
    const r = healthCoachWorkingMemorySchema.safeParse({
      recent_focus_areas: Array(20).fill('x'),  // > 8 max
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-string entries', () => {
    const r = healthCoachWorkingMemorySchema.safeParse({
      recent_focus_areas: [123, 'valid'],
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run; pass**

```bash
cd /opt/Code/DaylightStation && npx vitest run tests/isolated/agents/memory/working_memory_schema.test.mjs
```

- [ ] **Step 4: Wire per-agent Memory in HealthCoachAgent**

The cleanest model is per-agent Memory. In bootstrap, construct a separate Memory for health-coach with the schema attached:

```javascript
// In bootstrap.mjs, near the existing mastraMemory construction:
import { healthCoachWorkingMemorySchema } from '#apps/agents/health-coach/memory/workingMemorySchema.mjs';

const healthCoachMemory = buildMastraMemory({
  dbPath: configService?.getPath?.('data') + '/agents/memory.db' || 'data/agents/memory.db',
  lastMessages: 20,
  workingMemory: { schema: healthCoachWorkingMemorySchema },
});
```

Then HealthCoachAgent gets its own MastraAdapter (or the same adapter accepts a per-agent override). Approach: add `memory` to the agent's `deps`. HealthCoachAgent passes it to runtime calls.

Actually, simpler: HealthCoachAgent gets its own MastraAdapter instance. In bootstrap:

```javascript
const healthCoachRuntime = new MastraAdapter({ logger, mediaDir, memory: healthCoachMemory });

agentOrchestrator.register(HealthCoachAgent, {
  ...
  agentRuntime: healthCoachRuntime,  // override the default runtime
});
```

Read how agent-specific runtimes are currently handled. If it's a single shared runtime, this is a refactor. If per-agent runtimes are already supported, just supply this one.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/3_applications/agents/health-coach/memory/ \
  backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs \
  backend/src/0_system/bootstrap.mjs \
  tests/isolated/agents/memory/working_memory_schema.test.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(health-coach): Mastra working memory schema

Plan / Task 5 (mastra memory). Zod schema for LLM-maintained
transient observations: recent_focus_areas, recent_observations,
stated_goals, active_constraints, preferences. Coexists with
YAML-based playbooks (code-curated baselines).

Per-agent Memory instance attached via bootstrap so health-coach's
schema doesn't leak into other agents.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Observational memory (background compression)

**Files:**
- Modify: `backend/src/0_system/memory/buildMastraMemory.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

- [ ] **Step 1: Configure observational memory in the factory**

Update `buildMastraMemory` to accept observational config:

```javascript
export function buildMastraMemory({
  dbPath, lastMessages = 20, workingMemory = null, observational = null,
}) {
  // ... existing setup
  if (observational) {
    opts.observationalMemory = {
      model: observational.model,
      threshold: observational.threshold ?? { messageTokens: 30_000, observationTokens: 40_000 },
    };
  }
  return new Memory({ storage, options: opts });
}
```

- [ ] **Step 2: Pass observational config when constructing healthCoachMemory**

In bootstrap.mjs:

```javascript
import { openai } from '@ai-sdk/openai';   // already imported via @mastra/core somewhere

const healthCoachMemory = buildMastraMemory({
  dbPath: ...,
  lastMessages: 20,
  workingMemory: { schema: healthCoachWorkingMemorySchema },
  observational: {
    model: openai('gpt-4o-mini'),  // cheap model for compression
    threshold: { messageTokens: 30_000, observationTokens: 40_000 },
  },
});
```

The `model:` value depends on the actual Mastra Memory API — it might want a string descriptor (`'openai/gpt-4o-mini'`) or a constructed model adapter. Adjust based on the installed version's docs.

- [ ] **Step 3: Verify the configuration loads without crashing**

```bash
cd /opt/Code/DaylightStation && node -c backend/src/0_system/bootstrap.mjs && echo OK
cd /opt/Code/DaylightStation && timeout 25 node -e "
import('./backend/index.js').then(() => { console.log('BOOT OK'); setTimeout(() => process.exit(0), 1500); }).catch(e => { console.error('BOOT FAIL:', e.message); process.exit(1); });
" 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add \
  backend/src/0_system/memory/buildMastraMemory.mjs \
  backend/src/0_system/bootstrap.mjs
cd /opt/Code/DaylightStation && git commit -m "$(cat <<'EOF'
feat(agents): observational memory with gpt-4o-mini

Plan / Task 6 (mastra memory). Background Observer + Reflector
agents compress thread history when message tokens exceed 30K or
observation tokens exceed 40K. Cheap model (gpt-4o-mini) keeps the
operational cost bounded; the main coach stays on the strong model.

Compression runs async; doesn't block per-turn latency.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Build, deploy

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

- [ ] **Step 4: Smoke that boot doesn't crash on Memory init**

```bash
sudo docker logs daylight-station --since 60s 2>&1 | grep -iE "memory|libsql|error" | head -20
```

If any errors related to LibSQL or Memory init, fix before T8.

- [ ] **Step 5: Spot-check that memory.db got created**

```bash
sudo docker exec daylight-station sh -c 'ls -la data/agents/'
```

Expected: `memory.db` file exists (created on first agent call) — may not exist yet if no calls made; just verify the directory is writable.

---

## Task 8: Cross-session smoke

**Files:**
- (none — verification only)

- [ ] **Step 1: Run the 3-turn smoke**

```bash
python3 <<'PY'
import json, re, subprocess, sys, uuid

THREAD_HC = f"t-smoke-{uuid.uuid4().hex[:8]}"
THREAD_LP = f"t-smoke-{uuid.uuid4().hex[:8]}"

def run(agent, input_text, threadId, messages=None):
    body = {
        "input": input_text,
        "context": {"userId": "kckern"},
        "threadId": threadId,
    }
    if messages is not None:
        body["messages"] = messages
    r = subprocess.run(
        ["curl", "-sS", "-m", "120", "-X", "POST",
         f"http://localhost:3111/api/v1/agents/{agent}/run",
         "-H", "Content-Type: application/json",
         "-d", json.dumps(body)],
        capture_output=True, text=True
    )
    try: return json.loads(r.stdout)
    except: print('PARSE_FAIL', r.stdout[:300]); return {}

# Turn 1: establish a focus area
print("=== Turn 1: establish focus (health-coach, threadId=", THREAD_HC, ") ===")
r1 = run("health-coach",
    "I'm focusing on Z2 endurance work this month. Just FYI for our future conversations.",
    THREAD_HC,
    messages=[{"role":"user","content":"I'm focusing on Z2 endurance work this month. Just FYI for our future conversations."}])
out1 = (r1.get("output") or "").strip()
print("OUT:", out1[:300])

# Turn 2: NEW request, EMPTY messages, SAME threadId — server should
# reconstruct from Mastra Memory's stored history.
print("\n=== Turn 2: same thread, NO client-side history ===")
r2 = run("health-coach",
    "what was I focusing on this month?",
    THREAD_HC,
    messages=[])
out2 = (r2.get("output") or "").strip()
print("OUT:", out2[:300])

# Turn 3 (cross-agent): different threadId, same userId, different agent.
# Mastra working memory should have captured the focus area at the
# resource level — lifeplan-guide should see it.
print("\n=== Turn 3: cross-agent (lifeplan-guide, threadId=", THREAD_LP, ") ===")
r3 = run("lifeplan-guide",
    "what does kc want to focus on right now?",
    THREAD_LP,
    messages=[])
out3 = (r3.get("output") or "").strip()
print("OUT:", out3[:300])

print("\n=== CHECKS ===")
checks = [
    ("Turn 2 references Z2 / endurance without client supplying history",
     bool(re.search(r"\b(z2|endurance|zone 2)", out2, re.I))),
    ("Turn 2 does NOT punt with 'clarify'",
     not re.search(r"clarif|i don.?t recall|specify", out2, re.I)),
    ("Turn 3 references the focus area cross-agent",
     bool(re.search(r"\b(z2|endurance|zone 2)", out3, re.I))),
]
all_ok = True
for label, ok in checks:
    print(("✓" if ok else "✗"), label)
    all_ok = all_ok and ok
sys.exit(0 if all_ok else 1)
PY
echo "exit: $?"
```

If turn 3 fails (cross-agent recall) but turn 2 passes (within-thread), that means message history is working but working memory isn't — investigate the working memory tool registration (the LLM has to actually CALL `updateWorkingMemory` for state to persist; this only happens when the prompt encourages it).

If turn 2 fails (within-thread), Mastra Memory isn't loading prior messages — investigate the threadId routing chain (logs should show the threadId in agent.execute.start).

- [ ] **Step 2: Final summary commit**

```bash
cd /opt/Code/DaylightStation && git commit --allow-empty -m "$(cat <<'EOF'
chore(agents): mastra memory adoption shipped

8 plan tasks landed:
- T1: @mastra/memory + @mastra/libsql packages, storage path
- T2: buildMastraMemory factory; MastraAdapter wires Memory to Agent
- T3: wire format parses threadId
- T4: frontend persists threadId in localStorage per agent+user
- T5: Mastra working memory schema for health-coach (Zod)
- T6: observational memory with gpt-4o-mini
- T7: build + deploy
- T8: cross-session + cross-agent smoke

Multi-session continuity now works: client sends just threadId +
empty messages array on turn 2; server reconstructs history from
Mastra Memory. Cross-agent shared state via resourceId means
health-coach and lifeplan-guide see the same user's working memory.

Server-side persistence at data/agents/memory.db (LibSQL).
Observational compression keeps long threads under context budget
without per-turn LLM cost.

Semantic recall (RAG over deep history) deferred — feature-flag off
by default; design notes in plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Deferred: Semantic recall

Not implemented in this plan. When deep-history queries become a visible need ("what did I tell you about my training plan in March?"), add:

- pgvector or LibSQL vector extension (verify support — if LibSQL doesn't, switch storage to Postgres for embeddings)
- Embedding model: `text-embedding-3-small` (cheap, fast) or `@mastra/fastembed` (local, no API)
- Per-turn cost: ~100-400ms latency + per-turn embedding API call
- Feature flag: `MASTRA_SEMANTIC_RECALL_ENABLED=true` env var; off by default

Trigger to enable: when users start asking questions that reference exchanges from > 1 month ago and we hit the `lastMessages: 20` ceiling.

---

## Spec coverage map

| Failure mode | Tasks |
|---|---|
| Browser refresh wipes conversation history | T1-T4 (server-side persistence with stable threadId) |
| Same user, different agent, no shared context | T5 (working memory by resourceId) |
| Long threads exceed context window | T6 (observational compression) |
| Reload chat, agent forgets stated goals | T5 (working memory persists goals) |

---

## Notes for the implementer

- **Mastra version compatibility.** The Memory research called out compat shims for older `@mastra/core`. Verify version match in T1 step 2; pick whichever combination installs cleanly.
- **API drift.** `Memory.getThreadById` etc. may not be the exact method names — read the installed package's TypeScript declarations (`node_modules/@mastra/memory/dist/*.d.ts`) for ground truth.
- **Per-agent runtimes.** Bootstrap may currently share one MastraAdapter across all agents. T5 needs per-agent overrides (each agent's working memory schema is different). If the orchestrator only accepts one runtime, refactor to allow per-agent override before T5.
- **Storage path inside container.** The data volume is mounted at `/usr/src/app/data` inside the container, backed by the host's Dropbox folder. Verify this path is writable before T7.
- **Observational memory cost.** Background compression calls the configured model (gpt-4o-mini) when thread tokens exceed thresholds. Each compression cycle is ~2-3 LLM calls. Per user per long-running thread, expect a few cents/month — bounded but not free. Monitor.
- **Cross-agent working memory caveat.** Two agents writing to the same resource's working memory CAN race. Mastra has internal mutex but if you fan out to both agents in parallel for the same user, you may get queue waits. For our use case (single user, sequential agent calls), not a problem.
- **Turn 3 of the smoke depends on the LLM actually calling updateWorkingMemory.** That only happens when the system prompt + tool docs encourage it. After T5, the health-coach prompt should include something like "When the user shares a goal, focus area, or constraint, update your working memory." Adjust prompt language if turn 3 fails.
- **Migration of existing transcripts.** Logs at `media/logs/agents/.../*.json` are NOT migrated to Mastra Memory. They're a separate observability artifact. Mastra Memory starts fresh on adoption — the first conversation after deploy is a cold start.
