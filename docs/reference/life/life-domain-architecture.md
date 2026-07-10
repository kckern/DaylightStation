# Life Domain Architecture

**Last Updated:** 2026-07-09

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
| app | AppNotificationAdapter | WebSocketEventBus broadcast |
| telegram | TelegramNotificationAdapter | Chat id resolved from profile `identities.telegram.user_id`; sends via the SystemBotLoader telegram adapter |
| push | PushNotificationAdapter | Home Assistant `notify.<service>`; service name from profile `identities.homeassistant.notify_service` |

Default routing: `ceremony` → telegram+push+app, `drift_alert` → telegram+app, others app-only.

### 5_composition/modules/

| File | Purpose |
|------|---------|
| lifeplan.mjs | Wires all services, creates router, returns { router, container, ceremonyScheduler, services } |
| notifications.mjs | Composes the notification stack (channel adapters + preference routing); injected into lifeplan and agents |

### Scheduled tasks

`lifeplan:ceremony-check` runs daily at 07:00 on the agents Scheduler (Docker/prod, or `ENABLE_CRON=true` in dev). It iterates `YamlLifePlanStore.listUsernames()` and calls `CeremonyScheduler.checkAndNotify(username)`. Ceremonies with UI flows (unit_intention, unit_capture, cycle_retro, phase_review) default to enabled; season/era require explicit `ceremonies.<type>.enabled: true` in the plan. Completed ceremonies dedupe per period via ceremony records.

### 4_api/v1/routers/life/

| Route | File | Purpose |
|-------|------|---------|
| `/plan` | plan.mjs | CRUD for plan sections, goal transitions, belief evidence, ceremony endpoints |
| `/now` | now.mjs | Alignment data, drift snapshots |
| `/log` | log.mjs | Lifelog aggregation (day, range, scope, category) |
| `/schedule` | schedule.mjs | Ceremony schedule export (rrule formats) |
| `/user` | (in life.mjs) | Resolved identity for the requesting client |
| `/health` | (in life.mjs) | System health check |

**User identity:** every life route resolves the user via `life/identity.mjs`: `?username=` query param, else the configured default (head of household from `configService.getHeadOfHousehold()`). Usernames are validated against `UserService.getProfile()` — unknown users get 404. Log routes validate their `:username` path param the same way.

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
| unit_capture | unit | End-of-day observations |
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
