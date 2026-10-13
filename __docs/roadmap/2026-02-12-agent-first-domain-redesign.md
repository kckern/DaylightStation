# Agent-First Domain Redesign

> Restructure nutribot and journalist from Telegram-coupled bot apps into channel-agnostic, agent-driven domain experiences

**Last Updated:** 2026-02-12
**Status:** Design Complete
**Related:**
- [Agents Domain Design](./2026-02-02-agents-domain-design.md) — agent infrastructure, IAgentRuntime, ITool
- [Health Coach Design](./2026-02-02-health-coach-design.md) — cross-domain coaching agent (nutrition + fitness + lifeplan)

---

## Problem

DaylightStation has two bot-driven applications — **nutribot** (nutrition tracking) and **journalist** (journaling). Both blur the line between domain logic, application orchestration, and Telegram-specific interaction patterns.

### Current violations

1. **`2_domains/journalist/` is not a domain.** It contains bot-interaction infrastructure (QueueManager, MessageSplitter, PromptBuilder, ConversationMessage, QuizQuestion) masquerading as domain concepts. The actual journaling domain exists separately at `2_domains/journaling/`.

2. **Application use cases are welded to Telegram.** The 35+ nutribot and 21+ journalist use cases encode a Telegram-specific interaction paradigm: callback buttons, revision modes, keyboard layouts, message splitting for 4096-char limits. A web UI (HealthApp.jsx) or Mastra agent can't reuse them.

3. **Bot personas are baked into application logic.** "Nutribot" and "journalist" are Telegram butler names, not domain concepts. The web UI shouldn't say "nutribot" — it's just the nutrition experience.

4. **AI is already in the loop.** Every text/image/voice use case already calls `aiGateway` for parsing. The bots aren't purely deterministic — they're hand-coded state machines that delegate to LLMs for the hard parts. An agent replaces the state machine with reasoning while keeping the same tools.

### The naming principle

- **Domains** = concepts: `nutrition`, `journaling`
- **Apps** = experiences: `nutribot`, `journalist` are product names for one channel (Telegram)
- Nutribot is Jeeves, not the resort. The web UI doesn't need a butler name — it's the experience directly.

---

## Vision

**Agents are the intelligence layer. Channels are delivery.**

There are two distinct concerns that the current bots conflate:

1. **Data capture** — Users send unstructured input (text, voice, images, barcodes). The system parses it into structured domain entities. This is primarily deterministic with AI assist for ambiguous cases.

2. **Coaching & feedback** — Intelligent follow-up, analysis, encouragement, proactive insights. This barely exists in the current bots (some canned encouragement). Agents unlock this.

Both concerns operate on the same domains (`nutrition`, `journaling`). Both should be channel-agnostic.

```
Telegram ─┐                         ┌─ parse_food_text (deterministic)
HealthApp ─┤→ Agent ────────────────→├─ lookup_upc (deterministic)
future ───┘   (reasoning +           ├─ log_food_entry (writes domain)
               orchestration)        ├─ get_daily_summary (reads domain)
                                     ├─ generate_coaching (AI-powered)
                                     └─ (structured output to channel)
```

Current use case logic doesn't disappear — it becomes **tool implementations**. The agent replaces `if/else` routing with LLM reasoning. Tools are fast and deterministic where they can be, AI-powered where they need to be.

---

## Layer Structure

### Domains (pure business concepts)

```
2_domains/nutrition/     NutriLog, FoodItem, CalorieColorService, FoodLogService
2_domains/journaling/    JournalEntry, JournalService
```

Unchanged. These are already clean. Both agents and legacy bots consume them.

### Applications (domain experiences, channel-agnostic)

```
3_applications/nutrition/
  NutritionAgent.mjs            ← agent class
  tools/
    parseFoodText.mjs            ← extracted from LogFoodFromText
    lookupUPC.mjs                ← extracted from LogFoodFromUPC + UPCGateway
    logFoodEntry.mjs             ← extracted from AcceptFoodLog
    getDailySummary.mjs          ← extracted from GenerateDailyReport
    generateCoaching.mjs         ← NEW capability
  ports/
    IFoodLogDatastore.mjs        ← existing, unchanged
    INutritionLookup.mjs         ← existing, unchanged

3_applications/journaling/
  JournalingAgent.mjs            ← agent class
  tools/
    processEntry.mjs             ← extracted from ProcessTextEntry
    getHistory.mjs               ← extracted from ReviewJournalEntries
    generateAnalysis.mjs         ← extracted from GenerateTherapistAnalysis
    generateDebrief.mjs          ← extracted from GenerateMorningDebrief
    generateCoaching.mjs         ← NEW capability
  ports/
    IJournalEntryRepository.mjs  ← existing, unchanged
```

Agents return structured output. They don't know Telegram exists.

### Cross-domain agents

Some agents span multiple domains. The [Health Coach](./2026-02-02-health-coach-design.md) already demonstrates this — it uses nutrition, fitness, and lifeplan tools together.

```
3_applications/agents/
  AgentOrchestrator.mjs          ← shared infrastructure (existing)
  ports/
    IAgentRuntime.mjs            ← framework-agnostic (existing)
    ITool.mjs                    ← tool interface (existing)
  health-coach/                  ← cross-domain agent (existing design)
    HealthCoachAgent.mjs
    tools/HealthToolFactory.mjs  ← composes nutrition + fitness + lifeplan tools
```

**Rule:** Single-domain agents live in their domain app (`3_applications/nutrition/`). Cross-domain agents live in `3_applications/agents/`. The HealthCoachAgent consumes tools from `nutrition/tools/` — it doesn't duplicate them.

### Adapters (external integrations + delivery channels)

```
1_adapters/agents/
  MastraAdapter.mjs              ← existing, implements IAgentRuntime

1_adapters/channels/
  telegram/
    NutribotPersona.mjs          ← bot name, emoji style, keyboard layouts
    JournalistPersona.mjs        ← bot name, conversational tone, keyboards
    TelegramChannel.mjs          ← webhook handling, message rendering
  web/
    WebChannel.mjs               ← REST/WebSocket, JSON contracts for React

1_adapters/nutrition/
  NutritionixAdapter.mjs         ← existing, unchanged
1_adapters/persistence/
  ...                            ← existing YAML datastores, unchanged
```

"Nutribot" and "journalist" are persona names that live in the Telegram channel adapter. They control response formatting, emoji, keyboard layouts, the "voice" of the bot — all Telegram-specific presentation concerns.

### What gets dissolved

```
2_domains/journalist/              ← NOT a domain
  entities/                        → pure journaling concepts merge into 2_domains/journaling/
  services/PromptBuilder           → tool logic in 3_applications/journaling/
  services/QueueManager            → Telegram adapter concern
  services/MessageSplitter         → Telegram adapter concern (4096-char limit)
  services/HistoryFormatter        → tool logic in 3_applications/journaling/
  services/QuestionParser          → tool logic in 3_applications/journaling/
  value-objects/                   → merge into 2_domains/journaling/ if pure, else application

3_applications/nutribot/           ← legacy, gradually hollowed
  35 use cases                     → logic extracted into tools
  NutribotContainer                → replaced by agent + bootstrap wiring

3_applications/journalist/         ← legacy, gradually hollowed
  21 use cases                     → logic extracted into tools
  JournalistContainer              → replaced by agent + bootstrap wiring
```

---

## Key Principles

1. **Domains are concepts, apps are experiences.** `nutrition` and `journaling` are domains. `nutribot` and `journalist` are Telegram product names. The application layer is organized by domain, not by bot identity.

2. **Agents replace state machines, not logic.** The `if callback == 'a' then accept` routing becomes agent reasoning. The actual accept/lookup/parse logic becomes tool implementations — same code, better orchestration.

3. **Deterministic where possible, AI where needed.** A `parse_food_text` tool can be deterministic for "2 eggs" and escalate to AI for "that thing I had yesterday." The agent decides which path.

4. **Channel adapters own presentation.** Telegram renders agent output as keyboards and emojis. HealthApp.jsx renders it as React components. The agent never thinks about Telegram's 4096-char limit or callback encoding.

5. **Personas are adapter concerns.** "Nutribot" is a Telegram persona — a name, a tone, an emoji vocabulary. HealthApp.jsx has no persona; it's the experience directly.

6. **Tools are composable across agents.** A `parseFoodText` tool in `nutrition/tools/` can be used by both the NutritionAgent and the cross-domain HealthCoachAgent. Tool factories provide the reuse surface.

---

## Migration Roadmap

### Phase 0: Clean domain boundaries

**Goal:** Correct DDD violations without changing behavior.

- Dissolve `2_domains/journalist/`
  - Merge pure journaling entities into `2_domains/journaling/`
  - Move bot-flow infrastructure (QueueManager, MessageSplitter, etc.) to `3_applications/journalist/` as temporary home
- No behavior changes — just correct layer placement
- All existing tests continue to pass

### Phase 1: Extract tools from use cases

**Goal:** Create reusable, channel-agnostic tool implementations alongside existing use cases.

- For each major use case (LogFoodFromText, AcceptFoodLog, ProcessTextEntry, etc.), extract the domain-operation core into an ITool-shaped function
- Use cases become thin wrappers that call tools + handle Telegram-specific rendering
- Both old use cases and new tools work simultaneously (strangler fig)
- HealthCoachAgent's HealthToolFactory already demonstrates this pattern — extend it

### Phase 2: Build domain agents

**Goal:** Domain-specific agents that handle both data capture and coaching.

- Create `NutritionAgent` and `JournalingAgent` with Phase 1 tools
- Add NEW tools for coaching/feedback (capabilities the current bots lack)
- Wire through AgentOrchestrator in bootstrap
- Test via `/agents/:agentId/run` API and via HealthApp.jsx

### Phase 3: Channel adapters

**Goal:** Decouple delivery from intelligence.

- Extract Telegram-specific rendering from use cases into `1_adapters/channels/telegram/`
- Build `1_adapters/channels/web/` for HealthApp.jsx
- Both channels talk to agents via AgentOrchestrator
- Telegram channel applies NutribotPersona/JournalistPersona to agent output

### Phase 4: Retire legacy

**Goal:** Remove the old bot application layer entirely.

- Remove old use case files as agent+tools fully cover their functionality
- Remove NutribotContainer, JournalistContainer, InputRouters
- `3_applications/nutribot/` dissolved into `3_applications/nutrition/`
- `3_applications/journalist/` dissolved into `3_applications/journaling/`

---

## Open Questions

1. **Conversation memory.** IMemoryDatastore port exists but is unused. Agents need conversation context for coaching. Does memory live per-agent, per-user, or per-channel?

2. **Scheduled triggers.** Morning debrief is currently a cron job that calls journalist use cases. In the agent world, does the scheduler invoke the agent, or produce a trigger event?

3. **Tool sharing mechanics.** HealthCoachAgent currently defines its own HealthToolFactory. When `nutrition/tools/` exists, does the HealthCoachAgent import those tools, or does it keep its own factory that wraps them?

4. **Migration granularity.** Migrate one tool at a time (incremental extraction) or one whole app at a time?

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-12 | Initial design from brainstorming session |
