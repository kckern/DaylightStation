# Life Domain Architecture

**Last Updated:** 2026-07-10

---

## Overview

The Life domain implements the JOP (Joy on Purpose) life planning framework. It provides structured goal tracking, belief testing, value alignment monitoring, and ceremonial review cadences.

The domain spans all DDD layers and integrates with the existing Lifelog aggregation pipeline for evidence-based tracking.

---

## Layer Map

### 2_domains/lifeplan/

Pure business logic — no I/O, no external dependencies.

| Directory | Key Files | Purpose |
|-----------|-----------|---------|
| `entities/` | LifePlan, Goal, Belief, Value, Quality, Purpose | Core domain models with state machines |
| `services/` | GoalStateService, BeliefEvaluator, BeliefCascadeProcessor, CadenceService, DependencyResolver, ValueDriftCalculator, RuleMatchingService, ProgressCalculator, LifeEventProcessor, BiasCalibrationService, ShadowDetectionService, NightmareProximityService, PastProcessingService | Domain logic services |
| `value-objects/` | GoalState, BeliefState | Frozen enum-style state definitions |

**State Machines:**
- Goals: 9 states (considered → ready → active → progressing → paused → completed/abandoned/blocked/failed)
- Beliefs: 9 states (hypothesized → testing → confirmed/uncertain/refuted → questioning → revised/abandoned/dormant)

### 1_adapters/lifeplan/

External integrations for the lifeplan domain.

| Directory | Key Files | Purpose |
|-----------|-----------|---------|
| `metrics/` | StravaMetricAdapter, CalendarMetricAdapter, TodoistMetricAdapter, SelfReportMetricAdapter | Pull metrics from lifelog sources |
| `signals/` | BeliefSignalDetector, LifeEventSignalDetector | Detect belief evidence and life events from lifelog |

### 1_adapters/persistence/yaml/

| File | Purpose |
|------|---------|
| YamlLifePlanStore | Read/write lifeplan YAML |
| YamlLifeplanMetricsStore | Snapshot history for drift/rollup |
| YamlCeremonyRecordStore | Track completed ceremonies |

### 3_applications/lifeplan/

| File | Purpose |
|------|---------|
| LifeplanContainer | DI container with lazy-loaded getters |
| PlanAuthoringService | Plan genesis (creates the first empty `lifeplan.yml`) and section authoring (append/update goals, values, beliefs). Backs the `POST /plan`, `POST /plan/goals\|values\|beliefs` routes and the coach write-tools |
| DriftService | Value drift computation + persistence |
| AlignmentService | Priority alignment from plan + metrics |
| CeremonyService | Ceremony content assembly + completion |
| CeremonyScheduler | Checks due ceremonies per user, sends notification intents (moved here from 0_system/scheduling per DDD audit S-2) |
| FeedbackService | Observation recording |
| RetroService | Retrospective generation |
| MetricsService | Monthly rollup computation (not yet wired) |
| BriefingService | AI-powered daily briefing (not yet wired) |

### 3_applications/notification/ + 1_adapters/notification/

The notification bounded context routes NotificationIntents (title/body/category/urgency/metadata) to channel adapters by category preference:

| Channel | Adapter | Delivery |
|---------|---------|----------|
| app | AppNotificationAdapter | WebSocketEventBus broadcast on the `notification` topic. The frontend `useAppNotifications` hook subscribes to the same shared WS client and renders a Mantine toast; intents carrying `metadata.username` are shown only to that user, unaddressed intents broadcast to everyone. Action urls are gated to `http(s)`/relative (`javascript:`/`mailto:`/`data:` fall back to a non-clickable toast) |
| telegram | TelegramNotificationAdapter | Chat id resolved from profile `identities.telegram.user_id`; sends via the SystemBotLoader telegram adapter. Ceremony intents attach inline "Begin" buttons whose callback deep-links into the ceremony flow — this requires `system.public_url` to be configured; when it is unset (current state) the adapter degrades to a text-only message with no button |
| push | PushNotificationAdapter | Home Assistant `notify.<service>`; service name from profile `identities.homeassistant.notify_service` |

Default routing: `ceremony` → telegram+push+app, `drift_alert` → telegram+app, others app-only.

### 5_composition/modules/

| File | Purpose |
|------|---------|
| lifeplan.mjs | Wires all services, creates router, returns { router, container, ceremonyScheduler, services } |
| notifications.mjs | Composes the notification stack (channel adapters + preference routing); injected into lifeplan and agents |

### Scheduled tasks

`lifeplan:ceremony-check` runs **hourly** on the agents Scheduler (Docker/prod, or `ENABLE_CRON=true` in dev). It iterates `YamlLifePlanStore.listUsernames()` and calls `CeremonyScheduler.checkAndNotify(username)`. Running hourly (rather than once at 07:00) lets each ceremony fire at its own configured delivery hour (see Per-ceremony delivery below). Ceremonies with UI flows (unit_intention, unit_capture, cycle_retro, phase_review) default to enabled; season/era require explicit `ceremonies.<type>.enabled: true` in the plan. Completed ceremonies dedupe per period via ceremony records — because ceremony records are keyed by `periodId`, the one-time cadence `periodId` scheme shift (below) resets the current-period dedupe once, so a ceremony already completed under the old id may be re-offered a single time.

`lifeplan:drift-refresh` runs **nightly**. It iterates users and calls `DriftService` to recompute and persist the latest value-drift snapshot from lifelog data, so `drift_alert` notifications and the Now view reflect current allocation without waiting for a cycle-boundary ceremony.

### 4_api/v1/routers/life/

| Route | File | Purpose |
|-------|------|---------|
| `GET /plan` | plan.mjs | Full plan (returns `{}` when the user has no plan yet) |
| `POST /plan` | plan.mjs | **Genesis** — create the first empty `lifeplan.yml` for the user (201). Idempotent-ish: does not clobber an existing plan |
| `POST /plan/goals\|values\|beliefs` | plan.mjs | Append a new goal/value/belief; returns the created entity (201) |
| `/plan/...` | plan.mjs | Section updates, goal transitions, belief evidence, ceremony endpoints |
| `GET /plan/ceremony/:type` | plan.mjs | Ceremony content; `404 { code: NO_PLAN }` when no plan exists, `400` for an unknown ceremony type |
| `GET /plan/cadence` | plan.mjs | Resolved cadence for the current instant (unit/cycle/phase/season/era) |
| `/now` | now.mjs | Alignment data, drift snapshots |
| `/log` | log.mjs | Lifelog aggregation (day, range, scope, category) |
| `/schedule` | schedule.mjs | Ceremony schedule export (rrule formats) |
| `GET /user` | (in life.mjs) | Resolved identity for the requesting client (`{ username, displayName }`) |
| `GET /users` | (in life.mjs) | Household roster for the user switcher (`{ users: [{ username, displayName }] }`) |
| `/health` | (in life.mjs) | System health check |

**User identity:** every life route resolves the user via `life/identity.mjs`: `?username=` query param, else the configured default (head of household from `configService.getHeadOfHousehold()`). Usernames are validated against `UserService.getProfile()` — unknown users get 404. Log routes validate their `:username` path param the same way.

`GET /users` backs the household **user switcher** in the LifeApp header (lets a shared display switch whose plan is shown). The switcher only renders when the roster has more than one member. The roster is drawn from `households.<hid>.users` in `system.yml`, which **must be configured as a YAML array**; when it is a bare string (current state in some environments) the roster resolves empty and the switcher stays hidden. `GET /user` (singular) drives `useLifeUser`/`LifeUserContext`, which also keys CoachChat agent memory to the real user.

---

## Key Concepts

### Cadence System

Time is structured into nested levels:
- **Unit** (default: day) — smallest tracking period
- **Cycle** (default: week) — ceremony and review rhythm
- **Phase** (default: month) — medium-term planning
- **Season** (default: quarter) — strategic alignment
- **Era** (default: year) — vision-level planning

CadenceService resolves any date to its position in all levels.

**Household-local calendar-day resolution.** Period boundaries are computed on calendar days in the household's local timezone, not on UTC instants — so "today", the cycle start, etc. do not slip a day for users west of UTC late in the evening. Each resolved period carries a stable `periodId` (e.g. `2026-U557`, `2026-C79`).

**Monday-default epoch.** The default cadence anchors cycles (weeks) to Monday, using the epoch **2024-12-30** (itself a Monday). Consequently `current.cycle.startDate` is always the most recent Monday on or before today (verified live: on Fri 2026-07-10 the cycle start resolved to Mon 2026-07-06). The era epoch is the Monday on/before Jan 1 (e.g. 2025-12-30 for 2026). This periodId scheme is a change from the earlier resolution; see the ceremony-record dedupe note under Scheduled tasks for the one-time reset it causes.

**Per-ceremony delivery hours.** Each ceremony's local delivery hour comes from `plan.ceremonies.<type>.at` (0–23). Defaults when unset: **unit_intention 07**, **unit_capture 20**, all others **17**. The hourly `lifeplan:ceremony-check` task fires each ceremony when the local hour matches, which is why the task moved from a single 07:00 run to hourly.

### Belief Evidence Model

Beliefs follow an if/then hypothesis pattern. Evidence is collected over time with:
- **Confidence** — Bayesian-style, adjusted for sample size and bias
- **Bias Calibration** — Detects confirmation and recency bias
- **Dormancy** — Untested beliefs decay after 60+ days
- **Cascade** — Refuting a foundational belief triggers review of dependent beliefs, values, qualities, and purpose

### Value Drift Detection

Uses Spearman rank correlation between declared value priorities and actual time allocation from lifelog data. Drift is computed per cycle and persisted as snapshots.

### Ceremony Types

| Type | Cadence | Purpose |
|------|---------|---------|
| unit_intention | unit | Set daily intentions |
| unit_capture | unit | End-of-day observations; echoes back the same day's morning `unit_intention` entries so the capture reflects against what was set |
| cycle_retro | cycle | Weekly retrospective |
| phase_review | phase | Monthly deep review |
| season_alignment | season | Quarterly value alignment |
| era_vision | era | Annual vision setting |

---

## Data Files

All stored under `data/users/{username}/`:

| File | Purpose |
|------|---------|
| `lifeplan.yml` | Full life plan (goals, beliefs, values, qualities, purpose, cadence) |
| `lifeplan-metrics.yml` | Drift snapshots and monthly rollups |
| `ceremony-records.yml` | Completed ceremony history |

---

## Frontend

### Hooks (`frontend/src/modules/Life/hooks/`)

| Hook | Purpose |
|------|---------|
| useLifePlan | Full plan fetch + section updates |
| useGoals | Goal list + state transitions |
| useGoalDetail | Single goal detail |
| useBeliefs | Belief list + evidence injection |
| useCeremonyConfig | Cadence configuration |
| useLifelog | Lifelog data fetching (username defaults from LifeUserContext) |
| useCeremony | Ceremony flow step management |
| useLifeUser | Fetches `/life/user`; LifeApp provides it via LifeUserContext (also keys CoachChat's agent memory to the real user) |

### Views

| Directory | Components |
|-----------|------------|
| `views/plan/` | PurposeView, QualitiesView, ValuesView, BeliefsView, GoalsView, GoalDetail, CeremonyConfig |
| `views/now/` | Briefing |
| `views/log/` | LogBrowser, LogTimeline, LogDayDetail, LogWeekView, LogMonthView, LogSeasonView, LogYearView, LogDecadeView, LogCategoryView |
| `views/ceremony/` | CeremonyFlow, UnitIntention, UnitCapture, CycleRetro, PhaseReview |

### App Entry Point

`frontend/src/Apps/LifeApp.jsx` — Mantine-based app with tabbed navigation for Now, Plan (nested sub-routes), Log, and Ceremony views.

---

## Testing

| Location | Type | Coverage |
|----------|------|----------|
| `tests/isolated/domain/lifeplan/` | Unit | Entities, services, state machines |
| `tests/isolated/lifeplan/services/` | Unit | Application services |
| `tests/isolated/lifeplan/signals/` | Unit | Signal detectors |
| `tests/isolated/lifeplan/lifecycle/` | Simulation | Longitudinal lifecycle scenarios |
| `tests/isolated/api/routers/` | Unit | API router endpoints |
| `tests/integrated/lifeplan/` | Integration | Aggregator, metrics persistence, ceremony delivery |
