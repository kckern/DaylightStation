# GuestAssignmentService Audit Report

**Date:** January 1, 2026  
**Scope:** Relationship between `GuestAssignmentService`, `fitnessSession`, and `FitnessChart.jsx`

---

## Executive Summary

The `GuestAssignmentService` is a service layer that encapsulates guest assignment operations for the fitness module. It acts as an intermediary between the React context (`FitnessContext`) and the underlying `FitnessSession`/`UserManager` subsystems. The `FitnessChart` component consumes session data indirectly through the context and timeline series, but has **no direct dependency** on `GuestAssignmentService`.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      FitnessContext                              │
│  ┌─────────────────────┐    ┌────────────────────────────────┐ │
│  │ GuestAssignmentService │ → │ FitnessSession                 │ │
│  │  - assignGuest()       │    │  - userManager                 │ │
│  │  - clearGuest()        │    │  - timeline (series data)      │ │
│  │  - snapshotLedger()    │    │  - activityMonitor            │ │
│  └─────────────────────┘    │  - treasureBox (coins)          │ │
│            ↑                   └────────────────────────────────┘ │
│            │                              ↓                       │
│  ┌─────────────────────┐    ┌────────────────────────────────┐ │
│  │ DeviceAssignmentLedger │   │ ParticipantRoster              │ │
│  │  - entries (Map)        │   │  - roster entries              │ │
│  │  - upsert/remove        │   │  - profileId, hrDeviceId       │ │
│  └─────────────────────┘    └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                      FitnessChartApp                             │
│  Consumes via useFitnessPlugin():                                │
│    - participants (roster)                                       │
│    - getUserTimelineSeries() → coins_total, heart_rate, zone_id  │
│    - timebase                                                    │
│    - activityMonitor                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Analysis

### 1. GuestAssignmentService

**File:** [frontend/src/hooks/fitness/GuestAssignmentService.js](../../frontend/src/hooks/fitness/GuestAssignmentService.js)

#### Purpose
Encapsulates guest assignment operations with validated payloads and structured responses.

#### API Surface

| Method | Signature | Returns |
|--------|-----------|---------|
| `assignGuest` | `(deviceId, assignment)` | `{ ok, code, message?, data? }` |
| `clearGuest` | `(deviceId)` | `{ ok, code, message?, data? }` |
| `snapshotLedger` | `()` | `Array` of ledger entries |

#### Dependencies
- **Constructor params:** `{ session, ledger }`
- **Internal:** `session.userManager.assignGuest()`, `session.eventJournal`

#### Validation Logic
```javascript
validateGuestAssignmentPayload(rawInput) {
  // Accepts string (name only) or object with:
  // - name: string (required, defaults to 'Guest')
  // - zones: array (optional zone overrides)
  // - baseUserName: string (optional, displaced primary user)
  // - profileId: string (optional, explicit ID)
}
```

---

### 2. FitnessSession.summary (aka `fitnessSession`)

**File:** [frontend/src/hooks/fitness/FitnessSession.js#L2030](../../frontend/src/hooks/fitness/FitnessSession.js#L2030)

The `fitnessSession` context value is the `session?.summary` getter from `FitnessSession`:

```javascript
// FitnessContext.jsx:1620
fitnessSession: session?.summary,
```

#### Summary Structure
```typescript
interface FitnessSessionSummary {
  sessionId: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  roster: RosterEntry[];
  deviceAssignments: LedgerEntry[];  // ← From GuestAssignmentService ledger
  voiceMemos: VoiceMemoSummary;
  treasureBox: TreasureBoxSummary;
  timeline: TimelineSummary;
  timebase: TimebaseConfig;
  events: TimelineEvent[];
}
```

#### Key Observation
The `deviceAssignments` in the session summary comes directly from `GuestAssignmentService`'s underlying ledger:
```javascript
const deviceAssignments = this.userManager?.assignmentLedger?.snapshot?.() || [];
```

---

### 3. FitnessChart / FitnessChartApp

**Files:**
- [frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.jsx](../../frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.jsx) - Thin wrapper
- [frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx) - Implementation

#### Data Flow

1. **Roster Source:** `participants` from `useFitnessPlugin('fitness_chart')`
2. **Series Data:** `getUserTimelineSeries(profileId, metricType)`
   - `coins_total` - Cumulative beats/coins for Y-axis
   - `heart_rate` - Raw HR for activity detection
   - `zone_id` - Zone color mapping
3. **Activity Tracking:** `activityMonitor` for dropout detection

#### Chart Data Construction

```javascript
// useRaceChartData hook
const { beats, zones, active } = buildBeatsSeries(entry, getSeries, timebase, { activityMonitor });
const segments = buildSegments(beats, zones, active);
```

The `profileId` used for series lookup comes from roster entries:
```javascript
const profileId = entry.profileId || entry.id || entry.hrDeviceId || String(idx);
```

---

## Relationship Analysis

### Direct Dependencies

| Component | Depends On GuestAssignmentService | Depends On fitnessSession |
|-----------|-----------------------------------|---------------------------|
| FitnessContext | ✅ Yes (creates & exposes) | ✅ Yes (owns session) |
| FitnessChartApp | ❌ No | ❌ Indirect (via participants) |
| DeviceAssignmentLedger | ❌ No (is dependency of) | ❌ No |
| UserManager | ❌ No (is called by) | ✅ Yes (is owned by) |

### Indirect Data Flow

```
GuestAssignmentService.assignGuest()
    → session.userManager.assignGuest(deviceId, name, metadata)
        → ledger.upsert({ deviceId, occupantId, ... })
        → UserManager creates/updates User object
            → User.hrDeviceId = deviceId
    
Session tick processing:
    → FitnessSession._collectTimelineTick()
        → timeline.pushUserSample(profileId, { hr, zone, coins })
    
FitnessChartApp render:
    → useFitnessPlugin() → participants (from roster)
        → roster built from devices + ledger assignments
    → getUserTimelineSeries(profileId, 'coins_total')
        → timeline.series[profileId:coins]
```

---

## Key Findings

### 1. ✅ Clean Separation of Concerns
`GuestAssignmentService` properly encapsulates mutation logic. The chart component only reads derived data through the timeline series.

### 2. ✅ ID Consistency Improvements
The codebase has moved away from `slugifyId()` to explicit `profileId` values, reducing name-based collision issues:
```javascript
// Old (problematic):
const occupantSlug = slugifyId(value.name);

// New (explicit):
const occupantId = metadata.profileId || value.profileId;
```

### 3. ⚠️ Potential ID Mismatch Risk

**DEEP DIVE: ID Flow Analysis**

The chart looks up series by `profileId`, which must match the key used when recording series data. Let's trace the complete ID flow:

#### Recording Path (FitnessSession._collectTimelineTick)
```
Device broadcasts HR → DeviceManager.updateDevice(deviceId)
                     → UserManager.resolveUserForDevice(deviceId)
                     → returns User with user.id
                     → Timeline records: `user:${userId}:heart_rate`, `user:${userId}:coins_total`
```

**Key Line** ([FitnessSession.js#L1280](../../frontend/src/hooks/fitness/FitnessSession.js#L1280)):
```javascript
assignMetric(`user:${userId}:heart_rate`, entry.metrics.heartRate);
```

#### Lookup Path (FitnessChart.helpers.buildBeatsSeries)
```
rosterEntry with profileId → normalizeId(rosterEntry)
                           → getSeries(targetId, 'coins_total')
                           → buildSeriesKey({ kind: 'user', id: targetId, metric: 'coins_total' })
                           → returns `user:${targetId}:coins_total`
```

**Key Line** ([FitnessChart.helpers.js#L122](../../frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js#L122)):
```javascript
const targetId = normalizeId(rosterEntry);
// normalizeId returns: entry.id || entry.profileId || entry.name || entry.hrDeviceId
```

#### Risk Scenario (Detailed)

| Step | ID Used | Source |
|------|---------|--------|
| 1. Guest assigned | `guest-1735689600000` | `UserManager.assignGuest()` auto-generates |
| 2. User object created | `guest-1735689600000` | From `#ensureUserFromAssignment()` |
| 3. Tick records series | `user:guest-1735689600000:coins_total` | `_collectTimelineTick()` uses `user.id` |
| 4. Roster built | `profileId: 'guest-1735689600000'` | From `ParticipantRoster._buildRosterEntry()` |
| 5. Chart lookup | `user:guest-1735689600000:coins_total` | ✅ Match |

**Where it breaks:**

| Step | Problem | Consequence |
|------|---------|-------------|
| Ledger uses `occupantId` | May not match `user.id` | Series recorded under different key |
| Old devices | No ledger entry | Falls back to device ID |
| Renamed guests | Different ID generated | Historical data orphaned |

#### Current Mitigation Status

| Location | Status | Code |
|----------|--------|------|
| UserManager.assignGuest() | ✅ Fixed | Uses `metadata.profileId` or generates `guest-{timestamp}` |
| ParticipantRoster._buildRosterEntry() | ✅ Fixed | Uses `mappedUser?.id \|\| guestEntry?.occupantId` |
| FitnessChart.helpers.normalizeId() | ⚠️ Fragile | Falls back through multiple fields |

#### Remediation Plan

**Priority 1: Add ID Consistency Validation**

Add a validation check in `_collectTimelineTick()` before recording:

```javascript
// In FitnessSession.js, before assignMetric calls
const validateIdConsistency = (userId, device, ledgerEntry) => {
  const ledgerId = ledgerEntry?.occupantId || ledgerEntry?.metadata?.profileId;
  if (ledgerId && ledgerId !== userId) {
    console.error('[FitnessSession] ID MISMATCH:', {
      userId,
      ledgerId,
      deviceId: device.id,
      ledgerOccupantName: ledgerEntry?.occupantName
    });
    // Emit event for telemetry
    this.eventJournal?.log('ID_MISMATCH', { userId, ledgerId, deviceId: device.id });
  }
};
```

**Priority 2: Create ParticipantIdentityResolver Service**

Extract ID resolution into a single service:

```javascript
// New file: frontend/src/hooks/fitness/ParticipantIdentityResolver.js
export class ParticipantIdentityResolver {
  constructor({ userManager, ledger }) {
    this.userManager = userManager;
    this.ledger = ledger;
  }

  /**
   * Resolve canonical ID for a participant
   * @param {string} deviceId - Device ID
   * @returns {{ id: string, source: 'user' | 'ledger' | 'device' } | null}
   */
  resolveId(deviceId) {
    const ledgerEntry = this.ledger?.get(deviceId);
    if (ledgerEntry?.metadata?.profileId) {
      return { id: ledgerEntry.metadata.profileId, source: 'ledger' };
    }
    const user = this.userManager?.resolveUserForDevice(deviceId);
    if (user?.id) {
      return { id: user.id, source: 'user' };
    }
    return { id: deviceId, source: 'device' };
  }

  /**
   * Get the series key for a participant and metric
   */
  getSeriesKey(deviceId, metric) {
    const resolved = this.resolveId(deviceId);
    return resolved ? `user:${resolved.id}:${metric}` : null;
  }
}
```

**Priority 3: Update FitnessChart.helpers.normalizeId()**

Replace fragile fallback chain with explicit resolver:

```javascript
// Current (fragile):
const normalizeId = (entry) => {
  return entry.id || entry.profileId || entry.name || entry.hrDeviceId || null;
};

// Proposed (explicit):
const normalizeId = (entry) => {
  // Prefer explicit canonical ID
  const canonicalId = entry.id || entry.profileId;
  if (canonicalId) return canonicalId;
  
  // Log fallback usage for debugging
  console.warn('[FitnessChart] No canonical ID, using fallback:', {
    name: entry.name,
    hrDeviceId: entry.hrDeviceId
  });
  return entry.name || entry.hrDeviceId || null;
};
```

---

### 4. ⚠️ Ledger ↔ Roster Sync Gap

**DEEP DIVE: State Divergence Analysis**

The roster is built by iterating **active devices**, while the ledger persists **all assignments**. This creates a state divergence when devices go offline.

#### State Ownership

| State | Owner | Persistence |
|-------|-------|-------------|
| Device presence | DeviceManager | Ephemeral (cleared on timeout) |
| Guest assignment | DeviceAssignmentLedger | Session-persistent |
| Roster entries | ParticipantRoster | Computed (device + ledger merge) |
| Historical IDs | FitnessSession._historicalParticipants | Session-persistent |
| Timeline series | FitnessTimeline | Session-persistent |

#### Divergence Scenario

```
T=0: Device 7138 broadcasts → User "Alan" created → Ledger: {7138: Alan}
     Roster: [Alan] ✓
     
T=60s: Device 7138 goes inactive (timeout)
       Ledger: {7138: Alan} (still present)
       Roster: [] (device removed from iteration)
       
T=65s: Chart tries to render Alan
       - Present roster: empty
       - Historical: ["Alan"]
       - useRaceChartWithHistory: loads from participantCache
       - Series data: exists in timeline ✓
       - Result: Alan shows as "absent" (gray badge) ✓
       
T=120s: Device 7138 broadcasts again
        - DeviceManager recreates device
        - UserManager.resolveUserForDevice(7138) → User "Alan"
        - Ledger still has {7138: Alan} ✓
        - Roster: [Alan] ✓
```

#### Where Sync Breaks

| Scenario | Ledger State | Roster State | Chart Behavior |
|----------|--------------|--------------|----------------|
| Normal operation | `{7138: Alan}` | `[Alan]` | ✅ Shows avatar |
| Device timeout | `{7138: Alan}` | `[]` | ✅ Shows dropout badge |
| Guest reassigned | `{7138: Bob}` | `[Bob]` | ⚠️ Alan's data orphaned |
| Device cleared | `{}` | `[]` | ❌ No way to recover Alan |

#### Current Mitigation Status

| Mechanism | Location | Purpose | Status |
|-----------|----------|---------|--------|
| Historical tracking | `ParticipantRoster._historicalParticipants` | Track all who joined | ✅ Works |
| Timeline series | `FitnessTimeline.series` | Persists all data | ✅ Works |
| participantCache | `useRaceChartWithHistory` | React-side persistence | ✅ Works |
| getHistoricalParticipants() | `FitnessSession` | Returns all known IDs | ✅ Works |

#### Remediation Plan

**Priority 1: Add Ledger → Roster Reconciliation**

Add a method to recover roster entries from ledger when devices are absent:

```javascript
// In ParticipantRoster.js
getFullRoster() {
  const deviceRoster = this.getRoster();  // Current behavior
  const deviceIds = new Set(deviceRoster.map(e => e.hrDeviceId));
  
  // Add ledger entries for devices not currently broadcasting
  const ledgerEntries = this._userManager?.assignmentLedger?.snapshot?.() || [];
  ledgerEntries.forEach(entry => {
    if (!entry.deviceId || deviceIds.has(entry.deviceId)) return;
    
    // Create "inactive" roster entry from ledger
    const ghostEntry = {
      name: entry.occupantName || entry.metadata?.name,
      displayLabel: entry.occupantName || entry.metadata?.name,
      profileId: entry.metadata?.profileId || entry.occupantId,
      id: entry.metadata?.profileId || entry.occupantId,
      hrDeviceId: entry.deviceId,
      heartRate: null,
      zoneId: null,
      zoneColor: null,
      isActive: false,
      status: 'removed',
      _source: 'ledger'  // For debugging
    };
    deviceRoster.push(ghostEntry);
  });
  
  return deviceRoster;
}
```

**Priority 2: Add Ledger Cleanup on Guest Reassignment**

When a guest is reassigned to a device that had a different guest:

```javascript
// In GuestAssignmentService.assignGuest()
assignGuest(deviceId, assignment) {
  // ... existing validation ...
  
  // Archive previous assignment if different guest
  const previousEntry = this.ledger?.get(deviceId);
  if (previousEntry && previousEntry.occupantId !== value.profileId) {
    this.#logEvent('GUEST_REPLACED', {
      deviceId,
      previousOccupantId: previousEntry.occupantId,
      previousOccupantName: previousEntry.occupantName,
      newOccupantId: value.profileId,
      newOccupantName: value.name
    });
    // Archive the previous assignment for historical reference
    this.session?.archiveParticipant?.(previousEntry.occupantId, {
      reason: 'replaced',
      replacedBy: value.profileId
    });
  }
  
  // ... rest of method ...
}
```

**Priority 3: Add Telemetry for Divergence Detection**

```javascript
// In FitnessContext.jsx, during forceUpdate
const detectDivergence = () => {
  const ledgerCount = guestAssignmentServiceRef.current?.snapshotLedger()?.length || 0;
  const rosterCount = session?.roster?.length || 0;
  const chartCount = /* from FitnessChartApp */;
  
  if (ledgerCount !== rosterCount || rosterCount !== chartCount) {
    console.warn('[FitnessContext] State divergence detected:', {
      ledgerCount,
      rosterCount,
      chartCount,
      ledgerIds: /* ... */,
      rosterIds: /* ... */
    });
  }
};
```

### 5. ✅ Activity Monitoring Integration
Both `GuestAssignmentService` (via event journal) and `FitnessChartApp` (via `activityMonitor`) use the centralized `ActivityMonitor` for tracking user presence/dropout:

```javascript
// GuestAssignmentService logs to eventJournal
this.#logEvent('ASSIGN_GUEST', { deviceId, occupantName, occupantId });

// FitnessChartApp uses activityMonitor
const dropoutMarkers = activityMonitor.getAllDropoutEvents();
```

---

## Data Type Reference

### DeviceAssignmentLedger Entry
```typescript
interface LedgerEntry {
  deviceId: string;
  occupantSlug: string | null;  // Legacy
  occupantName: string | null;
  occupantType: 'guest' | 'primary';
  displacedSlug: string | null;  // Legacy
  overridesHash: string | null;  // JSON.stringify(zones)
  metadata: {
    name: string;
    profileId: string;
    zones?: ZoneConfig[];
    baseUserName?: string;
  };
  updatedAt: number;
}
```

### Roster Entry (used by FitnessChart)
```typescript
interface RosterEntry {
  name: string;
  displayLabel: string;
  profileId: string;        // Used for series lookup
  hrDeviceId: string;
  heartRate: number | null;
  zoneId: string | null;
  zoneColor: string | null;
  avatarUrl: string | null;
  isGuest: boolean;
  baseUserName?: string;
  isActive?: boolean;       // From DeviceManager
}
```

---

## Recommendations

### Immediate Actions (This Sprint)

1. **Add ID Consistency Validation** - Add logging/telemetry when `userId` used for timeline recording doesn't match `ledger.occupantId`

2. **Defensive Logging in Chart Helpers** - Log when chart cannot find series for a roster entry:
```javascript
if (!coinsRaw && !beatsRaw && !heartRate?.length) {
  console.warn('[FitnessChart] No series data for participant', { profileId, name });
}
```

3. **Validate profileId in GuestAssignmentService**:
```javascript
if (!value.profileId) {
  console.warn('[GuestAssignmentService] No profileId in assignment, generating fallback');
}
```

### Short-Term (Next Sprint)

4. **Create ParticipantIdentityResolver Service** - Single source of truth for ID resolution that both assignment and chart rendering use

5. **Add getFullRoster() Method** - Recover roster entries from ledger when devices are absent

6. **Add State Divergence Telemetry** - Detect when ledger, roster, and chart counts diverge

### Medium-Term (Next Month)

7. **Unify ID Resolution** - Migrate all ID resolution to `ParticipantIdentityResolver`

8. **Add Integration Tests** - Test ledger ↔ chart sync across device timeout/reconnect scenarios

9. **Extract Chart Data Builder** - Dedicated service for chart data construction, testable independently

### Long-Term (Next Quarter)

10. **Consider Event Sourcing** - Replay assignments from event journal for full audit trail

11. **Add Property-Based Tests** - Fuzz testing for ID collision scenarios

---

## Test Coverage Gaps

| Area | Current Coverage | Priority | Recommendation |
|------|------------------|----------|----------------|
| GuestAssignmentService | ⚠️ Partial | P1 | Add unit tests for edge cases (null assignment, same guest re-assign) |
| ID consistency | ❌ None | P1 | Add test: assign guest → verify series key matches roster profileId |
| Ledger ↔ Chart sync | ❌ None | P2 | Add integration test: device timeout → chart shows dropout |
| Historical participant persistence | ⚠️ Partial | P2 | Add E2E test for dropout → rejoin with same ID |
| ID collision scenarios | ❌ None | P3 | Add property-based tests with random guest names |
| Guest reassignment | ❌ None | P2 | Add test: reassign device to different guest → verify data continuity |

---

## Implementation Checklist

### Phase 1: Observability (Week 1) ✅ COMPLETED
- [x] Add ID consistency validation logging in `_collectTimelineTick()` - [FitnessSession.js](../../frontend/src/hooks/fitness/FitnessSession.js)
- [x] Add defensive logging in `buildBeatsSeries()` for missing series - [FitnessChart.helpers.js](../../frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js)
- [x] Add state divergence detection via `normalizeId()` warnings - [FitnessChart.helpers.js](../../frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js)

### Phase 2: Hardening (Week 2) ✅ COMPLETED
- [x] Create `ParticipantIdentityResolver` service - [ParticipantIdentityResolver.js](../../frontend/src/hooks/fitness/ParticipantIdentityResolver.js)
- [x] Update `normalizeId()` to use explicit IDs only with fallback warnings - [FitnessChart.helpers.js](../../frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js)
- [x] Add `getFullRoster()` method to `ParticipantRoster` - [ParticipantRoster.js](../../frontend/src/hooks/fitness/ParticipantRoster.js)
- [x] Add `GUEST_REPLACED` event logging in `GuestAssignmentService` - [GuestAssignmentService.js](../../frontend/src/hooks/fitness/GuestAssignmentService.js)

### Phase 3: Testing (Week 3)
- [ ] Unit tests for ID resolution edge cases
- [ ] Integration test for device timeout → chart sync
- [ ] Property-based tests for ID collisions

### Phase 4: Migration (Week 4)
- [ ] Migrate `_collectTimelineTick()` to use `ParticipantIdentityResolver`
- [ ] Migrate `buildBeatsSeries()` to use `ParticipantIdentityResolver`
- [ ] Remove legacy fallback chains

---

## Conclusion

The `GuestAssignmentService` is well-encapsulated and properly isolated from the `FitnessChart` rendering logic. The data flows through the session's timeline series, with roster entries providing the bridge between assignment state and chart display. The main risks are around ID consistency between assignment-time and render-time, which have been mitigated by the move to explicit `profileId` values.

The `fitnessSession` summary provides a snapshot view of assignments via `deviceAssignments`, but the chart primarily uses the roster (built from live device state + ledger) rather than the summary directly.
