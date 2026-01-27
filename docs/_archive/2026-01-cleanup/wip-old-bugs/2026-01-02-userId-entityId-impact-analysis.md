# userId vs EntityId Impact Analysis

## Executive Summary

After analyzing the codebase for areas impacted by the userId/entityId/slug confusion, I found that the system is in a **transitional state** between two identifier schemes:

1. **Legacy (Pre-commit 3284b99a)**: Used `slugifyId(user.name)` (e.g., "alan", "bob") as keys
2. **Phase 1 (Commit 3284b99a)**: Started migrating to `user.id` (e.g., "user-123-abc")
3. **Phase 2 (Ongoing)**: Migrating to `entityId` (e.g., "entity-1735689600000-abc") for session entities

The primary bug identified in `user-id-slug-mismatch-analysis.md` is valid, but **there are additional complications** due to the ongoing Phase 2 migration to entityId-based tracking.

---

## Critical Findings

### 1. **MetricsRecorder.js** - CRITICAL ISSUE

**Status**: Uses `user.id` for timeline keys and activeParticipants Set

**Impact**: HIGH - This is a duplicate of the FitnessSession bug but in a different location

**Location**: `frontend/src/hooks/fitness/MetricsRecorder.js`

**Problems**:
- Line 148: `userMetricMap.set(staged.userId, staged)` - keys by userId
- Line 201-208: Gets `userId = mappedUser.id` and keys userMetricMap by it
- Line 233: `assignMetric(\`user:\${userId}:heart_beats\`, nextBeats)` - **timeline key uses userId**
- Line 239: `activeParticipants.add(userId)` - **adds userId to Set**
- Lines 241-245: All timeline keys use userId format

**Expected Behavior**:
- Should use slugified names or entityId consistently throughout
- Timeline keys should match what consumers expect

**Code Evidence**:
```javascript
// Line 310-332: _stageUserEntry returns userId (not slug!)
_stageUserEntry(user) {
  if (!user?.id) return null;
  const userId = user.id;  // ← Uses user.id

  return {
    userId,  // ← Returns userId, not slug
    metadata: { name: user.name, ... },
    metrics: { ... }
  };
}

// Line 222-245: Uses userId for everything
userMetricMap.forEach((entry, userId) => {
  // ...
  activeParticipants.add(userId);  // ← Set keyed by userId
  assignMetric(`user:${userId}:heart_beats`, nextBeats);  // ← Timeline key
  assignMetric(`user:${userId}:heart_rate`, entry.metrics.heartRate);
});
```

**Fix Required**: Similar to FitnessSession fix - need to use consistent identifier scheme

---

### 2. **ParticipantIdentityResolver.js** - DESIGN ISSUE

**Status**: Service designed to centralize ID resolution, but uses `user.id` for timeline keys

**Impact**: MEDIUM - Helper service that codifies the wrong pattern

**Location**: `frontend/src/hooks/fitness/ParticipantIdentityResolver.js`

**Problems**:
- Line 66: Returns `id: user.id` from resolveByDevice()
- Line 139: `getSeriesKey()` returns `user:${resolved.id}:${metric}` - **uses user.id for timeline keys**
- This service is MEANT to solve the identifier problem but currently propagates user.id usage

**Code Evidence**:
```javascript
// Lines 136-140: getSeriesKey uses user.id
getSeriesKey(deviceId, metric) {
  const resolved = this.resolveByDevice(deviceId);
  if (!resolved) return null;
  return `user:${resolved.id}:${metric}`;  // ← Uses user.id for timeline!
}

// Lines 63-69: resolveByDevice returns user.id
const user = this.userManager?.resolveUserForDevice?.(deviceIdStr);
if (user?.id) {
  return {
    id: user.id,  // ← Returns user.id
    source: 'user',
    name: user.name || null
  };
}
```

**Analysis**:
This service was created to centralize ID resolution logic (see docs/reviews/guest-assignment-service-audit.md Issue #3), but it currently returns `user.id` which perpetuates the mismatch. If this service is the "single source of truth", it needs to be updated to return the correct identifier type.

**Fix Required**: Update getSeriesKey() to return consistent identifier (slug or entityId)

---

### 3. **TreasureBox.js** - TRANSITIONAL STATE

**Status**: Partially migrated to Phase 2 (entityId), but still supports legacy userId

**Impact**: MEDIUM - Complex dual-mode system

**Location**: `frontend/src/hooks/fitness/TreasureBox.js`

**Current Behavior**:
- Line 4-6 comments: "we now use user.id directly" + "Phase 2: TreasureBox now tracks by entityId"
- Line 18: `this.perUser = new Map()` - keyed by either entityId OR userId
- Line 426-431: `recordUserHeartRate()` accepts either entityId or userId as key
- Line 303-318: `processTick()` handles both entity keys and userId keys

**Code Evidence**:
```javascript
// Lines 303-318: processTick handles both identifier types
for (const [accKey, acc] of this.perUser.entries()) {
  // accKey can be either userId or entityId
  const profileId = acc.profileId || accKey;
  const isEntityKey = accKey.startsWith('entity-');

  // For entity keys, check activity by profileId
  // For user keys, check activity by accKey (userId)
  if (!activeParticipants.has(isEntityKey ? profileId : accKey)) {
    acc.highestZone = null;  // Mark inactive
    continue;
  }
}
```

**Analysis**:
TreasureBox is designed to handle BOTH identifier schemes:
1. **Entity mode** (Phase 2): perUser keyed by "entity-1735...", checks activeParticipants for profileId
2. **Legacy mode**: perUser keyed by userId "user-123-abc", checks activeParticipants for userId

The bug occurs because:
- FitnessSession passes `currentTickActiveHR` Set containing `user.id` values
- If TreasureBox.perUser is keyed by entityId, the lookup fails
- If TreasureBox.perUser is keyed by userId, the lookup SHOULD work

**Root Cause**: The migration to entityId is incomplete. Some devices/users use entity-based tracking, others use userId-based tracking, creating inconsistent state.

---

### 4. **ParticipantRoster.js** - CONSISTENT WITH USERID

**Status**: Uses `user.id` consistently throughout

**Impact**: LOW - Appears to be working correctly with userId scheme

**Location**: `frontend/src/hooks/fitness/ParticipantRoster.js`

**Current Behavior**:
- Line 296: `const userId = mappedUser?.id || ...` - gets user.id
- Line 307: `const zoneInfo = zoneLookup.get(userId)` - looks up by userId
- Line 272: Zone lookup keyed by userId from TreasureBox.getUserZoneSnapshot()

**Code Evidence**:
```javascript
// Lines 260-278: _buildZoneLookup uses userId
_buildZoneLookup() {
  const zoneLookup = new Map();

  const zoneSnapshot = this._treasureBox.getUserZoneSnapshot();

  zoneSnapshot.forEach((entry) => {
    if (!entry || !entry.userId) return;
    // Use userId as the key for zone lookup
    zoneLookup.set(entry.userId, {  // ← Keys by userId
      zoneId: entry.zoneId,
      color: entry.color
    });
  });

  return zoneLookup;
}
```

**Analysis**:
ParticipantRoster is internally consistent - it uses userId throughout. The question is whether TreasureBox.getUserZoneSnapshot() returns data keyed by userId or by slug/entityId.

Looking at TreasureBox.getUserZoneSnapshot() (lines 602-620):
```javascript
getUserZoneSnapshot() {
  const snapshot = [];
  this.perUser.forEach((data, key) => {
    // key can be entityId or userId
    const isEntity = key.startsWith?.('entity-');
    snapshot.push({
      user: key,  // Legacy field
      userId: isEntity ? null : key,  // Set to key if NOT entity
      entityId: isEntity ? key : null,  // Set to key if IS entity
      // ...
    });
  });
  return snapshot;
}
```

**Issue**: ParticipantRoster expects `entry.userId` to be populated, but if TreasureBox.perUser is keyed by entityId, then `entry.userId` will be null!

**Fix Required**: ParticipantRoster needs to handle entityId case or TreasureBox needs to always provide userId

---

### 5. **ZoneProfileStore.js** - OK (Profile Configuration)

**Status**: Uses `user.id` for profile storage - this is correct

**Impact**: NONE - Working as intended

**Location**: `frontend/src/hooks/fitness/ZoneProfileStore.js`

**Analysis**:
ZoneProfileStore manages user zone configurations (settings), not real-time tracking. It's appropriate to use `user.id` as the profile identifier since profiles are user-specific, not session-entity-specific.

---

## Identifier Scheme Comparison

| Component | Current Behavior | Expected By | Status |
|-----------|-----------------|-------------|--------|
| **FitnessSession._collectTimelineTick** | Uses `user.id` for userMetricMap & activeHR Set | TreasureBox expects slug or userId | ❌ BUGGY |
| **MetricsRecorder.collectMetrics** | Uses `user.id` for timeline keys & activeParticipants | Same as FitnessSession | ❌ BUGGY |
| **ParticipantIdentityResolver.getSeriesKey** | Returns `user:${user.id}:metric` | Timeline consumers | ❌ BUGGY |
| **TreasureBox.perUser Map** | Keys by entityId OR userId (dual mode) | Receives userId Set from FitnessSession | ⚠️ TRANSITIONAL |
| **TreasureBox.processTick** | Expects userId or profileId in activeParticipants | Receives userId from FitnessSession | ⚠️ COMPLEX |
| **ParticipantRoster.zoneLookup** | Keys by userId | TreasureBox returns userId or entityId | ⚠️ FRAGILE |
| **GovernanceEngine** | Expects slug-based keys (lowercase names) | From ParticipantRoster | ❌ BROKEN |

---

## The Real Problem: Incomplete Migration

The core issue is that the codebase is in the middle of **TWO overlapping migrations**:

### Migration 1: Slug → userId (Commit 3284b99a)
- **Goal**: Replace `slugifyId(user.name)` with `user.id`
- **Status**: Partially complete
- **What broke**: FitnessSession._collectTimelineTick not updated, causing slug vs userId mismatch

### Migration 2: userId → entityId (Phase 2 - Ongoing)
- **Goal**: Replace `user.id` with `entityId` for session-based tracking
- **Status**: In progress
- **What broke**: TreasureBox expects entityId but FitnessSession still provides userId

---

## Recommended Fixes

### Option A: Complete Migration 1 (userId)
1. ✅ Fix FitnessSession._collectTimelineTick to use `user.id` (already documented)
2. ✅ Fix MetricsRecorder to use `user.id` consistently
3. ✅ Ensure TreasureBox.perUser is keyed by `user.id` (not entityId yet)
4. ✅ Update GovernanceEngine to accept userId instead of slugs
5. ❌ Pause Phase 2 migration until Phase 1 is complete

**Pros**: Simplest path forward, gets governance working again quickly
**Cons**: Doesn't support entity-based tracking (needed for guest reassignment)

### Option B: Complete Migration 2 (entityId) - RECOMMENDED
1. ✅ Update FitnessSession to track entityId from ledger
2. ✅ Update MetricsRecorder to use entityId
3. ✅ Update TreasureBox to exclusively use entityId
4. ✅ Update ParticipantRoster to handle entityId
5. ✅ Update GovernanceEngine to work with entityId
6. ✅ Ensure all timeline keys use entityId

**Pros**: Properly supports guest reassignment and session entities
**Cons**: More work, requires careful coordination

### Option C: Revert to Slugs
1. ⏪ Revert commit 3284b99a changes
2. ⏪ Keep using `slugifyId(user.name)` throughout
3. ❌ Abandon entityId concept

**Pros**: Restores working state immediately
**Cons**: Loses architectural improvements, doesn't support multi-session guests

---

## Files Requiring Changes

### Critical (Must Fix)
1. **frontend/src/hooks/fitness/FitnessSession.js**
   - Lines 1635-1696: _collectTimelineTick()
   - Change from `userId = mappedUser.id` to proper identifier

2. **frontend/src/hooks/fitness/MetricsRecorder.js**
   - Lines 148, 201-208: userMetricMap keying
   - Lines 233-245: Timeline key generation
   - Change from userId to proper identifier

3. **frontend/src/hooks/fitness/ParticipantIdentityResolver.js**
   - Line 139: getSeriesKey() method
   - Return proper identifier format

### Important (Should Fix)
4. **frontend/src/hooks/fitness/TreasureBox.js**
   - Decide: entityId-only OR userId-only (no dual mode)
   - Update processTick() expectations
   - Document the chosen identifier scheme clearly

5. **frontend/src/hooks/fitness/ParticipantRoster.js**
   - Lines 260-278: _buildZoneLookup()
   - Handle both userId and entityId from TreasureBox

6. **frontend/src/hooks/fitness/GovernanceEngine.js**
   - Update to accept userId or entityId instead of slugs
   - Lines 291-304: _captureLatestInputs()

### Optional (Nice to Have)
7. **All timeline key generators**
   - Grep for `user:\${` patterns
   - Ensure consistent identifier scheme

---

## Testing Strategy

### Unit Tests Needed
1. Test identifier resolution consistency
2. Test userMetricMap keying matches activeParticipants Set keying
3. Test TreasureBox.processTick with both entityId and userId inputs
4. Test ParticipantRoster.zoneLookup with mixed identifier types

### Integration Tests Needed
1. Full session flow: device → user → entity → timeline → chart
2. Guest reassignment: verify coins transfer, zone continuity
3. Governance detection: verify users detected correctly after fix

### Manual Testing
1. Start session with 2+ users
2. Verify FitnessGovernance overlay shows active users
3. Verify coins accumulate correctly
4. Assign guest, verify continuity
5. Check chart displays all participants

---

## Next Steps

1. **Decide on target identifier scheme** (userId vs entityId)
2. **Create implementation plan** for chosen option
3. **Fix critical files** (FitnessSession, MetricsRecorder)
4. **Update tests** to verify identifier consistency
5. **Validate governance detection** works correctly
6. **Document** the chosen identifier scheme for future developers

---

## Appendix: Identifier Types Explained

| Type | Format | Example | Used For |
|------|--------|---------|----------|
| **Slug** | `slugifyId(name)` | `"alan"`, `"bob"` | Legacy keying, still used in some places |
| **User ID** | `user.id` | `"user-123-abc"` | Persistent user identity across sessions |
| **Entity ID** | `entity-{timestamp}-{hash}` | `"entity-1735689600000-abc"` | Session participation instance |
| **Profile ID** | `ledger.metadata.profileId` | Same as User ID | Points to user profile for settings/zones |
| **Occupant ID** | `ledger.occupantId` | Same as Entity ID or User ID | Currently assigned to device |

**Key Insight**: The system needs ONE canonical identifier type for real-time tracking. Mixing them causes lookup failures and broken functionality.
