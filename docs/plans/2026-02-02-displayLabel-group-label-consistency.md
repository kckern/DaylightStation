# displayLabel Group Label Consistency Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix inconsistency where sidebar user list shows "KC Kern" instead of "Dad" when multiple HR devices are connected.

**Architecture:** Single-point fix in `getUserVitals` to respect the context's `preferGroupLabels` flag instead of hardcoding `false`. Secondary cleanup in `getHouseholdDisplayLabel` to look for the correct config field.

**Tech Stack:** React hooks, FitnessContext

---

## Problem Summary

The sidebar user list shows "KC Kern" (raw name) instead of "Dad" (group_label) when multiple HR devices are connected, even though the lock screen correctly shows "Dad".

### Root Cause

In `FitnessContext.jsx:1506`, `getUserVitals` hardcodes `preferGroupLabel: false`:

```javascript
const mergedDisplayLabel = existing?.displayLabel
  || participant?.displayLabel
  || getDisplayLabel(participant?.name || nameOrId, { preferGroupLabel: false });  // ← BUG
```

This bypasses the context's `preferGroupLabels` logic (true when 2+ HR devices exist).

### Affected Flow

```
FitnessUsers.jsx → getUserVitals() → getDisplayLabel({ preferGroupLabel: false })
                                                         ↓
                                              Always returns "KC Kern"
```

### Expected Behavior

| Scenario | Displayed Name |
|----------|---------------|
| 1 HR device connected | "KC Kern" (name) |
| 2+ HR devices connected | "Dad" (group_label) |

---

## Task 1: Fix getUserVitals to Respect preferGroupLabels

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:1506`
- Test: Manual verification (unit test would require mocking entire context)

**Step 1: Read current implementation**

The current code at line 1506:
```javascript
|| getDisplayLabel(participant?.name || nameOrId, { preferGroupLabel: false });
```

**Step 2: Apply the fix**

Replace line 1506 with:
```javascript
|| getDisplayLabel(participant?.name || nameOrId, { userId: participant?.id || participant?.profileId });
```

This removes the hardcoded `false` and passes `userId` to enable proper lookup. The `getDisplayLabel` function will then use the context's `preferGroupLabels` value.

**Step 3: Verify the fix**

1. Start the fitness app with 2+ HR devices (or simulate by having kids' devices connected)
2. Verify sidebar shows "Dad" for the configured user
3. Verify lock screen still shows "Dad" (no regression)

**Step 4: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "$(cat <<'EOF'
fix(fitness): respect preferGroupLabels in getUserVitals

Removes hardcoded preferGroupLabel: false that caused sidebar to show
raw names instead of group labels when multiple HR devices are present.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Fix getHouseholdDisplayLabel Field Lookup (Secondary)

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx:686`

**Problem:** `getHouseholdDisplayLabel` looks for `user?.displayLabel` but the config uses `group_label`.

**Step 1: Read current implementation**

Lines 671-687:
```javascript
const getHouseholdDisplayLabel = useCallback((profileId) => {
  const users = fitnessConfiguration?.fitness?.users;
  if (!users || !profileId) return null;

  const allUsers = [
    ...(users.primary || []),
    ...(users.secondary || [])
  ];

  const user = allUsers.find(u =>
    u.id === profileId ||
    u.profileId === profileId ||
    u.slug === profileId
  );

  return user?.displayLabel || null;  // ← Wrong field
}, [fitnessConfiguration]);
```

**Step 2: Consider the multi-device condition**

This function should only return the group label when multiple HR devices exist. However, the existing `hrDisplayNameMap` already handles this logic correctly (lines 443-466).

**Decision:** The cleanest fix is to remove `getHouseholdDisplayLabel` from the fallback chain entirely and let `displayLabel` (now fixed in Task 1) handle it, with `ownerName` as backup.

**Step 3: Remove getHouseholdDisplayLabel from fallback chain**

At lines 969-980, change:
```javascript
// Get household SSOT label first
const householdDisplayLabel = profileId ? getHouseholdDisplayLabel(profileId) : null;

const deviceName = isHeartRate ?
  (guestAssignment?.occupantName ||
   guestAssignment?.metadata?.name ||
   householdDisplayLabel ||     // ← Remove this
   displayLabel ||
   ownerName ||
   participantEntry?.name ||
   deviceIdStr)
```

To:
```javascript
const deviceName = isHeartRate ?
  (guestAssignment?.occupantName ||
   guestAssignment?.metadata?.name ||
   displayLabel ||              // Now correct after Task 1
   ownerName ||                 // Backup with correct multi-device logic
   participantEntry?.name ||
   deviceIdStr)
```

**Step 4: Remove the unused function**

Delete lines 667-687 (`getHouseholdDisplayLabel` function definition) and the comment above it.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx
git commit -m "$(cat <<'EOF'
refactor(sidebar): remove redundant getHouseholdDisplayLabel

The displayLabel from getUserVitals now correctly handles group labels.
The householdDisplayLabel lookup was looking for wrong field anyway.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Verify useDeviceAssignments (Optional Review)

**Files:**
- Review: `frontend/src/hooks/useDeviceAssignments.js:26`

**Context:** This file also has `{ preferGroupLabel: false }` hardcoded:

```javascript
const displayLabel = typeof getDisplayLabel === 'function'
  ? getDisplayLabel(occupantName, { preferGroupLabel: false })
  : occupantName;
```

**Decision:** This may be intentional for device assignment display (showing who's assigned to a device). Review whether this should also respect `preferGroupLabels`.

**Step 1: Analyze usage**

Device assignments show "KC Kern assigned to Device X". Using the full name may be intentional for clarity in assignment contexts.

**Step 2: Leave as-is or fix**

If the user prefers consistency, apply the same fix:
```javascript
const displayLabel = typeof getDisplayLabel === 'function'
  ? getDisplayLabel(occupantName, { userId: assignment?.occupantId })
  : occupantName;
```

**Step 3: Commit if changed**

```bash
git add frontend/src/hooks/useDeviceAssignments.js
git commit -m "$(cat <<'EOF'
fix(assignments): respect preferGroupLabels in device assignments

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `FitnessContext.jsx:1506` | Remove `preferGroupLabel: false` hardcode |
| `FitnessUsers.jsx:669-687,975` | Remove unused `getHouseholdDisplayLabel` |
| `useDeviceAssignments.js:26` | (Optional) Apply same fix |

## Testing Checklist

- [ ] Start fitness app with 1 HR device → Sidebar shows "KC Kern"
- [ ] Add second HR device (kid) → Sidebar shows "Dad" for configured user
- [ ] Lock screen shows "Dad" when governance activates (no regression)
- [ ] Device assignment modal shows correct label (verify expected behavior)

---

## Appendix: Data Flow Diagram

```
Config: group_label: "Dad" for KC Kern
            ↓
userGroupLabelMap.set("KC Kern", "Dad")
            ↓
getDisplayLabel("KC Kern", { preferGroupLabel: <from context> })
            ↓
preferGroupLabels = (heartRateDevices.length > 1)
            ↓
If 2+ devices: resolveDisplayLabel({ preferGroupLabel: true }) → "Dad"
If 1 device:   resolveDisplayLabel({ preferGroupLabel: false }) → "KC Kern"
```
