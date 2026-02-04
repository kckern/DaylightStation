# Display Name Resolver Reference

This document covers the DisplayNameResolver module, which provides a single source of truth for resolving display names in the Fitness app.

**Key files:**
- `frontend/src/hooks/fitness/DisplayNameResolver.js` - Core resolution logic

---

## Overview

The DisplayNameResolver centralizes ALL display name resolution logic. Both FitnessContext and FitnessUsers import from here - neither computes display names independently.

**Problem it solves**: Previously, display name logic was scattered across multiple files with 3+ different implementations computing the same values differently, leading to inconsistencies.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                   Display Name Resolution Flow                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  FitnessContext mounts                                              │
│       ↓                                                             │
│  buildDisplayNameContext(sources)                                   │
│       ↓                                                             │
│  Context stored: { preferGroupLabels, deviceOwnership, ... }        │
│       ↓                                                             │
│  Component needs display name                                        │
│       ↓                                                             │
│  resolveDisplayName(deviceId, context)                              │
│       ↓                                                             │
│  Priority chain evaluated (first match wins)                         │
│       ↓                                                             │
│  Result: { displayName, source, preferredGroupLabel }               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Priority Chain

The resolution follows an explicit priority chain. First match wins.

| Priority | ID | Description | When It Applies |
|----------|-----|-------------|-----------------|
| 1 | `guest` | Temporary guest using someone else's device | `assignment.occupantType === 'guest'` |
| 2 | `groupLabel` | Owner's short name when 2+ users exercising together | `preferGroupLabels && ownership.groupLabel` exists |
| 3 | `owner` | Device owner's display name | `ownership.name` exists |
| 4 | `profile` | User profile display name (fallback) | `profile.displayName` exists |
| 5 | `fallback` | Device ID when nothing else available | Always matches |

### Priority Examples

```
Scenario: Alice exercising alone
  preferGroupLabels: false (only 1 active device)
  ownership: { name: 'Alice Smith', groupLabel: 'Alice' }
  → Result: 'Alice Smith' (source: 'owner')

Scenario: Alice and Bob exercising together
  preferGroupLabels: true (2 active devices)
  ownership: { name: 'Alice Smith', groupLabel: 'Alice' }
  → Result: 'Alice' (source: 'groupLabel')

Scenario: Guest using Alice's device
  assignment: { occupantType: 'guest', occupantName: 'Carol' }
  → Result: 'Carol' (source: 'guest')
```

---

## Exported Functions

### `shouldPreferGroupLabels(devices)`

Determines if group labels should be preferred over full names.

**Parameters:**
- `devices` - Array of all devices

**Returns:** `boolean` - True if 2+ present HR devices

**Present device criteria:**
- `type === 'heart_rate'`
- No `inactiveSince` timestamp

**Important:** We intentionally do NOT require `heartRate > 0`. The trigger for preferring group labels must match the trigger for card visibility. If a card appears, names should switch immediately - not moments later when HR goes positive.

```javascript
// Single user - show full names
shouldPreferGroupLabels([{ type: 'heart_rate' }])
// → false

// Multiple users - show short labels (even if HR=0)
shouldPreferGroupLabels([
  { type: 'heart_rate' },
  { type: 'heart_rate' }
])
// → true
```

---

### `countActiveHrDevices(devices)`

Counts active HR devices.

**Parameters:**
- `devices` - Array of all devices

**Returns:** `number` - Count of active HR devices

Uses same criteria as `shouldPreferGroupLabels()`.

---

### `buildDisplayNameContext(sources)`

Builds the context object needed for display name resolution. Called once per render cycle.

**Parameters:**
```javascript
{
  devices: [],           // All devices
  deviceOwnership: {},   // Map<deviceId, {name, groupLabel, profileId}>
  deviceAssignments: {}, // Map<deviceId, {occupantType, occupantName, ...}>
  userProfiles: {}       // Map<userId, {displayName, groupLabel}>
}
```

**Returns:** `DisplayNameContext`
```javascript
{
  preferGroupLabels: boolean,
  activeHrDeviceCount: number,
  deviceOwnership: Map,
  deviceAssignments: Map,
  userProfiles: Map
}
```

**Usage:**
```javascript
const displayNameContext = buildDisplayNameContext({
  devices: fitnessContext.devices,
  deviceOwnership: fitnessContext.deviceOwnership,
  deviceAssignments: fitnessContext.deviceAssignments,
  userProfiles: fitnessContext.userProfiles
});
```

---

### `resolveDisplayName(deviceId, context)`

Main entry point - resolves display name for a device.

**Parameters:**
- `deviceId` - The device ID to resolve
- `context` - Context from `buildDisplayNameContext()`

**Returns:** `DisplayNameResult`
```javascript
{
  displayName: string,        // The resolved name
  source: string,             // Which priority rule matched
  preferredGroupLabel: boolean // Whether group labels were preferred
}
```

**Usage:**
```javascript
const result = resolveDisplayName('hr-123', displayNameContext);
// → { displayName: 'Alice', source: 'groupLabel', preferredGroupLabel: true }
```

---

### `resolveAllDisplayNames(deviceIds, context)`

Batch resolve - get display names for all devices at once.

**Parameters:**
- `deviceIds` - Array of device IDs to resolve
- `context` - Context from `buildDisplayNameContext()`

**Returns:** `Map<string, DisplayNameResult>`

**Usage:**
```javascript
const allNames = resolveAllDisplayNames(['hr-1', 'hr-2', 'hr-3'], context);
allNames.get('hr-1').displayName // → 'Alice'
```

---

### `getPriorityChain()`

Returns the priority chain for debugging/testing.

**Returns:** Array of `{ id, description }` objects

---

## Integration with FitnessContext

FitnessContext builds and exposes the display name context:

```javascript
// In FitnessContext.jsx
import { buildDisplayNameContext, resolveDisplayName } from './DisplayNameResolver';

// Build context when data changes
const displayNameContext = useMemo(() =>
  buildDisplayNameContext({
    devices,
    deviceOwnership,
    deviceAssignments,
    userProfiles
  }),
  [devices, deviceOwnership, deviceAssignments, userProfiles]
);

// Expose getDisplayName helper
const getDisplayName = useCallback((deviceId) =>
  resolveDisplayName(deviceId, displayNameContext).displayName,
  [displayNameContext]
);

// Provide to consumers
<FitnessContext.Provider value={{
  ...otherValues,
  displayNameContext,
  getDisplayName
}}>
```

---

## Component Usage

### Simple Usage

```javascript
const { getDisplayName } = useFitnessContext();

// In component
<span>{getDisplayName(device.id)}</span>
```

### With Source Information

```javascript
const { displayNameContext } = useFitnessContext();

const result = resolveDisplayName(device.id, displayNameContext);
// result.displayName → 'Alice'
// result.source → 'groupLabel'
// result.preferredGroupLabel → true
```

---

## Resolution Context Structure

When resolving a name, the internal resolution context looks like:

```javascript
{
  deviceId: 'hr-123',
  preferGroupLabels: true,  // From context
  ownership: {              // From deviceOwnership map
    name: 'Alice Smith',
    groupLabel: 'Alice',
    profileId: 'user-alice'
  },
  assignment: null,         // From deviceAssignments map (if guest)
  profile: {                // Looked up from userProfiles if profileId exists
    displayName: 'Alice Smith',
    groupLabel: 'Alice'
  }
}
```

---

## Migration from Legacy

This module replaced several scattered implementations:

| Deprecated | Replaced By |
|------------|-------------|
| `hrDisplayNameMap` | `resolveDisplayName()` |
| `userGroupLabelMap` | `buildDisplayNameContext()` with `preferGroupLabels` |
| `hrOwnerMap` | `deviceOwnership` in context |
| `hrOwnerBaseMap` | `deviceOwnership` in context |

---

## Testing

The priority chain can be inspected for testing:

```javascript
import { getPriorityChain } from './DisplayNameResolver';

const chain = getPriorityChain();
// [
//   { id: 'guest', description: 'Temporary guest...' },
//   { id: 'groupLabel', description: 'Owner\'s short name...' },
//   ...
// ]
```

---

## File Reference

| File | Purpose |
|------|---------|
| `frontend/src/hooks/fitness/DisplayNameResolver.js` | Core resolution logic |
| `frontend/src/context/FitnessContext.jsx` | Integrates and exposes to components |
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx` | Primary consumer |

---

## See Also

- [Assign Guest Reference](./assign-guest.md) - Guest assignments affect display name resolution
- [Governance Engine Reference](./governance-engine.md) - Uses resolved names in UI
