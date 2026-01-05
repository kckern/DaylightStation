# EntityId Migration Implementation Strategy

## Goal
Complete the migration from userId-based tracking to entityId-based tracking for real-time session data.

## Key Insight
The infrastructure is already in place:
- `FitnessSession.entityRegistry` tracks all session entities
- `getEntityForDevice(deviceId)` retrieves entity for any device
- Ledger stores entityId in metadata
- TreasureBox has device->entity mapping

## Implementation Plan

### Step 1: Update FitnessSession._collectTimelineTick()
**File**: `frontend/src/hooks/fitness/FitnessSession.js`

**Current behavior** (lines 1633-1696):
```javascript
const userId = mappedUser.id;
userMetricMap.set(userId, staged);
currentTickActiveHR.add(userId);
```

**New behavior**:
```javascript
// Get entityId for this device (Phase 2: entity-based tracking)
const entity = this.getEntityForDevice(deviceId);
const entityId = entity?.entityId;

// Fall back to userId if no entity (backward compatibility during migration)
const trackingId = entityId || userId;

userMetricMap.set(trackingId, staged);
currentTickActiveHR.add(trackingId);
```

**Timeline keys**: Already use correct format via assignMetric()

### Step 2: Update stageUserEntry() to include entityId
**File**: `frontend/src/hooks/fitness/FitnessSession.js`

**Current behavior** (lines 1495-1522):
```javascript
const stageUserEntry = (user, deviceId) => {
  const slug = slugifyId(user.name);
  return { slug, metadata: {...}, metrics: {...} };
};
```

**New behavior**:
```javascript
const stageUserEntry = (user, deviceId) => {
  const slug = slugifyId(user.name);
  const entity = deviceId ? this.getEntityForDevice(deviceId) : null;
  const entityId = entity?.entityId || null;

  return {
    slug,
    entityId,      // NEW: Track entity ID
    profileId: user.id,  // Keep profileId for zone lookups
    metadata: {...},
    metrics: {...}
  };
};
```

### Step 3: Update MetricsRecorder to use entityId
**File**: `frontend/src/hooks/fitness/MetricsRecorder.js`

**Changes needed**:
1. _stageUserEntry() should return entityId instead of userId
2. userMetricMap should be keyed by entityId (or userId fallback)
3. activeParticipants Set should contain entityId values
4. Timeline keys should use entityId: `user:${entityId}:metric` or `entity:${entityId}:metric`

**Note**: MetricsRecorder needs access to entityRegistry or getEntityForDevice method

### Step 4: Update TreasureBox to exclusively use entityId
**File**: `frontend/src/hooks/fitness/TreasureBox.js`

**Current behavior**: Dual mode (entityId OR userId)

**Changes needed**:
1. Remove dual-mode logic from processTick()
2. Enforce entityId-only keys in perUser Map
3. Update getUserZoneSnapshot() to always return entityId
4. Update comments to reflect entityId-only mode
5. Add migration helper to convert old userId entries to entityId

**Key change in processTick()**:
```javascript
// BEFORE (dual mode):
const profileId = acc.profileId || accKey;
const isEntityKey = accKey.startsWith('entity-');
if (!activeParticipants.has(isEntityKey ? profileId : accKey)) { ... }

// AFTER (entityId only):
// activeParticipants contains entityIds
// acc.profileId is used for zone config lookups only
if (!activeParticipants.has(accKey)) {
  acc.highestZone = null;
  continue;
}
```

### Step 5: Update ParticipantRoster to handle entityId
**File**: `frontend/src/hooks/fitness/ParticipantRoster.js`

**Changes needed**:
1. _buildZoneLookup() should key by entityId (not userId)
2. _buildRosterEntry() should include entityId
3. Zone lookup should check both entityId and profileId (for zone config)

**Key change**:
```javascript
// Build zone lookup from TreasureBox (keyed by entityId now)
_buildZoneLookup() {
  const zoneLookup = new Map();
  const zoneSnapshot = this._treasureBox.getUserZoneSnapshot();

  zoneSnapshot.forEach((entry) => {
    if (!entry || !entry.entityId) return;
    zoneLookup.set(entry.entityId, {
      zoneId: entry.zoneId,
      color: entry.color
    });
  });

  return zoneLookup;
}

// In _buildRosterEntry():
const entity = this._session?.getEntityForDevice?.(deviceId);
const entityId = entity?.entityId || userId;  // Fallback to userId
const zoneInfo = zoneLookup.get(entityId);
```

### Step 6: Update GovernanceEngine to work with entityId
**File**: `frontend/src/hooks/fitness/GovernanceEngine.js`

**Current behavior**: Expects slug-based keys

**Changes needed**:
1. Accept entityId-based activeParticipants array
2. userZoneMap should be keyed by entityId
3. Update _captureLatestInputs() to handle entityId

**Key insight**: GovernanceEngine doesn't care WHAT the identifier is, as long as:
- activeParticipants contains the same IDs used in userZoneMap
- Zone data is available for each participant

### Step 7: Ensure all timeline keys use entityId
**Search pattern**: `user:\\$\\{` and `assignMetric\\(`

**Changes needed**:
- FitnessSession: Timeline keys already use correct format
- MetricsRecorder: Update to use entityId instead of userId
- Any other metric assignment locations

## Migration Safety

### Backward Compatibility
During transition, support both entityId and userId:
```javascript
const trackingId = entityId || userId;  // Prefer entityId, fall back to userId
```

### Validation
Add logging to track migration progress:
```javascript
if (!entityId && userId) {
  getLogger().warn('entity_migration.missing_entity', {
    deviceId, userId, userIsGuest: user.source === 'Guest'
  });
}
```

### Testing Checkpoints
1. After Step 1: Verify currentTickActiveHR contains entityIds
2. After Step 3: Verify timeline keys use entityId format
3. After Step 4: Verify TreasureBox.perUser only has entityId keys
4. After Step 6: Verify GovernanceEngine detects users correctly

## Timeline Key Format Decision

**Question**: Should timeline keys use `user:${entityId}:metric` or `entity:${entityId}:metric`?

**Recommendation**: Keep `user:` prefix for backward compatibility
- Existing code searches for "user:" prefix
- Chart helpers expect "user:" format
- EntityId is just a different ID format, not a different data type

**Format**: `user:${entityId}:metric`
**Example**: `user:entity-1735689600000-abc:heart_rate`

## Rollback Plan
If migration causes issues:
1. Revert FitnessSession changes (Step 1)
2. Revert MetricsRecorder changes (Step 3)
3. Keep TreasureBox in dual mode
4. Document which parts completed successfully

## Success Criteria
- ✅ FitnessGovernance overlay detects users
- ✅ Coins accumulate correctly
- ✅ Guest reassignment maintains continuity
- ✅ Chart displays all participants
- ✅ No identifier mismatch errors in console
- ✅ All tests pass
