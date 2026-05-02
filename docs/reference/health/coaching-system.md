# Health Coaching System

## Purpose

The coaching system turns the household's aggregated health data into timely, actionable reflection a user can read in seconds. A user finishes a meal, ends a fitness session, or wakes up to a new day, and a short message lands in their messaging app: *here is where you stand against your goals, here is the one thing about the last few days that is worth noticing, here is what the rest of today looks like.* The coach doesn't ask the user to do math, doesn't repeat yesterday's observation, and never says anything it cannot back with a number from the user's own data.

For shared concepts referenced throughout this document — daily summary, longitudinal aggregate, identity model, household, food catalog, source freshness, quiet hours, messaging gateway, reconciliation — see `health-system-architecture.md`. For the mechanics of how those numbers are produced, see `data-pipeline.md`. This document describes how the coaching layer reads from those outputs and turns them into user-facing messages.

---

## Coaching pipeline

A coaching message is the end of a five-stage pipeline. Each stage is per-user; cross-user data is never combined and one user's coaching never references another user's numbers.

```
   pattern detection   →   snapshot   →   LLM commentary   ┐
   -----------------       --------       ---------------  │
   read recent daily       compact         short prose     │
   summaries and           structured      anchored on     │
   longitudinal            object of       the snapshot    ├─→   delivery
   aggregates;             pre-computed    and the status  │     --------
   classify the most       facts the       block; may be   │     messaging
   notable trend or        LLM is          empty           │     gateway →
   break                   allowed to                      │     Telegram
                           comment on                      │     and the
                                                           │     dashboard
   status block ───────────────────────────────────────────┘     (same
   ------------                                                  content,
   deterministic HTML lines: numbers, goal framing,              read-only)
   comparisons (what the user reads first); computed
   in parallel with the snapshot from the same data
```

Status block and snapshot are computed **in parallel** from the same daily-summary and longitudinal data — the status block is not derived from the snapshot, and the LLM cannot influence it.

**Pattern detection.** The coach reads a small window of the user's recent daily summaries and longitudinal aggregates, classifies the most notable trend or break, and tags the snapshot with a single pattern label. The label is not shown to the user; it is a hint to the LLM about what is worth noticing.

**Snapshot.** The pattern, the day's totals, the recent comparisons, the weight trend, the most prominent food items, and a short window of recent coaching messages are gathered into one compact, structured object. The snapshot is the LLM's entire view of the world for this call. Anything not in the snapshot is invisible to the LLM.

**Status block.** Independently and deterministically, the coach builds a short formatted block of the day's numbers, goal-relative percentages, and trend values. The status block is the user's first read and the part the LLM cannot rewrite.

**LLM commentary.** The snapshot is passed to a generative model with a system prompt. The model returns short commentary anchored on the snapshot, or an empty string if it has nothing new to say. (See §5 for the full constraints on length, persona, and call shape.)

**Delivery.** The status block and the optional commentary are joined into a single message and sent through the household's messaging gateway. The same message is persisted to the user's coaching history so the next call can avoid repeating it.

---

## Pattern detection

Pattern detection answers the question "is anything about the last few days worth saying?" The coach reads the recent window of daily summaries and looks for a small set of named situations the rest of the system understands. At most one pattern is selected per snapshot — the most notable one, by a fixed precedence. If nothing matches, the snapshot carries no pattern, and the LLM is allowed to return an empty commentary.

The patterns the coach detects:

| Pattern | Meaning |
|---|---|
| Binge after deficit | A day above the calorie ceiling following two or more days below the calorie floor |
| Missed logging | One or more days in the recent window with no food logged |
| Calorie surplus | Two or more of the last three days above the calorie ceiling |
| Calorie deficit | Two or more of the last three days below the calorie floor (excluding zero-log days, which are missed-logging) |
| Protein short | Protein under eighty percent of goal on three or more of the last five days |
| On track | Within calorie band and at or above protein goal for three consecutive days |
| Exercise spike | A burned-calorie spike from a completed session that materially expands the day's budget |
| Weight plateau | The smoothed weight trend flat over a multi-week window when goal direction is loss or gain |
| Streak break | An on-track streak ending the previous day |

Pattern detection is **comparison-driven**: every pattern is a relation between the day at hand and either a goal or a recent baseline, never an absolute judgment. "Calorie surplus" is *above the user's own ceiling*. "Protein short" is *short of the user's own target*. "Weight plateau" is *flat against the user's own goal direction*. The coach does not have absolute opinions about how much anyone should eat or weigh — every claim is anchored on a user-declared goal or a user-specific baseline.

Pattern detection is deterministic: the same recent-window data and the same goal configuration always classify to the same pattern. There is no model in this stage.

---

## Status block

The **status block** is the deterministic, factual layer of every coaching message. It is the part the user reads first and the part the LLM is forbidden from touching. The block is built directly from the user's daily summary and longitudinal aggregates by a small set of pure functions that do nothing but pull numbers and format them.

Every status block carries:

- **The day's headline numbers.** Calories consumed against the calorie band; protein consumed against the protein floor; the percentage of each goal reached.
- **A comparison.** For the morning brief: yesterday vs. the seven-day average. For the weekly digest: this week vs. the eight-to-twelve-week average. For the exercise reaction: the activity's burned calories framed as expanded budget. For the post-report: today against today's targets.
- **A trend signal.** The weight trend slope per week, signed; the change in this week's calorie average against last week's.
- **Goal anchors.** Every comparison is presented against an explicit user-declared goal value, never a vague "where you usually are."

Numbers in the status block are **rounded** — calories to whole digits, protein to whole grams, weight to one decimal, slope to one or two decimals. Decimals beyond what is meaningful are not displayed.

The contract with the LLM is unconditional: **the LLM may cite the status block, paraphrase it, or build on it. The LLM may not contradict it, restate it verbatim, invent new numbers, or replace any value with a different one.** If the LLM emits a number, that number is in the snapshot. If a number is in the snapshot, it agrees with the status block.

If commentary is empty, the status block is sent alone. The status block stands on its own.

---

## LLM commentary

The persona is a friend who happens to know the user's numbers — direct, data-aware, never preachy, never motivational-poster, never clinical. The voice is conversational and concrete. The commentary itself is **at most one sentence, at most about thirty words**, wrapped below the status block in a quoted line.

What commentary **may** do:

- Interpret the status block ("the chicken carried the protein").
- Frame a number against a recent pattern ("calories are dialed in but protein crept up only seven grams").
- Connect a specific food item to the day's totals ("that yogurt covered most of the gap").
- Reference what the budget allows for the rest of the day ("you have room for a snack, not a meal").
- Stay silent. Returning an empty string is a first-class outcome and the system handles it gracefully.

What commentary **may not** do:

- Invent a number that is not in the snapshot.
- Contradict any value in the status block.
- Repeat an observation already made in the recent coaching window included in the snapshot.
- Use cheerleading phrases ("great job," "keep it up," "you've got this," "stay consistent").
- Give generic advice ("focus on protein-rich foods," "ensure consistent tracking") with no anchor in the user's data.
- Suggest specific named foods the user has not already logged or quick-added.
- Offer medical advice, diagnose, or interpret symptoms. The coach is a habit-and-trend coach, not a clinician.
- Reference reconciliation-derived implied intake or tracking accuracy for days less than two weeks old. Those quantities are only meaningful in long-view framing and the snapshot omits them for recent days.

The commentary call is **single-call, single-turn, no tools**. The model receives the snapshot as input, returns text, and that is the whole interaction. There is no follow-up turn, no tool loop, no multi-step planning. Failure modes — empty output, malformed output, transport error, timeout — degrade to no commentary, never to a partial or invented one.

The LLM provider, model, and token budget are configured at the household level. The coach commits to a small, fast model — the call must complete before delivery, and the message budget is one sentence.

---

## Triggers

The coach speaks at a small, predictable set of moments. There is no continuous chatter, no commentary on every food log, no per-accept cheerleading.

| Trigger | Cadence | Why |
|---|---|---|
| Post-report | Inline after the daily food report renders | The user has just confirmed a batch of items and the totals are fresh; this is the moment to frame "where you are, what's left." |
| Morning brief | Daily, mid-morning local time | Yesterday's totals have closed; today has not yet been shaped. The morning brief reflects on yesterday and the recent week. |
| Weekly digest | Weekly, Sunday evening local time | The week's data has settled. The digest compares this week to the long-term average and the previous week. |
| Exercise reaction | Triggered by a completed fitness session above a calorie threshold | A meaningful workout has just landed; the burned calories shift the day's budget and the week's session count. |
| End-of-day completion | Triggered when no further logging is expected for the day | If the user has been logging and then stops, the coach surfaces a quiet summary. If the user never started logging, the coach does not pile on. |
| On-demand | User asks via slash command, dashboard refresh, or explicit request | An on-demand request bypasses cadence rules entirely. |

Each automatic trigger is **idempotent within its cadence**: the morning brief fires once per day per user, the weekly digest fires once per week per user, the post-report fires once per generated report. A scheduler that misfires or a code path that double-invokes does not result in duplicate user-visible messages. The coach checks its own recent history and skips a delivery whose key (assignment type, user, date or hour) has already been recorded.

**Quiet hours suppress automatic deliveries.** If the user is inside their configured quiet-hours window (see `health-system-architecture.md` glossary), the morning brief, weekly digest, exercise reaction, and end-of-day completion do not deliver — the coach holds the message until the window closes and either delivers it then (if still relevant) or drops it (if a fresher trigger has superseded it). On-demand requests bypass quiet hours; the user pulled, so the user gets an answer.

---

## Delivery

Telegram is the **primary delivery surface** for coaching messages. The coach asks the messaging gateway to send a formatted message to the user's configured conversation; the gateway's choice of platform is configured at the household level. The coach itself does not depend on Telegram-specific features — it produces a message, a target conversation, and a parse-mode hint, and the gateway handles the rest. Substituting a different messaging platform at the household level is a configuration change, not a code change.

The dashboard surface — the coach panel on the health hub — renders the **same content**. Both surfaces read from the same coaching history. A message delivered to Telegram appears on the dashboard; a dashboard refresh that triggers an on-demand coaching call delivers the same shape of message.

Messages are **user-scoped**: every coaching message belongs to exactly one user. A household member's morning brief is delivered to that household member's conversation, anchored on that household member's goals, drawn from that household member's daily summary. There is no household-wide coaching channel; the coach speaks to one person at a time.

Every delivered message is **persisted to the user's coaching history** with its assignment type, the date it covers, and the full text. Persistence is part of delivery, not an afterthought — the next coaching call reads the recent window of history to avoid repeating itself.

---

## Time and budget awareness

The coach's framing depends on what time of day it is. The remaining-budget framing dominates late in the day; goal-progress framing dominates earlier. The snapshot carries a time-of-day label — morning, midday, afternoon, evening, late — and the LLM uses it to choose framing.

The practical rules:

- **Early in the day.** The coach does not warn about low intake. The day has not happened yet. A morning brief reads yesterday and the recent week, not today's empty totals.
- **Midday.** The coach frames remaining budget as *what is still possible* — calories left, protein gap, what a typical lunch or dinner from the food catalog would do to the totals.
- **Late in the day.** The coach frames remaining budget as *what is still appropriate* — a snack-sized window, a protein-shake-sized gap, or the day already closed against goal.
- **After the day's calorie ceiling is met.** The coach does not pile on. It does not nag, does not remind, does not suggest restriction. The status block reports the situation factually; commentary, if any, is brief and forward-looking.
- **After a workout.** The exercise reaction frames burned calories as *expanded budget* — what the burn buys for the rest of the day in user-meaningful terms ("a snack, not a meal"; "room for the dinner you were already planning"). It does not double-count: the system does not credit a burned calorie as expanding the day's eat-budget beyond the goal ceiling.

The coach also respects **source freshness**: if a source has gone silent (no scale reading in many days, no fitness session recorded in a week), the coach does not pretend the absence is data. A weight-plateau pattern requires recent weight readings; without them, the pattern is suppressed.

---

## Hard constraints

These rules apply to every coaching message, every assignment, every delivery surface. They are non-negotiable.

- **Never invent numbers.** Every number that appears in a coaching message is either in the status block or in the snapshot the LLM was given. The LLM may not produce a number that is not in the snapshot.
- **Always anchor on real data.** Every claim is grounded in the user's daily summary, longitudinal aggregate, food log, weight reading, or session record. If the data is not there, the claim is not made.
- **Comparison-driven framing.** Every observation is a comparison: today vs. yesterday, this week vs. recent weeks, this number vs. the user's stated goal. The coach does not make standalone judgments.
- **Rounded numbers, not decimals.** Calories whole. Protein whole grams. Weight one decimal. Slopes one or two decimals where meaningful. No spurious precision.
- **No medical advice.** The coach does not diagnose, prescribe, or interpret symptoms. It comments on tracked nutrition, weight, and activity in the framing of user-declared goals.
- **No cheerleading.** No "great job," "keep it up," "you've got this," "stay consistent." The coach is direct, not motivational.
- **No generic advice.** No "focus on protein-rich foods," no "ensure consistent tracking," no "stay hydrated." Every nudge is specific to the data on hand.
- **No repetition.** If the recent coaching history already made an observation, the coach does not make it again. Find something new or stay silent.
- **Respect quiet hours.** Automatic deliveries are suppressed during the user's quiet-hours window; on-demand requests are honored.
- **Stay silent when nothing is worth saying.** An empty commentary is a first-class outcome. The status block stands alone.

---

## Failure modes

The coach degrades gracefully. No failure in any single stage blocks the daily report or leaves the user without an answer.

| Failure | Behavior |
|---|---|
| LLM unavailable, errored, or timed out | Commentary is dropped. The status block is delivered alone. The user sees the numbers without the conversational line. |
| LLM returns malformed or empty output | Treated as "nothing to say." The status block is delivered alone. |
| LLM commentary contradicts the status block | The commentary is dropped before delivery. Contradiction is detected by re-checking emitted numbers against the snapshot. |
| Sparse data (no recent food log, no weight, very thin window) | The coach defers commentary, delivers only the factual status block, and frames missing dimensions as such ("no weight reading in five days") rather than as zeros. |
| Partial day (logging in progress, totals incomplete) | The status block frames the totals as in-progress; commentary, if any, acknowledges incompleteness without inventing the missing pieces. |
| Pattern detection finds nothing | The snapshot carries a null pattern. The LLM is free to find a smaller observation or to stay silent. |
| Quiet hours active when an automatic trigger fires | The delivery is suppressed. If still relevant when the window closes, the message is delivered then; if a fresher trigger has superseded it, it is dropped. |
| Messaging gateway fails to deliver | The coach retries on a short backoff. If retries exhaust, the message remains visible on the dashboard surface, marked with its delivery state, so the user can see it on next refresh. |
| Persistence to coaching history fails | The user-facing delivery is unaffected. The next call's repetition guard may be incomplete; the coach falls back to a simpler "did this exact text appear today" check. |
| Goal configuration missing or malformed | The status block omits goal-relative percentages and reports raw totals. Commentary is suppressed because comparison-driven framing is not possible. |

The unifying principle: **a problem in the coaching layer never blocks the data layer or the daily report**. The pipeline produces daily summaries regardless. The hub renders them regardless. The coach is an enhancement that lights up when its inputs are healthy.

---

## Where it lives

### Backend

- `backend/src/3_applications/coaching/` — coaching orchestration, deterministic message builder, pattern detection, snapshot composition, commentary service.
- `backend/src/3_applications/agents/health-coach/` — on-demand health coach agent, including its prompts, schemas, read-only data tools, messaging-channel delivery tool, and scheduled and event-triggered assignment definitions (post-report, morning brief, weekly digest, exercise reaction, note review, end-of-day report, daily dashboard).
- `backend/src/3_applications/agents/framework/` — the agent scheduler with idempotency guard for cron-driven assignments.
- `backend/src/1_adapters/messaging/` — messaging gateway adapters used to deliver coaching messages.
- `backend/src/1_adapters/persistence/yaml/` — coaching history persistence.

### API

- `/api/v1/agents/health-coach/*` — on-demand coach endpoints (briefing, chat, refresh).
- `/api/v1/health/coaching/*` — coaching history reads consumed by the dashboard.
- `/api/v1/health-dashboard/*` — pre-composed dashboard documents that include the latest coaching message.

### Configuration and data

- `data/household/config/integrations.yml` — household-level provider selection (LLM provider, messaging platform, model and mini-model).
- `data/users/{username}/health_coaching.yml` — per-user coaching history: every delivered message persisted with its assignment type and the date it covers.
- `data/users/{username}/lifeplan.yml` — per-user goal configuration consumed for goal-relative framing.
- `data/users/{username}/agents/health-coach/` — per-user agent working memory: idempotency keys, alerts-sent counters, last-trigger timestamps.

### Frontend

- `frontend/src/modules/Health/HealthCoach/` — coach panel, message rendering, on-demand refresh and chat.
