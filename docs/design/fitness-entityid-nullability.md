# EntityId Nullability Handling

**Date:** 2026-01-03  
**Status:** Living Document  
**Purpose:** Document how to safely handle entityId nulls during Phase 2 migration

---

## Overview

During the incomplete Phase 2 migration (userId → entityId), `entityId` fields may be:
- ✅ Present (guest participants with device assignments)
- ✅ null (regular users, legacy data, transitional state)
- ❌ undefined (should be normalized to null)

**Critical Rule:** All code MUST handle null entityId gracefully.

---

## Current Implementation Status

### ✅ Safely Handles Nulls

#### 1. ParticipantRoster.js

```javascript
// Lines 305-308: Safe entityId handling with fallback
const entityId = guestEntry?.entityId || null;
const trackingId = entityId || userId;  // Falls back to userId

// Line 319: Conditional registry lookup
const registryStartTime = entityId 
  ? this._session?.entityRegistry?.get?.(entityId)?.startTime 
  : null;
```

**Pattern:** Optional chaining + null coalescence

#### 2. FitnessTimeline.js

```javascript
// Line 165: Early return on null
getEntitySeries(entityId, metric) {
  if (!entityId || !metric) return [];
  const key = `${KEY_PREFIX.ENTITY}${entityId}:${metric}`;
  return this.series[key] || [];
}

// Line 194: Validate both IDs
transferEntitySeries(fromEntityId, toEntityId) {
  if (!fromEntityId || !toEntityId || fromEntityId === toEntityId) return [];
  // ... transfer logic
}
```

**Pattern:** Explicit null checks at function entry

#### 3. UserManager.js

```javascript
// Line 381: Safe metadata extraction
const entityId = normalizedMetadata?.entityId || null;
```

**Pattern:** Optional chaining + default to null

---

## Defensive Coding Patterns

### Pattern 1: Null Coalescence

**Use when:** Providing a fallback identifier

```javascript
// ✅ GOOD
const trackingId = entry.entityId || entry.userId;
const key = entityId ?? userId;  // Nullish coalescing

// ❌ BAD (may propagate undefined)
const trackingId = entry.entityId || entry.userId || undefined;
```

### Pattern 2: Early Return

**Use when:** Function requires non-null entityId

```javascript
// ✅ GOOD
function processEntity(entityId) {
  if (!entityId) {
    getLogger().warn('entity_missing', { caller: 'processEntity' });
    return null;  // or throw Error
  }
  // ... safe to use entityId
}

// ❌ BAD (may throw later)
function processEntity(entityId) {
  const entity = registry.get(entityId);  // Throws if entityId is null
  // ...
}
```

### Pattern 3: Conditional Access

**Use when:** Feature is entity-specific

```javascript
// ✅ GOOD
const startTime = entityId 
  ? session.entityRegistry?.get(entityId)?.startTime 
  : null;

// ❌ BAD (assumes entityId is always present)
const startTime = session.entityRegistry.get(entityId).startTime;
```

### Pattern 4: Default to null (not undefined)

**Use when:** Normalizing optional fields

```javascript
// ✅ GOOD
const entityId = entry.entityId || null;
const entityId = entry.entityId ?? null;

// ❌ BAD (undefined is ambiguous)
const entityId = entry.entityId;  // Could be undefined
```

---

## Migration Checklist

### Phase 2a: Add entityId Field (✅ Complete)

- ✅ SessionEntity class created
- ✅ EntityId tracked in DeviceAssignmentLedger
- ✅ Roster entries include entityId field (nullable)
- ✅ FitnessTimeline has entity series helpers

### Phase 2b: Dual-Mode Operations (⚠️ Incomplete)

- ❌ TreasureBox dual-mode (entityId OR userId)
- ❌ Timeline dual-write (`user:` AND `entity:` keys)
- ❌ Chart queries check both key formats
- ❌ All subsystems handle null entityId

### Phase 2c: Migration to entityId-Primary (❌ Not Started)

- ❌ TreasureBox keys by entityId (userId fallback)
- ❌ Timeline writes to `entity:` keys primarily
- ❌ Chart queries prefer `entity:` keys
- ❌ Governance uses entityId for tracking

### Phase 2d: Cleanup (❌ Not Started)

- ❌ Remove userId fallbacks
- ❌ Remove `user:` timeline writes
- ❌ Update docs to entityId standard

---

## Testing Strategy

### Unit Tests

```javascript
describe('EntityId Nullability', () => {
  test('ParticipantRoster handles null entityId', () => {
    const entry = { userId: 'user1', entityId: null };
    const trackingId = entry.entityId || entry.userId;
    expect(trackingId).toBe('user1');
  });

  test('FitnessTimeline.getEntitySeries returns empty for null', () => {
    const series = timeline.getEntitySeries(null, 'coins');
    expect(series).toEqual([]);
  });

  test('TreasureBox tracks by userId when entityId is null', () => {
    treasureBox.initializeEntity(null, timestamp);  // Should fall back
    // Verify userId-based tracking
  });
});
```

### Integration Tests

```javascript
test('Session works with mixed entityId/userId participants', () => {
  session.addParticipant({ userId: 'user1', entityId: null });
  session.addParticipant({ userId: 'user2', entityId: 'entity-123' });
  
  session.updateSnapshot();
  
  // Both should be tracked
  const roster = session.getRoster();
  expect(roster.length).toBe(2);
  
  // Governance should work
  const result = session.governanceEngine.evaluate();
  expect(result.actualCount).toBe(2);
});
```

---

## Common Pitfalls

### ❌ Pitfall 1: Undefined vs Null

```javascript
// WRONG (undefined is not the same as null)
const entityId = entry.entityId;  // Could be undefined
if (entityId === null) {  // Won't catch undefined
  // ...
}

// CORRECT (normalize to null)
const entityId = entry.entityId ?? null;
if (!entityId) {  // Catches both null and undefined
  // ...
}
```

### ❌ Pitfall 2: No Fallback

```javascript
// WRONG (throws if entityId is null)
const key = `entity:${entityId}:coins`;
timeline.series[key];

// CORRECT (fallback to userId)
const identifier = entityId || userId;
const prefix = entityId ? 'entity' : 'user';
const key = `${prefix}:${identifier}:coins`;
```

### ❌ Pitfall 3: Silent Failures

```javascript
// WRONG (fails silently if entityId null)
const entity = registry.get(entityId);  // Returns undefined
const startTime = entity.startTime;  // Throws

// CORRECT (explicit check)
if (!entityId) {
  logger.warn('entity_missing', { context });
  return null;
}
const entity = registry.get(entityId);
if (!entity) {
  logger.error('entity_not_found', { entityId });
  return null;
}
```

---

## Logging Best Practices

### Pattern: Log When Falling Back

```javascript
const trackingId = entry.entityId || entry.userId;
if (!entry.entityId) {
  getLogger().debug('entity_null_fallback', {
    userId: entry.userId,
    context: 'TreasureBox.initializeEntity'
  });
}
```

### Pattern: Log When Skipping

```javascript
if (!entityId) {
  getLogger().warn('entity_null_skip', {
    operation: 'transferEntitySeries',
    reason: 'entityId is null'
  });
  return;
}
```

### Pattern: Log Unexpected Nulls

```javascript
// If entityId SHOULD be present but isn't
if (!entry.entityId && isGuestParticipant) {
  getLogger().error('guest_missing_entity', {
    userId: entry.userId,
    deviceId: entry.deviceId,
    context: 'Guest should have entityId'
  });
}
```

---

## Decision: Phase 2 Completion vs Revert

### Option A: Complete Phase 2

**Required Work:**
1. ✅ All subsystems handle null entityId (mostly done)
2. ❌ Implement dual-mode in TreasureBox
3. ❌ Implement dual-write in Timeline
4. ❌ Update chart queries to check both formats
5. ❌ Migrate all consumers to prefer entityId
6. ❌ Remove userId-only code paths

**Benefits:**
- ✅ Guest reassignment continuity works
- ✅ Session audit trails preserved
- ✅ Profile aggregation possible

**Cost:**
- ~2 weeks implementation
- Increased code complexity
- Potential new bugs

### Option B: Revert Phase 2

**Required Work:**
1. ❌ Remove SessionEntity infrastructure
2. ❌ Remove entityId from DeviceAssignmentLedger
3. ❌ Remove entityId from roster entries
4. ❌ Remove entity series helpers from Timeline
5. ❌ Update tests to remove entityId assertions

**Benefits:**
- ✅ Simpler codebase
- ✅ Faster stabilization
- ✅ Less maintenance burden

**Cost:**
- ❌ Guest reassignment broken again
- ❌ No session-specific tracking
- ❌ Lost ~720 lines of infrastructure code

### Recommendation

**Pause Phase 2, evaluate in 1 month:**
- Current system stable with userId
- No urgent need for entityId features
- Let system stabilize before deciding
- Re-evaluate based on user needs

---

## References

- [Fitness Identifier Contract](./fitness-identifier-contract.md)
- [Fitness Data Flow](./fitness-data-flow.md)
- [Session Entity Justification](./session-entity-justification.md)
- [Postmortem: EntityId Migration](../postmortem-entityid-migration-fitnessapp.md)

---

**Document Owner:** DaylightStation Team  
**Last Updated:** 2026-01-03  
**Next Review:** After Phase 2 decision
