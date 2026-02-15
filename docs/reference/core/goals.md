# Goals

> Universal goal interface for cross-domain goal tracking with a common envelope and domain-specific parameters

---

## Overview

Goals in DaylightStation follow a **federated model**: each domain (fitness, nutrition, finance, etc.) owns and manages its own goals, but all goals conform to a universal interface so the broader lifeplan system can aggregate, compare, and reason across them.

```
                    LIFEPLAN (aggregator)
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
       ┌─────────┐  ┌──────────┐  ┌──────────┐
       │ Fitness  │  │Nutrition │  │ Finance  │
       │  Goals   │  │  Goals   │  │  Goals   │
       └─────────┘  └──────────┘  └──────────┘
       domain-      domain-       domain-
       specific     specific      specific
       params       params        params
```

**Key principle:** Domains define goals on their own terms (what to measure, how to calculate progress). The universal interface defines the envelope (identity, state, progress) so cross-domain views work without knowing domain internals.

---

## Data Location

Goals are stored per-user, per-domain:

```
data/users/{username}/goals/
├── fitness.yml
├── nutrition.yml
└── finance.yml
```

Each file contains an array of goals for that domain.

---

## Goal Schema

Every goal has a **common envelope** plus a domain-specific **params** bag.

### Common Envelope

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique within the domain. Kebab-case. |
| `name` | string | yes | Human-readable goal name |
| `domain` | string | yes | Domain identifier (fitness, nutrition, finance, etc.) |
| `state` | enum | yes | Lifecycle state (see States below) |
| `created_at` | date | yes | ISO date when goal was created |
| `target_date` | date | no | Deadline. Null for ongoing goals. |
| `progress` | float | no | 0.0 to 1.0. Domain calculates this. Null if not measurable yet. |
| `params` | object | no | Domain-specific parameters (see Domain Params below) |

### Example

```yaml
# data/users/kckern/goals/fitness.yml
- id: lose-weight
  name: "Reach 165 lbs"
  domain: fitness
  state: active
  created_at: "2026-02-01"
  target_date: "2026-03-11"
  progress: 0.35
  params:
    metric: weight
    target_lbs: 165
    start_lbs: 185

- id: workout-consistency
  name: "6 workouts per week"
  domain: fitness
  state: active
  created_at: "2026-02-01"
  target_date: null
  progress: null
  params:
    metric: workout_count
    per_week: 6
```

```yaml
# data/users/kckern/goals/nutrition.yml
- id: daily-protein
  name: "Hit 100g protein daily"
  domain: nutrition
  state: active
  created_at: "2026-02-01"
  target_date: null
  progress: null
  params:
    metric: protein_g
    target: 100
    period: daily

- id: calorie-tracking
  name: "Log meals every day"
  domain: nutrition
  state: active
  created_at: "2026-02-01"
  target_date: null
  progress: null
  params:
    metric: tracking
    period: daily
```

---

## States

Goals have a simple lifecycle. These states are intentionally minimal — they map forward to the richer lifeplan state machine when that system comes online.

```
              ┌──────────┐
              │  active   │
              └────┬──────┘
         ┌─────────┼─────────┐
         ▼         ▼         ▼
   ┌──────────┐ ┌────────┐ ┌────────┐
   │ achieved │ │ paused │ │abandoned│
   └──────────┘ └───┬────┘ └────────┘
                    │
                    ▼
                 active
                (resume)
```

| State | Meaning | Lifeplan Mapping |
|-------|---------|------------------|
| `active` | Currently pursuing | `committed` |
| `achieved` | Target met (terminal) | `achieved` |
| `paused` | Temporarily on hold | `paused` |
| `abandoned` | Gave up (terminal) | `abandoned` |

**Valid transitions:**

| From | To |
|------|----|
| `active` | `achieved`, `paused`, `abandoned` |
| `paused` | `active`, `abandoned` |
| `achieved` | _(terminal)_ |
| `abandoned` | _(terminal)_ |

---

## Progress Calculation

Progress is a `0.0` to `1.0` float. Each domain calculates it using domain-specific logic. The universal interface does not prescribe how — it just reads the number.

Each domain provider reads from its **own existing data stores** to calculate progress. Harvesters populate those stores (Withings -> health, Buxfer -> finance, etc.) but the goal system doesn't know or care about harvesters — it only reads from the domain's store at query time. This is pure DDD: domain logic reads domain data.

```
ADAPTER LAYER          DOMAIN STORES             GOAL PROVIDERS
(populates stores)     (own their data)          (calculate progress)

Withings ──► health store ──► HealthGoalProvider ──► "weight: 72%"
Buxfer   ──► finance store ─► FinanceGoalProvider ─► "savings: 64%"
Strava   ──► fitness store ─► FitnessGoalProvider ──► "3/wk: 100%"
Food log ──► nutrition store► NutritionGoalProvider► "protein: 85%"
Invoices ──► cost store ────► CostGoalProvider ────► "AI budget: 60%"
```

**Examples:**

| Domain | Goal | Data Source | Calculation |
|--------|------|------------|-------------|
| Health | Reach 165 lbs | WeightProcessor output | `(start - current) / (start - target)` |
| Fitness | 3 sessions/week | SessionService | `sessions_this_week / target` |
| Nutrition | 100g protein/day | FoodLogService | `today_protein / target` |
| Finance | Save $50k | Transaction store | `current_savings / 50000` |
| Cost | AI under $500/mo | CostAnalysisService | `1 - (month_spend / budget)` |

Ongoing goals (no target_date) may have progress that resets each period (daily, weekly) or may be null if not yet measurable.

---

## Domain Interface

### IGoalProvider

Each domain that has goals implements `IGoalProvider`. This is the contract that lifeplan and agents use to read goals in a standard way.

```javascript
// backend/src/2_domains/core/goals/IGoalProvider.mjs

/**
 * Interface for domain-specific goal providers.
 * Each domain implements this to expose its goals.
 */
export class IGoalProvider {
  /** @returns {string} Domain identifier (e.g., 'fitness') */
  get domain() { throw new Error('Not implemented'); }

  /**
   * Get all goals for a user in this domain.
   * @param {string} userId
   * @returns {Goal[]} Array of goals with common envelope
   */
  getGoals(userId) { throw new Error('Not implemented'); }

  /**
   * Get a single goal by ID.
   * @param {string} userId
   * @param {string} goalId
   * @returns {Goal|null}
   */
  getGoal(userId, goalId) { throw new Error('Not implemented'); }

  /**
   * Recalculate progress for all active goals.
   * Called by the system before reading goals to ensure freshness.
   * @param {string} userId
   * @returns {Goal[]} Updated goals
   */
  refreshProgress(userId) { throw new Error('Not implemented'); }
}
```

### GoalRegistry

A central registry collects all domain providers so lifeplan and agents can query goals across domains.

```javascript
// backend/src/2_domains/core/goals/GoalRegistry.mjs

export class GoalRegistry {
  #providers = new Map();

  /** Register a domain goal provider */
  register(provider) {
    this.#providers.set(provider.domain, provider);
  }

  /** Get all goals across all domains for a user */
  getAllGoals(userId) {
    const goals = [];
    for (const provider of this.#providers.values()) {
      goals.push(...provider.getGoals(userId));
    }
    return goals;
  }

  /** Get goals for a specific domain */
  getDomainGoals(domain, userId) {
    const provider = this.#providers.get(domain);
    return provider ? provider.getGoals(userId) : [];
  }

  /** Refresh progress across all domains */
  refreshAll(userId) {
    for (const provider of this.#providers.values()) {
      provider.refreshProgress(userId);
    }
  }
}
```

---

## Persistence

### YamlGoalDatastore

Goals are persisted as YAML arrays via `DataService`. The datastore reads/writes `users/{userId}/goals/{domain}.yml`.

```javascript
// backend/src/1_adapters/persistence/yaml/YamlGoalDatastore.mjs

export class YamlGoalDatastore {
  #dataService;

  constructor({ dataService }) {
    this.#dataService = dataService;
  }

  load(userId, domain) {
    return this.#dataService.user.read(`goals/${domain}`, userId) || [];
  }

  save(userId, domain, goals) {
    this.#dataService.user.write(`goals/${domain}`, goals, userId);
  }
}
```

Domain-specific goal providers use this datastore for persistence and add their own progress calculation logic on top.

---

## Domain Providers

Five domains implement `IGoalProvider` in the initial rollout:

### FitnessGoalProvider

**Data source:** `SessionService`, `FitnessProgressClassifier`

**Example goals and params:**

```yaml
# goals/fitness.yml
- id: workout-consistency
  name: "6 workouts per week"
  domain: fitness
  state: active
  created_at: "2026-02-01"
  params:
    metric: session_count
    per_week: 6

- id: session-duration
  name: "30+ minute sessions"
  domain: fitness
  state: active
  created_at: "2026-02-01"
  params:
    metric: min_duration
    target_minutes: 30
```

### HealthGoalProvider

**Data source:** `HealthStore` (weight data from WeightProcessor)

```yaml
# goals/health.yml
- id: lose-weight
  name: "Reach 165 lbs"
  domain: health
  state: active
  created_at: "2026-02-01"
  target_date: "2026-03-11"
  params:
    metric: weight
    target_lbs: 165
    start_lbs: 185

- id: body-fat
  name: "Body fat under 20%"
  domain: health
  state: active
  created_at: "2026-02-01"
  params:
    metric: body_fat_percent
    target: 20
    direction: below
```

### NutritionGoalProvider

**Data source:** `FoodLogService`, `CalorieColorService`

```yaml
# goals/nutrition.yml
- id: daily-protein
  name: "Hit 100g protein daily"
  domain: nutrition
  state: active
  created_at: "2026-02-01"
  params:
    metric: protein_g
    target: 100
    period: daily

- id: calorie-tracking
  name: "Log meals every day"
  domain: nutrition
  state: active
  created_at: "2026-02-01"
  params:
    metric: tracking
    period: daily
```

### FinanceGoalProvider

**Data source:** `BudgetService`, transaction store (Buxfer-harvested)

```yaml
# goals/finance.yml
- id: emergency-fund
  name: "Build $5,000 emergency fund"
  domain: finance
  state: active
  created_at: "2026-02-01"
  target_date: "2026-06-01"
  params:
    metric: savings_balance
    target: 5000
    account: savings

- id: monthly-budget
  name: "Stay under $3,000/month spending"
  domain: finance
  state: active
  created_at: "2026-02-01"
  params:
    metric: monthly_spend
    target: 3000
    direction: below
    period: monthly
```

### CostGoalProvider

**Data source:** `CostAnalysisService`, `CostBudget`

```yaml
# goals/cost.yml
- id: ai-budget
  name: "Keep AI costs under $500/month"
  domain: cost
  state: active
  created_at: "2026-02-01"
  params:
    metric: category_spend
    category: ai
    target: 500
    direction: below
    period: monthly
```

---

## Integration Points

### Health Coach Agent

The `get_user_goals` tool reads goals via the GoalRegistry instead of directly from a single YAML file. This gives the agent visibility into goals from all registered domains.

### NutriBot

NutriBot currently hardcodes `DEFAULT_NUTRITION_GOALS`. With this interface, it reads from `goals/nutrition.yml` and falls back to defaults if no goals are set.

### Lifeplan (Future)

When the lifeplan domain comes online, it aggregates goals from all domains via GoalRegistry. The simple `active/achieved/paused/abandoned` states map directly to the richer lifeplan state machine (`committed`, `achieved`, `paused`, `abandoned`). Goals gain dependencies, milestones, and ceremony integration without changing the domain-specific providers.

### Frontend Dashboard

The fitness dashboard reads goals from the agent-generated dashboard YAML. The underlying data comes from the same goal files that the GoalRegistry serves.

### Future: Productivity Goals

Task-based goals (Todoist, ClickUp) are deferred until a productivity domain is created. Task data currently lives in the lifelog and doesn't have its own domain store.

---

## Migration

### Current State

| Consumer | Current Location | New Location |
|----------|-----------------|--------------|
| Health Coach | `users/{user}/agents/health-coach/goals.yml` | `goals/health.yml` + `goals/fitness.yml` + `goals/nutrition.yml` |
| NutriBot | Hardcoded in `NutriBotConfig.mjs` | `goals/nutrition.yml` (fallback to defaults) |

### Migration Path

1. Create `goals/` directory structure and seed from existing health-coach goals
2. Create `IGoalProvider` interface and `GoalRegistry` in `2_domains/core/goals/`
3. Create `YamlGoalDatastore` in `1_adapters/persistence/yaml/`
4. Implement providers for all five domains (fitness, health, nutrition, finance, cost)
5. Register providers in GoalRegistry during bootstrap
6. Update `get_user_goals` tool to read from GoalRegistry
7. Update NutriBot to read from GoalRegistry with fallback
8. Deprecate `agents/health-coach/goals.yml`
