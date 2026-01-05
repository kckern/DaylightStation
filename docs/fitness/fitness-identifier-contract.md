# Fitness Identifier Contract (Strict userId)

**Status:** Active

This document defines the identifier and timeline key contracts for the FitnessApp.

## Participant Identifier
- **Canonical participant key:** `userId`
- **Never use as keys:** display names (`name`, `displayName`), entityIds (`entity-*`)

### Roster Contract
A roster entry may contain:
- `id` (preferred) or `profileId` (fallback)
- `name` is display-only
- `zoneId` is data (may be `null`)

When computing identity:
- `participantId = entry.id || entry.profileId`

## Maps/Sets
All lookup tables keyed by participant identity MUST be keyed by `userId`.

Examples:
- ✅ `activeParticipants: Set<userId>`
- ✅ `userZoneMap: Record<userId, zoneId|null>`
- ❌ `userZoneMap[name] = ...`
- ❌ `activeParticipants.add(entityId)`

## Timeline Series Keys
### Participant series
- Format: `user:<userId>:<metric>`
- Example: `user:kckern:heart_rate`

### Device series
- Format: `device:<deviceId>:<metric>`
- Example: `device:hrm-01:heart_rate`

### Global series
- Format: `global:<metric>`
- Example: `global:coins_total`

## Null Semantics
Explicit `null` values are meaningful and must be preserved:
- `null` indicates “missing / dropout / no sample at this tick”.
- Do not drop `null` when assigning metrics into tick payloads.
- `FitnessTimeline.tick()` backfills missing series keys with `null` each tick.

## EntityId (Compatibility Only)
`entityId` may still exist in the system as metadata during the (paused) migration, but:
- It MUST NOT be used as a key in maps/sets.
- It MUST NOT be used to generate timeline series keys.

## Verification
Run the identifier regression suite:
```bash
npm run test:frontend
```
