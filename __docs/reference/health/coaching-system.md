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
   read daily budget       compact         short prose     │
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

Status block and snapshot are computed from the same assessed daily budgets and longitudinal data — the status block is not derived from the snapshot, and the LLM cannot influence it.

**Pattern detection.** The coach reads a calendar window of the user's assessed daily budgets, classifies the most notable trend or break, and tags the snapshot with a single pattern label. The label is not shown to the user; it is a hint to the LLM about what is worth noticing.

**Snapshot.** The pattern, the day's totals, the recent comparisons, the weight trend, the most prominent food items, and a short window of recent coaching messages are gathered into one compact, structured object. Eligible observations are derived from the snapshot evidence; the selector receives those candidates and separately labelled historical context.

**Status block.** Independently and deterministically, the coach builds a short formatted block of the day's numbers, goal-relative percentages, and trend values. The status block is the user's first read and the part the LLM cannot rewrite.

**LLM selection.** The model chooses an offered observation ID or silence. Deterministic templates render the selected facts; model prose never reaches delivery. See LLM commentary below for the selection contract.

**Delivery.** The status block and the optional commentary are joined into a single message and sent through the household's messaging gateway. The same message is persisted to the user's coaching history so the next call can avoid repeating it.

---

## Pattern detection

Pattern detection answers the question "is anything about the last few days worth saying?" The coach reads the recent window of daily summaries and looks for a small set of named situations the rest of the system understands. At most one pattern is selected per snapshot — the most notable one, by a fixed precedence. If nothing matches, the snapshot carries no pattern, and the LLM is allowed to return an empty commentary.

The patterns the coach detects:

| Pattern | Meaning |
|---|---|
| `missed_logging` | The most recent historical day is incomplete or unlogged |
| `energy_surplus` | Two or more of the last three eligible days exceed estimated maintenance |
| `over_plan` | Two or more of the last three eligible days exceed their own exercise-adjusted plan |
| `protein_short` | Known protein under eighty percent of the configured target on three or more of the last five eligible days |
| `on_track` | Three consecutive finished, trustworthy days within their own plan and at or above the configured protein target |

Eligible intake days are finished and trustworthy. An over-plan day may still be below estimated maintenance; surplus is reserved for intake above maintenance. Equality is not over. Below-floor food logging is incomplete evidence and produces no calorie-deficit or binge label. Missing assessments suppress intake patterns; explicit logging facts remain available. Protein patterns require a finite positive configured target and known measured protein.

Pattern detection is deterministic: the same recent-window data and the same goal configuration always classify to the same pattern. There is no model in this stage.

---

## Status block

The **status block** is the deterministic, factual layer of every coaching message. It is the part the user reads first and the part the LLM is forbidden from touching. The block is built directly from the user's daily summary and longitudinal aggregates by a small set of pure functions that do nothing but pull numbers and format them.

Every status block carries:

- **The day's headline numbers.** Calories consumed against the calorie band; protein consumed against the protein floor; the percentage of each goal reached.
- **A comparison.** For the morning brief: yesterday vs. the seven-day average. For the weekly digest: this week vs. the eight-to-twelve-week average. For the exercise reaction: the activity's burned calories framed as expanded budget. For the post-meal message: today's running total as "so far" and "left", with no percentage-of-goal while the day is in progress, because a percentage reads as a verdict on an unfinished day.
- **A trend signal.** The weight trend slope per week, signed; the change in this week's calorie average against last week's.
- **Goal anchors.** Every comparison is presented against an explicit user-declared goal value, never a vague "where you usually are."

Numbers in the status block are **rounded** — calories to whole digits, protein to whole grams, weight to one decimal, slope to one or two decimals. Decimals beyond what is meaningful are not displayed.

The model selects an offered observation ID. Every delivered commentary number comes from the selected facts through a deterministic template; returned model prose is discarded.

If commentary is empty, the status block is sent alone. The status block stands on its own.

## Logging completeness

A logged total is not the same as what was eaten. A day that reads 460 calories is almost always a day with meals missing from the log, not a day of restraint, and a coach that narrates it as "you really kept it down" is wrong in a way the user sees at once.

So every day the coach reads is classified before anything else happens:

| Status | Meaning | Trusted? |
|---|---|---|
| `complete` | Logged total at or above the threshold | yes |
| `done` | The user said the day's log is final (`/done`) | yes, whatever the total |
| `fasting` | The user said the day was a fast (`/fast`) | yes, whatever the total |
| `incomplete` | Something logged, under the threshold, not confirmed | **no** — missing data |
| `unlogged` | Nothing logged | **no** — missing data |
| `reconstructed` | Untracked intake backfilled from weight ([reconstruction](README.md#untracked-intake-reconstruction)) | **no intake verdict** from the measured budget row; the estimate stays separately labelled. Protein is **unknown** |

**The threshold is the health budget's floor** — the user's `budgetFloor` in `users/{id}/apps/health/goals.yml` (default 1200), the lower edge of the goal range the Today bar draws ([budget equation](README.md#the-budget-equation--one-server-side-home)). The coach reads it through the budget contract (`BudgetService`), the same one that computes the day's zone and `complete` flag, so the coach and the bar can never disagree about whether a day is trustworthy. `logging_completeness.min_calories` in the household `coaching` config (`household/coaching/config.yml`) is now only the **fallback**, used when the budget cannot be computed (no goals or no weight yet).

**Completeness never comes from the clock.** A day is complete when food reached the floor or the user declared it done/fasted — nothing else. In particular the end-of-day report no longer treats "after 8 PM" as a complete day: late in the evening an under-floor, undeclared day is still missing data, and the report asks about the missing meals instead of judging the intake. The hour only sets tone and pacing.

Close a day from the nutribot chat with `/done` or `/fast`. With no argument it closes today in the user's timezone. It also takes `yesterday` or an explicit `YYYY-MM-DD` that is not in the future, and `/reopen` with the same arguments undoes it. The brief's hint prints the exact date, so it stays correct if read a day late. Closures live in `data/users/{username}/day_closed.yml` as `{date: {status?, at?, meals?: {<bucketId>: {status: fasting, at}}}}`. Only a day `status` closes a day; `meals` records meal fasts (`/fast breakfast`, the ⊘ icon on an empty meal in the day view), which tell the coach a meal was intentionally empty. A day with any skipped meal is trusted (classified `fasting`) without being a day closure. A bare `true` is the legacy `/done` record and is read as `done`.

Consequences:

- **Days are calendar days.** The morning brief's "yesterday" is yesterday. An unlogged day reads "nothing logged". It is never skipped, so an earlier day's numbers never stand in for it.
- **Averages cover finished trustworthy budget assessments only**, and the status block states the coverage ("3 of 7 days fully logged"). With no trusted days it says so instead of averaging.
- **An incomplete yesterday is labelled as such** in the status block, with the command that would close it.
- **Patterns and commentary never read an untrusted day as intake.** An incomplete or unlogged most-recent day yields `missed_logging`, never an intake deficit. Older untrusted days are dropped and the trusted remainder is still evaluated. A confirmed fast is never `missed_logging`. The snapshot carries each day's `status` and the threshold, and the LLM is told to say nothing about an incomplete yesterday's intake and to stay silent when fewer than half the days are trusted.

Implementation: `server/application/coaching/CoachingEvidenceService.mjs` loads one bulk `getBudgetRange` for history, a separate `getBudget` for the requested date, and nutrition data for reconstruction provenance. History ends the day before the requested date, oldest first, and retains gaps and per-day errors. Actual local today comes from the injected clock and user timezone. Reconstructed presentation remains estimated after a day closure; `declared` retains the closure separately without changing intake provenance or making protein known. Morning and post-report snapshots adapt days to newest first; weekly coaching loads one 56-day range and derives both windows from it. Snapshots include per-day assessments, provenance, source availability and period coverage. Current configured goals apply to historical budgets (`goalBasis: current`); this does not recover historical goal versions. `budgetDayView` lives in the evidence module and supplies agent tools with legacy fields plus the shared assessment.

### One budget, every surface

Every surface that judges a day takes the goal range and zone from the health budget contract — the Today bar's numbers — instead of its own sums and thresholds:

| Surface | Reads from the budget |
|---|---|
| `CoachingOrchestrator` (post-meal, morning brief, weekly digest, exercise reaction) | floor (completeness), top (the plan, shown as "left of {top}"), counted food and protein, `zone`, `complete`, `remaining`. Exercise is credited **in full** (the range compares net), matching the bar. |
| Health-coach agent tools `get_day_budget` / `get_budget_range` (`tools/BudgetToolFactory.mjs`) | one day (with its counted foods) or the last N days: calories, protein, net, range, zone, `complete`, `declared`. They replace the retired `get_today_nutrition` / `get_nutrition_history` / `is_day_closed`, which no factory defined any more (the assignments were silently getting nothing). |
| `EndOfDayReport`, `MorningBrief`, `WeeklyDigest` | "Logging Complete" from `complete`; floor/top from the range; the goals shown to the model carry the range, not the stale `nutrition.calories_min/max`; dates are the user's local dates, not UTC. A budget day is "over plan" when net passes its own top; weekly averages use complete days only. |
| Nutribot daily report caption (`nutribot/usecases/reportCaption.mjs`) | "🔥 1257 / 1200–1791 cal • 782 cal left" — the range and the zone's own words ("left", "over", "past break even", "Fasted"). |

Each composition scope builds its own `BudgetService` over the shared stores (`createHealthBudget` in `bootstrap.mjs`, the `healthApi.mjs` pattern). When historical coaching budgets are unavailable, logging facts may still be shown but intake assessments and averages are unavailable. Existing current-day status formatting falls back to its configured goals (`nutrition.calories_min/max`, `coaching.logging_completeness.min_calories`) and logs `coaching.budget.unavailable` / `report.budget.unavailable`.

---

## LLM commentary

Automated commentary is selected from supported observations rather than generated prose. `buildObservations({type, evidence, proteinGoal, recentObservations, eventItems})` returns eligible facts with an ID, kind, covered date/window, evidence dates, priority, and fingerprint. `renderObservation` turns a selected observation into plain text; the Telegram wrapper escapes that text once.

Supported kinds are `logging_incomplete`, `within_plan`, `over_plan`, `energy_surplus`, `protein_gap`, `exercise_budget`, and `period_summary`. Daily calorie judgments require trustworthy measured budget evidence. Live complete logs describe current position with “so far”; protein gaps require a finished day, known measured protein, and a configured target supplied to that call. Reconstructed intake receives no intake verdict and has unknown protein. Surplus means above estimated maintenance, never merely above plan. Period summaries require at least half the calendar window to have trustworthy finished logs, state their coverage, and disclose current configured goals when that is the supplied goal basis. Sparse periods can still produce a factual logging-status observation.

`CoachingCommentaryService.generate(snapshot)` returns an offered Observation or `null`. The model receives only eligible observations under `current_evidence`, with recent messages clearly separated under `historical_context`. It returns exactly `{"observationId":"an offered ID"}` or `{"observationId":null}`. Explicit null chooses silence. Malformed JSON, extra fields, unsupported IDs, stale model prose, and provider failures fall back to the highest-priority unseen eligible observation, or silence when none remain. No model prose is delivered, and no natural-language factual validator is involved. The runtime call carries the explicit user ID and uses one step, no tools, and a 30-second limit.

Fingerprints use kind, subject, and date/window. Delivered history stores `observationId`, `observationKind`, `observationFingerprint`, and `observationFingerprints` alongside existing receipt fields. The plural field remembers facts bundled into another observation, such as a protein gap included in a within-plan sentence. This prevents the gap from being repeated under another kind after the day's calorie position changes. History text may be truncated for context without losing these fingerprints; legacy history without metadata remains readable and is not rewritten.

Daily prominent foods are labelled as foods logged today, without implying a recent event. Only explicitly supplied `eventItems` support “just logged” wording. Missing event items never produce that claim. Templates give neutral factual context and do not advise eating remaining calories.

---

## Triggers

The coach speaks at a small, predictable set of moments. There is no continuous chatter, no commentary on every food log, no per-accept cheerleading.

| Trigger | Cadence | Why |
|---|---|---|
| Post-meal (post-report) | Once the food log has been quiet for `post_meal.quiet_minutes` (default 10) after a committed capture (text, voice, photo, barcode, or kitchen scale), an Undo, or a generated report. Only a change dated today arms it, and a send that would land inside `post_meal.quiet_hours` (default 22:00–07:00) is dropped. If the model has nothing to add, nothing is sent, because the capture receipt already shows the totals. | A meal is several captures seconds apart. The quiet timer turns them into one message about where the day stands and what's left. Captures now commit directly, and the report rarely renders, so the capture itself is the trigger. |
| Morning brief | Daily, mid-morning local time | Yesterday's totals have closed; today has not yet been shaped. The morning brief reflects on yesterday and the recent week. |
| Weekly digest | Weekly, Sunday evening local time | The week's data has settled. The digest compares this week to the long-term average and the previous week. |
| Exercise reaction | A new Strava activity, on its first successful fetch by the enrichment service, that started today (local) and burned more than `exercise_reaction.min_calories` (default 200) | A meaningful workout has just landed; the burned calories shift the day's budget. The webhook event itself carries no calories, so the rule is judged on the fetched activity. |
| End-of-day completion | Triggered when no further logging is expected for the day | If the user has been logging and then stops, the coach surfaces a quiet summary. If the user never started logging, the coach does not pile on. |
| On-demand | User asks via slash command, dashboard refresh, or explicit request | An on-demand request bypasses cadence rules entirely. |

Each automatic trigger is **idempotent within its cadence**: the morning brief fires once per day per user, the weekly digest fires once per week per user, the post-meal message fires once per quiet period and **replaces** the day's previous post-meal message (its Telegram message id is stored with the history entry), and an exercise reaction fires once per activity (the Strava job records `activityNotifiedAt` only once the hook has decided, and the history entry records `activityId`). Pending Strava jobs are recovered at startup only after the coach is wired, so a workout synced during a restart is still evaluated. A scheduler that misfires or a code path that double-invokes does not result in duplicate user-visible messages. The coach checks its own recent history and skips a delivery whose key (assignment type, user, date or hour) has already been recorded.

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
- **After a workout.** The exercise reaction frames burned calories as *expanded budget* — what the burn buys for the rest of the day in user-meaningful terms ("a snack, not a meal"; "room for the dinner you were already planning"). With the budget contract the burn is credited in full, exactly as the Today bar nets it off food (the range is judged on net); when budget evidence is unavailable, exercise credit is labelled unavailable. Raw activity burn remains a separate reported fact; the canonical daily credit describes only exercise already included in that budget.

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
| LLM unavailable, errored, or timed out | Select the highest-priority unseen eligible observation, or remain silent if none exists. |
| LLM returns malformed or empty output, extra fields, or an unsupported ID | Use the deterministic unseen fallback. A valid `observationId: null` explicitly chooses silence. |
| LLM emits unsupported prose or stale numbers | Discard the prose and use the supported fallback; no model numbers are delivered. |
| Sparse data (no recent food log, no weight, very thin window) | The coach defers commentary, delivers only the factual status block, and frames missing dimensions as such ("no weight reading in five days") rather than as zeros. |
| Partial day (under the completeness threshold, not closed with `/done` or `/fast`) | Classified `incomplete` (see Logging completeness): labelled in the status block, excluded from averages and patterns, and never narrated as low intake. |
| Pattern detection finds nothing | The snapshot carries a null pattern. The LLM is free to find a smaller observation or to stay silent. |
| Quiet hours active when an automatic trigger fires | The delivery is suppressed. If still relevant when the window closes, the message is delivered then; if a fresher trigger has superseded it, it is dropped. |
| Messaging gateway fails to deliver | The coach retries on a short backoff. If retries exhaust, the message remains visible on the dashboard surface, marked with its delivery state, so the user can see it on next refresh. |
| Persistence to coaching history fails | The user-facing delivery is unaffected. The next call's repetition guard may be incomplete; the coach falls back to a simpler "did this exact text appear today" check. |
| Goal configuration missing or malformed | The status block omits goal-relative percentages and reports raw totals. Commentary is suppressed because comparison-driven framing is not possible. |

The unifying principle: **a problem in the coaching layer never blocks the data layer or the daily report**. The pipeline produces daily summaries regardless. The hub renders them regardless. The coach is an enhancement that lights up when its inputs are healthy.

---

## Where it lives

### Backend

- `__backend/src/3_applications/coaching/` — coaching orchestration, deterministic message builder, pattern detection, snapshot composition, commentary service.
- `__backend/src/3_applications/coaching/MealCoachingTrigger.mjs` — the post-meal quiet timer. The nutribot capture commit (`NutribotInputRouter`) and `GenerateDailyReport` notify it. Only the coached user (head of household) is coached.
- `__backend/src/3_applications/fitness/webhookCoachingPolicy.mjs` — the exercise-reaction rule. `FitnessActivityEnrichmentService`'s `onActivityFetched` hook is wired in `app.mjs`.
- `__backend/src/3_applications/agents/health-coach/` — on-demand health coach agent, including its prompts, schemas, read-only data tools, messaging-channel delivery tool, and scheduled and event-triggered assignment definitions (post-report, morning brief, weekly digest, exercise reaction, note review, end-of-day report, daily dashboard).
- `__backend/src/3_applications/agents/framework/` — the agent scheduler with idempotency guard for cron-driven assignments.
- `__backend/src/1_adapters/messaging/` — messaging gateway adapters used to deliver coaching messages.
- `__backend/src/1_adapters/persistence/yaml/` — coaching history persistence.

### API

- `/api/v1/agents/health-coach/*` — on-demand coach endpoints (briefing, chat, refresh).
- `/api/v1/health/coaching/*` — coaching history reads consumed by the dashboard.
- `/api/v1/health-dashboard/*` — pre-composed dashboard documents that include the latest coaching message.

### Configuration and data

- `data/household/config/integrations.yml` — household-level provider selection (LLM provider, messaging platform, model and mini-model).
- `data/household/coaching/config.yml` — `morning_brief.schedule`, `weekly_digest.schedule`, `logging_completeness.min_calories` (default 1200; fallback only — the user's `budgetFloor` is the threshold), `post_meal.{enabled, quiet_minutes, quiet_hours}` (default on, 10, `{start: '22:00', end: '07:00'}`; `false` disables the window), `exercise_reaction.{enabled, min_calories}` (default on, 200).
- `data/users/{username}/day_closed.yml` — per-day `/done` and `/fast` closures.
- `data/users/{username}/health_coaching.yml` — per-user coaching history: every delivered message persisted with its assignment type and the date it covers.
- `data/users/{username}/lifeplan.yml` — per-user goal configuration consumed for goal-relative framing.
- `data/users/{username}/agents/health-coach/` — per-user agent working memory: idempotency keys, alerts-sent counters, last-trigger timestamps.

### Frontend

- `frontend/src/modules/Health/HealthCoach/` — coach panel, message rendering, on-demand refresh and chat.
