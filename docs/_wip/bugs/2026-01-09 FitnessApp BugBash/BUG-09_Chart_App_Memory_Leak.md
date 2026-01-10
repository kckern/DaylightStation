# BUG-09: Chart App Memory Leak

**Date Reported:** 2026-01-09  
**Category:** 📉 Stability & Performance  
**Priority:** Critical  
**Status:** Open

---

## Summary

Leaving the **Chart App** open for an extended duration and then returning causes the browser/webview to crash or freeze, requiring a reboot.

## Expected Behavior

Chart App should maintain stable memory usage over time and remain responsive regardless of session duration.

## Current Behavior

Browser/webview crashes or freezes after extended Chart App usage, indicating a memory leak.

---

## Technical Analysis

### Relevant Components

| File | Purpose |
|------|---------|
| [`FitnessChartApp.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx) | Main chart app component (1092 lines) |
| [`useRaceChartData`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx#L55-L207) | Hook building race chart data |
| [`useRaceChartWithHistory`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx#L228-L493) | Hook with historical participant support |

### Known Memory Leak Vectors

Based on the existing audit ([`2026-01-03-FitnessChartApp-Rendering-Audit.md`](file:///Users/kckern/Documents/GitHub/DaylightStation/docs/_wip/audits/2026-01-03-FitnessChartApp-Rendering-Audit.md)):

1. **Unbounded Timeline Accumulation**: Chart data structures grow without cleanup
2. **Unclosed Event Listeners**: Potential event listener registration without cleanup
3. **Large useMemo Dependencies**: Complex useMemo hooks may retain references

### Potential Leak Sources in FitnessChartApp.jsx

**1. Historical Data Accumulation (lines 228-493)**

`useRaceChartWithHistory` maintains historical participant data:
```javascript
// This may accumulate unbounded data over time
const historicalParticipantIds = [...]; // Check if this grows indefinitely
```

**2. Missing Cleanup in useEffect Hooks**

Look for effects without proper cleanup:
```javascript
useEffect(() => {
  // Setup code
  const interval = setInterval(...);
  
  // Missing: return () => clearInterval(interval);
}, [dependencies]);
```

**3. SVG Element Accumulation**

With long sessions, the SVG may accumulate path elements:
```javascript
// In RaceChartSvg - check path generation
const paths = useMemo(() => {
  // If paths array grows without bounds, memory increases
}, [data]);
```

**4. Timeline Series Data**

In `useRaceChartData`, timeline data may accumulate:
```javascript
const getSeries = timelineSeries.getSeries; // Check data structure
```

### Prior Fix Attempts

The audit mentions (line 257):
> "Commented design notes: Lines 204-206 Reference to 'Phase 3 transition' never completed"

And indicates possible prior work:
> "`options.sessionId` - Session ID to clear cache when session changes (memory leak fix)"

---

## Recommended Investigation

### Step 1: Profile Memory Usage

1. Open Chrome DevTools → Memory tab
2. Start Chart App
3. Take heap snapshot (baseline)
4. Wait 5-10 minutes with active session
5. Take second snapshot
6. Compare for retained objects

### Step 2: Check for Common Leak Patterns

```javascript
// Search for patterns like:
setInterval(  // Without corresponding clearInterval
addEventListener( // Without corresponding removeEventListener
useRef( // With mutable arrays that grow
```

### Step 3: Review Cache Management

```javascript
// In useRaceChartWithHistory, verify sessionId triggers cache clear
useEffect(() => {
  if (options.sessionId !== previousSessionId) {
    clearCaches(); // Ensure this exists and runs
  }
}, [options.sessionId]);
```

---

## Recommended Fix

### Fix 1: Session-Based Cache Reset

Ensure caches clear when session changes:

```javascript
// In FitnessChartApp.jsx
const sessionId = fitnessCtx?.fitnessSessionInstance?.sessionId;

useEffect(() => {
  // Clear accumulated data on session change
  return () => {
    historicalDataRef.current = new Map();
    timelineDataRef.current = [];
  };
}, [sessionId]);
```

### Fix 2: Bounded Timeline Window

Limit timeline data to a rolling window:

```javascript
const MAX_TIMELINE_POINTS = 1000; // ~15 minutes at 1/sec

const addTimelinePoint = useCallback((point) => {
  setTimelineData(prev => {
    const updated = [...prev, point];
    if (updated.length > MAX_TIMELINE_POINTS) {
      return updated.slice(-MAX_TIMELINE_POINTS); // Keep most recent
    }
    return updated;
  });
}, []);
```

### Fix 3: Cleanup Event Listeners

Audit all useEffect hooks and ensure cleanup:

```javascript
useEffect(() => {
  const handleResize = () => updateSize();
  window.addEventListener('resize', handleResize);
  
  return () => {
    window.removeEventListener('resize', handleResize); // Required
  };
}, []);
```

### Fix 4: Weak References for Participant Data

Consider WeakMap for participant references:

```javascript
const participantCache = useRef(new WeakMap());
// Allows garbage collection when participants are no longer referenced
```

---

## Files to Modify

1. **Primary**: [`FitnessChartApp.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx)
   - Audit all useEffect hooks for proper cleanup
   - Implement bounded data structures
   - Add session-based cache clearing

2. **Review**: Related timeline and chart data hooks

---

## Verification Steps

1. Open Chart App in Chrome with DevTools open
2. Monitor Memory tab over extended period (15+ minutes)
3. Verify memory usage remains stable (not continuously growing)
4. Test with multiple session starts/stops
5. Verify no crash on extended usage (1+ hour)

---

## Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Initial Memory | < 50 MB | TBD |
| Memory after 15 min | < 75 MB | TBD (may crash) |
| Memory after 1 hour | < 100 MB | TBD (crashes) |
| Memory growth rate | < 1 MB/min | Unknown |

---

## Priority Note

> [!CAUTION]
> This is a **Critical** bug as it causes application crashes requiring device reboot. Prioritize investigation and fix.

---

## Related Documentation

- [FitnessChartApp Rendering Audit](file:///Users/kckern/Documents/GitHub/DaylightStation/docs/_wip/audits/2026-01-03-FitnessChartApp-Rendering-Audit.md) - Previous audit with architectural findings

---

*For testing, assign to: QA Team (long-duration testing)*  
*For development, assign to: Frontend Team (Performance specialist)*
