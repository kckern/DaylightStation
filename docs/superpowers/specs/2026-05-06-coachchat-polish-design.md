# CoachChat Polish — Design

**Date:** 2026-05-06
**Status:** Brainstorm — review before plan
**Author thread:** conversation 2026-05-06 after live testing the deployed CoachChat surface revealed three UX gaps: only Period suggestions appearing in the `@` dropdown, agent responses arriving as a single 5-second wall, and assistant messages rendering as plain text instead of markdown.

**Related:**
- [docs/superpowers/specs/2026-05-05-health-coach-chat-design.md](2026-05-05-health-coach-chat-design.md) — original CoachChat design
- [docs/superpowers/specs/2026-05-05-agent-transcripts-design.md](2026-05-05-agent-transcripts-design.md) — `streamExecute()` chunk shape and transcript handling
- [backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs](../../../backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs) — concierge's existing SSE precedent

---

## Why this exists

Three bugs / gaps surfaced from live use:

1. **`@` dropdown only shows Period suggestions.** Live verification: `GET /api/v1/health/mentions/all?user=user_1` returns 20 suggestions, all `group=period`. The handler only fans out to `/periods` and `metrics` (skipping `/recent-days` which covers day/workout/nutrition/weight) and applies a global `slice(0, 20)` that periods consume entirely.

2. **Agent responses are not streaming.** The user sees "loading…" for 5+ seconds, then the entire prose answer appears at once. `MastraAdapter.streamExecute()` already exists and yields per-chunk events (`text-delta`, `tool-start`, `tool-end`, `finish`) but no HTTP route exposes it; the frontend's `useLocalRuntime` adapter does a single `POST /run` + await.

3. **Assistant messages render as plain text.** `MessagePrimitive.Parts` is invoked with no custom `Text` component override, so its default plain-text renderer ignores any markdown the model produces. Bullet lists, bold, headers all render as literal `**word**` etc.

All three are CoachChat UX fixes. They share a code surface (the chat module) and a deployment cycle. One spec, one plan, one merge.

---

## Design philosophy

**Use the existing infrastructure.** `streamExecute()` exists. The concierge's SSE translator pattern works. `react-markdown` is the standard. We are not inventing primitives; we are wiring what's already there.

**Best-practice answers locked in:**
- **Markdown:** `react-markdown` + `remark-gfm` — sandboxes HTML by default, supports GFM tables / strikethrough / autolinks, ~50KB gzipped.
- **Stream transport:** SSE (`text/event-stream`). Mirrors the concierge's `OpenAIChatCompletionsTranslator` precedent. Browsers handle reconnection automatically. Easy to debug with `curl -N`.
- **Mentions distribution:** 8 periods + 14 recent days + 6 metrics (+ named periods when available, up to 8). Round-robin merged so no single category dominates the visible top.

**Per-task isolation.** Each of A/B/C is independently committable, independently testable, independently deployable. They land together for one user-facing rollup but the implementation plan separates them so a problem in one doesn't block the others.

---

## A. `/mentions/all` fanout fix

### Current behavior

```javascript
// backend/src/4_api/v1/routers/health-mentions.mjs
router.get('/all', async (req, res) => {
  const fanout = await Promise.all([
    fetchPeriodsInline(...),   // ← only periods
    fetchMetricsInline(...),   // ← only metrics
  ]);
  const merged = [...fanout[0], ...fanout[1]];
  res.json({ suggestions: merged.slice(0, 20) });   // ← periods consume the budget
});
```

Result: 20 period suggestions, 0 of everything else.

### New behavior

```javascript
router.get('/all', async (req, res) => {
  const userId = req.query.user;
  if (!userId) return res.status(400).json({ error: 'user query param required' });
  const prefix = (req.query.prefix || '').toString().toLowerCase();

  const [periods, days, metrics] = await Promise.all([
    fetchPeriodsInternal({ userId, prefix, limit: 8 }),
    fetchRecentDaysInternal({ userId, prefix, limit: 14 }),
    fetchMetricsInternal({ prefix, limit: 6 }),
  ]);

  // Round-robin interleave so the dropdown shows variety at the top
  const merged = roundRobin([periods, days, metrics]);
  res.json({ suggestions: merged });
});
```

Each `fetch*Internal` is a small helper extracted from the existing route handlers (no behavior change to those routes). The current "call our own route via fake req/res" hack at `/all` is replaced with direct internal calls — cleaner and avoids the route-stack lookup.

### Helper extraction

`fetchPeriodsInternal({ userId, prefix, limit })` returns the same shape as the `/periods` route's response: `{ slug, label, value, group, ... }[]`. Existing `/periods` handler delegates to this helper for its own response. Tests for `/periods` continue to verify the same observable behavior.

Same pattern for `fetchRecentDaysInternal` and `fetchMetricsInternal`.

### Tests

- `/all` returns suggestions across all three categories when `prefix` is empty
- `/all` filters by prefix across all categories simultaneously
- Per-category caps respected (no single category exceeds its `limit`)
- Round-robin order: first 3 items are one each from period/day/metric (when all three have results)
- Existing `/periods`, `/recent-days`, `/metrics` routes still work identically (regression)

### Out of scope for A

- Cache layer (per-request fetch is fine at current volume)
- Named periods in the merge (they're already inside `fetchPeriodsInternal`'s output; the count of 8 includes them)

---

## B. Streaming agent endpoint

### Server side

**New route:** `POST /api/v1/agents/:agentId/run-stream`

Mirrors the existing `/run` route (input + context body, same userId resolution path through `AgentOrchestrator`) but exposes `streamExecute()`'s chunks via SSE.

```javascript
// backend/src/4_api/v1/routers/agents.mjs (sketch)
router.post('/:agentId/run-stream', async (req, res) => {
  const { agentId } = req.params;
  const { input, context = {} } = req.body;
  if (!input) return res.status(400).json({ error: 'input is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const chunk of agentOrchestrator.streamExecute(agentId, input, context)) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    logger.error?.('agents.runStream.error', { agentId, error: err.message });
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});
```

**New orchestrator method:** `agentOrchestrator.streamExecute(agentId, input, context)`. Pure delegation to `agent.runStream()` (or `agent.run({stream: true})` — the wiring depends on what BaseAgent exposes today). The orchestrator handles the same userId resolution and `turnId` generation as `run()`. Transcripts still flush at the end of the stream via the existing `MastraAdapter.streamExecute` flow.

**BaseAgent path:** verify whether BaseAgent has a `runStream()` method already (it should, given `MastraAdapter.streamExecute` is wired through agent.execute). If not, add one as a sibling to `run()` that calls `this.#agentRuntime.streamExecute()`.

### Chunk schema (yielded from `streamExecute`, written to SSE)

The schema is already established by `MastraAdapter.streamExecute` (per the agent-transcripts spec):

```typescript
type StreamChunk =
  | { type: 'text-delta';  text: string }
  | { type: 'tool-start';  toolName: string; args: object; turnId: string }
  | { type: 'tool-end';    toolName: string; result: object; turnId: string }
  | { type: 'finish';      reason: string; usage?: { totalTokens: number, ... } }
  | { type: 'done' }
  | { type: 'error';       message: string };
```

We don't extend the schema. The `done` and `error` events are added by the route handler to signal stream-end and HTTP-level failures.

### Frontend — runtime adapter

`@assistant-ui/react`'s `useLocalRuntime` accepts an `async function* run()` that yields incremental updates. We swap our `runtime.js` from "single-shot fetch + await" to "fetch + parse SSE":

```javascript
// frontend/src/modules/Health/CoachChat/runtime.js (sketch)
export const healthCoachChatModel = {
  async *run({ messages, userId, attachments = [], abortSignal }) {
    const res = await fetch('/api/v1/agents/health-coach/run-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: extractText(messages.at(-1)), context: { userId, attachments } }),
      signal: abortSignal,
    });

    if (!res.ok) throw new Error(`Agent stream failed: ${res.status}`);

    let assistantText = '';
    const toolCalls = [];

    for await (const event of parseSSE(res.body)) {
      if (event.type === 'text-delta') {
        assistantText += event.text;
        yield {
          role: 'assistant',
          content: [{ type: 'text', text: assistantText }],
        };
      } else if (event.type === 'tool-start') {
        toolCalls.push({ toolName: event.toolName, args: event.args, status: 'running' });
        yield {
          role: 'assistant',
          content: [
            { type: 'text', text: assistantText },
            ...renderToolCallParts(toolCalls),
          ],
        };
      } else if (event.type === 'tool-end') {
        const last = toolCalls.find(t => t.toolName === event.toolName && t.status === 'running');
        if (last) { last.status = 'done'; last.result = event.result; }
        yield {
          role: 'assistant',
          content: [
            { type: 'text', text: assistantText },
            ...renderToolCallParts(toolCalls),
          ],
        };
      } else if (event.type === 'done' || event.type === 'finish') {
        // Final emission, then return
        return;
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }
  },
};
```

`parseSSE(stream)` is a small helper (~30 lines) that reads the response body as a `ReadableStream`, splits on `\n\n`, parses each `data: {...}` line as JSON, and yields events. No external dep needed.

`renderToolCallParts(toolCalls)` produces assistant-ui message parts representing in-flight or completed tool calls. assistant-ui's tool-call rendering primitives accept a structured part type — we define it once.

### What the user sees

| t (ms) | Event |
|---|---|
| 0 | User submits message |
| ~100 | First SSE chunk arrives, empty assistant bubble appears |
| ~400 | `tool-start metric_trajectory` → "Looking up trajectory…" pill |
| ~500 | `tool-end metric_trajectory` → pill collapses with "✓ slope: -0.04 lbs/wk" preview |
| ~600+ | `text-delta` events flow in, prose appears word by word |
| ~3000 | `finish` event, final state locked |

Total perceived latency: ~100ms to first feedback (vs. ~5s today).

### Tests

- New route: hits `/run-stream`, asserts `Content-Type: text/event-stream`, asserts SSE events arrive in order (text-delta → tool-start → tool-end → text-delta → finish → done)
- Frontend `parseSSE` helper: round-trip test with a mocked ReadableStream
- Frontend runtime adapter: mocked fetch returning a stream, asserts the right yield sequence
- Existing `/run` route still works (regression — assistant-ui clients that don't switch to streaming should keep working)

### Backwards compatibility

- The non-streaming `POST /run` route is unchanged. Other agents (echo, lifeplan-guide, paged-media-toc) keep using it.
- CoachChat is the only consumer that switches to `/run-stream`.
- The transcript schema is unchanged — `MastraAdapter.streamExecute` writes the same record at end-of-stream.

### Out of scope for B

- Streaming for non-CoachChat agents (concierge already has SSE; others stay non-streaming until they need it)
- Server-side abort handling on disconnect (assistant-ui's abortSignal closes the fetch; backend just sees the response stream end)
- Backpressure / chunk batching (network buffering is sufficient for typical text rates)

---

## C. Markdown rendering

### Current

```jsx
function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="coach-chat__message coach-chat__message--assistant">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}
```

`MessagePrimitive.Parts` with no override renders text parts as plain text. The model's `**bold**` shows as literal asterisks. Tables, lists, headers all degrade.

### New

```jsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function MarkdownText({ text }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Keep Mantine typography in lists/paragraphs
        p: ({ children }) => <p className="coach-chat__md-p">{children}</p>,
        ul: ({ children }) => <ul className="coach-chat__md-ul">{children}</ul>,
        ol: ({ children }) => <ol className="coach-chat__md-ol">{children}</ol>,
        code: ({ inline, children }) =>
          inline
            ? <code className="coach-chat__md-code-inline">{children}</code>
            : <pre className="coach-chat__md-code-block"><code>{children}</code></pre>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="coach-chat__message coach-chat__message--assistant">
      <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
    </MessagePrimitive.Root>
  );
}
```

Add to `frontend/package.json`:
- `react-markdown`
- `remark-gfm`

Add CSS rules for `coach-chat__md-*` selectors in `CoachChat.scss` so list spacing and code blocks look right inside Mantine's typography.

### Why GFM (remark-gfm)?

The model produces tables (`|---|---|` syntax) and strikethrough — both GFM extensions, not in CommonMark. Without GFM, those degrade to literal text. GFM is a small additional plugin (no separate dep beyond `remark-gfm`).

### Streaming compatibility

`react-markdown` re-parses the entire `text` prop on each render. As `text` grows during streaming (text-delta events appending characters), the parser handles partial markdown gracefully — incomplete `**bold` renders as literal `**bold` until the closing `**` arrives, then snaps to bold. This is the standard streaming-markdown UX (same as ChatGPT, Claude.ai).

### User messages stay plain text

`UserMessage` keeps the default `MessagePrimitive.Parts` (no override) — user input shouldn't render embedded markdown/HTML for safety.

### Tests

- `MarkdownText` renders `**bold**` as `<strong>` (basic markdown smoke test)
- Lists render as `<ul>` / `<li>` (verifies the GFM plugin is in)
- Tables render as `<table>` (GFM check)
- Inline `\`code\`` renders as `<code>`, fenced blocks render as `<pre><code>`
- The component handles empty / partial markdown without crashing (streaming case)

### Out of scope for C

- Syntax highlighting in fenced code blocks (defer until we see real demand; `prism-react-renderer` is the standard add-on if needed)
- LaTeX/math rendering (no use case)
- Custom emoji shortcodes
- Image rendering inside messages (model never produces images)

---

## File structure

**New files:**
- `frontend/src/modules/Health/CoachChat/parseSSE.js` — small SSE-parser helper used by the streaming runtime
- `frontend/src/modules/Health/CoachChat/MarkdownText.jsx` — markdown renderer component
- `tests/isolated/api/routers/agents.runStream.test.mjs` — SSE route integration test
- `tests/unit/modules/Health/CoachChat/MarkdownText.test.jsx` — markdown component test
- `tests/unit/modules/Health/CoachChat/parseSSE.test.js` — SSE parser unit test

**Modified files:**
- `backend/src/4_api/v1/routers/health-mentions.mjs` — extract `fetch{Periods,RecentDays,Metrics}Internal` helpers, rewrite `/all` handler to fan out to all three with per-category limits and round-robin merge
- `backend/src/4_api/v1/routers/agents.mjs` — add `POST /:agentId/run-stream` route
- `backend/src/3_applications/agents/AgentOrchestrator.mjs` — add `streamExecute()` method (mirrors `run()`, delegates to agent's stream path)
- `backend/src/3_applications/agents/framework/BaseAgent.mjs` — add `runStream()` method if not present (verify first; may already exist)
- `frontend/src/modules/Health/CoachChat/runtime.js` — switch from single-shot fetch to async-generator streaming consumer
- `frontend/src/modules/Health/CoachChat/index.jsx` — `AssistantMessage` uses `MarkdownText` for text parts
- `frontend/src/modules/Health/CoachChat/CoachChat.scss` — add `.coach-chat__md-*` rules
- `frontend/package.json` + `frontend/package-lock.json` — add `react-markdown` + `remark-gfm`
- `tests/isolated/api/routers/health-mentions.test.mjs` — extend `/all` tests for the new fanout shape

---

## Architecture summary

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend: CoachChat                                         │
│                                                              │
│  Composer ─── @-mention popover                              │
│             ←── GET /mentions/all (now returns 6 categories) │
│                                                              │
│  User submits ─── POST /agents/health-coach/run-stream       │
│                                                              │
│  SSE consumer (parseSSE.js) ─── async generator              │
│                              ─── yields per-chunk updates    │
│                                                              │
│  AssistantMessage ─── MessagePrimitive.Parts                 │
│                       components={{ Text: MarkdownText }}    │
│                       ↑ renders streaming text as markdown  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend                                                     │
│                                                              │
│  POST /run-stream ─── orchestrator.streamExecute()           │
│                   ─── agent.runStream()                      │
│                   ─── MastraAdapter.streamExecute()          │
│                       yields chunks → SSE                    │
│                                                              │
│  GET /mentions/all ─── fanout(periods, days, metrics)        │
│                    ─── round-robin merge with per-cat limits │
└─────────────────────────────────────────────────────────────┘
```

---

## Out of scope (explicit)

- **Streaming for non-CoachChat agents.** Concierge already has SSE; lifeplan-guide and others stay non-streaming until they need it.
- **Streaming markdown highlighting.** `react-markdown`'s default rendering covers our needs; `prism-react-renderer` is a polish-pass add.
- **Non-period named-period pre-fetch optimizations.** `/mentions/all` calls into `list_periods` which hits working memory + playbook on every request. Caching is a future optimization once we see real load.
- **Tool-call result truncation in the UI.** Long tool results render as-is in the rolldown details. If a tool returns 500 lines, the user sees 500 lines on expand. Truncation is polish.
- **Voice input.** assistant-ui supports it; we don't enable it yet.
- **Mobile keyboard handling for the mention popover.** v1 is desktop-first; mobile UX is a follow-up.
- **Cancel button during streaming.** assistant-ui's abort handling works automatically when the user navigates away; an explicit "stop generating" button is polish.

---

## Open questions (deferred to implementation)

These are deliberately not pre-decided here; the implementation plan resolves them.

1. **Tool-call rendering details.** What does the in-flight tool pill look like exactly? assistant-ui has tool-call rendering primitives; we'll match its visual conventions.
2. **`react-markdown` version pin.** Latest stable is the default; the implementation plan pins to whatever ships with the install.
3. **Token-by-token vs chunk-by-chunk re-render frequency.** `react-markdown` re-parses on every prop change. If perceived smoothness suffers, throttle to ~30Hz max via a small wrapper. Defer until we see it.
4. **Per-category limit knobs.** `/mentions/all` defaults to 8/14/6. If named-period count ever grows large in practice, the periods limit becomes a real constraint. Tune in a follow-up if needed.

---

## Why this is the right shape

**Each fix targets one user pain.** `@`-dropdown, response latency, message readability — three separate user-visible problems, three independently-shippable fixes.

**The infrastructure is already there.** `streamExecute()`, the concierge's SSE pattern, `MessagePrimitive.Parts` overrides — none of this requires inventing new mechanisms. The plan is mechanical wiring.

**The bundle is coherent without being coupled.** Each task is committable in isolation; the plan can ship A then B then C with intermediate deploys, OR all three in one merge. The execution plan picks the latter for one-deploy efficiency, but the dependency graph between tasks is sparse.

**The model never has to know.** None of these changes touch the agent's prompt, tools, or analytical surface. The agent does what it already does; the chat surface gets faster, prettier, and more discoverable.
