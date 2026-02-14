# Session History Chart Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the fitness race chart to render completed past sessions, accessed through the Session Browser plugin.

**Architecture:** A pure data adapter transforms the existing `/api/v1/fitness/sessions/:id` response into the same interface the live chart consumes (`getSeries`, `roster`, `timebase`). FitnessChartApp gains a `sessionData` prop — when provided, it uses the adapter instead of live hooks. SessionBrowserApp replaces its JSON dump with the chart.

**Tech Stack:** React, existing FitnessChartApp/SVG rendering, existing session API

---

### Task 1: Session Data Adapter

**Files:**
- Create: `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/sessionDataAdapter.js`

**Step 1: Create the adapter module**

This is a pure function with no React dependencies. It takes a session API response and returns the three things the chart needs.

```js
import { DaylightMediaPath } from '../../../../../lib/api.mjs';
import { getZoneColor } from '../../../domain';

/**
 * Key mapping: API short keys → chart metric keys
 */
const METRIC_KEY_MAP = {
  heart_rate: 'hr',
  zone_id: 'zone',
  coins_total: 'coins',
  heart_beats: 'beats',
};

/**
 * Transform a session API response into the data interface
 * that FitnessChartApp's chart hooks expect.
 *
 * @param {Object} session - Response from GET /api/v1/fitness/sessions/:id
 * @returns {{ getSeries: Function, roster: Object[], timebase: Object }}
 */
export function createChartDataSource(session) {
  if (!session) return { getSeries: () => [], roster: [], timebase: {} };

  const timelineParticipants = session.timeline?.participants || {};

  // --- getSeries(userId, metric, options) ---
  const getSeries = (userId, metric, options = {}) => {
    const shortKey = METRIC_KEY_MAP[metric] || metric;
    const participantTimeline = timelineParticipants[userId];
    if (!participantTimeline) return [];
    const series = participantTimeline[shortKey];
    if (!Array.isArray(series)) return [];
    return options.clone !== false ? [...series] : series;
  };

  // --- roster ---
  const participantsMeta = session.participants || {};
  const legacyRoster = session.roster || [];

  let roster;
  if (Object.keys(participantsMeta).length > 0) {
    // V3 format: participants is an object keyed by userId
    roster = Object.entries(participantsMeta).map(([userId, meta]) => {
      // Derive zone color from last zone in timeline
      const zoneSeries = timelineParticipants[userId]?.zone || [];
      let lastZone = null;
      for (let i = zoneSeries.length - 1; i >= 0; i--) {
        if (zoneSeries[i] != null) { lastZone = zoneSeries[i]; break; }
      }

      return {
        id: userId,
        profileId: userId,
        name: meta.display_name || userId,
        displayLabel: meta.display_name || userId,
        isActive: true, // completed session — everyone shown as present
        zoneColor: getZoneColor(lastZone),
        avatarUrl: DaylightMediaPath(`/static/img/users/${userId}`),
        isPrimary: meta.is_primary || false,
        hrDeviceId: meta.hr_device || null,
      };
    });
  } else {
    // Legacy format: roster is an array
    roster = legacyRoster.map((entry, idx) => {
      const userId = entry.name || entry.hrDeviceId || `anon-${idx}`;
      const zoneSeries = timelineParticipants[userId]?.zone || [];
      let lastZone = null;
      for (let i = zoneSeries.length - 1; i >= 0; i--) {
        if (zoneSeries[i] != null) { lastZone = zoneSeries[i]; break; }
      }

      return {
        id: userId,
        profileId: userId,
        name: entry.name || 'Unknown',
        displayLabel: entry.name || 'Unknown',
        isActive: true,
        zoneColor: getZoneColor(lastZone),
        avatarUrl: DaylightMediaPath(`/static/img/users/${userId}`),
        isPrimary: entry.isPrimary || false,
        hrDeviceId: entry.hrDeviceId || null,
      };
    });
  }

  // --- timebase ---
  const intervalSeconds = session.timeline?.interval_seconds || 5;
  const timebase = {
    intervalMs: intervalSeconds * 1000,
    tickCount: session.timeline?.tick_count || 0,
  };

  return { getSeries, roster, timebase };
}
```

**Step 2: Verify the file was created correctly**

Run: `node -e "import('./frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/sessionDataAdapter.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`

Expected: OK (module parses without syntax errors)

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/sessionDataAdapter.js
git commit -m "feat(fitness): add session data adapter for historical chart rendering"
```

---

### Task 2: FitnessChartApp Dual-Mode

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx`

This task adds a `sessionData` prop. When provided, the component uses the adapter instead of live plugin data. All downstream rendering stays shared.

**Step 1: Add import for the adapter**

At the top of FitnessChartApp.jsx, after existing imports (around line 14), add:

```js
import { createChartDataSource } from './sessionDataAdapter.js';
```

**Step 2: Add `sessionData` prop to component signature**

Change line 684 from:

```jsx
const FitnessChartApp = ({ mode, onClose, config, onMount }) => {
```

to:

```jsx
const FitnessChartApp = ({ mode, onClose, config, onMount, sessionData }) => {
```

**Step 3: Add data source branching after `useFitnessPlugin`**

After the `useFitnessPlugin` call (line 695) and before `containerRef` (line 696), insert the data source selection logic:

```jsx
	// Historical mode: use static session data instead of live plugin data
	const staticSource = useMemo(() => {
		if (!sessionData) return null;
		// Handle both { session: {...} } wrapper and direct session object
		const session = sessionData.session || sessionData;
		return createChartDataSource(session);
	}, [sessionData]);
	const isHistorical = !!staticSource;

	// Choose data source: static (historical) or live (plugin)
	const chartParticipants = isHistorical ? staticSource.roster : participants;
	const chartGetSeries = isHistorical ? staticSource.getSeries : getUserTimelineSeries;
	const chartTimebase = isHistorical ? staticSource.timebase : timebase;
	const chartHistorical = isHistorical ? [] : historicalParticipants;
	const chartActivityMonitor = isHistorical ? null : activityMonitor;
	const chartZoneConfig = isHistorical ? null : zoneConfig;
	const chartSessionId = isHistorical ? (sessionData?.session?.id || sessionData?.sessionId || 'historical') : sessionId;
```

**Step 4: Replace direct references with chart* variables**

In the `useRaceChartWithHistory` call (around line 738-744), replace:

```jsx
	const { allEntries, presentEntries, absentEntries, dropoutMarkers, maxValue, maxIndex } = useRaceChartWithHistory(
		participants,
		getUserTimelineSeries,
		timebase,
		historicalParticipants,
		{ activityMonitor, zoneConfig, sessionId }
	);
```

with:

```jsx
	const { allEntries, presentEntries, absentEntries, dropoutMarkers, maxValue, maxIndex } = useRaceChartWithHistory(
		chartParticipants,
		chartGetSeries,
		chartTimebase,
		chartHistorical,
		{ activityMonitor: chartActivityMonitor, zoneConfig: chartZoneConfig, sessionId: chartSessionId }
	);
```

**Step 5: Skip lifecycle registration in historical mode**

Change the lifecycle registration effect (lines 704-710) from:

```jsx
    useEffect(() => {
        registerLifecycle({
            onPause: () => {},
            onResume: () => {},
            onSessionEnd: () => {}
        });
    }, [registerLifecycle]);
```

to:

```jsx
    useEffect(() => {
        if (isHistorical) return; // No lifecycle in historical mode
        registerLifecycle({
            onPause: () => {},
            onResume: () => {},
            onSessionEnd: () => {}
        });
    }, [registerLifecycle, isHistorical]);
```

**Step 6: Also replace `participants` in the diagnostic effects**

The diagnostic `useEffect` blocks (lines 762-824) reference `participants` directly. Replace these references with `chartParticipants` and `getUserTimelineSeries` with `chartGetSeries` so diagnostics work for both modes.

In the warmup diagnostic effect (~line 762), replace:
- `participants` → `chartParticipants`
- `getUserTimelineSeries` → `chartGetSeries`

In the participant count mismatch effect (~line 799), replace:
- `participants` → `chartParticipants`

Update the dependency arrays of these effects to match.

**Step 7: Verify the app compiles**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build 2>&1 | tail -5`

Expected: Build completes without errors (or only pre-existing warnings).

**Step 8: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx
git commit -m "feat(fitness): add sessionData prop for historical chart rendering"
```

---

### Task 3: SessionBrowserApp Integration

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/SessionBrowserApp/SessionBrowserApp.jsx`

Replace the raw JSON dump with the chart component.

**Step 1: Add FitnessChartApp import**

At the top of SessionBrowserApp.jsx, after the existing imports (line 2), add:

```js
import FitnessChartApp from '../FitnessChartApp/FitnessChartApp.jsx';
```

**Step 2: Replace the JSON dump with the chart**

Replace the session detail rendering block (lines 188-229) — specifically the inner content after `{selectedSessionId ? (` — from:

```jsx
            <div className="session-detail">
              {detailLoading ? (
                <div className="loading">Loading details...</div>
              ) : sessionDetail ? (
                <div>
                  <header className="detail-header">
                    <h2>Session Details</h2>
                    <span className="session-id">{sessionDetail.sessionId}</span>
                  </header>

                  <div className="detail-grid">
                      <div className="detail-item">
                          <label>Start Time</label>
                          <div className="value">{new Date(sessionDetail.startTime).toLocaleString()}</div>
                      </div>
                      <div className="detail-item">
                          <label>Duration</label>
                          <div className="value">{formatDuration(sessionDetail.durationMs)}</div>
                      </div>
                      <div className="detail-item">
                          <label>Participants</label>
                          <div className="value">{sessionDetail.roster?.length || 0}</div>
                      </div>
                      <div className="detail-item">
                          <label>Total Ticks</label>
                          <div className="value">{sessionDetail.timeline?.timebase?.tickCount || 0}</div>
                      </div>
                  </div>

                  <h4>Raw Data Preview</h4>
                  <pre>{JSON.stringify(sessionDetail, null, 2)}</pre>
                </div>
              ) : (
                <div className="error">Failed to load details</div>
              )}
            </div>
```

to:

```jsx
            <div className="session-detail">
              {detailLoading ? (
                <div className="loading">Loading details...</div>
              ) : sessionDetail ? (
                <div className="session-detail__content">
                  <FitnessChartApp
                    sessionData={sessionDetail}
                    mode="standalone"
                    onClose={() => setSelectedSessionId(null)}
                  />
                </div>
              ) : (
                <div className="error">Failed to load details</div>
              )}
            </div>
```

**Step 3: Verify the app compiles**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build 2>&1 | tail -5`

Expected: Build completes without errors.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/SessionBrowserApp/SessionBrowserApp.jsx
git commit -m "feat(fitness): render race chart in session browser instead of raw JSON"
```

---

### Task 4: Manual Verification

**Step 1: Start the dev server (if not running)**

```bash
lsof -i :3111
# If nothing, start:
cd /Users/kckern/Documents/GitHub/DaylightStation && npm run dev
```

**Step 2: Verify live chart still works**

Navigate to the fitness app and start a session (or use simulation). Confirm the race chart renders as before with live heart rate data.

**Step 3: Verify historical chart**

1. Open the fitness app sidebar/plugin menu
2. Select "History" (Session Browser)
3. Pick a date with session data (dots on calendar)
4. Select a session from the list
5. Confirm the race chart renders with participant lines, zone colors, avatars, and time axis

**Step 4: Verify edge cases**

- Select a session with a single participant → chart renders with linear Y scale
- Select a session with multiple participants → chart renders with log/power Y scale
- Switch between sessions → chart updates without stale data
- Return to live view → live chart works normally, no stale historical data

**Step 5: Final commit (if any fixes needed)**

If any adjustments were required during testing, commit them.
