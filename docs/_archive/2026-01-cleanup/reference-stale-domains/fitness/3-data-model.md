# Fitness Data Model

> **Related code:** `frontend/src/hooks/fitness/`, `backend/lib/fitness/`

This document defines the data model, identifier contracts, and entity relationships for the FitnessApp.

---

## Participant Identifier Contract

**Status:** Active

### Canonical Identifier: userId

- **Canonical participant key:** `userId`
- **Never use as keys:** display names (`name`, `displayName`), entityIds (`entity-*`)

### Roster Entry Contract

A roster entry may contain:
- `id` (preferred) or `profileId` (fallback)
- `name` is display-only
- `zoneId` is data (may be `null`)

When computing identity:
```javascript
participantId = entry.id || entry.profileId
```

### Maps/Sets

All lookup tables keyed by participant identity MUST be keyed by `userId`.

| Pattern | Example |
|---------|---------|
| `activeParticipants: Set<userId>` | `new Set(["user_1", "user_2"])` |
| `userZoneMap: Record<userId, zoneId>` | `{ "user_1": "hot", "user_2": "warm" }` |

---

## Timeline Series Keys

### In-Memory Keys (during session)

**Participant Series**
- **Format:** `user:<userId>:<metric>`
- **Example:** `user:user_1:heart_rate`

**Device Series**
- **Format:** `device:<deviceId>:<metric>`
- **Example:** `device:hrm-01:heart_rate`

**Global Series**
- **Format:** `global:<metric>`
- **Example:** `global:coins_total`

### Persisted Structure (YAML v3)

When saved to YAML, series are reorganized into a nested structure:

```yaml
timeline:
  participants:
    {userId}:
      hr: '...'       # heart_rate
      beats: '...'    # heart_beats
      coins: '...'    # coins_total
      zone: '...'     # zone_id
  equipment:
    {deviceId}:
      rpm: '...'
      rotations: '...'
  global:
    coins: '...'
```

See `features/sessions.md` for complete v3 schema documentation.

---

## Null Semantics

Explicit `null` values are meaningful and must be preserved:
- `null` indicates "missing / dropout / no sample at this tick"
- Do not drop `null` when assigning metrics into tick payloads
- `FitnessTimeline.tick()` backfills missing series keys with `null` each tick

---

## Identifier Quick Reference

| Context | Use | Format | Example |
|---------|-----|--------|---------|
| Dictionary keys | **userId** | `string` | `"user_1"` |
| Timeline series | **userId** | `user:${userId}:${metric}` | `"user:user_1:coins"` |
| activeParticipants | **userId** | `string[]` | `["user_1", "user_2"]` |
| Display in UI | **name** | `string` | `"User_1"` |

---

## EntityId (Compatibility Only)

`entityId` exists in the system as metadata during the (paused) Phase 2 migration:
- It MUST NOT be used as a key in maps/sets
- It MUST NOT be used to generate timeline series keys
- Phase 2 migration is incomplete and on hold

### EntityId Nullability

During the incomplete Phase 2 migration, `entityId` fields may be:
- Present (guest participants with device assignments)
- `null` (regular users, legacy data, transitional state)
- `undefined` (should be normalized to null)

**Critical Rule:** All code MUST handle null entityId gracefully.

### Defensive Coding Patterns

**Null Coalescence:**
```javascript
const trackingId = entry.entityId || entry.userId;
const key = entityId ?? userId;  // Nullish coalescing
```

**Early Return:**
```javascript
function processEntity(entityId) {
  if (!entityId) {
    getLogger().warn('entity_missing', { caller: 'processEntity' });
    return null;
  }
  // ... safe to use entityId
}
```

**Conditional Access:**
```javascript
const startTime = entityId
  ? session.entityRegistry?.get(entityId)?.startTime
  : null;
```

**Default to null:**
```javascript
const entityId = entry.entityId || null;  // Not undefined
```

---

## Decision Tree

```
Need to identify a participant?
         │
         ↓
Is this for UI display?
         │
    ┌────┴────┐
    Yes       No
    ↓         ↓
Use name   Is this a dictionary key or lookup?
(display)       │
           ┌────┴────┐
           Yes       No
           ↓         ↓
      Use userId   Is this a timeline series key?
      (stable)          │
                   ┌────┴────┐
                   Yes       No
                   ↓         ↓
            Use format:    Default to
            user:${userId  userId for
            }:${metric}    consistency
```

---

## Migration Status

### Phase 1: slug → userId (COMPLETE)

All critical paths migrated to userId:
- TreasureBox.perUser keys
- FitnessTimeline series keys
- GovernanceEngine inputs
- MetricsRecorder timeline keys
- DeviceAssignmentLedger tracking

### Phase 2: userId → entityId (INCOMPLETE/PAUSED)

Infrastructure exists but migration paused:
- SessionEntity class created
- EntityId tracked in DeviceAssignmentLedger
- Roster entries include entityId field

Decision pending: Complete Phase 2 or stabilize on Phase 1.

---

## Verification

Run the identifier regression suite:
```bash
npm run test:frontend
```

---

**Merged from:**
- fitness-identifier-contract.md
- fitness-entityid-nullability.md
- fitness-identifier-decision-tree.md
