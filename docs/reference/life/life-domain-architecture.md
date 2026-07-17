# Life Domain Architecture

**Last Updated:** 2026-07-17 — refreshed after the "beautiful and usable" merge (stage/completeness dashboard model, CeremonyDueResolver, `POST /plan/purpose`, the lifeplan-guide coach agent, the frontend design-system layer, and an honesty pass on which domain services are actually wired)

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
| `services/` | GoalStateService, BeliefEvaluator, BeliefCascadeProcessor, CadenceService, DependencyResolver, ValueDriftCalculator, CeremonyDueResolver, RuleMatchingService, ProgressCalculator, LifeEventProcessor, BiasCalibrationService, ShadowDetectionService, NightmareProximityService, PastProcessingService | Domain logic services |
| `value-objects/` | GoalState, BeliefState | Frozen enum-style state definitions |

**State Machines:**
- Goals: 9 states (considered → ready → active → progressing → paused → completed/abandoned/blocked/failed)
- Beliefs: 9 states (hypothesized → testing → confirmed/uncertain/refuted → questioning → revised/abandoned/dormant)

#### CeremonyDueResolver (`services/CeremonyDueResolver.mjs`)

The SSOT for ceremony **dueness logic** — which ceremonies are due today for a plan, independent of delivery hour. Exports `CEREMONY_TIMING` (per-type timing keyword, e.g. `start_of_unit`/`end_of_cycle`), `CEREMONY_CADENCE_MAP` (type → cadence level), `DEFAULT_ENABLED` (`['unit_intention', 'unit_capture', 'cycle_retro', 'phase_review']`), and `CEREMONY_TITLES` (terse card labels), plus a `listDue({ plan, cadencePosition, cadenceConfig, today, hasRecord })` method that walks every ceremony type, checks `plan.ceremonies.<type>.enabled` (falling back to `DEFAULT_ENABLED`), skips types with no resolved `periodId` or an existing completion record, and delegates the actual due-check to `CadenceService.isCeremonyDue`.

It has two consumers, deliberately sharing constants but not presentation:
- **AlignmentService** (dashboard) — calls `listDue()` with no time-of-day gate, to surface a `ceremony_due` priority as soon as the period opens.
- **CeremonyToolFactory** (coach) — same resolver, for the `check_ceremony_status` tool.
- **CeremonyScheduler** (notification sender) — imports only the shared constants (`CEREMONY_TIMING`/`CEREMONY_CADENCE_MAP`/`DEFAULT_ENABLED`) and additionally hour-gates delivery; it keeps its **own** `TITLES` map for push/Telegram copy ("Monthly Deep Review" vs. the dashboard's terse "Phase review") — two surfaces, one dueness SSOT, by design. See `backend/src/3_applications/lifeplan/services/CeremonyScheduler.mjs:9-39`.

#### Honesty pass — which domain services actually run

Not every service in the table above is reachable in production. Verified against `backend/src/5_composition/modules/lifeplan.mjs` (the only place lifeplan services are constructed) and `backend/src/3_applications/lifeplan/LifeplanContainer.mjs`:

- **Wired and reachable:** GoalStateService, BeliefEvaluator, CadenceService, ValueDriftCalculator (via DriftService), CeremonyDueResolver.
- **Constructed by `LifeplanContainer.getRouterConfig()` but never read by any router** — `DependencyResolver` and `BeliefCascadeProcessor` are lazily instantiated and land in the config object passed to `createLifeRouter`, but no file under `4_api/v1/routers/life/` destructures or calls them. They exist and are unit-tested (e.g. `belief-cascade.test.mjs`) but do nothing at runtime today.
- **Present, unit-tested, never constructed anywhere** — `RuleMatchingService`, `ProgressCalculator`, `LifeEventProcessor`, `BiasCalibrationService`, `ShadowDetectionService`, `NightmareProximityService`, `PastProcessingService`. All seven are exported from `services/index.mjs`, but that barrel file has no importer anywhere in `backend/` (`grep -rln "services/index" backend/` turns up nothing outside itself) — they're reachable only from their own test files. In particular, `NightmareProximityService` computing `AntiGoal.proximity` is the exact re-enable condition for the suppressed `anti_goal_warning` priority (see AlignmentService below) — until something calls it on a schedule, `anti_goal_warning` stays off.

### 1_adapters/lifeplan/

External integrations for the lifeplan domain.

| Directory | Key Files | Purpose |
|-----------|-----------|---------|
| `metrics/` | StravaMetricAdapter, CalendarMetricAdapter, TodoistMetricAdapter, SelfReportMetricAdapter | Pull metrics from lifelog sources |
| `signals/` | BeliefSignalDetector, LifeEventSignalDetector | Detect belief evidence and life events from lifelog |

**Not wired.** None of the four metric adapters, the `IMetricSource` port they'd implement (`backend/src/3_applications/lifeplan/ports/IMetricSource.mjs`), or the two signal detectors are constructed anywhere under `5_composition/`. They exist with unit test coverage (e.g. `belief-signal-detector.test.mjs`) but have no production caller — `DriftService` computes value drift straight from the Lifelog aggregator, not through this metrics-adapter layer.

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
| AlignmentService | Priority alignment + dashboard model from plan + metrics (see below) |
| CeremonyService | Ceremony content assembly + completion |
| CeremonyScheduler | Checks due ceremonies per user, sends notification intents (moved here from 0_system/scheduling per DDD audit S-2) |
| FeedbackService | Observation recording |
| RetroService | Retrospective generation |
| MetricsService | Monthly rollup computation (not yet wired — see honesty pass above) |
| BriefingService | AI-powered daily briefing (not yet wired — see honesty pass above) |

#### AlignmentService (`backend/src/3_applications/lifeplan/services/AlignmentService.mjs`)

`computeAlignment(username)` returns `{ priorities, dashboard, briefingContext, _meta }`. Two things changed since the previous revision of this doc:

**1. Stage + completeness model.** `#computeStage(plan)` (line 62) derives a coarse `stage` — `'scaffolding'` or `'active'` — from `completeness: { hasPurpose, valueCount, goalCount, beliefCount }`. A plan graduates to `'active'` once it has a purpose statement, ≥2 values, and ≥1 active goal; otherwise it's `'scaffolding'`. Both `stage` and `completeness` are returned on `dashboard`, and drive the frontend's setup checklist (`Dashboard.jsx`).

**2. Priority types.** `#computePriorities` (line 72) now emits five priority types, not three:
- `dormant_belief` and `goal_deadline` — unchanged.
- `drift_alert` — unchanged (allowlisted to `'drifting'`/`'reconsidering'` snapshot statuses only; `'insufficient_data'` never fires one).
- `plan_gap` (new, line 126) — one-at-a-time nudge toward the next setup step for a sparse plan: "Name your purpose" → "Add a couple of core values" → "Set your first goal", each gated on the previous being satisfied.
- `ceremony_due` (new, line 135) — one item per ceremony the injected `CeremonyDueResolver.listDue()` reports due today that has no completion record yet; title comes from `CeremonyDueResolver.CEREMONY_TITLES`.
- `anti_goal_warning` is **deliberately suppressed** (line 105) — `AntiGoal.proximity` is a static field that's never computed (it would need `NightmareProximityService` running on a schedule; see the domain-services honesty pass above), so firing a priority off it would latch a "critical" alarm with no way to clear. The code comment cites this as a 2026-07-17 UX audit finding (§4). Re-enable only once proximity is computed live.

### 3_applications/notification/ + 1_adapters/notification/

The notification bounded context routes NotificationIntents (title/body/category/urgency/metadata) to channel adapters by category preference:

| Channel | Adapter | Delivery |
|---------|---------|----------|
| app | AppNotificationAdapter | WebSocketEventBus broadcast on the `notification` topic. The frontend `useAppNotifications` hook subscribes to the same shared WS client and renders a Mantine toast; intents carrying `metadata.username` are shown only to that user, unaddressed intents broadcast to everyone. Action urls are gated to `http(s)`/relative (`javascript:`/`mailto:`/`data:` fall back to a non-clickable toast) |
| telegram | TelegramNotificationAdapter | Chat id resolved from profile `identities.telegram.user_id`; sends via the SystemBotLoader telegram adapter. Ceremony intents attach inline "Begin" buttons whose callback deep-links into the ceremony flow — this requires `system.public_url` to be configured; when it is unset (current state) the adapter degrades to a text-only message with no button |
| push | PushNotificationAdapter | Home Assistant `notify.<service>`; service name from profile `identities.homeassistant.notify_service` |

Default routing: `ceremony` → telegram+push+app, `drift_alert` → telegram+app, others app-only.

**Not wired:** `EmailNotificationAdapter` (`backend/src/1_adapters/notification/EmailNotificationAdapter.mjs`) exists but is never constructed in `backend/src/5_composition/modules/notifications.mjs` — only App, Telegram, and Push are instantiated there.

### 3_applications/agents/lifeplan-guide/ — the coach agent

`LifeplanGuideAgent` (`backend/src/3_applications/agents/lifeplan-guide/LifeplanGuideAgent.mjs`) is a `BaseAgent` subclass registered with the agent orchestrator in `backend/src/5_composition/bootstrap.mjs` (imported line 281, `agentOrchestrator.register(LifeplanGuideAgent, {...})` around line 2719). It powers the "Coach" nav tab (`views/coach/CoachChat.jsx`) and a scheduled daily assignment.

**Tool factories** — `registerTools()` wires five, each scoped to one concern:

| Factory | File | Responsibility |
|---------|------|-----------------|
| PlanToolFactory | `tools/PlanToolFactory.mjs` | Read/write the plan: `get_plan`, `transition_goal`, `add_evidence`, `record_feedback`, `create_goal`, `add_value`, `add_belief`, `set_purpose` |
| LifelogToolFactory | `tools/LifelogToolFactory.mjs` | Lifelog aggregation + drift reads |
| CeremonyToolFactory | `tools/CeremonyToolFactory.mjs` | Ceremony status/content, backed by the same `CeremonyDueResolver` as the dashboard |
| NotificationToolFactory | `tools/NotificationToolFactory.mjs` | Sends action-message notifications (used by `CadenceCheck`) |
| CoachingToolFactory | `tools/CoachingToolFactory.mjs` | Working-memory read/update/feedback for the coaching relationship |

**Identity contract — tools cannot fabricate a user.** Every tool's JSON schema declares a `userId` parameter (so the model can reference it in reasoning), but the model's supplied value is never trusted: `MastraAdapter` wraps every tool through a decorator pipeline — `userIdInjector → callLimiter → transcriptRecorder` (`backend/src/1_adapters/agents/MastraAdapter.mjs:108,133`) — and `userIdInjector` (`backend/src/3_applications/agents/framework/decorators/UserIdInjector.mjs`) overwrites whatever `userId` the model passed with the real `context.userId` from the run. For scheduled (non-chat) runs, `BaseAgent.buildSystemPrompt` also appends an `"## Active User"` section naming the resolved user when `context.userId` is present (`backend/src/3_applications/agents/framework/BaseAgent.mjs:187,198-199`), so the model's own reasoning is grounded in the same identity the tools enforce.

**Confirm-gated writer tools.** `create_goal`, `add_value`, `add_belief`, `set_purpose`, `transition_goal`, and `add_evidence` all carry a shared description prefix — "Writes to the user's plan. Only call after the user has explicitly confirmed in conversation." (`PlanToolFactory.mjs:10`) — instructing the model to confirm before calling. `record_feedback` is explicitly exempt ("Executes immediately (no confirmation needed)"). The earlier `propose_*` tool variants (a two-step propose/confirm pattern) have been removed entirely — there is no `propose_` prefix anywhere left in the agent's tool set.

**Scheduled assignment.** `CadenceCheck` (`assignments/CadenceCheck.mjs`) runs on cron `'0 7 * * *'` (07:00). It gathers ceremony status, drift, and plan data via its own tool calls, skips the run entirely if nothing is overdue/due/drifting, otherwise has the model compose a single notification (message + action buttons) and sends it via the notification tool, also caching the result in agent memory (`pending_nudge`, 24h TTL) for frontend polling.

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
| `POST /plan/purpose` | plan.mjs | Set or replace the purpose statement; **planless-safe** — creates the plan first via `planAuthoringService.setPurpose` if none exists, same as the goal/value/belief authoring routes. Returns the purpose (201) |
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

### Design-system layer (`frontend/src/modules/Life/`)

A small shared design system underpins every view, added alongside the "beautiful and usable" pass:

| Path | Exports | Purpose |
|------|---------|---------|
| `components/` | `LifePage`, `SectionCard`, `EmptyState`, `LoadingState`, `ErrorState` (`components/index.js`) | Shared page/section chrome and the three async-state placeholders (loading/error/empty) used across views |
| `theme/semantics.js` | `goalStateColor`, `beliefConfidenceColor`, `driftStatusColor`, `priorityTypeMeta` | Single source of truth mapping domain states (goal state, belief confidence, drift status, priority type) to Mantine colors/metadata, so color meaning stays consistent across widgets |
| `lib/format.js` | `formatDate`, `formatDateRange`, `formatPeriodLabel`, `humanize` | Shared date/period/label formatting |
| `widgets/` | `BeliefConfidenceChip`, `CadenceIndicator`, `DriftGauge`, `GoalProgressBar`, `ValueAllocationChart` | Small reusable presentational widgets composed into views |

**Theme:** `frontend/src/Apps/LifeApp.theme.js` exports `lifeTheme`, a Mantine dark theme passed to `MantineProvider` in `LifeApp.jsx` (`defaultColorScheme="dark"`).

### Hooks (`frontend/src/modules/Life/hooks/`)

| Hook | Purpose |
|------|---------|
| useLifePlan | Full plan fetch + section updates. Also exports `planIsEmpty` and, co-located in the same file, `useGoals`, `useGoalDetail`, `useBeliefs`, and `useCeremonyConfig` |
| useGoals | Goal list + state transitions (in `useLifePlan.js`) |
| useGoalDetail | Single goal detail (in `useLifePlan.js`) |
| useBeliefs | Belief list + evidence injection (in `useLifePlan.js`) |
| useCeremonyConfig | Cadence configuration (in `useLifePlan.js`) |
| useAlignment | Fetches the `AlignmentService.computeAlignment` payload (`priorities`/`dashboard`/`briefingContext`) backing `Dashboard.jsx` and `PriorityList.jsx` |
| useDrift | Value-drift snapshot fetching |
| useLifelog | Lifelog data fetching (username defaults from LifeUserContext) |
| useCeremony | Ceremony flow step management |
| useLifeUser | Fetches `/life/user` and `/life/users`; `LifeApp` provides the resolved user via `LifeUserContext` and passes `lifeUser.username` into `CoachChat` as `userId`, which is how the coach agent's memory ends up keyed to the real user |
| useAppNotifications | Subscribes to the shared WS client's `notification` topic and renders the Mantine toast fallback channel |

### Views

| Directory | Components |
|-----------|------------|
| `views/plan/` | PurposeView, QualitiesView, ValuesView, BeliefsView, GoalsView, GoalDetail, CeremonyConfig |
| `views/now/` | **Dashboard** (not "Briefing" — see below), PriorityList |
| `views/coach/` | CoachChat — chat UI for the lifeplan-guide agent, gated on a resolved `lifeUser` so agent memory keys to the right person |
| `views/log/` | LogBrowser, LogTimeline, LogDayDetail, LogWeekView, LogMonthView, LogSeasonView, LogYearView, LogDecadeView, LogCategoryView, and `views/log/shared/` (ActivityHeatmap, CategoryFilter, ScopeSelector, SourceIcon) |
| `views/ceremony/` | CeremonyFlow, UnitIntention, UnitCapture, CycleRetro, PhaseReview |

**`views/now/` is `Dashboard.jsx` + `PriorityList.jsx`, not `Briefing.jsx`.** `Briefing.jsx` and its companion hook `useLifeStage.js` were deleted as orphans in the beautiful-and-usable merge — do not reference them; `Dashboard.jsx` now owns both the stage-driven setup checklist (reading `dashboard.stage`/`dashboard.completeness` from `useAlignment`) and the priority feed. `PriorityList.jsx` renders `AlignmentService`'s priorities per-user/per-day, is dismissable, tap-through to the relevant view, and is aware of the two newer priority types (`plan_gap`, `ceremony_due`) as well as the original three.

### App Entry Point

`frontend/src/Apps/LifeApp.jsx` — a Mantine `AppShell` (48px header, 200px collapsible sidebar navbar) rather than tabs. The sidebar has four top-level links — **Now**, **Log**, **Plan** (expandable, with six sub-links: Purpose, Goals, Beliefs, Values, Qualities, Ceremonies), and **Coach** — plus a household member switcher `Select` in the header (only rendered when there's more than one household member). Ceremony flows are route-only: `ceremony/:type` renders `CeremonyFlow`, there is no ceremony tab.

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
