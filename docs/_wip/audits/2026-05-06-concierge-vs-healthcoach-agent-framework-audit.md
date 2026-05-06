# Concierge vs Health-Coach Agent Framework Audit

**Date:** 2026-05-06
**Scope:** Side-by-side audit of the **concierge** and **health-coach** agent surfaces — runtime, prompt assembly, tools, memory, transcripts, HTTP wiring, and frontend chat plumbing.
**Goal:** Identify duplication and DRY violations, propose what should converge into a shared agent framework, and call out what should remain agent-specific.
**Audience:** Engineer who knows the codebase. Direct, analytical.

> **Companion doc:** `docs/_wip/audits/2026-05-02-concierge-agentic-architecture-audit.md` examines concierge's *internal* scaling (router → role-agent → fan-out tools). This audit looks *across* concierge and health-coach for a shared framework.

---

## Executive summary

The two agents share a runtime adapter (`MastraAdapter`) but otherwise live in two parallel universes. Concierge has its own application root (`ConciergeApplication`), tool wrapper (`SkillRegistry`), prompt assembly, transcript class (`ConciergeTranscript`), HTTP surface (`OpenAIChatCompletionsTranslator`), policy layer, and memory port. Health-coach (and the other three BaseAgent-derived agents) goes through `BaseAgent` + `AgentOrchestrator` + `AgentTranscript` + `createAgentsRouter`/`createAgentsStreamRouter`. **Concierge predates the agent framework and was never refactored to use it.**

The duplication is mostly *structural* — both code paths solve the same problems with different abstractions: prompt assembly, tool registration, per-turn transcript, SSE streaming, working-memory load/save. They both build a Mastra Agent under the hood but assemble inputs through unrelated machinery.

The frontend has a similar split: three coexisting chat surfaces (`Health/CoachChat`, generic `Chat/ChatPanel`, `Life/views/coach/CoachChat`) — none of which is concierge (concierge has no frontend; it's consumed by HA Voice satellites over an OpenAI-compatible HTTP wire). The Health/CoachChat is built on assistant-ui primitives; the Chat/ChatPanel is a hand-rolled Mantine surface used by the lifeplan-guide agent. There's no shared "AgentChatSurface."

The largest convergence wins are: (1) collapse `ConciergeAgent` into a `BaseAgent` subclass with skill-style tool factories, (2) merge `ConciergeTranscript` into `AgentTranscript`, (3) extract the policy/scope layer out of the concierge SkillRegistry into a generic `ToolPolicyDecorator` mixed in by the orchestrator, (4) wrap `OpenAIChatCompletionsTranslator` to call into the orchestrator instead of `IChatCompletionRunner`, (5) settle on **one** frontend chat surface and delete the others.

What stays agent-specific: tool implementations, prompts, domain adapters (skills/factories that *contain* domain logic), and concierge's satellite-bearer-token auth model (which is genuinely a different access model from a logged-in dashboard user).

---

## 1. Inventory

### 1A. Concierge

#### Agent class / entry point

- **File:** `backend/src/3_applications/concierge/ConciergeAgent.mjs:3`
- **Inherits:** *Nothing* — plain class. Does **not** extend `BaseAgent`.
- **Composition root:** `backend/src/3_applications/concierge/ConciergeApplication.mjs:10`
- **Key methods:** `runChat({ satellite, messages, conversationId, transcript })`, `streamChat(...)`, private `#buildContext(satellite, transcript)`
- **Static id:** `static id = 'concierge'` (`ConciergeAgent.mjs:4`)

```js
// ConciergeAgent.mjs:65-92
async runChat({ satellite, messages, conversationId = null, transcript = null }) {
  const ctx = await this.#buildContext(satellite, transcript);
  if (!ctx.allowed) {
    this.#logger.warn?.('concierge.policy.request_denied', { ... });
    return { content: this.#refusalContent(ctx.decision.reason), toolCalls: [], usage: null };
  }
  const input = lastUserMessage(messages);
  const result = await this.#runtime.execute({
    agentId: ConciergeAgent.id, input, tools: ctx.tools,
    systemPrompt: ctx.prompt, context: { satellite, conversationId },
  });
  const draft = result.output ?? '';
  const final = this.#policy.shapeResponse(satellite, draft);
  return { content: final, toolCalls: result.toolCalls ?? [], usage: result.usage ?? null };
}
```

#### Tools

- **Source of truth:** `SkillRegistry.buildToolsFor(satellite, policy, transcript)` (`backend/src/3_applications/concierge/services/SkillRegistry.mjs:23`)
- Tools come from skills (objects implementing `ISkill` — `ports/ISkill.mjs:10`).
- **Tool shape:** plain objects with `{ name, description, parameters (JSON Schema), execute, defaultPolicy?, getScopesFor? }`.
- **Each tool is wrapped** by `SkillRegistry.#wrap` (line 40) which adds:
  - Policy gate (`policy.evaluateToolCall`)
  - Per-call timing
  - Transcript recording
  - Logger emit
- Skills are registered in `ConciergeApplication` constructor (line 30): `for (const skill of skills) registry.register(skill);`
- Skills currently shipped: `MemorySkill`, `HomeAutomationSkill`, `MediaSkill` (additional `CalendarReadSkill`, `FinanceReadSkill`, `FitnessReadSkill`, `LifelogReadSkill` exist in `concierge/skills/` but are not wired in `bootstrap.mjs`).

```js
// SkillRegistry.mjs:40-58
#wrap(tool, skill, satellite, policy, transcript) {
  return {
    ...tool,
    execute: async (params, ctx) => {
      const decision = policy.evaluateToolCall(satellite, tool.name, params, tool, skill.name);
      if (!decision.allow) {
        const denied = { ok: false, reason: `policy_denied:${decision.reason ?? 'unspecified'}` };
        transcript?.recordTool({ name: tool.name, args: params, result: denied, ok: false, latencyMs: 0,
          policyDecision: { allowed: false, reason: decision.reason ?? null } });
        return denied;
      }
      // ... timing + actual execute + transcript record ...
    },
  };
}
```

#### Prompt assembly

- **Built in** `ConciergeAgent.#buildContext` (`ConciergeAgent.mjs:30-52`)
- **Pieces** (concatenated with `\n\n`):
  1. `BASE_PROMPT` (`prompts/system.mjs:3`) — voice-aware household assistant persona
  2. `personalityPrompt(this.#personality)` — operator-supplied free-form text
  3. `satellitePrompt(satellite)` — names the satellite + lists allowed skills
  4. `this.#skills.buildPromptFragmentsFor(satellite)` — each skill's `getPromptFragment(satellite)` joined by `\n\n`
  5. `vocabularyPrompt(this.#vocabulary)` — household alias map
  6. `memoryPrompt(memorySnapshot)` — JSON-encoded `notes_recent` + `preferences`
- **Memory snapshot** loaded inline (`#snapshotMemory`, line 54): `notes` (last 5) + `preferences`.
- **Filter:** `.filter(Boolean)` to drop empty sections.

```js
// ConciergeAgent.mjs:36-43
const prompt = [
  BASE_PROMPT,
  personalityPrompt(this.#personality),
  satellitePrompt(satellite),
  this.#skills.buildPromptFragmentsFor(satellite),
  vocabularyPrompt(this.#vocabulary),
  memoryPrompt(memorySnapshot),
].filter(Boolean).join('\n\n');
```

#### Memory

- **Port:** `IConciergeMemory` (`ports/IConciergeMemory.mjs:7`) — `get(key)`, `set(key, value)`, `merge(key, partial)`, `delete(key)`.
- **Implementation:** `YamlConciergeMemoryAdapter` (`backend/src/1_adapters/persistence/yaml/YamlConciergeMemoryAdapter.mjs:12`).
- **Underlying:** the *same* `YamlWorkingMemoryAdapter` used by the agent framework, but pinned to constants `AGENT_ID = 'concierge'` and `USER_ID = 'household'` (lines 1-2). Concierge memory is **household-scoped, not user-scoped**.
- **Loaded per request** in `#snapshotMemory` and serialized inline as JSON in the prompt.
- **Saved by tool calls only** (e.g. `MemorySkill.remember_note` writes via `memory.set('notes', notes)`). No automatic save-on-turn-end.

#### Transcript / observability

- **Class:** `ConciergeTranscript` (`backend/src/3_applications/concierge/services/ConciergeTranscript.mjs:16`)
- **Created by:** `OpenAIChatCompletionsTranslator.handle` per request (line 42 of translator).
- **Captures:** request body, full assistant content, every tool invocation (name + args + result + latency + **policyDecision**), final status, latency, usage, satellite info.
- **Written to:** `{mediaLogsDir}/concierge/{YYYY-MM-DD}/{satellite_id}/{ts}-{id}.json` (`ConciergeTranscript.mjs:89`).
- **Policy decisions are first-class** in the transcript (`SkillRegistry.mjs:54-77` records `policyDecision: { allowed, reason }` on every tool entry).

```js
// ConciergeTranscript.mjs:60-81 (toJSON)
return {
  id, startedAt, endedAt, latencyMs,
  satellite: this.satellite ? { id, area, allowedSkills } : null,
  request: this.request,                 // { messages, model, stream, conversation_id }
  response: { status, finishReason, content, usage, error },
  toolInvocations: this.toolInvocations, // includes policyDecision per call
};
```

#### HTTP surface

- **Mounted at** `/v1` (concierge speaks the OpenAI Chat Completions wire format on purpose so HA Voice can use it as a "model").
- **Router:** `createConciergeRouter` (`backend/src/4_api/v1/routers/concierge.mjs:13`)
  - **Auth:** Bearer-token middleware → `satelliteRegistry.findByToken(token)` → `req.satellite`
  - Routes: `POST /chat/completions`, `GET /models` (advertises `daylight-house`, `gpt-4o-mini`)
- **Translator:** `OpenAIChatCompletionsTranslator` (`backend/src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs:11`)
  - Builds `ConciergeTranscript`
  - Branches on `body.stream`:
    - Non-stream: `runner.runChat({ satellite, messages, ... })` → wraps in OpenAI envelope
    - Stream: SSE — emits `chat.completion.chunk` deltas; consumes `runner.streamChat(...)` async iterator; **explicitly does NOT emit tool-start/tool-end to the client** (line 117: `// tool-start / tool-end intentionally NOT emitted to client (Spec §7.2)`)
- **Mounted at:** `app.mjs:2357` — `app.use('/v1', conciergeRouter);`

#### Frontend surface

**None.** Concierge is consumed exclusively by Home Assistant Voice satellites speaking OpenAI Chat Completions over HTTP with bearer auth. There is no concierge React component.

```bash
$ grep -rn "concierge" frontend/src/**/*.{js,jsx}
# (no matches)
```

#### Voice / Alexa surface

- HA Voice satellites use the OpenAI-compatible `/v1/chat/completions` endpoint as their LLM provider.
- The `satellite` object (`ports/ISatelliteRegistry.mjs`) carries `id`, `area`, `allowedSkills`, `scopes_allowed`, `scopes_denied` — passed through to prompts and policy gate.
- No Alexa integration anywhere in the codebase (`grep -rln 'alexa' backend/src` → empty).

---

### 1B. Health-coach

#### Agent class / entry point

- **File:** `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs:17`
- **Inherits:** `BaseAgent` (`backend/src/3_applications/agents/framework/BaseAgent.mjs:11`)
- **Static id:** `static id = 'health-coach'` (line 18)
- **Static description:** `static description = 'Health coaching and fitness dashboard agent';`
- **Key overrides:** `getSystemPrompt(context)`, `formatAttachments(attachments)`, `registerTools()`, `runAssignment(assignmentId, opts)`
- **Entry point in production:** `AgentOrchestrator.run(agentId, input, context)` → `agent.run(input, { context })` (defined on `BaseAgent`).

```js
// HealthCoachAgent.mjs:46-56
async getSystemPrompt(context = {}) {
  const mode = context?.mode ?? 'chat';
  const base = mode === 'dashboard' ? dashboardPrompt : chatPrompt;
  const userId = context?.userId ?? this.#activeUserId ?? null;
  const loader = this.deps.personalContextLoader;
  if (!loader || !userId) return base;
  const bundle = await this.#getPersonalContextBundle(userId, loader);
  return bundle ? `${base}\n\n${bundle}` : base;
}
```

#### Tools

- **Source of truth:** `BaseAgent.getTools()` flattens `this.#toolFactories.flatMap(f => f.createTools())` (`BaseAgent.mjs:51-53`).
- **Tool shape:** `ITool` from `ports/ITool.mjs:10` — `{ name, description, parameters (JSON Schema), execute(params, context) }` — built via `createTool({ ... })` helper.
- **Tool factories** (subclasses of `framework/ToolFactory.mjs:3`) each have a `createTools(): ITool[]`. Registered in `registerTools()` via `this.addToolFactory(...)`:

```js
// HealthCoachAgent.mjs:114-176
registerTools() {
  const { healthStore, healthService, fitnessPlayableService, ... } = this.deps;
  this.addToolFactory(new HealthToolFactory({ healthStore, healthService, sessionService }));
  this.addToolFactory(new FitnessContentToolFactory({ ... }));
  this.addToolFactory(new DashboardToolFactory({ dataService, healthStore }));
  this.addToolFactory(new ReconciliationToolFactory({ healthStore }));
  if (messagingGateway && conversationId) {
    this.addToolFactory(new MessagingChannelToolFactory({ ... }));
  }
  this.addToolFactory(new LongitudinalToolFactory({ ... }));
  this.addToolFactory(new ComplianceToolFactory({ ... }));
  if (healthAnalyticsService) {
    this.addToolFactory(new HealthAnalyticsToolFactory({ healthAnalyticsService }));
  }
  this.registerAssignment(new DailyDashboard());
}
```

- **Tools are wrapped** at runtime by `MastraAdapter.#translateTools` (`backend/src/1_adapters/agents/MastraAdapter.mjs:114`) — adds:
  - `userId` injection (stripped from schema, merged from context)
  - Per-call counter against `maxToolCalls`
  - Per-call timing + transcript recording
  - Try/catch → `{ error: err.message }`
- **No policy layer** — there is no equivalent of `evaluateToolCall`. All tools are open.

#### Prompt assembly

- **Built in** `BaseAgent.#assemblePrompt(memory, context)` (`BaseAgent.mjs:144-156`)
- **Pieces** (joined with `\n\n`):
  1. `await this.getSystemPrompt(context)` — subclass hook, returns either `chatPrompt` or `dashboardPrompt` + optional per-user playbook bundle
  2. `## Active User\nThe user you are assisting is: **${context.userId}**` — when userId present
  3. `await this.formatAttachments(context.attachments)` — `## User Mentions` block (subclass overrides for typed rendering)
  4. `## Working Memory\n${memory.serialize()}` — when memory present
- **Personal context bundle** (per-user playbook YAML) is appended inside `getSystemPrompt`, cached on `#personalContextCache: Map<userId, string>` (line 26 of HealthCoachAgent).
- **Memory rendering** is `WorkingMemoryState.serialize()` (`framework/WorkingMemory.mjs:35-52`) — produces markdown with `### Persistent` / `### Expiring` sections.

```js
// BaseAgent.mjs:144-156
async #assemblePrompt(memory, context = {}) {
  const base = await this.getSystemPrompt(context);
  const sections = [base];
  if (context.userId) sections.push(`## Active User\nThe user you are assisting is: **${context.userId}**`);
  const attachmentsBlock = await this.formatAttachments(context.attachments);
  if (attachmentsBlock) sections.push(attachmentsBlock);
  if (memory) sections.push(`## Working Memory\n${memory.serialize()}`);
  return sections.join('\n\n');
}
```

#### Memory

- **Port:** `IWorkingMemory` (`framework/ports/IWorkingMemory.mjs`) — `load(agentId, userId): Promise<WorkingMemoryState>`, `save(agentId, userId, state): Promise<void>`.
- **State class:** `WorkingMemoryState` (`framework/WorkingMemory.mjs:3`) — `{ get, set, remove, getAll, serialize, pruneExpired, toJSON, fromJSON }` with **TTL support** (entries can have `expiresAt`).
- **Implementation:** `YamlWorkingMemoryAdapter` (`backend/src/1_adapters/agents/YamlWorkingMemoryAdapter.mjs:5`), keyed by `agents/{agentId}/working-memory` with `dataService.user.read/write`. **User-scoped** (per-userId).
- **Loaded automatically** by `BaseAgent.run` (line 60-64) when `effectiveUserId` is non-null.
- **Saved automatically** by `BaseAgent.run` and `runStream` after the LLM call completes (line 73-75; line 108-111 for streaming, in `finally`).

#### Transcript / observability

- **Class:** `AgentTranscript` (`backend/src/3_applications/agents/framework/AgentTranscript.mjs:18`)
- **Created by:** `MastraAdapter.execute` and `MastraAdapter.streamExecute` (lines 199-207 and 281-288 of MastraAdapter).
- **Captures:** `version`, `turnId`, `agentId`, `userId`, `startedAt`, `completedAt`, `durationMs`, `status` (`'ok'|'error'|'aborted'`), `input.text` + `input.context`, `systemPrompt`, `model`, `toolCalls[]` (with `linkedAttachments` heuristic — line 168), `output`, `error`, `tags`.
- **Written to:** `{mediaDir}/logs/agents/{agentId}/{YYYY-MM-DD}/{userId}/{HHMMSS-mmm}-{turnIdShort}.json` (line 139-142).
- **No policy layer** to record (no equivalent of `policyDecision`).

#### HTTP surface

- **Mounted at** `/api/v1/agents/...`.
- **Router:** `createAgentsRouter` (`backend/src/4_api/v1/routers/agents.mjs:30`)
  - `GET /` — list agents
  - `POST /:agentId/run` — sync run, returns `{ output, toolCalls }`
  - `POST /:agentId/run-background` — async, returns `{ taskId }`
  - `GET /:agentId/assignments`
  - `POST /:agentId/assignments/:assignmentId/run`
  - `GET/DELETE /:agentId/memory/:userId[/:key]` — working-memory CRUD
- **Streaming router:** `createAgentsStreamRouter` (`backend/src/4_api/v1/routers/agents-stream.mjs:18`) — separate file
  - `POST /:agentId/run-stream` — SSE — proxies `orchestrator.streamExecute()` chunks 1:1, ending with `{ type: 'done' }`.
  - **Mounted alongside** the agents router at `/api/v1/agents` (`app.mjs:1999`).
- **No auth-bearer model.** Auth is the regular DaylightStation auth pipeline (`householdResolver` → `tokenResolver` → `permissionGate` at `app.mjs:272-281`).

```js
// agents-stream.mjs:21-50 (full handler)
router.post('/:agentId/run-stream', async (req, res) => {
  const { agentId } = req.params;
  const { input, context = {} } = req.body || {};
  // SSE headers ...
  try {
    for await (const chunk of orchestrator.streamExecute(agentId, input, context)) {
      if (closed) break;
      send(chunk);
    }
    send({ type: 'done' });
    res.end();
  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
});
```

#### Frontend surface

- **Component:** `frontend/src/modules/Health/CoachChat/index.jsx` (lines 1-237)
- **Built on** `@assistant-ui/react` v0.x primitives (`ThreadPrimitive`, `ComposerPrimitive`, `MessagePrimitive`, `unstable_useMentionAdapter`)
- **Runtime adapter:** `frontend/src/modules/Health/CoachChat/runtime.js` — exposes `healthCoachChatModel.run` (POST `/api/v1/agents/health-coach/run`) and `healthCoachChatModel.runStream` (POST `/api/v1/agents/health-coach/run-stream`, parses SSE via `parseSSE.js`)
- **Mention support:** prefetches `/api/v1/health/mentions/all?user=...`, groups into `MENTION_CATEGORIES` (`mentions/index.js`), uses `unstable_useMentionAdapter`, accumulates inserted mentions on a `pendingMentionsRef`
- **Markdown:** `MarkdownText.jsx`
- **Tool-call attribution UI:** `ToolCallAttribution.jsx` — renders `metadata.custom.toolCalls`
- **Hard-coded URL:** `'/api/v1/agents/health-coach/run'` and `'/api/v1/agents/health-coach/run-stream'` (runtime.js:23, 63) — agent ID is baked in.

#### Voice / Alexa surface

- None.
- The `messagingGateway` + `conversationId` (Telegram-via-nutribot) is **outbound-from-agent** — the agent uses tools (`MessagingChannelToolFactory`) to *send* coaching messages. There's no inbound voice surface.
- Coaching messages are also driven by the `CoachingOrchestrator` (a separate scheduler-driven path at `bootstrap.mjs:3080`) — not under the agent framework.

---

## 2. Side-by-side comparison

| Concern | Concierge | Health-coach | Same / Similar / Divergent |
|---|---|---|---|
| Runtime (LLM call) | `MastraAdapter` (instance dedicated to concierge — `bootstrap.mjs:3238`) | `MastraAdapter` (instance shared with all framework agents — `bootstrap.mjs:2945`) | **Same class, two instances** — see DRY-H1 |
| Agent base class | None — plain class `ConciergeAgent` | `BaseAgent` | **Divergent** — see DRY-H2 |
| Composition root | `ConciergeApplication` wraps `ConciergeAgent` + `SkillRegistry` | `AgentOrchestrator.register(AgentClass, deps)` instantiates the agent and stores it in a Map | **Divergent** — concierge has its own composition root; health-coach uses the orchestrator |
| Tool registration | `skills.push(new MemorySkill({ memory, ... }))` + `for (const skill of skills) registry.register(skill)` (`ConciergeApplication.mjs:30`) | `this.addToolFactory(new HealthToolFactory({ ... }))` inside `registerTools()` (`HealthCoachAgent.mjs:132`) | **Similar but divergent** — both group tools into named bundles. Concierge bundles are `ISkill` (have `getPromptFragment`); health-coach bundles are `ToolFactory` (no prompt fragment). See DRY-M1. |
| Tool object shape | `{ name, description, parameters (JSON Schema), execute, defaultPolicy?, getScopesFor? }` | `ITool` from `createTool({ name, description, parameters, execute })` — same JSON Schema params, no `defaultPolicy`/`getScopesFor` | **Effectively the same shape**, divergent provenance. See DRY-M2. |
| Prompt assembly | `[BASE_PROMPT, personality, satellite, skill_fragments, vocab, memory_json].filter(Boolean).join('\n\n')` (`ConciergeAgent.mjs:36`) | `[basePrompt, active_user, attachments, working_memory].join('\n\n')` (`BaseAgent.mjs:144`) | **Divergent layout, same pattern** — see DRY-H3 |
| System prompt source | Static const `BASE_PROMPT` from `prompts/system.mjs` + render functions | Subclass `getSystemPrompt(context)` returns `chatPrompt` or `dashboardPrompt` (also static consts in `prompts/chat.mjs` / `prompts/dashboard.mjs`) | **Same idea (static prompt strings)**, different organization |
| Mode branching | None — single prompt | `context.mode === 'dashboard' ? dashboardPrompt : chatPrompt` | **Divergent** (concierge mode is constant; health-coach has chat vs dashboard) |
| Personality / vocab injection | First-class: `personalityPrompt`, `vocabularyPrompt` (`prompts/system.mjs:34, 47`) | None — playbook bundle is the closest analog (per-user, not household-wide) | **Divergent** |
| Memory port | `IConciergeMemory` — `get/set/merge/delete` (`ports/IConciergeMemory.mjs:7`) | `IWorkingMemory` — `load(agentId, userId)/save(agentId, userId, state)` returning `WorkingMemoryState` (with TTL) | **Divergent contracts — but the underlying adapter is the same.** See DRY-H4. |
| Memory scope | Household (hard-coded `USER_ID = 'household'` in `YamlConciergeMemoryAdapter.mjs:2`) | Per-user (resolved via `AgentOrchestrator.#resolveUserId` falling back to head-of-household) | **Divergent intent** — but health-coach also degrades to head-of-household |
| Memory load timing | Lazy, per request, only `notes_recent` (5) + `preferences` flattened (`ConciergeAgent.mjs:54`) | Lazy, per request, full `WorkingMemoryState` (`BaseAgent.mjs:62`) | Similar |
| Memory save timing | Tool-driven only (e.g. `remember_note.execute` calls `memory.set('notes', notes)`) | Automatic — `BaseAgent.run` saves after every turn (`BaseAgent.mjs:73-75`) | **Divergent** |
| Per-turn transcript | `ConciergeTranscript` (`services/ConciergeTranscript.mjs:16`) — captures policyDecision per tool | `AgentTranscript` (`framework/AgentTranscript.mjs:18`) — captures linkedAttachments per tool | **Same idea, two classes** — see DRY-H5 |
| Transcript file location | `{mediaLogsDir}/concierge/{day}/{satellite}/{ts}-{uuid}.json` | `{mediaDir}/logs/agents/{agentId}/{day}/{userId}/{filenameTs}-{turnIdShort}.json` | **Divergent paths**, both date-sharded |
| Transcript creator | `OpenAIChatCompletionsTranslator.handle` (HTTP layer) (`OpenAIChatCompletionsTranslator.mjs:42`) | `MastraAdapter.execute/streamExecute` (runtime layer) (`MastraAdapter.mjs:199, 281`) | **Divergent layer** — concierge transcripts are made one level higher |
| Policy / scope enforcement | `ConciergePolicyEvaluator` enforces scope-glob allow/deny on every tool call (`SkillRegistry.mjs:45`) | None | **Concierge-only feature** — see "What stays agent-specific" |
| Auth | Bearer token → `satelliteRegistry.findByToken(token)` → `req.satellite` | Standard Daylight middleware (household + token + permission gate) | **Divergent** by design (HA Voice ≠ logged-in app user) |
| HTTP wire format | OpenAI Chat Completions (`/v1/chat/completions`) — non-stream and SSE | Custom JSON-in/JSON-out (`/api/v1/agents/:agentId/run`) + SSE (`/api/v1/agents/:agentId/run-stream`) | **Divergent** by design |
| HTTP streaming impl | `OpenAIChatCompletionsTranslator.#stream` writes `chat.completion.chunk` deltas; **suppresses tool events** | `agents-stream.mjs` writes raw chunks 1:1 (text-delta + tool-start + tool-end + finish + done) | **Divergent** by design (HA Voice doesn't want tool events) |
| Frontend surface | None | `Health/CoachChat` (assistant-ui primitives) + custom mention adapter | n/a |
| Other agents using the same runtime/router | n/a (concierge has its own router) | Echo, Lifeplan-guide, PagedMediaToc all share `agents.mjs` + `agents-stream.mjs` | n/a |
| Other frontend chat surfaces | n/a | `Chat/ChatPanel` (Mantine, used by `Life/views/coach/CoachChat.jsx` for lifeplan-guide) — completely separate from `Health/CoachChat` | **Two parallel frontend chat surfaces** — see DRY-H6 |

### 2A. Tool-call execution wrapping (concrete code)

**Concierge — `SkillRegistry.#wrap` (services/SkillRegistry.mjs:40-95):**
```js
return {
  ...tool,
  execute: async (params, ctx) => {
    const decision = policy.evaluateToolCall(satellite, tool.name, params, tool, skill.name);
    if (!decision.allow) {
      const denied = { ok: false, reason: `policy_denied:${decision.reason ?? 'unspecified'}` };
      transcript?.recordTool({ name: tool.name, args: params, result: denied, ok: false, latencyMs: 0,
        policyDecision: { allowed: false, reason: decision.reason ?? null } });
      return denied;
    }
    const start = Date.now();
    try {
      const result = await tool.execute(params, { ...ctx, satellite, skill: skill.name });
      transcript?.recordTool({ name: tool.name, args: params, result,
        ok: result?.ok !== false, latencyMs: Date.now() - start,
        policyDecision: { allowed: true } });
      return result;
    } catch (error) { /* ... */ }
  },
};
```

**Health-coach — `MastraAdapter.#translateTools` (1_adapters/agents/MastraAdapter.mjs:114-187):**
```js
mastraTools[tool.name] = mastraCreateTool({
  id: tool.name,
  description: tool.description,
  inputSchema: jsonSchemaToZod(stripUserIdFromSchema(tool.parameters)),
  execute: async (inputData) => {
    callCounter.count++;
    const args = { ...inputData };
    if (context.userId) args.userId = context.userId;
    if (callCounter.count > this.#maxToolCalls) {
      const msg = `Tool call limit reached (${this.#maxToolCalls}). ...`;
      transcript?.recordTool({ name: tool.name, args, result: { error: msg }, ok: false, latencyMs: 0 });
      return { error: msg };
    }
    const startedAt = Date.now();
    try {
      const result = await tool.execute(args, context);
      transcript?.recordTool({ name: tool.name, args, result,
        ok: !(result && typeof result === 'object' && 'error' in result),
        latencyMs: Date.now() - startedAt });
      return result;
    } catch (error) { /* ... */ }
  },
});
```

**Both wrappers do:** count/limit + start timer + try/catch + transcript recordTool + return error envelope. They differ in policy gating (concierge), userId injection (health-coach), and the schema-to-Zod conversion (only health-coach goes through `jsonSchemaToZod` since concierge's Mastra adapter is the same code — concierge tools also pass through this conversion).

**Crucially, concierge tools go through BOTH wrappers** — `SkillRegistry.#wrap` first (wrapped tool object) then `MastraAdapter.#translateTools` second (Mastra translation). The transcript thus gets a *double recording* per tool call (once from `SkillRegistry`, once from `MastraAdapter`'s wrap of the already-wrapped tool). The health-coach side records only once (since there's no skill wrapper).

### 2B. Per-turn lifecycle

**Concierge (non-stream) — full path of one chat completion:**

```
HA Voice → POST /v1/chat/completions
  → conciergeRouter (auth: Bearer → satelliteRegistry → req.satellite)
  → translator.handle(req, res, satellite)
    → new ConciergeTranscript(...)                                       [transcript A]
    → runner.runChat({ satellite, messages, ..., transcript })           [= ConciergeApplication.runChat]
      → agent.runChat({ satellite, messages, ..., transcript })          [= ConciergeAgent]
        → policy.evaluateRequest(satellite, {})                          [no-op today, allow]
        → memory.get('notes'); memory.get('preferences')                 [load]
        → skills.buildToolsFor(satellite, policy, transcript)            [wrap each tool with SkillRegistry.#wrap]
        → prompt = [BASE, personality, satellite, fragments, vocab, mem].filter.join
        → runtime.execute({ agentId, input, tools, systemPrompt, context })  [= MastraAdapter]
          → new AgentTranscript(...)                                      [transcript B]
          → mastraAgent = new Agent({ name: 'concierge', instructions, model, tools: translatedTools })
          → mastraAgent.generate(input)
          → for each tool call: SkillRegistry.#wrap.execute → MastraAdapter wrapped → tool.execute
          → transcript.flush()                                            [B written to .../logs/agents/concierge/...]
        → policy.shapeResponse(...)
    → translator builds OpenAI envelope
    → translator.transcript.flush()                                      [A written to .../concierge/...]
```

**Two transcripts get written for every concierge turn**, in different formats, in different directories.

**Health-coach (non-stream):**
```
fetch → POST /api/v1/agents/health-coach/run
  → agentsRouter
  → orchestrator.run('health-coach', input, context)
    → resolve userId, generate turnId
    → agent.run(input, { context })                                      [= BaseAgent.run]
      → workingMemory.load(agentId, userId)
      → systemPrompt = await this.#assemblePrompt(memory, context)
      → agentRuntime.execute({ agent, input, tools, systemPrompt, context })  [= MastraAdapter]
        → new AgentTranscript(...)
        → mastraAgent = new Agent({...})
        → mastraAgent.generate(input)
        → transcript.flush()
      → workingMemory.save(agentId, userId, memory)
```

One transcript per turn. The orchestrator/agent/runtime layering is cleaner.

---

## 3. DRY violations / duplication

### High severity

**DRY-H1. Two `MastraAdapter` instances with identical configuration hooks.**
- `bootstrap.mjs:2945` (framework) and `bootstrap.mjs:3238` (concierge) both `new MastraAdapter({ logger, mediaDir, ... })`.
- Concierge's instance gets `model` only when used by the MediaJudge subagent (`bootstrap.mjs:3333`). Otherwise it uses the default `'openai/gpt-4o'` baked into `MastraAdapter` constructor (line 99). The framework instance uses the same default.
- **Cost:** two Mastra `Agent` constructions per turn for concierge (one for the agent, one if the judge runs). Two `AgentTranscript` objects writing two files for concierge turns (one from `MastraAdapter`, one from `OpenAIChatCompletionsTranslator` via `ConciergeTranscript`).
- **Proposed abstraction:** Single shared `MastraAdapter` instance owned by the bootstrap layer; `AgentOrchestrator.register(ConciergeAgent, deps)` for concierge too. The judge subagent can be a tool-call inside concierge agent (or its own registered agent) — either way it should reuse the same adapter.

**DRY-H2. ConciergeAgent reimplements BaseAgent.**
- `ConciergeAgent` (`ConciergeAgent.mjs:3-123`) implements `runChat`/`streamChat` with its own context-build, prompt-assemble, tool-list, runtime-call. `BaseAgent` (`BaseAgent.mjs:11-194`) has `run`/`runStream` that do exactly this.
- Reasons concierge can't *trivially* drop in `BaseAgent` today:
  - `BaseAgent.run` takes `(input: string, { userId, context })`; concierge's `runChat` takes `({ satellite, messages, conversationId, transcript })`. Adapter shape mismatch.
  - `BaseAgent`-style tools have signature `execute(args, context)` — concierge tools currently receive a context that includes `satellite`, `skill`. Need to ensure `context.satellite` flows through.
  - Concierge's prompt has 6 sections vs. BaseAgent's 4 — the satellite/personality/vocabulary sections need a hook.
  - Concierge requires a per-tool policy gate that BaseAgent doesn't have.
- **Proposed abstraction:** a `BaseAgent` that exposes prompt-section hooks and a tool-decorator chain, with concierge as a subclass that overrides `getSystemPrompt(context) → { sections: [...] }` and registers a `PolicyToolDecorator`.

**DRY-H3. Two prompt-assembly functions.**
- `ConciergeAgent.#buildContext` (lines 30-52) and `BaseAgent.#assemblePrompt` (lines 144-156) are different implementations of the same operation: gather a base prompt, append zero or more contextual sections, join with `\n\n`.
- Both filter empty/missing sections (concierge: `.filter(Boolean)`; BaseAgent: omits via `if`). Both serialize memory into the prompt. Both surface "active user / satellite" context.
- **Proposed abstraction:** `PromptAssembler` (in `agents/framework/`) — composable section list with a `compose(sections: Array<string|null>)` static. Or just give `BaseAgent` a `buildPromptSections(context, memory): string[]` hook that subclasses override (concierge would push satellite + personality + vocab sections; health-coach would push attachments + memory). Same `\n\n` join.

**DRY-H4. Two memory ports backed by the same adapter.**
- `IConciergeMemory.get/set/merge/delete` (concierge) vs `IWorkingMemory.load/save` returning `WorkingMemoryState.get/set/remove` (framework) — see `IConciergeMemory.mjs:7` vs `framework/ports/IWorkingMemory.mjs`.
- `YamlConciergeMemoryAdapter` (`backend/src/1_adapters/persistence/yaml/YamlConciergeMemoryAdapter.mjs:12`) is a **thin per-key facade over** `YamlWorkingMemoryAdapter` (`backend/src/1_adapters/agents/YamlWorkingMemoryAdapter.mjs:5`) pinned to `agentId='concierge'` and `userId='household'`.
- `YamlConciergeMemoryAdapter.set('notes', value)` does: `state = wm.load('concierge','household')`, `state.set('notes', value)`, `wm.save('concierge','household', state)` — i.e. it loads + writes the entire state file for every key write. `BaseAgent` does this once per turn.
- **Proposed abstraction:** delete `IConciergeMemory` and `YamlConciergeMemoryAdapter`. Concierge agent uses `IWorkingMemory` directly (with `userId='household'`) — exactly like every other agent. `MemorySkill.remember_note` becomes a tool that mutates `state.set('notes', notes)` on the **already-loaded** `WorkingMemoryState` passed in via `context.memory`. Auto-save at end of turn. Same correctness, far less code.

**DRY-H5. Two transcript classes.**
- `ConciergeTranscript` (`services/ConciergeTranscript.mjs:16-107`) and `AgentTranscript` (`framework/AgentTranscript.mjs:18-227`) both:
  - Hold input, output, toolCalls list, error, status, startedAt/endedAt
  - Have `recordTool({ name, args, result, ok, latencyMs })`
  - Have `flush()` writing JSON to a date-sharded path
  - Have `safeClone` helpers
- Differences:
  - `ConciergeTranscript` adds `policyDecision` per tool, `satellite` block, `request` block (raw OpenAI body)
  - `AgentTranscript` adds `linkedAttachments` heuristic, `userId`, `tags`, `version`, `model`, `systemPrompt`
  - Different output paths
- **Proposed abstraction:** `AgentTranscript` is the keeper; add optional fields:
  - `recordTool({ ..., policyDecision? })`
  - `setRequest(rawHttpBody?)` — concierge can populate it; other agents leave it null
  - `setSatellite(satelliteSnapshot?)` — likewise
  - File-path strategy injectable via constructor (defaults to `logs/agents/{agentId}/...`)

**DRY-H6. Two backend HTTP layers exposing the same agent capability.**
- Concierge has `createConciergeRouter` + `OpenAIChatCompletionsTranslator` (180 lines of translator logic).
- Health-coach (and lifeplan-guide etc.) has `createAgentsRouter` + `createAgentsStreamRouter`.
- They speak different wire formats — that's intentional. **But** the body of `OpenAIChatCompletionsTranslator.#stream` reads `IChatCompletionRunner.streamChat()` chunks (`text-delta`, `finish`) while `createAgentsStreamRouter` reads `orchestrator.streamExecute()` chunks (same shape!). Two consumers of the same chunk stream living in different files.
- The non-stream JSON path in concierge (`runner.runChat → envelope`) and in agents (`orchestrator.run → res.json`) are also doing the same thing structurally.
- **Proposed abstraction:** `mountAgentHttp(orchestrator, agentId, app, { wireFormat, authMiddleware, mountPath })`:
  - `wireFormat: 'native'` (current `agents.mjs` JSON shape)
  - `wireFormat: 'openai-chat-completions'` (current `concierge.mjs` shape, with the satellite resolved by `authMiddleware` and threaded into `context`)
  - The OpenAI translator becomes a *projection* of the shared runtime stream, not a parallel stack.

**DRY-H7. Three frontend chat surfaces, two of which call agent endpoints.**

Three coexisting chat surfaces (none is concierge — concierge is consumed by HA Voice satellites only):

1. `frontend/src/modules/Health/CoachChat/index.jsx` — assistant-ui v0.x primitives, custom mention adapter, SSE (calls `/api/v1/agents/health-coach/run-stream`)
2. `frontend/src/modules/Chat/ChatPanel.jsx` (+ `useChatEngine.js`) — Mantine, no streaming, no mentions, calls `/api/agents/{agentId}/run` (note: `/api/`, not `/api/v1/` — different path!)
3. `frontend/src/modules/Life/views/coach/CoachChat.jsx` — wraps `ChatPanel` for `lifeplan-guide`

The `Chat` module supports any agentId via prop; the `Health/CoachChat` is hardcoded to health-coach. They are **structurally divergent** despite calling agents through the same orchestrator.

`useChatEngine.js:31` uses `'/api/agents/'` — note the missing `/v1/`. This is **a bug** unless there's a redirect in app.mjs (there isn't — see `api.mjs:98` mounting at `/api/v1/agents`). The lifeplan chat won't currently work in production; this confirms how cold this surface is.

- **Proposed abstraction:** keep one `AgentChatSurface` (assistant-ui based, since the health-coach side is more mature), add an optional `mentionAdapterFactory` prop that defaults to no mentions for agents that don't expose a `/mentions/all` endpoint. Delete `Chat/ChatPanel`/`useChatEngine.js`/`Life/views/coach/CoachChat.jsx`.

### Medium severity

**DRY-M1. ISkill vs ToolFactory — same pattern, different contracts.**
- `ISkill.getTools(): ITool[]` + `getPromptFragment(satellite): string` + `getConfig(): object` + `name: string`
- `ToolFactory.createTools(): ITool[]` + `static domain` (advisory only)
- Both are "named bundle of tools." Concierge's `ISkill` adds the prompt-fragment hook; framework's `ToolFactory` doesn't.
- **Proposed abstraction:** unify into `ToolBundle`: `{ name, createTools(), getPromptFragment?(context), getConfig?() }`. Prompt fragment is optional and concierge skills retain it; health-coach factories ignore it.

**DRY-M2. Tool object shape — convergent but not unified.**
- Concierge skills produce plain objects via object literals. Framework tools are produced via `createTool({ ... })` helper (`ports/ITool.mjs:52`).
- They produce structurally identical objects (`{ name, description, parameters, execute }`). MastraAdapter consumes both successfully.
- **Concierge tools also have:** `defaultPolicy?: 'open'|'closed'`, `getScopesFor?(args): string[]`. Health-coach tools don't.
- **Proposed abstraction:** Concierge tools migrate to `createTool({ ..., defaultPolicy?, getScopesFor? })`. The `ToolPolicyDecorator` (see DRY-H2) reads these optional fields and is a no-op when absent.

**DRY-M3. `safeClone` duplicated.**
- `AgentTranscript.mjs:218-225` and `ConciergeTranscript.mjs:98-105` — identical implementations.
- Hoist to `framework/utils/safeClone.mjs` (or just `framework/AgentTranscript.mjs` exports it).

**DRY-M4. Two SSE consumers in the frontend (none shared).**
- `parseSSE.js` exists only inside `CoachChat/`. `useChatEngine.js` does *not* support streaming at all — it does single-shot fetch.
- **Proposed abstraction:** lift `parseSSE` to `frontend/src/lib/sse/parseSSE.js` (or `frontend/src/modules/Agent/parseSSE.js`); make it the canonical SSE reader for any agent stream consumer.

**DRY-M5. Per-turn timing / logger emit pattern.**
- `SkillRegistry.#wrap` (lines 60-68) and `MastraAdapter.#translateTools` (lines 131-186) both emit a `*.invoke` log + a `*.complete` log around each tool call.
- The log event names diverge (`concierge.tool.invoke` vs `tool.execute.call`). Same content.
- **Proposed abstraction:** the unified `ToolDecorator` chain emits one canonical event series.

**DRY-M6. Logger-child `component:` propagation.**
- Concierge bootstrap creates child loggers manually for every component (`bootstrap.mjs:3239, 3244, 3250, 3257, 3262, 3303, ...`). Health-coach largely does not (uses the agent's injected logger directly).
- Not a duplication — a divergent convention. Worth aligning, low priority.

### Low severity (acceptable repetition)

- **`today()`/`daysAgo(n)` helpers** in `HealthToolFactory.mjs:253-261`. Trivially small.
- **JSON-Schema `parameters: { type: 'object', properties: {...}, required: [...] }` blocks repeated across all tool definitions.** This is the wire format; not worth abstracting.
- **`extractText(msg)` in `runtime.js:45-55`** — three lines; not worth abstracting.

---

## 4. Convergence opportunities

### 4A. Backend

**4A-1. `mountAgentHttp(orchestrator, agentId, app, options)` — unified HTTP wiring.**
- Replaces both `createAgentsRouter`/`createAgentsStreamRouter` and `createConciergeRouter`/`OpenAIChatCompletionsTranslator`.
- Options include:
  - `mountPath: '/api/v1/agents/...' | '/v1/chat/completions'`
  - `wireFormat: 'native' | 'openai-chat-completions'` (presets that drive request parsing + response shaping)
  - `authMiddleware: (req, res, next) => void` — concierge passes its bearer-token middleware here; health-coach passes a no-op (or the standard household middleware is composed at app level)
  - `extractContext: (req) => ({ userId?, satellite?, conversationId? })` — wire-format-specific extraction
- **What it replaces:** `createAgentsRouter` (run-only paths), `createAgentsStreamRouter`, `createConciergeRouter` + `OpenAIChatCompletionsTranslator`.
- **What stays per-agent:** the agent class + tools + prompts.

**4A-2. `BaseAgent.buildPromptSections(context, memory): string[]` — composable prompt sections.**
- Default impl returns the four current sections. Subclass adds/replaces sections.
- Concierge subclass returns `[basePrompt, personality, satellite, skillPromptFragments, vocab, memorySnapshot]`.
- Health-coach inherits default.

**4A-3. `ToolDecorator` chain replacing `SkillRegistry.#wrap`.**
- Each decorator is `(tool, context) => wrappedTool`. Standard chain:
  - `userIdInjectorDecorator` (current `MastraAdapter` behavior — strip from schema, inject from context)
  - `transcriptRecorderDecorator` (records every call to the active `AgentTranscript`)
  - `policyGateDecorator` (only added when `tool.getScopesFor` or agent declares a policy)
- The chain runs once at agent-construction time (or per-turn if any decorator is per-turn). Mastra's adapter-level wrap goes away; `MastraAdapter` becomes a pure runtime, not a tool-instrumentation layer.

**4A-4. Single `AgentTranscript` with optional fields for satellite/policy/request-body.**
- See DRY-H5 for the shape.
- Concierge transcript directory becomes `{mediaDir}/logs/agents/concierge/{day}/{satellite_id}/...` (folder convention unified; concierge gets a satellite-keyed directory rather than userId-keyed).

**4A-5. `IWorkingMemory` is the only memory port.**
- `IConciergeMemory` and `YamlConciergeMemoryAdapter` are deleted.
- `MemorySkill` becomes a thin tool factory that mutates the in-memory `WorkingMemoryState` for the current turn (no per-tool I/O).

**4A-6. Unified registration via `AgentOrchestrator.register(ConciergeAgent, deps)`.**
- Currently concierge is wired in `createConciergeServices` as a separate composition root (`bootstrap.mjs:3403`).
- After convergence, concierge registers like every other agent. The OpenAI translator + bearer auth become an HTTP-layer concern (mounted via `mountAgentHttp`), not an application-layer concern.

### 4B. Frontend

**4B-1. `<AgentChatSurface agentId, userId, mentions?>` — single React component.**
- Built on `@assistant-ui/react` primitives (the `Health/CoachChat` foundation).
- Optional `mentions` prop with `{ fetchSuggestionsUrl, buildAttachment, categories }` — only health-coach passes it.
- Internally uses streaming when the orchestrator stream endpoint is reachable, falls back to non-stream.
- Replaces: `Health/CoachChat/index.jsx`, `Chat/ChatPanel.jsx`, `Chat/useChatEngine.js`, `Life/views/coach/CoachChat.jsx`.

**4B-2. `lib/sse/parseSSE.js` — single SSE reader.**
- Move `frontend/src/modules/Health/CoachChat/parseSSE.js` up to `frontend/src/lib/sse/`.

**4B-3. Per-agent runtime adapter contract.**
- `createAgentRuntime(agentId): { run, runStream }` factory takes the agent ID and returns the assistant-ui-shaped chat model. Agent-specific UI customization (mention adapter, custom message rendering) lives in the wrapping component, not the runtime.

### 4C. Composition

**4C-1. `agents.config.yml` (or per-app config slice) — declarative agent list.**
- Per-agent: id, runtime model, frontend mount points, HTTP wire format(s), backend deps refs.
- Bootstrap reads this list and registers each agent rather than hard-coding `agentOrchestrator.register(EchoAgent)`, `agentOrchestrator.register(HealthCoachAgent, ...)`, etc.

---

## 5. What SHOULD remain agent-specific

These belong inside each agent's directory and are NOT candidates for abstraction:

1. **Tool implementations.** Each agent's tool factories own real domain logic (HealthToolFactory reads `healthStore`; HomeAutomationSkill calls `haGateway.callService(...)`; MediaSkill orchestrates `PlayMediaUseCase`). Trying to "share tools" means breaking domain boundaries.

2. **Prompt content.** The actual text of `BASE_PROMPT`, `chatPrompt`, `dashboardPrompt`, `personalityPrompt`, etc. The *assembly machinery* should converge; the *content* must not.

3. **Domain adapters / dependencies.** `healthStore`, `haGateway`, `contentQueryService`, `messagingGateway`, `personalContextLoader` — these are agent-specific deps. The orchestrator's `register(AgentClass, deps)` already accommodates this.

4. **Per-agent attachment formatters.** `formatHealthAttachment` (`HealthCoachAgent.formatAttachment`) is intimately tied to `periodResolver` and the health domain. Concierge has no attachments today; if it grows them, they'd be device/area-typed, not period-typed.

5. **Concierge's policy/scope layer.** `ConciergePolicyEvaluator` + per-tool `defaultPolicy` + `getScopesFor` is genuinely concierge-specific because of the multi-satellite trust model. Other agents run with one logged-in user. **However**, the *mechanism* (a `ToolDecorator` that consults a policy provider) should be generic — only the wiring is per-agent.

6. **Concierge's bearer-token / satellite auth.** HA Voice satellites don't share a session with the dashboard; they have their own opaque token. This stays concierge-specific.

7. **Concierge's OpenAI Chat Completions wire format.** HA Voice expects this format; we don't get to change it. The HTTP-layer abstraction must accommodate it as a wire-format option.

8. **Health-coach's assignment subsystem.** `Assignment.execute` (template method `gather → buildPrompt → reason → validate → act`) is a structured-workflow pattern that concierge doesn't need today (concierge is purely conversational). Stays in framework, used opt-in.

9. **Health-coach's `personalContextLoader` cache.** Per-user playbook YAML rendering is a domain feature. The pattern (per-user-id memoization keyed off a loader port) is reasonable to generalize *if* a second agent grows the same need; today it shouldn't be lifted.

10. **Frontend mention adapter for health.** The `@-mention` UX in `CoachChat` is tightly coupled to the health mentions endpoint and `buildAttachment`. Concierge has no UI; if it grows one, it might want satellite/area mentions, not period mentions. Keep mention adapters as per-agent extension points off the shared `<AgentChatSurface>`.

---

## 6. Recommended target architecture

### Directory structure

```
backend/src/3_applications/agents/
├── framework/                          ← stays; expands
│   ├── BaseAgent.mjs                   ← prompt-section hook + decorator chain
│   ├── ToolFactory.mjs
│   ├── ToolBundle.mjs                  ← NEW, replaces ISkill
│   ├── decorators/                     ← NEW
│   │   ├── ToolDecorator.mjs           ← interface
│   │   ├── UserIdInjector.mjs          ← from MastraAdapter
│   │   ├── TranscriptRecorder.mjs      ← from MastraAdapter + SkillRegistry
│   │   ├── PolicyGate.mjs              ← from SkillRegistry.#wrap
│   │   └── CallLimiter.mjs             ← from MastraAdapter
│   ├── PromptAssembler.mjs             ← NEW — defaults + section composition
│   ├── AgentTranscript.mjs             ← absorbs ConciergeTranscript fields
│   ├── WorkingMemory.mjs
│   ├── Assignment.mjs
│   ├── OutputValidator.mjs
│   ├── Scheduler.mjs
│   └── ports/
│       ├── IWorkingMemory.mjs
│       ├── ITool.mjs
│       └── ToolDecorator.mjs           ← NEW
├── AgentOrchestrator.mjs               ← unchanged surface, owns the decorator chain
├── echo/                               ← unchanged
├── lifeplan-guide/                     ← unchanged
├── paged-media-toc/                    ← unchanged
├── health-coach/                       ← unchanged
└── concierge/                          ← MOVED HERE from concierge/
    ├── ConciergeAgent.mjs              ← extends BaseAgent
    ├── prompts/
    ├── skills/                         ← migrate ISkill → ToolBundle
    ├── policy/
    │   ├── ConciergePolicyEvaluator.mjs
    │   └── scopeMatcher.mjs
    └── voice/                          ← satellite-related stuff if any

backend/src/4_api/v1/
├── agents/
│   ├── mountAgentHttp.mjs              ← NEW, replaces all four routers
│   └── wireFormats/
│       ├── native.mjs                  ← /api/v1/agents/:agentId/run + /run-stream
│       └── openaiChatCompletions.mjs   ← /v1/chat/completions (concierge wire)
└── routers/                            ← agents.mjs / agents-stream.mjs / concierge.mjs DELETED

backend/src/1_adapters/agents/
├── MastraAdapter.mjs                   ← becomes thin: just translates ITool → Mastra tool, calls model
└── YamlWorkingMemoryAdapter.mjs        ← unchanged
                                        ← YamlConciergeMemoryAdapter DELETED

frontend/src/modules/Agent/             ← NEW
├── AgentChatSurface.jsx                ← single chat component
├── runtime.js                          ← createAgentRuntime(agentId)
├── parseSSE.js                         ← lifted from CoachChat
└── mentions/
    └── MentionAdapter.jsx              ← optional per-agent prop wrapper

frontend/src/modules/Health/CoachChat/  ← becomes a thin wrapper
└── index.jsx                           ← <AgentChatSurface agentId='health-coach' mentions={healthMentions} />

frontend/src/modules/Chat/              ← DELETED
frontend/src/modules/Life/views/coach/  ← becomes a wrapper around AgentChatSurface
```

### Public interfaces (sketches)

**BaseAgent contract (additions in CAPS):**
```js
class BaseAgent {
  static id;
  static description;

  // Existing
  registerTools() { /* call this.addToolFactory(...) */ }
  async getSystemPrompt(context) { /* return base text */ }

  // NEW — overridable prompt-section hook (default impl matches today's BaseAgent behavior)
  async buildPromptSections(context, memory) {
    return [
      await this.getSystemPrompt(context),
      context.userId ? `## Active User\n...` : null,
      await this.formatAttachments(context.attachments),
      memory ? `## Working Memory\n${memory.serialize()}` : null,
    ];
  }

  // NEW — overridable decorator chain (default: [UserIdInjector, CallLimiter, TranscriptRecorder])
  buildToolDecorators() { return [/* defaults injected by orchestrator */]; }
}
```

**ToolBundle contract:**
```js
class ToolBundle {
  static name;
  createTools() { return []; }                  // required
  getPromptFragment(context) { return null; }   // optional, only concierge skills implement
  getConfig() { return {}; }                    // optional
}
```

**Tool object (with optional policy fields):**
```js
createTool({
  name, description, parameters,
  execute,
  defaultPolicy: 'open',                        // optional, only concierge uses
  getScopesFor: (args) => ['media:play'],       // optional, only concierge uses
});
```

**HTTP mount:**
```js
// backend/src/4_api/v1/agents/mountAgentHttp.mjs
export function mountAgentHttp(app, {
  orchestrator,
  agentId,
  mountPath,                  // '/api/v1/agents' or '/v1'
  wireFormat,                 // 'native' or 'openai-chat-completions'
  authMiddleware,             // satellite resolver for concierge, no-op for native
  contextExtractor,           // (req) => ({ userId, satellite, conversationId })
  logger,
}) { /* mounts /run, /run-stream, or /chat/completions depending on wireFormat */ }
```

**Frontend chat surface:**
```jsx
<AgentChatSurface
  agentId="health-coach"
  userId={userId}
  mentions={{
    fetchUrl: `/api/v1/health/mentions/all?user=${userId}`,
    buildAttachment,
    categories: MENTION_CATEGORIES,
  }}
/>

<AgentChatSurface agentId="lifeplan-guide" userId="default" />  {/* no mentions */}
```

### What this does NOT include

This sketch deliberately avoids:
- Making concierge multi-tenant or non-OpenAI-wire (it must remain HA-Voice compatible).
- Generalizing concierge's policy gate before there's a second user. Today only concierge needs scoped policy. The decorator slot is generic; the implementation is concierge-only until a second consumer appears.
- Auto-discovering agents from filesystem. The bootstrap can declare them; YAML-driven registration is a later optimization.
- Removing the concierge `MediaJudge` (`bootstrap.mjs:3340`). It can stay as-is — it's a sub-agent owned by `MediaSkill`, not a top-level agent.

---

## 7. Migration plan (high-level, dependency-ordered)

1. **Lift `safeClone` to a shared util** (DRY-M3). Trivial unblock for steps 2-3.
2. **Extend `AgentTranscript` with optional `policyDecision`, `satelliteSnapshot`, `requestBody` fields.** Concierge transcript path still uses `ConciergeTranscript` for now — but the unified one is ready.
3. **Introduce `ToolDecorator` chain inside `MastraAdapter`** (refactor `#translateTools`). Default chain matches current behavior. Verify health-coach unchanged.
4. **Add `BaseAgent.buildPromptSections()` hook.** Default returns the current four sections. Verify all existing BaseAgent agents unchanged.
5. **Migrate concierge skills → `ToolBundle`**. Add `defaultPolicy`/`getScopesFor` to `createTool`. Verify per-tool wrap output is identical.
6. **Subclass concierge as `ConciergeAgent extends BaseAgent`**, deleting `ConciergeApplication`. Concierge registers via `agentOrchestrator.register(ConciergeAgent, deps)`. Test end-to-end against HA Voice.
7. **Replace `ConciergeTranscript` with `AgentTranscript`** (with the new optional fields). Adjust file path strategy.
8. **Delete `IConciergeMemory` and `YamlConciergeMemoryAdapter`.** `MemorySkill` mutates `context.memory` directly.
9. **Build `mountAgentHttp` with `wireFormat` switch.** Migrate concierge mount; keep `agents.mjs`/`agents-stream.mjs` as thin redirects; eventually delete.
10. **Frontend: lift `parseSSE` and create `<AgentChatSurface>`.** Migrate `Health/CoachChat` to wrap it. Delete `Chat/ChatPanel`, `useChatEngine`, `Life/views/coach/CoachChat` (replace lifeplan call site with `<AgentChatSurface agentId='lifeplan-guide' />`).
11. **(Optional, late)** Declarative agent registration via `agents.config.yml`.

Each step is independently testable. Steps 1-4 are pure framework moves with no behavior change; 5-9 are concierge migration; 10 is frontend cleanup. Steps 5 and 6 should land together — splitting them creates a half-converted concierge that's worse than either end-state.

---

## 8. Open questions

- **Q1. Should the concierge transcript merge with the per-agent transcript directory?**
  - Today: `{mediaLogsDir}/concierge/{day}/{satellite}/{ts}-{id}.json` and `{mediaDir}/logs/agents/concierge/{day}/{userId}/{filenameTs}-{turnIdShort}.json` are *both* written for every concierge turn (DRY-H5 + DRY-H1). Operators may have tooling that reads either path.
  - Proposed: collapse to `{mediaDir}/logs/agents/concierge/{day}/{satellite_id}/...` — but does anything read the legacy `{mediaLogsDir}/concierge/...` path?
- **Q2. Is `ConciergePolicyEvaluator` actually used today?**
  - `ConciergeAgent.runChat` calls `policy.evaluateRequest(satellite, {})` and `policy.shapeResponse(...)`. The evaluator's `evaluateRequest` and `shapeResponse` are no-ops (`ConciergePolicyEvaluator.mjs:32-33`). The teeth are in `evaluateToolCall`, called from `SkillRegistry.#wrap`. **Are any satellite scopes_allowed/scopes_denied actually populated in production concierge.yml?** If not, lifting the policy gate to the framework is premature.
- **Q3. Should concierge migrate to `BaseAgent` *before* or *after* the audit `2026-05-02-concierge-agentic-architecture-audit.md` proposed router → role-agent split?**
  - The 2026-05-02 audit proposes restructuring concierge into multiple sub-agents. If we go BaseAgent-first, the sub-agents get BaseAgent for free. If we restructure first, we'll re-fork the agent code and pay the conversion cost twice.
- **Q4. Does the `Chat/ChatPanel` lifeplan path actually work in production today?**
  - `useChatEngine.js:31` posts to `/api/agents/...` (no `/v1/`). I see no router at `/api/agents` in `app.mjs`. If this path is dead, deleting it is free; if there's a redirect I missed, behavior may change.
- **Q5. Does concierge need streaming SSE on `/v1/chat/completions` for HA Voice?**
  - The translator supports it (`OpenAIChatCompletionsTranslator.#stream`). HA Voice typically *does* request `stream: true` from OpenAI-compatible providers. But this should be confirmed against actual HA Voice traffic before any HTTP-layer refactor — the streaming consumer-side parsing is the most fragile interface to change.
- **Q6. Why are there 4 concierge skills (`CalendarReadSkill`, `FinanceReadSkill`, `FitnessReadSkill`, `LifelogReadSkill`) under `concierge/skills/` that bootstrap.mjs doesn't wire?**
  - Either dead code or pending wiring. If dead, deleting is part of the migration; if pending, the `ToolBundle` migration should account for them.
- **Q7. Should `EchoAgent` extend `BaseAgent`?**
  - It currently does not (`EchoAgent.mjs:16`) — it has its own `run()` mirroring BaseAgent's logic. The plan implicitly proposes this; calling out for the record.
- **Q8. Should the `CoachingOrchestrator` be folded into the agent framework?**
  - It runs scheduled coaching messages (`bootstrap.mjs:3080`) using its own `CoachingCommentaryService` + a directly-instantiated `Mastra Agent` (line 3068). It's a parallel agent runtime that bypasses `AgentOrchestrator`. Worth a separate pass — out of scope for this audit.
- **Q9. Are there any consumers of `IConciergeMemory.merge` that need preserving?**
  - `MemorySkill` doesn't use `merge`. Other concierge skills don't import `memory` at all. If `merge` has no callers, the migration to `IWorkingMemory` is purely additive.
- **Q10. Does `bootstrap.mjs` create the framework `MastraAdapter` *before* the concierge one, and is there state in `MastraAdapter` we'd lose by sharing?**
  - `MastraAdapter` has only constructor-level config (model, maxToolCalls, timeout, mediaDir). No per-instance state beyond config. Sharing should be safe — but the framework instance has no model override and the concierge judge instance pins a cheap model with `maxToolCalls: 1, timeoutMs: 8000`. The judge case is genuinely a separate runtime config — this is fine; AgentOrchestrator can hold one default runtime and let MediaSkill request a separately-configured runtime instance for the judge.
