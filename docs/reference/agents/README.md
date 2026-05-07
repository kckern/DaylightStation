# Agent Framework

The agent framework hosts AI agents that respond to user input through a unified runtime, tooling layer, memory model, observability surface, and HTTP wire. Each agent contributes its domain — tools, prompts, dependencies — and inherits everything cross-cutting from the framework.

The framework supports any number of agents in a single deployment. Agents range from purely conversational (concierge, health coach) to scheduled or workflow-driven (assignments). All agents share the same lifecycle, the same transcript format, the same chat surface, and the same HTTP wire options.

## What the framework provides

- **Lifecycle.** A turn loads working memory, assembles the system prompt, executes through the runtime, captures a transcript, and persists memory. The agent contributes only its domain logic — tool implementations, prompt content, dependencies.
- **Tooling.** Tools are grouped into bundles. The runtime wraps each tool through a decorator chain that injects user identity, enforces a per-turn call limit, records every call to the transcript, and (optionally) gates execution behind a policy. New cross-cutting behaviors plug in as additional decorators without touching agents.
- **Memory.** A typed working-memory state with TTL support persists per agent per user. Memory loads on turn start, surfaces in the prompt, mutates during the turn, and saves at turn end.
- **Observability.** Every turn produces a JSON transcript with the input, system prompt, model output, every tool call (arguments, result, latency), errors, and usage. Transcripts are date-sharded under a per-agent directory.
- **HTTP.** Each agent exposes its capability through one or more wire formats. The native wire delivers JSON and Server-Sent Events for in-app callers. The OpenAI-compatible wire serves voice satellites and any other consumer that speaks the OpenAI Chat Completions protocol.
- **Frontend.** A single chat component renders any agent. Per-agent customization (mention adapters, message decorations) is configured by the consumer; the rendering, streaming, markdown, and tool-call attribution are shared.

## Where to read next

- **[Architecture](architecture.md)** — turn lifecycle, prompt composition, tool decorator chain, memory model, transcript format, HTTP wire formats, frontend chat surface.
- **[Patterns](patterns.md)** — reusable patterns for domain adapters, user models, baseline annotations, and reasoning rails. Read this if your agent needs to reason over domain data.
- **[Extending](extending.md)** — what's required to add a new agent. End-to-end checklist: agent class, tools, prompts, dependencies, registration, HTTP mount, optional frontend.

## Where it lives

- Agent framework: `backend/src/3_applications/agents/framework/`
- Concrete agents: `backend/src/3_applications/agents/<agent-name>/` (and `backend/src/3_applications/concierge/` until concierge migration completes)
- Mastra runtime adapter: `backend/src/1_adapters/agents/`
- HTTP mount: `backend/src/4_api/v1/agents/`
- Frontend chat surface: `frontend/src/modules/Agent/`
- Per-agent frontend wrappers: `frontend/src/modules/<Domain>/CoachChat/` and `frontend/src/Apps/`
- Transcripts: `<media-dir>/logs/agents/<agentId>/<YYYY-MM-DD>/<userId-or-satelliteId>/`
