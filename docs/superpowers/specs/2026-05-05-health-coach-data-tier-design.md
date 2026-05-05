# Health-Coach Analytical Capability — Design

**Date:** 2026-05-05
**Status:** Brainstorm — review before plan
**Author thread:** conversation 2026-05-05 about giving the health-coach agent the analytical primitives it needs to actually coach
**Related:**
- [docs/_wip/audits/2026-05-01-personalized-coaching-overfitting-audit.md](../../_wip/audits/2026-05-01-personalized-coaching-overfitting-audit.md) — audit that established YAML-driven patterns
- [docs/superpowers/specs/2026-05-02-dscli-design.md](2026-05-02-dscli-design.md) — DaylightStation CLI design that this surface plugs into

---

## Why this exists

The health-coach agent today has 26 tools. Most of them return raw windowed slices: today's calorie totals, the last 7 days of workouts, weight history for `[from, to]`. The agent then reads those arrays in context and reasons about them.

That ceiling is too low for actual coaching. A useful coach answers questions like:

- "How is your weight trending compared to where you were six months ago?"
- "When food gets tracked, what does your weight tend to do? When it doesn't?"
- "When did your tracking discipline start slipping?"
- "What's unusual about this week?"
- "The last time you maintained 195 lbs for a stretch — what were you doing differently?"
- "Across the last decade, what was the period most like right now?"

None of those is answerable by fetching a raw window. They require the agent to either (a) hold huge spans of data in context and compute everything itself — which fails for multi-year questions and burns tokens on data the user never sees — or (b) call tools that **read, analyze, contextualize, and surface insight** as compressed answers.

Today, those tools don't exist. This document proposes the set that does.

---

## What the agent must be able to do

A useful health coach is an analyst, not a data-fetcher. The capabilities aren't optional — they're table stakes for an agent built on a reasoning framework. The agent must be able to:

1. **Read data at any aggregation level** — daily, weekly, monthly, yearly, custom windows, named periods.
2. **Analyze** — compute summaries, trends, distributions, slopes, rates.
3. **Compare** — current vs. past, segment vs. segment, condition A vs. condition B.
4. **Correlate** — see how one metric tracks with another, or how outcomes differ across conditions.
5. **Detect** — find regime changes, anomalies, threshold crossings, sustained behaviors.
6. **Contextualize** — locate the present in the user's distribution, against benchmarks, vs. similar past windows.
7. **Surface insight** — return compressed, structured findings the agent can reason from, not raw arrays.
8. **Remember** — keep a small, addressable memory of useful periods and benchmarks across sessions.

The architecture is one set of primitives sitting at the application/domain layer, callable from two transports (in-process tool factory + CLI). Same code, two consumers.

---

## Three tiers, mostly to set context

```
Tier 3 — Patterns                 (have YAML primitives, expose as tools later)
            ↑
            │ patterns are compositions of Tier 2 primitives
            │
Tier 2 — Analytical primitives    (this design — the gap)
            ↑
            │ primitives operate over flexible period inputs
            │
Tier 1 — Windowed reads           (mostly have, small gaps)
```

**Tier 1** (existing) returns raw windows: `query_historical_weight`, `query_historical_nutrition`, `query_historical_workouts`, `query_named_period`, `read_notes_file`. Five small gaps to close (yearly aggregation, longitudinal mirrors for reconciliation/coaching/workouts/nutrition-density). Listed in the gap-fill section below.

**Tier 2** is this design — the analytical surface organized below by capability.

**Tier 3** is patterns-as-callable-tools. The `PatternDetector` already runs YAML-defined primitives over windows since the F1-A refactor; it's wired into `MorningBrief` but not exposed as a tool. Patterns are *literally compositions of Tier 2 primitives* — `cut-mode` is "calorie average below X AND weight delta above Y over window." Once Tier 2 lands, exposing patterns is a thin wrapper. Deferred to a one-page successor spec.

---

## Tier 2 primitives, by capability

Each primitive returns a **compressed answer**: one number, one ratio, one tuple, a small ranked list. Token cost is flat with window size. The agent calls primitives as needed; what it pays for in context is the answers it asked for, not the data they were computed from.

### 1. Read at any aggregation level

**`aggregate_metric({ userId, metric, period, statistic? })`**

Single-value summary of a metric over a period.

```
{
  metric, period: { from, to, label, source },
  statistic: 'mean' | 'median' | 'min' | 'max' | 'count' | 'sum' | 'p25' | 'p75' | 'stdev',
  value, unit,
  daysCovered, daysInPeriod
}
```

Initial metric vocabulary: `weight_lbs`, `fat_percent`, `calories`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g`, `workout_count`, `workout_duration_min`, `workout_calories`, `tracking_density` (ratio 0..1), `coaching_density` (ratio 0..1), `reconciliation_accuracy`. Extensible — new metrics are one factory entry.

Default statistic is `mean`. `tracking_density` and `coaching_density` ignore the statistic; they're always ratios.

**`aggregate_series({ userId, metric, period, granularity, statistic? })`**

Same as `aggregate_metric` but bucketed: returns one value per bucket. Granularity: `daily / weekly / monthly / quarterly / yearly`. The agent uses this when it needs to *see* a series, not when one number suffices. Series length is always small (e.g., a 10-year `yearly` series is 10 rows).

### 2. Analyze trend / trajectory

**`metric_trajectory({ userId, metric, period, granularity? })`**

Slope, direction, fit quality.

```
{
  metric, period,
  slope: number,                // units per day
  slopePerWeek: number,         // human framing
  direction: 'up' | 'down' | 'flat',
  rSquared: number,             // 0..1 fit quality
  start: { date, value },
  end:   { date, value },
  bucketed?: [...]              // optional time-bucketed series, only if granularity provided
}
```

Powers "your weight is dropping at X lbs/week" without the agent having to do the math.

### 3. Compare

**`compare_metric({ userId, metric, period_a, period_b, statistic? })`**

Same metric, two periods, single comparison.

```
{
  metric, statistic,
  a: { period, value, daysCovered, daysInPeriod },
  b: { period, value, daysCovered, daysInPeriod },
  delta, percentChange,
  reliability: 'high' | 'medium' | 'low'
}
```

**`summarize_change({ userId, metric, period_a, period_b })`**

Richer than `compare_metric` — narrates *what changed and how*. Returns the comparison statistics PLUS a structured change summary:

```
{
  metric, a, b, delta, percentChange,
  changeShape: 'monotonic' | 'volatile' | 'step' | 'reversal',
  inflectionDate: 'YYYY-MM-DD' | null,    // most likely point of change
  varianceA: number, varianceB: number,
  drivers: [                              // if applicable: which sub-windows / factors drove the delta
    { description: 'tracking_density dropped 0.78→0.34', impact: 'high' },
    ...
  ]
}
```

Powers "your weight is up 4 lbs vs. last quarter — most of the move happened in the last three weeks, and tracking dropped sharply at the same time."

### 4. Correlate / condition

**`conditional_aggregate({ userId, metric, period, condition, statistic? })`**

Compute a metric statistic only on days matching a condition. The workhorse for "when X, what does Y do."

```
{
  metric, statistic, period,
  condition: { description, ...predicate },
  matching:    { value, daysMatched },
  notMatching: { value, daysNotMatched },
  delta
}
```

Conditions are a structured vocabulary, not free text. Initial set:

- `{ tracked: true | false }` — nutrition logged that day
- `{ workout: true | false }` — workout logged that day
- `{ day_closed: true | false }` — explicitly marked done
- `{ weekday: 'Mon'|'Tue'|... }` — day-of-week
- `{ weekend: true | false }`
- `{ season: 'winter'|'spring'|'summer'|'fall' }`
- `{ since: 'YYYY-MM-DD' }` / `{ before: 'YYYY-MM-DD' }` — before/after a specific date
- `{ tag_includes: 'travel' }` — nutrition entries tagged with a string
- `{ field_above: { metric, value } }` / `{ field_below: { metric, value } }` — comparator predicates

Adding new conditions is a small enum extension.

**`correlate_metrics({ userId, metric_a, metric_b, period, granularity? })`**

Joint behavior of two metrics over a period. Returns rank correlation (Spearman) by default — robust to outliers and works on any monotone relationship:

```
{
  metric_a, metric_b, period, granularity: 'daily' | 'weekly' | 'monthly',
  correlation: number,           // -1..+1 Spearman
  pearson: number,               // -1..+1 for the same data
  pairs: number,                 // sample size
  interpretation: 'strong-positive' | 'weak-positive' | 'none' | 'weak-negative' | 'strong-negative',
  scatter?: [{ a, b, date }, ...] // optional, only if granularity = 'weekly'+ to keep it short
}
```

Powers "weight tends to drop on weeks where protein is high" without the agent having to compute correlations in its head.

### 5. Detect

**`detect_regime_change({ userId, metric, period })`**

Find inflection points where a metric's behavior shifted. Returns up to a small number of candidate change points with the regimes on either side:

```
{
  metric, period,
  changes: [
    {
      date: 'YYYY-MM-DD',
      confidence: number,        // 0..1
      before: { mean, slope, daysCovered },
      after:  { mean, slope, daysCovered },
      magnitude: number,         // standardized effect size
      description: 'mean dropped from 198.4 to 195.1; slope flattened'
    },
    ...
  ]
}
```

Powers "when did things shift?" — the question the agent needs to ask before "why."

**`detect_anomalies({ userId, metric, period, baseline_period? })`**

Days that deviate from the rolling baseline (default: previous 30 days at each point) by more than a configurable z-score (default: 2σ).

```
{
  metric, period, baseline_period,
  anomalies: [
    {
      date: 'YYYY-MM-DD',
      value, baselineMean, baselineStdev,
      zScore: number,
      direction: 'high' | 'low'
    },
    ...
  ],
  count: number
}
```

Powers "what's unusual" — the agent uses this to find days worth narrating without paging through every entry.

**`detect_sustained({ userId, metric, period, condition, min_duration_days })`**

Find runs of consecutive days where a metric satisfies a condition, lasting at least `min_duration_days`. Returns date ranges:

```
{
  metric, period, condition, min_duration_days,
  runs: [
    { from, to, durationDays, summary: { mean, min, max } },
    ...
  ]
}
```

This is the simplest pattern-detection primitive — generalized "find sustained behaviors." Conditions reuse the `conditional_aggregate` vocabulary (`field_above`, `field_below`, `tracked`, etc.). Tier 3 patterns will be built on top of this.

### 6. Contextualize

**`metric_distribution({ userId, metric, period, bins? })`**

Quartiles + optional histogram for a metric over a period.

```
{
  metric, period,
  count, min, max, mean, median, stdev,
  quartiles: { p25, p50, p75 },
  histogram?: [{ binStart, binEnd, count }, ...]
}
```

**`metric_percentile({ userId, metric, period, value })`**

Where a specific value sits in the distribution.

```
{
  metric, period, value,
  percentile: number,            // 0..100
  rank: number,
  total: number,
  interpretation: 'below typical' | 'typical' | 'above typical' | 'extreme'
}
```

Together, these power "where does today's weight sit in your last 2 years' distribution" — call distribution once, then percentile per current value.

**`find_similar_period({ userId, signature, max_results? })` (existing, expand)**

Given a metric signature, surface the closest historical analog. Already exists for declared playbook periods; expand to also include deduced runs (from `detect_sustained` or `deduce_period`) so the candidate pool isn't limited to user-curated benchmarks.

### 7. Multi-metric snapshot

**`metric_snapshot({ userId, period, metrics? })`**

Compressed multi-metric view — the "vital signs" of a period. Returns one row per requested metric with summary stats.

```
{
  period,
  metrics: [
    { metric: 'weight_lbs',          mean, slope, daysCovered },
    { metric: 'calories',            mean, daysCovered, density },
    { metric: 'protein_g',           mean, daysCovered },
    { metric: 'workout_count',       sum,  daysCovered },
    { metric: 'tracking_density',    value, daysCovered },
    ...
  ]
}
```

Default `metrics` set: `weight_lbs`, `fat_percent`, `calories`, `protein_g`, `workout_count`, `workout_duration_min`, `tracking_density`. The caller can pass an explicit list to override. This is the "give me the picture" call — one tool for "how was Q1 overall."

### 8. Address by period (incl. memory)

The agent needs to be able to name and remember periods so it can compare against them later. Three small tools, all backed by the framework's existing `WorkingMemoryState` (no new persistence layer):

**`list_periods({ userId })`** — return all addressable periods (declared in playbook + deduced-cached + remembered) with `source: 'declared' | 'deduced' | 'remembered'`. Discoverability tool.

**`deduce_period({ userId, criteria, max_results? })`** — find date ranges in history matching a metric criterion. Returns ranked candidates with `{ from, to, label, stats, score }`. Initial criteria vocabulary: sustained band (`metric, value_range, min_duration_days`), sustained trend (`metric, trend, min_duration_days`), sustained tracking (`tracking_density.above, min_duration_days`).

**`remember_period({ userId, slug, from, to, label, description })`** — promote a deduced period (or any explicit window) into the agent's long-lived working memory. No TTL — survives across sessions.

**`forget_period({ userId, slug })`** — housekeeping.

Memory plugs into `WorkingMemoryState` under namespaced keys (`period.deduced.<slug>` with TTL, `period.remembered.<slug>` without). Declared periods stay in `playbook.named_periods`. `list_periods` unions all three sources transparently. Promotion does NOT write back to playbook — playbook is user-curated truth; the agent's promoted periods are agent-authored memory.

### 9. Reflect

**`analyze_history({ userId, focus? })`**

A higher-level convenience: scan the user's full history and surface candidate periods worth remembering, plus a multi-metric narrative. Returns:

```
{
  summary: {                           // same shape as metric_snapshot
    period: { rolling: 'all_time' },
    metrics: [...]
  },
  candidates: [
    { slug, label, from, to, stats, rationale },
    ...
  ],
  observations: [                      // optional human-readable findings
    'Tracking density dropped from ~0.8 to ~0.3 starting around 2025-03',
    'Weight has been within ±3 lbs of 195 for 18 months',
    ...
  ]
}
```

Internally composes `detect_regime_change`, `detect_sustained`, `metric_snapshot`, and `deduce_period` with a small curated criteria set. `focus` narrows to a metric (`weight`, `nutrition`, `training`).

This is the "agent reflects on the past" capability — invoked when the agent wants an initial pass over a user it doesn't have rich period memory for, or when the user asks "what have my major seasons been?"

---

## Period vocabulary — how primitives are parameterized

Every primitive that takes a period accepts a polymorphic input:

```
{ rolling: 'last_30d' }       // last_7d, last_30d, last_90d, last_180d, last_365d,
                               // last_2y, last_5y, last_10y, all_time,
                               // prev_7d, prev_30d, prev_90d, prev_180d, prev_365d
                               // (prev_* expresses the period adjacent to last_*; e.g.
                               //  prev_30d is days -60 to -30. NOT an arbitrary historical offset.)

{ calendar: '2024' }          // '2024', '2024-Q3', '2024-03', 'this_week', 'this_month',
                               // 'this_quarter', 'this_year', 'last_quarter', 'last_year' (calendar)

{ named: '2017 Cut' }         // resolved via list_periods (declared, deduced-cached,
                               // or remembered — caller doesn't need to know which)

{ deduced: { criteria } }     // detected from data on the fly via the same logic
                               // as deduce_period; returns the top candidate as the period

{ from: 'YYYY-MM-DD',         // explicit override
  to:   'YYYY-MM-DD' }
```

A small `resolvePeriod(input, userId, ctx)` helper in the domain layer turns any of these into a `{ from, to, label, source }` tuple. Every primitive calls it once.

For "compare current 30d to the same window six months ago," use a calendar form (`{ calendar: '2024-11' }`) or explicit `from / to`. The `prev_*` rolling forms only express adjacency.

---

## Tier 1 gap-fills (ship in the same pass)

Pure value-add over existing tools; no architectural change.

- Add `yearly_avg` to the `query_historical_*` aggregation enums.
- Add `query_historical_reconciliation({ userId, period })` mirroring the rolling-window tool.
- Add `query_historical_coaching({ userId, period })` mirroring the rolling-window tool.
- Extend `query_historical_workouts` with optional `aggregation: 'weekly_count' | 'monthly_count' | 'yearly_count'`.
- Add `query_nutrition_density({ userId, period, granularity })` returning per-bucket "% of days logged" series.

---

## CLI surface

Every Tier 2 primitive maps 1:1 to a `dscli health` subcommand. JSON in, JSON out. Read-only — no `--allow-write` needed except for `periods remember / forget`.

The CLI accepts a string shorthand for the polymorphic period input (the in-process tools take the JSON object form):

- bare token → rolling: `last_30d`, `last_year`, `prev_30d`, `all_time`
- `YYYY` / `YYYY-MM` / `YYYY-Qn` → calendar
- `'named:<slug>'` → named lookup
- `--from / --to` flags → explicit override (highest precedence)

Examples (one per capability):

```bash
# Read
dscli health aggregate weight_lbs --period last_30d
dscli health series calories --period last_year --granularity monthly

# Trend
dscli health trajectory weight_lbs --period last_90d

# Compare
dscli health compare weight_lbs --a last_30d --b 'named:2017 Cut'
dscli health summarize-change tracking_density --a last_90d --b prev_90d

# Correlate / condition
dscli health conditional weight_lbs --period last_180d --condition '{"tracked":true}'
dscli health correlate weight_lbs protein_g --period last_year --granularity weekly

# Detect
dscli health regime-change weight_lbs --period last_2y
dscli health anomalies workout_calories --period last_90d
dscli health sustained tracking_density --period last_year --condition '{"field_above":{"metric":"tracking_density","value":0.7}}' --min-duration-days 14

# Contextualize
dscli health distribution weight_lbs --period last_2y --bins 10
dscli health percentile weight_lbs --period last_2y --value 196.4

# Snapshot
dscli health snapshot --period 'named:2017 Cut'

# Periods
dscli health periods list
dscli health periods deduce --metric weight_lbs --range 193 197 --min-duration-days 30
dscli health periods remember --slug stable-195 --from 2024-08-01 --to 2024-11-15 --label "Stable 195 Fall 2024" --allow-write

# Reflect
dscli health analyze --focus weight
```

The CLI isn't a separate codebase — each subcommand is a thin adapter that calls the same domain service the in-process agent calls.

---

## Architecture

### Domain layer

A new `HealthAnalyticsService` in `backend/src/2_domains/health/services/` exposes every Tier 2 operation as a plain method. No agent-framework dependency, no HTTP, no CLI.

Internally factored into focused sub-services so the file doesn't become a kitchen sink:

- `MetricAggregator` — `aggregate_metric`, `aggregate_series`, `metric_distribution`, `metric_percentile`, `metric_snapshot`
- `MetricComparator` — `compare_metric`, `summarize_change`, `correlate_metrics`, `conditional_aggregate`
- `MetricTrendAnalyzer` — `metric_trajectory`, `detect_regime_change`, `detect_anomalies`, `detect_sustained`
- `PeriodResolver` — turns polymorphic period input into `{ from, to, label, source }`
- `PeriodMemory` — `list_periods`, `deduce_period`, `remember_period`, `forget_period`
- `HistoryReflector` — `analyze_history`, `find_similar_period`

Dependencies: `IHealthDatastore` (existing), `IPersonalContextLoader` (existing), `IWorkingMemory` (existing). Nothing new at the persistence layer.

### Application layer

A new `HealthAnalyticsToolFactory` in `backend/src/3_applications/agents/health-coach/tools/` wraps every domain service method as an agent tool (`createTool({ name, description, parameters, execute })`). Registered in `HealthCoachAgent.registerTools()` alongside the existing factories. Pure glue: parameter validation, JSON-schema parameters, calling the service, returning structured `{ ..., error? }` responses.

### Adapter layer

Two consumers of `HealthAnalyticsService`:

- The agent (in-process) via `HealthAnalyticsToolFactory`.
- The CLI (`cli/commands/health.mjs`) via direct import + `getHealthAnalytics()` factory in `cli/_bootstrap.mjs` (mirroring how `getContentQuery`, `getFinance`, etc. work).

### Working memory layout

```yaml
period.deduced.<slug>:
  from: '2024-08-01'
  to: '2024-11-15'
  label: 'Weight ~195 Aug-Nov 2024'
  criteria: { metric: 'weight_lbs', value_range: [193, 197], min_duration_days: 30 }
  expiresAt: <30 days out>

period.remembered.<slug>:
  from: '2024-08-01'
  to: '2024-11-15'
  label: 'Stable 195 Fall 2024'
  description: 'Maintenance window after the 2024 cut'
  promotedAt: '2026-05-05'
  # no expiresAt — persistent
```

---

## What this design does NOT include

- **Patterns as callable tools (Tier 3).** Deferred; one short successor spec once the primitives are stable. `detect_sustained` covers the simplest pattern-detection case in the meantime.
- **Cross-user analysis.** Every primitive is per-user.
- **Streaming.** All primitives return one response.
- **Goal-tracking semantics.** "Are you on track for your cut?" combines goals from `get_user_goals` with these primitives. The combination is the agent's job; we're not adding a `goal_progress` tool.
- **Underlying data correction or imputation.** Quality issues in `weight_data` / `nutrition_data` are upstream concerns.
- **Promote-to-playbook.** `remember_period` writes to working memory only. Playbook YAML stays user-curated.

---

## Open questions for the implementation plan

These are deliberately not pre-decided — the implementation plan will land them.

1. **`reliability` thresholds on `compare_metric`.** What `daysCovered / daysInPeriod` ratios map to `high / medium / low`? Initial proposal: `>= 0.7` → high, `>= 0.4` → medium, else low.
2. **Anomaly default z-score and baseline window.** Initial proposal: 2.0σ over a 30-day rolling baseline. Worth a sanity pass against real data.
3. **Regime-change algorithm.** Simple options: changepoint detection via cumulative sum (CUSUM), or PELT. CUSUM is simpler and adequate for "find inflection points in noisy daily data." PELT is more robust but heavier. Pick during implementation; the contract is the same.
4. **`analyze_history` default criteria.** Initial proposal: sustained weight bands (5-lb buckets, 30+ days), sustained tracking (≥70% density, 60+ days), sustained cuts (avg calories below playbook target, 21+ days), regime changes with magnitude ≥ 1σ. Adjust against real data.
5. **`deduce_period` performance.** Sliding-window scan over 10 years of daily weight is ~3650 iterations per criterion. Probably fine. The implementation should benchmark before optimizing.
6. **`'deduced:...'` CLI inline shorthand.** The shorthand for rolling, calendar, named, and explicit `--from / --to` is settled. Inline deduction shorthand is open — simplest path is to NOT support it at first and require callers to run `dscli health periods deduce` separately.

---

## Why this is the right shape

**The agent's analytical ceiling rises with the primitive set.** Today the agent reads arrays and reasons in context. With these primitives, the same coaching question becomes one or two tool calls returning compressed answers — the model spends its tokens on coaching reasoning, not on doing arithmetic over data it had to fetch.

**Capabilities, not periods, drive the structure.** Periods are a parameterization mechanism for the operations that matter — comparison, correlation, trend analysis, regime detection, distribution, anomaly detection. The primitive set covers the full read-analyze-detect-contextualize loop a coach actually runs.

**The CLI falls out of the design for free.** Building Tier 2 as application services with thin adapters from day one means external access — Claude Code, mastracode, shell scripts, debugging — comes for the same effort. The CLI isn't a port; it IS the surface, with a different transport.
