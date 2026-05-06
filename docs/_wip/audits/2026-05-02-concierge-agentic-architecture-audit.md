# Concierge Agentic Architecture Audit

**Date:** 2026-05-02
**Scope:** Current Concierge agent architecture (Mastra-based), latency/scalability concerns, proposed tiered router → role-agent → granular-tool design.
**Context:** The Concierge endpoint serves Home Assistant Voice satellites with an OpenAI-compatible `/v1/chat/completions` API. Currently a single LLM call sees every skill's prompt + every tool. Owner wants a hierarchical/agentic shape: classify intent fast, dispatch to a focused sub-agent, fan out via small tools that lazy-load context.

---

## TL;DR

The current shape is a single-pass agent with **kitchen-sink context** — every request loads BASE_PROMPT + personality + ALL skill prompt fragments + ALL tool schemas + memory snapshot, regardless of intent. With 3 skills and 7 tools today, the system prompt is already ~1.5–2k tokens. With Calendar / Finance / Fitness / Lifelog stubs added (~12 more tools, multiple prompt fragments), this becomes the dominant cost driver and slows tool selection.

The proposed shape is **router → role agent → fan-out tools**: a cheap or zero-cost classifier picks one of `~5` roles, then a focused sub-agent runs with only that role's prompt + tools. Tools shift from "do the whole thing" to "list / inspect / act" so the LLM traverses data on demand instead of receiving it pre-baked.

Mastra has the primitives for this (`Agent`, `createTool`, agent-as-tool, Networks). Migration is incremental — no rewrite required.

> **Update after reading the Mastra docs (see Part 9 below):** Mastra's **supervisor pattern** (the `agents:` field on `new Agent`) and **dynamic agents** (functions for `tools` / `instructions` / `model` resolved per-request via `RuntimeContext`) make this much cleaner than what was originally drafted. AgentNetwork is being deprecated in favor of these primitives. The recommendation in Part 7 has been revised accordingly.

---

## Part 1 — Current Architecture

### Components

| File | Role |
|---|---|
| `4_api/v1/routers/concierge.mjs` | HTTP router; bearer-token auth; satellite resolution; transcript file write |
| `3_applications/concierge/ConciergeApplication.mjs` | Top-level composition wrapping ConciergeAgent |
| `3_applications/concierge/ConciergeAgent.mjs` | Builds context (prompt + tools), calls runtime |
| `3_applications/concierge/services/SkillRegistry.mjs` | Filters skills by satellite; wraps tool execution in policy + transcript layers |
| `3_applications/concierge/skills/*` | Skill objects, each exposing `getPromptFragment()` + `getTools()` |
| `1_adapters/agents/MastraAdapter.mjs` | The ONLY file that imports Mastra; translates JSON-schema tools → Zod, exposes `execute()` and `streamExecute()` |

### Per-request flow (today)

1. HTTP request → router authenticates and resolves satellite
2. `ConciergeAgent.runChat()` → `#buildContext(satellite)`
3. Inside `#buildContext`:
   - Memory snapshot loaded from disk (notes_recent + preferences)
   - `SkillRegistry.buildToolsFor(satellite)` walks ALL allowed skills, calls `getTools()` on each, wraps every tool with policy + transcript handlers
   - Prompt is assembled by concatenating: `BASE_PROMPT` → `personalityPrompt` → `satellitePrompt` → ALL `skill.getPromptFragment()` → `vocabularyPrompt` → `memoryPrompt`
4. `MastraAdapter.execute({ tools, systemPrompt, input })`:
   - Constructs a fresh `new Agent({ instructions, model, tools })` per call
   - Calls `mastraAgent.generate(input)` and returns `{ output, toolCalls }`

### What ends up in the LLM context

For an "office" satellite request today:

```
BASE_PROMPT                                          ~150 tokens
[no personality configured]                          0
satellitePrompt(office)                              ~30 tokens
MemorySkill.getPromptFragment()                      ~80 tokens
HomeAutomationSkill.getPromptFragment()              ~120 tokens
MediaSkill.getPromptFragment()                       ~80 tokens
[no vocabulary configured]                           0
memoryPrompt(snapshot)                               ~200 tokens (capped at 1024 chars)
─────────────────────────────────────────────
System prompt total                                  ~660 tokens

Tool schemas (7 tools, JSON-schema) injected by Mastra:
  memory_read, memory_write,
  ha_toggle_entity, ha_activate_scene, ha_run_script, ha_get_state,
  play_media
                                                     ~600-900 tokens
─────────────────────────────────────────────
Tokens before user input                             ~1,300-1,600
```

This is fine at this scale. The trajectory is the problem.

---

## Part 2 — What's Working

These are good and should be preserved through any refactor:

- **DDD layering is clean.** Skills live in `3_applications`, the Mastra adapter in `1_adapters`, domain primitives in `2_domains`. Skills don't import Mastra. The runtime port (`IAgentRuntime`) is the only seam.
- **Skill self-description.** Each skill owns its prompt fragment, tool list, default policy, and scope inference. Adding a skill is a single-file change in `skills/` plus a `bootstrap.mjs` registration line.
- **Per-satellite filtering already exists.** `SkillRegistry.getSkillsFor(satellite)` strips skills the satellite is denied. The kitchen-sink problem is at the granularity of "all allowed skills," not "all skills in the world."
- **Policy layering.** `BrainPolicyEvaluator` gates every tool call before execution, and `MediaPolicyGate` further filters resolved items per satellite. Decisions are recorded in the transcript. This works on top of any architecture.
- **AliasMap primitive.** Operator-facing semantic bridge is a single shared value object used three different ways (vocab in prompt, name_aliases at search time, friendly_name_aliases at HA resolve time). The pattern survives reorganization.

---

## Part 3 — Problems with the Current Design

### P1. Context grows linearly with skill count

Every request pays for every skill, even when the user said "what time is it." Adding Calendar + Finance + Fitness + Lifelog (the stubs already in the tree) roughly doubles the system prompt and adds ~12 tool schemas. At 5–10 skills this becomes the dominant input-token cost, with no offsetting benefit because most requests touch only one skill.

### P2. Tool selection degrades with tool count

Well-documented LLM behavior: a model with 15 tools picks the right one less reliably than the same model with 4. Symptoms include: calling the wrong tool, calling tools redundantly, refusing to call any tool when the right answer requires one. Today's 7-tool surface is below this threshold; tomorrow's 20-tool surface won't be.

### P3. Single-pass reasoning, single model

One LLM call has to (a) understand intent, (b) pick tools, (c) compose a spoken reply. Even with `gpt-4o`, this is ~800–1500ms when no tools are called and 1500–3500ms when tools are called. There is no way to use a cheaper model for "is this a media request or an HA request" because that decision is folded into the same call.

### P4. The HA tool surface is too coarse

`ha_toggle_entity` takes a `friendly_name` and resolves it via the in-process `_friendlyName.mjs` fuzzy resolver. The LLM has no way to discover what entities exist, what areas are valid, or what state things are in before acting. It guesses ("turn on the kitchen lights") and the resolver guesses back. There's no list-then-act pattern. A smarter tool surface would look like:

- `ha_list_areas()` → `["office", "kitchen", "living_room", "garage", ...]`
- `ha_list_devices(area, domain?)` → `[{entity_id, friendly_name, state}]`
- `ha_get_state(entity_id)` → minimal payload
- `ha_call_service(domain, service, entity_id, data?)` → action

The LLM would call `list_areas()` once (cached), then `list_devices('office', 'light')` to find the right entity, then act. That's two extra small tool calls but eliminates a whole class of resolution errors. **This is what the owner means by "tree traversal instead of context dump."**

### P5. Memory is loaded for every request

`#snapshotMemory()` reads notes + preferences from disk on every call. This is fine performance-wise (small YAML, OS page cache) but it consumes prompt tokens whether the user asked something memory-relevant or not.

### P6. No deterministic fast-path

A request like "play workout playlist" goes through the full LLM pipeline even though "play X" is a strong signal that should hand off straight to MediaSkill without any LLM intent classification at all. The system has no concept of "I'm 99% sure this is media — skip routing reasoning."

---

## Part 4 — Mastra Capabilities Review

What `MastraAdapter` uses today:

- `new Agent({ name, instructions, model, tools })` constructed per call
- `agent.generate(input)` (sync) / `agent.stream(input)` (streaming)
- `createTool({ id, description, inputSchema (zod), execute })`
- Tool execution is single-loop — Mastra handles the LLM ↔ tool round-trips internally up to its own internal limits (we cap with `maxToolCalls`)

What Mastra also offers (NOT used today, but available):

- **Agent-as-tool.** An `Agent` instance can be exposed as a tool to another `Agent` via `createTool({ execute: (args) => subAgent.generate(args.input) })`. This is the primitive for building hierarchical agents.
- **Network** (`@mastra/core/network`). A network of agents with an LLM-driven router that picks which agent should handle a turn. Mastra owns the routing decision.
- **Workflow** (`@mastra/core/workflows`). A deterministic step graph (DAG) where steps can call agents, tools, or other workflows. We own the routing decision.
- **Memory** (`@mastra/memory`). Semantic working memory with TTL — currently we have our own YAML-backed memory adapter; Mastra's would let us off-load the recall-relevant-context decision to the framework.

Relevant for our problem: **agent-as-tool** is the right primitive for tiered dispatch, and **Workflow** is the right primitive when we want deterministic routing (keyword pre-route → specific agent). Network is overkill — it adds an LLM call we don't need if we can route deterministically.

---

## Part 5 — Proposed Architecture

### Three tiers

```
┌─────────────────────────────────────────────────────────────┐
│ TIER 1 — Router                                             │
│   Input: user_text, satellite                               │
│   Output: { role, confidence, slots? }                      │
│   Implementation: keyword-first, LLM fallback (cheap model) │
│   Latency budget: 0–250ms                                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ TIER 2 — Role agents (one per role)                         │
│   Each is a Mastra Agent with:                              │
│     - role-specific system prompt (no kitchen sink)         │
│     - role-relevant tools only                              │
│     - role-appropriate model (DJ may use cheaper)           │
│   Latency budget: 600–1500ms                                │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ TIER 3 — Tools (fine-grained, list-then-act)                │
│   - list_X / get_X / call_Y                                 │
│   - Each tool returns a small payload                       │
│   - Aliases applied INSIDE the relevant tool                │
│   Latency budget: 50–500ms per tool call                    │
└─────────────────────────────────────────────────────────────┘
```

### Tier 1 — Router

Implementation order of preference:

**Sub-tier 1a — keyword pre-route (free, ~1ms).**
A small ruleset matches obvious patterns:
```
/^play /                         → dj           (slots: { query: rest })
/^turn (on|off) /                → home_operator (slots: { action, target: rest })
/^(toggle|switch) /              → home_operator
/^what'?s? on (my|the) calendar/ → calendar
/^how (much|many) /              → helpdesk     (likely info query)
```
Plus a router-level AliasMap pass over the input — household vocabulary is applied here so "FHE" becomes "Family Home Evening" *before* classification, which helps both the keyword rules and the LLM fallback.

If a rule matches AND has high confidence, dispatch immediately. Skip Tier 1b entirely. This is the path most everyday voice commands will take. Latency contribution: ~1ms.

**Sub-tier 1b — LLM classifier fallback (~150–300ms).**
For ambiguous requests, dispatch a tiny call to a cheap model (`claude-haiku-4-5` or `gpt-4o-mini`) with a strict JSON-schema response: `{ role, confidence, reasoning }`. The classifier sees only the user input, the role catalog, and the household vocabulary. No tools. Returns within 200ms typical.

If confidence < threshold (e.g. 0.5), fall back to the **Wildcard role** (general assistant with the broadest tool surface — basically today's behavior).

### Tier 2 — Role agents

The four roles the owner has called out, plus a fallback:

| Role | Purpose | Skills it owns | Suggested model |
|---|---|---|---|
| `dj` | Music, podcasts, ambient, playlists | media, memory(read prefs) | `gpt-4o-mini` (judge already runs here) |
| `home_operator` | Lights, scenes, scripts, device state | home_automation | `gpt-4o-mini` or `gpt-4o` |
| `helpdesk` | Calendar, finance(read), fitness(read), lifelog(read), weather, household facts | calendar, finance(read), fitness(read), lifelog(read), memory(read) | `gpt-4o` (reasoning over data) |
| `lifelog` | Journaling, gratitude, daily entries — any data-write role | lifelog(write), journaling, gratitude | `gpt-4o` |
| `wildcard` | Catch-all when classifier is uncertain | ALL allowed-by-satellite skills | `gpt-4o` |

Each role agent has its own focused system prompt (~400 tokens), exposes only its skills' tools (3–6 tools), and gets the satellite + vocabulary context. **It does NOT see the kitchen sink.**

### Tier 3 — Tools that fan out

Refactor over time, starting with HA. New tool shape:

```
ha_list_areas()                     → ["office","kitchen",...]
ha_list_devices(area, domain?)      → [{entity_id, friendly_name, state, ...}]
ha_get_state(entity_id)             → {state, attributes}
ha_call_service(domain, service, entity_id, data?) → {ok, error?}
```

Plus the existing high-level wrappers (`ha_toggle_entity` with friendly name) kept for fast paths where the LLM is confident. This is dual-API by design: deterministic dispatch when keyword pre-route resolved a friendly_name → entity_id, granular discovery when the LLM needs to figure out what's available.

The same shift applies to media (`media_list_libraries`, `media_search_in_library`, `media_play`), but media's existing single-tool design is acceptable today because the search use case is well-bounded.

### Where AliasMap lives in this architecture

| Tier | Alias source | Applied to | Why |
|---|---|---|---|
| Tier 1 (Router) | `concierge.yml.vocabulary` | User input BEFORE classification | "FHE" → "Family Home Evening" so the router routes correctly |
| Tier 2 (Role agent prompt) | `concierge.yml.vocabulary` | Rendered into role-agent system prompt | LLM understands user's words natively |
| Tier 3 (Media tool) | `media.name_aliases` | Search query before backend hit | "iruma" → "IU" before Plex search |
| Tier 3 (HA tool) | `home_automation.friendly_name_aliases` | Friendly-name resolution before fuzzy lookup | "big room" → "living room" entity |

The AliasMap primitive is reused at every tier without modification. The ONLY change is **Tier 1 alias substitution on raw input** — that's new. Today aliases are downstream-only (the LLM has to use the canonical term in its tool args), but at Tier 1 we can normalize input *before* classification, which significantly improves keyword-route hit rate.

---

## Part 6 — Latency Analysis

### Today (single-pass, `gpt-4o`)

| Scenario | LLM calls | Tool calls | Wall time |
|---|---|---|---|
| "What time is it" (no tool) | 1 | 0 | ~800–1200ms |
| "Turn on the office light" | 1 | 1 (ha_toggle) | ~1200–1800ms |
| "Play workout playlist" | 1 | 1 (play_media → judge subagent) | ~2000–3500ms |

### Proposed (router + role agent)

| Scenario | LLM calls | Tool calls | Wall time |
|---|---|---|---|
| "What time is it" (helpdesk role, keyword route) | 1 (helpdesk) | 0 | ~600–1000ms |
| "Turn on the office light" (home_operator, keyword route, single LLM call w/ small tool surface) | 1 | 1 | ~900–1400ms |
| "Play workout playlist" (dj, keyword route, gpt-4o-mini for the role) | 1 (mini) | 1 | ~1400–2200ms |
| "Should I turn on the heater" (LLM classifier needed) | 2 (haiku → 4o) | 1 | ~1500–2200ms |

The wins are concentrated in **common voice commands** that match keyword patterns. The cost is added complexity and an extra LLM hop in the ambiguous cases. The break-even is around 5+ skills; below that, the current single-pass design is hard to beat on latency for ambiguous inputs.

---

## Part 7 — Recommendation

**Adopt the tiered architecture in five phases.** Each phase is independently shippable and reverts cleanly if it doesn't pay off.

### Phase 1 — Add a `RoleClassifier` service (no behavior change)

- New `services/RoleClassifier.mjs` with `classify({ input, satellite, vocabulary })` returning `{ role, confidence, source: 'keyword'|'llm'|'fallback' }`.
- Wire it into `ConciergeAgent.runChat` to LOG the classification but NOT to act on it. Adds zero latency (keyword route is ~1ms; we don't run the LLM fallback yet).
- Yields data: how often does the keyword router hit, what roles are most common, what's the distribution of confidence scores. Decide thresholds empirically before Phase 3.

### Phase 2 — Define `Role` abstraction; group skills by role

- Add `2_domains/concierge/Role.mjs` and `3_applications/concierge/RoleRegistry.mjs`.
- Each Role declares: name, member skills, system prompt fragment, model preference.
- No dispatch change yet — `ConciergeAgent` still loads everything. This is just data modeling.

### Phase 3 — Real dispatch (the lever-pulling phase)

- `ConciergeAgent.runChat` calls `RoleClassifier.classify()`, then dispatches to a role-specific Mastra `Agent` constructed from only that role's tools and prompt.
- Wildcard role is the safety net: when classifier confidence < threshold, fall through to today's behavior (full surface).
- Streaming path (`streamChat`) follows the same pattern but yields chunks from the role agent's stream.

### Phase 4 — Granular HA tools (list/get/call)

- Add new HA tools to `HomeAutomationSkill`. Keep the existing high-level tools as fast-path shortcuts.
- The home_operator role gets BOTH surfaces — granular for discovery, high-level for confident actions.

### Phase 5 — Memory becomes role-conditional

- Stop loading the full memory snapshot for every request.
- Lifelog and Wildcard roles get full memory; HelpDesk gets prefs only; DJ and HomeOperator get nothing by default.
- Memory becomes a tool the LLM CAN call (`memory_recall(topic)`) rather than always-on context.

---

## Part 8 — Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Keyword router brittleness | LLM fallback for low-confidence cases; log misclassifications; iterate rules from real data |
| Multi-intent requests ("turn off lights AND play music") | Phase 3 router emits `roles[]` not `role`; each role runs sequentially or in parallel, results merged into single TTS reply (this is the hardest case — defer until single-intent works well) |
| Streaming through sub-agents | Mastra's stream API forwards through; one extra hop in the streaming pipe but not architecturally problematic |
| Role catalog drift | Roles defined in `concierge.yml.roles` (config), not hardcoded — same pattern as policy/media config |
| Cost of LLM classifier | Sub-tier 1b uses haiku/mini — typically <$0.001/call. If keyword route hits 70%+ of voice commands, classifier is rare |

### Open questions for the owner

1. **Memory role-conditional vs always-on?** Today notes are loaded for every request. Recommendation is to load only for roles that need them (Lifelog/Wildcard). Confirm or push back.
2. **Multi-intent requests — tolerate or refuse?** A simple "the model can use multiple tools in one role" handles most cases, but "do X then play Y" might span roles. Recommendation: defer until v2; refuse multi-role requests in v1 with "I can do one thing at a time."
3. **Classifier model.** `claude-haiku-4-5` vs `gpt-4o-mini`. Haiku is faster and cheaper; mini integrates with the existing OpenAI client. Recommend haiku once we add the Anthropic SDK.
4. **Wildcard as catch-all vs explicit fallback?** Today every request implicitly wildcards. Phase 3 makes wildcard explicit (a real role with a real prompt). Should we keep it broad or narrow it?
5. **Mastra Network vs hand-rolled router?** Mastra Network would do Tier 1 + dispatch in a single Mastra call. Less code, but we lose the keyword fast path. Recommendation: hand-rolled router with Mastra `Agent` per role — keeps the keyword fast path and the deterministic boundary.

---

## Appendix — Concrete Tool/Skill → Role Mapping

```yaml
# Future: concierge.yml.roles (illustrative)
roles:
  dj:
    description: "Plays music, podcasts, ambient sounds"
    skills: [media]
    model: openai/gpt-4o-mini
    system_prompt: |
      You handle music and audio playback for the household.
      Search the library for what the user asks; pick the best match;
      play it on the calling satellite. Decline non-audio requests.

  home_operator:
    description: "Controls lights, switches, scenes, scripts"
    skills: [home_automation]
    model: openai/gpt-4o-mini
    system_prompt: |
      You control household devices via Home Assistant.
      For unfamiliar device names, use ha_list_devices to discover
      what's available before acting. Do not invent entity IDs.

  helpdesk:
    description: "Answers questions about calendar, schedules, household data"
    skills: [calendar_read, fitness_read, lifelog_read, memory_read, weather]
    model: openai/gpt-4o
    system_prompt: |
      You answer factual questions about the user's day, schedule,
      and household state. Use the read-only tools to gather data.
      Be brief; if you don't have the answer, say so.

  lifelog:
    description: "Records journal entries, gratitude, daily notes"
    skills: [lifelog_write, journaling, gratitude, memory_write]
    model: openai/gpt-4o
    system_prompt: |
      You help the user capture daily entries — journal notes,
      gratitude, what they ate, etc. Keep your responses short;
      confirm what you wrote.

  wildcard:
    description: "General assistant — used when intent is unclear"
    skills: [memory, home_automation, media, calendar_read]
    model: openai/gpt-4o
    system_prompt: |
      You are the household assistant. Handle whatever the user
      asks using the tools you have.
```

---

## Part 9 — Mastra Best Practices Update

After reading the Mastra docs, several recommendations in Parts 5–7 should be REVISED. The hand-rolled router + role-agent dispatch pattern I described is essentially what Mastra provides as first-class primitives. We were about to reinvent the wheel.

### 9.1 — Mastra's recommended multi-agent patterns (concepts)

Mastra documents five patterns in `guides/concepts/multi-agent-systems`. Mapped to our problem:

| Pattern | When | Our fit |
|---|---|---|
| **Single agent** | Default. Add complexity only when it improves quality, speed, or reliability. | Today's shape. |
| **Supervisor** | One lead agent maintains control, delegates to specialists. Best when full sequence isn't known in advance. | Strong fit — the concierge IS a supervisor. |
| **Handoff** | Control transfers between specialists (ownership moves). | Probably not — voice requests are short-lived; we don't need ownership transfer. |
| **Workflows** | Deterministic step graph. When path IS known. | Not a fit for the top-level dispatch (intent is variable). |
| **Council** | Multiple agents solve same problem, results synthesized. High quality, slow. | Not a fit — too slow for voice latency budget. |

**Mastra's stated principle: start with single agent; add structure only when it clearly improves quality/speed/reliability.** Today's single-agent shape is fine *now*; the trigger to move is when skill count grows past ~5–7.

### 9.2 — Supervisor pattern is FIRST-CLASS in Mastra

The `Agent` constructor takes an `agents:` field. Subagents passed there are auto-converted to tools named `agent-<key>` and exposed to the supervisor LLM:

```typescript
const dj = new Agent({
  id: 'dj',
  name: 'DJ',
  description: 'Plays music, podcasts, and ambient audio on the satellite.',
  instructions: 'You handle audio playback. Use play_media...',
  model: 'openai/gpt-4o-mini',
  tools: { play_media },
})

const homeOperator = new Agent({
  id: 'home_operator',
  name: 'Home Operator',
  description: 'Controls lights, switches, scenes via Home Assistant.',
  instructions: 'You control household devices...',
  model: 'openai/gpt-4o-mini',
  tools: { ha_toggle_entity, ha_list_devices, ha_get_state, ha_call_service },
})

// The supervisor IS the concierge. Its LLM picks which subagent to call.
const concierge = new Agent({
  id: 'concierge',
  name: 'Concierge',
  instructions: `You are the household concierge...
For music or audio playback, delegate to the DJ.
For lights, switches, scenes, scripts, delegate to Home Operator.
...`,
  model: 'openai/gpt-4o',
  agents: { dj, home_operator, helpdesk, lifelog },
  memory: conciergeMemory,  // required for supervisor pattern
})
```

**Implications for the audit:**

1. **No need to write a separate `RoleClassifier` service.** The supervisor LLM does classification by selecting which `agent-*` tool to call. Each subagent's `description` is the routing signal — write them carefully.
2. **One LLM call decides + delegates.** The supervisor doesn't pre-classify then re-call; its single `generate()` invokes the right subagent as a tool. Latency is supervisor turn-1 (fast, no tool execution) → subagent turn-1 (the actual work).
3. **Memory isolation is built in.** Each subagent gets a unique thread but inherits the supervisor's resource ID (`{parentResource}-{agentName}`). Subagents see the supervisor's full conversation but only their own delegation/response gets persisted to their memory.
4. **Streaming bubbles up.** The supervisor's stream forwards subagent events (`text-delta`, `tool-call`, `tool-result`, etc.) automatically. Use `streamUntilIdle()` for long-running delegations (e.g. when the DJ's `play_media` involves the judge subagent).

**This collapses the original "Tier 1 router + Tier 2 role agent" design into a single Mastra primitive.** The keyword fast-path (Sub-tier 1a in the original Part 5) is still useful as an optimization to skip the supervisor LLM call entirely for high-confidence patterns, but it's now an OPTIMIZATION, not the core architecture.

### 9.3 — Dynamic Agents: an alternative shape

Mastra's `Agent` constructor accepts FUNCTIONS for `tools`, `instructions`, `model`, `memory`, `defaultOptions`, `inputProcessors`, `outputProcessors`. Each function receives `{ requestContext: RuntimeContext }` and returns the resolved value:

```typescript
const concierge = new Agent({
  id: 'concierge',
  name: 'Concierge',

  instructions: ({ requestContext }) => {
    const role = requestContext.get('role') ?? 'wildcard';
    return ROLE_PROMPTS[role];
  },

  tools: ({ requestContext }) => {
    const role = requestContext.get('role') ?? 'wildcard';
    return ROLE_TOOLS[role];
  },

  model: ({ requestContext }) => {
    const role = requestContext.get('role') ?? 'wildcard';
    return ROLE_MODELS[role];
  },
})
```

Then a deterministic pre-route (keyword + AliasMap) sets `runtimeContext.set('role', 'dj')` BEFORE calling the agent. The agent resolves its tools/instructions/model from that role and runs as a single focused agent — no supervisor LLM hop.

**Tradeoff vs supervisor:**

| | Supervisor pattern | Dynamic agent + pre-route |
|---|---|---|
| LLM calls (high-confidence path) | 1 supervisor + 1 subagent = 2 | 1 (the dynamic agent runs as the role) |
| LLM calls (ambiguous path) | 1 supervisor + 1 subagent = 2 | 1 (after fallback to wildcard role) |
| Routing reliability | LLM-driven, handles ambiguity gracefully | Brittle if pre-route misses |
| Latency overhead | ~200–400ms supervisor reasoning | ~1ms keyword pre-route |
| Code complexity | Low (Mastra owns routing) | Medium (we own pre-route + role config) |
| Multi-intent ("turn off lights AND play music") | Supervisor calls multiple subagents in sequence | Single role can't handle — fallback to wildcard |

**Recommendation: combine them.** Pre-route + dynamic agent for the common case; supervisor pattern for the ambiguous-or-multi-intent fallback. See revised Part 7 below.

### 9.4 — RuntimeContext is the right shape for satellite/role/conversation

We currently jam `satellite` and `conversationId` into the `context` object passed to `agentRuntime.execute()`. Mastra has a typed `RuntimeContext` for exactly this:

```typescript
import { RuntimeContext } from '@mastra/core/runtime-context';

const ctx = new RuntimeContext();
ctx.set('satellite_id', satellite.id);
ctx.set('satellite_area', satellite.area);
ctx.set('role', classifiedRole);
ctx.set('conversation_id', conversationId);

await concierge.generate(input, { runtimeContext: ctx });
```

The context flows into every tool's `execute` (second arg) and every dynamic resolver (`{ requestContext }`). Cleaner than ad-hoc context bags. Type-safe via `requestContextSchema`.

**Action:** when we refactor `MastraAdapter.execute()`, pass our `context` through as a `RuntimeContext`, not an opaque object. Tools that need satellite info (e.g. MediaSkill's `play_media` already pulls `ctx.satellite`) keep working but with a typed surface.

### 9.5 — Mastra Memory could replace YamlConciergeMemoryAdapter

Today our `YamlConciergeMemoryAdapter` reads/writes notes + preferences from a YAML file under the working memory tree. It's coupled to a `dataService` and serializes by hand.

Mastra's `Memory` provides:
- **Working memory** — persistent structured user facts (similar to our prefs)
- **Semantic recall** — vector-based retrieval of relevant past messages (we don't have this)
- **Observational memory** — background compression of old messages (we don't have this)
- **Thread / Resource scoping** — built-in, with deterministic resource IDs for subagents
- **Storage adapters** — libsql (default), postgres, redis, others

If we adopt the supervisor pattern, the subagent → memory thread story matters. Mastra handles it for us; rolling it ourselves means writing scoped-thread logic inside `YamlConciergeMemoryAdapter`.

**Action: defer this.** Memory rewrite is its own project. The current YAML adapter works and is testable; revisit when multi-agent semantic recall becomes a felt need.

### 9.6 — AgentNetwork is deprecated

The Mastra blog confirms: `AgentNetwork` and `.network()` are deprecated in favor of supervisor agents using `agent.stream()` / `agent.generate()` with the `agents:` config field. Don't use `.network()` for new code.

### 9.7 — Streaming events we should handle in `MastraAdapter`

Today our `MastraAdapter.streamExecute()` handles `text-delta`, `tool-call`, `tool-result`, `finish`. Mastra also emits `start`, `step-start`, `step-finish`, plus delta variants for tool input streaming (`tool-input-start`, `tool-input-delta`, `tool-input-end`).

When we adopt the supervisor pattern, subagent invocations bubble up as nested events. Handling `step-start`/`step-finish` lets us trace which subagent is doing what. Useful for the transcript log.

**Action:** extend `MastraAdapter.streamExecute()` to forward `step-start` / `step-finish` events. Low-priority polish; defer until supervisor pattern is in.

---

## Part 7 (REVISED) — Recommendation

The original Part 7 phases assumed we'd hand-roll the router + dispatch. Mastra provides this. Revised plan:

### Phase 1 — Pre-route + dynamic-agent path (cheap, fast, deterministic)

- Add `services/IntentPreRoute.mjs`: keyword + AliasMap pass over input, returns `{ role, confidence, source: 'keyword'|null }`.
- Refactor `ConciergeAgent` to construct a single Mastra Agent whose `tools`, `instructions`, `model` are functions of `runtimeContext.get('role')`.
- Pre-route sets `runtimeContext.role` before calling. If pre-route confidence < threshold OR null, role = `'wildcard'`.
- Define a `Role` config in `concierge.yml.roles`: each role declares skills, system_prompt, model.
- Tests: pre-route classification cases, dynamic agent tool selection by role.
- Ship value: high-confidence voice commands ("play X", "turn on Y") run with a focused tool surface and cheaper model. No LLM overhead added.

### Phase 2 — Supervisor pattern as the wildcard fallback

- For `role === 'wildcard'`, instead of falling back to today's kitchen-sink agent, build a Mastra supervisor that has each Role agent in its `agents:` field.
- The supervisor reasons over the request and delegates to the right Role subagent.
- Memory isolation is automatic (Mastra handles thread/resource scoping for the supervisor → subagent flow).
- Latency contribution: ~200–400ms supervisor turn + the subagent's normal latency.
- Tests: supervisor delegation across multiple role boundaries; multi-intent requests.

### Phase 3 — Granular HA tools (list/get/call)

- Same as the original Phase 4. Add `ha_list_areas`, `ha_list_devices`, `ha_get_state`, `ha_call_service` to `HomeAutomationSkill`. The `home_operator` Role gets both surfaces — high-level for confident actions, granular for discovery.

### Phase 4 — RuntimeContext refactor

- Replace ad-hoc `context: { satellite, conversationId }` with Mastra's `RuntimeContext`.
- Update `MastraAdapter.execute()` and `streamExecute()` signatures.
- Refactor tools that read `ctx.satellite` to read `requestContext.get('satellite')` instead.
- Mostly mechanical; pairs naturally with Phase 1.

### Phase 5 — Deferred

- Mastra Memory adoption (Section 9.5). YAML adapter works fine; revisit only when semantic recall is needed.
- Stream event extension for `step-start` / `step-finish` (Section 9.7). Polish.
- Multi-intent request handling. Defer past v1.

### What we are NOT going to build

- A standalone `RoleClassifier` LLM service (Mastra supervisor handles this when keyword pre-route misses).
- A custom `Network` abstraction (deprecated by Mastra; we get the same thing free via supervisor).
- A council pattern for ambiguous queries (too slow for voice latency budget).

---

## Part 10 — Mastra Primitives Quick Reference (for our codebase)

| Concept | Mastra primitive | Where to use in our code |
|---|---|---|
| The concierge | `new Agent({ name, instructions, model, tools })` | `ConciergeAgent.mjs` — already there |
| A skill role (DJ, HomeOperator, etc.) | `new Agent({ name, description, instructions, tools })` | New `Role` files per role |
| Supervisor delegation | `new Agent({ ..., agents: { dj, home_operator, ... } })` | `ConciergeApplication.mjs` (composition root) |
| Per-request role selection | `instructions` / `tools` / `model` as function of `runtimeContext` | `ConciergeAgent.mjs` |
| Satellite info, role hint | `RuntimeContext` set before `agent.generate()` | `ConciergeApplication.runChat()` |
| A tool the LLM can call | `createTool({ id, description, inputSchema, outputSchema, execute })` | All `*Skill.getTools()` already convert to this in `MastraAdapter` |
| Multi-step deterministic flow | `createWorkflow().then(step).commit()` | None today; could replace `PlayMediaUseCase`'s pipeline |
| Memory across conversations | `new Memory({ options: { lastMessages } })` | Defer; current YAML adapter is sufficient |

---

## Part 11 — Cross-check against Anthropic "Building Effective AI Agents" (2026)

After drafting Parts 1–10, I read Anthropic's "Building Effective AI Agents: Architecture Patterns and Implementation Frameworks" (30-page PDF). It's an architectural decision guide written from Anthropic + customer experience. Below is a structured check of our design against it: where we align, where we should incorporate specific tactical advice, and the framework's three critical questions applied to Concierge.

### 11.1 — Where the design aligns

| PDF principle | Our design |
|---|---|
| **"Start simple, scale intelligently."** Begin with single-purpose agents, evolve as requirements demand. Simple = cheaper, easier to debug, clear metrics. | Today's single-agent shape IS the recommended starting point. We've been explicit that the trigger to migrate is when the skill count grows (P1, P2 in Part 3 of this audit). |
| **"Practice modular design."** Centralized prompt config, tools as discrete reusable modules, agents defined as needed from libraries. | DDD layering, AliasMap primitive, skill self-registration in `SkillRegistry`, prompts in `prompts/system.mjs` and `concierge.yml`. ✓ |
| **"Extend capabilities with Agent Skills."** Skills as modular capability packages (knowledge + workflows + tool integrations) that agents leverage when needed. | Our `skills/*` directory IS this pattern — each skill bundles prompt fragment, tools, scopes, defaults, and orchestration into one self-contained unit. The Anthropic-recommended `Skills` concept is what we already do. ✓ |
| **"Build observable systems that explain themselves."** Visibility into prompt chains, decision paths, retrieval contexts, token consumption, the entire reasoning workflow. | `BrainTranscript` (now `ConciergeTranscript`) records per-tool invocations, args, results, policy decisions, latency. Full request transcripts written to disk per `mediaLogsDir`. ✓ |
| **Hybrid pattern: "Single agents with multi-agent escalation."** Simple agents handle routine; automatically trigger sophisticated multi-agent for edge cases. Explicitly named in the PDF as a recommended hybrid. | This is exactly our Phase 1 (pre-route + dynamic agent) + Phase 2 (supervisor fallback). The PDF endorses this shape verbatim. ✓ |
| **Hierarchical/supervisor systems** with subagents-as-tools. Higher token cost justified for high-value complex tasks. Implementation variations: full orchestration / routing-focused / hybrid coordination. | Our supervisor pattern (Phase 2) uses Mastra's `agents:` → `agent-<key>` tool conversion. This is exactly the PDF's subagent-as-tool pattern. We're choosing **hybrid coordination** (selectively invoke supervisor based on classified confidence). ✓ |
| **e-commerce evolution example.** Phase 1 single agent → Phase 2 routing → Phase 3 specialized agents → Phase 4 multi-agent → Phase 5 evaluator agents. | Our 5-phase migration plan in revised Part 7 mirrors this nearly 1:1. Their Phase 5 (evaluators) is something we already partially have via `MediaJudge` selecting best candidates from search results. ✓ |
| **"Routine queries shouldn't trigger expensive multi-agent workflows. Design your system to scale effort appropriately."** | Our keyword-pre-route fast path is exactly this — high-confidence patterns skip the LLM-classifier hop entirely. ✓ |

### 11.2 — Specific tactical recommendations to incorporate

These are concrete tactics from the PDF that our audit hasn't fully addressed.

#### 11.2.1 Context management for hierarchical systems (the PDF's biggest single piece of advice)

> "Successful implementations need solid context management strategies: **context editing** automatically clears stale tool calls and results when you approach token limits while keeping conversation flow intact, and memory tools let your agents store and retrieve information outside the context window through file-based systems that persist across sessions."

Action items for when Phase 2 (supervisor) lands:

- **Automatic context pruning.** When the supervisor's conversation accumulates many subagent invocations + tool results, the context grows fast. Mastra's Memory module has built-in compression (Observational Memory). When we adopt the supervisor pattern, we should enable this. Our YAML-backed memory adapter doesn't do compression today.
- **Cap response sizes.** PDF suggests "capping responses at manageable sizes (something like 25,000 tokens) to prevent context exhaustion." Voice replies are 1–2 sentences so this isn't a concern for the user-facing output, BUT tool outputs (e.g. a future `ha_list_devices` returning all entities in a 50-device household) could blow this. **Add pagination/limit defaults to all list-style tools** when we build them in Phase 3.
- **File-based memory persistence.** PDF: "Memory tools that persist across sessions through file-based systems." Our `YamlConciergeMemoryAdapter` is already file-based — good — but we don't have semantic recall yet (retrieving relevant past messages by meaning). Defer per Section 9.5; revisit when felt-needed.

#### 11.2.2 Subagent depth (subagents-of-subagents)

PDF: "Subagents can also have their own subagents, with these groups abstracted from the supervisor agent, which only interacts with the subagent team leader."

Our `MediaJudge` is already a subagent of `MediaSkill`'s `play_media` tool. Today it's invoked imperatively inside `PlayMediaUseCase` — not exposed through Mastra's `agents:` field. When we migrate to the supervisor pattern, we have a choice:

1. Keep `MediaJudge` as imperative inside the DJ role agent (hidden from Mastra).
2. Expose it as a subagent of the DJ role agent (the DJ's `agents: { judge }` becomes a tool the DJ can call).

**Recommendation: keep it imperative.** The judge runs on every search and has no decision to make about *whether* to be invoked. Exposing it through Mastra would add overhead with no benefit. Reserve `agents:` for cases where a parent agent legitimately decides whether to delegate.

#### 11.2.3 Token-cost reality check

PDF: "Multi-agent systems use roughly **10–15x more tokens than single agents.** Do the math on your expected volume before committing to complex architectures."

Our scale: ~3 satellites × ~10 voice commands/day = ~30 commands/day. Even at 15× per-command cost (~$0.05 vs ~$0.003), daily cost rises from ~$0.10 to ~$1.50. **At our scale, token cost is not a constraint — latency is.** This justifies our recommendation to use the supervisor pattern only as a wildcard fallback, not as the primary path: we want low latency for the 95% of voice commands that match a keyword pre-route, even though we could afford supervisor for everything.

#### 11.2.4 Tool count threshold for migration

PDF doesn't give a hard number, but the advice is clear: when a single agent's tool surface starts degrading tool selection accuracy, that's the trigger to split into hierarchical. Our current 7 tools is fine; the literature suggests 10–15 is when degradation starts; 20+ is reliably bad.

**Empirical rule for our codebase: when the tool count for the wildcard satellite (the broadest) hits ~12, migrate to Phase 2.** Today: 7. Adding Calendar (3) + Finance read (2) + Fitness read (2) + Lifelog read (2) puts us at 16. So Phase 2 should land roughly when the 4 stub skills come online.

#### 11.2.5 Pattern selection for OUR specific use cases

PDF's pattern selection guide:

| Pattern | Best for | Concierge fit |
|---|---|---|
| **Single agents** | Customer service for well-defined products, doc processing, code review, routine analysis | Today's shape ✓ |
| **Sequential workflows** | Approval pipelines, content (draft→review→publish), data transformation, compliance | None of our voice paths fit |
| **Parallel workflows** | When multiple perspectives improve quality, independent analyses, speed > coordination, risk assessment with diverse viewpoints | Multi-source content search (Plex + future Immich + future ABS) — fan out search across sources, merge results. Currently we serialize. Worth considering for ContentQueryService. |
| **Multi-agent (hierarchical)** | Complex problem-solving with diverse expertise, research, dynamic interactions spanning multiple systems, strategic planning | Phase 2 fallback for ambiguous voice requests ✓ |
| **Evaluator-optimizer** | Content creation needing nuance — translation, code, professional comms, research with validation | `MediaJudge` already implements this for search disambiguation ✓ |
| **Network/peer-to-peer** | Low control, exploratory, swarm dynamics. PDF notes "early benchmarking shows swarm slightly outperforms supervisor." | Not for voice — too unstructured for our latency budget |

The **parallel-workflow** point is new and interesting: our `ContentQueryService` could fan out searches across Plex / Immich / ABS in parallel rather than sequentially. Today only Plex is wired, so it's moot — but worth flagging as an architectural pattern for when multi-source search lands.

### 11.3 — The Decision Framework applied to Concierge

The PDF's "three critical questions" (plus a fourth on domain expertise). Working through them for our specific use case:

#### Q1 — What level of control do you need?

**Answer: Moderate.** Voice commands can affect the household (lights, audio, heating), but they're not regulatory or safety-critical (we have no medical, financial-write, or security-decision tools — those are explicitly denied in `policy.scopes_denied`). The user is in the room and gets immediate audible confirmation. Mistakes are recoverable.

**PDF prescription for moderate control: hierarchical multi-agent systems.** ✓ Matches our Phase 2 recommendation.

#### Q2 — How complex is your problem domain?

**Answer: Multi-domain but mostly predictable, with occasional open-ended requests.** Most voice commands fall into ONE clear category: play X (DJ), turn on Y (HomeOperator), what time Z (HelpDesk). Rare cases ("plan dinner for tonight") are open-ended.

**PDF prescription:**
- Multi-domain but predictable → sequential or parallel workflows
- Complex open-ended → multi-agent

Our hybrid (pre-route + supervisor fallback) handles BOTH: deterministic dispatch for the predictable 95%, supervisor for the open-ended 5%. ✓

#### Q3 — What are your resource constraints?

**Answer: Token budget is irrelevant; latency budget is tight.** A voice puck-to-puck round trip should be under 2 seconds for the response to feel snappy. Multi-agent supervisor pattern adds ~200–400ms; that's fine for ambiguous queries but unacceptable for the common case.

**Implication:** the keyword-pre-route fast path isn't a nice-to-have, it's a load-bearing latency optimization. Our design correctly prioritizes it.

#### Q4 — Do you need deep domain expertise?

**Answer: Multiple distinct domains needing coordination.** Music is one domain (taste, libraries, playlists, voice search), home automation is another (entity discovery, area mapping, scene orchestration), data lookup is a third (calendar, fitness, lifelog), data entry is a fourth (lifelog write, gratitude, journaling).

**PDF prescription: "Multi-agent systems with specialized Skills."** ✓ Each Role agent in our Phase 2 design owns its own Skills package — this is exactly what the PDF prescribes.

### 11.4 — Where we diverge from the PDF (intentionally)

1. **Network/peer-to-peer.** PDF acknowledges swarm "slightly outperforms supervisor across the board" in early benchmarking, but specifically for low-control / exploratory work. For our voice use case (moderate control, latency-sensitive, mostly-predictable), supervisor pattern is the right pick. We acknowledge the tradeoff without adopting peer-to-peer.

2. **Dynamic agent generation.** PDF flags this as experimental ("research projects and frameworks like AutoGen or Semantic Kernel"). Mastra supports this via runtime-context-resolved tools/instructions, and our Phase 1 design uses it. The PDF's note is conservative; Mastra's implementation is production-ready, and our use case (5 well-defined roles) is well within the safe zone.

3. **Evaluator-optimizer for response quality.** PDF's e-commerce Phase 5 introduces evaluators for QA. We have one (MediaJudge for search results) but no end-to-end response-quality evaluator. Defer — premature for our scale.

### 11.5 — Updated migration checkpoints

The PDF's e-commerce 5-phase example gives us better empirical anchors for our migration triggers. Updated:

| Our Phase | Trigger to ship | Trigger that justifies the work |
|---|---|---|
| Phase 1 (pre-route + dynamic agent) | Now-ish — adds value at any scale | Operational simplicity (single Agent with role-driven config) |
| Phase 2 (supervisor fallback) | When wildcard tool count hits ~12 | Tool selection accuracy will start degrading |
| Phase 3 (granular HA tools) | When LLM begins inventing entity_ids in transcripts | Discoverability friction |
| Phase 4 (RuntimeContext refactor) | Pairs with Phase 1 — same PR ideally | Type-safe context vs ad-hoc bag |
| Phase 5 (deferred items) | Felt-need basis | When YAML memory becomes a bottleneck OR when multi-source search lands OR when response-quality regressions emerge |

---

## Part 12 — External agent integration: CLI-first, not MCP

This audit is primarily about how the concierge dispatches voice requests internally. A separate but related question came up: how should EXTERNAL agents (Claude Code, mastracode, ad-hoc shell sessions, future automation) call DS capabilities?

After reading [CLI vs MCP](https://circleci.com/blog/mcp-vs-cli/), the answer is **CLI-first**. CLIs win the inner-loop game on token efficiency (no schema preload), training familiarity (LLMs already know shell), composability (Unix pipes), and debuggability. MCP servers earn their keep on outer-loop coordination — centralized auth, structured CI/CD gates, persistent session state — none of which we have.

Decision: build a `dscli` that exposes skills/services as subcommands. Implementation pattern is **direct import of application services** (the CLI is another adapter in DDD terms — same code as the HTTP path, no transport overhead, no need for the backend to be running). Lazy bootstrap per subcommand keeps startup fast.

Spec: see [docs/superpowers/specs/2026-05-02-dscli-design.md](../../superpowers/specs/2026-05-02-dscli-design.md) for the full design.

The killer feature for OUR debugging: `dscli concierge ask "..." --as office` makes any voice command shell-reproducible without audio.

---

## Sources

### Mastra docs
- [Agents overview](https://mastra.ai/docs/agents/overview)
- [Tools (`createTool`)](https://mastra.ai/docs/agents/using-tools)
- [Supervisor agents](https://mastra.ai/docs/agents/supervisor-agents)
- [Multi-agent systems concept guide](https://mastra.ai/guides/concepts/multi-agent-systems)
- [Dynamic Agents (blog)](https://mastra.ai/blog/dynamic-agents)
- [The evolution of AgentNetwork (blog — deprecation context)](https://mastra.ai/blog/agent-network)
- [Streaming events](https://mastra.ai/docs/streaming/events)
- [Workflows overview](https://mastra.ai/docs/workflows/overview)
- [Memory overview](https://mastra.ai/docs/memory/overview)
- [Agent class reference](https://mastra.ai/reference/agents/agent)

### Anthropic
- [Building Effective AI Agents: Architecture Patterns and Implementation Frameworks (PDF, 2026)](https://resources.anthropic.com/hubfs/Building%20Effective%20AI%20Agents-%20Architecture%20Patterns%20and%20Implementation%20Frameworks.pdf) — 30 pages, decision framework + pattern catalog
- [Agent class reference](https://mastra.ai/reference/agents/agent)
