# Sidebar vs Chart Inactivity Divergence: Deep Dive Analysis

**Date:** December 24, 2025  
**Issue:** User goes inactive on sidebar (transparent, countdown visible) but chart doesn't show dropout until user is removed from roster

---

## Executive Summary

The sidebar and chart use **two completely different systems** to determine if a user is inactive:

| Component | Source of Truth | Timeout | Trigger |
|-----------|----------------|---------|---------|
| **Sidebar** | `device.inactiveSince` (DeviceManager) | 60 seconds | Real-time clock check |
| **Chart** | `activeParticipantIds` (FitnessSession tick) | 10 seconds (2 ticks) | Session tick processing |

The chart's dropout detection is **tick-driven and depends on `_hasDeviceDataThisTick`**, which only fires when a device actively broadcasts data. When a device stops broadcasting, the chart's `active` array doesn't update until the **next tick processes that user's lack of data**.

---

## The Two Inactivity Systems

### 1. Sidebar: DeviceManager.pruneStaleDevices()

Location: [frontend/src/hooks/fitness/DeviceManager.js#L257-L279](frontend/src/hooks/fitness/DeviceManager.js#L257-L279)

```javascript
// Called continuously via useEffect/requestAnimationFrame
if (timeSinceActivity > timeouts.inactive) {  // 60,000ms = 60 seconds
  if (!device.inactiveSince) {
    device.inactiveSince = now;  // ← SIDEBAR READS THIS
    device.removalAt = now + (timeouts.remove - timeouts.inactive);
  }
}
```

**Key characteristics:**
- **Real-time clock-based**: Checks `Date.now() - device.lastSeen`
- **Runs continuously**: Via React effect, not tied to session ticks
- **Timeout: 60 seconds** (`FITNESS_TIMEOUTS.inactive`)
- **Immediate visual feedback**: Sidebar reads `inactiveSince` directly

The sidebar then renders inactive state:
```javascript
// FitnessUsers.jsx line 914
const isInactive = device.isActive === false || !!device.inactiveSince;
```

### 2. Chart: FitnessSession._collectTimelineTick()

Location: [frontend/src/hooks/fitness/FitnessSession.js#L820-L862](frontend/src/hooks/fitness/FitnessSession.js#L820-L862)

```javascript
// Only runs every 5 seconds (tick interval)
userMetricMap.forEach((entry, slug) => {
  // CRITICAL: This flag is only set when device broadcasts data
  if (!entry._hasDeviceDataThisTick) return;
  
  const hr = entry.metrics?.heartRate;
  const hasValidHR = hr != null && Number.isFinite(hr) && hr > 0;
  if (hasValidHR) {
    currentTickActiveHR.add(slug);
  }
});
```

**Key characteristics:**
- **Tick-driven**: Only runs every 5 seconds
- **Requires device broadcast**: `_hasDeviceDataThisTick` must be true
- **Timeout: 10 seconds** (2 ticks × 5s via `idleThresholdTicks: 2`)
- **Delayed feedback**: Must wait for ActivityMonitor state machine

---

## The Timing Mismatch

### Timeline of Events (User stops broadcasting at T=0)

| Time | DeviceManager | FitnessSession | Sidebar | Chart |
|------|--------------|----------------|---------|-------|
| T=0s | `lastSeen` frozen | Tick 0: User still in `currentTickActiveHR` | Active | Active line |
| T=5s | Still within 60s | Tick 1: No `_hasDeviceDataThisTick` → not in `currentTickActiveHR` | Active | Still active (idleThreshold=2) |
| T=10s | Still within 60s | Tick 2: ActivityMonitor → IDLE | Active | **Should show dropout** |
| T=60s | `inactiveSince` set! | Tick 12: User still IDLE | **Inactive!** | Dropout (if working) |
| T=180s | Device removed | Tick 36: ActivityMonitor → REMOVED | Gone | Line ends |

### The Bug: Chart Doesn't See IDLE State

The chart calls `buildBeatsSeries()` which calls `activityMonitor.getActivityMask()`:

```javascript
// FitnessChart.helpers.js line 143-148
if (options.activityMonitor && targetId) {
  const mask = options.activityMonitor.getActivityMask(targetId, maxLen - 1) || [];
  for (let i = 0; i < maxLen; i++) {
    active[i] = mask[i] === true;
  }
}
```

But `getActivityMask()` only returns `true` for **ACTIVE** periods:

```javascript
// ActivityMonitor.js line 426-431
periods.forEach(period => {
  if (period.status === ParticipantStatus.ACTIVE) {  // ← ONLY ACTIVE!
    // ... fill mask with true
  }
});
```

So when a user transitions to **IDLE**, the mask correctly shows `false` for those ticks. **This part is working.**

---

## The Real Problem: `_hasDeviceDataThisTick` Check

The issue is in how FitnessSession determines who is active:

```javascript
// Line 824-828 - The problematic check
if (!entry._hasDeviceDataThisTick) return;  // ← SKIPS INACTIVE USERS ENTIRELY!
```

When a device stops broadcasting:
1. No device data comes in → `_hasDeviceDataThisTick` is never set
2. The user is **skipped entirely** in the first pass
3. `currentTickActiveHR` never includes them
4. They're added to `inactiveUsers` and get `heart_rate: null`

**BUT** the user is only in `userMetricMap` if they're in the roster (via `userManager.getAllUsers()`). The roster is populated from registered users **OR** active devices.

---

## The Real Root Cause: userMetricMap Population

```javascript
// Line 741-748 - Users from roster
const users = this.userManager.getAllUsers();
users.forEach((user) => {
  const staged = stageUserEntry(user);
  if (staged) {
    userMetricMap.set(staged.slug, staged);
  }
});
```

Then devices add their mapped users:
```javascript
// Line 789-800 - Users from devices
const mappedUser = this.userManager.resolveUserForDevice(device.id);
if (mappedUser) {
  // Add to userMetricMap
  entry._hasDeviceDataThisTick = true;  // Only set here!
}
```

**The problem:**
1. User is in roster via `userManager.getAllUsers()`
2. Device stops broadcasting → no `_hasDeviceDataThisTick`
3. User IS in `userMetricMap` (from roster)
4. But the early-return skips them: `if (!entry._hasDeviceDataThisTick) return;`
5. So they're never added to `currentTickActiveHR`
6. They correctly get `heart_rate: null` recorded

**So why doesn't the chart see the dropout?**

---

## The ActivityMonitor Disconnect

ActivityMonitor is updated **after** metrics processing:

```javascript
// Line 896-898
if (this.activityMonitor) {
  this.activityMonitor.recordTick(currentTickIndex, activeParticipantIds, { timestamp });
}
```

And `activeParticipantIds` is built from `currentTickActiveHR`:

```javascript
// Line 882-886
if (!hasValidHR) {
  return;  // Skip - don't add to activeParticipantIds
}
activeParticipantIds.add(slug);
```

So the flow is:
1. Device stops → `currentTickActiveHR` doesn't have user
2. `activeParticipantIds` doesn't have user
3. `activityMonitor.recordTick()` sees user missing
4. After 2 ticks, ActivityMonitor marks user IDLE
5. `getActivityMask()` returns `false` for IDLE ticks
6. Chart's `active` array should show `false`

**This should work!** Let me check why it doesn't...

---

## The Missing Link: Chart Doesn't Get ActivityMonitor

Looking at how the chart gets ActivityMonitor:

```javascript
// FitnessChartApp.jsx - useRaceChartData
const useRaceChartData = (roster, getSeries, timebase, options = {}) => {
  const { activityMonitor } = options;  // ← Must be passed in!
```

And in `useRaceChartWithHistory`:
```javascript
const useRaceChartWithHistory = (roster, getSeries, timebase, historicalParticipantIds = [], options = {}) => {
  const { activityMonitor } = options;  // ← Must be passed in!
```

**Is ActivityMonitor being passed?** Let me check the component:

```javascript
// The chart component must pass activityMonitor to these hooks
// If it's not being passed, the fallback is heart_rate nulls
```

---

## The Fallback Path: Heart Rate Nulls

When ActivityMonitor isn't available, the chart falls back to:

```javascript
// FitnessChart.helpers.js line 148-153
} else {
  // Fallback: derive activity from heart_rate nulls
  for (let i = 0; i < maxLen; i++) {
    const hr = heartRate[i];
    active[i] = hr != null && Number.isFinite(hr) && hr > 0;
  }
}
```

This **should work** because we record `null` for inactive users:

```javascript
// FitnessSession.js line 855-860
userMetricMap.forEach((entry, slug) => {
  if (!currentTickActiveHR.has(slug)) {
    assignMetric(`user:${slug}:heart_rate`, null);  // ← Records null!
  }
});
```

---

## Found It: assignMetric Ignores Null!

```javascript
// FitnessSession.js line 691-696
const assignMetric = (key, value) => {
  // Allow explicit nulls for heart_rate to mark dropouts on the chart
  const isHeartRateKey = typeof key === 'string' && key.endsWith(':heart_rate');
  if (value == null && !isHeartRateKey) return;  // ← Fixed for heart_rate
  if (typeof value === 'number' && Number.isNaN(value)) return;
  tickPayload[key] = value;
};
```

This was fixed to allow nulls for heart_rate. So that's not the issue.

---

## The ACTUAL Problem: Timeline Series Length Mismatch

When a user joins late, their series may be shorter than the current tick count. The chart fills edges:

```javascript
const beats = fillEdgesOnly(coinsRaw.map(v => ...), { startAtZero: true });
```

But the `active` array is built from `heart_rate` length:

```javascript
const heartRate = getSeries(targetId, 'heart_rate', { clone: true }) || [];
const maxLen = Math.max(zones.length, heartRate.length);
let active = new Array(maxLen).fill(false);
```

If `heart_rate` series is shorter than expected (because nulls weren't recorded), the `active` array will be shorter too!

---

## Root Cause Summary

1. **DeviceManager tracks inactivity in real-time** (60s timeout, immediate)
2. **FitnessSession records HR nulls every tick** for inactive users
3. **BUT** the HR null recording depends on user being in `userMetricMap`
4. **`userMetricMap` is populated from roster** which lags DeviceManager
5. **ActivityMonitor transitions to IDLE after 2 ticks** (10s)
6. **Chart renders based on HR series or ActivityMonitor mask**
7. **The timing gap**: DeviceManager sees inactivity at 60s, ActivityMonitor at 10s, but roster removal at 180s

---

## The Fix

### Option A: Use DeviceManager's inactiveSince as Source of Truth

Have FitnessSession check `device.inactiveSince` when building `currentTickActiveHR`:

```javascript
// In _collectTimelineTick, when processing devices:
devices.forEach((device) => {
  // Check if device is inactive according to DeviceManager
  if (device.inactiveSince) {
    // Don't count as active, ensure HR null is recorded
    const mappedUser = this.userManager.resolveUserForDevice(device.id);
    if (mappedUser) {
      const slug = slugifyId(mappedUser.name);
      // Explicitly mark as inactive
      inactiveUsers.push(slug);
    }
    return; // Skip active processing
  }
  // ... rest of device processing
});
```

### Option B: Sync ActivityMonitor with DeviceManager

Have DeviceManager emit events when `inactiveSince` changes, and have ActivityMonitor subscribe:

```javascript
// DeviceManager
if (!device.inactiveSince) {
  device.inactiveSince = now;
  this.emit('deviceInactive', { deviceId, inactiveSince: now });
}

// FitnessSession
this.deviceManager.on('deviceInactive', ({ deviceId, inactiveSince }) => {
  const user = this.userManager.resolveUserForDevice(deviceId);
  if (user) {
    this.activityMonitor.forceIdle(slugifyId(user.name));
  }
});
```

### Option C: Have Chart Read inactiveSince Directly

Pass device states to chart and build `active` mask from `inactiveSince`:

```javascript
// In buildBeatsSeries
if (options.deviceStates && targetId) {
  const device = options.deviceStates.get(targetId);
  if (device?.inactiveSince) {
    // Mark all ticks after inactiveSince as inactive
  }
}
```

---

## Recommended Fix: Option A

Modify `_collectTimelineTick` to check device inactivity state directly:

1. After processing devices, check each device's `inactiveSince`
2. If a device is inactive, ensure its mapped user is NOT in `currentTickActiveHR`
3. This aligns the session's activity detection with DeviceManager's real-time tracking

This is the simplest fix and keeps DeviceManager as the single source of truth for device connectivity, while ensuring the session/chart see the same state.

---

## Addendum: Implementation Attempts and Why They Failed

**Date:** December 24, 2025 (continued debugging)

### What We Tried

#### Attempt 1: Allow null heart_rate in assignMetric
**Change:** Modified `assignMetric()` to allow explicit nulls for `*:heart_rate` keys.

**Result:** Nulls are now recorded in the timeline series, but chart still showed active avatars.

**Why it failed:** Recording nulls is necessary but not sufficient. The chart's segment builder and status derivation have their own logic.

---

#### Attempt 2: Use DeviceManager's inactiveSince as Source of Truth (Option A)
**Change:** In `_collectTimelineTick()`, check `device.inactiveSince` when processing devices. If inactive, skip the user for `currentTickActiveHR` and ensure HR null is recorded.

**Result:** The FitnessSession now correctly excludes inactive users from `currentTickActiveHR`. The ActivityMonitor correctly shows `activityStatus: "idle"` for Milo.

**Why it failed:** The chart component has its OWN status derivation logic that overrides this.

---

#### Attempt 3: Create trailing gap segments for users still in dropout
**Change:** In `buildSegments()`, after the main loop, check if `inGap && gapStartPoint`. If so, create a trailing gap segment extending to the current tick.

**Result:** Gap segments are now created (logs show `gapSegs: 1`). The dotted grey line appears on the chart.

**Why it failed:** The avatar is still showing as "live" because the entry's `status` field is hardcoded.

---

#### Attempt 4: Derive status from segment data in useRaceChartData
**Change:** Instead of hardcoding `status: ParticipantStatus.ACTIVE`, derive it from:
- Whether the last segment is a gap (`isGap: true`)
- Whether the last value in the `active` array is `false`

**Result:** The derived status is correctly IDLE. But...

**Why it failed:** The `useRaceChartWithHistory` hook **overwrites** the status at line 333:
```javascript
status: ParticipantStatus.ACTIVE, // HARDCODED AGAIN!
```

---

#### Attempt 5: Use entry.status instead of hardcoded value
**Change:** Changed line 333 to use `entry.status` (the derived status from Attempt 4).

**Result:** The entry now has the correct status when it enters the cache.

**Why it failed:** There's ANOTHER status override later in the processing pipeline for "present" entries.

---

#### Attempt 6: Add guardrail to force status from segment state
**Change:** Added `validatedEntries` useMemo that iterates all entries and FORCES status to match segment state:
- If last segment is gap → IDLE
- If last segment is not gap → ACTIVE

**Result:** The guardrail fires correctly! Logs show:
```
[FitnessChart] GUARDRAIL ENFORCED: Correcting status mismatch
{id:"milo", wasStatus:"removed", nowStatus:"idle", endsWithGap:true}
```

**Why it STILL failed:** Despite the guardrail firing and correcting the status to IDLE, Milo still shows as a live avatar. The problem is somewhere AFTER `validatedEntries` is computed.

---

### The Real Problem: Too Many Competing Data Flows

The chart component has **at least 4 different places** where user status/presence is determined:

1. **useRaceChartData** - Returns `entries` from roster with derived status
2. **useRaceChartWithHistory** - Merges entries into `participantCache` 
3. **validatedEntries** - Guardrail that forces status from segments
4. **present/absent arrays** - Final split based on `isBroadcasting(status)`

But the **avatar rendering** at line 773 uses `presentEntries` from `useRaceChartWithHistory`'s return value, which SHOULD be the validated `present` array. However, something is causing the wrong data to flow through.

Looking at the component:
- Line 660: `const { presentEntries, ... } = useRaceChartWithHistory(...)`
- Line 773: `computeAvatarPositions(presentEntries, ...)`

The `presentEntries` is built from `validatedEntries.filter(e => isBroadcasting(e.status))`. If the guardrail correctly sets Milo to IDLE, and IDLE fails `isBroadcasting()`, Milo should NOT be in `presentEntries`.

**YET MILO IS STILL SHOWING AS LIVE.**

This means either:
1. The `validatedEntries` useMemo is not running (stale closure)
2. The `present` useMemo is using a stale reference
3. There's a race condition between state updates
4. The avatar rendering path is using a DIFFERENT `presentEntries` than we think

---

### Architectural Failures

#### 1. No Single Source of Truth
We have **THREE different systems** tracking user activity:
- `DeviceManager.inactiveSince` (real-time, 60s timeout)
- `ActivityMonitor.status` (tick-driven, 10s timeout)  
- Chart's `entry.status` (derived from segments)

None of these communicate with each other. The chart doesn't read DeviceManager. The sidebar doesn't read ActivityMonitor.

#### 2. Status is Computed Multiple Times
The user's status is derived/computed in at least 6 places:
1. `DeviceManager.pruneStaleDevices()` → sets `inactiveSince`
2. `FitnessSession._collectTimelineTick()` → builds `currentTickActiveHR`
3. `ActivityMonitor.recordTick()` → updates participant state machine
4. `useRaceChartData()` → derives status from segments
5. `useRaceChartWithHistory()` cache update → overwrites status
6. `validatedEntries` → forces status from segments (guardrail)

Each computation can produce different results, and they don't sync.

#### 3. Immutable Data Patterns Violated
React's model assumes immutable data flows down. But:
- `participantCache` is a `useState` that gets mutated in place
- Entries are spread (`...entry`) but nested objects may share references
- useMemo dependencies may not capture all relevant changes

#### 4. Missing Domain Model
There's no `Participant` class/object that owns its own state. Instead, we have:
- Device objects with activity timestamps
- User objects from roster
- Entry objects built from timeline series
- Cache entries that merge all of the above

The "participant" concept is reconstructed from scratch on every render.

---

### What Needs to Change

#### Option 1: Single Authoritative Status Field
Add an explicit `isActive` boolean to the participant roster that:
- Is set by DeviceManager when `inactiveSince` changes
- Flows through FitnessContext to all consumers
- Is the ONLY thing the chart checks for avatar rendering

```javascript
// In roster entry
{
  profileId: 'milo',
  isActive: false,  // ← Single source of truth
  inactiveSince: 1703424000000,
  // ... other fields
}
```

#### Option 2: Domain-Driven Participant Model
Create a `Participant` class that:
- Owns its activity state
- Computes `isBroadcasting()` from its internal state
- Is the same object reference across all consumers

```javascript
class Participant {
  constructor(profileId) {
    this.profileId = profileId;
    this._status = ParticipantStatus.ACTIVE;
    this._inactiveSince = null;
  }
  
  setInactive(timestamp) {
    this._status = ParticipantStatus.IDLE;
    this._inactiveSince = timestamp;
  }
  
  get isBroadcasting() {
    return this._status === ParticipantStatus.ACTIVE;
  }
}
```

#### Option 3: Event-Driven Status Updates
Have DeviceManager emit events that ALL consumers subscribe to:

```javascript
// DeviceManager
this.emit('participantInactive', { profileId: 'milo', timestamp: now });

// FitnessContext
deviceManager.on('participantInactive', ({ profileId }) => {
  // Update roster
  // Update ActivityMonitor
  // Trigger re-render
});

// Chart
// Simply reads from roster, which is already updated
```

#### Option 4: Collapse the Chart Data Pipeline
Instead of 4 hooks/memos computing status, have ONE:

```javascript
const useChartParticipants = (roster, getSeries, timebase) => {
  return useMemo(() => {
    return roster.map(participant => {
      const isActive = participant.isActive; // ← From roster, not derived
      const segments = buildSegments(...);
      return {
        ...participant,
        segments,
        status: isActive ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE
      };
    });
  }, [roster, getSeries, timebase]);
};
```

---

### Recommended Path Forward

1. **Add `isActive` to roster entries** - DeviceManager sets this when `inactiveSince` changes
2. **Flow `isActive` through FitnessContext** - All consumers read the same value
3. **Chart uses roster's `isActive`** - Not derived from segments
4. **Segments are for RENDERING only** - Gap segments just change line style, don't determine avatar visibility
5. **Remove all status derivation** - Status comes from ONE place

This eliminates the multi-source-of-truth problem and ensures sidebar and chart always agree.
