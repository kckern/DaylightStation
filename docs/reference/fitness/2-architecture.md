# Fitness App Data Flow Architecture

**Date:** 2026-01-03  
**Status:** Living Document  
**Purpose:** Document how participant data flows through the FitnessApp subsystems

---

## High-Level Data Flow

```
┌─────────────────┐
│  Heart Rate     │
│  Devices (BLE)  │
└────────┬────────┘
         │ (deviceId, HR value)
         ↓
┌─────────────────┐
│ DeviceManager   │  ← Receives raw sensor data
└────────┬────────┘
         │ (deviceId → HR)
         ↓
┌─────────────────┐
│ Device          │  ← Maps devices to users
│ Assignment      │
│ Ledger          │
└────────┬────────┘
         │ (deviceId → userId)
         ↓
┌─────────────────┐
│ Participant     │  ← Enriches with zone info
│ Roster          │  ← Links HR → user → zone
└────────┬────────┘
         │ (roster entries with userId, zoneId)
         ↓
┌─────────────────┐
│ FitnessSession  │  ← Central orchestrator
│ .updateSnapshot()│
└────────┬────────┘
         │
         ├───────────────────┐
         │                   │
         ↓                   ↓
┌─────────────────┐  ┌─────────────────┐
│  TreasureBox    │  │ GovernanceEngine│
│  (Coin Logic)   │  │ (Policy Logic)  │
└────────┬────────┘  └────────┬────────┘
         │                    │
         │ (userId, zone)     │ (activeParticipants, userZoneMap)
         ↓                    ↓
┌─────────────────┐  ┌─────────────────┐
│ MetricsRecorder │  │ Video Player    │
│ (Timeline Data) │  │ (Lock/Unlock)   │
└─────────────────┘  └─────────────────┘
```

---

## Detailed Flow: Device → Governance

### 1. Heart Rate Acquisition

**Entry Point:** `DeviceManager.handleHeartRate(deviceId, value)`

```javascript
// Input
deviceId: "42"
value: 150 (BPM)

// Storage
deviceManager.devices.get("42").lastHeartRate = 150
```

**Key Decision:** Device IDs are stable hardware identifiers

---

### 2. Device → User Mapping

**Service:** `DeviceAssignmentLedger`

```javascript
// Lookup
ledger.resolveByDevice("42")

// Returns
{
  userId: "kckern",
  deviceId: "42",
  assignedAt: timestamp
}
```

**Key Decision:** Uses `userId` (not name, not entityId) as the stable participant identifier

---

### 3. User → Zone Calculation

**Service:** `ParticipantRoster`

```javascript
// Input (from DeviceAssignmentLedger)
userId: "kckern"
heartRate: 150

// Zone lookup (from user's zone profile)
zones: {
  cool: { min: 0, max: 100 },
  active: { min: 100, max: 120 },
  warm: { min: 120, max: 140 },
  hot: { min: 140, max: 160 },   // ← 150 BPM falls here
  fire: { min: 160, max: 220 }
}

// Output (roster entry)
{
  id: "kckern",           // ← userId (stable identifier)
  name: "KC Kern",        // ← Display only
  deviceId: "42",
  heartRate: 150,
  zoneId: "hot",          // ← Calculated zone
  isActive: true
}
```

**Key Decision:** Roster entry uses `id` field for userId, NOT `name`

---

### 4. Snapshot Update

**Orchestrator:** `FitnessSession.updateSnapshot()`

```javascript
// Input: roster from ParticipantRoster
roster = [
  { id: "kckern", zoneId: "hot", isActive: true },
  { id: "felix", zoneId: "warm", isActive: true },
  { id: "milo", zoneId: "fire", isActive: false }  // Paused
]

// Build activeParticipants (CRITICAL: must use userId)
activeParticipants = roster
  .filter(entry => entry.isActive !== false)
  .map(entry => entry.id || entry.profileId);
// Result: ["kckern", "felix"]

// Build userZoneMap (CRITICAL: must key by userId)
userZoneMap = {};
roster.forEach(entry => {
  const userId = entry.id || entry.profileId;
  if (userId) {
    userZoneMap[userId] = entry.zoneId;
  }
});
// Result: { "kckern": "hot", "felix": "warm" }
```

**Key Contract:**
- `activeParticipants`: Array of `userId` strings
- `userZoneMap`: Object keyed by `userId`, values are `zoneId` strings

---

### 5. TreasureBox Coin Accumulation

**Input from FitnessSession:**

```javascript
treasureBox.processTick({
  activeParticipants: new Set(["kckern", "felix"]),  // userId Set
  inactiveParticipants: ["milo"]                    // userId array
});
```

**Internal Storage:**

```javascript
// perUser Map (keyed by userId)
perUser.set("kckern", {
  userId: "kckern",
  currentZone: "hot",
  coins: 42,
  // ...
});
```

**Timeline Write:**

```javascript
// MetricsRecorder writes coins to timeline
assignMetric(`user:${userId}:coins_total`, 42);
// Key: "user:kckern:coins_total"
```

**Key Decision:** All TreasureBox operations key by `userId`, timeline series use `user:` prefix

---

### 6. GovernanceEngine Policy Evaluation

**Input from FitnessSession:**

```javascript
governanceEngine.evaluate({
  activeParticipants: ["kckern", "felix"],  // userId array
  userZoneMap: {
    "kckern": "hot",
    "felix": "warm"
  },
  zoneRankMap: {
    "cool": 0,
    "active": 1,
    "warm": 2,
    "hot": 3,
    "fire": 4
  }
});
```

**Policy Evaluation:**

```javascript
// Policy: All users must be in "active" zone or higher
requirement = { active: "all" };  // "active" has rank 1

// Check each participant
activeParticipants.forEach(userId => {
  const zoneId = userZoneMap[userId];          // "hot" for kckern
  const rank = zoneRankMap[zoneId];            // 3 for "hot"
  const meetsRequirement = rank >= 1;          // 3 >= 1 = true ✓
});
```

**Output:**

```javascript
{
  satisfied: true,           // All users met requirements
  actualCount: 2,            // 2 out of 2 users
  missingUsers: [],          // No users below threshold
  requirement: { active: "all" }
}
```

**Key Contract:**
- All keys in `userZoneMap` MUST match values in `activeParticipants`
- Lookup `userZoneMap[userId]` MUST NOT return `undefined`

---

## Identifier Scheme

### Current Standard (Phase 1 Complete)

**Participant Identifier:** `userId` (stable, lowercase, unique)

```javascript
// Examples
"kckern"
"felix"
"milo"
"guest-abc123"
```

**Usage:**
- Dictionary keys (Maps, Objects, Sets)
- Timeline series keys (`user:${userId}:metric`)
- activeParticipants arrays
- TreasureBox perUser tracking

**NOT for identifiers:**
- ❌ Display names (`"KC Kern"`, `"Alan"`) - case-sensitive, not unique
- ❌ entityId (`"entity-123-abc"`) - session-specific, Phase 2 incomplete

---

### Timeline Series Key Format

**Pattern:** `{scope}:{identifier}:{metric}`

```javascript
// User-scoped metrics
"user:kckern:coins_total"
"user:kckern:heart_rate"
"user:felix:zone_id"

// Global metrics
"global:session_coins"
"global:governance_status"
```

**Rules:**
1. Always use `userId` for identifier segment
2. Use lowercase for metric names with underscores
3. Never use display names in keys

---

## Data Consistency Rules

### Rule 1: Consistent Identifiers Across Subsystems

**All subsystems MUST use `userId` as the participant identifier:**

```javascript
// ✅ CORRECT
activeParticipants = ["kckern", "felix"];
userZoneMap = { "kckern": "hot", "felix": "warm" };
treasureBox.perUser.set("kckern", data);

// ❌ WRONG (mixed identifiers)
activeParticipants = ["kckern", "felix"];
userZoneMap = { "KC Kern": "hot", "Felix": "warm" };  // Using names!
```

### Rule 2: Explicit Null Handling

**Never rely on `undefined` as a sentinel:**

```javascript
// ✅ CORRECT
const zoneId = userZoneMap[userId];
if (!zoneId) {
  logger.error('zone_lookup_failed', { userId, availableKeys: Object.keys(userZoneMap) });
  return null;
}

// ❌ WRONG (silent failure)
const zoneId = userZoneMap[userId] || 'unknown';  // Hides lookup failure
```

### Rule 3: Filter THEN Map

**Always filter for required fields before mapping:**

```javascript
// ✅ CORRECT
activeParticipants = roster
  .filter(entry => entry.isActive !== false && (entry.id || entry.profileId))
  .map(entry => entry.id || entry.profileId);

// ❌ WRONG (may include null/undefined)
activeParticipants = roster
  .map(entry => entry.id || entry.profileId)
  .filter(id => id);  // Too late, nulls already propagated
```

---

## Integration Points

### FitnessSession → TreasureBox

**Contract:**
```javascript
treasureBox.processTick({
  activeParticipants: Set<userId>,    // Set of userId strings
  inactiveParticipants: userId[]      // Array of userId strings
});
```

**Invariant:** All IDs in both sets/arrays are valid `userId` strings, never null

---

### FitnessSession → GovernanceEngine

**Contract:**
```javascript
governanceEngine.evaluate({
  activeParticipants: userId[],                    // Array of userId strings
  userZoneMap: Record<userId, zoneId>,            // Map userId → zoneId
  zoneRankMap: Record<zoneId, number>,            // Map zoneId → rank
  zoneInfoMap: Record<zoneId, ZoneInfo>,          // Map zoneId → metadata
  totalCount: number                              // Total participants
});
```

**Invariants:**
1. Every `userId` in `activeParticipants` MUST exist as a key in `userZoneMap`
2. Every `zoneId` value in `userZoneMap` MUST exist in `zoneRankMap`
3. `totalCount` MUST equal `activeParticipants.length`

---

### TreasureBox → MetricsRecorder

**Contract:**
```javascript
metricsRecorder.record({
  userId: string,        // Participant userId
  metric: string,        // Metric name
  value: number | null   // Metric value (null = explicit null sample)
});
```

**Timeline Key:** `user:${userId}:${metric}`

**Invariant:** `userId` MUST be non-null, `value` MAY be null (explicit null sample)

---

## Testing Strategy

### Unit Tests

**Test each subsystem in isolation:**

```javascript
// TreasureBox
test('processTick tracks coins by userId', () => {
  treasureBox.processTick({
    activeParticipants: new Set(['user1', 'user2'])
  });
  expect(treasureBox.perUser.has('user1')).toBe(true);
});

// GovernanceEngine
test('evaluate detects all active users', () => {
  const result = engine.evaluate({
    activeParticipants: ['user1'],
    userZoneMap: { 'user1': 'fire' }
  });
  expect(result.actualCount).toBe(1);
});
```

---

### Integration Tests

**Test cross-subsystem identifier consistency:**

```javascript
test('activeParticipants matches userZoneMap keys', () => {
  session.updateSnapshot();
  const inputs = session._buildGovernanceInputs();
  
  // Every participant must have a zone
  inputs.activeParticipants.forEach(userId => {
    expect(inputs.userZoneMap).toHaveProperty(userId);
  });
});
```

---

## Common Pitfalls

### ❌ Anti-Pattern 1: Using Names as Keys

```javascript
// WRONG
userZoneMap[entry.name] = entry.zoneId;  // Case-sensitive, fragile

// CORRECT
userZoneMap[entry.id || entry.profileId] = entry.zoneId;
```

### ❌ Anti-Pattern 2: Silent Failures

```javascript
// WRONG
const zone = userZoneMap[key] || 'unknown';  // Hides missing keys

// CORRECT
const zone = userZoneMap[key];
if (!zone) {
  logger.error('zone_missing', { key });
  return null;
}
```

### ❌ Anti-Pattern 3: Mixed Identifier Types

```javascript
// WRONG (mixed names and IDs)
activeParticipants = ["kckern", "Felix", "milo"];  // IDs and names mixed

// CORRECT (all userId)
activeParticipants = ["kckern", "felix", "milo"];
```

---

## References

- [Fitness Identifier Contract](./fitness-identifier-contract.md)
- [Session Entity Justification](./session-entity-justification.md)
- [Postmortem: EntityId Migration](../postmortem-entityid-migration-fitnessapp.md)
- [Postmortem: Governance Failure](../postmortem-governance-entityid-failure.md)

---

**Document Owner:** DaylightStation Team  
**Last Updated:** 2026-01-03  
**Next Review:** After Phase 2 decision
