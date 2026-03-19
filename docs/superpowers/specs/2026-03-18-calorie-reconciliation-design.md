# Calorie Reconciliation — Design Spec

## Problem

Nutrition tracking via NutriBot systematically undercounts actual calorie intake. Users forget meals, underestimate portions, or skip logging entirely. Weight data from Withings provides ground truth — if the scale doesn't move but the log says 1200 calories, the log is wrong.

## Goal

Build a reconciliation data layer that:

1. Computes **implied actual intake** from weight changes, exercise, and daily activity
2. Produces a daily **calorie adjustment** (the gap between tracked and implied)
3. Derives a **personalized BMR** and **maintenance calories** empirically
4. Treats missing nutrition data as an undercount signal, not a skip

No frontend or API endpoints — data layer only.

## Energy Balance Model

### Core Equation

```
implied_intake = (weight_delta_lbs × 3500) + derived_bmr + exercise_calories + neat_calories
calorie_adjustment = implied_intake - tracked_calories
tracking_accuracy = tracked_calories / implied_intake  (clamped 0–1; null if implied_intake ≤ 0)
```

Where:

- **weight_delta_lbs** — daily change in `lbs_adjusted_average` from WeightProcessor (already two-stage smoothed)
- **derived_bmr** — personalized basal metabolic rate, derived from high-confidence days (see below)
- **exercise_calories** — from Strava + FitnessSyncer workout data (deduplicated by HealthAggregationService logic)
- **neat_calories** — non-exercise activity thermogenesis from Garmin step data (`steps.calories`). Verified: this field is incremental step-burn only, NOT inclusive of BMR. No double-counting risk.
- **tracked_calories** — from `nutriday.yml` (0 if no nutrition logged)

### BMR Derivation

BMR is bootstrapped from a formula-based estimate and refined empirically.

**Seed BMR (Katch-McArdle formula):**

```
seed_bmr = 370 + (21.6 × lean_mass_kg)
```

Where `lean_mass_kg` is derived from weight.yml: `lbs_adjusted_average × (1 - fat_percent/100) / 2.205`. This is preferred over Garmin's `steps.bmr` field, which is unreliable — it gets summed across multiple step records per day in the harvester and produces nonsensical values (5k–22k).

**Empirical refinement on high-confidence days** (tracking_confidence ≥ 0.7 — see confidence scoring):

```
solved_bmr = tracked_calories - (weight_delta × 3500) - exercise_calories - neat_calories
```

**Known bias:** Even well-tracked days likely undercount by 10–15%, so `solved_bmr` will be biased low by that amount. This is an accepted limitation — the derived BMR represents a *lower bound*. Over time, as the system accumulates `tracking_accuracy` data, a correction factor can be applied:

```
corrected_bmr = solved_bmr / avg_tracking_accuracy
```

This correction is deferred to a future iteration once enough data exists to validate it.

**Rolling BMR:**

- Seed with Katch-McArdle estimate from weight.yml (lean mass)
- Collect `solved_bmr` values from high-confidence days within the window
- Rolling average of solved values becomes `derived_bmr`
- If insufficient high-confidence days (< 3 in window), fall back to seed BMR
- Clamp `derived_bmr` to ±30% of seed to prevent runaway values from bad data

### Maintenance Calories

```
maintenance_calories = derived_bmr + avg_neat_calories + avg_exercise_calories
```

Averaged over the rolling window. Represents the daily calorie intake needed for zero weight change.

## Rolling Window

- **Window size:** 14 days
- Recomputed fully each run (not incremental) — arithmetic on ~14 rows is cheap
- Uses `lbs_adjusted_average` diffs for weight delta (already smoothed, eliminates day-to-day water weight noise)

## Tracking Confidence Score

Per-day score (0–1) indicating how much input data was present:

| Signal | Weight |
|--------|--------|
| Weight data exists | +0.35 |
| Nutrition logged (>0 items) | +0.45 |
| Step/activity data exists | +0.2 |

Exercise data is **not** a confidence factor — `exercise_calories = 0` on rest days is a valid data point, not missing data. This ensures rest days can reach full confidence (1.0) when weight, nutrition, and steps are all present.

**High-confidence threshold:** ≥ 0.7 (requires at minimum weight + nutrition data).

Used to:
- Gate BMR derivation (only high-confidence days contribute)
- Inform future UI about data reliability

## Missing Data Handling

Missing data is treated as an undercount signal, not absence:

- **No nutrition logged + stable weight** → implied intake = maintenance calories (full imputation)
- **No nutrition logged + weight drop** → implied intake = maintenance - deficit (still substantial)
- **No step data** → NEAT interpolated from adjacent days
- **No weight data** → interpolated by WeightProcessor (already handled upstream)
- **No exercise data** → exercise_calories = 0 for that day (conservative)

## Data Model

### Output: `reconciliation.yml`

Stored at `users/{username}/lifelog/reconciliation.yml`, date-keyed (top-level under lifelog, since this is a cross-domain health artifact, not nutrition-specific):

```yaml
2026-03-18:
  # Inputs (snapshotted from source data)
  weight_delta_lbs: -0.15
  tracked_calories: 1850
  exercise_calories: 320
  neat_calories: 280
  seed_bmr: 1750

  # Derived (computed by solver)
  implied_intake: 2875
  calorie_adjustment: 1025
  tracking_accuracy: 0.64
  tracking_confidence: 0.85

  # Rolling window outputs (14-day)
  derived_bmr: 1680
  maintenance_calories: 2450
  avg_tracking_accuracy: 0.71
```

### Input Sources

| Data | Source File | Key Fields Used |
|------|-----------|----------------|
| Weight delta | `weight.yml` | `lbs_adjusted_average` (diff consecutive days) |
| Tracked calories | `nutriday.yml` | `calories` |
| Exercise calories | `strava.yml` + `fitness.yml` | workout calorie totals (deduplicated) |
| NEAT / steps | `fitness.yml` | `steps.calories` (incremental, excludes BMR) |
| Seed BMR | `weight.yml` | `lbs_adjusted_average`, `fat_percent_adjusted_average` (for Katch-McArdle) |

## Architecture

### New Files

| File | Layer | Purpose |
|------|-------|---------|
| `backend/src/2_domains/health/services/CalorieReconciliationService.mjs` | Domain | Pure logic — energy balance solver, BMR derivation, confidence scoring |
| `backend/src/3_applications/health/ReconciliationProcessor.mjs` | Application | Orchestrates I/O — loads inputs from datastores, calls domain service, persists output |
| `backend/src/1_adapters/persistence/yaml/YamlReconciliationDatastore.mjs` | Adapter | Reads/writes `reconciliation.yml` |

### Integration

ReconciliationProcessor runs at the tail end of the harvest cycle:

```
Harvest cycle (however triggered)
  → WithingsHarvester → WeightProcessor
  → FitnessSyncerHarvester / StravaHarvester
  → ReconciliationProcessor (runs last, reads all fresh outputs)
```

The processor does not trigger harvests — it consumes whatever data is current. Between harvests, the persisted `reconciliation.yml` remains valid but won't reflect new data until the next cycle.

### Domain Service API

```javascript
// CalorieReconciliationService.mjs

reconcile(windowData, seedBmr)
// Input: array of daily records { date, weightDelta, trackedCalories,
//        exerciseCalories, neatCalories, hasNutrition,
//        hasWeight, hasSteps }
//        seedBmr: Katch-McArdle estimate from weight data
// Output: array of reconciliation records (see data model above)

deriveRollingBmr(dailyRecords, seedBmr)
// Input: daily records with solved BMR values + formula-based seed
// Output: { derivedBmr, highConfidenceDayCount }

computeConfidence({ hasWeight, hasNutrition, hasSteps })
// Output: number 0–1

computeSeedBmr(weightLbs, fatPercent)
// Input: current weight and body fat from weight.yml
// Output: Katch-McArdle BMR estimate (calories/day)
```

### Application Service API

```javascript
// ReconciliationProcessor.mjs

async process(userId, options = {})
// Loads 14 days of input data, runs reconciliation, persists output
// options.windowDays — override window size (default 14)
// Returns: reconciliation records written

async processAllUsers()
// Runs process() for each user in the household
```

## Exercise Calorie Deduplication

Strava and FitnessSyncer may report the same workout. The existing HealthAggregationService already deduplicates by matching activities within a ±5 minute duration tolerance. ReconciliationProcessor reuses this logic rather than reimplementing it.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| First run (no history) | Seed BMR from Katch-McArdle, confidence will be low until window fills |
| Extended no-logging period | All days get full imputation from weight changes, tracking_accuracy → 0 |
| Rapid weight swing (water/salt) | Smoothed by two-stage rolling average in weight.yml |
| No Garmin data at all | NEAT defaults to 0, seed BMR from Katch-McArdle (only needs weight data). If no weight data either, reconciliation skipped with warning |
| implied_intake ≤ 0 | Likely bad data — tracking_accuracy set to null, day marked unreliable |
| Window includes today | Window covers the 14 most recent days with weight data, excluding today (avoids zero-delta from missing morning weigh-in) |
| Single day spike (e.g., holiday) | Shows up as high implied_intake; rolling BMR unaffected if it's a one-off |

## Future Considerations (Not In Scope)

- API endpoint (`GET /api/v1/health/reconciliation`) — add when frontend is ready
- Frontend visualization of tracked vs implied intake
- Macro-level reconciliation (protein/fat/carb split)
- Meal-level attribution (which meals are most underestimated)
- Adaptive window size based on data density
