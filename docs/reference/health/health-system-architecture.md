# Health System Architecture

## Overview

The health system gives a household longitudinal awareness of weight, nutrition, fitness, and goals — and an AI coach that turns that awareness into timely reflection. It is the ambient layer of self-knowledge that makes habit change visible day to day, week to week, year to year.

This document is the entry point for the health reference set. It defines the shape of the system, the boundaries with adjacent systems, and the shared vocabulary the deeper docs build on:

- **Data pipeline** — how raw health events become normalized, longitudinal data. See `data-pipeline.md`.
- **Coaching system** — how aggregated data becomes user-facing reflection. See `coaching-system.md`.
- **Health app frontend** — how a user explores their data and acts on it. See `health-app-frontend.md`.

Glossary terms used across the four docs are defined exactly once, in this document, in the [Glossary](#glossary) section. The other docs link back rather than redefine.

---

## Scope and boundaries

### In scope

- **Weight** — daily measurements, trend lines, body composition where available.
- **Nutrition** — every food logged, daily macro and calorie totals, longitudinal patterns.
- **Fitness sessions** — workout activity records: start, duration, intensity, calories burned.
- **Goals** — explicit user targets (weight, calorie band, protein floor, weekly session count) and progress toward them.
- **Sleep and other passive vitals** — folded in where an integration provides them, treated as additional signals on the same timeline.
- **Coaching** — pattern detection, daily and weekly summaries, AI commentary, conversational follow-ups.
- **Reconciliation** — adjusting recorded data after the fact when a more accurate signal arrives.

### Out of scope

- **Real-time workout governance** — the heart-rate-driven lock-and-unlock flow that gates what plays during a fitness session lives in the fitness system. The health system consumes the *result* of a session (it happened, this long, this intensity) but does not participate in moment-to-moment session control. See the fitness reference for governance details.
- **Medical data** — the system describes habits and trends, not diagnostic information. There is no medication tracking, lab result ingestion, or clinical decision support.
- **Multi-household pooling** — every record belongs to one user in one household. There is no aggregation across households.

---

## Capabilities at a glance

| User can… | Surface | Data behind it |
|---|---|---|
| See today's weight, calories, protein, and sessions at a glance | Health hub on the screen | Daily summary for today |
| Drill into a specific dimension and see history | Health detail view | Longitudinal aggregate for that dimension |
| Log food in plain language and see it parsed into structured items | Telegram bot, food entry inline on the hub | Food log, food catalog |
| Log a meal from a photo and see it parsed into structured items | Telegram bot | Food log, food catalog |
| Accept, revise, or discard an AI-parsed food entry | Telegram bot | Pending log entry, food catalog |
| Quick-add a frequent food without re-typing | Hub food entry, Telegram bot | Food catalog |
| See remaining calorie and protein budget for the day | Hub, Telegram bot, post-report coaching | Daily summary, user goals |
| Receive a morning brief that frames the day ahead | Telegram bot | Daily summary, longitudinal aggregate, recent coaching |
| Receive a post-report summary after the last meal of the day | Telegram bot | Daily summary, recent coaching, recent food items |
| Receive a weekly digest comparing this week to long-term average | Telegram bot | Longitudinal aggregate |
| Receive a reaction after a fitness session ends | Telegram bot | Session record, daily summary |
| Edit, delete, or annotate a logged food item | Hub detail, Telegram bot | Food log |
| See trend lines for weight, calories, protein, and sessions over weeks, months, years | Hub detail, charts | Longitudinal aggregate |
| Set or revise nutrition and fitness goals | Hub detail, Telegram bot | User goals |
| See how recently each data source has reported | Hub recency card | Source freshness |
| See progress against active fitness-related life goals | Hub goals card | Life plan goals filtered by health relevance |

---

## Subsystems

The health system has three subsystems, each with its own deep-dive document.

**Data pipeline.** The data pipeline ingests health events from multiple sources — passive sensors, manual entries, third-party integrations — and produces a single normalized, longitudinal record per user. It owns the transformation from raw events into daily summaries and longitudinal aggregates that the rest of the system reads. Everything downstream (the hub, the coach, the bot) reads from the pipeline's output, never from raw sources. See `data-pipeline.md`.

**Coaching system.** The coaching system turns aggregated data into timely, user-facing reflection. It detects patterns across recent days, composes a deterministic status block of factual numbers, asks the LLM for commentary anchored on that block, and delivers the result through a messaging surface. It also responds to on-demand conversation, using the same data the deterministic flows rely on. See `coaching-system.md`.

**Health app frontend.** The health app is the visual surface a user sees on the screen. It presents an at-a-glance hub of summary cards, lets the user drill into any card for history and trend lines, and supports inline interactions for quick logging and goal editing. It is read-only with respect to history and read-write for new entries. See `health-app-frontend.md`.

```
            ┌────────────────────────────────┐
            │  Sources                       │
            │  scale, food log, fitness      │
            │  sessions, integrations,       │
            │  manual entries                │
            └──────────────┬─────────────────┘
                           │ events
                           ▼
            ┌────────────────────────────────┐
            │  Data pipeline                 │
            │  ingest → normalize →          │
            │  daily aggregate →             │
            │  longitudinal aggregate        │
            └──────┬─────────────┬───────────┘
                   │             │
        snapshots  │             │ aggregates
                   ▼             ▼
        ┌──────────────────┐  ┌──────────────────┐
        │  Coaching system │  │  Health frontend │
        │  patterns →      │  │  hub cards →     │
        │  status block →  │  │  detail charts   │
        │  LLM commentary  │  │                  │
        │  → delivery      │  │                  │
        └────────┬─────────┘  └────────┬─────────┘
                 │                     │
                 ▼                     ▼
            Telegram             Screen / TV
```

---

## Identity model

Every weight, meal, and session belongs to one person; configuration and shared dashboards belong to the household they're part of. The health system is **per-user**, **household-scoped**.

- A **user** is the unit of health data. Every weight reading, food log, session, goal, and coaching message is owned by exactly one user.
- A **household** groups users who share a physical environment. It is the unit of configuration (which integrations are enabled, which messaging platforms are used, which AI provider) and of shared dashboards.
- A user is identified by a stable username string. The username keys all per-user storage and routes all per-user API calls.
- A household is identified by a stable household ID. Cross-user features (a household-wide leaderboard, shared goals) reference users by username within a single household.

Personalization — goals, timezone, messaging conversation IDs, integrations enabled for that user — is attached to the user. Provider selection (which AI model, which messaging platform, which scale integration to trust) is attached to the household.

The system addresses individuals consistently: API endpoints take a username, datastores key on username, coaching messages are delivered to the user's configured conversation. There is no implicit "current user" — every read and write specifies whose data it concerns.

---

## Time scales

The health system operates at three time scales simultaneously. Every feature lives at one of them, and the deeper docs return to this distinction repeatedly.

### Real-time

Real-time data is *moment-to-moment*: a heart rate sample broadcast over the wire, the in-progress state of an active fitness session, a food entry that has just been parsed but not yet confirmed. Real-time signals are short-lived, frequently updated, and consumed by surfaces that show "what is happening right now."

The health system is largely *not* a real-time system. Real-time fitness governance lives in the fitness reference. The health system *receives* a fitness session as a completed record; it does not orchestrate the session itself. The one place real-time matters in health is the food-logging confirmation loop, where a freshly parsed item is briefly suspended awaiting user accept or revise.

### Daily

Daily is the system's primary cadence. A **daily summary** is the canonical answer to "what did this user eat, weigh, and do today?" — calories, macros, weight, completed sessions, goal progress, all rolled up to one record per user per date. Daily summaries are the output of the data pipeline and the input of almost everything else: the hub renders them, the coach reads them, the bot quotes them.

A daily summary is **deterministic given its inputs** — re-running aggregation on the same source data yields the same record. It is also **revisable**: a late food log, an after-the-fact correction, or a reconciliation pass updates the summary in place, and any view that re-reads it sees the new state.

### Longitudinal

Longitudinal is everything that spans more than a day: the weight trend over six weeks, the average daily protein over the last quarter, the streak of days within calorie budget, the chart that shows the last two years of session count by week. A **longitudinal aggregate** is a series of values keyed by time bucket (day, week, month) with statistical rollups (average, range, count, trend slope).

Longitudinal aggregates are the substrate for both visualization and pattern detection. The hub charts read them directly. The coach reads them to anchor commentary in a longer view ("this week's average is below your three-month average"). They are computed from the same daily summaries the hub uses, so the numbers always agree.

---

## Data sources

The system ingests health data from four kinds of sources — passive sensors, active capture, manual entry, and derived passes. The pipeline normalizes all of them into the same daily-summary shape.

| Source | Type | Produces |
|---|---|---|
| Smart scale | Passive sensor (via integration) | Weight, body fat percentage, lean mass, water weight, multi-day trend |
| Fitness sessions | Active capture | Completed session record: start, duration, participants, intensity, calories burned, media context |
| Activity tracker | Passive sensor (via integration) | Steps, heart rate, workout activities, calories burned, sleep where supported |
| Food log via Telegram | Manual entry, AI-parsed | Structured food items with name, calories, macros, meal time, color category |
| Food log via web | Manual entry, structured form | Same as Telegram food log |
| Quick-add from food catalog | Manual entry, recurring item | Food item from a previously logged or seeded entry |
| Manual annotations | Manual entry | Notes, corrections, deletions on existing entries |
| Reconciliation passes | Derived | Adjusted nutrition values reflecting tracking-accuracy estimation, portion correction, phantom calories |
| Coaching history | Derived | Past coaching messages used as memory for future coaching |

An adapter for each source reads its native format and emits a normalized event. A user can have any subset of sources enabled; the pipeline tolerates missing sources and produces partial daily summaries from what it has.

---

## Cross-system relationships

### Fitness

Fitness is a **provider** to the health system. When a fitness session ends, the session record (start time, duration, participants, intensity, media) is written to the session datastore. The health pipeline reads completed sessions and folds them into the daily summary as workout entries. The fitness session itself — heart rate sensors, governance lock, video playback, real-time UI — is the fitness system's responsibility. The health system never sees a session in progress; it sees a session that has been completed and persisted.

The health hub's *Sessions* card and the fitness coach's daily reaction both consume session records, but they consume them from the same persisted source.

### Nutribot (Telegram surface)

Nutribot is the messaging-platform surface for nutrition logging and coaching. It receives a free-text or photo message, asks the LLM to parse it into structured food items, presents the parse to the user for confirmation, and writes accepted items to the food log. It is also the channel through which the coaching system delivers morning briefs, post-report summaries, weekly digests, and exercise reactions.

Nutribot is a **delivery surface**, not a separate data store. Every food item it captures lands in the same food log the web hub reads from. Every coaching message it delivers comes from the same coaching pipeline the dashboard quotes from. Two surfaces, one source of truth.

### Life

Life is the household's goal-and-purpose framework. The health system reads from life:

- **Goals** — life plan goals tagged with health metrics (weight target, weekly session count, protein floor) appear on the health hub's goals card. Goal state and progress come from life; the health hub is a read-only consumer.
- **Lifelog evidence** — health events (a workout completed, a weight logged, a goal milestone hit) are surfaced into the lifelog timeline so the broader life view includes health context.

The health system does not write back to life. It surfaces life data alongside its own.

### Telegram

Telegram is the **delivery channel** the coaching system uses. The coaching system asks a messaging gateway to send a formatted message to a user's configured conversation; the gateway's choice of platform (Telegram, in this household) is configured at the household level. The coaching system itself does not depend on Telegram-specific features — it produces a message and a target conversation, the gateway handles the rest.

### LLM provider

The LLM is a commentary and parsing layer; it never has authority to invent numbers, override facts, or overwrite established data. The coaching system, the food parser, and the on-demand health agent all consume an LLM. The provider, model, and mini-model are configured at the household level and selected per call. The LLM receives a deterministic snapshot of facts and returns prose or structured output. See `coaching-system.md` for the constraints in detail.

---

## Glossary

Definitions of terms used across all four health reference documents. When a deeper doc uses any of these terms, this is where they are defined.

**Adjusted nutrition.** A version of a daily nutrition summary refined by a reconciliation pass. Reflects tracking-accuracy estimation, portion correction, and phantom calories. Coexists with the raw logged nutrition; both are stored.

**Aggregate.** A rollup of underlying records over a time bucket. The two operative forms are **daily aggregate** (one record per user per date) and **longitudinal aggregate** (a series of values keyed by time bucket: day, week, month). Aggregates are deterministic given their inputs and recomputed when inputs change.

**Coaching message.** A user-facing piece of reflection delivered through a messaging surface. Composed of a deterministic status block plus optional LLM commentary. Persisted as part of the user's coaching history.

**Daily summary.** The canonical record of a user's day: calories, macros, weight, sessions, goal progress, and any source-specific extras. Output of the data pipeline; primary input of the hub and the coach.

**Delivery surface.** A channel through which the coaching system or food log reaches the user. Surfaces are interchangeable from the data layer's perspective — the food log is the same record whether it was created through Telegram or through the web hub.

**Exercise reaction.** A coaching message triggered by the completion of a fitness session, framing how the session affects the day's calorie budget and the week's session count.

**Food catalog.** A per-user collection of frequent or seeded food items, surfaced as quick-add chips. Derived from the user's food log over time.

**Food item.** A single structured entry in the food log: name, calories, macros (protein, carbs, fat) plus other tracked nutrients (fiber, sodium, sugar, cholesterol), meal time, color category, source (Telegram or web), and identifying UUID.

**Food log.** The full set of a user's food items, keyed by date. Mutable: items can be added, edited, deleted, and annotated.

**Goal.** A user-declared target: a calorie band, a protein floor, a target weight, a weekly session count, a streak. Lives in the life plan; read into the health system for display and progress framing.

**Household.** The unit of configuration and of shared dashboards. Groups users who share a physical environment. Identified by a household ID.

**Insight.** See *Pattern*. An *Insight* is a Pattern selected for delivery in a coaching message.

**Longitudinal aggregate.** A series of values keyed by time bucket — daily, weekly, monthly — with statistical rollups (average, range, count, trend slope). Derived from daily summaries. Used for charts and for long-view coaching context.

**Macro.** A macronutrient category: protein, carbs, fat. Tracked per food item and rolled up per daily summary.

**Morning brief.** A coaching message delivered at the start of the day, framing yesterday's totals, the weekly average, and the day ahead.

**Pattern.** A detected trend or break in recent daily summaries (binge after deficit, calorie surplus, protein short, on track) that the coach can reference in commentary. A *Pattern* selected for delivery in a coaching message is called an *Insight*.

**Post-report summary.** A coaching message delivered after the user's last food log of the day, summarizing the day's totals against goals and noting notable items.

**Quiet hours.** A user-configured time window during which automatic coaching deliveries are suppressed. On-demand requests are honored regardless.

**Reconciliation.** The process of revising a previously computed daily summary in light of a more accurate signal arriving later — a scale reading that suggests yesterday's logged calories were under-counted, a corrected food item, a deleted entry. Produces an adjusted version while preserving the raw original.

**Session.** A completed fitness session record: start, end, duration, participants, intensity profile, calories burned, media context. Owned by the fitness system; consumed by the health system.

**Snapshot.** The compact, structured object the coaching system hands to the LLM. Contains the deterministic facts the LLM is allowed to comment on (today's totals, recent days, weight trend, recent coaching). The LLM may rephrase but may not invent or contradict the snapshot.

**Source freshness.** The age of the most recent data point from each source. Surfaced on the hub's recency card so a user can see which integrations are reporting and which have gone silent.

**Status block.** The deterministic, factual layer of a coaching message. Numbers and goal-relative framing computed from the daily summary. The LLM may not rewrite the status block — its commentary is appended below.

**User.** The unit of health data ownership. Identified by a stable username. Belongs to exactly one household.

**Weekly digest.** A coaching message delivered at the end of the week, comparing the week's averages to the long-term averages and to the previous week.

---

## Where it lives

### Backend

- `backend/src/2_domains/health/` — health domain entities and pure aggregation logic.
- `backend/src/2_domains/nutrition/` — nutrition domain entities, schemas, and food log services.
- `backend/src/3_applications/health/` — health aggregation use case, dashboard composition, food catalog, longitudinal aggregation, reconciliation.
- `backend/src/3_applications/coaching/` — coaching orchestration, message builder, pattern detection, snapshots, commentary service.
- `backend/src/3_applications/agents/health-coach/` — on-demand AI health coach.
- `backend/src/3_applications/nutribot/` — Telegram nutrition surface (container, handlers, jobs, use cases).
- `backend/src/1_adapters/persistence/yaml/` — YAML datastores for health, nutrition, food catalog, coaching history.
- `backend/src/1_adapters/health/` — adapters for external health data sources.

### API

- `/api/v1/health/*` — daily summaries, longitudinal aggregates, dashboard, weight, workouts, fitness, nutrition, coaching, status, food catalog.
- `/api/v1/health-dashboard/*` — pre-composed dashboard documents for read-only display.
- `/api/v1/nutrition/*` — nutrition logs, daily and weekly summaries, range queries.

### Frontend

- `frontend/src/modules/Health/` — hub, detail views, cards, charts.
- `frontend/src/Apps/` — top-level health app entry, route, and navigation.

### Configuration and data

- `data/household/config/integrations.yml` — household-level provider selection (AI, messaging, finance, gallery).
- `data/users/{username}/health/` — per-user weight, fitness, nutrition, coaching, dashboard documents.
- `data/users/{username}/lifeplan.yml` — goals consumed by the health hub.
