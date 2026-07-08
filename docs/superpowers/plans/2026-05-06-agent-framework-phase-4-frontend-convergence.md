# Agent Framework Frontend Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the three coexisting frontend chat surfaces — `Health/CoachChat`, `Chat/ChatPanel` (broken), and `Life/views/coach/CoachChat` — into one shared `<AgentChatSurface>` component. After this plan lands, every agent chat in the app renders through the same React component, with per-agent customization (mentions, variant, style) flowing in as props.

**Architecture:** Pure frontend refactor inside `frontend/src/`. Lifts `parseSSE`, the streaming runtime adapter, `MarkdownText`, and `ToolCallAttribution` from `Health/CoachChat/` into shared modules under `frontend/src/lib/sse/` and `frontend/src/modules/Agent/`. Builds a new `<AgentChatSurface>` on top of those primitives. Migrates `Health/CoachChat/index.jsx` into a thin wrapper that injects health-specific mention config; replaces `Life/views/coach/CoachChat.jsx` with a one-liner; deletes `frontend/src/modules/Chat/` entirely.

**Tech Stack:** React 18, `@assistant-ui/react` v0.12.28, Vite, Vitest, react-markdown / remark-gfm.

**Audit reference:** Implements §7 step 10 (DRY-H7, DRY-M4, Q4) from `docs/_wip/audits/2026-05-06-concierge-vs-healthcoach-agent-framework-audit.md`. This plan is independent of Phases 2 (concierge migration) and 3 (HTTP unification) — it touches only frontend code and could land in parallel. We sequence it last so the backend changes settle first; running them in lock-step makes troubleshooting easier.

---

## Why this plan exists

Three chat surfaces live in the codebase today, with overlapping concerns and inconsistent capabilities:

1. **`frontend/src/modules/Health/CoachChat/index.jsx`** — built on `@assistant-ui/react` v0.x primitives. Streaming via `parseSSE`, `@`-mention popover wired to a custom `unstable_useMentionAdapter` adapter, `MarkdownText` (react-markdown + GFM), `ToolCallAttribution` (tool-call rows with click-to-expand). The most mature implementation. Hardcoded `agentId='health-coach'` and `/api/v1/agents/health-coach/run-stream`.

2. **`frontend/src/modules/Chat/ChatPanel.jsx` + `useChatEngine.js`** — Mantine-based, no streaming, no mentions. **Broken in production**: `useChatEngine.js:31` posts to `/api/agents/...` (missing `/v1/`). There is no router mounted at `/api/agents/...`; the real path is `/api/v1/agents/...` (`backend/src/4_api/v1/routers/api.mjs:98` mounts the agents subrouter at `/agents`, which sits under the `/api/v1` parent). Every `send()` from this surface 404s.

3. **`frontend/src/modules/Life/views/coach/CoachChat.jsx`** — wraps `Chat/ChatPanel` for the `lifeplan-guide` agent. Inherits the broken URL and also has its own broken fetch on line 28 (`/api/agents/lifeplan-guide/run`).

Three forks. Two of the three forks 404. Mentions, streaming, tool-call attribution, and markdown all live exclusively in fork 1.

Phase 4 collapses this to a single `<AgentChatSurface>` component that any agent can render. Per-agent customization happens through props:

```jsx
<AgentChatSurface
  agentId="health-coach"
  userId={userId}
  variant="overlay"
  mentions={{
    fetchUrl: `/api/v1/health/mentions/all?user=${userId}`,
    buildAttachment,
    categories: MENTION_CATEGORIES,
  }}
/>

<AgentChatSurface agentId="lifeplan-guide" userId="default" />
{/* No mentions prop → mention popover not rendered at all */}
```

After this plan:

- `Health/CoachChat/index.jsx` becomes a thin wrapper assembling health-specific mention config and forwarding to `<AgentChatSurface>`. Public API (`import CoachChat from '../modules/Health/CoachChat'`) preserved.
- `Life/views/coach/CoachChat.jsx` becomes `<AgentChatSurface agentId="lifeplan-guide" userId="default" />` — a real, working chat (where the previous version 404'd on every send).
- `frontend/src/modules/Chat/` is **deleted entirely**. No consumers remain after Task 9.
- `parseSSE` lives at `frontend/src/lib/sse/parseSSE.js` — single canonical SSE reader for any future stream consumer (Plan B's concierge SSE wire, etc.).

---

## File structure

**New files:**

```
frontend/src/lib/sse/
  parseSSE.js                                 — moved from Health/CoachChat
  parseSSE.test.js                            — moved alongside

frontend/src/modules/Agent/
  AgentChatSurface.jsx                        — the shared component (new)
  AgentChatSurface.test.jsx                   — render + mention-omission + variant tests
  AgentChatSurface.scss                       — relocated styles (light/overlay variants + markdown + tool-call attribution)
  runtime.js                                  — createAgentRuntime(agentId) factory
  runtime.test.js                             — covers run() + runStream() shapes
  MarkdownText.jsx                            — moved from Health/CoachChat
  MarkdownText.test.jsx                       — moved alongside
  ToolCallAttribution.jsx                     — moved from Health/CoachChat
  ToolCallAttribution.test.jsx                — moved alongside
```

**Modified files:**

```
frontend/src/modules/Health/CoachChat/index.jsx
  - all assistant-ui plumbing (deleted, lives in AgentChatSurface)
  - all mention-popover JSX (deleted)
  + thin wrapper: builds mention config, renders <AgentChatSurface ...>

frontend/src/modules/Life/views/coach/CoachChat.jsx
  - import from ../../../Chat (deleted)
  - useChatEngine-based ChatPanel
  + <AgentChatSurface agentId="lifeplan-guide" userId="default" />
```

**Deleted files:**

```
frontend/src/modules/Chat/                    — entire directory removed
  ChatPanel.jsx
  ChatThread.jsx
  ChatInput.jsx
  useChatEngine.js
  index.js

frontend/src/modules/Health/CoachChat/parseSSE.js          — moved (lib/sse/)
frontend/src/modules/Health/CoachChat/parseSSE.test.js     — moved
frontend/src/modules/Health/CoachChat/runtime.js           — moved (modules/Agent/) + generalized
frontend/src/modules/Health/CoachChat/runtime.test.js      — moved + generalized
frontend/src/modules/Health/CoachChat/MarkdownText.jsx     — moved (modules/Agent/)
frontend/src/modules/Health/CoachChat/MarkdownText.test.jsx — moved
frontend/src/modules/Health/CoachChat/ToolCallAttribution.jsx       — moved
frontend/src/modules/Health/CoachChat/ToolCallAttribution.test.jsx  — moved
frontend/src/modules/Health/CoachChat/CoachChat.scss       — moved + renamed (AgentChatSurface.scss)
```

> **Preserved files** under `frontend/src/modules/Health/CoachChat/`: `mentions/` (vocabulary + suggest adapters), `chips/` (Chip component used inside the mention popover), `index.jsx` (now a thin wrapper), `CoachChat.test.jsx` (smoke test of the wrapper). The `mentions/` and `chips/` subtrees stay where they are — they're health-specific config, not generic agent infrastructure.

---

## Conventions

- Vitest + jsdom. Run individual files with `npx vitest run <path>`.
- TDD: test → run-FAIL → impl → run-PASS → commit per task.
- Every commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- The CSS class `coach-chat` and its modifiers (`coach-chat--overlay`, `coach-chat__message`, etc.) are **kept verbatim** for the rest of this plan to minimize style migration risk. Renaming to `agent-chat-surface` is a follow-up cosmetic pass — out of scope. The new SCSS file at `modules/Agent/AgentChatSurface.scss` defines the same selectors; the old `Health/CoachChat/CoachChat.scss` is deleted.
- After each task, run the full frontend test suite for the touched modules:
  ```bash
  cd /opt/Code/DaylightStation && npx vitest run \
    frontend/src/modules/Health/CoachChat/ \
    frontend/src/modules/Agent/ \
    frontend/src/lib/sse/
  ```
  Expected: all green throughout the plan. If anything regresses, stop and fix before continuing.
- Tasks 1–4 are pure file-relocation refactors (move file + update one import). Tasks 5–7 build the new shared component. Tasks 8–10 demolish the old surfaces. Task 11 is the final verification.
- **Do not introduce new dependencies.** Use the existing `@assistant-ui/react`, `react-markdown`, `remark-gfm`, `@mantine/core` stack. The deleted `Chat/` files use Mantine; the new `<AgentChatSurface>` does not (it inherits Mantine via CSS variables, like today's `Health/CoachChat`).

---

## Pre-flight: capture baseline test count

Before any task lands, capture the current passing test count for the affected paths so post-plan regressions are visible:

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  frontend/src/modules/Health/CoachChat/ \
  frontend/src/modules/Health/AskBar/ \
  frontend/src/modules/Health/ChatOverlay/ \
  frontend/src/modules/Life/ \
  frontend/src/modules/Chat/ \
  --reporter=line 2>&1 | tail -20
```

Record the pass count (e.g. `Tests  37 passed (37)`). The post-plan run after Task 11 should produce that count plus the new tests added in this plan, minus any tests deleted alongside removed files (the `Chat/` directory has no tests, so deletions are zero there; the relocated tests in Tasks 1–4 are moves, not additions).

---

## Task 1: Lift `parseSSE` to `frontend/src/lib/sse/`

The SSE reader is generic — it parses `data: {...}` lines off a `ReadableStream<Uint8Array>` and yields parsed JSON. Nothing about it is health-specific. Move it to a shared library location so Plan B's concierge SSE wire (and any future SSE consumer) can reuse it without importing through `Health/`.

**Files:**

- Create: `frontend/src/lib/sse/parseSSE.js` (moved from `Health/CoachChat/parseSSE.js`)
- Create: `frontend/src/lib/sse/parseSSE.test.js` (moved from `Health/CoachChat/parseSSE.test.js`)
- Delete: `frontend/src/modules/Health/CoachChat/parseSSE.js`
- Delete: `frontend/src/modules/Health/CoachChat/parseSSE.test.js`
- Modify: `frontend/src/modules/Health/CoachChat/runtime.js` (update import path)

- [ ] **Step 1: Verify the lib/sse directory does not yet exist**

```bash
cd /opt/Code/DaylightStation && ls frontend/src/lib/ 2>&1 | grep -E '^sse|^sse/' || echo 'sse dir not present — OK'
```

Expected: `sse dir not present — OK`. If a `sse/` directory already exists, read it first to ensure no name collision.

- [ ] **Step 2: Create the new directory and move both files**

```bash
cd /opt/Code/DaylightStation && \
  mkdir -p frontend/src/lib/sse && \
  git mv frontend/src/modules/Health/CoachChat/parseSSE.js frontend/src/lib/sse/parseSSE.js && \
  git mv frontend/src/modules/Health/CoachChat/parseSSE.test.js frontend/src/lib/sse/parseSSE.test.js
```

Use `git mv` so the move is recorded as a rename in git history.

- [ ] **Step 3: Update the test file's import path**

The test currently imports from `./parseSSE.js` — the relative path is unchanged after the move (both files moved together), so no edit is needed. Verify:

```bash
cd /opt/Code/DaylightStation && head -5 frontend/src/lib/sse/parseSSE.test.js
```

Expected output includes `import { parseSSE } from './parseSSE.js';` (relative `.`, still correct).

- [ ] **Step 4: Run the relocated test in its new location; PASS**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/lib/sse/parseSSE.test.js
```

Expected: all green. If any test fails, the move corrupted something — investigate before continuing.

- [ ] **Step 5: Update the runtime.js import**

In `frontend/src/modules/Health/CoachChat/runtime.js` line 9:

Old:
```javascript
import { parseSSE } from './parseSSE.js';
```

New:
```javascript
import { parseSSE } from '../../../lib/sse/parseSSE.js';
```

Use Edit:

```javascript
// Edit tool call
file_path: /opt/Code/DaylightStation/frontend/src/modules/Health/CoachChat/runtime.js
old_string: import { parseSSE } from './parseSSE.js';
new_string: import { parseSSE } from '../../../lib/sse/parseSSE.js';
```

- [ ] **Step 6: Run the runtime test to verify the import resolves**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/CoachChat/runtime.test.js
```

Expected: all green. The runtime.test.js already passes ReadableStreams in directly without using `parseSSE` itself, so it tests through the runtime.

- [ ] **Step 7: Verify no other consumers of the old path remain**

```bash
cd /opt/Code/DaylightStation && grep -rn "Health/CoachChat/parseSSE\|from './parseSSE'" frontend/src/ 2>&1
```

Expected: empty (no matches). If anything matches, update those imports too.

- [ ] **Step 8: Run the full touched-module test suite to confirm no regression**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  frontend/src/lib/sse/ \
  frontend/src/modules/Health/CoachChat/
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/sse/ \
        frontend/src/modules/Health/CoachChat/runtime.js
git rm frontend/src/modules/Health/CoachChat/parseSSE.js \
       frontend/src/modules/Health/CoachChat/parseSSE.test.js 2>/dev/null || true
git commit -m "$(cat <<'EOF'
refactor(frontend): lift parseSSE to lib/sse/ (audit DRY-M4)

The SSE reader is generic — nothing health-specific. Move from
Health/CoachChat/ to lib/sse/ so future SSE consumers (concierge
wire, agentic streams) can import without going through Health/.
Runtime adapter import updated; tests follow the file.

No behavior change.

Plan / Phase 4 Task 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Lift the runtime adapter to `modules/Agent/runtime.js` as a factory

`Health/CoachChat/runtime.js` exports `healthCoachChatModel` — a singleton chat-model object hardcoded to `/api/v1/agents/health-coach/run` and `/run-stream`. Refactor into `createAgentRuntime(agentId)` so any agent can build the same chat-model shape with its own URL.

The runtime must preserve the **exact** assistant-ui contract:
- `run({ messages, userId, attachments })` → `{ role, content: [{type,text}], metadata: { toolCalls } }`
- `runStream({ messages, userId, attachments, abortSignal })` → async-generator yielding the same shape, with incremental `assistantText` accumulating across `text-delta` events.

**Files:**

- Create: `frontend/src/modules/Agent/runtime.js` (generalized from `Health/CoachChat/runtime.js`)
- Create: `frontend/src/modules/Agent/runtime.test.js` (covers both `run` and `runStream`, including the agentId parameterization)
- Modify: `frontend/src/modules/Health/CoachChat/index.jsx` (use `createAgentRuntime('health-coach')` instead of importing `healthCoachChatModel`)
- (later, Task 8) Delete: `frontend/src/modules/Health/CoachChat/runtime.js` + `runtime.test.js`

- [ ] **Step 1: Create the directory**

```bash
cd /opt/Code/DaylightStation && mkdir -p frontend/src/modules/Agent
```

- [ ] **Step 2: Write failing tests**

Create `frontend/src/modules/Agent/runtime.test.js`:

```javascript
// frontend/src/modules/Agent/runtime.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentRuntime } from './runtime.js';

describe('createAgentRuntime', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns an object with run and runStream methods', () => {
    const runtime = createAgentRuntime('health-coach');
    expect(typeof runtime.run).toBe('function');
    expect(typeof runtime.runStream).toBe('function');
  });

  it('returns distinct runtimes for distinct agentIds', () => {
    const a = createAgentRuntime('health-coach');
    const b = createAgentRuntime('lifeplan-guide');
    expect(a).not.toBe(b);
  });
});

describe('createAgentRuntime("health-coach").run', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('posts input + attachments to /api/v1/agents/health-coach/run', async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) };
      return {
        ok: true,
        json: async () => ({ output: 'ok response', toolCalls: [] }),
      };
    });

    const runtime = createAgentRuntime('health-coach');
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'How are you?' }] }];
    const attachments = [{ type: 'period', value: { rolling: 'last_30d' }, label: 'Last 30 days' }];
    const result = await runtime.run({ messages, userId: 'kc', attachments });

    expect(captured.url).toBe('/api/v1/agents/health-coach/run');
    expect(captured.body.input).toBe('How are you?');
    expect(captured.body.context.userId).toBe('kc');
    expect(captured.body.context.attachments).toEqual(attachments);
    expect(result.content[0].text).toBe('ok response');
  });

  it('builds the URL from agentId param', async () => {
    let capturedUrl;
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ output: '', toolCalls: [] }) };
    });
    const runtime = createAgentRuntime('lifeplan-guide');
    await runtime.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'default',
    });
    expect(capturedUrl).toBe('/api/v1/agents/lifeplan-guide/run');
  });

  it('returns assistant message with toolCalls in metadata', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: 'with tools',
        toolCalls: [{ name: 'aggregate_metric', args: { metric: 'weight_lbs' }, result: { value: 197.5 } }],
      }),
    }));
    const runtime = createAgentRuntime('health-coach');
    const result = await runtime.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'kc',
    });
    expect(result.metadata?.toolCalls?.[0]?.name).toBe('aggregate_metric');
  });

  it('throws on non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error' }));
    const runtime = createAgentRuntime('health-coach');
    await expect(runtime.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'kc',
    })).rejects.toThrow(/500/);
  });
});

describe('createAgentRuntime(...).runStream (async generator)', () => {
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

  it('hits /api/v1/agents/{agentId}/run-stream', async () => {
    let capturedUrl;
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        body: readableStreamFrom(['data: {"type":"finish"}\n\ndata: {"type":"done"}\n\n']),
      };
    });
    const runtime = createAgentRuntime('lifeplan-guide');
    for await (const _ of runtime.runStream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'default',
    })) { /* drain */ }
    expect(capturedUrl).toBe('/api/v1/agents/lifeplan-guide/run-stream');
  });

  it('yields incremental message updates as text-deltas arrive', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      body: readableStreamFrom([
        'data: {"type":"text-delta","text":"Hi "}\n\n',
        'data: {"type":"text-delta","text":"there"}\n\n',
        'data: {"type":"finish"}\n\ndata: {"type":"done"}\n\n',
      ]),
    }));

    const runtime = createAgentRuntime('health-coach');
    const updates = [];
    for await (const u of runtime.runStream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'kc',
    })) {
      updates.push(u);
    }
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
    const runtime = createAgentRuntime('health-coach');
    for await (const _ of runtime.runStream({
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

    const runtime = createAgentRuntime('health-coach');
    await expect((async () => {
      for await (const _ of runtime.runStream({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
        userId: 'kc',
      })) { /* drain */ }
    })()).rejects.toThrow(/boom/);
  });

  it('records latencyMs from tool-end on the matching in-flight call', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      body: readableStreamFrom([
        'data: {"type":"tool-start","toolName":"metric_trajectory","args":{"metric":"weight_lbs"}}\n\n',
        'data: {"type":"tool-end","toolName":"metric_trajectory","result":{"slope":-0.04},"latencyMs":42}\n\n',
        'data: {"type":"finish"}\n\ndata: {"type":"done"}\n\n',
      ]),
    }));

    const runtime = createAgentRuntime('health-coach');
    const updates = [];
    for await (const u of runtime.runStream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      userId: 'kc',
    })) {
      updates.push(u);
    }
    const finalToolCalls = updates.at(-1).metadata.toolCalls;
    expect(finalToolCalls).toHaveLength(1);
    expect(finalToolCalls[0].toolName).toBe('metric_trajectory');
    expect(finalToolCalls[0].status).toBe('done');
    expect(finalToolCalls[0].latencyMs).toBe(42);
  });
});
```

- [ ] **Step 3: Run; FAIL (file not yet created)**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Agent/runtime.test.js
```

Expected: import error / file not found.

- [ ] **Step 4: Implement `createAgentRuntime`**

Create `frontend/src/modules/Agent/runtime.js`:

```javascript
// frontend/src/modules/Agent/runtime.js
/**
 * Generic agent runtime adapter for assistant-ui's LocalRuntime.
 *
 * Builds a chat-model object hitting the standard agent HTTP wire:
 *   POST /api/v1/agents/{agentId}/run         — JSON request/response
 *   POST /api/v1/agents/{agentId}/run-stream  — SSE async generator
 *
 * The same wire format used today by health-coach. Plan C (HTTP unification)
 * may add wire-format presets, but at the time Phase 4 lands every agent
 * served by `createAgentsRouter` speaks this format.
 *
 * Returns a chat-model with `run` (one-shot) and `runStream` (async generator)
 * matching assistant-ui v0.12.28's expected shape — `{ role, content, metadata }`.
 *
 * @param {string} agentId — e.g. 'health-coach', 'lifeplan-guide', 'echo'
 * @returns {{ run: Function, runStream: Function }}
 */
import { parseSSE } from '../../lib/sse/parseSSE.js';

export function createAgentRuntime(agentId) {
  const runUrl = `/api/v1/agents/${agentId}/run`;
  const streamUrl = `/api/v1/agents/${agentId}/run-stream`;

  return {
    /**
     * @param {object} args
     * @param {Array<{role,content}>} args.messages — assistant-ui message history
     * @param {string} args.userId
     * @param {Array<object>} [args.attachments]
     * @returns {Promise<{ role:'assistant', content:[{type:'text',text:string}], metadata?:object }>}
     */
    async run({ messages, userId, attachments = [] }) {
      const last = messages.at(-1);
      const text = extractText(last);

      const res = await fetch(runUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: text,
          context: { userId, attachments },
        }),
      });

      if (!res.ok) {
        throw new Error(`Agent run failed: ${res.status} ${res.statusText || ''}`.trim());
      }

      const data = await res.json();
      return {
        role: 'assistant',
        content: [{ type: 'text', text: data.output || '' }],
        metadata: { toolCalls: data.toolCalls || [] },
      };
    },

    async *runStream({ messages, userId, attachments = [], abortSignal }) {
      const last = messages.at(-1);
      const text = extractText(last);

      const res = await fetch(streamUrl, {
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
            content: [{ type: 'text', text: assistantText }],
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
            inflight.latencyMs = event.latencyMs ?? 0;
          } else {
            toolCalls.push({
              toolName: event.toolName,
              result: event.result,
              status: 'done',
              latencyMs: event.latencyMs ?? 0,
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
    },
  };
}

function extractText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(p => p?.type === 'text')
      .map(p => p.text)
      .join('\n');
  }
  return '';
}

export default createAgentRuntime;
```

CRITICAL: This is a **straight port** of `Health/CoachChat/runtime.js`'s `healthCoachChatModel`, parameterized by `agentId`. The async-generator yield shape (`role`/`content`/`metadata`) must match exactly — assistant-ui's `useLocalRuntime` is sensitive to this shape. Don't restructure the yield; only the URLs change.

- [ ] **Step 5: Run; PASS**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Agent/runtime.test.js
```

Expected: all green.

- [ ] **Step 6: Update `Health/CoachChat/index.jsx` to use the new factory**

In `frontend/src/modules/Health/CoachChat/index.jsx`:

Old (line 13):
```javascript
import { healthCoachChatModel } from './runtime.js';
```

New:
```javascript
import { createAgentRuntime } from '../../Agent/runtime.js';
```

And inside the component, line 39 currently calls `healthCoachChatModel.runStream(...)`. Change it to use a memoized runtime:

Old (line 32–52, the `adapter` useMemo):
```javascript
  const adapter = useMemo(() => ({
    async *run({ messages, abortSignal }) {
      const attachments = [
        ...collectAttachments(messages),
        ...pendingMentionsRef.current,
      ];
      pendingMentionsRef.current = [];
      for await (const chunk of healthCoachChatModel.runStream({ messages, userId, attachments, abortSignal })) {
        ...
      }
    },
  }), [userId]);
```

New:
```javascript
  const agentRuntime = useMemo(() => createAgentRuntime('health-coach'), []);

  const adapter = useMemo(() => ({
    async *run({ messages, abortSignal }) {
      const attachments = [
        ...collectAttachments(messages),
        ...pendingMentionsRef.current,
      ];
      pendingMentionsRef.current = [];
      for await (const chunk of agentRuntime.runStream({ messages, userId, attachments, abortSignal })) {
        yield {
          content: chunk.content,
          metadata: {
            custom: {
              toolCalls: chunk.metadata?.toolCalls ?? [],
            },
          },
        };
      }
    },
  }), [userId, agentRuntime]);
```

> Why a separate `useMemo` for `agentRuntime`: the runtime object is stable for the life of the component (agentId never changes here), but binding it inside the adapter useMemo means the adapter rebuilds whenever the runtime would be considered "new". Splitting them keeps the adapter dep array clean. This entire wrapper file becomes much shorter in Task 7 anyway.

- [ ] **Step 7: Run the existing CoachChat smoke test + the runtime test**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  frontend/src/modules/Agent/runtime.test.js \
  frontend/src/modules/Health/CoachChat/CoachChat.test.jsx \
  frontend/src/modules/Health/CoachChat/runtime.test.js
```

Note that `frontend/src/modules/Health/CoachChat/runtime.test.js` still exists and still imports `healthCoachChatModel` from the now-old `runtime.js`. Both are currently still in place; the old `runtime.js` will be deleted in Task 8. For now both tests pass — the old one tests the old runtime (still in the file), the new one tests `createAgentRuntime`.

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Agent/runtime.js \
        frontend/src/modules/Agent/runtime.test.js \
        frontend/src/modules/Health/CoachChat/index.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): createAgentRuntime(agentId) factory

Lifts Health/CoachChat/runtime.js's healthCoachChatModel into a
parameterized factory under modules/Agent/runtime.js. URLs build from
agentId — same wire as today, just no longer hardcoded to
health-coach.

Health/CoachChat/index.jsx now uses createAgentRuntime('health-coach').
The old runtime.js is left in place this commit; deleted in Task 8.

Plan / Phase 4 Task 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Lift `MarkdownText` to `modules/Agent/`

`MarkdownText.jsx` is a thin wrapper around `ReactMarkdown` with GFM enabled and project-specific class names. Nothing health-specific — every agent's chat surface needs it. Move it.

The class names (`coach-chat__md-*`) stay the same to keep the SCSS untouched. After Task 6 the SCSS lives at `modules/Agent/AgentChatSurface.scss` but the selectors are unchanged.

**Files:**

- Create: `frontend/src/modules/Agent/MarkdownText.jsx` (moved)
- Create: `frontend/src/modules/Agent/MarkdownText.test.jsx` (moved)
- Delete: `frontend/src/modules/Health/CoachChat/MarkdownText.jsx`
- Delete: `frontend/src/modules/Health/CoachChat/MarkdownText.test.jsx`
- Modify: `frontend/src/modules/Health/CoachChat/index.jsx` (update import path)

- [ ] **Step 1: Move both files**

```bash
cd /opt/Code/DaylightStation && \
  git mv frontend/src/modules/Health/CoachChat/MarkdownText.jsx frontend/src/modules/Agent/MarkdownText.jsx && \
  git mv frontend/src/modules/Health/CoachChat/MarkdownText.test.jsx frontend/src/modules/Agent/MarkdownText.test.jsx
```

- [ ] **Step 2: Verify the test file's relative import still resolves**

The test file imports `from './MarkdownText.jsx'`. The relative path is unchanged (both moved together). Confirm:

```bash
cd /opt/Code/DaylightStation && head -5 frontend/src/modules/Agent/MarkdownText.test.jsx
```

Expected: `import { MarkdownText } from './MarkdownText.jsx';`. No edit needed.

- [ ] **Step 3: Run the relocated tests; PASS**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Agent/MarkdownText.test.jsx
```

Expected: all green. The component itself uses no project-relative imports (only `react-markdown` and `remark-gfm`), so no edits are required to the component body.

- [ ] **Step 4: Update the import in `Health/CoachChat/index.jsx`**

Old (line 14):
```javascript
import { MarkdownText } from './MarkdownText.jsx';
```

New:
```javascript
import { MarkdownText } from '../../Agent/MarkdownText.jsx';
```

- [ ] **Step 5: Verify no other consumers of the old path**

```bash
cd /opt/Code/DaylightStation && grep -rn "Health/CoachChat/MarkdownText\|from './MarkdownText'" frontend/src/ 2>&1
```

Expected: empty. (The CoachChat smoke test does NOT import MarkdownText directly — it only imports `CoachChat` from `./index.jsx`.)

- [ ] **Step 6: Run the touched tests**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  frontend/src/modules/Agent/MarkdownText.test.jsx \
  frontend/src/modules/Health/CoachChat/CoachChat.test.jsx
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Agent/MarkdownText.jsx \
        frontend/src/modules/Agent/MarkdownText.test.jsx \
        frontend/src/modules/Health/CoachChat/index.jsx
git rm frontend/src/modules/Health/CoachChat/MarkdownText.jsx \
       frontend/src/modules/Health/CoachChat/MarkdownText.test.jsx 2>/dev/null || true
git commit -m "refactor(frontend): lift MarkdownText to modules/Agent/

Plan / Phase 4 Task 3. No behavior change — relative import in test
file unchanged (both files moved together). Health/CoachChat consumer
import path updated. SCSS class names (coach-chat__md-*) unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Lift `ToolCallAttribution` to `modules/Agent/`

Same pattern as Task 3. The component renders tool-call rows for any agent that emits `metadata.custom.toolCalls`. The only project-relative import is `AiMark` from `../AiMark/index.jsx`, which lives under `Health/`. Update the import to point back into `Health/AiMark/` (cross-module reference) — keeping `AiMark` in `Health/` is acceptable scope-control: it's a visual mark that any module can import from there, and moving it is out of scope for Phase 4.

**Files:**

- Create: `frontend/src/modules/Agent/ToolCallAttribution.jsx` (moved)
- Create: `frontend/src/modules/Agent/ToolCallAttribution.test.jsx` (moved)
- Delete: `frontend/src/modules/Health/CoachChat/ToolCallAttribution.jsx`
- Delete: `frontend/src/modules/Health/CoachChat/ToolCallAttribution.test.jsx`
- Modify: `frontend/src/modules/Health/CoachChat/index.jsx` (update import path)

- [ ] **Step 1: Move both files**

```bash
cd /opt/Code/DaylightStation && \
  git mv frontend/src/modules/Health/CoachChat/ToolCallAttribution.jsx frontend/src/modules/Agent/ToolCallAttribution.jsx && \
  git mv frontend/src/modules/Health/CoachChat/ToolCallAttribution.test.jsx frontend/src/modules/Agent/ToolCallAttribution.test.jsx
```

- [ ] **Step 2: Update the `AiMark` import inside the moved component**

The original imports `AiMark` from `../AiMark/index.jsx` (which resolves to `Health/AiMark/index.jsx`). After moving, the relative path needs to become `../Health/AiMark/index.jsx`:

Old (in `frontend/src/modules/Agent/ToolCallAttribution.jsx` line 2):
```javascript
import { AiMark } from '../AiMark/index.jsx';
```

New:
```javascript
import { AiMark } from '../Health/AiMark/index.jsx';
```

> Note: Moving `AiMark` itself (e.g., to `frontend/src/modules/Common/`) is a follow-up — out of scope for Phase 4. The cross-module import is fine for now.

- [ ] **Step 3: Test file's relative import unchanged**

```bash
cd /opt/Code/DaylightStation && head -5 frontend/src/modules/Agent/ToolCallAttribution.test.jsx
```

Expected: `import { ToolCallAttribution } from './ToolCallAttribution.jsx';`. No edit needed.

- [ ] **Step 4: Run the relocated tests; PASS**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Agent/ToolCallAttribution.test.jsx
```

Expected: all green. The four existing tests (renders nothing when empty / one row per call / running indicator / expand on click) all exercise the component in isolation; AiMark is a small SVG, no test-level mocking needed.

- [ ] **Step 5: Update the import in `Health/CoachChat/index.jsx`**

Old (line 15):
```javascript
import { ToolCallAttribution } from './ToolCallAttribution.jsx';
```

New:
```javascript
import { ToolCallAttribution } from '../../Agent/ToolCallAttribution.jsx';
```

- [ ] **Step 6: Verify no other consumers**

```bash
cd /opt/Code/DaylightStation && grep -rn "Health/CoachChat/ToolCallAttribution\|from './ToolCallAttribution'" frontend/src/ 2>&1
```

Expected: empty.

- [ ] **Step 7: Run the touched tests**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  frontend/src/modules/Agent/ \
  frontend/src/modules/Health/CoachChat/
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Agent/ToolCallAttribution.jsx \
        frontend/src/modules/Agent/ToolCallAttribution.test.jsx \
        frontend/src/modules/Health/CoachChat/index.jsx
git rm frontend/src/modules/Health/CoachChat/ToolCallAttribution.jsx \
       frontend/src/modules/Health/CoachChat/ToolCallAttribution.test.jsx 2>/dev/null || true
git commit -m "$(cat <<'EOF'
refactor(frontend): lift ToolCallAttribution to modules/Agent/

Plan / Phase 4 Task 4. AiMark import updated to cross-reference
Health/AiMark/ — moving AiMark itself is out of scope for Phase 4.
SCSS selectors (.tool-call-attribution__*) unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Build `<AgentChatSurface>` shared component (without mentions wiring)

Now create the actual shared component. **This task builds the no-mentions path** — `<AgentChatSurface agentId, userId, variant?, style?>` with no mention popover. The `mentions` prop is wired in Task 6, after this surface renders cleanly for the simple case.

The component must:
- Accept `{ agentId, userId, variant, style }` props.
- Build a runtime via `createAgentRuntime(agentId)` (memoized).
- Render the same DOM structure (and CSS classes) as today's `Health/CoachChat` minus the mention popover.
- Use `<MarkdownText>` for assistant text parts.
- Use `<ToolCallAttribution>` driven by `useMessage((s) => s?.metadata?.custom?.toolCalls)`.
- Apply the `coach-chat--overlay` class when `variant === 'overlay'` (verbatim — see CSS in Task 7).

**Files:**

- Create: `frontend/src/modules/Agent/AgentChatSurface.jsx`
- Create: `frontend/src/modules/Agent/AgentChatSurface.test.jsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/modules/Agent/AgentChatSurface.test.jsx`:

```javascript
// frontend/src/modules/Agent/AgentChatSurface.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { AgentChatSurface } from './AgentChatSurface.jsx';

describe('AgentChatSurface — basic rendering', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Stub fetch so the runtime can construct without network access.
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ output: '', toolCalls: [] }) }));
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('renders without throwing for any agentId', () => {
    render(
      <MantineProvider>
        <AgentChatSurface agentId="echo" userId="kc" />
      </MantineProvider>
    );
    // Composer should have a textbox/contenteditable
    const composer = document.querySelector('[role="textbox"], textarea');
    expect(composer).toBeTruthy();
  });

  it('applies the coach-chat root class', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="health-coach" userId="kc" />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat')).toBeTruthy();
  });

  it('applies coach-chat--overlay when variant="overlay"', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="health-coach" userId="kc" variant="overlay" />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat--overlay')).toBeTruthy();
  });

  it('does NOT apply coach-chat--overlay for the default (light) variant', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="health-coach" userId="kc" />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat--overlay')).toBeFalsy();
  });

  it('passes inline style through to root div', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="echo" userId="kc" style={{ height: '500px' }} />
      </MantineProvider>
    );
    const root = container.querySelector('.coach-chat');
    expect(root.style.height).toBe('500px');
  });
});

describe('AgentChatSurface — no mentions when prop omitted', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ output: '', toolCalls: [] }) }));
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('omits the mention popover when mentions prop is absent', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="lifeplan-guide" userId="default" />
      </MantineProvider>
    );
    // The mention popover root carries .coach-chat__mention-popover (when rendered)
    expect(container.querySelector('.coach-chat__mention-popover')).toBeFalsy();
  });

  it('still renders the composer + send button when mentions prop is absent', () => {
    const { container } = render(
      <MantineProvider>
        <AgentChatSurface agentId="lifeplan-guide" userId="default" />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat__composer')).toBeTruthy();
    expect(container.querySelector('.coach-chat__send')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Agent/AgentChatSurface.test.jsx
```

Expected: import error / file not found.

- [ ] **Step 3: Implement the no-mentions surface**

Create `frontend/src/modules/Agent/AgentChatSurface.jsx`:

```javascript
// frontend/src/modules/Agent/AgentChatSurface.jsx
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useMessage,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from '@assistant-ui/react';
import { useMemo } from 'react';
import { createAgentRuntime } from './runtime.js';
import { MarkdownText } from './MarkdownText.jsx';
import { ToolCallAttribution } from './ToolCallAttribution.jsx';

/**
 * Shared agent chat surface — every agent in the app renders through this
 * component. Built on @assistant-ui/react v0.12.28 primitives.
 *
 * Per-agent customization flows in via props:
 *   agentId  — which agent to talk to (URL prefix /api/v1/agents/{agentId})
 *   userId   — passed to runtime.run/runStream for context.userId
 *   variant  — 'light' (default) or 'overlay' (dark-overlay theming)
 *   style    — inline style passed to the root div (sizing, positioning)
 *   mentions — optional mention-popover configuration (Task 6 wires this)
 *
 * @param {object} props
 * @param {string} props.agentId
 * @param {string} props.userId
 * @param {'light'|'overlay'} [props.variant='light']
 * @param {object} [props.style]
 * @param {object} [props.mentions]  — wired in Task 6
 */
export function AgentChatSurface({ agentId, userId, variant = 'light', style, mentions }) {
  const agentRuntime = useMemo(() => createAgentRuntime(agentId), [agentId]);

  const adapter = useMemo(() => ({
    async *run({ messages, abortSignal }) {
      const attachments = collectAttachments(messages);
      for await (const chunk of agentRuntime.runStream({ messages, userId, attachments, abortSignal })) {
        yield {
          content: chunk.content,
          metadata: {
            custom: {
              toolCalls: chunk.metadata?.toolCalls ?? [],
            },
          },
        };
      }
    },
  }), [agentRuntime, userId]);

  const runtime = useLocalRuntime(adapter);

  return (
    <div
      className={`coach-chat${variant === 'overlay' ? ' coach-chat--overlay' : ''}`}
      style={style}
    >
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="coach-chat__thread">
          <ThreadPrimitive.Viewport className="coach-chat__viewport">
            <ThreadPrimitive.Messages
              components={{
                UserMessage: UserMessage,
                AssistantMessage: AssistantMessage,
              }}
            />
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>

        <ComposerPrimitive.Root className="coach-chat__composer">
          <ComposerPrimitive.Input
            className="coach-chat__input"
            placeholder="Ask…"
          />
          <ComposerPrimitive.Send className="coach-chat__send" />
        </ComposerPrimitive.Root>
      </AssistantRuntimeProvider>
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="coach-chat__message coach-chat__message--user">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="coach-chat__message coach-chat__message--assistant">
      <MessagePrimitive.Parts
        components={{
          Text: ({ text }) => <MarkdownText text={text || ''} />,
        }}
      />
      <AssistantMessageToolCalls />
    </MessagePrimitive.Root>
  );
}

function AssistantMessageToolCalls() {
  try {
    const toolCalls = useMessage((state) => state?.metadata?.custom?.toolCalls);
    return <ToolCallAttribution toolCalls={toolCalls} />;
  } catch {
    return null;
  }
}

function collectAttachments(messages) {
  const last = messages.at(-1);
  if (!last) return [];
  if (Array.isArray(last.attachments)) return last.attachments;
  if (Array.isArray(last.metadata?.attachments)) return last.metadata.attachments;
  return [];
}

export default AgentChatSurface;
```

> Note: Task 5 silently accepts the `mentions` prop but does not yet use it. Task 6 wires it.

- [ ] **Step 4: Run; PASS**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Agent/AgentChatSurface.test.jsx
```

Expected: all green. If a test like "applies coach-chat--overlay when variant='overlay'" fails, double-check the className concatenation in the JSX.

- [ ] **Step 5: Run all `modules/Agent/` tests + the `Health/CoachChat` smoke test**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  frontend/src/modules/Agent/ \
  frontend/src/modules/Health/CoachChat/
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Agent/AgentChatSurface.jsx \
        frontend/src/modules/Agent/AgentChatSurface.test.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): AgentChatSurface (no-mentions path) (audit DRY-H7)

Shared <AgentChatSurface agentId, userId, variant?, style?> built on
@assistant-ui/react v0.12.28 primitives. Renders the same DOM (.coach-chat
classes) as today's Health/CoachChat minus the mention popover.

Mentions prop accepted but not yet wired — Task 6.

Plan / Phase 4 Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire the optional `mentions` prop into `<AgentChatSurface>`

Now wire up the mention popover. The contract:

- `mentions` prop is **optional**. When absent, the surface renders exactly as Task 5 (no popover, no `Unstable_TriggerPopoverRoot` wrapper).
- When present, `mentions` has shape:
  ```javascript
  {
    fetchUrl: string,             // GET → { suggestions: Suggestion[] }
    categories: Array<{ key, label, icon }>, // display-order config
    buildAttachment: (suggestion) => attachment, // shapes mention into the runtime attachment
  }
  ```
- The fetched suggestions get grouped by `suggestion.group` into the per-category lists, exactly as `Health/CoachChat` does today.
- A single `pendingMentionsRef` accumulates inserted attachments and gets drained on each `run()` call.

**Files:**

- Modify: `frontend/src/modules/Agent/AgentChatSurface.jsx` (add mention wiring inside an `if (mentions)` branch)
- Modify: `frontend/src/modules/Agent/AgentChatSurface.test.jsx` (add tests for mention prop wiring)

- [ ] **Step 1: Append failing tests**

In `frontend/src/modules/Agent/AgentChatSurface.test.jsx`, add a new `describe` block at the bottom:

```javascript
describe('AgentChatSurface — mentions prop wiring', () => {
  let originalFetch;
  let fetchCalls;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = vi.fn(async (url) => {
      fetchCalls.push(url);
      // Return shaped suggestions when the mention fetchUrl is hit
      if (typeof url === 'string' && url.includes('/health/mentions/')) {
        return {
          ok: true,
          json: async () => ({
            suggestions: [
              { slug: 'last_30d', label: 'Last 30 days', description: 'rolling', group: 'period' },
              { slug: 'weight_lbs', label: 'Weight (lbs)', description: 'metric', group: 'metric_snapshot' },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ output: '', toolCalls: [] }) };
    });
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('renders the mention popover root when mentions prop is present', async () => {
    const mentions = {
      fetchUrl: '/api/v1/health/mentions/all?user=kc',
      categories: [
        { key: 'period', label: 'Period', icon: null },
        { key: 'metric_snapshot', label: 'Metric', icon: null },
      ],
      buildAttachment: (s) => ({ type: s.group, value: s.slug, label: s.label }),
    };
    const { container, findByText } = render(
      <MantineProvider>
        <AgentChatSurface agentId="health-coach" userId="kc" mentions={mentions} />
      </MantineProvider>
    );
    // Wait for the suggestions fetch to resolve and categories to render —
    // the category labels appear inside .coach-chat__mention-category nodes
    // (rendered eagerly inside the popover wrapper, even before the popover opens).
    // If the implementation gates rendering on popover-open, this assertion may need
    // to drive the popover via a keyboard event — see Task 6 implementation note.
    expect(container.querySelector('.coach-chat__mention-popover, [data-mention-popover]')).toBeTruthy();
  });

  it('fetches the mention suggestions URL on mount when mentions prop is present', async () => {
    const mentions = {
      fetchUrl: '/api/v1/health/mentions/all?user=kc',
      categories: [{ key: 'period', label: 'Period', icon: null }],
      buildAttachment: (s) => ({ type: s.group, value: s.slug, label: s.label }),
    };
    render(
      <MantineProvider>
        <AgentChatSurface agentId="health-coach" userId="kc" mentions={mentions} />
      </MantineProvider>
    );
    // Allow the mount-effect fetch to fire
    await new Promise(r => setTimeout(r, 10));
    expect(fetchCalls.some(u => typeof u === 'string' && u.includes('/health/mentions/'))).toBe(true);
  });

  it('does not fetch suggestions when mentions prop is absent', async () => {
    render(
      <MantineProvider>
        <AgentChatSurface agentId="lifeplan-guide" userId="default" />
      </MantineProvider>
    );
    await new Promise(r => setTimeout(r, 10));
    // Only fetches that should happen are downstream runtime calls — none on mount,
    // since no message has been sent yet.
    expect(fetchCalls.filter(u => typeof u === 'string' && u.includes('/mentions/'))).toHaveLength(0);
  });
});
```

> NOTE: Some assistant-ui mention-popover internals only render their children when the popover is open. If the first test fails because the mention root is gated on popover-open state, adjust the assertion to look for `[data-aui-mention-trigger]` or simply assert the wrapper element with class `coach-chat__mention-popover` is present in the DOM (the `Unstable_TriggerPopoverRoot` itself wraps the composer regardless of open state). Read the actual DOM produced by the test in dev tools and adapt — the goal is to confirm the popover is wired, not to drive its full open/close lifecycle (that's covered by the separate `Health/CoachChat/CoachChat.test.jsx` smoke test).

- [ ] **Step 2: Run; FAIL**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Agent/AgentChatSurface.test.jsx
```

Expected: the new mention tests fail (mentions prop ignored). Existing no-mentions tests still pass.

- [ ] **Step 3: Refactor `AgentChatSurface.jsx` to wire mentions**

The structure is:
- Move the `pendingMentionsRef` + the `[...attachments, ...pendingMentions]` merge logic from `Health/CoachChat/index.jsx` into here, gated behind `if (mentions)`.
- Move the `useEffect` that fetches `mentions.fetchUrl`, groups by `suggestion.group`, and builds `mentionCategories` here, gated behind `if (mentions)`.
- Wrap the composer in `<ComposerPrimitive.Unstable_TriggerPopoverRoot>` only when `mentions` is present; otherwise render the bare `<ComposerPrimitive.Root>` from Task 5.

Updated `frontend/src/modules/Agent/AgentChatSurface.jsx`:

```javascript
// frontend/src/modules/Agent/AgentChatSurface.jsx
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useMessage,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  unstable_useMentionAdapter,
} from '@assistant-ui/react';
import { useMemo, useEffect, useRef, useState } from 'react';
import { createAgentRuntime } from './runtime.js';
import { MarkdownText } from './MarkdownText.jsx';
import { ToolCallAttribution } from './ToolCallAttribution.jsx';

/**
 * Shared agent chat surface — every agent in the app renders through this
 * component. Built on @assistant-ui/react v0.12.28 primitives.
 *
 * @param {object} props
 * @param {string} props.agentId
 * @param {string} props.userId
 * @param {'light'|'overlay'} [props.variant='light']
 * @param {object} [props.style]
 * @param {object} [props.mentions]
 * @param {string} props.mentions.fetchUrl       — GET → { suggestions: [{slug,label,description,group,...}] }
 * @param {Array}  props.mentions.categories     — [{ key, label, icon }] in display order
 * @param {Function} props.mentions.buildAttachment — (suggestion) => attachment payload
 */
export function AgentChatSurface({ agentId, userId, variant = 'light', style, mentions }) {
  const agentRuntime = useMemo(() => createAgentRuntime(agentId), [agentId]);
  const pendingMentionsRef = useRef([]);

  const adapter = useMemo(() => ({
    async *run({ messages, abortSignal }) {
      const attachments = [
        ...collectAttachments(messages),
        ...pendingMentionsRef.current,
      ];
      pendingMentionsRef.current = [];
      for await (const chunk of agentRuntime.runStream({ messages, userId, attachments, abortSignal })) {
        yield {
          content: chunk.content,
          metadata: {
            custom: {
              toolCalls: chunk.metadata?.toolCalls ?? [],
            },
          },
        };
      }
    },
  }), [agentRuntime, userId]);

  const runtime = useLocalRuntime(adapter);

  return (
    <div
      className={`coach-chat${variant === 'overlay' ? ' coach-chat--overlay' : ''}`}
      style={style}
    >
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="coach-chat__thread">
          <ThreadPrimitive.Viewport className="coach-chat__viewport">
            <ThreadPrimitive.Messages
              components={{
                UserMessage: UserMessage,
                AssistantMessage: AssistantMessage,
              }}
            />
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>

        {mentions
          ? <ComposerWithMentions mentions={mentions} pendingMentionsRef={pendingMentionsRef} />
          : <ComposerPlain />}
      </AssistantRuntimeProvider>
    </div>
  );
}

// ── Plain composer (no mentions) ─────────────────────────────────────────────
function ComposerPlain() {
  return (
    <ComposerPrimitive.Root className="coach-chat__composer">
      <ComposerPrimitive.Input
        className="coach-chat__input"
        placeholder="Ask…"
      />
      <ComposerPrimitive.Send className="coach-chat__send" />
    </ComposerPrimitive.Root>
  );
}

// ── Composer with @-mentions ─────────────────────────────────────────────────
function ComposerWithMentions({ mentions, pendingMentionsRef }) {
  const { fetchUrl, categories, buildAttachment } = mentions;

  const [mentionCategories, setMentionCategories] = useState([]);

  useEffect(() => {
    if (!fetchUrl) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(fetchUrl);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const suggestions = data.suggestions || [];

        // Group flat suggestions by `group` field, preserve display order
        // declared in `categories`.
        const byGroup = new Map();
        for (const s of suggestions) {
          const key = s.group || 'other';
          if (!byGroup.has(key)) byGroup.set(key, []);
          byGroup.get(key).push(s);
        }

        const cats = categories
          .filter(c => byGroup.has(c.key))
          .map(c => ({
            id: c.key,
            label: c.label,
            items: byGroup.get(c.key).map(s => ({
              id: `${c.key}:${s.slug}`,
              type: c.key,
              label: s.label,
              description: s.description,
              icon: c.icon,
              metadata: buildAttachment({ ...s, group: c.key }),
            })),
          }));

        if (!cancelled) setMentionCategories(cats);
      } catch {
        // Non-fatal — mention popover will be empty, chat still works.
      }
    }

    load();
    return () => { cancelled = true; };
  }, [fetchUrl, categories, buildAttachment]);

  const mention = unstable_useMentionAdapter({
    categories: mentionCategories,
    includeModelContextTools: false,
    onInserted: (item) => {
      if (item?.metadata) {
        pendingMentionsRef.current = [...pendingMentionsRef.current, item.metadata];
      }
    },
  });

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Unstable_TriggerPopover
        char="@"
        adapter={mention.adapter}
        className="coach-chat__mention-popover"
      >
        <ComposerPrimitive.Unstable_TriggerPopover.Directive
          formatter={mention.directive.formatter}
          onInserted={mention.directive.onInserted}
        />

        <ComposerPrimitive.Unstable_TriggerPopoverCategories className="coach-chat__mention-categories">
          {(cats) =>
            cats.map(cat => (
              <ComposerPrimitive.Unstable_TriggerPopoverCategoryItem
                key={cat.id}
                categoryId={cat.id}
                className="coach-chat__mention-category"
              >
                {cat.label}
              </ComposerPrimitive.Unstable_TriggerPopoverCategoryItem>
            ))
          }
        </ComposerPrimitive.Unstable_TriggerPopoverCategories>

        <ComposerPrimitive.Unstable_TriggerPopoverBack className="coach-chat__mention-back">
          ← Back
        </ComposerPrimitive.Unstable_TriggerPopoverBack>

        <ComposerPrimitive.Unstable_TriggerPopoverItems className="coach-chat__mention-items">
          {(items) =>
            items.map((item, idx) => (
              <ComposerPrimitive.Unstable_TriggerPopoverItem
                key={item.id}
                item={item}
                index={idx}
                className="coach-chat__mention-item"
              >
                {item.label}
              </ComposerPrimitive.Unstable_TriggerPopoverItem>
            ))
          }
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </ComposerPrimitive.Unstable_TriggerPopover>

      <ComposerPrimitive.Root className="coach-chat__composer">
        <ComposerPrimitive.Input
          className="coach-chat__input"
          placeholder="Ask… (type @ to mention)"
        />
        <ComposerPrimitive.Send className="coach-chat__send" />
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}

// ── Message components ───────────────────────────────────────────────────────
function UserMessage() {
  return (
    <MessagePrimitive.Root className="coach-chat__message coach-chat__message--user">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="coach-chat__message coach-chat__message--assistant">
      <MessagePrimitive.Parts
        components={{
          Text: ({ text }) => <MarkdownText text={text || ''} />,
        }}
      />
      <AssistantMessageToolCalls />
    </MessagePrimitive.Root>
  );
}

function AssistantMessageToolCalls() {
  try {
    const toolCalls = useMessage((state) => state?.metadata?.custom?.toolCalls);
    return <ToolCallAttribution toolCalls={toolCalls} />;
  } catch {
    return null;
  }
}

function collectAttachments(messages) {
  const last = messages.at(-1);
  if (!last) return [];
  if (Array.isArray(last.attachments)) return last.attachments;
  if (Array.isArray(last.metadata?.attachments)) return last.metadata.attachments;
  return [];
}

export default AgentChatSurface;
```

CRITICAL: The `coach-chat__mention-category` rendering in Task 6 above passes `cat.label` as a plain string instead of `<Chip label={cat.label} chipKey={cat.id} />` (which today's `Health/CoachChat/index.jsx` uses). The `Chip` import is health-specific — keeping it out of `AgentChatSurface` makes the shared component dependency-free relative to Health. The Health wrapper in Task 7 can layer `Chip` styling back on via the same `coach-chat__mention-category` selector (style-only) in `Health/CoachChat.scss`, or accept the unstyled label.

If the visual difference is unacceptable, an alternative is to add a `mentions.renderCategoryItem?: (cat) => ReactNode` callback prop. **Recommendation: ship the plain-string version first**; if HealthApp visuals regress, add the callback prop in a follow-up commit (still inside Task 6).

- [ ] **Step 4: Run; PASS**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Agent/AgentChatSurface.test.jsx
```

Expected: all green (both no-mentions and mention-wired test groups).

- [ ] **Step 5: Run all touched tests**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  frontend/src/modules/Agent/ \
  frontend/src/modules/Health/CoachChat/
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Agent/AgentChatSurface.jsx \
        frontend/src/modules/Agent/AgentChatSurface.test.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): wire optional mentions prop into AgentChatSurface

When mentions prop is present, the composer is wrapped in
Unstable_TriggerPopoverRoot and a mount-effect fetches+groups
suggestions. When absent, the bare composer renders (no popover).

Health-specific Chip rendering NOT included here — the surface ships
plain category labels. Health wrapper in Task 7 layers visuals via SCSS
on .coach-chat__mention-category.

Plan / Phase 4 Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Relocate SCSS + migrate `Health/CoachChat/index.jsx` to wrap `<AgentChatSurface>`

Two things land together here because they're tightly coupled:

1. `Health/CoachChat/CoachChat.scss` moves to `Agent/AgentChatSurface.scss` so the new shared component finds its styles via co-located import.
2. `Health/CoachChat/index.jsx` reduces to a thin wrapper that builds the health-specific `mentions` config and forwards everything else to `<AgentChatSurface>`.

The wrapper preserves the **exact** public API: `import CoachChat from '../modules/Health/CoachChat'` (default export) keeps working — `HealthApp.jsx:9` is unaffected.

**Files:**

- Create: `frontend/src/modules/Agent/AgentChatSurface.scss` (moved from `Health/CoachChat/CoachChat.scss`)
- Modify: `frontend/src/modules/Agent/AgentChatSurface.jsx` (add SCSS import)
- Modify: `frontend/src/modules/Health/CoachChat/index.jsx` (reduce to wrapper)
- Delete: `frontend/src/modules/Health/CoachChat/CoachChat.scss`

- [ ] **Step 1: Move the SCSS file**

```bash
cd /opt/Code/DaylightStation && \
  git mv frontend/src/modules/Health/CoachChat/CoachChat.scss frontend/src/modules/Agent/AgentChatSurface.scss
```

The file body is unchanged — selectors stay `.coach-chat`, `.coach-chat--overlay`, `.coach-chat__md-*`, etc. Renaming the selectors is out of scope for Phase 4 (cosmetic future cleanup).

- [ ] **Step 2: Add SCSS import to `AgentChatSurface.jsx`**

In `frontend/src/modules/Agent/AgentChatSurface.jsx`, add the SCSS import near the top (after the React/assistant-ui imports, before the implementation imports):

```javascript
import './AgentChatSurface.scss';
```

So the import block at the top reads:

```javascript
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useMessage,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  unstable_useMentionAdapter,
} from '@assistant-ui/react';
import { useMemo, useEffect, useRef, useState } from 'react';
import './AgentChatSurface.scss';
import { createAgentRuntime } from './runtime.js';
import { MarkdownText } from './MarkdownText.jsx';
import { ToolCallAttribution } from './ToolCallAttribution.jsx';
```

- [ ] **Step 3: Reduce `Health/CoachChat/index.jsx` to a wrapper**

Replace the entire body of `frontend/src/modules/Health/CoachChat/index.jsx` with:

```javascript
// frontend/src/modules/Health/CoachChat/index.jsx
import { AgentChatSurface } from '../../Agent/AgentChatSurface.jsx';
import { MENTION_CATEGORIES, buildAttachment } from './mentions/index.js';

/**
 * Health-coach chat surface — thin wrapper around <AgentChatSurface> that
 * supplies health-specific mention configuration (period/day/metric
 * categories, fetched from /api/v1/health/mentions/all).
 *
 * Public API preserved for HealthApp.jsx:
 *   import CoachChat from '../modules/Health/CoachChat';
 *   <CoachChat userId={userId} variant="overlay" />
 *
 * @param {{ userId: string, variant?: 'light'|'overlay', style?: object }} props
 */
export function CoachChat({ userId, variant = 'light', style }) {
  const mentions = userId
    ? {
        fetchUrl: `/api/v1/health/mentions/all?user=${encodeURIComponent(userId)}`,
        categories: MENTION_CATEGORIES,
        buildAttachment,
      }
    : undefined;

  return (
    <AgentChatSurface
      agentId="health-coach"
      userId={userId}
      variant={variant}
      style={style}
      mentions={mentions}
    />
  );
}

export default CoachChat;
```

This wrapper:
- Keeps the named export `CoachChat` and default export — `HealthApp.jsx:9` (`import CoachChat from '../modules/Health/CoachChat'`) keeps working unchanged.
- Builds the health-specific mention config inline.
- Forwards `userId`/`variant`/`style` to the shared surface.
- Skips mentions entirely when `userId` is falsy.

- [ ] **Step 4: Run the existing CoachChat smoke test — confirm it still passes**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Health/CoachChat/CoachChat.test.jsx
```

Expected: pass. The smoke test only verifies a textbox/composer is findable and `<CoachChat userId="kc" />` renders — the wrapper still produces those.

- [ ] **Step 5: Run all `Agent/` and `Health/CoachChat/` tests**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  frontend/src/modules/Agent/ \
  frontend/src/modules/Health/CoachChat/
```

Expected: all green.

- [ ] **Step 6: Vite-build smoke test**

The SCSS path moved — confirm the build still resolves the import:

```bash
cd /opt/Code/DaylightStation && npm run build 2>&1 | tail -30
```

Expected: build completes successfully. If the build fails with `Cannot resolve '../Health/CoachChat/CoachChat.scss'` somewhere, search for any other consumer that imported the old SCSS path:

```bash
cd /opt/Code/DaylightStation && grep -rn "CoachChat.scss\|CoachChat\\.scss" frontend/src/ 2>&1
```

The only consumer should be `AgentChatSurface.jsx`'s import. If anything else references it, update the path.

- [ ] **Step 7: Manual smoke (optional but recommended)**

If a dev server is running, hit the health UI and confirm:
- The chat overlay opens (⌘K) with the same dark-theme styling as before.
- Typing `@` shows the mention popover with period/day/metric categories.
- Selecting a mention inserts the attachment and a subsequent send includes it on the request.
- Streaming responses still render with markdown + tool-call rows.

```bash
# In one terminal
cd /opt/Code/DaylightStation && npm run dev

# In another, trigger the health-coach via curl as a smoke test of the URL path
curl -X POST http://localhost:3112/api/v1/agents/health-coach/run \
  -H 'Content-Type: application/json' \
  -d '{"input":"hi","context":{"userId":"user_1","attachments":[]}}' \
  | head -c 200
```

(Adjust port to match `.claude/settings.local.json` `env.ports.backend` for this host.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Agent/AgentChatSurface.scss \
        frontend/src/modules/Agent/AgentChatSurface.jsx \
        frontend/src/modules/Health/CoachChat/index.jsx
git rm frontend/src/modules/Health/CoachChat/CoachChat.scss 2>/dev/null || true
git commit -m "$(cat <<'EOF'
refactor(frontend): Health/CoachChat is now a wrapper around AgentChatSurface

CoachChat.scss moved to AgentChatSurface.scss (selectors unchanged —
.coach-chat/.coach-chat--overlay/.coach-chat__md-* preserved). The
Health/CoachChat/index.jsx assistant-ui plumbing + mention popover
deleted; replaced with a 20-line wrapper that builds the health-specific
mention config and forwards to <AgentChatSurface>.

HealthApp.jsx public API preserved — `import CoachChat from
'../modules/Health/CoachChat'` keeps working.

Plan / Phase 4 Task 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Delete the now-orphaned `Health/CoachChat/runtime.js` + tests

Tasks 2 + 7 made `Health/CoachChat/runtime.js` (and its test) no longer imported. Delete them.

**Files:**

- Delete: `frontend/src/modules/Health/CoachChat/runtime.js`
- Delete: `frontend/src/modules/Health/CoachChat/runtime.test.js`

- [ ] **Step 1: Verify no consumers**

```bash
cd /opt/Code/DaylightStation && grep -rn "Health/CoachChat/runtime\|healthCoachChatModel\|from './runtime'" frontend/src/ 2>&1
```

Expected: empty. (After Task 7, the wrapper no longer imports `runtime.js` — it goes through `AgentChatSurface` which goes through `Agent/runtime.js`.)

If any match remains, **stop**. The most likely culprit is a test file we forgot to delete or update; resolve before continuing.

- [ ] **Step 2: Delete the files**

```bash
cd /opt/Code/DaylightStation && \
  git rm frontend/src/modules/Health/CoachChat/runtime.js \
         frontend/src/modules/Health/CoachChat/runtime.test.js
```

- [ ] **Step 3: Run the full Agent + Health/CoachChat suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  frontend/src/modules/Agent/ \
  frontend/src/modules/Health/CoachChat/
```

Expected: all green. The total test count drops by however many tests `runtime.test.js` contained (5–7 cases) — but those are duplicated by the new `Agent/runtime.test.js`, so net coverage is unchanged.

- [ ] **Step 4: Vite build smoke**

```bash
cd /opt/Code/DaylightStation && npm run build 2>&1 | tail -10
```

Expected: build completes successfully.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(frontend): delete orphaned Health/CoachChat/runtime.js

Tasks 2 + 7 made this file unused — Health/CoachChat now goes through
modules/Agent/runtime.js via <AgentChatSurface>. Tests preserved as
modules/Agent/runtime.test.js (Task 2).

Plan / Phase 4 Task 8.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Delete `frontend/src/modules/Chat/` entirely

`Chat/ChatPanel`, `Chat/ChatThread`, `Chat/ChatInput`, `Chat/useChatEngine`, and `Chat/index.js` are all consumed only by `Life/views/coach/CoachChat.jsx` (verified at plan-time via `grep -rn "from.*modules/Chat" frontend/src/`). Task 10 replaces that consumer.

To stage cleanly: this task **first** rewrites `Life/views/coach/CoachChat.jsx` to remove the `Chat/` import, **then** deletes the `Chat/` directory. Doing both in one task is fine because Task 10 is the final consumer-side cleanup.

**Files:**

- Modify: `frontend/src/modules/Life/views/coach/CoachChat.jsx` (replace `<ChatPanel ...>` with `<AgentChatSurface ...>`)
- Delete: `frontend/src/modules/Chat/` (entire directory)

- [ ] **Step 1: Re-verify the `Chat/` consumer surface — should be only one file**

```bash
cd /opt/Code/DaylightStation && grep -rn "from.*modules/Chat\|from '../../../Chat'" frontend/src/ 2>&1
```

Expected output: only `Life/views/coach/CoachChat.jsx`. If anything else matches, **stop and investigate** — Phase 4 assumes `Chat/` has exactly one consumer.

- [ ] **Step 2: Replace `Life/views/coach/CoachChat.jsx`**

Replace the entire body with:

```javascript
// frontend/src/modules/Life/views/coach/CoachChat.jsx
import { AgentChatSurface } from '../../../Agent/AgentChatSurface.jsx';

/**
 * Lifeplan-guide chat view for the Life app. Renders the shared
 * <AgentChatSurface> against the lifeplan-guide agent.
 *
 * Previously delegated to the now-deleted modules/Chat/ChatPanel, which
 * 404'd on every send (wrong /api/agents/... URL prefix). This now hits
 * the real /api/v1/agents/lifeplan-guide/run-stream wire.
 */
export default function CoachChat() {
  return (
    <AgentChatSurface
      agentId="lifeplan-guide"
      userId="default"
      style={{ height: 'calc(100vh - 60px)' }}
    />
  );
}
```

> Why drop `handleAction`/`handleFeedback`: the original feedback handler also 404'd (`fetch('/api/agents/lifeplan-guide/run', ...)` — wrong path). The proposal/action UI was inside `ChatThread.jsx`'s `MessageBubble`/`ProposalCard` — features the rest of the app no longer relies on (the lifeplan agent doesn't emit proposals in JSON-output form anymore). Re-adding feedback later is a simple gear-icon overlay on the message; out of scope for Phase 4.

If the project intends to preserve a feedback hook in the lifeplan view, file a follow-up issue noting that `<AgentChatSurface>` does not yet expose feedback callbacks. The shared surface's tool-call attribution UI is the first-class observability path; explicit thumbs-up/down can be added by extending `AgentChatSurface`'s `<AssistantMessage>` later.

- [ ] **Step 3: Add a smoke test for the lifeplan view**

Create `frontend/src/modules/Life/views/coach/CoachChat.test.jsx`:

```javascript
// frontend/src/modules/Life/views/coach/CoachChat.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import CoachChat from './CoachChat.jsx';

describe('Life/views/coach/CoachChat', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ output: '', toolCalls: [] }),
    }));
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('renders the lifeplan-guide agent surface', () => {
    const { container } = render(
      <MantineProvider>
        <CoachChat />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat')).toBeTruthy();
  });

  it('does not render a mention popover (lifeplan-guide has no mentions)', () => {
    const { container } = render(
      <MantineProvider>
        <CoachChat />
      </MantineProvider>
    );
    expect(container.querySelector('.coach-chat__mention-popover')).toBeFalsy();
  });
});
```

- [ ] **Step 4: Run the new test; PASS**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Life/views/coach/CoachChat.test.jsx
```

Expected: green.

- [ ] **Step 5: Verify `Chat/` is now consumer-free**

```bash
cd /opt/Code/DaylightStation && grep -rn "from.*modules/Chat\|from '../../../Chat'" frontend/src/ 2>&1
```

Expected: empty.

- [ ] **Step 6: Delete the `Chat/` directory**

```bash
cd /opt/Code/DaylightStation && \
  git rm -r frontend/src/modules/Chat/
```

Files removed:
- `Chat/ChatPanel.jsx`
- `Chat/ChatThread.jsx`
- `Chat/ChatInput.jsx`
- `Chat/useChatEngine.js`
- `Chat/index.js`

(No tests exist in `Chat/` — verified at plan-time via `ls Chat/*.test.* → not found`.)

- [ ] **Step 7: Vite build smoke**

```bash
cd /opt/Code/DaylightStation && npm run build 2>&1 | tail -10
```

Expected: build completes successfully. If it fails with `Cannot resolve '../../../Chat'` or similar, run the grep from Step 5 again — there's a consumer we missed.

- [ ] **Step 8: Run the full suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  frontend/src/modules/Agent/ \
  frontend/src/modules/Health/CoachChat/ \
  frontend/src/modules/Life/ \
  frontend/src/lib/sse/
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/modules/Life/views/coach/CoachChat.jsx \
        frontend/src/modules/Life/views/coach/CoachChat.test.jsx
git commit -m "$(cat <<'EOF'
refactor(frontend): Life/coach renders AgentChatSurface; delete modules/Chat/

Plan / Phase 4 Task 9. Replaces the broken Chat/ChatPanel-based view
(404'd on every send — wrong /api/agents/... prefix; correct path is
/api/v1/agents/...) with <AgentChatSurface agentId='lifeplan-guide'>.

The proposal/action/feedback UI from Chat/ChatThread is dropped.
Feedback is a simple follow-up extension to AgentChatSurface; the
broken implementation it replaces never worked anyway.

modules/Chat/ deleted entirely — no remaining consumers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Verify HealthApp consumer is unchanged & trace `Apps/LifeApp.jsx` path

Two consumer paths — `HealthApp.jsx` and `LifeApp.jsx` — should now route through `<AgentChatSurface>` without any changes to those Apps files. Verify both.

This task is **read-only** verification; no code changes. If anything's wrong, fix it and re-commit under Task 10.

**Files:**

- Read: `frontend/src/Apps/HealthApp.jsx`
- Read: `frontend/src/Apps/LifeApp.jsx`
- Possibly modify: either file if a regression is detected

- [ ] **Step 1: Confirm `HealthApp.jsx` import + usage is byte-identical to pre-plan**

```bash
cd /opt/Code/DaylightStation && grep -n "CoachChat" frontend/src/Apps/HealthApp.jsx
```

Expected output (matching pre-plan state):
```
9:import CoachChat from '../modules/Health/CoachChat';
77:          <CoachChat userId={userId} variant="overlay" />
```

If line 77 still reads `<CoachChat userId={userId} variant="overlay" />` — the wrapper preserves the public API and HealthApp is unaffected. No edit required.

- [ ] **Step 2: Confirm `LifeApp.jsx` consumer**

```bash
cd /opt/Code/DaylightStation && grep -n "CoachChat" frontend/src/Apps/LifeApp.jsx
```

Expected output:
```
21:import CoachChat from '../modules/Life/views/coach/CoachChat.jsx';
```

The consumer file imports `CoachChat` as default — still works, since Task 9's rewrite preserves the default export.

- [ ] **Step 3: Run the existing `HealthApp` test suite (if one exists)**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/Apps/ 2>&1 | tail -20
```

Expected: green for any existing Apps-level tests. If `HealthApp.test.*` does not exist, that's fine — `Health/AskBar/` and `Health/ChatOverlay/` cover the surrounding chrome.

- [ ] **Step 4: Run the AskBar + ChatOverlay tests — these wrap `CoachChat` in HealthApp**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  frontend/src/modules/Health/AskBar/ \
  frontend/src/modules/Health/ChatOverlay/
```

Expected: green. Both modules are decoration around `CoachChat` (open/close, search button); they shouldn't be affected by the refactor.

- [ ] **Step 5: If everything passes, commit an empty marker**

If no edits were required (the expected case), record the verification:

```bash
git commit --allow-empty -m "$(cat <<'EOF'
verify(frontend): HealthApp + LifeApp consumers unchanged

Plan / Phase 4 Task 10. Confirms:
- HealthApp.jsx:9,77 still imports/renders default `CoachChat` —
  the Health/CoachChat wrapper preserves the public API.
- LifeApp.jsx:21 still imports default `CoachChat` from
  Life/views/coach — Task 9's rewrite preserves the export shape.
- AskBar + ChatOverlay tests green — no change in surrounding chrome.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If a regression IS detected, fix it (edit HealthApp.jsx or LifeApp.jsx as needed) and commit normally.

---

## Task 11: Final verification + plan-complete commit

- [ ] **Step 1: Run the full frontend module test suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run \
  frontend/src/lib/sse/ \
  frontend/src/modules/Agent/ \
  frontend/src/modules/Health/ \
  frontend/src/modules/Life/ \
  --reporter=line 2>&1 | tail -30
```

Expected: all green. The total pass count should be:
- Pre-plan baseline (captured in pre-flight) + new `AgentChatSurface.test.jsx` cases (~7) + new `Life/.../CoachChat.test.jsx` cases (2)
- Minus: deleted `Health/CoachChat/runtime.test.js` cases (replaced by `Agent/runtime.test.js` — net zero change)

So the net delta is +9 tests roughly.

- [ ] **Step 2: Vite build smoke**

```bash
cd /opt/Code/DaylightStation && npm run build 2>&1 | tail -20
```

Expected: build completes with no errors. The bundle size should be slightly smaller (the `Chat/` directory and four `Health/CoachChat/*` files are gone; one new file pair added).

- [ ] **Step 3: Verify nothing references the deleted paths**

```bash
cd /opt/Code/DaylightStation && grep -rn "from.*modules/Chat[^a-zA-Z]\|Health/CoachChat/parseSSE\|Health/CoachChat/MarkdownText\|Health/CoachChat/ToolCallAttribution\|Health/CoachChat/runtime" frontend/src/ 2>&1
```

Expected: empty. Any match is a stale reference and must be fixed.

- [ ] **Step 4: Manual smoke (recommended before merging)**

If a dev server is reachable, walk through:

1. **HealthApp**: `/` → `/health` → ⌘K opens overlay → type `@` → mention popover renders with categories → pick a metric → type "what is my weight?" → assistant streams response with markdown + tool-call attribution.
2. **LifeApp**: `/life` → coach view → type "give me a daily plan" → assistant streams response (the previously-broken view should now actually work for the first time).

```bash
# On kckern-server, dev backend should be reachable:
curl -X POST http://localhost:3112/api/v1/agents/lifeplan-guide/run \
  -H 'Content-Type: application/json' \
  -d '{"input":"hello","context":{"userId":"default","attachments":[]}}' \
  | head -c 200
```

Expected: a real response (not a 404). Pre-plan, the equivalent fetch from the Life view 404'd silently because of the wrong URL prefix.

- [ ] **Step 5: Final empty commit marking Phase 4 complete**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore(frontend): Phase 4 frontend convergence complete

Three frontend chat surfaces collapsed into one:
- <AgentChatSurface agentId, userId, mentions?, variant?, style?> in
  modules/Agent/ — built on @assistant-ui/react v0.12.28 primitives,
  streaming via lib/sse/parseSSE, mention-popover wired only when the
  mentions prop is present.
- Health/CoachChat is now a 20-line wrapper supplying health-specific
  mention config; HealthApp.jsx public API preserved.
- Life/views/coach renders the surface for the lifeplan-guide agent
  (previously 404'd on every send — fixed by going through the same
  /api/v1/agents/... wire as health-coach).
- frontend/src/modules/Chat/ deleted entirely (broken — no consumers).

DRY-H7 (three frontend chat surfaces): resolved.
DRY-M4 (two SSE consumers): resolved (parseSSE lifted to lib/sse/).
Q4 (lifeplan-guide UI broken): resolved.

Plan / Phase 4 complete.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage map

| Audit finding | Phase 4 task | Status after Phase 4 |
|---|---|---|
| **DRY-H7** Three frontend chat surfaces | Tasks 5–9 | Resolved — single `<AgentChatSurface>` |
| **DRY-M4** Two SSE consumers | Task 1 (lift `parseSSE`) | Resolved |
| **Q4** lifeplan-guide UI broken | Task 9 | Resolved (now hits real wire) |
| 1B Frontend surface diversity | Tasks 5–9 | Converged |
| 4B Mentions only on health-coach | Task 6 (optional `mentions` prop) | Architecture supports per-agent mentions; only health-coach configures one today |

---

## Notes for the implementer

- **`@assistant-ui/react` v0.12.28 API quirks.** This plan calls `unstable_useMentionAdapter`, `ComposerPrimitive.Unstable_TriggerPopover`, `Unstable_TriggerPopoverRoot`, etc. — all from the `unstable_*` namespace. These names are **correct for v0.12.28** and present in the existing `Health/CoachChat/index.jsx`. If the assistant-ui dependency is bumped during this plan, verify the namespace; the `unstable_` prefix may have been promoted (renamed without the prefix) in later versions. Don't speculatively rename — match what the installed version exports.

- **`useMessage` selector for tool calls.** The `AssistantMessageToolCalls` component reads tool-call data via `useMessage((state) => state?.metadata?.custom?.toolCalls)`. The `metadata.custom` bucket is assistant-ui's documented place for app-specific data — anything outside `metadata.custom` may be stripped or transformed by assistant-ui's internal state model. **Don't move tool-call data into a sibling field** (e.g., `metadata.toolCalls` directly); the runtime adapter explicitly remaps incoming `metadata.toolCalls` from the runStream into `metadata.custom.toolCalls` precisely because of this. The remap is in both the old and new adapters — preserve it.

- **Async-generator yield pattern.** Inside the `LocalRuntime` adapter's `async *run({ messages, abortSignal })`, every yielded chunk **replaces** the assistant message. It's not delta-style. Today's runtime accumulates `assistantText` across `text-delta` events and yields the full accumulated text on every chunk — `runStream` doesn't yield deltas, it yields full snapshots. **Don't change this.** If you optimize to yield only deltas, assistant-ui will render duplicated/garbled text. The `agentRuntime.runStream` factory already produces full snapshots; the adapter just forwards.

- **`metadata.custom.toolCalls` location.** Inside the surface's adapter:
  ```javascript
  yield {
    content: chunk.content,
    metadata: {
      custom: {
        toolCalls: chunk.metadata?.toolCalls ?? [],
      },
    },
  };
  ```
  The runtime's `chunk.metadata.toolCalls` is at the top level of `metadata`; the adapter rewraps it under `metadata.custom.toolCalls` for `useMessage` to read. Don't hoist it — the test `AssistantMessageToolCalls` reads `state?.metadata?.custom?.toolCalls`, period.

- **`pendingMentionsRef` lifecycle.** The ref accumulates mentions across renders; the adapter drains them on each `run()`. If you `useState` instead of `useRef`, every mention insertion will trigger a re-render and rebuild the adapter (the `useMemo` dep array invalidates), losing in-flight messages. Stick with `useRef` and `pendingMentionsRef.current = [...]` mutations.

- **Mentions fetch on mount, not on popover-open.** The current Health surface fetches `/api/v1/health/mentions/all?user=...` once on mount and groups suggestions client-side. Don't switch to fetch-per-prefix or fetch-on-open — the existing API serves an "all" payload that's small enough (~50–200 suggestions); rerouting to per-prefix calls would require a different backend endpoint.

- **Don't rename `coach-chat` SCSS classes in Phase 4.** Even though the component is now `AgentChatSurface`, the class names stay `coach-chat`/`coach-chat--overlay`/`coach-chat__*`. The SCSS file at `Agent/AgentChatSurface.scss` contains these selectors verbatim. Renaming is a follow-up cosmetic pass; doing it inside Phase 4 inflates the diff and risks visual regressions across `Health/AskBar/`, `Health/ChatOverlay/`, and any other module that reaches into the chat surface's classes via `.coach-chat--overlay .x` selectors.

- **`AiMark` cross-module import.** `Agent/ToolCallAttribution.jsx` imports `AiMark` from `../Health/AiMark/index.jsx`. This is acceptable — `AiMark` is a small SVG visual mark, and moving it requires touching every consumer (which there are several across the Health module). Document the cross-reference but defer the move to a future cleanup. Phase 4's scope is the chat surface, not module-level dependency hygiene.

- **The `Chip` component is gone from the shared surface.** `Health/CoachChat`'s mention popover used `<Chip label={...} chipKey={...} />` for category items. The shared `<AgentChatSurface>` renders `cat.label` as plain text. If HealthApp's mention popover looks unstyled after Task 7, the simplest fix is to add CSS rules for `.coach-chat__mention-category` in `Agent/AgentChatSurface.scss` (or `Health/HealthApp.scss`) that approximate the chip styling. The `Chip` component itself stays under `Health/CoachChat/chips/` for any consumer that wants to import it directly.

- **Don't introduce new fetches.** `<AgentChatSurface>`'s mount-effect makes ONE fetch when `mentions` is present (`mentions.fetchUrl`). The runtime makes ONE fetch per `run()` / `runStream()` invocation. That's it. If a future change wants to fetch user info, agent metadata, etc. on mount, that's out of scope — keep `<AgentChatSurface>` to the minimum.

- **`abortSignal` plumbing.** The async-generator adapter receives `abortSignal` from assistant-ui and forwards it to `agentRuntime.runStream`, which forwards to `fetch`. This wires up "stop" buttons or unmount-cleanup. Don't drop the signal; even if no UI exposes a stop button today, the cleanup matters when the user navigates away mid-stream.

- **`Life/views/coach/CoachChat.jsx` dropped feedback handlers.** The original used `onAction` and `onFeedback` props on `<ChatPanel>`. Both 404'd against the broken `/api/agents/lifeplan-guide/run` endpoint; neither one shipped useful behavior. Phase 4 drops them. If a future requirement adds proper feedback (thumbs-up/down on assistant messages), add it to `<AgentChatSurface>` as a new `onFeedback` prop that wires into `<AssistantMessage>` — that's a follow-up plan, not Phase 4.

- **Vite build is the integration test.** Phase 4 has no end-to-end Playwright coverage of the chat surfaces (Phase 4 doesn't add any). The `npm run build` smoke in Tasks 7, 8, 9, and 11 catches import-resolution errors that the unit tests miss (e.g., a stale reference to `Chat/` or `parseSSE.js` somewhere). Run it after every demolition step.

- **What's NOT changing.** The backend HTTP wire (`/api/v1/agents/{agentId}/run` and `/run-stream`) is unchanged. The agent registry, orchestrator, transcripts — none of it touches Phase 4. The mention vocabulary endpoints (`/api/v1/health/mentions/all`) are unchanged. The `MENTION_CATEGORIES` config in `Health/CoachChat/mentions/vocabulary.config.js` is unchanged. Phase 4 is **purely** a frontend reshuffle.

---

## Plan complete — convergence done

After Phase 4 lands, the agent framework convergence (Phases 1–4) is fully shipped:

- **Phase 1** (Foundations) — generic `ToolDecorator` chain, `BaseAgent.buildPromptSections` hook, `AgentTranscript` extension fields. Substrate for agent-stack DRY.
- **Phase 2** (Concierge migration) — concierge agents register through the orchestrator; `ConciergeTranscript` and `YamlConciergeMemoryAdapter` deleted; concierge skills migrate to the `ToolBundle` shape.
- **Phase 3** (HTTP unification) — single `mountAgentHttp` helper replaces the three HTTP layers; OpenAI-Chat-Completions wire becomes a wire-format preset, not a separate router.
- **Phase 4** (Frontend convergence — this plan) — single `<AgentChatSurface>` component renders every agent's chat; `parseSSE` lifted to `lib/sse/`; broken `Chat/` directory deleted; lifeplan-guide UI now actually works.

The codebase is now structured around a single agent contract end-to-end. New agents register through `agentOrchestrator.register(...)`, expose tools through `BaseAgent.registerTools()`, write transcripts through `AgentTranscript`, serve HTTP through `mountAgentHttp`, and render in the UI through `<AgentChatSurface>`. Adding a new agent (the "fitness-coach" or "homework-helper" of tomorrow) is a single-file backend exercise plus a single-line frontend wrapper.
