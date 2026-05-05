# Agent Transcripts — Design

**Date:** 2026-05-05
**Status:** Brainstorm — review before plan
**Author thread:** conversation 2026-05-05 about giving every agent the same forensic-quality logs the concierge already has, without redundant operational noise.
**Related:**
- `backend/src/0_system/logging/` — existing structured logging framework (logger, transports, sessionFile, dispatcher)
- `backend/src/3_applications/concierge/services/ConciergeTranscript.mjs` — the pattern this design generalizes
- `backend/src/1_adapters/agents/MastraAdapter.mjs` — the single chokepoint where every agent run lands
- `docs/superpowers/specs/2026-05-05-health-coach-data-tier-design.md` — the analytical surface whose tool calls we're now making visible

---

## Why this exists

The agent framework has 28 log calls scattered across `agents/`. They tell you the **operational** story — agent started, agent completed, tool was called, X tools were used, took 2.3s. They do NOT tell you the **agentic** story — what the user asked, what system prompt the model saw, which tools the model chose with what arguments, what those tools returned, what the agent finally said.

For an agent system whose value is in the model's *decisions*, those decisions are invisible today. The `concierge` agent has had this fixed for months — `ConciergeTranscript` writes one JSON file per request capturing the full lineage. Every other agent (echo, lifeplan-guide, paged-media-toc, health-coach) has nothing equivalent.

This design generalizes the concierge's pattern into a single agent-framework component, applies it at the `MastraAdapter.execute()` chokepoint so every agent gets it for free, and uses the opportunity to **resolve the redundancy** between operational logs and the new transcripts: bookend lines stay, per-tool info-level logs become debug, errors stay. One source of truth per fact.

---

## Design philosophy

**One injection point, every agent.** `MastraAdapter` is the single concrete runtime; every agent goes through it. Per-agent customization isn't needed for the transcript itself — every turn has the same essential fields. We add transcripts at this layer and they cover all four current agents (echo, health-coach, lifeplan-guide, paged-media-toc) plus future ones.

**Capture the lineage, not the events.** Existing logs are event-shaped: "this happened, then this." Transcripts are turn-shaped: "this was the input, here's everything the agent saw and did, here's what came out." The two views complement each other; the transcript is the rich record, the log stream is the alarm channel.

**Avoid redundancy by promotion.** Where operational logs and transcripts both name the same fact, demote the operational log. Bookend lines (start/complete) stay because they carry the `turnId` that joins streams to transcripts. Per-tool info logs go to debug because the transcript captures them in full. Error/warn lines stay because they're alert-worthy on the stream side.

**Replay-ready by design.** A transcript should hold enough state that a future `dscli agents replay <turnId>` could re-issue the same input through current code and compare outputs. We capture input + resolved system prompt + tool args/results — that's the contract for replay. Building the replayer is out of scope; the schema is designed not to preclude it.

---

## Architecture

### Single injection point

`MastraAdapter.execute()` (and its siblings `streamExecute()`, `executeInBackground()`) is where every agent invocation lands. The adapter already wraps every tool call. We add transcript creation, threading, and flush at this layer:

1. **Top of `execute()`** — instantiate `new AgentTranscript({ agentId, userId, turnId, request, agentRuntime })`. `turnId` is generated if not present in `context`. The `request` field captures `input`, `context.attachments`, and other relevant context.
2. **Tool wrapper at line 113** — before calling `tool.execute(inputData, context)`, record `{ ix, name, args, ts: start }`. After, record `{ result, ok, latencyMs }`. Errors get `ok: false, result: { error: msg }`.
3. **After model response** — record `{ output, finishReason, usage }`.
4. **In `try/catch`** — finally block calls `await transcript.flush()`. Errors warned to the log stream, never propagate.

`BaseAgent`, `AgentOrchestrator`, and the per-agent classes are untouched. The whole feature lives at the adapter layer.

### File structure

**New files:**

```
backend/src/3_applications/agents/framework/AgentTranscript.mjs        — the class
backend/src/3_applications/agents/framework/turnId.mjs                 — uuid helper (or use crypto.randomUUID inline)
tests/isolated/agents/framework/AgentTranscript.test.mjs               — unit tests for the class
tests/isolated/adapters/agents/MastraAdapter.transcript.test.mjs       — integration test verifying adapter wires it
```

**Modified files:**

- `backend/src/1_adapters/agents/MastraAdapter.mjs` — instantiate transcript, thread through tool wrapper, flush in finally block. Demote `tool.execute.call` from info to debug. Update `agent.execute.start/.complete` to carry `turnId`. Tool errors keep their info-level events but reference the turnId.
- `backend/src/3_applications/agents/AgentOrchestrator.mjs` — surface `turnId` in `orchestrator.run` log so a stream search by turnId stitches logs to transcripts.

### Storage location

Transcripts land under the configured media directory:

```
{mediaDir}/logs/agents/{agentId}/{YYYY-MM-DD}/{userId}/{ts}-{turnId}.json
```

Where:
- `{mediaDir}` is `configService.getMediaDir()` (same root the concierge uses for its own transcripts).
- `{agentId}` is the agent's static `id`.
- `{ts}` is the start timestamp formatted as `HHMMSS-mmm`.
- `{turnId}` is the truncated UUID (first 8 chars).

The sessionFile transport's `pruneOldFiles()` does NOT touch this tree — these are durable diagnostic records, not session log streams.

### Lifecycle

1. **Construction**: `new AgentTranscript({ agentId, userId, turnId, request, mediaDir, logger })`. Synchronous.
2. **Mutation**: `recordTool(...)`, `setSystemPrompt(...)`, `setOutput(...)`, `setError(...)` — all synchronous mutators on the in-memory object.
3. **Flush**: `await transcript.flush()` — async write to disk. Idempotent (safe to call twice). Never throws — failures get logged at warn level and swallowed.

---

## Schema

```typescript
interface AgentTranscript {
  // Versioning — bump on schema-incompatible changes
  version: 1;

  // Identity
  turnId: string;                          // UUID v4
  agentId: string;                         // 'health-coach' | 'lifeplan-guide' | ...
  userId: string | null;                   // 'kckern' | 'default' | null

  // Timing
  startedAt: string;                       // ISO8601 with ms
  completedAt: string;                     // ISO8601 with ms
  durationMs: number;
  status: 'ok' | 'error' | 'aborted' | 'timeout';

  // Request
  input: {
    text: string;                          // The user's message verbatim
    context: {
      // The orchestrator forwards context.attachments + any other context fields
      // captured here in full. attachments are the structured @-mention payloads
      // from CoachChat, but any field passed through context lands here.
      attachments?: Array<AttachmentRef>;
      [key: string]: unknown;
    };
  };

  // The full string the model actually saw — base prompt + attachments
  // preamble (Plan 4) + working memory (BaseAgent.#assemblePrompt). Captured
  // verbatim so any prompt-injection or templating issue is visible.
  systemPrompt: string;

  // Model metadata — populated from MastraAdapter's configured model
  model: {
    name: string;                          // 'gpt-4o-mini', etc.
    provider: string;                      // 'openai' | 'anthropic' | 'mastra'
  };

  // Tool calls in execution order. Each captures FULL args + result;
  // privacy redaction is the tool's responsibility (existing 14-day
  // redaction policies in LongitudinalToolFactory continue to apply).
  toolCalls: Array<{
    ix: number;                            // 0-based index in execution order
    name: string;                          // tool name
    args: object;                          // FULL args object (deep clone)
    result: object | null;                 // FULL result (deep clone) or null on error
    ok: boolean;
    latencyMs: number;
    ts: string;                            // ISO8601 of call start
    linkedAttachments: number[];           // indexes into input.context.attachments
                                           // whose `value` shape matches one of args' fields.
                                           // Computed by AgentTranscript.recordTool().
                                           // Empty array when no link found OR no attachments.
  }>;

  // Output
  output: {
    text: string;                          // Final assistant text
    finishReason: string;                  // 'stop' | 'tool_calls' | 'length' | 'aborted' | 'error' | ...
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    } | null;                              // null if model didn't return usage
  };

  // Populated only when status !== 'ok'
  error: {
    message: string;
    stack?: string;
    toolCallsBeforeError: number;
  } | null;

  // Free-form labels for downstream tooling (eval, dashboards)
  tags: string[];                          // e.g. ['health-coach', 'chat']
                                           // adapter sets ['<agentId>'] by default
}
```

### Redaction & privacy

The existing data-layer redactions stay in place — `LongitudinalToolFactory.query_historical_nutrition` strips `implied_intake` from days < 14 days old before returning. The transcript captures whatever the tool returned, so redaction happens upstream and the transcript inherits it. We do not double-redact.

If we ever need transcript-level redaction (e.g., for sharing transcripts externally), it goes in a separate "export" pathway, not in the on-disk record.

### linkedAttachments — verifying tool usage matches user intent

When an attachment carries a structured `value` (e.g., `{ rolling: 'last_30d' }`), `AgentTranscript.recordTool()` does a shallow comparison against the tool's `args` and notes which attachments appear to have been used. Algorithm:

1. For each attachment with a structured `value` (period, day, metric_snapshot), build a flat key/value map.
2. For each tool-call args field, check if it deep-equals any attachment's value. If yes, record that attachment's index in `linkedAttachments`.
3. Workout/nutrition/weight attachments link by `date` — if the tool's `from`/`to` args bracket that date OR the args contain `date: <attachment-date>`, link.

This is best-effort heuristic linking. False positives possible (rare). False negatives possible if the agent uses a different period that's equivalent (e.g., user mentions `last_30d`, agent calls with explicit `from`/`to` matching the resolved bounds — we'd miss the link). For v1 we accept this; if false negatives bite, the linker can resolve periods canonically before comparing.

The high-value question this answers: **"User mentioned `@last_30d` but the agent called `aggregate_metric` with `last_90d` — was that a deliberate clarification or a hallucination?"** With `linkedAttachments`, you spot the empty array and investigate.

---

## Lifecycle in MastraAdapter (concrete flow)

```javascript
// backend/src/1_adapters/agents/MastraAdapter.mjs (sketch)

async execute({ agent, agentId, input, tools, systemPrompt, context = {} }) {
  const turnId = context.turnId ?? crypto.randomUUID();
  const userId = context.userId ?? null;
  const name = agentId || agent?.constructor?.id || 'unknown';

  const transcript = new AgentTranscript({
    agentId: name,
    userId,
    turnId,
    input: { text: input, context: cloneContext(context) },
    mediaDir: this.#mediaDir,
    logger: this.#logger,
  });

  transcript.setSystemPrompt(systemPrompt);
  transcript.setModel({ name: this.#model.modelId, provider: this.#model.provider });

  const callCounter = { count: 0 };
  const mastraTools = this.#translateTools(tools || [], context, callCounter, transcript);

  this.#logger.info?.('agent.execute.start', { agentId: name, turnId, userId });
  // (No more inputLength/toolCount in start — that's redundant with transcript.)

  const startedAt = Date.now();
  try {
    const response = await Promise.race([
      this.#mastraAgent({ ... }).generate(input),
      timeoutPromise,
    ]);

    transcript.setOutput({
      text: response.text,
      finishReason: response.finishReason ?? 'stop',
      usage: response.usage ?? null,
    });
    transcript.setStatus('ok');

    this.#logger.info?.('agent.execute.complete', {
      agentId: name, turnId,
      status: 'ok',
      durationMs: Date.now() - startedAt,
    });

    return { output: response.text, toolCalls: response.toolCalls || [] };
  } catch (err) {
    transcript.setError(err, { toolCallsBeforeError: callCounter.count });
    transcript.setStatus(err.name === 'AbortError' ? 'aborted' : 'error');

    this.#logger.error?.('agent.execute.error', {
      agentId: name, turnId,
      error: err.message,
      durationMs: Date.now() - startedAt,
    });
    throw err;
  } finally {
    // Never throws — flush errors get logged at warn level by the transcript.
    await transcript.flush();
  }
}
```

The `#translateTools` method gets a transcript reference and the per-tool wrapper records the call before-and-after.

---

## Redundancy resolution (Option C)

Existing log call changes:

| Today | After |
|---|---|
| `agent.execute.start` info — `{ agentId, inputLength, toolCount, maxToolCalls, timeoutMs }` | info — `{ agentId, turnId, userId }` |
| `agent.execute.complete` info — `{ agentId, outputLength, toolCallsUsed }` | info — `{ agentId, turnId, status, durationMs }` |
| `agent.execute.error` error — `{ agentId, error, toolCallsUsed }` | error — `{ agentId, turnId, error, durationMs }` |
| `tool.execute.call` info — `{ tool, callNumber, maxCalls }` | **debug** — same shape with `turnId` added |
| `tool.execute.error` error — `{ tool, error }` | error — `{ tool, turnId, error }` |
| `tool.execute.limit_reached` warn — `{ tool, count }` | warn — `{ tool, turnId, count }` |
| `agent.stream.start/.complete/.error/.unknown_event` | mirror the synchronous-execute changes |
| `orchestrator.run` info — `{ agentId, contextKeys }` | info — `{ agentId, turnId, userId, contextKeys }` (turnId generated here if absent and threaded into context for adapter pickup) |

Net effect:
- Stream-time visibility preserved: every turn has a single `agent.execute.start` and `agent.execute.complete` (or `.error`) — searchable, dashboard-able, alert-able.
- All per-tool info-level chatter goes to debug — quiet by default.
- Error/warn lines for runaway costs and tool failures stay loud.
- Every log line that *was* useful retains its turnId, so you can pivot from a log entry to the full transcript instantly.

---

## Storage policy

**Path:** `{mediaDir}/logs/agents/{agentId}/{YYYY-MM-DD}/{userId}/{HHMMSS-mmm}-{turnId-short}.json`

Example:
```
/usr/src/app/media/logs/agents/health-coach/2026-05-05/kckern/204215-123-3f9a8b21.json
```

Why this layout:
- `{agentId}` first — easy to scope to one agent for grep / replay / eval.
- `{YYYY-MM-DD}` next — natural rotation, easy to delete old days.
- `{userId}` next — multi-user friendly even though we're single-user today.
- `{ts}-{turnId-short}` filename — sortable by time, unique per turn.

**Retention:** indefinite by default. Add a `transcripts.maxAgeDays` config option later if volume bites. Concierge currently keeps everything; we follow the same default.

**Concurrency:** one file per turn, written exactly once at flush. No locking needed.

**Failure mode:** if flush fails (disk full, perms), the adapter logs `agent.transcript.flush_failed` at warn level with `{ turnId, error }` and continues. The user-facing response is unaffected.

---

## Verifying tool usage matches user intent (the "tagged data points" check)

The schema makes these queries trivial:

| Question | Transcript field |
|---|---|
| "Did the agent call the right tool with my @-mentioned period?" | `toolCalls[i].linkedAttachments` non-empty when an attachment value matches |
| "Did the agent ignore an attachment entirely?" | An attachment with no entry pointing at it from any `linkedAttachments` array |
| "Did a tool error and did the agent recover?" | `toolCalls[i].ok=false`, then look at later calls for retries |
| "Did the system prompt include the resolved attachments preamble?" | `systemPrompt` field — full string |
| "Did the agent waste a tool call learning what `last_30d` means?" | The Plan 4 `formatAttachment` override resolves periods inline; `systemPrompt` contains the resolved bounds. If the agent still called a period-resolution helper, you see it in `toolCalls`. |
| "Was the agent slow because of one tool?" | sort `toolCalls[i].latencyMs` |
| "Token usage trend over time?" | iterate transcripts, sum `output.usage.totalTokens` per day |

A small CLI surface (deferred — separate spec) would expose these as `dscli agents transcripts list/view/replay` so they're scriptable from the shell. The concierge already has `dscli concierge transcripts list/view`; we'd mirror that.

---

## Testing strategy

- **Unit tests** for `AgentTranscript` — mutators, `linkedAttachments` heuristic, flush idempotency, flush-failure-doesn't-throw.
- **Integration test** for `MastraAdapter` — verifies transcript instantiation, tool-wrapper records args/results, output captured, status transitions, file written at expected path.
- **Concurrency test** — two simultaneous turns produce two distinct files (turnId uniqueness).
- **Backwards-compat** — every existing test in `tests/isolated/agents/` and `tests/isolated/adapters/` continues to pass with the demoted log levels (no test should depend on `tool.execute.call` being at info level — verify).
- **End-to-end smoke** — run a real `health-coach` turn against a fixture user; inspect the resulting transcript on disk.

---

## What this design does NOT include

- **`dscli agents transcripts` CLI surface** — separate spec (or extension of the existing dscli plan).
- **Replay tooling** — `dscli agents replay <turnId>` is a follow-up; the schema is designed to support it but we don't build the replayer here.
- **Eval batch pipeline** — offline scoring over transcripts is also a follow-up. Schema designed not to preclude it (token usage, status, ok/error per tool, finishReason all preserved).
- **Frontend transcript viewer** — the JSON files are inspectable via filesystem + `jq`. A web viewer could come later but isn't required for diagnosis.
- **Cross-turn conversation linking** — each turn is independent. If two turns share a `conversationId` (e.g., from CoachChat keeping a thread alive), we capture that field in `input.context` but don't aggregate across turns at the transcript layer. Aggregation lives in eval pipelines.
- **Configurable redaction in transcripts** — tool-side redaction (existing 14-day policies) is the contract; transcripts are the raw record of what the tool actually returned.
- **Real-time streaming of transcript fields to a frontend** — transcripts are written once at end-of-turn. Live progress UIs use the existing log stream + tool-call events.
- **Migration of `ConciergeTranscript`** — out of scope. The two coexist; once `AgentTranscript` is proven, a follow-up can deprecate the concierge-specific one in favor of the generalized class. For now they live side by side.

---

## Open questions for the implementation plan

1. **`turnId` propagation back to the caller.** The adapter generates `turnId` if absent. Should it surface in the response shape (`{ output, toolCalls, turnId }`) so the caller can correlate? Initial proposal: yes, add it as a top-level field on the adapter's return; existing callers ignore it without breaking.
2. **`finishReason` provenance.** Mastra's `generate()` may not return a normalized `finishReason`. We may need to derive it from response shape (`response.toolCalls.length > 0 && !response.text` → `tool_calls`, etc.). Pin during implementation.
3. **`model` field source.** The adapter holds `this.#model` but its shape varies by provider. Initial proposal: capture whatever ID-like field is available (`modelId`, `name`) and the provider name; fall back to `'unknown'` when neither is present.
4. **`linkedAttachments` heuristic precision.** First implementation is shallow deep-equals over args fields. If false negatives bite (agent uses semantically equivalent but differently-shaped args), upgrade to canonicalize-then-compare (resolve periods to `[from, to]` before matching). Defer until we see real data.
5. **Test fixtures' filesystem isolation.** Tests can't write to `media/logs/agents/`. The transcript class accepts `mediaDir` as a constructor arg; tests pass a temp dir.

---

## Why this is the right shape

**One injection point covers every agent.** No per-agent class changes; no per-tool changes. The adapter is the single place every run goes through; we add one component there.

**The schema captures the lineage you asked for.** Input → attachments → resolved system prompt → tool args → tool results → output, with `linkedAttachments` making the user-intent-vs-tool-usage check structural rather than narrative.

**Redundancy is resolved by promotion, not deletion.** Bookend logs and error/warn lines stay (different audience: streams + alerting). Per-tool info chatter becomes debug. Every log entry that survives carries `turnId` so streams join to transcripts.

**Replay and eval are unblocked but not built.** The schema captures everything those follow-up systems would need; building them is separate work. We don't pay for them here.

**The pattern already works.** `ConciergeTranscript` has been in production for months with the same shape. We're generalizing a known-good design, not inventing.
