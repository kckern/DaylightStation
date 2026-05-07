# Health-Coach Reasoning Architecture Design

**Date:** 2026-05-06
**Audience:** Engineer who knows the codebase. Direct, operational.
**Goal:** Replace the current 30+ retrieval/analytical tools with a small, composable two-tool analytical surface plus an in-memory playbook library, so the agent thinks rather than parrots.

> **Companion docs:**
> - [`docs/_wip/audits/2026-05-06-concierge-vs-healthcoach-agent-framework-audit.md`](../../_wip/audits/2026-05-06-concierge-vs-healthcoach-agent-framework-audit.md) — frames the framework convergence (now landed).
> - [`docs/reference/agents/`](../../reference/agents/) — the framework state.

---

## Problem

The agent today has 30+ tools and produces hand-wavy descriptive recall instead of analysis. Concrete failure mode from a real transcript:

> User: *"if I were consuming at the level given my BMR, I should be losing more weight than I am. Confirm?"*
>
> Agent: *"Your tracking density is extremely low, indicating significant under-reporting…"*
>
> (Two turns earlier, the same agent said tracking density was *high*. It contradicted itself within the same conversation. It also did no math — it paraphrased a hand-wavy summary tool.)

Three structural issues stack:

1. **Bloated descriptive tools** (`analyze_history`, `metric_snapshot`, `summarize_change`) invite the LLM to summarize without thinking.
2. **No deterministic compute** — the agent does arithmetic in its head, gets it wrong, doesn't notice.
3. **No memory of derived knowledge** — a finding from one turn doesn't survive to the next; the agent re-derives or re-fabricates.

## Architecture

```
                      ┌─────────────────────────────────┐
                      │       HealthCoachAgent          │
                      │   (existing BaseAgent class)    │
                      └────────────────┬────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
       ╔══════▼══════╗         ╔══════▼══════╗         ╔══════▼══════╗
       ║ Data Access ║         ║   Compute   ║         ║   Memory    ║
       ║             ║         ║             ║         ║  / Playbooks║
       ╚══════╤══════╝         ╚══════╤══════╝         ╚══════╤══════╝
              │                        │                        │
   query_health(...)               compute(expr)        record_playbook,
   personal_constants()                                  update_playbook
   list_periods, query_named_period,                     (read via prompt's
   remember_period, forget_period                         working-memory section)
```

**The whole architecture in one paragraph:** the agent thinks → emits `query_health` calls (the SQL-equivalent retriever) → emits `compute(expr)` calls for deterministic math → recalls or writes **playbooks** (rich memory entries with prose recipes) → produces prose grounded in audit-trailed numbers. 9 tools total. The 30+ existing analytical tools retire.

**Single new dependency:** the physiological model (BMR formula, calorie-to-pound constant, etc.) lives **as text inside playbooks**, not as code. One source of truth per formula in the seed playbook library. Agents adapt formulas via `compute(expr)` rather than calling a black-box wrapper.

**Single new config:** `personal_constants` exposes height/age/sex/calibration values from the user's existing `data/users/<userId>/auth/health-personal.yml` (or equivalent — implementer chooses location).

## Tool catalogue

| Tool | New / existing | Role |
|---|---|---|
| **`query_health(...)`** | NEW | The SQL-equivalent retriever + aggregator |
| **`compute(expression, inputs?)`** | NEW | Sandbox JS math eval |
| **`personal_constants()`** | NEW | Read calibration values from config |
| **`record_playbook(playbook)`** | NEW | Add or replace by id |
| **`update_playbook({ id, last_verified, ... })`** | NEW | Refresh after running a recipe |
| `list_periods`, `query_named_period`, `remember_period`, `forget_period` | existing | Period vocabulary |

**Retired** (30 tools to delete):

```
Tier 3 (legacy retrieval) — folded into query_health:
  get_weight_trend, get_today_nutrition, get_nutrition_history,
  get_recent_workouts, get_recent_fitness_sessions, get_health_summary,
  is_day_closed, query_historical_weight, query_historical_nutrition,
  query_historical_workouts, query_historical_reconciliation,
  query_historical_coaching, get_compliance_summary,
  get_reconciliation_summary, get_adjusted_nutrition, get_coaching_history

Tier 2 (legacy analytics) — folded into query_health + compute:
  aggregate_metric, aggregate_series, metric_distribution, metric_percentile,
  metric_snapshot, compare_metric, summarize_change, conditional_aggregate,
  correlate_metrics, metric_trajectory, detect_regime_change, detect_anomalies,
  detect_sustained, find_similar_period, deduce_period

Tier 1 (legacy bloat) — explicitly retired (the parrot-makers):
  analyze_history
```

**Survivors (in addition to the new tools):** `list_periods`, `query_named_period`, `remember_period`, `forget_period`, `read_notes_file`, `write_dashboard`, `get_user_goals`, `log_coaching_note`, `send_channel_message`, `browse_fitness_catalog`, `get_fitness_content`, `get_program_state`, `update_program_state`, `get_recently_watched_fitness`. (CRUD and content-browsing tools that aren't analytical — they keep their narrow purposes.)

## `query_health` spec

The single rich data-access tool. SQL-flavored grammar.

### Signature

```js
query_health({
  metric:      string | string[],
  period:      Period,
  granularity: 'raw' | 'daily' | 'weekly' | 'monthly',     // default 'daily'
  aggregate:   AggregateOp | { op: AggregateOp, ...extras }, // default 'none'
  group_by?:   GroupKey,
  filter?:     Filter | Filter[],
  join?:       string[],
  correlate?:  { with: string, method?: 'pearson' | 'spearman', lag?: number },
  rolling?:    { fn: AggregateOp, window: number },
  sort?:       { by: string, dir: 'asc' | 'desc' },
  limit?:      number
})
```

### Metric vocabulary

| Category | Metrics |
|---|---|
| Body | `weight_lbs`, `weight_kg`, `fat_pct`, `lean_mass_lbs` |
| Nutrition | `calories`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g`, `tracking_density` |
| Activity | `workout_count`, `workout_duration_min`, `workout_kcal`, `hr_avg`, `hr_max`, `hr_minutes_zone2` |

Extensible — new metrics added by the implementer as more data sources land. The Tier 3 retrieval stack (existing `healthStore`, `healthService`, `fitnessSessionService`) wraps the underlying YAML/Plex/Strava data; the metric vocabulary maps to those sources.

### Aggregate ops

| Op | Returns |
|---|---|
| `'none'` | `{ rows: [{ date, value, ...joined }] }` |
| `'mean' \| 'sum' \| 'min' \| 'max' \| 'count'` | `{ value: number, count: number }` |
| `'p10' \| 'p50' \| 'p90'` | `{ value: number, count: number }` |
| `'stdev'` | `{ value: number, mean: number, count: number }` |
| `'regression'` | `{ slope, intercept, r_squared, n }` |
| `'histogram'` | `{ bins: [{ lower, upper, count }] }` |

### Group keys

`'day_of_week'`, `'weekday_vs_weekend'`, `'workout_type'`, `'month'`, `'year'`, `'workout_intensity_zone'`, `{ custom: [{ name, where: Filter }] }`. Result becomes `{ groups: { <key>: { value: ..., count: ... } } }`.

### Filter shape

`{ field, op: '<' | '<=' | '==' | '>' | '>=' | 'in' | 'not_in', value }`. `field` references the queried metric (`'value'`) or any joined metric.

### Return contract

Every response includes `meta: { metric, period, granularity, n, generated_at }` so the agent can confirm what it actually queried.

### Worked examples

```js
// Weight trend last 30d
query_health({ metric: 'weight_lbs', period: 'last_30d', aggregate: 'regression' })
// → { slope: -0.0014, intercept: 170.36, r_squared: 0.08, n: 28 }

// Average daily protein last 90d, weekday vs weekend
query_health({
  metric: 'protein_g', period: 'last_90d',
  group_by: 'weekday_vs_weekend', aggregate: 'mean'
})
// → { groups: { weekday: { value: 96, count: 64 }, weekend: { value: 78, count: 26 } } }

// Days last 30d where calories < 1000
query_health({
  metric: 'calories', period: 'last_30d', granularity: 'daily',
  filter: [{ field: 'value', op: '<', value: 1000 }],
  join: ['weight_lbs', 'tracking_density']
})
// → { rows: [{ date, value: 820, weight_lbs: 170.4, tracking_density: 0.4 }, ...] }

// Correlation between protein and zone-2 minutes, last 60d
query_health({
  metric: 'protein_g', period: 'last_60d',
  correlate: { with: 'hr_minutes_zone2', method: 'pearson' }
})
// → { r: 0.21, n: 60, p_value: 0.10 }
```

## `compute` spec

Sandboxed JavaScript expression evaluation; no I/O, no async, no imports.

### Signature

```js
compute({
  expression: string,    // a JS expression
  inputs?: object        // named values; available as identifiers in expression
})
```

### Sandbox

Node's built-in `vm.runInNewContext(expression, frozenScope, { timeout: 50, displayErrors: true })`. No third-party sandbox dependency.

### Available in scope

- The user's `inputs` (whatever keys they passed)
- `Math` (full Math object — sqrt, log, PI, abs, min, max, round, etc.)
- `parseFloat`, `parseInt`, `isFinite`, `isNaN`
- `Array.isArray`
- Array prototype methods on any array passed in (`map`, `filter`, `reduce`, `slice`)

### Not available

`require`, `import`, `eval`, `Function`, `setTimeout`, `setInterval`, `process`, `fs`, network, file paths, `globalThis` keys other than the whitelist.

### Errors

Structured tool error: `{ error: 'syntax', message }` | `{ error: 'runtime', message }` | `{ error: 'timeout' }`.

### Return shape

```js
{ value: any, type: 'number' | 'boolean' | 'string' | 'array' | 'object', expression, durationMs }
```

### Worked example — under-reporting analysis as 4 calls

```js
compute({ expression: "10*kg + 6.25*cm - 5*age + 5 + activity",
          inputs:    { kg: 77.6, cm: 180, age: 40, activity: 350 } })
// → 1986

compute({ expression: "(intake - tdee) * 30 / 3500",
          inputs:    { intake: 1462, tdee: 1986 } })
// → -4.49

compute({ expression: "slope * 30",
          inputs:    { slope: -0.0014 } })
// → -0.042

compute({ expression: "1 - actual_dw / predicted_dw",
          inputs:    { actual_dw: -0.042, predicted_dw: -4.49 } })
// → 0.991
```

Each call is one labeled numeric fact in the transcript.

### Why expressions, not statements

Forces the agent to compose small named results. Mirrors the natural decomposition of analytical questions ("compute TDEE, then deficit, then predicted Δw"). Each `compute` is one transcript-recorded numeric fact. A scripting model would invite 30-line analyses; expressions force 4-call chains.

## `personal_constants` spec

```js
personal_constants()
// → { weight_kg: 77.6, weight_lbs: 171.1, height_cm: 180, age: 40, sex: 'M',
//     bmr_formula: 'mifflin-st-jeor', activity_pal: 1.55, scale_bias_lbs: 0,
//     calorie_per_lb_fat: 3500 }
```

Reads from the user's existing personal-context YAML. Implementer locates the appropriate config path and wires the read; no new persistence layer.

## Playbook schema

Stored under `WorkingMemoryState`'s `playbooks` key. Auto-renders into the prompt's "## Working Memory" section every turn.

### One entry

```yaml
- id: under-reporting-calories          # stable slug; updates rewrite by id
  fact: "User frequently under-reports calorie consumption (last check: ~99% gap)."
  confidence: high                       # high | medium | low | unverified
  tags: [nutrition, weight, energy-balance]
  recipe: |
    Compute TDEE from body comp + activity, compare predicted Δweight from
    logged deficit to actual weight slope. Gap = % of deficit unlogged.

    Steps (sub period as needed):
      1. query_health({ metric: 'weight_lbs',   period: P, aggregate: 'regression' }) → slope
      2. query_health({ metric: 'calories',     period: P, aggregate: 'mean' })       → intake
      3. query_health({ metric: 'workout_kcal', period: P, aggregate: 'mean' })       → activity
      4. personal_constants()                                                          → kg/cm/age/sex
      5. compute("10*kg + 6.25*cm - 5*age + 5 + activity")                             → tdee
      6. compute("(intake - tdee) * <days> / 3500")                                    → predicted_dw
      7. compute("slope * <days>")                                                     → actual_dw
      8. compute("1 - actual_dw / predicted_dw")                                       → gap_pct
  last_verified:
    at: '2026-05-06T16:57Z'
    period: 'last_30d'
    result: { gap_pct: 0.99, predicted_dw: -4.49, actual_dw: -0.042 }
  related_playbooks: [tracking-density-reliability]
  notes: |
    Pattern is stable across last 3 verifications. Persistent behavior;
    refresh on demand rather than every turn.
```

**Required:** `id`, `fact`, `recipe`. Everything else optional.

### Tools

```js
record_playbook({
  id: string, fact: string, recipe: string,
  confidence?: 'high' | 'medium' | 'low' | 'unverified',
  tags?: string[],
  related_playbooks?: string[],
  notes?: string
})
// Adds new or replaces existing by id. Sets confidence='unverified' if not provided.

update_playbook({
  id: string,
  last_verified?: { at, period, result },
  confidence?: ...,
  notes?: string
})
// Refreshes verification timestamp/result on existing playbook. Errors if id not found.
```

`recall_playbooks` not needed — playbooks render into prompt every turn via `WorkingMemoryState.serialize()`.

### Pre-seeded library (8 playbooks)

Ships at `backend/src/3_applications/agents/health-coach/playbooks/seed.yml`:

1. **`under-reporting-calories`** — TDEE vs logged intake vs actual weight slope.
2. **`weight-trend-noise`** — daily weight ±2 lb water swing; use 7-day smoothed.
3. **`tracking-density-reliability`** — log density ≥ 0.8 reliable, < 0.6 suspect.
4. **`workout-source-reconciliation`** — manual logs ⋂ HR ⋂ Strava; gap analysis.
5. **`protein-adequacy`** — target 0.8 g/lb lean mass; compare to actual.
6. **`weekly-cadence`** — 3-4 strength + 2-3 cardio baseline; flag deviations.
7. **`weekend-vs-weekday-divergence`** — weekend kcal drift; quantify gap.
8. **`heart-rate-zone-load`** — zone 2 minutes/week; below 90 = undertrained.

**Loading mechanics:**

- HealthCoachAgent on first turn: if `memory.get('playbooks')` is empty, load seed → `state.set('playbooks', seedPlaybooks)`. Never re-seeds afterward.
- Operators edit the seed file freely; existing users retain their evolved library.
- CLI command `dscli health-coach reseed-playbooks --user <id> --merge` merges new seed entries into an existing user's library by id (existing wins on conflict).

## Prompt changes

Replace the existing `chat.mjs` (56 lines, dominated by the 22-row tool cheatsheet) with ~80 lines:

```
1. Identity + tone (existing — kept)
2. Tools — three primary, six helpers (NEW shorter version)
3. Reasoning patterns (NEW — show-your-work discipline)
4. Playbook protocol (NEW — how to use the memory library)
5. Self-consistency rail (NEW — guard against contradictions)
6. Period syntax (existing — kept)
7. Output (existing — kept)
```

Full text is committed alongside this spec at:
`backend/src/3_applications/agents/health-coach/prompts/chat.mjs` (the implementer rewrites this file).

The four new sections, verbatim:

```
## Tools

You have three primary analytical tools and a small library of helpers:

- query_health(...) — single data-access tool. Pass metric, period, optional
  aggregate / group_by / filter / join / correlate. Examples in the playbooks.
- compute(expression, inputs?) — sandboxed math. Use this for any arithmetic
  on query results. Do NOT do mental math in your prose. The user will catch
  errors and the analysis will be wrong.
- personal_constants() — height, age, sex, current weight in kg/lb, scale
  bias, default activity multiplier. Read these for any metabolic calculation.

Helpers: list_periods, query_named_period, remember_period, forget_period,
remember_note, recall_note, record_playbook, update_playbook.

## Reasoning patterns

When the user asks you to confirm a hypothesis, explain a discrepancy, or
'show your work':

  1. Look at the playbooks in Working Memory. If one matches the question,
     follow its recipe. If not, plan your own chain.
  2. Run query_health calls to gather the inputs.
  3. Run compute() calls to do the math. Each compute is one labeled step.
  4. State the conclusion with magnitude and the chain that produced it:
     "TDEE 1986 (Mifflin + activity 350). Logged 1462 → 524/day apparent
      deficit → predicted 4.5 lb/30d. Actual 0.04 lb. Gap: 99%."

Do not paraphrase a tool result and call that an analysis. If the question
asks for synthesis or causation, you must compute something — not just
reword retrieved numbers.

## Playbook protocol

The Working Memory section above contains analytical playbooks — known
patterns about this user with recipes to verify them.

When the user's question matches a playbook's fact:
  1. Reference the playbook's last_verified result first if recent (< 30 days).
  2. Run the recipe to refresh the verification — fresh numbers > stale claims.
  3. Call update_playbook with the new last_verified.
  4. If a pattern flips, update confidence and notes.

When you discover a stable pattern through analysis (n ≥ 30, effect beyond
noise), call record_playbook.

## Self-consistency

Within a single turn, do not contradict an earlier tool result. If
query_health returned tracking_density 0.92 in step 2, do not later say
"tracking is low" without re-querying. Your prior tool calls are in your
context — re-read them before making a claim.

If two playbooks disagree, call it out and run a verification rather than
picking one.
```

## Migration plan (operational, not implementation tasks)

Sequence to land safely on prod:

1. **Build new tools alongside existing.** Add `query_health`, `compute`, `personal_constants`, `record_playbook`, `update_playbook` to a new tool factory. Don't touch existing factories yet. Agent now has 30+5 = 35 tools — temporarily worse but unbreaking.
2. **Pre-seed playbooks.** Add seed file + first-turn auto-seed logic. Verify seeded library renders into the prompt.
3. **Update prompt.** Replace `chat.mjs`. Now the agent's incentive structure points at the new tools.
4. **Live verification.** A handful of turns through the live UI, exercising each playbook. Capture transcripts; verify each one shows the query+compute chain instead of paraphrase.
5. **Retire legacy tools.** Delete the 30 retired factories + their wiring in `HealthCoachAgent.registerTools`. Verify with `grep` that nothing else imports them. Tests that asserted the old tools' behavior get deleted (their replacements are integration tests through `query_health`).
6. **Deploy + final smoke.** A real conversation that exercises under-reporting, weight noise, weekend divergence — confirm the agent does math, not paraphrase.

Each step ships independently. Step 5 has the largest blast radius; steps 1-4 are additive.

## Testing strategy

| Layer | Coverage |
|---|---|
| `query_health` unit tests | Each metric × each aggregate × each group_by combination. Filter chaining. Join correctness. Correlate output shape. |
| `compute` unit tests | Sandbox safety (no `require`, `process`, `eval`); expression evaluation; named-input binding; structured error paths (syntax, runtime, timeout). |
| Playbook tests | Seed-on-first-turn behavior; record_playbook / update_playbook semantics; auto-render into prompt. |
| Integration | Replay each pre-seeded playbook's recipe end-to-end against fixture data; assert the chain runs and produces the expected numeric output. |
| Live smoke | Curl the deployed `/api/v1/agents/health-coach/run` with the original parrot-failing question ("am I under-reporting?"); assert the response contains computed numbers + "TDEE", "predicted", "actual" — proving the agent did math. |

Vitest for everything except live smoke (curl-based shell script).

## Out of scope

- **Frontend latency wire fix.** The UI shows `0ms` for every tool call. Real numbers are in the transcript on disk. Out of scope here; tracked separately.
- **Code-execution / Python interpreter tool.** Considered during brainstorming; rejected in favor of `query_health` + `compute`. The expression sandbox covers ~all needs without the security/latency cost of a Python sandbox.
- **`BodyEnergyModel` as code.** Considered; rejected in favor of formulas-as-text inside playbooks. One source of truth per formula in the seed library; no compiled abstractions.
- **Cross-agent reasoning.** Concierge does not get this toolkit. Only health-coach.

## Where it lives

- New tool factory: `backend/src/3_applications/agents/health-coach/tools/HealthQueryToolFactory.mjs` (or similar — implementer chooses the file structure)
- Seed playbooks: `backend/src/3_applications/agents/health-coach/playbooks/seed.yml`
- Prompt rewrite: `backend/src/3_applications/agents/health-coach/prompts/chat.mjs`
- Tests: `tests/isolated/agents/health-coach/`
- Personal constants source: `data/users/<userId>/auth/health-personal.yml` (or wherever the implementer locates it)
