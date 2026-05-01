# Health Data Pipeline

## Purpose

The data pipeline turns the raw, multi-source stream of health events that flow into the household — a meal typed into a chat, a number from the smart scale, the end of a fitness session, an integration's nightly sync — into a single, trustworthy timeline per user. A user opens the health hub, asks the coach a question, or receives a morning brief and reads the *same numbers* regardless of the surface, because every surface reads from the pipeline's output rather than from a raw source. The pipeline is the layer that makes "what did I eat yesterday?" a question with one answer.

For shared concepts referenced throughout this document — identity model, time scales, daily summary, longitudinal aggregate, household, reconciliation, food catalog — see `health-system-architecture.md`. This document describes the mechanics of how those concepts are produced and what they contain.

---

## Inputs

The pipeline accepts events from the sources catalogued in [`health-system-architecture.md`](health-system-architecture.md#data-sources). For each input, the pipeline does the following:

| Input | What the pipeline does first | Idempotency key |
|---|---|---|
| Food log via Telegram | Queues the parsed items at parse-confirm; folds them into the day's food log on accept. | Log entry UUID |
| Food log via web | Stores the structured items as they are submitted from the hub's inline entry. | Log entry UUID |
| Quick-add from food catalog | Clones the catalog entry's nutrient values into a new food log entry without an LLM parse; bumps the catalog use count. | New log entry UUID |
| Manual annotations | Applies the edit, deletion, color change, or note in place against the existing log entry; triggers re-aggregation of the affected day. | Target log entry UUID |
| Smart scale reading | Stores as a measurement event tagged with reading time and body composition fields. | (user, timestamp) |
| Fitness session | Stores the completed session record on session-end, including duration, intensity, calories, participants, and media context. | Session UUID |
| Activity tracker integration | Pulls or receives passive signals (steps, heart rate, activities, calories, sleep) on the integration's cadence and tags them to the local date. | (source, native event ID) |
| Coaching history | Persists each delivered message so the coach can reference it as memory in future commentary. | Message UUID |

Every input carries the owning user as a stable username and a date in the user's local timezone. A user can have any subset of these inputs enabled. The pipeline tolerates missing sources and produces partial daily summaries from whatever it has — a day with weight but no food log is still a valid day.

---

## Pipeline stages

The pipeline runs as five conceptual stages. Each stage operates per user; cross-user data is never combined.

```
   sources         ingest        normalize       daily aggregate       longitudinal aggregate       expose
   -------         ------        ---------       ---------------       ----------------------       ------
  food log    -->                                                                              
  scale       -->  per-source    one record      one record per         daily series + weekly       hub, coach,
  sessions    --> adapters  -->  shape per   --> user per date    -->   and monthly rollups   -->   bot, weekly
  trackers    -->                event type      with all sources                                   digest
  manual      -->                                folded in                                          
                                                       ^
                                                       |
                                                  reconcile
                                                  (derived pass run
                                                  alongside aggregation)
```

### Ingest

Each source has its own adapter that knows the source's native shape (a Telegram parse result, a scale reading, a session record, a third-party integration's webhook or pull). The adapter reads the source, extracts the events that are new since the last ingest, and tags each event with the owning user and the local date it occurred on. Events accumulate in per-source datastores keyed by date. Re-running ingest on the same source state produces the same set of events; an event that has already been written is recognized and not duplicated.

### Normalize

Normalization brings every event into a small, consistent set of fields the rest of the pipeline understands. A weight reading becomes a number of pounds plus optional body composition fields. A workout record becomes a title, a duration, a calorie count, an intensity signal, and a source label — regardless of whether the underlying provider was a third-party tracker or the household's own fitness system. A food item becomes a name, calorie count, macro grams, micronutrient values, meal time, and color category. Source-specific fields are preserved as side data when they may matter later for reconciliation, but the normalized shape is what downstream stages read.

### Daily aggregate

The daily aggregate produces one record per user per date. For a given date, the aggregator pulls the day's normalized events from every source, folds them into a single record, and writes that record to the user's health timeline. The same operation is run over a rolling window of recent days every time aggregation is triggered — so a late-arriving event for an earlier day causes that day's record to be recomputed. Workouts that appear in more than one source for the same day are merged into a single entry tagged with each contributing source; where sources disagree on a number, the merge keeps the maximum signal (e.g., the higher of two calorie estimates). The output of this stage is the **daily summary** described in `health-system-architecture.md`.

A reconciliation pass runs alongside daily aggregation. Reconciliation reads a recent window of weight readings, tracked nutrition, exercise, and step calories, derives the user's effective metabolic rate from observed weight change against logged intake, and produces an *adjusted* version of each day's nutrition that reflects tracking-accuracy estimation, portion correction, and phantom calories — calories the body's response indicates were eaten beyond what was logged. The adjusted nutrition is stored alongside the raw logged nutrition; both views are available downstream. Reconciliation is best-effort: a failure to reconcile leaves the raw daily summary intact and is reported but never blocks aggregation.

### Longitudinal aggregate

The longitudinal aggregate reads the user's daily summaries and produces time-bucketed series — daily, weekly, monthly — with statistical rollups attached to each bucket. The longitudinal layer is what the hub charts, what the coach quotes for long-view context, and what the weekly digest compares against. Like the daily aggregate, it is recomputed whenever the underlying daily summaries change, so the chart and the morning brief always see the same numbers. The tiered history view — recent days at daily grain, the surrounding months at weekly grain, the prior years at monthly grain — is a single read built from the same series.

### Expose

Aggregates are exposed through a small, stable read interface: a daily summary by date, a daily summary range, a longitudinal series, a tiered history view, the food catalog, source freshness. The exposure layer reads from the persisted aggregates; it does not recompute on demand and it does not reach back to raw sources. Every read is per-user. Reads return the persisted state. The hub triggers a fresh aggregation pass on first load by passing an explicit refresh flag; without the flag, reads do not recompute. There is no in-memory-only computed view that survives only as long as the request.

---

## Daily summaries

A daily summary is the canonical answer to "what did this user eat, weigh, and do today?" It is a single record per user per date. Its semantic content:

- **Weight reading.** The day's weight in pounds, body fat percentage where available, lean mass, water weight, and a smoothed multi-day trend value. A day without a weigh-in carries a null weight reading; the trend value carries through gaps.
- **Nutrition totals.** Total calories, total protein, total carbs, total fat, and additional tracked nutrients (fiber, sodium, sugar, cholesterol). Computed from the day's food log items.
- **Food items.** The structured food log entries themselves, each carrying its name, nutrient values, meal time, color category (the user's at-a-glance "how did this fit?" tag), and source (Telegram or web).
- **Adjusted nutrition.** A second nutrition view produced by reconciliation, reflecting tracking-accuracy estimation and phantom-calorie attribution. Coexists with the raw logged nutrition; both are stored.
- **Step and passive activity totals.** Step count, basal metabolic rate estimate, active duration, calories burned from steps, max and average heart rate where supported.
- **Workout entries.** One entry per completed activity that day, normalized across sources. Each entry carries title, type, duration, calories, average and max heart rate, distance, start and end times. Entries seen in more than one source (a session captured by both the fitness system and a third-party tracker) are merged into a single entry tagged with both sources.
- **Workout summary.** A roll-up of the day's workouts: total calories burned, total active duration, count of completed activities.
- **Goal progress.** The day's standing against the user's active goals — calorie band remaining, protein floor met or missed, session count toward the weekly target. Computed against the user's current goal values from the life plan.
- **Coaching messages.** Any coaching messages delivered or recorded that day, attached to the day for context. Drawn from the coaching history, not duplicated.

A daily summary is deterministic and revisable as defined in [the architecture doc](health-system-architecture.md#daily).

---

## Longitudinal aggregations

Longitudinal aggregations are the substrate for charts, trend awareness, and long-view coaching context. They answer questions of the form "how is this dimension changing over time?"

The longitudinal layer presents a user's history at three time grains:

- **Daily series** — the recent stretch of days, day by day, suitable for a sparkline showing the last month's calories, protein, exercise minutes, weight trend, or calorie balance.
- **Weekly rollups** — week-by-week values across roughly half a year: average weight per week, weekly exercise calories, weekly average heart rate during sessions, weekly calorie balance.
- **Monthly rollups** — month-by-month values across a longer window, for the "two-year trend" view of weight, calories, sessions, and other dimensions.

For each bucket, the layer carries the bucket's start and end dates plus statistical rollups: average of non-null values for continuous dimensions (weight, calories, protein), counts for discrete dimensions (workouts, sessions), and sums for additive dimensions (exercise minutes, calories burned, total coins).

The kinds of questions the longitudinal layer answers:

- "What's my weight trend over the last six weeks?"
- "How does this week's average daily protein compare to my three-month average?"
- "How many workouts have I completed each week this quarter?"
- "What's my calorie balance running average over the last fortnight?"
- "How does this month's weight compare to a year ago?"

The longitudinal layer is computed from the same daily summaries the hub renders, so a number on a chart and a number on the hub always agree.

Range queries — "give me everything between these two dates" — are supported as a thin variant of the same read: the layer slices the daily series to the requested window and returns it in order. The coach uses range queries to anchor commentary; the hub uses them when the user picks a custom date range; the weekly digest uses them to compare the current week to the previous one.

---

## Food catalog

The food catalog turns a user's logging history into one-tap entry: a frequently-eaten item is recognized and re-logged without re-parsing. It is built passively from the food log: every accepted food item, regardless of source, is checked against the user's catalog and either creates a new catalog entry or increments the use count of an existing one.

What an entry contains: a name, a normalized version of the name (lowercased and whitespace-collapsed) used for matching, the most recent nutrient values for the item, the source the item was first parsed from, an optional barcode reference, a use count, the date of last use, and the date the entry was created.

What the catalog is consumed for:

- **Quick-add** — a user taps an entry on the hub or in the chat to log "the same as before" without restating the item or paying the cost of an LLM parse. The entry's nutrients become the new food log entry, and the catalog records another use.
- **Frequent-item recognition** — the chat and the hub surface the user's most-used and most-recent items as chips, so common foods are one tap away.
- **Search** — typing a partial name returns matching entries, ordered by frequency and recency.
- **Backfill** — when a user is newly enabled or a new device starts using the catalog, an initial pass over the user's existing food log seeds the catalog with one entry per distinct item, so the catalog reflects historical usage from day one.

The catalog is per-user. There is no cross-user pooling; one household member's frequently-logged item does not appear on another household member's catalog.

---

## Guarantees

The pipeline makes the following guarantees. Downstream consumers — the hub, the coach, the bot, the weekly digest — depend on these.

- **Idempotency.** Re-running ingest, aggregation, or longitudinal computation on the same source state produces the same output. An event seen twice from the same source becomes one entry. An aggregation pass over a day with no source changes leaves the day's summary unchanged.

- **Late-arrival reconciliation.** An event for an earlier day arriving today causes that earlier day's daily summary to be recomputed. The summary updates in place; the new state replaces the old. Reconciliation also covers the after-the-fact case where a more accurate signal — a scale reading suggesting yesterday's logged calories were under-counted, a corrected food item, a deleted entry — produces an *adjusted* version of a day's nutrition that coexists with the raw logged version. Both are stored; consumers choose which to read based on context.

- **Per-user isolation.** Every aggregate is owned by exactly one user. Reads and writes are keyed by username. There is no shared state across users; one household member's data does not influence another's aggregates.

- **Deterministic given inputs.** A daily summary or longitudinal series is a pure function of the source events and the goal configuration in effect. No randomness, no time-of-day dependence beyond the date the events fall on.

- **Immutable history.** Source events are kept in their original form alongside every adjusted view. A reconciled or adjusted value never overwrites the underlying logged value — it is stored as an additional layer, so a historical reading can always be reconstructed from the raw events.

---

## Edge cases

The pipeline handles a small set of recurring awkward situations the same way every time.

- **Cross-day logs.** A meal logged after midnight that the user intends as part of "yesterday" carries an explicit date the user set; the pipeline trusts that date and folds the meal into yesterday's summary. A meal logged with no explicit date defaults to the user's local date at the moment of logging.

- **Revisions.** A user editing the name, nutrients, color, or meal time of a previously-logged food item updates the item in place, and the day's daily summary is recomputed. The longitudinal series for that day's bucket follows.

- **Deletions.** A deleted food item disappears from the food log and the day's totals. Other days are unaffected. A deleted weight reading similarly removes the day's weight contribution; the trend value is recomputed without the missing reading.

- **Missing days.** A day with no events from any source is represented as a record with null fields rather than absent. Charts skip the gap; the coach treats null as "no data" rather than "zero." The trend value carries through gaps for dimensions where smoothing is meaningful (weight).

- **Partial data.** A day with weight but no food log, or food log but no weight, produces a partial daily summary. Goal progress reports against whatever dimensions have data; dimensions without data are reported as such rather than as zero.

- **Timezone handling.** Every date is the user's local date. Events from sources that report in UTC are converted to the user's timezone at ingest. A weigh-in at 06:00 local time and a meal at 22:00 local time on the same day land in the same daily summary regardless of the underlying timestamp's UTC offset.

- **Duplicate workouts.** A workout captured by both the fitness system and a third-party tracker becomes one merged entry in the daily summary, tagged with both sources. The merged entry takes the maximum of the duplicate signals where one is more accurate (calorie counts), preserves both sources' raw data, and never double-counts in totals.

- **Missing calorie counts.** A workout from a source that reports duration and heart rate but not calories — common for strength sessions on third-party trackers — is given an estimated calorie count based on heart rate, duration, and the user's recent body weight. The estimate is tagged as derived so reconciliation knows it can be improved later.

---

## Consumers

The pipeline's outputs are read by every health-aware surface in the system. None of them re-derive aggregates from raw events; all of them read from the pipeline.

- **Health app frontend.** The hub renders today's daily summary as summary cards (weight, nutrition, sessions, goals, recency). Detail views consume longitudinal series for charts and history. Inline interactions on the hub — logging food, accepting an AI parse, quick-adding from catalog, editing goals — write back through the pipeline's input layer, which immediately recomputes the affected day's summary. See `health-app-frontend.md`.

- **Coaching system.** The coach reads recent daily summaries and longitudinal aggregates to detect patterns, build the deterministic status block of a coaching message, and provide the LLM with a snapshot of facts to comment on. The morning brief, post-report summary, weekly digest, and exercise reaction are all anchored on pipeline output, never on raw sources. See `coaching-system.md`.

- **Daily Telegram report.** The morning brief and post-report messages delivered through the messaging surface are coaching messages composed from daily summaries and longitudinal aggregates. The same content also renders on the dashboard.

- **Fitness coach panel.** A daily reaction following a completed fitness session frames how the session affects the day's calorie budget and the week's session count. The framing reads directly from the daily summary (today's calorie standing) and the longitudinal aggregate (the week's session count).

- **Weekly digest.** The end-of-week message comparing this week to long-term averages reads weekly and monthly rollups; it composes entirely from longitudinal output.

- **Source freshness card.** The hub's recency card reads "days since last event" per source, computed from the most recent ingest timestamp the pipeline tracks for each source per user.

- **Food entry surfaces.** The hub's inline food entry and the messaging-surface chat both read the food catalog for chip suggestions and write accepted items back to the food log, which the pipeline folds into the day's summary.

---

## Where it lives

### Backend

- `backend/src/3_applications/health/` — daily aggregation, dashboard composition, longitudinal aggregation, food catalog, reconciliation, and the ports those applications depend on.
- `backend/src/2_domains/health/` — health domain entities and pure aggregation logic (daily metrics, workout merging, history rollup, calorie reconciliation).
- `backend/src/2_domains/nutrition/` — nutrition domain entities and food log services.
- `backend/src/1_adapters/persistence/yaml/` — YAML datastores for health timeline, nutrition logs, food catalog, reconciliation, adjusted nutrition, coaching history.
- `backend/src/1_adapters/health/` — adapters for external health data sources.

### Persistence

- `data/users/{username}/health/` — per-user health timeline files: aggregated daily summaries, weight, fitness, nutrition, reconciliation, adjusted nutrition.
- `data/users/{username}/health_coaching.yml` — per-user coaching history folded into daily summaries.
- `data/users/{username}/lifelog/nutrition/` — per-user food log entries by date.
- `data/users/{username}/food_catalog.yml` — per-user food catalog.
- `data/users/{username}/lifeplan.yml` — per-user goals consumed for daily-summary goal progress.

### API

- `/api/v1/health/*` — daily summary by range or date, longitudinal series, weight, workouts, fitness, nutrition, coaching, status, food catalog, food log CRUD.
- `/api/v1/health-dashboard/*` — pre-composed dashboard documents for read-only display.
- `/api/v1/nutrition/*` — nutrition logs, daily and weekly summaries, range queries.
