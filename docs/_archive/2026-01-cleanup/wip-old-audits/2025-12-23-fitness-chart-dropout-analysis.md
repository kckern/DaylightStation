# Fitness Chart Dropout/Rejoin Feature - Deep Dive Analysis

**Date:** December 23, 2025  
**Status:** Critical architecture issues identified

## Executive Summary

After extensive debugging, we've identified **fundamental architecture issues** preventing the dropout/rejoin visualization from working correctly. The system has **parallel, inconsistent implementations** that conflict with each other.

---

## The Goal (What Should Happen)

When a user drops out (device stops broadcasting) and later rejoins:

1. **Dropout Point**: A letter badge (M, A, etc.) appears at the exact point where they dropped out
2. **Gap Line**: A grey dotted FLAT horizontal line extends from the dropout point to the rejoin time
3. **Rejoin**: The colored line resumes from where they rejoin (may be at a different beat value)
4. **Avatar**: Always shows at the user's current position when active
5. **Immutability**: Dropout badges NEVER move or disappear once created

---

## Critical Issues Identified

### Issue #1: Dual Gap Segment Creation (CONFLICTING)

Two different places create gap segments with **different geometry**:

#### Source A: `buildSegments()` in FitnessChart.helpers.js
```javascript
// Creates HORIZONTAL gap (same value, different ticks)
const gapSegment = {
  isGap: true,
  points: [
    { i: gapStartPoint.i, v: gapStartPoint.v },
    { i: currentTick, v: gapStartPoint.v }  // ← SAME VALUE = flat line
  ]
};
```

#### Source B: `useRaceChartWithHistory` useEffect in FitnessChartApp.jsx
```javascript
// Creates DIAGONAL gap (different values)
const gapSegment = {
  isGap: true,
  points: [
    { i: prevEntry.lastSeenTick, v: prevEntry.lastValue },
    { i: firstNewIdx, v: entry.beats[firstNewIdx] }  // ← DIFFERENT VALUE = diagonal
  ]
};
```

**Result**: Inconsistent visualization depending on which code path executes.

---

### Issue #2: Data Flow Disconnect

The data flows through too many transformations where information is lost:

```
Device Broadcast
    ↓
FitnessSession.ingestData()     ← Device metrics received
    ↓
userManager.getAllUsers()        ← Only CURRENT users returned
    ↓
_collectTimelineTick()           ← Tries to record null for missing users
    ↓
FitnessTimeline.tick()           ← Stores in series arrays
    ↓
getSeries('heart_rate')          ← Chart retrieves data
    ↓
buildBeatsSeries()               ← Builds active[] array from HR nulls
    ↓
buildSegments()                  ← Creates segments based on active[]
    ↓
useRaceChartWithHistory()        ← ALSO creates gap segments (duplicate!)
    ↓
createPaths()                    ← Converts to SVG paths
    ↓
RaceChartSvg                     ← Renders
```

**Problem**: The null recording in `_collectTimelineTick()` only works if:
1. The user was previously in `_cumulativeBeats` (had beats > 0)
2. The user is NOT in the current `userMetricMap`

But `userMetricMap` is built from `userManager.getAllUsers()` which may still include the user even if their device stopped broadcasting!

---

### Issue #3: Roster vs Device Activity Confusion

The system conflates two different concepts:

| Concept | What It Means | Data Source |
|---------|---------------|-------------|
| **In Roster** | User is registered for the session | `userManager.getAllUsers()` |
| **Device Active** | User's device is broadcasting HR data | `device.lastData?.heartRate` |

**Current bug**: A user can be "in roster" but their device not broadcasting. The code checks roster membership, not device activity, to determine if user dropped out.

```javascript
// FitnessSession._collectTimelineTick() 
const users = this.userManager.getAllUsers();  // ← Gets roster, not active devices
users.forEach((user) => {
  const staged = stageUserEntry(user);  // ← User is in roster, so gets entry
  if (staged) {
    userMetricMap.set(staged.slug, staged);  // ← Even if no HR data!
  }
});
```

---

### Issue #4: `active` Array Never Has False Values

The `active` array in `buildBeatsSeries()` is built from `heart_rate` series:

```javascript
const heartRate = getSeries(targetId, 'heart_rate', { clone: true }) || [];
const active = [];
for (let i = 0; i < maxLen; i++) {
  const hr = heartRate[i];
  active[i] = hr != null && Number.isFinite(hr) && hr > 0;
}
```

**But**: `heart_rate` rarely has null values because:
1. User stays in roster even when device stops
2. `stageUserEntry()` creates entry with `heartRate: null` OR last known value
3. The null recording in `_collectTimelineTick()` doesn't trigger because user is still in `userMetricMap`

**Evidence**: Debug logs showed `active` array is always all `true`, never detecting dropouts.

---

### Issue #5: ActivityMonitor Exists But Ignored

There's a newer `ActivityMonitor` class that properly tracks activity:

```javascript
// FitnessSession.js line 850-852
if (this.activityMonitor) {
  this.activityMonitor.recordTick(currentTickIndex, activeParticipantIds, { timestamp });
}
```

But `buildBeatsSeries()` **ignores it**:

```javascript
// Comment in buildBeatsSeries():
// Build "active" mask - always use heart_rate as primary source for reliability
// ActivityMonitor may not have complete history, especially for historical participants
```

**The ActivityMonitor has the correct activity data but it's not used!**

---

### Issue #6: No Event-Based Dropout/Rejoin Tracking

The system tries to INFER dropout from data patterns instead of tracking explicit events:

| Approach | Description | Problem |
|----------|-------------|---------|
| **Current** | Look for null in heart_rate series | Nulls rarely recorded |
| **Current** | Look for flat beats (removed) | Blue zone also flat |
| **Better** | Explicit dropout/rejoin events | Not implemented |

What's needed:

```javascript
// Example of event-based tracking
session.emit('participant:dropout', { userId, tick, lastValue });
session.emit('participant:rejoin', { userId, tick, newValue });
```

---

## Data Model Analysis

### Current Data Model

```javascript
// Timeline series per user
timeline.series = {
  'user:milo:heart_rate': [72, 75, 78, null, null, 82, ...],  // Rarely has nulls
  'user:milo:heart_beats': [0, 2, 5, 8, 8, 8, 12, ...],       // Cumulative
  'user:milo:coins_total': [0, 2, 5, 8, 8, 8, 12, ...],       // From TreasureBox
  'user:milo:zone_id': ['green', 'green', 'blue', ...],
};

// Participant cache in chart
participantCache = {
  'milo': {
    id: 'milo',
    status: 'active' | 'removed',
    dropoutMarkers: [{ tick: 45, value: 23, timestamp: ... }],
    lastSeenTick: 102,
    lastValue: 56,
    segments: [...],
    beats: [...],
  }
};
```

### Missing Data Model Elements

```javascript
// What's MISSING - explicit dropout events stored in timeline
timeline.series = {
  'user:milo:dropout_events': [
    null, null, ..., 
    { type: 'dropout', value: 23 },  // At tick where dropout occurred
    null, null, ...,
    { type: 'rejoin' },              // At tick where rejoin occurred
  ]
};

// OR a separate event log
session.dropoutEvents = [
  { userId: 'milo', type: 'dropout', tick: 45, value: 23 },
  { userId: 'milo', type: 'rejoin', tick: 78 },
];
```

---

## Proposed Architecture Fix

### Option A: Fix the Null Recording (Minimal Change)

**Problem**: `userMetricMap` includes users who are in roster but not actively broadcasting.

**Fix**: Check if user's **device** is active, not just if user is in roster.

```javascript
// In _collectTimelineTick(), change how we detect active users:

// OLD: Uses roster membership
const users = this.userManager.getAllUsers();
users.forEach((user) => {
  const staged = stageUserEntry(user);
  if (staged) userMetricMap.set(staged.slug, staged);
});

// NEW: Check actual device activity
const users = this.userManager.getAllUsers();
users.forEach((user) => {
  const staged = stageUserEntry(user);
  if (!staged) return;
  
  // Check if device is actually broadcasting
  const hasActiveDevice = staged.metrics.heartRate != null && 
                          Number.isFinite(staged.metrics.heartRate) && 
                          staged.metrics.heartRate > 0;
  
  if (hasActiveDevice) {
    userMetricMap.set(staged.slug, staged);
  } else if (this._cumulativeBeats.get(staged.slug) > 0) {
    // Was active before, not now = record null
    assignMetric(`user:${staged.slug}:heart_rate`, null);
  }
});
```

### Option B: Use ActivityMonitor (Better)

ActivityMonitor already tracks this correctly. Use it!

```javascript
// In buildBeatsSeries, USE the ActivityMonitor:
if (options.activityMonitor && typeof options.activityMonitor.getActivityMask === 'function') {
  const mask = options.activityMonitor.getActivityMask(targetId);
  // Only use if it has meaningful data
  if (mask.length > 0 && mask.some(v => v === true)) {
    return { beats, zones, active: mask };
  }
}
// Fall back to heart_rate detection only if ActivityMonitor has no data
```

### Option C: Event-Based System (Best, Most Work)

Add explicit dropout/rejoin event tracking:

```javascript
// In FitnessSession, track device state changes:
class FitnessSession {
  constructor() {
    this._userDeviceState = new Map();  // userId -> { active: boolean, lastTick: number, lastValue: number }
    this._dropoutEvents = [];
  }

  _detectDropoutRejoin(userId, tick, currentValue) {
    const prevState = this._userDeviceState.get(userId);
    const isActive = currentValue != null && currentValue > 0;
    
    if (prevState?.active && !isActive) {
      // DROPOUT: was active, now not
      this._dropoutEvents.push({
        type: 'dropout',
        userId,
        tick: prevState.lastTick,
        value: prevState.lastValue,
        timestamp: Date.now()
      });
      // Store in timeline for persistence
      this.timeline.tick({ [`user:${userId}:dropout`]: { type: 'dropout', value: prevState.lastValue } });
    }
    
    if (!prevState?.active && isActive) {
      // REJOIN: was inactive, now active
      this._dropoutEvents.push({
        type: 'rejoin',
        userId,
        tick,
        timestamp: Date.now()
      });
    }
    
    this._userDeviceState.set(userId, { active: isActive, lastTick: tick, lastValue: currentValue });
  }
}
```

---

## Immediate Action Items (Pick ONE)

### Quick Fix: Make Null Recording Work

1. In `_collectTimelineTick()`, check `staged.metrics.heartRate` not just roster membership
2. Record null for users whose HR is null/undefined/0 but who have cumulative beats
3. Remove gap creation from `useRaceChartWithHistory` (let `buildSegments` handle it)

### Better Fix: Use ActivityMonitor

1. Pass `activeParticipantIds` Set to timeline as a series
2. In `buildBeatsSeries`, build `active` from this set instead of HR nulls
3. ActivityMonitor already has correct logic for detecting dropouts

### Best Fix: Event-Based Tracking

1. Add `_detectDropoutRejoin()` method to FitnessSession
2. Store dropout/rejoin events in timeline
3. Build gap segments from events, not inference

---

## Single Source of Truth Principle

**Current Problem**: Gap information exists in multiple places:
- `heart_rate` null values (rarely present)
- `buildSegments()` gap creation
- `useRaceChartWithHistory` gap creation  
- `dropoutMarkers` array
- `ActivityMonitor` status

**Solution**: Choose ONE:
1. Timeline-based: `heart_rate` nulls → `active` array → `buildSegments`
2. Monitor-based: `ActivityMonitor` → `getActivityMask()` → `buildSegments`
3. Event-based: Explicit dropout events → Direct gap segment creation

---

## Files Involved

| File | Role | Issue |
|------|------|-------|
| `FitnessSession.js` | Records timeline data | Null recording not triggering |
| `FitnessTimeline.js` | Stores tick data | Works correctly |
| `FitnessChart.helpers.js` | Builds segments | `active` array always true |
| `FitnessChartApp.jsx` | Manages cache, renders | Duplicate gap creation |
| `ActivityMonitor.js` | Tracks activity | Exists but ignored |
| `ParticipantStatus.js` | Status enum | Works correctly |

---

## Conclusion

The feature doesn't work because:

1. **Null values are rarely recorded** - The condition for recording null checks roster membership, not device activity
2. **Two places create gaps differently** - `buildSegments` and `useRaceChartWithHistory` conflict
3. **ActivityMonitor is bypassed** - The correct data exists but isn't used
4. **No explicit event system** - System tries to infer state from data patterns

**Root Cause**: The system was designed to infer dropout from data absence, but the data pipeline ensures data is rarely absent (roster-based, not device-based).

**Recommended Fix**: Option A (minimal) - Fix the null recording condition in `_collectTimelineTick()` to check device heartRate value, not roster membership. Then remove duplicate gap creation from `useRaceChartWithHistory`.

---

## Implementation Plan

### Phase 1: Fix Null Recording in Timeline (Core Fix)

**Goal**: Ensure `heart_rate` series has `null` values when a user's device stops broadcasting.

#### Step 1.1: Track Device Activity State

**File**: `frontend/src/hooks/fitness/FitnessSession.js`

Add a new instance variable to track which users had active HR data last tick:

```javascript
// In constructor or initialization
this._lastTickActiveHR = new Set();  // Users who had valid HR data last tick
```

#### Step 1.2: Modify `_collectTimelineTick()` Logic

**File**: `frontend/src/hooks/fitness/FitnessSession.js`

Replace the current null-recording logic with device-activity-based detection:

```javascript
// BEFORE processing userMetricMap, determine who has active HR this tick
const currentTickActiveHR = new Set();

userMetricMap.forEach((entry, slug) => {
  const hr = entry.metrics?.heartRate;
  const hasValidHR = hr != null && Number.isFinite(hr) && hr > 0;
  if (hasValidHR) {
    currentTickActiveHR.add(slug);
  }
});

// Record null for users who HAD active HR last tick but DON'T this tick
this._lastTickActiveHR.forEach((slug) => {
  if (!currentTickActiveHR.has(slug)) {
    // User's device stopped broadcasting - record null
    assignMetric(`user:${slug}:heart_rate`, null);
  }
});

// Update tracking for next tick
this._lastTickActiveHR = currentTickActiveHR;

// Continue with normal processing...
userMetricMap.forEach((entry, slug) => {
  // ... existing logic, but only record heart_rate if valid
  if (currentTickActiveHR.has(slug)) {
    assignMetric(`user:${slug}:heart_rate`, entry.metrics.heartRate);
  }
  // ... rest of metrics
});
```

#### Step 1.3: Remove Redundant Null Recording

Remove the existing null-recording code that checks roster membership:

```javascript
// REMOVE THIS BLOCK (around lines 795-813):
// const wasActiveParticipant = this._cumulativeBeats.has(slug) && prevBeats > 0;
// if (!hasNumericSample(entry.metrics)) {
//   if (wasActiveParticipant) {
//     assignMetric(`user:${slug}:heart_rate`, null);
//   }
//   return;
// }
```

---

### Phase 2: Single Source of Truth for Gap Segments

**Goal**: Only `buildSegments()` creates gap segments. Remove duplicate creation from `useRaceChartWithHistory`.

#### Step 2.1: Remove Gap Segment Creation from useRaceChartWithHistory

**File**: `frontend/src/modules/Fitness/FitnessApps/apps/FitnessChartApp/FitnessChartApp.jsx`

In the `useEffect` that processes `presentEntries`, remove the gap segment creation:

```javascript
// REMOVE this entire block (around lines 242-266):
// if (prevEntry && !isBroadcasting(prevEntry.status) && prevEntry.lastValue != null && ...) {
//   const firstNewIdx = findFirstFiniteAfter(...);
//   if (firstNewIdx != null) {
//     const gapSegment = { ... };
//     segments = [gapSegment, ...segments];
//   }
// }
```

Instead, just use the segments from `buildSegments()` directly:

```javascript
next[id] = {
  ...prevEntry,
  ...entry,
  segments: entry.segments,  // Use segments as-is from buildSegments
  // ... rest of properties
};
```

#### Step 2.2: Keep Dropout Markers Logic

The `dropoutMarkers` array creation should remain - it's used for badge positioning, not gap segments:

```javascript
// KEEP this logic for creating dropout markers (for badges):
const newMarker = {
  tick: prevEntry.lastSeenTick,
  value: prevEntry.lastValue,
  timestamp: Date.now()
};
if (!isDuplicate) {
  dropoutMarkers.push(newMarker);
}
```

---

### Phase 3: Verify buildSegments Gap Creation

**Goal**: Ensure `buildSegments()` correctly creates FLAT horizontal gap segments.

#### Step 3.1: Verify Gap Segment Geometry

**File**: `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js`

Confirm the gap segment creates a FLAT line (already implemented):

```javascript
// Gap segment should be HORIZONTAL (same value at both points)
const gapSegment = {
  zone: null,
  color: getZoneColor(null),
  status: ParticipantStatus.IDLE,
  isGap: true,
  points: [
    { i: gapStartPoint.i, v: gapStartPoint.v },
    { i: currentTick, v: gapStartPoint.v }  // ← SAME VALUE = flat line
  ]
};
```

#### Step 3.2: Add Debug Logging (Temporary)

Add temporary logging to verify gaps are being created:

```javascript
if (inGap && gapStartPoint) {
  console.log('[buildSegments] Creating gap:', {
    userId: 'from context',
    fromTick: gapStartPoint.i,
    toTick: i,
    value: gapStartPoint.v,
    reason: 'active[i] transitioned from false to true'
  });
  // ... create gapSegment
}
```

---

### Phase 4: Testing Checklist

#### Manual Test Scenarios

1. **Basic Dropout/Rejoin**
   - Start session with 2 users
   - Stop one user's HR device
   - Verify: Letter badge appears at dropout point
   - Verify: Line stops growing (stays flat)
   - Resume user's HR device
   - Verify: Badge stays at original position (IMMUTABLE)
   - Verify: Grey dotted FLAT line from badge to rejoin point
   - Verify: Colored line resumes from rejoin point

2. **Multiple Dropouts**
   - User drops out, rejoins, drops out again
   - Verify: TWO badges appear (one per dropout)
   - Verify: TWO gap segments (one per dropout period)

3. **Session Restart**
   - Verify dropout detection works from session start (not just after warm-up)

#### Debug Verification Points

Add console logging at each stage:

```javascript
// In FitnessSession._collectTimelineTick():
console.log('[Timeline] Tick', tickIndex, 'activeHR:', [...currentTickActiveHR], 'nullRecorded:', [...nullRecordedUsers]);

// In buildBeatsSeries:
console.log('[buildBeatsSeries]', userId, 'active array false count:', active.filter(a => !a).length);

// In buildSegments:
console.log('[buildSegments]', 'gap segments created:', segments.filter(s => s.isGap).length);
```

---

### Phase 5: Cleanup

After verification, remove:

1. All debug `console.log` statements
2. The guardrail `useEffect` in FitnessChartApp (or keep as opt-in debug)
3. Any unused imports or variables

---

### File Change Summary

| File | Changes |
|------|---------|
| `FitnessSession.js` | Add `_lastTickActiveHR` tracking, modify null recording logic |
| `FitnessChartApp.jsx` | Remove gap segment creation from useEffect, keep dropout markers |
| `FitnessChart.helpers.js` | No changes (already correct), add temp debug logging |

### Estimated Effort

- Phase 1: 30 minutes (core fix)
- Phase 2: 15 minutes (remove duplicate code)
- Phase 3: 10 minutes (verify existing code)
- Phase 4: 30 minutes (testing)
- Phase 5: 10 minutes (cleanup)

**Total: ~1.5 hours**

---

### Rollback Plan

If issues arise, revert changes in this order:
1. Restore gap creation in `useRaceChartWithHistory` (Phase 2 revert)
2. Restore original null recording logic in `_collectTimelineTick` (Phase 1 revert)

The feature will return to current (non-working) state but won't break anything else.
