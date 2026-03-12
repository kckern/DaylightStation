# Life Domain Architecture

**Last Updated:** 2026-03-12

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
| FeedbackService | Observation recording |
| RetroService | Retrospective generation |
| MetricsService | Monthly rollup computation |
| BriefingService | AI-powered daily briefing |

### 0_system/scheduling/

| File | Purpose |
|------|---------|
| CeremonyScheduler | Checks due ceremonies and sends notifications |

### 0_system/bootstrap/

| File | Purpose |
|------|---------|
| lifeplan.mjs | Wires all services, creates router, returns { router, container, ceremonyScheduler, services } |

### 4_api/v1/routers/life/

| Route | File | Purpose |
|-------|------|---------|
| `/plan` | plan.mjs | CRUD for plan sections, goal transitions, belief evidence, ceremony endpoints |
| `/now` | now.mjs | Alignment data, drift snapshots |
| `/log` | log.mjs | Lifelog aggregation (day, range, scope, category) |
| `/health` | (in life.mjs) | System health check |

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
| useLifelog | Lifelog data fetching |
| useCeremony | Ceremony flow step management |

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
