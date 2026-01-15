# Fitness Chart Memory Leak Fix

**Date:** 2026-01-14
**Status:** Implemented
**Related code:** `frontend/src/modules/Fitness/`

## Problem Statement

Production fitness sessions were crashing after ~47 minutes with:
- Browser heap growing from 14.6 MB to 722 MB (~15 MB/minute)
- `ReferenceError: intervalMs is not defined` in FitnessChart useMemo
- Abrupt termination without graceful shutdown (OOM kill)

## Root Cause Analysis

### Primary Issue: Unstable `roster` Reference

The `get roster()` accessor in `FitnessSession.js` created new array/objects on every access:

```javascript
// BEFORE: New array created on every read
get roster() {
  return this._participantRoster.getRoster(); // NEW array every time
}
```

**Impact:** Any `useMemo([roster])` dependency saw "changed" on every React render cycle (60fps), triggering:
- Full recalculation of chart data hooks
- Multiple array clones via `getSeries({ clone: true })`
- ~5,040 short-lived arrays per second
- GC unable to keep up with allocation rate

### Secondary Issue: Aggressive Array Cloning

`buildBeatsSeries()` in `FitnessChart.helpers.js` requested cloned arrays:

```javascript
const zones = getSeriesForParticipant('zone_id', { clone: true });
const heartRate = getSeriesForParticipant('heart_rate', { clone: true });
```

Even when `roster` was stable, each chart rebuild created 84+ array copies.

### Tertiary Issue: Scope Vulnerability

`intervalMs` was defined at component scope but used inside `useMemo`. Under heavy GC pressure (670+ MB heap), V8's emergency GC could interrupt execution, causing scope resolution failures.

## Solution

### Fix 1: Roster Caching (Read-Through Cache Pattern)

Added `_rosterCache` to `FitnessSession.js` with invalidation on data changes:

```javascript
get roster() {
  // 1. Return cached value if available
  if (this._rosterCache) {
    return this._rosterCache;
  }

  // 2. Generate roster (delegate or legacy path)
  let roster;
  if (this._participantRoster && this._participantRoster._deviceManager) {
    roster = this._participantRoster.getRoster();
  } else {
    roster = []; // ... legacy build logic
  }

  // 3. Cache and return
  this._rosterCache = roster;
  return roster;
}
```

**Invalidation points:**
- `ingestData()` - device data arrives
- `setParticipantRoster()` - roster composition changes
- `updateSnapshot()` - snapshot sync

### Fix 2: Remove Unnecessary Cloning

Removed `{ clone: true }` from `buildBeatsSeries()` calls:

```javascript
// AFTER: No clone, treat as read-only
const zones = getSeriesForParticipant('zone_id');
const heartRate = getSeriesForParticipant('heart_rate');
const coinsRaw = getSeriesForParticipant('coins_total');
const beatsRaw = getSeriesForParticipant('heart_beats');
```

**Safety:** These arrays are only read, never mutated. Downstream functions like `fillEdgesOnly()` create their own copies.

### Fix 3: Inline intervalMs in useMemo

Moved `intervalMs` calculation inside the `xTicks` useMemo:

```javascript
const xTicks = useMemo(() => {
  // Defensive: calculate inside useMemo to ensure always in scope
  const intervalMsLocal = Number(timebase?.intervalMs) > 0 ? Number(timebase.intervalMs) : 5000;
  const totalMs = effectiveTicks * intervalMsLocal;
  // ...
}, [effectiveTicks, timebase?.intervalMs, chartWidth]);
```

### Fix 4: Series Point Safety Caps

Added hard limits to prevent unbounded data accumulation:

```javascript
const MAX_SERIES_POINTS = 1000;  // ~83 minutes at 5s intervals
const MAX_TOTAL_POINTS = 50000;  // Global cap across all series

// In useRaceChartData - trim per series
if (beats.length > MAX_SERIES_POINTS) {
  beats = beats.slice(-MAX_SERIES_POINTS);
  zones = zones.slice(-MAX_SERIES_POINTS);
  active = active.slice(-MAX_SERIES_POINTS);
}
```

### Fix 5: Throttled Warnings

Prevent hot path console.warn penalty:

```javascript
const throttledWarn = useCallback((key, message) => {
  const now = Date.now();
  if (!warnThrottleRef.current[key] || now - warnThrottleRef.current[key] > 5000) {
    console.warn(message);
    warnThrottleRef.current[key] = now;
  }
}, []);
```

### Fix 6: Object Creation Optimization

Only create new objects when status actually differs:

```javascript
if (entry.status === correctStatus) {
  return entry; // Same reference - no re-render triggered
}
return { ...entry, status: correctStatus };
```

## Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Heap growth rate | ~15 MB/min | ~0.1 MB/min |
| useMemo recalculations | 60/sec | Only on data change |
| Array allocations | ~5,040/sec | ~1/sec |
| Session stability | Crash at ~47 min | Indefinite |

## Files Modified

- `frontend/src/hooks/fitness/FitnessSession.js` - Roster caching
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js` - Remove clone: true
- `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx` - Inline intervalMs

## Testing

1. Run fitness session for 2+ hours with 6 participants
2. Monitor browser DevTools Performance tab for heap growth
3. Verify chart updates correctly when participants join/leave
4. Verify no `intervalMs` errors in console

## References

- Production logs: `logs/prod-session-summary-20260114.md`
- Raw logs: `logs/prod-logs-20260114-144536.log`
