# Guest Switch Session Transition Design

## Overview

When a device owner changes—whether switching from a registered user to a guest, from one guest to another, or restoring the original owner—the fitness session should treat each occupant as a distinct participant with independent metrics. This document specifies the expected behavior and proposes a technical design to implement "session entity" transitions on device reassignment.

---

## Current State Analysis

### What Happens Today

| Component | Behavior |
|-----------|----------|
| **GuestAssignmentService** | Updates `DeviceAssignmentLedger` with new occupant metadata; logs `ASSIGN_GUEST`/`GUEST_REPLACED` events |
| **UserManager** | Creates or reuses a `User` object keyed by `profileId`; updates `hrDeviceId` binding |
| **TreasureBox.perUser** | Accumulator keyed by userId; coins persist across reassignments if same key is reused |
| **FitnessTimeline** | Series keyed as `user:{userId}:coins_total`, `user:{userId}:heart_rate`; data persists under same key |
| **ParticipantRoster** | Builds roster from active devices; includes historical participants from ledger |
| **ActivityMonitor** | Tracks activity status by userId; no concept of "session entity" vs "profile" |

### Problems

1. **Coins carry over**: If "Alice" switches to "Bob" on device 42, and "Bob" later switches back to "Alice," Alice's `perUser` accumulator still contains coins from her first session segment. Her coin count does not reset.

2. **Timeline conflation**: The timeline series `user:alice:coins_total` contains Alice's entire coin history, including coins earned before and after any guest took over. There's no separation between "Alice Session 1" and "Alice Session 2."

3. **Start time ambiguity**: `User._cumulativeData.sessionStartTime` is set on the first device update and only resets via explicit `resetSession()` calls—which are never triggered by guest assignment.

4. **No transfer window logic**: When switching users, there's no grace period check. If the previous owner joined 30s ago and a guest takes over, there's no mechanism to transfer the brief session segment.

5. **No "drop out" transition**: When a guest takes over, the previous owner simply loses their device binding. They remain in `users` Map and roster history but with no clean "end of participation" marker.

---

## Expected Behavior (User Requirements)

### 1. Name and Profile Picture Change
✅ **Already works**: The UI reads from `DeviceAssignmentLedger` and displays the new occupant's name/avatar.

### 2. Fresh Session Entity for New Occupant

When user B takes over from user A:
- B's coin count starts at **0**
- B's session start time is the **assignment timestamp**
- B gets a fresh timeline series segment
- B's HR readings start accumulating from the switch moment

### 3. Grace Period Transfer (< 1 minute)

If user A joined < 1 minute before B takes over:
- Transfer A's coins to B
- Transfer A's session start time to B
- Treat A as if they "never really joined" (exclude from saved session data)

### 4. Clean Dropout (≥ 1 minute)

If user A was active ≥ 1 minute before B takes over:
- Mark A as "dropped out" with end timestamp
- A's coins and timeline data remain intact and attributed to A
- B starts fresh from the switch moment

### 5. Same Rules for All Transitions

| Transition | Behavior |
|------------|----------|
| Owner → Guest | Apply grace period / dropout logic |
| Guest → Different Guest | Apply grace period / dropout logic |
| Guest → Owner Restored | Apply grace period / dropout logic |
| Owner → Same Owner (no-op) | No change |

---

## Technical Design

### Core Concept: Session Entity vs Profile

Introduce the concept of a **Session Entity** that is distinct from a **User Profile**:

```
User Profile (profileId)     Session Entity (entityId)
├── name: "Alice"            ├── entityId: "entity-1735689600000-abc12"
├── profileId: "alice-123"   ├── profileId: "alice-123" (reference)
├── zones: [...]             ├── deviceId: "42"
└── avatarUrl: "..."         ├── startTime: 1735689600000
                             ├── endTime: null | 1735690200000
                             ├── coins: 45
                             └── timeline: { ... }
```

**Key insight**: A single profile can have multiple session entities (if they leave and rejoin, or use different devices). Timeline data is attributed to entities, not profiles.

### Data Model Changes

#### 1. New: SessionEntityRegistry (in FitnessSession)

```javascript
// FitnessSession.js
this.entityRegistry = new Map(); // entityId -> SessionEntity

class SessionEntity {
  constructor({ profileId, name, deviceId, startTime }) {
    this.entityId = `entity-${startTime}-${Math.random().toString(36).slice(2, 7)}`;
    this.profileId = profileId;
    this.name = name;
    this.deviceId = deviceId;
    this.startTime = startTime;
    this.endTime = null;
    this.status = 'active'; // 'active' | 'dropped' | 'transferred'
    this.coins = 0;
    this.cumulativeData = { /* HR readings, zone buckets, etc. */ };
  }
}
```

#### 2. Modified: TreasureBox.perUser

Change from `Map<profileId, accumulator>` to `Map<entityId, accumulator>`:

```javascript
// TreasureBox.js
this.perUser = new Map(); // NOW: entityId -> accumulator

recordUserHeartRate(entityId, hr) {
  // Use entityId instead of userId/profileId
}
```

#### 3. Modified: Timeline Series Keys

```javascript
// Before: 'user:alice:coins_total'
// After:  'entity:entity-1735689600000-abc12:coins_total'

// Aggregation query for "all of Alice's coins":
// Sum all series where entity.profileId === 'alice-123'
```

#### 4. Modified: DeviceAssignmentLedger Entry

```javascript
{
  deviceId: '42',
  occupantId: 'alice-123',          // profileId (unchanged)
  occupantName: 'Alice',
  occupantType: 'primary',
  entityId: 'entity-1735689600000', // NEW: current session entity
  displacedEntityId: null,          // NEW: previous session entity
  displacedUserId: null,
  metadata: { ... },
  updatedAt: 1735689600000
}
```

### Assignment Flow: GuestAssignmentService.assignGuest()

```javascript
assignGuest(deviceId, assignment) {
  const now = Date.now();
  const key = String(deviceId);
  
  // 1. Get previous assignment
  const previousEntry = this.ledger?.get(key);
  const previousEntityId = previousEntry?.entityId || null;
  const previousStartTime = previousEntry?.updatedAt || 0;
  
  // 2. Grace period check
  const GRACE_PERIOD_MS = 60 * 1000; // 1 minute
  const previousDuration = previousEntry ? (now - previousStartTime) : Infinity;
  const isWithinGracePeriod = previousDuration < GRACE_PERIOD_MS;
  
  // 3. Handle previous entity
  if (previousEntityId && previousEntry) {
    const previousEntity = this.session.entityRegistry.get(previousEntityId);
    
    if (isWithinGracePeriod) {
      // Transfer mode: mark previous as transferred, carry over data
      previousEntity.status = 'transferred';
      previousEntity.endTime = now;
      this.#logEvent('ENTITY_TRANSFERRED', {
        entityId: previousEntityId,
        profileId: previousEntry.occupantId,
        duration: previousDuration,
        coinsTransferred: previousEntity.coins
      });
    } else {
      // Dropout mode: end previous entity cleanly
      previousEntity.status = 'dropped';
      previousEntity.endTime = now;
      this.#logEvent('ENTITY_DROPPED', {
        entityId: previousEntityId,
        profileId: previousEntry.occupantId,
        duration: previousDuration,
        finalCoins: previousEntity.coins
      });
    }
  }
  
  // 4. Create new session entity
  const newEntity = this.session.createSessionEntity({
    profileId: value.profileId,
    name: value.name,
    deviceId: key,
    startTime: now
  });
  
  // 5. If grace period, transfer data
  if (isWithinGracePeriod && previousEntityId) {
    const previousEntity = this.session.entityRegistry.get(previousEntityId);
    newEntity.coins = previousEntity.coins;
    newEntity.startTime = previousEntity.startTime;
    newEntity.cumulativeData = { ...previousEntity.cumulativeData };
    
    // Transfer TreasureBox accumulator
    this.session.treasureBox.transferAccumulator(previousEntityId, newEntity.entityId);
    
    // Transfer timeline series (rename keys)
    this.session.timeline.transferSeries(previousEntityId, newEntity.entityId);
  }
  
  // 6. Update ledger with new entity reference
  const payload = {
    deviceId: key,
    occupantId: value.profileId,
    occupantName: value.name,
    entityId: newEntity.entityId,
    displacedEntityId: previousEntityId,
    displacedUserId: previousEntry?.occupantId || null,
    metadata: { ... },
    updatedAt: now
  };
  
  this.ledger.upsert(payload);
  
  // 7. Update TreasureBox to use new entity
  this.session.treasureBox.setActiveEntity(key, newEntity.entityId);
  
  return { ok: true, entityId: newEntity.entityId };
}
```

### TreasureBox Changes

```javascript
// TreasureBox.js

// NEW: Device -> Entity mapping
this.deviceEntityMap = new Map(); // deviceId -> entityId

setActiveEntity(deviceId, entityId) {
  this.deviceEntityMap.set(String(deviceId), entityId);
}

transferAccumulator(fromEntityId, toEntityId) {
  const fromAcc = this.perUser.get(fromEntityId);
  if (!fromAcc) return;
  
  // Copy accumulator to new entity
  this.perUser.set(toEntityId, { ...fromAcc });
  // Clear original (but keep for historical reference)
  fromAcc.totalCoins = 0;
  fromAcc.highestZone = null;
}

recordUserHeartRate(entityId, hr) {
  // Uses entityId directly (passed from session layer)
}
```

### FitnessSession Changes

```javascript
// FitnessSession.js

createSessionEntity({ profileId, name, deviceId, startTime }) {
  const entity = new SessionEntity({ profileId, name, deviceId, startTime });
  this.entityRegistry.set(entity.entityId, entity);
  
  // Initialize TreasureBox accumulator
  this.treasureBox.perUser.set(entity.entityId, {
    currentIntervalStart: startTime,
    highestZone: null,
    lastHR: null,
    currentColor: 'No Zone',
    lastColor: 'No Zone',
    lastZoneId: null,
    totalCoins: 0
  });
  
  // Initialize timeline series anchor at 0
  this.timeline.assignMetric(`entity:${entity.entityId}:coins_total`, 0);
  
  return entity;
}

// Modified: recordDeviceActivity
recordDeviceActivity(deviceData) {
  const device = this.deviceManager.registerDevice(deviceData);
  if (!device) return;
  
  // Resolve ENTITY for this device (not just user)
  const ledgerEntry = this.userManager.assignmentLedger?.get(device.id);
  const entityId = ledgerEntry?.entityId;
  
  if (!entityId) {
    // No assignment - auto-assign creates entity
    return;
  }
  
  const entity = this.entityRegistry.get(entityId);
  if (!entity || entity.status !== 'active') return;
  
  // Feed TreasureBox with entityId
  if (this.treasureBox && deviceData.type === 'heart_rate') {
    this.treasureBox.recordUserHeartRate(entityId, deviceData.heartRate);
  }
}
```

### Timeline Series Key Strategy

```javascript
// FitnessTimeline.js - Key naming convention

// Per-entity series (detailed tracking):
`entity:${entityId}:heart_rate`
`entity:${entityId}:coins_total`
`entity:${entityId}:zone_id`

// Per-profile aggregates (for UI display of "user's total"):
// Computed on-demand by summing entity series where profileId matches
getProfileCoinsTotal(profileId) {
  let total = 0;
  for (const [entityId, entity] of this.session.entityRegistry) {
    if (entity.profileId === profileId && entity.status !== 'transferred') {
      const series = this.getSeries(`entity:${entityId}:coins_total`);
      total += series[series.length - 1] || 0;
    }
  }
  return total;
}
```

### Session Summary Structure

```yaml
# Saved session data
sessionId: "2026-01-01T00:30:00.000Z"
startTime: 1735689000000
endTime: 1735692600000

entities:
  - entityId: "entity-1735689000000-abc12"
    profileId: "alan-001"
    name: "Alan"
    deviceId: "42"
    startTime: 1735689000000
    endTime: 1735690200000
    status: "dropped"
    coins: 45
    
  - entityId: "entity-1735690200000-def34"
    profileId: "guest-bob-002"
    name: "Bob"
    deviceId: "42"
    startTime: 1735690200000
    endTime: 1735691400000
    status: "transferred"  # < 1 min, transferred to next
    coins: 0  # coins went to next entity
    
  - entityId: "entity-1735690200000-ghi56"  # inherited startTime from transfer
    profileId: "guest-charlie-003"
    name: "Charlie"
    deviceId: "42"
    startTime: 1735690200000  # inherited from Bob
    endTime: null
    status: "active"
    coins: 120  # includes Bob's brief segment

timeline:
  series:
    'entity:entity-1735689000000-abc12:coins_total': [[0,1],[5,2],[10,3]...]
    'entity:entity-1735690200000-ghi56:coins_total': [[0,20],[10,25]...]  # Charlie's full timeline
```

---

## UI Implications

### Participant Cards

- Display **entity** data, not profile aggregates
- Card shows: current entity's coins, current entity's session duration
- Historical view can show all entities for a profile

### Race Chart

- Each **active entity** is a separate line
- Dropped entities freeze at their final coin count
- Transferred entities are excluded (their data merged into successor)

### Session Summary

- Group by device, show entity transitions
- "Alan used device 42 for 20 min, earned 45 coins, then dropped out"
- "Bob took over for 45s, transferred to Charlie"
- "Charlie continued for 40 min, earned 120 coins"

---

## Migration Path

### Phase 1: Entity Registry Foundation ✅ COMPLETE
1. ✅ Add `SessionEntity` class and `entityRegistry` to FitnessSession
2. ✅ Add `entityId` field to DeviceAssignmentLedger entries
3. ✅ Create entities on device assignment (no transfer logic yet)

**Implementation Notes:**
- Created [SessionEntity.js](frontend/src/hooks/fitness/SessionEntity.js) with `SessionEntity` and `SessionEntityRegistry` classes
- Added `entityRegistry` to `FitnessSession` constructor with helper methods `createSessionEntity()`, `getEntityForDevice()`, `endSessionEntity()`
- Updated `DeviceAssignmentLedger.upsert()` and `#normalizeGuestAssignment()` to track `entityId` and `displacedEntityId`
- Modified `GuestAssignmentService.assignGuest()` to create entities and end previous entities on guest replacement
- Updated `GuestAssignmentService.clearGuest()` to end entity when assignment is cleared
- Modified `UserManager.assignGuest()` to pass `entityId` through to ledger
- Session summary now includes `entities` array

### Phase 2: TreasureBox Entity Awareness ✅ COMPLETE
1. ✅ Switch TreasureBox.perUser to entity-keyed
2. ✅ Add `setActiveEntity()` and `transferAccumulator()` methods
3. ✅ Update `recordUserHeartRate()` to accept entityId

**Implementation Notes:**
- Added `_deviceEntityMap` to TreasureBox constructor for device → entity routing
- Added `setActiveEntity(deviceId, entityId)` to set active entity for a device
- Added `getActiveEntity(deviceId)` to query current entity
- Added `transferAccumulator(fromEntityId, toEntityId)` for grace period transfers
- Added `initializeEntity(entityId, startTime)` to create fresh accumulator
- Added `_createAccumulator(startTime)` helper for consistent accumulator creation
- Updated `recordUserHeartRate()` to work with both entityId and userId
- Added `recordHeartRateForDevice(deviceId, hr, options)` for entity-based routing
- Updated `getUserZoneSnapshot()` to include `entityId` and `totalCoins` fields
- Added `getEntityTotals()` for entity-only coin queries
- Updated `FitnessSession.createSessionEntity()` to initialize TreasureBox and set active entity
- Updated `FitnessSession.recordDeviceActivity()` to use `recordHeartRateForDevice()` with fallback

### Phase 3: Timeline Migration ✅ COMPLETE
1. ✅ Change series keys from `user:X` to `entity:X`
2. ✅ Add profile aggregation helpers
3. ✅ Update chart components to use entity series

**Implementation Notes:**
- Added `KEY_PREFIX` constants to FitnessTimeline for `user:`, `entity:`, `device:`, `global:` prefixes
- Added `getAllEntityIds()` to FitnessTimeline to get all entity IDs from series keys
- Added `getEntitySeries(entityId, metric)` to FitnessTimeline for direct entity series access
- Added `getEntityLatestValue(entityId, metric)` to FitnessTimeline
- Added `transferEntitySeries(fromEntityId, toEntityId)` to FitnessTimeline for grace period transfers
- Updated `_collectTimelineTick()` in FitnessSession to dual-write to both `user:` and `entity:` series
- Added `assignUserMetric()` helper to write metrics to both user and entity series
- Added `resolveEntityIdForDevice()` helper to look up entityId from ledger
- Updated `stageUserEntry()` to include entityId and deviceId
- Added `_isEntityActive()` helper to check if entity has active HR
- Added tracking for `_entitiesWithCoinsRecorded` for entity coins initialization
- Added `getEntitiesForProfile(profileId)` to FitnessSession
- Added `getProfileCoinsTotal(profileId)` to FitnessSession for aggregated coins across entities
- Added `getProfileTimelineSeries(profileId, metric)` to FitnessSession for aggregated series
- Updated FitnessContext `normalizeKind()` to support 'entity' kind
- Updated FitnessContext `buildSeriesKey()` to handle entityId
- Added `getEntitySeries()` selector to FitnessContext
- Added `getParticipantSeries()` selector that prefers entity data with user fallback
- Exposed `entityRegistry`, `getEntitiesForProfile`, `getProfileCoinsTotal`, `getProfileTimelineSeries` in context

### Phase 4: Grace Period Transfer ✅ COMPLETE
1. ✅ Implement transfer logic in `assignGuest()`
2. ✅ Add `ENTITY_TRANSFERRED` / `ENTITY_DROPPED` / `GRACE_PERIOD_TRANSFER` events
3. ✅ Implement timeline series transfer

**Implementation Notes:**
- Added `GRACE_PERIOD_MS` constant (60 seconds) to GuestAssignmentService
- Updated `assignGuest()` to check if previous assignment is within grace period
- If within grace period: new entity inherits `startTime` from previous, data is transferred
- Added `transferSessionEntity(fromEntityId, toEntityId)` to FitnessSession to orchestrate transfer
- Transfer includes: TreasureBox accumulator (coins), timeline series (all metrics)
- Source entity is marked as `'transferred'` with reference to destination
- Added `GRACE_PERIOD_TRANSFER` event for telemetry when transfer occurs
- `ENTITY_TRANSFERRED` event includes `coinsTransferred` and `seriesTransferred` counts

### Phase 5: UI Updates ✅ COMPLETE
1. ✅ Update participant cards to show entity data
2. ✅ Update race chart for entity-aware rendering
3. ✅ Update session summary export

**Implementation Notes:**
- Updated `ParticipantRoster._buildRosterEntry()` to include `entityId` and `entityStartTime` from DeviceAssignmentLedger
- Updated `buildBeatsSeries()` in FitnessChart.helpers.js to accept `getEntitySeries` option
- When roster entry has `entityId`, `buildBeatsSeries()` prefers entity series over user series
- Added `getSeriesForParticipant()` helper that tries entity series first, then falls back to user series
- Updated `useRaceChartData` and `useRaceChartWithHistory` hooks to accept and pass `getEntitySeries`
- Updated `FitnessChartApp` to extract `getEntityTimelineSeries` from plugin and pass to chart hooks
- Updated `useFitnessPlugin` to expose `getEntityTimelineSeries`, `getParticipantTimelineSeries`, `entityRegistry`, `getEntitiesForProfile`, `getProfileCoinsTotal`
- Session summary already includes `entities` array from `entityRegistry.snapshot()` (added in Phase 1)
- Each entity summary includes: `entityId`, `profileId`, `name`, `deviceId`, `startTime`, `endTime`, `durationMs`, `status`, `coins`, `transferredTo`, `transferReason`

---

## Test Scenarios

| Scenario | Setup | Expected Result |
|----------|-------|-----------------|
| Owner → Guest (> 1m) | Alan on device 42 for 5 min, then Bob takes over | Alan: dropped, 25 coins; Bob: starts at 0 |
| Owner → Guest (< 1m) | Alan on device 42 for 30s, then Bob takes over | Alan: transferred, excluded; Bob: inherits Alan's 30s segment |
| Guest → Guest (> 1m) | Bob on device 42 for 3 min, then Charlie takes over | Bob: dropped, keeps coins; Charlie: starts at 0 |
| Guest → Guest (< 1m) | Bob on device 42 for 20s, then Charlie takes over | Bob: transferred; Charlie: inherits Bob's segment |
| Guest → Owner Restored | Bob on device 42 for 10 min, then Alan returns | Bob: dropped; Alan: NEW entity (not continuation of original) |
| Same user (no-op) | Alan on device 42, "assign" Alan again | No change, same entity continues |

---

## Event Journal Events

| Event | Payload | Description |
|-------|---------|-------------|
| `ENTITY_CREATED` | `{ entityId, profileId, deviceId, startTime }` | New session entity started |
| `ENTITY_DROPPED` | `{ entityId, profileId, duration, finalCoins }` | Entity ended due to reassignment (≥ grace period) |
| `ENTITY_TRANSFERRED` | `{ entityId, profileId, duration, coinsTransferred }` | Entity merged into successor (< grace period) |
| `ENTITY_ENDED` | `{ entityId, reason: 'session_end' \| 'device_removed' }` | Entity ended for non-reassignment reason |

---

## Configuration

```yaml
# config/apps/fitness.yml
fitness:
  session:
    gracePeriodMs: 60000  # 1 minute default
    allowGracePeriodTransfer: true
    trackEntityHistory: true
```

---

## Summary

This design introduces **Session Entities** as the unit of participation tracking, distinct from User Profiles. Each device assignment creates a new entity with fresh metrics. A configurable grace period allows brief occupancy segments to transfer to successors, while longer segments result in clean dropouts with preserved data.

The key architectural change is moving from profile-keyed accumulators to entity-keyed accumulators, with entities referencing profiles for metadata (name, avatar, zones) while maintaining independent session state (coins, start time, timeline data).
