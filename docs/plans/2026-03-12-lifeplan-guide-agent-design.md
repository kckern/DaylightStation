# Lifeplan Guide Agent — Design

**Date:** 2026-03-12
**Status:** Approved

---

## Overview

A single `LifeplanGuideAgent` that acts as a personal life coach. Extends `BaseAgent`, uses MastraAdapter (model config-driven, default `openai/gpt-4o`), with shared working memory across all interactions.

Three modes of operation:
- **Scheduled assignment** (`CadenceCheck`) — runs at unit cadence interval, checks what's due, nudges with inline action buttons
- **Guided conversations** — user-triggered dialogue for onboarding, ceremonies, coaching
- **Ad-hoc chat** — freeform "ask my life coach" via `run()`

All plan mutations are **propose-then-confirm** — agent suggests with data-backed reasoning, user approves via button, tool executes.

---

## 1. Agent Core & Working Memory

### Identity

- Class: `LifeplanGuideAgent extends BaseAgent`
- ID: `lifeplan-guide`
- Single agent identity — the user's life coach
- Registered in `AgentOrchestrator` at bootstrap

### Working Memory Structure

| Key | Purpose | TTL |
|-----|---------|-----|
| `user_profile` | Coaching style prefs (directness, nudge frequency, challenge level), communication patterns | Persistent |
| `session_state` | Current flow (onboarding/ceremony/coaching), step index, partial responses | Expires after 7 days |
| `interaction_history` | Summarized takeaways from past conversations | Persistent |
| `agent_feedback` | Rolling log of user ratings on suggestions | Persistent |
| `trust_level` | Progressive metric (interaction count, feedback scores, plan completeness) | Persistent |

### Trust-Gated Behavior

| Trust Level | Threshold | Behavior |
|-------------|-----------|----------|
| New | 0-5 interactions | Structured questions, explain everything, conservative suggestions |
| Building | 5-20 interactions | More natural conversation, references past sessions, bolder suggestions |
| Established | 20+ interactions | Challenges assumptions, connects patterns across time, proactive insights |

Trust score increments on completed interactions, weighted by user feedback ratings.

---

## 2. Tool Factories

### PlanToolFactory

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `get_plan` | `username` | Read full plan state |
| `propose_goal_transition` | `goalId, newState, reasoning` | Suggest state change with explanation |
| `propose_add_belief` | `belief, reasoning` | Suggest new belief with evidence |
| `propose_reorder_values` | `newOrder, reasoning` | Suggest value rank changes |
| `propose_add_evidence` | `beliefId, evidence, reasoning` | Suggest evidence for a belief |
| `record_feedback` | `username, observation` | Record an observation (direct, no confirmation needed) |

All `propose_*` tools return:
```json
{
  "change": { "what changes" },
  "reasoning": "data-backed explanation",
  "confidence": 0.85
}
```
Frontend renders as confirmation cards with Accept / Modify / Dismiss buttons.

### LifelogToolFactory

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `query_lifelog_range` | `username, start, end` | Get lifelog data for date range |
| `get_available_sources` | | List active lifelog sources |
| `get_metrics_snapshot` | `username` | Latest drift/metrics data |
| `get_value_allocation` | `username` | Time allocation by value |

### CeremonyToolFactory

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `get_ceremony_content` | `type, username` | Load ceremony context (goals, drift, evidence) |
| `complete_ceremony` | `type, username, responses` | Record ceremony completion |
| `check_ceremony_status` | `username` | Which ceremonies are due/overdue/completed |
| `get_ceremony_history` | `username, type?` | Past ceremony records |

### NotificationToolFactory

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `send_action_message` | `username, message, actions[]` | Push nudge with inline action buttons |

### CoachingToolFactory

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `get_conversation_history` | `username, limit?` | Recent conversation threads |
| `save_session_state` | `flow, step, partialResponses` | Persist resumable flow state |
| `resume_session` | `username` | Load active session state |
| `log_agent_feedback` | `username, rating, context` | Record user's feedback on agent |
| `get_user_preferences` | `username` | Load coaching style prefs |
| `update_user_preferences` | `username, prefs` | Save coaching style prefs |

---

## 3. Conversation & Flow Management

### Onboarding Flow

- Triggered on first `run()` when no plan exists
- Agent queries lifelog history first (available sources, recent activity patterns)
- Guided interview: purpose → values → beliefs → first goals
- Each step informed by lifelog data ("I see you've been running 3x/week for months — is fitness a core value?")
- Session state saved after each step, resumable
- Ends by writing the initial plan (with user confirmation at each section)
- Progressive disclosure — simple structured questions early, richer as context builds

### Ceremony Flow

- Triggered by action button from CadenceCheck nudge, or user opens coach chat when ceremony is due
- Agent loads ceremony content from CeremonyService (goal progress, drift, evidence, rule effectiveness)
- Conducts conversation adapted to ceremony type:
  - `unit_intention` / `unit_capture` — quick 2-3 exchanges
  - `cycle_retro` — moderate depth, reviews the cycle
  - `phase_review` / `season_alignment` — deeper dialogue
  - `era_vision` — extended conversation
- References previous ceremony conversations via conversation history
- On completion, calls `complete_ceremony` and summarizes key takeaways to working memory

### Ad-hoc Coaching

- User opens coach chat anytime
- Agent loads: current plan, recent lifelog, working memory (profile, interaction history, trust level)
- Freeform conversation — can surface insights, answer questions, or naturally transition into a due ceremony
- "Was this helpful?" feedback prompt at end of meaningful exchanges

### Resumability

All flows store `session_state` in working memory:
```json
{
  "flow": "ceremony",
  "type": "cycle_retro",
  "step": 3,
  "partial_responses": ["..."],
  "started_at": "2026-03-12T10:00:00Z"
}
```
On reconnect, agent detects active session and offers to resume or start fresh.

---

## 4. Guardrails & Boundaries

### Scope Boundaries (System Prompt)

**In scope:** Life planning, goal tracking, value alignment, habit coaching, ceremony facilitation, lifelog interpretation.

**Out of scope:** Mental health crisis, medical advice, financial advice, relationship counseling.

### Deflection Protocol

When the agent detects out-of-scope territory:
1. Acknowledge the user's concern without dismissing
2. State clearly it's not equipped to help with this
3. Suggest appropriate resources (therapist, doctor, financial advisor)
4. Offer to return to coaching context

### Operational Guardrails

- `propose_*` tools only — never mutates plan without confirmation
- Agent cannot delete goals/beliefs — only propose transition to abandoned state
- Tool call limit from MastraAdapter (default 50, configurable)
- Execution timeout (default 120s)
- Notification rate limiting — max 1 nudge per cadence unit, no spam

---

## 5. Frontend: Generic Chat Module

### Generic Module (`frontend/src/modules/Chat/`)

Reusable by any agent — same pattern as `modules/Player/`.

| Component | Purpose |
|-----------|---------|
| `useChatEngine({ agentId, onAction })` | Hook: message thread, send/receive, action handlers, session resume |
| `ChatThread` | Renders message bubbles, proposal cards, action buttons, feedback prompts |
| `ChatInput` | Text input + send |
| `ChatPanel` | Composable container supporting full, sidebar, popup modes |

### Message Types

| Type | Rendering |
|------|-----------|
| `text` | Plain message bubble |
| `proposal` | Confirmation card with reasoning, Accept/Modify/Dismiss buttons |
| `action` | Inline button group ("Start weekly retro", "Snooze") |
| `feedback` | Thumbs up/down after coaching exchanges |
| `resume` | "You left off mid-ceremony. Resume or start over?" |

### Lifeplan Wrapper (`frontend/src/modules/Life/views/coach/`)

`CoachChat` wraps `ChatPanel` with:
- `agentId: 'lifeplan-guide'`
- Lifeplan-specific action handlers (ceremony start, plan mutation confirmation)
- Plan context injection

Other agents (health coach, etc.) can wrap `ChatPanel` with their own config.

---

## 6. CadenceCheck Assignment

Single scheduled assignment. Runs at the user's configured unit cadence — not hardcoded to daily.

### Assignment Lifecycle

**Gather** (programmatic, no LLM):
- Query CadenceService for current position
- Check each ceremony type: enabled? due? completed? overdue?
- Get latest drift snapshot
- Check for missed ceremonies from previous periods
- Get upcoming milestones within current cycle

**Build Prompt**:
- Only include what's actionable — if nothing is due and no alerts, skip entirely
- Include: due ceremonies, overdue ceremonies (how many periods missed), drift alerts, upcoming milestones

**Reason** (LLM):
- Compose a single contextual message with inline action buttons
- Tone adjusted by trust level and user preferences

**Act**:
- Send via `send_action_message` tool
- Overdue ceremonies emphasized first
- If nothing actionable: assignment completes silently, no notification

---

## 7. Conversation Persistence

Implements `IMemoryDatastore` port (already defined).

### Storage

- Adapter: `YamlConversationStore`
- Path: `data/users/{username}/agents/lifeplan-guide/conversations/`
- One file per conversation session (date-stamped)

### Context Injection

- Agent's system prompt receives last N messages from most recent conversation for continuity
- Older conversations queryable via `get_conversation_history` tool for pattern-finding

### Lifecycle

- Auto-pruning: conversations older than 1 era archived to summary-only

---

## 8. Related Features (Not Part of Agent)

### Ceremony Schedule Feed

- `GET /api/v1/life/schedule/:format` — exposes ceremony schedule as structured data
- Format serializers at API layer: `ical`, `json`, `rss`, `xml`
- Adding a format = adding a serializer, no service changes
- Updated automatically when cadence config changes

---

## File Map (Estimated)

### Backend

```
backend/src/
├── 3_applications/agents/
│   └── lifeplan-guide/
│       ├── LifeplanGuideAgent.mjs
│       ├── assignments/
│       │   └── CadenceCheck.mjs
│       ├── tools/
│       │   ├── PlanToolFactory.mjs
│       │   ├── LifelogToolFactory.mjs
│       │   ├── CeremonyToolFactory.mjs
│       │   ├── NotificationToolFactory.mjs
│       │   └── CoachingToolFactory.mjs
│       ├── prompts/
│       │   └── system.mjs
│       └── schemas/
│           └── proposal.mjs
├── 1_adapters/
│   └── persistence/yaml/
│       └── YamlConversationStore.mjs
└── 4_api/v1/routers/life/
    └── schedule.mjs
```

### Frontend

```
frontend/src/
├── modules/Chat/
│   ├── useChatEngine.js
│   ├── ChatThread.jsx
│   ├── ChatInput.jsx
│   ├── ChatPanel.jsx
│   └── index.js
└── modules/Life/views/coach/
    └── CoachChat.jsx
```

### Tests

```
tests/
├── isolated/agents/lifeplan-guide/
│   ├── tool-factories.test.mjs
│   ├── cadence-check.test.mjs
│   └── guardrails.test.mjs
└── integrated/agents/
    └── lifeplan-guide-flow.test.mjs
```
