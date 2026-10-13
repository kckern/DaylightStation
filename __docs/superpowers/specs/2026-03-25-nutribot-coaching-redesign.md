# Nutribot Coaching Redesign — Spec

## Problem

Nutribot's coaching messages are vapid, repetitive, and disconnected from the data the system already has. Per-accept cheerleading ("Great choice with the kidney beans!") is spam. The bot says "your protein has been consistently low" every day in nearly identical words. It treats 580-calorie days as real data. It never flags missed tracking days. It has no access to weight trends, reconciliation accuracy, or exercise context.

Meanwhile, the reconciliation system already knows the user logs ~53% of actual intake. The Strava webhook knows when exercise happens. The weight data shows trends. None of this reaches the user through the bot.

## Solution

Replace all nutribot coaching use cases with HealthCoachAgent assignments. The agent reasons about what's worth saying using tools that access weight, nutrition, reconciliation, and exercise data. Nutribot becomes a Telegram channel adapter — it still handles food parsing and the accept/revise/discard flow, but all "talking" is delegated to the agent.

## Architecture

```
HealthCoachAgent (existing, gains new assignments + tools)
    │
    ├── DailyDashboard (existing, office screen)
    ├── MorningBrief (new, Telegram via NutribotChannel)
    ├── NoteReview (new, event-triggered on accept)
    ├── EndOfDayReport (new, replaces GenerateDailyReport coaching)
    ├── WeeklyDigest (new, scheduled Sunday)
    └── ExerciseReaction (new, Strava webhook-triggered)
```

### What Changes

| Component | Before | After |
|-----------|--------|-------|
| Per-accept coaching | AI template per accept | Silent ✅ + running total line (deterministic) |
| Threshold coaching | `GenerateThresholdCoaching` use case | `NoteReview` assignment — agent decides if worth saying |
| Report coaching | `GenerateReportCoaching` use case | `EndOfDayReport` assignment — agent has full data context |
| On-demand coaching | `GenerateOnDemandCoaching` use case | Direct agent invocation via `/coach` |
| Morning message | First-of-day AI coaching | `MorningBrief` assignment — reconciliation-aware |
| Weekly summary | None | `WeeklyDigest` assignment — trend analysis |
| Exercise context | None | `ExerciseReaction` assignment — Strava-triggered |

### What Stays the Same

- `NutribotInputRouter` — routes text/image/voice/UPC/callback events
- Food parsing use cases — `LogFoodFromText`, `LogFoodFromImage`, etc.
- Accept/Revise/Discard mechanical flow
- `NutribotContainer` — still provides parsing use cases
- Portion boost calibration in AI prompts

## Deleted Code

These use cases are replaced by agent assignments and must be removed:

- `GenerateThresholdCoaching.mjs`
- `GenerateReportCoaching.mjs`
- `GenerateOnDemandCoaching.mjs`

Their references in `NutribotContainer` are also removed.

## Modified Code (Coaching Removal)

- `GenerateDailyReport.mjs` — Remove `#generateThresholdCoaching` dependency and `#checkAndTriggerCoaching()` method. The report PNG rendering stays; only the coaching trigger is stripped.
- `ConfirmAllPending.mjs` — Same treatment as `AcceptFoodLog`: add running total + agent delegation for coaching after batch confirmation.
- `/coach` command — Currently **dead code** (not wired in `NutribotInputRouter`). Wire it to direct agent invocation: `orchestrator.runAssignment('health-coach', 'note-review', { userId })` via a new `coach` case in `handleCommand()`.

## Tool Naming

- The existing `get_user_goals` tool in `DashboardToolFactory` reads from `agents/health-coach/goals`. The new `get_nutrition_goals` tool is **not needed** — assignments should use `get_user_goals` directly. The goals file should include calorie and protein targets alongside fitness goals.

## New Tools on HealthCoachAgent

The existing `HealthToolFactory` has weight, nutrition, and workout tools. It needs:

| Tool | Purpose | Source |
|------|---------|--------|
| `get_reconciliation_summary` | Tracking accuracy, implied vs tracked, portion multiplier, missed days | `reconciliation.yml` |
| `get_adjusted_nutrition` | Adjusted calories/macros with phantom entries | `nutriday_adjusted.yml` |
| `get_coaching_history` | Past coaching messages to avoid repetition | `health_coaching.yml` (via `healthStore.loadCoachingData`) |
| `send_channel_message` | Push a message to the user's Telegram chat | `TelegramMessagingAdapter` |

The first four are read-only data tools added to a new `ReconciliationToolFactory`. The last one is a channel delivery tool added to a new `MessagingChannelToolFactory`.

## New Assignments

### MorningBrief

- **Schedule:** `0 10 * * *` (10am daily) OR triggered on first log of day
- **Gather:** Yesterday's reconciliation, weight trend (7d), missed day count, tracking accuracy window, nutrition goals
- **Output:** Structured message with yesterday's reconciled summary and today's targets
- **Delivery:** `send_channel_message` tool
- **Act:** Set `last_morning_brief` in working memory (24h TTL)

### NoteReview

- **Trigger:** Event-driven — called from `AcceptFoodLog` after accept
- **Gather:** Today's running total, calorie/protein targets, alerts already sent today (from working memory), exercise context
- **Output:** Either `null` (stay silent) or a structured alert
- **Delivery:** `send_channel_message` tool (only if non-null)
- **Act:** If alert sent, update `alerts_sent_today` in working memory

### EndOfDayReport

- **Trigger:** Event-driven — called when last pending log is accepted (replaces current auto-report coaching)
- **Gather:** Today's raw + adjusted nutrition, reconciliation accuracy, weight trend, exercise summary, coaching history
- **Output:** Structured report data (calories raw vs adjusted, accuracy, color distribution)
- **Delivery:** Report PNG rendering stays (deterministic), agent produces only the coaching commentary text
- **Act:** Save coaching note via `log_coaching_note` tool

### WeeklyDigest

- **Schedule:** `0 19 * * 0` (Sunday 7pm)
- **Gather:** 7-day reconciliation window, weight trend (7d + 14d), accuracy trend, protein avg, missed day count, best/worst days
- **Output:** Structured weekly summary message
- **Delivery:** `send_channel_message` tool
- **Act:** Set `last_weekly_digest` in working memory (7d TTL)

### ExerciseReaction

- **Trigger:** Event-driven — Strava webhook `activity.create` with >200 cal
- **Gather:** Activity details (type, calories, duration, HR), today's nutrition running total, calorie target
- **Output:** Either `null` or post-exercise context message
- **Delivery:** `send_channel_message` tool
- **Act:** Update `exercise_today` in working memory

## Agent System Prompt Update

The existing system prompt must be extended to cover nutrition coaching behavior:

- Never say "great job" or "keep it up"
- Numbers only — no generic food suggestions
- Max 2 alerts per day (check working memory)
- Never repeat advice given in the last 7 days (check coaching history)
- Reference reconciliation data: "You logged X but weight math suggests Y"
- Flag incomplete tracking directly, don't treat low-calorie days as real

## Accept Flow Change

`AcceptFoodLog` currently:
1. Accepts log, syncs to nutrilist
2. Updates message (🕒 → ✅, remove buttons)
3. If no pending: triggers `GenerateDailyReport` (which triggers coaching)

New behavior:
1. Accepts log, syncs to nutrilist
2. Updates message (🕒 → ✅, remove buttons) + **appends running total line**
3. Invokes `NoteReview` assignment on HealthCoachAgent (agent decides whether to speak)
4. If no pending: invokes `EndOfDayReport` assignment (agent produces coaching commentary for report)

## Running Total Line (Deterministic, No Agent)

After accept, the confirmed message gets a line appended:

```
✅ Tue, 25 Mar 2026 afternoon

🟡 Salmon 170g
🟠 Shredded Cheese 40g

↳ 1240 / 1500-2000 cal • 107g protein
```

This is computed from `nutriday.yml` running sum. No AI, no agent.

## Strava Integration Point

In `fitness.mjs` router (or wherever the Strava webhook lands), after processing the activity:

```javascript
if (stravaAdapter.shouldEnrich(event) && activity.calories > 200) {
  orchestrator.runAssignment('health-coach', 'exercise-reaction', {
    userId,
    context: { activity }
  });
}
```

## Working Memory Keys

| Key | TTL | Purpose |
|-----|-----|---------|
| `alerts_sent_today` | 24h | Count + topics of alerts sent, enforce max 2/day |
| `last_alert_topics` | 7d | Prevent repeating same advice |
| `last_morning_brief` | 24h | Prevent duplicate morning messages |
| `last_weekly_digest` | 7d | Prevent duplicate weekly |
| `exercise_today` | 24h | Accumulated exercise context |

## Assignment Delivery Pattern

The base `Assignment.act()` receives `{ memory, userId, logger }` — **not tools**. Assignments cannot call `send_channel_message` from `act()`. Instead, follow the `DailyDashboard` pattern: `HealthCoachAgent.runAssignment()` handles delivery after `execute()` returns. The agent checks the validated output's `should_send` flag and calls the Telegram tool if true.

The base `Assignment.gather()` signature is extended to include `context`: `gather({ tools, userId, memory, logger, context })`. This is a non-breaking framework change that allows event-triggered assignments (ExerciseReaction, NoteReview, EndOfDayReport) to receive trigger context (e.g., activity data, conversation state) without overriding `execute()`.

## DRY Notes

- The system scheduler (`0_system/scheduling/Scheduler.mjs`) and agent scheduler (`3_applications/agents/framework/Scheduler.mjs`) duplicate tick-loop logic. This is pre-existing tech debt — not addressed in this work, but noted.
- Old coaching use cases are **deleted**, not kept as fallbacks. No dual-path coaching.
