# Coaching System Redesign — Template-Driven with LLM Commentary

**Date:** 2026-04-07
**Status:** Draft

## Problem

The current health coaching system generates verbose, repetitive, poorly formatted messages with wrong dates, no time-of-day awareness, and no genuine insight. Messages fire in duplicate. The LLM is asked to compute numbers, format HTML, remember dates, AND generate insight — and fails at all of them.

## Solution

Split coaching into two layers:
1. **Deterministic status block** — code computes all numbers, formats HTML, handles emoji
2. **LLM commentary** — single Mastra `generate()` call with `gpt-4o-mini`, max ~30 words, receives pre-computed data snapshot

If the LLM fails or has nothing to say, the status block sends alone.

## Assignment Structure

| Assignment | Trigger | Purpose |
|---|---|---|
| `post-report` | Inline after `GenerateDailyReport` renders PNG | Situational status: where you are, what's left |
| `morning-brief` | Cron `0 10 * * *` | Yesterday recap, trends, logging gaps |
| `weekly-digest` | Cron `0 19 * * 0` | Longer trend analysis (12-week window) |
| `exercise-reaction` | Strava webhook (>200 cal) | Burned calories as budget context |

**Removed:** `note-review`, `end-of-day-report`, `daily-dashboard` (all collapsed into `post-report` or eliminated).

## Message Format

All messages use Telegram HTML. Structured blocks with emoji anchors. Max ~4 lines for status, plus an optional `<blockquote>` commentary line.

### Post-Report

```html
🔥 <b>850 / 1600 cal</b> (53%)
💪 <b>62 / 120g protein</b> (52%)

<blockquote>That chicken carried the protein — one shake and dinner closes the gap.</blockquote>
```

### Morning Brief

```html
📊 <b>Yesterday:</b> 1626 cal · 94g protein
📉 <b>7-day avg:</b> 1450 cal · 112g protein (target: 120g)
⚖️ <b>Weight:</b> 170.3 lbs (−0.09/wk)

<blockquote>Protein has been short by ~10g/day all week. Yesterday's cheese-heavy dinner was the gap — swap one for a shake and you're there.</blockquote>
```

### Weekly Digest

```html
📊 <b>This week:</b> 1453 avg cal · 112g avg protein
📈 <b>vs 8-wk avg:</b> 1520 cal · 105g protein
⚖️ <b>Weight trend:</b> −0.16 lbs this week · 170.4 → 170.2

<blockquote>Calories are dialed in. Protein crept up from 105→112 but still 8g short. The days you hit 120+ all had a protein shake — the days you didn't, didn't.</blockquote>
```

### Exercise Reaction

```html
🏃 <b>Run:</b> 45 min · 320 cal burned
🔥 <b>Budget update:</b> ~150 extra cal earned

<blockquote>That buys you a snack, not a meal — spend it on something with protein.</blockquote>
```

## Architecture

### CoachingMessageBuilder (new service)

Application-layer service that builds the deterministic status block for each assignment type. Pure functions, no LLM.

- `buildPostReportBlock(nutritionSnapshot)` → HTML string
- `buildMorningBriefBlock(yesterdayData, weekAvg, weightTrend)` → HTML string
- `buildWeeklyDigestBlock(weekData, longTermAvg, weightTrend)` → HTML string
- `buildExerciseReactionBlock(activity, budgetImpact)` → HTML string

### CoachingCommentaryService (new service)

Wraps a single Mastra `generate()` call. Receives pre-computed JSON snapshot, returns commentary string or empty string.

```javascript
const agent = new Agent({
  name: 'health-coach-commentary',
  instructions: SYSTEM_PROMPT,
  model: 'openai/gpt-4o-mini'
});
const { text } = await agent.generate(JSON.stringify(snapshot));
return text?.trim() || '';
```

No tools. No multi-turn. No working memory. If it fails, returns empty string.

### Data Snapshot (passed to LLM)

```json
{
  "type": "post-report",
  "date": "2026-04-07",
  "time_of_day": "afternoon",
  "calories": { "consumed": 850, "goal_min": 1200, "goal_max": 1600, "pct": 53 },
  "protein": { "consumed": 62, "goal": 120, "pct": 52 },
  "notable_items": ["Grilled Chicken (40g protein)", "Caesar Salad"],
  "recent_pattern": "protein_short_3_days",
  "weight_trend_7d": -0.09,
  "recent_coaching": [
    { "type": "morning-brief", "hours_ago": 6, "text": "Protein has been short by ~10g/day..." },
    { "type": "post-report", "hours_ago": 2, "text": "That yogurt got you started..." }
  ]
}
```

- `recent_coaching`: last 4 days of coaching messages with hours_ago for recency
- `notable_items`: top 2-3 items from the current log by protein or calorie contribution
- `recent_pattern`: code-detected pattern flag, one of:
  - `on_track` — within goals for 3+ consecutive days
  - `protein_short` — protein below 80% of goal for 3+ of last 5 days
  - `calorie_surplus` — above goal_max for 2+ of last 3 days
  - `calorie_deficit` — below goal_min for 2+ of last 3 days
  - `missed_logging` — 0 items logged for 1+ of last 3 days
  - `binge_after_deficit` — day >goal_max following 2+ days <goal_min
  - `null` — no notable pattern detected

Snapshot shape varies by assignment type. Morning brief includes yesterday's breakdown and 7-day averages. Weekly digest includes 12-week reconciliation data. Exercise reaction includes activity details and budget math.

## System Prompt

```
You are a nutrition coach providing brief commentary on a user's daily tracking data.

RULES:
- One sentence only. Max 30 words.
- Output raw text, no HTML tags (the caller wraps it in <blockquote>).
- Conversational, direct. Talk like a friend who happens to know your numbers.
- Reference specific foods or items from the data when relevant.
- NEVER repeat an observation from recent_coaching. Find something new or say nothing.
- NEVER use phrases like "great job", "keep it up", "you've got this", "stay consistent".
- NEVER give generic advice like "focus on protein-rich foods" or "ensure consistent tracking".
- If there is genuinely nothing interesting to say, return an empty string.
- Time awareness: if time_of_day is "morning", don't warn about low intake — the day just started.
- The user does not eat breakfast. Do not mention missing breakfast or morning meals.

ASSIGNMENT CONTEXT:
- post-report: Comment on what was just logged. What stands out? Budget status?
- morning-brief: Comment on yesterday or recent trend. What's the story of the past few days?
- weekly-digest: What's the narrative arc of the week? What changed vs prior weeks?
- exercise-reaction: Frame the burned calories as budget. What does it buy?
```

## Deduplication Fix

### Problem

1. Scheduler 30-second tick can fire the same cron assignment twice in one minute
2. AcceptFoodLog fires both `note-review` and `end-of-day-report` separately from the report

### Solution

1. **Scheduler idempotency guard:** Before executing, check working memory for `ran:{assignmentId}:{dateHour}` key. Skip if exists. Write key after execution.

2. **Collapse triggers:** Remove all coaching triggers from `AcceptFoodLog`. Instead, `GenerateDailyReport` calls `post-report` coaching inline after rendering the PNG. This is the single path for post-log coaching.

3. **Two coaching entry paths only:**
   - Scheduler → `morning-brief`, `weekly-digest` (with idempotency guard)
   - `GenerateDailyReport` → `post-report` (once per report, inline)
   - Strava webhook → `exercise-reaction` (existing >200 cal guard)

### Files Modified

- `AcceptFoodLog.mjs` — remove `end-of-day-report` and `note-review` fire-and-forget calls
- `GenerateDailyReport.mjs` — add `post-report` coaching call after PNG render
- `Scheduler.mjs` — add idempotency guard using working memory keys
- `HealthCoachAgent.mjs` — simplify: remove old assignment registrations, add new ones

## Code Organization

### New Files

| File | Layer | Purpose |
|---|---|---|
| `backend/src/3_applications/coaching/CoachingMessageBuilder.mjs` | Application | Deterministic status block builder |
| `backend/src/3_applications/coaching/CoachingCommentaryService.mjs` | Application | Mastra generate() wrapper for LLM commentary |
| `backend/src/3_applications/coaching/CoachingOrchestrator.mjs` | Application | Coordinates builder + commentary + delivery |
| `backend/src/3_applications/coaching/snapshots/PostReportSnapshot.mjs` | Application | Builds post-report data snapshot |
| `backend/src/3_applications/coaching/snapshots/MorningBriefSnapshot.mjs` | Application | Builds morning-brief data snapshot |
| `backend/src/3_applications/coaching/snapshots/WeeklyDigestSnapshot.mjs` | Application | Builds weekly-digest data snapshot |
| `backend/src/3_applications/coaching/snapshots/ExerciseReactionSnapshot.mjs` | Application | Builds exercise-reaction data snapshot |

### Modified Files

| File | Change |
|---|---|
| `AcceptFoodLog.mjs` | Remove coaching triggers (lines 141-173) |
| `GenerateDailyReport.mjs` | Add post-report coaching call after PNG render |
| `Scheduler.mjs` | Add idempotency guard |
| `HealthCoachAgent.mjs` | Simplify assignment registration |
| `bootstrap.mjs` | Wire new coaching services |

### Preserved (not deleted)

The existing agent framework (`BaseAgent`, `Assignment`, tool factories) stays intact — other agents may use it. We're just not using the full framework for coaching anymore.

## Testing Strategy

- Unit tests for `CoachingMessageBuilder` — verify HTML output, percentage math, edge cases (0 cal, missing data)
- Unit tests for snapshot builders — verify data shape, recent_coaching window (4 days), time_of_day detection
- Integration test: mock Mastra generate() → verify full message assembly
- Manual verification: trigger each assignment type in dev, check Telegram output
