# DisplayNameResolver Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the existing `DisplayNameResolver.js` into FitnessContext and FitnessUsers, eliminating the 7 scattered sources of truth for display name resolution.

**Architecture:** `DisplayNameResolver.js` already exists with pure functions. This plan wires it into FitnessContext (builds context, exposes `getDisplayName`), then migrates FitnessUsers to consume it, finally removing deprecated code.

**Tech Stack:** React hooks, JavaScript pure functions

**Reference:** `docs/plans/2026-02-03-display-name-resolver-design.md`

---

## Phase 1: Wire into FitnessContext

### Task 1: Add DisplayNameResolver import to FitnessContext

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

**Step 1: Add import at top of file**

After line 17 (after `ParticipantFactory` import), add:
```javascript
// Phase 4 SSOT: Display name resolution
import {
  buildDisplayNameContext,
  resolveDisplayName,
  shouldPreferGroupLabels
} from '../hooks/fitness/DisplayNameResolver.js';
```

**Step 2: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "refactor(fitness): import DisplayNameResolver into FitnessContext"
```

---

### Task 2: Build display name context in FitnessContext

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

**Step 1: Add displayNameContext memoization**

After the `deviceOwnership` useMemo block (around line 1518), add:
```javascript
// Phase 4 SSOT: Build display name context
const displayNameContext = React.useMemo(() => {
  return buildDisplayNameContext({
    devices: allDevicesRaw,
    deviceOwnership: deviceOwnership?.heartRate,
    deviceAssignments: deviceAssignmentMap,
    userProfiles: new Map(
      configuredUsers.map(u => [u.id || u.profileId, {
        displayName: u.name,
        groupLabel: u.group_label || u.groupLabel
      }])
    )
  });
}, [allDevicesRaw, deviceOwnership, deviceAssignmentMap, configuredUsers, version]);
```

Note: `configuredUsers` needs to be extracted. Add near line 1507 (after userCollections):
```javascript
const configuredUsers = React.useMemo(() => {
  return userCollections?.all || [];
}, [userCollections]);
```

**Step 2: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "refactor(fitness): build displayNameContext in FitnessContext"
```

---

### Task 3: Add getDisplayName function to FitnessContext

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

**Step 1: Add getDisplayName callback**

After the `displayNameContext` useMemo, add:
```javascript
// Phase 4 SSOT: Canonical display name resolver
const getDisplayName = React.useCallback((deviceId) => {
  return resolveDisplayName(deviceId, displayNameContext);
}, [displayNameContext]);
```

**Step 2: Add to context value**

In the `value` object (around line 1923), add alongside existing exports:
```javascript
// Phase 4 SSOT: Display name resolution
displayNameContext,
getDisplayName,
```

**Step 3: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "refactor(fitness): expose getDisplayName in FitnessContext"
```

---

### Task 4: Add parallel logging for migration safety

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

**Step 1: Add comparison hook for debugging**

This is temporary - will be removed after migration is validated. Add after `getDisplayName`:
```javascript
// TEMPORARY: Migration validation - log when old and new disagree
if (process.env.NODE_ENV === 'development') {
  React.useEffect(() => {
    if (!allDevicesRaw || allDevicesRaw.length === 0) return;

    const hrDevices = allDevicesRaw.filter(d => d.type === 'heart_rate');
    hrDevices.forEach(device => {
      const deviceId = String(device.deviceId);
      const newResult = getDisplayName(deviceId);
      const oldResult = getDisplayLabel(device.name || deviceId);

      if (newResult.displayName !== oldResult) {
        console.warn('[DisplayNameResolver] MISMATCH', {
          deviceId,
          new: newResult.displayName,
          newSource: newResult.source,
          old: oldResult
        });
      }
    });
  }, [allDevicesRaw, displayNameContext, getDisplayLabel]);
}
```

**Step 2: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "refactor(fitness): add DisplayNameResolver migration validation logging"
```

---

## Phase 2: Migrate FitnessUsers.jsx

### Task 5: Import and use getDisplayName in FitnessUsers

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx`

**Step 1: Add getDisplayName to destructuring**

Update the destructuring from `useFitnessContext()` (around line 118) to include:
```javascript
getDisplayName, // Phase 4 SSOT: Use this instead of hrDisplayNameMap
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx
git commit -m "refactor(fitness): import getDisplayName in FitnessUsers"
```

---

### Task 6: Replace hrDisplayNameMap usage with getDisplayName

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx`

**Step 1: Update deviceName resolution in render**

Find the deviceName resolution block (around line 993-1021). Replace:
```javascript
let deviceName;
let deviceNameSource;
if (isHeartRate) {
  // Only use guestAssignment for actual guests, not for members/owners
  const isActualGuest = guestAssignment?.occupantType === 'guest';
  if (isActualGuest && guestAssignment?.occupantName) {
    deviceName = guestAssignment.occupantName;
    deviceNameSource = 'guestAssignment.occupantName';
  } else if (isActualGuest && guestAssignment?.metadata?.name) {
    deviceName = guestAssignment.metadata.name;
    deviceNameSource = 'guestAssignment.metadata.name';
  } else if (ownerName) {
    // ownerName from hrDisplayNameMap takes precedence - it has group_label awareness
    deviceName = ownerName;
    deviceNameSource = 'ownerName (hrDisplayNameMap)';
  } else if (displayLabel) {
    deviceName = displayLabel;
    deviceNameSource = 'displayLabel';
  } else if (participantEntry?.name) {
    deviceName = participantEntry.name;
    deviceNameSource = 'participantEntry.name';
  } else {
    deviceName = deviceIdStr;
    deviceNameSource = 'deviceIdStr (fallback)';
  }
} else {
  deviceName = device.name || String(device.deviceId);
  deviceNameSource = device.name ? 'device.name' : 'device.deviceId';
}
```

With:
```javascript
let deviceName;
let deviceNameSource;
if (isHeartRate) {
  // Phase 4 SSOT: Use DisplayNameResolver for all HR display names
  const resolved = getDisplayName(deviceIdStr);
  deviceName = resolved.displayName;
  deviceNameSource = `DisplayNameResolver:${resolved.source}`;
} else {
  deviceName = device.name || String(device.deviceId);
  deviceNameSource = device.name ? 'device.name' : 'device.deviceId';
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx
git commit -m "refactor(fitness): use getDisplayName for HR device names"
```

---

### Task 7: Run tests to validate

**Step 1: Run existing fitness tests**

Run: `npm test -- tests/live/flow/fitness/ --run`
Expected: All tests pass

**Step 2: Run group label test specifically**

Run: `npm test -- tests/live/flow/fitness/group-label-fallback.runtime.test.mjs --run`
Expected: Test passes (this is the key test for group_label behavior)

**Step 3: Manual verification**

Start dev server, open fitness app:
1. With 1 user: Should show full name
2. With 2+ users: Should show group_label where configured
3. With guest assigned: Should show guest name, not owner name

---

## Phase 3: Remove deprecated code

### Task 8: Remove hrDisplayNameMap from FitnessUsers

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx`

**Step 1: Delete hrDisplayNameMap useMemo**

Remove the entire block (lines 443-509):
```javascript
// Build a map of deviceId -> displayName applying group_label rule
const hrDisplayNameMap = React.useMemo(() => {
  // ... entire block
}, [hrOwnerMap, allDevices, heartRateOwners, getGuestAssignment]);
```

**Step 2: Remove ownerName derivation**

Remove line 937:
```javascript
const ownerName = isHeartRate ? hrDisplayNameMap[deviceIdStr] : null;
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx
git commit -m "refactor(fitness): remove deprecated hrDisplayNameMap"
```

---

### Task 9: Remove hrOwnerMap and hrOwnerBaseMap from FitnessUsers

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx`

**Step 1: Delete hrOwnerBaseMap useMemo**

Remove lines 412-429:
```javascript
const hrOwnerBaseMap = React.useMemo(() => {
  // ... entire block
}, [participantByHrId, heartRateOwners, registeredUsers]);
```

**Step 2: Delete hrOwnerMap useMemo**

Remove lines 431-440:
```javascript
const hrOwnerMap = React.useMemo(() => {
  // ... entire block
}, [hrOwnerBaseMap, guestAssignmentEntries]);
```

**Step 3: Update resolveCanonicalUserName if still needed**

If `resolveCanonicalUserName` is still used elsewhere in the component, update it to use `getDisplayName`:
```javascript
const resolveCanonicalUserName = React.useCallback((deviceId, fallbackName = null) => {
  if (deviceId == null) return fallbackName;
  const resolved = getDisplayName(String(deviceId));
  return resolved.displayName !== String(deviceId) ? resolved.displayName : fallbackName;
}, [getDisplayName]);
```

Or remove it entirely if no longer needed.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx
git commit -m "refactor(fitness): remove deprecated hrOwnerMap and hrOwnerBaseMap"
```

---

### Task 10: Remove userGroupLabelMap from FitnessContext

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

**Step 1: Delete userGroupLabelMap useMemo**

Remove lines 420-446:
```javascript
const userGroupLabelMap = React.useMemo(() => {
  // ... entire block
}, [usersConfig]);
```

**Step 2: Update getDisplayLabel if still needed**

If `getDisplayLabel` is still called elsewhere, update it to delegate to `getDisplayName` or mark it deprecated with a console.warn.

**Step 3: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "refactor(fitness): remove deprecated userGroupLabelMap"
```

---

### Task 11: Remove migration validation logging

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

**Step 1: Remove the temporary useEffect**

Remove the development-only comparison hook added in Task 4.

**Step 2: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "refactor(fitness): remove DisplayNameResolver migration validation"
```

---

## Phase 4: Documentation and Final Verification

### Task 12: Update design document status

**Files:**
- Modify: `docs/plans/2026-02-03-display-name-resolver-design.md`

**Step 1: Update status to Complete**

Change:
```markdown
**Status:** Approved
```

To:
```markdown
**Status:** Complete
```

**Step 2: Add implementation notes**

Add a section at the bottom:
```markdown
---

## Implementation Notes (2026-02-03)

- DisplayNameResolver integrated in Tasks 1-11 of integration plan
- All tests passing
- ~250 lines removed, ~100 lines added = 150 line reduction
- No display name logic outside DisplayNameResolver.js
```

**Step 3: Commit**

```bash
git add docs/plans/2026-02-03-display-name-resolver-design.md
git commit -m "docs(fitness): mark DisplayNameResolver integration complete"
```

---

### Task 13: Final test run

**Step 1: Run all fitness tests**

Run: `npm test -- tests/live/flow/fitness/ --run`
Expected: All tests pass

**Step 2: Run governance tests**

Run: `npm test -- tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs --run`
Expected: Test passes (validates lock screen display)

**Step 3: Manual smoke test**

1. Open fitness app with 1 user - shows full name
2. Add second user - both show group_label
3. Assign guest - shows guest name
4. Clear guest - shows owner name again

---

## Summary

| Phase | Tasks | What Gets Done |
|-------|-------|----------------|
| 1 | 1-4 | Wire DisplayNameResolver into FitnessContext |
| 2 | 5-7 | Migrate FitnessUsers to use getDisplayName |
| 3 | 8-11 | Remove deprecated code (~250 lines) |
| 4 | 12-13 | Documentation and verification |

**Result:** Single source of truth for display names. Future changes only require editing `DisplayNameResolver.js`.
