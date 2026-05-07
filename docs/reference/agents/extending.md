# Extending the Framework with a New Agent

This document describes everything required to add a new agent to the framework. It is a contract: when each step is satisfied, the new agent is a first-class peer of the existing ones — its turns flow through the same lifecycle, write the same transcripts, persist the same memory model, expose the same HTTP options, and render through the same chat surface.

For the architecture context, see [architecture](architecture.md).

---

## Agent class

A new agent declares its identity, its prompts, its tool registration, and any prompt-section or decorator-chain customization. Agents inherit from the framework's base agent class.

### Identity

Each agent has a stable short id (lowercase, hyphenated) and a one-line human-readable description. The id appears in transcripts, in HTTP routes, in memory paths, and in the frontend's runtime selector. Once an agent ships, its id does not change.

### Prompts

The agent provides one or more base prompt strings. The selection is contextual: an agent serving multiple modes (chat vs. dashboard vs. scheduled assignment) returns the appropriate base for the mode. Agents may also append per-user content — the health coach renders a per-user playbook YAML into the prompt; the concierge renders household-wide personality and vocabulary.

The default prompt section list — base, active user, attachments, working memory — covers most agents. An agent that needs additional sections (satellite identity, skill prompt fragments, household vocabulary) overrides the section builder to produce its own list. Sections compose with double-newline joins; null or empty sections drop.

Prompts live as static module-level constants alongside the agent class. They are not configuration — changing prompt content is a code change, since prompt content drives behavior.

### Tools

Tools group into bundles. A bundle exposes a `createTools()` method returning a list of tool descriptors (name, description, JSON Schema parameters, execute function). The agent registers its bundles during construction.

Each tool's `execute` receives the model-supplied arguments and a context object. The context contains the resolved user identity, the active working memory state, the active transcript, and any agent-specific context (satellite identity for concierge, conversation id for messaging tools). Tools should mutate working memory directly when persistence is required — the framework saves at turn end. Tools should not perform their own memory I/O.

A tool that returns a structured result on success should return a structured error envelope on failure (`{ error: 'reason' }`). The framework's transcript recorder treats the presence of an `error` key as a failure signal. Tools that throw are caught by the recorder, recorded as failures, and transformed into error envelopes — so a thrown exception does not surface to the model. Tools should still prefer explicit error envelopes for known failure modes; throws are reserved for genuinely unexpected conditions.

A tool that needs the resolved user identity should declare a `userId` parameter in its JSON Schema. The user-id injector decorator strips this parameter from the schema the model sees and merges the resolved identity into arguments at execute time. The model never has to ask for the user.

### Optional prompt section override

When an agent needs additional prompt sections beyond the default four, it overrides the section builder. The override returns the full ordered list of sections, including the base. The framework filters falsy entries and joins the rest. There is no need to reimplement the default sections — the override either replaces them entirely or supplements them by calling the inherited builder and concatenating.

### Optional decorator chain override

When an agent needs cross-cutting behavior beyond the default chain (user-id injection, call limiting, transcript recording), it overrides the decorator builder. The override returns an ordered list of decorators; the framework applies them left-to-right, leftmost outermost. Concierge adds a policy gate that consults a satellite-scope evaluator. Other agents may add domain-specific decorators (rate limiting per resource, audit logging to an external system, response shaping).

---

## Dependencies

The agent's constructor receives the concrete adapters it depends on. These are instances, not factories — wiring happens at composition time. A health coach receives a health store, a fitness session service, a messaging gateway, a personal context loader. A concierge receives a memory adapter, a home automation gateway, a content service, a satellite registry, a policy evaluator.

Dependencies are agent-specific. Two agents that touch the same domain (e.g. both reading from the health store) receive the same instance — but the framework does not enforce this. The composition root in bootstrap decides which instances flow where.

The framework injects four base dependencies into every agent: the runtime adapter, the working memory port, a logger, and (for some agents) a transcript factory. These are not agent-specific.

---

## Registration

The agent registers with the orchestrator at bootstrap time. Registration takes the agent class and its dependencies; the orchestrator instantiates the agent, calls `registerTools()` on it, and stores it in its registry.

After registration, the agent is reachable through the orchestrator's `run` and `streamExecute` methods by id. Either of these is what the HTTP layer calls when a request arrives for that agent.

Registration also feeds the agent listing endpoint. A registered agent appears in `GET /api/v1/agents` automatically.

---

## HTTP mount

Every agent exposes its capability through at least one HTTP wire. The framework provides a mount helper that takes the orchestrator, the agent id, the mount path, the wire format, optional authentication middleware, and an optional context extractor.

A typical agent mounts under the native wire at `/api/v1/agents/<agentId>`. This exposes:

- A synchronous run endpoint
- A streaming run endpoint
- A background run endpoint
- Memory administration endpoints
- Agent listing entry

An agent destined for voice consumers mounts under the OpenAI-compatible wire at `/v1/chat/completions`. This exposes:

- Chat completions (sync and streaming)
- Models discovery

An agent may mount under multiple wires simultaneously. Concierge mounts under the OpenAI-compatible wire for voice satellites and may also mount under the native wire for in-app testing.

The authentication middleware is wire-specific. The native wire composes with the standard household session authentication at the application level — the mount helper does not need to add it. The OpenAI-compatible wire requires bearer-token authentication that resolves the token to a satellite identity; the mount helper accepts this middleware as configuration.

The context extractor is a function from the request to a partial context object. The native wire's default extractor pulls user id from the request body. The OpenAI wire's extractor pulls satellite identity from the resolved authentication and conversation id from the request body. The extractor's output merges with the agent's own context resolution (e.g. defaulting an anonymous user id to the head of household).

---

## Frontend (optional)

An agent that has a user-facing chat surface renders through the shared chat component. Per-agent customization is configuration:

- **Mention support.** If the agent's domain has a typed reference set (periods, days, metrics for the health coach; satellites, areas for a future concierge UI), the agent's frontend wrapper passes a mention configuration with a fetch URL, a category list, and an attachment builder. The chat component renders an `@`-trigger popover that drives the backend mentions endpoint. Agents without mentions omit the prop; no popover renders.
- **Variant.** Light or overlay. Overlay applies the dark dashboard theme for slide-up modal contexts.
- **Style overrides.** A consumer may pass style props for layout customization (height, max-width, etc.).

The wrapper is a thin component — typically under fifty lines — that imports the shared chat surface and passes the agent id, user id, mentions config, and variant. The wrapper lives in the agent's domain module (e.g. `frontend/src/modules/<Domain>/<AgentName>/`).

An agent without a frontend (purely voice or scheduled) skips this entirely.

---

## Memory (optional)

By default, an agent's working memory is per-user. Memory loads at turn start for the resolved user id and saves at turn end. Anonymous turns skip memory.

An agent serving a household-collective surface (concierge with voice satellites) configures memory to use a household-scoped identity rather than a per-user identity. This is a single line of configuration in the agent's constructor — the underlying memory port and adapter remain unchanged.

Tools mutate memory by setting keys on the loaded state during the turn. Persistent entries (`set(key, value)`) survive indefinitely. Expiring entries (`set(key, value, { ttl })`) are pruned automatically on the next load after the TTL elapses.

The agent surfaces memory in the prompt by including a memory snapshot section. The default prompt section list includes this automatically when memory loads non-empty. An agent overriding the section list typically preserves the memory snapshot, possibly with custom rendering.

---

## Observability (automatic)

Transcripts capture every turn automatically. The agent contributes nothing to the transcript directly — the framework's runtime adapter constructs the transcript at turn start, the decorator chain records every tool call, and the runtime flushes the transcript at turn end.

An agent that needs to record domain-specific information on the turn (a policy decision per tool, a satellite snapshot, a raw HTTP body) provides it through the optional transcript fields. The transcript supports adding a per-tool policy decision, a satellite snapshot at the turn level, and a raw request body — all optional, all silent when not used.

An agent serving a different transcript directory layout (e.g. concierge keying by satellite identity rather than user id) configures the transcript's file-path strategy in its mount.

---

## Checklist

Adding a new agent requires:

- [ ] An agent class extending the framework base, with id, description, and getSystemPrompt.
- [ ] One or more tool bundles registering through `registerTools()`.
- [ ] The agent's dependencies wired in the bootstrap composition root.
- [ ] Orchestrator registration in bootstrap.
- [ ] An HTTP mount in bootstrap, with the appropriate wire format for the consumer.
- [ ] (Optional) A prompt-section override if the default four sections aren't enough.
- [ ] (Optional) A decorator chain override if the default three decorators aren't enough.
- [ ] (Optional) A frontend wrapper passing the agent id and mentions config to the shared chat surface.
- [ ] (Optional) A memory-scope override if the agent serves a household-collective surface rather than per-user.

Nothing outside this list is required. The agent does not implement HTTP wiring, transcript writing, memory persistence, prompt assembly machinery, tool wrapping, or chat UI. It contributes its domain.

---

## Patterns

If your agent reasons over domain data, consider these patterns before designing tools from scratch — see [patterns.md](patterns.md):

- **Reasoning over multiple domains** (workouts + meals + weigh-ins, or notes + tasks + calendar): use the **Domain Event Adapter** pattern. Each domain implements list/detail/summary; the agent gets one query surface.
- **The agent needs to know what's typical for this user**: use the **User Model in Prompt Context** pattern. Compose profile + baselines + recent context into a markdown block prepended to the system prompt.
- **The agent should describe whether values are anomalous**: use the **Baseline Annotation** pattern. Fold `vs_baseline` into adapter rows so the agent reads "delta -12, delta_pct -8" instead of doing the math.
- **The agent drifts into parroting / inventing baselines / listing without comparing**: use **Reasoning Rails** in the system prompt — citation, validation, comparison, default windows, don't-ask-back.

Not every agent needs every pattern. A simple workflow agent that runs a fixed pipeline doesn't need a user model. Pick the patterns that fit the failure modes you're seeing.

---

## Where it lives

- Framework base: `backend/src/3_applications/agents/framework/BaseAgent.mjs`
- Tool bundle base: `backend/src/3_applications/agents/framework/ToolFactory.mjs` (with `ToolBundle` extending it)
- Orchestrator: `backend/src/3_applications/agents/AgentOrchestrator.mjs`
- Decorator interfaces and built-ins: `backend/src/3_applications/agents/framework/decorators/`
- Working memory port: `backend/src/3_applications/agents/framework/ports/IWorkingMemory.mjs`
- HTTP mount helper: `backend/src/4_api/v1/agents/mountAgentHttp.mjs`
- Wire format presets: `backend/src/4_api/v1/agents/wireFormats/`
- Bootstrap composition root: `backend/src/bootstrap.mjs`
- Frontend chat surface: `frontend/src/modules/Agent/AgentChatSurface.jsx`
- Frontend runtime factory: `frontend/src/modules/Agent/runtime.js`
- Per-agent frontend wrappers: `frontend/src/modules/<Domain>/<AgentName>/`
