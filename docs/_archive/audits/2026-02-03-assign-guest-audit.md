# Assign Guest Code Audit

**Date**: 2026-02-03
**Scope**: Guest assignment lifecycle, constraint enforcement, entity management
**Reference**: `docs/reference/fitness/assign-guest.md`

---

## Summary

Audit of the Assign Guest system against documented constraints reveals **1 critical bug**, **2 moderate issues**, and **3 minor concerns**. The UI-layer filtering is well-implemented, but the service layer lacks validation, creating potential for constraint violations.

---

## Critical Issues

### 1. baseUserName Overwritten with Guest Name

**Severity**: Critical
**Location**: `frontend/src/hooks/fitness/GuestAssignmentService.js:238-240`

```javascript
const metadata = {
  ...value.metadata,           // Contains correct baseUserName from UI
  baseUserName: value.name,    // BUG: Overwrites with guest's name!
  profileId: newOccupantId,
  ...
};
```

**Expected behavior**: `baseUserName` should preserve the original device owner's name (passed from UI as `value.baseUserName`).

**Actual behavior**: `baseUserName` is overwritten with `value.name` (the new guest's name).

**Impact**:
- "Original" option in UI may not appear correctly after first guest assignment
- Chain of guest swaps (A→B→C) loses reference to original owner A
- Restoring to original owner becomes impossible after multiple swaps

**Root cause trace**:
```
UI (FitnessSidebarMenu.jsx:231):
  assignGuestToDevice(deviceId, { baseUserName: baseName })  // Correct: "Alice"
    ↓
GuestAssignmentService.js:76:
  const { value } = validateGuestAssignmentPayload(assignment);
  // value.baseUserName = "Alice" (correct)
  // value.name = "Bob" (new guest)
    ↓
GuestAssignmentService.js:240:
  metadata.baseUserName = value.name  // BUG: Sets to "Bob" instead of "Alice"
```

**Fix**: Change line 240 to:
```javascript
baseUserName: value.baseUserName || value.metadata?.baseUserName || null,
```

---

## Moderate Issues

### 2. One-Device-Per-User Constraint is UI-Only

**Severity**: Moderate
**Location**: UI filtering in `FitnessSidebarMenu.jsx:138-150`, no validation in `GuestAssignmentService.js`

**Documented constraint**: "A user can only be assigned to one device at a time"

**Current implementation**:
- UI filters out already-assigned users from candidate list (correct)
- `GuestAssignmentService.assignGuest()` performs **no validation** of this constraint

**Impact**:
- Direct API calls could bypass the constraint
- Race conditions (two simultaneous UI interactions) could assign same user to two devices
- Programmatic assignment (e.g., `setParticipantRoster`) could violate constraint

**Violation scenario**:
```javascript
// Two rapid clicks on different devices selecting same user
// Frame 1: Device #1 assignment starts (Bob)
// Frame 2: Device #2 assignment starts (Bob) - UI hasn't re-rendered yet
// Result: Bob assigned to both devices
```

**Recommendation**: Add validation in `GuestAssignmentService.assignGuest()`:
```javascript
// Check if user is already assigned to another device
if (this.ledger) {
  for (const [existingDeviceId, entry] of this.ledger.entries.entries()) {
    if (existingDeviceId === key) continue; // Skip current device
    if (entry.metadata?.profileId === newOccupantId) {
      return { ok: false, code: 'user-already-assigned',
               message: `User already assigned to device ${existingDeviceId}` };
    }
  }
}
```

---

### 3. allowWhileAssigned Inconsistency

**Severity**: Moderate
**Location**:
- `frontend/src/modules/Fitness/FitnessSidebar.jsx:86` - Primary users get `allowWhileAssigned: true`
- `frontend/src/hooks/fitness/UserManager.js:624` - Only Friends get this flag

**Inconsistency**:
```javascript
// FitnessSidebar.jsx:86 (in primaryGuestPool building)
primaryGuestPool.push({
  ...match,
  allowWhileAssigned: true  // Primary users can be multi-assigned
});

// UserManager.js:624 (in getGuestCandidates)
return [...].map((descriptor) => ({
  ...descriptor,
  allowWhileAssigned: descriptor.source === 'Friend'  // Only Friends
}));
```

**Impact**: Primary family members displaced by guests can be assigned to multiple devices (intentional for "returnee" scenario), but Friends always can. The logic differs between initialization paths.

**Potential confusion**:
- Primary users from `replacedPrimaryPool` have `allowWhileAssigned: true`
- Primary users from `UserManager.getGuestCandidates()` do NOT have this flag
- Depends on which code path builds the candidate list

**Recommendation**: Centralize `allowWhileAssigned` logic. Document which user categories should have this flag.

---

## Minor Issues

### 4. Dead Code: handleClearGuest Never Called

**Severity**: Minor
**Location**: `frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx:236-240`

```javascript
const handleClearGuest = () => {
  if (!deviceIdStr || !clearGuestAssignment) return;
  clearGuestAssignment(deviceIdStr);
  if (onClose) onClose();
};
```

**Observation**: This function is defined but **never invoked** from any UI element.

**Current behavior**:
- Selecting "Original" calls `handleAssignGuest(option)` with original owner's info
- This creates a NEW assignment record rather than clearing the guest assignment
- `clearGuestAssignment` prop is passed but unused

**Impact**:
- When original owner reclaims device, a new session entity is created
- Previous entity is properly ended, but accounting differs from "true clear"
- Dead code clutters the component

**Recommendation**: Either:
1. Remove `handleClearGuest` and `clearGuestAssignment` prop, or
2. Use `clearGuestAssignment` for "Original" selections (changes entity lifecycle semantics)

---

### 5. Entity Creation on Owner Restoration

**Severity**: Minor (possibly intentional)
**Location**: `GuestAssignmentService.js` - assignment flow

**Behavior**: When Alice reclaims her device from guest Bob:
1. Bob's entity is ended (status: 'dropped' or 'transferred')
2. A NEW entity is created for Alice
3. Alice now has a session entity (even though she's the original owner)

**Question**: Should original owners have session entities?

**Current design**: Yes - consistent tracking regardless of owner vs guest
**Alternative**: Clear assignment entirely, device reverts to config-based mapping

**Recommendation**: Document this as intentional design decision in reference docs.

---

### 6. getUserByName Case-Insensitive Fallback

**Severity**: Minor
**Location**: `frontend/src/context/FitnessContext.jsx:2086-2098`

```javascript
getUserByName: (nameOrId) => {
  // Direct lookup by ID
  if (users.has(nameOrId)) return users.get(nameOrId);

  // Fallback: search by name (case-insensitive)
  const lowerName = String(nameOrId).toLowerCase();
  for (const user of users.values()) {
    if (user.name?.toLowerCase() === lowerName || user.id === lowerName) {
      return user;
    }
  }
  return null;
}
```

**Potential issue**: If two users have similar names (e.g., "Bob" and "bob"), the fallback could return the wrong user.

**Usage in Assign Guest**: `FitnessSidebarMenu.jsx:155`:
```javascript
const baseUserId = fitnessContext?.getUserByName?.(baseName)?.id;
```

**Impact**: If `baseName` matches multiple users, the first found is returned (non-deterministic).

**Recommendation**: Prefer explicit ID lookup. Log warning when fallback to name search is used.

---

## Constraint Adherence Matrix

| Constraint | UI Enforced | Service Enforced | Status |
|------------|-------------|------------------|--------|
| One user per device | Yes (replaces) | Yes (upsert) | OK |
| One device per user | Yes (filtering) | **No** | GAP |
| Base user preservation | Yes (passes data) | **No (overwrites)** | BUG |
| Grace period transfer | N/A | Yes | OK |
| Entity lifecycle | N/A | Partial | OK |
| Multi-assignable flag | Yes | N/A (UI-only) | OK |

---

## Flowchart: Actual vs Expected

### Documented Flow (Expected)
```
Assign Bob to Alice's device:
  UI: baseUserName = "Alice"
  Service: stores baseUserName = "Alice"
  Later: "Original" option shows "Alice"
  Select "Alice": baseUserName = "Alice" (preserved)
```

### Actual Flow (Buggy)
```
Assign Bob to Alice's device:
  UI: baseUserName = "Alice"
  Service: overwrites baseUserName = "Bob"  ← BUG
  Later: "Original" may not work correctly

Chain scenario (Alice's device):
  Assign Bob:   baseUserName becomes "Bob" (should be "Alice")
  Assign Carol: baseUserName becomes "Carol" (should still be "Alice")
  Select "Original": ??? (reference to Alice is lost)
```

---

## Recommendations

### Immediate (P0)
1. Fix `baseUserName` overwrite bug in `GuestAssignmentService.js:240`

### Short-term (P1)
2. Add service-layer validation for one-device-per-user constraint
3. Unify `allowWhileAssigned` logic between FitnessSidebar and UserManager

### Medium-term (P2)
4. Remove dead `handleClearGuest` code
5. Add unit tests for constraint validation
6. Document entity lifecycle design decisions

---

## Test Coverage Gaps

| Scenario | Covered | Location |
|----------|---------|----------|
| Simple guest swap | Unknown | - |
| Chain of guest swaps (A→B→C→A) | **No** | - |
| Same user on two devices race | **No** | - |
| allowWhileAssigned bypass | **No** | - |
| baseUserName preservation across swaps | **No** | - |
| Grace period transfer | Partial | governance tests |

---

## Files Reviewed

| File | Lines | Notes |
|------|-------|-------|
| `FitnessSidebarMenu.jsx` | 481 | UI filtering, candidate building |
| `GuestAssignmentService.js` | 310 | **Contains critical bug** |
| `DeviceAssignmentLedger.js` | 179 | Ledger storage |
| `UserManager.js` | 649 | User-device mapping |
| `FitnessContext.jsx` | 2108 | State management |
| `FitnessSession.js` | ~900 | Entity lifecycle |
| `FitnessSidebar.jsx` | ~300 | Candidate pool building |
