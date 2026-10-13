# Unified Life Domain Design

> Merging lifelog (past) + lifeplan (future) + present into a coherent whole

**Last Updated:** 2026-02-04
**Status:** Design Complete, Ready for Implementation

---

## Overview

The Life domain unifies three temporal perspectives into a coherent whole:

```
    PAST                    PRESENT                   FUTURE
   ┌──────────┐           ┌──────────┐            ┌──────────┐
   │ life/log │ ────────► │life/now  │ ◄───────── │life/plan │
   │          │           │          │            │          │
   │ What     │           │ What to  │            │ What     │
   │ happened │           │ do NOW   │            │ should   │
   │          │           │          │            │ happen   │
   └──────────┘           └──────────┘            └──────────┘
        │                      │                       │
        └──────────────────────┴───────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │    life/core        │
                    │  Shared entities    │
                    │  (Attribute, etc.)  │
                    └─────────────────────┘
```

**Why unify?**
- Lifelog and Lifeplan are two sides of the same coin - you can't calculate drift without both
- The "present" question ("What should I do now?") requires synthesizing past data with future intent
- Shared concepts (daily records, attributes, correlations) belong to neither alone
- Single `LifeApp` frontend simplifies UX - one place to understand your life

**What stays separate:**
- Subdomains maintain focused responsibilities
- Each subdomain can evolve independently
- Clear boundaries prevent coupling

---

## Subdomain Structure

```
__backend/src/2_domains/life/
├── index.mjs                    # Unified exports
│
├── core/                        # Shared foundation
│   ├── entities/
│   │   ├── Attribute.mjs        # Manual tracking (mood, energy, custom)
│   │   ├── AttributeEntry.mjs   # Daily attribute values
│   │   ├── Correlation.mjs      # Discovered relationships
│   │   └── DailyRecord.mjs      # Aggregated day summary
│   ├── value-objects/
│   │   ├── AttributeType.mjs    # scale_1_10 | boolean | numeric
│   │   ├── CorrelationType.mjs  # positive | negative | none
│   │   └── DataSource.mjs       # strava | exist | manual | ...
│   └── services/
│       └── CorrelationEngine.mjs # Statistical pattern detection
│
├── log/                         # PAST - What happened (existing lifelog)
│   ├── entities/
│   │   ├── FoodItem.mjs         # (existing)
│   │   └── NutriLog.mjs         # (existing)
│   ├── extractors/              # (existing - all current extractors)
│   │   ├── ILifelogExtractor.mjs
│   │   ├── StravaExtractor.mjs
│   │   ├── CalendarExtractor.mjs
│   │   └── ...
│   └── services/
│       └── LifelogAggregator.mjs # (existing)
│
├── plan/                        # FUTURE - What should happen (lifeplan design)
│   ├── entities/
│   │   ├── Purpose.mjs
│   │   ├── Quality.mjs
│   │   ├── Rule.mjs
│   │   ├── Value.mjs
│   │   ├── Belief.mjs
│   │   ├── Goal.mjs
│   │   ├── LifeEvent.mjs
│   │   └── ...                  # (full lifeplan entity set)
│   ├── value-objects/
│   │   ├── GoalState.mjs
│   │   ├── BeliefState.mjs
│   │   └── CadenceLevel.mjs
│   └── services/
│       ├── GoalStateService.mjs
│       ├── BeliefEvaluator.mjs
│       └── ValueDriftCalculator.mjs
│
└── now/                         # PRESENT - What to do now (the fulcrum)
    ├── entities/
    │   ├── Focus.mjs            # Current priorities
    │   ├── Drift.mjs            # Multi-dimensional drift snapshot
    │   └── Suggestion.mjs       # Actionable recommendations
    ├── value-objects/
    │   └── UrgencyLevel.mjs     # critical | high | normal | low
    └── services/
        ├── AlignmentService.mjs # "What should I do now?"
        ├── DriftService.mjs     # Compare plan vs reality
        └── SuggestionEngine.mjs # Generate actionable nudges
```

**Key insight:** The `now/` subdomain is thin - it's mostly orchestration. The heavy lifting happens in `log/` (data) and `plan/` (intent). The `now/` subdomain synthesizes them.

---

## Core Entities

The `core/` subdomain contains concepts that span past/present/future:

```javascript
// Attribute.mjs - Manual tracking (Exist.io-style)
class Attribute {
  id;              // 'mood', 'energy', 'pain_level', 'focus'
  name;            // "Mood", "Energy Level"
  type;            // 'scale_1_10' | 'scale_1_5' | 'boolean' | 'numeric'
  category;        // 'wellbeing' | 'productivity' | 'health' | 'custom'
  prompt;          // "How's your energy today?" (for Telegram/Journalist)
  icon;            // Optional emoji
  active;          // Whether currently tracking
  created_at;
}

// AttributeEntry.mjs - Daily values
class AttributeEntry {
  attribute_id;
  date;            // YYYY-MM-DD
  value;           // Number or boolean depending on type
  timestamp;       // When recorded
  source;          // 'manual' | 'telegram' | 'journalist' | 'exist_import'
  note;            // Optional context
}

// Correlation.mjs - Discovered patterns
class Correlation {
  id;
  factor_a;        // 'sleep_hours' | 'exercise_count' | attribute ID
  factor_b;        // 'mood' | 'productivity_score' | attribute ID
  direction;       // 'positive' | 'negative'
  strength;        // 0.0-1.0 (Pearson/Spearman coefficient)
  p_value;         // Statistical significance
  sample_size;     // Number of data points
  observation_period; // "90 days"
  discovered_at;

  status;          // 'detected' | 'promoted' | 'dismissed' | 'stale'
  promoted_to;     // belief ID if user adopted as formal belief
  dismissed_reason; // If user dismissed, why

  // Auto-generated insight text
  insight;         // "You're 23% more productive on days you exercise"
}

// DailyRecord.mjs - Aggregated day summary
class DailyRecord {
  date;            // YYYY-MM-DD

  // Pulled from log/
  sources_present; // ['strava', 'calendar', 'todoist', ...]
  summary_text;    // AI-friendly summary from LifelogAggregator

  // From core/ attributes
  attributes;      // { mood: 7, energy: 8, ... }

  // Computed
  completeness;    // 0.0-1.0 (how much data we have)
  anomalies;       // Unusual patterns detected
}
```

**Why these live in `core/`:**
- `Attribute` is tracked daily (log) but informs beliefs (plan) and suggestions (now)
- `Correlation` is discovered from log data but becomes plan beliefs
- `DailyRecord` aggregates everything for a single day - the atomic unit all subdomains share

---

## Cross-Domain Integration

The Life domain doesn't live in isolation - it synthesizes data from specialized domains:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    3_applications/life/                                  │
│                    (Orchestration Layer)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   AlignmentService    DriftService    InsightService    CeremonyService │
│          │                │                │                │           │
└──────────┼────────────────┼────────────────┼────────────────┼───────────┘
           │                │                │                │
           ▼                ▼                ▼                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         DOMAIN LAYER                                      │
│                                                                          │
│  ┌────────────────────────────────────────┐                              │
│  │           2_domains/life/              │                              │
│  │  ┌────────┐ ┌────────┐ ┌────────┐     │                              │
│  │  │ log/   │ │ plan/  │ │  now/  │     │                              │
│  │  │ (past) │ │(future)│ │(present)│     │                              │
│  │  └───┬────┘ └───┬────┘ └───┬────┘     │                              │
│  │      └──────────┼──────────┘          │                              │
│  │            core/ (shared)              │                              │
│  └────────────────────────────────────────┘                              │
│                      ▲                                                    │
│                      │ aggregates from                                    │
│    ┌─────────────────┼─────────────────────────────────────┐             │
│    │                 │                                     │             │
│    ▼                 ▼                 ▼                   ▼             │
│ ┌────────┐     ┌──────────┐     ┌──────────┐       ┌──────────┐         │
│ │finance/│     │journalist│     │ health/  │       │nutrition/│         │
│ │        │     │          │     │          │       │(nutribot)│         │
│ │ past:  │     │ past:    │     │ past:    │       │ past:    │         │
│ │ txns   │     │ entries  │     │ metrics  │       │ food log │         │
│ │        │     │ voice    │     │ workouts │       │          │         │
│ │present:│     │          │     │          │       │ present: │         │
│ │ budget │     │          │     │          │       │ calories │         │
│ │ status │     │          │     │          │       │ remaining│         │
│ │        │     │          │     │          │       │          │         │
│ │future: │     │          │     │          │       │ future:  │         │
│ │ goals  │     │          │     │          │       │ targets  │         │
│ └────────┘     └──────────┘     └──────────┘       └──────────┘         │
└──────────────────────────────────────────────────────────────────────────┘
```

**Cross-domain data flows:**

| Domain | What it provides to Life | How Life uses it |
|--------|-------------------------|------------------|
| `finance/` | Transactions, budget status, spending patterns | Value drift (money allocation vs values), goal progress (savings targets) |
| `journalist/` | Journal entries, voice memos | Highest-priority lifelog source, belief evidence, ceremony responses |
| `health/` | Metrics (weight, HR, sleep), workouts | Belief signals, goal metrics, quality tracking |
| `nutrition/` | Food log, calorie tracking | Health quality evidence, belief testing |
| `fitness/` | Sessions, zones, streaks | Goal progress, belief evidence, correlation factors |

**Application layer structure:**

```
__backend/src/3_applications/life/
├── index.mjs
├── LifeContainer.mjs            # DI container
│
├── ports/
│   ├── ILifePlanRepository.mjs
│   ├── IAttributeRepository.mjs
│   ├── ICorrelationRepository.mjs
│   └── IDomainDataSource.mjs    # Interface for pulling from other domains
│
├── services/
│   ├── AlignmentService.mjs     # "What should I do now?"
│   ├── DriftService.mjs         # Multi-dimensional drift
│   ├── InsightService.mjs       # Generate correlation insights
│   ├── CeremonyService.mjs      # Orchestrate reflection ceremonies
│   ├── BeliefDiscoveryService.mjs # Correlations → suggested beliefs
│   └── CrossDomainAggregator.mjs  # Pull from finance, health, etc.
│
└── usecases/
    ├── GetCurrentFocus.mjs      # What to do now
    ├── CalculateDrift.mjs       # Plan vs reality
    ├── RecordAttribute.mjs      # Log mood, energy, etc.
    ├── DiscoverCorrelations.mjs # Find patterns
    ├── PromoteCorrelation.mjs   # Correlation → Belief
    ├── RunCeremony.mjs          # Execute ceremony flow
    └── GenerateDailyRecord.mjs  # Aggregate day across all sources
```

---

## Frontend: LifeApp

**Frontend transformation:**

```
frontend/src/Apps/
├── LifelogApp.jsx    → DEPRECATED (rename to LifeApp.jsx)
└── LifeApp.jsx       → NEW unified app

frontend/src/modules/Life/
├── index.mjs
│
├── views/
│   ├── DayView.jsx          # Single day: what happened, how I felt, what I did
│   ├── DriftView.jsx        # Plan vs reality visualization
│   ├── FocusView.jsx        # "What should I do now?" with priorities
│   ├── CeremonyView.jsx     # Interactive ceremony flows
│   └── InsightsView.jsx     # Correlations and discovered patterns
│
├── components/
│   ├── AttributeInput.jsx   # Mood/energy quick entry (1-10 scale)
│   ├── BeliefCard.jsx       # Belief with confidence meter
│   ├── GoalProgress.jsx     # Goal state + progress
│   ├── CorrelationCard.jsx  # "Exercise ↔ Mood (+0.72)"
│   ├── DriftIndicator.jsx   # Visual drift gauge
│   └── TimelineEntry.jsx    # Single lifelog event
│
└── hooks/
    ├── useLife.js           # Main data hook
    ├── useFocus.js          # Current priorities
    ├── useDrift.js          # Drift calculations
    └── useAttributes.js     # Attribute tracking
```

**LifeApp.jsx structure:**

```jsx
// Simplified view of the unified LifeApp
const LifeApp = () => {
  const [view, setView] = useState('today'); // today | drift | focus | insights | ceremony

  return (
    <LifeProvider>
      <AppShell>
        <Navigation view={view} onViewChange={setView} />

        {view === 'today' && <DayView />}      {/* What happened today + quick attribute entry */}
        {view === 'drift' && <DriftView />}    {/* Am I living my values? */}
        {view === 'focus' && <FocusView />}    {/* What should I do now? */}
        {view === 'insights' && <InsightsView />} {/* Patterns & correlations */}
        {view === 'ceremony' && <CeremonyView />} {/* Guided reflection */}

      </AppShell>
    </LifeProvider>
  );
};
```

---

## Data Model

**File storage structure:**

```yaml
# data/household[-{hid}]/users/{uid}/life/

# Core attribute definitions
attributes.yml:
  mood:
    id: mood
    name: "Mood"
    type: scale_1_10
    category: wellbeing
    prompt: "How's your mood today?"
    icon: "😊"
    active: true

  energy:
    id: energy
    name: "Energy"
    type: scale_1_10
    category: wellbeing
    prompt: "How's your energy level?"
    icon: "⚡"
    active: true

  focus:
    id: focus
    name: "Focus"
    type: scale_1_10
    category: productivity
    prompt: "How focused were you today?"
    icon: "🎯"
    active: true

# Daily attribute entries (date-keyed like lifelog)
attributes/2024-03-20.yml:
  mood: { value: 7, timestamp: "2024-03-20T21:00:00Z", source: telegram }
  energy: { value: 8, timestamp: "2024-03-20T07:30:00Z", source: manual }
  focus: { value: 6, timestamp: "2024-03-20T18:00:00Z", source: journalist }

# Discovered correlations
correlations.yml:
  - id: exercise-mood-001
    factor_a: strava.weekly_activities
    factor_b: mood
    direction: positive
    strength: 0.72
    p_value: 0.003
    sample_size: 45
    observation_period: "90 days"
    discovered_at: 2024-03-15
    status: detected
    insight: "You rate mood 23% higher on days you exercise"

# The plan (existing lifeplan.yml structure)
plan.yml:
  # ... full lifeplan schema from existing design ...

# Lifelog data stays in existing location
# data/household[-{hid}]/users/{uid}/lifelog/*.yml
```

---

## API Layer

```
# ════════════════════════════════════════════════════════════════
# PRESENT - "What should I do now?"
# ════════════════════════════════════════════════════════════════
GET  /api/v1/life/focus                    # Current priorities + suggestions
GET  /api/v1/life/drift                    # Multi-dimensional drift snapshot
GET  /api/v1/life/drift/history            # Drift over time

# ════════════════════════════════════════════════════════════════
# PAST - What happened (lifelog)
# ════════════════════════════════════════════════════════════════
GET  /api/v1/life/log/:date                # Single day aggregated
GET  /api/v1/life/log?from=&to=            # Date range
GET  /api/v1/life/log/sources              # Available data sources

# ════════════════════════════════════════════════════════════════
# FUTURE - What should happen (lifeplan)
# ════════════════════════════════════════════════════════════════
GET  /api/v1/life/plan                     # Full plan
PATCH /api/v1/life/plan/:section           # Update section

# Goals
GET  /api/v1/life/goals                    # All goals by state
GET  /api/v1/life/goals/:id                # Single goal
POST /api/v1/life/goals/:id/transition     # State machine transition

# Beliefs
GET  /api/v1/life/beliefs                  # All beliefs
POST /api/v1/life/beliefs/:id/evidence     # Add evidence
PATCH /api/v1/life/beliefs/:id             # Update belief

# Values
GET  /api/v1/life/values                   # Ranked values
PATCH /api/v1/life/values                  # Reorder values

# ════════════════════════════════════════════════════════════════
# CORE - Shared concepts
# ════════════════════════════════════════════════════════════════

# Attributes (mood, energy, custom tracking)
GET  /api/v1/life/attributes               # Attribute definitions
POST /api/v1/life/attributes               # Create custom attribute
GET  /api/v1/life/attributes/entries/:date # Day's attribute values
POST /api/v1/life/attributes/entries       # Record attribute value

# Correlations
GET  /api/v1/life/correlations             # Discovered patterns
POST /api/v1/life/correlations/:id/promote # → Belief
POST /api/v1/life/correlations/:id/dismiss # Mark as not useful
POST /api/v1/life/correlations/discover    # Trigger discovery (async)

# Daily records
GET  /api/v1/life/day/:date                # Complete day view (all sources)
GET  /api/v1/life/day/today                # Shorthand for today

# ════════════════════════════════════════════════════════════════
# CEREMONIES
# ════════════════════════════════════════════════════════════════
GET  /api/v1/life/ceremony/:type           # Get ceremony content
POST /api/v1/life/ceremony/:type/complete  # Record completion
GET  /api/v1/life/ceremony/schedule        # Upcoming ceremonies
```

---

## Implementation Phases

| Phase | Focus | Deliverables |
|-------|-------|--------------|
| **1. Restructure** | Move lifelog into life/log/ | Domain structure, updated imports, LifeApp.jsx shell |
| **2. Core entities** | Attribute, AttributeEntry, DailyRecord | Attribute tracking via Telegram/UI, daily aggregation |
| **3. Plan foundation** | Port lifeplan design entities | Goal state machine, Belief with evidence, Values |
| **4. Present fulcrum** | AlignmentService, DriftService | `/focus` and `/drift` endpoints, FocusView |
| **5. Correlations** | CorrelationEngine, BeliefDiscovery | Pattern detection, correlation → belief promotion |
| **6. Ceremonies** | CeremonyService, scheduling | Guided reflection flows, adherence tracking |
| **7. Cross-domain** | Finance/health/nutrition integration | Unified daily record, multi-domain drift |

**Phase 1 migration checklist:**

```
□ Create __backend/src/2_domains/life/ structure
□ Move lifelog/ contents → life/log/
□ Create life/core/ with Attribute, Correlation, DailyRecord
□ Create life/plan/ (empty, ready for lifeplan entities)
□ Create life/now/ (empty, ready for alignment services)
□ Update all imports referencing old lifelog path
□ Create __backend/src/3_applications/life/
□ Rename LifelogApp.jsx → LifeApp.jsx
□ Update frontend routes
□ Update API routes /api/v1/lifelog → /api/v1/life/log
□ Backward compat: redirect old routes temporarily
```

---

## Dependencies

| Existing System | How Life Uses It |
|-----------------|------------------|
| `ConfigService` | Load user/household context, cadence config |
| `Journalist` | AI-guided reflection, feedback capture, attribute prompts |
| `Telegram adapter` | Unit ceremony delivery, quick attribute entry |
| `Scheduling/TaskRegistry` | Ceremony triggers, correlation discovery jobs |
| `Finance domain` | Spending data for value drift calculation |
| `Health domain` | Metrics for belief evidence, goal tracking |
| `Nutrition domain` | Food log for health quality tracking |

**No breaking changes** - Life domain restructures existing lifelog and adds new capabilities alongside.

---

## Relationship to Lifeplan Design

This document extends and restructures the concepts from `2026-01-29-lifeplan-domain-design.md`:

- **Lifeplan design** → becomes `life/plan/` subdomain (entities, services, value-objects)
- **Lifelog domain** → becomes `life/log/` subdomain (existing extractors, aggregator)
- **New concepts** → `life/core/` (Attribute, Correlation) and `life/now/` (AlignmentService)

The full lifeplan schema (Purpose, Qualities, Values, Beliefs, Goals, Ceremonies, etc.) remains as designed - it simply moves into the `life/plan/` subdomain within the unified structure.
