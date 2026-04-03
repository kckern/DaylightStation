# Health Dashboard Frontend

## Problem

The health frontend is a 56-line stub that shows a status alert and the Nutrition component. The backend now has a unified dashboard API (`GET /health/dashboard`) returning today's snapshot, recency tracker, fitness goals, and tiered history — but no frontend to display it.

## Requirements

1. **Hub + drill-down layout** — compact summary cards on the main page. Click a card to expand into full detail view.
2. **Desktop-first, mobile-compatible** — responsive grid that stacks on small screens.
3. **Mantine 7.11** — follow existing DashboardCard pattern from fitness widgets.
4. **Highcharts multi-y-axis** — single chart with shared time x-axis, weight (lbs) left axis, calories right axis, workout minutes as bars on far-right axis.
5. **Inline nutrition input** — persistent text field on NutritionCard. Progressive in-place state transitions (idle → parsing → review → idle). No chat window.
6. **Quick-add from catalog** — recent food chips below the input field. Tap to log instantly.

## Design

### Page Structure

`HealthApp.jsx` makes one API call to `GET /health/dashboard` on mount. Passes sections to child components via props.

```
HealthApp
  ├── HealthHub (default view — summary cards grid)
  │   ├── WeightCard        (today's weight + trend arrow)
  │   ├── NutritionCard     (calories + macros + inline input)
  │   ├── SessionsCard      (today's sessions count + coins)
  │   ├── RecencyCard       (traffic-light indicators)
  │   └── GoalsCard         (active goals + progress bars)
  │
  └── HealthDetail (drill-down view — replaces hub when card clicked)
      ├── back button → returns to hub
      ├── HistoryChart      (Highcharts multi-y-axis)
      └── detail content varies by card type
```

**State:** `{ view: 'hub' | 'detail', detailType: 'weight' | 'nutrition' | 'sessions' | 'goals' | null, dashboard: <API response> }`

### Hub Cards

Each card uses the existing `DashboardCard` wrapper from fitness widgets.

**WeightCard** — Large number (e.g., 171.1 lbs), trend arrow (green down, red up, gray flat), subtitle "2 days ago" from recency. Click → weight detail.

**NutritionCard** — Today's calories with protein/carbs/fat Mantine badges. Persistent text input with placeholder "Log food...". Quick-add chips from `GET /nutrition/catalog/recent?limit=5` below input when idle. Click header → nutrition detail.

**SessionsCard** — Today's session count, total coins, latest session title. Click → sessions detail.

**RecencyCard** — Grid of indicators: icon/label + colored dot (green/yellow/red) + "2d ago". Informational only, no drill-down.

**GoalsCard** — Active goals list with name + Mantine progress bar (current/target). Click → goals detail.

### Nutrition Input Flow (In-Place States)

**`idle`** — Shows today's calories/macros summary. Text input + quick-add chips below.

**`parsing`** — Input disables, skeleton replaces summary. "Analyzing..." text.

**`review`** — Parsed items list (name, calories) with total. "Accept" dismisses review (items already logged by API). "Undo" deletes the logged items. Individual items show X to remove.

**`idle` (refreshed)** — After accept, re-fetch dashboard to update today's nutrition.

Items are logged on input (by `POST /nutrition/input`). Review state shows what was logged. Undo removes them.

### History Detail

Back button at top returns to hub. Content depends on card type.

**HistoryChart** — Single Highcharts instance:
- X-axis: time, shared
- Left Y-axis: weight (lbs), spline series
- Right Y-axis: calories, line series
- Far-right Y-axis: workout minutes, column (bar) series
- Data: combined from `history.daily` + `history.weekly` + `history.monthly`
- Zoom buttons: "90d" (daily), "6mo" (weekly), "2yr" (monthly)

**Detail content below chart:**
- Weight: chart + recent readings table
- Nutrition: chart + today's food items + catalog search
- Sessions: chart + recent sessions list (titles, coins, duration)
- Goals: no chart — goal cards with progress, metrics, deadline

### File Structure

```
frontend/src/
  Apps/
    HealthApp.jsx              (rewrite — page shell, data fetch, view routing)
    HealthApp.scss             (page-level styles)
  modules/Health/
    HealthHub.jsx              (card grid layout)
    HealthDetail.jsx           (detail view shell with back button)
    cards/
      WeightCard.jsx
      NutritionCard.jsx        (includes input flow state machine)
      SessionsCard.jsx
      RecencyCard.jsx
      GoalsCard.jsx
    detail/
      HistoryChart.jsx         (Highcharts multi-y-axis)
      WeightDetail.jsx
      NutritionDetail.jsx
      SessionsDetail.jsx
      GoalsDetail.jsx
    Nutrition.jsx              (keep existing)
    Weight.jsx                 (keep existing)
```

### Data Flow

1. `HealthApp` fetches `GET /health/dashboard` → stores in state
2. Passes `dashboard.today`, `dashboard.recency`, `dashboard.goals`, `dashboard.history` to hub cards as props
3. NutritionCard additionally fetches `GET /nutrition/catalog/recent` for quick-add chips
4. NutritionCard posts to `POST /nutrition/input` and `POST /nutrition/catalog/quickadd`
5. After nutrition changes, re-fetches dashboard to refresh today's numbers
6. Detail views receive `dashboard.history` and render HistoryChart + type-specific content

### Styling

- Follow DashboardCard dark theme pattern (`rgba(30, 30, 50, 0.6)`, backdrop blur)
- Desktop: 2-3 column CSS grid for hub cards
- Mobile: single column stack
- RecencyCard: compact grid of indicators (3-4 per row)
- NutritionCard input: full-width, dark-themed Mantine TextInput
- Quick-add chips: Mantine Badge components, clickable

### Dependencies

- `@mantine/core` (existing)
- `highcharts` + `highcharts-react-official` (existing)
- `DaylightAPI` from `../../lib/api.mjs` (existing)
- `DashboardCard` from fitness widgets `_shared/` (existing)
- No new npm packages needed
