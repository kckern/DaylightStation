# Health-Coach Chat Fix — Design

**Date:** 2026-05-05
**Status:** Brainstorm — review before plan
**Author thread:** conversation 2026-05-05 after a transcript revealed the agent calling `get_weight_trend({ userId: "user123" })` and falsely reporting "no recent weight data available"
**Related:**
- [docs/superpowers/specs/2026-05-05-agent-transcripts-design.md](2026-05-05-agent-transcripts-design.md) — the diagnostic surface that exposed this
- [docs/superpowers/specs/2026-05-05-health-coach-data-tier-design.md](2026-05-05-health-coach-data-tier-design.md) — the analytical tier that's currently registered but unused
- [docs/superpowers/specs/2026-05-05-health-coach-chat-design.md](2026-05-05-health-coach-chat-design.md) — the chat surface that triggered this bug

---

## Why this exists

A real conversation today: user asked `"whats my weight trend?"` via CoachChat. The transcript shows the agent:

1. Saw a chat input but ran with the **dashboard JSON-output system prompt** (the only prompt the agent has).
2. Confabulated `userId: "user123"` because the prompt never named the active user.
3. Called the older `get_weight_trend({userId: "user123", days: 7})` — naming-similar to the question — instead of the new `metric_trajectory` from Plan 1-5.
4. Got back `{ current: null, trend: null, history: [] }` (no such user).
5. Falsely told the user "no recent weight data available."

Four overlapping failures. This spec fixes all four together because they're load-bearing for each other:

- Without **userId resolution**, even the right tool returns nothing.
- Without **userId injection into args**, the model keeps guessing.
- Without an **Active User** prompt section, the model can't ground prose ("your weight is...").
- Without a **chat-mode prompt + tool cheatsheet**, the model defaults to the dashboard format and the older single-purpose tools.

The agent transcripts spec proved its value within hours: this spec is a direct consequence of the diagnostic surface it shipped.

---

## Design philosophy

**Make the model's job smaller.** The model should not have to know its own user identity. The orchestrator knows. The adapter knows. The tools' execution context knows. The model is only there to reason about the user's question, pick the right tool, and write the answer. Anything else is a data-plumbing concern.

**Single source of truth for "who is the user."** `configService.getHeadOfHousehold()` reads `data/household/config/household.yml` and returns the configured head (`kckern` in production). Six existing call sites already fall back to this — they should stop having to fall back, because the orchestrator does it once.

**The cheatsheet steers, the strip-and-inject enforces.** The chat prompt's tool cheatsheet anchors the model on the right tools for the right question shape. The adapter's userId-strip-and-inject makes the userId arg structurally invisible to the model. Both layers compound: the model sees fewer wrong choices, and even if it tries to pass a bad userId, the adapter overrides.

**Two prompts, not one branchy one.** Chat mode and dashboard mode have meaningfully different output contracts (prose vs JSON, data hygiene framing, tool selection guidance). Two distinct prompts keep each one readable. The mode flag wires which one the agent serves.

---

## The four changes

### Change 1: AgentOrchestrator resolves `userId` to head of household

**File:** `backend/src/3_applications/agents/AgentOrchestrator.mjs`

The orchestrator already generates `turnId` if absent. Add a sibling step that resolves `userId`:

```javascript
function resolveUserId(rawUserId, configService) {
  // 'default' is a sentinel sent by the frontend when no specific user is selected
  if (rawUserId && rawUserId !== 'default') return rawUserId;
  return configService?.getHeadOfHousehold?.() ?? null;
}

async run(agentId, input, context = {}) {
  const agent = this.#getAgent(agentId);
  const turnId = context.turnId ?? crypto.randomUUID();
  const userId = resolveUserId(context.userId, this.#configService);
  const augmented = { ...context, turnId, userId };

  this.#logger.info?.('orchestrator.run', { agentId, turnId, userId, contextKeys: Object.keys(context) });
  return agent.run(input, { context: augmented });
}
```

Same pattern for `runInBackground`. `runAssignment` already takes `opts.userId` directly; resolve it the same way.

**Wiring:** `AgentOrchestrator` constructor accepts a new `configService` dep. `bootstrap.mjs` passes it where the orchestrator is constructed (~line 2944). When `configService` isn't wired (legacy callers, tests), the resolver returns the raw userId untouched — no behavior change.

**Effect:** every chat path through CoachChat (which currently sends `userId: 'default'`) lands in the agent with `userId: 'kckern'`. Every scheduled assignment that already passed a real userId is unaffected.

### Change 2: BaseAgent injects "Active User" into the assembled prompt

**File:** `backend/src/3_applications/agents/framework/BaseAgent.mjs`

Modify `#assemblePrompt(memory, context)`:

```javascript
async #assemblePrompt(memory, context = {}) {
  const base = await this.getSystemPrompt(context);  // pass context for mode-aware agents
  const sections = [base];

  if (context.userId) {
    sections.push(`## Active User\nThe user you are assisting is: **${context.userId}**`);
  }

  const attachmentsBlock = await this.formatAttachments(context.attachments);
  if (attachmentsBlock) sections.push(attachmentsBlock);

  if (memory) sections.push(`## Working Memory\n${memory.serialize()}`);
  return sections.join('\n\n');
}
```

Note the second small change here: `getSystemPrompt(context)` now receives the context (so mode-aware agents can branch on `context.mode`). Existing agents whose `getSystemPrompt()` ignores arguments are unaffected.

**Universal effect:** every agent (echo, lifeplan-guide, paged-media-toc, health-coach) now has the active user named in its prompt. The model can write prose like "your last 30 days..." instead of "the user's last 30 days..." and never has to guess for tool args.

### Change 3: MastraAdapter strips userId from schema and auto-injects from context

**File:** `backend/src/1_adapters/agents/MastraAdapter.mjs`

In `#translateTools(tools, context, callCounter, transcript)`, two things:

**3a. Strip `userId` from the JSON schema the model sees.** In the schema-translation step (or in `jsonSchemaToZod`), remove the `userId` property from `properties` and from `required`. The model sees a tool with no `userId` parameter.

```javascript
function stripUserIdFromSchema(jsonSchema) {
  if (!jsonSchema || jsonSchema.type !== 'object') return jsonSchema;
  const out = { ...jsonSchema, properties: { ...jsonSchema.properties } };
  delete out.properties.userId;
  if (Array.isArray(out.required)) {
    out.required = out.required.filter(k => k !== 'userId');
  }
  return out;
}
```

Use it in the wrapper:

```javascript
inputSchema: jsonSchemaToZod(stripUserIdFromSchema(tool.parameters)),
```

**3b. Merge `userId` from context into args before invoking `tool.execute()`.**

```javascript
execute: async (inputData) => {
  callCounter.count++;
  const args = { ...inputData };
  if (context.userId) args.userId = context.userId;  // adapter wins; model can't override

  // ... existing wrapper logic, but use `args` everywhere ...
  const result = await tool.execute(args, context);
  // ... transcript.recordTool with args ...
}
```

**Effect:** Tools' parameter declarations stay as-is. The model never sees `userId`, never has to think about it, and can't pass a wrong one. The transcript captures the merged `args` (including userId) so debugging is preserved.

**Edge case:** if a tool is multi-user (cross-household analytical compares — none today, but hypothetically), it can opt out by accepting an alternate field name (e.g., `targetUserId`). The strip-and-inject only touches the literal `userId` key. Documented in the implementation plan.

### Change 4: HealthCoachAgent chat-mode vs dashboard-mode prompts

**Files:**
- Rename: `backend/src/3_applications/agents/health-coach/prompts/system.mjs` → `prompts/dashboard.mjs` (export `dashboardPrompt`)
- Create: `backend/src/3_applications/agents/health-coach/prompts/chat.mjs` (export `chatPrompt`)
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs` — accept `mode` in `getSystemPrompt`

**`HealthCoachAgent.getSystemPrompt(context)`** reads `context.mode`:

```javascript
async getSystemPrompt(context = {}) {
  const mode = context.mode ?? 'chat';
  const base = mode === 'dashboard' ? dashboardPrompt : chatPrompt;

  const userId = context.userId ?? this.#activeUserId;
  if (!this.deps.personalContextLoader || !userId) return base;

  // Personal-context bundle (Plan 1+ work) appends after the base
  if (this.#personalContextCache.has(userId)) {
    const bundle = this.#personalContextCache.get(userId);
    return bundle ? `${base}\n\n${bundle}` : base;
  }
  const bundle = await this.#getPersonalContextBundle(userId, this.deps.personalContextLoader);
  return bundle ? `${base}\n\n${bundle}` : base;
}
```

The existing dual-mode (sync/async) machinery for the personal context cache stays. We just swap which base prompt gets the bundle appended.

**The new chat prompt** (`prompts/chat.mjs`):

```javascript
export const chatPrompt = `You are a personal health coach. Answer the user's question
in clear, concise prose grounded in real data fetched via your tools. Do NOT produce JSON.
Reference specific numbers from tool results.

## Personality
- Direct and data-driven. Reference specific numbers (weight, macros, session counts).
- Brief and actionable. No motivational fluff or filler.
- Acknowledge patterns with data. "Three workouts this week" not "Great job staying active!"
- Suggest, don't lecture. "Protein has averaged 95g — target is 145g" not "You need to eat more protein."

## Tool Cheatsheet — pick the right tool for the question shape

Prefer the analytical tools below for trend, comparison, correlation, and anomaly questions.
The older single-purpose tools (get_weight_trend, get_today_nutrition, etc.) still work but
return less rich data.

| User asks... | Tool |
|---|---|
| "trend / direction / slope / rate of change" | metric_trajectory |
| "compare X vs Y / how does this compare to..." | compare_metric |
| "what changed / explain the difference" | summarize_change |
| "average / total / how much / what was my..." | aggregate_metric |
| "show me the values over time" | aggregate_series |
| "where do I sit / percentile / typical range" | metric_distribution or metric_percentile |
| "snapshot / overall / how am I doing" | metric_snapshot |
| "anomalies / unusual / outliers" | detect_anomalies |
| "regime change / when did things shift" | detect_regime_change |
| "streaks / sustained / runs of X" | detect_sustained |
| "when X is true, what does Y do" | conditional_aggregate |
| "correlate / relationship between X and Y" | correlate_metrics |
| "find when / show me periods where X" | deduce_period |
| "list my named periods / what benchmarks" | list_periods |
| "tell me about <named period>" | query_named_period |
| "remember this period as <name>" | remember_period |
| "reflect on my history / scan for patterns" | analyze_history |

## Default time windows
- When the user doesn't specify a period, default to last_30d for "recent" / "lately" / "now."
- For "this week," use last_7d. For "this year," use this_year. For "all-time," use all_time.

## Data hygiene
- If a tool returns null / no data, say so honestly. Do NOT fabricate numbers.
- For data less than 14 days old, do NOT reference implied_intake, tracking_accuracy, or
  calorie_adjustment. Those values depend on weight smoothing that hasn't settled yet —
  the existing redaction strips them.
- Don't pass userId in tool args — it is set automatically.
- Don't ask the user for their userId. The system has it.

## Output
Write conversational prose. No JSON, no markdown headers unless the user asks for a list
or table. Keep replies tight: 2-5 sentences for simple questions, longer only when the
user asks for depth.`;
```

The dashboard prompt stays exactly as-is (just renamed file). Zero behavior change for the scheduled `daily-dashboard` assignment.

---

## Lifecycle, after all four changes — "what's my weight trend?"

```
1. CoachChat sends POST /api/v1/agents/health-coach/run
   { input: "what's my weight trend?", context: { userId: "default", attachments: [] } }

2. AgentOrchestrator.run() receives. Resolves userId: "default" → "kckern".
   Generates turnId. Forwards { context: { userId: "kckern", turnId, mode: "chat", ... } }

3. HealthCoachAgent.run() (BaseAgent) calls getSystemPrompt({ userId: "kckern", mode: "chat" })
   → returns chatPrompt + personal-context bundle.

4. BaseAgent.#assemblePrompt() prepends:
   - Active User: kckern
   (No attachments preamble — none sent.)
   (Working memory empty for kckern in this case.)

5. MastraAdapter.execute() builds the Mastra agent with the assembled prompt + tools.
   Each tool's schema has userId stripped. Tool wrappers will inject userId:"kckern" silently.

6. Model receives the prompt. Sees:
   - "Active User: kckern"
   - "metric_trajectory for trend questions"
   - Tool params don't include userId (no temptation to confabulate)

7. Model calls metric_trajectory({ metric: "weight_lbs", period: { rolling: "last_30d" } })
   Adapter merges userId: "kckern" into args. Tool runs with full info.

8. Tool returns { slope: -0.1, slopePerWeek: -0.7, direction: "down", rSquared: 0.85,
   start: { date: "...", value: 200 }, end: { date: "...", value: 197 } }

9. Model writes prose response:
   "Down ~0.7 lbs/week over the last 30 days, fairly steady. Started at 200, currently
   at 197 — about 3 lbs."

10. Transcript captures: input, resolved system prompt with chat mode + Active User +
    cheatsheet, the metric_trajectory call with merged userId, the result, the prose output.
```

Compare to today's transcript (still on disk for reference): hallucinated userId, wrong tool, false "no data" answer.

---

## Backwards compatibility

| Existing path | Behavior |
|---|---|
| Scheduled `daily-dashboard` assignment | Unchanged. Uses dashboard mode + the renamed prompt. |
| `runAssignment(...)` calls from elsewhere | Unchanged unless they explicitly opt into chat mode. |
| `agent.getSystemPrompt()` callers that pass no args | Get chat-mode prompt by default (changed from dashboard prompt). For HealthCoachAgent specifically, this is intentional — the freeform `run()` path is now correctly routed. |
| Tools that take `userId` in their schema | Unchanged. The schema strip happens at the Mastra translation layer; the underlying tool's parameter declaration is untouched. |
| Tests that mocked `getSystemPrompt` returning a fixed string | Need updating to handle the new context arg. Likely 2-3 places. |
| Other agents (echo, lifeplan-guide, paged-media-toc) | Get the universal benefits (Change 1 userId resolution, Change 2 Active User, Change 3 schema strip + auto-inject). Their getSystemPrompt is unchanged — they don't have a mode split. |

---

## Edge cases & considerations

**1. The `userId === 'default'` sentinel.** This is a real string the frontend currently sends. We treat it as a hint meaning "use head of household." If a real user is named `default` in someone's household.yml, that's a very unusual configuration and we'd need to distinguish — but YAGNI for v1, and we'd document this if it ever comes up.

**2. configService not available in tests.** The orchestrator's resolver gracefully passes through when `configService` is null. Tests can either inject a stub configService with `getHeadOfHousehold` or pass a non-`'default'` userId.

**3. Multi-user analytical questions.** If we ever build "compare household member weight trends," those tools would NOT take a `userId` arg (they'd take `userIds: [...]`). The strip-and-inject only touches the literal `userId` key, so multi-user tools are unaffected.

**4. Chat-mode with attachments.** When CoachChat ships @-mention attachments, they flow through `context.attachments` and the existing `formatAttachments` preamble logic. The chat-mode prompt + Active User + attachments preamble compose naturally.

**5. Personal context bundle in chat mode.** The bundle (per-user playbook, named periods, etc. from Plan 1+) currently appends to the dashboard prompt. After this change, it appends to the chat prompt instead when mode='chat'. The bundle's content is mode-agnostic (same data, different framing in the parent prompt).

---

## Out of scope (explicit)

- **Removing the older HealthToolFactory tools** (`get_weight_trend`, `get_today_nutrition`, etc.). The cheatsheet steers the model away; deletion is a separate refactor.
- **Generated cheatsheet from the tool registry.** Hardcoded text is fine for v1; if tools churn, we revisit.
- **Per-mode tool restrictions** (e.g., chat doesn't see dashboard-only tools). The model sees all registered tools regardless of mode. The cheatsheet is the only steering. YAGNI.
- **Other agents' prompts.** Only HealthCoachAgent has the dashboard/chat split today. lifeplan-guide is already chat-mode by design; echo and paged-media-toc don't need this.
- **Replacing `'default'` everywhere.** Frontend keeps sending `'default'` until we choose to refactor the userId resolution at the request layer. The orchestrator-side fix is sufficient and keeps the frontend simple.
- **Eval / regression test for the chat path.** A "is the agent answering this question well?" test belongs in the eval pipeline (deferred from the agent transcripts spec). For this spec, we add a unit-level regression test that "what's my weight trend?" routes to `metric_trajectory` (or at minimum: calls a Plan-1+ analytical tool with `userId: 'kckern'`, not `'user123'`, not `'default'`).

---

## Testing strategy

- **Unit:**
  - `AgentOrchestrator` resolveUserId — happy paths + fallback paths + null configService
  - `BaseAgent.#assemblePrompt` — Active User section appears when userId set, absent when null
  - `MastraAdapter` — schema strip removes userId; auto-inject merges from context; transcript captures merged args
  - `HealthCoachAgent.getSystemPrompt({mode})` — returns chat vs dashboard prompt; default = chat; bundle append works for both
- **Integration:**
  - Full `agent.run()` with `userId: 'default'` → resolves to `kckern` → assembled prompt has "Active User: kckern" → tool wrapper merges it in
  - Regression: "what's my weight trend?" via the orchestrator with `userId: 'default'` lands a tool call with `userId: 'kckern'` (not `'user123'`, not `'default'`)

---

## Why this is the right shape

**The model's failure mode is gone.** With `userId` removed from its schema and merged from context, the model literally cannot pass a wrong user. This was the load-bearing bug.

**Two prompts read better than one.** The dashboard prompt was 91 lines about JSON output structure. A chat-mode prompt that's 60 lines about prose answers + the tool cheatsheet is a different cognitive frame for the model. Trying to merge them into one would produce a confused 150-line prompt.

**The cheatsheet maps naming to selection.** The model picked `get_weight_trend` because the user said "trend." With the cheatsheet, the model now sees "trend → metric_trajectory" explicitly. Naming similarity becomes a feature, not a bug.

**The fix scales.** Every future agent gets the BaseAgent + MastraAdapter benefits for free. Future health-coach modes (e.g., "voice mode") just add another prompt file and route by mode.
