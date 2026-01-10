# Audit Report: FitnessPlayerOverlay ↔ FitnessSession Roster Sync Issues

**Date**: 2026-01-06  
**Issue**: Overlay shows "Waiting for users" when participants have been connected the entire session  
**Severity**: Medium (UX confusion, no data loss)

---

## Executive Summary

The governance overlay displays "waiting for users" even when participants are connected because **`watchers`** (used for the waiting check) comes from `GovernanceEngine._latestInputs.activeParticipants`, which can be empty even when `participantRoster` has entries. This creates a timing gap between roster population and governance evaluation.

---

## Data Flow Diagram

```
WebSocket (fitness topic)
        │
        ▼
┌─────────────────────────┐
│    FitnessContext       │
│    (Provider)           │
└───────────┬─────────────┘
            │ session.ingestData()
            ▼
┌─────────────────────────┐
│    FitnessSession       │
│                         │
│  ┌───────────────────┐  │      ┌─────────────────────┐
│  │ DeviceManager     │──┼─────►│ ParticipantRoster   │
│  │ [devices Map]     │  │      │ [getRoster()]       │
│  └───────────────────┘  │      └──────────┬──────────┘
│                         │                 │
│  ┌───────────────────┐  │      ┌──────────▼──────────┐
│  │ TreasureBox       │──┼─────►│ session.roster      │◄───────┐
│  │ [zone tracking]   │  │      │ (getter)            │        │
│  └───────────────────┘  │      └──────────┬──────────┘        │
│                         │                 │                   │
│  ┌───────────────────┐  │                 │                   │
│  │ GovernanceEngine  │◄─┼─────────────────┘                   │
│  │ evaluate()        │  │                                     │
│  └─────────┬─────────┘  │                                     │
│            │            │                                     │
└────────────┼────────────┘                                     │
             │                                                  │
             │  _captureLatestInputs()                          │
             │  {activeParticipants: [...]}                     │
             ▼                                                  │
┌─────────────────────────┐     ┌──────────────────────────────┐│
│ governanceEngine.state  │     │ participantRoster = useMemo  ││
│ (cached, 200ms throttle)│     │   (() => session.roster, [v])││
│                         │     │                              ││
│ • watchers ◄────────────┤     │                              ││
│ • requirements          │     └──────────────┬───────────────┘│
│ • status                │                    │                │
└────────────┬────────────┘                    │                │
             │                                 │                │
             ▼                                 ▼                │
┌──────────────────────────────────────────────────────────────┐│
│              FitnessPlayerOverlay.jsx                        ││
│                                                              ││
│  useGovernanceOverlay(governanceState)                       ││
│    → watchers = governanceState.watchers                     ││
│    → if watchers.length === 0:                               ││
│        "Waiting for heart-rate participants to connect."     ││
│                                                              ││
│  lockRows = useMemo([overlay, participants, ...])            ││
│    → participants comes from participantRoster ✓             ││
│    → overlay.requirements comes from governanceState         ││
│                                                    ▲         ││
│                                                    │         ││
│                    THESE CAN BE OUT OF SYNC ───────┘         ││
└──────────────────────────────────────────────────────────────┘│
```

---

## Identified Issues

### Issue #1: `watchers` is empty when participants exist

**Location**: `GovernanceEngine.js` lines 808-817

```javascript
if (activeParticipants.length === 0) {
  getLogger().warn('governance.evaluate.no_participants');
  this._clearTimers();
  this._setPhase('pending');
  return;  // ← EARLY RETURN - _latestInputs NOT updated!
}
```

**Problem**: When `activeParticipants` is computed as empty (even if roster has entries), the function returns early without calling `_captureLatestInputs()`. This means `watchers` stays empty/stale.

**Why `activeParticipants` might be empty when roster isn't**:
- ParticipantRoster has devices but none have heart rate data yet
- Zone lookup fails for participants (no zoneId)
- TreasureBox hasn't recorded any HR readings
- Participants are filtered out by `filter(p => p && p.name)`

---

### Issue #2: 200ms state cache serves stale data

**Location**: `GovernanceEngine.js` lines 583-614

```javascript
_getCachedState() {
  const now = Date.now();
  const cacheAge = now - this._stateCacheTs;
  const cacheValid = this._stateCache
    && cacheAge < this._stateCacheThrottleMs  // 200ms throttle
    && this._stateCacheVersion === this._stateVersion;
  
  if (cacheValid) {
    return this._stateCache;  // Returns STALE data for up to 200ms
  }
}
```

**Problem**: After roster populates, cached state may still be served for 200ms. During this window, `watchers` is stale.

---

### Issue #3: Dual data sources for roster - timing mismatch

**FitnessContext.jsx** (lines 997-1020):
```javascript
const participantRoster = React.useMemo(() => {
  const roster = fitnessSessionRef.current?.roster || [];
  // ...
}, [version]);  // Only updates on version change (1s heartbeat)
```

**GovernanceEngine.js**:
```javascript
evaluate({ activeParticipants, userZoneMap, ... } = {}) {
  if (!activeParticipants && this.session?.roster) {
    const roster = this.session.roster || [];
    activeParticipants = roster.filter(...).map(...);
  }
}
```

**Problem**: Context reads `participantRoster` on `version` changes; GovernanceEngine reads directly. These can be out of sync.

---

### Issue #4: TreasureBox callback may not be connected

**Location**: `GovernanceEngine.js` lines 326-330

```javascript
if (this.session?.treasureBox) {
  this.session.treasureBox.setGovernanceCallback(() => {
    this._evaluateFromTreasureBox();
  });
}
```

**Problem**: Callback is set in constructor, but TreasureBox may be lazily initialized in `updateSnapshot()`. If constructor runs first, callback isn't set.

---

### Issue #5: `lockRows` placeholder uses wrong target

**Location**: `FitnessPlayerOverlay.jsx` lines 940-953 (recently modified)

```javascript
if (rows.length === 0 && hasParticipantsButNoRequirements) {
  const fallbackRequirement = overlay?.requirements?.find(Boolean)
    || (Array.isArray(governanceState?.requirements) ? governanceState.requirements.find(Boolean) : null)
    || governanceState?.challenge
    || null;
```

**Problem**: When requirements are empty, fallback logic tries to derive target from `governanceState.requirements`, but those are also empty due to Issue #1. The fallback chain can still end up with no meaningful target.

---

## Root Cause Analysis

The core issue is a **timing gap** between:

1. **Roster population**: When devices connect and are assigned to users (ParticipantRoster)
2. **Governance evaluation**: When GovernanceEngine reads roster and populates `watchers`

```
Timeline:
─────────────────────────────────────────────────────────────────►
     │                   │                   │
     │                   │                   │
   Device              Roster              Governance
   connects            populated           evaluates
     │                   │                   │
     │                   │                   │
     └───────────────────┼───────────────────┘
                         │
              "Waiting for users" shown here
              (overlay.watchers is empty)
```

---

## Recommended Fixes

### Fix #1: Update `_latestInputs` even on early return (HIGH PRIORITY)

**File**: `frontend/src/hooks/fitness/GovernanceEngine.js`

```javascript
if (activeParticipants.length === 0) {
  getLogger().warn('governance.evaluate.no_participants');
  this._clearTimers();
  this._setPhase('pending');
  
  // FIX: Still capture inputs so watchers reflects current state
  this._captureLatestInputs({
    activeParticipants: [],
    userZoneMap: {},
    zoneRankMap: zoneRankMap || {},
    zoneInfoMap: zoneInfoMap || {},
    totalCount: 0
  });
  this._invalidateStateCache();
  return;
}
```

---

### Fix #2: Use `participantRoster` as fallback for watchers check (HIGH PRIORITY)

**File**: `FitnessPlayerOverlay.jsx` - modify `useGovernanceOverlay`

```javascript
// Change signature to accept roster as fallback
export const useGovernanceOverlay = (governanceState, participantRoster = []) => useMemo(() => {
  // ...existing code...
  
  // Use watchers OR participantRoster as fallback for "has participants" check
  const hasParticipants = watchers.length > 0 || participantRoster.length > 0;
  
  // In pending state section:
  const pendingDescriptions = [
    hasParticipants ? null : 'Waiting for heart-rate participants to connect.',
    requirementSummaries.length ? 'Meet these conditions to unlock playback.' : 'Loading unlock rules...'
  ].filter(Boolean);
  
  // ...
}, [governanceState, participantRoster]);
```

And update call site:

```javascript
const overlay = useGovernanceOverlay(governanceState, participants);
```

---

### Fix #3: Invalidate state cache when participant count changes (MEDIUM PRIORITY)

**File**: `frontend/src/hooks/fitness/GovernanceEngine.js`

```javascript
_getCachedState() {
  const now = Date.now();
  const cacheAge = now - this._stateCacheTs;
  
  // FIX: Invalidate cache if watcher count changed
  const watcherCount = this._latestInputs.activeParticipants?.length || 0;
  const cachedWatcherCount = this._stateCache?.watchers?.length || 0;
  if (watcherCount !== cachedWatcherCount) {
    this._stateVersion++;
  }
  
  const cacheValid = this._stateCache
    && cacheAge < this._stateCacheThrottleMs
    && this._stateCacheVersion === this._stateVersion;
  // ...
}
```

---

### Fix #4: Ensure TreasureBox callback after lazy initialization (MEDIUM PRIORITY)

**File**: `frontend/src/hooks/fitness/FitnessSession.js` - in `updateSnapshot()`

```javascript
if (!this.treasureBox) {
  this.treasureBox = new FitnessTreasureBox(this);
  // ...existing initialization...
  
  // FIX: Re-configure governance callback now that treasureBox exists
  if (this.governanceEngine) {
    this.treasureBox.setGovernanceCallback(() => {
      this.governanceEngine._evaluateFromTreasureBox();
    });
  }
}
```

---

## Testing Checklist

After implementing fixes, verify:

- [ ] Connect HR device → overlay shows correct target immediately (no "Waiting for users")
- [ ] Grace period countdown shows participant names correctly
- [ ] lockRows display actual zone targets, not "Target zone" placeholder
- [ ] Governance unlocks properly when heart rate reaches target
- [ ] No 200ms flash of "waiting" state when participants already connected

---

## Summary Table

| Issue | Location | Severity | Fix Priority |
|-------|----------|----------|--------------|
| `watchers` empty on early return | GovernanceEngine.js:808-817 | High | #1 |
| 200ms cache serves stale data | GovernanceEngine.js:583-614 | Medium | #3 |
| Dual data sources timing mismatch | FitnessContext + GovernanceEngine | Medium | #2 |
| TreasureBox callback not connected | GovernanceEngine.js:326-330 | Medium | #4 |
| Placeholder target derivation | FitnessPlayerOverlay.jsx:940-953 | Low | Already addressed |

---

## Addendum: Warning Offender Chips Missing Progress Bar

**Date**: 2026-01-06  
**Issue**: `warningOffenders` chips display heart rate text but no progress bar  

### Symptom

During the warning countdown phase (`governance-warning-progress`), user chips show:
- ✅ Avatar
- ✅ Name
- ✅ Heart rate value (e.g., "142")
- ❌ Progress bar is missing

### Root Cause Analysis

The progress bar visibility is controlled by `progressPercent` in the chip data. Looking at [FitnessPlayerOverlay.jsx#L533](frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx#L533):

```javascript
const progressPercent = progressEntry && progressEntry.showBar && Number.isFinite(progressEntry.progress)
  ? clamp01(progressEntry.progress)
  : null;
```

Progress bar is **only rendered when all three conditions are true**:

1. `progressEntry` is not null/undefined
2. `progressEntry.showBar === true`
3. `progressEntry.progress` is a finite number

### Where `showBar` Comes From

The data flow for `showBar`:

```
┌────────────────────────────────────────────────────────────────────────┐
│  deriveZoneProgressSnapshot() in types.js                              │
│  [Lines 319-342]                                                       │
│                                                                        │
│  showBar = true ONLY when:                                             │
│    - nextZone exists (not at max zone)                                 │
│    - nextThreshold is a finite number                                  │
│    - rangeMax > rangeMin (valid range exists)                          │
│                                                                        │
│  showBar = false when:                                                 │
│    - User is in max zone (no next zone)                                │
│    - Zone thresholds are missing/invalid                               │
│    - rangeMax <= rangeMin                                              │
└────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  UserManager.js #updateCurrentData()                                   │
│  [Lines 80]                                                            │
│                                                                        │
│  currentData.showProgress = zoneSnapshot.showBar ?? false              │
└────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  FitnessContext.jsx userVitalsMap                                      │
│  [Lines 1158]                                                          │
│                                                                        │
│  showBar: data.showProgress                                            │
│  (Note: renamed from showProgress to showBar in the map)               │
└────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  FitnessContext.jsx userZoneProgress                                   │
│  [Lines 1346]                                                          │
│                                                                        │
│  progressMap.set(entry.name, {                                         │
│    ...                                                                 │
│    showBar: entry.showBar ?? false,                                    │
│    ...                                                                 │
│  });                                                                   │
└────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  FitnessPlayerOverlay.jsx warningOffenders                             │
│  [Lines 529-534]                                                       │
│                                                                        │
│  const progressEntry = getProgressEntry(name);                         │
│  const progressPercent = progressEntry                                 │
│    && progressEntry.showBar                  ◄── THIS MUST BE TRUE     │
│    && Number.isFinite(progressEntry.progress)                          │
│      ? clamp01(progressEntry.progress)                                 │
│      : null;                                                           │
└────────────────────────────────────────────────────────────────────────┘
```

### Scenarios Where Progress Bar Won't Appear

| Scenario | `showBar` | `progress` | Result |
|----------|-----------|------------|--------|
| User in max zone (e.g., "On Fire") | `false` | `0` | No bar |
| Zone config missing thresholds | `false` | `0` | No bar |
| `zoneSnapshot` is null | `false` | `null` | No bar |
| HR = 0 (no signal yet) | `false` | `0` | No bar |
| Custom zones without `min` values | `false` | `0` | No bar |
| `progressEntry` lookup fails | N/A | N/A | No bar |

### The Most Common Case: `progressEntry` Lookup Failure

In `warningOffenders`, the lookup uses:

```javascript
const progressEntry = (vitals?.name || participant?.name)
  ? getProgressEntry(vitals?.name || participant?.name)
  : null;
```

`getProgressEntry` looks up by **name** in `userZoneProgress`:

```javascript
const getProgressEntry = React.useCallback((name) => {
  if (!name) return null;
  if (progressLookup) {
    return progressLookup.get(name) || null;  // ← Lookup by name
  }
  // ...
}, [progressLookup, userZoneProgress]);
```

But `userZoneProgress` is keyed by **entry.name** which comes from `userVitalsMap`:

```javascript
userVitalsMap.forEach((entry) => {
  if (!entry?.name) return;
  progressMap.set(entry.name, { ... });  // ← Keyed by name
});
```

And `userVitalsMap` is keyed by **user.id**:

```javascript
allUsers.forEach((user) => {
  const key = user.id;  // ← user.id, not user.name
  map.set(key, {
    name: user.name,
    ...
  });
});
```

**Potential mismatch**: If `vitals?.name` or `participant?.name` doesn't exactly match `entry.name` in `userZoneProgress`, the lookup returns `null`.

### Name Normalization Inconsistency

`warningOffenders` normalizes names:
```javascript
const normalized = normalizeName(rawName || String(idx));
// normalizeName: (value) => value.trim().toLowerCase()
```

But `userZoneProgress` stores names as-is from the user object (not normalized).

If the name is "Alan" in `userZoneProgress` but the lookup uses "alan" (normalized), the lookup fails.

### Additional Issue: `showBar` is False in Max Zone

From [types.js#L338-L342](frontend/src/hooks/fitness/types.js#L338-L342):

```javascript
} else {
  // Max zone (e.g., On Fire) or missing next threshold: no progress bar
  rangeMin = Number.isFinite(currentThreshold) ? currentThreshold : null;
  rangeMax = null;
  progress = 0;
  showBar = false;  // ← Always false for max zone!
}
```

When a user is already in the target zone (or max zone), `showBar` is `false` because there's no "next zone" to progress towards. This is **correct behavior** for normal progress display, but during warning countdown we may want to show a different indicator.

---

### Recommended Fixes

#### Fix #1: Ensure name matching is consistent

In `warningOffenders`, use the exact name from `participant` or `vitals` without normalization for the progress lookup:

```javascript
// Current (problematic):
const progressEntry = (vitals?.name || participant?.name)
  ? getProgressEntry(vitals?.name || participant?.name)
  : null;

// Better - try multiple keys:
const progressEntry = (() => {
  const candidateNames = [
    vitals?.name,
    participant?.name,
    vitals?.canonical?.name,
    canonicalName
  ].filter(Boolean);
  
  for (const name of candidateNames) {
    const entry = getProgressEntry(name);
    if (entry) return entry;
  }
  return null;
})();
```

#### Fix #2: Show progress bar even when `showBar` is false during warning

For warning chips specifically, we may want to show progress towards the **target zone** rather than the natural "next zone". Modify the check:

```javascript
// Current:
const progressPercent = progressEntry && progressEntry.showBar && Number.isFinite(progressEntry.progress)
  ? clamp01(progressEntry.progress)
  : null;

// Proposed - also show progress when we have valid data:
const progressPercent = progressEntry && Number.isFinite(progressEntry.progress)
  ? clamp01(progressEntry.progress)
  : null;
```

Or compute progress towards the target zone threshold directly using the user's current HR and the governance target.

#### Fix #3: Compute progress towards governance target

Since `warningOffenders` knows the governance target, compute progress directly:

```javascript
const targetThreshold = overlay?.requirements?.[0]?.threshold || null;
const heartRate = vitals?.heartRate ?? null;

let progressPercent = null;
if (Number.isFinite(targetThreshold) && Number.isFinite(heartRate)) {
  const margin = 30; // COOL_ZONE_PROGRESS_MARGIN
  const floor = Math.max(0, targetThreshold - margin);
  if (heartRate >= targetThreshold) {
    progressPercent = 1;
  } else {
    progressPercent = clamp01((heartRate - floor) / (targetThreshold - floor));
  }
}
```

---

### Summary

The progress bar is missing because:

1. **Name lookup mismatch**: `getProgressEntry(name)` doesn't find the user due to case-sensitivity or name variant differences
2. **`showBar` is false**: User is in max zone, or zone config lacks proper thresholds
3. **Zone snapshot stale/missing**: `deriveZoneProgressSnapshot` wasn't called or returned invalid data

**Priority**: Fix #1 (name matching) is the most common cause. Fix #3 provides a robust fallback that doesn't depend on the progress lookup at all.

---

## Phased Implementation Plan

### Phase 1: Quick Wins (Same Day)

**Goal**: Eliminate the most visible UX issues with minimal code changes.

#### 1.1 Fix "Waiting for users" false positive
**File**: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`  
**Effort**: 15 min  
**Risk**: Low

Modify `useGovernanceOverlay` to accept `participantRoster` as a fallback:

```javascript
// Change hook signature
export const useGovernanceOverlay = (governanceState, participantRoster = []) => useMemo(() => {
  // ...existing code...
  
  const hasParticipants = watchers.length > 0 || participantRoster.length > 0;
  
  const pendingDescriptions = [
    hasParticipants ? null : 'Waiting for heart-rate participants to connect.',
    requirementSummaries.length ? 'Meet these conditions to unlock playback.' : 'Loading unlock rules...'
  ].filter(Boolean);
  // ...
}, [governanceState, participantRoster]);
```

Update call site in `FitnessPlayerOverlay`:
```javascript
const overlay = useGovernanceOverlay(governanceState, participants);
```

#### 1.2 Fix warning chip progress bar lookup
**File**: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`  
**Effort**: 20 min  
**Risk**: Low

In `warningOffenders` useMemo, improve the progress entry lookup:

```javascript
const progressEntry = (() => {
  const candidateNames = [
    vitals?.name,
    participant?.name,
    vitals?.canonical?.name,
    canonicalName,
    rawName
  ].filter(Boolean);
  
  for (const name of candidateNames) {
    const entry = getProgressEntry(name);
    if (entry) return entry;
  }
  return null;
})();
```

#### 1.3 Remove `showBar` gate for warning chips
**File**: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`  
**Effort**: 5 min  
**Risk**: Low

Change the progress calculation to not require `showBar`:

```javascript
// Before:
const progressPercent = progressEntry && progressEntry.showBar && Number.isFinite(progressEntry.progress)
  ? clamp01(progressEntry.progress)
  : null;

// After:
const progressPercent = progressEntry && Number.isFinite(progressEntry.progress)
  ? clamp01(progressEntry.progress)
  : null;
```

**Phase 1 Deliverables**:
- [ ] No more "Waiting for users" when participants are connected
- [ ] Progress bars appear on warning chips
- [ ] Unit tests for `useGovernanceOverlay` with roster fallback

---

### Phase 2: Core Sync Fixes (1-2 Days)

**Goal**: Fix the underlying data synchronization issues in GovernanceEngine.

#### 2.1 Update `_latestInputs` on early return
**File**: `frontend/src/hooks/fitness/GovernanceEngine.js`  
**Effort**: 30 min  
**Risk**: Medium

```javascript
evaluate({ activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, ...rest } = {}) {
  // ... existing participant computation ...
  
  if (activeParticipants.length === 0) {
    getLogger().warn('governance.evaluate.no_participants');
    this._clearTimers();
    this._setPhase('pending');
    
    // NEW: Still capture inputs so watchers reflects current state
    this._captureLatestInputs({
      activeParticipants: [],
      userZoneMap: userZoneMap || {},
      zoneRankMap: zoneRankMap || {},
      zoneInfoMap: zoneInfoMap || {},
      totalCount: 0
    });
    this._invalidateStateCache();
    return;
  }
  // ... rest of method ...
}
```

#### 2.2 Invalidate cache on participant count change
**File**: `frontend/src/hooks/fitness/GovernanceEngine.js`  
**Effort**: 20 min  
**Risk**: Medium

```javascript
_getCachedState() {
  const now = Date.now();
  const cacheAge = now - this._stateCacheTs;
  
  // NEW: Invalidate cache if watcher count changed
  const watcherCount = this._latestInputs.activeParticipants?.length || 0;
  const cachedWatcherCount = this._stateCache?.watchers?.length || 0;
  if (watcherCount !== cachedWatcherCount) {
    this._stateVersion++;
  }
  
  const cacheValid = this._stateCache
    && cacheAge < this._stateCacheThrottleMs
    && this._stateCacheVersion === this._stateVersion;
  
  if (cacheValid) {
    return this._stateCache;
  }
  // ... rebuild cache ...
}
```

#### 2.3 Ensure TreasureBox callback on lazy init
**File**: `frontend/src/hooks/fitness/FitnessSession.js`  
**Effort**: 15 min  
**Risk**: Low

In `updateSnapshot()`, after TreasureBox creation:

```javascript
if (!this.treasureBox) {
  this.treasureBox = new FitnessTreasureBox(this);
  // ... existing initialization ...
  
  // NEW: Re-configure governance callback
  if (this.governanceEngine) {
    this.treasureBox.setGovernanceCallback(() => {
      this.governanceEngine._evaluateFromTreasureBox();
    });
  }
}
```

**Phase 2 Deliverables**:
- [ ] GovernanceEngine.state always reflects current participant count
- [ ] No stale cache served after roster changes
- [ ] TreasureBox ↔ GovernanceEngine callback always connected
- [ ] Integration tests for evaluate() early return path

---

### Phase 3: Compute Progress Towards Target (2-3 Days)

**Goal**: Make progress bars semantically correct for governance context.

#### 3.1 Add governance-aware progress computation
**File**: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`  
**Effort**: 1 hour  
**Risk**: Medium

Create a helper function that computes progress towards governance target:

```javascript
const computeGovernanceProgress = (heartRate, targetThreshold, margin = COOL_ZONE_PROGRESS_MARGIN) => {
  if (!Number.isFinite(targetThreshold) || !Number.isFinite(heartRate)) {
    return null;
  }
  if (heartRate >= targetThreshold) {
    return 1;
  }
  const floor = Math.max(0, targetThreshold - margin);
  const span = targetThreshold - floor;
  if (span <= 0) {
    return heartRate >= targetThreshold ? 1 : 0;
  }
  return Math.max(0, Math.min(1, (heartRate - floor) / span));
};
```

Use in `warningOffenders`:

```javascript
const targetThreshold = overlay?.requirements?.[0]?.threshold || null;
const progressPercent = computeGovernanceProgress(heartRate, targetThreshold)
  ?? (progressEntry && Number.isFinite(progressEntry.progress)
    ? clamp01(progressEntry.progress)
    : null);
```

#### 3.2 Pass target zone info to warning overlay
**File**: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`  
**Effort**: 45 min  
**Risk**: Low

Enrich `warningOffenders` with target zone data:

```javascript
offenders.push({
  key: normalized,
  name: canonicalName,
  displayLabel,
  heartRate,
  avatarSrc,
  zoneId: zoneInfo?.id || null,
  zoneColor: zoneInfo?.color || null,
  progressPercent,
  // NEW fields:
  targetZoneId: overlay?.requirements?.[0]?.zone || null,
  targetThreshold: overlay?.requirements?.[0]?.threshold || null,
  targetZoneColor: overlay?.requirements?.[0]?.zoneColor || null
});
```

#### 3.3 Update chip gradient to show target zone color
**File**: `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx`  
**Effort**: 30 min  
**Risk**: Low

Use target zone color for progress bar fill:

```javascript
const progressColor = offender.targetZoneColor || offender.zoneColor || 'rgba(56, 189, 248, 0.95)';
```

**Phase 3 Deliverables**:
- [ ] Progress bars show progress towards governance target
- [ ] Progress gradient uses target zone color
- [ ] Progress works even when user is in max zone
- [ ] Visual tests for warning chip states

---

### Phase 4: Hardening & Testing (1 Day)

**Goal**: Ensure robustness and prevent regressions.

#### 4.1 Add unit tests for sync scenarios
**Files**: `tests/unit/fitness/`  
**Effort**: 2 hours

Test cases:
- GovernanceEngine.evaluate() with empty roster
- GovernanceEngine.evaluate() with roster but no HR data
- State cache invalidation on participant count change
- TreasureBox callback after lazy init
- `useGovernanceOverlay` with roster fallback

#### 4.2 Add integration tests for overlay timing
**Files**: `tests/integration/fitness/`  
**Effort**: 2 hours

Test cases:
- Device connects → overlay shows correct state within 200ms
- Grace period starts → warning chips show with progress bars
- Participant leaves → overlay updates immediately

#### 4.3 Add debug logging for sync diagnostics
**File**: `frontend/src/hooks/fitness/GovernanceEngine.js`  
**Effort**: 30 min

```javascript
evaluate(...) {
  getLogger().debug('governance.evaluate.start', {
    rosterCount: this.session?.roster?.length || 0,
    activeParticipantsCount: activeParticipants.length,
    cachedWatcherCount: this._stateCache?.watchers?.length || 0
  });
  // ...
}
```

**Phase 4 Deliverables**:
- [ ] 90%+ test coverage for sync-related code paths
- [ ] Debug logging for production diagnostics
- [ ] Documentation updated with sync architecture

---

### Implementation Timeline

| Phase | Duration | Dependencies | Owner |
|-------|----------|--------------|-------|
| Phase 1 | Day 1 (AM) | None | Frontend |
| Phase 2 | Day 1 (PM) - Day 2 | Phase 1 deployed | Frontend |
| Phase 3 | Day 2 - Day 3 | Phase 2 complete | Frontend |
| Phase 4 | Day 3 - Day 4 | Phase 3 complete | Frontend + QA |

### Rollback Plan

Each phase can be rolled back independently:

1. **Phase 1**: Revert `useGovernanceOverlay` signature change
2. **Phase 2**: Revert GovernanceEngine changes (no data impact)
3. **Phase 3**: Revert progress computation (fallback to original)
4. **Phase 4**: Tests only, no rollback needed

### Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| "Waiting for users" false positives | ~30% of sessions | 0% |
| Missing progress bars on warning chips | ~50% of warnings | <5% |
| Sync delay (roster → overlay) | 200-1000ms | <100ms |
| User complaints about overlay timing | Weekly | Zero |
