# Fitness Dashboard & Health Coach Agent Design

> Agent-driven fitness dashboard with curated workout recommendations, health tracking widgets, and interactive coaching

**Last Updated:** 2026-02-14
**Status:** Design Complete, Ready for Implementation
**Supersedes:** [Health Coach Agent Design](./2026-02-02-health-coach-design.md)
**Parent Design:** [Agents Domain Design](./2026-02-02-agents-domain-design.md)

---

## Overview

Two pillars that work together:

**Pillar 1 — Fitness Dashboard:** The HomeApp plugin inside the fitness app becomes a widget-based landing screen. It shows health state (weight trends, nutrition, body composition, recent workouts, DEXA data) and agent-generated content (next workout, coaching tips, calls to action). This is what the user sees when they open the fitness app.

**Pillar 2 — Health Coach Agent:** An autonomous AI agent that lives in the system with persistent memory, tools, and scheduled assignments. Its first assignment is "prepare today's dashboard" — it gathers health data, reasons about what to present, and writes structured content to a datastore that the dashboard reads. The dashboard is not algorithmically generated on load; the agent curates it with context, memory, and judgment.

The agent will eventually handle additional assignments (both scheduled and ad-hoc), interactive chat, voice memo conversations, and more. The daily dashboard prep is one assignment among many it will perform. This agent also serves as the **template for future agents** in the system — establishing patterns for memory, tool use, scheduling, and structured output.

**Core Question Answered:** "How do I get a personalized, context-aware fitness experience that knows where I am in my program, what my body is doing, and what I should do next — without manually curating it every day?"

---

## Dashboard Design

### Widget Categories

The dashboard renders three distinct categories of content, each with different UX treatment.

#### State Widgets (live data)

Pull directly from APIs for freshness. No agent involvement — these are real-time snapshots.

| Widget | Data Source | Content |
|--------|------------|---------|
| Weight trend | `/api/v1/lifelog/weight` | Current weight, 7-day trend, goal ETA |
| Nutrition snapshot | `/api/v1/health/nutrilist` | Today's calories/macros vs. targets, logging streak |
| Body composition | Health datastore | Most recent DEXA scan results — lean mass, body fat % |
| Recent workouts | `/api/v1/health/workouts` | Last 3-5 sessions with type, duration, HR summary |

#### Curated Content (invisible elf)

Prepared by the agent during its daily dashboard assignment. Feels like native app features — the user doesn't perceive an agent behind these. No agent voice, no commentary tone.

| Widget | Content |
|--------|---------|
| Up Next | Recommended workout with program context. Thumbnail, title, duration. Tap to play. |
| Alternates | 1-2 other options if the primary doesn't appeal. "Not today" without explanation. |
| Playlist builder | Pre-composed stacks (warm-up + main + cool-down) and quick-add to build custom playlists. Feels like a playlist UI, not a conversation. |

#### Coach Presence (talking to Santa)

Explicitly in the agent's voice. The user knows they're hearing from their coach. Rendered with distinct conversational treatment.

| Widget | Content |
|--------|---------|
| Morning briefing | A few sentences on current state, trends, notable patterns. |
| Calls to action | Direct nudges — "Log yesterday's meals," "Protein has been low this week." |
| Questions & prompts | Voice memo prompts, multiple-choice check-ins, goal-setting nudges. |
| Feedback | Reactions to observed patterns — "Three workouts this week, nice consistency." |

### Invisible Elf vs. Talking to Santa

This distinction is critical to the UX:

- **Invisible elf (curated content):** The agent is Santa who dropped off presents overnight. Selecting the Up Next workout or building a playlist does not feel like interacting with an agent. It's opening presents, not talking to Santa at the mall.
- **Talking to Santa (coach presence):** These are explicitly agent-voiced. The user is in dialogue with their coach — hearing observations, receiving nudges, answering questions.

Both categories are produced by the same agent during the same assignment run, but the dashboard renders them with completely different UX.

---

## Agent Architecture

### Identity

The health coach agent follows patterns from the [Agents Domain Design](./2026-02-02-agents-domain-design.md), extending BaseAgent with the existing port interfaces (IMemory, ITool, IAgentRuntime).

```
Agent ID:        health-coach
Tool Factories:  health, fitness-content, lifeplan (limited)
Memory:          Per-user working memory (tiered) + conversation threads
Assignments:     Daily dashboard prep (first), more to follow
```

### Memory System

#### Principle: Memorize Interpretations, Look Up Facts

The agent memorizes *context and decisions* (program state, user sentiment, coaching strategy) but *looks up facts* fresh each run (weight, macros, last workout) via tools. This prevents anchoring on data that gets backfilled or corrected after the fact.

#### Working Memory — Single Store with Optional Expiry

Working memory is a single key-value store. Each entry has an optional TTL (time-to-live) set at write time. Entries without a TTL persist until explicitly removed. Entries with a TTL are pruned on read. The agent decides lifespan per entry — no category taxonomy or decay curves.

**Persistent entries** (no TTL):
- Coaching style notes ("responds well to direct feedback, prefers data over motivation")
- Onboarding state (which questions have been asked/answered)
- Sentiment observations ("user gets frustrated when nagged about logging")

**Expiring entries** (TTL set at write time):
- Recent observations — "skipped 2 workouts this week" (TTL: ~1 week)
- Temporary context — "recovering from flu" (TTL: ~2 weeks)
- Pending follow-ups — "asked about energy levels, awaiting response" (TTL: until resolved)
- Data quality flags — "no meals logged yesterday" (TTL: ~2 days)

**What is NOT memory:** Program state and goals are tool-owned (read/write via `get_program_state`, `get_user_goals`). Memory holds only things that can't be looked up — coaching strategy, sentiment, follow-up tracking. See [Stress Test #6](#6-medium-memory-vs-tool-authority-unclear).

**TTL examples:**

| Entry | TTL | Reasoning |
|-------|-----|-----------|
| "No meals logged yesterday" | 48 hours | Stale after two days |
| "Skipped two sessions" | 1 week | Relevant for current week's pattern |
| "Recovering from flu" | 2 weeks | Temporary health context |
| "Consistently skipping leg days" | 1 month | Behavioral pattern, needs longer observation |
| "Responds well to direct feedback" | none | Persistent coaching insight |

The memory system handles pruning transparently on read — expired entries are removed before the agent sees them. See [Agent Framework: WorkingMemory](#workingmemory) for implementation.

#### Conversation History

Thread-based storage for interactive coaching sessions — voice memo exchanges, chat, questionnaire responses. Stored via the IMemory port interface.

### Tools

Extends the HealthToolFactory with additional fitness-specific tools:

**Existing read tools (from HealthToolFactory):**
- `get_weight_trend` — weight, body fat %, lean mass, 7-day trend
- `get_today_nutrition` — today's calories and macros
- `get_nutrition_history` — multi-day nutrition data
- `get_recent_workouts` — Strava + fitness tracker activities
- `get_health_summary` — comprehensive daily snapshot
- `get_recent_meals` — recent food items for suggestions

**Existing analysis tools:**
- `calculate_goal_progress` — progress toward weight/body composition goals
- `suggest_calorie_target` — BMR/TDEE-based recommendations
- `calculate_remaining_macros` — remaining daily allowance

**New tools for dashboard assignment:**

| Tool | Purpose |
|------|---------|
| `get_fitness_content` | Browse available Plex fitness programs and episodes |
| `get_program_state` | Read current program tracking state (position, schedule) |
| `update_program_state` | Advance position, record substitutions, start/end programs |
| `write_dashboard` | Write structured dashboard YAML to per-user datastore |
| `get_user_goals` | Read health/fitness goals |
| `get_voice_memos` | Retrieve recent voice memo transcriptions for context |
| `log_coaching_note` | Save insights, milestones, and recommendations to history |

### Daily Dashboard Assignment

One scheduled skill invocation — the agent's first assignment:

1. Load working memory (long-term + non-expired short-term)
2. Call tools to gather fresh data (weight, nutrition, workouts, content catalog)
3. Check program state — infer, confirm, or continue
4. Review short-term memory and apply half-life decay
5. Reason about what to present — curated content and coach content
6. Write structured dashboard YAML to per-user datastore via `write_dashboard`
7. Update working memory with new observations
8. Log any coaching notes for history

The scheduling mechanism (cron or system scheduler) invokes the assignment at a configured time. The agent itself is not "running daily" — it has an assignment that happens to be scheduled daily. Future assignments may run on different schedules or be triggered ad-hoc.

---

## Workout Program Awareness

### Program State

A lightweight data structure tracking the user's current program context:

```yaml
program:
  id: "p90x"
  content_source: "plex:show:12345"
  started: "2026-02-01"
  current_day: 23
  total_days: 90
  schedule: "6_on_1_off"
  rest_days: [sunday]
  substitutions:
    - day: 15
      original: "Kenpo X"
      actual: "30-min bike ride"
      reason: "user_preference"
  status: "active"  # active | paused | completed | abandoned
```

### Three Paths to Program State

1. **Inferred from patterns:** The agent notices the user has done P90X episodes 1, 2, 3, 4, 5 on consecutive days and asks for confirmation.
2. **Explicit user declaration:** "I'm starting P90X on Monday" via voice memo, chat, or a dashboard prompt.
3. **Agent-prompted confirmation:** "Looks like you're following the P90X schedule — is that right?" with a simple Y/N response widget.

### Flexibility

Programs aren't rigid. The agent accommodates:

- **Substitutions** — doing your own cardio instead of the program's cardio day
- **Hybrid programs** — mixing episodes from multiple programs
- **Ad-hoc mode** — no active program; the user picks one-off workouts. Up Next becomes suggestion-based: recent favorites, variety picks, things not done in a while
- **Pausing/resuming** — life happens; the program can pause and resume without losing position

### Playlist Building

Some workouts benefit from stacking:

```
5-min warm-up → 45-min main workout → 5-min stretch → 20-min bike
```

- The agent can pre-compose a suggested stack in curated content
- The user can also build one manually from available content via a queue/playlist UI (add, remove, reorder)
- The fitness player already handles sequential playback — the playlist hands off a queue

---

## User Lifecycle

### Onboarding (New User)

When a user has no goals, no program, and sparse data, the agent recognizes this and adjusts its dashboard output:

| Category | Onboarding Behavior |
|----------|---------------------|
| Curated content | Discovery-oriented — available programs, popular starting points |
| Coach presence | Onboarding prompts — "What are your fitness goals?" via voice memo or multiple-choice |
| Calls to action | Data habit establishment — "Step on the scale," "Log today's meals," "Connect Strava" |
| State widgets | Show whatever data exists; empty states with helpful prompts for missing data |

As data accumulates and goals are set, the dashboard progressively fills out. The agent's working memory tracks onboarding state so it doesn't re-ask answered questions.

### Goal Setting

Goals can be established through:
- Multiple-choice questionnaire widgets on the dashboard
- Voice memo conversation with the coach
- Future: dedicated goal-setting chat flow

If no goals are set, the coach widget prompts for them. Goals feed into long-term working memory and inform all future recommendations.

### Multi-User / Household Scope

The fitness app runs on a shared household screen, but health data and coaching are personal.

| Concern | Scope |
|---------|-------|
| Dashboard content | Per-user — each member gets their own agent output |
| Agent memory | Per-user — separate working memory, goals, program state |
| Coach interactions | Per-user — individual briefings, CTAs, voice memo prompts |
| Available content | Household — shared Plex library, shared equipment |
| User switching | Dashboard switches based on active user context on the shared screen |

Household-level features (family workout suggestions, shared challenges) are out of scope for v1 but the per-user architecture doesn't preclude them.

---

## Dashboard Datastore

### Structure

The agent writes structured output to a per-user, per-date datastore. The dashboard frontend reads it on load.

```yaml
# data/household/users/{userId}/health-dashboard/{date}.yml
generated_at: "2026-02-14T04:12:00Z"

curated:
  up_next:
    primary:
      content_id: "plex:12345"
      title: "P90X - Day 23: Shoulders & Arms"
      duration: 60
      program_context: "P90X Week 4, Day 2"
    alternates:
      - content_id: "plex:12399"
        title: "Yoga X"
        duration: 92
        reason: "rest_day_option"
      - content_id: "plex:45001"
        title: "10-Min Stretch"
        duration: 10
        reason: "light_option"
  playlist_suggestion:
    - content_id: "plex:99001"
      title: "5-Min Warm-Up"
      duration: 5
    - content_id: "plex:12345"
      title: "Shoulders & Arms"
      duration: 60
    - content_id: "plex:99015"
      title: "Cool Down Stretch"
      duration: 5

coach:
  briefing: "Down 1.2 lbs this week — ahead of pace. Yesterday you hit 2,100 cal with 140g protein. Solid on protein. Today's a good day for Shoulders & Arms if you're feeling it, or Yoga X if you want something lighter."
  cta:
    - type: "data_gap"
      message: "No meals logged yesterday."
      action: "open_nutrition"
    - type: "observation"
      message: "Protein averaged 95g this week. Target is 145g."
  prompts:
    - type: "voice_memo"
      question: "You've had two rest days — how's your energy level?"
    - type: "multiple_choice"
      question: "Feeling ready for Shoulders & Arms today?"
      options: ["Yes, let's go", "Something lighter", "Rest day"]
```

### Frontend Contract

- Dashboard fetches today's file via `/api/v1/health-dashboard/{userId}/{date}`
- If no file exists (agent hasn't run yet, or new user), frontend falls back to live API data for state widgets and shows onboarding prompts
- State widgets (weight, nutrition) also pull live data alongside the dashboard file so they reflect same-day changes
- Curated and coach content remain as the agent prepared them for the day

### Staleness

The dashboard file is generated once per day by the scheduled assignment. State widgets supplement with live API data for freshness. If the user completes a workout mid-day, the state widgets update but the curated content won't regenerate until the next morning — this is acceptable because the "Up Next" recommendation was already consumed.

---

## Agent Design Principles

Patterns and principles drawn from [Patterns for Building AI Agents](../../reference/books/agent/agent-patterns.txt) and [Principles of Building AI Agents](../../reference/books/agent/agent-principles.txt) (Bhagwat/Gienow, Mastra) that apply to this agent's design.

### 1. Start With One Burning Problem

> "Build that agent really well. Notice what users ask for next." — *Evolve Your Agent Architecture*

The daily dashboard assignment is the one burning problem. Resist the urge to build chat, voice interaction, and multi-user support in parallel. Get the daily dashboard working reliably first, then expand. The agent's architecture should accommodate future assignments, but the implementation should earn its way there iteratively.

### 2. Context Engineering Over Context Dumping

> "When you put something in the context the model has to pay attention to it." — *Avoid Context Failure Modes*

Five context failure modes to actively guard against:

| Failure Mode | Risk in Our Design | Mitigation |
|--------------|--------------------|------------|
| **Context poisoning** | Stale short-term memory ("user is sick") anchoring future reasoning weeks later | Half-life decay by category; memory expiry is infrastructure, not agent reasoning |
| **Context distraction** | Dumping all weight/nutrition history into context | Tool-based lookups for facts; only pull data the agent plans to reason about |
| **Context confusion** | Irrelevant data polluting recommendations | Agent sees compact working memory + targeted tool results, not raw data dumps |
| **Context clash** | Backfilled data contradicting earlier observations | Facts are always looked up fresh via tools; memory stores interpretations only |
| **Context rot** | Working memory growing unbounded over months of daily runs | Half-life decay + periodic pruning; long-term memory stays compact |

**Core principle: Memorize interpretations, look up facts.** The agent remembers "we're in week 3 of P90X and the user prefers morning workouts" but looks up today's weight and yesterday's nutrition via tools every run.

### 3. Structured Output for Reliability

> "When you use LLMs as part of an application, you often want them to return data in JSON format instead of unstructured text." — *Structured Output*

The dashboard YAML is a structured output contract. The agent must produce exactly the schema the frontend expects — curated content with content IDs, coach commentary with typed CTAs, prompt widgets with defined response types. Use JSON Schema validation on the output to catch malformed dashboard files before they reach the datastore.

### 4. Dynamic Agent Behavior

> "Allow agents' capabilities to adapt dynamically at runtime." — *Dynamic Agents*

The agent's behavior should flex based on user context:

| User State | Agent Behavior |
|------------|----------------|
| New user, no goals, no history | Onboarding prompts, discovery content, data habit CTAs |
| Goals set, no active program | Suggestion-based Up Next, goal-tracking commentary |
| Mid-program | Program-aware Up Next, position tracking, schedule context |
| Data gaps (missed logging) | Data quality CTAs, graceful degradation in commentary |

This is runtime context — the same agent definition adapts its prompt context, tool selection depth, and output emphasis based on what it observes about the user.

### 5. Human-in-the-Loop (Deferred Pattern)

> "Deferred tool execution might be the HITL pattern most aligned with real-world workflows because humans don't want to babysit agents." — *Human-in-the-Loop*

The agent never blocks waiting for user input. It follows the deferred HITL pattern:

1. Agent runs its daily assignment, observes a question worth asking
2. Agent writes a prompt widget to the dashboard (voice memo or multiple-choice)
3. User sees the prompt, responds at their convenience (or ignores it)
4. On the next run, the agent checks for responses and incorporates them into working memory

This means the agent must track **pending prompts** in short-term memory and know which have been answered vs. ignored. An ignored prompt might be re-asked once, then dropped.

### 6. Granular Access Control

> "You may need to spend more time ensuring agents are permissioned accurately." — *Agent Middleware*

The health coach agent has a constrained permission boundary:

| Access | Scope |
|--------|-------|
| **Read** | Weight, nutrition, workouts, Strava, DEXA, Plex content catalog, user goals, voice memos |
| **Write** | Dashboard datastore (per-user), own working memory, coaching history log |
| **Cannot** | Modify weight records, edit nutrition logs, change workout history, alter Plex content, access other users' data |

Tools enforce this boundary — the agent can only do what its tools allow. No raw datastore access.

### 7. Feed Errors Into Context

> "Given the error message, the code, and any other relevant context, the agent generates fixes." — *Feed Errors Into Context*

When data sources are unavailable or incomplete, the agent should capture that context and adapt:

- Strava API down → skip workout widget, note in coach commentary ("Couldn't pull recent workouts today")
- No meals logged for 2 days → CTA to log meals, note reduced confidence in nutrition commentary
- Weight data stale (no readings in 5+ days) → flag in both working memory and dashboard

Errors become input to the next decision, not silent failures.

### 8. Workflow Over Freeform Loop

> "Sometimes, you've just gotta break a problem down, define the decision tree." — *Workflows 101*

The daily dashboard assignment should be a structured workflow, not a single freeform agent invocation:

```
Load working memory
    → Gather fresh data (tools)
    → Check program state
    → Review/decay short-term memory
    → Reason about dashboard content (LLM)
    → Validate structured output (schema)
    → Write dashboard to datastore
    → Update working memory
    → Log coaching notes
```

Each step has clear inputs, outputs, and failure handling. This makes the assignment debuggable, observable, and less prone to the agent going off-script. If the LLM reasoning step produces invalid output, the workflow retries that step — it doesn't restart from scratch.

### 9. Tool Design as Analyst Operations

> "Think like an analyst. Break your problem into clear, reusable operations. Write each as a tool." — *Tool Calling*

Each tool should mirror an operation a human health coach would perform:

- "What does the scale say?" → `get_weight_trend`
- "What did they eat yesterday?" → `get_nutrition_history`
- "What workouts are available?" → `get_fitness_content`
- "Where are they in the program?" → `get_program_state`
- "Write today's board" → `write_dashboard`

Tools should return compact, pre-summarized data — not raw database dumps. The agent shouldn't have to sift through 500 nutrition log entries; the tool should aggregate and return the relevant summary.

### 10. Eval Readiness

> "Benchmarks are the difference between engineering and experimentation." — *Iterate Against Your Evals*

Even before building evals, define what "good" and "bad" dashboard output looks like:

**Failure modes to track:**
- Bad recommendation (suggesting a workout the user can't do, or content that doesn't exist)
- Stale observation (referencing something the user already addressed)
- Missed pattern (user has been consistent but agent doesn't acknowledge it)
- Unhelpful CTA (nagging about something out of the user's control)
- Schema violation (dashboard YAML doesn't match expected structure)
- Hallucinated data (agent claims a weight or meal that doesn't match tool output)

**Success criteria:**
- Recommendations align with program state and available content
- Coach commentary references real, fresh data
- CTAs are actionable and timely
- User engages with prompts (response rate as a signal)

These don't need automated evals on day one, but the failure modes should be documented so they can be evaluated as the agent matures.

---

## Agent Framework

Generic infrastructure that the health coach (and every future agent) builds on. Designed from the health coach's concrete requirements, cherry-picking naming conventions and port interface patterns from the [Agents Domain Design](./2026-02-02-agents-domain-design.md).

### Relationship to Existing Infrastructure

**What exists today:**
- `AgentOrchestrator` — registration and invocation
- `IAgentRuntime` / `MastraAdapter` — LLM execution (Mastra SDK)
- `ITool` / `createTool` — tool definition with JSON Schema
- `IMemoryDatastore` — conversation memory port (unused)
- `EchoAgent` — working demo agent
- `AnthropicAdapter` / `OpenAIAdapter` — AI gateway implementations

**What the framework adds:**
- `BaseAgent` — common agent lifecycle (memory, tools, assignments)
- `ToolFactory` — grouped tool creation by domain
- `WorkingMemory` — TTL-based key-value state per agent per user
- `Assignment` — structured multi-step workflows
- `OutputValidator` — JSON Schema validation with LLM retry
- `Scheduler` — cron-based assignment triggering

### File Layout

```
backend/src/
  0_system/
    bootstrap.mjs                          ← wires everything

  1_adapters/
    agents/
      MastraAdapter.mjs                    ← existing (IAgentRuntime)
      YamlWorkingMemoryAdapter.mjs         ← NEW (memory persistence)
    ai/
      AnthropicAdapter.mjs                 ← existing
      OpenAIAdapter.mjs                    ← existing

  3_applications/
    agents/
      AgentOrchestrator.mjs                ← existing, extended for assignments
      framework/
        BaseAgent.mjs                      ← agent lifecycle
        ToolFactory.mjs                    ← grouped tool creation
        WorkingMemory.mjs                  ← WorkingMemoryState (in-memory state)
        Assignment.mjs                     ← structured workflow base
        OutputValidator.mjs                ← schema validation + retry
        Scheduler.mjs                      ← cron-based triggering
        ports/
          IWorkingMemory.mjs               ← memory persistence port
      ports/
        IAgentRuntime.mjs                  ← existing
        ITool.mjs                          ← existing

      echo/                                ← existing demo agent
      health-coach/                        ← first real consumer
        HealthCoachAgent.mjs
        assignments/
          DailyDashboard.mjs
        tools/
          HealthToolFactory.mjs
          FitnessContentToolFactory.mjs
        prompts/
          system.mjs
          daily-dashboard.mjs

  4_api/
    v1/routers/
      agents.mjs                           ← extended with assignment endpoints

data/
  household/users/{userId}/
    agents/health-coach/
      working-memory.yml                   ← persisted memory
    health-dashboard/
      2026-02-14.yml                       ← agent-written dashboard output
```

### BaseAgent

Common agent lifecycle — handles memory load/save, tool factory aggregation, and assignment dispatch. Subclasses define behavior; the base class controls the lifecycle.

```javascript
// 3_applications/agents/framework/BaseAgent.mjs

export class BaseAgent {
  static id;           // subclass sets: 'health-coach'
  static description;  // subclass sets: 'Health coaching and fitness dashboard'

  #agentRuntime;
  #workingMemory;
  #logger;
  #toolFactories = [];
  #assignments = new Map();

  constructor({ agentRuntime, workingMemory, logger }) {
    this.#agentRuntime = agentRuntime;
    this.#workingMemory = workingMemory;
    this.#logger = logger;
  }

  // --- Subclass contract ---
  getSystemPrompt()     { throw new Error('Subclass must implement'); }
  registerTools()       { throw new Error('Subclass must implement'); }
  registerAssignments() { return []; }

  // --- Tool factories ---
  addToolFactory(factory) { this.#toolFactories.push(factory); }

  getTools() {
    return this.#toolFactories.flatMap(f => f.createTools());
  }

  // --- Freeform run (chat-style) ---
  async run(input, { userId, context = {} } = {}) {
    const memory = userId
      ? await this.#workingMemory.load(this.constructor.id, userId)
      : null;

    const result = await this.#agentRuntime.execute({
      agent: this,
      input,
      tools: this.getTools(),
      systemPrompt: this.#assemblePrompt(memory),
      context: { ...context, userId, memory }
    });

    if (memory) {
      await this.#workingMemory.save(this.constructor.id, userId, memory);
    }
    return result;
  }

  // --- Assignment run (structured workflow) ---
  async runAssignment(assignmentId, { userId, context = {} } = {}) {
    const assignment = this.#assignments.get(assignmentId);
    if (!assignment) throw new Error(`Unknown assignment: ${assignmentId}`);

    return assignment.execute({
      agentRuntime: this.#agentRuntime,
      workingMemory: this.#workingMemory,
      tools: this.getTools(),
      systemPrompt: this.getSystemPrompt(),
      agentId: this.constructor.id,
      userId,
      context,
      logger: this.#logger
    });
  }

  registerAssignment(assignment) {
    this.#assignments.set(assignment.id, assignment);
  }

  getAssignments() {
    return [...this.#assignments.values()];
  }

  #assemblePrompt(memory) {
    const base = this.getSystemPrompt();
    if (!memory) return base;
    return `${base}\n\n## Working Memory\n${memory.serialize()}`;
  }
}
```

**Key split:** Freeform `run()` is for chat-style interaction (future interactive coaching). `runAssignment()` delegates to an Assignment object that controls the multi-step workflow. Both share the same tools, memory, and system prompt.

### ToolFactory

Groups related tools by domain and wires them to the services they wrap. Each factory receives domain dependencies at construction and produces `ITool[]`.

```javascript
// 3_applications/agents/framework/ToolFactory.mjs

export class ToolFactory {
  static domain;  // subclass sets: 'health', 'fitness-content'

  constructor(deps) {
    this.deps = deps;
  }

  createTools() {
    throw new Error('Subclass must implement');
  }
}
```

**Concrete example — HealthToolFactory:**

```javascript
// 3_applications/agents/health-coach/tools/HealthToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class HealthToolFactory extends ToolFactory {
  static domain = 'health';

  createTools() {
    const { weightService, nutritionService, workoutService } = this.deps;

    return [
      createTool({
        name: 'get_weight_trend',
        description: 'Current weight, body fat %, lean mass, 7-day trend',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            days: { type: 'number', description: 'Lookback window', default: 7 }
          },
          required: ['userId']
        },
        execute: async ({ userId, days }) => weightService.getTrend(userId, days)
      }),
      // ... get_today_nutrition, get_nutrition_history, get_recent_workouts
    ];
  }
}
```

**Wiring pattern:** Domain services are injected at bootstrap → ToolFactory closes over them → tools call service methods. The agent never touches services directly. Tools are the agent's only interface to the outside world, enforcing granular access control ([Principle #6](#6-granular-access-control)).

`userId` flows as a tool parameter, not implicit context. This keeps tools pure and testable and future-proofs for multi-user ([Stress Test #10](#10-low-multi-user-debt)).

### WorkingMemory

Single key-value store with optional TTL per entry. Separates in-memory state (`WorkingMemoryState`) from persistence (`IWorkingMemory` port).

```javascript
// 3_applications/agents/framework/WorkingMemory.mjs

export class WorkingMemoryState {
  #entries = new Map();  // key → { value, createdAt, expiresAt? }

  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      this.#entries.delete(key);  // lazy prune
      return undefined;
    }
    return entry.value;
  }

  set(key, value, { ttl } = {}) {
    this.#entries.set(key, {
      value,
      createdAt: Date.now(),
      expiresAt: ttl ? Date.now() + ttl : null
    });
  }

  remove(key) {
    this.#entries.delete(key);
  }

  getAll() {
    this.#pruneExpired();
    return Object.fromEntries(
      [...this.#entries.entries()].map(([k, v]) => [k, v.value])
    );
  }

  serialize() {
    this.#pruneExpired();
    if (!this.#entries.size) return '(empty)';

    const persistent = [];
    const expiring = [];

    for (const [key, entry] of this.#entries) {
      const line = `- **${key}**: ${JSON.stringify(entry.value)}`;
      if (entry.expiresAt) expiring.push(line);
      else persistent.push(line);
    }

    const sections = [];
    if (persistent.length) sections.push('### Persistent\n' + persistent.join('\n'));
    if (expiring.length) sections.push('### Expiring\n' + expiring.join('\n'));
    return sections.join('\n\n');
  }

  pruneExpired() { this.#pruneExpired(); }

  #pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt && now >= entry.expiresAt) this.#entries.delete(key);
    }
  }

  // --- Serialization for persistence ---
  toJSON() {
    this.#pruneExpired();
    return Object.fromEntries(
      [...this.#entries.entries()].map(([k, v]) => [k, v])
    );
  }

  static fromJSON(data) {
    const state = new WorkingMemoryState();
    for (const [key, entry] of Object.entries(data)) {
      state.#entries.set(key, entry);
    }
    return state;
  }
}
```

**Port interface:**

```javascript
// 3_applications/agents/framework/ports/IWorkingMemory.mjs

// load(agentId, userId) → WorkingMemoryState
// save(agentId, userId, state) → void

export function isWorkingMemoryStore(obj) {
  return obj && typeof obj.load === 'function' && typeof obj.save === 'function';
}
```

**Persistence adapter:**

```javascript
// 1_adapters/agents/YamlWorkingMemoryAdapter.mjs

// Storage path: data/household/users/{userId}/agents/{agentId}/working-memory.yml
// On load: reads YAML → WorkingMemoryState.fromJSON() → prunes expired
// On save: WorkingMemoryState.toJSON() → writes YAML
```

**What the LLM sees** — `serialize()` produces compact markdown injected into the system prompt:

```
## Working Memory

### Persistent
- **coaching_style**: "responds well to direct feedback, prefers data over motivation"
- **onboarding_complete**: true

### Expiring
- **missed_workouts**: "skipped 2 sessions this week"
- **pending_followup**: "asked about energy levels, awaiting voice memo"
```

### Assignment

A structured multi-step workflow — the alternative to letting the LLM freestyle in a loop. Follows a template method pattern with defined phases: gather → prompt → reason → validate → act.

```javascript
// 3_applications/agents/framework/Assignment.mjs

export class Assignment {
  static id;           // 'daily-dashboard'
  static description;  // 'Prepare today's fitness dashboard'
  static schedule;     // '0 4 * * *' (cron expression, used by Scheduler)

  async execute({ agentRuntime, workingMemory, tools, systemPrompt,
                  agentId, userId, context, logger }) {
    // 1. Load memory (framework)
    const memory = await workingMemory.load(agentId, userId);
    memory.pruneExpired();

    // 2. Gather — programmatic data collection (subclass)
    const gathered = await this.gather({ tools, userId, memory, logger });

    // 3. Build prompt — combine gathered data + memory into LLM input (subclass)
    const prompt = this.buildPrompt(gathered, memory);

    // 4. Reason — LLM call, may use tools ad-hoc (framework)
    const raw = await agentRuntime.execute({
      input: prompt,
      tools,
      systemPrompt,
      context: { userId, ...context }
    });

    // 5. Validate — check structured output against schema (framework + subclass)
    const validated = await this.validate(raw, gathered, logger);

    // 6. Act — write output, update memory, log notes (subclass)
    await this.act(validated, { memory, userId, logger });

    // 7. Save memory (framework)
    await workingMemory.save(agentId, userId, memory);

    logger.info?.('assignment.complete', {
      agentId, assignmentId: this.constructor.id, userId
    });
    return validated;
  }

  // --- Subclass contract ---
  async gather(deps)                    { throw new Error('implement'); }
  buildPrompt(gathered, memory)         { throw new Error('implement'); }
  getOutputSchema()                     { throw new Error('implement'); }
  async validate(raw, gathered, logger) { throw new Error('implement'); }
  async act(validated, deps)            { throw new Error('implement'); }
}
```

**Phase responsibilities:**

| Phase | Who | Purpose |
|-------|-----|---------|
| **gather** | Subclass | Call tools/services programmatically. No LLM — just data collection. |
| **buildPrompt** | Subclass | Context engineering — assemble gathered data + memory into focused LLM input. |
| **reason** | Framework | LLM call with system prompt + tools. May make ad-hoc tool calls. |
| **validate** | Framework + Subclass | `OutputValidator` checks structure; subclass checks domain constraints. |
| **act** | Subclass | Write validated output, update memory, log notes. |

**Key design principle:** Gather is deterministic, reason is probabilistic. We don't trust the LLM to decide what data to fetch — we fetch it programmatically. But we trust the LLM to reason about what to present and how to frame coaching commentary.

The `tools` object in the gather phase calls tool execute functions directly (not via the LLM). During the reason phase, the LLM can still call tools through normal tool-calling flow for ad-hoc needs.

**Health coach's DailyDashboard assignment:**

```javascript
// 3_applications/agents/health-coach/assignments/DailyDashboard.mjs

export class DailyDashboard extends Assignment {
  static id = 'daily-dashboard';
  static description = 'Prepare today\'s fitness dashboard';
  static schedule = '0 4 * * *';

  async gather({ tools, userId }) {
    const [weight, nutrition, workouts, content, programState] = await Promise.all([
      tools.call('get_weight_trend', { userId, days: 7 }),
      tools.call('get_today_nutrition', { userId }),
      tools.call('get_recent_workouts', { userId }),
      tools.call('get_fitness_content', { userId }),
      tools.call('get_program_state', { userId })
    ]);
    return { weight, nutrition, workouts, content, programState };
  }

  buildPrompt(gathered, memory) {
    return `## Today's Data\n${JSON.stringify(gathered, null, 2)}` +
           `\n\n## Working Memory\n${memory.serialize()}` +
           `\n\nProduce the dashboard YAML. Select content IDs only from the provided catalog.`;
  }

  getOutputSchema() { return dashboardSchema; }

  async validate(raw, gathered, logger) {
    const result = await OutputValidator.validateWithRetry(raw, this.getOutputSchema(), { ... });
    if (!result.valid) throw new Error('Output failed validation after retries');
    // Domain check: every content_id exists in gathered.content
    return result.data;
  }

  async act(validated, { memory, userId, logger }) {
    // Write dashboard YAML to per-user datastore
    // Update memory with new observations
    // Log coaching notes
  }
}
```

### OutputValidator

Schema validation with LLM self-correction. Sits between the reason and act phases.

```javascript
// 3_applications/agents/framework/OutputValidator.mjs

import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

export class OutputValidator {

  static validate(output, schema) {
    let parsed;
    try {
      parsed = typeof output === 'string' ? JSON.parse(output) : output;
    } catch (e) {
      return {
        valid: false, data: null,
        errors: [{ message: 'Output is not valid JSON', raw: output }]
      };
    }

    const validate = ajv.compile(schema);
    const valid = validate(parsed);
    return { valid, data: valid ? parsed : null, errors: valid ? [] : validate.errors };
  }

  static async validateWithRetry(output, schema,
    { agentRuntime, systemPrompt, tools, maxRetries = 2, logger }) {
    let result = OutputValidator.validate(output, schema);
    let attempts = 0;

    while (!result.valid && attempts < maxRetries) {
      attempts++;
      logger?.warn?.('output.validation.retry', { attempt: attempts, errors: result.errors });

      const correctionPrompt =
        `Your previous output failed validation.\n\n` +
        `## Errors\n${JSON.stringify(result.errors, null, 2)}\n\n` +
        `## Your Previous Output\n${JSON.stringify(output)}\n\n` +
        `Fix the errors and return valid output.`;

      const retryResult = await agentRuntime.execute({
        input: correctionPrompt, tools, systemPrompt
      });

      output = retryResult.output;
      result = OutputValidator.validate(output, schema);
    }

    return result;
  }
}
```

Domain validation (e.g., "every content_id exists in the gathered catalog") stays in the assignment's `validate()` method. OutputValidator handles structural correctness. The retry loop feeds validation errors back into context ([Principle #7](#7-feed-errors-into-context)).

### Scheduler

In-process cron that triggers assignments on their configured schedules.

```javascript
// 3_applications/agents/framework/Scheduler.mjs

import cron from 'node-cron';

export class Scheduler {
  #jobs = new Map();
  #logger;

  constructor({ logger }) {
    this.#logger = logger;
  }

  registerAgent(agent, orchestrator) {
    const assignments = agent.getAssignments?.() || [];

    for (const assignment of assignments) {
      if (!assignment.constructor.schedule) continue;

      const jobKey = `${agent.constructor.id}:${assignment.constructor.id}`;
      const cronExpr = assignment.constructor.schedule;

      if (!cron.validate(cronExpr)) {
        this.#logger.error?.('scheduler.invalid_cron', { jobKey, cronExpr });
        continue;
      }

      const job = cron.schedule(cronExpr, async () => {
        this.#logger.info?.('scheduler.trigger', { jobKey });
        try {
          await orchestrator.runAssignment(
            agent.constructor.id,
            assignment.constructor.id,
            { triggeredBy: 'scheduler' }
          );
        } catch (err) {
          this.#logger.error?.('scheduler.failed', { jobKey, error: err.message });
        }
      });

      this.#jobs.set(jobKey, job);
      this.#logger.info?.('scheduler.registered', { jobKey, cronExpr });
    }
  }

  async trigger(jobKey, orchestrator) {
    const [agentId, assignmentId] = jobKey.split(':');
    return orchestrator.runAssignment(agentId, assignmentId, { triggeredBy: 'manual' });
  }

  stop() {
    for (const job of this.#jobs.values()) job.stop();
    this.#jobs.clear();
  }

  list() { return [...this.#jobs.keys()]; }
}
```

Multi-user: the scheduler triggers the assignment once. The assignment itself decides which users to run for — it can query a user list and loop, or the orchestrator can fan out. User awareness stays out of the scheduler.

### API Surface

```
GET    /api/agents                                          → list agents
POST   /api/agents/:agentId/run                             → freeform chat
POST   /api/agents/:agentId/run-background                  → async freeform
GET    /api/agents/:agentId/assignments                     → list assignments + schedules
POST   /api/agents/:agentId/assignments/:assignmentId/run   → manual trigger
```

### End-to-End Flow: Daily Dashboard

```
 4:00 AM
    │
    ▼
 Scheduler (node-cron fires)
    │
    ▼
 AgentOrchestrator.runAssignment('health-coach', 'daily-dashboard')
    │
    ▼
 HealthCoachAgent.runAssignment('daily-dashboard', { userId })
    │
    ▼
 DailyDashboard.execute()
    │
    ├─ 1. LOAD      workingMemory.load('health-coach', userId)
    │                → hydrate WorkingMemoryState, prune expired entries
    │
    ├─ 2. GATHER    call tools programmatically (no LLM)
    │                → get_weight_trend      → { weight: 182.3, trend: -1.2, ... }
    │                → get_today_nutrition   → { calories: 2100, protein: 140, ... }
    │                → get_recent_workouts   → [ { title: "Chest & Back", ... } ]
    │                → get_fitness_content   → [ { id: "plex:12345", ... }, ... ]
    │                → get_program_state     → { program: "p90x", day: 23, ... }
    │
    ├─ 3. PROMPT    buildPrompt(gathered, memory)
    │                → compact JSON of gathered data
    │                → serialized working memory
    │                → "Produce dashboard YAML. Select only from provided content IDs."
    │
    ├─ 4. REASON    agentRuntime.execute(prompt + systemPrompt + tools)
    │                → LLM produces structured dashboard output
    │                → may call tools ad-hoc for additional context
    │
    ├─ 5. VALIDATE  OutputValidator.validateWithRetry(output, schema)
    │                → JSON Schema check (structure)
    │                → domain check (content IDs exist in gathered catalog)
    │                → on failure: feed errors back to LLM, retry up to 2x
    │
    ├─ 6. ACT       write dashboard YAML to per-user datastore
    │                → memory.set('last_recommendation', 'Shoulders & Arms', { ttl: 86400000 })
    │                → memory.set('missed_meals_flagged', true, { ttl: 172800000 })
    │                → log coaching notes
    │
    └─ 7. SAVE      workingMemory.save('health-coach', userId, memory)
                     → YAML to data/household/users/{userId}/agents/health-coach/working-memory.yml
```

### Bootstrap Wiring

```javascript
// 0_system/bootstrap.mjs

import { MastraAdapter } from '../1_adapters/agents/MastraAdapter.mjs';
import { YamlWorkingMemoryAdapter } from '../1_adapters/agents/YamlWorkingMemoryAdapter.mjs';
import { AgentOrchestrator } from '../3_applications/agents/AgentOrchestrator.mjs';
import { Scheduler } from '../3_applications/agents/framework/Scheduler.mjs';
import { HealthCoachAgent } from '../3_applications/agents/health-coach/HealthCoachAgent.mjs';

export function createAgentsApiRouter(config) {
  const { logger, weightService, nutritionService,
          workoutService, plexService, programStateStore,
          dashboardStore, dataService } = config;

  const agentRuntime = new MastraAdapter({ logger });
  const workingMemory = new YamlWorkingMemoryAdapter({ dataService, logger });
  const orchestrator = new AgentOrchestrator({ agentRuntime, logger });
  const scheduler = new Scheduler({ logger });

  orchestrator.register(HealthCoachAgent, {
    workingMemory,
    weightService,
    nutritionService,
    workoutService,
    plexService,
    programStateStore,
    dashboardStore
  });

  for (const agent of orchestrator.listInstances()) {
    scheduler.registerAgent(agent, orchestrator);
  }

  return createAgentsRouter({ orchestrator, scheduler, logger });
}
```

---

## Implementation Phases

### Phase 1: Agent Framework (generic infrastructure)

- [ ] `BaseAgent` — lifecycle, tool factory aggregation, memory integration, assignment dispatch
- [ ] `ToolFactory` — base class for grouped tool creation
- [ ] `WorkingMemoryState` — in-memory key-value store with TTL-based expiry
- [ ] `IWorkingMemory` port — load/save interface for memory persistence
- [ ] `YamlWorkingMemoryAdapter` — YAML file persistence for working memory
- [ ] `Assignment` — template method base class (gather → prompt → reason → validate → act)
- [ ] `OutputValidator` — JSON Schema validation with LLM retry loop
- [ ] `Scheduler` — node-cron wrapper for scheduled assignment triggering
- [ ] `AgentOrchestrator` extension — `runAssignment()` method, `listInstances()`
- [ ] Assignment API endpoints — `GET /assignments`, `POST /assignments/:id/run`
- [ ] Unit tests for all framework components

### Phase 2: Health Coach Agent (first consumer)

- [ ] `HealthCoachAgent` — extends BaseAgent, registers tool factories and assignments
- [ ] `HealthToolFactory` — weight, nutrition, workouts, health summary tools
- [ ] `FitnessContentToolFactory` — Plex program browsing, program state read/write
- [ ] Dashboard write tool — structured YAML to per-user datastore
- [ ] `DailyDashboard` assignment — gather/prompt/validate/act implementation
- [ ] Dashboard output JSON Schema definition
- [ ] System prompt and daily-dashboard prompt
- [ ] Agent registration in bootstrap with dependency wiring
- [ ] Scheduler registration for daily-dashboard (`0 4 * * *`)
- [ ] Dashboard API endpoint — `GET /api/v1/health-dashboard/{userId}/{date}`
- [ ] Fallback behavior when no dashboard file exists
- [ ] Integration tests — manual trigger produces valid dashboard YAML

### Phase 3: Dashboard Frontend

- [ ] HomeApp plugin redesign — widget-based layout
- [ ] State widgets pulling live data (weight trend, nutrition snapshot, recent workouts, body composition)
- [ ] Curated content widgets reading from dashboard datastore (Up Next card, alternates)
- [ ] Playlist builder UI — add/remove/reorder, hand off to fitness player
- [ ] Coach widgets reading from dashboard datastore (briefing, CTAs, prompts)

### Phase 4: Program Awareness

- [ ] Program state data model and persistence
- [ ] Inference function (detect program patterns from recent workout history)
- [ ] Explicit declaration flow (user declares "starting P90X Monday")
- [ ] Agent-prompted confirmation ("Looks like you're doing P90X — confirm?")
- [ ] Hybrid/mix-and-match flexibility — substitutions, ad-hoc days
- [ ] Program context in Up Next recommendations

### Phase 5: Interactive Coaching

- [ ] Voice memo prompt widget — record response, transcribe, feed to agent memory
- [ ] Multiple-choice response widget — tap answers, store in agent memory
- [ ] Goal-setting onboarding flow (triggered when no goals exist)
- [ ] Agent incorporates new input on next assignment run
- [ ] Future: real-time chat interaction with the coach

### Phase 6: Multi-User

- [ ] Per-user dashboard datastore and agent memory
- [ ] User context switching on shared screen
- [ ] Parallel agent instances per household member
- [ ] Onboarding flow per user

---

## Relationship to Other Designs

| Design | Relationship |
|--------|-------------|
| [Agents Domain Design](./2026-02-02-agents-domain-design.md) | Cherry-picked — naming conventions and port interface patterns; framework designed bottom-up from health coach requirements |
| [Health Coach Design](./2026-02-02-health-coach-design.md) | **Superseded** — this design incorporates and expands the conversational coaching into a full dashboard + agent system |
| Fitness App (existing) | The HomeApp plugin within the fitness plugin system becomes the dashboard |

---

## Design Review — Stress Test (2026-02-14)

Pre-implementation review of the design against existing codebase state and architectural assumptions.

### 1. CRITICAL: Screen Framework Blind Spot

The design describes a "widget-based HomeApp plugin" but ignores the `screen-framework` that already exists for exactly this purpose. The screen framework provides config-driven layout (GridLayout), WidgetWrapper, DataManager, ActionBus, and a widget registry — all operational (Phase 2 complete). The design proposes building a bespoke widget dashboard from scratch inside HomeApp instead of using this existing infrastructure.

**Resolution required:** The fitness dashboard should be a `ScreenRenderer` embedded inside the HomeApp plugin, loading a `fitness-home.yml` screen config. State widgets become registered screen-framework widgets. Curated and coach widgets become new widget types in the registry.

**Implication:** DataManager currently fetches from APIs. Curated/coach content comes from agent-written dashboard YAML. Either extend DataManager with a new source type, or create widgets that fetch from the dashboard endpoint directly. Small extension, not a redesign.

**Additionally:** The screen framework should be validated as embeddable within larger apps (not just standalone screens). The fitness HomeApp is the proof-of-concept for this pattern — if it works here, it works for any app that wants a widget dashboard as one of its views.

### 2. HIGH: Agent Infrastructure Doesn't Exist Yet

The design says "extends BaseAgent" and references ToolFactory, IMemory, IWorkflow — none of these exist. Only `AgentOrchestrator`, `ITool`, `IAgentRuntime`, and `MastraAdapter` are implemented. The only working agent is `EchoAgent` with inline tools.

**Resolution required:** Split Phase 1 explicitly into:
1. General agent infrastructure (BaseAgent, ToolFactory, IMemory) — affects all future agents
2. Health coach agent built on that infrastructure

Decide: should health coach be the first consumer of general infrastructure (build generic first), or should it be built pragmatically (inline tools, simple file-based memory) and generalized later?

### 3. HIGH: Half-Life Memory Decay is Overengineered for v1

Category-based half-life decay adds significant complexity: decay functions on every read, creation timestamps, category metadata, arbitrary decay curves (2 days, 1 week, 2 weeks, 1 month) that can't be validated until the agent has run for months.

**Simpler v1 alternative:** TTL-based expiry — memory entries get an explicit `expires_at` field set at write time. The agent decides how long a memory should live when it writes it. No category taxonomy, no decay curves, no infrastructure.

**Resolution:** Use TTL-based expiry for v1. Keep half-life decay as a v2 evolution once usage patterns are understood.

### 4. HIGH: Dashboard Staleness Has UX Consequences

The dashboard is generated once per morning. Specific broken scenarios:

- User completes recommended workout at 7am → "Up Next" still shows same workout all day
- User logs meals at 10am → "No meals logged" CTA persists until tomorrow
- User steps on scale at noon → state widget shows fresh data, but coach briefing references yesterday's weight

**Resolution:** Add a `consumed`/`stale` mechanism. When the fitness player completes a session matching `up_next.primary.content_id`, the frontend marks it consumed and hides the card. CTAs that reference data gaps should check live data before rendering.

### 5. MEDIUM: Structured Output Reliability

LLMs generating the dashboard YAML schema will hallucinate content IDs, invent nonexistent Plex items, and produce schema violations. The design mentions "JSON Schema validation" but doesn't specify failure handling.

**Resolution required:**
- `get_fitness_content` tool returns a constrained list of options with valid content IDs — the agent selects from a menu, not free-text
- `write_dashboard` tool validates content IDs against the catalog before writing
- Define retry strategy and fallback behavior (retry? yesterday's dashboard? empty dashboard?)

### 6. MEDIUM: Memory vs Tool Authority Unclear

"Memorize interpretations, look up facts" creates tension:
- Program state: is "Day 23 of P90X" an interpretation or a fact? It's in both long-term memory AND the `get_program_state` tool. Which is authoritative?
- Goals: facts (user declared them) or interpretations?

**Resolution:** Program state and goals are tool-owned (read/write via tools), not memory. Memory holds only things that can't be looked up — coaching strategy, sentiment observations, follow-up tracking.

### 7. MEDIUM: Phase Ordering Has Hidden Dependencies

State widgets don't need the agent — they pull from existing live APIs and could ship immediately as screen-framework widgets. Curated content widgets could be prototyped with hand-crafted dashboard YAML. The screen framework integration is orthogonal to agent work.

**Suggested reordering:**
1. Screen framework integration into HomeApp (`fitness-home.yml` config)
2. State widgets as screen-framework widgets (weight, nutrition, workouts)
3. Dashboard datastore + API endpoint (serving hand-crafted YAML initially)
4. Curated/coach widget types reading from dashboard datastore
5. Agent foundation + health coach agent
6. Agent writes to dashboard datastore (connecting the pipeline)

This gets visible UX value shipped earlier.

### 8. MEDIUM: Program Inference is Hand-Wavy

"The agent notices the user has done P90X episodes 1, 2, 3, 4, 5 on consecutive days" requires mapping Plex content IDs to program episodes, understanding episode ordering, detecting consecutive patterns, and handling partial/re-watches. Plex doesn't inherently structure fitness programs as "Day 1, Day 2, Day 3" — P90X has episodes like "Chest & Back," "Plyometrics," etc. Mapping these to a 90-day calendar requires external knowledge.

**Resolution:** Drop inference for v1. Support only explicit declaration ("I'm starting P90X Monday") and manual position updates. Inference requires a program schedule database (lookup table mapping programs to day-by-day schedules) — that's a v2 feature.

### 9. MEDIUM: Cost and Latency Unaddressed

The daily assignment runs an LLM with a substantial system prompt, growing working memory, 6+ tool calls, and structured output generation. No model selection, token budget, expected cost per user per day, or latency expectations are specified.

**Resolution required:** Add a "Model Selection & Budget" section. Consider whether a smaller model suffices for structured parts (selecting content, validating data) while a larger model handles coaching commentary. Define per-run token budget and multi-user cost projection.

### 10. LOW: Multi-User Debt

Phase 6 defers multi-user, but Phase 1-3 decisions create debt. The existing health APIs don't appear to take a `userId` parameter. Dashboard datastore paths use `{userId}` but the default user context is implicit.

**Resolution:** Use `userId` from day 1 in all datastores and APIs, even with one user.

### 11. LOW: DEXA Data Source Unspecified

"Most recent DEXA scan results" — no data source specified. DEXA scans are infrequent, from external facilities, producing PDF reports. Options: manual entry form, PDF parsing, or a simple YAML file.

**Resolution:** Specify or explicitly defer.

### 12. LOW: Voice Memo Integration Underspecified

Phase 5 includes voice memo prompts but doesn't specify: how the agent accesses transcriptions, when/where transcription happens, how memos link to triggering prompts, or latency expectations.

**Resolution:** Flag for separate design doc when Phase 5 approaches.

### Summary Table

| # | Issue | Severity | Resolution |
|---|-------|----------|------------|
| 1 | Screen framework not used | Critical | Redesign dashboard frontend to use ScreenRenderer |
| 2 | Agent infra doesn't exist | High | **Resolved** — Agent Framework section added; Phase 1 builds generic infra, Phase 2 builds health coach on top |
| 3 | Half-life decay overengineered | High | **Resolved** — Replaced with single-store TTL-based expiry; see Working Memory section |
| 4 | Dashboard staleness | High | Add consumed/stale mechanism for completed workouts |
| 5 | Structured output reliability | Medium | Tools return selectable options; validate IDs at tool level |
| 6 | Memory vs tool authority | Medium | Program state and goals are tool-owned, not memory |
| 7 | Phase ordering | Medium | Ship state widgets and screen framework integration first |
| 8 | Program inference | Medium | Drop inference for v1; explicit declaration only |
| 9 | Cost/latency unaddressed | Medium | Add model selection and token budget section |
| 10 | Multi-user debt | Low | Use userId from day 1 |
| 11 | DEXA source unspecified | Low | Specify or defer explicitly |
| 12 | Voice memo underspecified | Low | Flag for separate design doc |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-14 | Initial design — supersedes 2026-02-02 health coach design |
| 2026-02-14 | Added design review stress test — 12 issues identified, resolutions proposed |
| 2026-02-14 | Added Agent Framework section — BaseAgent, ToolFactory, WorkingMemory, Assignment, OutputValidator, Scheduler |
| 2026-02-14 | Revised memory model — single store with optional TTL replaces two-tier half-life decay |
| 2026-02-14 | Revised implementation phases — framework-first (generic infra Phase 1, health coach Phase 2) |
| 2026-02-14 | Resolved stress test issues #2 (agent infra) and #3 (memory overengineering) |
