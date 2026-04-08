# Fitness Longitudinal Panels + Card Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add longitudinal sparkline panels (30-day daily + 6-month weekly) below the suggestions grid, refine suggestion cards with mini show posters, fix strategy ordering, and wire show navigation with episode pre-selection.

**Architecture:** New `LongitudinalAggregationService` assembles daily/weekly data from existing YAML datastores. New `fitness:longitudinal` widget renders sparkline grids. Suggestion cards get a fixed-height metadata area with an overlapping mini poster. The coaching panel accepts drill-down selections from the sparkline grids via `FitnessScreenProvider` context.

**Tech Stack:** Express.js (backend), React + Mantine (frontend), Jest (tests), YAML datastores

**Spec:** `docs/superpowers/specs/2026-04-08-fitness-longitudinal-panels-design.md`

---

## File Map

### Backend (new)

| File | Purpose |
|------|---------|
| `backend/src/3_applications/health/LongitudinalAggregationService.mjs` | Assembles 30-day daily + 26-week weekly aggregated data |
| `tests/unit/suite/health/LongitudinalAggregationService.test.mjs` | Unit tests for aggregation |

### Backend (modified)

| File | Change |
|------|--------|
| `backend/src/4_api/v1/routers/health.mjs` | Add `GET /longitudinal` route |
| `backend/src/0_system/bootstrap.mjs` | Wire `LongitudinalAggregationService`, reorder suggestion strategies |

### Frontend (new)

| File | Purpose |
|------|---------|
| `frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/FitnessLongitudinalWidget.jsx` | Main widget with DailyGrid + WeeklyGrid |
| `frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/FitnessLongitudinalWidget.scss` | Sparkline styles |
| `frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/SparklineRow.jsx` | Reusable sparkline bar row |
| `frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/index.jsx` | Re-export |

### Frontend (modified)

| File | Change |
|------|--------|
| `frontend/src/modules/Fitness/FitnessScreenProvider.jsx` | Add `longitudinalSelection` state |
| `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/SuggestionCard.jsx` | Add mini poster, fixed metadata height |
| `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.scss` | Poster styles, fixed metadata height |
| `frontend/src/modules/Fitness/widgets/FitnessCoachWidget/FitnessCoachWidget.jsx` | Accept longitudinal drill-down selection |
| `frontend/src/modules/Fitness/index.js` | Register `fitness:longitudinal` |
| `frontend/src/Apps/FitnessApp.jsx` | Pass `episodeId` to FitnessShow |
| `frontend/src/modules/Fitness/player/FitnessShow.jsx` | Accept `episodeId`, pre-select episode |

---

## Task 1: Strategy Priority Reorder

Quick fix — change the order strategies are instantiated in bootstrap.

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

- [ ] **Step 1: Reorder strategies in bootstrap.mjs**

In `createFitnessApiRouter()`, find the `FitnessSuggestionService` instantiation and change the strategies array order from:

```javascript
    strategies: [
      new NextUpStrategy(),
      new ResumeStrategy(),
      new FavoriteStrategy(),
      new MemorableStrategy(),
      new DiscoveryStrategy(),
    ],
```

To:

```javascript
    strategies: [
      new ResumeStrategy(),
      new NextUpStrategy(),
      new FavoriteStrategy(),
      new MemorableStrategy(),
      new DiscoveryStrategy(),
    ],
```

- [ ] **Step 2: Verify tests still pass**

Run: `npx jest tests/unit/suite/fitness/suggestions/ --no-cache`
Expected: All 27 tests pass (strategy order is an orchestrator concern, individual strategy tests unaffected)

- [ ] **Step 3: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "fix(fitness): reorder suggestion strategies — resume before next_up"
```

---

## Task 2: Suggestion Card — Mini Poster + Fixed Metadata Height

Update the SuggestionCard component to show a mini show poster that's flush left/bottom and overlaps into the thumbnail area. The metadata area has a fixed height.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/SuggestionCard.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.scss`

- [ ] **Step 1: Update SuggestionCard.jsx to add poster element**

The poster sits in the metadata body area, positioned absolute, flush left and bottom, with negative top positioning to overlap into the thumbnail. Text content gets left padding to clear the poster.

Replace the full body section in `SuggestionCard.jsx`. The card's body div gets the poster as a child:

```jsx
      {/* Body area — click to browse show with episode selected */}
      <div
        className="suggestion-card__body"
        onClick={() => onBrowse?.(suggestion)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onBrowse?.(suggestion); }}
      >
        {poster && (
          <div className="suggestion-card__mini-poster">
            <img src={poster} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
          </div>
        )}
        <div className="suggestion-card__body-text">
          <div className="suggestion-card__title-desc">
            <span className="suggestion-card__title">{title}</span>
            {description && <>{' — '}<span className="suggestion-card__desc-inline">{description}</span></>}
          </div>

          {type === 'resume' && progress && (
            <div className="suggestion-card__progress">
              <div className="suggestion-card__progress-bar">
                <div className="suggestion-card__progress-fill" style={{ width: `${progress.percent}%` }} />
              </div>
              <span className="suggestion-card__progress-text">{progress.percent}%</span>
            </div>
          )}

          {type === 'memorable' && reason && (
            <div className="suggestion-card__metric">{reason}</div>
          )}

          {type === 'discovery' && reason && (
            <div className="suggestion-card__reason">{reason}</div>
          )}
        </div>
      </div>
```

Also add `poster` to the destructured props at the top of the component.

- [ ] **Step 2: Update SCSS for poster and fixed metadata height**

Add/replace these rules in `FitnessSuggestionsWidget.scss`:

```scss
// ─── Body (Click to browse show) ──────────────────────

.suggestion-card__body {
  position: relative;
  height: 64px;           // Fixed height — poster sizing depends on this
  cursor: pointer;
  overflow: hidden;

  &:active { background: rgba(255, 255, 255, 0.04); }
}

.suggestion-card__mini-poster {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 38px;
  top: -16px;             // Spills 16px into the thumbnail area
  z-index: 3;
  border-radius: 0 6px 0 0;  // Only round top-right (bottom-left is card corner)
  overflow: hidden;
  box-shadow: 2px -2px 8px rgba(0, 0, 0, 0.5);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.suggestion-card__body-text {
  padding: 5px 8px 6px 46px;  // 38px poster + 8px gap
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
```

Also update the duration badge to scoot up:

```scss
.suggestion-card__duration {
  position: absolute;
  bottom: 20px;           // Scooted up from 6px to clear poster overlap
  left: 6px;
  // ... rest unchanged
}
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && ./node_modules/.bin/vite build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/
git commit -m "feat(fitness): add mini show poster to suggestion cards with fixed metadata height"
```

---

## Task 3: Show Navigation with Episode Pre-Selection

Wire the metadata click to navigate to the show with the episode pre-selected.

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`
- Modify: `frontend/src/modules/Fitness/player/FitnessShow.jsx`

- [ ] **Step 1: Pass episodeId through FitnessApp navigation**

In `FitnessApp.jsx`, in the `handleNavigate` function's `case 'show':` block (around line 844), store the episodeId:

```javascript
      case 'show':
        const showId = String(target.contentId || target.plex || target.id).replace(/^[a-z]+:/i, '');
        setSelectedShow(showId);
        setSelectedEpisodeId(target.episodeId || null);  // ADD THIS
        setCurrentView('show');
        navigate(`/fitness/show/${showId}`, { replace: true });
        break;
```

Add the state at the top of the component (near other useState calls around line 44):

```javascript
const [selectedEpisodeId, setSelectedEpisodeId] = useState(null);
```

Pass it to FitnessShow (around line 1205):

```jsx
                  <FitnessShow
                    showId={selectedShow}
                    episodeId={selectedEpisodeId}
                    onBack={handleBackToMenu}
```

- [ ] **Step 2: Accept episodeId in FitnessShow and pre-select**

In `FitnessShow.jsx`, add `episodeId` to the destructured props (line 208):

```javascript
const FitnessShow = ({ showId: rawShowId, episodeId: preSelectEpisodeId, onBack, viewportRef, setFitnessPlayQueue, onPlay }) => {
```

In the `fetchShowData` callback, after the data is fetched, replace the auto-select first episode block (around line 302-305):

```javascript
      // Auto-select: pre-selected episode if provided, otherwise first episode
      if (response.items && response.items.length > 0) {
        const preSelectLocalId = preSelectEpisodeId?.replace(/^[a-z]+:/i, '');
        const preSelected = preSelectLocalId
          ? response.items.find(ep => ep.localId === preSelectLocalId || ep.id === preSelectEpisodeId)
          : null;
        setSelectedEpisode(preSelected || response.items[0]);
      }
```

Add `preSelectEpisodeId` to the useCallback dependency array for `fetchShowData`.

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && ./node_modules/.bin/vite build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx frontend/src/modules/Fitness/player/FitnessShow.jsx
git commit -m "feat(fitness): show navigation with episode pre-selection from suggestion cards"
```

---

## Task 4: LongitudinalAggregationService

Backend service that assembles 30-day daily and 26-week weekly aggregated data from existing YAML datastores.

**Files:**
- Create: `backend/src/3_applications/health/LongitudinalAggregationService.mjs`
- Create: `tests/unit/suite/health/LongitudinalAggregationService.test.mjs`

- [ ] **Step 1: Write tests**

```javascript
// tests/unit/suite/health/LongitudinalAggregationService.test.mjs
import { LongitudinalAggregationService } from '../../../../backend/src/3_applications/health/LongitudinalAggregationService.mjs';

function makeDateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

function makeStubStores({ sessions = {}, weight = {}, nutrition = {}, fitness = {}, reconciliation = {} } = {}) {
  return {
    sessionDatastore: {
      findInRange: async () => {
        const all = [];
        for (const [date, list] of Object.entries(sessions)) {
          for (const s of list) all.push({ date, ...s });
        }
        return all;
      },
    },
    healthStore: {
      loadWeightData: async () => weight,
      loadNutritionData: async () => nutrition,
      loadFitnessData: async () => fitness,
      loadReconciliationData: async () => reconciliation,
    },
  };
}

describe('LongitudinalAggregationService', () => {
  test('returns 30 daily entries sorted oldest to newest', async () => {
    const stores = makeStubStores();
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    expect(result.daily).toHaveLength(30);
    expect(result.daily[0].date < result.daily[29].date).toBe(true);
  });

  test('returns ~26 weekly entries sorted oldest to newest', async () => {
    const stores = makeStubStores();
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    expect(result.weekly.length).toBeGreaterThanOrEqual(25);
    expect(result.weekly.length).toBeLessThanOrEqual(27);
    expect(result.weekly[0].weekStart < result.weekly[result.weekly.length - 1].weekStart).toBe(true);
  });

  test('aggregates exercise minutes from sessions', async () => {
    const today = makeDateStr(0);
    const stores = makeStubStores({
      sessions: {
        [today]: [
          { durationMs: 1800000, strava: { calories: 300, avgHeartrate: 140 } },
          { durationMs: 2700000, strava: { calories: 450, avgHeartrate: 150 } },
        ],
      },
    });
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    const todayEntry = result.daily.find(d => d.date === today);
    expect(todayEntry.exerciseMinutes).toBe(75);
    expect(todayEntry.caloriesBurned).toBe(750);
  });

  test('includes nutrition protein', async () => {
    const today = makeDateStr(0);
    const stores = makeStubStores({
      nutrition: { [today]: { protein: 145, calories: 2100 } },
    });
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    const todayEntry = result.daily.find(d => d.date === today);
    expect(todayEntry.protein).toBe(145);
  });

  test('includes steps from fitness data', async () => {
    const today = makeDateStr(0);
    const stores = makeStubStores({
      fitness: { [today]: { steps: { steps_count: 9500 } } },
    });
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    const todayEntry = result.daily.find(d => d.date === today);
    expect(todayEntry.steps).toBe(9500);
  });

  test('includes calorie balance from reconciliation', async () => {
    const today = makeDateStr(0);
    const stores = makeStubStores({
      reconciliation: { [today]: { calorie_adjustment: -410 } },
    });
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    const todayEntry = result.daily.find(d => d.date === today);
    expect(todayEntry.calorieBalance).toBe(-410);
  });

  test('weekly aggregates weight and calorie balance', async () => {
    // Put weight data 7 days ago (within first week from end)
    const day7 = makeDateStr(7);
    const day8 = makeDateStr(8);
    const stores = makeStubStores({
      weight: {
        [day7]: { lbs_adjusted_average: 185, calorie_balance: -300 },
        [day8]: { lbs_adjusted_average: 186, calorie_balance: -400 },
      },
    });
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    // Find the week containing day7
    const week = result.weekly.find(w => w.weekStart <= day7 && w.weekEnd >= day7);
    if (week) {
      expect(week.avgWeight).toBeGreaterThan(0);
      expect(week.weightCalorieBalance).toBeLessThan(0);
    }
  });

  test('null fields when data is missing for a day', async () => {
    const stores = makeStubStores();
    const svc = new LongitudinalAggregationService(stores);
    const result = await svc.aggregate('testuser');

    // All days should have null for missing data
    expect(result.daily[0].protein).toBeNull();
    expect(result.daily[0].steps).toBeNull();
    expect(result.daily[0].calorieBalance).toBeNull();
    // Exercise defaults to 0 (no sessions = 0 minutes)
    expect(result.daily[0].exerciseMinutes).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/suite/health/LongitudinalAggregationService.test.mjs --no-cache`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement LongitudinalAggregationService**

```javascript
// backend/src/3_applications/health/LongitudinalAggregationService.mjs

/**
 * LongitudinalAggregationService — assembles 30-day daily and 26-week weekly
 * aggregated health data from existing YAML datastores.
 */
export class LongitudinalAggregationService {
  #sessionDatastore;
  #healthStore;

  constructor({ sessionDatastore, healthStore }) {
    this.#sessionDatastore = sessionDatastore;
    this.#healthStore = healthStore;
  }

  async aggregate(userId) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Date range for daily: 30 days
    const dailyStart = new Date(today);
    dailyStart.setDate(dailyStart.getDate() - 29);
    const dailyStartStr = dailyStart.toISOString().split('T')[0];

    // Date range for weekly: 26 weeks (~182 days)
    const weeklyStart = new Date(today);
    weeklyStart.setDate(weeklyStart.getDate() - 182);
    const weeklyStartStr = weeklyStart.toISOString().split('T')[0];

    // Load all data sources in parallel
    const [sessions, weight, nutrition, fitness, reconciliation] = await Promise.all([
      this.#sessionDatastore.findInRange(weeklyStartStr, todayStr, null).catch(() => []),
      this.#healthStore.loadWeightData(userId).catch(() => ({})),
      this.#healthStore.loadNutritionData(userId).catch(() => ({})),
      this.#healthStore.loadFitnessData(userId).catch(() => ({})),
      this.#healthStore.loadReconciliationData(userId).catch(() => ({})),
    ]);

    // Index sessions by date
    const sessionsByDate = {};
    for (const s of sessions) {
      const d = s.date;
      if (!d) continue;
      if (!sessionsByDate[d]) sessionsByDate[d] = [];
      sessionsByDate[d].push(s);
    }

    // Build daily entries (30 days)
    const daily = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()];

      const daySessions = sessionsByDate[dateStr] || [];
      const exerciseMinutes = Math.round(
        daySessions.reduce((sum, s) => sum + (s.durationMs || 0), 0) / 60000
      );
      const caloriesBurned = daySessions.reduce(
        (sum, s) => sum + (s.strava?.calories || 0), 0
      ) || (exerciseMinutes > 0 ? null : 0);

      daily.push({
        date: dateStr,
        dayOfWeek: dow,
        exerciseMinutes,
        caloriesBurned: caloriesBurned || 0,
        steps: fitness[dateStr]?.steps?.steps_count ?? null,
        protein: nutrition[dateStr]?.protein ?? null,
        calorieBalance: reconciliation[dateStr]?.calorie_adjustment ?? null,
      });
    }

    // Build weekly entries (26 weeks)
    const weekly = [];
    // Find the Monday of the current week
    const currentDay = today.getDay(); // 0=Sun
    const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
    const thisMonday = new Date(today);
    thisMonday.setDate(thisMonday.getDate() + mondayOffset);

    for (let w = 25; w >= 0; w--) {
      const weekStart = new Date(thisMonday);
      weekStart.setDate(weekStart.getDate() - w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const wsStr = weekStart.toISOString().split('T')[0];
      const weStr = weekEnd.toISOString().split('T')[0];
      const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      // Collect daily data for this week
      const weightVals = [];
      const weightBalanceVals = [];
      let exCals = 0;
      const hrVals = [];

      for (let d = 0; d < 7; d++) {
        const day = new Date(weekStart);
        day.setDate(day.getDate() + d);
        const dayStr = day.toISOString().split('T')[0];

        if (weight[dayStr]?.lbs_adjusted_average) {
          weightVals.push(weight[dayStr].lbs_adjusted_average);
        }
        if (weight[dayStr]?.calorie_balance != null) {
          weightBalanceVals.push(weight[dayStr].calorie_balance);
        }

        const daySessions = sessionsByDate[dayStr] || [];
        for (const s of daySessions) {
          exCals += s.strava?.calories || 0;
          if (s.strava?.avgHeartrate) hrVals.push(s.strava.avgHeartrate);
        }
      }

      const mean = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null;

      weekly.push({
        weekStart: wsStr,
        weekEnd: weStr,
        label,
        avgWeight: mean(weightVals),
        weightCalorieBalance: mean(weightBalanceVals),
        exerciseCalories: exCals || 0,
        avgExerciseHr: mean(hrVals),
      });
    }

    return { daily, weekly };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/suite/health/LongitudinalAggregationService.test.mjs --no-cache`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/health/LongitudinalAggregationService.mjs \
       tests/unit/suite/health/LongitudinalAggregationService.test.mjs
git commit -m "feat(health): add LongitudinalAggregationService for sparkline data"
```

---

## Task 5: Wire Longitudinal API Route

Add the `GET /health/longitudinal` endpoint and wire the service in bootstrap.

**Files:**
- Modify: `backend/src/4_api/v1/routers/health.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

- [ ] **Step 1: Add the route in health.mjs**

In `createHealthRouter`, add `longitudinalService` to the destructured config:

```javascript
const { healthService, healthStore, configService, nutriListStore, dashboardService, catalogService, webNutribotAdapter, longitudinalService, logger = console } = config;
```

Add the route after the `/daily` endpoint:

```javascript
  /**
   * GET /health/longitudinal
   * 30-day daily + 26-week weekly aggregated data for sparkline grids
   */
  router.get('/longitudinal', asyncHandler(async (req, res) => {
    const username = req.query.userId || getDefaultUsername();
    const result = await longitudinalService.aggregate(username);
    res.json(result);
  }));
```

- [ ] **Step 2: Wire in bootstrap.mjs**

Add the import at the top:

```javascript
import { LongitudinalAggregationService } from '../3_applications/health/LongitudinalAggregationService.mjs';
```

In `createHealthApiRouter()`, after the `dashboardService` creation (around line 2527), create the longitudinal service:

```javascript
  const longitudinalService = new LongitudinalAggregationService({
    sessionDatastore: config.sessionDatastore,
    healthStore: healthServices.healthStore,
  });
```

Add `longitudinalService` to the `createHealthRouter()` call. Also need to accept `sessionDatastore` in `createHealthApiRouter`'s config — add it to the destructured params:

```javascript
  const {
    healthServices,
    configService,
    sessionService = null,
    sessionDatastore = null,  // ADD THIS
    // ...rest
  } = config;
```

Then find where `createHealthApiRouter` is called in the main app bootstrap and pass `sessionDatastore: fitnessServices.sessionStore`.

- [ ] **Step 3: Verify module loads**

Run: `node -e "import('./backend/src/3_applications/health/LongitudinalAggregationService.mjs').then(() => console.log('OK')).catch(e => console.error(e))"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/health.mjs backend/src/0_system/bootstrap.mjs
git commit -m "feat(health): wire longitudinal API route and service"
```

---

## Task 6: FitnessScreenProvider — Add Longitudinal Selection State

Add `longitudinalSelection` to the provider context so sparkline grids and coaching panel can communicate.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessScreenProvider.jsx`

- [ ] **Step 1: Add state and expose in context**

```javascript
export function FitnessScreenProvider({ onPlay, onNavigate, onCtaAction, children }) {
  const [scrollToDate, setScrollToDate] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [longitudinalSelection, setLongitudinalSelection] = useState(null);

  const value = useMemo(() => ({
    onPlay, onNavigate, onCtaAction,
    scrollToDate, setScrollToDate,
    selectedSessionId, setSelectedSessionId,
    longitudinalSelection, setLongitudinalSelection,
  }), [onPlay, onNavigate, onCtaAction, scrollToDate, selectedSessionId, longitudinalSelection]);
```

Update the fallback in `useFitnessScreen()`:

```javascript
  if (!ctx) {
    return {
      onPlay: null, onNavigate: null, onCtaAction: null,
      scrollToDate: null, setScrollToDate: () => {},
      selectedSessionId: null, setSelectedSessionId: () => {},
      longitudinalSelection: null, setLongitudinalSelection: () => {},
    };
  }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessScreenProvider.jsx
git commit -m "feat(fitness): add longitudinalSelection to FitnessScreenProvider"
```

---

## Task 7: SparklineRow Component

Reusable sparkline bar row used by both daily and weekly grids.

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/SparklineRow.jsx`

- [ ] **Step 1: Create SparklineRow**

```jsx
// frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/SparklineRow.jsx
import React from 'react';

export default function SparklineRow({
  label,
  data,
  color = 'rgba(34,139,230,0.6)',
  highlightColor,
  highlightFn,
  centerZero = false,
  positiveColor = 'rgba(200,80,40,0.4)',
  negativeColor = 'rgba(80,200,120,0.5)',
  maxValue,
  selectedIndex,
  onColumnClick,
}) {
  const values = data.map(d => (d == null ? 0 : d));
  const absMax = maxValue || Math.max(...values.map(Math.abs), 1);

  if (centerZero) {
    return (
      <div className="sparkline-row sparkline-row--center-zero">
        <div className="sparkline-row__label">{label}</div>
        <div className="sparkline-row__bars">
          <div className="sparkline-row__zero-line" />
          {data.map((v, i) => {
            const isNull = v == null;
            const pct = isNull ? 0 : Math.min(Math.abs(v) / absMax, 1) * 45;
            const isNeg = v != null && v < 0;
            const bg = isNeg ? negativeColor : positiveColor;
            const selected = selectedIndex === i;
            return (
              <div
                key={i}
                className={`sparkline-row__col${selected ? ' sparkline-row__col--selected' : ''}`}
                onClick={() => onColumnClick?.(i)}
              >
                {isNull ? (
                  <div className="sparkline-row__bar sparkline-row__bar--empty" />
                ) : isNeg ? (
                  <div className="sparkline-row__bar sparkline-row__bar--neg" style={{ height: `${pct}%`, background: bg }} />
                ) : (
                  <div className="sparkline-row__bar sparkline-row__bar--pos" style={{ height: `${pct}%`, background: bg }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="sparkline-row">
      <div className="sparkline-row__label">{label}</div>
      <div className="sparkline-row__bars">
        {data.map((v, i) => {
          const isNull = v == null;
          const pct = isNull ? 0 : Math.max(4, (v / absMax) * 100);
          const barColor = highlightFn && highlightFn(v) ? (highlightColor || color) : color;
          const selected = selectedIndex === i;
          return (
            <div
              key={i}
              className={`sparkline-row__col${selected ? ' sparkline-row__col--selected' : ''}`}
              onClick={() => onColumnClick?.(i)}
            >
              <div
                className={`sparkline-row__bar${isNull ? ' sparkline-row__bar--empty' : ''}`}
                style={isNull ? {} : { height: `${pct}%`, background: barColor }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/SparklineRow.jsx
git commit -m "feat(fitness): add SparklineRow component for longitudinal grids"
```

---

## Task 8: FitnessLongitudinalWidget

Main widget rendering both grids with column labels and click interaction.

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/FitnessLongitudinalWidget.jsx`
- Create: `frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/FitnessLongitudinalWidget.scss`
- Create: `frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/index.jsx`

- [ ] **Step 1: Create index.jsx**

```jsx
export { default } from './FitnessLongitudinalWidget.jsx';
```

- [ ] **Step 2: Create the main widget**

```jsx
// frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/FitnessLongitudinalWidget.jsx
import React, { useCallback } from 'react';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import SparklineRow from './SparklineRow.jsx';
import './FitnessLongitudinalWidget.scss';

function DailyGrid({ daily, selectedIndex, onSelect }) {
  if (!daily || daily.length === 0) return null;

  return (
    <div className="longitudinal-panel">
      <div className="longitudinal-panel__header">PAST 30 DAYS</div>
      <div className="longitudinal-panel__labels">
        <div className="sparkline-row__label" />
        {daily.map((d, i) => (
          <div key={i} className="longitudinal-panel__col-label">{d.dayOfWeek}</div>
        ))}
      </div>
      <SparklineRow label="Exercise Min" data={daily.map(d => d.exerciseMinutes)} color="rgba(34,139,230,0.6)" maxValue={90} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Cals Burned" data={daily.map(d => d.caloriesBurned || null)} color="rgba(200,80,40,0.5)" maxValue={600} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Steps" data={daily.map(d => d.steps)} color="rgba(80,200,120,0.35)" highlightColor="rgba(80,200,120,0.6)" highlightFn={v => v > 10000} maxValue={15000} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Protein (g)" data={daily.map(d => d.protein)} color="rgba(180,140,255,0.3)" highlightColor="rgba(180,140,255,0.6)" highlightFn={v => v >= 130} maxValue={180} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Cal +/−" data={daily.map(d => d.calorieBalance)} centerZero maxValue={600} selectedIndex={selectedIndex} onColumnClick={onSelect} />
    </div>
  );
}

function WeeklyGrid({ weekly, selectedIndex, onSelect }) {
  if (!weekly || weekly.length === 0) return null;

  return (
    <div className="longitudinal-panel">
      <div className="longitudinal-panel__header">PAST 6 MONTHS <span className="longitudinal-panel__header-sub">· weekly</span></div>
      <div className="longitudinal-panel__labels">
        <div className="sparkline-row__label" />
        {weekly.map((w, i) => (
          <div key={i} className="longitudinal-panel__col-label">{i % 4 === 0 ? w.label : ''}</div>
        ))}
      </div>
      <SparklineRow label="Weight" data={weekly.map(w => w.avgWeight)} color="rgba(255,255,255,0.4)" maxValue={Math.max(...weekly.map(w => w.avgWeight || 0).filter(Boolean)) * 1.02} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Wt Cal +/−" data={weekly.map(w => w.weightCalorieBalance)} centerZero maxValue={600} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Exer Cal/wk" data={weekly.map(w => w.exerciseCalories)} color="rgba(200,80,40,0.5)" maxValue={4000} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Avg HR" data={weekly.map(w => w.avgExerciseHr)} color="rgba(255,100,100,0.3)" highlightColor="rgba(255,100,100,0.5)" highlightFn={v => v >= 140} maxValue={170} selectedIndex={selectedIndex} onColumnClick={onSelect} />
    </div>
  );
}

export default function FitnessLongitudinalWidget() {
  const rawData = useScreenData('longitudinal');
  const { longitudinalSelection, setLongitudinalSelection } = useFitnessScreen();

  const handleDaySelect = useCallback((index) => {
    const day = rawData?.daily?.[index];
    if (!day) return;
    setLongitudinalSelection({ type: 'day', index, data: day });
  }, [rawData, setLongitudinalSelection]);

  const handleWeekSelect = useCallback((index) => {
    const week = rawData?.weekly?.[index];
    if (!week) return;
    setLongitudinalSelection({ type: 'week', index, data: week });
  }, [rawData, setLongitudinalSelection]);

  if (rawData === null) {
    return <div className="longitudinal-skeleton"><div className="skeleton shimmer" style={{ height: '100%', borderRadius: 10 }} /></div>;
  }

  const dailyIdx = longitudinalSelection?.type === 'day' ? longitudinalSelection.index : null;
  const weeklyIdx = longitudinalSelection?.type === 'week' ? longitudinalSelection.index : null;

  return (
    <div className="longitudinal-widget">
      <DailyGrid daily={rawData.daily} selectedIndex={dailyIdx} onSelect={handleDaySelect} />
      <WeeklyGrid weekly={rawData.weekly} selectedIndex={weeklyIdx} onSelect={handleWeekSelect} />
    </div>
  );
}
```

- [ ] **Step 3: Create SCSS**

```scss
// frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/FitnessLongitudinalWidget.scss

.longitudinal-widget {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
}

.longitudinal-skeleton {
  height: 100%;
}

// ─── Panel ─────────────────────────────────────────

.longitudinal-panel {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  flex: 1;
}

.longitudinal-panel__header {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 600;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

.longitudinal-panel__header-sub {
  font-weight: 400;
  color: rgba(255, 255, 255, 0.25);
}

.longitudinal-panel__labels {
  display: flex;
  margin-bottom: 2px;
}

.longitudinal-panel__col-label {
  flex: 1;
  text-align: center;
  font-size: 7px;
  color: rgba(255, 255, 255, 0.25);
}

// ─── Sparkline Row ────────────────────────────────

.sparkline-row {
  display: flex;
  align-items: flex-end;
  height: 28px;
  margin-bottom: 2px;

  &--center-zero {
    align-items: center;
    height: 32px;
  }
}

.sparkline-row__label {
  width: 80px;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.4);
  padding-right: 8px;
  text-align: right;
  align-self: center;
  flex-shrink: 0;
}

.sparkline-row__bars {
  flex: 1;
  display: flex;
  gap: 1px;
  align-items: flex-end;
  height: 100%;
  position: relative;
}

.sparkline-row--center-zero .sparkline-row__bars {
  align-items: center;
}

.sparkline-row__zero-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
}

.sparkline-row__col {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  cursor: pointer;

  &--selected {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 2px;
  }
}

.sparkline-row--center-zero .sparkline-row__col {
  justify-content: center;
}

.sparkline-row__bar {
  border-radius: 1px 1px 0 0;
  min-height: 2px;
  transition: height 0.2s;

  &--empty {
    height: 2px;
    background: rgba(255, 255, 255, 0.03);
  }

  &--neg {
    border-radius: 0 0 1px 1px;
    margin-top: 1px;
  }

  &--pos {
    border-radius: 1px 1px 0 0;
    margin-bottom: 1px;
    align-self: flex-end;
    margin-top: auto;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/
git commit -m "feat(fitness): add FitnessLongitudinalWidget with sparkline grids"
```

---

## Task 9: Update Coaching Panel for Drill-Down

Modify the coaching widget to show day/week summary when a sparkline column is selected.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessCoachWidget/FitnessCoachWidget.jsx`

- [ ] **Step 1: Add longitudinal selection rendering**

Add a `LongitudinalCard` component and render it when selection exists:

```jsx
function LongitudinalDayCard({ data }) {
  return (
    <DashboardCard className="dashboard-card--coach">
      <Text size="sm" fw={700} mb="xs">{new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
      <Stack gap={4}>
        <Text size="xs" c="dimmed">Exercise: {data.exerciseMinutes} min</Text>
        <Text size="xs" c="dimmed">Burned: {data.caloriesBurned} cal</Text>
        {data.steps != null && <Text size="xs" c="dimmed">Steps: {data.steps.toLocaleString()}</Text>}
        {data.protein != null && <Text size="xs" c="dimmed">Protein: {data.protein}g</Text>}
        {data.calorieBalance != null && <Text size="xs" c="dimmed">Balance: {data.calorieBalance > 0 ? '+' : ''}{data.calorieBalance} cal</Text>}
      </Stack>
    </DashboardCard>
  );
}

function LongitudinalWeekCard({ data }) {
  return (
    <DashboardCard className="dashboard-card--coach">
      <Text size="sm" fw={700} mb="xs">{data.label} — {new Date(data.weekEnd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
      <Stack gap={4}>
        {data.avgWeight != null && <Text size="xs" c="dimmed">Avg Weight: {data.avgWeight} lb</Text>}
        {data.weightCalorieBalance != null && <Text size="xs" c="dimmed">Wt Balance: {data.weightCalorieBalance > 0 ? '+' : ''}{Math.round(data.weightCalorieBalance)}/day</Text>}
        <Text size="xs" c="dimmed">Exercise: {data.exerciseCalories.toLocaleString()} cal</Text>
        {data.avgExerciseHr != null && <Text size="xs" c="dimmed">Avg HR: {Math.round(data.avgExerciseHr)} bpm</Text>}
      </Stack>
    </DashboardCard>
  );
}
```

Update the main export to check for longitudinal selection first:

```jsx
export default function FitnessCoachWidget() {
  const dashboard = useScreenData('dashboard');
  const nutrition = useScreenData('nutrition');
  const { onCtaAction, longitudinalSelection } = useFitnessScreen();

  // Longitudinal drill-down takes priority
  if (longitudinalSelection?.data) {
    if (longitudinalSelection.type === 'day') {
      return <LongitudinalDayCard data={longitudinalSelection.data} />;
    }
    if (longitudinalSelection.type === 'week') {
      return <LongitudinalWeekCard data={longitudinalSelection.data} />;
    }
  }

  if (!dashboard?.dashboard?.coach) return null;

  return (
    <CoachCard
      coach={dashboard.dashboard.coach}
      liveNutrition={nutrition?.data ? { logged: true } : null}
      onCtaAction={onCtaAction}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessCoachWidget/FitnessCoachWidget.jsx
git commit -m "feat(fitness): coaching panel shows longitudinal drill-down cards"
```

---

## Task 10: Register Widget + Update Screen Config

Register the new widget and update the container's screen config.

**Files:**
- Modify: `frontend/src/modules/Fitness/index.js`
- Modify: `data/household/config/fitness.yml` (container, via docker exec)

- [ ] **Step 1: Register widget**

In `frontend/src/modules/Fitness/index.js`, add import and registration:

```javascript
import FitnessLongitudinalWidget from './widgets/FitnessLongitudinalWidget/index.jsx';
// ...
registry.register('fitness:longitudinal', FitnessLongitudinalWidget);
```

- [ ] **Step 2: Update screen config in container**

Add the `longitudinal` data source and update the right-area layout. Use a node script via docker exec to:

1. Add `longitudinal` data source with `source: /api/v1/health/longitudinal` and `refresh: 600`
2. Change right-area from a single `widget: "fitness:suggestions"` to a column layout with suggestions on top and a bottom row containing `fitness:longitudinal` (75%) + `fitness:coach` (25%)

- [ ] **Step 3: Verify config is valid**

Run: `sudo -n docker exec daylight-station sh -c 'node -e "const y=require(\"js-yaml\");y.load(require(\"fs\").readFileSync(\"data/household/config/fitness.yml\",\"utf8\"));console.log(\"OK\")"'`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/index.js
git commit -m "feat(fitness): register longitudinal widget and update screen config"
```

---

## Task 11: Build, Deploy, Smoke Test

Build the Docker image, deploy, and verify both the API and the UI.

- [ ] **Step 1: Run all tests**

Run: `npx jest tests/unit/suite/fitness/suggestions/ tests/unit/suite/health/ --no-cache`
Expected: All tests pass

- [ ] **Step 2: Build frontend**

Run: `cd frontend && ./node_modules/.bin/vite build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Build and deploy Docker**

```bash
sudo -n docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo -n docker stop daylight-station && sudo -n docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 4: Test longitudinal API**

```bash
sleep 5 && curl -s http://localhost:3111/api/v1/health/longitudinal | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Daily: {len(d[\"daily\"])} entries')
print(f'Weekly: {len(d[\"weekly\"])} entries')
print(f'Sample daily: {d[\"daily\"][-1]}')
print(f'Sample weekly: {d[\"weekly\"][-1]}')
"
```
Expected: 30 daily entries, ~26 weekly entries with actual data

- [ ] **Step 5: Test suggestions API still works**

```bash
curl -s http://localhost:3111/api/v1/fitness/suggestions?gridSize=8 | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Total: {len(d[\"suggestions\"])} cards')
for s in d['suggestions']: print(f'  {s[\"type\"]:12s} {s[\"title\"][:40]}')
"
```
Expected: 8 cards, resume cards before next_up cards (if any resumable exist)

- [ ] **Step 6: Visual verification**

Open the fitness home screen. Verify:
- Suggestion cards show mini posters in bottom-left
- Clicking metadata area navigates to show browser
- Sparkline grids appear below suggestions
- Clicking a sparkline column shows a summary card in the coaching panel
