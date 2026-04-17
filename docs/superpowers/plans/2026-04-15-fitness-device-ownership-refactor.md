# Fitness Device Ownership SSoT Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate "does this device belong to this user?" into a single resolution path, eliminating 15+ inline reimplementations scattered across the fitness module.

**Architecture:** Extract a `DeviceOwnershipIndex` from UserManager that maps device IDs to user descriptors. Wire `getUserByDevice` through the index internally so there is a single resolution path. Replace all inline `.find(u => u.hrDeviceId === id)` patterns and hand-built device-to-name maps with calls through context. Roster entries carry `hrDeviceIds` (array) so downstream consumers never need to re-resolve ownership.

**Tech Stack:** React hooks, ES modules, Jest unit tests

**Audit:** `docs/_wip/audits/2026-04-15-fitness-device-ownership-ssot-audit.md`

---

## Current State (pre-refactor)

An audit of the codebase shows that **~85% of the multi-device plumbing already exists**. This plan completes the remaining work and eliminates the scattered inline patterns.

| Capability | Status | Notes |
|------------|--------|-------|
| `User.hrDeviceIds` (Set) | **Exists** | Constructor initializes Set, getter/setter for backwards-compat `hrDeviceId` |
| `User.ownsHrDevice()` | **Exists** | Checks the canonical Set |
| `UserManager.registerUser()` array handling | **Exists** | Accepts `hr_device_ids` arrays, falls back to single `hr` field |
| `DeviceOwnershipIndex` | **Missing** | The new SSoT class — provides O(1) device→user lookup |
| Roster entry `hrDeviceIds` field | **Missing** | Entries only have single `hrDeviceId` |
| `getUserByDevice` via ownership index | **Missing** | `resolveUserByDevice` exists but doesn't route through the index yet |
| Inline `.find()` fallbacks in UI components | **Present** | FitnessUsers, FullscreenVitalsOverlay, SidebarFooter all have them |
| FitnessSession defensive `\|\|` fallbacks | **Present** | `ownsHrDevice()` + `hrDeviceId` string comparison |

**Implication for execution:** Tasks 2 and 7 are "verify + polish" rather than "build from scratch." Tests in Task 2 will mostly pass against existing code — the TDD cycle confirms correctness rather than driving new implementation. Task 7's SidebarFooter maps are already multi-device aware; the delta is small.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `frontend/src/hooks/fitness/DeviceOwnershipIndex.js` | Single source of truth: device ID to user descriptor mapping, multi-device aware |
| Create | `tests/unit/fitness/DeviceOwnershipIndex.test.mjs` | Unit tests for the index |
| Modify | `frontend/src/hooks/fitness/UserManager.js` | Delegate ownership queries to index, expose `deviceOwnershipIndex` |
| Modify | `tests/unit/fitness/UserManager.test.mjs` | Add multi-device tests |
| Modify | `frontend/src/hooks/fitness/ParticipantRoster.js` | Roster entries emit `hrDeviceIds` array; use index for lookups |
| Modify | `frontend/src/context/FitnessContext.jsx` | Wire `getUserByDevice` through index; multi-device `participantLookupByDevice` |
| Modify | `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` | Replace inline `.find()` with context query |
| Modify | `frontend/src/modules/Fitness/nav/SidebarFooter.jsx` | Verify/polish existing multi-device maps (already mostly correct) |
| Modify | `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx` | Replace inline `.find()` with context query |
| Delete | `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx` | Deduplicate — redirect imports to player/overlays copy |

---

## Task 1: Create DeviceOwnershipIndex

**Files:**
- Create: `frontend/src/hooks/fitness/DeviceOwnershipIndex.js`
- Create: `tests/unit/fitness/DeviceOwnershipIndex.test.mjs`

This is the new SSOT. A plain class (not a React hook) that maintains a `Map<string, UserDescriptor>` from device ID to user info. It is rebuilt by UserManager whenever registrations or assignments change.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/unit/fitness/DeviceOwnershipIndex.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn()
  })
}));

const { DeviceOwnershipIndex } = await import('#frontend/hooks/fitness/DeviceOwnershipIndex.js');

describe('DeviceOwnershipIndex', () => {
  let index;

  beforeEach(() => {
    index = new DeviceOwnershipIndex();
  });

  describe('rebuild', () => {
    it('maps a single HR device to its owner', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      const owner = index.getOwner('20991');
      expect(owner).not.toBeNull();
      expect(owner.id).toBe('alan');
      expect(owner.name).toBe('Alan');
    });

    it('maps multiple HR devices to the same owner', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991', '10366', '28676']), cadenceDeviceId: null }
      ]);
      expect(index.getOwner('20991').id).toBe('alan');
      expect(index.getOwner('10366').id).toBe('alan');
      expect(index.getOwner('28676').id).toBe('alan');
    });

    it('maps cadence devices', () => {
      index.rebuild([
        { id: 'user1', name: 'User', hrDeviceIds: new Set(), cadenceDeviceId: '49904' }
      ]);
      expect(index.getOwner('49904').id).toBe('user1');
    });

    it('returns null for unknown device', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      expect(index.getOwner('99999')).toBeNull();
    });

    it('coerces numeric device IDs to strings', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      expect(index.getOwner(20991).id).toBe('alan');
    });

    it('replaces previous index on rebuild', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      index.rebuild([
        { id: 'felix', name: 'Felix', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      expect(index.getOwner('20991').id).toBe('felix');
    });
  });

  describe('getDeviceIdsForUser', () => {
    it('returns all device IDs for a user', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991', '10366']), cadenceDeviceId: '7183' }
      ]);
      const ids = index.getDeviceIdsForUser('alan');
      expect(ids).toContain('20991');
      expect(ids).toContain('10366');
      expect(ids).toContain('7183');
    });

    it('returns empty array for unknown user', () => {
      index.rebuild([]);
      expect(index.getDeviceIdsForUser('nobody')).toEqual([]);
    });
  });

  describe('ownsDevice', () => {
    it('returns true when user owns the device', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991', '10366']), cadenceDeviceId: null }
      ]);
      expect(index.ownsDevice('alan', '20991')).toBe(true);
      expect(index.ownsDevice('alan', '10366')).toBe(true);
    });

    it('returns false when a different user owns the device', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null },
        { id: 'felix', name: 'Felix', hrDeviceIds: new Set(['28812']), cadenceDeviceId: null }
      ]);
      expect(index.ownsDevice('alan', '28812')).toBe(false);
    });

    it('returns false for unknown device', () => {
      index.rebuild([
        { id: 'alan', name: 'Alan', hrDeviceIds: new Set(['20991']), cadenceDeviceId: null }
      ]);
      expect(index.ownsDevice('alan', '99999')).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/fitness/DeviceOwnershipIndex.test.mjs --no-cache`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// frontend/src/hooks/fitness/DeviceOwnershipIndex.js

/**
 * DeviceOwnershipIndex — single source of truth for device → user resolution.
 *
 * Maintains a Map<string, Descriptor> from device ID to owner info.
 * Rebuilt by UserManager whenever user registrations or assignments change.
 * All device IDs are stored and looked up as strings.
 */
export class DeviceOwnershipIndex {
  constructor() {
    /** @type {Map<string, {id: string, name: string, type: 'hr'|'cadence'}>} */
    this._byDevice = new Map();
    /** @type {Map<string, string[]>} userId → deviceIds */
    this._byUser = new Map();
  }

  /**
   * Rebuild the entire index from the current user list.
   * @param {Array<{id: string, name: string, hrDeviceIds: Set<string>|Array<string>, cadenceDeviceId: string|null}>} users
   * Note: hrDeviceIds accepts Set or Array (iterated with for...of). Some callers may pass arrays from config.
   */
  rebuild(users) {
    this._byDevice.clear();
    this._byUser.clear();

    for (const user of users) {
      const deviceIds = [];

      for (const devId of user.hrDeviceIds) {
        const key = String(devId);
        this._byDevice.set(key, { id: user.id, name: user.name, type: 'hr' });
        deviceIds.push(key);
      }

      if (user.cadenceDeviceId) {
        const key = String(user.cadenceDeviceId);
        this._byDevice.set(key, { id: user.id, name: user.name, type: 'cadence' });
        deviceIds.push(key);
      }

      if (deviceIds.length > 0) {
        this._byUser.set(user.id, deviceIds);
      }
    }
  }

  /**
   * Get the owner descriptor for a device ID.
   * @param {string|number} deviceId
   * @returns {{id: string, name: string, type: 'hr'|'cadence'}|null}
   */
  getOwner(deviceId) {
    return this._byDevice.get(String(deviceId)) || null;
  }

  /**
   * Get all device IDs owned by a user.
   * @param {string} userId
   * @returns {string[]}
   */
  getDeviceIdsForUser(userId) {
    return this._byUser.get(userId) || [];
  }

  /**
   * Check whether a specific user owns a specific device.
   * @param {string} userId
   * @param {string|number} deviceId
   * @returns {boolean}
   */
  ownsDevice(userId, deviceId) {
    const owner = this._byDevice.get(String(deviceId));
    return owner?.id === userId;
  }

  /**
   * Number of indexed devices (useful for debugging).
   * @returns {number}
   */
  get size() {
    return this._byDevice.size;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/fitness/DeviceOwnershipIndex.test.mjs --no-cache`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/DeviceOwnershipIndex.js tests/unit/fitness/DeviceOwnershipIndex.test.mjs
git commit -m "feat(fitness): add DeviceOwnershipIndex — SSoT for device-to-user mapping"
```

---

## Task 2: Wire DeviceOwnershipIndex into UserManager

**Files:**
- Modify: `frontend/src/hooks/fitness/UserManager.js`
- Modify: `tests/unit/fitness/UserManager.test.mjs`

**Current state:** `UserManager` and `User` are already named exports. `User` already has `hrDeviceIds` (Set), `ownsHrDevice()`, and the backwards-compat `hrDeviceId` getter/setter. `registerUser()` already handles `hr_device_ids` arrays. This task adds the index wiring and confirms existing behavior with tests. Most tests below will pass against the existing code — the TDD cycle here is confirmatory, not generative. The new behavior is: `_ownershipIndex` instantiation, `_rebuildOwnershipIndex()` calls, and `deviceOwnershipIndex` getter.

UserManager creates the index, rebuilds it on registration changes, and delegates `resolveUserForDevice` through it for the registered-user path. The ledger path stays in UserManager (it has side effects — creating users from assignments — that don't belong in a pure index).

- [ ] **Step 1: Write the tests (most will already pass; index tests will fail)**

Add these tests to `tests/unit/fitness/UserManager.test.mjs` at the end of the file, after the existing `describe` blocks:

```javascript
// ---- Add after the existing test imports, before the first describe ----
// Also import UserManager class
const { UserManager } = await import('#frontend/hooks/fitness/UserManager.js');

// ---- Add at end of file ----

describe('User multi-device ownership', () => {
  it('constructor accepts single hrDeviceId and stores in Set', () => {
    const user = new User('Alan', 2018, '20991', null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    expect(user.hrDeviceIds.has('20991')).toBe(true);
    expect(user.hrDeviceId).toBe('20991');
  });

  it('ownsHrDevice checks the Set', () => {
    const user = new User('Alan', 2018, '20991', null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceIds.add('10366');
    expect(user.ownsHrDevice('20991')).toBe(true);
    expect(user.ownsHrDevice('10366')).toBe(true);
    expect(user.ownsHrDevice('99999')).toBe(false);
  });

  it('hrDeviceId setter adds to Set (does not replace)', () => {
    const user = new User('Alan', 2018, '20991', null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceId = '10366';
    expect(user.hrDeviceIds.size).toBe(2);
    expect(user.ownsHrDevice('20991')).toBe(true);
    expect(user.ownsHrDevice('10366')).toBe(true);
  });

  it('hrDeviceId = null clears the Set', () => {
    const user = new User('Alan', 2018, '20991', null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceIds.add('10366');
    user.hrDeviceId = null;
    expect(user.hrDeviceIds.size).toBe(0);
    expect(user.hrDeviceId).toBeNull();
  });

  it('updateFromDevice accepts any owned device', () => {
    const user = new User('Alan', 2018, '20991', null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceIds.add('10366');

    user.updateFromDevice({ type: 'heart_rate', deviceId: '10366', heartRate: 110 });
    expect(user.currentData.heartRate).toBe(110);

    user.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 105 });
    // Multi-device: lowest wins
    expect(user.currentData.heartRate).toBe(105);
  });

  it('updateFromDevice ignores unowned device', () => {
    const user = new User('Alan', 2018, '20991', null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 110 });
    user.updateFromDevice({ type: 'heart_rate', deviceId: '99999', heartRate: 200 });
    expect(user.currentData.heartRate).toBe(110);
  });
});

describe('Multi-device HR arbitration (lowest wins)', () => {
  it('uses lowest HR when both devices report', () => {
    const user = new User('Alan', 2018, null, null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceIds.add('20991');
    user.hrDeviceIds.add('10366');

    user.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 130 });
    user.updateFromDevice({ type: 'heart_rate', deviceId: '10366', heartRate: 115 });
    expect(user.currentData.heartRate).toBe(115);
  });

  it('uses single device reading when only one reports', () => {
    const user = new User('Alan', 2018, null, null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceIds.add('20991');
    user.hrDeviceIds.add('10366');

    user.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 130 });
    expect(user.currentData.heartRate).toBe(130);
  });

  it('ignores stale readings from disconnected device', async () => {
    const user = new User('Alan', 2018, null, null, {
      id: 'alan',
      globalZones: TEST_ZONES
    });
    user.hrDeviceIds.add('20991');
    user.hrDeviceIds.add('10366');

    // Both report
    user.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 130 });
    user.updateFromDevice({ type: 'heart_rate', deviceId: '10366', heartRate: 115 });

    // Simulate 10366 going stale by manually backdating its pending entry
    user._pendingHR.get('10366').ts = Date.now() - 15000;

    // Only 20991 reports — stale 10366 should be pruned, use 20991's value
    user.updateFromDevice({ type: 'heart_rate', deviceId: '20991', heartRate: 140 });
    expect(user.currentData.heartRate).toBe(140);
  });
});

describe('UserManager.registerUser with hr_device_ids', () => {
  let manager;
  beforeEach(() => {
    manager = new UserManager();
    manager._defaultZones = TEST_ZONES;
  });

  it('registers all device IDs from hr_device_ids array', () => {
    manager.registerUser({
      name: 'Alan',
      id: 'alan',
      hr_device_ids: [20991, 10366, 28676]
    });
    const user = manager.getUser('alan');
    expect(user.hrDeviceIds.size).toBe(3);
    expect(user.ownsHrDevice('20991')).toBe(true);
    expect(user.ownsHrDevice('10366')).toBe(true);
    expect(user.ownsHrDevice('28676')).toBe(true);
  });

  it('falls back to single hr field when hr_device_ids absent', () => {
    manager.registerUser({
      name: 'Felix',
      id: 'felix',
      hr: 28812
    });
    const user = manager.getUser('felix');
    expect(user.hrDeviceIds.size).toBe(1);
    expect(user.ownsHrDevice('28812')).toBe(true);
  });

  it('exposes deviceOwnershipIndex after registration', () => {
    manager.registerUser({ name: 'Alan', id: 'alan', hr_device_ids: [20991, 10366] });
    manager.registerUser({ name: 'Felix', id: 'felix', hr: 28812 });

    const index = manager.deviceOwnershipIndex;
    expect(index).toBeDefined();
    expect(index.getOwner('20991').id).toBe('alan');
    expect(index.getOwner('10366').id).toBe('alan');
    expect(index.getOwner('28812').id).toBe('felix');
    expect(index.getOwner('99999')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — multi-device and User tests will pass; `deviceOwnershipIndex` tests will fail**

Run: `npx jest tests/unit/fitness/UserManager.test.mjs --no-cache`
Expected: PARTIAL FAIL — `User` and `UserManager` are already named exports with multi-device support, so those tests pass. Only the `deviceOwnershipIndex` tests fail (property not defined yet).

- [ ] **Step 3: Wire index into UserManager**

In `frontend/src/hooks/fitness/UserManager.js`, make these changes. Note: `UserManager` and `User` are already named exports — no export changes needed.

**Add import at top of file:**
```javascript
import { DeviceOwnershipIndex } from './DeviceOwnershipIndex.js';
```

**In the `UserManager` class constructor, initialize the index:**
Find the constructor (search for `class UserManager`). Add after `this.users = new Map()`:
```javascript
    this._ownershipIndex = new DeviceOwnershipIndex();
```

**Add a `deviceOwnershipIndex` getter:**
Add after the constructor:
```javascript
  get deviceOwnershipIndex() {
    return this._ownershipIndex;
  }
```

**Add a `_rebuildOwnershipIndex()` private method** that iterates `this.users` and calls `this._ownershipIndex.rebuild(...)`:
```javascript
  _rebuildOwnershipIndex() {
    this._ownershipIndex.rebuild(
      Array.from(this.users.values())
    );
  }
```

**Call `_rebuildOwnershipIndex()` at the end of `registerUser()`** — after `this.users.set(...)` in both the create and update branches. Add one call at the very end of the method, before the `return`:
```javascript
    this._rebuildOwnershipIndex();
    return this.users.get(resolvedUserId);
```

**Call `_rebuildOwnershipIndex()` at the end of `assignGuest()`** — after the guest user is created/updated. Add before `return payload;`:
```javascript
    this._rebuildOwnershipIndex();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/fitness/UserManager.test.mjs --no-cache`
Expected: All tests PASS (existing + new)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/UserManager.js frontend/src/hooks/fitness/DeviceOwnershipIndex.js tests/unit/fitness/UserManager.test.mjs
git commit -m "feat(fitness): wire DeviceOwnershipIndex into UserManager, add multi-device tests"
```

---

## Task 3: Roster Entries Carry `hrDeviceIds` Array

**Files:**
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js:432-456`

Currently roster entries have `hrDeviceId: deviceId` (a single string — the device that triggered this entry). This is correct for "which device is this entry about?" but downstream consumers wrongly use it to determine "which devices does this user own?" We add `hrDeviceIds` to each entry so consumers can answer both questions without re-resolving.

**Note:** `hrDeviceIds` on a roster entry is a **snapshot** of the user's device set at entry creation time. If a user's device set changes mid-session (device reconnects under a different ANT+ ID), some roster entries will have stale `hrDeviceIds` until the next roster rebuild. For live ownership queries, prefer `getDeviceOwner()` from context. Add a comment in the code to document this.

- [ ] **Step 1: Update `buildRosterEntry` to include `hrDeviceIds`**

In `frontend/src/hooks/fitness/ParticipantRoster.js`, find the roster entry construction (line ~432). The `mappedUser` variable is already resolved above via `resolveUserForDevice`. Add `hrDeviceIds` to the entry object:

```javascript
    const rosterEntry = {
      name: participantName,
      displayLabel,
      groupLabel: isGuest ? null : mappedUser?.groupLabel || null,
      profileId: userId,
      id: userId,
      entityId,
      timelineUserId,
      entityStartTime,
      baseUserName,
      isGuest,
      hrDeviceId: deviceId, // This specific device
      hrDeviceIds: mappedUser?.hrDeviceIds ? [...mappedUser.hrDeviceIds] : [String(deviceId)], // Snapshot of user's devices at entry creation — may be stale mid-session
      heartRate: resolvedHeartRate,
      // ... rest unchanged
```

- [ ] **Step 2: Update `getFullRoster` ghost entry to include `hrDeviceIds`**

In the same file, find `getFullRoster()` (line ~244). The ghost entry at line ~254 also needs the field:

```javascript
      const ghostEntry = {
        name: entry.occupantName || entry.metadata?.name || 'Unknown',
        displayLabel: entry.occupantName || entry.metadata?.name || 'Unknown',
        groupLabel: null,
        profileId: entry.metadata?.profileId || entry.occupantId,
        id: entry.metadata?.profileId || entry.occupantId,
        hrDeviceId: entry.deviceId,
        hrDeviceIds: [String(entry.deviceId)], // Ghost entries only have one known device
        // ... rest unchanged
```

- [ ] **Step 3: Update `getFullRoster` device dedup to check all IDs**

At line ~246, the dedup check builds a Set from roster `hrDeviceId`. Update it to also include all multi-device IDs:

Change:
```javascript
    const deviceIds = new Set(deviceRoster.map(e => e.hrDeviceId));
```
To:
```javascript
    const deviceIds = new Set(deviceRoster.flatMap(e => e.hrDeviceIds || [e.hrDeviceId].filter(Boolean)));
```

- [ ] **Step 4: Verify build succeeds**

Run: `cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -5`
Expected: `built in Xs` — no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.js
git commit -m "feat(fitness): roster entries carry hrDeviceIds array for multi-device resolution"
```

---

## Task 4: Wire Ownership Index Into FitnessContext (Single Resolution Path)

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

**Design decision:** Do NOT expose a separate `getDeviceOwner()` callback alongside `getUserByDevice`. Two resolution paths with different return types (full User vs. lightweight descriptor) will confuse downstream devs. Instead, wire `resolveUserByDevice` to check the ownership index first, keeping a single API surface. If a lightweight descriptor is needed later, add it when a consumer actually requires it.

Replace the hand-built `participantLookupByDevice` memo with one that indexes all device IDs per user. Wire `resolveUserByDevice` through the ownership index as a first-pass check.

- [ ] **Step 1: Replace `participantLookupByDevice` to index all device IDs**

In `frontend/src/context/FitnessContext.jsx`, find the `participantLookupByDevice` memo (line ~1591). Replace it:

```javascript
  const participantLookupByDevice = React.useMemo(() => {
    const map = new Map();
    participantRoster.forEach((entry) => {
      if (!entry) return;
      // Index ALL device IDs for this participant, not just the primary
      const allIds = entry.hrDeviceIds || [entry.hrDeviceId].filter(Boolean);
      for (const id of allIds) {
        const normalized = String(id);
        if (normalized && !map.has(normalized)) {
          map.set(normalized, entry);
        }
      }
    });
    return map;
  }, [participantRoster]);
```

- [ ] **Step 2: Wire `resolveUserByDevice` through the ownership index**

Find the `resolveUserByDevice` callback (line ~1835). Modify it to check the ownership index first, then fall back to the existing resolution logic. This keeps `getUserByDevice` as the single API while routing through the SSoT:

```javascript
  const resolveUserByDevice = React.useCallback((deviceId) => {
    if (deviceId == null) return null;
    const manager = session?.userManager;
    if (!manager) return null;
    // Priority 1: ownership index (O(1) lookup, includes all registered devices)
    const idx = manager.deviceOwnershipIndex;
    if (idx) {
      const owner = idx.getOwner(deviceId);
      if (owner) return manager.getUser(owner.id) || null;
    }
    // Priority 2: existing resolution (handles ledger/guest assignments with side effects)
    return manager.getUserByDeviceId?.(deviceId) || manager.resolveUserForDevice?.(deviceId) || null;
  }, [session]);
```

- [ ] **Step 3: Update `userVitalsMap` to handle multi-device**

Find the `userVitalsMap` memo (line ~1622). The line `const deviceId = user.hrDeviceId ? String(user.hrDeviceId) : null;` only checks first device. Change to:

```javascript
      const deviceId = user.hrDeviceId ? String(user.hrDeviceId) : null;
      const allDeviceIds = user.hrDeviceIds ? [...user.hrDeviceIds] : (deviceId ? [deviceId] : []);
      // Check if ANY of the user's devices have a ledger entry (guest detection)
      // Note: O(n*m) where n=users, m=devices per user — acceptable for <10 users with <5 devices each
      const ledgerEntry = allDeviceIds.reduce((found, id) => found || deviceAssignmentMap.get(id), null);
```

- [ ] **Step 4: Verify build succeeds**

Run: `cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -5`
Expected: `built in Xs` — no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): wire getUserByDevice through DeviceOwnershipIndex, multi-device participantLookup"
```

---

## Task 5: Replace Inline `.find()` in FitnessUsers

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx:538-540, 893-895`

Two call sites do `registeredUsers.find(u => ...)` as a fallback after `getUserByDevice`. Since `getUserByDevice` now resolves all device IDs (via the index), the fallback is dead code. Remove it.

- [ ] **Step 1: Simplify line ~538-540**

Find:
```javascript
    const userObj = typeof getUserByDevice === 'function'
      ? getUserByDevice(deviceKey)
      : registeredUsers.find(u => u.hrDeviceIds?.includes(deviceKey) || String(u.hrDeviceId) === deviceKey);
```

Replace with:
```javascript
    const userObj = getUserByDevice?.(deviceKey) || null;
```

- [ ] **Step 2: Simplify line ~893-895**

Find:
```javascript
                ? (typeof getUserByDevice === 'function'
                    ? getUserByDevice(deviceIdStr)
                    : registeredUsers.find(u => u.hrDeviceIds?.includes(deviceIdStr) || String(u.hrDeviceId) === deviceIdStr))
```

Replace with:
```javascript
                ? (getUserByDevice?.(deviceIdStr) || null)
```

- [ ] **Step 3: Verify build succeeds**

Run: `cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -5`
Expected: `built in Xs`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx
git commit -m "refactor(fitness): remove inline device find from FitnessUsers — use context query"
```

---

## Task 6: Replace Inline `.find()` in FullscreenVitalsOverlay

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx:144-146`
- Modify: `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx:146-148`

Same pattern as Task 5 — both copies have the identical fallback.

- [ ] **Step 1: Simplify `player/overlays/FullscreenVitalsOverlay.jsx` line ~144-146**

Find:
```javascript
        const user = typeof getUserByDevice === 'function'
          ? getUserByDevice(device.deviceId)
          : allUsers.find((u) => u.hrDeviceIds?.includes(String(device.deviceId)) || String(u.hrDeviceId) === String(device.deviceId));
```

Replace with:
```javascript
        const user = getUserByDevice?.(device.deviceId) || null;
```

- [ ] **Step 2: Simplify `shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx` line ~146-148**

Same change:
```javascript
        const user = getUserByDevice?.(device.deviceId) || null;
```

- [ ] **Step 3: Verify build succeeds**

Run: `cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -5`
Expected: `built in Xs`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx
git commit -m "refactor(fitness): remove inline device find from FullscreenVitalsOverlay — use context query"
```

---

## Task 7: Replace Hand-Built Maps in SidebarFooter

**Files:**
- Modify: `frontend/src/modules/Fitness/nav/SidebarFooter.jsx:86-111, 114-126`

**Current state:** SidebarFooter already handles `hrDeviceIds` arrays with multi-device iteration loops. The delta here is small — mainly ensuring it uses `hrDeviceIds` from roster entries (added in Task 3) consistently and removes the `usersConfigRaw` fallback path if it's now dead code. Verify the existing code first; if it already matches the target shape, skip to the commit with a "verified, no changes needed" message.

- [ ] **Step 1: Replace `hrOwnerMap` memo**

Find the `hrOwnerMap` useMemo (line ~86). Replace the entire memo:

```javascript
  const hrOwnerMap = React.useMemo(() => {
    const map = {};
    participantRoster.forEach((participant) => {
      if (!participant?.name) return;
      const deviceIds = participant.hrDeviceIds || (participant.hrDeviceId != null ? [participant.hrDeviceId] : []);
      for (const devId of deviceIds) {
        map[String(devId)] = participant.name;
      }
    });
    if (participantsByDevice && typeof participantsByDevice.forEach === 'function') {
      participantsByDevice.forEach((participant, key) => {
        if (!participant || key == null) return;
        if (!map[String(key)] && participant.name) {
          map[String(key)] = participant.name;
        }
      });
    }
    if (Object.keys(map).length === 0 && usersConfigRaw) {
      const addFrom = (arr) => Array.isArray(arr) && arr.forEach(cfg => {
        if (cfg) {
          const ids = cfg.hr_device_ids || (cfg.hr != null ? [cfg.hr] : []);
          for (const id of ids) map[String(id)] = cfg.name;
        }
      });
      addFrom(usersConfigRaw.primary);
      addFrom(usersConfigRaw.secondary);
    }
    return map;
  }, [participantRoster, participantsByDevice, usersConfigRaw]);
```

This is already close to the current code (after the earlier fix). The key improvement: it uses `hrDeviceIds` consistently and the `participantsByDevice` map is already multi-device indexed (from Task 4).

- [ ] **Step 2: Replace `userIdMap` / `participantByHrId` memo**

Find the `userIdMap` / `participantByHrId` useMemo (line ~114). Replace:

```javascript
  const { userIdMap, participantByHrId } = React.useMemo(() => {
    const participantMap = new Map();
    const map = {};
    participantRoster.forEach((participant) => {
      const profileId = participant.profileId
        || participant.id
        || getConfiguredProfileId(participant?.name);
      const deviceIds = participant.hrDeviceIds || (participant.hrDeviceId != null ? [participant.hrDeviceId] : []);
      for (const devId of deviceIds) {
        const normalized = String(devId);
        if (!map[normalized]) map[normalized] = profileId || 'user';
        if (!participantMap.has(normalized)) participantMap.set(normalized, participant);
      }
    });
    if (participantsByDevice && typeof participantsByDevice.forEach === 'function') {
      participantsByDevice.forEach((participant, key) => {
        if (!participant || key == null) return;
        const normalized = String(key);
        if (!participantMap.has(normalized)) {
          participantMap.set(normalized, participant);
        }
        if (!map[normalized]) {
          const profileId = participant.profileId
            || participant.id
            || getConfiguredProfileId(participant?.name);
          map[normalized] = profileId || 'user';
        }
      });
    }
    return { userIdMap: map, participantByHrId: participantMap };
  }, [participantRoster, participantsByDevice, getConfiguredProfileId]);
```

- [ ] **Step 3: Verify build succeeds**

Run: `cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -5`
Expected: `built in Xs`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/nav/SidebarFooter.jsx
git commit -m "refactor(fitness): SidebarFooter device maps use hrDeviceIds consistently"
```

---

## Task 8: Deduplicate FullscreenVitalsOverlay

**Files:**
- Modify: `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx`
- Reference: `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx`

Two nearly-identical copies exist. Replace the `shared/integrations` copy with a re-export of the `player/overlays` copy.

- [ ] **Step 1: Identify all consumers of the shared copy**

Before touching anything, find every import site:

```bash
grep -rn 'shared/integrations/FullscreenVitalsOverlay' frontend/src/ --include="*.js" --include="*.jsx"
```

For each consumer, note: does it import default, named, or both? Does it pass different props than consumers of the player/overlays copy? This is a 5-minute check that prevents a silent runtime regression.

- [ ] **Step 2: Verify the two files are functionally identical**

Run a diff to confirm they're close enough to merge:

```bash
diff frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx
```

Check the diff output. If there are only import path differences and the inline `.find()` change from Task 6, they can be merged. If there are meaningful behavioral differences (not just import paths), adapt the player/overlays copy to support both use cases via props before proceeding.

**Also check:** Does the shared copy import from different relative paths that resolve to different modules? A re-export changes the resolution base — verify relative imports in the canonical copy resolve correctly from both locations.

- [ ] **Step 3: Replace shared/integrations copy with re-export**

Replace the contents of `frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/FullscreenVitalsOverlay.jsx` with:

```javascript
// Deduplicated — canonical copy lives in player/overlays
export { default, FullscreenVitalsOverlay } from '../../../player/overlays/FullscreenVitalsOverlay.jsx';
```

If the canonical file doesn't have a named `FullscreenVitalsOverlay` export, check what consumers import and adjust accordingly. The re-export must match whatever the consumers expect.

- [ ] **Step 3: Check for any index file that re-exports from the shared path**

```bash
grep -r "FullscreenVitalsOverlay" frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/ --include="*.js" --include="*.jsx"
```

If there's an `index.js` or similar, update it to re-export from the new path.

- [ ] **Step 4: Verify build succeeds**

Run: `cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -5`
Expected: `built in Xs`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/shared/integrations/FullscreenVitalsOverlay/
git commit -m "refactor(fitness): deduplicate FullscreenVitalsOverlay — shared copy re-exports player copy"
```

---

## Task 9: Clean Up FitnessSession Ledger Checks

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:2858-2862, 2898-2904`

The ledger reconciliation code in FitnessSession has verbose `ownsHrDevice` + `hrDeviceId` fallback patterns from the earlier hotfix. Simplify these now that `ownsHrDevice` is reliable.

**Important:** Keep `?.` null-safety on `user` — the reconciliation loop may encounter a ledger entry referencing a user who was removed mid-session. Dropping `?.` would throw. Use `?? false` instead of `|| fallback` to avoid falsy-value bugs.

- [ ] **Step 1: Simplify orphan cleanup (line ~2858-2862)**

Find:
```javascript
      const deviceMatches = user?.ownsHrDevice?.(entry.deviceId) || (user?.hrDeviceId ? String(user.hrDeviceId) === entry.deviceId : false);
```

Replace with:
```javascript
      const deviceMatches = user?.ownsHrDevice?.(entry.deviceId) ?? false;
```

The `hrDeviceId` string fallback is no longer needed — `ownsHrDevice` checks the canonical Set. The `?.` on `user` stays for null-safety.

- [ ] **Step 2: Simplify reconciliation check (line ~2898-2904)**

Find:
```javascript
      const ownsDevice = user.ownsHrDevice?.(entry.deviceId) || (user.hrDeviceId ? String(user.hrDeviceId) === entry.deviceId : false);
      if (user.hrDeviceIds?.size > 0 && !ownsDevice) {
        mismatches.push({ type: 'device-mismatch', deviceId: entry.deviceId, occupantSlug: slug, hrDeviceIds: [...(user.hrDeviceIds || [])] });
```

Replace with:
```javascript
      const ownsDevice = user?.ownsHrDevice?.(entry.deviceId) ?? false;
      if (user?.hrDeviceIds?.size > 0 && !ownsDevice) {
        mismatches.push({ type: 'device-mismatch', deviceId: entry.deviceId, occupantSlug: slug, hrDeviceIds: [...(user.hrDeviceIds || [])] });
```

Note: Keep `?.` on `user` and `user.hrDeviceIds` — `user` may be null if a ledger entry references a removed participant.

- [ ] **Step 3: Verify build succeeds**

Run: `cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -5`
Expected: `built in Xs`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js
git commit -m "refactor(fitness): simplify ledger ownership checks — use ownsHrDevice directly"
```

---

## Task 10: Run Full Test Suite and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run unit tests**

```bash
npx jest tests/unit/fitness/ --no-cache --verbose
```

Expected: All tests pass, including the new DeviceOwnershipIndex and UserManager multi-device tests.

- [ ] **Step 2: Run full build**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build
```

Expected: Build completes with no errors.

- [ ] **Step 3: Check for remaining raw `String(u.hrDeviceId) ===` patterns**

```bash
grep -rn 'String(.*hrDeviceId).*===' frontend/src/ --include="*.js" --include="*.jsx" | grep -v node_modules | grep -v '.test.'
```

Expected: Zero matches in the files modified in this plan. Remaining matches (if any) are in files not touched by this plan — note them for a follow-up pass. The goal is zero inline ownership comparisons in UI components; domain code may still have a few until the index is fully adopted.

- [ ] **Step 4: Update audit doc**

Add a "Post-Refactor Status" section to `docs/_wip/audits/2026-04-15-fitness-device-ownership-ssot-audit.md`:

```markdown
## Post-Refactor Status (Task 10 verification)

- [ ] DeviceOwnershipIndex is the SSoT for device→user mapping
- [ ] All inline `.find(u => hrDeviceId === ...)` patterns removed from UI components
- [ ] SidebarFooter, FitnessUsers, FullscreenVitalsOverlay use context queries
- [ ] FullscreenVitalsOverlay deduplicated to single copy
- [ ] Roster entries carry `hrDeviceIds` array
- [ ] FitnessContext `participantLookupByDevice` indexes all device IDs per user
- [ ] Remaining `hrDeviceId` references are backwards-compat getters or identity fallbacks (non-ownership)
```

- [ ] **Step 5: Commit**

```bash
git add docs/_wip/audits/2026-04-15-fitness-device-ownership-ssot-audit.md
git commit -m "docs: update device ownership audit with post-refactor verification"
```

---

## Task 11: Runtime Smoke Test

**Files:** None (manual verification)

Build passing and unit tests green confirm code correctness, not feature correctness. Incorrect device resolution means showing the wrong person's heart rate on the overlay — that's a visible regression. This task is a manual check.

- [ ] **Step 1: Start a fitness session with 2+ users**

Start the dev server if not running. Navigate to the fitness module and start a session with at least two registered users who have different HR devices.

- [ ] **Step 2: Verify device assignment in FitnessUsers panel**

Confirm each user's HR reading appears next to the correct name. If a user has multiple devices (e.g., Alan with `20991`, `10366`, `28676`), verify all devices resolve to the same user.

- [ ] **Step 3: Verify FullscreenVitalsOverlay**

Trigger the fullscreen vitals overlay. Confirm device-to-name resolution matches the FitnessUsers panel.

- [ ] **Step 4: Verify SidebarFooter device labels**

Check that the sidebar footer shows correct device-to-name mappings.

If any device shows the wrong user name or "Unknown", the refactor has a resolution bug — investigate before committing the final audit update.
