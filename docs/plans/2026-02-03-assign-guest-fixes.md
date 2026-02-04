# Assign Guest Bug Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical baseUserName bug, add service-layer validation for one-device-per-user constraint, and clean up code inconsistencies.

**Architecture:** Three targeted fixes to GuestAssignmentService.js (critical bug), service-layer validation (moderate gap), and cleanup of dead code and inconsistencies in FitnessSidebarMenu.jsx and UserManager.js.

**Tech Stack:** JavaScript (ES modules), Jest for unit tests, React (JSX)

---

## Task 1: Fix baseUserName Overwrite Bug (Critical)

**Files:**
- Modify: `frontend/src/hooks/fitness/GuestAssignmentService.js:238-245`
- Create: `tests/isolated/domain/fitness/GuestAssignmentService.unit.test.mjs`

**Step 1: Write failing test for baseUserName preservation**

Create `tests/isolated/domain/fitness/GuestAssignmentService.unit.test.mjs`:

```javascript
// tests/isolated/domain/fitness/GuestAssignmentService.unit.test.mjs
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock logger
const mockWarn = jest.fn();
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ warn: mockWarn, info: jest.fn(), debug: jest.fn(), error: jest.fn() }),
  getLogger: () => ({ warn: mockWarn, info: jest.fn(), debug: jest.fn(), error: jest.fn() })
}));

describe('GuestAssignmentService', () => {
  let GuestAssignmentService;
  let validateGuestAssignmentPayload;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await import('#frontend/hooks/fitness/GuestAssignmentService.js');
    GuestAssignmentService = module.GuestAssignmentService;
    validateGuestAssignmentPayload = module.validateGuestAssignmentPayload;
  });

  describe('baseUserName preservation', () => {
    test('should preserve baseUserName from assignment payload, not overwrite with guest name', () => {
      // Arrange: Alice owns device, Bob is being assigned as guest
      const mockLedger = {
        get: jest.fn().mockReturnValue(null),
        entries: new Map()
      };
      const mockUserManager = {
        assignGuest: jest.fn()
      };
      const mockSession = {
        userManager: mockUserManager,
        createSessionEntity: jest.fn().mockReturnValue({ entityId: 'entity-123' }),
        eventJournal: { log: jest.fn() }
      };

      const service = new GuestAssignmentService({ session: mockSession, ledger: mockLedger });

      // Act: Assign Bob to Alice's device
      const result = service.assignGuest('device-1', {
        name: 'Bob',
        profileId: 'bob-123',
        baseUserName: 'Alice'  // Alice is the original owner
      });

      // Assert: userManager.assignGuest should receive Alice as baseUserName, NOT Bob
      expect(result.ok).toBe(true);
      expect(mockUserManager.assignGuest).toHaveBeenCalledWith(
        'device-1',
        'Bob',
        expect.objectContaining({
          baseUserName: 'Alice'  // CRITICAL: Must be Alice, not Bob
        })
      );
    });

    test('should preserve baseUserName through chain of guest swaps (A->B->C)', () => {
      // Arrange
      const mockUserManager = { assignGuest: jest.fn() };
      const mockSession = {
        userManager: mockUserManager,
        createSessionEntity: jest.fn().mockReturnValue({ entityId: 'entity-456' }),
        endSessionEntity: jest.fn(),
        eventJournal: { log: jest.fn() }
      };

      // Simulate ledger with Bob currently assigned (baseUserName=Alice)
      const mockLedger = {
        get: jest.fn().mockReturnValue({
          deviceId: 'device-1',
          metadata: { profileId: 'bob-123', baseUserName: 'Alice' },
          occupantId: 'bob-123',
          entityId: 'entity-prev',
          updatedAt: Date.now() - 120000  // 2 min ago (past grace period)
        }),
        entries: new Map()
      };

      const service = new GuestAssignmentService({ session: mockSession, ledger: mockLedger });

      // Act: Assign Carol (third person in chain)
      const result = service.assignGuest('device-1', {
        name: 'Carol',
        profileId: 'carol-789',
        baseUserName: 'Alice'  // Still Alice - the ORIGINAL owner
      });

      // Assert: baseUserName should still be Alice
      expect(result.ok).toBe(true);
      expect(mockUserManager.assignGuest).toHaveBeenCalledWith(
        'device-1',
        'Carol',
        expect.objectContaining({
          baseUserName: 'Alice'  // Must preserve original owner through chain
        })
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/domain/fitness/GuestAssignmentService.unit.test.mjs`

Expected: FAIL with assertion error - baseUserName will be "Bob" instead of "Alice"

**Step 3: Fix the bug in GuestAssignmentService.js**

Modify `frontend/src/hooks/fitness/GuestAssignmentService.js:238-245`:

```javascript
    // Build metadata for the new assignment
    const metadata = {
      ...value.metadata,
      baseUserName: value.baseUserName || value.metadata?.baseUserName || null,  // FIXED: Preserve original owner
      profileId: newOccupantId,
      occupantId: newOccupantId,
      occupantName: value.name,
      entityId: entityId
    };
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/domain/fitness/GuestAssignmentService.unit.test.mjs`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/isolated/domain/fitness/GuestAssignmentService.unit.test.mjs frontend/src/hooks/fitness/GuestAssignmentService.js
git commit -m "$(cat <<'EOF'
fix(fitness): preserve baseUserName in guest assignments

Previously, GuestAssignmentService.assignGuest() was overwriting
baseUserName with the guest's name (value.name) instead of preserving
the original device owner's name (value.baseUserName).

This broke the "restore to original owner" flow after any guest
assignment, making it impossible to track the original device owner
through chains of guest swaps (A→B→C).

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add Service-Layer Validation for One-Device-Per-User

**Files:**
- Modify: `frontend/src/hooks/fitness/GuestAssignmentService.js:67-90`
- Modify: `tests/isolated/domain/fitness/GuestAssignmentService.unit.test.mjs`

**Step 1: Write failing test for duplicate assignment prevention**

Add to `tests/isolated/domain/fitness/GuestAssignmentService.unit.test.mjs`:

```javascript
  describe('one-device-per-user constraint', () => {
    test('should reject assignment if user is already assigned to another device', () => {
      // Arrange: Bob is already assigned to device-2
      const existingEntries = new Map([
        ['device-2', {
          deviceId: 'device-2',
          metadata: { profileId: 'bob-123' },
          occupantId: 'bob-123'
        }]
      ]);

      const mockLedger = {
        get: jest.fn().mockReturnValue(null),
        entries: existingEntries
      };
      const mockUserManager = { assignGuest: jest.fn() };
      const mockSession = {
        userManager: mockUserManager,
        createSessionEntity: jest.fn(),
        eventJournal: { log: jest.fn() }
      };

      const service = new GuestAssignmentService({ session: mockSession, ledger: mockLedger });

      // Act: Try to assign Bob to device-1 (he's already on device-2)
      const result = service.assignGuest('device-1', {
        name: 'Bob',
        profileId: 'bob-123',
        baseUserName: 'Alice'
      });

      // Assert: Should reject with user-already-assigned error
      expect(result.ok).toBe(false);
      expect(result.code).toBe('user-already-assigned');
      expect(result.message).toContain('device-2');
      expect(mockUserManager.assignGuest).not.toHaveBeenCalled();
    });

    test('should allow assignment if user has allowWhileAssigned flag', () => {
      // Arrange: Generic "Guest" is assigned to device-2 but has allowWhileAssigned
      const existingEntries = new Map([
        ['device-2', {
          deviceId: 'device-2',
          metadata: { profileId: 'guest', allowWhileAssigned: true },
          occupantId: 'guest'
        }]
      ]);

      const mockLedger = {
        get: jest.fn().mockReturnValue(null),
        entries: existingEntries
      };
      const mockUserManager = { assignGuest: jest.fn() };
      const mockSession = {
        userManager: mockUserManager,
        createSessionEntity: jest.fn().mockReturnValue({ entityId: 'entity-new' }),
        eventJournal: { log: jest.fn() }
      };

      const service = new GuestAssignmentService({ session: mockSession, ledger: mockLedger });

      // Act: Assign "Guest" to device-1 (allowWhileAssigned should bypass)
      const result = service.assignGuest('device-1', {
        name: 'Guest',
        profileId: 'guest',
        allowWhileAssigned: true,
        baseUserName: 'Alice'
      });

      // Assert: Should succeed
      expect(result.ok).toBe(true);
      expect(mockUserManager.assignGuest).toHaveBeenCalled();
    });

    test('should allow re-assignment to same device (update scenario)', () => {
      // Arrange: Bob is already on device-1, we're updating his assignment
      const existingEntries = new Map([
        ['device-1', {
          deviceId: 'device-1',
          metadata: { profileId: 'bob-123' },
          occupantId: 'bob-123'
        }]
      ]);

      const mockLedger = {
        get: jest.fn().mockReturnValue(existingEntries.get('device-1')),
        entries: existingEntries
      };
      const mockUserManager = { assignGuest: jest.fn() };
      const mockSession = {
        userManager: mockUserManager,
        createSessionEntity: jest.fn().mockReturnValue({ entityId: 'entity-new' }),
        eventJournal: { log: jest.fn() }
      };

      const service = new GuestAssignmentService({ session: mockSession, ledger: mockLedger });

      // Act: Re-assign Bob to same device (update metadata)
      const result = service.assignGuest('device-1', {
        name: 'Bob',
        profileId: 'bob-123',
        baseUserName: 'Alice'
      });

      // Assert: Should succeed (same device)
      expect(result.ok).toBe(true);
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/domain/fitness/GuestAssignmentService.unit.test.mjs`

Expected: FAIL - first test will pass (no validation exists), need to verify current behavior

**Step 3: Implement one-device-per-user validation**

Modify `frontend/src/hooks/fitness/GuestAssignmentService.js`. Add after line 81 (after validation):

```javascript
  assignGuest(deviceId, assignment) {
    if (deviceId == null) {
      return { ok: false, code: 'invalid-device', message: 'Device id is required.' };
    }

    if (assignment == null) {
      return this.clearGuest(deviceId);
    }

    const validation = validateGuestAssignmentPayload(assignment);
    if (!validation.ok) {
      return { ok: false, code: 'invalid-payload', message: validation.errors.join(' ') };
    }

    const { value } = validation;
    const key = String(deviceId);
    const session = this.session;
    const now = Date.now();

    if (!session?.userManager) {
      return { ok: false, code: 'session-missing', message: 'User manager is not available.' };
    }

    // NEW: Validate one-device-per-user constraint
    const newProfileId = value.profileId || value.metadata?.profileId;
    const allowMultiAssign = value.allowWhileAssigned || value.metadata?.allowWhileAssigned;

    if (newProfileId && this.ledger && !allowMultiAssign) {
      for (const [existingDeviceId, entry] of this.ledger.entries.entries()) {
        if (existingDeviceId === key) continue; // Skip current device (update scenario)

        const existingProfileId = entry?.metadata?.profileId || entry?.occupantId;
        const existingAllowMulti = entry?.metadata?.allowWhileAssigned;

        if (existingProfileId === newProfileId && !existingAllowMulti) {
          return {
            ok: false,
            code: 'user-already-assigned',
            message: `User ${value.name || newProfileId} is already assigned to device ${existingDeviceId}`
          };
        }
      }
    }

    // ... rest of existing code
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/domain/fitness/GuestAssignmentService.unit.test.mjs`

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GuestAssignmentService.js tests/isolated/domain/fitness/GuestAssignmentService.unit.test.mjs
git commit -m "$(cat <<'EOF'
feat(fitness): add service-layer validation for one-device-per-user

Previously, the one-device-per-user constraint was only enforced in the
UI (FitnessSidebarMenu.jsx). This meant race conditions or direct API
calls could assign the same user to multiple devices.

Now GuestAssignmentService.assignGuest() validates this constraint:
- Rejects if user is already assigned to another device
- Respects allowWhileAssigned flag for multi-device users (e.g., "Guest")
- Allows re-assignment to same device (update scenario)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Unify allowWhileAssigned Logic

**Files:**
- Modify: `frontend/src/hooks/fitness/UserManager.js:615-626`
- Modify: `frontend/src/modules/Fitness/FitnessSidebar.jsx:80-87`

**Step 1: Document the expected behavior**

The `allowWhileAssigned` flag should be:
- `true` for generic "Guest" (always)
- `true` for Friends (current behavior)
- `true` for primary family members who have been displaced (returnees)
- `false` for all other users

**Step 2: Update UserManager.getGuestCandidates to be consistent**

Modify `frontend/src/hooks/fitness/UserManager.js:615-626`:

```javascript
  getGuestCandidates() {
    const collections = this.getUserCollections();
    return [
      ...collections.family,
      ...collections.friends,
      ...collections.secondary,
      ...collections.other
    ].map((descriptor) => ({
      ...descriptor,
      // Friends can always be multi-assigned (visit multiple households)
      // Generic Guest can always be multi-assigned
      // Family members default to single-assign unless explicitly marked
      allowWhileAssigned: descriptor.source === 'Friend' || descriptor.id === 'guest'
    }));
  }
```

**Step 3: Add comment clarifying FitnessSidebar.jsx logic**

Modify `frontend/src/modules/Fitness/FitnessSidebar.jsx:80-87` to add clarifying comment:

```javascript
      // Primary family members who have been displaced by guests can be
      // assigned to multiple devices (returnee scenario). This allows
      // the original owner to "reclaim" their device even if they're
      // temporarily listed as a candidate for another device.
      primaryGuestPool.push({
        ...match,
        id,
        profileId: id,
        category: 'Family',
        source: match.source || 'Family',
        allowWhileAssigned: true  // Returnees can multi-assign
      });
```

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/UserManager.js frontend/src/modules/Fitness/FitnessSidebar.jsx
git commit -m "$(cat <<'EOF'
docs(fitness): clarify allowWhileAssigned logic for guest candidates

Add comments explaining when allowWhileAssigned is set:
- Friends: always (can visit multiple households)
- Generic Guest: always (placeholder identity)
- Primary returnees: always (can reclaim their device)
- Others: never (single-device assignment)

No functional change - just documentation for maintainability.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Remove Dead Code (handleClearGuest)

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx:20,236-240`

**Step 1: Verify handleClearGuest is not used**

Search for usage:
```bash
grep -r "handleClearGuest" frontend/src/
grep -r "clearGuestAssignment" frontend/src/modules/Fitness/FitnessSidebar/
```

Expected: Only definition, no calls to handleClearGuest; clearGuestAssignment passed but unused.

**Step 2: Remove dead code**

Modify `frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx`:

Remove from props (line 20):
```javascript
// BEFORE:
  clearGuestAssignment,

// AFTER:
  // clearGuestAssignment removed - "Original" uses handleAssignGuest instead
```

Remove the unused function (lines 236-240):
```javascript
// REMOVE THIS BLOCK:
  const handleClearGuest = () => {
    if (!deviceIdStr || !clearGuestAssignment) return;
    clearGuestAssignment(deviceIdStr);
    if (onClose) onClose();
  };
```

**Step 3: Update FitnessSidebar.jsx to not pass unused prop**

Modify `frontend/src/modules/Fitness/FitnessSidebar.jsx:269`:

```javascript
// BEFORE:
            clearGuestAssignment={clearGuestAssignment}

// AFTER:
            // clearGuestAssignment removed - unused, see Task 4
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessSidebarMenu.jsx frontend/src/modules/Fitness/FitnessSidebar.jsx
git commit -m "$(cat <<'EOF'
refactor(fitness): remove unused handleClearGuest and clearGuestAssignment prop

The handleClearGuest function was defined but never called.
When users select "Original" to restore the device owner,
handleAssignGuest is used instead (creates assignment record
for original owner rather than clearing).

Removed:
- handleClearGuest function from FitnessSidebarMenu
- clearGuestAssignment prop (unused)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update Documentation

**Files:**
- Modify: `docs/reference/fitness/assign-guest.md`
- Move: `docs/_wip/audits/2026-02-03-assign-guest-audit.md` → `docs/_archive/`

**Step 1: Update assign-guest.md with fixes**

Add a "Known Issues (Resolved)" section or update existing text to reflect fixes.

**Step 2: Archive the audit document**

```bash
mv docs/_wip/audits/2026-02-03-assign-guest-audit.md docs/_archive/audits/
```

**Step 3: Commit**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs(fitness): update assign-guest reference after bug fixes

- Archive 2026-02-03 audit (issues resolved)
- Update reference docs to reflect current behavior

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Task | Type | Priority | Files Changed |
|------|------|----------|---------------|
| 1 | Bug fix | P0 | GuestAssignmentService.js, new test file |
| 2 | Feature | P1 | GuestAssignmentService.js, test file |
| 3 | Docs | P2 | UserManager.js, FitnessSidebar.jsx |
| 4 | Cleanup | P2 | FitnessSidebarMenu.jsx, FitnessSidebar.jsx |
| 5 | Docs | P3 | assign-guest.md, archive audit |

**Total commits:** 5
**Test files created:** 1
**Lines changed:** ~100
