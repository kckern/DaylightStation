# Fitness Chart Memory Leak Fix

## Problem Statement

When a fitness session ends and the chart remains on screen, the browser freezes after several hours. The entire browser becomes unresponsive, requiring a force-quit.

**Scenario:**
1. Fitness session is active with participants
2. All users leave, grace period expires
3. Session ends (sessionId becomes null)
4. Chart stays on screen showing final state
5. Hours later: browser completely frozen

## Root Cause Analysis

### Finding 1: WebSocket subscription ignores session state

`FitnessContext.jsx:964-975`:
```javascript
unsubscribe = wsService.subscribe(
  ['fitness', 'vibration'],
  (data) => {
    const session = fitnessSessionRef.current;
    if (session) {
      session.ingestData(data);  // Always runs - session object always exists
      forceUpdate();             // Triggers re-render even after session ends
    }
  }
);
```

The `session` object is a `FitnessSession` instance that always exists (created in constructor). Even after session ends (`sessionId = null`), this check passes and `forceUpdate()` can be called.

### Finding 2: Chart maintains expensive state without cleanup

`FitnessChartApp.jsx`:
- `participantCache` state can hold many entries with arrays
- `persisted` state holds complete chart data (paths, avatars, etc.)
- `dropoutMarkers` accumulate over time
- `processedHistoricalRef` Set never clears entries

### Finding 3: Context value object is massive

`FitnessContext.jsx:1761-1939`:
- Over 100 properties in the context value
- Includes many `useMemo` values that recompute on version change
- Each `forceUpdate()` increments version, triggering recomputation

### Finding 4: Timer cleanup race condition

When `endSession()` is called:
1. `this.sessionId = null`
2. Timers are stopped
3. But React hasn't re-rendered yet
4. Existing intervals may fire once more before cleanup

## Solution Design

### 1. Gate WebSocket processing on active session

**File:** `frontend/src/context/FitnessContext.jsx`

**Change:** Check `session.sessionId` before processing

```javascript
// Before (problematic)
if (session) {
  session.ingestData(data);
  forceUpdate();
}

// After (fixed)
if (session && session.sessionId) {
  session.ingestData(data);
  forceUpdate();
}
```

### 2. Add explicit chart freeze on session end

**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx`

**Change:** When session ends, freeze the chart in its current state and stop all hooks from running

```javascript
// Add isFrozen state that becomes true when session ends
const [isFrozen, setIsFrozen] = useState(false);

// Detect session end and freeze
useEffect(() => {
  if (!sessionId && lastSessionIdRef.current) {
    // Session just ended - freeze chart
    setIsFrozen(true);
  }
  lastSessionIdRef.current = sessionId;
}, [sessionId]);

// Skip expensive computations when frozen
const { allEntries, presentEntries, ... } = useMemo(() => {
  if (isFrozen) {
    return { allEntries: [], presentEntries: [], ... }; // Return empty, rely on persisted
  }
  return useRaceChartWithHistory(...);
}, [isFrozen, ...]);
```

### 3. Clear caches on session end (but preserve display)

**File:** `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx`

The existing memory leak fix clears `participantCache` when sessionId changes. Verify this works correctly:

```javascript
useEffect(() => {
  if (lastSessionIdRef.current !== sessionId) {
    lastSessionIdRef.current = sessionId;
    setParticipantCache({});  // Clear cache
    processedHistoricalRef.current.clear();  // Clear processed set
  }
}, [sessionId]);
```

**Issue:** This may clear the cache before `persisted` is set, causing the chart to show nothing.

**Fix:** Only clear after persisted is captured:

```javascript
useEffect(() => {
  if (lastSessionIdRef.current !== sessionId) {
    if (!sessionId && hasData) {
      // Session ending - capture persisted before clearing
      setPersisted({ paths, avatars, badges, connectors, xTicks, yTicks, leaderValue });
    }
    lastSessionIdRef.current = sessionId;
    if (!sessionId) {
      // Now safe to clear
      setParticipantCache({});
      processedHistoricalRef.current.clear();
    }
  }
}, [sessionId, hasData, paths, avatars, badges, connectors, xTicks, yTicks, leaderValue]);
```

### 4. Add session-active gate to 3-second device pruning

**File:** `frontend/src/context/FitnessContext.jsx`

Already gated by `currentSessionId` - verify cleanup happens:

```javascript
const currentSessionId = fitnessSessionRef.current?.sessionId;
useEffect(() => {
  if (!currentSessionId) return;  // Already correct
  // ...
}, [forceUpdate, currentSessionId]);
```

## Implementation Checklist

- [ ] Gate WebSocket data processing on `session.sessionId`
- [ ] Add `isFrozen` state to chart component
- [ ] Ensure `persisted` is set before clearing caches
- [ ] Verify 1-second heartbeat stops correctly
- [ ] Verify 3-second device pruning stops correctly
- [ ] Test: End session, leave chart visible, check memory over time
- [ ] Test: Verify chart shows final state after session ends

## Testing Plan

1. **Manual test:** Start session, add participants, let them drop out, wait for session to end
2. **Memory check:** Open DevTools Memory tab, take heap snapshot after session ends
3. **Wait 10 minutes:** Take another heap snapshot, compare sizes
4. **Verify no growth:** Memory should be stable (not increasing)

## Files to Modify

1. `frontend/src/context/FitnessContext.jsx` - WebSocket gating
2. `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx` - Freeze logic

## Revised Approach: Telemetry + Defensive Fixes

Since the issue only occurs after hours in kiosk mode and is hard to reproduce, we need:

### Part A: Enhanced Telemetry

Add logging to catch the issue next time:

**1. Timer lifecycle logging**

Track when intervals are created/destroyed:
```javascript
// In FitnessContext.jsx, wrap setInterval calls
const createTrackedInterval = (name, callback, ms) => {
  const id = setInterval(callback, ms);
  logger.debug('interval-created', { name, ms, id });
  return id;
};
```

**2. Session state change logging**

Log when session transitions:
```javascript
// In FitnessContext.jsx heartbeat effect
useEffect(() => {
  logger.info('session-state-check', {
    sessionId: sessionId || null,
    hasSession: !!sessionId
  });
  if (!sessionId) {
    logger.info('session-inactive-heartbeat-skipped');
    return;
  }
  // ... existing interval code
}, [forceUpdate, sessionId]);
```

**3. Effect execution counting**

Track how often key effects fire:
```javascript
// Add at top of FitnessContext
const effectCountsRef = useRef({});
const logEffect = (name) => {
  effectCountsRef.current[name] = (effectCountsRef.current[name] || 0) + 1;
};

// Then in each effect:
useEffect(() => {
  logEffect('updateSnapshot');
  // ... existing code
}, [...deps]);

// Log every 30 seconds in the profiler
logger.info('effect-counts', effectCountsRef.current);
```

**4. Data structure size logging**

Track sizes of key structures:
```javascript
// Add to the existing 30-second profiler in FitnessApp.jsx
const chartStats = window.__fitnessChartStats?.() || {};
logger.info('fitness-profile', {
  // ... existing fields
  chartCacheSize: chartStats.participantCacheSize,
  dropoutMarkerCount: chartStats.dropoutMarkerCount,
  persistedSize: chartStats.persistedSize
});
```

### Part B: Defensive Fixes

**1. Gate WebSocket processing on sessionId**
```javascript
// FitnessContext.jsx:964-975
if (session && session.sessionId) {  // Add sessionId check
  session.ingestData(data);
  forceUpdate();
}
```

**2. Clear GovernanceEngine callbacks on reset**
```javascript
// GovernanceEngine.js reset() method
reset() {
  this._clearTimers();
  this.callbacks = {          // ADD: Clear callbacks
    onPhaseChange: null,
    onPulse: null
  };
  this.meta = { ... };
}
```

**3. Add sessionId check to updateSnapshot effect**
```javascript
// FitnessContext.jsx:1723-1739
useEffect(() => {
  const session = fitnessSessionRef.current;
  if (!session?.sessionId) return;  // ADD: Skip if no active session
  if (!session || typeof session.updateSnapshot !== 'function') return;
  // ... rest of effect
}, [users, fitnessDevices, fitnessPlayQueue, participantRoster, zoneConfig]);
```

**4. Add max size limit to dropoutMarkers**
```javascript
// FitnessChartApp.jsx useRaceChartWithHistory
const MAX_DROPOUT_MARKERS = 50;
if (dropoutMarkers.length > MAX_DROPOUT_MARKERS) {
  dropoutMarkers = dropoutMarkers.slice(-MAX_DROPOUT_MARKERS);
}
```

## Implementation Priority

1. **Part B fixes first** - These are defensive and low-risk
2. **Part A telemetry second** - Helps diagnose if issue persists

## Risk Assessment

- **Low risk:** Adding sessionId checks (defensive, gating existing behavior)
- **Low risk:** Clearing callbacks on reset (prevents orphan references)
- **Low risk:** Adding telemetry (read-only logging)
- **Medium risk:** dropoutMarkers limit (could hide UI markers if limit too low)
