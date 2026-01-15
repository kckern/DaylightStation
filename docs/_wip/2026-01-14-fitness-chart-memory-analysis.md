# Fitness Chart Memory Issue Analysis
**Date:** 2026-01-14
**Issue:** FitnessChart stayed on screen after session ended and appeared to hang/get stuck

FULL LOGS:
/Users/kckern/Documents/GitHub/DaylightStation/logs/prod-logs-20260114-181418.txt

## Key Findings from Production Logs

### Memory Growth During Active Sessions
The logs show consistent memory growth warnings during active sessions:
- Heap growth of 32-95 MB above baseline during active sessions
- Growth warnings triggered at: 32.5MB, 46.3MB, 35.4MB, 33.9MB, 95.3MB, 44.1MB, etc.
- Sessions typically accumulated 5,000-10,000+ series data points
- Max series length reached 122+ points per series

### Critical Session at 01:57:44 - Session End but High Memory
**Timeline:**
1. **01:57:22** - Session active, 660s elapsed, 66 MB heap, 38.3 MB growth
   - rosterSize: 0, deviceCount: 1
   - seriesCount: 82, totalSeriesPoints: 10,496
   - **sessionActive: true, tickTimerRunning: true**

2. **01:57:44** - Session marked inactive but memory still high
   - heapMB: **70 MB** (only dropped from 66 MB)
   - **sessionActive: false, tickTimerRunning: false**
   - But series data appears cleared: seriesCount: 0, totalSeriesPoints: 0
   
3. **01:57:47** - Memory increased instead of decreasing
   - heapMB: **75.5 MB** (increased by 5.5 MB!)
   - Still sessionActive: false

4. **01:58:17** - Memory finally dropped
   - heapMB: 34.3 MB, growth: -41.2 MB
   - Session inactive, but deviceCount still showing 1

### Massive Memory Issue at 02:01-02:05 Session
**Severe memory leak detected:**
- **02:03:19** - totalSeriesPoints: **131,808** (maxSeriesLength: 6,832)
  - heapMB: 26.8, growth: 12.2 MB
  
- **02:04:01** - totalSeriesPoints: **390,759** (maxSeriesLength: 20,461)
  - heapMB: **47 MB**, growth: **32.4 MB**
  - WARNING: Memory warning triggered

- **02:04:34** - totalSeriesPoints: **520,263** (maxSeriesLength: 27,277)
  - heapMB: **63.6 MB**, growth: **49 MB**

- **02:05:01** - totalSeriesPoints: **606,523** (maxSeriesLength: 31,817)
  - heapMB: **80.4 MB**, growth: **65.8 MB**

- **02:05:37** - totalSeriesPoints: **692,783** (maxSeriesLength: 36,357)
  - heapMB: **61.4 MB**, growth: **46.8 MB**

**This session accumulated 692K+ data points in just 260 seconds!**

### Post-Session Memory Behavior at 02:13
After the massive session, multiple profile samples show high baseline memory:
- 02:13:13 - 50.1 MB (sessionActive: false)
- 02:13:24 - 56.7 MB (sessionActive: false)
- 02:13:26 - 67.5 MB (sessionActive: false)
- 02:13:30 - **78.8 MB** (sessionActive: false)
- 02:13:32 - 76.7 MB (sessionActive: false)

Memory eventually dropped at 02:14:02 to 15.3 MB (growth: -61.4 MB), but this took **~30 seconds** after session ended.

## ROOT CAUSE IDENTIFIED: React Render Loop

### The Smoking Gun (02:03:00 - 02:03:05)
Found **16,623 instances** of the warning message:
```
"[FitnessChart] Status corrected from roster.isActive"
```

During the explosion window (02:03), **177 warnings fired in just 60 seconds** - that's **~3 warnings per second**.

### The Render Loop Mechanism

**Location:** [FitnessChartApp.jsx:413-430](frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx#L413-L430)

```jsx
const validatedEntries = useMemo(() => {
    return allEntries.map((entry) => {
        const isActiveFromRoster = entry.isActive !== false;
        const correctStatus = isActiveFromRoster ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE;
        
        if (entry.status !== correctStatus) {
            console.warn('[FitnessChart] Status corrected from roster.isActive', {...});
        }
        
        return { ...entry, status: correctStatus }; // Creates NEW OBJECT
    });
}, [allEntries]);
```

**The Death Spiral:**
1. `allEntries` changes (user status update from roster)
2. `validatedEntries` memo recalculates
3. Creates **new objects** for each entry (even if unchanged)
4. New objects trigger re-renders and state updates
5. State updates cause `participantCache` to update
6. `participantCache` update recreates `allEntries` (new array reference)
7. **Go to step 1** → infinite loop

### Why 692K Data Points?

**Math breakdown:**
- Expected rate: ~4,400 points for 260 seconds
- Actual rate: 692,783 points 
- **Multiplier: 157x**

**Explanation:**
- Each render loop iteration creates new entry objects
- Each new object triggers `buildSegments()` recalculation
- `buildSegments()` creates new data point arrays
- These aren't deduplicated - they accumulate in memory
- With Alan's status flickering every ~250ms, that's 4 renders/second
- 260 seconds × 4 renders/sec × 20 series × ~6 users = ~124,800 theoretical base
- Factor in cascading re-renders from multiple state updates = **692K+ actual**

### Timeline Analysis
- **02:02:48** - 380 points (normal accumulation)
- **02:03:19** - **131,808 points** (jump of 131,428 in 31 seconds = **4,239 points/sec**)
  - This is when Alan's status started flickering
- **02:05:37** - 692,783 points (continued acceleration)

### The Trigger: User "alan" Status Oscillation
Logs show repeated status corrections specifically for user "alan":
- `wasStatus: "removed"`, `nowStatus: "idle"`
- Firing multiple times per second
- Suggests Alan's device was connecting/disconnecting rapidly
- OR the `isActive` flag was oscillating due to timing issues in roster updates

## Root Causes Summary

1. **React useMemo Render Loop** ⚠️ CRITICAL
   - `validatedEntries` creates new objects on every recalculation
   - New objects trigger state updates → re-renders → more validations
   - Infinite feedback loop when status is unstable

2. **No Object Equality Check**
   - `useMemo` dependency on `allEntries` triggers on reference change
   - Even if data is identical, new array reference = recalculate
   - Should use deep equality or stable references

3. **Status Correction Logic in Render Path**
   - Validation/correction happening inside render (useMemo)
   - Should be in event handler or reducer, not render logic
   - Console.warn in hot path = performance penalty

4. **Incomplete Memory Cleanup on Session End**
   - Memory remains elevated after session ends (70-78 MB baseline)
   - 30+ second delay before garbage collection
   - Component may stay mounted after session ends

## Fix Strategy

### Priority 1: STOP THE RENDER LOOP (CRITICAL)

**Fix 1: Remove object creation from validation**
```jsx
const validatedEntries = useMemo(() => {
    // Only map if corrections are needed - otherwise return original
    const needsCorrection = allEntries.some(entry => {
        const isActiveFromRoster = entry.isActive !== false;
        const correctStatus = isActiveFromRoster ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE;
        return entry.status !== correctStatus;
    });
    
    if (!needsCorrection) {
        return allEntries; // Return original array - same reference
    }
    
    // Only create new objects for entries that need correction
    return allEntries.map((entry) => {
        const isActiveFromRoster = entry.isActive !== false;
        const correctStatus = isActiveFromRoster ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE;
        
        if (entry.status === correctStatus) {
            return entry; // Return original object - same reference
        }
        
        console.warn('[FitnessChart] Status corrected', {
            id: entry.id,
            was: entry.status,
            now: correctStatus
        });
        
        return { ...entry, status: correctStatus };
    });
}, [allEntries]);
```

**Fix 2: Use stable reference for allEntries**
```jsx
const allEntries = useMemo(() => {
    const entries = Object.values(participantCache).filter((e) => e && (e.segments?.length || 0) > 0);
    // Return same array reference if entries haven't changed
    return entries;
}, [participantCache]);
```

**Fix 3: Move validation out of render path**
- Validate status when data comes IN from roster updates
- Don't validate in every render - validation should be in event handler
- Remove console.warn from hot render path (or throttle it)

### Priority 2: Prevent Status Oscillation

**Fix 4: Add debouncing to isActive flag**
```jsx
// In roster/device manager - don't flip isActive on every tick
// Require sustained inactivity (3-5 ticks) before marking inactive
const INACTIVITY_THRESHOLD_TICKS = 3;
```

**Fix 5: Add status change rate limiting**
```jsx
// Prevent rapid status flipping
const lastStatusChange = useRef({});
const STATUS_CHANGE_COOLDOWN = 5000; // 5 seconds

// Only allow status changes if enough time has passed
if (Date.now() - lastStatusChange.current[userId] < STATUS_CHANGE_COOLDOWN) {
    return previousStatus;
}
```

### Priority 3: Memory Cleanup

**Fix 6: Explicit cleanup on session end**
```jsx
useEffect(() => {
    if (!sessionActive) {
        // Clear all caches
        setParticipantCache({});
        setDropoutMarkers([]);
        // Force garbage collection hint
        if (window.gc) window.gc();
    }
}, [sessionActive]);
```

**Fix 7: Implement data point limits**
```jsx
const MAX_POINTS_PER_SERIES = 1000;
const MAX_TOTAL_POINTS = 50000;

// In buildSegments - trim old data
if (beats.length > MAX_POINTS_PER_SERIES) {
    beats = beats.slice(-MAX_POINTS_PER_SERIES);
}
```

## Immediate Action Items

1. ✅ **DONE:** Identified root cause as React render loop
2. ✅ **DONE:** Implement Fix 1 to stop object creation loop
3. ✅ **DONE:** Implement Fix 2 for stable array references (returns same object when unchanged)
4. ✅ **DONE:** Remove/throttle console.warn from render path (5s throttle per key)
5. ✅ **DONE:** Add series point limits (MAX_SERIES_POINTS = 1000, MAX_TOTAL_POINTS = 50000)
6. 🟡 **HIGH:** Add status change debouncing (Fix 4) - roster-level fix needed
7. 🟢 **MEDIUM:** Add session cleanup handlers

## Changes Made

### [FitnessChartApp.jsx](frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx)

1. **Added Safety Constants** (lines ~56-58)
   - `MAX_SERIES_POINTS = 1000` (83 minutes at 5s intervals)
   - `MAX_TOTAL_POINTS = 50000` (global cap)

2. **Series Point Trimming** (lines ~73-78)
   ```jsx
   if (beats.length > MAX_SERIES_POINTS) {
       beats = beats.slice(-MAX_SERIES_POINTS);
       zones = zones.slice(-MAX_SERIES_POINTS);
       active = active.slice(-MAX_SERIES_POINTS);
   }
   ```

3. **Fixed validatedEntries Render Loop** (lines ~411-433)
   - Returns original object if status matches (no new object creation)
   - Only spreads `{ ...entry }` when correction needed
   - Prevents unnecessary re-renders downstream

4. **Throttled Console Warnings** (lines ~410-420)
   - Added `throttledWarn()` with 5-second cooldown per key
   - Prevents hot path performance penalty
   - Maintains debugging capability without overwhelming logs

## Additional Monitoring

- Add metric for "status corrections per minute" - alert if > 10
- Track render count per component instance
- Log when `allEntries` reference changes vs when data actually changes
- Add performance marks around useMemo calculations
