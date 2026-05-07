# Agent Framework Architecture

The framework hosts conversational and workflow-driven AI agents under a unified turn lifecycle, tool model, memory model, observability layer, and HTTP wire surface.

This document describes the steady-state architecture. For the contract that adding a new agent satisfies, see [extending](extending.md).

---

## Turn lifecycle

A single turn — one user input, one agent response — flows through six steps.

1. **Receive.** An HTTP layer receives the request, applies authentication appropriate to the wire format (household session token for the native wire; bearer token resolving to a satellite identity for the OpenAI-compatible wire), and extracts the input string and a context object.
2. **Resolve identity.** The orchestrator resolves the user identity. A request with an explicit user id uses it. A request that omits user id (or sets it to a sentinel default) resolves to the head of the household. Concierge requests resolve to a household-scoped identity rather than a per-user one. A turn id is assigned for observability correlation.
3. **Load memory.** The framework loads the agent's working memory for the resolved user. Memory is typed key-value state with optional TTL on each entry. Expired entries prune on load. If the user identity is anonymous, memory is skipped.
4. **Assemble prompt.** The agent contributes a base prompt, optional sections (active user, attachments, working memory snapshot, agent-specific sections like satellite identity or skill prompts), and a memory snapshot. Sections compose with double-newline separators; null or empty sections drop.
5. **Execute.** The runtime adapter translates the agent's tools into the underlying model's tool format, applies the decorator chain (user-id injection, call limiting, transcript recording, optional policy gating), and invokes the model with the assembled prompt and the wrapped tools. The model may call tools any number of times, up to the per-turn call limit.
6. **Persist and report.** Memory saves at turn end. The transcript flushes to disk. The HTTP layer formats the result for the configured wire — a single JSON response, a streaming Server-Sent Events sequence, or an OpenAI-compatible chunk envelope — and returns it to the caller.

The same lifecycle drives both synchronous and streaming variants. The streaming variant yields events as the model produces them; the same memory persistence and transcript flush happen at end of turn.

---

## Agent contract

An agent contributes:

- **An identity.** A short stable id (e.g. `health-coach`, `concierge`, `lifeplan-guide`) and a human-readable description.
- **A system prompt source.** The agent returns a base prompt for the active context. Different modes (chat, dashboard, scheduled assignment) may select different bases.
- **Prompt sections, optionally.** The agent may override the default section list to inject domain-specific blocks. Concierge inserts satellite identity, household personality, household vocabulary aliases, and per-skill prompt fragments. Health coach inserts a per-user playbook bundle. The default agent supplies four sections: base, active user, attachments, working memory.
- **Tool bundles.** A bundle groups related tools and exposes a `createTools()` method that returns tool descriptors. Bundles may also contribute prompt fragments and configuration metadata. Each tool has a name, description, JSON Schema parameters, and an `execute` function.
- **A decorator chain, optionally.** The agent may extend the default decorator chain. The default chain (user-id injection, call limiting, transcript recording) covers every agent's needs. Concierge adds a policy gate that consults a satellite-scope evaluator before each call.
- **Domain dependencies.** The agent's constructor receives concrete adapters for whatever it touches — health stores, home automation gateways, content services, messaging gateways. Dependencies are wired at composition time; the agent does not load them itself.

Agents do not directly handle HTTP, observability, or memory persistence. The framework owns those.

---

## Prompt composition

The framework assembles the system prompt from a list of sections returned by the agent. Sections are strings, possibly null. The framework filters falsy sections and joins the rest with double newlines.

The default section list is:

1. **Base prompt** from the agent's `getSystemPrompt(context)`. The agent selects per-mode (chat vs. dashboard vs. assignment) and may append per-user content (e.g. a personal playbook YAML rendered into prose).
2. **Active user** when a non-anonymous user id is in context. A short marker so the model addresses the right person.
3. **User mentions** when the request carries attachments (typed references to periods, days, metrics, etc.). The agent renders these into a structured block — for the health coach, a list of resolved date ranges and metric handles.
4. **Working memory snapshot** when memory loads non-empty. The framework renders the snapshot into markdown with persistent and expiring sections.

Agents extend this list by overriding `buildPromptSections`. Concierge's section list is six entries: base prompt, household personality, satellite identity and allowed skills, the union of skill prompt fragments, household vocabulary aliases, and a memory snapshot serialized as JSON.

The base prompt is always first. Other sections may reorder, replace, or supplement.

---

## Tool model

Tools are the structured side-effect surface of an agent. The model may call any registered tool by name, supplying arguments that match the tool's JSON Schema. The tool returns a structured result (or an error envelope) which the model consumes for its next reasoning step.

### Tool bundles

Tools group into bundles. A bundle has a name, a `createTools()` method that returns the tool descriptors, and optionally a prompt fragment and configuration metadata. Bundles serve three purposes:

- **Cohesion.** All tools that operate on the same domain object live together (e.g. a memory bundle exposes `remember_note`, `forget_note`, `list_notes`). The bundle owns the dependencies those tools share.
- **Prompt contribution.** Some bundles contribute a prompt fragment that documents the tools' contract or surfaces relevant household context. Concierge uses this to declare each skill's purpose to the model.
- **Configuration surface.** A bundle's `getConfig()` exposes the tunable knobs (e.g. note retention limits) without forcing the model to discover them through tool calls.

Bundles register via the agent's `registerTools` method, which the orchestrator calls at agent construction time.

### Decorator chain

When the runtime translates an agent's tools for the underlying model, it applies a decorator chain. A decorator wraps a tool, returning a new tool with modified behavior. The chain composes left-to-right: the leftmost decorator is outermost; its `before` runs first and `after` runs last when execute is called.

The default chain has three decorators:

1. **User-id injector.** Strips `userId` from the tool's parameter schema (so the model never has to pass it) and merges the resolved user identity into arguments at execute time.
2. **Call limiter.** Maintains a per-turn counter. When the counter exceeds the configured maximum, returns an error envelope and records the limit-exceeded call to the transcript.
3. **Transcript recorder.** Wraps each call with a timer; records the tool name, arguments, result, success flag, and latency to the active transcript. Catches thrown errors, records them, and returns an error envelope so the model sees a structured failure rather than a raw exception.

Agents append decorators to add cross-cutting behavior. The concierge agent adds a **policy gate** that consults the satellite's allowed scopes before each call. A denied call returns an error envelope and records the denial to the transcript.

Decorator state is per-turn. The chain is reconstructed on every translate operation, so counters, timers, and policy decisions never leak across turns.

### Tool execution flow

When the model decides to call a tool, the runtime adapter routes the call through the chain. For a happy-path call:

- User-id injector adds the resolved user id to arguments.
- Call limiter increments the counter, sees it within the limit, forwards.
- Transcript recorder starts a timer, calls the underlying tool's `execute`.
- The tool runs, produces a result.
- Transcript recorder records the call (name, args, result, ok, latency) and returns the result.
- Call limiter returns.
- User-id injector returns.

For an over-limit call, the call limiter short-circuits before the underlying tool runs and returns an error envelope. For a tool that throws, the transcript recorder catches, records the error envelope, and returns it — the exception does not propagate.

For a policy-denied call (concierge only), the policy gate short-circuits with a denial envelope and records the policy decision to the transcript.

---

## Memory model

Working memory is typed key-value state that persists across turns for a given (agent, user) pair. It exists for two purposes: feeding context into the prompt, and accumulating user-scoped facts that the agent should remember between sessions.

Memory state supports:

- **Persistent entries.** Plain `set(key, value)` writes. These survive indefinitely.
- **Expiring entries.** `set(key, value, { ttl })` writes. The framework prunes them on the next load after the TTL elapses.
- **Snapshot serialization.** The state renders into a markdown block with persistent and expiring sections, suitable for inclusion in the system prompt.

Memory is per-agent: the health coach's memory and the concierge's memory occupy separate state files. Memory is per-user for most agents. Concierge memory uses a household-scoped identity rather than a per-user identity, since voice satellites address the household collectively.

Loading and saving happen automatically as part of the turn lifecycle. An agent's tool may mutate the memory state directly during a turn; the framework saves at turn end. Tools do not perform their own memory I/O.

If a turn ends with a stream that the consumer abandoned, memory still saves through a finally block, so abandoned turns don't lose updates.

---

## Transcripts

Every turn produces a JSON transcript with everything observed during the turn:

- **Identity.** Turn id, agent id, user identity (or satellite identity for concierge turns), start and end timestamps, total duration.
- **Status.** One of ok, error, aborted, with a structured error block when applicable.
- **Input.** The user input string and the inbound context, including attachments and any wire-specific request body.
- **Prompt.** The fully assembled system prompt that was sent to the model.
- **Model.** Identifier of the model used.
- **Tool calls.** A list of every tool invocation: name, arguments, result, success flag, latency, optional policy decision (concierge), optional linked attachments (health coach).
- **Output.** The model's textual output.
- **Usage.** Token counts (input, output, total) when reported by the model.
- **Tags.** Free-form labels the agent or operator may have set on the turn.

Transcripts write under a date-sharded directory tree by agent and identity. Health coach turns write to `<media-dir>/logs/agents/health-coach/<YYYY-MM-DD>/<userId>/`. Concierge turns write to `<media-dir>/logs/agents/concierge/<YYYY-MM-DD>/<satelliteId>/`. The path layout is per-agent configurable; the agent or its HTTP mount selects the strategy.

Transcripts exist as the operational record. They drive debugging (what did the model see and do?), regression analysis (did this turn behave like the last one?), and user-facing transparency (what tools fired in response to my message?).

---

## HTTP surface

Each agent exposes its capability through one or more wire formats mounted on the HTTP layer. The framework provides a generic mount helper; per-agent configuration selects the path, the wire format, the authentication middleware, and any context extraction.

### Native wire

The native wire serves in-app callers. It exposes:

- **Synchronous run.** A POST endpoint that accepts an input string and a context object, executes the turn, and returns the model output and tool call summary as JSON.
- **Streaming run.** A POST endpoint that accepts the same payload and returns Server-Sent Events. Each event is a chunk: text delta, tool start, tool end, finish, or done. A done event signals normal termination; an error event signals failure. The connection sets `X-Accel-Buffering: no` so reverse proxies don't buffer the stream, and tears down cleanly when the client disconnects mid-stream.
- **Background run.** A POST endpoint that queues a turn for asynchronous execution and returns a task id. The caller polls or subscribes to retrieve the result later.
- **Memory administration.** Endpoints for inspecting, modifying, and clearing an agent's memory for a given user. Used by tooling and operators, not by the model itself.
- **Agent listing.** A GET endpoint that returns the list of registered agents with their ids and descriptions.

### OpenAI-compatible wire

The OpenAI-compatible wire serves voice satellites and any other consumer that speaks the OpenAI Chat Completions protocol. It exposes:

- **Chat completions.** A POST endpoint accepting OpenAI-shaped request bodies (messages array, model, optional stream flag) and returning either an OpenAI `chat.completion` object or a sequence of `chat.completion.chunk` Server-Sent Events. Tool start and tool end events are intentionally suppressed on the wire — voice consumers cannot render them.
- **Models discovery.** A GET endpoint advertising the available models for OpenAI-compatible model-selection logic.

The wire authenticates via bearer token. The token resolves to a satellite identity (e.g. a specific voice puck in a specific room), which the framework threads into the turn context. Different satellites may have different allowed skills and policy scopes.

Both wires consume the same underlying turn stream. The wire format is a projection of the orchestrator's chunk output; switching wire formats does not change agent behavior. An agent may mount under multiple wires simultaneously — concierge mounts under the OpenAI-compatible wire for voice consumers and may also mount under the native wire for in-app testing.

---

## Frontend chat surface

The frontend exposes a single chat component that renders any agent. The component handles message threading, streaming consumption, markdown rendering, mention popovers, and tool-call attribution. Per-agent customization is configuration, not separate components.

The component takes:

- **An agent identifier.** Selects the runtime endpoint to call.
- **A user identifier.** Threaded into the request context.
- **A mention configuration, optionally.** Health coach passes a fetch URL, a category list, and an attachment builder; the component renders an `@`-trigger popover that drives the configured backend. Agents without mentions omit the prop entirely; the component does not render a popover.
- **A variant.** Light or overlay. Overlay variant uses the dark dashboard theme for slide-up modal contexts.

The component consumes the streaming wire. As text deltas arrive, the assistant message renders incrementally. Tool start and tool end events accumulate into a `toolCalls` array on the message metadata; the tool-call attribution component renders the attribution row beneath the assistant message ("used `metric_trajectory` · 9ms"). Markdown formatting (bold, lists, code, tables) renders through a shared markdown renderer.

When a turn finishes, the component captures token usage from the finish event and exposes it on the message metadata for any consumer that wants to display it.

---

## Reasoning patterns

For agents that reason over domain data — comparing today to typical, narrating the significance of a number, traversing multiple domain services through one query surface — see [patterns.md](patterns.md). Four named patterns (Domain Event Adapter, User Model in Prompt Context, Baseline Annotation, Reasoning Rails) compose into the reflective agent shape. Each pattern names a recurring failure mode (decision-tree feel, invented baselines, missed comparisons) and the structural fix.

The patterns are framework-agnostic — they layer on top of the lifecycle, tools, memory, and HTTP described above.

---

## Where it lives

- Agent framework core: `backend/src/3_applications/agents/framework/`
- Decorator chain: `backend/src/3_applications/agents/framework/decorators/`
- Working memory port: `backend/src/3_applications/agents/framework/ports/IWorkingMemory.mjs`
- Mastra runtime adapter: `backend/src/1_adapters/agents/`
- Working memory persistence: `backend/src/1_adapters/persistence/yaml/YamlWorkingMemoryAdapter.mjs`
- Concrete agents: `backend/src/3_applications/agents/<agent-name>/`
- HTTP mount and wire formats: `backend/src/4_api/v1/agents/`
- Native HTTP route prefix: `/api/v1/agents`
- OpenAI-compatible HTTP route prefix: `/v1`
- Frontend chat surface: `frontend/src/modules/Agent/`
- Frontend SSE reader: `frontend/src/lib/sse/`
- Per-agent frontend wrappers: `frontend/src/modules/<Domain>/CoachChat/`, `frontend/src/Apps/`
- Transcripts: `<media-dir>/logs/agents/<agentId>/<YYYY-MM-DD>/<identity>/`
- Working memory files: `<data-dir>/users/<userId>/agents/<agentId>/working-memory.yml` (or household-scoped equivalent for concierge)
