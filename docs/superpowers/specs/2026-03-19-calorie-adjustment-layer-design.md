# Calorie Adjustment Layer — Design Spec

## Problem

The reconciliation system (see `2026-03-18-calorie-reconciliation-design.md`) reveals that nutrition tracking consistently undercounts by 15–40%. This data exists but isn't acted upon — the user sees raw tracked calories with no correction, the AI keeps estimating the same undersized portions, and historical records remain inaccurate.

## Goal

Build an adjustment layer that uses reconciliation data to:

1. **Backfill** historical nutriday records with corrected portion sizes and phantom entries for missed meals
2. **Boost** real-time AI portion estimates based on the user's known undercount pattern
3. **Expose** both raw and adjusted calorie totals through the health API

All adjustments are overlays — original nutrilog, nutrilist, and nutriday data is never mutated.

## Principles

- **Never burn in adjustments** — source data stays clean, adjustments are a separate layer
- **Adaptive** — as tracking accuracy improves, adjustments shrink automatically toward zero
- **Portion-based** — the undercount is portion estimation error, not calorie-per-gram error. Scale grams, not nutrition density.
- **DDD-compliant** — domain service does pure math, application layer orchestrates I/O, presentation stays in the rendering layer

## Architecture Overview

```
Harvest-time (batch):
  ReconciliationProcessor → CalorieAdjustmentService → nutriday_adjusted.yml

Logging-time (real-time):
  LogFoodFromText/Image → reads avg_tracking_accuracy → injects multiplier into AI prompt

Read-time (API):
  GET /health/daily → returns raw nutrition + adjusted nutrition
```

## Component 1: CalorieAdjustmentService (Domain)

Pure domain service at `backend/src/2_domains/health/services/CalorieAdjustmentService.mjs`. All static methods, no I/O.

### Portion Multiplier

```
portion_multiplier = 1 / tracking_accuracy
```

At 75% accuracy → 1.33x. At 95% → 1.05x. At 100% → 1.0x (no-op).

### Max Multiplier Threshold

The portion multiplier is capped using the rolling accuracy stats. Beyond this cap, the gap is attributed to missed meals (phantom entry) rather than portion underestimation.

```
denominator = max(0.1, avg_tracking_accuracy - 1_std_deviation)
max_multiplier = 1 / denominator
```

The denominator is floored at 0.1 to prevent division by zero or negative values when accuracy is very low with high variance.

Example: avg accuracy 0.75, std dev 0.10 → max multiplier = `1 / 0.65 = 1.54x`. A day at 0.50 accuracy gets 1.54x portion scaling + phantom entry for the remaining gap.

This adapts naturally — as tracking improves and tightens, the tolerance band narrows.

### Phantom Entry Gap Calculation

When `phantomNeeded` is true (the raw multiplier exceeds max_multiplier):

```
scaled_calories = raw_tracked_calories * capped_multiplier
phantom_calories = implied_intake - scaled_calories
```

The phantom entry's macro split uses the day's average macro ratios from the logged items. If no items were logged, fallback to a default 30/40/30 protein/carbs/fat split by calories.

### Methods

```javascript
computePortionMultiplier(trackingAccuracy, avgAccuracy, stdDevAccuracy)
// Returns { multiplier, maxMultiplier, phantomNeeded: boolean }
// multiplier = min(1/trackingAccuracy, maxMultiplier)
// phantomNeeded = true if 1/trackingAccuracy > maxMultiplier

adjustDayItems(nutrilistItems, multiplier)
// Scales grams and all macro fields proportionally for each item
// Returns structured items with { adjusted: true, original_grams } metadata

computePhantomEntry(gapCalories, avgMacroRatios)
// Creates a synthetic "Estimated Untracked Intake" entry
// Macro split based on the day's average protein/carb/fat ratios
// Returns { label, calories, protein, carbs, fat, phantom: true }

computeWindowStats(reconciliationRecords)
// Derives { avgAccuracy, stdDevAccuracy } from the per-day tracking_accuracy values
// in the reconciliation records (which are already persisted in reconciliation.yml).
// Uses the pre-computed avg_tracking_accuracy from reconciliation for avgAccuracy,
// and computes stdDevAccuracy as new work from the per-day tracking_accuracy values.
// Returns { avgAccuracy, stdDevAccuracy }

adjustDay(nutrilistItems, reconciliation, windowStats)
// Top-level method called per-day with PRE-COMPUTED windowStats (caller computes
// windowStats once from the full window, then passes it to each day's adjustDay call).
// Computes multiplier, scales items, adds phantom if needed.
// Returns { adjustedItems, phantomEntry, metadata }
```

### Input: Nutrilist Items (Not Nutriday)

The adjustment service operates on **nutrilist items** (structured: `{ label, grams, calories, protein, ... }`) — not nutriday's pre-formatted summary strings. Nutrilist is the source of truth for item-level data. The formatted `food_items` strings in nutriday are a presentation concern.

## Component 2: Adjusted Nutriday Persistence

### Output File: `nutriday_adjusted.yml`

Stored at `users/{username}/lifelog/nutrition/nutriday_adjusted.yml`, same date-keyed format as `nutriday.yml`:

```yaml
# Example: raw tracked = 800 cal, implied = 1200, accuracy = 0.67, multiplier capped at 1.33
2026-03-17:
  calories: 1194
  protein: 77
  carbs: 107
  fat: 37
  fiber: 8
  sodium: 1200
  sugar: 18
  cholesterol: 80
  items:
    - label: "Grilled Chicken"
      grams: 266           # was 200g, scaled 1.33x
      calories: 333         # was 250, scaled 1.33x
      protein: 53
      carbs: 0
      fat: 11
      color: "yellow"
      adjusted: true
      original_grams: 200
    - label: "Brown Rice"
      grams: 333           # was 250g, scaled 1.33x
      calories: 290         # was 218, scaled 1.33x
      protein: 9
      carbs: 87
      fat: 3
      color: "yellow"
      adjusted: true
      original_grams: 250
    - label: "Estimated Untracked Intake"
      calories: 571         # 1200 implied - (800 * 1.33 = 1064) ≈ 136...
      # Note: numbers are illustrative — actual computation uses
      # implied_intake from reconciliation.yml for the gap
      protein: 15
      carbs: 20
      fat: 23
      phantom: true
  adjustment_metadata:
    portion_multiplier: 1.33
    max_multiplier: 1.54
    phantom_calories: 136
    raw_calories: 800
    tracking_accuracy: 0.67
```

Each adjusted item carries `adjusted: true` and `original_grams`. Phantom entries carry `phantom: true`.

### Persistence Methods

Added to `YamlHealthDatastore` (extending `IHealthDataDatastore` port):

```javascript
loadAdjustedNutritionData(userId)   // → nutriday_adjusted.yml
saveAdjustedNutritionData(userId, data)
```

## Component 3: Real-Time Estimation Boost

### Prompt Injection

`LogFoodFromText` and `LogFoodFromImage` read the latest `avg_tracking_accuracy` from reconciliation data and inject a portion multiplier into the AI system prompt:

```
Current portion accuracy data shows you typically estimate portions
at {accuracy}% of actual weight. Adjust all gram estimates upward
by a factor of {portion_multiplier}x to compensate. For example,
if you would estimate 150g, report {adjusted_grams}g instead.
```

Where `portion_multiplier = 1 / avg_tracking_accuracy`.

**Design note — batch vs real-time multiplier:** The batch (harvest-time) adjustment uses per-day `tracking_accuracy` capped by the max_multiplier from std dev. The real-time boost uses `avg_tracking_accuracy` (window average) with no cap. This is intentional — the real-time boost should be conservative since it affects future logging, while the batch adjustment can be more precise per-day because it has weight data to validate against.

**Prompt compatibility:** The existing image detection prompt says "Be conservative with estimates." The text prompt does not have this language. When injecting the portion boost, the "conservative" instruction in the image prompt should be replaced with language that accommodates the boost, e.g., "Use the portion adjustment factor below to calibrate your gram estimates."

### Data Access

The nutribot use cases already receive a `config` dependency. A method is added to the container/config that reads the latest reconciliation record and returns the current multiplier. This is a simple YAML read — no computation at request time.

### Adaptation

As `avg_tracking_accuracy` changes with each reconciliation run, the prompt multiplier updates automatically. At 1.0 accuracy, the prompt addition is omitted entirely.

### No Downstream Changes

The AI returns larger gram values; existing response parsers handle them normally. The adjustment is invisible to all code after the AI call.

## Component 4: Health API Response

The health daily response gains an `adjusted` sub-object within the nutrition block:

```javascript
nutrition: {
  calories: 1110,           // raw tracked (from nutriday.yml)
  protein: 120,
  carbs: 101,
  fat: 25,
  foodCount: 8,
  adjusted: {               // from nutriday_adjusted.yml
    calories: 1564,
    protein: 169,
    carbs: 142,
    fat: 35,
    fiber: 12,
    sodium: 1800,
    sugar: 28,
    cholesterol: 120,
    portion_multiplier: 1.33,
    phantom_calories: 230,
    tracking_accuracy: 0.71,
  }
}
```

Raw values stay in their current location — no breaking change for existing consumers. The `adjusted` sub-object is `null` if no reconciliation data exists for that day.

## Integration Flow

### Harvest-Time (Batch, Retroactive)

```
ReconciliationProcessor runs (already exists)
  → produces reconciliation.yml
  → loads nutrilist items for each day in the window
  → calls CalorieAdjustmentService.adjustDay() for each day
  → computes window stats for max multiplier threshold
  → writes nutriday_adjusted.yml via YamlHealthDatastore
```

### Logging-Time (Real-Time, Prospective)

```
User sends food description/image to NutriBot
  → LogFoodFromText/Image reads latest avg_tracking_accuracy
  → Injects portion multiplier into AI prompt
  → AI returns inflated portions
  → Normal flow continues (nutrilog → nutrilist → nutriday)
  → Next reconciliation run will produce adjusted nutriday
```

### Read-Time (API, On Demand)

```
GET /health/daily
  → Loads nutriday.yml (raw) + nutriday_adjusted.yml (adjusted)
  → Returns both in nested structure
  → No computation at read time
```

### Adaptation Loop

```
User logs more accurately over time
  → tracking_accuracy trends toward 1.0
  → portion_multiplier shrinks toward 1.0x
  → max_multiplier threshold tightens (std dev decreases)
  → phantom entries become rarer
  → AI prompt boost decreases
  → Eventually: no adjustments applied
```

## New/Modified Files

| Action | File | Layer | Purpose |
|--------|------|-------|---------|
| Create | `backend/src/2_domains/health/services/CalorieAdjustmentService.mjs` | Domain | Pure math: portion scaling, phantom entries, window stats |
| Create | `backend/src/3_applications/health/ports/INutritionItemsReader.mjs` | Port | Read-only interface for structured nutrition items by date |
| Modify | `backend/src/3_applications/health/ReconciliationProcessor.mjs` | Application | Add nutritionItemsReader dep, call adjustment service, write adjusted nutriday |
| Modify | `backend/src/1_adapters/persistence/yaml/YamlHealthDatastore.mjs` | Adapter | Add load/save for `nutriday_adjusted.yml` + implement INutritionItemsReader |
| Modify | `backend/src/3_applications/health/ports/IHealthDataDatastore.mjs` | Port | Add adjusted nutrition port methods |
| Modify | `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs` | Application | Inject portion multiplier into AI prompt |
| Modify | `backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs` | Application | Same prompt injection |
| Modify | `backend/src/4_api/v1/routers/health.mjs` | API | Return adjusted data alongside raw |

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No reconciliation data yet | No adjustments applied — adjusted nutriday not written, API returns `adjusted: null` |
| tracking_accuracy is 1.0 | multiplier = 1.0x, no scaling, no phantom, adjusted = raw |
| tracking_accuracy is null (implied_intake <= 0) | Skip that day — no adjustment possible |
| No nutrilist items for a day | Cannot scale items — entire gap becomes phantom entry |
| First few days (insufficient window for std dev) | Use avg only (no std dev), max_multiplier = 1/avg_accuracy |
| All days untracked (accuracy = 0) | Phantom entry equals full implied_intake, no portion scaling |

## Dependencies

- Reconciliation system (`2026-03-18-calorie-reconciliation-design.md`) must be implemented and producing data
- NutriList data must be accessible for item-level adjustment

### NutriList Access — Bounded Context Boundary

The `INutriListDatastore` port lives under `nutribot/ports/`, which is a different bounded context from `health/`. To avoid cross-context coupling, the `ReconciliationProcessor` does NOT depend on `INutriListDatastore` directly. Instead:

- A new read-only port `INutritionItemsReader` is added to `health/ports/` with a single method: `findItemsByDateRange(userId, startDate, endDate)`.
- `YamlHealthDatastore` implements this port by reading from the same nutrilist YAML files that `YamlNutriListDatastore` writes to. This is a read-only dependency on a shared data file, not a code dependency on the nutribot bounded context.
- `ReconciliationProcessor` receives `nutritionItemsReader` as a constructor dependency alongside `healthStore`.

## Future Considerations (Not In Scope)

- Frontend UI for showing tracked vs adjusted calories
- Per-meal-type accuracy (breakfast vs dinner undercount patterns)
- User-facing explanation of why portions were adjusted
- Manual override to accept/reject adjustments
