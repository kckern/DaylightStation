# DaylightStation Brain Endpoint — v1 Design

**Status:** Approved (awaiting implementation plan)
**Date:** 2026-05-01
**Audience:** DaylightStation engineers
**Consumer:** Home Assistant Voice PE → HA Assist pipeline → DaylightStation `/v1/chat/completions`

---

## 1. Goal

DaylightStation hosts the conversation brain for Home Assistant Voice PE satellites. HA already handles wake word, STT, TTS, and the Assist pipeline; DS supplies the LLM-backed agent that turns voice into household action.

We expose an **OpenAI Chat Completions–compatible HTTP endpoint**. HA's built-in OpenAI Conversation integration points its `base_url` at us and treats us as an OpenAI replacement. There is no HA-specific code on either side.

Internally, the endpoint is a **Mastra-backed `BrainAgent`** that owns tool execution, policy gates, household memory, and per-satellite scope. We do **not** ship a thin pass-through proxy as a first phase: the codebase already has Mastra wired with OpenAI built in (via model strings like `'openai/gpt-4o'` in `MastraAdapter`), so the original spec's "Phase 1" and "Phase 2" collapse into a single architecture.

---

## 2. Scope

### 2.1 In scope for v1

- `POST /v1/chat/completions` (non-streaming and streaming)
- `GET /v1/models`
- Bearer-token auth, **one token per satellite**, identity = scope
- `BrainAgent` with curated skill surface:
  - **HomeAutomation** skill (toggle entity, activate scene, run script, get state)
  - **Media** skill (search via `ContentQueryService` → DS playback URL → HA `media_player.play_media`)
  - **CalendarRead**, **LifelogRead**, **FinanceRead**, **FitnessRead** read-only skills
  - **Memory** skill (`remember_note`, `recall_note`)
- Per-satellite skill allowlist (`Satellite.allowedSkills`)
- Household-scoped working memory (single shared state across satellites)
- `IBrainPolicy` port with `PassThroughBrainPolicy` default implementation; the seams are real and config-driven, the rules are empty
- `macvlan_net` Docker compose change so the puck on `10.0.0.0/25` can reach DS
- Per-step structured logging on the existing `0_system/logging` infrastructure with redaction rules

### 2.2 Out of scope for v1

- Multi-tenant auth across households (single-household assumption)
- Embeddings / RAG over household docs
- Write access to non-HA personal domains (calendar add, journal write, etc.)
- Full mid-stream policy rewrites (`shapeResponse` is non-streaming-only in v1)
- Conversation transcript persistence
- Per-satellite area constraints, named scope profiles (extension points, not v1 enforcement)
- Per-satellite memory scopes (household scope only in v1)

---

## 3. Architectural decisions

Each subsection captures a fork resolved during brainstorming and the rationale.

### 3.1 Single Mastra-backed agent from day one

Mastra is already wired with OpenAI built in. A passthrough proxy phase is dead weight — the moment we route `/v1/chat/completions` through `MastraAdapter.execute()`, we are at "Phase 2." The external API (OpenAI-compatible) is identical regardless of internal architecture.

### 3.2 BrainAgent owns all tools

When HA sends its own tool list (`HassTurnOn`, `HassTurnOff`, etc.) in a request, we **strip and ignore it**. The BrainAgent substitutes its own `ITool` implementations backed by `IHomeAutomationGateway`. Friendly-name → entity_id resolution happens server-side. The model only sees our tool surface; the response to HA never carries `tool_calls`.

Rationale: clean architecture, reuses existing `HomeAutomationContainer` use cases, lets BrainAgent enforce policies at the boundary, no async tool_call/tool_result round-trips with HA, scales cleanly to non-HA tools.

### 3.3 Tool surface = HA + media + read-only domains

v1 exposes HA control, media play, and read-only access to existing `3_applications` domain services (calendar, lifelog, finance, fitness). Read-only keeps blast radius small while making the assistant useful beyond "smart switch." We only consume tools where the underlying service already publishes a clean read API.

### 3.4 Identity = per-satellite bearer token

Each Voice PE satellite is configured with its own token (`DAYLIGHT_BRAIN_TOKEN_<satellite>`). DS maps `token → Satellite { id, mediaPlayerEntity, area, allowedSkills, defaults }` via `data/household/config/brain.yml`. Auth check and identity lookup are the same step. For v1's single satellite this is one token; the abstraction generalizes for free.

### 3.5 Memory = household-scoped, identity = per-satellite

Working memory is stored at the **household** level — a single shared `WorkingMemoryState`. The kitchen Voice PE and the bedroom Voice PE see the same long-term notes. **Capability**, on the other hand, is per-satellite (next decision).

This separation matters: a single source of household truth, but different speakers have different powers.

### 3.6 Scope enforcement = per-satellite skill allowlist

Each `Satellite` has `allowedSkills: [home_automation, media, calendar_read, …]`. The `SkillRegistry` filters its registered skills by this allowlist when assembling the model's tool surface. The model literally cannot emit a tool_call for a forbidden tool because it never sees the tool. v1 treats the allowlist as the only enforcement; the design leaves room to layer on area constraints and named scope profiles later without restructuring.

### 3.7 Policy = thin port + passthrough v1

`IBrainPolicy` has three methods (`evaluateRequest`, `evaluateToolCall`, `shapeResponse`). v1 ships `PassThroughBrainPolicy` (every method is a no-op pass). The seams are wired through the BrainAgent at three pre-defined points and a config file (`data/household/config/brain-policies.yml`) exists but is sparse. Adding a real rule later is a single-file change.

### 3.8 Streaming = required from v1

`stream: true` on `/v1/chat/completions` is supported on day one. `MastraAdapter` is extended with a `streamExecute()` method (port change in `IAgentRuntime`); the inbound translator emits OpenAI SSE chunks. `shapeResponse` policy hook is **not** applied mid-stream in v1 (pre-flight gate and per-tool gate still apply).

### 3.9 Media streaming origin = DS

DS is already the unified streaming proxy for all content (`docs/reference/content/content-playback.md`). The media-play tool resolves a content match to the DS playback URL pattern documented in `content-id-resolver.md`, then issues `IHomeAutomationGateway.callService('media_player','play_media', { entity_id, media_content_id: <ds_url> })`. The puck fetches bytes from DS over `macvlan_net`. No proliferation of source-direct URLs leaking out.

---

## 4. Architecture

### 4.1 Layered layout (DDD-clean)

```
2_domains/brain/
  ├─ Satellite.mjs                        — entity: id, allowedSkills, mediaPlayerEntity, area, defaults
  ├─ BrainDecision.mjs                    — value object: { allow: boolean, reason?: string }
  └─ index.mjs

3_applications/brain/
  ├─ BrainApplication.mjs                 — composition root; depends only on ports
  ├─ BrainAgent.mjs                       — extends BaseAgent
  ├─ services/
  │   ├─ PassThroughBrainPolicy.mjs       — default IBrainPolicy (v1 no-op)
  │   └─ SkillRegistry.mjs                — register skills, build tools/prompt-fragments per satellite
  ├─ skills/
  │   ├─ HomeAutomationSkill.mjs
  │   ├─ MediaSkill.mjs
  │   ├─ CalendarReadSkill.mjs
  │   ├─ LifelogReadSkill.mjs
  │   ├─ FinanceReadSkill.mjs
  │   ├─ FitnessReadSkill.mjs
  │   └─ MemorySkill.mjs
  └─ ports/
      ├─ ISkill.mjs                       — getName, getTools, getPromptFragment, getConfig
      ├─ ISatelliteRegistry.mjs           — findByToken(token) → Satellite | null
      ├─ IBrainPolicy.mjs                 — evaluateRequest / evaluateToolCall / shapeResponse
      ├─ IBrainMemory.mjs                 — household-scoped get/set/merge
      └─ IChatCompletionRunner.mjs        — runChat / streamChat

3_applications/agents/ports/
  └─ IAgentRuntime.mjs                    — extended: execute() + streamExecute()

1_adapters/
  ├─ persistence/yaml/YamlSatelliteRegistry.mjs   — ISatelliteRegistry impl
  └─ agents/MastraAdapter.mjs                     — extended: execute() + streamExecute()

4_api/v1/
  ├─ routers/brain.mjs                            — Express wiring + bearer middleware
  └─ translators/OpenAIChatCompletionsTranslator.mjs  — wire format ↔ IChatCompletionRunner

data/household/config/
  ├─ brain.yml                                    — satellite descriptors (token refs to Infisical)
  ├─ brain-policies.yml                           — sparse in v1; populated as policies grow
  └─ skills/
      ├─ home_automation.yml
      ├─ media.yml
      ├─ calendar_read.yml
      ├─ lifelog_read.yml
      ├─ finance_read.yml
      ├─ fitness_read.yml
      └─ memory.yml
```

### 4.2 Dependency rules

- **Domain (`2_domains/brain/`)** depends on nothing.
- **Application (`3_applications/brain/`)** depends on its own ports, the brain domain, and other applications' published use-case ports. It never imports from `1_adapters/` or `4_api/`.
- **Adapters (`1_adapters/`)** implement application ports. They never know about each other.
- **API (`4_api/`)** is the only place that knows the OpenAI wire shape. It depends on `IChatCompletionRunner` (port), not on `BrainApplication` (concrete).
- **`BrainApplication`** is the only place that knows which concrete adapter implements which port — composition root for the brain.

### 4.3 Cross-application tool dependencies

Each skill depends on **published use-case ports** from the application it integrates with — never on a `Container` factory or internal service:

- `HomeAutomationSkill` → `IToggleDashboardEntity`, `IActivateDashboardScene`, `IGetDashboardState`, `IRunScript` (and `IHomeAutomationGateway.callService` for raw service calls when no use case fits)
- `MediaSkill` → `IContentQuery` (port over `ContentQueryService.search` / `resolve`) + `IHomeAutomationGateway.callService` (for `media_player.play_media`)
- `CalendarReadSkill`, `LifelogReadSkill`, `FinanceReadSkill`, `FitnessReadSkill` → each consumes a single read-port from the matching application

Where a use-case port doesn't yet exist on a target application (likely for some of these), the implementation plan introduces **the minimum port** on that application — not new business logic, just a published interface for what already runs.

---

## 5. Component contracts

### 5.1 Domain: `2_domains/brain/`

**`Satellite`** — entity
```
fields:    id, mediaPlayerEntity, area, allowedSkills, defaultVolume, defaultMediaClass
behavior:  canUseSkill(name), mediaPlayerFor(class?), validate() — throws on missing media_player_entity or empty allowed_skills
no I/O:    constructed from a plain config object
```

**`BrainDecision`** — value object: `{ allow: boolean, reason?: string }`. Return type for every `IBrainPolicy` method.

### 5.2 Ports: `3_applications/brain/ports/`

**`ISkill`**
```
name: string
getTools(): ITool[]
getPromptFragment(satellite): string
getConfig(): object
```

**`ISatelliteRegistry`** — `findByToken(token: string) → Satellite | null`. One method.

**`IBrainPolicy`**
```
evaluateRequest(satellite, request) → BrainDecision
evaluateToolCall(satellite, toolName, args) → BrainDecision
shapeResponse(satellite, draftText) → string   // non-streaming only in v1
```

**`IBrainMemory`** — household-scoped: `get(key)`, `set(key, value)`, `merge(key, partial)`. Backed in v1 by `YamlWorkingMemoryAdapter` under a fixed `'household'` user key (a thin `YamlBrainMemoryAdapter` wrapper is acceptable if the literal-string-as-userId feels too tightly coupled — implementation choice, not a design fork).

**`IChatCompletionRunner`** — what `BrainApplication` exposes:
```
runChat({ satellite, messages, tools?, stream: false }) → { content, toolCalls, usage }
streamChat({ satellite, messages, tools? }) → AsyncIterable<ChatChunk>
```
The optional `tools?` parameter is a passthrough hook for callers (HA sends its own tool list); `BrainApplication` ignores client-supplied tools and uses its own `SkillRegistry`. Keeping the parameter in the contract means the inbound adapter doesn't have to drop it; the application has the final say.

### 5.3 Application services: `3_applications/brain/services/`

**`PassThroughBrainPolicy`** — default v1 implementation: every `evaluate*` returns `{allow: true}`, `shapeResponse` returns the draft unchanged. The seam is real; the rules are empty.

**`SkillRegistry`**
```
register(skill: ISkill)
getSkillsFor(satellite: Satellite) → ISkill[]                 // filtered by allowedSkills
buildToolsFor(satellite, policy) → ITool[]                    // flatten + wrap with policy gate
buildPromptFragmentsFor(satellite) → string                   // concatenate prompt fragments
```

### 5.4 `BrainAgent` (`3_applications/brain/BrainAgent.mjs`)

Extends `BaseAgent`. Per-request:
1. Resolve satellite from auth context (passed in by the inbound adapter).
2. `policy.evaluateRequest(satellite, request)` — if denied, return a satellite-shaped refusal text without calling Mastra.
3. Build the system prompt: `BasePrompt + SatellitePrompt(satellite) + SkillRegistry.buildPromptFragmentsFor(satellite) + Memory(household) + PolicyPrompt(satellite)`.
4. `tools = SkillRegistry.buildToolsFor(satellite, policy)` — each tool wrapper consults `policy.evaluateToolCall(...)` before delegating to the underlying skill.
5. Call `agentRuntime.execute(...)` (non-stream) or `agentRuntime.streamExecute(...)` (stream).
6. Non-stream only: `policy.shapeResponse(satellite, draft) → final`.
7. Persist any agent-driven memory mutations (via `MemorySkill` tools).

### 5.5 `BrainApplication` (composition root)

Constructor takes the three consumed brain ports (`ISatelliteRegistry`, `IBrainPolicy`, `IBrainMemory`) + `IAgentRuntime` + `IContentQuery` + `IHomeAutomationGateway` + the use-case ports of other domain applications (calendar / lifelog / finance / fitness reads). Instantiates `BrainAgent` and `SkillRegistry`, registers the v1 skills (each constructed with the ports it needs), and exposes `IChatCompletionRunner`.

This is the **one** file that knows which concrete adapter backs which brain port. The exposed `IChatCompletionRunner` is what the inbound API depends on; the consumed ports are what `BrainApplication` is given.

### 5.6 Inbound API: `4_api/v1/`

**`routers/brain.mjs`**
- `POST /v1/chat/completions` and `GET /v1/models`.
- Bearer middleware: `Authorization: Bearer <token>` → `req.satellite = registry.findByToken(token)` → `401` on miss.
- Hands off to `OpenAIChatCompletionsTranslator.handle(req, res, satellite)`.

**`translators/OpenAIChatCompletionsTranslator`** — only place that knows OpenAI wire format:
- Parses request body → `IChatCompletionRunner` input.
- Branches on `stream`: calls `runChat()` (returns JSON in OpenAI envelope) or `streamChat()` (writes SSE chunks per OpenAI spec, terminates with `data: [DONE]`).
- Maps errors to OpenAI error envelope and HTTP status code (see §8).

### 5.7 Outbound adapters: `1_adapters/`

**`YamlSatelliteRegistry`** — reads `data/household/config/brain.yml`, hydrates `Satellite` entities. Tokens are env-resolved (yaml has `token_ref: ENV:DAYLIGHT_BRAIN_TOKEN_LIVINGROOM`, adapter substitutes via `ConfigService.getSecret()`).

**`MastraAdapter`** *(extended)* — adds `streamExecute(opts)` returning `AsyncIterable<{type:'text-delta'|'tool-start'|'tool-end'|'finish', ...}>`. The chunk shape is OpenAI-agnostic; the inbound translator maps it to OpenAI SSE.

---

## 6. Skills

A skill is the natural unit that ships together: its tools + a system-prompt fragment + its own config + (later) skill-scoped policy. Skills are the granularity of `Satellite.allowedSkills`.

### 6.1 v1 skill list

| Skill | Tools (v1) | Reads / writes |
|---|---|---|
| `home_automation` | `ha_toggle_entity`, `ha_activate_scene`, `ha_run_script`, `ha_get_state` | reads & writes HA via `IHomeAutomationGateway` |
| `media` | `play_media` | reads via `IContentQuery`, plays via HA `media_player.play_media` |
| `calendar_read` | `get_calendar_events` | reads only |
| `lifelog_read` | `recent_lifelog_entries`, `query_journal` | reads only |
| `finance_read` | `account_balances`, `recent_transactions`, `budget_summary` | reads only |
| `fitness_read` | `recent_workouts`, `fitness_summary` | reads only |
| `memory` | `remember_note`, `recall_note` | reads & writes household memory |

A single tool may exist in only one skill. If two skills want the same capability, factor it into a shared utility — don't duplicate the tool.

### 6.2 Skill configs

Each skill loads its own YAML from `data/household/config/skills/<name>.yml` via `ConfigService`. Examples:

```yaml
# data/household/config/skills/media.yml
default_volume: 30
blocked_sources: []
prefix_aliases:
  workout: "playlist:workout"
  bedtime: "playlist:bedtime"
```

```yaml
# data/household/config/skills/home_automation.yml
friendly_name_aliases:
  "office light": "light.office_main"
  "living room": "area:livingroom"
area_priority:
  - kitchen
  - livingroom
```

Skills look up their own config — they do not read from a central blob. Keeps each skill self-contained and easy to test.

### 6.3 Adding a new skill

1. Implement `ISkill` in `3_applications/brain/skills/<NewSkill>.mjs`.
2. Register it in `BrainApplication` composition root.
3. Optionally add `data/household/config/skills/<new>.yml`.
4. Add the skill name to a satellite's `allowedSkills` in `data/household/config/brain.yml`.

No changes to `BrainAgent`, `SkillRegistry`, or any other layer.

---

## 7. Data flow

### 7.1 Non-streaming: "Turn on the office light"

1. HA → `POST /v1/chat/completions`, `Authorization: Bearer <token>`, `messages`, `tools` (HA's), `stream:false`.
2. Router → bearer middleware → `Satellite` resolved.
3. Router → `OpenAIChatCompletionsTranslator.handle()` → `IChatCompletionRunner.runChat({ satellite, messages, tools })`.
4. `BrainApplication.runChat` → `BrainAgent.run(input, ctx)`.
5. `BrainAgent`:
   - `policy.evaluateRequest(satellite, request)` → `{allow:true}`.
   - `memory.get('household')` → notes block.
   - `tools = SkillRegistry.buildToolsFor(satellite, policy)`. **HA's tool list from the request is dropped here.**
   - System prompt assembled (base + satellite + skill fragments + memory + policy).
   - `runtime.execute(prompt, tools, messages)`.
6. Mastra → emits `tool_call('ha_toggle_entity', { name:'office light' })`.
7. Tool wrapper:
   - `policy.evaluateToolCall(satellite, 'ha_toggle_entity', {name:'office light'})` → `{allow:true}`.
   - HomeAutomationSkill resolves `"office light"` → `light.office_main` (using `friendly_name_aliases` + fuzzy match against `gateway.getStates()`).
   - `gateway.callService('light','turn_on',{entity_id:'light.office_main'})`.
   - Returns `{ok:true, entity_id, action:'turn_on'}`.
8. Mastra → final assistant text: "Office light is on."
9. `BrainAgent` → `policy.shapeResponse(satellite, draft) → final` (passthrough in v1).
10. `BrainAgent` → `memory.merge(...)` if any `remember_note` was invoked.
11. Translator → wraps `final` in OpenAI envelope. **`tool_calls` field is always empty.**
12. Router → 200 OK with JSON.

The model never sees `light.office_main`. HA never sees a tool_call. From HA's perspective, the response is a friendly text completion.

### 7.2 Streaming: "Tell me a joke"

Same as 7.1 with two differences:
- `BrainAgent` calls `runtime.streamExecute(...)` instead of `runtime.execute(...)`.
- Translator emits SSE chunks per OpenAI spec as text-deltas arrive, terminating with `data: [DONE]\n\n`.
- Tool calls during stream: when a `tool-start` chunk arrives from the runtime, the wrapper executes the tool synchronously off-stream; the runtime resumes generating; the inbound adapter never emits `tool_calls` deltas. Net: streamed text only, tool work happens server-side mid-stream.
- `policy.shapeResponse` is **skipped** in v1 streams. The pre-flight gate (`evaluateRequest`) and per-tool gate (`evaluateToolCall`) still run.

### 7.3 Media play: "Play the workout playlist"

```
BrainAgent → tool wrapper → policy.evaluateToolCall → MediaSkill.play_media
  → ContentQueryService.search({text: "playlist:workout playlist"})
       (uses MediaSkill's prefix_aliases; falls through to text search if no prefix)
       (parallel multi-source: plex, audiobookshelf, fs, …)
  → top item with relevance score; if zero matches, return {ok:false, reason:'no_match'}
  → ContentQueryService.resolve(item.source, item.localId)
       (resolves a playlist/container down to its first playable)
  → build DS playback URL per content-id-resolver.md
       (e.g., http://10.0.0.5:3111/media/<source>:<id>/play?token=…)
  → IHomeAutomationGateway.callService('media_player','play_media', {
       entity_id: satellite.mediaPlayerEntity,
       media_content_id: <ds_url>,
       media_content_type: item.contentType ?? 'music'
     })
  → return {ok:true, title, artist, mediaPlayer: satellite.mediaPlayerEntity}
```

Tool returns structured JSON. The model writes the natural-language confirmation. We do **not** template the response ourselves.

### 7.4 Memory access

- **Read on entry:** `memory.get('household')` → injected into system prompt as a `## Known household notes` block, capped at ~1KB.
- **Write on exit:** only when the agent invokes `remember_note` via the Memory skill. Avoids the "write everything" anti-pattern that pollutes context.

### 7.5 Identity check — unknown token

Router → `registry.findByToken("badtoken")` → null → `401` with OpenAI envelope `{error:{message:"invalid_token", type:"auth", code:"invalid_token"}}`. No further work; no log of message contents.

---

## 8. Error handling

### 8.1 Class 1 — auth/transport (`401`, `400`, `404`)

Translator returns OpenAI envelope:
```json
{ "error": { "message": "...", "type": "invalid_request_error" | "auth", "code": "..." } }
```
No request body in logs (avoid leaking household chatter). Stable codes: `invalid_token`, `unknown_satellite`, `unsupported_endpoint`, `bad_request`. Logged as `brain.auth.failed`.

### 8.2 Class 2 — policy refusal (200 with refusal text)

When `evaluateRequest` or `evaluateToolCall` denies, we do **not** return an HTTP error — that breaks HA's TTS pipeline. We synthesize a friendly refusal completion:
```json
{ "choices":[{ "message":{ "content": "I can't do that right now — <reason>." }, "finish_reason":"stop" }] }
```
Tool-level refusals stay inside the agent loop: the tool wrapper returns `{ok:false, reason:'policy_denied'}` to the model, which renders it as natural language. Logged as `brain.policy.request_denied` or `brain.tool.policy_denied`.

### 8.3 Class 3 — tool / runtime / upstream failures

- **Tool failure** (gateway down, content not found): tool returns `{ok:false, reason}`; model handles it. We never fail the whole request because one tool failed. Logged as `brain.tool.error`.
- **Mastra/LLM upstream failure**: translator returns `502` with envelope `code:"upstream_unavailable"`. HA TTS-es the failure. Logged as `brain.runtime.error`.
- **Internal exception** (bug, contract violation): translator returns `500` + envelope; logs full stack via `serializeError()`. Never crash the route — `asyncHandler` already catches; we only need to ensure the error path always emits OpenAI shape.

### 8.4 Streaming errors

Once SSE has started, status codes are fixed. Two cases:
- **Pre-stream failure** (auth, policy refusal): handled at handler entry, before `res.write` — normal HTTP response.
- **Mid-stream failure** (upstream disconnect, tool wrapper threw): emit a final synthetic chunk with `delta.content` containing a brief error sentence + `finish_reason:"error"`, then `data: [DONE]`. HA TTS-es the partial response. Logged as `brain.stream.error`.

### 8.5 Tool-call timeouts

`MastraAdapter.timeoutMs` (currently 120s) is the ceiling for the whole agent run. Per-tool timeouts live inside each tool's `execute()`. A tool timeout becomes `{ok:false, reason:'timeout'}` to the model — same path as any tool failure.

---

## 9. Logging & observability

### 9.1 Pattern

Every layer takes a logger via DI. The inbound API creates a per-request `child()` logger bound with `{ satellite_id, conversation_id, endpoint }` and passes it down the stack so every line is correlatable.

### 9.2 Events

| Event | Level | Where |
|---|---|---|
| `brain.request.received` `{satellite_id, conv_id, stream, msg_count}` | info | router |
| `brain.auth.failed` `{code, ip, token_prefix}` | warn | router |
| `brain.policy.request_denied` `{satellite_id, reason}` | warn | BrainAgent |
| `brain.skills.resolved` `{satellite_id, skills, tool_count}` | debug | BrainAgent |
| `brain.memory.read` `{scope, bytes}` | debug | BrainAgent |
| `brain.runtime.start` `{mode, tool_count}` | info | BrainAgent |
| `brain.runtime.complete` `{output_chars, tool_calls, latency_ms, usage}` | info | BrainAgent |
| `brain.runtime.error` `{error, latency_ms}` | error | BrainAgent |
| `brain.tool.invoke` `{tool, args_shape}` | info | tool wrapper |
| `brain.tool.policy_denied` `{tool, reason}` | warn | tool wrapper |
| `brain.tool.complete` `{tool, ok, latency_ms}` | info | tool wrapper |
| `brain.tool.error` `{tool, error, latency_ms}` | error | tool wrapper |
| `brain.skill.media.search` `{query, media_class, result_count, latency_ms}` | info | MediaSkill |
| `brain.skill.media.no_match` `{query, sources_tried}` | warn | MediaSkill |
| `brain.skill.media.play` `{content_id, media_player, ok}` | info | MediaSkill |
| `brain.skill.ha.resolve` `{friendly_name, resolved, candidates}` | debug | HomeAutomationSkill |
| `brain.skill.ha.resolve_failed` `{friendly_name, candidates}` | warn | HomeAutomationSkill |
| `brain.skill.ha.action` `{tool, entity_id, ok}` | info | HomeAutomationSkill |
| `brain.skill.memory.note_added` `{chars}` | info | MemorySkill |
| `brain.stream.start` `{}` | info | translator |
| `brain.stream.chunk` `{chunks_sent}` | debug (sampled, max 20/min) | translator |
| `brain.stream.complete` `{total_chunks, latency_ms}` | info | translator |
| `brain.stream.error` `{where, error}` | error | translator |
| `brain.stream.client_disconnect` `{chunks_sent}` | info | translator |
| `brain.shape.applied` `{before_chars, after_chars}` | debug (only if changed) | BrainAgent |
| `brain.memory.write` `{scope, bytes}` | debug | BrainAgent |
| `brain.response.sent` `{status, total_latency_ms, stream}` | info | router |
| `brain.satellite.config_reload` `{count}` | info | YamlSatelliteRegistry |

`MastraAdapter` already emits `agent.execute.*` and `tool.execute.*` lines; we add `agent.stream.*` for the new streaming method. Those stay at the adapter layer — brain logs sit one level up.

### 9.3 Redaction rules (non-negotiable)

- Bearer tokens: only `token_prefix` (first 6 chars) ever appears in logs.
- Message contents: `debug` only, **and** only when `BRAIN_DEBUG_TRANSCRIPTS=1`. Default off.
- Tool argument values: never at `info`. Use `summarizeArgs(args) → {arg_name: type}` — emits shape, not user PII.
- Memory contents: log size in bytes, not body.
- Errors: always go through `serializeError()` from `0_system/logging/utils.mjs`.

### 9.4 Performance hygiene

- Per-stream `chunk` events use `logger.sampled(event, data, { maxPerMinute: 20 })`.
- Tool-call latencies always logged (low volume, high triage value).
- Search result counts always logged (helps debug `no_match` cases).

### 9.5 Triage paths this enables

- **"Kitchen puck didn't play music"** → grep `satellite_id=kitchen` for `brain.skill.media.*` → see search query, result count, `play` outcome.
- **"Latency is bad"** → `brain.runtime.complete.latency_ms` distribution.
- **"HA control flaky"** → `brain.skill.ha.resolve_failed` warnings surface friendly-name confusion early.
- **"Streaming dropped"** → `brain.stream.client_disconnect` vs `brain.stream.complete` ratio.

---

## 10. Testing strategy

### 10.1 Unit

Pure-domain tests for `Satellite` (validation, `canUseSkill`, `mediaPlayerFor`) and `BrainDecision`. No mocks — these are domain methods over plain data.

### 10.2 Application (in-process integration with fakes)

This is where most of the value is. Drive `BrainApplication.runChat()` through real `BrainAgent` + real `SkillRegistry` + real `PassThroughBrainPolicy`, with these fakes:
- `FakeAgentRuntime` — returns scripted Mastra-shaped outputs (text deltas, tool calls).
- `FakeHomeAutomationGateway` — built atop `createNoOpGateway()` + spies.
- `FakeContentQuery` — returns scripted search results.
- `InMemorySatelliteRegistry`, `InMemoryBrainMemory`.

Scenarios:
- "Turn on office light" → `FakeAgentRuntime` emits `tool_call('ha_toggle_entity', {name:'office light'})` → tool wrapper resolves to `light.office_main` → gateway recorded → final text.
- "Play workout playlist" → `FakeContentQuery.search` returns one match → tool wrapper builds DS playback URL → `gateway.callService('media_player','play_media',...)` recorded → confirmation text.
- "Forbidden skill" → satellite has `allowedSkills:['media']`, model tries `ha_toggle_entity` → tool isn't in catalog → model never sees it.
- "Policy denial" → swap `PassThroughBrainPolicy` for a `DenyAll` test double → response is friendly refusal, no Mastra call.
- "Tool failure" → `FakeHomeAutomationGateway.callService` rejects → `{ok:false}` reaches model → model emits "I couldn't reach the lights" → request still returns 200.
- "Streaming happy path" → `FakeAgentRuntime.streamExecute` yields chunks → translator emits SSE → assertion on chunk sequence and `[DONE]` terminator.
- "Streaming with tool" → tool resolves silently mid-stream, only text chunks reach the client.
- "Unknown token" → 401 with envelope.

### 10.3 Wire-format conformance

A small set of HTTP-level tests against `routers/brain.mjs` that assert OpenAI envelope shape on success, on every documented error code, and on streaming. Guards against accidental breaks in HA compatibility.

### 10.4 Out of scope for v1 tests

- No live Mastra calls in CI (cost + flake).
- No live HA gateway in CI.

Both are exercised by manual smoke tests on `kckern-server` per `CLAUDE.local.md` deploy flow.

---

## 11. Deployment notes

### 11.1 Macvlan_net compose change

The puck on `macvlan_net` (10.0.0.0/25) cannot reach DS on `kckern-net`. Add a fixed-IP macvlan attachment to DS:

```yaml
# Docker/DaylightStation/docker-compose.yml (or equivalent)
services:
  daylightstation:
    networks:
      kckern-net:
      macvlan_net:
        ipv4_address: 10.0.0.5
networks:
  kckern-net:
    external: true
  macvlan_net:
    external: true
```

The implementation plan must verify this via the `claude` user's read-only docker access before declaring v1 deployable.

### 11.2 Tokens

Per-satellite tokens stored in Infisical at `/home`:
- `DAYLIGHT_BRAIN_TOKEN_LIVINGROOM`
- (future) `DAYLIGHT_BRAIN_TOKEN_KITCHEN`, etc.

Resolved at container startup via `ConfigService.getSecret()`. `data/household/config/brain.yml` references them by name (`token_ref: ENV:DAYLIGHT_BRAIN_TOKEN_LIVINGROOM`).

### 11.3 HA integration

In HA: Settings → Devices & Services → OpenAI Conversation → API key = the satellite's token, Base URL = `http://daylight-station:3111/v1`. Voice PE pipeline's `conversation_engine` is set to the new entity (via WebSocket, not UI).

### 11.4 Network reachability

- HA → DS: `http://daylight-station:3111/v1/...` (`kckern-net` Docker DNS).
- Puck → DS: `http://10.0.0.5:3111/media/...` (`macvlan_net`, fixed IP).

Do **not** route HA→DS through Cloudflare. Adds 100–300ms per voice command and a public failure path.

---

## 12. Open questions (to revisit post-v1)

- **Per-conversation memory.** v1 is household-only. If a satellite's owner says "remember I prefer the office light at 30%," that becomes household-scoped — fine for the single-satellite case, possibly noisy at scale.
- **Transcript persistence.** Currently no — every conversation evaporates after the response. Useful for prompt tuning. Add when the system-prompt iteration cycle starts to feel slow.
- **Mid-stream policy.** `shapeResponse` is non-stream-only in v1. If we ever ship a real shaping rule (e.g. brand-name strip), streaming will need a transform middleware.
- **Satellite registry hot-reload.** `YamlSatelliteRegistry` reads on startup. Adding a new satellite currently requires a container restart. Acceptable for v1; revisit if multi-satellite churn becomes routine.
- **Cost telemetry.** `brain.runtime.complete.usage` captures token counts; we don't roll those up. Add a cost dashboard if/when usage justifies.

---

## 13. References

- Existing Mastra integration: `backend/src/1_adapters/agents/MastraAdapter.mjs`
- Existing agent application pattern: `backend/src/3_applications/agents/AgentOrchestrator.mjs`, `BaseAgent.mjs`, `EchoAgent.mjs`, `HealthCoachAgent.mjs`
- Home automation port: `backend/src/3_applications/home-automation/ports/IHomeAutomationGateway.mjs`
- Home automation use cases: `backend/src/3_applications/home-automation/HomeAutomationContainer.mjs`
- Content stack: `docs/reference/content/`, `backend/src/3_applications/content/ContentQueryService.mjs`
- Logging: `backend/src/0_system/logging/`
- Config / secrets: `backend/src/0_system/config/ConfigService.mjs`
- OpenAI Chat Completions API: <https://platform.openai.com/docs/api-reference/chat/create>
- HA OpenAI Conversation integration: <https://github.com/home-assistant/core/tree/dev/homeassistant/components/openai_conversation>
- HA Assist API: <https://developers.home-assistant.io/docs/intent_index/>
