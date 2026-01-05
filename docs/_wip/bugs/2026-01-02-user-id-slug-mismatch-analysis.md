# User ID vs Slug Mismatch - Root Cause Analysis

**Date**: 2026-01-02
**Issue**: FitnessGovernance overlay no longer detects users after entityId introduction
**Severity**: Critical - Breaks core governance functionality
**Status**: Root cause identified, fix pending

---

## Executive Summary

The introduction of `entityId` and the shift to `slugifyId(user.name)` for keying data structures created a **critical inconsistency** where different parts of the codebase use different identifier formats (`user.id` vs `slugifyId(user.name)` vs `entityId`). This broke the data flow between FitnessSession, TreasureBox, ParticipantRoster, and GovernanceEngine.

**Impact**: GovernanceEngine no longer sees active participants because zone data lookups fail due to key mismatches.

---

## Root Cause

### The Problem Chain

1. **FitnessSession._collectTimelineTick()** creates `userMetricMap` keyed by `user.id` (line 1635, 1642, 1645)
2. **stageUserEntry()** returns objects with `slug: slugifyId(user.name)` (line 1503)
3. **currentTickActiveHR** Set is populated with `user.id` values (line 1695)
4. **TreasureBox.processTick()** receives `currentTickActiveHR` but its `perUser` Map is keyed by `user.name` (not `user.id`)
5. **TreasureBox.getUserZoneSnapshot()** returns zone data keyed by `user.name` (line 611: `user: key`)
6. **ParticipantRoster._buildRosterEntry()** looks up zones using `slugifyId(participantName)` (line 259)
7. **Mismatch occurs**: Zone lookup uses slug, but data is keyed inconsistently

### The Specific Bug

**File**: `frontend/src/hooks/fitness/FitnessSession.js`

**Lines 1635-1645** (current buggy code):
```javascript
const userId = mappedUser.id;  // ← BUG: Using user.id
if (!userId) return;

if (!userMetricMap.has(userId)) {
  const staged = stageUserEntry(mappedUser, deviceId);  // ← Returns {slug: slugifyId(user.name), ...}
  if (staged) {
    userMetricMap.set(userId, staged);  // ← BUG: Keying by user.id instead of staged.slug!
  }
}
```

**Lines 1682-1696** (downstream consequences):
```javascript
userMetricMap.forEach((entry, userId) => {  // ← userId is actually user.id, not slug!
  // ...
  if (hasValidHR) {
    currentTickActiveHR.add(userId);  // ← Adding user.id to the Set
  }
});
```

**Line 1795** (passing to TreasureBox):
```javascript
this.treasureBox.processTick(currentTickIndex, currentTickActiveHR, {});
// ← currentTickActiveHR contains user.id values
```

**File**: `frontend/src/hooks/fitness/TreasureBox.js`

**Line 303-318** (TreasureBox expects slugs):
```javascript
for (const [accKey, acc] of this.perUser.entries()) {  // ← perUser keyed by user.name (not user.id!)
  // accKey can be either a userId (for regular users) or entityId (for guests)
  const profileId = acc.profileId || accKey;
  const isEntityKey = accKey.startsWith('entity-');

  // CRITICAL: Only process intervals for ACTIVE participants
  if (!activeParticipants.has(isEntityKey ? profileId : accKey)) {  // ← Looking for accKey (user.name) in Set of user.id!
    // User not active
    acc.highestZone = null;  // ← Everyone gets marked inactive!
    continue;
  }
}
```

**The Mismatch**:
- `currentTickActiveHR` contains: `["user-123-abc", "user-456-def"]` (user.id values)
- `perUser` Map keys are: `["Alan", "Bob"]` (user.name values)
- Lookup fails: `activeParticipants.has("Alan")` → **false** (because Set has "user-123-abc", not "Alan")
- **Result**: All users marked as inactive, no coins awarded, governance sees 0 active users

---

## Historical Context

### What Changed in Commit `3284b99a`

**Commit**: "Refactor fitness session data model to v2 proposal"

**Intent**: Unify keying strategy to use explicit IDs (`slugifyId(user.name)`) instead of `user.id` for better consistency and human-readable persistence format.

**What Was Changed**:
1. `snapshot.usersMeta` keyed by `slugifyId(user.name)` instead of `user.id` (line 947)
2. `snapshot.participantSeries` keyed by `slugifyId(user.name)` (line 967)
3. TreasureBox `recordUserHeartRate()` changed to accept `user.name` instead of `user.id` (line 446)
4. ParticipantRoster zone lookup changed to use `slugifyId(participantName)` instead of `user.id` (line 259)
5. **BUT**: `_collectTimelineTick()` still uses `user.id` to key `userMetricMap` ← **MISSED**

**What Was Missed**:
- The `userMetricMap` creation in `_collectTimelineTick()` was not updated to use `slugifyId(user.name)`
- The `currentTickActiveHR` Set population was not updated to use `slugifyId(user.name)`
- The interface contract between FitnessSession and TreasureBox was broken

---

## Data Flow Diagram (Current Buggy State)

```
┌─────────────────────────────────────────────────────────────┐
│ FitnessSession._collectTimelineTick()                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. devices.forEach(device => {                              │
│       const mappedUser = userManager.resolveUserForDevice() │
│       const userId = mappedUser.id  ← "user-123-abc"        │
│       const staged = stageUserEntry(mappedUser)             │
│         → {slug: "alan", metadata: {name: "Alan"}, ...}     │
│                                                              │
│       userMetricMap.set(userId, staged)                     │
│         → Map { "user-123-abc" => {slug: "alan", ...} }     │
│     })                                                       │
│                                                              │
│  2. userMetricMap.forEach((entry, userId) => {              │
│       // userId = "user-123-abc"                            │
│       currentTickActiveHR.add(userId)                       │
│         → Set { "user-123-abc", "user-456-def" }            │
│     })                                                       │
│                                                              │
│  3. treasureBox.processTick(currentTickActiveHR)            │
│       → Pass Set { "user-123-abc", ... }                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ TreasureBox.processTick(activeParticipants)                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  this.perUser = Map {                                        │
│    "Alan" => {totalCoins: 45, ...},                         │
│    "Bob" => {totalCoins: 30, ...}                           │
│  }                                                           │
│                                                              │
│  for (const [accKey, acc] of this.perUser.entries()) {      │
│    // accKey = "Alan"                                       │
│    if (!activeParticipants.has("Alan")) {  ← MISMATCH!     │
│      // activeParticipants = Set { "user-123-abc" }        │
│      // "Alan" not in Set → Mark as inactive               │
│      acc.highestZone = null                                 │
│    }                                                         │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ TreasureBox.getUserZoneSnapshot()                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  return [                                                    │
│    {user: "Alan", userId: "Alan", zoneId: null, ...},      │
│    {user: "Bob", userId: "Bob", zoneId: null, ...}         │
│  ]                                                           │
│  // All zones are null because highestZone was cleared     │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ ParticipantRoster._buildRosterEntry()                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  const key = slugifyId(participantName)  ← "alan"           │
│  const zoneInfo = zoneLookup.get(key)  ← null              │
│  // No zone data found → roster entries have no zones      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ GovernanceEngine.evaluate({activeParticipants, userZoneMap})│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  activeParticipants = ["Alan", "Bob"]  ← Names from roster  │
│  userZoneMap = {"alan": null, "bob": null}  ← No zones!    │
│                                                              │
│  // No users in zones → activeUserCount = 0                │
│  // Governance fails to detect any participants             │
└─────────────────────────────────────────────────────────────┘
```

---

## The Fix

### Primary Fix: Use Slug Instead of user.id

**File**: `frontend/src/hooks/fitness/FitnessSession.js`

**Lines 1633-1646** (BEFORE - buggy):
```javascript
const mappedUser = this.userManager.resolveUserForDevice(deviceId);
if (!mappedUser) return;
const userId = mappedUser.id;
if (!userId) return;

// Validate ID consistency
const ledgerEntry = this.userManager?.assignmentLedger?.get?.(deviceId);
validateIdConsistency(userId, deviceId, ledgerEntry);

if (!userMetricMap.has(userId)) {
  const staged = stageUserEntry(mappedUser, deviceId);
  if (staged) {
    userMetricMap.set(userId, staged);
  }
}
const entry = userMetricMap.get(userId);
```

**Lines 1633-1646** (AFTER - fixed):
```javascript
const mappedUser = this.userManager.resolveUserForDevice(deviceId);
if (!mappedUser) return;

const staged = stageUserEntry(mappedUser, deviceId);
if (!staged || !staged.slug) return;
const userSlug = staged.slug;  // ← Use slug from stageUserEntry

// Validate ID consistency (using slug instead of user.id)
const ledgerEntry = this.userManager?.assignmentLedger?.get?.(deviceId);
validateIdConsistency(userSlug, deviceId, ledgerEntry);

if (!userMetricMap.has(userSlug)) {
  userMetricMap.set(userSlug, staged);  // ← Key by slug
}
const entry = userMetricMap.get(userSlug);  // ← Lookup by slug
```

**Lines 1580-1592** (BEFORE - buggy, for inactive devices):
```javascript
if (device.inactiveSince) {
  const mappedUser = this.userManager.resolveUserForDevice(deviceId);
  if (mappedUser) {
    const userId = mappedUser.id;
    if (userId) {
      deviceInactiveUsers.add(userId);
      if (!userMetricMap.has(userId)) {
        const staged = stageUserEntry(mappedUser, deviceId);
        if (staged) {
          userMetricMap.set(userId, staged);
        }
      }
    }
  }
  // Skip active device processing
}
```

**Lines 1580-1592** (AFTER - fixed):
```javascript
if (device.inactiveSince) {
  const mappedUser = this.userManager.resolveUserForDevice(deviceId);
  if (mappedUser) {
    const staged = stageUserEntry(mappedUser, deviceId);
    if (staged && staged.slug) {
      const userSlug = staged.slug;  // ← Use slug
      deviceInactiveUsers.add(userSlug);  // ← Add slug to Set
      if (!userMetricMap.has(userSlug)) {
        userMetricMap.set(userSlug, staged);  // ← Key by slug
      }
    }
  }
  // Skip active device processing
}
```

**Lines 1682-1696** (Update variable naming for clarity):
```javascript
// Before: userMetricMap.forEach((entry, userId) => {
// After:
userMetricMap.forEach((entry, userSlug) => {  // ← Rename for clarity
  if (!entry) return;
  if (!entry._hasDeviceDataThisTick) return;

  if (deviceInactiveUsers.has(userSlug)) return;  // ← Use userSlug

  const hr = entry.metrics?.heartRate;
  const hasValidHR = hr != null && Number.isFinite(hr) && hr > 0;
  if (hasValidHR) {
    currentTickActiveHR.add(userSlug);  // ← Add slug to Set
  }
});
```

**Line 1704** (Update previousTickActive iteration):
```javascript
// Before: previousTickActive.forEach((userId) => {
// After:
previousTickActive.forEach((userSlug) => {  // ← Rename for clarity
  if (!currentTickActiveHR.has(userSlug)) {
    droppedUsers.push(userSlug);
  }
});
```

**Lines 1722-1730** (Update inactive user iteration):
```javascript
// Before: userMetricMap.forEach((entry, userId) => {
// After:
userMetricMap.forEach((entry, userSlug) => {  // ← Rename for clarity
  if (!currentTickActiveHR.has(userSlug)) {
    inactiveUsers.push(userSlug);
  }
});
```

### Secondary Fix: Update validateIdConsistency

**Lines 1556-1569** (Update signature):
```javascript
// BEFORE:
const validateIdConsistency = (userId, deviceId, ledgerEntry) => {
  const ledgerId = ledgerEntry?.metadata?.profileId || ledgerEntry?.occupantId;
  if (ledgerId && userId && ledgerId !== userId) {
    console.error('[FitnessSession] ID MISMATCH:', {
      userId,
      ledgerId,
      deviceId,
      ledgerOccupantName: ledgerEntry?.occupantName
    });
    this.eventJournal?.log('ID_MISMATCH', { userId, ledgerId, deviceId }, { severity: 'error' });
    return false;
  }
  return true;
};

// AFTER:
const validateIdConsistency = (userSlug, deviceId, ledgerEntry) => {
  // Compare slugs to ensure consistency
  const ledgerSlug = ledgerEntry?.occupantSlug || slugifyId(ledgerEntry?.occupantName);
  if (ledgerSlug && userSlug && ledgerSlug !== userSlug) {
    console.error('[FitnessSession] SLUG MISMATCH:', {
      userSlug,
      ledgerSlug,
      deviceId,
      ledgerOccupantName: ledgerEntry?.occupantName
    });
    this.eventJournal?.log('SLUG_MISMATCH', { userSlug, ledgerSlug, deviceId }, { severity: 'error' });
    return false;
  }
  return true;
};
```

### Tertiary Fix: Update stageUserEntry to include deviceId

**Lines 1495-1522** (Add deviceId parameter):
```javascript
// BEFORE:
const stageUserEntry = (user) => {
  if (!user?.name) return null;
  const slug = slugifyId(user.name);
  if (!slug) return null;
  const snapshot = typeof user.getMetricsSnapshot === 'function' ? user.getMetricsSnapshot() : {};
  const staged = {
    slug,
    metadata: {
      name: user.name,
      groupLabel: user.groupLabel || null,
      source: user.source || null,
      color: snapshot?.zoneColor || user.currentData?.color || null
    },
    metrics: {
      heartRate: sanitizeHeartRate(snapshot?.heartRate ?? user.currentData?.heartRate),
      zoneId: snapshot?.zoneId || user.currentData?.zone || null,
      rpm: sanitizeNumber(snapshot?.rpm),
      power: sanitizeNumber(snapshot?.power),
      distance: sanitizeDistance(snapshot?.distance)
    }
  };
  return staged;
};

// AFTER:
const stageUserEntry = (user, deviceId) => {  // ← Add deviceId param
  if (!user?.name) return null;
  const slug = slugifyId(user.name);
  if (!slug) return null;
  const snapshot = typeof user.getMetricsSnapshot === 'function' ? user.getMetricsSnapshot() : {};
  const staged = {
    slug,
    deviceId,  // ← Include deviceId for debugging
    metadata: {
      name: user.name,
      groupLabel: user.groupLabel || null,
      source: user.source || null,
      color: snapshot?.zoneColor || user.currentData?.color || null
    },
    metrics: {
      heartRate: sanitizeHeartRate(snapshot?.heartRate ?? user.currentData?.heartRate),
      zoneId: snapshot?.zoneId || user.currentData?.zone || null,
      rpm: sanitizeNumber(snapshot?.rpm),
      power: sanitizeNumber(snapshot?.power),
      distance: sanitizeDistance(snapshot?.distance)
    }
  };
  return staged;
};
```

---

## Testing Strategy

### Unit Tests

**Test 1: Verify userMetricMap keying**
```javascript
test('userMetricMap should be keyed by slugifyId(user.name)', () => {
  const session = new FitnessSession();
  // ... setup ...
  session._collectTimelineTick();

  const keys = Array.from(session._testExports.userMetricMap.keys());
  keys.forEach(key => {
    expect(key).toMatch(/^[a-z0-9_]+$/);  // Slugified format
    expect(key).not.toMatch(/^user-/);     // Not user.id format
  });
});
```

**Test 2: Verify currentTickActiveHR contains slugs**
```javascript
test('currentTickActiveHR should contain user slugs, not IDs', () => {
  const session = new FitnessSession();
  // ... setup user "Alan" with user.id = "user-123-abc" ...
  session._collectTimelineTick();

  const activeHR = session._testExports.currentTickActiveHR;
  expect(activeHR.has('alan')).toBe(true);         // Slug
  expect(activeHR.has('user-123-abc')).toBe(false); // NOT user.id
});
```

**Test 3: Verify TreasureBox receives correct keys**
```javascript
test('TreasureBox.processTick should receive slugs', () => {
  const treasureBox = new FitnessTreasureBox();
  const session = new FitnessSession({ treasureBox });

  // Mock user with name "Bob"
  session.userManager.registerUser({ name: 'Bob', id: 'user-456-def' });

  session._collectTimelineTick();

  // Check that TreasureBox perUser is keyed by "Bob" (name), not "user-456-def" (id)
  expect(treasureBox.perUser.has('Bob')).toBe(true);
  expect(treasureBox.perUser.has('user-456-def')).toBe(false);
});
```

### Integration Tests

**Test 4: Verify GovernanceEngine sees active users**
```javascript
test('GovernanceEngine should detect active users after fix', () => {
  const session = new FitnessSession();
  session.userManager.registerUser({ name: 'Alan' });
  session.deviceManager.updateDevice({ id: '7138', type: 'heart_rate', heartRate: 150 });
  session.userManager.assignGuest('7138', 'Alan');

  // Run ticks
  session._collectTimelineTick();
  session._updateGovernanceEngine();

  const state = session.governanceEngine.state;
  expect(state.activeUserCount).toBe(1);  // Should detect Alan
  expect(state.watchers).toContain('Alan');
});
```

---

## Rollback Plan

If the fix causes regressions:

1. **Immediate**: Revert commit with the fix
2. **Temporary workaround**: Patch TreasureBox to slugify incoming activeParticipants:
   ```javascript
   // In TreasureBox.processTick()
   const activeParticipantsNormalized = new Set(
     Array.from(activeParticipants).map(id => {
       // If it looks like a user.id, try to resolve to name
       if (id.startsWith('user-')) {
         const user = this.sessionRef?.userManager?.users?.get(id);
         return user?.name || id;
       }
       return id;
     })
   );
   ```

---

## Conclusion

The entityId/slug refactor in commit `3284b99a` successfully updated most of the codebase to use slugified names instead of `user.id`, but **missed the critical `userMetricMap` keying in `_collectTimelineTick()`**. This created a key format mismatch that cascaded through the entire data flow, breaking governance functionality.

**The fix is straightforward**: Use `staged.slug` instead of `mappedUser.id` when keying `userMetricMap` and populating `currentTickActiveHR`.

**Estimated fix time**: 30 minutes
**Estimated test time**: 1 hour
**Risk level**: Low (scoped change, existing tests should catch regressions)
