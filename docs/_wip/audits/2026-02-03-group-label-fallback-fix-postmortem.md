# Postmortem: group_label Fallback Display Bug

**Date:** 2026-02-03
**Duration:** ~2 hours debugging
**Severity:** Medium
**Component:** FitnessSidebar/FitnessUsers.jsx
**Test File:** `tests/live/flow/fitness/group-label-fallback.runtime.test.mjs`

---

## Summary

When multiple HR devices join a fitness session, users with a configured `group_label` (e.g., "Dad" instead of "KC Kern") should see their shorter label displayed in the sidebar. This feature worked in production but failed in the automated test due to a device name resolution priority bug.

---

## Timeline

| Time | Event |
|------|-------|
| T+0 | Test created for `group_label` fallback behavior |
| T+15m | Phase 1 passes (single device shows "KC Kern") |
| T+15m | Phase 2 fails ("KC Kern" instead of "Dad" when 2nd device joins) |
| T+30m | Identified `hrDisplayNameMap` correctly computes "Dad" |
| T+45m | Added render-time logging, discovered priority issue |
| T+60m | First fix attempt: swap `displayLabel` and `ownerName` priority |
| T+75m | Still failing - discovered `guestAssignment.occupantName` has highest priority |
| T+90m | Root cause identified: `guestAssignment` for members still has `occupantName` field |
| T+105m | Final fix: only use `guestAssignment.occupantName` for actual guests |
| T+120m | All 3 phases pass, cleanup debug logging |

---

## Root Cause Analysis

### The Bug

The device name resolution in `FitnessUsers.jsx` has a priority chain:

```javascript
// Old priority order (buggy)
1. guestAssignment?.occupantName     // ← Used for ALL assignments
2. guestAssignment?.metadata?.name
3. displayLabel                      // ← From userVitalsEntry
4. ownerName                         // ← From hrDisplayNameMap (has group_label)
5. participantEntry?.name
6. deviceId (fallback)
```

**Problem:** `guestAssignment?.occupantName` was checked for ALL device assignments, not just actual guests. A "member" assignment (like kckern's primary device) still has:

```json
{
  "occupantName": "KC Kern",
  "occupantType": "member",   // NOT a guest!
  ...
}
```

This meant the full display name "KC Kern" was always used, bypassing the `hrDisplayNameMap` which correctly applied the group_label override to "Dad".

### Why `hrDisplayNameMap` Was Correct But Unused

The `hrDisplayNameMap` useMemo correctly:
1. Detected 2+ HR devices
2. Looked up `heartRateOwners` to find group_label ("Dad")
3. Applied the override: `out["40475"] = "Dad"`
4. Logged: `Applied overrides: [{"deviceId":"40475","from":"KC Kern","to":"Dad"}]`

But the render never used this value because `guestAssignment.occupantName` had higher priority.

### Debug Evidence

Console logs revealed the issue:

```
[RENDER 40475] deviceName= KC Kern
               source= guestAssignment.occupantName
               ownerName= KC Kern       // ← Stale value, not "Dad"
               guestAssignment= {"occupantType":"member","occupantName":"KC Kern"...}
```

When we saw `source= guestAssignment.occupantName` and `occupantType: "member"`, the fix became clear.

---

## The Fix

### Code Change (FitnessUsers.jsx lines 991-1020)

```javascript
// Before: Checked guestAssignment for ALL device types
if (guestAssignment?.occupantName) {
  deviceName = guestAssignment.occupantName;  // Used even for members!
}

// After: Only use guestAssignment for actual guests
const isActualGuest = guestAssignment?.occupantType === 'guest';
if (isActualGuest && guestAssignment?.occupantName) {
  deviceName = guestAssignment.occupantName;
} else if (ownerName) {
  // ownerName from hrDisplayNameMap has group_label awareness
  deviceName = ownerName;
}
```

### New Priority Order

```javascript
// For guests: guestAssignment > ownerName
// For members: ownerName (with group_label) > displayLabel > participantEntry
1. guestAssignment?.occupantName (only if occupantType === 'guest')
2. guestAssignment?.metadata?.name (only if occupantType === 'guest')
3. ownerName (from hrDisplayNameMap - has group_label awareness)
4. displayLabel
5. participantEntry?.name
6. deviceId (fallback)
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DEVICE NAME RESOLUTION                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  WebSocket HR Data                                                           │
│         │                                                                    │
│         ▼                                                                    │
│  ┌──────────────┐    ┌─────────────────┐                                     │
│  │ allDevices   │───▶│ hrDisplayNameMap│                                     │
│  │ (2 devices)  │    │ useMemo         │                                     │
│  └──────────────┘    │                 │                                     │
│         │            │ if count > 1:   │                                     │
│         │            │   apply         │                                     │
│         │            │   group_label   │                                     │
│         ▼            │                 │                                     │
│  ┌──────────────┐    │ out["40475"]    │                                     │
│  │heartRateOwners│───▶│  = "Dad"       │                                     │
│  │ groupLabel:   │    └───────┬────────┘                                     │
│  │ "Dad"         │            │                                              │
│  └──────────────┘            │                                              │
│                               ▼                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      RENDER PRIORITY CHAIN                              │ │
│  │                                                                         │ │
│  │   ┌─────────────────────┐                                               │ │
│  │   │ guestAssignment     │                                               │ │
│  │   │ occupantType="member"│──┐                                           │ │
│  │   │ occupantName="KC..."│  │ isActualGuest = false                      │ │
│  │   └─────────────────────┘  │                                            │ │
│  │                            ▼                                            │ │
│  │                      ┌──────────────┐                                   │ │
│  │                      │   SKIP       │                                   │ │
│  │                      │ (not guest)  │                                   │ │
│  │                      └──────┬───────┘                                   │ │
│  │                             │                                           │ │
│  │                             ▼                                           │ │
│  │                      ┌──────────────┐                                   │ │
│  │                      │  ownerName   │                                   │ │
│  │                      │  = "Dad" ✓   │◀── hrDisplayNameMap["40475"]      │ │
│  │                      └──────────────┘                                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Why Previous Fix Attempts Failed

### Attempt 1: Swap `displayLabel` and `ownerName` priority

Changed priority from `displayLabel > ownerName` to `ownerName > displayLabel`.

**Result:** Still failed because `guestAssignment.occupantName` had even higher priority.

### Attempt 2: Fix `hrDisplayNameMap` guest check

The earlier fix to `hrDisplayNameMap` checked:
```javascript
if (assignment?.occupantType === 'guest') {
  skippedGuests.push(...);
  return; // Skip group_label for guests
}
```

**Result:** This was correct for the DATA layer - don't apply group_label override for guests. But the RENDER layer still used `guestAssignment.occupantName` for members.

---

## Lessons Learned

### 1. Multiple Sources of Truth

The device name had FOUR different potential sources:
- `guestAssignment.occupantName`
- `hrDisplayNameMap[deviceId]` (with group_label)
- `userVitalsEntry.displayLabel`
- `participantEntry.name`

**Lesson:** When multiple data sources can provide the same value, the priority order must be explicitly documented and match the semantic requirements.

### 2. "Guest Assignment" vs "Device Assignment"

The naming `guestAssignment` is misleading - it's actually a general "device assignment" that can have different `occupantType` values:
- `"guest"` - temporary guest using the device
- `"member"` - household member (the owner or assigned user)

**Lesson:** The variable name `guestAssignment` implies guest-only, but it's used for all assignment types. Consider renaming to `deviceAssignment`.

### 3. Debug Logging is Essential

The fix was only possible after adding console logging at both:
- The DATA layer (`hrDisplayNameMap` computation)
- The RENDER layer (device name resolution)

The discrepancy between "data computes 'Dad'" and "render shows 'KC Kern'" pointed directly to the priority chain issue.

**Lesson:** When debugging React data flow issues, log at BOTH computation AND consumption points.

### 4. The "Member" Assignment Edge Case

The system creates device assignments even for primary users (members), not just guests. This assignment includes `occupantName` which was being used unconditionally.

**Lesson:** Always check the `occupantType` or equivalent discriminator before using data from polymorphic structures.

---

## Test Coverage

### Test File: `group-label-fallback.runtime.test.mjs`

| Phase | Description | Assertion |
|-------|-------------|-----------|
| 1 | Single device | kckern shows "KC Kern" (display_name) |
| 2 | Second device joins | kckern switches to "Dad" (group_label) |
| 3 | Device drops out | kckern restores to "KC Kern" |

### Related Tests

- `governance-comprehensive.runtime.test.mjs` - Uses same device simulation
- `hydration.runtime.test.mjs` - Tests device appearance

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx` | Fixed device name priority chain to only use `guestAssignment.occupantName` for actual guests |

---

## Future Recommendations

1. **Rename `guestAssignment` to `deviceAssignment`** - Clearer semantics
2. **Add TypeScript discriminated union** - For `DeviceAssignment` with `occupantType`
3. **Document priority chain** - In component comments
4. **Consider single source of truth** - All display name resolution in one place

---

## Verification

```bash
# Run the test
npx playwright test tests/live/flow/fitness/group-label-fallback.runtime.test.mjs

# Expected output:
#   Phase 1 (single device): kckern showed "KC Kern" ✓
#   Phase 2 (multi device):  kckern showed "Dad", felix showed "Felix" ✓
#   Phase 3 (device drop):   kckern restored to "KC Kern" ✓
#   ✓ Test passed
```

---

## Appendix: Full Debug Log Sequence

```
[PHASE 1] Single device
  [hrDisplayNameMap] Recomputing with 1 HR devices: [40475]
  [RENDER 40475] deviceName= KC Kern source= ownerName (hrDisplayNameMap)
  ✓ kckern shows: "KC Kern"

[PHASE 2] Second device joins
  [hrDisplayNameMap] Recomputing with 2 HR devices: [40475, 28812]
  [hrDisplayNameMap] heartRateOwners size: 5 labelLookup: {"40475":"Dad"}
  [hrDisplayNameMap] Applied overrides: [{"deviceId":"40475","from":"KC Kern","to":"Dad"}]
  [RENDER 40475] deviceName= Dad source= ownerName (hrDisplayNameMap) ownerName= Dad
  ✓ kckern shows: "Dad"

[PHASE 3] Device drops
  [hrDisplayNameMap] Recomputing with 1 HR devices: [40475]
  [RENDER 40475] deviceName= KC Kern source= ownerName (hrDisplayNameMap)
  ✓ kckern shows: "KC Kern"
```
