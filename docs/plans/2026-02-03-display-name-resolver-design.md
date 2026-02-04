# Design: DisplayNameResolver - Single Source of Truth

**Date:** 2026-02-03
**Status:** Complete
**Scope:** Minimal refactor to establish SSOT for fitness display names

---

## Problem

Display name resolution is scattered across 7+ locations with duplicated logic, causing bugs like the `group_label` fallback issue that took 2+ hours to debug. See `docs/_wip/audits/2026-02-03-fitness-display-name-architecture-problems.md` for full analysis.

## Solution

Create `DisplayNameResolver.js` - a single file of pure functions that both `FitnessContext.jsx` and `FitnessUsers.jsx` import from. No folder restructuring, minimal blast radius.

---

## Design

### Interface

```javascript
// hooks/fitness/DisplayNameResolver.js

/**
 * Main entry point - resolves display name for a device
 */
export function resolveDisplayName(deviceId, context) → DisplayNameResult

/**
 * Determines if group labels should be preferred (2+ active HR devices)
 */
export function shouldPreferGroupLabels(devices) → boolean

/**
 * Builds context object from raw data sources
 */
export function buildDisplayNameContext(sources) → DisplayNameContext

/**
 * Batch resolve for efficiency
 */
export function resolveAllDisplayNames(deviceIds, context) → Map
```

### Types

```javascript
// DisplayNameContext - all data needed for resolution
{
  preferGroupLabels: boolean,
  activeHrDeviceCount: number,
  deviceOwnership: Map<deviceId, {name, groupLabel, profileId}>,
  deviceAssignments: Map<deviceId, {occupantType, occupantName, ...}>,
  userProfiles: Map<userId, {displayName, groupLabel}>,
}

// DisplayNameResult - resolved name plus debugging info
{
  displayName: string,
  source: 'guest' | 'groupLabel' | 'owner' | 'profile' | 'fallback',
  preferredGroupLabel: boolean,
}
```

### Priority Chain (Explicit)

```javascript
const PRIORITY_CHAIN = [
  {
    id: 'guest',
    description: 'Temporary guest using someone else\'s device',
    match: (ctx) => ctx.assignment?.occupantType === 'guest',
    resolve: (ctx) => ctx.assignment.occupantName,
  },
  {
    id: 'groupLabel',
    description: 'Owner\'s short name when 2+ users exercising together',
    match: (ctx) => ctx.preferGroupLabels && ctx.ownership?.groupLabel,
    resolve: (ctx) => ctx.ownership.groupLabel,
  },
  {
    id: 'owner',
    description: 'Device owner\'s display name',
    match: (ctx) => ctx.ownership?.name,
    resolve: (ctx) => ctx.ownership.name,
  },
  {
    id: 'profile',
    description: 'User profile display name (fallback)',
    match: (ctx) => ctx.profile?.displayName,
    resolve: (ctx) => ctx.profile.displayName,
  },
  {
    id: 'fallback',
    description: 'Device ID when nothing else available',
    match: () => true,
    resolve: (ctx) => ctx.deviceId,
  },
];
```

---

## Integration

### FitnessContext.jsx

```javascript
import { buildDisplayNameContext, resolveDisplayName } from './DisplayNameResolver.js';

const displayNameContext = React.useMemo(() =>
  buildDisplayNameContext({
    devices: allDevicesRaw,
    deviceOwnership: deviceOwnership?.heartRate,
    deviceAssignments: assignmentMap,
    userProfiles: userProfileMap,
  }),
  [allDevicesRaw, deviceOwnership, assignmentMap, userProfileMap, version]
);

const getDisplayName = React.useCallback(
  (deviceId) => resolveDisplayName(deviceId, displayNameContext),
  [displayNameContext]
);
```

### FitnessUsers.jsx

```javascript
const { getDisplayName } = useFitnessContext();

// In render:
const { displayName, source } = getDisplayName(deviceIdStr);
```

---

## Migration Plan

| Phase | Description | Commit |
|-------|-------------|--------|
| 1 | Create DisplayNameResolver.js + unit tests | `feat(fitness): add DisplayNameResolver SSOT` |
| 2 | Wire into FitnessContext (parallel with old) | `refactor(fitness): wire DisplayNameResolver into context` |
| 3 | Migrate FitnessUsers.jsx, remove old logic | `refactor(fitness): use DisplayNameResolver in FitnessUsers` |
| 4 | Remove deprecated code from FitnessContext | `refactor(fitness): remove deprecated display name logic` |
| 5 | Documentation | `docs(fitness): document display name SSOT` |

Each phase is a self-contained commit with rollback capability.

---

## Testing

### Unit Tests (new)
- `tests/unit/fitness/DisplayNameResolver.test.mjs`
- Pure function tests for each resolver function
- Priority chain edge cases

### Integration Tests (existing)
- `group-label-fallback.runtime.test.mjs` - end-to-end group_label behavior
- `governance-comprehensive.runtime.test.mjs` - display in lock screen

### Migration Safety
- Phase 2 runs old and new in parallel with disagreement logging
- All existing tests must pass at each phase

---

## What Gets Removed

| File | Removed Code |
|------|--------------|
| `FitnessContext.jsx` | `userGroupLabelMap`, `getDisplayLabel`, duplicated `preferGroupLabels` logic |
| `FitnessUsers.jsx` | `hrDisplayNameMap`, `hrOwnerMap`, `hrOwnerBaseMap`, `labelLookup`, 30-line if/else chain |

**Net: ~250 lines removed, ~100 lines added = 150 line reduction + SSOT established**

---

## Success Criteria

1. `group-label-fallback.runtime.test.mjs` passes
2. `governance-comprehensive.runtime.test.mjs` passes
3. No display name logic outside `DisplayNameResolver.js`
4. `resolveDisplayName()` returns `source` for debugging
5. Single place to update when display name requirements change

---

## Implementation Notes (2026-02-03)

- DisplayNameResolver integrated in Tasks 1-11 of integration plan
- All tests passing
- ~150 lines removed from FitnessUsers.jsx, ~30 lines from FitnessContext.jsx
- No display name logic outside DisplayNameResolver.js
- getDisplayLabel preserved for backward compatibility (uses groupLabelLookup internally)
