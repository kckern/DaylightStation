# Lifeplan Integration, Data Flow & Alignment Engine Design

> Supplement to the [Lifeplan Domain Design](../roadmap/2026-01-29-lifeplan-domain-design.md) — covers the gaps identified in that document: integration contracts, data flow, alignment engine, notification domain, testing infrastructure, frontend UI, and operationalization.

**Date:** 2026-03-12
**Status:** Design Complete, Ready for Implementation Planning
**Depends On:** `docs/roadmap/2026-01-29-lifeplan-domain-design.md` (domain model, state machines, ceremonies, data schema)

---

## Table of Contents

1. [Unified API Surface](#1-unified-api-surface)
2. [Notification Domain](#2-notification-domain)
3. [LifelogAggregator Extension & Metric Snapshots](#3-lifelogaggregator-extension--metric-snapshots)
4. [Value-to-Activity Categorization](#4-value-to-activity-categorization)
5. [Alignment Engine](#5-alignment-engine)
6. [LifeApp Frontend](#6-lifeapp-frontend)
7. [Test Infrastructure — Time Control & Synthetic Data](#7-test-infrastructure--time-control--synthetic-data)
8. [Operationalization & Productionization](#8-operationalization--productionization)
9. [Rollout Phases](#9-rollout-phases)

---

## 1. Unified API Surface

All life domain endpoints live under `/api/v1/life/` with three sub-routers:

### Plan (future intent)

```
GET    /api/v1/life/plan                          # Full lifeplan
PATCH  /api/v1/life/plan/:section                 # Update section
GET    /api/v1/life/plan/export                   # Export as YAML
GET    /api/v1/life/plan/goals                    # All goals by state
GET    /api/v1/life/plan/goals/:goalId            # Single goal
POST   /api/v1/life/plan/goals/:goalId/transition # State transition
PATCH  /api/v1/life/plan/goals/:goalId/metrics    # Update metrics
GET    /api/v1/life/plan/beliefs                  # All beliefs
POST   /api/v1/life/plan/beliefs/:id/evidence     # Add evidence
PATCH  /api/v1/life/plan/beliefs/:id/confidence   # Update confidence
GET    /api/v1/life/plan/cadence                  # Cadence config
PATCH  /api/v1/life/plan/cadence                  # Update cadence
POST   /api/v1/life/plan/feedback                 # Record observation
GET    /api/v1/life/plan/feedback?period=cycle     # Get feedback
GET    /api/v1/life/plan/cycle/current            # Current cycle
POST   /api/v1/life/plan/cycle/plan               # Plan new cycle
GET    /api/v1/life/plan/cycle/velocity           # Velocity history
GET    /api/v1/life/plan/ceremony/:type           # Get ceremony content
POST   /api/v1/life/plan/ceremony/:type/complete  # Record completion
GET    /api/v1/life/plan/retro?period=cycle       # Generate retrospective
GET    /api/v1/life/plan/suggestions              # Pattern-based suggestions
POST   /api/v1/life/plan/suggestions/:id/accept   # Accept suggestion
```

### Log (past data)

```
GET    /api/v1/life/log/:username/:date                    # Single day aggregate
GET    /api/v1/life/log/:username/range?start=&end=        # Date range aggregate
GET    /api/v1/life/log/:username/scope/:scope             # week|month|season|year|decade
GET    /api/v1/life/log/:username/scope/:scope?at=2026-03  # Specific period
GET    /api/v1/life/log/:username/category/:category?start=&end=     # Category filtered
GET    /api/v1/life/log/:username/category/:category?scope=month     # Category + scope
GET    /api/v1/life/log/sources                            # Available extractors
GET    /api/v1/life/log/weight                             # Weight data
```

### Now (present fulcrum — alignment engine)

```
GET    /api/v1/life/now?mode=priorities           # Ranked action list
GET    /api/v1/life/now?mode=dashboard            # Widget data
GET    /api/v1/life/now?mode=briefing             # AI narrative
GET    /api/v1/life/now/drift                     # Latest drift snapshot
GET    /api/v1/life/now/drift/history             # Cycle-over-cycle
POST   /api/v1/life/now/drift/refresh             # Recompute from raw
GET    /api/v1/life/now/rules/applicable          # Context-matched rules
```

### Notification (cross-cutting, separate router)

```
GET    /api/v1/notification/preferences           # User's channel preferences
PATCH  /api/v1/notification/preferences           # Update preferences
GET    /api/v1/notification/pending               # Undelivered in-app notifications
POST   /api/v1/notification/dismiss/:id           # Dismiss notification
```

### Router File Structure

```
backend/src/4_api/v1/routers/
├── life.mjs              # Mounts sub-routers
├── life/
│   ├── plan.mjs          # /api/v1/life/plan/*
│   ├── log.mjs           # /api/v1/life/log/*
│   └── now.mjs           # /api/v1/life/now/*
└── notification.mjs      # /api/v1/notification/*
```

### Health Check

```
GET /api/v1/life/health
→ {
    plan_loaded, last_snapshot, snapshot_age_hours,
    scheduled_jobs: { evidence_collection, daily_snapshot, ceremony_check },
    ceremony_adherence: { unit_intention, cycle_retro },
    notification_channels: { telegram, app, email, push }
  }
```

---

## 2. Notification Domain

Cross-cutting domain for transport-agnostic notification delivery. Ceremonies, drift alerts, goal updates, and any future notification needs route through this.

### Architecture

```
backend/src/
├── 2_domains/notification/
│   ├── entities/
│   │   ├── NotificationIntent.mjs     # What to send (content, urgency, category)
│   │   └── NotificationPreference.mjs # User's channel preferences per category
│   ├── value-objects/
│   │   ├── NotificationChannel.mjs    # telegram | email | push | app
│   │   ├── NotificationUrgency.mjs    # low | normal | high | critical
│   │   └── NotificationCategory.mjs   # ceremony | drift_alert | goal_update | system
│   └── services/
│       └── NotificationRouter.mjs     # Routes intent → channel(s) based on prefs
│
├── 1_adapters/notification/
│   ├── TelegramNotificationAdapter.mjs   # Wraps existing TelegramAdapter
│   ├── EmailNotificationAdapter.mjs      # Skeleton — future
│   ├── PushNotificationAdapter.mjs       # Skeleton — future
│   └── AppNotificationAdapter.mjs        # WebSocket broadcast to frontend
│
├── 3_applications/notification/
│   ├── ports/
│   │   ├── INotificationChannel.mjs     # Interface: send(intent) → result
│   │   └── INotificationPreferenceStore.mjs
│   ├── NotificationService.mjs          # Orchestrates: resolve prefs → route → deliver
│   └── NotificationContainer.mjs       # DI container
│
└── 4_api/v1/routers/
    └── notification.mjs                 # GET/PATCH preferences
```

### Key Design Decisions

- **NotificationIntent** is transport-agnostic — contains `title`, `body`, `category`, `urgency`, `actions[]` (buttons/choices), `metadata`
- **NotificationPreference** maps `(category, urgency)` → `channel[]`
- **INotificationChannel** interface: `send(intent)` → `{ delivered, channelId, error? }`
- **AppNotificationAdapter** uses `WebSocketEventBus.broadcast('notification', payload)` — the frontend subscribes for in-app alerts
- **TelegramNotificationAdapter** wraps existing `TelegramAdapter` — reuses keyboard/choice support for interactive ceremonies
- Email and Push are skeleton adapters that throw "not configured" until implemented

### Preference Config

Stored in `data/users/{username}/notification-preferences.yml`:

```yaml
notification_preferences:
  ceremony:
    normal: [telegram]
    high: [telegram, app]
  drift_alert:
    normal: [app]
    high: [telegram, app]
    critical: [telegram, app, email]
  goal_update:
    normal: [app]
  system:
    normal: [app]
    critical: [telegram]
```

---

## 3. LifelogAggregator Extension & Metric Snapshots

### The Problem

`LifelogAggregator.aggregate()` supports single-day queries only. The alignment engine needs cycle/phase/season windows for drift calculation. However, lifelog YAML files are date-keyed single files (e.g., `strava.yml` contains ALL dates) — so each file read already gives all dates for free.

### Approach: Extend Aggregator Minimally, Snapshot in Lifeplan

1. Add `aggregateRange()` to LifelogAggregator — loads 14 files once in parallel, iterates dates in memory
2. Lifeplan's `DriftService` calls `aggregateRange()` at ceremony boundaries and writes computed snapshots
3. Day-to-day queries hit snapshots; ceremonies recompute fresh

### LifelogAggregator Changes

One new public method, no changes to existing `aggregate()`:

```javascript
async aggregateRange(username, startDate, endDate) {
  // 1. Load all 14 source files in parallel (one read each)
  const allSourceData = await Promise.all(
    this.#extractors.map(ext => this.#loadSource(username, ext.filename)
      .then(data => ({ extractor: ext, data }))
    )
  );

  // 2. Iterate date range, extract per-day from already-loaded data
  const days = {};
  for (const date of dateRange(startDate, endDate)) {
    days[date] = this.#extractDay(allSourceData, date);
  }

  return {
    startDate, endDate,
    days,           // { "2026-03-01": { sources, summaries, categories }, ... }
    _meta: { username, dayCount: Object.keys(days).length, availableSources }
  };
}
```

### Lifeplan Metric Snapshots

Stored in `data/users/{username}/lifeplan-metrics.yml`:

```yaml
snapshots:
  "2026-C12":                          # Keyed by cycle ID
    computed_at: 2026-03-11T19:00:00Z
    period: { start: 2026-03-04, end: 2026-03-11 }

    value_allocation:                   # Time/energy by value
      health: 0.25
      family: 0.15
      craft: 0.45
      adventure: 0.05
      wealth: 0.10

    value_drift:
      correlation: 0.65                # Spearman vs stated ranking
      status: drifting
      stated_order: [health, family, craft, adventure, wealth]
      observed_order: [craft, health, family, wealth, adventure]

    goal_progress:
      run-marathon: { progress: 0.42, status: at_risk, pace_vs_expected: -0.12 }
      write-book: { progress: 0.0, status: stalled }

    belief_evidence:
      exercise-energy: { events: 3, confirmations: 2, disconfirmations: 1, delta: +0.01 }

    ceremony_adherence:
      unit_intention: 0.85
      unit_capture: 0.71
      cycle_retro: 1.0

rollups:
  "2026-03":
    computed_at: 2026-04-01T02:00:00Z
    by_category:
      health: { total_minutes: 1240, daily_avg: 41 }
      fitness: { total_minutes: 890, sessions: 14 }
      productivity: { total_minutes: 8400, tasks_completed: 87 }
    value_allocation:
      health: 0.22
      craft: 0.48
      family: 0.18
    highlights:
      - { source: strava, text: "14 runs, 112 miles" }
      - { source: todoist, text: "87 tasks completed" }
```

### Recomputation Triggers

- End of cycle → full snapshot for that cycle
- On-demand via API (`POST /api/v1/life/now/drift/refresh`)
- Phase/season reviews recompute from raw data (not from snapshots)
- Monthly rollup — scheduled job on 1st of each month

### Data Flow

```
Lifelog YAML files (14 files)
        │
        ▼
LifelogAggregator.aggregateRange()     ← called at cycle end
        │
        ▼
DriftService.computeSnapshot()          ← pure domain logic
        │
        ▼
lifeplan-metrics.yml                    ← persisted snapshot
        │
        ▼
AlignmentService / UI                   ← reads snapshots for dashboards
```

---

## 4. Value-to-Activity Categorization

Maps lifelog extractor output to the user's ranked values for drift calculation.

### Mapping Schema (in `lifeplan.yml`)

```yaml
value_mapping:
  # Direct extractor category → value mappings (user overrides)
  category_defaults:
    health: health           # weight, nutrition extractors
    fitness: health          # strava, fitness extractors
    calendar: ~              # Needs sub-mapping (see below)
    productivity: craft      # todoist, clickup, github
    social: family           # reddit, gmail (rough default)
    journal: ~               # Excluded from allocation
    finance: wealth          # shopping extractor

  # Calendar events need finer mapping — keywords in summary/calendarName
  calendar_rules:
    - match: { calendarName: "Work" }
      value: craft
    - match: { calendarName: "Family" }
      value: family
    - match: { summary_contains: "gym" }
      value: health
    - match: { summary_contains: "hike" }
      value: adventure
    - match: { calendarName: "Personal" }
      value: adventure
    - default: craft          # Unmatched calendar events

  # Override specific extractors (more specific than category)
  extractor_overrides:
    lastfm: adventure         # Music listening = leisure/adventure
    reddit: ~                 # Exclude from allocation
    checkins: adventure       # Location check-ins = exploration
```

### Resolution Order

```
1. extractor_overrides[source]     — most specific
2. calendar_rules (for calendar)   — keyword matching
3. category_defaults[category]     — user-defined category map
4. BUILT_IN_DEFAULTS[category]     — hardcoded fallback
```

### Built-in Defaults

```javascript
const BUILT_IN_DEFAULTS = {
  health:       'health',
  fitness:      'health',
  productivity: 'craft',
  social:       'family',
  finance:      'wealth',
  calendar:     'craft',     // Conservative default
  journal:      null,        // Excluded — reflection, not allocation
};
```

### Minute Estimation Heuristics

| Source | Estimation Method |
|--------|------------------|
| `strava` | `duration` field (actual minutes) |
| `calendar` | `endTime - time` (event duration) |
| `todoist/clickup` | 15 min per completed task (configurable) |
| `github` | 30 min per commit (configurable) |
| `weight/nutrition` | Excluded (measurement, not time spent) |
| `lastfm` | 3 min per track (configurable) |
| `checkins` | 30 min per check-in (configurable) |

---

## 5. Alignment Engine

The core value proposition — "What should I do now, and why?" Computes once, renders three ways.

### Computation Layer

```javascript
// AlignmentService.computeAlignment(username, clock)

async computeAlignment(username) {
  const plan = await this.#planStore.load(username);
  const today = this.#clock.today();
  const cadence = this.#cadenceService.resolve(plan.cadence, today);
  const snapshot = await this.#metricsStore.getLatest(username);
  const calendar = await this.#lifelogAggregator.aggregate(username, today);
  const context = this.#contextService.build(today, calendar);

  return {
    // Priority List data
    priorities: this.#computePriorities(plan, snapshot, context),

    // Dashboard data
    dashboard: {
      valueDrift: snapshot.value_drift,
      goalProgress: snapshot.goal_progress,
      beliefConfidence: this.#getBeliefSummaries(plan.beliefs),
      ceremonyAdherence: snapshot.ceremony_adherence,
      cadencePosition: cadence,
    },

    // Briefing data (for AI generation)
    briefingContext: { plan, snapshot, context, recentFeedback: plan.feedback.slice(-5) },

    _meta: { computedAt: this.#clock.now(), username },
  };
}
```

### Priority Computation

```javascript
#computePriorities(plan, snapshot, context) {
  const items = [];

  // 1. Overdue forcing functions (highest priority)
  items.push(...this.#getForcingFunctions(plan, snapshot));

  // 2. Due ceremonies
  items.push(...this.#getDueCeremonies(plan, context));

  // 3. Active goal actions (filtered by context)
  items.push(...this.#getGoalActions(plan, snapshot, context));

  // 4. Applicable rules (time/context matched)
  items.push(...this.#getApplicableRules(plan, context));

  // 5. Stale beliefs needing attention
  items.push(...this.#getDormantBeliefs(plan));

  // Score and rank
  return items
    .map(item => ({ ...item, score: this.#scoreItem(item, plan.values) }))
    .sort((a, b) => b.score - a.score);
}
```

**Scoring factors:**
- Value alignment — items tied to higher-ranked values score higher
- Urgency — deadline proximity, forcing function overdue duration
- Drift correction — items that would reduce drift get a boost
- Anti-goal proximity — items tied to approaching nightmares get elevated

### Three Renderers

All consume the same `computeAlignment()` result:

| Mode | Endpoint | Returns |
|------|----------|---------|
| **priorities** | `GET /api/v1/life/now?mode=priorities` | `{ priorities: [{ type, title, reason, score, actionUrl }] }` |
| **dashboard** | `GET /api/v1/life/now?mode=dashboard` | `{ dashboard: { valueDrift, goalProgress, beliefConfidence, ... } }` |
| **briefing** | `GET /api/v1/life/now?mode=briefing` | `{ briefing: "Your top value is Health but..." }` — AI-generated narrative |

User configures default mode in preferences. Frontend can request any mode.

---

## 6. LifeApp Frontend

Renaming `LifelogApp.jsx` → `LifeApp.jsx`. Unified Past/Present/Future hub at `/life`.

### Route Structure

```
/life              → Redirects to /life/now
/life/now          → Present view (alignment engine — priorities | dashboard | briefing)
/life/log          → Past view — today
/life/log/:date    → Past view — specific day
/life/log/week     → Current cycle
/life/log/month    → Current phase
/life/log/season   → Current season
/life/log/year     → Current era
/life/log/decade   → Decade view
/life/log/category/:category           → Category deep view
/life/log/category/:category?scope=... → Category + time scope
/life/plan         → Future view — plan overview
/life/plan/goals   → Goals management
/life/plan/goals/:goalId → Goal detail
/life/plan/beliefs → Beliefs management
/life/plan/values  → Values management
/life/plan/qualities → Qualities management
/life/plan/ceremonies → Ceremony config + adherence
/life/ceremony/:type → Full-screen ceremony flow
```

### App Shell

```jsx
// frontend/src/Apps/LifeApp.jsx
<MantineProvider>
  <LifeAppContext.Provider value={{ plan, drift, clock }}>
    <AppShell header={{ height: 48 }} navbar={{ width: 220 }}>
      <AppShell.Header>
        <LifeAppHeader />          {/* Title + cadence position indicator */}
      </AppShell.Header>
      <AppShell.Navbar>
        <LifeAppNav />             {/* Past / Now / Future nav + sub-items */}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  </LifeAppContext.Provider>
</MantineProvider>
```

### Navigation Sidebar

```
Now          ← /life/now
  Priorities
  Dashboard
  Briefing
─────────────
Log          ← /life/log
  Today
  This Week
  This Month
  Season
  Year
  Decade
  By Category
─────────────
Plan         ← /life/plan
  Purpose
  Qualities
  Values
  Beliefs
  Goals
  Ceremonies
```

### Module Structure

```
frontend/src/modules/Life/
├── context/
│   └── LifeAppContext.jsx         # Plan state, drift, user prefs
├── hooks/
│   ├── useLifePlan.js             # Fetch/mutate plan
│   ├── useAlignment.js            # GET /life/now?mode=...
│   ├── useLifelog.js              # GET /life/log (single + range + scope)
│   ├── useDrift.js                # GET /life/now/drift
│   └── useCeremony.js            # Ceremony flow state
├── views/
│   ├── now/
│   │   ├── PriorityList.jsx       # Ranked action cards
│   │   ├── Dashboard.jsx          # Drift gauge, goal bars, belief sparklines
│   │   └── Briefing.jsx           # AI narrative display
│   ├── log/
│   │   ├── LogTimeline.jsx        # Day-by-day vertical timeline (default)
│   │   ├── LogDayDetail.jsx       # Expanded single day
│   │   ├── LogBrowser.jsx         # Date range picker + scope selector
│   │   ├── LogCategoryView.jsx    # Category-specific deep view
│   │   ├── LogWeekView.jsx        # Cycle summary — daily breakdown grid
│   │   ├── LogMonthView.jsx       # Phase summary — heatmap calendar
│   │   ├── LogSeasonView.jsx      # Season — trend lines per category
│   │   ├── LogYearView.jsx        # Era — monthly aggregates, sparklines
│   │   ├── LogDecadeView.jsx      # Decade — yearly summaries, life chapters
│   │   └── shared/
│   │       ├── ScopeSelector.jsx      # week|month|season|year|decade toggle
│   │       ├── CategoryFilter.jsx     # Filter by extractor category
│   │       ├── SourceIcon.jsx         # Icons per source (strava, calendar, etc.)
│   │       └── ActivityHeatmap.jsx    # GitHub-style heatmap (reusable)
│   ├── plan/
│   │   ├── PurposeView.jsx        # Purpose statement + grounding
│   │   ├── QualitiesView.jsx      # Qualities with rules + shadow indicators
│   │   ├── ValuesView.jsx         # Ranked values + drag-to-reorder
│   │   ├── BeliefsView.jsx        # Belief cards with confidence bars + evidence
│   │   ├── GoalsView.jsx          # Goals grouped by state, kanban-style
│   │   ├── GoalDetail.jsx         # Single goal — milestones, metrics, history
│   │   └── CeremonyConfig.jsx     # Ceremony preferences + adherence
│   └── ceremony/
│       ├── CeremonyFlow.jsx       # Full-screen ceremony conductor
│       ├── UnitIntention.jsx      # Quick daily intention
│       ├── UnitCapture.jsx        # Quick daily capture
│       ├── CycleRetro.jsx         # Cycle retrospective
│       └── PhaseReview.jsx        # Phase review (reusable for season/era)
└── widgets/
    ├── DriftGauge.jsx             # Spearman correlation visualization
    ├── GoalProgressBar.jsx        # Single goal progress
    ├── BeliefConfidenceChip.jsx   # Confidence level badge
    ├── CadenceIndicator.jsx       # "Day 4 of Week 12"
    └── ValueAllocationChart.jsx   # Pie/bar of time allocation vs ranking
```

### Log View Rendering Strategy

| Scope | Primary Visualization | Data Source |
|-------|----------------------|------------|
| **Day** | Source-grouped cards with detail | Single `aggregate()` |
| **Week** | 7-column grid, one row per category | `aggregateRange()` 7 days |
| **Month** | Calendar heatmap + category breakdowns | `aggregateRange()` 30 days, rolled to daily totals |
| **Season** | Trend sparklines per category, weekly rollups | `aggregateRange()` 90 days, rolled to weekly |
| **Year** | Monthly bars, category area charts | Snapshot-backed (monthly rollups) |
| **Decade** | Yearly summaries, life event markers, chapter narrative | Snapshot-backed + life events overlay |

### Dashboard Layout

```
┌─────────────────────────────────────────────────┐
│  Day 4 of Week 12  ·  Phase 3  ·  Season 1     │  ← CadenceIndicator
├──────────────────────┬──────────────────────────┤
│  Value Alignment     │  Top Priorities          │
│  ┌──────────────┐    │  1. Morning run (health) │
│  │ [drift gauge]│    │  2. Ship auth PR (craft) │
│  │  r = 0.65    │    │  3. Call mom (family)    │
│  │  drifting    │    │                          │
│  └──────────────┘    │  ⚠ 3 cycles drifting     │
├──────────────────────┼──────────────────────────┤
│  Goal Progress       │  Beliefs                 │
│  Marathon  ████░ 42% │  exercise→energy  ██░ 85%│
│  Book      ░░░░░  0% │  deep-work→output █░░ 68%│
│  Promotion ▶ ready   │  dormant: 1              │
├──────────────────────┴──────────────────────────┤
│  Ceremony: Unit Capture due at 9:00 PM          │
└─────────────────────────────────────────────────┘
```

### Routing in `main.jsx`

```javascript
<Route path="/life/*" element={<LifeApp />}>
  <Route index element={<Navigate to="now" />} />
  <Route path="now" element={<NowView />} />
  <Route path="log" element={<LogTimeline />} />
  <Route path="log/:date" element={<LogDayDetail />} />
  <Route path="log/week" element={<LogWeekView />} />
  <Route path="log/month" element={<LogMonthView />} />
  <Route path="log/season" element={<LogSeasonView />} />
  <Route path="log/year" element={<LogYearView />} />
  <Route path="log/decade" element={<LogDecadeView />} />
  <Route path="log/category/:category" element={<LogCategoryView />} />
  <Route path="plan" element={<PlanOverview />} />
  <Route path="plan/goals" element={<GoalsView />} />
  <Route path="plan/goals/:goalId" element={<GoalDetail />} />
  <Route path="plan/beliefs" element={<BeliefsView />} />
  <Route path="plan/values" element={<ValuesView />} />
  <Route path="plan/qualities" element={<QualitiesView />} />
  <Route path="plan/ceremonies" element={<CeremonyConfig />} />
  <Route path="ceremony/:type" element={<CeremonyFlow />} />
</Route>
```

---

## 7. Test Infrastructure — Time Control & Synthetic Data

All Lifeplan development is test-driven. The temporal and lifecycle nature of this domain requires time control and synthetic data generation.

### Injectable Clock

Every service that references "now" uses an injectable clock:

```javascript
// backend/src/0_system/clock/Clock.mjs

class Clock {
  #offset = 0;
  #frozen = null;

  now() {
    if (this.#frozen) return new Date(this.#frozen);
    return new Date(Date.now() + this.#offset);
  }

  today() {
    return this.now().toISOString().slice(0, 10);
  }

  freeze(dateOrString) {
    this.#frozen = new Date(dateOrString).getTime();
  }

  advance(duration) {
    const ms = parseDuration(duration);
    if (this.#frozen) this.#frozen += ms;
    else this.#offset += ms;
  }

  reset() {
    this.#offset = 0;
    this.#frozen = null;
  }

  isFrozen() { return this.#frozen !== null; }
}

export const clock = new Clock();
export default clock;
```

**Rule:** No bare `Date.now()` or `new Date()` in any Lifeplan service. All receive `clock` via constructor injection.

### Synthetic Data Generator

```javascript
// tests/_lib/lifeplan-test-factory.mjs

export function createTestLifeplan(options = {}) {
  const {
    startDate = '2025-01-01',
    spanMonths = 6,
    goalCount = 5,
    beliefCount = 4,
    valueCount = 5,
    cadence = { unit: '1 day', cycle: '7 days', phase: '30 days', season: '90 days' },
    seed = 42,                   // Deterministic randomness
  } = options;

  return {
    meta: { version: '2.0', testdata: true, seed, created: startDate },
    cadence,
    purpose: generatePurpose(startDate),
    qualities: generateQualities(),
    values: generateValues(valueCount),
    beliefs: generateBeliefs(beliefCount, startDate, spanMonths, seed),
    goals: generateGoals(goalCount, startDate, spanMonths, seed),
    life_events: [],
    dependencies: [],
    cycles: generateCycleHistory(startDate, spanMonths, cadence, seed),
    ceremonies: generateCeremonyConfig(),
    feedback: [],
    tasks: [],
  };
}

export function createMatchingLifelog(lifeplan, options = {}) {
  // Generates lifelog YAML data that corresponds to the lifeplan:
  // - Strava activities matching fitness goals
  // - Calendar events matching time allocation
  // - Weight data matching health beliefs
  // Returns: { strava: {...}, calendar: {...}, weight: {...}, ... }
  // Each file is date-keyed, matching real format
}
```

**Properties:**
- `testdata: true` flag in meta — services can detect synthetic data
- `seed` for deterministic generation — same seed = same data = reproducible tests
- Goals span multiple states (some achieved, some committed, some stalled)
- Lifelog data internally consistent with plan

### Lifecycle Simulation Harness

```javascript
// tests/_lib/lifeplan-simulation.mjs

export class LifeplanSimulation {
  #clock;
  #services;
  #lifeplan;
  #lifelog;

  constructor({ lifeplan, lifelog, clock, services }) { ... }

  // Advance time and run all due ceremonies/checks
  async tick(duration = '1 day') {
    this.#clock.advance(duration);
    await this.#runDueJobs();
    return this.snapshot();
  }

  // Run a full cycle (unit intentions, captures, cycle retro)
  async runCycle() {
    const cycleDays = parseCadence(this.#lifeplan.cadence.cycle);
    for (let d = 0; d < cycleDays; d++) {
      await this.tick('1 day');
    }
    return this.snapshot();
  }

  async runCycles(n) {
    const snapshots = [];
    for (let i = 0; i < n; i++) {
      snapshots.push(await this.runCycle());
    }
    return snapshots;
  }

  async injectLifeEvent(event) { ... }
  async injectEvidence(beliefId, evidence) { ... }
  injectLifelogOverride(source, data) { ... }

  snapshot() {
    return {
      date: this.#clock.today(),
      plan: deepClone(this.#lifeplan),
      metrics: this.#services.driftService.getLatestSnapshot(),
      alerts: this.#services.notificationService.getPending(),
    };
  }
}
```

### Test Patterns

```javascript
// Value drift detection over multiple cycles
test('detects drift when behavior diverges from stated values', async () => {
  await sim.runCycles(2);
  expect(sim.snapshot().metrics.value_drift.status).toBe('aligned');

  sim.injectLifelogOverride('strava', { /* zero activities */ });
  sim.injectLifelogOverride('calendar', { /* 80% work meetings */ });

  await sim.runCycles(3);
  expect(sim.snapshot().metrics.value_drift.status).toBe('drifting');
  expect(sim.snapshot().metrics.value_drift.cycles_drifting).toBe(3);
});

// Belief dormancy decay over months
test('untested belief decays after 60 days', async () => {
  clock.freeze('2025-01-01');
  plan.beliefs[0].last_tested = '2025-01-01';
  plan.beliefs[0].confidence = 0.85;

  clock.advance('90 days');
  await sim.tick();

  expect(sim.snapshot().plan.beliefs[0].state).toBe('dormant');
  expect(sim.snapshot().plan.beliefs[0].effective_confidence).toBeLessThan(0.85);
});

// Goal lifecycle: full journey
test('dream → considered → ready → committed → achieved', async () => { ... });

// Life event blocks goal, unblocks when resolved
test('life event blocks goal, unblocks when resolved', async () => {
  sim.injectLifeEvent({ id: 'baby-born', status: 'anticipated', expected_date: '2025-08-15' });
  // ... verify goal stuck in considered
  clock.advance('6 months');
  sim.injectLifeEvent({ id: 'baby-born', status: 'occurred', actual_date: '2025-08-10' });
  await sim.tick();
  // ... verify goal auto-transitioned to ready
});
```

### Test Directory Structure

```
tests/
├── _lib/
│   ├── lifeplan-test-factory.mjs      # Synthetic data generation
│   ├── lifeplan-simulation.mjs        # Lifecycle simulation harness
│   └── clock-helper.mjs              # Clock freeze/advance utilities
│
├── isolated/lifeplan/
│   ├── entities/
│   │   ├── goal-state-machine.test.mjs
│   │   ├── belief-evidence.test.mjs
│   │   ├── value-drift.test.mjs
│   │   └── quality-rules.test.mjs
│   ├── services/
│   │   ├── drift-detection.test.mjs
│   │   ├── belief-cascade.test.mjs
│   │   ├── dependency-resolver.test.mjs
│   │   ├── ceremony-scheduling.test.mjs
│   │   └── alignment-engine.test.mjs
│   ├── lifecycle/
│   │   ├── goal-full-journey.test.mjs
│   │   ├── belief-dormancy-decay.test.mjs
│   │   ├── value-reordering.test.mjs
│   │   ├── life-event-cascade.test.mjs
│   │   └── paradigm-shift.test.mjs
│   └── notification/
│       ├── routing.test.mjs
│       └── preference-resolution.test.mjs
│
├── integrated/lifeplan/
│   ├── aggregator-range.test.mjs
│   ├── metric-snapshot.test.mjs
│   └── ceremony-delivery.test.mjs
```

---

## 8. Operationalization & Productionization

### Bootstrap & Wiring

```javascript
// backend/src/0_system/bootstrap/lifeplan.mjs

export function bootstrapLifeplan({ configService, userDataService, eventBus, scheduler, clock }) {
  // 1. Persistence
  const planStore = new YamlLifePlanStore(userDataService);
  const metricsStore = new YamlLifeplanMetricsStore(userDataService);
  const ceremonyRecordStore = new YamlCeremonyRecordStore(userDataService);

  // 2. Domain services (pure, clock-injected)
  const goalStateService = new GoalStateService(clock);
  const beliefEvaluator = new BeliefEvaluator(clock);
  const valueDriftCalculator = new ValueDriftCalculator();
  const dependencyResolver = new DependencyResolver();
  const cascadeProcessor = new BeliefCascadeProcessor();
  const cadenceService = new CadenceService(clock);

  // 3. Lifelog integration
  const aggregator = new LifelogAggregator({
    userLoadFile: userDataService.getLifelogData.bind(userDataService)
  });

  // 4. Application services
  const container = new LifeplanContainer({
    planStore, metricsStore, ceremonyRecordStore,
    aggregator, clock, cadenceService,
    goalStateService, beliefEvaluator, valueDriftCalculator,
    dependencyResolver, cascadeProcessor,
  });

  // 5. Notification wiring
  const notificationService = buildNotificationService({ eventBus, configService });
  container.setNotificationService(notificationService);

  // 6. Scheduled jobs
  registerLifeplanJobs(scheduler, container, clock);

  return container;
}
```

### Scheduled Jobs

```javascript
function registerLifeplanJobs(scheduler, container, clock) {
  // Evidence collection — every 6 hours
  scheduler.register('lifeplan:evidence-collection', {
    schedule: '0 */6 * * *',
    handler: () => container.beliefEvidenceCollector.collectAll(),
    enabled: true,
  });

  // Metric snapshot — end of each day
  scheduler.register('lifeplan:daily-snapshot', {
    schedule: '0 22 * * *',
    handler: () => container.driftService.computeAndSave(),
    enabled: true,
  });

  // Ceremony triggers — checked every 5 minutes
  scheduler.register('lifeplan:ceremony-check', {
    schedule: '*/5 * * * *',
    handler: () => container.ceremonyScheduler.checkAndNotify(),
    enabled: true,
  });

  // Forcing function check — daily
  scheduler.register('lifeplan:forcing-functions', {
    schedule: '0 8 * * *',
    handler: () => container.alignmentService.checkForcingFunctions(),
    enabled: true,
  });

  // Monthly rollup — 1st of each month
  scheduler.register('lifeplan:monthly-rollup', {
    schedule: '0 2 1 * *',
    handler: () => container.metricsService.computeMonthlyRollup(),
    enabled: true,
  });
}
```

### Ceremony Scheduling Logic

Ceremonies are cadence-relative, not fixed cron:

```javascript
// CeremonyScheduler.checkAndNotify()
async checkAndNotify() {
  const plan = await this.#planStore.load(username);
  const config = plan.ceremonies.config;
  const cadence = this.#cadenceService.resolve(plan.cadence, this.#clock.today());

  for (const [type, ceremony] of Object.entries(config)) {
    if (!ceremony.enabled) continue;

    const isDue = this.#cadenceService.isCeremonyDue(type, ceremony, cadence);
    const alreadyDone = await this.#recordStore.hasRecord(
      username, type, cadence.currentPeriodId(ceremony.timing)
    );

    if (isDue && !alreadyDone) {
      await this.#notificationService.send({
        category: 'ceremony',
        urgency: this.#getUrgency(type),
        title: CEREMONY_TITLES[type],
        body: `${ceremony.duration_target} min — ${CEREMONY_DESCRIPTIONS[type]}`,
        actions: [
          { label: 'Start', url: `/life/ceremony/${type}` },
          { label: 'Snooze 1hr', action: 'snooze', data: { hours: 1 } },
        ],
        metadata: { ceremonyType: type, periodId: cadence.currentPeriodId(ceremony.timing) },
      });
    }
  }
}
```

### Data Files (New)

| File | Location | Purpose |
|------|----------|---------|
| `lifeplan.yml` | `data/users/{username}/lifeplan.yml` | Complete life plan (schema in domain design doc) |
| `lifeplan-metrics.yml` | `data/users/{username}/lifeplan-metrics.yml` | Computed snapshots + monthly rollups |
| `notification-preferences.yml` | `data/users/{username}/notification-preferences.yml` | Channel preferences per category |
| `ceremony-records/` | `data/users/{username}/ceremony-records/` | Completed ceremony records |

No migration needed — all additive. Existing lifelog files untouched.

---

## 9. Rollout Phases

```
Phase 0: Infrastructure
  - Clock service
  - Notification domain (skeleton adapters)
  - LifelogAggregator.aggregateRange()
  - Test factory + simulation harness
  - LifelogApp.jsx → LifeApp.jsx rename + route setup

Phase 1: Foundation (domain design Phase 1)
  - Entities with state machines (Goal, Belief, Value, Quality, Rule)
  - Domain services (GoalStateService, BeliefEvaluator)
  - YamlLifePlanStore
  - /api/v1/life/plan/* endpoints
  - Plan management UI (values, beliefs, goals CRUD)

Phase 2: Alignment Engine (domain design Phase 2)
  - ValueDriftCalculator + categorization mapping
  - AlignmentService + 3 renderers (priorities, dashboard, briefing)
  - Metric snapshots + DriftService
  - /api/v1/life/now/* endpoints
  - Dashboard + Priority List UI

Phase 3: Log Views
  - /api/v1/life/log/* endpoints (range, scope, category)
  - LogTimeline, LogDayDetail, LogBrowser
  - LogWeekView, LogMonthView, LogSeasonView, LogYearView, LogDecadeView
  - LogCategoryView + shared components (ScopeSelector, ActivityHeatmap)

Phase 4: Feedback + Ceremonies (domain design Phases 3-4)
  - CeremonyService + CeremonyScheduler
  - Notification routing (Telegram + app channels)
  - Ceremony flow UI (CeremonyFlow, UnitIntention, CycleRetro, etc.)
  - Feedback capture

Phase 5: External Integration (domain design Phase 6)
  - Metric adapters (Strava, Calendar, etc.)
  - BeliefSignalDetector
  - AI briefing generation
  - Monthly rollup job
  - Full lifecycle simulation test suite
```

---

## Dependencies

| Existing System | How Lifeplan Uses It |
|-----------------|---------------------|
| `LifelogAggregator` | Source of "what happened" for drift (extended with `aggregateRange()`) |
| `ConfigService` | Load user/household context + cadence config |
| `UserDataService` | Read/write user YAML files |
| `TaskRegistry` / `Scheduler` | Ceremony triggers, evidence collection, snapshot jobs |
| `WebSocketEventBus` | App notification delivery, real-time UI updates |
| `TelegramAdapter` | Ceremony delivery via Telegram (wrapped by notification domain) |
| `Journalist` | Shared lifelog aggregation pattern; future: AI briefing generation |

**No breaking changes** — Lifeplan adds alongside existing domains.
