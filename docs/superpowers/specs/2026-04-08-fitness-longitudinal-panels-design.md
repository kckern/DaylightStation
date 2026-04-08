# Fitness Longitudinal Panels — Design Spec

## Overview

Add a bottom section to the fitness home screen below the suggestions grid. Two sparkline grid panels show longitudinal health data (30-day daily + 6-month weekly), with a coaching placeholder panel on the right. Clicking a column in either grid loads a day/week summary into the coaching panel.

## Layout

The bottom section sits directly below the existing 4x2 suggestions grid and fills the remaining height of the right area.

```
┌─────────────────────────────────────────────────────┐
│  [existing 4x2 suggestions grid]                    │
├───────────────────────────────────┬─────────────────┤
│  30-Day Daily Sparklines          │                 │
│  (5 rows × 30 columns)           │   Coaching      │
├───────────────────────────────────┤   Panel         │
│  6-Month Weekly Sparklines        │   (placeholder) │
│  (4 rows × ~26 columns)          │                 │
└───────────────────────────────────┴─────────────────┘
         75% width                     25% width
```

## 30-Day Daily Grid

**Data source:** `/api/v1/health/longitudinal` → `daily[]` array (30 entries, newest last)

**Column labels:** Day-of-week letters (M, T, W, T, F, S, S) repeating across 30 columns.

**Rows (sparkline bars, grow upward from baseline):**

| Row | Label | Source | Color | Highlight |
|-----|-------|--------|-------|-----------|
| Exercise Min | `sessions` aggregate `durationMs` per day | Blue | — |
| Cals Burned | `sessions` aggregate strava calories per day | Red/orange | — |
| Steps | `fitness.yml` steps data per day | Green | Brighter when >10k |
| Protein (g) | `nutriday.yml` protein per day | Purple | Brighter when ≥130g |
| Cal +/− | Nutrition-based: `trackedCalories - maintenanceCalories` | Center-zero axis | Green below (deficit), red above (surplus) |

## 6-Month Weekly Grid

**Data source:** `/api/v1/health/longitudinal` → `weekly[]` array (~26 entries, newest last)

**Column labels:** Date of week start (e.g., "Jan 8", "Jan 15", "Feb 5").

**Rows:**

| Row | Label | Source | Color | Notes |
|-----|-------|--------|-------|-------|
| Weight | Average weekly weight (lbs) | Weight processor `lbs_adjusted_average` | Line/area chart | Shows trend direction |
| Wt Cal +/− | Weight-based: `calorie_balance` averaged per week | Center-zero axis | Green below (deficit), red above (surplus) |
| Exer Cal/wk | Sum of all exercise calories that week | Red/orange | — |
| Avg HR | Average exercise heart rate across sessions that week | Red | Brighter when ≥140 bpm |

## Click Interaction

- **Click a column in the 30-day grid** → sets `selectedDay` in `FitnessScreenProvider` context → coaching panel shows a day summary placeholder card with date and raw stat values
- **Click a column in the 6-month grid** → sets `selectedWeek` in `FitnessScreenProvider` context → coaching panel shows a week summary placeholder card with week range and aggregated values
- Clicking a different column replaces the current selection
- The coaching panel shows "FITNESS COACHING — Coming soon" when nothing is selected

## API Contract

### `GET /api/v1/health/longitudinal?userId={userId}`

Returns pre-aggregated daily and weekly data for the sparkline grids.

```json
{
  "daily": [
    {
      "date": "2026-03-09",
      "dayOfWeek": "M",
      "exerciseMinutes": 45,
      "caloriesBurned": 380,
      "steps": 8950,
      "protein": 145,
      "calorieBalance": -410
    }
  ],
  "weekly": [
    {
      "weekStart": "2025-10-06",
      "weekEnd": "2025-10-12",
      "label": "Oct 6",
      "avgWeight": 185.4,
      "weightCalorieBalance": -350,
      "exerciseCalories": 2200,
      "avgExerciseHr": 138
    }
  ]
}
```

- `daily` has 30 entries (most recent 30 days), sorted oldest → newest
- `weekly` has ~26 entries (most recent 26 weeks), sorted oldest → newest
- Missing data for a day/week returns `null` for that field (not omitted)

## Backend Architecture

### Layer Placement

- **Application layer** (`backend/src/3_applications/health/`): `LongitudinalAggregationService` — orchestrates data collection and aggregation
- **API layer** (`backend/src/4_api/v1/routers/health.mjs`): New route handler for `GET /longitudinal`

### LongitudinalAggregationService

Responsibilities:
1. Accept `userId` (for lifelog data paths)
2. Load daily health data via existing `HealthAggregationService` or directly from YAML datastores
3. Aggregate session data by date for exercise minutes, calories, avg HR
4. Load nutrition summaries from `YamlHealthDatastore`
5. Load weight data from `YamlHealthDatastore`
6. Load steps data from fitness syncer YAML
7. Load reconciliation data for calorie balance
8. Build the `daily[]` array (30 days)
9. Build the `weekly[]` array (26 weeks) by rolling up daily data

### Dependencies (existing, no new adapters)

- `YamlHealthDatastore` — weight data, nutrition data
- `YamlSessionDatastore` — session history for exercise aggregation
- `ReconciliationProcessor` or its output data — calorie balance
- `HealthAggregationService` — if it already provides unified daily data, use it directly

### Data Assembly

**Daily (30 days):**
```
For each of the last 30 days:
  exerciseMinutes = sum(sessions[date].durationMs) / 60000
  caloriesBurned = sum(sessions[date].strava.calories || 0)
  steps = fitnessData[date]?.steps?.steps_count || null
  protein = nutrition[date]?.protein || null
  calorieBalance = reconciliation[date]?.surplusDeficit || null
```

**Weekly (26 weeks):**
```
For each of the last 26 ISO weeks:
  avgWeight = mean(weight[days_in_week].lbs_adjusted_average)
  weightCalorieBalance = mean(weight[days_in_week].calorie_balance)
  exerciseCalories = sum(daily[days_in_week].caloriesBurned)
  avgExerciseHr = mean(sessions[days_in_week].strava.avgHeartrate) where HR > 0
```

## Frontend Architecture

### New Widget: `fitness:longitudinal`

**File:** `frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/`

- Consumes `useScreenData('longitudinal')`
- Renders two panels: `DailyGrid` and `WeeklyGrid`
- Each grid is a set of `SparklineRow` components
- Column click handler sets `selectedDay` or `selectedWeek` via `useFitnessScreen()`
- Skeleton loader while data is null

### SparklineRow Component

Shared component for all sparkline rows. Props:
- `data[]` — array of numeric values (null = no data)
- `color` — bar color
- `highlightFn` — optional function `(value) → boolean` for brighter bars
- `centerZero` — boolean, if true renders bars above/below a center axis
- `positiveColor` / `negativeColor` — for center-zero rows
- `onColumnClick(index)` — click handler

### SparklineGrid Component

Container for multiple SparklineRows with shared column labels and click highlighting.
- `labels[]` — column header labels
- `selectedIndex` — currently selected column (highlighted)
- `onSelect(index)` — selection handler

### Coaching Panel Update

The existing coaching panel placeholder widget (`fitness:coach`) needs to accept drill-down data from the longitudinal widget.

**Approach:** Use `FitnessScreenProvider` context to share selection state:
- Add `longitudinalSelection` to context: `{ type: 'day' | 'week', index: number, data: object } | null`
- Coaching panel reads this and renders a placeholder summary card when set
- When nothing selected, shows default "FITNESS COACHING — Coming soon"

### Day Summary Card (placeholder)

```
┌────────────────────┐
│ Tuesday, Apr 6     │
│                    │
│ Exercise: 45 min   │
│ Burned: 380 cal    │
│ Steps: 8,950       │
│ Protein: 145g      │
│ Balance: -410 cal  │
└────────────────────┘
```

### Week Summary Card (placeholder)

```
┌──────────────────────┐
│ Mar 31 — Apr 6       │
│                      │
│ Avg Weight: 185.4 lb │
│ Wt Balance: -350/day │
│ Exercise: 2,200 cal  │
│ Avg HR: 138 bpm      │
└──────────────────────┘
```

## Screen Config Changes

Update `data/household/config/fitness.yml` screen layout:

**Add data source:**
```yaml
data:
  longitudinal:
    source: /api/v1/health/longitudinal
    refresh: 600
```

**Update right-area layout** to stack suggestions + bottom panels:
```yaml
- id: right-area
  basis: "66%"
  direction: column
  gap: 0.5rem
  children:
    - widget: "fitness:suggestions"
    - id: bottom-panels
      direction: row
      gap: 0.5rem
      basis: "45%"
      children:
        - widget: "fitness:longitudinal"
          basis: "75%"
        - widget: "fitness:coach"
          basis: "25%"
```

## Edge Cases

- **Missing data days:** Bars render as empty/minimal height. Null values show as gaps.
- **No weight data for a week:** `avgWeight` is null, weight row shows gap.
- **No sessions for a day:** Exercise minutes and calories are 0, bars are flat.
- **No nutrition logged:** Protein and calorie balance are null for that day.
- **Steps data unavailable:** Steps row shows null gaps (FitnessSyncer may not be synced).
- **Coaching panel with no selection:** Shows default placeholder state.
